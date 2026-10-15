/* AltiumPCBMirror - hub-pcb3d-real.js (modulo ES, importado pelo hub-pcb3d-vista.js)
   O 3D "de verdade" da vista 3D do hub: o RealView do SolidWorks, em WebGL com o three.js do vendor
   (r186), sem addon nenhum.

   DE ONDE VEM CADA NUMERO (medido nos programas instalados nesta maquina, 2026-10-15, pelo metodo
   do REA -- evidencia do artefato instalado, nao palpite):

   SolidWorks 2025, data/graphics/Materials/<grupo>/<nome>.p2m (texto: "chave" valor):
     metal/silver/satin finish silver   col2 .518 .529 .549  reflectivity .5  roughness .4  specular .5
     metal/gold/polished gold           col1 1 .808 .498     reflectivity .65 roughness .7  specular .7
     metal/copper/satin finish copper   col1 1 .647 .627     col2 .839 .467 .369  reflectivity .5 roughness .4
     metal/nickel/matte nickel          col1 .63 .59 .51     roughness .9   specular .8
     plastic/high gloss/*               reflectivity .15  roughness .6  specular .5
     plastic/low gloss/*                reflectivity .05  roughness .7  specular .05  diffuse .7
   O "roughness" do SolidWorks e o espalhamento do reflexo do ambiente (0..1, com "blurryReflections"),
   e o "reflectivity" o quanto do ambiente aparece: no PBR isso vira metalness (metal: 1) e
   roughness ~ 0.55 * roughness do .p2m (o lobo GGX do three e mais largo que o desfoque do RealView:
   0.55 e o fator que faz o "satin" do SW parecer satin aqui, conferido a olho lado a lado).
   O plastico "high gloss" (reflectivity .15) e um dieletrico com verniz: clearcoat.

   SolidWorks Scenes/Studio/*.p2s: a cena de estudio e um HDR esferico como ambiente ("spherical_env",
   environment_multipliers .2), piso que so recebe sombra ("shadow floor.p2m", floor_reflectivity 0)
   e fundo de imagem suave. O HDR do SolidWorks e proprietario: aqui vai o do Blender.

   Blender 5.2, datafiles/studiolights/world/*.exr: as HDRIs do Look Dev, CC0 (Poly Haven, Greg Zaal;
   vendor/hdri/LICENSE-CC0.txt). Convertidas pelo proprio Blender (--background --python) para
   vendor/hdri/<nome>.rgbe: "RGBE" + u32 largura + u32 altura + pixels RGBE (Radiance, 4 bytes),
   linhas de cima para baixo.

   API
     MATERIAIS                       a tabela acima, ja em PBR
     classifica(r, g, b, temCor)     -> nome do material de uma cor do STEP (0..1)
     material(T, cor, opac, temCor)  -> MeshPhysicalMaterial
     ambiente(T, ren, nome)          -> Promise<Texture PMREM> (cache por renderer + nome)
     mapasDaFace(T, canvas, acab)    -> {map, orm, coat, bump} da face pintada pela vista
     bordaFR4(T)                     -> material da borda da placa (fibra de vidro) */

export const MATERIAIS = {
  estanho:   { cor:[0.80, 0.81, 0.83], metal:1, rough:0.24 },          /* satin silver: HASL, pinos estanhados */
  prata:     { cor:[0.92, 0.92, 0.93], metal:1, rough:0.16 },
  ouro:      { cor:[1.00, 0.81, 0.50], metal:1, rough:0.20 },          /* polished gold: ENIG, contatos */
  cobre:     { cor:[0.96, 0.64, 0.54], metal:1, rough:0.24 },          /* satin copper */
  niquel:    { cor:[0.63, 0.59, 0.51], metal:1, rough:0.45 },          /* matte nickel: carcaca de conector */
  brilho:    { metal:0, rough:0.33, coat:0.5, coatRough:0.08 },        /* plastic high gloss */
  fosco:     { metal:0, rough:0.62, coat:0,   coatRough:0 },           /* plastic low gloss */
  epoxi:     { metal:0, rough:0.48, coat:0.25, coatRough:0.25 },       /* corpo de CI: epoxi preto acetinado */
};

const lin = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

function hsl(r, g, b){
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (d < 1e-6) return { h:0, s:0, l };
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h:h * 60, s, l };
}

/* a cor que veio do STEP -> o material. Sem cor no STEP (o cinza de reserva do corpo) e plastico
   fosco: e o que o corpo generico do Altium e. */
