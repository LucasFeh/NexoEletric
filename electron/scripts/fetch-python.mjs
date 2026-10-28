// Monta build/python: o CPython "embeddable" oficial + as dependencias do requirements.txt.
//
// Por que o embeddable e nao PyInstaller: o hub roda subprocessos com sys.executable
// (tools/almox/almox2lib.py, o extrator de simbolos). Congelado num .exe, sys.executable
// vira o proprio hub e esses subprocessos quebram. Com um python.exe de verdade, o que
// funciona no servidor funciona igual aqui.
//
// Por que 3.12.10: o servidor roda 3.12.3, e 3.12.10 foi a ultima 3.12 com binario oficial
// (as seguintes sao so codigo-fonte, de seguranca).
//
// Uso:  node scripts/fetch-python.mjs          (reaproveita o que ja esta em build/python)
//       node scripts/fetch-python.mjs --force  (refaz do zero)
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// os mesmos parametros com que o app sobe o Python (lib/python-flags.js): -E -s -X utf8 -u
const { PY_FLAGS } = createRequire(import.meta.url)('../lib/python-flags.js');

const PY_VERSION = '3.12.10';
const PY_TAG = 'python312';
const PY_URL = `https://www.python.org/ftp/python/${PY_VERSION}/python-${PY_VERSION}-embed-amd64.zip`;
// SHA-256 do zip acima. O python.org publica o MD5 (fe8ef205f2e9c3ba44d0cf9954e1abd3),
// conferido na primeira baixa; o SHA-256 foi calculado sobre esse mesmo arquivo.
const PY_SHA256 = '4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const REPO = path.resolve(APP, '..');
const CACHE = path.join(APP, '.cache');
const OUT = path.join(APP, 'build', 'python');
const STAMP = path.join(OUT, '.altiumhub-python.json');
const REQ = path.join(REPO, 'requirements.txt');

const force = process.argv.includes('--force');


function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} saiu com ${r.status}`);
  return r;
}

// Um Python do sistema so para rodar o pip. As dependencias sao puras ou tem wheel
// win_amd64, entao o pip de qualquer versao instala para 3.12 com --python-version.
function hostPython() {
  const cands = [];
  if (process.env.PYTHON) cands.push([process.env.PYTHON, []]);
  cands.push(['py', ['-3']], ['python', []], ['python3', []]);
  for (const [cmd, pre] of cands) {
    const r = spawnSync(cmd, [...pre, '-m', 'pip', '--version'], { encoding: 'utf8' });
    if (r.status === 0) return [cmd, pre];
  }
  throw new Error('nenhum Python com pip no PATH para instalar as dependencias (defina PYTHON=...)');
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download falhou: ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest + '.part', buf);
  fs.renameSync(dest + '.part', dest);
}

async function main() {
  const reqHash = createHash('sha256').update(fs.readFileSync(REQ)).digest('hex');
  if (!force && fs.existsSync(STAMP)) {
    const s = JSON.parse(fs.readFileSync(STAMP, 'utf8'));
    if (s.python === PY_VERSION && s.requirements === reqHash) {
      console.log(`build/python ja esta pronto (Python ${PY_VERSION}, requirements iguais)`);
      return;
    }
  }

  const zip = path.join(CACHE, path.basename(PY_URL));
  if (!fs.existsSync(zip) || sha256(zip) !== PY_SHA256) {
    console.log('baixando', PY_URL);
    await download(PY_URL, zip);
  }
  const got = sha256(zip);
  if (got !== PY_SHA256) throw new Error(`SHA-256 do Python nao confere: ${got}`);

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  // Expand-Archive e nao tar: no Git Bash o `tar` do PATH e o GNU, que nao abre zip.
  run('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${OUT}' -Force`]);

  // O ._pth do embeddable liga o modo isolado E tira a pasta do script do sys.path.
  // O hub depende dela (hubserver.py importa odoolista_server da raiz; almox2lib.py importa
  // os vizinhos de tools/almox), entao o arquivo sai. Sem ele o python.exe monta o sys.path
  // como uma instalacao normal: python312.zip, Lib\ e Lib\site-packages ao lado do exe.
  // Quem sobe o processo (lib/backend.js) usa -E -s (lib/python-flags.js): nenhuma PYTHON* e nem o
  // PythonPath do registro (o de um Python 3.12 instalado) entram.
  fs.rmSync(path.join(OUT, `${PY_TAG}._pth`), { force: true });

  const site = path.join(OUT, 'Lib', 'site-packages');
  fs.mkdirSync(site, { recursive: true });
  const [py, pre] = hostPython();
  run(py, [...pre, '-m', 'pip', 'install', '--disable-pip-version-check', '--no-compile',
    '--target', site, '--python-version', '3.12', '--implementation', 'cp',
    '--platform', 'win_amd64', '--only-binary=:all:', '-r', REQ]);
  // Scripts de console (flask.exe...) apontam para o Python do build; ninguem os usa.
  fs.rmSync(path.join(site, 'bin'), { recursive: true, force: true });

  // Prova de vida com o proprio runtime, com os parametros com que o app o sobe.
  const env = { ...process.env, PYTHONNOUSERSITE: '1' };
  delete env.PYTHONHOME; delete env.PYTHONPATH;
  run(path.join(OUT, 'python.exe'), [...PY_FLAGS, '-c',
    'import flask, werkzeug, jinja2, olefile, sqlite3, ssl, xmlrpc.client, sys; ' +
    'assert sys.version_info[:2] == (3, 12), sys.version; print("runtime ok", sys.version.split()[0])'],
  { env });
  // .pyc das dependencias ja no build: a pasta do app pode nao aceitar gravacao depois.
  // olefile2.py e o modulo legado de Python 2 do olefile (sintaxe 0xFFL): ninguem o importa,
  // e sem o -x ele faz o compileall inteiro sair com erro.
  run(path.join(OUT, 'python.exe'), [...PY_FLAGS, '-m', 'compileall', '-q', '-x', 'olefile2\\.py$', site], { env });

  fs.writeFileSync(STAMP, JSON.stringify({ python: PY_VERSION, requirements: reqHash }, null, 2));
  console.log('build/python pronto');
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
