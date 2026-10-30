//! A placa efetiva em malhas prontas para a GPU, montadas UMA vez por mudanca da placa:
//! - capsulas (segmento + largura): trilhas, serigrafia, texto de traco, arcos, pads ovais e
//!   redondos, vias e furos -- desenhadas por SDF no shader, nitidas em qualquer zoom;
//! - triangulos: pads retangulares/arredondados, fills, regioes, texto de contorno e a placa.
//! Cada camada e uma faixa contigua nos buffers: pan/zoom so muda um uniform, a ordem das
//! camadas so muda a ordem dos draw calls. Nada e refeito por quadro (o Canvas 2D refazia tudo).

use crate::font;
use crate::geom::{self, Shape};
use crate::layers;
use crate::model::*;
use bytemuck::{Pod, Zeroable};
use lyon_tessellation::math::point;
use lyon_tessellation::path::Path;
use lyon_tessellation::{BuffersBuilder, FillOptions, FillRule, FillTessellator, FillVertex, VertexBuffers};
use std::collections::HashMap;
use std::ops::Range;

/// largura negativa = pixels de tela (contorno da placa, poligono), positiva = mm
#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct Capsule {
    pub p0: [f32; 2],
    pub p1: [f32; 2],
    pub w: f32,
    pub color: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct Vert {
    pub pos: [f32; 2],
    pub color: u32,
}

#[derive(Debug, Clone)]
pub struct LayerMesh {
    pub key: String,
    pub tris: Range<u32>,
    pub caps: Range<u32>,
}

#[derive(Default)]
pub struct Scene {
    pub verts: Vec<Vert>,
    pub indices: Vec<u32>,
    pub caps: Vec<Capsule>,
    /// camadas da placa (chave do Altium), em ordem da tabela
    pub layers: Vec<LayerMesh>,
    /// a placa (preta, com os recortes vazados) -- desenhada primeiro, com a grade
    pub board: Option<LayerMesh>,
    /// furos (pretos), contorno, poligonos e fantasmas -- por cima de tudo
    pub drills: Option<LayerMesh>,
    pub outline: Option<LayerMesh>,
    pub overlay: Option<LayerMesh>,
    pub extents: BBox,
    pub stats: SceneStats,
}

#[derive(Default, Debug, Clone)]
pub struct SceneStats {
    pub triangles: usize,
    pub capsules: usize,
    pub build_ms: f64,
}

/// o relogio (no WASM do navegador nao ha: std::time::Instant entra em panico la)
fn relogio() -> Option<std::time::Instant> {
    if cfg!(target_arch = "wasm32") {
        None
    } else {
        Some(std::time::Instant::now())
    }
}

pub fn rgba(c: [u8; 3], a: f32) -> u32 {
    u32::from_le_bytes([c[0], c[1], c[2], (a.clamp(0.0, 1.0) * 255.0).round() as u8])
}

pub const MASCARA_PADRAO: f64 = 0.1016;
const SEM_PASTA: f64 = -500.0;
const ARC_TOL: f64 = 0.004;

#[derive(Default)]
struct Bucket {
    verts: Vec<Vert>,
    idx: Vec<u32>,
    caps: Vec<Capsule>,
}

