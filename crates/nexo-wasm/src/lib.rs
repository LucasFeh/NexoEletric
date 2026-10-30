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

// ---------------- a placa solida do 3D ----------------

#[derive(Deserialize, Default)]
#[serde(default)]
struct Entrada3d {
    lacos: Vec<Vec<[f64; 2]>>,
    recortes: Vec<Vec<[f64; 2]>>,
    furos: Vec<[f64; 3]>,
    esp: f64,
    seg: usize,
}

struct Saida3d {
    p: nexo_core::solido::Placa3d,
    cab: [u32; 10],
}

thread_local! {
    static ULTIMA3D: RefCell<Option<Saida3d>> = const { RefCell::new(None) };
}

/// # Safety
/// `p`/`n` apontam para o JSON {lacos, recortes, furos:[[x,y,r]], esp, seg} escrito pelo JS.
/// Cabecalho: ok, tampa_xy, n_vert_tampa, tampa_idx, n_idx_tampa, lado_pos, n_vert_lado, lado_nor, lado_idx, n_idx_lado.
#[no_mangle]
pub unsafe extern "C" fn nx_placa3d(p: *const u8, n: usize) -> *const u32 {
    let bytes = std::slice::from_raw_parts(p, n);
    let placa = serde_json::from_slice::<Entrada3d>(bytes)
        .ok()
        .and_then(|e| nexo_core::solido::placa(&e.lacos, &e.recortes, &e.furos, if e.esp > 0.0 { e.esp } else { 1.6 }, if e.seg > 0 { e.seg } else { 18 }));
    ULTIMA3D.with(|u| {
        let mut u = u.borrow_mut();
        let ok = placa.is_some() as u32;
        let mut s = Saida3d { p: placa.unwrap_or_default(), cab: [0; 10] };
        s.cab = [
            ok,
            s.p.tampa_xy.as_ptr() as u32,
            s.p.tampa_xy.len() as u32,
            s.p.tampa_idx.as_ptr() as u32,
            s.p.tampa_idx.len() as u32,
            s.p.lado_pos.as_ptr() as u32,
            s.p.lado_pos.len() as u32,
            s.p.lado_nor.as_ptr() as u32,
            s.p.lado_idx.as_ptr() as u32,
            s.p.lado_idx.len() as u32,
        ];
        *u = Some(s);
        u.as_ref().unwrap().cab.as_ptr()
    })
}

// ---------------- a malha de um modelo STEP ----------------

struct SaidaStep {
    m: nexo_core::step3d::Malha,
    cab: [u32; 10],
}

thread_local! {
    static ULTIMA_STEP: RefCell<Option<SaidaStep>> = const { RefCell::new(None) };
}

/// # Safety
/// `p` aponta para: u32 n_floats_pos, u32 n_idx, u32 n_faces; f32[n_floats_pos]; u32[n_idx];
/// faces de 6 palavras (u32 ini, u32 fim, f32 r, f32 g, f32 b, u32 tem_cor). Escrito pelo JS.
/// Cabecalho: ok, pos, n_vert, nor, uv, grupos (3 u32 cada), n_grupos, cores (3 f32 cada), n_cores, esfera (4 f32).
#[no_mangle]
pub unsafe extern "C" fn nx_step(p: *const u8, n: usize) -> *const u32 {
    let w = std::slice::from_raw_parts(p as *const u32, n / 4);
    let (np, ni, nf) = (w[0] as usize, w[1] as usize, w[2] as usize);
    let m = if 3 + np + ni + nf * 6 <= w.len() {
        let pos = std::slice::from_raw_parts(p.add(12) as *const f32, np);
        let idx = &w[3 + np..3 + np + ni];
        let fw = &w[3 + np + ni..3 + np + ni + nf * 6];
        let faces: Vec<nexo_core::step3d::Face> = fw
            .chunks(6)
            .map(|f| nexo_core::step3d::Face {
                ini: f[0],
                fim: f[1],
                cor: (f[5] != 0).then(|| [f32::from_bits(f[2]), f32::from_bits(f[3]), f32::from_bits(f[4])]),
            })
            .collect();
        nexo_core::step3d::prepara(pos, idx, &faces)
    } else {
        Default::default()
    };
    ULTIMA_STEP.with(|u| {
        let mut u = u.borrow_mut();
        let mut s = SaidaStep { m, cab: [0; 10] };
        s.cab = [
            (!s.m.pos.is_empty()) as u32,
            s.m.pos.as_ptr() as u32,
            (s.m.pos.len() / 3) as u32,
            s.m.nor.as_ptr() as u32,
            s.m.uv.as_ptr() as u32,
            s.m.grupos.as_ptr() as u32,
            s.m.grupos.len() as u32,
            s.m.cores.as_ptr() as u32,
            s.m.cores.len() as u32,
            s.m.esfera.as_ptr() as u32,
        ];
        *u = Some(s);
        u.as_ref().unwrap().cab.as_ptr()
    })
}

