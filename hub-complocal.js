/* NexoEletric - hub-complocal.js — Biblioteca » Componentes novos: criar a peça que o almoxarifado do Odoo ainda não tem.

   Pedido do dono (2026-11-03): "uma área pra criação de novos componentes no NexoEletric, diferenciados dos que vêm
   da lib do Odoo, uma tag dizendo 'criado localmente' ... todos os parâmetros necessários pro envio do Odoo". O
   contrato é o prompt-nexoeletric-componente-novo.md: a ficha é o bloco `componente` (os campos x_* do produto) que
   o "Enviar para o Odoo" manda na linha da peça nova; o almoxarifado cria com um clique, e no sincronismo seguinte a
   peça volta como do almoxarifado e perde a tag.

   O FORMULÁRIO SE MONTA PELO ODOO. Família, montagem, polaridade, dielétrico, gênero, ângulo, os encapsulamentos e
   os subtipos de conector são as listas que ele responde (/api/locais/regras); o perfil da família diz o que ela
   pede (valor, vias, polaridade, quais atributos). Nada disso fica cravado aqui — a seção 5 do contrato pede isso.
   Sem o Odoo (sem senha, fora da rede), os campos viram texto livre e o aviso diz por quê.

   Quem grava é o servidor (tools/rotas/componentes_locais.py): esta tela só monta o pedido e mostra o recibo. O
   "Conferir no Odoo" é o di_confere_lista (ensaio, não grava nada lá) e mostra pronto / faltas / erros e o nome que
   a peça vai ter. A IA faz o mesmo pelo MCP (local_*).

   Autossuficiente como o hub-odoocfg.js: o próprio CSS e os próprios rótulos. Da casca: o <script src>; quem monta é
   o hub-libview.js, na sub-aba "Componentes novos". */
