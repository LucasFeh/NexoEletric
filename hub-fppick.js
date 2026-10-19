/* AltiumPCBMirror - hub-fppick.js
   O SELETOR DE FOOTPRINT do Esquema: trocar o footprint de um componente antes de mandar para a
   PCB (Design » Update PCB), na MESMA galeria da Biblioteca » Footprints do hub (hub-libview.js:
   tiles .symed-tile, desenho do HubDraw em fundo --sunken), e nao num campo de texto solto.
   Pedido do dono, 2026-10-14: a troca de footprint no esquema "no layout do footprint atual do
   eletrichub".

   O que a galeria diz que o campo de texto nao dizia:
     - o desenho de cada footprint, e quantos pads tem
     - "3D" quando o footprint tem modelo (desde a 1.13 sem marca de origem: uma biblioteca so)
     - se os pinos do simbolo tem pad nele (o "Unknown Pin" que o ECO acusaria): o filtro
       "so os que servem" deixa so os footprints onde TODO pino do simbolo tem pad

   API (global HubFpPick)
     HubFpPick.escolhe({footprints, atual, ref, pinos, hub, titulo})
       footprints  [{name, pads, silk, bbox, bodies}] -- a PcbLib ja mesclada com a do hub
       atual       o nome do footprint de hoje (vem marcado)
       pinos       [numeros dos pinos do simbolo] para o "serve"
       hub         Set|Array com os nomes que sao da biblioteca do hub
     -> Promise<{acao:'usar', nome} | {acao:'tirar'} | {acao:'novo'} | {acao:'editar', nome} | null>
   Puro: HubFpPick.serve(fp, pinos) e HubFpPick.filtra(lista, q, pinos, soServe) (node: tests/test-fppick.js). */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HubFpPick = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
'use strict';

/* os pinos do simbolo que NAO tem pad no footprint */
function faltam(fp, pinos){
  const pads = new Set(((fp && fp.pads) || []).map(p => String(p && p.name)));
  const f = [];
  for (const n of (pinos || [])) { const k = String(n); if (!pads.has(k) && f.indexOf(k) < 0) f.push(k); }
  return f;
}
const serve = (fp, pinos) => !!fp && (fp.pads || []).length > 0 && faltam(fp, pinos).length === 0;
function filtra(lista, q, pinos, soServe){
  const t = String(q || '').trim().toLowerCase();
  return (lista || []).filter(f => f && f.name && (!t || f.name.toLowerCase().indexOf(t) >= 0) &&
                                   (!soServe || !(pinos && pinos.length) || serve(f, pinos)));
}

