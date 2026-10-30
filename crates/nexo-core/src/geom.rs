//! Geometria plana: rotacao, formas de pad, arcos, contorno da placa e testes de ponto.

use crate::model::{Board, OutlineSeg};
use std::f64::consts::PI;

pub const RAD: f64 = PI / 180.0;

/// Seno/cosseno exatos nos multiplos de 90 (sem o 6e-17 do cos).
pub fn cos_sin(deg: f64) -> (f64, f64) {
    let a = deg.rem_euclid(360.0);
    for (k, c, s) in [(0.0, 1.0, 0.0), (90.0, 0.0, 1.0), (180.0, -1.0, 0.0), (270.0, 0.0, -1.0), (360.0, 1.0, 0.0)] {
        if (a - k).abs() < 1e-12 {
            return (c, s);
        }
    }
    let r = a * RAD;
    (r.cos(), r.sin())
}

pub fn rotate(x: f64, y: f64, deg: f64) -> (f64, f64) {
    let (c, s) = cos_sin(deg);
    (x * c - y * s, x * s + y * c)
}

pub fn r6(v: f64) -> f64 {
    let x = (v * 1e6).round() / 1e6;
    if x == 0.0 {
        0.0
    } else {
        x
    }
}

pub fn norm_ang(a: f64) -> f64 {
    let v = r6(a.rem_euclid(360.0));
    if v >= 360.0 {
        0.0
    } else {
        v
    }
}

/// Pontos de um arco (sa..ea anti-horario), com passo pelo erro de corda `tol`.
pub fn arc_points(cx: f64, cy: f64, r: f64, sa: f64, ea: f64, tol: f64) -> Vec<[f64; 2]> {
    let full = (ea - sa).abs() >= 359.999;
    let mut sweep = if full { 360.0 } else { (ea - sa).rem_euclid(360.0) };
    if sweep == 0.0 && !full && ea != sa {
        sweep = 360.0;
    }
    let step = if r > tol { 2.0 * (1.0 - tol / r).clamp(-1.0, 1.0).acos() / RAD } else { 45.0 };
    let n = ((sweep / step.max(1.0)).ceil() as usize).clamp(2, 256);
    (0..=n)
        .map(|i| {
            let a = (sa + sweep * i as f64 / n as f64) * RAD;
            [cx + r * a.cos(), cy + r * a.sin()]
        })
        .collect()
}

/// Os cantos de um retangulo W x H girado em torno do centro.
pub fn rect_corners(cx: f64, cy: f64, w: f64, h: f64, rot: f64) -> Vec<[f64; 2]> {
    let (hw, hh) = (w / 2.0, h / 2.0);
    [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]
        .iter()
        .map(|q| {
            let (x, y) = rotate(q[0], q[1], rot);
            [cx + x, cy + y]
        })
        .collect()
}

/// Retangulo de cantos arredondados (raio r) como poligono convexo.
pub fn roundrect(cx: f64, cy: f64, hw: f64, hh: f64, rot: f64, r: f64) -> Vec<[f64; 2]> {
    let r = r.min(hw).min(hh).max(0.0);
    let mut pts = Vec::with_capacity(40);
    let seg = 8;
    for (qx, qy, a0) in [(hw - r, hh - r, 0.0), (-hw + r, hh - r, 90.0), (-hw + r, -hh + r, 180.0), (hw - r, -hh + r, 270.0)] {
        for i in 0..=seg {
            let a = (a0 + 90.0 * i as f64 / seg as f64) * RAD;
            let (x, y) = rotate(qx + r * a.cos(), qy + r * a.sin(), rot);
            pts.push([cx + x, cy + y]);
        }
    }
    pts
}

/// A forma de um pad como primitiva: capsula (oval/circulo) ou poligono convexo.
pub enum Shape {
    /// segmento p0..p1 com largura w (circulo = p0 == p1)
    Capsule([f64; 2], [f64; 2], f64),
    Convex(Vec<[f64; 2]>),
}