impl Bucket {
    fn cap(&mut self, a: [f64; 2], b: [f64; 2], w: f64, color: u32) {
        self.caps.push(Capsule { p0: [a[0] as f32, a[1] as f32], p1: [b[0] as f32, b[1] as f32], w: w as f32, color });
    }
    fn polyline(&mut self, pts: &[[f64; 2]], w: f64, color: u32) {
        for s in pts.windows(2) {
            self.cap(s[0], s[1], w, color);
        }
    }
    fn arc(&mut self, cx: f64, cy: f64, r: f64, sa: f64, ea: f64, w: f64, color: u32) {
        let p = geom::arc_points(cx, cy, r, sa, ea, ARC_TOL);
        self.polyline(&p, w, color);
    }
    fn convex(&mut self, pts: &[[f64; 2]], color: u32) {
        if pts.len() < 3 {
            return;
        }
        let base = self.verts.len() as u32;
        for p in pts {
            self.verts.push(Vert { pos: [p[0] as f32, p[1] as f32], color });
        }
        for i in 1..(pts.len() as u32 - 1) {
            self.idx.extend_from_slice(&[base, base + i, base + i + 1]);
        }
    }
    fn shape(&mut self, s: Shape, color: u32) {
        match s {
            Shape::Capsule(a, b, w) => self.cap(a, b, w, color),
            Shape::Convex(p) => self.convex(&p, color),
        }
    }
    /// poligonos com furos/concavos: lyon, regra par-impar
    fn fill_evenodd(&mut self, rings: &[&[[f64; 2]]], color: u32) {
        let mut b = Path::builder();
        let mut any = false;
        for r in rings {
            if r.len() < 3 {
                continue;
            }
            b.begin(point(r[0][0] as f32, r[0][1] as f32));
            for p in &r[1..] {
                b.line_to(point(p[0] as f32, p[1] as f32));
            }
            b.end(true);
            any = true;
        }
        if !any {
            return;
        }
        let path = b.build();
        let mut g: VertexBuffers<[f32; 2], u32> = VertexBuffers::new();
        let mut t = FillTessellator::new();
        let ok = t.tessellate_path(
            &path,
            &FillOptions::tolerance(0.001).with_fill_rule(FillRule::EvenOdd),
            &mut BuffersBuilder::new(&mut g, |v: FillVertex| v.position().to_array()),
        );
        if ok.is_err() {
            return;
        }
        let base = self.verts.len() as u32;
        self.verts.extend(g.vertices.iter().map(|p| Vert { pos: *p, color }));
        self.idx.extend(g.indices.iter().map(|i| base + i));
    }
}

#[derive(Default)]
pub struct BuildOpts {
    /// vista de baixo (View > Flip Board): o pad passante mostra a face de baixo
    pub flipped: bool,
    pub ghosts: Option<crate::changes::Ghosts>,
    /// a cor de cada camada (a tela web manda as dela); sem, a tabela + board.layers
    pub colors: Option<HashMap<String, [u8; 3]>>,
    /// a geometria dos textos ja pronta (a da tela web, igual a do Gerber); sem, a HubFont daqui
    pub texts: Option<Vec<TextIn>>,
    /// expansao da mascara e da pasta (rules.js); sem, as do board.js
    pub sm: Option<f64>,
    pub pm: Option<f64>,
    /// o contorno dos poligonos (a tela web desenha os dela tracejados por cima)
    pub sem_poligonos: bool,
}

/// Um texto ja resolvido: contorno exato (aneis par-impar) ou tracos com largura.
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(default)]
pub struct TextIn {
    pub layer: String,
    pub polys: Vec<Vec<[f64; 2]>>,
    pub linhas: Vec<Vec<[f64; 2]>>,
    pub w: f64,
    pub inv: bool,
    pub caixa: Vec<[f64; 2]>,
}

