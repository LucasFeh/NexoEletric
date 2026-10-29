/* AltiumPCBMirror v2 - hub-placaviva.js — a placa que Laser, Neoden e BOM usam.

   Pedido do dono (2026-10-28): "quando a PCB atualiza, é pra atualizar tudo que puxa a PCB —
   laser, Neoden e BOM, tudo anda junto". Ate aqui os tres liam o board.js CRU (o espelho do
   Altium): o que se mexia na vista PCB (o changes.js) nao chegava neles, e os avisos diziam isso.
   Agora todos usam a placa EFETIVA, a mesma conta da vista PCB (pcbframe.js » recalcula +
   comDespejo) e do MCP (mcp/lib/contexto.js » placaDespejada):
     board.js + changes.js (comp_add com a biblioteca de footprints) -> teardrops refeitos ->
     poligonos do hub despejados.

   Duas metades:
   - PURA (navegador e Node): efetiva({board, changes, HubCore, pcblib, Teardrop, Pour, regras}) -> eb.
     regras = o conjunto do projeto (rules.js): o despejo respeita a folga por classe (Pour.comRegras).
     O app desktop a usa para a BOM publicada no NexoBD (electron/lib/armazem.js).
   - NO HUB (so navegador): instala({...}) guarda a placa do projeto aberto. Com a vista PCB do
     MESMO projeto aberta, vale a placa DELA, ao vivo, inclusive o que ainda nao foi salvo
     (pcbframe.js avisa por window.__hubPcbMudou a cada recalculo); sem ela, a placa sai do
     disco e e refeita quando o hubserver avisa que o projeto mudou.

   HubPlacaViva.instala({ projeto:() => {id, name, board}|null, aoMudar:() => void })
     -> { placa() -> eb (ou o board.js cru enquanto a efetiva e montada; null sem placa),
          pronta() -> bool, recarrega(), deVista(nome, eb) } */
(function (raiz, fabrica) {
  const m = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.HubPlacaViva = m;
})(typeof self !== 'undefined' ? self : this, function () {
"use strict";

const precisaLib = ch => (ch || []).some(c => c && c.op === 'comp_add');

/* ============================== a conta (pura) ============================== */
function efetiva(o) {
  const HC = o && o.HubCore, board = o && o.board;
  if (!HC || !board || typeof HC.applyPcbChanges !== 'function') return board || null;
  if (o.pcblib && typeof HC.setPcbLib === 'function') HC.setPcbLib(o.pcblib);
  const model = HC.applyPcbChanges(board, o.changes || []);
  let eb = HC.effectiveBoard(board, model);
  /* teardrop orfao sai e o do mesmo par e refeito (pcbframe.js » recalcula) */
  const T = o.Teardrop;
  if (T && typeof T.refaz === 'function') {
    try { const r = T.refaz(eb, board); if (r && r.eb && ((r.removidos || []).length || (r.gerados || []).length)) eb = r.eb; }
    catch (e) { /* sem teardrop refeito: a placa continua valendo */ }
  }
  /* os poligonos do hub despejados um a um, na ordem; sai so o despejo velho DELES (comDespejo) */
  const P = o.Pour;
  const pols = (eb.polygons || []).filter(q => q && q.id && q.pour !== 'none' && Array.isArray(q.pts) && q.pts.length >= 3);
  if (P && typeof P.despeja === 'function' && pols.length) {
    try {
      const ids = new Set(pols.map(q => String(q.id)));
      let novas = [];
      const ebR = o.regras && typeof P.comRegras === 'function' ? P.comRegras(eb, o.regras) : eb;
      const polsR = (ebR.polygons || []).filter(q => q && ids.has(String(q.id)) && q.pour !== 'none' && Array.isArray(q.pts) && q.pts.length >= 3);
      for (const pol of polsR.slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0))) {
        const d = P.despeja(ebR, pol);
        const reg = (d && (d.regioes || d)) || [];
        if (Array.isArray(reg)) novas = novas.concat(reg);
      }
      const out = Object.assign({}, eb);
      out.regions = (eb.regions || []).filter(g => !(g && g.poly && g.de != null && ids.has(String(g.de))))
        .concat(novas.map((g, i) => {
          const r = { id: 'q:' + g.de + ':' + i, layer: g.layer, net: g.net, points: g.pts || g.points, poly: true, de: g.de };
          if (g.holes && g.holes.length) r.holes = g.holes;
          return r;
        }));
      eb = out;
    } catch (e) { /* sem despejo: fica o cobre como veio */ }
  }
  return eb;
}

/* A BOM pede ao hubserver a placa com os dados de compra do esquema mais novo (comment e
   footprint por ref: hubserver.py » _bom_source). Sobre a efetiva, vale o do esquema so onde a PCB
   nao mexeu: o componente que o changes.js mudou (comp_attr, comp_add) fica como a PCB diz. */
function mesclaEsquema(eb, cru, servidor) {
  if (!eb || !servidor || !Array.isArray(servidor.components)) return eb || servidor || null;
  const doCru = new Map(((cru && cru.components) || []).map(c => [c && c.ref, c]));
  const doSrv = new Map(servidor.components.map(c => [c && c.ref, c]));
  const out = Object.assign({}, eb);
  out.components = (eb.components || []).map(c => {
    const s = c && doSrv.get(c.ref), r = c && doCru.get(c.ref);
    if (!s || !r) return c;
    let n = c;
    for (const k of ['comment', 'footprint']) {
      if (s[k] !== r[k] && c[k] === r[k]) { if (n === c) n = Object.assign({}, c); n[k] = s[k]; }
    }
    return n;
  });
  return out;
}

