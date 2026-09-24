// Monta build/hub: a copia do hub que viaja dentro do instalador.
//
// A fonte e o `git ls-files` do HEAD (arquivo commitado, nao o que esta sujo no disco),
// o que da tres garantias de graca:
//   - segredo nenhum entra: hub-almox.json, .hub-odoo.json, componentes_odoo.csv, .chat/
//     sao gitignored, entao nem aparecem na lista;
//   - saida gerada nao entra (Libs/Almox, almox-*.js): e o sincronismo que as refaz;
//   - o instalador de uma versao e reproduzivel a partir do commit carimbado nele.
//
// Cada arquivo sai numa de duas classes, registradas em build/hub/altiumhub-manifest.json:
//   code  -> e do APP: a cada atualizacao o app o repoe na pasta de trabalho;
//   seed  -> e ESTADO que o git carrega so para uma instalacao nova nascer com ele. O app
//            copia se faltar e nunca mais toca. A lista e a mesma do deploy do servidor
//            (tools/deploy/deploy.sh, COMPARTILHADOS_ARQ), pelo mesmo motivo: trocar estado
//            por baixo de quem trabalha e o que aquele deploy inteiro foi desenhado para nao
//            fazer -- e perder o almox-parts.json renumera o almoxarifado.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const REPO = path.resolve(APP, '..');
const OUT = path.join(APP, 'build', 'hub');
const PKG = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));

// Fora do pacote. Nada disto roda no desktop.
const EXCLUIR = [
  /^electron\//,             // o proprio app
  /^tests\//,                // suite de testes
  /^docs\//,                 // specs e planos de desenvolvimento
  /^example\//,              // o exemplo do v1, que o hub nao carrega
  /^tools\/deploy\//,        // docker/systemd do servidor
  /^tools\/wt-novo\.ps1$/,   // ferramenta de worktree do desenvolvedor
  /^tools\/diag-share-altium\.ps1$/,
  /^\.git/,                  // .gitignore, .gitattributes
  /^\.dockerignore$/,
  /^Color_Test_60W_MOPA\.lbrn2$/,   // arquivo de referencia dos testes do laser
  /(^|\/)__pycache__\//,
];

// Projetos: nenhum viaja. Os da empresa vem do servidor pelo "Importar do servidor" -- o
// que o git tem deles e uma fotografia velha, e ja diverge do .192 (la ha projetos que o
// git nunca viu). Nem o _DemoKit: os simbolos dele sairam do Libs/schlib.js (R22 do
// docs/MAPA_ATUAL.md), e a primeira tela de quem instala seria uma folha cheia de erro.
const PROJETO_QUE_VIAJA = null;

// tools/symbols/config.json do desktop: sem schlib/pcblib/backup_dir. Com eles, um PC que
// tem o Y: mapeado resolveria a biblioteca da casa como VIVA (tools/libpath.py) e o app
// passaria a GRAVAR na .SchLib da rede a cada "Salvar no Altium" -- coisa que o servidor
// nunca faz (la o Y: e "de outra maquina" e vale a copia publicada, so leitura). Sem as
// chaves, o desktop resolve igual ao servidor: PUBLICADA, e a copia vem na importacao.
function configDesktop(buf) {
  const cfg = JSON.parse(buf.toString('utf8'));
  for (const k of ['schlib', 'pcblib', 'backup_dir']) delete cfg[k];
  cfg._desktop = 'EletricHUB desktop: a biblioteca da casa e a copia publicada em Libs/ ' +
    '(somente leitura, como no servidor). Para gravar na lib viva, declare "schlib" aqui.';
  return Buffer.from(JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

// ESTADO versionado: semeia se faltar, nunca sobrescreve. Espelha COMPARTILHADOS_ARQ do
// tools/deploy/deploy.sh; o que la e gitignored (almox-*.js gerados, credenciais) nem
// chega aqui.
const SEED = new Set([
  'Libs/almox-parts.json',
  'Libs/almox-excluidos.json',
  'Libs/lib-ledger.json',
  'Libs/lib-subs.js',
  'Libs/schlib.js',
  'Libs/symbols-lib.js',
  'Libs/libs-report.txt',
  'Libs/BIBLIOTECA DE ESQUEMA.SchLib',
  'Libs/pcblib.js',
  'Libs/rename-map.js',
  'projects.js',
  'tools/symbols/config.json',
]);

function git(args) {
  return execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });
}

