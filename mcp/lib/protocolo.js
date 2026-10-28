/* NexoEletric MCP - protocolo.js
   O Model Context Protocol em JSON-RPC 2.0, sem dependencia nenhuma (o app desktop leva um Node
   sem node_modules, e o servidor da rede um Python sem npm). Independe do transporte: o stdio e
   o HTTP chamam `atende(msg)` e mandam de volta o que ele devolver (null = notificacao, sem
   resposta).

   Versoes: 2025-06-18 (atual) com recuo para 2025-03-26 e 2024-11-05 -- o servidor responde com a
   versao que o cliente pediu quando a conhece, senao com a mais nova (a regra da especificacao).
   Metodos: initialize, ping, tools/list, tools/call, resources/list, resources/templates/list,
   resources/read, prompts/list, prompts/get, logging/setLevel, completion/complete (vazio). */
'use strict';
const VERSOES = ['2025-06-18', '2025-03-26', '2024-11-05'];
const { ErroMcp } = require('./contexto.js');
const skills = require('./skills.js');
const gate = require('./gate-hub.js');

const ERR = { PARSE: -32700, REQ: -32600, METODO: -32601, PARAMS: -32602, INTERNO: -32603 };

const INSTRUCOES = [
  'NexoEletric: esquema e PCB no DNA do Altium Designer. Esquema em mil (Y para cima, grade de 100 mil); PCB em mm (Y para cima, rotação anti-horária).',
  'App: app_status diz se o NexoEletric está aberto. Aberto = ao vivo: tudo o que você grava aparece na tela do usuário na hora, e o indicador "IA" no topo do app mostra cada comando. Fechado: as ferramentas de arquivo funcionam igual; app_abrir abre o app, vista_abrir mostra um projeto ao usuário. Projetos, esquemas, símbolos e footprints vêm do Nexo Hub: sem ele conectado, as ferramentas de projeto/biblioteca recusam (não há cópia local que valha).',
  'Comece por projeto_listar → projeto_resumo {projeto}. Leia os sinalizadores abertos (sinal_listar) antes de mexer: são pendências do usuário. Projeto do Altium: projeto_abrir_altium com o .PrjPcb traz esquema E PCB.',
  'SÍMBOLO: sym_ler mostra o desenho; sym_gerar monta um CI/conector a partir da lista de pinos; sym_salvar grava (destino "projeto" = no esquema do projeto, vale na hora; "biblioteca" = Biblioteca de símbolos do hub; "altium" = redesenha um da SchLib da casa).',
  'FOOTPRINT/3D: fp_pacote (assistente) ou fp_salvar; fp_corpo3d (modelo já na biblioteca), fp_3d_importar (STEP do disco), fp_3d_nexo (modelo da biblioteca da rede Nexo); fp_vincular liga o footprint ao componente.',
  'Vários passos de uma vez: lote {passos:[{id, ferramenta, args}]}, com "$id.campo" usando o resultado de um passo anterior.',
  'Atmosfera Nexo: os projetos moram no NexoBD (nexo_projetos, nexo_projeto_historico, nexo_projeto_restaurar); nexo_enviar_placa leva a placa ao NexoCAD (caixa, montagem); nexo_editar_modelo abre um 3D no NexoCAD; nexo_sincronizar publica biblioteca 3D e placas.',
  'ESQUEMA (schematic.js): sch_buscar_simbolo → sch_simbolo (pinos e footprint) → sch_adicionar {itens} → sch_ligar (fio entre pinos "R1.1"→"C1.2") → sch_nets / sch_validar.',
  'PCB: a placa espelhada (board.js) nunca é editada; toda mudança vai para o changes.js, uma op por linha. As ferramentas pcb_* preenchem os orig_* sozinhas a partir do board.js — você só diz o que quer (pcb_mover R5 para x,y; pcb_apagar t12; pcb_trilha; pcb_rotear contornando obstáculos; pcb_autorotear liga o ratsnest inteiro em várias camadas com vias, ordem e arranca-e-refaz, com as regras do DRC — simula por padrão, gravar:true grava; pcb_colocar põe um footprint como componente novo; eco_aplicar traz o esquema todo).',
  'Toda escrita é validada ANTES de gravar com o mesmo motor da tela (applyPcbChanges); se houver erro nada é gravado e a resposta traz os erros. Sempre confira "erros" e "avisos" na resposta.',
  'A vista aberta no hub recarrega sozinha quando o arquivo muda. pcb_render devolve uma imagem da placa com as mudanças; vista_screenshot captura a tela do hub quando ela está aberta.',
  'Saídas: gerber_gerar (grava Projects/<p>/Gerber/), pdf_layout, bom_listar. Regras/DRC, ratsnest, polygon pour, teardrops e ECO usam os módulos do hub quando presentes (hub_modulos mostra o que existe).',
  'list_commands lista tudo por grupo; projeto_desfazer volta a última gravação da sessão.',
].join('\n');

