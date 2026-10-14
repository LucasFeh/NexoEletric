/* EletricHUB MCP - registro.js
   O REGISTRO de ferramentas. Cada arquivo de mcp/ferramentas/*.js e um GRUPO:

     module.exports = {
       grupo: 'pcb',                       // prefixo/nome curto do grupo
       titulo: 'PCB — placa (board.js + changes.js)',
       modulos: ['hub-core.js'],           // opcional: de que arquivos do hub o grupo depende
       ferramentas: [{
         nome: 'pcb_mover',                // unico; snake_case com o prefixo do grupo
         titulo: 'Mover componente',
         descricao: 'pt-BR: o que faz e QUANDO usar (o fluxo)',
         entrada: { type:'object', properties:{...}, required:[...] },   // JSON Schema
         leitura: true,                    // nao grava nada (readOnlyHint)
         destrutiva: false,                // apaga/sobrescreve algo do usuario (destructiveHint)
         modulo: 'hub-pcbdrc.js',          // opcional: arquivo do hub sem o qual ela nao roda
         executa: async (args, ctx) => resultado   // objeto; {_imagem:{base64,mime}} vira imagem
       }]
     };

   Acrescentar ferramenta de um modulo novo = um arquivo novo nesta pasta (ou mais um item num
   grupo que ja existe). O nucleo (protocolo, transporte) nao muda. A pasta e lida na partida;
   `recarregar()` le de novo (a ferramenta hub_recarregar_ferramentas chama). */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const NOME_OK = /^[a-z][a-z0-9_]{1,63}$/;

class Registro {
  constructor(pastas) {
    this.pastas = pastas || [path.join(__dirname, '..', 'ferramentas')];
    this.grupos = [];
    this.porNome = new Map();
    this.erros = [];
  }
  carregar() {
    this.grupos = []; this.porNome = new Map(); this.erros = [];
    for (const pasta of this.pastas) {
      let arqs = [];
      try { arqs = fs.readdirSync(pasta).filter(f => f.endsWith('.js')).sort(); } catch (_) { continue; }
      for (const f of arqs) {
        const abs = path.join(pasta, f);
        try {
          delete require.cache[require.resolve(abs)];
          this.registra(require(abs), f);
        } catch (e) {
          this.erros.push(`${f}: ${e && e.message || e}`);
        }
      }
    }
    return this;
  }
  /* tambem serve para registrar em codigo (testes, integrador) */
  registra(g, origem) {
    if (!g || typeof g.grupo !== 'string' || !Array.isArray(g.ferramentas)) throw new Error('grupo inválido (falta grupo/ferramentas)');
    const grupo = { grupo: g.grupo, ordem: isFinite(g.ordem) ? g.ordem : 50, titulo: g.titulo || g.grupo, modulos: g.modulos || [], origem: origem || '', ferramentas: [] };
    for (const t of g.ferramentas) {
      if (!t || !NOME_OK.test(t.nome || '')) { this.erros.push(`${origem}: nome de ferramenta inválido: ${t && t.nome}`); continue; }
      if (this.porNome.has(t.nome)) { this.erros.push(`${origem}: ferramenta repetida: ${t.nome}`); continue; }
      if (typeof t.executa !== 'function') { this.erros.push(`${origem}: ${t.nome} sem executa()`); continue; }
      const f = Object.assign({ entrada: { type: 'object', properties: {} } }, t, { grupo: g.grupo });
      grupo.ferramentas.push(f);
      this.porNome.set(t.nome, f);
    }
    const ja = this.grupos.findIndex(x => x.grupo === grupo.grupo);
    if (ja >= 0) this.grupos[ja].ferramentas.push(...grupo.ferramentas);
    else { this.grupos.push(grupo); this.grupos.sort((a, b) => a.ordem - b.ordem); }
    return grupo;
  }
  todas() { return this.grupos.flatMap(g => g.ferramentas); }
  get(nome) { return this.porNome.get(nome) || null; }
}

module.exports = { Registro };
