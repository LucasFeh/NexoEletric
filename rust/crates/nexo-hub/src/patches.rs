//! Os remendos da vista PCB, aplicados ao servir (a pasta de trabalho nao muda):
//!  1. o desenho da placa (fundo, grade, camadas, furos, contorno) vai para o WebGL, com a malha
//!     montada pelo nucleo Rust (WASM) -- o Canvas 2D rasterizava milhares de caminhos a cada
//!     quadro; o 2D continua por cima com o que e interativo (selecao, arrasto, cotas, DRC...).
//!     Arrastando (EXCLUI) ou no 3D, o caminho original de sempre;
//!  2. o 3D escondido deixa de ser montado ao abrir: a preferencia "3d.antes" (que ja existe no
//!     app) passa a vir desligada -- o 3D monta na primeira vez que a pessoa abre o 3D.
//! Cada remendo procura um trecho EXATO do pcbframe.js; se a versao do hub mudou e o trecho nao
//! esta la, aquele remendo nao entra e a vista segue a original (nada quebra).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Default)]
pub struct Cache {
    m: Mutex<HashMap<String, (String, Arc<Vec<u8>>, u64)>>,
}

/// NEXO_SEM_REMENDOS=a,b: desliga remendos pelo nome (comparar antes e depois no mesmo executavel)
fn quer(nome: &str) -> bool {
    !std::env::var("NEXO_SEM_REMENDOS").map(|v| v.split(',').any(|x| x.trim() == nome)).unwrap_or(false)
}

