/* NexoEletric MCP - pcb-ops.js
   A IA diz o que quer ("mova R5 para 12,8", "apague t12") e este arquivo escreve a op do
   changes.js como o AI-GUIDE (Parte B) exige:
     - os orig_* copiados EXATAMENTE do board.js (o objeto, nunca arredondado);
     - UMA LINHA POR OBJETO: mexer de novo num objeto que ja tem linha EDITA aquela linha (os
       orig_* dela ficam), em vez de empilhar outra -- o ApplyChanges confere cada orig_* com o
       objeto depois das linhas anteriores e recusaria a segunda;
     - designator_move entra ANTES do comp_move do mesmo componente;
     - tudo validado com o MESMO motor da tela (HubCore.applyPcbChanges) antes de gravar: se a
       mudanca criar erro, nada vai para o disco e a resposta traz o erro. */
'use strict';
const { ArquivoLinhas, jline } = require('./arquivo-linhas.js');
const { ErroMcp } = require('./contexto.js');

const r6 = v => Math.round(v * 1e6) / 1e6;
const isNum = v => typeof v === 'number' && isFinite(v);
const normAng = a => { const v = r6(((a % 360) + 360) % 360); return v >= 360 ? 0 : v; };

/* indice id -> {obj, lista} de tudo que tem id no board.js */
function indicePorId(board) {
  const idx = new Map();
  for (const lista of ['tracks', 'arcs', 'vias', 'texts', 'silk', 'lines', 'fills', 'regions', 'freepads', 'polygons', 'cutouts']) {
    for (const o of (board[lista] || [])) {
      if (!o || o.id == null) continue;
      const k = String(o.id);
      if (!idx.has(k)) idx.set(k, []);
      idx.get(k).push({ obj: o, lista });
    }
  }
  return idx;
}
function achaObjeto(board, id) {
  const L = indicePorId(board).get(String(id)) || [];
  if (!L.length) throw new ErroMcp(`não existe objeto com id "${id}" no board.js (use pcb_consultar para achar os ids)`);
  return L[0];
}
function tipoDoObjeto(r) {
  const o = r.obj;
  switch (r.lista) {
    case 'tracks': return 'track';
    case 'arcs': return 'arc';
    case 'vias': return 'via';
    case 'texts': return 'text';
    case 'fills': return 'fill';
    case 'regions': return 'region';
    case 'silk': case 'lines': return o.kind === 'arc' ? 'arc' : 'track';
    case 'freepads': return 'pad';
    case 'polygons': return 'poly';
    default: return r.lista;
  }
}

