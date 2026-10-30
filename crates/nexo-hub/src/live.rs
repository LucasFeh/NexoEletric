//! O "ao vivo": arquivo de projeto ou de biblioteca mudou -> as paginas abertas recarregam.
//! O hubserver.py varria Projects/ e Libs/ inteiros a cada segundo (os.walk); aqui quem avisa e o
//! sistema (ReadDirectoryChangesW), com as mesmas excecoes, e o custo parado e zero.

use crate::Est;
use axum::extract::State;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::IntoResponse;
use futures_util::stream::Stream;
use notify::{RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::sync::watch;
use tokio_stream::wrappers::WatchStream;
use tokio_stream::StreamExt;

/// o mesmo script que o hubserver.py injeta em todo .html (uma conexao SSE por janela)
pub const LIVE_JS: &str = r#"/* hubserver: auto-reload via SSE (injetado; nao existe como arquivo) */
(function(){
  /* paginas de edicao definem __hubOnChange p/ nao perder trabalho nao salvo */
  function avisa(w){
    if (w.__hubOnChange) { w.__hubOnChange(); return; }
    w.location.reload();
  }
  function repassa(w){
    for (var i = 0; i < w.frames.length; i++) {
      try {
        var f = w.frames[i];
        if (f.__hubLiveFilho) { repassa(f); avisa(f); }
      } catch (e) {}
    }
  }
  var topo = null;
  try { if (window.top !== window && window.top.__hubLive) topo = window.top; } catch (e) {}
  if (topo) { window.__hubLiveFilho = true; return; }
  window.__hubLive = true;
  var es = new EventSource('/__events');
  es.addEventListener('change', function(){ repassa(window); avisa(window); });
})();
"#;

// estado do BOM/Odoo ao lado do projeto e a biblioteca do editor de footprint: nao recarregam
const ESTADO_LOCAL: [&str; 4] = ["bom-vistos.json", "bom-opts.json", "odoo-lista.json", "lista-extras.json"];
const FP_HUB: &str = "pcblib-hub.js";
const FP3D_PASTA: &str = "3d-hub";
const SAIDAS: [&str; 2] = ["gerber", "pdf"];

pub struct Live {
    pub tx: watch::Sender<u64>,
    _vigia: Option<notify::RecommendedWatcher>,
}

/// O que conta como mudanca de projeto (a regra do _snapshot do hubserver.py).
pub fn conta(root: &Path, p: &Path) -> bool {
    let Ok(rel) = p.strip_prefix(root) else { return false };
    let partes: Vec<String> = rel.components().map(|c| c.as_os_str().to_string_lossy().to_lowercase()).collect();
    let Some(primeira) = partes.first() else { return false };
    let nome = partes.last().cloned().unwrap_or_default();
    let base = nome.strip_suffix(".tmp").unwrap_or(&nome).to_string();
    if ESTADO_LOCAL.contains(&base.as_str()) {
        return false;
    }
    match primeira.as_str() {
        "projects.js" => partes.len() == 1,
        "projects" => !(partes.len() >= 4 && SAIDAS.contains(&partes[2].as_str())) && partes.len() >= 2,
        "libs" => {
            if partes.len() >= 2 && partes[1] == FP3D_PASTA {
                return false;
            }
            !(partes.len() == 2 && base == FP_HUB)
        }
        _ => false,
    }
}

impl Live {
    pub fn inicia(root: &Path) -> Live {
        let (tx, _) = watch::channel(0u64);
        let (etx, erx) = std::sync::mpsc::channel::<()>();
        let r = root.to_path_buf();
        let vigia = notify::recommended_watcher(move |ev: notify::Result<notify::Event>| {
            if let Ok(ev) = ev {
                if ev.kind.is_access() {
                    return;
                }
                if ev.paths.iter().any(|p| conta(&r, p)) {
                    let _ = etx.send(());
                }
            }
        })
        .ok()
        .and_then(|mut w| {
            let mut ok = false;
            for (d, modo) in [("Projects", RecursiveMode::Recursive), ("Libs", RecursiveMode::Recursive), ("", RecursiveMode::NonRecursive)] {
                let p: PathBuf = if d.is_empty() { root.to_path_buf() } else { root.join(d) };
                if p.exists() && w.watch(&p, modo).is_ok() {
                    ok = true;
                }
            }
            ok.then_some(w)
        });
        // junta a rajada (gravacao atomica = .tmp + troca) num aviso so
        let txc = tx.clone();
        std::thread::Builder::new()
            .name("ao-vivo".into())
            .spawn(move || {
                while erx.recv().is_ok() {
                    while erx.recv_timeout(Duration::from_millis(250)).is_ok() {}
                    txc.send_modify(|v| *v += 1);
                }
            })
            .ok();
        Live { tx, _vigia: vigia }
    }
    pub fn bump(&self) {
        self.tx.send_modify(|v| *v += 1);
    }
}

pub async fn live_js() -> impl IntoResponse {
    ([("content-type", "text/javascript; charset=utf-8"), ("cache-control", "no-store")], LIVE_JS)
}

pub async fn events(State(est): State<Est>) -> Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>> {
    let rx = est.live.tx.subscribe();
    let inicio = *rx.borrow();
    let s = WatchStream::new(rx)
        .filter(move |v| *v != inicio)
        .map(|v| Ok(Event::default().event("change").data(v.to_string())));
    Sse::new(s).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)).text("keep-alive"))
}
