/* NexoEletric MCP - hub-mcpvista.js: o lado da PAGINA do canal MCP <-> vista aberta.
   Entra nas vistas com UMA linha (o integrador poe no pcbframe.html e no schframe.html):

     <script src="mcp/hub-mcpvista.js"></script>

   Pergunta ao hub (rotas de mcp/rotas_hub.py) se ha pedido do MCP para ESTA vista (alvo pela
   pagina, projeto pelo ?p=) e responde: screenshot (o canvas da vista, em PNG), recarregar,
   focar, selecionar, comando. Sem as rotas no hub (404), para de perguntar e fica quieto. A vista
   pode oferecer ganchos melhores definindo, antes ou depois deste script:

     window.HubMcpVista = { focar(x, y, zoom), selecionar({ids, refs}), comando(nome, args), captura() }

   (captura() devolve um <canvas> ou dataURL; sem ela, junta os canvas visiveis da pagina). */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.__hubMcpVista) return;
  window.__hubMcpVista = true;
  var pag = (location.pathname.split('/').pop() || '').toLowerCase();
  var alvo = pag.indexOf('pcbframe') === 0 ? 'pcb' : pag.indexOf('schframe') === 0 ? 'sch' : null;
  if (!alvo) return;
  var proj = new URLSearchParams(location.search).get('p');
  if (!proj) return;
  var ganchos = function () { return window.HubMcpVista || {}; };
  var parado = false;

  function captura() {
    var g = ganchos();
    if (typeof g.captura === 'function') {
      var c = g.captura();
      if (typeof c === 'string') return { png: c };
      if (c && c.toDataURL) return { png: c.toDataURL('image/png'), largura: c.width, altura: c.height };
    }
    /* os canvas visiveis, empilhados na ordem do DOM sobre o maior */
    var cs = Array.prototype.slice.call(document.querySelectorAll('canvas')).filter(function (c) {
      var r = c.getBoundingClientRect(); return r.width > 50 && r.height > 50 && getComputedStyle(c).visibility !== 'hidden' && getComputedStyle(c).display !== 'none';
    });
    if (!cs.length) throw new Error('a vista não tem canvas visível');
    var base = cs.reduce(function (a, b) { var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return ra.width * ra.height >= rb.width * rb.height ? a : b; });
    var R = base.getBoundingClientRect();
    var out = document.createElement('canvas');
    out.width = base.width; out.height = base.height;
    var k = base.width / R.width, ctx = out.getContext('2d');
    var fundo = getComputedStyle(document.body).backgroundColor;
    ctx.fillStyle = fundo && fundo !== 'rgba(0, 0, 0, 0)' ? fundo : '#14161a';
    ctx.fillRect(0, 0, out.width, out.height);
    cs.forEach(function (c) {
      var r = c.getBoundingClientRect();
      if (r.right < R.left || r.left > R.right || r.bottom < R.top || r.top > R.bottom) return;
      try { ctx.drawImage(c, (r.left - R.left) * k, (r.top - R.top) * k, r.width * k, r.height * k); } catch (e) { /* canvas sujo: pula */ }
    });
    return { png: out.toDataURL('image/png'), largura: out.width, altura: out.height };
  }

  function executa(p) {
    var g = ganchos(), a = p.args || {};
    switch (p.acao) {
      case 'screenshot': return captura();
      case 'recarregar':
        setTimeout(function () { if (window.__hubOnChange) window.__hubOnChange(); else location.reload(); }, 50);
        return { recarregando: true };
      case 'focar':
        if (typeof g.focar !== 'function') throw new Error('esta vista ainda não oferece focar (window.HubMcpVista.focar)');
        return { feito: g.focar(a.x, a.y, a.zoom, a) !== false };
      case 'selecionar':
        if (typeof g.selecionar !== 'function') throw new Error('esta vista ainda não oferece selecionar (window.HubMcpVista.selecionar)');
        return { feito: g.selecionar(a) !== false };
      case 'comando': {
        var dna = (window.HubAltiumDNA || window.HubAltiumDna);
        if (typeof g.comando === 'function') return { resultado: g.comando(a.comando, a) };
        if (dna && typeof dna.executar === 'function') return { resultado: dna.executar(a.comando, a) };
        throw new Error('esta vista não executa comandos (falta HubMcpVista.comando ou HubAltiumDNA.executar)');
      }
      default: throw new Error('ação desconhecida: ' + p.acao);
    }
  }
  function responde(id, corpo) {
    return fetch('/api/mcp/resposta/' + encodeURIComponent(id), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }).catch(function () {});
  }
  function pergunta() {
    if (parado) return;
    fetch('/api/mcp/pedidos?alvo=' + alvo + '&proj=' + encodeURIComponent(proj), { cache: 'no-store' })
      .then(function (r) { if (r.status === 404) { parado = true; return null; } return r.ok ? r.json() : null; })
      .then(function (j) {
        (j && j.pedidos || []).forEach(function (p) {
          var corpo;
          try { corpo = { ok: true, dados: executa(p) }; } catch (e) { corpo = { ok: false, erro: String(e && e.message || e) }; }
          responde(p.id, corpo);
        });
      })
      .catch(function () {})
      .then(function () { if (!parado) setTimeout(pergunta, document.visibilityState === 'hidden' ? 4000 : 1200); });
  }
  if (location.protocol === 'http:' || location.protocol === 'https:') setTimeout(pergunta, 800);
})();
