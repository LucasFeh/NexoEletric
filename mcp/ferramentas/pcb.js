/* NexoEletric MCP - grupo "pcb": ler a placa efetiva e escrever o changes.js.

   Regras do AI-GUIDE (Parte B) que as ferramentas cumprem sozinhas:
     - o board.js nunca e editado; tudo vira op no changes.js, uma por linha;
     - orig_* copiados do board.js automaticamente (a IA nao precisa nem ve-los);
     - um objeto, uma linha: mexer de novo edita a linha existente;
     - valida com HubCore.applyPcbChanges antes de gravar; erro = nada gravado. */
'use strict';
const { ArquivoLinhas } = require('../lib/arquivo-linhas.js');
const { ErroMcp } = require('../lib/contexto.js');
const ops = require('../lib/pcb-ops.js');
const geo = require('../lib/geometria.js');
const render = require('../lib/render.js');
const { PROJETO, isNum, r4, caixa, noRet } = require('../lib/util.js');

const COMUNS = {
  note: { type: 'string', description: 'o porquê da mudança (vai no campo note; sem a sequência aspas-dois-pontos). Se resolve um sinalizador, comece com o id: "n3: ..."' },
  simular: { type: 'boolean', description: 'true = só valida e mostra o resultado, sem gravar' },
  forcar: { type: 'boolean', description: 'true = grava mesmo com erro de validação (evite; o ApplyChanges vai recusar a linha)' },
};
const PT = { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: '[x, y] em mm' };

