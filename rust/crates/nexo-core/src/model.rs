//! O espelho da placa no formato `pcbmirror-v1` (o `board.js` que o ExportBoard.pas grava).
//! Coordenadas em mm, Y para cima, angulos em graus anti-horario -- identico ao Altium.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct BBox {
    pub x1: f64,
    pub y1: f64,
    pub x2: f64,
    pub y2: f64,
}

impl BBox {
    pub const EMPTY: BBox = BBox { x1: f64::INFINITY, y1: f64::INFINITY, x2: f64::NEG_INFINITY, y2: f64::NEG_INFINITY };
    pub fn add(&mut self, x: f64, y: f64) {
        if !x.is_finite() || !y.is_finite() {
            return;
        }
        self.x1 = self.x1.min(x);
        self.y1 = self.y1.min(y);
        self.x2 = self.x2.max(x);
        self.y2 = self.y2.max(y);
    }
    pub fn grow(&mut self, m: f64) {
        self.x1 -= m;
        self.y1 -= m;
        self.x2 += m;
        self.y2 += m;
    }
    pub fn valid(&self) -> bool {
        self.x1 <= self.x2 && self.y1 <= self.y2
    }
    pub fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x1 && x <= self.x2 && y >= self.y1 && y <= self.y2
    }
    pub fn union(&mut self, o: &BBox) {
        if o.valid() {
            self.add(o.x1, o.y1);
            self.add(o.x2, o.y2);
        }
    }
}

/// Trecho do contorno da placa: reta ou arco.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct OutlineSeg {
    pub kind: String,
    pub x1: f64,
    pub y1: f64,
    pub x2: f64,
    pub y2: f64,
    pub cx: f64,
    pub cy: f64,
    pub r: f64,
    pub sa: f64,
    pub ea: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct BoardInfo {
    pub bbox: Option<BBox>,
    pub outline: Vec<OutlineSeg>,
}

/// A outra face de um pad passante quando ela e diferente da de cima.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct PadStack {
    pub shape: Option<String>,
    pub w: Option<f64>,
    pub h: Option<f64>,
    pub radius: Option<f64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Pad {
    pub id: String,
    pub name: String,
    pub layer: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub shape: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub rot: f64,
    pub net: String,
    pub drillshape: Option<String>,
    pub drill: Option<f64>,
    pub drillw: Option<f64>,
    pub holerot: Option<f64>,
    pub radius: Option<f64>,
    pub hox: Option<f64>,
    pub hoy: Option<f64>,
    pub sm: Option<f64>,
    pub pm: Option<f64>,
    #[serde(rename = "tentTop")]
    pub tent_top: Option<bool>,
    #[serde(rename = "tentBot")]
    pub tent_bot: Option<bool>,
    pub nopaste: Option<bool>,
    pub bot: Option<PadStack>,
    pub bw: Option<f64>,
    pub bh: Option<f64>,
    pub bshape: Option<String>,
    pub bradius: Option<f64>,
}

