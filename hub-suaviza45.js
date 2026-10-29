/* NexoEletric - hub-suaviza45.js — SUAVIZAR A 45° sem soltar ramo (P3 do relato de 2026-10-28, item 21).

   O relato: uma IA roteou uma placa de potência com um A* de grade (0,05 mm) e precisou suavizar as
   rotas a 45° depois. "A versão ingênua deixou pontas soltas": ela andava com os vértices de uma
   trilha sem ver que outra trilha da mesma net chegava NO MEIO dela (um T), ou que uma via ou um pad
   estava pendurado ali — o vértice andou, o ramo ficou no ar.

   O que este arquivo faz, por camada e net:
     1. as trilhas viram ARESTAS de um grafo (ponta com ponta a menos de 0,1 µm é o mesmo nó);
     2. TODO ponto em que outro cobre da mesma net encosta no meio de uma aresta (ponta de trilha ou
        arco, via, pad, cruzamento com outra trilha) PARTE a aresta ali e vira nó FIXO; também é fixo
        o nó de grau diferente de 2, o nó em cima de pad/via/arco/trilha que não entra na suavização, e
        o nó onde a largura muda;
     3. entre dois nós fixos fica uma CADEIA (os vértices do meio só têm as duas arestas dela): é ela
        que se suaviza, com as duas pontas paradas — então todo ramo, via e pad continua tocando;
     4. a suavização é a do roteador (HubRoteador.motor: suaviza — o vértice mais distante que se
        alcança com reta ou diagonal+reta — e tiraDegraus), com a regra da camada e da net: a folga de
        cada par pela Clearance vencedora (as regras do DRC), o contorno, e pad da MESMA net que a
        cadeia não tocava como obstáculo encostado (a trilha nova não passa por cima de pad). Cadeia
        que já estava em conflito com outra net fica como está (não piorar). modo 'chanfro': em vez de
        puxar o fio, só chanfra cada canto de 90° (pernas de até `chanfro` mm, padrão 1);
     5. a CONFERÊNCIA: o ratsnest (HubPcbNets) e as pontas soltas (NetAntennae do DRC) de cada net,
        antes e depois. Net que piorou volta inteira ao que era (e entra em `revertidas`).

   Saída: as ops do changes.js — track_del da trilha que mudou (o MCP põe os orig_* ou tira a linha
   track_add de quem nasceu no changes.js) e track_add dos trechos novos (e dos pedaços que sobram de
   uma trilha partida que não mudou).

   Lógica pura, sem DOM: Node (MCP pcb_suavizar, tests/test-suaviza45.js) e navegador (global
   HubSuaviza45, depois do hub-roteador.js e do hub-pcbnets.js).

   API
     suaviza(eb, opts) -> {ops, cadeias, suavizadas, mantidas, vertices:{antes, depois}, comprimento:
                           {antes, depois}, porNet:[...], revertidas:[net], puladas:{motivo: n}, ms}
       opts {cena | regras, clearance, placa, textoGeo (para montar a cena), roteador,
             nets, ids (só estas trilhas), camadas, modo 'puxar' (padrão) | 'chanfro', chanfro (mm),
             degrau (mm, padrão 0,3: perna menor que isto sai pelo tiraDegraus), note} */
