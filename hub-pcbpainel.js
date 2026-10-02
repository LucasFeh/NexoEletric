/* AltiumPCBMirror v2 - hub-pcbpainel.js — o painel da direita da vista PCB.

   O "Properties" do Altium 21, no molde do painel da vista Esquema (schframe.html: #props com
   divisoria, paginas .dpane, sub-abas no RODAPE, ficha de campos discretos .pr-inp/.pr-par):
     Propriedades  sem selecao = a PLACA (Board Information com os numeros reais, filtro de
                   selecao, grade/snap/unidade, vista, saidas); com selecao = a ficha do objeto,
                   editavel NA HORA (Enter ou sair do campo grava, com desfazer), com a CAMADA
                   como primeiro campo; com uma ferramenta na mao = as opcoes dela (o Tab do
                   Altium);
     Camadas       olho, cor, contagem, camada atual, conjuntos (LS), camada unica, ver por baixo;
     Componentes   a PCB List de antes (filtro, ordenacao, celula mudada em amarelo, CSV);
     Mudancas (n)  o changes.js com a validacao do motor, e os sinalizadores.
   O Salvar fica sempre visivel no topo (Ctrl+S).

   Este modulo so DESENHA. Quem sabe o que cada campo significa e quem escreve o changes.js e o
   pcbframe.js: a ficha chega pronta de V.ficha() e a volta vai por V.editar(chave, valor). O CSS
   mora aqui dentro (template literal: nada de crase no CSS, ela fecharia a string).

   HubPcbPainel.instala(aside, V) -> { atualiza(), atualizaSalvar(), mostra(aba), foca(chave?) } */
