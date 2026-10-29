/* NexoEletric - hub-pcbautorota.js — o Auto-rotear da vista PCB (Route » Auto Route » All, U,A,A).

   Pedido do dono (2026-10-28): "um botão na vista PCB que roda o auto-roteador em lote, como o Auto
   Route » All do Altium". A conta é a do hub-autoroteador.js (várias camadas, vias, ordem e
   arranca-e-refaz, com as regras do projeto — as do DRC); aqui é só a conversa com a pessoa, no tema
   do hub e sem nenhum diálogo do navegador:
     1. o MODAL de pedido: o que rotear (todas as conexões abertas, ou só as nets da seleção), a ordem,
        as camadas de sinal que recebem trilha, o custo da via e as passadas de arranca-e-refaz — com
        quantas conexões estão abertas agora;
     2. o PROGRESSO, num cartão no canto (a vista continua respondendo): conexão x de y, a passada, as
        roteadas e as abertas, e o Cancelar. A conta roda num Web Worker (hub-autoroteador-worker.js);
        se o navegador não abrir o worker, em fatias de tempo na própria página (HubAutoRoteador.
        rodaEmFatias), com o mesmo progresso e o mesmo Cancelar;
     3. a PRÉVIA: as trilhas e vias novas desenhadas na placa (a vista pinta) e o resumo — abertas
        antes -> depois, vias, comprimento, as falhas com o motivo e o DRC: as violações NOVAS que as
        rotas criariam, pela mesma conta do pcb_autorotear do MCP. Aplicar escreve as ops como uma
        edição da vista (o Ctrl+Z desfaz; o Salvar/autosave grava o changes.js); Descartar não deixa
        nada. Com violação nova, o Aplicar só vale com a caixa "aplicar mesmo assim" marcada.
   Se a placa mudar entre a prévia e o Aplicar (outra edição, o arquivo recarregado), o Aplicar
   recusa: a prévia foi calculada sobre outra placa.

   HubPcbAutoRota.abre(V) -> o controle {fase, fecha(), cancela(), aplica(forcar), descarta(), resumo()}
   V, o que a vista dá:
     eb()          a placa da TELA (as mudanças assadas, os planos despejados)
     regras()      o conjunto de regras do projeto (null = a folga única de V.cena().clearance)
     cena()        {placa:{lacos, recortes}, clearance} — o que a cena do roteador da vista usa
     textos()      {id: geometria} dos textos de cobre (HubGerber.geometriaTexto)
     camadas()     [{key, rot, cor}] as camadas de sinal da placa
     selNets()     [net] as nets da seleção
     abertas()     {conexoes, nets} do ratsnest da tela agora
     previa(ops)   desenha a prévia (ops) ou apaga (null)
     foto()        o estado das mudanças agora: a mesma foto no Aplicar = a placa não mudou
     aplica(ops)   escreve as ops como edição da vista -> true | false
     toast(t, tipo, ms)
     worker        o endereço do worker; null = em fatias
     escopo        'todas' | 'sel' (o que vem marcado)
   HubPcbAutoRota.atual() -> o controle aberto (ou null): o smoke da vista lê e age por ele. */
