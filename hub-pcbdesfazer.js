/* NexoEletric - hub-pcbdesfazer.js: o Desfazer/Refazer da vista PCB no fim da fileira "Placa | Gerber".

   Pedido do dono (2026-10-23): "na barra Placa/Gerber, no final, vão ter esses ícones (↶ ↷), e tirar
   eles da barra de ferramenta; deixa o Ctrl+Z Ctrl+Y funcionando".

   Quem faz o quê:
   - a casca (hub.html) chama HubPcbDesfazer.poe(nav, ehPcb) no fim do renderSubtabs: a fileira é
     refeita a cada troca de aba, e os dois botões vão no fim dela quando a aba é a PCB;
   - a vista PCB (pcbframe.js, no iframe) conta o que dá para desfazer por
     HubPcbDesfazer.estado(podeDesfazer, podeRefazer) a cada mudança, e o botão acende/apaga;
   - o clique chama a mesma ação da vista (__hubPcb.fazAcao('desfazer'|'refazer')), a das teclas.
   Ctrl+Z / Ctrl+Y (e Ctrl+Shift+Z) dentro da vista continuam sendo dela; com o foco na casca (depois
   de clicar numa aba, por exemplo) este módulo os manda para a vista. */
var HubPcbDesfazer = (function () {
  'use strict';
  const IC = {
    desfazer: 'M3 7 H10 A3.5 3.5 0 0 1 10 14 H7 M6 4 L3 7 L6 10',
    refazer: 'M13 7 H6 A3.5 3.5 0 0 0 6 14 H9 M10 4 L13 7 L10 10',
  };
  const CSS = `
.pcb-desfazer { margin-left: auto; display: inline-flex; gap: 2px; padding-bottom: 3px; }
.pcb-desfazer button { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 24px; border: 0;
  border-radius: var(--r-sm, 4px); background: transparent; color: var(--text-3, #a8a8ae); cursor: pointer; }
.pcb-desfazer button:hover:not(:disabled) { color: var(--text, #f2f2f3); background: rgba(var(--tint, 242,242,243), .08); }
.pcb-desfazer button:disabled { opacity: .35; cursor: default; }
.pcb-desfazer svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }`;
  let box = null, bDes = null, bRef = null, pode = [false, false], estilo = false;

  function vista() {
    const f = document.querySelector('iframe[data-kind="pcb"], iframe[data-kind="gerber"]');
    try { return f && f.contentWindow && f.contentWindow.__hubPcb ? f.contentWindow.__hubPcb : null; } catch (e) { return null; }
  }
  function faz(acao) { const v = vista(); if (v) v.fazAcao(acao); }
  function pinta() { if (!box) return; bDes.disabled = !pode[0]; bRef.disabled = !pode[1]; }
  function botao(acao, titulo) {
    const b = document.createElement('button');
    b.type = 'button'; b.title = titulo; b.setAttribute('aria-label', titulo);
    b.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="' + IC[acao] + '"/></svg>';
    b.addEventListener('click', () => faz(acao));
    return b;
  }
  function poe(nav, ehPcb) {
    box = null;
    if (!ehPcb || !nav) return;
    if (!estilo) { estilo = true; const s = document.createElement('style'); s.textContent = CSS; document.head.append(s); }
    box = document.createElement('span'); box.className = 'pcb-desfazer';
    bDes = botao('desfazer', 'Desfazer (Ctrl+Z)'); bRef = botao('refazer', 'Refazer (Ctrl+Y)');
    box.append(bDes, bRef); nav.append(box);
    const v = vista();
    if (v && typeof v.historico === 'function') { try { const h = v.historico(); pode = [!!h.desfazer, !!h.refazer]; } catch (e) { /* vista carregando */ } }
    pinta();
  }
  function estado(podeDesfazer, podeRefazer) { pode = [!!podeDesfazer, !!podeRefazer]; pinta(); }
  /* Ctrl+Z / Ctrl+Y com o foco na casca: vão para a vista PCB aberta (campo de texto da casca fica com o dele) */
  document.addEventListener('keydown', e => {
    if (!box || !box.isConnected || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const k = String(e.key || '').toLowerCase();
    const acao = k === 'z' && !e.shiftKey ? 'desfazer' : (k === 'y' || (k === 'z' && e.shiftKey)) ? 'refazer' : null;
    if (!acao || !vista()) return;
    e.preventDefault();
    faz(acao);
  });
  return { poe, estado };
})();
