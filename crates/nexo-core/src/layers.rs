//! A tabela de camadas do Altium (a mesma do hub-core.js: chave, nome, tipo, lado, par e cor).
//! Cores: as medidas nos Gerbers da casa; o que a medida nao cobre tem paleta propria.

use std::collections::HashMap;
use std::sync::OnceLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Signal,
    Plane,
    Mech,
    Overlay,
    Paste,
    Solder,
    Drill,
    KeepOut,
    Multi,
}

#[derive(Debug, Clone)]
pub struct LayerDef {
    pub key: String,
    pub name: String,
    pub kind: Kind,
    pub pair: Option<String>,
    pub color: [u8; 3],
    pub order: usize,
}

impl LayerDef {
    pub fn is_copper(&self) -> bool {
        matches!(self.kind, Kind::Signal | Kind::Plane)
    }
}

pub fn hex(s: &str) -> [u8; 3] {
    let s = s.trim_start_matches('#');
    let p = |i: usize| u8::from_str_radix(s.get(i..i + 2).unwrap_or("88"), 16).unwrap_or(0x88);
    if s.len() == 3 {
        let q = |i: usize| u8::from_str_radix(&s[i..i + 1].repeat(2), 16).unwrap_or(0x88);
        return [q(0), q(1), q(2)];
    }
    [p(0), p(2), p(4)]
}

fn hsl(h: f64, s: f64, l: f64) -> [u8; 3] {
    let (s, l) = (s / 100.0, l / 100.0);
    let a = s * l.min(1.0 - l);
    let f = |n: f64| {
        let k = (n + h / 30.0) % 12.0;
        l - a * (-1f64).max((k - 3.0).min(9.0 - k).min(1.0))
    };
    let x = |v: f64| (v * 255.0).round().clamp(0.0, 255.0) as u8;
    [x(f(0.0)), x(f(8.0)), x(f(4.0))]
}

const MECH_CORES: [&str; 15] = [
    "#00ffff", "#ff8000", "#80ff00", "#00ff80", "#0080ff", "#8000ff", "#ff0080", "#00c0c0", "#c08000", "#80c000",
    "#00c060", "#4060ff", "#c060ff", "#ff6060", "#60ffc0",
];

fn medida(key: &str) -> Option<&'static str> {
    match key {
        "Mid1" => Some("#bc8e00"),
        "Mid2" => Some("#70dbfa"),
        "Mech1" | "Mech13" => Some("#ff00ff"),
        "Mech15" => Some("#008000"),
        _ => None,
    }
}

pub fn table() -> &'static [LayerDef] {
    static T: OnceLock<Vec<LayerDef>> = OnceLock::new();
    T.get_or_init(|| {
        let mut l: Vec<LayerDef> = Vec::new();
        let mut add = |key: String, name: String, kind: Kind, pair: Option<&str>, color: [u8; 3]| {
            let order = l.len();
            l.push(LayerDef { key, name, kind, pair: pair.map(String::from), color, order });
        };
        add("Top".into(), "Top Layer".into(), Kind::Signal, Some("Bottom"), hex("#ff0000"));
        for i in 1..=30 {
            let k = format!("Mid{i}");
            let c = medida(&k).map(hex).unwrap_or_else(|| {
                hsl((30.0 + (i - 1) as f64 * 137.508) % 360.0, 90.0, if i % 2 == 1 { 60.0 } else { 48.0 })
            });
            add(k, format!("Mid-Layer {i}"), Kind::Signal, None, c);
        }
        add("Bottom".into(), "Bottom Layer".into(), Kind::Signal, Some("Top"), hex("#0000ff"));
        for i in 1..=16 {
            add(
                format!("Plane{i}"),
                format!("Internal Plane {i}"),
                Kind::Plane,
                None,
                hsl((150.0 + (i - 1) as f64 * 137.508) % 360.0, 55.0, 38.0),
            );
        }
        for i in 1..=16usize {
            let k = format!("Mech{i}");
            let c = medida(&k).map(hex).unwrap_or_else(|| hex(MECH_CORES.get(i.wrapping_sub(2)).copied().unwrap_or("#888888")));
            add(k, format!("Mechanical {i}"), Kind::Mech, None, c);
        }
        add("TopOverlay".into(), "Top Overlay".into(), Kind::Overlay, Some("BottomOverlay"), hex("#ffff00"));
        add("BottomOverlay".into(), "Bottom Overlay".into(), Kind::Overlay, Some("TopOverlay"), hex("#808000"));
        add("TopPaste".into(), "Top Paste".into(), Kind::Paste, Some("BottomPaste"), hex("#808080"));
        add("BottomPaste".into(), "Bottom Paste".into(), Kind::Paste, Some("TopPaste"), hex("#800000"));
        add("TopSolder".into(), "Top Solder".into(), Kind::Solder, Some("BottomSolder"), hex("#800080"));
        add("BottomSolder".into(), "Bottom Solder".into(), Kind::Solder, Some("TopSolder"), hex("#ff00ff"));
        add("DrillGuide".into(), "Drill Guide".into(), Kind::Drill, None, hex("#800000"));
        add("KeepOut".into(), "Keep-Out Layer".into(), Kind::KeepOut, None, hex("#ff00ff"));
        add("DrillDrawing".into(), "Drill Drawing".into(), Kind::Drill, None, hex("#ff002a"));
        add("Multi".into(), "Multi-Layer".into(), Kind::Multi, None, hex("#c0c0c0"));
        l
    })
}

