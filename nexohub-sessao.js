/*
 * Nexo Hub — login nos programas da atmosfera (2.25.0). Script de navegador sem dependências: copie para o seu
 * programa e carregue na janela principal (<script src="nexohub-sessao.js">, ou import/require: exporta o mesmo objeto).
 *
 *   NexoHubSessao.iniciar({
 *     app: "nexocad", nome: "NexoCAD",
 *     url: "http://127.0.0.1:47800",            // ou uma função (async) que devolve a URL do Hub
 *     lugar: document.querySelector("#topo-direita"), // onde vai o crachá do usuário; sem lugar: fixo no canto superior direito
 *     garantirHub: () => window.api.garantirHub(),     // abre o Nexo Hub se estiver fechado (processo principal: nexohub-abrir.mjs)
 *     aoMudar: (estado) => {},                  // {logado, usuario:{id, login, nome, email, admin, foto, iniciais}}
 *   });
 *
 * Regra da atmosfera: o programa só funciona com alguém logado no Nexo Hub. Sem login, uma tela por cima de tudo pede
 * usuário e senha (a conta é a do Nexo Hub; o Hub valida) — ou abre o Hub. Logado, o crachá (foto + nome) fica no canto
 * superior direito; clicar mostra a conta, "Abrir o Nexo Hub" e "Sair". Sair em qualquer programa sai de todos.
 * O Hub fora do ar na abertura: chama garantirHub (abre o Hub) e espera. Caiu depois de logado: o programa segue e o
 * crachá fica apagado; se não voltar em 90 s (a atualização do Hub fecha ele uns segundos), abre de novo.
 * Hub antigo (sem login, GET /api/v1/sessao 404): libera o programa, sem crachá.
 */
