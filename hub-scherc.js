/* NexoEletric - hub-scherc.js — o DRC do ESQUEMA (o ERC), motor puro + o painel.

   Pedido do dono (2026-11-10): "se o componente no esquema estiver desconectado de uma net, eu quero que apareça um
   triângulo amarelo, e quero um DRC no esquema também, mostrando esses componentes desconectados, ou qualquer coisa
   que tiver errado, tipo componente fora do almoxarifado também; quero que os componentes que estiverem fora do
   almoxarifado fiquem vermelhinhos, em volta dizendo que estão fora".

   O MOTOR NÃO INVENTA REGRA: junta num lugar só o que já estava espalhado —
     pino-solto            o extractNets » pinosSoltos (o pino que não liga a nada; No ERC na ponta = de propósito; o
                           pino chamado NC também fica de fora)
     fora-almox            o componente sem ficha no almoxarifado: sem OdooId/LocalId e sem o valor no espelho do
                           almoxarifado (HubOdooLink.fichaDoComp null e sem LocalId) — o mesmo "sem ficha: vincule ao
                           almoxarifado" do botão Parâmetros (o chamador injeta `foraDoAlmox`). O não montar (DNP)
                           e o só de cobre (ehSoCobre: jumper de solda, ponto de teste, fiducial…) ficam de fora
     ref-duplicado         dois componentes com o mesmo designador e a mesma parte (o validateSchematic)
     ref-sem-numero        "R?", "U?" — designador não numerado
     net-um-pino           a net com nome (rótulo, port ou power) que liga um pino só, e o rótulo/port/power solto
     sem-footprint         o componente sem footprint (vai sem vínculo para a placa)
     footprint-inexistente o footprint que não está na PcbLib (nem na biblioteca do hub) — o ECO recusa
     projeto-nao-definido  o Definir projeto ainda não deu o código da placa (a PCB não declarada da 1.92.2) ou o carimbo
                           mostra "PROJETO NÃO DEFINIDO" (placa ou equipamento) — o chamador diz (`projetoNaoDefinido`)
     (1.97.0) o Graphical (ComponentKind=Graphical, só documentação) não gera pino solto, sem footprint, footprint fora
     da PcbLib, fora do almoxarifado nem os Parâmetros, e a net que só ele liga não é "um pino só"
     componente            os outros avisos do botão Parâmetros (acervo pendente, desenho emprestado, partes, pinos sem
                           pad, Odoo fora do espelho) — o chamador injeta `avisosDoComp`
   Severidade: 'erro' ou 'aviso' por regra (SEVERIDADE abaixo); o chamador pode trocar (`severidades`).

   VARIANTE: o componente suprimido na variante ativa (`suprimidos`, o Set de refs) não gera aviso de pino solto, de
   fora do almoxarifado nem dos Parâmetros — ele não vai para a placa desta variante.

   rodar(o) -> { total, erros, avisos, porRegra:[{regra, titulo, sev, n}], violacoes:[{regra, titulo, sev, msg, sheet,
                 x, y, ref?, caixa?}] }  (x, y em mil, da folha `sheet`; null = sem lugar, ex. o projeto não definido) */
