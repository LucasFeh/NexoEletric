/* AltiumPCBMirror v2 - hub-core.js
   Logica pura compartilhada pelo hub (browser, global HubCore) e pelos testes (node).
   NAO acessa DOM. Contratos: esquema em mil (Y para cima), PCB em mm (Y para cima).
   A extracao de nets e um PREVIEW - a verdade e sempre o compilador do Altium. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HubCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
"use strict";

const TOL = 1e-3, TOL_ANG = 1e-2;  // PCB (mm)
const STOL = 0.5;                   // esquema (mil)

function near(a, b, t){ return Math.abs(a - b) <= (t || TOL); }
function nearAng(a, b){ let d = Math.abs(a - b) % 360; if (d > 180) d = 360 - d; return d <= TOL_ANG; }
function isNum(v){ return typeof v === 'number' && isFinite(v); }
function distSeg(px, py, x1, y1, x2, y2){
  const dx = x2 - x1, dy = y2 - y1, l2 = dx*dx + dy*dy;
  let t = l2 ? ((px-x1)*dx + (py-y1)*dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x1 + t*dx - px, y1 + t*dy - py);
}

/* Tamanhos NOMEADOS de folha do Altium em mil [largura, altura] — o legado, nao o ISO real.
   Isto e FALLBACK, nao a verdade: os templates da casa usam folha CUSTOM (a "A4" deles e a
   ISO de verdade, 297x210 mm = 11693x8268 mil), e uma folha custom nao tem nome nenhum a
   consultar aqui. Quem sabe a medida e o Altium — o ExportProject emite w/h junto do size, e
   sheetSize() abaixo prefere esses numeros. A tabela so responde por espelho antigo.
   A outra familia de numeros (a ISO, que e a folha de verdade) vem logo abaixo, no SHEET_ISO —
   o comentario de la explica qual das duas ganha em cada situacao. */
const SHEET_SIZES = { A4:[11500,7600], A3:[15500,11000], A2:[22000,15500], A1:[31000,22000],
                      A0:[44000,31000],
                      A:[9500,7500], B:[15000,9500], C:[20000,15000], D:[32000,20000],
                      E:[42000,32000] };

/* ── A MESMA LETRA, DUAS MEDIDAS ──
   "A3" quer dizer duas coisas diferentes conforme quem fala, e por isso ha DUAS tabelas:

   SHEET_SIZES (acima) e o LEGADO do Altium — o que o eSheetA3 dele mede, 15500x11000 mil, um
   tamanho historico em polegadas que nao e o ISO de ninguem. Ele continua sendo o FALLBACK do
   sheetSize() porque espelho antigo, sem w/h, tem de desenhar hoje exatamente como desenhava
   ontem: mexer nesses numeros moveria a folha de todo projeto ainda nao reexportado.

   SHEET_ISO e a folha ISO de verdade (A3 = 420x297 mm = 16535.433x11692.913 mil), que e o que
   os templates DESTA CASA usam. Medido nos projetos do usuario: PRJ-UR-DI261924 mede
   16535.433x11692.913 (A3 ISO) e PRJ - DI261930 mede 11692.913x8267.717 (A4 ISO) — e o espelho
   chama os dois de "A4", porque o SheetSizeName do ExportProject so sabe dizer A4/A3/A2/A1/A/B/C
   e joga todo o resto, inclusive A0, no `else Result := 'A4'`. Ou seja: o NOME no espelho e
   decorativo e mentiroso, a MEDIDA (w/h) e a verdade.

   Quem ganha: w/h sempre, em qualquer consulta (sheetSize abaixo). Escolha NOVA de formato
   grava ISO para A0..A4 (sheetPreset), porque e o que a casa usa de verdade; o legado so
   responde por espelho velho sem medida e pelos nomes que so existem nele (A/B/C/D/E).

   RETRATO nao e campo nenhum: e a mesma medida com h > w. Nem o espelho, nem esta tabela, nem
   o ExportProject carregam orientacao, e inventar um campo novo obrigaria os dois .pas (que
   nao sao testaveis desta bancada) a aprender um conceito novo. Trocar w por h atravessa o
   cano inteiro pelo caminho que ja existe — folha custom sempre chegou assim. */
const SHEET_ISO = { A0:[46811.024,33110.236], A1:[33110.236,23385.827], A2:[23385.827,16535.433],
                    A3:[16535.433,11692.913], A4:[11692.913,8267.717] };

/* A lista que o seletor da vista Esquema mostra, na ordem em que ela aparece. O `id` leva a
   familia junto (`iso:A3` x `leg:A3`) porque as duas existem e tem o MESMO nome — sem isso o
   seletor teria dois "A3" indistinguiveis. O `size` escrito no arquivo e so o nome (`A3`): e o
   nome de estilo que o BuildSchematic procura, e a familia esta nos w/h, que e onde ela cabe. */
const SHEET_PRESETS = [].concat(
  Object.keys(SHEET_ISO).map(n => ({ id:'iso:' + n, name:n, fam:'iso',    size:SHEET_ISO[n] })),
  Object.keys(SHEET_SIZES).map(n => ({ id:'leg:' + n, name:n, fam:'legado', size:SHEET_SIZES[n] })));

/* Medida de um formato, ja com a orientacao: `retrato` so troca largura por altura. Aceita o
   id com familia (`iso:A0`) ou so o nome — e neste caso o ISO ganha, pela regra acima. */
function sheetPreset(id, retrato){
  const p = SHEET_PRESETS.find(p => p.id === id)
         || SHEET_PRESETS.find(p => p.name === id && p.fam === 'iso')
         || SHEET_PRESETS.find(p => p.name === id);
  if (!p) return null;
  return retrato ? [p.size[1], p.size[0]] : [p.size[0], p.size[1]];
}

/* Tolerancia do reconhecimento, em mil. 1 mil = 0,0254 mm: folgado para o espelho que chegou
   com a medida arredondada em inteiro (11693 x 8268 e A4 ISO) e apertado demais para confundir
   dois formatos — medido aqui, o par mais proximo de toda a tabela, nas duas orientacoes, e
   A4 ISO x A4 legado, e eles estao a 668 mil (17 mm) um do outro. O teste prende isso. */
const SHEET_TOL = 1;

/* Que formato e esta folha, olhando a MEDIDA e nao o nome — e o antidoto para o "A4" que o
   export carimba em tudo. Devolve {id,name,fam,retrato} ou null (= Custom, medida que nao e de
   nenhum formato conhecido; a maioria das folhas do mundo real e assim). */
function sheetMatch(s){
  const m = sheetSize(s);
  for (const p of SHEET_PRESETS)
    for (const retrato of [false, true]){
      const t = sheetPreset(p.id, retrato);
      if (near(m[0], t[0], SHEET_TOL) && near(m[1], t[1], SHEET_TOL))
        return { id:p.id, name:p.name, fam:p.fam, retrato };
    }
  return null;
}

/* O rotulo curto da folha (cartao, titulo, ficha). Diz o que a MEDIDA e, nao o que o `size`
   afirma: "A3", "A0 em pé", "A3 legado" ou "Custom". O "legado" fica explicito porque folha
   legada quase sempre e espelho sem medida caindo na tabela — vale o usuario saber. */
function sheetLabel(s){
  const m = sheetMatch(s);
  if (!m) return 'Custom';
  return m.name + (m.retrato ? ' em pé' : '') + (m.fam === 'legado' ? ' legado' : '');
}

/* Medida da folha, com a precedencia num lugar so: w/h medidos no Altium > tabela por nome
   > A4. Sem isto cada vista repetiria a regra e uma delas ficaria para tras. */
function sheetSize(s){
  if (s && isNum(s.w) && s.w > 0 && isNum(s.h) && s.h > 0) return [s.w, s.h];
  return SHEET_SIZES[s && s.size] || SHEET_SIZES.A4;
}
const ORIENT_DIR = { 0:[1,0], 90:[0,1], 180:[-1,0], 270:[0,-1] };

/* ============ PCB: camadas (contrato da vista PCB nova, 2026-10-02) ============ */

/* Chave = a string gravada no board.js e no changes.js. As 7 que o espelho ja usava (Top,
   Bottom, TopOverlay, BottomOverlay, Multi, Mech1, KeepOut) nao mudam de nome; o resto
   completa a pilha do Altium. A ORDEM da tabela e a das abas de camada do Altium: sinais
   (Top, Mid..., Bottom), planos, mecanicas, TopOverlay, BottomOverlay, TopPaste, BottomPaste,
   TopSolder, BottomSolder, DrillGuide, KeepOut, DrillDrawing, Multi. `altium` e o numero do
   TLayer (o mesmo do binario do .PcbDoc) e `pair` e o par no flip do componente.

   Cores: as MEDIDAS nos 1.013 Gerbers da casa (o comentario G04 Layer_Color que o Altium
   escreve; contrato secao 1b, que vale mais que a tabela antiga do pcbframe -- Bottom,
   BottomOverlay e KeepOut passaram para as do Altium). Mech1, Mech13, KeepOut e BottomSolder
   tem a MESMA cor (#ff00ff) porque e assim no Altium. O que a medida nao cobre tem paleta
   propria, documentada aqui porque e escolha nossa:
   - Mid3..30: matiz andando pelo angulo aureo (137,508 graus) a partir de 30, saturacao 90%,
     luz alternando 60/48% -- distintas entre si e das duas medidas (Mid1, Mid2);
   - Plane N: o mesmo passo a partir de 150, saturacao 55%, luz 38% -- mais escuras, como
     plano costuma aparecer;
   - as mecanicas sem medida: MECH_CORES, lista fixa escolhida a mao.
   O board.js novo pode trazer a cor da placa em `layers[].color`; boardLayers() prefere a dele. */
const MECH_CORES = ['#00ffff', '#ff8000', '#80ff00', '#00ff80', '#0080ff', '#8000ff', '#ff0080',
                    '#00c0c0', '#c08000', '#80c000', '#00c060', '#4060ff', '#c060ff', '#ff6060', '#60ffc0'];
const COR_MEDIDA = { Mid1:'#bc8e00', Mid2:'#70dbfa', Mech1:'#ff00ff', Mech13:'#ff00ff', Mech15:'#008000' };
function hslHex(h, s, l){
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  const x = v => ('0' + Math.round(v * 255).toString(16)).slice(-2);
  return '#' + x(f(0)) + x(f(8)) + x(f(4));
}
const PCB_LAYERS = (function(){
  const L = [];
  const add = (key, name, kind, side, pair, altium, color) =>
    L.push(Object.freeze({ key, name, kind, side, pair, altium, color, order:L.length }));
  add('Top', 'Top Layer', 'signal', 'top', 'Bottom', 1, '#ff0000');
  for (let i = 1; i <= 30; i++)
    add('Mid' + i, 'Mid-Layer ' + i, 'signal', null, null, 1 + i,
        COR_MEDIDA['Mid' + i] || hslHex((30 + (i - 1) * 137.508) % 360, 90, i % 2 ? 60 : 48));
  add('Bottom', 'Bottom Layer', 'signal', 'bottom', 'Top', 32, '#0000ff');
  for (let i = 1; i <= 16; i++)
    add('Plane' + i, 'Internal Plane ' + i, 'plane', null, null, 38 + i,
        hslHex((150 + (i - 1) * 137.508) % 360, 55, 38));
  for (let i = 1; i <= 16; i++)
    add('Mech' + i, 'Mechanical ' + i, 'mech', null, null, 56 + i, COR_MEDIDA['Mech' + i] || MECH_CORES[i - 2]);
  add('TopOverlay',    'Top Overlay',    'overlay', 'top',    'BottomOverlay', 33, '#ffff00');
  add('BottomOverlay', 'Bottom Overlay', 'overlay', 'bottom', 'TopOverlay',    34, '#808000');
  add('TopPaste',      'Top Paste',      'paste',   'top',    'BottomPaste',   35, '#808080');
  add('BottomPaste',   'Bottom Paste',   'paste',   'bottom', 'TopPaste',      36, '#800000');
  add('TopSolder',     'Top Solder',     'solder',  'top',    'BottomSolder',  37, '#800080');
  add('BottomSolder',  'Bottom Solder',  'solder',  'bottom', 'TopSolder',     38, '#ff00ff');
  add('DrillGuide',    'Drill Guide',    'drill',   null,     null,            55, '#800000');
  add('KeepOut',       'Keep-Out Layer', 'keepout', null,     null,            56, '#ff00ff');
  add('DrillDrawing',  'Drill Drawing',  'drill',   null,     null,            73, '#ff002a');
  add('Multi',         'Multi-Layer',    'multi',   null,     null,            74, '#c0c0c0');
  return Object.freeze(L);
})();
const LAYER_BY_KEY = Object.create(null);
for (const r of PCB_LAYERS) LAYER_BY_KEY[r.key] = r;

/* a linha da tabela, ou null se a chave nao existe (a tabela e congelada: nao mexa nela) */
function pcbLayer(key){ return (typeof key === 'string' && LAYER_BY_KEY[key]) || null; }
/* cobre = sinal ou plano; Multi NAO conta (pad/via passante e outra conversa) */
function isCopper(key){ const r = pcbLayer(key); return !!r && (r.kind === 'signal' || r.kind === 'plane'); }

/* Pares de camada mecanica DA PLACA (Top/Bottom 3D Body, Courtyard, Assembly...): o Altium
   deixa o projeto parear mecanicas, e o componente virado leva o desenho de uma para a outra.
   Vem de board.layers[].pair -- opcional (o ExportBoard de hoje ainda nao escreve) e so entre
   mecanicas, nos dois sentidos; o primeiro par que cita uma camada ganha. Os pares fixos
   (Top/Bottom, overlay, paste, solder) sao os da tabela, e a placa nao os muda. */
function mechPairs(board){
  const out = Object.create(null);
  const mec = k => typeof k === 'string' && /^Mech\d+$/.test(k);
  for (const l of ((board && Array.isArray(board.layers)) ? board.layers : [])){
    if (!l || !mec(l.key) || !mec(l.pair) || l.key === l.pair || l.key in out || l.pair in out) continue;
    out[l.key] = l.pair; out[l.pair] = l.key;
  }
  return out;
}
function flipIn(pares, key){ return (pares && typeof key === 'string' && key in pares) ? pares[key] : flipLayer(key); }
/* o par no flip do componente (Top<->Bottom, overlay, paste, solder); sem par = a propria
   chave. `board` (opcional) acrescenta os pares mecanicos daquela placa (mechPairs). */
function flipLayer(key, board){
  if (board && typeof board === 'object' && Array.isArray(board.layers)) {
    const p = mechPairs(board);
    if (typeof key === 'string' && key in p) return p[key];
  }
  const r = pcbLayer(key); return (r && r.pair) || key;
}

/* A lista de camadas que a tela mostra para ESTA placa. Cada linha e uma copia da tabela com
   nome/cor do board.layers por cima (quando o espelho novo traz), `inBoard` (a camada esta em
   board.layers), `stack` (a ordem fisica do cobre, layers[].stack; null sem ela), `pair` (o da
   tabela, ou o par mecanico que a placa declarou) e `used`/`count` (quantos objetos ha nela).
   Contagem: tracks, arcs, silk, lines, fills, regions e texts pela propria camada; pad SMD na
   camada dele e pad passante na Multi; via na Multi. Recorte (cutouts) nao conta: e buraco na
   placa, nao objeto de camada. Mid/Plane/Mech so entram se estao no board.layers ou tem
   objeto -- uma placa de 2 camadas nao mostra 30 mids vazias. Chave desconhecida (no
   board.layers ou num objeto) entra no fim, com kind 'mech' (MechN alem da 16) ou 'other',
   para nada usado ficar escondido. Passe effectiveBoard(B, model) em vez do board cru para
   contar o que as mudancas criaram. */
function boardLayers(board){
  const B = board || {};
  const cnt = Object.create(null), vistos = [];
  const conta = k => { if (typeof k !== 'string' || !k) return; if (!(k in cnt)) { cnt[k] = 0; vistos.push(k); } cnt[k]++; };
  for (const arr of [B.tracks, B.arcs, B.silk, B.lines, B.fills, B.regions, B.texts])
    for (const o of (Array.isArray(arr) ? arr : [])) if (o) conta(o.layer);
  const pad = p => { if (p) conta(p.type === 'th' ? 'Multi' : p.layer); };
  for (const c of (B.components || [])) for (const p of ((c && c.pads) || [])) pad(p);
  for (const p of (B.freepads || [])) pad(p);
  for (const v of (B.vias || [])) if (v) conta('Multi');
  const doBoard = Object.create(null), ordemBoard = [];
  for (const l of (Array.isArray(B.layers) ? B.layers : []))
    if (l && typeof l.key === 'string' && l.key && !(l.key in doBoard)) { doBoard[l.key] = l; ordemBoard.push(l.key); }
  const pares = mechPairs(B);
  const corOk = c => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
  const linha = (r, key, order) => {
    const b = doBoard[key];
    return { key, name: (b && typeof b.name === 'string' && b.name) ? b.name : r.name,
             kind: r.kind, side: r.side, pair: (key in pares) ? pares[key] : r.pair, altium: r.altium,
             color: (b && corOk(b.color)) ? b.color : r.color, order,
             stack: (b && isNum(b.stack)) ? b.stack : null,
             used: (cnt[key] || 0) > 0, count: cnt[key] || 0, inBoard: !!b };
  };
  const out = [];
  for (const r of PCB_LAYERS){
    const opcional = r.kind === 'plane' || r.kind === 'mech' || /^Mid\d+$/.test(r.key);
    if (opcional && !(r.key in doBoard) && !cnt[r.key]) continue;
    out.push(linha(r, r.key, r.order));
  }
  let extra = PCB_LAYERS.length;
  for (const key of ordemBoard.concat(vistos)){
    if (LAYER_BY_KEY[key] || out.some(l => l.key === key)) continue;
    const r = { name:key, kind: /^Mech\d+$/.test(key) ? 'mech' : 'other', side:null, pair:null, altium:null, color:'#888888' };
    out.push(linha(r, key, extra++));
  }
  return out;
}

/* ============ PCB: board + changes -> modelo efetivo (port do viewer v1) ============ */

const temProp = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
/* [[x,y],...] com pelo menos `n` vertices numericos (region_add aqui e no serializeChanges) */
function ptsValid(pts, n){
  return Array.isArray(pts) && pts.length >= n && pts.every(p => Array.isArray(p) && isNum(p[0]) && isNum(p[1]));
}
/* copia de um objeto do board.js para o eff: rasa, mas o que e aninhado (points, holes, polys,
   pads) vira copia tambem -- o eff nunca divide array com o board */
function copiaEff(o){
  const e = { ...o };
  for (const k in e) if (e[k] && typeof e[k] === 'object') e[k] = dcopy(e[k]);
  return e;
}
/* poligono que region_add aceita: sem vertice repetido em seguida (inclusive o ultimo igual ao
   primeiro, que e o fechamento escrito a mao), >= 3 vertices, area e nenhum lado cortando
   outro que nao seja vizinho -- o Altium e o Gerber nao aceitam regiao auto-intersectante. */
function regiaoErro(pts){
  const mesmo = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  const q = [];
  for (const p of pts) if (!q.length || !mesmo(q[q.length - 1], p)) q.push(p);
  while (q.length > 1 && mesmo(q[0], q[q.length - 1])) q.pop();
  if (q.length < 3) return 'região sem área (vértices alinhados ou repetidos)';
  const n = q.length;
  const lado = (a, b, c) => { const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); return Math.abs(v) < 1e-12 ? 0 : (v > 0 ? 1 : -1); };
  const sobre = (a, b, c) => Math.min(a[0], b[0]) - 1e-9 <= c[0] && c[0] <= Math.max(a[0], b[0]) + 1e-9 &&
                             Math.min(a[1], b[1]) - 1e-9 <= c[1] && c[1] <= Math.max(a[1], b[1]) + 1e-9;
  const corta = (p1, p2, p3, p4) => {
    const o1 = lado(p1, p2, p3), o2 = lado(p1, p2, p4), o3 = lado(p3, p4, p1), o4 = lado(p3, p4, p2);
    if (o1 !== o2 && o3 !== o4) return true;
    return (o1 === 0 && sobre(p1, p2, p3)) || (o2 === 0 && sobre(p1, p2, p4)) ||
           (o3 === 0 && sobre(p3, p4, p1)) || (o4 === 0 && sobre(p3, p4, p2));
  };
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;                 /* o ultimo lado e vizinho do primeiro */
      if (corta(q[i], q[(i + 1) % n], q[j], q[(j + 1) % n])) return 'região com lados que se cruzam (o Altium e o Gerber não aceitam)';
    }
  let s = 0;
  for (let i = 0; i < n; i++) { const a = q[i], b = q[(i + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s) < 1e-9 ? 'região sem área (vértices alinhados ou repetidos)' : '';
}
/* espelho NOVO: o ExportBoard de 2026-10 (ou o leitor de .PcbDoc) carimba `exporter`, e so ele
   marca poly/owner/keepout nas regions. No espelho antigo uma region pode ser cobre livre,
   pedaco de poligono despejado ou primitiva de footprint (pad customizado, termico) -- medido:
   1982 das 3065 regions dos 17 espelhos de hoje caem inteiras dentro de um componente, nenhuma
   com owner -- e nao ha como saber qual e qual. */
function espelhoNovo(B){ return !!B && typeof B.exporter === 'string' && B.exporter !== ''; }

/* ══════════ placa nova e ECO (2026-10-13): footprint, net, contorno com arco ══════════

   O comp_add (o "Design » Update PCB Document" do Altium) poe na placa um componente que ela nao
   tinha. O changes.js e uma linha plana por objeto -- nao cabe o footprint dentro --, entao o
   motor busca a geometria, nesta ordem:
     1. opts.pcblib do applyPcbChanges, ou a lib registrada com setPcbLib (o Libs/pcblib.js),
        pela cascata de nomes do resolveFp (substituicao, exato, rename-map, chave);
     2. board.footprints[] -- a biblioteca EMBUTIDA da placa (o PcbDoc do Altium guarda a dele;
        a placa mestra do hub tambem: o HubPcbNova.consolida grava ali os que usou);
     3. um componente da propria placa com o MESMO footprint: a geometria local sai dele pela
        conta inversa do compDelta (e o que o Altium faz quando o footprint ja esta no PcbDoc).
   Nenhum dos tres: a op e recusada dizendo isso -- footprint que falta e erro de validacao, nao
   crash, e o componente nao entra sem pad nenhum. */
let PCBLIB = null;
function setPcbLib(lib){ PCBLIB = (lib && Array.isArray(lib.footprints)) ? lib : null; }
const pcbLibAtual = () => PCBLIB;

/* geometria LOCAL (o formato do pcblib.js: pads/silk/bbox em mm em torno da origem, rot 0, Top)
   de um componente ja colocado: a volta do compDelta (O, r, lado) -> (0, 0, 0, Top) */
function fpDoComponente(c, board){
  if (!c || !isNum(c.x) || !isNum(c.y)) return null;
  const m = { src:{ x:c.x, y:c.y, rot:isNum(c.rot) ? c.rot : 0, layer:c.layer === 'Bottom' ? 'Bottom' : 'Top' },
              eff:{ x:0, y:0, rot:0, layer:'Top' } };
  m.pares = mechPairs(board);
  const d = compDelta(m);
  const limpa = o => { delete o.id; delete o.net; delete o.owner; return o; };
  const pads = (Array.isArray(c.pads) ? c.pads : []).filter(Boolean).map(p => limpa(xfPad(d, p)));
  const silk = [];
  for (const s of ((board && board.silk) || [])) {
    if (!s || s.owner !== c.ref || (s.kind !== 'line' && s.kind !== 'arc')) continue;
    const o = dcopy(s); xfLineObj(d, o, s.kind === 'arc');
    if (o.layer !== 'TopOverlay') continue;           /* so a serigrafia do lado do componente */
    limpa(o); delete o.layer; silk.push(o);
  }
  const b = c.bbox;
  const bbox = (b && [b.x1, b.y1, b.x2, b.y2].every(isNum)) ? xfBox(d, b) : null;
  return { name:c.footprint || '', description:'', bbox, pads, silk };
}
/* a geometria do footprint `nome` para esta placa: {fp, fonte} ou null (ver o cabecalho acima) */
function footprintGeom(nome, board, opts){
  const nm = typeof nome === 'string' ? nome : '';
  if (!nm) return null;
  const lib = (opts && opts.pcblib) || PCBLIB;
  if (lib) { const r = resolveFp(lib, nm); if (r && r.item) return { fp:r.item, fonte:'pcblib' + (r.how && r.how !== 'exato' ? ' (' + r.how + ': ' + r.name + ')' : '') }; }
  const emb = board && Array.isArray(board.footprints) ? board.footprints : null;
  if (emb && emb.length) { const r = resolveLib(emb, nm, 'fp'); if (r && r.item) return { fp:r.item, fonte:'board.footprints' }; }
  for (const c of ((board && board.components) || []))
    if (c && c.footprint === nm && Array.isArray(c.pads) && c.pads.length) {
      const fp = fpDoComponente(c, board);
      if (fp) return { fp, fonte:'placa (' + c.ref + ')' };
    }
  return null;
}
/* "1=GND;2=VCC;3=" -> {"1":"GND","2":"VCC","3":""}; null = mal formado. Campo PLANO de
   proposito: o parser do ApplyChanges le linha a linha e nao aguenta objeto aninhado. */
function parseNetsCampo(s){
  if (s === undefined || s === null || s === '') return {};
  if (typeof s !== 'string') return null;
  const out = {};
  for (const par of s.split(';')) {
    if (!par) continue;
    const i = par.indexOf('=');
    if (i <= 0) return null;
    out[par.slice(0, i)] = par.slice(i + 1);
  }
  return out;
}
function netsCampo(map){
  return Object.keys(map || {}).map(k => k + '=' + map[k]).join(';');
}

/* Contorno com arco: cada vertice do `pts` do outline_set e [x,y] (reta ate o proximo) ou
   [x,y,b], com b = BULGE, a convencao do DXF: tan(angulo varrido / 4), positivo = anti-horario
   do vertice para o proximo, negativo = horario, 0 = reta. Um campo a mais por vertice, sem
   aninhamento -- o ParsePts do ApplyChanges continua lendo a linha. Canto arredondado de 90 graus
   = b de +-0,414214 (tan 22,5); meia-volta = +-1. */
const BULGE_MAX = 1e3;
function bulgeArco(x1, y1, x2, y2, b){
  const c = Math.hypot(x2 - x1, y2 - y1);
  if (!(c > 1e-9) || !isNum(b) || Math.abs(b) < 1e-12) return null;
  const th = 4 * Math.atan(b);                         /* varredura com sinal */
  const r = c / (2 * Math.sin(Math.abs(th) / 2));
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const ux = (x2 - x1) / c, uy = (y2 - y1) / c;         /* direcao da corda */
  const s = (c / 2) * (1 - b * b) / (2 * b);            /* distancia (com sinal) do centro a corda, a esquerda */
  const cx = mx - uy * s, cy = my + ux * s;
  const ang = (x, y) => normAng(Math.atan2(y - cy, x - cx) * 180 / Math.PI);
  const a1 = ang(x1, y1), a2 = ang(x2, y2);
  /* o segmento do board.js e sempre anti-horario de sa para ea */
  return b > 0 ? { kind:'arc', cx:r6(cx), cy:r6(cy), r:r6(r), sa:a1, ea:a2 }
               : { kind:'arc', cx:r6(cx), cy:r6(cy), r:r6(r), sa:a2, ea:a1 };
}
/* pts (com bulge) -> segmentos do board.js » board.outline; null = pts invalido */
function ptsToOutline(pts){
  if (!Array.isArray(pts) || pts.length < 2) return null;
  for (const p of pts)
    if (!Array.isArray(p) || !isNum(p[0]) || !isNum(p[1]) || (p.length > 2 && p[2] !== undefined && p[2] !== null && !isNum(p[2]))) return null;
  const segs = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], bg = isNum(a[2]) ? a[2] : 0;
    const arco = bg ? bulgeArco(a[0], a[1], b[0], b[1], bg) : null;
    segs.push(arco || { kind:'line', x1:a[0], y1:a[1], x2:b[0], y2:b[1] });
  }
  return segs;
}
/* a volta: segmentos do board.outline (retas e arcos, como o ExportBoard os escreve, em ordem)
   -> pts com bulge, para editar no hub o contorno que veio do Altium. O arco do board.js nao diz
   o sentido em que o contorno o percorre: decide a continuidade com o vizinho. null = os
   segmentos nao fecham uma volta. */
