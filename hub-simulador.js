/* NexoEletric - hub-simulador.js — o SIMULADOR na vista Esquema (1.101.0).
   Pedido do dono (2026-11-12): "um simulador que mostra tensão, corrente, igual ao Falstad, com uma área mostrando
   cálculo, podendo suprimir ou não o cálculo, bonito, usando as mesmas mecânicas de edição do esquema e da PCB, com
   canvas para orientar e acesso total ao MCP; dá para ver a corrente passando" e "CI com tensão de alimentação, ponto
   de sinal, tudo mostrando bonitinho se eu coloco o mouse em cima do pino".

   O simulador roda EM CIMA do esquema de verdade (o mesmo canvas, a mesma edição: mexeu no esquema, a simulação
   refaz): hub-simulador-circuito.js reconhece os componentes, hub-simulador-motor.js resolve. Na folha:
     · os fios pintados pela tensão (verde = positivo, vermelho = negativo, cinza = 0 V) e os PONTOS andando no sentido
       da corrente (mais rápidos quanto maior a corrente), também por dentro dos componentes de dois pinos
     · o LED acende na cor dele com o brilho da corrente; o rótulo de tensão em cada net
     · mouse no PINO: tensão, corrente entrando/saindo, o papel (alimentação na faixa ✓, terra, GPIO lê 0/1, saída)
     · mouse no COMPONENTE: os cálculos com a fórmula e os números (Ohm, potência, divisor, Vf do LED, β, dropout...)
     · clique na chave/jumper abre e fecha, o botão fica apertado enquanto o clique segura, a roda gira o potenciômetro
     · clique no pino de um CI: GPIO alto / baixo / PWM / entrada / pull-up; clique no fio: fonte nesta net, osciloscópio
   O painel (canto direito): ligar/pausar/religar, Tempo real (transiente desde o "ligar") ou DC, velocidade, o que
   mostrar, as FONTES (deduzidas pelo nome das nets, pelo conector, ou supostas — tudo editável), os alertas, a área
   de CÁLCULOS (o olho suprime) e o OSCILOSCÓPIO.
   A simulação vai para o topo da janela (window.top.__nexoSim + evento 'nexo-sim'): a vista 3D da PCB mostra a
   corrente nas trilhas (hub-simulador-pcb.js). O MCP comanda tudo por HubSimulador.mcp (mcp/ferramentas/simulador.js).

   Ganchos da vista (schframe.js): window.__hubSimVista (o modelo, as nets, a câmera), HubSimulador.desenha(ctx, cam) no
   drawWorld e HubSimulador.mudou() no reapply. */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.HubSimulador) return;
  const M = window.HubSimMotor, C = window.HubSimCircuito;
  const VISTA = () => window.__hubSimVista || null;
  /* MCU com codigo do NexoCode ligado (1.103.2): o NexoCode manda um gpio_lote a cada 0,3 s rodando ou 1 s parado
     (batimento); sem lote ha 3,5 s (ou com desconectar) o MCU volta a cinza com o X */
  const NC_VALIDO = 3500;
  function ncLigado(ref) { const n = st.nexoCode && st.nexoCode[ref]; return n && Date.now() - n.em < NC_VALIDO ? n : null; }
  const fmt = (v, u) => C.fmt(v, u);
  const $c = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

  /* ------------------------------------------------------------------------------------------------ estado */
  const st = {
    ligado: false, rodando: true, modo: 'tempo', velocidade: 1,
    /* tensoes (as pilulas em toda net) comeca DESLIGADO desde a 1.102.1: o dono nao quer balao em tudo — o valor de um
       ponto aparece no clique > Analisar; quem quiser liga em "Tensao nas nets" */
    mostrar: { pontos: true, cores: true, tensoes: false, valores: false, brilho: true },
    calc: true, osc: false, fixo: null,
    cfg: { fontes: {}, terra: [], chaves: {}, pots: {}, gpio: {}, valores: {}, desligados: [] },
    comps: null, mt: null, sim: null, res: null, an: null,
    sujo: true, ultimaAnalise: 0, folhaFluxo: -1, fluxos: null, fase: new Map(), vmax: 5,
    hover: null, raf: 0, tUlt: 0, osciloscopio: [], amostras: [], erro: '', ultQuadro: 0,
    hist: new Map(), dados: null, ferramenta: 'sondar',
    /* a aba Simulador do hub (hub-simulador-aba.js) abre o esquema com ?modo=sim: ja simulando, painel fixo */
    aba: (() => { try { return new URLSearchParams(location.search).get('modo') === 'sim'; } catch (_e) { return false; } })(),
  };
  const chave = () => { const v = VISTA(); return 'nexoSim.' + (v && v.projeto ? v.projeto() : ''); };
  function leCfg() {
    try {
      const j = JSON.parse(localStorage.getItem(chave()) || 'null');
      if (j && typeof j === 'object') {
        Object.assign(st.cfg, j.cfg || {});
        if (j.mostrar) Object.assign(st.mostrar, j.mostrar);
        if (!j.v2) st.mostrar.tensoes = false;   // o padrao novo vale tambem para quem ja tinha gravado
        if (j.modo) st.modo = j.modo;
        if (j.velocidade) st.velocidade = j.velocidade;
        if (j.calc != null) st.calc = j.calc;
        if (j.osciloscopio) st.osciloscopio = j.osciloscopio;
        if (j.oscBase) st.oscBase = j.oscBase;
      }
    } catch (_e) { /* sem storage */ }
  }
  /* a config muda dezenas de vezes por segundo com o NexoCode sincronizado: grava no maximo a cada 2 s */
  let tGrava = 0;
  function gravaCfgLeve() { if (tGrava) return; tGrava = setTimeout(() => { tGrava = 0; gravaCfg(); }, 2000); }
  function gravaCfg() {
    try { localStorage.setItem(chave(), JSON.stringify({ v2: 1, cfg: st.cfg, mostrar: st.mostrar, modo: st.modo, velocidade: st.velocidade, calc: st.calc, osciloscopio: st.osciloscopio, oscBase: st.oscBase })); } catch (_e) { /* sem storage */ }
  }

  /* ------------------------------------------------------------------------------------------------ montar e rodar */
  function dtDaVelocidade() { return Math.min(1e-3, Math.max(1e-8, st.velocidade / 60 / 24)); }
  function monta() {
    const v = VISTA();
    if (!v) { st.erro = 'a vista Esquema não ofereceu os ganchos do simulador'; return false; }
    try {
      st.comps = C.doEsquema(v.model(), v.slib(), v.nets(), window.HubCore, { emergencia: v.emergencia });
      st.mt = C.monta(st.comps, Object.assign({}, st.cfg, { externos: externosDaBancada(st.comps) }));
      st.mt.cfg = st.cfg;
      st.sim = M.cria(st.mt.elementos, { terra: st.mt.terra, dt: dtDaVelocidade() });
      st.acc = null; st.vis = null;   // a media e do circuito montado
      st.res = st.modo === 'dc' ? st.sim.dc() : st.sim.liga();
      if (st.modo !== 'dc') st.res = st.sim.passo(1);
      st.erro = '';
    } catch (e) {
      console.warn('simulador:', e);
      st.erro = 'a simulação falhou: ' + (e && e.message || e);
      st.res = null;
    }
    st.sujo = false; st.amostras = []; st.folhaFluxo = -1;
    analisa(true);
    return !st.erro;
  }
  /* O QUE APARECE e a MEDIA (pedido do dono: "as descrições ficam brilhando quando o ESP manda o sinal"): o PWM do ESP32
     chaveia a cada passo do tempo, e os rotulos, as cores, os calculos e os alertas mostravam o valor do instante. Os
     passos entre duas analises sao somados (acumula) e a media ainda passa por um filtro de ~0,3 s — o que um
     multimetro mostraria. O osciloscopio continua com o valor de cada instante (st.hist / st.amostras). */
  /* a soma fica no motor (1.103.1: s.soma/s.media, sem montar o resultado a cada passo); st.acc e o somador do
     circuito montado (outro circuito = outro somador) */
  function acumula() {
    if (!st.sim || !st.sim.somador) return;
    if (!st.acc || st.acc.sim !== st.sim) st.acc = st.sim.somador();
    st.sim.soma(st.acc);
  }
  function resParaMostrar() {
    const r = st.res;
    if (!r || r.modo === 'dc' || !st.acc || !st.acc.n || st.acc.sim !== st.sim) { st.vis = null; return r; }
    const m0 = st.sim.media(st.acc);
    if (m0.el.length !== r.el.length) { st.acc = null; st.vis = null; return r; }
    const med = { v: m0.v, el: r.el.map((e, j) => Object.assign({}, e, { i: m0.el[j].i, p: m0.el[j].p })) };
    st.sim.zera(st.acc);
    const ant = st.vis, k = ant ? 0.2 : 1;
    if (ant && ant.el.length === med.el.length) {
      for (const q in med.v) if (q in ant.v) med.v[q] = ant.v[q] + (med.v[q] - ant.v[q]) * k;
      med.el.forEach((e, j) => { const b = ant.el[j]; if (!b) return; e.i = e.i.map((x, q) => b.i[q] + (x - b.i[q]) * k); e.p = b.p + (e.p - b.p) * k; });
    }
    st.vis = med;
    return Object.assign({}, r, { v: med.v, el: med.el });
  }
  function analisa(forca) {
    if (!st.res || !st.mt) { st.an = null; painel.atualiza(); return; }
    const agora = performance.now();
    if (!forca && agora - st.ultimaAnalise < 90) return;
    st.ultimaAnalise = agora;
    st.an = C.analisa(st.mt, resParaMostrar());
    let vm = 1;
    for (const [n, x] of Object.entries(st.res.v)) if (!n.includes('#') && isFinite(x)) vm = Math.max(vm, Math.abs(x));
    st.vmax = vm;
    /* o historico de cada net (o "sinal" que aparece na dica do pino e do fio): as ultimas 240 analises */
    if (st.res.modo !== 'dc') for (const [n, x] of Object.entries(st.res.v)) {
      if (n.includes('#') || !isFinite(x)) continue;
      let h = st.hist.get(n); if (!h) { h = []; st.hist.set(n, h); }
      h.push([st.res.t, x]); if (h.length > 240) h.shift();
    }
    calculaFluxos();
    publica();
    painel.atualiza();
    analise.atualiza();
  }
  /* o resultado vai para o topo da janela: a vista PCB (3D) mostra a corrente nas trilhas */
  /* a aba Simulador aberta para este projeto (outra janela que nao esta): ela manda */
  function abaDoProjeto() {
    if (st.aba) return null;
    try { const pj = new URLSearchParams(location.search).get('p') || '', w = window.top.__nexoSimAba && window.top.__nexoSimAba[pj]; return w && w !== window && !w.closed && w.HubSimulador ? w : null; } catch (_e) { return null; }
  }
  function publica() {
    if (abaDoProjeto()) return;   // quem publica para a PCB e a aba Simulador
    let topo = window;
    try { topo = window.top && window.top.document ? window.top : window; } catch (_e) { topo = window; }
    const v = VISTA();
    const dados = st.ligado && st.an ? { projeto: v && v.projeto ? v.projeto() : '', t: st.res.t, modo: st.res.modo, versao: Date.now(),
      pinos: Object.fromEntries(Object.entries(st.an.pinos).map(([k, p]) => [k, { v: p.v, i: p.i, net: p.net }])),
      nets: Object.fromEntries(Object.entries(st.an.nets).filter(([n]) => !n.includes('#')).map(([n, x]) => [n, x.v])),
      comps: Object.fromEntries(Object.entries(st.an.comps).map(([r, c]) => [r, { p: c.p, alertas: c.alertas.length, brilho: c.brilho, cor: c.cor, rpm: c.rpm, corrente: c.corrente }])),
      /* 1.105.0: os microcontroladores e a conexao com o NexoCode (o clique no MCU na PCB 2D/3D mostra o balao) */
      mcus: Object.fromEntries((st.comps || []).filter(c => { const inf = info(c.ref); return inf && inf.tipo === 'mcu'; }).map(c => {
        const n = ncLigado(c.ref), inf = info(c.ref);
        return [c.ref, { titulo: (st.an.comps[c.ref] && st.an.comps[c.ref].titulo) || (inf && inf.rotulo) || c.ref, conectado: !!n, rodando: !!(n && n.rodando), ha_ms: n ? Date.now() - n.em : null }];
      })) } : null;
    try { topo.__nexoSim = dados; topo.dispatchEvent(new CustomEvent('nexo-sim', { detail: dados })); } catch (_e) { /* outra origem */ }
  }

  /* A BANCADA (hub-bancada.js, na vista PCB): os itens da biblioteca e os fios, guardados no topo da janela
     (window.top.__nexoBancada[projeto]). Cada fio liga um pad da placa (REF + pad = o pino do esquema) ao terminal de um
     item, ou dois terminais entre si; o que fica ligado vira a mesma net. O motor e a fonte entram na simulacao. */
  function bancadaDoTopo() {
    try {
      const t = window.top, v = VISTA(); if (!t || !v) return null;
      t.__nexoBancada = t.__nexoBancada || {};
      let b = t.__nexoBancada[v.projeto()];
      /* a bancada guardada (a vista da bancada ainda nao abriu nesta sessao) */
      if (!b) { try { b = JSON.parse(localStorage.getItem('nexoBancada.' + v.projeto()) || 'null'); } catch (_e) { b = null; } if (b) t.__nexoBancada[v.projeto()] = b; }
      return b || null;
    } catch (_e) { return null; }
  }
  function externosDaBancada(comps) {
    const b = bancadaDoTopo();
    if (!b || !Array.isArray(b.itens) || !b.itens.length) return [];
    const netDoPino = new Map();
    for (const c of comps) for (const p of c.pinos) if (p.net) netDoPino.set(c.ref + '-' + p.num, p.net);
    const pai = new Map();
    const acha = k => { while (pai.get(k) !== k) { const q = pai.get(pai.get(k)); pai.set(k, q); k = q; } return k; };
    const no = k => { if (!pai.has(k)) pai.set(k, k); return k; };
    const une = (a, c) => { a = acha(no(a)); c = acha(no(c)); if (a !== c) pai.set(c, a); };
    const chaveDe = pt => pt.tipo === 'pad' ? 'P:' + pt.ref + '-' + pt.pad : 'T:' + pt.item + ':' + pt.terminal;
    for (const f of b.fios || []) if (f && f.a && f.b) une(chaveDe(f.a), chaveDe(f.b));
    const netDoGrupo = new Map();
    let n = 0;
    for (const k of pai.keys()) {
      const r = acha(k);
      if (k.startsWith('P:') && netDoPino.has(k.slice(2)) && !netDoGrupo.has(r)) netDoGrupo.set(r, netDoPino.get(k.slice(2)));
    }
    const netDe = k => { if (!pai.has(k)) return null; const r = acha(k); if (!netDoGrupo.has(r)) netDoGrupo.set(r, 'BANCADA_' + (++n)); return netDoGrupo.get(r); };
    return b.itens.filter(it => it.bancada && /^(motor_dc|fonte)$/.test(it.bancada.tipo)).map(it => {
      const ts = it.bancada.terminais || [];
      const tp = ts.find(t => /^\+|POS|VERM/i.test(t.nome)) || ts[0], tn = ts.find(t => t !== tp) || ts[1];
      return { ref: it.ref || it.id, tipo: it.bancada.tipo, rotulo: it.bancada.rotulo || it.nome, eletrico: it.bancada.eletrico || {},
               nos: [tp ? netDe('T:' + it.id + ':' + tp.nome) : null, tn ? netDe('T:' + it.id + ':' + tn.nome) : null] };
    }).filter(x => x.nos[0] && x.nos[1]);
  }
  try { window.top.addEventListener('nexo-bancada', () => { if (st.ligado) { st.sujo = true; agenda(); } }); } catch (_e) { /* outra origem */ }

  /* o laço: transiente pelo orçamento de tempo de cada quadro, desenho a ~30 quadros/s */
  function laco(t) {
    st.raf = 0;
    if (!st.ligado) return;
    st.ultQuadro = performance.now();
    const dtReal = st.tUlt ? Math.min(0.1, (t - st.tUlt) / 1000) : 1 / 60;
    st.tUlt = t;
    if (st.sujo) monta();
    if (st.rodando && st.modo === 'tempo' && st.sim && st.res) {
      st.sim.dt = dtDaVelocidade();
      const alvo = st.velocidade * dtReal;
      let n = Math.max(1, Math.round(alvo / st.sim.dt));
      const t0 = performance.now();
      /* ORCAMENTO do quadro (1.103.1, "nao ta rodando leve"): o Esquema, a PCB 3D e as pecas dividem a mesma linha de
         execucao — 14 ms de conta por quadro de 16 ms travava o resto. Fica em ~7 ms; se os quadros ja estao
         chegando atrasados (outra vista pesada), cai para 4 ms */
      const orc = dtReal > 0.024 ? 4 : 7;
      const tv = net => st.sim.tensao(net);
      let andou = false;
      while (n > 0 && performance.now() - t0 < orc) {
        /* um passo de cada vez: o PWM chaveia passo a passo e medir de 4 em 4 caia sempre no mesmo estado (o duty de
           50 % aparecia 0 V na media e no osciloscopio). O passo nao monta o resultado (so a soma e as amostras) */
        try { st.sim.anda(1); } catch (e) { st.erro = 'o transiente falhou: ' + e.message; st.rodando = false; break; }
        andou = true;
        acumula();
        n--;
        amostra(st.sim.t, tv);
        analise.amostra(st.sim.t, tv);
      }
      if (andou) st.res = st.sim.resultado();
      analisa(false);
    }
    /* os pontos andam mesmo no DC (a corrente de regime) */
    if (st.rodando) andaPontos(dtReal);
    const v = VISTA();
    if (v) v.redesenha();
    oscDesenha();
    st.raf = requestAnimationFrame(laco);
  }
  function agenda() { if (!st.raf && st.ligado) st.raf = requestAnimationFrame(laco); }
  /* o iframe escondido (a aba Simulador no modo Placa 3D) para o requestAnimationFrame: o relogio de reserva segue
     andando a simulacao, para a placa continuar recebendo a corrente */
  setInterval(() => {
    if (!st.ligado || performance.now() - st.ultQuadro < 450) return;
    if (st.raf) { cancelAnimationFrame(st.raf); st.raf = 0; }
    laco(performance.now());
  }, 250);
  /* uma amostra do instante: (t, tensao(net)); sem argumentos, a do st.res */
  function amostra(t, tv) {
    if (!st.osciloscopio.length || !st.res) return;
    if (t == null) { t = st.res.t; const rv = st.res.v; tv = n => rv[n]; }
    const ult = st.amostras[st.amostras.length - 1];
    if (ult && t === ult.t) return;
    st.amostras.push({ t, v: st.osciloscopio.map(tv) });
    if (st.amostras.length > 7000) st.amostras.splice(0, st.amostras.length - 6000);
  }

  /* ------------------------------------------------------------------------------------------------ corrente nos fios */
  /* Por net da folha ativa: o grafo dos trechos de fio (partidos onde algo encosta no meio), a corrente que cada pino
     joga na net, e os nomeadores (rótulo, power, port) num nó só que fecha a conta com o resto da net (a corrente "pula"
     pelo nome, como na folha). Resolve a rede de condutâncias (1/comprimento): a corrente de cada trecho. */
  function calculaFluxos() {
    const v = VISTA();
    st.fluxos = null;
    if (!v || !st.an) return;
    const si = v.folha(), sh = v.model().sheets[si], nets = v.nets();
    if (!sh) return;
    st.folhaFluxo = si;
    const K = (x, y) => Math.round(x * 2) + '|' + Math.round(y * 2);
    const porNet = new Map();
    const net = n => { let g = porNet.get(n); if (!g) { g = { nos: new Map(), segs: [], inj: new Map(), nomeados: new Set() }; porNet.set(n, g); } return g; };
    const no = (g, x, y) => { const k = K(x, y); if (!g.nos.has(k)) g.nos.set(k, { x, y, i: g.nos.size }); return k; };
    const wn = (nets.wireNet && nets.wireNet[si]) || [];
    const pontos = new Map();     // net -> [{x,y}] pontos que podem cair no meio de um trecho
    const pp = (n, x, y) => { if (!pontos.has(n)) pontos.set(n, []); pontos.get(n).push({ x, y }); };
    sh.wires.forEach((w, wi) => { const n = wn[wi]; if (!n) return; for (const p of w.pts || []) pp(n, p[0], p[1]); });
    for (const c of st.comps || []) if (c.folha === si) for (const p of c.pinos) if (p.net) pp(p.net, p.x, p.y);
    const nomeadores = [].concat(sh.netlabels || [], sh.powers || [], sh.junctions || []);
    for (const l of sh.netlabels || []) pp(l.net, l.x, l.y);
    for (const l of sh.powers || []) pp(l.net, l.x, l.y);
    sh.wires.forEach((w, wi) => {
      const n = wn[wi]; if (!n) return;
      const g = net(n), pts = w.pts || [], ps = pontos.get(n) || [];
      for (let i = 0; i < pts.length - 1; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
        const L = Math.hypot(x2 - x1, y2 - y1); if (L < 1e-6) continue;
        const ux = (x2 - x1) / L, uy = (y2 - y1) / L;
        const meio = [];
        for (const q of ps) {
          const t = (q.x - x1) * ux + (q.y - y1) * uy;
          if (t <= 0.5 || t >= L - 0.5) continue;
          if (Math.abs((q.x - x1) * uy - (q.y - y1) * ux) <= 0.5) meio.push(t);
        }
        meio.sort((a, b) => a - b);
        let ta = 0;
        for (const tb of meio.concat([L])) {
          if (tb - ta < 0.5) continue;
          const a = { x: x1 + ux * ta, y: y1 + uy * ta }, b = { x: x1 + ux * tb, y: y1 + uy * tb };
          g.segs.push({ a: no(g, a.x, a.y), b: no(g, b.x, b.y), ax: a.x, ay: a.y, bx: b.x, by: b.y, len: tb - ta, id: si + ':' + wi + ':' + i + ':' + Math.round(ta), i: 0 });
          ta = tb;
        }
      }
    });
    for (const c of st.comps || []) if (c.folha === si) for (const p of c.pinos) {
      if (!p.net) continue;
      const pin = st.an.pinos[c.ref + '-' + p.num];
      if (!pin || !isFinite(pin.i)) continue;
      const g = net(p.net), k = no(g, p.x, p.y);
      g.inj.set(k, (g.inj.get(k) || 0) - pin.i);   // o pino joga na net o contrário do que entra no componente
    }
    for (const l of [].concat(sh.netlabels || [], sh.powers || [])) { const g = porNet.get(l.net); if (g) g.nomeados.add(no(g, l.x, l.y)); }
    for (const p of sh.ports || []) { const g = porNet.get(p.net); if (g) g.nomeados.add(no(g, p.x, p.y)); }
    void nomeadores;
    const todos = [];
    for (const [n, g] of porNet) {
      if (!g.segs.length) continue;
      /* nós: os nomeados viram um só (o índice 0) */
      const idx = new Map(); let nn = 1;
      for (const k of g.nos.keys()) idx.set(k, g.nomeados.has(k) ? 0 : nn++);
      const temNome = g.nomeados.size > 0;
      const N = nn - 1;   // incógnitas: nós 1..nn-1 (o 0 é a referência: os nomeados, ou o primeiro nó)
      if (!temNome) { // sem nomeador: o primeiro nó vira a referência
        const k0 = g.nos.keys().next().value; const ant = idx.get(k0);
        for (const [k, i] of idx) if (i > ant) idx.set(k, i - 1);
        idx.set(k0, 0);
      }
      const n2 = temNome ? N : N - 1;
      if (n2 <= 0 && !g.segs.some(s => idx.get(s.a) !== idx.get(s.b))) continue;
      const A = new Float64Array(Math.max(1, n2 * n2)), b = new Float64Array(Math.max(1, n2));
      for (const s of g.segs) {
        const a = idx.get(s.a), c = idx.get(s.b), gg = 1 / Math.max(s.len, 1);
        if (a) A[(a - 1) * n2 + a - 1] += gg;
        if (c) A[(c - 1) * n2 + c - 1] += gg;
        if (a && c) { A[(a - 1) * n2 + c - 1] -= gg; A[(c - 1) * n2 + a - 1] -= gg; }
      }
      for (let i = 0; i < n2; i++) A[i * n2 + i] += 1e-9;
      for (const [k, ij] of g.inj) { const i = idx.get(k); if (i) b[i - 1] += ij; }
      if (n2 > 0) M.resolve(A, b, n2);
      const pot = i => i === 0 ? 0 : b[i - 1];
      for (const s of g.segs) { s.i = (pot(idx.get(s.a)) - pot(idx.get(s.b))) / Math.max(s.len, 1); s.net = n; todos.push(s); }
    }
    st.fluxos = todos;
  }

  function andaPontos(dt) {
    if (!st.fluxos) return;
    for (const s of st.fluxos) {
      const v = velocidadePonto(s.i);
      if (!v) continue;
      st.fase.set(s.id, ((st.fase.get(s.id) || 0) + v * dt));
    }
    if (st.an) for (const [ref, c] of Object.entries(st.an.comps)) {
      if (c.corrente == null) continue;
      const v = velocidadePonto(c.corrente);
      if (v) st.fase.set('c:' + ref, (st.fase.get('c:' + ref) || 0) + v * dt);
    }
  }
  /* pixels por segundo na tela: logarítmico na corrente (1 µA anda devagar, 1 A voa) */
  function velocidadePonto(i) {
    const a = Math.abs(i);
    if (!(a > 2e-7)) return 0;
    return Math.sign(i) * Math.min(220, 14 + 26 * Math.log10(a / 2e-7));
  }

  /* ------------------------------------------------------------------------------------------------ desenho na folha */
  function corDaTensao(v, alfa) {
    if (!isFinite(v)) return 'rgba(140,140,150,' + (alfa || 1) + ')';
    const t = Math.max(-1, Math.min(1, v / st.vmax));
    const g = [128, 134, 145];
    const fim = t >= 0 ? [34, 197, 94] : [239, 68, 68];
    const k = Math.pow(Math.abs(t), 0.5);
    const c = g.map((x, i) => Math.round(x + (fim[i] - x) * k));
    return 'rgba(' + c.join(',') + ',' + (alfa == null ? 1 : alfa) + ')';
  }
  function desenha(ctx, cam) {
    if (!st.ligado || !st.an) return;
    const v = VISTA(); if (!v) return;
    const si = v.folha();
    if (si !== st.folhaFluxo) calculaFluxos();
    const px = 1 / cam.scale;
    ctx.save();
    /* fios pintados pela tensao */
    if (st.mostrar.cores && st.fluxos) {
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(3.2 * px, 14);   // cobre o fio da folha mesmo de perto
      for (const s of st.fluxos) {
        ctx.strokeStyle = corDaTensao(vMostra(s.net), 0.95);
        ctx.beginPath(); ctx.moveTo(s.ax, s.ay); ctx.lineTo(s.bx, s.by); ctx.stroke();
      }
    }
    /* brilho dos LEDs */
    if (st.mostrar.brilho) for (const c of st.comps || []) {
      if (c.folha !== si) continue;
      const a = st.an.comps[c.ref];
      if (!a || !a.brilho || a.brilho < 0.02) continue;
      const cx = c.pinos.reduce((s, p) => s + p.x, 0) / c.pinos.length, cy = c.pinos.reduce((s, p) => s + p.y, 0) / c.pinos.length;
      const r = 260 * (0.5 + a.brilho);
      const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      gr.addColorStop(0, hexA(a.cor || '#ff3b30', 0.75 * a.brilho + 0.15));
      gr.addColorStop(0.35, hexA(a.cor || '#ff3b30', 0.35 * a.brilho));
      gr.addColorStop(1, hexA(a.cor || '#ff3b30', 0));
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    }
    /* a chave/botao fechado: um contorno amarelo e "APERTADO" (o clique veio da folha ou do botao do NexoCode) */
    for (const c of st.comps || []) {
      if (c.folha !== si || !c.pinos.length) continue;
      const inf = info(c.ref);
      if (!inf || inf.tipo !== 'chave' || !inf.fechada || inf.interativo !== 'botao' && !inf.doNexoCode) continue;
      let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
      for (const p of c.pinos) { x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y); x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y); }
      const m = 120;
      ctx.save();
      ctx.shadowColor = '#facc15'; ctx.shadowBlur = 18; ctx.strokeStyle = '#facc15'; ctx.lineWidth = Math.max(3 * px, 8);
      ctx.strokeRect(x1 - m, y1 - m, x2 - x1 + 2 * m, y2 - y1 + 2 * m);
      ctx.restore();
      inf._marca = { x: (x1 + x2) / 2, y: y2 + m };
    }
    /* os pontos da corrente */
    if (st.mostrar.pontos) {
      const passo = Math.max(22 * px, 60), raio = Math.max(2.6 * px, 6);
      ctx.fillStyle = '#facc15';
      ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 0.8 * px;
      const pontosEm = (ax, ay, bx, by, fase) => {
        const L = Math.hypot(bx - ax, by - ay); if (L < 1e-6) return;
        const ux = (bx - ax) / L, uy = (by - ay) / L;
        let d = ((fase * px) % passo + passo) % passo;
        for (; d < L; d += passo) { ctx.beginPath(); ctx.arc(ax + ux * d, ay + uy * d, raio, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      };
      if (st.fluxos) for (const s of st.fluxos) if (velocidadePonto(s.i)) pontosEm(s.ax, s.ay, s.bx, s.by, st.fase.get(s.id) || 0);
      /* por dentro do componente de dois pinos: do pino por onde a corrente entra ao outro */
      for (const c of st.comps || []) {
        if (c.folha !== si || c.pinos.length !== 2) continue;
        const a = st.an.comps[c.ref];
        if (!a || a.corrente == null || !velocidadePonto(a.corrente)) continue;
        const [p, q] = c.pinos;
        pontosEm(p.x, p.y, q.x, q.y, st.fase.get('c:' + c.ref) || 0);
      }
    }
    /* o MCU e o NexoCode (pedido do dono): sem codigo do NexoCode ligado o microcontrolador fica cinza com um X (sem
       conexao de controle); com o NexoCode ligado, verde. Vai no quadro que o laco ja desenha (nenhum quadro a mais) */
    const mcusNc = [];
    for (const c of st.comps || []) {
      if (c.folha !== si || c.pinos.length < 4) continue;
      const nc = ncLigado(c.ref), inf = info(c.ref);
      if (!nc && !(inf && inf.tipo === 'mcu')) continue;
      let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
      for (const p of c.pinos) { x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y); x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y); }
      const m = 60, rx = x1 - m, ry = y1 - m, rw = x2 - x1 + 2 * m, rh = y2 - y1 + 2 * m;
      ctx.save();
      if (nc) {
        ctx.fillStyle = 'rgba(34,197,94,.10)'; ctx.fillRect(rx, ry, rw, rh);
        ctx.shadowColor = '#22c55e'; ctx.shadowBlur = 16; ctx.strokeStyle = '#22c55e'; ctx.lineWidth = Math.max(3 * px, 8);
        ctx.strokeRect(rx, ry, rw, rh);
      } else {
        ctx.fillStyle = 'rgba(55,65,81,.55)'; ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeStyle = 'rgba(156,163,175,.85)'; ctx.lineWidth = Math.max(2.5 * px, 7); ctx.strokeRect(rx, ry, rw, rh);
        const d = Math.min(rw, rh) * 0.32, cx = rx + rw / 2, cy = ry + rh / 2;
        ctx.lineCap = 'round'; ctx.lineWidth = Math.max(5 * px, 16); ctx.strokeStyle = 'rgba(209,213,219,.9)';
        ctx.beginPath(); ctx.moveTo(cx - d, cy - d); ctx.lineTo(cx + d, cy + d); ctx.moveTo(cx - d, cy + d); ctx.lineTo(cx + d, cy - d); ctx.stroke();
      }
      ctx.restore();
      mcusNc.push({ nc, x: (x1 + x2) / 2, y: y2 + m });
    }
    /* textos em pixels de tela */
    const dpr = window.devicePixelRatio || 1;
    const cvs = ctx.canvas, W = cvs.width / dpr, H = cvs.height / dpr;
    const tela = (x, y) => ({ x: (x - cam.cx) * cam.scale + W / 2, y: H / 2 - (y - cam.cy) * cam.scale });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = '600 11px ' + (getComputedStyle(document.body).getPropertyValue('--font') || 'system-ui');
    ctx.textBaseline = 'middle';
    if (st.mostrar.tensoes && cam.scale > 0.035) {
      /* OS BALOES DE TENSAO ORGANIZADOS (pedido do dono: "mais organizado, com uma linha ligando ate o pino"): um por net,
         preso a um PINO da net (o do componente com menos pinos: fora do aperto do CI), posto ao redor dele no primeiro
         lugar livre (nao encosta em outro balao nem cobre outro pino), com a linha de chamada do pino ate o balao. A
         ordem e a largura sao fixas (a largura de "-00,00 mV"): o balao nao pula quando o valor muda. */
      const porNet = new Map();
      for (const c of st.comps || []) {
        if (c.folha !== si) continue;
        for (const p of c.pinos) {
          if (!p.net || !(p.net in st.res.v)) continue;
          const a = porNet.get(p.net);
          if (!a || c.pinos.length < a.n) porNet.set(p.net, { net: p.net, x: p.x, y: p.y, n: c.pinos.length });
        }
      }
      const pinosTela = [];
      for (const c of st.comps || []) if (c.folha === si) for (const p of c.pinos) { const q = tela(p.x, p.y); if (q.x > -20 && q.y > -20 && q.x < W + 20 && q.y < H + 20) pinosTela.push(q); }
      /* o corpo de cada componente e o nome dele (em cima): o balao nao cobre */
      const corpos = [];
      for (const c of st.comps || []) {
        if (c.folha !== si || !c.pinos.length) continue;
        let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
        for (const p of c.pinos) { const q = tela(p.x, p.y); x1 = Math.min(x1, q.x); x2 = Math.max(x2, q.x); y1 = Math.min(y1, q.y); y2 = Math.max(y2, q.y); }
        if (x2 < -40 || y2 < -40 || x1 > W + 40 || y1 > H + 40) continue;
        corpos.push({ x1: x1 + 6, x2: x2 - 6, y1: y1 - 30, y2: y2 + 14 });
      }
      const wFixo = ctx.measureText('-00,00 mV').width + 12, hP = 17;
      const postos = [];
      /* o "APERTADO" do botao fechado tambem ocupa lugar */
      for (const c of st.comps || []) { const inf = info(c.ref); if (c.folha === si && inf && inf._marca && inf.tipo === 'chave' && inf.fechada) { const q = tela(inf._marca.x, inf._marca.y); postos.push({ x1: q.x - 40, x2: q.x + 100, y1: q.y - 24, y2: q.y - 4 }); } }
      const bate = (r) => postos.some(o => r.x1 < o.x2 + 3 && r.x2 > o.x1 - 3 && r.y1 < o.y2 + 3 && r.y2 > o.y1 - 3)
        || pinosTela.some(q => q.x > r.x1 - 4 && q.x < r.x2 + 4 && q.y > r.y1 - 4 && q.y < r.y2 + 4)
        || corpos.some(o => o.x2 > o.x1 && r.x1 < o.x2 && r.x2 > o.x1 && r.y1 < o.y2 && r.y2 > o.y1);
      /* os lugares em volta do pino: em cima/embaixo primeiro (os fios correm na horizontal), depois na diagonal, mais longe */
      const lugares = [];
      /* na diagonal primeiro: a linha de chamada fica a vista (reto em cima o balao a escondia) */
      for (const d of [34, 52, 72, 96]) for (const [ax, ay] of [[0.9, -1], [-0.9, -1], [0.9, 1], [-0.9, 1], [0, -1.2], [0, 1.2], [1.8, 0], [-1.8, 0]]) lugares.push([ax * d, ay * d]);
      const lista = [...porNet.values()].sort((a, b) => a.net < b.net ? -1 : a.net > b.net ? 1 : 0);
      for (const a of lista) {
        const p = tela(a.x, a.y);
        if (p.x < -50 || p.y < -20 || p.x > W + 50 || p.y > H + 20) continue;
        let r = null;
        for (const [dx, dy] of lugares) {
          const cx = p.x + dx, cy = p.y + dy;
          const c = { x1: cx - wFixo / 2, x2: cx + wFixo / 2, y1: cy - hP / 2, y2: cy + hP / 2, cx, cy };
          if (!bate(c)) { r = c; break; }
        }
        if (!r) continue;   // sem lugar livre perto: fica sem balao (o clique > Analisar mostra)
        postos.push(r);
        const v = vMostra(a.net), cor = corDaTensao(v, 1), flut = (st.res.flutuantes || []).includes(a.net);
        /* a linha de chamada: do pino ate a borda do balao mais perto */
        const bx = Math.max(r.x1, Math.min(p.x, r.x2)), by = p.y < r.y1 ? r.y1 : p.y > r.y2 ? r.y2 : r.cy;
        ctx.strokeStyle = corDaTensao(v, 1); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(bx, by); ctx.stroke();
        ctx.fillStyle = cor; ctx.beginPath(); ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2); ctx.fill();
        const txt = fmt(v, 'V');
        ctx.fillStyle = 'rgba(17,20,26,.92)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(r.x1, r.y1, wFixo, hP, 8); else ctx.rect(r.x1, r.y1, wFixo, hP);
        ctx.fill();
        ctx.strokeStyle = cor; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.fillStyle = flut ? '#9ca3af' : '#f3f4f6';
        ctx.textAlign = 'center'; ctx.fillText(txt, r.cx, r.cy + 0.5); ctx.textAlign = 'left';
      }
    }
    if (st.mostrar.valores && cam.scale > 0.05) for (const c of st.comps || []) {
      if (c.folha !== si || !c.pinos.length) continue;
      const a = st.an.comps[c.ref]; if (!a) continue;
      const txt = a.corrente != null && Math.abs(a.corrente) > 1e-9 ? fmt(Math.abs(a.corrente), 'A') : Math.abs(a.p) > 1e-6 ? fmt(a.p, 'W') : '';
      if (!txt) continue;
      const cx = c.pinos.reduce((s, p) => s + p.x, 0) / c.pinos.length, cy = Math.min(...c.pinos.map(p => p.y));
      const p = tela(cx, cy);
      pilula(ctx, p.x - 20, p.y + 16, txt, '#facc15', false);
    }
    /* alerta no componente: o triângulo laranja */
    for (const c of st.comps || []) {
      if (c.folha !== si || !c.pinos.length) continue;
      const a = st.an.comps[c.ref];
      if (!a || !a.alertas.length || /^(fora|ignorado|desconhecido|solto|conector)$/.test(a.tipo)) continue;
      const p = tela(Math.max(...c.pinos.map(q => q.x)), Math.max(...c.pinos.map(q => q.y)));
      ctx.fillStyle = '#f97316';
      ctx.beginPath(); ctx.moveTo(p.x + 8, p.y - 20); ctx.lineTo(p.x + 16, p.y - 6); ctx.lineTo(p.x, p.y - 6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#111'; ctx.fillText('!', p.x + 6.5, p.y - 11);
    }
    for (const k of mcusNc) {
      const p = tela(k.x, k.y);
      const txt = k.nc ? 'NexoCode \u2713 ' + (k.nc.rodando ? 'firmware rodando' : 'firmware parado') : '\u2715 sem NexoCode (sem controle)';
      pilula(ctx, p.x - ctx.measureText(txt).width / 2 - 6, p.y - 14, txt, k.nc ? '#22c55e' : '#9ca3af', !k.nc);
    }
    for (const c of st.comps || []) {
      const inf = info(c.ref);
      if (c.folha !== si || !inf || !inf._marca || inf.tipo !== 'chave' || !inf.fechada || inf.interativo !== 'botao' && !inf.doNexoCode) continue;
      const p = tela(inf._marca.x, inf._marca.y);
      pilula(ctx, p.x - 34, p.y - 14, inf.doNexoCode ? 'APERTADO (NexoCode)' : 'APERTADO', '#facc15', false);
    }
    /* o pino sob o mouse */
    if (st.hover && st.hover.tipo === 'pino') {
      const p = tela(st.hover.x, st.hover.y);
      ctx.strokeStyle = '#facc15'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
  const vMostra = net => (st.vis && net in st.vis.v ? st.vis.v[net] : st.res.v[net]);
  function hexA(hex, a) {
    const h = String(hex).replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + Math.max(0, Math.min(1, a)) + ')';
  }
  function pilula(ctx, x, y, txt, cor, flut) {
    const w = ctx.measureText(txt).width + 12, h = 17;
    ctx.fillStyle = 'rgba(17,20,26,.88)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y - h / 2, w, h, 8); else ctx.rect(x, y - h / 2, w, h);
    ctx.fill();
    ctx.strokeStyle = cor; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = flut ? '#9ca3af' : '#f3f4f6';
    ctx.fillText(txt, x + 6, y + 0.5);
  }

  /* ------------------------------------------------------------------------------------------------ mouse */
  function mundoDe(e) {
    const v = VISTA(); if (!v) return null;
    const cv = v.canvas(), r = cv.getBoundingClientRect();
    return v.cam().toWorld(e.clientX - r.left, e.clientY - r.top);
  }
  function acha(w) {
    const v = VISTA(); if (!v || !st.comps || !w) return null;
    const si = v.folha(), cam = v.cam().cam || v.cam(), tol = 9 / cam.scale;   // mkCamera devolve {cam:{scale, cx, cy}, toWorld...}
    let melhor = null, dm = tol;
    for (const c of st.comps) {
      if (c.folha !== si) continue;
      for (const p of c.pinos) { const d = Math.hypot(p.x - w.x, p.y - w.y); if (d < dm) { dm = d; melhor = { tipo: 'pino', ref: c.ref, num: p.num, net: p.net, x: p.x, y: p.y }; } }
    }
    if (melhor) return melhor;
    const sh = v.model().sheets[si];
    for (const comp of sh.comps) {
      const b = v.caixa(comp);
      if (b && w.x >= b.x1 && w.x <= b.x2 && w.y >= b.y1 && w.y <= b.y2) return { tipo: 'comp', ref: comp.ref };
    }
    if (st.fluxos) {
      const tf = 6 / cam.scale;
      for (const s of st.fluxos) {
        const L = Math.hypot(s.bx - s.ax, s.by - s.ay); if (!L) continue;
        const t = ((w.x - s.ax) * (s.bx - s.ax) + (w.y - s.ay) * (s.by - s.ay)) / (L * L);
        if (t < 0 || t > 1) continue;
        const d = Math.hypot(s.ax + t * (s.bx - s.ax) - w.x, s.ay + t * (s.by - s.ay) - w.y);
        if (d < tf) return { tipo: 'fio', net: s.net, i: s.i, x: w.x, y: w.y };
      }
    }
    return null;
  }
  function info(ref) { return st.mt && st.mt.comps.get(String(ref)); }

  function aoMover(e) {
    if (!st.ligado || !st.an) return;
    const h = acha(mundoDe(e));
    const antes = st.hover && JSON.stringify([st.hover.tipo, st.hover.ref, st.hover.num, st.hover.net]);
    st.hover = h;
    /* nada de balao ao passar o mouse (pedido do dono): so o destaque; o clique abre Analisar */
    if (antes !== (h && JSON.stringify([h.tipo, h.ref, h.num, h.net]))) { const v = VISTA(); if (v) v.redesenha(); }
    const inf = h && h.tipo === 'comp' ? info(h.ref) : null;
    const cv = VISTA() && VISTA().canvas();
    if (cv) cv.style.cursor = inf && (inf.interativo === 'chave' || inf.interativo === 'botao') ? 'pointer' : inf && inf.interativo === 'pot' ? 'ns-resize' : '';
  }
  function aoApertar(e) {
    if (!st.ligado || e.button !== 0 || !st.an) return;
    const h = acha(mundoDe(e));
    if (!h) return;
    if (h.tipo === 'comp') {
      const inf = info(h.ref);
      if (inf && inf.interativo === 'chave') { e.stopPropagation(); e.preventDefault(); alternaChave(h.ref); return; }
      if (inf && inf.interativo === 'botao') {
        e.stopPropagation(); e.preventDefault();
        defineChave(h.ref, true);
        const solta = () => { defineChave(h.ref, false); window.removeEventListener('mouseup', solta, true); };
        window.addEventListener('mouseup', solta, true);
        return;
      }
      e.stopPropagation(); e.preventDefault();
      st.fixo = h.ref; painel.calculos(h.ref);
      menu.abre(h, e, false);
      return;
    }
    if (h.tipo === 'pino' || h.tipo === 'fio') {
      e.stopPropagation(); e.preventDefault();
      if (st.ferramenta === 'ponta' && h.net) { osciloscopio(h.net, !st.osciloscopio.includes(h.net)); st.osc = true; painel.atualiza(true); return; }
      menu.abre(h, e, st.ferramenta === 'tensao');
    }
  }
  function aoRodar(e) {
    if (!st.ligado || !st.an) return;
    const h = acha(mundoDe(e));
    const inf = h && h.tipo === 'comp' ? info(h.ref) : null;
    if (!inf || inf.interativo !== 'pot') return;
    e.stopPropagation(); e.preventDefault();
    definePot(h.ref, (inf.pos == null ? 0.5 : inf.pos) + (e.deltaY < 0 ? 0.05 : -0.05));
  }

  /* ------------------------------------------------------------------------------------------------ comandos (tela e MCP) */
  function alternaChave(ref) { const inf = info(ref); defineChave(ref, !(inf && inf.fechada)); }
  function defineChave(ref, fechada) {
    const inf = info(ref); if (!inf || !inf.sw) return false;
    if (!fechada) inf.doNexoCode = false;
    inf.fechada = !!fechada; inf.sw.fechada = !!fechada;
    if (inf.sw2) inf.sw2.fechada = !fechada;
    inf.rotulo = inf.rotulo.replace(/\((fechad[oa]|abert[oa])\)/, fechada ? '(fechado)' : '(aberto)');
    st.cfg.chaves[ref] = !!fechada; gravaCfg();
    if (st.modo === 'dc') st.res = st.sim.dc(); else st.res = st.sim.passo(1);
    analisa(true); agenda();
    return true;
  }
  function definePot(ref, pos) {
    const inf = info(ref); if (!inf) return false;
    pos = Math.max(0, Math.min(1, pos));
    inf.pos = pos; st.cfg.pots[ref] = pos; gravaCfg();
    if (inf.r1 && inf.r2) { inf.r1.r = Math.max(1, inf.r * (1 - pos)); inf.r2.r = Math.max(1, inf.r * pos); inf.rotulo = inf.rotulo.replace(/\(\d+ %\)/, '(' + Math.round(pos * 100) + ' %)'); }
    else { st.sujo = true; }
    if (!st.sujo) { st.res = st.modo === 'dc' ? st.sim.dc() : st.sim.passo(1); analisa(true); }
    agenda();
    return true;
  }
  function defineFonte(net, f) {
    if (f === null) delete st.cfg.fontes[net];
    else st.cfg.fontes[net] = Object.assign({}, st.cfg.fontes[net] || {}, f);
    gravaCfg();
    /* so mudou o valor de uma fonte que ja existe: troca na hora, sem religar */
    const el = st.sim && st.sim.elementos.find(e => e.id === 'FONTE:' + net);
    if (el && f && !f.desligada && f.v != null && !f.onda && !('onda' in (st.cfg.fontes[net] || {}))) {
      el.v = +f.v; el.onda = undefined; if (el.fonte) el.fonte.v = +f.v;
      st.res = st.modo === 'dc' ? st.sim.dc() : st.sim.passo(1); analisa(true);
    } else st.sujo = true;
    agenda();
  }
  function defineGpio(key, g) {
    if (!g || g.modo === 'nada') delete st.cfg.gpio[key]; else st.cfg.gpio[key] = g;
    gravaCfg(); st.sujo = true; agenda();
  }
  function liga(on) {
    on = on == null ? !st.ligado : !!on;
    if (on === st.ligado) return st.ligado;
    st.ligado = on;
    if (on) { leCfg(); st.sujo = true; st.rodando = true; st.tUlt = 0; painel.abre(); agenda(); analise.tomaSerie(); }
    else { painel.fecha(); dica.esconde(); menu.fecha(); st.an = null; publica(); const v = VISTA(); if (v) v.redesenha(); }
    botao.pinta();
    return st.ligado;
  }
  function religa() { st.sujo = true; st.rodando = true; st.fase.clear(); agenda(); }

  /* ------------------------------------------------------------------------------------------------ CSS */
  const CSS = `
.sim-p{position:absolute; top:10px; right:10px; z-index:32; width:340px; max-height:calc(100% - 20px); display:flex; flex-direction:column;
  background:color-mix(in srgb, var(--panel, #1c1f26) 94%, transparent); color:var(--fg, #e5e7eb); border:1px solid var(--border, #333);
  border-radius:12px; box-shadow:0 14px 40px rgba(0,0,0,.45); font:12px var(--font, system-ui); backdrop-filter:blur(8px); overflow:hidden}
.sim-p[hidden]{display:none}
.sim-p.fixo{top:0; right:0; bottom:0; max-height:none; height:100%; border-radius:0; border-width:0 0 0 1px; width:350px; box-shadow:-8px 0 24px rgba(0,0,0,.25)}
.sim-p.fixo .sim-hd{cursor:default}
.sim-p.mini .sim-corpo{display:none}
.sim-p.mini{width:auto; height:auto; bottom:auto; max-height:none; border-radius:0 0 0 10px; border-width:0 0 1px 1px}
.sim-hd{display:flex; align-items:center; gap:7px; padding:9px 10px 8px 12px; border-bottom:1px solid var(--border, #333); cursor:move; user-select:none}
.sim-hd b{font-size:13px; letter-spacing:.2px} .sim-hd .esp{flex:1}
.sim-pt{width:9px; height:9px; border-radius:50%; background:#22c55e; box-shadow:0 0 8px #22c55e}
.sim-pt.aviso{background:#f59e0b; box-shadow:0 0 8px #f59e0b} .sim-pt.erro{background:#ef4444; box-shadow:0 0 8px #ef4444} .sim-pt.pausa{background:#9ca3af; box-shadow:none}
.sim-t{font:11px var(--mono, ui-monospace, monospace); color:var(--fg-dim, #9ca3af); min-width:64px; text-align:right}
.sim-b{height:26px; min-width:26px; padding:0 8px; border-radius:7px; border:1px solid var(--border, #333); background:var(--panel2, #23262e); color:inherit; cursor:pointer; font:inherit}
.sim-b:hover{border-color:var(--hi, #f59e0b)} .sim-b.on{background:var(--hi, #f59e0b); color:var(--on-hi, #111); border-color:var(--hi, #f59e0b)}
.sim-corpo{overflow:auto; padding:4px 0 8px}
.sim-sec{padding:8px 12px 6px} .sim-sec + .sim-sec{border-top:1px solid color-mix(in srgb, var(--border, #333) 60%, transparent)}
.sim-sec h4{margin:0 0 6px; font-size:10.5px; text-transform:uppercase; letter-spacing:.08em; color:var(--fg-dim, #9ca3af); display:flex; align-items:center; gap:6px}
.sim-sec h4 .esp{flex:1}
.sim-seg{display:flex; border:1px solid var(--border, #333); border-radius:8px; overflow:hidden}
.sim-seg button{flex:1; height:26px; border:0; background:transparent; color:inherit; cursor:pointer; font:inherit}
.sim-seg button.on{background:var(--hi, #f59e0b); color:var(--on-hi, #111); font-weight:600}
.sim-linha{display:flex; align-items:center; gap:8px; margin-top:6px}
.sim-linha input[type=range]{flex:1; accent-color:var(--hi, #f59e0b)}
.sim-chips{display:flex; flex-wrap:wrap; gap:5px}
.sim-chip{padding:3px 9px; border-radius:12px; border:1px solid var(--border, #333); cursor:pointer; user-select:none; color:var(--fg-dim, #9ca3af)}
.sim-chip.on{border-color:var(--hi, #f59e0b); color:var(--fg, #e5e7eb); background:color-mix(in srgb, var(--hi, #f59e0b) 18%, transparent)}
.sim-fonte{display:grid; grid-template-columns:1fr 74px auto; gap:6px; align-items:center; padding:4px 0}
.sim-fonte .nm{overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600}
.sim-fonte .or{font-size:10px; padding:1px 6px; border-radius:8px; border:1px solid currentColor; margin-left:5px; font-weight:500}
.sim-fonte .or.suposta{color:#f59e0b} .sim-fonte .or.nome{color:#60a5fa} .sim-fonte .or.conector{color:#a78bfa} .sim-fonte .or.definida{color:#34d399}
.sim-fonte input{width:100%; height:24px; border-radius:6px; border:1px solid var(--border, #333); background:var(--panel2, #23262e); color:inherit; padding:0 6px; font:inherit; text-align:right}
.sim-fonte .i{grid-column:1/-1; color:var(--fg-dim, #9ca3af); font-size:11px; margin-top:-3px}
.sim-res{display:grid; grid-template-columns:1fr auto; gap:3px 10px}
.sim-res .k{color:var(--fg-dim, #9ca3af)} .sim-res .v{font-variant-numeric:tabular-nums; text-align:right; font-weight:600}
.sim-al{list-style:none; margin:4px 0 0; padding:0; display:flex; flex-direction:column; gap:3px}
.sim-al li{padding:4px 7px; border-radius:6px; background:rgba(249,115,22,.12); color:#fdba74; cursor:pointer}
.sim-al li b{color:#fed7aa}
.sim-calc .tit{font-weight:700; font-size:12.5px; margin-bottom:6px}
.sim-calc .l{padding:5px 0; border-bottom:1px dashed color-mix(in srgb, var(--border, #333) 70%, transparent)}
.sim-calc .l:last-child{border-bottom:0}
.sim-calc .lt{display:flex; gap:8px} .sim-calc .lt span:first-child{flex:1; color:var(--fg-dim, #9ca3af)} .sim-calc .lt span:last-child{font-weight:700; font-variant-numeric:tabular-nums}
.sim-calc .lf{font:11px var(--mono, ui-monospace, monospace); color:#93c5fd; margin-top:2px; word-break:break-word}
.sim-calc .al{margin-top:6px; padding:5px 8px; border-radius:6px; background:rgba(239,68,68,.12); color:#fca5a5}
.sim-calc .vazio{color:var(--fg-dim, #9ca3af)}
.sim-con{margin:8px 0 3px; font-size:12px; color:var(--fg-dim, #9ca3af)} .sim-con b{color:var(--fg, #e5e7eb)}
.sim-pino{display:grid; grid-template-columns:62px 1fr 64px 92px; gap:6px; align-items:center; padding:2px 0}
.sim-pino .nm{font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.sim-pino .net{color:var(--fg-dim, #9ca3af); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11px}
.sim-pino input{height:22px; border-radius:6px; border:1px solid var(--border, #333); background:var(--panel2, #23262e); color:inherit; padding:0 5px; font:inherit; text-align:right; min-width:0}
.sim-pino input:disabled{opacity:.5}
.sim-pino .med{text-align:right; font-variant-numeric:tabular-nums; font-weight:600; font-size:11.5px}
.sim-pino .med.ent{color:#34d399}
.sim-osc{width:100%; height:120px; display:block; border-radius:8px; background:#0b0e13}
.sim-osc-l{display:flex; flex-wrap:wrap; gap:6px; margin-top:5px; font-size:11px}
.sim-osc-l span{display:inline-flex; gap:4px; align-items:center; cursor:pointer} .sim-osc-l i{width:10px; height:3px; border-radius:2px; display:inline-block}
.sim-osc-m{flex-basis:100%; display:flex; flex-direction:column; gap:3px; font:10.5px ui-monospace, monospace; color:var(--fg-dim, #9ca3af)} .sim-osc-m > div{display:block} .sim-osc-m i{width:10px; height:3px; border-radius:2px; display:inline-block; margin-right:5px; vertical-align:middle}
.sim-osc-m .av, .sim-an .av{color:var(--warn, #fbbf24); font:10.5px system-ui; margin:1px 0 2px 15px} .sim-an .av{flex-basis:100%; margin:3px 0 0} .sim-an .av button{font-size:10.5px}
.sim-base{font-size:10.5px; padding:1px 3px; margin-right:6px; background:var(--panel2, transparent); color:inherit; border:1px solid var(--border, #444); border-radius:4px}
.sim-dica{position:fixed; z-index:60; pointer-events:none; min-width:200px; max-width:340px; padding:9px 11px; border-radius:10px;
  background:rgba(15,18,24,.96); color:#e5e7eb; border:1px solid rgba(255,255,255,.12); box-shadow:0 10px 30px rgba(0,0,0,.5); font:12px var(--font, system-ui)}
.sim-dica .t{font-weight:700; margin-bottom:5px; display:flex; gap:6px; align-items:center}
.sim-dica .t .net{font-weight:500; color:#9ca3af}
.sim-dica .g{display:grid; grid-template-columns:auto 1fr; gap:2px 10px} .sim-dica .g .k{color:#9ca3af} .sim-dica .g .v{text-align:right; font-weight:700; font-variant-numeric:tabular-nums}
.sim-dica .p{margin-top:5px; color:#a7f3d0} .sim-dica .a{margin-top:5px; color:#fca5a5} .sim-dica .h{margin-top:6px; color:#6b7280; font-size:10.5px}
.sim-dica .f{font:10.5px var(--mono, ui-monospace, monospace); color:#93c5fd}
.sim-dica .ds{margin-top:6px; padding:6px 8px; border-radius:7px; background:rgba(59,130,246,.12); color:#dbeafe} .sim-dica .ds .dd{color:#93c5fd; font-size:11px}
.sim-dica .spark{display:block; margin-top:6px; border-radius:6px; background:#05070a}
.sim-tb{position:absolute; top:10px; left:10px; z-index:31; display:flex; gap:4px; padding:4px; border-radius:10px; background:rgba(15,18,24,.92);
  border:1px solid rgba(255,255,255,.1); box-shadow:0 8px 24px rgba(0,0,0,.4)}
.sim-tb button{height:30px; padding:0 10px; border-radius:7px; border:1px solid transparent; background:transparent; color:#e5e7eb; cursor:pointer; font:12px var(--font, system-ui); display:flex; gap:6px; align-items:center}
.sim-tb button:hover{background:rgba(255,255,255,.07)} .sim-tb button.on{background:#f59e0b; color:#111; font-weight:600}
.sim-tb .sep{width:1px; background:rgba(255,255,255,.12); margin:4px 2px}
.sim-calc .ds{margin-top:8px; padding:7px 9px; border-radius:8px; background:rgba(59,130,246,.1)} .sim-calc .ds a{color:#93c5fd}
.sim-menu{position:fixed; z-index:61; min-width:210px; padding:6px; border-radius:10px; background:var(--panel, #1c1f26); color:var(--fg, #e5e7eb);
  border:1px solid var(--border, #333); box-shadow:0 12px 32px rgba(0,0,0,.5); font:12px var(--font, system-ui)}
.sim-menu .t{padding:4px 8px 6px; font-weight:700}
.sim-menu .an{display:flex; gap:4px; align-items:center; padding:2px 6px 8px; border-bottom:1px solid var(--border, #333); margin-bottom:4px}
.sim-menu .an b{font-size:11px; color:var(--fg-dim, #9ca3af); margin-right:4px}
.sim-menu .an button{width:auto; flex:1; text-align:center; border:1px solid var(--border, #333); padding:5px 6px}
.sim-an{position:fixed; z-index:58; width:360px; border-radius:12px; background:rgba(12,15,20,.96); color:#e5e7eb; border:1px solid rgba(250,204,21,.45);
  box-shadow:0 14px 40px rgba(0,0,0,.55); font:12px var(--font, system-ui); overflow:hidden}
.sim-an .hd{display:flex; align-items:center; gap:8px; padding:7px 10px; border-bottom:1px solid rgba(255,255,255,.08); cursor:move; user-select:none}
.sim-an .hd b{flex:1} .sim-an .hd button{height:22px; min-width:22px; border-radius:6px; border:1px solid rgba(255,255,255,.15); background:rgba(255,255,255,.05); color:inherit; cursor:pointer}
.sim-an .hd button.on{background:#f59e0b; color:#111}
.sim-an .bd{padding:8px 10px; max-height:360px; overflow:auto}
.sim-an .g{display:grid; grid-template-columns:1fr auto; gap:3px 10px} .sim-an .g .k{color:#9ca3af} .sim-an .g .v{font-weight:700; text-align:right; font-variant-numeric:tabular-nums}
.sim-an .l{padding:4px 0; border-bottom:1px dashed rgba(255,255,255,.08)} .sim-an .lf{font:10.5px var(--mono, ui-monospace, monospace); color:#93c5fd}
.sim-an .ds{margin-top:6px; padding:6px 8px; border-radius:7px; background:rgba(59,130,246,.12); color:#dbeafe}
.sim-an canvas{display:block; width:100%; height:170px; border-radius:8px; background:#05070a}
.sim-an .leg{display:flex; flex-wrap:wrap; gap:4px 8px; align-items:center; justify-content:space-between; color:#9ca3af; font:10.5px ui-monospace, monospace; margin-top:4px} .sim-menu .s{padding:2px 8px 4px; color:var(--fg-dim, #9ca3af); font-size:11px}
.sim-menu button{display:block; width:100%; text-align:left; padding:6px 9px; border:0; border-radius:6px; background:transparent; color:inherit; cursor:pointer; font:inherit}
.sim-menu button:hover, .sim-menu button.on{background:color-mix(in srgb, var(--hi, #f59e0b) 22%, transparent)}
.sim-menu .lin{display:flex; gap:6px; padding:4px 8px} .sim-menu .lin input{flex:1; min-width:0; height:24px; border-radius:6px; border:1px solid var(--border, #333); background:var(--panel2, #23262e); color:inherit; padding:0 6px}
#btnSim.on{background:var(--hi, #f59e0b); color:var(--on-hi, #111); border-color:var(--hi, #f59e0b)}
`;
  function css() { if (document.getElementById('sim-css')) return; const s = document.createElement('style'); s.id = 'sim-css'; s.textContent = CSS; document.head.append(s); }

  /* ------------------------------------------------------------------------------------------------ a dica do mouse */
  const dica = (() => {
    let el = null;
    function mostra(h, e) {
      if (!h || !st.an || menu.aberto()) { esconde(); return; }
      if (!el) { el = $c('div', 'sim-dica'); document.body.append(el); }
      el.textContent = '';
      if (h.tipo === 'pino') {
        const p = st.an.pinos[h.ref + '-' + h.num]; if (!p) { esconde(); return; }
        const t = $c('div', 't'); t.append($c('span', null, p.texto), $c('span', 'net', p.net ? '· ' + p.net : '· sem ligação'));
        const g = $c('div', 'g');
        const kv = (k, v) => g.append($c('span', 'k', k), $c('span', 'v', v));
        kv('Tensão', fmt(p.v, 'V'));
        if (Math.abs(p.i) > 1e-10) kv('Corrente', fmt(Math.abs(p.i), 'A') + (p.i > 0 ? ' entrando ↓' : ' saindo ↑'));
        if (Math.abs(p.i * p.v) > 1e-7) kv('Potência', fmt(Math.abs(p.i * p.v), 'W'));
        el.append(t, g);
        if (p.papel) el.append($c('div', 'p', p.papel));
        if (p.alerta) el.append($c('div', 'a', '⚠ ' + p.alerta));
        const ds = pinoDoDatasheet(h.ref, h.num);
        if (ds) {
          const d = $c('div', 'ds');
          d.append($c('b', null, (ds.nome || ('pino ' + h.num)) + (ds.tipo ? ' · ' + ds.tipo : '')));
          if (ds.funcao) d.append($c('div', null, ds.funcao));
          if (ds.descricao) d.append($c('div', 'dd', ds.descricao));
          if (ds.vmax != null || ds.imax != null) d.append($c('div', 'dd', [ds.vmax != null ? 'máx. ' + fmt(+ds.vmax, 'V') : '', ds.imax != null ? fmt(+ds.imax, 'A') : ''].filter(Boolean).join(' · ')));
          el.append(d);
        }
        sinal(el, p.net);
        el.append($c('div', 'h', 'clique: ' + (/^(mcu|ci|desconhecido)$/.test((info(h.ref) || {}).tipo) ? 'GPIO, fonte, osciloscópio' : 'fonte, osciloscópio')));
      } else if (h.tipo === 'fio') {
        const t = $c('div', 't'); t.append($c('span', null, 'Net ' + h.net));
        const g = $c('div', 'g');
        g.append($c('span', 'k', 'Tensão'), $c('span', 'v', fmt(st.res.v[h.net], 'V')));
        if (Math.abs(h.i) > 1e-9) g.append($c('span', 'k', 'Corrente no fio'), $c('span', 'v', fmt(Math.abs(h.i), 'A')));
        el.append(t, g);
        if ((st.res.flutuantes || []).includes(h.net)) el.append($c('div', 'a', 'flutuando: sem caminho DC até o terra'));
        sinal(el, h.net);
        el.append($c('div', 'h', 'clique: definir fonte nesta net, osciloscópio'));
      } else if (h.tipo === 'comp') {
        const c = st.an.comps[h.ref]; if (!c) { esconde(); return; }
        el.append($c('div', 't', c.titulo));
        const g = $c('div', 'g');
        for (const l of c.linhas.slice(0, st.calc ? 4 : 8)) g.append($c('span', 'k', l.t), $c('span', 'v', l.r));
        el.append(g);
        for (const a of c.alertas.slice(0, 3)) el.append($c('div', 'a', '⚠ ' + a));
        const inf = info(h.ref);
        if (inf && inf.interativo) el.append($c('div', 'h', inf.interativo === 'pot' ? 'roda do mouse: gira o cursor' : inf.interativo === 'botao' ? 'segure o clique: aperta o botão' : 'clique: abre/fecha'));
        else if (st.calc) el.append($c('div', 'h', 'os cálculos completos estão no painel (clique fixa)'));
      }
      const x = e.clientX + 16, y = e.clientY + 14;
      el.style.left = Math.min(x, window.innerWidth - 350) + 'px';
      el.style.top = Math.min(y, window.innerHeight - el.offsetHeight - 8) + 'px';
      el.hidden = false;
    }
    function esconde() { if (el) el.hidden = true; }
    /* o SINAL da net: o grafico das ultimas analises (so no Tempo real, e so se mexe) */
    function sinal(box, net) {
      const h = net && st.hist.get(net);
      if (!h || h.length < 3) return;
      let lo = Infinity, hi = -Infinity;
      for (const [, x] of h) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
      if (hi - lo < 1e-3) { box.append($c('div', 'h', 'sinal constante em ' + fmt(hi, 'V'))); return; }
      const W = 230, H = 46, dpr = window.devicePixelRatio || 1;
      const cv = document.createElement('canvas'); cv.className = 'spark'; cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
      const c = cv.getContext('2d'); c.scale(dpr, dpr);
      const t0 = h[0][0], t1 = h[h.length - 1][0];
      c.strokeStyle = 'rgba(255,255,255,.08)'; c.beginPath(); c.moveTo(0, H / 2); c.lineTo(W, H / 2); c.stroke();
      c.strokeStyle = '#facc15'; c.lineWidth = 1.6; c.beginPath();
      h.forEach(([t, x], i) => { const X = (t - t0) / Math.max(t1 - t0, 1e-12) * W, Y = H - 3 - (x - lo) / (hi - lo) * (H - 6); if (i) c.lineTo(X, Y); else c.moveTo(X, Y); });
      c.stroke();
      const leg = $c('div', 'h', 'sinal: ' + fmt(lo, 'V') + ' a ' + fmt(hi, 'V') + ' em ' + fmt(t1 - t0, 's'));
      box.append(cv, leg);
    }
    return { mostra, esconde };
  })();
  /* o pino no banco de dados de datasheet (Libs/componentes-dados.json): pelo numero, senao pelo nome */
  function pinoDoDatasheet(ref, num) {
    const inf = info(ref); if (!inf || !st.dados) return null;
    const d = C.dadosDe(st.dados, Object.assign({}, inf.comp, { valor: inf.valorTxt }), inf.tipo);
    if (!d || !d.pinos) return null;
    const p = inf.pinos.find(q => String(q.num) === String(num));
    return d.pinos[String(num)] || (p && p.name && Object.values(d.pinos).find(x => x && x.nome && String(x.nome).toUpperCase() === String(p.name).toUpperCase())) || null;
  }
  async function carregaDados() {
    try { const r = await fetch('Libs/componentes-dados.json?t=' + Date.now(), { cache: 'no-store' }); st.dados = r.ok ? await r.json() : { componentes: {} }; }
    catch (_e) { st.dados = { componentes: {} }; }
    return st.dados;
  }

  /* ------------------------------------------------------------------------------------------------ o menu do clique */
  const menu = (() => {
    let el = null;
    const fecha = () => { if (el) { el.remove(); el = null; } };
    function abre(h, e, focaTensao) {
      fecha(); dica.esconde();
      el = $c('div', 'sim-menu');
      const net = h.net;
      /* ANALISAR: a pessoa escolhe ver em lista (valores e contas) ou no osciloscopio (o sinal) */
      const an = $c('div', 'an');
      an.append($c('b', null, 'Analisar'));
      const bl = $c('button', null, '📋 Lista'), bo = $c('button', null, '📈 Osciloscópio');
      bl.title = 'Os valores e as contas numa janela'; bo.title = 'O sinal no tempo numa janela de osciloscópio';
      bl.onclick = () => { analise.abre(h, 'lista', e); fecha(); };
      bo.onclick = () => { analise.abre(h, 'osc', e); fecha(); };
      an.append(bl, bo);
      if (h.tipo === 'comp') {
        const inf = info(h.ref), c = st.an.comps[h.ref];
        el.append($c('div', 't', (c && c.titulo) || h.ref), an);
        document.body.append(el);
        el.style.left = Math.min(e.clientX + 6, window.innerWidth - 240) + 'px';
        el.style.top = Math.min(e.clientY + 6, window.innerHeight - el.offsetHeight - 8) + 'px';
        const fora0 = ev => { if (el && !el.contains(ev.target)) { fecha(); window.removeEventListener('mousedown', fora0, true); } };
        setTimeout(() => window.addEventListener('mousedown', fora0, true), 0);
        for (const ev of ['mousedown', 'wheel', 'contextmenu']) el.addEventListener(ev, x => x.stopPropagation());
        void inf;
        return;
      }
      if (h.tipo === 'pino') {
        const p = st.an.pinos[h.ref + '-' + h.num] || {};
        el.append($c('div', 't', p.texto || h.ref), $c('div', 's', (net || 'sem ligação') + ' · ' + fmt(p.v, 'V')), an);
        const inf = info(h.ref);
        if (inf && /^(mcu|ci|desconhecido)$/.test(inf.tipo) && net) {
          const key = h.ref + '-' + h.num, atual = (st.cfg.gpio[key] || {}).modo || 'nada';
          for (const [m, rot] of [['nada', 'Alta impedância (padrão)'], ['alto', 'Saída ALTA'], ['baixo', 'Saída BAIXA'], ['pwm', 'PWM 50 % · 1 kHz'], ['entrada', 'Entrada'], ['pullup', 'Entrada com pull-up'], ['pulldown', 'Entrada com pull-down']]) {
            const b = $c('button', atual === m ? 'on' : '', (atual === m ? '● ' : '') + 'GPIO: ' + rot);
            b.onclick = () => { defineGpio(key, m === 'nada' ? null : { modo: m, duty: 0.5, f: 1000 }); fecha(); };
            el.append(b);
          }
        }
      } else el.append($c('div', 't', 'Net ' + net), $c('div', 's', fmt(vMostra(net), 'V')), an);
      if (net && !(st.mt.terra || []).includes(net)) {
        const lin = $c('div', 'lin'), inp = $c('input'); inp.placeholder = 'tensão (V)'; inp.value = (st.cfg.fontes[net] && st.cfg.fontes[net].v) || '';
        const ok = $c('button', null, 'Fonte'); ok.style.width = 'auto';
        ok.onclick = () => { const v = parseFloat(String(inp.value).replace(',', '.')); if (isFinite(v)) defineFonte(net, { v }); fecha(); };
        inp.onkeydown = ev => { if (ev.key === 'Enter') ok.onclick(); if (ev.key === 'Escape') fecha(); };
        lin.append(inp, ok); el.append(lin);
        if (st.cfg.fontes[net]) { const b = $c('button', null, 'Tirar a fonte desta net'); b.onclick = () => { defineFonte(net, null); fecha(); }; el.append(b); }
      }
      if (net) {
        const no = st.osciloscopio.includes(net);
        const b = $c('button', null, no ? 'Tirar do osciloscópio' : 'Mostrar no osciloscópio');
        b.onclick = () => { osciloscopio(net, !no); fecha(); };
        el.append(b);
        const t = $c('button', null, 'Usar como terra (0 V)');
        t.onclick = () => { st.cfg.terra = [...new Set((st.cfg.terra || []).concat(net))]; gravaCfg(); st.sujo = true; agenda(); fecha(); };
        if (!(st.mt.terra || []).includes(net)) el.append(t);
      }
      document.body.append(el);
      el.style.left = Math.min(e.clientX + 6, window.innerWidth - 230) + 'px';
      el.style.top = Math.min(e.clientY + 6, window.innerHeight - el.offsetHeight - 8) + 'px';
      const fora = ev => { if (el && !el.contains(ev.target)) { fecha(); window.removeEventListener('mousedown', fora, true); } };
      setTimeout(() => window.addEventListener('mousedown', fora, true), 0);
      for (const ev of ['mousedown', 'wheel', 'contextmenu']) el.addEventListener(ev, x => x.stopPropagation());
      const i = el.querySelector('input'); if (i && (h.tipo === 'fio' || focaTensao)) i.focus();
    }
    return { abre, fecha, aberto: () => !!el };
  })();

  const analise = (() => {
    const janelas = [];
    let serie = 0;
    function titulo(h) {
      if (h.tipo === 'pino') { const p = st.an && st.an.pinos[h.ref + '-' + h.num]; return (p && p.texto) || (h.ref + ' pino ' + h.num); }
      if (h.tipo === 'fio') return 'Net ' + h.net;
      const c = st.an && st.an.comps[h.ref]; return (c && c.titulo) || h.ref;
    }
    /* as nets a medir no osciloscopio: a do pino/fio; no componente, as duas pontas (a diferenca e a tensao nele) */
    function netsDe(h) {
      if (h.net) return [h.net];
      const inf = info(h.ref); if (!inf) return [];
      /* 1.103.1: o componente de 3 pinos ou mais (MOSFET, transistor, regulador) mostra um canal por pino — a diferenca
         de duas pontas quaisquer (dreno - gate) dava um serrote sem sentido. Terra fica de fora (e 0 V) */
      const nets = [...new Set(inf.pinos.map(p => p.net).filter(Boolean))];
      if (nets.length <= 2) return nets;
      const out = nets.filter(n => !(st.mt.terra || []).includes(n)).slice(0, 4);
      out.multi = true;
      return out;
    }
    function rotuloDaNet(h, n) {
      const inf = h.ref && info(h.ref); const p = inf && inf.pinos.find(q => q.net === n);
      return p ? (p.name && p.name !== p.num ? p.name : 'pino ' + p.num) + ' · ' + n : n;
    }
    function abre(h, modo, e) {
      const j = { id: ++serie, h: Object.assign({}, h), modo, el: $c('div', 'sim-an') };
      const hd = $c('div', 'hd'), b = $c('b', null, titulo(h));
      const bl = $c('button', null, '📋'), bo = $c('button', null, '📈'), x = $c('button', null, '×');
      bl.title = 'Lista'; bo.title = 'Osciloscópio'; x.title = 'Fechar';
      bl.onclick = () => { j.modo = 'lista'; pinta(j); }; bo.onclick = () => { j.modo = 'osc'; pinta(j); };
      x.onclick = () => { j.el.remove(); janelas.splice(janelas.indexOf(j), 1); };
      hd.append(b, bl, bo, x);
      j.bd = $c('div', 'bd'); j.btL = bl; j.btO = bo;
      j.el.append(hd, j.bd);
      for (const ev of ['mousedown', 'wheel', 'contextmenu', 'dblclick', 'keydown']) j.el.addEventListener(ev, z => z.stopPropagation(), { passive: ev === 'wheel' });
      hd.addEventListener('mousedown', ev => {
        if (ev.target.closest('button')) return;
        const r = j.el.getBoundingClientRect(), ox = ev.clientX - r.left, oy = ev.clientY - r.top;
        const mv = m => { j.el.style.left = Math.max(0, m.clientX - ox) + 'px'; j.el.style.top = Math.max(0, m.clientY - oy) + 'px'; };
        const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
        window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
      });
      document.body.append(j.el);
      j.el.style.left = Math.max(4, Math.min((e ? e.clientX : 200) + 14, window.innerWidth - 380)) + 'px';
      j.el.style.top = Math.max(4, Math.min((e ? e.clientY : 120) + 10, window.innerHeight - 300)) + 'px';
      j.nets = netsDe(h); j.amostras = [];
      janelas.push(j);
      pinta(j);
      /* cabe na tela: a altura so se sabe depois de pintar (a legenda do osciloscopio cresce com os canais) */
      const cabe = () => { const r = j.el.getBoundingClientRect(); if (r.bottom > window.innerHeight - 4) j.el.style.top = Math.max(4, window.innerHeight - r.height - 4) + 'px'; };
      cabe(); setTimeout(cabe, 120);
      return j;
    }
    /* a cada analise: a lista com os valores medios; o osciloscopio guarda o instante (o sinal de verdade) */
    /* as nets que a vista PCB (o cartao do pad > Osciloscopio) pediu: o sinal de cada passo, lido pelo topo */
    const assinadas = new Map();   // net -> [{t, v}]
    /* quem registra e a simulacao que esta LIGADA (1.103.1): o Esquema normal do projeto tambem carrega este arquivo e,
       abrindo depois da aba Simulador, tomava o lugar dela — o osciloscopio do cartao do pad ficava "esperando o
       sinal" de uma simulacao parada. Sem ninguem ligado, o primeiro que carrega fica de reserva */
    function registraSerie(forca) {
      try {
        const t = window.top || window, ja = t.__nexoSimSerie;
        if (!forca && ja && ja._janela && ja._janela !== window && !ja._janela.closed && ja._ligado && ja._ligado()) return;
        t.__nexoSimSerie = serieApi;
      } catch (_e) { /* outra origem */ }
    }
    let serieApi = null;
    try {
      serieApi = {
        _janela: window,
        _ligado: () => st.ligado,
        assina(net) { if (net && !assinadas.has(net)) assinadas.set(net, []); return true; },
        solta(net) { assinadas.delete(net); },
        le(net) { return assinadas.get(net) || []; },
        /* o mesmo osciloscopio do painel (base de tempo, gatilho, medidas, PWM rapido reconstruido) para o cartao do pad */
        pwmDe(net) { return pwmDaNet(net); },
        desenha(cv, net, base) { return desenhaCanais(cv, [{ nome: net, cor: '#facc15', A: assinadas.get(net) || [], pwm: pwmDaNet(net) }], base || 'auto'); },
      };
      /* as nets ja assinadas na outra simulacao passam para esta quando ela liga */
      serieApi._herda = velha => { try { if (velha && velha._nets) for (const n of velha._nets()) serieApi.assina(n); } catch (_e) { /* ok */ } };
      serieApi._nets = () => [...assinadas.keys()];
      registraSerie(false);
    } catch (_e) { /* outra origem */ }
    /* amostra(t, tensao(net)) no laco; amostra(resultado) no DC */
    function amostra(t, tv) {
      if (t == null) return;
      if (typeof t === 'object') { const r = t; t = r.t; tv = n => r.v[n]; }
      for (const [n, A] of assinadas) {
        const ult = A[A.length - 1];
        if (ult && t === ult.t) continue;
        A.push({ t, v: tv(n) });
        if (A.length > 7000) A.splice(0, A.length - 6000);   // corta em lote (cortar 1 por passo era O(n) a cada passo)
      }
      for (const j of janelas) {
        if (!j.nets.length) continue;
        const ult = j.amostras[j.amostras.length - 1];
        if (ult && t === ult.t) continue;
        j.amostras.push({ t, v: j.nets.map(tv) });
        if (j.amostras.length > 7000) j.amostras.splice(0, j.amostras.length - 6000);
      }
    }
    function atualiza() {
      if (st.modo === 'dc') amostra(st.res);
      for (const j of janelas) pinta(j);
    }
    function pinta(j) {
      j.btL.classList.toggle('on', j.modo === 'lista'); j.btO.classList.toggle('on', j.modo === 'osc');
      if (!st.an) return;
      const h = j.h;
      if (j.modo === 'lista') {
        j.bd.textContent = '';
        const g = $c('div', 'g');
        const kv = (k, v) => g.append($c('span', 'k', k), $c('span', 'v', v));
        if (h.tipo === 'pino') {
          const p = st.an.pinos[h.ref + '-' + h.num] || {};
          kv('Net', p.net || '—'); kv('Tensão (média)', fmt(p.v, 'V'));
          if (Math.abs(p.i) > 1e-10) kv('Corrente', fmt(Math.abs(p.i), 'A') + (p.i > 0 ? ' entrando' : ' saindo'));
          if (Math.abs(p.i * p.v) > 1e-7) kv('Potência', fmt(Math.abs(p.i * p.v), 'W'));
          j.bd.append(g);
          if (p.papel) j.bd.append($c('div', 'l', p.papel));
          if (p.alerta) j.bd.append($c('div', 'l', '⚠ ' + p.alerta));
          const ds = pinoDoDatasheet(h.ref, h.num);
          if (ds) { const d = $c('div', 'ds'); d.append($c('b', null, (ds.nome || 'pino ' + h.num) + (ds.tipo ? ' · ' + ds.tipo : ''))); if (ds.funcao) d.append($c('div', null, ds.funcao)); if (ds.descricao) d.append($c('div', 'lf', ds.descricao)); j.bd.append(d); }
        } else if (h.tipo === 'fio') {
          kv('Tensão (média)', fmt(vMostra(h.net), 'V'));
          const segs = (st.fluxos || []).filter(s => s.net === h.net);
          if (segs.length) kv('Maior corrente num trecho', fmt(Math.max(...segs.map(s => Math.abs(s.i))), 'A'));
          j.bd.append(g);
        } else {
          const c = st.an.comps[h.ref];
          if (!c) { j.bd.append($c('div', 'l', 'fora da simulação')); return; }
          for (const l of c.linhas) { const d = $c('div', 'l'); const lt = $c('div', 'g'); lt.append($c('span', 'k', l.t), $c('span', 'v', l.r)); d.append(lt); if (l.f) d.append($c('div', 'lf', l.f)); j.bd.append(d); }
          for (const a of c.alertas) j.bd.append($c('div', 'l', '⚠ ' + a));
        }
        return;
      }
      /* osciloscopio */
      let cv = j.bd.querySelector('canvas'), leg = j.bd.querySelector('.leg');
      if (!cv) { j.bd.textContent = ''; cv = document.createElement('canvas'); leg = $c('div', 'leg'); j.bd.append(cv, leg); }
      const dpr = window.devicePixelRatio || 1, W = cv.clientWidth || 340, H = cv.clientHeight || 170;
      if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
      const c2 = cv.getContext('2d'); c2.setTransform(dpr, 0, 0, dpr, 0, 0); c2.clearRect(0, 0, W, H);
      c2.strokeStyle = 'rgba(255,255,255,.07)';
      for (let i = 1; i < 4; i++) { c2.beginPath(); c2.moveTo(0, H * i / 4); c2.lineTo(W, H * i / 4); c2.stroke(); }
      for (let i = 1; i < 8; i++) { c2.beginPath(); c2.moveTo(W * i / 8, 0); c2.lineTo(W * i / 8, H); c2.stroke(); }
      const A = j.amostras;
      /* no componente de duas pontas, a tensao NELE (a diferenca); no pino/fio, a tensao da net */
      const val = a => (j.nets.length === 2 && h.tipo === 'comp') ? a.v[0] - a.v[1] : a.v[0];
      if (st.modo === 'dc' || A.length < 2) {
        const dpr = window.devicePixelRatio || 1, W = cv.clientWidth || 340, H = cv.clientHeight || 170;
        if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
        const c2 = cv.getContext('2d'); c2.setTransform(dpr, 0, 0, dpr, 0, 0); c2.clearRect(0, 0, W, H);
        c2.fillStyle = '#6b7280'; c2.font = '11px system-ui'; c2.fillText(st.modo === 'dc' ? 'o osciloscópio anda no Tempo real' : 'esperando o sinal…', 10, H / 2); leg.textContent = ''; return;
      }
      const varios = h.tipo === 'comp' && !!j.nets.multi;
      const canais = varios
        ? j.nets.map((n, k) => ({ nome: rotuloDaNet(h, n), cor: CORES_OSC[k % CORES_OSC.length], A: A.map(a => ({ t: a.t, v: a.v[k] })), pwm: pwmDaNet(n) }))
        : [{ nome: titulo(h), cor: '#facc15', A: A.map(a => ({ t: a.t, v: val(a) })), pwm: h.tipo === 'comp' ? null : pwmDaNet(j.nets[0]) }];
      const ls = desenhaCanais(cv, canais, j.base || 'auto');
      const l = ls[0];
      const canal = canais[0];
      leg.textContent = '';
      if (!j.selBase) j.selBase = seletorBase(j.base || 'auto', v => { j.base = v; pinta(j); });
      if (varios) {
        for (const x of ls) { const d = $c('div', 'cn'); const b = $c('b', null, '● '); b.style.color = x.cor; d.append(b, $c('span', null, x.nome + ': ' + x.texto)); leg.append(d); }
        leg.append(j.selBase);
      } else {
        const txt = $c('span', null, l ? l.texto : '');
        leg.append(txt, j.selBase);
      }
      if (l && l.aviso) {
        const av = $c('div', 'av', l.aviso);
        const b = $c('button', null, 'ver de verdade'); b.title = 'Simulação lenta o bastante para o sinal amostrado mostrar o PWM';
        b.onclick = () => { st.velocidade = velocidadePara(canal.pwm.f); j.amostras = []; gravaCfg(); st.sujo = true; agenda(); };
        av.append(' ', b); leg.append(av);
      }
    }
    function tomaSerie() { try { const t = window.top || window, velha = t.__nexoSimSerie; if (velha !== serieApi) { registraSerie(true); serieApi._herda(velha); } } catch (_e) { /* ok */ } }
    return { abre, atualiza, amostra, lista: () => janelas, tomaSerie };
  })();

  function osciloscopio(net, on) {
    const i = st.osciloscopio.indexOf(net);
    if (on && i < 0) st.osciloscopio.push(net);
    if (!on && i >= 0) st.osciloscopio.splice(i, 1);
    if (st.osciloscopio.length > 4) st.osciloscopio.shift();
    st.amostras = []; st.osc = st.osciloscopio.length > 0 || st.osc;
    gravaCfg(); painel.atualiza(true);
  }
  /* ------------------------------------------------------------------------------------------------ osciloscopio
     O que os tres osciloscopios (painel, Analisar e o cartao do pad na PCB) desenham: base de tempo (auto ou por divisao),
     gatilho na subida (a imagem para), medidas (frequencia, duty, Vmin/Vmax) e o PWM RAPIDO reconstruido. Quando o passo
     do transiente e maior que um quarto do periodo (20 kHz com dt de 0,7 ms), o pino do GPIO faz sigma-delta (liga ou
     desliga a cada passo para a MEDIA ser o duty) — desenhar essas amostras dava um trem de bits na "frequencia" do
     passo, sem nada a ver com o PWM. Nesse caso a net do GPIO (e a que ele alimenta por um resistor, e o dreno/coletor do
     transistor que ele chaveia, invertida) mostra a onda quadrada ideal com f e duty do GPIO, marcada "reconstruido". */
  const BASES_OSC = [1e-6, 2e-6, 5e-6, 1e-5, 2e-5, 5e-5, 1e-4, 2e-4, 5e-4, 1e-3, 2e-3, 5e-3, 1e-2, 2e-2, 5e-2, 0.1, 0.2, 0.5, 1];
  const DIV_X = 10;
  /** O PWM que manda numa net: {f, duty, inverte, rapido, gpio} ou null. */
  function pwmDaNet(net) {
    const els = st.sim ? st.sim.elementos : [];
    const dt = st.sim ? st.sim.dt : dtDaVelocidade();
    const deGpio = n => { const e = els.find(x => x.gpio && x.nos && x.nos[0] === n && x.gpio.modo === 'pwm'); if (e) e.gpio._nosPino = e.nos; return e ? e.gpio : null; };
    const viaR = n => { for (const r of els) if (r.tipo === 'R' && r.nos && r.nos.includes(n)) { const o = r.nos[0] === n ? r.nos[1] : r.nos[0]; const g = deGpio(o); if (g) return g; } return null; };
    const monta = (g, inverte) => { const f = +g.f || 1000, duty = g.duty == null ? 0.5 : +g.duty; return { f, duty, inverte, rapido: dt * f > 0.25, gpio: g }; };
    let g = deGpio(net) || viaR(net);
    if (g) return monta(g, false);
    for (const q of els) {
      if (!q.nos || !/MOSFET|BJT/.test(q.papel || '') || q.nos[0] !== net) continue;   // dreno / coletor
      g = deGpio(q.nos[1]) || viaR(q.nos[1]);
      if (g) return monta(g, true);
    }
    return null;
  }
  /** Medidas de um sinal amostrado [{t, v}]: {lo, hi, med, f?, duty?} (f so com 3 bordas de subida ou mais). */
  function medidas(A) {
    let lo = Infinity, hi = -Infinity, soma = 0, n = 0;
    for (const a of A) if (isFinite(a.v)) { lo = Math.min(lo, a.v); hi = Math.max(hi, a.v); soma += a.v; n++; }
    const out = { lo, hi, med: n ? soma / n : NaN };
    if (!(hi - lo > 0.05)) return out;
    const meio = (lo + hi) / 2, histerese = (hi - lo) * 0.1;
    // instante do cruzamento do meio por interpolação linear (com 8 amostras por período o duty fica certo)
    const cruza = i => { const a = A[i - 1], b = A[i]; return b.v === a.v ? b.t : a.t + (meio - a.v) / (b.v - a.v) * (b.t - a.t); };
    let alto = A[0].v > meio;
    const subidas = [], bordas = [];
    for (let i = 1; i < A.length; i++) {
      const v = A[i].v;
      if (!alto && v > meio + histerese) { alto = true; let k = i; while (k > 1 && A[k - 1].v > meio) k--; const t = cruza(k); subidas.push(t); bordas.push([t, 1]); }
      else if (alto && v < meio - histerese) { alto = false; let k = i; while (k > 1 && A[k - 1].v < meio) k--; bordas.push([cruza(k), 0]); }
    }
    if (subidas.length >= 3) {
      const t0 = subidas[0], t1 = subidas[subidas.length - 1];
      out.f = (subidas.length - 1) / (t1 - t0);
      let h = 0, desde = null;
      for (const [t, sobe] of bordas) {
        if (t < t0 || t > t1) continue;
        if (sobe) desde = t; else if (desde != null) { h += t - desde; desde = null; }
      }
      out.duty = h / (t1 - t0);
    }
    return out;
  }
  /** Base de tempo em s/div: a escolhida, ou auto (5 periodos do PWM ou do sinal medido; sem periodo, a janela toda). */
  function baseDe(escolha, canais) {
    if (escolha && escolha !== 'auto') return +escolha;
    for (const c of canais) { const f = c.pwm && c.pwm.rapido ? c.pwm.f : c.med && c.med.f; if (f) return BASES_OSC.find(b => b * DIV_X >= 5 / f) || 1; }
    const A = canais[0] && canais[0].A || []; const jan = A.length > 1 ? A[A.length - 1].t - A[0].t : 0;
    return jan > 0 ? jan / DIV_X : 1e-3;
  }
  /**
   * Desenha os canais num canvas. canais: [{nome, cor, A:[{t,v}], pwm (de pwmDaNet) | null}]; base: 'auto' ou s/div.
   * Devolve as linhas da legenda [{nome, cor, texto, aviso}].
   */
  function desenhaCanais(cv, canais, base) {
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth || 340, H = cv.clientHeight || 160;
    if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    c.strokeStyle = 'rgba(255,255,255,.07)'; c.lineWidth = 1;
    for (let i = 1; i < 4; i++) { c.beginPath(); c.moveTo(0, H * i / 4); c.lineTo(W, H * i / 4); c.stroke(); }
    for (let i = 1; i < DIV_X; i++) { c.beginPath(); c.moveTo(W * i / DIV_X, 0); c.lineTo(W * i / DIV_X, H); c.stroke(); }
    for (const k of canais) k.med = k.A.length > 1 ? medidas(k.A) : null;
    const sdiv = baseDe(base, canais), jan = sdiv * DIV_X;
    // escala vertical comum
    let lo = Infinity, hi = -Infinity;
    for (const k of canais) {
      const nos = k.pwm && k.pwm.rapido && !k.pwm.inverte && k.pwm.gpio && k.pwm.gpio._nosPino, rv = st.res && st.res.v;
      if (nos && rv && isFinite(rv[nos[1]])) { lo = Math.min(lo, rv[nos[2]] || 0); hi = Math.max(hi, rv[nos[1]]); continue; }
      if (k.med) { lo = Math.min(lo, k.med.lo); hi = Math.max(hi, k.med.hi); }
    }
    if (!(hi > lo)) { hi = (isFinite(lo) ? lo : 0) + 0.5; lo = hi - 1; }
    const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
    const Y = v => H - (v - lo) / (hi - lo) * H;
    const legenda = [];
    canais.forEach(k => {
      c.strokeStyle = k.cor; c.lineWidth = 1.6; c.beginPath();
      const A = k.A, m = k.med;
      if (k.pwm && k.pwm.rapido && m) {
        // reconstruido: onda quadrada ideal entre o minimo e o maximo do pino (o sigma-delta vai de 0 a Vdd)
        // niveis: a alimentacao do proprio pino (Vdd/terra do GPIO); no dreno/coletor, o que o sinal amostrado mostra
        const nos = k.pwm.gpio && k.pwm.gpio._nosPino, rv = st.res && st.res.v;
        const vdd = !k.pwm.inverte && nos && rv && isFinite(rv[nos[1]]) ? rv[nos[1]] : null, vgnd = vdd != null && isFinite(rv[nos[2]]) ? rv[nos[2]] : 0;
        const per = 1 / k.pwm.f, d = k.pwm.inverte ? 1 - k.pwm.duty : k.pwm.duty, vH = vdd != null ? vdd : m.hi, vL = vdd != null ? vgnd : m.lo;
        let t = 0; c.moveTo(0, Y(d > 0 ? vH : vL));
        while (t < jan) {
          const xs = t / jan * W, xd = Math.min(1, (t + d * per) / jan) * W, xf = Math.min(1, (t + per) / jan) * W;
          if (d > 0) { c.lineTo(xs, Y(vH)); c.lineTo(xd, Y(vH)); }
          if (d < 1) { c.lineTo(xd, Y(vL)); c.lineTo(xf, Y(vL)); }
          t += per;
        }
        c.stroke();
        legenda.push({ nome: k.nome, cor: k.cor, texto: `PWM ${fmt(k.pwm.f, 'Hz')} · duty ${Math.round(d * 100)} % · ${fmt(vL, 'V')}…${fmt(vH, 'V')}`,
          aviso: `reconstruído: o passo da simulação (${fmt(st.sim ? st.sim.dt : 0, 's')}) é maior que o período (${fmt(per, 's')}); a simulação usa a média (${fmt(m.med, 'V')})` });
        return;
      }
      if (A.length < 2) { legenda.push({ nome: k.nome, cor: k.cor, texto: 'esperando o sinal…' }); return; }
      // gatilho: a ultima subida que ainda deixa uma janela inteira depois dela; sem subida, rola (os ultimos jan s)
      const tUlt = A[A.length - 1].t;
      let t0 = tUlt - jan;
      if (m && m.hi - m.lo > 0.05 && jan < tUlt - A[0].t) {
        const meio = (m.lo + m.hi) / 2;
        for (let i = A.length - 1; i > 0; i--) if (A[i].t + jan <= tUlt && A[i - 1].v <= meio && A[i].v > meio) { t0 = A[i].t; break; }
      }
      let primeiro = true;
      for (const a of A) {
        if (a.t < t0 - jan * 0.02 || a.t > t0 + jan) continue;
        const x = (a.t - t0) / jan * W, y = Y(a.v);
        if (primeiro) { c.moveTo(x, y); primeiro = false; } else c.lineTo(x, y);
      }
      c.stroke();
      const ult = A[A.length - 1].v;
      const fTxt = m && m.f ? ` · ${fmt(m.f, 'Hz')} · duty ${Math.round(m.duty * 100)} %` : '';
      legenda.push({ nome: k.nome, cor: k.cor, texto: `${fmt(m.lo, 'V')}…${fmt(m.hi, 'V')} · agora ${fmt(ult, 'V')}${fTxt}`,
        aviso: k.pwm && !k.pwm.rapido ? '' : (k.pwm ? '' : '') });
    });
    c.fillStyle = '#9ca3af'; c.font = '10px ui-monospace, monospace';
    c.fillText(fmt(hi, 'V'), 4, 11); c.fillText(fmt(lo, 'V'), 4, H - 4);
    const rot = fmt(sdiv, 's') + '/div'; c.fillText(rot, W - c.measureText(rot).width - 4, H - 4);
    return legenda;
  }
  /** Seletor da base de tempo (auto + 1 µs/div … 1 s/div). */
  function seletorBase(valor, aoMudar) {
    const s = document.createElement('select');
    s.className = 'sim-base'; s.title = 'Base de tempo (por divisão; a tela tem 10 divisões)';
    s.append(new Option('auto', 'auto'));
    for (const b of BASES_OSC) s.append(new Option(fmt(b, 's') + '/div', String(b)));
    s.value = String(valor || 'auto');
    s.onchange = () => aoMudar(s.value);
    for (const ev of ['mousedown', 'click', 'keydown', 'wheel']) s.addEventListener(ev, e => e.stopPropagation());
    return s;
  }
  /** Velocidade que deixa ver o PWM de verdade (passo <= 1/8 do periodo). */
  function velocidadePara(f) { return Math.max(1e-6, 1440 / (8 * f)); }

  const CORES_OSC = ['#facc15', '#22d3ee', '#f472b6', '#a3e635'];
  function oscDesenha() {
    const cv = painel.oscCanvas();
    if (!cv || !st.osc || cv.offsetParent === null) return;
    const A = st.amostras;
    if (A.length < 2 || !st.osciloscopio.length) {
      const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
      if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
      const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
      c.fillStyle = '#6b7280'; c.font = '11px system-ui';
      c.fillText(st.modo === 'dc' ? 'o osciloscópio anda no Tempo real' : st.osciloscopio.length ? 'esperando amostras…' : 'clique num fio ou pino › Mostrar no osciloscópio', 8, H / 2);
      painel.oscLegenda(null);
      return;
    }
    const canais = st.osciloscopio.map((n, k) => ({ nome: n, cor: CORES_OSC[k], A: A.map(a => ({ t: a.t, v: a.v[k] })), pwm: pwmDaNet(n) }));
    painel.oscLegenda(desenhaCanais(cv, canais, st.oscBase || 'auto'));
  }

  /* ------------------------------------------------------------------------------------------------ o painel */
  const painel = (() => {
    let el = null, refs = {};
    let calcRef = null;
    function cria() {
      css();
      const v = VISTA(); if (!v) return;
      const host = v.canvas().parentElement;
      el = $c('div', 'sim-p' + (st.aba ? ' fixo' : '')); el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Simulação');
      const hd = $c('div', 'sim-hd');
      refs.pt = $c('span', 'sim-pt'); refs.t = $c('span', 'sim-t', '');
      refs.play = $c('button', 'sim-b', '⏸'); refs.play.title = 'Pausar / continuar (o tempo da simulação)';
      const rel = $c('button', 'sim-b', '⟲'); rel.title = 'Religar: tudo descarregado em t = 0, como ao ligar a placa';
      const x = $c('button', 'sim-b', '×'); x.title = 'Desligar a simulação';
      const mini = $c('button', 'sim-b', '▾'); mini.title = 'Recolher/abrir o painel (a folha fica livre; a simulação continua)';
      mini.onclick = () => { el.classList.toggle('mini'); mini.textContent = el.classList.contains('mini') ? '▸' : '▾'; try { localStorage.setItem('nexoSim.mini', el.classList.contains('mini') ? '1' : '0'); } catch (_e) { /* ok */ } };
      try { if (localStorage.getItem('nexoSim.mini') === '1') { el.classList.add('mini'); mini.textContent = '▸'; } } catch (_e) { /* ok */ }
      hd.append(refs.pt, $c('b', null, 'Simulação'), $c('span', 'esp'), refs.t, refs.play, rel, mini, x);
      refs.play.onclick = () => { st.rodando = !st.rodando; pinta(); agenda(); };
      rel.onclick = () => religa();
      x.onclick = () => liga(false);
      if (st.aba) x.hidden = true; else arrasta(hd);
      const corpo = $c('div', 'sim-corpo');
      /* modo e velocidade */
      const sm = $c('div', 'sim-sec');
      sm.append($c('h4', null, 'Análise'));
      const seg = $c('div', 'sim-seg');
      refs.mTempo = $c('button', null, 'Tempo real'); refs.mDc = $c('button', null, 'DC (regime)');
      refs.mTempo.title = 'Transiente: liga a placa em t = 0 (capacitores descarregados) e anda no tempo — 555, PWM, RC, relé';
      refs.mDc.title = 'Ponto de operação: o regime permanente (capacitor aberto, indutor em curto, PWM pela média)';
      refs.mTempo.onclick = () => { st.modo = 'tempo'; gravaCfg(); religa(); pinta(); };
      refs.mDc.onclick = () => { st.modo = 'dc'; gravaCfg(); religa(); pinta(); };
      seg.append(refs.mTempo, refs.mDc);
      const lv = $c('div', 'sim-linha');
      refs.vel = $c('input'); refs.vel.type = 'range'; refs.vel.min = -6; refs.vel.max = 1; refs.vel.step = 0.25;
      refs.velT = $c('span', 'sim-t', '');
      refs.vel.oninput = () => { st.velocidade = Math.pow(10, +refs.vel.value); gravaCfg(); pinta(); };
      lv.append($c('span', null, 'Velocidade'), refs.vel, refs.velT);
      sm.append(seg, lv); corpo.append(sm);
      /* o que mostrar */
      const sv = $c('div', 'sim-sec'); sv.append($c('h4', null, 'Mostrar'));
      const chips = $c('div', 'sim-chips'); refs.chips = {};
      for (const [k, rot] of [['pontos', 'Corrente (pontos)'], ['cores', 'Cores de tensão'], ['tensoes', 'Tensão nas nets'], ['valores', 'Valores nos componentes'], ['brilho', 'Brilho dos LEDs']]) {
        const ch = $c('span', 'sim-chip', rot); ch.onclick = () => { st.mostrar[k] = !st.mostrar[k]; gravaCfg(); pinta(); const vv = VISTA(); if (vv) vv.redesenha(); };
        refs.chips[k] = ch; chips.append(ch);
      }
      sv.append(chips); corpo.append(sv);
      /* fontes */
      const sf = $c('div', 'sim-sec'); const hf = $c('h4'); hf.append($c('span', null, 'Fontes'), $c('span', 'esp'));
      refs.fontes = $c('div'); sf.append(hf, refs.fontes); corpo.append(sf);
      /* entradas e saidas da placa: os conectores, pino a pino (pedido do dono: "aplicar tensão nas entradas da pcb
         pelo simulador e ver os valores simulados") */
      const se = $c('div', 'sim-sec'); const he = $c('h4'); he.append($c('span', null, 'Entradas e saídas (conectores)'), $c('span', 'esp'));
      refs.es = $c('div', 'sim-es'); se.append(he, refs.es); corpo.append(se);
      /* resumo e alertas */
      const sr = $c('div', 'sim-sec'); sr.append($c('h4', null, 'Resumo'));
      refs.res = $c('div', 'sim-res'); refs.al = $c('ul', 'sim-al'); sr.append(refs.res, refs.al); corpo.append(sr);
      /* calculos */
      const sc = $c('div', 'sim-sec'); const hc = $c('h4');
      refs.olho = $c('button', 'sim-b', ''); refs.olho.title = 'Mostrar ou suprimir a área de cálculos';
      refs.olho.onclick = () => { st.calc = !st.calc; gravaCfg(); pinta(); calculos(calcRef); };
      refs.solta = $c('button', 'sim-b', '📌'); refs.solta.title = 'Fixado no componente clicado — clique para soltar e seguir o mouse';
      refs.solta.onclick = () => { st.fixo = null; pinta(); };
      hc.append($c('span', null, 'Cálculos'), $c('span', 'esp'), refs.solta, refs.olho);
      refs.calc = $c('div', 'sim-calc'); sc.append(hc, refs.calc); corpo.append(sc);
      /* osciloscopio */
      const so = $c('div', 'sim-sec'); const ho = $c('h4');
      refs.oscB = $c('button', 'sim-b', ''); refs.oscB.onclick = () => { st.osc = !st.osc; gravaCfg(); pinta(); };
      refs.oscBase = seletorBase(st.oscBase || 'auto', v => { st.oscBase = v; gravaCfg(); oscDesenha(); });
      ho.append($c('span', null, 'Osciloscópio'), $c('span', 'esp'), refs.oscBase, refs.oscB);
      refs.osc = $c('canvas', 'sim-osc'); refs.oscL = $c('div', 'sim-osc-l');
      refs.oscBox = $c('div'); refs.oscBox.append(refs.osc, refs.oscL);
      so.append(ho, refs.oscBox); corpo.append(so);
      el.append(hd, corpo);
      for (const ev of ['mousedown', 'pointerdown', 'wheel', 'contextmenu', 'dblclick', 'keydown']) el.addEventListener(ev, e => e.stopPropagation(), { passive: ev === 'wheel' });
      host.append(el);
    }
    function arrasta(hd) {
      hd.addEventListener('mousedown', e => {
        if (e.target.closest('button')) return;
        const r = el.getBoundingClientRect(), pr = el.parentElement.getBoundingClientRect();
        const ox = e.clientX - r.left, oy = e.clientY - r.top;
        const mv = ev => { el.style.left = Math.max(0, Math.min(pr.width - r.width, ev.clientX - pr.left - ox)) + 'px'; el.style.top = Math.max(0, Math.min(pr.height - 40, ev.clientY - pr.top - oy)) + 'px'; el.style.right = 'auto'; };
        const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
        window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
      });
    }
    function pinta() {
      if (!el) return;
      refs.play.textContent = st.rodando ? '⏸' : '▶';
      refs.mTempo.classList.toggle('on', st.modo === 'tempo'); refs.mDc.classList.toggle('on', st.modo === 'dc');
      refs.vel.value = Math.log10(st.velocidade); refs.vel.disabled = st.modo === 'dc';
      refs.velT.textContent = st.velocidade >= 1 ? (st.velocidade === 1 ? 'tempo real' : st.velocidade.toFixed(0) + '×') : fmt(st.velocidade, 's') + '/s';
      for (const [k, ch] of Object.entries(refs.chips)) ch.classList.toggle('on', !!st.mostrar[k]);
      refs.olho.textContent = st.calc ? '👁 ligado' : '👁 suprimido';
      refs.olho.classList.toggle('on', st.calc);
      refs.calc.hidden = !st.calc;
      refs.solta.hidden = !st.fixo;
      refs.oscB.textContent = st.osc ? 'esconder' : 'mostrar';
      refs.oscBox.hidden = !st.osc;
    }
    function atualiza(forca) {
      if (!el) return;
      pinta();
      const r = st.res, a = st.an;
      refs.pt.className = 'sim-pt' + (st.erro ? ' erro' : !st.rodando ? ' pausa' : (r && (!r.ok || r.aviso)) || (a && a.resumo.alertas.length) ? ' aviso' : '');
      refs.pt.title = st.erro || (r && r.aviso) || (a && a.resumo.alertas.length ? a.resumo.alertas.length + ' alerta(s)' : 'ok');
      refs.t.textContent = r ? (r.modo === 'dc' ? 'DC' : 't = ' + fmt(r.t, 's')) : '';
      /* fontes (redesenha so quando muda a lista: senao o input perde o foco) */
      const assin = st.mt ? JSON.stringify(st.mt.fontes.map(f => [f.net, f.v, f.origem])) : '';
      if (forca || assin !== refs.assinFontes) {
        refs.assinFontes = assin;
        refs.fontes.textContent = '';
        if (st.mt) for (const f of st.mt.fontes) {
          const ln = $c('div', 'sim-fonte');
          const nm = $c('span', 'nm', f.net); nm.title = f.motivo; nm.append($c('span', 'or ' + f.origem, f.origem));
          const inp = $c('input'); inp.value = String(f.v).replace('.', ','); inp.title = 'tensão (V) — Enter aplica';
          inp.onkeydown = ev => { if (ev.key === 'Enter') { const v = parseFloat(String(inp.value).replace(',', '.')); if (isFinite(v)) defineFonte(f.net, { v }); } };
          inp.onchange = () => { const v = parseFloat(String(inp.value).replace(',', '.')); if (isFinite(v) && v !== f.v) defineFonte(f.net, { v }); };
          const sel = $c('select'); sel.className = 'sim-b';
          for (const [k, rot] of [['dc', 'DC'], ['seno', '∿'], ['quadrada', '⊓'], ['triangular', '△'], ['off', 'off']]) { const o = $c('option', null, rot); o.value = k; sel.append(o); }
          const cf = st.cfg.fontes[f.net];
          sel.value = cf && cf.desligada ? 'off' : f.onda ? f.onda.forma : 'dc';
          sel.title = 'forma de onda (seno, quadrada e triangular com 1 kHz; mude a frequência pelo MCP sim_fonte)';
          sel.onchange = () => {
            const k = sel.value;
            if (k === 'off') defineFonte(f.net, { desligada: true });
            else if (k === 'dc') defineFonte(f.net, { v: f.v, onda: null, desligada: false });
            else defineFonte(f.net, { v: f.v, desligada: false, onda: { forma: k, v: f.v, f: (f.onda && f.onda.f) || 1000, off: k === 'seno' ? 0 : 0, duty: 0.5 } });
          };
          ln.append(nm, inp, sel);
          const iT = $c('span', 'i', ''); ln.append(iT); f._el = iT;
          refs.fontes.append(ln);
        }
        if (st.mt && !st.mt.fontes.length) refs.fontes.append($c('div', 'sim-calc', 'Nenhuma fonte. Clique num fio › Fonte, ou nomeie as nets de alimentação (+5V, 3V3, 12V…).'));
      }
      if (st.mt && a) for (const f of a.fontes) if (f._el) f._el.textContent = (f.origem === 'suposta' ? '⚠ ' : '') + 'entrega ' + fmt(f.i, 'A') + ' · ' + fmt(f.p, 'W') + (f.origem === 'suposta' ? ' — tensão suposta' : '');
      pintaConectores(forca);
      /* resumo */
      refs.res.textContent = '';
      if (a) {
        const kv = (k, v) => refs.res.append($c('span', 'k', k), $c('span', 'v', v));
        kv('Potência das fontes', fmt(a.resumo.potencia, 'W'));
        kv('Componentes simulados', String([...st.mt.comps.values()].filter(c => c.elementos.length).length) + ' de ' + st.mt.comps.size);
        if (r && r.aviso) kv('Motor', r.aviso);
        if (st.erro) kv('Erro', st.erro);
        const sem = [...st.mt.comps.values()].filter(c => c.tipo === 'desconhecido');
        if (sem.length) kv('Sem modelo', sem.slice(0, 5).map(c => c.ref).join(', ') + (sem.length > 5 ? '…' : ''));
      }
      refs.al.textContent = '';
      if (st.mt) for (const av of st.mt.avisos.slice(0, 4)) { const li = $c('li', null, av); li.style.background = 'rgba(96,165,250,.12)'; li.style.color = '#bfdbfe'; li.style.cursor = 'default'; refs.al.append(li); }
      if (a) for (const al of a.resumo.alertas.slice(0, 8)) {
        const li = $c('li'); li.append($c('b', null, al.ref + ' '), document.createTextNode(al.texto));
        li.onclick = () => { const v = VISTA(); if (v) v.focar(al.ref); st.fixo = al.ref; calculos(al.ref); };
        refs.al.append(li);
      }
      if (a && a.resumo.alertas.length > 8) refs.al.append($c('li', null, '+ ' + (a.resumo.alertas.length - 8) + ' alertas'));
      calculos(st.fixo || calcRef);
      /* legenda do osciloscopio */
      refs.oscL.textContent = '';
      st.osciloscopio.forEach((n, k) => { const s = $c('span'); const i = $c('i'); i.style.background = CORES_OSC[k]; s.append(i, document.createTextNode(n + ' ' + (r ? fmt(r.v[n], 'V') : ''))); s.title = 'clique para tirar'; s.onclick = () => osciloscopio(n, false); refs.oscL.append(s); });
      refs.oscMed = $c('div', 'sim-osc-m'); refs.oscL.append(refs.oscMed);
    }
    /* cada conector com os pinos: o campo aplica a tensão (Enter), vazio = aberto (só mede) */
    function pintaConectores(forca) {
      if (!st.mt || !st.an) return;
      const cons = [...st.mt.comps.values()].filter(c => c.tipo === 'conector' && c.pinos.some(p => p.net));
      const fontes = st.cfg.fontes || {};
      const assin = JSON.stringify([cons.map(c => c.ref + c.pinos.map(p => p.num + p.net).join()), Object.keys(fontes).sort().map(n => n + (fontes[n] && fontes[n].v))]);
      if (forca || assin !== refs.assinEs) {
        refs.assinEs = assin; refs.es.textContent = ''; refs.medidos = [];
        if (!cons.length) refs.es.append($c('div', 'sim-calc', 'O esquema não tem conectores (J, CN, P, X…). Para aplicar tensão em qualquer ponto: clique no fio › Fonte.'));
        for (const c of cons) {
          const cab = $c('div', 'sim-con'); cab.append($c('b', null, c.ref), $c('span', null, ' ' + (c.comp.comment && !/CONE|CONN/i.test(c.comp.comment) ? c.comp.comment : '')));
          cab.title = 'clique para ver o conector na folha'; cab.style.cursor = 'pointer';
          cab.onclick = () => { const v = VISTA(); if (v) v.focar(c.ref); };
          refs.es.append(cab);
          for (const p of c.pinos.slice().sort((a, b) => String(a.num).localeCompare(String(b.num), undefined, { numeric: true }))) {
            const ln = $c('div', 'sim-pino');
            const nome = $c('span', 'nm', p.num + (p.name && p.name !== String(p.num) ? ' ' + p.name : ''));
            const net = $c('span', 'net', p.net || '—');
            const terra = p.net && (st.mt.terra || []).includes(p.net);
            const inp = $c('input'); inp.placeholder = terra ? 'terra' : 'aberto';
            inp.disabled = !p.net || terra;
            const f = p.net && fontes[p.net];
            const fa = !f && p.net ? st.mt.fontes.find(x => x.net === p.net) : null;
            if (f && !f.desligada && f.v != null) inp.value = String(f.v).replace('.', ',');
            else if (fa) inp.placeholder = String(fa.v).replace('.', ',') + ' auto';
            inp.title = 'tensão aplicada neste pino (V) — Enter aplica, vazio = aberto (só mede)';
            const aplica = () => {
              const t = String(inp.value).trim();
              if (!t) { if (fontes[p.net]) defineFonte(p.net, null); return; }
              const v = parseFloat(t.replace(',', '.'));
              if (isFinite(v)) defineFonte(p.net, { v, onda: null, desligada: false });
            };
            inp.onkeydown = ev => { if (ev.key === 'Enter') aplica(); };
            inp.onchange = aplica;
            const med = $c('span', 'med', '');
            ln.append(nome, net, inp, med);
            refs.es.append(ln);
            refs.medidos.push({ el: med, net: p.net, key: c.ref + '-' + p.num, ent: !!(f || fa) });
          }
        }
      }
      for (const m of refs.medidos || []) {
        const pin = st.an.pinos[m.key];
        if (!m.net || !pin) { m.el.textContent = ''; continue; }
        /* na entrada, a corrente que a fonte entrega (o pino do conector em si e so um ponto da net) */
        const fe = m.ent ? st.an.fontes.find(x => x.net === m.net) : null;
        const ii = fe && isFinite(fe.i) ? fe.i : pin.i;
        m.el.textContent = fmt(pin.v, 'V') + (Math.abs(ii) > 1e-7 ? ' · ' + fmt(Math.abs(ii), 'A') : '');
        m.el.title = m.ent ? 'entrada: a fonte entrega ' + fmt(Math.abs(ii), 'A') : (st.res.flutuantes || []).includes(m.net) ? 'flutuando' : 'saída/medida';
        m.el.classList.toggle('ent', m.ent);
      }
    }
    function calculos(ref) {
      if (!el) return;
      calcRef = st.fixo || ref || calcRef;
      refs.solta.hidden = !st.fixo;
      if (!st.calc) return;
      refs.calc.textContent = '';
      const c = calcRef && st.an && st.an.comps[calcRef];
      if (!c) { refs.calc.append($c('div', 'vazio', 'Clique num componente para ver as contas (e em Analisar para abrir a lista ou o osciloscópio).')); return; }
      refs.calc.append($c('div', 'tit', c.titulo));
      if (!c.linhas.length) refs.calc.append($c('div', 'vazio', 'Sem contas para este componente.'));
      for (const l of c.linhas) {
        const d = $c('div', 'l'); const lt = $c('div', 'lt'); lt.append($c('span', null, l.t), $c('span', null, l.r)); d.append(lt);
        if (l.f) d.append($c('div', 'lf', l.f));
        refs.calc.append(d);
      }
      for (const a of c.alertas) refs.calc.append($c('div', 'al', '⚠ ' + a));
      const inf = info(calcRef), cc = inf ? Object.assign({}, inf.comp, { valor: inf.valorTxt }) : null;
      const d = inf && st.dados ? C.dadosDe(st.dados, cc, inf.tipo) : null;
      if (d) {
        const box = $c('div', 'ds');
        box.append($c('b', null, 'Datasheet' + (d.fabricante ? ' · ' + d.fabricante : '')));
        if (d.resumo) box.append($c('div', null, d.resumo));
        if (d.alimentacao) box.append($c('div', null, 'Alimentação: ' + [d.alimentacao.vmin, d.alimentacao.vmax].map(x => x == null ? '?' : fmt(+x, 'V')).join(' a ')));
        if (d.datasheet_url) { const a = $c('a', null, 'abrir o datasheet'); a.href = d.datasheet_url; a.target = '_blank'; box.append(a); }
        refs.calc.append(box);
      } else if (inf && C.chaveDados(cc, inf.tipo)) refs.calc.append($c('div', 'vazio', 'Sem dados de datasheet — use "Recolher informações".'));
    }
    function oscLegenda(leg) {
      const m = refs.oscMed; if (!m) return;
      m.textContent = '';
      if (!leg) return;
      let fRapido = 0;
      for (const l of leg) {
        const d = $c('div'); const i = $c('i'); i.style.background = l.cor;
        d.append(i, document.createTextNode(l.texto));
        if (l.aviso) { const a = $c('div', 'av', l.aviso); d.append(a); const p = pwmDaNet(l.nome); if (p) fRapido = Math.max(fRapido, p.f); }
        m.append(d);
      }
      if (fRapido) {
        const b = $c('button', 'sim-b', 'ver o PWM de verdade');
        b.title = 'Deixa a simulação lenta o bastante (passo ≤ 1/8 do período) para o sinal amostrado mostrar o PWM — a placa anda bem devagar';
        b.onclick = () => { st.velocidade = velocidadePara(fRapido); st.amostras = []; gravaCfg(); st.sujo = true; agenda(); pinta(); };
        m.append(b);
      }
    }
    return {
      abre() { if (!el) cria(); if (el) { el.hidden = false; atualiza(true); } },
      fecha() { if (el) el.hidden = true; },
      atualiza, calculos, oscCanvas: () => refs.osc || null, oscLegenda,
    };
  })();

  /* ------------------------------------------------------------------------------------------------ o botao na barra */
  const botao = (() => {
    let b = null;
    /* dentro do hub, o botao do Esquema leva para a aba Simulador; na propria aba nao ha botao (ja simula) */
    const topo = () => { try { return window.top !== window && typeof window.top.goTab === 'function' ? window.top : null; } catch (_e) { return null; } };
    function poe() {
      const tb = document.getElementById('schtb');
      if (!tb || b || st.aba) return;
      b = document.createElement('button');
      b.id = 'btnSim';
      b.title = 'Simular o circuito: tensão e corrente na folha, como no Falstad (clique num ponto › Analisar; clique na chave; roda no potenciômetro)';
      b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M2 12h3l2-6 4 12 3-9 2 3h6"/></svg><span class="lb">Simular</span>';
      b.addEventListener('click', () => { const t = topo(); if (t && !st.ligado) t.goTab('sim'); else liga(); });
      if (topo()) b.title = 'Abrir este esquema na aba Simulador: tensão e corrente na folha, como no Falstad';
      const erc = document.getElementById('btnErc');
      if (erc && erc.nextSibling) tb.insertBefore(b, erc.nextSibling); else tb.append(b);
    }
    function pinta() { if (b) { b.classList.toggle('on', st.ligado); b.setAttribute('aria-pressed', st.ligado ? 'true' : 'false'); } }
    return { poe, pinta };
  })();

  /* ------------------------------------------------------------------------------------------------ ligar na vista */
  function instala() {
    const v = VISTA();
    if (!v) return false;
    botao.poe();
    const host = v.canvas().parentElement;
    host.addEventListener('mousemove', aoMover, { passive: true });
    host.addEventListener('mouseleave', () => { st.hover = null; dica.esconde(); }, { passive: true });
    host.addEventListener('mousedown', aoApertar, true);
    host.addEventListener('wheel', aoRodar, { capture: true, passive: false });
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && menu.aberto()) menu.fecha(); });
    carregaDados();
    if (st.aba) areaDeSimulacao(host);
    return true;
  }
  /* A AREA DE SIMULACAO (a aba Simulador do hub, ?modo=sim). Pedido do dono: "as ferramentas que aparecem na visão de
     esquema e PCB são completamente diferentes das ferramentas para construir; é uma área completamente nova, não traz
     nenhuma das ferramentas" e "o background é preto, as folhas no modo escuro, sem texto e sem template, só os pinos".
     Sai a barra de desenho, o menu da folha, o painel da direita, a busca e o rodape; a folha fica escura (paleta do
     HubDraw so neste iframe; o template e os textos nao saem: window.__simVisual) e nada se edita — navegar (roda,
     arrastar com o botao direito/meio) e as interacoes da simulacao. A barra da simulacao fica no canto. */
  function areaDeSimulacao(host) {
    /* UMA simulacao por projeto: a aba Simulador se registra no topo (window.top.__nexoSimAba[projeto]); o Simular da
       aba Esquema do mesmo projeto passa a ela os pedidos do MCP/NexoCode e nao publica para a PCB (antes as duas
       respondiam alternadas e o painel do motor do NexoCode via dois motores, com tempos diferentes) */
    try {
      const t = window.top, pj = new URLSearchParams(location.search).get('p') || '';
      if (t && pj) {
        t.__nexoSimAba = t.__nexoSimAba || {};
        t.__nexoSimAba[pj] = window;
        window.addEventListener('pagehide', () => { try { if (t.__nexoSimAba[pj] === window) delete t.__nexoSimAba[pj]; } catch (_e) { /* ok */ } });
      }
    } catch (_e) { /* outra origem */ }
    /* a barra de menus do hub (Arquivo, Editar, Colocar...) e da construcao: a area de simulacao nao a oferece */
    try { Object.defineProperty(window, '__hubMenus', { configurable: true, get: () => null, set: () => {} }); } catch (_e) { /* ok */ }
    const css = document.createElement('style');
    css.textContent = '#schtb, #sfMenu, #splitR, #props, #status, #schBusca, .erc{display:none !important} body{background:#000 !important}';
    document.head.append(css);
    window.__simVisual = true;
    /* as marcas do DRC da construcao (triangulo no pino solto, contorno do fora do almoxarifado) nao sao da simulacao */
    try { window.ercMarcas = false; } catch (_e) { /* ok */ }
    const D = window.HubDraw;
    if (D && D.SCH) Object.assign(D.SCH, { sheet: '#0b0e14', border: '#1f2937', grid: '#111722', body: '#7dd3fc', fill: '#0f1a2a', pin: '#7dd3fc',
      pinnum: '#94a3b8', wire: '#334155', junction: '#64748b', label: '#cbd5e1', power: '#e2e8f0', text: '#cbd5e1', port: '#64748b', portFill: '#1e293b', portText: '#e2e8f0' });
    document.documentElement.style.setProperty('--sunken', '#000000');
    window.dispatchEvent(new Event('hubtema'));
    /* nada se edita: o clique esquerdo que a simulacao nao usou nao chega a vista; teclas so nos campos da simulacao */
    host.addEventListener('mousedown', e => { if (e.button === 0) e.stopPropagation(); }, true);
    host.addEventListener('dblclick', e => e.stopPropagation(), true);
    host.addEventListener('contextmenu', e => { e.stopPropagation(); e.preventDefault(); }, true);
    window.addEventListener('keydown', e => {
      const t = e.target;
      if (t && ((t.closest && t.closest('.sim-p, .sim-menu, .sim-tb')) || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === 'Escape') { menu.fecha(); return; }
      e.stopPropagation(); e.preventDefault();
    }, true);
    const tb = $c('div', 'sim-tb');
    const bt = (rot, tit, fn) => { const b = $c('button', null, rot); b.title = tit; b.onclick = fn; tb.append(b); return b; };
    bt('⤢ Enquadrar', 'Enquadrar a folha', () => enquadra());
    tb.append($c('span', 'sep'));
    const fer = {};
    const poeFer = k => { st.ferramenta = k; for (const [q, b] of Object.entries(fer)) b.classList.toggle('on', q === k); };
    fer.sondar = bt('◎ Sondar', 'Mouse no pino ou no fio: tensão, corrente, sinal e datasheet; clique: o menu (GPIO, fonte, osciloscópio)', () => poeFer('sondar'));
    fer.ponta = bt('∿ Ponta de prova', 'Clique num fio ou pino: entra (ou sai) do osciloscópio', () => poeFer('ponta'));
    fer.tensao = bt('⚡ Aplicar tensão', 'Clique num fio ou pino: digite a tensão para aplicar naquela net', () => poeFer('tensao'));
    poeFer('sondar');
    /* as folhas (o menu da folha saiu da area): um seletor quando o projeto tem mais de uma */
    const v0 = VISTA();
    if (v0 && v0.folhas && v0.folhas().length > 1) {
      tb.append($c('span', 'sep'));
      const sel = $c('select'); sel.title = 'Folha do esquema';
      sel.style.cssText = 'height:30px;border-radius:7px;background:#111827;color:#e5e7eb;border:1px solid rgba(255,255,255,.15);padding:0 6px';
      v0.folhas().forEach((n, i) => { const o = $c('option', null, n); o.value = i; sel.append(o); });
      sel.value = v0.folha();
      sel.onchange = () => { v0.irFolha(+sel.value); st.folhaFluxo = -1; setTimeout(enquadra, 100); };
      tb.append(sel);
    }
    tb.append($c('span', 'sep'));
    bt('ⓘ Recolher informações', 'A IA busca o datasheet de cada componente na internet e mapeia os pinos (função, limites); fica salvo no componente, na biblioteca', () => recolher());
    for (const ev of ['mousedown', 'pointerdown', 'wheel', 'contextmenu', 'dblclick']) tb.addEventListener(ev, e => e.stopPropagation(), { passive: ev === 'wheel' });
    host.append(tb);
    setTimeout(() => { window.dispatchEvent(new Event('resize')); liga(true); setTimeout(enquadra, 500); }, 300);
  }
  function enquadra() {
    const v = VISTA(); if (!v || !st.comps) return;
    const si = v.folha(); let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
    for (const c of st.comps) if (c.folha === si) for (const p of c.pinos) { x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y); x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y); }
    if (x1 > x2) return;
    const m = 400, w = x2 - x1 + 2 * m;
    v.cam().fit({ x1: x1 - m, y1: y1 - m, x2: x2 + m + (st.aba ? w * 0.35 : 0), y2: y2 + m });
  }
  /* RECOLHER INFORMACOES: a IA (o Claude do hub, hub-chat.js) acha o datasheet de cada componente e grava a pinagem no
     componente (Libs/componentes-dados.json, sincronizado com o NexoBD) pelas ferramentas sim_datasheet_* do MCP */
  function recolher() {
    const v = VISTA(); const proj = v && v.projeto ? v.projeto() : '';
    const cc = c => Object.assign({}, c.comp, { valor: c.valorTxt });
    const pend = st.mt ? [...st.mt.comps.values()].filter(c => C.chaveDados(cc(c), c.tipo) && !C.dadosDe(st.dados, cc(c), c.tipo)) : [];
    const lista = [...new Set(pend.map(c => C.chaveDados(cc(c), c.tipo)))];
    const texto = 'Recolha as informações de datasheet dos componentes do projeto "' + proj + '" para o simulador do NexoEletric. '
      + 'Rode sim_datasheet_pendentes {projeto:"' + proj + '"}; para cada componente pendente (' + (lista.slice(0, 20).join(', ') || 'nenhum pendente: confira os que já têm dados') + '), '
      + 'ache o datasheet oficial na internet (IntegrateBrowser: pesquisar e ler_links), leia a pinagem e grave com sim_datasheet_gravar: '
      + 'cada pino (número do encapsulamento usado no esquema, nome, função, tipo — alimentação, terra, entrada, saída, E/S, analógico —, descrição curta, tensão e corrente máximas), '
      + 'a faixa de alimentação, o fabricante, um resumo de uma linha e o link do datasheet. Não invente: o que não estiver no datasheet fica de fora. '
      + 'No fim, diga quantos componentes ficaram com dados e quais não foram achados.';
    let topo = null;
    try { topo = window.top !== window ? window.top : null; } catch (_e) { topo = null; }
    const chat = topo && topo.__hubChat;
    if (chat && typeof chat.envia === 'function') {
      try { if (typeof chat.abre === 'function') chat.abre(); } catch (_e) { /* ok */ }
      setTimeout(() => {
        let r;
        try { r = chat.envia(texto); } catch (_e) { r = undefined; }
        if (r === undefined) copiaPedido(texto, 'entre na IA do hub (botão IA no topo) e cole o pedido');
        else aviso('A IA está recolhendo os datasheets (' + lista.length + ' componente(s)); os dados aparecem aqui quando ela gravar.', 'ok');
      }, 400);
      vigiaDados();
    } else copiaPedido(texto, 'abra a IA (botão IA do hub ou o Claude Code) e cole o pedido');
    return { pendentes: lista, texto };
  }
  function copiaPedido(texto, onde) {
    try { navigator.clipboard.writeText(texto); } catch (_e) { /* sem clipboard */ }
    aviso('Pedido copiado: ' + onde + '.', 'info');
    vigiaDados();
  }
  function aviso(t, k) { if (window.HubDialog && HubDialog.toast) HubDialog.toast(t, k || 'info', 6000); else console.log(t); }
  /* rele os dados enquanto a IA trabalha (a cada 10 s por 15 min) */
  let vigia = 0;
  function vigiaDados() {
    if (vigia) return;
    let n = 0;
    vigia = setInterval(async () => { await carregaDados(); painel.atualiza(true); if (++n > 90) { clearInterval(vigia); vigia = 0; } }, 10000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { if (!instala()) setTimeout(instala, 500); });
  else if (!instala()) setTimeout(instala, 500);

  /* ------------------------------------------------------------------------------------------------ MCP */
  function estado(detalhe) {
    const a = st.an, r = st.res;
    const out = { ligado: st.ligado, rodando: st.rodando, modo: st.modo, velocidade: st.velocidade, t: r ? r.t : null, ok: r ? r.ok : null, aviso: r ? r.aviso : '', erro: st.erro,
      mostrar: st.mostrar, calculos: st.calc, osciloscopio: st.osciloscopio.slice(), config: st.cfg,
      nexocode: Object.fromEntries(Object.keys(st.nexoCode || {}).map(ref => [ref, ncLigado(ref)]).filter(([, n]) => n).map(([ref, n]) => [ref, { rodando: n.rodando, ha_ms: Date.now() - n.em }])) };
    if (!a) return out;
    out.fontes = a.fontes.map(f => ({ net: f.net, v: f.v, origem: f.origem, motivo: f.motivo, corrente: f.i, potencia: f.p, onda: f.onda || null }));
    out.potencia_total = a.resumo.potencia;
    out.alertas = a.resumo.alertas;
    out.nets = Object.fromEntries(Object.entries(a.nets).filter(([n]) => !n.includes('#')).map(([n, x]) => [n, { v: x.v, flutuante: x.flutuante }]));
    out.componentes = Object.fromEntries(Object.entries(a.comps).map(([ref, c]) => [ref, detalhe ? { titulo: c.titulo, tipo: c.tipo, potencia: c.p, linhas: c.linhas, alertas: c.alertas } : { tipo: c.tipo, titulo: c.titulo, potencia: c.p, alertas: c.alertas.length }]));
    return out;
  }
  function espera(ms) { return new Promise(r => setTimeout(r, ms)); }
  function conectores() {
    if (!st.mt || !st.an) return [];
    return [...st.mt.comps.values()].filter(c => c.tipo === 'conector').map(c => ({ ref: c.ref, comment: c.comp.comment || '',
      pinos: c.pinos.map(p => { const pin = st.an.pinos[c.ref + '-' + p.num] || {}; const f = st.mt.fontes.find(x => x.net === p.net);
        return { pino: p.num, nome: p.name || '', net: p.net || '', v: pin.v, i: pin.i, entrada: f ? { v: f.v, origem: f.origem, corrente_entregue: (st.an.fontes.find(x => x.net === f.net) || {}).i } : null,
                 terra: !!p.net && (st.mt.terra || []).includes(p.net), flutuando: !!p.net && (st.res.flutuantes || []).includes(p.net) }; }) }));
  }
  async function mcp(a) {
    a = a || {};
    { const w = abaDoProjeto(); if (w) return w.HubSimulador.mcp(a); }   // a aba Simulador do projeto responde
    const acao = a.acao || 'estado';
    const garante = () => { if (!st.ligado) liga(true); if (st.sujo) monta(); };
    switch (acao) {
      case 'ligar': liga(true); if (a.modo) { st.modo = a.modo === 'dc' ? 'dc' : 'tempo'; } if (a.velocidade) st.velocidade = +a.velocidade; monta(); await espera(+a.esperar_ms || 300); return estado(false);
      case 'desligar': liga(false); return { ligado: false };
      /* abre a janela de ANALISE (lista ou osciloscopio) de um pino {ref, num}, de uma net {net} ou de um componente {ref} */
      case 'analisar': {
        garante();
        const h = a.net ? { tipo: 'fio', net: a.net } : a.num != null ? { tipo: 'pino', ref: a.ref, num: String(a.num), net: (st.an && st.an.pinos[a.ref + '-' + a.num] || {}).net } : { tipo: 'comp', ref: a.ref };
        if (h.tipo !== 'fio' && !info(h.ref)) throw new Error('componente ' + a.ref + ' fora da simulação');
        const j = analise.abre(h, a.modo === 'osc' || a.modo === 'osciloscopio' ? 'osc' : 'lista', null);
        await espera(+a.esperar_ms || 400);
        return { aberta: j.id, modo: j.modo, nets: j.nets, amostras: j.amostras.length, texto: j.bd.innerText.slice(0, 2000) };
      }
      case 'analisar_fechar': { const L = analise.lista(); const n = L.length; for (const j of L.slice()) j.el.remove(); L.length = 0; return { fechadas: n }; }
      case 'pausar': st.rodando = false; painel.atualiza(); return { rodando: false };
      case 'continuar': st.rodando = true; agenda(); return { rodando: true };
      case 'religar': garante(); religa(); await espera(+a.esperar_ms || 300); return estado(false);
      case 'estado': if (st.ligado && st.sujo) monta(); return estado(!!a.detalhe);
      case 'modo': st.modo = a.modo === 'dc' ? 'dc' : 'tempo'; if (a.velocidade) st.velocidade = +a.velocidade; gravaCfg(); garante(); religa(); await espera(200); return estado(false);
      case 'mostrar': Object.assign(st.mostrar, a.mostrar || {}); if (a.calculos != null) st.calc = !!a.calculos; gravaCfg(); painel.atualiza(true); { const v = VISTA(); if (v) v.redesenha(); } return { mostrar: st.mostrar, calculos: st.calc };
      case 'pinos': {
        garante(); const out = {};
        for (const [k, p] of Object.entries(st.an ? st.an.pinos : {})) if ((!a.ref || p.ref === a.ref) && (!a.net || p.net === a.net)) out[k] = p;
        return { t: st.res && st.res.t, pinos: out };
      }
      case 'componente': { garante(); const c = st.an && st.an.comps[a.ref]; if (!c) throw new Error('componente ' + a.ref + ' não está na simulação'); if (a.mostrar !== false) { st.fixo = a.ref; painel.calculos(a.ref); const v = VISTA(); if (v) v.focar(a.ref); } return c; }
      case 'chave': garante(); if (!defineChave(a.ref, a.fechada == null ? !(info(a.ref) || {}).fechada : !!a.fechada)) throw new Error(a.ref + ' não é chave, botão ou jumper'); return { ref: a.ref, fechada: (info(a.ref) || {}).fechada };
      case 'pot': garante(); if (!definePot(a.ref, +a.posicao)) throw new Error(a.ref + ' não é potenciômetro/LDR'); return { ref: a.ref, posicao: (info(a.ref) || {}).pos };
      case 'fonte': garante(); defineFonte(a.net, a.remover ? null : { v: a.v != null ? +a.v : undefined, onda: a.onda || null, desligada: !!a.desligada }); monta(); return estado(false).fontes;
      case 'gpio': garante(); defineGpio(a.ref + '-' + a.pino, a.modo ? { modo: a.modo, duty: a.duty, f: a.f } : null); monta(); return { pino: a.ref + '-' + a.pino, ...(st.an && st.an.pinos[a.ref + '-' + a.pino] || {}) };
      case 'terra': garante(); st.cfg.terra = (a.nets || []).slice(); gravaCfg(); monta(); return { terra: st.mt.terra };
      case 'valor': garante(); if (a.valor == null) delete st.cfg.valores[a.ref]; else st.cfg.valores[a.ref] = String(a.valor); gravaCfg(); monta(); return st.an && st.an.comps[a.ref];
      case 'desligar_componente': garante(); { const s = new Set(st.cfg.desligados || []); if (a.desligado === false) s.delete(a.ref); else s.add(a.ref); st.cfg.desligados = [...s]; } gravaCfg(); monta(); return estado(false);
      case 'osciloscopio': garante(); for (const n of a.nets || []) osciloscopio(n, a.remover ? false : true); st.osc = st.osciloscopio.length > 0; painel.atualiza(true);
        if (a.esperar_ms) await espera(+a.esperar_ms);
        return { nets: st.osciloscopio, amostras: st.amostras.slice(-(+a.amostras || 200)).map(x => ({ t: x.t, v: Object.fromEntries(st.osciloscopio.map((n, k) => [n, x.v[k]])) })) };
      case 'rodar': {
        /* avanca o tempo da simulacao sem esperar o relogio (duracao em segundos de simulacao) */
        garante(); if (st.modo === 'dc') return estado(false);
        const dur = +a.duracao || 0.1; const fim = st.res.t + dur; let n = 0;
        while (st.res.t < fim && n < 2e6) { st.res = st.sim.passo(10); n += 10; amostra(); }
        analisa(true); return estado(false);
      }
      case 'conectores': garante(); return conectores();
      case 'entradas': {
        /* {entradas: {"CN2-1": 12, "+5V": 5, "J1-3": {v, onda}, "CN2-2": null (abre)}}: pino REF-NUM ou net */
        garante();
        const mapa = C.entradasParaFontes(st.comps, a.entradas || {});
        for (const [net, f] of Object.entries(mapa)) { if (f === null) delete st.cfg.fontes[net]; else st.cfg.fontes[net] = f; }
        gravaCfg(); monta();
        if (st.modo !== 'dc' && a.duracao) { const fim = st.res.t + +a.duracao; while (st.res.t < fim) { st.res = st.sim.passo(10); amostra(); } analisa(true); }
        painel.atualiza(true);
        return { aplicadas: mapa, conectores: conectores() };
      }
      case 'testar': {
        /* aplica as entradas, anda o tempo (modo tempo) e confere: [{alvo, min, max, esperado, tol, grandeza}] */
        garante();
        if (a.modo) st.modo = a.modo === 'tempo' ? 'tempo' : 'dc';
        const mapa = C.entradasParaFontes(st.comps, a.entradas || {});
        for (const [net, f] of Object.entries(mapa)) { if (f === null) delete st.cfg.fontes[net]; else st.cfg.fontes[net] = f; }
        gravaCfg(); monta();
        if (st.modo !== 'dc') { const fim = st.res.t + (+a.duracao || 0.2); while (st.res.t < fim) { st.res = st.sim.passo(10); amostra(); } }
        analisa(true); painel.atualiza(true);
        const r = C.verifica(st.an, a.verificar || []);
        return { modo: st.modo, t: st.res.t, aplicadas: mapa, passou: r.every(x => x.ok), resultados: r, alertas: st.an.resumo.alertas, avisos: st.mt.avisos, conectores: conectores() };
      }
      case 'gpio_lote': {
        /* o ESP32 simulado do NexoCode (pelo numero do GPIO): {mcu?, gpio:{"25":{modo, duty, f}}, origem} -> aplica sem
           remontar quando o pino ja tinha modo (so o duty/nivel muda, o tempo continua) e devolve a tensao de todos os
           GPIO, para o firmware ler as entradas (digitalRead/analogRead) */
        garante();
        const mcu = a.mcu ? info(a.mcu) : [...st.mt.comps.values()].find(c => c.tipo === 'mcu') || [...st.mt.comps.values()].find(c => c.tipo === 'ci' && c.pinos.some(p => C.gpioDe(p.name) != null));
        if (!mcu) throw new Error('nenhum microcontrolador no esquema' + (a.mcu ? ' com o designador ' + a.mcu : ''));
        const porGpio = new Map();
        for (const p of mcu.pinos) { const g = C.gpioDe(p.name); if (g != null && !porGpio.has(g)) porGpio.set(g, p); }
        /* a conexao do NexoCode com este MCU (verde na folha); desconectar = o NexoCode desligou: cinza na hora */
        st.nexoCode = st.nexoCode || {};
        if (a.desconectar) delete st.nexoCode[mcu.ref];
        else if (a.origem === 'nexocode') st.nexoCode[mcu.ref] = { em: Date.now(), rodando: a.rodando !== false };
        let remonta = false;
        const aplicado = [], semPino = [];
        for (const [g, conf] of Object.entries(a.gpio || {})) {
          const p = porGpio.get(+g);
          if (!p) { semPino.push(+g); continue; }
          const key = mcu.ref + '-' + p.num, atual = st.cfg.gpio[key];
          if (!conf || !conf.modo) { if (atual) { delete st.cfg.gpio[key]; remonta = true; } continue; }
          const novo = { modo: conf.modo, duty: conf.duty == null ? 0.5 : +conf.duty, f: +conf.f || 1000, origem: a.origem || 'mcp' };
          if (atual) Object.assign(atual, novo); else { st.cfg.gpio[key] = novo; remonta = true; }
          aplicado.push({ gpio: +g, pino: key, modo: novo.modo, duty: novo.modo === 'pwm' ? novo.duty : undefined });
        }
        if (remonta) monta();
        else if (aplicado.length && st.sim) { st.res = st.modo === 'dc' ? st.sim.dc() : st.sim.passo(1); analisa(true); }
        /* ACIONAR (NexoCode 0.2.1: o botao ou o potenciometro mexido na tela do ESP32 simulado): {"27": true} aperta a chave
           ligada a esse GPIO (fica APERTADO na folha), {"34": 0.7} poe o cursor do potenciometro ligado a ele */
        const acionados = [];
        for (const [g, val] of Object.entries(a.acionar || {})) {
          const p = porGpio.get(+g); if (!p || !p.net) continue;
          const nets = new Set([p.net]);
          /* a chave pode estar atras de um resistor de serie (ate 1 kΩ): sobe um nivel */
          for (const c of st.mt.comps.values()) if (c.tipo === 'resistor' && c.r <= 1000 && c.pinos.some(q => q.net === p.net)) for (const q of c.pinos) if (q.net) nets.add(q.net);
          if (typeof val === 'boolean') {
            const ch = [...st.mt.comps.values()].find(c => c.tipo === 'chave' && c.sw && c.pinos.some(q => nets.has(q.net)));
            /* o false se repete a cada sincronismo completo (3 s): so solta o que o NexoCode apertou, nao a chave que a
               pessoa fechou na folha */
            if (ch && (val || ch.doNexoCode)) { defineChave(ch.ref, !!val); ch.doNexoCode = !!val; acionados.push({ gpio: +g, ref: ch.ref, fechada: !!val }); }
          } else if (isFinite(+val)) {
            const pt = [...st.mt.comps.values()].find(c => c.tipo === 'pot' && c.pinos.some(q => nets.has(q.net)));
            if (pt) { definePot(pt.ref, +val); acionados.push({ gpio: +g, ref: pt.ref, posicao: +val }); }
          }
        }
        if (acionados.length) { st.res = st.modo === 'dc' ? st.sim.dc() : st.sim.passo(1); analisa(true); }
        gravaCfgLeve();
        const vdd = mcu.alim && mcu.alim[0] && st.res ? st.res.v[mcu.alim[0].net] : 3.3;
        const pinos = {}, entradas = {};
        for (const [g, p] of porGpio) {
          const pin = st.an && st.an.pinos[mcu.ref + '-' + p.num];
          if (!pin || !p.net || !isFinite(pin.v)) continue;   // pino sem ligacao: nada a ler
          const nivel = pin.v >= 0.7 * vdd ? 1 : pin.v <= 0.3 * vdd ? 0 : null;
          pinos[g] = { pino: p.num, nome: p.name, net: p.net, v: pin.v, i: pin.i, nivel };
          const c = st.cfg.gpio[mcu.ref + '-' + p.num];
          if (!c || /entrada|pullup|pulldown/.test(c.modo)) entradas[g] = { v: pin.v, nivel };
        }
        st.ultimoNexoCode = Date.now();
        if (remonta || aplicado.length || acionados.length) painel.atualiza();
        /* os MOTORES da bancada (e do esquema): o painel do motor do NexoCode mostra a rotacao e fecha a malha de rpm com ela */
        const motores = {};
        for (const [ref, c] of Object.entries((st.an && st.an.comps) || {})) if (c.tipo === 'motor' && c.rpm != null) motores[ref] = { rpm: Math.round(c.rpm), corrente: c.corrente, tensao: c.tensao, kv: c.kv, titulo: c.titulo };
        return { mcu: mcu.ref, aplicado, acionados, sem_pino: semPino, pinos, entradas, motores, t: st.res && st.res.t, modo: st.modo };
      }
      case 'recolher': return recolher();
      case 'dados': await carregaDados(); painel.atualiza(true); return { componentes: Object.keys((st.dados && st.dados.componentes) || {}).length };
      case 'limpar': st.cfg = { fontes: {}, terra: [], chaves: {}, pots: {}, gpio: {}, valores: {}, desligados: [] }; st.osciloscopio = []; gravaCfg(); st.sujo = true; agenda(); return { limpo: true };
    }
    throw new Error('ação do simulador desconhecida: ' + acao);
  }

  window.HubSimulador = {
    liga, desenha, mcp, estado,
    mudou() { if (st.ligado) { st.sujo = true; agenda(); } },
    ligado: () => st.ligado,
  };
})();
