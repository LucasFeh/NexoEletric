'use strict';
// O NexoEletric nao guarda nada (1.14.0): projetos, biblioteca e os scripts do Altium moram no NexoBD, pelo Nexo
// Hub desta maquina. A pasta de trabalho continua existindo, mas como COPIA: o hubserver, as vistas, o MCP e o
// sincronismo do Odoo leem e gravam arquivos ali, e este modulo mantem a copia igual ao NexoBD.
//   Projects/<projeto>/  ⇄ um item 'projeto' por pasta (fora do catalogo; so o NexoEletric mostra)
//   Libs/                ⇄ o item "Biblioteca do NexoEletric" (simbolos, footprints e o almoxarifado do Odoo)
//   scripts do Altium    → o item "Scripts do Altium" (os do instalador; o Nexo Hub os poe na pasta do Altium dele)
// O trabalho e do electron/lib/espelho-nexobd.mjs (copia do cliente/ do repositorio nexohub, o mesmo que o Hub usa).
// Pasta apagada nao apaga nada: volta do NexoBD. Projeto apagado no hub (senha mestre) vai para o Trash/ e o hubserver
// anota em .altiumhub/nexobd-apagar.json; a rodada seguinte o apaga no NexoBD.
//
// Roda: antes de o hub abrir (a primeira, com espera curta), quando Projects/ ou Libs/ mudam (3 s depois), quando um
// item nosso muda no NexoBD (o Altium exportou pela pasta do Hub), a cada 2 min, e antes do sincronismo do Odoo.
// Desligado: numa pasta de desenvolvedor (git), com settings.nexobd === false e nos testes sem NEXOHUB_URL.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ESPERA = 3000;
const ESPERA_EVENTO = 1500;
const PERIODO = 120000;
const APP = 'nexoeletric';

// Os scripts do Altium que vao para o NexoBD (do instalador, a pasta resources/hub). AI-GUIDE.md e a marca que o
// HubHome dos .pas procura para aceitar a pasta.
const SCRIPTS = ['AltiumPCBMirror.PrjScr', 'ExportProject.pas', 'ExportBoard.pas', 'BuildSchematic.pas', 'ApplyChanges.pas', 'AI-GUIDE.md'];

// Fora da biblioteca: o cache dos STEP extraidos da PcbLib (refeito sob demanda pelo hubserver).
function aceitaLib(rel) {
  return !/^3d(\/|$)/i.test(rel) && rel !== 'pcblib-3d.js';
}

const ARQ_ESTADO = (ws) => path.join(ws, '.altiumhub', 'nexobd.json');
const ARQ_APAGAR = (ws) => path.join(ws, '.altiumhub', 'nexobd-apagar.json');
const CONFLITOS = (ws) => path.join(ws, '.altiumhub', 'conflitos-nexobd');

function desligado(env = process.env) {
  if (env.NEXOHUB_DESLIGADO === '1') return 'NEXOHUB_DESLIGADO=1';
  if ((env.ALTIUMHUB_SMOKE || env.ALTIUMHUB_USERDATA) && !env.NEXOHUB_URL) return 'teste/automação sem NEXOHUB_URL';
  return '';
}

/** O armazem vale para esta pasta? (as configuracoes e a pasta de desenvolvedor decidem; o ambiente tambem) */
function ligado(s, ehDev, env = process.env) {
  return Boolean(s) && s.nexobd !== false && !ehDev && !desligado(env);
}

let mods = null;
function modulos() {
  if (!mods) {
    mods = Promise.all([
      import(pathToFileURL(path.join(__dirname, 'nexohub-cliente.mjs')).href),
      import(pathToFileURL(path.join(__dirname, 'espelho-nexobd.mjs')).href),
    ]).then(([cliente, espelho]) => ({ cliente, espelho }));
  }
  return mods;
}

function lerJson(arq, padrao) {
  try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return padrao; }
}

/**
 * Uma rodada (sem agenda; os testes chamam direto).
 * op: {ws, bundle (a pasta com os scripts do instalador, ou ''), cliente, estado, log}
 * → {scripts, biblioteca, projetos}
 */
