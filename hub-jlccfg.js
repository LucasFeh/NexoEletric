/* NexoEletric - hub-jlccfg.js — a conta da JLCPCB que o "Enviar pra JLC" usa para entrar.

   Pedido do dono (2026-11-03): "na configuração do hub, junto com a credencial do odoo, também tenha a
   credencial da jlc, coloco e-mail e senha, pra serem usados no login, quando clicar em enviar pra jlc".

   Um bloco na aba Projeto do modal de configuração, logo abaixo do envio para o Odoo (hub-odoocfg.js),
   com o mesmo jeito: e-mail e senha, Gravar e Apagar senha (dois cliques). Quem guarda é a rota
   /api/jlc/config (tools/rotas/jlc.py), em .hub-jlc.json na raiz do workspace -- o ponto no nome tira o
   arquivo do HTTP -- com a senha cifrada pela DPAPI do Windows (só o mesmo usuário, nesta máquina, a
   abre). A senha nunca volta do servidor: o campo abre vazio, e vazio quer dizer "não mexe". De outra
   máquina a gravação leva 403, como a do Odoo.

   Autossuficiente como o hub-odoocfg.js: o próprio CSS e os próprios rótulos em pt-BR. Da casca, duas
   linhas: o <script src> e a chamada de pane(). */
