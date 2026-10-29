/* NexoEletric MCP - grupo "serigrafia" (1.37.0): conferir e posicionar texto de serigrafia sem rodar
   o DRC inteiro.
     serigrafia_checar      diz se um lugar candidato (ref, id de texto ou texto novo) viola alguma
                            regra da casa — a mesma cena e a mesma conta do regras_casa_verificar
                            (regras-casa.js » cenaSerigrafia/checaSerigrafia), com as regras do
                            projeto (regras-casa.json) e as da área onde o texto cai;
     serigrafia_posicionar  acha lugar para os designadores: altura entre min e max, folgas, longe
                            do corpo dos componentes, fora de ambiguidade (o rótulo não fica mais
                            perto de outro componente que do dono), "fileira" (o rótulo alinhado
                            ao próprio componente numa fileira) e simulação antes de gravar.
   A placa é a efetiva SEM redespejar os polígonos: plano pode ficar embaixo do texto (a regra da
   casa), então o despejo não muda nada aqui e a conta fica rápida.
   A forma de cada texto candidato é a do HubGerber (a da tela e do Gerber), feita uma vez por
   altura/traço/giro e só transladada para cada lugar. */
'use strict';
const { ErroMcp } = require('../lib/contexto.js');
const ops = require('../lib/pcb-ops.js');
const { PROJETO, isNum } = require('../lib/util.js');
const RC = require('./regras-casa.js')._interno;

const E = 1e4;
const r3 = v => Math.round(v * 1000) / 1000;
const normRot = a => ((Math.round(a) % 360) + 360) % 360;

/* a placa e a cena da serigrafia, com as regras do projeto */
function monta(ctx, a) {
  const p = ctx.projeto(a.projeto);
  const K = RC.kit(ctx.exige('hub-clipper.js', 'ClipperLib'));
  const cfg = RC.lerConfig(p);
  const chamada = RC.paramsDaChamada(a);
  if (isNum(a.folga_pad)) chamada.silk = a.folga_pad;
  if (isNum(a.folga_trilha)) chamada.silk_cobre = a.folga_trilha;
  const o = Object.assign({}, RC.PAD, cfg.parametros, chamada);
  const { eb } = ctx.placa(p);
  const tg = RC.textoGeo(ctx);
  const { furos, cobre } = RC.preparaPlaca(ctx, eb, K, o, a, ['Top', 'Bottom']);
  const cena = RC.cenaSerigrafia(ctx, eb, K, furos, cobre, tg);
  const regras = (x, y, layer) => {
    const r = RC.regrasEm(cfg, RC.PAD, chamada, x, y, layer);
    if (a.ignorar_trilha) r.desl.add('serigrafia_trilha');
    return r;
  };
  /* o corpo de cada componente: a caixa dele (pads, contorno e desenho do footprint) */
  const corpos = (eb.components || []).filter(c => c && c.bbox && [c.bbox.x1, c.bbox.y1, c.bbox.x2, c.bbox.y2].every(isNum)).map(c => {
    const b = c.bbox, m = 0.05;          // encostar na caixa vale
    const q = { x1: b.x1 + m, y1: b.y1 + m, x2: b.x2 - m, y2: b.y2 - m };
    return { ref: c.ref, lado: c.layer === 'Bottom' ? 'Bottom' : 'Top', caixa: b, bb: q, footprint: c.footprint, cx: (b.x1 + b.x2) / 2, cy: (b.y1 + b.y2) / 2,
             paths: q.x2 > q.x1 && q.y2 > q.y1 ? [K.paraC([[q.x1, q.y1], [q.x2, q.y1], [q.x2, q.y2], [q.x1, q.y2]])] : [] };
  });
  return { p, K, cfg, chamada, o, eb, tg, cena, regras, corpos };
}

/* distancia de um ponto a uma caixa (0 dentro) */
const dCaixa = (x, y, b) => Math.hypot(Math.max(b.x1 - x, 0, x - b.x2), Math.max(b.y1 - y, 0, y - b.y2));
/* o componente mais perto do centro do texto, entre os do lado dele: o rotulo e ambiguo quando
   outro fica mais perto que o dono (com a margem) */
