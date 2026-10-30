//! Um projeto do NexoEletric e uma pasta com `board.js` (a placa espelhada do Altium, nunca
//! editada), `changes.js` (as mudancas, uma op por linha), `schematic.js` e `annotations.js`.

use crate::changes::{self, Applied};
use crate::jsfile;
use crate::model::Board;
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime};

pub struct Project {
    pub dir: PathBuf,
    pub name: String,
    pub board: Board,
    pub changes: Vec<serde_json::Value>,
    pub applied: Applied,
    pub stamp: Stamp,
    pub timings: Timings,
}

#[derive(Debug, Clone, Default)]
pub struct Timings {
    pub read_ms: f64,
    pub parse_ms: f64,
    pub apply_ms: f64,
}

/// Data de modificacao dos arquivos que a vista acompanha (recarrega quando muda).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Stamp(Vec<Option<SystemTime>>);

pub fn stamp(dir: &Path) -> Stamp {
    Stamp(
        ["board.js", "changes.js"]
            .iter()
            .map(|f| std::fs::metadata(dir.join(f)).and_then(|m| m.modified()).ok())
            .collect(),
    )
}

pub fn load(dir: &Path) -> Result<Project, String> {
    let t0 = Instant::now();
    let bsrc = std::fs::read_to_string(dir.join("board.js")).map_err(|e| format!("board.js: {e}"))?;
    let csrc = std::fs::read_to_string(dir.join("changes.js")).unwrap_or_default();
    let t1 = Instant::now();
    let board: Board = jsfile::parse_js(&bsrc).map_err(|e| format!("board.js: {e}"))?;
    let changes: Vec<serde_json::Value> = if csrc.trim().is_empty() {
        Vec::new()
    } else {
        match jsfile::parse_js_value(&csrc) {
            Ok(serde_json::Value::Array(a)) => a,
            Ok(_) => Vec::new(),
            Err(e) => return Err(format!("changes.js: {e}")),
        }
    };
    let t2 = Instant::now();
    let applied = changes::apply(&board, &changes);
    let t3 = Instant::now();
    let ms = |a: Instant, b: Instant| (b - a).as_secs_f64() * 1000.0;
    Ok(Project {
        name: dir.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(),
        dir: dir.to_path_buf(),
        board,
        changes,
        applied,
        stamp: stamp(dir),
        timings: Timings { read_ms: ms(t0, t1), parse_ms: ms(t1, t2), apply_ms: ms(t2, t3) },
    })
}

#[derive(Debug, Clone)]
pub struct ProjectEntry {
    pub name: String,
    pub dir: PathBuf,
    pub board_size: u64,
    pub has_sch: bool,
}

/// As pastas de projeto (com board.js) dentro de cada raiz.
pub fn scan(roots: &[PathBuf]) -> Vec<ProjectEntry> {
    let mut out = Vec::new();
    for r in roots {
        let Ok(rd) = std::fs::read_dir(r) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            let b = p.join("board.js");
            if let Ok(m) = std::fs::metadata(&b) {
                out.push(ProjectEntry {
                    name: e.file_name().to_string_lossy().into_owned(),
                    has_sch: p.join("schematic.js").exists(),
                    dir: p,
                    board_size: m.len(),
                });
            }
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}
