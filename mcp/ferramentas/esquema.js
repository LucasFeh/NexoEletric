/* NexoEletric MCP - grupo "esquema": o schematic.js (schmirror-v2, AI-GUIDE Parte A).
   Coordenadas em mil, Y para cima, grade de 100 mil, rot 0/90/180/270. As bibliotecas sao so
   LIDAS (Libs/ e do hub e do almoxarifado; o MCP nunca grava la). */
'use strict';
const { ArquivoLinhas } = require('../lib/arquivo-linhas.js');
const { ErroMcp } = require('../lib/contexto.js');
const { PROJETO, isNum } = require('../lib/util.js');

const COMUNS = {
  simular: { type: 'boolean', description: 'true = só valida, não grava' },
  forcar: { type: 'boolean', description: 'grava mesmo com erro novo de validação (evite)' },
};
const TIPOS_ITEM = ['sheet', 'comp', 'wire', 'netlabel', 'power', 'port', 'junction', 'noerc', 'text'];

/* ---------- busca na biblioteca ---------- */
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function pontua(s, termos) {
  const nome = norm(s.name), desc = norm(s.description || s.desc), extra = norm((s.familia || '') + ' ' + (s.designator || '') + ' ' + (s.aliases || []).join(' '));
  let p = 0;
  for (const t of termos) {
    if (nome === t) p += 50;
    else if (nome.startsWith(t)) p += 20;
    else if (nome.includes(t)) p += 10;
    else if (desc.includes(t)) p += 5;
    else if (extra.includes(t)) p += 3;
    else return 0;
  }
  return p;
}
function footprintAtual(sym) { const f = (sym.footprints || []).find(x => x.current) || (sym.footprints || [])[0]; return f ? f.name : ''; }
function pinosDe(hc, sym, part) {
  const pt = hc.partOf(sym, part || 1);
  if (!pt) return [];
  return (pt.pins || []).map(p => { const h = hc.pinHot(p); return { num: p.num, name: p.name, tipo: p.type, corpo: [p.x, p.y], ponta_quente: [h.x, h.y], orient: p.orient, len: p.len }; });
}

/* ---------- transacao no schematic.js ---------- */
function transacao(ctx, p, fn, opts) {
  const o = opts || {};
  const hc = ctx.hc;
  const arq = ArquivoLinhas.abrir('schematic', p.arq('schematic.js'));
  const L = ctx.libsDe(arq.valor);
  if (arq.valor === undefined) throw new ErroMcp(`o projeto "${p.nome}" não tem schematic.js (projeto_criar faz um)`);
  const cab = Object.assign({}, arq.valor); delete cab.items;
  const sch0 = Object.assign({}, cab, { items: arq.itens.slice() });
  const antes = hc.validateSchematic(sch0, L.schlib, L.pcblib, netsOuNada(hc, sch0, L));
  const tocados = fn(arq, L) || [];
  const sch = Object.assign({}, cab, { items: arq.itens });
  const nx = netsOuNada(hc, sch, L);
  const v = hc.validateSchematic(sch, L.schlib, L.pcblib, nx);
  const ja = new Set(antes.errors), jaAv = new Set(antes.warnings);
  const novos = v.errors.filter(e => !ja.has(e));
  const ser = hc.serializeSchematic(sch);
  for (const e of ser.errors || []) novos.push((e.idx >= 0 ? `item #${e.idx}: ` : '') + e.msg);
  let nets = null;
  if (nx) nets = { total: nx.nets.length, avisos: nx.warnings.slice(0, 15) };
  else { try { hc.extractNets(sch, L.schlib); } catch (e) { nets = { erro: e.message }; } }
  const estado = {
    ok: !novos.length, gravado: false, arquivo: ctx.rel(p.arq('schematic.js')), itens_no_arquivo: arq.itens.length,
    tocados: tocados.map(t => ({ indice: arq.itens.indexOf(t), item: t })),
    erros: novos, avisos_novos: v.warnings.filter(w => !jaAv.has(w)).slice(0, 40),
    validacao: { erros: v.errors.length, avisos: v.warnings.length }, nets,
  };
  if (o.simular) { estado.simulado = true; return estado; }
  if (novos.length && !o.forcar) { estado.dica = 'Nada foi gravado. Corrija os erros (sch_simbolo mostra pinos e footprint).'; return estado; }
  if (!ser.text) { estado.dica = 'o formato não fecha; nada gravado'; return estado; }
  const texto = arq.texto(itens => hc.serializeSchematic(Object.assign({}, cab, { items: itens })).text);
  estado.gravado = ctx.grava(p.arq('schematic.js'), texto, o.ferramenta);
  return estado;
}