(function (root) {
'use strict';

const REGRAS = [
  ['pino-solto',            'Pino desconectado',            'aviso'],
  ['fora-almox',            'Fora do almoxarifado',         'erro'],
  ['ref-duplicado',         'Designador duplicado',         'erro'],
  ['ref-sem-numero',        'Designador não numerado',      'erro'],
  ['net-um-pino',           'Net com um pino só',           'aviso'],
  ['sem-footprint',         'Sem footprint',                'aviso'],
  ['footprint-inexistente', 'Footprint fora da PcbLib',     'erro'],
  ['projeto-nao-definido',  'Projeto não definido',         'erro'],
  ['componente',            'Componente (Parâmetros)',      'aviso'],
];
const TITULO = {}, SEVERIDADE = {};
for (const [k, t, s] of REGRAS) { TITULO[k] = t; SEVERIDADE[k] = s; }
const ehNC = nome => /^n\.?\s*c\.?$/i.test(String(nome || '').trim());

/* SÓ DE COBRE (1.96.0, pedido do dono: o "fora do almoxarifado" deveria ignorar componente marcado como não montar ou
   só de cobre). É a peça que não se compra: o jumper de solda, o ponto de solda/teste, o fiducial, o net tie, o
   logo — o footprint é só cobre na placa. Vale:
     - a marca explícita: "soCobre":true no comp, ou nos params SoCobre=1 / BOM=NAO / ComponentKind=Net Tie,
       Jumper, Graphical, Standard (No BOM) (os tipos do Altium que não vão para o BOM);
     - o reconhecimento: footprint SEM corpo 3D cujo nome (ou o do símbolo) diz que é só cobre (jumper, ponte de
       solda, ponto de solda/teste, test point, fiducial, net tie, logo). Com corpo 3D é peça de verdade (o jumper
       de barra com o shunt), e o nome sozinho não basta. */
const SO_COBRE_PARAM = /^\s*(SoCobre\s*=\s*(1|true|sim)|BOM\s*=\s*N[AÃ]O|ComponentKind\s*=\s*(net\s*tie.*|jumper|graphical|.*no\s*bom.*))\s*$/i;
const SO_COBRE_NOME = /jumper|jump\b|ponte\s*(de\s*)?solda|ponto\s*(de\s*)?(solda|teste)|test\s*-?\s*point|\bTP\b|fiducial|net\s*-?\s*tie|\blogo\b|solder\s*(jumper|bridge)/i;
function ehSoCobre(c, fp){
  if (!c || typeof c !== 'object') return false;
  if (c.soCobre === true) return true;
  if (typeof c.params === 'string' && c.params.split(';').some(p => SO_COBRE_PARAM.test(p))) return true;
  if (!fp || (fp.bodies || []).length) return false;
  return SO_COBRE_NOME.test(String(fp.name || c.footprint || '')) || SO_COBRE_NOME.test(String(c.sym || ''));
}

function rodar(o){
  const t0 = Date.now();
  o = o || {};
  const hc = o.hc || root.HubCore;
  const sch = o.schematic || { items: [] };
  const sev = Object.assign({}, SEVERIDADE, o.severidades || {});
  const sup = o.suprimidos instanceof Set ? o.suprimidos : new Set(o.suprimidos || []);
  const nets = o.nets || (hc && o.slib ? hc.extractNets(sch, o.slib) : { nets: [], pinosSoltos: [], warnings: [] });
  const comps = (sch.items || []).filter(it => it && it.t === 'comp');
  const vs = [];
  const add = (regra, msg, lugar, extra) => vs.push(Object.assign({ regra, titulo: TITULO[regra] || regra, sev: sev[regra] || 'aviso', msg,
    sheet: lugar && lugar.sheet != null ? lugar.sheet : null, x: lugar && isFinite(lugar.x) ? lugar.x : null,
    y: lugar && isFinite(lugar.y) ? lugar.y : null }, extra || {}));
  const caixaDe = c => (o.caixaDoComp ? o.caixaDoComp(c) : null);
  const fpDe = c => { const n = String(c.footprint == null ? '' : c.footprint).trim(); return n && hc && o.plib ? hc.footprintOf(o.plib, n) : null; };
  const centro = c => { const b = caixaDe(c); return b ? { sheet: c.sheet, x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 } : { sheet: c.sheet, x: c.x, y: c.y }; };

  /* pino desconectado */
  /* o Graphical (1.97.0): só documentação — sem pino solto, sem footprint, sem almoxarifado, sem os Parâmetros */
  const graf = hc && typeof hc.graficoRefs === 'function' ? hc.graficoRefs(sch) : new Set();
  for (const p of (nets.pinosSoltos || [])) {
    if (sup.has(String(p.ref)) || graf.has(String(p.ref)) || ehNC(p.name)) continue;
    add('pino-solto', p.ref + ' pino ' + p.num + (p.name && p.name !== String(p.num) ? ' (' + p.name + ')' : '') + ' sem ligação'
      + (p.fio ? ' — o fio dele não chega a nada' : ''), p, { ref: String(p.ref), pino: String(p.num) });
  }
  /* uma vez por designador (o componente de várias partes é um só) */
  const porRef = new Map();
  for (const c of comps) { const r = String(c.ref || ''); if (!porRef.has(r)) porRef.set(r, []); porRef.get(r).push(c); }
  for (const [ref, cs] of porRef) {
    const c = cs[0];
    const suprimido = sup.has(ref) || graf.has(ref);
    if (!ref || /\?$/.test(ref) || !/\d/.test(ref))
      for (const x of cs) add('ref-sem-numero', (ref || '(sem designador)') + ' — numere o componente (Anotar)', centro(x), { ref, caixa: caixaDe(x) });
    const partes = new Map();
    for (const x of cs) { const k = x.part || 1; partes.set(k, (partes.get(k) || 0) + 1); }
    for (const [k, n] of partes) if (n > 1 && ref && !/\?$/.test(ref))
      for (const x of cs.filter(y => (y.part || 1) === k)) add('ref-duplicado', ref + (cs.length > 1 && (x.part || 1) > 1 ? ' parte ' + k : '') + ' aparece ' + n + ' vezes', centro(x), { ref, caixa: caixaDe(x) });
    /* o não montar e o só de cobre não se compram: não estão "fora" do almoxarifado (1.96.0) */
    const soCobre = cs.some(x => ehSoCobre(x, fpDe(x)));
    const naoCompra = (hc && typeof hc.ehDnp === 'function' && cs.some(x => hc.ehDnp(x))) || soCobre;
    if (!suprimido && !naoCompra && typeof o.foraDoAlmox === 'function' && o.foraDoAlmox(c))
      add('fora-almox', ref + ' (' + (c.sym || '—') + ') está fora do almoxarifado — sem ficha: vincule pelo "Trocar componente…"', centro(c), { ref, caixa: caixaDe(c) });
    const fp = String(c.footprint == null ? '' : c.footprint).trim();
    if (graf.has(ref)) { /* o Graphical não vai para a placa: footprint nenhum a cobrar */ }
    else if (!fp) add('sem-footprint', ref + ' sem footprint — vai sem vínculo para a placa', centro(c), { ref, caixa: caixaDe(c) });
    else {
      const existe = typeof o.footprintExiste === 'function' ? o.footprintExiste(fp, c) : !!(hc && hc.footprintOf(o.plib, fp));
      if (!existe) add('footprint-inexistente', ref + ': o footprint "' + fp + '" não está na PcbLib nem na biblioteca do hub — o ECO recusa', centro(c), { ref, caixa: caixaDe(c) });
    }
    if (!suprimido && typeof o.avisosDoComp === 'function')
      for (const a of (o.avisosDoComp(c) || [])) {
        /* 1.96.1: a peça só de cobre não tem acervo nem ficha a vincular */
        if (soCobre && a && (a.cod === 'acervo' || a.cod === 'odoo' || a.cod === 'sem-ficha')) continue;
        const txt = typeof a === 'string' ? a : a.t;
        add('componente', ref + ' — ' + txt, centro(c), { ref, caixa: caixaDe(c), sev: (a && a.nivel === 'err') ? 'erro' : sev.componente });
      }
  }
  /* net com um pino só (a que tem nome: o rótulo, a port ou o power a ligam a um pino só) */
  const pinoEm = (ref, num) => {
    if (!hc || !o.slib) return null;
    for (const c of (porRef.get(ref) || [])) {
      const ps = hc.compPinsWorld(c, o.slib) || [];
      const p = ps.find(q => String(q.num) === String(num));
      if (p) return { sheet: c.sheet, x: p.x, y: p.y };
    }
    return null;
  };
  for (const n of (nets.nets || [])) {
    if (n.auto || (n.pins || []).length !== 1) continue;
    const [ref, num] = String(n.pins[0]).split(/-(?=[^-]*$)/);
    /* a net que liga só um Graphical a uma port (o contator do painel) não é "um pino só" */
    if (sup.has(ref) || graf.has(ref)) continue;
    /* o No ERC na ponta do pino diz "solto de propósito" (1.97.5, pedido do dono: os pinos 28 e 30 do CN1 do display):
       vale também para a net de um pino só */
    const lugar = pinoEm(ref, num);
    if (lugar && (sch.items || []).some(i => i && i.t === 'noerc' && i.sheet === lugar.sheet && Math.abs(i.x - lugar.x) <= 0.5 && Math.abs(i.y - lugar.y) <= 0.5)) continue;
    add('net-um-pino', 'a net ' + n.name + ' liga um pino só (' + ref + ' pino ' + num + ')', pinoEm(ref, num), { ref, net: n.name });
  }
  for (const w of (nets.warnings || [])) {
    const m = /^(netlabel|power|port) "(.*)" solt[ao] em \((-?[\d.]+),(-?[\d.]+)\)$/.exec(w);
    if (!m) continue;
    const it = (sch.items || []).find(i => i && i.t === m[1] && i.net === m[2] && i.x === +m[3] && i.y === +m[4]);
    add('net-um-pino', (m[1] === 'netlabel' ? 'o rótulo ' : m[1] === 'port' ? 'a port ' : 'o power ') + m[2] + ' está solto (não liga a nada)',
      { sheet: it ? it.sheet : null, x: +m[3], y: +m[4] }, { net: m[2] });
  }
  if (o.projetoNaoDefinido)
    add('projeto-nao-definido', typeof o.projetoNaoDefinido === 'string' ? o.projetoNaoDefinido
      : 'o projeto não tem o código da placa: use o Definir projeto (o carimbo mostra "PROJETO NÃO DEFINIDO")', null);

  const ordemSev = s => s === 'erro' ? 0 : 1;
  const ordemRegra = r => REGRAS.findIndex(x => x[0] === r);
  vs.sort((a, b) => ordemSev(a.sev) - ordemSev(b.sev) || ordemRegra(a.regra) - ordemRegra(b.regra));
  const porRegra = [];
  for (const [k] of REGRAS) {
    const d = vs.filter(v => v.regra === k);
    if (d.length) porRegra.push({ regra: k, titulo: TITULO[k], sev: d.some(v => v.sev === 'erro') ? 'erro' : 'aviso', n: d.length });
  }
  const erros = vs.filter(v => v.sev === 'erro').length;
  return { total: vs.length, erros, avisos: vs.length - erros, porRegra, violacoes: vs, tempoMs: Date.now() - t0 };
}

/* ─── o painel (browser): a lista com a severidade, o filtro por regra e o clique que leva à violação ─── */
const CSS = `
.erc{position:absolute; left:50%; bottom:34px; transform:translateX(-50%); z-index:30; width:min(860px, calc(100% - 40px));
  max-height:42%; display:flex; flex-direction:column; background:var(--panel); color:var(--fg); border:1px solid var(--border);
  border-radius:8px; box-shadow:var(--shadow-menu, 0 8px 28px rgba(0,0,0,.4)); font:12px var(--font);}
.erc-hd{display:flex; align-items:center; gap:8px; padding:7px 10px; border-bottom:1px solid var(--border);}
.erc-hd b{font-size:12.5px;} .erc-hd .res{color:var(--fg-dim);} .erc-hd .esp{flex:1;}
.erc-hd button{height:24px; padding:0 10px; font-size:11.5px;}
.erc-chips{display:flex; flex-wrap:wrap; gap:4px; padding:6px 10px; border-bottom:1px solid var(--border);}
.erc-chip{display:inline-flex; gap:6px; align-items:center; padding:2px 8px; border-radius:10px; border:1px solid var(--border);
  cursor:pointer; color:var(--fg-dim); user-select:none;}
.erc-chip .n{font-variant-numeric:tabular-nums; color:var(--fg);} .erc-chip.on{background:var(--hi); color:var(--on-hi); border-color:var(--hi);}
.erc-chip.on .n{color:var(--on-hi);} .erc-chip .pt{width:7px; height:7px; border-radius:50%;}
.erc-lista{overflow:auto; min-height:60px;}
.erc-lista table{width:100%; border-collapse:collapse;}
.erc-lista td{padding:4px 10px; border-bottom:1px solid rgba(255,255,255,.05); vertical-align:top;}
.erc-lista tr{cursor:pointer;} .erc-lista tr:hover{background:rgba(255,255,255,.04);} .erc-lista tr.on{background:rgba(255,170,0,.14);}
.erc-sev{white-space:nowrap; font-size:11px;} .erc-sev.erro{color:#f87171;} .erc-sev.aviso{color:#facc15;}
.erc-cl{white-space:nowrap; color:var(--fg-dim);} .erc-fl{white-space:nowrap; color:var(--fg-dim); font-size:11px;}
.erc-vazio{padding:14px; color:var(--fg-dim);} .erc-vazio.ok{color:#4ade80;}
`;
function css(){
  if (typeof document === 'undefined' || document.getElementById('erc-css')) return;
  const s = document.createElement('style'); s.id = 'erc-css'; s.textContent = CSS; document.head.append(s);
}
function el(tag, cls, txt){ const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
/* painel(container, {rodar(), irPara(v), aoFechar(), arrumar()? -> res}) -> {mostra(res), el, fecha()} */
function painel(container, opts){
  css();
  opts = opts || {};
  const raiz = el('div', 'erc');
  raiz.setAttribute('role', 'dialog'); raiz.setAttribute('aria-label', 'DRC do esquema');
  const hd = el('div', 'erc-hd');
  const res = el('span', 'res', '');
  const bRodar = el('button', null, 'Rodar de novo'); bRodar.type = 'button';
  /* 1.98.0: o Arrumar — encaixa nos fios o componente deslocado (o "arredar pro lado"); só com pino solto na lista */
  const bArrumar = el('button', null, 'Arrumar'); bArrumar.type = 'button';
  bArrumar.title = 'Arrumar os pinos desconectados: arreda para o lado o componente que ficou deslocado dos fios '
    + '(no import do Altium) até os pinos encaixarem nas pontas — só quando o encaixe é exato e nada mais se solta, '
    + 'nem junta net. Ctrl+Z desfaz tudo de uma vez';
  bArrumar.hidden = typeof opts.arrumar !== 'function';
  const bX = el('button', null, '×'); bX.type = 'button'; bX.title = 'Fechar (Esc)';
  hd.append(el('b', null, 'DRC do esquema'), res, el('span', 'esp'), bArrumar, bRodar, bX);
  const chips = el('div', 'erc-chips'), lista = el('div', 'erc-lista');
  raiz.append(hd, chips, lista);
  container.append(raiz);
  let R = null, filtro = null, atual = -1, linhas = [];
  const COR = { erro:'#f87171', aviso:'#facc15' };
  function mostra(r){
    R = r; atual = -1;
    bArrumar.disabled = !r.porRegra.some(c => c.regra === 'pino-solto');
    if (filtro && !r.porRegra.some(c => c.regra === filtro)) filtro = null;
    res.textContent = r.total ? r.erros + ' erro' + (r.erros === 1 ? '' : 's') + ' · ' + r.avisos + ' aviso' + (r.avisos === 1 ? '' : 's') : 'nada errado';
    chips.textContent = '';
    chips.hidden = !r.porRegra.length;
    for (const c of r.porRegra) {
      const ch = el('span', 'erc-chip' + (filtro === c.regra ? ' on' : ''));
      const pt = el('span', 'pt'); pt.style.background = COR[c.sev];
      ch.append(pt, el('span', null, c.titulo), el('span', 'n', String(c.n)));
      ch.title = 'filtrar: ' + c.titulo;
      ch.onclick = () => { filtro = filtro === c.regra ? null : c.regra; mostra(R); };
      chips.append(ch);
    }
    lista.textContent = ''; linhas = [];
    const vs = r.violacoes.filter(v => !filtro || v.regra === filtro);
    if (!vs.length) { lista.append(el('div', 'erc-vazio' + (r.total ? '' : ' ok'), r.total ? 'Nada neste filtro.' : 'Nenhum problema: o esquema passa no DRC.')); return; }
    const t = el('table');
    vs.forEach((v, i) => {
      const tr = el('tr');
      tr.append(el('td', 'erc-sev ' + v.sev, v.sev === 'erro' ? '● erro' : '▲ aviso'), el('td', 'erc-cl', v.titulo), el('td', null, v.msg),
                el('td', 'erc-fl', v.sheet || ''));
      tr.onclick = () => escolhe(i);
      t.append(tr); linhas.push({ tr, v });
    });
    lista.append(t);
  }
  function escolhe(i){
    if (!linhas[i]) return;
    if (linhas[atual]) linhas[atual].tr.classList.remove('on');
    atual = i; linhas[i].tr.classList.add('on');
    if (linhas[i].tr.scrollIntoView) linhas[i].tr.scrollIntoView({ block:'nearest' });
    if (typeof opts.irPara === 'function') opts.irPara(linhas[i].v);
  }
  raiz.tabIndex = 0;
  raiz.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); escolhe(Math.min(linhas.length - 1, atual + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); escolhe(Math.max(0, atual - 1)); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fecha(); }
  });
  for (const ev of ['mousedown', 'pointerdown', 'wheel', 'contextmenu']) raiz.addEventListener(ev, e => e.stopPropagation(), { passive: ev === 'wheel' });
  const fecha = () => { raiz.remove(); if (typeof opts.aoFechar === 'function') opts.aoFechar(); };
  bX.onclick = fecha;
  bRodar.onclick = () => { if (typeof opts.rodar === 'function') { const r = opts.rodar(); if (r) mostra(r); } };
  bArrumar.onclick = () => {
    if (typeof opts.arrumar !== 'function') return;
    bArrumar.disabled = true; const txt = bArrumar.textContent; bArrumar.textContent = 'Arrumando…';
    /* um quadro para o "Arrumando…" aparecer: a conta refaz as nets algumas vezes */
    setTimeout(() => { try { const r = opts.arrumar(); if (r) mostra(r); } finally { bArrumar.textContent = txt; if (R) bArrumar.disabled = !R.porRegra.some(c => c.regra === 'pino-solto'); } }, 30);
  };
  return { el: raiz, mostra, fecha, resultado: () => R };
}

