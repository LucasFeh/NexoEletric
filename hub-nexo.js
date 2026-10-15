/* AltiumPCBMirror - hub-nexo.js
   O lado do navegador da integracao com o NexoCAD (contrato: docs/INTEGRACAO-NEXOCAD.md).

   A biblioteca compartilhada e o NEXO HUB (o banco da rede Nexo Hub, desde a 1.9.0): o hub a LE pelas
   rotas /api/nexo/* do hubserver (tools/rotas/nexocad.py), que a trazem do Nexo Hub no formato de
   sempre, e pede ao NexoCAD para gravar. Este modulo:
     - carrega o indice (cache; relido quando a `revisao` muda);
     - resolve o corpo 3D de um componente pela prioridade do contrato:
         `substitui` (troca so aquele corpo STEP, mesma matriz)
         > vinculo pelo footprint (item.eletronico.footprints: um corpo STEP na identidade do
           footprint, no lugar dos corpos que ele tinha)
         > as fontes de sempre do hub;
       a chave do cache de malha (IndexedDB) e `nexo:<id>@<rev>`: salvar no NexoCAD troca a malha;
     - consulta /api/nexo/revisao a cada 1,5 s, mas SO enquanto alguma vista registrou
       HubNexo.aoMudar(cb) (nada de EventSource: o limite de 6 conexoes por host do Chromium ja
       esta apertado, ver LIVE_JS no hubserver.py) e so com a aba visivel;
     - pede ao NexoCAD: editar um modelo / abrir um item / montar a placa.

   API (global HubNexo; em Node so a parte pura)
     HubNexo.carrega(forca) -> Promise<indice|null>     {revisao, existe, dir, itens}
     HubNexo.indice() -> o ultimo indice carregado (ou null)
     HubNexo.resolvedor() -> resolvedor do indice atual (ou null)
     HubNexo.resolvedorDe(indice) -> {porChave(chave), porFootprint(nome), porId(id), item(id)}
         cada um devolve {id, rev, nome, url:'/api/nexo/arquivo/<id>/modelo.step?rev=<rev>',
         chave:'nexo:<id>@<rev>', item} ou null
     HubNexo.resolveCorpo(body, footprint, res?) -> {url, chave, id, por:'substitui'|'id'} | null
         body = um corpo STEP com `modeloChave` (o `file` do modelo: '3d-hub/<sha>.step',
         '3d/<checksum>.step', 'projeto:<p>/<arquivo>' ou 'nexo:<id>')
     HubNexo.porFootprint(nome, res?) -> o item vinculado ao footprint (ou null)
     HubNexo.itens(categoria?) -> itens do indice (padrao: Eletronicos)
     HubNexo.thumb(id) / HubNexo.urlStep(id)
     HubNexo.aoMudar(cb) -> desliga()                   cb(indice) quando a revisao muda
     HubNexo.editar({chave, url, nome, footprint, geometria?} | {id} | {novo:true, footprint, nome, geometria?}, {toast})
         -> Promise<resposta>   (geometria: HubNexo.geometriaDe(fp) / geometriaDeComp(comp))
     HubNexo.geometriaDe(fp) / geometriaDeComp(comp) -> {pads:[{nome,x,y,w,h,rot,forma,furo}], contorno} (local)
     HubNexo.enviarPlaca(pacote, {toast}) -> Promise<resposta>
     HubNexo.estado() -> Promise<{ok, dir, existe, revisao, nexocad:{aberto, versao, exe}}> */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HubNexo = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
'use strict';

const API = '/api/nexo/';
const PERIODO = 1500;
const CATEGORIA = 'Eletrônicos';
const tem = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const urlStep = id => API + 'arquivo/' + encodeURIComponent(id) + '/modelo.step';
const thumb = (id, v) => API + 'arquivo/' + encodeURIComponent(id) + '/thumb.png' + (v ? '?v=' + encodeURIComponent(v) : '');

