/* AltiumPCBMirror v2 - hub-odoocfg.js — para onde o "Enviar para o Odoo" manda a lista.

   Um bloco dentro da aba Projeto do modal de configuração: url, base, login, senha e o
   modelo que recebe a lista. Até aqui isso só existia como arquivo na raiz — o
   hub-odoolista.js mandava editar `.hub-odoo.json` à mão, e o projetista da bancada não
   tem como fazer isso.

   Duas coisas que este painel NÃO faz, e que são a razão dele existir separado do
   formulário do almoxarifado (hub.html » alxFormCred):

   - não grava em `hub-almox.json`. Até 2026-09-24 aquele arquivo saía por HTTP em texto
     claro para a LAN inteira (o _serve só recusava nome começando por ponto); hoje o _serve
     o recusa pelo caminho (hubserver.py » _e_segredo). A senha do envio continua só em
     `.hub-odoo.json`, onde o ponto no nome sempre bastou;
   - não expõe os três métodos (`di_confere_lista`, `di_recebe_lista`, `di_estado_lista`).
     Eles são o contrato da spec, não configuração: método errado não dá erro de tela,
     dá 500 do Odoo depois que alguém clicou em enviar.

   Autossuficiente como o hub-dialog.js: injeta o próprio CSS e traz os próprios rótulos
   em pt-BR. Os painéis não usam hub-i18n.js — ele é da casca, de outro dono. Da casca
   este arquivo precisa de três linhas: o <script src>, a chamada de pane() e nada mais. */
