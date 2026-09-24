/* AltiumPCBMirror v2 - hub-dialog.js — modal e notificacao das vistas (browser).
   O alert()/confirm() do navegador chega em ingles, com a cara do sistema, trava a aba e nao
   diz de que arquivo se trata. Aqui e um modal no tema da pagina, que devolve Promise, e uma
   notificacao no canto superior direito que sobrepoe tudo — inclusive o modal de adicionar
   componentes. Sem dependencias: injeta o CSS e o DOM no documento onde for carregado, entao
   serve ao schframe, ao pcbframe e a quem mais precisar.

     await HubDialog.alert('texto', { title })                      -> undefined
     await HubDialog.confirm('texto', { title, ok, cancel, danger }) -> true | false
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
.hd-btns{display:flex; gap:8px; justify-content:flex-end; margin-top:16px;}
.hd-btns button{background:transparent; color:var(--text,#d8d8d8); border:1px solid var(--line,#3a3a3a);
  border-radius:var(--r-sm,4px); padding:6px 14px; font:inherit; font-size:12px; cursor:pointer; min-width:84px;}
.hd-btns button:hover{background:rgba(var(--tint,255,255,255),.07);}
.hd-btns button.ok{color:var(--hi,#4fc3f7); border-color:var(--hi,#4fc3f7);}
.hd-btns button.ok:hover{background:rgba(var(--tint,79,195,247),.10);}
.hd-btns button.ok.danger{color:var(--err,#ff5252); border-color:var(--err,#ff5252);}
.hd-btns button.ok.danger:hover{background:var(--err-soft,rgba(255,82,82,.15));}
.hd-btns button:focus-visible{outline:2px solid var(--hi,#4fc3f7); outline-offset:1px;}
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
    box.append(el('p', null, String(msg == null ? '' : msg)));
    const btns = el('div', 'hd-btns');
    const ok = el('button', 'ok' + (o.danger ? ' danger' : ''), o.ok || 'OK'); ok.type = 'button';
    let cancel = null;
    if (temCancelar){ cancel = el('button', null, o.cancel || 'Cancelar'); cancel.type = 'button'; btns.append(cancel); }
    btns.append(ok); box.append(btns); scrim.append(box);

    const fecha = v => {
      scrim.hidden = true; scrim.textContent = '';
      document.removeEventListener('keydown', tecla, true);
      scrim.onclick = null;
      if (antes && typeof antes.focus === 'function') try { antes.focus(); } catch (e) {}
      resolve(v);
    };
    /* na captura do document: os atalhos da vista (window) nao podem disparar com o modal aberto */
    const tecla = e => {
      e.stopPropagation();
      if (e.key === 'Escape'){ e.preventDefault(); fecha(!temCancelar); }
      else if (e.key === 'Enter' && e.target !== cancel){ e.preventDefault(); fecha(true); }
      else if (e.key === 'Tab' && temCancelar){
        e.preventDefault(); (document.activeElement === ok ? cancel : ok).focus();
      }
    };
    ok.addEventListener('click', () => fecha(true));
    if (cancel) cancel.addEventListener('click', () => fecha(false));
    scrim.onclick = e => { if (e.target === scrim) fecha(!temCancelar); };
    document.addEventListener('keydown', tecla, true);
    scrim.hidden = false;
    ok.focus();
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

return { alert, confirm, toast, ocioso };
})();
if (typeof module === 'object' && module.exports) module.exports = HubDialog;