(function (raiz, fabrica) {
  const m = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.HubSuaviza45 = m;
})(typeof self !== 'undefined' ? self : this, function () {
"use strict";

const NO = 1e-4;            /* mm: pontas a menos disto são o mesmo nó */
const PERTO = 1e-3;         /* mm: contato a menos disto da ponta da aresta não parte a aresta */
const ENCOSTA = 1e-3;       /* mm: pad da mesma net que a cadeia não tocava — a trilha não passa por cima */
const DEGRAU = 0.3;
const CHANFRO = 1.0;
const isNum = v => typeof v === 'number' && isFinite(v);
const r6 = v => { const x = Math.round(v * 1e6) / 1e6; return x === 0 ? 0 : x; };
const agora = (typeof performance === 'object' && performance && typeof performance.now === 'function') ? () => performance.now() : () => Date.now();

function mod(global, arquivo){
  try {
    if (global === 'HubRoteador' && typeof HubRoteador !== 'undefined' && HubRoteador) return HubRoteador;
    if (global === 'HubPcbNets' && typeof HubPcbNets !== 'undefined' && HubPcbNets) return HubPcbNets;
    if (global === 'HubPcbDrc' && typeof HubPcbDrc !== 'undefined' && HubPcbDrc) return HubPcbDrc;
  } catch (e) { /* sem o global */ }
  try { if (typeof require === 'function') return require(arquivo); } catch (e) { /* sem o módulo */ }
  return null;
}
function exige(global, arquivo){
  const m = mod(global, arquivo);
  if (!m) throw new Error('HubSuaviza45: falta o ' + arquivo + ' (' + global + ')');
  return m;
}

/* ---------------- geometria ---------------- */
function projeta(px, py, ax, ay, bx, by){
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx, qy = ay + t * dy;
  return { t, x: qx, y: qy, d: Math.hypot(px - qx, py - qy) };
}
function cruzaSeg(a, b, c, d){
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-15) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, x: a[0] + t * r[0], y: a[1] + t * r[1] };
}
const ehTH = p => p.layer === 'Multi' || (!p.layer && p.type === 'th');
const chave = (x, y) => Math.round(x / NO) + ',' + Math.round(y / NO);

/* ---------------- o lado que encosta: o cobre da mesma net na camada ---------------- */
/* tudo da net na camada que NÃO entra na suavização, como "toca o ponto (x,y) com raio r?" */
function outrosDaNet(eb, M, layer, net, selIds){
  const L = [];
  for (const t of eb.tracks || []) if (t && t.layer === layer && t.net === net && !t.keepout && !selIds.has(String(t.id)) && [t.x1, t.y1, t.x2, t.y2].every(isNum))
    L.push({ tipo: 'track', id: t.id, seg: [[t.x1, t.y1], [t.x2, t.y2]], r: (t.w || 0) / 2, pontas: [[t.x1, t.y1], [t.x2, t.y2]] });
  for (const a of eb.arcs || []) if (a && a.layer === layer && a.net === net && !a.keepout && [a.cx, a.cy, a.r].every(isNum)) {
    const p = g => [a.cx + a.r * Math.cos(g * Math.PI / 180), a.cy + a.r * Math.sin(g * Math.PI / 180)];
    L.push({ tipo: 'arc', id: a.id, pontas: [p(a.sa || 0), p(a.ea || 0)], r: (a.w || 0) / 2, arco: a });
  }
  for (const v of eb.vias || []) if (v && v.net === net && isNum(v.x) && isNum(v.y) && v.size > 0)
    L.push({ tipo: 'via', id: v.id, centro: [v.x, v.y], r: v.size / 2 });
  const pad = p => {
    if (!p || p.net !== net || !isNum(p.x) || !isNum(p.y)) return;
    if (!ehTH(p) && p.layer !== layer) return;
    const f = M.caixaDaForma(M.formaLado(p, layer === 'Bottom'));
    if (!f) return;
    const c0 = M.centroCobre(p), cs = M.cosSen(p.rot || 0);
    const rr = Math.max(0, Math.min(f.rr || 0, f.hx, f.hy));
    L.push({ tipo: 'pad', id: p.id, centro: c0, caixa: { g: [c0[0], c0[1], f.hx - rr, f.hy - rr, rr, cs[0], cs[1]] } });
  };
  for (const c of eb.components || []) for (const p of (c && c.pads) || []) pad(p);
  for (const p of eb.freepads || []) pad(p);
  return L;
}
/* o objeto toca o ponto (com o raio da trilha w/2)? */
function tocaPonto(M, o, x, y, r){
  if (o.seg) return projeta(x, y, o.seg[0][0], o.seg[0][1], o.seg[1][0], o.seg[1][1]).d <= o.r + r + 1e-6;
  /* arco: perto do círculo dele já conta (do lado seguro: o nó fica fixo) */
  if (o.arco) { const a = o.arco; return Math.abs(Math.hypot(x - a.cx, y - a.cy) - a.r) <= o.r + r + 1e-6; }
  if (o.caixa) return M.sdPontoCaixa(o.caixa.g, 0, x, y) <= r + 1e-6;
  return Math.hypot(o.centro[0] - x, o.centro[1] - y) <= o.r + r + 1e-6;
}
/* os pontos do MEIO da aresta A-B (largura w) em que o objeto encosta: [t] */
function contatosNaAresta(M, o, A, B, w){
  const r = w / 2, out = [];
  const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
  if (L <= 2 * PERTO) return out;
  const poe = t => { if (t * L > PERTO && (1 - t) * L > PERTO) out.push(t); };
  /* as pontas do outro (trilha, arco) que pousam na aresta */
  for (const q of o.pontas || []) { const p = projeta(q[0], q[1], A[0], A[1], B[0], B[1]); if (p.d <= r + (o.r || 0) + 1e-6) poe(p.t); }
  /* a trilha que cruza a aresta no meio (as duas seguem: o cruzamento é ligação) */
  if (o.seg) { const c = cruzaSeg(A, B, o.seg[0], o.seg[1]); if (c) poe(c.t); }
  /* via e pad pendurados na aresta: o ponto mais perto do centro deles */
  if (o.centro) {
    const p = projeta(o.centro[0], o.centro[1], A[0], A[1], B[0], B[1]);
    const enc = o.caixa ? M.sdPontoCaixa(o.caixa.g, 0, p.x, p.y) <= r + 1e-6 : p.d <= o.r + r + 1e-6;
    if (enc) poe(p.t);
  }
  return out;
}