"use strict";
var HubCompLocal = (function () {

const CSS = `
.cl{display:grid; grid-template-columns:minmax(260px,330px) minmax(0,1fr); height:100%; min-height:0;}
.cl-lista{border-right:1px solid var(--line,#3a3a3a); display:flex; flex-direction:column; min-height:0;}
.cl-topo{display:flex; align-items:center; gap:8px; padding:10px 12px; border-bottom:1px solid var(--line,#3a3a3a);}
.cl-topo h3{flex:1; margin:0; font:500 12px var(--font,'Segoe UI',sans-serif); color:var(--text-2,#b8b8b8);}
.cl-itens{flex:1; overflow:auto; padding:6px;}
.cl-it{display:block; width:100%; text-align:left; border:0; background:transparent; color:var(--text,#d8d8d8);
  padding:8px 10px; border-radius:6px; cursor:pointer; margin-bottom:2px; font:inherit;}
.cl-it:hover{background:rgba(255,255,255,.05);}
.cl-it[aria-selected="true"]{background:rgba(var(--tint,79,195,247),.12); box-shadow:inset 2px 0 0 var(--hi,#4fc3f7);}
.cl-it .n{font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.cl-it .m{font-size:11px; color:var(--text-4,#7a7a7a); margin-top:3px; display:flex; gap:6px; flex-wrap:wrap; align-items:center;}
.cl-tag{font-size:10px; line-height:1.4; padding:1px 7px; border-radius:999px; white-space:nowrap;
  border:1px solid var(--hi,#4fc3f7); color:var(--hi,#4fc3f7);}
.cl-st{font-size:10px; padding:1px 6px; border-radius:3px; background:rgba(255,255,255,.06); color:var(--text-3,#9a9a9a);}
.cl-st.ok{color:var(--ok,#00e676);} .cl-st.warn{color:var(--warn,#ffb74d);} .cl-st.err{color:var(--err,#ff6b6b);}
.cl-sec-t{font-size:10px; letter-spacing:.09em; text-transform:uppercase; color:var(--text-4,#7a7a7a); padding:12px 6px 4px;}
.cl-vazio{font-size:12px; color:var(--text-4,#7a7a7a); padding:14px 10px; line-height:1.5;}
.cl-ficha{overflow:auto; padding:14px 18px 40px; min-height:0;}
.cl-ficha h2{margin:0 0 4px; font:500 15px var(--font,'Segoe UI',sans-serif); color:var(--text,#d8d8d8);}
.cl-sub{font-size:11px; color:var(--text-4,#7a7a7a); margin-bottom:12px;}
.cl-grupo{margin:16px 0 6px; font-size:10px; letter-spacing:.09em; text-transform:uppercase; color:var(--text-4,#7a7a7a);}
.cl-grade{display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:8px 12px;}
.cl-campo{display:flex; flex-direction:column; gap:3px; min-width:0;}
.cl-campo > label{font-size:11px; color:var(--text-3,#9a9a9a);}
.cl-campo > label b{color:var(--warn,#ffb74d); font-weight:500;}
.cl-campo .input, .cl-campo select, .cl-campo textarea{width:100%; box-sizing:border-box; min-height:30px;}
.cl-campo textarea{min-height:56px; font:11px var(--mono,Consolas,monospace); resize:vertical;}
.cl-larga{grid-column:1 / -1;}
.cl-link{display:grid; grid-template-columns:140px minmax(0,1fr) auto; gap:6px; margin-bottom:6px;}
.cl-bar{display:flex; gap:8px; flex-wrap:wrap; margin-top:18px; align-items:center;}
.cl-bar .sep{flex:1;}
.cl-aviso{font-size:11px; line-height:1.5; margin-top:8px; color:var(--warn,#ffb74d);}
.cl-conf{margin-top:16px; border:1px solid var(--line,#3a3a3a); border-radius:6px; padding:10px 12px; font-size:12px; line-height:1.5;}
.cl-conf.ok{border-color:var(--ok,#00e676);} .cl-conf.err{border-color:var(--warn,#ffb74d);}
.cl-conf ul{margin:4px 0 0 16px; padding:0;} .cl-conf li{margin:2px 0;}
.cl-conf .np{font:12px var(--mono,Consolas,monospace); color:var(--text,#d8d8d8);}
.cl-dica{font-size:11px; color:var(--text-4,#7a7a7a);}
`;

const ROT = {
  x_familia: 'Família', x_subtipo: 'Subtipo', x_montagem: 'Montagem', x_encapsulamento: 'Encapsulamento',
  x_mpn: 'MPN (código do fabricante)', x_fabricante: 'Fabricante', x_valor_txt: 'Valor', x_vias: 'Vias',
  x_polaridade: 'Polaridade', x_tensao: 'Tensão', x_potencia: 'Potência', x_corrente: 'Corrente',
  x_tolerancia: 'Tolerância', x_coeficiente: 'Coeficiente', x_dieletrico: 'Dielétrico', x_carga: 'Carga',
  x_dimensao: 'Dimensão', x_passo: 'Passo', x_genero: 'Gênero', x_angulo: 'Ângulo', x_pinos: 'Pinos',
  x_pinagem: 'Pinagem', x_designator: 'Designator',
};
const DICA = {
  x_valor_txt: 'número com o sufixo colado: 10K, 4.7K, 100nF, 16MHz, 40V (ponto decimal)',
  x_tensao: '50V, 6.3V, 250VAC', x_potencia: '1/4W, 500mW', x_corrente: '1A, 200mA', x_tolerancia: '1%, 20%',
  x_coeficiente: '100ppm', x_carga: '18pF', x_dimensao: 'D10x20mm (use D, nunca Ø)', x_passo: 'P2.54mm',
  x_pinagem: '1:VDD:Power;2:RA0:IO — sai sozinha dos pinos do símbolo', x_designator: 'só se for diferente do padrão da família',
  x_encapsulamento: 'o pacote da biblioteca do Odoo; NA quando não há pacote nomeável',
};
/* listas fechadas que viram <select> quando o Odoo responde (fields_get) */
const LISTAS = ['x_familia', 'x_montagem', 'x_polaridade', 'x_dieletrico', 'x_genero', 'x_angulo'];
const TODOS_ATRIB = ['tensao', 'potencia', 'corrente', 'tolerancia', 'coeficiente', 'dieletrico', 'carga', 'dimensao', 'passo', 'genero', 'angulo'];
const SITUACAO = { pronto: ['pronto para o Odoo', 'ok'], 'com faltas': ['com faltas', 'warn'], 'nao conferido': ['não conferido', ''],
                   incompleto: ['incompleto', 'err'], integrado: ['integrado', 'ok'] };

const ST = { box: null, lista: [], integrados: [], sel: null, novo: false, regras: null, regrasErro: '', opcoes: null,
             perfis: {}, form: null, carregado: false, ocupado: false };

const nel = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
const toast = (m, t) => { if (window.HubDialog && HubDialog.toast) HubDialog.toast(m, t || 'info'); else if (typeof window.toast === 'function') window.toast(m, t); };
async function api(url, corpo){
  const req = corpo ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) } : undefined;
  let r, j = {};
  try { r = await fetch(url, req); } catch (e) { return { ok: false, error: 'sem servidor: ' + (e.message || e) }; }
  try { j = await r.json(); } catch (e) {}
  if (!r.ok) return Object.assign({ ok: false, error: j.error || ('HTTP ' + r.status) }, j, { ok: false });
  return j;
}

