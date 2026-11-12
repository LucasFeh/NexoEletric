/* NexoEletric — AS PEÇAS VIVAS do Simulador (as peças do Wokwi, @wokwi/elements 1.9.2, MIT — vendor/wokwi).

   Pedido do dono (12/11/2026): "o simulador do Wokwi que tá no NexoCode eu quero que funcione no NexoEletric; no NexoCode
   só vai ter código; eu ligo ele a um projeto no NexoEletric e ele controla o microcontrolador do projeto no simulador do
   NexoEletric; toda a simulação fica lá; a interface de controle também fica no NexoCode, mas a simulação no Eletric".

   Como funciona:
   - O NexoCode (0.4.0+) roda o firmware e os modelos dos dispositivos (I2C do SSD1306, LCD HD44780, teclado, HC-SR04,
     DHT...) montados a partir do ESQUEMA deste projeto, e manda no gpio_lote o campo "pecas": {"<id>": {tipo, ref,
     attrs, pinos, ...propriedades}} — só o que mudou. O id é o DESIGNADOR do componente (U3, DS1...) ou "net:<NET>".
   - Aqui cada peça vira o elemento do Wokwi ao lado do componente: no Esquema do Simulador (ao lado do símbolo) e na
     PCB 2D/3D/Bancada (preso ao componente por uma linha). Peça sem componente vai para a doca "Peças do NexoCode".
   - O que a pessoa faz na peça (botão, teclado, potenciômetro, encoder, PIR) e os controles dos sensores (DHT, sonar,
     LDR, NTC, MPU6050) entram na fila "pecas_entrada", que volta na resposta do próximo gpio_lote; o NexoCode aplica.
   - Estado por projeto no topo da janela (as vistas Esquema e PCB veem o mesmo): window.top.__nexoPecas[projeto],
     window.top.__nexoPecasEntrada[projeto], evento "nexo-pecas".
   - Este arquivo não muda o hub-simulador.js: ele envolve o HubSimulador.mcp (gpio_lote, e as ações "pecas" e "peca"
     para a IA). */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.HubSimPecas) return;
  const qs = (() => { try { return new URLSearchParams(location.search); } catch (_e) { return new URLSearchParams(''); } })();
  const pag = (location.pathname.split('/').pop() || '').toLowerCase();
  const ehSch = pag.indexOf('schframe') === 0, ehPcb = pag.indexOf('pcbframe') === 0;
  const modo = qs.get('modo') || '';
  const naSim = (ehSch && modo === 'sim') || (ehPcb && /^(sim2d|sim3d|bancada)$/.test(modo));
  const PROJ = qs.get('p') || '';
  let topo = window;
  try { topo = window.top && window.top.document ? window.top : window; } catch (_e) { topo = window; }

  const estado = () => { const m = topo.__nexoPecas || (topo.__nexoPecas = {}); return m[PROJ] || (m[PROJ] = {}); };
  const fila = () => { const m = topo.__nexoPecasEntrada || (topo.__nexoPecasEntrada = {}); return m[PROJ] || (m[PROJ] = []); };
  function recebe(pecas) {
    const E = estado();
    for (const [id, it] of Object.entries(pecas || {})) {
      if (!it || typeof it !== 'object') continue;
      if (it.remover) { delete E[id]; continue; }
      E[id] = Object.assign(E[id] || {}, it, { _versao: (E[id] && E[id]._versao || 0) + 1 });
    }
    try { topo.dispatchEvent(new CustomEvent('nexo-pecas', { detail: { projeto: PROJ } })); } catch (_e) { /* ok */ }
  }
  function entrada(e) {
    const f = fila();
    f.push(e);
    if (f.length > 200) f.splice(0, f.length - 200);
  }

  /* ------------------------------------------------------------------ o gpio_lote (e a IA) */
  function envolve() {
    const H = window.HubSimulador;
    if (!H || typeof H.mcp !== 'function' || H.mcp.__pecas) return !!(H && H.mcp && H.mcp.__pecas);
    const orig = H.mcp;
    const novo = async function (a) {
      a = a || {};
      if (a.acao === 'pecas') {
        const E = estado();
        return { projeto: PROJ, pecas: Object.fromEntries(Object.entries(E).map(([id, it]) => { const { png, characters, _versao, ...r } = it; return [id, Object.assign(r, png ? { tela: 'imagem 128×64 (bancada_display no NexoCode lê o desenho)' } : {})]; })),
                 fila: fila().length, dica: 'as peças vivas chegam pelo gpio_lote do NexoCode (0.4.0+); "peca" manda uma entrada' };
      }
      if (a.acao === 'peca') {
        if (!a.id || !a.entrada || !a.entrada.acao) throw new Error('peca: {id, entrada:{acao:"apertar"|"soltar"|"attr"|"girar"|"movimento", valor?, attr?, linha?, coluna?}}');
        entrada(Object.assign({ id: String(a.id) }, a.entrada));
        return { na_fila: fila().length };
      }
      if (a.acao === 'gpio_lote' && a.pecas && typeof a.pecas === 'object') recebe(a.pecas);
      const r = await orig.call(this, a);
      /* a aba Simulador responde pelo Esquema (o pedido pode passar por duas vistas): a fila sai uma vez so */
      if (a.acao === 'gpio_lote' && r && typeof r === 'object' && !('pecas_entrada' in r)) r.pecas_entrada = fila().splice(0);
      return r;
    };
    novo.__pecas = true;
    H.mcp = novo;
    return true;
  }
  if (ehSch && !envolve()) { let n = 0; const t = setInterval(() => { if (envolve() || ++n > 50) clearInterval(t); }, 200); }

  window.HubSimPecas = { estado, fila, recebe, entrada };
  if (!naSim) return;

  /* ------------------------------------------------------------------ a tela: um cartão por peça */
  /* os controles dos sensores (não têm botão na própria peça) — os mesmos do NexoCode */
  const CONTROLES = {
    dht22: [['temperature', 'Temperatura (°C)', -40, 80, 0.1], ['humidity', 'Umidade (%)', 0, 100, 0.5]],
    'hc-sr04': [['distance', 'Distância (cm)', 2, 400, 1]],
    'photoresistor-sensor': [['lux', 'Luz (lux)', 0.1, 100000, 1, true]],
    'ntc-temperature-sensor': [['temperature', 'Temperatura (°C)', -24, 80, 0.1]],
    mpu6050: [['accelX', 'Aceleração X (g)', -2, 2, 0.01], ['accelY', 'Aceleração Y (g)', -2, 2, 0.01], ['accelZ', 'Aceleração Z (g)', -2, 2, 0.01],
      ['rotationX', 'Giro X (°/s)', -250, 250, 1], ['rotationY', 'Giro Y (°/s)', -250, 250, 1], ['rotationZ', 'Giro Z (°/s)', -250, 250, 1]],
  };
  const NOMES = { ssd1306: 'OLED', lcd1602: 'LCD 16×2', lcd2004: 'LCD 20×4', servo: 'Servo', neopixel: 'NeoPixel', 'led-ring': 'Anel NeoPixel',
    '7segment': '7 segmentos', buzzer: 'Buzzer', led: 'LED', 'rgb-led': 'LED RGB', pushbutton: 'Botão', 'membrane-keypad': 'Teclado',
    potentiometer: 'Potenciômetro', 'slide-potentiometer': 'Potenciômetro', 'ky-040': 'Encoder', dht22: 'DHT22', 'hc-sr04': 'Sonar HC-SR04',
    'pir-motion-sensor': 'PIR', 'photoresistor-sensor': 'LDR', 'ntc-temperature-sensor': 'NTC', mpu6050: 'MPU6050', ds1307: 'RTC DS1307',
    'ks2e-m-dc5': 'Relé', 'analog-joystick': 'Joystick', 'slide-switch': 'Chave' };
  const MIN_KEY = 'nexoPecas.min';
  const minimizados = (() => { try { return new Set(JSON.parse(localStorage.getItem(MIN_KEY) || '[]')); } catch (_e) { return new Set(); } })();
  const gravaMin = () => { try { localStorage.setItem(MIN_KEY, JSON.stringify([...minimizados])); } catch (_e) { /* ok */ } };

  const CSS = `
.pecas-camada{position:fixed; inset:0; pointer-events:none; z-index:62}
.pecas-camada svg{position:absolute; inset:0; width:100%; height:100%; overflow:visible}
.peca-cartao{position:fixed; pointer-events:auto; background:rgba(12,15,20,.95); color:#e5e7eb; border:1px solid rgba(34,211,238,.55);
  border-radius:10px; box-shadow:0 10px 28px rgba(0,0,0,.5); font:11.5px system-ui, sans-serif; overflow:hidden}
.peca-cartao .hd{display:flex; align-items:center; gap:6px; padding:4px 8px; cursor:pointer; user-select:none; background:rgba(34,211,238,.08)}
.peca-cartao .hd b{color:#67e8f9} .peca-cartao .hd span{flex:1; color:#9ca3af; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.peca-cartao .bd{padding:6px 8px; display:flex; flex-direction:column; align-items:center; gap:4px}
.peca-cartao .el{zoom:.8} .peca-cartao.min .bd{display:none}
.peca-cartao .ctl{display:grid; grid-template-columns:auto 110px auto; gap:2px 6px; align-items:center; font-size:10.5px; color:#9ca3af; width:100%}
.peca-cartao .ctl input{width:110px} .peca-cartao .ctl b{color:#e5e7eb; font-weight:600; text-align:right; min-width:38px}
.peca-cartao .inf{color:#9ca3af; font:10.5px ui-monospace, monospace}
.peca-cartao.energizado{border-color:#f59e0b}
.pecas-doca{position:fixed; left:10px; bottom:10px; pointer-events:auto; display:flex; flex-direction:column-reverse; gap:6px; max-height:80vh; overflow:auto; z-index:63}
.pecas-doca .peca-cartao{position:static}
.pecas-doca .tit{font:11px system-ui; color:#67e8f9; padding:2px 4px}`;

  let carregou = null;
  function carregaWokwi() {
    if (carregou) return carregou;
    carregou = new Promise(ok => {
      if (window.customElements && customElements.get('wokwi-ssd1306')) return ok(true);
      const s = document.createElement('script'); s.src = 'vendor/wokwi/wokwi-elements.bundle.min.js';
      s.onload = () => ok(true); s.onerror = () => ok(false);
      document.head.append(s);
    });
    return carregou;
  }

  let camada = null, svg = null, doca = null, raf = 0;
  const cartoes = new Map();   // id -> {el, elem, tipo, versao, ctl}
  function base() {
    if (camada) return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
    camada = document.createElement('div'); camada.className = 'pecas-camada';
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); camada.append(svg);
    doca = document.createElement('div'); doca.className = 'pecas-doca'; doca.hidden = true;
    document.body.append(camada, doca);
  }

  function aplicarAttr(elem, k, v) {
    if (k === 'keys') { try { elem.keys = JSON.parse(v); } catch (_e) { /* ok */ } return; }
    const n = Number(v);
    try { elem[k] = v === 'true' ? true : v === 'false' ? false : v !== '' && Number.isFinite(n) && !/^0x/i.test(String(v)) && !['color', 'label', 'value', 'common', 'pins'].includes(k) ? n : v; } catch (_e) { /* ok */ }
    if (k === 'value' && Number.isFinite(n)) try { elem.value = n; } catch (_e) { /* ok */ }
  }
  function criaCartao(id, it) {
    base();
    const tipo = String(it.tipo || '').replace(/^wokwi-|^board-/, '');
    const el = document.createElement('div'); el.className = 'peca-cartao' + (minimizados.has(id) ? ' min' : '');
    const hd = document.createElement('div'); hd.className = 'hd';
    hd.innerHTML = '<b></b><span></span>';
    hd.querySelector('b').textContent = /^net:/.test(id) ? id.slice(4) : id;
    hd.querySelector('span').textContent = NOMES[tipo] || tipo;
    hd.title = 'Clique para recolher/abrir';
    hd.onclick = () => { el.classList.toggle('min'); if (el.classList.contains('min')) minimizados.add(id); else minimizados.delete(id); gravaMin(); };
    const bd = document.createElement('div'); bd.className = 'bd';
    const caixa = document.createElement('div'); caixa.className = 'el';
    let elem = null;
    try { elem = document.createElement('wokwi-' + tipo); } catch (_e) { elem = document.createElement('div'); }
    for (const [k, v] of Object.entries(it.attrs || {})) aplicarAttr(elem, k, v);
    caixa.append(elem);
    const inf = document.createElement('div'); inf.className = 'inf';
    bd.append(caixa, inf);
    /* os controles dos sensores */
    const ctl = CONTROLES[tipo];
    if (ctl) {
      const g = document.createElement('div'); g.className = 'ctl';
      for (const [attr, nome, mn, mx, passo, log] of ctl) {
        const atual = +((it.attrs || {})[attr] != null ? it.attrs[attr] : (elem[attr] != null ? elem[attr] : mn));
        const conv = log ? { ida: v => Math.log10(v), volta: p => Math.pow(10, p) } : { ida: v => v, volta: p => p };
        const r = document.createElement('input'); r.type = 'range';
        r.min = conv.ida(mn); r.max = conv.ida(mx); r.step = log ? 0.01 : passo; r.value = conv.ida(Math.min(mx, Math.max(mn, atual || mn)));
        const b = document.createElement('b'); b.textContent = fmtN(atual);
        let tm = 0;
        r.addEventListener('input', () => {
          const v = +conv.volta(+r.value).toFixed(log ? 1 : 2); b.textContent = fmtN(v);
          aplicarAttr(elem, attr, String(v));
          clearTimeout(tm); tm = setTimeout(() => entrada({ id, acao: 'attr', attr, valor: v }), 120);
        });
        const lb = document.createElement('span'); lb.textContent = nome;
        g.append(lb, r, b);
      }
      bd.append(g);
    }
    el.append(hd, bd);
    /* os eventos da peça (o mesmo contrato do bancada.interagir do NexoCode) */
    elem.addEventListener('button-press', e => entrada(tipo === 'membrane-keypad' ? { id, acao: 'apertar', linha: e.detail && e.detail.row, coluna: e.detail && e.detail.column } : { id, acao: 'apertar' }));
    elem.addEventListener('button-release', e => entrada(tipo === 'membrane-keypad' ? { id, acao: 'soltar', linha: e.detail && e.detail.row, coluna: e.detail && e.detail.column } : { id, acao: 'soltar' }));
    elem.addEventListener('rotate-cw', () => entrada({ id, acao: 'girar', valor: 1 }));
    elem.addEventListener('rotate-ccw', () => entrada({ id, acao: 'girar', valor: -1 }));
    elem.addEventListener('input', () => {
      if (tipo === 'analog-joystick') { entrada({ id, acao: 'attr', attr: 'xValue', valor: elem.xValue }); entrada({ id, acao: 'attr', attr: 'yValue', valor: elem.yValue }); return; }
      entrada({ id, acao: 'attr', attr: 'value', valor: elem.value });
    });
    if (tipo === 'pir-motion-sensor') elem.addEventListener('click', () => entrada({ id, acao: 'movimento' }));
    if (tipo === 'slide-switch') elem.addEventListener('input', () => entrada({ id, acao: 'attr', attr: 'value', valor: elem.value }));
    /* o cartão não deixa o clique/roda chegar na vista (a vista pan/zoom fica fora dele) */
    for (const ev of ['mousedown', 'pointerdown', 'wheel', 'contextmenu', 'dblclick', 'keydown']) el.addEventListener(ev, z => z.stopPropagation(), { passive: ev === 'wheel' });
    const c = { el, elem, tipo, versao: -1, inf, ref: !!it.ref };
    cartoes.set(id, c);
    return c;
  }
  const fmtN = v => { const n = +v; return !isFinite(n) ? '—' : Math.abs(n) >= 1000 ? n.toFixed(0) : n.toFixed(Math.abs(n) < 10 ? 2 : 1).replace('.', ','); };

  function aplicaEstado(c, it) {
    if (c.versao === it._versao) return;
    c.versao = it._versao;
    const elem = c.elem;
    try {
      switch (c.tipo) {
        case 'ssd1306': {
          if (it.png) {
            const im = new Image();
            im.onload = () => {
              const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64;
              const x = cv.getContext('2d'); x.drawImage(im, 0, 0, 128, 64);
              elem.imageData = x.getImageData(0, 0, 128, 64); if (elem.redraw) elem.redraw();
            };
            im.src = it.png;
          } else if (it.mem) {
            const mem = Uint8Array.from(atob(it.mem), ch => ch.charCodeAt(0)), img = new ImageData(128, 64);
            for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) {
              const on = it.ligado && (((mem[(y >> 3) * 128 + x] >> (y & 7)) & 1) ^ (it.inverso ? 1 : 0)), i = (y * 128 + x) * 4;
              img.data[i] = img.data[i + 1] = img.data[i + 2] = on ? 255 : 0; img.data[i + 3] = 255;
            }
            elem.imageData = img; if (elem.redraw) elem.redraw();
          }
          break;
        }
        case 'lcd1602': case 'lcd2004': {
          const cols = c.tipo === 'lcd2004' ? 20 : 16, rows = c.tipo === 'lcd2004' ? 4 : 2;
          if (it.characters) elem.characters = new Uint8Array(it.characters);
          else if (it.linhas) {
            const ch = new Uint8Array(cols * rows).fill(32);
            it.linhas.slice(0, rows).forEach((l, r) => { for (let i = 0; i < Math.min(cols, l.length); i++) ch[r * cols + i] = l.charCodeAt(i) & 255; });
            elem.characters = ch;
          }
          if (it.backlight != null) elem.backlight = !!it.backlight; else if (it.luz != null) elem.backlight = !!it.luz;
          for (const k of ['cursor', 'blink', 'cursorX', 'cursorY']) if (it[k] != null) elem[k] = it[k];
          break;
        }
        case 'led-ring': case 'neopixel-matrix':
          (it.cores || []).forEach((h, i) => elem.setPixel && elem.setPixel(i, { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 }));
          break;
        case 'ks2e-m-dc5': c.el.classList.toggle('energizado', !!it.energizado); break;
        case 'pushbutton': case 'pushbutton-6mm': if (!elem.matches(':active')) elem.pressed = !!it.pressed; break;
        default:
          for (const [k, v] of Object.entries(it)) if (!/^(tipo|ref|attrs|pinos|_versao|png|mem|linhas|luz|cores|freq|pulsoUs)$/.test(k) && k in elem) try { elem[k] = v; } catch (_e) { /* ok */ }
      }
    } catch (e) { console.warn('peça', c.tipo, e); }
    /* uma linha do que importa (ângulo, frequência, pinos) */
    const pin = it.pinos ? Object.entries(it.pinos).map(([k, v]) => k + '→' + (typeof v === 'number' ? 'GPIO' + v : v)).join(' ') : '';
    const ext = it.angle != null ? 'ângulo ' + Math.round(it.angle) + '°' + (it.pulsoUs ? ' (' + it.pulsoUs + ' µs)' : '') : it.freq ? fmtN(it.freq) + ' Hz' : it.energizado != null ? (it.energizado ? 'energizado' : 'desligado') : '';
    c.inf.textContent = [ext, pin].filter(Boolean).join(' · ');
  }

  /* onde fica o componente na tela (o ponto da linha) */
  function ancora(id) {
    if (/^net:/.test(id)) return null;
    if (ehSch) {
      const V = window.__hubSimVista; if (!V) return null;
      const sh = V.model().sheets[V.folha()]; const comp = sh && (sh.comps || []).find(k => k.ref === id);
      if (!comp) return { fora: true };
      const bb = V.caixa(comp), cv = V.canvas(); const cm = V.cam(), C = cm.cam || cm;
      if (!bb || !cv || !C || !C.scale) return null;
      const r = cv.getBoundingClientRect();
      const tela = (x, y) => ({ x: r.left + (x - C.cx) * C.scale + r.width / 2, y: r.top + r.height / 2 - (y - C.cy) * C.scale });
      const a = tela(bb.x2, Math.max(bb.y1, bb.y2)), b = tela(bb.x1, Math.min(bb.y1, bb.y2));
      return { x: a.x, y: (a.y + b.y) / 2, caixa: { x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y) } };
    }
    const H = window.__hubPcbSim; if (!H) return null;
    const pl = H.placa && H.placa(); const comp = pl && (pl.components || []).find(k => k.ref === id);
    if (!comp) return { fora: true };
    let cx = comp.x, cy = comp.y;
    if (!(isFinite(cx) && isFinite(cy)) && comp.pads && comp.pads.length) { cx = comp.pads.reduce((s, p) => s + p.x, 0) / comp.pads.length; cy = comp.pads.reduce((s, p) => s + p.y, 0) / comp.pads.length; }
    if (H.em3d && H.em3d()) {
      const V = H.vista3d(), host = H.host3d(); if (!V || !V.projeta || !host) return null;
      const r = host.getBoundingClientRect(), q = V.projeta(cx, cy, /bottom/i.test(comp.layer || '') ? -V.espessura() - 0.5 : 2);
      return q.atras ? { fora: true } : { x: r.left + q.x, y: r.top + q.y };
    }
    const cv = H.canvas && H.canvas(); if (!cv || !H.mundoParaTela) return null;
    const r = cv.getBoundingClientRect(), q = H.mundoParaTela(cx, cy);
    return { x: r.left + q.x, y: r.top + q.y };
  }

  function posiciona() {
    svg.textContent = '';
    const postos = [];
    let naDoca = 0;
    const NS = 'http://www.w3.org/2000/svg', mk = (t, at) => { const e = document.createElementNS(NS, t); for (const k in at) e.setAttribute(k, at[k]); return e; };
    for (const [id, c] of cartoes) {
      const a = ancora(id);
      if (!a || a.fora) {
        /* sem componente nesta vista (net:..., outra folha, atrás da placa): a doca */
        if (a && a.fora && c.ref) { c.el.style.display = 'none'; if (c.el.parentElement !== camada) camada.append(c.el); continue; }
        if (c.el.parentElement !== doca) doca.append(c.el);
        c.el.style.display = ''; naDoca++;
        continue;
      }
      if (c.el.parentElement !== camada) camada.append(c.el);
      c.el.style.display = '';
      const w = c.el.offsetWidth || 160, h = c.el.offsetHeight || 80;
      if (a.caixa) postos.push(a.caixa);
      let L = 0, T = 0;
      for (const d of [24, 60, 110, 170, 240]) {
        let achou = false;
        for (const [sx, sy] of [[1, 0], [1, -1], [-1, 0], [1, 1], [-1, -1], [-1, 1]]) {
          L = sx > 0 ? a.x + d : sx < 0 ? (a.caixa ? a.caixa.x1 : a.x) - d - w : a.x - w / 2;
          T = sy < 0 ? a.y - d - h : sy > 0 ? a.y + d : a.y - h / 2;
          L = Math.max(4, Math.min(L, window.innerWidth - w - 4)); T = Math.max(4, Math.min(T, window.innerHeight - h - 4));
          const r = { x1: L, y1: T, x2: L + w, y2: T + h };
          if (!postos.some(o => r.x1 < o.x2 + 6 && r.x2 > o.x1 - 6 && r.y1 < o.y2 + 6 && r.y2 > o.y1 - 6)) { achou = true; break; }
        }
        if (achou) break;
      }
      postos.push({ x1: L, y1: T, x2: L + w, y2: T + h });
      c.el.style.left = L + 'px'; c.el.style.top = T + 'px';
      const bx = Math.max(L, Math.min(a.x, L + w)), by = Math.max(T, Math.min(a.y, T + h));
      svg.append(mk('line', { x1: a.x, y1: a.y, x2: bx, y2: by, stroke: 'rgba(0,0,0,.85)', 'stroke-width': 4.5, 'stroke-linecap': 'round' }),
        mk('line', { x1: a.x, y1: a.y, x2: bx, y2: by, stroke: '#22d3ee', 'stroke-width': 1.8, 'stroke-linecap': 'round' }),
        mk('circle', { cx: a.x, cy: a.y, r: 4.5, fill: '#22d3ee', stroke: '#fff', 'stroke-width': 1.4 }));
    }
    if (doca) {
      doca.hidden = !naDoca;
      if (naDoca && !doca.querySelector('.tit')) { const t = document.createElement('div'); t.className = 'tit'; t.textContent = 'Peças do NexoCode'; doca.append(t); }
    }
  }
  function roda() {
    if (raf) return;
    const passo = () => { raf = 0; if (!cartoes.size) { if (svg) svg.textContent = ''; return; } posiciona(); raf = requestAnimationFrame(passo); };
    raf = requestAnimationFrame(passo);
  }
  async function atualiza() {
    const E = estado(), ids = Object.keys(E);
    if (!ids.length && !cartoes.size) return;
    await carregaWokwi();
    for (const [id, c] of cartoes) if (!(id in E)) { c.el.remove(); cartoes.delete(id); }
    for (const id of ids) { const it = E[id]; const c = cartoes.get(id) || criaCartao(id, it); aplicaEstado(c, it); }
    roda();
  }
  try { topo.addEventListener('nexo-pecas', e => { if (!e.detail || e.detail.projeto === PROJ) atualiza(); }); } catch (_e) { /* ok */ }
  setTimeout(atualiza, 600);
  Object.assign(window.HubSimPecas, { cartoes: () => [...cartoes.keys()], atualiza });
})();
