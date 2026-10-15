/* AltiumPCBMirror - hub-pcb3d-vista.js
   A vista 3D do Altium (View » 3D Layout Mode, tecla 3) em WebGL: a placa de verdade (contorno,
   recortes e furos vazados, com a espessura), as duas faces pintadas pela propria vista 2D
   (mascara, cobre sob a mascara, metal onde a mascara abre, serigrafia) e os corpos 3D dos
   componentes -- STEP, extrudado, cilindro, esfera e a caixa de placeholder -- na conta do
   HubPcb3dModelo. A MESMA vista mostra um footprint sozinho no editor de footprint.

   Three.js (vendor/three, r186, MIT) entra por import() dinamico: as paginas do hub sao scripts
   classicos, e so quem abre a vista 3D paga os 2 MB.

   Navegacao no molde do Altium (3D):
     Shift + botao direito arrastando  gira (em torno do ponto da placa sob o cursor)
     botao do meio / esquerdo arrastando  gira tambem (o esquerdo sem nada para mover no 3D)
     botao direito arrastando          arrasta a vista (Ctrl + esquerdo tambem)
     roda                              aproxima e afasta no cursor
     clique                            escolhe o componente (aoClicar(ref))
   As poses de View » 3D View Control (0 topo, Ctrl+0 base, 8 isometrica, 9 gira 90, Ctrl+F vira)
   ficam em pose()/gira()/vira(); quem liga tecla a elas e a pagina.

   API
     HubPcb3dVista.cria(host, {aoClicar, aoMenu, fundo}) -> Promise<vista>
       vista.cena({lacos, recortes, furos:[{x,y,r}], esp, bbox, pintaFace(ctx, lado), corpos, realce})
       vista.corpos(lista)          troca so os corpos (o componente andou)
       vista.realca(refs)           acende os corpos destes refs
       vista.pose('topo'|'base'|'frente'|'tras'|'esq'|'dir'|'iso'|'isoVirada')
       vista.gira(graus) vista.inclina(graus) vista.vira() vista.enquadra()
       vista.redimensiona() vista.destroi() vista.estado() -> {steps, falhas, corpos}
     HubPcb3dVista.disponivel() -> bool (WebGL)

   MODOS DE VISTA (o seletor no canto da propria vista 3D; a escolha fica gravada na maquina):
     Padrao     o de sempre: cores chapadas, rapido
     Real View  o RealView do SolidWorks: materiais fisicos (PBR) calibrados nos .p2m do SolidWorks,
                reflexo do estudio (HDRI do Blender, CC0), sombras macias no piso, mascara com
                verniz, pads de estanho ou ouro, serigrafia fosca, cobre em relevo sob a mascara
     Render     o Render do Blender: o Real View parado acumula amostras (luz de area, ceu e
                antialias) ate a imagem limpa, com a curva AgX do Blender
   O modulo hub-pcb3d-real.js (ES) so e carregado quando um dos dois modos realistas e escolhido.
*/
(function (root) {
'use strict';

let BASE = '';
try { if (document.currentScript && document.currentScript.src) BASE = document.currentScript.src.replace(/[^/]*$/, ''); } catch (e) { /* sem DOM */ }

let T = null, tP = null;
function tres(){
  if (T) return Promise.resolve(T);
  if (!tP) tP = import(BASE + 'vendor/three/three.module.js').then(m => (T = m));
  return tP;
}
let R = null;
function real(){
  if (R) return Promise.resolve(R);
  return import(BASE + 'hub-pcb3d-real.js').then(m => { m.base(BASE); R = m; return m; });
}
const PREF = 'altiumhub.v3d';
function lePref(){ try { return JSON.parse(localStorage.getItem(PREF) || '{}') || {}; } catch (e) { return {}; } }
function gravaPref(p){ try { localStorage.setItem(PREF, JSON.stringify(p)); } catch (e) { /* sem storage */ } }
const CSS_MODO = `
.v3d-modo{position:absolute; bottom:10px; right:10px; z-index:3; flex-wrap:wrap-reverse; justify-content:flex-end; max-width:calc(100% - 20px); display:flex; align-items:center; gap:6px; font:12px var(--font, sans-serif);}
.v3d-modo .seg{display:inline-flex; border:1px solid var(--edge, #555); border-radius:6px; overflow:hidden; background:var(--surface-2, #2a2d33);}
.v3d-modo .seg button{border:0; background:transparent; color:var(--text-2, #ccc); padding:4px 10px; cursor:pointer; font:inherit;}
.v3d-modo .seg button.on{background:var(--hi, #e8a33d); color:var(--on-hi, #111);}
.v3d-modo select{height:24px; border:1px solid var(--edge, #555); border-radius:6px; background:var(--surface-2, #2a2d33); color:var(--text, #eee); font:inherit;}
.v3d-modo select[hidden]{display:none;}
.v3d-prog{font:11px var(--mono, monospace); color:#fff; text-shadow:0 1px 2px #000; pointer-events:none; padding:0 4px;}
.v3d-prog:empty{display:none;}
`;
let cssModo = false;
function disponivel(){
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); }
  catch (e) { return false; }
}

const COR = { borda:0xc9b98a, furo:0x1a1a1a, realce:0xffb300 };
const RAD = Math.PI / 180;
const isNum = v => typeof v === 'number' && isFinite(v);