function outlineToPts(segs){
  const S = (Array.isArray(segs) ? segs : []).filter(s => s && (s.kind === 'line' || s.kind === 'arc'));
  if (S.length < 2) return null;
  const T = 1e-3;
  const pontas = s => {
    if (s.kind === 'line') return [[s.x1, s.y1], [s.x2, s.y2]];
    const p = g => [s.cx + s.r * Math.cos(g * Math.PI / 180), s.cy + s.r * Math.sin(g * Math.PI / 180)];
    return [p(s.sa), p(s.ea)];
  };
  const igual = (a, b) => Math.abs(a[0] - b[0]) <= T && Math.abs(a[1] - b[1]) <= T;
  const P = S.map(pontas);
  /* sentido do primeiro: o que termina onde o segundo comeca (em qualquer sentido) */
  const dir = new Array(S.length).fill(1);
  if (!(igual(P[0][1], P[1][0]) || igual(P[0][1], P[1][1]))) dir[0] = -1;
  const fim = i => dir[i] > 0 ? P[i][1] : P[i][0];
  const ini = i => dir[i] > 0 ? P[i][0] : P[i][1];
  for (let i = 1; i < S.length; i++) {
    if (igual(P[i][0], fim(i - 1))) dir[i] = 1;
    else if (igual(P[i][1], fim(i - 1))) dir[i] = -1;
    else return null;
  }
  if (!igual(fim(S.length - 1), ini(0))) return null;
  return S.map((s, i) => {
    const p = ini(i), v = [r6(p[0]), r6(p[1])];
    if (s.kind === 'arc') {
      let sw = (((s.ea - s.sa) % 360) + 360) % 360;
      if (sw === 0) sw = 360;
      const b = Math.tan(sw * Math.PI / 180 / 4) * dir[i];
      v.push(Math.round(b * 1e9) / 1e9);
    }
    return v;
  });
}

/* Designator de componente novo: 1 mm de altura (a moda do acervo: 426 dos 711 designators dos 16
   board.js do workspace), traco 0,15, centrado em cima da caixa do componente, como o
   AutoPosition do Altium deixa; no Bottom, espelhado na BottomOverlay. O comment nao ganha texto:
   nos 16 espelhos nao ha UM comment visivel (o padrao da casa e o Comment desligado). */
const DESIG_H = 1, DESIG_W = 0.15, DESIG_FOLGA = 0.3;
/* O componente que o comp_add poe na placa, no formato do board.js: o footprint (local) pela
   MESMA conta do comp_move (compDelta da origem, rot 0, Top, para o lugar pedido), pads com id
   e net, a serigrafia (TopOverlay no footprint, virada no Bottom) e o designator. Pad passante
   do pcblib nao diz se e metalizado: cobre maior que o furo = metalizado (PTH); cobre do tamanho
   do furo = NPTH, o furo de fixacao feito como pad. */
function sintetizaComp(fp, a, cid){
  const d = compDelta({ src:{ x:0, y:0, rot:0, layer:'Top' }, eff:{ x:a.x, y:a.y, rot:a.rot, layer:a.layer } });
  const nets = a.nets || {};
  const pads = (fp.pads || []).filter(Boolean).map((p, i) => {
    const q = xfPad(d, p);
    const o = { id:cid + 'p' + (i + 1) };
    for (const k in q) if (k !== 'id' && k !== 'net') o[k] = q[k];
    if (o.type === 'th' && o.plated === undefined && isNum(o.drill))
      o.plated = !(isNum(o.w) && isNum(o.h) && o.w <= o.drill + 1e-6 && o.h <= o.drill + 1e-6);
    o.net = temProp(nets, String(p.name)) ? nets[String(p.name)] : '';
    return o;
  });
  let bbox = null;
  const b = fp.bbox;
  if (b && [b.x1, b.y1, b.x2, b.y2].every(isNum)) bbox = xfBox(d, b);
  else if (pads.length) {
    const xs = [], ys = [];
    for (const p of pads) { const r = Math.max(p.w || 0, p.h || 0) / 2; xs.push(p.x - r, p.x + r); ys.push(p.y - r, p.y + r); }
    bbox = { x1:r6(Math.min(...xs)), y1:r6(Math.min(...ys)), x2:r6(Math.max(...xs)), y2:r6(Math.max(...ys)) };
  }
  const comp = { id:cid, ref:a.ref, footprint:a.footprint, comment:a.comment || '', layer:a.layer, x:a.x, y:a.y, rot:a.rot };
  if (bbox) comp.bbox = bbox;
  comp.pads = pads;
  const silk = [];
  (fp.silk || []).forEach((s, i) => {
    if (!s || (s.kind !== 'line' && s.kind !== 'arc')) return;
    const o = dcopy(s); o.layer = 'TopOverlay';
    xfLineObj(d, o, s.kind === 'arc');
    const obj = { id:cid + 's' + (i + 1), layer:o.layer, kind:s.kind };
    if (s.kind === 'arc') Object.assign(obj, { cx:o.cx, cy:o.cy, r:o.r, sa:o.sa, ea:o.ea });
    else Object.assign(obj, { x1:o.x1, y1:o.y1, x2:o.x2, y2:o.y2 });
    obj.w = o.w; obj.owner = a.ref;
    silk.push(obj);
  });
  const bx = bbox || { x1:a.x, y1:a.y, x2:a.x, y2:a.y };
  /* o designator: acima do corpo, ou onde o comp_add pede (des_x/des_y = centro do texto, na placa;
     des_h/des_w/des_rot = altura, traço e giro -- o DoCompAdd do ApplyChanges poe la tambem) */
  const des = a.des || {};
  const h = isNum(des.h) ? des.h : DESIG_H;
  const texts = [{ id:cid + 'x', layer:a.layer === 'Bottom' ? 'BottomOverlay' : 'TopOverlay',
                   x:r6(isNum(des.x) ? des.x : (bx.x1 + bx.x2) / 2), y:r6(isNum(des.y) ? des.y : bx.y2 + DESIG_FOLGA + h / 2),
                   text:a.ref, h, rot:isNum(des.rot) ? normAng(des.rot) : 0,
                   mirror:a.layer === 'Bottom', designator:true, comment:false, owner:a.ref, w:isNum(des.w) ? des.w : DESIG_W, kind:'stroke' }];
  return { comp, silk, texts };
}

/* Pad solto (pad_add / pad_edit): valida a op e devolve os campos do pad no formato do
   board.js » freepads. `base` = o pad atual (edit) ou null (add). type da op: smd | th | npth;
   no board.js o NPTH e type 'th' com plated:false (como o ExportBoard le o Pad.Plated). */
const PAD_FORMAS = ['circle', 'rect', 'oval', 'roundrect', 'octagon'];
const FURO_FORMAS = ['circle', 'rect', 'oblong'];
function padDaOp(ch, base){
  const avisos = [], erro = m => ({ erro:m, avisos });
  const num = ['x', 'y', 'w', 'h', 'rot', 'drill', 'drillw', 'holerot', 'radius'];
  const ruim = num.find(k => ch[k] !== undefined && !isNum(ch[k]));
  if (ruim) return erro(`campo "${ruim}" inválido`);
  if (!base) for (const k of ['x', 'y', 'w', 'h']) if (!isNum(ch[k])) return erro(`campo "${k}" ausente/inválido`);
  const tipoBase = base ? (base.type === 'smd' ? 'smd' : (base.plated === false ? 'npth' : 'th')) : null;
  const tipo = ch.type !== undefined ? ch.type : tipoBase;
  if (!['smd', 'th', 'npth'].includes(tipo)) return erro('type deve ser smd, th ou npth');
  if (base && tipo !== tipoBase) return erro(`troca de tipo (${tipoBase} -> ${tipo}) não é edição: pad_del + pad_add`);
  const v = k => ch[k] !== undefined ? ch[k] : (base ? base[k] : undefined);
  const shape = v('shape') !== undefined ? v('shape') : 'circle';
  if (!PAD_FORMAS.includes(shape)) return erro(`shape "${shape}" inválida (${PAD_FORMAS.join(', ')})`);
  const w = v('w'), h = v('h');
  if (!(w > 0) || !(h > 0)) return erro('w e h devem ser > 0');
  const p = {};
  if (typeof ch.name === 'string' || !base) p.name = typeof ch.name === 'string' ? ch.name : '';
  if (tipo === 'smd') {
    const L = ch.layer !== undefined && ch.layer !== '' ? ch.layer : (base ? base.layer : 'Top');
    if (L !== 'Top' && L !== 'Bottom') return erro('pad SMD fica no Top ou no Bottom');
    p.layer = L;
  } else {
    if (ch.layer !== undefined && ch.layer !== '' && ch.layer !== 'Multi') avisos.push(`pad passante fica na Multi-Layer — layer "${ch.layer}" ignorada`);
    p.layer = 'Multi';
  }
  if (!base) p.type = tipo === 'smd' ? 'smd' : 'th';
  for (const k of ['x', 'y', 'w', 'h']) if (isNum(ch[k])) p[k] = ch[k];
  p.shape = shape;
  if (isNum(ch.rot) || !base) p.rot = isNum(ch.rot) ? normAng(ch.rot) : 0;
  if (shape === 'roundrect') {
    const r = v('radius');
    if (r !== undefined && !(r >= 0)) return erro('radius deve ser >= 0');
    if (isNum(r)) p.radius = r;
  }
  if (tipo !== 'smd') {
    const drill = v('drill');
    if (!(drill > 0)) return erro('drill (diâmetro do furo) obrigatório e > 0');
    const ds = v('drillshape') !== undefined ? v('drillshape') : 'circle';
    if (!FURO_FORMAS.includes(ds)) return erro(`drillshape "${ds}" inválida (${FURO_FORMAS.join(', ')})`);
    p.drillshape = ds; p.drill = drill;
    if (ds !== 'circle') {
      const dw = v('drillw');
      if (!(dw > 0)) return erro('furo rect/oblong precisa de drillw > 0 (o comprimento, ao longo do X do pad)');
      p.drillw = dw;
    }
    if (isNum(ch.holerot) || !base) p.holerot = isNum(ch.holerot) ? normAng(ch.holerot) : 0;
    if (!base) p.plated = tipo === 'th';
    if (tipo === 'th' && drill >= Math.min(w, h) - 1e-9) avisos.push('furo >= cobre do pad: anel nulo (o DRC do Altium acusa)');
  }
  if (typeof ch.net === 'string') {
    if (tipo === 'npth') { if (ch.net) avisos.push(`furo NPTH não tem net — "${ch.net}" ignorada`); p.net = ''; }
    else p.net = ch.net;
  } else if (!base) p.net = '';
  return { pad:p, avisos };
}

/* Polygon Pour: a DEFINICAO (o despejo e do hub-pcbpour / do Altium), no formato de
   board.js » polygons:
     {id:'pg…', nome, layer, net, pts:[[x,y]...], pour:'solid'|'hatch'|'none', removeDead, minArea,
      ordem, conexao:{tipo:'relief'|'direct', condutores, largura, gap, angulo}, clearance,
      hatch?:{grade, largura}}
   O id comeca com 'pg' (e nao so 'p') porque 'p…' ja e o id dos pads soltos do board.js.
   A op e plana (o parser do ApplyChanges le linha a linha): conexao e hatch viajam como
   con_tipo, con_condutores, con_largura, con_gap, con_angulo, hatch_grade, hatch_largura.
   Padroes = os do Altium para polygon novo: solido, Remove Dead Copper ligado, ilhas abaixo de
   2500 mil² fora (1,6129 mm²), conexao de 4 condutores a 90 graus, 10 mil de condutor e 10 mil
   de gap -- DIRECT, a regra Polygon Connect do template da casa (o de fabrica do Altium e
   Relief; medido pelo hub-pcbregras); clearance = o da placa (rules.clearance) ou 10 mil.
   Campos do motor de despejo (hub-pcbpour) que atravessam como vieram, se a op os trouxer:
   pourOver ('all'|'polygons'|'none'), removeNecks (bool), neck, arco e clearanceBorda (mm). */
const POUR = ['solid', 'hatch', 'none'];
function montaPoly(ch, base, ctx){
  const avisos = [], erro = m => ({ erro:m, avisos });
  const numK = ['minArea', 'ordem', 'clearance', 'con_condutores', 'con_largura', 'con_gap', 'con_angulo', 'hatch_grade', 'hatch_largura', 'neck', 'arco', 'clearanceBorda'];
  const ruim = numK.find(k => ch[k] !== undefined && !isNum(ch[k]));
  if (ruim) return erro(`campo "${ruim}" inválido`);
  const p = base ? dcopy(base) : { nome:'', layer:'', net:'', pts:[], pour:'solid', removeDead:true, minArea:1.6129,
                                   ordem:ctx.ordem, conexao:{ tipo:'direct', condutores:4, largura:0.254, gap:0.254, angulo:90 },
                                   clearance:ctx.clearance };
  if (ch.layer !== undefined && ch.layer !== '' || !base) {
    const L = pcbLayer(ch.layer);
    if (!L) return erro(typeof ch.layer === 'string' && ch.layer ? `layer "${ch.layer}" não existe` : 'falta layer');
    if (!isCopper(ch.layer)) return erro('polygon pour só em camada de cobre (Top, Bottom, Mid…, Plane…)');
    p.layer = ch.layer;
  }
  if (ch.pts !== undefined || !base) {
    if (!ptsValid(ch.pts, 3)) return erro('pts deve ser [[x,y],...] com >= 3 vértices');
    const ge = regiaoErro(ch.pts); if (ge) return erro(ge.replace('região', 'polígono'));
    p.pts = ch.pts.map(q => [q[0], q[1]]);
  }
  if (typeof ch.net === 'string') p.net = ch.net;
  if (typeof ch.nome === 'string') p.nome = ch.nome;
  if (ch.pour !== undefined) { if (!POUR.includes(ch.pour)) return erro(`pour deve ser ${POUR.join(', ')}`); p.pour = ch.pour; }
  if (ch.removeDead !== undefined) { if (typeof ch.removeDead !== 'boolean') return erro('removeDead deve ser true/false'); p.removeDead = ch.removeDead; }
  if (isNum(ch.minArea)) { if (ch.minArea < 0) return erro('minArea deve ser >= 0'); p.minArea = ch.minArea; }
  if (isNum(ch.ordem)) { if (ch.ordem < 0 || ch.ordem !== Math.floor(ch.ordem)) return erro('ordem deve ser inteiro >= 0'); p.ordem = ch.ordem; }
  if (isNum(ch.clearance)) { if (ch.clearance < 0) return erro('clearance deve ser >= 0'); p.clearance = ch.clearance; }
  const c = p.conexao = Object.assign({ tipo:'direct', condutores:4, largura:0.254, gap:0.254, angulo:90 }, p.conexao || {});
  if (ch.pourOver !== undefined) { if (!['all', 'polygons', 'none'].includes(ch.pourOver)) return erro('pourOver deve ser all, polygons ou none'); p.pourOver = ch.pourOver; }
  if (ch.removeNecks !== undefined) { if (typeof ch.removeNecks !== 'boolean') return erro('removeNecks deve ser true/false'); p.removeNecks = ch.removeNecks; }
  for (const k of ['neck', 'arco', 'clearanceBorda']) if (ch[k] !== undefined) {
    if (!isNum(ch[k]) || ch[k] < 0) return erro(`${k} deve ser número >= 0`);
    p[k] = ch[k];
  }
  /* conexao como objeto (o formato do hub-pcbpour.js: {tipo, condutores, largura, gap, angulo}); os
     con_* abaixo continuam valendo e mandam se vierem juntos */
  if (ch.conexao !== undefined) {
    const o = ch.conexao;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return erro('conexao deve ser {tipo, condutores, largura, gap, angulo}');
    if (o.tipo !== undefined) { if (!['relief', 'direct', 'none'].includes(o.tipo)) return erro('conexao.tipo deve ser relief, direct ou none'); c.tipo = o.tipo; }
    if (o.condutores !== undefined) { if (o.condutores !== 2 && o.condutores !== 4) return erro('conexao.condutores deve ser 2 ou 4'); c.condutores = o.condutores; }
    if (o.largura !== undefined) { if (!(isNum(o.largura) && o.largura > 0)) return erro('conexao.largura deve ser > 0'); c.largura = o.largura; }
    if (o.gap !== undefined) { if (!(isNum(o.gap) && o.gap > 0)) return erro('conexao.gap deve ser > 0'); c.gap = o.gap; }
    if (o.angulo !== undefined) { if (o.angulo !== 45 && o.angulo !== 90) return erro('conexao.angulo deve ser 45 ou 90'); c.angulo = o.angulo; }
  }
  /* folga por tipo de objeto e por net (a matriz OBJECTCLEARANCES e a regra por net do Altium) --
     ex.: {th:1, smd:1} afasta o plano dos pads sem mexer na folga das trilhas. null tira. */
  const TIPOS_FOLGA = ['track', 'arc', 'smd', 'th', 'via', 'fill', 'region', 'text', 'poly'];
  const folgas = (o, nome, chaves) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return `${nome} deve ser um objeto {tipo: mm}`;
    for (const [k, v] of Object.entries(o)) {
      if (chaves && !chaves.includes(k)) return `${nome}: tipo "${k}" desconhecido (${chaves.join(', ')})`;
      if (!isNum(v) || v < 0) return `${nome}.${k} deve ser número >= 0`;
    }
    return null;
  };
  if (ch.clearanceTipo !== undefined) {
    if (ch.clearanceTipo === null) delete p.clearanceTipo;
    else { const e = folgas(ch.clearanceTipo, 'clearanceTipo', TIPOS_FOLGA); if (e) return erro(e); p.clearanceTipo = Object.assign({}, ch.clearanceTipo); }
  }
  if (ch.clearanceNet !== undefined) {
    if (ch.clearanceNet === null) delete p.clearanceNet;
    else {
      if (!ch.clearanceNet || typeof ch.clearanceNet !== 'object' || Array.isArray(ch.clearanceNet)) return erro('clearanceNet deve ser {net: {tipo: mm, "*": mm}}');
      for (const [n, o] of Object.entries(ch.clearanceNet)) { const e = folgas(o, 'clearanceNet[' + n + ']', TIPOS_FOLGA.concat('*')); if (e) return erro(e); }
      p.clearanceNet = JSON.parse(JSON.stringify(ch.clearanceNet));
    }
  }
  if (ch.con_tipo !== undefined) { if (!['relief', 'direct', 'none'].includes(ch.con_tipo)) return erro('con_tipo deve ser relief, direct ou none'); c.tipo = ch.con_tipo; }
  if (isNum(ch.con_condutores)) { if (ch.con_condutores !== 2 && ch.con_condutores !== 4) return erro('con_condutores deve ser 2 ou 4'); c.condutores = ch.con_condutores; }
  if (isNum(ch.con_largura)) { if (!(ch.con_largura > 0)) return erro('con_largura deve ser > 0'); c.largura = ch.con_largura; }
  if (isNum(ch.con_gap)) { if (!(ch.con_gap > 0)) return erro('con_gap deve ser > 0'); c.gap = ch.con_gap; }
  if (isNum(ch.con_angulo)) { if (ch.con_angulo !== 45 && ch.con_angulo !== 90) return erro('con_angulo deve ser 45 ou 90'); c.angulo = ch.con_angulo; }
  if (p.pour === 'hatch') {
    const hb = Object.assign({ grade:0.508, largura:0.254 }, p.hatch || {});
    if (isNum(ch.hatch_grade)) { if (!(ch.hatch_grade > 0)) return erro('hatch_grade deve ser > 0'); hb.grade = ch.hatch_grade; }
    if (isNum(ch.hatch_largura)) { if (!(ch.hatch_largura > 0)) return erro('hatch_largura deve ser > 0'); hb.largura = ch.hatch_largura; }
    if (hb.largura >= hb.grade) avisos.push('hatch: trilha >= grade — o despejo sai sólido');
    p.hatch = hb;
  } else delete p.hatch;
  if (!p.net && p.pour !== 'none') avisos.push('polígono sem net: o cobre despejado fica solto (No Net)');
  return { poly:p, avisos };
}

/* O modelo que a tela edita. Alem do que ja tinha (comps, tracks/arcs/vias de cobre, texts,
   added), agora tambem:
   - silk LIVRE (B.silk sem owner) e linhas LIVRES (B.lines sem owner) entram em model.tracks
     (item kind 'line') e model.arcs (item kind 'arc'), no MESMO formato dos de cobre
     {kind:'track'|'arc', src, eff, changed, deleted}. O prefixo do id diz de onde vieram
     (t/a cobre, s silk, l linhas). Os com owner ficam fora: sao do componente, e a tela os
     desenha direto do board pelo ownerDelta/xfObject;
   - fills livres em model.fills e regions livres (sem owner, sem poly, sem keepout, de espelho
     NOVO) em model.regions, mais o despejo do Altium sem poligono na placa (marcado `orfa`: so
     region_del); a region de polygon, a de componente, a keepout e TODA region de
     espelho antigo ficam so para desenho (region_del nelas e erro que diz o porque).
   Ordem (a do ApplyChanges): as mudancas valem na ordem do arquivo, e o orig_* de cada uma e
   conferido com o objeto COMO ELE ESTA depois das anteriores -- objeto que uma op anterior tirou
   de onde o orig_* diz e erro (la ela e recusada); objeto intocado que nao confere continua
   sendo o aviso de espelho desatualizado. So o comp_attr o ApplyChanges deixa para o fim.
   Regra do eff para objetos com owner (trilha de cobre do footprint, textos do componente):
   o eff fica no referencial do board.js, SEM o deslocamento do componente movido -- quem
   desenha aplica ownerDelta/xfObject, e o effectiveBoard() ja entrega aplicado.
   O modelo guarda (nao enumeraveis) o `board` de onde saiu e os `pares` mecanicos da placa.

   Placa nova e ECO (2026-10-13):
   - comp_add entra em model.comps (added:true) com um `src` SINTETIZADO do footprint, no formato
     do board.js, ja no lugar pedido -- comp_move, designator_move e pad_net seguintes valem nele
     como num componente que veio do Altium. A serigrafia e o designator dele moram em
     model.extra (nao enumeravel) e o effectiveBoard os emite como objetos do componente;
   - comp_del TIRA o componente de model.comps (model.comps[i] continua casando com
     effectiveBoard().components[i], que a tela usa) e o guarda em model.compsRemovidos; os
     objetos com owner dele somem da placa efetiva. compByRef continua apontando para ele, para
     a op seguinte dizer "foi removido" em vez de "nao existe";
   - pads soltos (freepads) em model.pads, polygon pours (a DEFINICAO, nao o cobre despejado) em
     model.polygons, nets em model.nets (a lista efetiva) com model.netsRenomeadas/Removidas;
   - `opts` (opcional): { pcblib } -- a biblioteca de onde o comp_add tira o footprint (sem ela
     vale a registrada com setPcbLib, a embutida no board e a dos componentes ja colocados). */
/* ---- a pilha de camadas (stack_set) e o vao da via (from/to) ---- */
const COBRE_PILHA = /^(Top|Bottom|Mid([1-9]|[12]\d|30))$/;
function stackDaOp(ch){
  const L = ch.layers;
  if (!Array.isArray(L) || L.length < 2) return { erro:'layers deve ser a lista das camadas de cobre na ordem física, de Top a Bottom (>= 2)' };
  const out = [], vistos = new Set(), avisos = [];
  for (let i = 0; i < L.length; i++) {
    const l = (L[i] && typeof L[i] === 'object') ? L[i] : {};
    const k = typeof l.key === 'string' ? l.key : '';
    if (i === 0 && k !== 'Top') return { erro:'a primeira camada da pilha é a Top' };
    if (i === L.length - 1 && k !== 'Bottom') return { erro:'a última camada da pilha é a Bottom' };
    if (i > 0 && i < L.length - 1 && !/^Mid([1-9]|[12]\d|30)$/.test(k)) return { erro:`camada "${k}" no meio da pilha: use Mid1 a Mid30` };
    if (vistos.has(k)) return { erro:`camada "${k}" repetida na pilha` };
    vistos.add(k);
    const cu = l.copper === undefined ? 0.035 : l.copper;
    if (!isNum(cu) || cu <= 0 || cu > 0.5) return { erro:`${k}: copper (espessura do cobre, mm) deve ser > 0 e até 0,5` };
    const e = { key:k, copper:cu };
    if (i < L.length - 1) {
      if (!isNum(l.dielectric) || l.dielectric <= 0 || l.dielectric > 10) return { erro:`${k}: dielectric (o dielétrico abaixo dela, mm) deve ser > 0 e até 10` };
      e.dielectric = l.dielectric;
    } else if (isNum(l.dielectric) && l.dielectric) avisos.push('a Bottom não tem dielétrico abaixo: o valor foi ignorado');
    if (typeof l.name === 'string' && l.name.trim()) e.name = l.name.trim().slice(0, 40);
    out.push(e);
  }
  let mech = null;
  if (ch.mech !== undefined) {
    if (!Array.isArray(ch.mech) || ch.mech.some(k => typeof k !== 'string' || !/^Mech([1-9]|1[0-6])$/.test(k)))
      return { erro:'mech deve ser a lista das camadas mecânicas da placa (Mech1 a Mech16)' };
    mech = [...new Set(ch.mech)];
  }
  const thickness = Math.round(out.reduce((s, l) => s + l.copper + (l.dielectric || 0), 0) * 1e6) / 1e6;
  if (thickness > 12) return { erro:'a placa passaria de 12 mm de espessura: confira os valores (em mm)' };
  if (out.length > 2 && out.length % 2) avisos.push(out.length + ' camadas de cobre: número ímpar encarece a fabricação');
  return { stack:{ layers:out, mech, thickness }, avisos };
}
/* from/to de via_add e via_edit: camadas de cobre (Top, Mid1..Mid30, Bottom), diferentes entre si */
function vaoDaVia(ch, atual){
  if (ch.from === undefined && ch.to === undefined) return {};
  for (const k of ['from', 'to']) if (ch[k] !== undefined && (typeof ch[k] !== 'string' || !COBRE_PILHA.test(ch[k])))
    return { erro:`${k}: camada de cobre onde a via ${k === 'from' ? 'começa' : 'acaba'} (Top, Mid1..Mid30 ou Bottom)` };
  const from = ch.from !== undefined ? ch.from : ((atual && atual.from) || 'Top');
  const to = ch.to !== undefined ? ch.to : ((atual && atual.to) || 'Bottom');
  if (from === to) return { erro:'from e to iguais: a via liga duas camadas diferentes' };
  const cega = !((from === 'Top' && to === 'Bottom') || (from === 'Bottom' && to === 'Top'));
  return { from, to, aviso:cega ? 'via cega/enterrada (' + from + ' → ' + to + '): confira se o fabricante faz' : '' };
}
/* a pilha na placa efetiva: layers[] na ordem da pilha (stack 1..N, copper, dielectric), as que nao
   sao de cobre como vieram (menos as mecanicas tiradas), e stackup {thickness, layers} */
