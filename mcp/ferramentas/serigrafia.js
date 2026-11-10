/* NexoEletric MCP - grupo "serigrafia" (1.37.0): conferir e posicionar texto de serigrafia sem rodar
   o DRC inteiro.
     serigrafia_checar      diz se um lugar candidato (ref, id de texto ou texto novo) viola alguma
                            regra da casa — a mesma cena e a mesma conta do regras_casa_verificar
                            (regras-casa.js » cenaSerigrafia/checaSerigrafia), com as regras do
                            projeto (regras-casa.json) e as da área onde o texto cai;
     serigrafia_posicionar  acha lugar para os designadores: altura entre min e max, folgas, longe
                            do corpo dos componentes, fora de ambiguidade (o rótulo não fica mais
                            perto de outro componente que do dono), "fileira" (o rótulo alinhado
                            ao próprio componente numa fileira) e simulação antes de gravar;
     serigrafia_imagem      (1.60.0) um PNG do disco vira serigrafia: region_add com furos (holes), pelo
                            hub-silkgen.js (limiar -> marching squares -> mm -> simplificação), lido
                            aqui pelo mcp/lib/png.js (sem dependência);
     serigrafia_texto       (1.60.0) texto numa fonte TrueType/OpenType (Arial do Windows por padrão,
                            pelo vendor/opentype.min.js) vira serigrafia do mesmo jeito: a letra "o"
                            é uma region com furo.
   Os dois simulam por padrão (gravar:true grava), conferem a largura mínima da serigrafia e as
   regras da casa no lugar (pad, via, trilha, furo, borda, keepout) e devolvem a imagem do lugar.
   A placa é a efetiva SEM redespejar os polígonos: plano pode ficar embaixo do texto (a regra da
   casa), então o despejo não muda nada aqui e a conta fica rápida.
   A forma de cada texto candidato é a do HubGerber (a da tela e do Gerber), feita uma vez por
   altura/traço/giro e só transladada para cada lugar. */
'use strict';
const { ErroMcp } = require('../lib/contexto.js');
const ops = require('../lib/pcb-ops.js');
const { PROJETO, isNum } = require('../lib/util.js');
const RC = require('./regras-casa.js')._interno;
const fs = require('node:fs');
const path = require('node:path');
const PNG = require('../lib/png.js');
const render = require('../lib/render.js');

const E = 1e4;
const r3 = v => Math.round(v * 1000) / 1000;
const normRot = a => ((Math.round(a) % 360) + 360) % 360;

/* a placa e a cena da serigrafia, com as regras do projeto */
function monta(ctx, a) {
  const p = ctx.projeto(a.projeto);
  const K = RC.kit(ctx.exige('hub-clipper.js', 'ClipperLib'));
  const cfg = RC.lerConfig(p);
  const chamada = RC.paramsDaChamada(a);
  if (isNum(a.folga_pad)) chamada.silk = a.folga_pad;
  if (isNum(a.folga_trilha)) chamada.silk_cobre = a.folga_trilha;
  const o = Object.assign({}, RC.PAD, cfg.parametros, chamada);
  const { eb } = ctx.placa(p);
  const tg = RC.textoGeo(ctx);
  const { furos, cobre } = RC.preparaPlaca(ctx, eb, K, o, a, ['Top', 'Bottom'], (x, y) => RC.regrasEm(cfg, RC.PAD, chamada, x, y).o);
  const cena = RC.cenaSerigrafia(ctx, eb, K, furos, cobre, tg);
  const regras = (x, y, layer) => {
    const r = RC.regrasEm(cfg, RC.PAD, chamada, x, y, layer);
    if (a.ignorar_trilha) r.desl.add('serigrafia_trilha');
    return r;
  };
  /* o corpo de cada componente: a caixa dele (pads, contorno e desenho do footprint) */
  const corpos = (eb.components || []).filter(c => c && c.bbox && [c.bbox.x1, c.bbox.y1, c.bbox.x2, c.bbox.y2].every(isNum)).map(c => {
    const b = c.bbox, m = 0.05;          // encostar na caixa vale
    const q = { x1: b.x1 + m, y1: b.y1 + m, x2: b.x2 - m, y2: b.y2 - m };
    return { ref: c.ref, lado: c.layer === 'Bottom' ? 'Bottom' : 'Top', caixa: b, bb: q, footprint: c.footprint, cx: (b.x1 + b.x2) / 2, cy: (b.y1 + b.y2) / 2,
             paths: q.x2 > q.x1 && q.y2 > q.y1 ? [K.paraC([[q.x1, q.y1], [q.x2, q.y1], [q.x2, q.y2], [q.x1, q.y2]])] : [] };
  });
  return { p, K, cfg, chamada, o, eb, tg, cena, regras, corpos };
}

/* distancia de um ponto a uma caixa (0 dentro) */
const dCaixa = (x, y, b) => Math.hypot(Math.max(b.x1 - x, 0, x - b.x2), Math.max(b.y1 - y, 0, y - b.y2));
/* o componente mais perto do centro do texto, entre os do lado dele: o rotulo e ambiguo quando
   outro fica mais perto que o dono (com a margem) */
function ambiguo(M, ref, lado, x, y, margem) {
  const dono = M.corpos.find(c => c.ref === ref);
  if (!dono) return null;
  const d0 = dCaixa(x, y, dono.caixa);
  for (const c of M.corpos) if (c.ref !== ref && c.lado === lado && dCaixa(x, y, c.caixa) < d0 + margem) return c.ref;
  return null;
}

/* o texto como ele seria naquele lugar: copia do texto base sem o contorno exato do Altium (que
   e da posicao velha), com a fonte do hub */
function textoEm(base, x, y, h, w, rot) {
  const t = Object.assign({}, base);
  delete t.polys; delete t.ax; delete t.ay; delete t.font;
  t.kind = base.kind === 'truetype' ? 'truetype' : 'stroke';
  Object.assign(t, { x, y, h, w, rot });
  return t;
}
/* a forma no zero, guardada por texto/altura/traco/giro/espelho; cada lugar so translada */
function formaNoZero(M, cache, base, h, w, rot) {
  const k = [base.text, base.layer, base.mirror ? 1 : 0, base.kind === 'truetype' ? 't' : 's', h, w, rot].join('|');
  let f = cache.get(k);
  if (!f) {
    const paths = RC.formaTexto(M.K, M.tg, textoEm(base, 0, 0, h, w, rot));
    const bb = M.K.caixa(paths);
    f = { paths, bb, cx: (bb.x1 + bb.x2) / 2, cy: (bb.y1 + bb.y2) / 2, larg: bb.x2 - bb.x1, alt: bb.y2 - bb.y1, areaU: M.K.area(M.K.uniaoC(paths)) };
    cache.set(k, f);
  }
  return f;
}
/* o objeto de serigrafia de um texto com a TINTA centrada em (X, Y); devolve tambem o x/y a gravar */
function silkEm(M, f, base, X, Y, h, w, rot) {
  const dx = Math.round((X - f.cx) * E), dy = Math.round((Y - f.cy) * E);
  const paths = f.paths.map(pa => pa.map(q => ({ X: q.X + dx, Y: q.Y + dy })));
  const bb = { x1: f.bb.x1 + dx / E, y1: f.bb.y1 + dy / E, x2: f.bb.x2 + dx / E, y2: f.bb.y2 + dy / E };
  const lado = base.layer === 'BottomOverlay' ? 'Bottom' : 'Top';
  return { tipo: 'texto', id: base.id || '', texto: base.text, owner: base.owner || '', designator: !!base.designator, lado, layer: base.layer,
           paths, bb, h, w, areaU: f.areaU, kind: base.kind === 'truetype' ? 'truetype' : 'stroke', gravar: { x: r3(X - f.cx), y: r3(Y - f.cy) } };
}

