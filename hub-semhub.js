/* NexoEletric - hub-semhub.js: o aviso "sem conexão com o Nexo Hub" (1.29.0).

   No app desktop tudo vem do Nexo Hub (projetos, esquemas, símbolos, footprints); sem ele o
   hubserver não serve nada disso (nexohub_gate.py) e a página fica vazia. Este aviso diz POR QUE
   está vazia, por cima de tudo, enquanto durar. Conectou: o hubserver sobe a versão e a página
   recarrega cheia (o __live.js); o aviso some sozinho antes disso.

   Fora do app desktop (o hub web) a rota /api/nexohub/estado não existe ou diz ligado:false, e
   nada aparece. */
(function () {
  'use strict';
  const CICLO = 4000;
  let caixa = null;

  function monta() {
    caixa = document.createElement('div');
    caixa.id = 'semHubAviso';
    caixa.setAttribute('role', 'status');
    caixa.style.cssText = 'position:fixed;left:50%;top:56px;transform:translateX(-50%);z-index:2147483000;' +
      'max-width:min(560px,calc(100vw - 32px));padding:12px 16px;border-radius:10px;font:13px/1.45 system-ui,sans-serif;' +
      'background:var(--panel,#2b1d1d);color:var(--text,#f3e9e9);border:1px solid #c0503f;box-shadow:0 8px 28px rgba(0,0,0,.35);' +
      'display:none;gap:10px;align-items:flex-start';
    caixa.innerHTML = '<span style="width:10px;height:10px;border-radius:50%;background:#e0533f;flex:none;margin-top:4px"></span>' +
      '<div><b>Sem conexão com o Nexo Hub</b><br><span class="semhub-txt">Os projetos, os esquemas e a biblioteca ' +
      'só aparecem com ele conectado. Assim que ele voltar, a página recarrega sozinha.</span></div>';
    document.body.appendChild(caixa);
  }

  async function confere() {
    let e = null;
    try {
      const r = await fetch('/api/nexohub/estado', { cache: 'no-store' });
      if (r.ok) e = await r.json();
    } catch (_) { e = null; }
    const sem = !!(e && e.ligado && !e.conectado);
    if (sem && !caixa) monta();
    if (caixa) caixa.style.display = sem ? 'flex' : 'none';
  }

  function inicia() { confere(); setInterval(confere, CICLO); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inicia);
  else inicia();
})();
