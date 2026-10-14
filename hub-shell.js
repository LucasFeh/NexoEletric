/* hub-shell.js — a casca de "ambiente de CAD" do EletricHUB.

   O que ela acrescenta EM VOLTA do hub, sem mexer no que ele faz:
     - o painel "Projetos" na esquerda: a arvore projeto -> documentos (Esquema, PCB, BOM,
       Neoden, Laser, Historico) e as bibliotecas, com busca -- o jeito de navegar de um
       ambiente de CAD, em vez de so o seletor do cabecalho (que continua la);
     - icone em cada aba de documento, e a aba com cara de aba de editor;
     - a barra de status embaixo: projeto, documento, contagens, estagio e servidor.

   Regra do CLAUDE.md para a casca: o hub.html so ganha a <script src> (e a marca). Toda a
   logica e o CSS moram aqui. A casca LE o estado do hub (S, TABS, TAB_PAI, proj(), t()) e
   chama as mesmas funcoes que os botoes dele chamam (selectProject, goTab, runAction):
   nenhum caminho novo de dado, nenhuma regra nova de negocio.

   Carregado com `defer`: roda depois do script do hub.html, que define aquele estado. */
(function () {
  'use strict';
  if (typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) module.exports = {};
    return;
  }

  /* as preferencias da casca ficam junto das do hub (mesmo prefixo de localStorage) */
  const LS_DOCK = 'altiumhub.shell.dock';       // '0' = painel Projetos recolhido na faixa
  const LS_DOCK_W = 'altiumhub.shell.dockW';
  const LS_SO_ATUAL = 'altiumhub.shell.soAtual';   // '1' = o painel mostra so o projeto aberto
  const DOCK_MIN = 200, DOCK_MAX = 520, DOCK_PADRAO = 268;
  const FAIXA_W = 34;                            // o painel recolhido: so o cabecalho, em pe

  /* Dentro do app desktop as configuracoes do hub moram no menu Arquivo (main.js), e o botao ⚙
     no canto das abas sai. No navegador (o hub do servidor) nao ha menu Arquivo: la o ⚙ fica,
     senao as configuracoes nao teriam porta nenhuma. */
  const NO_APP = typeof navigator !== 'undefined' && /\bElectron\//.test(navigator.userAgent || '');

  const ler = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const grava = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* sem storage */ } };
  let soAtual = ler(LS_SO_ATUAL) === '1';
  const el = (tag, cls, txt) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  };

  /* ── icones (16 px, traco, cor do texto) ───────────────────────────────────────── */
  const P = {
    grupo: '<path d="M2.5 4.5h4l1.3 1.5h5.7v7h-11z"/><path d="M5 9h6M5 11h4"/>',
    projeto: '<rect x="4" y="4" width="8" height="8" rx="1.2"/><path d="M6.5 2v2M9.5 2v2M6.5 12v2M9.5 12v2M2 6.5h2M2 9.5h2M12 6.5h2M12 9.5h2"/>',
    pasta: '<path d="M2 4.5h4.2l1.4 1.6H14v6.9H2z"/>',
    esquema: '<path d="M3.5 2h6l3 3v9h-9z"/><path d="M9.5 2v3h3"/><path d="M5.5 8h2.5l1-1.5 1 3 .7-1.5h1"/>',
    pcb: '<rect x="2.5" y="2.5" width="11" height="11" rx="1"/><path d="M5 11V8.5h3.5V5H11"/><circle cx="5" cy="11" r="1"/><circle cx="11" cy="5" r="1"/>',
    comp: '<rect x="4.5" y="3" width="7" height="10" rx="1"/><path d="M2.5 5.5h2M2.5 8h2M2.5 10.5h2M11.5 5.5h2M11.5 8h2M11.5 10.5h2"/>',
    nets: '<circle cx="4" cy="4" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="4" r="1.5"/><path d="M5.5 4h5M4 5.5V9a3 3 0 0 0 3 3h3.5"/>',
    bom: '<path d="M6 4h7.5M6 8h7.5M6 12h7.5"/><path d="M2.5 4h1M2.5 8h1M2.5 12h1"/>',
    neoden: '<circle cx="8" cy="8" r="4.5"/><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3"/><circle cx="8" cy="8" r="1"/>',
    laser: '<path d="M8 1.5v5"/><path d="M8 9.5l-4.5 4M8 9.5l4.5 4M8 9.5v5"/><circle cx="8" cy="8" r="1.4"/>',
    hist: '<circle cx="8" cy="8" r="5.8"/><path d="M8 4.8V8l2.2 1.4"/>',
    lib: '<path d="M3 2.5h3v11H3zM7 2.5h3v11H7z"/><path d="M11 3.2l2.6-.6 1 10.8-2.6.6z"/>',
    recarregar: '<path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M13.2 2.5v3h-3"/>',
    recolher: '<path d="M4 6l4 4 4-4"/>',
    recolherEsq: '<path d="M10 4l-4 4 4 4"/>',
    expandirDir: '<path d="M6 4l4 4-4 4"/>',
    fixar: '<path d="M6 2.5h4l-.6 4 2.1 2H4.5l2.1-2z"/><path d="M8 8.5V14"/>',
    menos: '<path d="M3.5 8h9"/>',
    mais: '<path d="M3.5 8h9M8 3.5v9"/>',
    busca: '<circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2l3.3 3.3"/>',
    fecharTodos: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M5.5 8h5"/>',
    lixo: '<path d="M2.5 4.5h11M6 4.5V2.8h4v1.7M4 4.5l.7 9h6.6l.7-9"/><path d="M6.8 7v4.5M9.2 7v4.5"/>',
    config: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M3.6 12.4l1.2-1.2M11.2 4.8l1.2-1.2"/>',
  };
  const ICONE_DA_ABA = { esquema: 'esquema', pcb: 'pcb', comp: 'comp', nets: 'nets', lib: 'lib',
    neoden: 'neoden', laser: 'laser', bom: 'bom', hist: 'hist' };
  function icone(nome, cls) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 16 16');
    s.setAttribute('width', '16'); s.setAttribute('height', '16');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.25'); s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
    s.setAttribute('class', cls || 'eh-ico');
    s.innerHTML = P[nome] || '';
    return s;
  }

  /* ── CSS da casca: so tokens do tema do hub, entao vale para todos os temas ───── */
  const CSS = `
  .eh-seg-linha{display:flex; align-items:center; gap:8px; padding:2px 12px 6px; font:11px var(--font); color:var(--text-2);}
  .eh-seg{display:inline-flex; gap:1px; padding:1px; border-radius:4px; box-shadow:inset 0 0 0 1px var(--edge);}
  .eh-seg button{border:0; background:transparent; color:var(--text-2); font:11px var(--font); padding:2px 7px; border-radius:3px; cursor:pointer;}
  .eh-seg button[aria-pressed="true"]{background:rgba(var(--tint),0.14); color:var(--text);}

body.eh-shell #app {
  grid-template-columns: var(--eh-dock-w, ${DOCK_PADRAO}px) minmax(var(--page-min), 1fr);
  grid-template-rows: auto auto auto 1fr auto;
}
body.eh-shell.eh-dock-recolhido #app { grid-template-columns: ${FAIXA_W}px minmax(var(--page-min), 1fr); }
body.eh-shell #app > header { grid-column: 1 / -1; grid-row: 1; }
body.eh-shell #app > #tabs { grid-column: 2; grid-row: 2; }
body.eh-shell #app > #subtabs { grid-column: 2; grid-row: 3; }
body.eh-shell #app > main { grid-column: 2; grid-row: 4; }
body.eh-shell #app > .eh-dock { grid-column: 1; grid-row: 2 / 5; }
body.eh-shell #app > .eh-status { grid-column: 1 / -1; grid-row: 5; }
/* RECOLHIDO, o painel vira uma faixa: so o cabecalho, em pe, com o chevron em cima. Nao some de
   vez porque e clicando nele que ele volta -- o botao "Paineis" da barra de status, que era a
   outra porta, deixou de existir. */
body.eh-dock-recolhido .eh-dock > :not(.eh-panel-hd) { display: none; }
body.eh-dock-recolhido .eh-panel-hd {
  flex-direction: column; justify-content: flex-start; height: 100%; padding: 9px 0; gap: 10px;
  box-shadow: none;
}
body.eh-dock-recolhido .eh-panel-hd .ttl { margin: 0; writing-mode: vertical-rl; }
body.eh-dock-recolhido .eh-panel-hd .chev { order: -1; }

/* marca: o chip do icone do app na quina, como o logo de um ambiente de CAD */
.brand .brand-logo { align-self: center; opacity: 1; color: var(--hi); margin-right: 1px; }

/* SEM a faixa do cabecalho: o painel Projetos faz o papel do seletor, e o que mais morava
   la foi redistribuido -- estagio e pendencias na barra de status, o chat no canto das abas e
   as configuracoes no menu Arquivo do app (no navegador, no ⚙ ao lado do chat: ver NO_APP). Os
   elementos sao MOVIDOS (mesmos ids), entao o hub continua achando-os. */
body.eh-shell #app > header { display: none; }
body.eh-shell .tabs .aggr { display: none; }
body.eh-shell #app > .eh-topo {
  grid-column: 2; grid-row: 2; justify-self: end; align-self: stretch; z-index: 3;
  display: flex; align-items: center; gap: 4px; padding: 0 10px 0 6px;
}
.eh-topo #chatLanc { display: inline-flex; align-items: center; }
.eh-topo .eh-bt { width: 28px; height: 28px; }
.eh-topo .eh-bt .eh-ico { width: 16px; height: 16px; }

/* abas de documento: cara de aba de editor, com icone */
/* o respiro da direita e a largura do canto (.eh-topo: o chat, e o ⚙ no navegador), medida
   em montar() -- sem ele a ultima aba passa por baixo dos botoes numa janela estreita */
body.eh-shell .tabs {
  gap: 2px; padding: 5px var(--eh-topo-w, 120px) 0 10px; align-items: flex-end;
  background: var(--surface-2); box-shadow: inset 0 -1px 0 var(--line);
}
body.eh-shell .tab {
  position: relative; gap: 7px; padding: 6px 14px 7px 11px; font-size: 12.5px;
  border: 1px solid transparent; border-bottom: 0; border-radius: 6px 6px 0 0;
}
body.eh-shell .tab:hover { background: rgba(var(--tint), 0.05); }
body.eh-shell .tab[aria-selected="true"] {
  background: var(--bg); border-color: var(--line); color: var(--text);
  box-shadow: inset 0 2px 0 var(--hi);
}
body.eh-shell .tab[aria-selected="true"]::after {
  content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 1px; background: var(--bg);
}
.tab .eh-ico { width: 14px; height: 14px; opacity: 0.75; flex: none; }
.tab[aria-selected="true"] .eh-ico { opacity: 1; color: var(--hi); }

/* painel "Projetos" */
.eh-dock {
  position: relative; display: flex; flex-direction: column; min-height: 0; min-width: 0;
  background: var(--surface-2); box-shadow: inset -1px 0 0 var(--line); overflow: hidden;
}
/* o cabecalho E o botao: clicar nele recolhe o painel na faixa, e na faixa clicar abre */
.eh-panel-hd {
  display: flex; align-items: center; gap: 4px; flex: none; width: 100%; height: 38px; padding: 0 8px 0 12px;
  border: 0; font: inherit; font-size: 12px; font-weight: 600; letter-spacing: 0.01em; color: var(--text-2);
  background: var(--surface-3); box-shadow: inset 0 -1px 0 var(--line); text-align: left; cursor: pointer;
}
.eh-panel-hd:hover { color: var(--text); background: rgba(var(--tint), 0.06); }
.eh-panel-hd:focus-visible { outline: 1px solid var(--hi); outline-offset: -1px; }
.eh-panel-hd .ttl { margin-right: auto; }
.eh-panel-hd .chev { width: 14px; height: 14px; flex: none; color: var(--text-3); }
.eh-panel-hd:hover .chev { color: var(--text); }
.eh-bt {
  display: inline-flex; align-items: center; justify-content: center; flex: none;
  width: 24px; height: 24px; padding: 0; border: 0; border-radius: 5px;
  background: transparent; color: var(--text-3); cursor: pointer;
}
.eh-bt:hover { background: rgba(var(--tint), 0.09); color: var(--text); }
.eh-bt .eh-ico { width: 14px; height: 14px; }
.eh-tools { display: flex; align-items: center; gap: 2px; flex: none; padding: 5px 6px;
  box-shadow: inset 0 -1px 0 var(--line); }
.eh-tools .sep { width: 1px; height: 14px; background: var(--line); margin: 0 4px; }
.eh-busca { position: relative; flex: none; padding: 7px 8px; }
.eh-busca .eh-ico { position: absolute; left: 16px; top: 50%; transform: translateY(-50%);
  width: 13px; height: 13px; color: var(--text-4); pointer-events: none; }
.eh-busca input {
  width: 100%; height: 28px; padding: 4px 8px 4px 27px; font-size: 12px; border-radius: 5px;
  background: var(--surface); border: 1px solid var(--line); color: var(--text); caret-color: var(--hi);
}
.eh-busca input:focus { border-color: var(--hi); outline: none; }
.eh-tree { flex: 1; min-height: 0; overflow: auto; padding: 2px 0 10px; font-size: 12.5px; }
.eh-row {
  display: flex; align-items: center; gap: 6px; width: 100%; height: 24px;
  padding: 0 8px 0 calc(6px + var(--n, 0) * 14px); border: 0; background: transparent;
  color: var(--text-2); text-align: left; white-space: nowrap; cursor: pointer; user-select: none;
}
.eh-row:hover { background: rgba(var(--tint), 0.05); color: var(--text); }
.eh-row .nm { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.eh-row .car { width: 12px; height: 12px; flex: none; color: var(--text-4); transition: transform 0.12s; }
.eh-row .car.fechado { transform: rotate(-90deg); }
.eh-row .car.vazio { visibility: hidden; }
.eh-row .eh-ico { width: 15px; height: 15px; flex: none; color: var(--text-3); }
.eh-row.proj .eh-ico { color: var(--hi); opacity: 0.8; }
.eh-row.ativo { background: rgba(var(--tint), 0.10); color: var(--text); }
.eh-row.ativo .eh-ico { opacity: 1; }
.eh-row.doc.aberto { color: var(--text); box-shadow: inset 2px 0 0 var(--hi); background: rgba(var(--tint), 0.06); }
.eh-row.doc.aberto .eh-ico { color: var(--hi); }
.eh-row.off { color: var(--text-4); }
.eh-row.off .eh-ico { color: var(--text-4); }
.eh-row.demo .nm { font-style: italic; }
.eh-row .dot { margin-left: 2px; }
.eh-row .tag-n { margin-left: auto; font-size: 10px; padding: 0 5px; border-radius: 4px;
  color: var(--text-3); background: rgba(var(--tint), 0.07); font-variant-numeric: tabular-nums; }
.eh-row .tag-n.pend { color: var(--warn); background: var(--warn-soft); }
.eh-vazio { padding: 10px 14px; font-size: 12px; color: var(--text-4); }
.eh-panel-tabs {
  display: flex; align-items: stretch; gap: 2px; flex: none; height: 28px; padding: 0 6px;
  background: var(--surface-3); box-shadow: inset 0 1px 0 var(--line);
}
.eh-panel-tabs button {
  border: 0; background: transparent; padding: 0 10px; font-size: 11.5px; color: var(--text-3); cursor: default;
}
.eh-panel-tabs button.on { color: var(--text); box-shadow: inset 0 2px 0 var(--hi); }
.eh-resize { position: absolute; top: 0; right: -3px; width: 7px; height: 100%; cursor: col-resize; z-index: 2; }
.eh-resize:hover, .eh-resize.arrastando { background: rgba(var(--tint), 0.10); }

/* barra de status */
.eh-status {
  display: flex; align-items: center; gap: 12px; height: 25px; padding: 0 8px 0 12px; min-width: 0;
  font-size: 11px; color: var(--text-3); white-space: nowrap; overflow: hidden;
  background: var(--sunken); box-shadow: inset 0 1px 0 var(--line);
}
.eh-status b { color: var(--text-2); font-weight: 500; }
.eh-status .sep { width: 1px; height: 12px; background: var(--line); flex: none; }
.eh-status .num { font-variant-numeric: tabular-nums; }
.eh-status .dir { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.eh-status .srv { display: flex; align-items: center; gap: 6px; }
.eh-status .info { display: flex; align-items: center; gap: 12px; min-width: 0; overflow: hidden; }
.eh-status .pipe { display: flex; align-items: center; gap: 8px; flex: none; }
.eh-status .pipe:empty { display: none; }
.eh-status .pipeline .stage { padding: 1px 7px 1px 6px; font-size: 10.5px; }
.eh-status .pending { font-size: 10.5px; }
.eh-tools .txt {
  display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 8px 0 6px;
  border: 0; border-radius: 5px; background: transparent; color: var(--text-3);
  font-size: 11.5px; cursor: pointer; white-space: nowrap;
}
.eh-tools .txt:hover { background: rgba(var(--tint), 0.09); color: var(--text); }
.eh-tools .txt .eh-ico { width: 14px; height: 14px; }
.eh-menu {
  position: fixed; z-index: 80; min-width: 220px; padding: 5px; border-radius: var(--r-md);
  background: var(--surface); box-shadow: var(--shadow-menu);
}
.eh-menu .it {
  display: flex; align-items: center; gap: 9px; width: 100%; padding: 6px 10px; border: 0;
  border-radius: 5px; background: transparent; color: var(--text); font-size: 12.5px; text-align: left; cursor: pointer;
}
.eh-menu .it:hover { background: rgba(var(--tint), 0.08); }
.eh-menu .ck { width: 14px; flex: none; color: var(--hi); text-align: center; }
.eh-menu .hr { height: 1px; margin: 4px 6px; background: var(--line); }
.eh-menu .it .eh-ico { width: 14px; height: 14px; flex: none; color: var(--text-3); }
.eh-menu .it.perigo, .eh-menu .it.perigo .eh-ico { color: var(--err); }
.eh-menu .it.perigo:hover { background: rgba(224, 85, 90, 0.12); }
.eh-menu .it:disabled { opacity: .45; cursor: default; }
.eh-menu .it:disabled:hover { background: transparent; }
.eh-menu .tit { padding: 4px 10px 6px; font-size: 11px; color: var(--text-3); overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; max-width: 260px; }
`;

  /* ── estado da casca ──────────────────────────────────────────────────────────── */
  // Projetos com a gaveta aberta. Clicar no projeto abre; clicar de novo fecha -- vale
  // tambem para o ativo. A gaveta do ativo so abre sozinha quando o ativo MUDA.
  const abertos = new Set();
  let ultimoAtivo = null;
  let bibliotecasAbertas = true;
  let filtro = '';
  let pendente = null;              // {id, tab, ate}: documento de OUTRO projeto clicado
  let dock, tree, status, busca, stInfo, stSrv;

  const hub = () => typeof S !== 'undefined' && typeof TABS !== 'undefined';
  const tr = (k, fb) => { try { const v = t(k); return v && v !== k ? v : fb; } catch (e) { return fb; } };
  const abaAtual = () => (typeof TAB_PAI !== 'undefined' && TAB_PAI[S.tab]) || S.tab;
  const temPlaca = (p) => Array.isArray(p.stages) && p.stages[1] === 1;

  function documentosDe(p) {
    return TABS.filter((tb) => tb.id !== 'lib').map((tb) => ({
      tab: tb.id,
      nome: tr(tb.key, tb.id),
      icone: ICONE_DA_ABA[tb.id] || 'esquema',
      off: tb.id === 'esquema' ? p.noSchematic
        : (tb.id === 'hist' ? false : !temPlaca(p)),
    }));
  }

  function linha(nivel, cls, conteudo, onclick) {
    const b = el('button', 'eh-row ' + cls);
    b.type = 'button';
    b.style.setProperty('--n', String(nivel));
    for (const c of conteudo) if (c) b.append(c);
    if (onclick) b.onclick = onclick;
    return b;
  }
  function caret(aberto, vazio) {
    const c = icone('recolher', 'car' + (aberto ? '' : ' fechado') + (vazio ? ' vazio' : ''));
    return c;
  }

  function abrirDocumento(p, tab) {
    pendente = null;
    const ativo = typeof proj === 'function' && proj();
    if (ativo && ativo.id === p.id) { goTab(tab); return; }
    pendente = { id: p.id, tab, ate: Date.now() + 15000 };
    abertos.add(p.id);
    selectProject(p.id);             // pergunta, se houver edicao pendente; o hub carrega
  }

  function renderArvore() {
    if (!tree || !hub()) return;
    const ativo = typeof proj === 'function' ? proj() : null;
    const aba = abaAtual();
    const q = filtro.trim().toLowerCase();
    /* "Só o atual" (pedido do dono, 2026-10-14: "mostrar todos os projetos, ou apenas o projeto
       que deseja ... pra não ficar tão poluído"): a busca continua procurando em todos */
    const lista = (S.projects || []).filter((p) => q ? p.name.toLowerCase().includes(q) : (!soAtual || (ativo && ativo.id === p.id)));
    if (soAtual && !q && ativo) abertos.add(ativo.id);
    const frag = document.createDocumentFragment();

    const raiz = linha(0, 'grupo', [caret(true), icone('grupo'), el('span', 'nm', 'Projetos'),
      el('span', 'tag-n', String((S.projects || []).length))]);
    raiz.style.cursor = 'default';
    frag.append(raiz);

    if (!lista.length) {
      frag.append(el('div', 'eh-vazio', q ? 'nenhum projeto com esse nome' : 'nenhum projeto nesta pasta de trabalho'));
    }
    for (const p of lista) {
      const eAtivo = ativo && ativo.id === p.id;
      const aberto = abertos.has(p.id) || Boolean(q);
      const dot = el('span', 'dot dot-sm ' + (p.pending ? 'warn' : 'ok'));
      const extras = [];
      if (p.pending) {
        const n = el('span', 'tag-n pend', String(p.pending));
        n.title = p.pending + ' mudança(s) no changes.js ainda não aplicada(s) no Altium';
        extras.push(n);
      }
      const r = linha(1, 'proj' + (eAtivo ? ' ativo' : '') + (p.demo ? ' demo' : ''),
        [caret(aberto), icone('projeto'), el('span', 'nm', p.name), dot, ...extras]);
      r.title = p.name;
      r.querySelector('.car').addEventListener('click', (e) => {
        e.stopPropagation();
        if (abertos.has(p.id)) abertos.delete(p.id); else abertos.add(p.id);
        renderArvore();
      });
      // primeiro clique abre a gaveta (e abre o projeto, se for outro); o segundo fecha
      r.onclick = () => {
        if (abertos.has(p.id)) { abertos.delete(p.id); renderArvore(); return; }
        abertos.add(p.id);
        if (eAtivo) renderArvore(); else selectProject(p.id);
      };
      r.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        menuDoProjeto(p, Boolean(eAtivo), e.clientX, e.clientY);
      });
      frag.append(r);
      if (!aberto) continue;
      for (const d of documentosDe(p)) {
        const doc = linha(2, 'doc' + (d.off ? ' off' : '') + (eAtivo && aba === d.tab ? ' aberto' : ''),
          [caret(false, true), icone(d.icone), el('span', 'nm', d.nome)],
          () => abrirDocumento(p, d.tab));
        if (d.off) doc.title = d.tab === 'esquema' ? 'este projeto ainda não tem schematic.js' : 'este projeto ainda não tem board.js (rode ExportPcb no Altium)';
        frag.append(doc);
      }
    }

    // Bibliotecas: nao dependem do projeto (a aba Biblioteca do hub)
    const libTab = TABS.find((tb) => tb.id === 'lib');
    if (libTab) {
      const rl = linha(0, 'grupo', [caret(bibliotecasAbertas), icone('pasta'), el('span', 'nm', 'Bibliotecas')],
        () => { bibliotecasAbertas = !bibliotecasAbertas; renderArvore(); });
      frag.append(rl);
      if (bibliotecasAbertas) {
        const cont = typeof libTab.count === 'function' ? libTab.count(S.detail) : '';
        frag.append(linha(1, 'doc' + (aba === 'lib' ? ' aberto' : ''),
          [caret(false, true), icone('lib'), el('span', 'nm', tr(libTab.key, 'Biblioteca')),
            cont !== '' && cont != null ? el('span', 'tag-n', String(cont)) : null],
          () => goTab('lib')));
      }
    }
    tree.replaceChildren(frag);
  }

  function renderStatus() {
    if (!status || !hub()) return;
    const p = typeof proj === 'function' ? proj() : null;
    const aba = abaAtual();
    const tb = TABS.find((x) => x.id === aba);
    const partes = [];
    const item = (rotulo, valor) => {
      const s = el('span');
      if (rotulo) s.append(document.createTextNode(rotulo + ' '));
      s.append(el('b', null, valor));
      return s;
    };
    if (p) {
      partes.push(item('Projeto', p.name));
      if (tb) partes.push(item('Documento', tr(tb.key, tb.id)));
      const st = p.stats || {};
      const cont = el('span', 'num',
        `${st.comps || 0} comps · ${st.nets || 0} nets · ${st.tracks || 0} trilhas · ${st.vias || 0} vias`);
      partes.push(cont);
    } else {
      partes.push(el('span', null, 'nenhum projeto aberto'));
    }
    const frag = document.createDocumentFragment();
    partes.forEach((x, i) => { if (i) frag.append(el('span', 'sep')); frag.append(x); });
    stInfo.replaceChildren(frag);

    const srvDot = document.getElementById('serverDot');
    const srvLbl = document.getElementById('serverLabel');
    stSrv.replaceChildren(el('span', srvDot ? srvDot.className : 'dot dot-sm'), el('span', null, srvLbl ? srvLbl.textContent : ''));
  }

  function iconesDasAbas() {
    const nav = document.getElementById('tabs');
    if (!nav || !hub()) return;
    nav.querySelectorAll('.tab').forEach((b, i) => {
      if (b.querySelector('.eh-ico')) return;
      const tb = TABS[i];
      if (!tb) return;
      b.prepend(icone(ICONE_DA_ABA[tb.id] || 'esquema'));
    });
  }

  function tituloDaJanela() {
    if (!hub()) return;
    const p = typeof proj === 'function' ? proj() : null;
    const tb = TABS.find((x) => x.id === abaAtual());
    document.title = p ? `${p.name} · ${tb ? tr(tb.key, tb.id) : ''} — EletricHUB` : 'EletricHUB';
  }

  function tudo() {
    if (hub() && S.projId && S.projId !== ultimoAtivo) {
      ultimoAtivo = S.projId;
      abertos.add(S.projId);         // projeto recem-aberto: a gaveta dele aparece aberta
    }
    if (pendente && hub()) {
      if (Date.now() > pendente.ate) pendente = null;
      else if (S.projId === pendente.id) { const tab = pendente.tab; pendente = null; goTab(tab); return; }
    }
    iconesDasAbas();
    renderArvore();
    renderStatus();
    tituloDaJanela();
  }
  let agendado = 0;
  const agenda = () => { if (!agendado) agendado = requestAnimationFrame(() => { agendado = 0; tudo(); }); };

  /* ── painel: expandir, recolher, largura ──────────────────────────────────────── */
  let cabecalho = null;
  function dockAberto() { return !document.body.classList.contains('eh-dock-recolhido'); }
  function pintaCabecalho() {
    if (!cabecalho) return;
    const aberto = dockAberto();
    cabecalho.querySelector('.chev').replaceWith(icone(aberto ? 'recolherEsq' : 'expandirDir', 'chev'));
    cabecalho.title = aberto ? 'Recolher o painel Projetos' : 'Expandir o painel Projetos';
    cabecalho.setAttribute('aria-expanded', String(aberto));
  }
  function mostrarDock(sim) {
    fecharMenu();
    document.body.classList.toggle('eh-dock-recolhido', !sim);
    grava(LS_DOCK, sim ? '1' : '0');
    pintaCabecalho();
  }
  function larguraDock(w) {
    const v = Math.max(DOCK_MIN, Math.min(DOCK_MAX, Math.round(w)));
    document.documentElement.style.setProperty('--eh-dock-w', v + 'px');
    return v;
  }

  let menuAberto = null;
  function fecharMenu() {
    if (menuAberto) { menuAberto.remove(); menuAberto = null; }
  }
  // um item de menu: `marca` e o que vai na coluna da esquerda (um ✓ ou um icone)
  function itemDeMenu(m, rotulo, marca, acao, o) {
    const b = el('button', 'it' + (o && o.perigo ? ' perigo' : ''));
    b.type = 'button';
    b.append(typeof marca === 'string' || !marca ? el('span', 'ck', marca || '') : marca, el('span', null, rotulo));
    if (o && o.titulo) b.title = o.titulo;
    if (o && o.off) b.disabled = true;
    else b.onclick = () => { fecharMenu(); acao(); };
    m.append(b);
    return b;
  }
  // Botao direito num projeto da arvore. Excluir usa o mesmo dialogo das Configuracoes do hub
  // (senha mestre conferida no servidor; a pasta vai para Trash\, nao some), agora com o id do
  // projeto clicado -- que pode nao ser o aberto.
  function menuDoProjeto(p, eAtivo, x, y) {
    fecharMenu();
    const m = el('div', 'eh-menu');
    m.append(el('div', 'tit', p.name));
    itemDeMenu(m, eAtivo ? 'Projeto aberto' : 'Abrir o projeto', icone('projeto'), () => {
      abertos.add(p.id);
      selectProject(p.id);
    }, { off: eAtivo });
    itemDeMenu(m, abertos.has(p.id) ? 'Fechar a gaveta' : 'Abrir a gaveta', icone('recolher'), () => {
      if (abertos.has(p.id)) abertos.delete(p.id); else abertos.add(p.id);
      renderArvore();
    });
    m.append(el('div', 'hr'));
    const semServidor = typeof S !== 'undefined' && S.demoMode;
    itemDeMenu(m, 'Excluir projeto…', icone('lixo'), () => openDeleteDialog(p.id), {
      perigo: true,
      off: semServidor || typeof openDeleteDialog !== 'function',
      titulo: semServidor ? 'sem servidor não há o que excluir'
        : 'pede a senha mestre; a pasta vai para Trash\\, na pasta de trabalho',
    });
    document.body.append(m);
    // so da para medir no DOM; encosta nas bordas em vez de vazar
    const r = m.getBoundingClientRect();
    m.style.left = Math.max(6, Math.min(x, window.innerWidth - r.width - 6)) + 'px';
    m.style.top = Math.max(6, Math.min(y, window.innerHeight - r.height - 6)) + 'px';
    menuAberto = m;
  }
  function montar() {
    if (document.body.classList.contains('eh-shell')) return;
    const app = document.getElementById('app');
    if (!app || !hub()) return;

    const style = el('style');
    style.id = 'ehShellCss';
    style.textContent = CSS;
    document.head.append(style);

    // painel Projetos
    dock = el('section', 'eh-dock');
    dock.setAttribute('aria-label', 'Projetos');
    const hd = el('button', 'eh-panel-hd');
    hd.type = 'button';
    hd.append(el('span', 'ttl', 'Projetos'), icone('recolherEsq', 'chev'));
    hd.onclick = () => mostrarDock(!dockAberto());
    cabecalho = hd;

    const tools = el('div', 'eh-tools');
    const ferramenta = (nome, titulo, acao) => {
      const b = el('button', 'eh-bt');
      b.type = 'button'; b.title = titulo;
      b.append(icone(nome));
      b.onclick = acao;
      tools.append(b);
    };
    ferramenta('recarregar', 'Reindexar os projetos da pasta de trabalho', () => {
      if (typeof runAction === 'function') runAction('Rescan');
    });
    tools.append(el('span', 'sep'));
    ferramenta('mais', 'Abrir todos os projetos', () => { (S.projects || []).forEach((p) => abertos.add(p.id)); renderArvore(); });
    const fecharTodos = el('button', 'txt');
    fecharTodos.type = 'button';
    fecharTodos.title = 'Fecha a gaveta de todos os projetos';
    fecharTodos.append(icone('fecharTodos'), document.createTextNode('Fechar todos os projetos'));
    fecharTodos.onclick = () => { abertos.clear(); renderArvore(); };
    tools.append(fecharTodos);
    /* Todos | Só o atual */
    const seg = el('div', 'eh-seg');
    const opSeg = (rot, valor, titulo) => {
      const b = el('button', null, rot);
      b.type = 'button'; b.title = titulo;
      b.setAttribute('aria-pressed', String(soAtual === valor));
      b.onclick = () => {
        soAtual = valor; grava(LS_SO_ATUAL, valor ? '1' : '0');
        seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        renderArvore();
      };
      seg.append(b);
    };
    opSeg('Todos', false, 'Mostra todos os projetos da pasta de trabalho');
    opSeg('Só o atual', true, 'Mostra só o projeto aberto (a busca ainda procura em todos)');
    const linhaSeg = el('div', 'eh-seg-linha');
    linhaSeg.append(el('span', 'rot', 'Mostrar'), seg);

    const bz = el('div', 'eh-busca');
    busca = el('input');
    busca.type = 'text'; busca.placeholder = 'Buscar projeto'; busca.autocomplete = 'off';
    busca.addEventListener('input', () => { filtro = busca.value; renderArvore(); });
    busca.addEventListener('keydown', (e) => { if (e.key === 'Escape') { busca.value = ''; filtro = ''; renderArvore(); } });
    bz.append(icone('busca'), busca);

    tree = el('div', 'eh-tree');
    tree.setAttribute('role', 'tree');

    const tabsDoPainel = el('div', 'eh-panel-tabs');
    const tp = el('button', 'on', 'Projetos');
    tp.type = 'button';
    tabsDoPainel.append(tp);

    const rz = el('div', 'eh-resize');
    rz.title = 'Arraste para mudar a largura · duplo clique volta ao padrão';
    rz.addEventListener('dblclick', () => { grava(LS_DOCK_W, String(DOCK_PADRAO)); larguraDock(DOCK_PADRAO); });
    rz.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      rz.setPointerCapture(e.pointerId);
      rz.classList.add('arrastando');
      const x0 = e.clientX, w0 = dock.getBoundingClientRect().width;
      const mover = (ev) => larguraDock(w0 + ev.clientX - x0);
      const soltar = (ev) => {
        rz.classList.remove('arrastando');
        rz.removeEventListener('pointermove', mover);
        grava(LS_DOCK_W, String(larguraDock(w0 + ev.clientX - x0)));
      };
      rz.addEventListener('pointermove', mover);
      rz.addEventListener('pointerup', soltar, { once: true });
    });

    dock.append(hd, tools, bz, linhaSeg, tree, tabsDoPainel, rz);

    // barra de status: o que muda a cada render (info, servidor) e o que o HUB desenha
    // (estagio e pendencias: renderPipeline escreve em #pipeline/#pending, movidos para ca)
    status = el('footer', 'eh-status');
    status.setAttribute('role', 'status');
    stInfo = el('span', 'info');
    const stPipe = el('span', 'pipe');
    for (const id of ['pipeline', 'pending']) {
      const n = document.getElementById(id);
      if (n) stPipe.append(n);
    }
    const dir = el('span', 'dir');
    stSrv = el('span', 'srv');
    dir.append(stSrv);
    status.append(stInfo, el('span', 'sep'), stPipe, dir);

    // canto direito da fileira das abas: o chat (hub-chat.js ja pos o botao no #chatLanc) e,
    // so no navegador, as configuracoes do hub -- no app elas ficam no menu Arquivo (NO_APP)
    const topo = el('div', 'eh-topo');
    const lanc = document.getElementById('chatLanc');
    if (lanc) topo.append(lanc);
    if (!NO_APP) {
      const cfg = el('button', 'eh-bt');
      cfg.type = 'button';
      cfg.title = 'Configurações do hub (tema, idioma, projeto, Odoo)';
      cfg.append(icone('config'));
      cfg.onclick = () => { if (typeof openConfig === 'function') openConfig(); };
      topo.append(cfg);
    }

    app.append(dock, status, topo);
    const w = parseInt(ler(LS_DOCK_W) || '', 10);
    larguraDock(Number.isFinite(w) ? w : DOCK_PADRAO);
    if (ler(LS_DOCK) === '0') document.body.classList.add('eh-dock-recolhido');
    pintaCabecalho();
    document.body.classList.add('eh-shell');
    // as abas reservam a largura do canto: o botao do chat chega depois (hub-chat.js) e o ⚙
    // existe so no navegador, entao a medida e do que esta la, e acompanha quando muda
    const mede = () => document.documentElement.style.setProperty('--eh-topo-w', (topo.offsetWidth + 12) + 'px');
    if (typeof ResizeObserver === 'function') new ResizeObserver(mede).observe(topo);
    mede();

    // o hub redesenha as abas a cada troca de projeto/aba/indice: e o sinal para a casca
    const obs = new MutationObserver(agenda);
    const tabs = document.getElementById('tabs');
    if (tabs) obs.observe(tabs, { childList: true });
    for (const id of ['projName', 'serverLabel', 'serverDot']) {
      const n = document.getElementById(id);
      if (n) obs.observe(n, { childList: true, characterData: true, subtree: true, attributes: true });
    }
    document.addEventListener('click', (e) => { if (menuAberto && !menuAberto.contains(e.target)) fecharMenu(); });
    document.addEventListener('contextmenu', (e) => { if (menuAberto && !menuAberto.contains(e.target)) fecharMenu(); }, true);
    document.addEventListener('keydown', (e) => { if (menuAberto && e.key === 'Escape') { e.stopPropagation(); fecharMenu(); } }, true);
    tree.addEventListener('scroll', fecharMenu);
    // Ctrl+K abria o seletor do cabecalho, que agora nao aparece: leva para a busca do
    // painel Projetos. Captura na janela, antes do atalho do proprio hub.
    window.addEventListener('keydown', (e) => {
      // com um modal do hub aberto (as Configuracoes, um dialogo) o Ctrl+K e dele: la ele pode
      // ser a tecla que o editor de atalhos esta gravando, e abrir o painel por tras roubaria o foco
      const modal = document.querySelector('#overlay .backdrop, .hat-caixa-fundo');
      if (!modal && (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        e.stopImmediatePropagation();
        mostrarDock(true);
        busca.focus();
        busca.select();
      }
    }, true);
    window.addEventListener('resize', fecharMenu);
    tudo();
  }

  // API para o app desktop (menu Exibir » Painel Projetos) e para testes
  window.EletricShell = {
    alternarProjetos: () => mostrarDock(!dockAberto()),
    // O menu Arquivo do app e nativo: o backdrop do #overlay nao o bloqueia como bloqueia o ⚙.
    // Com um dialogo do hub aberto (uma confirmacao esperando resposta, ou as proprias
    // configuracoes), abrir por cima empilharia dois modais, e o closeOverlay do de cima apagaria
    // o de baixo sem resposta. Fica o que esta aberto. Um menu aberto (so .menu) sai e da lugar.
    configuracoes: () => {
      const ov = document.getElementById('overlay');
      if (ov && ov.querySelector('.dialog, .cfgm')) return;
      if (ov && ov.childElementCount && typeof closeOverlay === 'function') closeOverlay();
      if (typeof openConfig === 'function') openConfig();
    },
    projetosAberto: dockAberto,
    render: tudo,
  };

  // O script do hub define S/TABS antes deste (defer), mas o indice chega depois (fetch):
  // tenta montar ja, e de novo enquanto o hub ainda nao desenhou as abas.
  function tentar(n) {
    if (hub() && document.getElementById('app')) { montar(); return; }
    if (n > 0) setTimeout(() => tentar(n - 1), 100);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => tentar(100));
  else tentar(100);
})();
