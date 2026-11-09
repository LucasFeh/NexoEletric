/* NexoEletric - hub-variantes.js — a VARIANTE DE PROJETO (1.88.0): a mesma PCB para projetos diferentes, mudando só o
   que é montado.

   Pedido do dono (2026-11-09): "dentro de cada projeto, vai ter uma área chamada 'variante de projeto' no menu lateral
   direito; quando eu criar uma variante de projeto, preciso na hora estabelecer um código para essa variante dentro do
   catálogo de 'definir projeto'; quando eu troco a variante, a pcb vai ser exatamente a mesma só que para projetos
   diferentes; a variante eu posso só SUPRIMIR (montar ou não montar) componentes, mais nada além disso; a barra de
   ferramenta de edição tanto pra pcb quanto pra esquema somem, e só fica 'suprimir', que tira o componente tanto da pcb,
   quanto do boom, quanto da lista de envio para o odoo".

   O servidor é o tools/rotas/variantes.py (o arquivo Projects/<p>/variantes.json, a variante ativa POR MÁQUINA em
   .variante-ativa.json, e a trava do /api/save). Aqui:

   PURO (navegador e Node: a vista, o hub, o MCP e os testes)
     HubVariantes.refs(sch, v)          Set dos designadores que a variante v suprime e que estão no esquema
     HubVariantes.aplica(sch, v)        o esquema como a variante o monta (cópia rasa; o suprimido ganha dnp + suprimido)
     HubVariantes.codigos(sch, v)       {placa, virgem, montada, equipamento, variante}: PCB virgem = código da PCB;
                                        PCB montada = código da PCB, ou o da variante quando há uma ativa
     HubVariantes.proibidos(estado, menosId)  {CODIGO: motivo} — o código da PCB e os das outras variantes
     HubVariantes.sufixo(v)             " - variante <código>" para o nome dos arquivos exportados ('' na padrão)
     HubVariantes.filtraPlaca(B, refs)  a placa (formato do board.js) sem os componentes suprimidos (BOM, Neoden)

   TELA (navegador)
     HubVariantes.carrega(projeto, forcar)   -> Promise<estado>  (GET /api/variantes, com cache por projeto)
     HubVariantes.estadoDe(projeto)          o último estado lido (ou null)
     HubVariantes.ativa(projeto)             a variante ativa ({id, nome, codigo, suprimidos}) ou null
     HubVariantes.refsDoProjeto(projeto, sch)  Set dos suprimidos da ativa
     HubVariantes.monta(caixa, o)            a área "Variante de projeto" do painel da direita (Configurações);
                                             o = {projeto, vista:'sch'|'pcb', selecionados():[refs], foca(ref)?, antes?:el}
     HubVariantes.alterna(projeto, refs)     Suprimir / Montar os refs na variante ativa (todos suprimidos -> monta)
     HubVariantes.ouve(fn)                   fn(projeto, estado, antes) quando o estado muda (esta janela, outra janela
                                             do mesmo app pelo BroadcastChannel, ou a releitura a cada 8 s)
     HubVariantes.instalaTecla(projeto, selecionados)  Shift+S = Suprimir / Montar a seleção (só com variante ativa)
     HubVariantes.selo(projeto)              o selo "VARIANTE <nome> · <código>" no canto da vista (body.variante-on) */
