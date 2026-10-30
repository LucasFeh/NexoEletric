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
    m: Mutex<HashMap<String, (String, Arc<Vec<u8>>)>>,
}

pub fn alvo(nome: &str) -> bool {
    nome == "pcbframe.js" || nome == "hub-pcb3d-vista.js"
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

const PREF_3D_ORIG: &str = "antes:lePref('3d.antes', '1') !== '0' }";
const PREF_3D_NOVO: &str = "antes:lePref('3d.antes', '0') !== '0' }";

pub fn remenda(nome: &str, src: &str) -> (String, Vec<&'static str>) {
    // \r\n -> \n so para casar com os trechos
    let s = src.replace("\r\n", "\n");
    match nome {
        "hub-pcb3d-vista.js" => remenda_3d(s),
        _ => remenda_pcb(s),
    }
}

fn remenda_pcb(mut s: String) -> (String, Vec<&'static str>) {
    let mut feitos = Vec::new();
    if s.contains(DESENHO_ORIG) && s.contains(ANTES_DRAW) && s.contains(CACHE_ORIG) {
        s = s.replacen(DESENHO_ORIG, DESENHO_NOVO, 1);
        s = s.replacen(ANTES_DRAW, &format!("{ELO}{ANTES_DRAW}"), 1);
        s = s.replacen(CACHE_ORIG, CACHE_NOVO, 1);
        feitos.push("webgl");
    }
    if s.contains(PREF_3D_ORIG) {
        s = s.replacen(PREF_3D_ORIG, PREF_3D_NOVO, 1);
        feitos.push("3d-sob-demanda");
    }
    (s, feitos)
}

impl Cache {
    pub fn remendado(&self, nome: &str, tag: &str, bytes: &[u8]) -> Vec<u8> {
        if let Some((t, v)) = self.m.lock().unwrap().get(nome) {
            if t == tag {
                return (**v).clone();
            }
        }
        let (s, feitos) = remenda(nome, &String::from_utf8_lossy(bytes));
        eprintln!("[nexo-hub] {nome}: remendos {feitos:?}");
        let v = Arc::new(s.into_bytes());
        self.m.lock().unwrap().insert(nome.to_string(), (tag.to_string(), v.clone()));
        (*v).clone()
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

fn remenda_3d(mut s: String) -> (String, Vec<&'static str>) {
    let mut feitos = Vec::new();
    if [MONTA_ORIG, BB_ORIG, EXTRUDE_ORIG, FACE_ORIG].iter().all(|a| s.contains(a)) {
        s = s.replacen(MONTA_ORIG, &format!("{PLACA3D_HELPER}{MONTA_ORIG}"), 1);
        s = s.replacen(BB_ORIG, BB_NOVO, 1);
        s = s.replacen(EXTRUDE_ORIG, EXTRUDE_NOVO, 1);
        s = s.replacen(FACE_ORIG, FACE_NOVO, 1);
        feitos.push("placa-rust");
    }
    if s.contains(DESENHA_ORIG) && s.contains(CENA_ORIG) {
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
    #[test]
    fn remendos_casam_com_o_pcbframe_instalado() {
        let p = std::path::Path::new(r"C:\Program Files\NexoEletric\resources\hub\pcbframe.js");
        let Ok(src) = std::fs::read_to_string(p) else { return };
        let (_, feitos) = super::remenda("pcbframe.js", &src);
        assert_eq!(feitos, vec!["webgl", "3d-sob-demanda"]);
        let p3 = std::path::Path::new(r"C:\Program Files\NexoEletric\resources\hub\hub-pcb3d-vista.js");
        let src3 = std::fs::read_to_string(p3).unwrap();
        let (_, feitos) = super::remenda("hub-pcb3d-vista.js", &src3);
        assert_eq!(feitos, vec!["placa-rust", "shaders-em-paralelo"]);
    }
}
