/* hub-shell.js — a casca de "ambiente de CAD" do EletricHUB.

   O que ela acrescenta EM VOLTA do hub, sem mexer no que ele faz:
     - o painel "Projetos" na esquerda: a arvore projeto -> documentos (Esquema, PCB, BOM,
       Neoden, Laser, Historico) e as bibliotecas, com busca -- o jeito de navegar de um
       ambiente de CAD, em vez de so o seletor do cabecalho (que continua la);
     - icone em cada aba de documento, e a aba com cara de aba de editor;
     - a barra de status embaixo: projeto, documento, contagens, servidor e "Paineis".

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
  const LS_DOCK = 'altiumhub.shell.dock';       // '0' = painel Projetos fechado
  const LS_DOCK_W = 'altiumhub.shell.dockW';
  const DOCK_MIN = 200, DOCK_MAX = 520, DOCK_PADRAO = 268;

  const ler = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const grava = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* sem storage */ } };
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
    fechar: '<path d="M4 4l8 8M12 4l-8 8"/>',
    fixar: '<path d="M6 2.5h4l-.6 4 2.1 2H4.5l2.1-2z"/><path d="M8 8.5V14"/>',
    menos: '<path d="M3.5 8h9"/>',
    mais: '<path d="M3.5 8h9M8 3.5v9"/>',
    paineis: '<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M6 3v10"/>',
    busca: '<circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2l3.3 3.3"/>',
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
body.eh-shell #app {
  grid-template-columns: var(--eh-dock-w, ${DOCK_PADRAO}px) minmax(var(--page-min), 1fr);
  grid-template-rows: auto auto auto 1fr auto;
}
body.eh-shell.eh-sem-dock #app { grid-template-columns: 0 minmax(var(--page-min), 1fr); }
body.eh-shell #app > header { grid-column: 1 / -1; grid-row: 1; }
body.eh-shell #app > #tabs { grid-column: 2; grid-row: 2; }
body.eh-shell #app > #subtabs { grid-column: 2; grid-row: 3; }
body.eh-shell #app > main { grid-column: 2; grid-row: 4; }
body.eh-shell #app > .eh-dock { grid-column: 1; grid-row: 2 / 5; }
body.eh-shell #app > .eh-status { grid-column: 1 / -1; grid-row: 5; }
body.eh-shell.eh-sem-dock .eh-dock { display: none; }

/* marca: o chip do icone do app na quina, como o logo de um ambiente de CAD */
.brand .brand-logo { align-self: center; opacity: 1; color: var(--hi); margin-right: 1px; }

/* o servidor e as contagens descem para a barra de status */
body.eh-shell header .server { display: none; }
body.eh-shell .tabs .aggr { display: none; }