"use strict";
var HubJlcCfg = (function () {

const CSS = `
.jlcfg { margin-top: 7px; }
.jlcfg-grade { display: grid; grid-template-columns: 100px minmax(0,1fr); gap: 7px 12px; align-items: center; }
.jlcfg-grade > label { font-size: 13px; color: var(--text-2); }
.jlcfg-grade > input { min-height: 32px; width: 100%; }
.jlcfg-bar { display: flex; align-items: center; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.jlcfg-bar .sep { flex: 1; }
.jlcfg-nota { margin: 8px 0 0; font-size: 11px; line-height: 1.5; color: var(--text-4); }
.jlcfg-nota.warn { color: var(--warn, #d9a441); }
`;

const TXT = {
  titulo: 'Conta da JLCPCB (Enviar pra JLC)',
  email: 'E-mail', senha: 'Senha',
  phEmail: 'conta@empresa.com', phSenha: '••••••••',
  gravar: 'Gravar', apagar: 'Apagar senha', apagarDeNovo: 'clique de novo para apagar',
  carregando: 'lendo a configuração do servidor…',
  semServidor: 'Sem servidor: abra o hub pelo app (ou hubserver.py) para configurar a conta da JLC.',
  remoto: 'Aberto de outra máquina: a conta da JLC só muda no PC do hub (o envio usa o navegador de lá).',
  semSenha: 'Sem senha gravada: no "Enviar pra JLC", o login fica com você, na janela do navegador.',
  protegida: 'Senha gravada, cifrada pelo Windows (só este usuário, nesta máquina, a abre). O login do "Enviar pra JLC" é automático; captcha ainda é com você.',
  emClaro: 'Senha gravada em {a} (sem a cifra do Windows nesta máquina). O login do "Enviar pra JLC" é automático.',
  naoAbre: 'Há uma senha gravada, mas ela não abre neste usuário do Windows (veio de outro usuário ou PC): grave de novo.',
  arquivoTorto: 'O arquivo {a} não é um JSON válido: arrume ou apague-o antes de gravar aqui.',
  okGravado: 'conta da JLC gravada',
  okApagada: 'senha da JLC apagada',
  falhou: 'não gravou: ',
};
const T = (k, v) => { const s = TXT[k] || k; return v ? s.replace(/\{(\w+)\}/g, (m, x) => (x in v ? String(v[x]) : m)) : s; };
const nel = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
const nota = (k, cls, v) => nel('p', 'jlcfg-nota' + (cls ? ' ' + cls : ''), T(k, v));
const aviso = (msg, tipo) => { if (typeof window.toast === 'function') window.toast(msg, tipo); };

async function pegaJson(url, corpo) {
  const req = corpo ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) } : undefined;
  try {
    const r = await fetch(url, req);
    let j = {};
    try { j = await r.json(); } catch (e) {}
    if (!r.ok) return { ok: false, error: j.error || ('HTTP ' + r.status) };
    return j;
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

function pane(host) {
  if (!host) return;
  if (!document.getElementById('jlcfg-css')) { const st = nel('style'); st.id = 'jlcfg-css'; st.textContent = CSS; document.head.append(st); }
  const box = nel('div', 'jlcfg');
  box.append(nota('carregando'));
  host.append(nel('div', 'kicker', T('titulo')), box);
  pegaJson('/api/jlc/config').then(r => desenha(box, r));
  return box;
}

function situacao(cfg) {
  if (!cfg.temSenha) return nota('semSenha');
  if (!cfg.senhaAbre) return nota('naoAbre', 'warn');
  return cfg.protegida ? nota('protegida') : nota('emClaro', null, { a: cfg.arquivo || '.hub-jlc.json' });
}

function desenha(box, r) {
  box.textContent = '';
  if (!r || r.ok === false) { box.append(nota('semServidor', 'warn')); return; }
  const cfg = r.config || {};
  const grade = nel('div', 'jlcfg-grade');
  const email = nel('input', 'input');
  email.id = 'jlcfg-email'; email.type = 'email'; email.autocomplete = 'off'; email.spellcheck = false;
  email.placeholder = T('phEmail'); email.value = cfg.email || ''; email.disabled = !r.local;
  const senha = nel('input', 'input');
  /* a senha nunca volta do servidor: o campo abre vazio e vazio quer dizer "não mexe" */
  senha.id = 'jlcfg-senha'; senha.type = 'password'; senha.autocomplete = 'new-password';
  senha.placeholder = T('phSenha'); senha.disabled = !r.local;
  const le = nel('label', null, T('email')); le.htmlFor = email.id;
  const ls = nel('label', null, T('senha')); ls.htmlFor = senha.id;
  grade.append(le, email, ls, senha);
  box.append(grade);
  if (!r.local) { box.append(nota('remoto', 'warn'), situacao(cfg)); return; }
  if (cfg.arquivoIlegivel) box.append(nota('arquivoTorto', 'warn', { a: cfg.arquivo || '.hub-jlc.json' }));

  const bar = nel('div', 'jlcfg-bar');
  const gravar = nel('button', 'btn btn-secondary btn-sm', T('gravar'));
  const apagar = nel('button', 'btn btn-ghost btn-sm', T('apagar'));
  apagar.disabled = !cfg.temSenha;
  bar.append(gravar, nel('span', 'sep'), apagar);
  box.append(bar, situacao(cfg));

  let armado = 0;
  const grava = async (corpo, okMsg) => {
    gravar.disabled = true; apagar.disabled = true;
    const resp = await pegaJson('/api/jlc/config', corpo);
    if (!resp || resp.ok === false) {
      gravar.disabled = false; apagar.disabled = !cfg.temSenha;
      if (armado) { clearTimeout(armado); armado = 0; }
      apagar.textContent = T('apagar');
      aviso(T('falhou') + ((resp && resp.error) || '?'), 'err');
      return;
    }
    aviso(okMsg, 'ok');
    desenha(box, resp);
  };
  gravar.onclick = () => grava({ email: email.value, senha: senha.value }, T('okGravado'));
  senha.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); gravar.click(); } });
  /* apagar não tem desfazer, e confirm() é proibido: dois cliques, o botão volta sozinho em 4 s */
  apagar.onclick = () => {
    if (!armado) {
      armado = setTimeout(() => { armado = 0; apagar.textContent = T('apagar'); }, 4000);
      apagar.textContent = T('apagarDeNovo');
      return;
    }
    clearTimeout(armado); armado = 0;
    grava({ apagarSenha: true }, T('okApagada'));
  };
}

return { pane };
})();
