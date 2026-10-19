'use strict';
// O NexoEletric na rede "Nexo Hub": publica a biblioteca 3D e as placas no Nexo Hub.
//
// O trabalho e do mcp/lib/nexohub-sync.js da PASTA DE TRABALHO (o mesmo que o MCP roda no
// nexo_sincronizar), num processo Node a parte (o proprio Electron com ELECTRON_RUN_AS_NODE):
// a primeira vez sobe ~650 modelos e monta a placa de cada projeto, e nada disso pode travar a
// janela. Daqui saem so a agenda e o estado:
//   - roda depois que o hub sobe (precisa dele: o 3D da PcbLib sai do hubserver sob demanda);
//   - de novo quando Libs/pcblib-hub.js, Libs/pcblib-3d.js ou Libs/3d-hub/ mudam (modelos) e
//     quando Projects/<p>/board.js ou changes.js mudam (so aquela placa), com espera de 4 s;
//   - a cada minuto olha se os componentes do Nexo Hub mudaram (o NexoCAD criou ou editou um):
//     mudou, roda so a parte "componentes" (entram na biblioteca de footprints, Libs/pcblib-hub.js);
//   - um processo por vez; o que chegar durante entra no proximo;
//   - Nexo Hub fora do ar: tenta de novo a cada 2 min, calado (o log diz).
// A conexao e a do contrato (NEXOHUB_URL > C:\Users\Public\NexoHub\conexao.json > 127.0.0.1:47800),
// lida pelo cliente oficial (nexohub-cliente.mjs, copiado do repositorio nexohub), que tambem
// marca presenca (POST /clientes/ping).
//
// Desligado com NEXOHUB_DESLIGADO=1, e nos testes/automacao do app (ALTIUMHUB_SMOKE ou
// ALTIUMHUB_USERDATA) a menos que NEXOHUB_URL diga para onde: um teste nunca publica no Nexo Hub
// de verdade desta maquina.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const ESPERA = 4000;
const RETENTA = 120000;
const PRIMEIRA = 3000;
const OLHA_COMPONENTES = 60000;

function desligado(env = process.env) {
  if (env.NEXOHUB_DESLIGADO === '1') return 'NEXOHUB_DESLIGADO=1';
  if ((env.ALTIUMHUB_SMOKE || env.ALTIUMHUB_USERDATA) && !env.NEXOHUB_URL) return 'teste/automação sem NEXOHUB_URL';
  return '';
}

let cliente = null;
async function clienteOficial() {
  if (!cliente) cliente = import(pathToFileURL(path.join(__dirname, 'nexohub-cliente.mjs')).href).catch(() => null);
  return cliente;
}

class NexoHubSync {
  constructor({ log, execPath, versao } = {}) {
    this.log = log || console;
    this.execPath = execPath || process.execPath;
    this.versao = versao || '';
    this.ws = '';
    this.hubUrl = '';
    this.filho = null;
    this.vigias = [];
    this.timer = null;
    this.retenta = null;
    this.pend = { modelos: false, placas: new Set(), tudo: false, componentes: false };
    this.olha = null;
    this.marcaComponentes = '';
    this.est = { fase: 'parado', url: '', erro: '', ultimo: '', resumo: null, progresso: null, motivo: desligado() };
    this.parado = false;
  }

  status() { return { ...this.est }; }

  // Depois de cada subida do hub (a porta pode ter mudado). A primeira roda inteira.
  iniciar(ws, hubUrl) {
    if (this.est.motivo) { this.log.info(`[nexohub] sincronização desligada (${this.est.motivo})`); return; }
    this.parado = false;
    const outra = ws !== this.ws;
    this.ws = ws;
    this.hubUrl = hubUrl;
    if (outra) { this.vigiar(); this.agendar({ tudo: true }, PRIMEIRA); }
    if (!this.olha) this.olha = setInterval(() => this.olharComponentes(), OLHA_COMPONENTES);
    this.conexao().then((c) => { this.est.url = c.url; }).catch(() => {});
  }

  async conexao() {
    const m = await clienteOficial();
    if (m && m.conexao) return m.conexao();
    return { url: process.env.NEXOHUB_URL || 'http://127.0.0.1:47800', token: process.env.NEXOHUB_TOKEN || '' };
  }

  script() { return path.join(this.ws, 'mcp', 'lib', 'nexohub-sync.js'); }

