/* NexoEletric - hub-bancada.js — a BANCADA do simulador (1.102.0).
   Pedido do dono (2026-11-12): "uma visão que é bancada: tenha a PCB e um motor; todos esses assets criados pelo
   NexoCAD e salvos na biblioteca; na bancada eu posso colocar qualquer coisa que eu quiser e fazer a ligação dos fios
   da placa selecionando o pino e a ligação do motor, pra simular como se funcionasse de verdade; vou salvar esses itens
   na lib e pôr na bancada na hora que eu quiser".

   Mora na vista PCB (pcbframe.html?modo=bancada, a aba Simulador › Bancada): o 3D da placa de verdade sobre uma MESA,
   os ITENS da biblioteca do Nexo Hub que têm `atributos.bancada` (o motor e a fonte do NexoCAD: o STEP, os terminais,
   o eixo e o elétrico) e os FIOS: clique num pad da placa (ou num terminal) e depois num terminal de item. O que fica
   ligado vira a mesma net da simulação do Esquema (hub-simulador.js » externosDaBancada): o motor gira na rotação que a
   simulação calcula (E = Ke·ω, inércia), a fonte alimenta a placa.
   Estado: window.top.__nexoBancada[projeto] = {itens:[{id, ref, item, nome, rev, bancada, pos:[x,y], rot}], fios:[{id,
   a, b}]} (a = {tipo:'pad', ref, pad} | {tipo:'item', item:<id na bancada>, terminal}), guardado no localStorage por
   projeto; cada mudança avisa a simulação (evento 'nexo-bancada' no topo).
   API: HubBancada.ativa(bool), HubBancada.consome(ev) (o clique que a bancada usou), HubBancada.mcp(args). */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.HubBancada) return;
  const $c = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const I = () => window.HubSimPcbInt || null;
  const Hh = () => window.__hubPcbSim || null;
  const fmt = (v, u) => window.HubSimCircuito ? window.HubSimCircuito.fmt(v, u) : (Math.round(v * 1000) / 1000) + ' ' + u;
  let topo = window;
  try { topo = window.top && window.top.document ? window.top : window; } catch (_e) { topo = window; }

  const st = { ativo: false, raiz: null, mesaZ: -11, objs: new Map(), fiosObj: null, ferramenta: 'mover', fioIni: null, lib: null, ui: null,
               arrasto: null, rotulos: new Map(), angulo: new Map(), bb: null };
  const proj = () => (Hh() && Hh().projeto()) || '';
  const CH = () => 'nexoBancada.' + proj();
  function estado() {
    topo.__nexoBancada = topo.__nexoBancada || {};
    let b = topo.__nexoBancada[proj()];
    if (!b) {
      try { b = JSON.parse(localStorage.getItem(CH()) || 'null'); } catch (_e) { b = null; }
      b = b && Array.isArray(b.itens) ? b : { itens: [], fios: [] };
      topo.__nexoBancada[proj()] = b;
    }
    return b;
  }
  function salva() {
    try { localStorage.setItem(CH(), JSON.stringify(estado())); } catch (_e) { /* sem storage */ }
    try { topo.dispatchEvent(new CustomEvent('nexo-bancada', { detail: { projeto: proj() } })); } catch (_e) { /* ok */ }
    pintaPainel();
  }

  /* ---------------------------------------------------------------- a biblioteca (os itens com atributos.bancada) */
  async function biblioteca(forca) {
    if (st.lib && !forca) return st.lib;
    try {
      const r = await fetch('/api/nexo/biblioteca?categoria=*', { cache: 'no-store' });
      const j = r.ok ? await r.json() : null;
      const itens = (j && (j.itens || j)) || [];
      st.lib = (Array.isArray(itens) ? itens : []).filter(it => it && it.bancada && typeof it.bancada === 'object');
    } catch (_e) { st.lib = []; }
    pintaPainel();
    return st.lib;
  }
  const urlStep = it => '/api/nexo/arquivo/' + encodeURIComponent(it.item) + '/modelo.step' + (it.rev != null ? '?rev=' + encodeURIComponent(it.rev) : '');
  const urlThumb = it => '/api/nexo/arquivo/' + encodeURIComponent(it.id) + '/thumb.png' + (it.thumb_v ? '?v=' + it.thumb_v : '');

  /* ---------------------------------------------------------------- a cena */
  function caixaDaPlaca() {
    const pl = Hh() && Hh().placa(); let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
    if (pl) {
      for (const t of pl.tracks || []) { x1 = Math.min(x1, t.x1, t.x2); x2 = Math.max(x2, t.x1, t.x2); y1 = Math.min(y1, t.y1, t.y2); y2 = Math.max(y2, t.y1, t.y2); }
      for (const c of pl.components || []) for (const p of c.pads || []) { x1 = Math.min(x1, p.x); x2 = Math.max(x2, p.x); y1 = Math.min(y1, p.y); y2 = Math.max(y2, p.y); }
    }
    if (x1 > x2) { x1 = -25; y1 = -25; x2 = 25; y2 = 25; }
    return { x1: x1 - 4, y1: y1 - 4, x2: x2 + 4, y2: y2 + 4 };
  }
  function V() { return Hh() && Hh().vista3d ? Hh().vista3d() : null; }
  function montaCena() {
    const v = V(); if (!v || !v.T) return false;
    const T = v.T();
    if (st.raiz) return true;
    const esp = v.espessura();
    st.mesaZ = -esp - 10;
    st.bb = caixaDaPlaca();
    const cx = (st.bb.x1 + st.bb.x2) / 2, cy = (st.bb.y1 + st.bb.y2) / 2;
    /* a mesa: grande (1,2 m no minimo, ou 12x a placa), para caber fonte, motor e o que mais for */
    const tam = Math.max(1200, 12 * Math.max(st.bb.x2 - st.bb.x1, st.bb.y2 - st.bb.y1));
    const raiz = new T.Group(); raiz.name = 'bancada';
    /* a mesa: um tampo escuro com a grade de 10 mm */
    const tampo = new T.Mesh(new T.BoxGeometry(tam, tam, 6), new T.MeshStandardMaterial({ color: 0x23272e, roughness: 0.85, metalness: 0.05 }));
    tampo.position.set(cx, cy, st.mesaZ - 3);
    raiz.add(tampo);
    const grade = new T.GridHelper(tam, Math.round(tam / 10), 0x3b4250, 0x2c313a);
    grade.rotation.x = Math.PI / 2; grade.position.set(cx, cy, st.mesaZ + 0.02);
    raiz.add(grade);
    /* os espaçadores: a placa fica 10 mm acima da mesa */
    const esp4 = [[st.bb.x1 + 3, st.bb.y1 + 3], [st.bb.x2 - 3, st.bb.y1 + 3], [st.bb.x1 + 3, st.bb.y2 - 3], [st.bb.x2 - 3, st.bb.y2 - 3]];
    for (const [x, y] of esp4) {
      const c = new T.Mesh(new T.CylinderGeometry(2.2, 2.2, 10 - 0.05, 6), new T.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.8, roughness: 0.35 }));
      c.rotation.x = Math.PI / 2; c.position.set(x, y, st.mesaZ + 5); raiz.add(c);
    }
    st.gItens = new T.Group(); st.gFios = new T.Group(); st.gMarcas = new T.Group();
    raiz.add(st.gItens, st.gFios, st.gMarcas);
    st.raiz = raiz;
    v.extra('bancada', raiz);
    v.materiais(tampo);
    return true;
  }
  async function poeItem(it) {
    const v = V(); if (!v) return;
    const T = v.T();
    let g = st.objs.get(it.id);
    if (!g) {
      g = new T.Group(); g.userData.itemId = it.id;
      st.gItens.add(g); st.objs.set(it.id, g);
      const corpo = new T.Group(); g.add(corpo);
      try { const m = await v.modeloStep(urlStep(it), 'nexo:' + it.item + '@' + (it.rev || 0)); corpo.add(m); }
      catch (e) {
        /* sem o STEP: uma caixa do tamanho do item, para a bancada continuar usavel */
        const caixa = new T.Mesh(new T.BoxGeometry(25, 20, 15), new T.MeshStandardMaterial({ color: 0x8b95a5 }));
        caixa.position.z = 7.5; corpo.add(caixa);
        console.warn('bancada: STEP de ' + it.nome + ':', e);
      }
      /* os terminais: bolinhas com a cor do terminal */
      for (const t of (it.bancada.terminais || [])) {
        const s = new T.Mesh(new T.SphereGeometry(1.4, 16, 12), new T.MeshBasicMaterial({ color: t.cor || (/^\+/.test(t.nome) ? 0xd32f2f : 0x222222) }));
        s.position.set(...(t.pos || [0, 0, 0])); s.userData.terminal = t.nome; g.add(s);
      }
      /* o motor: um indicador no eixo (duas pás laranja) que gira na rotação da simulação */
      if (it.bancada.tipo === 'motor_dc' && it.bancada.eixo) {
        const e = it.bancada.eixo, o = e.origem || [0, 0, 0], d = new T.Vector3(...(e.direcao || [0, 0, 1])).normalize();
        const rotor = new T.Group();
        const pa = new T.Mesh(new T.BoxGeometry(22, 3.2, 0.8), new T.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.5 }));
        const cubo = new T.Mesh(new T.CylinderGeometry(2.2, 2.2, 3, 16), new T.MeshStandardMaterial({ color: 0x334155 }));
        cubo.rotation.x = Math.PI / 2;
        rotor.add(pa, cubo);
        const eixoZ = new T.Vector3(0, 0, 1);
        rotor.quaternion.setFromUnitVectors(eixoZ, d);
        rotor.position.set(o[0] + d.x * 1.5, o[1] + d.y * 1.5, o[2] + d.z * 1.5);
        const giro = new T.Group(); giro.add(rotor);
        g.add(giro);
        g.userData.rotor = rotor; g.userData.eixo = d;
      }
      v.materiais(g);
    }
    g.position.set(it.pos[0], it.pos[1], st.mesaZ);
    g.rotation.z = (it.rot || 0) * Math.PI / 180;
    g.updateMatrixWorld(true);
  }
  function tiraItem(id) { const g = st.objs.get(id); if (g) { st.gItens.remove(g); st.objs.delete(id); } }
  function pontoDe(pt) {
    const v = V(); if (!v) return null;
    const T = v.T();
    if (pt.tipo === 'pad') {
      const pl = Hh().placa(); const c = pl && (pl.components || []).find(q => q.ref === pt.ref);
      const p = c && (c.pads || []).find(q => String(q.name) === String(pt.pad));
      if (!p) return null;
      return new T.Vector3(p.x, p.y, /bottom/i.test(p.layer) ? -v.espessura() - 0.3 : 0.6);
    }
    const g = st.objs.get(pt.item); if (!g) return null;
    const it = estado().itens.find(x => x.id === pt.item); if (!it) return null;
    const t = (it.bancada.terminais || []).find(q => q.nome === pt.terminal); if (!t) return null;
    g.updateMatrixWorld(true);
    return g.localToWorld(new T.Vector3(...(t.pos || [0, 0, 0])));
  }
  function corDoFio(f) {
    const nomes = [f.a, f.b].map(p => p.tipo === 'item' ? p.terminal : '');
    if (nomes.some(n => /^\+/.test(n))) return 0xd32f2f;
    if (nomes.some(n => /^-/.test(n))) return 0x1f2937;
    return 0xeab308;
  }
  function desenhaFios() {
    const v = V(); if (!v || !st.gFios) return;
    const T = v.T();
    for (const c of st.gFios.children.slice()) { st.gFios.remove(c); c.geometry && c.geometry.dispose(); }
    for (const f of estado().fios) {
      const a = pontoDe(f.a), b = pontoDe(f.b);
      if (!a || !b) continue;
      const dist = a.distanceTo(b);
      const subida = Math.min(18, 6 + dist * 0.12);
      const meio = new T.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, Math.max(st.mesaZ + 1.2, Math.min(a.z, b.z) - dist * 0.12));
      const curva = new T.CatmullRomCurve3([a, a.clone().add(new T.Vector3(0, 0, subida)), meio, b.clone().add(new T.Vector3(0, 0, subida)), b]);
      const sel = st.sel && st.sel.tipo === 'fio' && st.sel.id === f.id;
      const tubo = new T.Mesh(new T.TubeGeometry(curva, 64, sel ? 1.05 : 0.65, 8, false), new T.MeshStandardMaterial({ color: sel ? 0xfacc15 : corDoFio(f), roughness: 0.45, emissive: sel ? 0x6b4e00 : 0x000000 }));
      tubo.userData.fio = f.id;
      tubo.userData.pts = curva.getPoints(40);
      st.gFios.add(tubo);
    }
    v.pede();
  }
  async function refazTudo() {
    if (!montaCena()) return;
    const b = estado();
    const ids = new Set(b.itens.map(i => i.id));
    for (const id of [...st.objs.keys()]) if (!ids.has(id)) tiraItem(id);
    for (const it of b.itens) await poeItem(it);
    desenhaFios();
    pintaPainel();
  }

  /* ---------------------------------------------------------------- o motor girando e os rotulos */
  function anima(dt) {
    const v = V(); if (!v) return;
    const sim = I() && I().dados();
    for (const it of estado().itens) {
      const g = st.objs.get(it.id); if (!g) continue;
      const c = sim && sim.comps ? sim.comps[it.ref] : null;
      if (g.userData.rotor && c && isFinite(c.rpm)) {
        /* a rotacao aparente: ate 15 voltas por segundo (acima disso o olho so ve borrao) */
        const vis = Math.sign(c.rpm) * Math.min(Math.abs(c.rpm) / 60, 15);
        const a = (st.angulo.get(it.id) || 0) + vis * 2 * Math.PI * dt;
        st.angulo.set(it.id, a);
        g.userData.rotor.rotateOnAxis(new (v.T().Vector3)(0, 0, 1), vis * 2 * Math.PI * dt);
      }
      rotulo(it, g, c);
    }
    if (st.sel && st.barra && !st.arrasto) marcaBarra();
  }
  /* so reposiciona a barrinha (a camera girou) */
  function marcaBarra() {
    const v = V(); if (!v) return;
    let w = null;
    if (st.sel.tipo === 'item') { const g = st.objs.get(st.sel.id); if (!g) return; const box = new (v.T().Box3)().setFromObject(g); w = { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2, z: box.max.z + 6 }; }
    else { const t = st.gFios && st.gFios.children.find(c => c.userData.fio === st.sel.id); const p = t && t.userData.pts[Math.floor(t.userData.pts.length / 2)]; if (p) w = { x: p.x, y: p.y, z: p.z + 4 }; }
    if (!w) return;
    const q = v.projeta(w.x, w.y, w.z);
    st.barra.hidden = !!q.atras; st.barra.style.left = q.x + 'px'; st.barra.style.top = q.y + 'px';
  }
  function rotulo(it, g, c) {
    const v = V(), host = Hh().host3d(); if (!v || !host) return;
    let el = st.rotulos.get(it.id);
    if (!el) { el = $c('div', 'banc-rot'); host.append(el); st.rotulos.set(it.id, el); }
    el.hidden = !st.ativo;
    if (!st.ativo) return;
    const box = new (v.T().Box3)().setFromObject(g);
    const p = v.projeta((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, box.max.z + 4);
    el.style.display = p.atras ? 'none' : '';
    el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
    let t = '<b>' + (it.ref || '') + '</b> ' + (it.bancada.rotulo || it.nome);
    if (c) {
      if (it.bancada.tipo === 'motor_dc') t += '<small>' + Math.round(c.rpm || 0).toLocaleString('pt-BR') + ' rpm · ' + fmt(Math.abs(c.corrente || 0), 'A') + '</small>';
      else if (it.bancada.tipo === 'fonte') t += '<small>' + fmt(+(it.bancada.eletrico && it.bancada.eletrico.v) || 0, 'V') + (c.p ? ' · ' + fmt(Math.abs(c.p), 'W') : '') + '</small>';
    } else t += '<small>ligue os fios e a simulação</small>';
    el.innerHTML = t;
  }

  /* ---------------------------------------------------------------- mouse: mover, ligar fio */
  function terminalEm(ev) {
    const v = V(), host = Hh().host3d(); if (!v || !host) return null;
    const r = host.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
    let melhor = null, dm = 16;
    for (const it of estado().itens) for (const t of it.bancada.terminais || []) {
      const w = pontoDe({ tipo: 'item', item: it.id, terminal: t.nome }); if (!w) continue;
      const q = v.projeta(w.x, w.y, w.z); if (q.atras) continue;
      const d = Math.hypot(q.x - mx, q.y - my);
      if (d < dm) { dm = d; melhor = { tipo: 'item', item: it.id, terminal: t.nome }; }
    }
    return melhor;
  }
  function itemEm(ev) {
    const v = V(); if (!v) return null;
    const p = v.noPlano(ev, st.mesaZ); if (!p) return null;
    const T = v.T();
    for (const it of estado().itens) {
      const g = st.objs.get(it.id); if (!g) continue;
      const box = new T.Box3().setFromObject(g);
      if (p.x >= box.min.x - 2 && p.x <= box.max.x + 2 && p.y >= box.min.y - 2 && p.y <= box.max.y + 2) return { it, p };
    }
    return null;
  }
  function consome(ev) {
    if (!st.ativo || ev.button !== 0) return false;
    if (st.ferramenta === 'fio') {
      const alvo = terminalEm(ev) || (() => { const p = I() && I().padEm(ev); return p ? { tipo: 'pad', ref: p.ref, pad: p.nome } : null; })();
      if (!alvo) { if (st.fioIni) { st.fioIni = null; dica('Fio cancelado.'); } return true; }
      if (!st.fioIni) { st.fioIni = alvo; dica('Agora clique no outro ponta do fio (' + nomeDe(alvo) + ' → ?). Esc cancela.'); return true; }
      if (nomeDe(alvo) === nomeDe(st.fioIni)) return true;
      estado().fios.push({ id: 'f' + Date.now().toString(36), a: st.fioIni, b: alvo });
      dica('Fio ligado: ' + nomeDe(st.fioIni) + ' → ' + nomeDe(alvo));
      st.fioIni = null;
      salva(); desenhaFios();
      return true;
    }
    /* SELECIONAR (pedido do dono: "clicar em cima de algo na mesa e deletar ou mover"): o clique no item o seleciona
       (contorno amarelo e a barrinha Girar/Apagar em cima dele) e arrastar o move; o clique perto de um fio seleciona o
       fio; Delete apaga o selecionado, R gira, Esc solta. Clique no vazio solta a selecao. */
    const h = itemEm(ev);
    if (!h) {
      const fio = fioEm(ev);
      if (fio) { seleciona({ tipo: 'fio', id: fio }); return true; }
      if (st.sel) { seleciona(null); }
      return false;
    }
    seleciona({ tipo: 'item', id: h.it.id });
    const v = V();
    st.arrasto = { it: h.it, dx: h.it.pos[0] - h.p.x, dy: h.it.pos[1] - h.p.y, moveu: false };
    const mv = e => {
      const p = v.noPlano(e, st.mesaZ); if (!p || !st.arrasto) return;
      st.arrasto.moveu = true;
      st.arrasto.it.pos = [Math.round(p.x + st.arrasto.dx), Math.round(p.y + st.arrasto.dy)];
      const g = st.objs.get(st.arrasto.it.id); if (g) { g.position.set(st.arrasto.it.pos[0], st.arrasto.it.pos[1], st.mesaZ); g.updateMatrixWorld(true); }
      desenhaFios(); marcaSelecao();
    };
    const up = () => { window.removeEventListener('mousemove', mv, true); window.removeEventListener('mouseup', up, true); const m = st.arrasto && st.arrasto.moveu; st.arrasto = null; if (m) salva(); };
    window.addEventListener('mousemove', mv, true); window.addEventListener('mouseup', up, true);
    return true;
  }
  /* o fio sob o mouse: a distancia na tela ate a curva dele */
  function fioEm(ev) {
    const v = V(), host = Hh().host3d(); if (!v || !host || !st.gFios) return null;
    const r = host.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
    let melhor = null, dm = 9;
    for (const t of st.gFios.children) {
      const pts = t.userData.pts || [];
      let ant = null;
      for (const w of pts) {
        const q = v.projeta(w.x, w.y, w.z);
        if (!q.atras && ant) {
          const L2 = (q.x - ant.x) ** 2 + (q.y - ant.y) ** 2;
          const u = L2 ? Math.max(0, Math.min(1, ((mx - ant.x) * (q.x - ant.x) + (my - ant.y) * (q.y - ant.y)) / L2)) : 0;
          const d = Math.hypot(ant.x + u * (q.x - ant.x) - mx, ant.y + u * (q.y - ant.y) - my);
          if (d < dm) { dm = d; melhor = t.userData.fio; }
        }
        ant = q.atras ? null : q;
      }
    }
    return melhor;
  }
  function seleciona(sel) {
    const antes = st.sel;
    st.sel = sel;
    if ((antes && antes.tipo === 'fio') || (sel && sel.tipo === 'fio')) desenhaFios();
    marcaSelecao();
    if (sel && sel.tipo === 'item') { const it = estado().itens.find(i => i.id === sel.id); dica((it ? (it.ref || '') + ' ' + (it.bancada.rotulo || it.nome) : '') + ' selecionado: arraste para mover · R gira · Delete apaga · Esc solta'); }
    else if (sel && sel.tipo === 'fio') { const f = estado().fios.find(x => x.id === sel.id); dica('Fio ' + (f ? nomeDe(f.a) + ' → ' + nomeDe(f.b) : '') + ' selecionado: Delete apaga · Esc solta'); }
    else ferramenta(st.ferramenta);
    pintaPainel();
  }
  /* o contorno amarelo do item selecionado e a barrinha de acoes em cima dele */
  function marcaSelecao() {
    const v = V(); if (!v || !st.raiz) return;
    const T = v.T();
    if (st.caixaSel) { st.raiz.remove(st.caixaSel); st.caixaSel = null; }
    const host = Hh().host3d();
    if (!st.barra && host) {
      st.barra = $c('div', 'banc-acoes');
      const gi = $c('button', null, '⟳ Girar'); gi.title = 'Girar 90° (R)'; gi.onclick = () => girarSel();
      const ap = $c('button', 'perigo', '🗑 Apagar'); ap.title = 'Tirar da bancada (Delete)'; ap.onclick = () => apagarSel();
      st.barra.append(gi, ap);
      for (const e of ['mousedown', 'pointerdown', 'wheel', 'contextmenu', 'dblclick']) st.barra.addEventListener(e, x => x.stopPropagation(), { passive: e === 'wheel' });
      host.append(st.barra);
    }
    if (st.barra) st.barra.hidden = true;
    if (!st.sel) { v.pede(); return; }
    if (st.sel.tipo === 'item') {
      const g = st.objs.get(st.sel.id); if (!g) return;
      const box = new T.Box3().setFromObject(g);
      box.expandByScalar(1.5);
      st.caixaSel = new T.Box3Helper(box, 0xfacc15);
      st.raiz.add(st.caixaSel);
      if (st.barra) {
        const q = v.projeta((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, box.max.z + 6);
        st.barra.hidden = !!q.atras;
        st.barra.style.left = q.x + 'px'; st.barra.style.top = q.y + 'px';
        st.barra.querySelector('button').hidden = false;
      }
    } else if (st.barra) {
      /* o fio: a barrinha so com Apagar, no meio dele */
      const t = st.gFios.children.find(c => c.userData.fio === st.sel.id);
      const w = t && t.userData.pts[Math.floor(t.userData.pts.length / 2)];
      if (w) {
        const q = v.projeta(w.x, w.y, w.z + 4);
        st.barra.hidden = !!q.atras; st.barra.style.left = q.x + 'px'; st.barra.style.top = q.y + 'px';
        st.barra.querySelector('button').hidden = true;
      }
    }
    v.pede();
  }
  function girarSel() {
    if (!st.sel || st.sel.tipo !== 'item') return;
    const it = estado().itens.find(i => i.id === st.sel.id); if (!it) return;
    it.rot = ((it.rot || 0) + 90) % 360;
    poeItem(it).then(() => { desenhaFios(); marcaSelecao(); });
    salva();
  }
  function apagarSel() {
    if (!st.sel) return;
    if (st.sel.tipo === 'item') remover(st.sel.id);
    else { const b = estado(); b.fios = b.fios.filter(f => f.id !== st.sel.id); salva(); }
    st.sel = null; desenhaFios(); marcaSelecao(); ferramenta(st.ferramenta);
  }
  function nomeDe(pt) {
    if (pt.tipo === 'pad') return pt.ref + '·' + pt.pad;
    const it = estado().itens.find(x => x.id === pt.item);
    return (it ? it.ref || it.nome : '?') + ' ' + pt.terminal;
  }
  window.addEventListener('keydown', e => {
    if (!st.ativo) return;
    const t = e.target; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (e.key === 'Escape') { if (st.fioIni) { st.fioIni = null; dica('Fio cancelado.'); } else if (st.sel) seleciona(null); return; }
    if (!st.sel) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopImmediatePropagation(); apagarSel(); }
    else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); e.stopImmediatePropagation(); girarSel(); }
  }, true);

  /* ---------------------------------------------------------------- o painel */
  const CSS = `
.banc{position:absolute; top:12px; left:12px; z-index:6; width:290px; max-height:calc(100% - 24px); display:flex; flex-direction:column; overflow:hidden;
  background:rgba(12,15,20,.92); color:#e5e7eb; border:1px solid rgba(255,255,255,.12); border-radius:12px; box-shadow:0 12px 34px rgba(0,0,0,.45); font:12px system-ui, sans-serif}
.banc[hidden]{display:none}
.banc .hd{display:flex; align-items:center; gap:8px; padding:9px 11px; border-bottom:1px solid rgba(255,255,255,.08)} .banc .hd b{flex:1; font-size:13px}
.banc .fer{display:flex; gap:4px; padding:8px 10px 4px}
.banc button{height:26px; padding:0 9px; border-radius:7px; border:1px solid rgba(255,255,255,.16); background:rgba(255,255,255,.05); color:inherit; cursor:pointer; font:inherit}
.banc button.on{background:#f59e0b; color:#111; border-color:#f59e0b; font-weight:600}
.banc .dica{padding:4px 11px 8px; color:#9ca3af; min-height:16px}
.banc .sec{padding:6px 11px; border-top:1px solid rgba(255,255,255,.06); overflow:auto}
.banc h4{margin:0 0 6px; font-size:10.5px; letter-spacing:.08em; text-transform:uppercase; color:#9ca3af}
.banc .card{display:grid; grid-template-columns:44px 1fr auto; gap:8px; align-items:center; padding:5px; border-radius:8px; margin-bottom:4px; background:rgba(255,255,255,.03)}
.banc .card img{width:44px; height:44px; object-fit:contain; border-radius:6px; background:#0b0e14}
.banc .card small{display:block; color:#9ca3af}
.banc .lin{display:flex; align-items:center; gap:6px; padding:3px 0} .banc .lin span{flex:1}
.banc .vazio{color:#6b7280}
.banc-acoes{position:absolute; z-index:7; transform:translate(-50%,-100%); display:flex; gap:4px; padding:4px; border-radius:9px; background:rgba(12,15,20,.94);
  border:1px solid rgba(250,204,21,.6); box-shadow:0 8px 22px rgba(0,0,0,.45)}
.banc-acoes[hidden]{display:none}
.banc-acoes button{height:26px; padding:0 9px; border-radius:7px; border:1px solid rgba(255,255,255,.16); background:rgba(255,255,255,.06); color:#e5e7eb; cursor:pointer; font:12px system-ui, sans-serif}
.banc-acoes button.perigo{border-color:rgba(239,68,68,.6); color:#fecaca} .banc-acoes button:hover{background:rgba(255,255,255,.12)}
.banc-rot{position:absolute; z-index:5; pointer-events:none; transform:translate(-50%,-100%); padding:3px 8px; border-radius:7px; white-space:nowrap;
  background:rgba(10,12,16,.85); border:1px solid rgba(245,158,11,.6); color:#fde68a; font:600 11px system-ui, sans-serif}
.banc-rot small{display:block; font:500 10px ui-monospace, monospace; color:#e2e8f0}`;
  function painel() {
    if (st.ui) return st.ui;
    const host = Hh() && Hh().host3d(); if (!host) return null;
    if (!document.getElementById('banc-css')) { const s = document.createElement('style'); s.id = 'banc-css'; s.textContent = CSS; document.head.append(s); }
    const el = $c('div', 'banc');
    const hd = $c('div', 'hd'); hd.append($c('span', null, '🧪'), $c('b', null, 'Bancada'));
    const rec = $c('button', null, '⟳'); rec.title = 'Reler a biblioteca'; rec.onclick = () => biblioteca(true); hd.append(rec);
    const fer = $c('div', 'fer');
    const bMover = $c('button', null, '✥ Selecionar/mover'), bFio = $c('button', null, '〰 Fio');
    bMover.title = 'Clique num item ou fio para selecionar (Delete apaga, R gira); arraste o item para mover'; bFio.title = 'Clique num pad da placa (ou num terminal) e depois no terminal do item';
    bMover.onclick = () => ferramenta('mover'); bFio.onclick = () => ferramenta('fio');
    fer.append(bMover, bFio);
    const di = $c('div', 'dica', '');
    const sLib = $c('div', 'sec'), sIt = $c('div', 'sec'), sFi = $c('div', 'sec');
    el.append(hd, fer, di, sLib, sIt, sFi);
    for (const ev of ['mousedown', 'pointerdown', 'wheel', 'contextmenu', 'dblclick']) el.addEventListener(ev, e => e.stopPropagation(), { passive: ev === 'wheel' });
    host.append(el);
    st.ui = { el, bMover, bFio, di, sLib, sIt, sFi };
    return st.ui;
  }
  function dica(t) { const u = painel(); if (u) u.di.textContent = t; }
  function ferramenta(k) {
    st.ferramenta = k; st.fioIni = null;
    const u = painel(); if (!u) return;
    u.bMover.classList.toggle('on', k === 'mover'); u.bFio.classList.toggle('on', k === 'fio');
    dica(k === 'fio' ? 'Clique num pad da placa ou num terminal (bolinha) e depois na outra ponta.' : 'Clique num item ou fio da mesa para selecionar; arraste para mover. Shift + botão direito gira a vista.');
  }
  function pintaPainel() {
    const u = st.ui; if (!u) return;
    const b = estado();
    u.sLib.textContent = ''; u.sLib.append($c('h4', null, 'Biblioteca'));
    if (!st.lib) u.sLib.append($c('div', 'vazio', 'lendo a biblioteca do Nexo Hub…'));
    else if (!st.lib.length) u.sLib.append($c('div', 'vazio', 'Nenhum item de bancada na biblioteca (itens com atributos.bancada, criados no NexoCAD).'));
    for (const it of st.lib || []) {
      const c = $c('div', 'card');
      const img = $c('img'); img.src = urlThumb(it); img.alt = '';
      const t = $c('div'); t.append($c('b', null, it.bancada.rotulo || it.nome), $c('small', null, ({ motor_dc: 'motor DC', fonte: 'fonte', acessorio: 'acessório' })[it.bancada.tipo] || it.bancada.tipo));
      const bt = $c('button', null, '+ Pôr'); bt.title = 'Pôr na bancada'; bt.onclick = () => colocar(it);
      c.append(img, t, bt); u.sLib.append(c);
    }
    u.sIt.textContent = ''; u.sIt.append($c('h4', null, 'Na bancada'));
    if (!b.itens.length) u.sIt.append($c('div', 'vazio', 'Nada ainda: ponha um item da biblioteca.'));
    for (const it of b.itens) {
      const l = $c('div', 'lin'); const nm = $c('span', null, (it.ref ? it.ref + ' · ' : '') + (it.bancada.rotulo || it.nome));
      nm.style.cursor = 'pointer'; nm.title = 'selecionar na mesa'; nm.onclick = () => seleciona({ tipo: 'item', id: it.id });
      if (st.sel && st.sel.tipo === 'item' && st.sel.id === it.id) nm.style.color = '#facc15';
      l.append(nm);
      const gi = $c('button', null, '⟳'); gi.title = 'Girar 90°'; gi.onclick = () => { it.rot = ((it.rot || 0) + 90) % 360; poeItem(it).then(desenhaFios); salva(); };
      const x = $c('button', null, '×'); x.title = 'Tirar da bancada (e os fios dele)'; x.onclick = () => remover(it.id);
      l.append(gi, x); u.sIt.append(l);
    }
    u.sFi.textContent = ''; u.sFi.append($c('h4', null, 'Fios'));
    if (!b.fios.length) u.sFi.append($c('div', 'vazio', 'Nenhum fio. Use "Fio": clique no pad e no terminal.'));
    for (const f of b.fios) {
      const l = $c('div', 'lin'); const nf = $c('span', null, nomeDe(f.a) + ' → ' + nomeDe(f.b));
      nf.style.cursor = 'pointer'; nf.onclick = () => seleciona({ tipo: 'fio', id: f.id });
      if (st.sel && st.sel.tipo === 'fio' && st.sel.id === f.id) nf.style.color = '#facc15';
      l.append(nf);
      const x = $c('button', null, '×'); x.onclick = () => { b.fios = b.fios.filter(q => q !== f); salva(); desenhaFios(); };
      l.append(x); u.sFi.append(l);
    }
  }
  function proximaRef(tipo) {
    const pre = tipo === 'motor_dc' ? 'M' : tipo === 'fonte' ? 'PS' : 'X';
    const usados = new Set(estado().itens.map(i => i.ref));
    for (let n = 1; ; n++) if (!usados.has(pre + n)) return pre + n;
  }
  function colocar(libItem, pos) {
    const b = estado();
    const bb = st.bb || caixaDaPlaca();
    const n = b.itens.length;
    const it = { id: 'i' + Date.now().toString(36) + n, ref: proximaRef(libItem.bancada.tipo), item: libItem.id, nome: libItem.nome, rev: libItem.rev, bancada: libItem.bancada,
                 pos: pos || [Math.round(bb.x2 + 40 + (n % 3) * 45), Math.round((bb.y1 + bb.y2) / 2 + (Math.floor(n / 3) - 0.5) * 50)], rot: 0 };
    b.itens.push(it);
    salva();
    if (st.ativo) poeItem(it).then(() => { desenhaFios(); dica(it.ref + ' na bancada. Use "Fio" para ligar.'); });
    return it;
  }
  function remover(id) {
    if (st.sel && st.sel.id === id) st.sel = null;
    const b = estado();
    b.itens = b.itens.filter(i => i.id !== id);
    b.fios = b.fios.filter(f => !(f.a.tipo === 'item' && f.a.item === id) && !(f.b.tipo === 'item' && f.b.item === id));
    tiraItem(id); const r = st.rotulos.get(id); if (r) { r.remove(); st.rotulos.delete(id); }
    salva(); desenhaFios();
  }

  /* ---------------------------------------------------------------- ligar/desligar a bancada */
  async function ativa(on) {
    st.ativo = !!on;
    const u = painel(); if (u) u.el.hidden = !st.ativo;
    const v = V();
    if (!st.ativo) {
      if (v) { v.extra('bancada', null); v.animaExtra && v.animaExtra('bancada', null); }
      st.raiz = null; st.objs.clear();
      for (const r of st.rotulos.values()) r.remove(); st.rotulos.clear();
      return;
    }
    if (!v) { setTimeout(() => ativa(st.ativo), 500); return; }
    ferramenta(st.ferramenta);
    biblioteca();
    await refazTudo();
    if (v.animaExtra) v.animaExtra('bancada', anima);
    v.pose && v.pose('iso');
    try { topo.dispatchEvent(new CustomEvent('nexo-bancada', { detail: { projeto: proj() } })); } catch (_e) { /* ok */ }
  }

  /* ---------------------------------------------------------------- MCP (mcp/hub-mcpvista.js » 'simulador' na vista PCB) */
  async function mcp(a) {
    const b = estado();
    switch (a.acao) {
      case 'bancada_estado': return { ativa: st.ativo, itens: b.itens.map(i => ({ id: i.id, ref: i.ref, nome: i.nome, item: i.item, tipo: i.bancada.tipo, pos: i.pos, rot: i.rot, terminais: (i.bancada.terminais || []).map(t => t.nome) })), fios: b.fios.map(f => ({ id: f.id, de: nomeDe(f.a), para: nomeDe(f.b), a: f.a, b: f.b })) };
      case 'bancada_biblioteca': return { itens: (await biblioteca(true)).map(i => ({ id: i.id, nome: i.nome, rev: i.rev, bancada: i.bancada })) };
      case 'bancada_colocar': {
        const lib = await biblioteca();
        const l = lib.find(i => i.id === a.item || i.nome === a.item || (i.bancada.rotulo || '') === a.item) || (a.tipo && lib.find(i => i.bancada.tipo === a.tipo));
        if (!l) throw new Error('item de bancada não achado na biblioteca: ' + (a.item || a.tipo) + ' (bancada_biblioteca lista)');
        const it = colocar(l, Array.isArray(a.pos) ? a.pos : null);
        return { colocado: { id: it.id, ref: it.ref, nome: it.nome, terminais: (it.bancada.terminais || []).map(t => t.nome) } };
      }
      case 'bancada_fio': {
        /* de/para: "CN1-1" (pad da placa: REF-PAD) ou "M1:+" (item da bancada pelo ref : terminal) */
        const ponto = s => {
          s = String(s || '');
          const m = /^([^:]+):(.+)$/.exec(s);
          if (m) { const it = b.itens.find(i => i.ref === m[1] || i.id === m[1]); if (!it) throw new Error('item ' + m[1] + ' não está na bancada'); return { tipo: 'item', item: it.id, terminal: m[2] }; }
          const k = s.lastIndexOf('-'); if (k <= 0) throw new Error('ponto inválido: ' + s + ' (use REF-PAD ou ITEM:TERMINAL)');
          return { tipo: 'pad', ref: s.slice(0, k), pad: s.slice(k + 1) };
        };
        const f = { id: 'f' + Date.now().toString(36), a: ponto(a.de), b: ponto(a.para) };
        b.fios.push(f); salva(); if (st.ativo) desenhaFios();
        return { fio: { de: nomeDe(f.a), para: nomeDe(f.b) } };
      }
      case 'bancada_remover': { const it = b.itens.find(i => i.ref === a.item || i.id === a.item); if (it) remover(it.id); else if (a.fio) { b.fios = b.fios.filter(f => f.id !== a.fio); salva(); desenhaFios(); } return mcp({ acao: 'bancada_estado' }); }
      case 'bancada_mover': { const it = b.itens.find(i => i.ref === a.item || i.id === a.item); if (!it) throw new Error('item ' + a.item + ' não está na bancada'); if (Array.isArray(a.pos)) it.pos = a.pos.map(Math.round); if (a.rot != null) it.rot = ((+a.rot % 360) + 360) % 360; salva(); if (st.ativo) poeItem(it).then(desenhaFios); return { ref: it.ref, pos: it.pos, rot: it.rot }; }
      case 'bancada_limpar': for (const it of b.itens.slice()) remover(it.id); b.fios = []; salva(); return { limpa: true };
      case 'bancada_ativar': await ativa(a.ligado !== false); return { ativa: st.ativo };
    }
    throw new Error('ação da bancada desconhecida: ' + a.acao);
  }

  window.HubBancada = { ativa, consome, mcp, estado };
})();
