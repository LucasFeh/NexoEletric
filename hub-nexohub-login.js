/* hub-nexohub-login.js — o login do Nexo Hub no NexoEletric desktop (1.83.0).

   Pedido do dono (2026-11-09): "todos os softwares só funcionam logado no Nexo Hub; o login aparece
   no canto superior direito de cada software; e a conexão com o Hub, caso não exista, é feita na
   abertura do software" (contrato do Nexo Hub, §9 Login).

   - O componente é o nexohub-sessao.js, copiado SEM mudança do cliente/ do repositório nexohub: sem
     login, uma tela por cima de tudo pede usuário e senha; logado, o crachá (foto + nome) fica no
     canto superior direito, na ponta direita da barra de menus (hub-menubar.js).
   - Abrir o Hub: a página pede ao motor (o NexoEletric.exe Electron) pela ponte, eletricApp.garantirHub()
     (janela Rust: rust/crates/nexoeletric-web » PONTE; janela Electron: electron/ui/preload.js). O motor
     roda o nexohub-abrir.mjs (abre o NexoHub.exe instalado, oculto, se ele não responde) e devolve
     {ok, url, ...}: a URL do Hub desta máquina (NEXOHUB_URL > conexao.json > 127.0.0.1:47800) vem de lá.
   - Enquanto a tela está aberta, o teclado não chega aos atalhos do hub (as teclas são paradas na fase
     de captura da janela, antes de qualquer outro tratador; o que se digita no formulário continua
     entrando, porque o texto é a ação padrão do navegador, que não é cancelada) e um arquivo solto na
     janela não abre projeto.
   - Só no app desktop: sem a ponte (o hub no navegador, servido pelo servidor da rede) nada acontece.
     As vistas Esquema/PCB dentro do hub ficam debaixo da tela do hub; abertas numa janela à parte (sem
     a ponte, mas abertas pelo hub), usam a ponte de quem as abriu e também pedem o login.
   - O MCP fala direto com o servidor do hub e não passa por aqui: não pede login. */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) module.exports = {};
    return;
  }
  if (window.top !== window) return;   // dentro do hub (iframe da vista): a tela do hub cobre

  const PADRAO = 'http://127.0.0.1:47800';
  function acharPonte() {
    const p = window.eletricApp;
    if (p && typeof p.garantirHub === 'function') return p;
    try {
      const o = window.opener && window.opener.eletricApp;
      if (o && typeof o.garantirHub === 'function') return o;
    } catch (e) { /* quem abriu é de outra origem */ }
    return null;
  }
  const ponte = acharPonte();
  if (!ponte || typeof window.NexoHubSessao === 'undefined') return;

  let ctl = null;
  let urlHub = '';
  const liberado = () => !!(ctl && ctl.liberado);

  /* o teclado: parado na captura da janela, antes dos atalhos do hub (hub-atalhos, menus, vistas) */
  const bloqueia = (e) => { if (!liberado()) e.stopImmediatePropagation(); };
  for (const t of ['keydown', 'keyup', 'keypress']) window.addEventListener(t, bloqueia, true);

  /* o arquivo solto na janela (a casca Rust chama window.__nexoSoltou, do hub-altiumabrir.js) */
  let soltou = window.__nexoSoltou;
  try {
    Object.defineProperty(window, '__nexoSoltou', {
      configurable: true,
      get() { return typeof soltou === 'function' ? function () { return liberado() ? soltou.apply(this, arguments) : undefined; } : soltou; },
      set(f) { soltou = f; },
    });
  } catch (e) { /* sem o guarda: a tela continua por cima */ }

  /* abrir/conferir o Hub pelo motor; a URL dele vem junto */
  let pedido = null;
  function garantirHub() {
    if (!pedido) {
      pedido = Promise.resolve()
        .then(() => ponte.garantirHub())
        .then((r) => { if (r && r.url) urlHub = String(r.url).replace(/\/+$/, ''); return r || { ok: false }; })
        .catch((e) => ({ ok: false, erro: (e && e.message) || String(e) }))
        .finally(() => { pedido = null; });
    }
    return pedido;
  }
  async function url() {
    if (!urlHub) await garantirHub();
    return urlHub || PADRAO;
  }

  /* o lugar do crachá: o canto superior direito, na faixa da barra de menus (28 px). A barra se redesenha
     inteira (hub-pcbaltium.js » redesenhaBarra), então o crachá mora numa caixa fixa por cima da ponta
     dela, e a barra ganha à direita o espaço que ele ocupa (--nh-conta-w). */
  const CSS = '#nexoHubConta{position:fixed;top:0;right:6px;height:28px;z-index:61;display:flex;align-items:center;' +
    '-webkit-app-region:no-drag;pointer-events:auto}' +
    '#ehMenubar,#apMenubar{padding-right:calc(var(--nh-conta-w, 0px) + 14px) !important}';
  function montar() {
    const st = document.createElement('style');
    st.id = 'nexoHubContaCss';
    st.textContent = CSS;
    document.head.appendChild(st);
    const lugar = document.createElement('div');
    lugar.id = 'nexoHubConta';
    document.body.appendChild(lugar);
    const mede = () => document.documentElement.style.setProperty('--nh-conta-w', Math.ceil(lugar.getBoundingClientRect().width) + 'px');
    if (typeof ResizeObserver === 'function') new ResizeObserver(mede).observe(lugar);
    ctl = window.NexoHubSessao.iniciar({
      app: 'nexoeletric',
      nome: 'NexoEletric',
      url,
      lugar,
      garantirHub,
      aoMudar: (e) => {
        mede();
        try { window.dispatchEvent(new CustomEvent('nexohub:sessao', { detail: e })); } catch (x) { /* sem CustomEvent */ }
      },
    });
    /* o crachá do componente tem 30 px e a barra de menus, 28: aqui ele fica com a altura dos botões da barra
       (24 px). Só um acréscimo de estilo dentro da sombra dele; o nexohub-sessao.js continua o do Hub. */
    const sombra = lugar.querySelector('[data-nexohub="cracha"]');
    if (sombra && sombra.shadowRoot) {
      const s2 = document.createElement('style');
      s2.textContent = '.cracha{height:24px;padding:0 8px 0 2px;gap:6px;font-size:12px}.cracha .av{width:20px;height:20px;font-size:9.5px}';
      sombra.shadowRoot.appendChild(s2);
    }
  }
  if (document.body) montar(); else document.addEventListener('DOMContentLoaded', montar, { once: true });

  /* para os testes e para quem quiser saber (o MCP não depende disto) */
  window.NexoEletricLogin = {
    get liberado() { return liberado(); },
    get estado() { return ctl ? ctl.estado : { fase: 'conectando' }; },
    get url() { return urlHub; },
    sair: () => (ctl ? ctl.sair() : Promise.resolve()),
  };
})();
