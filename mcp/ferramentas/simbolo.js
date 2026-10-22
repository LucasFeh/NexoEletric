/* NexoEletric MCP - grupo "simbolo": criar e editar SIMBOLOS de esquema.

   Tres lugares onde um simbolo pode morar, e a ferramenta diz qual:
     projeto     o `symbols` do proprio schematic.js (o mesmo campo que guarda os simbolos da folha
                 de um .SchDoc aberto). Vale na hora para aquele projeto, inclusive para as nets e o
                 sch_adicionar; nao depende do hub no ar. E o lugar de um simbolo NOVO de projeto.
     biblioteca  a Biblioteca de simbolos do hub (Libs/symbols-lib.js, a do editor de simbolos e a que
                 se aplica aos componentes do almoxarifado): passa pelo servidor do hub
                 (/api/symbols/lib), que guarda o historico e os vinculos. Uma parte so.
     altium      um simbolo que JA existe na SchLib da casa: o espelho Libs/schlib.js e, com
                 schlib:true, a .SchLib do Altium (/api/symbols/save). Nao cria simbolo novo la.

   Formato (mil, Y para cima, origem do simbolo): pins:[{num, name, x, y, len, orient 0|90|180|270,
   type Input|IO|Output|OpenCollector|Passive|HiZ|OpenEmitter|Power, hideNum?, hideName?}] -- x,y e a
   ponta do CORPO; a ponta quente (onde o fio encosta) e x,y + len na direcao do orient --, e
   graphics:[{g:"line",x1,y1,x2,y2,w} | {g:"rect",x1,y1,x2,y2,w,solid} | {g:"arc",cx,cy,r,sa,ea,w} |
   {g:"ellipse",cx,cy,rx,ry,w,solid} | {g:"poly",pts,w,solid} | {g:"polyline",pts,w} |
   {g:"label",x,y,text,rot,size}], com color/fill "#rrggbb" opcionais. */
'use strict';
const { ArquivoLinhas } = require('../lib/arquivo-linhas.js');
const { ErroMcp } = require('../lib/contexto.js');
const { PROJETO, isNum, hubNoAr } = require('../lib/util.js');

const TIPOS = ['Input', 'IO', 'Output', 'OpenCollector', 'Passive', 'HiZ', 'OpenEmitter', 'Power'];
const CAMPOS = { line: ['x1', 'y1', 'x2', 'y2'], rect: ['x1', 'y1', 'x2', 'y2'], arc: ['cx', 'cy', 'r', 'sa', 'ea'],
                 ellipse: ['cx', 'cy', 'rx', 'ry'], poly: [], polyline: [], label: ['x', 'y'] };
const COR = /^#[0-9a-f]{6}$/;
const copia = o => JSON.parse(JSON.stringify(o));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/* as mesmas regras do _valida_parts do tools/symbols/symserver.py: o que passa aqui o servidor aceita */
function validaParte(pt, onde) {
  const e = [];
  if (!pt || !Array.isArray(pt.pins) || !Array.isArray(pt.graphics)) return [onde + ': precisa de pins[] e graphics[]'];
  const nums = new Set();
  for (const q of pt.pins) {
    if (!q || !['x', 'y', 'len'].every(k => isNum(q[k]))) { e.push(onde + ': pino sem x/y/len numéricos'); continue; }
    if (typeof q.num !== 'string' || typeof q.name !== 'string') e.push(onde + `: pino ${q.num} com num/name que não são texto`);
    if (![0, 90, 180, 270].includes(q.orient)) e.push(onde + `: pino ${q.num} com orient fora de 0/90/180/270`);
    if (!TIPOS.includes(q.type)) e.push(onde + `: pino ${q.num} com type desconhecido (${q.type}); use ${TIPOS.join(', ')}`);
    if (nums.has(q.num)) e.push(onde + `: pino ${q.num} repetido`);
    nums.add(q.num);
  }
  pt.graphics.forEach((g, i) => {
    const o = `${onde}, gráfico ${i + 1}`;
    if (!g || !CAMPOS[g.g]) { e.push(`${o}: forma desconhecida (${g && g.g}); use ${Object.keys(CAMPOS).join(', ')}`); return; }
    for (const c of CAMPOS[g.g]) if (!isNum(g[c])) e.push(`${o}: ${g.g} sem ${c} numérico`);
    if ((g.g === 'poly' || g.g === 'polyline') && (!Array.isArray(g.pts) || g.pts.length < 2 || !g.pts.every(p => Array.isArray(p) && p.length === 2 && p.every(isNum))))
      e.push(`${o}: ${g.g} precisa de pts [[x,y],...] com 2 ou mais pontos`);
    if (g.g === 'label' && typeof g.text !== 'string') e.push(`${o}: label sem text`);
    for (const c of ['color', 'fill']) if (g[c] != null && !(typeof g[c] === 'string' && COR.test(g[c]))) e.push(`${o}: ${c} tem que ser "#rrggbb" minúsculo`);
    if (g.solid != null && typeof g.solid !== 'boolean') e.push(`${o}: solid tem que ser booleano`);
  });
  if (!pt.pins.length && !pt.graphics.length) e.push(onde + ': vazia (sem pinos nem desenho)');
  return e;
}
/* {name, description, designator, parts:[{part, pins, graphics}]} -- aceita tambem {pins, graphics}
   soltos (uma parte) e "desc" no lugar de "description" */
