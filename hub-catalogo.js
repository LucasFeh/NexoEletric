/* NexoEletric - hub-catalogo.js — o "Definir projeto": o catálogo de todos os produtos numa tela, e de lá o código da
   placa e o código e o nome do equipamento do carimbo.

   Pedido do dono (2026-11-05): "o código da placa é complexo, ele precisa ser definido dentro do catálogo de todos os
   produtos; quero que esse catálogo seja mapeado em uma interface, e o código da placa e o código do equipamento vão
   ser definidos através dele. No menu lateral, em Configurações, vai ter 'Definir projeto': abre um modal com tudo que
   tem no catálogo; dá para pesquisar pelo código, ou adicionar um manualmente caso não tenha; o padrão de criação segue
   os outros; não pode repetir código (mensagem de erro), tanto para PCBs quanto para equipamentos; se der para separar
   em filtro Placas, Produtos, Equipamentos, melhor ainda. Selecionando, os códigos vão para o template".

   O servidor é o tools/rotas/projeto_novo.py, que roda o mcp/lib/catalogo.js (o mesmo motor do Novo projeto):
     GET  /api/catalogo                    a lista (com o grupo: placa, equipamento, produto)
     GET  /api/projeto/novo/previa         o código que um item novo vai ganhar (nome, tipo, sigla)
     POST /api/catalogo/registrar          grava o item novo na planilha (recusa código ou nome repetido)
   O que a escolha grava, no cabeçalho do schematic.js: CodigoDaPlaca, CodigoDoEquipamento, NomeDoEquipamento (os
   nomes do template da casa e do Altium; hub-schtemplate.js » DO_PROJETO). Os nomes de antes saem.

   HubCatalogo.monta(caixa, ganchos)   o botão "Definir projeto" nas Configurações da vista Esquema
   HubCatalogo.abre(ganchos)           o modal;  ganchos = {schematic(), mudou()}
   HubCatalogo.abreDaFolha()           o mesmo, com os ganchos do monta */