pub fn build(eb: &Board, opts: &BuildOpts) -> Scene {
    let t0 = relogio();
    let mut buckets: HashMap<String, Bucket> = HashMap::new();
    let mut colors: HashMap<String, [u8; 3]> =
        layers::table().iter().map(|l| (l.key.clone(), layers::color_of(&l.key, &eb.layers))).collect();
    if let Some(c) = &opts.colors {
        colors.extend(c.iter().map(|(k, v)| (k.clone(), *v)));
    }
    let col = |k: &str| rgba(colors.get(k).copied().unwrap_or([0x88, 0x88, 0x88]), 1.0);
    let ko = |k: &str| rgba(colors.get(k).copied().unwrap_or([0x88, 0x88, 0x88]), 0.45);
    let mut drills = Bucket::default();
    let black = rgba([0, 0, 0], 1.0);
    let sm_rule = opts.sm.or(eb.rules.as_ref().and_then(|r| r.sm)).unwrap_or(MASCARA_PADRAO);
    let pm_rule = opts.pm.or(eb.rules.as_ref().and_then(|r| r.pm)).unwrap_or(0.0);

    macro_rules! b {
        ($k:expr) => {
            buckets.entry($k.to_string()).or_default()
        };
    }

    // trilhas, arcos, serigrafia e linhas
    for (list, arcs) in [(&eb.tracks, false), (&eb.arcs, true), (&eb.silk, false), (&eb.lines, false)] {
        for o in list {
            if o.layer.is_empty() {
                continue;
            }
            let c = if o.keepout { ko(&o.layer) } else { col(&o.layer) };
            let is_arc = arcs || o.kind == "arc";
            if is_arc {
                if o.r > 0.0 {
                    b!(o.layer).arc(o.cx, o.cy, o.r, o.sa, if o.is_full_circle() { o.sa + 360.0 } else { o.ea }, o.w, c);
                }
            } else {
                b!(o.layer).cap([o.x1, o.y1], [o.x2, o.y2], o.w, c);
            }
        }
    }
    for f in &eb.fills {
        let c = if f.keepout { ko(&f.layer) } else { col(&f.layer) };
        let (cx, cy) = ((f.x1 + f.x2) / 2.0, (f.y1 + f.y2) / 2.0);
        b!(f.layer).convex(&geom::rect_corners(cx, cy, (f.x2 - f.x1).abs(), (f.y2 - f.y1).abs(), f.rot), c);
    }
    for g in &eb.regions {
        if g.points.len() < 3 {
            continue;
        }
        let c = if g.keepout { ko(&g.layer) } else { col(&g.layer) };
        let mut rings: Vec<&[[f64; 2]]> = vec![&g.points];
        for h in &g.holes {
            rings.push(h);
        }
        b!(g.layer).fill_evenodd(&rings, c);
    }
    for t in opts.texts.iter().flatten() {
        let c = col(&t.layer);
        let bk = b!(t.layer);
        if !t.polys.is_empty() {
            let rings: Vec<&[[f64; 2]]> = t.polys.iter().map(|q| q.as_slice()).collect();
            bk.fill_evenodd(&rings, c);
        } else if t.inv && t.caixa.len() >= 3 {
            bk.convex(&t.caixa, c);
            for l in &t.linhas {
                bk.polyline(l, t.w, black);
            }
        } else {
            for l in &t.linhas {
                bk.polyline(l, t.w, c);
            }
        }
    }
    for t in eb.texts.iter().filter(|_| opts.texts.is_none()) {
        if t.layer.is_empty() || t.hidden {
            continue;
        }
        let c = col(&t.layer);
        if let Some(ps) = text_polys(t) {
            let rings: Vec<&[[f64; 2]]> = ps.iter().map(|q| q.pts.as_slice()).collect();
            b!(t.layer).fill_evenodd(&rings, c);
            continue;
        }
        if let Some(g) = font::text_geom(t) {
            let bk = b!(t.layer);
            if t.inverted {
                // moldura cheia e as letras na cor da placa
                bk.convex(&g.frame, c);
                for l in &g.lines {
                    bk.polyline(l, g.w, black);
                }
            } else {
                for l in &g.lines {
                    bk.polyline(l, g.w, c);
                }
            }
        }
    }

    // pads: cobre, mascara e pasta
    let view_bottom = opts.flipped;
    let pad = |p: &Pad, buckets: &mut HashMap<String, Bucket>, drills: &mut Bucket| {
        let (cx, cy) = p.copper_center();
        let e_sm = p.sm.unwrap_or(sm_rule);
        let raio = |shape: &str, w: f64, h: f64, r: Option<f64>, e: f64| {
            if shape.eq_ignore_ascii_case("roundrect") {
                Some(r.unwrap_or(w.min(h) / 8.0) + e)
            } else {
                r
            }
        };
        if p.is_th() {
            let (sh, w, h, r) = p.face(view_bottom);
            if let Some(s) = geom::pad_shape(cx, cy, w, h, p.rot, &sh, r) {
                buckets.entry("Multi".into()).or_default().shape(s, col("Multi"));
            }
            pad_drill(p, drills, black);
            for (bottom, cam) in [(false, "TopSolder"), (true, "BottomSolder")] {
                let tent = if bottom { p.tent_bot } else { p.tent_top };
                if tent == Some(true) {
                    continue;
                }
                let (sh, w, h, r) = p.face(bottom);
                if let Some(s) = geom::pad_shape(cx, cy, w + 2.0 * e_sm, h + 2.0 * e_sm, p.rot, &sh, raio(&sh, w, h, r, e_sm)) {
                    buckets.entry(cam.into()).or_default().shape(s, col(cam));
                }
            }
            return;
        }
        if p.layer.is_empty() {
            return;
        }
        let (sh, w, h, r) = p.face(false);
        if let Some(s) = geom::pad_shape(cx, cy, w, h, p.rot, &sh, r) {
            buckets.entry(p.layer.clone()).or_default().shape(s, col(&p.layer));
        }
        let lado = match p.layer.as_str() {
            "Top" => "Top",
            "Bottom" => "Bottom",
            _ => return,
        };
        let tent = if lado == "Bottom" { p.tent_bot } else { p.tent_top };
        if tent != Some(true) {
            let cam = format!("{lado}Solder");
            if let Some(s) = geom::pad_shape(cx, cy, w + 2.0 * e_sm, h + 2.0 * e_sm, p.rot, &sh, raio(&sh, w, h, r, e_sm)) {
                let c = col(&cam);
                buckets.entry(cam).or_default().shape(s, c);
            }
        }
        if !(p.nopaste == Some(true) || p.pm.map(|v| v <= SEM_PASTA).unwrap_or(false)) {
            let e = p.pm.unwrap_or(pm_rule);
            if w + 2.0 * e > 0.0 && h + 2.0 * e > 0.0 {
                let cam = format!("{lado}Paste");
                if let Some(s) = geom::pad_shape(cx, cy, w + 2.0 * e, h + 2.0 * e, p.rot, &sh, raio(&sh, w, h, r, e)) {
                    let c = col(&cam);
                    buckets.entry(cam).or_default().shape(s, c);
                }
            }
        }
    };
    for c in &eb.components {
        for p in &c.pads {
            pad(p, &mut buckets, &mut drills);
        }
    }
    for p in &eb.freepads {
        pad(p, &mut buckets, &mut drills);
    }
    for v in &eb.vias {
        if !(v.size > 0.0) {
            continue;
        }
        buckets.entry("Multi".into()).or_default().cap([v.x, v.y], [v.x, v.y], v.size, col("Multi"));
        if v.drill > 0.0 {
            drills.cap([v.x, v.y], [v.x, v.y], v.drill, black);
        }
        let e = v.sm.unwrap_or(sm_rule);
        for (bottom, cam) in [(false, "TopSolder"), (true, "BottomSolder")] {
            let tent = if bottom { v.tent_bot } else { v.tent_top };
            if tent == Some(true) {
                continue;
            }
            let d = v.size + 2.0 * e;
            if d > 0.0 {
                buckets.entry(cam.into()).or_default().cap([v.x, v.y], [v.x, v.y], d, col(cam));
            }
        }
    }

    // a placa: os lacos do contorno, com os recortes vazados
    let mut board_b = Bucket::default();
    let loops = geom::outline_loops(eb, &eb.board.outline);
    let cut_rings = board_cutouts(eb);
    {
        let mut rings: Vec<&[[f64; 2]]> = loops.iter().map(|l| l.as_slice()).collect();
        for k in &cut_rings {
            rings.push(k);
        }
        board_b.fill_evenodd(&rings, black);
    }
    let mut outline_b = Bucket::default();
    let contorno = rgba(layers::hex("#a8a8a8"), 1.0);
    for l in loops.iter().chain(cut_rings.iter()) {
        let mut c = l.clone();
        c.push(l[0]);
        outline_b.polyline(&c, -1.3, contorno);
    }
    // poligonos: o contorno na cor da camada (o despejo ja esta nas regioes)
    for p in eb.polygons.iter().filter(|_| !opts.sem_poligonos) {
        if p.pts.len() >= 3 {
            let mut c = p.pts.clone();
            c.push(p.pts[0]);
            outline_b.polyline(&c, -1.3, rgba(colors.get(&p.layer).copied().unwrap_or([0x88; 3]), 0.95));
        }
    }

    // fantasmas da diferenca (changes.js): o lugar de antes, o removido, a seta
    let mut over = Bucket::default();
    if let Some(g) = &opts.ghosts {
        let del = rgba(layers::hex("#ff5252"), 0.8);
        let seta = rgba(layers::hex("#ffd54f"), 0.85);
        for (a, b2, w) in &g.removed_segs {
            over.cap(*a, *b2, (w * 0.3).max(0.0), del);
            over.cap(*a, *b2, -1.5, del);
        }
        for (a, b2, w, l) in &g.edited_segs {
            let c = rgba(colors.get(l).copied().unwrap_or([0x88; 3]), 0.45);
            over.cap(*a, *b2, (w * 0.3).max(0.0), c);
            over.cap(*a, *b2, -1.5, c);
        }
        for (p, s) in &g.removed_vias {
            over.arc(p[0], p[1], s / 2.0, 0.0, 360.0, -1.2, del);
        }
        for (bb, from, to, lay) in &g.moved {
            if bb.valid() {
                let c = rgba(colors.get(lay).copied().unwrap_or([0xff, 0, 0]), 0.55);
                let r = [[bb.x1, bb.y1], [bb.x2, bb.y1], [bb.x2, bb.y2], [bb.x1, bb.y2], [bb.x1, bb.y1]];
                over.polyline(&r, -1.2, c);
            }
            over.cap(*from, *to, -1.3, seta);
        }
    }

    // monta os buffers: cada camada uma faixa contigua
    let mut sc = Scene { extents: eb.extents(), ..Default::default() };
    let push = |key: &str, bk: Bucket, sc: &mut Scene| -> LayerMesh {
        let vb = sc.verts.len() as u32;
        let i0 = sc.indices.len() as u32;
        let c0 = sc.caps.len() as u32;
        sc.verts.extend_from_slice(&bk.verts);
        sc.indices.extend(bk.idx.iter().map(|i| i + vb));
        sc.caps.extend_from_slice(&bk.caps);
        LayerMesh { key: key.to_string(), tris: i0..sc.indices.len() as u32, caps: c0..sc.caps.len() as u32 }
    };
    sc.board = Some(push("_board", board_b, &mut sc));
    let mut keys: Vec<String> = buckets.keys().cloned().collect();
    keys.sort_by_key(|k| layers::by_key(k).map(|l| l.order).unwrap_or(usize::MAX));
    for k in keys {
        let bk = buckets.remove(&k).unwrap();
        let m = push(&k, bk, &mut sc);
        sc.layers.push(m);
    }
    sc.drills = Some(push("_drills", drills, &mut sc));
    sc.outline = Some(push("_outline", outline_b, &mut sc));
    sc.overlay = Some(push("_overlay", over, &mut sc));
    sc.stats = SceneStats {
        triangles: sc.indices.len() / 3,
        capsules: sc.caps.len(),
        build_ms: t0.map(|t| t.elapsed().as_secs_f64() * 1000.0).unwrap_or(0.0),
    };
    sc
}

