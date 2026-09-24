// Publica uma versao do AltiumHub desktop no GitHub (releases do LucasFeh/AltiumPCBMirror).
//
//   npm run release -- patch            1.0.0 -> 1.0.1
//   npm run release -- minor            1.0.0 -> 1.1.0
//   npm run release -- 1.4.2            versao exata
//   npm run release -- patch --dry-run  faz tudo menos commit, tag, push e upload
//
// O que acontece, nesta ordem (qualquer falha para tudo antes de publicar):
//   1. confere: arvore limpa, GH_TOKEN (PUBLICAR) presente, e diferente do token que vai
//      EMBUTIDO no .exe (ALTIUMHUB_UPDATE_TOKEN ou electron/.update-token, so leitura);
//   2. sobe a versao em electron/package.json e escreve a entrada no CHANGELOG.md;
//   3. gera o instalador (prepare + electron-builder, sem publicar) -- se nao compila,
//      nada foi tagueado nem enviado;
//   4. commit "desktop: vX.Y.Z" + tag anotada vX.Y.Z, push do branch e da tag para origin;
//   5. electron-builder --publish always: cria o release vX.Y.Z com o .exe, o .blockmap e
//      o latest.yml -- os tres arquivos que o electron-updater dos apps instalados le.
//
// A tag tem de existir no GitHub ANTES do upload: sem ela, a API cria o release apontando
// para o HEAD do branch padrao (main), e o release diria ser um codigo que nao e.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const REPO = path.resolve(APP, '..');
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const alvo = args.find((a) => !a.startsWith('--')) || 'patch';

function git(...a) {
  return execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8' }).trim();
}
function run(cmd, a, opts = {}) {
  console.log('>', cmd, a.join(' '));
  const r = spawnSync(cmd, a, { stdio: 'inherit', cwd: APP, shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} saiu com ${r.status}`);
}
function erro(m) {
  console.error('\n!! ' + m);
  process.exit(1);
}

function proxima(atual, tipo) {
  if (/^\d+\.\d+\.\d+$/.test(tipo)) return tipo;
  const [a, b, c] = atual.split('.').map(Number);
  if (tipo === 'major') return `${a + 1}.0.0`;
  if (tipo === 'minor') return `${a}.${b + 1}.0`;
  if (tipo === 'patch') return `${a}.${b}.${c + 1}`;
  erro(`versao desconhecida: ${tipo} (use patch, minor, major ou X.Y.Z)`);
}

// ── 1. pre-voo ──
if (git('status', '--porcelain')) erro('a arvore tem mudancas nao commitadas. O instalador sai do commit, entao commite (ou descarte) antes.');
const ghToken = (process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '').trim();
if (!ghToken && !DRY) erro('falta GH_TOKEN: o token que PUBLICA (Contents: Read and write em LucasFeh/AltiumPCBMirror).');
let embutido = (process.env.ALTIUMHUB_UPDATE_TOKEN || '').trim();
const arqToken = path.join(APP, '.update-token');
if (!embutido && fs.existsSync(arqToken)) embutido = fs.readFileSync(arqToken, 'utf8').trim();
if (embutido && ghToken && embutido === ghToken) {
  erro('o token embutido no .exe e o MESMO que publica. Qualquer um que abra o instalador o le -- com ele,\n' +
    '   escreveria no repositorio. Crie um segundo token, fine-grained, so "Contents: Read-only", para o\n' +
    '   ALTIUMHUB_UPDATE_TOKEN (ou electron/.update-token).');
}
if (!embutido) {
  console.warn('AVISO: nenhum token de leitura para embutir. Os apps instalados so vao se atualizar depois que\n' +
    '       alguem informar um token em Configuracoes (o repositorio e privado).');
}

const pkgArq = path.join(APP, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgArq, 'utf8'));
const versao = proxima(pkg.version, alvo);
const tag = `v${versao}`;
if (git('tag', '--list', tag)) erro(`a tag ${tag} ja existe`);
const ramo = git('rev-parse', '--abbrev-ref', 'HEAD');
console.log(`\nAltiumHub ${pkg.version} -> ${versao} (branch ${ramo})${DRY ? '  [dry-run]' : ''}\n`);

// ── 2. versao e CHANGELOG ──
run('npm', ['version', versao, '--no-git-tag-version', '--allow-same-version']);
const anterior = git('tag', '--list', 'v*', '--sort=-v:refname').split('\n').filter(Boolean)[0];
const faixa = anterior ? `${anterior}..HEAD` : 'HEAD';
const commits = git('log', '--no-merges', '--format=- %s (%h)', faixa).split('\n').filter(Boolean);
const clArq = path.join(APP, 'CHANGELOG.md');
const cl = fs.existsSync(clArq) ? fs.readFileSync(clArq, 'utf8') : '# Changelog — AltiumHub desktop\n';
const hoje = new Date().toISOString().slice(0, 10);
// Entrada escrita a mao para esta versao vence a gerada (a 1.0.0 foi assim).
if (!new RegExp(`^## ${versao.replace(/\./g, '\\.')}\\b`, 'm').test(cl)) {
  const entrada = `## ${versao} — ${hoje}\n\n${commits.length ? commits.slice(0, 80).join('\n') : '- (sem commits novos)'}\n`;
  const i = cl.indexOf('\n## ');
  fs.writeFileSync(clArq, i < 0 ? `${cl.trimEnd()}\n\n${entrada}` : `${cl.slice(0, i + 1)}${entrada}\n${cl.slice(i + 1)}`);
}

// ── 3. build de prova (nada publicado ainda) ──
run('node', ['scripts/prepare.mjs']);
run('npx', ['electron-builder', '--win', '--x64', '--publish', 'never']);

if (DRY) {
  console.log(`\n[dry-run] instalador em electron/dist. Nada foi commitado, tagueado ou enviado.\n` +
    `Para desfazer a versao: git -C "${REPO}" checkout -- electron/package.json electron/package-lock.json electron/CHANGELOG.md`);
  process.exit(0);
}

// ── 4. commit, tag, push ──
git('add', 'electron/package.json', 'electron/package-lock.json', 'electron/CHANGELOG.md');
git('commit', '-m', `desktop: ${tag}`);
git('tag', '-a', tag, '-m', `AltiumHub desktop ${versao}`);
run('git', ['-C', REPO, 'push', 'origin', ramo]);
run('git', ['-C', REPO, 'push', 'origin', tag]);

// ── 5. publica ──
// O commit da versao mudou o package.json: o prepare carimba o commit novo no build-info.
run('node', ['scripts/prepare.mjs']);
run('npx', ['electron-builder', '--win', '--x64', '--publish', 'always']);
console.log(`\nPublicado: https://github.com/LucasFeh/AltiumPCBMirror/releases/tag/${tag}`);