(function (root, fabrica) {
  const api = fabrica(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HubVariantes = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
'use strict';

const FORMATO = 'nexoeletric-variantes-1';
const PADRAO = 'Padrão (todos montados)';
const TECLA = 'Shift+S';
const normCod = s => String(s || '').replace(/\s+/g, '').toUpperCase();

/* ============================== puro ============================== */
function comps(sch){ return ((sch && Array.isArray(sch.items)) ? sch.items : []).filter(it => it && it.t === 'comp' && String(it.ref == null ? '' : it.ref).trim()); }
function refs(sch, v){
  const out = new Set();
  if (!v || !Array.isArray(v.suprimidos) || !v.suprimidos.length) return out;
  const quer = new Set(v.suprimidos.map(s => String((s && s.ref) != null ? s.ref : s).trim()));
  for (const it of comps(sch)) { const r = String(it.ref).trim(); if (quer.has(r)) out.add(r); }
  return out;
}
function aplica(sch, v){
  const fora = refs(sch, v);
  if (!fora.size) return sch;
  return Object.assign({}, sch, { items: sch.items.map(it => it && it.t === 'comp' && fora.has(String(it.ref).trim())
    ? Object.assign({}, it, { dnp: true, suprimido: true }) : it) });
}
function params(sch){
  const out = {};
  const p = sch && typeof sch.params === 'string' ? sch.params : '';
  for (const par of p.split(';')) { const i = par.indexOf('='); if (i > 0) out[par.slice(0, i).trim()] = par.slice(i + 1).replace(/\s+/g, ' ').trim(); }
  return out;
}
/* A REGRA DOS CÓDIGOS (decisão de 2026-11-09; o mesmo do variantes.py » codigos): a virgem é a fibra, igual em todas as
   variantes; a montada é um produto por variante. Mude aqui e lá juntos. */
function codigos(sch, v){
  const p = params(sch);
  let placa = p.CodigoDaPlaca || '';
  if (placa.toUpperCase() === 'PROJETO NÃO DEFINIDO') placa = '';
  return { placa, nomePlaca: p.NomeDaPlaca || '', virgem: placa, montada: (v && v.codigo) || placa,
           equipamento: p.CodigoDoEquipamento || '', variante: v ? { id: v.id, nome: v.nome || '', codigo: v.codigo || '' } : null };
}
function proibidos(est, menosId){
  const out = {};
  const pl = est && est.placa && est.placa.codigo;
  if (pl) out[normCod(pl)] = 'é o código da PCB (a placa virgem, igual em todas as variantes): a variante precisa de um código próprio';
  for (const v of (est && est.variantes) || []) if (v.id !== menosId) out[normCod(v.codigo)] = 'já é o código da variante "' + v.nome + '"';
  return out;
}
const sufixo = v => v ? ' - variante ' + String(v.codigo || v.nome || v.id).replace(/[\\/:*?"<>|]+/g, '_') : '';
function filtraPlaca(B, fora){
  if (!B || !fora || !fora.size) return B;
  return Object.assign({}, B, { components: (B.components || []).filter(c => !fora.has(String(c && (c.ref != null ? c.ref : c.designator)))) });
}
const textoVariante = v => v ? 'VARIANTE ' + (v.nome || '') + (v.codigo ? ' · ' + v.codigo : '') : '';

const PURO = { FORMATO, PADRAO, TECLA, refs, aplica, codigos, proibidos, sufixo, filtraPlaca, params, textoVariante, normCod };
if (typeof document === 'undefined') return PURO;

/* ============================== tela ============================== */
const DLG = () => root.HubDialog;
function toast(t, k, ms){ const D = DLG(); if (D && D.toast) D.toast(t, k || 'info', ms); else if (typeof root.toast === 'function') root.toast(t, k); }
function el(tag, cls, txt){ const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
function bt(txt, titulo, fn, cls){ const b = el('button', cls || null, txt); b.type = 'button'; if (titulo) b.title = titulo; b.addEventListener('click', fn); return b; }

const CSS = `
.vr-sec{display:flex; flex-direction:column; gap:6px; margin-top:6px; padding-top:8px; border-top:1px solid var(--border, var(--line, #444));}
.vr-sec h3{margin:0; font-size:10.5px; font-weight:600; text-transform:uppercase; letter-spacing:.08em; color:var(--fg2, var(--text-3, #999));}
.vr-sec select{width:100%; background:var(--panel, var(--surface, #1e1e1e)); color:var(--fg, var(--text, #ddd)); border:1px solid var(--border, var(--line, #444));
  border-radius:4px; padding:4px 6px; font:12px var(--font, "Segoe UI", sans-serif);}
.vr-lin{display:flex; gap:4px; flex-wrap:wrap;}
.vr-lin button{flex:1 1 auto; min-width:0; padding:4px 6px; font:11.5px var(--font, sans-serif); cursor:pointer; border-radius:4px;
  border:1px solid var(--border, var(--line, #444)); background:var(--panel2, var(--surface-2, #2a2a2a)); color:var(--fg, var(--text, #ddd));}
.vr-lin button:disabled{opacity:.45; cursor:default;}
.vr-lin button.prim{background:var(--accent, var(--hi, #3b82f6)); border-color:var(--accent, var(--hi, #3b82f6)); color:#fff;}
.vr-info{font-size:11px; color:var(--fg2, var(--text-3, #999)); line-height:1.4;}
.vr-info b{color:var(--fg, var(--text, #ddd)); font-weight:600; font-family:var(--mono, ui-monospace, monospace);}
.vr-chips{display:flex; gap:3px; flex-wrap:wrap;}
.vr-chip{font:10.5px var(--mono, ui-monospace, monospace); padding:0 5px; border-radius:3px; cursor:pointer;
  background:rgba(255,82,82,.14); color:#ff8a8a; border:1px solid rgba(255,82,82,.35);}
.vr-chip.falta{opacity:.6; text-decoration:line-through;}
.vr-selo{position:fixed; top:8px; left:50%; transform:translateX(-50%); z-index:40; pointer-events:none;
  font:600 11px var(--font, "Segoe UI", sans-serif); letter-spacing:.04em; padding:3px 10px; border-radius:10px;
  background:rgba(245,158,11,.92); color:#1a1205; box-shadow:0 2px 8px rgba(0,0,0,.35);}
.vr-barra{position:absolute; top:10px; left:50%; transform:translateX(-50%); z-index:30; display:flex; gap:6px; align-items:center;
  padding:5px 8px; border-radius:7px; background:var(--panel2, var(--surface, #222)); border:1px solid rgba(245,158,11,.7);
  box-shadow:0 4px 14px rgba(0,0,0,.4); font:12px var(--font, "Segoe UI", sans-serif); color:var(--fg, var(--text, #ddd));}
.vr-barra .vr-nome{font-weight:600; color:#f59e0b; white-space:nowrap;}
.vr-barra button{cursor:pointer; padding:4px 10px; border-radius:5px; border:1px solid #f59e0b; background:rgba(245,158,11,.16);
  color:var(--fg, var(--text, #eee)); font:600 12px var(--font, sans-serif);}
.vr-barra button:disabled{opacity:.45; cursor:default;}
.vr-barra kbd{font:10px var(--mono, monospace); opacity:.7; margin-left:4px;}
`;
function css(){ if (document.getElementById('vr-css')) return; const s = document.createElement('style'); s.id = 'vr-css'; s.textContent = CSS; document.head.append(s); }

const CACHE = new Map();             /* projeto -> estado do /api/variantes */
const OUVINTES = new Set();
let canal = null;
try { canal = typeof BroadcastChannel === 'function' ? new BroadcastChannel('nexoeletric-variantes') : null; } catch (_) { canal = null; }
const enc = encodeURIComponent;
function chaveDe(e){ return e ? JSON.stringify([e.ativa, (e.variantes || []).map(v => [v.id, v.nome, v.codigo, (v.suprimidos || []).map(s => s.ref).join(',')])]) : ''; }
function poe(projeto, est, origem){
  const antes = CACHE.get(projeto) || null;
  CACHE.set(projeto, est);
  if (chaveDe(antes) === chaveDe(est)) return est;
  for (const fn of OUVINTES) try { fn(projeto, est, antes); } catch (e) { console.error(e); }
  if (origem !== 'canal' && canal) try { canal.postMessage({ projeto }); } catch (_) { /* outra janela fechada */ }
  return est;
}
async function pede(url, corpo){
  let r, j = null;
  try {
    r = await fetch(url, corpo ? { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(corpo) } : { cache:'no-store' });
    j = await r.json();
  } catch (e) { return { ok:false, error: String(e && e.message || e) }; }
  if (j && j.codigo === 'sem_permissao' && root.HubEquipe && root.HubEquipe.recusado) root.HubEquipe.recusado(j);
  return j || { ok:false, error:'sem resposta' };
}
async function carrega(projeto, forcar, origem){
  if (!projeto) return null;
  if (!forcar && CACHE.has(projeto)) return CACHE.get(projeto);
  const j = await pede('/api/variantes?projeto=' + enc(projeto));
  if (!j.ok) { if (!CACHE.has(projeto)) CACHE.set(projeto, null); return CACHE.get(projeto) || null; }
  return poe(projeto, j, origem);
}
if (canal) canal.onmessage = ev => { const p = ev && ev.data && ev.data.projeto; if (p && CACHE.has(p)) carrega(p, true, 'canal'); };
/* releitura a cada 8 s (o MCP, outra máquina pelo NexoBD): só dos projetos que esta janela usa */
setInterval(() => { if (document.hidden) return; for (const p of CACHE.keys()) carrega(p, true, 'tempo'); }, 8000);

const estadoDe = p => CACHE.get(p) || null;
function ativa(p){ const e = estadoDe(p); return e && e.ativa ? (e.variantes || []).find(v => v.id === e.ativa) || null : null; }
function refsDoProjeto(p, sch){ return refs(sch, ativa(p)); }
function ouve(fn){ OUVINTES.add(fn); return () => OUVINTES.delete(fn); }
function podeEditar(p){ const e = estadoDe(p); return !e || !e.permissao || e.permissao.pode !== false; }
function motivo(p){ const e = estadoDe(p); return (e && e.permissao && e.permissao.motivo) || 'somente leitura'; }

async function troca(projeto, id){
  const j = await pede('/api/variantes/ativar', { projeto, id: id || null });
  if (!j.ok) { toast('não trocou de variante: ' + j.error, 'err', 7000); return null; }
  return poe(projeto, j);
}
async function cria(projeto){
  if (!podeEditar(projeto)) { toast(motivo(projeto), 'warn', 6000); return null; }
  const D = DLG(), C = root.HubCatalogo;
  if (!D || !D.texto || !C || !C.escolhe) { toast('a variante precisa do catálogo (hub-catalogo.js) e do hub-dialog.js', 'err'); return null; }
  const est = estadoDe(projeto) || await carrega(projeto, true);
  const nome = await D.texto('Nome da variante (ex.: "Sem display", "Versão 12 V"). A PCB é a mesma; a variante só suprime componentes.',
    { title:'Nova variante de projeto', ok:'Escolher o código…',
      valida: s => !String(s || '').trim() ? 'dê um nome' : (est.variantes || []).some(v => v.nome.toLowerCase() === String(s).trim().toLowerCase()) ? 'já existe uma variante com esse nome' : '' });
  if (nome == null || !String(nome).trim()) return null;
  /* NA HORA, o código da variante no catálogo do Definir projeto (sem código não há variante) */
  const item = await C.escolhe({ titulo:'Código da variante "' + String(nome).trim() + '"', rotulo:'Código da variante',
    sub:'escolha no catálogo (ou cadastre) o produto montado desta variante — o código não pode ser o da PCB nem o de outra variante',
    proibidos: proibidos(est) });
  if (!item) { toast('variante não criada: sem código não há variante', 'warn', 5000); return null; }
  const j = await pede('/api/variantes/criar', { projeto, nome: String(nome).trim(), codigo: item.modelo, nomeCatalogo: item.nome || '' });
  if (!j.ok) { toast('não criou a variante: ' + j.error, 'err', 8000); return null; }
  poe(projeto, j);
  toast('variante "' + j.variante.nome + '" (' + j.variante.codigo + ') criada — ative-a para suprimir componentes', 'ok', 6000);
  return j.variante;
}
async function renomeia(projeto, v){
  const D = DLG();
  const n = D && D.texto ? await D.texto('Nome novo da variante:', { title:'Renomear variante', v: v.nome, ok:'Renomear' }) : null;
  if (n == null || !String(n).trim() || String(n).trim() === v.nome) return;
  const j = await pede('/api/variantes/editar', { projeto, id: v.id, nome: String(n).trim() });
  if (!j.ok) { toast('não renomeou: ' + j.error, 'err', 7000); return; }
  poe(projeto, j);
}
async function trocaCodigo(projeto, v){
  const C = root.HubCatalogo;
  const item = C && C.escolhe ? await C.escolhe({ titulo:'Código da variante "' + v.nome + '"', rotulo:'Código da variante (hoje ' + v.codigo + ')',
    proibidos: proibidos(estadoDe(projeto), v.id) }) : null;
  if (!item || normCod(item.modelo) === v.codigo) return;
  const j = await pede('/api/variantes/editar', { projeto, id: v.id, codigo: item.modelo, nomeCatalogo: item.nome || '' });
  if (!j.ok) { toast('não trocou o código: ' + j.error, 'err', 7000); return; }
  poe(projeto, j);
  toast('variante "' + v.nome + '": código ' + j.variante.codigo, 'ok');
}
async function apaga(projeto, v){
  const D = DLG();
  if (D && D.confirm && !(await D.confirm('Apagar a variante "' + v.nome + '" (' + v.codigo + ')? Os ' + (v.suprimidos || []).length
      + ' componente(s) suprimidos nela voltam a ser só da padrão. A PCB não muda.', { title:'Apagar variante', ok:'Apagar', danger:true }))) return;
  const j = await pede('/api/variantes/apagar', { projeto, id: v.id });
  if (!j.ok) { toast('não apagou: ' + j.error, 'err', 7000); return; }
  poe(projeto, j);
  toast('variante "' + v.nome + '" apagada', 'ok');
}
async function alterna(projeto, lista){
  const v = ativa(projeto);
  if (!v) { toast('Suprimir é da variante de projeto: escolha (ou crie) uma variante em Configurações › Variante de projeto', 'info', 6000); return null; }
  if (!podeEditar(projeto)) { toast(motivo(projeto), 'warn', 6000); return null; }
  const rs = [...new Set((lista || []).map(r => String(r || '').trim()).filter(Boolean))];
  if (!rs.length) { toast('selecione o(s) componente(s) para suprimir ou montar (' + TECLA + ')', 'info', 4000); return null; }
  const tem = new Set((v.suprimidos || []).map(s => s.ref));
  const suprimir = !rs.every(r => tem.has(r));
  const j = await pede('/api/variantes/suprimir', { projeto, id: v.id, refs: rs, suprimir });
  if (!j.ok) { toast('não mudou: ' + j.error, 'err', 7000); return null; }
  poe(projeto, j);
  if (j.mudou && j.mudou.length) toast(j.mudou.join(', ') + (suprimir ? ': suprimido na variante "' + v.nome + '" — fora do BOM, da Neoden e da lista do Odoo; a PCB não muda'
    : ': volta a ser montado na variante "' + v.nome + '"'), 'ok', 5000);
  return j;
}

function monta(caixa, o){
  if (!caixa || !o || !o.projeto) return null;
  css();
  const P = o.projeto;
  const sec = el('div', 'sec vr-sec');
  sec.dataset.variantes = '1';
  const h = el('h3', null, 'Variante de projeto');
  const sel = el('select'); sel.title = 'a variante que a vista mostra e que as saídas (BOM, Neoden, lista do Odoo, PDF) usam — nesta máquina';
  const info = el('div', 'vr-info');
  const chips = el('div', 'vr-chips');
  const l1 = el('div', 'vr-lin'), l2 = el('div', 'vr-lin');
  const bNova = bt('+ Nova', 'cria uma variante: o nome e, na hora, o código dela no catálogo do Definir projeto', () => cria(P).then(v => { if (v && o.ativarNova !== false) troca(P, v.id); }));
  const bRen = bt('Renomear', 'muda o nome da variante escolhida', () => { const v = ativa(P); if (v) renomeia(P, v); });
  const bCod = bt('Código…', 'troca o código da variante pelo catálogo do Definir projeto', () => { const v = ativa(P); if (v) trocaCodigo(P, v); });
  const bApa = bt('Apagar', 'apaga a variante escolhida (a PCB não muda)', () => { const v = ativa(P); if (v) apaga(P, v); });
  const bSup = bt('Suprimir / Montar', 'tira (ou devolve) os componentes selecionados desta variante: some da PCB montada, do BOM, da Neoden e da lista do Odoo (' + TECLA + ')',
    () => alterna(P, o.selecionados ? o.selecionados() : []), 'prim');
  l1.append(bNova, bRen, bCod, bApa);
  l2.append(bSup);
  sec.append(h, sel, info, l2, chips, l1);
  if (o.antes && o.antes.parentNode) o.antes.parentNode.insertBefore(sec, o.antes);
  else caixa.append(sec);
  sel.addEventListener('change', async () => {
    sel.disabled = true;
    const e = await troca(P, sel.value || null);
    sel.disabled = false;
    if (!e) pinta();
  });
  function pinta(){
    const e = estadoDe(P);
    const v = ativa(P);
    sel.replaceChildren();
    const o0 = el('option', null, PADRAO); o0.value = ''; sel.append(o0);
    for (const x of (e && e.variantes) || []) { const op = el('option', null, x.nome + ' · ' + x.codigo); op.value = x.id; sel.append(op); }
    sel.value = v ? v.id : '';
    const pode = podeEditar(P);
    const t = pode ? '' : ' — ' + motivo(P);
    bNova.disabled = !pode; bNova.title = pode ? bNova.title.replace(/ — .*$/, '') : 'criar variante é edição' + t;
    for (const b of [bRen, bCod, bApa]) b.disabled = !pode || !v;
    bSup.disabled = !v || !pode;
    bSup.title = !v ? 'escolha uma variante: na padrão todos são montados' : !pode ? 'suprimir é edição' + t : 'tira (ou devolve) os componentes selecionados desta variante (' + TECLA + ')';
    l2.hidden = !v;
    const c = (e && e.codigos) || {};
    info.replaceChildren();
    const linha = (rot, val) => { const d = el('div'); d.append(rot + ' ', el('b', null, val || '—')); info.append(d); };
    linha('PCB montada:', c.montada);
    linha('PCB virgem:', c.virgem || c.placa);
    if (v) info.append(el('div', null, (v.suprimidos || []).length + ' suprimido(s) nesta variante — a PCB, o cobre e o Gerber são os da padrão'));
    else info.append(el('div', null, (e && e.variantes && e.variantes.length ? e.variantes.length + ' variante(s) — ' : '') + 'na padrão todos os componentes são montados'));
    chips.replaceChildren();
    if (v) for (const s of v.suprimidos || []) {
      const ch = el('span', 'vr-chip' + ((v.faltando || []).indexOf(s.ref) >= 0 ? ' falta' : ''), s.ref);
      ch.title = ((v.faltando || []).indexOf(s.ref) >= 0 ? 'não está mais no esquema' : (v.trocados || []).indexOf(s.ref) >= 0 ? 'virou outra peça desde que foi suprimido (' + (s.sym || '?') + ')' : (s.sym || ''))
        + (s.por ? ' · suprimido por ' + s.por.nome : '') + ' — clique para achar';
      if (o.foca) ch.addEventListener('click', () => o.foca(s.ref));
      chips.append(ch);
    }
  }
  ouve(p => { if (p === P) pinta(); });
  pinta();
  carrega(P, true);
  return { pinta };
}

function instalaTecla(projeto, selecionados){
  window.addEventListener('keydown', e => {
    if (!(e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && (e.key === 'S' || e.key === 's'))) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (!ativa(projeto)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    alterna(projeto, selecionados ? selecionados() : []);
  }, true);
}
/* a barra que sobra na vista com a variante ativa: o nome, o código e o Suprimir / Montar */
function barra(container, projeto, selecionados){
  css();
  let b = null;
  const pinta = () => {
    const v = ativa(projeto);
    document.body.classList.toggle('variante-on', Boolean(v));
    if (!v) { if (b) { b.remove(); b = null; } return; }
    if (!b) { b = el('div', 'vr-barra'); b.setAttribute('role', 'toolbar'); b.setAttribute('aria-label', 'Variante de projeto'); container.append(b); }
    b.replaceChildren();
    const nm = el('span', 'vr-nome', textoVariante(v));
    nm.title = 'variante de projeto ativa nesta máquina: a PCB é a mesma, só se suprime ou monta componente (Configurações › Variante de projeto)';
    const s = bt('Suprimir / Montar', 'tira (ou devolve) os componentes selecionados desta variante (' + TECLA + ')', () => alterna(projeto, selecionados ? selecionados() : []));
    s.append(el('kbd', null, TECLA));
    if (!podeEditar(projeto)) { s.disabled = true; s.title = 'suprimir é edição — ' + motivo(projeto); }
    b.append(nm, el('span', null, (v.suprimidos || []).length + ' suprimido(s)'), s);
  };
  ouve(p => { if (p === projeto) pinta(); });
  pinta();
  return { pinta };
}

return Object.assign({}, PURO, { carrega, estadoDe, ativa, refsDoProjeto, ouve, monta, alterna, troca, cria, instalaTecla, barra, podeEditar });
});