/* ---------------- a suavização de uma cadeia ---------------- */
function chanfra(R, M, pts, lim){
  const P = pts.map(p => [p[0], p[1]]), n = P.length;
  const out = [P[0]];
  /* cada canto tem metade de cada perna; a primeira e a última pernas são inteiras do canto vizinho */
  for (let i = 1; i < n - 1; i++) {
    const A = out[out.length - 1], V = P[i], B = P[i + 1];
    const li = Math.hypot(V[0] - P[i - 1][0], V[1] - P[i - 1][1]), lo = Math.hypot(B[0] - V[0], B[1] - V[1]);
    const ui = [(V[0] - P[i - 1][0]) / li, (V[1] - P[i - 1][1]) / li], uo = [(B[0] - V[0]) / lo, (B[1] - V[1]) / lo];
    const cos = ui[0] * uo[0] + ui[1] * uo[1];
    if (cos > Math.SQRT1_2 + 1e-9) { out.push(V); continue; }          /* curva de 45° ou menos: fica */
    const a = Math.min(lim, (i === 1 ? li : li / 2), (i === n - 2 ? lo : lo / 2));
    const K1 = [V[0] - ui[0] * a, V[1] - ui[1] * a], K2 = [V[0] + uo[0] * a, V[1] + uo[1] * a];
    if (a > 1e-6 && M.segLivre(R, A[0], A[1], K1[0], K1[1]) && M.segLivre(R, K1[0], K1[1], K2[0], K2[1]) && M.segLivre(R, K2[0], K2[1], B[0], B[1])) out.push(K1, K2);
    else out.push(V);
  }
  out.push(P[n - 1]);
  return M.limpa(out);
}

