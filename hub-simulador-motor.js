/* NexoEletric - hub-simulador-motor.js — o MOTOR do simulador de circuito (1.101.0).
   Analise nodal modificada (MNA), como um SPICE pequeno: ponto de operacao DC (Newton-Raphson com amortecimento e,
   se nao convergir, rampa das fontes) e transiente (Euler implicito: capacitor e indutor viram condutancia + fonte de
   historia). Puro, sem DOM: roda na vista Esquema (hub-simulador.js), no 3D da PCB e no MCP (Node).

   O circuito e uma lista de ELEMENTOS ligados a NOS (nomes de net). O no "0" (ou o que a opcao `terra` disser) e a
   referencia. Tipos:
     {tipo:'R', nos:[a,b], r}                       resistor
     {tipo:'C', nos:[a,b], c}                       capacitor (aberto no DC)
     {tipo:'L', nos:[a,b], l}                       indutor (curto no DC)
     {tipo:'V', nos:[mais,menos], v | onda}         fonte de tensao ideal (corrente do ramo e incognita)
     {tipo:'I', nos:[de,para], i}                   fonte de corrente (sai do "de" pela fonte e entra no "para")
     {tipo:'SW', nos:[a,b], fechada, ron?, roff?}   chave
     {tipo:'NL', nos:[...], f(v, el, ctx) -> I[]}   elemento NAO linear qualquer: devolve a corrente que ENTRA no
                                                    elemento por cada terminal; a jacobiana sai por diferenca
                                                    finita. `dc` = grupos de terminais que conduzem em DC (para
                                                    achar no flutuante); `atualiza(v, el, ctx)` roda depois de cada
                                                    passo convergido (flip-flop do 555, rele, PWM) e devolve true se
                                                    o estado mudou (o passo e refeito)
   onda (fonte V/I): {forma:'dc'|'seno'|'quadrada'|'triangular', v (pico ou nivel), off (desvio), f (Hz), duty (0..1)}.

   API
     const s = HubSimMotor.cria(elementos, {terra:['GND'], dt:1e-4})
     s.dc()            -> resultado (ponto de operacao; reinicia o tempo)
     s.passo(n)        -> resultado (n passos de transiente de s.dt)
     s.resultado()     -> {t, ok, iter, v:{no: volts}, el:[{ref, i:[...], p}], flutuantes:[no], aviso}
     s.tensao(no)      s.correntes(el)
   Correntes: i[k] = corrente que ENTRA no elemento pelo terminal k (vinda do no). Potencia p = soma v[k]*i[k]
   (positiva = o elemento consome; fonte entregando energia da negativa). */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.HubSimMotor = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VT = 0.025852;             // tensao termica a 27 °C
  const GMIN = 1e-9;               // condutancia minima de cada no para a terra: 1 GΩ (no solto nao torna a matriz singular nem pede saltos de milhares de volts ao Newton)
  const MAX_ITER = 120;
  const DV_MAX = 2.0;              // passo maximo de tensao por iteracao de Newton (amortecimento)

  /* exponencial que nao estoura: depois de 90 continua em reta (o Newton volta sozinho). 90 e nao 40: o LED azul
     (Vf 3 V, n = 2) trabalha com V/(n·Vt) perto de 60 */
  function limexp(x) { return x < 90 ? Math.exp(x) : Math.exp(90) * (1 + x - 90); }

  function valorDaOnda(o, t) {
    if (o == null) return 0;
    if (typeof o === 'number') return o;
    const v = +o.v || 0, off = +o.off || 0, f = +o.f || 0;
    if (!f || o.forma === 'dc' || !o.forma) return v + off;
    const fase = ((t * f) % 1 + 1) % 1;
    if (o.forma === 'seno') return off + v * Math.sin(2 * Math.PI * fase);
    if (o.forma === 'quadrada') return off + (fase < (o.duty == null ? 0.5 : +o.duty) ? v : 0);
    if (o.forma === 'triangular') return off + v * (fase < 0.5 ? fase * 2 : 2 - fase * 2);
    return v + off;
  }
  /* o valor medio (o DC enxerga a media do PWM e da onda quadrada) */
  function mediaDaOnda(o) {
    if (o == null) return 0;
    if (typeof o === 'number') return o;
    const v = +o.v || 0, off = +o.off || 0;
    if (!o.forma || o.forma === 'dc' || !+o.f) return v + off;
    if (o.forma === 'quadrada') return off + v * (o.duty == null ? 0.5 : +o.duty);
    if (o.forma === 'triangular') return off + v / 2;
    return off;
  }

  /* ---------------------------------------------------------------- resolucao densa (Gauss com pivo parcial) */
  function resolve(A, b, n) {
    for (let k = 0; k < n; k++) {
      let p = k, m = Math.abs(A[k * n + k]);
      for (let i = k + 1; i < n; i++) { const a = Math.abs(A[i * n + k]); if (a > m) { m = a; p = i; } }
      if (m < 1e-300) return false;
      if (p !== k) {
        for (let j = k; j < n; j++) { const t = A[k * n + j]; A[k * n + j] = A[p * n + j]; A[p * n + j] = t; }
        const t = b[k]; b[k] = b[p]; b[p] = t;
      }
      const piv = A[k * n + k];
      for (let i = k + 1; i < n; i++) {
        const f = A[i * n + k] / piv;
        if (f === 0) continue;
        for (let j = k + 1; j < n; j++) A[i * n + j] -= f * A[k * n + j];
        b[i] -= f * b[k];
      }
    }
    for (let i = n - 1; i >= 0; i--) {
      let s = b[i];
      for (let j = i + 1; j < n; j++) s -= A[i * n + j] * b[j];
      b[i] = s / A[i * n + i];
    }
    return true;
  }

  function cria(elementos, opcoes) {
    const o = opcoes || {};
    const terra = new Set((o.terra || ['0', 'GND']).map(String));
    /* nos: 0 = terra */
    const idx = new Map(), nomes = ['0'];
    const no = nome => {
      nome = String(nome);
      if (terra.has(nome)) return 0;
      let i = idx.get(nome);
      if (i == null) { i = nomes.length; nomes.push(nome); idx.set(nome, i); }
      return i;
    };
    /* os PROPRIOS objetos (sem copia): o atualiza() de um elemento pode mexer noutro (a bobina do rele fecha o contato) */
    const els = (elementos || []).map((e, k) => Object.assign(e, { _k: k, _n: (e.nos || []).map(no), _ramo: -1, _h: 0, _hv: 0, _hvAntes: 0 }));
    let nRamos = 0;
    for (const e of els) if (e.tipo === 'V') e._ramo = nRamos++;
    const nNos = nomes.length - 1;
    const N = nNos + nRamos;
    const A = new Float64Array(N * N), b = new Float64Array(N);
    let x = new Float64Array(N);       // a solucao atual (tensoes dos nos 1..n, depois as correntes dos ramos)
    const s = { t: 0, dt: +o.dt > 0 ? +o.dt : 1e-4, modo: 'dc', escala: 1, iter: 0, ok: true, aviso: '' };

    const V = (x_, n) => n === 0 ? 0 : x_[n - 1];
    const vDe = (x_, e) => e._n.map(n => V(x_, n));

    /* ------------------------------------------------------------------ estampas */
    function g2(a, c, g) {           // condutancia g entre os nos a e c
      if (a) A[(a - 1) * N + a - 1] += g;
      if (c) A[(c - 1) * N + c - 1] += g;
      if (a && c) { A[(a - 1) * N + c - 1] -= g; A[(c - 1) * N + a - 1] -= g; }
    }
    function ii(a, c, i) {           // corrente i entrando no elemento por a e saindo por c (sai do no a)
      if (a) b[a - 1] -= i;
      if (c) b[c - 1] += i;
    }
    function fonte(e, t) {
      const onda = e.onda != null ? e.onda : e.v;
      const v = s.modo === 'dc' && !o.dcInstantaneo ? mediaDaOnda(onda) : valorDaOnda(onda, t);
      return v * s.escala;
    }
    function estampaLinear(e, t) {
      const [a, c] = e._n;
      switch (e.tipo) {
        case 'R': g2(a, c, 1 / Math.max(+e.r || 0, 1e-6)); break;
        case 'SW': g2(a, c, e.fechada ? 1 / (e.ron || 0.01) : 1 / (e.roff || 1e9)); break;
        case 'C':
          if (s.modo === 'dc') { g2(a, c, 1e-12); break; }
          { const g = (+e.c || 0) / s.dt; g2(a, c, g); ii(a, c, -g * e._hv); }
          break;
        case 'L':
          if (s.modo === 'dc') { g2(a, c, 1e3); break; }
          { const g = s.dt / Math.max(+e.l || 0, 1e-15); g2(a, c, g); ii(a, c, e._h); }
          break;
        case 'I': ii(a, c, s.modo === 'dc' ? mediaDaOnda(e.onda != null ? e.onda : e.i) * s.escala : valorDaOnda(e.onda != null ? e.onda : e.i, t) * s.escala); break;
        case 'V': {
          const r = nNos + e._ramo;
          if (a) { A[(a - 1) * N + r] += 1; A[r * N + a - 1] += 1; }
          if (c) { A[(c - 1) * N + r] -= 1; A[r * N + c - 1] -= 1; }
          if (e.rs) A[r * N + r] -= e.rs;
          b[r] += fonte(e, t);
          break;
        }
      }
    }
    const ctxNL = { t: 0, dt: 0, modo: 'dc', VT, limexp };
    function estampaNL(e, xa) {
      const v = vDe(xa, e), k = v.length;
      ctxNL.t = s.t; ctxNL.dt = s.dt; ctxNL.modo = s.modo; ctxNL.escala = s.escala;
      const I0 = e.f(v, e, ctxNL);
      e._ultI = I0;
      for (let j = 0; j < k; j++) {
        const nj = e._n[j];
        if (!nj) continue;
        const h = 1e-6 * Math.max(1, Math.abs(v[j]));
        const vv = v.slice(); vv[j] += h;
        const I1 = e.f(vv, e, ctxNL);
        for (let q = 0; q < k; q++) {
          const nq = e._n[q];
          if (!nq) continue;
          const G = (I1[q] - I0[q]) / h;
          if (G) A[(nq - 1) * N + nj - 1] += G;
          b[nq - 1] += G * v[j];
        }
      }
      for (let q = 0; q < k; q++) { const nq = e._n[q]; if (nq) b[nq - 1] -= I0[q]; }
    }

    function monta(xa) {
      A.fill(0); b.fill(0);
      for (let i = 0; i < nNos; i++) A[i * N + i] += GMIN;
      /* a continuacao pseudo-transiente (ptc): um "capacitor" de cada no para a terra segurando a tensao de referencia */
      if (s.gp) for (let i = 0; i < nNos; i++) { A[i * N + i] += s.gp; b[i] += s.gp * s.xref[i]; }
      for (const e of els) { if (e.tipo === 'NL') estampaNL(e, xa); else estampaLinear(e, s.t); }
    }

    /* o residuo do sistema nao linear no ponto xa: com A, b montados EM xa, r = A·xa − b (a linearizacao no proprio
       ponto da a corrente exata) */
    function residuo(xa) {
      let r = 0;
      for (let i = 0; i < N; i++) {
        let s_ = -b[i];
        const lin = i * N;
        for (let j = 0; j < N; j++) { const a = A[lin + j]; if (a) s_ += a * xa[j]; }
        r += s_ * s_;
      }
      return Math.sqrt(r);
    }
    /* Newton com amortecimento e BUSCA EM LINHA: o passo so e aceito se o residuo cair; senao vai pela metade (ate
       1/64). Sem isso, modelo com trecho plano (limite de corrente do regulador) fica pulando de um lado ao outro. */
    function newton(maxIter) {
      const MAXI = maxIter || MAX_ITER;
      let xa = x.slice();
      monta(xa);
      let r0 = residuo(xa);
      for (let it = 1; it <= MAXI; it++) {
        const sol = b.slice();
        const Ac = A.slice();
        if (!resolve(Ac, sol, N)) { s.aviso = 'matriz singular (fonte em curto ou laço só de fontes)'; return { ok: false, it }; }
        /* amortecimento GLOBAL (o vetor todo escalado: a direcao de Newton fica a mesma, e a busca em linha sempre acha
           descida). O no quase solto nao pede mais milhares de volts porque o GMIN e 1 nS */
        let maxDv = 0;
        for (let i = 0; i < nNos; i++) maxDv = Math.max(maxDv, Math.abs(sol[i] - xa[i]));
        const k = maxDv > DV_MAX ? DV_MAX / maxDv : 1;
        const d = new Float64Array(N);
        for (let i = 0; i < N; i++) d[i] = (sol[i] - xa[i]) * k;
        let conv = k === 1;
        for (let i = 0; conv && i < N; i++) {
          const tol = i < nNos ? 1e-6 + 1e-4 * Math.abs(sol[i]) : 1e-9 + 1e-4 * Math.abs(sol[i]);
          if (Math.abs(d[i]) > tol) conv = false;
        }
        let lam = 1, xt = null, r1 = Infinity;
        for (let tentativa = 0; tentativa < 24; tentativa++) {
          xt = new Float64Array(N);
          for (let i = 0; i < N; i++) xt[i] = xa[i] + d[i] * lam;
          monta(xt);
          r1 = residuo(xt);
          if (!isFinite(r1)) { lam /= 2; continue; }
          if (r1 <= r0 * (1 - 1e-4 * lam) || r1 < 1e-9 || tentativa === 23) break;
          lam /= 2;
        }
        for (let i = 0; i < N; i++) if (!isFinite(xt[i])) { s.aviso = 'o cálculo divergiu'; return { ok: false, it }; }
        xa = xt; r0 = r1;
        if (conv) { x = xa; return { ok: true, it }; }
      }
      x = xa;
      return { ok: false, it: MAXI };
    }

    /* CONTINUACAO PSEUDO-TRANSIENTE: quando o Newton nao acha a solucao (o multivibrador virando: a realimentacao
       positiva faz a solucao antiga "acabar" e o circuito tem de saltar para o outro estado), cada no ganha um
       capacitor ficticio para a terra que segura a tensao anterior; ele vai diminuindo (de 100 S ate zero) e a
       solucao anda ate o outro lado, como as capacitancias parasitas fazem no circuito de verdade */
    function continuacao() {
      let gp = 10, r = { ok: false, it: 0 }, it = 0, voltas = 0;
      s.xref = x.slice();
      while (gp > 1e-7 && voltas++ < 200) {
        s.gp = gp;
        const xa = x.slice();
        r = newton(30); it += r.it;
        if (r.ok) { s.xref = x.slice(); gp /= 4; }
        else { x = xa; gp *= 8; if (gp > 1e4) break; }
      }
      s.gp = 0;
      r = newton(60); it += r.it;
      return { ok: r.ok, it };
    }
    function aceita() {
      for (const e of els) {
        if (e.tipo === 'C') {
          const v = vDe(x, e), vc = v[0] - v[1];
          e._i = s.modo === 'dc' ? 0 : (+e.c || 0) / s.dt * (vc - e._hv);   // a corrente do passo (o dt pode ter sido partido)
          e._hvAntes = e._hv; e._hv = vc;
        }
        else if (e.tipo === 'L') {
          const v = vDe(x, e);
          if (s.modo === 'dc') e._h = (v[0] - v[1]) * 1e3; else e._h = e._h + (s.dt / Math.max(+e.l || 0, 1e-15)) * (v[0] - v[1]);
        }
      }
    }
    function atualizaEstados() {
      let mudou = false;
      for (const e of els) if (typeof e.atualiza === 'function') {
        ctxNL.t = s.t; ctxNL.dt = s.dt; ctxNL.modo = s.modo;
        if (e.atualiza(vDe(x, e), e, ctxNL)) mudou = true;
      }
      return mudou;
    }

    function dc() {
      s.modo = 'dc'; s.t = 0; s.aviso = ''; s.escala = 1;
      for (const e of els) { e._h = 0; e._hv = 0; if (typeof e.reinicia === 'function') e.reinicia(e); }
      x = new Float64Array(N);
      let r = newton();
      if (!r.ok) { x = new Float64Array(N); r = continuacao(); }
      if (!r.ok) {
        /* rampa das fontes: de 10 % em 10 % ate 100 %, cada passo partindo do anterior */
        x = new Float64Array(N);
        let tot = 0;
        for (let k = 1; k <= 10; k++) { s.escala = k / 10; r = newton(); tot += r.it; if (!r.ok && k === 10) break; }
        s.escala = 1;
        r.it = tot;
        if (!r.ok && !s.aviso) s.aviso = 'o ponto de operação não convergiu (resultado aproximado)';
      }
      for (let k = 0; k < 4 && atualizaEstados(); k++) r = newton();
      s.ok = r.ok; s.iter = r.it;
      aceita();
      return resultado();
    }
    /* LIGAR (o tempo real, como no Falstad): tudo descarregado em t = 0 — o capacitor parte de 0 V e carrega, o 555
       parte com a saida alta; o proximo passo() ja e o primeiro instante depois de ligar */
    function liga() {
      s.modo = 'tran'; s.t = 0; s.aviso = ''; s.escala = 1;
      /* um desvio de microvolts nos capacitores: o circuito simetrico (multivibrador) precisa de uma assimetria para
         comecar a oscilar, como a tolerancia das pecas faz no de verdade */
      for (const e of els) { e._h = 0; e._hv = e.tipo === 'C' ? (Math.random() - 0.5) * 2e-3 : 0; e._hvAntes = e._hv; if (typeof e.reinicia === 'function') e.reinicia(e); }
      x = new Float64Array(N);
      return resultado();
    }
    /* UM passo de transiente; se o Newton nao converge (a chave virando: o transistor que desliga, o diodo que entra),
       volta e refaz em 4 passos menores, ate 6 niveis (dt/4096), como o SPICE corta o passo de tempo */
    function subpasso(dt, nivel) {
      const x0 = x.slice(), t0 = s.t, dtOrig = s.dt;
      s.dt = dt; s.t = t0 + dt;
      let r = newton(40);
      if (!r.ok) { x = x0.slice(); r = continuacao(); }
      if (r.ok && atualizaEstados()) { r = newton(40); if (!r.ok) r = continuacao(); }
      if (!r.ok && nivel < 3) {
        x = x0; s.t = t0; s.dt = dtOrig;
        let it = r.it;
        for (let k = 0; k < 4; k++) { r = subpasso(dt / 4, nivel + 1); it += r.it; }
        return { ok: r.ok, it };
      }
      aceita();
      s.dt = dtOrig;
      return r;
    }
    function passo(n) {
      s.modo = 'tran';
      let r = { ok: true, it: 0 };
      for (let k = 0; k < (n || 1); k++) {
        r = subpasso(s.dt, 0);
        if (!r.ok) { s.aviso = s.aviso || 'um passo do transiente não convergiu'; }
      }
      s.ok = r.ok; s.iter = r.it;
      return resultado();
    }

    /* corrente de cada terminal (entrando no elemento) */
    function correntes(e) {
      const v = vDe(x, e);
      const [va, vc] = v;
      switch (e.tipo) {
        case 'R': { const i = (va - vc) / Math.max(+e.r || 0, 1e-6); return [i, -i]; }
        case 'SW': { const i = (va - vc) * (e.fechada ? 1 / (e.ron || 0.01) : 1 / (e.roff || 1e9)); return [i, -i]; }
        case 'C': { if (s.modo === 'dc') return [0, 0]; const i = e._i || 0; return [i, -i]; }
        case 'L': { const i = e._h; return [i, -i]; }
        case 'I': { const i = s.modo === 'dc' ? mediaDaOnda(e.onda != null ? e.onda : e.i) : valorDaOnda(e.onda != null ? e.onda : e.i, s.t); return [i, -i]; }
        case 'V': { const i = x[nNos + e._ramo]; return [i, -i]; }
        case 'NL': { ctxNL.t = s.t; ctxNL.modo = s.modo; return e.f(v, e, ctxNL).slice(); }
      }
      return v.map(() => 0);
    }

    /* nos flutuantes: sem caminho DC ate a terra (so capacitor, entrada de alta impedancia) */
    function flutuantes() {
      const pai = nomes.map((_, i) => i);
      const acha = i => { while (pai[i] !== i) { pai[i] = pai[pai[i]]; i = pai[i]; } return i; };
      const une = (a, c) => { a = acha(a); c = acha(c); if (a !== c) pai[c] = a; };
      for (const e of els) {
        if (e.tipo === 'C' || e.tipo === 'I' || (e.tipo === 'SW' && !e.fechada)) continue;
        const grupos = e.tipo === 'NL' ? (e.dc || [e._n.map((_, k) => k)]) : [e._n.map((_, k) => k)];
        for (const g of grupos) for (let k = 1; k < g.length; k++) une(e._n[g[0]], e._n[g[k]]);
      }
      const t0 = acha(0);
      return nomes.filter((_, i) => i > 0 && acha(i) !== t0);
    }

    function resultado() {
      const v = {};
      for (let i = 1; i < nomes.length; i++) v[nomes[i]] = x[i - 1];
      for (const t of terra) v[t] = 0;
      const el = els.map(e => {
        const i = correntes(e), vv = vDe(x, e);
        let p = 0;
        for (let k = 0; k < i.length; k++) p += vv[k] * i[k];
        return { ref: e.ref, tipo: e.tipo, papel: e.papel, i, v: vv, p };
      });
      return { t: s.t, modo: s.modo, ok: s.ok, iter: s.iter, aviso: s.aviso, v, el, flutuantes: flutuantes() };
    }
    s.dc = dc;
    s.liga = liga;
    s.passo = passo;
    s.resultado = resultado;
    s.tensao = n => { const i = n === 0 ? 0 : idx.get(String(n)); return terra.has(String(n)) ? 0 : i == null ? NaN : x[i - 1]; };
    s.elementos = els;
    s.nos = () => nomes.slice(1);
    s.correntes = correntes;
    s.elemento = ref => els.find(e => e.ref === ref);
    /* muda um parametro (chave, posicao do potenciometro, valor de fonte) sem remontar o circuito */
    s.muda = (ref, campos) => { for (const e of els) if (e.ref === ref || e.id === ref) Object.assign(e, campos); };
    return s;
  }

  return { cria, valorDaOnda, mediaDaOnda, limexp, VT, resolve };
});
