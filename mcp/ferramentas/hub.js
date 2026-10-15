/* NexoEletric MCP - grupo "hub": o proprio hub (status, ajuda, modulos, vista aberta).

   A vista ao vivo: o hubserver.py recarrega sozinho a pagina aberta quando o arquivo do projeto
   muda (o vigia), entao a IA nao precisa "mandar recarregar" depois de gravar. Para o
   screenshot da tela de verdade e para pedir algo a vista (recarregar, focar), o hub precisa da
   rota de mcp/rotas_hub.py e a pagina do mcp/hub-mcpvista.js (o integrador liga os dois). Sem
   eles, vista_screenshot cai no pcb_render (a imagem desenhada aqui). */
'use strict';
const path = require('node:path');
const { ErroMcp } = require('../lib/contexto.js');
const { PROJETO, sondaHub, hubNoAr, urlsDaVista } = require('../lib/util.js');

const MODULOS = [
  ['hub-core.js', 'HubCore', 'motor: board+changes → placa efetiva, nets do esquema, validação'],
  ['hub-gerber.js', 'HubGerber', 'Gerber X2'], ['hub-gerberview.js', 'HubGerberView', 'leitor de Gerber/Excellon'],
  ['hub-roteador.js', 'HubRoteador', 'roteador walkaround'], ['hub-laser.js', 'HubLaser', 'laser / contorno da placa'],
  ['hub-font.js', 'HubFont', 'fonte stroke'], ['hub-bom.js', 'HubBom', 'BOM de montagem'],
  ['hub-pcbregras.js', 'HubPcbRegras', 'regras de projeto (rules.js)'], ['hub-pcbdrc.js', 'HubPcbDrc', 'DRC'],
  ['hub-pcbnets.js', 'HubPcbNets', 'conectividade / ratsnest'], ['hub-pcbteardrop.js', 'HubPcbTeardrop', 'teardrops'],
  ['hub-pcbpour.js', 'HubPcbPour', 'polygon pour'], ['hub-pcbpdf.js', 'HubPcbPdf', 'PDF de layout'],
  ['hub-pcbeco.js', 'HubPcbEco', 'ECO esquema → placa'], ['hub-pcbnova.js', 'HubPcbNova', 'placa nova'],
  ['hub-schtemplate.js', 'HubSchTemplate', 'templates de folha'], ['hub-altiumdna.js', 'HubAltiumDNA', 'comandos/atalhos do Altium'],
];

/* "$placa", "$board", "$model", "$esquema", "$regras", "$schlib", "$pcblib" nos args do
   hub_modulo_chamar viram os objetos do projeto */
function substitui(ctx, p, v, cache) {
  if (typeof v === 'string' && /^\$[a-z]+$/.test(v)) {
    const k = v.slice(1);
    if (!(k in cache)) {
      if (!p && !['schlib', 'pcblib'].includes(k)) throw new ErroMcp(`"${v}" precisa de "projeto"`);
      if (['placa', 'board', 'model', 'changes'].includes(k)) { const x = ctx.placa(p); cache.placa = x.eb; cache.board = x.board; cache.model = x.model; cache.changes = x.changes; }
      else if (k === 'esquema') cache.esquema = ctx.schematic(p);
      else if (k === 'regras') { try { cache.regras = require('../lib/arquivo-linhas.js').lerVar(p.arq('rules.js')); } catch (_) { cache.regras = undefined; } }
      else if (k === 'schlib') cache.schlib = ctx.libs().schlib;
      else if (k === 'pcblib') cache.pcblib = ctx.libs().pcblib;
      else throw new ErroMcp(`substituição desconhecida: ${v}`);
    }
    return cache[k];
  }
  if (Array.isArray(v)) return v.map(x => substitui(ctx, p, x, cache));
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = substitui(ctx, p, v[k], cache); return o; }
  return v;
}
function enxuga(v, prof) {
  if (prof > 6) return '…';
  if (Array.isArray(v)) return v.length > 300 ? { total: v.length, primeiros: v.slice(0, 300).map(x => enxuga(x, prof + 1)) } : v.map(x => enxuga(x, prof + 1));
  if (v instanceof Uint8Array) return { bytes: v.length };
  if (typeof v === 'function') return '[função]';
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = enxuga(v[k], prof + 1); return o; }
  return v;
}

