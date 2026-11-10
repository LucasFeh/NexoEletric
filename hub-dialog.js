/* AltiumPCBMirror v2 - hub-dialog.js — modal e notificacao das vistas (browser).
   O alert()/confirm() do navegador chega em ingles, com a cara do sistema, trava a aba e nao
   diz de que arquivo se trata. Aqui e um modal no tema da pagina, que devolve Promise, e uma
   notificacao no canto superior direito que sobrepoe tudo — inclusive o modal de adicionar
   componentes. Sem dependencias: injeta o CSS e o DOM no documento onde for carregado, entao
   serve ao schframe, ao pcbframe e a quem mais precisar.

     await HubDialog.alert('texto', { title })                      -> undefined
     await HubDialog.confirm('texto', { title, ok, cancel, danger }) -> true | false
     await HubDialog.escolhe('texto', { title, opcoes:[{v, rot}], v, rotulo, ok, cancel })
                                                                    -> o v escolhido | null
     await HubDialog.texto('texto', { title, v, rotulo, ok, cancel, valida })
                                                                    -> o texto digitado | null
       valida(texto) -> '' (aceita) | a mensagem que aparece embaixo do campo (e o OK espera)
     await HubDialog.ficha({ title, sub, avisos:[texto|{t, nivel}], secoes:[{ titulo, kv:[[k, v, cls]],
                            tab:{ cab:[...], linhas:[[...]] }, vazio }] })    -> undefined
       1.90.0: um modal LARGO, só leitura (o "Parâmetros" do componente nas vistas Esquema e PCB). O v de
       um par pode ser texto ou um nó (o link do Odoo); cls 'warn'|'dim'|'mono'|'err'.
     HubDialog.toast('texto', 'ok'|'warn'|'err'|'info', ms)          -> { close }
       ms omitido: some sozinho (erro fica mais); ms = 0: fica ate clicar.                  */