function poeCss(){
  if (document.getElementById('cl-css')) return;
  const st = nel('style'); st.id = 'cl-css'; st.textContent = CSS; document.head.append(st);
}

/* ── a montagem ── */
function monta(host){
  poeCss();
  if (!host) return;
  if (!ST.box || !host.contains(ST.box)){
    ST.box = nel('div', 'cl');
    host.textContent = '';
    host.append(ST.box);
  }
  carrega();
}

async function carrega(){
  const j = await api('/api/locais');
  if (j.ok){ ST.lista = j.componentes || []; ST.integrados = j.integrados || []; }
  else { ST.lista = []; ST.integrados = []; ST.erroLista = j.error; }
  if (!ST.opcoes){ const o = await api('/api/locais/opcoes'); if (o.ok) ST.opcoes = o; }
  if (!ST.regras && !ST.regrasErro){
    const r = await api('/api/locais/regras');
    if (r.ok) ST.regras = r; else ST.regrasErro = r.error || 'o Odoo não respondeu';
  }
  ST.carregado = true;
  if (ST.sel && !ST.lista.some(x => x.id === ST.sel) && !ST.integrados.some(x => x.id === ST.sel)) ST.sel = null;
  desenha();
}

function desenha(){
  if (!ST.box) return;
  ST.box.textContent = '';
  ST.box.append(desenhaLista(), desenhaFicha());
}

function desenhaLista(){
  const col = nel('div', 'cl-lista');
  const topo = nel('div', 'cl-topo');
  topo.append(nel('h3', null, 'Componentes criados localmente'));
  const bNovo = nel('button', 'btn btn-secondary btn-sm', '+ Novo');
  bNovo.type = 'button';
  bNovo.title = 'Criar um componente que o almoxarifado do Odoo ainda não tem';
  bNovo.onclick = () => { ST.sel = null; ST.novo = true; ST.form = null; desenha(); };
  topo.append(bNovo);
  col.append(topo);
  const itens = nel('div', 'cl-itens');
  if (ST.erroLista) itens.append(nel('div', 'cl-vazio', 'Não deu para ler os componentes locais: ' + ST.erroLista));
  else if (!ST.lista.length) itens.append(nel('div', 'cl-vazio', ST.carregado
      ? 'Nenhum componente criado localmente. Use "+ Novo" para a peça que não está no almoxarifado: ela vai com a ficha completa no "Enviar para o Odoo".'
      : 'carregando…'));
  for (const c of ST.lista) itens.append(item(c));
  if (ST.integrados.length){
    itens.append(nel('div', 'cl-sec-t', 'integrados ao almoxarifado (' + ST.integrados.length + ')'));
    for (const c of ST.integrados) itens.append(item(c));
  }
  col.append(itens);
  return col;
}

function item(c){
  const b = nel('button', 'cl-it');
  b.type = 'button';
  b.setAttribute('aria-selected', String(ST.sel === c.id));
  b.append(nel('div', 'n', c.nome));
  const m = nel('div', 'm');
  if (c.tag) m.append(nel('span', 'cl-tag', c.tag));
  const [txt, tom] = SITUACAO[c.situacao] || [c.situacao, ''];
  const st = nel('span', 'cl-st' + (tom ? ' ' + tom : ''), txt);
  if (c.faltaLocal && c.faltaLocal.length) st.title = c.faltaLocal.join(', ');
  m.append(st, document.createTextNode([c.familia, c.mpn].filter(Boolean).join(' · ')));
  b.append(m);
  b.title = c.nome + (c.integrado ? '\nintegrado: produto ' + c.integrado.odoo + ' do Odoo' : '');
  b.onclick = () => { ST.sel = c.id; ST.novo = false; ST.form = null; desenha(); };
  return b;
}

