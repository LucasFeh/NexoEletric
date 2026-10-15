// Publica uma versao do NexoEletric desktop no GitHub (releases do LucasFeh/AltiumPCBMirror).
//
//   npm run release -- 1.0.0            versao exata (a primeira foi assim)
//   npm run release -- patch            1.0.0 -> 1.0.1   (minor, major tambem)
//   npm run release -- patch --dry-run  gera o instalador e para: nada commitado, tagueado ou enviado
//   npm run release -- 1.0.1            de novo, depois de uma falha no upload: RETOMA a publicacao
//
// O que acontece, nesta ordem (qualquer falha para tudo antes de o release ficar visivel):
//   1. confere: arvore limpa; GH_TOKEN (PUBLICAR) aceito pelo GitHub; token de LEITURA
//      (vai dentro do .exe) presente e diferente do de publicar;
//   2. sobe a versao em electron/package.json e escreve a entrada no CHANGELOG.md;
//   3. gera o instalador (prepare + electron-builder, sem publicar);
//   4. commit "desktop: vX.Y.Z" (se houver o que commitar) + tag anotada vX.Y.Z, push do
//      branch e da tag para origin;
//   5. electron-builder --publish always sobe o .exe, o .blockmap e o latest.yml num
//      RASCUNHO (package.json » releaseType: draft); so com os tres la dentro o rascunho
//      vira release publicado. Os apps instalados consultam /releases/latest, que nunca
//      enxerga rascunho: um upload pela metade nao quebra a atualizacao de ninguem.
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
const OWNER = 'LucasFeh';
const NOME_REPO = 'AltiumPCBMirror';
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const SEM_TOKEN_OK = args.includes('--sem-token-de-leitura');
const alvo = args.find((a) => !a.startsWith('--')) || 'patch';

function git(...a) {
  return execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8' }).trim();
}
function run(cmd, a, opts = {}) {
  console.log('>', cmd, a.join(' '));
  // shell so para npm/npx (sao .cmd no Windows); git e node vao direto, sem reinterpretar
  // caminho com espaco.
  const shell = process.platform === 'win32' && (cmd === 'npm' || cmd === 'npx');
  const r = spawnSync(cmd, a, { stdio: 'inherit', cwd: APP, shell, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} saiu com ${r.status}`);
}
function erro(m) {
  console.error('\n!! ' + m);
  process.exit(1);
}
const api = (p, token, init = {}) => fetch(`https://api.github.com/repos/${OWNER}/${NOME_REPO}${p}`, {
  ...init,
  headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
});

function proxima(atual, tipo) {
  if (/^\d+\.\d+\.\d+$/.test(tipo)) return tipo;
  const [a, b, c] = atual.split('.').map(Number);
  if (tipo === 'major') return `${a + 1}.0.0`;
  if (tipo === 'minor') return `${a}.${b + 1}.0`;
  if (tipo === 'patch') return `${a}.${b}.${c + 1}`;
  return erro(`versao desconhecida: ${tipo} (use patch, minor, major ou X.Y.Z)`);
}

// ── 1. pre-voo ──
if (git('status', '--porcelain')) erro('a arvore tem mudancas nao commitadas. O instalador sai do commit, entao commite (ou descarte) antes.');
const ghToken = (process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '').trim();
if (!ghToken && !DRY) erro('falta GH_TOKEN: o token que PUBLICA (Contents: Read and write em LucasFeh/AltiumPCBMirror).');
if (ghToken && !DRY) {
  // Antes de qualquer commit, tag ou push: um token vencido so apareceria no passo 5.
  const r = await api('/releases?per_page=1', ghToken);
  if (!r.ok) erro(`o GitHub recusou o GH_TOKEN (HTTP ${r.status}): vencido, revogado ou sem acesso a ${OWNER}/${NOME_REPO}.`);
}
let embutido = (process.env.ALTIUMHUB_UPDATE_TOKEN || '').trim();
const arqToken = path.join(APP, '.update-token');
if (!embutido && fs.existsSync(arqToken)) embutido = fs.readFileSync(arqToken, 'utf8').trim();
if (embutido && ghToken && embutido === ghToken) {
  erro('o token embutido no .exe e o MESMO que publica. Qualquer um que abra o instalador o le -- com ele,\n' +
    '   escreveria no repositorio. Crie um segundo token, fine-grained, so "Contents: Read-only", para o\n' +
    '   ALTIUMHUB_UPDATE_TOKEN (ou electron/.update-token).');
}
if (!embutido) {
  const msg = 'nenhum token de leitura para embutir (ALTIUMHUB_UPDATE_TOKEN ou electron/.update-token).\n' +
    '   Os PCs que instalarem ou se atualizarem para esta versao ficam SEM atualizacao automatica ate\n' +
    '   alguem informar um token em Configuracoes, maquina por maquina (o repositorio e privado).';
  if (!DRY && !SEM_TOKEN_OK) erro(msg + '\n   Para publicar assim mesmo: npm run release -- <versao> --sem-token-de-leitura');
  console.warn('AVISO: ' + msg);
} else if (!DRY) {
  const r = await api('/releases?per_page=1', embutido);
  if (!r.ok) erro(`o token de LEITURA (o que vai no .exe) nao enxerga os releases (HTTP ${r.status}).`);
}

