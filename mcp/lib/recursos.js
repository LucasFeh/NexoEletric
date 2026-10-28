/* NexoEletric MCP - recursos.js
   Recursos (resources/*) e prompts (prompts/*). O AI-GUIDE.md e o contrato de como a IA edita
   os arquivos do projeto; ele vai como recurso para o cliente MCP poder anexa-lo ao contexto.
   Os formatos (ops do changes.js, camadas, itens do schmirror-v2) sao gerados do PROPRIO
   hub-core, para nunca descolarem do motor. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const skills = require('./skills.js');

const DOCS = [
  { uri: 'eletrichub://guia/ai-guide', arq: 'AI-GUIDE.md', nome: 'AI-GUIDE', descricao: 'Contrato da IA: schematic.js (Parte A), changes.js (Parte B), annotations.js (Parte C)' },
  { uri: 'eletrichub://guia/claude', arq: 'CLAUDE.md', nome: 'CLAUDE.md', descricao: 'Como o código do workspace se organiza' },
  { uri: 'eletrichub://guia/pcb-migracao', arq: 'docs/PCB-MIGRACAO.md', nome: 'PCB-MIGRACAO', descricao: 'O que falta para a PCB sair inteira do hub' },
  { uri: 'eletrichub://guia/mcp', arq: 'mcp/README.md', nome: 'README do MCP', descricao: 'As ferramentas deste servidor e como registrá-lo' },
];

function formatoChanges(ctx) {
  const hc = ctx.hc;
  const L = ['# Ops do changes.js (geradas do hub-core)', '',
             'Uma op por linha. As ferramentas pcb_* preenchem os orig_* sozinhas.', ''];
  /* CH_REQUIRED nao e exportado; o serializeChanges de uma op vazia diz o que falta */
  for (const op of ['comp_move', 'comp_attr', 'designator_move', 'track_add', 'track_edit', 'track_del', 'via_add', 'via_edit', 'via_del',
                    'arc_add', 'arc_edit', 'arc_del', 'text_add', 'text_edit', 'text_del', 'fill_add', 'fill_edit', 'fill_del',
                    'region_add', 'region_del', 'outline_set']) {
    const r = hc.serializeChanges([{ op }]);
    const falta = (r.errors || []).map(e => (/"([^"]+)"/.exec(e.msg) || [])[1]).filter(Boolean);
    L.push(`- ${op}: obrigatórios ${falta.length ? falta.join(', ') : '(ver AI-GUIDE)'}`);
  }
  return L.join('\n');
}
function camadas(ctx) {
  return JSON.stringify(ctx.hc.PCB_LAYERS.map(l => ({ key: l.key, name: l.name, kind: l.kind, side: l.side, pair: l.pair, cor: l.color })), null, 0);
}

function recursos(ctx) {
  return {
    async listar() {
      const r = DOCS.filter(d => fs.existsSync(path.join(ctx.root, d.arq)))
        .map(d => ({ uri: d.uri, name: d.nome, title: d.nome, description: d.descricao, mimeType: 'text/markdown' }));
      r.push({ uri: 'eletrichub://formato/changes', name: 'formato-changes', title: 'Ops do changes.js', description: 'Campos obrigatórios por op (do hub-core)', mimeType: 'text/markdown' });
      r.push({ uri: 'eletrichub://formato/camadas', name: 'camadas', title: 'Camadas PCB', description: 'HubCore.PCB_LAYERS: as chaves de camada aceitas', mimeType: 'application/json' });
      for (const s of skills.listar())
        r.push({ uri: `eletrichub://skill/${s.nome}`, name: `skill-${s.nome}`, title: s.titulo, description: 'Regra da casa: ' + s.descricao, mimeType: 'text/markdown' });
      for (const p of ctx.listaProjetos())
        for (const f of ['schematic.js', 'changes.js', 'annotations.js'])
          if (fs.existsSync(path.join(ctx.dirProjetos(), p, f)))
            r.push({ uri: `eletrichub://projeto/${encodeURIComponent(p)}/${f}`, name: `${p}/${f}`, mimeType: 'text/javascript' });
      return r;
    },
    modelos() {
      return [{ uriTemplate: 'eletrichub://projeto/{projeto}/{arquivo}', name: 'arquivo-do-projeto',
                description: 'Um arquivo da pasta do projeto (board.js, schematic.js, changes.js, annotations.js, rules.js, relatórios)', mimeType: 'text/plain' }];
    },
    async ler(uri) {
      const d = DOCS.find(x => x.uri === uri);
      if (d) {
        const f = path.join(ctx.root, d.arq);
        if (!fs.existsSync(f)) return null;
        return { uri, mimeType: 'text/markdown', text: fs.readFileSync(f, 'utf8') };
      }
      if (uri === 'eletrichub://formato/changes') return { uri, mimeType: 'text/markdown', text: formatoChanges(ctx) };
      if (uri === 'eletrichub://formato/camadas') return { uri, mimeType: 'application/json', text: camadas(ctx) };
      const sk = /^eletrichub:\/\/skill\/([^/]+)$/.exec(uri || '');
      if (sk) { const s = skills.ler(decodeURIComponent(sk[1])); return s ? { uri, mimeType: 'text/markdown', text: s.texto } : null; }
      const m = /^eletrichub:\/\/projeto\/([^/]+)\/([^/]+)$/.exec(uri || '');
      if (m) {
        const p = ctx.projeto(decodeURIComponent(m[1]));
        const nome = decodeURIComponent(m[2]);
        if (nome.includes('..') || /[\\/]/.test(nome)) return null;
        const f = p.arq(nome);
        if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return null;
        return { uri, mimeType: 'text/plain', text: fs.readFileSync(f, 'utf8') };
      }
      return null;
    },
  };
}