/* os orig_* de uma op, tirados do board.js. Nao sobrescreve orig_* que a IA ja mandou. */
function origDe(op, board) {
  const o = {};
  const ref = op.ref;
  const comp = ref != null ? (board.components || []).find(c => c.ref === ref) : null;
  switch (op.op) {
    case 'comp_move': case 'comp_del':
      if (!comp) throw new ErroMcp(`componente "${ref}" não existe no board.js`);
      Object.assign(o, { orig_x: comp.x, orig_y: comp.y, orig_rot: comp.rot, orig_layer: comp.layer });
      break;
    case 'comp_attr':
      if (!comp) throw new ErroMcp(`componente "${ref}" não existe no board.js`);
      Object.assign(o, { orig_designator: comp.ref, orig_comment: comp.comment || '' });
      break;
    case 'designator_move': case 'comment_move': {
      const qual = op.op === 'designator_move' ? 'designator' : 'comment';
      const t = (board.texts || []).find(x => x && x[qual] && x.owner === ref);
      if (!t) throw new ErroMcp(`o ${qual} de "${ref}" não está em board.js » texts`);
      Object.assign(o, { orig_x: t.x, orig_y: t.y });
      break;
    }
    case 'track_edit': case 'track_del': {
      const r = achaObjeto(board, op.id), t = r.obj;
      if (tipoDoObjeto(r) !== 'track') throw new ErroMcp(`"${op.id}" não é trilha/linha (é ${tipoDoObjeto(r)})`);
      Object.assign(o, { orig_x1: t.x1, orig_y1: t.y1, orig_x2: t.x2, orig_y2: t.y2, orig_w: t.w, orig_layer: t.layer });
      break;
    }
    case 'arc_edit': case 'arc_del': {
      const r = achaObjeto(board, op.id), a = r.obj;
      if (tipoDoObjeto(r) !== 'arc') throw new ErroMcp(`"${op.id}" não é arco (é ${tipoDoObjeto(r)})`);
      Object.assign(o, { orig_cx: a.cx, orig_cy: a.cy, orig_r: a.r, orig_sa: a.sa, orig_ea: a.ea, orig_layer: a.layer });
      break;
    }
    case 'via_edit': case 'via_del': {
      const r = achaObjeto(board, op.id);
      if (r.lista !== 'vias') throw new ErroMcp(`"${op.id}" não é via`);
      Object.assign(o, { orig_x: r.obj.x, orig_y: r.obj.y });
      break;
    }
    case 'text_edit': case 'text_del': {
      const r = achaObjeto(board, op.id), t = r.obj;
      if (r.lista !== 'texts') throw new ErroMcp(`"${op.id}" não é texto`);
      Object.assign(o, { orig_x: t.x, orig_y: t.y, orig_text: t.text, orig_layer: t.layer });
      break;
    }
    case 'fill_edit': case 'fill_del': {
      const r = achaObjeto(board, op.id), f = r.obj;
      if (r.lista !== 'fills') throw new ErroMcp(`"${op.id}" não é fill`);
      Object.assign(o, { orig_x1: f.x1, orig_y1: f.y1, orig_x2: f.x2, orig_y2: f.y2, orig_layer: f.layer });
      break;
    }
    case 'region_del': {
      const r = achaObjeto(board, op.id), g = r.obj;
      if (r.lista !== 'regions') throw new ErroMcp(`"${op.id}" não é região`);
      const p = g.points || [];
      Object.assign(o, { orig_layer: g.layer, orig_n: p.length, orig_x0: (p[0] || [])[0], orig_y0: (p[0] || [])[1] });
      break;
    }
    case 'pad_edit': case 'pad_del': {
      const r = achaObjeto(board, op.id);
      if (r.lista !== 'freepads') throw new ErroMcp(`"${op.id}" não é pad livre (pad de componente anda com ele)`);
      Object.assign(o, { orig_x: r.obj.x, orig_y: r.obj.y });
      break;
    }
    case 'poly_edit': case 'poly_del': {
      const r = achaObjeto(board, op.id), g = r.obj;
      if (r.lista !== 'polygons') throw new ErroMcp(`"${op.id}" não é polígono (board.js » polygons)`);
      const p = g.pts || g.points || [];
      Object.assign(o, { orig_layer: g.layer, orig_n: p.length, orig_x0: (p[0] || [])[0], orig_y0: (p[0] || [])[1] });
      break;
    }
    default: return op;          // add, outline_set e ops novas (comp_add, pad_add...): sem orig
  }
  const out = Object.assign({}, op);
  for (const k of Object.keys(o)) if (out[k] === undefined) out[k] = o[k];
  return out;
}

/* a chave "que objeto esta op mexe": duas ops com a mesma chave sao a mesma linha */
function chaveDe(op) {
  if (!op || !op.op) return null;
  if (op.op === 'comp_move' || op.op === 'comp_del') return 'pos:' + op.ref;
  if (op.op === 'comment_move') return 'com:' + op.ref;
  if (op.op === 'pad_net') return 'padnet:' + op.ref + '.' + op.pad;
  if (op.op === 'comp_attr') return 'attr:' + op.ref;
  if (op.op === 'designator_move') return 'des:' + op.ref;
  if (/_(edit|del)$/.test(op.op) && op.id != null) return 'obj:' + op.op.split('_')[0] + ':' + op.id;
  return null;
}

