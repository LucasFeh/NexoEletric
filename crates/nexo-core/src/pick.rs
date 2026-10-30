//! Selecao e hover: indice espacial (grade uniforme) sobre a placa efetiva e o teste de ponto
//! de cada tipo de objeto. A busca olha so as celulas em volta do cursor.

use crate::font;
use crate::geom::{self, dist_point_seg, point_in_poly};
use crate::layers;
use crate::model::*;
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ItemRef {
    Comp(usize),
    Pad(usize, usize),
    FreePad(usize),
    Via(usize),
    Track(usize),
    Arc(usize),
    Silk(usize),
    Line(usize),
    Fill(usize),
    Region(usize),
    Text(usize),
}

struct Entry {
    item: ItemRef,
    bb: BBox,
    layer: String,
}

pub struct PickIndex {
    cell: f64,
    origin: (f64, f64),
    grid: HashMap<(i32, i32), Vec<u32>>,
    entries: Vec<Entry>,
}

fn seg_bb(a: [f64; 2], b: [f64; 2], w: f64) -> BBox {
    let mut bb = BBox::EMPTY;
    bb.add(a[0], a[1]);
    bb.add(b[0], b[1]);
    bb.grow(w / 2.0);
    bb
}

impl PickIndex {
    pub fn build(eb: &Board) -> PickIndex {
        let mut entries = Vec::new();
        let mut push = |item, bb: BBox, layer: &str| {
            if bb.valid() {
                entries.push(Entry { item, bb, layer: layer.to_string() });
            }
        };
        for (ci, c) in eb.components.iter().enumerate() {
            if let Some(b) = &c.bbox {
                push(ItemRef::Comp(ci), b.clone(), &c.layer);
            }
            for (pi, p) in c.pads.iter().enumerate() {
                let r = p.w.max(p.h) * 0.75;
                push(ItemRef::Pad(ci, pi), BBox { x1: p.x - r, y1: p.y - r, x2: p.x + r, y2: p.y + r }, &p.layer);
            }
        }
        for (i, p) in eb.freepads.iter().enumerate() {
            let r = p.w.max(p.h) * 0.75;
            push(ItemRef::FreePad(i), BBox { x1: p.x - r, y1: p.y - r, x2: p.x + r, y2: p.y + r }, &p.layer);
        }
        for (i, v) in eb.vias.iter().enumerate() {
            let r = v.size / 2.0;
            push(ItemRef::Via(i), BBox { x1: v.x - r, y1: v.y - r, x2: v.x + r, y2: v.y + r }, "Multi");
        }
        let arc_bb = |o: &Seg| {
            let mut bb = BBox::EMPTY;
            for p in geom::arc_points(o.cx, o.cy, o.r, o.sa, if o.is_full_circle() { o.sa + 360.0 } else { o.ea }, 0.05) {
                bb.add(p[0], p[1]);
            }
            bb.grow(o.w / 2.0);
            bb
        };
        for (i, o) in eb.tracks.iter().enumerate() {
            push(ItemRef::Track(i), seg_bb([o.x1, o.y1], [o.x2, o.y2], o.w), &o.layer);
        }
        for (i, o) in eb.arcs.iter().enumerate() {
            push(ItemRef::Arc(i), arc_bb(o), &o.layer);
        }
        for (i, o) in eb.silk.iter().enumerate() {
            let bb = if o.kind == "arc" { arc_bb(o) } else { seg_bb([o.x1, o.y1], [o.x2, o.y2], o.w) };
            push(ItemRef::Silk(i), bb, &o.layer);
        }
        for (i, o) in eb.lines.iter().enumerate() {
            let bb = if o.kind == "arc" { arc_bb(o) } else { seg_bb([o.x1, o.y1], [o.x2, o.y2], o.w) };
            push(ItemRef::Line(i), bb, &o.layer);
        }
        for (i, f) in eb.fills.iter().enumerate() {
            let mut bb = BBox::EMPTY;
            let (cx, cy) = ((f.x1 + f.x2) / 2.0, (f.y1 + f.y2) / 2.0);
            for p in geom::rect_corners(cx, cy, (f.x2 - f.x1).abs(), (f.y2 - f.y1).abs(), f.rot) {
                bb.add(p[0], p[1]);
            }
            push(ItemRef::Fill(i), bb, &f.layer);
        }
        for (i, g) in eb.regions.iter().enumerate() {
            let mut bb = BBox::EMPTY;
            for p in &g.points {
                bb.add(p[0], p[1]);
            }
            push(ItemRef::Region(i), bb, &g.layer);
        }
        for (i, t) in eb.texts.iter().enumerate() {
            if let Some(g) = font::text_geom(t) {
                let mut bb = BBox::EMPTY;
                for p in g.frame {
                    bb.add(p[0], p[1]);
                }
                push(ItemRef::Text(i), bb, &t.layer);
            }
        }
        let ext = eb.extents();
        let area = ((ext.x2 - ext.x1) * (ext.y2 - ext.y1)).max(1.0);
        let cell = (area / (entries.len().max(1) as f64)).sqrt().clamp(0.5, 10.0) * 2.0;
        let origin = (ext.x1, ext.y1);
        let mut grid: HashMap<(i32, i32), Vec<u32>> = HashMap::new();
        for (k, e) in entries.iter().enumerate() {
            let (i0, j0) = (((e.bb.x1 - origin.0) / cell).floor() as i32, ((e.bb.y1 - origin.1) / cell).floor() as i32);
            let (i1, j1) = (((e.bb.x2 - origin.0) / cell).floor() as i32, ((e.bb.y2 - origin.1) / cell).floor() as i32);
            if (i1 - i0) as i64 * (j1 - j0) as i64 > 40_000 {
                continue;
            }
            for i in i0..=i1 {
                for j in j0..=j1 {
                    grid.entry((i, j)).or_default().push(k as u32);
                }
            }
        }
        PickIndex { cell, origin, grid, entries }
    }