function aplicaPilha(out, B, st){
  const antes = Array.isArray(B.layers) ? B.layers.filter(l => l && typeof l.key === 'string') : [];
  const porK = new Map(antes.map(l => [l.key, l]));
  const L = [];
  st.layers.forEach((s, i) => {
    const o = Object.assign(dcopy(porK.get(s.key) || {}), { key:s.key, stack:i + 1, copper:s.copper });
    if (s.name) o.name = s.name; else if (!o.name) o.name = (pcbLayer(s.key) || {}).name || s.key;
    if (isNum(s.dielectric)) o.dielectric = s.dielectric; else delete o.dielectric;
    L.push(o);
  });
  for (const l of antes) {
    if (COBRE_PILHA.test(l.key)) continue;
    if (st.mech && /^Mech\d+$/.test(l.key) && st.mech.indexOf(l.key) < 0) continue;
    L.push(dcopy(l));
  }
  if (st.mech) for (const k of st.mech) if (!L.some(l => l.key === k)) L.push({ key:k, name:(pcbLayer(k) || {}).name || k });
  out.layers = L;
  out.stackup = { thickness:st.thickness, layers:st.layers.map(l => Object.assign({}, l)), mech:st.mech ? st.mech.slice() : null };
}
function applyPcbChanges(board, changes, opts){
  const B = board || {};
  const CH = Array.isArray(changes) ? changes : [];
  const novo = espelhoNovo(B), pares = mechPairs(B);
  const model = { comps:[], compByRef:{}, tracks:[], arcs:[], vias:[], texts:[], fills:[], regions:[], added:[],
                  pads:[], polygons:[], compsRemovidos:[],
                  nets:(Array.isArray(B.nets) ? B.nets.filter(n => typeof n === 'string') : []), netsChanged:false,
                  netsRenomeadas:{}, netsRemovidas:[],
                  validation:[], changeItems:[],
                  outline:((B.board && B.board.outline) || []).slice(), outlineChanged:false,
                  stack:null };
  const oculto = (o, k, v) => Object.defineProperty(o, k, { value:v, writable:true, configurable:true, enumerable:false });
  oculto(model, 'board', board);
  oculto(model, 'pares', pares);
  /* o que o comp_add sintetizou: {silk:[], texts:[]} e, por objeto, o componente dono */
  oculto(model, 'extra', { silk:[], texts:[], dono:new Map() });
  for (const c of (B.components || [])) {
    const m = { kind:'comp', src:c, eff:{ x:c.x, y:c.y, rot:c.rot, layer:c.layer }, changed:false, attrChanged:false };
    oculto(m, 'pares', pares);
    model.comps.push(m); model.compByRef[c.ref] = m;
  }
  const compDe = ref => (ref != null && temProp(model.compByRef, String(ref))) ? model.compByRef[String(ref)] : null;
  /* nets: o conjunto efetivo enquanto as ops andam (net_add/net_del/net_rename) */
  const netSet = new Set(model.nets);
  const netConhecida = n => typeof n !== 'string' || n === '' || netSet.has(n);

  /* Indice por id de TODOS os objetos com id -- inclusive os que ficam fora do modelo (de
     componente, de poligono, keepout, region de espelho antigo), que entram so como `fora`
     para o erro dizer por que nao sao editaveis. Id repetido (board.js feito a mao, espelho
     torto) nao some calado: a op escolhe pelo orig_* e, se nem ele decide, e erro. */
  const porId = Object.create(null);
  const indexa = m => { const id = m.src.id; if (id == null) return; const k = String(id); (porId[k] || (porId[k] = [])).push(m); };
  const entra = (kind, src, list) => { const m = { kind, src, eff:copiaEff(src), changed:false, deleted:false }; list.push(m); indexa(m); };
  for (const t of (B.tracks || [])) if (t) entra('track', t, model.tracks);
  for (const a of (B.arcs  || [])) if (a) entra('arc',   a, model.arcs);
  for (const v of (B.vias  || [])) if (v) entra('via',   v, model.vias);
  for (const x of (B.texts || [])) if (x) entra('text',  x, model.texts);
  for (const s of [].concat(B.silk || [], B.lines || [])) {
    if (!s || (s.kind && s.kind !== 'line' && s.kind !== 'arc')) continue;
    const kind = s.kind === 'arc' ? 'arc' : 'track';
    if (s.owner) { indexa({ kind, src:s, fora:'owner' }); continue; }
    entra(kind, s, kind === 'arc' ? model.arcs : model.tracks);
  }
  for (const f of (B.fills || [])) {
    if (!f) continue;
    if (f.owner) { indexa({ kind:'fill', src:f, fora:'owner' }); continue; }
    entra('fill', f, model.fills);
  }
  /* pedaco despejado cujo `de` nao e poligono da placa (board.js » polygons; o poly_add gera id
     novo, que nenhum pedaco do board.js cita): cobre que o Altium despejou de um poligono que nao
     veio no espelho (o ExportBoard nao exporta poligono -- o "altium_sem_poligono" do DRC).
     Ninguem o redespeja, entao ele entra no modelo marcado `orfa` e o region_del apaga; mexer
     nele (apagar e recriar) nao: o region_add nao leva os furos do despejo (1.35.0) */
  const idsPoly = new Set();
  for (const g of (Array.isArray(B.polygons) ? B.polygons : [])) if (g && g.id != null) idsPoly.add(String(g.id));
  for (const g of (B.regions || [])) {
    if (!g) continue;
    const orfa = !g.owner && !!g.poly && !(g.de != null && idsPoly.has(String(g.de)));
    const fora = g.owner ? 'owner' : g.poly && !orfa ? 'poly' : g.keepout ? 'keepout' : !novo ? 'antigo' : '';
    if (fora) { indexa({ kind:'region', src:g, fora }); continue; }
    entra('region', g, model.regions);
    if (orfa) model.regions[model.regions.length - 1].orfa = true;
  }
  for (const p of (B.freepads || [])) if (p) entra('pad', p, model.pads);
  for (const g of (Array.isArray(B.polygons) ? B.polygons : [])) if (g) entra('poly', g, model.polygons);
  const temNets = Array.isArray(B.nets);
  /* o objeto do id para a op: so os do tipo `kind`; com id repetido, decide quem casa com o
     orig_* da op (`casa`, comparado com o board.js); nem ele decidindo -> {ambiguo:n} */
  const achar = (id, kind, casa) => {
    const L = (id != null && temProp(porId, String(id))) ? porId[String(id)].filter(m => m.kind === kind) : [];
    if (L.length < 2) return L[0] || null;
    const c = L.filter(m => casa(m.src));
    return c.length === 1 ? c[0] : { ambiguo:L.length };
  };
  /* camada de destino de um objeto novo/editado: tem de existir na tabela, e Multi e so de
     pad e via (o Altium nao tem trilha/fill/texto "passante") */
  const layerErr = (key, what) => {
    if (typeof key !== 'string' || !key) return 'falta layer';
    const L = pcbLayer(key);
    if (!L) return `layer "${key}" não existe (use uma chave da tabela: Top, Bottom, TopOverlay, Mech1...)`;
    if (L.kind === 'multi') return `${what} não pode ficar na Multi-Layer`;
    return '';
  };
  /* campo presente que nao e numero: o ApplyChanges le 0 (StrToFloatDot de "null"/"abc") e
     escreveria isso na placa; aqui a op e recusada */
  const invalido = (ch, keys) => keys.find(k => ch[k] !== undefined && !isNum(ch[k]));

  /* quem mexeu por ultimo em cada objeto (indice da op): `quem` para os objetos, `quemPos`
     (comp_move) e `quemAttr` (comp_attr) separados no componente */
  const quem = new Map(), quemPos = new Map(), quemAttr = new Map();
  /* onde um texto esta AGORA: o eff (referencial do board.js) mais o deslocamento do dono, se
     uma op anterior ja moveu o componente -- e o que o ApplyChanges acha na placa */
  const textoAtual = m => {
    const o = { x:m.eff.x, y:m.eff.y, layer:m.eff.layer, text:m.eff.text };
    let mexeu = quem.get(m);
    const dono = m.src.owner ? compDe(m.src.owner) : null;
    if (dono && dono.changed) {
      const d = compDelta(dono), q = xfPoint(d, o.x, o.y);
      o.x = q.x; o.y = q.y;
      if (d.flip) o.layer = flipIn(pares, o.layer);
      const k = quemPos.get(dono);
      if (k !== undefined && (mexeu === undefined || k > mexeu)) mexeu = k;
    }
    return { obj:o, mexeu, dono };
  };
  /* x/y/rot (e camada/espelho) de uma op de texto valem no lugar ATUAL do texto -- o que o
     ApplyChanges acha na placa. O eff de texto de componente fica no referencial do board.js
     (o effectiveBoard poe o deslocamento do dono por cima), entao, se o dono ja andou, a conta
     do dono e desfeita aqui. Texto livre (ou dono parado): o valor entra como veio. */
  const escreveTexto = (m, ch, at) => {
    const d = (at.dono && at.dono.changed) ? compDelta(at.dono) : null;
    if (isNum(ch.x) || isNum(ch.y)) {
      const x = isNum(ch.x) ? ch.x : at.obj.x, y = isNum(ch.y) ? ch.y : at.obj.y;
      const p = d ? xfPointInv(d, x, y) : { x, y };
      if (d || isNum(ch.x)) m.eff.x = p.x;
      if (d || isNum(ch.y)) m.eff.y = p.y;
    }
    if (isNum(ch.rot)) m.eff.rot = d ? (d.flip ? phiOf(d) + 180 - ch.rot : ch.rot - d.dr) : ch.rot;
    if (typeof ch.layer === 'string' && ch.layer) m.eff.layer = (d && d.flip) ? flipIn(pares, ch.layer) : ch.layer;
    if (typeof ch.mirror === 'boolean') m.eff.mirror = (d && d.flip) ? !ch.mirror : ch.mirror;
  };
  /* comp_attr: o designator FINAL de cada componente, simulando so os comp_attr na ordem (o
     ApplyChanges os aplica no fim). Com ele o rename que deixaria dois componentes com o mesmo
     nome e recusado, e a troca R1<->R2 continua valendo. */
  const finalRef = new Map();
  {
    const nome = new Map(), coment = new Map();
    for (const ch of CH) {
      if (!ch || ch.op !== 'comp_attr') continue;
      const m = compDe(ch.ref);
      if (!m || typeof ch.orig_designator !== 'string' || typeof ch.orig_comment !== 'string') continue;
      if (nome.has(m) && (ch.orig_designator !== nome.get(m) || ch.orig_comment !== coment.get(m))) continue;
      nome.set(m, (typeof ch.designator === 'string' && ch.designator) ? ch.designator : (nome.has(m) ? nome.get(m) : m.src.ref));
      coment.set(m, typeof ch.comment === 'string' ? ch.comment : (coment.has(m) ? coment.get(m) : (m.src.comment || '')));
    }
    for (const [m, n] of nome) finalRef.set(m, n);
  }
  const nomeFinal = o => finalRef.has(o) ? finalRef.get(o) : o.src.ref;
  /* regions sem dono (espelho antigo) e recortes de componente sem dono que caem inteiros na
     caixa do componente: podem ser dele, mas sem owner ficam no lugar quando ele anda */
  const semDonoDentro = c => {
    const b = c.bbox;
    if (!b || !isNum(b.x1) || !isNum(b.y1) || !isNum(b.x2) || !isNum(b.y2)) return [0, 0];
    const dentro = pts => Array.isArray(pts) && pts.length > 0 && pts.every(p => Array.isArray(p) &&
      p[0] >= b.x1 - TOL && p[0] <= b.x2 + TOL && p[1] >= b.y1 - TOL && p[1] <= b.y2 + TOL);
    let nr = 0, nk = 0;
    if (!novo) for (const g of (B.regions || [])) if (g && !g.owner && dentro(g.points)) nr++;
    for (const k of (B.cutouts || [])) if (k && k.incomp && !k.owner && dentro(k.points)) nk++;
    return [nr, nk];
  };

  /* comp_del: refs dos componentes DO BOARD removidos (os objetos com owner deles saem da placa
     efetiva) e quem mexeu por ultimo em cada pad (pad_net), por componente */
  const refsBoardRemovidos = new Set();
  const textoMorto = t => {
    const d = model.extra.dono.get(t.src);
    if (d) return !!d.deleted;
    return !!(t.src.owner && refsBoardRemovidos.has(t.src.owner));
  };
  const quemPad = new Map();
  const netsRemovidas = new Set();
  /* a net de um objeto do board AGORA (depois dos net_rename/net_del ja aplicados) */
  const netAgora = n => {
    let x = n;
    for (let i = 0; i < 64 && typeof x === 'string' && temProp(model.netsRenomeadas, x) && !netSet.has(x); i++) x = model.netsRenomeadas[x];
    return (typeof x === 'string' && netsRemovidas.has(x) && !netSet.has(x)) ? '' : x;
  };
  oculto(model, 'netAgora', netAgora);
  const polyDaOp = (ch, base) => montaPoly(ch, base, {
    clearance: (B.rules && isNum(B.rules.clearance)) ? B.rules.clearance : 0.254,
    ordem: model.polygons.reduce((mx, p) => Math.max(mx, isNum(p.eff.ordem) ? p.eff.ordem + 1 : 0), 0) });

  let addSeq = 0;
  CH.forEach((chIn, idx) => {
    const ch = (chIn && typeof chIn === 'object') ? chIn : {};
    const item = { ch:chIn, idx, status:'ok', msg:'', target:null };
    model.changeItems.push(item);
    const bad  = (m) => { item.status='err'; item.msg=m; model.validation.push({ level:'err', msg:`#${idx+1} ${ch.op||'?'}: ${m}`, target:item.target }); };
    const warn = (m) => { if (item.status!=='err') item.status='warn'; item.msg=m; model.validation.push({ level:'warn', msg:`#${idx+1} ${ch.op}: ${m}`, target:item.target }); };
    /* orig_* x estado atual: confere -> segue; nao confere e uma op anterior mexeu -> erro (o
       ApplyChanges vai recusar); nao confere e ninguem mexeu -> o aviso de sempre */
    const conferir = (ok, mexeu, aviso) => {
      if (ok) return true;
      if (mexeu !== undefined) {
        bad(`orig_* não confere com o objeto depois da mudança #${mexeu+1} — o ApplyChanges aplica as mudanças em ordem e vai recusar esta; junte as duas numa linha só`);
        return false;
      }
      warn(aviso);
      return true;
    };
    /* net so faz sentido em cobre: num objeto novo em outra camada ela e descartada do eff */
    const soCobre = (eff) => {
      if (isCopper(eff.layer)) return;
      if (typeof eff.net === 'string' && eff.net) warn(`net "${eff.net}" só vale em camada de cobre — ignorada`);
      delete eff.net;
    };
    /* objeto novo e sempre livre: o ApplyChanges cria primitiva solta, entao dono, poligono e
       keepout que viessem na op nao valem */
    const novoLivre = (eff) => {
      if (eff.owner !== undefined) { if (eff.owner) warn(`owner "${eff.owner}" ignorado — objeto novo é sempre livre`); delete eff.owner; }
      delete eff.poly; delete eff.keepout;
      return eff;
    };
    const removido = (m, oque) => bad(`${oque} id "${ch.id}" já foi removid${oque === 'via' || oque === 'trilha' || oque === 'região' ? 'a' : 'o'} pela mudança #${quem.get(m)+1}`);

    switch (ch.op) {
      case 'comp_move': {
        const m = compDe(ch.ref);
        if (!m) return bad(`componente "${ch.ref}" não existe no board.js`);
        if (m.deleted) return bad(`componente "${ch.ref}" foi removido pela mudança #${m.removidoEm + 1}`);
        item.target = m;
        if (!isNum(ch.orig_x)||!isNum(ch.orig_y)||!isNum(ch.orig_rot)||!ch.orig_layer)
          return bad('faltam orig_x/orig_y/orig_rot/orig_layer (copie do board.js)');
        /* o ApplyChanges so vira de lado com "Top" ou "Bottom" EXATOS (LayerFromName); qualquer
           outra coisa ele ignora calado e o componente fica do lado em que estava */
        if (ch.layer != null && ch.layer !== '' && ch.layer !== 'Top' && ch.layer !== 'Bottom')
          return bad(`layer "${ch.layer}" inválida para componente — use Top ou Bottom`);
        const inv = invalido(ch, ['x','y','rot']); if (inv) return bad(`campo "${inv}" inválido`);
        const e = m.eff;
        if (!conferir(near(ch.orig_x,e.x)&&near(ch.orig_y,e.y)&&nearAng(ch.orig_rot,e.rot)&&ch.orig_layer===e.layer,
                      quemPos.get(m), 'orig_* não confere com o board.js — espelho pode estar desatualizado')) return;
        /* o ApplyChanges faz MoveToXY(x, y) sempre: o eixo que faltar vira 0 la */
        const falta = ['x','y'].filter(k => !isNum(ch[k]));
        if (falta.length) warn(`sem ${falta.join(' e ')}: o ApplyChanges leva o componente para ${falta.map(k => k + ' = 0').join(', ')} — escreva x e y`);
        const lado = (ch.layer === 'Top' || ch.layer === 'Bottom') ? ch.layer : e.layer;
        if (lado !== e.layer && !isNum(ch.rot))
          warn('vira de lado sem rot: a rotação final fica por conta do Altium — escreva rot');
        if (isNum(ch.x)) e.x = ch.x;
        if (isNum(ch.y)) e.y = ch.y;
        if (isNum(ch.rot)) e.rot = ch.rot;
        e.layer = lado;
        m.changed = !(near(e.x,m.src.x)&&near(e.y,m.src.y)&&nearAng(e.rot,m.src.rot)&&e.layer===m.src.layer);
        quemPos.set(m, idx);
        if (m.changed) {
          const [nr, nk] = semDonoDentro(m.src);
          if (nr || nk) {
            const oq = [nr ? `${nr} região(ões)` : '', nk ? `${nk} recorte(s)` : ''].filter(Boolean).join(' e ');
            warn(`${oq} dentro de ${m.src.ref} sem dono no board.js${nr ? ' (espelho antigo)' : ''}: na prévia e no Gerber ficam no lugar quando o componente anda — reexporte a placa com o ExportBoard novo`);
          }
        }
        break;
      }
      case 'comp_attr': {
        /* O ApplyChanges aplica TODOS os comp_attr no fim (renomear cedo quebraria os refs das
           outras ops); aqui a ordem entre eles e a mesma, e as outras ops nao mexem em
           designator/comment -- compByRef e chaveado pelo ref do board.js. */
        const m = compDe(ch.ref);
        if (!m) return bad(`componente "${ch.ref}" não existe no board.js`);
        if (m.deleted) return bad(`componente "${ch.ref}" foi removido pela mudança #${m.removidoEm + 1}`);
        item.target = m;
        if (typeof ch.orig_designator !== 'string' || typeof ch.orig_comment !== 'string')
          return bad('faltam orig_designator/orig_comment (copie do board.js)');
        const desAtual = m.eff.designator !== undefined ? m.eff.designator : m.src.ref;
        const comAtual = m.eff.comment !== undefined ? m.eff.comment : (m.src.comment || '');
        if (!conferir(ch.orig_designator === desAtual && ch.orig_comment === comAtual, quemAttr.get(m),
                      'orig_* não confere com o board.js — espelho pode estar desatualizado')) return;
        const nome = (typeof ch.designator === 'string' && ch.designator) ? ch.designator : '';
        if (nome && nome !== desAtual) {
          const outro = model.comps.find(o => o !== m && nomeFinal(o) === nome);
          if (outro) return bad(outro.src.ref === nome
            ? `designator "${nome}" já é de outro componente, que continua com ele — dois componentes com o mesmo nome`
            : `designator "${nome}" também é o nome novo de ${outro.src.ref} — dois componentes com o mesmo nome`);
        }
        if (nome) m.eff.designator = nome;
        if (typeof ch.comment === 'string') m.eff.comment = ch.comment;
        m.attrChanged = (m.eff.designator !== undefined && m.eff.designator !== m.src.ref) ||
                        (m.eff.comment !== undefined && m.eff.comment !== (m.src.comment || ''));
        quemAttr.set(m, idx);
        break;
      }
      case 'track_edit': case 'track_del': {
        /* o id pode ser trilha de cobre (t), silk livre (s) ou linha livre (l) */
        const casa = s => !!s && ((near(ch.orig_x1,s.x1)&&near(ch.orig_y1,s.y1)&&near(ch.orig_x2,s.x2)&&near(ch.orig_y2,s.y2)) ||
                                  (near(ch.orig_x1,s.x2)&&near(ch.orig_y1,s.y2)&&near(ch.orig_x2,s.x1)&&near(ch.orig_y2,s.y1)))
                                 && near(ch.orig_w,s.w) && ch.orig_layer===s.layer;
        const m = achar(ch.id, 'track', casa);
        if (m && m.ambiguo) return bad(`trilha id "${ch.id}" aparece ${m.ambiguo} vezes no board.js e os orig_* não dizem qual — reexporte o espelho`);
        if (!m) return bad(`trilha id "${ch.id}" não existe no board.js`);
        if (m.fora) return bad(`trilha id "${ch.id}" pertence ao componente ${m.src.owner} (não é editável sozinha)`);
        item.target = m;
        if (m.src.owner) return bad(`trilha id "${ch.id}" pertence ao componente ${m.src.owner} (não é editável sozinha)`);
        if (m.deleted) return removido(m, 'trilha');
        for (const k of ['x1','y1','x2','y2','w'])
          if (!isNum(ch['orig_'+k])) return bad('faltam campos orig_* (copie do board.js)');
        if (!ch.orig_layer) return bad('falta orig_layer');
        if (!conferir(casa(m.eff), quem.get(m), 'orig_* não confere com o board.js')) return;
        if (ch.op==='track_del'){ m.deleted = true; quem.set(m, idx); break; }
        if (ch.layer) { const e = layerErr(ch.layer, 'trilha'); if (e) return bad(e); }
        const inv = invalido(ch, ['x1','y1','x2','y2','w']); if (inv) return bad(`campo "${inv}" inválido`);
        if (isNum(ch.w) && ch.w <= 0) return bad('largura w deve ser > 0');
        for (const k of ['x1','y1','x2','y2','w']) if (isNum(ch[k])) m.eff[k] = ch[k];
        if (ch.layer) m.eff.layer = ch.layer;
        if (typeof ch.net==='string') {
          if (isCopper(m.eff.layer)) m.eff.net = ch.net;
          else if (ch.net) warn(`net "${ch.net}" só vale em camada de cobre — ignorada`);
        }
        m.changed = true; quem.set(m, idx);
        break;
      }
      case 'track_add': {
        for (const k of ['x1','y1','x2','y2','w']) if (!isNum(ch[k])) return bad(`campo "${k}" ausente/inválido`);
        const e = layerErr(ch.layer, 'trilha'); if (e) return bad(e);
        if (ch.w<=0) return bad('largura w deve ser > 0');
        const m = { kind:'track', src:null, eff:{ id:'new-t'+(++addSeq), ...ch }, changed:false, added:true };
        model.added.push(m); item.target = m;
        novoLivre(m.eff); soCobre(m.eff);
        break;
      }
      case 'via_edit': case 'via_del': {
        const casa = s => !!s && near(ch.orig_x,s.x) && near(ch.orig_y,s.y);
        const m = achar(ch.id, 'via', casa);
        if (m && m.ambiguo) return bad(`via id "${ch.id}" aparece ${m.ambiguo} vezes no board.js e os orig_* não dizem qual — reexporte o espelho`);
        if (!m) return bad(`via id "${ch.id}" não existe no board.js`);
        item.target = m;
        if (m.deleted) return removido(m, 'via');
        if (!isNum(ch.orig_x)||!isNum(ch.orig_y)) return bad('faltam orig_x/orig_y');
        if (!conferir(casa(m.eff), quem.get(m), 'orig_* não confere com o board.js')) return;
        if (ch.op==='via_del'){ m.deleted = true; quem.set(m, idx); break; }
        const inv = invalido(ch, ['x','y','size','drill']); if (inv) return bad(`campo "${inv}" inválido`);
        if ((isNum(ch.size) && ch.size <= 0) || (isNum(ch.drill) && ch.drill <= 0)) return bad('size e drill devem ser > 0');
        /* o vao da via (pedido do dono, 2026-10-29): from/to = as camadas de cobre onde ela comeca e acaba */
        const vao = vaoDaVia(ch, m.eff); if (vao.erro) return bad(vao.erro);
        for (const k of ['x','y','size','drill']) if (isNum(ch[k])) m.eff[k] = ch[k];
        if (vao.from) { m.eff.from = vao.from; m.eff.to = vao.to; }
        if (vao.aviso) warn(vao.aviso);
        if (isNum(m.eff.drill) && isNum(m.eff.size) && m.eff.drill >= m.eff.size) warn('drill >= size (anel nulo)');
        m.changed = true; quem.set(m, idx);
        break;
      }
      case 'via_add': {
        for (const k of ['x','y','size','drill']) if (!isNum(ch[k])) return bad(`campo "${k}" ausente/inválido`);
        if (ch.size<=0 || ch.drill<=0) return bad('size e drill devem ser > 0');
        const vao = vaoDaVia(ch, { from:'Top', to:'Bottom' }); if (vao.erro) return bad(vao.erro);
        if (vao.aviso) warn(vao.aviso);
        const m = { kind:'via', src:null, eff:{ id:'new-v'+(++addSeq), from:'Top', to:'Bottom', ...ch }, changed:false, added:true };
        model.added.push(m); item.target = m;
        if (ch.drill>=ch.size) warn('drill >= size (anel nulo)');
        novoLivre(m.eff);
        break;
      }
      case 'arc_edit': case 'arc_del': {
        /* o id pode ser arco de cobre (a), arco de silk livre (s) ou de linha livre (l) */
        const casa = s => !!s && near(ch.orig_cx,s.cx) && near(ch.orig_cy,s.cy) && near(ch.orig_r,s.r) &&
                               nearAng(ch.orig_sa,s.sa) && nearAng(ch.orig_ea,s.ea) && ch.orig_layer===s.layer;
        const m = achar(ch.id, 'arc', casa);
        if (m && m.ambiguo) return bad(`arco id "${ch.id}" aparece ${m.ambiguo} vezes no board.js e os orig_* não dizem qual — reexporte o espelho`);
        if (!m) return bad(`arco id "${ch.id}" não existe no board.js`);
        if (m.fora) return bad(`arco id "${ch.id}" pertence ao componente ${m.src.owner} (não é editável sozinho)`);
        item.target = m;
        if (m.src.owner) return bad(`arco id "${ch.id}" pertence ao componente ${m.src.owner} (não é editável sozinho)`);
        if (m.deleted) return removido(m, 'arco');
        for (const k of ['cx','cy','r','sa','ea']) if (!isNum(ch['orig_'+k])) return bad('faltam campos orig_*');
        if (!ch.orig_layer) return bad('falta orig_layer');
        if (!conferir(casa(m.eff), quem.get(m), 'orig_* não confere com o board.js')) return;
        if (ch.op==='arc_del'){ m.deleted = true; quem.set(m, idx); break; }
        if (ch.layer) { const e = layerErr(ch.layer, 'arco'); if (e) return bad(e); }
        const inv = invalido(ch, ['cx','cy','r','sa','ea','w']); if (inv) return bad(`campo "${inv}" inválido`);
        if (isNum(ch.r) && ch.r <= 0) return bad('raio r deve ser > 0');
        if (isNum(ch.w) && ch.w <= 0) return bad('largura w deve ser > 0');
        for (const k of ['cx','cy','r','sa','ea','w']) if (isNum(ch[k])) m.eff[k] = ch[k];
        if (ch.layer) m.eff.layer = ch.layer;
        m.changed = true; quem.set(m, idx);
        break;
      }
      case 'arc_add': {
        for (const k of ['cx','cy','r','sa','ea','w']) if (!isNum(ch[k])) return bad(`campo "${k}" ausente/inválido`);
        const e = layerErr(ch.layer, 'arco'); if (e) return bad(e);
        if (ch.r<=0) return bad('raio r deve ser > 0');
        if (ch.w<=0) return bad('largura w deve ser > 0');
        const m = { kind:'arc', src:null, eff:{ id:'new-a'+(++addSeq), ...ch }, changed:false, added:true };
        model.added.push(m); item.target = m;
        novoLivre(m.eff); soCobre(m.eff);
        break;
      }
      case 'text_edit': {
        const casa = s => !!s && near(ch.orig_x,s.x) && near(ch.orig_y,s.y) && ch.orig_layer===s.layer && ch.orig_text===s.text;
        const m = achar(ch.id, 'text', casa);
        if (m && m.ambiguo) return bad(`texto id "${ch.id}" aparece ${m.ambiguo} vezes no board.js e os orig_* não dizem qual — reexporte o espelho`);
        if (!m) return bad(`texto id "${ch.id}" não existe no board.js`);
        item.target = m;
        if (!isNum(ch.orig_x)||!isNum(ch.orig_y)||!ch.orig_layer||typeof ch.orig_text!=='string')
          return bad('faltam orig_x/orig_y/orig_text/orig_layer (copie do board.js)');
        const s = m.src;
        if (s.designator || s.comment)
          return bad('só textos livres podem ser editados (este pertence a um componente)');
        if (m.deleted) return removido(m, 'texto');
        /* texto de componente (nao designator/comment) anda com o dono: depois de um comp_move
           dele, o ApplyChanges ja nao o acha no orig_* */
        const at = textoAtual(m);
        if (!conferir(casa(at.obj), at.mexeu, 'orig_* não confere com o board.js — espelho pode estar desatualizado')) return;
        if (ch.layer) { const e = layerErr(ch.layer, 'texto'); if (e) return bad(e); }
        const inv = invalido(ch, ['x','y','h','rot','w']); if (inv) return bad(`campo "${inv}" inválido`);
        if ((isNum(ch.h) && ch.h <= 0) || (isNum(ch.w) && ch.w <= 0)) return bad('altura h e espessura w devem ser > 0');
        if (typeof ch.text==='string') m.eff.text = ch.text;
        for (const k of ['h','w']) if (isNum(ch[k])) m.eff[k] = ch[k];
        escreveTexto(m, ch, at);
        m.changed = true; quem.set(m, idx);
        break;
      }
      case 'text_add': {
        /* x,y = CENTRO do bounding box (a convencao do text_edit); fonte stroke (kind, contrato
           secao 2: `kind` e o tipo de fonte, `font` o nome da TrueType); w padrao h/10 */
        if (typeof ch.text !== 'string' || !ch.text) return bad('campo "text" ausente/vazio');
        for (const k of ['x','y','h']) if (!isNum(ch[k])) return bad(`campo "${k}" ausente/inválido`);
        const e = layerErr(ch.layer, 'texto'); if (e) return bad(e);
        if (ch.h<=0) return bad('altura h deve ser > 0');
        if (ch.w!==undefined && !(isNum(ch.w) && ch.w>0)) return bad('espessura w deve ser > 0');
        if (ch.rot!==undefined && !isNum(ch.rot)) return bad('campo "rot" inválido');
        const m = { kind:'text', src:null, changed:false, added:true,
                    eff:{ id:'new-x'+(++addSeq), ...ch, w: isNum(ch.w) ? ch.w : ch.h/10, rot: isNum(ch.rot) ? ch.rot : 0,
                          mirror: ch.mirror === true, designator:false, comment:false, kind:'stroke' } };
        delete m.eff.font; delete m.eff.polys; delete m.eff.ax; delete m.eff.ay;
        model.added.push(m); item.target = m;
        novoLivre(m.eff);
        break;
      }
      case 'text_del': {
        const casa = s => !!s && near(ch.orig_x,s.x) && near(ch.orig_y,s.y) && ch.orig_layer===s.layer && ch.orig_text===s.text;
        const m = achar(ch.id, 'text', casa);
        if (m && m.ambiguo) return bad(`texto id "${ch.id}" aparece ${m.ambiguo} vezes no board.js e os orig_* não dizem qual — reexporte o espelho`);
        if (!m) return bad(`texto id "${ch.id}" não existe no board.js`);
        item.target = m;
        const s = m.src;
        if (s.owner || s.designator || s.comment)
          return bad(`texto id "${ch.id}" pertence ao componente ${s.owner || '?'} (só textos livres podem ser removidos)`);
        if (m.deleted) return removido(m, 'texto');
        if (!isNum(ch.orig_x)||!isNum(ch.orig_y)||!ch.orig_layer||typeof ch.orig_text!=='string')
          return bad('faltam orig_x/orig_y/orig_text/orig_layer (copie do board.js)');
        const at = textoAtual(m);
        if (!conferir(casa(at.obj), at.mexeu, 'orig_* não confere com o board.js — espelho pode estar desatualizado')) return;
        m.deleted = true; quem.set(m, idx);
        break;
      }
      case 'fill_edit': case 'fill_del': {
        /* o mesmo retangulo com os cantos trocados e o mesmo fill */
        const casa = s => !!s && near(Math.min(ch.orig_x1,ch.orig_x2), Math.min(s.x1,s.x2)) && near(Math.max(ch.orig_x1,ch.orig_x2), Math.max(s.x1,s.x2)) &&
                               near(Math.min(ch.orig_y1,ch.orig_y2), Math.min(s.y1,s.y2)) && near(Math.max(ch.orig_y1,ch.orig_y2), Math.max(s.y1,s.y2)) &&
                               ch.orig_layer===s.layer;
        const m = achar(ch.id, 'fill', casa);
        if (m && m.ambiguo) return bad(`fill id "${ch.id}" aparece ${m.ambiguo} vezes no board.js e os orig_* não dizem qual — reexporte o espelho`);
        if (!m) return bad(`fill id "${ch.id}" não existe no board.js`);
        if (m.fora) return bad(`fill id "${ch.id}" pertence ao componente ${m.src.owner} (não é editável sozinho)`);
        item.target = m;
        if (m.deleted) return removido(m, 'fill');
        for (const k of ['x1','y1','x2','y2']) if (!isNum(ch['orig_'+k])) return bad('faltam campos orig_* (copie do board.js)');
        if (!ch.orig_layer) return bad('falta orig_layer');
        if (!conferir(casa(m.eff), quem.get(m), 'orig_* não confere com o board.js')) return;
        if (ch.op==='fill_del'){ m.deleted = true; quem.set(m, idx); break; }
        if (ch.layer) { const e = layerErr(ch.layer, 'fill'); if (e) return bad(e); }
        const inv = invalido(ch, ['x1','y1','x2','y2','rot']); if (inv) return bad(`campo "${inv}" inválido`);
        const v = k => isNum(ch[k]) ? ch[k] : m.eff[k];
        if (near(v('x1'), v('x2')) || near(v('y1'), v('y2'))) return bad('fill sem área (x1 = x2 ou y1 = y2)');
        for (const k of ['x1','y1','x2','y2','rot']) if (isNum(ch[k])) m.eff[k] = ch[k];
        if (ch.layer) m.eff.layer = ch.layer;
        if (typeof ch.net==='string') {
          if (isCopper(m.eff.layer)) m.eff.net = ch.net;
          else if (ch.net) warn(`net "${ch.net}" só vale em camada de cobre — ignorada`);
        }
        m.changed = true; quem.set(m, idx);
        break;
      }
      case 'fill_add': {
        for (const k of ['x1','y1','x2','y2']) if (!isNum(ch[k])) return bad(`campo "${k}" ausente/inválido`);
        const e = layerErr(ch.layer, 'fill'); if (e) return bad(e);
        if (near(ch.x1, ch.x2) || near(ch.y1, ch.y2)) return bad('fill sem área (x1 = x2 ou y1 = y2)');
        if (ch.rot!==undefined && !isNum(ch.rot)) return bad('campo "rot" inválido');
        const m = { kind:'fill', src:null, eff:{ id:'new-f'+(++addSeq), ...ch, rot: isNum(ch.rot) ? ch.rot : 0 }, changed:false, added:true };
        model.added.push(m); item.target = m;
        novoLivre(m.eff); soCobre(m.eff);
        break;
      }
      case 'region_add': {
        /* poligono fechado implicito; cutout:true = Board Cutout (a layer e ignorada);
           polycut:true = Polygon Pour Cutout ("sem plano"): o plano nao entra, trilha e via
           passam -- numa camada de cobre ou na Multi (todas), sem net */
        if (!ptsValid(ch.pts, 3)) return bad('pts deve ser [[x,y],...] com >= 3 vértices');
        const corte = ch.cutout === true, semPlano = !corte && ch.polycut === true;
        if (semPlano) {
          if (ch.layer !== 'Multi' && !isCopper(ch.layer))
            return bad(`recorte de polígono (polycut) só em camada de cobre ou na Multi (todas) — "${ch.layer || ''}" não serve`);
        } else if (!corte) { const e = layerErr(ch.layer, 'região'); if (e) return bad(e); }
        const ge = regiaoErro(ch.pts); if (ge) return bad(ge);
        const m = { kind:'region', src:null, changed:false, added:true,
                    eff:{ id:(corte ? 'new-k' : semPlano ? 'new-q' : 'new-g')+(++addSeq), ...ch, points:ch.pts.map(p => [p[0], p[1]]) } };
        model.added.push(m); item.target = m;
        novoLivre(m.eff);
        if (corte || semPlano) {
          if (corte) { m.eff.layer = 'Multi'; m.eff.cutout = true; }
          if (typeof ch.net === 'string' && ch.net) warn(`recorte não tem net — "${ch.net}" ignorada`);
          delete m.eff.net;
        } else soCobre(m.eff);
        break;
      }
      case 'region_del': {
        const casa = s => { const p = (s && Array.isArray(s.points)) ? s.points : [], p0 = p[0] || [];
                            return !!s && ch.orig_layer===s.layer && ch.orig_n===p.length && near(ch.orig_x0,p0[0]) && near(ch.orig_y0,p0[1]); };
        const m = achar(ch.id, 'region', casa);
        if (m && m.ambiguo) return bad(`região id "${ch.id}" aparece ${m.ambiguo} vezes no board.js e os orig_* não dizem qual — reexporte o espelho`);
        if (!m) return bad(`região id "${ch.id}" não existe no board.js`);
        if (m.fora === 'owner')   return bad(`região id "${ch.id}" pertence ao componente ${m.src.owner} (não é editável sozinha)`);
        if (m.fora === 'poly')    return bad(`região id "${ch.id}" é pedaço do polígono ${m.src.de} despejado — o hub redespeja; mexa no polígono`);
        if (m.fora === 'keepout') return bad(`região id "${ch.id}" é keepout — fica só para desenho (remova no Altium)`);
        if (m.fora === 'antigo')  return bad(`região id "${ch.id}" vem de um espelho antigo (board.js sem "exporter"), que não diz se ela é livre, pedaço de polígono ou do componente — reexporte a placa com o ExportBoard novo`);
        item.target = m;
        if (m.deleted) return removido(m, 'região');
        if (!ch.orig_layer||!isNum(ch.orig_n)||!isNum(ch.orig_x0)||!isNum(ch.orig_y0))
          return bad('faltam orig_layer/orig_n/orig_x0/orig_y0 (copie do board.js)');
        if (!conferir(casa(m.eff), quem.get(m), 'orig_* não confere com o board.js')) return;
        m.deleted = true; quem.set(m, idx);
        break;
      }
      case 'designator_move': case 'comment_move': {
        /* o designator (ou o comment) do componente VIVO: o texto de um componente removido nao
           conta -- e o que o ApplyChanges acha na placa pelo FindComponent */
        const qual = ch.op === 'designator_move' ? 'designator' : 'comment';
        const dono = compDe(ch.ref);
        if (dono && dono.deleted) return bad(`componente "${ch.ref}" foi removido pela mudança #${dono.removidoEm + 1}`);
        const m = model.texts.find(t => t.src[qual] && t.src.owner === ch.ref && !textoMorto(t));
        if (!m) return bad(qual === 'designator' ? `designator do componente "${ch.ref}" não existe no board.js`
          : (dono ? `o comment de ${ch.ref} não está visível no board.js (Comment desligado no Altium: ligue-o lá e reexporte)`
                  : `componente "${ch.ref}" não existe no board.js`));
        item.target = m;
        if (!isNum(ch.orig_x)||!isNum(ch.orig_y))
          return bad(`faltam orig_x/orig_y (copie do item do ${qual} em board.js » texts)`);
        /* o designator anda com o componente: depois de um comp_move dele, o ApplyChanges (que
           aplica em ordem) ja nao acha o designator no orig_* e recusa -- o designator_move tem
           de vir ANTES do comp_move, com x/y no lugar de antes do componente andar */
        const at = textoAtual(m);
        if (!(near(ch.orig_x, at.obj.x) && near(ch.orig_y, at.obj.y))) {
          if (at.mexeu !== undefined && at.dono && at.mexeu === quemPos.get(at.dono) && at.mexeu !== quem.get(m))
            return bad(`o designator de ${ch.ref} já terá andado com o comp_move #${at.mexeu+1} — o ApplyChanges aplica em ordem e vai recusar este designator_move; ponha-o antes do comp_move`);
          if (!conferir(false, at.mexeu, 'orig_* não confere com o board.js — espelho pode estar desatualizado')) return;
        }
        const inv = invalido(ch, ['x','y','h','w','rot']); if (inv) return bad(`campo "${inv}" inválido`);
        if (isNum(ch.h) && ch.h <= 0) return bad('altura h deve ser > 0');
        if (isNum(ch.w) && ch.w <= 0) return bad('espessura w deve ser > 0');
        if (isNum(ch.h)) m.eff.h = ch.h;
        if (isNum(ch.w)) m.eff.w = ch.w;
        escreveTexto(m, { x:ch.x, y:ch.y, rot:ch.rot }, at);
        m.changed = true; quem.set(m, idx);
        break;
      }
      case 'outline_set': {
        /* vertice [x,y] = reta ate o proximo; [x,y,b] = arco de bulge b (ver ptsToOutline) */
        const segs = ptsToOutline(ch.pts);
        const temArco = !!segs && segs.some(s => s.kind === 'arc');
        if (!segs || ch.pts.length < (temArco ? 2 : 3))
          return bad('pts deve ser [[x,y],...] com >= 3 vértices (ou [x,y,bulge] no vértice que começa um arco; 2 vértices bastam com arco)');
        if (ch.pts.some(p => isNum(p[2]) && Math.abs(p[2]) > BULGE_MAX)) return bad(`bulge fora de faixa (|b| <= ${BULGE_MAX})`);
        model.outline = segs; model.outlineChanged = true;
        break;
      }
      case 'comp_add': {
        if (typeof ch.ref !== 'string' || !ch.ref) return bad('campo "ref" ausente');
        if (typeof ch.footprint !== 'string' || !ch.footprint) return bad('campo "footprint" ausente');
        for (const k of ['x','y']) if (!isNum(ch[k])) return bad(`campo "${k}" ausente/inválido`);
        const inv = invalido(ch, ['rot','des_x','des_y','des_h','des_w','des_rot']); if (inv) return bad(`campo "${inv}" inválido`);
        if ((isNum(ch.des_h) && ch.des_h <= 0) || (isNum(ch.des_w) && ch.des_w <= 0)) return bad('des_h e des_w (altura e traço do designator) devem ser > 0');
        if (isNum(ch.des_x) !== isNum(ch.des_y)) return bad('des_x e des_y vão juntos (o centro do designator na placa)');
        if (ch.layer != null && ch.layer !== '' && ch.layer !== 'Top' && ch.layer !== 'Bottom')
          return bad(`layer "${ch.layer}" inválida para componente — use Top ou Bottom`);
        const ja = compDe(ch.ref);
        if (ja && !ja.deleted) return bad(`componente "${ch.ref}" já existe na placa — para trocar o footprint, comp_del antes`);
        if (model.comps.some(o => o.eff.designator === ch.ref)) return bad(`designator "${ch.ref}" já é o nome novo de outro componente`);
        const nets = parseNetsCampo(ch.nets);
        if (nets === null) return bad('campo "nets" mal formado — use "pad=net;pad=net" (texto plano)');
        const g = footprintGeom(ch.footprint, B, opts);
        if (!g) return bad(`footprint "${ch.footprint}" não encontrado — nem na pcblib (${((opts && opts.pcblib) || PCBLIB) ? 'carregada' : 'não carregada: HubCore.setPcbLib'}), nem embutido no board.js (footprints), nem em componente da placa`);
        const lado = ch.layer === 'Bottom' ? 'Bottom' : 'Top', rot = isNum(ch.rot) ? normAng(ch.rot) : 0;
        const cid = 'new-c' + (++addSeq);
        const sc = sintetizaComp(g.fp, { ref:ch.ref, footprint:ch.footprint, comment:typeof ch.comment === 'string' ? ch.comment : '',
                                         x:ch.x, y:ch.y, rot, layer:lado, nets,
                                         des:{ x:ch.des_x, y:ch.des_y, h:ch.des_h, w:ch.des_w, rot:ch.des_rot } }, cid);
        const m = { kind:'comp', src:sc.comp, eff:{ x:ch.x, y:ch.y, rot, layer:lado }, changed:false, attrChanged:false, added:true };
        oculto(m, 'pares', pares);
        oculto(m, 'fonte', g.fonte);
        model.comps.push(m); model.compByRef[ch.ref] = m; item.target = m;
        quemPos.set(m, idx);
        for (const s of sc.silk) { model.extra.silk.push(s); model.extra.dono.set(s, m); indexa({ kind:s.kind === 'arc' ? 'arc' : 'track', src:s, fora:'owner' }); }
        for (const t of sc.texts) {
          model.extra.texts.push(t); model.extra.dono.set(t, m);
          const mt = { kind:'text', src:t, eff:copiaEff(t), changed:false, deleted:false };
          model.texts.push(mt); indexa(mt);
        }
        if (!sc.comp.pads.length) warn(`footprint "${ch.footprint}" sem pad nenhum`);
        const nomes = new Set(sc.comp.pads.map(p => String(p.name)));
        const sobra = Object.keys(nets).filter(k => !nomes.has(k));
        if (sobra.length) warn(`nets: pad(s) ${sobra.join(', ')} não existe(m) no footprint ${ch.footprint}`);
        const semNet = temNets ? [...new Set(Object.values(nets).filter(n => n && !netSet.has(n)))] : [];
        if (semNet.length) warn(`net(s) ${semNet.join(', ')} não existe(m) na placa — crie com net_add antes (o ApplyChanges deixa o pad sem net)`);
        break;
      }
      case 'comp_del': {
        const m = compDe(ch.ref);
        if (!m) return bad(`componente "${ch.ref}" não existe no board.js`);
        if (m.deleted) return bad(`componente "${ch.ref}" já foi removido pela mudança #${m.removidoEm + 1}`);
        item.target = m;
        if (!isNum(ch.orig_x)||!isNum(ch.orig_y)||!isNum(ch.orig_rot)||!ch.orig_layer)
          return bad('faltam orig_x/orig_y/orig_rot/orig_layer (copie do board.js)');
        const e = m.eff;
        const fpOk = ch.orig_footprint === undefined || ch.orig_footprint === (m.src.footprint || '');
        if (!conferir(near(ch.orig_x,e.x)&&near(ch.orig_y,e.y)&&nearAng(ch.orig_rot,e.rot)&&ch.orig_layer===e.layer&&fpOk,
                      quemPos.get(m), 'orig_* não confere com o board.js — espelho pode estar desatualizado')) return;
        m.deleted = true; m.removidoEm = idx;
        const i = model.comps.indexOf(m);
        if (i >= 0) model.comps.splice(i, 1);
        model.compsRemovidos.push(m);
        if (!m.added) refsBoardRemovidos.add(m.src.ref);
        break;
      }
      case 'pad_net': {
        const m = compDe(ch.ref);
        if (!m) return bad(`componente "${ch.ref}" não existe no board.js`);
        if (m.deleted) return bad(`componente "${ch.ref}" foi removido pela mudança #${m.removidoEm + 1}`);
        item.target = m;
        if (typeof ch.pad !== 'string' || !ch.pad) return bad('campo "pad" ausente (o nome do pad = o número do pino)');
        if (typeof ch.net !== 'string') return bad('campo "net" ausente ("" tira o pad da net)');
        if (typeof ch.orig_net !== 'string') return bad('falta orig_net (a net atual do pad, copie do board.js; "" = sem net)');
        const pads = (m.src.pads || []).filter(p => p && String(p.name) === ch.pad);
        if (!pads.length) return bad(`pad "${ch.pad}" não existe em ${ch.ref}`);
        const pn = m.padNets || (m.padNets = {});
        const atual = temProp(pn, ch.pad) ? pn[ch.pad] : (pads[0].net || '');
        const qp = quemPad.get(m) || {};
        const mexeu = temProp(qp, ch.pad) ? qp[ch.pad] : (m.added ? quemPos.get(m) : undefined);
        if (!conferir(ch.orig_net === atual || ch.orig_net === netAgora(atual), mexeu, 'orig_net não confere com o board.js — espelho pode estar desatualizado')) return;
        if (temNets && ch.net && !netSet.has(ch.net)) warn(`net "${ch.net}" não existe na placa — crie com net_add antes (o ApplyChanges deixa o pad sem net)`);
        pn[ch.pad] = ch.net;
        qp[ch.pad] = idx; quemPad.set(m, qp);
        m.padChanged = true;
        break;
      }
      case 'net_add': {
        if (typeof ch.net !== 'string' || !ch.net) return bad('campo "net" ausente');
        if (netSet.has(ch.net)) return bad(`net "${ch.net}" já existe na placa`);
        netSet.add(ch.net); model.nets.push(ch.net); netsRemovidas.delete(ch.net); model.netsChanged = true;
        break;
      }
      case 'net_del': {
        if (typeof ch.net !== 'string' || !ch.net) return bad('campo "net" ausente');
        if (!netSet.has(ch.net)) return bad(`net "${ch.net}" não existe na placa`);
        netSet.delete(ch.net); model.nets = model.nets.filter(n => n !== ch.net); netsRemovidas.add(ch.net); model.netsChanged = true;
        break;
      }
      case 'net_rename': {
        if (typeof ch.net !== 'string' || !ch.net) return bad('campo "net" (o nome novo) ausente');
        if (typeof ch.orig_net !== 'string' || !ch.orig_net) return bad('campo "orig_net" (o nome atual) ausente');
        if (!netSet.has(ch.orig_net)) return bad(`net "${ch.orig_net}" não existe na placa`);
        if (ch.net === ch.orig_net) return bad('nome novo igual ao atual');
        if (netSet.has(ch.net)) return bad(`net "${ch.net}" já existe — duas nets com o mesmo nome (para juntar, mova os pads com pad_net)`);
        netSet.delete(ch.orig_net); netSet.add(ch.net);
        model.nets = model.nets.map(n => n === ch.orig_net ? ch.net : n);
        for (const k of Object.keys(model.netsRenomeadas)) if (model.netsRenomeadas[k] === ch.orig_net) model.netsRenomeadas[k] = ch.net;
        model.netsRenomeadas[ch.orig_net] = ch.net; model.netsChanged = true;
        break;
      }
      case 'pad_add': {
        const r = padDaOp(ch, null);
        if (r.erro) return bad(r.erro);
        const m = { kind:'pad', src:null, eff:{ id:'new-p'+(++addSeq), ...r.pad }, changed:false, added:true };
        model.added.push(m); item.target = m;
        r.avisos.forEach(warn);
        if (temNets && m.eff.net && !netSet.has(m.eff.net)) warn(`net "${m.eff.net}" não existe na placa — crie com net_add antes`);
        break;
      }
      case 'pad_edit': case 'pad_del': {
        const casa = s => !!s && near(ch.orig_x,s.x) && near(ch.orig_y,s.y);
        const m = achar(ch.id, 'pad', casa);
        if (m && m.ambiguo) return bad(`pad id "${ch.id}" aparece ${m.ambiguo} vezes no board.js e os orig_* não dizem qual — reexporte o espelho`);
        if (!m) {
          const dono = (B.components || []).find(c => c && (c.pads || []).some(p => p && String(p.id) === String(ch.id)));
          return bad(dono ? `pad id "${ch.id}" é do componente ${dono.ref}: a forma vem do footprint; para a net use pad_net`
                          : `pad id "${ch.id}" não existe no board.js (freepads)`);
        }
        item.target = m;
        if (m.deleted) return removido(m, 'pad');
        if (!isNum(ch.orig_x)||!isNum(ch.orig_y)) return bad('faltam orig_x/orig_y');
        if (!conferir(casa(m.eff), quem.get(m), 'orig_* não confere com o board.js')) return;
        if (ch.op === 'pad_del') { m.deleted = true; quem.set(m, idx); break; }
        const r = padDaOp(ch, m.eff);
        if (r.erro) return bad(r.erro);
        m.eff = { ...m.eff, ...r.pad };
        if (m.eff.shape !== 'roundrect') delete m.eff.radius;
        if (m.eff.drillshape === 'circle') delete m.eff.drillw;
        r.avisos.forEach(warn);
        if (temNets && typeof ch.net === 'string' && ch.net && !netSet.has(ch.net)) warn(`net "${ch.net}" não existe na placa — crie com net_add antes`);
        m.changed = true; quem.set(m, idx);
        break;
      }
      case 'poly_add': {
        const r = polyDaOp(ch, null);
        if (r.erro) return bad(r.erro);
        const m = { kind:'poly', src:null, eff:{ id:'new-pg'+(++addSeq), ...r.poly }, changed:false, deleted:false, added:true };
        if (!m.eff.nome) m.eff.nome = ((pcbLayer(m.eff.layer) || {}).name || m.eff.layer) + '-' + (m.eff.net || 'No Net');
        model.polygons.push(m); item.target = m;
        r.avisos.forEach(warn);
        if (temNets && m.eff.net && !netSet.has(m.eff.net)) warn(`net "${m.eff.net}" não existe na placa — crie com net_add antes`);
        break;
      }
      case 'poly_edit': case 'poly_del': {
        const casa = s => { const p = (s && Array.isArray(s.pts)) ? s.pts : [], p0 = p[0] || [];
                            return !!s && ch.orig_layer===s.layer && ch.orig_n===p.length && near(ch.orig_x0,p0[0]) && near(ch.orig_y0,p0[1]); };
        const m = achar(ch.id, 'poly', casa) || model.polygons.find(p => p.added && p.eff.id === ch.id) || null;
        if (m && m.ambiguo) return bad(`polígono id "${ch.id}" aparece ${m.ambiguo} vezes no board.js e os orig_* não dizem qual`);
        if (!m) return bad(`polígono id "${ch.id}" não existe (board.js » polygons)`);
        item.target = m;
        if (m.deleted) return removido(m, 'polígono');
        if (!ch.orig_layer||!isNum(ch.orig_n)||!isNum(ch.orig_x0)||!isNum(ch.orig_y0))
          return bad('faltam orig_layer/orig_n/orig_x0/orig_y0 (copie do board.js » polygons)');
        if (!conferir(casa(m.eff), quem.get(m), 'orig_* não confere com o board.js')) return;
        if (ch.op === 'poly_del') { m.deleted = true; quem.set(m, idx); break; }
        const r = polyDaOp(ch, m.eff);
        if (r.erro) return bad(r.erro);
        m.eff = r.poly;
        r.avisos.forEach(warn);
        if (temNets && typeof ch.net === 'string' && ch.net && !netSet.has(ch.net)) warn(`net "${ch.net}" não existe na placa — crie com net_add antes`);
        m.changed = true; quem.set(m, idx);
        break;
      }
      case 'stack_set': {
        /* A PILHA DE CAMADAS DO HUB (pedido do dono, 2026-10-29: "fácil de adicionar ou remover layers e
           configurar a espessura"): as de cobre na ordem fisica, de Top a Bottom, cada uma com o cobre e o
           dieletrico abaixo dela; mech = as mecanicas que a placa tem. A ultima stack_set do arquivo vale.
           Tirar camada que ainda tem objeto e erro (conferido no fim, com a placa inteira) */
        const r = stackDaOp(ch);
        if (r.erro) return bad(r.erro);
        model.stack = r.stack; oculto(model, 'stackItem', item);
        r.avisos.forEach(warn);
        break;
      }
      default:
        bad(`operação desconhecida "${ch.op}"`);
    }
  });
  /* a pilha nao tira camada com objeto: trilha, arco, fill, regiao, texto, poligono ou via que passe nela */
  if (model.stack) {
    const fica = new Set(model.stack.layers.map(l => l.key).concat(model.stack.mech || []));
    const tirada = k => typeof k === 'string' && ((/^Mid\d+$/.test(k) && !fica.has(k)) || (model.stack.mech && /^Mech\d+$/.test(k) && !fica.has(k)));
    const conta = new Map(), ve = k => { if (tirada(k)) conta.set(k, (conta.get(k) || 0) + 1); };
    for (const list of [model.tracks, model.arcs, model.fills, model.regions, model.texts, model.polygons, model.pads])
      for (const m of list) if (!m.deleted && m.eff) ve(m.eff.layer);
    for (const m of model.vias) if (!m.deleted && m.eff) { ve(m.eff.from); ve(m.eff.to); }
    for (const m of model.added) if (m.eff) { ve(m.eff.layer); if (m.kind === 'via') { ve(m.eff.from); ve(m.eff.to); } }
    for (const c of (B.components || [])) for (const p of ((c && c.pads) || [])) if (p) ve(p.layer);
    if (conta.size) {
      const it = model.stackItem, lista = [...conta].map(([k, n]) => k + ' (' + n + ')').join(', ');
      const msg = 'a pilha tira camada que ainda tem objeto: ' + lista + ' — mova ou apague o que está nela antes';
      if (it) { it.status = 'err'; it.msg = msg; model.validation.push({ level:'err', msg:`#${it.idx + 1} stack_set: ${msg}`, target:null }); }
      model.stack = null;
    }
  }
  /* Trilha de cobre que foi para outra camada nao leva a net junto: o eff fica com o que a
     placa e. Feito no fim (e nao no edit) para que dois edits encadeados -- Top -> Overlay e
     depois Overlay -> Top -- devolvam a net original em vez de perde-la no meio do caminho. */
  for (const list of [model.tracks, model.arcs, model.fills])
    for (const m of list) if (m.changed && !isCopper(m.eff.layer) && m.eff.net) delete m.eff.net;
  model.netsRemovidas = [...netsRemovidas].filter(n => !netSet.has(n));
  oculto(model, 'netSet', netSet);
  /* rede de seguranca do comp_attr: nome repetido que a simulacao nao previu (cadeia torta de
     renames recusados) vira erro na ultima op que renomeou para ele */
  const porNome = new Map();
  for (const m of model.comps) { const n = m.eff.designator || m.src.ref; porNome.set(n, (porNome.get(n) || 0) + 1); }
  for (const it of model.changeItems)
    if (it.ch && it.ch.op === 'comp_attr' && it.status !== 'err' && it.target && it.target.eff.designator &&
        it.target.eff.designator !== it.target.src.ref && porNome.get(it.target.eff.designator) > 1 &&
        quemAttr.get(it.target) === it.idx) {
      it.status = 'err'; it.msg = `designator "${it.target.eff.designator}" fica repetido — dois componentes com o mesmo nome`;
      model.validation.push({ level:'err', msg:`#${it.idx+1} comp_attr: ${it.msg}`, target:it.target });
    }
  return model;
}