"use strict";
var HubDialog = (function () {

/* NO TEMA DO HUB. As cores sao os tokens do hub-tema.css (--surface, --text, --hi, --scrim,
   --shadow-menu...), que as vistas carregam; a cor depois da virgula e a do escuro antigo, e so
   vale numa pagina que nao carregou os tokens. O desenho e o da casca: caixa sem borda, com o
   anel e a sombra do --shadow-menu (borda + anel viravam uma linha dupla), e os botoes da casca
   (.btn-primary/.btn-danger do hub.html) — contornados, nunca preenchidos. O azul cheio de
   antes ficava avulso em qualquer tema que nao fosse o escuro. */
const CSS = `
.hd-scrim{position:fixed; inset:0; z-index:9000; display:flex; align-items:center; justify-content:center;
  background:var(--scrim,rgba(11,11,13,.6)); font:13px/1.45 var(--font,"Segoe UI",system-ui,sans-serif);
  color:var(--text,#d8d8d8);}
.hd-scrim[hidden]{display:none;}
.hd-box{width:min(440px, 92vw); background:var(--surface,#2d2d2d); border-radius:var(--r-md,8px);
  box-shadow:var(--shadow-menu, 0 0 0 1px #3a3a3a, 0 18px 44px rgba(0,0,0,.6)); padding:16px 18px 14px;}
.hd-box h3{margin:0 0 8px; font-size:14px; font-weight:600; color:var(--text,#d8d8d8); letter-spacing:-.01em;}
.hd-box h3.danger{color:var(--err,#ff5252);}
.hd-box p{margin:0; white-space:pre-wrap; word-break:break-word; color:var(--text,#d8d8d8); max-height:52vh; overflow:auto;}
.hd-escolha{display:flex; align-items:center; gap:10px; margin-top:12px;}
.hd-escolha label{color:var(--text-dim,#a8a8a8); font-size:12px;}
.hd-escolha select{flex:1; background:var(--surface-2,#252525); color:var(--text,#d8d8d8); border:1px solid var(--line,#3a3a3a);
  border-radius:var(--r-sm,4px); padding:5px 8px; font:inherit;}
.hd-escolha select:focus-visible{outline:2px solid var(--hi,#4fc3f7); outline-offset:1px;}
.hd-escolha input{flex:1; min-width:0; background:var(--surface-2,#252525); color:var(--text,#d8d8d8); border:1px solid var(--line,#3a3a3a);
  border-radius:var(--r-sm,4px); padding:5px 8px; font:inherit;}
.hd-escolha input:focus-visible{outline:2px solid var(--hi,#4fc3f7); outline-offset:1px;}
.hd-erro{margin:6px 0 0 !important; min-height:1.2em; font-size:12px; color:var(--err,#ff5252) !important;}
.hd-btns{display:flex; gap:8px; justify-content:flex-end; margin-top:16px;}
.hd-btns button{background:transparent; color:var(--text,#d8d8d8); border:1px solid var(--line,#3a3a3a);
  border-radius:var(--r-sm,4px); padding:6px 14px; font:inherit; font-size:12px; cursor:pointer; min-width:84px;}
.hd-btns button:hover{background:rgba(var(--tint,255,255,255),.07);}
.hd-btns button.ok{color:var(--hi,#4fc3f7); border-color:var(--hi,#4fc3f7);}
.hd-btns button.ok:hover{background:rgba(var(--tint,79,195,247),.10);}
.hd-btns button.ok.danger{color:var(--err,#ff5252); border-color:var(--err,#ff5252);}
.hd-btns button.ok.danger:hover{background:var(--err-soft,rgba(255,82,82,.15));}
.hd-btns button:focus-visible{outline:2px solid var(--hi,#4fc3f7); outline-offset:1px;}
/* a ficha (1.90.0): largura de leitura, as seções rolam dentro da caixa; o cabeçalho e o OK ficam */
.hd-box.hd-larga{width:min(640px, 94vw); max-height:86vh; display:flex; flex-direction:column;}
.hd-box .hd-sub{margin:-4px 0 10px; font-size:12px; color:var(--text-dim,#a8a8a8); word-break:break-word;}
.hd-ficha{flex:1 1 auto; min-height:0; overflow:auto; margin:0 -6px; padding:0 6px;}
.hd-avisos{display:flex; flex-direction:column; gap:4px; margin:0 0 10px;}
.hd-aviso{display:flex; gap:7px; align-items:flex-start; font-size:12px; padding:6px 9px; border-radius:var(--r-sm,4px);
  background:var(--warn-soft,rgba(255,213,79,.10)); color:var(--text,#d8d8d8); border-left:3px solid var(--warn,#ffd54f);}
.hd-aviso.err{background:var(--err-soft,rgba(255,82,82,.12)); border-left-color:var(--err,#ff5252);}
.hd-aviso .tri{flex:none; color:var(--warn,#ffd54f); font-size:10px; line-height:1.6;}
.hd-aviso.err .tri{color:var(--err,#ff5252);}
.hd-fsec{padding:8px 0 10px; border-top:1px solid var(--line,#3a3a3a);}
.hd-fsec:first-child{border-top:0; padding-top:2px;}
.hd-fsec h4{margin:0 0 6px; font-size:10px; font-weight:400; text-transform:uppercase; letter-spacing:.09em; color:var(--text-dim,#a8a8a8);}
.hd-kv{display:grid; grid-template-columns:150px minmax(0,1fr); gap:3px 12px; font-size:12px;}
.hd-kv .k{color:var(--text-dim,#a8a8a8); word-break:break-word;}
.hd-kv .v{color:var(--text,#d8d8d8); word-break:break-word; user-select:text;}
.hd-kv .v.mono, .hd-tab td{font-family:var(--mono,Consolas,monospace); font-size:11px;}
.hd-kv .v.warn{color:var(--warn,#ffd54f);} .hd-kv .v.err{color:var(--err,#ff5252);} .hd-kv .v.dim{color:var(--text-dim,#a8a8a8);}
.hd-tab{width:100%; border-collapse:collapse; font-size:11px;}
.hd-tab th{text-align:left; font-weight:400; font-size:10px; text-transform:uppercase; letter-spacing:.06em; color:var(--text-dim,#a8a8a8);
  padding:2px 6px; border-bottom:1px solid var(--line,#3a3a3a);}
.hd-tab td{padding:2px 6px; border-bottom:1px solid var(--line,#3a3a3a); color:var(--text,#d8d8d8); user-select:text;}
.hd-tab td.dim{color:var(--text-dim,#a8a8a8);}
.hd-vazio{font-size:12px; color:var(--text-dim,#a8a8a8);}
.hd-toasts{position:fixed; top:12px; right:12px; z-index:10000; display:flex; flex-direction:column; gap:8px;
  align-items:flex-end; pointer-events:none; font:13px/1.4 var(--font,"Segoe UI",system-ui,sans-serif);}
/* a borda e transparente e o contorno e o anel do --shadow-menu, como na caixa; so a faixa da
   esquerda tem cor, e ela e o status */
.hd-toast{pointer-events:auto; display:flex; align-items:flex-start; gap:9px; max-width:min(420px, 80vw);
  padding:9px 12px 9px 11px; border-radius:var(--r-sm,6px); background:var(--surface,#2d2d2d);
  color:var(--text,#d8d8d8); border:1px solid transparent; border-left-width:3px;
  box-shadow:var(--shadow-menu, 0 0 0 1px #3a3a3a, 0 10px 28px rgba(0,0,0,.5));
  opacity:0; transform:translateY(-6px); transition:opacity .16s, transform .16s; cursor:pointer;}
.hd-toast.on{opacity:1; transform:none;}
.hd-toast.ok{border-left-color:var(--ok,#00e676);}   .hd-toast.warn{border-left-color:var(--warn,#ffd54f);}
.hd-toast.err{border-left-color:var(--err,#ff5252);} .hd-toast.info{border-left-color:var(--hi,#4fc3f7);}
.hd-toast .t{flex:1; white-space:pre-wrap; word-break:break-word;}
.hd-toast .x{color:var(--text-3,#9a9a9a); padding:0 2px; line-height:1;}
.hd-toast:hover .x{color:var(--text,#d8d8d8);}
`;

let pronto = false, scrim = null, pilha = null;
let fila = Promise.resolve();          /* um modal de cada vez; o proximo espera o anterior fechar */
function el(tag, cls, text){ const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function prepara(){
  if (pronto) return;
  pronto = true;
  const st = el('style'); st.textContent = CSS; document.head.appendChild(st);
  scrim = el('div', 'hd-scrim'); scrim.hidden = true;
  pilha = el('div', 'hd-toasts');
  document.body.append(scrim, pilha);
}

/* o modal em si: resolve com true no OK/Enter, false no Cancelar/Esc/clique fora */
function abre(msg, o, temCancelar){
  prepara();
  return new Promise(resolve => {
    const antes = document.activeElement;
    scrim.textContent = '';
    const box = el('div', 'hd-box');
    box.setAttribute('role', temCancelar ? 'alertdialog' : 'dialog'); box.setAttribute('aria-modal', 'true');
    if (o.title){ const h = el('h3', o.danger ? 'danger' : null, o.title); box.append(h); }
    if (o.corpo){ box.classList.add('hd-larga'); if (o.sub) box.append(el('div', 'hd-sub', o.sub)); box.append(o.corpo); }
    else box.append(el('p', null, String(msg == null ? '' : msg)));
    /* escolhe(): um seletor embaixo do texto; o OK devolve o valor escolhido */
    let sel = null;
    if (Array.isArray(o.opcoes)){
      const linha = el('div', 'hd-escolha');
      sel = el('select');
      for (const op of o.opcoes){ const x = el('option', null, op.rot != null ? op.rot : String(op.v)); x.value = String(op.v); sel.append(x); }
      if (o.v != null) sel.value = String(o.v);
      if (o.rotulo){ const lb = el('label', null, o.rotulo); linha.append(lb); }
      linha.append(sel); box.append(linha);
    }
    /* texto(): um campo de digitar; o OK devolve o texto (sem espaco nas pontas) */
    let inp = null, erro = null;
    if (o.texto){
      const linha = el('div', 'hd-escolha');
      inp = el('input'); inp.type = 'text'; inp.autocomplete = 'off'; inp.spellcheck = false;
      inp.value = o.v != null ? String(o.v) : '';
      if (o.rotulo){ const lb = el('label', null, o.rotulo); linha.append(lb); }
      linha.append(inp); box.append(linha);
      erro = el('p', 'hd-erro', ''); box.append(erro);
    }
    const btns = el('div', 'hd-btns');
    const ok = el('button', 'ok' + (o.danger ? ' danger' : ''), o.ok || 'OK'); ok.type = 'button';
    let cancel = null;
    if (temCancelar){ cancel = el('button', null, o.cancel || 'Cancelar'); cancel.type = 'button'; btns.append(cancel); }
    btns.append(ok); box.append(btns); scrim.append(box);

    const fecha = v => {
      if (v && inp && typeof o.valida === 'function'){
        const msg = o.valida(inp.value.trim());
        if (msg){ erro.textContent = msg; inp.focus(); return; }
      }
      scrim.hidden = true; scrim.textContent = '';
      document.removeEventListener('keydown', tecla, true);
      scrim.onclick = null;
      if (antes && typeof antes.focus === 'function') try { antes.focus(); } catch (e) {}
      resolve(inp ? (v ? inp.value.trim() : null) : sel ? (v ? sel.value : null) : v);
    };
    /* na captura do document: os atalhos da vista (window) nao podem disparar com o modal aberto */
    const tecla = e => {
      e.stopPropagation();
      if (e.key === 'Escape'){ e.preventDefault(); fecha(!temCancelar); }
      else if (e.key === 'Enter' && e.target !== cancel){ e.preventDefault(); fecha(true); }
      else if (e.key === 'Tab' && temCancelar){
        e.preventDefault();
        const roda = [inp || sel, cancel, ok].filter(Boolean);
        roda[(roda.indexOf(document.activeElement) + 1) % roda.length].focus();
      }
    };
    ok.addEventListener('click', () => fecha(true));
    if (cancel) cancel.addEventListener('click', () => fecha(false));
    scrim.onclick = e => { if (e.target === scrim) fecha(!temCancelar); };
    document.addEventListener('keydown', tecla, true);
    scrim.hidden = false;
    if (inp){ inp.addEventListener('input', () => { erro.textContent = ''; }); inp.focus(); inp.select(); }
    else (sel || ok).focus();
  });
}
function enfileira(fn){ const p = fila.then(fn, fn); fila = p.then(() => {}, () => {}); return p; }

/* Resolve quando NAO ha modal na tela. Existe porque quem recarrega a pagina (o
   __hubOnChange das vistas) nao pode fazer isso com uma pergunta aberta: o usuario ve o
   dialogo sumir sozinho e fica sem saber se a resposta dele valeu. Fila vazia resolve na
   hora, entao o caso comum nao paga nada. */
function ocioso(){ return fila.then(() => {}, () => {}); }
function alert(msg, o){ return enfileira(() => abre(msg, o || {}, false)).then(() => undefined); }
function confirm(msg, o){ return enfileira(() => abre(msg, o || {}, true)); }
function escolhe(msg, o){ return enfileira(() => abre(msg, Object.assign({ opcoes:[] }, o || {}), true)); }
function texto(msg, o){ return enfileira(() => abre(msg, Object.assign({}, o || {}, { texto:true }), true)); }
/* a ficha só de leitura (1.90.0): avisos em cima, depois as seções (pares rótulo/valor ou tabela) */
function corpoDaFicha(d){
  const c = el('div', 'hd-ficha');
  const av = (d.avisos || []).filter(Boolean);
  if (av.length){
    const box = el('div', 'hd-avisos');
    for (const a of av){
      const t = typeof a === 'string' ? a : a.t, n = typeof a === 'string' ? 'warn' : (a.nivel || 'warn');
      const x = el('div', 'hd-aviso' + (n === 'err' ? ' err' : ''));
      x.append(el('span', 'tri', '▲'), el('span', null, t));
      box.append(x);
    }
    c.append(box);
  }
  for (const s of d.secoes || []){
    if (!s) continue;
    const sec = el('div', 'hd-fsec');
    if (s.titulo) sec.append(el('h4', null, s.titulo));
    const kv = (s.kv || []).filter(Boolean);
    if (kv.length){
      const g = el('div', 'hd-kv');
      for (const [k, v, cls] of kv){
        const vv = el('span', 'v' + (cls ? ' ' + cls : ''));
        if (v && typeof v === 'object' && v.nodeType) vv.append(v);
        else vv.textContent = v == null || v === '' ? '—' : String(v);
        g.append(el('span', 'k', k == null ? '' : String(k)), vv);
      }
      sec.append(g);
    }
    if (s.tab && (s.tab.linhas || []).length){
      const t = el('table', 'hd-tab'), th = el('tr');
      for (const h of s.tab.cab || []) th.append(el('th', null, h));
      const thead = el('thead'); thead.append(th); t.append(thead);
      const tb = el('tbody');
      for (const l of s.tab.linhas){ const tr = el('tr'); l.forEach((v, i) => tr.append(el('td', (s.tab.dim || []).indexOf(i) >= 0 ? 'dim' : null, v == null || v === '' ? '—' : String(v)))); tb.append(tr); }
      t.append(tb); sec.append(t);
    }
    if (!kv.length && !(s.tab && (s.tab.linhas || []).length)) sec.append(el('div', 'hd-vazio', s.vazio || '—'));
    c.append(sec);
  }
  return c;
}
function ficha(d){
  const x = d || {};
  return enfileira(() => { prepara(); return abre('', { title: x.title, sub: x.sub, ok: x.ok || 'Fechar', corpo: corpoDaFicha(x) }, false); }).then(() => undefined);
}

const DURACAO = { ok: 3000, info: 3200, warn: 4500, err: 6500 };
function toast(msg, kind, ms){
  prepara();
  const k = DURACAO[kind] ? kind : 'info';
  const texto = String(msg == null ? '' : msg);
  /* a mesma mensagem repetida nao empilha: so renova o tempo da que ja esta na tela */
  for (const t of pilha.children) if (t.__msg === texto && t.__kind === k){ t.__renova(); return { close: t.__close }; }
  const box = el('div', 'hd-toast ' + k);
  box.__msg = texto; box.__kind = k;
  box.setAttribute('role', k === 'err' || k === 'warn' ? 'alert' : 'status');
  box.append(el('span', 't', texto), el('span', 'x', '✕'));
  let timer = 0;
  const close = () => { clearTimeout(timer); box.classList.remove('on'); setTimeout(() => box.remove(), 180); };
  const renova = () => { clearTimeout(timer); const d = ms === undefined ? DURACAO[k] : ms; if (d > 0) timer = setTimeout(close, d); };
  box.__close = close; box.__renova = renova;
  box.addEventListener('click', close);
  pilha.append(box);
  requestAnimationFrame(() => box.classList.add('on'));
  renova();
  return { close };
}

return { alert, confirm, escolhe, texto, ficha, toast, ocioso };
})();
if (typeof module === 'object' && module.exports) module.exports = HubDialog;
