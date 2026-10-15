/* hub-menubar.js — a barra de menus do topo do NexoEletric desktop.

   Pedido do dono (2026-10-14): "a area de file, edit, view precisa ficar no topo da pagina,
   junto com arquivo, exibir, ajuda e fazer uma fusao ... esses menus mudam de acordo com a
   visao, se eu tiver no esquema e uma coisa, se eu for pra pcb e outra, igual e no altium ... o
   menu superior acompanha o design da pagina, modo escuro, modo claro".

   - Os menus do app (o que era o menu nativo do Electron: Arquivo, Exibir, Ajuda) entram no topo
     dos menus File, View e Help do Altium da vista aberta; o "Sair" fica no fim do Arquivo, no
     lugar do Exit do Altium.
   - A vista aberta (o iframe da aba Esquema ou PCB) entrega os menus dela por
     `window.__hubMenus.itens()` (hub-pcbaltium.js); fora delas sobram Arquivo, Exibir e Ajuda.
   - Os nomes seguem o idioma do hub (hub-i18n.js para os itens do app, hub-menutrad.js para os
     do Altium) e as cores, o tema (hub-tema.css): nada de cor fixa aqui.
   - Os comandos do app vao ao processo principal pela ponte `window.eletricApp.menu(id)`
     (electron/ui/preload.js, lista fechada no main.js); sem a ponte (o hub no navegador), so os
     que a pagina mesma resolve.
   Teclado: Alt (solto) + letra ou F10, com as letras do Altium (F File, E Edit, V View...). */
