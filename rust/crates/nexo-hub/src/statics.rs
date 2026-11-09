//! Os arquivos do hub e dos projetos (com as mesmas protecoes do hubserver.py), o /api/save e a
//! pasta /nexo/ (o render WebGL e o WASM). O que nao e arquivo daqui vai ao Python.

use crate::{patches, proxy, Est};
use axum::extract::{ConnectInfo, Path as AxPath, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

const SEGREDOS: [&str; 2] = ["hub-almox.json", "hub-almox.json.tmp"];
const SAVE_BASENAMES: [&str; 4] = ["changes.js", "schematic.js", "annotations.js", "rules.js"];
const SAVE_LIB_FILES: [&str; 3] = ["lib-subs.js", "sch-templates-casa.js", "pcblib-hub.js"];
const LIVE_TAG: &str = "<script src=\"/__live.js\"></script>\n";
const GL_TAG: &str = "<script src=\"/nexo/nexo-gl.js\"></script>\n";

fn mime(p: &Path) -> HeaderValue {
    let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let m = match ext.as_str() {
        "js" | "mjs" => "text/javascript; charset=utf-8".to_string(),
        "css" => "text/css; charset=utf-8".to_string(),
        "html" | "htm" => "text/html; charset=utf-8".to_string(),
        "json" => "application/json".to_string(),
        "wasm" => "application/wasm".to_string(),
        _ => mime_guess::from_path(p).first_or_octet_stream().essence_str().to_string(),
    };
    HeaderValue::from_str(&m).unwrap_or(HeaderValue::from_static("application/octet-stream"))
}

/// O caminho pedido como arquivo da pasta de trabalho (ou None: proibido/fora).
pub fn resolve(root: &Path, rel: &str) -> Option<PathBuf> {
    let rel = percent_encoding::percent_decode_str(rel).decode_utf8().ok()?;
    let segs: Vec<&str> = rel.split(['/', '\\']).filter(|s| !s.is_empty()).collect();
    if segs.is_empty() || segs.iter().any(|s| s.starts_with('.') || s.contains(':')) {
        return None;
    }
    let mut p = root.to_path_buf();
    for s in &segs {
        p.push(s);
    }
    if segs.len() == 1 && SEGREDOS.iter().any(|n| n.eq_ignore_ascii_case(segs[0].trim_end_matches([' ', '.']))) {
        return None;
    }
    Some(p)
}

fn etag(m: &std::fs::Metadata) -> String {
    let t = m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_nanos()).unwrap_or(0);
    format!("\"{:x}-{:x}\"", t, m.len())
}

fn nao_mudou(h: &HeaderMap, tag: &str) -> bool {
    h.get(header::IF_NONE_MATCH).and_then(|v| v.to_str().ok()).map(|v| v == tag).unwrap_or(false)
}

/// Serve um arquivo da pasta: .html com o ao vivo injetado (e o render WebGL na vista PCB), a
/// vista PCB remendada, o resto cru. Revalidacao por ETag: a pagina recarregada nao baixa de novo
/// os 11 MB de scripts, e o que mudou no disco sai novo na hora.
async fn arquivo(est: &Est, full: &Path, headers: &HeaderMap) -> Response {
    let Ok(meta) = tokio::fs::metadata(full).await else { return StatusCode::NOT_FOUND.into_response() };
    if !meta.is_file() {
        return StatusCode::NOT_FOUND.into_response();
    }
    let nome = full.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    let remenda = est.cfg.remendos && patches::alvo(&nome);
    let mut h = HeaderMap::new();
    h.insert(header::CONTENT_TYPE, mime(full));
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    // remendado: a etiqueta leva a impressao digital do RESULTADO (remendo novo = arquivo novo para o
    // navegador, mesmo com o original igual no disco)
    if remenda {
        let Ok(bytes) = tokio::fs::read(full).await else { return StatusCode::NOT_FOUND.into_response() };
        let (s, digital) = est.patches.remendado(&nome, &etag(&meta), &bytes);
        let tag = format!("{}-nx{:016x}", etag(&meta).trim_end_matches('"'), digital) + "\"";
        h.insert(header::ETAG, HeaderValue::from_str(&tag).unwrap());
        if nao_mudou(headers, &tag) {
            return (StatusCode::NOT_MODIFIED, h).into_response();
        }
        return (h, s).into_response();
    }
    let tag = etag(&meta);
    h.insert(header::ETAG, HeaderValue::from_str(&tag).unwrap());
    let html = nome.ends_with(".html") || nome.ends_with(".htm");
    if !html && nao_mudou(headers, &tag) {
        return (StatusCode::NOT_MODIFIED, h).into_response();
    }
    let Ok(bytes) = tokio::fs::read(full).await else { return StatusCode::NOT_FOUND.into_response() };
    if html {
        let mut s = String::from_utf8_lossy(&bytes).into_owned();
        if est.cfg.remendos && nome == "pcbframe.html" {
            s = patches::html_pcb(&s, GL_TAG);
        }
        match s.rfind("</body>") {
            Some(i) => s.insert_str(i, LIVE_TAG),
            None => {
                s.push('\n');
                s.push_str(LIVE_TAG);
            }
        }
        h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        h.remove(header::ETAG);
        return (h, s).into_response();
    }
    (h, bytes).into_response()
}