/* ---- componente movido/virado: a conta UNICA (tela, effectiveBoard, Gerber) ----

   Convencao do Altium, MEDIDA em 2026-10-02 nos board.js do workspace: 247 de 247 componentes
   de Bottom cujo footprint tambem aparece no Top, e 631 de 632 pads nao redondos, seguem
     Top,    rotacao r: ponto = O + R(r) * local          angulo do pad = r + a
     Bottom, rotacao r: ponto = O + R(r) * Sy * local     angulo do pad = r - a
   (Sy espelha o Y LOCAL do footprint). O ApplyChanges vira a camada e DEPOIS escreve a rotacao
   alvo, entao vale a convencao do estado FINAL, e nao "o que o flip do Altium faz". Do estado
   velho (O, r0) para o novo (N, r1):
     sem flip: p' = N + R(dr)  * (p - O),       dr  = r1 - r0;   angulo a' = a + dr
     flip:     p' = N + R(phi) * Sy * (p - O),  phi = r1 + r0;   angulo a' = phi - a
   -- a mesma formula de Top para Bottom e de Bottom para Top, e ida e volta e identidade.
   Arco no flip: o espelho inverte o sentido, sa' = phi - ea, ea' = phi - sa. Texto no flip: o
   espelho do texto do Altium e o horizontal (le de tras para a frente, em pe: dos designators
   de Bottom espelhados, 182 estao em rot 0 e so 2 em 180), entao a' = phi + 180 - a e o mirror
   inverte. A conta antiga (espelhar o X local e girar dr) so coincidia com esta quando r0 era
   90/270: virar um componente a 0/180 punha os pads girados 180 graus em torno da origem dele
   (44,6 mm de erro no CI1 do DMB, 94,9 mm no CN3 do MID). */
