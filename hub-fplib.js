/* AltiumPCBMirror - hub-fplib.js
   A biblioteca de footprints DO HUB: o que o editor de footprint (hub-fpeditor.js, o "PCB Library"
   do Altium) cria ou altera. Mora em Libs/pcblib-hub.js, AO LADO do espelho do Altium
   (Libs/pcblib.js, que continua so leitura e igual): um footprint do hub com o MESMO nome de um do
   Altium passa na frente dele (mescla), e o resto do Altium segue valendo.

   Formato (o do pcblib.js, mais os corpos 3D no contrato do pcblib-3d.js):
     var pcblibHub = {format:'pcblib-hub-v1', units:'mm',
       footprints:[{name, description, bbox, pads:[...], silk:[...], bodies:[...], solda?,
                    hub:{criado, editado, base}}],          base = o footprint do Altium de onde saiu
       models:{<id>:{file:'3d-hub/<id>.step', name, bytes}}}
   pads/silk/bbox: mm em torno da origem do footprint, rot 0, Top -- o mesmo do pcblib.js.
   bodies (LOCAIS ao footprint, o HubPcb3dModelo.corpos os poe no lugar do componente):
     {kind:'step', model:<id>, name, side:'top', raw:{x2d, y2d, rot2d:0, rotx, roty, rotz, dz}, color, opacity}
     {kind:'extruded', side:'top', pts:[[x,y]...], standoff, height, color, opacity}
     {kind:'cylinder', radius, height, raw:{...}, color} | {kind:'sphere', radius, raw:{...}, color}
   solda: true = no 3D o pino so aparece do lado do componente, e na outra face cada pad passante
   ganha o ponto de solda (o cone de estanho do HubPcb3dVista). Ausente = o pino atravessa, como antes.
   O STEP sobe por POST /api/fp3d (hubserver) e fica em Libs/3d-hub/<sha1>.step.

   Puro onde da (node: tests/test-fplib.js); carrega/grava/sobeStep so no navegador.
   API (global HubFpLib)
     vazia() normaliza(lib) acha(lib, nome) poe(lib, fp) tira(lib, nome)
     mescla(pcblibAltium, hub) -> pcblib     (o do hub na frente, mesmo nome)
     lib3d(hub) -> {footprints:{nome:{bodies}}, models}   para HubPcb3dModelo.corpos(.., {pcblib3dHub})
     bbox(fp) copia(fp) novo(nome) valida(fp) -> [erros] serializa(lib) -> texto
     carrega() grava(lib) sobeStep(arquivo|ArrayBuffer, nome)            (navegador) */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HubFpLib = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
'use strict';

const FORMATO = 'pcblib-hub-v1';
const ARQUIVO = 'Libs/pcblib-hub.js';
const isNum = v => typeof v === 'number' && isFinite(v);
const r4 = v => { const x = Math.round(v * 1e4) / 1e4; return x === 0 ? 0 : x; };

function vazia(){ return { format:FORMATO, units:'mm', footprints:[], models:{} }; }
function normaliza(lib){
  const o = (lib && typeof lib === 'object') ? lib : vazia();
  if (!Array.isArray(o.footprints)) o.footprints = [];
  if (!o.models || typeof o.models !== 'object') o.models = {};
  o.format = FORMATO; o.units = 'mm';
  return o;
}
/* type "npth" -> o que o board.js usa: type "th" com plated:false, na Multi; sem w/h, o pad e o
   proprio furo. Devolve o footprint (o mesmo objeto). */
function normalizaPads(fp){
  for (const p of ((fp && fp.pads) || [])) {
    if (!p || p.type !== 'npth') continue;
    p.type = 'th'; p.plated = false; p.layer = 'Multi';
    if (!isNum(p.w)) p.w = p.drill;
    if (!isNum(p.h)) p.h = p.drill;
    if (!p.shape) p.shape = 'circle';
  }
  return fp;
}
function acha(lib, nome){ return ((lib && lib.footprints) || []).find(f => f && f.name === nome) || null; }
function poe(lib, fp){
  normaliza(lib);
  const i = lib.footprints.findIndex(f => f && f.name === fp.name);
  if (i >= 0) lib.footprints[i] = fp; else lib.footprints.push(fp);
  lib.footprints.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return lib;
}
function tira(lib, nome){
  normaliza(lib);
  lib.footprints = lib.footprints.filter(f => f && f.name !== nome);
  /* modelo que ninguem mais usa sai do indice (o arquivo fica: outro projeto pode apontar) */
  const usados = new Set();
  for (const f of lib.footprints) for (const b of (f.bodies || [])) if (b && b.model) usados.add(b.model);
  for (const k of Object.keys(lib.models)) if (!usados.has(k)) delete lib.models[k];
  return lib;
}

