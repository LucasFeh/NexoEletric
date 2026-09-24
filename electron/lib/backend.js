'use strict';
// O hub em si: `python hubserver.py --port N --host H`, com o Python embutido no app e
// cwd na pasta de trabalho. E o mesmo comando do servidor (tools/deploy/compose.yml) --
// o app so troca quem o sobe e quem o derruba.
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const porta = require('./porta');

const LOG_MAX = 4 * 1024 * 1024;       // hub.log gira ao passar disto
const TAIL_MAX = 400;                  // linhas guardadas para a tela de erro

class Backend extends EventEmitter {
  constructor({ python, workspace, logDir, pidFile, env = {} }) {
    super();
    this.python = python;
    this.workspace = workspace;
    this.extraEnv = env;
    this.logFile = path.join(logDir, 'hub.log');
    this.pidFile = pidFile || path.join(logDir, 'hub.pid');
    this.proc = null;
    this.port = 0;
    this.host = '127.0.0.1';
    this.tail = [];
    this.parando = false;
    fs.mkdirSync(logDir, { recursive: true });
  }

  _log(linha) {
    const l = String(linha).replace(/\r/g, '');
    this.tail.push(l);
    if (this.tail.length > TAIL_MAX) this.tail.splice(0, this.tail.length - TAIL_MAX);
    try {
      const st = fs.statSync(this.logFile);
      if (st.size > LOG_MAX) fs.renameSync(this.logFile, this.logFile + '.1');
    } catch { /* primeiro log */ }
    try {
      fs.appendFileSync(this.logFile, `[${new Date().toISOString()}] ${l}\n`);
    } catch { /* log nao pode derrubar o hub */ }
    this.emit('log', l);
  }

  // Um hub desta instalacao que sobreviveu ao app (Gerenciador de Tarefas, queda): ele
  // segura a porta e continua escrevendo na pasta de trabalho. Sai antes de tudo.
  async _encerraOrfao() {
    let ant = null;
    try { ant = JSON.parse(fs.readFileSync(this.pidFile, 'utf8')); } catch { return; }
    if (ant && ant.pid && porta.vivo(ant.pid) &&
        porta.mesmoArquivo(await porta.caminhoDoProcesso(ant.pid), this.python)) {
      this._log(`encerrando o hub que ficou de uma sessao anterior (pid ${ant.pid}, porta ${ant.port})`);
      await porta.matarArvore(ant.pid);
    }
    try { fs.rmSync(this.pidFile, { force: true }); } catch { /* segue */ }
  }

  // A porta preferida, a menos que outro PROGRAMA esteja nela. Se quem escuta e o nosso
  // python.exe (orfao sem pid gravado), ele sai; se e outro programa, tenta a seguinte.
  async _escolhePorta(preferida, host) {
    for (let p = preferida; p < preferida + 30; p++) {
      let donos = await porta.quemEscuta(p);
      for (const pid of donos) {
        if (porta.mesmoArquivo(await porta.caminhoDoProcesso(pid), this.python)) {
          this._log(`a porta ${p} estava com um hub orfao deste app (pid ${pid}): encerrado`);
          await porta.matarArvore(pid);
        }
      }
      if (donos.length) donos = await porta.quemEscuta(p);
      if (donos.length) {
        this._log(`porta ${p} ocupada por outro programa (pid ${donos.join(', ')})`);
        continue;
      }
      const livre = await new Promise((resolve) => {
        const s = net.createServer();
        s.once('error', () => resolve(false));
        s.listen({ port: p, host }, () => s.close(() => resolve(true)));
      });
      if (livre) return p;
    }
    throw new Error(`nenhuma porta livre entre ${preferida} e ${preferida + 29}`);
  }

