/* NexoEletric - hub-carimbos.js — os CARIMBOS da casa (quem desenha, quem aprova) e a APROVAÇÃO do projeto.

   Pedido do dono (2026-11-05): no menu da folha do Esquema, o "Carimbo…" abre os carimbos pré-estabelecidos — cada um
   com o nome e a senha que a pessoa deu, salvos para todo mundo (Libs/carimbos.json, no NexoBD) — e a tag "aprovador".
   Trocar de carimbo pede a senha daquele carimbo; apagar pede a senha mestre do hub. Com um carimbo aprovador em uso,
   o "Aprovar" aparece ao lado do Salvar: preenche no template o verificador E o aprovador (quem verifica também
   aprova) com a data de hoje. Na lista de projetos, cada um leva a tag [Aprovado] ou [Sem aprovação] (vermelha,
   piscando). Qualquer modificação no projeto tira a aprovação.
   O DESENHISTA (2026-11-05, o mesmo dia): quem cria o projeto (o carimbo em uso entra no carimbo da folha) ou quem o
   ASSUME (Arquivo › Assumir projeto…, com a senha mestre). A data do desenho é a da criação ou a de assumir.

   O servidor é o tools/rotas/carimbos.py (a regra da assinatura está lá). Aqui:
     HubCarimbos.abreGerenciador({campos})    o diálogo dos carimbos (campos = abre a tabela de campos do carimbo)
     HubCarimbos.tagProjeto(nome)             a tag do projeto no painel Projetos (hub-shell.js); liga a consulta
     HubCarimbos.montaAprovar(ganchos)        o botão Aprovar ao lado do Salvar (schframe.js)
     HubCarimbos.antesDeSalvar(sch, disco)    a edição salva derruba a aprovação
     HubCarimbos.assumir(projeto, ganchos?)   o carimbo em uso vira o desenhista (senha mestre)
     HubCarimbos.estado() / carrega() / ouve(fn)
   Nada de alert/confirm/prompt: modal no tema e toast (HubDialog quando a página tem; senão o toast do hub). */
