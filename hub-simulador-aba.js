/* NexoEletric - hub-simulador-aba.js — a aba SIMULADOR do hub (1.101.0).
   Pedido do dono (2026-11-12): "era pra ser uma aba igual Esquema, PCB, Simulador... uma área só pra simulação".
   A aba ao lado de Esquema e PCB: o esquema do projeto já simulando (schframe.html?modo=sim — a mesma edição do
   Esquema, com o painel da simulação fixo à direita), a placa em 3D com a corrente nas trilhas
   (pcbframe.html?modo=sim3d) ou os dois lado a lado. As duas vistas conversam pelo topo da janela
   (window.__nexoSim, hub-simulador.js → hub-simulador-pcb.js).

   API (a casca, hub.html » renderPanes): HubSimAba.pane(nomeDoProjeto) -> o elemento da aba. */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.HubSimAba) return;
  const PREF = 'nexoSim.abaModo';
  const CSS = `
.simaba{height:100%; min-height:0; display:flex; flex-direction:column; background:var(--bg)}
.simaba-bar{display:flex; align-items:center; gap:10px; padding:7px 12px; border-bottom:1px solid var(--line, #2a2f3a); background:var(--surface, transparent)}
.simaba-bar .ttl{font-weight:700; display:flex; align-items:center; gap:7px}
.simaba-bar .ttl svg{width:18px; height:18px; fill:none; stroke:var(--hi, #f59e0b); stroke-width:2; stroke-linecap:round; stroke-linejoin:round}
.simaba-bar .meta{color:var(--text-2, #9ca3af); font-size:12px}
.simaba-bar .esp{flex:1}
.simaba-seg{display:flex; border:1px solid var(--line, #2a2f3a); border-radius:8px; overflow:hidden}
.simaba-seg button{height:28px; padding:0 12px; border:0; background:transparent; color:var(--text, #e5e7eb); cursor:pointer; font:inherit; font-size:12.5px}
.simaba-seg button + button{border-left:1px solid var(--line, #2a2f3a)}
.simaba-seg button.on{background:var(--hi, #f59e0b); color:var(--on-hi, #111); font-weight:600}
.simaba-vp{position:relative; flex:1; display:flex; min-height:0}
.simaba-vp iframe{flex:1; border:0; min-width:0; height:100%; background:transparent}
.simaba-vp iframe[hidden]{display:none}
.simaba-vp .div{width:5px; flex:none; background:var(--line, #2a2f3a)}
.simaba-vp .div[hidden]{display:none}`;
  function css() { if (document.getElementById('simaba-css')) return; const s = document.createElement('style'); s.id = 'simaba-css'; s.textContent = CSS; document.head.append(s); }
  const $c = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  function modoSalvo() { try { return localStorage.getItem(PREF) || 'esquema'; } catch (_e) { return 'esquema'; } }

  function pane(projeto) {
    css();
    const raiz = $c('div', 'simaba');
    const bar = $c('div', 'simaba-bar');
    const ttl = $c('span', 'ttl');
    ttl.innerHTML = '<svg viewBox="0 0 24 24"><path d="M2 12h3l2-6 4 12 3-9 2 3h6"/></svg>';
    ttl.append(document.createTextNode('Simulador'));
    const meta = $c('span', 'meta', 'tensão, corrente e cálculos no circuito de ' + projeto + ' — mouse no pino, clique na chave, roda no potenciômetro');
    const seg = $c('div', 'simaba-seg');
    const bE = $c('button', null, 'Esquema'), b3 = $c('button', null, 'Placa 3D'), bL = $c('button', null, 'Lado a lado');
    bE.title = 'O esquema simulando: cores de tensão, pontos da corrente, LEDs acesos, painel com fontes, cálculos e osciloscópio';
    b3.title = 'A placa em 3D com a corrente nas trilhas: setas no sentido da corrente e I, R, ΔV e ΔT em cima de cada trilha';
    bL.title = 'O esquema e a placa 3D juntos';
    seg.append(bE, b3, bL);
    const abrir = $c('button', 'btn btn-ghost btn-sm', 'Abrir em nova aba');
    bar.append(ttl, meta, $c('span', 'esp'), seg, abrir);
    const vp = $c('div', 'simaba-vp');
    const q = encodeURIComponent(projeto);
    const fSch = document.createElement('iframe');
    fSch.src = 'schframe.html?p=' + q + '&modo=sim';
    fSch.dataset.kind = 'sim';
    const div = $c('div', 'div');
    let fPcb = null;
    const pcb = () => {
      if (!fPcb) { fPcb = document.createElement('iframe'); fPcb.src = 'pcbframe.html?p=' + q + '&modo=sim3d'; fPcb.dataset.kind = 'sim3d'; vp.append(fPcb); }
      return fPcb;
    };
    vp.append(fSch, div);
    function poe(m) {
      try { localStorage.setItem(PREF, m); } catch (_e) { /* sem storage */ }
      fSch.hidden = m === '3d';
      div.hidden = m !== 'lado';
      if (m !== 'esquema') pcb().hidden = false; else if (fPcb) fPcb.hidden = true;
      bE.classList.toggle('on', m === 'esquema'); b3.classList.toggle('on', m === '3d'); bL.classList.toggle('on', m === 'lado');
      /* o canvas de quem mudou de tamanho se ajusta */
      for (const f of [fSch, fPcb]) if (f && !f.hidden) setTimeout(() => { try { f.contentWindow.dispatchEvent(new Event('resize')); } catch (_e) { /* ok */ } }, 60);
    }
    bE.onclick = () => poe('esquema'); b3.onclick = () => poe('3d'); bL.onclick = () => poe('lado');
    abrir.onclick = () => { const f = fSch.hidden && fPcb ? fPcb : fSch; window.open(f.src); };
    raiz.append(bar, vp);
    poe(modoSalvo());
    return raiz;
  }
  window.HubSimAba = { pane };
})();