const CSS = `
.fpk-dlg{width:min(1040px,100%); height:min(680px,calc(100vh - 36px)); display:flex; flex-direction:column; gap:0; padding:0;
  background:var(--surface); color:var(--text); border-radius:var(--r-lg,10px); box-shadow:var(--shadow-menu); overflow:hidden;}
.fpk-cab{display:flex; align-items:baseline; gap:10px; padding:12px 16px 8px; border-bottom:1px solid var(--line,var(--edge));}
.fpk-cab h3{margin:0; font-size:14px; font-weight:600;}
.fpk-cab .q{font-size:12px; color:var(--text-3,var(--text-2));}
.fpk-cab .q b{color:var(--text); font-family:Consolas,ui-monospace,monospace; font-weight:normal;}
.fpk-bar{display:flex; gap:8px; align-items:center; padding:8px 16px; border-bottom:1px solid var(--line,var(--edge));}
.fpk-bar input[type=text]{flex:1; min-width:0; height:28px; padding:0 9px; background:var(--surface-2,var(--surface)); color:var(--text);
  border:1px solid var(--edge); border-radius:6px; font:12.5px inherit;}
.fpk-bar input[type=text]:focus{outline:none; border-color:var(--hi);}
.fpk-bar label{display:flex; gap:5px; align-items:center; font-size:12px; color:var(--text-2); white-space:nowrap; cursor:pointer;}
.fpk-bar .n{font-size:11px; color:var(--text-4,var(--text-2)); white-space:nowrap;}
.fpk-corpo{flex:1; min-height:0; display:grid; grid-template-columns:minmax(0,1fr) 300px;}
.fpk-tiles{overflow:auto; padding:8px 12px; display:grid; grid-template-columns:repeat(auto-fill, minmax(112px,1fr)); gap:6px; align-content:start;}
.fpk-tile{display:flex; flex-direction:column; align-items:center; gap:3px; padding:5px 4px 4px; border:0; border-radius:6px;
  background:transparent; color:var(--text); cursor:pointer; font:inherit;}
.fpk-tile:hover{box-shadow:inset 0 0 0 1px rgba(var(--tint),0.3);}
.fpk-tile[aria-selected="true"]{box-shadow:inset 0 0 0 2px var(--hi);}
.fpk-tile canvas{width:96px; height:64px; border-radius:3px; background:var(--sunken,#14161a);}
.fpk-tile .nm{font-size:11px; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.fpk-tile .k{font-size:9px; color:var(--text-4,var(--text-2)); display:flex; gap:4px; align-items:center;}
.fpk-tile .k .hub{padding:0 5px; border-radius:8px; background:var(--hi); color:var(--on-hi,#000);}
.fpk-tile .k .ruim{color:var(--warn,#ffb74d);}
.fpk-tile.atual .nm{color:var(--hi);}
.fpk-mais{grid-column:1 / -1; padding:8px; font-size:11px; color:var(--text-4,var(--text-2));}
.fpk-ficha{border-left:1px solid var(--line,var(--edge)); display:flex; flex-direction:column; min-height:0; background:var(--surface-2,var(--surface));}
.fpk-ficha .vp{position:relative; height:220px; margin:10px; border-radius:6px; overflow:hidden; background:var(--sunken,#14161a);}
.fpk-ficha .vp canvas{position:absolute; inset:0; width:100%; height:100%; display:block;}
.fpk-ficha .info{padding:0 12px 10px; font-size:12px; display:grid; grid-template-columns:90px 1fr; gap:4px 8px; overflow:auto;}
.fpk-ficha .info .r{color:var(--text-3,var(--text-2));}
.fpk-ficha .info .v{font-family:Consolas,ui-monospace,monospace; word-break:break-all;}
.fpk-ficha .info .warn{color:var(--warn,#ffb74d);}
.fpk-ficha .info .ok{color:var(--ok,#7bd88f);}
.fpk-rod{display:flex; gap:8px; align-items:center; padding:10px 16px; border-top:1px solid var(--line,var(--edge));}
.fpk-rod .esp{flex:1;}
.fpk-rod button{height:30px; padding:0 14px; border-radius:6px; border:1px solid var(--edge); background:transparent; color:var(--text); cursor:pointer; font:inherit; font-size:12.5px;}
.fpk-rod button:hover:not(:disabled){border-color:var(--hi);}
.fpk-rod button:disabled{opacity:.4; cursor:not-allowed;}
.fpk-rod button.pri{background:var(--hi); border-color:var(--hi); color:var(--on-hi,#000);}
.fpk-fundo{position:fixed; inset:0; z-index:80; display:grid; place-items:center; padding:18px; background:var(--scrim, rgba(0,0,0,.5));}
`;
let cssPosto = false;
function poeCss(){ if (cssPosto) return; cssPosto = true; const s = document.createElement('style'); s.textContent = CSS; document.head.append(s); }
function el(tag, cls, txt){ const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
const tok = n => { try { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); } catch (e) { return ''; } };

function desenha(cv, fp, margem){
  if (!fp || !root.HubDraw || !root.HubDraw.mkCamera) return;
  try {
    const cam = root.HubDraw.mkCamera(cv, ctx => root.HubDraw.drawFootprint(ctx, fp), { bg:tok('--sunken') || '#14161a' });
    cam.resize();
    if (fp.bbox && cam.cam) cam.fit(fp.bbox, margem || 1.25); else cam.draw();
  } catch (e) { /* um tile sem desenho e melhor que a galeria sem abrir */ }
}

