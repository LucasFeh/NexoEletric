/* AltiumPCBMirror v2 - hub-pcbpdfui.js — o dialogo do PDF de layout (browser).
   Modal no tema do hub (os tokens do hub-tema.css: --surface, --text, --hi, --line, --scrim...;
   nenhuma cor propria), com a previa do PDF ao lado: o proprio PDF gerado, num <iframe> com o
   leitor do navegador/Electron - a previa e o arquivo, nao uma imitacao dele.

   Quem chama passa a placa EFETIVA (HubCore.effectiveBoard: a do Gerber, com as mudancas) e o
   resto por parametro; este arquivo nao conhece o pcbframe:

     await HubPcbPdfUi.abrir({
       placa:      eb | () => eb,      a placa efetiva (funcao: lida de novo a cada previa)
       projeto:    'DMB - DI231765_P2',  para a rota /api/pdf e para lembrar os campos por projeto
       podeSalvar: true|false,          o botao "Salvar no projeto" (hubserver + projeto aberto)
       sujo:       true|false,          ha mudancas nao salvas no changes.js (so avisa)
       salvar:     async ({proj, nome, base64, bytes}) => {caminho}   opcional: troca o POST /api/pdf
       carimbo:    { ... }              padroes do carimbo vindos do projeto (o resto o HubPcbPdf poe)
     })  -> Promise que resolve ao fechar

   Salvar: POST /api/pdf {proj, nome, base64} -> Projects/<proj>/PDF/<nome>.pdf (a rota e do
   hubserver). Se ela nao existir (404/405) ou a rede falhar, o PDF e baixado pelo navegador e a
   notificacao diz por que. Nunca alert/confirm/prompt: HubDialog.toast quando houver.

   Lembra (localStorage, tolerante a bloqueio): as opcoes e quem desenha/verifica/aprova em
   'pcbpdf.opcoes'; equipamento, desenho, revisao e OBS por projeto em 'pcbpdf.proj.<nome>'. */