function ambiguo(M, ref, lado, x, y, margem) {
  const dono = M.corpos.find(c => c.ref === ref);
  if (!dono) return null;
  const d0 = dCaixa(x, y, dono.caixa);
  for (const c of M.corpos) if (c.ref !== ref && c.lado === lado && dCaixa(x, y, c.caixa) < d0 + margem) return c.ref;
  return null;
}

/* o texto como ele seria naquele lugar: copia do texto base sem o contorno exato do Altium (que
   e da posicao velha), com a fonte do hub */
function textoEm(base, x, y, h, w, rot) {
  const t = Object.assign({}, base);
  delete t.polys; delete t.ax; delete t.ay; delete t.font;
  t.kind = base.kind === 'truetype' ? 'truetype' : 'stroke';
  Object.assign(t, { x, y, h, w, rot });
  return t;
}
/* a forma no zero, guardada por texto/altura/traco/giro/espelho; cada lugar so translada */
function formaNoZero(M, cache, base, h, w, rot) {
  const k = [base.text, base.layer, base.mirror ? 1 : 0, base.kind === 'truetype' ? 't' : 's', h, w, rot].join('|');
  let f = cache.get(k);
  if (!f) {
    const paths = RC.formaTexto(M.K, M.tg, textoEm(base, 0, 0, h, w, rot));
    const bb = M.K.caixa(paths);
    f = { paths, bb, cx: (bb.x1 + bb.x2) / 2, cy: (bb.y1 + bb.y2) / 2, larg: bb.x2 - bb.x1, alt: bb.y2 - bb.y1, areaU: M.K.area(M.K.uniaoC(paths)) };
    cache.set(k, f);
  }
  return f;
}
/* o objeto de serigrafia de um texto com a TINTA centrada em (X, Y); devolve tambem o x/y a gravar */
function silkEm(M, f, base, X, Y, h, w, rot) {
  const dx = Math.round((X - f.cx) * E), dy = Math.round((Y - f.cy) * E);
  const paths = f.paths.map(pa => pa.map(q => ({ X: q.X + dx, Y: q.Y + dy })));
  const bb = { x1: f.bb.x1 + dx / E, y1: f.bb.y1 + dy / E, x2: f.bb.x2 + dx / E, y2: f.bb.y2 + dy / E };
  const lado = base.layer === 'BottomOverlay' ? 'Bottom' : 'Top';
  return { tipo: 'texto', id: base.id || '', texto: base.text, owner: base.owner || '', designator: !!base.designator, lado, layer: base.layer,
           paths, bb, h, w, areaU: f.areaU, kind: base.kind === 'truetype' ? 'truetype' : 'stroke', gravar: { x: r3(X - f.cx), y: r3(Y - f.cy) } };
}

/* o texto de que se fala: o designator de um ref, um texto pelo id, ou um texto novo */
function baseDe(M, it) {
  const T = M.eb.texts || [];
  if (it.ref) {
    const t = T.find(x => x && x.designator && x.owner === it.ref);
    if (!t) throw new ErroMcp(`o designator de "${it.ref}" não está na placa (pcb_componente mostra os textos dele)`);
    return t;
  }
  if (it.id) {
    const t = T.find(x => x && String(x.id) === String(it.id));
    if (!t) throw new ErroMcp(`não existe texto com id "${it.id}" na placa`);
    return t;
  }
  if (!it.text || !/^(Top|Bottom)Overlay$/.test(it.layer || '')) throw new ErroMcp('cada item precisa de ref, id, ou text + layer (TopOverlay/BottomOverlay)');
  return { id: '', text: String(it.text), layer: it.layer, mirror: it.layer === 'BottomOverlay', h: 1, w: 0.15, rot: 0, kind: 'stroke' };
}
const curta = v => ({ regra: v.sub || v.regra, msg: v.msg, x: v.x, y: v.y });