/* ─── o desenho na tela (não no PDF): o triângulo amarelo no pino solto e o contorno vermelho do fora do almoxarifado ─── */
/* o triângulo ⚠ do pino desconectado, ao lado da ponta do pino; `px` = quantos mil vale um pixel (fica do mesmo tamanho na tela) */
function triangulo(ctx, x, y, px){
  const s = Math.max(30, 9 * px);             /* lado, em mil */
  const cx = x + s * 0.55, cy = y + s * 0.55;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.5); ctx.lineTo(cx - s * 0.55, cy - s * 0.45); ctx.lineTo(cx + s * 0.55, cy - s * 0.45); ctx.closePath();
  ctx.fillStyle = '#facc15'; ctx.fill();
  ctx.lineWidth = Math.max(2, 1 * px); ctx.strokeStyle = '#a16207'; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.22); ctx.lineTo(cx, cy - s * 0.12);
  ctx.lineWidth = Math.max(2, s * 0.09); ctx.strokeStyle = '#422006'; ctx.lineCap = 'round'; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy - s * 0.27, Math.max(1.5, s * 0.05), 0, Math.PI * 2); ctx.fillStyle = '#422006'; ctx.fill();
  ctx.restore();
}
/* o contorno vermelho em volta do componente fora do almoxarifado, e a etiqueta "fora do almoxarifado" em cima.
   DISCRETO (pedido: "legível mas discreto"): a etiqueta tem tamanho de MUNDO (45 mil, a letra do nome de pino) — de longe
   ela some junto com o resto do texto da folha e fica só o contorno; de perto, lê-se. Sem preenchimento (o componente
   grande pintaria um pedaço da folha), e a etiqueta no canto de cima à ESQUERDA, por fora — o designador fica em cima,
   no meio, e o valor embaixo. */