/* ---------- puro: o indice -> o resolvedor ---------- */
function infoDe(it){
  if (!it || !it.id) return null;
  const a = it.arquivos || {};
  if (tem(it, 'arquivos') && !a.step) return null;          /* item sem STEP gerado: nada a desenhar */
  const rev = it.rev == null ? 0 : it.rev;
  /* ?rev=: a malha da revisao certa, mesmo com o cache do navegador */
  return { id:it.id, rev, nome:it.nome || it.id, url:urlStep(it.id) + '?rev=' + rev, chave:'nexo:' + it.id + '@' + rev, item:it };
}
function resolvedorDe(ind){
  const porId = new Map(), porChave = new Map(), porFp = new Map();
  for (const it of ((ind && ind.itens) || [])) {
    const inf = infoDe(it);
    if (!inf) continue;
    porId.set(it.id, inf);
    for (const k of (it.substitui || [])) if (k && !porChave.has(k)) porChave.set(String(k), inf);
    const el = it.eletronico;
    if (el && Array.isArray(el.footprints) && semAcento(it.categoria) === semAcento(CATEGORIA)) {
      for (const f of el.footprints) if (f && !porFp.has(String(f))) porFp.set(String(f), inf);
    }
  }
  return {
    revisao:ind && ind.revisao,
    porChave:k => (k && porChave.get(String(k))) || null,
    porFootprint:n => (n && porFp.get(String(n))) || null,
    porId:id => (id && porId.get(String(id))) || null,
    item:id => { const i = id && porId.get(String(id)); return i ? i.item : null; },
  };
}

/* ---------- a geometria do footprint para o esboco do NexoCAD ----------
   {pads:[{nome, x, y, w, h, rot, forma, furo}], contorno?:[[x,y]...]} em mm, no referencial LOCAL
   do footprint (origem dele, Y para cima, vista de cima). geometriaDe(fp) para o footprint da
   biblioteca (pads ja locais); geometriaDeComp(comp) desfaz a pose do componente da placa (a
   convencao do HubCore: Bottom = O + R(r) . Sy . local). */
const r4 = v => { const x = Math.round(v * 1e4) / 1e4; return x === 0 ? 0 : x; };
const FORMA = { rect:'rect', round:'circle', circle:'circle', oval:'oval', roundrect:'roundrect', octagon:'rect' };
function padGeo(p, x, y, rot){
  return { nome:String(p.name == null ? '' : p.name), x:r4(x), y:r4(y), w:r4(+p.w || 0), h:r4(+p.h || 0),
           rot:r4((((rot || 0) % 360) + 360) % 360), forma:FORMA[p.shape] || 'rect', furo:r4(+p.drill > 0 ? +p.drill : 0) };
}
function caixaDe(pts){
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const q of pts) { if (q[0] < x1) x1 = q[0]; if (q[0] > x2) x2 = q[0]; if (q[1] < y1) y1 = q[1]; if (q[1] > y2) y2 = q[1]; }
  return isFinite(x1) ? [[r4(x1), r4(y1)], [r4(x2), r4(y1)], [r4(x2), r4(y2)], [r4(x1), r4(y2)]] : null;
}
function cantos(g){
  const a = g.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), w = g.w / 2, h = g.h / 2;
  return [[-w, -h], [w, -h], [w, h], [-w, h]].map(([u, v]) => [g.x + u * c - v * s, g.y + u * s + v * c]);
}
function geometriaDe(fp){
  if (!fp) return null;
  const pads = (fp.pads || []).filter(p => p && isFinite(p.x) && isFinite(p.y)).map(p => padGeo(p, p.x, p.y, p.rot));
  if (!pads.length) return null;
  const pts = [];
  for (const g of pads) pts.push(...cantos(g));
  for (const o of (fp.silk || [])) if (o && isFinite(o.x1)) pts.push([o.x1, o.y1], [o.x2, o.y2]);
  const geo = { pads };
  const k = caixaDe(pts); if (k) geo.contorno = k;
  return geo;
}
function geometriaDeComp(c){
  if (!c) return null;
  const ox = +c.x || 0, oy = +c.y || 0, r = +c.rot || 0, baixo = String(c.layer || c.side || '').toLowerCase() === 'bottom';
  const a = -r * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
  const local = (x, y) => { const dx = x - ox, dy = y - oy; const u = dx * cs - dy * sn, v = dx * sn + dy * cs; return [u, baixo ? -v : v]; };
  const pads = (c.pads || []).filter(p => p && isFinite(p.x) && isFinite(p.y)).map(p => {
    const q = local(p.x, p.y);
    return padGeo(p, q[0], q[1], baixo ? r - (+p.rot || 0) : (+p.rot || 0) - r);
  });
  if (!pads.length) return null;
  const pts = [];
  for (const g of pads) pts.push(...cantos(g));
  const geo = { pads };
  const k = caixaDe(pts); if (k) geo.contorno = k;
  return geo;
}