/* o pcblib que o resto do hub le: os do hub na frente, os do Altium que nao foram sobrepostos atras */
function mescla(altium, hub){
  const h = ((hub && hub.footprints) || []).filter(f => f && f.name);
  if (!h.length) return altium || { format:'pcblib-v2', units:'mm', footprints:[] };
  const nomes = new Set(h.map(f => f.name));
  const base = altium || { format:'pcblib-v2', units:'mm' };
  return Object.assign({}, base, {
    footprints:h.concat(((base.footprints) || []).filter(f => f && !nomes.has(f.name))),
    hub:{ footprints:h.length },
  });
}
function lib3d(hub){
  const fps = {};
  for (const f of ((hub && hub.footprints) || [])) {
    if (!f || !f.name) continue;
    const temCorpo = Array.isArray(f.bodies) && f.bodies.length;
    /* solda:true -- o pino so do lado do componente, o ponto de solda na outra face (HubPcb3dModelo).
       Vale tambem sem corpo proprio: o corpo continua vindo do PcbDoc ou da biblioteca */
    if (temCorpo || f.solda) fps[f.name] = Object.assign({ bodies:temCorpo ? f.bodies : [] }, f.solda ? { solda:true } : {});
  }
  return { format:'pcblib3d-v1', footprints:fps, models:(hub && hub.models) || {} };
}

/* ---------- geometria ---------- */
function cantosPad(p){
  const a = (p.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), w = (p.w || 0) / 2, h = (p.h || 0) / 2;
  return [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => [p.x + x * c - y * s, p.y + x * s + y * c]);
}
function bbox(fp){
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  const add = (x, y) => { if (x < x1) x1 = x; if (y < y1) y1 = y; if (x > x2) x2 = x; if (y > y2) y2 = y; };
  for (const p of (fp.pads || [])) if (p && isNum(p.x)) for (const q of cantosPad(p)) add(q[0], q[1]);
  for (const s of (fp.silk || [])) {
    if (!s) continue;
    const m = (s.w || 0) / 2;
    if (s.kind === 'arc') { add(s.cx - s.r - m, s.cy - s.r - m); add(s.cx + s.r + m, s.cy + s.r + m); }
    else if (isNum(s.x1)) { add(s.x1 - m, s.y1 - m); add(s.x2 + m, s.y2 + m); add(s.x1 + m, s.y1 + m); add(s.x2 - m, s.y2 - m); }
  }
  if (!isFinite(x1)) return { x1:-0.5, y1:-0.5, x2:0.5, y2:0.5 };
  return { x1:r4(x1), y1:r4(y1), x2:r4(x2), y2:r4(y2) };
}
const copia = fp => JSON.parse(JSON.stringify(fp));
function novo(nome){ return { name:nome || 'NOVO_FOOTPRINT', description:'', pads:[], silk:[], bodies:[] }; }

