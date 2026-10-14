/* AltiumPCBMirror - hub-pcbeco-ui.js — os dois dialogos da placa nova (browser).

   1. "Engineering Change Order" — o dialogo do Design » Update PCB Document do Altium, no tema do
      hub: as acoes agrupadas (Add Nets, Add Components, Add Pins To Nets...), um checkbox por
      linha e um por grupo, as colunas Check e Done, e os botoes Validate Changes, Execute Changes,
      Report Changes e Only Show Errors. A logica e do hub-pcbeco.js; aqui so a tela.
   2. "Placa nova" — o PCB Board Wizard no padrao da casa (hub-pcbnova.js): forma, tamanho,
      camadas, origem, furos de fixacao, contorno na Mech1 e o texto de codigo, com a previa.

   Recebe TUDO por parametro (nada de global da vista); quem grava e o callback de quem chama.
   Nunca alert/confirm/prompt: o que precisar de pergunta ou aviso vai pelo HubDialog.

     await HubPcbEcoUI.eco({ board, changes, schematic, schlib, pcblib,
                             gravar: async (linhas, eco) => true|false|string })   -> {executou, linhas}
     await HubPcbEcoUI.novaPlaca({ projeto, existentes:[nomes],
                                   gravar: async ({proj, conteudo, board}) => true|false|string }) -> board|null
   O `gravar` devolve true (gravou), false (desistiu) ou o texto do erro (o dialogo mostra).   */