/* o texto de que se fala: o designator de um ref, um texto pelo id, ou um texto novo */
function baseDe(M, it) {
  const T = M.eb.texts || [];
  if (it.ref) {
    const t = T.find(x => x && x.designator && x.owner === it.ref);
    if (!t) throw new ErroMcp(`o designator de "${it.ref}" não está na placa (pcb_componente mostra os textos dele)`);
    return t;
  }
  if (it.id) {
    const t = T.find(x => x && String(x.id) === String(it.id));
    if (!t) throw new ErroMcp(`não existe texto com id "${it.id}" na placa`);
    return t;
  }
  if (!it.text || !/^(Top|Bottom)Overlay$/.test(it.layer || '')) throw new ErroMcp('cada item precisa de ref, id, ou text + layer (TopOverlay/BottomOverlay)');
  return { id: '', text: String(it.text), layer: it.layer, mirror: it.layer === 'BottomOverlay', h: 1, w: 0.15, rot: 0, kind: 'stroke' };
}
const curta = v => ({ regra: v.sub || v.regra, msg: v.msg, x: v.x, y: v.y });

/* ---------------- serigrafia_checar ---------------- */
function checar(ctx, a) {
  const t0 = Date.now();
  const M = monta(ctx, a);
  const cache = new Map();
  const res = a.textos.map(it => {
    const base = baseDe(M, it);
    const h = isNum(it.h) ? it.h : base.h, rot = isNum(it.rot) ? normRot(it.rot) : (base.rot || 0);
    const w = isNum(it.w) ? it.w : (base.w || r3(h * 0.15));
    const X = isNum(it.x) ? it.x : base.x, Y = isNum(it.y) ? it.y : base.y;
    if (!isNum(X) || !isNum(Y) || !(h > 0)) throw new ErroMcp('cada item precisa de x, y (e h para texto novo)');
    const f = formaNoZero(M, cache, base, h, w, rot);
    /* x/y = centro do texto (a convencao do board.js), como o designator_move grava */
    const s = silkEm(M, f, base, X + f.cx, Y + f.cy, h, w, rot);
    s.gravar = { x: X, y: Y };
    const r = M.regras(X, Y, base.layer);
    const ignora = new Set(base.id ? [String(base.id)] : []);
    const v = RC.checaSerigrafia(M.cena, s, r.o, r.desl, { ignora, corpos: a.corpo ? M.corpos.filter(c => c.ref !== base.owner || a.corpo === 'todos') : null });
    const out = { item: it.ref || it.id || it.text, x: X, y: Y, h, w, rot, ok: !v.length, violacoes: v.map(curta) };
    if (a.ambiguidade && base.owner) { const am = ambiguo(M, base.owner, s.lado, X, Y, isNum(a.margem_ambiguidade) ? a.margem_ambiguidade : 0.2); if (am) { out.ok = false; out.ambiguo_com = am; } }
    return out;
  });
  return { projeto: M.p.nome, ok: res.every(x => x.ok), ms: Date.now() - t0, textos: res,
           regras_do_projeto: M.cfg.existe ? { parametros: M.cfg.parametros, desligar: M.cfg.desligar, areas: M.cfg.areas.length } : null };
}

/* ---------------- serigrafia_posicionar ---------------- */
/* a fileira do componente: vizinhos do mesmo footprint na mesma linha (horizontal) ou coluna */
function fileiraDe(M, c) {
  const L = Math.max(c.caixa.x2 - c.caixa.x1, c.caixa.y2 - c.caixa.y1) * 4 + 3;
  let hz = 0, vt = 0;
  for (const o of M.corpos) {
    if (o === c || o.lado !== c.lado || o.footprint !== c.footprint) continue;
    if (Math.abs(o.cy - c.cy) < 0.5 && Math.abs(o.cx - c.cx) < L) hz++;
    if (Math.abs(o.cx - c.cx) < 0.5 && Math.abs(o.cy - c.cy) < L) vt++;
  }
  return hz || vt ? (hz >= vt ? 'horizontal' : 'vertical') : null;
}
/* os lugares candidatos em volta da caixa B, do mais barato ao mais caro */
function candidatos(B, f, modo, fileira, dmax, passo) {
  const out = [];
  const cx = (B.x1 + B.x2) / 2, cy = (B.y1 + B.y2) / 2, hw = (B.x2 - B.x1) / 2, hh = (B.y2 - B.y1) / 2;
  const lados = modo === 'fileira' && fileira === 'horizontal' ? ['cima', 'baixo']
    : modo === 'fileira' && fileira === 'vertical' ? ['direita', 'esquerda'] : ['cima', 'baixo', 'direita', 'esquerda'];
  const pena = { cima: 0, baixo: 0.05, direita: 0.1, esquerda: 0.15 };
  for (let d = 0.15; d <= dmax + 1e-9; d += passo) for (const lado of lados) {
    const horiz = lado === 'cima' || lado === 'baixo';
    const alcance = modo === 'fileira' ? 0 : (horiz ? hw + d + f.larg / 2 : hh + d + f.alt / 2);
    for (let k = 0; k * passo <= alcance + 1e-9; k++) for (const sg of k ? [1, -1] : [1]) {
      const sh = sg * k * passo;
      const X = horiz ? cx + sh : (lado === 'direita' ? B.x2 + d + f.larg / 2 : B.x1 - d - f.larg / 2);
      const Y = horiz ? (lado === 'cima' ? B.y2 + d + f.alt / 2 : B.y1 - d - f.alt / 2) : cy + sh;
      out.push({ X, Y, custo: d + Math.abs(sh) * 0.5 + pena[lado], lado, d });
    }
  }
  return out;
}