/* o extractNets para a validacao (pinos sem ligacao, pontas soltas); esquema quebrado = null */
function netsOuNada(hc, sch, L) { try { return hc.extractNets(sch, L.schlib); } catch (_) { return null; } }

/* o prefixo do designador: "R12" -> "R", "CI4" -> "CI", "RV1" -> "RV" */
const prefixoDe = ref => String(ref || '').replace(/[0-9].*$/, '').toUpperCase();
/* filtro de componente: ref exato, lista de refs, ou prefixo do designador ("R" = todos os
   resistores, sem pegar RV1 nem o "C" de CI1) */
function casaRef(a) {
  const refs = Array.isArray(a.refs) && a.refs.length ? new Set(a.refs.map(String)) : null;
  const pref = a.prefixo ? String(a.prefixo).toUpperCase() : '';
  return ref => (!a.ref || ref === a.ref) && (!refs || refs.has(ref)) && (!pref || prefixoDe(ref) === pref);
}
const FILTRO_REF = {
  ref: { type: 'string', description: 'designador exato (R5)' },
  refs: { type: 'array', items: { type: 'string' }, description: 'lista de designadores' },
  prefixo: { type: 'string', description: 'prefixo do designador: "R" = R1, R2... (não pega RV1 nem CI1 no "C")' },
};
/* o item tem um ponto em (x,y)? ancora (rotulo, power, port, juncao, No ERC, texto, comp) ou,
   no fio, um vertice ou um ponto de um segmento */
function itemEm(it, x, y) {
  const T = 0.5;
  if (!it) return false;
  if (it.t === 'wire') {
    const p = it.pts || [];
    for (let i = 0; i < p.length; i++) {
      if (Math.abs(p[i][0] - x) <= T && Math.abs(p[i][1] - y) <= T) return true;
      if (i && distSeg(x, y, p[i - 1], p[i]) <= T) return true;
    }
    return false;
  }
  return isNum(it.x) && isNum(it.y) && Math.abs(it.x - x) <= T && Math.abs(it.y - y) <= T;
}
function distSeg(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2)) : 0;
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
}
/* os indices que um alvo {t?, x, y, folha?, net?} acha (sch_apagar/sch_editar sem depender de indice) */
function achaEm(itens, alvo) {
  if (!alvo || !isNum(alvo.x) || !isNum(alvo.y)) throw new ErroMcp('cada alvo de "em" precisa de x e y (mil)');
  const r = [];
  itens.forEach((it, i) => {
    if (!it || it.t === 'sheet') return;
    if (alvo.t && it.t !== alvo.t) return;
    if (alvo.folha && it.sheet !== alvo.folha) return;
    if (alvo.net && it.net !== alvo.net) return;
    if (itemEm(it, alvo.x, alvo.y)) r.push(i);
  });
  return r;
}
const ALVO_EM = { type: 'array', items: { type: 'object', properties: { t: { type: 'string', enum: TIPOS_ITEM }, x: { type: 'number' }, y: { type: 'number' }, folha: { type: 'string' }, net: { type: 'string' } }, required: ['x', 'y'] },
  description: 'achar pelo lugar em vez do índice (que muda depois de cada sch_apagar): [{t:"wire", x, y}] pega o fio que passa ou tem vértice em (x,y); rótulo/power/port/junção/No ERC/texto pela âncora. t, folha e net estreitam.' };

/* o proximo designador livre para o prefixo ("R" -> R7) */
function proximoRef(itens, prefixo) {
  let n = 0;
  const re = new RegExp('^' + prefixo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)$');
  for (const it of itens) if (it && it.t === 'comp') { const m = re.exec(it.ref || ''); if (m) n = Math.max(n, +m[1]); }
  return prefixo + (n + 1);
}
/* completa um item com o que o AI-GUIDE pede e a IA pode ter omitido */
function completa(it, arq, L, hc) {
  const o = Object.assign({}, it);
  if (!TIPOS_ITEM.includes(o.t)) throw new ErroMcp(`tipo "${o.t}" desconhecido (use ${TIPOS_ITEM.join(', ')})`);
  if (o.t !== 'sheet' && !o.sheet) {
    const f = arq.itens.find(x => x && x.t === 'sheet');
    if (!f) throw new ErroMcp('o esquema não tem folha; acrescente {"t":"sheet","name":"ESQUEMA_1","size":"A4"} primeiro');
    o.sheet = f.name;
  }
  if (o.t === 'comp') {
    const sym = hc.symbolOf(L.schlib, o.sym);
    if (!sym) throw new ErroMcp(`símbolo "${o.sym}" não existe nas bibliotecas (sch_buscar_simbolo)`);
    if (!o.ref || /\?$/.test(o.ref)) o.ref = proximoRef(arq.itens, (o.ref || sym.designator || 'U?').replace(/\?+$/, '') || 'U');
    if (o.part == null) o.part = 1;
    if (o.rot == null) o.rot = 0;
    if (o.mirror == null) o.mirror = false;
    if (o.footprint == null) o.footprint = footprintAtual(sym);
  }
  if ((o.t === 'netlabel' || o.t === 'power') && o.rot == null) o.rot = 0;
  if (o.t === 'power' && !o.style) o.style = /gnd|terra|0v/i.test(o.net || '') ? 'GndPower' : 'Bar';
  return o;
}

