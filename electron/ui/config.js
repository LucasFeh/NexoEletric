'use strict';
/* Tela de configuracao: primeira execucao (?modo=setup, na janela principal) e
   Arquivo › Configuracoes (?modo=config, janela propria). Fala com o processo principal
   so pela ponte do preload (window.altiumhub). */
const api = window.altiumhub;
const modo = new URLSearchParams(location.search).get('modo') === 'setup' ? 'setup' : 'config';
document.body.classList.add(modo);
const $ = (id) => document.getElementById(id);
let cfg = null;
let apagarToken = false;
let apagarChave = false;

let toastT = 0;
function toast(msg, tipo = 'ok', ms = 3200) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'on ' + tipo;
  clearTimeout(toastT);
  if (ms) toastT = setTimeout(() => { t.className = ''; }, ms);
}

// So troca o tipo (ok/warn/err): as outras classes da nota (sob-caixa) ficam.
function nota(id, txt, tipo = '') {
  const n = $(id);
  n.textContent = txt || '';
  n.classList.remove('ok', 'warn', 'err');
  if (tipo) n.classList.add(tipo);
}

// 1.31.0: sem o servidor central (192.168.15.192:8100). Projetos, biblioteca e a BOM vêm do Nexo Hub (NexoBD);
// a pasta de desenvolvedor (git) continua com o comportamento de sempre.
let pastaDev = false;

async function avaliaPasta() {
  const ws = $('workspace').value.trim();
  const r = await api.chamar('config:avaliarPasta', ws);
  pastaDev = Boolean(r.ok && r.dev);
  if (!r.ok) return nota('nPasta', r.motivo, 'err');
  if (r.aviso) return nota('nPasta', r.aviso, 'warn');
  if (r.nova) return nota('nPasta', 'a pasta será criada', 'ok');
  if (r.dev) return nota('nPasta', 'repositório git: modo desenvolvedor — o app roda o código que está lá e não copia nada', 'warn');
  if (r.temHub) return nota('nPasta', 'pasta de trabalho existente: projetos e bibliotecas ficam como estão', 'ok');
  return nota('nPasta', 'pasta vazia: o hub será instalado nela', 'ok');
}

function mostraAtualizacao(u) {
  if (!u) return;
  const txt = {
    parado: '', verificando: 'verificando…', atualizado: 'você está na versão mais recente',
    baixando: `baixando a versão ${u.versao} (${u.progresso || 0}%)`, pronto: `versão ${u.versao} baixada — instala ao fechar o app`,
    'sem-token': 'sem token de leitura', desligado: u.erro, erro: u.erro,
  }[u.fase];
  nota('nUpdate', txt === undefined ? u.fase : txt, u.fase === 'erro' ? 'err' : (u.fase === 'atualizado' || u.fase === 'pronto') ? 'ok' : '');
}

async function carrega() {
  cfg = await api.chamar('config:ler');
  if (cfg.nexobd) {
    document.body.classList.add('nexobd');
    $('nexobdEstado').textContent = 'projetos e biblioteca: ' + (cfg.nexobdEstado || '—');
  }
  $('versao').textContent = `versão ${cfg.versao}${cfg.commit ? ' · ' + cfg.commit.slice(0, 10) : ''}`;
  $('workspace').value = cfg.workspace || cfg.workspacePadrao;
  $('odooUrl').value = cfg.odooUrl;
  $('odooDb').value = cfg.odooDb;
  $('port').value = cfg.port;
  $('lan').checked = cfg.lan;
  $('masterPassword').value = cfg.masterPassword || '';
  pastaDev = Boolean(cfg.dev);
  $('autoUpdate').checked = cfg.autoUpdate;
  $('avisoLan').style.display = cfg.lan ? 'block' : 'none';
  $('altArq').textContent = cfg.altium.arquivo;
  $('altHome').textContent = cfg.altium.home
    ? cfg.altium.home + (cfg.altium.apontaParaCa ? '   ← esta pasta de trabalho' : '')
    : '(nada configurado — os scripts procuram o servidor primeiro)';
  $('apontarAltium').checked = cfg.altium.apontaParaCa;
  mostraPrj();
  $('anthropicKey').placeholder = cfg.temChaveApi ? 'há uma chave gravada neste PC (digite outra para trocar)' : 'sk-ant-…';
  $('updateToken').placeholder = cfg.temToken ? 'há um token gravado neste PC (digite outro para trocar)'
    : cfg.tokenEmbutido ? 'usando o token que veio no instalador' : 'cole aqui um token com acesso de leitura ao repositório';
  nota('nToken', cfg.temToken || cfg.tokenEmbutido ? '' : 'sem token, o app não consegue ver os releases do repositório privado', cfg.temToken || cfg.tokenEmbutido ? '' : 'warn');
  mostraAtualizacao(cfg.atualizacao);
  $('bSalvar').textContent = modo === 'setup' ? 'Começar' : 'Salvar';
  avaliaPasta();
}

$('bPasta').onclick = async () => {
  const p = await api.chamar('config:escolherPasta', $('workspace').value.trim());
  if (p) { $('workspace').value = p; avaliaPasta(); mostraPrj(); }
};
function mostraPrj() { $('altPrj').textContent = ($('workspace').value.trim() || '<pasta de trabalho>') + '\\AltiumPCBMirror.PrjScr'; }
$('workspace').addEventListener('change', () => { avaliaPasta(); mostraPrj(); });
$('bApagarChave').onclick = () => { apagarChave = true; $('anthropicKey').value = ''; nota('nChave', 'a chave será apagada ao salvar', 'warn'); };
$('lan').addEventListener('change', () => { $('avisoLan').style.display = $('lan').checked ? 'block' : 'none'; });
$('bApagarToken').onclick = () => { apagarToken = true; $('updateToken').value = ''; nota('nToken', 'o token será apagado ao salvar', 'warn'); };
$('bVerificar').onclick = async () => {
  nota('nUpdate', 'verificando…');
  mostraAtualizacao(await api.chamar('config:verificarAtualizacoes'));
};
$('bCancelar').onclick = () => window.close();
$('bConexaoIA').onclick = () => api.chamar('config:conectarIA');

$('bSalvar').onclick = async () => {
  const b = $('bSalvar');
  b.disabled = true;
  try {
    const r = await api.chamar('config:salvar', {
      workspace: $('workspace').value.trim(),
      odooUrl: $('odooUrl').value.trim(),
      odooDb: $('odooDb').value.trim(),
      port: Number($('port').value),
      lan: $('lan').checked,
      masterPassword: $('masterPassword').value,
      autoUpdate: $('autoUpdate').checked,
      updateToken: $('updateToken').value,
      apagarToken,
      anthropicKey: $('anthropicKey').value,
      apagarChaveApi: apagarChave,
      apontarAltium: $('apontarAltium').checked,
    });
    if (modo === 'config') {
      toast(r && r.reiniciou ? 'salvo — o hub foi reiniciado' : 'salvo', 'ok');
      setTimeout(() => window.close(), 900);
    }
  } catch (e) {
    toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'err', 0);
  } finally {
    b.disabled = false;
  }
};

carrega().catch((e) => toast('não consegui ler a configuração: ' + e.message, 'err', 0));
