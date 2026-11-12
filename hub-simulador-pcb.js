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
        /* referencia: o no com mais corrente injetada (a fonte da net), senao o primeiro */
        let ref = membros[0], mx = -1;
        for (const i of membros) { const k = [...g.nos.keys()][i]; const q = Math.abs(g.inj.get(k) || 0); if (q > mx) { mx = q; ref = i; } }
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
    const st = { ligado: (() => { try { return localStorage.getItem(PREF) !== '0'; } catch (_e) { return true; } })(), calc: true,
                 dados: null, res: null, versao: 0, ui: null, rotulos: [], setas: null, fase: 0, montado: 0 };
    let topo = window;
    try { topo = window.top && window.top.document ? window.top : window; } catch (_e) { topo = window; }
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
      el.innerHTML = '<div class="hd"><span>⚡</span><b>Corrente nas trilhas</b><button data-a="calc">contas</button><button data-a="on"></button></div>'
        + '<div class="st"></div><div class="leg"></div><div class="legt"><span>0</span><span class="mx"></span></div><ol></ol>';
      for (const ev of ['mousedown', 'pointerdown', 'wheel', 'contextmenu', 'dblclick']) el.addEventListener(ev, e => e.stopPropagation(), { passive: ev === 'wheel' });
      el.querySelector('[data-a=on]').onclick = () => { st.ligado = !st.ligado; try { localStorage.setItem(PREF, st.ligado ? '1' : '0'); } catch (_e) { /* ok */ } monta(); };
      el.querySelector('[data-a=calc]').onclick = () => { st.calc = !st.calc; pinta(); };
      const camadaRot = document.createElement('div'); camadaRot.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:4;overflow:hidden';
      host.append(el, camadaRot);
      st.ui = { el, rot: camadaRot };
      return st.ui;
    }
    function pinta() {
      const u = ui(); if (!u) return;
      u.el.hidden = !H.em3d();
      u.rot.hidden = !H.em3d() || !st.ligado;
      const bOn = u.el.querySelector('[data-a=on]'); bOn.textContent = st.ligado ? 'ligado' : 'desligado'; bOn.classList.toggle('on', st.ligado);
      u.el.querySelector('[data-a=calc]').classList.toggle('on', st.calc);
      const s = u.el.querySelector('.st'), ol = u.el.querySelector('ol');
      ol.textContent = '';
      if (!st.dados) { s.textContent = 'Ligue o Simular na vista Esquema deste projeto: a corrente de cada pino vem de lá.'; return; }
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
      pinta();
      if (!V || typeof V.extra !== 'function') return;
      if (!st.ligado || !st.dados || !H.placa()) { V.extra('simCorrente', null); V.anima(null); limpaRotulos(); st.res = null; pinta(); return; }
      try { st.res = correntes(H.placa(), st.dados.pinos, {}); } catch (e) { console.warn('corrente nas trilhas:', e); st.res = null; return; }
      const T = V.T(), esp = V.espessura();
      const g = new T.Group(); g.name = 'simCorrente';
      const imax = Math.max(st.res.imax, 1e-9);
      const vivos = st.res.segs.filter(s => Math.abs(s.i) > Math.max(1e-6, imax * 1e-3));
      const fator = s => Math.pow(Math.min(1, Math.abs(s.i) / imax), 0.45);
      for (const s of vivos) {
        const f = fator(s), z = /bottom/i.test(s.layer) ? -esp - 0.045 : /top/i.test(s.layer) ? 0.045 : -esp / 2;
        const geo = new T.BoxGeometry(s.len, s.w * 1.04, 0.02);
        const m = new T.MeshBasicMaterial({ color: cor(T, f), transparent: true, opacity: 0.55 + 0.4 * f, depthWrite: false, toneMapped: false });
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
        const mat = new T.MeshBasicMaterial({ color: 0xfff7d6, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false });
        const inst = new T.InstancedMesh(cone, mat, usadas.length);
        inst.renderOrder = 6;
        g.add(inst);
        st.setas = { inst, usadas, T, esp };
      } else st.setas = null;
      V.extra('simCorrente', g);
      rotulos(vivos);
      const M4 = st.setas ? new st.setas.T.Matrix4() : null, Q = st.setas ? new st.setas.T.Quaternion() : null, E = st.setas ? new st.setas.T.Euler() : null;
      const P = st.setas ? new st.setas.T.Vector3() : null, S = st.setas ? new st.setas.T.Vector3() : null;
      V.anima(dt => {
        st.fase += dt;
        if (st.setas) {
          const { inst, usadas: us, esp: e } = st.setas;
          us.forEach((a, idx) => {
            const s = a.s, L = s.len, dir = Math.sign(s.i) || 1;
            const vel = (1.5 + 5 * Math.log10(1 + Math.abs(s.i) / 1e-4));           // mm/s
            let d = ((a.k * a.passo + st.fase * vel) % (a.n * a.passo));
            if (dir < 0) d = a.n * a.passo - d;
            const t = Math.min(1, d / L);
            const x = s.x1 + (s.x2 - s.x1) * t, y = s.y1 + (s.y2 - s.y1) * t;
            const z = /bottom/i.test(s.layer) ? -e - 0.09 : /top/i.test(s.layer) ? 0.09 : -e / 2;
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
    /* o 3D entra e sai, a placa muda, a simulacao chega: confere de tempos em tempos */
    let ultEm3d = false, ultPlaca = null;
    setInterval(() => {
      const em = H.em3d(), pl = H.placa();
      const d = dadosDoTopo();
      if (d !== st.dados) { st.dados = d; if (em) agenda(); }
      if (em !== ultEm3d || pl !== ultPlaca) { ultEm3d = em; ultPlaca = pl; if (em) agenda(); else pinta(); }
    }, 700);

    /* o MCP (mcp/hub-mcpvista.js » 'simulador' na vista PCB) */
    if (!window.HubSimulador) window.HubSimulador = {
      async mcp(a) {
        a = a || {};
        st.dados = dadosDoTopo();
        if (a.acao === 'pcb_mostrar') { st.ligado = a.ligado !== false; try { localStorage.setItem(PREF, st.ligado ? '1' : '0'); } catch (_e) { /* ok */ } if (a.calculos != null) st.calc = !!a.calculos; monta(); return { ligado: st.ligado, em3d: H.em3d() }; }
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