pub fn by_key(key: &str) -> Option<&'static LayerDef> {
    static M: OnceLock<HashMap<String, usize>> = OnceLock::new();
    let m = M.get_or_init(|| table().iter().enumerate().map(|(i, l)| (l.key.clone(), i)).collect());
    m.get(key).map(|&i| &table()[i])
}

pub fn is_copper(key: &str) -> bool {
    by_key(key).map(|l| l.is_copper()).unwrap_or(false)
}

/// O par no flip do componente (Top<->Bottom, overlay, paste, solder) com os pares mecanicos
/// que a placa declarou; sem par = a propria chave.
pub fn flip(key: &str, mech_pairs: &HashMap<String, String>) -> String {
    if let Some(p) = mech_pairs.get(key) {
        return p.clone();
    }
    by_key(key).and_then(|l| l.pair.clone()).unwrap_or_else(|| key.to_string())
}

pub fn mech_pairs(layers: &[crate::model::LayerInfo]) -> HashMap<String, String> {
    let mec = |k: &str| k.starts_with("Mech") && k[4..].chars().all(|c| c.is_ascii_digit()) && k.len() > 4;
    let mut out = HashMap::new();
    for l in layers {
        let Some(p) = &l.pair else { continue };
        if !mec(&l.key) || !mec(p) || l.key == *p || out.contains_key(&l.key) || out.contains_key(p) {
            continue;
        }
        out.insert(l.key.clone(), p.clone());
        out.insert(p.clone(), l.key.clone());
    }
    out
}

/// Ordem de desenho do Altium: opaco, do lado de la para o de ca (pasta, mascara, cobre,
/// serigrafia), as internas no meio, a Multi logo acima do cobre de ca, mecanicas e keepout por
/// cima; a camada ATUAL por ultimo.
pub fn draw_order(present: &[String], flipped: bool, current: &str) -> Vec<String> {
    let (p, q) = if flipped { ("Top", "Bottom") } else { ("Bottom", "Top") };
    let has = |k: &str| present.iter().any(|x| x == k);
    let mut seq: Vec<String> = Vec::new();
    let add = |k: &str, seq: &mut Vec<String>| {
        if has(k) && !seq.iter().any(|x| x == k) {
            seq.push(k.to_string());
        }
    };
    for k in [format!("{p}Paste"), format!("{p}Solder"), p.to_string(), format!("{p}Overlay")] {
        add(&k, &mut seq);
    }
    let mut internas: Vec<&LayerDef> = table()
        .iter()
        .filter(|l| (l.kind == Kind::Signal && l.key != "Top" && l.key != "Bottom") || l.kind == Kind::Plane)
        .collect();
    internas.sort_by_key(|l| 100 + l.order);
    if !flipped {
        internas.reverse();
    }
    for l in internas {
        add(&l.key, &mut seq);
    }
    for k in ["DrillGuide", "DrillDrawing"] {
        add(k, &mut seq);
    }
    for k in [format!("{q}Paste"), format!("{q}Solder"), q.to_string(), "Multi".into(), format!("{q}Overlay")] {
        add(&k, &mut seq);
    }
    for l in table().iter().filter(|l| l.kind == Kind::Mech) {
        add(&l.key, &mut seq);
    }
    add("KeepOut", &mut seq);
    for k in present {
        if !seq.contains(k) {
            seq.push(k.clone());
        }
    }
    if let Some(i) = seq.iter().position(|k| k == current) {
        let k = seq.remove(i);
        seq.push(k);
    }
    seq
}

/// Cor de uma camada: a do board.js (layers[].color) quando vem, senao a da tabela.
pub fn color_of(key: &str, board_layers: &[crate::model::LayerInfo]) -> [u8; 3] {
    if let Some(c) = board_layers.iter().find(|l| l.key == key).and_then(|l| l.color.as_deref()) {
        return hex(c);
    }
    by_key(key).map(|l| l.color).unwrap_or([0x88, 0x88, 0x88])
}

pub fn name_of(key: &str) -> String {
    by_key(key).map(|l| l.name.clone()).unwrap_or_else(|| key.to_string())
}
