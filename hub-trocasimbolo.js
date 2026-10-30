/* AltiumPCBMirror - hub-trocasimbolo.js — a pergunta do símbolo na troca de componente.

   Pedido do dono (2026-10-30): "no Converter para o almoxarifado às vezes o símbolo do esquema
   já está certo, mas o componente está errado". Trocar o componente trazia o desenho do
   almoxarifado e o desenho certo se perdia. Quando os dois desenhos não são o mesmo, a troca
   pergunta, e esta tela lista TODOS os componentes que vão ser trocados assim, cada um com:

     substituir   o componente do almoxarifado passa a ter o símbolo da folha (a biblioteca:
                  vale para todos os projetos que o usam);
     criar parte  o componente ganha uma parte nova com o símbolo da folha, e estes
                  designadores usam essa parte (os outros projetos ficam na parte 1);
     usar o do almoxarifado   o desenho do componente entra na folha, como sempre foi.

   E mostra o antes e o depois de cada escolha: o símbolo que o componente tinha e o que ele
   vira, ou a parte nova criada e o símbolo atribuído a ela.

   Quem decide o que é "diferente", grava na biblioteca e troca na folha é o schframe.js
   (__hubPreparaTroca, com a parte pura casoDoSimbolo/partesDaDecisao); aqui é só a tela.

   API
     HubTrocaSimbolo.pergunta(linhas, {desenha}) -> Promise<['substituir'|'parte'|'manter', ...] | null>
       linhas[i] = { refs, de:{sym, desenho}, para:{componente, familia, rotulo, desenho, partes, parteNova} }
       desenha = o HubDraw (drawSymbolPart, symBBox, SCH); null = cancelou (nada muda)          */