    /// O objeto sob o ponto: a camada atual primeiro, o menor depois; `visible` diz se a camada
    /// esta a vista. `tol` = folga em mm (alguns pixels).
    pub fn pick(&self, eb: &Board, x: f64, y: f64, tol: f64, current: &str, visible: &dyn Fn(&str) -> bool) -> Option<ItemRef> {
        let key = (((x - self.origin.0) / self.cell).floor() as i32, ((y - self.origin.1) / self.cell).floor() as i32);
        let list = self.grid.get(&key)?;
        let mut best: Option<(i32, f64, ItemRef)> = None;
        for &k in list {
            let e = &self.entries[k as usize];
            if !e.bb.contains(x, y) && !{
                let mut b = e.bb.clone();
                b.grow(tol);
                b.contains(x, y)
            } {
                continue;
            }
            let lay_vis = match e.item {
                ItemRef::Comp(_) => true,
                ItemRef::Pad(..) | ItemRef::FreePad(_) if e.layer == "Multi" => true,
                ItemRef::Via(_) => visible("Multi"),
                _ => visible(&e.layer),
            };
            if !lay_vis || !hit(eb, e.item, x, y, tol) {
                continue;
            }
            // prioridade: pad/via > objeto da camada atual > outros > componente
            let pri = match e.item {
                ItemRef::Pad(..) | ItemRef::FreePad(_) | ItemRef::Via(_) => 0,
                ItemRef::Comp(_) => 4,
                ItemRef::Region(_) | ItemRef::Fill(_) => 3,
                _ if e.layer == current => 1,
                _ => 2,
            };
            let area = (e.bb.x2 - e.bb.x1) * (e.bb.y2 - e.bb.y1);
            if best.as_ref().map(|b| (pri, area) < (b.0, b.1)).unwrap_or(true) {
                best = Some((pri, area, e.item));
            }
        }
        best.map(|b| b.2)
    }
}