/* Junta `op` na lista: edita a linha do mesmo objeto se houver (os orig_* da linha velha ficam;
   edit -> del troca a op), senao insere (designator_move antes do comp_move do componente).
   Devolve o objeto que ficou no arquivo. */
/* um uid livre para a linha nova ("u" + base 36): o id do objeto na placa passa a ser
   new-<tipo><uid> e nao muda quando outra linha entra ou sai (HubCore.applyPcbChanges » nid) */
function uidLivre(arq) {
  const usados = new Set(arq.itens.map(x => x && x.uid).filter(Boolean));
  let n = arq.itens.length;
  let u;
  do { u = 'u' + (n++).toString(36); } while (usados.has(u));
  return u;
}
const COM_UID = /^(track|via|arc|text|fill|region|pad|poly)_add$/;

function mescla(arq, op) {
  const k = chaveDe(op);
  const i = k ? arq.itens.findIndex(x => chaveDe(x) === k) : -1;
  if (i >= 0) {
    const velho = arq.itens[i];
    const orig = {};
    for (const c of Object.keys(velho)) if (c.startsWith('orig_')) orig[c] = velho[c];
    let novo;
    if (velho.op === op.op) novo = Object.assign({}, velho, op, orig);
    else novo = Object.assign({}, op, orig);       // edit <-> del: os valores novos, os orig velhos
    if (/_del$/.test(novo.op)) for (const c of Object.keys(novo)) if (!c.startsWith('orig_') && !['op', 'id', 'ref', 'note'].includes(c)) delete novo[c];
    arq.substitui(i, novo);
    return { obj: novo, indice: i, acao: 'editada' };
  }
  let pos = arq.itens.length;
  if (op.op === 'designator_move' || op.op === 'comment_move') {
    const j = arq.itens.findIndex(x => x && x.op === 'comp_move' && x.ref === op.ref);
    if (j >= 0) pos = j;
  }
  arq.insere(pos, op);
  return { obj: op, indice: pos, acao: 'nova' };
}

/* ---------- o que nasceu no changes.js ----------
   O OBJETO ACRESCENTADO (track_add, via_add, text_add...) nao tem id no board.js: o id dele na
   placa e o "new-..." que o motor da (new-<tipo><uid> com uid, senao um contador). Mexer nele e
   mexer na linha que o criou. Devolve id -> a LINHA (o objeto, nao o indice: num lote, apagar uma
   linha muda o indice das outras), so dos acrescentados. */
function mapaNovos(arq, board, hc) {
  const model = hc.applyPcbChanges(board, arq.itens);
  const m = new Map();
  for (const it of model.changeItems) {
    const t = it.target;
    if (t && t.added && t.eff && t.eff.id != null) m.set(String(t.eff.id), arq.itens[it.idx]);
  }
  return m;
}
const ADD_DO_TIPO = { track: 'track_add', arc: 'arc_add', via: 'via_add', text: 'text_add', fill: 'fill_add', region: 'region_add', pad: 'pad_add', poly: 'poly_add' };

/* O COMPONENTE DO CHANGES.JS. Quem tem uma linha comp_add (ECO, pcb_colocar, a vista) e o
   componente daquele designador hoje -- tambem quando o do board.js com o mesmo nome saiu por
   comp_del e voltou por comp_add (o ECO troca footprint assim). Ele nao tem orig_* no board.js:
   mover, apagar e renomear e mexer na linha dele. -1 = o componente e o do board.js. */
