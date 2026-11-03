//! O motor de mudancas: aplica o `changes.js` (uma op por linha) por cima do `board.js` e devolve a
//! placa efetiva, no mesmo formato -- o applyPcbChanges + effectiveBoard do hub-core.js.
//! A placa espelhada nunca e editada; cada op confere os orig_* e diz ok/aviso/erro.

use crate::geom::{self, norm_ang, r6};
use crate::layers;
use crate::model::*;
use serde_json::Value;
use std::collections::{HashMap, HashSet};

const TOL: f64 = 1e-3;
const TOL_ANG: f64 = 1e-2;

fn near(a: f64, b: f64) -> bool {
    (a - b).abs() <= TOL
}
fn near_ang(a: f64, b: f64) -> bool {
    let mut d = (a - b).abs() % 360.0;
    if d > 180.0 {
        d = 360.0 - d;
    }
    d <= TOL_ANG
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    Ok,
    Warn,
    Err,
}

#[derive(Debug, Clone)]
pub struct ChangeStatus {
    pub idx: usize,
    pub op: String,
    pub level: Level,
    pub msg: String,
    pub note: String,
}

/// O que a tela desenha por cima para mostrar a diferenca (o "fantasma" do pcbframe).
#[derive(Debug, Clone, Default)]
pub struct Ghosts {
    /// objetos removidos ou o lugar de antes dos editados: (segmentos, largura)
    pub removed_segs: Vec<([f64; 2], [f64; 2], f64)>,
    pub edited_segs: Vec<([f64; 2], [f64; 2], f64, String)>,
    pub removed_vias: Vec<([f64; 2], f64)>,
    /// componente movido: caixa de antes e a seta de antes -> agora
    pub moved: Vec<(BBox, [f64; 2], [f64; 2], String)>,
    pub added_ids: HashSet<String>,
}

pub struct Applied {
    pub board: Board,
    pub status: Vec<ChangeStatus>,
    pub ghosts: Ghosts,
    pub outline_changed: bool,
}

