/* NexoEletric - hub-revisoes.js — a sub-aba "Revisões" do Histórico do projeto.

   Pedido do dono (2026-11-05): "a revisão é definida no momento em que aprova [...] o projeto salva como REV.A no
   histórico do projeto; vai ter uma aba Revisões onde você consegue ver o que foi alterado, e até mesmo selecionar
   aquela revisão, que volta todo o projeto pro estado que estava naquela revisão; algo foi modificado, tem que aprovar
   a 2x, salva uma nova revisão REV.B e vai pro histórico também".

   O servidor é o tools/rotas/carimbos.py (GET /api/revisoes, POST /api/revisoes/voltar): cada Aprovar guarda uma cópia
   do projeto em Projects/<p>/Revisoes/REV.<x>/ e o resumo do que mudou desde a anterior. Aqui só a tela, dentro do
   painel do Histórico (hub.html » render 'hist' chama HubRevisoes.pinta): duas sub-abas, "Revisões" e "Linha do tempo"
   (a lista de sempre, #histRows). */
(function (root) {
'use strict';
const LS_ABA = 'nexoeletric.hist.aba';
const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
const CSS = `
.rv-abas{position:sticky; top:0; z-index:2; display:flex; gap:4px; padding:8px 12px; background:var(--bg, #111);
  border-bottom:1px solid var(--line, #333);}
.rv-abas button{padding:4px 12px; border-radius:var(--r-sm, 6px); border:1px solid var(--line, #444); background:transparent;
  color:var(--text-2, #bbb); cursor:pointer; font:12px var(--font, sans-serif);}
.rv-abas button[aria-pressed="true"]{background:var(--hi, #3b82f6); border-color:var(--hi, #3b82f6); color:var(--on-hi, #fff);}
.rv-corpo{padding:12px; display:flex; flex-direction:column; gap:10px; max-width:980px;}
.rv-card{border:1px solid var(--line, #333); border-radius:var(--r-md, 8px); padding:10px 12px; background:var(--surface, #1c1c1c);}
.rv-card.agora{border-style:dashed;}
.rv-card.agora.nao{border-color:var(--err, #f87171);}
.rv-card.agora.ok{border-color:var(--ok, #4ade80);}
.rv-cab{display:flex; align-items:baseline; gap:10px; flex-wrap:wrap;}
.rv-rev{font:700 16px var(--mono, ui-monospace, monospace); color:var(--text, #ddd);}
.rv-quem{font-size:12px; color:var(--text-3, #999); flex:1;}
.rv-card ul{margin:6px 0 0; padding-left:18px; font-size:12px; color:var(--text-2, #bbb); line-height:1.55;}
.rv-vazio{font-size:12px; color:var(--text-3, #999);}
.rv-card button{padding:4px 10px; border-radius:var(--r-sm, 6px); border:1px solid var(--line, #444); background:transparent;
  color:var(--text, #ddd); cursor:pointer; font:12px var(--font, sans-serif);}
.rv-card button:hover{border-color:var(--hi, #3b82f6);}
.rv-card button.rv-apagar:hover{color:var(--err, #f87171); border-color:var(--err, #f87171);}
.rv-atual{font-size:11px; color:var(--ok, #4ade80); border:1px solid var(--ok, #4ade80); border-radius:9px; padding:0 7px;}
`;
function css(){
  if (document.getElementById('rv-css')) return;
  const s = el('style'); s.id = 'rv-css'; s.textContent = CSS; document.head.append(s);
}
function aba(){ try { return localStorage.getItem(LS_ABA) || 'revisoes'; } catch (_) { return 'revisoes'; } }
function gravaAba(v){ try { localStorage.setItem(LS_ABA, v); } catch (_) { /* sem storage */ } }
function toast(txt, tipo, ms){
  if (root.HubDialog && root.HubDialog.toast) return root.HubDialog.toast(txt, tipo || 'info', ms);
  if (typeof root.toast === 'function') return root.toast(txt, tipo === 'err' ? 'err' : tipo === 'warn' ? 'warn' : 'ok');
}

let seq = 0;
function pinta(pane, projeto){
  if (!pane) return;
  css();
  const scroll = pane.querySelector('.scroll') || pane;
  const linha = scroll.querySelector('#histRows');
  let abas = scroll.querySelector('.rv-abas'), corpo = scroll.querySelector('.rv-corpo');
  if (!abas){
    abas = el('div', 'rv-abas');
    for (const [id, rot] of [['revisoes', 'Revisões'], ['linha', 'Linha do tempo']]){
      const b = el('button', null, rot); b.type = 'button'; b.dataset.aba = id;
      b.addEventListener('click', () => { gravaAba(id); pinta(pane, abas.dataset.projeto); });
      abas.append(b);
    }
    corpo = el('div', 'rv-corpo');
    scroll.prepend(abas);
    abas.after(corpo);
  }
  abas.dataset.projeto = projeto;
  const a = aba();
  for (const b of abas.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.aba === a));
  if (linha) linha.hidden = a !== 'linha';
  corpo.hidden = a !== 'revisoes';
  if (a === 'revisoes') carrega(corpo, projeto, pane);
}

async function carrega(corpo, projeto, pane){
  const n = ++seq;
  if (!projeto){ corpo.replaceChildren(el('div', 'rv-vazio', 'nenhum projeto aberto')); return; }
  let j = null;
  try { j = await (await fetch('/api/revisoes?projeto=' + encodeURIComponent(projeto), { cache:'no-store' })).json(); }
  catch (e) { j = { ok:false, error:String(e && e.message || e) }; }
  if (n !== seq) return;
  if (!j || !j.ok){ corpo.replaceChildren(el('div', 'rv-vazio', 'as revisões não abriram: ' + ((j && j.error) || 'sem resposta'))); return; }
  const out = [];
  const at = j.atual || {};
  const agora = el('div', 'rv-card agora ' + (at.aprovado ? 'ok' : 'nao'));
  const cab = el('div', 'rv-cab');
  cab.append(el('span', 'rv-rev', 'Agora'), el('span', 'rv-quem', at.aprovado
    ? 'aprovado — é a ' + (at.rev || 'revisão atual') + ', sem mudança desde a aprovação'
    : at.desde ? 'sem aprovação — mudou desde a ' + at.desde + '. O Aprovar (ao lado do Salvar, no Esquema) grava a revisão seguinte.'
               : 'sem aprovação — nenhuma revisão ainda. A primeira aprovação grava a ' + (at.rev || 'REV.A') + '.'));
  agora.append(cab);
  if (!at.aprovado && (at.mudancas || []).length){
    const ul = el('ul'); for (const m of at.mudancas) ul.append(el('li', null, m)); agora.append(ul);
  }
  out.push(agora);
  for (const r of j.revisoes || []){
    const c = el('div', 'rv-card');
    const h = el('div', 'rv-cab');
    h.append(el('span', 'rv-rev', r.rev), el('span', 'rv-quem', (r.data || '') + ' · aprovada por ' + (r.aprovador || '—')
      + ((r.quando || '').length > 10 ? ' às ' + r.quando.slice(11, 16) : '')));
    if (at.aprovado && at.rev === r.rev) h.append(el('span', 'rv-atual', 'é o projeto de agora'));
    const b = el('button', null, 'Voltar para esta revisão'); b.type = 'button';
    b.title = 'o projeto inteiro volta a ser o desta revisão (esquema, PCB e o resto da pasta)';
    b.addEventListener('click', () => volta(projeto, r.rev, () => pinta(pane, projeto)));
    h.append(b);
    const ap = el('button', 'rv-apagar', 'Apagar'); ap.type = 'button';
    ap.title = 'tirar esta revisão do histórico (pede a senha mestre)';
    ap.addEventListener('click', () => apaga(projeto, r.rev, at.aprovado && at.rev === r.rev, () => pinta(pane, projeto)));
    h.append(ap);
    c.append(h, el('div', 'rv-vazio', r.rev === (j.revisoes[j.revisoes.length - 1] || {}).rev ? 'o que tinha nela:' : 'o que mudou desde a anterior:'));
    const ul = el('ul'); for (const m of r.resumo || []) ul.append(el('li', null, m)); c.append(ul);
    out.push(c);
  }
  corpo.replaceChildren(...out);
}

async function volta(projeto, rev, depois){
  const CB = root.HubCarimbos;
  const ok = CB && CB.confirma
    ? await CB.confirma('Voltar para a ' + rev, 'O projeto ' + projeto + ' inteiro volta a ser o da ' + rev + ' (esquema, PCB e o resto da pasta), '
        + 'e fica aprovado de novo. O que mudou depois dela sai do projeto (o NexoBD guarda o histórico dos arquivos). '
        + 'Edição não salva na vista Esquema se perde.', 'Voltar')
    : true;
  if (!ok) return;
  let j = null;
  try {
    j = await (await fetch('/api/revisoes/voltar', { method:'POST', headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ projeto, rev }) })).json();
  } catch (e) { j = { ok:false, error:String(e && e.message || e) }; }
  if (!j || !j.ok){ toast('não voltou: ' + ((j && j.error) || 'sem resposta'), 'err', 7000); return; }
  toast(projeto + ' voltou para a ' + j.rev, 'ok', 5000);
  if (depois) depois();
}

