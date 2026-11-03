//! O canal entre o servidor MCP e a VISTA ABERTA (o mcp/rotas_hub.py, mesmo contrato):
//!   MCP  --POST /api/mcp/pedido {alvo, proj, acao, args}-->  hub (guarda, devolve {id})
//!   vista --GET  /api/mcp/pedidos?alvo=pcb&proj=X-------->  hub (o que ha para ela)
//!   vista --POST /api/mcp/resposta/<id> {ok, dados}------->  hub
//!   MCP  --GET  /api/mcp/resposta/<id>?espera=8---------->  hub (espera a resposta ate N s)
//! mais a presenca da IA (/ola) e o historico (/atividade). Fila em memoria; pedido so desta maquina.

use crate::Est;
use axum::extract::{ConnectInfo, Path as AxPath, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::Notify;

const VERSAO: &str = "1.0.0";
const VALIDADE: f64 = 30.0;
const VISTA_VIVA: f64 = 10.0;
const ESPERA_MAX: f64 = 20.0;
const SESSAO_VIVA: f64 = 60.0;
const MAX_ATIVIDADE: usize = 300;
/// pedido que a vista JA pegou e ainda esta fazendo (as fotos 3D do render3d esperam os STEP e o Real
/// View): fica guardado ate isto -- o mesmo PEGO_MAX do mcp/rotas_hub.py (NexoEletric 1.52.0)
const PEGO_MAX: f64 = 240.0;
const ACOES: [&str; 7] = ["screenshot", "recarregar", "focar", "selecionar", "comando", "abrir", "render3d"];
const ALVOS: [&str; 3] = ["pcb", "sch", "hub"];

struct Pedido {
    alvo: String,
    proj: String,
    acao: String,
    args: Value,
    criado: Instant,
    pego: bool,
    resposta: Option<Value>,
}

#[derive(Default)]
struct Dados {
    pedidos: HashMap<String, Pedido>,
    vistas: HashMap<(String, String), Instant>,
    sessoes: HashMap<String, Value>,
    atividade: Vec<Value>,
    seq: u64,
}

#[derive(Default)]
pub struct Mcp {
    d: Mutex<Dados>,
    aviso: Notify,
}

fn agora() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}
fn texto(v: Option<&Value>, n: usize) -> String {
    v.and_then(|x| x.as_str()).map(|s| s.chars().take(n).collect()).unwrap_or_default()
}
fn local(a: &SocketAddr) -> bool {
    a.ip().is_loopback()
}
fn erro(st: StatusCode, m: &str) -> Response {
    (st, Json(json!({"ok": false, "error": m}))).into_response()
}

impl Dados {
    fn limpa(&mut self) {
        self.pedidos.retain(|_, p| {
            let teto = if p.pego && p.resposta.is_none() { PEGO_MAX } else { ESPERA_MAX };
            p.criado.elapsed().as_secs_f64() <= VALIDADE + teto
        });
        self.vistas.retain(|_, t| t.elapsed().as_secs_f64() <= 300.0);
    }
}

pub async fn status(State(est): State<Est>) -> Json<Value> {
    let d = est.mcp.d.lock().unwrap();
    let vistas: Vec<Value> = d
        .vistas
        .iter()
        .filter(|(_, t)| t.elapsed().as_secs_f64() <= VISTA_VIVA)
        .map(|((a, p), t)| json!({"alvo": a, "proj": p, "ha_segundos": (t.elapsed().as_secs_f64() * 10.0).round() / 10.0}))
        .collect();
    Json(json!({"ok": true, "root": est.cfg.root.to_string_lossy(), "versao": VERSAO, "vistas": vistas}))
}