async function pedeVista(ctx, alvo, proj, acao, args, segundos) {
  const hub = await hubNoAr(ctx);
  if (!hub) return { ok: false, erro: 'nenhum hub HTTP no ar (hub_status)' };
  if (!hub.mcp) return { ok: false, erro: 'o hub no ar não tem as rotas /api/mcp/* (mcp/rotas_hub.py ainda não foi ligado no hubserver.py)', hub: hub.url };
  const r = await fetch(hub.url + '/api/mcp/pedido', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alvo, proj, acao, args: args || {} }), signal: AbortSignal.timeout(3000) });
  const j = await r.json();
  if (!j.ok) return { ok: false, erro: j.error || 'pedido recusado', hub: hub.url };
  const s = Math.min(20, segundos || 8);
  const q = await fetch(`${hub.url}/api/mcp/resposta/${encodeURIComponent(j.id)}?espera=${s}`, { signal: AbortSignal.timeout((s + 3) * 1000) });
  const resp = await q.json();
  resp.hub = hub.url;
  return resp;
}

module.exports = {
  grupo: 'hub',
  ordem: 90,
  titulo: 'Hub — status, ajuda, módulos e vista aberta',
  ferramentas: [
    {
      nome: 'list_commands', titulo: 'Listar ferramentas', leitura: true,
      descricao: 'Lista todas as ferramentas deste servidor por grupo, com o que cada uma faz e de que módulo do hub depende (e se ele está presente). Comece por aqui se não souber o que usar.',
      entrada: { type: 'object', properties: { grupo: { type: 'string' }, detalhe: { type: 'boolean', description: 'inclui o esquema de entrada' } } },
      executa: async (a, ctx, srv) => ({
        raiz: ctx.root,
        grupos: srv.reg.grupos.filter(g => !a.grupo || g.grupo === a.grupo).map(g => ({
          grupo: g.grupo, titulo: g.titulo,
          ferramentas: g.ferramentas.map(f => Object.assign({ nome: f.nome, titulo: f.titulo, descricao: f.descricao,
            grava: !f.leitura, modulo: f.modulo, modulo_presente: f.modulo ? !!ctx.modulo(f.modulo) : undefined }, a.detalhe ? { entrada: f.entrada } : {})),
        })),
        erros_de_registro: srv.reg.erros,
      }),
    },
    {
      nome: 'hub_status', titulo: 'Status do hub', leitura: true,
      descricao: 'Diz se o hub HTTP está no ar (127.0.0.1 nas portas 8200 do app desktop, 8000 do repo, 8100 do servidor, 8001 da homologação, ou o --hub dado), se é a mesma pasta deste MCP, as vistas abertas que o MCP alcança, e as URLs das vistas de um projeto para mandar ao usuário.',
      entrada: { type: 'object', properties: { projeto: PROJETO } },
      executa: async (a, ctx) => {
        const hubs = await sondaHub(ctx);
        const no = hubs.find(h => h.ok && h.mesmaRaiz) || hubs.find(h => h.ok);
        const out = { raiz_mcp: ctx.root, projetos_em: ctx.dirProjetos(), hubs };
        if (a.projeto) { const p = ctx.projeto(a.projeto); out.vistas = no ? urlsDaVista(no.url, p.nome) : null; }
        out.nota = no ? (no.mcp ? 'vista ao vivo disponível (vista_screenshot)' : 'hub no ar sem as rotas do MCP: a vista recarrega sozinha ao gravar, mas não há screenshot da tela (use pcb_render)')
                      : 'nenhum hub no ar: as gravações valem do mesmo jeito; abra o NexoEletric para ver ao vivo';
        return out;
      },
    },
    {
      nome: 'hub_modulos', titulo: 'Módulos do hub', leitura: true,
      descricao: 'Quais módulos do hub estão nesta instalação e carregam em Node, e as funções que cada um exporta (para usar com hub_modulo_chamar). Os módulos novos (DRC, pour, ECO…) aparecem aqui assim que o arquivo chega.',
      entrada: { type: 'object', properties: { modulo: { type: 'string', description: 'só este arquivo (ex.: hub-pcbdrc.js)' } } },
      executa: async (a, ctx) => ({
        modulos: MODULOS.filter(m => !a.modulo || m[0] === a.modulo).map(([arq, g, d]) => {
          const m = ctx.modulo(arq);
          return { arquivo: arq, global: g, para: d, presente: !!m, erro: m ? undefined : ctx.erroModulo(arq) || undefined,
                   exporta: m ? Object.keys(m).map(k => typeof m[k] === 'function' ? k + '()' : k) : undefined };
        }),
      }),
    },
    {
      nome: 'hub_modulo_chamar', titulo: 'Chamar função de um módulo do hub',
      descricao: 'Liberdade total: chama QUALQUER função exportada por um módulo do hub em Node (hub_modulos lista). Nos args, as strings "$placa" (placa efetiva), "$board", "$model", "$changes", "$esquema", "$regras", "$schlib", "$pcblib" viram os objetos do projeto. Só lê/calcula: para gravar no changes.js passe as ops que vierem em pcb_aplicar.',
      entrada: { type: 'object', properties: { modulo: { type: 'string', description: 'arquivo, ex.: hub-core.js' }, funcao: { type: 'string' },
        args: { type: 'array', description: 'argumentos (JSON), com as substituições $...' }, projeto: PROJETO }, required: ['modulo', 'funcao'] },
      executa: async (a, ctx) => {
        if (!/^(hub-[a-z0-9-]+|Libs\/[a-z0-9-]+)\.js$/i.test(a.modulo)) throw new ErroMcp('módulo inválido (use o arquivo, ex.: hub-core.js)');
        const m = ctx.exige(a.modulo, a.modulo);
        if (typeof m[a.funcao] !== 'function') throw new ErroMcp(`${a.modulo} não exporta a função "${a.funcao}". Exporta: ${Object.keys(m).join(', ')}`);
        const p = a.projeto ? ctx.projeto(a.projeto) : null;
        const args = substitui(ctx, p, a.args || [], {});
        let v = m[a.funcao](...args);
        if (v && typeof v.then === 'function') v = await v;
        return { resultado: enxuga(v, 0) };
      },
    },
    {
      nome: 'vista_screenshot', titulo: 'Screenshot da vista aberta', leitura: true,
      descricao: 'Captura a imagem da vista PCB ou Esquema ABERTA no hub (navegador ou app NexoEletric) para o projeto — exige o hub no ar com as rotas do MCP e a vista aberta. Se não houver vista aberta, desenha a placa aqui (pcb_render) e avisa.',
      entrada: { type: 'object', properties: { projeto: PROJETO, vista: { type: 'string', enum: ['pcb', 'sch'], description: 'padrão pcb' } }, required: ['projeto'] },
      executa: async (a, ctx, srv) => {
        const p = ctx.projeto(a.projeto);
        const alvo = a.vista || 'pcb';
        let r;
        try { r = await pedeVista(ctx, alvo, p.nome, 'screenshot', {}, 8); } catch (e) { r = { ok: false, erro: e.message }; }
        if (r.ok && r.dados && r.dados.png) return { fonte: 'vista aberta no hub', hub: r.hub, largura: r.dados.largura, altura: r.dados.altura,
          _imagem: { base64: String(r.dados.png).replace(/^data:image\/png;base64,/, ''), mime: 'image/png' } };
        if (alvo !== 'pcb') throw new ErroMcp('sem vista Esquema aberta para capturar: ' + (r.erro || 'sem resposta') + '. Abra ' + (((await hubNoAr(ctx)) || {}).url || 'o hub') + '/schframe.html?p=' + encodeURIComponent(p.nome));
        const f = srv.reg.get('pcb_render');
        const img = await f.executa({ projeto: p.nome }, ctx, srv);
        img.fonte = 'desenhada pelo MCP (pcb_render) — ' + (r.erro || 'nenhuma vista PCB aberta respondeu');
        return img;
      },
    },
    {
      nome: 'vista_comando', titulo: 'Mandar comando para a vista aberta',
      descricao: 'Pede algo à vista aberta no hub: "recarregar" (relê os arquivos; normalmente desnecessário, o vigia do hub já recarrega), "focar" {x, y, zoom?} (centra a vista no ponto), "selecionar" {ids|refs}, ou um comando do Altium {comando} quando o hub-altiumdna.js estiver na página. Exige o hub com as rotas do MCP e a página com mcp/hub-mcpvista.js.',
      entrada: { type: 'object', properties: { projeto: PROJETO, vista: { type: 'string', enum: ['pcb', 'sch'] }, acao: { type: 'string', enum: ['recarregar', 'focar', 'selecionar', 'comando'] }, args: { type: 'object', additionalProperties: true } }, required: ['projeto', 'acao'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        return pedeVista(ctx, a.vista || 'pcb', p.nome, a.acao, a.args, 6);
      },
    },
    {
      nome: 'altium_comandos', titulo: 'Comandos e atalhos do Altium', leitura: true, modulo: 'hub-altiumdna.js',
      descricao: 'O "DNA" de comandos do Altium Designer 21 (hub-altiumdna.js, extraído dos .rcs do AD21): por editor (pcb|sch), busca por texto (rótulo, comando, descrição), por tecla ("W", "Ctrl+2") ou por sequência de menu ("P,T"). Devolve comando, rótulo, teclas, acelerador e onde mora no menu — para explicar ao usuário o atalho ou mandar o comando à vista (vista_comando).',
      entrada: { type: 'object', properties: { editor: { type: 'string', enum: ['pcb', 'sch'], description: 'padrão pcb' }, busca: { type: 'string' }, tecla: { type: 'string' }, sequencia: { type: 'string', description: 'ex.: "P,T"' }, limite: { type: 'integer', minimum: 1, maximum: 500 } } },
      executa: async (a, ctx) => {
        const M = ctx.exige('hub-altiumdna.js', 'HubAltiumDNA');
        const ed = a.editor || 'pcb';
        const ficha = c => c && Object.assign({}, c, { acelerador: M.acelerador ? M.acelerador(ed, c.plid) : undefined, menu: M.caminho ? M.caminho(ed, c.plid) : undefined });
        if (a.sequencia) return { editor: ed, comando: ficha(M.porSequencia(ed, a.sequencia)) };
        if (a.tecla) return { editor: ed, comandos: (M.porTecla(ed, a.tecla) || []).map(ficha) };
        if (!a.busca) return { versao: M.VERSAO, contagens: M.contagens ? M.contagens() : undefined, nota: 'dê busca, tecla ou sequencia' };
        const L = M.busca(ed, a.busca) || [];
        return { editor: ed, total: L.length, comandos: L.slice(0, a.limite || 50).map(ficha) };
      },
    },
    {
      nome: 'hub_recarregar_ferramentas', titulo: 'Recarregar ferramentas',
      descricao: 'Relê a pasta mcp/ferramentas/ (ferramenta nova de um módulo que acabou de chegar) sem reiniciar o servidor. O cliente pode precisar listar de novo (tools/list).',
      entrada: { type: 'object', properties: {} },
      executa: async (a, ctx, srv) => { srv.reg.carregar(); return { ferramentas: srv.reg.todas().length, erros: srv.reg.erros, pasta: path.join(__dirname) }; },
    },
  ],
};