function normaliza(s) {
  if (!s || typeof s !== 'object') throw new ErroMcp('simbolo: objeto {name, parts:[{part, pins, graphics}]} (ou {name, pins, graphics})');
  const o = copia(s);
  if (!o.name || typeof o.name !== 'string' || !o.name.trim()) throw new ErroMcp('simbolo sem "name"');
  o.name = o.name.trim();
  if (o.name.indexOf('":') >= 0) throw new ErroMcp('o nome não pode ter a sequência aspas-dois-pontos');
  if (!Array.isArray(o.parts)) o.parts = [{ part: 1, pins: o.pins || [], graphics: o.graphics || [] }];
  delete o.pins; delete o.graphics;
  o.parts = o.parts.map((p, i) => ({ part: i + 1, pins: (p.pins || []).map(q => Object.assign({ type: 'Passive' }, q, { num: String(q.num), name: String(q.name == null ? q.num : q.name) })), graphics: p.graphics || [] }));
  if (o.desc && !o.description) o.description = o.desc;
  delete o.desc;
  o.partcount = o.parts.length;
  const erros = o.parts.flatMap((p, i) => validaParte(p, 'parte ' + (i + 1)));
  if (erros.length) throw new ErroMcp('símbolo inválido: ' + erros.slice(0, 12).join('; '), { erros });
  return o;
}

