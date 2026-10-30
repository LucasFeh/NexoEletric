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
    nome == "pcbframe.js"
}

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

const DESENHO_NOVO: &str = "  if (nexoGlDesenha()) {
    /* a placa saiu no WebGL (nexo-gl.js + nucleo Rust): aqui so o que fica por cima */
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
    transformaMundo();
    desenhaOrigem();
    desenhaPlanos();
  } else {
    if (NGL) NGL.esconde();
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
let NGL = null, NGL_CHAVE = '';
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
  if (!NGL.pronto()) return false;
  const cores = {};
  for (const l of LAYERS) cores[l.key] = corDe(l.key);
  for (const k of ['Multi', 'TopSolder', 'BottomSolder', 'TopPaste', 'BottomPaste']) cores[k] = corDe(k);
  const chave = ebSeq + '|' + view.flip + '|' + JSON.stringify(cores);
  if (chave !== NGL_CHAVE) {
    const ok = NGL.monta({ eb:EB, cores, flip:view.flip, textos:nexoGlTextos(),
                           sm:(isNum(RULES.sm) ? RULES.sm : MASCARA_PADRAO), pm:(isNum(RULES.pm) ? RULES.pm : 0) });
    if (!ok) return false;
    NGL_CHAVE = chave;
  }
  let passo = grade.mm, n = 0;
  while (passo * view.scale < 7 && n < 30) { passo *= (n % 2 === 0) ? 5 : 2; n++; }
  return NGL.desenha({ W:cv.width, H:cv.height, DPR, CW, CHH, scale:view.scale, cx:view.cx, cy:view.cy, flip:view.flip,
                       grade:show.grid ? passo : 0, ordem:ORDEM.filter(camVisivel), fundo:COR.fundo, contorno:COR.contorno });
}
"#;

const PREF_3D_ORIG: &str = "antes:lePref('3d.antes', '1') !== '0' }";
const PREF_3D_NOVO: &str = "antes:lePref('3d.antes', '0') !== '0' }";

pub fn remenda(src: &str) -> (String, Vec<&'static str>) {
    let mut s = src.to_string();
    let mut feitos = Vec::new();
    // \r\n -> \n so para casar; o arquivo servido sai com o que tinha
    let crlf = s.contains("\r\n");
    if crlf {
        s = s.replace("\r\n", "\n");
    }
    if s.contains(DESENHO_ORIG) && s.contains(ANTES_DRAW) {
        s = s.replacen(DESENHO_ORIG, DESENHO_NOVO, 1);
        s = s.replacen(ANTES_DRAW, &format!("{ELO}{ANTES_DRAW}"), 1);
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
        let (s, feitos) = remenda(&String::from_utf8_lossy(bytes));
        eprintln!("[nexo-hub] {nome}: remendos {feitos:?}");
        let v = Arc::new(s.into_bytes());
        self.m.lock().unwrap().insert(nome.to_string(), (tag.to_string(), v.clone()));
        (*v).clone()
    }
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
        let (_, feitos) = super::remenda(&src);
        assert_eq!(feitos, vec!["webgl", "3d-sob-demanda"]);
    }
}