// ---------------- os mapas do Real View (hub-pcb3d-real.js » mapasDaFace) ----------------
// Cada pixel da face pintada pela vista 2D vira cor, rugosidade/metal, verniz e altura pela classe
// (mascara, cobre sob a mascara, FR4, pad, serigrafia) -- o mesmo laco do JS, em faixas de pixels
// (a memoria do WASM nao cresce com a textura inteira), com o MESMO ruido: o LCG do JS e as contas
// dele em double, e o Math.round (metade para cima). Saida conferida byte a byte com o original
// (bench/testes/mapas-iguais.mjs).

struct Classe {
    de: &'static [[u8; 3]],
    cor: Option<[f64; 3]>,
    rough: f64,
    metal: f64,
    coat: f64,
    alt: f64,
}
const CLASSES: [Classe; 5] = [
    Classe { de: &[[0x1b, 0x62, 0x33], [0x1d, 0x6b, 0x34], [0x1d, 0x5e, 0x33]], cor: Some([0.06, 0.29, 0.15]), rough: 0.42, metal: 0.0, coat: 1.0, alt: 60.0 },
    Classe { de: &[[0x2c, 0x84, 0x46]], cor: Some([0.13, 0.42, 0.22]), rough: 0.38, metal: 0.0, coat: 1.0, alt: 150.0 },
    Classe { de: &[[0xb8, 0xa7, 0x6f], [0xc9, 0xb9, 0x8a]], cor: Some([0.78, 0.71, 0.52]), rough: 0.82, metal: 0.0, coat: 0.0, alt: 0.0 },
    Classe { de: &[[0xd9, 0xd6, 0xcf], [0xd7, 0xd9, 0xde], [0xd0, 0xd2, 0xd4]], cor: None, rough: 0.34, metal: 1.0, coat: 0.0, alt: 140.0 },
    Classe { de: &[[0xf4, 0xf4, 0xf4], [0xff, 0xff, 0xff]], cor: Some([0.93, 0.93, 0.90]), rough: 0.88, metal: 0.0, coat: 0.0, alt: 200.0 },
];
const TABELA: usize = 1 << 16;

/// a classe de cada cor ja vista: tabela aberta (chave = cor + 1; 0 = vazio) e a ultima cor
struct Classes {
    chaves: Vec<u32>,
    classe: Vec<u8>,
    cheias: usize,
    ultima: (u32, usize),
}

impl Classes {
    fn nova() -> Classes {
        Classes { chaves: vec![0; TABELA], classe: vec![0; TABELA], cheias: 0, ultima: (0, 0) }
    }
    fn de(&mut self, r: u8, g: u8, b: u8) -> usize {
        let ch = (((r as u32) << 16) | ((g as u32) << 8) | b as u32) + 1;
        if self.ultima.0 == ch {
            return self.ultima.1;
        }
        let mut i = (ch.wrapping_mul(0x9E37_79B1) >> 16) as usize & (TABELA - 1);
        loop {
            let k = self.chaves[i];
            if k == ch {
                let c = self.classe[i] as usize;
                self.ultima = (ch, c);
                return c;
            }
            if k == 0 {
                break;
            }
            i = (i + 1) & (TABELA - 1);
        }
        let (mut best, mut ci) = (i64::MAX, 0usize);
        for (n, k) in CLASSES.iter().enumerate() {
            for q in k.de {
                let d = (q[0] as i64 - r as i64).pow(2) + (q[1] as i64 - g as i64).pow(2) + (q[2] as i64 - b as i64).pow(2);
                if d < best {
                    best = d;
                    ci = n;
                }
            }
        }
        if self.cheias < TABELA * 3 / 4 {
            self.chaves[i] = ch;
            self.classe[i] = ci as u8;
            self.cheias += 1;
        }
        self.ultima = (ch, ci);
        ci
    }
}