const pkgArq = path.join(APP, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgArq, 'utf8'));
const versao = proxima(pkg.version, alvo);
const tag = `v${versao}`;
const ramo = git('rev-parse', '--abbrev-ref', 'HEAD');
// Retomar: a tag ja existe e e exatamente o HEAD com esta versao -- uma rodada anterior
// commitou, tagueou e empurrou, e falhou no upload. Repete so o passo 5.
const tagExiste = Boolean(git('tag', '--list', tag));
const retomar = tagExiste && pkg.version === versao && git('rev-parse', `${tag}^{commit}`) === git('rev-parse', 'HEAD');
if (tagExiste && !retomar) erro(`a tag ${tag} ja existe e nao e o HEAD desta arvore`);
console.log(`\nNexoEletric ${pkg.version} -> ${versao} (branch ${ramo})${DRY ? '  [dry-run]' : ''}${retomar ? '  [retomando a publicacao]' : ''}\n`);

if (!retomar) {
  // ── 2. versao e CHANGELOG ──
  run('npm', ['version', versao, '--no-git-tag-version', '--allow-same-version']);
  const anterior = git('tag', '--list', 'v*', '--sort=-v:refname').split('\n').filter(Boolean)[0];
  // Sem tag anterior, so o que e do app (senao a primeira entrada seria o repositorio inteiro).
  const commits = git('log', '--no-merges', '--format=- %s (%h)', ...(anterior ? [`${anterior}..HEAD`] : ['HEAD', '--', 'electron']))
    .split('\n').filter(Boolean);
  const clArq = path.join(APP, 'CHANGELOG.md');
  const cl = fs.existsSync(clArq) ? fs.readFileSync(clArq, 'utf8') : '# Changelog — NexoEletric desktop\n';
  const hoje = new Date().toISOString().slice(0, 10);
  // Entrada escrita a mao para esta versao vence a gerada (a 1.0.0 foi assim).
  if (!new RegExp(`^## ${versao.replace(/\./g, '\\.')}\\b`, 'm').test(cl)) {
    const entrada = `## ${versao} — ${hoje}\n\n${commits.length ? commits.slice(0, 80).join('\n') : '- (sem commits novos)'}\n`;
    const i = cl.indexOf('\n## ');
    fs.writeFileSync(clArq, i < 0 ? `${cl.trimEnd()}\n\n${entrada}` : `${cl.slice(0, i + 1)}${entrada}\n${cl.slice(i + 1)}`);
  }

  // ── 3. build de prova (nada publicado ainda) ──
  try {
    run('node', ['scripts/prepare.mjs']);
    run('npx', ['electron-builder', '--win', '--x64', '--publish', 'never']);
  } catch (e) {
    erro(`${e.message}. Para desfazer a versao: git -C "${REPO}" checkout -- electron/package.json electron/package-lock.json electron/CHANGELOG.md`);
  }

  if (DRY) {
    console.log(`\n[dry-run] instalador em electron/dist. Nada foi commitado, tagueado ou enviado.\n` +
      `Para desfazer a versao: git -C "${REPO}" checkout -- electron/package.json electron/package-lock.json electron/CHANGELOG.md`);
    process.exit(0);
  }

  // ── 4. commit, tag, push ──
  git('add', 'electron/package.json', 'electron/package-lock.json', 'electron/CHANGELOG.md');
  if (git('diff', '--cached', '--name-only')) git('commit', '-m', `desktop: ${tag}`);
  git('tag', '-a', tag, '-m', `NexoEletric desktop ${versao}`);
}
run('git', ['-C', REPO, 'push', 'origin', ramo]);
run('git', ['-C', REPO, 'push', 'origin', tag]);

