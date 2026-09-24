// Tudo o que o instalador precisa antes do electron-builder:
//   build/python   o CPython embutido + dependencias   (fetch-python.mjs)
//   build/hub      o hub do commit HEAD, com manifesto  (stage-hub.mjs)
//   gen/build-info.json   versao, commit, data e, se houver, o token de atualizacao
//
// O token vem de ALTIUMHUB_UPDATE_TOKEN (ou do arquivo electron/.update-token, fora do
// git). Ele entra no app.asar: qualquer um que abra o .exe o le. Por isso: token de
// granularidade fina, SO este repositorio, SO "Contents: Read-only". O token de PUBLICAR
// (GH_TOKEN, com escrita) nunca passa por aqui.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const REPO = path.resolve(APP, '..');

function node(script, args = []) {
  const r = spawnSync(process.execPath, [path.join(HERE, script), ...args], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
}

node('fetch-python.mjs');
node('stage-hub.mjs');

const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
const commit = execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
let token = (process.env.ALTIUMHUB_UPDATE_TOKEN || '').trim();
const arqToken = path.join(APP, '.update-token');
if (!token && fs.existsSync(arqToken)) token = fs.readFileSync(arqToken, 'utf8').trim();
if (token && /^(ghp_|gho_|ghu_|ghs_)/.test(token)) {
  console.warn('AVISO: o token de atualizacao parece um token CLASSICO (ghp_...). Ele da acesso a TODOS os\n' +
    '       repositorios da conta e vai legivel dentro do .exe. Prefira um fine-grained (github_pat_...)\n' +
    '       restrito a LucasFeh/AltiumPCBMirror, so "Contents: Read-only".');
}
let python = '';
try {
  python = JSON.parse(fs.readFileSync(path.join(APP, 'build', 'python', '.altiumhub-python.json'), 'utf8')).python;
} catch { /* sem carimbo */ }

fs.mkdirSync(path.join(APP, 'gen'), { recursive: true });
fs.writeFileSync(path.join(APP, 'gen', 'build-info.json'), JSON.stringify({
  version: pkg.version,
  commit,
  builtAt: new Date().toISOString(),
  python,
  updateToken: token,
}, null, 2));
console.log(`gen/build-info.json: v${pkg.version}, commit ${commit.slice(0, 10)}, ` +
  (token ? 'COM token de atualizacao embutido' : 'sem token de atualizacao (o app pede em Configuracoes)'));
