'use strict';
// A JANELA DO NEXOELETRIC EM RUST (1.54.0). Pedido do dono (2026-10-30): o NexoEletric em Rust
// (repositorio NexoEletric-rust: janela WebView2 do Windows, o servidor do hub em Rust, a vista PCB no
// WebGL com o nucleo Rust em WASM) entra NO LUGAR da janela Electron, com o mesmo atalho e o mesmo icone.
//
// O instalador continua este (o mesmo NexoEletric.exe, appId, atalho, registro no Windows e publicacao no
// NexoBD: o Nexo Hub atualiza como sempre). O que muda e quem desenha: o Electron vira o MOTOR DE FUNDO,
// sem janela -- pasta de trabalho (workspace.js), sincronia com o NexoBD (armazem.js), biblioteca da rede
// (nexohub-sync.js), configuracoes, Conectar IA, Sobre e o runtime do MCP --, e abre a janela Rust que
// mora em resources\rust\NexoEletric.exe. Ela traz o proprio servidor do hub (com o Python embutido de
// reserva, so para as rotas que ficaram nele) e grava o session.json do MCP.
//
// O canal (main.rs do NexoEletric-rust, NEXOELETRIC_MOTOR=1):
//   saida de erro   "[NexoEletric] hub em http://127.0.0.1:PORTA/ ..."  -> a origem do hub
//   saida padrao    "menu:<id>"   o menu que a casca Rust ainda nao tem: o motor abre a tela dele
//   entrada padrao  "focar"       o atalho clicado de novo (segunda instancia)
//                   "toast {texto, tipo, ms}"   um aviso do motor na pagina
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');

const ESPERA_HUB = 30000;      // a casca sobe o servidor antes da janela: medido ~0,1 s
const CEDO = 20000;            // saiu com erro antes disto: a casca nao roda nesta maquina (sem WebView2...)

/** O executavel da casca Rust desta instalacao, ou '' (sem ele o NexoEletric abre a janela Electron). */
function caminhoDaCasca({ empacotado, resourcesPath, env = process.env, existe = fs.existsSync } = {}) {
  const c = env.NEXOELETRIC_RUST_EXE || (empacotado && resourcesPath ? path.join(resourcesPath, 'rust', 'NexoEletric.exe') : '');
  return c && existe(c) ? c : '';
}

/** A casca Rust abre? settings.casca = 'electron' (ou NEXOELETRIC_CASCA=electron) volta a janela Electron. */
function querCasca(s, env = process.env) {
  const v = String(env.NEXOELETRIC_CASCA || (s && s.casca) || 'rust').toLowerCase();
  return v !== 'electron';
}

/** Os argumentos e o ambiente da casca. */
function comando({ ws, porta, python, projeto, aba, env = {}, versao, base = process.env }) {
  const args = ['--workspace', ws];
  if (porta) args.push('--porta', String(porta));
  if (python) args.push('--python', python);
  if (projeto) args.push('--projeto', projeto, '--aba', aba || 'pcb');
  const e = { ...base, ...env, NEXOELETRIC_MOTOR: '1' };
  if (versao) e.NEXOELETRIC_VERSAO = versao;
  // o Electron roda o MCP com ELECTRON_RUN_AS_NODE: herdado, o Python de reserva da casca nao liga, mas
  // nada dela precisa disto -- e um processo filho dela (o Python) nao deve ver
  delete e.ELECTRON_RUN_AS_NODE;
  return { args, env: e };
}

/** A origem do hub na linha de log da casca ("[NexoEletric] hub em http://127.0.0.1:8200/ (pasta ...)"). */
function origemDaLinha(l) {
  const m = /hub em (http:\/\/127\.0\.0\.1:\d+)\//.exec(String(l || ''));
  return m ? m[1] : '';
}

/** O pedido de menu na saida padrao ("menu:configApp"). */
function menuDaLinha(l) {
  const m = /^menu:([A-Za-z0-9_-]{1,40})\s*$/.exec(String(l || '').trim());
  return m ? m[1] : '';
}

