// A janela do NexoEletric em Rust para o instalador (lib/casca-rust.js): compila o NexoEletric-rust e poe
// em build/rust o que vai para resources\rust:
//   NexoEletric.exe   a casca (crates/nexoeletric-web): janela WebView2 + o servidor do hub em Rust
//   web/              nexo-gl.js, nexo-gl-worker.js e o nexo_wasm.wasm (o nucleo Rust da vista PCB)
//
// O repositorio: NEXOELETRIC_RUST_REPO, senao D:\NexoEletric-rust. Compila em target-casca, e nao no target
// de quem esta desenvolvendo nele: o NexoEletric.exe de la pode estar aberto (o Windows nao deixa trocar).
// Sem o repositorio ou sem o cargo o build PARA: um instalador sem a janela Rust abriria a janela Electron
// calado, e a versao publicada nao seria a que foi pedida. NEXOELETRIC_SEM_RUST=1 gera sem ela, de proposito.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const OUT = path.join(APP, 'build', 'rust');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

if (process.env.NEXOELETRIC_SEM_RUST === '1') {
  fs.writeFileSync(path.join(OUT, 'LEIA.txt'), 'gerado sem a janela Rust (NEXOELETRIC_SEM_RUST=1): o app abre a janela Electron\n');
  console.log('casca-rust: NEXOELETRIC_SEM_RUST=1 — o instalador sai SEM a janela Rust');
  process.exit(0);
}

const REPO = process.env.NEXOELETRIC_RUST_REPO || 'D:\\NexoEletric-rust';
const ALVO = path.join(REPO, 'target-casca');
if (!fs.existsSync(path.join(REPO, 'Cargo.toml'))) {
  console.error(`casca-rust: não achei o NexoEletric-rust em ${REPO} (NEXOELETRIC_RUST_REPO)`);
  process.exit(1);
}
const r = spawnSync('cargo', ['build', '--release', '-p', 'nexoeletric-web'], {
  cwd: REPO, stdio: 'inherit', env: { ...process.env, CARGO_TARGET_DIR: ALVO },
});
if (r.status !== 0) {
  console.error('casca-rust: o cargo build da casca falhou');
  process.exit(r.status || 1);
}
const exe = path.join(ALVO, 'release', 'NexoEletric.exe');
fs.copyFileSync(exe, path.join(OUT, 'NexoEletric.exe'));
const web = path.join(REPO, 'web');
fs.mkdirSync(path.join(OUT, 'web'), { recursive: true });
for (const f of ['nexo-gl.js', 'nexo-gl-worker.js', 'nexo_wasm.wasm']) {
  const de = path.join(web, f);
  if (!fs.existsSync(de)) { console.error(`casca-rust: falta ${de}`); process.exit(1); }
  fs.copyFileSync(de, path.join(OUT, 'web', f));
}
// o commit da casca vai junto, para o "Sobre" e para quem investigar uma instalacao
const g = spawnSync('git', ['-c', 'safe.directory=*', '-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
const commit = (g.stdout || '').trim();
fs.writeFileSync(path.join(OUT, 'casca.json'), JSON.stringify({ repo: REPO, commit, geradoEm: new Date().toISOString() }, null, 2));
console.log(`casca-rust: build/rust pronto (commit ${commit.slice(0, 10) || '?'}, ${(fs.statSync(exe).size / 1048576).toFixed(1)} MB)`);
