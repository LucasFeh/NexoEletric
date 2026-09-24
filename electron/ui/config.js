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
let voltarAltium = false;

let toastT = 0;
function toast(msg, tipo = 'ok', ms = 3200) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'on ' + tipo;
  clearTimeout(toastT);
  if (ms) toastT = setTimeout(() => { t.className = ''; }, ms);
}

function nota(id, txt, tipo = '') {
  const n = $(id);
  n.textContent = txt || '';
  n.className = 'nota' + (tipo ? ' ' + tipo : '');
}

async function avaliaPasta() {
  const ws = $('workspace').value.trim();
  const r = await api.chamar('config:avaliarPasta', ws);
  if (!r.ok) return nota('nPasta', r.motivo, 'err');
  if (r.aviso) return nota('nPasta', r.aviso, 'warn');
  if (r.nova) return nota('nPasta', 'a pasta será criada', 'ok');
  if (r.dev) return nota('nPasta', 'repositório git: modo desenvolvedor — o app roda o código que está lá e não copia nada', 'warn');
  if (r.temHub) return nota('nPasta', 'pasta de trabalho existente: projetos e bibliotecas ficam como estão', 'ok');
  return nota('nPasta', 'pasta vazia: o hub será instalado nela', 'ok');
}

async function testaServidor() {
  nota('nServidor', 'testando…');
  const r = await api.chamar('config:testarServidor', $('serverUrl').value.trim());
  if (r.ok) nota('nServidor', `respondeu: ${r.projetos} projeto${r.projetos === 1 ? '' : 's'} no servidor`, 'ok');
  else nota('nServidor', 'não respondeu: ' + r.erro, 'err');
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
  $('versao').textContent = `versão ${cfg.versao}${cfg.commit ? ' · ' + cfg.commit.slice(0, 10) : ''}`;
  $('workspace').value = cfg.workspace || cfg.workspacePadrao;
  $('serverUrl').value = cfg.serverUrl;
  $('odooUrl').value = cfg.odooUrl;
  $('odooDb').value = cfg.odooDb;
  $('port').value = cfg.port;
  $('lan').checked = cfg.lan;
  $('masterPassword').value = cfg.masterPassword || '';
  $('syncGuard').checked = cfg.syncGuard !== false;
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
  nota('nImport', cfg.ultimaImportacao ? 'última importação: ' + new Date(cfg.ultimaImportacao).toLocaleString('pt-BR')
    : 'nenhuma importação feita ainda (Arquivo › Importar do servidor)');
  mostraAtualizacao(cfg.atualizacao);
  $('bSalvar').textContent = modo === 'setup' ? 'Começar' : 'Salvar';
  avaliaPasta();
  if (modo === 'setup') testaServidor();
}

$('bPasta').onclick = async () => {
  const p = await api.chamar('config:escolherPasta', $('workspace').value.trim());
  if (p) { $('workspace').value = p; avaliaPasta(); mostraPrj(); }
};
function mostraPrj() { $('altPrj').textContent = ($('workspace').value.trim() || '<pasta de trabalho>') + '\\AltiumPCBMirror.PrjScr'; }
$('workspace').addEventListener('change', () => { avaliaPasta(); mostraPrj(); });
$('bApagarChave').onclick = () => { apagarChave = true; $('anthropicKey').value = ''; nota('nChave', 'a chave será apagada ao salvar', 'warn'); };
$('bTestar').onclick = testaServidor;
$('lan').addEventListener('change', () => { $('avisoLan').style.display = $('lan').checked ? 'block' : 'none'; });
$('bApagarToken').onclick = () => { apagarToken = true; $('updateToken').value = ''; nota('nToken', 'o token será apagado ao salvar', 'warn'); };
$('bVoltarAltium').onclick = () => {
  voltarAltium = true;
  $('apontarAltium').checked = false;
  $('altHome').textContent = cfg.altium.servidor + '   (ao salvar)';
};
$('bVerificar').onclick = async () => {
  nota('nUpdate', 'verificando…');
  mostraAtualizacao(await api.chamar('config:verificarAtualizacoes'));
};
$('bCancelar').onclick = () => window.close();

$('bSalvar').onclick = async () => {
  const b = $('bSalvar');
  b.disabled = true;
  try {
    const r = await api.chamar('config:salvar', {
      workspace: $('workspace').value.trim(),
      serverUrl: $('serverUrl').value.trim(),
      odooUrl: $('odooUrl').value.trim(),
      odooDb: $('odooDb').value.trim(),
      port: Number($('port').value),
      lan: $('lan').checked,
      masterPassword: $('masterPassword').value,
      syncGuard: $('syncGuard').checked,
      autoUpdate: $('autoUpdate').checked,
      updateToken: $('updateToken').value,
      apagarToken,
      anthropicKey: $('anthropicKey').value,
      apagarChaveApi: apagarChave,
      importar: $('importar').checked,
      // desmarcar nao desfaz nada: quem quer o servidor de volta usa o botao proprio
      apontarAltium: $('apontarAltium').checked && !voltarAltium,
      voltarAltiumServidor: voltarAltium,
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
