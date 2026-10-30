//! Sem o Nexo Hub, o NexoEletric fica vazio (ALTIUMHUB_NEXOBD=1) -- o nexohub_gate.py: quem diz se o
//! Hub esta conectado e ele mesmo (GET <hub>/api/v1/saude, endereco do conexao.json), medido a cada
//! 5 s; mudou, as paginas abertas recarregam (vazias ou cheias).

use crate::Est;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const MSG: &str = "sem conexão com o Nexo Hub: os projetos e a biblioteca só aparecem com ele conectado";
const LIVRES_API: [&str; 4] = ["/api/lista/", "/api/mcp/", "/api/config", "/api/nexohub/"];

#[derive(Default)]
pub struct Gate {
    st: Mutex<(Option<bool>, String, f64)>,
}

fn conexao() -> (String, String) {
    if let Ok(u) = std::env::var("NEXOHUB_URL") {
        if !u.is_empty() {
            return (u.trim_end_matches('/').to_string(), std::env::var("NEXOHUB_TOKEN").unwrap_or_default());
        }
    }
    let publico = std::env::var("PUBLIC").unwrap_or_else(|_| r"C:\Users\Public".into());
    let arq = std::path::Path::new(&publico).join("NexoHub").join("conexao.json");
    if let Some(j) = std::fs::read_to_string(arq).ok().and_then(|t| serde_json::from_str::<Value>(t.trim_start_matches('\u{feff}')).ok()) {
        if let Some(u) = j.get("url").and_then(|u| u.as_str()).filter(|u| !u.is_empty()) {
            let tok = std::env::var("NEXOHUB_TOKEN").ok().or_else(|| j.get("token").and_then(|t| t.as_str()).map(String::from)).unwrap_or_default();
            return (u.trim_end_matches('/').to_string(), tok);
        }
    }
    ("http://127.0.0.1:47800".into(), std::env::var("NEXOHUB_TOKEN").unwrap_or_default())
}

async fn sonda(cli: &reqwest::Client) -> (bool, String) {
    let (url, tok) = conexao();
    let mut r = cli.get(format!("{url}/api/v1/saude")).header("X-App", "nexoeletric").timeout(Duration::from_secs(3));
    if !tok.is_empty() {
        r = r.bearer_auth(tok);
    }
    match r.send().await {
        Ok(resp) => match resp.json::<Value>().await {
            Ok(j) => {
                let bd_ok = j.get("bd").and_then(|b| b.get("ok")).and_then(|o| o.as_bool()) != Some(false);
                if j.get("ok").and_then(|o| o.as_bool()) == Some(true) && bd_ok {
                    (true, String::new())
                } else {
                    (false, "o Nexo Hub está no ar, mas sem os dados".into())
                }
            }
            Err(e) => (false, format!("Nexo Hub fora do ar em {url} ({e})")),
        },
        Err(e) => (false, format!("Nexo Hub fora do ar em {url} ({e})")),
    }
}

pub fn inicia(est: Est) {
    tokio::spawn(async move {
        let cli = reqwest::Client::new();
        loop {
            let (ok, erro) = sonda(&cli).await;
            let mudou = {
                let mut g = est.gate.st.lock().unwrap();
                let mudou = g.0.is_some() && g.0 != Some(ok);
                *g = (Some(ok), erro, SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0));
                mudou
            };
            if mudou {
                est.live.bump();
            }
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    });
}

/// None = segue; senao a resposta "vazia" que o hubserver.py dava sem o Hub.
pub fn bloqueia(est: &Est, path: &str) -> Option<Response> {
    if !est.cfg.nexobd {
        return None;
    }
    // antes da primeira medida, segue (a medida chega em ms e recarrega a pagina se for o caso)
    if est.gate.st.lock().unwrap().0 != Some(false) {
        return None;
    }
    let p = format!("/{}", path.trim_start_matches('/'));
    if p == "/api/index.json" {
        let agora = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        return Some(Json(json!({"generatedAt": agora, "projects": [], "semHub": true, "erro": MSG})).into_response());
    }
    if p.starts_with("/api/") {
        if LIVRES_API.iter().any(|l| p.starts_with(l)) {
            return None;
        }
        return Some((StatusCode::SERVICE_UNAVAILABLE, Json(json!({"ok": false, "error": MSG, "semHub": true}))).into_response());
    }
    if p.starts_with("/Projects/") || p.starts_with("/Libs/") || p.starts_with("/projects.js") || p.starts_with("/bom/") {
        if p.ends_with(".js") {
            return Some(([("content-type", "text/javascript")], format!("/* {MSG} */\n")).into_response());
        }
        return Some((StatusCode::SERVICE_UNAVAILABLE, MSG).into_response());
    }
    None
}

pub async fn api_estado(State(est): State<Est>) -> Json<Value> {
    let g = est.gate.st.lock().unwrap();
    Json(json!({"conectado": g.0.unwrap_or(!est.cfg.nexobd), "erro": g.1, "quando": g.2, "ligado": est.cfg.nexobd}))
}
