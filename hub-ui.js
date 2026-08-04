/* AltiumPCBMirror v2 - hub-ui.js — logica do shell (Projetos + Libs + tabs). */
"use strict";
(function(){

const PROJECTS = (typeof projects !== 'undefined' && Array.isArray(projects)) ? projects : [];
let current = null;          // nome do projeto aberto
let schlibData = null, pcblibData = null, libsLoading = null;

/* ---------- carregamento dinamico de "var X = ..." via <script> (funciona em file://) ---------- */
function loadVarScript(src, name){
  return new Promise(resolve => {
    window[name] = undefined;
    const s = document.createElement('script');
    s.src = src;
    s.onload  = () => { const v = window[name]; window[name] = undefined; s.remove(); resolve(v); };
    s.onerror = () => { s.remove(); resolve(undefined); };
    document.head.appendChild(s);
  });
}
function loadLibs(){
  if (schlibData) return Promise.resolve();
  if (libsLoading) return libsLoading;
  libsLoading = Promise.all([
    loadVarScript('Libs/schlib.js', 'schlib'),
    loadVarScript('Libs/pcblib.js', 'pcblib')
  ]).then(([s, p]) => { schlibData = s || { symbols:[] }; pcblibData = p || { footprints:[] }; });
  return libsLoading;
}

/* ---------- tabs ---------- */
const views = { projects:'view-projects', sch:'view-sch', pcb:'view-pcb', libs:'view-libs' };
function showView(v){
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.v === v));
  for (const k in views) document.getElementById(views[k]).classList.toggle('active', k === v);
  if (v === 'libs') loadLibs().then(buildLibList);
}
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => showView(t.dataset.v)));

/* ---------- Projetos ---------- */
const STEP_ORDER = ['esquema', 'eco', 'roteada', 'aplicada'];
function stepsHtml(status){
  const idx = STEP_ORDER.indexOf(status);
  return '<div class="steps">' + STEP_ORDER.map((s, i) =>
    `<span class="step ${i < idx ? 'done' : i === idx ? 'cur' : ''}">${s}</span>`).join('') + '</div>';
}
function openProject(name, view){
  current = name;
  document.getElementById('curproj').textContent = 'projeto: ' + name;
  document.getElementById('schframe').src = 'schframe.html?p=' + encodeURIComponent(name);
  document.getElementById('pcbframe').src = 'pcbframe.html?p=' + encodeURIComponent(name);
  showView(view || 'sch');
}
function buildCards(){
  const wrap = document.getElementById('cards');
  wrap.innerHTML = '';
  if (!PROJECTS.length)
    wrap.innerHTML = '<div style="color:var(--fg-dim)">Nenhum projeto em Projects\\ — rode um Export no Altium ou peça um projeto novo à IA.</div>';
  for (const p of PROJECTS) {
    const card = document.createElement('div');
    card.className = 'card';
    const demo = p.name.charAt(0) === '_' ? '<span class="badge">DEMO</span>' : '';
    card.innerHTML = `<h3>${p.name} ${demo}</h3>` +
      stepsHtml(HubCore.deriveStatus(p)) +
      `<div class="info" id="info-${p.name}">carregando resumo…</div>` +
      `<div class="actions">
         <button data-a="sch">Esquema</button>
         <button data-a="pcb">PCB</button>
       </div>`;
    card.querySelector('[data-a="sch"]').addEventListener('click', () => openProject(p.name, 'sch'));
    card.querySelector('[data-a="pcb"]').addEventListener('click', () => openProject(p.name, 'pcb'));
    wrap.appendChild(card);
    fillCardInfo(p);
  }
}
async function fillCardInfo(p){
  const el = document.getElementById('info-' + p.name);
  const parts = [];
  let changesCount = 0;
  if (p.files && p.files.schematic) {
    const sch = await loadVarScript('Projects/' + p.name + '/schematic.js', 'schematic');
    if (sch) {
      await loadLibs();
      const model = HubCore.buildSchModel(sch);
      const nets = HubCore.extractNets(model, schlibData);
      const nc = model.sheets.reduce((n, s) => n + s.comps.length, 0);
      parts.push(`esquema: ${model.sheets.length} folha(s), ${nc} comps, ${nets.nets.length} nets`);
    }
  }
  if (p.files && p.files.board) {
    const b = await loadVarScript('Projects/' + p.name + '/board.js', 'pcbmirror');
    if (b && b.stats) parts.push(`pcb: ${b.stats.components} comps, ${b.stats.tracks} trilhas, ${b.stats.vias} vias`);
  }
  if (p.files && p.files.changes) {
    const ch = await loadVarScript('Projects/' + p.name + '/changes.js', 'changes');
    changesCount = Array.isArray(ch) ? ch.length : 0;
    if (changesCount) parts.push(`mudanças pendentes: ${changesCount}`);
  }
  el.textContent = parts.join('\n') || 'sem dados ainda';
  const card = el.closest('.card');
  card.querySelector('.steps').outerHTML = stepsHtml(HubCore.deriveStatus(p, { changesCount }));
}