(function (raiz, fabrica) {
  const m = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.HubPcbPainel = m;
})(typeof self !== 'undefined' ? self : this, function () {
"use strict";

const CSS = `
.pp{display:flex; flex-direction:column; min-height:0; height:100%; background:var(--panel); color:var(--fg); font:13px/1.45 var(--font);}
.pp .pr-head{flex:none; display:flex; align-items:center; gap:6px; padding:8px 8px 8px 12px; border-bottom:1px solid var(--border);}
.pp .pr-head h2{font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--fg-dim); font-weight:400; white-space:nowrap;}
.pp .pp-trava{font-size:10px; letter-spacing:.04em; color:var(--fg-dim); border:1px solid var(--border); border-radius:3px; padding:1px 5px; cursor:pointer; white-space:nowrap; background:transparent;}
.pp .pp-trava.on{color:var(--ok); border-color:var(--ok);}
.pp .pp-salvar{margin-left:auto; display:inline-flex; align-items:center; gap:6px; padding:4px 10px; font-size:12px; border-radius:4px;
  background:transparent; color:var(--fg); border:1px solid var(--border); cursor:pointer; white-space:nowrap;}
.pp .pp-salvar svg{width:15px; height:15px;}
.pp .pp-salvar:hover{border-color:var(--accent);}
.pp .pp-salvar.sujo{background:var(--hi); color:var(--on-hi); border-color:var(--hi);}
.pp .pp-salvar:disabled{opacity:.45; cursor:not-allowed;}
.pp .pp-pag{display:none; flex:1; min-height:0; overflow-y:auto;}
.pp .pp-pag.on{display:block;}
.pp .pr-sec{padding:9px 12px; border-bottom:1px solid var(--border);}
.pp .pr-sec h3{font-size:10px; text-transform:uppercase; letter-spacing:.09em; color:var(--fg-dim); margin:0 0 6px; font-weight:400;}
.pp .pr-title{font-size:15px; color:var(--fg); word-break:break-word; line-height:1.25;}
.pp .pr-sub{font-size:11px; color:var(--fg-dim); margin-top:2px; word-break:break-word;}
.pp .pr-aviso{margin-top:6px; font-size:11px; color:var(--warn); line-height:1.4;}
.pp .pr-kv{display:grid; grid-template-columns:96px minmax(0,1fr); gap:3px 8px; font-size:12px;}
.pp .pr-kv .k{color:var(--fg-dim);}
.pp .pr-kv .v{color:var(--fg); word-break:break-word; font-variant-numeric:tabular-nums;}
.pp .pr-kv .v.warn{color:var(--warn);}
.pp .pr-l{display:grid; grid-template-columns:86px minmax(0,1fr); align-items:center; gap:2px 8px; margin:2px 0; font-size:12px;}
.pp .pr-l > .k{color:var(--fg-dim); font-size:11px;}
.pp .pr-campo{display:flex; align-items:center; gap:4px; min-width:0;}
.pp .pr-campo .un{flex:none; font-size:10px; color:var(--fg-dim);}
.pp .pr-campo .sw{flex:none; width:12px; height:12px; border-radius:2px; box-shadow:0 0 0 1px var(--line);}
.pp .pr-inp{width:100%; min-width:0; box-sizing:border-box; background:transparent; color:var(--fg);
  border:1px solid transparent; border-radius:3px; padding:2px 4px; font:12px var(--font);}
.pp .pr-inp.mono{font-family:var(--mono); font-size:11px;}
.pp .pr-inp:hover{background:var(--panel2); border-color:var(--border);}
.pp .pr-inp:focus{background:var(--panel); border-color:var(--accent); outline:none; color:var(--fg);}
.pp .pr-inp::placeholder{color:var(--fg-dim); font-style:italic;}
.pp select.pr-inp{cursor:pointer;}
.pp select.pr-inp option{background:var(--panel); color:var(--fg);}
.pp .pr-ro{color:var(--fg-dim); font-size:11px; padding:2px 4px; word-break:break-word;}
.pp .pr-par{display:grid; grid-template-columns:86px minmax(0,1fr) minmax(0,1fr); gap:2px 8px; align-items:center; margin:2px 0; font-size:12px;}
.pp .pr-par > .k{color:var(--fg-dim); font-size:11px;}
.pp .pr-par-c{display:flex; align-items:center; gap:3px; min-width:0;}
.pp .pr-par-c .s{flex:none; font-size:10px; color:var(--fg-dim); text-transform:uppercase; letter-spacing:.04em;}
.pp .pr-bool{display:inline-flex; align-items:center; gap:6px; cursor:pointer;}
.pp .pr-bool input{accent-color:var(--accent); margin:0;}
.pp .pr-nota{font-size:11px; color:var(--fg-dim); line-height:1.45; margin-top:6px;}
.pp .pr-botoes{display:flex; flex-wrap:wrap; gap:6px; margin-top:8px;}
.pp .btn{display:inline-flex; align-items:center; gap:6px; padding:4px 10px; font-size:12px; border-radius:4px; background:transparent;
  color:var(--fg); border:1px solid var(--border); cursor:pointer; font-family:inherit;}
.pp .btn:hover:not(:disabled){border-color:var(--accent);}
.pp .btn:disabled{opacity:.4; cursor:not-allowed;}
.pp .btn svg{width:15px; height:15px; flex:none;}
.pp .btn.on{background:var(--hi); color:var(--on-hi); border-color:var(--hi);}
.pp .wide{width:100%; justify-content:flex-start; margin-top:6px;}
.pp .pr-sec .wide:first-of-type{margin-top:0;}
.pp .chips{display:flex; flex-wrap:wrap; gap:4px;}
.pp .chip{font-size:11px; padding:2px 8px; border-radius:999px; border:1px solid var(--border); background:transparent; color:var(--fg-dim); cursor:pointer; font-family:inherit;}
.pp .chip[aria-pressed="true"]{background:rgba(var(--tint),0.12); color:var(--fg); border-color:var(--accent);}
.pp .chip:disabled{opacity:.4; cursor:not-allowed;}
.pp .seg{display:inline-flex; gap:2px; padding:2px; border-radius:5px; box-shadow:inset 0 0 0 1px var(--border);}
.pp .seg button{border:0; background:transparent; color:var(--fg-dim); font-size:11px; padding:3px 9px; border-radius:3px; cursor:pointer; font-family:inherit;}
.pp .seg button[aria-pressed="true"]{background:rgba(var(--tint),0.14); color:var(--fg);}
.pp .linha{display:flex; align-items:center; gap:6px; margin-top:6px; flex-wrap:wrap;}
.pp .linha > label{font-size:11px; color:var(--fg-dim); min-width:70px;}
.pp .linha select{flex:1; min-width:0; background:var(--panel2); color:var(--fg); border:1px solid var(--border); border-radius:3px; padding:2px; font-family:inherit; font-size:12px;}
.pp .ibtns{display:flex; flex-wrap:wrap; gap:6px;}
.pp .ibtn{width:32px; height:30px; padding:0; display:inline-flex; align-items:center; justify-content:center; border-radius:4px;
  background:transparent; color:var(--fg-dim); border:1px solid var(--border); cursor:pointer;}
.pp .ibtn:hover{color:var(--fg); border-color:var(--accent);}
.pp .ibtn[aria-pressed="true"]{background:var(--hi); color:var(--on-hi); border-color:var(--hi);}
.pp .ibtn svg{width:16px; height:16px;}
.pp .hint{font-size:11px; color:var(--fg-dim); margin-top:6px; line-height:1.4;}
.pp kbd{font:11px var(--mono); background:var(--panel2); border:1px solid var(--border); border-radius:3px; padding:0 4px; color:var(--fg);}
.pp table{border-collapse:collapse; width:100%; font-size:11px;}
.pp th, .pp td{padding:2px 5px; text-align:left; border-bottom:1px solid var(--border); white-space:nowrap;}
.pp th{position:sticky; top:0; background:var(--panel); color:var(--fg-dim); font-weight:400; cursor:pointer; user-select:none; z-index:1;}
.pp th:hover{color:var(--fg);}
.pp td.num{text-align:right; font-family:var(--mono);}
.pp td.chg{background:var(--warn-soft); color:var(--warn);}
.pp tbody tr{cursor:pointer;}
.pp tbody tr:hover{background:rgba(var(--tint),0.07);}
.pp tbody tr.sel{background:rgba(var(--tint),0.12); box-shadow:inset 2px 0 0 var(--hi);}
.pp .tab-pads td{cursor:default;}
.pp .tab-pads td.n{color:var(--fg-dim);}
.pp .busca{width:100%; box-sizing:border-box; background:var(--panel2); border:1px solid var(--border); color:var(--fg); border-radius:4px; padding:4px 8px; font:12px var(--font);}
.pp .busca:focus{outline:none; border-color:var(--accent);}
.pp .cam{display:grid; grid-template-columns:22px 14px minmax(0,1fr) auto 30px; align-items:center; gap:6px; padding:2px 4px; border-radius:3px; cursor:pointer; font-size:12px;}
.pp .cam:hover{background:rgba(var(--tint),0.07);}
.pp .cam.atual{background:rgba(var(--tint),0.12); box-shadow:inset 2px 0 0 var(--hi);}
.pp .cam.vazia .nm{color:var(--fg-dim);}
.pp .cam.oculta .nm, .pp .cam.oculta .sw{opacity:.4;}
.pp .cam .olho{width:20px; height:20px; padding:0; border:0; background:transparent; color:var(--fg-dim); cursor:pointer; display:inline-flex; align-items:center; justify-content:center;}
.pp .cam .olho:hover{color:var(--fg);}
.pp .cam .olho svg{width:15px; height:15px;}
.pp .cam .sw{width:12px; height:12px; border-radius:2px; box-shadow:0 0 0 1px var(--line);}
.pp .cam .nm{overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.pp .cam .n{font-size:10px; color:var(--fg-dim); font-variant-numeric:tabular-nums;}
.pp .cam .so{font-size:10px; padding:0 4px; border:1px solid transparent; background:transparent; color:var(--fg-dim); border-radius:3px; cursor:pointer;}
.pp .cam .so:hover{border-color:var(--border); color:var(--fg);}
.pp .mud{padding:4px 6px; margin:3px 0; border-radius:3px; background:var(--panel2); font-size:12px; border-left:3px solid var(--ok);
  cursor:pointer; word-break:break-word; display:grid; grid-template-columns:minmax(0,1fr) auto; gap:2px 6px;}
.pp .mud:hover{background:rgba(var(--tint),0.08);}
.pp .mud.warn{border-left-color:var(--warn);}
.pp .mud.err{border-left-color:var(--err);}
.pp .mud .msg{grid-column:1 / -1; font-size:11px; color:var(--warn);}
.pp .mud.err .msg{color:var(--err);}
.pp .mud .nt{grid-column:1 / -1; font-size:10px; color:var(--fg-dim);}
.pp .mud .x{border:0; background:transparent; color:var(--fg-dim); cursor:pointer; padding:0 4px; font-size:12px;}
.pp .mud .x:hover{color:var(--err);}
.pp .mud.ann{border-left-color:#4fc3f7;}
.pp .mud.ann.e{border-left-color:#ff5252;}
.pp .mud.ann.w{border-left-color:#ffd54f;}
.pp .mud.ann.r{opacity:.55;}
.pp .vazio{font-size:12px; color:var(--fg-dim);}
.pp .resumo{font-size:12px; color:var(--fg-dim);}
.pp .resumo b{color:var(--fg); font-weight:500;}
.pp .resumo .e{color:var(--err);}
.pp .resumo .w{color:var(--warn);}
.pp .subtabs{display:flex; border-top:1px solid var(--border); padding:0 4px; flex:none;}
.pp .subtab{flex:1 1 0; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; background:transparent; border:0; border-radius:0;
  color:var(--fg-dim); padding:8px 4px 9px; font-size:12px; letter-spacing:.02em; cursor:pointer; font-family:inherit;}
.pp .subtab:hover{color:var(--fg);}
.pp .subtab[aria-selected="true"]{color:var(--fg); box-shadow:inset 0 2px 0 var(--accent);}
.pp .subtab .pt{display:inline-block; width:6px; height:6px; border-radius:50%; background:var(--err); margin-left:4px; vertical-align:1px;}
`;
function poeCss() {
  if (document.getElementById('hubPcbPainelCss')) return;
  const s = document.createElement('style');
  s.id = 'hubPcbPainelCss';
  s.textContent = CSS;
  document.head.append(s);
}
function el(tag, cls, txt) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
}
const ic = nome => (typeof HubPcbIcones !== 'undefined' ? HubPcbIcones.icone(nome) : document.createTextNode(''));
const ABAS = [['props', 'Propriedades'], ['camadas', 'Camadas'], ['comps', 'Componentes'], ['mud', 'Mudanças']];
const ABA_KEY = 'altiumhub.pcb.aba';

function instala(aside, V) {
  poeCss();
  aside.textContent = '';
  aside.classList.add('pp');
  let aba = 'props';
  try { const v = localStorage.getItem(ABA_KEY); if (ABAS.some(a => a[0] === v)) aba = v; } catch (e) {}
  const est = { compQ:'', compK:'ref', compAsc:true };

  /* ---- cabecalho: titulo, a trava e o Salvar ---- */
  const head = el('div', 'pr-head');
  const tit = el('h2', null, 'Propriedades');
  const trava = el('button', 'pp-trava');
  trava.type = 'button';
  trava.addEventListener('click', () => V.setEdit(!V.editOn()));
  const salvar = el('button', 'pp-salvar');
  salvar.type = 'button';
  salvar.append(ic('salvar'), el('span', 'lb', 'Salvar'));
  salvar.addEventListener('click', () => V.salvar());
  head.append(tit, trava, salvar);
  const pags = {};
  aside.append(head);
  for (const [id] of ABAS) { pags[id] = el('div', 'pp-pag'); pags[id].dataset.aba = id; aside.append(pags[id]); }
  const sub = el('div', 'subtabs');
  sub.setAttribute('role', 'tablist');
  const botoesAba = {};
  for (const [id, rot] of ABAS) {
    const b = el('button', 'subtab', rot);
    b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.aba = id;
    b.addEventListener('click', () => mostra(id));
    botoesAba[id] = b; sub.append(b);
  }
  aside.append(sub);

  function mostra(id) {
    if (!pags[id]) return;
    aba = id;
    try { localStorage.setItem(ABA_KEY, id); } catch (e) {}
    atualiza();
  }
  function atualizaSalvar() {
    const s = V.sujo();
    const sujo = s.ch || s.ann;
    salvar.classList.toggle('sujo', sujo);
    salvar.querySelector('.lb').textContent = sujo ? 'Salvar *' : 'Salvar';
    const t = V.teclaDe('salvar');
    salvar.title = (sujo ? 'Gravar ' + [s.ch ? 'o changes.js' : '', s.ann ? 'os sinalizadores (annotations.js)' : ''].filter(Boolean).join(' e ')
                         : 'Nada pendente — o changes.js do disco é o que está na tela') + (t ? ' (' + t + ')' : '');
    salvar.disabled = V.LEAN;
    const on = V.editOn();
    trava.classList.toggle('on', on);
    trava.textContent = on ? 'editando' : 'só leitura';
    trava.title = on ? 'Edição destravada — clique (ou ' + (V.teclaDe('editar') || 'E') + ') para travar'
                     : 'Só leitura: o arrasto não mexe na placa. Clique (ou ' + (V.teclaDe('editar') || 'E') + ') para destravar — escolher uma ferramenta ou mudar um campo também destrava';
  }

  /* ---- o render, com o foco preservado: a ficha e refeita a cada commit, e o campo que tinha
     o foco (o Tab do campo anterior ja o levou para o seguinte) volta a te-lo ---- */
  function atualiza() {
    for (const [id] of ABAS) {
      pags[id].classList.toggle('on', id === aba);
      botoesAba[id].setAttribute('aria-selected', String(id === aba));
    }
    const n = V.CH.length, erros = V.validacao().filter(v => v.level === 'err').length;
    botoesAba.mud.textContent = 'Mudanças (' + n + ')';
    if (erros) { const p = el('span', 'pt'); p.title = erros + ' erro(s) de validação'; botoesAba.mud.append(p); }
    tit.textContent = ({ props:'Propriedades', camadas:'Camadas', comps:'Componentes', mud:'Mudanças' })[aba];
    atualizaSalvar();
    const ativo = document.activeElement, pag = pags[aba];
    const kFoco = ativo && pag.contains(ativo) && ativo.dataset ? ativo.dataset.k : null;
    const sel = kFoco && typeof ativo.selectionStart === 'number' ? [ativo.selectionStart, ativo.selectionEnd] : null;
    const rol = pag.scrollTop;
    if (aba === 'props') desenhaProps(pag);
    else if (aba === 'camadas') desenhaCamadas(pag);
    else if (aba === 'comps') desenhaComps(pag);
    else desenhaMud(pag);
    pag.scrollTop = rol;
    if (kFoco) {
      const novo = pag.querySelector('[data-k="' + kFoco.replace(/"/g, '') + '"]');
      if (novo) { novo.focus(); if (sel && typeof novo.setSelectionRange === 'function') try { novo.setSelectionRange(sel[0], sel[1]); } catch (e) {} }
    }
  }
  function foca(k) {
    if (aba !== 'props') mostra('props');
    const pag = pags.props;
    const alvo = (k && pag.querySelector('[data-k="' + k + '"]')) || pag.querySelector('.pr-inp:not([disabled])');
    if (alvo) { alvo.focus(); if (alvo.select) alvo.select(); }
  }

  /* ============================== Propriedades ============================== */
  function sec(box, titulo) { const d = el('div', 'pr-sec'); if (titulo) d.append(el('h3', null, titulo)); box.append(d); return d; }
  function kv(box, k, v, cls) { box.append(el('span', 'k', k)); const s = el('span', 'v' + (cls ? ' ' + cls : ''), v); box.append(s); return s; }
  function desenhaProps(pag) {
    pag.textContent = '';
    const f = V.ficha();
    if (f.tipo === 'placa') { desenhaPlaca(pag); return; }
    const cab = sec(pag);
    cab.append(el('div', 'pr-title', f.titulo || ''));
    if (f.sub) cab.append(el('div', 'pr-sub', f.sub));
    if (f.aviso) cab.append(el('div', 'pr-aviso', f.aviso));
    if (!V.editOn() && f.tipo !== 'ferramenta' && (f.campos || []).some(c => c.k && c.tipo !== 'ro'))
      cab.append(el('div', 'pr-nota', 'Só leitura: mudar um campo destrava a edição (' + (V.teclaDe('editar') || 'E') + ' trava de novo).'));
    let box = sec(pag);
    for (const c of f.campos || []) {
      if (c.sec) { box = sec(pag, c.sec); continue; }
      if (c.nota) { box.append(el('div', 'pr-nota', c.nota)); continue; }
      if (c.botoes) {
        const b = el('div', 'pr-botoes');
        for (const x of c.botoes) {
          const bt = el('button', 'btn', x.rot);
          bt.type = 'button'; if (x.dica) bt.title = x.dica; if (x.off) bt.disabled = true;
          bt.addEventListener('click', () => V.acao(x.id));
          b.append(bt);
        }
        box.append(b); continue;
      }
      if (c.tab) {
        const t = el('table', 'tab-pads');
        const th = el('tr');
        for (const h of c.tab.cab) th.append(el('th', null, h));
        const thead = el('thead'); thead.append(th); t.append(thead);
        const tb = el('tbody');
        for (const l of c.tab.linhas) { const tr = el('tr'); l.forEach((v, i) => tr.append(el('td', i ? '' : 'n', v))); tb.append(tr); }
        t.append(tb); box.append(t); continue;
      }
      if (c.par) {
        const r = el('div', 'pr-par');
        r.append(el('span', 'k', c.rot + (c.par.some(x => x.tipo === 'dist') ? ' (' + V.unidade() + ')' : '')));
        for (const x of c.par) { const cc = el('div', 'pr-par-c'); cc.append(el('span', 's', x.rot)); cc.append(controle(x, true)); r.append(cc); }
        box.append(r); continue;
      }
      const r = el('div', 'pr-l');
      r.append(el('span', 'k', c.rot));
      r.append(controle(c, false));
      if (c.dica) r.title = c.dica;
      box.append(r);
    }
  }
  /* um campo: o valor mostrado na unidade da tela; grava no Enter ou ao sair do campo, e so se
     o texto mudou (sair de um campo intocado nao pode escrever 0,00002 mm de arredondamento) */
  function controle(c, curto) {
    const wrap = el('div', 'pr-campo');
    if (c.tipo === 'ro') { wrap.append(el('span', 'pr-ro', c.v == null ? '—' : String(c.v))); return wrap; }
    if (c.tipo === 'camada' || c.tipo === 'enum' || c.tipo === 'net') {
      const s = el('select', 'pr-inp');
      s.dataset.k = c.k;
      if (c.misto) { const o = el('option', null, 'vários'); o.value = '\u0000'; o.selected = true; o.disabled = true; s.append(o); }
      let cor = null;
      for (const o of c.opc || []) {
        const op = el('option', null, o.rot); op.value = o.v;
        if (!c.misto && o.v === c.v) { op.selected = true; cor = o.cor || null; }
        s.append(op);
      }
      if (c.tipo === 'camada' || (c.opc || []).some(o => o.cor)) {
        const sw = el('span', 'sw'); sw.style.background = cor || 'transparent'; wrap.append(sw);
      }
      s.addEventListener('change', () => { if (s.value !== '\u0000') V.editar(c.k, s.value); });
      s.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); s.blur(); } });
      wrap.append(s); return wrap;
    }
    if (c.tipo === 'bool') {
      const l = el('label', 'pr-bool'), cb = el('input');
      cb.type = 'checkbox'; cb.checked = !!c.v; cb.dataset.k = c.k;
      cb.addEventListener('change', () => V.editar(c.k, cb.checked));
      l.append(cb, el('span', null, c.v ? 'sim' : 'não'));
      wrap.append(l); return wrap;
    }
    const i = el('input', 'pr-inp' + (c.tipo === 'texto' ? '' : ' mono'));
    i.type = 'text'; i.spellcheck = false; i.autocomplete = 'off'; i.dataset.k = c.k;
    const ini = c.misto || c.v == null ? '' : c.tipo === 'dist' ? V.fmtDist(c.v) : c.tipo === 'ang' ? V.fmtNum(c.v, 3) : String(c.v);
    i.value = ini;
    if (c.misto) i.placeholder = 'vários';
    if (c.dica) i.title = c.dica;
    let feito = false;
    const grava = () => {
      if (feito || i.value === ini) return;
      let v;
      if (c.tipo === 'dist') v = V.parseDist(i.value);
      else if (c.tipo === 'ang' || c.tipo === 'num') v = V.parseNum(i.value);
      else v = i.value;
      if ((c.tipo === 'dist' || c.tipo === 'ang' || c.tipo === 'num') && v === null) {
        if (typeof HubDialog !== 'undefined') HubDialog.toast('valor inválido em ' + c.rot + ': "' + i.value + '"', 'warn');
        i.value = ini; return;
      }
      feito = true;
      V.editar(c.k, v);
    };
    i.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); grava(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); i.value = ini; i.blur(); }
    });
    /* depois do blur, para o Tab ja ter levado o foco ao campo seguinte quando o painel refaz */
    i.addEventListener('blur', () => setTimeout(grava, 0));
    wrap.append(i);
    if (c.tipo === 'dist' && !curto) wrap.append(el('span', 'un', V.unidade()));
    if (c.tipo === 'ang' && !curto) wrap.append(el('span', 'un', '°'));
    return wrap;
  }
  function desenhaPlaca(pag) {
    const I = V.info();
    const s1 = sec(pag, 'Placa');
    const t = el('div', 'pr-kv');
    kv(t, 'Arquivo', I.fonte);
    kv(t, 'Exportado', I.gerado);
    kv(t, 'Espelho', I.novo ? 'novo (' + I.exporter + ')' : 'antigo — sem fills, mecânicas, máscara por pad e furos de região; reexporte com o ExportBoard novo', I.novo ? '' : 'warn');
    kv(t, 'Tamanho', V.fmtDist(I.W) + ' × ' + V.fmtDist(I.H) + ' ' + V.unidade());
    kv(t, 'Área', V.fmtNum(I.area / 100, 2) + ' cm²');
    kv(t, 'Componentes', I.comps + ' (Top ' + I.top + ' · Bottom ' + I.bottom + ')');
    kv(t, 'Trilhas', I.trilhas + ' (' + I.cobre + ' de cobre)');
    kv(t, 'Arcos', String(I.arcos));
    kv(t, 'Pads', String(I.pads));
    kv(t, 'Vias', String(I.vias));
    kv(t, 'Fills', String(I.fills));
    kv(t, 'Regiões', String(I.regioes));
    kv(t, 'Textos', String(I.textos));
    kv(t, 'Recortes', String(I.recortes));
    kv(t, 'Nets', String(I.nets));
    kv(t, 'Camadas', I.camadas + ' com objeto · ' + I.sinal + ' de sinal');
    const R = I.regras || {};
    const reg = [R.width != null ? 'largura ' + V.fmtDist(R.width) : '', R.clearance != null ? 'clearance ' + V.fmtDist(R.clearance) : '',
                 R.viaSize != null ? 'via ' + V.fmtDist(R.viaSize) + '/' + V.fmtDist(R.viaDrill) : '', R.sm != null ? 'máscara +' + V.fmtDist(R.sm) : ''].filter(Boolean);
    kv(t, 'Regras', reg.length ? reg.join(' · ') + ' ' + V.unidade() : '— (o espelho não trouxe)');
    s1.append(t);

    const s2 = sec(pag, 'Filtro de seleção');
    const ch = el('div', 'chips');
    for (const f of V.filtros()) {
      const b = el('button', 'chip', f.rot);
      b.type = 'button'; b.setAttribute('aria-pressed', String(f.on));
      b.title = (f.on ? 'Selecionável' : 'Fora da seleção') + ' — clique para trocar';
      b.addEventListener('click', () => V.setFiltro(f.k, !f.on));
      ch.append(b);
    }
    for (const [rot, porque] of [['Corpos 3D', 'não vêm no espelho'], ['Rooms', 'não vêm no espelho']]) {
      const b = el('button', 'chip', rot); b.type = 'button'; b.disabled = true; b.title = rot + ' — ' + porque; ch.append(b);
    }
    s2.append(ch);
    const lt = el('div', 'linha');
    const tudo = el('button', 'btn', 'Todos'); tudo.type = 'button'; tudo.addEventListener('click', () => V.setFiltro('*', true));
    const nada = el('button', 'btn', 'Nenhum'); nada.type = 'button'; nada.addEventListener('click', () => V.setFiltro('*', false));
    lt.append(tudo, nada); s2.append(lt);

    const s3 = sec(pag, 'Grade e snap');
    const l1 = el('div', 'linha');
    l1.append(el('label', null, 'Passo'));
    const gs = el('select');
    const gm = el('optgroup'); gm.label = 'mil'; const gmm = el('optgroup'); gmm.label = 'mm';
    for (const g of V.grades()) { const o = el('option', null, g.rot); o.value = g.id; if (g.id === V.grade()) o.selected = true; (/mil$/.test(g.id) ? gm : gmm).append(o); }
    gs.append(gm, gmm);
    gs.addEventListener('change', () => V.setGrade(gs.value));
    l1.append(gs); s3.append(l1);
    const l2 = el('div', 'linha');
    l2.append(el('label', null, 'Unidade'));
    const seg = el('div', 'seg');
    for (const u of ['mm', 'mil']) { const b = el('button', null, u); b.type = 'button'; b.setAttribute('aria-pressed', String(V.unidade() === u)); b.addEventListener('click', () => V.setUnidade(u)); seg.append(b); }
    l2.append(seg);
    const tq = V.teclaDe('unidade'); if (tq) { const k = el('kbd', null, tq); k.title = 'troca a unidade'; l2.append(k); }
    s3.append(l2);
    const l3 = el('div', 'linha');
    l3.append(el('label', null, 'Snap a objetos'));
    const so = el('select');
    for (const [v, rot] of [['todas', 'Todas as camadas'], ['atual', 'Só a camada atual'], ['off', 'Desligado (só a grade)']]) { const o = el('option', null, rot); o.value = v; if (V.snapObj() === v) o.selected = true; so.append(o); }
    so.addEventListener('change', () => V.setSnapObj(so.value));
    l3.append(so); s3.append(l3);
    s3.append(el('div', 'hint', 'Centro de pad, centro de via e ponta de trilha ganham da grade (alcance de 9 px). Ctrl solta o snap.'));

    const s4 = sec(pag, 'Vista');
    const sh = V.show();
    const ib = el('div', 'ibtns');
    const ibtn = (nome, titulo, on, f) => { const b = el('button', 'ibtn'); b.type = 'button'; b.title = titulo; if (on != null) b.setAttribute('aria-pressed', String(on)); b.append(ic(nome)); b.addEventListener('click', f); ib.append(b); };
    ibtn('fit', 'Enquadrar a placa (' + (V.teclaDe('enquadrar') || 'F') + ')', null, () => V.acao('enquadrar_placa'));
    ibtn('grid', 'Grade (' + (V.teclaDe('grade') || 'B') + ')', sh.grid, () => V.setShow('grid', !sh.grid));
    ibtn('fantasma', 'Fantasmas das mudanças (' + (V.teclaDe('diff') || 'D') + ')', sh.ghost, () => V.setShow('ghost', !sh.ghost));
    ibtn('unica', 'Camada única (' + (V.teclaDe('camadaUnica') || 'S') + ')', sh.unica, () => V.setShow('unica', !sh.unica));
    ibtn('virar', 'Ver por baixo (' + (V.teclaDe('virar') || 'V') + ')', sh.flip, () => V.setShow('flip', !sh.flip));
    ibtn('ajuda', 'Ajuda: teclas e gestos (' + (V.teclaDe('ajuda') || 'H') + ')', null, () => V.ajuda());
    s4.append(ib);
    s4.append(el('div', 'hint', 'Os atalhos desta vista ficam nas Configurações do hub, aba Atalhos.'));

    const s5 = sec(pag, 'Saídas');
    const temG = V.temGerber();
    const bG = el('button', 'btn wide'); bG.type = 'button'; bG.append(ic('gerber'), el('span', null, 'Gerar e ver o Gerber'));
    bG.title = temG ? 'O pacote X2 que vai para a JLCPCB, da placa com as mudanças de agora' : 'O gerador/visualizador de Gerber não carregou nesta página';
    bG.addEventListener('click', () => V.gerber());
    const bS = el('button', 'btn wide'); bS.type = 'button'; bS.append(ic('eye'), el('span', null, 'Ver o Gerber salvo'));
    bS.disabled = !V.podeGravar; bS.title = V.podeGravar ? 'Abre o último conjunto gravado em Projects/' + V.PROJ + '/Gerber/' : 'Só com o hubserver e um projeto aberto';
    bS.addEventListener('click', () => V.verGerberSalvo());
    const bC = el('button', 'btn wide'); bC.type = 'button'; bC.append(ic('csv'), el('span', null, 'CSV da PCB List'));
    bC.title = 'Baixa a lista de componentes com as mudanças (TSV)';
    bC.addEventListener('click', () => V.csv());
    const bP = el('button', 'btn wide'); bP.type = 'button'; bP.append(ic('pdf'), el('span', null, 'PDF de layout'));
    bP.disabled = true; bP.title = 'PDF de layout (A4 com carimbo) — travado: próxima etapa';
    s5.append(bG, bS, bC, bP);
  }

  /* ============================== Camadas ============================== */
  function desenhaCamadas(pag) {
    pag.textContent = '';
    const s1 = sec(pag, 'Conjuntos (LS)');
    const ch = el('div', 'chips');
    for (const c of V.conjuntos()) { const b = el('button', 'chip', c.rot.replace(/ \(.*\)$/, '')); b.type = 'button'; b.title = c.rot; b.addEventListener('click', () => V.conjunto(c.id)); ch.append(b); }
    s1.append(ch);
    const sh = V.show();
    const l = el('div', 'linha');
    const bu = el('button', 'btn' + (sh.unica ? ' on' : ''), 'Camada única'); bu.type = 'button'; bu.title = 'Mostra só a camada atual (e a Multi-Layer, se ela for de cobre) — ' + (V.teclaDe('camadaUnica') || 'S');
    bu.addEventListener('click', () => V.setShow('unica', !sh.unica));
    const bf = el('button', 'btn' + (sh.flip ? ' on' : ''), 'Ver por baixo'); bf.type = 'button'; bf.title = 'Como o Flip Board do Altium — ' + (V.teclaDe('virar') || 'V');
    bf.addEventListener('click', () => V.setShow('flip', !sh.flip));
    l.append(bu, bf); s1.append(l);
    const s2 = sec(pag, 'Camadas da placa');
    for (const c of V.camadas()) {
      const r = el('div', 'cam' + (c.atual ? ' atual' : '') + (c.usada ? '' : ' vazia') + (c.vis ? '' : ' oculta'));
      const olho = el('button', 'olho'); olho.type = 'button'; olho.title = c.vis ? 'Ocultar' : 'Mostrar';
      olho.append(ic(c.vis ? 'eye' : 'eyeOff'));
      olho.addEventListener('click', e => { e.stopPropagation(); V.setVisivel(c.key, !c.vis); });
      const sw = el('span', 'sw'); sw.style.background = c.cor;
      const nm = el('span', 'nm', c.rot);
      const n = el('span', 'n', c.count ? String(c.count) : '');
      const so = el('button', 'so', 'só'); so.type = 'button'; so.title = 'Mostrar só esta camada';
      so.addEventListener('click', e => { e.stopPropagation(); V.soEsta(c.key); });
      r.append(olho, sw, nm, n, so);
      r.title = c.nome + ' (' + c.key + ')' + (c.atual ? ' — camada atual' : ' — clique: camada atual');
      r.addEventListener('click', () => V.setCur(c.key));
      s2.append(r);
    }
    s2.append(el('div', 'hint', 'As ferramentas desenham na camada atual. Camada sem objeto no espelho aparece apagada, mas aparece.'));
  }

  /* ============================== Componentes (PCB List) ============================== */
  function desenhaComps(pag) {
    pag.textContent = '';
    const s = sec(pag);
    const busca = el('input', 'busca');
    busca.type = 'text'; busca.placeholder = 'filtrar (designator, footprint, comment…)'; busca.value = est.compQ; busca.dataset.k = 'compQ';
    busca.addEventListener('input', () => { est.compQ = busca.value; desenhaComps(pag); const b = pag.querySelector('[data-k="compQ"]'); if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); } });
    busca.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); busca.blur(); } });
    const lc = el('div', 'linha');
    const csv = el('button', 'btn'); csv.type = 'button'; csv.append(ic('csv'), el('span', null, 'CSV')); csv.title = 'Baixa a PCB List com as mudanças (TSV)';
    csv.addEventListener('click', () => V.csv());
    lc.append(busca); s.append(lc);
    let linhas = V.componentes();
    const q = est.compQ.trim().toLowerCase();
    if (q) linhas = linhas.filter(r => (r.ref + ' ' + r.footprint + ' ' + r.comment).toLowerCase().indexOf(q) >= 0);
    const k = est.compK, asc = est.compAsc;
    linhas.sort((a, b) => {
      const va = a[k], vb = b[k];
      const c = (typeof va === 'number' && typeof vb === 'number') ? va - vb
              : String(va).localeCompare(String(vb), undefined, { numeric:true, sensitivity:'base' });
      return asc ? c : -c;
    });
    const t = el('table');
    const thead = el('thead'), trh = el('tr');
    for (const [kk, rot] of [['ref', 'Designator'], ['footprint', 'Footprint'], ['comment', 'Comment'], ['layer', 'Layer'], ['x', 'X'], ['y', 'Y'], ['rot', 'Rot']]) {
      const th = el('th', null, rot + (k === kk ? (asc ? ' ▲' : ' ▼') : ''));
      th.addEventListener('click', () => { if (est.compK === kk) est.compAsc = !est.compAsc; else { est.compK = kk; est.compAsc = true; } desenhaComps(pag); });
      trh.append(th);
    }
    thead.append(trh); t.append(thead);
    const tb = el('tbody');
    for (const r of linhas) {
      const tr = el('tr');
      if (r.sel) tr.classList.add('sel');
      const cel = (v, mudou, num) => { const td = el('td', (num ? 'num' : '') + (mudou ? ' chg' : ''), v); tr.append(td); };
      cel(r.ref, r.mudou.ref); cel(r.footprint, false); cel(r.comment, r.mudou.comment); cel(r.layer, r.mudou.layer);
      cel(V.fmtDist(r.x), r.mudou.x, true); cel(V.fmtDist(r.y), r.mudou.y, true); cel(V.fmtNum(r.rot, 2), r.mudou.rot, true);
      tr.title = r.movido ? 'mudado pelo changes.js' : '';
      tr.addEventListener('click', () => V.selComp(r.srcRef));
      tb.append(tr);
    }
    t.append(tb);
    const st = sec(pag);
    st.append(el('div', 'resumo', linhas.length + ' componente(s) · X/Y em ' + V.unidade()));
    st.append(t);
    const s3 = sec(pag); s3.append(csv);
  }

  /* ============================== Mudancas ============================== */
  function desenhaMud(pag) {
    pag.textContent = '';
    const muds = V.mudancas(), val = V.validacao();
    const ne = val.filter(v => v.level === 'err').length, nw = val.filter(v => v.level === 'warn').length;
    const s1 = sec(pag, 'changes.js');
    const r = el('div', 'resumo');
    r.append(el('b', null, String(muds.length)), document.createTextNode(' mudança(s)'));
    if (ne) { r.append(document.createTextNode(' · ')); r.append(el('span', 'e', ne + ' erro(s)')); }
    if (nw) { r.append(document.createTextNode(' · ')); r.append(el('span', 'w', nw + ' aviso(s)')); }
    if (!ne && !nw && muds.length) r.append(document.createTextNode(' · ✓ sem problemas'));
    s1.append(r);
    if (!muds.length) s1.append(el('div', 'vazio', 'Nenhuma — edite na tela (ou a IA, no changes.js).'));
    for (const m of muds) {
      const d = el('div', 'mud ' + m.status);
      d.append(el('span', null, '#' + (m.i + 1) + ' ' + m.rot));
      const x = el('button', 'x', '✕'); x.type = 'button'; x.title = 'Tirar esta mudança (Ctrl+Z devolve)';
      x.addEventListener('click', e => { e.stopPropagation(); V.tiraMudanca(m.i); });
      d.append(x);
      if (m.msg) d.append(el('span', 'msg', m.msg));
      if (m.nota) d.append(el('span', 'nt', m.nota));
      d.title = m.temAlvo ? 'clique: mostra o objeto' : '';
      d.addEventListener('click', () => V.irMudanca(m.i));
      s1.append(d);
    }
    const outros = val.filter(v => !/^#\d+/.test(v.msg));
    for (const v of outros) { const d = el('div', 'mud ' + v.level); d.append(el('span', null, v.msg)); s1.append(d); }
    const anns = V.sinalizadores();
    const s2 = sec(pag, 'Sinalizadores (' + anns.length + ')');
    if (!anns.length) s2.append(el('div', 'vazio', 'Nenhum — use a ferramenta Sinalizar (' + (V.teclaDe('sinalizar') || 'N') + ').'));
    for (const a of anns) {
      const d = el('div', 'mud ann' + (a.severity === 'err' ? ' e' : a.severity === 'warn' ? ' w' : '') + (a.status === 'resolved' ? ' r' : ''));
      d.append(el('span', null, a.id + ': ' + a.msg + (a.status === 'resolved' ? (a.reply ? ' ✓ ' + a.reply : ' ✓') : '')));
      const bx = el('span');
      if (a.status === 'resolved') { const rb = el('button', 'x', '↺'); rb.type = 'button'; rb.title = 'Reabrir'; rb.addEventListener('click', e => { e.stopPropagation(); V.annReabre(a); }); bx.append(rb); }
      const x = el('button', 'x', '✕'); x.type = 'button'; x.title = 'Apagar o sinalizador';
      x.addEventListener('click', e => { e.stopPropagation(); V.annDel(a); });
      bx.append(x); d.append(bx);
      d.addEventListener('click', () => V.irAnn(a));
      s2.append(d);
    }
    const s3 = sec(pag);
    const b = el('button', 'btn wide'); b.type = 'button'; b.append(ic('salvar'), el('span', null, 'Salvar (changes.js e sinalizadores)'));
    b.addEventListener('click', () => V.salvar());
    s3.append(b);
    s3.append(el('div', 'hint', 'O ApplyChanges, no Altium, aplica o changes.js na ordem do arquivo e confere cada orig_*.'));
  }

  mostra(aba);
  return { atualiza, atualizaSalvar, mostra, foca, get aba() { return aba; } };
}

return { instala };
});
