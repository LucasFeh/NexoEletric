/* NexoEletric - hub-projnovo.js: o "Novo projeto" do hub, com o código de produto da DIEletrons.

   Pedido do dono (2026-11-04): "toda vez que for criar um projeto novo, gere o código, adiciona no template, e
   pergunta o nome de quem iniciou o projeto pra por no template". O código segue o catálogo CATALOGAÇÃO TODOS OS
   PRODUTOS (\\192.168.15.31\Controle de Projetos): P + as iniciais do nome da placa + -DI + ano + o número do
   produto (PDIDP-DI261945). Criar REGISTRA a placa no catálogo (uma linha nova) e cria Projects/<código>/ com uma
   folha no template do esquema escolhido (o da casa por padrão), o carimbo já preenchido. Abre também pelo clique
   direito em "Projetos" no painel (hub-shell.js » menuDaRaiz).

   O servidor faz o trabalho (tools/rotas/projeto_novo.py, que roda o mcp/lib/catalogo.js):
     GET  /api/projeto/novo/previa?nome=&sigla=  o próximo número e o código que vai sair (nada é gravado)
     POST /api/projeto/novo                      registra e cria
   Aqui só mora o diálogo, no tema do hub (o #overlay da casca). Fecha só pelo Cancelar ou Esc.
   HubProjNovo.abre({aoCriar(j)}) — j = {id, name, codigo, item, linha, params}. */