function linhaCompAdd(arq, ref) {
  for (let i = arq.itens.length - 1; i >= 0; i--) { const x = arq.itens[i]; if (x && x.op === 'comp_add' && x.ref === ref) return i; }
  return -1;
}
const r6m = v => Math.round(v * 1e6) / 1e6;
/* Junta na linha comp_add o comp_move e o designator_move do mesmo componente (a vista e MCPs
   antigos os escreviam em linhas proprias), com a posicao EFETIVA de hoje, e tira essas linhas --
   e tambem o designator_move/comment_move que sobrou do componente antigo que saiu por comp_del.
   Sem isso o pcb_mover_lote mexia no comp_add e a comp_move de depois ficava com orig_* invalido,
   e cada gravacao avisava "orig_* nao confere". Devolve o indice da comp_add depois da limpeza. */
function dobraCompAdd(arq, board, hc, ref) {
  const ia = linhaCompAdd(arq, ref);
  if (ia < 0) return -1;
  const sobra = [];
  arq.itens.forEach((x, i) => { if (i !== ia && x && x.ref === ref && /^(comp_move|designator_move|comment_move)$/.test(x.op)) sobra.push(i); });
  if (!sobra.length) return ia;
  const eb = hc.effectiveBoard(board, hc.applyPcbChanges(board, arq.itens));
  const c = (eb.components || []).find(k => k.ref === ref);
  const t = (eb.texts || []).find(k => k && k.designator && k.owner === ref);
  const novo = Object.assign({}, arq.itens[ia]);
  if (c) Object.assign(novo, { x: r6m(c.x), y: r6m(c.y), rot: r6m(c.rot || 0), layer: c.layer === 'Bottom' ? 'Bottom' : 'Top' });
  const desMovido = sobra.some(i => i > ia && arq.itens[i].op === 'designator_move');
  if (t && (isNum(novo.des_x) || desMovido)) {
    Object.assign(novo, { des_x: r6m(t.x), des_y: r6m(t.y) });
    if (isNum(t.h)) novo.des_h = t.h;
    if (isNum(t.w)) novo.des_w = t.w;
    if (isNum(t.rot)) novo.des_rot = r6m(t.rot);
  }
  arq.substitui(ia, novo);
  for (const i of sobra.sort((a, b) => b - a)) arq.remove(i);
  return linhaCompAdd(arq, ref);
}
/* comp_move / comp_del / comp_attr num componente que e uma linha comp_add: a propria linha. null =
   nao e o caso (siga com mescla + origDe). */
function opNoAdicionado(arq, board, hc, op) {
  if (!op || !/^(comp_move|comp_del|comp_attr)$/.test(op.op) || linhaCompAdd(arq, op.ref) < 0) return null;
  const ia = dobraCompAdd(arq, board, hc, op.ref);
  const velho = arq.itens[ia];
  if (op.op === 'comp_del') {
    /* sai a comp_add e o que vem depois dela sobre o mesmo componente (pad_net, comp_attr...) */
    const fora = [ia];
    arq.itens.forEach((x, i) => { if (i > ia && x && x.ref === op.ref && x.op !== 'comp_add') fora.push(i); });
    for (const i of fora.sort((a, b) => b - a)) arq.remove(i);
    return { op: 'comp_del', ref: op.ref, removida: velho.op, note: op.note };
  }
  if (op.op === 'comp_attr') {
    const novoRef = op.designator != null && String(op.designator) !== op.ref ? String(op.designator) : null;
    const n = Object.assign({}, velho);
    if (op.comment != null) n.comment = String(op.comment);
    if (novoRef) {
      if ((board.components || []).some(k => k.ref === novoRef) || linhaCompAdd(arq, novoRef) >= 0) throw new ErroMcp(`comp_attr: já existe um "${novoRef}" na placa`);
      n.ref = novoRef;
      arq.itens.forEach((x, i) => { if (i > ia && x && x.ref === op.ref) arq.substitui(i, Object.assign({}, x, { ref: novoRef })); });
    }
    arq.substitui(ia, n);
    return n;
  }
  /* comp_move: a linha anda, e o designator posto nela (des_*) anda junto */
  const lado = q => q === 'Bottom' ? 'Bottom' : 'Top';
  const n = Object.assign({}, velho);
  for (const k of ['x', 'y', 'rot']) if (isNum(op[k])) n[k] = op[k];
  if (op.layer) n.layer = lado(op.layer);
  if (op.note) n.note = op.note;
  if (isNum(velho.des_x) && isNum(velho.des_y)) {
    const d = hc.compDelta({ src: { x: velho.x, y: velho.y, rot: velho.rot || 0, layer: lado(velho.layer) },
                             eff: { x: n.x, y: n.y, rot: n.rot || 0, layer: lado(n.layer) } });
    const q = hc.xfPoint(d, velho.des_x, velho.des_y);
    n.des_x = r6(q.x); n.des_y = r6(q.y);
    if (isNum(velho.des_rot)) n.des_rot = normAng(velho.des_rot + d.dr);
  }
  arq.substitui(ia, n);
  return n;
}
/* edicao/remocao de um objeto acrescentado ("new-..."): a linha *_add dele. null = o id e do
   board.js (siga com mescla + origDe). `novos` = mapaNovos (calcule uma vez por lote). */