function escolhe(opcoes){
  const o = opcoes || {};
  poeCss();
  const pinos = (o.pinos || []).map(String);
  const todos = (o.footprints || []).filter(f => f && f.name).slice().sort((a, b) =>
    a.name.localeCompare(b.name));   // uma biblioteca so (1.13): em ordem alfabetica, sem separar a origem
  const por = new Map(todos.map(f => [f.name, f]));
  let sel = o.atual && por.has(o.atual) ? o.atual : null;
  let soServe = false;
  try { soServe = localStorage.getItem('altiumhub.fpk.serve') === '1'; } catch (e) { /* sem storage */ }

  return new Promise(resolve => {
    const fundo = el('div', 'fpk-fundo');
    const d = el('div', 'fpk-dlg'); d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true');
    const cab = el('div', 'fpk-cab');
    cab.append(el('h3', null, o.titulo || 'Footprint'));
    const q = el('span', 'q');
    if (o.ref) { q.append(document.createTextNode('de ')); q.append(el('b', null, o.ref)); }
    q.append(document.createTextNode(o.atual ? ' — hoje: ' : ' — hoje sem footprint'));
    if (o.atual) q.append(el('b', null, o.atual));
    cab.append(q);

    const bar = el('div', 'fpk-bar');
    const busca = el('input'); busca.type = 'text'; busca.placeholder = 'buscar footprint…';
    const lb = el('label'); const ck = el('input'); ck.type = 'checkbox'; ck.checked = soServe;
    lb.title = pinos.length ? 'só os footprints onde todos os ' + pinos.length + ' pinos do símbolo têm pad (o ECO não acusa Unknown Pin)' : 'o símbolo não tem pinos numerados';
    lb.append(ck, document.createTextNode('só os que servem' + (pinos.length ? ' (' + pinos.length + ' pinos)' : '')));
    if (!pinos.length) ck.disabled = true;
    const cnt = el('span', 'n');
    bar.append(busca, lb, cnt);

    const corpo = el('div', 'fpk-corpo');
    const tiles = el('div', 'fpk-tiles');
    const ficha = el('div', 'fpk-ficha');
    const vp = el('div', 'vp'); const cvG = el('canvas'); vp.append(cvG);
    const info = el('div', 'info');
    ficha.append(vp, info);
    corpo.append(tiles, ficha);

    const rod = el('div', 'fpk-rod');
    const bt = (txt, cls, fn, tit) => { const b = el('button', cls || '', txt); b.type = 'button'; b.onclick = fn; if (tit) b.title = tit; return b; };
    const bNovo = bt('Novo footprint…', '', () => fim({ acao:'novo' }), 'desenha um footprint novo no editor (pads, serigrafia, corpo 3D) e usa neste componente');
    const bEd = bt('Editar…', '', () => sel && fim({ acao:'editar', nome:sel }), 'abre o escolhido no editor de footprint');
    const bTira = bt('Sem footprint', '', () => fim({ acao:'tirar' }), 'tira o footprint deste componente');
    const bCanc = bt('Cancelar', '', () => fim(null));
    const bUsar = bt('Usar', 'pri', () => sel && fim({ acao:'usar', nome:sel }), 'troca o footprint; a PCB recebe no Design » Update PCB');
    bTira.disabled = !o.atual;
    rod.append(bNovo, bEd, bTira, el('span', 'esp'), bCanc, bUsar);

    d.append(cab, bar, corpo, rod);
    fundo.append(d);
    (document.getElementById('overlay') || document.body).append(fundo);

    let IO = null;
    function pinta(){
      tiles.textContent = '';
      const vis = filtra(todos, busca.value, pinos, soServe);
      cnt.textContent = vis.length + ' de ' + todos.length;
      const MAX = 400, pend = [];
      for (const f of vis.slice(0, MAX)) {
        const t = el('button', 'fpk-tile' + (f.name === o.atual ? ' atual' : '')); t.type = 'button';
        t.setAttribute('aria-selected', String(f.name === sel));
        const cv = el('canvas'); cv.width = 96; cv.height = 64; cv._fp = f; pend.push(cv);
        const k = el('span', 'k');
        k.append(document.createTextNode((f.pads || []).length + ' pads'));
        if (pinos.length && !serve(f, pinos)) k.append(el('span', 'ruim', '≠ pinos'));
        if ((f.bodies || []).length) k.append(el('span', 'hub', '3D'));
        t.title = f.name + (f.name === o.atual ? '\n— é o de hoje' : '') + '\nduplo clique: usar';
        t.append(cv, el('span', 'nm', f.name), k);
        t.onclick = () => { sel = f.name; for (const x of tiles.querySelectorAll('.fpk-tile')) x.setAttribute('aria-selected', String(x === t)); mostra(); };
        t.ondblclick = () => fim({ acao:'usar', nome:f.name });
        tiles.append(t);
      }
      if (vis.length > MAX) tiles.append(el('div', 'fpk-mais', '… e mais ' + (vis.length - MAX) + '. Refine a busca.'));
      if (!vis.length) tiles.append(el('div', 'fpk-mais', soServe ? 'nenhum footprint com pad para todos os pinos. Desmarque "só os que servem" ou crie um novo.' : 'nada com essa busca.'));
      if (IO) IO.disconnect();
      if (typeof IntersectionObserver === 'function') {
        IO = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { desenha(e.target, e.target._fp); IO.unobserve(e.target); } }, { root:tiles, rootMargin:'160px' });
        for (const cv of pend) IO.observe(cv);
      } else for (const cv of pend) desenha(cv, cv._fp);
    }
    function mostra(){
      info.textContent = '';
      const f = sel ? por.get(sel) : null;
      bUsar.disabled = !f || sel === o.atual; bEd.disabled = !f;
      const kv = (r, v, c) => { info.append(el('span', 'r', r), el('span', 'v' + (c ? ' ' + c : ''), v)); };
      if (!f) { cvG.getContext('2d').clearRect(0, 0, cvG.width, cvG.height); kv('', 'escolha um footprint na galeria'); return; }
      desenha(cvG, f, 1.15);
      kv('Nome', f.name);
      kv('Pads', String((f.pads || []).length));
      if (f.bbox) kv('Tamanho', (Math.round((f.bbox.x2 - f.bbox.x1) * 100) / 100) + ' × ' + (Math.round((f.bbox.y2 - f.bbox.y1) * 100) / 100) + ' mm');
      kv('Modelo 3D', (f.bodies || []).length ? (f.bodies || []).length + ' corpo(s)' : 'nenhum', (f.bodies || []).length ? null : 'warn');
      if (pinos.length) {
        const fl = faltam(f, pinos);
        kv('Pinos', fl.length ? 'sem pad: ' + fl.slice(0, 16).join(', ') + (fl.length > 16 ? '…' : '') : 'todos os ' + pinos.length + ' têm pad', fl.length ? 'warn' : 'ok');
      }
      if (f.description) kv('Descrição', f.description);
    }
    const tecla = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); fim(null); return; }
      /* a captura no document para a tecla antes do alvo: o Enter da busca e tratado aqui */
      if (e.key === 'Enter' && e.target === busca) { e.preventDefault(); const t = tiles.querySelector('.fpk-tile'); if (t) t.click(); return; }
      if (e.key === 'Enter' && sel && sel !== o.atual && !(e.target && e.target.tagName === 'BUTTON')) { e.preventDefault(); fim({ acao:'usar', nome:sel }); return; }
      e.stopPropagation();
    };
    function fim(r){
      document.removeEventListener('keydown', tecla, true);
      if (IO) IO.disconnect();
      fundo.remove();
      resolve(r);
    }
    busca.addEventListener('input', pinta);
    ck.addEventListener('change', () => { soServe = ck.checked; try { localStorage.setItem('altiumhub.fpk.serve', soServe ? '1' : '0'); } catch (e) { /* ok */ } pinta(); });
    fundo.addEventListener('mousedown', e => { if (e.target === fundo) fim(null); });
    document.addEventListener('keydown', tecla, true);
    pinta(); mostra();
    const s = tiles.querySelector('[aria-selected="true"]'); if (s) s.scrollIntoView({ block:'center' });
    setTimeout(() => busca.focus(), 20);
  });
}

return { escolhe, serve, faltam, filtra };
});
