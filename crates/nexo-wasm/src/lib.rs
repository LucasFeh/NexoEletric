//! A vista PCB web (pcbframe.js) manda a placa efetiva (EB, formato do board.js) e o que a tela ja
//! resolveu (cores, regras, textos); aqui ela vira a malha da GPU com o mesmo `nexo_core::scene`
//! do app nativo. Interface C minima, sem wasm-bindgen:
//!   nx_alloc(n) -> ptr ; nx_free(ptr, n)
//!   nx_cena(ptr, len) -> *const u32  (cabecalho: ok, verts, n_verts, idx, n_idx, caps, n_caps, meta, n_meta)
//! O resultado fica guardado aqui ate a proxima chamada (o JS copia para a GPU antes).

use nexo_core::scene::{self, BuildOpts, LayerMesh, TextIn};
use nexo_core::{layers, Board};
use serde::Deserialize;
use std::cell::RefCell;
use std::collections::HashMap;

#[derive(Deserialize, Default)]
#[serde(default)]
struct Entrada {
    eb: serde_json::Value,
    cores: HashMap<String, String>,
    flip: bool,
    sm: Option<f64>,
    pm: Option<f64>,
    textos: Option<Vec<TextIn>>,
}

struct Saida {
    cena: scene::Scene,
    meta: String,
    cab: [u32; 9],
}

thread_local! {
    static ULTIMA: RefCell<Option<Saida>> = const { RefCell::new(None) };
}

#[no_mangle]
pub extern "C" fn nx_alloc(n: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(n.max(1));
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// # Safety
/// `p` e `n` vem de um `nx_alloc` anterior.
#[no_mangle]
pub unsafe extern "C" fn nx_free(p: *mut u8, n: usize) {
    drop(Vec::from_raw_parts(p, 0, n.max(1)));
}

fn faixa(m: &Option<LayerMesh>) -> serde_json::Value {
    match m {
        Some(m) => serde_json::json!([m.tris.start, m.tris.end, m.caps.start, m.caps.end]),
        None => serde_json::json!([0, 0, 0, 0]),
    }
}

fn monta(bytes: &[u8]) -> Result<(scene::Scene, String), String> {
    let mut e: Entrada = serde_json::from_slice(bytes).map_err(|e| format!("entrada: {e}"))?;
    nexo_core::jsfile::strip_nulls(&mut e.eb);
    let eb: Board = serde_json::from_value(e.eb).map_err(|e| format!("placa: {e}"))?;
    let cores = e.cores.iter().map(|(k, v)| (k.clone(), layers::hex(v))).collect();
    let opts = BuildOpts {
        flipped: e.flip,
        ghosts: None,
        colors: Some(cores),
        texts: e.textos,
        sm: e.sm,
        pm: e.pm,
        sem_poligonos: true,
    };
    let sc = scene::build(&eb, &opts);
    let camadas: serde_json::Map<String, serde_json::Value> =
        sc.layers.iter().map(|l| (l.key.clone(), faixa(&Some(l.clone())))).collect();
    let meta = serde_json::json!({
        "camadas": camadas,
        "placa": faixa(&sc.board),
        "furos": faixa(&sc.drills),
        "contorno": faixa(&sc.outline),
        "caixa": [sc.extents.x1, sc.extents.y1, sc.extents.x2, sc.extents.y2],
        "triangulos": sc.stats.triangles,
        "capsulas": sc.stats.capsules,
    })
    .to_string();
    Ok((sc, meta))
}

/// # Safety
/// `p`/`n` apontam para o JSON de entrada escrito pelo JS na memoria do modulo.
#[no_mangle]
pub unsafe extern "C" fn nx_cena(p: *const u8, n: usize) -> *const u32 {
    let bytes = std::slice::from_raw_parts(p, n);
    ULTIMA.with(|u| {
        let mut u = u.borrow_mut();
        let (cena, meta, ok) = match monta(bytes) {
            Ok((c, m)) => (c, m, 1),
            Err(e) => (scene::Scene::default(), serde_json::json!({ "erro": e }).to_string(), 0),
        };
        let mut s = Saida { cena, meta, cab: [0; 9] };
        s.cab = [
            ok,
            s.cena.verts.as_ptr() as u32,
            s.cena.verts.len() as u32,
            s.cena.indices.as_ptr() as u32,
            s.cena.indices.len() as u32,
            s.cena.caps.as_ptr() as u32,
            s.cena.caps.len() as u32,
            s.meta.as_ptr() as u32,
            s.meta.len() as u32,
        ];
        *u = Some(s);
        u.as_ref().unwrap().cab.as_ptr()
    })
}