function sha1(buf) {
  return createHash('sha1').update(buf).digest('hex');
}

function main() {
  const commit = git(['rev-parse', 'HEAD']).trim();
  const sujo = git(['status', '--porcelain', '--untracked-files=no']).trim();
  // -z: nomes com acento (Projects/LM555 astável) saem crus, sem o escape em octal do git.
  const todos = git(['ls-files', '-z']).split('\0').filter(Boolean);

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const code = [];
  const seed = [];
  let bytes = 0;
  for (const rel of todos) {
    if (EXCLUIR.some((re) => re.test(rel))) continue;
    if (rel.startsWith('Projects/') && !(PROJETO_QUE_VIAJA && PROJETO_QUE_VIAJA.test(rel))) continue;
    // Conteudo do COMMIT, nao do disco: um arquivo sujo na arvore nao pode entrar num
    // instalador que diz ser o commit X. E com --filters, e nao `git show`: o blob guarda
    // LF, e e o filtro que aplica o eol=crlf do .gitattributes -- os .pas e o .PrjScr
    // precisam de CRLF para o DelphiScript do Altium (o deploy.sh ganha isso do git archive).
    let buf = execFileSync('git', ['-C', REPO, 'cat-file', '--filters', `HEAD:${rel}`], { maxBuffer: 256 << 20 });
    if (rel === 'tools/symbols/config.json') buf = configDesktop(buf);
    const dest = path.join(OUT, ...rel.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    bytes += buf.length;
    const ent = { p: rel, size: buf.length, sha1: sha1(buf) };
    (SEED.has(rel) || rel.startsWith('Projects/') ? seed : code).push(ent);
  }

  const faltam = [...SEED].filter((p) => !seed.some((e) => e.p === p));
  if (faltam.length) console.warn('AVISO: estado listado em SEED que nao esta no git:', faltam.join(', '));
  for (const marca of ['hubserver.py', 'hub.html', 'AI-GUIDE.md']) {
    if (!code.some((e) => e.p === marca)) throw new Error(`${marca} ficou fora do pacote`);
  }
  // Os scripts do Altium tem de sair com CRLF (ver o --filters acima).
  for (const e of code.filter((x) => /\.(pas|PrjScr)$/.test(x.p))) {
    const t = fs.readFileSync(path.join(OUT, ...e.p.split('/')), 'latin1');
    const lf = (t.match(/\n/g) || []).length;
    const crlf = (t.match(/\r\n/g) || []).length;
    if (lf !== crlf) throw new Error(`${e.p} saiu sem CRLF (${crlf}/${lf}): confira o .gitattributes`);
  }

  const manifest = {
    format: 'altiumhub-manifest-1',
    appVersion: PKG.version,
    commit,
    dirty: Boolean(sujo),
    stagedAt: new Date().toISOString(),
    // Diretorios de runtime que o hub espera achar (deploy.sh, COMPARTILHADOS_DIR).
    dirs: ['Projects', 'Libs', 'Libs/Almox', 'Trash', 'Laser'],
    code,
    seed,
  };
  fs.writeFileSync(path.join(OUT, 'altiumhub-manifest.json'), JSON.stringify(manifest, null, 1));
  console.log(`build/hub: ${code.length} arquivos de codigo, ${seed.length} de estado, ` +
    `${(bytes / 1048576).toFixed(1)} MB, commit ${commit.slice(0, 10)}${sujo ? ' (arvore suja: vale o commit)' : ''}`);
}

main();
