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
  if (!(board.components || []).some(c => c.ref === ref)) {
    const i = arq.itens.findIndex(x => x && x.op === 'comp_add' && x.ref === ref);
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
  const estado = {
    ok: !novosErros.length,
    gravado: false,
    arquivo: ctx.rel(p.arq('changes.js')),
    mudancas_no_arquivo: arq.itens.length,
    linhas,
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

module.exports = { indicePorId, achaObjeto, tipoDoObjeto, origDe, chaveDe, mescla, aplicaTexto, posicoesEfetivas, reserializa, transacao, resumoValidacao, regrasDoProjeto, r6 };