"use strict";
var HubPcbEcoUI = (function () {

const CSS = `
.eco-scrim{position:fixed; inset:0; z-index:8000; display:flex; align-items:center; justify-content:center;
  background:var(--scrim,rgba(11,11,13,.6)); font:13px/1.45 var(--font,"Segoe UI",system-ui,sans-serif); color:var(--text,#d8d8d8);}
.eco-box{width:min(980px,96vw); max-height:92vh; display:flex; flex-direction:column; background:var(--surface,#2d2d2d);
  border-radius:var(--r-md,8px); box-shadow:var(--shadow-menu,0 0 0 1px #3a3a3a,0 18px 44px rgba(0,0,0,.6)); padding:14px 16px 12px;}
.eco-box.nova{width:min(760px,96vw);}
.eco-box h3{margin:0 0 4px; font-size:14px; font-weight:600;}
.eco-sub{color:var(--text-3,#9a9a9a); font-size:12px; margin-bottom:8px;}
.eco-tab{flex:1; overflow:auto; border:1px solid var(--line,#3a3a3a); border-radius:var(--r-sm,4px);}
.eco-tab table{border-collapse:collapse; width:100%; font-size:12px;}
.eco-tab th{position:sticky; top:0; background:var(--surface-2,#333); text-align:left; font-weight:600; padding:5px 8px;
  border-bottom:1px solid var(--line,#3a3a3a); z-index:1;}
.eco-tab td{padding:3px 8px; border-bottom:1px solid rgba(var(--tint,255,255,255),.05); vertical-align:top;}
.eco-tab tr.grp td{background:rgba(var(--tint,255,255,255),.04); font-weight:600; padding-top:6px;}
.eco-tab tr.off td{color:var(--text-3,#9a9a9a);}
.eco-tab td.st{width:22px; text-align:center;}
.eco-ok{color:var(--ok,#00e676);} .eco-warn{color:var(--warn,#ffd54f);} .eco-err{color:var(--err,#ff5252);}
.eco-tab td.msg{color:var(--text-3,#9a9a9a); max-width:360px;}
.eco-tab input{margin:0; vertical-align:middle;}
.eco-rod{display:flex; gap:8px; align-items:center; margin-top:10px; flex-wrap:wrap;}
.eco-rod .esp{flex:1;}
.eco-rod label{font-size:12px; color:var(--text-2,#bdbdbd); display:flex; gap:5px; align-items:center;}
.eco-box button{background:transparent; color:var(--text,#d8d8d8); border:1px solid var(--line,#3a3a3a);
  border-radius:var(--r-sm,4px); padding:6px 12px; font:inherit; font-size:12px; cursor:pointer;}
.eco-box button:hover{background:rgba(var(--tint,255,255,255),.07);}
.eco-box button.pri{color:var(--hi,#4fc3f7); border-color:var(--hi,#4fc3f7);}
.eco-box button:disabled{opacity:.45; cursor:default;}
.eco-box button:focus-visible{outline:2px solid var(--hi,#4fc3f7); outline-offset:1px;}
.eco-resumo{font-size:12px; color:var(--text-2,#bdbdbd);}
.eco-rel{white-space:pre; font:12px/1.4 var(--mono,Consolas,monospace); overflow:auto; flex:1; margin:0;
  border:1px solid var(--line,#3a3a3a); border-radius:var(--r-sm,4px); padding:8px; max-height:60vh;}
.eco-nova{display:grid; grid-template-columns:minmax(0,1fr) 300px; gap:14px;}
.eco-campos{display:grid; grid-template-columns:auto minmax(0,1fr); gap:6px 10px; align-items:center; font-size:12px;}
.eco-campos label{color:var(--text-2,#bdbdbd);}
.eco-campos input[type=text],.eco-campos input[type=number],.eco-campos select{background:var(--surface-2,#333);
  color:var(--text,#d8d8d8); border:1px solid var(--line,#3a3a3a); border-radius:var(--r-sm,4px); padding:4px 6px; font:inherit; min-width:0;}
.eco-campos .lin{display:flex; gap:6px; align-items:center;}
.eco-campos .lin input[type=number]{width:80px;}
.eco-prev{border:1px solid var(--line,#3a3a3a); border-radius:var(--r-sm,4px); background:var(--canvas,#1b1b1b);
  display:flex; align-items:center; justify-content:center; min-height:220px;}
.eco-erros{color:var(--err,#ff5252); font-size:12px; min-height:16px; margin-top:8px; white-space:pre-wrap;}
.eco-nota{color:var(--text-3,#9a9a9a); font-size:11px; grid-column:1 / -1;}
@media (max-width:640px){ .eco-nova{grid-template-columns:1fr;} }
`;
let cssPosto = false;
function poeCss(){
  if (cssPosto) return;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); cssPosto = true;
}
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const avisa = (t, tipo) => (window.HubDialog ? HubDialog.toast(t, tipo || 'info') : null);

function modal(cls){
  poeCss();
  const scrim = el('div', 'eco-scrim'), box = el('div', 'eco-box ' + (cls || ''));
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
  scrim.appendChild(box); document.body.appendChild(scrim);
  return { scrim, box, fecha: () => scrim.remove() };
}
function baixa(nome, texto){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([texto], { type:'text/plain;charset=utf-8' }));
  a.download = nome; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ===================== 1. Engineering Change Order ===================== */
function eco(par){
  const P = par || {};
  const E = window.HubPcbEco;
  if (!E) return Promise.reject(new Error('hub-pcbeco.js não carregado'));
  const opts = { schlib:P.schlib, pcblib:P.pcblib, changes:P.changes || [] };
  const ec = E.compara(P.schematic, P.board, opts);
  return new Promise(resolve => {
    const M = modal('');
    let soErros = false, executou = false, linhasFeitas = [];
    const feitos = new Set();
    M.box.innerHTML = `<h3>Engineering Change Order</h3>
      <div class="eco-sub">Design » Update PCB Document — do esquema para a placa. As linhas marcadas e sem erro viram mudanças no changes.js.</div>
      <div class="eco-tab"><table><thead><tr><th style="width:26px"></th><th>Ação</th><th>Objeto afetado</th><th></th><th>Para</th>
      <th title="Validação (Check)">Check</th><th title="Executada (Done)">Feito</th><th>Mensagem</th></tr></thead><tbody></tbody></table></div>
      <div class="eco-rod"><button data-a="valida">Validar mudanças</button><button data-a="executa" class="pri">Executar mudanças</button>
      <button data-a="rel">Relatório…</button><label><input type="checkbox" data-a="erros"> Só erros</label>
      <span class="esp"></span><span class="eco-resumo"></span><button data-a="fecha">Fechar</button></div>`;
    const tbody = M.box.querySelector('tbody'), resumo = M.box.querySelector('.eco-resumo');
    const icone = a => a.status === 'err' ? '<span class="eco-err" title="erro">✖</span>'
                    : a.status === 'warn' ? '<span class="eco-warn" title="aviso">⚠</span>' : '<span class="eco-ok" title="ok">✔</span>';
    function desenha(){
      tbody.innerHTML = '';
      for (const g of E.GRUPOS) {
        const as = ec.acoes.filter(a => a.grupo === g.chave && (!soErros || a.status === 'err'));
        if (!as.length) continue;
        const todos = as.every(a => a.ativo), algum = as.some(a => a.ativo);
        const tr = el('tr', 'grp', `<td><input type="checkbox" ${todos ? 'checked' : ''} aria-label="marcar o grupo"></td>
          <td colspan="7">${esc(g.titulo)} <span class="eco-sub" style="font-weight:400">(${esc(g.altium)}) — ${as.length}</span></td>`);
        const cb = tr.querySelector('input'); cb.indeterminate = algum && !todos;
        cb.onchange = () => { for (const a of as) if (!a.semPad && !a.info && !feitos.has(a.id)) a.ativo = cb.checked; E.valida(ec); desenha(); };
        tbody.appendChild(tr);
        for (const a of as) {
          const r = el('tr', a.ativo ? '' : 'off');
          const trava = a.semPad || a.info || feitos.has(a.id);
          r.innerHTML = `<td><input type="checkbox" ${a.ativo ? 'checked' : ''} ${trava ? 'disabled' : ''}></td><td>${esc(g.acao || g.altium)}</td>
            <td>${esc(a.objeto)}</td><td>${a.para ? '→' : ''}</td><td>${esc(a.para || '')}</td>
            <td class="st">${icone(a)}</td><td class="st">${feitos.has(a.id) ? '<span class="eco-ok">✔</span>' : ''}</td>
            <td class="msg">${esc([a.msg, a.msgValida].filter(Boolean).join(' — '))}</td>`;
          r.querySelector('input').onchange = ev => { a.ativo = ev.target.checked; E.valida(ec); desenha(); };
          tbody.appendChild(r);
        }
      }
      if (!tbody.children.length) tbody.innerHTML = `<tr><td colspan="8" class="eco-sub" style="padding:14px">${soErros ? 'Nenhum erro.' : 'Nada a mudar: a placa já está como o esquema.'}</td></tr>`;
      const r = ec.resumo || {};
      resumo.textContent = `${r.ativas || 0} marcadas · ${r.erros || 0} erro(s) · ${r.avisos || 0} aviso(s)`;
      M.box.querySelector('[data-a=executa]').disabled = !ec.acoes.some(a => a.ativo && a.status !== 'err' && !feitos.has(a.id));
    }
    const fim = () => { document.removeEventListener('keydown', tecla, true); M.fecha(); resolve({ executou, linhas:linhasFeitas }); };
    const tecla = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); fim(); } };
    document.addEventListener('keydown', tecla, true);
    M.box.querySelector('.eco-rod').onclick = async ev => {
      const b = ev.target.closest('[data-a]'); if (!b) return;
      const ac = b.getAttribute('data-a');
      if (ac === 'fecha') return fim();
      if (ac === 'erros') { soErros = b.checked; return desenha(); }
      if (ac === 'valida') { E.valida(ec); desenha(); return avisa(`Validação: ${ec.resumo.erros} erro(s), ${ec.resumo.avisos} aviso(s)`, ec.resumo.erros ? 'warn' : 'ok'); }
      if (ac === 'rel') return relatorio(E.relatorio(ec));
      if (ac === 'executa') {
        const pend = ec.acoes.filter(a => a.ativo && !feitos.has(a.id));
        const salvo = new Map(); for (const a of ec.acoes) { salvo.set(a, a.ativo); if (feitos.has(a.id)) a.ativo = false; }
        const r = E.aplica(ec, { pcblib:P.pcblib });
        for (const [a, v] of salvo) a.ativo = v;
        if (!r.linhas.length) return avisa('Nada a executar: as marcadas têm erro de validação.', 'warn');
        b.disabled = true;
        let ok;
        try { ok = P.gravar ? await P.gravar(r.linhas, ec) : true; } catch (e) { ok = String(e && e.message || e); }
        b.disabled = false;
        if (ok === true) {
          for (const a of pend) if (a.status !== 'err') feitos.add(a.id);
          executou = true; linhasFeitas = linhasFeitas.concat(r.linhas);
          avisa(`${r.linhas.length} mudança(s) no changes.js` + (r.puladas.length ? ` — ${r.puladas.length} com erro ficaram de fora` : ''), r.puladas.length ? 'warn' : 'ok');
        } else if (typeof ok === 'string') avisa('Não gravou: ' + ok, 'err');
        desenha();
      }
    };
    desenha();
  });
}