/* area com sinal (anti-horario > 0) */
function area(p){ let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; }
function bbDe(lista){
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const pts of lista) for (const p of pts) { if (p[0] < x1) x1 = p[0]; if (p[1] < y1) y1 = p[1]; if (p[0] > x2) x2 = p[0]; if (p[1] > y2) y2 = p[1]; }
  return isFinite(x1) ? { x1, y1, x2, y2 } : null;
}
function caminho(Classe, pts, horario){
  let q = pts.slice();
  if (q.length > 2 && q[0][0] === q[q.length - 1][0] && q[0][1] === q[q.length - 1][1]) q.pop();
  if ((area(q) < 0) !== !!horario) q = q.slice().reverse();
  const P = new Classe();
  P.moveTo(q[0][0], q[0][1]);
  for (let i = 1; i < q.length; i++) P.lineTo(q[i][0], q[i][1]);
  P.closePath();
  return P;
}

async function cria(host, opcoes){
  const o = opcoes || {};
  await tres();
  const ren = new T.WebGLRenderer({ antialias:true, alpha:true, preserveDrawingBuffer:true });
  ren.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  ren.setClearColor(0x000000, 0);
  const cv = ren.domElement;
  cv.className = 'v3d-cv';
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;outline:none;';
  cv.tabIndex = 0;
  host.append(cv);
  host.style.background = o.fundo || 'linear-gradient(180deg,#4a5262 0%,#262a33 55%,#15171c 100%)';
  ren.shadowMap.type = T.PCFShadowMap;   /* r186: o PCFSoft saiu; o PCF com shadow.radius faz a borda macia */

  const cena = new T.Scene();
  const cam = new T.PerspectiveCamera(30, 1, 0.1, 20000);
  const hemi = new T.HemisphereLight(0xffffff, 0x3a3f4a, 1.6); cena.add(hemi);
  const sol = new T.DirectionalLight(0xffffff, 1.5); sol.position.set(0.6, -0.8, 1.6); cena.add(sol); cena.add(sol.target);
  const contra = new T.DirectionalLight(0xffffff, 0.7); contra.position.set(-0.7, 0.9, -1.4); cena.add(contra);
  /* so no Render: a luz de ceu sorteada a cada amostra (a oclusao ambiente) */
  const ceu = new T.DirectionalLight(0xffffff, 0); cena.add(ceu); cena.add(ceu.target);
  /* o piso de estudio que so recebe sombra (o "shadow floor" das cenas do SolidWorks) */
  const piso = new T.Mesh(new T.PlaneGeometry(1, 1), new T.ShadowMaterial({ opacity:0.32 }));
  piso.receiveShadow = true; piso.visible = false; cena.add(piso);
  const fundoPadrao = o.fundo || 'linear-gradient(180deg,#4a5262 0%,#262a33 55%,#15171c 100%)';
  const pref = lePref();
  let modo = ['padrao', 'real', 'render'].indexOf(pref.modo) >= 0 ? pref.modo : 'padrao';
  let ambNome = pref.amb === 'interior' ? 'interior' : 'studio', acab = pref.acab === 'enig' ? 'enig' : 'hasl';
  let acum = null;
  const gPlaca = new T.Group(), gCorpos = new T.Group();
  cena.add(gPlaca); cena.add(gCorpos);

  /* a orbita: alvo, distancia, azimute (em torno de Z) e elevacao (-90 por baixo .. 90 de cima) */
  const orb = { alvo:new T.Vector3(), dist:200, az:0, el:Math.PI / 2 };
  let BB = { x1:-10, y1:-10, x2:10, y2:10 }, ESP = 1.6, realce = new Set();
  const est = { steps:0, falhas:[], corpos:0 };
  let vivo = true, agendado = 0;

  function posiciona(){
    const ce = Math.cos(orb.el), se = Math.sin(orb.el), ca = Math.cos(orb.az), sa = Math.sin(orb.az);
    const d = new T.Vector3(ce * sa, -ce * ca, se);           /* do alvo para a camera */
    const r = new T.Vector3(ca, sa, 0);                         /* a direita da tela, sempre na horizontal */
    cam.up.copy(new T.Vector3().crossVectors(d, r).normalize());
    cam.position.copy(orb.alvo).addScaledVector(d, orb.dist);
    cam.lookAt(orb.alvo);
    const tam = Math.max(BB.x2 - BB.x1, BB.y2 - BB.y1, 10);
    cam.near = Math.max(0.05, orb.dist / 500); cam.far = orb.dist + tam * 20;
    cam.updateProjectionMatrix();
  }
  function pede(){ if (!agendado && vivo) agendado = requestAnimationFrame(desenha); }
  function desenha(){
    agendado = 0; if (!vivo) return;
    posiciona();
    if (acum) acum.zera();
    ren.setRenderTarget(null);
    ren.render(cena, cam);
    if (modo === 'render') agendaRender(); else mostraProg('');
  }
  /* ---------- Render: as amostras com a camera parada ---------- */
  const AMOSTRAS = 128;
  let rTimer = 0, rLoop = 0, semente = 99991;
  const rnd = () => { semente = (semente * 16807) % 2147483647; return semente / 2147483647; };
  function agendaRender(){
    clearTimeout(rTimer); cancelAnimationFrame(rLoop);
    rTimer = setTimeout(() => { rLoop = requestAnimationFrame(passoRender); }, 250);
  }
  function passoRender(){
    if (!vivo || modo !== 'render' || agendado || !R) return;
    if (!acum) acum = new R.Acumulador(T, ren);
    const w = ren.domElement.width, h = ren.domElement.height;
    acum.tamanho(w, h);
    if (acum.n >= AMOSTRAS) { acum.exibe(); mostraProg('Render ' + AMOSTRAS + '/' + AMOSTRAS); return; }
    posiciona();
    cam.setViewOffset(w, h, rnd() - 0.5, rnd() - 0.5, w, h);
    const s0 = sol.position.clone(), cx = (BB.x1 + BB.x2) / 2, cy = (BB.y1 + BB.y2) / 2, tam = Math.max(BB.x2 - BB.x1, BB.y2 - BB.y1, 10);
    /* a luz principal: um ponto num disco de raio ~ 12% da distancia (luz de area do estudio) */
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * tam * 0.35;
    sol.position.set(s0.x + Math.cos(a) * r, s0.y + Math.sin(a) * r, s0.z);
    /* o ceu: um ponto do hemisferio de cima, com a densidade do coseno */
    const u = rnd(), v = rnd(), th = 2 * Math.PI * v, z = Math.sqrt(u);
    const rr = Math.sqrt(1 - u);
    ceu.position.set(cx + rr * Math.cos(th) * tam * 3, cy + rr * Math.sin(th) * tam * 3, Math.max(0.55, z) * tam * 3);   /* ceu abaixo de ~35 graus fazia rastro comprido no piso */
    ceu.target.position.set(cx, cy, -ESP / 2);
    acum.soma(cena, cam);
    sol.position.copy(s0);
    cam.clearViewOffset();
    acum.exibe();
    mostraProg('Render ' + acum.n + '/' + AMOSTRAS);
    rLoop = requestAnimationFrame(passoRender);
  }
  function redimensiona(){
    const w = host.clientWidth || 1, h = host.clientHeight || 1;
    ren.setSize(w, h, false);
    cam.aspect = w / h;
    pede();
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(redimensiona) : null;
  if (ro) ro.observe(host);

  /* a placa E os corpos: um componente alto numa placa pequena (o editor de footprint) nao fica cortado */
  let mexeu = false;
  function enquadra(){
    let x1 = BB.x1, y1 = BB.y1, x2 = BB.x2, y2 = BB.y2, z0 = -ESP, z1 = 0;
    gCorpos.updateMatrixWorld(true);
    const cb = new T.Box3().setFromObject(gCorpos);
    if (!cb.isEmpty()) {
      x1 = Math.min(x1, cb.min.x); y1 = Math.min(y1, cb.min.y); x2 = Math.max(x2, cb.max.x); y2 = Math.max(y2, cb.max.y);
      z0 = Math.min(z0, cb.min.z); z1 = Math.max(z1, cb.max.z);
    }
    const w = x2 - x1, h = y2 - y1;
    orb.alvo.set((x1 + x2) / 2, (y1 + y2) / 2, cb.isEmpty() ? -ESP / 2 : (z0 + z1) / 2);
    const fov = cam.fov * RAD, asp = cam.aspect || 1;
    const dV = (h / 2) / Math.tan(fov / 2), dH = (w / 2) / (Math.tan(fov / 2) * asp);
    let d = Math.max(dV, dH, 5) * 1.25 + ESP;
    if (orb.el < 80 * RAD && !cb.isEmpty()) {
      const r = Math.hypot(w, h, z1 - z0) / 2, fovMin = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * asp));
      d = Math.max(d, r / Math.sin(fovMin / 2) * 1.05);
    }
    orb.dist = d;
    mexeu = false;
    pede();
  }
  const POSES = {
    topo:[0, 90], base:[180, -90], frente:[0, 0], tras:[180, 0], esq:[-90, 0], dir:[90, 0],
    iso:[-35, 35], isoVirada:[145, -35],
  };
  function pose(nome){
    const p = POSES[nome] || POSES.topo;
    orb.az = p[0] * RAD; orb.el = p[1] * RAD;
    enquadra();
  }
  function gira(g){ orb.az += g * RAD; pede(); }
  function inclina(g){ orb.el = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, orb.el + g * RAD)); pede(); }
  /* Flip Board: a placa vista do outro lado, espelhada na horizontal como no 2D */
  function vira(){ orb.az = Math.PI - orb.az; orb.el = -orb.el; pede(); }
  /* o ponto da placa sob o pixel (no plano do meio da espessura); null de lado */
  const ray = new T.Raycaster();
  function ndc(ev){ const r = cv.getBoundingClientRect(); return new T.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); }
  function noPlano(ev){
    posiciona(); ray.setFromCamera(ndc(ev), cam);
    const hit = ray.intersectObjects([gCorpos, gPlaca], true)[0];
    if (hit) return hit.point.clone();
    const p = new T.Vector3();
    return ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 0, 1), ESP / 2), p) ? p : null;
  }

  /* ---------- mouse ---------- */
  let arr = null;
  cv.addEventListener('contextmenu', ev => ev.preventDefault());
  cv.addEventListener('pointerdown', ev => {
    cv.focus(); mexeu = true;
    const girar = ev.button === 1 || (ev.button === 2 && ev.shiftKey) || (ev.button === 0 && !ev.ctrlKey);
    arr = { x:ev.clientX, y:ev.clientY, b:ev.button, girar, andou:false, id:ev.pointerId };
    if (girar) {
      /* gira em torno da profundidade do ponto sob o cursor (a esfera do Altium): o alvo vai para o
         eixo da camera na distancia desse ponto, e a camera nao pula */
      const p = noPlano(ev);
      if (p) {
        const d = new T.Vector3().subVectors(cam.position, orb.alvo).normalize();
        const t = new T.Vector3().subVectors(cam.position, p).dot(d);
        if (t > 0.1) { orb.alvo.copy(cam.position).addScaledVector(d, -t); orb.dist = t; }
      }
    }
    try { cv.setPointerCapture(ev.pointerId); } catch (e) { /* ok */ }
    ev.preventDefault();
  });
  cv.addEventListener('pointermove', ev => {
    if (!arr) return;
    const dx = ev.clientX - arr.x, dy = ev.clientY - arr.y;
    if (!arr.andou && Math.hypot(dx, dy) < 3) return;
    arr.andou = true; arr.x = ev.clientX; arr.y = ev.clientY;
    if (arr.girar) { orb.az -= dx * 0.008; orb.el = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, orb.el + dy * 0.008)); }
    else {
      const h = cv.clientHeight || 1, k = 2 * orb.dist * Math.tan(cam.fov * RAD / 2) / h;
      const r = new T.Vector3(Math.cos(orb.az), Math.sin(orb.az), 0);
      orb.alvo.addScaledVector(r, -dx * k).addScaledVector(cam.up, dy * k);
    }
    pede();
  });
  const solta = ev => {
    if (!arr) return;
    const a = arr; arr = null;
    try { cv.releasePointerCapture(a.id); } catch (e) { /* ok */ }
    if (a.andou) return;
    if (a.b === 0 && o.aoClicar) o.aoClicar(refSob(ev), ev);
    if (a.b === 2 && !a.girar && o.aoMenu) o.aoMenu(refSob(ev), ev);
  };
  cv.addEventListener('pointerup', solta);
  cv.addEventListener('pointercancel', () => { arr = null; });
  cv.addEventListener('wheel', ev => {
    ev.preventDefault(); mexeu = true;
    const f = Math.pow(1.0018, ev.deltaY);
    const p = noPlano(ev);
    if (p && f < 1) orb.alvo.lerp(p, 1 - f);
    orb.dist = Math.max(0.5, Math.min(50000, orb.dist * f));
    pede();
  }, { passive:false });
  function refSob(ev){
    posiciona(); ray.setFromCamera(ndc(ev), cam);
    const hit = ray.intersectObjects([gCorpos], true)[0];
    let ob = hit && hit.object;
    while (ob && !(ob.userData && ob.userData.ref)) ob = ob.parent;
    return ob ? ob.userData.ref : null;
  }

  /* ---------- a placa ---------- */
  function limpa(g){
    for (const c of g.children.slice()) {
      g.remove(c);
      c.traverse(x => {
        if (x.geometry) x.geometry.dispose();
        const todos = [x.material, x.userData && x.userData.mPadrao, x.userData && x.userData.mReal];
        const ms = new Set();
        for (const q of todos) for (const m of (Array.isArray(q) ? q : (q ? [q] : []))) ms.add(m);
        for (const m of ms) for (const k of ['map', 'roughnessMap', 'metalnessMap', 'clearcoatMap', 'bumpMap']) if (m[k] && !(k === 'map' && m.userData && m.userData.mapaCompartilhado)) m[k].dispose();
        for (const m of ms) m.dispose();
      });
    }
  }
  function formaDaPlaca(c){
    const lacos = (c.lacos || []).filter(l => l && l.length >= 3);
    if (!lacos.length) return null;
    const ord = lacos.slice().sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
    const S = caminho(T.Shape, ord[0], false);
    for (const l of ord.slice(1)) S.holes.push(caminho(T.Path, l, true));
    for (const k of (c.recortes || [])) if (k && k.length >= 3) S.holes.push(caminho(T.Path, k, true));
    for (const f of (c.furos || [])) {
      if (!(f.r > 0.05)) continue;
      const H = new T.Path(); H.absarc(f.x, f.y, f.r, 0, Math.PI * 2, true); S.holes.push(H);
    }
    return { S, bb:bbDe(lacos) };
  }
  function texturaFace(c, lado, bb){
    if (typeof c.pintaFace !== 'function') return null;
    const W = bb.x2 - bb.x1, H = bb.y2 - bb.y1;
    const max = Math.min(ren.capabilities.maxTextureSize || 4096, 4096);
    const s = Math.max(4, Math.min(48, max / Math.max(W, H)));
    const tc = document.createElement('canvas');
    tc.width = Math.max(2, Math.ceil(W * s)); tc.height = Math.max(2, Math.ceil(H * s));
    const x = tc.getContext('2d');
    x.setTransform(s, 0, 0, -s, -bb.x1 * s, bb.y2 * s);
    try { c.pintaFace(x, lado, s); } catch (e) { console.warn('3D: face ' + lado, e); }
    const t = new T.CanvasTexture(tc);
    t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = Math.min(8, ren.capabilities.getMaxAnisotropy ? ren.capabilities.getMaxAnisotropy() : 1);
    t.repeat.set(1 / W, 1 / H); t.offset.set(-bb.x1 / W, -bb.y1 / H);
    return t;
  }
  function montaPlaca(c){
    limpa(gPlaca);
    ESP = isNum(c.esp) && c.esp > 0 ? c.esp : 1.6;
    const f = formaDaPlaca(c);
    if (!f) return;
    BB = c.bbox && isNum(c.bbox.x1) ? c.bbox : f.bb;
    const corpo = new T.Mesh(new T.ExtrudeGeometry(f.S, { depth:ESP, bevelEnabled:false, curveSegments:18 }),
      [new T.MeshStandardMaterial({ color:0x1d5e33, roughness:0.7 }), new T.MeshStandardMaterial({ color:COR.borda, roughness:0.85 })]);
    corpo.position.z = -ESP;
    corpo.userData.placa = true;
    gPlaca.add(corpo);
    for (const lado of ['top', 'bottom']) {
      const t = texturaFace(c, lado, f.bb);
      if (!t) continue;
      const m = new T.Mesh(new T.ShapeGeometry(f.S, 18),
        new T.MeshStandardMaterial({ map:t, roughness:0.55, metalness:0.05, side:lado === 'top' ? T.FrontSide : T.BackSide,
                                     polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:-1 }));
      m.position.z = lado === 'top' ? 0.002 : -ESP - 0.002;
      m.userData.face = { canvas:t.image, lado };
      gPlaca.add(m);
    }
  }

  /* ---------- os corpos ---------- */
  const matriz = a => new T.Matrix4().fromArray(a);
  function material(cor, opac, temCor){
    const m = new T.MeshStandardMaterial({ color:new T.Color(cor || '#808080'), roughness:0.55, metalness:0.1,
      transparent:opac < 1, opacity:isNum(opac) ? opac : 1, side:T.DoubleSide });
    m.userData.real = { cor:m.color.clone(), opac:isNum(opac) ? opac : 1, temCor:!!temCor };
    return m;
  }
  function malhaExtrudada(b){
    if (!b.pts || b.pts.length < 3) return null;
    const S = caminho(T.Shape, b.pts, false);
    for (const h of (b.holes || [])) if (h.length >= 3) S.holes.push(caminho(T.Path, h, true));
    const alt = Math.max(0.01, b.z1 - b.z0);
    const m = new T.Mesh(new T.ExtrudeGeometry(S, { depth:alt, bevelEnabled:false, curveSegments:12 }), material(b.color, b.opacity));
    m.position.z = b.z0;
    return m;
  }
  function comMatriz(geo, b){
    const m = new T.Mesh(geo, material(b.color, b.opacity));
    m.matrixAutoUpdate = false;
    m.matrix.copy(matriz(b.matrix));
    return m;
  }
  /* AS NORMAIS DO STEP, COM ANGULO DE VINCO (o "Auto Smooth" do Blender, 35 graus): os triangulos
     que dividem um vertice e cuja normal difere menos que o vinco tem a normal media -- a curva sai
     lisa, a quina continua viva. E as coordenadas de textura por projecao na caixa (o "Box" do
     Blender), em mm, para a micro-textura do plastico no Real View. Feito uma vez por malha do STEP
     (o mesmo modelo em 30 componentes nao recalcula). */
  const SUAVE = new WeakMap(), VINCO = Math.cos(35 * RAD);
  function suaviza(mm){
    let r = SUAVE.get(mm);
    if (r) return r;
    const P = mm.pos, I = mm.idx, nt = I.length / 3;
    const fn = new Float32Array(nt * 3);
    for (let t = 0; t < nt; t++) {
      const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      fn[t * 3] = nx / l; fn[t * 3 + 1] = ny / l; fn[t * 3 + 2] = nz / l;
    }
    const chave = i => Math.round(P[i * 3] * 2e3) + ',' + Math.round(P[i * 3 + 1] * 2e3) + ',' + Math.round(P[i * 3 + 2] * 2e3);
    const porPonto = new Map(), ck = new Array(nt * 3);
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
      const key = chave(I[t * 3 + k]); ck[t * 3 + k] = key;
      let l = porPonto.get(key); if (!l) { l = []; porPonto.set(key, l); } l.push(t);
    }
    const pos = new Float32Array(nt * 9), nor = new Float32Array(nt * 9), uv = new Float32Array(nt * 6);
    for (let t = 0; t < nt; t++) {
      const ax = Math.abs(fn[t * 3]), ay = Math.abs(fn[t * 3 + 1]), az = Math.abs(fn[t * 3 + 2]);
      for (let k = 0; k < 3; k++) {
        const v = I[t * 3 + k], o = (t * 3 + k) * 3;
        pos[o] = P[v * 3]; pos[o + 1] = P[v * 3 + 1]; pos[o + 2] = P[v * 3 + 2];
        let sx = 0, sy = 0, sz = 0;
        for (const s of porPonto.get(ck[t * 3 + k])) {
          const d = fn[s * 3] * fn[t * 3] + fn[s * 3 + 1] * fn[t * 3 + 1] + fn[s * 3 + 2] * fn[t * 3 + 2];
          if (d >= VINCO) { sx += fn[s * 3]; sy += fn[s * 3 + 1]; sz += fn[s * 3 + 2]; }
        }
        const l = Math.hypot(sx, sy, sz) || 1;
        nor[o] = sx / l; nor[o + 1] = sy / l; nor[o + 2] = sz / l;
        const u = (t * 3 + k) * 2;
        if (az >= ax && az >= ay) { uv[u] = pos[o] * 0.5; uv[u + 1] = pos[o + 1] * 0.5; }
        else if (ax >= ay) { uv[u] = pos[o + 1] * 0.5; uv[u + 1] = pos[o + 2] * 0.5; }
        else { uv[u] = pos[o] * 0.5; uv[u + 1] = pos[o + 2] * 0.5; }
      }
    }
    r = { pos, nor, uv };
    SUAVE.set(mm, r);
    return r;
  }
  function malhaDoStep(malhas, b){
    const g = new T.Group();
    g.matrixAutoUpdate = false;
    g.matrix.copy(matriz(b.matrix));
    for (const mm of malhas) {
      const geo = new T.BufferGeometry();
      const sv = suaviza(mm);
      geo.setAttribute('position', new T.BufferAttribute(sv.pos, 3));
      geo.setAttribute('normal', new T.BufferAttribute(sv.nor, 3));
      geo.setAttribute('uv', new T.BufferAttribute(sv.uv, 2));
      const base = mm.cor ? new T.Color(mm.cor[0], mm.cor[1], mm.cor[2]) : new T.Color(b.color || '#9a9a9a');
      const faces = (mm.faces || []).filter(f => f && f.cor);
      if (faces.length) {
        const mats = [material('#' + base.getHexString(), b.opacity, !!mm.cor)];
        const porCor = new Map();
        let ultimo = 0;
        const grupos = [];
        const fs = (mm.faces || []).slice().sort((a, c) => a.ini - c.ini);
        for (const f of fs) {
          if (f.ini > ultimo) grupos.push([ultimo, f.ini - ultimo, 0]);
          let mi = 0;
          if (f.cor) {
            const k = f.cor.map(v => Math.round(v * 255)).join(',');
            if (!porCor.has(k)) { porCor.set(k, mats.length); mats.push(material('#' + new T.Color(f.cor[0], f.cor[1], f.cor[2]).getHexString(), b.opacity, true)); }
            mi = porCor.get(k);
          }
          grupos.push([f.ini, f.fim - f.ini + 1, mi]);
          ultimo = f.fim + 1;
        }
        const nt = mm.idx.length / 3;
        if (ultimo < nt) grupos.push([ultimo, nt - ultimo, 0]);
        for (const [i, n, mi] of grupos) if (n > 0) geo.addGroup(i * 3, n * 3, mi);
        g.add(new T.Mesh(geo, mats));
      } else g.add(new T.Mesh(geo, material('#' + base.getHexString(), b.opacity, !!mm.cor)));
    }
    return g;
  }
  let geracao = 0;
  function poeCorpos(lista){
    const minha = ++geracao;
    limpa(gCorpos);
    est.corpos = 0; est.steps = 0; est.falhas = [];
    for (const b of (lista || [])) {
      if (!b) continue;
      let m = null;
      if (b.kind === 'extruded') m = malhaExtrudada(b);
      else if (b.kind === 'cylinder' && b.radius > 0) {
        const geo = new T.CylinderGeometry(b.radius, b.radius, Math.max(0.01, b.height || 1), 28);
        geo.rotateX(Math.PI / 2); geo.translate(0, 0, Math.max(0.01, b.height || 1) / 2);
        m = comMatriz(geo, b);
      } else if (b.kind === 'sphere' && b.radius > 0) m = comMatriz(new T.SphereGeometry(b.radius, 24, 16), b);
      else if (b.kind === 'step') {
        const g = new T.Group();
        g.userData.ref = b.owner || '';
        gCorpos.add(g);
        est.corpos++;
        if (!b.modelUrl) { est.falhas.push((b.owner || '?') + ': modelo sem arquivo'); continue; }
        if (typeof HubPcb3dStep === 'undefined') { est.falhas.push('leitor de STEP não carregado'); continue; }
        HubPcb3dStep.carrega(b.modelUrl, { chave:b.chave || b.model || b.modelUrl }).then(r => {
          if (minha !== geracao || !vivo) return;
          const mg = malhaDoStep(r.malhas, b);
          g.add(mg); est.steps++;
          materiaisDoModo(mg);
          if (realce.has(g.userData.ref)) acende(g, true);
          if (!mexeu) enquadra();   /* o modelo chegou e ninguem mexeu na camera: enquadra com ele */
          pede();
        }).catch(e => { est.falhas.push((b.owner || '?') + ': ' + (e && e.message || e)); });
        continue;
      }
      if (!m) continue;
      m.userData.ref = b.owner || '';
      gCorpos.add(m);
      est.corpos++;
    }
    materiaisDoModo(gCorpos);
    aplicaRealce();
    pede();
  }
  function acende(ob, on){
    ob.traverse(x => {
      const ms = Array.isArray(x.material) ? x.material : (x.material ? [x.material] : []);
      for (const m of ms) if (m.emissive) m.emissive.setHex(on ? 0x6b4a00 : 0x000000);
    });
  }
  function aplicaRealce(){ for (const c of gCorpos.children) acende(c, realce.has(c.userData.ref)); pede(); }

  /* ---------- os modos de vista ---------- */
  function materiaisDoModo(raiz){
    if (modo !== 'padrao' && !R) return;
    raiz.traverse(x => {
      if (!x.isMesh || x === piso) return;
      x.castShadow = true; x.receiveShadow = true;
      if (!x.userData.mPadrao) x.userData.mPadrao = x.material;
      if (modo === 'padrao') { x.material = x.userData.mPadrao; return; }
      if (!x.userData.mReal) x.userData.mReal = realDe(x);
      x.material = x.userData.mReal;
    });
  }
  function realDe(x){
    const mp = x.userData.mPadrao;
    if (x.userData.face) {
      const F = R.mapasDaFace(T, x.userData.face.canvas, acab);
      /* a face usa UV em mm (ShapeGeometry): a escala e o deslocamento sao os da textura original */
      for (const t of [F.map, F.orm, F.coat, F.bump]) { t.repeat.copy(mp.map.repeat); t.offset.copy(mp.map.offset); }
      return new T.MeshPhysicalMaterial({ map:F.map, roughnessMap:F.orm, metalnessMap:F.orm, roughness:1, metalness:1,
        clearcoat:1, clearcoatMap:F.coat, clearcoatRoughness:0.1, bumpMap:F.bump, bumpScale:0.35,
        side:mp.side, polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:-1 });
    }
    if (x.userData.placa) return [new T.MeshPhysicalMaterial({ color:0x0f4a26, roughness:0.4, clearcoat:1, clearcoatRoughness:0.1 }), R.bordaFR4(T)];
    const um = m => (m && m.userData && m.userData.real) ? R.material(T, m.userData.real.cor, m.userData.real.opac, m.userData.real.temCor) : m;
    return Array.isArray(mp) ? mp.map(um) : um(mp);
  }
  /* os mapas da face dependem do acabamento: trocar o acabamento refaz so a placa */
  function refazPlaca(){
    gPlaca.traverse(x => { if (x.isMesh && x.userData.face && x.userData.mReal) { const m = x.userData.mReal; for (const k of ['map', 'roughnessMap', 'clearcoatMap', 'bumpMap']) if (m[k]) m[k].dispose(); m.dispose(); x.userData.mReal = null; } });
    materiaisDoModo(gPlaca);
  }
  function ajustaLuzes(){
    const cx = (BB.x1 + BB.x2) / 2, cy = (BB.y1 + BB.y2) / 2, tam = Math.max(BB.x2 - BB.x1, BB.y2 - BB.y1, 10);
    for (const L of [sol, ceu]) {
      L.target.position.set(cx, cy, -ESP / 2);
      const c = L.shadow.camera, m = tam * 1.2;
      c.left = -m; c.right = m; c.top = m; c.bottom = -m; c.near = 0.1; c.far = tam * 8;
      c.updateProjectionMatrix();
      L.shadow.bias = -0.0004; L.shadow.normalBias = tam * 0.0004;
    }
    sol.position.set(cx + tam * 0.9, cy - tam * 1.2, tam * 2.4);
    sol.shadow.mapSize.set(2048, 2048); ceu.shadow.mapSize.set(1024, 1024);
    sol.shadow.radius = 4;
    piso.scale.set(tam * 12, tam * 12, 1); piso.position.set(cx, cy, -ESP - Math.max(0.05, tam * 0.004));
  }
  async function trocaModo(novo){
    if (['padrao', 'real', 'render'].indexOf(novo) < 0) return;
    modo = novo; gravaPref({ modo, amb:ambNome, acab });
    pintaSeletor();
    clearTimeout(rTimer); cancelAnimationFrame(rLoop);
    if (modo === 'padrao') {
      ren.toneMapping = T.NoToneMapping; ren.shadowMap.enabled = false; cena.environment = null;
      hemi.intensity = 1.6; sol.intensity = 1.5; contra.intensity = 0.7; ceu.intensity = 0; sol.castShadow = false; ceu.castShadow = false;
      piso.visible = false; host.style.background = fundoPadrao;
      materiaisDoModo(gPlaca); materiaisDoModo(gCorpos); mostraProg(''); pede();
      return;
    }
    mostraProg('preparando o ' + (modo === 'render' ? 'Render' : 'Real View') + '…');
    try { await real(); }
    catch (e) { mostraProg('Real View indisponivel: ' + (e && e.message || e)); return; }
    let env = null;
    try { env = await R.ambiente(T, ren, ambNome); } catch (e) { console.warn('3D: HDRI', e); }
    if (!vivo || modo === 'padrao') return;
    cena.environment = env;
    cena.environmentRotation.set(Math.PI / 2, 0, 0);     /* a placa e Z para cima; o HDRI do three, Y */
    cena.environmentIntensity = ambNome === 'interior' ? 0.9 : 1.05;
    ren.toneMapping = modo === 'render' ? T.AgXToneMapping : T.NeutralToneMapping;
    ren.toneMappingExposure = modo === 'render' ? 1.15 : 1.0;
    ren.shadowMap.enabled = true; ren.shadowMap.needsUpdate = true;
    hemi.intensity = env ? 0.15 : 0.9; contra.intensity = 0.25;
    sol.intensity = modo === 'render' ? 1.6 : 1.9; sol.castShadow = true;
    ceu.intensity = modo === 'render' ? 0.9 : 0; ceu.castShadow = modo === 'render';
    piso.visible = true;
    /* o fundo de estudio do SolidWorks ("Soft Neutral"): claro, sem competir com a peca */
    host.style.background = 'radial-gradient(ellipse at 50% 35%, #f4f5f7 0%, #d9dce1 55%, #b6bbc3 100%)';
    ajustaLuzes();
    /* a mudanca de tom/sombra exige recompilar os materiais que ja existem */
    cena.traverse(x => { const ms = x.material ? (Array.isArray(x.material) ? x.material : [x.material]) : []; for (const m of ms) m.needsUpdate = true; });
    materiaisDoModo(gPlaca); materiaisDoModo(gCorpos);
    aplicaRealce();
    if (acum) acum.zera();
    pede();
  }
  /* o seletor, no canto da propria vista */
  if (!cssModo) { cssModo = true; const st = document.createElement('style'); st.textContent = CSS_MODO; document.head.append(st); }
  const caixaModo = document.createElement('div'); caixaModo.className = 'v3d-modo';
  const seg = document.createElement('div'); seg.className = 'seg';
  const BOT = {};
  for (const [k, rot, dica] of [['padrao', 'Padrão', 'Cores chapadas, a vista rápida'],
                                ['real', 'Real View', 'Materiais físicos, reflexo de estúdio e sombra (o RealView do SolidWorks)'],
                                ['render', 'Render', 'Real View com amostras acumuladas até a imagem limpa (o Render do Blender)']]) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = rot; b.title = dica;
    b.addEventListener('click', ev => { ev.stopPropagation(); trocaModo(k); });
    BOT[k] = b; seg.append(b);
  }
  const selAmb = document.createElement('select'); selAmb.title = 'Ambiente (HDRI)';
  for (const [v, r] of [['studio', 'Estúdio'], ['interior', 'Interior']]) { const op = document.createElement('option'); op.value = v; op.textContent = r; selAmb.append(op); }
  selAmb.addEventListener('change', () => { ambNome = selAmb.value; trocaModo(modo); });
  const selAcab = document.createElement('select'); selAcab.title = 'Acabamento dos pads';
  for (const [v, r] of [['hasl', 'Estanho (HASL)'], ['enig', 'Ouro (ENIG)']]) { const op = document.createElement('option'); op.value = v; op.textContent = r; selAcab.append(op); }
  selAcab.addEventListener('change', () => { acab = selAcab.value; gravaPref({ modo, amb:ambNome, acab }); refazPlaca(); if (acum) acum.zera(); pede(); });
  for (const e of [caixaModo, selAmb, selAcab]) e.addEventListener('pointerdown', ev => ev.stopPropagation());
  const prog = document.createElement('div'); prog.className = 'v3d-prog';
  /* no canto de BAIXO: em cima ficam o Active Bar da vista PCB e a barra do editor de footprint */
  caixaModo.append(prog, seg, selAmb, selAcab);
  host.append(caixaModo);
  function pintaSeletor(){
    for (const k in BOT) BOT[k].classList.toggle('on', k === modo);
    selAmb.value = ambNome; selAcab.value = acab;
    selAmb.hidden = selAcab.hidden = modo === 'padrao';
  }
  function mostraProg(t){ prog.textContent = t || ''; }
  pintaSeletor();

  const vista = {
    cena(c){
      c = c || {};
      montaPlaca(c);
      materiaisDoModo(gPlaca);
      ajustaLuzes();
      if (c.realce) realce = new Set(c.realce);
      poeCorpos(c.corpos || []);
      redimensiona();
      return vista;
    },
    corpos(lista){ poeCorpos(lista); },
    realca(refs){ realce = new Set(refs || []); aplicaRealce(); },
    pose, gira, inclina, vira, enquadra, redimensiona,
    canvas:cv,
    _cena:cena,   /* gancho de teste (CDP), nao e contrato */
    modo(m){ if (m) trocaModo(m); return modo; },
    estado(){ return { steps:est.steps, falhas:est.falhas.slice(), corpos:est.corpos, az:orb.az / RAD, el:orb.el / RAD, dist:orb.dist, modo, amostras:acum ? acum.n : 0 }; },
    destroi(){
      vivo = false;
      clearTimeout(rTimer); cancelAnimationFrame(rLoop);
      if (acum) acum.dispose();
      caixaModo.remove();
      if (ro) ro.disconnect();
      limpa(gPlaca); limpa(gCorpos);
      ren.dispose();
      cv.remove();
    },
  };
  redimensiona();
  if (modo !== 'padrao') trocaModo(modo);
  root.HubPcb3dVista._ultima = vista;   /* gancho de teste (CDP), nao e contrato */
  return vista;
}

root.HubPcb3dVista = { cria, disponivel, tres };
})(typeof self !== 'undefined' ? self : this);