  async start({ port, lan }) {
    if (this.proc) return this.port;
    if (!fs.existsSync(this.python)) throw new Error('Python do app nao encontrado: ' + this.python);
    const hub = path.join(this.workspace, 'hubserver.py');
    if (!fs.existsSync(hub)) throw new Error('hubserver.py nao esta na pasta de trabalho: ' + this.workspace);

    await this._encerraOrfao();
    this.host = lan ? '0.0.0.0' : '127.0.0.1';
    this.port = await this._escolhePorta(port, this.host);
    if (this.port !== port) this._log(`porta ${port} ocupada; usando ${this.port}`);

    // Ambiente limpo: nenhuma PYTHON* do usuario entra. Sem o ._pth o runtime obedece a
    // todas (tools/../fetch-python.mjs), e uma PYTHONSAFEPATH=1 perdida tira a pasta do
    // script do sys.path -- o envio da lista ao Odoo some calado (hubserver.py importa
    // odoolista_server dali).
    const env = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (!/^PYTHON/i.test(k) && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
    }
    Object.assign(env, {
      PYTHONNOUSERSITE: '1',
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      PYTHONUNBUFFERED: '1',
      ALTIUMHUB_DESKTOP: '1',
    }, this.extraEnv);

    this.parando = false;
    this._log(`subindo o hub: ${this.python} hubserver.py --port ${this.port} --host ${this.host}  (cwd ${this.workspace})`);
    // windowsHide com nenhum stdio herdado: o libuv sobe o Python com CREATE_NO_WINDOW, um
    // console SEM janela que os filhos dele herdam. Medido (Electron 44, 2026-09-24): os
    // workers do sincronismo e os netos deles saem sem janela nenhuma. NAO force
    // creationflags=CREATE_NO_WINDOW nos filhos: com isso o neto que herda o stdout do pai
    // perde a saida (o stream chega vazio).
    const proc = spawn(this.python, [hub, '--port', String(this.port), '--host', this.host], {
      cwd: this.workspace,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.proc = proc;
    try {
      fs.writeFileSync(this.pidFile, JSON.stringify({
        pid: proc.pid, port: this.port, python: this.python, workspace: this.workspace, desde: new Date().toISOString(),
      }));
    } catch { /* sem pid gravado o proximo inicio acha o orfao pela porta */ }
    // O Werkzeug escreve uma linha por requisicao no stderr: le sem parar, senao o pipe
    // enche e o hub congela.
    const linhas = (stream) => {
      let resto = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        const partes = (resto + chunk).split('\n');
        resto = partes.pop();
        for (const p of partes) if (p.trim()) this._log(p);
      });
      stream.on('end', () => { if (resto.trim()) this._log(resto); });
    };
    linhas(proc.stdout);
    linhas(proc.stderr);
    proc.on('exit', (code, signal) => {
      this._log(`hub terminou (codigo ${code}${signal ? ', sinal ' + signal : ''})`);
      const esperado = this.parando;
      if (this.proc === proc) this.proc = null;
      try { fs.rmSync(this.pidFile, { force: true }); } catch { /* segue */ }
      this.emit('exit', { code, signal, esperado });
    });
    proc.on('error', (e) => this._log('falha ao iniciar o Python: ' + e.message));

    try {
      await this._esperaNoAr(proc, 60000);
    } catch (e) {
      // Nada de python mudo para tras: ele seguraria a porta e a pasta de trabalho, e o
      // proximo "Tentar de novo" subiria um segundo hub ao lado dele.
      await this.stop();
      throw e;
    }
    this._log(`hub no ar em ${this.url()}`);
    return this.port;
  }

  url() {
    return `http://127.0.0.1:${this.port}`;
  }

  // /__live.js e o batimento do proprio hub: devolve constante, nao toca disco
  // (tools/deploy/compose.yml usa o mesmo no healthcheck).
  _esperaNoAr(proc, timeoutMs) {
    const fim = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
      const tenta = () => {
        if (proc.exitCode !== null || this.proc !== proc) {
          reject(new Error('o hub terminou antes de responder — veja o log'));
          return;
        }
        const req = http.get({ host: '127.0.0.1', port: this.port, path: '/__live.js', timeout: 2000 }, (res) => {
          res.resume();
          if (res.statusCode === 200) resolve();
          else setTimeout(tenta, 300);
        });
        req.on('error', () => {
          if (Date.now() > fim) reject(new Error(`o hub nao respondeu em ${timeoutMs / 1000} s`));
          else setTimeout(tenta, 300);
        });
        req.on('timeout', () => req.destroy());
      };
      tenta();
    });
  }

  // Derruba o hub E os filhos dele (sincronismo do almoxarifado, claude do chat): no
  // Windows um kill no pai deixa os netos vivos, segurando arquivos da pasta de trabalho
  // -- e o instalador da atualizacao nao consegue trocar nada que esteja aberto.
  stop() {
    const proc = this.proc;
    if (!proc) return Promise.resolve();
    this.parando = true;
    return new Promise((resolve) => {
      const pronto = setTimeout(resolve, 5000);
      proc.once('exit', () => { clearTimeout(pronto); resolve(); });
      porta.matarArvore(proc.pid);
    });
  }
}

module.exports = { Backend };