/* abas de documento: cara de aba de editor, com icone */
body.eh-shell .tabs {
  gap: 2px; padding: 5px 10px 0; align-items: flex-end;
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
.eh-panel-hd {
  display: flex; align-items: center; gap: 4px; flex: none; height: 30px; padding: 0 6px 0 12px;
  font-size: 12px; font-weight: 600; letter-spacing: 0.01em; color: var(--text-2);
  background: var(--surface-3); box-shadow: inset 0 -1px 0 var(--line);
}
.eh-panel-hd .ttl { margin-right: auto; }
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
.eh-status .pnl {
  display: inline-flex; align-items: center; gap: 5px; height: 19px; padding: 0 9px;
  border: 1px solid var(--line); border-radius: 4px; background: var(--surface);
  color: var(--text-2); font-size: 11px; cursor: pointer;
}
.eh-status .pnl:hover { border-color: rgba(var(--tint), 0.3); color: var(--text); }
.eh-status .pnl .eh-ico { width: 12px; height: 12px; }
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
`;

  /* ── estado da casca ──────────────────────────────────────────────────────────── */
  const abertos = new Set();        // projetos expandidos na arvore (o ativo sempre esta)
  let bibliotecasAbertas = true;
  let filtro = '';
  let pendente = null;              // {id, tab, ate}: documento de OUTRO projeto clicado
  let dock, tree, status, busca;

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
    const lista = (S.projects || []).filter((p) => !q || p.name.toLowerCase().includes(q));
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
      const aberto = eAtivo || abertos.has(p.id) || Boolean(q);
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
      r.onclick = () => { if (!eAtivo) { abertos.add(p.id); selectProject(p.id); } else { abertos.add(p.id); renderArvore(); } };
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
      if (p.pending) partes.push(item('', `${p.pending} mudança(s) pendente(s)`));
    } else {
      partes.push(el('span', null, 'nenhum projeto aberto'));
    }
    const frag = document.createDocumentFragment();
    partes.forEach((x, i) => { if (i) frag.append(el('span', 'sep')); frag.append(x); });

    const dir = el('span', 'dir');
    const srvDot = document.getElementById('serverDot');
    const srvLbl = document.getElementById('serverLabel');
    const srv = el('span', 'srv');
    srv.append(el('span', srvDot ? srvDot.className : 'dot dot-sm'), el('span', null, srvLbl ? srvLbl.textContent : ''));
    const pnl = el('button', 'pnl');
    pnl.type = 'button';
    pnl.append(icone('paineis'), document.createTextNode('Painéis'));
    pnl.onclick = (e) => { e.stopPropagation(); menuPaineis(pnl); };
    dir.append(srv, pnl);
    frag.append(dir);
    status.replaceChildren(frag);
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

  /* ── painel: abrir, fechar, largura ───────────────────────────────────────────── */
  function dockAberto() { return !document.body.classList.contains('eh-sem-dock'); }
  function mostrarDock(sim) {
    document.body.classList.toggle('eh-sem-dock', !sim);
    grava(LS_DOCK, sim ? '1' : '0');
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
  function menuPaineis(ancora) {
    if (menuAberto) { fecharMenu(); return; }
    const m = el('div', 'eh-menu');
    const it = (rotulo, marcado, acao) => {
      const b = el('button', 'it');
      b.type = 'button';
      b.append(el('span', 'ck', marcado ? '✓' : ''), el('span', null, rotulo));
      b.onclick = () => { fecharMenu(); acao(); };
      m.append(b);
    };
    it('Projetos', dockAberto(), () => mostrarDock(!dockAberto()));
    m.append(el('div', 'hr'));
    it('Restaurar a largura do painel', false, () => { grava(LS_DOCK_W, String(DOCK_PADRAO)); larguraDock(DOCK_PADRAO); mostrarDock(true); });
    document.body.append(m);
    const r = ancora.getBoundingClientRect();
    m.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
    m.style.bottom = (window.innerHeight - r.top + 6) + 'px';
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
    const hd = el('div', 'eh-panel-hd');
    hd.append(el('span', 'ttl', 'Projetos'));
    const btFechar = el('button', 'eh-bt');
    btFechar.type = 'button';
    btFechar.title = 'Fechar o painel (reabra em Painéis, na barra de status)';
    btFechar.append(icone('fechar'));
    btFechar.onclick = () => mostrarDock(false);
    hd.append(btFechar);

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
    ferramenta('mais', 'Expandir todos', () => { (S.projects || []).forEach((p) => abertos.add(p.id)); renderArvore(); });
    ferramenta('menos', 'Recolher todos', () => { abertos.clear(); renderArvore(); });

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
    rz.title = 'Arraste para mudar a largura';
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

    dock.append(hd, tools, bz, tree, tabsDoPainel, rz);

    status = el('footer', 'eh-status');
    status.setAttribute('role', 'status');

    app.append(dock, status);
    const w = parseInt(ler(LS_DOCK_W) || '', 10);
    larguraDock(Number.isFinite(w) ? w : DOCK_PADRAO);
    if (ler(LS_DOCK) === '0') document.body.classList.add('eh-sem-dock');
    document.body.classList.add('eh-shell');

    // o hub redesenha as abas a cada troca de projeto/aba/indice: e o sinal para a casca
    const obs = new MutationObserver(agenda);
    const tabs = document.getElementById('tabs');
    if (tabs) obs.observe(tabs, { childList: true });
    for (const id of ['projName', 'serverLabel', 'serverDot']) {
      const n = document.getElementById(id);
      if (n) obs.observe(n, { childList: true, characterData: true, subtree: true, attributes: true });
    }
    document.addEventListener('click', (e) => { if (menuAberto && !menuAberto.contains(e.target)) fecharMenu(); });
    window.addEventListener('resize', fecharMenu);
    tudo();
  }

  // API para o app desktop (menu Exibir » Painel Projetos) e para testes
  window.EletricShell = {
    alternarProjetos: () => mostrarDock(!dockAberto()),
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
