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
     HubVariantes.selo(projeto)              o selo "VARIANTE <nome> · <código>" no canto da vista (body.variante-on)

   1.89.0 (pedido do dono, 2026-11-09: "o dropbox pra criar variante, precisa ser só o dropbox, você clica, se não tiver
   você clicar em 'adicionar variante' dentro do dropbox mesmo, e isso abre a tela pra selecionar o equipamento daquela
   variante, seleciona só o equipamento pq a PCB é a mesma"):
   - a área "Variante de projeto" é SÓ um dropdown: "Padrão (todos montados)", as variantes (nome · código) e, no fim,
     "+ Adicionar variante"; com uma variante escolhida, também "Renomear esta variante…", "Trocar equipamento desta
     variante…" e "Apagar esta variante…" (separados por um divisor). Sem botões soltos e sem perguntar nome antes;
   - "+ Adicionar variante" abre o catálogo do Definir projeto SÓ com equipamentos (HubCatalogo.escolhe({soEquipamento}));
     o equipamento escolhido (ou cadastrado ali mesmo, pela fila do catálogo) dá o CÓDIGO da variante e, em seguida, a
     pessoa dá o NOME (obrigatório, sugestão = o nome do equipamento; "Renomear esta variante…" muda depois). Cancelou,
     nada é criado. O equipamento do projeto padrão e o de outra variante são recusados (proibidos);
   - o quadro da folha, com a variante ativa, mostra no EQUIPAMENTO o código do equipamento DA VARIANTE (a linha
     "VARIANTE …" saiu: a barra da vista diz o nome); PLACA continua o código da PCB;
   - o envio da lista ao Odoo com a variante ativa (odoolista.monta_payload): a PCB MONTADA é "<código da placa> <NOME DA
     VARIANTE>" e a PCB VIRGEM não vai (a virgem é a do projeto padrão); o equipamento da variante só vai ao quadro.
   As variantes da 1.88.0 (nome livre, código de qualquer grupo) continuam abrindo como estão.

   1.89.3 (pedido do dono, 2026-11-10: "Padrão poderia ser só o nome do equipamento tipo nesse caso é 'DMB' e essa parte
   embaixo [...] pode ser bem resumido"):
   - a opção da padrão no dropdown (e a caixa fechada) se chama pela SIGLA do equipamento do projeto (rotuloPadrao: o
     CodigoDoEquipamento "DMB-DI231765" -> "DMB"; sem código, o NomeDoEquipamento; sem nada, "Padrão") e mostra à direita
     o código do equipamento (sem equipamento, o da placa), como as variantes;
   - com a variante ativa, o resumo embaixo fica "PCB montada: <...>" e "Sem PCB virgem · N suprimido(s)", sem explicação. */
(function (root, fabrica) {
  const api = fabrica(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HubVariantes = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
'use strict';

const FORMATO = 'nexoeletric-variantes-1';
const PADRAO = 'Padrão';
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
/* 1.89.0: a PCB montada de uma variante no Odoo = "<código da placa><SEPARADOR><NOME DA VARIANTE>" (o variantes.py »
   montada_da_variante; mude os dois juntos) e a virgem não vai (virgemVai) */
const SEPARADOR_MONTADA = ' ';
function montadaDaVariante(placa, nome){
  const n = String(nome || '').replace(/\s+/g, ' ').trim().toUpperCase();
  return placa ? (placa + SEPARADOR_MONTADA + n).trim() : n;
}
function codigos(sch, v){
  const p = params(sch);
  let placa = p.CodigoDaPlaca || '';
  if (placa.toUpperCase() === 'PROJETO NÃO DEFINIDO') placa = '';
  /* 1.89.0: a variante é um equipamento: com ela ativa, o equipamento (o do quadro da folha) é o código dela */
  return { placa, nomePlaca: p.NomeDaPlaca || '', virgem: placa, virgemVai: !v, montada: v ? montadaDaVariante(placa, v.nome || v.codigo) : placa,
           equipamento: (v && v.codigo) || p.CodigoDoEquipamento || '', equipamentoProjeto: p.CodigoDoEquipamento || '',
           nomeEquipamentoProjeto: p.NomeDoEquipamento || '',
           variante: v ? { id: v.id, nome: v.nome || '', codigo: v.codigo || '' } : null };
}
function proibidos(est, menosId){
  const out = {};
  const pl = est && est.placa && est.placa.codigo;
  if (pl) out[normCod(pl)] = 'é o código da PCB (a placa virgem, igual em todas as variantes): a variante precisa de um código próprio';
  /* 1.89.0: o equipamento do projeto padrão também não (a variante é OUTRO equipamento com a mesma PCB) */
  const eq = est && est.codigos && est.codigos.equipamentoProjeto;
  if (eq) out[normCod(eq)] = 'é o equipamento do projeto padrão: a variante é outro equipamento (com a mesma PCB)';
  for (const v of (est && est.variantes) || []) if (v.id !== menosId) out[normCod(v.codigo)] = 'já é o equipamento da variante "' + v.nome + '"';
  return out;
}
const sufixo = v => v ? ' - variante ' + String(v.codigo || v.nome || v.id).replace(/[\\/:*?"<>|]+/g, '_') : '';
function filtraPlaca(B, fora){
  if (!B || !fora || !fora.size) return B;
  return Object.assign({}, B, { components: (B.components || []).filter(c => !fora.has(String(c && (c.ref != null ? c.ref : c.designator)))) });
}
/* 1.89.3: o nome da padrão no dropdown = a sigla do equipamento do projeto (o pedaço antes do "-DI<número>") */
function siglaEquipamento(cod){
  const c = String(cod || '').replace(/\s+/g, ' ').trim();
  if (!c) return '';
  const m = c.match(/^(.+?)\s*-\s*DI\s*\d/i);
  return ((m ? m[1] : c.split('-')[0]).trim()) || c;
}
const resumoSuprimidos = n => n + (n === 1 ? ' suprimido' : ' suprimidos');
const rotuloPadrao = c => siglaEquipamento(c && c.equipamentoProjeto) || String((c && c.nomeEquipamentoProjeto) || '').trim() || PADRAO;
const codigoPadrao = c => (c && (c.equipamentoProjeto || c.placa)) || '';
const textoVariante = v => v ? 'VARIANTE ' + (v.nome || '') + (v.codigo ? ' · ' + v.codigo : '') : '';

const PURO = { FORMATO, PADRAO, TECLA, siglaEquipamento, rotuloPadrao, codigoPadrao, resumoSuprimidos, SEPARADOR_MONTADA, montadaDaVariante, refs, aplica, codigos, proibidos, sufixo, filtraPlaca, params, textoVariante, normCod };
if (typeof document === 'undefined') return PURO;

/* ============================== tela ============================== */
const DLG = () => root.HubDialog;
function toast(t, k, ms){ const D = DLG(); if (D && D.toast) D.toast(t, k || 'info', ms); else if (typeof root.toast === 'function') root.toast(t, k); }
function el(tag, cls, txt){ const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
function bt(txt, titulo, fn, cls){ const b = el('button', cls || null, txt); b.type = 'button'; if (titulo) b.title = titulo; b.addEventListener('click', fn); return b; }

const CSS = `
.vr-sec{display:flex; flex-direction:column; gap:6px; margin-top:6px; padding-top:8px; border-top:1px solid var(--border, var(--line, #444));}
.vr-sec h3{margin:0; font-size:10.5px; font-weight:600; text-transform:uppercase; letter-spacing:.08em; color:var(--fg2, var(--text-3, #999));}
.vr-dd{position:relative;}
.vr-dd-bt{width:100%; display:flex; align-items:center; gap:6px; text-align:left; cursor:pointer; padding:5px 8px; border-radius:4px;
  background:var(--panel, var(--surface, #1e1e1e)); color:var(--fg, var(--text, #ddd)); border:1px solid var(--border, var(--line, #444));
  font:12px var(--font, "Segoe UI", sans-serif);}
.vr-dd-bt:hover, .vr-dd.aberto .vr-dd-bt{border-color:var(--accent, var(--hi, #3b82f6));}
.vr-dd-bt .vr-dd-txt{flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.vr-dd-bt .vr-dd-cod{font:11px var(--mono, ui-monospace, monospace); color:var(--fg2, var(--text-3, #999));}
.vr-dd-lista{position:fixed; z-index:90; min-width:220px; max-height:60vh; overflow:auto; padding:4px; border-radius:6px;
  background:var(--panel, var(--surface, #222)); border:1px solid var(--border, var(--line, #444)); box-shadow:var(--shadow-menu, 0 8px 30px rgba(0,0,0,.5));
  font:12px var(--font, "Segoe UI", sans-serif); color:var(--fg, var(--text, #ddd));}
.vr-dd-lista[hidden]{display:none;}
.vr-op{display:flex; align-items:baseline; gap:8px; padding:6px 8px; border-radius:4px; cursor:pointer; white-space:nowrap;}
.vr-op:hover, .vr-op.foco{background:rgba(127,127,127,.16);}
.vr-op.on{font-weight:600;}
.vr-op.on::before{content:'✓'; width:12px; color:var(--accent, var(--hi, #3b82f6));}
.vr-op:not(.on)::before{content:''; width:12px;}
.vr-op .cod{font:11px var(--mono, ui-monospace, monospace); color:var(--fg2, var(--text-3, #999)); margin-left:auto;}
.vr-op.acao{color:var(--accent, var(--hi, #60a5fa));}
.vr-op.perigo{color:var(--err, #f87171);}
.vr-op.off{opacity:.45; cursor:default;}
.vr-div{height:1px; margin:4px 2px; background:var(--border, var(--line, #444));}
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
/* 1.89.2 (pedido do dono, 2026-11-10: "não precisa, só precisa de um top dizendo que é variante"): só a etiqueta no topo,
   sem o contador nem o botão; suprimir/montar fica no Shift+S e no botão direito */
.vr-barra{position:absolute; top:8px; left:50%; transform:translateX(-50%); z-index:30; max-width:calc(100% - 24px);
  padding:3px 12px; border-radius:10px; background:rgba(245,158,11,.92); color:#1a1205; box-shadow:0 2px 8px rgba(0,0,0,.35);
  font:600 11px var(--font, "Segoe UI", sans-serif); letter-spacing:.04em; pointer-events:auto;}
.vr-barra .vr-nome{display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
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
/* "+ Adicionar variante" (1.89.0): o catálogo só com equipamentos; o equipamento dá o nome e o código da variante */
async function cria(projeto){
  if (!podeEditar(projeto)) { toast(motivo(projeto), 'warn', 6000); return null; }
  const C = root.HubCatalogo;
  if (!C || !C.escolhe) { toast('a variante precisa do catálogo (hub-catalogo.js)', 'err'); return null; }
  const est = estadoDe(projeto) || await carrega(projeto, true);
  const item = await C.escolhe({ soEquipamento: true, titulo: 'Equipamento da nova variante', rotulo: 'Equipamento da variante',
    sub: 'a PCB é a mesma: escolha (ou cadastre) só o equipamento — a variante nasce com o nome e o código dele',
    pe: 'o equipamento do projeto padrão e o de outra variante não podem', proibidos: proibidos(est) });
  if (!item) return null;                                   /* cancelou: nada é criado */
  /* 1.89.0 ("precisa por nome da variante"): o nome é obrigatório — a sugestão é o nome do equipamento */
  const nome = await pedeNome(est, item.nome || item.modelo, null, 'Nome da variante (equipamento ' + item.modelo + '). A PCB montada desta variante vai ao Odoo como "<código da placa> <NOME DA VARIANTE>".');
  if (nome == null) return null;
  const j = await pede('/api/variantes/criar', { projeto, nome, codigo: item.modelo, nomeCatalogo: item.nome || '' });
  if (!j.ok) { toast('não criou a variante: ' + j.error, 'err', 8000); return null; }
  poe(projeto, j);
  toast('variante "' + j.variante.nome + '" (' + j.variante.codigo + ') criada — suprima nela o que esse equipamento não monta', 'ok', 6000);
  return j.variante;
}
/* o nome da variante (obrigatório, sem repetir entre as variantes do projeto) -> string | null (cancelou) */
async function pedeNome(est, sugestao, menosId, texto){
  const D = DLG();
  if (!D || !D.texto) return String(sugestao || '').trim() || null;
  const n = await D.texto(texto, { title: menosId ? 'Renomear variante' : 'Nome da variante', v: String(sugestao || ''), ok: menosId ? 'Renomear' : 'Criar variante',
    valida: s => !String(s || '').trim() ? 'dê um nome à variante'
      : ((est && est.variantes) || []).some(v => v.id !== menosId && String(v.nome || '').toLowerCase() === String(s).trim().toLowerCase()) ? 'já existe uma variante com esse nome' : '' });
  return n == null || !String(n).trim() ? null : String(n).trim().replace(/\s+/g, ' ');
}
async function renomeia(projeto, v){
  if (!podeEditar(projeto)) { toast(motivo(projeto), 'warn', 6000); return; }
  const n = await pedeNome(estadoDe(projeto), v.nome, v.id, 'Nome novo da variante (equipamento ' + v.codigo + '):');
  if (n == null || n === v.nome) return;
  const j = await pede('/api/variantes/editar', { projeto, id: v.id, nome: n });
  if (!j.ok) { toast('não renomeou: ' + j.error, 'err', 7000); return; }
  poe(projeto, j);
  toast('variante renomeada: "' + n + '"', 'ok');
}
/* "Trocar equipamento desta variante…": o mesmo catálogo; a variante fica com o nome e o código do equipamento novo */
async function trocaEquipamento(projeto, v){
  if (!podeEditar(projeto)) { toast(motivo(projeto), 'warn', 6000); return; }
  const C = root.HubCatalogo;
  const item = C && C.escolhe ? await C.escolhe({ soEquipamento: true, titulo: 'Equipamento da variante "' + v.nome + '"',
    rotulo: 'Equipamento (hoje ' + v.codigo + ')', sub: 'a PCB é a mesma: só o equipamento muda (os suprimidos ficam)',
    proibidos: proibidos(estadoDe(projeto), v.id) }) : null;
  if (!item || normCod(item.modelo) === v.codigo) return;
  const j = await pede('/api/variantes/editar', { projeto, id: v.id, codigo: item.modelo, nomeCatalogo: item.nome || '' });
  if (!j.ok) { toast('não trocou o equipamento: ' + j.error, 'err', 7000); return; }
  poe(projeto, j);
  toast('variante "' + j.variante.nome + '": equipamento ' + j.variante.codigo, 'ok');
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
  /* 1.89.0: SÓ um dropdown (o nativo não deixa pôr ações nem divisor; este é desenhado aqui) */
  const dd = el('div', 'vr-dd');
  const bt0 = el('button', 'vr-dd-bt'); bt0.type = 'button';
  bt0.title = 'a variante que a vista mostra e que as saídas (BOM, Neoden, lista do Odoo, PDF) usam — nesta máquina';
  const txt = el('span', 'vr-dd-txt'), cod = el('span', 'vr-dd-cod');
  bt0.append(txt, cod, el('span', null, '▾'));
  const lista = el('div', 'vr-dd-lista'); lista.hidden = true; lista.setAttribute('role', 'listbox');
  dd.append(bt0);
  const info = el('div', 'vr-info');
  const chips = el('div', 'vr-chips');
  sec.append(h, dd, info, chips);
  if (o.antes && o.antes.parentNode) o.antes.parentNode.insertBefore(sec, o.antes);
  else caixa.append(sec);
  document.body.append(lista);
  let ocupado = false;
  const fechaLista = () => { lista.hidden = true; dd.classList.remove('aberto'); };
  const abreLista = () => {
    pintaLista();
    lista.hidden = false; dd.classList.add('aberto');
    const r = bt0.getBoundingClientRect();
    lista.style.minWidth = Math.max(220, r.width) + 'px';
    const lr = lista.getBoundingClientRect();
    lista.style.left = Math.max(4, Math.min(r.left, innerWidth - lr.width - 6)) + 'px';
    lista.style.top = (r.bottom + 2 + lr.height > innerHeight - 6 ? Math.max(4, r.top - 2 - lr.height) : r.bottom + 2) + 'px';
  };
  bt0.addEventListener('click', () => { if (ocupado) return; if (lista.hidden) abreLista(); else fechaLista(); });
  document.addEventListener('mousedown', e => { if (!lista.hidden && !lista.contains(e.target) && !dd.contains(e.target)) fechaLista(); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !lista.hidden) { e.stopPropagation(); fechaLista(); } }, true);
  window.addEventListener('resize', fechaLista);
  const vai = async (fn) => { fechaLista(); ocupado = true; bt0.disabled = true; try { await fn(); } finally { ocupado = false; bt0.disabled = false; pinta(); } };
  function opcao(rot, codTxt, cls, titulo, fn){
    const d = el('div', 'vr-op' + (cls ? ' ' + cls : ''));
    d.setAttribute('role', 'option');
    d.append(el('span', null, rot));
    if (codTxt) d.append(el('span', 'cod', codTxt));
    if (titulo) d.title = titulo;
    if (fn && !/\boff\b/.test(cls || '')) d.addEventListener('click', () => vai(fn));
    lista.append(d);
    return d;
  }
  function pintaLista(){
    const e = estadoDe(P), v = ativa(P), pode = podeEditar(P);
    const semPerm = pode ? '' : ' — ' + motivo(P);
    lista.replaceChildren();
    const c0 = (e && e.codigos) || {};
    opcao(rotuloPadrao(c0), codigoPadrao(c0), !v ? 'on' : '', 'o projeto padrão: todos os componentes montados'
      + (c0.equipamentoProjeto ? ' (equipamento ' + c0.equipamentoProjeto + (c0.nomeEquipamentoProjeto ? ' ' + c0.nomeEquipamentoProjeto : '') + ')' : ''), () => troca(P, null));
    for (const x of (e && e.variantes) || [])
      opcao(x.nome || x.codigo, x.codigo, v && v.id === x.id ? 'on' : '', 'a variante "' + (x.nome || x.codigo) + '" (equipamento ' + x.codigo + '): ' + (x.suprimidos || []).length + ' suprimido(s)', () => troca(P, x.id));
    lista.append(el('div', 'vr-div'));
    opcao('+ Adicionar variante', '', 'acao' + (pode ? '' : ' off'), pode ? 'escolha o equipamento da variante no catálogo (a PCB é a mesma)' : 'criar variante é edição' + semPerm,
      () => cria(P).then(nv => { if (nv && o.ativarNova !== false) return troca(P, nv.id); return null; }));
    if (v) {
      lista.append(el('div', 'vr-div'));
      opcao('Renomear esta variante…', '', pode ? '' : 'off', pode ? 'o nome da variante (vai na PCB montada do Odoo: <código da placa> <NOME>)' : 'é edição' + semPerm, () => renomeia(P, v));
      opcao('Trocar equipamento desta variante…', '', pode ? '' : 'off', pode ? 'escolhe outro equipamento no catálogo para "' + v.nome + '"' : 'é edição' + semPerm, () => trocaEquipamento(P, v));
      opcao('Apagar esta variante…', '', 'perigo' + (pode ? '' : ' off'), pode ? 'apaga "' + v.nome + '" (a PCB não muda)' : 'é edição' + semPerm, () => apaga(P, v));
    }
  }
  function pinta(){
    const e = estadoDe(P);
    const v = ativa(P);
    const c = (e && e.codigos) || {};
    txt.textContent = v ? (v.nome || v.codigo) : rotuloPadrao(c);
    cod.textContent = v ? v.codigo : codigoPadrao(c);
    bt0.title = (v ? 'variante "' + v.nome + '" (' + v.codigo + ')' : 'padrão ' + rotuloPadrao(c) + (codigoPadrao(c) ? ' (' + codigoPadrao(c) + ')' : '')) + ' — clique para trocar, adicionar' + (v ? ', renomear, trocar o equipamento ou apagar' : '') + ' (nesta máquina)';
    if (!lista.hidden) pintaLista();
    info.replaceChildren();
    const linha = (rot, val) => { const d = el('div'); d.append(rot + ' ', el('b', null, val || '—')); info.append(d); };
    linha('PCB montada:', c.montada);
    /* 1.89.3: com a variante, o mais curto possível (o dono): "Sem PCB virgem · N suprimido(s)" */
    if (v) info.append(el('div', null, 'Sem PCB virgem · ' + resumoSuprimidos((v.suprimidos || []).length)));
    else linha('PCB virgem:', c.virgem || c.placa);
    if (!v) info.append(el('div', null, (e && e.variantes && e.variantes.length ? e.variantes.length + ' variante(s) — ' : '') + 'na padrão todos os componentes são montados'));
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
  return { pinta, abre: abreLista, fecha: fechaLista };
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
/* a etiqueta no topo da vista com a variante ativa: "VARIANTE <nome> · <código>" (1.89.2: sem contador e sem botão; o
   suprimir/montar é o Shift+S e o botão direito; `selecionados` fica na assinatura para quem já chama) */
function barra(container, projeto, selecionados){ // eslint-disable-line no-unused-vars
  css();
  let b = null;
  const pinta = () => {
    const v = ativa(projeto);
    document.body.classList.toggle('variante-on', Boolean(v));
    if (!v) { if (b) { b.remove(); b = null; } return; }
    if (!b) { b = el('div', 'vr-barra'); b.setAttribute('role', 'status'); b.setAttribute('aria-label', 'Variante de projeto'); container.append(b); }
    b.replaceChildren();
    const nm = el('span', 'vr-nome', textoVariante(v));
    b.title = textoVariante(v) + ' — ' + (v.suprimidos || []).length + ' suprimido(s). A PCB é a mesma; suprimir ou montar: '
      + TECLA + ' ou botão direito no componente (Configurações › Variante de projeto)';
    b.append(nm);
  };
  ouve(p => { if (p === projeto) pinta(); });
  pinta();
  return { pinta };
}

return Object.assign({}, PURO, { carrega, estadoDe, ativa, refsDoProjeto, ouve, monta, alterna, troca, cria, renomeia, trocaEquipamento, apaga, instalaTecla, barra, podeEditar });
});