  vigiar() {
    for (const v of this.vigias) { try { v.close(); } catch { /* ja fechado */ } }
    this.vigias = [];
    const vigia = (dir, opcoes, f) => {
      try {
        if (!fs.existsSync(dir)) return;
        const w = fs.watch(dir, opcoes, (_ev, nome) => { try { f(String(nome || '')); } catch (e) { this.log.warn('[nexohub] vigia: ' + e.message); } });
        w.on('error', () => {});
        this.vigias.push(w);
      } catch (e) { this.log.warn(`[nexohub] não consegui vigiar ${dir}: ${e.message}`); }
    };
    const libs = path.join(this.ws, 'Libs');
    vigia(libs, {}, (n) => { if (/^pcblib-(hub|3d)\.js$/i.test(n)) this.agendar({ modelos: true }); });
    vigia(path.join(libs, '3d-hub'), {}, (n) => { if (/\.(step|stp)$/i.test(n)) this.agendar({ modelos: true }); });
    vigia(path.join(this.ws, 'Projects'), { recursive: true }, (n) => {
      const partes = n.split(/[\\/]/);
      if (partes.length === 2 && /^(board|changes|board3d)\.js$/i.test(partes[1])) this.agendar({ placa: partes[0] });
    });
  }

  // os componentes do Nexo Hub mudaram desde a ultima olhada? (uma consulta pequena, sem processo)
  async olharComponentes() {
    if (this.parado || this.est.motivo || !this.ws || this.filho) return;
    try {
      const c = await this.conexao();
      const r = await fetch(c.url.replace(/\/+$/, '') + '/api/v1/itens?tipo=componente&limite=200',
        { headers: c.token ? { Authorization: 'Bearer ' + c.token } : {}, signal: AbortSignal.timeout(5000) });
      if (!r.ok) return;
      const j = await r.json();
      const marca = (j.itens || []).map((it) => `${it.id}:${it.rev != null ? it.rev : it.rev_atual}:${((it.atributos || {}).footprints || []).join(',')}`).sort().join('|') + '#' + (j.total || 0);
      if (this.marcaComponentes && marca !== this.marcaComponentes) this.agendar({ componentes: true }, 0);
      this.marcaComponentes = marca;
    } catch { /* fora do ar: a rodada normal cuida */ }
  }

