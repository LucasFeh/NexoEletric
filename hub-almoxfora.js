/* AltiumPCBMirror v2 - hub-almoxfora.js — os componentes "fora" do painel de valores da
 * Biblioteca: selecionar todos os fora da categoria e apagar a seleção (e, pela faixa da
 * Biblioteca, todos os fora da biblioteca).
 *
 * Pedido do dono (2026-09-29): "um botão, na lib, para selecionar todos os componentes que
 * estão fora na parte de categoria", e "que seja possível apagar todos com fora da lib".
 * "Fora" é o componente que saiu do Odoo — ou o nome antigo de um produto renomeado antes de a
 * biblioteca seguir o ID. Ele fica na lista com saldo zero para não renumerar ninguém; apagar
 * o tira da biblioteca, e se o produto voltar ao Odoo ele volta com o MESMO número.
 *
 * A SELEÇÃO SÓ ACEITA FORA. Componente que ainda vem do Odoo voltaria no sincronismo seguinte,
 * e um lote misturando os dois faria o "apagar" mentir — o servidor
 * (/api/symbols/almox-fora) recusa o que não está fora e devolve o porquê.
 *
 * O CONTRATO COM A CASCA (o painel de valores é do hub.html, igual nas duas cascas): três linhas.
 *   <script src="hub-almoxfora.js">;
 *   HubAlmoxFora.barra(barra, s, parts, repinta)  depois de montar o botão "Fora" da barra;
 *   HubAlmoxFora.linha(b, p, s, repinta)          em cada linha, depois do onclick dela.
 * E uma quarta, nas Configurações (aba Projeto, logo abaixo da linha da biblioteca):
 *   HubAlmoxFora.pane(pane, { fechar: closeOverlay })
 * O resto (modal, toast, POST, recarga) vem do adaptador que a casca já tem para o excluir de
 * um valor, o `ioExcluirAlmox()` — o mesmo fluxo, o mesmo texto de pergunta.
 */