function opNoNovo(arq, board, hc, op, novos) {
  const m = op && /^(\w+)_(edit|del)$/.exec(op.op);
  if (!m || op.id == null || indicePorId(board).has(String(op.id))) return null;
  const mapa = novos || mapaNovos(arq, board, hc);
  const i = arq.itens.indexOf(mapa.get(String(op.id)));
  if (i < 0) throw new ErroMcp(`não existe objeto com id "${op.id}" (nem no board.js nem nas linhas do changes.js; pcb_consultar mostra os ids de agora)`);
  const linha = arq.itens[i];
  const tipo = { track: 'track', arc: 'arc', via: 'via', text: 'text', fill: 'fill', region: 'region', pad: 'pad', poly: 'poly' }[m[1]];
  if (!tipo || linha.op !== ADD_DO_TIPO[tipo]) throw new ErroMcp(`"${op.id}" foi criado por ${linha.op}, não é ${m[1]}`);
  if (m[2] === 'del') { arq.remove(i); return { op: op.op, id: op.id, removida: linha.op }; }
  const n = Object.assign({}, linha);
  for (const k of Object.keys(op)) if (!/^(op|id)$/.test(k) && !k.startsWith('orig_') && op[k] !== undefined) n[k] = op[k];
  arq.substitui(i, n);
  mapa.set(String(op.id), n);
  return n;
}
/* uma op qualquer como a IA pensa: componente de comp_add e objeto "new-..." mexem na linha deles;
   o resto vai por mescla + origDe (orig_* do board.js) */
function aplica(arq, board, hc, op, novos) {
  return opNoAdicionado(arq, board, hc, op) || opNoNovo(arq, board, hc, op, novos) || mescla(arq, origDe(op, board)).obj;
}

/* designator_move / comment_move como a IA pensa (1.36.0): x/y/rot = onde o texto deve FICAR na
   placa ("referencial":"efetivo", o padrao). O motor e o ApplyChanges querem o lugar de antes do
   comp_move do dono (a linha entra antes dele): a conta inversa e a mesma da vista (pcbframe.js »
   moveDesignator, HubCore.xfPointInv). "referencial":"original" grava como veio (o de antes).
   Componente criado por comp_add nao tem designator no board.js (o Altium o poe onde o footprint
   manda): o lugar vai na propria linha do comp_add (des_x/des_y/des_h/des_w/des_rot).
   Devolve o objeto que ficou no arquivo. */