const comNote = (op, a) => { if (a.note) op.note = String(a.note).replace(/":/g, '" :'); return op; };

/* ---------- consulta ---------- */
const TIPOS = {
  componentes: eb => (eb.components || []).map(c => ({ ref: c.ref, footprint: c.footprint, comment: c.comment, layer: c.layer, x: c.x, y: c.y, rot: c.rot, bbox: c.bbox,
    pads: (c.pads || []).length, nets: [...new Set((c.pads || []).map(p => p.net).filter(Boolean))] })),
  pads: eb => [].concat(...(eb.components || []).map(c => (c.pads || []).map(p => ({ ref: c.ref, name: p.name, id: p.id, x: p.x, y: p.y, w: p.w, h: p.h, rot: p.rot, shape: p.shape, layer: p.layer, type: p.type, drill: p.drill, plated: p.drill > 0 ? p.plated !== false : undefined, net: p.net || '' }))),
    (eb.freepads || []).map(p => ({ ref: '', name: p.name, id: p.id, x: p.x, y: p.y, w: p.w, h: p.h, rot: p.rot, shape: p.shape, layer: p.layer, type: p.type, drill: p.drill, plated: p.drill > 0 ? p.plated !== false : undefined, net: p.net || '' }))),
  trilhas: eb => eb.tracks || [],
  arcos: eb => eb.arcs || [],
  vias: eb => eb.vias || [],
  textos: eb => (eb.texts || []).map(t => { const o = Object.assign({}, t); delete o.polys; return o; }),
  fills: eb => eb.fills || [],
  regioes: eb => (eb.regions || []).map(g => ({ id: g.id, layer: g.layer, net: g.net, poly: g.poly, owner: g.owner, keepout: g.keepout, n: (g.points || []).length,
    bbox: bboxPts(g.points), points: (g.points || []).length <= 40 ? g.points : undefined })),
  silk: eb => eb.silk || [],
  linhas: eb => eb.lines || [],
  poligonos: eb => (eb.polygons || []).map(g => Object.assign({}, g, { pts: undefined, n: (g.pts || g.points || []).length, bbox: bboxPts(g.pts || g.points) })),
  recortes: eb => (eb.cutouts || []).map(k => ({ id: k.id, kindn: k.kindn, n: (k.points || []).length, bbox: bboxPts(k.points) })),
};
function bboxPts(P) {
  if (!Array.isArray(P) || !P.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of P) { x1 = Math.min(x1, p[0]); y1 = Math.min(y1, p[1]); x2 = Math.max(x2, p[0]); y2 = Math.max(y2, p[1]); }
  return { x1: r4(x1), y1: r4(y1), x2: r4(x2), y2: r4(y2) };
}
function caixaDe(o) {
  if (o.bbox) return o.bbox;
  if ([o.x1, o.y1, o.x2, o.y2].every(isNum)) return { x1: Math.min(o.x1, o.x2), y1: Math.min(o.y1, o.y2), x2: Math.max(o.x1, o.x2), y2: Math.max(o.y1, o.y2) };
  if ([o.cx, o.cy, o.r].every(isNum)) return { x1: o.cx - o.r, y1: o.cy - o.r, x2: o.cx + o.r, y2: o.cy + o.r };
  if ([o.x, o.y].every(isNum)) { const h = Math.max(o.w || o.size || 0, o.h || o.size || 0) / 2; return { x1: o.x - h, y1: o.y - h, x2: o.x + h, y2: o.y + h }; }
  return null;
}
const sobrepoe = (a, b) => a && b && a.x1 <= b.x2 && a.x2 >= b.x1 && a.y1 <= b.y2 && a.y2 >= b.y1;

/* ---------- texto dentro do contorno? (o designator que vai parar fora da placa) ----------
   t => true | false | undefined (sem contorno). A forma do texto vem do HubGerber (a mesma da tela e
   do Gerber); sem ele, a caixa aproximada pelo tamanho da fonte. */
function dentroDaPlaca(ctx, eb) {
  const P = ctx.modulo('hub-pcbpour.js'), G = ctx.modulo('hub-gerber.js');
  const anel = P && P._int && P._int.contornoPlaca ? P._int.contornoPlaca(eb.board, 0.05) : null;
  if (!anel) return () => undefined;
  const dentro = (x, y) => {
    let c = false;
    for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
      const [xi, yi] = anel[i], [xj, yj] = anel[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  return t => {
    let pts = [];
    try {
      const g = G && G.geometriaTexto ? G.geometriaTexto(t) : null;
      if (g && Array.isArray(g.regioes)) for (const r of g.regioes) if (r && !r.hole && r.pts) pts.push(...r.pts);
      if (g && Array.isArray(g.tracos)) for (const tr of g.tracos) if (Array.isArray(tr)) pts.push(...tr);
    } catch (_) { pts = []; }
    if (!pts.length && isNum(t.x) && isNum(t.y)) {
      const hw = String(t.text || '').length * (t.h || 1) * 0.45, hh = (t.h || 1) / 2;
      pts = [[t.x - hw, t.y - hh], [t.x + hw, t.y - hh], [t.x + hw, t.y + hh], [t.x - hw, t.y + hh]];
    }
    return pts.length ? pts.every(q => dentro(q[0], q[1])) : undefined;
  };
}

/* ---------- o DRC antes x depois de um conjunto de ops (pcb_aplicar drc:true) ----------
   A mesma conta do drc_rodar (planos redespejados, regras do projeto); a violacao e a mesma quando
   o tipo e os objetos batem (a mensagem muda com a distancia). */
function drcDiferenca(ctx, p, antes, depois, tipos) {
  const D = ctx.modulo('hub-pcbdrc.js');
  if (!D) return { erro: 'hub-pcbdrc.js ausente nesta instalação' };
  const R = ops.regrasDoProjeto(ctx, p);
  const G = ctx.modulo('hub-gerber.js');
  const o = { textoGeo: G && G.geometriaTexto ? (t => { try { return G.geometriaTexto(t); } catch (_) { return null; } }) : undefined };
  if (tipos) o.tipos = tipos;
  const t0 = Date.now();
  const roda = itens => D.rodar(ctx.placaDespejada(p, itens).eb, R ? R.conjunto : undefined, o).violacoes || [];
  const va = roda(antes), vd = roda(depois);
  const chave = v => v.tipo + '|' + (v.ids || []).map(String).sort().join('|');
  const ka = new Set(va.map(chave)), kd = new Set(vd.map(chave));
  const curta = v => ({ tipo: v.tipo, msg: v.msg, x: v.x, y: v.y, layer: v.layer, ids: v.ids });
  const novas = vd.filter(v => !ka.has(chave(v))), sairam = va.filter(v => !kd.has(chave(v)));
  return { antes: va.length, depois: vd.length, novas: novas.length, sairam: sairam.length, ms: Date.now() - t0,
           lista_novas: novas.slice(0, 50).map(curta), lista_sairam: sairam.slice(0, 20).map(curta) };
}

/* ---------- a placa: pontos do contorno para o roteador ---------- */
function lacosDe(ctx, eb) {
  const L = ctx.modulo('hub-laser.js');
  const segs = [];
  for (const s of ((eb.board && eb.board.outline) || [])) {
    if (!s) continue;
    if (s.kind === 'arc') { if (L && [s.cx, s.cy, s.r, s.sa, s.ea].every(isNum)) segs.push(L.arcPts(s.cx, s.cy, s.r, s.sa, s.ea)); }
    else if ([s.x1, s.y1, s.x2, s.y2].every(isNum)) segs.push([[s.x1, s.y1], [s.x2, s.y2]]);
  }
  const lacos = ((L && L.chainSegments) ? L.chainSegments(segs) : segs).filter(l => l.length >= 3);
  if (lacos.length) return lacos;
  const bb = eb.board && eb.board.bbox;
  return bb ? [[[bb.x1, bb.y1], [bb.x2, bb.y1], [bb.x2, bb.y2], [bb.x1, bb.y2]]] : [];
}
function textoGeo(ctx) {
  const G = ctx.modulo('hub-gerber.js');
  return G && G.geometriaTexto ? (t => { if (!t || t.hidden) return null; try { return G.geometriaTexto(t); } catch (_) { return null; } }) : null;
}
/* os recortes que são furo (Board Cutout), como o DRC os lê: o do tamanho da placa é a forma dela */
function recortesDe(eb) {
  const bb = eb.board && eb.board.bbox, out = [];
  for (const k of eb.cutouts || []) {
    if (!k || !Array.isArray(k.points) || k.points.length < 3 || k.kindn === -1 || k.kindn === 1) continue;
    const xs = k.points.map(q => q[0]), ys = k.points.map(q => q[1]);
    if (bb && Math.min(...xs) <= bb.x1 + 1e-3 && Math.max(...xs) >= bb.x2 - 1e-3 && Math.min(...ys) <= bb.y1 + 1e-3 && Math.max(...ys) >= bb.y2 - 1e-3) continue;
    out.push({ id: k.id, pts: k.points });
  }
  return out;
}
/* a cena do roteador com as REGRAS DO PROJETO (as mesmas do drc_rodar): folga por par, contorno,
   largura/via/camada pela regra da net. `p` = o projeto; sem ele (ou sem o hub-pcbregras.js), a
   folga única do board.rules */
function cena(ctx, eb, p) {
  const R = ctx.exige('hub-roteador.js', 'HubRoteador');
  const rules = eb.rules || {};
  const o = { placa: { lacos: lacosDe(ctx, eb), recortes: recortesDe(eb) }, textoGeo: textoGeo(ctx) };
  const S = p ? ops.regrasDoProjeto(ctx, p) : null;
  if (S) o.regras = S.conjunto; else o.clearance = rules.clearance > 0 ? rules.clearance : R.FOLGA_PADRAO;
  return R.cena(eb, o);
}

/* a largura e a via que as regras do projeto pedem para a net (o roteador resolve: é a mesma conta
   da vista); sem o roteador ou sem regras, o board.rules */
function larguraDaNet(ctx, eb, p, net, layer, board) {
  const R = ctx.modulo('hub-roteador.js');
  if (R && R.larguraDaRegra && ctx.hc.isCopper(layer)) return R.larguraDaRegra(cena(ctx, eb, p), net || '', layer).pref;
  return board.rules && board.rules.width > 0 ? board.rules.width : 0.254;
}
function viaDaNet(ctx, eb, p, net, rules) {
  const R = ctx.modulo('hub-roteador.js');
  if (R && R.viaDaRegra) return R.viaDaRegra(cena(ctx, eb, p), net || '');
  return { size: rules.viaSize || 0.6, drill: rules.viaDrill || 0.3 };
}

/* o pad do componente "R1.2" (ou {ref, pad}) na placa efetiva */
function padDe(eb, alvo) {
  const s = String(alvo);
  const i = s.lastIndexOf('.');
  if (i <= 0) return null;
  const c = (eb.components || []).find(x => x.ref === s.slice(0, i));
  return c ? (c.pads || []).find(p => String(p.name) === s.slice(i + 1)) || null : null;
}
function ponto(eb, v, nome, layer) {
  if (Array.isArray(v) && v.length === 2 && v.every(isNum)) {
    /* com a camada: o pad sob o ponto (o snap do Altium) — o passante ou o SMD da camada primeiro,
       senão o SMD de outra camada, que a rota não pode ligar */
    if (layer) {
      const sob = TIPOS.pads(eb).filter(q => geo.noPad(q, v[0], v[1], 1e-6));
      const q = sob.find(q => q.type === 'th' || q.layer === 'Multi' || q.layer === layer) || sob[0];
      if (q) return { x: v[0], y: v[1], net: q.net || '', pad: q };
    }
    return { x: v[0], y: v[1], net: '', pad: null };
  }
  const p = padDe(eb, v);
  if (!p) throw new ErroMcp(`${nome}: use [x,y] em mm ou "REF.PINO" (ex.: "R1.2"); "${v}" não achado`);
  return { x: p.x, y: p.y, net: p.net || '', pad: p };
}

/* trilhas que tocavam os pads de um componente (para avisar depois de mover) */
function trilhasNosPads(comp, eb) {
  const out = [];
  for (const t of eb.tracks || []) {
    if (!t || !t.id) continue;
    for (const p of comp.pads || []) {
      if ((p.type === 'th' || p.layer === t.layer) && (geo.noPad(p, t.x1, t.y1, 0.01) || geo.noPad(p, t.x2, t.y2, 0.01))) { out.push({ id: t.id, layer: t.layer, net: t.net, pad: comp.ref + '.' + p.name }); break; }
    }
  }
  return out;
}

/* ---------- um comp_move (pcb_mover e pcb_mover_lote) ----------
   O op do movimento a partir do pedido (x/y absolutos ou dx/dy, rot ou drot, layer) e do componente
   como ele está na placa efetiva. */
function opDoMovimento(c, a) {
  return { op: 'comp_move', ref: a.ref,
    x: isNum(a.x) ? a.x : r4(c.x + (a.dx || 0)), y: isNum(a.y) ? a.y : r4(c.y + (a.dy || 0)),
    rot: isNum(a.rot) ? ((a.rot % 360) + 360) % 360 : (((c.rot + (a.drot || 0)) % 360) + 360) % 360,
    layer: a.layer || c.layer };
}
/* grava o movimento no changes.js (dentro de uma ops.transacao) e devolve a linha que ficou */
function gravaMovimento(ctx, arq, board, op) {
  /* componente que chegou pelo ECO (ou pelo pcb_colocar) ainda é um comp_add no changes.js: mover é
     editar a linha dele, com o designator (des_*) junto -- pcb-ops » opNoAdicionado */
  return ops.aplica(arq, board, ctx.hc, op);
}

/* AS TRILHAS PRESAS NOS PADS DE QUEM ANDOU (pcb_mover e pcb_mover_lote, trilhas:"arrastar"|"apagar").
   Arrastar = a ponta que estava num pad vai junto com o pad (a mesma conta do componente, compDelta +
   xfPoint): a trilha estica, como o "drag" do Altium -- descer o ESP32 2 mm na PCB1 soltou 30 trilhas.
   Apagar = tira a trilha inteira (o toco). Trilha de pad SMD num componente que virou de lado nao se
   arrasta (a camada muda): vai em puladas. `antes` = a placa efetiva e as linhas de ANTES dos movimentos
   (os ids "new-..." sao os daquele momento). A regiao de cobre da mesma net que estava em cima de uma
   trilha que andou e nao e teardrop reconhecido (esses a placa refaz) fica onde estava: vai em
   regioes_que_ficaram (no LM555, a g36 do Altium em cima da t33). Devolve {tocados, arrastadas,
   apagadas, puladas, regioes_que_ficaram}. */
function trilhasDosMovidos(ctx, arq, board, antes, refs, modo, note) {
  const out = { tocados: [], arrastadas: 0, apagadas: 0, puladas: [], regioes_que_ficaram: [] };
  if (!modo || modo === 'deixar') return out;
  const hc = ctx.hc;
  const eb1 = hc.effectiveBoard(board, hc.applyPcbChanges(board, arq.itens));
  const depois = new Map((eb1.components || []).map(c => [String(c.ref), c]));
  const lado = q => q === 'Bottom' ? 'Bottom' : 'Top';
  const mexe = new Map();
  for (const ref of refs) {
    const c0 = (antes.eb.components || []).find(c => String(c.ref) === String(ref)), c1 = depois.get(String(ref));
    if (!c0 || !c1) continue;
    const virou = lado(c0.layer) !== lado(c1.layer);
    const d = hc.compDelta({ src: { x: c0.x, y: c0.y, rot: c0.rot || 0, layer: lado(c0.layer) }, eff: { x: c1.x, y: c1.y, rot: c1.rot || 0, layer: lado(c1.layer) } });
    for (const t of antes.eb.tracks || []) {
      if (!t || t.id == null || !hc.isCopper(t.layer)) continue;
      for (const k of [1, 2]) {
        const x = t['x' + k], y = t['y' + k];
        const pd = (c0.pads || []).find(q => (q.type === 'th' || q.layer === t.layer) && geo.noPad(q, x, y, 0.01));
        if (!pd) continue;
        const e = mexe.get(String(t.id)) || { campos: {} };
        if (modo === 'apagar') e.del = true;
        else if (virou && pd.type !== 'th') { out.puladas.push(String(t.id)); continue; }
        else { const q = hc.xfPoint(d, x, y); e.campos['x' + k] = r4(q.x); e.campos['y' + k] = r4(q.y); }
        mexe.set(String(t.id), e);
      }
    }
  }
  if (!mexe.size) return out;
  /* as regioes (nao poligono, nao teardrop reconhecido) da mesma net em cima das trilhas que andam */
  const TD = ctx.modulo('hub-pcbteardrop.js');
  let gotas = new Set();
  try { if (TD) gotas = new Set((TD.reconhece(antes.eb) || []).map(r => String(r.id))); } catch (_) { /* sem teardrop */ }
  const porId = new Map((antes.eb.tracks || []).map(t => [String(t.id), t]));
  for (const g of antes.eb.regions || []) {
    if (!g || g.poly || g.keepout || !g.net || gotas.has(String(g.id)) || !Array.isArray(g.points)) continue;
    for (const id of mexe.keys()) {
      const t = porId.get(id);
      if (!t || t.net !== g.net || t.layer !== g.layer) continue;
      const m = (t.w || 0) / 2 + 0.05;
      const P = g.points, dentro = (x, y) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > y) !== (P[j][1] > y) && x < (P[j][0] - P[i][0]) * (y - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; };
      const naTrilha = P.some(q => geo.distSeg(q[0], q[1], t.x1, t.y1, t.x2, t.y2) <= m) ||
        [0, 0.25, 0.5, 0.75, 1].some(f => dentro(t.x1 + (t.x2 - t.x1) * f, t.y1 + (t.y2 - t.y1) * f));
      if (naTrilha) { out.regioes_que_ficaram.push(String(g.id)); break; }
    }
  }
  const novos = ops.mapaNovos({ itens: antes.itens }, board, hc);
  for (const [id, e] of mexe) {
    const op = e.del ? { op: 'track_del', id } : Object.assign({ op: 'track_edit', id }, e.campos);
    if (note) op.note = note;
    out.tocados.push(ops.aplica(arq, board, hc, op, novos));
    if (e.del) out.apagadas++; else out.arrastadas++;
  }
  return out;
}
const resumoTrilhas = tr => ({ arrastadas: tr.arrastadas, apagadas: tr.apagadas, puladas: tr.puladas.length ? tr.puladas : undefined,
  regioes_que_ficaram: tr.regioes_que_ficaram.length ? tr.regioes_que_ficaram : undefined,
  nota: tr.regioes_que_ficaram.length ? 'regiões de cobre que estavam em cima das trilhas que andaram e ficaram no lugar (não são teardrop reconhecido): apague (pcb_apagar) ou refaça' : undefined });
const TRILHAS_MODO = { type: 'string', enum: ['deixar', 'arrastar', 'apagar'],
  description: 'as trilhas presas nos pads de quem anda: "deixar" (padrão: ficam onde estão, soltas), "arrastar" (a ponta vai junto com o pad e a trilha estica) ou "apagar" (saem as trilhas)' };

/* o tipo (track, via, text...) de um id: o do board.js, ou o da linha *_add que criou o "new-..." */
const TIPO_DO_ADD = { track_add: 'track', arc_add: 'arc', via_add: 'via', text_add: 'text', fill_add: 'fill', region_add: 'region', pad_add: 'pad', poly_add: 'poly' };
function tipoDoId(arq, board, hc, id, novos) {
  if (ops.indicePorId(board).has(String(id))) return ops.tipoDoObjeto(ops.achaObjeto(board, id));
  const linha = novos.get(String(id));
  if (!linha) throw new ErroMcp(`não existe objeto com id "${id}" (nem no board.js nem nas linhas do changes.js; pcb_consultar mostra os ids de agora)`);
  return TIPO_DO_ADD[linha.op] || linha.op;
}

module.exports = {
  grupo: 'pcb',
  ordem: 30,
  titulo: 'PCB — placa (board.js lido, changes.js escrito)',
  modulos: ['hub-core.js', 'hub-roteador.js', 'hub-autoroteador.js', 'hub-gerber.js', 'hub-suaviza45.js', 'hub-posiciona.js'],
  ferramentas: [
    {
      nome: 'pcb_resumo', titulo: 'Resumo da placa', leitura: true,
      descricao: 'A placa com as mudanças: bbox, contorno, camadas (com cor e contagem), nets, regras do board.js, contagens e a validação do changes.js. Comece por aqui na Parte B.',
      entrada: { type: 'object', properties: { projeto: PROJETO }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const { board, changes, model, eb } = ctx.placa(p);
        return {
          projeto: p.nome, exportador: board.exporter || '(espelho antigo)', bbox: board.board && board.board.bbox,
          contorno: (eb.board && eb.board.outline || []).length + ' segmentos',
          camadas: ctx.hc.boardLayers(eb).map(l => ({ key: l.key, nome: l.name, tipo: l.kind, cor: l.color, objetos: l.count })),
          nets: board.nets || [], regras: board.rules || null,
          contagem: Object.fromEntries(['components', 'tracks', 'arcs', 'vias', 'texts', 'fills', 'regions', 'silk', 'lines', 'freepads', 'cutouts'].map(k => [k, (eb[k] || []).length])),
          mudancas: changes.length, validacao: ops.resumoValidacao(model, 40),
        };
      },
    },
    {
      nome: 'pcb_consultar', titulo: 'Consultar objetos da placa', leitura: true,
      descricao: 'Lista objetos da placa EFETIVA (board.js + changes.js) com ids e coordenadas, filtrando por caixa (região em mm), camada, net, componente (ref = dono) ou id. Tipos: componentes, pads, trilhas, arcos, vias, textos, fills, regioes, silk, linhas, recortes. Os ids servem para pcb_apagar/pcb_editar. Placa grande: filtre por caixa, peça só os campos que precisa (campos) e/ou grave a lista inteira em arquivo (arquivo:true devolve o caminho e só a contagem) — despejar pads/vias/trilhas da placa toda na conversa esgota o contexto.',
      entrada: { type: 'object', properties: {
        projeto: PROJETO,
        tipo: { type: 'string', enum: Object.keys(TIPOS) },
        caixa: { type: 'object', properties: { x1: { type: 'number' }, y1: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' } }, description: 'só o que toca esta região (mm)' },
        camada: { type: 'string', description: 'Top, Bottom, TopOverlay, Mech1...' },
        net: { type: 'string' }, ref: { type: 'string', description: 'componente (para pads/textos/silk: o dono)' }, id: { type: 'string' },
        limite: { type: 'integer', minimum: 1, maximum: 2000, description: 'padrão 200' }, pular: { type: 'integer', minimum: 0 },
        campos: { type: 'array', items: { type: 'string' }, description: 'só estes campos de cada item (ex.: ["id","x","y","net"])' },
        arquivo: { type: 'boolean', description: 'true = grava TODOS os itens filtrados num .json (pasta temporária) e devolve o caminho, sem a lista na resposta' },
      }, required: ['projeto', 'tipo'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const { eb } = ctx.placa(p);
        const f = TIPOS[a.tipo];
        if (!f) throw new ErroMcp('tipo desconhecido: ' + a.tipo);
        const cx = caixa(a.caixa);
        let L = f(eb).filter(o => o
          && (!a.camada || o.layer === a.camada)
          && (!a.net || o.net === a.net || (Array.isArray(o.nets) && o.nets.includes(a.net)))
          && (!a.ref || o.ref === a.ref || o.owner === a.ref)
          && (!a.id || String(o.id) === a.id)
          && (!cx || sobrepoe(caixaDe(o), cx)));
        if (Array.isArray(a.campos) && a.campos.length) L = L.map(o => { const r = {}; for (const k of a.campos) if (o[k] !== undefined) r[k] = o[k]; return r; });
        const total = L.length, ini = a.pular || 0, lim = a.limite || 200;
        if (a.arquivo) {
          const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
          const dir = path.join(os.tmpdir(), 'nexoeletric-consultas');
          fs.mkdirSync(dir, { recursive: true });
          const f = path.join(dir, `${String(p.nome).replace(/[^\w.-]+/g, '_')}-${a.tipo}-${Date.now()}.json`);
          fs.writeFileSync(f, JSON.stringify({ projeto: p.nome, tipo: a.tipo, filtros: { caixa: a.caixa, camada: a.camada, net: a.net, ref: a.ref, id: a.id }, total, itens: L }, null, 1));
          return { tipo: a.tipo, total, arquivo: f, amostra: L.slice(0, 3) };
        }
        return { tipo: a.tipo, total, mostrando: [ini, Math.min(total, ini + lim)], itens: L.slice(ini, ini + lim) };
      },
    },
    {
      nome: 'pcb_componente', titulo: 'Componente na placa', leitura: true,
      descricao: 'Um componente na placa efetiva: posição, rotação, lado, pads (posições absolutas JÁ com as mudanças, nets), designator e as trilhas que chegam nos pads.',
      entrada: { type: 'object', properties: { projeto: PROJETO, ref: { type: 'string' } }, required: ['projeto', 'ref'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const { eb, model } = ctx.placa(p);
        const c = (eb.components || []).find(x => x.ref === a.ref);
        if (!c) throw new ErroMcp(`componente "${a.ref}" não está na placa. Existem: ${(eb.components || []).map(x => x.ref).join(', ')}`);
        const m = model.compByRef[a.ref];
        return { ref: c.ref, footprint: c.footprint, comment: c.comment, layer: c.layer, x: c.x, y: c.y, rot: c.rot, bbox: c.bbox, movido: !!(m && m.changed),
                 original: m ? { x: m.src.x, y: m.src.y, rot: m.src.rot, layer: m.src.layer } : null,
                 pads: (c.pads || []).map(q => ({ name: q.name, x: q.x, y: q.y, w: q.w, h: q.h, rot: q.rot, shape: q.shape, layer: q.layer, type: q.type, drill: q.drill, plated: q.drill > 0 ? q.plated !== false : undefined, net: q.net || '' })),
                 textos: (eb.texts || []).filter(t => t.owner === a.ref).map(t => ({ id: t.id, text: t.text, x: t.x, y: t.y, layer: t.layer, designator: !!t.designator, comment: !!t.comment })),
                 trilhas_nos_pads: trilhasNosPads(c, eb) };
      },
    },
    {
      nome: 'pcb_net', titulo: 'Net na placa', leitura: true,
      descricao: 'Tudo de uma net na placa efetiva: pads (REF.PINO), trilhas, arcos, vias, fills e regiões, com comprimento total de trilha.',
      entrada: { type: 'object', properties: { projeto: PROJETO, net: { type: 'string' } }, required: ['projeto', 'net'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const { eb, board } = ctx.placa(p);
        if (!(board.nets || []).includes(a.net)) throw new ErroMcp(`net "${a.net}" não existe. Nets: ${(board.nets || []).join(', ')}`);
        const tr = (eb.tracks || []).filter(t => t.net === a.net);
        return { net: a.net,
          pads: TIPOS.pads(eb).filter(q => q.net === a.net).map(q => ({ pad: q.ref ? q.ref + '.' + q.name : q.id, x: q.x, y: q.y, layer: q.layer })),
          trilhas: tr, comprimento_mm: r4(tr.reduce((s, t) => s + Math.hypot(t.x2 - t.x1, t.y2 - t.y1), 0)),
          arcos: (eb.arcs || []).filter(x => x.net === a.net), vias: (eb.vias || []).filter(x => x.net === a.net),
          fills: (eb.fills || []).filter(x => x.net === a.net).length, regioes: (eb.regions || []).filter(x => x.net === a.net).length };
      },
    },
    {
      nome: 'pcb_mudancas', titulo: 'Mudanças do changes.js', leitura: true,
      descricao: 'Lista as ops do changes.js com índice (0 = primeira), status da validação (ok/warn/err), a mensagem e, nas linhas *_add, o id do objeto na placa ("new-…", o mesmo do pcb_consultar). Filtros: id (do board.js ou "new-…"), ref, op (ex.: "track_add" ou "comp_"), caixa em mm (alguma coordenada da linha dentro), so_problemas; limite/pular (padrão 200). curto:true = só índice, op, status e id, sem a linha. Use os índices em pcb_mudanca_remover/pcb_mudanca_editar — ou, mais simples, pcb_apagar/pcb_editar com o id.',
      entrada: { type: 'object', properties: { projeto: PROJETO, so_problemas: { type: 'boolean' },
        id: { type: 'string' }, ref: { type: 'string' }, op: { type: 'string', description: 'a op inteira ou o começo dela ("comp_")' },
        caixa: { type: 'object', properties: { x1: { type: 'number' }, y1: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' } } },
        curto: { type: 'boolean' }, limite: { type: 'integer', minimum: 1, maximum: 5000 }, pular: { type: 'integer', minimum: 0 } }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const { model } = ctx.placa(p);
        const cx = a.caixa && { x1: Math.min(a.caixa.x1, a.caixa.x2), y1: Math.min(a.caixa.y1, a.caixa.y2), x2: Math.max(a.caixa.x1, a.caixa.x2), y2: Math.max(a.caixa.y1, a.caixa.y2) };
        /* os pontos de uma linha: x/y, x1..y2, cx/cy, pts e des_x/des_y */
        const pontos = ch => {
          const P = [];
          for (const [kx, ky] of [['x', 'y'], ['x1', 'y1'], ['x2', 'y2'], ['cx', 'cy'], ['des_x', 'des_y'], ['orig_x', 'orig_y'], ['orig_x1', 'orig_y1'], ['orig_x2', 'orig_y2']])
            if (isNum(ch[kx]) && isNum(ch[ky])) P.push([ch[kx], ch[ky]]);
          for (const q of (Array.isArray(ch.pts) ? ch.pts : [])) if (Array.isArray(q) && isNum(q[0]) && isNum(q[1])) P.push(q);
          return P;
        };
        const idDe = it => it.target && it.target.added && it.target.eff && it.target.eff.id != null ? String(it.target.eff.id) : undefined;
        let L = model.changeItems.filter(it => {
          const ch = it.ch || {};
          if (a.so_problemas && it.status === 'ok') return false;
          if (a.ref && ch.ref !== a.ref) return false;
          if (a.op && !String(ch.op || '').startsWith(a.op)) return false;
          if (a.id && String(ch.id) !== a.id && idDe(it) !== a.id) return false;
          if (cx && !pontos(ch).some(([x, y]) => x >= cx.x1 && x <= cx.x2 && y >= cx.y1 && y <= cx.y2)) return false;
          return true;
        }).map(it => a.curto ? { indice: it.idx, op: it.ch && it.ch.op, status: it.status, id: idDe(it) || (it.ch && it.ch.id) || undefined, ref: (it.ch && it.ch.ref) || undefined }
                             : { indice: it.idx, status: it.status, msg: it.msg || undefined, id_na_placa: idDe(it), op: it.ch });
        const total = L.length, ini = a.pular || 0, lim = a.limite || 200;
        return { total_no_arquivo: model.changeItems.length, total, mostrando: [ini, Math.min(total, ini + lim)], validacao: ops.resumoValidacao(model, 0), mudancas: L.slice(ini, ini + lim) };
      },
    },
    {
      nome: 'pcb_mover', titulo: 'Mover/girar/virar componente',
      descricao: 'Move um componente (comp_move com os orig_* do board.js preenchidos sozinhos). Dê x/y absolutos ou dx/dy relativos, rot (graus anti-horário) e layer Top/Bottom (virar de lado). Se o componente já tem linha no changes.js, ela é editada. Devolve a posição nova, os pads movidos e as trilhas que chegavam nos pads (que agora podem estar soltas).',
      entrada: { type: 'object', properties: Object.assign({
        projeto: PROJETO, ref: { type: 'string' },
        x: { type: 'number' }, y: { type: 'number' }, dx: { type: 'number' }, dy: { type: 'number' },
        rot: { type: 'number' }, drot: { type: 'number', description: 'gira relativo (graus)' }, layer: { type: 'string', enum: ['Top', 'Bottom'] },
        trilhas: TRILHAS_MODO,
      }, COMUNS), required: ['projeto', 'ref'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const antes = ctx.placa(p);
        const c = (antes.eb.components || []).find(x => x.ref === a.ref);
        if (!c) throw new ErroMcp(`componente "${a.ref}" não existe na placa`);
        const tocavam = trilhasNosPads(c, antes.eb);
        const op = opDoMovimento(c, a);
        comNote(op, a);
        let tr = null;
        const est = ops.transacao(ctx, p, (arq, board) => {
          const ant = { eb: antes.eb, itens: arq.itens.slice() };
          const t = [gravaMovimento(ctx, arq, board, op)];
          tr = trilhasDosMovidos(ctx, arq, board, ant, [a.ref], a.trilhas, op.note);
          return t.concat(tr.tocados);
        }, { simular: a.simular, forcar: a.forcar, ferramenta: 'pcb_mover' });
        const depois = ctx.placa(p);
        const c2 = (depois.eb.components || []).find(x => x.ref === a.ref);
        if (tr && (tr.arrastadas || tr.apagadas || tr.puladas.length)) est.trilhas = resumoTrilhas(tr);
        if (est.gravado && c2) {
          est.componente = { ref: c2.ref, x: c2.x, y: c2.y, rot: c2.rot, layer: c2.layer, bbox: c2.bbox, pads: (c2.pads || []).map(q => ({ name: q.name, x: r4(q.x), y: r4(q.y), net: q.net || '' })) };
          if (tocavam.length && (!a.trilhas || a.trilhas === 'deixar')) est.trilhas_que_chegavam = { nota: 'estas trilhas tocavam os pads antes do movimento e ficaram onde estavam — de novo com trilhas:"arrastar" (esticam junto) ou "apagar", ou ajuste com pcb_editar', lista: tocavam };
        }
        return est;
      },
    },
    {
      nome: 'pcb_mover_lote', titulo: 'Mover muitos componentes de uma vez (com checagem de posicionamento)',
      descricao: 'Move/gira/vira VÁRIOS componentes numa gravação só (comp_move com os orig_* preenchidos sozinhos; a linha que já existe é editada; componente de comp_add tem a linha dele editada) — o lote rápido para centenas de movimentos, em vez de um pcb_mover por componente. Cada movimento: {ref, x/y absolutos ou dx/dy, rot ou drot, layer Top/Bottom}. Antes de gravar, confere o POSICIONAMENTO dos que andaram (hub-posiciona.js): colisão = dois componentes do mesmo lado mais perto que a folga (a ComponentClearance das regras do projeto, ou `folga`), pela caixa do componente; fora = saiu do contorno da placa ou caiu sobre um recorte. Só o que o lote CRIOU conta: com colisão nova ou componente novo fora da placa nada é gravado (forcar:true grava). A resposta é curta: totais, as colisões/fora novos e quantas trilhas chegavam nos pads dos que andaram (detalhes:true lista por componente).',
      entrada: { type: 'object', properties: Object.assign({
        projeto: PROJETO,
        movimentos: { type: 'array', minItems: 1, items: { type: 'object', properties: {
          ref: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, dx: { type: 'number' }, dy: { type: 'number' },
          rot: { type: 'number' }, drot: { type: 'number' }, layer: { type: 'string', enum: ['Top', 'Bottom'] } }, required: ['ref'] } },
        folga: { type: 'number', minimum: 0, description: 'folga de posicionamento em mm (padrão: a ComponentClearance das regras do projeto)' },
        checar: { type: 'boolean', description: 'padrão true: confere colisão e fora da placa antes de gravar' },
        caixa: { type: 'string', enum: ['cobre', 'componente'], description: 'a forma da checagem: "cobre" (padrão: pads e serigrafia do componente) ou "componente" (a caixa inteira do footprint, com o desenho mecânico)' },
        trilhas: TRILHAS_MODO,
        detalhes: { type: 'boolean', description: 'lista cada componente (posição nova e trilhas que chegavam nos pads)' },
      }, COMUNS), required: ['projeto', 'movimentos'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const antes = ctx.placa(p);
        const porRef = new Map((antes.eb.components || []).map(c => [String(c.ref), c]));
        const vistos = new Set(), faltam = [], repetidos = [];
        const lista = [];
        for (const m of a.movimentos) {
          const ref = String(m.ref || '');
          const c = porRef.get(ref);
          if (!c) { faltam.push(ref); continue; }
          if (vistos.has(ref)) repetidos.push(ref);
          vistos.add(ref);
          lista.push(comNote(opDoMovimento(c, Object.assign({}, m, { ref })), a));
        }
        if (faltam.length) throw new ErroMcp(`componente(s) que não existem na placa: ${faltam.slice(0, 20).join(', ')} — nada foi gravado`);
        const refs = [...vistos];
        const PS = ctx.modulo('hub-posiciona.js');
        const S = ops.regrasDoProjeto(ctx, p);
        const confere = eb => PS.confere(eb, { refs, folga: a.folga, regras: S ? S.conjunto : undefined, caixa: a.caixa });
        const t0 = Date.now();
        let tr = null;
        const faz = simular => ops.transacao(ctx, p, (arq, board) => {
          const ant = { eb: antes.eb, itens: arq.itens.slice() };
          const t = lista.map(op => gravaMovimento(ctx, arq, board, op));
          tr = trilhasDosMovidos(ctx, arq, board, ant, refs, a.trilhas, a.note ? String(a.note).replace(/":/g, '" :') : undefined);
          return t.concat(tr.tocados);
        },
          { simular, forcar: a.forcar, ferramenta: 'pcb_mover_lote',
            relata: (model, board, hc) => {
              if (a.checar === false || !PS) return {};
              const c0 = confere(antes.eb), c1 = confere(hc.effectiveBoard(board, model)), nv = PS.novas(c0, c1);
              return { posicionamento: { componentes: refs.length, colisoes_antes: c0.colisoes.length, colisoes_depois: c1.colisoes.length,
                       novas_colisoes: nv.colisoes.slice(0, 50), n_novas_colisoes: nv.colisoes.length,
                       novos_fora: nv.fora.slice(0, 50), n_novos_fora: nv.fora.length,
                       folga: isNum(a.folga) ? a.folga : (S ? 'ComponentClearance das regras' : PS.FOLGA_PADRAO) } };
            } });
        /* primeiro simula (valida e confere); grava só se o lote não criou colisão nem tirou componente da placa */
        let est = faz(true);
        const pos = est.posicionamento;
        const ruim = !!(pos && (pos.n_novas_colisoes || pos.n_novos_fora));
        if (!a.simular && (est.ok || a.forcar) && (!ruim || a.forcar)) est = faz(false);
        else if (!a.simular && ruim) est.dica = `${pos.n_novas_colisoes} colisão(ões) nova(s) e ${pos.n_novos_fora} componente(s) fora da placa: nada foi gravado (forcar:true grava mesmo assim)`;
        else if (!a.simular && !est.ok) est.dica = 'Nada foi gravado: há erro de validação nas linhas (veja "erros"); forcar:true grava mesmo assim.';
        est.movimentos = lista.length;
        if (repetidos.length) est.repetidos = { nota: 'o mesmo componente mais de uma vez: vale o último', refs: [...new Set(repetidos)] };
        const linhas = est.linhas || [];
        est.linhas_total = est.linhas_total || linhas.length;
        est.linhas = linhas.filter(l => l.status !== 'ok').slice(0, 20);
        let nTrilhas = 0;
        const det = [];
        const depois = est.gravado ? ctx.placa(p) : null;
        for (const ref of refs) {
          const tocavam = trilhasNosPads(porRef.get(ref), antes.eb);
          nTrilhas += tocavam.length;
          if (a.detalhes) {
            const c2 = depois && (depois.eb.components || []).find(x => String(x.ref) === ref);
            det.push(Object.assign({ ref, trilhas_que_chegavam: tocavam.map(t => t.id) }, c2 ? { x: c2.x, y: c2.y, rot: c2.rot, layer: c2.layer } : {}));
          }
        }
        est.trilhas_que_chegavam = nTrilhas ? { total: nTrilhas, nota: !a.trilhas || a.trilhas === 'deixar' ? 'trilhas que tocavam os pads dos componentes que andaram e ficaram onde estavam: de novo com trilhas:"arrastar" (esticam junto) ou "apagar"; detalhes:true lista' : undefined } : { total: 0 };
        if (tr && (tr.arrastadas || tr.apagadas || tr.puladas.length)) est.trilhas = resumoTrilhas(tr);
        if (a.detalhes) est.componentes = det;
        est.ms = Date.now() - t0;
        return est;
      },
    },
    {
      nome: 'pcb_posicao_conferir', titulo: 'Conferir posicionamento (sobreposição, folga, fora da placa)', leitura: true,
      descricao: 'Confere o posicionamento da placa efetiva (hub-posiciona.js): os pares de componentes do MESMO lado mais perto que a folga de posicionamento (a ComponentClearance das regras do projeto, ou `folga`), pela caixa do componente — sobrepostos com a distância negativa —, e os componentes fora do contorno ou sobre um recorte. refs = só os pares que envolvem estes.',
      entrada: { type: 'object', properties: { projeto: PROJETO, refs: { type: 'array', items: { type: 'string' } },
        folga: { type: 'number', minimum: 0, description: 'mm (padrão: a ComponentClearance das regras)' },
        caixa: { type: 'string', enum: ['cobre', 'componente'], description: '"cobre" (padrão: pads e serigrafia do componente) ou "componente" (a caixa inteira do footprint)' } }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const PS = ctx.exige('hub-posiciona.js', 'HubPosiciona');
        const { eb } = ctx.placa(p);
        const S = ops.regrasDoProjeto(ctx, p);
        const r = PS.confere(eb, { refs: a.refs, folga: a.folga, regras: S ? S.conjunto : undefined, caixa: a.caixa });
        return { projeto: p.nome, componentes: r.componentes, n_colisoes: r.colisoes.length, colisoes: r.colisoes.slice(0, 100),
                 n_fora: r.fora.length, fora: r.fora.slice(0, 100), folga: isNum(a.folga) ? a.folga : (S ? 'ComponentClearance das regras (' + S.fonte + ')' : PS.FOLGA_PADRAO), ms: r.ms };
      },
    },
    {
      nome: 'pcb_suavizar', titulo: 'Suavizar trilhas a 45° (sem soltar ramo)',
      modulo: 'hub-suaviza45.js',
      descricao: 'Suaviza a 45° trilhas já na placa (a escada de um roteador de grade, os cantos de 90°) SEM soltar ramo (hub-suaviza45.js): toda ponta de trilha/arco, via, pad ou cruzamento da mesma net que encosta no MEIO de uma trilha vira ponto fixo, e só o trecho entre dois pontos fixos se suaviza, com as pontas paradas. A suavização é a do roteador (o vértice mais distante que se alcança com reta ou diagonal+reta, sem degraus), com as regras do projeto como o DRC; trilha não passa por cima de pad da mesma net que ela não tocava; trecho que já violava folga fica como está. modo chanfro: só chanfra os cantos de 90° (pernas de até `chanfro` mm). No fim confere por net o ratsnest e as pontas soltas (NetAntennae): net que piorou volta inteira (revertidas). Padrão gravar:false = SIMULA; gravar:true troca as trilhas (track_del com orig_*, ou tira a linha track_add de quem nasceu no changes.js; track_add dos trechos novos) — com violação nova de DRC nada é gravado (forcar:true passa).',
      entrada: { type: 'object', properties: {
        projeto: PROJETO,
        nets: { type: 'array', items: { type: 'string' }, description: 'só estas nets (padrão: todas)' },
        ids: { type: 'array', items: { type: 'string' }, description: 'só estas trilhas' },
        camadas: { type: 'array', items: { type: 'string' } },
        modo: { type: 'string', enum: ['puxar', 'chanfro'], description: 'puxar (padrão): estica o fio a 45°; chanfro: só chanfra os cantos de 90°' },
        chanfro: { type: 'number', exclusiveMinimum: 0, description: 'perna máxima do chanfro em mm (padrão 1)' },
        gravar: { type: 'boolean', description: 'padrão false (só simula e mostra)' },
        forcar: { type: 'boolean', description: 'grava mesmo com violação nova de DRC (evite)' },
        note: { type: 'string', description: 'o note das linhas (padrão "suavizar 45")' },
      }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const SV = ctx.exige('hub-suaviza45.js', 'HubSuaviza45');
        ctx.exige('hub-pcbnets.js', 'HubPcbNets');
        const R = ctx.exige('hub-roteador.js', 'HubRoteador');
        const pl = ctx.placaDespejada(p), eb = pl.eb;
        const tg = textoGeo(ctx);
        const S = ops.regrasDoProjeto(ctx, p);
        const o = { placa: { lacos: lacosDe(ctx, eb), recortes: recortesDe(eb) }, textoGeo: tg };
        if (S) o.regras = S.conjunto; else o.clearance = (eb.rules && eb.rules.clearance > 0) ? eb.rules.clearance : R.FOLGA_PADRAO;
        const C = R.cena(eb, o);
        const r = SV.suaviza(eb, { cena: C, roteador: R, regras: S ? S.conjunto : undefined, nets: a.nets, ids: a.ids, camadas: a.camadas,
                                   modo: a.modo, chanfro: a.chanfro, note: a.note ? String(a.note).replace(/":/g, '" :') : undefined });
        const out = { projeto: p.nome, cadeias: r.cadeias, suavizadas: r.suavizadas, mantidas: r.mantidas, vertices: r.vertices,
                      comprimento_mm: r.comprimento, revertidas: r.revertidas, puladas: r.puladas, por_net: r.porNet.slice(0, 60), ms: r.ms,
                      trilhas: { saem: r.ops.filter(x => x.op === 'track_del').length, entram: r.ops.filter(x => x.op === 'track_add').length } };
        if (!r.ops.length) { out.gravacao = { ok: true, gravado: false, nota: 'nada a suavizar' }; return out; }
        /* as ops do changes.js: a trilha do board.js sai por track_del (orig_*); a que nasceu de um
           track_add (id new-t…) sai tirando a linha dela */
        const porId = new Map((eb.tracks || []).map(t => [String(t.id), t]));
        const monta = (arq, board) => {
          const tocados = [];
          for (const op of r.ops) {
            if (op.op !== 'track_del') continue;
            if ((board.tracks || []).some(t => String(t.id) === String(op.id))) { tocados.push(ops.mescla(arq, ops.origDe(Object.assign({}, op), board)).obj); continue; }
            const t = porId.get(String(op.id));
            const i = t ? arq.itens.findIndex(x => x && x.op === 'track_add' && x.layer === t.layer && x.w === t.w &&
              Math.abs(x.x1 - t.x1) < 1e-6 && Math.abs(x.y1 - t.y1) < 1e-6 && Math.abs(x.x2 - t.x2) < 1e-6 && Math.abs(x.y2 - t.y2) < 1e-6) : -1;
            if (i < 0) throw new ErroMcp(`a trilha ${op.id} não está no board.js nem numa linha track_add do changes.js`);
            arq.remove(i);
          }
          for (const op of r.ops) if (op.op === 'track_add') tocados.push(ops.mescla(arq, Object.assign({}, op)).obj);
          return tocados;
        };
        /* o DRC (com os planos redespejados) antes e depois: as violações NOVAS */
        const D = ctx.modulo('hub-pcbdrc.js'), A = ctx.modulo('hub-autoroteador.js');
        const sim = ops.transacao(ctx, p, monta, { simular: true, ferramenta: 'pcb_suavizar',
          relata: (model, board, hc, l) => {
            if (!D) return {};
            const conj = S ? S.conjunto : undefined;
            const d0 = D.rodar(eb, conj, { textoGeo: tg }), d1 = D.rodar(ctx.placaDespejada(p, l.depois).eb, conj, { textoGeo: tg });
            const nv = A && A.novasViolacoes ? A.novasViolacoes(d0, d1) : [];
            return { drc: { antes: d0.total, depois: d1.total, novas: nv.length, novas_lista: nv.slice(0, 30).map(v => ({ tipo: v.tipo, msg: v.msg, x: r4(v.x), y: r4(v.y), layer: v.layer })) } };
          } });
        out.drc = sim.drc || { nota: 'hub-pcbdrc.js ausente: o DRC não rodou' };
        if (!sim.ok && !a.forcar) { delete sim.drc; out.gravacao = sim; return out; }
        if (a.gravar && out.drc.novas && !a.forcar) {
          out.gravacao = { ok: false, gravado: false, motivo: 'drc', erro: `${out.drc.novas} violação(ões) nova(s) de DRC: nada foi gravado (forcar:true grava mesmo assim)` };
          return out;
        }
        const g = a.gravar ? ops.transacao(ctx, p, monta, { forcar: a.forcar, ferramenta: 'pcb_suavizar' }) : sim;
        delete g.drc;
        g.linhas_total = g.linhas_total || (g.linhas || []).length;
        g.linhas = (g.linhas || []).slice(0, 12);
        out.gravacao = g;
        if (!a.gravar) out.nota = 'simulação: nada foi gravado — repita com gravar:true para trocar as trilhas';
        return out;
      },
    },
    {
      nome: 'pcb_aplicar', titulo: 'Aplicar ops no changes.js',
      descricao: 'Escreve QUALQUER op do changes.js (AI-GUIDE Parte B): track_add/edit/del, via_*, arc_*, text_add/edit/del, fill_*, region_add/del, designator_move, comp_move, comp_attr, outline_set — e as ops novas dos módulos (comp_add, pad_add, poly_add… do hub-pcbeco). Os orig_* das edições/remoções são preenchidos SOZINHOS a partir do board.js (pode omiti-los). Op de um objeto que já tem linha edita aquela linha. Tudo validado antes de gravar; com erro nada é gravado. designator_move/comment_move: x/y/rot = onde o texto deve FICAR na placa (a conta inversa do comp_move é feita aqui; "referencial":"original" grava como veio), h = altura e w = traço em mm; funciona também para componente criado por comp_add. A resposta traz em "textos" a posição efetiva de cada um e "fora_da_placa" quando ele sai do contorno.',
      entrada: { type: 'object', properties: Object.assign({
        projeto: PROJETO,
        ops: { type: 'array', minItems: 1, items: { type: 'object', properties: { op: { type: 'string' } }, required: ['op'], additionalProperties: true },
               description: 'ex.: [{"op":"track_add","layer":"Top","x1":10,"y1":5,"x2":20,"y2":5,"w":0.3,"net":"GND"}, {"op":"track_del","id":"t7"}]' },
        drc: { description: 'true (ou a lista de tipos do DRC) = roda o DRC antes e depois destas ops e devolve as violações NOVAS e as que SAÍRAM (vale com simular:true)' },
      }, COMUNS), required: ['projeto', 'ops'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const hc = ctx.pcbPronto();
        const ehTexto = o => o && (o.op === 'designator_move' || o.op === 'comment_move');
        const pedidos = a.ops.filter(ehTexto).map(o => ({ ref: o.ref, op: o.op, x: o.x, y: o.y }));
        const querDrc = a.drc === true || Array.isArray(a.drc);
        const est = ops.transacao(ctx, p, (arq, board) => a.ops.map(o0 => {
          const o = Object.assign({}, o0);
          if (a.note && !o.note) comNote(o, a);
          if (ehTexto(o)) return ops.aplicaTexto(arq, board, hc, o);
          return ops.aplica(arq, board, hc, o);
        }), { simular: a.simular, forcar: a.forcar, ferramenta: 'pcb_aplicar',
              relata: pedidos.length || querDrc ? (model, board, _hc, itens) => {
                const out = {};
                if (pedidos.length) {
                  const textos = ops.posicoesEfetivas(hc, board, model, pedidos, dentroDaPlaca(ctx, hc.effectiveBoard(board, model)));
                  const fora = textos.filter(t => t.fora_da_placa).map(t => t.ref);
                  Object.assign(out, { textos, avisos_textos: fora.length ? `${fora.length} texto(s) FORA do contorno da placa: ${fora.slice(0, 20).join(', ')}${fora.length > 20 ? '…' : ''}` : undefined });
                }
                if (querDrc) out.drc = drcDiferenca(ctx, p, itens.antes, itens.depois, Array.isArray(a.drc) ? a.drc : null);
                return out;
              } : null });
        return est;
      },
    },
    {
      nome: 'pcb_colocar', titulo: 'Colocar componente na placa',
      descricao: 'Põe um footprint na placa como componente NOVO (op comp_add): ref, footprint (da biblioteca: fp_buscar; o do hub ou o do Altium), posição, rotação, lado e as nets de cada pad. Para trazer TODOS os componentes do esquema de uma vez use eco_aplicar; esta é a peça avulsa (furo de fixação, conector extra, logo, jumper). O footprint precisa existir na biblioteca ou na placa.',
      entrada: { type: 'object', properties: Object.assign({
        projeto: PROJETO, ref: { type: 'string', description: 'designador novo, ex.: "J9", "MH1"' }, footprint: { type: 'string' },
        x: { type: 'number' }, y: { type: 'number' }, rot: { type: 'number', description: 'graus anti-horário (padrão 0)' },
        layer: { type: 'string', enum: ['Top', 'Bottom'] }, comment: { type: 'string' },
        nets: { anyOf: [{ type: 'object', additionalProperties: { type: 'string' } }, { type: 'string' }], description: '{"1":"GND","2":"VCC"} ou "1=GND;2=VCC" (pad=net)' },
      }, COMUNS), required: ['projeto', 'ref', 'footprint', 'x', 'y'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        /* a placa de AGORA: o designador que saiu por comp_del pode voltar */
        if ((ctx.placa(p).eb.components || []).some(c => c.ref === a.ref)) throw new ErroMcp(`a placa já tem um ${a.ref}: escolha outro designador (ou pcb_mover para mexer no que existe)`);
        let nets = a.nets;
        if (nets && typeof nets === 'object') nets = Object.entries(nets).map(([pad, n]) => `${pad}=${n}`).join(';');
        const op = { op: 'comp_add', ref: a.ref, footprint: a.footprint, x: a.x, y: a.y, rot: isNum(a.rot) ? a.rot : 0, layer: a.layer || 'Top' };
        if (a.comment) op.comment = a.comment;
        if (nets) op.nets = String(nets).replace(/":/g, '" :');
        comNote(op, a);
        const est = await ops.transacao(ctx, p, arq => [ops.mescla(arq, op).obj], { simular: a.simular, forcar: a.forcar, ferramenta: 'pcb_colocar' });
        if (est && est.gravado) {
          try {
            const c = (ctx.placa(p).eb.components || []).find(x => x.ref === a.ref);
            if (c) est.componente = { ref: c.ref, x: c.x, y: c.y, rot: c.rot, layer: c.layer, bbox: c.bbox, pads: (c.pads || []).map(q => ({ name: q.name, x: r4(q.x), y: r4(q.y), net: q.net || '' })) };
          } catch (_) { /* a resposta da transacao ja diz o essencial */ }
        }
        return est;
      },
    },
    {
      nome: 'pcb_furo', titulo: 'Furo de fixação avulso (NPTH)',
      descricao: 'Põe um furo avulso na placa (op pad_add): sem cobre (NPTH) por padrão — vai para o Gerber de furação NPTH e para o Altium como pad não metalizado. metalizado:true com anel (diâmetro do cobre) faz um furo metalizado (net opcional, ex.: GND do chassi). Para um furo que é RECORTE da placa (forma qualquer, sai no contorno), use pcb_recorte; para um furo que entra na lista de componentes, um footprint (fp_pacote tipo "furo") + pcb_colocar.',
      entrada: { type: 'object', properties: Object.assign({
        projeto: PROJETO, x: { type: 'number' }, y: { type: 'number' },
        diametro: { type: 'number', exclusiveMinimum: 0, description: 'o furo, mm (M3: 3,2)' },
        metalizado: { type: 'boolean', description: 'padrão false (NPTH)' },
        anel: { type: 'number', description: 'metalizado: diâmetro do cobre, mm (maior que o furo)' },
        net: { type: 'string', description: 'só metalizado' }, nome: { type: 'string', description: 'designador do pad (ex.: "H3")' },
      }, COMUNS), required: ['projeto', 'x', 'y', 'diametro'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const d = a.diametro;
        let op;
        if (a.metalizado) {
          if (!(isNum(a.anel) && a.anel > d)) throw new ErroMcp('furo metalizado precisa de "anel" maior que o diâmetro do furo');
          op = { op: 'pad_add', type: 'th', x: a.x, y: a.y, w: a.anel, h: a.anel, shape: 'circle', drill: d };
          if (a.net) op.net = a.net;
        } else op = { op: 'pad_add', type: 'npth', x: a.x, y: a.y, w: d, h: d, shape: 'circle', drill: d };
        if (a.nome) op.name = String(a.nome);
        comNote(op, a);
        return ops.transacao(ctx, p, arq => [ops.mescla(arq, op).obj], { simular: a.simular, forcar: a.forcar, ferramenta: 'pcb_furo' });
      },
    },
    {
      nome: 'pcb_recorte', titulo: 'Recorte da placa (Board Cutout)',
      descricao: 'Recorta a placa (op region_add com cutout:true, o Board Cutout do Altium): círculo {x, y, diametro}, retângulo {x1, y1, x2, y2} ou polígono pts [[x,y],...]. O recorte sai no contorno do Gerber (Profile), tira o cobre e conta no DRC e nas regras da casa (recorte redondo de até 12 mm é furo de parafuso). O círculo vira um polígono de `lados` lados (padrão 48). Para um furo simples de fixação prefira pcb_furo (NPTH na furação).',
      entrada: { type: 'object', properties: Object.assign({
        projeto: PROJETO, x: { type: 'number' }, y: { type: 'number' }, diametro: { type: 'number', exclusiveMinimum: 0 },
        x1: { type: 'number' }, y1: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' },
        pts: { type: 'array', items: PT, description: 'polígono, ≥ 3 pontos (mm)' },
        lados: { type: 'integer', minimum: 8, maximum: 360 },
      }, COMUNS), required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        let pts;
        if (Array.isArray(a.pts)) pts = a.pts;
        else if ([a.x, a.y, a.diametro].every(isNum)) {
          const n = a.lados || 48, r = a.diametro / 2;
          pts = []; for (let i = 0; i < n; i++) { const t = i * 2 * Math.PI / n; pts.push([r4(a.x + r * Math.cos(t)), r4(a.y + r * Math.sin(t))]); }
        } else if ([a.x1, a.y1, a.x2, a.y2].every(isNum)) {
          const X1 = Math.min(a.x1, a.x2), X2 = Math.max(a.x1, a.x2), Y1 = Math.min(a.y1, a.y2), Y2 = Math.max(a.y1, a.y2);
          if (!(X2 > X1 && Y2 > Y1)) throw new ErroMcp('retângulo vazio');
          pts = [[X1, Y1], [X2, Y1], [X2, Y2], [X1, Y2]];
        } else throw new ErroMcp('dê o círculo (x, y, diametro), o retângulo (x1, y1, x2, y2) ou pts');
        if (pts.length < 3) throw new ErroMcp('o polígono precisa de 3 pontos ou mais');
        const op = comNote({ op: 'region_add', layer: 'Multi', cutout: true, pts }, a);
        return ops.transacao(ctx, p, arq => [ops.mescla(arq, op).obj], { simular: a.simular, forcar: a.forcar, ferramenta: 'pcb_recorte' });
      },
    },
    {
      nome: 'pcb_faixa_borda', titulo: 'Faixa proibida nas bordas (keepout)',
      descricao: 'Desenha uma faixa proibida ao longo de bordas da placa (trilho, guia, encaixe da caixa): uma região na camada KeepOut por lado, recortada no contorno. O roteador (pcb_rotear, pcb_autorotear), o polígono (pour) e o DRC tiram o cobre dela — como o keepout do Altium —, e a serigrafia (regras_casa_verificar, serigrafia_posicionar) não põe texto nela. lados: cima, baixo, esquerda, direita (pela caixa do contorno); largura em mm (padrão 2). substituir:true tira antes as faixas que esta ferramenta pôs nesses lados. A resposta lista o que JÁ está dentro das faixas (trilhas, vias, pads, textos) para tirar.',
      entrada: { type: 'object', properties: Object.assign({
        projeto: PROJETO,
        lados: { type: 'array', minItems: 1, items: { type: 'string', enum: ['cima', 'baixo', 'esquerda', 'direita'] } },
        largura: { type: 'number', exclusiveMinimum: 0, description: 'mm (padrão 2)' },
        substituir: { type: 'boolean' },
      }, COMUNS), required: ['projeto', 'lados'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const { eb } = ctx.placa(p);
        const PP = ctx.exige('hub-pcbpour.js', 'HubPcbPour');
        const K = require('./regras-casa.js')._interno.kit(ctx.exige('hub-clipper.js', 'ClipperLib'));
        const anel = PP._int && PP._int.contornoPlaca ? PP._int.contornoPlaca(eb.board, 0.05) : null;
        if (!anel || anel.length < 3) throw new ErroMcp('a placa não tem contorno fechado (pcb_contorno)');
        const bb = { x1: Math.min(...anel.map(q => q[0])), y1: Math.min(...anel.map(q => q[1])), x2: Math.max(...anel.map(q => q[0])), y2: Math.max(...anel.map(q => q[1])) };
        const w = isNum(a.largura) ? a.largura : 2, m = 1;
        const faixa = { cima: [bb.x1 - m, bb.y2 - w, bb.x2 + m, bb.y2 + m], baixo: [bb.x1 - m, bb.y1 - m, bb.x2 + m, bb.y1 + w],
                        esquerda: [bb.x1 - m, bb.y1 - m, bb.x1 + w, bb.y2 + m], direita: [bb.x2 - w, bb.y1 - m, bb.x2 + m, bb.y2 + m] };
        const lados = [...new Set(a.lados)];
        const ops2 = [], polis = [];
        for (const lado of lados) {
          const [x1, y1, x2, y2] = faixa[lado];
          const it = K.inter([K.paraC(anel)], [K.paraC([[x1, y1], [x2, y1], [x2, y2], [x1, y2]])], false);
          for (const path of it) {
            const pts = K.deC(path).map(q => [r4(q[0]), r4(q[1])]);
            if (pts.length < 3) continue;
            polis.push({ lado, pts });
            ops2.push({ op: 'region_add', layer: 'KeepOut', keepout: true, pts, note: `faixa da borda (${lado}, ${w} mm)` });
          }
        }
        if (!ops2.length) throw new ErroMcp('as faixas não cruzam a placa (largura grande demais ou contorno estranho)');
        /* o que ja esta dentro das faixas */
        const dentro = (x, y) => polis.some(({ pts }) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; });
        const ja = {
          trilhas: (eb.tracks || []).filter(t => t && ctx.hc.isCopper(t.layer) && !t.keepout && (dentro(t.x1, t.y1) || dentro(t.x2, t.y2) || dentro((t.x1 + t.x2) / 2, (t.y1 + t.y2) / 2))).map(t => t.id),
          vias: (eb.vias || []).filter(v => v && dentro(v.x, v.y)).map(v => v.id),
          pads: [].concat(...(eb.components || []).map(c => (c.pads || []).filter(q => q && dentro(q.x, q.y)).map(q => c.ref + '.' + q.name))),
          textos: (eb.texts || []).filter(t => t && !t.hidden && /Overlay$/.test(t.layer || '') && dentro(t.x, t.y)).map(t => t.owner ? t.owner + (t.designator ? ' (designator)' : ' (comment)') : t.id),
        };
        const est = ops.transacao(ctx, p, arq => {
          if (a.substituir) {
            const fora = [];
            arq.itens.forEach((x, i) => { if (x && x.op === 'region_add' && x.layer === 'KeepOut' && lados.some(l => String(x.note || '').startsWith(`faixa da borda (${l},`))) fora.push(i); });
            for (const i of fora.sort((u, v) => v - u)) arq.remove(i);
          }
          return ops2.map(o => ops.mescla(arq, comNote(o, a)).obj);
        }, { simular: a.simular, forcar: a.forcar, ferramenta: 'pcb_faixa_borda' });
        est.faixas = polis.map(f => ({ lado: f.lado, largura: w, caixa: { x1: r4(Math.min(...f.pts.map(q => q[0]))), y1: r4(Math.min(...f.pts.map(q => q[1]))), x2: r4(Math.max(...f.pts.map(q => q[0]))), y2: r4(Math.max(...f.pts.map(q => q[1]))) } }));
        const n = ja.trilhas.length + ja.vias.length + ja.pads.length + ja.textos.length;
        est.ja_dentro = n ? Object.assign({ nota: 'isto já está dentro das faixas: tire ou mova (pcb_apagar, pcb_mover, serigrafia_posicionar); o DRC acusa o cobre' }, ja) : { total: 0 };
        return est;
      },
    },
    {
      nome: 'pcb_editar', titulo: 'Editar objeto por id',
      descricao: 'Edita um objeto da placa pelo id (trilha t…/s…/l…, arco a…, via v…, texto x…, fill f…, pad livre, polígono): passe só os campos novos (ex.: {"w":0.5} ou {"x1":10,"y1":5}). A op certa (track_edit, arc_edit, via_edit, text_edit, fill_edit) e os orig_* saem do board.js. Objeto criado pelo changes.js (id "new-…", o que o pcb_consultar mostra) tem a linha que o criou editada.',
      entrada: { type: 'object', properties: Object.assign({
        projeto: PROJETO, id: { type: 'string' },
        campos: { type: 'object', additionalProperties: true, description: 'trilha: x1,y1,x2,y2,w,layer,net · arco: cx,cy,r,sa,ea,w,layer · via: x,y,size,drill · texto: text,x,y,h,w,rot,layer,mirror · fill: x1,y1,x2,y2,rot,layer,net' },
      }, COMUNS), required: ['projeto', 'id', 'campos'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const hc = ctx.pcbPronto();
        let idNovo;
        const est = ops.transacao(ctx, p, (arq, b) => {
          const novos = ops.mapaNovos(arq, b, hc);
          const k = tipoDoId(arq, b, hc, a.id, novos);
          const opn = { track: 'track_edit', arc: 'arc_edit', via: 'via_edit', text: 'text_edit', fill: 'fill_edit', pad: 'pad_edit', poly: 'poly_edit' }[k];
          if (!opn) throw new ErroMcp(`"${a.id}" é ${k}: não há op de edição para ele (região: apague e crie outra)`);
          const o = ops.aplica(arq, b, hc, comNote(Object.assign({ op: opn, id: a.id }, a.campos), a), novos);
          if (/_add$/.test(o.op)) idNovo = o;
          return [o];
        }, { simular: a.simular, forcar: a.forcar, ferramenta: 'pcb_editar' });
        /* a linha *_add editada pode ter ganhado um uid agora: o id dela na placa e o de agora */
        if (idNovo) { try { const m = ops.mapaNovos({ itens: ctx.changes(p) }, ctx.board(p), hc); m.forEach((l, id) => { if (l && idNovo.uid && l.uid === idNovo.uid) est.id = id; }); } catch (_) { /* so informativo */ } }
        return est;
      },
    },
    {
      nome: 'pcb_apagar', titulo: 'Apagar objetos por id', destrutiva: true,
      descricao: 'Apaga objetos da placa pelos ids (trilha/linha → track_del, arco → arc_del, via → via_del, texto → text_del, fill → fill_del, região → region_del, pad livre → pad_del, polígono → poly_del) e componentes por refs (comp_del), com os orig_* do board.js. Objeto criado pelo changes.js (id "new-…", o que o pcb_consultar mostra) e componente criado por comp_add (ECO, pcb_colocar) saem tirando a linha que os criou (e as linhas dele que vêm depois).',
      entrada: { type: 'object', properties: Object.assign({ projeto: PROJETO, ids: { type: 'array', items: { type: 'string' } }, refs: { type: 'array', items: { type: 'string' }, description: 'componentes a tirar da placa (comp_del)' } }, COMUNS), required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        if (!(a.ids || []).length && !(a.refs || []).length) throw new ErroMcp('dê ids e/ou refs');
        const hc = ctx.pcbPronto();
        return ops.transacao(ctx, p, (arq, board) => {
          const novos = ops.mapaNovos(arq, board, hc);
          const tipos = (a.ids || []).map(id => tipoDoId(arq, board, hc, id, novos));
          const out = (a.refs || []).map(ref => ops.aplica(arq, board, hc, comNote({ op: 'comp_del', ref }, a), novos));
          return out.concat((a.ids || []).map((id, i) => {
            const k = tipos[i];
            const opn = { track: 'track_del', arc: 'arc_del', via: 'via_del', text: 'text_del', fill: 'fill_del', region: 'region_del', pad: 'pad_del', poly: 'poly_del' }[k];
            if (!opn) throw new ErroMcp(`"${id}" (${k}) não se apaga pelo changes.js`);
            return ops.aplica(arq, board, hc, comNote({ op: opn, id }, a), novos);
          }));
        }, { simular: a.simular, forcar: a.forcar, ferramenta: 'pcb_apagar' });
      },
    },
    {
      nome: 'pcb_trilha', titulo: 'Desenhar trilha (polilinha)',
      descricao: 'Desenha uma trilha por vários pontos (um track_add por trecho). Pontos em mm, ou "REF.PINO" para começar/terminar no centro de um pad (a net do pad é usada se você não der net). Largura padrão: a preferida da regra Width que vence para a net e a camada (rules.js do projeto, como o Rule Preferred do Altium). Em camada que não é cobre (TopOverlay, Mech1, KeepOut) vira linha de desenho.',
      entrada: { type: 'object', properties: Object.assign({
        projeto: PROJETO, layer: { type: 'string', description: 'Top, Bottom, Mid1..., TopOverlay, Mech1, KeepOut...' },
        pts: { type: 'array', minItems: 2, items: { oneOf: [PT, { type: 'string' }] }, description: '[[x,y], [x,y], ...] ou "R1.1" nas pontas' },
        w: { type: 'number', exclusiveMinimum: 0 }, net: { type: 'string' },
      }, COMUNS), required: ['projeto', 'layer', 'pts'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const { eb, board } = ctx.placa(p);
        const P = a.pts.map((v, i) => ponto(eb, v, 'pts[' + i + ']'));
        const net = a.net != null ? a.net : (P.find(x => x.net) || {}).net || '';
        let w = a.w || larguraDaNet(ctx, eb, p, net, a.layer, board);
        const RT = ctx.modulo('hub-roteador.js');
        const lim = a.w && RT && RT.limitaLargura && ctx.hc.isCopper(a.layer) ? RT.limitaLargura(cena(ctx, eb, p), net, a.layer, a.w) : null;
        if (lim && lim.ajustada) w = lim.w;
        const L = [];
        for (let i = 1; i < P.length; i++) {
          if (P[i - 1].x === P[i].x && P[i - 1].y === P[i].y) continue;
          const o = { op: 'track_add', layer: a.layer, x1: r4(P[i - 1].x), y1: r4(P[i - 1].y), x2: r4(P[i].x), y2: r4(P[i].y), w };
          if (net && ctx.hc.isCopper(a.layer)) o.net = net;
          L.push(comNote(o, a));
        }
        const est = ops.transacao(ctx, p, arq => L.map(o => ops.mescla(arq, o).obj), { simular: a.simular, forcar: a.forcar, ferramenta: 'pcb_trilha' });
        if (lim && lim.ajustada) est.largura_ajustada = `w ${a.w} fora da regra ${lim.regra} (${lim.min}..${lim.max} mm): usei ${r4(w)}`;
        return est;
      },
    },
    {
      nome: 'pcb_rotear', titulo: 'Rotear contornando (walkaround)',
      descricao: 'Roteia uma trilha de um ponto/pad até outro na mesma camada com o roteador do hub (hub-roteador.js, o Walkaround do Altium): respeita a folga das regras, contorna o cobre de outras nets e não mexe em nada que já está. Devolve o caminho; com aplicar:true (padrão) grava os track_add. completa:false = parou antes do obstáculo (use outra camada + pcb_via).',
      modulo: 'hub-roteador.js',
      entrada: { type: 'object', properties: Object.assign({
        projeto: PROJETO, layer: { type: 'string' },
        de: { oneOf: [PT, { type: 'string' }], description: '[x,y] ou "REF.PINO"' }, ate: { oneOf: [PT, { type: 'string' }], description: '[x,y] ou "REF.PINO"' },
        w: { type: 'number' }, net: { type: 'string' }, modo: { type: 'string', enum: ['45', '90', 'livre'], description: 'padrão 45' },
        aplicar: { type: 'boolean', description: 'padrão true' },
      }, COMUNS), required: ['projeto', 'layer', 'de', 'ate'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const { eb, board } = ctx.placa(p);
        const R = ctx.exige('hub-roteador.js', 'HubRoteador');
        const A = ponto(eb, a.de, 'de', a.layer), B = ponto(eb, a.ate, 'ate', a.layer);
        const net = a.net || A.net || B.net || '';
        /* pad SMD só existe na camada dele: a trilha de outra camada terminaria em cima dele sem
           ligar nada (o ratsnest continuaria lá) — como no Altium, a rota até ele é na camada dele */
        const smdFora = q => q.pad && !(q.pad.type === 'th' || q.pad.layer === 'Multi') && q.pad.layer && q.pad.layer !== a.layer ? q.pad : null;
        const pf = smdFora(A) || smdFora(B);
        if (pf) return { completa: false, motivo: 'pad-em-outra-camada', pontos: [], bloqueio: null, net,
                         nota: `o pad SMD ${A.pad === pf ? a.de : a.ate} está no ${pf.layer}: rotee no ${pf.layer} (ou chegue nele por via)` };
        const C = cena(ctx, eb, p);
        /* sem w: a Width vencedora para a net e a camada (Rule Preferred), a mesma que o DRC confere */
        let w = a.w || (R.larguraDaRegra ? R.larguraDaRegra(C, net, a.layer).pref : (board.rules && board.rules.width > 0 ? board.rules.width : 0.254));
        /* o w dado fora da faixa da regra vira o limite dela, como a rota do Altium */
        const lim = a.w && R.limitaLargura ? R.limitaLargura(C, net, a.layer, a.w) : null;
        if (lim && lim.ajustada) w = lim.w;
        const r = R.rota(C, { layer: a.layer, w, net, de: [A.x, A.y], ate: [B.x, B.y], modo: a.modo || '45',
                              alvo: { eletrico: !!B.pad, net: B.net }, conflito: 'contornar' });
        const out = { completa: r.completa, motivo: r.motivo, pontos: (r.pts || []).map(q => [r4(q[0]), r4(q[1])]), bloqueio: r.bloqueio, net, w, ms: r.ms };
        if (lim && lim.ajustada) out.largura_ajustada = `w ${a.w} fora da regra ${lim.regra} (${lim.min}..${lim.max} mm): usei ${r4(w)}`;
        if (r.motivo === 'camada-proibida') out.nota = `a regra Routing Layers da net ${net || '(sem net)'} não permite ${a.layer}: rotee em outra camada`;
        /* a partida já estava perto demais de outro cobre (pad de passo fino com a largura da regra,
           ponta antiga encostada em outra net): o roteador sai sem piorar, mas o caminho fica abaixo
           da folga e o DRC acusa. No Walkaround do Altium essa rota não sai: aqui ela só é gravada
           com forcar */
        if ((r.violacoes || []).length) {
          out.violacoes = r.violacoes.slice(0, 10).map(c => ({ id: c.id, net: c.net, tipo: c.tipo, dist: r4(Math.max(0, c.dist)), folga: r4(c.folga) }));
          out.nota = `a partida já está a menos da folga da regra de ${r.violacoes.map(c => c.tipo + ' ' + c.id).slice(0, 3).join(', ')}: a rota sairia com violação de Clearance — use w menor (a faixa da regra Width), parta de outro ponto, ou forcar:true`;
          if (!a.forcar) { out.completa = false; out.motivo = 'partida-em-conflito'; return out; }
        }
        if (a.aplicar === false || !r.pts || r.pts.length < 2) return out;
        const L = [];
        for (let i = 1; i < r.pts.length; i++) {
          const o = { op: 'track_add', layer: a.layer, x1: r4(r.pts[i - 1][0]), y1: r4(r.pts[i - 1][1]), x2: r4(r.pts[i][0]), y2: r4(r.pts[i][1]), w };
          if (net) o.net = net;
          L.push(comNote(o, a));
        }
        out.gravacao = ops.transacao(ctx, p, arq => L.map(o => ops.mescla(arq, o).obj), { simular: a.simular, forcar: a.forcar, ferramenta: 'pcb_rotear' });
        return out;
      },
    },
    {
      nome: 'pcb_autorotear', titulo: 'Autorotear (várias camadas, vias, lote)',
      modulo: 'hub-autoroteador.js',
      descricao: 'Liga SOZINHO as conexões abertas do ratsnest (todas, ou só as `nets` dadas) com o autoroteador do hub (hub-autoroteador.js, em cima do mesmo motor exato do pcb_rotear): várias camadas, trocando de camada por via; uma conexão depois da outra, na `ordem` (curta = a mais curta primeiro, o padrão; longa; classe = a net de regra mais pesada primeiro; dada = a ordem de `nets`; ou uma lista de nets), e arranca-e-refaz nas que falharam (só rotas deste lote saem — o cobre que já está na placa nunca é mexido). Cada rota respeita as regras do projeto como o DRC: a folga de cada par pela Clearance vencedora do rules.js (classes de net, escopo, matriz), a Board Outline Clearance, a Width e a Routing Via Style da net, a Routing Layers; pad SMD só na camada dele; camada Plane não recebe trilha; a via respeita furo a furo e ponte de máscara, nunca cai em pad SMD (viaEmPad:true libera) nem na faixa estreita de um plano (faixaPlano). Planos do hub: o pedaço despejado é obstáculo pela folga do próprio polígono, e o lote REDESPEJA e confere — a rota que partisse um plano (pad numa ilha recortada) é desfeita; cruzarPlanos deixa a trilha atravessar o plano de OUTRA net com custo (custoPlano), o plano recua em volta dela. Padrão gravar:false = SIMULA: devolve conexões abertas antes/depois, por net, vias, comprimento, falhas com motivo, tempo, e o DRC da placa com as rotas (violações NOVAS — a meta é zero). gravar:true grava os track_add/via_add no changes.js pelo mesmo caminho validado das outras pcb_* (erro de validação ou violação nova de DRC = nada gravado; forcar:true passa por cima do DRC). Para ver: pcb_render {ratsnest:true}, uma camada por vez.',
      entrada: { type: 'object', properties: {
        projeto: PROJETO,
        nets: { type: 'array', items: { type: 'string' }, description: 'só estas nets (padrão: todas as que têm conexão aberta)' },
        camadas: { type: 'array', items: { type: 'string' }, description: 'camadas de sinal que podem receber trilha (padrão: todas as de cobre da placa, menos Plane)' },
        ordem: { anyOf: [{ type: 'string', enum: ['curta', 'longa', 'classe', 'dada'] }, { type: 'array', items: { type: 'string' } }], description: 'padrão "curta"; uma lista de nets = esta ordem' },
        passes: { type: 'integer', minimum: 0, maximum: 20, description: 'passadas de arranca-e-refaz (padrão 4; 0 = passada única)' },
        custoVia: { type: 'number', minimum: 0, description: 'quanto uma via "custa", em mm de trilha (padrão 3): maior = menos via, rota mais longa' },
        res: { type: 'number', exclusiveMinimum: 0, description: 'passo da grade em mm (padrão: o da cena, 0,1 mm numa placa normal)' },
        orcamento: { type: 'object', properties: { tempoMs: { type: 'integer', minimum: 100 }, nosPorBusca: { type: 'integer', minimum: 1000 } }, description: 'padrão {tempoMs: 60000, nosPorBusca: 300000}' },
        gravar: { type: 'boolean', description: 'padrão false (só simula e mostra)' },
        forcar: { type: 'boolean', description: 'grava mesmo com violação nova de DRC (evite)' },
        note: { type: 'string', description: 'o note das linhas (padrão "pcb_autorotear")' },
        cruzarPlanos: { anyOf: [{ type: 'boolean' }, { type: 'array', items: { type: 'string' } }], description: 'a trilha pode atravessar o polígono de OUTRA net (true = todos; ou ids/nomes/nets de polígono, ex. ["FASE"]): o plano é redespejado em volta dela; nunca na faixa estreita; a rota que partiria o plano é desfeita (motivo corta-plano). Padrão false' },
        custoPlano: { type: 'number', minimum: 0, description: 'mm a mais por mm de trilha dentro de um plano cruzado (padrão 1)' },
        faixaPlano: { type: 'number', minimum: 0, description: 'faixa de plano mais estreita que isto (mm) não leva via nem é cruzada (padrão 2; 0 desliga)' },
        viaEmPad: { type: 'boolean', description: 'deixa a via cair em pad SMD (padrão false: proibido)' },
      }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const A = ctx.exige('hub-autoroteador.js', 'HubAutoRoteador');
        ctx.exige('hub-pcbnets.js', 'HubPcbNets');
        const R = ctx.exige('hub-roteador.js', 'HubRoteador');
        /* a placa como a tela (e o drc_rodar / nets_ratsnest) a vê: os polígonos do hub despejados */
        const pl = ctx.placaDespejada(p), eb = pl.eb;
        const tg = textoGeo(ctx);
        const S = ops.regrasDoProjeto(ctx, p);
        const o = { placa: { lacos: lacosDe(ctx, eb), recortes: recortesDe(eb) }, textoGeo: tg };
        if (S) o.regras = S.conjunto; else o.clearance = (eb.rules && eb.rules.clearance > 0) ? eb.rules.clearance : R.FOLGA_PADRAO;
        if (isNum(a.res) && a.res > 0) o.res = a.res;
        const C = R.cena(eb, o);
        const note = a.note ? String(a.note).replace(/":/g, '" :') : 'pcb_autorotear';
        const r = A.rotearLote(eb, { cena: C, roteador: R, nets: a.nets, camadas: a.camadas, ordem: a.ordem, passes: a.passes, custoVia: a.custoVia, orcamento: a.orcamento, note,
                                     cruzarPlanos: a.cruzarPlanos, custoPlano: a.custoPlano, faixaPlano: a.faixaPlano, viaEmPad: a.viaEmPad });
        const out = {
          projeto: p.nome, regras_de: S ? S.fonte : 'folga única do board.rules (sem hub-pcbregras.js)',
          conexoes_abertas: { antes: r.antes.conexoes, depois: r.depois.conexoes, das_nets_pedidas: { antes: r.alvo.conexoes, depois: r.depois.doAlvo } },
          roteadas: r.roteadas, primeira_passada: r.primeiraPassada, vias: r.vias, comprimento_mm: r4(r.comprimento),
          trilhas: r.ops.filter(x => x.op === 'track_add').length, passes: r.passes, arrancadas: r.arrancadas, ms: r.ms,
          orcamento: r.orcamento, parametros: r.parametros, planos: r.planos, falhas: r.falhas, por_net: r.porNet,
          rotas: r.rotas.slice(0, 60), rotas_total: r.rotas.length,
        };
        /* O QUE A IA PRECISA SABER SEM PROCURAR: a camada vazia que ficou de fora, a rota que saiu na
           largura mínima e a saída quando falta caminho com plano de outra net na placa */
        const dicas = [];
        const ign = r.parametros && r.parametros.camadas_ignoradas;
        if (ign && ign.length) dicas.push(`camadas internas vazias ficaram de fora (${ign.join(', ')}): só Top, Bottom e as que já têm cobre. Para rotear nelas, passe camadas:[...]`);
        const finas = r.rotas.filter(x => x.abaixoDaPreferida);
        if (finas.length) {
          const porNet = {};
          for (const x of finas) porNet[x.net] = { largura: Math.min(...x.largura), preferida: x.abaixoDaPreferida };
          out.abaixo_da_preferida = porNet;
          dicas.push(`${finas.length} rota(s) só passaram com a largura MÍNIMA da regra (a preferida não cabia): ${Object.entries(porNet).slice(0, 8).map(([n, v]) => `${n} ${v.largura} mm em vez de ${v.preferida}`).join('; ')}. Abra espaço, mude a ordem (ordem:"classe" roteia antes as nets de trilha larga) ou aceite a mínima`);
        }
        const semCaminho = (r.falhas || []).filter(f => f.motivo === 'sem-caminho').length;
        const temPlano = (eb.polygons || []).some(q => q && q.pour !== 'none') || (eb.regions || []).some(g => g && g.poly);
        if (semCaminho && temPlano && !a.cruzarPlanos) dicas.push(`${semCaminho} conexão(ões) sem caminho com plano de cobre na placa: tente cruzarPlanos:true (a trilha atravessa o plano de OUTRA net e o plano recua em volta dela, fora da faixa estreita)`);
        if (dicas.length) out.dicas = dicas;
        if (!r.ops.length) { out.gravacao = { ok: true, gravado: false, nota: r.alvo.conexoes ? 'nenhuma rota saiu (veja falhas)' : 'nada a ligar: o ratsnest das nets pedidas está fechado' }; return out; }
        /* o DRC da placa com as rotas (despejada de novo: o plano recua das trilhas novas), contra o de
           antes: as violações NOVAS (a net não roteada fica de fora — a árvore do ratsnest muda) */
        const D = ctx.modulo('hub-pcbdrc.js');
        const itens = ctx.changes(p).concat(r.ops);
        const depois = ctx.placaDespejada(p, itens);
        if (D) {
          const conj = S ? S.conjunto : undefined;
          const chave = v => v.tipo + '|' + (v.ids || []).map(x => String(x).replace(/^(q:[^:]*):\d+$/, '$1')).sort().join('|');
          const d0 = D.rodar(eb, conj, { textoGeo: tg }), d1 = D.rodar(depois.eb, conj, { textoGeo: tg });
          const ja = new Set(d0.violacoes.map(chave));
          const novas = d1.violacoes.filter(v => v.tipo !== 'UnRoutedNet' && !ja.has(chave(v)));
          const porTipo = {};
          for (const v of novas) porTipo[v.tipo] = (porTipo[v.tipo] || 0) + 1;
          out.drc = { antes: d0.total, depois: d1.total, novas: novas.length, novas_por_tipo: porTipo,
                      novas_lista: novas.slice(0, 40).map(v => ({ tipo: v.tipo, msg: v.msg, x: r4(v.x), y: r4(v.y), layer: v.layer, ids: v.ids })) };
        } else out.drc = { nota: 'hub-pcbdrc.js ausente: o DRC não rodou' };
        /* o ratsnest da placa como ela fica (o mesmo motor do nets_ratsnest) */
        const N = ctx.modulo('hub-pcbnets.js');
        if (N) out.conexoes_abertas.na_placa_depois = N.naoRoteadas(depois.eb).conexoes;
        if (a.gravar && out.drc.novas && !a.forcar) {
          out.gravacao = { ok: false, gravado: false, motivo: 'drc', erro: `${out.drc.novas} violação(ões) nova(s) de DRC: nada foi gravado (forcar:true grava mesmo assim)` };
          return out;
        }
        const g = ops.transacao(ctx, p, arq => r.ops.map(op => ops.mescla(arq, op).obj), { simular: !a.gravar, forcar: a.forcar, ferramenta: 'pcb_autorotear' });
        g.linhas_total = g.linhas_total || (g.linhas || []).length;
        g.linhas = (g.linhas || []).slice(0, 12);
        out.gravacao = g;
        if (!a.gravar) out.nota = 'simulação: nada foi gravado — repita com gravar:true para escrever as ' + r.ops.length + ' linhas no changes.js';
        return out;
      },
    },
    {
      nome: 'pcb_fanout', titulo: 'Fanout de uma net (trilha curta + via ao plano)',
      modulo: 'hub-autoroteador.js',
      descricao: 'FANOUT de uma net (o GND da placa de potência): cada pad SMD da net que ainda não chega ao plano dela ganha uma trilha reta curta, na camada do pad, até uma via que cai DENTRO do cobre despejado do plano (longe da borda o bastante para o térmico achar cobre). A via segue as mesmas regras do pcb_autorotear: folga de cada camada pela Clearance vencedora, furo a furo (HoleToHoleClearance) e ponte de máscara contra tudo — inclusive contra as vias que o próprio fanout acabou de pôr (nada de via sobre via) —, nunca em pad SMD nem na faixa estreita de plano (faixaPlano). A direção preferida é para FORA do componente. Padrão gravar:false = SIMULA: devolve os pads feitos, os que já chegavam ao plano, as falhas com motivo, e quantos pads chegam ao plano DEPOIS na placa redespejada, mais o DRC (violações NOVAS). gravar:true grava os track_add/via_add no changes.js (violação nova de DRC = nada gravado; forcar:true passa).',
      entrada: { type: 'object', properties: {
        projeto: PROJETO,
        net: { type: 'string', description: 'a net (ex.: GND)' },
        camada: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }], description: 'a(s) camada(s) do plano (padrão: todas em que a net tem cobre de plano)' },
        pads: { type: 'string', enum: ['abertos', 'todos'], description: 'abertos (padrão) = só os pads que ainda não chegam ao plano' },
        distMax: { type: 'number', exclusiveMinimum: 0, description: 'até quantos mm além da borda do pad procurar a via (padrão 2,5)' },
        cruzarPlanos: { anyOf: [{ type: 'boolean' }, { type: 'array', items: { type: 'string' } }], description: 'a via pode furar o plano de OUTRA net no caminho (fora da faixa estreita); padrão false' },
        faixaPlano: { type: 'number', minimum: 0, description: 'faixa de plano mais estreita que isto (mm) não leva via (padrão 2)' },
        gravar: { type: 'boolean', description: 'padrão false (só simula e mostra)' },
        forcar: { type: 'boolean', description: 'grava mesmo com violação nova de DRC (evite)' },
        note: { type: 'string', description: 'o note das linhas (padrão "fanout <net>")' },
      }, required: ['projeto', 'net'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const A = ctx.exige('hub-autoroteador.js', 'HubAutoRoteador');
        if (typeof A.fanout !== 'function') throw new ErroMcp('hub-autoroteador.js sem fanout (versão antiga carregada: hub_recarregar_ferramentas)');
        ctx.exige('hub-pcbnets.js', 'HubPcbNets');
        const R = ctx.exige('hub-roteador.js', 'HubRoteador');
        const pl = ctx.placaDespejada(p), eb = pl.eb;
        const tg = textoGeo(ctx);
        const S = ops.regrasDoProjeto(ctx, p);
        const o = { placa: { lacos: lacosDe(ctx, eb), recortes: recortesDe(eb) }, textoGeo: tg };
        if (S) o.regras = S.conjunto; else o.clearance = (eb.rules && eb.rules.clearance > 0) ? eb.rules.clearance : R.FOLGA_PADRAO;
        const C = R.cena(eb, o);
        const note = a.note ? String(a.note).replace(/":/g, '" :') : undefined;
        const r = A.fanout(eb, { cena: C, roteador: R, net: a.net, camada: a.camada, pads: a.pads, distMax: a.distMax,
                                 cruzarPlanos: a.cruzarPlanos, faixaPlano: a.faixaPlano, note });
        const out = {
          projeto: p.nome, regras_de: S ? S.fonte : 'folga única do board.rules (sem hub-pcbregras.js)',
          net: r.net, camadas_do_plano: r.camadas, pads_smd: r.pads, ja_chegavam_ao_plano: r.jaLigados, feitos: r.feitos,
          vias: r.vias, comprimento_mm: r4(r.comprimento || 0), falhas: r.falhas, depois: r.depois, ms: r.ms,
        };
        if (r.motivo) out.motivo = r.motivo === 'sem-plano' ? 'a net não tem cobre de plano (polígono despejado) — crie o plano (poly_add) antes do fanout' : r.motivo;
        if (!r.ops.length) { out.gravacao = { ok: true, gravado: false, nota: 'nenhuma via a pôr' }; return out; }
        const D = ctx.modulo('hub-pcbdrc.js');
        const depois = ctx.placaDespejada(p, ctx.changes(p).concat(r.ops));
        if (D) {
          const conj = S ? S.conjunto : undefined;
          const d0 = D.rodar(eb, conj, { textoGeo: tg }), d1 = D.rodar(depois.eb, conj, { textoGeo: tg });
          const novas = A.novasViolacoes(d0, d1);
          const porTipo = {};
          for (const v of novas) porTipo[v.tipo] = (porTipo[v.tipo] || 0) + 1;
          out.drc = { antes: d0.total, depois: d1.total, novas: novas.length, novas_por_tipo: porTipo,
                      novas_lista: novas.slice(0, 40).map(v => ({ tipo: v.tipo, msg: v.msg, x: r4(v.x), y: r4(v.y), layer: v.layer, ids: v.ids })) };
        } else out.drc = { nota: 'hub-pcbdrc.js ausente: o DRC não rodou' };
        if (a.gravar && out.drc.novas && !a.forcar) {
          out.gravacao = { ok: false, gravado: false, motivo: 'drc', erro: `${out.drc.novas} violação(ões) nova(s) de DRC: nada foi gravado (forcar:true grava mesmo assim)` };
          return out;
        }
        const g = ops.transacao(ctx, p, arq => r.ops.map(op => ops.mescla(arq, op).obj), { simular: !a.gravar, forcar: a.forcar, ferramenta: 'pcb_fanout' });
        g.linhas_total = g.linhas_total || (g.linhas || []).length;
        g.linhas = (g.linhas || []).slice(0, 12);
        out.gravacao = g;
        if (!a.gravar) out.nota = 'simulação: nada foi gravado — repita com gravar:true para escrever as ' + r.ops.length + ' linhas no changes.js';
        return out;
      },
    },
    {
      nome: 'pcb_via', titulo: 'Colocar via',
      descricao: 'Coloca uma via (via_add). size = diâmetro do anel, drill = furo (padrão: a preferida da regra Routing Via Style que vence para a net). A net, se omitida, sai do pad/trilha no ponto. Para trocar de camada: trilha até [x,y] numa camada, via em [x,y], trilha da outra camada saindo de [x,y].',
      entrada: { type: 'object', properties: Object.assign({ projeto: PROJETO, x: { type: 'number' }, y: { type: 'number' },
        size: { type: 'number' }, drill: { type: 'number' }, net: { type: 'string' } }, COMUNS), required: ['projeto', 'x', 'y'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const { eb, board } = ctx.placa(p);
        const R = board.rules || {};
        let net = a.net;
        if (net == null) {
          const t = (eb.tracks || []).find(t => t.net && ctx.hc.isCopper(t.layer) && geo.distSeg(a.x, a.y, t.x1, t.y1, t.x2, t.y2) <= (t.w || 0) / 2);
          const q = TIPOS.pads(eb).find(q => q.net && geo.noPad(q, a.x, a.y, 0));
          net = (t && t.net) || (q && q.net) || '';
        }
        /* sem size/drill: a Routing Via Style vencedora para a net (o "Rule Preferred" do Altium) */
        const vd = viaDaNet(ctx, eb, p, net, R);
        const op = { op: 'via_add', x: a.x, y: a.y, size: a.size || vd.size, drill: a.drill || vd.drill };
        if (net) op.net = net;
        /* size/drill dados fora da faixa da Routing Via Style viram o limite dela */
        const RL = ctx.modulo('hub-roteador.js');
        const limV = (a.size || a.drill) && RL && RL.limitaVia ? RL.limitaVia(cena(ctx, eb, p), net, op.size, op.drill) : null;
        if (limV && limV.ajustada) { op.size = r4(limV.size); op.drill = r4(limV.drill); }
        /* via encostada em cobre de outra net não entra — a mesma conferência da vista (e a folga da
           regra do par, a mesma do DRC). forcar:true passa por cima */
        const RT = ctx.modulo('hub-roteador.js');
        if (RT && RT.folgaVia && !a.forcar) {
          const f = RT.folgaVia(cena(ctx, eb, p), { x: a.x, y: a.y, size: op.size }, { net });
          if (!f.ok) return { ok: false, gravado: false, motivo: 'conflito',
                              erro: 'via não posta: ' + f.conflitos.slice(0, 5).map(c => `${c.tipo} ${c.id}${c.net ? ' (' + c.net + ')' : ''} no ${c.layer} a ${r4(Math.max(0, c.dist))} mm (a regra pede ${r4(c.folga)})`).join('; '),
                              conflitos: f.conflitos.slice(0, 20) };
        }
        const est = ops.transacao(ctx, p, arq => [ops.mescla(arq, comNote(op, a)).obj], { simular: a.simular, forcar: a.forcar, ferramenta: 'pcb_via' });
        if (limV && limV.ajustada) est.via_ajustada = `fora da regra ${limV.regra}: usei ${op.size}/${op.drill} mm`;
        return est;
      },
    },
    {
      nome: 'pcb_contorno', titulo: 'Redefinir contorno da placa', destrutiva: true,
      descricao: 'Substitui o contorno da placa (outline_set): dê pts [[x,y],...] (polígono fechado, só retas) ou um retângulo {x0,y0,largura,altura}. O ApplyChanges pede confirmação ao usuário no Altium.',
      entrada: { type: 'object', properties: Object.assign({ projeto: PROJETO, pts: { type: 'array', items: PT, minItems: 3 },
        retangulo: { type: 'object', properties: { x0: { type: 'number' }, y0: { type: 'number' }, largura: { type: 'number' }, altura: { type: 'number' } } } }, COMUNS), required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        let pts = a.pts;
        if (!pts && a.retangulo) { const r = a.retangulo, x0 = r.x0 || 0, y0 = r.y0 || 0; pts = [[x0, y0], [x0 + r.largura, y0], [x0 + r.largura, y0 + r.altura], [x0, y0 + r.altura]]; }
        if (!pts) throw new ErroMcp('dê pts ou retangulo');
        return ops.transacao(ctx, p, arq => {
          const i = arq.itens.findIndex(x => x && x.op === 'outline_set');
          const op = comNote({ op: 'outline_set', pts }, a);
          if (i >= 0) { arq.substitui(i, op); return [op]; }
          return [ops.mescla(arq, op).obj];
        }, { simular: a.simular, forcar: a.forcar, ferramenta: 'pcb_contorno' });
      },
    },
    {
      nome: 'pcb_mudanca_remover', titulo: 'Remover linhas do changes.js', destrutiva: true,
      descricao: 'Remove ops do changes.js pelo índice (pcb_mudancas mostra). É o "desfazer" de uma mudança qualquer, inclusive objeto acrescentado (track_add, via_add...). Os comentários do arquivo ficam.',
      entrada: { type: 'object', properties: { projeto: PROJETO, indices: { type: 'array', items: { type: 'integer', minimum: 0 }, minItems: 1 }, simular: COMUNS.simular }, required: ['projeto', 'indices'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const removidas = [];
        const est = ops.transacao(ctx, p, arq => {
          for (const i of [...new Set(a.indices)].sort((x, y) => y - x)) {
            if (i >= arq.itens.length) throw new ErroMcp(`índice ${i} não existe (o arquivo tem ${arq.itens.length} ops)`);
            removidas.push(arq.itens[i]); arq.remove(i);
          }
          return [];
        }, { simular: a.simular, forcar: true, ferramenta: 'pcb_mudanca_remover' });
        est.removidas = removidas;
        return est;
      },
    },
    {
      nome: 'pcb_mudanca_editar', titulo: 'Editar uma linha do changes.js',
      descricao: 'Muda campos de uma op do changes.js pelo índice (ex.: mover o fim de um track_add: {"x2":30}). remover_campos tira campos. Os orig_* não se editam aqui (eles são a trava de segurança).',
      entrada: { type: 'object', properties: Object.assign({ projeto: PROJETO, indice: { type: 'integer', minimum: 0 },
        campos: { type: 'object', additionalProperties: true }, remover_campos: { type: 'array', items: { type: 'string' } } }, COMUNS), required: ['projeto', 'indice'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        return ops.transacao(ctx, p, arq => {
          const v = arq.itens[a.indice];
          if (!v) throw new ErroMcp(`índice ${a.indice} não existe`);
          const n = Object.assign({}, v);
          for (const [k, x] of Object.entries(a.campos || {})) { if (k.startsWith('orig_') || k === 'op') throw new ErroMcp(`"${k}" não se edita aqui`); n[k] = x; }
          for (const k of a.remover_campos || []) if (!k.startsWith('orig_') && k !== 'op') delete n[k];
          arq.substitui(a.indice, n);
          return [n];
        }, { simular: a.simular, forcar: a.forcar, ferramenta: 'pcb_mudanca_editar' });
      },
    },
    {
      nome: 'pcb_validar', titulo: 'Validar a placa', leitura: true,
      descricao: 'Roda o motor do hub (applyPcbChanges) sobre board.js + changes.js e devolve todos os erros/avisos por linha, e se o arquivo passa no formato que o ApplyChanges lê. Não é DRC (para folgas: drc_rodar).',
      entrada: { type: 'object', properties: { projeto: PROJETO }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const { model, changes } = ctx.placa(p);
        const ser = ctx.hc.serializeChanges(changes);
        return { ok: !model.validation.some(v => v.level === 'err') && !ser.errors.length, mudancas: changes.length,
                 validacao: ops.resumoValidacao(model, 500), formato: ser.errors.map(e => `#${e.idx + 1} ${e.msg}`) };
      },
    },
    {
      nome: 'pcb_render', titulo: 'Imagem da placa', leitura: true,
      descricao: 'Desenha a placa efetiva (com as mudanças e os planos despejados) num PNG: cobre nas cores do Altium, pads, vias, furos, serigrafia, contorno. Para conferir curto/folga olhe UMA camada de cobre por vez (camadas:["Top","Multi"] e depois ["Bottom","Multi"]) com zoom (caixa). Opções: lado bottom (vista de baixo), caixa (zoom numa região em mm), camadas (só estas), net (destaca uma net), ratsnest (linhas do que falta ligar), marcas [[x,y]]. Use para CONFERIR o que fez.',
      entrada: { type: 'object', properties: {
        projeto: PROJETO, largura: { type: 'integer', minimum: 200, maximum: 2400, description: 'pixels (padrão 1000)' },
        lado: { type: 'string', enum: ['top', 'bottom'] },
        caixa: { type: 'object', properties: { x1: { type: 'number' }, y1: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' } } },
        camadas: { type: 'array', items: { type: 'string' } }, net: { type: 'string' }, ratsnest: { type: 'boolean' },
        marcas: { type: 'array', items: PT },
        despejar: { type: 'boolean', description: 'padrão true: desenha os planos (polígonos) despejados, como a tela' },
      }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const { eb } = a.despejar === false ? ctx.placa(p) : ctx.placaDespejada(p);
        let rats = [];
        if (a.ratsnest) {
          const N = ctx.modulo('hub-pcbnets.js');
          if (N && typeof N.conexoes === 'function') rats = (N.conexoes(eb).linhas || []);
          else rats = [].concat(...geo.conectividade(ctx.hc, eb).nets.map(n => n.faltam));
        }
        const r = render.desenha(ctx.hc, eb, { largura: a.largura, lado: a.lado, caixa: caixa(a.caixa), camadas: a.camadas, net: a.net,
          rats, marcas: (a.marcas || []).map(m => ({ x: m[0], y: m[1] })), textoGeo: textoGeo(ctx) });
        return { projeto: p.nome, largura: r.largura, altura: r.altura, mm_por_px: r.mm_por_px, janela_mm: r.janela, lado: r.lado,
                 ratsnest: a.ratsnest ? rats.length + ' ligações faltando' : undefined,
                 _imagem: { base64: r.png.toString('base64'), mime: 'image/png' } };
      },
    },
  ],
  _interno: { TIPOS, cena, lacosDe, recortesDe, textoGeo, padDe },
};