"use strict";
var HubOdooCfg = (function () {

/* CSS próprio em vez da .cfgm-dir de hub.html:833: aquela grade é `1fr auto auto`, feita
   para caminho + escolher + gravar numa linha só, e aqui são cinco campos rotulados. A
   grade abaixo é a mesma da .cfgm-field (rótulo fixo à esquerda, campo elástico) para o
   bloco não destoar do resto do modal. */
const CSS = `
.odcfg { margin-top: 7px; }
.odcfg-grade { display: grid; grid-template-columns: 100px minmax(0,1fr); gap: 7px 12px;
  align-items: center; }
.odcfg-grade > label { font-size: 13px; color: var(--text-2); }
.odcfg-grade > input { min-height: 32px; width: 100%; }
/* campo fixo: da para ler e selecionar, nao da para editar. Fica mais apagado que um campo
   normal e menos que um desabilitado -- ele nao esta "fora do ar", esta "nao se mexe" */
.odcfg-grade > input.fixo { color: var(--text-2); background: var(--bg-2, transparent);
  border-style: dashed; cursor: default; }
.odcfg-grade > input.fixo:focus { outline: none; border-color: var(--line); }
.odcfg-bar { display: flex; align-items: center; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.odcfg-bar .sep { flex: 1; }
.odcfg-nota { margin: 8px 0 0; font-size: 11px; line-height: 1.5; color: var(--text-4); }
.odcfg-nota b { font-weight: 500; color: var(--text-3); }
.odcfg-nota.warn { color: var(--warn, #d9a441); }
`;

const TXT = {
  titulo: 'Envio da lista para o Odoo',
  url: 'Servidor', db: 'Base', login: 'Usuário', senha: 'Senha', modelo: 'Modelo',
  phSenha: '••••••••',
  gravar: 'Gravar',
  apagar: 'Apagar senha',
  apagarDeNovo: 'clique de novo para apagar',
  carregando: 'lendo a configuração do servidor…',
  semServidor: 'Sem servidor: abra o hub por hubserver.py para configurar o envio.',
  /* dizer por que o formulário não está aqui é melhor do que só não mostrá-lo: de outra
     máquina o POST leva 403, e sumir com os campos faria parecer defeito */
  remoto: 'Esta aba está aberta de outra máquina. As credenciais do Odoo só mudam no PC '
        + 'do servidor — o hub recusa a gravação vinda da rede, do mesmo jeito que faz '
        + 'com as do almoxarifado. Os valores abaixo são os que o servidor está usando.',
  fixoTitle: 'fixo: o Odoo da casa é sempre este — só a credencial muda',
  ajuda: 'Servidor, base e modelo são fixos (o Odoo da casa). Aqui só se troca a '
       + 'credencial. A senha vai só para <b>.hub-odoo.json</b>, na raiz do workspace, que o hub '
       + 'nunca entrega pela rede — e não para o hub-almox.json, que é a credencial do '
       + 'almoxarifado. O campo em branco não apaga a senha já gravada.',
  metodos: 'Os três métodos do Odoo (conferir, receber e consultar) continuam no código: '
         + 'eles são o contrato da integração, não configuração.',
  semSenha: 'Não há senha configurada — o envio da lista vai recusar antes de falar com o Odoo.',
  /* o arquivo ilegivel abre a tela com todos os campos em branco, como se nunca tivesse
     sido configurado; sem esta linha o unico sinal seria o erro depois do clique */
  arquivoTorto: 'O arquivo <b>{a}</b> está no PC do servidor mas não dá para ler (JSON '
              + 'inválido). O hub recusa gravar por cima dele para não apagar a senha que '
              + 'estiver guardada aí: arrume o arquivo, ou apague-o, antes de gravar aqui.',
  senhaArquivo: 'Senha gravada em {a}.',
  /* a variável de ambiente ganha de tudo em destino(): gravar aqui e continuar sem efeito
     é exatamente a confusão que a tela tem que evitar */
  senhaAmbiente: 'A senha em uso vem da variável de ambiente <b>{f}</b>, que ganha da '
               + 'gravada no arquivo. Enquanto ela existir, trocar a senha aqui não muda nada.',
  senhaAmbienteMais: ' Há também uma senha em {a}, escondida atrás dela.',
  okGravado: 'destino do Odoo gravado',
  okApagada: 'senha do Odoo apagada',
  falhou: 'não gravou: ',
};

const T = (k, vars) => {
  const s = TXT[k] || k;
  return vars ? s.replace(/\{(\w+)\}/g, (m, v) => (v in vars ? String(vars[v]) : m)) : s;
};

const nel = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};

/* os textos de ajuda trazem <b> daqui de cima — constante do próprio arquivo, nunca
   entrada de usuário, então innerHTML não abre porta nenhuma (mesma regra do cfgHint) */
function nota(key, cls, vars) {
  const n = nel('p', 'odcfg-nota' + (cls ? ' ' + cls : ''));
  n.innerHTML = T(key, vars);
  return n;
}

const aviso = (msg, tipo) => {
  if (typeof window.toast === 'function') window.toast(msg, tipo);
};

async function pegaJson(url, corpo) {
  const req = corpo ? { method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(corpo) } : undefined;
  try {
    const r = await fetch(url, req);
    let j = {};
    try { j = await r.json(); } catch (e) {}
    if (!r.ok) return { ok: false, error: j.error || ('HTTP ' + r.status) };
    return j;
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

/* Monta o bloco dentro de `host`. Síncrono na casca (ela não espera ninguém) e assíncrono
   por dentro: o quadro entra vazio com uma linha de "lendo…" e se preenche quando o
   servidor responde. */
function pane(host) {
  if (!host) return;
  if (!document.getElementById('odcfg-css')) {
    const st = nel('style'); st.id = 'odcfg-css'; st.textContent = CSS;
    document.head.append(st);
  }
  const box = nel('div', 'odcfg');
  box.append(nel('p', 'odcfg-nota', T('carregando')));
  host.append(nel('div', 'kicker', T('titulo')), box);
  pegaJson('/api/lista/config').then(r => desenha(box, r));
  return box;
}

function desenha(box, r) {
  box.textContent = '';
  if (!r || r.ok === false) {
    box.append(nota('semServidor', 'warn'));
    return;
  }
  const cfg = r.config || {};
  const arquivo = r.arquivo || '.hub-odoo.json';

  /* Servidor, base e modelo NAO sao configuracao: sao o endereco do Odoo da casa
     (192.168.15.192:8070, odoo_db, di.lista.altium), iguais em toda maquina. Ficam a
     vista, em somente-leitura, porque esconde-los faria a tela nao responder "para onde
     isto vai" — que e a pergunta que ela existe para responder. Editavel, so a
     CREDENCIAL. Quem precisar apontar para outro Odoo (a bancada, para testar) escreve o
     .hub-odoo.json a mao: e caso raro e deliberado, nao coisa de formulario. */
  const FIXOS = ['url', 'db', 'modelo'];
  const grade = nel('div', 'odcfg-grade');
  const campos = {};
  ['url', 'db', 'login', 'modelo', 'senha'].forEach(k => {
    const i = nel('input', 'input mono');
    i.id = 'odcfg-' + k;
    i.type = k === 'senha' ? 'password' : 'text';
    i.autocomplete = 'off';
    /* a senha nunca volta do servidor: o campo abre vazio e vazio quer dizer "não mexe" */
    i.value = k === 'senha' ? '' : (cfg[k] || '');
    if (k === 'senha') i.placeholder = T('phSenha');
    i.disabled = !r.local;
    if (FIXOS.indexOf(k) >= 0) {
      /* readOnly e nao disabled: disabled apaga o campo da tela (cinza sobre cinza) e
         ainda tira do foco, entao nao da nem para selecionar o endereco para conferir */
      i.readOnly = true;
      i.classList.add('fixo');
      i.title = T('fixoTitle');
    }
    campos[k] = i;
    const lab = nel('label', null, T(k)); lab.htmlFor = i.id;
    grade.append(lab, i);
  });
  box.append(grade);

  if (!r.local) {
    box.append(nota('remoto', 'warn'));
    box.append(fonteDaSenha(cfg, arquivo));
    return;
  }

  if (cfg.arquivoIlegivel) box.append(nota('arquivoTorto', 'warn', { a: arquivo }));

  const bar = nel('div', 'odcfg-bar');
  const gravar = nel('button', 'btn btn-secondary btn-sm', T('gravar'));
  const apagar = nel('button', 'btn btn-ghost btn-sm', T('apagar'));
  /* só o arquivo é apagável daqui: a variável de ambiente é do systemd, não do hub */
  apagar.disabled = !cfg.senhaNoArquivo;
  bar.append(gravar, nel('span', 'sep'), apagar);
  box.append(bar);
  box.append(fonteDaSenha(cfg, arquivo), nota('ajuda'), nota('metodos'));

  /* declarado ANTES do grava porque o caminho de falha o desarma: o clique que armou o
     "clique de novo" e o que chamou o POST, e um POST que falhou deixa o botão armado
     prometendo uma segunda chance que não existe */
  let armado = 0;

  const grava = async (corpo, okMsg) => {
    gravar.disabled = true; apagar.disabled = true;
    const resp = await pegaJson('/api/lista/config', corpo);
    if (!resp || resp.ok === false) {
      gravar.disabled = false;
      /* repõe o estado REAL do botão, e não "habilitado": com o POST falhando (arquivo
         corrompido, por exemplo) e nenhuma senha no arquivo, o `= false` daqui devolvia um
         "Apagar senha" clicável sobre arquivo nenhum — dois cliques e o toast anunciava
         "senha do Odoo apagada" sem nada ter sido apagado */
      apagar.disabled = !cfg.senhaNoArquivo;
      if (armado) { clearTimeout(armado); armado = 0; }
      apagar.textContent = T('apagar');
      aviso(T('falhou') + ((resp && resp.error) || '?'), 'err');
      return;
    }
    aviso(okMsg, 'ok');
    desenha(box, resp);          /* redesenha com o que o servidor confirmou, senha zerada */
  };

  /* so a credencial viaja: mandar url/db/modelo de volta gravaria no arquivo uma copia do
     que ja e padrao, e bastaria um campo vir vazio (arquivo ilegivel, por exemplo) para o
     POST escrever "" por cima de configuracao boa */
  gravar.onclick = () => grava({
    login: campos.login.value, senha: campos.senha.value,
  }, T('okGravado'));

  /* Apagar senha é destrutivo e não tem desfazer, mas confirm() do navegador é proibido e
     abrir um modal por cima do modal de configuração empilha diálogo. Dois cliques: o
     primeiro só troca o rótulo, e o botão volta ao normal em 4 s se ninguém confirmar. */
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

/* De qual das três fontes sai a senha que o envio vai usar. `temSenha` sozinho não serve:
   ele é verdadeiro também quando a senha veio do ambiente e o arquivo está vazio. */
function fonteDaSenha(cfg, arquivo) {
  if (!cfg.temSenha && !cfg.senhaNoArquivo) return nota('semSenha', 'warn');
  if (cfg.fonteSenha && cfg.fonteSenha !== arquivo) {
    const n = nota('senhaAmbiente', null, { f: cfg.fonteSenha });
    /* uma senha velha pode continuar no arquivo atrás da variável; dizer isso é o que
       justifica o "Apagar senha" continuar clicável neste caso */
    if (cfg.senhaNoArquivo) n.innerHTML += T('senhaAmbienteMais', { a: arquivo });
    return n;
  }
  return nota('senhaArquivo', null, { a: arquivo });
}

return { pane };
})();