function compDelta(m){
  const r0 = isNum(m.src.rot) ? m.src.rot : 0, r1 = isNum(m.eff.rot) ? m.eff.rot : r0;
  const dr = r1 - r0;
  const flip = m.eff.layer !== m.src.layer;
  const phi = flip ? r1 + r0 : dr;
  /* seno/cosseno exatos nos multiplos de 90 (sem o 6e-17 do Math.cos) */
  const ex = v => Math.abs(v) < 1e-12 ? 0 : Math.abs(Math.abs(v) - 1) < 1e-12 ? Math.sign(v) : v;
  const d = { ox:m.src.x, oy:m.src.y, nx:m.eff.x, ny:m.eff.y, dr, flip, phi,
              cos:ex(Math.cos(phi*Math.PI/180)), sin:ex(Math.sin(phi*Math.PI/180)) };
  if (m.pares) Object.defineProperty(d, 'pares', { value:m.pares, writable:true, configurable:true, enumerable:false });
  return d;
}
function xfPoint(d, x, y){
  let lx = x - d.ox, ly = y - d.oy;
  if (d.flip) ly = -ly;
  return { x: d.nx + lx*d.cos - ly*d.sin, y: d.ny + lx*d.sin + ly*d.cos };
}
/* a volta do xfPoint: do lugar efetivo para o referencial do board.js (quem arrasta um objeto
   de componente movido precisa dela para escrever a op no lugar de antes do componente andar) */
function xfPointInv(d, x, y){
  const lx = x - d.nx, ly = y - d.ny;
  const rx = lx*d.cos + ly*d.sin, ry = -lx*d.sin + ly*d.cos;
  return { x: d.ox + rx, y: d.oy + (d.flip ? -ry : ry) };
}
/* angulo de pad, fill ou trilha (simetricos no espelho); texto tem conta propria (xfTextObj) */
const phiOf = d => isNum(d.phi) ? d.phi : d.dr;
function xfAngle(d, ang){ return d.flip ? (phiOf(d) - ang) : (ang + d.dr); }
/* arco de um componente movido: centro por xfPoint; no flip o espelho inverte o sentido, entao
   inicio e fim trocam de lugar */
function xfArc(d, a){
  const c = xfPoint(d, a.cx, a.cy);
  return d.flip ? { cx:c.x, cy:c.y, sa:phiOf(d) - a.ea, ea:phiOf(d) - a.sa }
                : { cx:c.x, cy:c.y, sa:a.sa + d.dr, ea:a.ea + d.dr };
}
const compOf = (model, ref) => (model && ref != null && temProp(model.compByRef, String(ref))) ? model.compByRef[String(ref)] : null;
function ownerDelta(model, ref){
  if (!ref) return null;
  const m = compOf(model, ref);
  if (!m || !m.changed) return null;
  return compDelta(m);
}
/* a camada de um objeto do componente depois do flip (com os pares mecanicos da placa) */
function effLayerForOwner(model, ref, layer){
  const m = ref ? compOf(model, ref) : null;
  if (!m || !m.changed) return layer;
  if (m.eff.layer === m.src.layer) return layer;
  return flipIn(m.pares || (model && model.pares), layer);
}
const flipBy = (d, key) => flipIn(d && d.pares, key);

/* ============ PCB: a placa efetiva (board + changes assados), no formato do board.js ============

   E o que o Gerber (e qualquer saida futura: PDF, desenho de montagem) consome sem saber que
   changes existem. Regras:
   - componente: x/y/rot/layer efetivos (rot em [0,360)), ref = designator efetivo, comment
     efetivo; pads e bbox transformados (compDelta: a convencao do Altium acima; camada pelo par
     no flip; no flip o pad troca a pilha de cima pela de baixo -- w/h/shape com bw/bh/bshape, ou
     com o objeto `bot` -- e tentTop com tentBot; o holerot, que e relativo ao pad (medido no
     CN1 do DMB), e o hoy do furo deslocado, no referencial do pad, trocam de sinal);
   - objeto com owner (silk, linha, fill, region, recorte, texto, trilha/arco de cobre do
     footprint): transformado pelo ownerDelta do dono; o livre sai do eff; removido nao sai;
     adicionado sai;
   - trilha/arco: o que nao mudou sai no array de onde veio, identico; o que mudou (ou andou com
     o componente) e o adicionado vao para o array da camada EFETIVA: cobre -> tracks/arcs
     (keepout:true incluso -- contrato secao 2: ele FICA no array de cobre e quem gera cobre o
     pula), overlay -> silk, resto -> lines; silk/lines levam kind 'line'|'arc' e nao levam net,
     cobre leva net (vazia se nao tinha);
   - texto: designator/comment com o texto efetivo (a mesma regra da tela); dono renomeado por
     comp_attr leva o owner novo junto. O contorno exato do Altium (polys) e a ancora (ax/ay)
     andam com o texto quando so a posicao muda; quando muda o desenho (texto, altura,
     espessura, rotacao, espelho, fonte) eles saem, e quem desenha cai na HubFont;
   - outline efetivo; board.bbox recalculado quando o contorno mudou; cutouts + region_add com
     cutout:true; nets/layers/rules e campos desconhecidos copiados; stats recontado.
   Coordenada que passou por transformacao sai arredondada em 1e-6 mm e angulo em [0,360); o
   que nao mudou sai identico ao board.js. O objeto devolvido e todo novo (nada aponta para o
   board), e passa-lo de novo por applyPcbChanges(eb, []) + effectiveBoard da a MESMA placa.
   `model` tem de ter saido de applyPcbChanges(board, ...) com ESTE objeto board (o modelo
   guarda de onde saiu); sem model, vale applyPcbChanges(board, []). */
const r6 = v => { const x = Math.round(v * 1e6) / 1e6; return x === 0 ? 0 : x; };
function normAng(a){ const v = r6(((a % 360) + 360) % 360); return v >= 360 ? 0 : v; }
function dcopy(v){
  if (Array.isArray(v)) return v.map(dcopy);
  if (v && typeof v === 'object') { const o = {}; for (const k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = dcopy(v[k]); return o; }
  return v;
}
/* arco cheio continua cheio (0..360); o resto normaliza as duas pontas */
function arcAngOut(orig, sa, ea){
  const cheio = Math.abs(orig.ea - orig.sa) >= 360 - 1e-9 || (orig.ea !== orig.sa && normAng(orig.ea) === normAng(orig.sa));
  return cheio ? [0, 360] : [normAng(sa), normAng(ea)];
}
function swapKeys(o, a, b){
  const ha = Object.prototype.hasOwnProperty.call(o, a), hb = Object.prototype.hasOwnProperty.call(o, b);
  const va = o[a], vb = o[b];
  if (hb) o[a] = vb; else delete o[a];
  if (ha) o[b] = va; else delete o[b];
}
const xfPt6 = (d, p) => { if (!Array.isArray(p) || !isNum(p[0]) || !isNum(p[1])) return p; const q = xfPoint(d, p[0], p[1]); return [r6(q.x), r6(q.y)]; };
function xfBox(d, b){
  const c = [[b.x1, b.y1], [b.x2, b.y1], [b.x2, b.y2], [b.x1, b.y2]].map(p => xfPoint(d, p[0], p[1]));
  return { x1:r6(Math.min(...c.map(p => p.x))), y1:r6(Math.min(...c.map(p => p.y))),
           x2:r6(Math.max(...c.map(p => p.x))), y2:r6(Math.max(...c.map(p => p.y))) };
}
function xfPad(d, p){
  const o = dcopy(p);
  if (isNum(p.x) && isNum(p.y)) { const q = xfPoint(d, p.x, p.y); o.x = r6(q.x); o.y = r6(q.y); }
  if (isNum(p.rot)) o.rot = normAng(xfAngle(d, p.rot));
  if (d.flip) {
    if (typeof p.layer === 'string') o.layer = flipBy(d, p.layer);
    /* a pilha do pad: o que era de cima vai para baixo, nas duas grafias do contrato */
    if ('bw' in o) swapKeys(o, 'w', 'bw');
    if ('bh' in o) swapKeys(o, 'h', 'bh');
    if ('bshape' in o) swapKeys(o, 'shape', 'bshape');
    if (o.bot && typeof o.bot === 'object' && !Array.isArray(o.bot))
      for (const k of ['w', 'h', 'shape', 'radius']) if (Object.prototype.hasOwnProperty.call(o.bot, k)) {
        const temCima = Object.prototype.hasOwnProperty.call(o, k), vc = o[k];
        o[k] = o.bot[k];
        if (temCima) o.bot[k] = vc; else delete o.bot[k];
      }
    if ('tentTop' in o || 'tentBot' in o) swapKeys(o, 'tentTop', 'tentBot');
    if (isNum(p.holerot)) o.holerot = normAng(-p.holerot);
    /* furo deslocado (hox/hoy: XPadOffset/YPadOffset no referencial do pad, antes da rotacao):
       o espelho do flip inverte o Y local do pad */
    if (isNum(p.hoy)) o.hoy = p.hoy === 0 ? 0 : -p.hoy;
  }
  return o;
}
/* objeto de linha/arco (trilha, silk, linha) de um componente movido, no lugar */
function xfLineObj(d, o, isArc){
  if (isArc) {
    const a = xfArc(d, o), ang = arcAngOut(o, a.sa, a.ea);
    o.cx = r6(a.cx); o.cy = r6(a.cy); o.sa = ang[0]; o.ea = ang[1];
  } else {
    const p1 = xfPoint(d, o.x1, o.y1), p2 = xfPoint(d, o.x2, o.y2);
    o.x1 = r6(p1.x); o.y1 = r6(p1.y); o.x2 = r6(p2.x); o.y2 = r6(p2.y);
  }
  if (d.flip && typeof o.layer === 'string') o.layer = flipBy(d, o.layer);
}
/* fill: x1..y2 sao os cantos SEM rotacao e rot gira em torno do centro -- o centro anda,
   o tamanho fica, a rotacao segue o xfAngle (no flip o retangulo espelhado e o mesmo retangulo) */
function xfFillObj(d, o){
  const hw = (o.x2 - o.x1) / 2, hh = (o.y2 - o.y1) / 2;
  const q = xfPoint(d, (o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2);
  o.x1 = r6(q.x - hw); o.x2 = r6(q.x + hw); o.y1 = r6(q.y - hh); o.y2 = r6(q.y + hh);
  o.rot = normAng(xfAngle(d, isNum(o.rot) ? o.rot : 0));
  if (d.flip && typeof o.layer === 'string') o.layer = flipBy(d, o.layer);
}
function xfRegionObj(d, o){
  if (Array.isArray(o.points)) o.points = o.points.map(p => xfPt6(d, p));
  if (Array.isArray(o.holes)) o.holes = o.holes.map(h => Array.isArray(h) ? h.map(p => xfPt6(d, p)) : h);
  if (d.flip && typeof o.layer === 'string') o.layer = flipBy(d, o.layer);
}
/* texto: x,y (centro do bbox), a ancora ax/ay e o contorno exato (polys) andam como pontos; o
   angulo segue a conta do texto (no flip: phi + 180 - a, ver a nota do compDelta); no flip o
   espelho inverte e a camada vira */
function xfTextObj(d, o){
  if (isNum(o.x) && isNum(o.y)) { const q = xfPoint(d, o.x, o.y); o.x = r6(q.x); o.y = r6(q.y); }
  if (isNum(o.ax) && isNum(o.ay)) { const q = xfPoint(d, o.ax, o.ay); o.ax = r6(q.x); o.ay = r6(q.y); }
  if (Array.isArray(o.polys))
    o.polys = o.polys.map(pl => (pl && Array.isArray(pl.pts)) ? { ...pl, pts: pl.pts.map(p => xfPt6(d, p)) } : pl);
  if (isNum(o.rot)) o.rot = normAng(d.flip ? (phiOf(d) + 180 - o.rot) : (o.rot + d.dr));
  if (d.flip) { o.mirror = !o.mirror; if (typeof o.layer === 'string') o.layer = flipBy(d, o.layer); }
}
/* Um objeto de componente no lugar efetivo, para quem desenha nao reimplementar a conta:
   d = compDelta(m) ou ownerDelta(model, ref) (null = componente parado: devolve so a copia);
   kind = 'pad' | 'line' (ou 'track': trilha, silk ou linha) | 'arc' | 'fill' | 'region' |
   'text'. Devolve uma COPIA no formato do board.js (x/y arredondados em 1e-6, angulo em
   [0,360), camada virada no flip, pilha do pad trocada) -- o mesmo que o effectiveBoard() poe
   na placa efetiva. Kind desconhecido e erro de programa: lanca TypeError em vez de devolver o
   objeto parado sem avisar. */
const XF_KINDS = { pad:1, line:1, track:1, arc:1, fill:1, region:1, text:1 };
function xfObject(d, o, kind){
  if (typeof kind !== 'string' || !temProp(XF_KINDS, kind))
    throw new TypeError(`xfObject: kind "${kind}" desconhecido (use pad, line/track, arc, fill, region ou text)`);
  if (!o || typeof o !== 'object') return o;
  if (!d) return dcopy(o);
  if (kind === 'pad') return xfPad(d, o);
  const c = dcopy(o);
  if (kind === 'line' || kind === 'track') xfLineObj(d, c, false);
  else if (kind === 'arc') xfLineObj(d, c, true);
  else if (kind === 'fill') xfFillObj(d, c);
  else if (kind === 'region') xfRegionObj(d, c);
  else xfTextObj(d, c);
  return c;
}
/* caixa do contorno; arco conta pelos extremos que ele de fato varre (sentido anti-horario) */
function outlineBBox(segs){
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  const pt = (x, y) => { if (isNum(x) && isNum(y)) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); } };
  for (const s of (segs || [])) {
    if (!s) continue;
    if (s.kind === 'arc') {
      if (!isNum(s.cx) || !isNum(s.cy) || !isNum(s.r) || !isNum(s.sa) || !isNum(s.ea)) continue;
      const sa = normAng(s.sa), sw0 = (((s.ea - s.sa) % 360) + 360) % 360;
      const sw = (Math.abs(s.ea - s.sa) >= 360 || (sw0 === 0 && s.ea !== s.sa)) ? 360 : sw0;
      const at = g => pt(s.cx + s.r * Math.cos(g * Math.PI / 180), s.cy + s.r * Math.sin(g * Math.PI / 180));
      at(sa); at(sa + sw);
      for (let q = 0; q < 720; q += 90) if (q > sa && q < sa + sw) at(q);
    } else { pt(s.x1, s.y1); pt(s.x2, s.y2); }
  }
  if (x1 > x2) return null;
  return { x1:r6(x1), y1:r6(y1), x2:r6(x2), y2:r6(y2) };
}
const EB_ARRAYS = ['components', 'freepads', 'tracks', 'arcs', 'vias', 'texts', 'silk', 'lines', 'fills', 'regions', 'cutouts'];
/* o que muda o DESENHO de um texto (e invalida o contorno exato que veio do Altium); o texto
   em si e conferido a parte (no designator/comment, o que conta e o comp_attr ter mudado) */
const TEXTO_FORMA = ['h', 'w', 'rot', 'mirror', 'kind', 'font', 'fontname', 'bold', 'italic', 'inverted'];