(function (root) {
'use strict';
const T = () => root.HubSchTemplate;
const DLG = () => root.HubDialog;
const ANTIGOS = ['Desenho_linha_unica', 'Desenho_linha_um', 'Desenho_linha_dois', 'Equipamento_linha_um', 'Equipamento_linha_dois', 'Equipamento_linha_unica'];
const GRUPOS = [['todos', 'Todos'], ['placa', 'Placas'], ['equipamento', 'Equipamentos'], ['produto', 'Produtos']];
const TIPOS_NOVOS = [['PLACA', 'Placa', 'placa'], ['EQUIPAMENTO', 'Equipamento', 'equipamento'], ['SISTEMA', 'Sistema', 'equipamento'],
                     ['ACESSÓRIOS', 'Acessório', 'produto'], ['CABO', 'Cabo', 'produto'], ['SOFTWARE', 'Software', 'produto']];
const MAX = 400;

const CSS = `
.ct-ov{position:fixed; inset:0; z-index:65; background:var(--scrim, rgba(11,11,13,.6)); display:flex; align-items:center; justify-content:center;
  color:var(--fg, var(--text, #ddd)); font:13px/1.45 var(--font, "Segoe UI", system-ui, sans-serif);}
.ct-box{width:min(1180px, 96vw); height:min(880px, 92vh); display:flex; flex-direction:column; background:var(--panel, var(--surface, #222));
  border:1px solid var(--border, var(--line, #444)); border-radius:8px; box-shadow:var(--shadow-menu, 0 8px 30px rgba(0,0,0,.5));}
.ct-hd{display:flex; align-items:baseline; gap:10px; padding:10px 14px; border-bottom:1px solid var(--border, var(--line, #444));}
.ct-hd h2{font-size:14px; font-weight:600; margin:0;}
.ct-dim{font-size:11px; color:var(--fg-dim, var(--text-3, #999));}
.ct-escolha{display:grid; grid-template-columns:1fr 1fr; gap:10px; padding:10px 14px; border-bottom:1px solid var(--border, var(--line, #444));}
.ct-slot{border:1px dashed var(--border, var(--line, #555)); border-radius:6px; padding:7px 10px; min-height:44px; display:flex; align-items:center; gap:8px;}
.ct-slot.cheio{border-style:solid; border-color:var(--accent, var(--hi, #3b82f6));}
.ct-slot .rot{font-size:10px; text-transform:uppercase; letter-spacing:.08em; color:var(--fg-dim, var(--text-3, #999)); width:92px; flex:none;}
.ct-slot .val{flex:1; min-width:0;}
.ct-slot .cod{font:600 13px var(--mono, ui-monospace, monospace);}
.ct-slot .nm{font-size:12px; color:var(--fg-dim, var(--text-2, #bbb)); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.ct-barra{display:flex; gap:8px; align-items:center; padding:8px 14px; flex-wrap:wrap;}
.ct-barra input[type=search]{flex:1; min-width:220px;}
.ct-box input, .ct-box select{background:var(--panel2, var(--sunken, #1a1a1a)); color:var(--fg, var(--text, #ddd)); border:1px solid var(--border, var(--line, #444));
  border-radius:4px; padding:5px 8px; font:12px var(--font, sans-serif); min-width:0;}
.ct-box input:focus, .ct-box select:focus{outline:none; border-color:var(--accent, var(--hi, #3b82f6));}
.ct-box button{cursor:pointer; padding:5px 11px; border-radius:5px; border:1px solid var(--border, var(--line, #444));
  background:var(--panel2, var(--surface-2, #2a2a2a)); color:var(--fg, var(--text, #ddd)); font:12px var(--font, sans-serif);}
.ct-box button:hover:not(:disabled){border-color:var(--accent, var(--hi, #3b82f6));}
.ct-box button:disabled{opacity:.45; cursor:default;}
.ct-box button.on, .ct-box button.prim{background:var(--accent, var(--hi, #3b82f6)); border-color:var(--accent, var(--hi, #3b82f6)); color:var(--on-hi, #fff);}
.ct-lista{flex:1; overflow:auto; margin:0 14px; border:1px solid var(--border, var(--line, #444)); border-radius:6px;}
.ct-lista table{width:100%; border-collapse:collapse; font-size:12px;}
.ct-lista th{position:sticky; top:0; background:var(--panel, var(--surface, #222)); text-align:left; font-weight:600; padding:6px 8px;
  border-bottom:1px solid var(--border, var(--line, #444)); color:var(--fg-dim, var(--text-2, #bbb)); z-index:1;}
.ct-lista td{padding:5px 8px; border-bottom:1px solid rgba(127,127,127,.12); vertical-align:top;}
.ct-lista tr{cursor:pointer;}
.ct-lista tr:hover td{background:rgba(127,127,127,.10);}
.ct-lista tr.sel td{background:rgba(59,130,246,.16);}
.ct-lista td.cod{font-family:var(--mono, ui-monospace, monospace); white-space:nowrap;}
.ct-lista td.vin{color:var(--fg-dim, var(--text-3, #999)); max-width:240px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.ct-lista td.acoes{white-space:nowrap; width:1%;}
.ct-lista td.acoes button{padding:2px 8px; font-size:11px;}
.ct-g{font-size:10px; padding:0 6px; border-radius:8px; border:1px solid currentColor; white-space:nowrap;}
.ct-g.placa{color:#22c55e;} .ct-g.equipamento{color:#60a5fa;} .ct-g.produto{color:#f59e0b;}
.ct-novo{margin:8px 14px 0; padding:10px; border:1px solid var(--border, var(--line, #444)); border-radius:6px; display:grid;
  grid-template-columns:repeat(4, minmax(0, 1fr)) auto; gap:8px; align-items:end;}
.ct-novo[hidden]{display:none;}
.ct-novo label{display:flex; flex-direction:column; gap:3px; font-size:11px; color:var(--fg-dim, var(--text-3, #999));}
.ct-novo .ct-cod{font:600 13px var(--mono, ui-monospace, monospace); color:var(--fg, var(--text, #ddd));}
.ct-erro{color:var(--err, #f87171); font-size:12px; padding:0 14px; min-height:1.3em;}
.ct-pe{display:flex; gap:8px; align-items:center; padding:10px 14px; border-top:1px solid var(--border, var(--line, #444)); margin-top:8px;}
.ct-pe .sp{flex:1;}
.ct-sec{display:flex; flex-direction:column; gap:4px;}
.ct-sec .ct-resumo{font-size:11px; color:var(--fg-dim, var(--text-3, #999)); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
`;
function css(){
  if (document.getElementById('ct-css')) return;
  const s = document.createElement('style'); s.id = 'ct-css'; s.textContent = CSS; document.head.append(s);
}
function el(tag, cls, txt){ const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
function bt(txt, titulo, fn, cls){ const b = el('button', cls || null, txt); b.type = 'button'; if (titulo) b.title = titulo; b.addEventListener('click', fn); return b; }
const norm = s => String(s || '').replace(/\s+/g, '').toUpperCase();
const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function toast(t, k, ms){ const D = DLG(); if (D && D.toast) D.toast(t, k || 'info', ms); }

/* o catálogo, lido uma vez por abertura (a planilha mora no NAS; ler de novo a cada tecla seria lento) */
async function carregaCatalogo(){
  const j = await (await fetch('/api/catalogo', { cache:'no-store' })).json();
  if (!j || !j.ok) throw new Error((j && j.error) || 'sem resposta');
  return j;
}
/* os códigos que um texto cita ("Placa do equipamento ID-DI96277 ...") */
const codigosNoTexto = t => (String(t || '').toUpperCase().match(/[A-Z][A-Z0-9]{0,11}\s*-\s*DI\s*\d{4,8}/g) || []).map(norm);

let ganchosDaFolha = null;

function monta(caixa, ganchos){
  if (!caixa) return;
  css();
  ganchosDaFolha = ganchos;
  const sec = el('div', 'sec ct-sec');
  const b = bt('Definir projeto', 'código da placa e código e nome do equipamento do carimbo, do catálogo de todos os produtos', () => abre(ganchos));
  b.style.width = '100%';
  const resumo = el('div', 'ct-resumo');
  sec.append(b, resumo);
  caixa.after(sec);
  const pinta = () => {
    const p = T() ? T().parseParams(ganchos.schematic().params) : {};
    const placa = p.CodigoDaPlaca || p.Desenho_linha_unica || '';
    const eq = p.CodigoDoEquipamento || p.Equipamento_linha_dois || '';
    resumo.textContent = placa || eq ? 'placa ' + (placa || '—') + ' · equipamento ' + (eq || '—') : 'projeto ainda não definido no catálogo';
    resumo.title = (p.NomeDoEquipamento || p.Equipamento_linha_um || '');
  };
  ganchos._pinta = pinta;
  pinta();
}
function abreDaFolha(){ if (ganchosDaFolha) abre(ganchosDaFolha); }

function abre(g){
  css();
  const sch = g.schematic();
  const T0 = T();
  const p0 = T0.parseParams(sch.params);
  /* a escolha: {modelo, nome, item?, cliente?} por papel */
  const esc = {
    placa: (p0.CodigoDaPlaca || p0.Desenho_linha_unica) ? { modelo: p0.CodigoDaPlaca || p0.Desenho_linha_unica, nome: '' } : null,
    equip: (p0.CodigoDoEquipamento || p0.Equipamento_linha_dois || p0.NomeDoEquipamento || p0.Equipamento_linha_um)
      ? { modelo: p0.CodigoDoEquipamento || p0.Equipamento_linha_dois || '', nome: p0.NomeDoEquipamento || p0.Equipamento_linha_um || '' } : null,
  };
  let itens = [], grupo = 'todos', cat = null;

  const ov = el('div', 'ct-ov'), bx = el('div', 'ct-box');
  const hd = el('div', 'ct-hd');
  hd.append(el('h2', null, 'Definir projeto'), el('span', 'ct-dim', 'catálogo de todos os produtos — clique numa placa para o código da placa, num equipamento para o equipamento'));
  /* as duas escolhas */
  const escolha = el('div', 'ct-escolha');
  const slot = (rot, papel) => {
    const s = el('div', 'ct-slot');
    const val = el('div', 'val');
    const x = bt('✕', 'tirar', () => { esc[papel] = null; pintaSlots(); pintaLista(); });
    s.append(el('span', 'rot', rot), val, x);
    return { s, val, x };
  };
  const sPlaca = slot('Código da placa', 'placa'), sEquip = slot('Equipamento', 'equip');
  escolha.append(sPlaca.s, sEquip.s);
  /* a busca e os filtros */
  const barra = el('div', 'ct-barra');
  const busca = el('input'); busca.type = 'search'; busca.placeholder = 'pesquisar por código, nome, cliente ou descrição…';
  const filtros = el('div'); filtros.style.cssText = 'display:flex; gap:4px';
  const bFiltro = {};
  for (const [id, rot] of GRUPOS){ const b = bt(rot, null, () => { grupo = id; pintaFiltros(); pintaLista(); }); bFiltro[id] = b; filtros.append(b); }
  const conta = el('span', 'ct-dim');
  const bNovo = bt('+ Adicionar ao catálogo', 'quando o produto ainda não está no catálogo', () => { novo.hidden = !novo.hidden; if (!novo.hidden) iNome.focus(); });
  barra.append(busca, filtros, conta, bNovo);
  /* o item novo */
  const novo = el('div', 'ct-novo'); novo.hidden = true;
  const lab = (rot, input) => { const l = el('label'); l.append(document.createTextNode(rot), input); return l; };
  const sTipo = el('select');
  for (const [v, r] of TIPOS_NOVOS){ const o = el('option', null, r); o.value = v; sTipo.append(o); }
  const iNome = el('input'); iNome.placeholder = 'nome do produto';
  const iCli = el('input'); iCli.placeholder = 'cliente';
  const iVin = el('input'); iVin.placeholder = 'para que serve / de qual equipamento';
  const iSig = el('input'); iSig.placeholder = 'sigla'; iSig.style.textTransform = 'uppercase';
  const cod = el('span', 'ct-cod', '—');
  const bReg = bt('Registrar', 'grava a linha nova no catálogo de todos os produtos', () => registra(), 'prim');
  const lSig = el('label'); lSig.append(document.createTextNode('código'));
  const sigLin = el('div'); sigLin.style.cssText = 'display:flex; gap:6px; align-items:center'; iSig.style.width = '90px'; sigLin.append(iSig, cod); lSig.append(sigLin);
  novo.append(lab('tipo', sTipo), lab('nome', iNome), lab('cliente', iCli), lab('descrição (vínculo)', iVin), bReg, lSig);
  lSig.style.gridColumn = '1 / span 2';
  const erro = el('div', 'ct-erro');
  const lista = el('div', 'ct-lista');
  const pe = el('div', 'ct-pe');
  const fecha = () => { ov.remove(); document.removeEventListener('keydown', tecla, true); };
  const tecla = e => { if (e.key === 'Escape'){ e.stopPropagation(); e.preventDefault(); fecha(); } };
  const bDef = bt('Definir', 'grava no carimbo do projeto (Salvar para ir ao disco)', () => define(), 'prim');
  pe.append(el('span', 'ct-dim', 'os códigos vão para o carimbo; o projeto aprovado perde a aprovação (é uma modificação)'), el('span', 'sp'),
            bt('Cancelar', null, fecha), bDef);
  bx.append(hd, escolha, barra, novo, erro, lista, pe);
  ov.append(bx); document.body.append(ov);
  document.addEventListener('keydown', tecla, true);
  ov.addEventListener('mousedown', e => { if (e.target === ov) fecha(); });

  /* o código exato; senão o mesmo número DI (a descrição diz "ID-DI96277" e o catálogo tem "DI96277") */
  function achaPorCodigo(c, porNumero){
    const n = norm(c);
    if (!n) return null;
    const exato = itens.find(i => norm(i.modelo) === n);
    if (exato || !porNumero) return exato || null;
    const num = (/DI\d+$/.exec(n) || [''])[0];
    return num ? itens.find(i => { const m = norm(i.modelo); return m === num || m.endsWith('-' + num); }) || null : null;
  }
  function pintaSlots(){
    for (const [s, v] of [[sPlaca, esc.placa], [sEquip, esc.equip]]){
      s.s.classList.toggle('cheio', Boolean(v));
      s.val.replaceChildren();
      s.x.hidden = !v;
      if (!v){ s.val.append(el('div', 'nm', '— nenhum —')); continue; }
      const i = v.item ? v : (achaPorCodigo(v.modelo) || v);
      s.val.append(el('div', 'cod', i.modelo || '—'), el('div', 'nm', (i.nome || v.nome || '') + (i.cliente ? ' · ' + i.cliente : '')));
    }
  }
  function pintaFiltros(){ for (const [id] of GRUPOS) bFiltro[id].classList.toggle('on', grupo === id); }
  function pintaLista(){
    if (!cat){ return; }
    const q = semAcento(busca.value.trim());
    const qc = norm(busca.value);
    const achou = itens.filter(i => (grupo === 'todos' || i.grupo === grupo)
      && (!q || semAcento(i.modelo + ' ' + i.nome + ' ' + i.cliente + ' ' + i.vinculo + ' ' + i.tipo).includes(q) || (qc && norm(i.modelo).includes(qc))));
    conta.textContent = achou.length + ' de ' + itens.length;
    const tb = el('tbody');
    const sel = new Set([esc.placa && norm(esc.placa.modelo), esc.equip && norm(esc.equip.modelo)].filter(Boolean));
    for (const i of achou.slice(0, MAX)){
      const tr = el('tr');
      tr.title = i.vinculo || '';
      if (sel.has(norm(i.modelo))) tr.className = 'sel';
      const g = el('span', 'ct-g ' + i.grupo, i.tipo || i.grupo);
      const tdG = el('td'); tdG.append(g);
      const tdA = el('td', 'acoes');
      tdA.append(bt('Placa', 'usar como código da placa', ev => { ev.stopPropagation(); usa(i, 'placa'); }),
                 document.createTextNode(' '),
                 bt('Equip.', 'usar como equipamento (código e nome)', ev => { ev.stopPropagation(); usa(i, 'equip'); }));
      tr.append(el('td', null, String(i.item)), tdG, el('td', 'cod', i.modelo), el('td', null, i.nome), el('td', null, i.cliente), el('td', 'vin', i.vinculo), tdA);
      tr.addEventListener('click', () => usa(i, i.grupo === 'placa' ? 'placa' : 'equip'));
      tb.append(tr);
    }
    const tab = el('table');
    const th = el('thead'); const hr = el('tr');
    for (const h of ['item', 'tipo', 'código', 'nome', 'cliente', 'descrição', '']) hr.append(el('th', null, h));
    th.append(hr); tab.append(th, tb);
    lista.replaceChildren(tab);
    if (achou.length > MAX) lista.append(el('div', 'ct-dim', 'mostrando ' + MAX + ' de ' + achou.length + ': refine a pesquisa'));
    if (!achou.length) lista.append(el('div', 'ct-dim', 'nada com essa pesquisa' + (grupo !== 'todos' ? ' neste filtro' : '') + ' — "+ Adicionar ao catálogo" registra um novo'));
  }
  function usa(i, papel){
    esc[papel] = i;
    /* a placa que diz de qual equipamento é ("Placa do equipamento ID-DI96277"): o equipamento vem junto, se ainda vazio */
    if (papel === 'placa' && (!esc.equip || !esc.equip.modelo)){
      for (const c of codigosNoTexto(i.vinculo + ' ' + i.nome)){ const e = achaPorCodigo(c, true); if (e && e.grupo !== 'placa'){ esc.equip = e; break; } }
    }
    erro.textContent = '';
    pintaSlots(); pintaLista();
  }
  /* o código que o item novo vai ganhar (o mesmo motor do Novo projeto) */
  let tPrev = null, seq = 0;
  const previa = () => {
    clearTimeout(tPrev);
    tPrev = setTimeout(async () => {
      const n = ++seq;
      const q = new URLSearchParams({ nome: iNome.value.trim(), sigla: iSig.dataset.mexida ? iSig.value.trim() : '', tipo: sTipo.value });
      let j = null;
      try { j = await (await fetch('/api/projeto/novo/previa?' + q, { cache:'no-store' })).json(); } catch (e) { j = null; }
      if (n !== seq || !j || !j.ok) return;
      if (!iSig.dataset.mexida) iSig.value = j.sigla;
      cod.textContent = j.codigo;
      const dup = achaPorCodigo(j.codigo);
      erro.textContent = dup ? 'o código ' + j.codigo + ' já existe (item ' + dup.item + ')' : '';
    }, 300);
  };
  iNome.addEventListener('input', previa); sTipo.addEventListener('change', previa);
  iSig.addEventListener('input', () => { iSig.dataset.mexida = iSig.value.trim() ? '1' : ''; previa(); });
  async function registra(){
    const nome = iNome.value.trim();
    if (!nome){ erro.textContent = 'dê o nome do produto'; iNome.focus(); return; }
    const gr = (TIPOS_NOVOS.find(t => t[0] === sTipo.value) || [])[2];
    const igual = itens.find(i => i.grupo === gr && semAcento(i.nome).trim() === semAcento(nome));
    if (igual){ erro.textContent = '"' + nome + '" já está no catálogo com o código ' + igual.modelo + ' (item ' + igual.item + '): use esse'; return; }
    bReg.disabled = true; bReg.textContent = 'Registrando…';
    let j = null;
    try {
      const r = await fetch('/api/catalogo/registrar', { method:'POST', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ tipo: sTipo.value, nome, cliente: iCli.value.trim(), vinculo: iVin.value.trim(), sigla: iSig.value.trim() }) });
      j = await r.json();
    } catch (e) { j = { ok:false, error:String(e && e.message || e) }; }
    bReg.disabled = false; bReg.textContent = 'Registrar';
    if (!j || !j.ok){ erro.textContent = 'não registrou: ' + ((j && j.error) || 'sem resposta'); return; }
    const i = { item: j.item, tipo: j.tipo, grupo: gr || 'produto', nome: j.nome, cliente: iCli.value.trim().toUpperCase(), modelo: j.codigo, vinculo: iVin.value.trim() };
    itens.unshift(i);
    for (const x of [iNome, iCli, iVin, iSig]) x.value = '';
    delete iSig.dataset.mexida; cod.textContent = '—'; novo.hidden = true;
    usa(i, i.grupo === 'placa' ? 'placa' : 'equip');
    toast(j.codigo + ' registrado no catálogo (item ' + j.item + ')', 'ok', 5000);
  }
  function define(){
    const p = T0.parseParams(sch.params);
    for (const k of ANTIGOS) delete p[k];
    if (esc.placa) p.CodigoDaPlaca = esc.placa.modelo; else delete p.CodigoDaPlaca;
    if (esc.equip){
      if (esc.equip.modelo) p.CodigoDoEquipamento = esc.equip.modelo; else delete p.CodigoDoEquipamento;
      if (esc.equip.nome) p.NomeDoEquipamento = String(esc.equip.nome).toUpperCase(); else delete p.NomeDoEquipamento;
    } else { delete p.CodigoDoEquipamento; delete p.NomeDoEquipamento; }
    const cli = (esc.equip && esc.equip.cliente) || (esc.placa && esc.placa.cliente);
    if (cli) p.Cliente = String(cli).toUpperCase();
    const s = T0.serializaParams(p);
    if (s) sch.params = s; else delete sch.params;
    g.mudou();
    if (g._pinta) g._pinta();
    fecha();
    toast('projeto definido: placa ' + (p.CodigoDaPlaca || '—') + ' · equipamento ' + (p.CodigoDoEquipamento || '—'), 'ok', 5000);
  }

  pintaSlots(); pintaFiltros();
  lista.append(el('div', 'ct-dim', 'abrindo o catálogo de todos os produtos…'));
  busca.addEventListener('input', pintaLista);
  carregaCatalogo().then(j => {
    cat = j;
    itens = (j.itens || []).slice().sort((a, b) => b.item - a.item);
    pintaSlots(); pintaLista();
    busca.focus();
  }, e => {
    lista.replaceChildren(el('div', 'ct-erro', 'o catálogo não abriu: ' + (e && e.message || e)));
  });
}

root.HubCatalogo = { monta, abre, abreDaFolha, codigosNoTexto };
})(typeof window !== 'undefined' ? window : globalThis);