/// Os recortes que vazam a placa (o recortesDe + boardCutouts do hub): kindn 1 (sem plano) e -1
/// (a regiao da placa) nao sao furo; recorte sem kindn em camada de cobre tambem nao; e o que
/// cobre a caixa da placa inteira e a propria placa repetida.
pub fn board_cutouts(eb: &Board) -> Vec<Vec<[f64; 2]>> {
    const TOL: f64 = 1e-3;
    let bb = eb.board.bbox.clone().filter(|b| b.valid()).unwrap_or_else(|| eb.extents());
    eb.cutouts
        .iter()
        .filter(|k| k.points.len() >= 3 && !k.polycut)
        .filter(|k| !matches!(k.kindn, Some(1) | Some(-1)))
        .filter(|k| k.kindn.is_some() || !layers::is_copper(&k.layer))
        .filter(|k| {
            let mut b = BBox::EMPTY;
            for p in &k.points {
                b.add(p[0], p[1]);
            }
            !(b.x1 <= bb.x1 + TOL && b.x2 >= bb.x2 - TOL && b.y1 <= bb.y1 + TOL && b.y2 >= bb.y2 - TOL)
        })
        .map(|k| k.points.clone())
        .collect()
}

fn pad_drill(p: &Pad, drills: &mut Bucket, black: u32) {
    let Some(d) = p.drill.filter(|d| *d > 0.0) else { return };
    let forma = p.drillshape.as_deref().unwrap_or("circle").to_ascii_lowercase();
    let rot = p.rot + p.holerot.unwrap_or(0.0);
    match (forma.as_str(), p.drillw.filter(|w| *w > 0.0)) {
        ("rect" | "square", Some(dw)) => drills.convex(&geom::rect_corners(p.x, p.y, dw, d, rot), black),
        ("oblong" | "slot", Some(dw)) => {
            if let Some(s) = geom::pad_shape(p.x, p.y, dw, d, rot, "oval", None) {
                drills.shape(s, black);
            }
        }
        _ => drills.cap([p.x, p.y], [p.x, p.y], d, black),
    }
}

