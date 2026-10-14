/* AltiumPCBMirror v2 - hub-pcbregrasui.js — o "PCB Rules and Constraints Editor" e o painel
   "Messages" do DRC, no tema do hub, para a vista PCB.

   Só DESENHA: o modelo é o hub-pcbregras.js (HubPcbRegras), a checagem é o hub-pcbdrc.js
   (HubPcbDrc). Tudo o que ele precisa da vista chega por parâmetro (a placa efetiva, as regras,
   salvar, ir para) — não conhece o pcbframe.js. O CSS mora aqui dentro e usa só as variáveis do
   tema que a vista já tem (a ponte do pcbframe.html: --panel, --panel2, --border, --fg, --fg-dim,
   --accent/--hi, --on-hi, --ok, --warn, --err, --scrim, --shadow-menu, --font, --mono), com o
   token do hub-tema.css como reserva — nenhuma cor nova. Perguntas e avisos pelo HubDialog.

   API
     HubPcbRegrasUI.abrirEditor(opts) -> Promise<conjunto | null>
       opts.regras    o conjunto atual (HubPcbRegras.ler/doBoard/padroes...)
       opts.placa     a placa efetiva (para nets, camadas e o "casa N objetos" do escopo)
       opts.unidade   'mm' (padrão) | 'mil'
       opts.salvar    async (conjunto, textoRulesJs) => true|false — o OK/Aplicar chama; sem ele,
                      o editor só devolve o conjunto
       opts.titulo    texto do cabeçalho (padrão: o do Altium)
     HubPcbRegrasUI.painelDrc(container, opts) -> {mostra(res), limpa(), rodar(), el}
       o painel "Messages": contadores por regra (clique filtra), lista clicável, exportar
       opts.rodar     () => res | Promise<res>  (o botão "Rodar DRC"; o integrador chama o
                      HubPcbDrc.rodar com a placa efetiva e as regras)
       opts.irPara    (x, y, ids, violacao) => void   (clique numa linha)
       opts.arquivo   nome da placa no relatório; opts.aoFechar () => void (mostra o X)
     HubPcbRegrasUI.abrirDrc(opts) -> o mesmo painel, flutuando no rodapé da vista
     HubPcbRegrasUI.desenhaMarcadores(ctx, violacoes, {px, sel, cor})
       desenha as violações no canvas JÁ no referencial do mundo (mm, Y para cima — o
       transformaMundo do pcbframe): px(n) = n pixels em mm; sel = a violação escolhida
     HubPcbRegrasUI.baixar(nome, texto, mime)   download de um texto (o relatório) */