/* ---------- estado do navegador ---------- */
let IND = null, RES = null, REV = null, carregando = null;
const ouvintes = new Set();
let timer = 0, consultando = false;

function indice(){ return IND; }
function resolvedor(){ return RES; }
function resolveCorpo(body, footprint, res){
  const R = res || RES;
  if (!R || !body) return null;
  const k = body.modeloChave || '';
  if (/^nexo:/.test(k)) { const i = R.porId(k.slice(5)); return i ? Object.assign({ por:'id' }, i) : null; }
  const i = R.porChave(k);
  return i ? Object.assign({ por:'substitui' }, i) : null;
}
function porFootprint(nome, res){ const R = res || RES; return R ? R.porFootprint(nome) : null; }
function itens(categoria){
  const L = (IND && IND.itens) || [];
  if (categoria === '*') return L.slice();
  const c = semAcento(categoria || CATEGORIA);
  return L.filter(i => semAcento(i.categoria) === c);
}

async function pegaJson(url, opcoes){
  const r = await fetch(url, Object.assign({ cache:'no-store' }, opcoes || {}));
  let j = null; try { j = await r.json(); } catch (e) { /* sem corpo */ }
  if (!j) throw new Error('o hub não respondeu ' + url.replace(/\?.*$/, '') + ' (HTTP ' + r.status + ')' + (r.status === 404 ? ' — reinicie o servidor do hub' : ''));
  return j;
}
function carrega(forca){
  if (typeof fetch === 'undefined') return Promise.resolve(IND);
  if (IND && !forca) return Promise.resolve(IND);
  if (carregando) return carregando;
  carregando = (async () => {
    try {
      const j = await pegaJson(API + 'biblioteca?categoria=*');
      IND = { revisao:j.revisao || 0, existe:!!j.existe, dir:j.dir || '', categorias:j.categorias || [], itens:Array.isArray(j.itens) ? j.itens : [] };
      RES = resolvedorDe(IND);
      REV = IND.revisao;
    } catch (e) {
      if (!IND) { IND = { revisao:0, existe:false, dir:'', categorias:[], itens:[], erro:String(e && e.message || e) }; RES = resolvedorDe(IND); }
    } finally { carregando = null; }
    return IND;
  })();
  return carregando;
}

/* ---------- a consulta da revisao (so com alguem ouvindo) ---------- */
async function consulta(){
  if (consultando) return;
  if (typeof document !== 'undefined' && document.hidden) return;
  consultando = true;
  try {
    const j = await pegaJson(API + 'revisao');
    const rev = j && j.revisao != null ? j.revisao : 0;
    if (REV === null) { await carrega(); }
    else if (rev !== REV) {
      await carrega(true);
      for (const cb of Array.from(ouvintes)) { try { cb(IND); } catch (e) { if (root.console) console.warn('HubNexo.aoMudar', e); } }
    }
  } catch (e) { /* hub fora: tenta de novo no proximo tique */ }
  finally { consultando = false; }
}
function liga(){ if (!timer && typeof setInterval !== 'undefined') timer = setInterval(consulta, PERIODO); }
function desliga(){ if (timer && !ouvintes.size) { clearInterval(timer); timer = 0; } }
function aoMudar(cb){
  if (typeof cb !== 'function') return () => {};
  ouvintes.add(cb); liga();
  return () => { ouvintes.delete(cb); desliga(); };
}