/* ---------------- serigrafia_checar ---------------- */
function checar(ctx, a) {
  const t0 = Date.now();
  const M = monta(ctx, a);
  const cache = new Map();
  const res = a.textos.map(it => {
    const base = baseDe(M, it);
    const h = isNum(it.h) ? it.h : base.h, rot = isNum(it.rot) ? normRot(it.rot) : (base.rot || 0);
    const w = isNum(it.w) ? it.w : (base.w || r3(h * 0.15));
    const X = isNum(it.x) ? it.x : base.x, Y = isNum(it.y) ? it.y : base.y;
    if (!isNum(X) || !isNum(Y) || !(h > 0)) throw new ErroMcp('cada item precisa de x, y (e h para texto novo)');
    const f = formaNoZero(M, cache, base, h, w, rot);
    /* x/y = centro do texto (a convencao do board.js), como o designator_move grava */
    const s = silkEm(M, f, base, X + f.cx, Y + f.cy, h, w, rot);
    s.gravar = { x: X, y: Y };
    const r = M.regras(X, Y, base.layer);
    const ignora = new Set(base.id ? [String(base.id)] : []);
    const v = RC.checaSerigrafia(M.cena, s, r.o, r.desl, { ignora, corpos: a.corpo ? M.corpos.filter(c => c.ref !== base.owner || a.corpo === 'todos') : null });
    const out = { item: it.ref || it.id || it.text, x: X, y: Y, h, w, rot, ok: !v.length, violacoes: v.map(curta) };
    if (a.ambiguidade && base.owner) { const am = ambiguo(M, base.owner, s.lado, X, Y, isNum(a.margem_ambiguidade) ? a.margem_ambiguidade : 0.2); if (am) { out.ok = false; out.ambiguo_com = am; } }
    return out;
  });
  return { projeto: M.p.nome, ok: res.every(x => x.ok), ms: Date.now() - t0, textos: res,
           regras_do_projeto: M.cfg.existe ? { parametros: M.cfg.parametros, desligar: M.cfg.desligar, areas: M.cfg.areas.length } : null };
}

/* ---------------- serigrafia_posicionar ---------------- */
/* a fileira do componente: vizinhos do mesmo footprint na mesma linha (horizontal) ou coluna */
function fileiraDe(M, c) {
  const L = Math.max(c.caixa.x2 - c.caixa.x1, c.caixa.y2 - c.caixa.y1) * 4 + 3;
  let hz = 0, vt = 0;
  for (const o of M.corpos) {
    if (o === c || o.lado !== c.lado || o.footprint !== c.footprint) continue;
    if (Math.abs(o.cy - c.cy) < 0.5 && Math.abs(o.cx - c.cx) < L) hz++;
    if (Math.abs(o.cx - c.cx) < 0.5 && Math.abs(o.cy - c.cy) < L) vt++;
  }
  return hz || vt ? (hz >= vt ? 'horizontal' : 'vertical') : null;
}
/* os lugares candidatos em volta da caixa B, do mais barato ao mais caro */
function candidatos(B, f, modo, fileira, dmax, passo) {
  const out = [];
  const cx = (B.x1 + B.x2) / 2, cy = (B.y1 + B.y2) / 2, hw = (B.x2 - B.x1) / 2, hh = (B.y2 - B.y1) / 2;
  const lados = modo === 'fileira' && fileira === 'horizontal' ? ['cima', 'baixo']
    : modo === 'fileira' && fileira === 'vertical' ? ['direita', 'esquerda'] : ['cima', 'baixo', 'direita', 'esquerda'];
  const pena = { cima: 0, baixo: 0.05, direita: 0.1, esquerda: 0.15 };
  for (let d = 0.15; d <= dmax + 1e-9; d += passo) for (const lado of lados) {
    const horiz = lado === 'cima' || lado === 'baixo';
    const alcance = modo === 'fileira' ? 0 : (horiz ? hw + d + f.larg / 2 : hh + d + f.alt / 2);
    for (let k = 0; k * passo <= alcance + 1e-9; k++) for (const sg of k ? [1, -1] : [1]) {
      const sh = sg * k * passo;
      const X = horiz ? cx + sh : (lado === 'direita' ? B.x2 + d + f.larg / 2 : B.x1 - d - f.larg / 2);
      const Y = horiz ? (lado === 'cima' ? B.y2 + d + f.alt / 2 : B.y1 - d - f.alt / 2) : cy + sh;
      out.push({ X, Y, custo: d + Math.abs(sh) * 0.5 + pena[lado], lado, d });
    }
  }
  return out;
}