function aplicaTexto(arq, board, hc, op0) {
  const op = Object.assign({}, op0);
  const ref = op.ref, refl = op.referencial;
  delete op.referencial;
  if (refl != null && refl !== 'efetivo' && refl !== 'original')
    throw new ErroMcp('referencial deve ser "efetivo" (padrão: x/y/rot = onde o texto fica na placa) ou "original" (o referencial de antes do comp_move)');
  /* o componente de uma linha comp_add (tambem o que voltou com o mesmo nome depois de um comp_del:
     o designator do board.js e do componente que saiu, e o orig_* dele nao confere mais) */
  if (linhaCompAdd(arq, ref) >= 0 || !(board.components || []).some(c => c.ref === ref)) {
    const i = dobraCompAdd(arq, board, hc, ref);
    if (i < 0) throw new ErroMcp(`componente "${ref}" não está no board.js nem num comp_add do changes.js`);
    if (op.op === 'comment_move') throw new ErroMcp(`${ref} foi criado por comp_add: o comment dele ainda não se move pelo hub (o designator sim)`);
    const novo = Object.assign({}, arq.itens[i]);
    const model = hc.applyPcbChanges(board, arq.itens);
    if (isNum(op.x) !== isNum(op.y)) {
      const t = (hc.effectiveBoard(board, model).texts || []).find(x => x && x.designator && x.owner === ref);
      if (t) { if (!isNum(op.x)) op.x = t.x; if (!isNum(op.y)) op.y = t.y; }
    }
    /* comp_add seguido de comp_move: o des_* vale no lugar do comp_add (antes de andar) */
    const m = model.compByRef[ref];
    if (refl !== 'original' && m && m.changed) {
      const d = hc.compDelta(m);
      if (isNum(op.x) && isNum(op.y)) { const q = hc.xfPointInv(d, op.x, op.y); op.x = r6(q.x); op.y = r6(q.y); }
      if (isNum(op.rot)) op.rot = normAng(d.flip ? d.phi + 180 - op.rot : op.rot - d.dr);
    }
    for (const [de, para] of [['x', 'des_x'], ['y', 'des_y'], ['h', 'des_h'], ['w', 'des_w'], ['rot', 'des_rot']])
      if (op[de] !== undefined) novo[para] = op[de];
    arq.substitui(i, novo);
    return novo;
  }
  if (refl !== 'original' && (isNum(op.x) || isNum(op.y) || isNum(op.rot))) {
    const model = hc.applyPcbChanges(board, arq.itens);
    const m = model.compByRef[ref];
    if (m && m.changed && !m.deleted) {
      const d = hc.compDelta(m);
      if (isNum(op.x) || isNum(op.y)) {
        let x = op.x, y = op.y;
        if (!isNum(x) || !isNum(y)) {
          const qual = op.op === 'designator_move' ? 'designator' : 'comment';
          const t = (hc.effectiveBoard(board, model).texts || []).find(k => k && k[qual] && k.owner === ref);
          if (t) { if (!isNum(x)) x = t.x; if (!isNum(y)) y = t.y; }
        }
        if (isNum(x) && isNum(y)) { const q = hc.xfPointInv(d, x, y); op.x = r6(q.x); op.y = r6(q.y); }
      }
      if (isNum(op.rot)) op.rot = normAng(d.flip ? d.phi + 180 - op.rot : op.rot - d.dr);
    }
  }
  return mescla(arq, origDe(op, board)).obj;
}

/* onde cada designator/comment pedido ficou DE FATO na placa efetiva (para a IA comparar com o que
   pediu) e se ficou fora do contorno. `pedidos` = [{ref, op, x, y}] */
function posicoesEfetivas(hc, board, model, pedidos, dentro) {
  const eb = hc.effectiveBoard(board, model);
  const out = [];
  for (const q of pedidos) {
    const qual = q.op === 'comment_move' ? 'comment' : 'designator';
    const t = (eb.texts || []).find(k => k && k[qual] && k.owner === q.ref);
    if (!t) { out.push({ ref: q.ref, texto: qual, erro: 'não achei o texto na placa efetiva' }); continue; }
    const o = { ref: q.ref, texto: qual, efetivo: { x: r6(t.x), y: r6(t.y), h: t.h, w: t.w, rot: t.rot, layer: t.layer } };
    if (isNum(q.x) && isNum(q.y)) {
      o.pedido = { x: q.x, y: q.y };
      const dist = Math.hypot(t.x - q.x, t.y - q.y);
      if (dist > 0.005) o.diferenca_mm = r6(dist);
    }
    if (dentro) { const f = dentro(t); if (f === false) o.fora_da_placa = true; }
    out.push(o);
  }
  return out;
}