/* 2026-11-06: "no histórico de revisões também, quero poder apagar uma revisão" — pede a senha mestre; a revisão em
   que o projeto está aprovado, ao sair, leva a aprovação junto (o servidor limpa os campos do carimbo da folha) */
async function apaga(projeto, rev, ehAtual, depois){
  const CB = root.HubCarimbos;
  if (!CB || !CB.pedeSenha){ toast('os carimbos não carregaram nesta página', 'err'); return; }
  let j = null;
  const s = await CB.pedeSenha('Apagar a ' + rev, 'A ' + rev + ' sai do histórico do projeto ' + projeto + ' (a cópia dela também). '
      + (ehAtual ? 'O projeto está aprovado nela: ele fica SEM aprovação e precisa ser aprovado de novo. ' : '')
      + 'Os arquivos do projeto de agora não mudam.', {
    ok:'Apagar', rotulo:'senha mestre', sub:'senha mestre do sistema',
    confere: async mestre => {
      try {
        j = await (await fetch('/api/revisoes/apagar', { method:'POST', headers:{ 'Content-Type':'application/json' },
          body:JSON.stringify({ projeto, rev, mestre }) })).json();
      } catch (e) { j = { ok:false, error:String(e && e.message || e) }; }
      return j && j.ok ? '' : ((j && j.error) || 'sem resposta');
    } });
  if (s == null || !j || !j.ok) return;
  toast(j.rev + ' apagada' + (j.aprovacaoTirada ? ' — o projeto ficou sem aprovação' : ''), 'ok', 5000);
  if (depois) depois();
}

root.HubRevisoes = { pinta };
})(typeof window !== 'undefined' ? window : globalThis);
