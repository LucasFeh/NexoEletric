//! /api/index.json e /api/project/<id>.json -- o build_index/build_detail do hubserver.py.
//! O Python reinterpretava o board.js de TODOS os projetos a cada pedido do indice e reescrevia a
//! placa e o esquema inteiros no detalhe. Aqui: cada projeto lido uma vez por data de modificacao
//! (em paralelo), e a placa/esquema vao na resposta como o texto JSON que ja sao.

use crate::Est;
use axum::extract::{Path as AxPath, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use nexo_core::jsfile;
use nexo_core::model::Board;
use rayon::prelude::*;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Default)]
pub struct Cache {
    linhas: Mutex<HashMap<String, (Carimbo, Value)>>,
    detalhes: Mutex<HashMap<String, (Carimbo, Arc<String>)>>,
    ids: Mutex<HashMap<String, String>>,
    fplib: Mutex<Option<(Option<SystemTime>, Arc<HashMap<String, (String, usize)>>)>>,
}

impl Cache {
    pub fn esquece(&self, nome: &str) {
        self.linhas.lock().unwrap().remove(nome);
        self.detalhes.lock().unwrap().retain(|k, _| k != nome);
    }
}

type Carimbo = Vec<Option<(SystemTime, u64)>>;

fn carimbo(d: &Path, nomes: &[&str]) -> Carimbo {
    nomes.iter().map(|n| std::fs::metadata(d.join(n)).ok().and_then(|m| Some((m.modified().ok()?, m.len())))).collect()
}

