//! nexo-hub: o servidor do hub do NexoEletric em Rust, no lugar do hubserver.py no caminho de
//! abrir e usar um projeto. O que e quente fica aqui:
//!   - os arquivos do hub e dos projetos (o Python levava 200-600 ms por arquivo);
//!   - /api/index.json e /api/project/<id>.json (o Python reinterpretava TODOS os board.js a cada
//!     pedido do indice), com cache por data de modificacao;
//!   - /api/save, o ao vivo (/__live.js, /__events) por notificacao do sistema (o Python varria
//!     Projects/ e Libs/ a cada segundo), as rotas do MCP e o portao do Nexo Hub;
//!   - os remendos da vista PCB (render WebGL do nucleo Rust, 3D sob demanda).
//! O resto (Gerber, PDF, BOM, Odoo, laser, importar do Altium...) vai ao hubserver.py, que sobe em
//! segundo plano so quando alguem pede uma rota dele -- a abertura nao espera o Python.

mod gate;
mod index;
mod live;
mod mcp;
mod patches;
mod proxy;
mod statics;

use axum::routing::{get, post};
use axum::Router;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

#[derive(Clone, Debug)]
pub struct Config {
    /// a pasta de trabalho (hub.html, hub-*.js, Projects/, Libs/)
    pub root: PathBuf,
    /// porta preferida; ocupada, a seguinte (nunca toma a de outro programa)
    pub port: u16,
    pub host: [u8; 4],
    /// o Python embutido do NexoEletric (para as rotas que ficaram no hubserver.py)
    pub python: Option<PathBuf>,
    /// arquivos nossos servidos em /nexo/ (nexo-gl.js, nexo_wasm.wasm)
    pub overlay: PathBuf,
    /// ALTIUMHUB_NEXOBD=1: sem o Nexo Hub conectado, projetos e biblioteca nao saem
    pub nexobd: bool,
    /// render WebGL e 3D sob demanda na vista PCB (os remendos); false = a vista original
    pub remendos: bool,
}

pub struct Estado {
    pub cfg: Config,
    pub live: live::Live,
    pub index: index::Cache,
    pub mcp: mcp::Mcp,
    pub py: proxy::Python,
    pub gate: gate::Gate,
    pub patches: patches::Cache,
}

pub type Est = Arc<Estado>;

pub fn router(est: Est) -> Router {
    Router::new()
        .route("/__live.js", get(live::live_js))
        .route("/__events", get(live::events))
        .route("/api/index.json", get(index::api_index))
        .route("/api/project/{arquivo}", get(index::api_project))
        .route("/api/save", post(statics::api_save))
        .route("/api/nexohub/estado", get(gate::api_estado))
        .route("/api/mcp/status", get(mcp::status))
        .route("/api/mcp/pedido", post(mcp::pedido))
        .route("/api/mcp/pedidos", get(mcp::pedidos))
        .route("/api/mcp/resposta/{pid}", get(mcp::resposta_espera).post(mcp::resposta_grava))
        .route("/api/mcp/ola", post(mcp::ola))
        .route("/api/mcp/atividade", get(mcp::atividade_le).post(mcp::atividade_grava))
        .route("/nexo/{*arquivo}", get(statics::overlay))
        .route("/", get(statics::raiz))
        .fallback(statics::fallback)
        .with_state(est)
}

/// Sobe o servidor e devolve a porta em que ficou. Roda ate o processo sair.
pub async fn serve(cfg: Config) -> std::io::Result<(u16, tokio::task::JoinHandle<()>)> {
    let mut porta = cfg.port;
    let listener = loop {
        match tokio::net::TcpListener::bind(SocketAddr::from((cfg.host, porta))).await {
            Ok(l) => break l,
            Err(e) if porta < cfg.port.saturating_add(30) => {
                eprintln!("[nexo-hub] porta {porta} ocupada ({e}); tentando a seguinte");
                porta += 1;
            }
            Err(e) => return Err(e),
        }
    };
    let porta = listener.local_addr()?.port();
    let est = Arc::new(Estado {
        live: live::Live::inicia(&cfg.root),
        index: index::Cache::default(),
        mcp: mcp::Mcp::default(),
        py: proxy::Python::new(cfg.python.clone(), cfg.root.clone()),
        gate: gate::Gate::default(),
        patches: patches::Cache::default(),
        cfg,
    });
    if est.cfg.nexobd {
        gate::inicia(est.clone());
    }
    let app = router(est.clone()).into_make_service_with_connect_info::<SocketAddr>();
    let h = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    Ok((porta, h))
}

/// Para quem nao e async (a casca): sobe o servidor numa thread com runtime proprio.
pub fn serve_em_thread(cfg: Config) -> std::io::Result<u16> {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::Builder::new().name("nexo-hub".into()).spawn(move || {
        let rt = tokio::runtime::Builder::new_multi_thread().worker_threads(4).enable_all().build().expect("tokio");
        rt.block_on(async move {
            match serve(cfg).await {
                Ok((p, h)) => {
                    let _ = tx.send(Ok(p));
                    let _ = h.await;
                }
                Err(e) => {
                    let _ = tx.send(Err(e));
                }
            }
        });
    })?;
    rx.recv().map_err(|e| std::io::Error::other(e.to_string()))?
}
