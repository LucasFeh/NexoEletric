/* NexoEletric - hub-simulador-pcb.js — a CORRENTE NAS TRILHAS da placa (1.101.0).
   Pedido do dono (2026-11-12): "uma simulação mostrando a placa 3D com a direção da corrente nas trilhas como opção de
   visualização, e os cálculos em cima de cada".

   A simulação do Esquema (hub-simulador.js) diz a corrente que entra em cada PINO ('REF-PINO'). Aqui cada pino vira o
   PAD de mesmo nome do componente na placa e a corrente se divide pelo cobre de verdade: trilhas (resistência
   ρ·L/(w·t), cobre de 35 µm), arcos, vias (ligam as camadas) e polígonos/regiões de cobre (um nó só por net e camada,
   o plano). Resolve a rede de cada net: a corrente, o sentido, a queda de tensão, a potência e o aquecimento
   (IPC-2221) de cada trecho.

   Puro (Node e página):
     HubSimPcb.correntes(eb, pinos, {cobre_um}) -> {segs:[{id, net, layer, x1, y1, x2, y2, w, len, i, r, dv, p, dT, imax10}],
                                                  imax, nets:{net:{i, segs}}, sem:[pinos sem pad]}
   Na vista PCB (pcbframe.js » window.__hubPcbSim): no 3D, a opção "Corrente nas trilhas" — a trilha acende pela
   corrente (azul → amarelo → vermelho), as setas andam no sentido da corrente e o rótulo em cima de cada trilha
   traz I, R, ΔV e ΔT; a lista ao lado traz as contas das trilhas mais carregadas. O MCP: HubSimulador.mcp
   ({acao:'pcb_corrente'|'pcb_mostrar'}). */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.HubSimPcb = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const RHO = 1.72e-8;   // Ω·m, cobre a 20 °C

  function resolve(A, b, n) {
    const M = (typeof HubSimMotor !== 'undefined' && HubSimMotor) || (typeof require === 'function' ? require('./hub-simulador-motor.js') : null);
    return M.resolve(A, b, n);
  }
  function dentro(px, py, pts) {
    let d = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) d = !d;
    }
    return d;
  }
  const externa = l => /^(Top|Bottom)$/i.test(String(l || ''));

  function correntes(eb, pinos, opcoes) {
    const o = opcoes || {};
    const t_um = o.cobre_um || 35;
    const espM = t_um * 1e-6;
    const tMil = t_um / 25.4;
    const porNet = new Map();
    const G = net => {
      let g = porNet.get(net);
      if (!g) { g = { nos: new Map(), arestas: [], inj: new Map(), pontos: [] }; porNet.set(net, g); }
      return g;
    };
    const no = (g, k) => { if (!g.nos.has(k)) g.nos.set(k, g.nos.size); return k; };
    const K = (l, x, y) => l + '|' + Math.round(x * 200) + '|' + Math.round(y * 200);
    const sem = [];

    /* trilhas e arcos (o arco vira a corda com o comprimento do arco) */
    const tr = [];
    for (const t of eb.tracks || []) if (t.net) tr.push({ id: t.id, net: t.net, layer: t.layer, x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2, w: t.w || 0.25 });
    for (const a of eb.arcs || []) {
      if (!a.net) continue;
      const sa = (a.sa || 0) * Math.PI / 180, ea = (a.ea || 0) * Math.PI / 180;
      let ang = ea - sa; if (ang <= 0) ang += 2 * Math.PI;
      tr.push({ id: a.id, net: a.net, layer: a.layer, x1: a.cx + a.r * Math.cos(sa), y1: a.cy + a.r * Math.sin(sa), x2: a.cx + a.r * Math.cos(ea), y2: a.cy + a.r * Math.sin(ea), w: a.w || 0.25, comp: a.r * ang });
    }
    /* os pontos de cada net/camada: pontas de trilha, pads e vias (para partir a trilha onde algo encosta no meio) */
    const pads = [];
    for (const c of eb.components || []) for (const p of c.pads || []) if (p.net) pads.push({ id: p.id, ref: c.ref, name: String(p.name), net: p.net, layer: p.layer, x: p.x, y: p.y, r: Math.max(p.w || 0.5, p.h || 0.5) / 2 });
    for (const p of eb.freepads || []) if (p.net) pads.push({ id: p.id, ref: '', name: String(p.name), net: p.net, layer: p.layer, x: p.x, y: p.y, r: Math.max(p.w || 0.5, p.h || 0.5) / 2 });
    const vias = (eb.vias || []).filter(v => v.net).map(v => ({ id: v.id, net: v.net, x: v.x, y: v.y, r: (v.size || 0.5) / 2 }));
    const camadas = new Set(['Top', 'Bottom']); for (const t of tr) camadas.add(t.layer);
    const pontosDe = new Map();
    const pp = (net, l, x, y) => { const k = net + '|' + l; if (!pontosDe.has(k)) pontosDe.set(k, []); pontosDe.get(k).push([x, y]); };
    for (const t of tr) { pp(t.net, t.layer, t.x1, t.y1); pp(t.net, t.layer, t.x2, t.y2); }
    for (const p of pads) for (const l of p.layer === 'Multi' ? camadas : [p.layer]) pp(p.net, l, p.x, p.y);
    for (const v of vias) for (const l of camadas) pp(v.net, l, v.x, v.y);

    const segs = [];
    for (const t of tr) {
      const g = G(t.net);
      const L = Math.hypot(t.x2 - t.x1, t.y2 - t.y1);
      const comp = t.comp || L;
      if (L < 1e-6) continue;
      const ux = (t.x2 - t.x1) / L, uy = (t.y2 - t.y1) / L;
      const meio = [];
      for (const [x, y] of pontosDe.get(t.net + '|' + t.layer) || []) {
        const s = (x - t.x1) * ux + (y - t.y1) * uy;
        if (s <= 0.01 || s >= L - 0.01) continue;
        if (Math.abs((x - t.x1) * uy - (y - t.y1) * ux) <= Math.max(0.01, t.w / 2)) meio.push(s);
      }
      meio.sort((a, b) => a - b);
      let sa = 0;
      for (const sb of meio.concat([L])) {
        if (sb - sa < 0.005) continue;
        const ax = t.x1 + ux * sa, ay = t.y1 + uy * sa, bx = t.x1 + ux * sb, by = t.y1 + uy * sb;
        const len = (sb - sa) * comp / L;
        const r = RHO * (len * 1e-3) / ((t.w * 1e-3) * espM);
        const s = { id: t.id + (meio.length ? ':' + Math.round(sa * 100) : ''), trilha: t.id, net: t.net, layer: t.layer, x1: ax, y1: ay, x2: bx, y2: by, w: t.w, len, r,
                    a: no(g, K(t.layer, ax, ay)), b: no(g, K(t.layer, bx, by)) };
        g.arestas.push(s); segs.push(s);
        sa = sb;
      }
    }
    /* pads e vias ligam as pontas de trilha que caem neles; o pad recebe a corrente do pino */
    const liga = (g, a, b, r) => g.arestas.push({ a: no(g, a), b: no(g, b), r, oculto: true });
    const pontasDe = new Map();
    for (const s of segs) for (const [k, x, y] of [[s.a, s.x1, s.y1], [s.b, s.x2, s.y2]]) {
      const c = s.net + '|' + s.layer;
      if (!pontasDe.has(c)) pontasDe.set(c, new Map());
      pontasDe.get(c).set(k, [x, y]);
    }
    const nosPerto = (net, l, x, y, r) => { const out = []; for (const [k, [px, py]] of pontasDe.get(net + '|' + l) || []) if (Math.hypot(px - x, py - y) <= r + 0.01) out.push(k); return out; };
    for (const p of pads) {
      const g = G(p.net), kp = no(g, 'P|' + p.id);
      for (const l of p.layer === 'Multi' ? camadas : [p.layer]) for (const k of nosPerto(p.net, l, p.x, p.y, p.r)) liga(g, kp, k, 1e-4);
      const pin = pinos && pinos[p.ref + '-' + p.name];
      if (pin && isFinite(pin.i)) g.inj.set(kp, (g.inj.get(kp) || 0) - pin.i);
      if (/^(J|CN|P|X|CON|XS|XP|JP|BT|BAT|PS)\d/i.test(p.ref || '')) (g.conectores || (g.conectores = new Set())).add(kp);
      else if (p.ref && pinos && !pin) sem.push(p.ref + '-' + p.name);
      p.no = kp;
    }
    for (const v of vias) {
      const g = G(v.net), kv = no(g, 'V|' + v.id);
      for (const l of camadas) for (const k of nosPerto(v.net, l, v.x, v.y, v.r)) liga(g, kv, k, 2e-4);
      v.no = kv;
    }
    /* os poligonos/regioes de cobre: um no por net e camada (o plano) ligado a quem cai dentro dele */
    for (const rg of [].concat(eb.regions || [], eb.fills || [])) {
      if (!rg.net || !Array.isArray(rg.points) || rg.points.length < 3) continue;
      const g = G(rg.net), kg = no(g, 'G|' + rg.layer);
      for (const p of pads) if (p.net === rg.net && (p.layer === rg.layer || p.layer === 'Multi') && dentro(p.x, p.y, rg.points)) liga(g, kg, p.no, 2e-3);
      for (const v of vias) if (v.net === rg.net && dentro(v.x, v.y, rg.points)) liga(g, kg, v.no, 2e-3);
      for (const [k, [x, y]] of pontasDe.get(rg.net + '|' + rg.layer) || []) if (dentro(x, y, rg.points)) liga(g, kg, k, 2e-3);
    }
    /* cada net: os componentes conexos do cobre, um no de referencia em cada um (o que nao fecha a conta vai por ele) */
    let imax = 0;
    const nets = {};
    for (const [net, g] of porNet) {
      if (!g.arestas.length) continue;
      const n = g.nos.size;
      const idx = new Map([...g.nos.keys()].map((k, i) => [k, i]));
      const pai = [...Array(n).keys()];
      const acha = i => { while (pai[i] !== i) { pai[i] = pai[pai[i]]; i = pai[i]; } return i; };
      for (const e of g.arestas) { const a = acha(idx.get(e.a)), b = acha(idx.get(e.b)); if (a !== b) pai[b] = a; }
      const grupos = new Map();
      for (let i = 0; i < n; i++) { const r = acha(i); if (!grupos.has(r)) grupos.set(r, []); grupos.get(r).push(i); }
      const pot = new Float64Array(n);
      for (const membros of grupos.values()) {
        if (membros.length < 2) continue;
        /* referencia (por onde entra/sai o que os pinos nao fecham — a fonte ideal da simulacao nao tem pad): o pad do
           CONECTOR da net (a entrada de alimentacao: a corrente do + sai dele e a do GND volta para ele — 1.107.0, antes
           era o pino de maior corrente e o + e o GND andavam para o mesmo lado); senao o no com mais corrente */
        const chavesG = [...g.nos.keys()];
        let ref = membros[0], mx = -1;
        for (const i of membros) { const k = chavesG[i]; const q = Math.abs(g.inj.get(k) || 0) + (g.conectores && g.conectores.has(k) ? 1e6 : 0); if (q > mx) { mx = q; ref = i; } }
        const loc = new Map(); let m = 0;
        for (const i of membros) if (i !== ref) loc.set(i, m++);
        if (!m) continue;
        const A = new Float64Array(m * m), b = new Float64Array(m);
        for (const e of g.arestas) {
          const a = idx.get(e.a), c = idx.get(e.b);
          if (acha(a) !== acha(membros[0])) continue;
          const gg = 1 / Math.max(e.r, 1e-6), la = loc.get(a), lc = loc.get(c);
          if (la != null) A[la * m + la] += gg;
          if (lc != null) A[lc * m + lc] += gg;
          if (la != null && lc != null) { A[la * m + lc] -= gg; A[lc * m + la] -= gg; }
        }
        for (let i = 0; i < m; i++) A[i * m + i] += 1e-9;
        const chaves = [...g.nos.keys()];
        for (const i of membros) { const l = loc.get(i); if (l != null) b[l] += g.inj.get(chaves[i]) || 0; }
        if (!resolve(A, b, m)) continue;
        for (const [i, l] of loc) pot[i] = b[l];
      }
      let inet = 0;
      for (const e of g.arestas) {
        if (e.oculto) continue;
        e.i = (pot[idx.get(e.a)] - pot[idx.get(e.b)]) / Math.max(e.r, 1e-6);
        e.dv = Math.abs(e.i) * e.r;
        e.p = e.i * e.i * e.r;
        const aMil = (e.w / 0.0254) * tMil, k = externa(e.layer) ? 0.048 : 0.024;
        e.dT = Math.pow(Math.abs(e.i) / (k * Math.pow(aMil, 0.725)), 1 / 0.44);
        e.imax10 = k * Math.pow(10, 0.44) * Math.pow(aMil, 0.725);
        imax = Math.max(imax, Math.abs(e.i));
        inet = Math.max(inet, Math.abs(e.i));
      }
      nets[net] = { i: inet, segs: g.arestas.filter(e => !e.oculto).length };
    }
    for (const s of segs) { delete s.a; delete s.b; if (s.i == null) { s.i = 0; s.dv = 0; s.p = 0; s.dT = 0; } }
    return { segs, imax, nets, sem };
  }

  /* ================================================================================== a camada 3D (pcbframe) */
  function instalaNaVista() {
    if (typeof window === 'undefined' || !window.__hubPcbSim) return;
    const H = window.__hubPcbSim;
    const C = () => window.HubSimCircuito || null;
    const fmt = (v, u) => {
      if (C()) return C().fmt(v, u);
      const a = Math.abs(v); const ps = [[1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n']];
      const p = ps.find(([k]) => a >= k) || ps[ps.length - 1];
      return (v / p[0]).toFixed(2).replace('.', ',') + ' ' + p[1] + u;
    };
    const PREF = 'nexoSim.pcb3d';
    /* a aba Simulador do hub abre a placa com ?modo=sim2d | sim3d | bancada: area de simulacao, sem as ferramentas */
    const modoPg = (() => { try { return new URLSearchParams(location.search).get('modo') || ''; } catch (_e) { return ''; } })();
    const naAba = /^(sim2d|sim3d|bancada)$/.test(modoPg);
    /* 1.107.0 (o dono: "tudo que tem relação com o simulador fica só na aba de simulação"): fora da aba a camada da
       simulacao comeca desligada e o painel nao aparece (a IA ainda pode pedir pcb_mostrar) */
    const st = { ligado: naAba, calc: true,
                 dados: null, res: null, versao: 0, ui: null, rotulos: [], setas: null, fase: 0, montado: 0,
                 /* os baloes em cima das trilhas comecam ESCONDIDOS (pedido do dono: "nao quero balao de descricao de tudo") */
                 baloes: (() => { try { return localStorage.getItem('nexoSim.baloes') === '1'; } catch (_e) { return false; } })() };
    let topo = window;
    try { topo = window.top && window.top.document ? window.top : window; } catch (_e) { topo = window; }
    function terraDe(d) { const t = new Set((d && d.terra) || []); if (!t.size && d && d.nets) for (const n of Object.keys(d.nets)) if (/^(GND|AGND|DGND|PGND|SGND|0V|VSS|TERRA|EARTH)/i.test(n)) t.add(n); return t; }
    /* O BALAO PADRAO (1.108.0, o dono: "o tipo do componente logo na frente, no final da linha a net; no canto inferior
       esquerdo a cor do LED escrita na cor dele; um pouco acima o nome na biblioteca; no meio, destacada, a tensao — 0 V
       cinza apagadinho, energizado vermelho vibrante; o mesmo padrao para todos os baloes") */
    const TIPOS_SIM = { led: 'LED', mcu: 'Microcontrolador', ci: 'CI', resistor: 'Resistor', capacitor: 'Capacitor', indutor: 'Indutor',
      diodo: 'Diodo', mosfet: 'MOSFET', bjt: 'Transistor', regulador: 'Regulador', conversor: 'Conversor', conector: 'Conector',
      chave: 'Chave', pot: 'Potenciômetro', rele: 'Relé', fusivel: 'Fusível', carga: 'Carga', motor: 'Motor', fonte_bancada: 'Fonte',
      opto: 'Optoacoplador', '555': 'Temporizador', logica: 'Lógica', driver: 'Driver', ponte: 'Ponte', bateria: 'Bateria', trilha: 'Trilha' };
    const CORES_NOME = [['#ff3b30', 'vermelho'], ['#ff9500', 'laranja'], ['#ffd60a', 'amarelo'], ['#34c759', 'verde'], ['#0a84ff', 'azul'],
      ['#f5f5f7', 'branco'], ['#b0306a', 'infravermelho'], ['#bf5af2', 'ultravioleta'], ['#ff2d92', 'rosa']];
    function nomeDaCor(hex) { const h = String(hex || '').toLowerCase(); const a = CORES_NOME.find(([c]) => c === h); return a ? a[1] : ''; }
    const escB = x => String(x == null ? '' : x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    /** o corpo do balao: {tipo, nome, sub, net, v, linhas:[[k, v]], extra (html), lib, cor:{nome, hex}, acoes (html), nota} */
    function caixaBalao(o) {
      const tp = TIPOS_SIM[o.tipo] || (o.tipo ? String(o.tipo) : 'Componente');
      const temV = o.v != null && isFinite(o.v), on = temV && Math.abs(o.v) >= 0.05;
      let h = '<div class="bx' + (o.queimado ? ' queimado' : '') + '"><div class="l1"><span class="tp">' + escB(tp) + '</span>' + (o.queimado ? '<span class="tq">🔥 queimado</span>' : '') + '<b>' + escB(o.nome || '') + '</b>'
        + (o.sub ? '<span class="sb">' + escB(o.sub) + '</span>' : '') + '<span class="nt">' + escB(o.net || '') + '</span>' + (o.acoes || '') + '</div>';
      h += '<div class="vv ' + (on ? 'on' : 'off') + '">' + (temV ? escB(fmt(o.v, 'V')) : '—') + '</div>';
      if (o.nota) h += '<div class="nota">' + escB(o.nota) + '</div>';
      const ls = (o.linhas || []).filter(x => x && x[1] != null && x[1] !== '');
      if (ls.length) h += '<div class="ls">' + ls.map(([k, v]) => '<span>' + escB(k) + '</span><b>' + escB(v) + '</b>').join('') + '</div>';
      if (o.extra) h += o.extra;
      /* 1.108.1: a lib que e so a cor (o LED "VERDE") nao repete — fica a cor escrita na cor dele */
      const libRepete = o.lib && o.cor && o.cor.nome && String(o.lib).trim().toLowerCase().replace(/[^a-zà-ú]/g, '') === String(o.cor.nome).toLowerCase().replace(/[^a-zà-ú]/g, '');
      if (o.lib && !libRepete) h += '<div class="lib">' + escB(o.lib) + '</div>';
      if (o.cor && o.cor.nome) h += '<div class="cr" style="color:' + escB(o.cor.hex || '#e5e7eb') + '">' + escB(o.cor.nome) + '</div>';
      return h + '</div>';
    }
    /* 1.109.0: alterar o valor/parametros pelo balao da placa — o pedido vai para a simulacao (a aba Simulador) */
    function simDoProjeto() { try { const w = topo.__nexoSimAba && topo.__nexoSimAba[H.projeto()]; return w && w.HubSimulador ? w.HubSimulador : null; } catch (_e) { return null; } }
    function edicaoDoComp(ref, sc, fixo) {
      if (!fixo || !sc) return '';
      let h = '';
      if (sc.queimado) h += '<button class="trocar" data-ed="trocar">Trocar o componente (novo)</button>';
      const rot = { resistor: 'Resistência', capacitor: 'Capacitância', indutor: 'Indutância' }[sc.tipo];
      const lin = (k, r, v, dica) => '<div class="ed"><span>' + escB(r) + '</span><input data-ed-in="' + k + '" value="' + escB(v == null ? '' : v) + '" placeholder="' + escB(dica) + '"><button data-ed="' + k + '">aplicar</button></div>';
      if (rot) h += lin('valor', rot, sc.valor, '330, 4k7, 100n');
      /* 1.111.0/1.113.0: os campos de cada tipo (vem do circuito: a potencia/tolerancia do resistor, a tensao do capacitor,
         Vf/corrente do LED, If/VRRM/Vz do diodo, β/Ic/Pd/Vceo do transistor) */
      for (const cp of sc.campos || []) h += lin(cp.k, cp.rot, txtCampo(cp), cp.dica || '');
      return h;
    }
    /* o valor de um campo como se digita: 1/4 (W), 20m (A), 2,1 (V), 250 (β), 5 (%) */
    function txtCampo(cp) {
      const v = cp && cp.v;
      if (v == null || !isFinite(v)) return '';
      if (cp.un === 'W') { for (const d of [2, 4, 8, 16]) if (Math.abs(v * d - 1) < 1e-9) return '1/' + d; return String(+(+v).toFixed(3)).replace('.', ','); }
      if (cp.un === '%' || !cp.un) return String(+(+v).toPrecision(4)).replace('.', ',');
      const a = Math.abs(v);
      const [d, p] = a >= 1e3 ? [1e3, 'k'] : a >= 1 || a === 0 ? [1, ''] : a >= 1e-3 ? [1e-3, 'm'] : [1e-6, 'u'];
      return String(+(v / d).toPrecision(4)).replace('.', ',') + p;
    }
    function ligaEdicao(raiz, ref) {
      raiz.querySelectorAll('[data-ed]').forEach(b => {
        b.onclick = async () => {
          const S = simDoProjeto(); if (!S) return;
          const k = b.dataset.ed, inp = raiz.querySelector('[data-ed-in="' + k + '"]');
          try {
            if (k === 'trocar') await S.mcp({ acao: 'trocar', ref });
            else if (k === 'valor') await S.mcp({ acao: 'valor', ref, valor: inp && inp.value.trim() ? inp.value.trim() : null });
            else await S.mcp(Object.assign({ acao: 'parametros', ref }, { [k]: inp && inp.value.trim() ? inp.value.trim() : null }));
          } catch (e) { console.warn('editar', ref, e); }
          if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        };
      });
      raiz.querySelectorAll('[data-ed-in]').forEach(i => {
        i.onkeydown = ev => { ev.stopPropagation(); if (ev.key === 'Enter') { const b = raiz.querySelector('[data-ed="' + i.dataset.edIn + '"]'); if (b) b.click(); } };
        for (const e of ['mousedown', 'pointerdown', 'keyup', 'keypress']) i.addEventListener(e, z => z.stopPropagation());
      });
    }
    function compSim(ref) { return (st.dados && st.dados.comps && st.dados.comps[ref]) || null; }
    function corDoComp(c) { return c && c.tipo === 'led' && c.cor ? { nome: nomeDaCor(c.cor) || 'LED', hex: c.cor } : null; }
    /* o brilho do LED: a textura (um degrade redondo) feita uma vez */
    let texBrilho = null;
    function texturaBrilho(T) {
      if (texBrilho) return texBrilho;
      const cv = document.createElement('canvas'); cv.width = cv.height = 64;
      const x = cv.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,.75)'); g.addColorStop(0.6, 'rgba(255,255,255,.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, 64, 64);
      texBrilho = new T.CanvasTexture(cv);
      return texBrilho;
    }
    function centroComp(c) {
      let cx = c.x, cy = c.y;
      if (!(isFinite(cx) && isFinite(cy)) && c.pads && c.pads.length) { cx = c.pads.reduce((s, p) => s + p.x, 0) / c.pads.length; cy = c.pads.reduce((s, p) => s + p.y, 0) / c.pads.length; }
      return [cx, cy];
    }
    function dadosDoTopo() { try { const d = topo.__nexoSim; return d && d.projeto === H.projeto() ? d : null; } catch (_e) { return null; } }
    try { topo.addEventListener('nexo-sim', () => { st.dados = dadosDoTopo(); agenda(); }); } catch (_e) { /* outra origem */ }

    const CSS = `
.simpcb{position:absolute; bottom:12px; right:12px; z-index:5; width:310px; max-height:55%; display:flex; flex-direction:column; pointer-events:auto;
  background:rgba(17,20,26,.88); color:#e5e7eb; border:1px solid rgba(255,255,255,.12); border-radius:12px; box-shadow:0 12px 34px rgba(0,0,0,.45);
  font:12px system-ui, sans-serif; backdrop-filter:blur(8px); overflow:hidden}
.simpcb .hd{display:flex; align-items:center; gap:8px; padding:8px 10px; border-bottom:1px solid rgba(255,255,255,.08)}
.simpcb .hd b{flex:1} .simpcb button{height:24px; padding:0 9px; border-radius:7px; border:1px solid rgba(255,255,255,.18); background:rgba(255,255,255,.06); color:inherit; cursor:pointer; font:inherit}
.simpcb button.on{background:#f59e0b; color:#111; border-color:#f59e0b}
.simpcb .st{padding:7px 10px; color:#9ca3af} .simpcb .leg{margin:0 10px 6px; height:8px; border-radius:4px; background:linear-gradient(90deg,#1e40af,#06b6d4,#facc15,#ef4444)}
.simpcb .legt{display:flex; justify-content:space-between; margin:0 10px 6px; color:#9ca3af; font-size:10.5px}
.simpcb ol{margin:0; padding:0 10px 8px 26px; overflow:auto} .simpcb li{padding:4px 0; border-bottom:1px dashed rgba(255,255,255,.08)}
.simpcb li .n{font-weight:700} .simpcb li .f{font:10.5px ui-monospace, monospace; color:#93c5fd}
.simpcb-rot{position:absolute; z-index:4; pointer-events:none; transform:translate(-50%,-110%); padding:3px 7px; border-radius:7px; white-space:nowrap;
  background:rgba(10,12,16,.82); border:1px solid rgba(250,204,21,.55); color:#fde68a; font:600 10.5px system-ui, sans-serif; box-shadow:0 4px 12px rgba(0,0,0,.4)}
.simpcb-rot small{display:block; font:500 9.5px ui-monospace, monospace; color:#cbd5e1}`;
    function ui() {
      if (st.ui) return st.ui;
      const host = H.host3d && H.host3d();
      if (!host) return null;
      if (!document.getElementById('simpcb-css')) { const s = document.createElement('style'); s.id = 'simpcb-css'; s.textContent = CSS; document.head.append(s); }
      const el = document.createElement('div'); el.className = 'simpcb';
      el.innerHTML = '<div class="hd"><span>⚡</span><b>Corrente nas trilhas</b><button data-a="bal" title="Mostrar os valores em cima das trilhas">balões</button><button data-a="calc">contas</button><button data-a="on"></button></div>'
        + '<div class="st"></div><div class="leg"></div><div class="legt"><span>0</span><span class="mx"></span></div><ol></ol>';
      for (const ev of ['mousedown', 'pointerdown', 'wheel', 'contextmenu', 'dblclick']) el.addEventListener(ev, e => e.stopPropagation(), { passive: ev === 'wheel' });
      el.querySelector('[data-a=on]').onclick = () => { st.ligado = !st.ligado; try { localStorage.setItem(PREF, st.ligado ? '1' : '0'); } catch (_e) { /* ok */ } monta(); };
      el.querySelector('[data-a=calc]').onclick = () => { st.calc = !st.calc; pinta(); };
      el.querySelector('[data-a=bal]').onclick = () => { st.baloes = !st.baloes; try { localStorage.setItem('nexoSim.baloes', st.baloes ? '1' : '0'); } catch (_e) { /* ok */ } pinta(); };
      const camadaRot = document.createElement('div'); camadaRot.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:4;overflow:hidden';
      host.append(el, camadaRot);
      st.ui = { el, rot: camadaRot };
      return st.ui;
    }
    function pinta() {
      const u = ui(); if (!u) return;
      /* na aba Simulador o painel "Corrente nas trilhas" e os rotulos automaticos sairam (pedido do dono: "so atrapalha;
         os baloes surgem interativamente"): o clique na trilha ou no pino abre o balao */
      u.el.hidden = true;   // 1.107.0: o painel "Corrente nas trilhas" saiu (fora da aba nao ha simulacao; na aba, os baloes)
      u.rot.hidden = !H.em3d() || !st.ligado || !st.baloes || naAba;
      u.el.querySelector('[data-a=bal]').classList.toggle('on', st.baloes);
      const bOn = u.el.querySelector('[data-a=on]'); bOn.textContent = st.ligado ? 'ligado' : 'desligado'; bOn.classList.toggle('on', st.ligado);
      u.el.querySelector('[data-a=calc]').classList.toggle('on', st.calc);
      const s = u.el.querySelector('.st'), ol = u.el.querySelector('ol');
      ol.textContent = '';
      if (!st.dados) { s.textContent = naAba ? 'Esperando a simulação do esquema (a aba Simulador roda as duas juntas)…' : 'Abra a aba Simulador (ou o Simular no Esquema): a corrente de cada pino vem da simulação do esquema.'; return; }
      if (!st.res) { s.textContent = 'calculando…'; return; }
      const nSeg = st.res.segs.filter(x => Math.abs(x.i) > 1e-6).length;
      s.textContent = (st.dados.modo === 'dc' ? 'DC' : 't = ' + fmt(st.dados.t, 's')) + ' · ' + nSeg + ' trechos com corrente · máx ' + fmt(st.res.imax, 'A') + (st.res.sem.length ? ' · ' + st.res.sem.length + ' pad(s) sem pino no esquema' : '');
      u.el.querySelector('.mx').textContent = fmt(st.res.imax, 'A');
      const top = st.res.segs.slice().sort((a, b) => Math.abs(b.i) - Math.abs(a.i)).filter((x, i, arr) => arr.findIndex(y => y.trilha === x.trilha) === i).slice(0, 10);
      for (const x of top) {
        if (Math.abs(x.i) < 1e-6) break;
        const li = document.createElement('li');
        li.innerHTML = '<span class="n">' + esc(x.net) + '</span> · ' + esc(x.layer) + ' · ' + fmt(Math.abs(x.i), 'A')
          + (st.calc ? '<div class="f">R = ρ·L/(w·t) = 1,72e-8·' + x.len.toFixed(2).replace('.', ',') + ' mm/(' + x.w.toFixed(2).replace('.', ',') + ' mm·35 µm) = ' + fmt(x.r, 'Ω')
            + '<br>ΔV = I·R = ' + fmt(x.dv, 'V') + ' · P = I²·R = ' + fmt(x.p, 'W')
            + '<br>ΔT (IPC-2221) ≈ ' + x.dT.toFixed(2).replace('.', ',') + ' °C · Imáx p/ +10 °C = ' + fmt(x.imax10, 'A') + '</div>' : '');
        ol.append(li);
      }
    }
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    function cor(T, f) {
      const stops = [[0, [30, 64, 175]], [0.33, [6, 182, 212]], [0.66, [250, 204, 21]], [1, [239, 68, 68]]];
      let a = stops[0], b = stops[stops.length - 1];
      for (let i = 0; i < stops.length - 1; i++) if (f >= stops[i][0] && f <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; break; }
      const k = (f - a[0]) / Math.max(1e-9, b[0] - a[0]);
      return new T.Color(...a[1].map((x, i) => (x + (b[1][i] - x) * k) / 255));
    }
    let tAgenda = 0;
    function agenda() { if (tAgenda) return; tAgenda = setTimeout(() => { tAgenda = 0; monta(); }, 350); }
    function monta() {
      const V = H.vista3d && H.vista3d();
      /* a conta vale para o 2D e o 3D: refaz sempre que a simulacao chega */
      if (st.ligado && st.dados && H.placa()) { try { st.res = correntes(H.placa(), st.dados.pinos, {}); } catch (e) { console.warn('corrente nas trilhas:', e); st.res = null; } }
      else st.res = null;
      if (!H.em3d()) H.redesenha();
      pinta();
      try { atualizaBaloes(); } catch (e) { console.warn('baloes:', e); }
      if (!V || typeof V.extra !== 'function') return;
      if (!st.ligado || !st.dados || !H.placa() || !st.res) { V.extra('simCorrente', null); V.anima(null); limpaRotulos(); pinta(); return; }
      const T = V.T(), esp = V.espessura();
      const g = new T.Group(); g.name = 'simCorrente';
      const imax = Math.max(st.res.imax, 1e-9);
      const vivos = st.res.segs.filter(s => Math.abs(s.i) > Math.max(1e-6, imax * 1e-3));
      /* 1.107.0 (o dono): a trilha do positivo AMARELA com a corrente VERMELHA; a do negativo/GND PRETA com a corrente
         BRANCA — todas as trilhas das nets com tensao, nao so as com corrente */
      const terra = terraDe(st.dados);
      const pintadas = st.res.segs.filter(s => terra.has(s.net) || (st.dados.nets && st.dados.nets[s.net] != null) || Math.abs(s.i) > 1e-6);
      for (const s of pintadas) {
        const z = /bottom/i.test(s.layer) ? -esp - 0.08 : /top/i.test(s.layer) ? 0.08 : -esp / 2;   // acima da mascara (1.107.0)
        const geo = new T.BoxGeometry(s.len, s.w * 1.04, 0.02);
        const gnd = terra.has(s.net);
        const m = new T.MeshBasicMaterial({ color: gnd ? 0x050505 : 0xfacc15, transparent: true, opacity: gnd ? 0.92 : 0.85, depthWrite: false, toneMapped: false });
        const ms = new T.Mesh(geo, m);
        ms.position.set((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, z);
        ms.rotation.z = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
        ms.renderOrder = 5;
        g.add(ms);
      }
      /* as setas: uma malha instanciada, reposicionada a cada quadro (andam no sentido da corrente) */
      const lista = [];
      for (const s of vivos) {
        const passo = Math.max(1.2, s.w * 4);
        const n = Math.max(1, Math.floor(s.len / passo));
        for (let k = 0; k < n; k++) lista.push({ s, k, n, passo });
      }
      const MAXS = 6000;
      const usadas = lista.slice(0, MAXS);
      if (usadas.length) {
        const cone = new T.ConeGeometry(1, 2.2, 3); cone.rotateZ(-Math.PI / 2);   // aponta para +X
        const mat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false });
        const inst = new T.InstancedMesh(cone, mat, usadas.length);
        const cVerm = new T.Color(0xef4444), cBranco = new T.Color(0xffffff);
        usadas.forEach((a, idx) => inst.setColorAt(idx, terra.has(a.s.net) ? cBranco : cVerm));
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
        inst.renderOrder = 6;
        g.add(inst);
        st.setas = { inst, usadas, T, esp };
      } else st.setas = null;
      /* O LED ACESO NO 3D (1.108.0, o dono: "quando o LED for devidamente alimentado, tenha o efeito de iluminado no 3D"):
         um brilho na cor do LED em cima do corpo, do tamanho do brilho da simulacao */
      for (const c of H.placa().components || []) {
        const sc = compSim(c.ref);
        if (!sc || sc.tipo !== 'led' || !(sc.brilho > 0.02)) continue;
        const [cx, cy] = centroComp(c), baixo = /bottom/i.test(c.layer || '');
        const cor = new T.Color(sc.cor || '#ff3b30'), b = Math.sqrt(Math.min(1, sc.brilho));   // o olho ve a raiz: 24 % ja e um LED aceso
        for (const [tam, op] of [[4 + 10 * b, 0.45 + 0.45 * b], [1.8 + 3 * b, 0.8 + 0.2 * b]]) {
          const sp = new T.Sprite(new T.SpriteMaterial({ map: texturaBrilho(T), color: cor, transparent: true, opacity: Math.min(1, op), depthWrite: false, blending: T.AdditiveBlending, toneMapped: false }));
          sp.scale.set(tam, tam, 1);
          sp.position.set(cx, cy, baixo ? -esp - 1.1 : 1.1);
          sp.renderOrder = 7;
          g.add(sp);
        }
      }
      /* O QUEIMADO NO 3D (1.109.0): um brilho vermelho sobre o corpo e a fumaca subindo */
      const fumacas = [];
      for (const c of H.placa().components || []) {
        const sc = compSim(c.ref);
        if (!sc || !sc.queimado) continue;
        const [cx, cy] = centroComp(c), baixo = /bottom/i.test(c.layer || ''), z0 = baixo ? -esp - 1.2 : 1.2;
        /* 1.111.0 (o dono viu o LD2 queimado: "o LED precisa ficar vermelho"): o CORPO fica vermelho — uma capa vermelha
           do tamanho do modelo 3D dele —, o brilho e a fumaca sem o teste de profundidade (a placa cortava o sprite numa
           linha reta: o retangulo escuro), e a fumaca maior e mais densa (aparece sobre o verde da placa) */
        const V3 = H.vista3d && H.vista3d(), kq = V3 && V3.caixaDe ? V3.caixaDe(c.ref) : null;
        if (kq) {
          const capa = new T.Mesh(new T.BoxGeometry(kq.x2 - kq.x1 + 0.08, kq.y2 - kq.y1 + 0.08, Math.max(0.05, kq.z2 - kq.z1) + 0.06),
            new T.MeshBasicMaterial({ color: new T.Color(0xc81e1e), transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }));
          capa.position.set((kq.x1 + kq.x2) / 2, (kq.y1 + kq.y2) / 2, (kq.z1 + kq.z2) / 2); capa.renderOrder = 6; g.add(capa);
        }
        const zt = kq ? (baixo ? kq.z1 - 0.2 : kq.z2 + 0.2) : z0;
        const verm = new T.Sprite(new T.SpriteMaterial({ map: texturaBrilho(T), color: new T.Color(0xff2a1a), transparent: true, opacity: 0.9, depthWrite: false, depthTest: false, blending: T.AdditiveBlending, toneMapped: false }));
        verm.scale.set(9, 9, 1); verm.position.set(cx, cy, zt); verm.renderOrder = 7; g.add(verm);
        for (let k = 0; k < 12; k++) {
          const sp = new T.Sprite(new T.SpriteMaterial({ map: texturaBrilho(T), color: new T.Color(k % 3 === 2 ? 0x8f8f98 : 0xe6e6ec), transparent: true, opacity: 0.9, depthWrite: false, depthTest: false, toneMapped: false }));
          sp.renderOrder = 8; g.add(sp);
          fumacas.push({ sp, x: cx, y: cy, z: zt, sobe: baixo ? -1 : 1, fase: k / 12 });
        }
      }
      V.extra('simCorrente', g);
      rotulos(vivos);
      const M4 = st.setas ? new st.setas.T.Matrix4() : null, Q = st.setas ? new st.setas.T.Quaternion() : null, E = st.setas ? new st.setas.T.Euler() : null;
      const P = st.setas ? new st.setas.T.Vector3() : null, S = st.setas ? new st.setas.T.Vector3() : null;
      V.anima(dt => {
        st.fase += dt;
        for (const f of fumacas) {
          const u = (st.fase * 0.35 + f.fase) % 1;
          f.sp.position.set(f.x + Math.sin((st.fase + f.fase * 7) * 1.3) * 1.5 * u, f.y + Math.cos((st.fase + f.fase * 5) * 1.1) * 1.2 * u, f.z + f.sobe * (0.5 + 24 * u));
          const t = 4 + 16 * u; f.sp.scale.set(t, t, 1); f.sp.material.opacity = 0.95 * (1 - u) * Math.min(1, u * 6);
        }
        if (st.setas) {
          const { inst, usadas: us, esp: e } = st.setas;
          us.forEach((a, idx) => {
            const s = a.s, L = s.len, dir = Math.sign(s.i) || 1;
            const vel = (1.5 + 5 * Math.log10(1 + Math.abs(s.i) / 1e-4));           // mm/s
            let d = ((a.k * a.passo + st.fase * vel) % (a.n * a.passo));
            if (dir < 0) d = a.n * a.passo - d;
            const t = Math.min(1, d / L);
            const x = s.x1 + (s.x2 - s.x1) * t, y = s.y1 + (s.y2 - s.y1) * t;
            const z = /bottom/i.test(s.layer) ? -e - 0.14 : /top/i.test(s.layer) ? 0.14 : -e / 2;
            const ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1) + (dir < 0 ? Math.PI : 0);
            E.set(0, 0, ang); Q.setFromEuler(E);
            const k = Math.max(0.22, Math.min(0.9, s.w * 0.9));
            P.set(x, y, z); S.set(k, k, k * 0.3);
            M4.compose(P, Q, S);
            inst.setMatrixAt(idx, M4);
          });
          inst.instanceMatrix.needsUpdate = true;
        }
        posicionaRotulos(V);
      });
      pinta();
    }
    function limpaRotulos() { for (const r of st.rotulos) r.el.remove(); st.rotulos = []; }
    function rotulos(vivos) {
      limpaRotulos();
      if (naAba) return;
      const u = ui(); if (!u) return;
      /* um rotulo por trilha (a maior corrente de cada uma), as 12 mais carregadas (acima de 5 % da maior), sem dois
         a menos de 6 mm um do outro: a placa continua legivel */
      const porTrilha = new Map();
      for (const s of vivos) { const a = porTrilha.get(s.trilha); if (!a || Math.abs(s.i) > Math.abs(a.i) || (Math.abs(s.i) === Math.abs(a.i) && s.len > a.len)) porTrilha.set(s.trilha, s); }
      const imx = Math.max(...vivos.map(v => Math.abs(v.i)), 1e-12);
      const cands = [...porTrilha.values()].filter(v => Math.abs(v.i) >= 0.05 * imx).sort((a, b) => Math.abs(b.i) - Math.abs(a.i));
      const escolhidos = [];
      for (const s of cands) {
        if (escolhidos.length >= 12) break;
        const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
        if (escolhidos.some(o => Math.hypot((o.x1 + o.x2) / 2 - mx, (o.y1 + o.y2) / 2 - my) < 6)) continue;
        escolhidos.push(s);
      }
      for (const s of escolhidos) {
        const el = document.createElement('div'); el.className = 'simpcb-rot';
        el.innerHTML = fmt(Math.abs(s.i), 'A') + ' <span style="color:#9ca3af;font-weight:500">' + esc(s.net) + '</span>'
          + (st.calc ? '<small>R ' + fmt(s.r, 'Ω') + ' · ΔV ' + fmt(s.dv, 'V') + ' · ΔT ' + s.dT.toFixed(2).replace('.', ',') + ' °C</small>' : '');
        u.rot.append(el);
        st.rotulos.push({ el, s });
      }
    }
    /* na tela, o rotulo que encostaria num de corrente maior (a lista ja vem do maior para o menor) fica escondido */
    function posicionaRotulos(V) {
      const e = V.espessura();
      const postos = [];
      for (const r of st.rotulos) {
        const s = r.s, z = /bottom/i.test(s.layer) ? -e - 0.1 : 0.1;
        const p = V.projeta((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, z);
        const w = r.el.offsetWidth || 120, h = r.el.offsetHeight || 30;
        const cx = { x1: p.x - w / 2 - 3, x2: p.x + w / 2 + 3, y1: p.y - h * 1.1 - 3, y2: p.y + 3 };
        const bate = postos.some(q => cx.x1 < q.x2 && cx.x2 > q.x1 && cx.y1 < q.y2 && cx.y2 > q.y1);
        r.el.style.display = p.atras || bate ? 'none' : '';
        r.el.style.left = p.x + 'px'; r.el.style.top = p.y + 'px';
        if (!p.atras && !bate) postos.push(cx);
      }
    }
    /* ---------------------------------------------------------------- os dados de datasheet (Libs/componentes-dados.json) */
    let banco = null;
    async function carregaBanco() {
      try { const r = await fetch('Libs/componentes-dados.json?t=' + Date.now(), { cache: 'no-store' }); banco = r.ok ? await r.json() : { componentes: {} }; }
      catch (_e) { banco = { componentes: {} }; }
    }
    carregaBanco();
    setInterval(carregaBanco, 20000);
    function compDaPlaca(ref) { const pl = H.placa(); return pl && (pl.components || []).find(c => c.ref === ref); }
    function pinoDoDatasheet(ref, pad) {
      const Cc = C(); if (!Cc || !banco) return null;
      const comp = compDaPlaca(ref); if (!comp) return null;
      const d = Cc.dadosDe(banco, { comment: comp.comment, sym: comp.footprint }, 'ci');
      if (!d || !d.pinos) return null;
      return { comp: d, pino: d.pinos[String(pad)] || null };
    }

    /* ---------------------------------------------------------------- a camada eletrica no 2D (o draw() do pcbframe chama) */
    const fase = new Map();
    let tAnim = 0;
    const velPonto = i => { const a = Math.abs(i); return a > 2e-7 ? Math.sign(i) * Math.min(220, 14 + 26 * Math.log10(a / 2e-7)) : 0; };
    function corV(v) {
      const vm = st.vmax || 5, t = Math.max(-1, Math.min(1, v / vm)), k = Math.pow(Math.abs(t), 0.5);
      const g = [110, 116, 128], f = t >= 0 ? [34, 197, 94] : [239, 68, 68];
      return 'rgb(' + g.map((x, i) => Math.round(x + (f[i] - x) * k)).join(',') + ')';
    }
    let hoverAlvo = null;
    /* 1.105.1 ("cliquei em um componente na placa e a reticula ficou grudada nela"): a marca sob o mouse some ao
       fixar/fechar o cartao e ao sair da vista; 1.110.0: volta no proximo movimento do mouse */
    function soltaAnel() { if (!hoverAlvo) return; hoverAlvo = null; marcaAlvo3d(); if (!H.em3d()) H.redesenha(); }
    const chaveAlvo = a => !a ? '' : a.tipo === 'pad' ? 'p|' + a.pad.ref + '|' + a.pad.nome : a.tipo === 'mcu' ? 'm|' + a.mcu.ref : a.tipo === 'comp' ? 'c|' + a.comp.ref : 't|' + a.trilha.s.trilha + '|' + a.trilha.s.layer;
    /* o contorno do alvo em mm (no plano da placa): o pad girado, a caixa do MCU; a trilha = os trechos dela */
    function contornoDoAlvo(a, folga) {
      if (a.tipo === 'pad') {
        const p = a.pad, pd = p.pad || {}, w = (+pd.w || 2 * p.r || 1) / 2 + folga, h = (+pd.h || 2 * p.r || 1) / 2 + folga, an = (+pd.rot || 0) * Math.PI / 180;
        const c = Math.cos(an), sn = Math.sin(an);
        return [[-w, -h], [w, -h], [w, h], [-w, h]].map(([u, v]) => [p.x + u * c - v * sn, p.y + u * sn + v * c]);
      }
      if (a.tipo === 'mcu') { const k = a.mcu.caixa, f = 1 + folga; return [[k.x1 - f, k.y1 - f], [k.x2 + f, k.y1 - f], [k.x2 + f, k.y2 + f], [k.x1 - f, k.y2 + f]]; }
      if (a.tipo === 'comp') {
        /* no 3D a caixa do corpo; no 2D a dos pads */
        const V = H.em3d() && H.vista3d && H.vista3d(), cx = V && V.caixaDe ? V.caixaDe(a.comp.ref) : null;
        const k = cx || a.comp.caixa, f = (cx ? 0.15 : 0.5) + folga;
        return [[k.x1 - f, k.y1 - f], [k.x2 + f, k.y1 - f], [k.x2 + f, k.y2 + f], [k.x1 - f, k.y2 + f]];
      }
      return null;
    }
    const trechosDoAlvo = a => (st.res && st.res.segs || []).filter(s => s.trilha === a.trilha.s.trilha && s.layer === a.trilha.s.layer);
    const COR_ALVO = '#22d3ee';
    /* no 3D: uma camada propria na cena (o contorno ciano por cima de tudo), refeita so quando o alvo muda */
    /* 1.110.2 (o dono: "a seleção do componente não dá pra ser ele todo? tipo, em volta dele?"): a CAIXA em volta do
       corpo inteiro — as 12 arestas, de baixo ate o topo — no passar do mouse e enquanto esta selecionado */
    function caixa3d(T, k, folga, lp, op) {
      const g = new T.Group();
      const mat = new T.MeshBasicMaterial({ color: new T.Color(COR_ALVO), transparent: true, opacity: op, depthTest: false, depthWrite: false, toneMapped: false });
      const x1 = k.x1 - folga, x2 = k.x2 + folga, y1 = k.y1 - folga, y2 = k.y2 + folga, z1 = k.z1 - folga * 0.5, z2 = k.z2 + folga * 0.5;
      const ar = (ax, ay, az, bx, by, bz) => {
        const L = Math.hypot(bx - ax, by - ay, bz - az) + lp;
        const m = new T.Mesh(new T.BoxGeometry(bx !== ax ? L : lp, by !== ay ? L : lp, bz !== az ? L : lp), mat);
        m.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2); m.renderOrder = 21; g.add(m);
      };
      for (const z of [z1, z2]) { ar(x1, y1, z, x2, y1, z); ar(x2, y1, z, x2, y2, z); ar(x2, y2, z, x1, y2, z); ar(x1, y2, z, x1, y1, z); }
      for (const [x, y] of [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]) ar(x, y, z1, x, y, z2);
      /* as faces bem de leve (o volume do componente) */
      const f = new T.Mesh(new T.BoxGeometry(x2 - x1, y2 - y1, Math.max(0.01, z2 - z1)), new T.MeshBasicMaterial({ color: new T.Color(COR_ALVO), transparent: true, opacity: op * 0.12, depthWrite: false, toneMapped: false }));
      f.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2); f.renderOrder = 20; g.add(f);
      return g;
    }
    /* a espessura de ~px pixels na tela, em mm, perto do ponto (x, y, z) */
    function mmDePx(V, x, y, z, px) {
      const a = V.projeta(x, y, z), b = V.projeta(x + 1, y, z), c = V.projeta(x, y + 1, z);
      const esc = (Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(c.x - a.x, c.y - a.y)) / 2;
      return Math.max(0.03, px / (esc > 1e-3 ? esc : 20));
    }
    const caixaDoRef = (V, ref) => V && V.caixaDe ? V.caixaDe(ref) : null;
    /* os selecionados (balao aberto: componente ou MCU) com a caixa em volta, na camada propria */
    function marcaSel3d() {
      const V = H.em3d() && H.vista3d && H.vista3d();
      if (!V || typeof V.extra !== 'function') return;
      const refs = [...new Set(baloes.filter(b => b.comp || b.mcu).map(b => b.comp || b.mcu))];
      const T = V.T(), g = new T.Group(); g.name = 'simSel';
      for (const ref of refs) {
        const k = caixaDoRef(V, ref); if (!k) continue;
        g.add(caixa3d(T, k, 0.25, mmDePx(V, (k.x1 + k.x2) / 2, (k.y1 + k.y2) / 2, k.z2, 2.5), 1));
      }
      V.extra('simSel', g.children.length ? g : null);
    }
    function marcaAlvo3d() {
      const V = H.em3d() && H.vista3d && H.vista3d();
      if (!V || typeof V.extra !== 'function') return;
      const a = hoverAlvo;
      if (!a) { V.extra('simAlvo', null); return; }
      const T = V.T(), esp = V.espessura(), g = new T.Group(); g.name = 'simAlvo';
      const baixo = !!(V.estado && V.estado().el < 0);   // o alvo e sempre da face que a camera ve
      let z = baixo ? -esp - 0.12 : 0.12;
      /* o componente: o contorno no TOPO do corpo (em volta do que a pessoa ve) */
      if (a.tipo === 'comp') { const cx = V.caixaDe && V.caixaDe(a.comp.ref); if (cx) z = a.comp.bottom ? cx.z1 - 0.08 : cx.z2 + 0.08; }
      const mat = op => new T.MeshBasicMaterial({ color: new T.Color(COR_ALVO), transparent: true, opacity: op, depthTest: false, depthWrite: false, toneMapped: false, side: T.DoubleSide });
      const barra = (x1, y1, x2, y2, larg, op) => {
        const L = Math.hypot(x2 - x1, y2 - y1); if (L < 1e-6) return;
        const m = new T.Mesh(new T.PlaneGeometry(L + larg, larg), mat(op));
        m.position.set((x1 + x2) / 2, (y1 + y2) / 2, z); m.rotation.z = Math.atan2(y2 - y1, x2 - x1); m.renderOrder = 20; g.add(m);
      };
      /* a espessura do traco: ~2,5 px na tela */
      const pq = pontoNaPlaca(ultMouse || { clientX: 0, clientY: 0 }), lp = Math.max(0.05, 2.5 / ((pq && pq.esc) || 20));
      /* o componente (e o MCU com corpo 3D): a caixa em volta dele inteiro */
      const refCaixa = a.tipo === 'comp' ? a.comp.ref : a.tipo === 'mcu' ? a.mcu.ref : null, kc = refCaixa && caixaDoRef(V, refCaixa);
      if (kc) { g.add(caixa3d(T, kc, 0.25, mmDePx(V, (kc.x1 + kc.x2) / 2, (kc.y1 + kc.y2) / 2, kc.z2, 2.2), 0.7)); V.extra('simAlvo', g); return; }
      if (a.tipo === 'trilha') {
        for (const s of trechosDoAlvo(a)) barra(s.x1, s.y1, s.x2, s.y2, (s.w || 0.25) + 2 * lp, 0.5);
      } else {
        const P = contornoDoAlvo(a, a.tipo === 'pad' ? 0.1 + lp : 0);
        for (let i = 0; i < P.length; i++) { const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % P.length]; barra(x1, y1, x2, y2, lp, 0.95); }
        if (a.tipo === 'pad') {
          const sh = new T.Shape(P.map(([x, y]) => new T.Vector2(x, y)));
          const m = new T.Mesh(new T.ShapeGeometry(sh), mat(0.28)); m.position.z = z; m.renderOrder = 19; g.add(m);
        }
      }
      V.extra('simAlvo', g);
    }
    function marcaAlvo2d(ctx, px) {
      if (H.em3d()) return;
      const pl = H.placa();
      for (const b of baloes) {
        const ref = b.comp || b.mcu, c = ref && pl && (pl.components || []).find(x => x.ref === ref), k = c && caixaPads(c);
        if (!k) continue;
        const f = b.mcu ? 1 : 0.6;
        ctx.save(); ctx.strokeStyle = COR_ALVO; ctx.lineWidth = px(2.6); ctx.fillStyle = 'rgba(34,211,238,.08)';
        ctx.beginPath(); ctx.rect(k.x1 - f, k.y1 - f, k.x2 - k.x1 + 2 * f, k.y2 - k.y1 + 2 * f); ctx.fill(); ctx.stroke(); ctx.restore();
      }
      const a = hoverAlvo; if (!a) return;
      ctx.save(); ctx.globalAlpha = 1; ctx.strokeStyle = COR_ALVO; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      if (a.tipo === 'trilha') {
        ctx.globalAlpha = 0.55;
        for (const s of trechosDoAlvo(a)) { ctx.lineWidth = (s.w || 0.25) + px(5); ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke(); }
      } else {
        const P = contornoDoAlvo(a, a.tipo === 'pad' ? px(3) : 0);
        ctx.beginPath(); P.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
        if (a.tipo === 'pad') { ctx.fillStyle = 'rgba(34,211,238,.25)'; ctx.fill(); }
        ctx.lineWidth = px(2.2); ctx.stroke();
      }
      ctx.restore();
    }
    window.HubSimPcb2d = {
      desenha(ctx, px) {
        try { window.HubSimPcb2d.camada(ctx, px); } finally { if (naAba) marcaAlvo2d(ctx, px); }
      },
      camada(ctx, px) {
        if (!naAba || !st.ligado || !st.res || !st.dados) return;
        let vm = 1; for (const x of Object.values(st.dados.nets || {})) if (isFinite(x)) vm = Math.max(vm, Math.abs(x)); st.vmax = vm;
        ctx.save();
        ctx.lineCap = 'round';
        /* o cobre pela tensao da net */
        /* 1.109.0: o QUEIMADO no 2D — vermelho com fumaca (o laco do 2D ja redesenha a cada quadro) */
        { const agora = performance.now() / 1000;
          for (const c of H.placa().components || []) {
            const sc = compSim(c.ref); if (!sc || !sc.queimado) continue;
            const [cx, cy] = centroComp(c);
            const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, 5);
            gr.addColorStop(0, 'rgba(255,42,26,.85)'); gr.addColorStop(1, 'rgba(255,42,26,0)');
            ctx.globalAlpha = 1; ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
            for (let k = 0; k < 7; k++) {
              const u = (agora * 0.4 + k / 7) % 1;
              ctx.fillStyle = 'rgba(170,170,178,' + (0.5 * (1 - u)).toFixed(3) + ')';
              ctx.beginPath(); ctx.arc(cx + Math.sin(agora * 1.5 + k) * 1.2 * u, cy - u * 9, 0.6 + 2.6 * u, 0, Math.PI * 2); ctx.fill();
            }
          } }
        /* 1.108.0: o LED aceso tambem no 2D (um brilho na cor dele) */
        for (const c of H.placa().components || []) {
          const sc = compSim(c.ref);
          if (!sc || sc.tipo !== 'led' || !(sc.brilho > 0.02)) continue;
          const [cx, cy] = centroComp(c), r = 1.5 + 5 * Math.min(1, sc.brilho);
          const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
          const hx = /^#[0-9a-f]{6}$/i.test(sc.cor || '') ? sc.cor : '#ff3b30', a = Math.min(1, 0.35 + 0.6 * sc.brilho);
          const rgba = k => 'rgba(' + parseInt(hx.slice(1, 3), 16) + ',' + parseInt(hx.slice(3, 5), 16) + ',' + parseInt(hx.slice(5, 7), 16) + ',' + k + ')';
          gr.addColorStop(0, rgba(a)); gr.addColorStop(0.4, rgba(a * 0.45)); gr.addColorStop(1, rgba(0));
          ctx.globalAlpha = 1; ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
        }
        /* 1.107.0: o positivo AMARELO, o GND PRETO (com uma borda para aparecer no fundo escuro) */
        const terra = terraDe(st.dados);
        for (const s of st.res.segs) {
          const v = st.dados.nets[s.net], gnd = terra.has(s.net);
          if (v == null && !gnd) continue;
          if (gnd) { ctx.strokeStyle = 'rgba(148,163,184,.55)'; ctx.globalAlpha = 1; ctx.lineWidth = s.w + px(2); ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke(); }
          ctx.strokeStyle = gnd ? '#050505' : '#facc15'; ctx.globalAlpha = gnd ? 0.95 : 0.8; ctx.lineWidth = s.w;
          ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke();
        }
        /* os pontos da corrente: VERMELHOS no positivo, BRANCOS no GND */
        ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = px(0.8);
        const passo = Math.max(px(18), 0.8), raio = Math.max(px(2.4), 0.12);
        for (const s of st.res.segs) {
          if (!velPonto(s.i)) continue;
          ctx.fillStyle = terra.has(s.net) ? '#ffffff' : '#ef4444';
          const L = Math.hypot(s.x2 - s.x1, s.y2 - s.y1); if (L < 1e-6) continue;
          const ux = (s.x2 - s.x1) / L, uy = (s.y2 - s.y1) / L;
          let d = (((fase.get(s.id) || 0) * px(1)) % passo + passo) % passo;
          for (; d < L; d += passo) { ctx.beginPath(); ctx.arc(s.x1 + ux * d, s.y1 + uy * d, raio, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
        }
        ctx.restore();
      },
    };
    function animaPontos(t) {
      if (naAba && st.ligado && st.res && !H.em3d()) {
        const dt = tAnim ? Math.min(0.1, (t - tAnim) / 1000) : 0;
        for (const s of st.res.segs) { const v = velPonto(s.i); if (v) fase.set(s.id, (fase.get(s.id) || 0) + v * dt); }
        H.redesenha();
      }
      tAnim = t;
      requestAnimationFrame(animaPontos);
    }

    /* ---------------------------------------------------------------- o pad (a perna do CI) sob o mouse: 2D e 3D */
    function padsDaPlaca() {
      const pl = H.placa(); const out = [];
      if (!pl) return out;
      for (const c of pl.components || []) for (const p of c.pads || []) out.push({ ref: c.ref, nome: String(p.name), net: p.net || '', x: p.x, y: p.y, r: Math.max(p.w || 0.5, p.h || 0.5) / 2, camada: p.layer, comp: c, pad: p });
      return out;
    }
    /* O ALVO SOB O MOUSE (1.110.0, o dono: "na visão 3D, antes de eu clicar em cima dos pinos, trilhas, quero poder
       passar o mouse e ver marcando o que eu vou clicar; to mirando uma coisa e clicando outra, às vezes eu clico e não
       vai"): UM teste so, o mesmo ao passar o mouse e no clique (o que esta marcado e o que o clique pega). O ponto da
       placa sob o mouse (no 3D, o raio do mouse no plano da face que a camera ve) e cada coisa pela forma de verdade:
       o pad pelo retangulo dele (girado), a trilha pela largura, o MCU pela caixa dos pads. Dentro de algo ganha; senao
       o mais perto ate 7 px da borda. Antes: o pad pelo CENTRO (ate 14 px: a borda do pad grande com zoom nao pegava e o
       pad vizinho roubava o clique da trilha) e a trilha pela linha do meio (ate 8 px: a trilha larga nao pegava). */
    const TOL_PX = 7;
    function pontoNaPlaca(ev) {
      if (H.em3d()) {
        const V = H.vista3d(); if (!V || !V.noPlano || !V.projeta) return null;
        const e = V.espessura(), est = V.estado ? V.estado() : null, topo = !est || !(est.el < 0);
        const z = topo ? 0.08 : -e - 0.08;
        const w = V.noPlano(ev, z); if (!w) return null;
        const a = V.projeta(w.x, w.y, z), b = V.projeta(w.x + 1, w.y, z), c = V.projeta(w.x, w.y + 1, z);
        if (a.atras) return null;
        const esc = Math.max(1e-3, (Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(c.x - a.x, c.y - a.y)) / 2);   // px por mm ali
        return { x: w.x, y: w.y, esc, lado: topo ? 'top' : 'bottom' };
      }
      const cv = H.canvas(); if (!cv || !H.telaParaMundo) return null;
      const r = cv.getBoundingClientRect(), w = H.telaParaMundo(ev.clientX - r.left, ev.clientY - r.top);
      return { x: w.x, y: w.y, esc: H.escala() || 1, lado: '' };
    }
    /* no 3D so o que esta na face que a camera ve (o pad furado esta nas duas) */
    function naFace(camada, lado) {
      if (!lado || !camada || /multi/i.test(camada)) return true;
      return lado === 'top' ? /top/i.test(camada) : /bottom/i.test(camada);
    }
    /* a distancia (mm) do ponto ate a borda do pad (0 = dentro) */
    function dPad(p, x, y) {
      const pd = p.pad || {}, w = (+pd.w || 2 * p.r || 1) / 2, h = (+pd.h || 2 * p.r || 1) / 2, a = -(+pd.rot || 0) * Math.PI / 180;
      const dx = x - p.x, dy = y - p.y, u = dx * Math.cos(a) - dy * Math.sin(a), v = dx * Math.sin(a) + dy * Math.cos(a);
      if (/round|circ|ellip/i.test(pd.shape || '') && Math.abs(w - h) < 1e-6) return Math.max(0, Math.hypot(u, v) - w);
      return Math.hypot(Math.max(0, Math.abs(u) - w), Math.max(0, Math.abs(v) - h));
    }
    function padNoPonto(q) {
      const tol = TOL_PX / q.esc;
      let melhor = null, dm = Infinity, dc = Infinity;
      for (const p of padsDaPlaca()) {
        if (!naFace(p.camada, q.lado)) continue;
        const lim = p.r * 1.5 + tol + 0.2;
        if (Math.abs(p.x - q.x) > lim || Math.abs(p.y - q.y) > lim) continue;
        const d = dPad(p, q.x, q.y), c = Math.hypot(p.x - q.x, p.y - q.y);
        if (d < dm - 1e-9 || (Math.abs(d - dm) <= 1e-9 && c < dc)) { dm = d; dc = c; melhor = p; }
      }
      return melhor && dm <= tol ? { p: melhor, d: dm } : null;
    }
    function trilhaNoPonto(q) {
      if (!st.res || !st.res.segs) return null;
      const tol = TOL_PX / q.esc;
      let melhor = null, dm = Infinity, tm = 0;
      for (const s of st.res.segs) {
        if (!naFace(s.layer, q.lado)) continue;
        const vx = s.x2 - s.x1, vy = s.y2 - s.y1, L2 = vx * vx + vy * vy || 1e-12;
        const t = Math.max(0, Math.min(1, ((q.x - s.x1) * vx + (q.y - s.y1) * vy) / L2));
        const d = Math.max(0, Math.hypot(q.x - s.x1 - t * vx, q.y - s.y1 - t * vy) - (s.w || 0.25) / 2);
        if (d < dm) { dm = d; melhor = s; tm = t; }
      }
      if (!melhor || dm > tol) return null;
      /* a ancora do balao: o ponto da trilha mais perto do mouse */
      return { s: melhor, ax: melhor.x1 + tm * (melhor.x2 - melhor.x1), ay: melhor.y1 + tm * (melhor.y2 - melhor.y1), d: dm };
    }
    function caixaPads(c) {
      let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
      for (const p of c.pads || []) { x1 = Math.min(x1, p.x); x2 = Math.max(x2, p.x); y1 = Math.min(y1, p.y); y2 = Math.max(y2, p.y); }
      return x1 > x2 ? null : { x1, y1, x2, y2 };
    }
    /* o componente como alvo: no 3D o corpo sob o mouse (o raio no modelo 3D); no 2D o ponto dentro da caixa dos pads */
    function compAlvo(c) {
      const k = caixaPads(c) || { x1: c.x || 0, y1: c.y || 0, x2: c.x || 0, y2: c.y || 0 };
      return { ref: c.ref, c, caixa: k, ax: (k.x1 + k.x2) / 2, ay: (k.y1 + k.y2) / 2, bottom: /bottom/i.test(c.layer || '') };
    }
    function compNoPonto(q, ev) {
      const pl = H.placa(); if (!pl) return null;
      if (H.em3d()) {
        const V = H.vista3d(), h = V && V.corpoSob ? V.corpoSob(ev) : null;
        if (!h || !h.ref) return null;
        const c = (pl.components || []).find(x => x.ref === h.ref);
        if (!c) return null;
        /* a altura do ponto do corpo acertado (acima da face) e a altura do corpo: a perna/terminal fica baixo */
        const o = compAlvo(c), cx = V.caixaDe ? V.caixaDe(c.ref) : null, esp = V.espessura();
        o.alturaHit = o.bottom ? -esp - h.z : h.z;
        o.alturaCorpo = cx ? (o.bottom ? -esp - cx.z1 : cx.z2) : 1;
        return o;
      }
      if (!q) return null;
      let melhor = null, am = Infinity;
      for (const c of pl.components || []) {
        const k = caixaPads(c); if (!k) continue;
        const m = (c.pads || []).length < 2 ? 0.6 : 0.3;
        if (q.x < k.x1 - m || q.x > k.x2 + m || q.y < k.y1 - m || q.y > k.y2 + m) continue;
        const a = (k.x2 - k.x1 + 2 * m) * (k.y2 - k.y1 + 2 * m);
        if (a < am) { am = a; melhor = c; }   // o menor que contem o ponto
      }
      return melhor ? compAlvo(melhor) : null;
    }
    function mcuNoPonto(q) {
      const d = dadosDoTopo(), mcus = d && d.mcus, pl = H.placa();
      if (!mcus || !pl) return null;
      for (const c of pl.components || []) {
        if (!mcus[c.ref] || !(c.pads || []).length) continue;
        const bottom = /bottom/i.test(c.layer || '');
        if (q.lado && (q.lado === 'bottom') !== bottom) continue;
        let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
        for (const p of c.pads) { x1 = Math.min(x1, p.x); x2 = Math.max(x2, p.x); y1 = Math.min(y1, p.y); y2 = Math.max(y2, p.y); }
        if (q.x >= x1 - 1 && q.x <= x2 + 1 && q.y >= y1 - 1 && q.y <= y2 + 1) return { ref: c.ref, ax: (x1 + x2) / 2, ay: (y1 + y2) / 2, bottom, caixa: { x1, y1, x2, y2 } };
      }
      return null;
    }
    /** o que o clique pega neste ponto: {tipo:'mcu', mcu} | {tipo:'pad', pad} | {tipo:'trilha', trilha} | null */
    function alvoEm(ev) {
      const q = pontoNaPlaca(ev);
      const em3d = H.em3d(), cp = compNoPonto(q, ev);
      if (!q) return cp ? alvoDoComp(cp, q) : null;
      const pd = padNoPonto(q), mc = mcuNoPonto(q);
      /* o corpo do MCU ganha do pad de DENTRO dele (o pad termico/GND embaixo do modulo ESP32); os pinos da borda
         continuam abrindo o cartao do pad */
      if (pd && pd.d === 0) {
        const p = pd.p, dentro = mc && p.ref === mc.ref && Math.min(p.x - mc.caixa.x1, mc.caixa.x2 - p.x, p.y - mc.caixa.y1, mc.caixa.y2 - p.y) > 1.5;
        if (dentro) return { tipo: 'mcu', mcu: mc };
        /* 1.110.1: no 3D o corpo de OUTRO componente na frente do pad ganha (esta na frente na tela); o do mesmo
           componente so ganha no pad de dentro (o termico embaixo do CI) — as pernas continuam abrindo o pad */
        if (em3d && cp && (cp.ref !== p.ref || Math.min(p.x - cp.caixa.x1, cp.caixa.x2 - p.x, p.y - cp.caixa.y1, cp.caixa.y2 - p.y) > 1.5
          /* o mouse no ALTO do corpo (a camera de lado: o raio passa pelo corpo e cai no pad dele) e o componente; na
             altura da perna/terminal (baixo) continua o pad */
          || cp.alturaHit > Math.min(0.6, 0.45 * cp.alturaCorpo))) return alvoDoComp(cp, q);
        return { tipo: 'pad', pad: p };
      }
      if (em3d && cp) return alvoDoComp(cp, q);
      if (mc) return { tipo: 'mcu', mcu: mc };
      const tr = trilhaNoPonto(q);
      if (tr && tr.d === 0) return { tipo: 'trilha', trilha: tr };
      if (cp) return alvoDoComp(cp, q);
      if (tr && (!pd || tr.d < pd.d)) return { tipo: 'trilha', trilha: tr };
      if (pd) return { tipo: 'pad', pad: pd.p };
      return null;
    }
    /* o corpo do MCU abre o balao do NexoCode; o dos outros, o balao do componente */
    function alvoDoComp(cp, q) {
      const d = dadosDoTopo();
      if (d && d.mcus && d.mcus[cp.ref] && (cp.c.pads || []).length) {
        const k = cp.caixa;
        return { tipo: 'mcu', mcu: { ref: cp.ref, ax: cp.ax, ay: cp.ay, bottom: cp.bottom, caixa: { x1: k.x1, y1: k.y1, x2: k.x2, y2: k.y2 } } };
      }
      return { tipo: 'comp', comp: cp };
    }
    function padEm(ev) { const q = pontoNaPlaca(ev), r = q && padNoPonto(q); return r ? r.p : null; }
    let cartao = null;
    let modoCartao = 'lista', cartaoPad = null, netSerie = null, ultMouse = null;
    function serieApi() { try { return topo.__nexoSimSerie || null; } catch (_e) { return null; } }
    function assinaSerie(net) { const S = serieApi(); if (!S || !net) return; if (netSerie && netSerie !== net) S.solta(netSerie); netSerie = net; S.assina(net); }
    function soltaSerie() { const S = serieApi(); if (S && netSerie) S.solta(netSerie); netSerie = null; }
    function desenhaOsc() {
      if (!cartao || cartao.hidden || modoCartao !== 'osc' || !cartaoPad) return;
      const cv = cartao.querySelector('canvas'), lg = cartao.querySelector('.lg'); if (!cv) return;
      const S = serieApi(), A = S && netSerie ? S.le(netSerie) : [];
      /* o osciloscopio do simulador (1.102.5): base de tempo, gatilho, frequencia/duty e o PWM rapido reconstruido */
      if (S && S.desenha && A.length >= 2) {
        const l = S.desenha(cv, netSerie, 'auto')[0];
        if (lg) lg.textContent = l ? l.texto + (l.aviso ? ' · ' + l.aviso : '') : '';
        return;
      }
      const dpr = window.devicePixelRatio || 1, W = cv.clientWidth || 300, Hh = cv.clientHeight || 140;
      if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = Hh * dpr; }
      const c2 = cv.getContext('2d'); c2.setTransform(dpr, 0, 0, dpr, 0, 0); c2.clearRect(0, 0, W, Hh);
      c2.strokeStyle = 'rgba(255,255,255,.07)';
      for (let i = 1; i < 4; i++) { c2.beginPath(); c2.moveTo(0, Hh * i / 4); c2.lineTo(W, Hh * i / 4); c2.stroke(); }
      if (A.length < 2) { c2.fillStyle = '#6b7280'; c2.font = '11px system-ui'; c2.fillText(S ? 'esperando o sinal (Tempo real)…' : 'ligue a simulação do esquema', 10, Hh / 2); if (lg) lg.textContent = ''; return; }
      let lo = Infinity, hi = -Infinity;
      for (const a of A) if (isFinite(a.v)) { lo = Math.min(lo, a.v); hi = Math.max(hi, a.v); }
      if (!(hi > lo)) { hi = lo + 0.5; lo -= 0.5; }
      const pd = (hi - lo) * 0.12; lo -= pd; hi += pd;
      const t0 = A[0].t, t1 = A[A.length - 1].t;
      c2.strokeStyle = '#facc15'; c2.lineWidth = 1.6; c2.beginPath();
      A.forEach((a, i) => { const X = (a.t - t0) / Math.max(t1 - t0, 1e-12) * W, Y = Hh - (a.v - lo) / (hi - lo) * Hh; if (i) c2.lineTo(X, Y); else c2.moveTo(X, Y); });
      c2.stroke();
      if (lg) lg.textContent = fmt(lo, 'V') + ' … ' + fmt(hi, 'V') + ' · agora ' + fmt(A[A.length - 1].v, 'V') + ' · ' + fmt(t1 - t0, 's');
    }
    try { topo.addEventListener('nexo-sim', () => { if (cartaoPad && modoCartao === 'lista' && !cartao.hidden && !sobMouse(cartao)) { const l = parseFloat(cartao.style.left) - 16, t = parseFloat(cartao.style.top) - 14; mostraCartao(cartaoPad, { clientX: l, clientY: t }, true); } else desenhaOsc(); }); } catch (_e) { /* ok */ }
    function mostraCartao(p, ev, fixo) {
      if (!cartao) {
        cartao = document.createElement('div'); cartao.className = 'simpcb-cartao';
        for (const e of ['mousedown', 'wheel', 'contextmenu']) cartao.addEventListener(e, x => x.stopPropagation());
        document.body.append(cartao);
        fechaNoApertar(cartao, () => { soltaSerie(); cartao.hidden = true; cartaoPad = null; soltaAnel(); });
      }
      if (!p) { cartao.hidden = true; cartaoPad = null; soltaSerie(); soltaAnel(); return; }
      const pin = st.dados && st.dados.pinos ? st.dados.pinos[p.ref + '-' + p.nome] : null;
      const ds = pinoDoDatasheet(p.ref, p.nome);
      const esc = x => String(x == null ? '' : x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      /* 1.108.0: o balao padrao — tipo · ref · pino ... net; a tensao do pino no meio; corrente; datasheet curto; lib; cor */
      const sc = compSim(p.ref);
      let extra = '';
      if (ds && ds.pino) {
        const q = ds.pino;
        extra = '<div class="ds"><b>' + esc(q.nome || 'pino ' + p.nome) + (q.tipo ? ' · ' + esc(q.tipo) : '') + '</b>'
          + (q.funcao ? '<div>' + esc(q.funcao) + '</div>' : '')
          + (q.vmax != null || q.imax != null ? '<div class="dd">' + [q.vmax != null ? 'máx. ' + fmt(+q.vmax, 'V') : '', q.imax != null ? fmt(+q.imax, 'A') : ''].filter(Boolean).join(' · ') + '</div>' : '') + '</div>';
      }
      if (ds && ds.comp && ds.comp.datasheet_url && fixo) extra += '<a href="' + esc(ds.comp.datasheet_url) + '" target="_blank">abrir o datasheet</a>';
      let h = caixaBalao({
        tipo: sc ? sc.tipo : '', nome: p.ref, sub: 'pino ' + p.nome + (ds && ds.pino && ds.pino.nome && ds.pino.nome !== p.nome ? ' (' + ds.pino.nome + ')' : ''),
        net: p.net || 'sem net', v: pin ? pin.v : null, nota: pin ? '' : 'sem simulação neste pino',
        /* 1.108.1: a corrente sempre (0 A tambem) */
        linhas: pin ? [['Corrente', Math.abs(pin.i) > 1e-10 ? fmt(Math.abs(pin.i), 'A') + (pin.i > 0 ? ' entrando' : ' saindo') : '0 A']] : [],
        extra: extra + edicaoDoComp(p.ref, sc, fixo), lib: (sc && sc.lib) || (p.comp && p.comp.comment) || '', cor: corDoComp(sc),
        queimado: !!(sc && sc.queimado),
      }).replace('<div class="nota"></div>', '');
      if (sc && sc.queimado) h = h.replace('<div class="vv', '<div class="nota" style="color:#fca5a5">' + esc(sc.motivo || 'passou do limite') + '</div><div class="vv');
      /* ANALISAR: a lista (o que esta acima) ou o osciloscopio da net do pad (o sinal passo a passo, do esquema) */
      if (fixo) {
        h = '<div class="ab"><button data-m="lista"' + (modoCartao === 'lista' ? ' class="on"' : '') + '>📋 Lista</button><button data-m="osc"' + (modoCartao === 'osc' ? ' class="on"' : '') + '>📈 Osciloscópio</button><button data-m="x" title="Fechar">×</button></div>'
          + (modoCartao === 'osc' ? '<div class="t">' + esc(p.ref) + ' · pino ' + esc(p.nome) + ' <span>' + esc(p.net || 'sem net') + '</span></div><canvas></canvas><div class="lg"></div>' : h);
      }
      /* digitando um valor: a simulacao que chega nao refaz o cartao (o campo perderia o foco) */
      if (fixo && cartaoPad && cartao.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && !cartao.hidden) return;
      cartao.innerHTML = h;
      ligaEdicao(cartao, p.ref);
      cartaoPad = fixo ? p : null;
      if (fixo) {
        cartao.querySelectorAll('[data-m]').forEach(b => b.onclick = () => {
          if (b.dataset.m === 'x') { soltaSerie(); cartao.hidden = true; cartaoPad = null; soltaAnel(); return; }
          modoCartao = b.dataset.m; mostraCartao(p, { clientX: parseFloat(cartao.style.left) - 16, clientY: parseFloat(cartao.style.top) - 14 }, true);
        });
        if (modoCartao === 'osc') { assinaSerie(p.net); desenhaOsc(); }
      }
      cartao.classList.toggle('fixo', !!fixo);
      /* 1.110.0: a marca segue o mouse (some ao sair do alvo); antes o cartao fixo a apagava — e, refeito a cada quadro
         da simulacao, apagava a marca do mouse o tempo todo enquanto um cartao estava aberto */
      cartao.hidden = false;
      cartao.style.left = Math.min(ev.clientX + 16, window.innerWidth - 330) + 'px';
      cartao.style.top = Math.min(ev.clientY + 14, window.innerHeight - cartao.offsetHeight - 8) + 'px';
      if (fixo && naAba) {
        const ja = baloes.find(b => b.el === cartao);
        if (ja) { ja.ax = p.x; ja.ay = p.y; ja.bottom = /bottom/i.test(p.camada); }
        else baloes.push({ el: cartao, ax: p.x, ay: p.y, bottom: /bottom/i.test(p.camada), dx: 34, dy: -30, cartao: true });
        rodaBaloes();
      } else { const i = baloes.findIndex(b => b.el === cartao); if (i >= 0) baloes.splice(i, 1); }
    }

    /* ---------------------------------------------------------------- OS BALOES (clique na trilha ou no pino) */
    /* Pedido do dono: "os baloes eu quero clicar em cima da trilha ou do pino pra que eles aparecam" e "os calculos so
       aparecem se abrir; por padrao invisiveis". Cada balao fica preso ao ponto clicado por uma linha (2D e 3D: segue a
       camera), mostra a corrente e a net; "contas" abre R, dV, P e dT. Clicar de novo na trilha (ou no x) fecha. */
    const baloes = [];
    /* 1.111.3 (o dono: "eu clico no X pra fechar o balão e ele não fecha"): o balao era REFEITO a cada quadro da
       simulacao (os valores mudam o tempo todo) e o × apertado era trocado por outro antes do clique terminar — o clique
       se perdia (e o mesmo com aplicar, contas e trocar). Agora: com o mouse em cima, o balao nao se refaz (atualiza ao
       sair), e o × fecha ja no apertar do botao */
    const sobMouse = el => { try { return !!el && el.matches(':hover'); } catch (_e) { return false; } };
    function fechaNoApertar(el, fecha) {
      el.addEventListener('pointerdown', e => { const x = e.target.closest && e.target.closest('[data-x], [data-b="x"], [data-m="x"]'); if (x && e.button === 0) { e.preventDefault(); e.stopPropagation(); fecha(); } });
    }
    let camadaB = null, svgB = null, rafB = 0;
    function camadaBaloes() {
      if (camadaB) return camadaB;
      camadaB = document.createElement('div');
      camadaB.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:64';
      svgB = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svgB.setAttribute('width', '100%'); svgB.setAttribute('height', '100%');
      svgB.style.cssText = 'position:absolute;inset:0;overflow:visible';
      camadaB.append(svgB);
      document.body.append(camadaB);
      return camadaB;
    }
    function telaDe(b) {
      if (H.em3d()) {
        const V = H.vista3d(), host = H.host3d(); if (!V || !V.projeta || !host) return null;
        const e = V.espessura(), r = host.getBoundingClientRect();
        const q = V.projeta(b.ax, b.ay, b.bottom ? -e - 0.05 : 0.05);
        return { x: r.left + q.x, y: r.top + q.y, atras: q.atras };
      }
      const cv = H.canvas(); if (!cv || !H.mundoParaTela) return null;
      const r = cv.getBoundingClientRect(), q = H.mundoParaTela(b.ax, b.ay);
      return { x: r.left + q.x, y: r.top + q.y, atras: false };
    }
    /* 1.103.1 ("nao ta rodando leve"): le tudo primeiro (pontos e tamanhos) e so escreve quando algo mudou — antes
       escrevia e lia o tamanho balao a balao em todo quadro (o navegador refazia o layout a cada um) */
    let chaveB = '';
    function posicionaBaloes() {
      camadaBaloes();
      for (let i = baloes.length - 1; i >= 0; i--) if (baloes[i].cartao && baloes[i].el.hidden) baloes.splice(i, 1);   // o cartao fechado sai
      const postosB = [], pontosB = [];
      const lidos = baloes.map(b => { const q = telaDe(b); return { b, p: q, w: b.el.offsetWidth || 200, h: b.el.offsetHeight || 60 }; });
      const chave = lidos.map(o => (o.p && !o.p.atras ? Math.round(o.p.x) + ',' + Math.round(o.p.y) : 'x') + ':' + o.w + 'x' + o.h).join('|') + '|' + window.innerWidth + 'x' + window.innerHeight;
      if (chave === chaveB && svgB.childNodes.length) return;
      chaveB = chave;
      svgB.textContent = '';
      for (const o of lidos) if (o.p && !o.p.atras) pontosB.push(o.p);
      for (const o of lidos) {
        const b = o.b, p = o.p;
        if (!p || p.atras) { if (!b.cartao) b.el.style.display = 'none'; continue; }
        b.el.style.display = '';
        const w = o.w, h = o.h;
        /* o primeiro lugar livre em volta do ponto (acima a direita, acima a esquerda, abaixo...), mais longe se preciso:
           um balao nao cobre o outro nem o ponto de outro balao */
        let L = 0, T = 0;
        for (const d of [56, 90, 130, 180]) {
          let achou = false;
          for (const [sx, sy] of [[1, -1], [-1, -1], [1, 1], [-1, 1]]) {
            L = sx > 0 ? p.x + d * 0.8 : p.x - d * 0.8 - w;
            T = sy < 0 ? p.y - d * 0.6 - h : p.y + d * 0.6;
            L = Math.max(4, Math.min(L, window.innerWidth - w - 4)); T = Math.max(4, Math.min(T, window.innerHeight - h - 4));
            const r = { x1: L, y1: T, x2: L + w, y2: T + h };
            const bate = postosB.some(o => r.x1 < o.x2 + 6 && r.x2 > o.x1 - 6 && r.y1 < o.y2 + 6 && r.y2 > o.y1 - 6)
              || pontosB.some(q => q.x > r.x1 - 8 && q.x < r.x2 + 8 && q.y > r.y1 - 8 && q.y < r.y2 + 8);
            if (!bate) { achou = true; break; }
          }
          if (achou) break;
        }
        postosB.push({ x1: L, y1: T, x2: L + w, y2: T + h });
        b.el.style.left = L + 'px'; b.el.style.top = T + 'px';
        /* a linha: do ponto ate a borda mais perto do balao */
        const bx = Math.max(L, Math.min(p.x, L + w)), by = Math.max(T, Math.min(p.y, T + h));
        /* a linha com uma borda escura (o cobre tambem e amarelo) e o ponto com anel branco */
        const NS = 'http://www.w3.org/2000/svg', mk = (t, at) => { const e = document.createElementNS(NS, t); for (const k in at) e.setAttribute(k, at[k]); return e; };
        svgB.append(
          mk('line', { x1: p.x, y1: p.y, x2: bx, y2: by, stroke: 'rgba(0,0,0,.85)', 'stroke-width': 4.5, 'stroke-linecap': 'round' }),
          mk('line', { x1: p.x, y1: p.y, x2: bx, y2: by, stroke: '#facc15', 'stroke-width': 1.8, 'stroke-linecap': 'round' }),
          mk('circle', { cx: p.x, cy: p.y, r: 5, fill: '#facc15', stroke: '#fff', 'stroke-width': 1.6 }));
      }
    }
    function rodaBaloes() {
      if (rafB) return;
      const passo = () => { rafB = 0; if (!baloes.length) { if (svgB) svgB.textContent = ''; return; } posicionaBaloes(); rafB = requestAnimationFrame(passo); };
      rafB = requestAnimationFrame(passo);
    }
    const chaveSeg = s => s.trilha + '|' + s.x1.toFixed(3) + ',' + s.y1.toFixed(3) + '|' + s.x2.toFixed(3) + ',' + s.y2.toFixed(3);
    function trilhaEm(ev) { const q = pontoNaPlaca(ev); return q ? trilhaNoPonto(q) : null; }
    function htmlTrilha(b) {
      const s = b.s, n = v => (+v || 0).toFixed(2).replace('.', ',');
      const v = st.dados && st.dados.nets ? st.dados.nets[s.net] : null;
      const contas = b.contas ? '<div class="f">R = ρ·L/(w·t) = 1,72e-8·' + n(s.len) + ' mm/(' + n(s.w) + ' mm·35 µm) = ' + fmt(s.r, 'Ω')
        + '<br>ΔV = I·R = ' + fmt(s.dv, 'V') + ' · P = I²·R = ' + fmt(s.p, 'W')
        + '<br>ΔT (IPC-2221) ≈ ' + n(s.dT) + ' °C · Imáx p/ +10 °C = ' + fmt(s.imax10, 'A') + '</div>' : '';
      /* 1.111.2 (o dono: "mesmo sem corrente na trilha o componente tá queimado"): o componente QUEIMADO abre o circuito —
         a trilha dele fica sem corrente; o balao diz quem queimou e com quanto */
      const pl = H.placa(), qs = [];
      for (const c of (pl && pl.components) || []) { const sc = compSim(c.ref); if (sc && sc.queimado && (c.pads || []).some(p => p.net === s.net)) qs.push(c.ref + (sc.motivo ? ' (' + sc.motivo.split(' (')[0] + ')' : '')); }
      return caixaBalao({
        tipo: 'trilha', nome: s.layer, sub: n(s.w) + ' mm', net: s.net, v: v == null ? null : v,
        nota: qs.length && Math.abs(s.i) < 1e-6 ? 'sem corrente: ' + qs.join(', ') + ' queimou e abriu o circuito' : '',
        acoes: '<button data-b="c" class="' + (b.contas ? 'on' : '') + '" title="Mostrar as contas">contas</button><button data-b="x" title="Fechar">×</button>',
        linhas: [['Corrente', fmt(Math.abs(s.i), 'A')], ['Queda na trilha', fmt(Math.abs(s.dv || 0), 'V')]], extra: contas,
      });
    }
    function pintaBalaoTrilha(b) {
      b.el.innerHTML = htmlTrilha(b);
      b.el.querySelector('[data-b=x]').onclick = () => fechaBalao(b);
      b.el.querySelector('[data-b=c]').onclick = () => { b.contas = !b.contas; pintaBalaoTrilha(b); };
    }
    function fechaBalao(b) {
      const i = baloes.indexOf(b); if (i >= 0) baloes.splice(i, 1); b.el.remove(); if (!baloes.length && svgB) svgB.textContent = '';
      if (b.mcu && setasMcu.delete(b.mcu)) montaSetas();
      if (b.comp) montaSetas();
    }
    function alternaBalaoTrilha(hit) {
      const k = chaveSeg(hit.s), ja = baloes.find(b => b.chave === k);
      if (ja) { fechaBalao(ja); return; }
      camadaBaloes();
      const el = document.createElement('div'); el.className = 'simpcb-balao';
      for (const x of ['mousedown', 'wheel', 'contextmenu', 'dblclick']) el.addEventListener(x, z => z.stopPropagation());
      camadaB.append(el);
      fechaNoApertar(el, () => fechaBalao(b));
      const b = { el, s: hit.s, chave: k, ax: hit.ax, ay: hit.ay, bottom: /bottom/i.test(hit.s.layer), dx: 26 + (baloes.length % 3) * 8, dy: -22, contas: false };
      baloes.push(b);
      pintaBalaoTrilha(b);
      rodaBaloes();
    }
    /* a simulacao andou: o mesmo trecho com os valores novos (a corrente que sumiu fica 0) */
    function atualizaBaloes() {
      for (const b of baloes) {
        if (!b.chave) continue;
        const s = st.res && st.res.segs.find(x => chaveSeg(x) === b.chave);
        b.s = s || Object.assign({}, b.s, { i: 0, dv: 0, p: 0, dT: 0 });
        if (!sobMouse(b.el)) pintaBalaoTrilha(b);
      }
    }
    /* O MICROCONTROLADOR E O NEXOCODE (1.105.0, pedido do dono: "na visão 3D, se eu clico em cima do microcontrolador e
       ele tá desconectado, sobe um balãozinho mostrando que ele tá desconectado"): o clique no corpo do MCU (a caixa dos
       pads dele, na tela) abre o balao com a linha ate ele — desconectado (nenhum codigo do NexoCode ligado) ou
       conectado (firmware rodando/parado). O estado vem do Esquema (__nexoSim.mcus) e o balao acompanha */
    function mcuEm(ev) { const q = pontoNaPlaca(ev); return q ? mcuNoPonto(q) : null; }
    function pintaBalaoMcu(b) {
      const d = dadosDoTopo(), m = d && d.mcus && d.mcus[b.mcu];
      const con = !!(m && m.conectado), est = !d ? 'sem' : con ? (m.rodando ? 'rod' : 'par') : 'desc';
      if (con && !b.eraCon) { b.msg = ''; b.abrindo = false; }   // acabou de conectar: a mensagem do "abrindo" sai
      b.eraCon = con;
      const sig = est + '|' + (b.msg || '') + (b.abrindo ? '|a' : '');
      if (b.sig === sig) return;
      b.sig = sig;
      const sa = setasMcu.get(b.mcu);
      if (sa && sa.con !== con) { sa.con = con; montaSetas(); }
      const esc = x => String(x == null ? '' : x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const proj = (() => { try { return new URLSearchParams(location.search).get('p') || ''; } catch (_e) { return ''; } })();
      b.el.classList.toggle('desc', est !== 'rod' && est !== 'par'); b.el.classList.toggle('con', con);
      const scm = compSim(b.mcu);
      b.el.innerHTML = caixaBalao({ tipo: 'mcu', nome: b.mcu, net: con ? 'NexoCode ●' : 'sem NexoCode', v: scm && scm.vdd != null ? scm.vdd : null,
          linhas: [['Corrente', scm && scm.vdd > 0.05 && scm.p != null ? fmt(Math.abs(scm.p / scm.vdd), 'A') + ' (consumo)' : '0 A']],
          lib: (scm && scm.lib) || (m && m.titulo) || '', acoes: '<button data-x title="Fechar">×</button>' }).replace(/<\/div>$/, '')
        + (est === 'sem' ? '<div class="st">a simulação do esquema está desligada</div>'
          /* 1.110.0 (o dono: "mesmo com ele já conectado, eu consigo clicar em cima do conectado pra abrir o código no
             NexoCode"): o "Conectado" tambem e botao — traz o NexoCode para a frente com o codigo deste projeto (sem
             rodar de novo) */
          : con ? '<button class="conectado" data-abre' + (b.abrindo ? ' disabled' : '') + ' title="Abre no NexoCode o código ligado a este projeto">● Conectado ao NexoCode · abrir o código ▸</button><div class="f">' + esc(b.msg || 'firmware ' + (est === 'rod' ? 'rodando' : 'parado')) + '</div>'
          : '<button class="conectar" data-con' + (b.abrindo ? ' disabled' : '') + ' title="Abre no NexoCode o firmware ligado a este projeto, conecta a este microcontrolador e roda">✕ Desconectado · conectar e rodar ▸</button>'
            + '<div class="f">' + esc(b.msg || 'clique para abrir no NexoCode o firmware ligado a ' + proj + ': ele conecta a este microcontrolador e roda a simulação') + '</div>') + '</div>';
      b.el.querySelector('[data-x]').onclick = () => fechaBalao(b);
      /* 1.106.0 (o dono: "quero clicar em cima de 'desconectado' e ele conecta sozinho, pega o código vinculado ao projeto
         e abre, direto na simulação no NexoCode"): POST /api/nexocode/conectar acha a pasta ligada e abre o NexoCode
         com --rodar; o balao vira "Conectado" sozinho quando o batimento chega */
      const bc = b.el.querySelector('[data-con]') || b.el.querySelector('[data-abre]');
      const soAbre = !!b.el.querySelector('[data-abre]');
      if (bc) bc.onclick = async () => {
        b.abrindo = true; b.msg = 'abrindo o NexoCode…'; b.sig = ''; pintaBalaoMcu(b);
        try {
          const r = await fetch('/api/nexocode/conectar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projeto: proj, mcu: b.mcu, rodar: !soAbre }) });
          const j = await r.json().catch(() => ({}));
          b.msg = j.ok ? (soAbre ? String(j.pasta || '').split(/[\\/]/).pop() + ' aberto no NexoCode' : 'abrindo ' + String(j.pasta || '').split(/[\\/]/).pop() + ' no NexoCode — conecta em alguns segundos') : (j.erro || 'não consegui abrir o NexoCode');
        } catch (e) { b.msg = 'não consegui falar com o hub: ' + (e && e.message || e); }
        b.abrindo = false; b.sig = ''; pintaBalaoMcu(b);
      };
    }
    /* O MCU MARCADO (1.105.2, o dono: "tem uma seta enorme, e o microcontrolador perdeu o efeito de seleção; era pra
       ter só o balão"): sem a seta 3D da 1.105.1 — com o balao aberto o MCU fica SELECIONADO como no editor (o mesmo
       destaque), e a selecao sai junto com o balao (fechar no x ou clicar de novo no MCU): nada fica grudado. */
    const setasMcu = new Map();   // ref -> {x, y, bottom, con}: os MCUs com o balao aberto
    function montaSetas() {
      const V = H.vista3d && H.vista3d();
      if (V && V.extra) { V.extra('nexocode-mcu', null); if (V.animaExtra) V.animaExtra('nexocode-mcu', null); }
      try { if (window.HubMcpVista && window.HubMcpVista.selecionar) window.HubMcpVista.selecionar({ refs: [...setasMcu.keys(), ...baloes.filter(b => b.comp).map(b => b.comp)] }); } catch (_e) { /* ok */ }
      marcaSel3d();
    }
    function marcaSetaMcu(hit, con) {
      if (hit) setasMcu.set(hit.ref, { x: hit.ax, y: hit.ay, bottom: !!hit.bottom, con: !!con });
      montaSetas();
    }
    function alternaBalaoMcu(hit) {
      const ja = baloes.find(b => b.mcu === hit.ref);
      if (ja) { fechaBalao(ja); return; }
      camadaBaloes();
      const el = document.createElement('div'); el.className = 'simpcb-balao simpcb-mcu';
      for (const x of ['mousedown', 'wheel', 'contextmenu', 'dblclick']) el.addEventListener(x, z => z.stopPropagation());
      camadaB.append(el);
      fechaNoApertar(el, () => fechaBalao(b));
      const b = { el, mcu: hit.ref, ax: hit.ax, ay: hit.ay, bottom: hit.bottom, dx: 30, dy: -26 };
      baloes.push(b);
      pintaBalaoMcu(b);
      marcaSetaMcu(hit, /^(rod|par)\|/.test(b.sig || ''));
      rodaBaloes();
    }
    /* O BALAO DO COMPONENTE (1.110.1, o dono: "tô tentando clicar em cima do componente no 3D e ele não tá
       selecionando"): o clique no corpo SELECIONA o componente (o destaque do editor, como o MCU) e abre o balao padrao
       dele — tensao sobre ele, corrente, potencia, o valor editavel (resistor, capacitor, LED) e o queimado. Clicar de
       novo no corpo (ou no x) fecha e tira a selecao */
    function pintaBalaoComp(b) {
      const ref = b.comp, sc = compSim(ref), d = dadosDoTopo(), pl = H.placa(), c = pl && (pl.components || []).find(x => x.ref === ref);
      if (b.el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;   // digitando: nao refaz
      const pinos = c && d && d.pinos ? (c.pads || []).map(p => d.pinos[ref + '-' + p.name]).filter(Boolean) : [];
      const vs = pinos.map(p => p.v).filter(isFinite);
      const v = sc && sc.vdd != null ? sc.vdd : vs.length === 2 ? Math.abs(vs[0] - vs[1]) : vs.length ? Math.max(...vs.map(Math.abs)) : null;
      const i = sc && isFinite(sc.corrente) ? Math.abs(sc.corrente) : pinos.length ? Math.max(...pinos.map(p => Math.abs(p.i || 0))) : null;
      const sig = JSON.stringify([v, i, sc && sc.p, sc && sc.queimado, sc && sc.valor, sc && sc.vf, sc && sc.imax, sc && sc.potencia, sc && sc.tol, sc && sc.campos ? sc.campos.map(x => x.v) : null, sc && sc.brilho != null ? +sc.brilho.toFixed(2) : null]);
      if (b.sig === sig) return;
      b.sig = sig;
      let h = caixaBalao({
        tipo: sc ? sc.tipo : '', nome: ref, sub: sc && sc.valor ? sc.valor : '', net: vs.length === 2 ? 'tensão sobre ele' : '',
        v, nota: sc ? '' : 'fora da simulação', acoes: '<button data-x title="Fechar">×</button>',
        linhas: sc ? [['Corrente', i != null && i > 1e-10 ? fmt(i, 'A') : '0 A'],
          ['Potência', sc.p != null ? fmt(Math.abs(sc.p), 'W') + (sc.potencia ? ' de ' + fmt(sc.potencia, 'W') + ' (' + Math.round(Math.abs(sc.p) / sc.potencia * 100) + ' %)' : '') : ''],
          sc.tol ? ['Valor real', fmt(sc.rReal, 'Ω') + ' (±' + String(sc.tol).replace('.', ',') + ' %)'] : null,
          sc.tipo === 'led' ? ['Brilho', Math.round(Math.min(1, sc.brilho || 0) * 100) + ' %'] : null] : [],
        extra: edicaoDoComp(ref, sc, true), lib: (sc && sc.lib) || (c && c.comment) || '', cor: corDoComp(sc), queimado: !!(sc && sc.queimado),
      }).replace('<div class="nota"></div>', '');
      if (sc && sc.queimado) h = h.replace('<div class="vv', '<div class="nota" style="color:#fca5a5">' + escB(sc.motivo || 'passou do limite') + '</div><div class="vv');
      b.el.innerHTML = h;
      b.el.querySelector('[data-x]').onclick = () => fechaBalao(b);
      ligaEdicao(b.el, ref);
    }
    function alternaBalaoComp(cp) {
      const ja = baloes.find(b => b.comp === cp.ref);
      if (ja) { fechaBalao(ja); return; }
      camadaBaloes();
      const el = document.createElement('div'); el.className = 'simpcb-balao simpcb-comp';
      for (const x of ['mousedown', 'wheel', 'contextmenu', 'dblclick', 'keydown']) el.addEventListener(x, z => z.stopPropagation());
      camadaB.append(el);
      fechaNoApertar(el, () => fechaBalao(b));
      const b = { el, comp: cp.ref, ax: cp.ax, ay: cp.ay, bottom: cp.bottom, dx: 30, dy: -26 };
      baloes.push(b);
      pintaBalaoComp(b);
      montaSetas();
      rodaBaloes();
    }
    try { topo.addEventListener('nexo-sim', () => { for (const b of baloes) { if (sobMouse(b.el)) continue; if (b.mcu) pintaBalaoMcu(b); else if (b.comp) pintaBalaoComp(b); } }); } catch (_e) { /* ok */ }
    /* o que os testes e a IA usam daqui */
    window.HubSimPcbBaloes = { lista: () => baloes.map(b => ({ chave: b.chave || null, cartao: !!b.cartao, mcu: b.mcu || null, comp: b.comp || null, estado: b.sig || null, i: b.s ? b.s.i : null })), trilhaEm, alternaBalaoTrilha, mcuEm, alternaBalaoMcu, alvoEm, alternaBalaoComp, mira: () => chaveAlvo(hoverAlvo),
      setas: () => [...setasMcu].map(([ref, a]) => ({ ref, conectado: a.con, bottom: a.bottom })) };
    /* o que a bancada (hub-bancada.js) usa daqui */
    window.HubSimPcbInt = { padEm, padsDaPlaca, H, dados: () => st.dados, mostraCartao };
    const CSS2 = `.simpcb-cartao{position:fixed; z-index:70; min-width:220px; max-width:320px; padding:9px 11px; border-radius:10px; pointer-events:none;
  background:rgba(12,15,20,.96); color:#e5e7eb; border:1px solid rgba(255,255,255,.12); box-shadow:0 10px 30px rgba(0,0,0,.5); font:12px system-ui, sans-serif}
.simpcb-cartao.fixo{pointer-events:auto; border-color:#f59e0b} .simpcb-cartao .t{font-weight:700} .simpcb-cartao .t span{font-weight:500; color:#9ca3af}
.simpcb-cartao .c{color:#9ca3af; margin-top:3px} .simpcb-cartao .g{display:grid; grid-template-columns:auto 1fr; gap:2px 10px; margin-top:5px} .simpcb-cartao .g b{text-align:right}
.simpcb-cartao .ds{margin-top:6px; padding:6px 8px; border-radius:7px; background:rgba(59,130,246,.14); color:#dbeafe} .simpcb-cartao .ds .dd{color:#93c5fd; font-size:11px}
.simpcb-cartao a{display:inline-block; margin-top:6px; color:#93c5fd}
.simpcb-balao{position:fixed; pointer-events:auto; min-width:150px; max-width:340px; padding:6px 9px; border-radius:10px; background:rgba(12,15,20,.96); color:#e5e7eb;
  border:1px solid #facc15; box-shadow:0 8px 24px rgba(0,0,0,.5); font:12px system-ui, sans-serif}
.simpcb-balao .hd{display:flex; align-items:center; gap:7px} .simpcb-balao .hd b{color:#facc15} .simpcb-balao .hd span{flex:1; color:#9ca3af}
.simpcb-balao button{height:20px; padding:0 6px; border-radius:6px; border:1px solid rgba(255,255,255,.15); background:rgba(255,255,255,.05); color:inherit; cursor:pointer; font:11px system-ui}
.simpcb-balao button.on{background:#f59e0b; color:#111; border-color:#f59e0b}
.bx{min-width:230px} .bx .l1{display:flex; align-items:center; gap:6px; font-weight:600; white-space:nowrap}
.bx .tp{padding:1px 6px; border-radius:5px; background:rgba(245,158,11,.16); color:#fbbf24; font:700 9.5px system-ui, sans-serif; text-transform:uppercase; letter-spacing:.05em}
.bx .l1 b{color:#f3f4f6} .bx .sb{color:#9ca3af; font-weight:500} .bx .nt{margin-left:auto; padding-left:12px; color:#93c5fd; font:600 11px ui-monospace, monospace}
.bx .l1 button{margin-left:4px}
.bx .vv{margin:8px 0 6px; text-align:center; font:800 26px system-ui, sans-serif; letter-spacing:-.01em; line-height:1.1}
.bx .vv.off{color:#4b5563} .bx .vv.on{color:#ff2d2d; text-shadow:0 0 14px rgba(255,45,45,.55)}
.bx .nota{text-align:center; color:#6b7280; font-size:11px; margin:-2px 0 4px}
.bx .ls{display:grid; grid-template-columns:auto 1fr; gap:2px 10px; font-size:11.5px; color:#9ca3af} .bx .ls b{text-align:right; color:#e5e7eb; font-weight:600}
.bx .ds{margin-top:6px; padding:5px 8px; border-radius:7px; background:rgba(59,130,246,.12); color:#dbeafe; font-size:11px} .bx .ds .dd{color:#93c5fd; font-size:10.5px}
.bx .tq{padding:1px 6px; border-radius:5px; background:rgba(239,68,68,.22); color:#fca5a5; font:700 9.5px system-ui, sans-serif; text-transform:uppercase; letter-spacing:.05em}
.bx .ed{display:grid; grid-template-columns:1fr 78px auto; gap:4px; align-items:center; margin-top:6px} .bx .ed span{font-size:11px; color:#9ca3af}
.bx .ed input{width:100%; height:22px; padding:0 6px; border-radius:6px; border:1px solid rgba(255,255,255,.18); background:rgba(0,0,0,.3); color:#e5e7eb; font:11.5px system-ui, sans-serif}
.bx .ed button, .bx button.trocar{height:22px; padding:0 8px; border-radius:6px; border:1px solid rgba(255,255,255,.18); background:rgba(255,255,255,.06); color:#e5e7eb; cursor:pointer; font:11px system-ui}
.bx button.trocar{width:100%; margin-top:6px; color:#fecaca; border-color:rgba(239,68,68,.5); background:rgba(239,68,68,.14)}
.bx.queimado .vv{color:#7f1d1d; text-shadow:none}
.bx .lib{margin-top:8px; color:#cbd5e1; font-size:11px} .bx .cr{margin-top:1px; font:700 11.5px system-ui, sans-serif}
.bx a{display:inline-block; margin-top:5px; color:#93c5fd; font-size:11px}
.simpcb-mcu.desc{border-color:#9ca3af} .simpcb-mcu.desc .hd b{color:#d1d5db} .simpcb-mcu.desc .st{color:#fca5a5; font-weight:700; margin-top:4px}
.simpcb-mcu.con{border-color:#22c55e} .simpcb-mcu.con .hd b{color:#4ade80} .simpcb-mcu.con .st{color:#4ade80; font-weight:700; margin-top:4px}
.simpcb-mcu button.conectar{display:block; width:100%; height:auto; margin-top:5px; padding:5px 8px; text-align:left; font:700 12px system-ui, sans-serif;
  color:#fca5a5; border-color:rgba(252,165,165,.45); background:rgba(239,68,68,.12)}
.simpcb-mcu button.conectado{display:block; width:100%; height:auto; margin-top:5px; padding:5px 8px; text-align:left; font:700 12px system-ui, sans-serif;
  color:#86efac; border-color:rgba(74,222,128,.5); background:rgba(34,197,94,.12); cursor:pointer}
.simpcb-mcu button.conectado:hover{background:rgba(34,197,94,.26); color:#dcfce7} .simpcb-mcu button.conectado[disabled]{opacity:.6; cursor:progress}
.simpcb-mcu button.conectar:hover{background:rgba(239,68,68,.25); color:#fee2e2} .simpcb-mcu button.conectar[disabled]{opacity:.6; cursor:progress}
.simpcb-balao.simpcb-mcu .f{max-width:300px; white-space:normal; font:11px system-ui, sans-serif; color:#cbd5e1}
.simpcb-balao .f{margin-top:5px; color:#93c5fd; font:10.5px ui-monospace, monospace; line-height:1.45}
.simpcb-cartao .ab{display:flex; gap:4px; margin:-2px 0 7px} .simpcb-cartao .ab button{flex:1; height:24px; border-radius:6px; border:1px solid rgba(255,255,255,.15); background:rgba(255,255,255,.05); color:inherit; cursor:pointer; font:inherit}
.simpcb-cartao .ab button.on{background:#f59e0b; color:#111; border-color:#f59e0b} .simpcb-cartao .ab button[data-m=x]{flex:0 0 26px}
.simpcb-cartao canvas{display:block; width:300px; height:140px; margin-top:6px; border-radius:7px; background:#05070a} .simpcb-cartao .lg{margin-top:4px; color:#9ca3af; font:10.5px ui-monospace, monospace}`;
    { const sc = document.createElement('style'); sc.textContent = CSS2; document.head.append(sc); }

    if (naAba) { try { Object.defineProperty(window, '__hubMenus', { configurable: true, get: () => null, set: () => {} }); } catch (_e) { /* ok */ } }
    if (naAba) {
      /* A AREA DE SIMULACAO da placa (pedido do dono: "é uma área completamente nova, não traz nenhuma das ferramentas" e
         "a PCB na visão 2D também mostra o funcionamento elétrico"): sai a barra, o filtro/camadas, o painel, as abas de
         camada e o rodape; nada se edita (o clique esquerdo e as teclas nao chegam a vista); navegar continua */
      const sty = document.createElement('style');
      sty.textContent = '#pcbtb, #cantoesq, #splitR, #props, #abas, #status, #alertaCodigo, #btnPaineis, #btnArtes, #menubar, #help, #annform, #txtbox{display:none !important} body{background:#000 !important}';
      document.head.append(sty);
      setTimeout(() => window.dispatchEvent(new Event('resize')), 200);
      /* o clique: bancada, MCU, pad, trilha (true = usou o clique) */
      const trataClique = e => {
        /* a bancada (mover item, ligar fio) pega o clique primeiro */
        if (window.HubBancada && window.HubBancada.consome && window.HubBancada.consome(e)) return true;
        /* 1.110.0: o MESMO alvo que esta marcado sob o mouse (alvoEm) */
        const a = alvoEm(e);
        if (!a) return false;
        if (a.tipo === 'mcu') alternaBalaoMcu(a.mcu);
        else if (a.tipo === 'comp') alternaBalaoComp(a.comp);
        else if (a.tipo === 'pad') mostraCartao(a.pad, e, true);
        else alternaBalaoTrilha(a.trilha);
        return true;
      };
      let baixo3d = null;
      const guarda = alvo => {
        { const sm = document.createElement('style'); sm.textContent = '.simpcb-mira, .simpcb-mira *{cursor:pointer !important}'; document.head.append(sm); }
        alvo.addEventListener('mousedown', e => {
          if (e.button !== 0) return;
          e.stopPropagation(); e.preventDefault();
          if (H.em3d()) return;   /* o 3D trata no pointerdown (abaixo) */
          if (!trataClique(e)) mostraCartao(null);
        }, true);
        /* 1.105.1: no 3D a vista cancela o pointerdown (o mousedown acima nunca chegava) e o clique dela SELECIONAVA o
           componente como no editor (o corpo pintado que ficava grudado). Aqui: o clique que acerta algo e do
           Simulador (a vista nao gira nem seleciona); no vazio a vista gira como sempre, e o clique sem arrastar fecha o
           cartao */
        alvo.addEventListener('pointerdown', e => {
          baixo3d = null;
          if (e.button !== 0 || !H.em3d()) return;
          if (trataClique(e)) { e.stopPropagation(); return; }
          baixo3d = { x: e.clientX, y: e.clientY };
        }, true);
        alvo.addEventListener('pointerup', e => {
          if (e.button !== 0 || !H.em3d() || !baixo3d) return;
          const andou = Math.hypot(e.clientX - baixo3d.x, e.clientY - baixo3d.y) >= 3;
          baixo3d = null;
          if (!andou) mostraCartao(null);   /* a vista nao seleciona nada no Simulador (pcbframe: aoClicar sem efeito nos modos sim) */
        }, true);
        /* 1.110.0: ao passar o mouse, o que o clique vai pegar fica MARCADO (contorno ciano no pad, na trilha inteira ou
           no MCU) e o cursor vira a mãozinha; so a marca (pedido do dono: nada de balao ao passar o mouse). Calculado uma
           vez por quadro; girando a vista (botao apertado) nao marca */
        let pedeMira = 0;
        const mira = () => {
          pedeMira = 0;
          const e = ultMouse; if (!e) return;
          const a = e.buttons ? null : alvoEm(e);
          alvo.classList.toggle('simpcb-mira', !!a);
          if (chaveAlvo(a) === chaveAlvo(hoverAlvo)) { hoverAlvo = a; return; }
          hoverAlvo = a;
          if (H.em3d()) marcaAlvo3d(); else H.redesenha();
        };
        alvo.addEventListener('mousemove', e => { ultMouse = { clientX: e.clientX, clientY: e.clientY, buttons: e.buttons }; if (!pedeMira) pedeMira = requestAnimationFrame(mira); }, { passive: true });
        let tSel = 0;
        alvo.addEventListener('wheel', () => { clearTimeout(tSel); tSel = setTimeout(marcaSel3d, 250); }, { passive: true });
        alvo.addEventListener('wheel', e => { ultMouse = { clientX: e.clientX, clientY: e.clientY, buttons: 0 }; if (!pedeMira) pedeMira = requestAnimationFrame(() => requestAnimationFrame(mira)); }, { passive: true });
        alvo.addEventListener('mouseleave', () => { ultMouse = null; alvo.classList.remove('simpcb-mira'); soltaAnel(); if (cartao && !cartao.classList.contains('fixo')) cartao.hidden = true; }, { passive: true });
        alvo.addEventListener('dblclick', e => e.stopPropagation(), true);
        alvo.addEventListener('contextmenu', e => { e.stopPropagation(); e.preventDefault(); }, true);
      };
      const tenta = () => { const cvh = H.canvas && H.canvas(), h3 = H.host3d && H.host3d(); if (cvh && h3) { guarda(cvh.parentElement); } else setTimeout(tenta, 300); };
      tenta();
      window.addEventListener('keydown', e => {
        const t = e.target;
        if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
        if (H.em3d() && /^[089]$/.test(e.key)) return;
        if ((modoAtual === 'bancada' || modoAtual === 'sim3d') && /^(Delete|Backspace|r|R|Escape)$/.test(e.key)) { e.preventDefault(); return; }   // a bancada trata (hub-bancada.js)
        if (e.key === 'Escape' && cartao) cartao.hidden = true;
        e.stopPropagation(); e.preventDefault();
      }, true);
      requestAnimationFrame(animaPontos);
      setTimeout(() => window.HubSimPcbModo(modoPg), 0);   // definido logo abaixo
    }
    /* o modo da area (a aba Simulador troca sem recarregar a pagina): sim2d = a placa em 2D; sim3d e bancada = no 3D */
    let modoAtual = modoPg;
    window.HubSimPcbModo = function (m) {
      modoAtual = m;
      let tentativas = 0;
      const vai = () => {
        if (!H.placa()) { if (++tentativas < 60) setTimeout(vai, 400); return; }
        try {
          if (m === 'sim2d') { if (H.em3d()) H.sai3d(); }
          else if (!H.em3d()) H.entra3d();
        } catch (_e) { if (++tentativas < 60) setTimeout(vai, 400); return; }
        /* 1.104.0: o 3D da aba Simulador E a bancada (o modo 'bancada' antigo continua aceito: e o mesmo 3D) */
        if (window.HubBancada && typeof window.HubBancada.ativa === 'function') window.HubBancada.ativa(m === 'bancada' || m === 'sim3d');
        agenda();
      };
      vai();
    };
    /* o 3D entra e sai, a placa muda, a simulacao chega: confere de tempos em tempos */
    let ultEm3d = false, ultPlaca = null;
    setInterval(() => {
      const em = H.em3d(), pl = H.placa();
      const d = dadosDoTopo();
      if (d !== st.dados) { st.dados = d; if (em || naAba) agenda(); }
      if (em !== ultEm3d || pl !== ultPlaca) { ultEm3d = em; ultPlaca = pl; if (em) agenda(); else pinta(); }
    }, 700);

    /* o MCP (mcp/hub-mcpvista.js » 'simulador' na vista PCB) */
    if (!window.HubSimulador) window.HubSimulador = {
      async mcp(a) {
        a = a || {};
        if (/^bancada_/.test(a.acao || '')) { if (!window.HubBancada) throw new Error('a bancada não carregou nesta vista'); return window.HubBancada.mcp(a); }
        if (a.acao === 'pcb_modo') { window.HubSimPcbModo(a.modo); return { modo: a.modo }; }
        st.dados = dadosDoTopo();
        if (a.acao === 'pcb_mostrar') { st.ligado = a.ligado !== false; try { localStorage.setItem(PREF, st.ligado ? '1' : '0'); } catch (_e) { /* ok */ } if (a.calculos != null) st.calc = !!a.calculos; if (a.baloes != null) st.baloes = !!a.baloes; monta(); return { ligado: st.ligado, baloes: st.baloes, em3d: H.em3d() }; }
        if (!st.dados) throw new Error('não há simulação deste projeto: ligue o Simular no Esquema (sim_controlar {acao:"ligar"})');
        const r = correntes(H.placa(), st.dados.pinos, { cobre_um: a.cobre_um });
        const top = r.segs.slice().sort((x, y) => Math.abs(y.i) - Math.abs(x.i)).slice(0, +a.limite || 40);
        return { t: st.dados.t, modo: st.dados.modo, imax: r.imax, nets: r.nets, pads_sem_pino: r.sem.slice(0, 50), trilhas: top };
      },
    };
  }
  if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(instalaNaVista, 0));
    else setTimeout(instalaNaVista, 0);
  }

  return { correntes };
});