impl Applied {
    pub fn counts(&self) -> (usize, usize, usize) {
        let w = self.status.iter().filter(|s| s.level == Level::Warn).count();
        let e = self.status.iter().filter(|s| s.level == Level::Err).count();
        (self.status.len() - w - e, w, e)
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Delta {
    ox: f64,
    oy: f64,
    nx: f64,
    ny: f64,
    dr: f64,
    pub flip: bool,
    phi: f64,
    cos: f64,
    sin: f64,
}

impl Delta {
    pub fn new(src: (f64, f64, f64, &str), eff: (f64, f64, f64, &str)) -> Delta {
        let dr = eff.2 - src.2;
        let flip = eff.3 != src.3;
        let phi = if flip { eff.2 + src.2 } else { dr };
        let (cos, sin) = geom::cos_sin(phi);
        Delta { ox: src.0, oy: src.1, nx: eff.0, ny: eff.1, dr, flip, phi, cos, sin }
    }
    pub fn pt(&self, x: f64, y: f64) -> (f64, f64) {
        let lx = x - self.ox;
        let mut ly = y - self.oy;
        if self.flip {
            ly = -ly;
        }
        (self.nx + lx * self.cos - ly * self.sin, self.ny + lx * self.sin + ly * self.cos)
    }
    pub fn pt6(&self, p: [f64; 2]) -> [f64; 2] {
        let (x, y) = self.pt(p[0], p[1]);
        [r6(x), r6(y)]
    }
    pub fn pt_inv(&self, x: f64, y: f64) -> (f64, f64) {
        let (lx, ly) = (x - self.nx, y - self.ny);
        let rx = lx * self.cos + ly * self.sin;
        let ry = -lx * self.sin + ly * self.cos;
        (self.ox + rx, self.oy + if self.flip { -ry } else { ry })
    }
    pub fn angle(&self, a: f64) -> f64 {
        if self.flip {
            self.phi - a
        } else {
            a + self.dr
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
enum Arr {
    Track,
    Arc,
    Via,
    Text,
    Silk,
    Line,
    Fill,
    Region,
    Cutout,
    FreePad,
    Polygon,
}

#[derive(Clone)]
struct CompState {
    x: f64,
    y: f64,
    rot: f64,
    layer: String,
    designator: Option<String>,
    comment: Option<String>,
    deleted: bool,
    pad_nets: HashMap<String, String>,
    /// indice da ultima op que moveu
    moved_by: Option<usize>,
}

fn num(ch: &Value, k: &str) -> Option<f64> {
    ch.get(k).and_then(|v| v.as_f64()).filter(|v| v.is_finite())
}
fn s<'a>(ch: &'a Value, k: &str) -> Option<&'a str> {
    ch.get(k).and_then(|v| v.as_str())
}
fn bool_(ch: &Value, k: &str) -> bool {
    ch.get(k).and_then(|v| v.as_bool()).unwrap_or(false)
}
fn pts(ch: &Value, k: &str) -> Option<Vec<[f64; 2]>> {
    let a = ch.get(k)?.as_array()?;
    let mut out = Vec::with_capacity(a.len());
    for p in a {
        let p = p.as_array()?;
        out.push([p.first()?.as_f64()?, p.get(1)?.as_f64()?]);
    }
    Some(out)
}

fn layer_err(key: Option<&str>, what: &str) -> Option<String> {
    let Some(key) = key.filter(|k| !k.is_empty()) else { return Some("falta layer".into()) };
    match layers::by_key(key) {
        None => Some(format!("layer \"{key}\" não existe (use uma chave da tabela: Top, Bottom, TopOverlay, Mech1...)")),
        Some(l) if l.kind == layers::Kind::Multi => Some(format!("{what} não pode ficar na Multi-Layer")),
        _ => None,
    }
}

pub fn apply(board: &Board, changes: &[Value]) -> Applied {
    let mut eb = board.clone();
    let pares = layers::mech_pairs(&board.layers);
    let mut status: Vec<ChangeStatus> = Vec::with_capacity(changes.len());
    let mut ghosts = Ghosts::default();
    let mut outline_changed = false;

    let mut comps: Vec<CompState> = board
        .components
        .iter()
        .map(|c| CompState {
            x: c.x,
            y: c.y,
            rot: c.rot,
            layer: c.layer.clone(),
            designator: None,
            comment: None,
            deleted: false,
            pad_nets: HashMap::new(),
            moved_by: None,
        })
        .collect();
    let comp_idx: HashMap<String, usize> = board.components.iter().enumerate().map(|(i, c)| (c.refdes.clone(), i)).collect();

    let mut por_id: HashMap<String, Vec<(Arr, usize)>> = HashMap::new();
    {
        let mut idx = |id: &str, a: Arr, i: usize| {
            if !id.is_empty() {
                por_id.entry(id.to_string()).or_default().push((a, i));
            }
        };
        for (i, o) in board.tracks.iter().enumerate() {
            idx(&o.id, Arr::Track, i);
        }
        for (i, o) in board.arcs.iter().enumerate() {
            idx(&o.id, Arr::Arc, i);
        }
        for (i, o) in board.vias.iter().enumerate() {
            idx(&o.id, Arr::Via, i);
        }
        for (i, o) in board.texts.iter().enumerate() {
            idx(&o.id, Arr::Text, i);
        }
        for (i, o) in board.silk.iter().enumerate() {
            idx(&o.id, Arr::Silk, i);
        }
        for (i, o) in board.lines.iter().enumerate() {
            idx(&o.id, Arr::Line, i);
        }
        for (i, o) in board.fills.iter().enumerate() {
            idx(&o.id, Arr::Fill, i);
        }
        for (i, o) in board.regions.iter().enumerate() {
            idx(&o.id, Arr::Region, i);
        }
        for (i, o) in board.cutouts.iter().enumerate() {
            idx(&o.id, Arr::Cutout, i);
        }
        for (i, o) in board.freepads.iter().enumerate() {
            idx(&o.id, Arr::FreePad, i);
        }
        for (i, o) in board.polygons.iter().enumerate() {
            idx(&o.id, Arr::Polygon, i);
        }
    }
    let find = |id: Option<&str>, arrs: &[Arr]| -> Vec<(Arr, usize)> {
        id.and_then(|id| por_id.get(id))
            .map(|v| v.iter().copied().filter(|(a, _)| arrs.contains(a)).collect())
            .unwrap_or_default()
    };

    let mut deleted: HashSet<(Arr, usize)> = HashSet::new();
    let mut touched: HashMap<(Arr, usize), usize> = HashMap::new();
    let mut net_set: HashSet<String> = board.nets.iter().cloned().collect();
    let mut net_ren: HashMap<String, String> = HashMap::new();
    let mut net_del: HashSet<String> = HashSet::new();
    let mut add_seq = 0usize;
    let mut nid = |tipo: &str, ch: &Value| {
        add_seq += 1;
        match s(ch, "uid").filter(|u| u.len() >= 2 && u.len() <= 16 && u.starts_with('u') && u[1..].chars().all(|c| c.is_ascii_alphanumeric())) {
            Some(u) => format!("new-{tipo}{u}"),
            None => format!("new-{tipo}{add_seq}"),
        }
    };

    'ops: for (idx, ch) in changes.iter().enumerate() {
        let op = s(ch, "op").unwrap_or("?").to_string();
        let mut st = ChangeStatus { idx, op: op.clone(), level: Level::Ok, msg: String::new(), note: s(ch, "note").unwrap_or("").to_string() };
        macro_rules! bad {
            ($($t:tt)*) => {{ st.level = Level::Err; st.msg = format!($($t)*); status.push(st); continue 'ops; }};
        }
        macro_rules! warn {
            ($($t:tt)*) => {{ if st.level != Level::Err { st.level = Level::Warn; } st.msg = format!($($t)*); }};
        }
        // orig_* x estado atual: confere -> segue; nao confere e uma op anterior mexeu -> erro
        macro_rules! conferir {
            ($ok:expr, $mexeu:expr) => {{
                if !$ok {
                    if let Some(k) = $mexeu {
                        bad!("orig_* não confere com o objeto depois da mudança #{} — junte as duas numa linha só", k + 1);
                    }
                    warn!("orig_* não confere com o board.js — espelho pode estar desatualizado");
                }
            }};
        }
        match op.as_str() {
            "comp_move" | "comp_del" => {
                let r = s(ch, "ref").unwrap_or("");
                let Some(&ci) = comp_idx.get(r) else { bad!("componente \"{r}\" não existe no board.js") };
                if comps[ci].deleted {
                    bad!("componente \"{r}\" já foi removido");
                }
                let (Some(ox), Some(oy), Some(orot), Some(olay)) = (num(ch, "orig_x"), num(ch, "orig_y"), num(ch, "orig_rot"), s(ch, "orig_layer")) else {
                    bad!("faltam orig_x/orig_y/orig_rot/orig_layer (copie do board.js)")
                };
                let c = &comps[ci];
                conferir!(near(ox, c.x) && near(oy, c.y) && near_ang(orot, c.rot) && olay == c.layer, c.moved_by);
                if op == "comp_del" {
                    comps[ci].deleted = true;
                } else {
                    let lay = s(ch, "layer").filter(|l| !l.is_empty());
                    if let Some(l) = lay {
                        if l != "Top" && l != "Bottom" {
                            bad!("layer \"{l}\" inválida para componente — use Top ou Bottom");
                        }
                    }
                    let c = &mut comps[ci];
                    if num(ch, "x").is_none() || num(ch, "y").is_none() {
                        warn!("sem x/y: o ApplyChanges leva o componente para 0 — escreva x e y");
                    }
                    if let Some(v) = num(ch, "x") {
                        c.x = v;
                    }
                    if let Some(v) = num(ch, "y") {
                        c.y = v;
                    }
                    if let Some(v) = num(ch, "rot") {
                        c.rot = v;
                    }
                    if let Some(l) = lay {
                        c.layer = l.to_string();
                    }
                    c.moved_by = Some(idx);
                }
            }
            "comp_attr" => {
                let r = s(ch, "ref").unwrap_or("");
                let Some(&ci) = comp_idx.get(r) else { bad!("componente \"{r}\" não existe no board.js") };
                let (Some(od), Some(oc)) = (s(ch, "orig_designator"), s(ch, "orig_comment")) else {
                    bad!("faltam orig_designator/orig_comment (copie do board.js)")
                };
                let src = &board.components[ci];
                let des = comps[ci].designator.clone().unwrap_or_else(|| src.refdes.clone());
                let com = comps[ci].comment.clone().unwrap_or_else(|| src.comment.clone());
                if od != des || oc != com {
                    warn!("orig_* não confere com o board.js — espelho pode estar desatualizado");
                }
                if let Some(n) = s(ch, "designator").filter(|n| !n.is_empty() && *n != des) {
                    let outro = comps.iter().enumerate().any(|(j, o)| {
                        j != ci && !o.deleted && o.designator.as_deref().unwrap_or(&board.components[j].refdes) == n
                    });
                    if outro {
                        bad!("designator \"{n}\" já é de outro componente — dois componentes com o mesmo nome");
                    }
                    comps[ci].designator = Some(n.to_string());
                }
                if let Some(c) = s(ch, "comment") {
                    comps[ci].comment = Some(c.to_string());
                }
            }
            "track_edit" | "track_del" => {
                let id = s(ch, "id");
                let cands = find(id, &[Arr::Track, Arr::Silk, Arr::Line]);
                let cands: Vec<_> = cands.into_iter().filter(|(a, i)| seg_ref(&eb, *a, *i).kind != "arc").collect();
                if cands.is_empty() {
                    bad!("trilha id \"{}\" não existe no board.js", id.unwrap_or(""));
                }
                let k = ["x1", "y1", "x2", "y2", "w"];
                if k.iter().any(|f| num(ch, &format!("orig_{f}")).is_none()) {
                    bad!("faltam campos orig_* (copie do board.js)");
                }
                let olay = s(ch, "orig_layer").unwrap_or("");
                let casa = |o: &Seg| {
                    let (a, b, c, d) = (num(ch, "orig_x1").unwrap(), num(ch, "orig_y1").unwrap(), num(ch, "orig_x2").unwrap(), num(ch, "orig_y2").unwrap());
                    ((near(a, o.x1) && near(b, o.y1) && near(c, o.x2) && near(d, o.y2))
                        || (near(a, o.x2) && near(b, o.y2) && near(c, o.x1) && near(d, o.y1)))
                        && near(num(ch, "orig_w").unwrap(), o.w)
                        && olay == o.layer
                };
                let key = pick(&cands, |a, i| casa(seg_ref(&eb, a, i)));
                let Some(key) = key else { bad!("trilha id \"{}\" aparece várias vezes e os orig_* não dizem qual", id.unwrap_or("")) };
                let o = seg_ref(&eb, key.0, key.1).clone();
                if !o.owner.is_empty() {
                    bad!("trilha id \"{}\" pertence ao componente {} (não é editável sozinha)", o.id, o.owner);
                }
                if deleted.contains(&key) {
                    bad!("trilha id \"{}\" já foi removida", o.id);
                }
                conferir!(casa(&o), touched.get(&key).copied());
                ghosts.removed_segs.push(([o.x1, o.y1], [o.x2, o.y2], o.w));
                if op == "track_del" {
                    deleted.insert(key);
                    touched.insert(key, idx);
                } else {
                    if let Some(l) = s(ch, "layer").filter(|l| !l.is_empty()) {
                        if let Some(e) = layer_err(Some(l), "trilha") {
                            bad!("{e}");
                        }
                    }
                    if num(ch, "w").map(|w| w <= 0.0).unwrap_or(false) {
                        bad!("largura w deve ser > 0");
                    }
                    ghosts.removed_segs.pop();
                    ghosts.edited_segs.push(([o.x1, o.y1], [o.x2, o.y2], o.w, o.layer.clone()));
                    let m = seg_mut(&mut eb, key.0, key.1);
                    if let Some(v) = num(ch, "x1") { m.x1 = v; }
                    if let Some(v) = num(ch, "y1") { m.y1 = v; }
                    if let Some(v) = num(ch, "x2") { m.x2 = v; }
                    if let Some(v) = num(ch, "y2") { m.y2 = v; }
                    if let Some(v) = num(ch, "w") { m.w = v; }
                    if let Some(l) = s(ch, "layer").filter(|l| !l.is_empty()) { m.layer = l.to_string(); }
                    if let Some(n) = s(ch, "net") {
                        if layers::is_copper(&m.layer) { m.net = n.to_string(); }
                    }
                    touched.insert(key, idx);
                }
            }
            "track_add" => {
                for k in ["x1", "y1", "x2", "y2", "w"] {
                    if num(ch, k).is_none() {
                        bad!("campo \"{k}\" ausente/inválido");
                    }
                }
                if let Some(e) = layer_err(s(ch, "layer"), "trilha") {
                    bad!("{e}");
                }
                if num(ch, "w").unwrap() <= 0.0 {
                    bad!("largura w deve ser > 0");
                }
                let layer = s(ch, "layer").unwrap().to_string();
                let mut net = s(ch, "net").unwrap_or("").to_string();
                if !layers::is_copper(&layer) && !net.is_empty() {
                    warn!("net \"{net}\" só vale em camada de cobre — ignorada");
                    net.clear();
                }
                let id = nid("t", ch);
                ghosts.added_ids.insert(id.clone());
                eb.tracks.push(Seg {
                    id,
                    layer,
                    x1: num(ch, "x1").unwrap(),
                    y1: num(ch, "y1").unwrap(),
                    x2: num(ch, "x2").unwrap(),
                    y2: num(ch, "y2").unwrap(),
                    w: num(ch, "w").unwrap(),
                    net,
                    ..Default::default()
                });
            }
            "arc_edit" | "arc_del" => {
                let id = s(ch, "id");
                let cands: Vec<_> = find(id, &[Arr::Arc, Arr::Silk, Arr::Line])
                    .into_iter()
                    .filter(|(a, i)| *a == Arr::Arc || seg_ref(&eb, *a, *i).kind == "arc")
                    .collect();
                if cands.is_empty() {
                    bad!("arco id \"{}\" não existe no board.js", id.unwrap_or(""));
                }
                if ["cx", "cy", "r", "sa", "ea"].iter().any(|f| num(ch, &format!("orig_{f}")).is_none()) {
                    bad!("faltam campos orig_*");
                }
                let olay = s(ch, "orig_layer").unwrap_or("");
                let casa = |o: &Seg| {
                    near(num(ch, "orig_cx").unwrap(), o.cx)
                        && near(num(ch, "orig_cy").unwrap(), o.cy)
                        && near(num(ch, "orig_r").unwrap(), o.r)
                        && near_ang(num(ch, "orig_sa").unwrap(), o.sa)
                        && near_ang(num(ch, "orig_ea").unwrap(), o.ea)
                        && olay == o.layer
                };
                let Some(key) = pick(&cands, |a, i| casa(seg_ref(&eb, a, i))) else { bad!("arco id ambíguo") };
                let o = seg_ref(&eb, key.0, key.1).clone();
                if !o.owner.is_empty() {
                    bad!("arco id \"{}\" pertence ao componente {} (não é editável sozinho)", o.id, o.owner);
                }
                if deleted.contains(&key) {
                    bad!("arco id \"{}\" já foi removido", o.id);
                }
                conferir!(casa(&o), touched.get(&key).copied());
                if op == "arc_del" {
                    for w in geom::arc_points(o.cx, o.cy, o.r, o.sa, o.ea, 0.01).windows(2) {
                        ghosts.removed_segs.push((w[0], w[1], o.w));
                    }
                    deleted.insert(key);
                } else {
                    if let Some(l) = s(ch, "layer").filter(|l| !l.is_empty()) {
                        if let Some(e) = layer_err(Some(l), "arco") {
                            bad!("{e}");
                        }
                    }
                    let m = seg_mut(&mut eb, key.0, key.1);
                    for (k, f) in [("cx", &mut m.cx), ("cy", &mut m.cy), ("r", &mut m.r), ("sa", &mut m.sa), ("ea", &mut m.ea), ("w", &mut m.w)] {
                        if let Some(v) = num(ch, k) {
                            *f = v;
                        }
                    }
                    if let Some(l) = s(ch, "layer").filter(|l| !l.is_empty()) {
                        m.layer = l.to_string();
                    }
                }
                touched.insert(key, idx);
            }
            "arc_add" => {
                for k in ["cx", "cy", "r", "sa", "ea", "w"] {
                    if num(ch, k).is_none() {
                        bad!("campo \"{k}\" ausente/inválido");
                    }
                }
                if let Some(e) = layer_err(s(ch, "layer"), "arco") {
                    bad!("{e}");
                }
                if num(ch, "r").unwrap() <= 0.0 || num(ch, "w").unwrap() <= 0.0 {
                    bad!("raio r e largura w devem ser > 0");
                }
                let layer = s(ch, "layer").unwrap().to_string();
                let net = if layers::is_copper(&layer) { s(ch, "net").unwrap_or("").to_string() } else { String::new() };
                let id = nid("a", ch);
                ghosts.added_ids.insert(id.clone());
                eb.arcs.push(Seg {
                    id,
                    layer,
                    cx: num(ch, "cx").unwrap(),
                    cy: num(ch, "cy").unwrap(),
                    r: num(ch, "r").unwrap(),
                    sa: num(ch, "sa").unwrap(),
                    ea: num(ch, "ea").unwrap(),
                    w: num(ch, "w").unwrap(),
                    net,
                    ..Default::default()
                });
            }
            "via_edit" | "via_del" => {
                let id = s(ch, "id");
                let cands = find(id, &[Arr::Via]);
                if cands.is_empty() {
                    bad!("via id \"{}\" não existe no board.js", id.unwrap_or(""));
                }
                let (Some(ox), Some(oy)) = (num(ch, "orig_x"), num(ch, "orig_y")) else { bad!("faltam orig_x/orig_y") };
                let Some(key) = pick(&cands, |_, i| near(ox, eb.vias[i].x) && near(oy, eb.vias[i].y)) else { bad!("via id ambígua") };
                if deleted.contains(&key) {
                    bad!("via id \"{}\" já foi removida", id.unwrap_or(""));
                }
                let v = eb.vias[key.1].clone();
                conferir!(near(ox, v.x) && near(oy, v.y), touched.get(&key).copied());
                ghosts.removed_vias.push(([v.x, v.y], v.size));
                if op == "via_del" {
                    deleted.insert(key);
                } else {
                    if num(ch, "size").map(|x| x <= 0.0).unwrap_or(false) || num(ch, "drill").map(|x| x <= 0.0).unwrap_or(false) {
                        bad!("size e drill devem ser > 0");
                    }
                    let m = &mut eb.vias[key.1];
                    if let Some(x) = num(ch, "x") { m.x = x; }
                    if let Some(x) = num(ch, "y") { m.y = x; }
                    if let Some(x) = num(ch, "size") { m.size = x; }
                    if let Some(x) = num(ch, "drill") { m.drill = x; }
                    if let (Some(f), Some(t)) = (s(ch, "from"), s(ch, "to")) {
                        m.from = f.to_string();
                        m.to = t.to_string();
                    }
                    if m.drill >= m.size {
                        warn!("drill >= size (anel nulo)");
                    }
                }
                touched.insert(key, idx);
            }
            "via_add" => {
                for k in ["x", "y", "size", "drill"] {
                    if num(ch, k).is_none() {
                        bad!("campo \"{k}\" ausente/inválido");
                    }
                }
                let (size, drill) = (num(ch, "size").unwrap(), num(ch, "drill").unwrap());
                if size <= 0.0 || drill <= 0.0 {
                    bad!("size e drill devem ser > 0");
                }
                if drill >= size {
                    warn!("drill >= size (anel nulo)");
                }
                let id = nid("v", ch);
                ghosts.added_ids.insert(id.clone());
                eb.vias.push(Via {
                    id,
                    x: num(ch, "x").unwrap(),
                    y: num(ch, "y").unwrap(),
                    size,
                    drill,
                    from: s(ch, "from").unwrap_or("Top").to_string(),
                    to: s(ch, "to").unwrap_or("Bottom").to_string(),
                    net: s(ch, "net").unwrap_or("").to_string(),
                    ..Default::default()
                });
            }
            "text_edit" | "text_del" | "designator_move" | "comment_move" => {
                let key = if op == "designator_move" || op == "comment_move" {
                    let r = s(ch, "ref").unwrap_or("");
                    let qual_des = op == "designator_move";
                    let found = eb
                        .texts
                        .iter()
                        .enumerate()
                        .find(|(i, t)| (if qual_des { t.designator } else { t.comment }) && t.owner == r && !deleted.contains(&(Arr::Text, *i)));
                    match found {
                        Some((i, _)) => (Arr::Text, i),
                        None => bad!("{} do componente \"{r}\" não existe no board.js", if qual_des { "designator" } else { "comment" }),
                    }
                } else {
                    let id = s(ch, "id");
                    let cands = find(id, &[Arr::Text]);
                    if cands.is_empty() {
                        bad!("texto id \"{}\" não existe no board.js", id.unwrap_or(""));
                    }
                    let (ox, oy) = (num(ch, "orig_x").unwrap_or(f64::NAN), num(ch, "orig_y").unwrap_or(f64::NAN));
                    match pick(&cands, |_, i| near(ox, eb.texts[i].x) && near(oy, eb.texts[i].y)) {
                        Some(k) => k,
                        None => bad!("texto id ambíguo"),
                    }
                };
                let t = eb.texts[key.1].clone();
                if (op == "text_edit" || op == "text_del") && (t.designator || t.comment) {
                    bad!("só textos livres podem ser editados (este pertence a um componente)");
                }
                if op == "text_del" && !t.owner.is_empty() {
                    bad!("texto id \"{}\" pertence ao componente {} (só textos livres podem ser removidos)", t.id, t.owner);
                }
                if deleted.contains(&key) {
                    bad!("texto id \"{}\" já foi removido", t.id);
                }
                let (Some(ox), Some(oy)) = (num(ch, "orig_x"), num(ch, "orig_y")) else { bad!("faltam orig_x/orig_y (copie do board.js)") };
                // onde o texto esta AGORA: o dono pode ja ter andado
                let dono = comp_idx.get(&t.owner).copied().filter(|&ci| comp_changed(&board.components[ci], &comps[ci]));
                let d = dono.map(|ci| comp_delta(&board.components[ci], &comps[ci]));
                let (ax, ay) = d.map(|d| d.pt(t.x, t.y)).unwrap_or((t.x, t.y));
                let mut ok = near(ox, ax) && near(oy, ay);
                if op == "text_edit" || op == "text_del" {
                    ok = ok && s(ch, "orig_text").map(|x| x == t.text).unwrap_or(false) && s(ch, "orig_layer").map(|x| x == t.layer).unwrap_or(false);
                }
                if !ok {
                    if let (Some(ci), Some(k)) = (dono, dono.and_then(|ci| comps[ci].moved_by)) {
                        if op == "designator_move" || op == "comment_move" {
                            bad!("o designator de {} já terá andado com o comp_move #{} — ponha este designator_move antes do comp_move", board.components[ci].refdes, k + 1);
                        }
                    }
                    if let Some(k) = touched.get(&key) {
                        bad!("orig_* não confere com o objeto depois da mudança #{}", k + 1);
                    }
                    warn!("orig_* não confere com o board.js — espelho pode estar desatualizado");
                }
                if op == "text_del" {
                    deleted.insert(key);
                    touched.insert(key, idx);
                } else {
                    if let Some(l) = s(ch, "layer").filter(|l| !l.is_empty()) {
                        if let Some(e) = layer_err(Some(l), "texto") {
                            bad!("{e}");
                        }
                    }
                    if num(ch, "h").map(|v| v <= 0.0).unwrap_or(false) || num(ch, "w").map(|v| v <= 0.0).unwrap_or(false) {
                        bad!("altura h e espessura w devem ser > 0");
                    }
                    let m = &mut eb.texts[key.1];
                    let forma_mudou = num(ch, "h").is_some() || num(ch, "w").is_some() || num(ch, "rot").is_some() || ch.get("mirror").is_some()
                        || s(ch, "text").map(|x| x != m.text).unwrap_or(false);
                    if let Some(x) = s(ch, "text") {
                        if op == "text_edit" {
                            m.text = x.to_string();
                        }
                    }
                    if let Some(v) = num(ch, "h") { m.h = v; }
                    if let Some(v) = num(ch, "w") { m.w = Some(v); }
                    // hidden (1.57.0): o Show Designator / Show Comment desligado
                    if op == "designator_move" || op == "comment_move" {
                        if let Some(h) = ch.get("hidden").and_then(|v| v.as_bool()) {
                            m.hidden = h;
                        }
                    }
                    let (nx, ny) = (num(ch, "x").unwrap_or(ax), num(ch, "y").unwrap_or(ay));
                    let (dx, dy) = (nx - ax, ny - ay);
                    let (px, py) = d.map(|d| d.pt_inv(nx, ny)).unwrap_or((nx, ny));
                    m.x = px;
                    m.y = py;
                    if let Some(r) = num(ch, "rot") {
                        m.rot = match d {
                            Some(d) if d.flip => d.phi + 180.0 - r,
                            Some(d) => r - d.dr,
                            None => r,
                        };
                    }
                    if let Some(l) = s(ch, "layer").filter(|l| !l.is_empty()) {
                        m.layer = match d {
                            Some(d) if d.flip => layers::flip(l, &pares),
                            _ => l.to_string(),
                        };
                    }
                    if let Some(mi) = ch.get("mirror").and_then(|v| v.as_bool()) {
                        m.mirror = match d {
                            Some(d) if d.flip => !mi,
                            _ => mi,
                        };
                    }
                    // o contorno exato (polys) anda com o texto; se o desenho mudou ele sai
                    if forma_mudou {
                        m.polys = None;
                        m.ax = None;
                        m.ay = None;
                    } else if dx != 0.0 || dy != 0.0 {
                        if let Some(ps) = &mut m.polys {
                            for q in ps.iter_mut() {
                                for p in q.pts.iter_mut() {
                                    p[0] = r6(p[0] + dx);
                                    p[1] = r6(p[1] + dy);
                                }
                            }
                        }
                        if let Some(v) = m.ax.as_mut() { *v = r6(*v + dx); }
                        if let Some(v) = m.ay.as_mut() { *v = r6(*v + dy); }
                    }
                    touched.insert(key, idx);
                }
            }
            "text_add" => {
                let txt = s(ch, "text").unwrap_or("");
                if txt.is_empty() {
                    bad!("campo \"text\" ausente/vazio");
                }
                for k in ["x", "y", "h"] {
                    if num(ch, k).is_none() {
                        bad!("campo \"{k}\" ausente/inválido");
                    }
                }
                if let Some(e) = layer_err(s(ch, "layer"), "texto") {
                    bad!("{e}");
                }
                let h = num(ch, "h").unwrap();
                if h <= 0.0 {
                    bad!("altura h deve ser > 0");
                }
                let id = nid("x", ch);
                ghosts.added_ids.insert(id.clone());
                eb.texts.push(Text {
                    id,
                    layer: s(ch, "layer").unwrap().to_string(),
                    x: num(ch, "x").unwrap(),
                    y: num(ch, "y").unwrap(),
                    text: txt.to_string(),
                    h,
                    w: Some(num(ch, "w").unwrap_or(h / 10.0)),
                    rot: num(ch, "rot").unwrap_or(0.0),
                    mirror: bool_(ch, "mirror"),
                    kind: Some("stroke".into()),
                    ..Default::default()
                });
            }
            "fill_edit" | "fill_del" => {
                let id = s(ch, "id");
                let cands = find(id, &[Arr::Fill]);
                if cands.is_empty() {
                    bad!("fill id \"{}\" não existe no board.js", id.unwrap_or(""));
                }
                if ["x1", "y1", "x2", "y2"].iter().any(|k| num(ch, &format!("orig_{k}")).is_none()) {
                    bad!("faltam campos orig_* (copie do board.js)");
                }
                let olay = s(ch, "orig_layer").unwrap_or("");
                let casa = |f: &Fill| {
                    let (a, b, c, d) = (num(ch, "orig_x1").unwrap(), num(ch, "orig_y1").unwrap(), num(ch, "orig_x2").unwrap(), num(ch, "orig_y2").unwrap());
                    near(a.min(c), f.x1.min(f.x2)) && near(a.max(c), f.x1.max(f.x2)) && near(b.min(d), f.y1.min(f.y2)) && near(b.max(d), f.y1.max(f.y2)) && olay == f.layer
                };
                let Some(key) = pick(&cands, |_, i| casa(&eb.fills[i])) else { bad!("fill id ambíguo") };
                let f = eb.fills[key.1].clone();
                if !f.owner.is_empty() {
                    bad!("fill id \"{}\" pertence ao componente {} (não é editável sozinho)", f.id, f.owner);
                }
                if deleted.contains(&key) {
                    bad!("fill id \"{}\" já foi removido", f.id);
                }
                conferir!(casa(&f), touched.get(&key).copied());
                if op == "fill_del" {
                    deleted.insert(key);
                } else {
                    let m = &mut eb.fills[key.1];
                    if let Some(v) = num(ch, "x1") { m.x1 = v; }
                    if let Some(v) = num(ch, "y1") { m.y1 = v; }
                    if let Some(v) = num(ch, "x2") { m.x2 = v; }
                    if let Some(v) = num(ch, "y2") { m.y2 = v; }
                    if let Some(v) = num(ch, "rot") { m.rot = v; }
                    if let Some(l) = s(ch, "layer").filter(|l| !l.is_empty()) { m.layer = l.to_string(); }
                    if near(m.x1, m.x2) || near(m.y1, m.y2) {
                        bad!("fill sem área (x1 = x2 ou y1 = y2)");
                    }
                    if let Some(n) = s(ch, "net") {
                        if layers::is_copper(&m.layer) { m.net = n.to_string(); }
                    }
                }
                touched.insert(key, idx);
            }
            "fill_add" => {
                for k in ["x1", "y1", "x2", "y2"] {
                    if num(ch, k).is_none() {
                        bad!("campo \"{k}\" ausente/inválido");
                    }
                }
                if let Some(e) = layer_err(s(ch, "layer"), "fill") {
                    bad!("{e}");
                }
                let (x1, y1, x2, y2) = (num(ch, "x1").unwrap(), num(ch, "y1").unwrap(), num(ch, "x2").unwrap(), num(ch, "y2").unwrap());
                if near(x1, x2) || near(y1, y2) {
                    bad!("fill sem área (x1 = x2 ou y1 = y2)");
                }
                let layer = s(ch, "layer").unwrap().to_string();
                let net = if layers::is_copper(&layer) { s(ch, "net").unwrap_or("").to_string() } else { String::new() };
                let id = nid("f", ch);
                ghosts.added_ids.insert(id.clone());
                eb.fills.push(Fill { id, layer, x1, y1, x2, y2, rot: num(ch, "rot").unwrap_or(0.0), net, ..Default::default() });
            }
            "region_add" => {
                let Some(p) = pts(ch, "pts").filter(|p| p.len() >= 3) else { bad!("pts deve ser [[x,y],...] com >= 3 vértices") };
                let corte = bool_(ch, "cutout");
                let sem_plano = !corte && bool_(ch, "polycut");
                let lay = s(ch, "layer");
                if sem_plano {
                    if lay != Some("Multi") && !lay.map(layers::is_copper).unwrap_or(false) {
                        bad!("recorte de polígono (polycut) só em camada de cobre ou na Multi (todas)");
                    }
                } else if !corte {
                    if let Some(e) = layer_err(lay, "região") {
                        bad!("{e}");
                    }
                }
                let id = nid(if corte { "k" } else if sem_plano { "q" } else { "g" }, ch);
                ghosts.added_ids.insert(id.clone());
                let mut r = Region { id, layer: lay.unwrap_or("Multi").to_string(), points: p, cutout: corte, polycut: sem_plano, ..Default::default() };
                if corte {
                    r.layer = "Multi".into();
                    eb.cutouts.push(r);
                } else {
                    if !sem_plano && layers::is_copper(&r.layer) {
                        r.net = s(ch, "net").unwrap_or("").to_string();
                    }
                    if sem_plano {
                        r.kindn = Some(1);
                        eb.cutouts.push(r);
                    } else {
                        eb.regions.push(r);
                    }
                }
            }
            "region_del" => {
                let id = s(ch, "id");
                // o recorte do board.js (Board Cutout, Polygon Pour Cutout) tambem sai (1.57.0)
                let cands = find(id, &[Arr::Region, Arr::Cutout]);
                if cands.is_empty() {
                    bad!("região id \"{}\" não existe no board.js", id.unwrap_or(""));
                }
                let (Some(olay), Some(on), Some(ox), Some(oy)) = (s(ch, "orig_layer"), num(ch, "orig_n"), num(ch, "orig_x0"), num(ch, "orig_y0")) else {
                    bad!("faltam orig_layer/orig_n/orig_x0/orig_y0 (copie do board.js)")
                };
                let casa = |g: &Region| {
                    let p0 = g.points.first().copied().unwrap_or([f64::NAN, f64::NAN]);
                    olay == g.layer && on as usize == g.points.len() && near(ox, p0[0]) && near(oy, p0[1])
                };
                let de = |k: (Arr, usize)| if k.0 == Arr::Cutout { &eb.cutouts[k.1] } else { &eb.regions[k.1] };
                let Some(key) = pick(&cands, |a, i| casa(de((a, i)))) else { bad!("região id ambígua") };
                let g = de(key);
                if !g.owner.is_empty() {
                    bad!("região id \"{}\" pertence ao componente {} (não é editável sozinha)", g.id, g.owner);
                }
                if g.keepout {
                    bad!("região id \"{}\" é keepout — fica só para desenho (remova no Altium)", g.id);
                }
                if deleted.contains(&key) {
                    bad!("região id \"{}\" já foi removida", g.id);
                }
                conferir!(casa(g), touched.get(&key).copied());
                deleted.insert(key);
                touched.insert(key, idx);
            }
            "outline_set" => {
                let raw: Option<Vec<Vec<f64>>> = ch
                    .get("pts")
                    .and_then(|v| v.as_array())
                    .map(|a| a.iter().filter_map(|p| p.as_array().map(|q| q.iter().filter_map(|x| x.as_f64()).collect())).collect());
                let Some(segs) = raw.as_deref().and_then(geom::pts_to_outline) else {
                    bad!("pts deve ser [[x,y],...] com >= 3 vértices (ou [x,y,bulge])")
                };
                eb.board.outline = segs;
                outline_changed = true;
            }
            "pad_net" => {
                let r = s(ch, "ref").unwrap_or("");
                let Some(&ci) = comp_idx.get(r) else { bad!("componente \"{r}\" não existe no board.js") };
                let Some(pad) = s(ch, "pad").filter(|p| !p.is_empty()) else { bad!("campo \"pad\" ausente (o nome do pad = o número do pino)") };
                let Some(net) = s(ch, "net") else { bad!("campo \"net\" ausente (\"\" tira o pad da net)") };
                let Some(on) = s(ch, "orig_net") else { bad!("falta orig_net (a net atual do pad, copie do board.js; \"\" = sem net)") };
                let Some(p0) = board.components[ci].pads.iter().find(|p| p.name == pad) else { bad!("pad \"{pad}\" não existe em {r}") };
                let atual = comps[ci].pad_nets.get(pad).cloned().unwrap_or_else(|| p0.net.clone());
                if on != atual && net_ren.get(&atual).map(|x| x != on).unwrap_or(true) {
                    warn!("orig_net não confere com o board.js — espelho pode estar desatualizado");
                }
                if !net.is_empty() && !net_set.contains(net) {
                    warn!("net \"{net}\" não existe na placa — crie com net_add antes");
                }
                comps[ci].pad_nets.insert(pad.to_string(), net.to_string());
            }
            "net_add" => {
                let Some(n) = s(ch, "net").filter(|n| !n.is_empty()) else { bad!("campo \"net\" ausente") };
                if net_set.contains(n) {
                    bad!("net \"{n}\" já existe na placa");
                }
                net_set.insert(n.to_string());
                net_del.remove(n);
                eb.nets.push(n.to_string());
            }
            "net_del" => {
                let Some(n) = s(ch, "net").filter(|n| !n.is_empty()) else { bad!("campo \"net\" ausente") };
                if !net_set.remove(n) {
                    bad!("net \"{n}\" não existe na placa");
                }
                eb.nets.retain(|x| x != n);
                net_del.insert(n.to_string());
            }
            "net_rename" => {
                let (Some(n), Some(o)) = (s(ch, "net").filter(|n| !n.is_empty()), s(ch, "orig_net").filter(|n| !n.is_empty())) else {
                    bad!("campos \"net\" e \"orig_net\" são obrigatórios")
                };
                if !net_set.contains(o) {
                    bad!("net \"{o}\" não existe na placa");
                }
                if n == o {
                    bad!("nome novo igual ao atual");
                }
                if net_set.contains(n) {
                    bad!("net \"{n}\" já existe — duas nets com o mesmo nome");
                }
                net_set.remove(o);
                net_set.insert(n.to_string());
                for x in eb.nets.iter_mut() {
                    if x == o {
                        *x = n.to_string();
                    }
                }
                for v in net_ren.values_mut() {
                    if v == o {
                        *v = n.to_string();
                    }
                }
                net_ren.insert(o.to_string(), n.to_string());
            }
            "pad_add" | "pad_edit" | "pad_del" => {
                let key = if op == "pad_add" {
                    None
                } else {
                    let id = s(ch, "id");
                    let cands = find(id, &[Arr::FreePad]);
                    if cands.is_empty() {
                        bad!("pad id \"{}\" não existe no board.js (freepads) — pad de componente: para a net use pad_net", id.unwrap_or(""));
                    }
                    let (Some(ox), Some(oy)) = (num(ch, "orig_x"), num(ch, "orig_y")) else { bad!("faltam orig_x/orig_y") };
                    let Some(k) = pick(&cands, |_, i| near(ox, eb.freepads[i].x) && near(oy, eb.freepads[i].y)) else { bad!("pad id ambíguo") };
                    if deleted.contains(&k) {
                        bad!("pad já foi removido");
                    }
                    conferir!(near(ox, eb.freepads[k.1].x) && near(oy, eb.freepads[k.1].y), touched.get(&k).copied());
                    Some(k)
                };
                if op == "pad_del" {
                    let k = key.unwrap();
                    deleted.insert(k);
                    touched.insert(k, idx);
                    status.push(st);
                    continue;
                }
                let mut p = key.map(|k| eb.freepads[k.1].clone()).unwrap_or_else(|| Pad {
                    layer: "Multi".into(),
                    kind: "th".into(),
                    shape: "circle".into(),
                    w: 1.524,
                    h: 1.524,
                    drill: Some(0.762),
                    name: "1".into(),
                    ..Default::default()
                });
                if let Some(v) = num(ch, "x") { p.x = v; }
                if let Some(v) = num(ch, "y") { p.y = v; }
                if let Some(v) = num(ch, "w") { p.w = v; }
                if let Some(v) = num(ch, "h") { p.h = v; }
                if let Some(v) = num(ch, "rot") { p.rot = v; }
                if let Some(v) = num(ch, "drill") { p.drill = Some(v); }
                if let Some(v) = num(ch, "radius") { p.radius = Some(v); }
                if let Some(v) = s(ch, "shape") { p.shape = v.to_string(); }
                if let Some(v) = s(ch, "name") { p.name = v.to_string(); }
                if let Some(v) = s(ch, "net") { p.net = v.to_string(); }
                if let Some(v) = s(ch, "layer").filter(|l| !l.is_empty()) {
                    p.layer = v.to_string();
                    p.kind = if v == "Multi" { "th".into() } else { "smd".into() };
                }
                if key.is_none() && (num(ch, "x").is_none() || num(ch, "y").is_none()) {
                    bad!("campos \"x\" e \"y\" são obrigatórios");
                }
                if !(p.w > 0.0 && p.h > 0.0) {
                    bad!("w e h devem ser > 0");
                }
                match key {
                    Some(k) => {
                        eb.freepads[k.1] = p;
                        touched.insert(k, idx);
                    }
                    None => {
                        p.id = nid("p", ch);
                        ghosts.added_ids.insert(p.id.clone());
                        eb.freepads.push(p);
                    }
                }
            }
            "poly_add" | "poly_edit" | "poly_del" => {
                let key = if op == "poly_add" {
                    None
                } else {
                    let id = s(ch, "id");
                    let cands = find(id, &[Arr::Polygon]);
                    let added = eb.polygons.iter().position(|p| Some(p.id.as_str()) == id && p.id.starts_with("new-"));
                    match (cands.first().copied(), added) {
                        (Some(k), _) => Some(k),
                        (None, Some(i)) => Some((Arr::Polygon, i)),
                        _ => bad!("polígono id \"{}\" não existe (board.js » polygons)", id.unwrap_or("")),
                    }
                };
                if op == "poly_del" {
                    let k = key.unwrap();
                    deleted.insert(k);
                    touched.insert(k, idx);
                    status.push(st);
                    continue;
                }
                let mut p = key.map(|k| eb.polygons[k.1].clone()).unwrap_or_default();
                if let Some(v) = pts(ch, "pts") { p.pts = v; }
                if let Some(v) = s(ch, "layer").filter(|l| !l.is_empty()) { p.layer = v.to_string(); }
                if let Some(v) = s(ch, "net") { p.net = v.to_string(); }
                if let Some(v) = s(ch, "nome") { p.nome = v.to_string(); }
                if p.pts.len() < 3 {
                    bad!("pts deve ter >= 3 vértices");
                }
                if !layers::is_copper(&p.layer) {
                    bad!("polígono só em camada de cobre");
                }
                if p.nome.is_empty() {
                    p.nome = format!("{}-{}", layers::name_of(&p.layer), if p.net.is_empty() { "No Net" } else { &p.net });
                }
                warn!("o despejo do polígono (pour) ainda não foi portado para o Rust: a tela mostra só o contorno");
                match key {
                    Some(k) => {
                        eb.polygons[k.1] = p;
                        touched.insert(k, idx);
                    }
                    None => {
                        p.id = nid("pg", ch);
                        ghosts.added_ids.insert(p.id.clone());
                        eb.polygons.push(p);
                    }
                }
            }
            "comp_add" => {
                let r = s(ch, "ref").unwrap_or("");
                let fp = s(ch, "footprint").unwrap_or("");
                if r.is_empty() || fp.is_empty() {
                    bad!("campos \"ref\" e \"footprint\" são obrigatórios");
                }
                let (Some(x), Some(y)) = (num(ch, "x"), num(ch, "y")) else { bad!("campos \"x\" e \"y\" são obrigatórios") };
                if comp_idx.contains_key(r) && !comps[comp_idx[r]].deleted {
                    bad!("componente \"{r}\" já existe na placa — para trocar o footprint, comp_del antes");
                }
                // a geometria vem de um componente da placa com o mesmo footprint (a pcblib da
                // casa ainda nao foi portada)
                let Some(modelo) = board.components.iter().find(|c| c.footprint == fp) else {
                    bad!("footprint \"{fp}\" não encontrado na placa (a biblioteca de footprints ainda não foi portada para o Rust)")
                };
                let lado = if s(ch, "layer") == Some("Bottom") { "Bottom" } else { "Top" };
                let rot = norm_ang(num(ch, "rot").unwrap_or(0.0));
                let d = Delta::new((modelo.x, modelo.y, modelo.rot, &modelo.layer), (x, y, rot, lado));
                let nets: HashMap<String, String> = s(ch, "nets")
                    .map(|t| t.split(';').filter_map(|kv| kv.split_once('=')).map(|(k, v)| (k.trim().to_string(), v.trim().to_string())).collect())
                    .unwrap_or_default();
                let cid = nid("c", ch);
                let mut c = Component {
                    id: cid.clone(),
                    refdes: r.to_string(),
                    footprint: fp.to_string(),
                    comment: s(ch, "comment").unwrap_or("").to_string(),
                    layer: lado.into(),
                    x,
                    y,
                    rot,
                    bbox: modelo.bbox.as_ref().map(|b| xf_box(&d, b)),
                    pads: modelo.pads.iter().map(|p| xf_pad(&d, p, &pares)).collect(),
                };
                for p in c.pads.iter_mut() {
                    p.net = nets.get(&p.name).cloned().unwrap_or_default();
                    p.id = format!("{cid}p{}", p.name);
                }
                for sk in board.silk.iter().filter(|sk| sk.owner == modelo.refdes) {
                    let mut o = sk.clone();
                    let arc = o.kind == "arc";
                    xf_seg(&d, &mut o, arc, &pares);
                    o.owner = r.to_string();
                    eb.silk.push(o);
                }
                for t in board.texts.iter().filter(|t| t.owner == modelo.refdes && t.designator) {
                    let mut o = t.clone();
                    xf_text(&d, &mut o, &pares);
                    o.owner = r.to_string();
                    o.text = r.to_string();
                    o.polys = None;
                    o.hidden = bool_(ch, "des_hidden");
                    eb.texts.push(o);
                }
                ghosts.added_ids.insert(cid);
                eb.components.push(c);
                warn!("geometria copiada de {} (mesmo footprint na placa)", modelo.refdes);
            }
            "stack_set" => {}
            _ => bad!("operação desconhecida \"{op}\""),
        }
        status.push(st);
    }

    // ---- a placa efetiva: componentes movidos levam pads, caixa e tudo o que e deles ----
    let mut deltas: HashMap<String, Delta> = HashMap::new();
    let mut ren: HashMap<String, String> = HashMap::new();
    let mut mortos: HashSet<String> = HashSet::new();
    for (i, src) in board.components.iter().enumerate() {
        let st = &comps[i];
        if st.deleted {
            mortos.insert(src.refdes.clone());
            continue;
        }
        if comp_changed(src, st) {
            let d = comp_delta(src, st);
            deltas.insert(src.refdes.clone(), d);
            ghosts.moved.push((src.bbox.clone().unwrap_or(BBox::EMPTY), [src.x, src.y], [st.x, st.y], src.layer.clone()));
            let c = &mut eb.components[i];
            c.x = st.x;
            c.y = st.y;
            c.rot = norm_ang(st.rot);
            c.layer = st.layer.clone();
            if let Some(b) = &src.bbox {
                c.bbox = Some(xf_box(&d, b));
            }
            c.pads = src.pads.iter().map(|p| xf_pad(&d, p, &pares)).collect();
        }
        let c = &mut eb.components[i];
        if let Some(n) = st.designator.as_ref().filter(|n| **n != src.refdes) {
            ren.insert(src.refdes.clone(), n.clone());
            c.refdes = n.clone();
        }
        if let Some(cm) = &st.comment {
            c.comment = cm.clone();
        }
        for p in c.pads.iter_mut() {
            if let Some(n) = st.pad_nets.get(&p.name) {
                p.net = n.clone();
            }
        }
    }

    // removidos (de tras para frente, para os indices valerem)
    let mut del: Vec<(Arr, usize)> = deleted.into_iter().collect();
    del.sort_by(|a, b| b.1.cmp(&a.1));
    for (a, i) in del {
        match a {
            Arr::Track => drop(eb.tracks.remove(i)),
            Arr::Arc => drop(eb.arcs.remove(i)),
            Arr::Via => drop(eb.vias.remove(i)),
            Arr::Text => drop(eb.texts.remove(i)),
            Arr::Silk => drop(eb.silk.remove(i)),
            Arr::Line => drop(eb.lines.remove(i)),
            Arr::Fill => drop(eb.fills.remove(i)),
            Arr::Region => drop(eb.regions.remove(i)),
            Arr::Cutout => drop(eb.cutouts.remove(i)),
            Arr::FreePad => drop(eb.freepads.remove(i)),
            Arr::Polygon => drop(eb.polygons.remove(i)),
        }
    }
    if !mortos.is_empty() {
        let vivo = |o: &str| !mortos.contains(o);
        eb.components.retain(|c| !mortos.contains(&c.refdes) || ren.values().any(|n| *n == c.refdes));
        eb.silk.retain(|o| vivo(&o.owner));
        eb.lines.retain(|o| vivo(&o.owner));
        eb.tracks.retain(|o| vivo(&o.owner));
        eb.arcs.retain(|o| vivo(&o.owner));
        eb.texts.retain(|o| vivo(&o.owner));
        eb.fills.retain(|o| vivo(&o.owner));
        eb.regions.retain(|o| vivo(&o.owner));
        eb.cutouts.retain(|o| vivo(&o.owner));
    }

    if !deltas.is_empty() {
        for (list, arc_list) in [(&mut eb.tracks, false), (&mut eb.arcs, true)] {
            for o in list.iter_mut() {
                if let Some(d) = deltas.get(&o.owner) {
                    xf_seg(d, o, arc_list, &pares);
                }
            }
        }
        for list in [&mut eb.silk, &mut eb.lines] {
            for o in list.iter_mut() {
                if let Some(d) = deltas.get(&o.owner) {
                    let a = o.kind == "arc";
                    xf_seg(d, o, a, &pares);
                }
            }
        }
        for t in eb.texts.iter_mut() {
            if let Some(d) = deltas.get(&t.owner) {
                xf_text(d, t, &pares);
            }
        }
        for f in eb.fills.iter_mut() {
            if let Some(d) = deltas.get(&f.owner) {
                let (hw, hh) = ((f.x2 - f.x1) / 2.0, (f.y2 - f.y1) / 2.0);
                let (qx, qy) = d.pt((f.x1 + f.x2) / 2.0, (f.y1 + f.y2) / 2.0);
                f.x1 = r6(qx - hw);
                f.x2 = r6(qx + hw);
                f.y1 = r6(qy - hh);
                f.y2 = r6(qy + hh);
                f.rot = norm_ang(d.angle(f.rot));
                if d.flip {
                    f.layer = layers::flip(&f.layer, &pares);
                }
            }
        }
        for list in [&mut eb.regions, &mut eb.cutouts] {
            for g in list.iter_mut() {
                if let Some(d) = deltas.get(&g.owner) {
                    g.points = g.points.iter().map(|p| d.pt6(*p)).collect();
                    g.holes = g.holes.iter().map(|h| h.iter().map(|p| d.pt6(*p)).collect()).collect();
                    if d.flip {
                        g.layer = layers::flip(&g.layer, &pares);
                    }
                }
            }
        }
    }

    // designator/comment com o texto efetivo, e o owner renomeado acompanha
    for t in eb.texts.iter_mut() {
        if let Some(&ci) = comp_idx.get(&t.owner) {
            let st = &comps[ci];
            if t.designator {
                if let Some(n) = &st.designator {
                    if *n != t.text {
                        t.text = n.clone();
                        t.polys = None;
                    }
                }
            }
            if t.comment {
                if let Some(c) = &st.comment {
                    if *c != t.text {
                        t.text = c.clone();
                        t.polys = None;
                    }
                }
            }
        }
    }
    if !ren.is_empty() {
        let dono = |o: &mut String| {
            if let Some(n) = ren.get(o.as_str()) {
                *o = n.clone();
            }
        };
        eb.silk.iter_mut().for_each(|o| dono(&mut o.owner));
        eb.lines.iter_mut().for_each(|o| dono(&mut o.owner));
        eb.tracks.iter_mut().for_each(|o| dono(&mut o.owner));
        eb.arcs.iter_mut().for_each(|o| dono(&mut o.owner));
        eb.texts.iter_mut().for_each(|o| dono(&mut o.owner));
        eb.fills.iter_mut().for_each(|o| dono(&mut o.owner));
        eb.regions.iter_mut().for_each(|o| dono(&mut o.owner));
    }

    // trilha/arco que mudou de camada vai para o array da camada efetiva
    reclassify(&mut eb);

    // nets renomeadas/removidas valem em todos os objetos
    if !net_ren.is_empty() || !net_del.is_empty() {
        let agora = |n: &mut String| {
            let mut x = n.clone();
            for _ in 0..64 {
                match net_ren.get(&x) {
                    Some(y) if !net_set.contains(&x) => x = y.clone(),
                    _ => break,
                }
            }
            if net_del.contains(&x) && !net_set.contains(&x) {
                x.clear();
            }
            *n = x;
        };
        for c in eb.components.iter_mut() {
            c.pads.iter_mut().for_each(|p| agora(&mut p.net));
        }
        eb.freepads.iter_mut().for_each(|p| agora(&mut p.net));
        eb.tracks.iter_mut().for_each(|o| agora(&mut o.net));
        eb.arcs.iter_mut().for_each(|o| agora(&mut o.net));
        eb.vias.iter_mut().for_each(|o| agora(&mut o.net));
        eb.fills.iter_mut().for_each(|o| agora(&mut o.net));
        eb.regions.iter_mut().for_each(|o| agora(&mut o.net));
        eb.polygons.iter_mut().for_each(|o| agora(&mut o.net));
    }

    Applied { board: eb, status, ghosts, outline_changed }
}

/// Entre varios objetos com o mesmo id, o unico que casa com os orig_*; com um so, ele.
fn pick(cands: &[(Arr, usize)], casa: impl Fn(Arr, usize) -> bool) -> Option<(Arr, usize)> {
    if cands.len() == 1 {
        return Some(cands[0]);
    }
    let c: Vec<_> = cands.iter().copied().filter(|(a, i)| casa(*a, *i)).collect();
    if c.len() == 1 {
        Some(c[0])
    } else {
        None
    }
}

fn seg_ref(eb: &Board, a: Arr, i: usize) -> &Seg {
    match a {
        Arr::Track => &eb.tracks[i],
        Arr::Arc => &eb.arcs[i],
        Arr::Silk => &eb.silk[i],
        _ => &eb.lines[i],
    }
}
fn seg_mut(eb: &mut Board, a: Arr, i: usize) -> &mut Seg {
    match a {
        Arr::Track => &mut eb.tracks[i],
        Arr::Arc => &mut eb.arcs[i],
        Arr::Silk => &mut eb.silk[i],
        _ => &mut eb.lines[i],
    }
}

fn comp_changed(src: &Component, st: &CompState) -> bool {
    !(near(st.x, src.x) && near(st.y, src.y) && near_ang(st.rot, src.rot) && st.layer == src.layer)
}
fn comp_delta(src: &Component, st: &CompState) -> Delta {
    Delta::new((src.x, src.y, src.rot, &src.layer), (st.x, st.y, st.rot, &st.layer))
}

fn xf_box(d: &Delta, b: &BBox) -> BBox {
    let mut o = BBox::EMPTY;
    for (x, y) in [(b.x1, b.y1), (b.x2, b.y1), (b.x2, b.y2), (b.x1, b.y2)] {
        let (px, py) = d.pt(x, y);
        o.add(r6(px), r6(py));
    }
    o
}

fn xf_pad(d: &Delta, p: &Pad, pares: &HashMap<String, String>) -> Pad {
    let mut o = p.clone();
    let (x, y) = d.pt(p.x, p.y);
    o.x = r6(x);
    o.y = r6(y);
    o.rot = norm_ang(d.angle(p.rot));
    if d.flip {
        o.layer = layers::flip(&p.layer, pares);
        if let Some(bw) = p.bw {
            o.bw = Some(p.w);
            o.w = bw;
        }
        if let Some(bh) = p.bh {
            o.bh = Some(p.h);
            o.h = bh;
        }
        if let Some(bs) = &p.bshape {
            o.bshape = Some(p.shape.clone());
            o.shape = bs.clone();
        }
        if let Some(b) = &p.bot {
            let mut nb = b.clone();
            if let Some(w) = b.w {
                nb.w = Some(o.w);
                o.w = w;
            }
            if let Some(h) = b.h {
                nb.h = Some(o.h);
                o.h = h;
            }
            if let Some(sh) = &b.shape {
                nb.shape = Some(o.shape.clone());
                o.shape = sh.clone();
            }
            if let Some(r) = b.radius {
                nb.radius = o.radius;
                o.radius = Some(r);
            }
            o.bot = Some(nb);
        }
        std::mem::swap(&mut o.tent_top, &mut o.tent_bot);
        if let Some(h) = p.holerot {
            o.holerot = Some(norm_ang(-h));
        }
        if let Some(h) = p.hoy {
            o.hoy = Some(if h == 0.0 { 0.0 } else { -h });
        }
    }
    o
}

fn xf_seg(d: &Delta, o: &mut Seg, is_arc: bool, pares: &HashMap<String, String>) {
    if is_arc {
        let (cx, cy) = d.pt(o.cx, o.cy);
        let full = o.is_full_circle();
        let (sa, ea) = if d.flip { (d.phi - o.ea, d.phi - o.sa) } else { (o.sa + d.dr, o.ea + d.dr) };
        o.cx = r6(cx);
        o.cy = r6(cy);
        if full {
            o.sa = 0.0;
            o.ea = 360.0;
        } else {
            o.sa = norm_ang(sa);
            o.ea = norm_ang(ea);
        }
    } else {
        let (x1, y1) = d.pt(o.x1, o.y1);
        let (x2, y2) = d.pt(o.x2, o.y2);
        o.x1 = r6(x1);
        o.y1 = r6(y1);
        o.x2 = r6(x2);
        o.y2 = r6(y2);
    }
    if d.flip {
        o.layer = layers::flip(&o.layer, pares);
    }
}

fn xf_text(d: &Delta, o: &mut Text, pares: &HashMap<String, String>) {
    let (x, y) = d.pt(o.x, o.y);
    o.x = r6(x);
    o.y = r6(y);
    if let (Some(ax), Some(ay)) = (o.ax, o.ay) {
        let (qx, qy) = d.pt(ax, ay);
        o.ax = Some(r6(qx));
        o.ay = Some(r6(qy));
    }
    if let Some(ps) = &mut o.polys {
        for q in ps.iter_mut() {
            q.pts = q.pts.iter().map(|p| d.pt6(*p)).collect();
        }
    }
    o.rot = norm_ang(if d.flip { d.phi + 180.0 - o.rot } else { o.rot + d.dr });
    if d.flip {
        o.mirror = !o.mirror;
        o.layer = layers::flip(&o.layer, pares);
    }
}

fn reclassify(eb: &mut Board) {
    let mut mover: Vec<Seg> = Vec::new();
    for list in [&mut eb.tracks, &mut eb.arcs] {
        let mut i = 0;
        while i < list.len() {
            if !layers::is_copper(&list[i].layer) && layers::by_key(&list[i].layer).is_some() {
                mover.push(list.remove(i));
            } else {
                i += 1;
            }
        }
    }
    let arcs_in_tracks = std::mem::take(&mut mover);
    for mut o in arcs_in_tracks {
        let is_arc = o.r > 0.0 && (o.x1 == 0.0 && o.x2 == 0.0 && o.y1 == 0.0 && o.y2 == 0.0);
        o.kind = if is_arc { "arc".into() } else { "line".into() };
        o.net.clear();
        if layers::by_key(&o.layer).map(|l| l.kind == layers::Kind::Overlay).unwrap_or(false) {
            eb.silk.push(o);
        } else {
            eb.lines.push(o);
        }
    }
    for list in [&mut eb.silk, &mut eb.lines] {
        let mut i = 0;
        while i < list.len() {
            if layers::is_copper(&list[i].layer) {
                mover.push(list.remove(i));
            } else {
                i += 1;
            }
        }
    }
    for mut o in mover {
        let is_arc = o.kind == "arc";
        o.kind.clear();
        if is_arc {
            eb.arcs.push(o);
        } else {
            eb.tracks.push(o);
        }
    }
}