pub async fn raiz(State(est): State<Est>, headers: HeaderMap) -> Response {
    let p = est.cfg.root.join("hub.html");
    arquivo(&est, &p, &headers).await
}

pub async fn overlay(State(est): State<Est>, AxPath(rel): AxPath<String>, headers: HeaderMap) -> Response {
    match resolve(&est.cfg.overlay, &rel) {
        Some(p) => arquivo(&est, &p, &headers).await,
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

/// Arquivo da pasta de trabalho, ou o Python para tudo o que nao e arquivo daqui.
pub async fn fallback(State(est): State<Est>, ConnectInfo(addr): ConnectInfo<SocketAddr>, req: Request) -> Response {
    let path = req.uri().path().to_string();
    if let Some(r) = crate::gate::bloqueia(&est, &path) {
        return r;
    }
    if (req.method() == Method::GET || req.method() == Method::HEAD) && !path.starts_with("/api/") && !path.starts_with("/bom/") {
        let rel = path.trim_start_matches('/');
        // os corpos 3D da PcbLib que nao foram gerados na raiz: o Python extrai da PcbLib
        let lib3d = rel == "Libs/pcblib-3d.js" || rel.starts_with("Libs/3d/");
        if let Some(full) = resolve(&est.cfg.root, rel) {
            if full.is_file() {
                return arquivo(&est, &full, req.headers()).await;
            }
            if !lib3d {
                return StatusCode::NOT_FOUND.into_response();
            }
        } else {
            return StatusCode::NOT_FOUND.into_response();
        }
    }
    proxy::repassa(&est, addr, req).await
}

pub async fn api_save(State(est): State<Est>, Json(d): Json<serde_json::Value>) -> Response {
    if let Some(r) = crate::gate::bloqueia(&est, "/api/save") {
        return r;
    }
    let (Some(path), Some(content)) = (d.get("path").and_then(|v| v.as_str()), d.get("content")) else {
        return (StatusCode::BAD_REQUEST, Json(json!({"ok": false, "error": "JSON {path, content} obrigatorio"}))).into_response();
    };
    let content = match content {
        serde_json::Value::String(s) => s.clone(),
        v => v.to_string(),
    };
    let parts: Vec<&str> = path.split(['/', '\\']).filter(|s| !s.is_empty()).collect();
    if parts.iter().any(|s| s.starts_with('.') || s.contains(':')) {
        return (StatusCode::FORBIDDEN, Json(json!({"ok": false, "error": "path invalido"}))).into_response();
    }
    let ok_proj = parts.len() == 3 && parts[0] == "Projects" && SAVE_BASENAMES.contains(&parts[2]);
    let ok_lib = parts.len() == 2 && parts[0] == "Libs" && SAVE_LIB_FILES.contains(&parts[1]);
    if !(ok_proj || ok_lib) {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({"ok": false, "error": "so Projects/<nome>/{changes,schematic,annotations,rules}.js ou Libs/{lib-subs,sch-templates-casa}.js"})),
        )
            .into_response();
    }
    let mut full = est.cfg.root.clone();
    for p in &parts {
        full.push(p);
    }
    if !full.parent().map(|d| d.is_dir()).unwrap_or(false) {
        return (StatusCode::NOT_FOUND, Json(json!({"ok": false, "error": "pasta inexistente"}))).into_response();
    }
    // 1.84.0: o projeto tem dono (equipe.rs): quem nao e o responsavel, colaborador ou admin nao grava; e o que estava
    // no disco vai para o historico do Python depois (quem fez e o que mudou)
    let mut antes: Option<String> = None;
    if ok_proj {
        let pdir = full.parent().map(|d| d.to_path_buf()).unwrap_or_default();
        let modo = est.sessao.modo(&est.hub_cli).await;
        if let Err(corpo) = crate::equipe::pode(&crate::equipe::le_equipe(&pdir), &modo) {
            return (StatusCode::FORBIDDEN, Json(corpo)).into_response();
        }
        antes = std::fs::read_to_string(&full).ok().map(|t| t.replace("\r\n", "\n"));
    }
    let novo = content.clone();
    // gravacao atomica, seguindo o symlink (como o hubserver.py)
    let alvo = std::fs::canonicalize(&full).unwrap_or(full.clone());
    let tmp = PathBuf::from(format!("{}.tmp", full.display()));
    let r = tokio::task::spawn_blocking(move || -> std::io::Result<()> {
        std::fs::write(&tmp, content.as_bytes())?;
        std::fs::rename(&tmp, &alvo)
    })
    .await;
    match r {
        Ok(Ok(())) => {
            est.index.esquece(parts.get(1).copied().unwrap_or(""));
            if ok_proj && antes.as_deref() != Some(novo.replace("\r\n", "\n").as_str()) {
                let (projeto, arquivo) = (parts[1].to_string(), parts[2].to_string());
                let e = est.clone();
                tokio::spawn(async move {
                    let corpo = json!({"projeto": projeto, "arquivo": arquivo, "antes": antes, "origem": "app"});
                    e.py.posta("/api/historico/registra", &corpo).await;
                });
            }
            Json(json!({"ok": true})).into_response()
        }
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"ok": false, "error": format!("falha ao gravar: {e}")}))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"ok": false, "error": e.to_string()}))).into_response(),
    }
}

