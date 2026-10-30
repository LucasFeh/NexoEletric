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
       aoMenu(ref, ev, corpo): corpo = o corpo 3D sob o cursor ({kind, model, modeloChave, modelUrl,
       origem, nexo, name}, o que o HubPcb3dModelo.corpos deu) ou null; cada grupo de corpo guarda
       o mesmo em userData.corpo
       vista.cena({lacos, recortes, furos:[{x,y,r}], esp, bbox, pintaFace(ctx, lado), corpos, realce})
       vista.corpos(lista)          troca so os corpos (o componente andou)
       vista.realca(refs)           acende os corpos destes refs
       vista.pose('topo'|'base'|'frente'|'tras'|'esq'|'dir'|'iso'|'isoVirada')
       vista.gira(graus) vista.inclina(graus) vista.vira() vista.enquadra()
       vista.redimensiona() vista.destroi() vista.estado() -> {steps, falhas, corpos}
       vista.pronto() -> Promise<estado>  o Real View e os STEP da cena carregados
       vista.captura(fundo?) -> <canvas>  desenha na hora (mesmo com a janela escondida)
     opcoes.modo 'real'|'padrao': fixa o modo sem ler nem gravar a preferencia (vista de captura)
     HubPcb3dVista.disponivel() -> bool (WebGL)

   REAL VIEW (o RealView do SolidWorks): materiais fisicos (PBR) calibrados nos .p2m do SolidWorks,
   reflexo do estudio (HDRI do Blender, CC0), sombra macia no piso, mascara com verniz, pads de
   estanho, serigrafia fosca, cobre em relevo sob a mascara. Liga e desliga pelo icone da barra
   lateral de quem usa a vista (vista PCB » painel Vista; editor de footprint » Ferramentas):
     vista.realView(true|false) -> bool          liga/desliga nesta vista (e grava a preferencia)
     HubPcb3dVista.soldaLigada() / soldaPrefere(bool)  a caixa "Solda embaixo" (o pino nao passa da
                                 placa; o ponto de solda na outra face): quem monta os corpos passa
                                 opcoes.solda ao HubPcb3dModelo.corpos quando ela esta marcada
     HubPcb3dVista.preferido() / prefere(bool)   a preferencia da maquina (vale para a proxima vista)
   O modulo hub-pcb3d-real.js (ES) so e carregado quando o Real View e ligado.

   EDICAO (editor de footprint: opcoes.edita = {pads() -> [[x,y]...], grade() -> mm,
   aoArrastar(ref, {x,y,z}, info), aoMover(ref, {x,y,z})}):
     vista.seleciona(ref|null)   o corpo selecionado ganha as setas do CAD: X vermelha, Y verde,
                                 Z azul (arrastar a seta move so naquele eixo) e o quadrado
                                 amarelo (arrastar livre no plano da placa); arrastar o proprio
                                 corpo tambem move no plano
     magnetismo                  as pernas do modelo (a fatia mais baixa da malha, agrupada em
                                 pontos) puxam para o centro dos pads: vale o encaixe que poe MAIS
                                 pernas em pads ao mesmo tempo; no Z, o corpo assenta na placa (o
                                 ponto mais baixo em 0) ou a perna atravessa ate a face de baixo;
                                 fora do alcance, o passo da grade. Shift solta o magnetismo.
     sincronizar pino e pad      com o corpo selecionado: clique numa perna dele (marca o pino,
                                 anel verde), clique no pad (anel amarelo) e chame
                                 vista.sincroniza(): o corpo vai com aquele pino no centro do pad,
                                 no giro (0/90/180/270 em torno do pino) que poe mais pernas em
                                 pads. edita.aoSincronizar(ref, {pivo, alvo, ang}) grava;
                                 edita.aviso(texto) conta o passo a passo.
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
function preferido(){ return lePref().modo === 'real' || lePref().modo === 'render'; }
function prefere(on){ gravaPref({ modo:on ? 'real' : 'padrao' }); }
/* A SOLDA EMBAIXO E OPCAO DE VISUALIZACAO, da maquina (pedido do dono, 2026-10-16: "pode ser so uma
   caixa, desmarcada o pino passa normal e marcada ele nao passa; e so uma opcao de visualizacao; o
   ideal e que fique na PCB, pra eu nao precisar alterar um por um"). Marcada, vale para TODO
   componente no 3D da placa e do editor de footprint; nao mexe em footprint nenhum. */