pub fn pad_shape(cx: f64, cy: f64, w: f64, h: f64, rot: f64, shape: &str, radius: Option<f64>) -> Option<Shape> {
    if !(w > 0.0) || !(h > 0.0) || !cx.is_finite() || !cy.is_finite() {
        return None;
    }
    let s = shape.to_ascii_lowercase();
    let (hw, hh) = (w / 2.0, h / 2.0);
    match s.as_str() {
        "circle" | "round" | "oval" | "oblong" | "obround" => {
            let d = w.min(h);
            let half = (w.max(h) - d) / 2.0;
            let (ax, ay) = if w >= h { rotate(half, 0.0, rot) } else { rotate(0.0, half, rot) };
            Some(Shape::Capsule([cx - ax, cy - ay], [cx + ax, cy + ay], d))
        }
        "roundrect" => {
            let r = radius.unwrap_or(w.min(h) / 8.0).min(hw.min(hh));
            if r > 0.0 {
                Some(Shape::Convex(roundrect(cx, cy, hw, hh, rot, r)))
            } else {
                Some(Shape::Convex(rect_corners(cx, cy, w, h, rot)))
            }
        }
        "octagon" => {
            let c = hw.min(hh) * 0.4142;
            let l = [[-hw + c, -hh], [hw - c, -hh], [hw, -hh + c], [hw, hh - c], [hw - c, hh], [-hw + c, hh], [-hw, hh - c], [-hw, -hh + c]];
            Some(Shape::Convex(
                l.iter()
                    .map(|q| {
                        let (x, y) = rotate(q[0], q[1], rot);
                        [cx + x, cy + y]
                    })
                    .collect(),
            ))
        }
        _ => Some(Shape::Convex(rect_corners(cx, cy, w, h, rot))),
    }
}

/// Os trechos do contorno encadeados em lacos fechados (o maior e a placa); sem contorno, o bbox.
pub fn outline_loops(b: &Board, outline: &[OutlineSeg]) -> Vec<Vec<[f64; 2]>> {
    let mut segs: Vec<Vec<[f64; 2]>> = Vec::new();
    for s in outline {
        if s.kind == "arc" {
            if s.r > 0.0 {
                segs.push(arc_points(s.cx, s.cy, s.r, s.sa, s.ea, 0.01));
            }
        } else {
            segs.push(vec![[s.x1, s.y1], [s.x2, s.y2]]);
        }
    }
    let loops: Vec<Vec<[f64; 2]>> = chain(segs).into_iter().filter(|l| l.len() >= 3).collect();
    if !loops.is_empty() {
        return loops;
    }
    let bb = b.extents();
    vec![vec![[bb.x1, bb.y1], [bb.x2, bb.y1], [bb.x2, bb.y2], [bb.x1, bb.y2]]]
}

/// Encadeia polilinhas abertas pelas pontas (tolerancia 1 um) -- o chainSegments do hub-laser.
pub fn chain(mut segs: Vec<Vec<[f64; 2]>>) -> Vec<Vec<[f64; 2]>> {
    const TOL: f64 = 0.002;
    let near = |a: [f64; 2], b: [f64; 2]| (a[0] - b[0]).abs() <= TOL && (a[1] - b[1]).abs() <= TOL;
    let mut out = Vec::new();
    while let Some(mut cur) = segs.pop() {
        loop {
            let end = *cur.last().unwrap();
            let start = cur[0];
            if cur.len() > 2 && near(start, end) {
                break;
            }
            let mut found = false;
            for i in 0..segs.len() {
                let s = &segs[i];
                let (a, z) = (s[0], *s.last().unwrap());
                if near(end, a) {
                    let s = segs.swap_remove(i);
                    cur.extend_from_slice(&s[1..]);
                    found = true;
                    break;
                } else if near(end, z) {
                    let mut s = segs.swap_remove(i);
                    s.reverse();
                    cur.extend_from_slice(&s[1..]);
                    found = true;
                    break;
                } else if near(start, z) {
                    let s = segs.swap_remove(i);
                    let mut n = s;
                    n.extend_from_slice(&cur[1..]);
                    cur = n;
                    found = true;
                    break;
                } else if near(start, a) {
                    let mut s = segs.swap_remove(i);
                    s.reverse();
                    s.extend_from_slice(&cur[1..]);
                    cur = s;
                    found = true;
                    break;
                }
            }
            if !found {
                break;
            }
        }
        if cur.len() > 2 && near(cur[0], *cur.last().unwrap()) {
            cur.pop();
        }
        out.push(cur);
    }
    out
}