(function (raiz) {
  "use strict";
  const PADRAO = "http://127.0.0.1:47800";
  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .fundo { position: fixed; inset: 0; z-index: 2147483000; display: grid; place-items: center; background: radial-gradient(1200px 600px at 50% 0%, rgba(255,122,26,.10), transparent 60%), rgba(6,6,8,.86); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); font: 14px/1.5 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; color: #f4f4f5; -webkit-app-region: no-drag; animation: aparece .25s ease-out; }
  @keyframes aparece { from { opacity: 0; } to { opacity: 1; } }
  @keyframes sobe { from { opacity: 0; transform: translateY(10px) scale(.985); } to { opacity: 1; transform: none; } }
  .cartao { width: min(380px, calc(100vw - 32px)); padding: 28px 28px 22px; border-radius: 18px; border: 1px solid #303036; background: linear-gradient(180deg, #17171b, #101013); box-shadow: 0 40px 100px -30px #000, 0 0 0 1px rgba(255,122,26,.06); animation: sobe .35s cubic-bezier(.2,.8,.2,1); }
  .marca { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; }
  .marca i { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; background: radial-gradient(circle at 50% 30%, #ff9a4a, #ff6a00 60%, #c24a00); box-shadow: 0 0 24px -6px #ff7a1a; }
  .marca i::after { content: ""; width: 12px; height: 12px; border-radius: 50%; border: 2.5px solid #fff; }
  .marca b { font: 700 15px "Segoe UI", sans-serif; letter-spacing: -.2px; }
  .marca span { color: #a1a1aa; font-weight: 400; }
  h1 { font: 650 19px/1.25 "Segoe UI", sans-serif; margin: 0 0 4px; letter-spacing: -.3px; }
  p { margin: 0 0 18px; color: #a1a1aa; font-size: 13px; }
  label.campo { display: block; font: 600 11.5px "Segoe UI", sans-serif; color: #a1a1aa; margin: 0 0 5px; }
  input[type=text], input[type=password] { width: 100%; height: 38px; padding: 0 12px; margin: 0 0 12px; border-radius: 10px; border: 1px solid #303036; background: #08080a; color: #f4f4f5; font: 14px "Segoe UI", sans-serif; outline: none; transition: border-color .2s, box-shadow .2s; }
  input[type=text]:focus, input[type=password]:focus { border-color: #ff7a1a; box-shadow: 0 0 0 3px rgba(255,122,26,.18); }
  .linha { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 2px 0 16px; font-size: 12.5px; color: #a1a1aa; }
  .linha label { display: flex; align-items: center; gap: 7px; cursor: pointer; }
  .linha input { accent-color: #ff7a1a; margin: 0; }
  button { font: 600 13.5px "Segoe UI", sans-serif; cursor: pointer; border-radius: 10px; transition: filter .2s, background .2s, border-color .2s, transform .1s; }
  button:active { transform: translateY(1px); }
  .entrar { width: 100%; height: 40px; border: 0; color: #fff; background: linear-gradient(180deg, #ff8a33, #f06a00); box-shadow: 0 8px 24px -10px #ff7a1a; }
  .entrar:hover { filter: brightness(1.08); }
  .entrar[disabled] { filter: grayscale(.4) brightness(.8); cursor: wait; }
  .link { background: none; border: 0; color: #ff9a4a; padding: 0; font-weight: 500; font-size: 12.5px; }
  .link:hover { text-decoration: underline; }
  .erro { min-height: 18px; margin: 10px 0 0; color: #f87171; font-size: 12.5px; }
  .dica { margin-top: 14px; padding-top: 12px; border-top: 1px solid #232328; color: #63636c; font-size: 12px; }
  .dica b { color: #a1a1aa; font-weight: 600; }
  .giro { width: 30px; height: 30px; margin: 6px auto 14px; border-radius: 50%; border: 3px solid #303036; border-top-color: #ff7a1a; animation: gira .9s linear infinite; }
  @keyframes gira { to { transform: rotate(360deg); } }
  .centro { text-align: center; }
  .centro p { margin-bottom: 14px; }
  .sec { height: 36px; padding: 0 16px; border: 1px solid #303036; background: #1a1a1e; color: #f4f4f5; }
  .sec:hover { border-color: #3a3a42; background: #222227; }

  .cracha { display: inline-flex; align-items: center; gap: 7px; height: 30px; max-width: 220px; padding: 0 9px 0 3px; border-radius: 16px; border: 1px solid rgba(255,255,255,.10); background: rgba(20,20,24,.72); color: #f4f4f5; font: 600 12.5px "Segoe UI", sans-serif; cursor: pointer; -webkit-app-region: no-drag; backdrop-filter: blur(6px); transition: border-color .2s, background .2s; }
  .cracha:hover { border-color: rgba(255,122,26,.55); background: rgba(28,28,33,.9); }
  .cracha .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cracha .sem { opacity: .45; }
  .cracha svg { width: 12px; height: 12px; flex: none; opacity: .6; }
  .cracha.compacto { padding: 0 3px; gap: 0; }
  .cracha.compacto .nm, .cracha.compacto svg { display: none; }
  .cracha.fora .av { filter: grayscale(1); opacity: .55; }
  .av { position: relative; flex: none; width: 24px; height: 24px; border-radius: 50%; overflow: hidden; display: grid; place-items: center; background: linear-gradient(135deg, #ff9a4a, #e85d00); color: #fff; font: 700 10.5px "Segoe UI", sans-serif; letter-spacing: .2px; }
  .av img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .av.g { width: 54px; height: 54px; font-size: 19px; }
  .menu { position: fixed; z-index: 2147483001; width: 270px; padding: 16px; border-radius: 14px; border: 1px solid #303036; background: linear-gradient(180deg, #1a1a1e, #131316); box-shadow: 0 24px 60px -18px #000; color: #f4f4f5; font: 13px/1.45 "Segoe UI", sans-serif; animation: sobe .2s ease-out; -webkit-app-region: no-drag; }
  .menu .topo { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
  .menu .topo b { display: block; font-size: 14px; }
  .menu .topo small { display: block; color: #a1a1aa; font-size: 12px; word-break: break-all; }
  .menu .tag { display: inline-block; margin-top: 3px; padding: 0 7px; border-radius: 8px; font-size: 10.5px; font-weight: 600; color: #ffb27a; border: 1px solid rgba(255,122,26,.4); }
  .menu .estado { font-size: 12px; color: #a1a1aa; margin: 0 0 10px; }
  .menu .estado.fora { color: #fbbf24; }
  .menu .acoes { display: flex; flex-direction: column; gap: 6px; }
  .menu .acoes button { height: 34px; text-align: left; padding: 0 12px; border: 1px solid #303036; background: #131316; color: #f4f4f5; font-weight: 500; }
  .menu .acoes button:hover { border-color: #3a3a42; background: #1f1f24; }
  .menu .acoes .sair { color: #fca5a5; }
  `;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const SETA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

  function iniciar(op = {}) {
    const app = op.app || "programa";
    const nome = op.nome || "este programa";
    let url = PADRAO;
    let estado = { logado: false, usuario: null };
    let fase = "conectando"; // conectando | sem_hub | login | logado | antigo
    let erroHub = "";
    let es = null, tRetomar = null, foraDesde = 0, reabriu = false, fechado = false, enviando = false;

    // ---- elementos (Shadow DOM: o CSS do programa não mexe no login, e vice-versa)
    const hostTela = document.createElement("div");
    hostTela.setAttribute("data-nexohub", "login");
    const telaRaiz = hostTela.attachShadow({ mode: "open" });
    const hostCracha = document.createElement("div");
    hostCracha.setAttribute("data-nexohub", "cracha");
    hostCracha.style.cssText = op.lugar ? "display:inline-flex;align-items:center;-webkit-app-region:no-drag" : `position:fixed;z-index:2147482000;top:${op.topo ?? 10}px;right:${op.direita ?? 12}px;-webkit-app-region:no-drag`;
    const crachaRaiz = hostCracha.attachShadow({ mode: "open" });
    for (const r of [telaRaiz, crachaRaiz]) { const st = document.createElement("style"); st.textContent = CSS; r.appendChild(st); }
    const tela = document.createElement("div");
    telaRaiz.appendChild(tela);
    const cracha = document.createElement("div");
    crachaRaiz.appendChild(cracha);
    let menu = null;

    const montar = () => {
      if (!hostTela.isConnected) document.body.appendChild(hostTela);
      if (!hostCracha.isConnected) (op.lugar || document.body).appendChild(hostCracha);
    };
    if (document.body) montar(); else document.addEventListener("DOMContentLoaded", montar, { once: true });

    const resolverUrl = async () => {
      try { const u = typeof op.url === "function" ? await op.url() : op.url; if (u) url = String(u).replace(/\/+$/, ""); } catch { /* fica a padrão */ }
      return url;
    };
    const pedir = async (metodo, caminho, corpo) => {
      const r = await fetch(url + caminho, { method: metodo, headers: { "X-App": app, ...(corpo ? { "Content-Type": "application/json" } : {}) }, body: corpo ? JSON.stringify({ app, ...corpo }) : undefined, cache: "no-store" });
      const j = await r.json().catch(() => null);
      return { status: r.status, j };
    };
    const fotoUrl = (u) => (u?.foto?.sha256 ? `${url}/api/v1/sessao/foto?id=${encodeURIComponent(u.id)}&v=${u.foto.sha256.slice(0, 12)}` : null);
    const avatar = (u, g) => {
      const f = fotoUrl(u);
      return `<span class="av${g ? " g" : ""}">${f ? `<img src="${esc(f)}" alt="" onerror="this.remove()">` : ""}${f ? "" : esc(u?.iniciais || "?")}</span>`;
    };

    // ---- a tela de login (por cima de tudo)
    function desenharTela() {
      if (fase === "logado" || fase === "antigo") { tela.innerHTML = ""; return; }
      if (fase === "conectando") {
        tela.innerHTML = `<div class="fundo"><div class="cartao centro"><div class="giro"></div><h1>Conectando ao Nexo Hub…</h1><p>O ${esc(nome)} usa o login do Nexo Hub desta máquina.</p></div></div>`;
        return;
      }
      if (fase === "sem_hub") {
        tela.innerHTML = `<div class="fundo"><div class="cartao centro"><div class="marca" style="justify-content:center"><i></i><b>Nexo <span>Hub</span></b></div><h1>Sem conexão com o Nexo Hub</h1><p>${esc(erroHub || "O Nexo Hub desta máquina não respondeu.")}</p><button class="sec" data-a="tentar">Tentar de novo</button></div></div>`;
        tela.querySelector('[data-a="tentar"]').onclick = () => conectar(true);
        return;
      }
      // login
      const ultimo = (() => { try { return localStorage.getItem("nexohub:ultimoLogin") || ""; } catch { return ""; } })();
      tela.innerHTML = `<div class="fundo"><form class="cartao" autocomplete="off">
        <div class="marca"><i></i><b>Nexo <span>Hub</span></b></div>
        <h1>Entre para usar o ${esc(nome)}</h1>
        <p>A conta é a do Nexo Hub: entrando aqui, todos os programas da atmosfera Nexo desta máquina ficam liberados.</p>
        <label class="campo" for="l">Usuário ou e-mail</label><input type="text" id="l" spellcheck="false" value="${esc(ultimo)}">
        <label class="campo" for="s">Senha</label><input type="password" id="s">
        <div class="linha"><label><input type="checkbox" id="m" checked> Manter conectado</label><button type="button" class="link" data-a="hub">Abrir o Nexo Hub</button></div>
        <button class="entrar" type="submit">Entrar</button>
        <div class="erro" id="e"></div>
        ${estado.padrao ? '<div class="dica">Primeiro acesso da rede: entre com <b>Admin</b> / <b>Admin</b> e crie os usuários no Nexo Hub.</div>' : ""}
      </form></div>`;
      const f = tela.querySelector("form");
      const l = f.querySelector("#l"), s = f.querySelector("#s"), m = f.querySelector("#m"), e = f.querySelector("#e"), b = f.querySelector(".entrar");
      setTimeout(() => (ultimo ? s : l).focus(), 30);
      f.querySelector('[data-a="hub"]').onclick = () => pedir("POST", "/api/v1/sessao/entrar", {}).catch(() => {});
      f.onsubmit = async (ev) => {
        ev.preventDefault();
        if (enviando) return;
        enviando = true; b.disabled = true; b.textContent = "Entrando…"; e.textContent = "";
        try {
          const r = await pedir("POST", "/api/v1/sessao/entrar", { login: l.value, senha: s.value, manter: m.checked });
          if (!r.j?.ok) { e.textContent = r.j?.erro || `O Nexo Hub recusou (HTTP ${r.status})`; s.select(); return; }
          try { localStorage.setItem("nexohub:ultimoLogin", l.value.trim()); } catch { /* sem armazenamento */ }
          aplicar(r.j);
        } catch { e.textContent = "O Nexo Hub não respondeu: confira se ele está aberto"; }
        finally { enviando = false; if (b.isConnected) { b.disabled = false; b.textContent = "Entrar"; } }
      };
    }

    // ---- o crachá (canto superior direito)
    function desenharCracha() {
      if (fase !== "logado" || !estado.usuario) { cracha.innerHTML = ""; fecharMenu(); return; }
      const u = estado.usuario;
      const primeiro = String(u.nome || u.login).trim().split(/\s+/)[0];
      cracha.innerHTML = `<button class="cracha${op.compacto ? " compacto" : ""}${foraDesde ? " fora" : ""}" title="${esc(u.nome)}${u.email ? ` · ${esc(u.email)}` : ""}${foraDesde ? " (Nexo Hub fora do ar)" : ""}">${avatar(u)}<span class="nm">${esc(primeiro)}</span>${SETA}</button>`;
      cracha.querySelector("button").onclick = (ev) => { ev.stopPropagation(); menu ? fecharMenu() : abrirMenu(); };
    }
    function abrirMenu() {
      const u = estado.usuario;
      if (!u) return;
      menu = document.createElement("div");
      menu.className = "menu";
      menu.innerHTML = `<div class="topo">${avatar(u, true)}<div><b>${esc(u.nome)}</b><small>${esc(u.email || u.login)}</small>${u.admin ? '<span class="tag">Administrador</span>' : ""}</div></div>
        <div class="estado${foraDesde ? " fora" : ""}">${foraDesde ? "Nexo Hub fora do ar: reconectando…" : `Conectado pelo Nexo Hub · ${esc(u.login)}`}</div>
        <div class="acoes"><button data-a="hub">Abrir o Nexo Hub</button><button data-a="sair" class="sair">Sair</button></div>`;
      crachaRaiz.appendChild(menu);
      const r = hostCracha.getBoundingClientRect();
      menu.style.top = `${Math.round(r.bottom + 8)}px`;
      menu.style.right = `${Math.max(8, Math.round(window.innerWidth - r.right))}px`;
      menu.querySelector('[data-a="hub"]').onclick = () => { fecharMenu(); pedir("POST", "/api/v1/sessao/abrir", {}).catch(() => {}); };
      menu.querySelector('[data-a="sair"]').onclick = async () => { fecharMenu(); try { const r2 = await pedir("POST", "/api/v1/sessao/sair", {}); if (r2.j?.ok) aplicar(r2.j); } catch { /* fora */ } };
      menu.onclick = (ev) => ev.stopPropagation();
      setTimeout(() => document.addEventListener("click", fecharMenu, { once: true }), 0);
    }
    function fecharMenu() { menu?.remove(); menu = null; }

    function desenhar() { desenharTela(); desenharCracha(); }
    let ultimoAviso = "";
    function aplicar(j) {
      estado = { logado: !!j.logado, usuario: j.usuario ?? null, padrao: !!j.padrao };
      fase = estado.logado ? "logado" : "login";
      foraDesde = 0; reabriu = false;
      desenhar();
      const ass = JSON.stringify([estado.logado, estado.usuario]);
      if (ass !== ultimoAviso) { ultimoAviso = ass; try { op.aoMudar?.({ ...estado, fase }); } catch { /* o programa trata */ } }
    }

    // ---- ao vivo: o SSE da sessão (login/saída em qualquer programa ou no Hub)
    function ouvir() {
      es?.close();
      if (typeof EventSource !== "function") return void (tRetomar = setInterval(() => conferir().catch(() => {}), 4000));
      es = new EventSource(`${url}/api/v1/sessao/eventos?app=${encodeURIComponent(app)}`);
      es.addEventListener("sessao", (ev) => { try { aplicar(JSON.parse(ev.data)); } catch { /* evento ruim */ } });
      es.onerror = () => { if (fechado) return; es?.close(); es = null; caiu(); };
    }
    /** O Hub parou de responder: logado, segue usando (crachá apagado); sem login, a tela espera. Volta sozinho. */
    function caiu() {
      if (!foraDesde) { foraDesde = Date.now(); desenhar(); }
      clearTimeout(tRetomar);
      tRetomar = setTimeout(async () => {
        if (fechado) return;
        const ok = await conferir().catch(() => false);
        if (ok) return ouvir();
        // 90 s fora (a atualização do Hub fecha ele por uns segundos): abre o Hub de novo, uma vez
        if (!reabriu && Date.now() - foraDesde > 90_000 && op.garantirHub) { reabriu = true; try { await op.garantirHub(); } catch { /* tenta depois */ } }
        caiu();
      }, 3000);
    }
    async function conferir() {
      await resolverUrl();
      const r = await pedir("GET", "/api/v1/sessao");
      // Hub antigo (sem login: o pedido vai ao NexoBD e volta 404): libera o programa, sem crachá
      if (r.status === 404) { fase = "antigo"; desenhar(); try { op.aoMudar?.({ logado: true, usuario: null, fase }); } catch { /* o programa trata */ } return true; }
      if (!r.j || !("logado" in r.j)) throw new Error("resposta inesperada");
      aplicar(r.j);
      return true;
    }
    /** Na abertura: confere o Hub; fora do ar, pede ao programa para abrir o Hub e espera. */
    async function conectar(denovo) {
      fase = "conectando"; desenhar();
      try { if (await conferir()) { if (fase !== "antigo") ouvir(); return; } } catch { /* fora */ }
      if (op.garantirHub) {
        try {
          const g = await op.garantirHub();
          if (g?.url) url = String(g.url).replace(/\/+$/, "");
          if (g && g.ok === false) erroHub = g.erro || "";
        } catch (err) { erroHub = err?.message || ""; }
        try { if (await conferir()) { if (fase !== "antigo") ouvir(); return; } } catch { /* ainda fora */ }
      }
      fase = "sem_hub";
      if (!erroHub) erroHub = denovo ? "O Nexo Hub ainda não respondeu. Abra o Nexo Hub e tente de novo." : "O Nexo Hub desta máquina não respondeu.";
      desenhar();
      // segue conferindo sozinho (sem abrir o Hub de novo): quando ele aparecer, a tela muda
      const esperar = async () => {
        if (fechado || fase !== "sem_hub") return;
        try { if (await conferir()) { if (fase !== "antigo") ouvir(); return; } } catch { /* ainda fora */ }
        setTimeout(esperar, 4000);
      };
      setTimeout(esperar, 4000);
    }
    conectar(false);

    return {
      get estado() { return { ...estado, fase }; },
      /** Liberado para usar? (logado, ou Hub antigo sem login) */
      get liberado() { return fase === "logado" || fase === "antigo"; },
      sair: () => pedir("POST", "/api/v1/sessao/sair", {}).then((r) => r.j?.ok && aplicar(r.j)),
      abrirHub: () => pedir("POST", "/api/v1/sessao/abrir", {}),
      fechar() { fechado = true; es?.close(); clearTimeout(tRetomar); clearInterval(tRetomar); hostTela.remove(); hostCracha.remove(); },
    };
  }

  const NexoHubSessao = { iniciar, versao: "2.25.0" };
  raiz.NexoHubSessao = NexoHubSessao;
  if (typeof module === "object" && module.exports) module.exports = NexoHubSessao;
})(typeof window !== "undefined" ? window : globalThis);
