'use strict';
// Biblioteca do servidor (1.2.0). Decisao do dono: o servidor e a UNICA biblioteca. O
// hubserver desta maquina, com ALTIUMHUB_LIB_REMOTA=<servidor>, repassa ao servidor toda
// gravacao de biblioteca (/api/symbols/*, /api/almox/config, o /api/save do lib-subs.js) e
// mantem o topo de Libs/ como espelho so leitura dele (libremota.py). Sem servidor, a
// biblioteca abre com a ultima copia e toda gravacao e recusada.
//
// Aqui mora so a parte do APP: o modo esta ligado? e o que ele tira do "Importar do
// servidor". Sem electron de proposito, para o teste alcancar (test/lib-remota.test.js).
const fs = require('node:fs');
const path = require('node:path');
const { MARCA_DIR } = require('./workspace');

// Todos os grupos da importacao, na ordem da tela (ui/import.html).
const GRUPOS = ['projetos', 'libs', 'almox', 'almoxLibs'];

// Os grupos que o espelho do hubserver passou a cuidar. Dois escritores nos mesmos arquivos
// brigariam: o espelho segue o servidor, e a importacao de tres vias guarda o local quando so
// ele mudou (e poe o servidor em conflitos/) -- um desfaria o outro a cada rodada.
// Libs/Almox (almoxLibs) fica: sao as .SchLib que o Altium le, e o espelho nao as traz.
const GRUPOS_DO_ESPELHO = ['libs', 'almox'];

// O mesmo que main.js » validarUrl aceita, e o que o hubserver aceita no modo remoto:
// http(s), sem caminho nem barra final. Endereco que ele recusaria (ele volta ao modo local)
// nao pode ligar o modo daqui, senao o app pularia o guarda do sincronismo com o hub local.
function urlDoServidor(u) {
  let x;
  try {
    x = new URL(String(u || '').trim());
  } catch {
    return '';
  }
  if (x.protocol !== 'http:' && x.protocol !== 'https:') return '';
  return x.origin;
}

/**
 * A decisao unica: para onde a biblioteca desta maquina aponta ('' = modo local).
 *   - s.libRemota: a caixa das configuracoes; ausente conta como ligada (o padrao);
 *   - s.serverUrl: sem servidor valido nao ha para onde repassar;
 *   - pasta de desenvolvedor (git): a Libs e a do repositorio, versionada, e o espelho
 *     sujaria arquivos do git a cada rodada (como a importacao, que ali e recusada).
 * @param {object} s       settings
 * @param {boolean} ehDev  a pasta de trabalho e um repositorio de desenvolvedor
 */
function servidor(s, ehDev) {
  if (!s || s.libRemota === false || ehDev) return '';
  return urlDoServidor(s.serverUrl);
}

function ligada(s, ehDev) {
  return Boolean(servidor(s, ehDev));
}

// As variaveis que o hub recebe (main.js » envDoHub).
function envDoHub(s, ehDev) {
  const url = servidor(s, ehDev);
  return url ? { ALTIUMHUB_LIB_REMOTA: url } : {};
}

/**
 * Os grupos que a importacao pode rodar. No modo remoto, 'libs' e 'almox' saem e voltam em
 * `recusados`: a tela ja os desliga, isto e a defesa do processo principal (uma janela de
 * importacao aberta antes de a configuracao mudar ainda os manda).
 * @param {string[]} [pedidos]  o que a tela marcou; ausente = todos (o padrao de importar())
 * @param {boolean} remota
 */
function gruposDaImportacao(pedidos, remota) {
  const lista = Array.isArray(pedidos) ? [...new Set(pedidos.map(String))] : GRUPOS.slice();
  if (!remota) return { grupos: lista, recusados: [] };
  return {
    grupos: lista.filter((g) => !GRUPOS_DO_ESPELHO.includes(g)),
    recusados: lista.filter((g) => GRUPOS_DO_ESPELHO.includes(g)),
  };
}