export function classifica(r, g, b, temCor){
  if (!temCor) return 'fosco';
  const c = hsl(r, g, b);
  if (c.s < 0.13) {
    if (c.l > 0.80) return 'prata';
    if (c.l > 0.55) return 'estanho';
    if (c.l < 0.20) return 'epoxi';
    return 'fosco';
  }
  if (c.h >= 40 && c.h <= 56 && c.s > 0.40 && c.l > 0.45) return 'ouro';
  if (c.h >= 8 && c.h < 30 && c.s > 0.35 && c.l > 0.42 && c.l < 0.75) return 'cobre';
  if (c.l < 0.16) return 'epoxi';
  return 'brilho';
}

/* a micro-textura do plastico: ruido de valor ladrilhavel (o "Noise Texture" do Blender ligado
   ao Bump e a Roughness). As malhas do STEP ganham UV por projecao na caixa em mm (vista » suaviza),
   entao o grao tem tamanho fisico: ~0,1 mm no epoxi pontilhado do CI, mais fino no plastico. */
const RUIDO = new Map();
function ruido(T, chave, celula, contraste){
  if (RUIDO.has(chave)) return RUIDO.get(chave);
  const N = 256, cv = document.createElement('canvas'); cv.width = cv.height = N;
  const x = cv.getContext('2d'), im = x.createImageData(N, N), d = im.data;
  const G = Math.max(2, Math.round(N / celula)), grade = new Float32Array(G * G);
  let s0 = 7919 + celula * 31; const rnd = () => { s0 = (s0 * 16807) % 2147483647; return s0 / 2147483647; };
  for (let i = 0; i < grade.length; i++) grade[i] = rnd();
  const v = (gx, gy) => grade[((gy % G + G) % G) * G + ((gx % G + G) % G)];
  const sm = t => t * t * (3 - 2 * t);
  for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) {
    const fx = px / N * G, fy = py / N * G, ix = Math.floor(fx), iy = Math.floor(fy), tx = sm(fx - ix), ty = sm(fy - iy);
    const a = v(ix, iy) + (v(ix + 1, iy) - v(ix, iy)) * tx, b = v(ix, iy + 1) + (v(ix + 1, iy + 1) - v(ix, iy + 1)) * tx;
    const fino = rnd() * 0.25;
    const val = Math.max(0, Math.min(1, 0.5 + ((a + (b - a) * ty) * 0.75 + fino - 0.5) * contraste));
    const o = (py * N + px) * 4; d[o] = d[o + 1] = d[o + 2] = Math.round(val * 255); d[o + 3] = 255;
  }
  x.putImageData(im, 0, 0);
  const t = new T.CanvasTexture(cv);
  t.wrapS = t.wrapT = T.RepeatWrapping; t.colorSpace = T.NoColorSpace; t.anisotropy = 4;
  RUIDO.set(chave, t);
  return t;
}
/* por classe: [celulas no ladrilho, contraste, repeticoes por UV (UV = 0,5 por mm), bump, faixa de rugosidade] */
/* sem relevo: o bump do ruido aparecia como uma grade de pontos no corpo da peca; a variacao de
   rugosidade sozinha ja quebra o reflexo "de plastico de brinquedo" sem desenhar padrao */
const GRAO = { epoxi:[128, 0.12, 4, 0, 0], fosco:[128, 0.12, 4, 0, 0], brilho:[128, 0.06, 4, 0, 0] };

export function material(T, cor, opac, temCor){
  const k = classifica(cor.r, cor.g, cor.b, temCor);
  const M = MATERIAIS[k];
  const p = { roughness:M.rough, metalness:M.metal, side:T.DoubleSide,
              transparent:opac < 1, opacity:typeof opac === 'number' ? opac : 1 };
  /* metal: a cor e a do proprio metal (o "col" do .p2m), nao a do STEP -- um pino cinza-claro do
     fabricante vira estanho de verdade; plastico mantem a cor do fabricante */
  p.color = M.metal ? new T.Color().setRGB(lin(M.cor[0]), lin(M.cor[1]), lin(M.cor[2])) : cor.clone();
  if (M.coat) { p.clearcoat = M.coat; p.clearcoatRoughness = M.coatRough; }
  if (k === 'brilho' || k === 'fosco' || k === 'epoxi') { p.specularIntensity = k === 'fosco' ? 0.35 : 0.6; }
  const gr = GRAO[k];
  if (gr) {
    const t = ruido(T, k, gr[0], gr[1]);
    if (gr[3] > 0) { p.bumpMap = t; p.bumpScale = gr[3]; }
    p.roughnessMap = t;   /* G do ruido: a rugosidade oscila em torno da do material */
    p.roughness = Math.min(1, M.rough * 2);   /* o three multiplica pelo G do mapa (media ~0,5): a media volta a ser a do material */
  }
  const m = new T.MeshPhysicalMaterial(p);
  if (gr) {
    m.userData.mapaCompartilhado = true;
    for (const k2 of ['bumpMap', 'roughnessMap']) if (m[k2]) { m[k2] = m[k2].clone(); m[k2].repeat.set(gr[2], gr[2]); m[k2].needsUpdate = true; }
  }
  m.userData.classe = k;
  return m;
}