struct Mapas {
    semente: u32,
    /// por classe: cor (RGBA), metal, verniz, rugosidade, altura -- o que nao depende do ruido
    fixos: Vec<([u8; 4], u8, u8, f64, f64)>,
    classes: Classes,
    saida: [Vec<u8>; 4],
    cab: [u32; 4],
}

thread_local! {
    static MAPAS: RefCell<Option<Mapas>> = const { RefCell::new(None) };
}

fn js_round(v: f64) -> f64 {
    (v + 0.5).floor()
}

/// o rnd() do hub-pcb3d-real.js: semente = (semente * 1103515245 + 12345) & 0x7fffffff, em double
fn rnd(semente: &mut u32) -> f64 {
    let x = *semente as f64 * 1103515245.0 + 12345.0;
    let m = x % 4294967296.0;
    *semente = (m as u64 as u32) & 0x7fff_ffff;
    *semente as f64 / 2147483647.0
}

#[no_mangle]
pub extern "C" fn nx_mapas_ini(r: f64, g: f64, b: f64) {
    let c8 = |v: f64| js_round(v * 255.0).clamp(0.0, 255.0) as u8;
    let fixos = CLASSES
        .iter()
        .map(|k| {
            let cor = k.cor.unwrap_or([r, g, b]);
            ([c8(cor[0]), c8(cor[1]), c8(cor[2]), 255], (k.metal * 255.0) as u8, (k.coat * 255.0) as u8, k.rough, k.alt)
        })
        .collect();
    MAPAS.with(|m| {
        *m.borrow_mut() = Some(Mapas { semente: 1234567, fixos, classes: Classes::nova(), saida: Default::default(), cab: [0; 4] });
    });
}

/// # Safety
/// `src` aponta para `n` pixels RGBA (o getImageData da face) na memoria do modulo.
/// Devolve 4 ponteiros: cor, rugosidade/metal (ORM), verniz, altura -- cada um n*4 bytes.
#[no_mangle]
pub unsafe extern "C" fn nx_mapas_faixa(src: *const u8, n: usize) -> *const u32 {
    let src = std::slice::from_raw_parts(src, n * 4);
    MAPAS.with(|m| {
        let mut g = m.borrow_mut();
        let Some(st) = g.as_mut() else { return std::ptr::null() };
        // as saidas so crescem (nada de zerar a cada faixa: todo byte e escrito abaixo)
        for s in st.saida.iter_mut() {
            if s.len() < n * 4 {
                s.resize(n * 4, 0);
            }
        }
        let Mapas { semente, fixos, classes, saida, .. } = st;
        let [sc, so, sk, sb] = saida;
        let (sc, so, sk, sb) = (&mut sc[..n * 4], &mut so[..n * 4], &mut sk[..n * 4], &mut sb[..n * 4]);
        for p in 0..n {
            let j = p * 4;
            if src[j + 3] < 8 {
                sc[j..j + 4].copy_from_slice(&[0, 0, 0, 0]);
                so[j..j + 4].copy_from_slice(&[0, 0, 0, 255]);
                sk[j..j + 4].copy_from_slice(&[0, 0, 0, 255]);
                sb[j..j + 4].copy_from_slice(&[0, 0, 0, 255]);
                continue;
            }
            let (cor, metal8, coat, rough, alt) = fixos[classes.de(src[j], src[j + 1], src[j + 2])];
            let ru = (rnd(semente) - 0.5) * 0.06;
            sc[j..j + 4].copy_from_slice(&cor);
            so[j..j + 4].copy_from_slice(&[255, js_round((rough + ru) * 255.0).clamp(0.0, 255.0) as u8, metal8, 255]);
            sk[j..j + 4].copy_from_slice(&[coat, coat, coat, 255]);
            let a = (alt + js_round((rnd(semente) - 0.5) * 10.0)).clamp(0.0, 255.0) as u8;
            sb[j..j + 4].copy_from_slice(&[a, a, a, 255]);
        }
        st.cab = [st.saida[0].as_ptr() as u32, st.saida[1].as_ptr() as u32, st.saida[2].as_ptr() as u32, st.saida[3].as_ptr() as u32];
        st.cab.as_ptr()
    })
}