/**
 * O hub que subiu esta mesmo no modo remoto? A resposta do GET /api/lib-remota/status.
 * Pedido nao e garantia: um hub de antes do libremota.py (app construido sem o merge do
 * backend) ignora a variavel e responde 404, e um endereco que o hub recusa o deixa em
 * "modo local". Nos dois casos o app tem de seguir o hub: pular o guarda do sincronismo e
 * esconder a importacao da biblioteca com um hub local faria deste PC uma segunda
 * autoridade calada. Sem resposta (tempo, rede), vale o pedido: o hub e daqui, e so o que
 * ele disse com todas as letras desmente a variavel.
 * @param {boolean} pedido               a variavel foi passada
 * @param {{status:number, json?:object}|null} resposta  null = nao respondeu
 */
function modoDoHub(pedido, resposta) {
  if (!pedido) return false;
  if (!resposta) return true;
  if (resposta.status === 404) return false;
  const j = resposta.json;
  if (j && typeof j === 'object' && typeof j.modo === 'string') return j.modo === 'remota';
  return true;
}

// Onde o espelho (libremota.py » Remota.__init__) guarda o que gravou: na pasta do app,
// .altiumhub/lib-remota.json; se o hub subiu antes de a .altiumhub existir, .lib-remota/.
const ESTADOS_DO_ESPELHO = [[MARCA_DIR, 'lib-remota.json'], ['.lib-remota', 'estado.json']];

/**
 * O que o espelho do hub gravou por ultimo no topo de Libs/, como {'Libs/<nome>': [sha1]}:
 * a mesma forma dos semeados que o importar() recebe. O libremota.py registra cada arquivo que
 * poe no disco em `arquivos[<nome>].sha1` (o sha1 do que ficou no disco, ja com o ajuste do
 * almox-index.js), e so ali -- o import-state.json da importacao nao sabe dele.
 *
 * E a base de tres vias que faltava ao DESLIGAR a biblioteca do servidor: o espelho deixou em
 * Libs/ uma copia do servidor que nao e trabalho de ninguem, mas que difere da ultima
 * importacao (ou da semente). Sem isto a importacao a tomaria por edicao local: as bibliotecas
 * virariam conflito em toda rodada (e nunca mais se atualizariam), e o almoxarifado deixaria um
 * backup por arquivo antes de cada sincronismo. E o espelho do _do_app do libremota.py, que no
 * sentido contrario ja reconhece o que a importacao e a semente puseram.
 *
 * So o ULTIMO sha1 de cada arquivo: mexido depois (no modo local, a mao, pelo hub), o local
 * deixa de bater e volta a ser protegido como qualquer edicao. Estado ilegivel = nada, e o
 * resultado e so a protecao de sempre.
 * @param {string} ws  pasta de trabalho
 */
function gravadosPeloEspelho(ws) {
  const out = {};
  if (!ws) return out;
  for (const partes of ESTADOS_DO_ESPELHO) {
    let d;
    try {
      d = JSON.parse(fs.readFileSync(path.join(ws, ...partes), 'utf8'));
    } catch {
      continue;
    }
    const arqs = d && typeof d === 'object' && d.arquivos && typeof d.arquivos === 'object' ? d.arquivos : {};
    for (const [nome, v] of Object.entries(arqs)) {
      const sha = v && typeof v === 'object' ? v.sha1 : null;
      if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) continue;
      if (!nome || /[\\/]/.test(nome)) continue;        // o espelho so escreve no topo de Libs/
      const rel = 'Libs/' + nome;
      out[rel] = [...new Set([...(out[rel] || []), sha])];
    }
  }
  return out;
}

module.exports = { GRUPOS, GRUPOS_DO_ESPELHO, urlDoServidor, servidor, ligada, envDoHub, gruposDaImportacao, modoDoHub, gravadosPeloEspelho };
