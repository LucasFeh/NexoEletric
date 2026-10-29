/* NexoEletric MCP - grupo "pcb": ler a placa efetiva e escrever o changes.js.

   Regras do AI-GUIDE (Parte B) que as ferramentas cumprem sozinhas:
     - o board.js nunca e editado; tudo vira op no changes.js, uma por linha;
     - orig_* copiados do board.js automaticamente (a IA nao precisa nem ve-los);
     - um objeto, uma linha: mexer de novo edita a linha existente;
     - valida com HubCore.applyPcbChanges antes de gravar; erro = nada gravado. */
'use strict';
const { ArquivoLinhas } = require('../lib/arquivo-linhas.js');
const { ErroMcp } = require('../lib/contexto.js');
const ops = require('../lib/pcb-ops.js');
const geo = require('../lib/geometria.js');
const render = require('../lib/render.js');
const { PROJETO, isNum, r4, caixa, noRet } = require('../lib/util.js');

const COMUNS = {
  note: { type: 'string', description: 'o porquê da mudança (vai no campo note; sem a sequência aspas-dois-pontos). Se resolve um sinalizador, comece com o id: "n3: ..."' },
  simular: { type: 'boolean', description: 'true = só valida e mostra o resultado, sem gravar' },
  forcar: { type: 'boolean', description: 'true = grava mesmo com erro de validação (evite; o ApplyChanges vai recusar a linha)' },
};
const PT = { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: '[x, y] em mm' };