async function rodada({ ws, bundle, cliente, estado, log = () => {}, scripts = true }) {
  const { espelho } = await modulos();
  await espelho.garantirCategoriaInterna(cliente);
  const conflitos = CONFLITOS(ws);
  let rScripts = null;
  if (scripts && bundle && fs.existsSync(path.join(bundle, 'ExportProject.pas'))) {
    const so = new Set(SCRIPTS);
    rScripts = await espelho.espelhar({ cliente, pasta: bundle, alvo: espelho.ALVO_SCRIPTS, estado: (estado.scripts ??= {}), modo: 'subir', aceita: (rel) => so.has(rel), app: APP, log, nota: 'scripts do instalador do NexoEletric' });
  }
  const biblioteca = await espelho.espelharComRetentativa({
    cliente, pasta: path.join(ws, 'Libs'), alvo: espelho.ALVO_BIBLIOTECA, estado: (estado.biblioteca ??= {}),
    modo: 'ambos', aceita: aceitaLib, conflitos: path.join(conflitos, 'Libs'), app: APP, log, nota: 'NexoEletric',
  });
  // os projetos que o hub mandou para a lixeira: apagar no NexoBD (a lista so sai do arquivo depois de feito)
  const apagar = lerJson(ARQ_APAGAR(ws), []).filter((n) => typeof n === 'string');
  const projetos = await espelho.espelharProjetos({
    cliente, raiz: path.join(ws, 'Projects'), estado: (estado.projetos ??= {}), modo: 'ambos', apagar,
    lixeira: path.join(ws, 'Trash'), conflitos, app: APP, log, nota: 'NexoEletric',
  });
  if (apagar.length) {
    const resto = lerJson(ARQ_APAGAR(ws), []).filter((n) => !apagar.includes(n));
    if (resto.length) fs.writeFileSync(ARQ_APAGAR(ws), JSON.stringify(resto)); else fs.rmSync(ARQ_APAGAR(ws), { force: true });
  }
  return { scripts: rScripts, biblioteca, projetos };
}

class Armazem {
  constructor({ log, bundle } = {}) {
    this.log = log || console;
    this.bundle = bundle || '';
    this.ws = '';
    this.estado = null;
    this.rodando = null;
    this.pendente = false;
    this.timer = null;
    this.periodo = null;
    this.vigias = [];
    this.ouvinte = null;
    this.nossos = new Set();
    this.scriptsFeitos = false;
    this.est = { fase: 'parado', erro: '', ultimo: '', resumo: null, url: '' };
  }

  status() { return { ...this.est }; }

  resumoTexto() {
    const e = this.est;
    if (e.fase === 'parado') return 'desligado';
    if (e.fase === 'erro') return `erro: ${e.erro}`;
    const r = e.resumo;
    return r ? `${r.projetos} projeto(s), biblioteca ${r.biblioteca}${e.ultimo ? ` · em dia às ${new Date(e.ultimo).toLocaleTimeString('pt-BR')}` : ''}` : e.fase;
  }

  /** Liga para a pasta de trabalho. Devolve a primeira rodada (quem chama decide quanto espera por ela). */
  iniciar(ws) {
    if (this.ws !== ws) {
      this.parar();
      this.ws = ws;
      this.estado = lerJson(ARQ_ESTADO(ws), {});
      this.vigiar();
      this.periodo = setInterval(() => this.agora('periódica'), PERIODO);
    }
    return this.agora('abertura');
  }

  parar() {
    clearTimeout(this.timer); this.timer = null;
    clearInterval(this.periodo); this.periodo = null;
    for (const v of this.vigias) { try { v.close(); } catch { /* ja fechado */ } }
    this.vigias = [];
    if (this.ouvinte) { this.ouvinte.fechar(); this.ouvinte = null; }
    this.ws = '';
    this.est.fase = 'parado';
  }