// A entrada do CHANGELOG desta versao, sem o titulo: vira o texto do release.
function notasDaVersao() {
  const clArq = path.join(APP, 'CHANGELOG.md');
  if (!fs.existsSync(clArq)) return '';
  const linhas = fs.readFileSync(clArq, 'utf8').split(/\r?\n/);
  const i = linhas.findIndex((l) => l === `## ${versao}` || l.startsWith(`## ${versao} `));
  if (i < 0) return '';
  let j = i + 1;
  while (j < linhas.length && !linhas[j].startsWith('## ')) j++;
  return linhas.slice(i + 1, j).join('\n').trim();
}
// O RASCUNHO NASCE AQUI, e nao no electron-builder. Ele sobe o .exe e o .blockmap por
// publicadores diferentes; cada um procura o release da tag (electron-publish »
// getOrCreateRelease, por tag_name) e, sem achar, cria o seu. Na v1.2.1 sairam DOIS
// rascunhos -- o .blockmap num, o .exe e o latest.yml no outro -- e a conferencia parou em
// "falta NexoEletric-Setup-X.exe" com commit, tag e push ja feitos. Com o rascunho ja no
// GitHub os dois o acham e os tres arquivos caem no mesmo. O de uma rodada anterior
// (retomada) e reaproveitado.
async function rascunho() {
  const lista = await (await api('/releases?per_page=50', ghToken)).json();
  const doTag = Array.isArray(lista) ? lista.filter((r) => r.tag_name === tag) : [];
  if (doTag.length > 1) throw new Error(`ha ${doTag.length} releases com a tag ${tag}: junte os arquivos num so e apague os outros`);
  if (doTag.length) return doTag[0];
  const notas = notasDaVersao();
  const r = await api('/releases', ghToken, { method: 'POST', body: JSON.stringify({
    tag_name: tag, name: `NexoEletric ${versao}`, draft: true, ...(notas ? { body: notas } : {}) }) });
  if (!r.ok) throw new Error(`o GitHub recusou criar o rascunho ${tag}: HTTP ${r.status}`);
  return r.json();
}

// ── 5. publica ──
try {
  // O commit da versao mudou o package.json: o prepare carimba o commit certo no build-info.
  run('node', ['scripts/prepare.mjs']);
  const alvo = await rascunho();
  run('npx', ['electron-builder', '--win', '--x64', '--publish', 'always']);
  const lista = await (await api('/releases?per_page=50', ghToken)).json();
  const doTag = Array.isArray(lista) ? lista.filter((r) => r.tag_name === tag) : [];
  if (doTag.length > 1) throw new Error(`ha ${doTag.length} releases com a tag ${tag}: junte os arquivos no ${alvo.id} e apague os outros`);
  const rel = doTag.find((r) => r.id === alvo.id);
  if (!rel) throw new Error(`o release ${tag} nao apareceu no GitHub`);
  const tem = new Set((rel.assets || []).filter((a) => a.state === 'uploaded').map((a) => a.name));
  for (const n of [`NexoEletric-Setup-${versao}.exe`, `NexoEletric-Setup-${versao}.exe.blockmap`, 'latest.yml']) {
    if (!tem.has(n)) throw new Error(`falta ${n} no release ${tag}`);
  }
  if (rel.draft) {
    const r = await api(`/releases/${rel.id}`, ghToken, { method: 'PATCH', body: JSON.stringify({ draft: false, make_latest: 'true' }) });
    if (!r.ok) throw new Error(`o GitHub recusou publicar o rascunho ${tag}: HTTP ${r.status}`);
  }
  console.log(`\nPublicado: https://github.com/${OWNER}/${NOME_REPO}/releases/tag/${tag}`);
} catch (e) {
  erro(`${e.message}\n   O commit e a tag ${tag} ja estao no GitHub, e o rascunho (se houver) nao e visto pelos apps.\n` +
    `   Corrija e rode de novo: npm run release -- ${versao}`);
}