/* ---------- Libs ---------- */
let libSel = null, camSym = null, camFp = null, curFp = null;
function libItems(){
  const q = (document.getElementById('libsearch').value || '').toLowerCase();
  const syms = (schlibData.symbols || []).filter(s => !q || s.name.toLowerCase().includes(q) || (s.description||'').toLowerCase().includes(q));
  const fps  = (pcblibData.footprints || []).filter(f => !q || f.name.toLowerCase().includes(q) || (f.description||'').toLowerCase().includes(q));
  return { syms, fps };
}
function buildLibList(){
  const { syms, fps } = libItems();
  const list = document.getElementById('liblist');
  list.innerHTML = `<div class="libitem" style="color:var(--fg-dim)">— SÍMBOLOS (${syms.length}) —</div>`;
  for (const s of syms) {
    const div = document.createElement('div');
    div.className = 'libitem' + (libSel === 's:' + s.name ? ' sel' : '');
    const noFp = !(s.footprints || []).some(f => f.incurrentlib);
    div.innerHTML = s.name + (noFp ? ' <span class="miss">✖ sem footprint</span>' : '');
    div.addEventListener('click', () => { libSel = 's:' + s.name; buildLibList(); showSymbol(s); });
    list.appendChild(div);
  }
  const t = document.createElement('div');
  t.className = 'libitem'; t.style.color = 'var(--fg-dim)';
  t.textContent = `— FOOTPRINTS (${fps.length}) —`;
  list.appendChild(t);
  for (const f of fps) {
    const div = document.createElement('div');
    div.className = 'libitem' + (libSel === 'f:' + f.name ? ' sel' : '');
    div.textContent = f.name;
    div.addEventListener('click', () => { libSel = 'f:' + f.name; buildLibList(); showFootprint(f); });
    list.appendChild(div);
  }
  const missing = (schlibData.symbols || []).filter(s => !(s.footprints || []).some(f => f.incurrentlib));
  document.getElementById('libwarn').textContent = missing.length
    ? '✖ símbolos sem footprint na PcbLib (a IA define no schematic.js): ' + missing.map(s => s.name).join(', ')
    : '✓ todos os símbolos têm footprint associado';
}
function ensureCams(){
  if (!camSym) {
    camSym = HubDraw.mkCamera(document.getElementById('cvsym'), (ctx) => {
      if (!showSymbol.cur) return;
      HubDraw.drawSymbolPart(ctx, showSymbol.cur);
    }, { bg:'#fffef2' });
    camFp = HubDraw.mkCamera(document.getElementById('cvfp'), (ctx) => {
      if (curFp) HubDraw.drawFootprint(ctx, curFp);
    }, { bg:'#1b1b1b' });
    camSym.resize(); camFp.resize();
  }
}
function showSymbol(sym){
  ensureCams();
  const part = HubCore.partOf(sym, 1) || { pins:[], graphics:[] };
  showSymbol.cur = part;
  document.getElementById('symtitle').textContent =
    `símbolo: ${sym.name} (${sym.partcount} parte${sym.partcount > 1 ? 's' : ''}) — ${sym.description || ''}`;
  camSym.resize(); camSym.fit(HubDraw.symBBox(part), 1.4);
  const cur = (sym.footprints || []).find(f => f.current) || (sym.footprints || [])[0];
  const fp = cur && HubCore.footprintOf(pcblibData, cur.name);
  curFp = fp || null;
  document.getElementById('fptitle').textContent = fp
    ? `footprint associado: ${fp.name}` : 'footprint: (nenhum associado na lib)';
  camFp.resize();
  if (fp) camFp.fit(fp.bbox, 1.5); else camFp.draw();
}
function showFootprint(fp){
  ensureCams();
  showSymbol.cur = null;
  curFp = fp;
  document.getElementById('symtitle').textContent = 'símbolo: —';
  document.getElementById('fptitle').textContent = `footprint: ${fp.name} — ${fp.description || ''}`;
  camSym.resize(); camSym.draw();
  camFp.resize(); camFp.fit(fp.bbox, 1.5);
}
document.getElementById('libsearch').addEventListener('input', buildLibList);

/* ---------- reload escopado do hubserver (nao perde trabalho nao salvo nos iframes) ---------- */
window.__hubOnChange = function () {
  let dirty = false;
  document.querySelectorAll('iframe').forEach(f => {
    try { if (f.contentWindow && f.contentWindow.__hubAnnDirty && f.contentWindow.__hubAnnDirty()) dirty = true; } catch (e) {}
  });
  if (!dirty) { location.reload(); return; }
  let b = document.getElementById('stalebanner');
  if (!b) {
    b = document.createElement('div');
    b.id = 'stalebanner';
    b.style.cssText = 'position:fixed; top:0; left:0; right:0; z-index:99; background:#5d4037; color:#ffe0b2; padding:6px 14px; font-size:13px; text-align:center;';
    document.body.appendChild(b);
  }
  b.textContent = '⚠ o workspace mudou no disco — há sinalizadores não salvos numa vista; salve-os e recarregue (F5)';
};

/* ---------- init ---------- */
buildCards();

})();