pub async fn pedido(State(est): State<Est>, ConnectInfo(a): ConnectInfo<SocketAddr>, Json(d): Json<Value>) -> Response {
    if !local(&a) {
        return erro(StatusCode::FORBIDDEN, "pedido a vista so vem desta maquina");
    }
    let alvo = texto(d.get("alvo"), 16);
    let proj = texto(d.get("proj"), 400);
    let acao = texto(d.get("acao"), 32);
    if !ALVOS.contains(&alvo.as_str()) || !ACOES.contains(&acao.as_str()) || proj.is_empty() {
        return erro(StatusCode::BAD_REQUEST, &format!("alvo (pcb|sch|hub), proj e acao ({}) obrigatorios", ACOES.join("|")));
    }
    let args = d.get("args").filter(|v| v.is_object()).cloned().unwrap_or(json!({}));
    let id = uuid::Uuid::new_v4().simple().to_string();
    let viva;
    {
        let mut m = est.mcp.d.lock().unwrap();
        m.limpa();
        viva = m.vistas.get(&(alvo.clone(), proj.clone())).map(|t| t.elapsed().as_secs_f64() <= VISTA_VIVA).unwrap_or(false);
        m.pedidos.insert(id.clone(), Pedido { alvo, proj, acao, args, criado: Instant::now(), pego: false, resposta: None });
    }
    est.mcp.aviso.notify_waiters();
    Json(json!({"ok": true, "id": id, "vista_aberta": viva})).into_response()
}

pub async fn pedidos(State(est): State<Est>, Query(q): Query<HashMap<String, String>>) -> Json<Value> {
    let alvo = q.get("alvo").cloned().unwrap_or_default();
    let proj = q.get("proj").cloned().unwrap_or_default();
    let mut m = est.mcp.d.lock().unwrap();
    m.vistas.insert((alvo.clone(), proj.clone()), Instant::now());
    m.limpa();
    let mut fila = Vec::new();
    for (id, p) in m.pedidos.iter_mut() {
        if p.alvo == alvo && p.proj == proj && !p.pego && p.criado.elapsed().as_secs_f64() <= VALIDADE {
            p.pego = true;
            fila.push(json!({"id": id, "acao": p.acao, "args": p.args}));
        }
    }
    Json(json!({"ok": true, "pedidos": fila}))
}

pub async fn resposta_grava(State(est): State<Est>, AxPath(pid): AxPath<String>, Json(d): Json<Value>) -> Response {
    {
        let mut m = est.mcp.d.lock().unwrap();
        let Some(p) = m.pedidos.get_mut(&pid) else { return erro(StatusCode::NOT_FOUND, "pedido desconhecido ou vencido") };
        p.resposta = Some(json!({"ok": d.get("ok").and_then(|v| v.as_bool()).unwrap_or(false), "dados": d.get("dados"), "erro": d.get("erro")}));
    }
    est.mcp.aviso.notify_waiters();
    Json(json!({"ok": true})).into_response()
}

pub async fn resposta_espera(
    State(est): State<Est>,
    ConnectInfo(a): ConnectInfo<SocketAddr>,
    AxPath(pid): AxPath<String>,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    if !local(&a) {
        return erro(StatusCode::FORBIDDEN, "so desta maquina");
    }
    let espera = q.get("espera").and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0).clamp(0.0, ESPERA_MAX);
    let fim = Instant::now() + Duration::from_secs_f64(espera);
    loop {
        let aviso = est.mcp.aviso.notified();
        {
            let mut m = est.mcp.d.lock().unwrap();
            let Some(p) = m.pedidos.get(&pid) else { return erro(StatusCode::NOT_FOUND, "pedido desconhecido ou vencido") };
            if let Some(r) = p.resposta.clone() {
                m.pedidos.remove(&pid);
                return Json(r).into_response();
            }
            if Instant::now() >= fim {
                let msg = if p.pego {
                    "a vista pegou o pedido mas nao respondeu a tempo"
                } else {
                    "nenhuma vista aberta deste projeto pegou o pedido (a pagina precisa do mcp/hub-mcpvista.js)"
                };
                return Json(json!({"ok": false, "pendente": true, "pego": p.pego, "erro": msg})).into_response();
            }
        }
        let _ = tokio::time::timeout(fim.saturating_duration_since(Instant::now()), aviso).await;
    }
}