function foraDoAlmox(ctx, b, px, texto){
  const m = 20;
  ctx.save();
  ctx.setLineDash([5 * px, 4 * px]);
  ctx.lineWidth = Math.max(2, 1.2 * px); ctx.strokeStyle = '#ef4444';
  ctx.strokeRect(b.x1 - m, b.y1 - m, b.x2 - b.x1 + 2 * m, b.y2 - b.y1 + 2 * m);
  ctx.setLineDash([]);
  const h = 38;
  const t = texto === undefined ? 'fora do almoxarifado' : String(texto || '');   /* '' = só o contorno (as outras partes) */
  if (t && h / px >= 6) {                     /* a letra com menos de 6 px não se lê: fica só o contorno */
    ctx.translate(b.x1 - m, b.y2 + m);
    ctx.scale(1, -1);
    ctx.font = '600 ' + h + 'px "Segoe UI", sans-serif';
    const w = ctx.measureText ? ctx.measureText(t).width : t.length * h * 0.55;
    const lw = w + h * 0.5;
    ctx.fillStyle = 'rgba(220,38,38,0.9)';
    ctx.fillRect(-lw, 0, lw, h * 1.25);
    ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'right';
    ctx.fillText(t, -h * 0.25, h * 0.95);
  }
  ctx.restore();
}

