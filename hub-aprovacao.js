/* NexoEletric - hub-aprovacao.js — a APROVAÇÃO do projeto (até a 1.83.0, hub-carimbos.js).

   Quem desenha e quem aprova é o LOGIN do Nexo Hub (1.84.0, pedido do dono em 2026-11-09: "não precisa mais de
   carimbo, pelo login mesmo já pega o nome, se ele é aprovador ou não, quem decide isso é o admin no Nexo Hub"): o
   servidor pergunta ao Hub quem está logado (tools/rotas/equipe.py » sessao). O desenhista é quem criou o projeto ou
   quem o assumiu (Equipe do projeto, hub-equipe.js); aprova só quem o administrador marcou como aprovador
   (Configurações › Usuários, no Nexo Hub). O sistema de carimbos de antes (nome + senha, tag aprovador, senha mestre)
   saiu; os campos do cabeçalho da folha continuam com os nomes de sempre (Aprovacao_carimbo = o login...), por causa
   do template e dos PDFs, e as aprovações antigas continuam valendo.

   O "Aprovar" aparece ao lado do Salvar no Esquema: preenche no template o verificador E o aprovador (quem verifica
   também aprova) com a data de hoje. Na lista de projetos, cada um leva a tag [Aprovado] ou [Sem aprovação]
   (vermelha, piscando). Qualquer modificação elétrica no projeto tira a aprovação (a assinatura do servidor).

   O servidor é o tools/rotas/aprovacao.py (a regra da assinatura está lá). Aqui:
     HubAprovacao.tagProjeto(nome)             a tag do projeto no painel Projetos (hub-shell.js); liga a consulta
     HubAprovacao.montaAprovar(ganchos)        o botão Aprovar ao lado do Salvar (schframe.js)
     HubAprovacao.antesDeSalvar(sch, disco)    (não mexe mais em nada: quem decide é a assinatura do servidor)
     HubAprovacao.assumir(projeto, ganchos?)   quem está logado vira o responsável e o desenhista (sem senha)
     HubAprovacao.estado() / carrega() / ouve(fn)   {usuario, modo}
   Nada de alert/confirm/prompt: modal no tema e toast (HubDialog quando a página tem; senão o toast do hub). */