(function (root) {
'use strict';

const CAMPOS_APROVACAO = ['Verificador_DiEletrons', 'Aprovador_DiEletrons', 'Data_verificacao', 'Data_aprovacao',
                          'Aprovacao_assinatura', 'Aprovacao_carimbo'];
const PERIODO = 5000;

const CSS = `
.cb-ov{position:fixed; inset:0; z-index:70; background:var(--scrim, rgba(11,11,13,.6)); display:flex; align-items:center;
  justify-content:center; color:var(--text, #d8d8d8); font:13px/1.45 var(--font, "Segoe UI", system-ui, sans-serif);}
.cb-box{background:var(--surface, #2d2d2d); border:1px solid var(--line, #444); border-radius:8px; width:min(560px, 94vw);
  max-height:88vh; display:flex; flex-direction:column; box-shadow:var(--shadow-menu, 0 8px 30px rgba(0,0,0,.5));}
.cb-box.cb-peq{width:min(380px, 94vw);}
.cb-hd{display:flex; align-items:baseline; gap:8px; padding:10px 12px; border-bottom:1px solid var(--line, #444);}
.cb-hd h2{font-size:13px; font-weight:600; margin:0;}
.cb-dim{font-size:11px; color:var(--text-3, #999);}
.cb-corpo{overflow:auto; padding:10px 12px; display:flex; flex-direction:column; gap:8px;}
.cb-pe{display:flex; gap:6px; justify-content:flex-end; align-items:center; padding:8px 12px; border-top:1px solid var(--line, #444);}
.cb-pe .cb-sp{flex:1;}
.cb-lin{display:flex; align-items:center; gap:8px; padding:6px 8px; border:1px solid var(--line, #444); border-radius:6px;}
.cb-lin.cb-uso{border-color:var(--hi, #3b82f6);}
.cb-nome{flex:1; min-width:0; display:flex; align-items:center; gap:6px; flex-wrap:wrap;}
.cb-nome b{font-weight:600;}
.cb-chip{font-size:10px; padding:1px 6px; border-radius:9px; border:1px solid var(--line, #555); color:var(--text-2, #bbb);
  text-transform:lowercase;}
.cb-chip.cb-apr{border-color:var(--ok, #4ade80); color:var(--ok, #4ade80);}
.cb-chip.cb-uso{border-color:var(--hi, #3b82f6); color:var(--hi, #3b82f6);}
.cb-box input[type=text], .cb-box input[type=password]{background:var(--sunken, #1e1e1e); color:var(--text, #ddd);
  border:1px solid var(--line, #444); border-radius:4px; padding:4px 6px; font:12px var(--font, sans-serif); min-width:0;}
.cb-box input:focus{outline:none; border-color:var(--hi, #3b82f6);}
.cb-form{display:grid; grid-template-columns:110px minmax(0,1fr); gap:6px 8px; align-items:center; font-size:12px;}
.cb-form > span{color:var(--text-3, #999);}
.cb-sec{font-size:10px; text-transform:uppercase; letter-spacing:.09em; color:var(--text-3, #999); margin-top:4px;}
.cb-erro{font-size:12px; color:var(--err, #f87171); min-height:1em;}
.cb-box button{cursor:pointer; padding:4px 11px; border-radius:var(--r-sm, 6px); border:1px solid var(--line, #444);
  background:var(--surface-2, #2a2a2a); color:var(--text, #ddd); font:12px var(--font, sans-serif);}
.cb-box button:hover:not(:disabled){border-color:var(--hi, #3b82f6);}
.cb-box button:disabled{opacity:.45; cursor:default;}
.cb-perigo:hover{color:var(--err, #f87171); border-color:var(--err, #f87171);}
.cb-sw{display:inline-flex; align-items:center; gap:6px; font-size:11px; color:var(--text-2, #bbb); cursor:pointer; user-select:none;}
.cb-sw input{appearance:none; -webkit-appearance:none; margin:0; width:30px; height:16px; border-radius:8px; position:relative;
  background:var(--sunken, #1e1e1e); border:1px solid var(--line, #555); cursor:pointer; transition:background .15s, border-color .15s;}
.cb-sw input::after{content:''; position:absolute; top:2px; left:2px; width:10px; height:10px; border-radius:50%;
  background:var(--text-3, #999); transition:left .15s, background .15s;}
.cb-sw input:checked{background:var(--ok, #4ade80); border-color:var(--ok, #4ade80);}
.cb-sw input:checked::after{left:16px; background:var(--on-hi, #fff);}
.cb-sw input:checked + span{color:var(--ok, #4ade80);}
.cb-sw input:focus-visible{outline:2px solid var(--hi, #3b82f6); outline-offset:1px;}
@media (prefers-reduced-motion: reduce){ .cb-sw input, .cb-sw input::after{transition:none;} }
.eh-aprov{font-size:10px; font-weight:600; margin-left:6px; white-space:nowrap; flex:none;}
.eh-aprov.ok{color:var(--ok, #4ade80);}
.eh-aprov.nao{color:var(--err, #f87171); animation:cb-pisca 1.1s ease-in-out infinite;}
@keyframes cb-pisca{50%{opacity:.25;}}
@media (prefers-reduced-motion: reduce){ .eh-aprov.nao{animation:none;} }
.cb-aprovar{display:inline-flex; align-items:center; gap:6px; padding:5px 12px; margin-left:6px;}
.cb-aprovar svg{width:15px; height:15px; fill:none; stroke:currentColor; stroke-width:1.6; stroke-linejoin:round; stroke-linecap:round;}
.cb-aprovar.ok{color:var(--ok, #4ade80); border-color:var(--ok, #4ade80);}
.cb-aprovar.nao{color:var(--err, #f87171); border-color:var(--err, #f87171); animation:cb-pisca 1.1s ease-in-out infinite;}
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
function hoje(){
  const d = new Date(), z = n => String(n).padStart(2, '0');
  return z(d.getDate()) + '/' + z(d.getMonth() + 1) + '/' + z(d.getFullYear() % 100);
}

/* ─── o estado dos carimbos (o servidor é a fonte; aqui só a última leitura) ─── */
let est = { carimbos:[], ativo:null, tagAprovador:'aprovador', carregado:false };
const ouvintes = new Set();
function ouve(fn){ ouvintes.add(fn); return () => ouvintes.delete(fn); }
function avisa(){ for (const fn of ouvintes) try { fn(est); } catch (_) { /* ouvinte quebrado não derruba os outros */ } }
async function carrega(){
  const j = await api('/api/carimbos');
  if (j.ok){ est = { carimbos:j.carimbos || [], ativo:j.ativo || null, tagAprovador:j.tagAprovador || 'aprovador', carregado:true }; avisa(); }
  return est;
}
const ehAprovador = c => Boolean(c && (c.tags || []).indexOf(est.tagAprovador) >= 0);

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
/* uma senha: resolve com o texto, ou null (cancelou). `confere(senha)` -> '' (ok) | mensagem, fica aberto no erro */
function pedeSenha(titulo, texto, o){
  o = o || {};
  return new Promise(res => {
    const m = modal(titulo, o.sub, true);
    let feito = false;
    m.aoFechar(() => { if (!feito) res(null); });
    if (texto) m.corpo.append(el('div', null, texto));
    const inp = el('input'); inp.type = 'password'; inp.autocomplete = 'new-password'; inp.placeholder = o.rotulo || 'senha';
    const erro = el('div', 'cb-erro');
    m.corpo.append(inp, erro);
    const vai = async () => {
      if (!inp.value){ erro.textContent = 'digite a senha'; inp.focus(); return; }
      ok.disabled = true;
      const msg = o.confere ? await o.confere(inp.value) : '';
      ok.disabled = false;
      if (msg){ erro.textContent = msg; inp.select(); inp.focus(); return; }
      feito = true; m.fecha(); res(inp.value);
    };
    const ok = botao(o.ok || 'OK', null, vai);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); vai(); } });
    const sp = el('span', 'cb-sp');
    m.pe.append(sp, botao('Cancelar', null, () => m.fecha()), ok);
    inp.focus();
  });
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

/* ─── o gerenciador (2026-11-06, pedido do dono): em cima o carimbo em uso (Editar, Sair e o switch de aprovador);
   embaixo os outros (Usar, Apagar, o switch); no rodapé só o "Adicionar carimbo". O switch de aprovador pede a
   senha mestre; o Editar troca o nome e a senha (pede a senha atual do carimbo). ─── */
function switchAprovador(c, depois){
  const lb = el('label', 'cb-sw'); lb.title = 'aprovador: pode aprovar projetos (ligar ou desligar pede a senha mestre)';
  const ck = el('input'); ck.type = 'checkbox'; ck.checked = ehAprovador(c);
  ck.setAttribute('role', 'switch'); ck.setAttribute('aria-label', 'aprovador ' + c.nome);
  lb.append(ck, el('span', null, 'aprovador'));
  ck.addEventListener('change', async () => {
    const liga = ck.checked;
    const outras = (c.tags || []).filter(t => t !== est.tagAprovador);
    const tags = (liga ? [est.tagAprovador] : []).concat(outras);
    const s = await pedeSenha((liga ? 'Tornar ' : 'Tirar ') + c.nome + (liga ? ' aprovador' : ' de aprovador'),
      liga ? 'Com a tag aprovador, ' + c.nome + ' pode aprovar projetos.' : c.nome + ' deixa de poder aprovar projetos.', {
        ok: liga ? 'Ligar' : 'Desligar', rotulo:'senha mestre', sub:'senha mestre do sistema',
        confere: async mestre => { const j = await api('/api/carimbos/tags', { id:c.id, tags, mestre }); return j.ok ? '' : (j.error || 'falhou'); } });
    if (s == null){ ck.checked = !liga; return; }
    await carrega(); if (depois) depois();
    toast(c.nome + (liga ? ' agora é aprovador' : ' não é mais aprovador'), 'ok');
  });
  return lb;
}
function apagaCarimbo(c){
  return pedeSenha('Apagar o carimbo ' + c.nome, 'Some para todos. Os projetos já aprovados por ele continuam com o nome no carimbo.', {
    ok:'Apagar', rotulo:'senha mestre', sub:'senha mestre do sistema',
    confere: async mestre => { const j = await api('/api/carimbos/apagar', { id:c.id, mestre }); return j.ok ? '' : (j.error || 'falhou'); } })
    .then(async s => { if (s == null) return false; await carrega(); toast('carimbo ' + c.nome + ' apagado', 'ok'); return true; });
}
function abreGerenciador(o){
  o = o || {};
  const m = modal('Carimbos', 'salvos no NexoBD para todos; o que está em uso vale só neste computador');
  const topo = el('div', null); topo.style.cssText = 'display:flex; flex-direction:column; gap:6px';
  const lista = el('div', null); lista.style.cssText = 'display:flex; flex-direction:column; gap:6px';
  const secOutros = el('div', 'cb-sec', 'Outros carimbos');
  m.corpo.append(el('div', 'cb-sec', 'Em uso neste computador'), topo, secOutros, lista);

  const pinta = () => {
    topo.textContent = ''; lista.textContent = '';
    const a = est.ativo && est.carimbos.find(c => c.id === est.ativo.id) || est.ativo;
    if (a){
      const l = el('div', 'cb-lin cb-uso');
      const nm = el('div', 'cb-nome'); nm.append(el('b', null, a.nome));
      l.append(nm, switchAprovador(a, pinta),
        botao('Editar', 'mudar o nome ou a senha deste carimbo', () => editaCarimbo(a).then(ok => { if (ok) pinta(); })),
        botao('Sair', 'deixar de usar este carimbo neste computador', async () => {
          const j = await api('/api/carimbos/sair', {});
          if (!j.ok){ toast('não saiu do carimbo: ' + j.error, 'err'); return; }
          await carrega(); pinta(); toast('nenhum carimbo em uso', 'ok');
        }));
      topo.append(l);
    } else {
      topo.append(el('div', 'cb-dim', !est.carregado ? 'carregando…'
        : est.carimbos.length ? 'Nenhum carimbo em uso: clique em Usar num dos carimbos abaixo.'
        : 'Nenhum carimbo ainda: clique em Adicionar carimbo.'));
    }
    const outros = est.carimbos.filter(c => !(est.ativo && est.ativo.id === c.id));
    secOutros.hidden = !outros.length;
    for (const c of outros){
      const l = el('div', 'cb-lin');
      const nm = el('div', 'cb-nome'); nm.append(el('b', null, c.nome));
      l.append(nm, switchAprovador(c, pinta),
        botao('Usar', 'passar a usar este carimbo neste computador (pede a senha dele)', async () => {
          const s = await pedeSenha('Usar o carimbo ' + c.nome, 'A senha que foi dada a este carimbo.', {
            ok:'Usar', confere: async senha => { const j = await api('/api/carimbos/entrar', { id:c.id, senha }); return j.ok ? '' : (j.error || 'falhou'); } });
          if (s == null) return;
          await carrega(); pinta(); toast('carimbo em uso: ' + c.nome, 'ok');
        }),
        botao('Apagar', 'apagar o carimbo (pede a senha mestre)', () => apagaCarimbo(c).then(ok => { if (ok) pinta(); }), 'cb-perigo'));
      lista.append(l);
    }
  };

  m.pe.append(botao('Adicionar carimbo', 'criar um carimbo novo (nome e senha)', () => novoCarimbo().then(ok => { if (ok) pinta(); })),
              el('span', 'cb-sp'), botao('Fechar', null, () => m.fecha()));
  const off = ouve(pinta);
  m.aoFechar(() => off());
  pinta();
  carrega();
}
/* um formulário pequeno (rótulo + campo) num modal: resolve true quando `salva()` devolve '' */
function formulario(titulo, sub, linhas, okTxt, salva, extra){
  return new Promise(res => {
    const m = modal(titulo, sub, true);
    let feito = false;
    m.aoFechar(() => { if (!feito) res(false); });
    const f = el('div', 'cb-form');
    for (const [rot, inp] of linhas) f.append(el('span', null, rot), inp);
    const erro = el('div', 'cb-erro');
    m.corpo.append(f, erro);
    const vai = async () => {
      erro.textContent = '';
      ok.disabled = true;
      const msg = await salva(erro);
      ok.disabled = false;
      if (msg){ erro.textContent = msg; return; }
      feito = true; m.fecha(); res(true);
    };
    const ok = botao(okTxt, null, vai);
    for (const [, inp] of linhas) inp.addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); vai(); } });
    if (extra) m.pe.append(extra(() => { feito = true; m.fecha(); res(true); }));
    m.pe.append(el('span', 'cb-sp'), botao('Cancelar', null, () => m.fecha()), ok);
    if (linhas[0]) linhas[0][1].focus();
  });
}
function campo(tipo, valor, ph){
  const i = el('input'); i.type = tipo; if (tipo === 'password') i.autocomplete = 'new-password';
  if (valor) i.value = valor; if (ph) i.placeholder = ph;
  return i;
}
function novoCarimbo(){
  const iNome = campo('text', '', 'o nome que vai no carimbo (ex.: Lucas)'), iSenha = campo('password'), iConf = campo('password');
  return formulario('Adicionar carimbo', 'fica salvo no NexoBD para todos',
    [['nome', iNome], ['senha', iSenha], ['confirmar senha', iConf]], 'Adicionar', async () => {
      const nome = iNome.value.trim();
      if (!nome){ iNome.focus(); return 'dê um nome ao carimbo'; }
      if (!iSenha.value){ iSenha.focus(); return 'dê uma senha ao carimbo'; }
      if (iSenha.value !== iConf.value){ iConf.focus(); return 'a confirmação não bate com a senha'; }
      const j = await api('/api/carimbos', { nome, senha:iSenha.value, tags:[] });
      if (!j.ok) return j.error || 'não gravou';
      /* sem carimbo em uso neste computador, o novo já entra em uso (a senha acabou de ser digitada) */
      if (!est.ativo) await api('/api/carimbos/entrar', { id:j.carimbo.id, senha:iSenha.value });
      await carrega();
      toast('carimbo ' + j.carimbo.nome + ' adicionado' + (est.ativo && est.ativo.id === j.carimbo.id ? ' e em uso' : ''), 'ok', 4000);
      return '';
    });
}
function editaCarimbo(c){
  const iNome = campo('text', c.nome), iNova = campo('password', '', 'em branco: continua a mesma'),
        iConf = campo('password'), iAtual = campo('password', '', 'a senha de hoje deste carimbo');
  return formulario('Editar o carimbo ' + c.nome, 'o nome vai no carimbo da folha dos projetos novos',
    [['nome', iNome], ['senha nova', iNova], ['confirmar senha', iConf], ['senha atual', iAtual]], 'Salvar', async () => {
      const nome = iNome.value.trim();
      if (!nome){ iNome.focus(); return 'dê um nome ao carimbo'; }
      if (iNova.value !== iConf.value){ iConf.focus(); return 'a confirmação não bate com a senha nova'; }
      if (nome === c.nome && !iNova.value) return 'nada mudou';
      if (!iAtual.value){ iAtual.focus(); return 'digite a senha atual do carimbo'; }
      const corpo = { id:c.id, senha:iAtual.value };
      if (nome !== c.nome) corpo.nome = nome;
      if (iNova.value) corpo.novaSenha = iNova.value;
      const j = await api('/api/carimbos/editar', corpo);
      if (!j.ok) return j.error || 'não gravou';
      await carrega();
      toast('carimbo ' + j.carimbo.nome + ' salvo', 'ok');
      return '';
    }, fecha => botao('Apagar carimbo', 'apagar este carimbo (pede a senha mestre)', async () => {
      if (await apagaCarimbo(c)) fecha();
    }, 'cb-perigo'));
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
                       : 'ainda sem aprovação (ou modificado depois de aprovado): um carimbo aprovador aprova pelo Esquema, ao lado do Salvar';
  return t;
}

/* ─── a edição salva no Esquema: derruba a aprovação ───
   A data do desenho NÃO muda aqui (2026-11-05: "a data de desenho é definida assim que é criado, ou quando o projeto é
   assumido"). `disco` fica na assinatura para quem chama, mas não é mais usado. */
function paramsDoTexto(txt){
  const T = root.HubSchTemplate;
  const m = /(^|\n)"params":("(?:[^"\\]|\\.)*"),?\s*(\n|$)/.exec(String(txt || '').split('\n"items":')[0]);
  if (!m || !T) return {};
  try { return T.parseParams(JSON.parse(m[2])); } catch (_) { return {}; }
}
/* 2026-11-05 (1.80.0): o Salvar NÃO tira mais a aprovação sozinho ("se eu movimento algo, mudo o layout, ele já gera uma
   revisão nova, eu não quero isso"). Quem decide é a assinatura do servidor (tools/rotas/carimbos.py » assinatura): do
   esquema, só a impressão elétrica (componentes e ligações, mcp/lib/impressao-eletrica.js); da PCB, tudo. Mudou o que
   conta, o projeto aparece sem aprovação na hora e os campos saem do carimbo depois da carência. A função fica (quem
   chama continua igual) e não mexe em nada. */
function antesDeSalvar(sch, disco){
  void sch; void disco;
  return false;
}

/* ─── o botão Aprovar ao lado do Salvar (schframe.js) ───
   ganchos: {projeto, ancora (o #btnSave), sujo(), salva() -> Promise<bool>, schematic(), adota(texto, params)} */
function montaAprovar(g){
  css();
  const b = el('button', 'cb-aprovar'); b.type = 'button';
  b.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>';
  const lbl = el('span'); b.append(lbl);
  g.ancora.after(b);
  let ap = null;
  const pinta = () => {
    const pode = ehAprovador(est.ativo);
    b.hidden = !ap || !ap.temEsquema;
    b.classList.remove('ok', 'nao', 'pode');
    if (!ap) return;
    if (ap.aprovado){
      b.classList.add('ok'); lbl.textContent = 'Aprovado' + (ap.rev ? ' · ' + ap.rev : '');
      b.title = 'aprovado por ' + ap.por + (ap.data ? ' em ' + ap.data : '') + ' — qualquer modificação no projeto tira a aprovação';
    } else if (pode){
      b.classList.add('pode'); lbl.textContent = 'Aprovar';
      b.title = 'aprovar como ' + est.ativo.nome + ': verificador e aprovador no carimbo, com a data de hoje';
    } else {
      b.classList.add('nao'); lbl.textContent = 'Sem aprovação';
      b.title = 'só um carimbo com a tag aprovador aprova — menu da folha › Carimbo…' + (est.ativo ? ' (em uso: ' + est.ativo.nome + ')' : '');
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
    if (!ehAprovador(est.ativo)){ abreGerenciador(g.gerenciador || {}); return; }
    const D = root.HubDialog;
    if (D && !(await D.confirm('Aprovar o projeto ' + g.projeto + ' como ' + est.ativo.nome + '?\nO carimbo recebe '
        + est.ativo.nome + ' como verificador e aprovador, com a data de hoje, e o projeto é guardado como uma revisão nova '
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
  /* o "Assumir projeto" do menu do hub chega aqui quando esta vista está aberta: a edição pendente vai antes, e o texto
     que o servidor gravou vira o do disco (sem recarregar a folha) */
  if (typeof window !== 'undefined') window.__schCarimbo = { projeto: g.projeto, assumir: () => assumir(g.projeto, g) };
  return { confere };
}

/* ─── assumir o projeto: o carimbo em uso vira o desenhista, com a data de hoje (senha mestre) ─── */
async function assumir(projeto, g){
  if (!projeto){ toast('abra um projeto para assumir', 'warn'); return false; }
  await carrega();
  if (!est.ativo){
    toast('escolha o seu carimbo primeiro: ele é quem assume o projeto', 'warn', 6000);
    abreGerenciador((g && g.gerenciador) || {});
    return false;
  }
  if (g && g.sujo() && !(await g.salva())) return false;
  let resp = null;
  const s = await pedeSenha('Assumir o projeto ' + projeto,
    'O carimbo ' + est.ativo.nome + ' passa a ser o desenhista do projeto, com a data de hoje. Trocar o carimbo do projeto pede a senha mestre do sistema.',
    { ok:'Assumir', rotulo:'senha mestre', sub:'senha mestre do sistema',
      confere: async mestre => { const j = await api('/api/carimbos/assumir', { projeto, mestre }); if (j.ok) resp = j; return j.ok ? '' : (j.error || 'falhou'); } });
  if (s == null || !resp) return false;
  if (g) g.adota(resp.texto, resp.params);
  toast(projeto + ': desenhista agora é ' + resp.desenhista + ' (' + resp.dataDesenho + ')', 'ok', 5000);
  return true;
}
/* o "Assumir projeto…" do menu Arquivo do hub (hub-menubar.js): o projeto aberto; se a vista Esquema dele está aberta,
   é ela que assume (salva o que estiver pendente e adota o texto novo) */
function assumirNoHub(){
  let nome = '';
  try { const p = typeof proj === 'function' ? proj() : null; nome = p ? p.name : ''; } catch (_) { nome = ''; }
  for (const f of document.querySelectorAll('iframe')){
    let w = null;
    try { w = f.contentWindow; } catch (_) { w = null; }
    if (w && w.__schCarimbo && w.__schCarimbo.projeto === nome) return w.__schCarimbo.assumir();
  }
  return assumir(nome, null);
}
if (typeof window !== 'undefined' && typeof document !== 'undefined') window.__hubAssumirProjeto = assumirNoHub;

root.HubCarimbos = { abreGerenciador, tagProjeto, montaAprovar, antesDeSalvar, assumir, confirma, pedeSenha, carrega, ouve, estado: () => est, ehAprovador,
                     CAMPOS_APROVACAO, _paramsDoTexto: paramsDoTexto };
})(typeof window !== 'undefined' ? window : globalThis);