function effectiveBoard(board, model){
  const B = board || {};
  const M = model || applyPcbChanges(board, []);
  /* o modelo guarda de que objeto board saiu; um model de OUTRO board faria as mudancas
     sumirem caladas. Modelo sem essa marca (copia por spread, feito a mao) cai na conferencia
     por identidade: todo src do modelo tem de ser um objeto deste board. */
  let outro;
  if (temProp(M, 'board')) outro = M.board !== board;
  else {
    const doB = new Set();
    for (const k of ['components', 'tracks', 'arcs', 'vias', 'texts', 'silk', 'lines', 'fills', 'regions'])
      for (const o of (Array.isArray(B[k]) ? B[k] : [])) if (o) doB.add(o);
    outro = [M.comps, M.tracks, M.arcs, M.vias, M.texts, M.fills || [], M.regions || []]
      .some(list => list.some(m => m.src && !doB.has(m.src)));
  }
  if (outro) throw new Error('effectiveBoard: o model não foi gerado deste board (use applyPcbChanges com o mesmo objeto)');

  const out = {};
  for (const k of Object.keys(B)) if (k !== 'board' && k !== 'stats' && EB_ARRAYS.indexOf(k) < 0) out[k] = dcopy(B[k]);
  const compOfRef = ref => compOf(M, ref);
  const deltaOf = ref => compOfRef(ref) ? ownerDelta(M, ref) : null;
  const mOf = new Map();
  for (const list of [M.tracks, M.arcs, M.vias, M.texts, M.fills || [], M.regions || []])
    for (const m of list) if (m.src) mOf.set(m.src, m);

  /* comp_attr que trocou o designator: o owner dos objetos do componente acompanha */
  const ren = Object.create(null);
  for (const m of M.comps) {
    const nd = m.eff.designator;
    if (typeof nd === 'string' && nd && nd !== m.src.ref) ren[m.src.ref] = nd;
  }
  const dono = o => { if (o && typeof o.owner === 'string' && o.owner in ren) o.owner = ren[o.owner]; return o; };
  /* comp_del: o que tinha owner num componente DO BOARD removido sai da placa efetiva; o que o
     comp_add sintetizou (M.extra) sai com o componente dele */
  const removidos = new Set();
  for (const m of (M.compsRemovidos || [])) if (!m.added && m.src) removidos.add(m.src.ref);
  const morto = o => !!(o && typeof o.owner === 'string' && removidos.has(o.owner));
  const EX = M.extra || { silk:[], texts:[], dono:new Map() };
  const extraVivo = list => (list || []).filter(o => { const d = EX.dono.get(o); return !(d && d.deleted); });

  /* componentes */
  const components = [];
  for (const m of M.comps) {
    const s = m.src, e = m.eff, c = dcopy(s);
    if (m.changed) {
      const d = compDelta(m);
      c.x = e.x; c.y = e.y; c.rot = isNum(e.rot) ? normAng(e.rot) : e.rot; c.layer = e.layer;
      if (s.bbox && isNum(s.bbox.x1) && isNum(s.bbox.y1) && isNum(s.bbox.x2) && isNum(s.bbox.y2)) c.bbox = xfBox(d, s.bbox);
      if (Array.isArray(s.pads)) c.pads = s.pads.map(p => p ? xfPad(d, p) : p);
    }
    if (typeof e.designator === 'string' && e.designator) c.ref = e.designator;
    if (e.comment !== undefined) c.comment = e.comment;
    /* pad_net: a net nova vale em todo pad com aquele nome */
    if (m.padNets && Array.isArray(c.pads))
      for (const p of c.pads) if (p && temProp(m.padNets, String(p.name))) p.net = m.padNets[String(p.name)];
    components.push(c);
  }

  /* trilhas, arcos, silk e linhas */
  const dest = { tracks:[], arcs:[], silk:[], lines:[] };
  const destino = (o, isArc) => {
    const L = pcbLayer(o.layer), kind = L ? L.kind : '';
    return (kind === 'signal' || kind === 'plane') ? (isArc ? 'arcs' : 'tracks') : (kind === 'overlay' ? 'silk' : 'lines');
  };
  const emite = (o, isArc) => {
    const k = destino(o, isArc);
    if (k === 'tracks' || k === 'arcs') { delete o.kind; if (typeof o.net !== 'string') o.net = ''; }
    else { o.kind = isArc ? 'arc' : 'line'; if (!isCopper(o.layer)) delete o.net; }
    dest[k].push(dono(o));
  };
  const linhaDe = (src, isArc, origem0) => {
    /* 'extra' = serigrafia sintetizada pelo comp_add: vai para o silk, e nao e do board */
    const origem = origem0 === 'extra' ? 'silk' : origem0;
    /* kind que o motor nao conhece (nem line nem arc) atravessa intacto, no array de onde veio */
    if (origem && src.kind && src.kind !== 'line' && src.kind !== 'arc') { dest[origem].push(dono(dcopy(src))); return; }
    const m = mOf.get(src);
    if (m && m.deleted) return;
    if (origem0 !== 'extra' && morto(src)) return;
    const d = src.owner ? deltaOf(src.owner) : null;
    /* intocado: identico, no array de onde veio (o board.js e a verdade) */
    if (!d && !(m && m.changed)) { dest[origem || (isArc ? 'arcs' : 'tracks')].push(dono(dcopy(src))); return; }
    const o = dcopy(m ? m.eff : src);
    if (d) xfLineObj(d, o, isArc);
    emite(o, isArc);
  };
  for (const t of (B.tracks || [])) if (t) linhaDe(t, false);
  for (const a of (B.arcs || [])) if (a) linhaDe(a, true);
  for (const s of (B.silk || [])) if (s) linhaDe(s, s.kind === 'arc', 'silk');
  for (const s of (B.lines || [])) if (s) linhaDe(s, s.kind === 'arc', 'lines');
  for (const s of extraVivo(EX.silk)) linhaDe(s, s.kind === 'arc', 'extra');
  for (const m of M.added) {
    const e = m.eff;
    if (m.kind === 'track') {
      const o = { id:e.id, layer:e.layer, x1:e.x1, y1:e.y1, x2:e.x2, y2:e.y2, w:e.w };
      if (typeof e.net === 'string') o.net = e.net;
      emite(o, false);
    } else if (m.kind === 'arc') {
      const o = { id:e.id, layer:e.layer, cx:e.cx, cy:e.cy, r:e.r, sa:e.sa, ea:e.ea, w:e.w };
      if (typeof e.net === 'string') o.net = e.net;
      emite(o, true);
    }
  }

  /* vias */
  const vias = [];
  for (const v of (B.vias || [])) {
    if (!v) continue;
    const m = mOf.get(v);
    if (m && m.deleted) continue;
    vias.push(dcopy(m ? m.eff : v));
  }
  for (const m of M.added) if (m.kind === 'via') {
    const e = m.eff;
    vias.push({ id:e.id, x:e.x, y:e.y, size:e.size, drill:e.drill, from:e.from || 'Top', to:e.to || 'Bottom',
                net: typeof e.net === 'string' ? e.net : '' });
  }

  /* textos: designator/comment com o texto efetivo (a mesma regra do desenho da tela) */
  const igual = (a, b) => (isNum(a) && isNum(b)) ? Math.abs(a - b) < 1e-9 : a === b;
  const contorno = (o, src, textoMudou) => {
    if (!Array.isArray(o.polys) && !isNum(o.ax) && !isNum(o.ay)) return;
    if (textoMudou || TEXTO_FORMA.some(k => !igual(o[k], src[k]))) { delete o.polys; delete o.ax; delete o.ay; return; }
    const dx = isNum(o.x) && isNum(src.x) ? o.x - src.x : 0, dy = isNum(o.y) && isNum(src.y) ? o.y - src.y : 0;
    if (!dx && !dy) return;
    const anda = p => (Array.isArray(p) && isNum(p[0]) && isNum(p[1])) ? [r6(p[0] + dx), r6(p[1] + dy)] : p;
    if (isNum(o.ax)) o.ax = r6(o.ax + dx);
    if (isNum(o.ay)) o.ay = r6(o.ay + dy);
    if (Array.isArray(o.polys)) o.polys = o.polys.map(pl => (pl && Array.isArray(pl.pts)) ? { ...pl, pts: pl.pts.map(anda) } : pl);
  };
  const texts = [];
  for (const x of (B.texts || []).concat(extraVivo(EX.texts))) {
    if (!x) continue;
    const m = mOf.get(x);
    if (m && m.deleted) continue;
    if (!EX.dono.has(x) && morto(x)) continue;
    const o = dcopy(m ? m.eff : x);
    const oc = compOfRef(x.owner);
    /* o texto do designator/comment e o do componente; o contorno so cai se o comp_attr o mudou
       (o ".Designator" cru de espelho antigo virando o ref nao e mudanca de desenho) */
    let textoMudou = o.text !== x.text;
    if (oc && x.designator) { o.text = oc.eff.designator || oc.src.ref; textoMudou = !!oc.eff.designator && oc.eff.designator !== oc.src.ref; }
    if (oc && x.comment) { o.text = oc.eff.comment !== undefined ? oc.eff.comment : (oc.src.comment || o.text);
                           textoMudou = oc.eff.comment !== undefined && oc.eff.comment !== (oc.src.comment || ''); }
    contorno(o, x, textoMudou);
    const d = x.owner ? deltaOf(x.owner) : null;
    if (d) xfTextObj(d, o);
    texts.push(dono(o));
  }
  for (const m of M.added) if (m.kind === 'text') {
    const e = m.eff;
    texts.push({ id:e.id, layer:e.layer, x:e.x, y:e.y, text:e.text, h:e.h, rot:isNum(e.rot) ? e.rot : 0,
                 mirror:e.mirror === true, designator:false, comment:false, w:e.w, kind:'stroke' });
  }

  /* fills, regions e recortes */
  const fills = [];
  for (const f of (B.fills || [])) {
    if (!f || morto(f)) continue;
    const m = mOf.get(f);
    if (m && m.deleted) continue;
    const o = dcopy(m ? m.eff : f);
    const d = f.owner ? deltaOf(f.owner) : null;
    if (d) xfFillObj(d, o);
    fills.push(dono(o));
  }
  for (const m of M.added) if (m.kind === 'fill') {
    const e = m.eff;
    const o = { id:e.id, layer:e.layer, x1:e.x1, y1:e.y1, x2:e.x2, y2:e.y2, rot:isNum(e.rot) ? e.rot : 0 };
    if (isCopper(o.layer)) o.net = typeof e.net === 'string' ? e.net : '';
    fills.push(o);
  }
  const regions = [];
  for (const g of (B.regions || [])) {
    if (!g || morto(g)) continue;
    const m = mOf.get(g);
    if (m && m.deleted) continue;
    const o = dcopy(m ? m.eff : g);
    const d = g.owner ? deltaOf(g.owner) : null;
    if (d) xfRegionObj(d, o);
    regions.push(dono(o));
  }
  const cutouts = [];
  for (const k of (Array.isArray(B.cutouts) ? B.cutouts : [])) {
    if (morto(k)) continue;
    const o = dcopy(k);
    const d = (k && k.owner) ? deltaOf(k.owner) : null;
    if (d) xfRegionObj(d, o);
    cutouts.push(dono(o));
  }
  for (const m of M.added) if (m.kind === 'region') {
    const e = m.eff, pts = dcopy(e.points);
    if (e.cutout) cutouts.push({ id:e.id, layer:'Multi', incomp:false, points:pts });
    else if (e.polycut) cutouts.push({ id:e.id, layer:e.layer, kindn:1, incomp:false, points:pts });
    else {
      const o = { id:e.id, layer:e.layer, net:typeof e.net === 'string' ? e.net : '', points:pts };
      if (!isCopper(o.layer)) delete o.net;
      regions.push(o);
    }
  }

  /* contorno e caixa da placa */
  const bd = dcopy((B.board && typeof B.board === 'object') ? B.board : {});
  bd.outline = dcopy(M.outline || []);
  if (M.outlineChanged || !bd.bbox) { const bb = outlineBBox(bd.outline); if (bb) bd.bbox = bb; }

  out.board = bd;
  out.components = components;
  /* pads soltos: o do board (editado ou nao, sem o removido) e os do pad_add */
  const padM = new Map();
  for (const m of (M.pads || [])) if (m.src) padM.set(m.src, m);
  out.freepads = [];
  for (const p of (Array.isArray(B.freepads) ? B.freepads : [])) {
    const m = p ? padM.get(p) : null;
    if (m && m.deleted) continue;
    out.freepads.push(dcopy(m && m.changed ? m.eff : p));
  }
  for (const m of M.added) if (m.kind === 'pad') out.freepads.push(dcopy(m.eff));
  out.tracks = dest.tracks; out.arcs = dest.arcs; out.vias = vias; out.texts = texts;
  out.silk = dest.silk; out.lines = dest.lines; out.fills = fills; out.regions = regions; out.cutouts = cutouts;
  const st = dcopy((B.stats && typeof B.stats === 'object') ? B.stats : {});
  for (const k of EB_ARRAYS) st[k] = out[k].length;
  out.stats = st;
  /* polygon pour: a DEFINICAO (board.js » polygons, poly_add/poly_edit/poly_del). Sai sempre,
     vazio quando a placa nao tem -- o despejo (hub-pcbpour) le daqui */
  out.polygons = [];
  if (Array.isArray(M.polygons) && M.polygons.length) {
    for (const m of M.polygons) if (!m.deleted) out.polygons.push(dcopy(m.changed || m.added ? m.eff : m.src));
  } else if (Array.isArray(B.polygons)) out.polygons = dcopy(B.polygons);
  /* nets: a lista efetiva e, com net_rename/net_del, a net de cada objeto acompanha (renomeada
     segue o nome novo; removida fica sem net) -- so quando houve op de net, para o resto sair
     identico ao board.js */
  if (M.netsChanged) {
    out.nets = (M.nets || []).slice();
    const ok = new Set(out.nets);
    const ag = typeof M.netAgora === 'function' ? M.netAgora : (n => n);
    const mapa = o => { if (o && typeof o.net === 'string' && o.net && !ok.has(o.net)) { const n = ag(o.net); if (n !== o.net) o.net = n; } };
    for (const k of ['tracks', 'arcs', 'vias', 'fills', 'regions', 'freepads', 'polygons']) for (const o of out[k]) mapa(o);
    for (const c of out.components) for (const p of (c.pads || [])) mapa(p);
  }
  if (M.stack) aplicaPilha(out, B, M.stack);
  return out;
}

/* ============ Esquema: libs, transform e extracao de nets (preview) ============ */

/* ══════════ resolucao de nome de biblioteca ══════════
   O espelho e a biblioteca mestra do Altium falam vocabularios diferentes. O RenameLibs
   padronizou 152 simbolos e 170 footprints, mas so no ESPELHO: a .SchLib/.PcbLib de
   verdade continua com os nomes antigos, que sao justamente os que os projetos exportados
   referenciam ("CAP [  SMD  ]" contra "CAP [SMD]"). Projeto escrito DEPOIS do rename
   referencia o nome novo. Os dois vocabularios estao em uso ao mesmo tempo, entao casar
   por igualdade exata condena metade a "ausente" - e ausente aqui nao e um aviso: o
   simbolo vira um quadrado vermelho sem pinos na folha, o componente e pulado inteiro na
   extracao de nets (produzindo net faltando sem dizer nada) e a validacao aborta o resto
   das checagens daquele componente.

   A cascata, em ordem de autoridade:
     1. substituicao escolhida por uma pessoa (Libs/lib-subs.js) - decisao explicita
     2. nome exato
     3. rename-map, UM salto so, nos dois sentidos (antigo->novo e novo->antigo)
     4. chave normalizada, e SO quando ela aponta para um unico item

   O passo 3 e um salto so de proposito: no rename-map "INDUTOR MODO COMUM" e nome novo de
   uma entrada e nome antigo de outra, e encadear seguiria para o item errado.

   O passo 4 se recusa a chutar. Na PcbLib real a chave normalizada junta "SOIC 8" com
   "SOIC - 8", "TO-220AB" com "TO\u2013220AB" (travessao), "CAP EL 2mm L11.5 D5" com o mesmo
   nome de dois espacos e "CONE-TE-1-5745967-0" com "CONE - TE - 1-5745967-0" - 4 pares.
   Escolher um dos dois no chute poe o footprint errado na placa; empate vira `ambiguo` e
   cai no fluxo de substituicao manual, que e onde uma pessoa decide. Nos simbolos a chave
   nao colide (404 nomes, 404 chaves), entao la o passo 4 sempre decide sozinho. */

/* Porte literal da NormKey do RenameLibs.pas:37-56, para JS e Pascal concordarem sobre o
   que e "o mesmo nome". Ela dobra acento por FAIXA DE BYTE Latin-1 (nao por Unicode), e o
   UpCase do Delphi so mexe em a-z ASCII - por isso a minuscula acentuada e pega pelas
   faixas 224-252 e nao por toUpperCase(). Nao troque por NFD+strip: o resultado diverge em
   'sz' (223) e 'y' com trema (255), que a NormKey NAO trata. */
function normKey(s){
  const t = String(s == null ? '' : s);
  let r = '';
  for (let i = 0; i < t.length; i++){
    let c = t.charAt(i);
    if (c >= 'a' && c <= 'z') c = c.toUpperCase();
    const o = c.charCodeAt(0);
    if      ((o >= 192 && o <= 198) || (o >= 224 && o <= 230)) c = 'A';
    else if (o === 199 || o === 231)                           c = 'C';
    else if ((o >= 200 && o <= 203) || (o >= 232 && o <= 235)) c = 'E';
    else if ((o >= 204 && o <= 207) || (o >= 236 && o <= 239)) c = 'I';
    else if (o === 209 || o === 241)                           c = 'N';
    else if ((o >= 210 && o <= 216) || (o >= 242 && o <= 248)) c = 'O';
    else if ((o >= 217 && o <= 220) || (o >= 249 && o <= 252)) c = 'U';
    if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) r += c;
  }
  return r;
}

/* Indice por nome e por chave, montado UMA vez por lista (a lib tem 401 simbolos e 618
   footprints, e o find() linear de antes rodava por componente desenhado). A chave guarda
   TODOS os candidatos - quem decide se um empate pode ser usado e o resolvedor, nao aqui. */
const LIB_IDX = (typeof WeakMap === 'function') ? new WeakMap() : null;
function libIndex(list){
  const arr = list || [];
  if (LIB_IDX && LIB_IDX.has(arr)) return LIB_IDX.get(arr);
  const byName = new Map(), byKey = new Map();
  for (const it of arr){
    if (!it || typeof it.name !== 'string') continue;
    if (!byName.has(it.name)) byName.set(it.name, it);
    const k = normKey(it.name);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(it);
  }
  const idx = { byName, byKey };
  if (LIB_IDX) LIB_IDX.set(arr, idx);
  return idx;
}

/* Tabelas de apelido, que valem para o espelho inteiro e nao para uma chamada: por isso
   moram no modulo e nao viajam em cada symbolOf(). `setLibTables` e chamada uma vez, depois
   que Libs/rename-map.js e Libs/lib-subs.js carregam; sem elas o resolvedor ainda funciona,
   so perde os passos 1 e 3. */
function emptyTables(){
  return { sym:{ subs:{}, fwd:{}, bwd:{} }, fp:{ subs:{}, fwd:{}, bwd:{} } };
}
let LIB_TABLES = emptyTables();

function setLibTables(renameMap, libSubs){
  const t = emptyTables();
  /* `mergeSym`/`mergeFp` entram junto: sao os itens que o RenameLibs julgou REDUNDANTES -
     sairam do espelho e viraram ZZ-OBSOLETO na lib do Altium, mas continuam com o nome
     antigo nos projetos ja exportados. Sem eles, "TO-263-5" e "NMAXXXXSC" ficam ausentes
     mesmo com "DDPAK-5" e "NMA0515SC" vivos no espelho e o proprio mapa dizendo que um
     virou o outro - e a chave normalizada nao junta os dois (TO2635 x DDPAK5). */
  const par = [['sym', ['symRename', 'mergeSym']], ['fp', ['fpRename', 'mergeFp']]];
  for (const [kind, campos] of par){
    for (const campo of campos){
      const m = (renameMap && renameMap[campo]) || {};
      for (const antigo of Object.keys(m)){
        const novo = m[antigo];
        if (typeof novo !== 'string' || !novo) continue;
        if (!(antigo in t[kind].fwd)) t[kind].fwd[antigo] = novo;
        /* o sentido inverso e uma LISTA: dois nomes antigos podem levar ao mesmo novo, e
           um novo com dois antigos VIVOS na lib e ambiguo, nao um palpite */
        (t[kind].bwd[novo] = t[kind].bwd[novo] || []).push(antigo);
      }
    }
  }
  for (const r of (libSubs || [])){
    if (!r || !r.from || !r.to) continue;
    const kind = r.kind === 'fp' ? 'fp' : 'sym';
    t[kind].subs[r.from] = r.to;
  }
  LIB_TABLES = t;
  return t;
}
const libTables = () => LIB_TABLES;

/* Devolve { item, name, how, cands } ou null. `how`: 'escolha' | 'exato' | 'rename' |
   'chave' | 'ambiguo'. Em 'ambiguo' o item vem null de proposito - quem chama tem que
   tratar como nao resolvido e oferecer a escolha, nunca desempatar sozinho. */
/* ============ Sugestao de simbolo (o 5o passo que resolveLib NAO tem) ============

   resolveLib e uma cascata sobre o NOME: escolha do usuario, nome exato, rename-map,
   chave normalizada. Quando o componente vem de outra biblioteca do Altium, o nome nao
   bate com nada e ele fica sem simbolo — 290 de 782 componentes dos projetos reais
   (37%), em 44 nomes distintos.

   Esta parte NAO resolve nada: ela SUGERE, ranqueada, para a pessoa escolher. E de
   proposito. Medindo nos projetos reais, os tres primeiros candidatos empatam com
   frequencia (tres capacitores 0805 100nF diferentes servem igualmente), e escolher
   sozinho um deles gravaria um esquema silenciosamente errado. Quem confirma vira
   escolha em Libs/lib-subs.js, e ai o resolveLib passa a resolver pelo primeiro passo.

   O que o componente do projeto tem: sym, comment, footprint, ref (designador).
   O que o acervo tem: name, description, designator, familia, grupo, categorias e,
   no almoxarifado, valores[] com label/value/mpn/mouser e itens[].nome do Odoo.       */

/* Tokens de uma frase. A quebra e no texto CRU e o normKey vai token a token: normKey
   COLA a frase inteira ("Conector 2 Filas 20pin" -> "CONECTOR2FILAS20PIN"), e um token
   desse tamanho nunca casa com nada. Foi assim que os 120 conectores ficaram sem
   candidato nenhum. */
function frasToks(s, dentro){
  for (const bruto of String(s == null ? '' : s).split(/[^A-Za-z0-9À-ÿ]+/)) {
    if (!bruto) continue;
    const t = normKey(bruto);
    if (t.length > 1) dentro.add(t);
  }
  return dentro;
}

/* Todo texto que identifica um item do acervo, como CONJUNTO de tokens — inclusive o
   nome do produto no Odoo, que e onde mora "Barra de pinos macho 5.08 10 pinos 2 linhas". */
function libToks(it){
  const set = new Set();
  const add = v => { if (v) frasToks(v, set); };
  add(it.name); add(it.description); add(it.familia); add(it.grupo);
  for (const c of (it.categorias || [])) add(c);
  for (const f of (it.footprints || [])) add(f && f.name);
  for (const v of (it.valores || [])) {
    add(v.label); add(v.value); add(v.mpn); add(v.mouser); add(v.footprint);
    for (const i of (v.itens || [])) { add(i.nome); add(i.categoria); }
  }
  return set;
}

/* quantos pinos o item tem somando as partes — e o que separa um CONECTOR 20V de um 6V */
function libPins(it){
  let n = 0;
  for (const pt of (it.parts || [])) n += ((pt.pins || []).length);
  if (!n) for (const v of (it.valores || [])) for (const pt of (v.parts || [])) n += ((pt.pins || []).length);
  return n;
}

const SUG_IDX = (typeof WeakMap === 'function') ? new WeakMap() : null;
function sugIndex(list){
  const arr = list || [];
  if (SUG_IDX && SUG_IDX.has(arr)) return SUG_IDX.get(arr);
  const idx = arr.filter(it => it && typeof it.name === 'string')
                 .map(it => { const toks = libToks(it);
                              /* colado: o acervo escreve "BAT85" e o Altium "BAT 85".
                                 Token exato erra isso; o grudado acha. Vale menos porque
                                 tambem casa pedaco de palavra. */
                              return { it, toks, pins: libPins(it), colado: [...toks].join('') }; });
  if (SUG_IDX) SUG_IDX.set(arr, idx);
  return idx;
}

/* Comment do Altium as vezes e uma FORMULA nao resolvida ("=Value + ' ' + Voltage"):
   parece texto, nao identifica peca nenhuma e envenena a busca. Medido em Cap
   Eletrolitico e Cap Poliester dos projetos reais. */
const FORMULA_RE = /^\s*=|\bValue\b|\bVoltage\b|\bVolts\b/i;
const ehFormula = c => !c || FORMULA_RE.test(String(c));

const sugToks = s => [...frasToks(s, new Set())];
/* numeros soltos no nome/footprint ("2 Filas 20pin", "CONN20_250-710") — um deles
   costuma ser a contagem de pinos */
function sugNums(s){
  const out = [];
  const m = String(s || '').match(/\d+/g) || [];
  for (const x of m) { const n = +x; if (n >= 2 && n <= 200) out.push(n); }
  return out;
}
/* So o MAIOR numero conta como pinagem. Em "CONE FIO 15P - 5.08" os candidatos eram
   15, 5 e 8, e o 5 casava com qualquer peca de 5 pinos do acervo — ruido puro. Em
   "Conector 2 Filas 20pin" e "CONN20_250-710", o maior util e justamente o 20. */
const maiorNum = arr => (arr.length ? Math.max.apply(null, arr) : 0);

/* comp = { sym, comment, footprint, ref }. Devolve os melhores candidatos, cada um com
   `pontos` e `porque` (os motivos em texto, para a UI mostrar em vez de um numero solto). */
function suggestSym(comp, list, opts){
  const o = opts || {};
  const lim = o.limit || 8;
  const c = comp || {};
  const cm = ehFormula(c.comment) ? '' : String(c.comment || '');
  const tc = sugToks(cm), ts = sugToks(c.sym), tf = sugToks(c.footprint);
  const nPinos = maiorNum(sugNums(c.sym).concat(sugNums(c.footprint)));
  const des = String(c.ref || '').replace(/[0-9]+$/, '').toUpperCase();
  const nomeCm = normKey(cm), nomeFp = normKey(c.footprint);
  const colCm = tc.join('');

  const out = [];
  for (const e of sugIndex(list)) {
    let pts = 0; const porque = [];
    const cobre = (toks, peso, rot) => {
      if (!toks.length) return 0;
      const n = toks.filter(t => e.toks.has(t)).length;
      if (!n) return 0;
      const f = n / toks.length;
      pts += peso * f;
      if (f >= 0.5) porque.push(rot + (f < 1 ? ' ' + Math.round(f * 100) + '%' : ''));
      return f;
    };
    cobre(tc, 50, 'comment');
    cobre(ts, 20, 'nome');
    cobre(tf, 12, 'footprint');
    /* o acervo grava "BAT85" e o Altium "BAT 85": sem isto o casamento certo some */
    if (colCm && colCm.length > 3 && e.colado.indexOf(colCm) >= 0) {
      pts += 22; porque.push('comment colado');
    }
    if (nomeCm && normKey(e.it.name) === nomeCm) { pts += 45; porque.push('comment = nome'); }
    if (nomeFp) for (const f of (e.it.footprints || []))
      if (normKey(f && f.name) === nomeFp) { pts += 25; porque.push('mesmo footprint'); break; }
    /* Prefixo INTEIRO, nao prefixo-de-prefixo: "CN1" da "CN", que NAO e o "C" de
       capacitor. Com startsWith, os 120 "Conector 2 Filas 20pin" casavam com CAPACITOR. */
    if (des && e.it.designator && des === String(e.it.designator).toUpperCase()) {
      pts += 10; porque.push('designador ' + e.it.designator);
    }
    /* Pinagem: e o unico sinal para "Conector 2 Filas 20pin", onde o comment repete o
       nome e nenhuma palavra bate com o acervo. Duas travas, aprendidas medindo:
       - so numero >= 4: "2 Filas" casava com toda peca de 2 pinos do acervo;
       - so quando ja ha OUTRO sinal: contagem de pino sozinha nao identifica nada, e
         era assim que "Cone Parafuso" virava "24LC256" (8 pinos, e nada mais em comum). */
    if (e.pins >= 4 && pts > 0 && e.pins === nPinos) {
      pts += 30; porque.push(e.pins + ' pinos');
    }
    if (pts > 0) out.push({ name: e.it.name, item: e.it, pontos: Math.round(pts),
                            porque, especifico: !!e.it.deValor });
  }
  /* Empate e comum e nao e ruido: tres capacitores 0805 100nF servem igualmente. Mas
     entre "SMD BAW56" (o valor) e "DIODO RETIFICADOR [SMD]" (a familia inteira), o valor
     e a resposta — e a peca, nao a gaveta. Por isso o especifico sobe no empate. */
  out.sort((a, b) => (b.pontos - a.pontos)
                  || (b.especifico - a.especifico)
                  || a.name.localeCompare(b.name));
  return out.slice(0, lim);
}

function resolveLib(list, name, kind, tables){
  const nm = String(name == null ? '' : name);
  if (!nm) return null;
  const t = (tables || LIB_TABLES)[kind === 'fp' ? 'fp' : 'sym'] || { subs:{}, fwd:{}, bwd:{} };
  const idx = libIndex(list);
  const hit = (n, how) => ({ item: idx.byName.get(n), name: n, how });

  const escolhido = t.subs[nm];
  if (escolhido && idx.byName.has(escolhido)) return hit(escolhido, 'escolha');
  if (idx.byName.has(nm)) return hit(nm, 'exato');

  const novo = t.fwd[nm];
  if (novo && idx.byName.has(novo)) return hit(novo, 'rename');
  const antigos = (t.bwd[nm] || []).filter(a => idx.byName.has(a));
  if (antigos.length === 1) return hit(antigos[0], 'rename');
  if (antigos.length > 1) return { item:null, name:null, how:'ambiguo', cands:antigos };

  const cand = idx.byKey.get(normKey(nm)) || [];
  if (cand.length === 1) return hit(cand[0].name, 'chave');
  if (cand.length > 1) return { item:null, name:null, how:'ambiguo', cands:cand.map(x => x.name) };
  return null;
}

