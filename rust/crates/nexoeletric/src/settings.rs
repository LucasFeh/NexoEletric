//! Preferencias do app em %APPDATA%\NexoEletric-rust\settings.json.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Settings {
    /// pastas com projetos (cada subpasta com board.js e um projeto)
    pub roots: Vec<PathBuf>,
    pub last: Option<PathBuf>,
}

fn path() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join("NexoEletric-rust").join("settings.json"))
}

impl Settings {
    pub fn load() -> Settings {
        let mut s: Settings = path()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        if let Some(e) = std::env::var_os("NEXO_PROJECTS") {
            for p in std::env::split_paths(&e) {
                if !s.roots.contains(&p) {
                    s.roots.push(p);
                }
            }
        }
        if s.roots.is_empty() {
            for p in [r"D:\Pessoal\NexoEletric\Projects"] {
                let p = PathBuf::from(p);
                if p.exists() {
                    s.roots.push(p);
                }
            }
        }
        s
    }
    pub fn save(&self) {
        if let Some(p) = path() {
            if let Some(d) = p.parent() {
                let _ = std::fs::create_dir_all(d);
            }
            let _ = std::fs::write(p, serde_json::to_string_pretty(self).unwrap_or_default());
        }
    }
}
