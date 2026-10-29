/* NexoEletric - hub-autoroteador-worker.js — o auto-roteador da vista PCB FORA da página.

   O Auto-rotear da vista (Route » Auto Route » All, U,A,A; hub-pcbautorota.js) roda o lote do
   hub-autoroteador.js aqui, num Web Worker: a busca é síncrona e uma placa grande leva segundos, e a
   página não pode congelar nesse tempo (o pedido: "rodar sem travar a vista", com progresso e
   Cancelar). O worker carrega os mesmos módulos puros que a página (hub-pcbregras, hub-pcbnets,
   hub-roteador, hub-autoroteador e hub-pcbdrc) e devolve as ops e o DRC de antes e de depois.

   O MESMO ARQUIVO serve a três donos, cada um pelo que ele expõe:
     - como worker (new Worker('hub-autoroteador-worker.js')): importScripts dos módulos e o
       onmessage abaixo;
     - como <script> da vista: o global HubAutoRoteadorWorker com o comparaDrc — o Auto-rotear sem
       worker (fallback em fatias, hub-pcbautorota.js) confere o DRC pela mesma conta;
     - em Node (tests/test-autorotear-vista.js): module.exports, para o protocolo ser testado sem
       navegador.

   PROTOCOLO (tudo clonável pelo postMessage):
     página -> worker  {tipo:'roda', id, eb, regras, placa:{lacos, recortes}, textos:{id: geometria},
                        opcoes:{nets, camadas, ordem, passes, custoVia, res, orcamento, note}, drc}
                       eb = a placa da TELA (EB: as mudanças assadas, os planos despejados);
                       regras = o conjunto do hub-pcbregras (null = a folga única de `clearance`);
                       textos = a geometria (HubGerber.geometriaTexto) dos textos de cobre, por id —
                       função não atravessa o postMessage, a geometria sim
     worker -> página  {tipo:'progresso', id, fase:'rota'|'conserto'|'drc', feitas, total, passe,
                        roteadas, falhas, conexoes, ms}           (no máximo um a cada PASSO_MS)
                       {tipo:'fim', id, r, drc}   r = o relatório do rotearLote (com as ops);
                                                  drc = {antes, depois, nNovas, novas:[...]} | null
                       {tipo:'erro', id, msg}
   Cancelar é o worker.terminate() da página: o lote é síncrono aqui dentro, e não há o que esperar. */
(function (raiz) {
  'use strict';
  const EM_WORKER = typeof importScripts === 'function' && typeof document === 'undefined' && typeof module === 'undefined';
  if (EM_WORKER) importScripts('hub-pcbregras.js', 'hub-pcbnets.js', 'hub-roteador.js', 'hub-autoroteador.js', 'hub-pcbdrc.js');

  const PASSO_MS = 120;
  const agora = () => Date.now();
  /* os módulos: global (worker e página) ou require (Node) */
  function mod(nome, arquivo) {
    try {
      if (nome === 'HubRoteador' && typeof HubRoteador !== 'undefined') return HubRoteador;
      if (nome === 'HubAutoRoteador' && typeof HubAutoRoteador !== 'undefined') return HubAutoRoteador;
      if (nome === 'HubPcbDrc' && typeof HubPcbDrc !== 'undefined') return HubPcbDrc;
    } catch (e) { /* sem o global */ }
    if (raiz && raiz[nome]) return raiz[nome];
    try { if (typeof require === 'function') return require(arquivo); } catch (e) { /* sem o módulo */ }
    return null;
  }

  /* a geometria dos textos que veio pronta da página, como a função textoGeo que a cena e o DRC pedem */
  function textoGeoDe(textos) {
    if (!textos || typeof textos !== 'object') return undefined;
    return t => (t && !t.hidden && t.id != null && textos[t.id]) || null;
  }
  /* o DRC de antes e o de depois (a placa com a prévia), e as violações NOVAS — a conta do MCP */
  function comparaDrc(eb, ops, regras, textoGeo) {
    const D = mod('HubPcbDrc', './hub-pcbdrc.js'), A = mod('HubAutoRoteador', './hub-autoroteador.js');
    if (!D || !A) return null;
    const o = textoGeo ? { textoGeo } : {};
    const d0 = D.rodar(eb, regras || undefined, o);
    const d1 = ops && ops.length ? D.rodar(A.comPrevia(eb, ops), regras || undefined, o) : d0;
    const novas = A.novasViolacoes(d0, d1);
    const porTipo = {};
    for (const v of novas) porTipo[v.tipo] = (porTipo[v.tipo] || 0) + 1;
    return { antes: d0.total, depois: d1.total, nNovas: novas.length, porTipo,
             novas: novas.slice(0, 60).map(v => ({ tipo: v.tipo, msg: v.msg, x: v.x, y: v.y, layer: v.layer, ids: v.ids })) };
  }

  /* uma rodada: a cena, o lote (com o progresso), o DRC */
  function atende(msg, posta) {
    const m = msg || {};
    if (m.tipo !== 'roda') return;
    const id = m.id;
    try {
      const R = mod('HubRoteador', './hub-roteador.js'), A = mod('HubAutoRoteador', './hub-autoroteador.js');
      if (!R || !A) throw new Error('o roteador (hub-roteador.js / hub-autoroteador.js) não carregou no worker');
      const eb = m.eb || {}, op = m.opcoes || {}, tg = textoGeoDe(m.textos);
      const oc = { placa: m.placa || undefined, textoGeo: tg, res: op.res };
      if (m.regras) oc.regras = m.regras; else if (m.clearance > 0) oc.clearance = m.clearance;
      const cena = R.cena(eb, oc);
      const g = A.lote(eb, Object.assign({}, op, { cena, roteador: R }));
      let ult = 0, r;
      for (;;) {
        const p = g.next();
        if (p.done) { r = p.value; break; }
        const t = agora();
        if (t - ult >= PASSO_MS || p.value.feitas === p.value.total) { ult = t; posta(Object.assign({ tipo: 'progresso', id }, p.value)); }
      }
      let drc = null;
      if (m.drc !== false) {
        posta({ tipo: 'progresso', id, fase: 'drc', feitas: 0, total: 1, passe: r.passes, roteadas: r.roteadas, falhas: r.falhas.length, conexoes: r.alvo.conexoes, ms: r.ms });
        drc = comparaDrc(eb, r.ops, m.regras, tg);
      }
      posta({ tipo: 'fim', id, r, drc });
    } catch (e) {
      posta({ tipo: 'erro', id, msg: String(e && e.message || e) });
    }
  }

  const api = { atende, comparaDrc, textoGeoDe, PASSO_MS };
  if (EM_WORKER) raiz.onmessage = e => atende(e.data, x => raiz.postMessage(x));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (raiz && !EM_WORKER) raiz.HubAutoRoteadorWorker = api;
})(typeof self !== 'undefined' ? self : this);