/* ---------- o ambiente (HDRI do Blender) ---------- */
const AMB = new WeakMap();
let BASE = '';
export function base(b){ BASE = b || ''; }
async function leRgbe(T, nome){
  const r = await fetch(BASE + 'vendor/hdri/' + nome + '.rgbe');
  if (!r.ok) throw new Error('HDRI ' + nome + ': HTTP ' + r.status);
  const buf = await r.arrayBuffer();
  const dv = new DataView(buf);
  if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'RGBE') throw new Error('HDRI ' + nome + ': formato');
  const w = dv.getUint32(4, true), h = dv.getUint32(8, true);
  const px = new Uint8Array(buf, 12, w * h * 4);
  const out = new Uint16Array(w * h * 4);
  const um = T.DataUtils.toHalfFloat(1);
  for (let i = 0; i < w * h; i++) {
    const e = px[i * 4 + 3];
    const f = e ? Math.pow(2, e - 136) : 0;      /* 2^(e-128) / 256 */
    out[i * 4] = T.DataUtils.toHalfFloat(Math.min(65000, px[i * 4] * f));
    out[i * 4 + 1] = T.DataUtils.toHalfFloat(Math.min(65000, px[i * 4 + 1] * f));
    out[i * 4 + 2] = T.DataUtils.toHalfFloat(Math.min(65000, px[i * 4 + 2] * f));
    out[i * 4 + 3] = um;
  }
  const t = new T.DataTexture(out, w, h, T.RGBAFormat, T.HalfFloatType);
  t.mapping = T.EquirectangularReflectionMapping;
  t.colorSpace = T.LinearSRGBColorSpace;
  t.flipY = false;
  t.magFilter = T.LinearFilter; t.minFilter = T.LinearFilter;
  t.needsUpdate = true;
  return t;
}
export function ambiente(T, ren, nome){
  let porRen = AMB.get(ren);
  if (!porRen) { porRen = new Map(); AMB.set(ren, porRen); }
  if (porRen.has(nome)) return porRen.get(nome);
  const p = leRgbe(T, nome).then(eq => {
    const pm = new T.PMREMGenerator(ren);
    const rt = pm.fromEquirectangular(eq);
    pm.dispose(); eq.dispose();
    return rt.texture;
  });
  porRen.set(nome, p);
  p.catch(() => porRen.delete(nome));
  return p;
}

/* ---------- a placa: das cores que a vista pintou, os mapas PBR ----------
   A vista pinta a face com cores fixas (pcbframe.js » pintaFace3d, hub-fpeditor.js » cena3d):
   mascara, cobre sob a mascara, substrato onde a mascara abre sem cobre, metal exposto e
   serigrafia. Cada pixel vai para a classe da cor mais proxima e ganha cor real, rugosidade,
   metal, verniz (a mascara e um verniz sobre o cobre) e altura (o cobre levanta a mascara). */
const CLASSES = [
  /* [cores pintadas], cor real (sRGB), rugosidade, metal, verniz, altura */
  { de:['#1b6233', '#1d6b34', '#1d5e33'], cor:[0.06, 0.29, 0.15], rough:0.42, metal:0, coat:1, alt:60 },    /* mascara verde */
  { de:['#2c8446'],                       cor:[0.13, 0.42, 0.22], rough:0.38, metal:0, coat:1, alt:150 },   /* cobre sob a mascara */
  { de:['#b8a76f', '#c9b98a'],            cor:[0.78, 0.71, 0.52], rough:0.82, metal:0, coat:0, alt:0 },     /* FR4 exposto */
  { de:['#d9d6cf', '#d7d9de', '#d0d2d4'], cor:null,               rough:0.34, metal:1, coat:0, alt:140, pad:true },
  { de:['#f4f4f4', '#ffffff'],            cor:[0.93, 0.93, 0.90], rough:0.88, metal:0, coat:0, alt:200 },   /* serigrafia */
];
const ACABAMENTO = { hasl:[0.80, 0.81, 0.83], enig:[0.98, 0.80, 0.50], osp:[0.92, 0.58, 0.44] };
const hexRgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