/* reserializa pelo hub-core; op que ele nao conhece (comp_add, pad_add... do hub-pcbeco) vai
   como linha crua, no mesmo formato */
function reserializa(hc, itens) {
  const r = hc.serializeChanges(itens);
  if (r.text) return r.text;
  const L = ['// AltiumPCBMirror - arquivo de mudancas.',
             '// Edite ESTE arquivo (nunca o board.js). Um objeto JSON por linha. Consulte AI-GUIDE.md.',
             'var changes = ['];
  for (const ch of itens) L.push(jline(ch) + ',');
  L.push('];');
  return L.join('\n') + '\n';
}

/* ops que algum modulo do hub declara conhecer (o hub-pcbeco traz comp_add, pad_add...) */
function opsDeModulos(ctx) {
  const s = new Set();
  for (const [arq, g] of [['hub-pcbeco.js', 'OPS'], ['hub-pcbpour.js', 'OPS'], ['hub-pcbteardrop.js', 'OPS'], ['hub-pcbnova.js', 'OPS']]) {
    const m = ctx.modulo(arq);
    const v = m && (m[g] || m.ops);
    if (Array.isArray(v)) v.forEach(x => s.add(String(x)));
    else if (v && typeof v === 'object') Object.keys(v).forEach(x => s.add(x));
  }
  return s;
}

/* Resumo da validacao de um modelo */
function resumoValidacao(model, max) {
  const v = model.validation || [];
  const erros = v.filter(x => x.level === 'err'), avisos = v.filter(x => x.level !== 'err');
  return { erros: erros.length, avisos: avisos.length,
           mensagens: v.slice(0, max || 30).map(x => (x.level === 'err' ? 'ERRO ' : 'aviso ') + x.msg) };
}

/* A transacao: abre o changes.js, deixa `fn(arq, board, ctx)` mexer, valida e grava.
   fn devolve a lista dos objetos tocados (os que estao em arq.itens). */