impl Pad {
    /// Pad passante (pinta todas as camadas de cobre e tem furo).
    pub fn is_th(&self) -> bool {
        self.layer == "Multi" || (self.layer.is_empty() && self.kind == "th")
    }
    /// A forma da face (`top` ou `bottom`): o passante pode ter a pilha de baixo diferente.
    pub fn face(&self, bottom: bool) -> (String, f64, f64, Option<f64>) {
        if bottom && self.is_th() {
            if let Some(b) = &self.bot {
                return (
                    b.shape.clone().unwrap_or_else(|| self.shape.clone()),
                    b.w.unwrap_or(self.w),
                    b.h.unwrap_or(self.h),
                    b.radius.or(self.radius),
                );
            }
            if self.bw.is_some() || self.bh.is_some() || self.bshape.is_some() {
                return (
                    self.bshape.clone().unwrap_or_else(|| self.shape.clone()),
                    self.bw.unwrap_or(self.w),
                    self.bh.unwrap_or(self.h),
                    self.bradius.or(self.radius),
                );
            }
        }
        (self.shape.clone(), self.w, self.h, self.radius)
    }
    /// O furo fica em (x,y); o "furo deslocado" desloca o COBRE, no referencial do pad.
    pub fn copper_center(&self) -> (f64, f64) {
        let hox = self.hox.unwrap_or(0.0);
        let hoy = self.hoy.unwrap_or(0.0);
        if hox != 0.0 || hoy != 0.0 {
            let (dx, dy) = crate::geom::rotate(hox, hoy, self.rot);
            return (self.x + dx, self.y + dy);
        }
        (self.x, self.y)
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Component {
    pub id: String,
    #[serde(rename = "ref")]
    pub refdes: String,
    pub footprint: String,
    pub comment: String,
    pub layer: String,
    pub x: f64,
    pub y: f64,
    pub rot: f64,
    pub bbox: Option<BBox>,
    pub pads: Vec<Pad>,
}

/// Trilha, arco de cobre, linha ou arco de serigrafia/mecanica: o board.js usa os mesmos campos.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Seg {
    pub id: String,
    pub layer: String,
    /// "line" | "arc" no silk/lines; vazio em tracks/arcs.
    pub kind: String,
    pub x1: f64,
    pub y1: f64,
    pub x2: f64,
    pub y2: f64,
    pub cx: f64,
    pub cy: f64,
    pub r: f64,
    pub sa: f64,
    pub ea: f64,
    pub w: f64,
    pub net: String,
    pub owner: String,
    pub keepout: bool,
}

impl Seg {
    pub fn is_full_circle(&self) -> bool {
        (self.ea - self.sa).abs() >= 359.999
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Via {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub size: f64,
    pub drill: f64,
    pub from: String,
    pub to: String,
    pub net: String,
    pub sm: Option<f64>,
    #[serde(rename = "tentTop")]
    pub tent_top: Option<bool>,
    #[serde(rename = "tentBot")]
    pub tent_bot: Option<bool>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct TextPoly {
    pub pts: Vec<[f64; 2]>,
    pub hole: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Text {
    pub id: String,
    pub layer: String,
    pub x: f64,
    pub y: f64,
    pub text: String,
    pub h: f64,
    pub w: Option<f64>,
    pub rot: f64,
    pub mirror: bool,
    pub designator: bool,
    pub comment: bool,
    pub owner: String,
    pub kind: Option<String>,
    pub font: Option<String>,
    pub hidden: bool,
    pub inverted: bool,
    pub ax: Option<f64>,
    pub ay: Option<f64>,
    pub polys: Option<Vec<TextPoly>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Fill {
    pub id: String,
    pub layer: String,
    pub x1: f64,
    pub y1: f64,
    pub x2: f64,
    pub y2: f64,
    pub rot: f64,
    pub net: String,
    pub owner: String,
    pub keepout: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Region {
    pub id: String,
    pub layer: String,
    pub net: String,
    pub owner: String,
    pub points: Vec<[f64; 2]>,
    pub holes: Vec<Vec<[f64; 2]>>,
    pub keepout: bool,
    pub poly: bool,
    pub de: Option<serde_json::Value>,
    pub incomp: bool,
    pub cutout: bool,
    pub polycut: bool,
    pub kindn: Option<i64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Polygon {
    pub id: String,
    pub layer: String,
    pub net: String,
    pub nome: String,
    pub pts: Vec<[f64; 2]>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct LayerInfo {
    pub key: String,
    pub name: Option<String>,
    pub color: Option<String>,
    pub pair: Option<String>,
    pub stack: Option<i64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Rules {
    pub clearance: Option<f64>,
    pub sm: Option<f64>,
    pub pm: Option<f64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Board {
    pub format: String,
    pub generated: String,
    pub source: String,
    pub board: BoardInfo,
    pub nets: Vec<String>,
    pub components: Vec<Component>,
    pub freepads: Vec<Pad>,
    pub tracks: Vec<Seg>,
    pub arcs: Vec<Seg>,
    pub vias: Vec<Via>,
    pub texts: Vec<Text>,
    pub silk: Vec<Seg>,
    pub lines: Vec<Seg>,
    pub fills: Vec<Fill>,
    pub regions: Vec<Region>,
    pub cutouts: Vec<Region>,
    pub polygons: Vec<Polygon>,
    pub layers: Vec<LayerInfo>,
    pub rules: Option<Rules>,
}

impl Board {
    /// Caixa da placa: o contorno, ou o bbox gravado, ou a uniao de tudo.
    pub fn extents(&self) -> BBox {
        let mut b = BBox::EMPTY;
        for s in &self.board.outline {
            if s.kind == "arc" {
                b.add(s.cx - s.r, s.cy - s.r);
                b.add(s.cx + s.r, s.cy + s.r);
            } else {
                b.add(s.x1, s.y1);
                b.add(s.x2, s.y2);
            }
        }
        if b.valid() {
            return b;
        }
        if let Some(bb) = &self.board.bbox {
            if bb.valid() {
                return bb.clone();
            }
        }
        for c in &self.components {
            if let Some(bb) = &c.bbox {
                b.union(bb);
            }
        }
        for t in &self.tracks {
            b.add(t.x1, t.y1);
            b.add(t.x2, t.y2);
        }
        if !b.valid() {
            b = BBox { x1: 0.0, y1: 0.0, x2: 100.0, y2: 100.0 };
        }
        b
    }

    pub fn counts(&self) -> Vec<(&'static str, usize)> {
        let pads: usize = self.components.iter().map(|c| c.pads.len()).sum::<usize>() + self.freepads.len();
        vec![
            ("componentes", self.components.len()),
            ("pads", pads),
            ("trilhas", self.tracks.len()),
            ("arcos", self.arcs.len()),
            ("vias", self.vias.len()),
            ("textos", self.texts.len()),
            ("serigrafia", self.silk.len()),
            ("linhas", self.lines.len()),
            ("fills", self.fills.len()),
            ("regioes", self.regions.len()),
            ("recortes", self.cutouts.len()),
            ("poligonos", self.polygons.len()),
            ("nets", self.nets.len()),
        ]
    }
}