(function () {
  'use strict';
  if (typeof document === 'undefined' || typeof HubPcbAltium === 'undefined') return;

  const T = (k, pad) => (typeof HubI18n !== 'undefined' ? HubI18n.t(k) : pad || k);
  const ponte = () => (typeof window.eletricApp !== 'undefined' && window.eletricApp && typeof window.eletricApp.menu === 'function') ? window.eletricApp : null;

  /* o comando do app: pela ponte; os que a pagina resolve sozinha nao precisam dela */
  function app(id) {
    if (id === 'configHub' && window.EletricShell && EletricShell.configuracoes) { EletricShell.configuracoes(); return; }
    if (id === 'painelProjetos' && window.EletricShell && EletricShell.alternarProjetos) { EletricShell.alternarProjetos(); return; }
    const p = ponte();
    if (p) { p.menu(id); return; }
    if (id === 'recarregar') location.reload();
    else if (id === 'novaJanela') window.open(location.href);
  }
  const it = (id, tecla) => ({ rot:T('mb.' + id), tecla:tecla || '', f:() => app(id) });
  const temPonte = () => !!ponte();
  function menusDoApp() {
    const P = temPonte();
    const file = [it('novaJanela', 'Ctrl+Shift+N')];
    /* o esquema do Altium aberto direto no hub (hub-altiumabrir.js) */
    if (typeof window.__hubAbrirAltium === 'function') file.push({ rot:T('mb.abrirAltium'), tecla:'', f:() => window.__hubAbrirAltium() });
    if (P) file.push('-', it('abrirPasta'), it('importar'), it('nexoSync'));
    file.push('-', it('configHub'));
    if (P) file.push(it('configApp', 'Ctrl+,'));
    const view = [it('recarregar', 'F5')];
    if (P) view.push(it('recarregarSemCache', 'Ctrl+F5'), '-', it('zoomMais', 'Ctrl+='), it('zoomMenos', 'Ctrl+-'), it('zoom0', 'Ctrl+0'));
    view.push('-', it('painelProjetos', 'Ctrl+Alt+P'));
    if (P) view.push('-', it('telaCheia', 'F11'), '-', it('devtools', 'Ctrl+Shift+I'));
    const help = P ? [it('atualizacoes'), '-', it('log'), it('pastaLogs'), '-', it('conectarIA'), it('sobre')] : [it('sobre')];
    return { File:file, View:view, Help:help, sair:P ? it('sair', 'Alt+F4') : null };
  }

  /* a vista aberta: o iframe visivel (Esquema, PCB ou Gerber) que entregou os menus */
  function vistaAberta() {
    const fs = document.querySelectorAll('iframe[data-kind]');
    for (const f of fs) {
      if (!f.offsetParent) continue;
      try { const w = f.contentWindow; if (w && w.__hubMenus && typeof w.__hubMenus.itens === 'function') return { w, kind:f.dataset.kind, menus:w.__hubMenus }; }
      catch (e) { /* outra origem: nao e vista do hub */ }
    }
    return null;
  }

  /* a fusao: os menus da vista, com os do app no topo de File, View e Help */
  function topo() {
    const A = menusDoApp();
    const v = vistaAberta();
    let lista = [];
    if (v) { try { lista = v.menus.itens() || []; } catch (e) { lista = []; } }
    if (!lista.length) {
      lista = [{ ing:'File', letra:'F', filhos:[] }, { ing:'View', letra:'V', filhos:[] }, { ing:'Help', letra:'H', filhos:[] }];
    }
    const nome = { File:'mb.file', View:'mb.view', Help:'mb.help' };
    return lista.map(x => {
      const proprio = A[x.ing];
      const rot = nome[x.ing] ? T(nome[x.ing]) : x.rot;
      if (!proprio) return Object.assign({}, x, { rot });
      let filhos = (x.filhos || []).slice();
      if (x.ing === 'File') {
        /* o Exit do Altium sai: o Sair do app fecha a janela de verdade, no fim do menu */
        const sair = T('mb.sair');
        filhos = filhos.filter(f => f === '-' || !(f.plid === 'PLClient:QuitFromEDAClient' || f.rot === 'Exit' || f.rot === sair));
        while (filhos.length && filhos[filhos.length - 1] === '-') filhos.pop();
      }
      const junto = proprio.concat(filhos.length ? ['-'].concat(filhos) : []);
      if (x.ing === 'File' && A.sair) junto.push('-', A.sair);
      return Object.assign({}, x, { rot, filhos:junto });
    });
  }

  /* a barra: no topo da pagina, acima do cabecalho do hub */
  const CSS = `
  #ehMenubar{position:relative; z-index:60; flex:none; display:flex; align-items:stretch; height:28px; padding:0 6px; gap:0;
    background:var(--surface-2); border-bottom:1px solid var(--edge); font:12.5px var(--font); color:var(--text); user-select:none;}
  #ehMenubar .apb{padding:0 10px; border:0; background:transparent; color:var(--text); cursor:default; font:inherit; border-radius:4px; margin:3px 0;}
  #ehMenubar .apb:hover, #ehMenubar .apb.on{background:rgba(var(--tint),0.10);}
  body.eh-menubar #app{height:calc(100vh - 28px) !important;}
  #ehMenubar .vista{margin-left:auto; align-self:center; font-size:11px; color:var(--text-2); padding:0 8px;}
  `;
  let motor = null, barraEl = null, rotuloVista = null, assinatura = '';
  function assina() {
    const v = vistaAberta();
    const lang = typeof HubI18n !== 'undefined' ? HubI18n.lang : '';
    return [v ? v.kind : '-', v ? (v.w.location && v.w.location.search) : '', lang, (typeof HubMenuTrad !== 'undefined' ? HubMenuTrad.idioma() : '')].join('|');
  }
  function redesenha() {
    if (!motor) return;
    assinatura = assina();
    motor.redesenhaBarra();
    const v = vistaAberta();
    if (rotuloVista) { barraEl.append(rotuloVista); rotuloVista.textContent = v ? (v.kind === 'esquema' ? (typeof HubMenuTrad !== 'undefined' ? HubMenuTrad.t('Schematic') : 'Schematic') : 'PCB') : ''; }
  }
  function montar() {
    if (document.getElementById('ehMenubar')) return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
    barraEl = document.createElement('div');
    barraEl.id = 'ehMenubar';
    document.body.prepend(barraEl);
    document.body.classList.add('eh-menubar');
    rotuloVista = document.createElement('span'); rotuloVista.className = 'vista';
    motor = HubPcbAltium.instala({
      vista:'app', fazAcao:() => {}, teclaDe:() => '', ctx:() => ({}), grades:() => [],
      toast:(t, tipo, ms) => { if (typeof toast === 'function') toast(t, tipo); else if (typeof HubDialog !== 'undefined') HubDialog.toast(t, tipo || 'info', ms); },
    });
    motor.barra(barraEl, topo);
    redesenha();
    /* troca de aba, de projeto, de idioma: a barra acompanha (barato: uma assinatura a cada meio segundo) */
    setInterval(() => { if (!motor.aberto() && assina() !== assinatura) redesenha(); }, 500);
  }

  window.EletricMenubar = {
    vistaPronta() { setTimeout(redesenha, 0); },
    /* Alt+letra ou F10 apertado com o foco dentro da vista (o iframe): a barra daqui abre */
    tecla(e) {
      if (!motor || !motor.tecla(e)) return false;
      /* o foco sai da vista para as setas e o Enter chegarem aqui */
      try { const a = document.activeElement; if (a && a.tagName === 'IFRAME') a.blur(); window.focus(); } catch (er) {}
      return true;
    },
    redesenha,
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar);
  else montar();
})();