/* "R1.2" (ref.pino) ou [x,y] -> {x, y, sheet} */
function pontoSch(ctx, itens, L, v, nome) {
  if (Array.isArray(v) && v.length === 2 && v.every(isNum)) return { x: v[0], y: v[1], sheet: null };
  const s = String(v), i = s.lastIndexOf('.');
  if (i <= 0) throw new ErroMcp(`${nome}: use [x,y] em mil ou "REF.PINO" (ex.: "R1.2")`);
  const ref = s.slice(0, i), pino = s.slice(i + 1);
  const comps = itens.filter(x => x && x.t === 'comp' && x.ref === ref);
  if (!comps.length) throw new ErroMcp(`${nome}: componente "${ref}" não está no esquema`);
  for (const c of comps) {
    const P = ctx.hc.compPinsWorld(c, L.schlib) || [];
    const q = P.find(x => String(x.num) === pino) || P.find(x => String(x.name) === pino);
    if (q) return { x: q.x, y: q.y, sheet: c.sheet };
  }
  throw new ErroMcp(`${nome}: pino "${pino}" não existe em ${ref} (sch_componentes mostra os pinos)`);
}

module.exports = {
  grupo: 'esquema',
  ordem: 20,
  titulo: 'Esquema — schematic.js (schmirror-v2)',
  modulos: ['hub-core.js', 'Libs/schlib.js', 'Libs/pcblib.js', 'hub-schtemplate.js'],
  ferramentas: [
    {
      nome: 'sch_ler', titulo: 'Ler itens do esquema', leitura: true,
      descricao: 'Lista os itens do schematic.js com o índice de cada um (para sch_editar/sch_apagar). Filtros: folha, tipo (comp, wire, netlabel, power, port, junction, noerc, text, sheet), ref/refs/prefixo (componentes), net (rótulo/power/port), caixa em mil. cabecalho: "resumo" (padrão: os campos do arquivo e os NOMES dos símbolos guardados), "completo" (com o desenho de cada símbolo — grande; sym_ler mostra um só) ou "nenhum". campos limita os campos de cada item.',
      entrada: { type: 'object', properties: Object.assign({ projeto: PROJETO, folha: { type: 'string' }, tipo: { type: 'string', enum: TIPOS_ITEM } }, FILTRO_REF, {
        net: { type: 'string' },
        caixa: { type: 'object', properties: { x1: { type: 'number' }, y1: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' } } },
        cabecalho: { type: 'string', enum: ['resumo', 'completo', 'nenhum'] },
        campos: { type: 'array', items: { type: 'string' }, description: 'só estes campos de cada item (t e sheet vêm sempre), ex.: ["ref","sym","x","y"]' },
        limite: { type: 'integer', minimum: 1, maximum: 3000 }, pular: { type: 'integer', minimum: 0 } }), required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const s = ctx.schematic(p);
        const cx = a.caixa;
        const dentro = it => {
          if (!cx) return true;
          const pts = it.pts || (isNum(it.x) ? [[it.x, it.y]] : []);
          return pts.some(q => q[0] >= Math.min(cx.x1, cx.x2) && q[0] <= Math.max(cx.x1, cx.x2) && q[1] >= Math.min(cx.y1, cx.y2) && q[1] <= Math.max(cx.y1, cx.y2));
        };
        const porRef = a.ref || a.refs || a.prefixo ? casaRef(a) : null;
        const L = (s.items || []).map((it, indice) => ({ indice, item: it }))
          .filter(x => (!a.folha || x.item.sheet === a.folha || x.item.name === a.folha) && (!a.tipo || x.item.t === a.tipo)
            && (!porRef || (x.item.t === 'comp' && porRef(x.item.ref))) && (!a.net || x.item.net === a.net) && dentro(x.item));
        const ini = a.pular || 0, lim = a.limite || 300;
        const corta = it => {
          if (!Array.isArray(a.campos) || !a.campos.length) return it;
          const o = { t: it.t, sheet: it.sheet };
          for (const k of a.campos) if (k in it) o[k] = it[k];
          return o;
        };
        const r = { total: L.length, mostrando: [ini, Math.min(L.length, ini + lim)], itens: L.slice(ini, ini + lim).map(x => ({ indice: x.indice, item: corta(x.item) })) };
        const modo = a.cabecalho || 'resumo';
        if (modo !== 'nenhum') {
          const cab = Object.assign({}, s); delete cab.items;
          if (modo === 'resumo' && Array.isArray(cab.symbols)) { cab.simbolos_guardados = cab.symbols.map(x => x && x.name); delete cab.symbols; }
          r.cabecalho = cab;
        }
        return r;
      },
    },
    {
      nome: 'sch_componentes', titulo: 'Componentes e pinos', leitura: true,
      descricao: 'Os componentes do esquema com a PONTA QUENTE de cada pino em coordenada da folha (onde o fio tem de encostar) e a net em que cada pino está (solto: true = pino sem ligação: nenhum fio, rótulo ou outro pino; No ERC na ponta não conta). Use antes de desenhar fios. Filtros: ref, refs, prefixo ("R" = todos os resistores), folha. pinos: "todos" (padrão), "soltos" (só os sem ligação; some o componente que não tem nenhum) ou "nenhum". campos limita os campos de cada componente.',
      entrada: { type: 'object', properties: Object.assign({ projeto: PROJETO }, FILTRO_REF, { folha: { type: 'string' },
        pinos: { type: 'string', enum: ['todos', 'soltos', 'nenhum'] },
        campos: { type: 'array', items: { type: 'string' }, description: 'ex.: ["ref","sym","comment","footprint"] (ref vem sempre)' } }), required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const s = ctx.schematic(p), L = ctx.libsDe(s), hc = ctx.hc;
        let pinNet = {};
        const soltos = new Set();
        try {
          const n = hc.extractNets(s, L.schlib);
          pinNet = n.pinNet || {};
          for (const q of n.pinosSoltos || []) soltos.add(q.ref + '-' + q.num);
        } catch (_) { /* esquema quebrado: segue sem nets */ }
        const porRef = casaRef(a), modo = a.pinos || 'todos';
        const comps = (s.items || []).map((it, indice) => ({ it, indice })).filter(x => x.it.t === 'comp' && porRef(x.it.ref) && (!a.folha || x.it.sheet === a.folha));
        if ((a.ref || a.refs || a.prefixo) && !comps.length) throw new ErroMcp(`nenhum componente com ${a.ref ? '"' + a.ref + '"' : a.prefixo ? 'o prefixo "' + a.prefixo + '"' : 'esses refs'} no esquema`);
        const out = [];
        for (const { it, indice } of comps) {
          const P = hc.compPinsWorld(it, L.schlib);
          let pinos = (P || []).map(q => {
            const k = it.ref + '-' + q.num, o = { num: q.num, name: q.name, x: q.x, y: q.y, net: pinNet[k] || '' };
            if (soltos.has(k)) o.solto = true;
            return o;
          });
          if (modo === 'soltos') { pinos = pinos.filter(q => q.solto); if (!pinos.length && P) continue; }
          let c = { indice, ref: it.ref, sym: it.sym, part: it.part || 1, sheet: it.sheet, x: it.x, y: it.y, rot: it.rot, mirror: !!it.mirror, footprint: it.footprint, comment: it.comment,
                    simbolo_encontrado: !!P };
          if (modo !== 'nenhum') c.pinos = pinos;
          if (Array.isArray(a.campos) && a.campos.length) {
            const o = { ref: c.ref };
            for (const k of a.campos) if (k in c) o[k] = c[k];
            c = o;
          }
          out.push(c);
        }
        return { total: out.length, componentes: out };
      },
    },
    {
      nome: 'sch_nets', titulo: 'Nets do esquema', leitura: true,
      descricao: 'Extrai as nets do esquema como o hub (HubCore.extractNets — prévia; a verdade é o compilador do Altium): nome, pinos (REF-PINO) e avisos (nomeador solto, nomes conflitantes, componente sem símbolo).',
      entrada: { type: 'object', properties: { projeto: PROJETO, net: { type: 'string' } }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const s0 = ctx.schematic(p);
        const r = ctx.hc.extractNets(s0, ctx.libsDe(s0).schlib);
        const nets = r.nets.filter(n => !a.net || n.name === a.net);
        return { total: r.nets.length, nets, avisos: r.warnings, juncoes_automaticas: (r.autoJunctions || []).length };
      },
    },
    {
      nome: 'sch_adicionar', titulo: 'Adicionar itens ao esquema',
      descricao: 'Acrescenta itens ao schematic.js (um por linha, formato schmirror-v2): comp {sym, x, y, rot?, mirror?, ref? (sem ref ou "R?" = próximo livre), footprint? (padrão: o do símbolo), comment?, part?}, wire {pts:[[x,y],...]}, netlabel {net,x,y}, power {net, style?, x, y, rot?}, port {net,x,y,io?,style?,w?}, junction {x,y}, noerc {x,y}, text {s,x,y}, sheet {name,size}. sheet padrão = a primeira folha. Coordenadas em mil, grade de 100. Valida (símbolo, footprint, pinos x pads, grade) antes de gravar.',
      entrada: { type: 'object', properties: Object.assign({ projeto: PROJETO,
        itens: { type: 'array', minItems: 1, items: { type: 'object', properties: { t: { type: 'string', enum: TIPOS_ITEM } }, required: ['t'], additionalProperties: true } } }, COMUNS),
        required: ['projeto', 'itens'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        return transacao(ctx, p, (arq, L) => a.itens.map(it => { const o = completa(it, arq, L, ctx.hc); arq.insere(null, o); return o; }),
          { simular: a.simular, forcar: a.forcar, ferramenta: 'sch_adicionar' });
      },
    },
    {
      nome: 'sch_editar', titulo: 'Editar item do esquema',
      descricao: 'Muda campos de um item do schematic.js, achado por índice (sch_ler), por ref (componente) ou pelo lugar (em: {t, x, y} — tem de achar um item só). Ex.: mover {x, y}, girar {rot}, trocar {footprint}, {comment}, {sym}. remover_campos tira campos opcionais.',
      entrada: { type: 'object', properties: Object.assign({ projeto: PROJETO, indice: { type: 'integer', minimum: 0 }, ref: { type: 'string' }, part: { type: 'integer' },
        em: Object.assign({}, ALVO_EM.items, { description: 'achar pelo lugar: {t:"netlabel", x, y}' }),
        campos: { type: 'object', additionalProperties: true }, remover_campos: { type: 'array', items: { type: 'string' } } }, COMUNS), required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        return transacao(ctx, p, arq => {
          let i = isNum(a.indice) ? a.indice : -1;
          if (!isNum(a.indice) && a.em) {
            const l = achaEm(arq.itens, a.em);
            if (l.length > 1) throw new ErroMcp(`"em" achou ${l.length} itens (índices ${l.join(', ')}): dê t, folha ou net para escolher um`);
            i = l.length ? l[0] : -1;
          } else if (!isNum(a.indice)) i = arq.itens.findIndex(x => x && x.t === 'comp' && x.ref === a.ref && (!a.part || (x.part || 1) === a.part));
          if (!(i >= 0 && i < arq.itens.length)) throw new ErroMcp('item não achado (dê indice, ref ou em)');
          const n = Object.assign({}, arq.itens[i], a.campos || {});
          for (const k of a.remover_campos || []) delete n[k];
          arq.substitui(i, n);
          return [n];
        }, { simular: a.simular, forcar: a.forcar, ferramenta: 'sch_editar' });
      },
    },
    {
      nome: 'sch_apagar', titulo: 'Apagar itens do esquema', destrutiva: true,
      descricao: 'Remove itens do schematic.js por índice, por ref (todas as partes do componente) e/ou pelo lugar (em: [{t, x, y}] — não depende dos índices, que mudam depois de cada apagar). Lembre (AI-GUIDE): componente apagado do schematic.js continua na folha do Altium até alguém removê-lo lá.',
      entrada: { type: 'object', properties: Object.assign({ projeto: PROJETO, indices: { type: 'array', items: { type: 'integer', minimum: 0 } }, refs: { type: 'array', items: { type: 'string' } },
        em: ALVO_EM }, COMUNS), required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const removidos = [];
        const est = transacao(ctx, p, arq => {
          const alvo = new Set(a.indices || []);
          arq.itens.forEach((x, i) => { if (x && x.t === 'comp' && (a.refs || []).includes(x.ref)) alvo.add(i); });
          for (const e of a.em || []) {
            const l = achaEm(arq.itens, e);
            if (!l.length) throw new ErroMcp(`nada em (${e.x},${e.y})${e.t ? ' do tipo ' + e.t : ''}`);
            for (const i of l) alvo.add(i);
          }
          if (!alvo.size) throw new ErroMcp('nada a apagar (dê indices, refs ou em)');
          for (const i of [...alvo].sort((x, y) => y - x)) { if (i >= arq.itens.length) throw new ErroMcp('índice fora: ' + i); removidos.push(arq.itens[i]); arq.remove(i); }
          return [];
        }, { simular: a.simular, forcar: a.forcar, ferramenta: 'sch_apagar' });
        est.removidos = removidos;
        return est;
      },
    },
    {
      nome: 'sch_ligar', titulo: 'Ligar dois pinos com fio',
      descricao: 'Desenha um fio entre dois pontos, terminando EXATAMENTE na ponta quente dos pinos: "R1.2" (ref.pino, pelo número ou nome do pino) ou [x,y] em mil. forma: "hv" (horizontal depois vertical, padrão), "vh", ou pontos intermediários em "via". Para nomear a net, acrescente um netlabel/power com sch_adicionar.',
      entrada: { type: 'object', properties: Object.assign({ projeto: PROJETO,
        de: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }] }, para: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }] },
        forma: { type: 'string', enum: ['hv', 'vh'] }, via: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: 'vértices intermediários [[x,y],...]' },
        folha: { type: 'string' } }, COMUNS), required: ['projeto', 'de', 'para'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        return transacao(ctx, p, (arq, L) => {
          const A = pontoSch(ctx, arq.itens, L, a.de, 'de'), B = pontoSch(ctx, arq.itens, L, a.para, 'para');
          const sheet = a.folha || A.sheet || B.sheet || (arq.itens.find(x => x.t === 'sheet') || {}).name;
          let pts = [[A.x, A.y]];
          if (a.via && a.via.length) pts = pts.concat(a.via);
          else if (A.x !== B.x && A.y !== B.y) pts.push(a.forma === 'vh' ? [A.x, B.y] : [B.x, A.y]);
          pts.push([B.x, B.y]);
          pts = pts.filter((q, i) => !i || q[0] !== pts[i - 1][0] || q[1] !== pts[i - 1][1]);
          if (pts.length < 2) throw new ErroMcp('os dois pontos são o mesmo');
          const w = { t: 'wire', sheet, pts };
          arq.insere(null, w);
          return [w];
        }, { simular: a.simular, forcar: a.forcar, ferramenta: 'sch_ligar' });
      },
    },
    {
      nome: 'sch_validar', titulo: 'Validar esquema', leitura: true,
      descricao: 'Valida o schematic.js contra as bibliotecas como a vista Esquema (símbolos, partes, footprints, pinos x pads e pads x pinos, grade, refs duplicados) e o formato que o BuildSchematic lê. Também acusa pino sem ligação (sem fio, rótulo nem outro pino; No ERC na ponta = de propósito), ponta de fio solta, símbolo que só casou trocando maiúsculas/acentos e a cópia de símbolo guardada no esquema que difere da biblioteca (vale a do esquema).',
      entrada: { type: 'object', properties: { projeto: PROJETO }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const s = ctx.schematic(p), L = ctx.libsDe(s);
        const n = netsOuNada(ctx.hc, s, L);
        const v = ctx.hc.validateSchematic(s, L.schlib, L.pcblib, n);
        const ser = ctx.hc.serializeSchematic(s);
        return { ok: !v.errors.length && !ser.errors.length, erros: v.errors, avisos: v.warnings, formato: ser.errors.map(e => e.msg), descartados: (ser.descartados || []).length,
                 pinos_sem_ligacao: n ? n.pinosSoltos.length : null, pontas_soltas: n ? n.pontasSoltas.length : null,
                 simbolos_do_esquema_diferentes: L.divergentes && L.divergentes.length ? L.divergentes : undefined };
      },
    },
    {
      nome: 'sch_buscar_simbolo', titulo: 'Buscar símbolo na biblioteca', leitura: true,
      descricao: 'Procura símbolos nas bibliotecas que a vista Esquema usa (SchLib do Altium + almoxarifado, inclusive cada valor do almoxarifado como componente próprio) por nome, descrição, família ou designador. Devolve nome (o "sym" do comp), acervo, pinos e footprint padrão.',
      entrada: { type: 'object', properties: { busca: { type: 'string', description: 'palavras, ex.: "resistor 0805 10k", "NE555", "conector 2 vias"' }, projeto: Object.assign({}, PROJETO, { description: 'opcional: inclui os símbolos guardados no próprio esquema do projeto (os da folha do Altium e os criados com sym_salvar destino "projeto")' }), limite: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['busca'] },
      executa: async (a, ctx) => {
        const L = a.projeto ? ctx.libsDe(ctx.schematic(ctx.projeto(a.projeto))) : ctx.libs();
        const termos = norm(a.busca).split(/\s+/).filter(Boolean);
        const r = [];
        for (const s of L.schlib.symbols) { const pt = pontua(s, termos); if (pt) r.push([pt, s]); }
        r.sort((x, y) => y[0] - x[0] || x[1].name.localeCompare(y[1].name));
        /* o symbols-lib.js e o acervo de RESGATE da vista (desenho de simbolos vistos em projetos):
           so mostra, nao serve de "sym" para o BuildSchematic achar na biblioteca do Altium */
        const resgate = [];
        if (r.length < 5) for (const s of (ctx.symbolsLib().symbols || [])) { const pt = pontua(s, termos); if (pt) resgate.push([pt, s]); }
        resgate.sort((x, y) => y[0] - x[0]);
        return { acervos: L.acervos, total: r.length,
                 resgate: resgate.length ? { nota: 'só no acervo de resgate (symbols-lib.js, desenhos vistos em projetos): a vista desenha, mas o Altium só acha se o símbolo existir na biblioteca dele', simbolos: resgate.slice(0, 10).map(([, s]) => ({ nome: s.name, descricao: s.desc || '', fontes: (s.fontes || []).slice(0, 3), usos: s.usos })) } : undefined, simbolos: r.slice(0, a.limite || 25).map(([pt, s]) => ({
          sym: s.name, descricao: s.description || s.desc || '', acervo: s.doDocumento ? 'projeto' : L.acervoDe.get(s.name), designador: s.designator, partes: s.partcount || (s.parts || []).length || 1,
          pinos: ((ctx.hc.partOf(s, 1) || {}).pins || []).length, footprint: footprintAtual(s), pontos: pt })) };
      },
    },
    {
      nome: 'sch_simbolo', titulo: 'Detalhe de um símbolo', leitura: true,
      descricao: 'Um símbolo da biblioteca: partes, pinos (número, nome, tipo, ponta do corpo e PONTA QUENTE em coordenada local), footprints associados (e se existem na PcbLib) e os pads do footprint padrão para conferir pino x pad.',
      entrada: { type: 'object', properties: { nome: { type: 'string' }, part: { type: 'integer', minimum: 1 }, projeto: Object.assign({}, PROJETO, { description: 'opcional: vale também símbolo guardado no esquema do projeto' }) }, required: ['nome'] },
      executa: async (a, ctx) => {
        const L = a.projeto ? ctx.libsDe(ctx.schematic(ctx.projeto(a.projeto))) : ctx.libs(), hc = ctx.hc;
        const rs = hc.resolveSym(L.schlib, a.nome), s = rs && rs.item;
        if (!s) throw new ErroMcp(`símbolo "${a.nome}" não existe (sch_buscar_simbolo)`);
        const fp = footprintAtual(s), F = fp ? hc.footprintOf(L.pcblib, fp) : null;
        const pinos = pinosDe(hc, s, a.part || 1);
        const fora = pinos.filter(q => q.ponta_quente[0] % 100 || q.ponta_quente[1] % 100).map(q => q.num + ' ' + JSON.stringify(q.ponta_quente));
        const avisos = [];
        if (rs.how === 'chave') avisos.push(`não existe "${a.nome}" com esse nome; casou com "${s.name}" (maiúsculas, acentos ou espaços diferentes) — pode ser outro desenho${a.projeto ? '' : '; com o parâmetro projeto entram os símbolos guardados no esquema'}`);
        const dv = L.schlib.divergentes && L.schlib.divergentes.get(a.nome);
        if (dv) avisos.push(`o esquema do projeto guarda uma cópia de "${a.nome}" com pinos diferentes destes (sym_ler {projeto} mostra a cópia); vale este, o da biblioteca — sch_validar conta qual dos dois os fios seguem`);
        if (fora.length) avisos.push(`pontas de pino fora da grade de 100 mil (${fora.slice(0, 6).join(', ')}): com o componente na grade, esses pinos ficam fora dela`);
        if (fp && !F) avisos.push(`o footprint padrão "${fp}" não existe na PcbLib`);
        return { sym: s.name, pedido: a.nome !== s.name ? a.nome : undefined, casou_por: rs.how, avisos: avisos.length ? avisos : undefined,
                 descricao: s.description || '', acervo: s.doDocumento ? 'projeto' : L.acervoDe.get(s.name), designador: s.designator,
                 partes: (s.parts || []).map(pt => ({ part: pt.part, pinos: pinosDe(hc, s, pt.part).length })),
                 pinos,
                 footprints: (s.footprints || []).map(f => ({ name: f.name, padrao: !!f.current, na_pcblib: !!hc.footprintOf(L.pcblib, f.name) })),
                 footprint_padrao: F ? { name: F.name, pads: (F.pads || []).map(q => q.name) } : null,
                 nota: 'transform: mirror espelha X antes; rot anti-horário; soma (x,y) do comp. O fio encosta na ponta quente.' };
      },
    },
    {
      nome: 'sch_buscar_footprint', titulo: 'Buscar footprint na PcbLib', leitura: true,
      descricao: 'Procura footprints na PcbLib espelhada (Libs/pcblib.js) por nome/descrição; mostra nº de pads, nomes dos pads e bbox. Com "pinos" filtra pelos que têm esse número de pads.',
      entrada: { type: 'object', properties: { busca: { type: 'string' }, pinos: { type: 'integer' }, limite: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['busca'] },
      executa: async (a, ctx) => {
        const L = ctx.libs();
        const termos = norm(a.busca).split(/\s+/).filter(Boolean);
        const r = [];
        for (const f of L.pcblib.footprints || []) {
          if (isNum(a.pinos) && (f.pads || []).length !== a.pinos) continue;
          const pt = pontua({ name: f.name, description: f.description }, termos);
          if (pt) r.push([pt, f]);
        }
        r.sort((x, y) => y[0] - x[0]);
        return { total: r.length, footprints: r.slice(0, a.limite || 25).map(([, f]) => ({ name: f.name, descricao: f.description || '', pads: (f.pads || []).length,
          nomes_pads: (f.pads || []).slice(0, 40).map(q => q.name), bbox: f.bbox })) };
      },
    },
    {
      nome: 'sch_template', titulo: 'Template de folha (carimbo)',
      descricao: 'Templates de folha do Altium e da casa (hub-schtemplate.js: moldura, zonas, carimbo com special strings =Title, =DocumentNumber...). Sem "template": lista os disponíveis com os campos que cada carimbo mostra. Com "template" (id) e "projeto": põe o template na folha (ajusta w/h) e grava os parâmetros do documento (campos: {Title, DocumentNumber, Revision, DrawnBy...}) no item sheet.',
      modulo: 'hub-schtemplate.js',
      entrada: { type: 'object', properties: Object.assign({ projeto: PROJETO, template: { type: 'string', description: 'id, ex.: casa:A4_DiEletrons ou altium:Standard' }, folha: { type: 'string' },
        campos: { type: 'object', additionalProperties: true, description: 'parâmetros do documento (Altium: Document Options › Parameters)' } }, COMUNS), required: [] },
      executa: async (a, ctx) => {
        const H = ctx.exige('hub-schtemplate.js', 'HubSchTemplate');
        const fontes = [ctx.lib('sch-templates.js', 'schtemplates'), ctx.lib('sch-templates-casa.js', 'schtemplatesCasa')].filter(Boolean);
        if (!a.template) return { templates: H.lista(fontes).map(t => ({ id: t.id, nome: t.nome, origem: t.origem, folha: t.folha && { estilo: t.folha.estilo, w: t.folha.w, h: t.folha.h }, campos: H.campos(t) })) };
        if (!a.projeto) throw new ErroMcp('informe projeto para aplicar o template');
        const tpl = H.acha(a.template, fontes);
        if (!tpl) throw new ErroMcp(`template "${a.template}" não existe (sch_template sem argumentos lista os ids)`);
        const p = ctx.projeto(a.projeto);
        return transacao(ctx, p, arq => {
          const i = arq.itens.findIndex(x => x && x.t === 'sheet' && (!a.folha || x.name === a.folha));
          if (i < 0) throw new ErroMcp('folha não achada');
          const it = Object.assign({}, arq.itens[i]);
          H.aplica(it, tpl);
          if (a.campos) it.params = H.serializaParams(Object.assign(H.parseParams(it.params), a.campos));
          arq.substitui(i, it);
          return [it];
        }, { simular: a.simular, forcar: a.forcar, ferramenta: 'sch_template' });
      },
    },
  ],
};