function transacao(ctx, p, fn, opts) {
  const o = opts || {};
  const hc = ctx.pcbPronto();
  const board = ctx.board(p);
  const arq = ArquivoLinhas.abrir('changes', p.arq('changes.js'));
  const itensAntes = arq.itens.slice();
  const antes = hc.applyPcbChanges(board, itensAntes);
  const statusAntes = new Map(antes.changeItems.map(it => [it.ch, it.status]));
  const tocados = fn(arq, board) || [];
  /* toda linha *_add nova ganha um uid (no proprio objeto: os tocados continuam os mesmos) */
  const jaTinha = new Set(itensAntes);
  for (const x of arq.itens) if (x && !jaTinha.has(x) && COM_UID.test(x.op) && x.uid == null) x.uid = uidLivre(arq);
  const model = hc.applyPcbChanges(board, arq.itens);
  const tset = new Set(tocados);
  const novosErros = [], linhas = [];
  for (const it of model.changeItems) {
    const toc = tset.has(it.ch);
    if (toc) linhas.push({ indice: it.idx, op: it.ch && it.ch.op, status: it.status, msg: it.msg || undefined, linha: jline(it.ch) });
    if (it.status === 'err' && (toc || statusAntes.get(it.ch) !== 'err'))
      novosErros.push(`#${it.idx + 1} ${it.ch && it.ch.op}: ${it.msg}`);
  }
  /* campos obrigatorios do formato (o que o ApplyChanges le), salvo op que um modulo declara */
  const conhecidas = opsDeModulos(ctx);
  const ser = hc.serializeChanges(arq.itens);
  for (const e of (ser.errors || [])) {
    const ch = arq.itens[e.idx];
    if (/tipo desconhecido/.test(e.msg) && ch && conhecidas.has(ch.op)) continue;
    if (tset.has(ch) || /tipo desconhecido/.test(e.msg)) novosErros.push(`#${e.idx + 1} ${e.msg}`);
  }
  /* RESPOSTA CURTA. Lote grande (teardrop_aplicar com 330 regiões, eco_aplicar, serigrafia_posicionar)
     devolvia cada linha gravada e enchia o contexto da IA: acima de 40 linhas vão as 10 primeiras e
     as que deram aviso/erro (até 30), com o total e a contagem por op. o.todasLinhas = todas. */
  let linhasResp = linhas, extraLinhas = {};
  if (!o.todasLinhas && linhas.length > 40) {
    const porOp = {};
    for (const l of linhas) porOp[l.op] = (porOp[l.op] || 0) + 1;
    const ruins = linhas.filter(l => l.status !== 'ok');
    linhasResp = linhas.slice(0, 10).concat(ruins.filter(l => linhas.indexOf(l) >= 10).slice(0, 30));
    extraLinhas = { linhas_total: linhas.length, linhas_por_op: porOp, linhas_com_aviso: ruins.length,
                    nota_linhas: 'resposta resumida: as 10 primeiras linhas e as com aviso/erro (pcb_mudancas mostra o resto)' };
  }
  const estado = {
    ok: !novosErros.length,
    gravado: false,
    arquivo: ctx.rel(p.arq('changes.js')),
    mudancas_no_arquivo: arq.itens.length,
    linhas: linhasResp,
    ...extraLinhas,
    erros: novosErros,
    validacao: resumoValidacao(model),
  };
  if (typeof o.relata === 'function') {
    try { Object.assign(estado, o.relata(model, board, hc, { antes: itensAntes, depois: arq.itens.slice() }) || {}); }
    catch (e) { estado.relato_erro = String(e && e.message || e); }
  }
  if (o.simular) { estado.simulado = true; return estado; }
  if (novosErros.length && !o.forcar) {
    estado.dica = 'Nada foi gravado. Corrija os erros (ou passe forcar:true para gravar mesmo assim; o hub e o ApplyChanges vão acusar a linha).';
    return estado;
  }
  const texto = arq.texto(itens => reserializa(hc, itens));
  estado.gravado = ctx.grava(p.arq('changes.js'), texto, o.ferramenta);
  if (novosErros.length) estado.ok = false;
  return estado;
}

/* o conjunto de regras do projeto como a vista o carrega: o rules.js (HubPcbRegras.ler) ou, sem
   ele, o padrao da casa + o board.rules do espelho (doBoard). O DRC, o roteador e a largura/via
   das ferramentas leem daqui: uma fonte so. null sem o hub-pcbregras.js */
function regrasDoProjeto(ctx, p) {
  const R = ctx.modulo('hub-pcbregras.js');
  if (!R) return null;
  const fs = require('node:fs');
  const f = p.arq('rules.js');
  if (fs.existsSync(f)) return { conjunto: R.ler(fs.readFileSync(f, 'utf8')), fonte: 'rules.js' };
  return { conjunto: R.doBoard(ctx.temBoard(p) ? ctx.board(p) : {}), fonte: 'padrão da casa + board.rules (ainda não há rules.js)' };
}

module.exports = { indicePorId, achaObjeto, tipoDoObjeto, origDe, chaveDe, mescla, aplica, mapaNovos, linhaCompAdd, dobraCompAdd, opNoAdicionado, opNoNovo, aplicaTexto, posicoesEfetivas, reserializa, transacao, resumoValidacao, regrasDoProjeto, r6 };