/* as INSTRUCOES fixas + o resumo das skills da casa (mcp/skills/*.md), lido na hora: skill nova entra sem reiniciar */
function instrucoes() {
  let r = '';
  try { r = skills.resumo(); } catch (_) { r = ''; }
  return r ? INSTRUCOES + '\n' + r : INSTRUCOES;
}

class Servidor {
  constructor(ctx, registro, opts) {
    this.ctx = ctx;
    this.reg = registro;
    this.opts = opts || {};
    this.versao = this.opts.versao || '1.0.0';
    this.recursos = this.opts.recursos || null;    // {listar(), modelos(), ler(uri)}
    this.prompts = this.opts.prompts || null;      // {listar(), obter(nome, args)}
    this.iniciado = false;
    this.versaoProtocolo = VERSOES[0];
  }

  async atende(msg) {
    if (Array.isArray(msg)) {                      // lote (2025-03-26); a 06-18 tirou, mas nao custa
      if (!msg.length) return erro(null, ERR.REQ, 'lote vazio');
      const r = (await Promise.all(msg.map(m => this.atende(m)))).filter(x => x);
      return r.length ? r : null;
    }
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return erro(msg && msg.id != null ? msg.id : null, ERR.REQ, 'requisição JSON-RPC 2.0 inválida');
    const temId = Object.prototype.hasOwnProperty.call(msg, 'id') && msg.id !== null;
    if (typeof msg.method !== 'string') return temId ? null : null;   // resposta de cliente: ignora
    if (!temId) { this._notificacao(msg); return null; }
    try {
      const r = await this._metodo(msg.method, msg.params || {});
      return { jsonrpc: '2.0', id: msg.id, result: r };
    } catch (e) {
      if (e && e.codigo) return erro(msg.id, e.codigo, e.message, e.dados);
      return erro(msg.id, ERR.INTERNO, String(e && e.message || e));
    }
  }
  _notificacao(msg) {
    if (msg.method === 'notifications/initialized') this.iniciado = true;
  }
  async _metodo(m, p) {
    switch (m) {
      case 'initialize': {
        const pedida = p && p.protocolVersion;
        this.versaoProtocolo = VERSOES.includes(pedida) ? pedida : VERSOES[0];
        this.cliente = p && p.clientInfo || null;
        if (this.opts.aoIniciar) { try { this.opts.aoIniciar(this.cliente, this.reg.todas().length); } catch (_) { /* relato nunca derruba */ } }
        return {
          protocolVersion: this.versaoProtocolo,
          capabilities: { tools: { listChanged: false }, resources: { listChanged: false, subscribe: false },
                          prompts: { listChanged: false }, logging: {} },
          serverInfo: { name: 'nexoeletric', title: 'NexoEletric', version: this.versao },
          instructions: instrucoes(),
        };
      }
      case 'ping': return {};
      case 'logging/setLevel': return {};
      case 'completion/complete': return { completion: { values: [], hasMore: false } };
      case 'tools/list': return { tools: this.reg.todas().map(f => this._descreve(f)) };
      case 'tools/call': return this._chama(p);
      case 'resources/list': return { resources: this.recursos ? await this.recursos.listar() : [] };
      case 'resources/templates/list': return { resourceTemplates: this.recursos && this.recursos.modelos ? this.recursos.modelos() : [] };
      case 'resources/read': {
        if (!this.recursos) throw falha(ERR.PARAMS, 'sem recursos');
        const c = await this.recursos.ler(p.uri);
        if (!c) throw falha(-32002, 'recurso não encontrado: ' + p.uri, { uri: p.uri });
        return { contents: [c] };
      }
      case 'prompts/list': return { prompts: this.prompts ? this.prompts.listar() : [] };
      case 'prompts/get': {
        const r = this.prompts && this.prompts.obter(p.name, p.arguments || {});
        if (!r) throw falha(ERR.PARAMS, 'prompt desconhecido: ' + p.name);
        return r;
      }
      default: throw falha(ERR.METODO, 'método não suportado: ' + m);
    }
  }
  _descreve(f) {
    const d = { name: f.nome, description: f.descricao || '', inputSchema: f.entrada };
    if (this.versaoProtocolo !== '2024-11-05') {
      d.title = f.titulo || f.nome;
      d.annotations = { title: f.titulo || f.nome, readOnlyHint: !!f.leitura, destructiveHint: !!f.destrutiva,
                        idempotentHint: !!f.leitura, openWorldHint: false };
    }
    return d;
  }
  async _chama(p) {
    const f = this.reg.get(p && p.name);
    if (!f) throw falha(ERR.PARAMS, `ferramenta desconhecida: ${p && p.name}. Use list_commands.`);
    const args = (p && p.arguments) || {};
    const faltam = ((f.entrada && f.entrada.required) || []).filter(k => args[k] === undefined || args[k] === null || args[k] === '');
    if (faltam.length) return resultadoErro(`faltam argumentos obrigatórios: ${faltam.join(', ')}`, { ferramenta: f.nome, entrada: f.entrada });
    const t0 = Date.now();
    const r = await this.executa(f, args);
    if (this.opts.aoChamar) { try { this.opts.aoChamar(f, args, r, Date.now() - t0); } catch (_) { /* relato nunca derruba */ } }
    return r;
  }
  /* executa uma ferramenta e embrulha o resultado (o tools/call e o lote usam) */
  async executa(f, args) {
    try {
      const semHub = await gate.recusa(f.nome, this.ctx);
      if (semHub) throw new ErroMcp(semHub, { semHub: true });
      const r = await f.executa(args, this.ctx, this);
      return resultado(r, this.versaoProtocolo);
    } catch (e) {
      const msg = String(e && e.message || e);
      this.ctx.log(`[${f.nome}] ${msg}${e && e.stack && !(e instanceof ErroMcp) ? '\n' + e.stack : ''}`);
      return resultadoErro(msg, e && e.extra);
    }
  }
}