#[cfg(test)]
mod tests {
    //! o /api/save do Rust contra um Nexo Hub de mentira: quem pode gravar no projeto (1.84.0)
    use super::api_save;
    use crate::{gate, index, live, mcp, patches, proxy, Config, Estado};
    use axum::extract::State;
    use axum::Json;
    use serde_json::{json, Value};
    use std::sync::{Arc, Mutex};

    async fn hub_falso(resposta: Arc<Mutex<Option<Value>>>) -> String {
        let app = axum::Router::new().route(
            "/api/v1/sessao",
            axum::routing::get(move || {
                let r = resposta.clone();
                async move {
                    use axum::response::IntoResponse;
                    match r.lock().unwrap().clone() {
                        Some(v) => Json(v).into_response(),
                        None => axum::http::StatusCode::NOT_FOUND.into_response(),
                    }
                }
            }),
        );
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", l.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(l, app).await.unwrap() });
        url
    }

    #[tokio::test]
    async fn save_respeita_a_equipe() {
        let root = std::env::temp_dir().join(format!("nexo-hub-equipe-{}", uuid::Uuid::new_v4()));
        let pdir = root.join("Projects").join("P1");
        std::fs::create_dir_all(&pdir).unwrap();
        std::fs::write(pdir.join("changes.js"), "var changes = [\n];\n").unwrap();
        std::fs::write(pdir.join("equipe.json"), json!({"formato": "nexoeletric-equipe-1",
            "responsavel": {"id": "u-dono", "login": "dono", "nome": "Davi Dono"},
            "colaboradores": [{"id": "u-colab", "login": "colab", "nome": "Carla"}]}).to_string()).unwrap();
        let resposta = Arc::new(Mutex::new(None));
        let url = hub_falso(resposta.clone()).await;
        let cfg = Config { root: root.clone(), port: 0, host: [127, 0, 0, 1], python: None, overlay: root.clone(), nexobd: false, remendos: false };
        let est = Arc::new(Estado {
            live: live::Live::inicia(&root), index: index::Cache::default(), mcp: mcp::Mcp::default(),
            py: proxy::Python::new(None, root.clone()), gate: gate::Gate::default(), patches: patches::Cache::default(),
            sessao: crate::equipe::Sessao::default(), hub_cli: reqwest::Client::new(), cfg,
        });
        *est.sessao.url.lock().unwrap() = Some(url);
        let grava = |txt: &str| json!({"path": "Projects/P1/changes.js", "content": txt});
        let como = |id: &str, admin: bool| Some(json!({"ok": true, "logado": true, "usuario": {"id": id, "login": id, "nome": id, "admin": admin}}));
        let mut n = 0;
        for (sessao, esperado) in [
            (como("u-fora", false), 403u16),
            (Some(json!({"ok": true, "logado": false, "usuario": null})), 403),
            (como("u-dono", false), 200),
            (como("u-colab", false), 200),
            (como("u-admin", true), 200),
            (None, 200), // Hub antigo, sem login: liberado
        ] {
            *resposta.lock().unwrap() = sessao.clone();
            est.sessao.esquece();
            n += 1;
            let txt = format!("var changes = [\n{{\"op\":\"via_add\",\"x\":{n},\"y\":1}},\n];\n");
            let r = api_save(State(est.clone()), Json(grava(&txt))).await;
            assert_eq!(r.status().as_u16(), esperado, "{sessao:?}");
            let disco = std::fs::read_to_string(pdir.join("changes.js")).unwrap();
            assert_eq!(disco == txt, esperado == 200, "{sessao:?}");
            if esperado == 403 {
                let b = axum::body::to_bytes(r.into_body(), 1 << 20).await.unwrap();
                let j: Value = serde_json::from_slice(&b).unwrap();
                assert_eq!(j["codigo"], "sem_permissao");
                assert!(j["error"].as_str().unwrap().contains("Davi Dono"));
            }
        }
        // sem responsavel: qualquer logado
        std::fs::remove_file(pdir.join("equipe.json")).unwrap();
        *resposta.lock().unwrap() = como("u-fora", false);
        est.sessao.esquece();
        assert_eq!(api_save(State(est.clone()), Json(grava("var changes = [\n];\n"))).await.status().as_u16(), 200);
        let _ = std::fs::remove_dir_all(&root);
    }
}