var HubPcbAutoRota = (function () {
  'use strict';

  /* NO TEMA DO HUB: os tokens do hub-tema.css (a cor depois da vírgula só vale numa página que não os
     carregou), o desenho do hub-dialog (caixa sem borda com o anel do --shadow-menu, botões
     contornados) */
  const CSS = `
.ar-scrim{position:fixed; inset:0; z-index:8800; display:flex; align-items:center; justify-content:center;
  background:var(--scrim,rgba(11,11,13,.55)); font:13px/1.45 var(--font,"Segoe UI",system-ui,sans-serif); color:var(--text,#e6e6e6);}
.ar-box,.ar-card{background:var(--surface,#232326); color:var(--text,#e6e6e6); border-radius:var(--r-md,8px);
  box-shadow:var(--shadow-menu, 0 0 0 1px #3a3a3a, 0 18px 44px rgba(0,0,0,.6)); font:13px/1.45 var(--font,"Segoe UI",system-ui,sans-serif);}
.ar-box{width:min(470px, 94vw); max-height:92vh; overflow:auto; padding:16px 18px 14px;}
.ar-card{position:fixed; left:14px; bottom:64px; z-index:8700; width:min(380px, 92vw); max-height:70vh; overflow:auto; padding:12px 14px 12px;}
.ar-box h3,.ar-card h3{margin:0 0 6px; font-size:14px; font-weight:600; letter-spacing:-.01em;}
.ar-sub{margin:0 0 10px; color:var(--text-2,#a8a8ae); font-size:12px;}
.ar-info{margin:0 0 10px; padding:7px 9px; border-radius:var(--r-sm,4px); background:var(--surface-2,#1b1b1e);}
.ar-info b{font-variant-numeric:tabular-nums;}
.ar-grupo{border:1px solid var(--edge,#34343a); border-radius:var(--r-sm,4px); margin:0 0 10px; padding:6px 10px 8px;}
.ar-grupo legend{color:var(--text-3,#8a8a90); font-size:11px; padding:0 4px;}
.ar-grupo label{display:flex; align-items:center; gap:7px; margin:3px 0; cursor:pointer;}
.ar-grupo label.off{color:var(--text-4,#5c5c62); cursor:default;}
.ar-camadas{display:flex; flex-wrap:wrap; gap:4px 14px;}
.ar-cor{display:inline-block; width:10px; height:10px; border-radius:2px;}
.ar-linha{display:flex; align-items:center; gap:10px; margin:0 0 9px;}
.ar-linha label{flex:1; color:var(--text-2,#a8a8ae); font-size:12px;}
.ar-linha select,.ar-linha input{width:190px; background:var(--surface-2,#1b1b1e); color:var(--text,#e6e6e6); border:1px solid var(--edge,#34343a);
  border-radius:var(--r-sm,4px); padding:4px 7px; font:inherit;}
.ar-linha input{width:90px;}
.ar-btns{display:flex; gap:8px; justify-content:flex-end; margin-top:12px;}
.ar-btns button{background:transparent; color:var(--text,#e6e6e6); border:1px solid var(--edge,#3a3a3a); border-radius:var(--r-sm,4px);
  padding:6px 14px; font:inherit; font-size:12px; cursor:pointer; min-width:84px;}
.ar-btns button:hover:not(:disabled){background:rgba(var(--tint,255,255,255),.07);}
.ar-btns button.ok{color:var(--hi,#d8d8dd); border-color:var(--hi,#d8d8dd);}
.ar-btns button.ok.danger{color:var(--err,#e0555a); border-color:var(--err,#e0555a);}
.ar-btns button:disabled{opacity:.4; cursor:default;}
.ar-btns button:focus-visible,.ar-linha select:focus-visible,.ar-linha input:focus-visible{outline:2px solid var(--hi,#d8d8dd); outline-offset:1px;}
.ar-barra{height:6px; border-radius:3px; background:var(--surface-2,#1b1b1e); overflow:hidden; margin:8px 0 6px;}
.ar-barra i{display:block; height:100%; width:0; background:var(--hi,#d8d8dd); transition:width .15s;}
.ar-prog{margin:0; font-variant-numeric:tabular-nums;}
.ar-modo{margin:4px 0 0; color:var(--text-3,#8a8a90); font-size:11px;}
.ar-dl{display:grid; grid-template-columns:auto 1fr; gap:2px 12px; margin:4px 0 8px;}
.ar-dl dt{color:var(--text-3,#8a8a90);} .ar-dl dd{margin:0; font-variant-numeric:tabular-nums;}
.ar-drc{margin:6px 0; padding:6px 9px; border-radius:var(--r-sm,4px); border-left:3px solid var(--ok,#4bbf7b); background:var(--surface-2,#1b1b1e);}
.ar-drc.err{border-left-color:var(--err,#e0555a);}
.ar-drc ul,.ar-falhas ul{margin:4px 0 0; padding-left:16px; font-size:11.5px; color:var(--text-2,#a8a8ae);}
.ar-falhas{margin:6px 0;} .ar-falhas summary{cursor:pointer; color:var(--warn,#d6a75a);}
.ar-forcar{display:flex; align-items:center; gap:7px; margin:8px 0 0; color:var(--err,#e0555a); font-size:12px;}
`;
  const MOTIVO = {
    'camada-proibida': 'a Routing Layers não deixa a camada da ponta',
    'partida-bloqueada': 'a ponta não cabe nem com a largura mínima da regra',
    'chegada-bloqueada': 'a ponta não cabe nem com a largura mínima da regra',
    'sem-caminho': 'sem caminho, nem contra a placa sozinha',
    'bloqueada': 'fechada pelas outras rotas do lote',
    'orcamento': 'estourou o orçamento da busca',
    'tempo': 'acabou o tempo do lote',
  };
  const ORDENS = [['curta', 'a mais curta primeiro'], ['longa', 'a mais longa primeiro'], ['classe', 'por classe (a regra mais pesada primeiro)']];
  let estilo = false, atual = null;

  const nf = (v, casas) => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: casas == null ? 1 : casas });
  function el(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function botao(txt, cls, fn) { const b = el('button', cls || null, txt); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function poeEstilo() { if (estilo) return; estilo = true; const s = el('style'); s.textContent = CSS; document.head.appendChild(s); }

  function abre(V) {
    if (atual) atual.fecha();
    poeEstilo();
    const C = { fase: 'pedido', V, ops: null, r: null, drc: null, foto: null, modo: '', worker: null, cancelado: false, progresso: null };
    let scrim = null, card = null, tecla = null;
    const tira = () => {
      if (tecla) { document.removeEventListener('keydown', tecla, true); tecla = null; }
      if (scrim) { scrim.remove(); scrim = null; }
      if (card) { card.remove(); card = null; }
    };
    C.fecha = () => {
      if (C.worker) { try { C.worker.terminate(); } catch (e) { /* já foi */ } C.worker = null; }
      C.cancelado = true;
      if (C.fase === 'previa') V.previa(null);
      tira();
      C.fase = 'fechado';
      if (atual === C) atual = null;
    };

    /* ---------- 1. o pedido ---------- */
    const ab = V.abertas() || { conexoes: 0, nets: 0 };
    const sel = (V.selNets() || []).filter(Boolean);
    const cams = V.camadas() || [];
    scrim = el('div', 'ar-scrim');
    const box = el('div', 'ar-box');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'ar-tit');
    const h = el('h3', null, 'Auto-rotear'); h.id = 'ar-tit';
    box.append(h, el('p', 'ar-sub', 'Route › Auto Route › All — liga as conexões abertas em várias camadas, trocando de camada por via, ' +
      'pelas regras do projeto (as mesmas do DRC). Nada muda na placa até você aplicar a prévia.'));
    const info = el('div', 'ar-info');
    info.append('Conexões abertas agora: ', el('b', null, nf(ab.conexoes, 0)), ' em ' + nf(ab.nets, 0) + ' net' + (ab.nets === 1 ? '' : 's'));
    box.append(info);
    /* o que rotear */
    const gEsc = el('fieldset', 'ar-grupo'); gEsc.append(el('legend', null, 'O que rotear'));
    const radio = (v, txt, off) => {
      const l = el('label', off ? 'off' : null), i = el('input'); i.type = 'radio'; i.name = 'ar-esc'; i.value = v; i.disabled = !!off;
      l.append(i, txt); gEsc.append(l); return i;
    };
    const rTodas = radio('todas', 'Todas as conexões abertas (' + nf(ab.conexoes, 0) + ')');
    const rSel = radio('sel', sel.length ? 'Só as nets da seleção (' + sel.length + ': ' + sel.slice(0, 4).join(', ') + (sel.length > 4 ? '…' : '') + ')'
                                        : 'Só as nets da seleção (selecione pads, trilhas ou componentes antes)', !sel.length);
    (V.escopo === 'sel' && sel.length ? rSel : rTodas).checked = true;
    box.append(gEsc);
    /* a ordem */
    const lOrd = el('div', 'ar-linha'), labO = el('label', null, 'Ordem'), sOrd = el('select');
    labO.htmlFor = sOrd.id = 'ar-ordem';
    for (const [v, t] of ORDENS) { const o = el('option', null, t); o.value = v; sOrd.append(o); }
    lOrd.append(labO, sOrd); box.append(lOrd);
    /* as camadas */
    const gCam = el('fieldset', 'ar-grupo'); gCam.append(el('legend', null, 'Camadas que recebem trilha'));
    const caixaC = el('div', 'ar-camadas'), chks = [];
    for (const c of cams) {
      const l = el('label'), i = el('input'), cor = el('span', 'ar-cor');
      i.type = 'checkbox'; i.checked = true; i.value = c.key; cor.style.background = c.cor || '#888';
      l.append(i, cor, c.rot || c.key); caixaC.append(l); chks.push(i);
    }
    gCam.append(caixaC); box.append(gCam);
    /* custo da via e passadas */
    const numero = (txt, id, v, min, max, passo) => {
      const l = el('div', 'ar-linha'), lab = el('label', null, txt), i = el('input');
      i.type = 'number'; i.id = id; lab.htmlFor = id; i.value = String(v); i.min = String(min); if (max != null) i.max = String(max); i.step = String(passo);
      l.append(lab, i); box.append(l); return i;
    };
    const A = (typeof HubAutoRoteador !== 'undefined') ? HubAutoRoteador : null;
    const iVia = numero('Custo da via (mm de trilha: maior = menos via)', 'ar-via', A ? A.CUSTO_VIA : 3, 0, null, 0.5);
    const iPas = numero('Passadas de arranca-e-refaz', 'ar-passes', A ? A.PASSES : 4, 0, 10, 1);
    const bCancel = botao('Cancelar', null, () => C.fecha());
    const bRota = botao('Rotear', 'ok', () => comeca());
    const btns = el('div', 'ar-btns'); btns.append(bCancel, bRota); box.append(btns);
    scrim.append(box);
    scrim.addEventListener('mousedown', e => { if (e.target === scrim) C.fecha(); });
    /* na captura do document: os atalhos da vista não disparam com o pedido aberto */
    tecla = e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); C.fecha(); }
      else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); comeca(); }
    };
    document.addEventListener('keydown', tecla, true);
    document.body.append(scrim);
    (ab.conexoes ? bRota : bCancel).focus();
    if (!ab.conexoes) { bRota.disabled = true; info.append(' — nada a ligar'); }

    C.pedido = () => ({
      escopo: rSel.checked ? 'sel' : 'todas', ordem: sOrd.value, camadas: chks.filter(c => c.checked).map(c => c.value),
      custoVia: Math.max(0, parseFloat(String(iVia.value).replace(',', '.')) || 0), passes: Math.max(0, Math.min(10, parseInt(iPas.value, 10) || 0)),
    });
    /* o smoke e quem mais quiser: preenche o pedido sem clicar */
    C.preenche = p => {
      if (!p) return;
      if (p.escopo === 'sel' && !rSel.disabled) rSel.checked = true; else if (p.escopo === 'todas') rTodas.checked = true;
      if (p.ordem) sOrd.value = p.ordem;
      if (Array.isArray(p.camadas)) for (const c of chks) c.checked = p.camadas.includes(c.value);
      if (p.custoVia != null) iVia.value = String(p.custoVia);
      if (p.passes != null) iPas.value = String(p.passes);
    };

    /* ---------- 2. o progresso ---------- */
    let pBar = null, pTxt = null, pModo = null;
    function cartao(titulo) {
      if (card) card.remove();
      card = el('div', 'ar-card'); card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', titulo);
      card.append(el('h3', null, titulo));
      document.body.append(card);
      return card;
    }
    function mostraProgresso(p) {
      C.progresso = p;
      if (!pBar) return;
      let f = 0, t = '';
      const seg = ' · ' + nf((p.ms || 0) / 1000, 1) + ' s';
      if (p.fase === 'rota') { f = p.total ? 0.85 * p.feitas / p.total : 0; t = 'conexão ' + nf(p.feitas, 0) + ' de ' + nf(p.total, 0) + ' · ' + nf(p.roteadas, 0) + ' roteadas, ' + nf(p.falhas, 0) + ' abertas' + seg; }
      else if (p.fase === 'conserto') { f = 0.85 + 0.1 * (p.total ? p.feitas / p.total : 0); t = 'arranca-e-refaz, passada ' + p.passe + ': ' + nf(p.feitas, 0) + ' de ' + nf(p.total, 0) + ' · ' + nf(p.falhas, 0) + ' abertas' + seg; }
      else if (p.fase === 'drc') { f = 0.97; t = 'conferindo o DRC (as violações novas)…'; }
      pBar.style.width = Math.round(100 * Math.min(1, f)) + '%';
      pTxt.textContent = t;
    }
    function comeca() {
      if (C.fase !== 'pedido' || bRota.disabled) return;
      const p = C.pedido();
      if (!p.camadas.length) { V.toast('marque ao menos uma camada que recebe trilha', 'warn'); return; }
      const nets = p.escopo === 'sel' ? sel : null;
      tira();
      C.fase = 'rodando';
      C.foto = V.foto();
      const c = cartao('Auto-rotear — roteando…');
      pBar = el('i'); const barra = el('div', 'ar-barra'); barra.append(pBar);
      pTxt = el('p', 'ar-prog', 'preparando a placa…'); pModo = el('p', 'ar-modo', '');
      const bc = el('div', 'ar-btns'); bc.append(botao('Cancelar', null, () => cancela()));
      c.append(barra, pTxt, pModo, bc);
      const cn = V.cena() || {};
      const msg = { tipo: 'roda', id: Date.now(), eb: V.eb(), regras: V.regras() || null, clearance: cn.clearance, placa: cn.placa || null, textos: V.textos() || {},
                    opcoes: { nets, camadas: p.camadas, ordem: p.ordem, passes: p.passes, custoVia: p.custoVia, note: 'auto-rotear da vista' } };
      C.pedidoFeito = p;
      if (V.worker && typeof Worker !== 'undefined') emWorker(msg);
      else emFatias(msg, 'em fatias na própria página (sem worker)');
    }
    function emWorker(msg) {
      let w = null;
      try { w = new Worker(V.worker); }
      catch (e) { emFatias(msg, 'em fatias na própria página (o worker não abriu: ' + (e && e.message || e) + ')'); return; }
      C.worker = w; C.modo = 'worker';
      pModo.textContent = 'em segundo plano (Web Worker): a vista continua respondendo';
      let andou = false;
      w.onmessage = ev => {
        const m = ev.data || {};
        if (C.fase !== 'rodando' || m.id !== msg.id) return;
        if (m.tipo === 'progresso') { andou = true; mostraProgresso(m); }
        else if (m.tipo === 'fim') { C.worker = null; w.terminate(); terminou(m.r, m.drc); }
        else if (m.tipo === 'erro') { C.worker = null; w.terminate(); falhou(m.msg); }
      };
      w.onerror = ev => {
        if (C.fase !== 'rodando') return;
        try { ev.preventDefault(); } catch (e) { /* nada */ }
        C.worker = null; try { w.terminate(); } catch (e) { /* já foi */ }
        /* o worker que nem começou (arquivo que não carregou): a mesma conta em fatias */
        if (!andou) emFatias(msg, 'em fatias na própria página (o worker não carregou)');
        else falhou(ev && ev.message || 'o worker parou');
      };
      w.postMessage(msg);
    }
    function emFatias(msg, porque) {
      C.modo = 'fatias';
      if (pModo) pModo.textContent = porque;
      const R = typeof HubRoteador !== 'undefined' ? HubRoteador : null, A2 = typeof HubAutoRoteador !== 'undefined' ? HubAutoRoteador : null;
      const W = typeof HubAutoRoteadorWorker !== 'undefined' ? HubAutoRoteadorWorker : null;
      if (!R || !A2) { falhou('o roteador (hub-roteador.js / hub-autoroteador.js) não carregou nesta página'); return; }
      let g;
      const tg = W ? W.textoGeoDe(msg.textos) : undefined;
      try {
        const oc = { placa: msg.placa || undefined, textoGeo: tg };
        if (msg.regras) oc.regras = msg.regras; else if (msg.clearance > 0) oc.clearance = msg.clearance;
        const cena = R.cena(msg.eb, oc);
        g = A2.lote(msg.eb, Object.assign({}, msg.opcoes, { cena, roteador: R }));
      } catch (e) { falhou(String(e && e.message || e)); return; }
      A2.rodaEmFatias(g, { fatiaMs: 40, aoProgresso: mostraProgresso, cancelado: () => C.cancelado }).then(res => {
        if (C.fase !== 'rodando') return;
        if (!res.ok) { if (res.erro) falhou(res.erro); return; }
        mostraProgresso({ fase: 'drc' });
        /* o DRC depois que a página pintou o "conferindo" */
        setTimeout(() => {
          if (C.fase !== 'rodando') return;
          let drc = null;
          try { drc = W ? W.comparaDrc(msg.eb, res.valor.ops, msg.regras, tg) : null; } catch (e) { drc = null; }
          terminou(res.valor, drc);
        }, 30);
      });
    }
    function cancela() {
      if (C.fase !== 'rodando') return;
      C.fecha();
      V.toast('auto-rotear cancelado — a placa não mudou', 'info', 2600);
    }
    function falhou(m) {
      C.fecha();
      V.toast('auto-rotear: ' + m, 'err');
    }
    C.cancela = cancela;

    /* ---------- 3. a prévia ---------- */
    function terminou(r, drc) {
      C.r = r; C.drc = drc; C.ops = (r && r.ops) || [];
      C.fase = 'previa';
      V.previa(C.ops.length ? C.ops : null);
      const c = cartao(C.ops.length ? 'Prévia do auto-rotear' : 'Auto-rotear: nada roteado');
      const dl = el('dl', 'ar-dl');
      const item = (k, v) => { dl.append(el('dt', null, k), el('dd', null, v)); };
      const nTr = C.ops.filter(o => o.op === 'track_add').length;
      item('Conexões abertas', nf(r.antes.conexoes, 0) + ' → ' + nf(r.depois.conexoes, 0) +
        (r.alvo.conexoes !== r.antes.conexoes ? ' (das pedidas: ' + nf(r.alvo.conexoes, 0) + ' → ' + nf(r.depois.doAlvo, 0) + ')' : ''));
      item('Roteadas', nf(r.roteadas, 0) + ' de ' + nf(r.alvo.conexoes, 0));
      item('Trilhas / vias', nf(nTr, 0) + ' trechos · ' + nf(r.vias, 0) + ' vias');
      item('Comprimento', nf(r.comprimento, 1) + ' mm');
      item('Tempo', nf(r.ms / 1000, 1) + ' s · ' + r.passes + ' passada(s) · ' + r.arrancadas + ' arrancada(s)' + (C.modo === 'fatias' ? ' · em fatias' : ''));
      c.append(dl);
      /* o DRC: as violações novas */
      const bloqueia = !!(drc && drc.nNovas);
      const d = el('div', 'ar-drc' + (bloqueia ? ' err' : ''));
      if (!drc) d.textContent = 'DRC: não conferido (o hub-pcbdrc.js não carregou)';
      else if (!drc.nNovas) d.textContent = 'DRC: nenhuma violação nova (' + nf(drc.antes, 0) + ' → ' + nf(drc.depois, 0) + ' na placa inteira, com a net não roteada)';
      else {
        d.append(el('b', null, 'DRC: ' + drc.nNovas + ' violação(ões) NOVA(S)'), ' — ' + Object.entries(drc.porTipo || {}).map(([k, n]) => k + ' ' + n).join(', '));
        const ul = el('ul');
        for (const v of (drc.novas || []).slice(0, 6)) ul.append(el('li', null, v.msg));
        d.append(ul);
      }
      c.append(d);
      if (r.falhas && r.falhas.length) {
        const det = el('details', 'ar-falhas'), sm = el('summary', null, r.falhas.length + ' conexão(ões) não fecharam');
        const ul = el('ul');
        for (const f of r.falhas.slice(0, 12)) ul.append(el('li', null, f.net + ': ' + txt(f.de) + ' → ' + txt(f.para) + ' (' + (MOTIVO[f.motivo] || f.motivo) + ')'));
        if (r.falhas.length > 12) ul.append(el('li', null, '… e mais ' + (r.falhas.length - 12)));
        det.append(sm, ul); c.append(det);
      }
      let forcar = null;
      if (bloqueia && C.ops.length) {
        const l = el('label', 'ar-forcar'); forcar = el('input'); forcar.type = 'checkbox';
        l.append(forcar, 'Aplicar mesmo com as violações novas'); c.append(l);
      }
      const bb = el('div', 'ar-btns');
      if (C.ops.length) {
        const bDesc = botao('Descartar', null, () => C.descarta());
        const bApl = botao('Aplicar', 'ok' + (bloqueia ? ' danger' : ''), () => C.aplica(forcar ? forcar.checked : false));
        if (forcar) { bApl.disabled = true; forcar.addEventListener('change', () => { bApl.disabled = !forcar.checked; }); }
        bb.append(bDesc, bApl);
      } else bb.append(botao('Fechar', 'ok', () => C.fecha()));
      c.append(bb);
    }
    const txt = v => Array.isArray(v) ? '(' + v.map(x => nf(x, 3)).join('; ') + ')' : String(v);
    C.aplica = forcar => {
      if (C.fase !== 'previa' || !C.ops || !C.ops.length) return false;
      if (C.drc && C.drc.nNovas && !forcar) { V.toast('a prévia cria ' + C.drc.nNovas + ' violação(ões) nova(s) de DRC: marque "aplicar mesmo assim" para aplicar', 'warn'); return false; }
      if (V.foto() !== C.foto) {
        V.toast('a placa mudou depois da prévia — rode o auto-rotear de novo', 'warn', 5000);
        C.fecha();
        return false;
      }
      const ops = C.ops, nT = ops.filter(o => o.op === 'track_add').length, nV = ops.length - nT;
      V.previa(null);
      C.fase = 'aplicando';
      const ok = V.aplica(ops);
      C.fecha();
      if (ok) V.toast('auto-rotear aplicado: ' + nT + ' trecho(s) de trilha e ' + nV + ' via(s) — Ctrl+Z desfaz', 'ok', 4000);
      else V.toast('auto-rotear: a vista não aceitou as mudanças (edição travada?)', 'err');
      return ok;
    };
    C.descarta = () => {
      if (C.fase !== 'previa') return;
      C.fecha();
      V.toast('prévia descartada — a placa não mudou', 'info', 2200);
    };
    C.resumo = () => ({ fase: C.fase, modo: C.modo, ops: C.ops ? C.ops.length : 0, r: C.r ? { antes: C.r.antes, depois: C.r.depois, alvo: C.r.alvo, vias: C.r.vias, falhas: C.r.falhas.length } : null,
                        drc: C.drc ? { nNovas: C.drc.nNovas, antes: C.drc.antes, depois: C.drc.depois } : null, progresso: C.progresso });
    atual = C;
    return C;
  }

  return { abre, atual: () => atual };
})();
if (typeof module === 'object' && module.exports) module.exports = HubPcbAutoRota;