function posicionar(ctx, a) {
  const t0 = Date.now();
  const M = monta(ctx, a);
  const cache = new Map(), avisos = [];
  const T = M.eb.texts || [];
  const modo = a.modo === 'fileira' ? 'fileira' : 'perto';
  const dmax = isNum(a.distancia_max) ? a.distancia_max : 4, passo = isNum(a.passo) ? Math.max(0.05, a.passo) : 0.25;
  const proibeCorpo = a.sobre_corpo !== true;
  const margem = isNum(a.margem_ambiguidade) ? a.margem_ambiguidade : 0.2;
  const maxTent = isNum(a.max_tentativas) ? a.max_tentativas : 4000;
  /* quem: os pedidos, senao todo componente com designator na placa */
  let refs = Array.isArray(a.refs) && a.refs.length ? a.refs.slice()
    : T.filter(t => t && t.designator && !t.hidden && t.owner).map(t => t.owner);
  const naoAchados = refs.filter(r => !T.some(t => t && t.designator && t.owner === r) || !M.corpos.some(c => c.ref === r));
  refs = refs.filter(r => !naoAchados.includes(r));
  /* so os que violam hoje (padrao), a menos que peça todos */
  const violando = new Map();
  for (const ref of refs) {
    const t = T.find(x => x && x.designator && x.owner === ref);
    const s = RC.silkDeTexto(M.K, M.tg, t);
    if (!s) continue;
    const r = M.regras((s.bb.x1 + s.bb.x2) / 2, (s.bb.y1 + s.bb.y2) / 2, t.layer);
    const v = RC.checaSerigrafia(M.cena, s, r.o, r.desl, { parar: true, corpos: proibeCorpo ? M.corpos : null });
    if (v.length) violando.set(ref, v[0]);
  }
  if (a.todos !== true) refs = refs.filter(r => violando.has(r));
  /* os textos velhos dos que vao andar nao contam (vao sair dali) */
  const ignora = new Set(refs.map(r => String((T.find(x => x && x.designator && x.owner === r) || {}).id)));

  const movidos = [], falhas = [], silkDe = new Map();
  /* um componente: o lugar mais barato que nao viola nada da cena de agora */
  const colocaUm = ref => {
    const base = T.find(x => x && x.designator && x.owner === ref);
    const dono = M.corpos.find(c => c.ref === ref);
    const r0 = M.regras(dono.cx, dono.cy, base.layer);
    const hMin = isNum(a.altura_min) ? a.altura_min : r0.o.texto_h_min;
    const hMax = Math.max(hMin, isNum(a.altura_max) ? a.altura_max : Math.max(r0.o.texto_h_min, base.h || r0.o.texto_h_min));
    if (hMin < r0.o.texto_h_min - 1e-6 && !r0.desl.has('texto_tamanho'))
      avisos.push(`${ref}: altura_min ${hMin} abaixo do mínimo da casa (${r0.o.texto_h_min}); libere no projeto com regras_casa_definir {parametros:{texto_h_min}} se o dono pedir`);
    const alturas = [];
    for (let h = hMax; h >= hMin - 1e-9; h -= 0.1) alturas.push(r3(h));
    if (!alturas.length || alturas[alturas.length - 1] > hMin + 1e-9) alturas.push(r3(hMin));
    const longo = (dono.caixa.y2 - dono.caixa.y1) > (dono.caixa.x2 - dono.caixa.x1) * 1.2 ? 90 : 0;
    const rots = isNum(a.rot) ? [normRot(a.rot)] : [longo, longo ? 0 : 90];
    const fileira = modo === 'fileira' ? fileiraDe(M, dono) : null;
    const lista = [];
    for (const h of alturas) {
      const w = isNum(a.traco) ? a.traco : Math.max(r0.o.texto_w_min, r3(h * 0.15));
      for (const rot of rots) {
        const f = formaNoZero(M, cache, base, h, w, rot);
        for (const c of candidatos(dono.caixa, f, modo === 'fileira' && fileira ? 'fileira' : 'perto', fileira, dmax, passo))
          lista.push(Object.assign(c, { h, w, rot, f, custo: c.custo + (hMax - h) * 2 + (rot !== rots[0] ? 0.5 : 0) }));
      }
    }
    lista.sort((x, y) => x.custo - y.custo);
    const motivos = {};
    let achou = null, tent = 0;
    for (const c of lista) {
      if (++tent > maxTent) break;
      if (a.ambiguidade !== false) { const am = ambiguo(M, ref, dono.lado, c.X, c.Y, margem); if (am) { motivos.ambiguidade = (motivos.ambiguidade || 0) + 1; continue; } }
      const s = silkEm(M, c.f, base, c.X, c.Y, c.h, c.w, c.rot);
      const r = M.regras(c.X, c.Y, base.layer);
      const v = RC.checaSerigrafia(M.cena, s, r.o, r.desl, { parar: true, ignora, corpos: proibeCorpo ? M.corpos : null });
      if (v.length) { const k = v[0].sub || v[0].regra; motivos[k] = (motivos[k] || 0) + 1; continue; }
      achou = { c, s };
      break;
    }
    if (!achou) {
      falhas.push({ ref, motivo: 'nenhum lugar livre até ' + dmax + ' mm com altura ' + hMin + '–' + hMax + ' mm', bloqueios: motivos, tentativas: tent - 1,
                    dica: 'aumente distancia_max, baixe altura_min (se o projeto permitir), use ignorar_trilha:true ou libere uma área com regras_casa_definir' });
      ignora.delete(String(base.id));          // o texto velho fica onde esta: volta a contar
      return;
    }
    achou.s.id = 'novo:' + ref;
    M.cena.poe(achou.s);
    silkDe.set(ref, achou.s);
    movidos.push({ ref, de: { x: base.x, y: base.y, h: base.h, w: base.w, rot: base.rot }, para: { x: achou.s.gravar.x, y: achou.s.gravar.y, h: achou.c.h, w: achou.c.w, rot: achou.c.rot },
                   lado: achou.c.lado, distancia_mm: r3(achou.c.d), fileira: fileira || undefined, violava: violando.has(ref) ? curta(violando.get(ref)) : undefined, tentativas: tent });
  };
  /* O texto velho de quem nao achou lugar FICA na placa, mas os que foram postos antes dele o
     ignoraram (contavam que ele ia sair) e podiam cair em cima dele (1.57.0). Depois de cada volta,
     o posto que encosta no texto velho de uma falha sai da cena e procura outro lugar; se nao achar,
     vira falha tambem, e o texto velho dele passa a contar. Para quando nada mais muda. */
  let fila = refs.slice(), refeitos = 0;
  for (let volta = 0; fila.length && volta < 8; volta++) {
    for (const ref of fila) colocaUm(ref);
    fila = [];
    if (!falhas.length) break;
    for (let i = movidos.length - 1; i >= 0; i--) {
      const mv = movidos[i], s = silkDe.get(mv.ref);
      const r = M.regras(mv.para.x, mv.para.y, s.layer);
      const ig = new Set(ignora); ig.add(s.id);
      if (!RC.checaSerigrafia(M.cena, s, r.o, r.desl, { parar: true, ignora: ig, corpos: proibeCorpo ? M.corpos : null }).length) continue;
      M.cena.tira(s); silkDe.delete(mv.ref); movidos.splice(i, 1); fila.push(mv.ref); refeitos++;
    }
  }
  if (refeitos) avisos.push(`${refeitos} rótulo(s) procuraram outro lugar: tinham caído em cima do designator antigo de quem não achou lugar (${falhas.map(f => f.ref).join(', ')})`);

  const out = { projeto: M.p.nome, modo, ms: Date.now() - t0, analisados: refs.length, movidos: movidos.length, sem_lugar: falhas.length,
                ja_ok: a.todos === true ? undefined : 'só os designadores que violam hoje (todos:true reposiciona todos)', posicoes: movidos, falhas,
                nao_achados: naoAchados.length ? naoAchados : undefined, avisos: avisos.length ? avisos : undefined };
  if (!movidos.length) return Object.assign(out, { gravado: false });
  const hc = ctx.pcbPronto();
  const opsTexto = movidos.map(m => Object.assign({ op: 'designator_move', ref: m.ref }, m.para, a.note ? { note: String(a.note).replace(/":/g, '" :') } : {}));
  out.gravacao = ops.transacao(ctx, M.p, (arq, board) => opsTexto.map(o => ops.aplicaTexto(arq, board, hc, o)),
    { simular: a.gravar !== true, forcar: false, ferramenta: 'serigrafia_posicionar' });
  out.gravado = !!out.gravacao.gravado;
  if (a.gravar !== true) out.nota = 'Simulação: nada gravado. Confira (pcb_render) e chame de novo com gravar:true.';
  return out;
}

/* ---------------- serigrafia_imagem / serigrafia_texto (1.60.0) ---------------- */
const LAYERS_SILK = ['TopOverlay', 'BottomOverlay'];
function layerSilk(a) {
  const L = a.layer == null ? 'TopOverlay' : String(a.layer);
  if (!LAYERS_SILK.includes(L)) throw new ErroMcp(`layer deve ser TopOverlay ou BottomOverlay (veio "${L}")`);
  return L;
}
const limpaNote = s => String(s).replace(/[\r\n]+/g, ' ').replace(/":/g, '" :').slice(0, 200);

/* as fontes do Windows pelo nome da familia (o arquivo precisa existir nesta maquina) */
const FONTES = {
  'arial': 'arial.ttf', 'arial bold': 'arialbd.ttf', 'arial negrito': 'arialbd.ttf', 'arial italic': 'ariali.ttf', 'arial bold italic': 'arialbi.ttf',
  'calibri': 'calibri.ttf', 'calibri bold': 'calibrib.ttf', 'calibri negrito': 'calibrib.ttf',
  'segoe ui': 'segoeui.ttf', 'segoe ui bold': 'segoeuib.ttf', 'segoe ui negrito': 'segoeuib.ttf',
  'times new roman': 'times.ttf', 'times new roman bold': 'timesbd.ttf', 'times new roman negrito': 'timesbd.ttf', 'times': 'times.ttf',
  'consolas': 'consola.ttf', 'consolas bold': 'consolab.ttf', 'consolas negrito': 'consolab.ttf',
  'verdana': 'verdana.ttf', 'tahoma': 'tahoma.ttf', 'courier new': 'cour.ttf',
};
const pastaFontes = () => path.join(process.env.WINDIR || process.env.windir || 'C:\\Windows', 'Fonts');
function arquivoDaFonte(fonte) {
  const f = fonte == null || fonte === '' ? 'Arial' : String(fonte);
  if (/[\\/]/.test(f) || /\.(ttf|otf|woff|ttc)$/i.test(f)) {
    const abs = path.isAbsolute(f) ? f : path.join(pastaFontes(), f);
    if (!fs.existsSync(abs)) throw new ErroMcp(`fonte não encontrada: ${abs}`);
    if (/\.ttc$/i.test(abs)) throw new ErroMcp('coleção de fontes (.ttc) não é lida: escolha um .ttf ou .otf');
    return abs;
  }
  const k = f.trim().toLowerCase().replace(/\s+/g, ' ');
  const nome = FONTES[k];
  if (nome) {
    const abs = path.join(pastaFontes(), nome);
    if (fs.existsSync(abs)) return abs;
    throw new ErroMcp(`a fonte "${f}" (${nome}) não está instalada em ${pastaFontes()}: passe o caminho de um .ttf/.otf`);
  }
  for (const ext of ['.ttf', '.otf']) { const abs = path.join(pastaFontes(), k.replace(/ /g, '') + ext); if (fs.existsSync(abs)) return abs; }
  throw new ErroMcp(`fonte "${f}" desconhecida: use um nome (${Object.keys(FONTES).filter(n => !/negrito/.test(n)).join(', ')}) ou o caminho de um .ttf/.otf`);
}
const cacheFontes = new Map();
function carregaFonte(ctx, arq) {
  const ot = ctx.exige('vendor/opentype.min.js', 'opentype');
  const st = fs.statSync(arq);
  const c = cacheFontes.get(arq);
  if (c && c.mtime === st.mtimeMs) return c.font;
  const b = fs.readFileSync(arq);
  let font;
  try { font = ot.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); }
  catch (e) { throw new ErroMcp(`não consegui ler a fonte ${arq}: ${e && e.message || e}`); }
  if (!font || typeof font.getPath !== 'function' || (font.supported === false)) throw new ErroMcp(`a fonte ${arq} não é suportada pelo opentype.js`);
  cacheFontes.set(arq, { mtime: st.mtimeMs, font });
  return font;
}

/* as regras da casa no lugar: a serigrafia nova como um "texto" (todas as regras: pad, via, trilha,
   furo, borda, keepout, outra serigrafia), em unidades do Clipper do regras-casa */
function regrasNoLugar(ctx, a, lista, layer) {
  const M = monta(ctx, { projeto: a.projeto });
  const C = ctx.exige('hub-clipper.js', 'ClipperLib');
  const paths = [];
  for (const op of lista) {
    const P = M.K.paraC(op.pts); if (C.Clipper.Area(P) < 0) P.reverse(); paths.push(P);
    for (const h of op.holes || []) { const H = M.K.paraC(h); if (C.Clipper.Area(H) > 0) H.reverse(); paths.push(H); }
  }
  const bb = M.K.caixa(paths);
  const s = { tipo: 'texto', id: '', texto: a.texto != null ? String(a.texto) : path.basename(String(a.arquivo || 'imagem')), owner: '', designator: false,
              lado: layer === 'BottomOverlay' ? 'Bottom' : 'Top', layer, paths, bb, kind: 'truetype' };
  const r = M.regras((bb.x1 + bb.x2) / 2, (bb.y1 + bb.y2) / 2, layer);
  const v = RC.checaSerigrafia(M.cena, s, r.o, r.desl, {});
  return { ok: !v.length, violacoes: v.slice(0, 20).map(curta), total: v.length };
}

/* o caminho comum dos dois: confere, simula/grava e desenha */
function gravaSilk(ctx, a, p, res, layer, nota, ferramenta) {
  const out = {
    projeto: p.nome, layer, regioes: res.ops.length, furos: res.furos, vertices: res.vertices, area_mm2: res.area_mm2, caixa: res.caixa,
    avisos: res.avisos.length ? res.avisos : undefined, descartadas: res.descartadas.length ? res.descartadas.slice(0, 20) : undefined,
    tracos_finos: res.finos && res.finos.length ? res.finos.slice(0, 10) : undefined, vaos_finos: res.vaos && res.vaos.length ? res.vaos.slice(0, 10) : undefined,
  };
  if (!res.ops.length) {
    out.ok = false; out.gravado = false;
    out.erro = res.recusado ? 'saída grande demais: nada gerado (veja avisos)' : 'nada para gravar (nenhum polígono sobrou)';
    return out;
  }
  const bp = ctx.placa(p).eb.board;
  const bbp = bp && bp.bbox;
  if (bbp && (res.caixa.x1 < bbp.x1 || res.caixa.y1 < bbp.y1 || res.caixa.x2 > bbp.x2 || res.caixa.y2 > bbp.y2))
    (out.avisos = out.avisos || []).push(`a serigrafia sai da caixa da placa (${bbp.x1}..${bbp.x2} x ${bbp.y1}..${bbp.y2} mm)`);
  if (a.conferir !== false) {
    try { out.regras_casa = regrasNoLugar(ctx, a, res.ops, layer); }
    catch (e) { out.regras_casa = { erro: String(e && e.message || e) }; }
  }
  const note = limpaNote(nota);
  const lista = res.ops.map(o => Object.assign({}, o, { note }));
  const iguais = ctx.changes(p).filter(x => x && x.op === 'region_add' && x.note === note).length;
  const substituir = a.substituir === true;
  if (iguais && !substituir) (out.avisos = out.avisos || []).push(`já há ${iguais} região(ões) com a note "${note}" no changes.js: esta chamada SOMA mais uma cópia (substituir:true troca)`);
  const hc = ctx.pcbPronto();
  const g = ops.transacao(ctx, p, arq => {
    if (substituir) for (let i = arq.itens.length - 1; i >= 0; i--) { const x = arq.itens[i]; if (x && x.op === 'region_add' && x.note === note) arq.remove(i); }
    return lista.map(o => ops.mescla(arq, o).obj);
  }, { simular: a.gravar !== true, forcar: a.forcar === true, ferramenta, teardrops: false });
  /* a linha inteira de cada region (milhares de numeros) nao volta: so o status */
  if (Array.isArray(g.linhas)) {
    const L = g.linhas, porStatus = {};
    for (const l of L) porStatus[l.status] = (porStatus[l.status] || 0) + 1;
    g.linhas_resumo = { total: g.linhas_total || L.length, indices: L.length ? [L[0].indice, L[L.length - 1].indice] : [], por_status: porStatus };
    g.linhas = L.filter(l => l.status !== 'ok').slice(0, 20).map(l => ({ indice: l.indice, op: l.op, status: l.status, msg: l.msg }));
    if (!g.linhas.length) delete g.linhas;
    delete g.linhas_total; delete g.linhas_por_op; delete g.nota_linhas;
  }
  out.gravacao = g;
  out.substituidas = substituir ? iguais : undefined;
  out.note = note;
  out.gravado = !!g.gravado;
  out.ok = g.ok !== false;
  if (a.gravar !== true) out.nota = 'Simulação: nada gravado. Confira a imagem e chame de novo com gravar:true.';
  if (a.imagem !== false) {
    try {
      const base = ctx.changes(p).filter(x => !(substituir && x && x.op === 'region_add' && x.note === note));
      const { eb } = a.gravar === true ? ctx.placa(p) : ctx.placa(p, base.concat(lista));
      const m = Math.max(1, 0.25 * Math.max(res.caixa.x2 - res.caixa.x1, res.caixa.y2 - res.caixa.y1));
      const G = ctx.modulo('hub-gerber.js');
      const tg = G && G.geometriaTexto ? (t => { if (!t || t.hidden) return null; try { return G.geometriaTexto(t); } catch (_) { return null; } }) : null;
      const r = render.desenha(hc, eb, { largura: 700, lado: layer === 'BottomOverlay' ? 'bottom' : 'top', textoGeo: tg,
        caixa: { x1: res.caixa.x1 - m, y1: res.caixa.y1 - m, x2: res.caixa.x2 + m, y2: res.caixa.y2 + m } });
      out.imagem = { largura: r.largura, altura: r.altura, mm_por_px: r.mm_por_px, lado: r.lado };
      out._imagem = { base64: r.png.toString('base64'), mime: 'image/png' };
    } catch (e) { out.imagem = { erro: String(e && e.message || e) }; }
  }
  return out;
}
const OPC_SILKGEN = a => {
  const o = {};
  if (isNum(a.largura_min)) o.larguraMin = a.largura_min;
  if (isNum(a.max_vertices)) o.maxVertices = a.max_vertices;
  return o;
};

function silkImagem(ctx, a) {
  const t0 = Date.now();
  const p = ctx.projeto(a.projeto);
  const S = ctx.exige('hub-silkgen.js', 'HubSilkGen');
  const layer = layerSilk(a);
  if (!isNum(a.x) || !isNum(a.y)) throw new ErroMcp('dê x e y (mm): o centro da imagem na placa');
  const arq = path.isAbsolute(String(a.arquivo || '')) ? String(a.arquivo) : path.join(p.dir, String(a.arquivo || ''));
  if (!a.arquivo || !fs.existsSync(arq) || !fs.statSync(arq).isFile()) throw new ErroMcp(`arquivo não encontrado: ${arq}`);
  let img;
  try { img = PNG.decodifica(fs.readFileSync(arq)); }
  catch (e) { if (e instanceof PNG.ErroPng) throw new ErroMcp(e.message); throw e; }
  const tam = {};
  if (isNum(a.largura) && a.largura > 0) tam.largura = a.largura;
  else if (isNum(a.altura) && a.altura > 0) tam.altura = a.altura;
  else if (isNum(a.escala) && a.escala > 0) tam.escala = a.escala;
  else if (img.mm_por_px) tam.escala = img.mm_por_px;
  else throw new ErroMcp('dê largura ou altura (mm) da imagem na placa (ou escala em mm por pixel); o PNG não traz o tamanho físico (pHYs)');
  const espelhar = typeof a.espelhar === 'boolean' ? a.espelhar : layer === 'BottomOverlay';
  const opts = Object.assign({ x: a.x, y: a.y, espelhar, rot: isNum(a.rot) ? a.rot : 0, layer,
    limiar: isNum(a.limiar) ? a.limiar : 128, inverter: a.inverter === true, alfa: a.alfa !== false,
    simplificar: isNum(a.simplificar) ? a.simplificar : 0.02, areaMin: isNum(a.area_min) ? a.area_min : 1,
    diagonal: a.diagonal === 'liga' ? 'liga' : 'separa', caixaPx: a.caixa === 'imagem' ? { x1: 0, y1: 0, x2: img.w, y2: img.h } : undefined,
    HubCore: ctx.hc, ClipperLib: ctx.modulo('hub-clipper.js') || undefined }, tam, OPC_SILKGEN(a));
  const res = S.daImagem(img.rgba, img.w, img.h, opts);
  const nota = a.note ? String(a.note) : 'serigrafia imagem ' + path.basename(arq);
  const out = gravaSilk(ctx, a, p, res, layer, nota, 'serigrafia_imagem');
  return Object.assign({ arquivo: arq, pixels: res.pixels, png: { tipo_cor: img.tipo, bits: img.bits, mm_por_px_do_arquivo: img.mm_por_px || undefined },
    tinta_px: res.tinta_px, reduzida: res.reduzida > 1 ? res.reduzida : undefined, mm_por_px: res.escala ? Math.round(res.escala * 1e6) / 1e6 : null, espelhada: espelhar }, out, { ms: Date.now() - t0 });
}

function silkTexto(ctx, a) {
  const t0 = Date.now();
  const p = ctx.projeto(a.projeto);
  const S = ctx.exige('hub-silkgen.js', 'HubSilkGen');
  const layer = layerSilk(a);
  if (typeof a.texto !== 'string' || !a.texto.trim()) throw new ErroMcp('texto vazio');
  if (!isNum(a.x) || !isNum(a.y)) throw new ErroMcp('dê x e y (mm)');
  if (!(isNum(a.h) && a.h > 0)) throw new ErroMcp('dê h (mm): a altura da letra maiúscula');
  const arqF = arquivoDaFonte(a.fonte);
  const font = carregaFonte(ctx, arqF);
  const espelhar = typeof a.espelhar === 'boolean' ? a.espelhar : layer === 'BottomOverlay';
  const alinha = ['esquerda', 'centro', 'direita'].includes(a.alinha) ? a.alinha : 'centro';
  const opts = Object.assign({ x: a.x, y: a.y, h: a.h, alinha, espelhar, rot: isNum(a.rot) ? a.rot : 0, layer,
    hRef: a.altura_de === 'em' ? 'em' : 'maiuscula', ancora: a.ancora === 'base' ? 'base' : 'centro',
    tolerancia: isNum(a.tolerancia) ? a.tolerancia : undefined, entrelinha: isNum(a.entrelinha) ? a.entrelinha : undefined,
    HubCore: ctx.hc, ClipperLib: ctx.modulo('hub-clipper.js') || undefined }, OPC_SILKGEN(a));
  const res = S.daTexto(font, a.texto, opts);
  const nota = a.note ? String(a.note) : 'serigrafia texto ' + a.texto.replace(/[\r\n]+/g, ' ').slice(0, 60);
  const out = gravaSilk(ctx, a, p, res, layer, nota, 'serigrafia_texto');
  const nomeF = (font.names && font.names.fullName && (font.names.fullName.en || Object.values(font.names.fullName)[0])) || path.basename(arqF);
  return Object.assign({ texto: a.texto, fonte: { nome: nomeF, arquivo: arqF }, h_maiuscula_mm: opts.hRef === 'em' ? undefined : a.h,
    corpo_mm: Math.round(res.corpo_mm * 1e4) / 1e4, alinha, espelhado: espelhar, sem_glifo: res.faltam.length ? res.faltam : undefined }, out, { ms: Date.now() - t0 });
}

const OPC_SILK = {
  layer: { type: 'string', enum: LAYERS_SILK, description: 'padrão TopOverlay; na BottomOverlay sai espelhado (lido por baixo)' },
  espelhar: { type: 'boolean', description: 'padrão: true na BottomOverlay, false na TopOverlay' },
  rot: { type: 'number', description: 'graus, anti-horário, em volta do centro' },
  largura_min: { type: 'number', description: 'mm (padrão 0,15, o traço mínimo da serigrafia da casa): avisa traço e vão mais finos' },
  max_vertices: { type: 'integer', description: 'guarda (padrão 20000): acima disso nada sai' },
  conferir: { type: 'boolean', description: 'padrão true: confere as regras da casa no lugar (pad, via, trilha, furo, borda, keepout, outra serigrafia)' },
  imagem: { type: 'boolean', description: 'padrão true: devolve a imagem do lugar com a serigrafia' },
  substituir: { type: 'boolean', description: 'true = tira antes as region_add com a mesma note (refazer no lugar sem duplicar)' },
  note: { type: 'string', description: 'a note das linhas (padrão "serigrafia imagem <arquivo>" / "serigrafia texto <texto>"); é a chave do substituir' },
  gravar: { type: 'boolean', description: 'padrão false: só simula' },
  forcar: { type: 'boolean', description: 'grava mesmo com erro de validação (evite)' },
};

const OPC_COMUNS = {
  folga_pad: { type: 'number', description: 'folga do texto para pad, via, furo e outra serigrafia, mm (padrão: o "silk" das regras da casa, 0,254)' },
  folga_trilha: { type: 'number', description: 'folga do texto para trilha/fill/região do mesmo lado, mm (padrão 0,1)' },
  ignorar_trilha: { type: 'boolean', description: 'true = texto pode passar por cima de trilha (só nesta chamada; para o projeto, regras_casa_definir)' },
};

/* ── as ARTES DE OVERLAY (1.91.0): a logo DiEletrons + QR, o código da placa + revisão e as artes do Studio ──
   A biblioteca: as da casa (hub-pcbartes.js » PADRAO) + Libs/pcb-artes.json (a da rede, pelo NexoBD). Pôr na placa é
   o mesmo comp_add com o desenho que a vista escreve (HubPcbArtes.opColocar): um objeto só, que pcb_mover move, gira e
   vira de face (Bottom = Bottom Overlay espelhada). */
function bibliotecaArtes(ctx) {
  const A = ctx.exige('hub-pcbartes.js', 'HubPcbArtes');
  let lib = null;
  try { lib = JSON.parse(fs.readFileSync(path.join(ctx.root, 'Libs', 'pcb-artes.json'), 'utf8')); } catch (_) { lib = null; }
  return { A, artes: A.lista(lib) };
}
function artesListar(ctx, a) {
  const { A, artes } = bibliotecaArtes(ctx);
  const out = { artes: artes.map(x => {
    const c = A.compila(x), b = c.caixa;
    return { id: x.id, nome: x.nome, padrao: !!x.padrao, versao: x.versao || 0, descricao: x.descricao || undefined,
      tamanho_mm: b ? [r3(b.x2 - b.x1), r3(b.y2 - b.y1)] : null,
      elementos: (x.elementos || []).map(e => e.tipo + (e.tipo === 'texto' || e.tipo === 'qr' ? ': ' + e.texto : '')),
      campos: [...new Set([].concat(...(x.elementos || []).filter(e => e.tipo === 'texto').map(e => A.camposDe(e.texto))))],
      avisos: c.avisos.length ? c.avisos : undefined };
  }), campos: A.CAMPOS.map(c => '=' + c.nome + ' (' + c.rot + ')') };
  if (a.projeto) {
    const p = ctx.projeto(a.projeto);
    const { eb } = ctx.placa(p);
    const hc = ctx.hc;
    out.na_placa = (eb.components || []).filter(c => c && c.arte).map(c => ({ ref: c.ref, arte: c.arte.id, nome: c.arte.nome, escala: c.arte.escala,
      x: c.x, y: c.y, rot: c.rot, layer: c.layer, face: c.layer === 'Bottom' ? 'BottomOverlay' : 'TopOverlay',
      textos: (eb.texts || []).filter(t => t.owner === c.ref && !t.designator).map(t => hc.resolveEspeciais(t.text)) }));
  }
  return out;
}
async function arteColocar(ctx, a) {
  const p = ctx.projeto(a.projeto);
  const { A, artes } = bibliotecaArtes(ctx);
  const arte = artes.find(x => x.id === a.arte) || artes.find(x => String(x.nome).toLowerCase() === String(a.arte || '').toLowerCase());
  if (!arte) throw new ErroMcp(`arte "${a.arte}" não está na biblioteca. Existem: ${artes.map(x => x.id).join(', ')}`);
  const { eb } = ctx.placa(p);
  const usados = (eb.components || []).map(c => c.ref);
  if (a.ref && usados.includes(a.ref)) throw new ErroMcp(`a placa já tem um ${a.ref}`);
  const lado = a.layer === 'Bottom' ? 'Bottom' : 'Top';
  const op = A.opColocar(arte, { ref: a.ref || A.proximoRef(usados), x: a.x, y: a.y, rot: isNum(a.rot) ? a.rot : (lado === 'Bottom' ? 180 : 0), layer: lado, escala: a.escala });
  if (a.note) op.note = String(a.note).replace(/":/g, '" :');
  const est = await ops.transacao(ctx, p, arq => [ops.mescla(arq, op).obj], { simular: !a.gravar, forcar: a.forcar, ferramenta: 'pcb_arte_colocar' });
  const av = A.confere(op.arte.fp, op.arte.escala);
  return Object.assign({ ref: op.ref, arte: arte.id, face: lado === 'Bottom' ? 'BottomOverlay (espelhada)' : 'TopOverlay', avisos_jlc: av.length ? av : undefined,
    gravado: !!(est && est.gravado), dica: a.gravar ? undefined : 'simulado: gravar:true grava' }, est || {});
}

module.exports = {
  grupo: 'serigrafia',
  ordem: 46,
  titulo: 'Serigrafia — conferir um lugar candidato, posicionar designadores pelas regras da casa, converter imagem (PNG) ou texto (fonte TrueType) em serigrafia e as artes de overlay (logo + QR, código + revisão)',
  modulos: ['hub-clipper.js', 'hub-gerber.js', 'hub-silkgen.js', 'vendor/opentype.min.js', 'hub-pcbartes.js'],
  ferramentas: [
    {
      nome: 'serigrafia_checar', titulo: 'Conferir lugar de texto', leitura: true, modulo: 'hub-clipper.js',
      descricao: 'Diz se um lugar CANDIDATO de texto de serigrafia viola alguma regra da casa (pad/via, trilha, furo, parafuso, borda, outra serigrafia, altura/traço mínimos), sem gravar e sem rodar o DRC — a mesma conta do regras_casa_verificar, com as regras do projeto e da área. Cada item: {ref (o designator dele) | id (texto existente) | text + layer (texto novo), x, y (centro, mm), h?, w?, rot?}. corpo:true também proíbe o corpo dos outros componentes ("todos" inclui o dono); ambiguidade:true acusa rótulo mais perto de outro componente do que do dono.',
      entrada: { type: 'object', properties: Object.assign({ projeto: PROJETO,
        textos: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: true } },
        corpo: { description: 'true | "todos"' }, ambiguidade: { type: 'boolean' }, margem_ambiguidade: { type: 'number' } }, OPC_COMUNS), required: ['projeto', 'textos'] },
      executa: async (a, ctx) => checar(ctx, a),
    },
    {
      nome: 'serigrafia_posicionar', titulo: 'Posicionar designadores',
      descricao: 'Acha lugar para os designadores (todos os que violam as regras da casa hoje, ou os refs dados, ou todos:true) e grava como designator_move no lugar final. Procura em volta da caixa de cada componente, do mais perto ao mais longe (até distancia_max), da maior altura (altura_max) à menor (altura_min, padrão o mínimo da casa), paralelo ao lado comprido do componente (rot fixa o giro); recusa lugar em cima de pad/via/furo/trilha/serigrafia/borda (folgas das regras da casa e do projeto), em cima do corpo de componente (sobre_corpo:true libera) e ambíguo (o rótulo mais perto de outro componente que do dono; ambiguidade:false desliga). modo "fileira": numa fileira de componentes iguais o rótulo fica alinhado ao próprio componente (em cima/embaixo numa fileira horizontal, ao lado numa vertical). Padrão SIMULA e mostra de/para; gravar:true grava. Os que não acham lugar voltam em "falhas" com o que bloqueou.',
      entrada: { type: 'object', properties: Object.assign({ projeto: PROJETO,
        refs: { type: 'array', items: { type: 'string' } }, todos: { type: 'boolean', description: 'true = reposiciona também os que já estão bons' },
        altura_min: { type: 'number' }, altura_max: { type: 'number' }, traco: { type: 'number', description: 'traço fixo (padrão: 0,15 h, no mínimo o traço mínimo da casa)' },
        rot: { type: 'number', description: '0 ou 90 (padrão: paralelo ao lado comprido; tenta o outro depois)' },
        modo: { type: 'string', enum: ['perto', 'fileira'] }, distancia_max: { type: 'number', description: 'mm a partir da caixa do componente (padrão 4)' },
        passo: { type: 'number', description: 'mm entre lugares testados (padrão 0,25)' },
        sobre_corpo: { type: 'boolean' }, ambiguidade: { type: 'boolean' }, margem_ambiguidade: { type: 'number', description: 'mm (padrão 0,2)' },
        max_tentativas: { type: 'integer', description: 'por componente (padrão 4000)' },
        gravar: { type: 'boolean' }, note: { type: 'string' } }, OPC_COMUNS), required: ['projeto'] },
      executa: async (a, ctx) => posicionar(ctx, a),
    },
    {
      nome: 'serigrafia_imagem', titulo: 'Imagem (PNG) em serigrafia', modulo: 'hub-silkgen.js',
      descricao: 'Converte um PNG do disco (logo, símbolo, selo) em serigrafia: limiar na luminância (o escuro é tinta; inverter:true troca; o transparente nunca é tinta), contorno pelo marching squares, escala para largura OU altura em mm (o outro lado segue a proporção; ou escala em mm/pixel, ou o tamanho físico do PNG) com o CENTRO da tinta em x, y, simplificação (simplificar, mm, padrão 0,02) e region_add com holes (o miolo de cada letra/furo do logo) na TopOverlay/BottomOverlay — cada região conferida pelo motor. Avisa traço/vão abaixo de largura_min e as regras da casa no lugar, e devolve a imagem. Só PNG (sem entrelaçamento): JPEG e outros voltam com erro pedindo PNG. Padrão SIMULA; gravar:true grava; substituir:true refaz no lugar sem duplicar.',
      entrada: { type: 'object', properties: Object.assign({ projeto: PROJETO,
        arquivo: { type: 'string', description: 'caminho do PNG (absoluto, ou relativo à pasta do projeto)' },
        x: { type: 'number', description: 'mm: centro da tinta na placa' }, y: { type: 'number', description: 'mm' },
        largura: { type: 'number', exclusiveMinimum: 0, description: 'mm, da caixa da tinta' }, altura: { type: 'number', exclusiveMinimum: 0, description: 'mm, da caixa da tinta' },
        escala: { type: 'number', exclusiveMinimum: 0, description: 'mm por pixel (no lugar de largura/altura)' },
        caixa: { type: 'string', enum: ['tinta', 'imagem'], description: 'a referência do centro e da largura/altura: a caixa da tinta (padrão) ou a imagem inteira' },
        limiar: { type: 'number', minimum: 0, maximum: 255, description: 'luminância abaixo dele é tinta (padrão 128)' },
        inverter: { type: 'boolean', description: 'true = o claro é tinta (logo branco em fundo escuro)' },
        alfa: { type: 'boolean', description: 'padrão true: pixel transparente nunca é tinta' },
        simplificar: { type: 'number', minimum: 0, description: 'tolerância da simplificação em mm (padrão 0,02; 0 = sem)' },
        area_min: { type: 'number', minimum: 0, description: 'px²: mancha/furo menor que isso some (padrão 1)' },
        diagonal: { type: 'string', enum: ['separa', 'liga'], description: 'dois pixels de tinta só pela quina: separados (padrão) ou ligados' },
      }, OPC_SILK), required: ['projeto', 'arquivo', 'x', 'y'] },
      executa: async (a, ctx) => silkImagem(ctx, a),
    },
    {
      nome: 'serigrafia_texto', titulo: 'Texto em fonte TrueType na serigrafia', modulo: 'hub-silkgen.js',
      descricao: 'Escreve um texto na serigrafia numa fonte TrueType/OpenType (padrão Arial do Windows; fonte = nome — Arial, Arial Bold, Calibri, Segoe UI, Times New Roman, Consolas, Verdana… — ou o caminho de um .ttf/.otf), como region_add com holes (o "o", o "e", o "D" com o miolo vazado), sem a fonte stroke do text_add. h = altura da MAIÚSCULA em mm (altura_de:"em" = o corpo da fonte); x, y = a caixa da tinta: alinha esquerda (x = borda esquerda) | centro (padrão) | direita, y = meio (ancora:"base" = linha de base da 1ª linha). "\\n" quebra linha. Avisa traço abaixo de largura_min (0,15 mm: em Arial, h abaixo de ~1,2 mm já fica fino), caractere sem glifo e as regras da casa no lugar; devolve a imagem. Padrão SIMULA; gravar:true grava; substituir:true refaz no lugar sem duplicar.',
      entrada: { type: 'object', properties: Object.assign({ projeto: PROJETO,
        texto: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' },
        h: { type: 'number', exclusiveMinimum: 0, description: 'mm: altura da letra maiúscula' },
        fonte: { type: 'string', description: 'nome da família (Arial, Arial Bold, Calibri, Segoe UI, Times New Roman, Consolas…) ou caminho de .ttf/.otf' },
        alinha: { type: 'string', enum: ['esquerda', 'centro', 'direita'] },
        ancora: { type: 'string', enum: ['centro', 'base'] },
        altura_de: { type: 'string', enum: ['maiuscula', 'em'] },
        tolerancia: { type: 'number', exclusiveMinimum: 0, description: 'mm, ao achatar as curvas (padrão h/200)' },
        entrelinha: { type: 'number', exclusiveMinimum: 0, description: 'múltiplo de h entre linhas (padrão: a da fonte)' },
      }, OPC_SILK), required: ['projeto', 'texto', 'x', 'y', 'h'] },
      executa: async (a, ctx) => silkTexto(ctx, a),
    },
    {
      nome: 'pcb_artes', titulo: 'Listar artes de overlay', leitura: true, modulo: 'hub-pcbartes.js',
      descricao: 'As ARTES DE OVERLAY da biblioteca da rede (o botão "Artes" da vista PCB): as da casa — "dieletrons-logo-qr" (a logo DiEletrons com o QR de www.dieletrons.com) e "codigo-revisao" (=CodigoDaPlaca e =Revisao, automáticos) — e as criadas no Studio, com tamanho, elementos, campos e avisos do mínimo da JLC. Com projeto, também as que já estão na placa (ref, posição, face e os textos já resolvidos).',
      entrada: { type: 'object', properties: { projeto: Object.assign({}, PROJETO, { description: 'opcional: lista também as artes postas nesta placa' }) } },
      executa: async (a, ctx) => artesListar(ctx, a),
    },
    {
      nome: 'pcb_arte_colocar', titulo: 'Colocar arte de overlay na placa', modulo: 'hub-pcbartes.js',
      descricao: 'Põe uma arte de overlay da biblioteca na placa (pcb_artes lista): um objeto só (comp_add com o desenho, ref ARTE1, ARTE2...), centrado em x, y; layer Bottom = Bottom Overlay espelhada; rot em graus; escala multiplica tudo (traço e texto juntos). Os campos (=CodigoDaPlaca, =Revisao...) saem com o projeto na tela, no Gerber e no PDF. Depois, pcb_mover move/gira/vira e apagar é comp_del. Não pode com a variante de projeto ativa (a PCB é a da padrão). Padrão SIMULA; gravar:true grava.',
      entrada: { type: 'object', properties: { projeto: PROJETO, arte: { type: 'string', description: 'id (ou nome) da arte' },
        x: { type: 'number' }, y: { type: 'number' }, rot: { type: 'number' }, layer: { type: 'string', enum: ['Top', 'Bottom'] },
        escala: { type: 'number', exclusiveMinimum: 0, maximum: 50 }, ref: { type: 'string', description: 'designador (padrão: o próximo ARTEn livre)' },
        gravar: { type: 'boolean' }, forcar: { type: 'boolean' }, note: { type: 'string' } }, required: ['projeto', 'arte', 'x', 'y'] },
      executa: async (a, ctx) => arteColocar(ctx, a),
    },
  ],
  _interno: { checar, posicionar, silkImagem, silkTexto, arquivoDaFonte, artesListar, arteColocar },
};