pub fn point_in_poly(x: f64, y: f64, pts: &[[f64; 2]]) -> bool {
    let mut inside = false;
    let n = pts.len();
    if n < 3 {
        return false;
    }
    let mut j = n - 1;
    for i in 0..n {
        let (xi, yi) = (pts[i][0], pts[i][1]);
        let (xj, yj) = (pts[j][0], pts[j][1]);
        if (yi > y) != (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi {
            inside = !inside;
        }
        j = i;
    }
    inside
}

pub fn dist_point_seg(px: f64, py: f64, ax: f64, ay: f64, bx: f64, by: f64) -> f64 {
    let (dx, dy) = (bx - ax, by - ay);
    let l2 = dx * dx + dy * dy;
    let t = if l2 > 0.0 { (((px - ax) * dx + (py - ay) * dy) / l2).clamp(0.0, 1.0) } else { 0.0 };
    let (qx, qy) = (ax + t * dx, ay + t * dy);
    ((px - qx).powi(2) + (py - qy).powi(2)).sqrt()
}

/// Pontos com bulge ([x,y] ou [x,y,b]) em trechos de contorno -- o ptsToOutline do hub-core:
/// o vertice com b != 0 comeca um arco ate o proximo (b = tan(angulo/4), positivo anti-horario).
pub fn pts_to_outline(pts: &[Vec<f64>]) -> Option<Vec<OutlineSeg>> {
    if pts.len() < 2 || pts.iter().any(|p| p.len() < 2 || !p[0].is_finite() || !p[1].is_finite()) {
        return None;
    }
    let n = pts.len();
    let mut out = Vec::new();
    for i in 0..n {
        let (a, z) = (&pts[i], &pts[(i + 1) % n]);
        let b = a.get(2).copied().unwrap_or(0.0);
        if b.abs() < 1e-12 {
            out.push(OutlineSeg { kind: "line".into(), x1: a[0], y1: a[1], x2: z[0], y2: z[1], ..Default::default() });
            continue;
        }
        let theta = 4.0 * b.atan();
        let (dx, dy) = (z[0] - a[0], z[1] - a[1]);
        let chord = (dx * dx + dy * dy).sqrt();
        if chord < 1e-9 {
            continue;
        }
        let r = chord / (2.0 * (theta / 2.0).sin()).abs();
        let (mx, my) = ((a[0] + z[0]) / 2.0, (a[1] + z[1]) / 2.0);
        let d = (r * r - chord * chord / 4.0).max(0.0).sqrt();
        let (nx, ny) = (-dy / chord, dx / chord);
        let sgn = if (b > 0.0) == (theta.abs() < PI) { 1.0 } else { -1.0 };
        let (cx, cy) = (mx + nx * d * sgn, my + ny * d * sgn);
        let a0 = (a[1] - cy).atan2(a[0] - cx) / RAD;
        let a1 = (z[1] - cy).atan2(z[0] - cx) / RAD;
        let (sa, ea) = if b > 0.0 { (a0, a1) } else { (a1, a0) };
        out.push(OutlineSeg { kind: "arc".into(), cx, cy, r, sa: norm_ang(sa), ea: norm_ang(ea), ..Default::default() });
    }
    Some(out)
}