const resolveSym = (schlib, name, tables) =>
  resolveLib((schlib && schlib.symbols) || [], name, 'sym', tables);
/* As pontas quentes por parte ("1@-200,0 2@200,0|..."): o que liga o fio ao pino. Dois
   simbolos com a mesma assinatura ligam igual na folha, mesmo com desenho diferente. */
function assinaturaPinos(sym){
  return ((sym && sym.parts) || []).slice().sort((a, b) => (a.part || 1) - (b.part || 1))
    .map(pt => (pt.pins || []).map(p => { const h = pinHot(p); return p.num + '@' + h.x + ',' + h.y; }).sort().join(' '))
    .join('|');
}
/* OS SIMBOLOS GUARDADOS NO ESQUEMA (`schematic.symbols`: a copia que o .SchDoc traz em cada
   componente, ou o que a IA gravou com sym_salvar destino "projeto"). Entram SO os nomes que
   nenhum acervo resolve (deixam de ser quadrado vermelho): a biblioteca da casa continua
   mandando. Quem a biblioteca resolve com OUTRAS pontas de pino vai para `divergentes` (e para
   o Map `schlib.divergentes`, que a validacao le), sem trocar nada: a copia nao e prova de qual
   desenho a folha usa. Medido no PRJ-UR-DI261924: com o "RES [SMD]" da biblioteca 22 dos 26
   pinos dos "Res SMD 1206" encostam em fio; com a copia (pontas em +-200), so 7 -- e o BC337
   da copia numera B/C/E onde o footprint tem 1/2/3. A validacao conta os dois lados e diz qual
   os fios seguem. Devolve uma schlib NOVA (array novo) quando ha o que acrescentar. */
function simbolosDoDocumento(schlib, doc){
  const base = schlib || { symbols: [] };
  const lista = Array.isArray(doc) ? doc.filter(s => s && s.name && Array.isArray(s.parts)) : [];
  if (!lista.length) return { schlib: base, extras: [], divergentes: [] };
  const extras = [], divergentes = [], dv = new Map();
  for (const s of lista) {
    const r = resolveSym(base, s.name);
    if (!r || !r.item) { extras.push(Object.assign({ partcount: s.parts.length }, s, { doDocumento: true })); continue; }
    if (r.item.doDocumento || assinaturaPinos(s) === assinaturaPinos(r.item)) continue;
    divergentes.push({ nome: s.name, biblioteca: r.name });
    dv.set(s.name, { biblioteca: r.name, copia: s });
  }
  if (!extras.length && !dv.size) return { schlib: base, extras, divergentes };
  const out = Object.assign({}, base, { symbols: extras.length ? (base.symbols || []).concat(extras) : base.symbols });
  if (dv.size) out.divergentes = dv;
  return { schlib: out, extras, divergentes };
}
/* Quantos pinos dos componentes `comps` (de um simbolo) encostam em fio, rotulo, power, port
   ou juncao da folha, desenhados com `sym`. Para dizer qual de dois desenhos a folha segue. */
function pinosQueEncostam(sheet, comps, sym){
  const T = STOL;
  const pts = [];
  for (const w of sheet.wires) for (const p of (w.pts || [])) pts.push(p);
  for (const l of [].concat(sheet.netlabels, sheet.powers, sheet.ports, sheet.junctions)) pts.push([l.x, l.y]);
  const lib = { symbols: [sym] };
  let tot = 0, ok = 0;
  for (const c of comps) {
    const P = compPinsWorld(Object.assign({}, c, { sym: sym.name }), lib) || [];
    for (const q of P) {
      tot++;
      let toca = pts.some(p => near(p[0], q.x, T) && near(p[1], q.y, T));
      if (!toca) for (const w of sheet.wires) {
        const v = w.pts || [];
        for (let i = 1; i < v.length && !toca; i++) toca = distSeg(q.x, q.y, v[i-1][0], v[i-1][1], v[i][0], v[i][1]) <= T;
        if (toca) break;
      }
      if (toca) ok++;
    }
  }
  return { tot, ok };
}
const resolveFp = (pcblib, name, tables) =>
  resolveLib((pcblib && pcblib.footprints) || [], name, 'fp', tables);

/* Fachada historica: todo o resto do sistema (desenho da folha, hit-test, extracao de
   nets, validacao, hub classico) chama por aqui, entao resolver AQUI DENTRO e o que faz os
   quatro passos valerem em todas as telas de uma vez. */
function symbolOf(schlib, name){
  const r = resolveSym(schlib, name);
  return (r && r.item) || null;
}
function partOf(sym, part){
  if (!sym || !sym.parts || !sym.parts.length) return null;
  return sym.parts.find(p => p.part === (part || 1)) || null;
}
function footprintOf(pcblib, name){
  const r = resolveFp(pcblib, name);
  return (r && r.item) || null;
}
/* ponta quente do pino (onde o fio conecta), em coords locais do simbolo */
function pinHot(pin){
  const d = ORIENT_DIR[((pin.orient % 360) + 360) % 360] || [1, 0];
  return { x: pin.x + d[0]*pin.len, y: pin.y + d[1]*pin.len };
}
/* A ORDEM DO ALTIUM: gira (Orientation) e DEPOIS espelha em X (IsMirrored). Medido no .SchDoc
   (tools/symbols/sch_leitor.py, os 104 componentes espelhados a 270 graus do DMB, e de novo nos
   pinos absolutos da folha pelo tools/schdoc/schdoc2sch.py): so essa ordem poe os pinos onde a
   folha os tem. "Gira e depois espelha" e o mesmo que "espelha e depois gira com o angulo
   oposto" -- entao o hub segue espelhando o DADO primeiro (hub-draw.mirrorPart) e so troca o
   angulo do componente espelhado por 360 - rot. Em 0/180 as duas ordens coincidem; em 90/270
   espelhado o hub punha os pinos trocados, e as nets nesses pinos caiam. */
function rotEfetiva(comp){
  const r = ((((comp && comp.rot) || 0) % 360) + 360) % 360;
  return comp && comp.mirror ? (360 - r) % 360 : r;
}
/* transform local->mundo de um componente: espelha X, rotaciona anti-horario (rotEfetiva), translada */
function compTransform(comp){
  const rot = rotEfetiva(comp);
  const cos = Math.cos(rot * Math.PI/180), sin = Math.sin(rot * Math.PI/180);
  const mx = comp.mirror ? -1 : 1;
  return {
    map(x, y){ const lx = x*mx, ly = y; return { x: comp.x + lx*cos - ly*sin, y: comp.y + lx*sin + ly*cos }; },
    ang(a){ return ((((comp.mirror ? 180 - a : a) + rot) % 360) + 360) % 360; }
  };
}
/* pontas quentes de todos os pinos do componente, em coords da folha; null se simbolo desconhecido */
function compPinsWorld(comp, schlib){
  const sym = symbolOf(schlib, comp.sym); if (!sym) return null;
  const part = partOf(sym, comp.part);    if (!part) return null;
  const tf = compTransform(comp);
  return (part.pins || []).map(p => {
    const h = pinHot(p), w = tf.map(h.x, h.y);
    return { num: p.num, name: p.name, x: w.x, y: w.y };
  });
}

/* agrupa a lista plana "items" em folhas */
function buildSchModel(schematic){
  const model = { project: (schematic && schematic.project) || '', units: (schematic && schematic.units) || 'mil', sheets: [] };
  const byName = {};
  for (const it of ((schematic && schematic.items) || [])) {
    if (it.t === 'sheet') {
      if (byName[it.name]) continue;
      /* w/h = medida REAL da folha no Altium, quando o export a trouxe; 0 = "nao sei", e ai
         sheetSize() cai na tabela por nome. Nao inventar medida a partir do size aqui. */
      const s = { name: it.name, size: it.size || 'A4', w: isNum(it.w) ? it.w : 0, h: isNum(it.h) ? it.h : 0,
                  comps:[], wires:[], netlabels:[], powers:[], ports:[], junctions:[], noercs:[], texts:[] };
      model.sheets.push(s); byName[it.name] = s;
      continue;
    }
    let s = byName[it.sheet];
    if (!s) {
      /* folha IMPLICITA (ninguem declarou): mesma forma da declarada, sem medida de onde sair */
      s = { name: it.sheet || 'main', size:'A4', w:0, h:0,
            comps:[], wires:[], netlabels:[], powers:[], ports:[], junctions:[], noercs:[], texts:[] };
      model.sheets.push(s); byName[s.name] = s;
    }
    if      (it.t === 'comp')     s.comps.push(it);
    else if (it.t === 'wire')     s.wires.push(it);
    else if (it.t === 'netlabel') s.netlabels.push(it);
    else if (it.t === 'power')    s.powers.push(it);
    else if (it.t === 'port')     s.ports.push(it);
    else if (it.t === 'junction') s.junctions.push(it);
    /* o No ERC entra no modelo mas NAO na extracao de nets: ele e um recado para o ERC
       do Altium, nao um condutor — somar seu ponto aos nos faria o preview inventar
       ligacao que a folha real nao tem */
    else if (it.t === 'noerc')    s.noercs.push(it);
    else if (it.t === 'text')     s.texts.push(it);
  }
  return model;
}

/* Extracao de nets (PREVIEW - a verdade e o compilador do Altium).
   Regras: pontos coincidentes conectam; ponto de conexao (extremo de fio, pino,
   junction, ancora de rotulo/power) SOBRE um segmento conecta (T); cruzamento sem
   ponto de conexao NAO conecta; netlabel funde grupos por nome; power funde por
   nome globalmente. Nome automatico: Net<ref>_<pino> do menor pino. */
function extractNets(schematicOrModel, schlib){
  const model = schematicOrModel.sheets ? schematicOrModel : buildSchModel(schematicOrModel);
  const warnings = [];
  const parent = [];
  const mk = () => { parent.push(parent.length); return parent.length - 1; };
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };

  const nodeMap = {};
  const key = (si, x, y) => si + '|' + Math.round(x*2) + '|' + Math.round(y*2);
  const nodeAt = (si, x, y) => { const k = key(si, x, y); if (!(k in nodeMap)) nodeMap[k] = mk(); return nodeMap[k]; };

  const segs = [], attach = [], pinRecs = [], labelRecs = [], powerRecs = [], portRecs = [];
  const wireNet = model.sheets.map(s => s.wires.map(() => ''));
  const noercEm = new Set();
  model.sheets.forEach((s, si) => s.noercs.forEach(n => noercEm.add(key(si, n.x, n.y))));

  model.sheets.forEach((s, si) => {
    s.wires.forEach((w, wi) => {
      const pts = w.pts || [];
      for (let i = 0; i < pts.length - 1; i++) {
        const nA = nodeAt(si, pts[i][0], pts[i][1]), nB = nodeAt(si, pts[i+1][0], pts[i+1][1]);
        uni(nA, nB);
        segs.push({ si, wi, x1:pts[i][0], y1:pts[i][1], x2:pts[i+1][0], y2:pts[i+1][1], node:nA });
      }
      pts.forEach((p, i) => attach.push({ si, x:p[0], y:p[1], node:nodeAt(si, p[0], p[1]), kind:'wend',
        ponta: pts.length >= 2 && (i === 0 || i === pts.length - 1) }));
    });
    s.comps.forEach(c => {
      const pins = compPinsWorld(c, schlib);
      if (!pins) {
        const symKnown = symbolOf(schlib, c.sym);
        warnings.push(symKnown
          ? `${c.ref}: parte ${c.part || 1} não existe no símbolo "${c.sym}" — pinos ignorados na extração`
          : `${c.ref}: símbolo "${c.sym}" desconhecido — pinos ignorados na extração`);
        return;
      }
      pins.forEach(p => {
        const n = nodeAt(si, p.x, p.y);
        pinRecs.push({ ref:c.ref, num:p.num, name:p.name, node:n, si, x:p.x, y:p.y });
        attach.push({ si, x:p.x, y:p.y, node:n, kind:'pin' });
      });
    });
    s.junctions.forEach(j => attach.push({ si, x:j.x, y:j.y, node:nodeAt(si, j.x, j.y), kind:'junction' }));
    s.netlabels.forEach(l => { const n = nodeAt(si, l.x, l.y); labelRecs.push({ net:l.net, node:n, x:l.x, y:l.y }); attach.push({ si, x:l.x, y:l.y, node:n, kind:'label' }); });
    s.powers.forEach(p => { const n = nodeAt(si, p.x, p.y); powerRecs.push({ net:p.net, node:n, x:p.x, y:p.y }); attach.push({ si, x:p.x, y:p.y, node:n, kind:'power' }); });
    /* A Port do Altium conecta pelo NOME, como o rotulo — a diferenca e so grafica (a
       seta) e hierarquica (ela e o pino da folha vista de fora). Para a extracao ela e
       um nomeador a mais; por isso entra em portRecs e nao ganha regra propria. */
    s.ports.forEach(p => { const n = nodeAt(si, p.x, p.y); portRecs.push({ net:p.net, node:n, x:p.x, y:p.y }); attach.push({ si, x:p.x, y:p.y, node:n, kind:'port' }); });
  });

  /* conexoes em T: ponto de conexao sobre o interior de um segmento */
  const autoJunctions = [];
  for (const a of attach) {
    for (const g of segs) {
      if (g.si !== a.si) continue;
      if ((near(a.x,g.x1,STOL) && near(a.y,g.y1,STOL)) || (near(a.x,g.x2,STOL) && near(a.y,g.y2,STOL))) continue;
      if (distSeg(a.x, a.y, g.x1, g.y1, g.x2, g.y2) <= STOL) {
        uni(a.node, g.node);
        a.emT = true;
        if (a.kind === 'pin' || a.kind === 'wend' || a.kind === 'junction')
          autoJunctions.push({ sheet:a.si, x:a.x, y:a.y });
      }
    }
  }

  /* fusao por nome (netlabel, power e port) */
  const nameRoot = {};
  for (const rec of labelRecs.concat(powerRecs, portRecs)) {
    const r = find(rec.node);
    if (rec.net in nameRoot) uni(nameRoot[rec.net], r); else nameRoot[rec.net] = r;
  }

  /* agrupamento e nomeacao */
  const groups = {};
  const gof = n => { const r = find(n); if (!groups[r]) groups[r] = { names:new Set(), pins:[] }; return groups[r]; };
  for (const rec of labelRecs) gof(rec.node).names.add(rec.net);
  for (const rec of powerRecs) gof(rec.node).names.add(rec.net);
  for (const rec of portRecs)  gof(rec.node).names.add(rec.net);
  for (const rec of pinRecs)   gof(rec.node).pins.push(rec.ref + '-' + rec.num);
  for (const g of segs) gof(g.node);
  const segRoots = new Set(segs.map(g => find(g.node)));

  const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric:true, sensitivity:'base' });
  const netByRoot = {}, nets = [];
  for (const r in groups) {
    const g = groups[r];
    const names = [...g.names].sort(natural);
    let name = '', auto = false;
    if (names.length > 1) warnings.push('nomes de net conflitantes no mesmo grupo: ' + names.join(', '));
    if (names.length) name = names[0];
    else if (g.pins.length) {
      const ps = g.pins.slice().sort(natural);
      name = 'Net' + ps[0].replace('-', '_'); auto = true;
    }
    netByRoot[r] = name;
    /* net so entra na lista se: tem rotulo/power (e algum fio ou pino), ou tem >= 2 pinos.
       Pino solto sem fio NAO vira net (equivale a NetlistSinglePinNets=0 do Altium). */
    if (names.length) {
      if (g.pins.length || segRoots.has(+r))
        nets.push({ name, pins: g.pins.slice().sort(natural), auto: false });
    } else if (g.pins.length >= 2) {
      nets.push({ name, pins: g.pins.slice().sort(natural), auto: true });
    }
    if (!name && !g.pins.length && segRoots.has(+r))
      warnings.push('fio sem conexão (nenhum pino ou rótulo)');
  }
  for (const rec of labelRecs) {
    const r = find(rec.node), g = groups[r];
    if (!segRoots.has(r) && (!g || !g.pins.length))
      warnings.push(`netlabel "${rec.net}" solta em (${rec.x},${rec.y})`);
  }
  for (const rec of powerRecs) {
    const r = find(rec.node), g = groups[r];
    if (!segRoots.has(r) && (!g || !g.pins.length))
      warnings.push(`power "${rec.net}" solto em (${rec.x},${rec.y})`);
  }
  for (const rec of portRecs) {
    const r = find(rec.node), g = groups[r];
    if (!segRoots.has(r) && (!g || !g.pins.length))
      warnings.push(`port "${rec.net}" solta em (${rec.x},${rec.y})`);
  }
  nets.sort((a, b) => natural(a.name, b.name));

  const pinNet = {};
  for (const rec of pinRecs) { const nm = netByRoot[find(rec.node)]; if (nm) pinNet[rec.ref + '-' + rec.num] = nm; }
  for (const g of segs) { const nm = netByRoot[find(g.node)]; if (nm) wireNet[g.si][g.wi] = nm; }

  /* PINO SEM LIGACAO: o grupo dele nao tem outro pino nem nome (rotulo, power, port) -- o
     pino nao liga a nada, com ou sem um fio pendurado. No ERC na ponta quente = solto de
     proposito. PONTA DE FIO SOLTA: a primeira ou a ultima ponta de um fio onde nada mais
     encosta (nem outra ponta, nem pino, nem nomeador, nem juncao, nem o meio de outro fio). */
  const naChave = {};
  for (const a of attach) { const k = key(a.si, a.x, a.y); naChave[k] = (naChave[k] || 0) + 1; }
  const pinosSoltos = [];
  for (const rec of pinRecs) {
    const g = groups[find(rec.node)];
    if (g.names.size || g.pins.length > 1 || noercEm.has(key(rec.si, rec.x, rec.y))) continue;
    pinosSoltos.push({ ref:rec.ref, num:rec.num, name:rec.name, sheet:model.sheets[rec.si].name, x:rec.x, y:rec.y,
                       fio: segRoots.has(find(rec.node)) });
  }
  const pontasSoltas = [];
  for (const a of attach)
    if (a.ponta && !a.emT && naChave[key(a.si, a.x, a.y)] === 1 && !noercEm.has(key(a.si, a.x, a.y)))
      pontasSoltas.push({ sheet:model.sheets[a.si].name, x:a.x, y:a.y });

  return { nets, pinNet, wireNet, autoJunctions, warnings, pinosSoltos, pontasSoltas };
}

/* ============ validacao do schematic.js contra as libs espelhadas ============ */

/* `nets` (opcional) = o extractNets do mesmo esquema e da mesma schlib: com ele saem tambem
   os pinos sem ligacao e as pontas de fio soltas (quem ja extraiu as nets nao paga duas vezes). */
function validateSchematic(schematic, schlib, pcblib, nets){
  const errors = [], warnings = [];
  const avisadoSym = new Set(), avisadoFp = new Set();
  if (!schematic || schematic.format !== 'schmirror-v2') warnings.push('format esperado "schmirror-v2"');
  if (!schematic || !schematic.project) errors.push('header: falta "project"');
  const model = buildSchModel(schematic || {});
  if (!model.sheets.length) errors.push('nenhuma folha ({"t":"sheet",...})');
  const seen = {};
  for (const s of model.sheets) {
    for (const c of s.comps) {
      const where = `comp ${c.ref || '?'}`;
      if (!c.ref) { errors.push('comp sem "ref"'); continue; }
      const k = c.ref + '/' + (c.part || 1);
      if (seen[k]) errors.push(`${where}: ref duplicado (parte ${c.part || 1})`);
      seen[k] = true;
      if (!isNum(c.x) || !isNum(c.y)) { errors.push(`${where}: faltam x/y`); continue; }
      const rot = (((c.rot || 0) % 360) + 360) % 360;
      if (![0, 90, 180, 270].includes(rot)) errors.push(`${where}: rot deve ser 0/90/180/270`);
      const rs = resolveSym(schlib, c.sym);
      const sym = (rs && rs.item) || null;
      if (!sym) { errors.push(`${where}: símbolo "${c.sym}" não existe na schlib`); continue; }
      /* uma vez por simbolo: o nome que so casou trocando maiusculas/acentos/espacos
         ("Varistor" -> "VARISTOR" e outro desenho) */
      if (!avisadoSym.has(c.sym)) {
        avisadoSym.add(c.sym);
        if (rs.how === 'chave')
          warnings.push(`símbolo "${c.sym}" não existe com esse nome; casou com "${rs.name}" (maiúsculas, acentos ou espaços diferentes): confira se é o mesmo desenho`);
      }
      const part = partOf(sym, c.part);
      if (!part) errors.push(`${where}: parte ${c.part || 1} não existe em "${c.sym}"`);
      /* sem a chave e erro; VAZIO e aviso — vai sem vinculo e se resolve no Altium, como o
         BuildSchematic faz (ver SCH_ITEM_REQUIRED) */
      if (typeof c.footprint !== 'string') errors.push(`${where}: falta "footprint" (obrigatório em todo componente)`);
      else if (!c.footprint) warnings.push(`${where}: sem footprint — vai sem vínculo, defina no Altium`);
      else {
        const fp = footprintOf(pcblib, c.footprint);
        if (!fp) errors.push(`${where}: footprint "${c.footprint}" não existe na pcblib`);
        else if (part) {
          const padNames = new Set((fp.pads || []).map(p => String(p.name)));
          for (const p of (part.pins || []))
            if (!padNames.has(String(p.num)))
              warnings.push(`${where}: pino "${p.num}" sem pad correspondente no footprint ${c.footprint}`);
          /* o contrario: pad de cobre que nenhum pino de NENHUMA parte do simbolo leva (a aba
             termica do DDPAK-5 no LM2575: pad 6, 5 pinos) fica sem net na placa. Uma vez por
             componente; pad sem nome e furo sem cobre (npth) nao contam. */
          if (!avisadoFp.has(c.ref)) {
            avisadoFp.add(c.ref);
            const pinos = new Set();
            for (const pt of (sym.parts || [])) for (const p of (pt.pins || [])) pinos.add(String(p.num));
            const sobra = [...new Set((fp.pads || []).filter(q => q && q.name !== '' && q.name != null && q.type !== 'npth' && q.plated !== false)
              .map(q => String(q.name)))].filter(n => !pinos.has(n));
            if (sobra.length)
              warnings.push(`${where}: pad${sobra.length > 1 ? 's' : ''} ${sobra.map(n => '"' + n + '"').join(', ')} do footprint ${c.footprint} sem pino no símbolo — fica${sobra.length > 1 ? 'm' : ''} sem net na placa`);
          }
        }
        /* compara o footprint RESOLVIDO, e nao a string: o modelo do simbolo no espelho
           carrega o nome novo e o projeto carrega o antigo, e comparar cru dispararia o
           aviso em massa para o mesmo footprint fisico */
        const cur = (sym.footprints || []).find(f => f.current);
        const curR = cur ? resolveFp(pcblib, cur.name) : null;
        if (cur && (curR && curR.item ? curR.item !== fp : cur.name !== c.footprint))
          warnings.push(`${where}: footprint ${c.footprint} difere do modelo da lib (${cur.name})`);
      }
      if ((c.x % 100) || (c.y % 100)) warnings.push(`${where}: fora da grade de 100 mil`);
    }
    for (const w of s.wires) {
      if (!Array.isArray(w.pts) || w.pts.length < 2) { errors.push(`wire na folha ${s.name}: pts precisa de >= 2 pontos`); continue; }
      for (const p of w.pts)
        if ((p[0] % 100) || (p[1] % 100)) { warnings.push(`wire na folha ${s.name}: vértice (${p[0]},${p[1]}) fora da grade de 100 mil`); break; }
    }
    for (const l of s.netlabels) if (!l.net) errors.push(`netlabel sem "net" na folha ${s.name}`);
    for (const p of s.powers)    if (!p.net) errors.push(`power sem "net" na folha ${s.name}`);
    for (const p of s.ports)     if (!p.net) errors.push(`port sem "net" na folha ${s.name}`);
    if (s.noercs.length){
      /* A CONTA SO VALE COM A PINAGEM INTEIRA. Componente cujo simbolo nenhum acervo tem nao
         entrega pino nenhum, e todo No ERC pousado nele viraria aviso falso — medido no
         PRJ - DI261930: 13 dos 41 componentes sem simbolo faziam os 22 No ERC reclamarem de
         uma vez, os 22 indevidamente. Sem a pinagem completa nao se afirma nada: diz-se, numa
         linha so, que nao deu para conferir. Nao conferido e diferente de errado. */
      const quentes = new Set();
      let cegos = 0;
      for (const c of s.comps){
        const pins = compPinsWorld(c, schlib);
        if (!pins){ cegos++; continue; }
        for (const p of pins) quentes.add(p.x + ',' + p.y);
      }
      if (cegos)
        warnings.push(`${s.noercs.length} No ERC da folha ${s.name} não foram conferidos: `
          + `${cegos} componente(s) sem símbolo, e a pinagem deles é desconhecida`);
      else for (const n of s.noercs)
        if (!quentes.has(n.x + ',' + n.y))
          warnings.push(`No ERC em (${n.x},${n.y}) não está na ponta de nenhum pino`);
    }
  }
  /* A COPIA DO ESQUEMA QUE DIFERE DA BIBLIOTECA (simbolosDoDocumento): vale a da biblioteca, e
     o aviso conta, nos componentes da folha, quantos pinos encostam em fio com cada desenho --
     e isso que diz se os fios foram desenhados na copia (aí os pinos aparecem soltos). */
  const dv = schlib && schlib.divergentes;
  if (dv && dv.size) dv.forEach((d, nome) => {
    let lib = { tot: 0, ok: 0 }, cop = { tot: 0, ok: 0 }, n = 0;
    const symLib = symbolOf(schlib, nome), copia = Object.assign({}, d.copia, { name: nome });
    for (const s of model.sheets) {
      const cs = s.comps.filter(c => c.sym === nome);
      if (!cs.length || !symLib) continue;
      n += cs.length;
      const a = pinosQueEncostam(s, cs, symLib), b = pinosQueEncostam(s, cs, copia);
      lib.tot += a.tot; lib.ok += a.ok; cop.tot += b.tot; cop.ok += b.ok;
    }
    if (!n || cop.ok === lib.ok) return;
    warnings.push(`símbolo "${nome}": a cópia guardada no esquema tem pinos diferentes da biblioteca ("${d.biblioteca}"), e vale a da biblioteca — `
      + `${lib.ok} de ${lib.tot} pinos encostam em fio com ela; com a cópia, ${cop.ok}`
      + (cop.ok > lib.ok ? '. Os fios parecem desenhados na cópia: troque o símbolo dos componentes ou corrija a biblioteca' : ''));
  });
  /* um aviso por componente (os pinos juntos); as pontas de fio soltas, uma linha por folha */
  if (nets && Array.isArray(nets.pinosSoltos)) {
    const porComp = new Map();
    for (const p of nets.pinosSoltos) {
      const k = p.ref;
      if (!porComp.has(k)) porComp.set(k, []);
      porComp.get(k).push(p.name && p.name !== p.num ? `${p.num} (${p.name})` : String(p.num));
    }
    porComp.forEach((l, ref) => warnings.push(`comp ${ref}: pino${l.length > 1 ? 's' : ''} ${l.join(', ')} sem ligação (nenhum fio, rótulo ou outro pino; solto de propósito = No ERC na ponta)`));
  }
  if (nets && Array.isArray(nets.pontasSoltas) && nets.pontasSoltas.length) {
    const porFolha = new Map();
    for (const p of nets.pontasSoltas) { if (!porFolha.has(p.sheet)) porFolha.set(p.sheet, []); porFolha.get(p.sheet).push(p); }
    porFolha.forEach((l, sh) => warnings.push(`folha ${sh}: ${l.length} ponta${l.length > 1 ? 's' : ''} de fio solta${l.length > 1 ? 's' : ''} (nada encosta): `
      + l.slice(0, 8).map(p => `(${p.x},${p.y})`).join(' ') + (l.length > 8 ? ` e mais ${l.length - 8}` : '')));
  }
  return { errors, warnings };
}