const FORMAS = ['rect', 'round', 'circle', 'oval', 'roundrect', 'octagon'];
function valida(fp){
  const e = [];
  if (!fp || typeof fp !== 'object') return ['footprint vazio'];
  if (!fp.name || !String(fp.name).trim()) e.push('o footprint precisa de um nome');
  if (/["\\\n]/.test(String(fp.name || ''))) e.push('o nome não pode ter aspas, barra invertida nem quebra de linha');
  const vistos = new Map();
  (fp.pads || []).forEach((p, i) => {
    const q = 'pad ' + (p && p.name ? p.name : '#' + (i + 1));
    if (!p) { e.push(q + ': vazio'); return; }
    for (const k of ['x', 'y', 'w', 'h']) if (!isNum(p[k])) e.push(q + ': ' + k + ' inválido');
    if (isNum(p.w) && p.w <= 0 || isNum(p.h) && p.h <= 0) e.push(q + ': tamanho tem que ser maior que zero');
    /* FURO SEM COBRE (NPTH): type "th" com plated:false (o que o board.js e o Gerber usam) ou o
       atalho type "npth" (normalizaPads converte). Ele pode ter o pad do tamanho do furo, ou menor:
       nao ha anel. O metalizado precisa de anel -- furo IGUAL ao pad tambem e erro (a mensagem
       dizia "maior" para um furo de 3,4 num pad de 3,4). */
    const semCobre = p.type === 'npth' || (p.type === 'th' && p.plated === false);
    if ((p.type === 'th' || p.type === 'npth') && !(p.drill > 0)) e.push(q + (semCobre ? ': furo sem cobre sem "drill"' : ': pad passante sem furo'));
    if (p.type === 'th' && !semCobre && p.drill > 0 && p.drill >= Math.min(p.w, p.h))
      e.push(q + (p.drill > Math.min(p.w, p.h) ? ': o furo é maior que o pad' : ': o furo é do tamanho do pad (pad metalizado precisa de anel)') + ' — furo sem cobre: type "npth" (ou plated:false)');
    if (FORMAS.indexOf(p.shape) < 0) e.push(q + ': forma "' + p.shape + '" desconhecida');
    const n = String(p.name || '');
    if (n) vistos.set(n, (vistos.get(n) || 0) + 1);
  });
  /* designador repetido e permitido (o Altium deixa: dois pads do mesmo terminal), so avisa */
  (fp.bodies || []).forEach((b, i) => {
    const q = 'corpo 3D #' + (i + 1);
    if (!b) { e.push(q + ': vazio'); return; }
    if (b.kind === 'extruded' && (!Array.isArray(b.pts) || b.pts.length < 3)) e.push(q + ': contorno com menos de 3 pontos');
    if (b.kind === 'extruded' && !(b.height > (b.standoff || 0))) e.push(q + ': a altura total tem que passar da altura da base');
    if (b.kind === 'step' && !b.model) e.push(q + ': sem o arquivo STEP');
    if ((b.kind === 'cylinder' || b.kind === 'sphere') && !(b.radius > 0)) e.push(q + ': raio inválido');
  });
  return e;
}
function repetidos(fp){
  const c = new Map();
  for (const p of (fp.pads || [])) if (p && p.name) c.set(String(p.name), (c.get(String(p.name)) || 0) + 1);
  return [...c].filter(([, n]) => n > 1).map(([k]) => k);
}

/* uma linha por footprint, como o ExportLibs do pcblib.js: diff legivel no git e na mao */
function serializa(lib){
  const L = normaliza(JSON.parse(JSON.stringify(lib)));
  for (const f of L.footprints) { f.bbox = bbox(f); if (!Array.isArray(f.bodies)) f.bodies = []; }
  /* o `name` PRIMEIRO na linha: o servidor acha o footprint pelo primeiro {"name": da linha
     (symserver.py » _nomes_lib), e os pads tambem tem `name` */
  const fps = L.footprints.map(f => JSON.stringify(Object.assign({ name:f.name }, f)));
  return 'var pcblibHub = {\n"format":' + JSON.stringify(FORMATO) + ',\n"units":"mm",\n"generated":' +
    JSON.stringify(new Date().toISOString()) + ',\n"models":' + JSON.stringify(L.models) + ',\n"footprints":[\n' +
    fps.join('\n,') + '\n]};\n';
}

/* ---------- navegador ---------- */
function carregaScript(src){
  return new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = src + (src.indexOf('?') < 0 ? '?t=' : '&t=') + Date.now();
    s.onload = () => { s.remove(); ok(); }; s.onerror = () => { s.remove(); falha(new Error('sem ' + src)); };
    document.head.append(s);
  });
}
async function carrega(){
  try { delete root.pcblibHub; } catch (e) { root.pcblibHub = undefined; }
  try { await carregaScript(ARQUIVO); } catch (e) { /* ainda nao existe: biblioteca vazia */ }
  return normaliza(typeof root.pcblibHub !== 'undefined' ? root.pcblibHub : null);
}
async function grava(lib){
  if (typeof HubIO === 'undefined') throw new Error('HubIO não carregado');
  const r = await HubIO.saveFile(ARQUIVO, serializa(lib));
  root.pcblibHub = normaliza(lib);
  return r;
}
async function sobeStep(arq, nome){
  const buf = arq instanceof ArrayBuffer ? arq : await arq.arrayBuffer();
  const cab = String.fromCharCode.apply(null, new Uint8Array(buf.slice(0, 64)));
  if (!/ISO-10303-21/.test(cab)) throw new Error('o arquivo não é STEP (não começa com ISO-10303-21)');
  const r = await fetch('/api/fp3d', { method:'POST', headers:{ 'Content-Type':'application/octet-stream',
    'X-Nome':encodeURIComponent(nome || (arq && arq.name) || 'modelo.step') }, body:buf });
  let j = null; try { j = await r.json(); } catch (e) { /* sem corpo */ }
  if (!j || !j.ok) throw new Error((j && j.error) || ('o servidor recusou o STEP (HTTP ' + r.status + ')' + (r.status === 404 ? ' — reinicie o hubserver.py' : '')));
  return { id:j.id, file:j.file, name:j.name, bytes:j.bytes, buffer:buf };
}

return { FORMATO, ARQUIVO, FORMAS, vazia, normaliza, acha, poe, tira, mescla, lib3d, bbox, cantosPad, copia, novo,
         valida, normalizaPads, repetidos, serializa, carrega, grava, sobeStep };
});