const PREF_SOLDA = 'altiumhub.v3d.solda';
function soldaLigada(){ try { return localStorage.getItem(PREF_SOLDA) === '1'; } catch (e) { return false; } }
function soldaPrefere(on){ try { localStorage.setItem(PREF_SOLDA, on ? '1' : '0'); } catch (e) { /* sem storage */ } }
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
  ren.setPixelRatio(o.razao > 0 ? o.razao : Math.min(2, window.devicePixelRatio || 1));   /* a foto (razao 1) sai do tamanho pedido */
  ren.setClearColor(0x000000, 0);
  const cv = ren.domElement;
  cv.className = 'v3d-cv';
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;outline:none;';
  cv.tabIndex = 0;
  host.append(cv);
  host.style.background = o.fundo || 'linear-gradient(180deg,#4a5262 0%,#262a33 55%,#15171c 100%)';
  ren.shadowMap.type = T.PCFShadowMap;
  ren.localClippingEnabled = true;       /* o corte do pino do footprint com a solda na outra face */   /* r186: o PCFSoft saiu; o PCF com shadow.radius faz a borda macia */

  const cena = new T.Scene();
  const cam = new T.PerspectiveCamera(30, 1, 0.1, 20000);
  const hemi = new T.HemisphereLight(0xffffff, 0x3a3f4a, 1.6); cena.add(hemi);
  const sol = new T.DirectionalLight(0xffffff, 1.5); sol.position.set(0.6, -0.8, 1.6); cena.add(sol); cena.add(sol.target);
  const contra = new T.DirectionalLight(0xffffff, 0.7); contra.position.set(-0.7, 0.9, -1.4); cena.add(contra);
  /* o piso de estudio que so recebe sombra (o "shadow floor" das cenas do SolidWorks) */
  const piso = new T.Mesh(new T.PlaneGeometry(1, 1), new T.ShadowMaterial({ opacity:0.32 }));
  piso.receiveShadow = true; piso.visible = false; cena.add(piso);
  const fundoPadrao = o.fundo || 'linear-gradient(180deg,#4a5262 0%,#262a33 55%,#15171c 100%)';
  /* opcoes.modo ('real'|'padrao') fixa o modo SEM ler nem gravar a preferencia da maquina: e a vista
     de captura (pcbframe » render3d), que nao pode trocar o Real View de quem esta na tela */
  const fixo = o.modo === 'real' || o.modo === 'padrao';
  let modo = fixo ? o.modo : (preferido() ? 'real' : 'padrao');
  const ambNome = 'studio', acab = 'hasl';
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
    if (gGiz.visible) gGiz.scale.setScalar(orb.dist * 0.11);
    ren.render(cena, cam);
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
    if (ED && ev.button === 0 && !ev.ctrlKey && comecaArrasto(ev)) {
      arr = null;
      try { cv.setPointerCapture(ev.pointerId); } catch (e) { /* ok */ }
      ev.preventDefault();
      return;
    }
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
    if (drag) { arrasta(ev); return; }
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
    if (drag) { terminaArrasto(ev); return; }
    if (!arr) return;
    const a = arr; arr = null;
    try { cv.releasePointerCapture(a.id); } catch (e) { /* ok */ }
    if (a.andou) return;
    if (a.b === 0 && ED && selRef && !refSob(ev) && marcaPad(ev)) return;
    if (a.b === 0 && o.aoClicar) o.aoClicar(refSob(ev), ev);
    if (a.b === 2 && !a.girar && o.aoMenu) { const q = sobCursor(ev); o.aoMenu(q.ref, ev, q.corpo); }
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
  function refSob(ev){ return sobCursor(ev).ref; }
  /* o componente e o CORPO sob o cursor ({ref, corpo}): corpo = o userData.corpo do grupo
     ({kind, model, modeloChave, modelUrl, origem, nexo, name, footprint?}) */
  function sobCursor(ev){
    posiciona(); ray.setFromCamera(ndc(ev), cam);
    const hit = ray.intersectObjects([gCorpos], true)[0];
    let ob = hit && hit.object;
    while (ob && !(ob.userData && ob.userData.ref)) ob = ob.parent;
    return ob ? { ref:ob.userData.ref, corpo:ob.userData.corpo || null } : { ref:null, corpo:null };
  }
  const infoCorpo = b => ({ kind:b.kind, owner:b.owner || '', model:b.model || '', modeloChave:b.modeloChave || '', modelUrl:b.modelUrl || '',
    origem:b.origem || '', nexo:b.nexo || '', name:b.name || '', footprint:b.footprint || '', placeholder:!!b.placeholder });

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
  /* ---------- a solda na outra face (pedido do dono, 2026-10-16) ----------
     "o pino do componente só aparece na parte de cima; na parte de baixo do pad vai mostrar no 3D
     uma solda, um triângulo em 3D simulando o ponto de solda". O HubPcb3dModelo marca os corpos do
     componente com corte ('abaixo': componente em cima, o pino some abaixo da face de baixo;
     'acima': o contrario) e manda um corpo kind 'solda' com os pads passantes. Aqui: o corte e um
     plano de recorte no material de cada malha do corpo (no Padrao e no Real View), e a solda e um
     menisco de estanho por pad -- a base do tamanho do pad, colada na face, afinando ate a ponta do
     pino (o perfil concavo de uma solda de verdade, que de lado e o triangulo). */
  function planoDoCorte(b){
    const esp = isNum(b.esp) && b.esp > 0 ? b.esp : ESP;
    if (b.corte === 'abaixo') return new T.Plane(new T.Vector3(0, 0, 1), esp);   /* fica z >= -esp */
    if (b.corte === 'acima') return new T.Plane(new T.Vector3(0, 0, -1), 0);     /* fica z <= 0 */
    return null;
  }
  function clipDe(x){ for (let p = x; p && p !== gCorpos; p = p.parent) if (p.userData && p.userData.clip) return p.userData.clip; return null; }
  function aplicaCortes(raiz){
    raiz.traverse(x => {
      if (!x.isMesh) return;
      const c = clipDe(x);
      if (!c) return;
      for (const q of [x.material, x.userData.mPadrao, x.userData.mReal])
        for (const m of (Array.isArray(q) ? q : (q ? [q] : []))) if (!m.clippingPlanes || m.clippingPlanes[0] !== c) { m.clippingPlanes = [c]; m.clipShadows = true; m.needsUpdate = true; }
    });
  }
  const PERFIL_SOLDA = 14;
  function malhaSolda(b){
    const g = new T.Group();
    const esp = isNum(b.esp) && b.esp > 0 ? b.esp : ESP;
    const embaixo = b.side !== 'bottom';            /* componente em cima: a solda na face de baixo */
    /* estanho: claro e acetinado (metal polido demais vira espelho escuro sem ambiente, e no Real View reflete o estudio inteiro) */
    const mp = new T.MeshStandardMaterial({ color:new T.Color(b.color || '#c9ced4'), metalness:0.35, roughness:0.38, side:T.DoubleSide });
    const mr = new T.MeshPhysicalMaterial({ color:0xdfe3e8, metalness:0.9, roughness:0.42, side:T.DoubleSide });
    for (const f of (b.furos || [])) {
      if (!(f.r > 0)) continue;
      const rb = f.r, rp = Math.max(0.12, Math.min(rb * 0.6, (f.rf > 0 ? f.rf : rb / 2) * 0.7));
      const h = Math.max(0.5, Math.min(1.8, rb * 1.3));
      /* o perfil: da borda do pad (r = rb, na face) ate a ponta do pino (r = rp, a h da face), concavo */
      const pts = [];
      for (let i = 0; i <= PERFIL_SOLDA; i++) { const t = i / PERFIL_SOLDA; pts.push(new T.Vector2(rp + (rb - rp) * Math.pow(1 - t, 1.6), t * h)); }
      pts.push(new T.Vector2(0, h));
      const geo = new T.LatheGeometry(pts, 36);
      geo.rotateX(embaixo ? -Math.PI / 2 : Math.PI / 2);   /* o eixo do torno (Y) vira -Z (para baixo) ou +Z */
      geo.translate(f.x, f.y, embaixo ? -esp - 0.004 : 0.004);
      const m = new T.Mesh(geo, mp);
      m.userData.mPadrao = mp; m.userData.mReal = mr;
      g.add(m);
    }
    return g.children.length ? g : null;
  }
  let geracao = 0, carregando = [], modoP = Promise.resolve();
  function poeCorpos(lista){
    const minha = ++geracao;
    limpa(gCorpos);
    est.corpos = 0; est.steps = 0; est.falhas = [];
    carregando = [];
    for (const b of (lista || [])) {
      if (!b) continue;
      let m = null;
      if (b.kind === 'extruded') m = malhaExtrudada(b);
      else if (b.kind === 'cylinder' && b.radius > 0) {
        const geo = new T.CylinderGeometry(b.radius, b.radius, Math.max(0.01, b.height || 1), 28);
        geo.rotateX(Math.PI / 2); geo.translate(0, 0, Math.max(0.01, b.height || 1) / 2);
        m = comMatriz(geo, b);
      } else if (b.kind === 'sphere' && b.radius > 0) m = comMatriz(new T.SphereGeometry(b.radius, 24, 16), b);
      else if (b.kind === 'solda') m = malhaSolda(b);
      else if (b.kind === 'step') {
        const g = new T.Group();
        g.userData.ref = b.owner || '';
        g.userData.corpo = infoCorpo(b);
        const pc = planoDoCorte(b); if (pc) g.userData.clip = pc;
        gCorpos.add(g);
        est.corpos++;
        if (!b.modelUrl) { est.falhas.push((b.owner || '?') + ': modelo sem arquivo'); continue; }
        if (typeof HubPcb3dStep === 'undefined') { est.falhas.push('leitor de STEP não carregado'); continue; }
        carregando.push(HubPcb3dStep.carrega(b.modelUrl, { chave:b.chave || b.model || b.modelUrl }).then(r => {
          if (minha !== geracao || !vivo) return;
          const mg = malhaDoStep(r.malhas, b);
          g.add(mg); est.steps++;
          materiaisDoModo(mg);
          if (realce.has(g.userData.ref)) acende(g, true);
          if (!mexeu) enquadra();   /* o modelo chegou e ninguem mexeu na camera: enquadra com ele */
          if (g.userData.ref && g.userData.ref === selRef) poeGizmo();
          pede();
        }).catch(e => { est.falhas.push((b.owner || '?') + ': ' + (e && e.message || e)); }));
        continue;
      }
      if (!m) continue;
      const sup = new T.Group();
      sup.userData.ref = b.owner || '';
      sup.userData.corpo = infoCorpo(b);
      const pc = planoDoCorte(b); if (pc) sup.userData.clip = pc;
      sup.add(m);
      gCorpos.add(sup);
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

  /* ---------- edicao: selecionar e mover um corpo (o gizmo de translacao dos CAD) ---------- */
  const ED = o.edita || null;
  let selRef = null, drag = null;
  const gGiz = new T.Group(); gGiz.visible = false; gGiz.renderOrder = 999; cena.add(gGiz);
  const gMarca = new T.Group(); cena.add(gMarca);
  const EIXO = { x:new T.Vector3(1, 0, 0), y:new T.Vector3(0, 1, 0), z:new T.Vector3(0, 0, 1) };
  const COR_EIXO = { x:0xe53935, y:0x43a047, z:0x1e88e5, xy:0xffc107 };
  function matGiz(cor, op){ return new T.MeshBasicMaterial({ color:cor, depthTest:false, depthWrite:false, transparent:true, opacity:op || 0.95, toneMapped:false }); }
  (function montaGizmo(){
    for (const e of ['x', 'y', 'z']) {
      const g = new T.Group(), m = matGiz(COR_EIXO[e]);
      const haste = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 0.78, 12), m); haste.position.y = 0.39;
      const ponta = new T.Mesh(new T.ConeGeometry(0.09, 0.24, 20), m); ponta.position.y = 0.9;
      const pega = new T.Mesh(new T.CylinderGeometry(0.11, 0.11, 1.05, 8), new T.MeshBasicMaterial({ visible:false })); pega.position.y = 0.52;
      g.add(haste, ponta, pega);
      if (e === 'x') g.rotation.z = -Math.PI / 2; else if (e === 'z') g.rotation.x = Math.PI / 2;
      g.traverse(x => { x.userData.eixo = e; x.renderOrder = 999; });
      g.userData.mat = m;
      gGiz.add(g);
    }
    const mq = matGiz(COR_EIXO.xy, 0.55);
    const q = new T.Mesh(new T.PlaneGeometry(0.26, 0.26), mq); q.position.set(0.24, 0.24, 0);
    mq.side = T.DoubleSide;
    q.userData.eixo = 'xy'; q.renderOrder = 999; q.userData.mat = mq;
    gGiz.add(q);
  })();
  const suporteDe = ref => gCorpos.children.find(c => c.userData.ref === ref) || null;
  function poeGizmo(){
    const h = selRef && suporteDe(selRef);
    if (!ED || !h) { gGiz.visible = false; pede(); return; }
    h.updateMatrixWorld(true);
    const bb = new T.Box3().setFromObject(h);
    if (bb.isEmpty()) { gGiz.visible = false; pede(); return; }
    const c = bb.getCenter(new T.Vector3());
    gGiz.position.set(c.x, c.y, c.z);   /* no meio do corpo: no topo a seta Z de peca alta saia da tela */
    gGiz.visible = true;
    pede();
  }
  function seleciona(ref){
    if ((ref || null) !== selRef) { sinc.pino = sinc.pad = null; mostraSinc(); }
    selRef = ref || null;
    realce = new Set(selRef ? [selRef] : []);
    aplicaRealce();
    poeGizmo();
  }
  function raioDe(ev){ posiciona(); ray.setFromCamera(ndc(ev), cam); return ray.ray.clone(); }
  /* o ponto da reta do eixo mais perto do raio do mouse: o t do eixo */
  function tNoEixo(r, O, u){
    const w0 = new T.Vector3().subVectors(O, r.origin);
    const b = u.dot(r.direction), c = r.direction.dot(r.direction), d = u.dot(w0), e = r.direction.dot(w0);
    const den = c - b * b;
    return Math.abs(den) < 1e-9 ? 0 : (b * e - c * d) / den;
  }
  function noPlanoZ(r, z){ const p = new T.Vector3(); return r.intersectPlane(new T.Plane(new T.Vector3(0, 0, 1), -z), p) ? p : null; }
  /* as pernas do modelo: os triangulos da fatia mais baixa da malha (no mundo), unidos pelos
     vertices que dividem -- a ponta de cada perna e um pedaco conexo da malha, entao pernas de
     passo fino (QFP 0,5 mm) nao se fundem e a ponta larga de uma perna PTH nao se parte */
  function pernasDe(h){
    h.updateMatrixWorld(true);
    let zmin = Infinity, zmax = -Infinity;
    const v = new T.Vector3(), malhas = [];
    h.traverse(x => {
      if (!x.isMesh || !x.geometry || !x.geometry.attributes.position) return;
      const P = x.geometry.attributes.position, W = new Float32Array(P.count * 3);
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(x.matrixWorld);
        W[i * 3] = v.x; W[i * 3 + 1] = v.y; W[i * 3 + 2] = v.z;
        if (v.z < zmin) zmin = v.z; if (v.z > zmax) zmax = v.z;
      }
      malhas.push({ W, I:x.geometry.index ? x.geometry.index.array : null, n:P.count });
    });
    if (!malhas.length || !isFinite(zmin)) return { pts:[], zmin:0, zmax:0 };
    const fatia = zmin + Math.max(0.12, (zmax - zmin) * 0.03);
    const pai = new Map(), soma = new Map();
    const chave = (W, k) => Math.round(W[k * 3] * 1e3) + ',' + Math.round(W[k * 3 + 1] * 1e3) + ',' + Math.round(W[k * 3 + 2] * 1e3);
    const acha = a => { while (pai.get(a) !== a) { pai.set(a, pai.get(pai.get(a))); a = pai.get(a); } return a; };
    const novo = (k, W, i) => { if (!pai.has(k)) { pai.set(k, k); soma.set(k, [W[i * 3], W[i * 3 + 1]]); } };
    for (const m of malhas) {
      const nt = m.I ? m.I.length / 3 : m.n / 3;
      for (let t = 0; t < nt; t++) {
        const a = m.I ? m.I[t * 3] : t * 3, b = m.I ? m.I[t * 3 + 1] : t * 3 + 1, c = m.I ? m.I[t * 3 + 2] : t * 3 + 2;
        if (m.W[a * 3 + 2] > fatia || m.W[b * 3 + 2] > fatia || m.W[c * 3 + 2] > fatia) continue;
        const ka = chave(m.W, a), kb = chave(m.W, b), kc = chave(m.W, c);
        novo(ka, m.W, a); novo(kb, m.W, b); novo(kc, m.W, c);
        const ra = acha(ka), rb = acha(kb), rc = acha(kc);
        pai.set(rb, ra); pai.set(acha(rc), ra);
      }
    }
    const grupos = new Map();
    for (const k of pai.keys()) {
      const r = acha(k), p = soma.get(k);
      const g = grupos.get(r) || [0, 0, 0]; g[0] += p[0]; g[1] += p[1]; g[2]++; grupos.set(r, g);
    }
    const pts = [...grupos.values()].map(g => [g[0] / g[2], g[1] / g[2]]);
    return { pts, zmin, zmax };
  }
  function comecaArrasto(ev){
    const r = raioDe(ev);
    let eixo = null;
    if (selRef && gGiz.visible) {
      ray.ray.copy(r);
      /* o quadrado do plano ganha das setas: a area de pegar da seta Z cobre o quadrado em muitas poses */
      const hits = ray.intersectObject(gGiz, true).filter(h => h.object.userData.eixo);
      const hq = hits.find(h => h.object.userData.eixo === 'xy');
      if (hq || hits[0]) eixo = (hq || hits[0]).object.userData.eixo;
    }
    if (!eixo) {
      /* clicar e arrastar QUALQUER corpo: ele e selecionado e anda no plano da placa, sem passar
         pelas setas (que continuam la para mover num eixo so) */
      ray.ray.copy(r);
      const hit = ray.intersectObjects([gCorpos], true)[0];
      let ob = hit && hit.object;
      while (ob && !(ob.userData && ob.userData.ref)) ob = ob.parent;
      if (!ob) return false;
      var jaSel = ob.userData.ref === selRef, ponto = hit.point.clone();
      if (ob.userData.ref !== selRef) {
        seleciona(ob.userData.ref);
        if (o.aoClicar) { try { o.aoClicar(ob.userData.ref, ev); } catch (e) { /* ok */ } }
      }
      eixo = 'xy';
    }
    const h = suporteDe(selRef);
    if (!h) return false;
    const O = gGiz.position.clone();
    drag = { eixo, h, O, pos0:h.position.clone(), giz0:gGiz.position.clone(), d:new T.Vector3(), andou:false, x:ev.clientX, y:ev.clientY, pernas:pernasDe(h),
             jaSel:!!jaSel, ponto:ponto || null };
    if (eixo === 'xy') drag.p0 = noPlanoZ(r, O.z);
    else drag.t0 = tNoEixo(r, O, EIXO[eixo]);
    if (eixo === 'xy' && !drag.p0) { drag = null; return false; }
    for (const g of gGiz.children) if (g.userData.mat) g.userData.mat.opacity = (g.userData.eixo === eixo ? 1 : 0.35);
    pede();
    return true;
  }
  /* o encaixe: pernas no centro dos pads (o que poe MAIS pernas em pads ao mesmo tempo) */
  function encaixa(d, eixo){
    const pads = ED.pads ? (ED.pads() || []) : [];
    const pe = drag.pernas.pts;
    if (!pads.length || !pe.length || eixo === 'z') return null;
    const alcance = Math.max(0.35, orb.dist * 0.012), tol = 0.12;
    let melhor = null;
    for (const p of pe) {
      const px = p[0] + d.x, py = p[1] + d.y;
      for (const q of pads) {
        let cx = q[0] - p[0], cy = q[1] - p[1];
        if (eixo === 'x') cy = d.y; else if (eixo === 'y') cx = d.x;
        if (Math.hypot(cx - d.x, cy - d.y) > alcance) continue;
        let n = 0; const casados = [];
        for (const r of pe) {
          const rx = r[0] + cx, ry = r[1] + cy;
          if (pads.some(t => noPad(rx, ry, t))) { n++; casados.push([rx, ry]); }
        }
        if (!n) continue;
        const dist = Math.hypot(cx - d.x, cy - d.y);
        if (!melhor || n > melhor.n || (n === melhor.n && dist < melhor.dist)) melhor = { n, dist, x:cx, y:cy, casados };
      }
    }
    return melhor;
  }
  /* a perna (o pe dela) cai DENTRO do pad: [x, y, w, h, rot] (w/h trocam a 90/270); sem tamanho,
     a 0,15 mm do centro */
  function noPad(x, y, q){
    if (!(q[2] > 0 && q[3] > 0)) return Math.abs(q[0] - x) <= 0.15 && Math.abs(q[1] - y) <= 0.15;
    const r = (((q[4] || 0) % 180) + 180) % 180, deitado = Math.abs(r - 90) < 1;
    const hw = (deitado ? q[3] : q[2]) / 2 + 0.02, hh = (deitado ? q[2] : q[3]) / 2 + 0.02;
    return Math.abs(x - q[0]) <= hw && Math.abs(y - q[1]) <= hh;
  }
  function marca(pontos, z){
    for (const c of gMarca.children.slice()) { gMarca.remove(c); c.geometry.dispose(); c.material.dispose(); }
    const r = Math.max(0.12, orb.dist * 0.006);
    for (const p of pontos || []) {
      const m = new T.Mesh(new T.RingGeometry(r * 0.6, r, 24), matGiz(0x00e676, 1));
      m.material.side = T.DoubleSide; m.position.set(p[0], p[1], z + 0.01); m.renderOrder = 1000;
      gMarca.add(m);
    }
  }
  function arrasta(ev){
    if (!drag) return;
    if (!drag.andou && Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < 3) return;
    drag.andou = true;
    const r = raioDe(ev), d = new T.Vector3();
    if (drag.eixo === 'xy') { const p = noPlanoZ(r, drag.O.z); if (!p) return; d.subVectors(p, drag.p0); d.z = 0; }
    else d.copy(EIXO[drag.eixo]).multiplyScalar(tNoEixo(r, drag.O, EIXO[drag.eixo]) - drag.t0);
    const g = (ED.grade && ED.grade()) || 0;
    const naGrade = v => g > 0 ? Math.round(v / g) * g : v;
    let info = { encaixe:null };
    let enc = ev.shiftKey ? null : encaixa(d, drag.eixo);
    if (enc) { d.x = enc.x; d.y = enc.y; info.encaixe = { pernas:enc.n, de:drag.pernas.pts.length }; marca(enc.casados, 0); }
    else {
      marca([], 0);
      if (drag.eixo !== 'z') { d.x = naGrade(d.x); d.y = naGrade(d.y); }
    }
    if (drag.eixo === 'z') {
      /* assentar: o ponto mais baixo na placa (SMD) ou a ponta da perna na face de baixo (PTH) */
      const z0 = drag.pernas.zmin, alcance = Math.max(0.25, orb.dist * 0.01);
      const alvos = [0, -ESP];
      let fez = false;
      if (!ev.shiftKey) for (const a of alvos) if (Math.abs(z0 + d.z - a) <= alcance) { d.z = a - z0; info.assento = a === 0 ? 'na placa' : 'atravessa a placa'; fez = true; break; }
      if (!fez) d.z = naGrade(d.z);
    }
    drag.d.copy(d);
    drag.h.position.copy(drag.pos0).add(d);
    gGiz.position.copy(drag.giz0).add(d);
    if (ED.aoArrastar) { try { ED.aoArrastar(selRef, { x:d.x, y:d.y, z:d.z }, info); } catch (e) { /* ok */ } }
    pede();
  }
  function terminaArrasto(ev){
    const a = drag; drag = null;
    try { cv.releasePointerCapture(ev.pointerId); } catch (e) { /* ok */ }
    for (const g of gGiz.children) if (g.userData.mat) g.userData.mat.opacity = g.userData.eixo === 'xy' ? 0.55 : 0.95;
    marca([], 0);
    if (a && a.andou && (a.d.x || a.d.y || a.d.z) && ED.aoMover) { sinc.pino = sinc.pad = null; mostraSinc(); ED.aoMover(selRef, { x:a.d.x, y:a.d.y, z:a.d.z }); }
    else if (a && !a.andou && a.jaSel && a.ponto) marcaPino(a);
    else if (a && !a.andou && o.aoClicar) o.aoClicar(selRef, ev);
    pede();
  }
  /* ---------- sincronizar: o pino marcado no centro do pad marcado ---------- */
  const sinc = { pino:null, pad:null };
  const gSinc = new T.Group(); cena.add(gSinc);
  const avisa = t => { if (ED && ED.aviso) { try { ED.aviso(t); } catch (e) { /* ok */ } } };
  function anel(x, y, z, cor){
    const r = Math.max(0.18, orb.dist * 0.008);
    const m = new T.Mesh(new T.RingGeometry(r * 0.55, r, 28), matGiz(cor, 1));
    m.material.side = T.DoubleSide; m.position.set(x, y, z + 0.02); m.renderOrder = 1001;
    return m;
  }
  function mostraSinc(){
    for (const c of gSinc.children.slice()) { gSinc.remove(c); c.geometry.dispose(); c.material.dispose(); }
    if (sinc.pino) gSinc.add(anel(sinc.pino[0], sinc.pino[1], sinc.pino[2], 0x00e676));
    if (sinc.pad) gSinc.add(anel(sinc.pad[0], sinc.pad[1], 0.01, 0xffc107));
    pede();
  }
  /* o clique (sem arrastar) no corpo ja selecionado marca a perna mais perto do ponto clicado */
  function marcaPino(a){
    const pe = a.pernas.pts;
    if (!pe.length) { avisa('o modelo nao tem pernas reconheciveis'); return; }
    let m = null, dm = Infinity;
    for (const p of pe) { const d = Math.hypot(p[0] - a.ponto.x, p[1] - a.ponto.y); if (d < dm) { dm = d; m = p; } }
    sinc.pino = [m[0], m[1], a.pernas.zmin];
    mostraSinc();
    avisa(sinc.pad ? 'pino e pad marcados: S sincroniza' : 'pino marcado: agora clique no pad');
  }
  /* o clique na placa (sem arrastar), com um corpo selecionado, marca o pad mais perto */
  function marcaPad(ev){
    posiciona(); ray.setFromCamera(ndc(ev), cam);
    const hit = ray.intersectObjects([gPlaca], true)[0];
    if (!hit) return false;
    const pads = ED.pads ? (ED.pads() || []) : [];
    if (!pads.length) return false;
    let m = null, dm = Infinity;
    for (const q of pads) { const d = Math.hypot(q[0] - hit.point.x, q[1] - hit.point.y); if (d < dm) { dm = d; m = q; } }
    sinc.pad = [m[0], m[1]];
    mostraSinc();
    avisa(sinc.pino ? 'pino e pad marcados: S sincroniza' : 'pad marcado: agora clique no pino do componente');
    return true;
  }
  function sincroniza(){
    if (!selRef) { avisa('clique no componente primeiro'); return null; }
    if (!sinc.pino || !sinc.pad) { avisa(!sinc.pino ? 'clique no pino do componente' : 'clique no pad'); return null; }
    const h = suporteDe(selRef); if (!h) return null;
    const pe = pernasDe(h).pts, pads = ED.pads ? (ED.pads() || []) : [];
    const [px, py] = sinc.pino, [ax, ay] = sinc.pad, tol = 0.15;
    let melhor = null;
    for (const ang of [0, 90, 180, 270]) {
      const c = Math.cos(ang * RAD), s_ = Math.sin(ang * RAD);
      let n = 0;
      for (const p of pe) {
        const dx = p[0] - px, dy = p[1] - py;
        const x = ax + dx * c - dy * s_, y = ay + dx * s_ + dy * c;
        if (pads.some(q => noPad(x, y, q))) n++;
      }
      if (!melhor || n > melhor.n) melhor = { ang, n };
    }
    const r = { pivo:[px, py], alvo:[ax, ay], ang:melhor.ang, pernas:melhor.n, de:pe.length };
    sinc.pino = sinc.pad = null; mostraSinc();
    if (ED.aoSincronizar) ED.aoSincronizar(selRef, r);
    return r;
  }

  /* ---------- os modos de vista ---------- */
  function materiaisDoModo(raiz){
    if (modo !== 'padrao' && !R) { aplicaCortes(raiz); return; }
    raiz.traverse(x => {
      if (!x.isMesh || x === piso) return;
      x.castShadow = true; x.receiveShadow = true;
      if (!x.userData.mPadrao) x.userData.mPadrao = x.material;
      if (modo === 'padrao') { x.material = x.userData.mPadrao; return; }
      if (!x.userData.mReal) x.userData.mReal = realDe(x);
      x.material = x.userData.mReal;
    });
    aplicaCortes(raiz);
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
  function ajustaLuzes(){
    const cx = (BB.x1 + BB.x2) / 2, cy = (BB.y1 + BB.y2) / 2, tam = Math.max(BB.x2 - BB.x1, BB.y2 - BB.y1, 10);
    for (const L of [sol]) {
      L.target.position.set(cx, cy, -ESP / 2);
      const c = L.shadow.camera, m = tam * 1.2;
      c.left = -m; c.right = m; c.top = m; c.bottom = -m; c.near = 0.1; c.far = tam * 8;
      c.updateProjectionMatrix();
      L.shadow.bias = -0.0004; L.shadow.normalBias = tam * 0.0004;
    }
    sol.position.set(cx + tam * 0.9, cy - tam * 1.2, tam * 2.4);
    sol.shadow.mapSize.set(2048, 2048);
    sol.shadow.radius = 4;
    piso.scale.set(tam * 12, tam * 12, 1); piso.position.set(cx, cy, -ESP - Math.max(0.05, tam * 0.004));
  }
  async function trocaModo(novo){
    if (novo !== 'padrao' && novo !== 'real') return;
    modo = novo; if (!fixo) prefere(modo === 'real');
    if (modo === 'padrao') {
      ren.toneMapping = T.NoToneMapping; ren.shadowMap.enabled = false; cena.environment = null;
      hemi.intensity = 1.6; sol.intensity = 1.5; contra.intensity = 0.7; sol.castShadow = false;
      piso.visible = false; host.style.background = fundoPadrao;
      materiaisDoModo(gPlaca); materiaisDoModo(gCorpos); pede();
      return;
    }
    try { await real(); }
    catch (e) { console.warn('3D: Real View indisponivel', e); modo = 'padrao'; return; }
    let env = null;
    try { env = await R.ambiente(T, ren, ambNome); } catch (e) { console.warn('3D: HDRI', e); }
    if (!vivo || modo === 'padrao') return;
    cena.environment = env;
    cena.environmentRotation.set(Math.PI / 2, 0, 0);     /* a placa e Z para cima; o HDRI do three, Y */
    cena.environmentIntensity = 1.05;
    ren.toneMapping = T.NeutralToneMapping; ren.toneMappingExposure = 1.0;
    ren.shadowMap.enabled = true; ren.shadowMap.needsUpdate = true;
    hemi.intensity = env ? 0.15 : 0.9; contra.intensity = 0.25;
    sol.intensity = 1.9; sol.castShadow = true;
    piso.visible = true;
    /* o fundo de estudio do SolidWorks ("Soft Neutral"): claro, sem competir com a peca */
    host.style.background = 'radial-gradient(ellipse at 50% 35%, #f4f5f7 0%, #d9dce1 55%, #b6bbc3 100%)';
    ajustaLuzes();
    /* a mudanca de tom/sombra exige recompilar os materiais que ja existem */
    cena.traverse(x => { const ms = x.material ? (Array.isArray(x.material) ? x.material : [x.material]) : []; for (const m of ms) m.needsUpdate = true; });
    materiaisDoModo(gPlaca); materiaisDoModo(gCorpos);
    aplicaRealce();
    pede();
  }

  const vista = {
    cena(c){
      c = c || {};
      montaPlaca(c);
      materiaisDoModo(gPlaca);
      ajustaLuzes();
      if (c.realce) realce = new Set(c.realce);
      poeCorpos(c.corpos || []);
      if (selRef && !suporteDe(selRef)) selRef = null;
      poeGizmo();
      redimensiona();
      return vista;
    },
    corpos(lista){ poeCorpos(lista); },
    realca(refs){ realce = new Set(refs || []); aplicaRealce(); },
    pose, gira, inclina, vira, enquadra, redimensiona,
    canvas:cv,
    _cena:cena, _cam:cam, _giz:gGiz, _pernas:() => (selRef && suporteDe(selRef) ? pernasDe(suporteDe(selRef)) : null),   /* gancho de teste (CDP), nao e contrato */
    seleciona,
    selecionado:() => selRef,
    sincroniza,
    realView(on){ if (on != null) modoP = trocaModo(on ? 'real' : 'padrao'); return modo === 'real'; },
    /* o Real View montado (HDRI) e os STEP da cena carregados (ou falhos). Um STEP que chega pode
       pedir outro (cena trocada no meio): repete ate a lista parar de mudar */
    async pronto(){
      await modoP.catch(() => {});
      for (let i = 0; i < 20; i++) {
        const l = carregando;
        await Promise.allSettled(l);
        if (l === carregando) break;
      }
      return vista.estado();
    },
    /* desenha AGORA (sem esperar o requestAnimationFrame, que para com a janela escondida) e devolve
       um <canvas> com a imagem; fundo = cor CSS por baixo (sem ela, o PNG sai transparente) */
    captura(fundo){
      posiciona();
      if (gGiz.visible) gGiz.scale.setScalar(orb.dist * 0.11);
      ren.render(cena, cam);
      const out = document.createElement('canvas');
      out.width = cv.width; out.height = cv.height;
      const c = out.getContext('2d');
      if (fundo) { c.fillStyle = fundo; c.fillRect(0, 0, out.width, out.height); }
      c.drawImage(cv, 0, 0);
      return out;
    },
    estado(){ return { steps:est.steps, falhas:est.falhas.slice(), corpos:est.corpos, az:orb.az / RAD, el:orb.el / RAD, dist:orb.dist, realView:modo === 'real' }; },
    destroi(){
      vivo = false;
      if (ro) ro.disconnect();
      limpa(gPlaca); limpa(gCorpos);
      ren.dispose();
      cv.remove();
    },
  };
  redimensiona();
  if (modo !== 'padrao') modoP = trocaModo(modo);
  root.HubPcb3dVista._ultima = vista;   /* gancho de teste (CDP), nao e contrato */
  return vista;
}

root.HubPcb3dVista = { cria, disponivel, tres, preferido, prefere, soldaLigada, soldaPrefere };
})(typeof self !== 'undefined' ? self : this);