const PROMPTS = [
  { name: 'fluxo_pcb', title: 'Trabalhar na PCB', description: 'Roteiro para posicionar/rotear uma placa pelo changes.js',
    arguments: [{ name: 'projeto', description: 'nome da pasta em Projects/', required: true }],
    texto: a => `Projeto "${a.projeto}". 1) sinal_listar e resolva os abertos primeiro. 2) projeto_resumo e pcb_resumo. 3) nets_ratsnest para ver o que falta ligar. 4) pcb_mover / pcb_trilha / pcb_rotear / pcb_via / pcb_apagar — confira "erros" em cada resposta; para ligar muitas conexões de uma vez (várias camadas, vias), pcb_autorotear (simula; gravar:true grava, sem violação nova de DRC). 5) drc_rodar (já com os planos despejados, como a tela) até aprovado e pcb_render uma camada de cobre por vez para ver. 6) Regras da casa: skills_listar e skill_ler de cada uma (nada de cobre de outra net no pad, parafuso isolado, plano afastado dos pads, serigrafia livre, boas práticas, conferir antes de entregar) e regras_casa_verificar até zerar. 7) gerber_gerar quando estiver pronta. Escreva "note" em cada mudança.` },
  { name: 'fluxo_esquema', title: 'Montar um esquema', description: 'Roteiro para criar/editar o schematic.js',
    arguments: [{ name: 'projeto', description: 'nome do projeto (novo ou existente)', required: true }, { name: 'circuito', description: 'o que o circuito faz', required: false }],
    texto: a => `Projeto "${a.projeto}"${a.circuito ? ' — ' + a.circuito : ''}. Se não existe: projeto_criar. Para cada peça: sch_buscar_simbolo → sch_simbolo (pinos, footprint) → sch_adicionar (comp com footprint). Ligue com sch_ligar ("R1.2" → "C1.1") e nomeie com netlabel/power. Termine com sch_validar e sch_nets.` },
  { name: 'resolver_sinalizadores', title: 'Resolver sinalizadores', description: 'Parte C do AI-GUIDE: tratar as bandeiras do usuário',
    arguments: [{ name: 'projeto', required: true, description: 'projeto' }],
    texto: a => `Projeto "${a.projeto}": sinal_listar {status:"open"}. Para cada um, corrija (pcb_* com note "nX: ..."), depois sinal_responder {id, reply}. Nunca apague nem renumere sinalizadores.` },
];
/* cada skill da casa vira um prompt skill_<nome> (o texto inteiro da skill, para o cliente anexar) */
function promptsDasSkills() {
  return skills.listar().map(s => ({ name: 'skill_' + s.nome.replace(/[^a-z0-9_]/gi, '_'), title: 'Regra da casa: ' + s.titulo, description: s.descricao,
    arguments: [{ name: 'projeto', description: 'projeto em que a regra vai ser aplicada (opcional)', required: false }],
    texto: a => (a.projeto ? `Projeto "${a.projeto}". Aplique esta regra da casa e confira com regras_casa_verificar.\n\n` : '') + s.texto }));
}
function prompts() {
  const todos = () => PROMPTS.concat(promptsDasSkills());
  return {
    listar: () => todos().map(p => ({ name: p.name, title: p.title, description: p.description, arguments: p.arguments })),
    obter: (nome, a) => {
      const p = todos().find(x => x.name === nome);
      if (!p) return null;
      return { description: p.description, messages: [{ role: 'user', content: { type: 'text', text: p.texto(a || {}) } }] };
    },
  };
}

module.exports = { recursos, prompts };