/* ============ serializacao (formato um-objeto-JSON-por-linha dos parsers .pas) ============ */

/* escapa >= U+007E como \uXXXX (mesma convencao do JS() dos scripts .pas, que escapa > 125) */
function jline(obj){
  return JSON.stringify(obj).replace(/[\u007e-\uffff]/g,
    c => '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4));
}
function badStr(s){ return typeof s === 'string' && s.indexOf('":') >= 0; }

const CH_REQUIRED = {
  comp_move:       { num:['x','y','orig_x','orig_y','orig_rot'], str:['ref','orig_layer'] },
  comp_attr:       { num:[], str:['ref','orig_designator'] },
  track_edit:      { num:['orig_x1','orig_y1','orig_x2','orig_y2','orig_w'], str:['id','orig_layer'] },
  track_add:       { num:['x1','y1','x2','y2','w'], str:['layer'] },
  track_del:       { num:['orig_x1','orig_y1','orig_x2','orig_y2','orig_w'], str:['id','orig_layer'] },
  via_edit:        { num:['orig_x','orig_y'], str:['id'] },
  via_add:         { num:['x','y','size','drill'], str:[] },
  via_del:         { num:['orig_x','orig_y'], str:['id'] },
  arc_edit:        { num:['orig_cx','orig_cy','orig_r','orig_sa','orig_ea'], str:['id','orig_layer'] },
  arc_add:         { num:['cx','cy','r','sa','ea','w'], str:['layer'] },
  arc_del:         { num:['orig_cx','orig_cy','orig_r','orig_sa','orig_ea'], str:['id','orig_layer'] },
  text_edit:       { num:['orig_x','orig_y'], str:['id','orig_text','orig_layer'] },
  designator_move: { num:['orig_x','orig_y'], str:['ref'] },
  outline_set:     { num:[], str:[] },
  fill_add:        { num:['x1','y1','x2','y2'], str:['layer'] },
  fill_edit:       { num:['orig_x1','orig_y1','orig_x2','orig_y2'], str:['id','orig_layer'] },
  fill_del:        { num:['orig_x1','orig_y1','orig_x2','orig_y2'], str:['id','orig_layer'] },
  /* `layer` da region_add e conferida a parte: com cutout:true ela e dispensada */
  region_add:      { num:[], str:[] },
  region_del:      { num:['orig_n','orig_x0','orig_y0'], str:['id','orig_layer'] },
  text_add:        { num:['x','y','h'], str:['layer','text'] },
  text_del:        { num:['orig_x','orig_y'], str:['id','orig_text','orig_layer'] },
  /* placa nova e ECO (2026-10-13). net/orig_net do pad_net podem ser "" (sem net): conferidos a parte */
  comp_add:        { num:['x','y'], str:['ref','footprint'] },
  comp_del:        { num:['orig_x','orig_y','orig_rot'], str:['ref','orig_layer'] },
  pad_net:         { num:[], str:['ref','pad'] },
  net_add:         { num:[], str:['net'] },
  net_del:         { num:[], str:['net'] },
  net_rename:      { num:[], str:['net','orig_net'] },
  pad_add:         { num:['x','y','w','h'], str:['type'] },
  pad_edit:        { num:['orig_x','orig_y'], str:['id'] },
  pad_del:         { num:['orig_x','orig_y'], str:['id'] },
  comment_move:    { num:['orig_x','orig_y'], str:['ref'] },
  poly_add:        { num:[], str:['layer'] },
  poly_edit:       { num:['orig_n','orig_x0','orig_y0'], str:['id','orig_layer'] },
  poly_del:        { num:['orig_n','orig_x0','orig_y0'], str:['id','orig_layer'] },
  /* a pilha de camadas do hub (2026-10-29): layers conferida a parte */
  stack_set:       { num:[], str:[] },
};

function checkFields(objs, reqOf, kindOf, errors){
  objs.forEach((o, i) => {
    const req = reqOf(o);
    if (!req){ errors.push({ idx:i, msg:`${kindOf(o)}: tipo desconhecido` }); return; }
    for (const k of req.num) if (!isNum(o[k])) errors.push({ idx:i, msg:`${kindOf(o)}: campo "${k}" ausente/invalido` });
    for (const k of req.str) if (typeof o[k] !== 'string' || !o[k]) errors.push({ idx:i, msg:`${kindOf(o)}: campo "${k}" ausente` });
    for (const k in o) if (badStr(o[k])) errors.push({ idx:i, msg:`${kindOf(o)}: texto em "${k}" nao pode conter a sequencia aspas-dois-pontos` });
  });
}

function serializeChanges(changes){
  const list = Array.isArray(changes) ? changes : [];
  const errors = [];
  checkFields(list, ch => CH_REQUIRED[ch.op], ch => ch.op || '?', errors);
  list.forEach((ch, i) => {
    if (ch.op === 'outline_set') {
      const sg = ptsToOutline(ch.pts);
      if (!sg || ch.pts.length < (sg.some(x => x.kind === 'arc') ? 2 : 3))
        errors.push({ idx:i, msg:'outline_set: pts deve ser [[x,y],...] com >= 3 vertices (ou [x,y,bulge])' });
    }
    if (ch.op === 'pad_net') {
      if (typeof ch.net !== 'string') errors.push({ idx:i, msg:'pad_net: campo "net" ausente ("" = sem net)' });
      if (typeof ch.orig_net !== 'string') errors.push({ idx:i, msg:'pad_net: campo "orig_net" ausente ("" = sem net)' });
    }
    if (ch.op === 'comp_add' && parseNetsCampo(ch.nets) === null)
      errors.push({ idx:i, msg:'comp_add: "nets" deve ser texto "pad=net;pad=net"' });
    if (ch.op === 'poly_add' && !ptsValid(ch.pts, 3))
      errors.push({ idx:i, msg:'poly_add: pts deve ser [[x,y],...] com >= 3 vertices' });
    if ((ch.op === 'pad_add' || ch.op === 'pad_edit') && ch.type !== undefined && !['smd', 'th', 'npth'].includes(ch.type))
      errors.push({ idx:i, msg:ch.op + ': type deve ser smd, th ou npth' });
    if (ch.op === 'track_add' && ch.w <= 0) errors.push({ idx:i, msg:'track_add: w deve ser > 0' });
    if (ch.op === 'via_add' && ch.drill >= ch.size) errors.push({ idx:i, msg:'via_add: drill deve ser < size' });
    if (ch.op === 'stack_set') { const r = stackDaOp(ch); if (r.erro) errors.push({ idx:i, msg:'stack_set: ' + r.erro }); }
    if (ch.op === 'region_add'){
      if (!ptsValid(ch.pts, 3)) errors.push({ idx:i, msg:'region_add: pts deve ser [[x,y],...] com >= 3 vertices' });
      if (ch.cutout !== true && (typeof ch.layer !== 'string' || !ch.layer))
        errors.push({ idx:i, msg:'region_add: campo "layer" ausente (ou cutout:true para recorte)' + (ch.polycut === true ? ' — o polycut vai numa camada de cobre ou na Multi' : '') });
    }
    if (ch.op === 'text_add'){
      if (isNum(ch.h) && ch.h <= 0) errors.push({ idx:i, msg:'text_add: h deve ser > 0' });
      if (ch.w !== undefined && !(isNum(ch.w) && ch.w > 0)) errors.push({ idx:i, msg:'text_add: w deve ser > 0' });
    }
    if (ch.op === 'fill_add' && isNum(ch.x1) && isNum(ch.y1) && isNum(ch.x2) && isNum(ch.y2) &&
        (near(ch.x1, ch.x2) || near(ch.y1, ch.y2)))
      errors.push({ idx:i, msg:'fill_add: fill sem area (x1 = x2 ou y1 = y2)' });
    if (ch.op === 'comp_attr'){
      if (typeof ch.orig_comment !== 'string') errors.push({ idx:i, msg:'comp_attr: campo "orig_comment" ausente' });
      if (!(typeof ch.designator === 'string' && ch.designator) && typeof ch.comment !== 'string')
        errors.push({ idx:i, msg:'comp_attr: nada a alterar (informe designator e/ou comment)' });
    }
  });
  if (errors.length) return { text:null, errors };
  const L = ['// AltiumPCBMirror - arquivo de mudancas.',
             '// Edite ESTE arquivo (nunca o board.js). Um objeto JSON por linha. Consulte AI-GUIDE.md.',
             'var changes = ['];
  for (const ch of list) L.push(jline(ch) + ',');
  L.push('];');
  return { text: L.join('\n') + '\n', errors: [] };
}

/* Libs/lib-subs.js: as substituicoes escolhidas na aba Biblioteca.
   Um registro JSON PLANO por linha e chaves fixas, porque e assim que os .pas leem
   (o JGet procura '"chave":' literal dentro da linha); nao-ASCII sai como \uXXXX pelo
   mesmo motivo - o TStringList do Delphi le ANSI e corromperia acento cru.
   `key` viaja junto para o lado Pascal nao precisar reimplementar a NormKey. */
function serializeLibSubs(subs){
  const list = Array.isArray(subs) ? subs : [];
  const errors = [], seen = {}, out = [];
  list.forEach((r, i) => {
    const o = r || {}, kind = o.kind === 'fp' ? 'fp' : 'sym';
    if (typeof o.from !== 'string' || !o.from) return errors.push({ idx:i, msg:'substituicao sem "from"' });
    if (typeof o.to !== 'string' || !o.to)     return errors.push({ idx:i, msg:'substituicao sem "to"' });
    if (o.from === o.to) return errors.push({ idx:i, msg:`substituicao de "${o.from}" para ela mesma` });
    const k = kind + '\u0000' + o.from;
    /* dois destinos para o mesmo nome nao e conflito de merge, e escolha perdida: a ultima
       venceria em silencio e a pessoa nunca saberia qual das duas valeu */
    if (seen[k]) return errors.push({ idx:i, msg:`duas substituicoes para "${o.from}"` });
    seen[k] = true;
    out.push({ kind, from:o.from, key:normKey(o.from), to:o.to,
               when: typeof o.when === 'string' ? o.when : '' });
  });
  if (errors.length) return { text:null, errors };
  const L = ['// AltiumPCBMirror - substituicoes de biblioteca escolhidas na aba Biblioteca.',
             '// "from" = nome que o projeto referencia e a lib nao tem; "to" = nome que existe na lib.',
             '// "key" = NormKey(from), a mesma do RenameLibs.pas, para JS e Pascal concordarem.',
             'var libSubs = ['];
  for (const r of out) L.push(jline(r) + ',');
  L.push('];');
  return { text: L.join('\n') + '\n', errors: [] };
}

const SCH_ITEM_REQUIRED = {
  /* w/h (medida real da folha, em mil) sao OPCIONAIS e ficam FORA daqui: `size` continua
     obrigatorio para que espelho antigo nao pare de salvar, e um export que trocasse size
     por w/h derrubaria o Salvar do arquivo INTEIRO, nao so o da folha. */
  sheet:    { num:[], str:['name','size'] },
  /* `footprint` e obrigatorio como CHAVE, mas pode ser VAZIO — conferido a parte no
     serializeSchematic. Decisao do dono (2026-09-23, AI-GUIDE): sem footprint o componente vai
     sem vinculo e o BuildSchematic avisa ([AVISO] sem footprint). Exigir texto aqui fazia um
     componente do almoxarifado sem footprint conhecido (784 dos 2545 valores) travar o Salvar
     do arquivo INTEIRO, e a vista nao tem como dar footprint a um componente ja colocado. */
  comp:     { num:['x','y'], str:['sheet','ref','sym'] },
  wire:     { num:[], str:['sheet'] },
  netlabel: { num:['x','y'], str:['sheet','net'] },
  power:    { num:['x','y'], str:['sheet','net','style'] },
  /* io/style/w/color/fill/textColor sao OPCIONAIS de proposito: o ExportProject emite o que
     o Altium der, e um .SchDoc antigo pode nao trazer todos. Exigir aqui faria um espelho
     legitimo travar o Salvar do arquivo inteiro — o mesmo estrago que um tipo desconhecido
     causava. As cores ausentes caem no padrao amarelo/preto do hub-draw. */
  port:     { num:['x','y'], str:['sheet','net'] },
  junction: { num:['x','y'], str:['sheet'] },
  /* style/color opcionais pelo mesmo motivo da port: o que o Altium der atravessa o
     espelho como veio, e .SchDoc antigo pode nao trazer nenhum dos dois */
  noerc:    { num:['x','y'], str:['sheet'] },
  text:     { num:['x','y'], str:['sheet','s'] },
};

function serializeSchematic(sch){
  if (!sch || typeof sch !== 'object') return { text:null, errors:[{ idx:-1, msg:'schematic ausente' }] };
  const errors = [];
  if (!sch.project) errors.push({ idx:-1, msg:'header: falta "project"' });
  for (const k of Object.keys(sch)) if (k !== 'items' && badStr(sch[k]))
    errors.push({ idx:-1, msg:`header: campo "${k}" nao pode conter a sequencia aspas-dois-pontos` });
  const todos = Array.isArray(sch.items) ? sch.items : [];
  /* TEXTO VAZIO NAO E CONTEUDO, e nao pode segurar o arquivo inteiro refem.

     O ExportProject traz o que a folha do Altium tem, e uma folha real tinha um objeto de
     texto sem uma letra dentro (PRJ-UR-DI261924, medido). Pelo contrato do AI-GUIDE o campo
     `s` e obrigatorio, entao o validador recusava a gravacao inteira -- e o projetista
     ficava sem conseguir salvar NADA naquele projeto por causa de um objeto que nao desenha
     nada e nao diz nada.

     Descartar e o unico desfecho honesto: nao ha o que preservar num texto sem texto. Mas
     quem chama recebe a lista em `descartados` e AVISA na tela; silencio aqui seria perder
     dado sem contar, que e justamente o que este projeto nao faz. */
  const descartados = todos.filter(it => it && it.t === 'text'
                                      && (typeof it.s !== 'string' || !it.s.trim()));
  const items = descartados.length ? todos.filter(it => descartados.indexOf(it) < 0) : todos;
  checkFields(items, it => SCH_ITEM_REQUIRED[it.t], it => it.t || '?', errors);
  items.forEach((it, i) => {
    if (it.t === 'wire' && (!Array.isArray(it.pts) || it.pts.length < 2))
      errors.push({ idx:i, msg:'wire: pts precisa de >= 2 pontos' });
    if (it.t === 'comp' && it.rot != null && ![0, 90, 180, 270].includes((((it.rot % 360) + 360) % 360)))
      errors.push({ idx:i, msg:'comp: rot deve ser 0/90/180/270' });
    if (it.t === 'comp' && typeof it.footprint !== 'string')
      errors.push({ idx:i, msg:'comp' + (it.ref ? ' ' + it.ref : '') + ': campo "footprint" ausente' });
  });
  if (errors.length) return { text:null, errors, descartados };
  const L = ['var schematic = {'];
  for (const k of Object.keys(sch)) if (k !== 'items') L.push(JSON.stringify(k) + ':' + jline(sch[k]) + ',');
  L.push('"items":[');
  for (const it of items) L.push(jline(it) + ',');
  L.push(']};');
  return { text: L.join('\n') + '\n', errors: [], descartados };
}

const ANN_REQUIRED = { num:['x','y'], str:['id','severity','msg'] };

function serializeAnnotations(list){
  const anns = Array.isArray(list) ? list : [];
  const errors = [];
  checkFields(anns, () => ANN_REQUIRED, a => a.id || 'sinalizador', errors);
  anns.forEach((a, i) => {
    if (a.view !== 'pcb' && a.view !== 'sch') errors.push({ idx:i, msg:`${a.id || '?'}: view deve ser "pcb" ou "sch"` });
    if (a.view === 'sch' && (typeof a.sheet !== 'string' || !a.sheet)) errors.push({ idx:i, msg:`${a.id || '?'}: falta "sheet"` });
    if (!['err','warn','info'].includes(a.severity)) errors.push({ idx:i, msg:`${a.id || '?'}: severity deve ser err/warn/info` });
  });
  if (errors.length) return { text:null, errors };
  const L = ['// AltiumPCBMirror - sinalizadores do usuario para a IA. Um objeto JSON por linha.',
             '// A IA le, corrige via changes.js e marca status resolved + reply. Consulte AI-GUIDE.md Parte C.',
             'var annotations = ['];
  for (const a of anns) L.push(jline(a) + ',');
  L.push('];');
  return { text: L.join('\n') + '\n', errors: [] };
}

/* ============ Neoden 4: pick-and-place (paridade com neodenAltium.py) ============ */

/* Mid X/Y sai da origem do componente (Comp.x/Comp.y = Location X/Y do Altium), nao do
   centro do bbox de cobre: o bbox gira junto com o componente, entao o desvio
   origem->centro cai em eixos diferentes conforme a rotacao e sobra como erro depois de
   subtrair a referencia (dois JUMPER_3VIAS a 0 e 270 graus erravam 0.127mm em X e Y). */
function neodenPos(c){
  if (isNum(c.x) && isNum(c.y)) return { x: c.x, y: c.y };
  const b = c.bbox;
  if (b && isNum(b.x1) && isNum(b.y1) && isNum(b.x2) && isNum(b.y2))
    return { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 };
  return { x: 0, y: 0 };
}
/* Tipo de montagem: sai do pads[].type do board.js ("th"/"smd"), nunca do nome do
   footprint. A Neoden 4 so coloca SMD — PTH na lista trava a maquina. "misto" (pads
   dos dois tipos) e categoria propria e NAO conta como pth: e o modulo que assenta em
   pads SMD com furo de header junto (MD4/ESP32-H2 do VDCB-DI251879), colocavel. Sem
   pads, ou tipo desconhecido, da "?": nao da pra afirmar, entao fica fora de qualquer
   exclusao em lote em vez de virar um chute silencioso. */
function neodenKind(c){
  const pads = (c && c.pads) || [];
  const th = pads.some(p => p.type === 'th'), smd = pads.some(p => p.type === 'smd');
  if (th && smd) return 'misto';
  if (th) return 'pth';
  if (smd) return 'smd';
  return '?';
}
/* Ordem das classes na bancada; o que nao esta aqui vai depois, em ordem alfabetica. */
const NEODEN_CLASS_ORDER = ['R', 'C', 'L', 'D'];
/* Package = o codigo imperial achado no nome do footprint. E o que junta "RES 1206" com
   "1206 resistor" (96 e 35 ocorrencias no acervo, mesmo componente fisico). Sem codigo,
   a chave e o proprio nome — footprints identicos continuam juntos, e so eles. */
function neodenPkg(fp){
  const m = /(?:^|\D)(0201|0402|0603|0805|1206|1210|2010|2512)(?:\D|$)/.exec(String(fp || ''));
  return m ? m[1] : String(fp || '');
}
/* Prefixo de letras INTEIRO: CN1 e conector, nao capacitor. Cortar na primeira letra
   poria os conectores no meio dos capacitores e partiria o bloco em dois. */
function neodenClass(des){
  const m = /^[A-Za-z]+/.exec(String(des || ''));
  return m ? m[0].toUpperCase() : '';
}
/* Numero do designator, para R2 vir antes de R10 dentro do grupo. Sem numero da -1 e o
   desempate cai na string, que e sempre determinista. */
function neodenSeq(des){
  const m = /^[A-Za-z]+(\d+)/.exec(String(des || ''));
  return m ? parseInt(m[1], 10) : -1;
}
function neodenGroupKey(row){
  const cls = neodenClass(row.des);
  const rank = NEODEN_CLASS_ORDER.indexOf(cls);
  return { rank: rank < 0 ? NEODEN_CLASS_ORDER.length : rank, cls: cls,
           pkg: neodenPkg(row.footprint), num: neodenSeq(row.des), des: String(row.des || '') };
}
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/* Devolve uma lista nova, agrupada. `pinned` (a referencia) fica de fora da ordenacao e
   volta na primeira posicao. Os codigos imperiais tem 4 digitos, entao a ordem
   alfabetica ja e a ordem de tamanho (0402 < 0603 < 0805 < 1206 < 2512) e os nomes
   nao-imperiais caem depois deles, porque digito vem antes de letra. */
function neodenGroupSort(rows, pinned){
  const rest = pinned ? rows.filter(r => r !== pinned) : rows.slice();
  const keys = new Map(rest.map(r => [r, neodenGroupKey(r)]));
  rest.sort((a, b) => {
    const ka = keys.get(a), kb = keys.get(b);
    return ka.rank - kb.rank || cmpStr(ka.cls, kb.cls) || cmpStr(ka.pkg, kb.pkg)
        || ka.num - kb.num || cmpStr(ka.des, kb.des);
  });
  return pinned ? [pinned].concat(rest) : rest;
}
function neodenRotatePt(ox, oy, px, py, angle){
  const a = angle * Math.PI / 180;
  return { x: ox + Math.cos(a) * (px - ox) - Math.sin(a) * (py - oy),
           y: oy + Math.sin(a) * (px - ox) + Math.cos(a) * (py - oy) };
}
function neodenTransform(components, opts){
  const o = opts || {};
  const comps = (components || []).slice();
  let ordered = comps;
  if (o.refDes){
    const ref = comps.find(c => c.ref === o.refDes);
    if (!ref) return { rows: null, error: `referência "${o.refDes}" não existe no board.js` };
    ordered = [ref].concat(comps.filter(c => c !== ref));
  }
  const ex = new Set(o.exclude || []);
  ex.delete(o.refDes);        /* a referência é a origem do mapeamento: nunca sai da lista */
  let rows = ordered.map(c => {
    const m = neodenPos(c);
    return { des: c.ref, footprint: c.footprint || '', x: m.x, y: m.y,
             layer: c.layer, rot: c.rot || 0, comment: c.comment || '',
             kind: neodenKind(c), excluded: ex.has(c.ref), idx: null };
  });
  /* Capturada ANTES de ordenar: a partir daqui a referencia e esta linha, nunca rows[0] —
     com agrupamento ela deixa de ser a linha 0 da lista ordenada. */
  const refRow = o.refDes ? rows[0] : null;
  if (o.group) rows = neodenGroupSort(rows, refRow);
  /* idx = índice de exportação, contado SÓ nos incluídos — é o mesmo número no "#" da
     tabela, no campo "mover após N" e na linha do CSV. Se a exclusão ficasse fora do
     pipeline, tirar 32 PTH deslocaria o corte do painel em 32 posições. */
  let k = 0;
  for (const r of rows) if (!r.excluded) r.idx = k++;
  if (o.refDes){                                       /* -r: relativo à referência */
    const rx = refRow.x, ry = refRow.y;
    for (const r of rows){ r.x -= rx; r.y -= ry; }
  }
  if (o.rot && isNum(o.rot.angle) && o.rot.angle){     /* -a ox oy ang */
    for (const r of rows){
      const q = neodenRotatePt(o.rot.ox || 0, o.rot.oy || 0, r.x, r.y, o.rot.angle);
      r.x = q.x; r.y = q.y;
    }
  }
  if (o.off && (isNum(o.off.x) || isNum(o.off.y))){    /* -o x y */
    for (const r of rows){ r.x += o.off.x || 0; r.y += o.off.y || 0; }
  }
  if (o.move && isNum(o.move.n) && (isNum(o.move.dx) || isNum(o.move.dy))){  /* -m dx dy n */
    for (const r of rows) if (r.idx !== null && r.idx > o.move.n){ r.x += o.move.dx || 0; r.y += o.move.dy || 0; }
  }
  return { rows, error: null };
}
function neodenCsv(rows, side){
  const clean = v => String(v).replace(/,/g, '_');
  const L = ['Designator,Footprint,Mid X,Mid Y,Layer,Rotation,Comment', ',,,,,,'];
  for (const r of (rows || [])){
    if (r.excluded || r.layer !== side) continue;
    L.push([clean(r.des), clean(r.footprint), r.x.toFixed(2) + 'mm', r.y.toFixed(2) + 'mm',
            'T', clean(r.rot), clean(r.comment)].join(','));
  }
  return L.join('\r\n') + '\r\n';
}

/* ============ status do projeto na esteira ============ */

function deriveStatus(entry, loaded){
  const f = (entry && entry.files) || {};
  if (f.applyreport) return 'aplicada';
  if (loaded && loaded.changesCount > 0 && f.board) return 'roteada';
  if (f.board) return 'eco';
  if (f.schematic) return 'esquema';
  return 'vazio';
}

return { near, nearAng, isNum, distSeg, TOL, STOL, ORIENT_DIR,
         SHEET_SIZES, SHEET_ISO, SHEET_PRESETS, SHEET_TOL,
         sheetSize, sheetPreset, sheetMatch, sheetLabel,
         symbolOf, partOf, footprintOf, pinHot, rotEfetiva, compTransform, compPinsWorld,
         normKey, libIndex, setLibTables, libTables, resolveLib, resolveSym, resolveFp, assinaturaPinos, simbolosDoDocumento,
         suggestSym,
         buildSchModel, extractNets, validateSchematic,
         applyPcbChanges, effectiveBoard, deriveStatus,
         PCB_LAYERS, pcbLayer, isCopper, flipLayer, boardLayers,
         serializeChanges, serializeSchematic, serializeAnnotations, serializeLibSubs,
         compDelta, xfPoint, xfPointInv, xfAngle, xfArc, xfObject, ownerDelta, effLayerForOwner,
         neodenTransform, neodenCsv, neodenKind,
         setPcbLib, pcbLibAtual, footprintGeom, parseNetsCampo, netsCampo, ptsToOutline, outlineToPts, bulgeArco,
         outlineBBox, normAng, PAD_FORMAS, FURO_FORMAS, POUR };
});