  agendar(ms, motivo) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.agora(motivo).catch(() => {}); }, ms);
  }

  /** Uma rodada ja (ou a que esta em curso + uma depois dela). → {ok, erro?, resumo} */
  async agora(motivo = 'pedido') {
    if (!this.ws) return { ok: false, erro: 'armazém desligado' };
    if (this.rodando) { this.pendente = true; return this.rodando; }
    const ws = this.ws;
    this.est.fase = 'sincronizando';
    this.rodando = (async () => {
      try {
        const { cliente: c } = await modulos();
        const cliente = c.criarCliente({ app: APP });
        this.est.url = (await cliente.conexao()).url;
        const log = (l) => this.log.info(`[nexobd] ${l}`);
        const r = await rodada({ ws, bundle: this.bundle, cliente, estado: this.estado, log, scripts: !this.scriptsFeitos });
        if (r.scripts) this.scriptsFeitos = true;
        fs.mkdirSync(path.dirname(ARQ_ESTADO(ws)), { recursive: true });
        const tmp = ARQ_ESTADO(ws) + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(this.estado));
        fs.renameSync(tmp, ARQ_ESTADO(ws));
        const proj = Object.values(r.projetos.projetos);
        for (const x of [r.biblioteca.item, r.scripts && r.scripts.item, ...proj.map((p) => p.item)]) if (x) this.nossos.add(x);
        const todos = [r.biblioteca, ...proj];
        this.est.resumo = {
          projetos: proj.length,
          biblioteca: r.biblioteca.item ? `rev ${r.biblioteca.rev}` : 'vazia',
          scripts: r.scripts ? `rev ${r.scripts.rev}` : '',
          baixados: todos.reduce((a, x) => a + x.baixados.length, 0),
          subidos: todos.reduce((a, x) => a + x.subidos.length, 0),
          conflitos: todos.flatMap((x) => x.conflitos),
          erros: r.projetos.erros,
          falhas: todos.flatMap((x) => x.falhas),
        };
        for (const e of r.projetos.erros) this.log.warn(`[nexobd] ${e.nome}: ${e.erro}`);
        for (const f of this.est.resumo.falhas) this.log.warn(`[nexobd] ${f.rel}: ${f.erro}`);
        for (const x of this.est.resumo.conflitos) this.log.warn(`[nexobd] conflito em ${x.rel}: a versão do NexoBD ficou em ${x.guardado}`);
        if (this.est.resumo.baixados || this.est.resumo.subidos) {
          this.log.info(`[nexobd] ${motivo}: ${this.est.resumo.baixados} arquivo(s) baixado(s), ${this.est.resumo.subidos} subido(s)`);
        }
        this.est.fase = 'em dia'; this.est.erro = ''; this.est.ultimo = new Date().toISOString();
        this.ouvir(cliente);
        return { ok: true, resumo: this.est.resumo };
      } catch (err) {
        this.est.fase = 'erro'; this.est.erro = err.message;
        this.log.warn(`[nexobd] ${motivo}: ${err.message}`);
        return { ok: false, erro: err.message };
      } finally {
        this.rodando = null;
        if (this.pendente && this.ws) { this.pendente = false; this.agendar(500, 'pendente'); }
      }
    })();
    return this.rodando;
  }

  // Projects/ e Libs/ mudaram (o hub salvou, o sincronismo do Odoo escreveu, o MCP editou): espera assentar.
  vigiar() {
    for (const sub of ['Projects', 'Libs']) {
      const raiz = path.join(this.ws, sub);
      try {
        fs.mkdirSync(raiz, { recursive: true });
        const v = fs.watch(raiz, { recursive: true }, (_t, nome) => {
          const n = String(nome || '').replace(/\\/g, '/');
          if (/(^|\/)[.~]|\.tmp$/i.test(n)) return;                // temporarios e travas
          if (sub === 'Libs' && !aceitaLib(n)) return;              // cache do 3D
          this.agendar(ESPERA, `${sub} mudou`);
        });
        v.on('error', () => {});
        this.vigias.push(v);
      } catch (e) {
        this.log.warn(`[nexobd] sem vigia em ${raiz}: ${e.message}`);
      }
    }
  }

  // Um item nosso mudou no NexoBD por outro programa (a pasta do Altium no Nexo Hub, outra maquina).
  ouvir(cliente) {
    if (this.ouvinte) return;
    this.ouvinte = cliente.eventos(null, (ev) => {
      if (!ev || !ev.tipo || ev.app === APP) return;
      const nosso = ev.tipo.startsWith('item.') ? this.nossos.has(ev.item_id) || (ev.dados && ev.dados.tipo === 'projeto')
        : ev.tipo === 'chave' && ev.dados && /^nexoeletric-(projeto|biblioteca)$/.test(ev.dados.sistema);
      if (nosso) this.agendar(ESPERA_EVENTO, 'NexoBD mudou');
    });
  }
}

module.exports = { Armazem, rodada, ligado, desligado, aceitaLib, SCRIPTS, ARQ_APAGAR, ARQ_ESTADO };