/* ---------- gerador: caixa de CI / conector com os pinos em volta ---------- */
const LADOS = { esquerda: 'L', direita: 'R', cima: 'T', baixo: 'B', left: 'L', right: 'R', top: 'T', bottom: 'B', l: 'L', r: 'R', t: 'T', b: 'B' };
function gera(a) {
  const passo = 100, len = isNum(a.comprimento_pino) ? Math.round(a.comprimento_pino / 100) * 100 || 200 : 200;
  const pinos = (a.pinos || []).map((p, i) => typeof p === 'string' ? { num: String(i + 1), nome: p } : p);
  if (!pinos.length) throw new ErroMcp('pinos: [{num, nome, lado, tipo}] (ou só os nomes, em ordem)');
  /* sem lado: os de alimentacao em cima/baixo, entradas a esquerda, saidas a direita, e o resto em metades */
  const lados = { L: [], R: [], T: [], B: [] };
  const sem = [];
  for (const p of pinos) {
    const l = p.lado && LADOS[String(p.lado).toLowerCase()];
    if (l) lados[l].push(p); else sem.push(p);
  }
  if (sem.length) {
    if (a.distribuir === 'auto') {
      for (const p of sem) {
        const n = norm(p.nome);
        if (/^(gnd|vss|agnd|dgnd|0v|terra)/.test(n)) lados.B.push(p);
        else if (/^(vcc|vdd|v\+|3v3|5v|vin|vbat|avcc|vref)/.test(n)) lados.T.push(p);
        else if ((p.tipo || '') === 'Output') lados.R.push(p);
        else if ((p.tipo || '') === 'Input') lados.L.push(p);
        else (lados.L.length <= lados.R.length ? lados.L : lados.R).push(p);
      }
    } else {
      const meio = Math.ceil(sem.length / 2);
      lados.L.push(...sem.slice(0, meio)); lados.R.push(...sem.slice(meio).reverse());
    }
  }
  const maxNome = l => Math.max(0, ...lados[l].map(p => String(p.nome || '').length));
  const larguraTexto = Math.ceil(((maxNome('L') + maxNome('R')) * 60 + 200) / passo) * passo;
  const w = Math.max(isNum(a.largura) ? Math.ceil(a.largura / passo) * passo : 0, larguraTexto, (Math.max(lados.T.length, lados.B.length) + 1) * passo, 400);
  const h = Math.max((Math.max(lados.L.length, lados.R.length) + 1) * passo, 300);
  const pins = [];
  const poe = (p, x, y, orient) => pins.push({ num: String(p.num), name: String(p.nome == null ? p.num : p.nome), x, y, len, orient,
    type: TIPOS.includes(p.tipo) ? p.tipo : 'Passive', ...(p.esconder_nome ? { hideName: true } : {}) });
  lados.L.forEach((p, i) => poe(p, 0, -(i + 1) * passo, 180));
  lados.R.forEach((p, i) => poe(p, w, -(i + 1) * passo, 0));
  lados.T.forEach((p, i) => poe(p, (i + 1) * passo, 0, 90));
  lados.B.forEach((p, i) => poe(p, (i + 1) * passo, -h, 270));
  const graphics = [{ g: 'rect', x1: 0, y1: 0, x2: w, y2: -h, w: 1, solid: true, color: '#800000', fill: '#ffffb0' }];
  return { name: a.nome, description: a.descricao || '', designator: a.designador || 'U?', partcount: 1,
           parts: [{ part: 1, pins, graphics }], ...(a.footprint ? { footprints: [{ name: a.footprint, current: true }] } : {}) };
}

/* ---------- onde mora ---------- */
function abreEsquema(ctx, nome) {
  const p = ctx.projeto(nome);
  const arq = ArquivoLinhas.abrir('schematic', p.arq('schematic.js'));
  if (arq.valor === undefined) throw new ErroMcp(`o projeto "${p.nome}" não tem schematic.js (projeto_criar faz um)`);
  const cab = Object.assign({}, arq.valor); delete cab.items;
  cab.symbols = Array.isArray(cab.symbols) ? cab.symbols.slice() : [];
  return { p, arq, cab };
}
function gravaEsquema(ctx, e, ferramenta) {
  const sch = Object.assign({}, e.cab, { items: e.arq.itens });
  if (!sch.symbols.length) delete sch.symbols;
  const ser = ctx.hc.serializeSchematic(sch);
  if (!ser.text || (ser.errors || []).length) throw new ErroMcp('o esquema não fecha: ' + (ser.errors || []).map(x => x.msg).join('; '));
  return ctx.grava(e.p.arq('schematic.js'), ser.text, ferramenta);
}
async function hubPost(ctx, caminho, corpo) {
  const hub = await hubNoAr(ctx);
  if (!hub) throw new ErroMcp('o hub não está no ar: a Biblioteca de símbolos e a SchLib passam pelo servidor do hub (abra o NexoEletric, ou app_abrir)');
  const r = await fetch(hub.url + caminho, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(60000) });
  let j = null; try { j = await r.json(); } catch (_) { /* sem corpo */ }
  if (!j || j.ok === false) throw new ErroMcp(((j && (j.error || j.erro)) || ('o servidor recusou (HTTP ' + r.status + ')')), j || undefined);
  return j;
}
function daBiblioteca(ctx, nome) {
  const L = (ctx.symbolsLib().symbols || []);
  return L.find(s => s.name === nome) || L.find(s => (s.aliases || []).includes(nome)) || L.find(s => norm(s.name) === norm(nome)) || null;
}

/* o simbolo, de onde vier: o do projeto, o das bibliotecas da vista (Altium + almoxarifado) e o da
   Biblioteca de simbolos */
