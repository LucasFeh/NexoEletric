/* EletricHUB MCP - grupo "projeto": listar, criar, resumir, ler arquivos, desfazer. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { ArquivoLinhas, jline } = require('../lib/arquivo-linhas.js');
const { ErroMcp } = require('../lib/contexto.js');
const { PROJETO, nomeDePastaOk, caminhoNoProjeto, r4, hubNoAr, urlsDaVista } = require('../lib/util.js');
const { resumoValidacao } = require('../lib/pcb-ops.js');

function arquivos(p) {
  const tem = f => fs.existsSync(p.arq(f));
  return { schematic: tem('schematic.js'), board: tem('board.js'), changes: tem('changes.js'), annotations: tem('annotations.js'),
           rules: tem('rules.js'), buildreport: tem('build-report.txt'), applyreport: tem('apply-report.txt'),
           gerber: tem('Gerber/gerber.json'), pdf: fs.existsSync(p.arq('PDF')) };
}

function resumoPlaca(ctx, p) {
  const { board, changes, model, eb } = ctx.placa(p);
  const conta = k => (eb[k] || []).length;
  const pads = (eb.components || []).reduce((s, c) => s + ((c.pads || []).length), 0) + conta('freepads');
  const bb = board.board && board.board.bbox;
  return {
    origem: board.source || '', exportador: board.exporter || '(espelho antigo)', gerado: board.generated || '',
    bbox_mm: bb ? { x1: bb.x1, y1: bb.y1, x2: bb.x2, y2: bb.y2, largura: r4(bb.x2 - bb.x1), altura: r4(bb.y2 - bb.y1) } : null,
    camadas_usadas: ctx.hc.boardLayers(eb).filter(l => l.used).map(l => `${l.key}(${l.count})`),
    contagem: { componentes: conta('components'), pads, trilhas: conta('tracks'), arcos: conta('arcs'), vias: conta('vias'),
                textos: conta('texts'), fills: conta('fills'), regioes: conta('regions'), recortes: conta('cutouts'), nets: (board.nets || []).length },
    regras: board.rules || null,
    mudancas: changes.length,
    validacao: resumoValidacao(model, 12),
  };
}

function resumoEsquema(ctx, p) {
  const s = ctx.schematic(p);
  const it = s.items || [];
  const n = t => it.filter(x => x.t === t).length;
  return { formato: s.format, folhas: it.filter(x => x.t === 'sheet').map(x => ({ name: x.name, size: x.size, w: x.w, h: x.h })),
           componentes: n('comp'), fios: n('wire'), netlabels: n('netlabel'), power: n('power'), portas: n('port'), juncoes: n('junction'), textos: n('text') };
}

module.exports = {
  grupo: 'projeto',
  ordem: 10,
  titulo: 'Projeto — pastas em Projects/',
  ferramentas: [
    {
      nome: 'projeto_listar', titulo: 'Listar projetos', leitura: true,
      descricao: 'Lista os projetos (pastas de Projects/) com os arquivos que cada um tem (schematic/board/changes/annotations/rules/Gerber). Primeiro passo de qualquer trabalho.',
      entrada: { type: 'object', properties: {} },
      executa: async (a, ctx) => ({
        raiz: ctx.root,
        projetos: ctx.listaProjetos().map(nome => { const p = ctx.projeto(nome); return { nome, arquivos: arquivos(p) }; }),
      }),
    },
    {
      nome: 'projeto_resumo', titulo: 'Resumo do projeto', leitura: true,
      descricao: 'Resumo de um projeto: arquivos, placa (bbox, camadas usadas, contagens, regras, mudanças pendentes e erros de validação), esquema (folhas, componentes, fios), sinalizadores abertos e a URL das vistas no hub. Use antes de editar.',
      entrada: { type: 'object', properties: { projeto: PROJETO }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const out = { projeto: p.nome, pasta: ctx.rel(p.dir), arquivos: arquivos(p) };
        if (out.arquivos.board) { try { out.placa = resumoPlaca(ctx, p); } catch (e) { out.placa = { erro: e.message }; } }
        if (out.arquivos.schematic) { try { out.esquema = resumoEsquema(ctx, p); } catch (e) { out.esquema = { erro: e.message }; } }
        if (out.arquivos.annotations) {
          const anns = ArquivoLinhas.abrir('annotations', p.arq('annotations.js')).itens;
          out.sinalizadores = { total: anns.length, abertos: anns.filter(x => x.status !== 'resolved').map(x => ({ id: x.id, view: x.view, severity: x.severity, msg: x.msg, ref: x.ref })) };
        }
        const hub = await hubNoAr(ctx);
        out.hub = hub ? { url: hub.url, vistas: urlsDaVista(hub.url, p.nome) } : { url: null, nota: 'nenhum hub HTTP respondeu (hub_status)' };
        return out;
      },
    },
    {
      nome: 'projeto_ler_arquivo', titulo: 'Ler arquivo do projeto', leitura: true,
      descricao: 'Lê um arquivo de texto da pasta do projeto (board.js, schematic.js, changes.js, annotations.js, rules.js, build-report.txt, apply-report.txt, Gerber/gerber.json...). Paginado por linhas: use inicio/linhas em arquivos grandes (o board.js passa de milhares de linhas — prefira pcb_consultar).',
      entrada: { type: 'object', properties: {
        projeto: PROJETO,
        arquivo: { type: 'string', description: 'caminho relativo à pasta do projeto, ex.: "changes.js" ou "Gerber/gerber.json"' },
        inicio: { type: 'integer', minimum: 1, description: 'primeira linha (1 = início)' },
        linhas: { type: 'integer', minimum: 1, maximum: 5000, description: 'quantas linhas (padrão 400)' },
      }, required: ['projeto', 'arquivo'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const f = caminhoNoProjeto(p, a.arquivo);
        if (!fs.existsSync(f)) throw new ErroMcp(`não existe: ${a.arquivo}. Na pasta: ${fs.readdirSync(p.dir).join(', ')}`);
        if (fs.statSync(f).isDirectory()) return { pasta: a.arquivo, itens: fs.readdirSync(f) };
        const L = fs.readFileSync(f, 'utf8').split(/\r?\n/);
        const ini = Math.max(1, a.inicio || 1), n = Math.min(5000, a.linhas || 400);
        return { arquivo: ctx.rel(f), total_linhas: L.length, inicio: ini, fim: Math.min(L.length, ini + n - 1),
                 texto: L.slice(ini - 1, ini - 1 + n).join('\n') };
      },
    },
    {
      nome: 'projeto_criar', titulo: 'Criar projeto',
      descricao: 'Cria um projeto novo: Projects/<nome>/ com schematic.js (uma folha vazia no formato schmirror-v2), annotations.js e changes.js vazios, e a entrada no projects.js (como o AI-GUIDE pede). Com "placa" e o módulo hub-pcbnova.js presente, cria também a placa nova (board.js). Depois: sch_adicionar.',
      entrada: { type: 'object', properties: {
        nome: { type: 'string', description: 'nome da pasta do projeto (sem \\ / : * ? " < > |)' },
        folha: { type: 'string', description: 'formato da folha: A4 (padrão), A3, A2, A1, A0 (ISO, como os templates da casa)' },
        retrato: { type: 'boolean', description: 'folha em pé' },
        nome_folha: { type: 'string', description: 'nome da folha (padrão ESQUEMA_1)' },
        placa: { type: 'object', additionalProperties: true, description: 'opcional (hub-pcbnova.js): {largura, altura} em mm, forma retangulo|arredondado (raio), camadas 2|4, origem canto|centro, furos {d, margem} (furos de fixação), codigo "texto" ou null' },
      }, required: ['nome'] },
      executa: async (a, ctx) => {
        const hc = ctx.hc;
        const motivo = nomeDePastaOk(a.nome);
        if (motivo) throw new ErroMcp(`nome inválido: ${motivo}`);
        if (ctx.listaProjetos().some(n => n.toLowerCase() === a.nome.toLowerCase())) throw new ErroMcp(`já existe um projeto "${a.nome}"`);
        const dir = path.join(ctx.dirProjetos(), a.nome);
        const tam = hc.sheetPreset(a.folha || 'A4', !!a.retrato);
        if (!tam) throw new ErroMcp(`folha "${a.folha}" desconhecida (use A4, A3, A2, A1, A0, A, B, C, D, E)`);
        const agora = new Date();
        const quando = agora.toLocaleDateString('pt-BR') + ' ' + agora.toLocaleTimeString('pt-BR');
        const sch = { format: 'schmirror-v2', project: a.nome, generated: quando + ' (EletricHUB MCP)', units: 'mil',
                      items: [{ t: 'sheet', name: a.nome_folha || 'ESQUEMA_1', size: (a.folha || 'A4').toUpperCase(), w: tam[0], h: tam[1] }] };
        const s = hc.serializeSchematic(sch);
        if (!s.text) throw new ErroMcp('schematic inválido: ' + s.errors.map(e => e.msg).join('; '));
        fs.mkdirSync(dir, { recursive: false });
        const p = ctx.projeto(a.nome);
        ctx.grava(p.arq('schematic.js'), s.text, 'projeto_criar');
        ctx.grava(p.arq('annotations.js'), hc.serializeAnnotations([]).text, 'projeto_criar');
        ctx.grava(p.arq('changes.js'), hc.serializeChanges([]).text, 'projeto_criar');
        const out = { ok: true, projeto: a.nome, pasta: ctx.rel(dir), arquivos: ['schematic.js', 'annotations.js', 'changes.js'] };
        /* projects.js: o indice que os scripts do Altium regeneram; o AI-GUIDE manda acrescentar */
        const pj = path.join(path.dirname(ctx.dirProjetos()), 'projects.js');   /* o indice ao lado de Projects/ */
        if (fs.existsSync(pj)) {
          try {
            const arq = ArquivoLinhas.abrir('projects', pj);
            if (!arq.itens.some(x => x && x.name === a.nome)) {
              arq.insere(null, { name: a.nome, files: { schematic: true, board: false, changes: false, annotations: false, buildreport: false, applyreport: false }, indexed: 'criado pelo MCP ' + quando });
              ctx.grava(pj, arq.texto(itens => 'var projects = [\n' + itens.map(x => jline(x) + ',').join('\n') + '\n];\n'), 'projeto_criar');
              out.projects_js = 'entrada acrescentada';
            }
          } catch (e) { out.projects_js = 'não atualizado: ' + e.message; }
        }
        if (a.placa) {
          /* placa nova sem o Altium (hub-pcbnova.js): o board.js mestre, como o assistente da vista */
          try {
            const N = ctx.exige('hub-pcbnova.js', 'HubPcbNova');
            const o = Object.assign({ projeto: a.nome }, a.placa);
            const e = N.erros(Object.assign({ forma: 'retangulo', camadas: 2 }, o));
            if (e.length) throw new ErroMcp('placa: ' + e.join('; '));
            ctx.grava(p.arq('board.js'), N.serializa(N.gera(o)), 'projeto_criar');
            out.placa = { ok: true, arquivo: 'board.js', via: 'HubPcbNova.gera' };
            const R = ctx.modulo('hub-pcbregras.js');
            if (R && !fs.existsSync(p.arq('rules.js'))) { ctx.grava(p.arq('rules.js'), R.serializa(R.padroesCasa()), 'projeto_criar'); out.placa.regras = 'rules.js (padrão da casa)'; }
          } catch (e) { out.placa = { ok: false, erro: e.message }; }
        }
        return out;
      },
    },
    {
      nome: 'projeto_desfazer', titulo: 'Desfazer a última gravação', destrutiva: true,
      descricao: 'Volta a última gravação que ESTA sessão do MCP fez num arquivo do projeto (changes.js, schematic.js, annotations.js ou rules.js). Só desfaz se ninguém mexeu no arquivo depois (o usuário edita pelo hub também); se mexeu, use pcb_mudanca_remover / sch_apagar.',
      entrada: { type: 'object', properties: {
        projeto: PROJETO,
        arquivo: { type: 'string', enum: ['changes.js', 'schematic.js', 'annotations.js', 'rules.js'], description: 'padrão changes.js' },
      }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const f = p.arq(a.arquivo || 'changes.js');
        const pilha = ctx.desfazer.get(f) || [];
        if (!pilha.length) throw new ErroMcp('nada a desfazer nesta sessão para ' + (a.arquivo || 'changes.js'));
        const ult = pilha[pilha.length - 1];
        const atual = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
        if (atual !== ult.depois) throw new ErroMcp('o arquivo mudou depois da última gravação do MCP (outro escritor — o usuário pelo hub?). Não desfiz para não perder o trabalho dele.');
        pilha.pop();
        if (ult.antes === null) fs.unlinkSync(f);
        else require('../lib/arquivo-linhas.js').gravaAtomico(f, ult.antes);
        ctx._cache.clear();
        return { ok: true, desfeito: ult.ferramenta, quando: ult.quando, restam: pilha.length };
      },
    },
  ],
};