fn hit(eb: &Board, it: ItemRef, x: f64, y: f64, tol: f64) -> bool {
    let pad_hit = |p: &Pad| {
        let (cx, cy) = p.copper_center();
        let (lx, ly) = geom::rotate(x - cx, y - cy, -p.rot);
        lx.abs() <= p.w / 2.0 + tol && ly.abs() <= p.h / 2.0 + tol
    };
    let seg_hit = |o: &Seg, arc: bool| {
        let w = o.w.max(0.0) / 2.0 + tol;
        if arc {
            let d = ((x - o.cx).powi(2) + (y - o.cy).powi(2)).sqrt();
            if (d - o.r).abs() > w {
                return false;
            }
            if o.is_full_circle() {
                return true;
            }
            let a = (y - o.cy).atan2(x - o.cx).to_degrees().rem_euclid(360.0);
            let sa = o.sa.rem_euclid(360.0);
            let sw = (o.ea - o.sa).rem_euclid(360.0);
            (a - sa).rem_euclid(360.0) <= sw
        } else {
            dist_point_seg(x, y, o.x1, o.y1, o.x2, o.y2) <= w
        }
    };
    match it {
        ItemRef::Comp(c) => eb.components[c].bbox.as_ref().map(|b| b.contains(x, y)).unwrap_or(false),
        ItemRef::Pad(c, i) => pad_hit(&eb.components[c].pads[i]),
        ItemRef::FreePad(i) => pad_hit(&eb.freepads[i]),
        ItemRef::Via(i) => {
            let v = &eb.vias[i];
            ((x - v.x).powi(2) + (y - v.y).powi(2)).sqrt() <= v.size / 2.0 + tol
        }
        ItemRef::Track(i) => seg_hit(&eb.tracks[i], false),
        ItemRef::Arc(i) => seg_hit(&eb.arcs[i], true),
        ItemRef::Silk(i) => seg_hit(&eb.silk[i], eb.silk[i].kind == "arc"),
        ItemRef::Line(i) => seg_hit(&eb.lines[i], eb.lines[i].kind == "arc"),
        ItemRef::Fill(i) => {
            let f = &eb.fills[i];
            let (cx, cy) = ((f.x1 + f.x2) / 2.0, (f.y1 + f.y2) / 2.0);
            point_in_poly(x, y, &geom::rect_corners(cx, cy, (f.x2 - f.x1).abs(), (f.y2 - f.y1).abs(), f.rot))
        }
        ItemRef::Region(i) => {
            let g = &eb.regions[i];
            point_in_poly(x, y, &g.points) && !g.holes.iter().any(|h| point_in_poly(x, y, h))
        }
        ItemRef::Text(i) => font::text_geom(&eb.texts[i]).map(|g| point_in_poly(x, y, &g.frame)).unwrap_or(false),
    }
}

/// A net do objeto (para o realce de net), se ele for de cobre.
pub fn net_of(eb: &Board, it: ItemRef) -> Option<String> {
    let n = match it {
        ItemRef::Pad(c, i) => eb.components[c].pads[i].net.clone(),
        ItemRef::FreePad(i) => eb.freepads[i].net.clone(),
        ItemRef::Via(i) => eb.vias[i].net.clone(),
        ItemRef::Track(i) => eb.tracks[i].net.clone(),
        ItemRef::Arc(i) => eb.arcs[i].net.clone(),
        ItemRef::Fill(i) => eb.fills[i].net.clone(),
        ItemRef::Region(i) => eb.regions[i].net.clone(),
        _ => String::new(),
    };
    Some(n).filter(|n| !n.is_empty())
}

