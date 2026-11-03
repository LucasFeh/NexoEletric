//! Fonte vetorial (stroke) da serigrafia, como geometria pura -- a HubFont do hub-font.js
//! (dados do InteractiveHtmlBom, MIT). Saida em coordenadas locais centradas em x, Y para cima.

use std::collections::HashMap;
use std::sync::OnceLock;

struct Glyph {
    strokes: Vec<Vec<[f64; 2]>>,
    w: f64,
}

const MISS_W: f64 = 0.9;
const MISS_X: f64 = 0.15;
const MISS_BOX: f64 = 0.6;
const SPACE_W: f64 = 0.5;

fn font() -> &'static HashMap<char, Glyph> {
    static F: OnceLock<HashMap<char, Glyph>> = OnceLock::new();
    F.get_or_init(|| {
        let v: serde_json::Value = serde_json::from_str(include_str!("font.json")).expect("font.json");
        let mut m = HashMap::new();
        for (k, g) in v.as_object().unwrap() {
            let Some(c) = k.chars().next() else { continue };
            let w = g["w"].as_f64().unwrap_or(1.0);
            let strokes = g["l"]
                .as_array()
                .map(|ls| {
                    ls.iter()
                        .map(|l| {
                            l.as_array()
                                .unwrap()
                                .iter()
                                .map(|p| [p[0].as_f64().unwrap_or(0.0), p[1].as_f64().unwrap_or(0.0)])
                                .collect()
                        })
                        .collect()
                })
                .unwrap_or_default();
            m.insert(c, Glyph { strokes, w });
        }
        m
    })
}

fn glyph(c: char) -> Option<&'static Glyph> {
    let f = font();
    f.get(&c).or_else(|| c.to_uppercase().next().and_then(|u| f.get(&u)))
}

pub fn text_width(txt: &str, h: f64) -> f64 {
    txt.chars()
        .map(|c| {
            if c == ' ' {
                SPACE_W * h
            } else {
                glyph(c).map(|g| g.w).unwrap_or(MISS_W) * h
            }
        })
        .sum()
}

/// Polilinhas do texto em coordenadas locais (centrado em x, Y para cima).
pub fn text_polylines(txt: &str, h: f64) -> Vec<Vec<[f64; 2]>> {
    let mut out = Vec::new();
    let mut cx = -text_width(txt, h) / 2.0;
    let base_y = -h * 0.5;
    for c in txt.chars() {
        if c == ' ' {
            cx += SPACE_W * h;
            continue;
        }
        match glyph(c) {
            None => {
                let (x0, x1, y0, y1) = (cx + MISS_X * h, cx + MISS_X * h + MISS_BOX * h, base_y, base_y + h);
                out.push(vec![[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]);
                cx += MISS_W * h;
            }
            Some(g) => {
                for s in &g.strokes {
                    out.push(s.iter().map(|p| [cx + p[0] * h, base_y - p[1] * h]).collect());
                }
                cx += g.w * h;
            }
        }
    }
    out
}

pub const TRACO_TEXTO: f64 = 0.15;
pub const TT_ALTURA: f64 = 0.52;
pub const TT_TRACO: f64 = 0.12;
pub const PASSO_LINHA: f64 = 1.765;
pub const BASE_HUBFONT: f64 = 0.047619;

/// A geometria de um texto da placa: tracos (polilinhas no mundo) e a largura do traco.
pub struct TextGeom {
    pub lines: Vec<Vec<[f64; 2]>>,
    pub w: f64,
    pub frame: [[f64; 2]; 4],
}

pub fn text_geom(t: &crate::model::Text) -> Option<TextGeom> {
    if t.hidden || t.text.trim().is_empty() || !(t.h > 0.0) {
        return None;
    }
    let tipo = t.kind.as_deref().or(t.font.as_deref().filter(|f| matches!(*f, "stroke" | "truetype" | "barcode")));
    let (h, w) = if tipo == Some("truetype") {
        (t.h * TT_ALTURA, t.h * TT_TRACO)
    } else {
        (t.h, t.w.filter(|w| *w > 0.0).unwrap_or(t.h * TRACO_TEXTO))
    };
    let rot = t.rot;
    let esp = if t.mirror { -1.0 } else { 1.0 };
    let mut out = Vec::new();
    let poe = |out: &mut Vec<Vec<[f64; 2]>>, loc: &[[f64; 2]], ox: f64, oy: f64| {
        out.push(
            loc.iter()
                .map(|q| {
                    let (gx, gy) = crate::geom::rotate(q[0] * esp, q[1], rot);
                    [ox + gx, oy + gy]
                })
                .collect(),
        );
    };
    let mut linhas: Vec<&str> = t.text.split(['\n']).map(|l| l.trim_end_matches('\r')).collect();
    while linhas.len() > 1 && linhas.last().map(|l| l.trim().is_empty()).unwrap_or(false) {
        linhas.pop();
    }
    let caixa: [f64; 4];
    let (ox, oy);
    if linhas.len() == 1 {
        for p in text_polylines(linhas[0], h) {
            poe(&mut out, &p, t.x, t.y);
        }
        let ww = text_width(linhas[0], h);
        caixa = [-ww / 2.0 - w / 2.0, -h / 2.0 - w / 2.0, ww / 2.0 + w / 2.0, h / 2.0 + w / 2.0];
        ox = t.x;
        oy = t.y;
    } else {
        let n = linhas.len() as f64;
        let passo = h * PASSO_LINHA;
        let larg: Vec<f64> = linhas.iter().map(|l| text_width(l, h)).collect();
        let wmax = larg.iter().cloned().fold(0.0, f64::max);
        let mut ancora = t.ax.is_some() && t.ay.is_some();
        if ancora {
            let (qx, qy) = crate::geom::rotate(t.x - t.ax.unwrap(), t.y - t.ay.unwrap(), -rot);
            let (lx, ly) = (qx * esp, qy);
            if lx < -h || lx > wmax + w + h || ly < -h || ly > (n - 1.0) * passo + h + w + h {
                ancora = false;
            }
        }
        ox = if ancora { t.ax.unwrap() } else { t.x };
        oy = if ancora { t.ay.unwrap() } else { t.y };
        for (i, l) in linhas.iter().enumerate() {
            if l.trim().is_empty() {
                continue;
            }
            let fi = i as f64;
            let dx = if ancora { larg[i] / 2.0 + w } else { larg[i] / 2.0 - wmax / 2.0 };
            let dy = if ancora {
                h / 2.0 - BASE_HUBFONT * h + w + (n - 1.0 - fi) * passo
            } else {
                ((n - 1.0) / 2.0 - fi) * passo
            };
            for p in text_polylines(l, h) {
                let moved: Vec<[f64; 2]> = p.iter().map(|q| [q[0] + dx, q[1] + dy]).collect();
                poe(&mut out, &moved, ox, oy);
            }
        }
        caixa = if ancora {
            [0.0, 0.0, wmax + 2.0 * w, (n - 1.0) * passo + h + 2.0 * w]
        } else {
            let a = wmax / 2.0 + w / 2.0;
            let b = (n - 1.0) / 2.0 * passo + h / 2.0 + w / 2.0;
            [-a, -b, a, b]
        };
    }
    let cs = [[caixa[0], caixa[1]], [caixa[2], caixa[1]], [caixa[2], caixa[3]], [caixa[0], caixa[3]]];
    let frame = cs.map(|q| {
        let (gx, gy) = crate::geom::rotate(q[0] * esp, q[1], rot);
        [ox + gx, oy + gy]
    });
    Some(TextGeom { lines: out, w, frame })
}