const comNote = (op, a) => { if (a.note) op.note = String(a.note).replace(/":/g, '" :'); return op; };

/* ---------- consulta ---------- */
const TIPOS = {
  componentes: eb => (eb.components || []).map(c => ({ ref: c.ref, footprint: c.footprint, comment: c.comment, layer: c.layer, x: c.x, y: c.y, rot: c.rot, bbox: c.bbox,
    pads: (c.pads || []).length, nets: [...new Set((c.pads || []).map(p => p.net).filter(Boolean))] })),
  pads: eb => [].concat(...(eb.components || []).map(c => (c.pads || []).map(p => ({ ref: c.ref, name: p.name, id: p.id, x: p.x, y: p.y, w: p.w, h: p.h, rot: p.rot, shape: p.shape, layer: p.layer, type: p.type, drill: p.drill, net: p.net || '' }))),
    (eb.freepads || []).map(p => ({ ref: '', name: p.name, id: p.id, x: p.x, y: p.y, w: p.w, h: p.h, rot: p.rot, shape: p.shape, layer: p.layer, type: p.type, drill: p.drill, net: p.net || '' }))),
  trilhas: eb => eb.tracks || [],
  arcos: eb => eb.arcs || [],
  vias: eb => eb.vias || [],
  textos: eb => (eb.texts || []).map(t => { const o = Object.assign({}, t); delete o.polys; return o; }),
  fills: eb => eb.fills || [],
  regioes: eb => (eb.regions || []).map(g => ({ id: g.id, layer: g.layer, net: g.net, poly: g.poly, owner: g.owner, keepout: g.keepout, n: (g.points || []).length,
    bbox: bboxPts(g.points), points: (g.points || []).length <= 40 ? g.points : undefined })),
  silk: eb => eb.silk || [],
  linhas: eb => eb.lines || [],
  poligonos: eb => (eb.polygons || []).map(g => Object.assign({}, g, { pts: undefined, n: (g.pts || g.points || []).length, bbox: bboxPts(g.pts || g.points) })),
  recortes: eb => (eb.cutouts || []).map(k => ({ id: k.id, kindn: k.kindn, n: (k.points || []).length, bbox: bboxPts(k.points) })),
};
function bboxPts(P) {
  if (!Array.isArray(P) || !P.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of P) { x1 = Math.min(x1, p[0]); y1 = Math.min(y1, p[1]); x2 = Math.max(x2, p[0]); y2 = Math.max(y2, p[1]); }
  return { x1: r4(x1), y1: r4(y1), x2: r4(x2), y2: r4(y2) };
}
function caixaDe(o) {
  if (o.bbox) return o.bbox;
  if ([o.x1, o.y1, o.x2, o.y2].every(isNum)) return { x1: Math.min(o.x1, o.x2), y1: Math.min(o.y1, o.y2), x2: Math.max(o.x1, o.x2), y2: Math.max(o.y1, o.y2) };
  if ([o.cx, o.cy, o.r].every(isNum)) return { x1: o.cx - o.r, y1: o.cy - o.r, x2: o.cx + o.r, y2: o.cy + o.r };
  if ([o.x, o.y].every(isNum)) { const h = Math.max(o.w || o.size || 0, o.h || o.size || 0) / 2; return { x1: o.x - h, y1: o.y - h, x2: o.x + h, y2: o.y + h }; }
  return null;
}
const sobrepoe = (a, b) => a && b && a.x1 <= b.x2 && a.x2 >= b.x1 && a.y1 <= b.y2 && a.y2 >= b.y1;

/* ---------- texto dentro do contorno? (o designator que vai parar fora da placa) ----------
   t => true | false | undefined (sem contorno). A forma do texto vem do HubGerber (a mesma da tela e
   do Gerber); sem ele, a caixa aproximada pelo tamanho da fonte. */
function dentroDaPlaca(ctx, eb) {
  const P = ctx.modulo('hub-pcbpour.js'), G = ctx.modulo('hub-gerber.js');
  const anel = P && P._int && P._int.contornoPlaca ? P._int.contornoPlaca(eb.board, 0.05) : null;
  if (!anel) return () => undefined;
  const dentro = (x, y) => {
    let c = false;
    for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
      const [xi, yi] = anel[i], [xj, yj] = anel[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  return t => {
    let pts = [];
    try {
      const g = G && G.geometriaTexto ? G.geometriaTexto(t) : null;
      if (g && Array.isArray(g.regioes)) for (const r of g.regioes) if (r && !r.hole && r.pts) pts.push(...r.pts);
      if (g && Array.isArray(g.tracos)) for (const tr of g.tracos) if (Array.isArray(tr)) pts.push(...tr);
    } catch (_) { pts = []; }
    if (!pts.length && isNum(t.x) && isNum(t.y)) {
      const hw = String(t.text || '').length * (t.h || 1) * 0.45, hh = (t.h || 1) / 2;
      pts = [[t.x - hw, t.y - hh], [t.x + hw, t.y - hh], [t.x + hw, t.y + hh], [t.x - hw, t.y + hh]];
    }
    return pts.length ? pts.every(q => dentro(q[0], q[1])) : undefined;
  };
}

/* ---------- o DRC antes x depois de um conjunto de ops (pcb_aplicar drc:true) ----------
   A mesma conta do drc_rodar (planos redespejados, regras do projeto); a violacao e a mesma quando
   o tipo e os objetos batem (a mensagem muda com a distancia). */
function drcDiferenca(ctx, p, antes, depois, tipos) {
  const D = ctx.modulo('hub-pcbdrc.js');
  if (!D) return { erro: 'hub-pcbdrc.js ausente nesta instalação' };
  const R = ops.regrasDoProjeto(ctx, p);
  const G = ctx.modulo('hub-gerber.js');
  const o = { textoGeo: G && G.geometriaTexto ? (t => { try { return G.geometriaTexto(t); } catch (_) { return null; } }) : undefined };
  if (tipos) o.tipos = tipos;
  const t0 = Date.now();
  const roda = itens => D.rodar(ctx.placaDespejada(p, itens).eb, R ? R.conjunto : undefined, o).violacoes || [];
  const va = roda(antes), vd = roda(depois);
  const chave = v => v.tipo + '|' + (v.ids || []).map(String).sort().join('|');
  const ka = new Set(va.map(chave)), kd = new Set(vd.map(chave));
  const curta = v => ({ tipo: v.tipo, msg: v.msg, x: v.x, y: v.y, layer: v.layer, ids: v.ids });
  const novas = vd.filter(v => !ka.has(chave(v))), sairam = va.filter(v => !kd.has(chave(v)));
  return { antes: va.length, depois: vd.length, novas: novas.length, sairam: sairam.length, ms: Date.now() - t0,
           lista_novas: novas.slice(0, 50).map(curta), lista_sairam: sairam.slice(0, 20).map(curta) };
}

/* ---------- a placa: pontos do contorno para o roteador ---------- */
function lacosDe(ctx, eb) {
  const L = ctx.modulo('hub-laser.js');
  const segs = [];
  for (const s of ((eb.board && eb.board.outline) || [])) {
    if (!s) continue;
    if (s.kind === 'arc') { if (L && [s.cx, s.cy, s.r, s.sa, s.ea].every(isNum)) segs.push(L.arcPts(s.cx, s.cy, s.r, s.sa, s.ea)); }
    else if ([s.x1, s.y1, s.x2, s.y2].every(isNum)) segs.push([[s.x1, s.y1], [s.x2, s.y2]]);
  }
  const lacos = ((L && L.chainSegments) ? L.chainSegments(segs) : segs).filter(l => l.length >= 3);
  if (lacos.length) return lacos;
  const bb = eb.board && eb.board.bbox;
  return bb ? [[[bb.x1, bb.y1], [bb.x2, bb.y1], [bb.x2, bb.y2], [bb.x1, bb.y2]]] : [];
}
function textoGeo(ctx) {
  const G = ctx.modulo('hub-gerber.js');
  return G && G.geometriaTexto ? (t => { if (!t || t.hidden) return null; try { return G.geometriaTexto(t); } catch (_) { return null; } }) : null;
}
/* os recortes que são furo (Board Cutout), como o DRC os lê: o do tamanho da placa é a forma dela */
function recortesDe(eb) {
  const bb = eb.board && eb.board.bbox, out = [];
  for (const k of eb.cutouts || []) {
    if (!k || !Array.isArray(k.points) || k.points.length < 3 || k.kindn === -1 || k.kindn === 1) continue;
    const xs = k.points.map(q => q[0]), ys = k.points.map(q => q[1]);
    if (bb && Math.min(...xs) <= bb.x1 + 1e-3 && Math.max(...xs) >= bb.x2 - 1e-3 && Math.min(...ys) <= bb.y1 + 1e-3 && Math.max(...ys) >= bb.y2 - 1e-3) continue;
    out.push({ id: k.id, pts: k.points });
  }
  return out;
}
/* a cena do roteador com as REGRAS DO PROJETO (as mesmas do drc_rodar): folga por par, contorno,
   largura/via/camada pela regra da net. `p` = o projeto; sem ele (ou sem o hub-pcbregras.js), a
   folga única do board.rules */
function cena(ctx, eb, p) {
  const R = ctx.exige('hub-roteador.js', 'HubRoteador');
  const rules = eb.rules || {};
  const o = { placa: { lacos: lacosDe(ctx, eb), recortes: recortesDe(eb) }, textoGeo: textoGeo(ctx) };
  const S = p ? ops.regrasDoProjeto(ctx, p) : null;
  if (S) o.regras = S.conjunto; else o.clearance = rules.clearance > 0 ? rules.clearance : R.FOLGA_PADRAO;
  return R.cena(eb, o);
}

/* a largura e a via que as regras do projeto pedem para a net (o roteador resolve: é a mesma conta
   da vista); sem o roteador ou sem regras, o board.rules */
function larguraDaNet(ctx, eb, p, net, layer, board) {
  const R = ctx.modulo('hub-roteador.js');
  if (R && R.larguraDaRegra && ctx.hc.isCopper(layer)) return R.larguraDaRegra(cena(ctx, eb, p), net || '', layer).pref;
  return board.rules && board.rules.width > 0 ? board.rules.width : 0.254;
}
function viaDaNet(ctx, eb, p, net, rules) {
  const R = ctx.modulo('hub-roteador.js');
  if (R && R.viaDaRegra) return R.viaDaRegra(cena(ctx, eb, p), net || '');
  return { size: rules.viaSize || 0.6, drill: rules.viaDrill || 0.3 };
}

/* o pad do componente "R1.2" (ou {ref, pad}) na placa efetiva */
function padDe(eb, alvo) {
  const s = String(alvo);
  const i = s.lastIndexOf('.');
  if (i <= 0) return null;
  const c = (eb.components || []).find(x => x.ref === s.slice(0, i));
  return c ? (c.pads || []).find(p => String(p.name) === s.slice(i + 1)) || null : null;
}
function ponto(eb, v, nome, layer) {
  if (Array.isArray(v) && v.length === 2 && v.every(isNum)) {
    /* com a camada: o pad sob o ponto (o snap do Altium) — o passante ou o SMD da camada primeiro,
       senão o SMD de outra camada, que a rota não pode ligar */
    if (layer) {
      const sob = TIPOS.pads(eb).filter(q => geo.noPad(q, v[0], v[1], 1e-6));
      const q = sob.find(q => q.type === 'th' || q.layer === 'Multi' || q.layer === layer) || sob[0];
      if (q) return { x: v[0], y: v[1], net: q.net || '', pad: q };
    }
    return { x: v[0], y: v[1], net: '', pad: null };
  }
  const p = padDe(eb, v);
  if (!p) throw new ErroMcp(`${nome}: use [x,y] em mm ou "REF.PINO" (ex.: "R1.2"); "${v}" não achado`);
  return { x: p.x, y: p.y, net: p.net || '', pad: p };
}

/* trilhas que tocavam os pads de um componente (para avisar depois de mover) */
function trilhasNosPads(comp, eb) {
  const out = [];
  for (const t of eb.tracks || []) {
    if (!t || !t.id) continue;
    for (const p of comp.pads || []) {
      if ((p.type === 'th' || p.layer === t.layer) && (geo.noPad(p, t.x1, t.y1, 0.01) || geo.noPad(p, t.x2, t.y2, 0.01))) { out.push({ id: t.id, layer: t.layer, net: t.net, pad: comp.ref + '.' + p.name }); break; }
    }
  }
  return out;
}

module.exports = {
  grupo: 'pcb',
  ordem: 30,
  titulo: 'PCB — placa (board.js lido, changes.js escrito)',
  modulos: ['hub-core.js', 'hub-roteador.js', 'hub-autoroteador.js', 'hub-gerber.js'],
  ferramentas: [
    {
      nome: 'pcb_resumo', titulo: 'Resumo da placa', leitura: true,
      descricao: 'A placa com as mudanças: bbox, contorno, camadas (com cor e contagem), nets, regras do board.js, contagens e a validação do changes.js. Comece por aqui na Parte B.',
      entrada: { type: 'object', properties: { projeto: PROJETO }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const { board, changes, model, eb } = ctx.placa(p);
        return {
          projeto: p.nome, exportador: board.exporter || '(espelho antigo)', bbox: board.board && board.board.bbox,
          contorno: (eb.board && eb.board.outline || []).length + ' segmentos',
          camadas: ctx.hc.boardLayers(eb).map(l => ({ key: l.key, nome: l.name, tipo: l.kind, cor: l.color, objetos: l.count })),
          nets: board.nets || [], regras: board.rules || null,
          contagem: Object.fromEntries(['components', 'tracks', 'arcs', 'vias', 'texts', 'fills', 'regions', 'silk', 'lines', 'freepads', 'cutouts'].map(k => [k, (eb[k] || []).length])),
          mudancas: changes.length, validacao: ops.resumoValidacao(model, 40),
        };
      },
    },
    {
      nome: 'pcb_consultar', titulo: 'Consultar objetos da placa', leitura: true,
      descricao: 'Lista objetos da placa EFETIVA (board.js + changes.js) com ids e coordenadas, filtrando por caixa (região em mm), camada, net, componente (ref = dono) ou id. Tipos: componentes, pads, trilhas, arcos, vias, textos, fills, regioes, silk, linhas, recortes. Os ids servem para pcb_apagar/pcb_editar. Placa grande: filtre por caixa, peça só os campos que precisa (campos) e/ou grave a lista inteira em arquivo (arquivo:true devolve o caminho e só a contagem) — despejar pads/vias/trilhas da placa toda na conversa esgota o contexto.',
      entrada: { type: 'object', properties: {
        projeto: PROJETO,
        tipo: { type: 'string', enum: Object.keys(TIPOS) },
        caixa: { type: 'object', properties: { x1: { type: 'number' }, y1: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' } }, description: 'só o que toca esta região (mm)' },
        camada: { type: 'string', description: 'Top, Bottom, TopOverlay, Mech1...' },
        net: { type: 'string' }, ref: { type: 'string', description: 'componente (para pads/textos/silk: o dono)' }, id: { type: 'string' },
        limite: { type: 'integer', minimum: 1, maximum: 2000, description: 'padrão 200' }, pular: { type: 'integer', minimum: 0 },
        campos: { type: 'array', items: { type: 'string' }, description: 'só estes campos de cada item (ex.: ["id","x","y","net"])' },
        arquivo: { type: 'boolean', description: 'true = grava TODOS os itens filtrados num .json (pasta temporária) e devolve o caminho, sem a lista na resposta' },
      }, required: ['projeto', 'tipo'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const { eb } = ctx.placa(p);
        const f = TIPOS[a.tipo];
        if (!f) throw new ErroMcp('tipo desconhecido: ' + a.tipo);
        const cx = caixa(a.caixa);
        let L = f(eb).filter(o => o
          && (!a.camada || o.layer === a.camada)
          && (!a.net || o.net === a.net || (Array.isArray(o.nets) && o.nets.includes(a.net)))
          && (!a.ref || o.ref === a.ref || o.owner === a.ref)
          && (!a.id || String(o.id) === a.id)
          && (!cx || sobrepoe(caixaDe(o), cx)));
        if (Array.isArray(a.campos) && a.campos.length) L = L.map(o => { const r = {}; for (const k of a.campos) if (o[k] !== undefined) r[k] = o[k]; return r; });
        const total = L.length, ini = a.pular || 0, lim = a.limite || 200;
        if (a.arquivo) {
          const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
          const dir = path.join(os.tmpdir(), 'nexoeletric-consultas');
          fs.mkdirSync(dir, { recursive: true });
          const f = path.join(dir, `${String(p.nome).replace(/[^\w.-]+/g, '_')}-${a.tipo}-${Date.now()}.json`);
          fs.writeFileSync(f, JSON.stringify({ projeto: p.nome, tipo: a.tipo, filtros: { caixa: a.caixa, camada: a.camada, net: a.net, ref: a.ref, id: a.id }, total, itens: L }, null, 1));
          return { tipo: a.tipo, total, arquivo: f, amostra: L.slice(0, 3) };
        }
        return { tipo: a.tipo, total, mostrando: [ini, Math.min(total, ini + lim)], itens: L.slice(ini, ini + lim) };
      },
    },
    {
      nome: 'pcb_componente', titulo: 'Componente na placa', leitura: true,
      descricao: 'Um componente na placa efetiva: posição, rotação, lado, pads (posições absolutas JÁ com as mudanças, nets), designator e as trilhas que chegam nos pads.',
      entrada: { type: 'object', properties: { projeto: PROJETO, ref: { type: 'string' } }, required: ['projeto', 'ref'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const { eb, model } = ctx.placa(p);
        const c = (eb.components || []).find(x => x.ref === a.ref);
        if (!c) throw new ErroMcp(`componente "${a.ref}" não está na placa. Existem: ${(eb.components || []).map(x => x.ref).join(', ')}`);
        const m = model.compByRef[a.ref];
        return { ref: c.ref, footprint: c.footprint, comment: c.comment, layer: c.layer, x: c.x, y: c.y, rot: c.rot, bbox: c.bbox, movido: !!(m && m.changed),
                 original: m ? { x: m.src.x, y: m.src.y, rot: m.src.rot, layer: m.src.layer } : null,
                 pads: (c.pads || []).map(q => ({ name: q.name, x: q.x, y: q.y, w: q.w, h: q.h, rot: q.rot, shape: q.shape, layer: q.layer, type: q.type, drill: q.drill, net: q.net || '' })),
                 textos: (eb.texts || []).filter(t => t.owner === a.ref).map(t => ({ id: t.id, text: t.text, x: t.x, y: t.y, layer: t.layer, designator: !!t.designator, comment: !!t.comment })),
                 trilhas_nos_pads: trilhasNosPads(c, eb) };
      },
    },
    {
      nome: 'pcb_net', titulo: 'Net na placa', leitura: true,
      descricao: 'Tudo de uma net na placa efetiva: pads (REF.PINO), trilhas, arcos, vias, fills e regiões, com comprimento total de trilha.',
      entrada: { type: 'object', properties: { projeto: PROJETO, net: { type: 'string' } }, required: ['projeto', 'net'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const { eb, board } = ctx.placa(p);
        if (!(board.nets || []).includes(a.net)) throw new ErroMcp(`net "${a.net}" não existe. Nets: ${(board.nets || []).join(', ')}`);
        const tr = (eb.tracks || []).filter(t => t.net === a.net);
        return { net: a.net,
          pads: TIPOS.pads(eb).filter(q => q.net === a.net).map(q => ({ pad: q.ref ? q.ref + '.' + q.name : q.id, x: q.x, y: q.y, layer: q.layer })),
          trilhas: tr, comprimento_mm: r4(tr.reduce((s, t) => s + Math.hypot(t.x2 - t.x1, t.y2 - t.y1), 0)),
          arcos: (eb.arcs || []).filter(x => x.net === a.net), vias: (eb.vias || []).filter(x => x.net === a.net),
          fills: (eb.fills || []).filter(x => x.net === a.net).length, regioes: (eb.regions || []).filter(x => x.net === a.net).length };
      },
    },
    {
      nome: 'pcb_mudancas', titulo: 'Mudanças do changes.js', leitura: true,
      descricao: 'Lista as ops do changes.js com índice (0 = primeira), status da validação (ok/warn/err) e a mensagem. Use os índices em pcb_mudanca_remover/pcb_mudanca_editar.',
      entrada: { type: 'object', properties: { projeto: PROJETO, so_problemas: { type: 'boolean' } }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const { model } = ctx.placa(p);
        const L = model.changeItems.map(it => ({ indice: it.idx, status: it.status, msg: it.msg || undefined, op: it.ch }))
          .filter(x => !a.so_problemas || x.status !== 'ok');
        return { total: model.changeItems.length, validacao: ops.resumoValidacao(model, 0), mudancas: L };
      },
    },
    {
      nome: 'pcb_mover', titulo: 'Mover/girar/virar componente',
      descricao: 'Move um componente (comp_move com os orig_* do board.js preenchidos sozinhos). Dê x/y absolutos ou dx/dy relativos, rot (graus anti-horário) e layer Top/Bottom (virar de lado). Se o componente já tem linha no changes.js, ela é editada. Devolve a posição nova, os pads movidos e as trilhas que chegavam nos pads (que agora podem estar soltas).',
      entrada: { type: 'object', properties: Object.assign({
        projeto: PROJETO, ref: { type: 'string' },
        x: { type: 'number' }, y: { type: 'number' }, dx: { type: 'number' }, dy: { type: 'number' },
        rot: { type: 'number' }, drot: { type: 'number', description: 'gira relativo (graus)' }, layer: { type: 'string', enum: ['Top', 'Bottom'] },
      }, COMUNS), required: ['projeto', 'ref'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const antes = ctx.placa(p);
        const c = (antes.eb.components || []).find(x => x.ref === a.ref);
        if (!c) throw new ErroMcp(`componente "${a.ref}" não existe na placa`);
        const tocavam = trilhasNosPads(c, antes.eb);
        const op = { op: 'comp_move', ref: a.ref,
          x: isNum(a.x) ? a.x : r4(c.x + (a.dx || 0)), y: isNum(a.y) ? a.y : r4(c.y + (a.dy || 0)),
          rot: isNum(a.rot) ? ((a.rot % 360) + 360) % 360 : (((c.rot + (a.drot || 0)) % 360) + 360) % 360,
          layer: a.layer || c.layer };
        comNote(op, a);
        const est = ops.transacao(ctx, p, (arq, board) => {
          /* componente que chegou pelo ECO (ou pelo pcb_componente) ainda é um comp_add no
             changes.js: mover é editar a linha dele (uma linha por objeto, como a vista faz) */
          if (!(board.components || []).some(k => k.ref === a.ref)) {
            const i = arq.itens.findIndex(x => x && x.op === 'comp_add' && x.ref === a.ref);
            if (i < 0) throw new ErroMcp(`componente "${a.ref}" não está no board.js nem num comp_add do changes.js`);
            const velho = arq.itens[i];
            const novo = Object.assign({}, velho, { x: op.x, y: op.y, rot: op.rot, layer: op.layer }, op.note ? { note: op.note } : {});
            /* o designator posto na linha (des_x/des_y) anda junto com o componente */
            if (isNum(velho.des_x) && isNum(velho.des_y)) {
              const lado = q => q === 'Bottom' ? 'Bottom' : 'Top';
              const d = ctx.hc.compDelta({ src: { x: velho.x, y: velho.y, rot: velho.rot || 0, layer: lado(velho.layer) },
                                           eff: { x: novo.x, y: novo.y, rot: novo.rot || 0, layer: lado(novo.layer) } });
              const q = ctx.hc.xfPoint(d, velho.des_x, velho.des_y);
              novo.des_x = ops.r6(q.x); novo.des_y = ops.r6(q.y);
              if (isNum(velho.des_rot)) novo.des_rot = ((velho.des_rot + d.dr) % 360 + 360) % 360;
            }
            arq.substitui(i, novo);
            return [novo];
          }
          return [ops.mescla(arq, ops.origDe(op, board)).obj];
        }, { simular: a.simular, forcar: a.forcar, ferramenta: 'pcb_mover' });
        const depois = ctx.placa(p);
        const c2 = (depois.eb.components || []).find(x => x.ref === a.ref);
        if (est.gravado && c2) {
          est.componente = { ref: c2.ref, x: c2.x, y: c2.y, rot: c2.rot, layer: c2.layer, bbox: c2.bbox, pads: (c2.pads || []).map(q => ({ name: q.name, x: r4(q.x), y: r4(q.y), net: q.net || '' })) };
          if (tocavam.length) est.trilhas_que_chegavam = { nota: 'estas trilhas tocavam os pads antes do movimento — ajuste (pcb_editar) ou apague (pcb_apagar)', lista: tocavam };
        }
        return est;
      },
    },
    {
      nome: 'pcb_aplicar', titulo: 'Aplicar ops no changes.js',
      descricao: 'Escreve QUALQUER op do changes.js (AI-GUIDE Parte B): track_add/edit/del, via_*, arc_*, text_add/edit/del, fill_*, region_add/del, designator_move, comp_move, comp_attr, outline_set — e as ops novas dos módulos (comp_add, pad_add, poly_add… do hub-pcbeco). Os orig_* das edições/remoções são preenchidos SOZINHOS a partir do board.js (pode omiti-los). Op de um objeto que já tem linha edita aquela linha. Tudo validado antes de gravar; com erro nada é gravado. designator_move/comment_move: x/y/rot = onde o texto deve FICAR na placa (a conta inversa do comp_move é feita aqui; "referencial":"original" grava como veio), h = altura e w = traço em mm; funciona também para componente criado por comp_add. A resposta traz em "textos" a posição efetiva de cada um e "fora_da_placa" quando ele sai do contorno.',
      entrada: { type: 'object', properties: Object.assign({
        projeto: PROJETO,
        ops: { type: 'array', minItems: 1, items: { type: 'object', properties: { op: { type: 'string' } }, required: ['op'], additionalProperties: true },
               description: 'ex.: [{"op":"track_add","layer":"Top","x1":10,"y1":5,"x2":20,"y2":5,"w":0.3,"net":"GND"}, {"op":"track_del","id":"t7"}]' },
        drc: { description: 'true (ou a lista de tipos do DRC) = roda o DRC antes e depois destas ops e devolve as violações NOVAS e as que SAÍRAM (vale com simular:true)' },
      }, COMUNS), required: ['projeto', 'ops'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const hc = ctx.pcbPronto();
        const ehTexto = o => o && (o.op === 'designator_move' || o.op === 'comment_move');
        const pedidos = a.ops.filter(ehTexto).map(o => ({ ref: o.ref, op: o.op, x: o.x, y: o.y }));
        const querDrc = a.drc === true || Array.isArray(a.drc);
        const est = ops.transacao(ctx, p, (arq, board) => a.ops.map(o0 => {
          const o = Object.assign({}, o0);
          if (a.note && !o.note) comNote(o, a);
          if (ehTexto(o)) return ops.aplicaTexto(arq, board, hc, o);
          return ops.mescla(arq, ops.origDe(o, board)).obj;
        }), { simular: a.simular, forcar: a.forcar, ferramenta: 'pcb_aplicar',
              relata: pedidos.length || querDrc ? (model, board, _hc, itens) => {
                const out = {};
                if (pedidos.length) {
                  const textos = ops.posicoesEfetivas(hc, board, model, pedidos, dentroDaPlaca(ctx, hc.effectiveBoard(board, model)));
                  const fora = textos.filter(t => t.fora_da_placa).map(t => t.ref);
                  Object.assign(out, { textos, avisos_textos: fora.length ? `${fora.length} texto(s) FORA do contorno da placa: ${fora.slice(0, 20).join(', ')}${fora.length > 20 ? '…' : ''}` : undefined });
                }
                if (querDrc) out.drc = drcDiferenca(ctx, p, itens.antes, itens.depois, Array.isArray(a.drc) ? a.drc : null);
                return out;
              } : null });
        return est;
      },
    },
    {
      nome: 'pcb_colocar', titulo: 'Colocar componente na placa',
      descricao: 'Põe um footprint na placa como componente NOVO (op comp_add): ref, footprint (da biblioteca: fp_buscar; o do hub ou o do Altium), posição, rotação, lado e as nets de cada pad. Para trazer TODOS os componentes do esquema de uma vez use eco_aplicar; esta é a peça avulsa (furo de fixação, conector extra, logo, jumper). O footprint precisa existir na biblioteca ou na placa.',
      entrada: { type: 'object', properties: Object.assign({
        projeto: PROJETO, ref: { type: 'string', description: 'designador novo, ex.: "J9", "MH1"' }, footprint: { type: 'string' },
        x: { type: 'number' }, y: { type: 'number' }, rot: { type: 'number', description: 'graus anti-horário (padrão 0)' },
        layer: { type: 'string', enum: ['Top', 'Bottom'] }, comment: { type: 'string' },
        nets: { anyOf: [{ type: 'object', additionalProperties: { type: 'string' } }, { type: 'string' }], description: '{"1":"GND","2":"VCC"} ou "1=GND;2=VCC" (pad=net)' },
      }, COMUNS), required: ['projeto', 'ref', 'footprint', 'x', 'y'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const board = ctx.board(p);
        if ((board.components || []).some(c => c.ref === a.ref)) throw new ErroMcp(`a placa já tem um ${a.ref}: escolha outro designador (ou pcb_mover para mexer no que existe)`);
        let nets = a.nets;
        if (nets && typeof nets === 'object') nets = Object.entries(nets).map(([pad, n]) => `${pad}=${n}`).join(';');
        const op = { op: 'comp_add', ref: a.ref, footprint: a.footprint, x: a.x, y: a.y, rot: isNum(a.rot) ? a.rot : 0, layer: a.layer || 'Top' };
        if (a.comment) op.comment = a.comment;
        if (nets) op.nets = String(nets).replace(/":/g, '" :');
        comNote(op, a);
        const est = await ops.transacao(ctx, p, arq => [ops.mescla(arq, op).obj], { simular: a.simular, forcar: a.forcar, ferramenta: 'pcb_colocar' });
        if (est && est.gravado) {
          try {
            const c = (ctx.placa(p).eb.components || []).find(x => x.ref === a.ref);
            if (c) est.componente = { ref: c.ref, x: c.x, y: c.y, rot: c.rot, layer: c.layer, bbox: c.bbox, pads: (c.pads || []).map(q => ({ name: q.name, x: r4(q.x), y: r4(q.y), net: q.net || '' })) };
          } catch (_) { /* a resposta da transacao ja diz o essencial */ }
        }
        return est;
      },
    },
    {
      nome: 'pcb_editar', titulo: 'Editar objeto por id',
      descricao: 'Edita um objeto da placa pelo id (trilha t…/s…/l…, arco a…, via v…, texto x…, fill f…, pad livre, polígono): passe só os campos novos (ex.: {"w":0.5} ou {"x1":10,"y1":5}). A op certa (track_edit, arc_edit, via_edit, text_edit, fill_edit) e os orig_* saem do board.js.',
      entrada: { type: 'object', properties: Object.assign({
        projeto: PROJETO, id: { type: 'string' },
        campos: { type: 'object', additionalProperties: true, description: 'trilha: x1,y1,x2,y2,w,layer,net · arco: cx,cy,r,sa,ea,w,layer · via: x,y,size,drill · texto: text,x,y,h,w,rot,layer,mirror · fill: x1,y1,x2,y2,rot,layer,net' },
      }, COMUNS), required: ['projeto', 'id', 'campos'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const board = ctx.board(p);
        const r = ops.achaObjeto(board, a.id), k = ops.tipoDoObjeto(r);
        const opn = { track: 'track_edit', arc: 'arc_edit', via: 'via_edit', text: 'text_edit', fill: 'fill_edit', pad: 'pad_edit', poly: 'poly_edit' }[k];
        if (!opn) throw new ErroMcp(`"${a.id}" é ${k}: não há op de edição para ele (região: apague e crie outra)`);
        const op = comNote(Object.assign({ op: opn, id: a.id }, a.campos), a);
        return ops.transacao(ctx, p, (arq, b) => [ops.mescla(arq, ops.origDe(op, b)).obj], { simular: a.simular, forcar: a.forcar, ferramenta: 'pcb_editar' });
      },
    },
    {
      nome: 'pcb_apagar', titulo: 'Apagar objetos por id', destrutiva: true,
      descricao: 'Apaga objetos da placa pelos ids (trilha/linha → track_del, arco → arc_del, via → via_del, texto → text_del, fill → fill_del, região → region_del, pad livre → pad_del, polígono → poly_del) e componentes por refs (comp_del), com os orig_* do board.js. Objeto ACRESCENTADO pelo changes.js (sem id no board.js) se apaga removendo a linha: pcb_mudanca_remover.',
      entrada: { type: 'object', properties: Object.assign({ projeto: PROJETO, ids: { type: 'array', items: { type: 'string' } }, refs: { type: 'array', items: { type: 'string' }, description: 'componentes a tirar da placa (comp_del)' } }, COMUNS), required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        if (!(a.ids || []).length && !(a.refs || []).length) throw new ErroMcp('dê ids e/ou refs');
        return ops.transacao(ctx, p, (arq, board) => (a.refs || []).map(ref => ops.mescla(arq, ops.origDe(comNote({ op: 'comp_del', ref }, a), board)).obj).concat((a.ids || []).map(id => {
          const r = ops.achaObjeto(board, id), k = ops.tipoDoObjeto(r);
          const opn = { track: 'track_del', arc: 'arc_del', via: 'via_del', text: 'text_del', fill: 'fill_del', region: 'region_del', pad: 'pad_del', poly: 'poly_del' }[k];
          if (!opn) throw new ErroMcp(`"${id}" (${k}) não se apaga pelo changes.js`);
          return ops.mescla(arq, ops.origDe(comNote({ op: opn, id }, a), board)).obj;
        })), { simular: a.simular, forcar: a.forcar, ferramenta: 'pcb_apagar' });
      },
    },
    {
      nome: 'pcb_trilha', titulo: 'Desenhar trilha (polilinha)',
      descricao: 'Desenha uma trilha por vários pontos (um track_add por trecho). Pontos em mm, ou "REF.PINO" para começar/terminar no centro de um pad (a net do pad é usada se você não der net). Largura padrão: a preferida da regra Width que vence para a net e a camada (rules.js do projeto, como o Rule Preferred do Altium). Em camada que não é cobre (TopOverlay, Mech1, KeepOut) vira linha de desenho.',
      entrada: { type: 'object', properties: Object.assign({
        projeto: PROJETO, layer: { type: 'string', description: 'Top, Bottom, Mid1..., TopOverlay, Mech1, KeepOut...' },
        pts: { type: 'array', minItems: 2, items: { oneOf: [PT, { type: 'string' }] }, description: '[[x,y], [x,y], ...] ou "R1.1" nas pontas' },
        w: { type: 'number', exclusiveMinimum: 0 }, net: { type: 'string' },
      }, COMUNS), required: ['projeto', 'layer', 'pts'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const { eb, board } = ctx.placa(p);
        const P = a.pts.map((v, i) => ponto(eb, v, 'pts[' + i + ']'));
        const net = a.net != null ? a.net : (P.find(x => x.net) || {}).net || '';
        let w = a.w || larguraDaNet(ctx, eb, p, net, a.layer, board);
        const RT = ctx.modulo('hub-roteador.js');
        const lim = a.w && RT && RT.limitaLargura && ctx.hc.isCopper(a.layer) ? RT.limitaLargura(cena(ctx, eb, p), net, a.layer, a.w) : null;
        if (lim && lim.ajustada) w = lim.w;
        const L = [];
        for (let i = 1; i < P.length; i++) {
          if (P[i - 1].x === P[i].x && P[i - 1].y === P[i].y) continue;
          const o = { op: 'track_add', layer: a.layer, x1: r4(P[i - 1].x), y1: r4(P[i - 1].y), x2: r4(P[i].x), y2: r4(P[i].y), w };
          if (net && ctx.hc.isCopper(a.layer)) o.net = net;
          L.push(comNote(o, a));
        }
        const est = ops.transacao(ctx, p, arq => L.map(o => ops.mescla(arq, o).obj), { simular: a.simular, forcar: a.forcar, ferramenta: 'pcb_trilha' });
        if (lim && lim.ajustada) est.largura_ajustada = `w ${a.w} fora da regra ${lim.regra} (${lim.min}..${lim.max} mm): usei ${r4(w)}`;
        return est;
      },
    },
    {
      nome: 'pcb_rotear', titulo: 'Rotear contornando (walkaround)',
      descricao: 'Roteia uma trilha de um ponto/pad até outro na mesma camada com o roteador do hub (hub-roteador.js, o Walkaround do Altium): respeita a folga das regras, contorna o cobre de outras nets e não mexe em nada que já está. Devolve o caminho; com aplicar:true (padrão) grava os track_add. completa:false = parou antes do obstáculo (use outra camada + pcb_via).',
      modulo: 'hub-roteador.js',
      entrada: { type: 'object', properties: Object.assign({
        projeto: PROJETO, layer: { type: 'string' },
        de: { oneOf: [PT, { type: 'string' }], description: '[x,y] ou "REF.PINO"' }, ate: { oneOf: [PT, { type: 'string' }], description: '[x,y] ou "REF.PINO"' },
        w: { type: 'number' }, net: { type: 'string' }, modo: { type: 'string', enum: ['45', '90', 'livre'], description: 'padrão 45' },
        aplicar: { type: 'boolean', description: 'padrão true' },
      }, COMUNS), required: ['projeto', 'layer', 'de', 'ate'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const { eb, board } = ctx.placa(p);
        const R = ctx.exige('hub-roteador.js', 'HubRoteador');
        const A = ponto(eb, a.de, 'de', a.layer), B = ponto(eb, a.ate, 'ate', a.layer);
        const net = a.net || A.net || B.net || '';
        /* pad SMD só existe na camada dele: a trilha de outra camada terminaria em cima dele sem
           ligar nada (o ratsnest continuaria lá) — como no Altium, a rota até ele é na camada dele */
        const smdFora = q => q.pad && !(q.pad.type === 'th' || q.pad.layer === 'Multi') && q.pad.layer && q.pad.layer !== a.layer ? q.pad : null;
        const pf = smdFora(A) || smdFora(B);
        if (pf) return { completa: false, motivo: 'pad-em-outra-camada', pontos: [], bloqueio: null, net,
                         nota: `o pad SMD ${A.pad === pf ? a.de : a.ate} está no ${pf.layer}: rotee no ${pf.layer} (ou chegue nele por via)` };
        const C = cena(ctx, eb, p);
        /* sem w: a Width vencedora para a net e a camada (Rule Preferred), a mesma que o DRC confere */
        let w = a.w || (R.larguraDaRegra ? R.larguraDaRegra(C, net, a.layer).pref : (board.rules && board.rules.width > 0 ? board.rules.width : 0.254));
        /* o w dado fora da faixa da regra vira o limite dela, como a rota do Altium */
        const lim = a.w && R.limitaLargura ? R.limitaLargura(C, net, a.layer, a.w) : null;
        if (lim && lim.ajustada) w = lim.w;
        const r = R.rota(C, { layer: a.layer, w, net, de: [A.x, A.y], ate: [B.x, B.y], modo: a.modo || '45',
                              alvo: { eletrico: !!B.pad, net: B.net }, conflito: 'contornar' });
        const out = { completa: r.completa, motivo: r.motivo, pontos: (r.pts || []).map(q => [r4(q[0]), r4(q[1])]), bloqueio: r.bloqueio, net, w, ms: r.ms };
        if (lim && lim.ajustada) out.largura_ajustada = `w ${a.w} fora da regra ${lim.regra} (${lim.min}..${lim.max} mm): usei ${r4(w)}`;
        if (r.motivo === 'camada-proibida') out.nota = `a regra Routing Layers da net ${net || '(sem net)'} não permite ${a.layer}: rotee em outra camada`;
        /* a partida já estava perto demais de outro cobre (pad de passo fino com a largura da regra,
           ponta antiga encostada em outra net): o roteador sai sem piorar, mas o caminho fica abaixo
           da folga e o DRC acusa. No Walkaround do Altium essa rota não sai: aqui ela só é gravada
           com forcar */
        if ((r.violacoes || []).length) {
          out.violacoes = r.violacoes.slice(0, 10).map(c => ({ id: c.id, net: c.net, tipo: c.tipo, dist: r4(Math.max(0, c.dist)), folga: r4(c.folga) }));
          out.nota = `a partida já está a menos da folga da regra de ${r.violacoes.map(c => c.tipo + ' ' + c.id).slice(0, 3).join(', ')}: a rota sairia com violação de Clearance — use w menor (a faixa da regra Width), parta de outro ponto, ou forcar:true`;
          if (!a.forcar) { out.completa = false; out.motivo = 'partida-em-conflito'; return out; }
        }
        if (a.aplicar === false || !r.pts || r.pts.length < 2) return out;
        const L = [];
        for (let i = 1; i < r.pts.length; i++) {
          const o = { op: 'track_add', layer: a.layer, x1: r4(r.pts[i - 1][0]), y1: r4(r.pts[i - 1][1]), x2: r4(r.pts[i][0]), y2: r4(r.pts[i][1]), w };
          if (net) o.net = net;
          L.push(comNote(o, a));
        }
        out.gravacao = ops.transacao(ctx, p, arq => L.map(o => ops.mescla(arq, o).obj), { simular: a.simular, forcar: a.forcar, ferramenta: 'pcb_rotear' });
        return out;
      },
    },
    {
      nome: 'pcb_autorotear', titulo: 'Autorotear (várias camadas, vias, lote)',
      modulo: 'hub-autoroteador.js',
      descricao: 'Liga SOZINHO as conexões abertas do ratsnest (todas, ou só as `nets` dadas) com o autoroteador do hub (hub-autoroteador.js, em cima do mesmo motor exato do pcb_rotear): várias camadas, trocando de camada por via; uma conexão depois da outra, na `ordem` (curta = a mais curta primeiro, o padrão; longa; classe = a net de regra mais pesada primeiro; dada = a ordem de `nets`; ou uma lista de nets), e arranca-e-refaz nas que falharam (só rotas deste lote saem — o cobre que já está na placa nunca é mexido). Cada rota respeita as regras do projeto como o DRC: a folga de cada par pela Clearance vencedora do rules.js (classes de net, escopo, matriz), a Board Outline Clearance, a Width e a Routing Via Style da net, a Routing Layers; pad SMD só na camada dele; camada Plane não recebe trilha; a via respeita furo a furo e ponte de máscara. Padrão gravar:false = SIMULA: devolve conexões abertas antes/depois, por net, vias, comprimento, falhas com motivo, tempo, e o DRC da placa com as rotas (violações NOVAS — a meta é zero). gravar:true grava os track_add/via_add no changes.js pelo mesmo caminho validado das outras pcb_* (erro de validação ou violação nova de DRC = nada gravado; forcar:true passa por cima do DRC). Para ver: pcb_render {ratsnest:true}, uma camada por vez.',
      entrada: { type: 'object', properties: {
        projeto: PROJETO,
        nets: { type: 'array', items: { type: 'string' }, description: 'só estas nets (padrão: todas as que têm conexão aberta)' },
        camadas: { type: 'array', items: { type: 'string' }, description: 'camadas de sinal que podem receber trilha (padrão: todas as de cobre da placa, menos Plane)' },
        ordem: { anyOf: [{ type: 'string', enum: ['curta', 'longa', 'classe', 'dada'] }, { type: 'array', items: { type: 'string' } }], description: 'padrão "curta"; uma lista de nets = esta ordem' },
        passes: { type: 'integer', minimum: 0, maximum: 20, description: 'passadas de arranca-e-refaz (padrão 4; 0 = passada única)' },
        custoVia: { type: 'number', minimum: 0, description: 'quanto uma via "custa", em mm de trilha (padrão 3): maior = menos via, rota mais longa' },
        res: { type: 'number', exclusiveMinimum: 0, description: 'passo da grade em mm (padrão: o da cena, 0,1 mm numa placa normal)' },
        orcamento: { type: 'object', properties: { tempoMs: { type: 'integer', minimum: 100 }, nosPorBusca: { type: 'integer', minimum: 1000 } }, description: 'padrão {tempoMs: 60000, nosPorBusca: 300000}' },
        gravar: { type: 'boolean', description: 'padrão false (só simula e mostra)' },
        forcar: { type: 'boolean', description: 'grava mesmo com violação nova de DRC (evite)' },
        note: { type: 'string', description: 'o note das linhas (padrão "pcb_autorotear")' },
      }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const A = ctx.exige('hub-autoroteador.js', 'HubAutoRoteador');
        ctx.exige('hub-pcbnets.js', 'HubPcbNets');
        const R = ctx.exige('hub-roteador.js', 'HubRoteador');
        /* a placa como a tela (e o drc_rodar / nets_ratsnest) a vê: os polígonos do hub despejados */
        const pl = ctx.placaDespejada(p), eb = pl.eb;
        const tg = textoGeo(ctx);
        const S = ops.regrasDoProjeto(ctx, p);
        const o = { placa: { lacos: lacosDe(ctx, eb), recortes: recortesDe(eb) }, textoGeo: tg };
        if (S) o.regras = S.conjunto; else o.clearance = (eb.rules && eb.rules.clearance > 0) ? eb.rules.clearance : R.FOLGA_PADRAO;
        if (isNum(a.res) && a.res > 0) o.res = a.res;
        const C = R.cena(eb, o);
        const note = a.note ? String(a.note).replace(/":/g, '" :') : 'pcb_autorotear';
        const r = A.rotearLote(eb, { cena: C, roteador: R, nets: a.nets, camadas: a.camadas, ordem: a.ordem, passes: a.passes, custoVia: a.custoVia, orcamento: a.orcamento, note });
        const out = {
          projeto: p.nome, regras_de: S ? S.fonte : 'folga única do board.rules (sem hub-pcbregras.js)',
          conexoes_abertas: { antes: r.antes.conexoes, depois: r.depois.conexoes, das_nets_pedidas: { antes: r.alvo.conexoes, depois: r.depois.doAlvo } },
          roteadas: r.roteadas, primeira_passada: r.primeiraPassada, vias: r.vias, comprimento_mm: r4(r.comprimento),
          trilhas: r.ops.filter(x => x.op === 'track_add').length, passes: r.passes, arrancadas: r.arrancadas, ms: r.ms,
          orcamento: r.orcamento, parametros: r.parametros, falhas: r.falhas, por_net: r.porNet,
          rotas: r.rotas.slice(0, 60), rotas_total: r.rotas.length,
        };
        if (!r.ops.length) { out.gravacao = { ok: true, gravado: false, nota: r.alvo.conexoes ? 'nenhuma rota saiu (veja falhas)' : 'nada a ligar: o ratsnest das nets pedidas está fechado' }; return out; }
        /* o DRC da placa com as rotas (despejada de novo: o plano recua das trilhas novas), contra o de
           antes: as violações NOVAS (a net não roteada fica de fora — a árvore do ratsnest muda) */
        const D = ctx.modulo('hub-pcbdrc.js');
        const itens = ctx.changes(p).concat(r.ops);
        const depois = ctx.placaDespejada(p, itens);
        if (D) {
          const conj = S ? S.conjunto : undefined;
          const chave = v => v.tipo + '|' + (v.ids || []).map(x => String(x).replace(/^(q:[^:]*):\d+$/, '$1')).sort().join('|');
          const d0 = D.rodar(eb, conj, { textoGeo: tg }), d1 = D.rodar(depois.eb, conj, { textoGeo: tg });
          const ja = new Set(d0.violacoes.map(chave));
          const novas = d1.violacoes.filter(v => v.tipo !== 'UnRoutedNet' && !ja.has(chave(v)));
          const porTipo = {};
          for (const v of novas) porTipo[v.tipo] = (porTipo[v.tipo] || 0) + 1;
          out.drc = { antes: d0.total, depois: d1.total, novas: novas.length, novas_por_tipo: porTipo,
                      novas_lista: novas.slice(0, 40).map(v => ({ tipo: v.tipo, msg: v.msg, x: r4(v.x), y: r4(v.y), layer: v.layer, ids: v.ids })) };
        } else out.drc = { nota: 'hub-pcbdrc.js ausente: o DRC não rodou' };
        /* o ratsnest da placa como ela fica (o mesmo motor do nets_ratsnest) */
        const N = ctx.modulo('hub-pcbnets.js');
        if (N) out.conexoes_abertas.na_placa_depois = N.naoRoteadas(depois.eb).conexoes;
        if (a.gravar && out.drc.novas && !a.forcar) {
          out.gravacao = { ok: false, gravado: false, motivo: 'drc', erro: `${out.drc.novas} violação(ões) nova(s) de DRC: nada foi gravado (forcar:true grava mesmo assim)` };
          return out;
        }
        const g = ops.transacao(ctx, p, arq => r.ops.map(op => ops.mescla(arq, op).obj), { simular: !a.gravar, forcar: a.forcar, ferramenta: 'pcb_autorotear' });
        g.linhas_total = (g.linhas || []).length;
        g.linhas = (g.linhas || []).slice(0, 12);
        out.gravacao = g;
        if (!a.gravar) out.nota = 'simulação: nada foi gravado — repita com gravar:true para escrever as ' + r.ops.length + ' linhas no changes.js';
        return out;
      },
    },
    {
      nome: 'pcb_via', titulo: 'Colocar via',
      descricao: 'Coloca uma via (via_add). size = diâmetro do anel, drill = furo (padrão: a preferida da regra Routing Via Style que vence para a net). A net, se omitida, sai do pad/trilha no ponto. Para trocar de camada: trilha até [x,y] numa camada, via em [x,y], trilha da outra camada saindo de [x,y].',
      entrada: { type: 'object', properties: Object.assign({ projeto: PROJETO, x: { type: 'number' }, y: { type: 'number' },
        size: { type: 'number' }, drill: { type: 'number' }, net: { type: 'string' } }, COMUNS), required: ['projeto', 'x', 'y'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const { eb, board } = ctx.placa(p);
        const R = board.rules || {};
        let net = a.net;
        if (net == null) {
          const t = (eb.tracks || []).find(t => t.net && ctx.hc.isCopper(t.layer) && geo.distSeg(a.x, a.y, t.x1, t.y1, t.x2, t.y2) <= (t.w || 0) / 2);
          const q = TIPOS.pads(eb).find(q => q.net && geo.noPad(q, a.x, a.y, 0));
          net = (t && t.net) || (q && q.net) || '';
        }
        /* sem size/drill: a Routing Via Style vencedora para a net (o "Rule Preferred" do Altium) */
        const vd = viaDaNet(ctx, eb, p, net, R);
        const op = { op: 'via_add', x: a.x, y: a.y, size: a.size || vd.size, drill: a.drill || vd.drill };
        if (net) op.net = net;
        /* size/drill dados fora da faixa da Routing Via Style viram o limite dela */
        const RL = ctx.modulo('hub-roteador.js');
        const limV = (a.size || a.drill) && RL && RL.limitaVia ? RL.limitaVia(cena(ctx, eb, p), net, op.size, op.drill) : null;
        if (limV && limV.ajustada) { op.size = r4(limV.size); op.drill = r4(limV.drill); }
        /* via encostada em cobre de outra net não entra — a mesma conferência da vista (e a folga da
           regra do par, a mesma do DRC). forcar:true passa por cima */
        const RT = ctx.modulo('hub-roteador.js');
        if (RT && RT.folgaVia && !a.forcar) {
          const f = RT.folgaVia(cena(ctx, eb, p), { x: a.x, y: a.y, size: op.size }, { net });
          if (!f.ok) return { ok: false, gravado: false, motivo: 'conflito',
                              erro: 'via não posta: ' + f.conflitos.slice(0, 5).map(c => `${c.tipo} ${c.id}${c.net ? ' (' + c.net + ')' : ''} no ${c.layer} a ${r4(Math.max(0, c.dist))} mm (a regra pede ${r4(c.folga)})`).join('; '),
                              conflitos: f.conflitos.slice(0, 20) };
        }
        const est = ops.transacao(ctx, p, arq => [ops.mescla(arq, comNote(op, a)).obj], { simular: a.simular, forcar: a.forcar, ferramenta: 'pcb_via' });
        if (limV && limV.ajustada) est.via_ajustada = `fora da regra ${limV.regra}: usei ${op.size}/${op.drill} mm`;
        return est;
      },
    },
    {
      nome: 'pcb_contorno', titulo: 'Redefinir contorno da placa', destrutiva: true,
      descricao: 'Substitui o contorno da placa (outline_set): dê pts [[x,y],...] (polígono fechado, só retas) ou um retângulo {x0,y0,largura,altura}. O ApplyChanges pede confirmação ao usuário no Altium.',
      entrada: { type: 'object', properties: Object.assign({ projeto: PROJETO, pts: { type: 'array', items: PT, minItems: 3 },
        retangulo: { type: 'object', properties: { x0: { type: 'number' }, y0: { type: 'number' }, largura: { type: 'number' }, altura: { type: 'number' } } } }, COMUNS), required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        let pts = a.pts;
        if (!pts && a.retangulo) { const r = a.retangulo, x0 = r.x0 || 0, y0 = r.y0 || 0; pts = [[x0, y0], [x0 + r.largura, y0], [x0 + r.largura, y0 + r.altura], [x0, y0 + r.altura]]; }
        if (!pts) throw new ErroMcp('dê pts ou retangulo');
        return ops.transacao(ctx, p, arq => {
          const i = arq.itens.findIndex(x => x && x.op === 'outline_set');
          const op = comNote({ op: 'outline_set', pts }, a);
          if (i >= 0) { arq.substitui(i, op); return [op]; }
          return [ops.mescla(arq, op).obj];
        }, { simular: a.simular, forcar: a.forcar, ferramenta: 'pcb_contorno' });
      },
    },
    {
      nome: 'pcb_mudanca_remover', titulo: 'Remover linhas do changes.js', destrutiva: true,
      descricao: 'Remove ops do changes.js pelo índice (pcb_mudancas mostra). É o "desfazer" de uma mudança qualquer, inclusive objeto acrescentado (track_add, via_add...). Os comentários do arquivo ficam.',
      entrada: { type: 'object', properties: { projeto: PROJETO, indices: { type: 'array', items: { type: 'integer', minimum: 0 }, minItems: 1 }, simular: COMUNS.simular }, required: ['projeto', 'indices'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const removidas = [];
        const est = ops.transacao(ctx, p, arq => {
          for (const i of [...new Set(a.indices)].sort((x, y) => y - x)) {
            if (i >= arq.itens.length) throw new ErroMcp(`índice ${i} não existe (o arquivo tem ${arq.itens.length} ops)`);
            removidas.push(arq.itens[i]); arq.remove(i);
          }
          return [];
        }, { simular: a.simular, forcar: true, ferramenta: 'pcb_mudanca_remover' });
        est.removidas = removidas;
        return est;
      },
    },
    {
      nome: 'pcb_mudanca_editar', titulo: 'Editar uma linha do changes.js',
      descricao: 'Muda campos de uma op do changes.js pelo índice (ex.: mover o fim de um track_add: {"x2":30}). remover_campos tira campos. Os orig_* não se editam aqui (eles são a trava de segurança).',
      entrada: { type: 'object', properties: Object.assign({ projeto: PROJETO, indice: { type: 'integer', minimum: 0 },
        campos: { type: 'object', additionalProperties: true }, remover_campos: { type: 'array', items: { type: 'string' } } }, COMUNS), required: ['projeto', 'indice'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        return ops.transacao(ctx, p, arq => {
          const v = arq.itens[a.indice];
          if (!v) throw new ErroMcp(`índice ${a.indice} não existe`);
          const n = Object.assign({}, v);
          for (const [k, x] of Object.entries(a.campos || {})) { if (k.startsWith('orig_') || k === 'op') throw new ErroMcp(`"${k}" não se edita aqui`); n[k] = x; }
          for (const k of a.remover_campos || []) if (!k.startsWith('orig_') && k !== 'op') delete n[k];
          arq.substitui(a.indice, n);
          return [n];
        }, { simular: a.simular, forcar: a.forcar, ferramenta: 'pcb_mudanca_editar' });
      },
    },
    {
      nome: 'pcb_validar', titulo: 'Validar a placa', leitura: true,
      descricao: 'Roda o motor do hub (applyPcbChanges) sobre board.js + changes.js e devolve todos os erros/avisos por linha, e se o arquivo passa no formato que o ApplyChanges lê. Não é DRC (para folgas: drc_rodar).',
      entrada: { type: 'object', properties: { projeto: PROJETO }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const { model, changes } = ctx.placa(p);
        const ser = ctx.hc.serializeChanges(changes);
        return { ok: !model.validation.some(v => v.level === 'err') && !ser.errors.length, mudancas: changes.length,
                 validacao: ops.resumoValidacao(model, 500), formato: ser.errors.map(e => `#${e.idx + 1} ${e.msg}`) };
      },
    },
    {
      nome: 'pcb_render', titulo: 'Imagem da placa', leitura: true,
      descricao: 'Desenha a placa efetiva (com as mudanças e os planos despejados) num PNG: cobre nas cores do Altium, pads, vias, furos, serigrafia, contorno. Para conferir curto/folga olhe UMA camada de cobre por vez (camadas:["Top","Multi"] e depois ["Bottom","Multi"]) com zoom (caixa). Opções: lado bottom (vista de baixo), caixa (zoom numa região em mm), camadas (só estas), net (destaca uma net), ratsnest (linhas do que falta ligar), marcas [[x,y]]. Use para CONFERIR o que fez.',
      entrada: { type: 'object', properties: {
        projeto: PROJETO, largura: { type: 'integer', minimum: 200, maximum: 2400, description: 'pixels (padrão 1000)' },
        lado: { type: 'string', enum: ['top', 'bottom'] },
        caixa: { type: 'object', properties: { x1: { type: 'number' }, y1: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' } } },
        camadas: { type: 'array', items: { type: 'string' } }, net: { type: 'string' }, ratsnest: { type: 'boolean' },
        marcas: { type: 'array', items: PT },
        despejar: { type: 'boolean', description: 'padrão true: desenha os planos (polígonos) despejados, como a tela' },
      }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const { eb } = a.despejar === false ? ctx.placa(p) : ctx.placaDespejada(p);
        let rats = [];
        if (a.ratsnest) {
          const N = ctx.modulo('hub-pcbnets.js');
          if (N && typeof N.conexoes === 'function') rats = (N.conexoes(eb).linhas || []);
          else rats = [].concat(...geo.conectividade(ctx.hc, eb).nets.map(n => n.faltam));
        }
        const r = render.desenha(ctx.hc, eb, { largura: a.largura, lado: a.lado, caixa: caixa(a.caixa), camadas: a.camadas, net: a.net,
          rats, marcas: (a.marcas || []).map(m => ({ x: m[0], y: m[1] })), textoGeo: textoGeo(ctx) });
        return { projeto: p.nome, largura: r.largura, altura: r.altura, mm_por_px: r.mm_por_px, janela_mm: r.janela, lado: r.lado,
                 ratsnest: a.ratsnest ? rats.length + ' ligações faltando' : undefined,
                 _imagem: { base64: r.png.toString('base64'), mime: 'image/png' } };
      },
    },
  ],
  _interno: { TIPOS, cena, lacosDe, recortesDe, textoGeo, padDe },
};
