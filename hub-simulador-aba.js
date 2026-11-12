/* NexoEletric - hub-simulador-aba.js — a aba SIMULADOR do hub (1.101.0; modos 2D/3D/Bancada na 1.102.0).
   Pedido do dono (2026-11-12): "era pra ser uma aba igual Esquema, PCB, Simulador... uma área só pra simulação", "as
   ferramentas da visão de PCB e esquema são completamente diferentes das de construir; é uma área completamente nova",
   "a PCB na visão 2D também mostra o funcionamento elétrico" e a "Bancada".
   Modos: Esquema (schframe.html?modo=sim: a folha escura so com simbolos, pinos e fios, simulando), PCB 2D e PCB 3D
   (pcbframe.html?modo=sim2d|sim3d: o cobre pela tensao e a corrente andando; o mouse no pad/perna mostra a tensao e o
   datasheet) e Bancada (o 3D com a placa e os itens da biblioteca ligados por fios). "Dividir" mostra o Esquema ao lado.
   As vistas conversam pelo topo da janela (window.__nexoSim / __nexoBancada).

   API (a casca, hub.html » renderPanes): HubSimAba.pane(nomeDoProjeto) -> o elemento da aba. */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.HubSimAba) return;
  const PREF = 'nexoSim.abaModo', PREF_DIV = 'nexoSim.abaDividir';
  const CSS = `
.simaba{height:100%; min-height:0; display:flex; flex-direction:column; background:#000}
.simaba-bar{display:flex; align-items:center; gap:10px; padding:7px 12px; border-bottom:1px solid #1f2937; background:#07090d; color:#e5e7eb}
.simaba-bar .ttl{font-weight:700; display:flex; align-items:center; gap:7px}
.simaba-bar .ttl svg{width:18px; height:18px; fill:none; stroke:#f59e0b; stroke-width:2; stroke-linecap:round; stroke-linejoin:round}
.simaba-bar .meta{color:#9ca3af; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.simaba-bar .esp{flex:1}
.simaba-seg{display:flex; border:1px solid #1f2937; border-radius:8px; overflow:hidden; flex:none}
.simaba-seg button{height:28px; padding:0 12px; border:0; background:transparent; color:#e5e7eb; cursor:pointer; font:inherit; font-size:12.5px}
.simaba-seg button + button{border-left:1px solid #1f2937}
.simaba-seg button.on{background:#f59e0b; color:#111; font-weight:600}
.simaba-chk{display:flex; gap:6px; align-items:center; color:#cbd5e1; font-size:12.5px; cursor:pointer; user-select:none; flex:none}
.simaba-vp{position:relative; flex:1; display:flex; min-height:0}
.simaba-vp iframe{flex:1; border:0; min-width:0; height:100%; background:#000}
.simaba-vp iframe[hidden]{display:none}
.simaba-vp .div{width:4px; flex:none; background:#1f2937}
.simaba-vp .div[hidden]{display:none}`;
  function css() { if (document.getElementById('simaba-css')) return; const s = document.createElement('style'); s.id = 'simaba-css'; s.textContent = CSS; document.head.append(s); }
  const $c = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const le = (k, p) => { try { return localStorage.getItem(k) || p; } catch (_e) { return p; } };
  const grava = (k, v) => { try { localStorage.setItem(k, v); } catch (_e) { /* sem storage */ } };
  const MODOS = [['esquema', 'Esquema'], ['sim2d', 'PCB 2D'], ['sim3d', 'PCB 3D'], ['bancada', 'Bancada']];
  const DICA = {
    esquema: 'o circuito simulando — clique num pino, fio ou componente › Analisar (lista ou osciloscópio); clique no botão, roda no potenciômetro',
    sim2d: 'a placa em 2D com o funcionamento elétrico — cobre pela tensão, a corrente andando; clique na trilha ou no pino: o balão (as contas abrem no botão)',
    sim3d: 'a placa em 3D com a corrente nas trilhas — clique na trilha ou na perna do CI: o balão (lista, osciloscópio, contas)',
    bancada: 'a bancada: a placa e os itens da biblioteca ligados por fios, funcionando como de verdade; clique num item ou fio para mover, girar ou apagar',
  };

  function pane(projeto) {
    css();
    const raiz = $c('div', 'simaba');
    const bar = $c('div', 'simaba-bar');
    const ttl = $c('span', 'ttl');
    ttl.innerHTML = '<svg viewBox="0 0 24 24"><path d="M2 12h3l2-6 4 12 3-9 2 3h6"/></svg>';
    ttl.append(document.createTextNode('Simulador'));
    const meta = $c('span', 'meta', '');
    const seg = $c('div', 'simaba-seg');
    const bts = {};
    for (const [k, rot] of MODOS) { const b = $c('button', null, rot); b.title = DICA[k]; b.onclick = () => poe(k); bts[k] = b; seg.append(b); }
    const div = $c('label', 'simaba-chk'); const chk = $c('input'); chk.type = 'checkbox'; div.append(chk, document.createTextNode('Esquema ao lado'));
    div.title = 'Mostrar o esquema simulando ao lado da placa ou da bancada';
    const abrir = $c('button', 'btn btn-ghost btn-sm', 'Abrir em nova aba');
    bar.append(ttl, meta, $c('span', 'esp'), seg, div, abrir);
    const vp = $c('div', 'simaba-vp');
    const q = encodeURIComponent(projeto);
    /* o esquema sempre existe: e ele que simula (a placa e a bancada recebem dele) */
    const fSch = document.createElement('iframe');
    fSch.src = 'schframe.html?p=' + q + '&modo=sim';
    fSch.dataset.kind = 'sim';
    const linha = $c('div', 'div');
    let fPcb = null, modoPcb = null;
    const pcb = m => {
      if (!fPcb) { fPcb = document.createElement('iframe'); fPcb.src = 'pcbframe.html?p=' + q + '&modo=' + m; fPcb.dataset.kind = 'sim-pcb'; vp.append(fPcb); modoPcb = m; }
      else if (modoPcb !== m) {
        modoPcb = m;
        try { if (fPcb.contentWindow && fPcb.contentWindow.HubSimPcbModo) fPcb.contentWindow.HubSimPcbModo(m); else fPcb.src = 'pcbframe.html?p=' + q + '&modo=' + m; }
        catch (_e) { fPcb.src = 'pcbframe.html?p=' + q + '&modo=' + m; }
      }
      return fPcb;
    };
    vp.append(fSch, linha);
    let atual = 'esquema';
    function poe(m) {
      atual = m; grava(PREF, m);
      const placa = m !== 'esquema';
      if (placa) pcb(m).hidden = false; else if (fPcb) fPcb.hidden = true;
      fSch.hidden = placa && !chk.checked;
      linha.hidden = !(placa && chk.checked);
      div.style.visibility = placa ? 'visible' : 'hidden';
      for (const [k, b] of Object.entries(bts)) b.classList.toggle('on', k === m);
      meta.textContent = DICA[m] + ' — ' + projeto;
      for (const f of [fSch, fPcb]) if (f && !f.hidden) setTimeout(() => { try { f.contentWindow.dispatchEvent(new Event('resize')); } catch (_e) { /* ok */ } }, 80);
    }
    chk.checked = le(PREF_DIV, '0') === '1';
    chk.onchange = () => { grava(PREF_DIV, chk.checked ? '1' : '0'); poe(atual); };
    abrir.onclick = () => { const f = fSch.hidden && fPcb ? fPcb : fSch; window.open(f.src); };
    raiz.append(bar, vp);
    const salvo = le(PREF, 'esquema');
    poe(MODOS.some(([k]) => k === salvo) ? salvo : 'esquema');
    return raiz;
  }
  window.HubSimAba = { pane };
})();