class CascaRust extends EventEmitter {
  constructor({ log, logDir } = {}) {
    super();
    this.log = log || console;
    this.logDir = logDir || '';
    this.proc = null;
    this.origem = '';
    this.inicio = 0;
  }

  get viva() { return !!(this.proc && this.proc.exitCode === null && !this.proc.killed); }

  /** Abre a janela. Resolve com a origem do hub quando o servidor dela esta no ar; rejeita se ela nao subiu. */
  iniciar({ exe, ws, porta, python, projeto, aba, env, versao, argsAntes = [] }) {
    const { args: a0, env: e } = comando({ ws, porta, python, projeto, aba, env, versao });
    const args = [...argsAntes, ...a0];   // argsAntes: o script da casca falsa dos testes
    let arq = null;
    if (this.logDir) {
      try { fs.mkdirSync(this.logDir, { recursive: true }); arq = fs.createWriteStream(path.join(this.logDir, 'rust.log'), { flags: 'a' }); }
      catch { arq = null; }
    }
    const escreve = (t) => { if (arq) arq.write(t); };
    escreve(`\n=== ${new Date().toISOString()} ${exe} ${args.join(' ')}\n`);
    this.inicio = Date.now();
    this.origem = '';
    const p = spawn(exe, args, { env: e, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: false });
    this.proc = p;
    return new Promise((resolve, reject) => {
      let feito = false;
      const ok = (o) => { if (!feito) { feito = true; clearTimeout(t); resolve(o); } };
      const falha = (err) => { if (!feito) { feito = true; clearTimeout(t); reject(err); } };
      const t = setTimeout(() => falha(new Error('a janela Rust não abriu o hub em ' + ESPERA_HUB / 1000 + ' s')), ESPERA_HUB);
      const porLinha = (stream, f) => {
        let buf = '';
        stream.setEncoding('utf8');
        stream.on('data', (d) => {
          escreve(d);
          buf += d;
          let i;
          while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1); f(l); }
        });
      };
      porLinha(p.stderr, (l) => {
        const o = origemDaLinha(l);
        if (o && !this.origem) { this.origem = o; ok(o); }
      });
      porLinha(p.stdout, (l) => {
        const m = menuDaLinha(l);
        if (m) this.emit('menu', m);
      });
      p.stdin.on('error', () => { /* a casca fechou */ });
      p.on('error', (err) => { escreve(`erro: ${err.message}\n`); falha(err); });
      p.on('exit', (code, sinal) => {
        escreve(`=== saiu: ${code}${sinal ? ' ' + sinal : ''}\n`);
        const cedo = Date.now() - this.inicio < CEDO;
        if (this.proc === p) this.proc = null;
        falha(new Error(`a janela Rust saiu (código ${code}) antes de abrir o hub`));
        this.emit('exit', { code, sinal, cedo, subiu: !!this.origem });
        if (arq) { arq.end(); arq = null; }
      });
    });
  }

  manda(linha) {
    if (!this.viva) return false;
    try { this.proc.stdin.write(linha + '\n'); return true; } catch { return false; }
  }
  focar() { return this.manda('focar'); }
  toast(texto, tipo = 'info', ms = 8000) { return this.manda('toast ' + JSON.stringify({ texto: String(texto || ''), tipo, ms })); }

  /** Fecha a janela (o motor vai sair, ou vai abri-la de novo com outra configuracao). */
  parar() {
    const p = this.proc;
    if (!p || p.exitCode !== null) return Promise.resolve();
    return new Promise((res) => {
      const t = setTimeout(res, 5000);
      p.once('exit', () => { clearTimeout(t); res(); });
      // /T leva junto o Python de reserva (que tambem morre com o Job Object da casca)
      try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true }); }
      catch { try { p.kill(); } catch { /* ja saiu */ } }
    });
  }
}

module.exports = { CascaRust, caminhoDaCasca, querCasca, comando, origemDaLinha, menuDaLinha, ESPERA_HUB, CEDO };