/// O contorno exato do Altium (polys) quando ele ainda esta em cima do texto.
pub fn text_polys(t: &Text) -> Option<&Vec<TextPoly>> {
    let ps = t.polys.as_ref()?;
    let mut bb = BBox::EMPTY;
    let mut n = 0;
    for q in ps.iter().filter(|q| !q.hole && q.pts.len() >= 3) {
        for p in &q.pts {
            bb.add(p[0], p[1]);
        }
        n += 1;
    }
    if n == 0 || !bb.valid() {
        return None;
    }
    let (cx, cy) = ((bb.x1 + bb.x2) / 2.0, (bb.y1 + bb.y2) / 2.0);
    if ((cx - t.x).powi(2) + (cy - t.y).powi(2)).sqrt() > t.h.max(1.0) {
        return None;
    }
    Some(ps)
}

/// Uma malha avulsa (realce de net, selecao, hover): os objetos dados e, com `net`, todo o
/// cobre daquela net. `color(camada)` da a cor de cada objeto.
pub fn highlight(eb: &Board, net: Option<&str>, items: &[crate::pick::ItemRef], color: &dyn Fn(&str) -> u32) -> (Vec<Vert>, Vec<u32>, Vec<Capsule>) {
    use crate::pick::ItemRef as I;
    let mut bk = Bucket::default();
    let add_pad = |p: &Pad, bk: &mut Bucket| {
        let (cx, cy) = p.copper_center();
        let (sh, w, h, r) = p.face(false);
        if let Some(s) = geom::pad_shape(cx, cy, w, h, p.rot, &sh, r) {
            bk.shape(s, color(&p.layer));
        }
    };
    let seg = |o: &Seg, arc: bool, bk: &mut Bucket| {
        let c = color(&o.layer);
        if arc {
            bk.arc(o.cx, o.cy, o.r, o.sa, if o.is_full_circle() { o.sa + 360.0 } else { o.ea }, o.w.max(0.0), c)
        } else {
            bk.cap([o.x1, o.y1], [o.x2, o.y2], o.w, c)
        }
    };
    let add_item = |it: &I, bk: &mut Bucket| match *it {
        I::Pad(c, i) => {
            if let Some(p) = eb.components.get(c).and_then(|c| c.pads.get(i)) {
                add_pad(p, bk)
            }
        }
        I::FreePad(i) => {
            if let Some(p) = eb.freepads.get(i) {
                add_pad(p, bk)
            }
        }
        I::Via(i) => {
            if let Some(v) = eb.vias.get(i) {
                bk.cap([v.x, v.y], [v.x, v.y], v.size, color("Multi"))
            }
        }
        I::Track(i) => {
            if let Some(o) = eb.tracks.get(i) {
                seg(o, false, bk)
            }
        }
        I::Arc(i) => {
            if let Some(o) = eb.arcs.get(i) {
                seg(o, true, bk)
            }
        }
        I::Silk(i) => {
            if let Some(o) = eb.silk.get(i) {
                seg(o, o.kind == "arc", bk)
            }
        }
        I::Line(i) => {
            if let Some(o) = eb.lines.get(i) {
                seg(o, o.kind == "arc", bk)
            }
        }
        I::Fill(i) => {
            if let Some(f) = eb.fills.get(i) {
                let (cx, cy) = ((f.x1 + f.x2) / 2.0, (f.y1 + f.y2) / 2.0);
                bk.convex(&geom::rect_corners(cx, cy, (f.x2 - f.x1).abs(), (f.y2 - f.y1).abs(), f.rot), color(&f.layer))
            }
        }
        I::Region(i) => {
            if let Some(g) = eb.regions.get(i) {
                let mut rings: Vec<&[[f64; 2]]> = vec![&g.points];
                for h in &g.holes {
                    rings.push(h);
                }
                bk.fill_evenodd(&rings, color(&g.layer))
            }
        }
        I::Text(i) => {
            if let Some(t) = eb.texts.get(i) {
                let c = color(&t.layer);
                if let Some(g) = font::text_geom(t) {
                    let mut f = g.frame.to_vec();
                    f.push(g.frame[0]);
                    bk.polyline(&f, -1.4, c);
                } else if let Some(ps) = text_polys(t) {
                    for q in ps {
                        let mut f = q.pts.clone();
                        f.push(q.pts[0]);
                        bk.polyline(&f, -1.4, c);
                    }
                }
            }
        }
        I::Comp(c) => {
            if let Some(o) = eb.components.get(c) {
                if let Some(bb) = o.bbox.as_ref() {
                    let r = [[bb.x1, bb.y1], [bb.x2, bb.y1], [bb.x2, bb.y2], [bb.x1, bb.y2], [bb.x1, bb.y1]];
                    bk.polyline(&r, -1.6, color(&o.layer));
                }
            }
        }
    };
    if let Some(net) = net.filter(|n| !n.is_empty()) {
        // regioes e fills primeiro (por baixo), pads e vias por ultimo (por cima)
        for (i, o) in eb.regions.iter().enumerate() {
            if o.net == net {
                add_item(&I::Region(i), &mut bk);
            }
        }
        for (i, o) in eb.fills.iter().enumerate() {
            if o.net == net {
                add_item(&I::Fill(i), &mut bk);
            }
        }
        for (i, o) in eb.tracks.iter().enumerate() {
            if o.net == net {
                add_item(&I::Track(i), &mut bk);
            }
        }
        for (i, o) in eb.arcs.iter().enumerate() {
            if o.net == net {
                add_item(&I::Arc(i), &mut bk);
            }
        }
        for (ci, c) in eb.components.iter().enumerate() {
            for (pi, p) in c.pads.iter().enumerate() {
                if p.net == net {
                    add_item(&I::Pad(ci, pi), &mut bk);
                }
            }
        }
        for (i, p) in eb.freepads.iter().enumerate() {
            if p.net == net {
                add_item(&I::FreePad(i), &mut bk);
            }
        }
        for (i, o) in eb.vias.iter().enumerate() {
            if o.net == net {
                add_item(&I::Via(i), &mut bk);
            }
        }
    }
    for it in items {
        add_item(it, &mut bk);
    }
    (bk.verts, bk.idx, bk.caps)
}