fn mtime(p: &Path) -> f64 {
    std::fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

pub fn proj_id(nome: &str) -> String {
    let mut s = String::new();
    let mut traco = false;
    for c in nome.to_lowercase().chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            s.push(c);
            traco = false;
        } else if !traco {
            s.push('-');
            traco = true;
        }
    }
    let s = s.trim_matches('-').to_string();
    if s.is_empty() {
        "proj".into()
    } else {
        s
    }
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Contagem {
    components: Vec<serde::de::IgnoredAny>,
    nets: Vec<serde::de::IgnoredAny>,
    tracks: Vec<serde::de::IgnoredAny>,
    vias: Vec<serde::de::IgnoredAny>,
    generated: Option<Value>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct ItemSch {
    t: String,
}
#[derive(Deserialize, Default)]
#[serde(default)]
struct Esquema {
    items: Vec<ItemSch>,
    params: Option<Value>,
}

/// 1.88.0: a PCB do projeto (o rotulo da arvore): CodigoDaPlaca e NomeDaPlaca do cabecalho do schematic.js (o campo plano
/// `K=V;K=V`), como o _placa_do_esquema do hubserver.py
pub fn placa_dos_params(params: Option<&str>) -> Value {
    let (mut codigo, mut nome) = (String::new(), String::new());
    for par in params.unwrap_or("").split(';') {
        let Some((k, v)) = par.split_once('=') else { continue };
        let v = v.split_whitespace().collect::<Vec<_>>().join(" ");
        match k.trim() {
            "CodigoDaPlaca" if v.to_uppercase() != "PROJETO NÃO DEFINIDO" => codigo = v,
            "NomeDaPlaca" => nome = v,
            _ => {}
        }
    }
    json!({"codigo": codigo, "nome": nome})
}

/// 1.88.0: quantas variantes de projeto (Projects/<p>/variantes.json)
fn conta_variantes(d: &Path) -> usize {
    std::fs::read_to_string(d.join("variantes.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(t.trim_start_matches('\u{feff}')).ok())
        .and_then(|j| j.get("variantes").and_then(|v| v.as_array()).map(|a| a.len()))
        .unwrap_or(0)
}

fn le(p: &Path) -> Option<String> {
    let b = std::fs::read(p).ok()?;
    Some(String::from_utf8_lossy(&b).into_owned())
}

fn grupo_de(d: &Path) -> String {
    std::fs::read_to_string(d.join("grupo.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(t.trim_start_matches('\u{feff}')).ok())
        .and_then(|j| j.get("grupo").and_then(|g| g.as_str()).map(|g| g.trim().to_string()).filter(|g| !g.is_empty()))
        .unwrap_or_default()
}

fn conta_ops(src: &str) -> usize {
    match jsfile::parse_js_value(src) {
        Ok(Value::Array(a)) => a.iter().filter(|c| c.get("op").and_then(|o| o.as_str()).map(|o| !o.is_empty()).unwrap_or(false)).count(),
        _ => 0,
    }
}

const ARQS_LINHA: [&str; 6] = ["board.js", "schematic.js", "changes.js", "apply-report.txt", "grupo.json", "variantes.json"];

fn linha(nome: &str, d: &Path) -> Value {
    let has_sch = d.join("schematic.js").is_file();
    let has_board = d.join("board.js").is_file();
    let board: Option<Contagem> = if has_board { le(&d.join("board.js")).and_then(|s| jsfile::parse_js(&s).ok()) } else { None };
    let mut st = json!({"sheets": 0, "comps": 0, "nets": 0, "tracks": 0, "vias": 0});
    if let Some(b) = &board {
        st["comps"] = json!(b.components.len());
        st["nets"] = json!(b.nets.len());
        st["tracks"] = json!(b.tracks.len());
        st["vias"] = json!(b.vias.len());
    }
    let mut placa = placa_dos_params(None);
    if has_sch {
        if let Some(sch) = le(&d.join("schematic.js")).and_then(|s| jsfile::parse_js::<Esquema>(&s).ok()) {
            placa = placa_dos_params(sch.params.as_ref().and_then(|v| v.as_str()));
            st["sheets"] = json!(sch.items.iter().filter(|i| i.t == "sheet").count());
            if board.is_none() {
                st["comps"] = json!(sch.items.iter().filter(|i| i.t == "comp").count());
            }
        }
    }
    let ch = d.join("changes.js");
    let applied_at = mtime(&d.join("apply-report.txt"));
    let mut pending = 0;
    if ch.is_file() && mtime(&ch) > applied_at {
        pending = le(&ch).map(|s| conta_ops(&s)).unwrap_or(0);
    }
    let tracks = st["tracks"].as_u64().unwrap_or(0);
    let feito = [has_sch || has_board, has_board, tracks > 0, applied_at > 0.0 && applied_at >= mtime(&ch)];
    let mut stages: Vec<u8> = feito.iter().map(|v| *v as u8).collect();
    if let Some(i) = stages.iter().position(|v| *v == 0) {
        stages[i] = 2;
    }
    json!({
        "id": proj_id(nome), "name": nome, "path": format!("Projects\\{nome}"),
        "demo": nome.starts_with('_'), "noSchematic": !has_sch,
        "stages": stages, "pending": pending, "stats": st, "grupo": grupo_de(d),
        "placa": placa, "variantes": conta_variantes(d),
    })
}

fn nomes(root: &Path) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(root.join("Projects"))
        .map(|rd| rd.flatten().filter(|e| e.path().is_dir()).map(|e| e.file_name().to_string_lossy().into_owned()).collect())
        .unwrap_or_default();
    v.sort();
    v
}

pub fn indice(est: &Est) -> Value {
    let root = est.cfg.root.clone();
    let lista = nomes(&root);
    let cache = &est.index;
    let projetos: Vec<Value> = lista
        .par_iter()
        .map(|n| {
            let d = root.join("Projects").join(n);
            let c = carimbo(&d, &ARQS_LINHA);
            if let Some((cc, v)) = cache.linhas.lock().unwrap().get(n) {
                if *cc == c {
                    return v.clone();
                }
            }
            let v = linha(n, &d);
            cache.linhas.lock().unwrap().insert(n.clone(), (c, v.clone()));
            v
        })
        .collect();
    let mut ids = est.index.ids.lock().unwrap();
    ids.clear();
    for p in &projetos {
        ids.insert(p["id"].as_str().unwrap_or("").to_string(), p["name"].as_str().unwrap_or("").to_string());
    }
    json!({ "generatedAt": chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string(), "projects": projetos })
}

pub async fn api_index(State(est): State<Est>) -> Response {
    if let Some(r) = crate::gate::bloqueia(&est, "/api/index.json") {
        return r;
    }
    let e = est.clone();
    let v = tokio::task::spawn_blocking(move || indice(&e)).await.unwrap_or(json!({"projects": []}));
    Json(v).into_response()
}

fn fmt_when(ts: f64) -> String {
    if ts <= 0.0 {
        return String::new();
    }
    chrono::DateTime::from_timestamp(ts as i64, 0)
        .map(|d| d.with_timezone(&chrono::Local).format("%Y-%m-%d %H:%M").to_string())
        .unwrap_or_default()
}

fn fplib(est: &Est) -> Arc<HashMap<String, (String, usize)>> {
    let p = est.cfg.root.join("Libs").join("pcblib.js");
    let m = std::fs::metadata(&p).and_then(|m| m.modified()).ok();
    let mut g = est.index.fplib.lock().unwrap();
    if let Some((mm, v)) = &*g {
        if *mm == m {
            return v.clone();
        }
    }
    #[derive(Deserialize, Default)]
    #[serde(default)]
    struct Fp {
        name: String,
        desc: Option<String>,
        description: Option<String>,
        pads: Vec<serde::de::IgnoredAny>,
    }
    #[derive(Deserialize, Default)]
    #[serde(default)]
    struct Lib {
        footprints: Vec<Fp>,
    }
    let lib: Lib = le(&p).and_then(|s| jsfile::parse_js(&s).ok()).unwrap_or_default();
    let v: Arc<HashMap<String, (String, usize)>> = Arc::new(
        lib.footprints
            .into_iter()
            .map(|f| (f.name, (f.desc.filter(|d| !d.is_empty()).or(f.description).unwrap_or_default(), f.pads.len())))
            .collect(),
    );
    *g = Some((m, v.clone()));
    v
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct CompSch {
    t: String,
    #[serde(rename = "ref")]
    refdes: String,
    comment: String,
    footprint: String,
    x: f64,
    y: f64,
    rot: f64,
}
#[derive(Deserialize, Default)]
#[serde(default)]
struct EsquemaComp {
    items: Vec<CompSch>,
    generated: Option<Value>,
}

fn num_g(v: f64) -> String {
    // o %g do Python para os numeros que aparecem aqui
    if v == v.trunc() && v.abs() < 1e15 {
        format!("{}", v as i64)
    } else {
        let s = format!("{:.6}", v);
        s.trim_end_matches('0').trim_end_matches('.').to_string()
    }
}

fn detalhe(est: &Est, nome: &str) -> String {
    let d = est.cfg.root.join("Projects").join(nome);
    let bsrc = le(&d.join("board.js"));
    let ssrc = le(&d.join("schematic.js"));
    let board: Option<Board> = bsrc.as_deref().and_then(|s| jsfile::parse_js(s).ok());
    let gen_b: Option<Value> = bsrc.as_deref().and_then(|s| jsfile::parse_js::<Contagem>(s).ok()).and_then(|c| c.generated);
    let sch: Option<EsquemaComp> = ssrc.as_deref().and_then(|s| jsfile::parse_js(s).ok());
    let fps = fplib(est);

    let mut comps: Vec<Value> = Vec::new();
    if let Some(b) = &board {
        for c in &b.components {
            let mut nets: Vec<&str> = c.pads.iter().map(|p| p.net.as_str()).filter(|n| !n.is_empty()).collect();
            nets.sort();
            nets.dedup();
            comps.push(json!({
                "des": c.refdes, "value": c.comment, "footprint": c.footprint, "lib": "",
                "pins": c.pads.len(), "layer": c.layer,
                "pos": format!("{:.2}, {:.2} mm", c.x, c.y), "rot": format!("{}°", num_g(c.rot)), "nets": nets,
            }));
        }
    } else if let Some(s) = &sch {
        for it in s.items.iter().filter(|i| i.t == "comp") {
            comps.push(json!({
                "des": it.refdes, "value": it.comment, "footprint": it.footprint, "lib": "",
                "pins": fps.get(&it.footprint).map(|f| f.1).unwrap_or(0), "layer": "",
                "pos": format!("{}, {} mil", num_g(it.x), num_g(it.y)), "rot": format!("{}°", num_g(it.rot)), "nets": [],
            }));
        }
    }
    let mut nets: Vec<Value> = Vec::new();
    if let Some(b) = &board {
        let mut pads: HashMap<&str, usize> = HashMap::new();
        let mut tr: HashMap<&str, usize> = HashMap::new();
        let mut larg: HashMap<&str, f64> = HashMap::new();
        for c in &b.components {
            for p in c.pads.iter().filter(|p| !p.net.is_empty()) {
                *pads.entry(p.net.as_str()).or_default() += 1;
            }
        }
        for t in b.tracks.iter().filter(|t| !t.net.is_empty()) {
            *tr.entry(t.net.as_str()).or_default() += 1;
            larg.entry(t.net.as_str()).or_insert(t.w);
        }
        for n in &b.nets {
            nets.push(json!({
                "name": n, "cls": "—", "nodes": pads.get(n.as_str()).copied().unwrap_or(0),
                "tracks": tr.get(n.as_str()).copied().unwrap_or(0),
                "width": larg.get(n.as_str()).map(|w| format!("{} mm", num_g(*w))).unwrap_or("—".into()),
            }));
        }
    }
    let mut uso: BTreeMap<String, usize> = BTreeMap::new();
    for c in &comps {
        let f = c["footprint"].as_str().unwrap_or("");
        if !f.is_empty() {
            *uso.entry(f.to_string()).or_default() += 1;
        }
    }
    let footprints: Vec<Value> = uso
        .iter()
        .map(|(f, n)| {
            let (desc, np) = fps.get(f).cloned().unwrap_or_default();
            json!({"name": f, "lib": "pcblib", "desc": if desc.is_empty() { "—".to_string() } else { desc },
                   "usage": format!("{n} componente{}", if *n != 1 { "s" } else { "" }), "pads": format!("{np} pads")})
        })
        .collect();
    let mut hist: Vec<(f64, Value)> = Vec::new();
    if let Some(t) = le(&d.join("history.jsonl")) {
        for l in t.lines().map(str::trim).filter(|l| !l.is_empty()) {
            if let Ok(v) = serde_json::from_str::<Value>(l) {
                hist.push((v.get("ts").and_then(|x| x.as_f64()).unwrap_or(0.0), v));
            }
        }
    }
    for (f, titulo) in [("apply-report.txt", "ApplyChanges executado"), ("build-report.txt", "BuildSchematic executado")] {
        let ts = mtime(&d.join(f));
        if ts > 0.0 {
            hist.push((ts, json!({"when": fmt_when(ts), "kind": "ok", "title": titulo, "detail": format!("Projects\\{nome}\\{f}")})));
        }
    }
    let texto = |v: &Value| match v {
        Value::String(s) => s.clone(),
        o => o.to_string(),
    };
    if let Some(g) = gen_b.filter(|g| !g.is_null() && g.as_str() != Some("")) {
        hist.push((mtime(&d.join("board.js")), json!({"when": texto(&g), "kind": "ok", "title": "ExportBoard concluído", "detail": "board.js atualizado"})));
    }
    if let Some(g) = sch.as_ref().and_then(|s| s.generated.clone()).filter(|g| !g.is_null() && g.as_str() != Some("")) {
        hist.push((mtime(&d.join("schematic.js")), json!({"when": texto(&g), "kind": "ok", "title": "schematic.js atualizado", "detail": format!("Projects\\{nome}\\schematic.js")})));
    }
    hist.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    let history: Vec<Value> = hist
        .into_iter()
        .map(|(_, mut v)| {
            if let Some(o) = v.as_object_mut() {
                o.remove("ts");
            }
            v
        })
        .collect();
    let corpo = |src: &Option<String>, ok: bool| if ok { src.as_deref().map(jsfile::js_body).unwrap_or("{}".into()) } else { "{}".into() };
    let sch_txt = corpo(&ssrc, sch.is_some());
    let board_txt = corpo(&bsrc, board.is_some());
    let cabeca = json!({"name": nome, "components": comps, "nets": nets, "footprints": footprints, "history": history}).to_string();
    // {cabeca..., "schematic": <texto>, "board": <texto>}
    let mut out = String::with_capacity(cabeca.len() + sch_txt.len() + board_txt.len() + 32);
    out.push_str(&cabeca[..cabeca.len() - 1]);
    out.push_str(",\"schematic\":");
    out.push_str(&sch_txt);
    out.push_str(",\"board\":");
    out.push_str(&board_txt);
    out.push('}');
    out
}

const ARQS_DETALHE: [&str; 6] = ["board.js", "schematic.js", "history.jsonl", "apply-report.txt", "build-report.txt", "grupo.json"];

pub async fn api_project(State(est): State<Est>, AxPath(arquivo): AxPath<String>) -> Response {
    if let Some(r) = crate::gate::bloqueia(&est, "/api/project/") {
        return r;
    }
    let Some(id) = arquivo.strip_suffix(".json").map(str::to_string) else { return StatusCode::NOT_FOUND.into_response() };
    let e = est.clone();
    let r = tokio::task::spawn_blocking(move || -> Option<Arc<String>> {
        let mut nome = e.index.ids.lock().unwrap().get(&id).cloned();
        if nome.is_none() {
            indice(&e);
            nome = e.index.ids.lock().unwrap().get(&id).cloned();
        }
        let nome = nome?;
        let d: PathBuf = e.cfg.root.join("Projects").join(&nome);
        let c = carimbo(&d, &ARQS_DETALHE);
        if let Some((cc, v)) = e.index.detalhes.lock().unwrap().get(&nome) {
            if *cc == c {
                return Some(v.clone());
            }
        }
        let v = Arc::new(detalhe(&e, &nome));
        e.index.detalhes.lock().unwrap().insert(nome, (c, v.clone()));
        Some(v)
    })
    .await
    .ok()
    .flatten();
    match r {
        Some(s) => ([(header::CONTENT_TYPE, "application/json"), (header::CACHE_CONTROL, "no-store")], (*s).clone()).into_response(),
        None => (StatusCode::NOT_FOUND, Json(json!({"error": "projeto desconhecido"}))).into_response(),
    }
}

#[cfg(test)]
mod tests {
    //! 1.88.0: o rotulo da arvore pelo nome da PCB (o mesmo _placa_do_esquema do hubserver.py)
    use super::placa_dos_params;
    use serde_json::json;

    #[test]
    fn placa_vem_do_cabecalho() {
        assert_eq!(placa_dos_params(Some("CodigoDaPlaca=PAEL-DI261940;NomeDaPlaca=PLACA ADAPTADORA  ENCODER LINEAR COM NOME BEM COMPRIDO;Revisao=REV.A")),
                   json!({"codigo": "PAEL-DI261940", "nome": "PLACA ADAPTADORA ENCODER LINEAR COM NOME BEM COMPRIDO"}));
        assert_eq!(placa_dos_params(Some("CodigoDaPlaca=PROJETO NÃO DEFINIDO")), json!({"codigo": "", "nome": ""}));
        assert_eq!(placa_dos_params(None), json!({"codigo": "", "nome": ""}));
    }
}