(function (raiz, fabrica) {
  const m = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.HubPcbRegrasUI = m;
})(typeof self !== 'undefined' ? self : this, function (raiz) {
"use strict";

const RG = () => raiz.HubPcbRegras || (typeof require === 'function' ? require('./hub-pcbregras.js') : null);
const DRC = () => raiz.HubPcbDrc || (typeof require === 'function' ? require('./hub-pcbdrc.js') : null);
const DLG = () => raiz.HubDialog || null;
const isNum = v => typeof v === 'number' && isFinite(v);

/* as variáveis da vista, com o token do hub como reserva (a ponte do pcbframe.html) */
const CSS = `
.prx-scrim{position:fixed; inset:0; z-index:8000; display:flex; align-items:center; justify-content:center;
  background:var(--scrim); font:13px/1.45 var(--font); color:var(--fg, var(--text));}
.prx{width:min(1180px, 96vw); height:min(720px, 92vh); display:flex; flex-direction:column; background:var(--panel, var(--surface-2));
  border-radius:var(--r-md, 8px); box-shadow:var(--shadow-menu); overflow:hidden;}
.prx-hd{flex:none; display:flex; align-items:center; gap:10px; padding:8px 10px 8px 14px; border-bottom:1px solid var(--border, var(--edge));}
.prx-hd h2{margin:0; font-size:13px; font-weight:600; color:var(--fg, var(--text));}
.prx-hd .prx-orig{font-size:11px; color:var(--fg-dim, var(--text-2)); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; flex:1;}
.prx-corpo{flex:1; display:flex; min-height:0;}
.prx-arv{flex:0 0 260px; overflow:auto; border-right:1px solid var(--border, var(--edge)); padding:6px 0; background:var(--panel2, var(--surface));}
.prx-arv .n{display:flex; align-items:center; gap:6px; padding:2px 10px; cursor:pointer; white-space:nowrap; font-size:12px; color:var(--fg, var(--text));}
.prx-arv .n:hover{background:rgba(var(--tint), .07);}
.prx-arv .n.on{background:rgba(var(--tint), .13);}
.prx-arv .n .c{margin-left:auto; color:var(--fg-dim, var(--text-2)); font-size:11px; font-variant-numeric:tabular-nums;}
.prx-arv .n.l1{padding-left:10px; font-weight:600;} .prx-arv .n.l2{padding-left:24px;} .prx-arv .n.l3{padding-left:40px;}
.prx-arv .n.off{color:var(--fg-dim, var(--text-2)); text-decoration:line-through;}
.prx-arv .n .seta{width:10px; color:var(--fg-dim, var(--text-2)); font-size:10px;}
.prx-dir{flex:1; overflow:auto; padding:12px 16px; min-width:0;}
.prx-dir h3{margin:0 0 8px; font-size:13px; font-weight:600;}
.prx-dir .sub{font-size:11px; color:var(--fg-dim, var(--text-2)); margin:-4px 0 10px;}
.prx-tab{border-collapse:collapse; width:100%; font-size:12px;}
.prx-tab th{text-align:left; font-weight:400; color:var(--fg-dim, var(--text-2)); border-bottom:1px solid var(--border, var(--edge)); padding:4px 6px; white-space:nowrap;}
.prx-tab td{padding:3px 6px; border-bottom:1px solid var(--line-soft, transparent); vertical-align:top;}
.prx-tab tr.lin{cursor:pointer;} .prx-tab tr.lin:hover td{background:rgba(var(--tint), .06);}
.prx-tab tr.off td{color:var(--fg-dim, var(--text-2));}
.prx-tab td.num{text-align:right; font-variant-numeric:tabular-nums;}
.prx-tab td.mono{font-family:var(--mono); font-size:11.5px; word-break:break-word;}
.prx-sec{margin:12px 0; padding:10px 12px; border:1px solid var(--border, var(--edge)); border-radius:var(--r-sm, 5px);}
.prx-sec > .t{font-size:10px; text-transform:uppercase; letter-spacing:.09em; color:var(--fg-dim, var(--text-2)); margin-bottom:6px;}
.prx-l{display:grid; grid-template-columns:170px minmax(0,1fr); align-items:center; gap:4px 10px; margin:4px 0; font-size:12px;}
.prx-l > span{color:var(--fg-dim, var(--text-2));}
.prx input[type=text], .prx textarea, .prx select{font:12px var(--font); color:var(--fg, var(--text)); background:var(--panel2, var(--surface));
  border:1px solid var(--border, var(--edge)); border-radius:4px; padding:4px 6px; min-width:0;}
.prx textarea{font-family:var(--mono); width:100%; min-height:44px; resize:vertical;}
.prx input.len{width:110px; text-align:right; font-variant-numeric:tabular-nums;}
.prx input.bad, .prx textarea.bad{border-color:var(--err);}
.prx input:focus, .prx textarea:focus, .prx select:focus{outline:none; border-color:var(--accent, var(--hi));}
.prx .ok{color:var(--ok);} .prx .warn{color:var(--warn);} .prx .err{color:var(--err);}
.prx .msg{font-size:11px; margin-top:3px;}
.prx button{background:transparent; color:var(--fg, var(--text)); border:1px solid var(--border, var(--edge)); border-radius:4px;
  padding:4px 10px; font:12px var(--font); cursor:pointer; white-space:nowrap;}
.prx button:hover{border-color:var(--accent, var(--hi));}
.prx button.pri{color:var(--accent, var(--hi)); border-color:var(--accent, var(--hi));}
.prx button.dan{color:var(--err); border-color:var(--err);}
.prx button:disabled{opacity:.45; cursor:not-allowed;}
.prx button.x{border:none; font-size:16px; line-height:1; padding:2px 6px; color:var(--fg-dim, var(--text-2));}
.prx .uni{display:inline-flex; border:1px solid var(--border, var(--edge)); border-radius:4px; overflow:hidden;}
.prx .uni button{border:none; border-radius:0; padding:2px 8px;}
.prx .uni button.on{background:var(--accent, var(--hi)); color:var(--on-hi);}
.prx-pe{flex:none; display:flex; gap:8px; align-items:center; padding:8px 12px; border-top:1px solid var(--border, var(--edge));}
.prx-pe .esp{flex:1;}
.prx-bar{display:flex; gap:6px; flex-wrap:wrap; margin:0 0 10px;}
.prx-mat{border-collapse:collapse; font-size:11px; margin-top:4px;}
.prx-mat th{font-weight:400; color:var(--fg-dim, var(--text-2)); padding:1px 3px; text-align:center;}
.prx-mat td{padding:1px;} .prx-mat input{width:58px; text-align:right; padding:2px 3px; font-size:11px;}
.prx-raw{font-family:var(--mono); font-size:11px; white-space:pre-wrap; word-break:break-word; color:var(--fg-dim, var(--text-2));}
.prx-cams{display:flex; flex-wrap:wrap; gap:4px 12px;}
.prx-cams label, .prx-chk{display:inline-flex; align-items:center; gap:5px; font-size:12px; cursor:pointer;}

/* o painel Messages do DRC */
.pdm{display:flex; flex-direction:column; min-height:0; height:100%; background:var(--panel, var(--surface-2)); color:var(--fg, var(--text)); font:12px/1.4 var(--font);}
.pdm-hd{flex:none; display:flex; align-items:center; gap:8px; padding:5px 8px; border-bottom:1px solid var(--border, var(--edge)); flex-wrap:wrap;}
.pdm-hd b{font-weight:600; font-size:12px;}
.pdm-hd .res{color:var(--fg-dim, var(--text-2)); font-size:11px;}
.pdm-hd .esp{flex:1;}
.pdm button{background:transparent; color:var(--fg, var(--text)); border:1px solid var(--border, var(--edge)); border-radius:4px; padding:2px 9px; font:12px var(--font); cursor:pointer;}
.pdm button:hover{border-color:var(--accent, var(--hi));}
.pdm button.pri{color:var(--accent, var(--hi)); border-color:var(--accent, var(--hi));}
.pdm button.x{border:none; font-size:15px; line-height:1; padding:0 4px; color:var(--fg-dim, var(--text-2));}
.pdm-chips{flex:none; display:flex; gap:5px; flex-wrap:wrap; padding:5px 8px; border-bottom:1px solid var(--border, var(--edge));}
.pdm-chip{display:inline-flex; gap:6px; align-items:center; padding:1px 8px; border-radius:10px; border:1px solid var(--border, var(--edge)); cursor:pointer; font-size:11px; white-space:nowrap;}
.pdm-chip .n{font-variant-numeric:tabular-nums; color:var(--err);}
.pdm-chip.on{border-color:var(--accent, var(--hi)); color:var(--accent, var(--hi));}
.pdm-lista{flex:1; overflow:auto; min-height:0;}
.pdm-lista table{border-collapse:collapse; width:100%;}
.pdm-lista th{position:sticky; top:0; background:var(--panel, var(--surface-2)); text-align:left; font-weight:400; color:var(--fg-dim, var(--text-2));
  padding:3px 8px; border-bottom:1px solid var(--border, var(--edge)); white-space:nowrap; z-index:1;}
.pdm-lista td{padding:2px 8px; border-bottom:1px solid var(--line-soft, transparent); vertical-align:top;}
.pdm-lista tr{cursor:pointer;} .pdm-lista tr:hover td{background:rgba(var(--tint), .06);}
.pdm-lista tr.on td{background:rgba(var(--tint), .14);}
.pdm-lista td.cl{white-space:nowrap; color:var(--err);}
.pdm-lista td.xy{white-space:nowrap; text-align:right; font-variant-numeric:tabular-nums; color:var(--fg-dim, var(--text-2));}
.pdm-vazio{padding:14px; color:var(--fg-dim, var(--text-2));}
.pdm-vazio.ok{color:var(--ok);}
.pdm-flut{position:fixed; left:12px; right:12px; bottom:34px; height:230px; z-index:7000; border-radius:var(--r-md, 8px);
  box-shadow:var(--shadow-menu); overflow:hidden;}
`;

let cssPronto = false;
function poeCss(){
  if (cssPronto || typeof document === 'undefined') return;
  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);
  cssPronto = true;
}
function el(tag, cls, txt){
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = txt;
  return e;
}
const dcopy = v => JSON.parse(JSON.stringify(v));

/* ============================== unidades ============================== */

const MIL = 0.0254;
function mostra(v, un){
  if (!isNum(v)) return '';
  return un === 'mil' ? String(Math.round(v / MIL * 1000) / 1000) : String(Math.round(v * 1e5) / 1e5);
}
/* o campo aceita "10mil", "0.2mm", "0,2" (na unidade da tela) */
function entende(txt, un){
  const s = String(txt == null ? '' : txt).trim().replace(',', '.').toLowerCase();
  if (s === '') return NaN;
  if (/mil$|mm$|in$|um$/.test(s)) return RG().paraMm(s);
  const n = parseFloat(s);
  if (!isFinite(n) || !/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/.test(s)) return NaN;
  return un === 'mil' ? Math.round(n * MIL * 1e6) / 1e6 : n;
}

/* ============================== o editor de regras ============================== */

function abrirEditor(opts){
  poeCss();
  opts = opts || {};
  const R = RG();
  let S = R.normaliza(dcopy(opts.regras || R.padroes()));
  let un = opts.unidade === 'mil' ? 'mil' : 'mm';
  let sujo = false;
  const placa = opts.placa || null;
  const descs = placa ? R.descritores(placa) : [];
  const nets = placa && Array.isArray(placa.nets) ? placa.nets.slice() : [];
  /* a seleção da árvore: {cat} | {kind} | {regra: índice em S.rules} | {raiz:true} */
  let sel = { raiz:true };
  const abertos = new Set(R.CATEGORIAS.map(c => c.id));

  return new Promise(resolve => {
    const scrim = el('div', 'prx-scrim');
    const box = el('div', 'prx');
    scrim.appendChild(box);
    const hd = el('div', 'prx-hd');
    const h2 = el('h2', null, opts.titulo || 'PCB Rules and Constraints Editor');
    const orig = el('div', 'prx-orig');
    const uni = el('div', 'uni');
    const bMm = el('button', null, 'mm'), bMil = el('button', null, 'mil');
    uni.append(bMm, bMil);
    const bX = el('button', 'x', '×');
    bX.title = 'Fechar sem salvar (Esc)';
    hd.append(h2, orig, uni, bX);
    const corpo = el('div', 'prx-corpo');
    const arv = el('div', 'prx-arv'), dir = el('div', 'prx-dir');
    corpo.append(arv, dir);
    const pe = el('div', 'prx-pe');
    const bCasa = el('button', null, 'Padrões da casa'), bAlt = el('button', null, 'Padrões do Altium');
    bCasa.title = 'Volta ao template DieletronsAltium (AD21)';
    bAlt.title = 'Volta ao padrão de fábrica do Altium 21 (A4.PCBDOC)';
    const esp = el('span', 'esp');
    const bCanc = el('button', null, 'Cancelar'), bAplic = el('button', null, 'Aplicar'), bOk = el('button', 'pri', 'OK');
    pe.append(bCasa, bAlt, esp, bCanc, bAplic, bOk);
    box.append(hd, corpo, pe);
    document.body.appendChild(scrim);

    const marca = () => { sujo = true; bAplic.disabled = false; };
    const fecha = v => { document.removeEventListener('keydown', tecla, true); scrim.remove(); resolve(v); };
    const tecla = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelar(); } };
    document.addEventListener('keydown', tecla, true);

    async function cancelar(){
      if (sujo && DLG() && !(await DLG().confirm('Descartar as mudanças nas regras?', { title:'Regras de projeto', ok:'Descartar', danger:true }))) return;
      fecha(null);
    }
    /* nome repetido no mesmo tipo e escopo inválido seguram o salvar */
    function problemas(){
      const out = [], vistos = new Set();
      for (const r of S.rules) {
        const k = r.kind + '\u0001' + r.name;
        if (vistos.has(k)) out.push('nome repetido: ' + r.name);
        vistos.add(k);
        for (const q of [1, 2]) {
          const c = R.compila(q === 1 ? r.scope1 : r.scope2);
          if (!c.ok) out.push(r.name + ': escopo ' + q + ' inválido (' + c.erro + ')');
        }
      }
      return out;
    }
    async function aplicar(){
      const p = problemas();
      if (p.length) { if (DLG()) await DLG().alert(p.slice(0, 12).join('\n'), { title:'Regras com problema' }); return false; }
      /* o normaliza reordena a lista: a regra aberta é achada de novo pelo tipo e nome */
      const aberta = isNum(sel.regra) ? S.rules[sel.regra] : null;
      S = R.normaliza(S);
      if (aberta) { const j = S.rules.findIndex(x => x.kind === aberta.kind && x.name === aberta.name); sel = j >= 0 ? { regra:j } : { kind:aberta.kind }; }
      if (typeof opts.salvar === 'function') {
        let ok = false;
        try { ok = await opts.salvar(dcopy(S), R.serializa(S)); } catch (e) { ok = false; if (DLG()) DLG().toast('Não salvei as regras: ' + (e && e.message || e), 'err'); }
        if (ok === false) return false;
      }
      sujo = false; bAplic.disabled = true;
      if (DLG()) DLG().toast('Regras de projeto salvas', 'ok', 1800);
      return true;
    }
    bX.onclick = cancelar; bCanc.onclick = cancelar;
    bAplic.onclick = () => aplicar().then(() => desenha());
    bOk.onclick = async () => { if (!sujo && typeof opts.salvar === 'function') return fecha(R.normaliza(S)); if (await aplicar()) fecha(R.normaliza(S)); };
    bAplic.disabled = true;
    scrim.addEventListener('mousedown', e => { if (e.target === scrim) cancelar(); });
    const trocaPadrao = async (qual) => {
      const nome = qual === 'casa' ? 'o template da casa (DieletronsAltium)' : 'o padrão de fábrica do Altium 21';
      if (DLG() && !(await DLG().confirm('Trocar TODAS as regras por ' + nome + '? As regras por net (largura do 0V...) e as classes se perdem.', { title:'Regras de projeto', ok:'Trocar', danger:true }))) return;
      S = qual === 'casa' ? R.padroesCasa() : R.padroesAltium();
      sel = { raiz:true }; marca(); desenha();
    };
    bCasa.onclick = () => trocaPadrao('casa');
    bAlt.onclick = () => trocaPadrao('altium');
    bMm.onclick = () => { un = 'mm'; desenha(); };
    bMil.onclick = () => { un = 'mil'; desenha(); };

    const tiposDaCat = c => c.id === 'Outras' ? [...new Set(S.rules.filter(r => !R.TIPOS[r.kind]).map(r => r.kind))].sort() : c.tipos;
    const regrasDo = k => S.rules.map((r, i) => [r, i]).filter(p => p[0].kind === k).sort((a, b) => a[0].priority - b[0].priority);

    function desenha(){
      bMm.className = un === 'mm' ? 'on' : ''; bMil.className = un === 'mil' ? 'on' : '';
      orig.textContent = S.origem ? '— ' + S.origem : '';
      orig.title = S.origem || '';
      desenhaArvore();
      desenhaDireita();
    }
    function no(txt, nivel, ativo, onclick, conta, seta, apagado){
      const n = el('div', 'n l' + nivel + (ativo ? ' on' : '') + (apagado ? ' off' : ''));
      if (seta !== undefined) n.appendChild(el('span', 'seta', seta ? '▾' : '▸'));
      n.appendChild(el('span', null, txt));
      if (conta != null) n.appendChild(el('span', 'c', String(conta)));
      n.onclick = onclick;
      arv.appendChild(n);
      return n;
    }
    function desenhaArvore(){
      const topo = arv.scrollTop;
      arv.textContent = '';
      no('Design Rules', 1, !!sel.raiz, () => { sel = { raiz:true }; desenha(); }, S.rules.length);
      for (const c of R.CATEGORIAS) {
        const tipos = tiposDaCat(c);
        if (!tipos.length) continue;
        const n = S.rules.filter(r => tipos.indexOf(r.kind) >= 0).length;
        const ab = abertos.has(c.id);
        no(c.nome, 1, sel.cat === c.id, () => { if (sel.cat === c.id) { ab ? abertos.delete(c.id) : abertos.add(c.id); } else abertos.add(c.id); sel = { cat:c.id }; desenha(); }, n, ab);
        if (!ab) continue;
        for (const k of tipos) {
          const L = regrasDo(k);
          no((R.TIPOS[k] && R.TIPOS[k].nome) || k, 2, sel.kind === k, () => { sel = { kind:k }; desenha(); }, L.length);
          for (const [r, i] of L) no(r.name, 3, sel.regra === i, () => { sel = { regra:i }; desenha(); }, r.priority, undefined, !r.enabled);
        }
      }
      arv.scrollTop = topo;
    }

    /* a tabela de regras (raiz, categoria ou tipo), como a lista do Altium */
    function tabela(lista, comTipo){
      const t = el('table', 'prx-tab');
      const h = el('tr');
      for (const c of ['Nome', 'Prioridade', 'Habilitada'].concat(comTipo ? ['Tipo'] : [], ['Escopo', 'Valores'])) h.appendChild(el('th', null, c));
      t.appendChild(h);
      for (const [r, i] of lista) {
        const tr = el('tr', 'lin' + (r.enabled ? '' : ' off'));
        tr.appendChild(el('td', null, r.name));
        tr.appendChild(el('td', 'num', String(r.priority)));
        const td = el('td');
        const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!r.enabled;
        cb.onclick = e => { e.stopPropagation(); r.enabled = cb.checked; marca(); desenha(); };
        td.appendChild(cb); tr.appendChild(td);
        if (comTipo) tr.appendChild(el('td', null, (R.TIPOS[r.kind] && R.TIPOS[r.kind].nome) || r.kind));
        tr.appendChild(el('td', 'mono', r.scope1 + (R.TIPOS[r.kind] && R.TIPOS[r.kind].binaria ? '  /  ' + r.scope2 : '')));
        tr.appendChild(el('td', 'mono', resumoValores(r)));
        tr.onclick = () => { sel = { regra:i }; desenha(); };
        t.appendChild(tr);
      }
      return t;
    }
    function resumoValores(r){
      const T = R.TIPOS[r.kind];
      if (!T) return 'do Altium (o hub não confere)';
      const out = [];
      for (const c of T.campos) {
        const v = r[c.k];
        if (c.un === 'len' && isNum(v)) out.push(c.rotulo + ' ' + mostra(v, un) + un);
        else if (c.un === 'bool' && v === true) out.push(c.rotulo);
        else if (c.un === 'enum' && v != null) out.push(String(v));
      }
      return out.join(' · ');
    }
    function desenhaDireita(){
      dir.textContent = '';
      if (sel.raiz) {
        dir.appendChild(el('h3', null, 'Todas as regras'));
        dir.appendChild(el('div', 'sub', 'Prioridade 1 vence: das regras habilitadas do tipo, vale a primeira cujo escopo casa com o objeto (com o par, para as de dois escopos). Clique numa regra para editar.'));
        dir.appendChild(tabela(S.rules.map((r, i) => [r, i]), true));
        return;
      }
      if (sel.cat) {
        const c = R.CATEGORIAS.find(x => x.id === sel.cat);
        dir.appendChild(el('h3', null, c ? c.nome : sel.cat));
        const tipos = c ? tiposDaCat(c) : [];
        dir.appendChild(tabela(S.rules.map((r, i) => [r, i]).filter(p => tipos.indexOf(p[0].kind) >= 0), true));
        return;
      }
      if (sel.kind) return desenhaTipo(sel.kind);
      if (isNum(sel.regra) && S.rules[sel.regra]) return desenhaRegra(S.rules[sel.regra], sel.regra);
      sel = { raiz:true }; desenhaDireita();
    }
    function desenhaTipo(k){
      const T = R.TIPOS[k];
      dir.appendChild(el('h3', null, (T && T.titulo) || k));
      if (!T) dir.appendChild(el('div', 'sub', 'Tipo de regra do Altium que o hub não modela: atravessa intacto na ida e volta, e o DRC do hub não o confere.'));
      else if (!T.drc) dir.appendChild(el('div', 'sub', 'Regra de projeto (usada pelo Gerber, pelo roteamento ou pelo polígono); o DRC não tem o que conferir nela.'));
      const bar = el('div', 'prx-bar');
      if (T) {
        const bN = el('button', 'pri', 'Nova regra');
        bN.onclick = () => {
          const r = R.novaRegra(S, k);
          for (const x of S.rules) if (x.kind === k) x.priority++;
          S.rules.push(r);
          sel = { regra:S.rules.length - 1 }; marca(); desenha();
        };
        bar.appendChild(bN);
      }
      dir.appendChild(bar);
      dir.appendChild(tabela(regrasDo(k), false));
      /* o "Rules To Check" do Altium: em que DRC este tipo entra */
      const sec = el('div', 'prx-sec');
      sec.appendChild(el('div', 't', 'Verificar no DRC (Rules To Check)'));
      const V = S.verificar || (S.verificar = dcopy(R.VERIFICAR_CASA));
      for (const [modo, rot] of [['lote', 'DRC completo (Batch)'], ['online', 'Durante a edição (Online)']]) {
        const lb = el('label', 'prx-chk');
        const cb = el('input'); cb.type = 'checkbox'; cb.checked = V[modo].indexOf(k) >= 0;
        cb.onchange = () => { const L = V[modo], i = L.indexOf(k); if (cb.checked && i < 0) L.push(k); if (!cb.checked && i >= 0) L.splice(i, 1); marca(); };
        lb.append(cb, el('span', null, rot));
        sec.appendChild(lb); sec.appendChild(el('span', null, '   '));
      }
      dir.appendChild(sec);
    }

    /* o "casa N objetos" do escopo, contra a placa aberta */
    function contaEscopo(expr){
      if (!descs.length) return null;
      const c = R.compila(expr);
      if (!c.ok) return null;
      const ctx = { classes:S.classes, board:placa };
      let n = 0, nulos = 0;
      for (const d of descs) { const v = c.avalia(d, ctx); if (v === true) n++; else if (v === null) nulos++; }
      return { n, nulos };
    }
    function campoEscopo(r, q){
      const wrap = el('div');
      const ta = el('textarea');
      ta.value = q === 1 ? r.scope1 : r.scope2;
      ta.spellcheck = false;
      const msg = el('div', 'msg');
      const valida = () => {
        const c = R.compila(ta.value);
        ta.classList.toggle('bad', !c.ok);
        if (!c.ok) { msg.className = 'msg err'; msg.textContent = c.erro; return; }
        const k = contaEscopo(ta.value);
        if (c.desconhecidas.length) { msg.className = 'msg warn'; msg.textContent = 'O hub não entende ' + c.desconhecidas.join(', ') + ': a regra fica de fora do DRC daqui (no Altium vale).'; return; }
        msg.className = 'msg ok';
        msg.textContent = k ? 'casa ' + k.n + ' de ' + descs.length + ' objetos da placa' : 'escopo válido';
      };
      ta.oninput = () => { if (q === 1) r.scope1 = ta.value; else r.scope2 = ta.value; marca(); valida(); };
      ta.onblur = () => desenhaArvore();
      valida();
      /* atalhos do Query Helper: net da placa e as funções mais usadas */
      const bar = el('div', 'prx-bar');
      bar.style.margin = '4px 0 0';
      const sNet = el('select');
      sNet.appendChild(el('option', null, 'InNet(…)'));
      for (const n of nets) { const o = el('option', null, n); o.value = n; sNet.appendChild(o); }
      sNet.onchange = () => { if (sNet.selectedIndex > 0) { ta.value = "InNet('" + sNet.value.replace(/'/g, "''") + "')"; ta.oninput(); } sNet.selectedIndex = 0; };
      const sFn = el('select');
      for (const f of ['Atalho…', 'All', 'IsPad', 'IsVia', 'IsTrack', 'IsSMDPad', 'IsThruHole', 'InPolygon', "InNetClass('All Nets')", "OnLayer('Top Layer')", "InComponent('U1')", "HasFootprint('')"]) sFn.appendChild(el('option', null, f));
      sFn.onchange = () => { if (sFn.selectedIndex > 0) { const v = sFn.value; ta.value = (ta.value.trim() && ta.value.trim() !== 'All' && v !== 'All') ? ta.value.trim() + ' and ' + v : v; ta.oninput(); } sFn.selectedIndex = 0; };
      if (nets.length) bar.appendChild(sNet);
      bar.appendChild(sFn);
      wrap.append(ta, msg, bar);
      return wrap;
    }
    function linha(rot, ctl){ const l = el('div', 'prx-l'); l.append(el('span', null, rot), ctl); return l; }
    function campoLen(r, k, onde){
      const inp = el('input', 'len'); inp.type = 'text';
      const alvo = onde || r;
      inp.value = mostra(alvo[k], un);
      const box2 = el('span');
      box2.append(inp, el('span', null, ' ' + un));
      inp.onchange = () => {
        const v = entende(inp.value, un);
        if (inp.value.trim() === '' && onde) { delete alvo[k]; inp.classList.remove('bad'); marca(); return; }
        if (!isNum(v)) { inp.classList.add('bad'); return; }
        inp.classList.remove('bad'); alvo[k] = v; inp.value = mostra(v, un); marca(); desenhaArvore();
      };
      return box2;
    }
    function desenhaRegra(r, i){
      const T = R.TIPOS[r.kind];
      dir.appendChild(el('h3', null, ((T && T.titulo) || r.kind) + ' — ' + r.name));
      const bar = el('div', 'prx-bar');
      const L = regrasDo(r.kind);
      const pos = L.findIndex(p => p[1] === i);
      const bSobe = el('button', null, 'Aumentar prioridade'), bDesce = el('button', null, 'Diminuir prioridade');
      bSobe.disabled = pos <= 0; bDesce.disabled = pos < 0 || pos >= L.length - 1;
      const troca = d => { const o = L[pos + d][0]; const t = o.priority; o.priority = r.priority; r.priority = t; marca(); desenha(); };
      bSobe.onclick = () => troca(-1); bDesce.onclick = () => troca(1);
      const bDup = el('button', null, 'Duplicar');
      bDup.disabled = !T;
      bDup.onclick = () => { const c = dcopy(r); const nomes = new Set(S.rules.map(x => x.name)); let n = r.name + '_copia', k = 2; while (nomes.has(n)) n = r.name + '_copia' + (k++); c.name = n;
                             for (const x of S.rules) if (x.kind === r.kind && x.priority > r.priority) x.priority++; c.priority = r.priority + 1; S.rules.push(c); sel = { regra:S.rules.length - 1 }; marca(); desenha(); };
      const bDel = el('button', 'dan', 'Apagar');
      bDel.onclick = async () => {
        if (DLG() && !(await DLG().confirm('Apagar a regra "' + r.name + '"?', { title:'Regras de projeto', ok:'Apagar', danger:true }))) return;
        S.rules.splice(i, 1); S = R.normaliza(S); sel = { kind:r.kind }; marca(); desenha();
      };
      bar.append(bSobe, bDesce, bDup, bDel);
      dir.appendChild(bar);

      const g = el('div', 'prx-sec');
      g.appendChild(el('div', 't', 'Regra'));
      const nome = el('input'); nome.type = 'text'; nome.value = r.name;
      nome.onchange = () => { const v = nome.value.trim(); if (!v) { nome.value = r.name; return; } r.name = v; marca(); desenha(); };
      g.appendChild(linha('Nome', nome));
      const com = el('input'); com.type = 'text'; com.value = r.comment || '';
      com.onchange = () => { r.comment = com.value; marca(); };
      g.appendChild(linha('Comentário', com));
      const hab = el('input'); hab.type = 'checkbox'; hab.checked = !!r.enabled;
      hab.onchange = () => { r.enabled = hab.checked; marca(); desenhaArvore(); };
      g.appendChild(linha('Habilitada', hab));
      g.appendChild(linha('Prioridade', el('span', null, r.priority + ' de ' + L.length + (r.priority === 1 ? ' (vence)' : ''))));
      if (r.nota) g.appendChild(linha('Nota', el('span', 'warn', r.nota)));
      dir.appendChild(g);

      const e1 = el('div', 'prx-sec');
      e1.appendChild(el('div', 't', T && T.binaria ? 'Onde o PRIMEIRO objeto casa' : 'Onde o objeto casa'));
      e1.appendChild(campoEscopo(r, 1));
      dir.appendChild(e1);
      if (T && T.binaria) {
        const e2 = el('div', 'prx-sec');
        e2.appendChild(el('div', 't', 'Onde o SEGUNDO objeto casa'));
        e2.appendChild(campoEscopo(r, 2));
        dir.appendChild(e2);
      }

      const v = el('div', 'prx-sec');
      v.appendChild(el('div', 't', 'Restrições'));
      if (!T) {
        v.appendChild(el('div', 'prx-raw', Object.entries(r.altium || {}).map(([k, x]) => k + '=' + x).join('\n') || '(sem campos)'));
        dir.appendChild(v);
        return;
      }
      if (!T.campos.length) v.appendChild(el('div', 'sub', 'Sem parâmetro: a regra só liga e desliga a checagem.'));
      for (const c of T.campos) {
        if (c.un === 'len') v.appendChild(linha(c.rotulo, campoLen(r, c.k)));
        else if (c.un === 'bool') {
          const cb = el('input'); cb.type = 'checkbox'; cb.checked = r[c.k] === true;
          cb.onchange = () => { r[c.k] = cb.checked; marca(); };
          v.appendChild(linha(c.rotulo, cb));
        } else if (c.un === 'enum') {
          const s = el('select');
          for (const o of c.opcoes) { const op = el('option', null, String(o)); op.value = String(o); s.appendChild(op); }
          s.value = String(r[c.k]);
          s.onchange = () => { const o = c.opcoes.find(x => String(x) === s.value); r[c.k] = o; marca(); };
          v.appendChild(linha(c.rotulo, s));
        } else if (c.un === 'layers') {
          const box2 = el('div', 'prx-cams');
          const cams = ['Top'].concat(placa && Array.isArray(placa.layers) ? placa.layers.map(l => l && l.key).filter(k => /^Mid\d+$/.test(k)) : [], ['Bottom']);
          r.layers = r.layers || {};
          for (const k of cams) {
            const lb = el('label');
            const cb = el('input'); cb.type = 'checkbox'; cb.checked = r.layers[k] !== false;
            cb.onchange = () => { r.layers[k] = cb.checked; marca(); };
            lb.append(cb, el('span', null, R.nomeAltium(k)));
            box2.appendChild(lb);
          }
          v.appendChild(linha(c.rotulo, box2));
        }
      }
      if (r.kind === 'Width' && r.porCamada) {
        const sub = el('div', 'sub', 'Por camada (o Altium só grava a camada que difere da geral; vazio = a geral):');
        v.appendChild(sub);
        const cams = ['Top', 'Bottom'].concat(Object.keys(r.porCamada).filter(k => /^Mid\d+$/.test(k) && (!placa || !Array.isArray(placa.layers) || placa.layers.some(l => l && l.key === k))));
        for (const k of [...new Set(cams)]) {
          const pc = r.porCamada[k] || (r.porCamada[k] = {});
          const box2 = el('span');
          for (const f of ['min', 'pref', 'max']) { box2.append(el('span', null, ' ' + f + ' ')); box2.appendChild(campoLen(r, f, pc)); }
          v.appendChild(linha(R.nomeAltium(k), box2));
        }
      }
      if (r.kind === 'Clearance') v.appendChild(matriz(r));
      dir.appendChild(v);
    }
    /* a matriz de folgas por tipo de objeto (o "Minimum Clearance Matrix" do AD19+): vazio = a geral */
    function matriz(r){
      const O = R.OBJ_MATRIZ;
      const wrap = el('div');
      wrap.appendChild(el('div', 'sub', 'Folga por tipo de objeto (' + un + '; vazio = a folga geral):'));
      const t = el('table', 'prx-mat');
      const h = el('tr'); h.appendChild(el('th'));
      for (const o of O) h.appendChild(el('th', null, o));
      t.appendChild(h);
      r.matrix = r.matrix || {};
      O.forEach((a, ia) => {
        const tr = el('tr');
        tr.appendChild(el('th', null, a));
        O.forEach((b, ib) => {
          const td = el('td');
          if (ib <= ia) {
            const k1 = b + '-' + a, k2 = a + '-' + b;
            const chave = (k1 in r.matrix) ? k1 : k2;
            const inp = el('input'); inp.type = 'text';
            inp.value = isNum(r.matrix[chave]) ? mostra(r.matrix[chave], un) : '';
            inp.placeholder = mostra(r.gap, un);
            inp.onchange = () => {
              if (inp.value.trim() === '') { delete r.matrix[k1]; delete r.matrix[k2]; inp.classList.remove('bad'); marca(); return; }
              const v = entende(inp.value, un);
              if (!isNum(v)) { inp.classList.add('bad'); return; }
              inp.classList.remove('bad'); delete r.matrix[k1]; delete r.matrix[k2]; r.matrix[chave] = v; marca();
            };
            td.appendChild(inp);
          }
          tr.appendChild(td);
        });
        t.appendChild(tr);
      });
      wrap.appendChild(t);
      return wrap;
    }
    desenha();
  });
}

/* ============================== o painel Messages do DRC ============================== */

function baixar(nome, texto, mime){
  if (typeof document === 'undefined') return;
  const b = new Blob([texto], { type: mime || 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function painelDrc(container, opts){
  poeCss();
  opts = opts || {};
  const raizEl = el('div', 'pdm');
  const hd = el('div', 'pdm-hd');
  const titulo = el('b', null, 'Messages — DRC');
  const res = el('span', 'res', 'DRC ainda não rodou');
  const esp = el('span', 'esp');
  const bRodar = el('button', 'pri', 'Rodar DRC');
  const bTxt = el('button', null, 'Relatório .txt'), bHtml = el('button', null, 'Relatório .html');
  bRodar.title = 'Design Rule Check: confere a placa com as mudanças contra as regras (as do lote do "Rules To Check")';
  hd.append(titulo, res, esp, bRodar, bTxt, bHtml);
  if (typeof opts.aoFechar === 'function') { const bX = el('button', 'x', '×'); bX.title = 'Fechar'; bX.onclick = opts.aoFechar; hd.appendChild(bX); }
  const chips = el('div', 'pdm-chips');
  const lista = el('div', 'pdm-lista');
  raizEl.append(hd, chips, lista);
  container.appendChild(raizEl);
  let R0 = null, filtro = null, atual = -1, linhas = [];
  bTxt.disabled = bHtml.disabled = true;

  const nomeArq = ext => 'Design Rule Check - ' + String(opts.arquivo || 'placa').replace(/[\\/:*?"<>|]/g, '_') + ext;
  bTxt.onclick = () => { if (R0) baixar(nomeArq('.txt'), DRC().relatorioTexto(R0, { arquivo:opts.arquivo }), 'text/plain;charset=utf-8'); };
  bHtml.onclick = () => { if (R0) baixar(nomeArq('.html'), DRC().relatorioHtml(R0, { arquivo:opts.arquivo }), 'text/html;charset=utf-8'); };
  async function rodar(){
    if (typeof opts.rodar !== 'function') return;
    bRodar.disabled = true; res.textContent = 'conferindo...';
    try { const r = await opts.rodar(); if (r) mostraRes(r); }
    catch (e) { res.textContent = 'o DRC falhou: ' + (e && e.message || e); if (DLG()) DLG().toast('O DRC falhou: ' + (e && e.message || e), 'err'); }
    finally { bRodar.disabled = false; }
  }
  bRodar.onclick = rodar;
  if (typeof opts.rodar !== 'function') bRodar.hidden = true;

  function mostraRes(r){
    R0 = r; filtro = null; atual = -1;
    bTxt.disabled = bHtml.disabled = false;
    res.textContent = r.total + ' violaç' + (r.total === 1 ? 'ão' : 'ões') + ' · ' + r.tempoMs + ' ms' + (r.avisos && r.avisos.length ? ' · ' + r.avisos.length + ' aviso(s)' : '');
    res.title = (r.avisos || []).join('\n');
    desenhaChips(); desenhaLista();
  }
  function desenhaChips(){
    chips.textContent = '';
    if (!R0 || !R0.porRegra.length) { chips.hidden = true; return; }
    chips.hidden = false;
    for (const c of R0.porRegra) {
      const k = c.regra + '|' + c.tipo;
      const ch = el('span', 'pdm-chip' + (filtro === k ? ' on' : ''));
      ch.append(el('span', null, c.titulo + (c.regra !== c.tipo ? ' (' + c.regra + ')' : '')), el('span', 'n', String(c.n)));
      ch.title = c.cortadas ? c.cortadas + ' além do teto não aparecem na lista' : 'filtrar';
      ch.onclick = () => { filtro = filtro === k ? null : k; desenhaChips(); desenhaLista(); };
      chips.appendChild(ch);
    }
  }
  function desenhaLista(){
    lista.textContent = '';
    linhas = [];
    if (!R0) { lista.appendChild(el('div', 'pdm-vazio', 'Rode o DRC para conferir a placa.')); return; }
    const vs = R0.violacoes.filter(v => !filtro || (v.regra + '|' + v.tipo) === filtro);
    if (!vs.length) { lista.appendChild(el('div', 'pdm-vazio ok', R0.total ? 'Nada neste filtro.' : 'Nenhuma violação: a placa passa nas regras.')); return; }
    const t = el('table');
    const h = el('tr');
    for (const c of ['Classe', 'Mensagem', 'x, y (mm)']) h.appendChild(el('th', null, c));
    t.appendChild(h);
    vs.forEach((v, i) => {
      const tr = el('tr');
      tr.append(el('td', 'cl', v.titulo || v.tipo), el('td', null, v.msg), el('td', 'xy', fmt(v.x) + ', ' + fmt(v.y)));
      tr.onclick = () => escolhe(i);
      t.appendChild(tr);
      linhas.push({ tr, v });
    });
    lista.appendChild(t);
  }
  const fmt = n => isNum(n) ? String(Math.round(n * 1000) / 1000) : '';
  function escolhe(i){
    if (!linhas[i]) return;
    if (linhas[atual]) linhas[atual].tr.classList.remove('on');
    atual = i;
    const L = linhas[i];
    L.tr.classList.add('on');
    if (L.tr.scrollIntoView) L.tr.scrollIntoView({ block:'nearest' });
    if (typeof opts.irPara === 'function') opts.irPara(L.v.x, L.v.y, L.v.ids || [], L.v);
  }
  /* ↑/↓ andam na lista, como no Messages do Altium */
  raizEl.tabIndex = 0;
  raizEl.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); escolhe(Math.min(linhas.length - 1, atual + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); escolhe(Math.max(0, atual - 1)); }
  });
  desenhaLista();
  return {
    el: raizEl, mostra: mostraRes, rodar,
    limpa(){ R0 = null; res.textContent = 'DRC ainda não rodou'; chips.textContent = ''; bTxt.disabled = bHtml.disabled = true; desenhaLista(); },
    selecionada(){ return linhas[atual] ? linhas[atual].v : null; },
    resultado(){ return R0; },
  };
}
/* o painel flutuando no rodapé da vista (fechar remove; abrir de novo devolve o mesmo) */
let flutuante = null;
function abrirDrc(opts){
  poeCss();
  if (flutuante && flutuante.wrap.isConnected) return flutuante.painel;
  const wrap = el('div', 'pdm-flut');
  document.body.appendChild(wrap);
  const o = Object.assign({}, opts || {});
  const fechaOrig = o.aoFechar;
  o.aoFechar = () => { wrap.remove(); flutuante = null; if (typeof fechaOrig === 'function') fechaOrig(); };
  const painel = painelDrc(wrap, o);
  flutuante = { wrap, painel };
  return painel;
}

/* ============================== marcadores no canvas ============================== */

/* As violações no canvas da vista, no referencial do mundo (o pcbframe já fez o transformaMundo):
   um círculo com X em cada uma e a linha tracejada da ligação que falta (UnRoutedNet). A cor é a
   de ERRO do tema (--err), lida do CSS — o mesmo vermelho do resto do hub. */
function desenhaMarcadores(ctx, violacoes, o){
  if (!ctx || !Array.isArray(violacoes) || !violacoes.length) return;
  o = o || {};
  const px = typeof o.px === 'function' ? o.px : (n => n * 0.05);
  let cor = o.cor;
  if (!cor && typeof getComputedStyle === 'function' && typeof document !== 'undefined')
    cor = getComputedStyle(document.documentElement).getPropertyValue('--err').trim();
  cor = cor || '#e0555a';
  const r = px(7), w = px(1.6);
  ctx.save();
  ctx.lineWidth = w;
  ctx.strokeStyle = cor;
  ctx.setLineDash([]);
  for (const v of violacoes) {
    if (!isNum(v.x) || !isNum(v.y)) continue;
    const s = o.sel === v;
    if (v.tipo === 'UnRoutedNet' && isNum(v.x1)) {
      ctx.save(); ctx.setLineDash([px(5), px(4)]); ctx.beginPath(); ctx.moveTo(v.x1, v.y1); ctx.lineTo(v.x2, v.y2); ctx.stroke(); ctx.restore();
    }
    const rr = s ? r * 1.6 : r;
    ctx.lineWidth = s ? w * 1.8 : w;
    ctx.beginPath(); ctx.arc(v.x, v.y, rr, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(v.x - rr * 0.6, v.y - rr * 0.6); ctx.lineTo(v.x + rr * 0.6, v.y + rr * 0.6);
    ctx.moveTo(v.x - rr * 0.6, v.y + rr * 0.6); ctx.lineTo(v.x + rr * 0.6, v.y - rr * 0.6);
    ctx.stroke();
  }
  ctx.restore();
}

return { abrirEditor, painelDrc, abrirDrc, desenhaMarcadores, baixar, _mostra: mostra, _entende: entende };
});
