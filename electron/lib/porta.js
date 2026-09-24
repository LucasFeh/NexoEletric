'use strict';
// Quem esta escutando numa porta TCP, e se e um hub nosso que ficou para tras.
//
// No Windows o Werkzeug abre o socket com SO_REUSEADDR, e com ele um SEGUNDO hubserver
// consegue escutar na mesma porta sem erro nenhum (medido). Duas consequencias:
//   - o teste "consigo escutar?" do Node nao ve um hub que escuta em 0.0.0.0 quando o
//     teste e em 127.0.0.1;
//   - matar o app pelo Gerenciador de Tarefas deixa o python.exe vivo, segurando a porta
//     e a pasta de trabalho. Na abertura seguinte o app pularia para a porta seguinte, e
//     a origem nova zera tudo o que o hub guarda no localStorage.
// Entao a pergunta e feita ao sistema (netstat), e o dono do socket e identificado.
const { execFile } = require('node:child_process');
const path = require('node:path');

function executa(cmd, args, timeout = 8000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout, maxBuffer: 8 << 20 }, (err, stdout) => {
      resolve(err && !stdout ? '' : String(stdout || ''));
    });
  });
}

// Linhas do `netstat -ano` que sao sockets ESCUTANDO na porta. O estado vem traduzido
// ("LISTENING", "ESCUTANDO", "ABHÖREN"...), entao a regra e o endereco remoto: escutando
// e o unico estado com remoto 0.0.0.0:0 / [::]:0.
function pidsEscutando(saidaNetstat, porta) {
  const pids = new Set();
  for (const linha of saidaNetstat.split(/\r?\n/)) {
    const c = linha.trim().split(/\s+/);
    if (c.length < 5 || c[0].toUpperCase() !== 'TCP') continue;
    const local = c[1];
    const remoto = c[2];
    if (!/^(0\.0\.0\.0:0|\[::\]:0|\*:\*)$/.test(remoto)) continue;
    if (local.slice(local.lastIndexOf(':') + 1) !== String(porta)) continue;
    const pid = Number(c[c.length - 1]);
    if (Number.isInteger(pid) && pid > 0) pids.add(pid);
  }
  return [...pids];
}

async function quemEscuta(porta) {
  if (process.platform !== 'win32') return [];
  return pidsEscutando(await executa('netstat', ['-ano', '-p', 'TCP']), porta)
    .concat(pidsEscutando(await executa('netstat', ['-ano', '-p', 'TCPv6']), porta));
}

async function caminhoDoProcesso(pid) {
  if (process.platform !== 'win32') return '';
  const out = await executa('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    `(Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue).Path`]);
  return out.trim();
}

function vivo(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function mesmoArquivo(a, b) {
  return Boolean(a && b) && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

async function matarArvore(pid) {
  if (process.platform === 'win32') await executa('taskkill', ['/pid', String(pid), '/T', '/F']);
  else try { process.kill(pid, 'SIGKILL'); } catch { /* ja foi */ }
}

module.exports = { pidsEscutando, quemEscuta, caminhoDoProcesso, vivo, mesmoArquivo, matarArvore };