function relatorio(texto){
  const M = modal('');
  M.box.innerHTML = `<h3>Relatório do ECO</h3><pre class="eco-rel"></pre>
    <div class="eco-rod"><span class="esp"></span><button data-a="copia">Copiar</button><button data-a="baixa">Baixar .txt</button><button data-a="fecha" class="pri">Fechar</button></div>`;
  M.box.querySelector('pre').textContent = texto;
  M.box.querySelector('.eco-rod').onclick = async ev => {
    const a = ev.target.getAttribute('data-a');
    if (a === 'fecha') M.fecha();
    else if (a === 'baixa') baixa('eco-relatorio.txt', texto);
    else if (a === 'copia') { try { await navigator.clipboard.writeText(texto); avisa('Relatório copiado', 'ok'); } catch (e) { avisa('A área de transferência recusou', 'warn'); } }
  };
}

/* ===================== 2. Placa nova (o Board Wizard da casa) ===================== */
function svgPrevia(board){
  const bb = board.board.bbox, m = 3;
  const w = bb.x2 - bb.x1 + 2 * m, h = bb.y2 - bb.y1 + 2 * m;
  const X = x => (x - bb.x1 + m).toFixed(3), Y = y => (bb.y2 - y + m).toFixed(3);
  let d = '';
  for (const s of board.board.outline) {
    if (s.kind === 'line') d += `M${X(s.x1)} ${Y(s.y1)}L${X(s.x2)} ${Y(s.y2)}`;
    else {
      const p = g => [s.cx + s.r * Math.cos(g * Math.PI / 180), s.cy + s.r * Math.sin(g * Math.PI / 180)];
      const a = p(s.sa), b = p(s.ea), sw = ((s.ea - s.sa) % 360 + 360) % 360;
      d += `M${X(a[0])} ${Y(a[1])}A${s.r} ${s.r} 0 ${sw > 180 ? 1 : 0} 0 ${X(b[0])} ${Y(b[1])}`;
    }
  }
  const furos = (board.cutouts || []).map(k => `<polygon points="${k.points.map(p => X(p[0]) + ',' + Y(p[1])).join(' ')}" fill="var(--canvas,#1b1b1b)" stroke="var(--text-3,#9a9a9a)" stroke-width="0.2"/>`).join('');
  const txt = (board.texts || []).map(t => `<text x="${X(t.x)}" y="${Y(t.y)}" font-size="${t.h}" fill="#ffff00" text-anchor="middle">${esc(t.text.split(/\r?\n/)[0])}</text>`).join('');
  return `<svg viewBox="0 0 ${w.toFixed(3)} ${h.toFixed(3)}" width="280" height="${Math.min(280, 280 * h / w).toFixed(0)}">
    <path d="${d}" fill="rgba(0,160,80,.18)" stroke="#ff00ff" stroke-width="0.3"/>${furos}${txt}
    <circle cx="${X(0)}" cy="${Y(0)}" r="0.8" fill="none" stroke="var(--hi,#4fc3f7)" stroke-width="0.25"/></svg>
    <div class="eco-sub" style="text-align:center">${(bb.x2 - bb.x1).toFixed(2)} × ${(bb.y2 - bb.y1).toFixed(2)} mm · ○ = origem</div>`;
}
function novaPlaca(par){
  const P = par || {};
  const N = window.HubPcbNova;
  if (!N) return Promise.reject(new Error('hub-pcbnova.js não carregado'));
  return new Promise(resolve => {
    const M = modal('nova');
    const K = N.PADRAO_CASA;
    M.box.innerHTML = `<h3>Placa nova</h3>
      <div class="eco-sub">O PCB Board Wizard no padrão da casa (o projeto-modelo DieletronsAltium). Depois, o ECO traz os componentes do esquema.</div>
      <div class="eco-nova"><div class="eco-campos">
        <label for="en-proj">Projeto</label><input type="text" id="en-proj" value="${esc(P.projeto || '')}" ${P.projeto ? 'readonly' : ''}>
        <label for="en-forma">Forma</label><select id="en-forma"><option value="retangulo">Retângulo</option><option value="arredondado">Cantos arredondados</option></select>
        <label>Tamanho (mm)</label><div class="lin"><input type="number" id="en-w" value="100" min="1" step="0.1"> × <input type="number" id="en-h" value="80" min="1" step="0.1"></div>
        <label for="en-r">Raio do canto</label><div class="lin"><input type="number" id="en-r" value="3" min="0" step="0.1"> mm</div>
        <label for="en-cam">Camadas</label><select id="en-cam"><option value="2">2 (Top, Bottom)</option><option value="4">4 (Top, Mid1, Mid2, Bottom)</option></select>
        <label for="en-orig">Origem</label><select id="en-orig"><option value="canto">Canto inferior esquerdo (casa)</option><option value="centro">Centro da placa</option></select>
        <label>Furos de fixação</label><div class="lin"><input type="checkbox" id="en-furo"> Ø <input type="number" id="en-fd" value="${K.furo}" step="0.1"> margem <input type="number" id="en-fm" value="4" step="0.1"></div>
        <label>Contorno na Mech1</label><div class="lin"><input type="checkbox" id="en-mech" checked> linha de 10 mil (como a casa desenha)</div>
        <label>Texto de código</label><div class="lin"><input type="checkbox" id="en-cod" checked><input type="text" id="en-codt" value="${esc(K.codigo.texto.replace(/\r\n/g, ' / '))}"></div>
        <div class="eco-nota">Regras: clearance ${K.regras.clearance} mm, largura ${K.regras.width} mm, via ${K.regras.viaSize}/${K.regras.viaDrill} mm, máscara ${K.regras.sm} mm; grade de 5 mil.
          4 camadas: ${esc(K.pilha4Nota)}.</div>
      </div><div class="eco-prev"><div></div></div></div>
      <div class="eco-erros" aria-live="polite"></div>
      <div class="eco-rod"><span class="esp"></span><button data-a="cancela">Cancelar</button><button data-a="cria" class="pri">Criar placa</button></div>`;
    const $ = id => M.box.querySelector('#' + id);
    const erroEl = M.box.querySelector('.eco-erros'), prev = M.box.querySelector('.eco-prev > div');
    const lerOpts = () => ({
      projeto:$('en-proj').value.trim(), forma:$('en-forma').value, largura:+$('en-w').value, altura:+$('en-h').value,
      raio:+$('en-r').value, camadas:+$('en-cam').value, origem:$('en-orig').value, mech1:$('en-mech').checked,
      furos:$('en-furo').checked ? { d:+$('en-fd').value, margem:+$('en-fm').value } : null,
      codigo:$('en-cod').checked ? $('en-codt').value.replace(/\s*\/\s*/g, '\r\n') : null });
    let atual = null;
    const atualiza = () => {
      const o = lerOpts();
      $('en-r').disabled = o.forma !== 'arredondado';
      const e = N.erros(o);
      if (!o.projeto) e.unshift('dê um nome ao projeto');
      else if ((P.existentes || []).some(n => n.toLowerCase() === o.projeto.toLowerCase()) && !P.projeto) e.unshift('já existe um projeto com esse nome');
      erroEl.textContent = e.join('\n');
      atual = null;
      if (!N.erros(o).length) { try { atual = N.gera(o); prev.innerHTML = svgPrevia(atual); } catch (x) { erroEl.textContent = String(x.message || x); } }
      M.box.querySelector('[data-a=cria]').disabled = !!e.length || !atual;
    };
    M.box.querySelector('.eco-campos').addEventListener('input', atualiza);
    const fim = v => { document.removeEventListener('keydown', tecla, true); M.fecha(); resolve(v); };
    const tecla = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); fim(null); } };
    document.addEventListener('keydown', tecla, true);
    M.box.querySelector('.eco-rod').onclick = async ev => {
      const a = ev.target.getAttribute('data-a');
      if (a === 'cancela') return fim(null);
      if (a !== 'cria' || !atual) return;
      const proj = lerOpts().projeto;
      ev.target.disabled = true;
      let ok;
      try { ok = P.gravar ? await P.gravar({ proj, conteudo:N.serializa(atual), board:atual, regrasJs:N.regrasJs() }) : true; }
      catch (x) { ok = String(x && x.message || x); }
      ev.target.disabled = false;
      if (ok === true) { avisa(`Placa nova de ${proj} criada`, 'ok'); fim(atual); }
      else if (typeof ok === 'string') erroEl.textContent = 'Não gravou: ' + ok;
    };
    atualiza();
    $('en-proj').focus();
  });
}

return { eco, novaPlaca, relatorio };
})();