/* ─── ARRUMAR (1.98.0): o conserto dos erros bobos ───
   Pedido do dono (2026-11-11): "no DRC do esquema, eu queria que tivesse um botão pra arrumar os erros, que
   teoricamente são bobos, tipo 'componente desconectado' às vezes é só dar uma arredadinha pro lado, pq por algum
   motivo na hora de converter o projeto do Altium pro nosso software, alguns componentes ficam desconectados".
   MEDIDO nos projetos (PRJ-DI221694D R9, R7…): os DOIS pinos do resistor ficam 50 mil fora das pontas dos fios, na
   MESMA direção — o símbolo da nossa biblioteca tem a origem noutro lugar que o desenho que o Altium usou, então o
   componente inteiro está deslocado. O conserto é exatamente a "arredadinha": mover o componente pelo vetor que leva
   os pinos soltos às pontas de fio (ou ao rótulo, port, power, junção, pino) que estão logo ali.
   O motor procura, para cada parte de componente com pino solto, os vetores pino solto → ponto de ligação a até
   `raio` mil (além de `perto` só se 2+ pinos soltos encaixam no mesmo vetor); fica com o que encaixa MAIS pinos soltos
   (empate pelo menor), e só aceita se todo pino ligado cair exatamente num ponto de ligação (não no meio de um fio) e
   depois de refazer as nets:
     - o componente fica com menos pinos soltos, e nenhum pino de fora vira solto;
     - nenhum pino que já estava ligado se solta nem muda de net;
     - nenhuma net se junta com outra (nem dois pinos do próprio componente na mesma net, o resistor em curto), e
       nenhum conflito de nome novo;
     - dois vetores diferentes que empatam e passam os dois = ambíguo: não mexe (vai para `pulados`).
   Os aceitos se acumulam (o segundo é conferido com o primeiro já movido). Não grava nada: devolve os movimentos e o
   chamador aplica (a vista num desfazer só, o MCP no arquivo).
   arrumar(o) -> { movimentos:[{ idx, ref, part, sheet, dx, dy, liga:[num], soltosAntes, soltosDepois }],
                   pulados:[{ ref, part, sheet, motivo }], soltosAntes, soltosDepois, tempoMs }
   o: { hc, schematic, slib, suprimidos?, raio? (mil, padrão 300), perto? (mil, padrão 100: além disso só com 2+ pinos
        encaixando), aplicar? (true = deixa os itens movidos) } */