(function (root) {
'use strict';
const LS_QUEM = 'nexoeletric.projnovo.iniciador';
const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
const CSS = `
.pn-dlg{width:min(560px,100%); display:flex; flex-direction:column; gap:10px;}
.pn-dlg h3{margin:0;}
.pn-grade{display:grid; grid-template-columns:132px minmax(0,1fr); gap:8px 10px; align-items:center;}
.pn-grade label{font-size:12px; color:var(--text-2);}
.pn-grade label b{color:var(--err); font-weight:500;}
.pn-sig{display:flex; gap:8px; align-items:center;}
.pn-sig input{width:110px; text-transform:uppercase;}
.pn-cod{font:600 15px var(--mono, ui-monospace, monospace); letter-spacing:.02em; color:var(--text);}
.pn-info{font-size:12px; color:var(--text-3); min-height:1.2em;}
.pn-erro{font-size:12px; color:var(--err); min-height:1.2em; white-space:pre-line;}
.pn-acoes{display:flex; gap:8px; justify-content:flex-end;}
`;
function css() {
  if (document.getElementById('pnCss')) return;
  const s = el('style'); s.id = 'pnCss'; s.textContent = CSS; document.head.append(s);
}
const lePref = () => { try { return localStorage.getItem(LS_QUEM) || ''; } catch (_) { return ''; } };
const gravaPref = v => { try { localStorage.setItem(LS_QUEM, v); } catch (_) { /* sem storage */ } };
const nomeRuim = v => (/[\\/:*?"<>|]/.test(v) || /^\.|\.$/.test(v)) ? 'sem \\ / : * ? " < > |, sem ponto no começo ou no fim' : '';

function abre(o) {
  o = o || {};
  css();
  const ov = document.getElementById('overlay') || document.body;
  const bd = el('div', 'backdrop center');
  const d = el('div', 'dialog pn-dlg');
  d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true');
  d.append(el('h3', null, 'Novo projeto'));

  const g = el('div', 'pn-grade');
  const campo = (rot, obrig, input) => {
    const l = el('label'); l.textContent = rot; if (obrig) l.append(' ', el('b', null, '*'));
    const id = 'pn' + Math.random().toString(36).slice(2, 8); input.id = id; l.htmlFor = id;
    g.append(l, input); return input;
  };
  const inp = (ph) => { const i = el('input', 'input'); i.type = 'text'; i.autocomplete = 'off'; i.spellcheck = false; if (ph) i.placeholder = ph; return i; };
  const iNome = campo('Nome da placa', true, inp('ex.: Placa adaptadora encoder linear'));
  const sig = el('div', 'pn-sig');
  const iSig = inp('sigla'); const cod = el('span', 'pn-cod', '—');
  sig.append(iSig, cod);
  const lSig = el('label', null, 'Código'); g.append(lSig, sig);
  /* o template do esquema (os da casa, /api/projeto/novo/templates); "sem template" = folha A4 em branco */
  const iTpl = campo('Template do esquema', false, el('select', 'input'));
  const semTpl = el('option', null, '— sem template (A4 em branco) —'); semTpl.value = '';
  iTpl.append(semTpl);
  fetch('/api/projeto/novo/templates', { cache: 'no-store' }).then(r => r.json()).then(j => {
    if (!j || !j.ok) return;
    for (const t of j.templates || []) {
      const op = el('option', null, t.nome + (t.w ? ' · ' + Math.round(t.w) + '×' + Math.round(t.h) + ' mil' : ''));
      op.value = t.id; iTpl.insertBefore(op, semTpl);
    }
    iTpl.value = j.padrao || '';
  }).catch(() => { /* sem servidor: fica a folha em branco */ });
  const iCli = campo('Cliente', false, inp('ex.: USIMINAS'));
  const iVin = campo('Descrição', false, inp('para que serve (vai na coluna VÍNCULO do catálogo)'));
  /* O DESENHISTA É O SEU CARIMBO (2026-11-05: "se você iniciar um projeto, seu nome fica como desenhista"): o carimbo
     em uso neste computador (hub-carimbos.js), e não um nome digitado. Sem carimbo em uso, o Escolher abre os carimbos. */
  const CB = root.HubCarimbos;
  const quem = el('div', 'pn-sig');
  const quemNome = el('span', 'pn-cod', '…');
  const quemTroca = el('button', 'btn btn-ghost', 'Escolher…'); quemTroca.type = 'button';
  quem.append(quemNome, quemTroca);
  const lQuem = el('label'); lQuem.textContent = 'Desenhista'; lQuem.append(' ', el('b', null, '*'));
  g.append(lQuem, quem);
  const iQuem = { value: '' };
  const pintaQuem = () => {
    const a = CB ? CB.estado().ativo : null;
    iQuem.value = a ? a.nome : (CB ? '' : lePref());
    quemNome.textContent = a ? a.nome : (CB ? 'nenhum carimbo em uso' : (iQuem.value || '—'));
    quemNome.style.color = a ? '' : 'var(--err)';
    quemTroca.textContent = a ? 'Trocar…' : 'Escolher…';
    if (typeof confere === 'function') erro.textContent = mexeu ? confere() : (confere(), '');
  };
  quemTroca.onclick = () => { if (CB) CB.abreGerenciador({}); };
  const desliga = CB ? CB.ouve(pintaQuem) : null;
  if (CB) CB.carrega();
  const iProj = campo('Nome do projeto', false, inp('o código'));
  d.append(g);
  const info = el('div', 'pn-info'), erro = el('div', 'pn-erro');
  d.append(info, erro);
  const acts = el('div', 'pn-acoes');
  const bCancel = el('button', 'btn btn-ghost', 'Cancelar'); bCancel.type = 'button';
  const bOk = el('button', 'btn btn-primary', 'Criar e registrar'); bOk.type = 'button';
  acts.append(bCancel, bOk); d.append(acts);
  bd.append(d); ov.append(bd);

  let siglaMexida = false, mexeu = false, prev = null, seq = 0, timer = null, enviando = false;
  const fecha = () => { bd.remove(); document.removeEventListener('keydown', tecla, true); if (desliga) desliga(); };
  const tecla = e => {
    if (e.key === 'Escape' && !enviando) { e.preventDefault(); e.stopPropagation(); fecha(); }
    else if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT' && !enviando) { e.preventDefault(); cria(); }
  };
  document.addEventListener('keydown', tecla, true);
  bCancel.onclick = () => { if (!enviando) fecha(); };

  const confere = () => {
    const n = iNome.value.trim(), q = iQuem.value.trim(), p = iProj.value.trim(), s = iSig.value.trim().toUpperCase();
    let m = '';
    if (!n) m = 'falta o nome da placa';
    else if (!q) m = 'escolha o seu carimbo: ele entra como desenhista';
    else if (s && !/^[A-Z][A-Z0-9]{0,11}$/.test(s)) m = 'a sigla tem só letras e números, começando por letra';
    else if (p && nomeRuim(p)) m = 'nome do projeto: ' + nomeRuim(p);
    else if (p && o.existe && o.existe(p)) m = 'já existe um projeto com esse nome';
    else if (!prev) m = '';
    bOk.disabled = Boolean(m) || !prev || enviando;
    return m;
  };
  const pintaCod = () => {
    if (!prev) { cod.textContent = '—'; return; }
    const s = (iSig.value.trim() || prev.sigla).toUpperCase();
    const c = s + '-DI' + prev.ano + String(prev.proximo).padStart(4, '0');
    cod.textContent = c;
    iProj.placeholder = c;
  };
  const previa = async () => {
    const n = ++seq;
    const q = new URLSearchParams({ nome: iNome.value.trim(), sigla: siglaMexida ? iSig.value.trim() : '' });
    let j = null;
    try { j = await (await fetch('/api/projeto/novo/previa?' + q, { cache: 'no-store' })).json(); } catch (e) { j = { ok: false, error: String(e.message || e) }; }
    if (n !== seq) return;
    if (!j || !j.ok) {
      prev = null; info.textContent = '';
      erro.textContent = 'o catálogo de produtos não abriu: ' + ((j && j.error) || 'sem resposta do servidor');
      pintaCod(); confere(); return;
    }
    prev = j;
    if (!siglaMexida) iSig.value = j.sigla;
    info.textContent = 'vai ser o item ' + j.proximo + ' do catálogo' + (j.ultimo ? ' · o último é ' + j.ultimo.modelo : '');
    const m2 = confere(); if (mexeu) erro.textContent = m2;
    pintaCod();
  };
  const agenda = () => { clearTimeout(timer); timer = setTimeout(previa, 350); };
  iNome.addEventListener('input', () => { mexeu = true; agenda(); erro.textContent = confere(); });
  iSig.addEventListener('input', () => { siglaMexida = iSig.value.trim() !== ''; pintaCod(); erro.textContent = confere(); });
  for (const i of [iProj, iCli, iVin]) i.addEventListener('input', () => { mexeu = true; erro.textContent = confere(); });

  async function cria() {
    const m = confere();
    if (m || !prev) { erro.textContent = m || 'esperando o catálogo'; return; }
    enviando = true; bOk.disabled = true; bCancel.disabled = true; bOk.textContent = 'Registrando…';
    const corpo = { nome: iNome.value.trim(), sigla: (iSig.value.trim() || prev.sigla).toUpperCase(), cliente: iCli.value.trim(),
                    vinculo: iVin.value.trim(), iniciador: iQuem.value.trim(), projeto: iProj.value.trim(), template: iTpl.value };
    let j = null;
    try {
      const r = await fetch('/api/projeto/novo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
      j = await r.json();
    } catch (e) { j = { ok: false, error: String(e.message || e) }; }
    enviando = false; bCancel.disabled = false; bOk.textContent = 'Criar e registrar';
    if (!j || !j.ok) { erro.textContent = 'não deu: ' + ((j && j.error) || 'sem resposta'); bOk.disabled = false; return; }
    gravaPref(corpo.iniciador);
    fecha();
    if (o.aoCriar) await o.aoCriar(j);
  }
  bOk.onclick = cria;
  pintaQuem();
  confere();
  previa();
  iNome.focus();
}

root.HubProjNovo = { abre };
})(typeof self !== 'undefined' ? self : this);