function posicionar(ctx, a) {
  const t0 = Date.now();
  const M = monta(ctx, a);
  const cache = new Map(), avisos = [];
  const T = M.eb.texts || [];
  const modo = a.modo === 'fileira' ? 'fileira' : 'perto';
  const dmax = isNum(a.distancia_max) ? a.distancia_max : 4, passo = isNum(a.passo) ? Math.max(0.05, a.passo) : 0.25;
  const proibeCorpo = a.sobre_corpo !== true;
  const margem = isNum(a.margem_ambiguidade) ? a.margem_ambiguidade : 0.2;
  const maxTent = isNum(a.max_tentativas) ? a.max_tentativas : 4000;
  /* quem: os pedidos, senao todo componente com designator na placa */
  let refs = Array.isArray(a.refs) && a.refs.length ? a.refs.slice()
    : T.filter(t => t && t.designator && !t.hidden && t.owner).map(t => t.owner);
  const naoAchados = refs.filter(r => !T.some(t => t && t.designator && t.owner === r) || !M.corpos.some(c => c.ref === r));
  refs = refs.filter(r => !naoAchados.includes(r));
  /* so os que violam hoje (padrao), a menos que peça todos */
  const violando = new Map();
  for (const ref of refs) {
    const t = T.find(x => x && x.designator && x.owner === ref);
    const s = RC.silkDeTexto(M.K, M.tg, t);
    if (!s) continue;
    const r = M.regras((s.bb.x1 + s.bb.x2) / 2, (s.bb.y1 + s.bb.y2) / 2, t.layer);
    const v = RC.checaSerigrafia(M.cena, s, r.o, r.desl, { parar: true, corpos: proibeCorpo ? M.corpos : null });
    if (v.length) violando.set(ref, v[0]);
  }
  if (a.todos !== true) refs = refs.filter(r => violando.has(r));
  /* os textos velhos dos que vao andar nao contam (vao sair dali) */
  const ignora = new Set(refs.map(r => String((T.find(x => x && x.designator && x.owner === r) || {}).id)));

  const movidos = [], falhas = [];
  for (const ref of refs) {
    const base = T.find(x => x && x.designator && x.owner === ref);
    const dono = M.corpos.find(c => c.ref === ref);
    const r0 = M.regras(dono.cx, dono.cy, base.layer);
    const hMin = isNum(a.altura_min) ? a.altura_min : r0.o.texto_h_min;
    const hMax = Math.max(hMin, isNum(a.altura_max) ? a.altura_max : Math.max(r0.o.texto_h_min, base.h || r0.o.texto_h_min));
    if (hMin < r0.o.texto_h_min - 1e-6 && !r0.desl.has('texto_tamanho'))
      avisos.push(`${ref}: altura_min ${hMin} abaixo do mínimo da casa (${r0.o.texto_h_min}); libere no projeto com regras_casa_definir {parametros:{texto_h_min}} se o dono pedir`);
    const alturas = [];
    for (let h = hMax; h >= hMin - 1e-9; h -= 0.1) alturas.push(r3(h));
    if (!alturas.length || alturas[alturas.length - 1] > hMin + 1e-9) alturas.push(r3(hMin));
    const longo = (dono.caixa.y2 - dono.caixa.y1) > (dono.caixa.x2 - dono.caixa.x1) * 1.2 ? 90 : 0;
    const rots = isNum(a.rot) ? [normRot(a.rot)] : [longo, longo ? 0 : 90];
    const fileira = modo === 'fileira' ? fileiraDe(M, dono) : null;
    const lista = [];
    for (const h of alturas) {
      const w = isNum(a.traco) ? a.traco : Math.max(r0.o.texto_w_min, r3(h * 0.15));
      for (const rot of rots) {
        const f = formaNoZero(M, cache, base, h, w, rot);
        for (const c of candidatos(dono.caixa, f, modo === 'fileira' && fileira ? 'fileira' : 'perto', fileira, dmax, passo))
          lista.push(Object.assign(c, { h, w, rot, f, custo: c.custo + (hMax - h) * 2 + (rot !== rots[0] ? 0.5 : 0) }));
      }
    }
    lista.sort((x, y) => x.custo - y.custo);
    const motivos = {};
    let achou = null, tent = 0;
    for (const c of lista) {
      if (++tent > maxTent) break;
      if (a.ambiguidade !== false) { const am = ambiguo(M, ref, dono.lado, c.X, c.Y, margem); if (am) { motivos.ambiguidade = (motivos.ambiguidade || 0) + 1; continue; } }
      const s = silkEm(M, c.f, base, c.X, c.Y, c.h, c.w, c.rot);
      const r = M.regras(c.X, c.Y, base.layer);
      const v = RC.checaSerigrafia(M.cena, s, r.o, r.desl, { parar: true, ignora, corpos: proibeCorpo ? M.corpos : null });
      if (v.length) { const k = v[0].sub || v[0].regra; motivos[k] = (motivos[k] || 0) + 1; continue; }
      achou = { c, s };
      break;
    }
    if (!achou) {
      falhas.push({ ref, motivo: 'nenhum lugar livre até ' + dmax + ' mm com altura ' + hMin + '–' + hMax + ' mm', bloqueios: motivos, tentativas: tent - 1,
                    dica: 'aumente distancia_max, baixe altura_min (se o projeto permitir), use ignorar_trilha:true ou libere uma área com regras_casa_definir' });
      ignora.delete(String(base.id));          // o texto velho fica onde esta: volta a contar para os proximos
      continue;
    }
    achou.s.id = 'novo:' + ref;
    M.cena.poe(achou.s);
    movidos.push({ ref, de: { x: base.x, y: base.y, h: base.h, w: base.w, rot: base.rot }, para: { x: achou.s.gravar.x, y: achou.s.gravar.y, h: achou.c.h, w: achou.c.w, rot: achou.c.rot },
                   lado: achou.c.lado, distancia_mm: r3(achou.c.d), fileira: fileira || undefined, violava: violando.has(ref) ? curta(violando.get(ref)) : undefined, tentativas: tent });
  }

  const out = { projeto: M.p.nome, modo, ms: Date.now() - t0, analisados: refs.length, movidos: movidos.length, sem_lugar: falhas.length,
                ja_ok: a.todos === true ? undefined : 'só os designadores que violam hoje (todos:true reposiciona todos)', posicoes: movidos, falhas,
                nao_achados: naoAchados.length ? naoAchados : undefined, avisos: avisos.length ? avisos : undefined };
  if (!movidos.length) return Object.assign(out, { gravado: false });
  const hc = ctx.pcbPronto();
  const opsTexto = movidos.map(m => Object.assign({ op: 'designator_move', ref: m.ref }, m.para, a.note ? { note: String(a.note).replace(/":/g, '" :') } : {}));
  out.gravacao = ops.transacao(ctx, M.p, (arq, board) => opsTexto.map(o => ops.aplicaTexto(arq, board, hc, o)),
    { simular: a.gravar !== true, forcar: false, ferramenta: 'serigrafia_posicionar' });
  out.gravado = !!out.gravacao.gravado;
  if (a.gravar !== true) out.nota = 'Simulação: nada gravado. Confira (pcb_render) e chame de novo com gravar:true.';
  return out;
}

const OPC_COMUNS = {
  folga_pad: { type: 'number', description: 'folga do texto para pad, via, furo e outra serigrafia, mm (padrão: o "silk" das regras da casa, 0,254)' },
  folga_trilha: { type: 'number', description: 'folga do texto para trilha/fill/região do mesmo lado, mm (padrão 0,1)' },
  ignorar_trilha: { type: 'boolean', description: 'true = texto pode passar por cima de trilha (só nesta chamada; para o projeto, regras_casa_definir)' },
};

module.exports = {
  grupo: 'serigrafia',
  ordem: 46,
  titulo: 'Serigrafia — conferir um lugar candidato e posicionar designadores pelas regras da casa, sem rodar o DRC inteiro',
  modulos: ['hub-clipper.js', 'hub-gerber.js'],
  ferramentas: [
    {
      nome: 'serigrafia_checar', titulo: 'Conferir lugar de texto', leitura: true, modulo: 'hub-clipper.js',
      descricao: 'Diz se um lugar CANDIDATO de texto de serigrafia viola alguma regra da casa (pad/via, trilha, furo, parafuso, borda, outra serigrafia, altura/traço mínimos), sem gravar e sem rodar o DRC — a mesma conta do regras_casa_verificar, com as regras do projeto e da área. Cada item: {ref (o designator dele) | id (texto existente) | text + layer (texto novo), x, y (centro, mm), h?, w?, rot?}. corpo:true também proíbe o corpo dos outros componentes ("todos" inclui o dono); ambiguidade:true acusa rótulo mais perto de outro componente do que do dono.',
      entrada: { type: 'object', properties: Object.assign({ projeto: PROJETO,
        textos: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: true } },
        corpo: { description: 'true | "todos"' }, ambiguidade: { type: 'boolean' }, margem_ambiguidade: { type: 'number' } }, OPC_COMUNS), required: ['projeto', 'textos'] },
      executa: async (a, ctx) => checar(ctx, a),
    },
    {
      nome: 'serigrafia_posicionar', titulo: 'Posicionar designadores',
      descricao: 'Acha lugar para os designadores (todos os que violam as regras da casa hoje, ou os refs dados, ou todos:true) e grava como designator_move no lugar final. Procura em volta da caixa de cada componente, do mais perto ao mais longe (até distancia_max), da maior altura (altura_max) à menor (altura_min, padrão o mínimo da casa), paralelo ao lado comprido do componente (rot fixa o giro); recusa lugar em cima de pad/via/furo/trilha/serigrafia/borda (folgas das regras da casa e do projeto), em cima do corpo de componente (sobre_corpo:true libera) e ambíguo (o rótulo mais perto de outro componente que do dono; ambiguidade:false desliga). modo "fileira": numa fileira de componentes iguais o rótulo fica alinhado ao próprio componente (em cima/embaixo numa fileira horizontal, ao lado numa vertical). Padrão SIMULA e mostra de/para; gravar:true grava. Os que não acham lugar voltam em "falhas" com o que bloqueou.',
      entrada: { type: 'object', properties: Object.assign({ projeto: PROJETO,
        refs: { type: 'array', items: { type: 'string' } }, todos: { type: 'boolean', description: 'true = reposiciona também os que já estão bons' },
        altura_min: { type: 'number' }, altura_max: { type: 'number' }, traco: { type: 'number', description: 'traço fixo (padrão: 0,15 h, no mínimo o traço mínimo da casa)' },
        rot: { type: 'number', description: '0 ou 90 (padrão: paralelo ao lado comprido; tenta o outro depois)' },
        modo: { type: 'string', enum: ['perto', 'fileira'] }, distancia_max: { type: 'number', description: 'mm a partir da caixa do componente (padrão 4)' },
        passo: { type: 'number', description: 'mm entre lugares testados (padrão 0,25)' },
        sobre_corpo: { type: 'boolean' }, ambiguidade: { type: 'boolean' }, margem_ambiguidade: { type: 'number', description: 'mm (padrão 0,2)' },
        max_tentativas: { type: 'integer', description: 'por componente (padrão 4000)' },
        gravar: { type: 'boolean' }, note: { type: 'string' } }, OPC_COMUNS), required: ['projeto'] },
      executa: async (a, ctx) => posicionar(ctx, a),
    },
  ],
  _interno: { checar, posicionar },
};