/// impressao digital (FNV-1a 64) do arquivo remendado: entra no ETag
fn digital(b: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for &x in b {
        h ^= x as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

pub fn alvo(nome: &str) -> bool {
    nome == "pcbframe.js" || nome == "hub-pcb3d-vista.js" || nome == "hub-pcb3d-real.js"
}

/* o cache de caminhos do Canvas 2D so e montado quando o desenho original vai ser usado (com o
   WebGL ativo ele era montado a toa a cada mudanca); quem mais o usa (as faces do 3D) monta o seu */
const CACHE_ORIG: &str = "  if (cacheSujo || !CACHE || (CACHE.vis !== null && CACHE.vis !== chaveVis())) montaCache();\n  calculaOrdem();\n";
const CACHE_NOVO: &str = "  calculaOrdem();\n";

const DESENHO_ORIG: &str = "  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = COR.fundo; ctx.fillRect(0, 0, cv.width, cv.height);
  transformaMundo();
  ctx.fillStyle = COR.placa; ctx.fill(pathPlaca(), 'evenodd');
  /* a grade so na placa: fora dela e a area de trabalho cinza, como no Altium */
  if (show.grid) { ctx.save(); ctx.clip(pathPlaca(), 'evenodd'); desenhaGrade(); ctx.restore(); }
  desenhaOrigem();
  for (const k of ORDEM) if (camVisivel(k)) pintaCamada(k);
  desenhaPlanos();
  ctx.fillStyle = COR.furo; ctx.fill(CACHE.furos);
  ctx.strokeStyle = COR.contorno; ctx.lineWidth = px(1.3); ctx.setLineDash([]); ctx.stroke(pathPlaca());
";

const DESENHO_NOVO: &str = "  const nxGl = nexoGlDesenha();
  if (nxGl === true) {
    /* a placa saiu no WebGL (nexo-gl.js + nucleo Rust): aqui so o que fica por cima */
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
    transformaMundo();
    desenhaOrigem();
    desenhaPlanos();
  } else if (nxGl === 'espera') {
    /* a malha esta a caminho (montada no worker): por um instante, so o fundo e a placa */
    if (NGL) NGL.esconde();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COR.fundo; ctx.fillRect(0, 0, cv.width, cv.height);
    transformaMundo();
    ctx.fillStyle = COR.placa; ctx.fill(pathPlaca(), 'evenodd');
    desenhaOrigem();
  } else {
    if (NGL) NGL.esconde();
    if (cacheSujo || !CACHE || (CACHE.vis !== null && CACHE.vis !== chaveVis())) montaCache();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = COR.fundo; ctx.fillRect(0, 0, cv.width, cv.height);
  transformaMundo();
  ctx.fillStyle = COR.placa; ctx.fill(pathPlaca(), 'evenodd');
  /* a grade so na placa: fora dela e a area de trabalho cinza, como no Altium */
  if (show.grid) { ctx.save(); ctx.clip(pathPlaca(), 'evenodd'); desenhaGrade(); ctx.restore(); }
  desenhaOrigem();
  for (const k of ORDEM) if (camVisivel(k)) pintaCamada(k);
  desenhaPlanos();
  ctx.fillStyle = COR.furo; ctx.fill(CACHE.furos);
  ctx.strokeStyle = COR.contorno; ctx.lineWidth = px(1.3); ctx.setLineDash([]); ctx.stroke(pathPlaca());
  }
";

const ANTES_DRAW: &str = "function draw(){\n  agendado = 0;\n";

/// o elo entre a vista e o nexo-gl.js (fica dentro da IIFE do pcbframe, com acesso ao estado dela)
const ELO: &str = r#"/* ---- NexoEletric (Rust): a placa no WebGL, com a malha do nucleo Rust (nexo-gl.js) ---- */
let NGL = null;
function nexoGlTextos(){
  const out = [];
  for (const t of EB.texts || []) {
    if (!t || typeof t.layer !== 'string') continue;
    let g = null; try { g = geoTexto(t); } catch (e) { g = null; }
    if (!g) continue;
    if (g.polys) out.push({ layer:t.layer, polys:g.polys.map(q => q.pts) });
    else out.push({ layer:t.layer, linhas:g.linhas, w:g.w || 0, inv:!!g.inv, caixa:g.caixa || [] });
  }
  return out;
}
function nexoGlDesenha(){
  if (typeof NexoGL === 'undefined' || EXCLUI || modo3d || LEAN) return false;
  if (!NGL) { NGL = NexoGL.cria(cv, pede); if (!NGL) return false; }
  if (!NGL.usavel()) return false;
  const cores = {};
  for (const l of LAYERS) cores[l.key] = corDe(l.key);
  for (const k of ['Multi', 'TopSolder', 'BottomSolder', 'TopPaste', 'BottomPaste']) cores[k] = corDe(k);
  const chave = ebSeq + '|' + view.flip + '|' + JSON.stringify(cores);
  /* a malha e pedida ao worker (so quando a placa, a face ou as cores mudam); a tela usa a ultima pronta */
  NGL.pedeMalha(() => ({ eb:EB, cores, flip:view.flip, textos:nexoGlTextos(),
                         sm:(isNum(RULES.sm) ? RULES.sm : MASCARA_PADRAO), pm:(isNum(RULES.pm) ? RULES.pm : 0) }), chave);
  if (!NGL.usavel()) return false;
  if (!NGL.temMalha()) return 'espera';
  let passo = grade.mm, n = 0;
  while (passo * view.scale < 7 && n < 30) { passo *= (n % 2 === 0) ? 5 : 2; n++; }
  return !!NGL.desenha({ W:cv.width, H:cv.height, DPR, CW, CHH, scale:view.scale, cx:view.cx, cy:view.cy, flip:view.flip,
                       grade:show.grid ? passo : 0, ordem:ORDEM.filter(camVisivel), fundo:COR.fundo, contorno:COR.contorno });
}
"#;

/* a biblioteca da rede Nexo muda de revisao com frequencia (o sincronismo do NexoBD): a vista refazia o
   3D INTEIRO a cada revisao (placa, todos os corpos e, no Real View, os mapas das faces) -- 3 vezes num
   minuto parado. Agora: so se a lista de corpos DESTA placa mudou, e entao so os corpos */
const BIB_ORIG: &str = "nexoDesliga = HubNexo.aoMudar(() => refaz3d());";
const BIB_NOVO: &str = "nexoDesliga = HubNexo.aoMudar(() => nexoBibliotecaMudou());";
const CENA3D_ORIG: &str = "async function cena3d(){\n  if (!V3) return;\n  const seq = ++cena3dSeq;\n  sujo3d = false;\n  const { corpos, esp } = await corpos3d(true);\n  if (seq !== cena3dSeq || !V3) return;";
const CENA3D_NOVO: &str = "/* ---- NexoEletric (Rust): a revisao da biblioteca so troca os corpos que mudaram ---- */
let NX_CORPOS = null;
const nexoChaveCorpos = l => JSON.stringify((l || []).map(b => b ? [b.owner || '', b.kind || '', b.chave || b.model || b.modelUrl || '', b.matrix || null, b.color || '', b.opacity] : null));
async function nexoBibliotecaMudou(){
  if (!V3) { refaz3d(); return; }
  try {
    const { corpos } = await corpos3d(true);
    const k = nexoChaveCorpos(corpos);
    if (k === NX_CORPOS) return;                 /* nada desta placa mudou na biblioteca */
    NX_CORPOS = k;
    if (OPC3D.corpos) agendaSilhuetas();
    if (!modo3d) { sujo3d = true; return; }      /* escondido: refaz quando abrir */
    V3.corpos(corpos);                           /* so os corpos: a placa e os mapas ficam */
  } catch (e) { refaz3d(); }
}
async function cena3d(){
  if (!V3) return;
  const seq = ++cena3dSeq;
  sujo3d = false;
  const { corpos, esp } = await corpos3d(true);
  if (seq !== cena3dSeq || !V3) return;
  NX_CORPOS = nexoChaveCorpos(corpos);";

const PREF_3D_ORIG: &str = "antes:lePref('3d.antes', '1') !== '0' }";
const PREF_3D_NOVO: &str = "antes:lePref('3d.antes', '0') !== '0' }";

pub fn remenda(nome: &str, src: &str) -> (String, Vec<&'static str>) {
    // \r\n -> \n so para casar com os trechos
    let s = src.replace("\r\n", "\n");
    match nome {
        "hub-pcb3d-vista.js" => remenda_3d(s),
        "hub-pcb3d-real.js" => remenda_real(s),
        _ => remenda_pcb(s),
    }
}

fn remenda_pcb(mut s: String) -> (String, Vec<&'static str>) {
    let mut feitos = Vec::new();
    if quer("webgl") && s.contains(DESENHO_ORIG) && s.contains(ANTES_DRAW) && s.contains(CACHE_ORIG) {
        s = s.replacen(DESENHO_ORIG, DESENHO_NOVO, 1);
        s = s.replacen(ANTES_DRAW, &format!("{ELO}{ANTES_DRAW}"), 1);
        s = s.replacen(CACHE_ORIG, CACHE_NOVO, 1);
        feitos.push("webgl");
    }
    if quer("biblioteca-so-corpos") && s.contains(BIB_ORIG) && s.contains(CENA3D_ORIG) {
        s = s.replacen(BIB_ORIG, BIB_NOVO, 1);
        s = s.replacen(CENA3D_ORIG, CENA3D_NOVO, 1);
        feitos.push("biblioteca-so-corpos");
    }
    if quer("3d-sob-demanda") && s.contains(PREF_3D_ORIG) {
        s = s.replacen(PREF_3D_ORIG, PREF_3D_NOVO, 1);
        feitos.push("3d-sob-demanda");
    }
    (s, feitos)
}

impl Cache {
    /// o arquivo remendado e a impressao digital dele (refeito so quando o original muda)
    pub fn remendado(&self, nome: &str, tag: &str, bytes: &[u8]) -> (Vec<u8>, u64) {
        if let Some((t, v, d)) = self.m.lock().unwrap().get(nome) {
            if t == tag {
                return ((**v).clone(), *d);
            }
        }
        let (s, feitos) = remenda(nome, &String::from_utf8_lossy(bytes));
        eprintln!("[nexo-hub] {nome}: remendos {feitos:?}");
        let v = Arc::new(s.into_bytes());
        let d = digital(&v);
        self.m.lock().unwrap().insert(nome.to_string(), (tag.to_string(), v.clone(), d));
        ((*v).clone(), d)
    }
}

// ---------------- hub-pcb3d-vista.js ----------------

/* a placa do 3D com a malha do nucleo Rust (nexo_core::solido via NexoGL.placa3d) */
const PLACA3D_HELPER: &str = r#"  /* ---- NexoEletric (Rust): a placa solida sai do nucleo Rust (uma triangulacao so) ---- */
  function nexoPlaca3d(c, esp){
    try {
      const NG = (typeof window !== 'undefined') ? window.NexoGL : null;
      if (!NG || typeof NG.placa3d !== 'function') return null;
      const r = NG.placa3d({ lacos:(c.lacos || []).filter(l => l && l.length >= 3), recortes:(c.recortes || []).filter(k => k && k.length >= 3),
                             furos:(c.furos || []).filter(f => f && f.r > 0.05).map(f => [f.x, f.y, f.r]), esp, seg:18 });
      if (!r) return null;
      const nv = r.tampaXY.length / 2, nl = r.ladoPos.length / 3, nt = r.tampaIdx.length;
      const pos = new Float32Array((2 * nv + nl) * 3), nor = new Float32Array((2 * nv + nl) * 3), uv = new Float32Array((2 * nv + nl) * 2);
      const fp = new Float32Array(nv * 3), fn = new Float32Array(nv * 3), fu = new Float32Array(nv * 2);
      for (let i = 0; i < nv; i++) {
        const x = r.tampaXY[2 * i], y = r.tampaXY[2 * i + 1], j = nv + i;
        pos[3 * i] = x; pos[3 * i + 1] = y; pos[3 * i + 2] = esp; nor[3 * i + 2] = 1;     /* tampa de cima */
        pos[3 * j] = x; pos[3 * j + 1] = y; pos[3 * j + 2] = 0; nor[3 * j + 2] = -1;      /* tampa de baixo */
        uv[2 * i] = x; uv[2 * i + 1] = y; uv[2 * j] = x; uv[2 * j + 1] = y;
        fp[3 * i] = x; fp[3 * i + 1] = y; fn[3 * i + 2] = 1; fu[2 * i] = x; fu[2 * i + 1] = y;
      }
      pos.set(r.ladoPos, 2 * nv * 3); nor.set(r.ladoNor, 2 * nv * 3);
      const idx = new Uint32Array(2 * nt + r.ladoIdx.length);
      for (let t = 0; t < nt; t += 3) {
        idx[t] = r.tampaIdx[t]; idx[t + 1] = r.tampaIdx[t + 1]; idx[t + 2] = r.tampaIdx[t + 2];
        idx[nt + t] = nv + r.tampaIdx[t]; idx[nt + t + 1] = nv + r.tampaIdx[t + 2]; idx[nt + t + 2] = nv + r.tampaIdx[t + 1];
      }
      for (let k = 0; k < r.ladoIdx.length; k++) idx[2 * nt + k] = 2 * nv + r.ladoIdx[k];
      const solido = new T.BufferGeometry();
      solido.setAttribute('position', new T.BufferAttribute(pos, 3));
      solido.setAttribute('normal', new T.BufferAttribute(nor, 3));
      solido.setAttribute('uv', new T.BufferAttribute(uv, 2));
      solido.setIndex(new T.BufferAttribute(idx, 1));
      solido.addGroup(0, 2 * nt, 0); solido.addGroup(2 * nt, r.ladoIdx.length, 1);
      const face = new T.BufferGeometry();
      face.setAttribute('position', new T.BufferAttribute(fp, 3));
      face.setAttribute('normal', new T.BufferAttribute(fn, 3));
      face.setAttribute('uv', new T.BufferAttribute(fu, 2));
      face.setIndex(new T.BufferAttribute(r.tampaIdx, 1));
      return { solido, face };
    } catch (e) { console.warn('3D: a placa do nucleo Rust falhou, vai a do three.js', e); return null; }
  }
"#;
const MONTA_ORIG: &str = "  function montaPlaca(c){\n";
const BB_ORIG: &str = "    BB = c.bbox && isNum(c.bbox.x1) ? c.bbox : f.bb;\n";
const BB_NOVO: &str = "    BB = c.bbox && isNum(c.bbox.x1) ? c.bbox : f.bb;\n    const NXG = nexoPlaca3d(c, ESP);\n";
const EXTRUDE_ORIG: &str = "new T.Mesh(new T.ExtrudeGeometry(f.S, { depth:ESP, bevelEnabled:false, curveSegments:18 }),";
const EXTRUDE_NOVO: &str = "new T.Mesh(NXG ? NXG.solido : new T.ExtrudeGeometry(f.S, { depth:ESP, bevelEnabled:false, curveSegments:18 }),";
const FACE_ORIG: &str = "const m = new T.Mesh(new T.ShapeGeometry(f.S, 18),";
const FACE_NOVO: &str = "const m = new T.Mesh(NXG ? NXG.face : new T.ShapeGeometry(f.S, 18),";

/* os shaders do three.js compilam em paralelo e fora da thread principal (KHR_parallel_shader_compile)
   antes do primeiro quadro da cena nova -- antes o primeiro render() travava a tela */
const DESENHA_ORIG: &str = "  function desenha(){\n    agendado = 0; if (!vivo) return;\n";
const DESENHA_NOVO: &str = "  let nxCompila = null;\n  function desenha(){\n    agendado = 0; if (!vivo) return;\n    if (nxCompila) return;\n";
const CENA_ORIG: &str = "      poeCorpos(c.corpos || []);\n";
const CENA_NOVO: &str = "      poeCorpos(c.corpos || []);\n      if (ren.compileAsync && !nxCompila) { posiciona(); const pr = ren.compileAsync(cena, cam).catch(() => {}); nxCompila = pr; pr.then(() => { if (nxCompila === pr) nxCompila = null; pede(); }); }\n";

/* os modelos STEP: a malha sai do nucleo Rust (normais + um grupo por cor, no lugar de um grupo por
   face: ~17 mil chamadas de desenho por quadro na PRJ-UR), a geometria e compartilhada entre os
   componentes que usam o mesmo modelo, e os materiais entre as malhas do mesmo corpo */
const STEP_HELPER: &str = r#"  /* ---- NexoEletric (Rust): a malha do STEP vem do nucleo Rust (nexo_core::step3d) ---- */
  const NXSTEP = new WeakMap();
  function nexoStep(mm){
    try {
      const NG = (typeof window !== 'undefined') ? window.NexoGL : null;
      if (!NG || typeof NG.malhaStep !== 'function') return null;
      let r = NXSTEP.get(mm);
      if (r) return r;
      const s = NG.malhaStep(mm);
      if (!s) return null;
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(s.pos, 3));
      geo.setAttribute('normal', new T.BufferAttribute(s.nor, 3));
      geo.setAttribute('uv', new T.BufferAttribute(s.uv, 2));
      for (const q of s.grupos) geo.addGroup(q[0], q[1], q[2]);
      /* a esfera envolvente ja vem do Rust (o three.js percorria todos os vertices no 1o quadro) */
      if (s.esfera) geo.boundingSphere = new T.Sphere(new T.Vector3(s.esfera[0], s.esfera[1], s.esfera[2]), s.esfera[3]);
      r = { geo, cores: s.cores };
      NXSTEP.set(mm, r);
      return r;
    } catch (e) { console.warn('3D: a malha do STEP no nucleo Rust falhou, vai a do three.js', e); return null; }
  }
"#;
const STEP_FN_ORIG: &str = "  function malhaDoStep(malhas, b){\n";
const STEP_LACO_ORIG: &str = "    for (const mm of malhas) {\n      const geo = new T.BufferGeometry();\n      const sv = suaviza(mm);\n";
const STEP_LACO_NOVO: &str = "    const nxMats = new Map();
    const nxMat = (hex, temCor) => { const k = hex + (temCor ? '+' : '-'); let m = nxMats.get(k); if (!m) { m = material(hex, b.opacity, temCor); nxMats.set(k, m); } return m; };
    for (const mm of malhas) {
      const nx = nexoStep(mm);
      if (nx) {
        const base = mm.cor ? new T.Color(mm.cor[0], mm.cor[1], mm.cor[2]) : new T.Color(b.color || '#9a9a9a');
        const m0 = nxMat('#' + base.getHexString(), !!mm.cor);
        g.add(new T.Mesh(nx.geo, nx.cores.length ? [m0].concat(nx.cores.map(c => nxMat('#' + new T.Color(c[0], c[1], c[2]).getHexString(), true))) : m0));
        continue;
      }
      const geo = new T.BufferGeometry();
      const sv = suaviza(mm);
";

/* Real View ligado: os shaders fisicos tambem compilam em paralelo antes do primeiro quadro */
const REAL_ORIG: &str = "    /* a mudanca de tom/sombra exige recompilar os materiais que ja existem */
    cena.traverse(x => { const ms = x.material ? (Array.isArray(x.material) ? x.material : [x.material]) : []; for (const m of ms) m.needsUpdate = true; });
    materiaisDoModo(gPlaca); materiaisDoModo(gCorpos);
    aplicaRealce();
    pede();
";
const REAL_NOVO: &str = "    /* a mudanca de tom/sombra exige recompilar os materiais que ja existem */
    cena.traverse(x => { const ms = x.material ? (Array.isArray(x.material) ? x.material : [x.material]) : []; for (const m of ms) m.needsUpdate = true; });
    materiaisDoModo(gPlaca); materiaisDoModo(gCorpos);
    aplicaRealce();
    if (ren.compileAsync) { posiciona(); const pr = ren.compileAsync(cena, cam).catch(() => {}); nxCompila = pr; pr.then(() => { if (nxCompila === pr) nxCompila = null; pede(); }); }
    pede();
";

// ---------------- hub-pcb3d-real.js (modulo ES do Real View) ----------------
/* o laco por pixel dos mapas da face vai ao WASM (NexoGL.mapasFace; mesmos bytes) */
const MAPAS_ORIG: &str = "  for (let p = 0; p < w * h; p++) {\n    const j = p * 4, a = src[j + 3];\n";
const MAPAS_NOVO: &str = "  if (!(typeof window !== 'undefined' && window.NexoGL && typeof window.NexoGL.mapasFace === 'function' && window.NexoGL.mapasFace(src, w * h, metal, C, O, K, B)))\n  for (let p = 0; p < w * h; p++) {\n    const j = p * 4, a = src[j + 3];\n";

fn remenda_real(mut s: String) -> (String, Vec<&'static str>) {
    let mut feitos = Vec::new();
    if quer("mapas-rust") && s.contains(MAPAS_ORIG) {
        s = s.replacen(MAPAS_ORIG, MAPAS_NOVO, 1);
        feitos.push("mapas-rust");
    }
    (s, feitos)
}

/* Real View: o canvas da face e lido de volta pixel a pixel (os mapas); na GPU essa leitura espera a
   placa de video (0,2 a 4,7 s medidos). Com o Real View ligado ele nasce na memoria (willReadFrequently) */
const FACE_CV_ORIG: &str = "    const x = tc.getContext('2d');\n    x.setTransform(s, 0, 0, -s, -bb.x1 * s, bb.y2 * s);\n";
const FACE_CV_NOVO: &str = "    const x = tc.getContext('2d', modo === 'real' ? { willReadFrequently:true } : undefined);\n    x.setTransform(s, 0, 0, -s, -bb.x1 * s, bb.y2 * s);\n";

fn remenda_3d(mut s: String) -> (String, Vec<&'static str>) {
    let mut feitos = Vec::new();
    if quer("face-na-memoria") && s.contains(FACE_CV_ORIG) {
        s = s.replacen(FACE_CV_ORIG, FACE_CV_NOVO, 1);
        feitos.push("face-na-memoria");
    }
    // usa o nxCompila do remendo dos shaders: so entra junto com ele
    if quer("real-em-paralelo") && s.contains(REAL_ORIG) && s.contains(DESENHA_ORIG) && s.contains(CENA_ORIG) {
        s = s.replacen(REAL_ORIG, REAL_NOVO, 1);
        feitos.push("real-em-paralelo");
    }
    if quer("step-rust") && s.contains(STEP_FN_ORIG) && s.contains(STEP_LACO_ORIG) {
        s = s.replacen(STEP_FN_ORIG, &format!("{STEP_HELPER}{STEP_FN_ORIG}"), 1);
        s = s.replacen(STEP_LACO_ORIG, STEP_LACO_NOVO, 1);
        feitos.push("step-rust");
    }
    if quer("placa-rust") && [MONTA_ORIG, BB_ORIG, EXTRUDE_ORIG, FACE_ORIG].iter().all(|a| s.contains(a)) {
        s = s.replacen(MONTA_ORIG, &format!("{PLACA3D_HELPER}{MONTA_ORIG}"), 1);
        s = s.replacen(BB_ORIG, BB_NOVO, 1);
        s = s.replacen(EXTRUDE_ORIG, EXTRUDE_NOVO, 1);
        s = s.replacen(FACE_ORIG, FACE_NOVO, 1);
        feitos.push("placa-rust");
    }
    if quer("shaders-em-paralelo") && s.contains(DESENHA_ORIG) && s.contains(CENA_ORIG) {
        s = s.replacen(DESENHA_ORIG, DESENHA_NOVO, 1);
        s = s.replacen(CENA_ORIG, CENA_NOVO, 1);
        feitos.push("shaders-em-paralelo");
    }
    (s, feitos)
}

/// a vista PCB carrega o nexo-gl.js logo no comeco (o WASM baixa em paralelo com o resto)
pub fn html_pcb(s: &str, tag: &str) -> String {
    match s.find("<script src=\"hub-tema.js\"></script>") {
        Some(i) => {
            let fim = i + "<script src=\"hub-tema.js\"></script>".len();
            format!("{}\n{}{}", &s[..fim], tag, &s[fim..])
        }
        None => s.replacen("</head>", &format!("{tag}</head>"), 1),
    }
}

#[cfg(test)]
mod tests {
    /// todos os remendos casam com os arquivos do hub nesta pasta (pula se ela nao existe)
    fn casam_em(pasta: &std::path::Path) {
        let Ok(src) = std::fs::read_to_string(pasta.join("pcbframe.js")) else { return };
        let (_, feitos) = super::remenda("pcbframe.js", &src);
        assert_eq!(feitos, vec!["webgl", "biblioteca-so-corpos", "3d-sob-demanda"], "pcbframe.js de {}", pasta.display());
        let src3 = std::fs::read_to_string(pasta.join("hub-pcb3d-vista.js")).unwrap();
        let (_, feitos) = super::remenda("hub-pcb3d-vista.js", &src3);
        assert_eq!(feitos, vec!["face-na-memoria", "real-em-paralelo", "step-rust", "placa-rust", "shaders-em-paralelo"],
                   "hub-pcb3d-vista.js de {}", pasta.display());
        let srcr = std::fs::read_to_string(pasta.join("hub-pcb3d-real.js")).unwrap();
        let (_, feitos) = super::remenda("hub-pcb3d-real.js", &srcr);
        assert_eq!(feitos, vec!["mapas-rust"], "hub-pcb3d-real.js de {}", pasta.display());
    }
    #[test]
    fn remendos_casam_com_o_pcbframe_instalado() {
        casam_em(std::path::Path::new(r"C:\Program Files\NexoEletric\resources\hub"));
    }
    /// o hub que vai no PROXIMO instalador (o repositorio do NexoEletric): a casca Rust e o hub
    /// saem no mesmo instalador desde o NexoEletric 1.54.0, e um remendo que deixou de casar so
    /// apareceria la, na maquina de quem abriu. NEXOELETRIC_REPO troca a pasta.
    #[test]
    fn remendos_casam_com_o_hub_do_repositorio() {
        let repo = std::env::var_os("NEXOELETRIC_REPO").map(std::path::PathBuf::from)
            .unwrap_or_else(|| std::path::PathBuf::from(r"D:\Pessoal\NexoEletric"));
        casam_em(&repo);
    }
}