function arrumar(o){
  const t0 = Date.now();
  o = o || {};
  const hc = o.hc || root.HubCore;
  const sch = o.schematic || { items: [] };
  const L = o.slib;
  const raio = o.raio > 0 ? o.raio : 300;
  const perto = o.perto > 0 ? o.perto : 100;
  const sup = o.suprimidos instanceof Set ? o.suprimidos : new Set(o.suprimidos || []);
  const items = sch.items || [];
  const graf = typeof hc.graficoRefs === 'function' ? hc.graficoRefs(sch) : new Set();
  const nets = () => hc.extractNets(sch, L);
  const kp = (x, y) => Math.round(x * 2) + '|' + Math.round(y * 2);      /* a mesma chave do extractNets (0,5 mil) */
  const conta = s => String(s.ref) + '-' + String(s.num) + '@' + s.sheet;
  const soltosDe = n => (n.pinosSoltos || []).filter(p => !sup.has(String(p.ref)) && !graf.has(String(p.ref)) && !ehNC(p.name));
  const conflitos = n => (n.warnings || []).filter(w => /^nomes de net conflitantes/.test(w)).length;
  /* pino -> índice da net (só as nets da lista: as de 2+ pinos ou com nome) */
  const netDoPino = n => { const m = new Map(); (n.nets || []).forEach((x, i) => { for (const p of x.pins) m.set(p, i); }); return m; };
  /* os pontos onde um pino pode encaixar, por folha: pontas e vértices de fio, rótulo, power, port (as duas pontas),
     junção e os pinos dos OUTROS componentes */
  function pontos(){
    const porFolha = new Map();
    const poe = (f, x, y, dono) => {
      if (!isFinite(x) || !isFinite(y)) return;
      if (!porFolha.has(f)) porFolha.set(f, []);
      porFolha.get(f).push({ x, y, dono });
    };
    for (const it of items) {
      if (!it) continue;
      if (it.t === 'wire') for (const p of (it.pts || [])) poe(it.sheet, p[0], p[1], null);
      else if (it.t === 'netlabel' || it.t === 'power' || it.t === 'junction') poe(it.sheet, it.x, it.y, null);
      else if (it.t === 'port') for (const [x, y] of (hc.portPontas ? hc.portPontas(it) : [[it.x, it.y]])) poe(it.sheet, x, y, null);
      else if (it.t === 'comp') for (const p of (hc.compPinsWorld(it, L) || [])) poe(it.sheet, p.x, p.y, it);
    }
    return porFolha;
  }
  let n0 = nets();
  const antesTotal = soltosDe(n0).length;
  /* as partes com pino solto: o pino solto é achado pela posição (o mesmo ref pode ter várias partes) */
  function partesComSolto(n){
    const porChave = new Set();
    for (const s of soltosDe(n)) porChave.add(s.sheet + '|' + kp(s.x, s.y) + '|' + s.ref);
    const out = [];
    items.forEach((it, idx) => {
      if (!it || it.t !== 'comp' || sup.has(String(it.ref)) || graf.has(String(it.ref))) return;
      const ps = hc.compPinsWorld(it, L) || [];
      const soltos = ps.filter(p => porChave.has(it.sheet + '|' + kp(p.x, p.y) + '|' + it.ref));
      if (soltos.length) out.push({ it, idx, pinos: ps, soltos });
    });
    /* quem tem mais pinos soltos primeiro: é a evidência mais forte, e o movimento dele vira ponto para os outros */
    return out.sort((a, b) => b.soltos.length - a.soltos.length);
  }
  /* o movimento passa? (o item já está movido) */
  function confere(c, nA, nB){
    const meus = new Set(c.pinos.map(p => String(c.it.ref) + '-' + String(p.num)));
    const ehMeu = s => meus.has(String(s.ref) + '-' + String(s.num));
    const sA = new Set(soltosDe(nA).map(conta)), sB = soltosDe(nB);
    const antes = soltosDe(nA).filter(ehMeu).length, depois = sB.filter(ehMeu).length;
    if (!(depois < antes)) return { ok: false, motivo: depois > antes ? 'soltaria pinos que estão ligados' : 'arredar não liga mais pinos (o fio do outro lado não chega a nada)' };
    for (const s of sB) if (!ehMeu(s) && !sA.has(conta(s))) return { ok: false, motivo: 'soltaria ' + s.ref + ' pino ' + s.num };
    if (conflitos(nB) > conflitos(nA)) return { ok: false, motivo: 'juntaria duas nets com nome' };
    const mA = netDoPino(nA), mB = netDoPino(nB);
    /* cada net nova: os pinos dela vêm de UMA net de antes (ou estavam soltos) — senão é curto */
    const porNetB = new Map();
    for (const [p, i] of mB) { if (!porNetB.has(i)) porNetB.set(i, []); porNetB.get(i).push(p); }
    for (const [, ps] of porNetB) {
      const origem = new Set(ps.filter(p => mA.has(p)).map(p => mA.get(p)));
      if (origem.size > 1) return { ok: false, motivo: 'juntaria duas nets (curto)' };
      const meusAqui = ps.filter(p => meus.has(p));
      if (meusAqui.length > 1 && !meusAqui.every(p => mA.has(p))) return { ok: false, motivo: 'fecharia dois pinos do próprio componente' };
    }
    /* o pino ligado antes continua com todos os vizinhos de antes */
    for (const [p, i] of mA) {
      const j = mB.get(p);
      if (j === undefined) return { ok: false, motivo: 'soltaria ' + p };
      const agora = new Set(nB.nets[j].pins || []);
      if (!(nA.nets[i].pins || []).every(q => agora.has(q))) return { ok: false, motivo: 'tiraria ' + p + ' da net ' + nA.nets[i].name };
    }
    return { ok: true, antes, depois };
  }
  const r4 = v => Math.round(v * 1e4) / 1e4;
  const movimentos = [], pulados = [];
  /* as partes e os pontos só mudam quando um movimento é aceito: refeitos só aí (no SHP2, 160 pinos soltos, refazer a
     cada componente custava segundos) */
  let partes = partesComSolto(n0), pts = pontos();
  for (const c of partes.slice()) {
    /* a parte pode já ter sido resolvida por um movimento anterior (outro componente encaixou nela) */
    const ainda = partes.find(x => x.it === c.it);
    if (!ainda) continue;
    const alvos = (pts.get(c.it.sheet) || []).filter(q => q.dono !== c.it);
    const chaves = new Set(alvos.map(q => kp(q.x, q.y)));
    const cand = new Map();
    for (const s of ainda.soltos) for (const q of alvos) {
      const dx = r4(q.x - s.x), dy = r4(q.y - s.y);
      const d = Math.hypot(dx, dy);
      if (d < 0.5 || d > raio) continue;
      const k = kp(dx, dy);
      if (cand.has(k)) continue;
      cand.set(k, { dx, dy, d, enc: ainda.soltos.filter(z => chaves.has(kp(z.x + dx, z.y + dy))).length });
    }
    const ordem = [...cand.values()].sort((a, b) => b.enc - a.enc || a.d - b.d).slice(0, 8);
    const x0 = c.it.x, y0 = c.it.y;
    let aceito = null, motivo = ordem.length ? '' : 'nada para encaixar a até ' + raio + ' mil';
    for (const v of ordem) {
      if (aceito && (v.enc < aceito.v.enc || v.d > aceito.v.d + 0.5)) break;   /* daqui para baixo só o empate interessa */
      /* longe (mais de `perto` mil) só com dois ou mais pinos soltos encaixando no mesmo vetor: um pino só, longe, é
         coincidência (no PESDA o R6 ia andar 148 mil na diagonal para cair na ponta de outro fio) */
      if (v.d > perto && v.enc < 2) { if (!motivo) motivo = 'o encaixe fica a ' + Math.round(v.d) + ' mil (longe para um pino só)'; continue; }
      /* a prova geométrica antes da conta das nets (que é a parte cara): 2 pinos em cima de ponto de ligação */
      const nPinos = ainda.pinos.length;
      if (ainda.pinos.filter(p => chaves.has(kp(p.x + v.dx, p.y + v.dy))).length < Math.min(2, nPinos)) {
        if (!motivo) motivo = 'um pino só encaixando: pode ser coincidência';
        continue;
      }
      c.it.x = r4(x0 + v.dx); c.it.y = r4(y0 + v.dy);
      const n1 = nets();
      let r = confere(ainda, n0, n1);
      /* ENCAIXE EXATO: depois de mover, todo pino ligado do componente cai numa ponta/vértice de fio, rótulo, port,
         power, junção ou pino — como o Altium desenhou. Pino que só liga por deslizar no meio de um fio (o C5 do
         PRJ - DI261930 andando 260 mil com o outro pino escorregando no fio) não é a arredadinha */
      if (r.ok) {
        const soltoDepois = new Set(soltosDe(n1).filter(z => String(z.ref) === String(c.it.ref)).map(z => String(z.num)));
        const ps = hc.compPinsWorld(c.it, L) || [];
        const fora = ps.find(p => !soltoDepois.has(String(p.num)) && !chaves.has(kp(p.x, p.y)));
        /* e a prova do encaixe: 2 pinos (ou todos, no de um pino) em cima de um ponto de ligação. Um pino só encaixando
           num CI cheio de pinos soltos é coincidência (o IC16 da SHP2 andando 18,7 × 4,1 mil para ligar o 37) */
        /* (geométrico: o pino em cima do ponto conta mesmo se a net dele ainda não chega a nada — o R10 do PRJ-DI221694D
           encaixa os dois pinos nas pontas dos fios, e o fio do pino 1 é que não vai a lugar nenhum do outro lado) */
        const ancorados = ps.filter(p => chaves.has(kp(p.x, p.y))).length;
        if (fora) r = { ok: false, motivo: 'o pino ' + fora.num + ' ficaria no meio de um fio' };
        else if (ancorados < Math.min(2, ps.length)) r = { ok: false, motivo: 'um pino só encaixando: pode ser coincidência' };
      }
      c.it.x = x0; c.it.y = y0;
      if (!r.ok) { if (!motivo) motivo = r.motivo; continue; }
      if (aceito) { aceito = null; motivo = 'ambíguo: encaixa para dois lados'; break; }
      aceito = { v, r, n1 };
    }
    if (!aceito) { pulados.push({ ref: c.it.ref, part: c.it.part || 1, sheet: c.it.sheet, motivo: motivo || 'não encaixa' }); continue; }
    c.it.x = r4(x0 + aceito.v.dx); c.it.y = r4(y0 + aceito.v.dy);
    const aindaSolto = new Set(soltosDe(aceito.n1).filter(z => String(z.ref) === String(c.it.ref)).map(z => String(z.num)));
    movimentos.push({ idx: c.idx, ref: c.it.ref, part: c.it.part || 1, sheet: c.it.sheet, dx: aceito.v.dx, dy: aceito.v.dy,
                      liga: ainda.soltos.map(s => String(s.num)).filter(nm => !aindaSolto.has(nm)),
                      soltosAntes: aceito.r.antes, soltosDepois: aceito.r.depois });
    n0 = aceito.n1;
    partes = partesComSolto(n0); pts = pontos();
  }
  const depoisTotal = soltosDe(n0).length;
  if (!o.aplicar) for (const m of movimentos) { const it = items[m.idx]; it.x = r4(it.x - m.dx); it.y = r4(it.y - m.dy); }
  return { movimentos, pulados, soltosAntes: antesTotal, soltosDepois: depoisTotal, tempoMs: Date.now() - t0 };
}

const API = { REGRAS, SEVERIDADE, TITULO, rodar, painel, triangulo, foraDoAlmox, ehNC, ehSoCobre, arrumar };
root.HubSchErc = API;
if (typeof module === 'object' && module.exports) module.exports = API;
})(typeof self !== 'undefined' ? self : this);