"use strict";
var HubPcbPdfUi = (function () {

const CSS = `
.pp-scrim{position:fixed; inset:0; z-index:8000; display:flex; align-items:center; justify-content:center;
  background:var(--scrim,rgba(11,11,13,.6)); font:13px/1.45 var(--font,"Segoe UI",system-ui,sans-serif); color:var(--text,#d8d8d8);}
.pp-box{width:min(1280px,96vw); height:min(860px,92vh); background:var(--surface,#2d2d2d); border-radius:var(--r-md,8px);
  box-shadow:var(--shadow-menu,0 0 0 1px #3a3a3a,0 18px 44px rgba(0,0,0,.6)); display:flex; flex-direction:column; overflow:hidden;}
.pp-cab{display:flex; align-items:center; gap:10px; padding:10px 14px; border-bottom:1px solid var(--line,#3a3a3a);}
.pp-cab h3{margin:0; font-size:14px; font-weight:600; flex:1; letter-spacing:-.01em;}
.pp-cab .pp-meta{color:var(--text-3,#9a9a9a); font-size:12px;}
.pp-corpo{flex:1; display:flex; min-height:0;}
.pp-form{width:340px; flex:none; overflow:auto; padding:10px 14px 14px; border-right:1px solid var(--line,#3a3a3a);}
.pp-form fieldset{border:0; margin:0 0 10px; padding:0;}
.pp-form legend{font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--text-3,#9a9a9a); margin:6px 0 4px; padding:0;}
.pp-lin{display:flex; align-items:center; gap:8px; margin:3px 0;}
.pp-lin > span{width:96px; flex:none; color:var(--text-2,#bdbdbd); font-size:12px;}
.pp-lin input[type=text], .pp-lin select, .pp-form textarea{flex:1; min-width:0; background:var(--sunken,#1f1f1f); color:var(--text,#d8d8d8);
  border:1px solid var(--line,#3a3a3a); border-radius:var(--r-sm,4px); padding:3px 6px; font:inherit; font-size:12px;}
.pp-form textarea{width:100%; box-sizing:border-box; resize:vertical; min-height:38px;}
.pp-lin input:focus, .pp-lin select:focus, .pp-form textarea:focus{outline:1px solid var(--hi,#4fc3f7); border-color:var(--hi,#4fc3f7);}
.pp-chk{display:flex; flex-wrap:wrap; gap:4px 12px; margin:3px 0;}
.pp-chk label{display:flex; align-items:center; gap:5px; font-size:12px; color:var(--text-2,#bdbdbd); cursor:pointer;}
.pp-data{width:76px !important; flex:none !important;}
.pp-prev{flex:1; display:flex; flex-direction:column; min-width:0; background:var(--sunken,#1f1f1f);}
.pp-prev iframe{flex:1; border:0; width:100%; background:var(--sunken,#1f1f1f);}
.pp-prev .pp-vazio{flex:1; display:flex; align-items:center; justify-content:center; color:var(--text-3,#9a9a9a);}
.pp-avisos{max-height:84px; overflow:auto; margin:0; padding:6px 14px 6px 28px; font-size:12px; color:var(--warn,#ffb74d);
  border-top:1px solid var(--line,#3a3a3a); background:var(--surface,#2d2d2d);}
.pp-avisos:empty{display:none;}
.pp-pe{display:flex; gap:8px; justify-content:flex-end; align-items:center; padding:10px 14px; border-top:1px solid var(--line,#3a3a3a);}
.pp-pe .pp-st{flex:1; color:var(--text-3,#9a9a9a); font-size:12px;}
.pp-pe button{background:transparent; color:var(--text,#d8d8d8); border:1px solid var(--line,#3a3a3a); border-radius:var(--r-sm,4px);
  padding:6px 14px; font:inherit; font-size:12px; cursor:pointer; min-width:84px;}
.pp-pe button:hover{background:rgba(var(--tint,255,255,255),.07);}
.pp-pe button.ok{color:var(--hi,#4fc3f7); border-color:var(--hi,#4fc3f7);}
.pp-pe button:disabled{opacity:.45; cursor:default;}
.pp-pe button:focus-visible{outline:2px solid var(--hi,#4fc3f7); outline-offset:1px;}
@media (max-width:760px){ .pp-corpo{flex-direction:column;} .pp-form{width:auto; max-height:45%; border-right:0; border-bottom:1px solid var(--line,#3a3a3a);} }
`;
let cssPosto = false;
function poeCss() {
  if (cssPosto) return;
  const s = document.createElement('style'); s.id = 'hub-pcbpdfui-css'; s.textContent = CSS;
  document.head.appendChild(s); cssPosto = true;
}
const el = (tag, attrs, filhos) => {
  const e = document.createElement(tag);
  for (const k in (attrs || {})) {
    if (k === 'text') e.textContent = attrs[k];
    else if (k === 'class') e.className = attrs[k];
    else if (k in e && typeof attrs[k] !== 'string') e[k] = attrs[k];
    else e.setAttribute(k, attrs[k]);
  }
  for (const f of (filhos || [])) if (f) e.append(f);
  return e;
};
function avisa(msg, tipo, ms) {
  if (typeof HubDialog !== 'undefined' && HubDialog.toast) HubDialog.toast(msg, tipo || 'info', ms);
  else if (typeof console !== 'undefined') console.log('[PDF] ' + msg);
}
function le(chave) { try { return JSON.parse(localStorage.getItem(chave) || 'null'); } catch (_) { return null; } }
function grava(chave, v) { try { localStorage.setItem(chave, JSON.stringify(v)); } catch (_) { /* sem storage: so nao lembra */ } }
function base64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function baixa(bytes, nome) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = el('a', { href: url, download: nome });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}

/* campos do formulario: [chave, rotulo, tipo] - o que vai para opcoes.carimbo */
const CARIMBO = [
  ['arquivo', 'Arquivo', 'text'], ['revisao', 'Revisão', 'text'],
  ['equipamento', 'Equipamento', 'area'], ['desenho', 'Desenho', 'area'],
  ['desenhista', 'Desenhista', 'text', 'dataDesenho'], ['verificador', 'Verificador', 'text', 'dataVerificacao'],
  ['aprovador', 'Aprovador', 'text', 'dataAprovacao'],
];
const POR_PROJETO = ['arquivo', 'revisao', 'equipamento', 'desenho', 'obsVistas', 'obsReal'];
const POR_PESSOA = ['desenhista', 'verificador', 'aprovador'];

function abrir(cfg) {
  cfg = cfg || {};
  if (typeof HubPcbPdf === 'undefined') { avisa('O gerador de PDF (hub-pcbpdf.js) não carregou nesta página. Atualize o hub (F5).', 'err', 0); return Promise.resolve(); }
  poeCss();
  const placa = () => typeof cfg.placa === 'function' ? cfg.placa() : cfg.placa;
  const proj = cfg.projeto || '';
  const eb0 = placa();
  const padroes = HubPcbPdf.camposCarimbo(eb0, { carimbo: cfg.carimbo || {} });
  const lembrado = le('pcbpdf.opcoes') || {}, doProj = (proj && le('pcbpdf.proj.' + proj)) || {};

  return new Promise(resolve => {
    const ctl = {};
    const campo = (k, tipo, valor) => {
      const c = tipo === 'area' ? el('textarea', { rows: '2' }) : el('input', { type: 'text' });
      c.value = valor == null ? '' : valor;
      c.addEventListener('input', agenda);
      ctl[k] = c;
      return c;
    };
    const sel = (k, opcoes, valor) => {
      const s = el('select');
      for (const o of opcoes) s.append(el('option', { value: o[0], text: o[1] }));
      s.value = valor; if (s.selectedIndex < 0) s.selectedIndex = 0;
      s.addEventListener('change', agenda);
      ctl[k] = s;
      return s;
    };
    const chk = (k, rot, v) => {
      const c = el('input', { type: 'checkbox' }); c.checked = !!v; c.addEventListener('change', agenda); ctl[k] = c;
      return el('label', {}, [c, document.createTextNode(rot)]);
    };
    const lin = (rot, ...nos) => el('div', { class: 'pp-lin' }, [el('span', { text: rot })].concat(nos));
    const L = lembrado;

    /* ---- formulario ---- */
    const escalas = [['auto', 'Automática (a maior que cabe)']].concat(HubPcbPdf.ESCALAS.map(s => [HubPcbPdf.rotuloEscala(s), HubPcbPdf.rotuloEscala(s)]));
    const fCarimbo = el('fieldset', {}, [el('legend', { text: 'Carimbo' })]);
    for (const c of CARIMBO) {
      const v = c[0] in doProj ? doProj[c[0]] : (POR_PESSOA.indexOf(c[0]) >= 0 && L[c[0]] != null ? L[c[0]] : padroes[c[0]]);
      const nos = [campo(c[0], c[2], v)];
      if (c[3]) { const d = campo(c[3], 'text', padroes[c[3]]); d.classList.add('pp-data'); d.placeholder = 'dd/mm/aa'; nos.push(d); }
      fCarimbo.append(lin(c[1], ...nos));
    }
    const form = el('div', { class: 'pp-form' }, [
      el('fieldset', {}, [el('legend', { text: 'Folhas' }),
        el('div', { class: 'pp-chk' }, [chk('cima', 'Vista de cima', L.cima !== false), chk('baixo', 'Vista de baixo', L.baixo !== false), chk('realista', 'Realistic View', !!L.realista)]),
        lin('Vistas', sel('juntas', [['auto', 'Numa folha se couber'], ['sim', 'Sempre numa folha'], ['nao', 'Uma folha por vista']], L.juntas || 'auto')),
        lin('Formato', sel('formato', [['A4', 'A4 paisagem'], ['A3', 'A3 paisagem']], L.formato || 'A4')),
        lin('Escala', sel('escala', escalas, L.escala || 'auto')),
      ]),
      el('fieldset', {}, [el('legend', { text: 'Vista de montagem' }),
        lin('Corpo', sel('corpo', [['auto', 'Camada mecânica ou caixa'], ['mecanica', 'Só camada mecânica'], ['caixa', 'Caixa do componente'], ['nao', 'Não mostrar']], L.corpo || 'auto')),
        lin('Designators', sel('designators', [['serigrafia', 'Os da serigrafia'], ['centro', 'No centro do componente'], ['nao', 'Não mostrar']], L.designators || 'serigrafia')),
        el('div', { class: 'pp-chk' }, [chk('pads', 'Pads', !!L.pads), chk('furos', 'Furos ≥ 1,5 mm', L.furos !== false), chk('titulos', 'TOP/BOTTOM VIEW', L.titulos !== false)]),
      ]),
      el('fieldset', {}, [el('legend', { text: 'OBS (quadro só com texto)' }),
        campo('obsVistas', 'area', doProj.obsVistas || ''), el('div', { style: 'height:4px' }), campo('obsReal', 'area', doProj.obsReal || '')]),
      fCarimbo,
    ]);
    ctl.obsVistas.placeholder = 'OBS das vistas de montagem';
    ctl.obsReal.placeholder = 'OBS da folha Realistic View';

    /* ---- previa e rodape ---- */
    const frame = el('iframe', { title: 'Prévia do PDF' });
    const vazio = el('div', { class: 'pp-vazio', text: 'Gerando a prévia…' });
    frame.hidden = true;
    const avisos = el('ul', { class: 'pp-avisos' });
    const prev = el('div', { class: 'pp-prev' }, [vazio, frame, avisos]);
    const st = el('span', { class: 'pp-st' });
    const bFechar = el('button', { type: 'button', text: 'Fechar' });
    const bBaixar = el('button', { type: 'button', text: 'Baixar PDF' });
    const bSalvar = el('button', { type: 'button', class: 'ok', text: 'Salvar no projeto' });
    if (!cfg.podeSalvar) { bSalvar.disabled = true; bSalvar.title = 'Só com o hubserver e um projeto aberto (?p=)'; }
    else bSalvar.title = 'Grava em Projects/' + proj + '/PDF/';
    const meta = el('span', { class: 'pp-meta' });
    const box = el('div', { class: 'pp-box', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'PDF de layout' }, [
      el('div', { class: 'pp-cab' }, [el('h3', { text: 'PDF de layout' }), meta]),
      el('div', { class: 'pp-corpo' }, [form, prev]),
      el('div', { class: 'pp-pe' }, [st, bFechar, bBaixar, bSalvar]),
    ]);
    const scrim = el('div', { class: 'pp-scrim' }, [box]);
    document.body.append(scrim);

    /* ---- opcoes do formulario -> HubPcbPdf ---- */
    function opcoes() {
      const v = k => ctl[k].value, c = {};
      for (const x of CARIMBO) { c[x[0]] = v(x[0]); if (x[3]) c[x[3]] = v(x[3]); }
      return {
        formato: v('formato'), escala: v('escala'), juntas: v('juntas') === 'sim' ? true : v('juntas') === 'nao' ? false : 'auto',
        folhas: { cima: ctl.cima.checked, baixo: ctl.baixo.checked, realista: ctl.realista.checked },
        corpo: v('corpo'), designators: v('designators'), pads: ctl.pads.checked, furos: ctl.furos.checked, titulos: ctl.titulos.checked,
        obs: { cima: v('obsVistas'), baixo: v('obsVistas'), realista: v('obsReal') }, carimbo: c,
      };
    }
    function lembra(o) {
      const p = { formato: o.formato, escala: o.escala, juntas: ctl.juntas.value, cima: o.folhas.cima, baixo: o.folhas.baixo, realista: o.folhas.realista,
                  corpo: o.corpo, designators: o.designators, pads: o.pads, furos: o.furos, titulos: o.titulos };
      for (const k of POR_PESSOA) p[k] = o.carimbo[k];
      grava('pcbpdf.opcoes', p);
      if (proj) { const q = {}; for (const k of POR_PROJETO) q[k] = ctl[k].value; grava('pcbpdf.proj.' + proj, q); }
    }

    let ultimo = null, url = null, timer = 0, geracao = 0, fechado = false;
    async function gera() {
      const minha = ++geracao;
      const o = opcoes();
      st.textContent = 'gerando…';
      try {
        const eb = placa();
        const m = HubPcbPdf.monta(eb, o);
        const bytes = await m.doc.bytesAsync();
        if (minha !== geracao || fechado) return null;
        ultimo = { bytes, nome: m.nome, m };
        if (url) URL.revokeObjectURL(url);
        url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        frame.src = url + '#view=Fit';
        frame.hidden = false; vazio.hidden = true;
        avisos.textContent = '';
        const lista = m.avisos.concat(cfg.sujo ? ['inclui mudanças ainda não salvas no changes.js.'] : []);
        for (const a of lista) avisos.append(el('li', { text: a }));
        meta.textContent = m.nome + ' · ' + m.folhas.length + ' folha(s) · escala ' + m.rotulo + ' · ' + Math.max(1, Math.round(bytes.length / 1024)) + ' KB';
        st.textContent = '';
        lembra(o);
        return ultimo;
      } catch (e) {
        if (minha === geracao) { st.textContent = 'erro: ' + (e && e.message || e); frame.hidden = true; vazio.hidden = false; vazio.textContent = st.textContent; }
        return null;
      }
    }
    function agenda() { clearTimeout(timer); timer = setTimeout(gera, 350); }
    async function pronto() { clearTimeout(timer); return (await gera()) || ultimo; }

    async function salvar() {
      const r = await pronto();
      if (!r) return;
      const nome = r.nome.replace(/\.pdf$/i, '');
      const corpo = { proj, nome, base64: base64(r.bytes) };
      bSalvar.disabled = true;
      try {
        let j;
        if (typeof cfg.salvar === 'function') j = await cfg.salvar(Object.assign({ bytes: r.bytes }, corpo));
        else {
          let resp;
          try { resp = await fetch('/api/pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }); }
          catch (e) { resp = null; }
          /* rota ausente: sem resposta, 405/501, ou 404 que nao e o JSON da rota (ela devolve
             {ok:false, error} quando o projeto nao serve) */
          let jErro = null;
          if (resp && resp.status === 404) { try { jErro = await resp.clone().json(); } catch (_) { jErro = null; } }
          if (!resp || resp.status === 405 || resp.status === 501 || (resp.status === 404 && !(jErro && jErro.ok === false))) {
            baixa(r.bytes, r.nome);
            avisa('Este servidor ainda não grava PDF no projeto (/api/pdf): o arquivo foi baixado — ' + r.nome, 'warn', 7000);
            return;
          }
          try { j = await resp.json(); } catch (_) { j = null; }
          if (!resp.ok || !j || j.ok === false) throw new Error((j && j.error) || ('HTTP ' + resp.status));
        }
        avisa('PDF salvo em ' + ((j && (j.caminho || j.arquivo)) || ('Projects/' + proj + '/PDF/' + r.nome)) +
              (cfg.sujo ? '. Atenção: inclui mudanças ainda não salvas no changes.js.' : ''), cfg.sujo ? 'warn' : 'ok', 6000);
      } catch (e) {
        avisa('Não deu para salvar o PDF: ' + (e && e.message || e), 'err', 0);
      } finally { bSalvar.disabled = !cfg.podeSalvar; }
    }
    async function baixar() {
      const r = await pronto();
      if (!r) return;
      baixa(r.bytes, r.nome);
      avisa('baixado ' + r.nome + ' (' + Math.max(1, Math.round(r.bytes.length / 1024)) + ' KB)', 'ok');
    }
    function fecha() {
      if (fechado) return;
      fechado = true; clearTimeout(timer);
      document.removeEventListener('keydown', tecla, true);
      scrim.remove();
      if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
      resolve();
    }
    /* Esc fecha (na captura, antes da vista PCB); as outras teclas param no proprio dialogo,
       para os atalhos da vista nao dispararem enquanto se digita nos campos */
    function tecla(ev) { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); fecha(); } }
    scrim.addEventListener('keydown', ev => ev.stopPropagation());
    scrim.addEventListener('keyup', ev => ev.stopPropagation());
    bFechar.addEventListener('click', fecha);
    bBaixar.addEventListener('click', baixar);
    bSalvar.addEventListener('click', salvar);
    scrim.addEventListener('mousedown', ev => { if (ev.target === scrim) fecha(); });
    document.addEventListener('keydown', tecla, true);
    gera();
    try { ctl.equipamento.focus(); } catch (_) { /* foco opcional */ }
  });
}

return { abrir };
})();
if (typeof module === 'object' && module.exports) module.exports = HubPcbPdfUi;