pub async fn ola(State(est): State<Est>, ConnectInfo(a): ConnectInfo<SocketAddr>, Json(d): Json<Value>) -> Response {
    if !local(&a) {
        return erro(StatusCode::FORBIDDEN, "so desta maquina");
    }
    let Some(sessao) = d.get("sessao").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) else {
        return erro(StatusCode::BAD_REQUEST, "JSON {sessao, cliente, ...} obrigatorio");
    };
    let t = agora();
    let mut m = est.mcp.d.lock().unwrap();
    let s = m
        .sessoes
        .entry(sessao.to_string())
        .or_insert_with(|| json!({"sessao": sessao.chars().take(64).collect::<String>(), "desde": t, "chamadas": 0}));
    let cliente = texto(d.get("cliente"), 80);
    s["cliente"] = json!(if cliente.is_empty() { "IA".to_string() } else { cliente });
    s["versao"] = json!(texto(d.get("versao"), 20));
    s["raiz"] = json!(texto(d.get("raiz"), 260));
    s["visto"] = json!(t);
    s["ferramentas"] = json!(d.get("ferramentas").and_then(|v| v.as_i64()).unwrap_or(0));
    m.sessoes.retain(|_, v| t - v["visto"].as_f64().unwrap_or(0.0) <= 3600.0);
    Json(json!({"ok": true})).into_response()
}

pub async fn atividade_grava(State(est): State<Est>, ConnectInfo(a): ConnectInfo<SocketAddr>, Json(d): Json<Value>) -> Response {
    if !local(&a) {
        return erro(StatusCode::FORBIDDEN, "so desta maquina");
    }
    let Some(ferr) = d.get("ferramenta").and_then(|v| v.as_str()) else {
        return erro(StatusCode::BAD_REQUEST, "JSON {sessao, ferramenta, ok, ...} obrigatorio");
    };
    let t = agora();
    let mut m = est.mcp.d.lock().unwrap();
    let sessao = texto(d.get("sessao"), 64);
    let cliente = match m.sessoes.get_mut(&sessao) {
        Some(s) => {
            s["visto"] = json!(t);
            s["chamadas"] = json!(s["chamadas"].as_i64().unwrap_or(0) + 1);
            s["cliente"].as_str().unwrap_or("IA").to_string()
        }
        None => "IA".to_string(),
    };
    m.seq += 1;
    let seq = m.seq;
    m.atividade.push(json!({
        "seq": seq, "t": t, "sessao": sessao, "cliente": cliente,
        "ferramenta": ferr.chars().take(64).collect::<String>(), "titulo": texto(d.get("titulo"), 80),
        "ok": d.get("ok").and_then(|v| v.as_bool()).unwrap_or(false), "erro": texto(d.get("erro"), 300),
        "ms": d.get("ms").and_then(|v| v.as_f64()).unwrap_or(0.0), "projeto": texto(d.get("projeto"), 120),
        "resumo": texto(d.get("resumo"), 200), "escrita": d.get("escrita").and_then(|v| v.as_bool()).unwrap_or(false),
    }));
    let n = m.atividade.len();
    if n > MAX_ATIVIDADE {
        m.atividade.drain(..n - MAX_ATIVIDADE);
    }
    Json(json!({"ok": true, "seq": seq})).into_response()
}

pub async fn atividade_le(State(est): State<Est>, Query(q): Query<HashMap<String, String>>) -> Json<Value> {
    let desde = q.get("desde").and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
    let t = agora();
    let m = est.mcp.d.lock().unwrap();
    let itens: Vec<&Value> = m.atividade.iter().filter(|a| a["seq"].as_u64().unwrap_or(0) > desde).collect();
    let itens: Vec<&Value> = itens[itens.len().saturating_sub(100)..].to_vec();
    let sessoes: Vec<Value> = m
        .sessoes
        .values()
        .filter(|s| t - s["visto"].as_f64().unwrap_or(0.0) <= SESSAO_VIVA)
        .map(|s| {
            let mut s = s.clone();
            s["ha_segundos"] = json!(((t - s["visto"].as_f64().unwrap_or(0.0)) * 10.0).round() / 10.0);
            s
        })
        .collect();
    Json(json!({"ok": true, "seq": m.seq, "agora": t, "sessoes": sessoes, "itens": itens}))
}
