'use strict';
// A pasta de trabalho: o hub roda com ROOT = esta pasta, exatamente como roda no
// principal e no servidor (hubserver.py:23, ROOT = pasta do proprio hubserver.py).
//
// Por isso o app COPIA o codigo para ca em vez de rodar de dentro da pasta de instalacao:
// o hub mistura codigo e dado na mesma arvore (Projects/, Libs/, credenciais ao lado do
// hub.html), e dezenas de pontos do Python acham o que precisam a partir dessa raiz.
// Separar as duas coisas seria reescrever o backend; copiar e o que o servidor ja faz
// (tools/deploy/deploy.sh: release com o codigo + shared/ com o estado).
//
// Regras, as mesmas do deploy:
//   - codigo (manifest.code) e do app: repor a cada versao, sem perguntar;
//   - estado (manifest.seed) so e copiado se FALTAR, e nunca mais e tocado;
//   - arquivo de codigo que saiu do app so e apagado se ainda for o que o app pos la
//     (mesmo sha1): quem editou a mao nao perde a edicao calado;
//   - pasta com .git e de desenvolvedor: o app roda o que esta la e nao sincroniza nada.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MARCA_DIR = '.altiumhub';          // o ponto no nome: o hubserver recusa servi-la
const MARCA = 'install.json';

function sha1File(f) {
  return crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
}

