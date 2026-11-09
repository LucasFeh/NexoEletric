'use strict';
// O GRAVADOR DA FILA DO CATÁLOGO (1.89.0). Pedido do dono (2026-11-09): "hoje não tá deixando editar se o excel tiver
// sendo usado, isso n pode acontecer, tem que ser assincrono, mais de uma pessoa pode editar ao mesmo tempo".
//
// O cadastro e a edição do catálogo de produtos entram numa fila no NexoBD (mcp/lib/catalogo-fila.js) e respondem na
// hora; quem grava na planilha é este gravador, em TODA máquina com o NexoEletric aberto: a cada 45 s
// (NEXO_GRAVADOR_S) roda `node mcp/lib/catalogo.js --cli` {acao:'fila-gravar'} na pasta de trabalho. O motor decide:
// sem nada pendente ou com a planilha aberta no Excel não faz nada; senão pega a trava da fila (uma máquina por vez,
// com validade) e grava. Fica aqui, no processo do app, e não no hubserver: na janela Rust o Python só sobe quando uma
// rota pede, e a fila precisa andar mesmo com ninguém no Definir projeto.
//
// Desligado: NEXO_GRAVADOR=0 ou NEXO_FILA=0, e nos testes/automação sem um NexoBD de teste (NEXOHUB_URL) -- a mesma
// regra do armazem e do catalogo-fila.js (catálogo de teste NEXO_CATALOGO sem NEXOHUB_URL).
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function desligado(env = process.env) {
  if (env.NEXO_GRAVADOR === '0' || env.NEXO_FILA === '0') return 'NEXO_GRAVADOR/NEXO_FILA=0';
  if ((env.ALTIUMHUB_SMOKE || env.ALTIUMHUB_USERDATA || env.NEXO_CATALOGO) && !env.NEXOHUB_URL) return 'teste/automação sem NEXOHUB_URL';
  return '';
}

function periodo(env = process.env) {
  const s = Number(env.NEXO_GRAVADOR_S);
  return Math.max(3, Number.isFinite(s) && s > 0 ? s : 45) * 1000;
}

class GravadorCatalogo {
  constructor({ log = () => {}, node = process.execPath, env = process.env } = {}) {
    this.log = log; this.node = node; this.env = env;
    this.ws = null; this.timer = null; this.primeira = null; this.rodando = false; this.ultima = null;
  }

  iniciar(ws) {
    const off = desligado(this.env);
    if (off) { this.parar(); return off; }
    if (this.ws === ws && this.timer) return '';
    this.parar();
    this.ws = ws;
    const p = periodo(this.env);
    this.primeira = setTimeout(() => this.rodada(), Math.min(p, 15000));
    this.timer = setInterval(() => this.rodada(), p);
    for (const t of [this.primeira, this.timer]) if (t && t.unref) t.unref();
    return '';
  }

  parar() {
    clearTimeout(this.primeira); clearInterval(this.timer);
    this.primeira = this.timer = null;
  }

  /** uma rodada -> Promise<{...} | null> (o JSON do motor) */
  rodada() {
    const motor = this.ws && path.join(this.ws, 'mcp', 'lib', 'catalogo.js');
    if (this.rodando || !motor || !fs.existsSync(motor)) return Promise.resolve(null);
    this.rodando = true;
    const env = {};
    for (const [k, v] of Object.entries(this.env)) if (!/^PYTHON/i.test(k)) env[k] = v;
    env.ELECTRON_RUN_AS_NODE = '1';
    return new Promise((ok) => {
      const p = execFile(this.node, [motor, '--cli'], { cwd: this.ws, env, timeout: 120000, windowsHide: true, maxBuffer: 4 << 20 }, (err, out, errTxt) => {
        this.rodando = false;
        let r = null;
        try { r = JSON.parse(String(out || '').trim().split('\n').pop()); } catch { r = null; }
        this.ultima = { em: new Date().toISOString(), r };
        if (!r) this.log(`[catalogo] gravador: o motor não respondeu (${String((err && err.message) || errTxt || '').trim().slice(0, 300)})`);
        else if (!r.ok) this.log(`[catalogo] gravador: ${r.erro}`);
        else if (r.gravados || r.conflitos || r.erros) this.log(`[catalogo] fila gravada na planilha: ${r.gravados || 0} gravado(s), ${r.conflitos || 0} conflito(s), ${r.erros || 0} com erro`);
        ok(r);
      });
      p.stdin.end(JSON.stringify({ acao: 'fila-gravar' }));
    });
  }
}

module.exports = { GravadorCatalogo, desligado, periodo };