(function (root) {
'use strict';

const CAMPOS_APROVACAO = ['Verificador_DiEletrons', 'Aprovador_DiEletrons', 'Data_verificacao', 'Data_aprovacao',
                          'Aprovacao_assinatura', 'Aprovacao_carimbo'];
const PERIODO = 5000;
const MSG_APROVADOR = 'Só quem é aprovador no Nexo Hub aprova — o administrador marca em Configurações › Usuários';

const CSS = `
.cb-ov{position:fixed; inset:0; z-index:70; background:var(--scrim, rgba(11,11,13,.6)); display:flex; align-items:center;
  justify-content:center; color:var(--text, #d8d8d8); font:13px/1.45 var(--font, "Segoe UI", system-ui, sans-serif);}
.cb-box{background:var(--surface, #2d2d2d); border:1px solid var(--line, #444); border-radius:8px; width:min(480px, 94vw);
  max-height:88vh; display:flex; flex-direction:column; box-shadow:var(--shadow-menu, 0 8px 30px rgba(0,0,0,.5));}
.cb-box.cb-peq{width:min(380px, 94vw);}
.cb-hd{display:flex; align-items:baseline; gap:8px; padding:10px 12px; border-bottom:1px solid var(--line, #444);}
.cb-hd h2{font-size:13px; font-weight:600; margin:0;}
.cb-dim{font-size:11.5px; color:var(--text-3, #999);}
.cb-corpo{overflow:auto; padding:12px; display:flex; flex-direction:column; gap:10px;}
.cb-pe{display:flex; gap:6px; justify-content:flex-end; align-items:center; padding:8px 12px; border-top:1px solid var(--line, #444);}
.cb-pe .cb-sp{flex:1;}
.cb-erro{font-size:12px; color:var(--err, #f87171); min-height:1em;}
.cb-box input[type=password]{background:var(--sunken, #1e1e1e); color:var(--text, #ddd); border:1px solid var(--line, #444);
  border-radius:4px; padding:4px 6px; font:12px var(--font, sans-serif); min-width:0;}
.cb-box input:focus{outline:none; border-color:var(--hi, #3b82f6);}
.cb-box button{cursor:pointer; padding:4px 11px; border-radius:var(--r-sm, 6px); border:1px solid var(--line, #444);
  background:var(--surface-2, #2a2a2a); color:var(--text, #ddd); font:12px var(--font, sans-serif);}
.cb-box button:hover:not(:disabled){border-color:var(--hi, #3b82f6);}
.cb-box button:disabled{opacity:.45; cursor:default;}
.eh-aprov{font-size:10px; font-weight:600; margin-left:6px; white-space:nowrap; flex:none;}
.eh-aprov.ok{color:var(--ok, #4ade80);}
.eh-aprov.nao{color:var(--err, #f87171); animation:cb-pisca 1.1s ease-in-out infinite;}
@keyframes cb-pisca{50%{opacity:.25;}}
@media (prefers-reduced-motion: reduce){ .eh-aprov.nao{animation:none;} }
.cb-aprovar{display:inline-flex; align-items:center; gap:6px; padding:5px 12px; margin-left:6px;}
.cb-aprovar svg{width:15px; height:15px; fill:none; stroke:currentColor; stroke-width:1.6; stroke-linejoin:round; stroke-linecap:round;}
.cb-aprovar .eq-av{margin:-2px 0;}
.cb-aprovar.ok{color:var(--ok, #4ade80); border-color:var(--ok, #4ade80);}
.cb-aprovar.nao{color:var(--err, #f87171); border-color:var(--err, #f87171); animation:cb-pisca 1.1s ease-in-out infinite;}
.cb-aprovar.nao.trava{animation:none; opacity:.8;}
.cb-aprovar.pode{color:var(--on-hi, #fff); background:var(--hi, #3b82f6); border-color:var(--hi, #3b82f6);}
`;
function css(){
  if (typeof document === 'undefined' || document.getElementById('cb-css')) return;
  const s = document.createElement('style'); s.id = 'cb-css'; s.textContent = CSS; document.head.append(s);
}
function el(tag, cls, txt){ const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
function botao(txt, titulo, fn, cls){ const b = el('button', cls || null, txt); b.type = 'button'; if (titulo) b.title = titulo; b.addEventListener('click', fn); return b; }
function toast(txt, tipo, ms){
  if (root.HubDialog && root.HubDialog.toast) return root.HubDialog.toast(txt, tipo || 'info', ms);
  if (typeof root.toast === 'function') return root.toast(txt, tipo === 'err' ? 'err' : tipo === 'warn' ? 'warn' : 'ok');
}
async function api(url, corpo){
  try {
    const r = await fetch(url, corpo === undefined ? { cache:'no-store' }
      : { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(corpo) });
    let j = {};
    try { j = await r.json(); } catch (_) { /* sem corpo */ }
    if (!r.ok && j.ok !== false) j = { ok:false, error:'HTTP ' + r.status };
    return j;
  } catch (e) { return { ok:false, error:String(e && e.message || e), rede:true }; }
}

/* ─── quem está logado (o servidor pergunta ao Nexo Hub; aqui só a última leitura) ─── */
let est = { usuario:null, modo:'carregando', carregado:false };
const ouvintes = new Set();
function ouve(fn){ ouvintes.add(fn); return () => ouvintes.delete(fn); }
function avisa(){ for (const fn of ouvintes) try { fn(est); } catch (_) { /* ouvinte quebrado não derruba os outros */ } }
async function carrega(){
  const j = await api('/api/sessao');
  if (j.ok){
    const u = j.usuario || null;
    est = { usuario:u, modo:j.modo, carregado:true };
    avisa();
  }
  return est;
}
const ehAprovador = u => Boolean(u && u.aprovador === true);
try { (root.top || root).addEventListener('nexohub:sessao', () => setTimeout(carrega, 300)); } catch (_) { /* outra origem */ }

/* ─── modal no tema ─── */
function modal(titulo, sub, peq){
  css();
  const ov = el('div', 'cb-ov'), bx = el('div', 'cb-box' + (peq ? ' cb-peq' : ''));
  const hd = el('div', 'cb-hd'); hd.append(el('h2', null, titulo)); if (sub) hd.append(el('span', 'cb-dim', sub));
  const corpo = el('div', 'cb-corpo'), pe = el('div', 'cb-pe');
  bx.append(hd, corpo, pe); ov.append(bx); document.body.append(ov);
  let aoFechar = null;
  const esc = e => { if (e.key === 'Escape'){ e.stopPropagation(); e.preventDefault(); fecha(); } };
  function fecha(){ ov.remove(); document.removeEventListener('keydown', esc, true); if (aoFechar) aoFechar(); }
  document.addEventListener('keydown', esc, true);
  ov.addEventListener('mousedown', e => { if (e.target === ov) fecha(); });
  return { ov, bx, hd, corpo, pe, fecha, aoFechar: fn => { aoFechar = fn; } };
}
/* uma pergunta sim/não no tema: resolve true (ok) ou false */
function confirma(titulo, texto, ok){
  return new Promise(res => {
    const m = modal(titulo, null, true);
    let feito = false;
    m.aoFechar(() => { if (!feito) res(false); });
    m.corpo.append(el('div', null, texto));
    const b = botao(ok || 'OK', null, () => { feito = true; m.fecha(); res(true); });
    m.pe.append(el('span', 'cb-sp'), botao('Cancelar', null, () => m.fecha()), b);
    b.focus();
  });
}

/* ─── a tag na lista de projetos (hub-shell.js » linhaDoProjeto) ─── */
let aprovs = null, consulta = null, assinaturaAprovs = '';
async function atualizaAprovacoes(){
  if (typeof document !== 'undefined' && document.hidden) return;
  const j = await api('/api/aprovacoes');
  if (!j.ok) return;
  const s = JSON.stringify(j.projetos || {});
  if (s === assinaturaAprovs) return;
  assinaturaAprovs = s; aprovs = j.projetos || {};
  if (root.EletricShell && typeof root.EletricShell.render === 'function') root.EletricShell.render();
}
function ligaConsulta(){
  if (consulta) return;
  css();
  consulta = setInterval(atualizaAprovacoes, PERIODO);
  atualizaAprovacoes();
}
function tagProjeto(nome){
  ligaConsulta();
  const a = aprovs && aprovs[nome];
  if (!a) return null;
  const t = el('span', 'eh-aprov ' + (a.aprovado ? 'ok' : 'nao'), a.aprovado ? '[Aprovado]' : '[Sem aprovação]');
  t.title = a.aprovado ? (a.rev ? a.rev + ' · ' : '') + 'aprovado por ' + a.por + (a.data ? ' em ' + a.data : '') + ' — qualquer modificação tira a aprovação'
                       : 'ainda sem aprovação (ou modificado depois de aprovado): um aprovador (marcado no Nexo Hub) aprova pelo Esquema, ao lado do Salvar';
  return t;
}

/* ─── a edição salva no Esquema (1.80.0): o Salvar NÃO tira mais a aprovação sozinho; quem decide é a assinatura do
   servidor (tools/rotas/aprovacao.py » assinatura). A função fica (quem chama continua igual) e não mexe em nada. ─── */
function paramsDoTexto(txt){
  const T = root.HubSchTemplate;
  const m = /(^|\n)"params":("(?:[^"\\]|\\.)*"),?\s*(\n|$)/.exec(String(txt || '').split('\n"items":')[0]);
  if (!m || !T) return {};
  try { return T.parseParams(JSON.parse(m[2])); } catch (_) { return {}; }
}
function antesDeSalvar(sch, disco){
  void sch; void disco;
  return false;
}

/* ─── o botão Aprovar ao lado do Salvar (schframe.js) ───
   ganchos: {projeto, ancora (o #btnSave), sujo(), salva() -> Promise<bool>, schematic(), adota(texto, params)} */
function montaAprovar(g){
  css();
  const b = el('button', 'cb-aprovar'); b.type = 'button';
  const ico = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>';
  b.innerHTML = ico;
  const lbl = el('span'); b.append(lbl);
  g.ancora.after(b);
  let ap = null;
  const pinta = () => {
    const u = est.usuario;
    const pode = Boolean(u && u.aprovador);
    b.hidden = !ap || !ap.temEsquema;
    b.classList.remove('ok', 'nao', 'pode', 'trava');
    b.innerHTML = ico; b.append(lbl);
    if (!ap) return;
    if (ap.aprovado){
      b.classList.add('ok');
      const quem = ap.usuario || (ap.por ? { nome:ap.por } : null);
      if (quem && root.HubEquipe){ const a = root.HubEquipe.avatar(quem, 18); b.replaceChildren(a, lbl); }
      lbl.textContent = 'Aprovado' + (ap.rev ? ' · ' + ap.rev : '') + (ap.por ? ' · ' + ap.por : '');
      b.title = 'aprovado por ' + ap.por + (ap.data ? ' em ' + ap.data : '') + ' — qualquer modificação no projeto tira a aprovação';
    } else if (pode){
      b.classList.add('pode'); lbl.textContent = 'Aprovar';
      b.title = 'aprovar como ' + u.nome + ': verificador e aprovador no quadro de título da folha, com a data de hoje';
    } else {
      b.classList.add('nao', 'trava'); lbl.textContent = 'Sem aprovação';
      b.title = (est.modo === 'legado' ? 'Atualize o Nexo Hub para 2.26.0+ para aprovar pelo login' : MSG_APROVADOR)
        + (u ? ' (logado: ' + u.nome + ')' : '');
    }
  };
  const confere = async () => {
    const j = await api('/api/aprovacao?projeto=' + encodeURIComponent(g.projeto));
    if (j.ok){ ap = j; pinta(); }
  };
  ouve(pinta);
  b.addEventListener('click', async () => {
    if (!ap) return;
    if (ap.aprovado){ toast(b.title, 'info', 5000); return; }
    await carrega();
    const u = est.usuario;
    if (!(u && u.aprovador)){ toast(b.title, 'warn', 7000); return; }
    if (root.HubEquipe && root.HubEquipe.somenteLeitura && root.HubEquipe.somenteLeitura()){
      toast('somente leitura: só a equipe do projeto aprova (peça um convite ao responsável)', 'warn', 7000); return;
    }
    const D = root.HubDialog;
    if (D && !(await D.confirm('Aprovar o projeto ' + g.projeto + ' como ' + u.nome + '?\nO quadro de título da folha recebe '
        + u.nome + ' como verificador e aprovador, com a data de hoje, e o projeto é guardado como uma revisão nova '
        + '(Histórico › Revisões). Qualquer modificação depois tira a aprovação.',
        { title:'Aprovar projeto', ok:'Aprovar' }))) return;
    /* o aprovado é o que está no disco: a edição pendente vai antes (e a folha que sobrescreve os campos do projeto
       perde os dela, senão o carimbo mostraria o nome da folha e não o de quem aprovou) */
    const sch = g.schematic();
    const T = root.HubSchTemplate;
    for (const it of (sch && sch.items) || []){
      if (!T || !it || it.t !== 'sheet' || !it.params) continue;
      const q = T.parseParams(it.params); let m = false;
      for (const k of CAMPOS_APROVACAO) if (k in q){ delete q[k]; m = true; }
      if (m){ const s = T.serializaParams(q); if (s) it.params = s; else delete it.params; g.marcaSujo(); }
    }
    if (g.sujo() && !(await g.salva())) return;
    const j = await api('/api/aprovacao', { projeto:g.projeto });
    if (!j.ok){ toast('não aprovou: ' + (j.error || 'falhou'), 'err', 7000); await confere(); return; }
    g.adota(j.texto, j.params);
    ap = j; pinta();
    toast(g.projeto + ' aprovado por ' + j.por + ' — ' + j.rev + ' guardada', 'ok', 5000);
  });
  carrega().then(confere);
  setInterval(() => { if (!document.hidden) confere(); }, PERIODO);
  /* o "Assumir o projeto" da Equipe do projeto chega aqui quando esta vista está aberta: a edição pendente vai antes, e
     o texto que o servidor gravou vira o do disco (sem recarregar a folha) */
  if (typeof window !== 'undefined') window.__schAprovacao = { projeto: g.projeto, assumir: () => assumir(g.projeto, g) };
  return { confere };
}

/* ─── assumir o projeto: quem está logado vira o responsável e o desenhista, com a data de hoje (sem senha) ─── */
async function assumir(projeto, g){
  if (!projeto){ toast('abra um projeto para assumir', 'warn'); return false; }
  if (g && g.sujo() && !(await g.salva())) return false;
  const j = await api('/api/equipe/assumir', { projeto });
  if (!j.ok){ toast('não assumiu: ' + (j.error || 'falhou'), 'err', 7000); return false; }
  if (g && j.texto) g.adota(j.texto, j.params);
  toast(projeto + ': agora o responsável é você' + (j.desenhista ? ' (desenhista ' + j.desenhista + ', ' + j.dataDesenho + ')' : ''), 'ok', 5000);
  return true;
}
/* da Equipe do projeto (hub-equipe.js): se a vista Esquema do projeto está aberta, é ela que assume */
function assumirNoHub(nome){
  if (!nome){
    try { const p = typeof proj === 'function' ? proj() : null; nome = p ? p.name : ''; } catch (_) { nome = ''; }
  }
  for (const f of document.querySelectorAll('iframe')){
    let w = null;
    try { w = f.contentWindow; } catch (_) { w = null; }
    if (w && w.__schAprovacao && w.__schAprovacao.projeto === nome) return w.__schAprovacao.assumir();
  }
  return assumir(nome, null);
}
if (typeof window !== 'undefined' && typeof document !== 'undefined') window.__hubAssumirProjeto = assumirNoHub;

root.HubAprovacao = { tagProjeto, montaAprovar, antesDeSalvar, assumir, confirma, carrega, ouve, estado: () => est, ehAprovador,
                     CAMPOS_APROVACAO, MSG_APROVADOR, _paramsDoTexto: paramsDoTexto };
})(typeof window !== 'undefined' ? window : globalThis);