function lerJson(f) {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

function destino(ws, rel) {
  const d = path.join(ws, ...rel.split('/'));
  // Defesa contra manifesto adulterado: nada sai da pasta de trabalho.
  const r = path.relative(ws, d);
  if (!r || r.startsWith('..') || path.isAbsolute(r)) throw new Error('caminho fora da pasta: ' + rel);
  return d;
}

function copiaAtomica(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.altiumhub-tmp';
  fs.copyFileSync(src, tmp);
  try {
    fs.renameSync(tmp, dest);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

function isDevWorkspace(ws) {
  return fs.existsSync(path.join(ws, '.git'));
}

function lerManifesto(bundleDir) {
  const m = lerJson(path.join(bundleDir, 'altiumhub-manifest.json'));
  if (!m || m.format !== 'altiumhub-manifest-1') {
    throw new Error('o pacote do hub esta sem manifesto: ' + bundleDir);
  }
  return m;
}

function estado(ws) {
  return lerJson(path.join(ws, MARCA_DIR, MARCA));
}

// Precisa sincronizar? Versao/commit diferentes, ou algum arquivo de codigo sumiu.
function precisa(ws, manifest) {
  const st = estado(ws);
  if (!st || st.commit !== manifest.commit || st.appVersion !== manifest.appVersion) return true;
  return manifest.code.some((e) => !fs.existsSync(destino(ws, e.p)));
}

/**
 * Sincroniza o codigo do pacote para a pasta de trabalho.
 * @returns {{dev:boolean, copied:number, seeded:number, removed:number, kept:string[], falhas:string[]}}
 */
function sync(ws, bundleDir, log = () => {}) {
  fs.mkdirSync(ws, { recursive: true });
  if (isDevWorkspace(ws)) {
    log(`pasta de trabalho e um repositorio git (${ws}): modo desenvolvedor, nada e copiado`);
    return { dev: true, copied: 0, seeded: 0, removed: 0, kept: [], falhas: [] };
  }
  const manifest = lerManifesto(bundleDir);
  const anterior = estado(ws);
  const res = { dev: false, copied: 0, seeded: 0, removed: 0, kept: [], falhas: [] };

  if (precisa(ws, manifest)) {
    for (const e of manifest.code) {
      const d = destino(ws, e.p);
      let igual = false;
      try {
        igual = fs.statSync(d).size === e.size && sha1File(d) === e.sha1;
      } catch { /* nao existe */ }
      if (!igual) {
        // Arquivo em uso (o Altium segura o .pas aberto no editor de scripts, um antivirus
        // segura qualquer um) nao pode impedir o hub de abrir: fica o antigo, o log diz
        // qual, e a proxima abertura tenta de novo (a marca abaixo nao avanca).
        try {
          copiaAtomica(path.join(bundleDir, ...e.p.split('/')), d);
          res.copied++;
        } catch (err) {
          res.falhas.push(`${e.p} (${err.code || err.message})`);
        }
      }
    }
    // Codigo que existia na versao anterior e saiu desta.
    const agora = new Set(manifest.code.map((e) => e.p));
    for (const [rel, sha] of Object.entries((anterior && anterior.code) || {})) {
      if (agora.has(rel)) continue;
      const d = destino(ws, rel);
      if (!fs.existsSync(d)) continue;
      if (sha1File(d) === sha) {
        fs.rmSync(d, { force: true });
        res.removed++;
      } else {
        res.kept.push(rel);           // editado a mao: fica, e o log diz qual
      }
    }
  }

  // Estado: sempre confere (barato), porque alguem pode ter apagado um arquivo.
  for (const e of manifest.seed) {
    const d = destino(ws, e.p);
    if (!fs.existsSync(d)) {
      copiaAtomica(path.join(bundleDir, ...e.p.split('/')), d);
      res.seeded++;
    }
  }
  for (const dir of manifest.dirs || []) fs.mkdirSync(destino(ws, dir), { recursive: true });

  if (!res.falhas.length && (res.copied || res.removed || !anterior || anterior.commit !== manifest.commit)) {
    fs.mkdirSync(path.join(ws, MARCA_DIR), { recursive: true });
    const code = {};
    for (const e of manifest.code) code[e.p] = e.sha1;
    fs.writeFileSync(path.join(ws, MARCA_DIR, MARCA), JSON.stringify({
      appVersion: manifest.appVersion,
      commit: manifest.commit,
      syncedAt: new Date().toISOString(),
      code,
    }, null, 1));
  }
  log(`pasta de trabalho: ${res.copied} arquivo(s) de codigo atualizado(s), ${res.seeded} de estado ` +
    `semeado(s), ${res.removed} removido(s)` + (res.kept.length ? `; mantidos por terem sido editados: ${res.kept.join(', ')}` : '') +
    (res.falhas.length ? `; NAO atualizados (em uso): ${res.falhas.join(', ')}` : ''));
  return res;
}

// Configuracao inicial do Odoo: so quando o arquivo nao existe. Sem login e sem senha --
// esses o usuario poe no proprio hub (o formulario so aceita de localhost, e o app e).
function seedOdoo(ws, { odooUrl, odooDb }, log = () => {}) {
  const f = path.join(ws, 'hub-almox.json');
  if (fs.existsSync(f) || isDevWorkspace(ws)) return false;
  fs.writeFileSync(f, JSON.stringify({ url: odooUrl, db: odooDb }, null, 2) + '\n', 'utf8');
  log(`hub-almox.json criado apontando para ${odooUrl} (${odooDb}); falta login e senha`);
  return true;
}

// A pasta escolhida e uma pasta de trabalho do hub (ou pode virar uma)?
function avaliar(ws) {
  if (!ws) return { ok: false, motivo: 'nenhuma pasta escolhida' };
  if (!path.isAbsolute(ws)) return { ok: false, motivo: 'o caminho precisa ser absoluto' };
  if (ws.startsWith('\\\\')) {
    return { ok: false, motivo: 'use uma pasta deste PC: numa pasta de rede o hub desta maquina e o do servidor escreveriam nos mesmos arquivos' };
  }
  // Caminho com acento entra no ALMOX.DbLib (ConnectionString do ODBC), que o Altium le
  // como ANSI. Nao e proibido, mas quem escolhe precisa saber.
  const aviso = /[^\x20-\x7e]/.test(ws)
    ? 'o caminho tem acento ou caractere especial: o Altium pode não abrir a DbLib do almoxarifado daqui'
    : '';
  let existe = false;
  try {
    existe = fs.statSync(ws).isDirectory();
  } catch { /* nova */ }
  if (!existe) return { ok: true, nova: true, aviso };
  const dev = isDevWorkspace(ws);
  const temHub = fs.existsSync(path.join(ws, 'hubserver.py'));
  const vazia = fs.readdirSync(ws).length === 0;
  if (!dev && !temHub && !vazia && !fs.existsSync(path.join(ws, MARCA_DIR))) {
    return { ok: false, motivo: 'a pasta ja tem outros arquivos; escolha uma vazia ou uma pasta do hub' };
  }
  return { ok: true, nova: false, dev, temHub, aviso };
}

module.exports = { sync, seedOdoo, avaliar, isDevWorkspace, lerManifesto, MARCA_DIR };