export function mapasDaFace(T, canvas, acab){
  const w = canvas.width, h = canvas.height;
  const src = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const cC = mk(), cO = mk(), cK = mk(), cB = mk();
  const iC = cC.getContext('2d').createImageData(w, h), iO = cO.getContext('2d').createImageData(w, h);
  const iK = cK.getContext('2d').createImageData(w, h), iB = cB.getContext('2d').createImageData(w, h);
  const C = iC.data, O = iO.data, K = iK.data, B = iB.data;
  const metal = ACABAMENTO[acab] || ACABAMENTO.hasl;
  const pal = [];
  CLASSES.forEach((k, i) => { for (const d of k.de) pal.push([hexRgb(d), i]); });
  const cache = new Map();
  let semente = 1234567;
  const rnd = () => { semente = (semente * 1103515245 + 12345) & 0x7fffffff; return semente / 0x7fffffff; };
  for (let p = 0; p < w * h; p++) {
    const j = p * 4, a = src[j + 3];
    if (a < 8) { C[j + 3] = 0; O[j + 3] = 255; K[j + 3] = 255; B[j + 3] = 255; continue; }
    const r = src[j], g = src[j + 1], b = src[j + 2], ch = (r << 16) | (g << 8) | b;
    let ci = cache.get(ch);
    if (ci === undefined) {
      let best = 1e9; ci = 0;
      for (const [q, i] of pal) { const d = (q[0] - r) ** 2 + (q[1] - g) ** 2 + (q[2] - b) ** 2; if (d < best) { best = d; ci = i; } }
      cache.set(ch, ci);
    }
    const k = CLASSES[ci], cor = k.pad ? metal : k.cor;
    const ru = (rnd() - 0.5) * 0.06;                          /* a "casca de laranja" da mascara e do estanho */
    C[j] = Math.round(cor[0] * 255); C[j + 1] = Math.round(cor[1] * 255); C[j + 2] = Math.round(cor[2] * 255); C[j + 3] = 255;
    O[j] = 255; O[j + 1] = Math.max(0, Math.min(255, Math.round((k.rough + ru) * 255))); O[j + 2] = k.metal * 255; O[j + 3] = 255;
    K[j] = K[j + 1] = K[j + 2] = k.coat * 255; K[j + 3] = 255;
    B[j] = B[j + 1] = B[j + 2] = Math.max(0, Math.min(255, k.alt + Math.round((rnd() - 0.5) * 10))); B[j + 3] = 255;
  }
  cC.getContext('2d').putImageData(iC, 0, 0); cO.getContext('2d').putImageData(iO, 0, 0);
  cK.getContext('2d').putImageData(iK, 0, 0); cB.getContext('2d').putImageData(iB, 0, 0);
  const tx = (c, srgb) => { const t = new T.CanvasTexture(c); t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace; t.anisotropy = 8; return t; };
  return { map:tx(cC, true), orm:tx(cO, false), coat:tx(cK, false), bump:tx(cB, false) };
}

/* a borda da placa: o FR4 cortado, com a trama da fibra de vidro */
let tramaCv = null;
export function bordaFR4(T){
  if (!tramaCv) {
    tramaCv = document.createElement('canvas'); tramaCv.width = tramaCv.height = 64;
    const x = tramaCv.getContext('2d');
    x.fillStyle = '#c4b285'; x.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 64; i += 4) { x.fillStyle = i % 8 ? 'rgba(90,70,30,0.10)' : 'rgba(255,250,230,0.12)'; x.fillRect(0, i, 64, 2); x.fillRect(i, 0, 2, 64); }
  }
  const t = new T.CanvasTexture(tramaCv);
  t.colorSpace = T.SRGBColorSpace; t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(0.6, 0.6);
  return new T.MeshPhysicalMaterial({ map:t, roughness:0.78, metalness:0, color:0xffffff });
}