/* ---------- pedidos ao NexoCAD ---------- */
function avisa(o, t, tipo, ms){
  const f = (o && o.toast) || (root.HubDialog && root.HubDialog.toast) || (typeof root.toast === 'function' ? root.toast : null);
  if (f) { try { f(t, tipo, ms); return; } catch (e) { /* segue */ } }
  if (root.console) console.log('[NexoCAD] ' + t);
}
async function posta(rota, corpo){
  return pegaJson(API + rota, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(corpo) });
}
async function editar(alvo, opcoes){
  alvo = alvo || {};
  let corpo;
  if (alvo.id) corpo = { id:alvo.id };
  else {
    /* a chave que um item ja substitui: abre o item direto (o servidor faz o mesmo) */
    const i = RES && alvo.chave ? (RES.porChave(alvo.chave) || (/^nexo:/.test(alvo.chave) ? RES.porId(alvo.chave.slice(5)) : null)) : null;
    if (i) corpo = { id:i.id };
    else if (alvo.url) corpo = { chave:alvo.chave || '', url:alvo.url, nome:alvo.nome || '', footprint:alvo.footprint || '' };
    else corpo = { novo:true, chave:alvo.chave || '', nome:alvo.nome || alvo.footprint || '', footprint:alvo.footprint || '' };
    if (alvo.categoria) corpo.categoria = alvo.categoria;
    if (alvo.geometria && !corpo.id) corpo.geometria = alvo.geometria;
  }
  avisa(opcoes, corpo.novo ? 'Criando o modelo no NexoCAD…' : 'Abrindo no NexoCAD…', 'info', 2500);
  let j;
  try { j = await posta('editar', corpo); }
  catch (e) { avisa(opcoes, 'NexoCAD: ' + (e && e.message || e), 'err', 6000); return { ok:false, error:String(e && e.message || e) }; }
  if (!j.ok) { avisa(opcoes, 'NexoCAD: ' + (j.error || 'não abriu'), 'err', 6000); return j; }
  const nome = (j.result && j.result.nome) || alvo.nome || '';
  avisa(opcoes, '✔ Enviado ao NexoCAD' + (nome ? ': ' + String(nome).replace(/\.(step|stp)$/i, '') : '') + (j.criado ? ' (novo na biblioteca)' : '') +
    ' — a janela do NexoCAD abriu com o item; salve lá (Ctrl+S) e o 3D daqui se atualiza', 'ok', 6000);
  return j;
}
async function enviarPlaca(pacote, opcoes){
  avisa(opcoes, 'Enviando a placa ao NexoCAD…', 'info', 3000);
  let j;
  try { j = await posta('placa', { pacote }); }
  catch (e) { avisa(opcoes, 'NexoCAD: ' + (e && e.message || e), 'err', 6000); return { ok:false, error:String(e && e.message || e) }; }
  if (!j.ok) { avisa(opcoes, 'NexoCAD: ' + (j.error || 'não montou a placa'), 'err', 6000); return j; }
  const av = (j.avisos || []).length;
  avisa(opcoes, 'Placa montada no NexoCAD' + (av ? ' (' + av + ' modelo(s) 3D não foram: ' + j.avisos.slice(0, 2).join('; ') + ')' : ''), av ? 'warn' : 'ok', av ? 7000 : 4000);
  return j;
}
function estado(){ return pegaJson(API + 'estado'); }

return { API, CATEGORIA, urlStep, thumb, resolvedorDe, infoDe, geometriaDe, geometriaDeComp, carrega, indice, resolvedor, resolveCorpo, porFootprint, itens,
         aoMudar, editar, enviarPlaca, estado, _consulta:consulta };
});