function suaviza(eb, opts){
  const t0 = agora(), o = opts || {};
  const RT = o.roteador && o.roteador.motor ? o.roteador : exige('HubRoteador', './hub-roteador.js');
  const NETS = exige('HubPcbNets', './hub-pcbnets.js');
  const cena = o.cena || RT.cena(eb, { regras: o.regras, clearance: o.clearance, placa: o.placa, textoGeo: o.textoGeo });
  const M = RT.motor;
  for (const l of cena.camadas) M.camada(cena, l);
  const modo = o.modo === 'chanfro' ? 'chanfro' : 'puxar';
  const lim = isNum(o.chanfro) && o.chanfro > 0 ? o.chanfro : CHANFRO;
  const degrau = isNum(o.degrau) && o.degrau >= 0 ? o.degrau : DEGRAU;
  const note = typeof o.note === 'string' && o.note ? String(o.note).replace(/":/g, '" :') : 'suavizar 45';
  const fNets = Array.isArray(o.nets) && o.nets.length ? new Set(o.nets.map(String)) : null;
  const fIds = Array.isArray(o.ids) && o.ids.length ? new Set(o.ids.map(String)) : null;
  const fCam = Array.isArray(o.camadas) && o.camadas.length ? new Set(o.camadas.map(String)) : null;
  const rel = { ops: [], cadeias: 0, suavizadas: 0, mantidas: 0, vertices: { antes: 0, depois: 0 }, comprimento: { antes: 0, depois: 0 },
                porNet: [], revertidas: [], puladas: {}, ms: 0 };
  const pula = m => { rel.puladas[m] = (rel.puladas[m] || 0) + 1; };

  /* as trilhas que entram */
  const sel = (eb.tracks || []).filter(t => t && t.id != null && !t.owner && !t.keepout && M.ehCobre(t.layer) && typeof t.net === 'string' && t.net &&
    [t.x1, t.y1, t.x2, t.y2, t.w].every(isNum) && Math.hypot(t.x2 - t.x1, t.y2 - t.y1) > NO &&
    (!fNets || fNets.has(t.net)) && (!fIds || fIds.has(String(t.id))) && (!fCam || fCam.has(t.layer)));
  const grupos = new Map();
  for (const t of sel) { const k = t.layer + '\u0001' + t.net; let g = grupos.get(k); if (!g) grupos.set(k, g = []); g.push(t); }

  /* o resultado de cada net: as trilhas que saem e as que entram (para reverter a net inteira) */
  const porNet = new Map();
  for (const [k, trilhas] of grupos) {
    const [layer, net] = k.split('\u0001');
    const selIds = new Set(trilhas.map(t => String(t.id)));
    const outros = outrosDaNet(eb, M, layer, net, selIds);
    /* 1-2. as arestas, partidas onde algo encosta no meio */
    const arestas = [];
    for (const t of trilhas) {
      const A = [t.x1, t.y1], B = [t.x2, t.y2];
      let ts = [];
      for (const ob of outros) ts = ts.concat(contatosNaAresta(M, ob, A, B, t.w));
      for (const u of trilhas) if (u !== t) ts = ts.concat(contatosNaAresta(M, { pontas: [[u.x1, u.y1], [u.x2, u.y2]], r: u.w / 2, seg: [[u.x1, u.y1], [u.x2, u.y2]] }, A, B, t.w));
      ts = [...new Set(ts.map(x => Math.round(x * 1e9) / 1e9))].sort((a, b) => a - b);
      const pts = [A].concat(ts.map(x => [A[0] + (B[0] - A[0]) * x, A[1] + (B[1] - A[1]) * x]), [B]);
      for (let i = 1; i < pts.length; i++) {
        if (Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) <= NO) continue;
        arestas.push({ t, A: pts[i - 1], B: pts[i], a: chave(pts[i - 1][0], pts[i - 1][1]), b: chave(pts[i][0], pts[i][1]), partida: pts.length > 2, cad: -1 });
      }
    }
    /* os nós: grau, larguras, fixos */
    const nos = new Map();
    const no = (kk, P) => { let n = nos.get(kk); if (!n) nos.set(kk, n = { P, ar: [], fixo: false }); return n; };
    arestas.forEach((e, i) => { no(e.a, e.A).ar.push(i); no(e.b, e.B).ar.push(i); });
    for (const n of nos.values()) {
      if (n.ar.length !== 2) n.fixo = true;
      else if (arestas[n.ar[0]].t.w !== arestas[n.ar[1]].t.w) n.fixo = true;
      else for (const ob of outros) if (tocaPonto(M, ob, n.P[0], n.P[1], arestas[n.ar[0]].t.w / 2)) { n.fixo = true; break; }
    }
    /* 3. as cadeias, de nó fixo a nó fixo */
    const cadeias = [];
    const anda = (k0, i0) => {
      const c = { nos: [k0], ar: [] };
      let kk = k0, i = i0;
      for (let guarda = arestas.length + 1; guarda-- > 0;) {
        const e = arestas[i];
        e.cad = cadeias.length;
        c.ar.push(i);
        kk = e.a === kk ? e.b : e.a;
        c.nos.push(kk);
        const n = nos.get(kk);
        if (n.fixo || kk === k0) break;
        i = n.ar[0] === i ? n.ar[1] : n.ar[0];
      }
      cadeias.push(c);
    };
    for (const [kk, n] of nos) if (n.fixo) for (const i of n.ar) if (arestas[i].cad < 0) anda(kk, i);
    /* laço sem nó fixo: um nó qualquer vira fixo */
    for (let i = 0; i < arestas.length; i++) if (arestas[i].cad < 0) { nos.get(arestas[i].a).fixo = true; anda(arestas[i].a, i); }

    /* 4. suaviza cada cadeia */
    const Lc = M.camada(cena, layer), N = M.idDaNet(cena, net, false);
    const padsNet = [];
    Lc.obst.forEach((ob, oi) => { if (ob.tipo === 'pad' && ob.netId === N && N > 0) padsNet.push(oi); });
    const res = { saem: new Set(), novas: [], cadeias: 0, suavizadas: 0, vAntes: 0, vDepois: 0, cAntes: 0, cDepois: 0 };
    const mudou = new Set();
    for (const c of cadeias) {
      res.cadeias++;
      const pts = c.nos.map(kk => nos.get(kk).P.slice());
      const w = arestas[c.ar[0]].t.w;
      const comp = P => { let s = 0; for (let i = 1; i < P.length; i++) s += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); return s; };
      res.vAntes += pts.length; res.cAntes += comp(pts);
      const igual = () => { res.vDepois += pts.length; res.cDepois += comp(pts); };
      if (pts.length < 3) { igual(); continue; }
      const R = M.regraBase(cena, Lc, N, null, w / 2, M.descMao('track', net, layer));
      R.m = 0;
      /* não piorar: a cadeia que já estava abaixo da folga de outra net fica */
      let conflito = false;
      for (let i = 1; i < pts.length && !conflito; i++) if (!M.segLivre(R, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1])) conflito = true;
      if (conflito) { pula('ja-em-conflito'); igual(); continue; }
      /* pad da mesma net que a cadeia não toca: obstáculo encostado */
      for (const oi of padsNet) {
        R.bloq[oi] = 1; R.lim[oi] = w / 2 + ENCOSTA; if (R.lim[oi] > R.T) R.T = R.lim[oi];
        for (let i = 1; i < pts.length; i++) if (!M.segLivre(R, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1])) { R.bloq[oi] = 0; break; }
      }
      let novo;
      if (modo === 'chanfro') novo = chanfra(R, M, pts, lim);
      else {
        const sv = M.suaviza(R, pts, true, '45', 'diag');
        novo = sv.chegou ? sv.pts : pts;
        novo = M.limpa(M.tiraDegraus(R, M.limpa(novo), '45', degrau));
      }
      novo = M.limpa(novo);
      /* conferido exato; as pontas são as da cadeia */
      let ok = novo.length >= 2 && Math.hypot(novo[0][0] - pts[0][0], novo[0][1] - pts[0][1]) < 1e-9 &&
               Math.hypot(novo[novo.length - 1][0] - pts[pts.length - 1][0], novo[novo.length - 1][1] - pts[pts.length - 1][1]) < 1e-9;
      for (let i = 1; ok && i < novo.length; i++) if (!M.segLivre(R, novo[i - 1][0], novo[i - 1][1], novo[i][0], novo[i][1])) ok = false;
      const mesmo = novo.length === M.limpa(pts).length && novo.every((p, i) => { const q = M.limpa(pts)[i]; return Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9; });
      if (!ok || mesmo) { if (!ok) pula('nao-cabe'); igual(); continue; }
      res.suavizadas++;
      res.vDepois += novo.length; res.cDepois += comp(novo);
      mudou.add(c);
      c.novo = novo;
      for (const i of c.ar) res.saem.add(arestas[i].t);
    }
    /* as trilhas que saem: os trechos novos das cadeias que mudaram, e os pedaços das que não mudaram */
    for (const c of cadeias) {
      if (mudou.has(c)) { for (let i = 1; i < c.novo.length; i++) res.novas.push({ layer, net, w: arestas[c.ar[0]].t.w, A: c.novo[i - 1], B: c.novo[i] }); continue; }
      for (const i of c.ar) { const e = arestas[i]; if (res.saem.has(e.t)) res.novas.push({ layer, net, w: e.t.w, A: e.A, B: e.B }); }
    }
    let pn = porNet.get(net);
    if (!pn) porNet.set(net, pn = { net, saem: new Set(), novas: [], cadeias: 0, suavizadas: 0, vAntes: 0, vDepois: 0, cAntes: 0, cDepois: 0 });
    for (const t of res.saem) pn.saem.add(t);
    pn.novas = pn.novas.concat(res.novas);
    for (const k2 of ['cadeias', 'suavizadas', 'vAntes', 'vDepois', 'cAntes', 'cDepois']) pn[k2] += res[k2];
  }

  /* 5. a conferência: ratsnest e pontas soltas por net, antes e depois */
  const DRC = mod('HubPcbDrc', './hub-pcbdrc.js');
  const aplica = lista => {
    const saem = new Set(), novas = [];
    for (const pn of lista) { for (const t of pn.saem) saem.add(t); for (const n of pn.novas) novas.push(n); }
    const tracks = (eb.tracks || []).filter(t => !saem.has(t)).concat(novas.map((n, i) => ({ id: 'suav-t' + (i + 1), layer: n.layer, x1: n.A[0], y1: n.A[1], x2: n.B[0], y2: n.B[1], w: n.w, net: n.net })));
    return Object.assign({}, eb, { tracks });
  };
  const faltam = e => { const m = new Map(); for (const n of NETS.naoRoteadas(e).nets) m.set(n.net, n.faltam); return m; };
  const soltas = e => {
    const m = new Map();
    if (!DRC) return m;
    const byId = new Map((e.tracks || []).concat(e.arcs || []).map(t => [String(t.id), t]));
    let d;
    try { d = DRC.rodar(e, o.regras || undefined, { modo: 'lote', tipos: ['NetAntennae'] }); } catch (x) { return m; }
    for (const v of d.violacoes || []) { const t = byId.get(String((v.ids || [])[0])); const n = t ? t.net : ''; m.set(n, (m.get(n) || 0) + 1); }
    return m;
  };
  let lista = [...porNet.values()].filter(pn => pn.saem.size);
  if (lista.length) {
    const f0 = faltam(eb), s0 = soltas(eb);
    for (let volta = 0; volta < 3 && lista.length; volta++) {
      const e1 = aplica(lista), f1 = faltam(e1), s1 = soltas(e1);
      const piores = lista.filter(pn => (f1.get(pn.net) || 0) > (f0.get(pn.net) || 0) || (s1.get(pn.net) || 0) > (s0.get(pn.net) || 0));
      if (!piores.length) break;
      for (const pn of piores) rel.revertidas.push(pn.net);
      lista = lista.filter(pn => !piores.includes(pn));
    }
  }
  const valem = new Set(lista.map(pn => pn.net));
  for (const pn of porNet.values()) {
    const vale = valem.has(pn.net);
    rel.cadeias += pn.cadeias;
    rel.suavizadas += vale ? pn.suavizadas : 0;
    rel.vertices.antes += pn.vAntes; rel.vertices.depois += vale ? pn.vDepois : pn.vAntes;
    rel.comprimento.antes += pn.cAntes; rel.comprimento.depois += vale ? pn.cDepois : pn.cAntes;
    rel.porNet.push({ net: pn.net, cadeias: pn.cadeias, suavizadas: vale ? pn.suavizadas : 0, revertida: rel.revertidas.includes(pn.net),
                      comprimento: { antes: r6(pn.cAntes), depois: r6(vale ? pn.cDepois : pn.cAntes) } });
  }
  rel.mantidas = rel.cadeias - rel.suavizadas;
  rel.comprimento.antes = r6(rel.comprimento.antes); rel.comprimento.depois = r6(rel.comprimento.depois);
  for (const pn of lista) {
    for (const t of pn.saem) rel.ops.push({ op: 'track_del', id: t.id, note });
    for (const n of pn.novas) rel.ops.push({ op: 'track_add', layer: n.layer, x1: r6(n.A[0]), y1: r6(n.A[1]), x2: r6(n.B[0]), y2: r6(n.B[1]), w: n.w, net: n.net, note });
  }
  rel.ms = Math.round(agora() - t0);
  return rel;
}

return { suaviza, NO, DEGRAU, CHANFRO };
});