  agendar(o, ms = ESPERA) {
    if (this.parado || this.est.motivo || !this.ws) return;
    if (o.tudo) this.pend.tudo = true;
    if (o.modelos) this.pend.modelos = true;
    if (o.placa) this.pend.placas.add(o.placa);
    if (o.componentes) this.pend.componentes = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.rodar(), ms);
  }

  // Arquivo › Nexo Hub: sincronizar agora. Devolve quando terminar.
  agora() {
    if (this.est.motivo) return Promise.resolve({ ok: false, erro: 'desligada: ' + this.est.motivo });
    this.pend.tudo = true;
    clearTimeout(this.timer);
    return new Promise((ok) => { this.aoFim = ok; this.rodar(); });
  }

  rodar() {
    if (this.filho || this.parado) return;
    const p = this.pend;
    if (!p.tudo && !p.modelos && !p.placas.size && !p.componentes) return;
    this.pend = { modelos: false, placas: new Set(), tudo: false, componentes: false };
    const script = this.script();
    if (!fs.existsSync(script)) {
      this.est = { ...this.est, fase: 'erro', erro: 'a pasta de trabalho não tem mcp/lib/nexohub-sync.js (hub antigo)' };
      return;
    }
    const args = [script, '--root', this.ws];
    if (this.hubUrl) args.push('--hub', this.hubUrl);
    if (!p.tudo && !p.modelos) args.push('--sem-modelos');
    if (!p.tudo && p.placas.size) args.push('--placas', [...p.placas].join('|'));
    else if (!p.tudo) args.push('--sem-placas');
    this.est = { ...this.est, fase: 'sincronizando', erro: '', progresso: null };
    this.log.info(`[nexohub] sincronizando: ${p.tudo ? 'tudo' : [p.componentes ? 'componentes do NexoCAD' : '', p.modelos ? 'modelos' : '', p.placas.size ? 'placas ' + [...p.placas].join(', ') : ''].filter(Boolean).join(' + ')}`);
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
    let filho;
    try {
      filho = spawn(this.execPath, args, { cwd: this.ws, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      this.est = { ...this.est, fase: 'erro', erro: e.message };
      return;
    }
    this.filho = filho;
    let resto = '', fim = null, erros = '';
    filho.stdout.on('data', (d) => {
      resto += d;
      let i;
      while ((i = resto.indexOf('\n')) >= 0) {
        const linha = resto.slice(0, i).trim();
        resto = resto.slice(i + 1);
        if (!linha) continue;
        let ev;
        try { ev = JSON.parse(linha); } catch { this.log.info('[nexohub] ' + linha); continue; }
        if (ev.ev === 'log') (ev.nivel === 'warn' ? this.log.warn : this.log.info).call(this.log, '[nexohub] ' + ev.msg);
        else if (ev.ev === 'progresso') this.est.progresso = { fase: ev.fase, feitos: ev.feitos, total: ev.total };
        else if (ev.ev === 'fim') fim = ev;
      }
    });
    filho.stderr.on('data', (d) => { erros = (erros + d).slice(-4000); });
    filho.on('exit', (code) => {
      this.filho = null;
      const quando = new Date().toISOString();
      if (fim && fim.ok) {
        this.est = { ...this.est, fase: 'ok', erro: '', ultimo: quando, resumo: fim.resumo, progresso: null, url: (fim.resumo && fim.resumo.nexohub) || this.est.url };
        const m = fim.resumo.modelos, pl = fim.resumo.placas, co = fim.resumo.componentes;
        if (co && co.adicionados && co.adicionados.length) this.log.info(`[nexohub] componentes do NexoCAD na biblioteca de footprints: ${co.adicionados.map((a) => a.footprint).join(', ')}`);
        this.log.info(`[nexohub] pronto: ${m ? `${m.total} modelos (${m.enviados} enviados, ${m.falhas.length} falhas)` : 'modelos —'}; ` +
          `${pl ? `${pl.total} placas (${pl.publicadas} revisões novas, ${pl.falhas.length} falhas)` : 'placas —'}`);
        this.ping();
      } else {
        const offline = code === 3 || (fim && fim.offline);
        this.est = { ...this.est, fase: offline ? 'offline' : 'erro', erro: (fim && fim.erro) || erros.trim().split('\n').slice(-3).join(' ') || `código ${code}`, progresso: null };
        (offline ? this.log.info : this.log.warn).call(this.log, `[nexohub] ${offline ? 'fora do ar' : 'falhou'}: ${this.est.erro}`);
        // o que nao foi agora vai na proxima: fora do ar, tudo de novo daqui a 2 min
        // (erro de outro tipo: o mesmo pedido, tambem daqui a 2 min, para nao rodar em laco)
        clearTimeout(this.retenta);
        this.retenta = setTimeout(() => this.agendar(offline ? { tudo: true } : { tudo: p.tudo, modelos: p.modelos }, 0), RETENTA);
        if (!offline) for (const n of p.placas) this.pend.placas.add(n);
      }
      const cb = this.aoFim; this.aoFim = null;
      if (cb) cb({ ok: this.est.fase === 'ok', erro: this.est.erro, resumo: this.est.resumo });
      // o que chegou durante este processo
      if (this.est.fase === 'ok' && (this.pend.tudo || this.pend.modelos || this.pend.placas.size || this.pend.componentes)) this.agendar({}, ESPERA);
    });
  }

  async ping() {
    try {
      const m = await clienteOficial();
      if (!m || !m.criarCliente) return;
      const c = m.criarCliente({ app: 'nexoeletric' });
      await c.ping({ versao: this.versao });
    } catch { /* presenca e so informativa */ }
  }

  parar() {
    this.parado = true;
    clearTimeout(this.timer);
    clearTimeout(this.retenta);
    clearInterval(this.olha); this.olha = null;
    for (const v of this.vigias) { try { v.close(); } catch { /* */ } }
    this.vigias = [];
    if (this.filho) { try { this.filho.kill(); } catch { /* */ } }
  }

  // uma linha para o Ajuda › Sobre
  resumoTexto() {
    const s = this.est;
    if (s.motivo) return `desligado (${s.motivo})`;
    const onde = s.url || '?';
    if (s.fase === 'sincronizando') return `${onde} — sincronizando${s.progresso ? ` (${s.progresso.fase} ${s.progresso.feitos}/${s.progresso.total})` : '…'}`;
    if (s.fase === 'ok') {
      const m = s.resumo && s.resumo.modelos, p = s.resumo && s.resumo.placas;
      return `${onde} — sincronizado ${s.ultimo.slice(0, 16).replace('T', ' ')} UTC` +
        (m ? ` · ${m.total} modelos` : '') + (p ? ` · ${p.total} placas` : '');
    }
    if (s.fase === 'offline') return `${onde} — fora do ar (tenta de novo a cada 2 min)`;
    if (s.fase === 'erro') return `${onde} — erro: ${s.erro}`;
    return `${onde} — aguardando o hub`;
  }
}

module.exports = { NexoHubSync, desligado };