function erro(id, code, message, data) {
  const e = { jsonrpc: '2.0', id, error: { code, message } };
  if (data !== undefined) e.error.data = data;
  return e;
}
function falha(codigo, msg, dados) { const e = new Error(msg); e.codigo = codigo; e.dados = dados; return e; }

/* o retorno de uma ferramenta vira content: texto JSON (o que a IA le), imagem se houver, e
   structuredContent (2025-06-18) com o mesmo objeto */
function resultado(r, versao) {
  const content = [];
  let obj = r;
  if (r && typeof r === 'object' && r._imagem) {
    obj = Object.assign({}, r); delete obj._imagem;
    content.push({ type: 'image', data: r._imagem.base64, mimeType: r._imagem.mime || 'image/png' });
  }
  const texto = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 1);
  content.unshift({ type: 'text', text: texto });
  const out = { content, isError: !!(obj && typeof obj === 'object' && obj.ok === false) };
  if (versao === '2025-06-18' && obj && typeof obj === 'object' && !Array.isArray(obj)) out.structuredContent = obj;
  return out;
}
function resultadoErro(msg, extra) {
  const obj = Object.assign({ ok: false, erro: msg }, extra ? { detalhe: extra } : {});
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 1) }], isError: true };
}

module.exports = { Servidor, VERSOES, ERR, INSTRUCOES };