/* o changes.js e "var changes = [ ... ];" com comentarios: o mesmo arquivo que a vista carrega */
function leChanges(texto) {
  if (!texto) return [];
  try { const v = new Function(texto + '\n;return typeof changes !== "undefined" ? changes : [];')(); return Array.isArray(v) ? v : []; }
  catch (e) { return []; }
}

/* ============================== no hub (navegador) ============================== */
function carregaScript(src) {
  return new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => ok(); s.onerror = () => falha(new Error('sem ' + src));
    document.head.append(s);
  });
}
/* os modulos da conta entram so quando a primeira placa precisa deles (o hub abre sem eles) */
let modulos = null;
function garanteModulos() {
  if (modulos) return modulos;
  const g = typeof window !== 'undefined' ? window : {};
  const fila = [];
  if (!g.HubPcbNets) fila.push('hub-pcbnets.js');
  if (!g.HubPcbTeardrop) fila.push('hub-pcbteardrop.js');
  if (!g.ClipperLib) fila.push('hub-clipper.js');
  if (!g.HubGerber) fila.push('hub-gerber.js');
  if (!g.HubPcbRegras) fila.push('hub-pcbregras.js');
  if (!g.HubPcbPour) fila.push('hub-pcbpour.js');
  modulos = fila.reduce((p, f) => p.then(() => carregaScript(f).catch(() => null)), Promise.resolve());
  return modulos;
}
/* a biblioteca de footprints, como a vista PCB (carregaLibSePreciso): a do hub na frente da do Altium */
let libs = null;
function garanteLibs() {
  if (libs) return libs;
  const g = window;
  libs = (async () => {
    if (typeof g.pcblib === 'undefined') await carregaScript('Libs/pcblib.js').catch(() => null);
    let hub = null;
    if (g.HubFpLib && typeof g.HubFpLib.carrega === 'function') { try { hub = await g.HubFpLib.carrega(); } catch (e) { hub = null; } }
    const alt = typeof g.pcblib !== 'undefined' ? g.pcblib : null;
    if (hub && hub.footprints && hub.footprints.length && g.HubFpLib.mescla) return g.HubFpLib.mescla(alt, hub);
    return alt;
  })();
  return libs;
}

function instala(op) {
  const g = window;
  let chave = null, eb = null, montando = null, vivo = null, timer = null;
  const avisa = () => { clearTimeout(timer); timer = setTimeout(() => { try { op.aoMudar && op.aoMudar(); } catch (e) { console.warn('placa viva:', e); } }, 250); };
  const atual = () => { const p = op.projeto(); return p && p.board && Array.isArray(p.board.components) ? p : null; };
  const chaveDe = p => p.name + '|' + (p.board.generated || '') + '|' + (p.board.components || []).length;

  async function monta(p, k) {
    try {
      let txt = '';
      try { const r = await fetch('Projects/' + encodeURIComponent(p.name) + '/changes.js?t=' + Date.now(), { cache: 'no-store' }); if (r.ok) txt = await r.text(); } catch (e) {}
      const ch = leChanges(txt);
      await garanteModulos();
      const lib = precisaLib(ch) ? await garanteLibs() : null;
      /* as regras do projeto (as da vista PCB): o rules.js, senao o padrao da casa + board.rules */
      let regras = null;
      const RG = g.HubPcbRegras;
      if (RG && ((p.board.polygons || []).length || ch.some(c => c && c.op === 'poly_add'))) {
        try {
          const r = await fetch('Projects/' + encodeURIComponent(p.name) + '/rules.js?t=' + Date.now(), { cache: 'no-store' });
          regras = r.ok ? RG.ler(await r.text()) : RG.doBoard(p.board);
        } catch (e) { try { regras = RG.doBoard(p.board); } catch (x) { regras = null; } }
      }
      if (chave !== k) return;                       /* trocou de projeto no meio */
      eb = efetiva({ board: p.board, changes: ch, HubCore: g.HubCore, pcblib: lib, Teardrop: g.HubPcbTeardrop, Pour: g.HubPcbPour, regras });
    } catch (e) { console.warn('placa viva:', e); eb = p.board; }
    finally { if (chave === k) { montando = null; avisa(); } }
  }

  function placa() {
    const p = atual();
    if (!p) return null;
    if (vivo && vivo.nome === p.name) return vivo.eb;
    const k = chaveDe(p);
    if (k !== chave) { chave = k; eb = null; montando = monta(p, k); }
    return eb || p.board;
  }
  return {
    placa,
    pronta: () => { const p = atual(); return !!p && ((vivo && vivo.nome === p.name) || (!!eb && chave === chaveDe(p))); },
    /* o disco mudou (o hubserver avisou): a do disco e refeita; a da vista, se houver, continua mandando */
    recarrega() { chave = null; eb = null; libs = null; avisa(); },
    /* a vista PCB recalculou (pcbframe.js » recalcula): a placa dela, com o que ainda nao foi salvo */
    deVista(nome, placaDaVista) {
      if (!placaDaVista) { if (vivo && vivo.nome === nome) { vivo = null; avisa(); } return; }
      vivo = { nome, eb: placaDaVista };
      avisa();
    },
  };
}

return { efetiva, mesclaEsquema, leChanges, precisaLib, instala };
});