function acha(ctx, nome, projeto) {
  if (projeto) {
    const sch = ctx.schematic(ctx.projeto(projeto));
    const s = (sch.symbols || []).find(x => x && x.name === nome);
    if (s) return { origem: 'projeto', s: copia(s) };
  }
  const L = ctx.libs();
  const s = ctx.hc.symbolOf(L.schlib, nome);
  if (s) return { origem: L.acervoDe.get(s.name) === 'altium' ? 'altium' : (L.acervoDe.get(s.name) || 'biblioteca da vista'), s: copia(s) };
  const b = daBiblioteca(ctx, nome);
  if (b) return { origem: 'biblioteca', s: { name: b.name, description: b.desc || '', id: b.id, kind: b.kind, aliases: b.aliases, partcount: 1, parts: [{ part: 1, pins: b.pins || [], graphics: b.graphics || [] }] } };
  return null;
}
const ponta = p => { const d = { 0: [1, 0], 90: [0, 1], 180: [-1, 0], 270: [0, -1] }[p.orient] || [0, 0]; return [p.x + p.len * d[0], p.y + p.len * d[1]]; };

module.exports = {
  grupo: 'simbolo',
  ordem: 22,
  titulo: 'Símbolo — criar e editar símbolos de esquema (no projeto, na Biblioteca de símbolos ou no espelho do Altium)',
  modulos: ['hub-core.js'],
  ferramentas: [
    {
      nome: 'sym_ler', titulo: 'Ler símbolo (desenho completo)', leitura: true,
      descricao: 'O símbolo inteiro, para editar: partes com pinos (num, name, x, y, len, orient, type e a ponta quente) e gráficos, e de onde ele vem (projeto, altium, almoxarifado ou biblioteca). Com "projeto" acha também os símbolos guardados no esquema do projeto. Edite o objeto e devolva em sym_salvar.',
      entrada: { type: 'object', properties: { nome: { type: 'string' }, projeto: Object.assign({}, PROJETO, { description: 'opcional: inclui os símbolos do esquema do projeto' }) }, required: ['nome'] },
      executa: async (a, ctx) => {
        const r = acha(ctx, a.nome, a.projeto);
        if (!r) throw new ErroMcp(`símbolo "${a.nome}" não existe (sch_buscar_simbolo)`);
        const s = r.s;
        for (const pt of s.parts || []) for (const q of pt.pins || []) q.ponta_quente = ponta(q);
        return { origem: r.origem, simbolo: s, editavel_em: r.origem === 'projeto' ? 'projeto' : r.origem === 'biblioteca' ? 'biblioteca' : r.origem === 'altium' ? 'altium (só desenho; o nome fica) ou copie para o projeto' : 'copie para o projeto (destino "projeto") com outro nome' };
      },
    },
    {
      nome: 'sym_gerar', titulo: 'Gerar símbolo de CI / conector',
      descricao: 'Monta um símbolo retangular (caixa com os pinos em volta, na grade de 100 mil, pinos de 200 mil) a partir da lista de pinos — o jeito rápido de criar o símbolo de um CI, módulo ou conector. pinos: [{num, nome, lado: esquerda|direita|cima|baixo, tipo: Input|Output|IO|Passive|Power|…}] ou só os nomes em ordem. Sem lado, divide em duas metades (ou, com distribuir:"auto", alimentação em cima/baixo, entradas à esquerda, saídas à direita). Com "salvar_em" já grava (projeto ou biblioteca); sem, só devolve o símbolo para conferir/ajustar e passar ao sym_salvar.',
      entrada: { type: 'object', properties: {
        nome: { type: 'string' }, descricao: { type: 'string' }, designador: { type: 'string', description: 'prefixo + "?", ex.: "U?", "J?", "Q?" (padrão U?)' },
        footprint: { type: 'string', description: 'footprint padrão (o sch_adicionar usa)' },
        pinos: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'object', properties: { num: { type: 'string' }, nome: { type: 'string' }, lado: { type: 'string' }, tipo: { type: 'string', enum: TIPOS }, esconder_nome: { type: 'boolean' } } }] } },
        distribuir: { type: 'string', enum: ['metades', 'auto'] }, largura: { type: 'number', description: 'mil (mínimo; cresce com os nomes)' }, comprimento_pino: { type: 'number', description: 'mil, padrão 200' },
        salvar_em: { type: 'string', enum: ['projeto', 'biblioteca'] }, projeto: PROJETO, substituir: { type: 'boolean' },
      }, required: ['nome', 'pinos'] },
      executa: async (a, ctx, srv) => {
        const s = normaliza(gera(a));
        if (!a.salvar_em) return { simbolo: s, pinos: s.parts[0].pins.length, nota: 'nada gravado: passe ao sym_salvar (destino "projeto" ou "biblioteca"), ou repita com salvar_em' };
        const f = srv.reg.get('sym_salvar');
        return f.executa({ simbolo: s, destino: a.salvar_em, projeto: a.projeto, substituir: a.substituir }, ctx, srv);
      },
    },
    {
      nome: 'sym_salvar', titulo: 'Salvar símbolo', destrutiva: true,
      descricao: 'Grava um símbolo (o objeto de sym_ler/sym_gerar). destino "projeto": no esquema do projeto (vale na hora para sch_adicionar, nets e a vista; não precisa do hub) — cria ou, com substituir, troca. destino "biblioteca": na Biblioteca de símbolos do hub (uma parte; precisa do hub no ar) — cria ou atualiza pelo nome. destino "altium": troca o DESENHO de um símbolo que já existe na SchLib da casa (espelho Libs/schlib.js; com schlib:true também a .SchLib do Altium) — não cria símbolo novo lá.',
      entrada: { type: 'object', properties: {
        simbolo: { type: 'object', description: '{name, description?, designator?, footprints?, parts:[{part, pins, graphics}]} ou {name, pins, graphics}' },
        destino: { type: 'string', enum: ['projeto', 'biblioteca', 'altium'] }, projeto: PROJETO,
        substituir: { type: 'boolean', description: 'projeto: troca o que já existe com o mesmo nome' },
        schlib: { type: 'boolean', description: 'altium: grava também na .SchLib do Altium (padrão false: só o espelho)' },
      }, required: ['simbolo', 'destino'] },
      executa: async (a, ctx) => {
        const s = normaliza(a.simbolo);
        if (a.destino === 'projeto') {
          if (!a.projeto) throw new ErroMcp('destino "projeto" precisa de "projeto"');
          const e = abreEsquema(ctx, a.projeto);
          const i = e.cab.symbols.findIndex(x => x && x.name === s.name);
          if (i >= 0 && !a.substituir) throw new ErroMcp(`o projeto já tem o símbolo "${s.name}": passe substituir:true para trocar`);
          const doLib = ctx.hc.symbolOf(ctx.libs().schlib, s.name);
          const novo = Object.assign({}, s, { origem: 'mcp', editado: new Date().toISOString() });
          if (i >= 0) e.cab.symbols[i] = novo; else e.cab.symbols.push(novo);
          const gravado = gravaEsquema(ctx, e, 'sym_salvar');
          return { gravado, destino: 'projeto', projeto: e.p.nome, simbolo: s.name, partes: s.parts.length, pinos: s.parts.reduce((n, p) => n + p.pins.length, 0), substituiu: i >= 0,
                   aviso: doLib ? `a biblioteca já tem um "${s.name}": ela continua mandando (o do projeto só vale onde nenhum acervo resolve o nome). Use outro nome para valer o seu.` : undefined,
                   proximo: `sch_adicionar {"t":"comp","sym":"${s.name}", ...} no projeto` };
        }
        if (a.destino === 'biblioteca') {
          if (s.parts.length > 1) throw new ErroMcp('a Biblioteca de símbolos guarda uma parte por símbolo: salve cada parte com um nome, ou use destino "projeto"');
          const pt = s.parts[0];
          const ja = daBiblioteca(ctx, s.name);
          const j = ja && ja.name === s.name
            ? await hubPost(ctx, '/api/symbols/lib', { op: 'update', id: ja.id, pins: pt.pins, graphics: pt.graphics, desc: s.description || undefined })
            : await hubPost(ctx, '/api/symbols/lib', { op: 'add', symbol: { name: s.name, desc: s.description || '', pins: pt.pins, graphics: pt.graphics } });
          return { gravado: true, destino: 'biblioteca', simbolo: s.name, operacao: ja ? 'atualizado' : 'criado', resposta: j };
        }
        if (a.destino === 'altium') {
          const L = ctx.libs();
          if (L.acervoDe.get(s.name) !== 'altium') throw new ErroMcp(`"${s.name}" não está na SchLib da casa (Libs/schlib.js): o destino "altium" só troca o desenho de um símbolo que já existe lá. Para um símbolo novo use "projeto" ou "biblioteca".`);
          const j = await hubPost(ctx, '/api/symbols/save', { name: s.name, parts: s.parts, description: s.description, altium: !!a.schlib });
          return { gravado: true, destino: 'altium', simbolo: s.name, espelho: j.espelho, schlib: j.altium, avisos: j.avisos, backup: j.backup };
        }
        throw new ErroMcp('destino: projeto, biblioteca ou altium');
      },
    },
    {
      nome: 'sym_renomear', titulo: 'Renomear símbolo', destrutiva: true,
      descricao: 'Troca o nome de um símbolo do projeto (e o "sym" dos componentes do esquema que o usam) ou da Biblioteca de símbolos.',
      entrada: { type: 'object', properties: { nome: { type: 'string' }, novo: { type: 'string' }, destino: { type: 'string', enum: ['projeto', 'biblioteca'] }, projeto: PROJETO }, required: ['nome', 'novo', 'destino'] },
      executa: async (a, ctx) => {
        if (a.destino === 'projeto') {
          const e = abreEsquema(ctx, a.projeto);
          const s = e.cab.symbols.find(x => x && x.name === a.nome);
          if (!s) throw new ErroMcp(`o projeto não tem o símbolo "${a.nome}"`);
          if (e.cab.symbols.some(x => x && x.name === a.novo)) throw new ErroMcp(`o projeto já tem um "${a.novo}"`);
          s.name = a.novo;
          let n = 0;
          for (const it of e.arq.itens) if (it && it.t === 'comp' && it.sym === a.nome) { it.sym = a.novo; n++; }
          return { gravado: gravaEsquema(ctx, e, 'sym_renomear'), componentes_atualizados: n };
        }
        const b = daBiblioteca(ctx, a.nome);
        if (!b) throw new ErroMcp(`"${a.nome}" não está na Biblioteca de símbolos`);
        return { gravado: true, resposta: await hubPost(ctx, '/api/symbols/lib', { op: 'rename', id: b.id, name: a.novo }) };
      },
    },
    {
      nome: 'sym_apagar', titulo: 'Apagar símbolo', destrutiva: true,
      descricao: 'Tira um símbolo do projeto (recusa se algum componente do esquema ainda o usa, a menos que forcar) ou da Biblioteca de símbolos (os componentes que o usavam ficam com o desenho, só perdem o vínculo). A SchLib do Altium não é tocada.',
      entrada: { type: 'object', properties: { nome: { type: 'string' }, destino: { type: 'string', enum: ['projeto', 'biblioteca'] }, projeto: PROJETO, forcar: { type: 'boolean' } }, required: ['nome', 'destino'] },
      executa: async (a, ctx) => {
        if (a.destino === 'projeto') {
          const e = abreEsquema(ctx, a.projeto);
          const i = e.cab.symbols.findIndex(x => x && x.name === a.nome);
          if (i < 0) throw new ErroMcp(`o projeto não tem o símbolo "${a.nome}"`);
          const usam = e.arq.itens.filter(it => it && it.t === 'comp' && it.sym === a.nome).map(it => it.ref);
          if (usam.length && !a.forcar) throw new ErroMcp(`${usam.length} componente(s) usam "${a.nome}" (${usam.slice(0, 10).join(', ')}): troque o sym deles ou passe forcar:true`);
          e.cab.symbols.splice(i, 1);
          return { gravado: gravaEsquema(ctx, e, 'sym_apagar'), componentes_sem_simbolo: usam };
        }
        const b = daBiblioteca(ctx, a.nome);
        if (!b) throw new ErroMcp(`"${a.nome}" não está na Biblioteca de símbolos`);
        return { gravado: true, resposta: await hubPost(ctx, '/api/symbols/lib', { op: 'delete', id: b.id }) };
      },
    },
  ],
  _interno: { gera, normaliza, validaParte },
};