/* ── a ficha ── */
function atual(){ return ST.lista.find(x => x.id === ST.sel) || ST.integrados.find(x => x.id === ST.sel) || null; }

function desenhaFicha(){
  const f = nel('div', 'cl-ficha');
  const c = atual();
  if (!c && !ST.novo){
    f.append(nel('div', 'cl-vazio', 'Escolha um componente à esquerda, ou crie um com "+ Novo".\n\n'
      + 'O componente criado aqui aparece no "Adicionar componentes" da vista Esquema com a tag "criado localmente". '
      + 'No "Enviar para o Odoo" ele vai com a ficha completa; o almoxarifado cria a peça com um clique, e no sincronismo '
      + 'seguinte ela vira peça do almoxarifado e perde a tag.'));
    f.lastChild.style.whiteSpace = 'pre-line';
    return f;
  }
  if (!ST.form) ST.form = formDe(c);
  const F = ST.form;
  f.append(nel('h2', null, c ? c.nome : 'Novo componente'));
  const sub = nel('div', 'cl-sub');
  if (c){
    if (c.tag) sub.append(nel('span', 'cl-tag', c.tag), document.createTextNode('  '));
    sub.append(document.createTextNode(c.id + (c.criado ? ' · criado em ' + c.criado : '') + (c.por ? ' por ' + c.por : '')));
  } else sub.textContent = 'a peça que o almoxarifado do Odoo ainda não tem';
  f.append(sub);
  if (c && c.integrado){
    const a = nel('div', 'cl-conf ok');
    a.textContent = 'Integrado ao almoxarifado: produto ' + c.integrado.odoo + ' do Odoo ("' + (c.integrado.nome || '') + '"), em '
      + (c.integrado.em || '') + '. Os esquemas que usam este componente passam a ir com o product_id dele; para mudar a peça, mude no Odoo.';
    f.append(a);
    return f;
  }
  if (ST.regrasErro){
    /* só a primeira frase do erro (a do servidor explica as três saídas; aqui basta dizer o quê e onde) */
    const curto = String(ST.regrasErro).split(/[:(]/)[0].trim();
    const av = nel('div', 'cl-aviso', 'Sem as regras do Odoo (' + curto + '): os campos ficam livres, e o "Conferir no Odoo" '
      + 'diz o que faltar quando ele responder. A credencial fica em Configurações › Projeto › Envio da lista para o Odoo.');
    av.title = ST.regrasErro;
    f.append(av);
  }

  const fam = String(F.componente.x_familia || '').toUpperCase();
  const perfil = fam ? ST.perfis[fam] : null;
  if (fam && !perfil && !ST.regrasErro && !F.pedindoPerfil){
    F.pedindoPerfil = true;
    api('/api/locais/regras?familia=' + encodeURIComponent(fam)).then(r => {
      F.pedindoPerfil = false;
      if (r.ok && r.perfil) ST.perfis[fam] = r.perfil;
      desenha();
    });
  }

  /* identidade */
  f.append(nel('div', 'cl-grupo', 'identidade'));
  const g1 = nel('div', 'cl-grade');
  g1.append(campo(F, 'x_familia', { obrig: true, lista: listaDe('x_familia'), muda: () => { F.componente.x_subtipo = F.componente.x_subtipo || ''; desenha(); } }));
  g1.append(campo(F, 'x_montagem', { obrig: true, lista: listaDe('x_montagem') || [['smd', 'SMD'], ['pth', 'PTH']], muda: desenha }));
  g1.append(campo(F, 'x_encapsulamento', { obrig: true, sugestoes: fam === 'CONECTOR' ? null : encDe(F.componente.x_montagem) }));
  g1.append(campo(F, 'x_mpn', { obrig: true }));
  g1.append(campo(F, 'x_fabricante'));
  if (!perfil || perfil.subtipo_de_cadastro) g1.append(campo(F, 'x_subtipo', { obrig: !!(perfil && perfil.subtipo_de_cadastro),
    sugestoes: (ST.regras && ST.regras.subtipos || []).filter(s => !s.familia || s.familia === fam).map(s => s.nome) }));
  else g1.append(campo(F, 'x_subtipo', { dica: 'livre: a função da peça (de Filme Espesso, Operacional, Radial)' }));
  if (!perfil || perfil.valor) g1.append(campo(F, 'x_valor_txt', { obrig: !!(perfil && perfil.valor) }));
  if (!perfil || perfil.vias) g1.append(campo(F, 'x_vias', { obrig: !!(perfil && perfil.vias), tipo: 'number' }));
  const pols = perfil ? (perfil.polaridades || []) : null;
  if (!perfil || pols.length) g1.append(campo(F, 'x_polaridade', { obrig: !!(pols && pols.length),
    lista: pols && pols.length ? pols.map(p => Array.isArray(p) ? p : [p, String(p).toUpperCase()]) : listaDe('x_polaridade') }));
  f.append(g1);

  /* atributos: só os que a família pede (atributo que ela não pede é erro no Odoo) */
  const atribs = perfil ? (perfil.atributos || []) : TODOS_ATRIB;
  if (atribs.length){
    f.append(nel('div', 'cl-grupo', perfil ? 'atributos que ' + fam + ' pede' : 'atributos (escolha a família para ver só os dela)'));
    const g2 = nel('div', 'cl-grade');
    for (const a of atribs){
      const k = 'x_' + a;
      g2.append(campo(F, k, { lista: LISTAS.indexOf(k) >= 0 ? listaDe(k) : null }));
    }
    f.append(g2);
  }

  /* desenho e placa */
  f.append(nel('div', 'cl-grupo', 'símbolo e footprint'));
  const g3 = nel('div', 'cl-grade');
  g3.append(campoLivre(F, 'simbolo', 'Símbolo', { obrig: true, sugestoes: (ST.opcoes && ST.opcoes.simbolos || []).map(s => s.nome),
    dica: 'da Biblioteca de símbolos, da SchLib ou de uma família do almoxarifado' }));
  g3.append(campoLivre(F, 'footprint', 'Footprint', { obrig: true, sugestoes: ST.opcoes && ST.opcoes.footprints, dica: 'nome exato da PcbLib da casa' }));
  g3.append(campo(F, 'x_designator'));
  if (!perfil || perfil.pinos) g3.append(campo(F, 'x_pinos', { tipo: 'number' }));
  g3.append(campo(F, 'x_pinagem', { area: true, larga: true }));
  f.append(g3);

  /* referências */
  f.append(nel('div', 'cl-grupo', 'referências'));
  const g4 = nel('div', 'cl-grade');
  g4.append(campoLivre(F, 'datasheet', 'Datasheet (link)', { larga: true }));
  g4.append(campoLivre(F, 'nome', 'Nome no NexoEletric', { larga: true, dica: c ? 'é o nome gravado nos esquemas: trocar não muda os já colocados'
    : 'vazio = automático (família, valor, MPN, encapsulamento)' }));
  f.append(g4);
  const lk = nel('div', 'cl-campo cl-larga');
  lk.append(nel('label', null, 'Links (loja + página do produto)'));
  for (let i = 0; i < F.links.length; i++) lk.append(linhaLink(F, i));
  const bL = nel('button', 'btn btn-ghost btn-sm', '+ link'); bL.type = 'button';
  bL.onclick = () => { F.links.push({ name: '', url: '' }); desenha(); };
  lk.append(bL);
  f.append(lk);

  /* ações */
  const bar = nel('div', 'cl-bar');
  const bS = nel('button', 'btn btn-secondary btn-sm', c ? 'Salvar' : 'Criar componente'); bS.type = 'button';
  bS.onclick = () => salvar(false);
  const bC = nel('button', 'btn btn-ghost btn-sm', 'Salvar e conferir no Odoo'); bC.type = 'button';
  bC.title = 'di_confere_lista: o Odoo confere a ficha com as regras do cadastro novo, sem gravar nada';
  bC.onclick = () => salvar(true);
  bar.append(bS, bC, nel('span', 'sep'));
  if (c){
    const bA = nel('button', 'btn btn-ghost btn-sm', 'Apagar'); bA.type = 'button';
    bA.onclick = async () => {
      const ok = window.HubDialog ? await HubDialog.confirm('Apagar o componente local "' + c.nome + '"? Os esquemas que o usam ficam com o quadrado vermelho.', { title: 'Componentes novos', ok: 'Apagar', danger: true }) : false;
      if (!ok) return;
      const r = await api('/api/locais/' + encodeURIComponent(c.id) + '/apagar', {});
      if (!r.ok) return toast('não apagou: ' + r.error, 'err');
      toast('componente local apagado', 'ok'); ST.sel = null; ST.form = null; carrega();
    };
    bar.append(bA);
  }
  for (const b of bar.querySelectorAll('button')) b.disabled = ST.ocupado;
  f.append(bar);
  if (c && c.faltaLocal && c.faltaLocal.length) f.append(nel('div', 'cl-aviso', 'Falta aqui: ' + c.faltaLocal.join(', ') + '.'));
  if (c && c.conferencia) f.append(caixaConferencia(c, F));
  return f;
}

function caixaConferencia(c, F){
  const cf = c.conferencia;
  const box = nel('div', 'cl-conf ' + (cf.pronto ? 'ok' : 'err'));
  box.append(nel('div', null, (cf.pronto ? '✓ Pronto para o Odoo' : cf.jaExiste ? 'O Odoo já tem esta peça' : '✗ Ainda não está pronto')
    + (cf.em ? ' — conferido em ' + cf.em : '')));
  if (cf.nome_previsto){
    const np = nel('div'); np.append(document.createTextNode('Nome no Odoo: '), nel('span', 'np', cf.nome_previsto));
    if (cf.nome_previsto !== c.nome){
      const b = nel('button', 'btn btn-ghost btn-sm', 'usar este nome'); b.type = 'button'; b.style.marginLeft = '8px';
      b.title = 'Grava o nome do Odoo como o nome deste componente (os esquemas que já o usam continuam com o nome antigo)';
      b.onclick = () => { F.nome = cf.nome_previsto; salvar(false); };
      np.append(b);
    }
    box.append(np);
  }
  const lista = (rot, xs) => { if (!xs || !xs.length) return; box.append(nel('div', null, rot)); const ul = nel('ul'); for (const x of xs) ul.append(nel('li', null, x)); box.append(ul); };
  lista('Faltas:', cf.faltas); lista('Erros:', cf.erros); lista('Avisos:', cf.avisos);
  if (cf.ignorados && cf.ignorados.length) lista('Ignorados pelo Odoo:', cf.ignorados);
  return box;
}

/* ── os campos ── */
function formDe(c){
  const comp = Object.assign({}, (c && c._componente) || {});
  return { id: c ? c.id : '', nome: c ? c.nome : '', simbolo: c ? c.simbolo : '', footprint: c ? c.footprint : '',
           datasheet: c ? c.datasheet : '', componente: comp, links: [], carregou: !c };
}
function listaDe(k){
  const l = ST.regras && ST.regras.listas && ST.regras.listas[k];
  return l && l.length ? l : null;
}
function encDe(mont){
  const e = ST.regras && ST.regras.encapsulamentos && ST.regras.encapsulamentos[String(mont || '').toLowerCase()];
  return (e || []).map(x => Array.isArray(x) ? x[0] : (x && (x.name || x.nome)) || String(x));
}
let nDl = 0;
function campo(F, k, o){
  o = o || {};
  return campoGenerico(o.larga ? 'cl-campo cl-larga' : 'cl-campo', ROT[k] || k, o.obrig, o.dica || DICA[k], () => F.componente[k], v => { F.componente[k] = v; }, o);
}
function campoLivre(F, k, rot, o){
  o = o || {};
  return campoGenerico(o.larga ? 'cl-campo cl-larga' : 'cl-campo', rot, o.obrig, o.dica, () => F[k], v => { F[k] = v; }, o);
}
function campoGenerico(cls, rot, obrig, dica, le, poe, o){
  const d = nel('div', cls);
  const lab = nel('label', null, rot); if (obrig) lab.append(document.createTextNode(' '), nel('b', null, '*'));
  d.append(lab);
  let i;
  if (o.lista){
    i = nel('select', 'input');
    const vazio = nel('option', null, '—'); vazio.value = ''; i.append(vazio);
    for (const par of o.lista){ const op = nel('option', null, String(par[1] != null ? par[1] : par[0])); op.value = String(par[0]); i.append(op); }
    const v = le() == null ? '' : String(le());
    if (v && !o.lista.some(p => String(p[0]).toLowerCase() === v.toLowerCase())){ const op = nel('option', null, v + ' (fora da lista)'); op.value = v; i.append(op); }
    i.value = o.lista.find(p => String(p[0]).toLowerCase() === v.toLowerCase()) ? String(o.lista.find(p => String(p[0]).toLowerCase() === v.toLowerCase())[0]) : v;
    i.onchange = () => { poe(i.value); if (o.muda) o.muda(); };
  } else if (o.area){
    i = nel('textarea', 'input'); i.value = le() || ''; i.oninput = () => poe(i.value);
  } else {
    i = nel('input', 'input'); i.type = o.tipo || 'text'; i.value = le() == null ? '' : le(); i.spellcheck = false;
    i.oninput = () => poe(i.value);
    if (o.muda) i.onchange = o.muda;
    if (o.sugestoes && o.sugestoes.length){
      const dl = nel('datalist'); dl.id = 'cl-dl-' + (++nDl);
      for (const s of o.sugestoes.slice(0, 5000)){ const op = nel('option'); op.value = s; dl.append(op); }
      i.setAttribute('list', dl.id); d.append(dl);
    }
  }
  if (dica) i.title = dica;
  d.append(i);
  return d;
}
function linhaLink(F, idx){
  const L = F.links[idx];
  const r = nel('div', 'cl-link');
  const n = nel('input', 'input'); n.placeholder = 'Mouser, LCSC, Digikey…'; n.value = L.name || ''; n.oninput = () => { L.name = n.value; };
  const u = nel('input', 'input'); u.placeholder = 'https://… (a página do produto)'; u.value = L.url || ''; u.oninput = () => { L.url = u.value; };
  const x = nel('button', 'btn btn-ghost btn-sm', '×'); x.type = 'button'; x.onclick = () => { F.links.splice(idx, 1); desenha(); };
  r.append(n, u, x);
  return r;
}

/* a ficha inteira (o bloco) vem do GET /api/locais/<id>: a lista só traz o resumo */
async function carregaFicha(){
  const c = atual();
  if (!c || !ST.form || ST.form.carregou) return;
  const j = await api('/api/locais/' + encodeURIComponent(c.id));
  if (!j.ok) return;
  const meta = j.componente.criadoLocal || {};
  const b = Object.assign({}, meta.componente || {});
  ST.form.links = (b.links || []).map(l => ({ name: l.name, url: l.url }));
  delete b.links; delete b.footprint; delete b.imagem;
  ST.form.componente = b;
  ST.form.carregou = true;
  desenha();
}

async function salvar(conferir){
  const F = ST.form; if (!F || ST.ocupado) return;
  const comp = {};
  for (const [k, v] of Object.entries(F.componente)) if (v !== '' && v != null) comp[k] = typeof v === 'string' ? v.trim() : v;
  const links = F.links.filter(l => l.name && l.url);
  if (links.length) comp.links = links;
  const corpo = { componente: comp, simbolo: F.simbolo || '', footprint: F.footprint || '', datasheet: F.datasheet || '' };
  if (F.id) corpo.id = F.id;
  if (F.nome && (!F.id || F.nome !== (atual() || {}).nome)) corpo.nome = F.nome;
  ST.ocupado = true; desenha();
  const r = await api('/api/locais', corpo);
  ST.ocupado = false;
  if (!r.ok){ desenha(); return toast('não gravou: ' + r.error, 'err'); }
  (r.avisos || []).forEach(a => toast(a, 'warn'));
  ST.sel = r.componente.id; ST.novo = false; ST.form = null;
  if (conferir){
    toast('conferindo no Odoo…', 'info');
    const c = await api('/api/locais/' + encodeURIComponent(r.componente.id) + '/conferir', {});
    if (!c.ok) toast('o Odoo não conferiu: ' + c.error, 'err');
    else toast(c.conferencia.pronto ? 'pronto para o Odoo' : 'o Odoo apontou o que falta', c.conferencia.pronto ? 'ok' : 'warn');
  } else toast('componente local gravado', 'ok');
  await carrega();
  carregaFicha();
}

/* o hub-libview chama a cada entrada na sub-aba; depois de desenhar, carrega a ficha selecionada */
const _desenha = desenha;
desenha = function(){ _desenha(); carregaFicha(); };

return { monta, recarrega: carrega, estado: ST };
})();
if (typeof module === 'object' && module.exports) module.exports = HubCompLocal;