"use strict";
var HubAlmoxFora = (function () {

/* SEM CRASE NESTE BLOCO: ele vive num template literal, e uma crase num comentário fecha a
   string — o módulo inteiro morre (e o node --check passa). */
const CSS = `
.alx-bar .af{white-space:nowrap;}
.alx-bar .af-apaga{color:var(--err,#ff6b6b);}
.alx-bar .af-apaga:hover{background:rgba(255,107,107,.10);}
.alx-row.af-sel{background:rgba(255,183,77,.13); box-shadow:inset 3px 0 0 var(--warn,#ffb74d);}
.alx-row.af-sel .ix{color:var(--warn,#ffb74d); font-weight:700;}
.af-cfg .af-cfg-bt{margin-top:7px;}
`;
let cssPosto = false;
function poeCss(){
  if (cssPosto || typeof document === 'undefined') return;
  cssPosto = true;
  const st = document.createElement('style');
  st.id = 'almoxfora-css'; st.textContent = CSS;
  document.head.appendChild(st);
}
function el(tag, cls, txt){
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
}

/* ── a regra, pura (tests/test-almoxfora.js) ── */
/* os nomes (valores[].altium) dos componentes fora de uma lista de valores */
function nomesFora(parts){
  return (parts || []).filter(p => p && p.fora && p.altium).map(p => p.altium);
}
/* a seleção só guarda quem ainda está fora ali: depois de apagar, de uma recarga ou de o
   produto voltar ao Odoo, o nome sai sozinho */
function ajusta(sel, parts){
  const f = new Set(nomesFora(parts));
  for (const n of [...sel]) if (!f.has(n)) sel.delete(n);
  return sel;
}
/* o texto da pergunta, a partir da prévia do servidor */
function textoDaPergunta(previa, onde){
  const n = (previa.alvos || []).length;
  let t = 'Apagar ' + n + (n === 1 ? ' componente fora ' : ' componentes fora ') + onde + '?\n\n'
    + 'Eles saíram do Odoo (ou são o nome antigo de um produto renomeado) e saem da biblioteca '
    + 'agora. Se algum produto voltar ao Odoo, a próxima sincronização o traz de volta com o '
    + 'mesmo número — nada renumera. Entram na lista de excluídos.';
  const ign = previa.ignorados || [];
  if (ign.length)
    t += '\n\n' + ign.length + (ign.length === 1 ? ' da seleção não entra' : ' da seleção não entram') + ':\n'
      + ign.slice(0, 6).map(i => '  · ' + i.altium + ' — ' + i.porque).join('\n')
      + (ign.length > 6 ? '\n  · … e mais ' + (ign.length - 6) : '');
  if (previa.total){
    t += '\n\nEM USO por ' + previa.total + ' componente(s) nos projetos:\n'
      + (previa.usos || []).map(u => '  · ' + u.projeto + ': ' + u.refs.join(', ')).join('\n');
    const orf = (previa.usos || []).filter(u => (u.orfaos || []).length);
    t += previa.orfaos
      ? '\n\n' + previa.orfaos + ' fica(m) órfão(s) — quadrado vermelho na folha até ser(em) trocado(s): '
        + orf.map(u => u.projeto + ': ' + u.orfaos.join(', ')).join('; ') + '.'
        + (previa.orfaos < previa.total ? ' Os outros a folha leva sozinha, pelo id do Odoo, para o nome de hoje.' : '')
      : '\n\nTodos têm o id de um produto que vive noutro componente: a folha os leva sozinha para o nome de hoje.';
  }
  return t;
}
/* a linha da contagem nas Configurações, a partir do GET /api/symbols/almox-fora */
function textoDaContagem(r){
  if (!r || r.erro) return 'não consegui contar os componentes fora' + (r && r.erro ? ': ' + r.erro : '');
  const n = r.total || 0, c = r.categorias || 0;
  if (!n) return 'nenhum componente fora do Odoo na biblioteca';
  return n + (n === 1 ? ' componente saiu' : ' componentes saíram') + ' do Odoo'
    + (c ? ', em ' + c + (c === 1 ? ' categoria' : ' categorias') : '');
}
const SEL = { sim: null, nomes: new Set() };
function selecaoDe(s){
  const nome = s ? s.name : null;
  if (SEL.sim !== nome){ SEL.sim = nome; SEL.nomes = new Set(); }
  return SEL.nomes;
}

function ioDaCasca(){
  return typeof ioExcluirAlmox === 'function' ? ioExcluirAlmox() : null;
}

/* os botões da barra do painel, logo depois do "Fora". Idempotente: a casca repinta o painel a
   cada tecla da busca, e cada pintura tira os botões da anterior. */
function barra(bar, s, parts, repinta){
  poeCss();
  if (!bar) return;
  for (const n of bar.querySelectorAll('.af')) n.remove();
  if (!s) return;
  const sel = ajusta(selecaoDe(s), parts);
  const fora = nomesFora(parts);
  const todos = fora.length > 0 && fora.every(n => sel.has(n));
  const bSel = el('button', 'btn btn-ghost btn-sm af', todos ? 'Desmarcar fora' : 'Selecionar fora');
  bSel.type = 'button';
  bSel.disabled = !fora.length;
  bSel.title = !fora.length ? 'nenhum componente fora nesta categoria'
    : todos ? 'tira os ' + fora.length + ' componentes fora da seleção'
    : 'marca os ' + fora.length + ' componentes fora desta categoria · Ctrl+clique numa linha marca ou desmarca um';
  bSel.onclick = () => { if (todos) sel.clear(); else fora.forEach(n => sel.add(n)); if (repinta) repinta(); };
  const nos = [bSel];
  if (sel.size){
    const bAp = el('button', 'btn btn-ghost btn-sm af af-apaga', 'Apagar ' + sel.size + '…');
    bAp.type = 'button';
    bAp.title = 'apaga da biblioteca os ' + sel.size + ' componentes fora selecionados';
    bAp.onclick = () => apaga({ simbolo: s.name, componentes: [...sel] },
                              'desta categoria (' + s.name + ')', repinta);
    nos.push(bAp);
  }
  const ancora = bar.querySelector('#libValFora');
  if (ancora) ancora.after(...nos); else bar.append(...nos);
}

/* a linha: marcada quando selecionada, e o Ctrl+clique alterna. O clique normal continua sendo
   o da casca (abrir o valor) — a seleção não pode roubar o gesto de todo dia. */
function linha(b, p, s, repinta){
  if (!b || !p) return;
  const sel = selecaoDe(s);
  if (p.fora && sel.has(p.altium)){
    b.classList.add('af-sel');
    b.title = '✓ selecionado para apagar · ' + (b.title || '');
  }
  const antes = b.onclick;
  b.onclick = ev => {
    if (ev && (ev.ctrlKey || ev.metaKey)){
      if (!p.fora){ aviso('só os componentes fora entram na seleção', 'warn'); return; }
      if (sel.has(p.altium)) sel.delete(p.altium); else sel.add(p.altium);
      if (repinta) repinta();
      return;
    }
    if (antes) return antes.call(b, ev);
  };
}

function aviso(txt, tom){
  const io = ioDaCasca();
  if (io && io.toast) io.toast(txt, tom);
  else if (typeof HubDialog !== 'undefined' && HubDialog.toast) HubDialog.toast(txt, tom || 'info', 6000);
}

/* prévia -> pergunta no modal do hub -> apaga -> recarrega. `corpo` é o da rota:
   {simbolo, componentes} (a seleção) ou {todos: true} (a biblioteca inteira). */
async function apaga(corpo, onde, repinta){
  const io = ioDaCasca();
  if (!io){ aviso('esta tela não tem como falar com o servidor', 'err'); return false; }
  let p;
  try { p = await io.post('/api/symbols/almox-fora', corpo); }
  catch (e){ io.toast('não consegui perguntar ao servidor: ' + (e && e.message || e), 'err'); return false; }
  if (!p || !p.ok){ io.toast((p && p.error) || 'o servidor recusou', 'err'); return false; }
  const n = (p.alvos || []).length;
  if (!n){
    io.toast((p.ignorados || []).length
      ? 'nada a apagar: ' + p.ignorados.map(i => i.altium + ' — ' + i.porque).join('; ')
      : 'nenhum componente fora ' + onde, 'warn');
    return false;
  }
  const sim = await io.confirm(textoDaPergunta(p, onde),
                               { title: 'Apagar os fora', ok: 'Apagar ' + n, danger: true });
  if (!sim) return false;
  let r;
  try { r = await io.post('/api/symbols/almox-fora', Object.assign({ confirmar: true }, corpo)); }
  catch (e){ io.toast('não consegui apagar: ' + (e && e.message || e), 'err'); return false; }
  if (!r || !r.ok){ io.toast((r && r.error) || 'o servidor recusou', 'err'); return false; }
  io.toast(r.apagados + (r.apagados === 1 ? ' componente fora saiu' : ' componentes fora saíram') + ' da biblioteca', 'ok');
  for (const a of (r.avisos || [])) io.toast(a, 'warn');
  SEL.nomes.clear();
  if (io.recarregar) await io.recarregar(); else if (repinta) repinta();
  /* a contagem de fora e de repetidos da faixa da Biblioteca (hub-libview.js) */
  if (typeof HubLibView !== 'undefined' && HubLibView.recontar) HubLibView.recontar();
  return true;
}
function apagaTodos(repinta){ return apaga({ todos: true }, 'da biblioteca inteira', repinta); }

/* ── NAS CONFIGURAÇÕES ──
   Pedido do dono (2026-09-30): "não tô vendo o botão de apagar itens fora; ele pode ficar
   escondido no menu de configuração". O "Apagar fora (N)…" da faixa da Biblioteca continua lá;
   este é o mesmo apagar-todos no lugar onde se procura o que não se usa todo dia, e que existe
   em qualquer tela do hub — a faixa só aparece com a Biblioteca aberta.
   `fechar` (o closeOverlay da casca) fecha o modal ANTES de perguntar: a pergunta do hub mora
   no mesmo #overlay e o esvazia inteiro ao responder. É o mesmo gesto do "Excluir projeto". */
async function contaFora(){
  if (typeof fetch !== 'function') return { erro: 'sem servidor' };
  try {
    const r = await fetch('/api/symbols/almox-fora');
    const j = await r.json().catch(() => null);
    if (!j || !j.ok) return { erro: (j && j.error) || ('HTTP ' + r.status) };
    return { total: j.total || 0, categorias: Object.keys(j.porSimbolo || {}).length };
  } catch (e) { return { erro: String((e && e.message) || e) }; }
}
function pane(host, opts){
  poeCss();
  if (!host) return;
  const o = opts || {};
  const box = el('div', 'af-cfg');
  const lin = el('p', 'cfgm-val sub', 'contando os componentes fora…');
  const b = el('button', 'btn btn-danger btn-sm af-cfg-bt', 'Apagar os fora…');
  b.type = 'button';
  b.disabled = true;
  b.onclick = () => { if (o.fechar) o.fechar(); apagaTodos(); };
  box.append(el('div', 'kicker', 'Componentes fora do Odoo'), lin, b,
             el('p', 'cfgm-hint', 'Saem da biblioteca de uma vez, depois de uma pergunta que mostra onde '
               + 'eles são usados. Se um produto voltar ao Odoo, a próxima sincronização o traz de volta '
               + 'com o mesmo número. Para apagar só os de uma categoria: Biblioteca › valores › '
               + '“Selecionar fora”.'));
  host.append(box);
  contaFora().then(r => {
    lin.textContent = textoDaContagem(r);
    /* contagem que falhou não trava o botão: a prévia do apagar pergunta ao servidor de novo
       e diz o que houve — travar esconderia o erro atrás de um botão cinza */
    b.disabled = !r.erro && !r.total;
    if (r.total) b.textContent = 'Apagar os ' + r.total + ' fora…';
  });
}

return { barra, linha, apaga, apagaTodos, pane,
         pure: { nomesFora, ajusta, textoDaPergunta, textoDaContagem } };
})();
if (typeof module === 'object' && module.exports) module.exports = HubAlmoxFora;