"use strict";
var HubTrocaSimbolo = (function () {

const CSS = `
#tsmodal{position:fixed; inset:0; z-index:80; display:none; background:var(--scrim,rgba(11,11,13,.62));}
#tsmodal.on{display:flex;}
#tsmodal .ts-box{position:absolute; inset:24px; display:grid; grid-template-rows:auto auto 1fr auto; min-height:0;
  background:var(--panel,#242424); border-radius:var(--r-md,8px); overflow:hidden;
  box-shadow:var(--shadow-menu, 0 0 0 1px #3a3a3a, 0 22px 60px rgba(0,0,0,.62));}
#tsmodal .ts-head{display:flex; align-items:center; gap:10px; padding:11px 13px;
  border-bottom:1px solid var(--border,#3a3a3a); background:var(--panel2,#2d2d2d);}
#tsmodal .ts-head h2{font-size:13px; font-weight:600; margin:0; flex:1;}
#tsmodal .ts-intro{padding:9px 13px; font-size:11.5px; line-height:1.5; color:var(--fg-dim,#9a9a9a);
  border-bottom:1px solid var(--border,#3a3a3a); display:flex; gap:10px; align-items:center; flex-wrap:wrap;}
#tsmodal .ts-intro p{margin:0; flex:1 1 380px;}
#tsmodal .ts-todos{display:flex; gap:6px; align-items:center; font-size:11px;}
#tsmodal .ts-lista{overflow:auto; min-height:0; padding:8px 13px;}
#tsmodal .ts-linha{border:1px solid var(--border,#3a3a3a); border-radius:6px; padding:9px 11px; margin-bottom:9px;}
#tsmodal .ts-linha.falta{border-color:var(--warn,#ffb74d);}
#tsmodal .ts-tit{font-size:12px; margin-bottom:7px; display:flex; gap:8px; align-items:baseline; flex-wrap:wrap;}
#tsmodal .ts-tit b{font-weight:600;}
#tsmodal .ts-tit .seta{color:var(--fg-dim,#9a9a9a);}
#tsmodal .ts-ops{display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px;}
#tsmodal .ts-ops button[aria-pressed=true]{border-color:var(--hi,#4fc3f7); color:var(--hi,#4fc3f7);
  background:rgba(var(--tint,79,195,247),.10);}
#tsmodal .ts-vis{display:flex; gap:12px; align-items:center; flex-wrap:wrap;}
#tsmodal figure{margin:0; display:flex; flex-direction:column; gap:4px; align-items:center;}
#tsmodal figure canvas{width:170px; height:112px; border-radius:4px; border:1px solid var(--border,#3a3a3a);}
#tsmodal figcaption{font-size:10.5px; color:var(--fg-dim,#9a9a9a); max-width:180px; text-align:center; line-height:1.35;}
#tsmodal .ts-vis .sx{font-size:18px; color:var(--fg-dim,#9a9a9a);}
#tsmodal .ts-nota{font-size:11px; color:var(--fg-dim,#9a9a9a); margin-top:6px;}
#tsmodal .ts-nota.aviso{color:var(--warn,#ffb74d);}
#tsmodal .ts-foot{display:flex; align-items:center; gap:10px; padding:10px 13px; border-top:1px solid var(--border,#3a3a3a);}
#tsmodal .ts-foot .est{flex:1; font-size:11px; color:var(--fg-dim,#9a9a9a);}
#tsmodal .ts-foot button.pri{border-color:var(--hi,#4fc3f7); color:var(--hi,#4fc3f7);}
`;
const OPCOES = [
  ['substituir', 'Substituir o símbolo do componente', 'o componente do almoxarifado passa a ter o símbolo que está na folha — vale para todos os projetos que usam este componente'],
  ['parte', 'Criar uma parte com o símbolo da folha', 'o componente ganha uma parte nova com o símbolo da folha, e estes designadores usam essa parte; os outros projetos continuam na parte 1'],
  ['manter', 'Usar o símbolo do almoxarifado', 'o desenho do componente do almoxarifado entra na folha, como a troca sempre fez'],
];

const $ = id => document.getElementById(id);
function el(tag, cls, text){
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/* uma miniatura do desenho, no papel do esquema e com o Y para cima, como a folha */
function mini(D, part, legenda){
  const fig = el('figure'), cv = el('canvas');
  fig.append(cv, el('figcaption', null, legenda));
  requestAnimationFrame(() => {
    const W = cv.clientWidth || 170, H = cv.clientHeight || 112, DPR = window.devicePixelRatio || 1;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = (D && D.SCH && D.SCH.sheet) || '#fffef2';
    ctx.fillRect(0, 0, cv.width, cv.height);
    if (!D || !part) return;
    const bb = D.symBBox(part);
    const esc = Math.min(W / Math.max(bb.x2 - bb.x1, 1), H / Math.max(bb.y2 - bb.y1, 1)) / 1.25;
    const cx = (bb.x1 + bb.x2) / 2, cy = (bb.y1 + bb.y2) / 2;
    ctx.setTransform(DPR * esc, 0, 0, -DPR * esc, DPR * (W / 2 - cx * esc), DPR * (H / 2 + cy * esc));
    try { D.drawSymbolPart(ctx, part, { honraOlho:false }); } catch (e) { /* desenho torto: fica o papel */ }
  });
  return fig;
}

/* o antes e o depois de UMA linha, na escolha dela */
function pintaVis(box, ln, dec, D){
  box.textContent = '';
  const refs = ln.refs.join(', '), comp = ln.para.componente;
  const vis = el('div', 'ts-vis'), seta = () => el('span', 'sx', '→');
  let nota = '';
  if (dec === 'substituir'){
    vis.append(mini(D, ln.para.desenho, comp + ' hoje (o símbolo antigo)'), seta(),
               mini(D, ln.de.desenho, comp + ' passa a ter o símbolo da folha'));
    nota = 'Grava na biblioteca: todo projeto que usa "' + comp + '" passa a desenhá-lo assim.';
  } else if (dec === 'parte'){
    const n = ln.para.parteNova || 2;
    vis.append(mini(D, ln.para.desenho, 'parte 1 de ' + comp + ' (fica como está)'), el('span', 'sx', '+'),
               mini(D, ln.de.desenho, 'parte ' + n + ' nova, com o símbolo da folha — ' + refs + ' usa' + (ln.refs.length > 1 ? 'm' : '') + ' esta'));
    nota = 'Grava na biblioteca: "' + comp + '" ganha a parte ' + n + '. Os outros projetos continuam na parte 1.';
  } else if (dec === 'manter'){
    vis.append(mini(D, ln.de.desenho, 'na folha hoje (' + (ln.de.sym || '?') + ')'), seta(),
               mini(D, ln.para.desenho, 'vira o símbolo de ' + comp));
    nota = 'Nada muda na biblioteca: a folha passa a desenhar o símbolo do almoxarifado.';
  } else {
    vis.append(mini(D, ln.de.desenho, 'na folha hoje (' + (ln.de.sym || '?') + ')'), el('span', 'sx', '≠'),
               mini(D, ln.para.desenho, comp + ' no almoxarifado'));
    nota = 'Escolha o que fazer com o símbolo da folha.';
  }
  const np = (ln.de.desenho && ln.de.desenho.pins || []).length, na = (ln.para.desenho && ln.para.desenho.pins || []).length;
  box.append(vis, el('div', 'ts-nota' + (dec ? '' : ' aviso'), nota));
  if (np !== na && dec !== 'manter')
    box.append(el('div', 'ts-nota aviso', 'Pinagem diferente: a folha tem ' + np + ' pino(s) e o componente ' + na
      + '. O símbolo da folha vai junto com a pinagem dele — confira o footprint de "' + comp + '".'));
}

let montado = false;
function monta(){
  if (montado) return;
  montado = true;
  const st = el('style'); st.textContent = CSS; document.head.appendChild(st);
  const m = el('div'); m.id = 'tsmodal';
  m.innerHTML = ''
    + '<div class="ts-box" role="dialog" aria-modal="true" aria-labelledby="tsTitulo">'
    +   '<div class="ts-head"><h2 id="tsTitulo">O símbolo da folha é diferente do componente novo</h2></div>'
    +   '<div class="ts-intro"><p id="tsIntro"></p><span class="ts-todos" id="tsTodos"></span></div>'
    +   '<div class="ts-lista" id="tsLista"></div>'
    +   '<div class="ts-foot"><span class="est" id="tsEst"></span>'
    +     '<button type="button" id="tsCancela">Cancelar</button>'
    +     '<button type="button" class="pri" id="tsOk" disabled>Trocar</button></div>'
    + '</div>';
  document.body.appendChild(m);
}

function pergunta(linhas, opts){
  const D = (opts && opts.desenha) || (typeof HubDraw !== 'undefined' ? HubDraw : null);
  if (!Array.isArray(linhas) || !linhas.length) return Promise.resolve([]);
  monta();
  return new Promise(fim => {
    const dec = linhas.map(() => null);
    const n = linhas.reduce((a, l) => a + l.refs.length, 0);
    $('tsIntro').textContent = n + (n === 1 ? ' componente vai' : ' componentes vão')
      + ' ser trocado' + (n === 1 ? '' : 's') + ' por um do almoxarifado com outro símbolo. '
      + 'Para cada um: substituir o símbolo do componente pelo da folha, criar uma parte com o '
      + 'símbolo da folha para esse componente, ou usar o símbolo do almoxarifado.';
    const linhaEls = [];
    const conta = () => {
      const falta = dec.filter(d => !d).length;
      $('tsEst').textContent = falta ? 'falta escolher ' + falta + ' de ' + dec.length
        : dec.length + (dec.length === 1 ? ' escolha feita' : ' escolhas feitas');
      $('tsOk').disabled = !!falta;
    };
    const escolhe = (i, d) => {
      dec[i] = d;
      const L = linhaEls[i];
      L.box.classList.toggle('falta', !d);
      for (const b of L.botoes) b.setAttribute('aria-pressed', String(b.dataset.d === d));
      pintaVis(L.vis, linhas[i], d, D);
      conta();
    };
    const todos = $('tsTodos'); todos.textContent = '';
    todos.append(el('span', null, 'para todos:'));
    for (const [d, rot] of OPCOES){
      const b = el('button', null, d === 'substituir' ? 'Substituir' : d === 'parte' ? 'Criar parte' : 'Usar o do almoxarifado');
      b.type = 'button'; b.title = rot;
      b.addEventListener('click', () => linhas.forEach((_, i) => escolhe(i, d)));
      todos.append(b);
    }
    const box = $('tsLista'); box.textContent = '';
    linhas.forEach((ln, i) => {
      const L = el('div', 'ts-linha falta');
      const t = el('div', 'ts-tit');
      t.append(el('b', null, ln.refs.join(', ')), el('span', null, ln.de.sym || '?'), el('span', 'seta', '→'),
               el('b', null, ln.para.componente));
      if (ln.para.familia) t.append(el('span', 'seta', '(' + ln.para.familia + ')'));
      const ops = el('div', 'ts-ops'), botoes = [];
      for (const [d, rot, dica] of OPCOES){
        const b = el('button', null, rot); b.type = 'button'; b.dataset.d = d; b.title = dica;
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', () => escolhe(i, d));
        ops.append(b); botoes.push(b);
      }
      const vis = el('div');
      L.append(t, ops, vis);
      box.append(L);
      linhaEls.push({ box:L, botoes, vis });
      pintaVis(vis, ln, null, D);
    });
    conta();
    const sai = r => {
      $('tsmodal').classList.remove('on');
      document.removeEventListener('keydown', tecla, true);
      $('tsOk').onclick = null; $('tsCancela').onclick = null;
      fim(r);
    };
    const tecla = e => { if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); sai(null); } };
    document.addEventListener('keydown', tecla, true);
    $('tsCancela').onclick = () => sai(null);
    $('tsOk').onclick = () => { if (!dec.some(d => !d)) sai(dec.slice()); };
    $('tsmodal').classList.add('on');
  });
}

return { pergunta };
})();