/// Titulo e propriedades do objeto, como o painel Properties do Altium mostra.
pub fn describe(eb: &Board, it: ItemRef) -> (String, Vec<(String, String)>) {
    let f = |v: f64| format!("{:.4} mm", v);
    let a = |v: f64| format!("{:.2}°", v);
    let lay = |k: &str| format!("{} ({k})", layers::name_of(k));
    let mut p: Vec<(String, String)> = Vec::new();
    let mut kv = |k: &str, v: String| p.push((k.to_string(), v));
    let title = match it {
        ItemRef::Comp(c) => {
            let o = &eb.components[c];
            kv("Designator", o.refdes.clone());
            kv("Comment", o.comment.clone());
            kv("Footprint", o.footprint.clone());
            kv("Layer", lay(&o.layer));
            kv("X", f(o.x));
            kv("Y", f(o.y));
            kv("Rotation", a(o.rot));
            kv("Pads", o.pads.len().to_string());
            format!("Componente {}", o.refdes)
        }
        ItemRef::Pad(..) | ItemRef::FreePad(_) => {
            let (o, dono) = match it {
                ItemRef::Pad(c, i) => (&eb.components[c].pads[i], eb.components[c].refdes.clone()),
                ItemRef::FreePad(i) => (&eb.freepads[i], String::new()),
                _ => unreachable!(),
            };
            if !dono.is_empty() {
                kv("Componente", dono.clone());
            }
            kv("Designator", o.name.clone());
            kv("Net", if o.net.is_empty() { "No Net".into() } else { o.net.clone() });
            kv("Layer", lay(&o.layer));
            kv("Tipo", if o.is_th() { "Passante".into() } else { "SMD".into() });
            kv("Forma", o.shape.clone());
            kv("X", f(o.x));
            kv("Y", f(o.y));
            kv("Tamanho", format!("{:.4} x {:.4} mm", o.w, o.h));
            kv("Rotation", a(o.rot));
            if let Some(d) = o.drill {
                kv("Furo", f(d));
            }
            if dono.is_empty() {
                format!("Pad {}", o.name)
            } else {
                format!("Pad {}-{}", dono, o.name)
            }
        }
        ItemRef::Via(i) => {
            let o = &eb.vias[i];
            kv("Net", if o.net.is_empty() { "No Net".into() } else { o.net.clone() });
            kv("X", f(o.x));
            kv("Y", f(o.y));
            kv("Diâmetro", f(o.size));
            kv("Furo", f(o.drill));
            kv("De / até", format!("{} → {}", o.from, o.to));
            "Via".into()
        }
        ItemRef::Track(i) | ItemRef::Silk(i) | ItemRef::Line(i) | ItemRef::Arc(i) => {
            let o = match it {
                ItemRef::Track(_) => &eb.tracks[i],
                ItemRef::Silk(_) => &eb.silk[i],
                ItemRef::Line(_) => &eb.lines[i],
                _ => &eb.arcs[i],
            };
            let arc = matches!(it, ItemRef::Arc(_)) || o.kind == "arc";
            kv("Layer", lay(&o.layer));
            if layers::is_copper(&o.layer) {
                kv("Net", if o.net.is_empty() { "No Net".into() } else { o.net.clone() });
            }
            kv("Largura", f(o.w));
            if arc {
                kv("Centro", format!("{:.4}, {:.4}", o.cx, o.cy));
                kv("Raio", f(o.r));
                kv("Ângulos", format!("{:.2}° → {:.2}°", o.sa, o.ea));
            } else {
                kv("Início", format!("{:.4}, {:.4}", o.x1, o.y1));
                kv("Fim", format!("{:.4}, {:.4}", o.x2, o.y2));
                kv("Comprimento", f(((o.x2 - o.x1).powi(2) + (o.y2 - o.y1).powi(2)).sqrt()));
            }
            if !o.owner.is_empty() {
                kv("Componente", o.owner.clone());
            }
            kv("Id", o.id.clone());
            if arc { "Arco".into() } else if layers::is_copper(&o.layer) { "Trilha".into() } else { "Linha".into() }
        }
        ItemRef::Fill(i) => {
            let o = &eb.fills[i];
            kv("Layer", lay(&o.layer));
            kv("Net", o.net.clone());
            kv("Canto 1", format!("{:.4}, {:.4}", o.x1, o.y1));
            kv("Canto 2", format!("{:.4}, {:.4}", o.x2, o.y2));
            kv("Rotation", a(o.rot));
            "Fill".into()
        }
        ItemRef::Region(i) => {
            let o = &eb.regions[i];
            kv("Layer", lay(&o.layer));
            kv("Net", o.net.clone());
            kv("Vértices", o.points.len().to_string());
            kv("Furos", o.holes.len().to_string());
            if !o.owner.is_empty() {
                kv("Componente", o.owner.clone());
            }
            "Região".into()
        }
        ItemRef::Text(i) => {
            let o = &eb.texts[i];
            kv("Texto", o.text.clone());
            kv("Layer", lay(&o.layer));
            kv("X", f(o.x));
            kv("Y", f(o.y));
            kv("Altura", f(o.h));
            kv("Rotation", a(o.rot));
            if !o.owner.is_empty() {
                kv("Componente", o.owner.clone());
            }
            "Texto".into()
        }
    };
    (title, p)
}
