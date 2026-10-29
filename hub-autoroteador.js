/* AltiumPCBMirror v2 - hub-autoroteador.js — o AUTOROTEADOR: várias camadas, vias e o lote inteiro.

   O relato que o pediu (2026-10-28): o pcb_rotear liga UMA conexão por vez, numa camada só e sem via,
   e uma IA precisou escrever um A* por fora (grade de 0,05 mm, Top/Bottom/Mid2, vias) para fechar uma
   placa de potência. O que faltava no hub, e o que este arquivo faz:
     14  rotear em várias camadas, trocando de camada por via — a placa de potência com plano interno
         não fecha numa camada só;
     15  rotear MUITAS conexões de uma vez, com ordem, arranca-e-refaz (rip-up) e nova tentativa — na
         área lógica, só a ordem levou o resultado de 40 para 12 conexões abertas;
     16  a folga por classe / par de nets do rules.js DENTRO do roteador (Fase x baixa tensão 1,5 mm,
         +74 x baixa 1,0 mm, COM x VSS 0,2 mm só dentro do IC8).

   NADA DE CONTA NOVA DE FOLGA. Tudo o que decide "cabe ou não cabe" é o motor do hub-roteador.js
   (HubRoteador.motor): o índice exato de cada camada, a regra de cada par pela Clearance vencedora
   (HubPcbRegras.folgaEntre, a MESMA conta do DRC: escopo, prioridade, classes de net, matriz de
   objetos), a Board Outline Clearance, a Width e a Routing Via Style da net (o "Rule Preferred") e a
   Routing Layers. O que este arquivo põe por cima:
     - a GRADE DE VÁRIAS CAMADAS: um nó é (camada, i, j) numa grade só, ancorada no ponto de partida
       (passo `res` da cena). Na camada, os 8 vizinhos com custo de curva, e cada nó com os três
       estados de sempre (LIVRE / BANDA / BLOQ, motor.estadoPonto): passo entre dois livres não se
       confere, o que encosta na banda é conferido exato (motor.segLivre). Entre camadas, a VIA no
       mesmo (i,j), só onde ela é limpa em TODA camada de cobre (a via é passante: a folga do par via x
       objeto de cada camada, como o folgaVia), com o furo a furo (HoleToHoleClearance) e a ponte de
       máscara (MinimumSolderMaskSliver) do DRC — a via colada num pad abre a máscara a 0,05 mm dele, e
       o DRC da casa acusa. Custo da via configurável (custoVia, em mm de trilha equivalente);
     - as camadas PLANE não recebem trilha (a via as atravessa e respeita o que houver nelas); a
       Routing Layers da net e a lista `camadas` do pedido mandam nas camadas de sinal;
     - pad SMD só se alcança na camada dele; pad passante e via, em qualquer camada;
     - pad da MESMA net que não é ponta da conexão é obstáculo (sem folga: a trilha passa encostada,
       nunca por cima) — a regra da casa "trilha não cruza pad sem terminar nele" (regras_casa_verificar
       » trilha_sobre_pad). Cobre da mesma net que já está na placa (trilha, via, plano) não é;
     - o caminho achado é suavizado e limpo como a rota da mão (motor.suaviza, motor.tiraDegraus,
       motor.limpa: sem ponto repetido nem colinear) e CONFERIDO EXATO perna a perna (trilha pela folga
       de trilha, via pela folga de via) antes de ser aceito;
     - a largura é a preferida da Width da net em cada camada; se a partida ou a chegada não cabe com
       ela (pad de passo fino), a mínima da regra (o "neck down" do Altium). Nunca abaixo da regra.

   O LOTE (rotearLote): as conexões são as linhas abertas do ratsnest da placa efetiva
   (HubPcbNets.conexoes: a árvore mínima entre as ilhas de cada net, como o Altium), filtradas por
   `nets`. Ordem: 'curta' (padrão: a mais curta primeiro), 'longa', 'classe' (a net de regra mais
   pesada primeiro — trilha mais larga, via maior, folga maior —, depois a mais curta), 'dada' (a ordem
   de `nets`) ou uma lista de nets. Cada rota aceita vira obstáculo das seguintes NA HORA, sem refazer
   a cena: o cobre do lote vive numa camada EXTRA (motor.montaExtra), um índice pequeno refeito só
   quando ele muda, e as regras da placa (caras de montar) ficam guardadas por net/largura.
   ARRANCA E REFAZ: para cada conexão que falhou, o roteador procura o caminho dela só contra o cobre
   que JÁ ESTAVA na placa; se existe, as rotas DESTE lote que ele atravessa são as culpadas — saem, a
   que falhou entra, e as arrancadas são roteadas de novo (cada uma no máximo MAX_ARRANCA vezes).
   Várias passadas, até `passes`; fica o melhor resultado (menos conexões abertas; no empate, menos
   via e menos trilha). Cobre que já existia na placa NUNCA é arrancado.
   Orçamentos (com padrão, devolvidos no relatório): tempo total, nós por busca.

   Lógica pura, sem DOM: navegador (global HubAutoRoteador, depois do hub-roteador.js, hub-pcbnets.js e
   hub-pcbregras.js) e Node (tests/test-autoroteador.js; o pcb_autorotear do MCP).

   API
     rotearLote(eb, opts) -> {
        ops:      [{op:'track_add', layer, x1, y1, x2, y2, w, net, note} | {op:'via_add', x, y, size,
                   drill, net, note}]   (as linhas do changes.js, uma por objeto, no formato do AI-GUIDE)
        antes:    {conexoes, nets}      as conexões (linhas do ratsnest) abertas antes, em todas as nets
        depois:   {conexoes, nets, doAlvo}  e depois do lote (HubPcbNets na placa com as rotas); doAlvo =
                                        as abertas só nas nets do lote
        alvo:     {conexoes, nets}      as que o lote tentou (o filtro `nets`)
        roteadas, falhas:[{net, de, para, motivo}], vias, comprimento (mm), passes, arrancadas, ms,
        porNet:   [{net, conexoes, roteadas, falhas, vias, comprimento}],
        orcamento:{tempoMs, nosPorBusca, esgotouTempo}, parametros:{ordem, passes, custoVia, res, camadas},
        rotas:    [{net, de, para, camadas, vias, comprimento, largura}] }
       eb    a placa efetiva (HubCore.effectiveBoard; a do MCP já com os polígonos despejados)
       opts  {cena | regras, clearance, placa:{lacos, recortes}, textoGeo, res   (para montar a cena),
              nets:[...], camadas:[...], ordem, passes, custoVia (mm), orcamento:{tempoMs, nosPorBusca},
              peso (da heurística, padrão 1,2), modo '45' | '90', note, roteador (o HubRoteador da cena)}
     conexoesAbertas(eb, cena, opts)   as conexões do lote, com as pontas e as camadas de cada uma
     rotearConexao(cena, eb, con, opts) uma só conexão, em várias camadas (o mesmo motor do lote)
     lote(eb, opts)                    o mesmo lote como GERADOR: para depois de cada conexão com o
                                       progresso {fase, feitas, total, passe, roteadas, falhas} e
                                       devolve o relatório (a vista o roda num worker ou em fatias)
     rodaEmFatias(gen, {fatiaMs, aoProgresso, cancelado, agenda}) -> Promise {ok, valor|cancelado|erro}
     previa(ops) -> {tracks, vias}      as ops como objetos da placa (ids auto-t1.., auto-v1..)
     comPrevia(eb, ops)                a placa com as rotas, para o ratsnest e o DRC de "depois"
     novasViolacoes(drcAntes, drcDepois) as violações que as rotas criaram (a conta do MCP)
   O P2 (2026-10-29, o mesmo relato, itens 17 a 20):
     17  a árvore da net é o COBRE DESPEJADO DE VERDADE, não o contorno do polígono: o pedaço de plano
         (region poly:true com `de`) é obstáculo pela folga do PRÓPRIO polígono (a maior entre ela e a
         regra) — assim a rota nunca faz o plano recuar calado —, e o "depois" (ratsnest e DRC) sai da
         placa redespejada (redespeja: a mesma conta da placaDespejada do MCP e do comDespejo da vista).
         Depois das passadas o lote redespeja e confere: a net cujo plano partiu (o pad que ficou numa
         ilha recortada) acusa, e a rota que cortou o plano sai e é refeita sem cruzá-lo;
     18  FANOUT (fanout): cada pad SMD da net que ainda não chega ao plano ganha uma trilha curta e uma
         via que cai DENTRO do cobre do plano (com folga para o térmico), respeitando furo a furo,
         máscara e as vias que o próprio fanout acabou de pôr — 77 pads de GND sem via em cima de via;
     19  CRUZAR PLANO (cruzarPlanos): a trilha pode atravessar o polígono de OUTRA net (a de gate pelo
         plano de fase) com custo por mm dentro dele (custoPlano); o plano é redespejado em volta dela;
     20  VIA PROIBIDA em pad SMD (de qualquer net: nada de via no pad; viaEmPad:true libera) e na FAIXA
         ESTREITA de plano (largura < faixaPlano, padrão 2 mm, crescida de metade dela: o +74 que vai ao
         PS1) — a via e o térmico dela cortariam o plano. A trilha que cruza plano também não passa ali.
   Motivo de falha: 'camada-proibida' (a Routing Layers não deixa a camada da ponta), 'partida-bloqueada' /
   'chegada-bloqueada' (a ponta não cabe nem com a largura mínima da regra), 'sem-caminho' (nem contra a
   placa sozinha há caminho), 'bloqueada' (só o cobre deste lote fecha o caminho e o arranca-e-refaz não
   resolveu), 'orcamento' (estourou os nós da busca), 'tempo' (estourou o tempo do lote), 'corta-plano' (a rota cortava um
   plano de outra net e, sem cruzá-lo, não houve caminho). */
"use strict";
const HubAutoRoteador = (function(){

/* ============================== constantes ============================== */

/* mm de trilha que uma via "custa". Medido na PRJ-UR (174 conexões, todas fecham): 2 mm -> 163 vias
   em 6 s; 3 mm -> 137 em 12 s; 8 mm -> 111 em 16 s. Mais caro = menos via e rota mais longa */
const CUSTO_VIA = 3.0;
const PASSES = 4;             /* passadas de arranca-e-refaz */
const MAX_ARRANCA = 4;        /* vezes que uma rota do lote pode ser arrancada */
const TEMPO_MS = 60000;       /* orçamento de tempo do lote */
const NOS_BUSCA = 300000;     /* nós expandidos por busca (várias camadas) */
const PESO = 1.2;             /* a heurística pesa um pouco mais: a busca vai direto e a suavização endireita */
const JANELA_MM = 3;          /* a busca começa numa janela em volta das pontas, com esta margem... */
const JANELA_FRAC = 0.3;      /* ...ou esta fração do comprimento; sem caminho nela, a placa toda */
const CUSTO_BANDA = 0.2;      /* passo que encosta na banda: um pouco mais caro, a rota fica no meio do vão */
const ENCOSTA = 1e-3;         /* mm: pad da mesma net que não é ponta — a trilha não passa por cima */
const MAX_ESTADOS = 1.2e7;    /* teto de estados da grade de uma busca (camadas x nós) */
const SEM_DIR = 8;
const CUSTO_PLANO = 1.0;      /* mm a mais por mm de trilha dentro de um plano de outra net (cruzarPlanos) */
const FAIXA_PLANO = 2.0;      /* mm: faixa de plano mais estreita que isto não leva via nem é cruzada */
const FANOUT_DIST = 2.5;      /* mm: o fanout procura a via até esta distância da borda do pad */
const VOLTAS_PLANO = 3;       /* vezes que o lote redespeja e desfaz as rotas que cortaram plano */
const DI = [1, 1, 0, -1, -1, -1, 0, 1], DJ = [0, 1, 1, 1, 0, -1, -1, -1];
const SQ2 = Math.SQRT2;
const isNum = v => typeof v === 'number' && isFinite(v);
const r6 = v => { const x = Math.round(v * 1e6) / 1e6; return x === 0 ? 0 : x; };
const agora = (typeof performance === 'object' && performance && typeof performance.now === 'function')
  ? () => performance.now() : () => Date.now();
const ehPlano = k => /^Plane\d+$/.test(k);

/* os módulos irmãos: global no navegador, require no Node */
function mod(global, arquivo){
  if (global === 'HubRoteador' && typeof HubRoteador !== 'undefined' && HubRoteador) return HubRoteador;
  if (global === 'HubPcbNets' && typeof HubPcbNets !== 'undefined' && HubPcbNets) return HubPcbNets;
  if (global === 'HubPcbRegras' && typeof HubPcbRegras !== 'undefined' && HubPcbRegras) return HubPcbRegras;
  if (global === 'HubPcbPour' && typeof HubPcbPour !== 'undefined' && HubPcbPour) return HubPcbPour;
  try { if (typeof require === 'function') return require(arquivo); } catch (e) { /* sem o módulo */ }
  return null;
}
function exige(global, arquivo){
  const m = mod(global, arquivo);
  if (!m) throw new Error('HubAutoRoteador: falta o ' + arquivo + ' (' + global + ')');
  return m;
}

/* ============================== as pontas das conexões ============================== */

const ehTH = p => p.layer === 'Multi' || (!p.layer && p.type === 'th');
/* tudo o que pode ser ponta de uma linha do ratsnest, por id */
function indicePontas(eb){
  const m = new Map();
  for (const c of eb.components || []) for (const p of (c && c.pads) || []) if (p && p.id != null) m.set('pad|' + p.id, { o: p, comp: c });
  for (const p of eb.freepads || []) if (p && p.id != null) m.set('pad|' + p.id, { o: p, comp: null });
  for (const [k, t] of [['vias', 'via'], ['tracks', 'track'], ['arcs', 'arc'], ['fills', 'fill'], ['regions', 'region']])
    for (const o of eb[k] || []) if (o && o.id != null) m.set(t + '|' + o.id, { o, comp: null });
  return m;
}
/* a ponta: o ponto, as camadas em que ela existe (null = todas: pad passante e via) e o raio em que a
   chegada pode encaixar a última perna (dentro do cobre dela) */
function ponta(idx, ref, x, y){
  const r = ref && idx.get(ref.tipo + '|' + ref.id);
  const out = { x, y, tipo: ref ? ref.tipo : '', id: ref ? String(ref.id) : '', camadas: null, raio: 0, raioMax: 0, padId: null, nome: '' };
  if (!r) return out;
  const o = r.o;
  if (ref.tipo === 'pad') {
    out.padId = String(o.id);
    out.nome = (r.comp && r.comp.ref ? r.comp.ref + '.' : 'pad ') + (o.name != null ? o.name : o.id);
    if (!ehTH(o)) out.camadas = [o.layer];
    out.raio = Math.max(0, Math.min(o.w || 0, o.h || 0) / 2);
    out.raioMax = Math.max(0, Math.max(o.w || 0, o.h || 0) / 2);
  } else if (ref.tipo === 'via') { out.nome = 'via ' + o.id; out.raio = out.raioMax = (o.size || 0) / 2; }
  else { out.camadas = [o.layer]; out.raio = out.raioMax = (o.w || 0) / 2; out.nome = ref.tipo + ' ' + o.id; }
  return out;
}
/* as conexões do lote: as linhas abertas do ratsnest (filtradas por `nets`). A ponta mais APERTADA
   (pad SMD, o menor) vira a partida: a grade nasce nela e o primeiro passo sai exato do centro — o pad
   de passo fino como chegada obrigaria a achar um nó da grade, que nasce noutro lugar, no vão estreito
   entre os vizinhos dele */
function conexoesAbertas(eb, cena, opts){
  const NETS = exige('HubPcbNets', './hub-pcbnets.js');
  const o = opts || {};
  const filtro = Array.isArray(o.nets) && o.nets.length ? new Set(o.nets.map(String)) : null;
  const C = NETS.conexoes(eb), idx = indicePontas(eb), out = [];
  const aperto = p => (p.camadas ? 0 : 1000) + (p.raio > 0 ? p.raio : 999);
  (C.linhas || []).forEach((l, k) => {
    if (filtro && !filtro.has(l.net)) return;
    let a = ponta(idx, l.de, l.x1, l.y1), b = ponta(idx, l.para, l.x2, l.y2);
    if (aperto(b) < aperto(a)) { const t = a; a = b; b = t; }
    out.push({ id: 'c' + (k + 1), net: l.net, a, b, len: Math.hypot(l.x2 - l.x1, l.y2 - l.y1) });
  });
  return out;
}

/* ============================== a ordem ============================== */

/* o "peso" da regra da net (para a ordem 'classe'): trilha mais larga, via maior e folga maior saem
   primeiro — são as que menos cabem depois que o resto ocupou a placa */
function pesoDaNet(J, net){
  let p = J._peso.get(net);
  if (p !== undefined) return p;
  const RT = J.RT, C = J.cena;
  let w = 0;
  for (const l of J.camadasRota) w = Math.max(w, RT.larguraDaRegra(C, net, l).pref);
  const v = RT.viaDaRegra(C, net).size;
  let g = 0;
  if (C.regras && J.RG) {
    const d = RT.motor.descMao('track', net, J.camadasRota[0] || 'Top'), x = RT.motor.descMao('track', '\u0001outra', J.camadasRota[0] || 'Top');
    const f = J.RG.folgaEntre(C.regras, d, x);
    g = f && isNum(f.gap) ? f.gap : 0;
    /* a maior folga de par que alguma regra de escopo dá a esta net (Fase x baixa tensão) */
    for (const r of C.regras.regras ? C.regras.regras('Clearance') : []) {
      if (!r || !isNum(r.gap) || (r.scope1 === 'All' && r.scope2 === 'All')) continue;
      if (J.RG.avaliaEscopo(r.scope1, d, C.regras.ctx) === true || J.RG.avaliaEscopo(r.scope2, d, C.regras.ctx) === true) g = Math.max(g, r.gap);
    }
  }
  p = w * 4 + v + g;
  J._peso.set(net, p);
  return p;
}
function ordena(J, cons, ordem, nets){
  const L = cons.slice();
  const porLen = (a, b) => a.len - b.len || (a.id < b.id ? -1 : 1);
  if (Array.isArray(ordem) || ordem === 'dada') {
    const lista = Array.isArray(ordem) ? ordem : (nets || []);
    const pos = new Map(lista.map((n, i) => [String(n), i]));
    const p = c => pos.has(c.net) ? pos.get(c.net) : lista.length;
    L.sort((a, b) => p(a) - p(b) || porLen(a, b));
  } else if (ordem === 'longa') L.sort((a, b) => b.len - a.len || (a.id < b.id ? -1 : 1));
  else if (ordem === 'classe') L.sort((a, b) => pesoDaNet(J, b.net) - pesoDaNet(J, a.net) || porLen(a, b));
  else L.sort(porLen);
  return L;
}

/* ============================== o cobre do lote (camada extra) ============================== */

/* as rotas aceitas viram obstáculo: as trilhas de cada camada e as vias, num índice à parte
   (motor.montaExtra) refeito só quando o conjunto muda (versão) */
function extraDe(J, layer){
  let c = J._extra.get(layer);
  if (c && c.versao === J.versao) return c.L;
  const objs = [];
  for (const rt of J.rotas.values()) {
    for (const t of rt.trilhas) if (t.layer === layer) objs.push(t);
    for (const v of rt.vias) objs.push(v);
  }
  const L = objs.length ? J.M.montaExtra(J.cena, layer, objs) : null;
  J._extra.set(layer, { versao: J.versao, L });
  return L;
}
const rotaDoObst = id => { const i = id.indexOf('#'); return i > 0 ? id.slice(0, i) : id; };

/* ============================== furo e máscara da via ============================== */

/* Os dois cuidados do DRC da casa com a via que a folga de cobre não cobre: o FURO A FURO
   (HoleToHoleClearance, contra todo furo, de qualquer net) e a PONTE DE MÁSCARA
   (MinimumSolderMaskSliver: entre duas aberturas do mesmo lado, 0 < folga < mín. é violação). A via
   do lote fica com a abertura a pelo menos o mínimo de toda abertura — nunca sobreposta, que é o lado
   seguro (a via em cima do pad também não é coisa que o roteador deva fazer). As formas são as do
   hub-pcbdrc.js: pad pela forma do Gerber (octógono pelo retângulo que o contém: mais perto, logo
   conservador), furo redondo/oblongo/retangular girado com o pad, via redonda. */
function caixaG(cx, cy, hx, hy, rr, rotG, M){
  if (!(hx > 0) || !(hy > 0)) return null;
  rr = Math.max(0, Math.min(isNum(rr) ? rr : 0, hx, hy));
  const cs = M.cosSen(rotG || 0), a = hx - rr, b = hy - rr;
  const ex = Math.abs(a * cs[0]) + Math.abs(b * cs[1]) + rr, ey = Math.abs(a * cs[1]) + Math.abs(b * cs[0]) + rr;
  return { g: [cx, cy, a, b, rr, cs[0], cs[1]], bb: [cx - ex, cy - ey, cx + ex, cy + ey] };
}
function furoDe(p, M){
  const d = p.drill;
  if (!(d > 0) || !isNum(p.x) || !isNum(p.y)) return null;
  const forma = String(p.drillshape || 'circle').toLowerCase(), dw = p.drillw;
  const rot = (isNum(p.rot) ? p.rot : 0) + (isNum(p.holerot) ? p.holerot : 0);
  if ((forma === 'rect' || forma === 'square') && dw > 0) return caixaG(p.x, p.y, dw / 2, d / 2, 0, rot, M);
  if ((forma === 'oblong' || forma === 'slot') && dw > 0) return caixaG(p.x, p.y, dw / 2, d / 2, Math.min(dw, d) / 2, rot, M);
  return caixaG(p.x, p.y, d / 2, d / 2, d / 2, 0, M);
}
const descDRC = (tipo, net, layer, extra) => Object.assign({ tipo, net: net || '', layer, comp: '', footprint: '', smd: false, poly: false, pad: '', keepout: false, id: '' }, extra || {});
/* a expansão de máscara e o tenting de um objeto, como o DRC lê (o `sm` do objeto manda) */
function mascaraDe(J, src, desc, tipo, lado){
  const rM = (J.RES && J.RES.regraPara('SolderMaskExpansion', desc)) || {};
  const tamp = lado === 'Top' ? (src.tentTop !== undefined ? src.tentTop === true : (tipo === 'via' && rM.tentTop === true))
                              : (src.tentBot !== undefined ? src.tentBot === true : (tipo === 'via' && rM.tentBottom === true));
  const e = isNum(src.sm) ? src.sm : (isNum(rM.expansion) ? rM.expansion : 0);
  return { tamp, e };
}
function novoIndiceFuros(J){
  const M = J.M, eb = J.eb, itens = [];
  const poeFuro = (cx, desc, net, id) => { if (cx) itens.push({ furo: true, lado: null, g: cx.g, bb: cx.bb, desc, net, id }); };
  const poeAbertura = (cx, lado, desc, id) => { if (cx) itens.push({ furo: false, lado, g: cx.g, bb: cx.bb, desc, id }); };
  const pad = (p, c) => {
    if (!p || !isNum(p.x) || !isNum(p.y)) return;
    const th = ehTH(p), ref = c && c.ref ? String(c.ref) : '';
    if (th && p.drill > 0) poeFuro(furoDe(p, M), descDRC('hole', p.net, 'Multi', { comp: ref }), p.net || '', p.id);
    const dPad = descDRC('pad', p.net, th ? 'Multi' : p.layer, { comp: ref, footprint: c && c.footprint ? String(c.footprint) : '', smd: !th, pad: ref + '-' + (p.name != null ? p.name : '') });
    for (const lado of ['Top', 'Bottom']) {
      if (!th && p.layer !== lado) continue;
      const mk = mascaraDe(J, p, dPad, 'pad', lado);
      if (mk.tamp) continue;
      const f = M.caixaDaForma(M.formaLado(p, lado === 'Bottom'));
      if (!f) continue;
      const c0 = M.centroCobre(p), rr = f.rr > 0 ? f.rr + mk.e : 0;
      poeAbertura(caixaG(c0[0], c0[1], f.hx + mk.e, f.hy + mk.e, rr, p.rot || 0, M), lado, dPad, p.id);
    }
  };
  for (const c of eb.components || []) for (const p of (c && c.pads) || []) pad(p, c);
  for (const p of eb.freepads || []) pad(p, null);
  for (const v of eb.vias || []) {
    if (!v || !isNum(v.x) || !isNum(v.y) || !(v.size > 0)) continue;
    if (v.drill > 0) poeFuro(caixaG(v.x, v.y, v.drill / 2, v.drill / 2, v.drill / 2, 0, M), descDRC('hole', v.net, 'Multi'), v.net || '', v.id);
    const dV = descDRC('via', v.net, 'Multi');
    for (const lado of ['Top', 'Bottom']) {
      const mk = mascaraDe(J, v, dV, 'via', lado);
      if (!mk.tamp) poeAbertura(caixaG(v.x, v.y, v.size / 2 + mk.e, v.size / 2 + mk.e, v.size / 2 + mk.e, 0, M), lado, dV, v.id);
    }
  }
  /* o que está desenhado na máscara também é abertura (pela caixa: conservador) */
  const ladoM = L => L === 'TopSolder' ? 'Top' : L === 'BottomSolder' ? 'Bottom' : null;
  for (const f of eb.fills || []) if (f && ladoM(f.layer) && [f.x1, f.y1, f.x2, f.y2].every(isNum))
    poeAbertura(caixaG((f.x1 + f.x2) / 2, (f.y1 + f.y2) / 2, Math.abs(f.x2 - f.x1) / 2, Math.abs(f.y2 - f.y1) / 2, 0, f.rot || 0, M), ladoM(f.layer), descDRC('fill', '', f.layer), f.id);
  for (const s of (eb.lines || []).concat(eb.tracks || [])) if (s && ladoM(s.layer) && [s.x1, s.y1, s.x2, s.y2].every(isNum)) {
    const L = Math.hypot(s.x2 - s.x1, s.y2 - s.y1), r = (s.w || 0) / 2;
    poeAbertura(caixaG((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, L / 2 + r, Math.max(r, 1e-6), r, Math.atan2(s.y2 - s.y1, s.x2 - s.x1) * 180 / Math.PI, M), ladoM(s.layer), descDRC('track', '', s.layer), s.id);
  }
  for (const g of eb.regions || []) if (g && ladoM(g.layer) && Array.isArray(g.points) && g.points.length) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const q of g.points) { x1 = Math.min(x1, q[0]); x2 = Math.max(x2, q[0]); y1 = Math.min(y1, q[1]); y2 = Math.max(y2, q[1]); }
    poeAbertura(caixaG((x1 + x2) / 2, (y1 + y2) / 2, (x2 - x1) / 2, (y2 - y1) / 2, 0, 0, M), ladoM(g.layer), descDRC('region', '', g.layer), g.id);
  }
  return gradeFuros(itens);
}
const CELULA_F = 2;
function gradeFuros(itens){
  const G = new Map();
  itens.forEach((it, k) => {
    for (let i = Math.floor(it.bb[0] / CELULA_F); i <= Math.floor(it.bb[2] / CELULA_F); i++)
      for (let j = Math.floor(it.bb[1] / CELULA_F); j <= Math.floor(it.bb[3] / CELULA_F); j++) {
        const c = i * 100003 + j;
        let L = G.get(c); if (!L) G.set(c, L = []);
        L.push(k);
      }
  });
  return { itens, G };
}
/* os itens perto de (x,y) até `raio`, cada um uma vez */
function cadaFuro(F, x, y, raio, fn){
  if (!F || !F.itens.length) return;
  const visto = new Set();
  for (let i = Math.floor((x - raio) / CELULA_F); i <= Math.floor((x + raio) / CELULA_F); i++)
    for (let j = Math.floor((y - raio) / CELULA_F); j <= Math.floor((y + raio) / CELULA_F); j++) {
      const L = F.G.get(i * 100003 + j);
      if (L) for (const k of L) if (!visto.has(k)) { visto.add(k); fn(F.itens[k]); }
    }
}
/* os furos e aberturas das vias DESTE lote (refeito por versão) */
function furosDoLote(J){
  if (J._furosLote && J._furosLote.versao === J.versao) return J._furosLote.F;
  const itens = [];
  for (const rt of J.rotas.values()) for (const v of rt.vias) {
    itens.push({ furo: true, lado: null, g: [v.x, v.y, 0, 0, v.drill / 2, 1, 0], bb: [v.x - v.drill / 2, v.y - v.drill / 2, v.x + v.drill / 2, v.y + v.drill / 2],
                 desc: descDRC('hole', v.net, 'Multi'), net: v.net, id: v.id });
    const dV = descDRC('via', v.net, 'Multi');
    for (const lado of ['Top', 'Bottom']) {
      const mk = mascaraDe(J, v, dV, 'via', lado);
      if (mk.tamp) continue;
      const r = v.size / 2 + mk.e;
      if (r > 0) itens.push({ furo: false, lado, g: [v.x, v.y, 0, 0, r, 1, 0], bb: [v.x - r, v.y - r, v.x + r, v.y + r], desc: dV, id: v.id });
    }
  }
  const F = gradeFuros(itens);
  J._furosLote = { versao: J.versao, F };
  return F;
}
/* as folgas da via contra furos e aberturas, pela regra do par (guardadas por descritor) */
function regraPar(J, kind, a, b, campo){
  if (!J.RES) return kind === 'HoleToHoleClearance' ? 0.254 : 0.254;
  let m = J._regraPar.get(a);
  if (!m) { m = new Map(); J._regraPar.set(a, m); }
  const k = kind + '|' + (b.tipo + '|' + b.net + '|' + b.layer + '|' + b.comp + '|' + b.footprint + '|' + b.pad + '|' + b.smd);
  let v = m.get(k);
  if (v === undefined) {
    const r = J.RES.regraPara(kind, a, b);
    v = r && isNum(r[campo]) ? r[campo] : 0;
    m.set(k, v);
  }
  return v;
}
/* a via em (x,y) passa no furo a furo e na ponte de máscara? `quem` (Set) recebe os ids que barram */
function viaFuroOk(J, S, x, y, quem, soLote){
  const vd = S.vd, rH = vd.drill / 2;
  let ok = true;
  const raio = Math.max(vd.size / 2 + S.maskMax.e, rH) + Math.max(J.maxSliver, J.maxFuroFuro) + 0.05;
  const confere = it => {
    if (!ok && !quem) return;
    const d = J.M.sdPontoCaixa(it.g, 0, x, y);
    if (it.furo) {
      const gap = regraPar(J, 'HoleToHoleClearance', S.descFuro, it.desc, 'gap');
      if (d - rH < gap - 1e-9) { ok = false; if (quem) quem.add(it.id); }
    } else {
      const mk = S.mask[it.lado];
      if (mk.tamp) return;
      const min = regraPar(J, 'MinimumSolderMaskSliver', S.descVia, it.desc, 'min');
      if (!(min > 0)) return;
      if (d - (vd.size / 2 + mk.e) < min - 1e-9) { ok = false; if (quem) quem.add(it.id); }
    }
  };
  if (!soLote) cadaFuro(J.furos, x, y, raio, confere);
  if (!S.semExtra || soLote) cadaFuro(furosDoLote(J), x, y, raio, confere);
  return ok;
}

/* ============================== as regras de uma conexão ============================== */

/* a regra-base de (camada, net, largura, tipo da mão) fica guardada: montá-la percorre todos os
   obstáculos da camada e resolve a Clearance de cada par, e o lote pergunta pelas mesmas centenas
   de vezes (o cache do hub-roteador guarda 64 mãos por camada — pouco para um lote de muitas nets) */
function regraGuardada(J, layer, net, meia, tipo){
  const k = layer + '|' + net + '|' + meia + '|' + tipo;
  let R = J._regras.get(k);
  if (R) { J._regras.delete(k); J._regras.set(k, R); return R; }
  const M = J.M, L = M.camada(J.cena, layer), N = M.idDaNet(J.cena, net, false);
  R = M.regraBase(J.cena, L, N, null, meia, M.descMao(tipo, net, tipo === 'via' ? undefined : layer));
  R.N = N;
  /* o pedaço de plano de OUTRA net, pela folga do polígono quando ela passa a da regra: o redespejo
     recua dela, e a rota encostada só na da regra faria o plano recuar (e às vezes partir) calado */
  for (const [oi, pl] of obstPlano(J, layer, L)) {
    if (pl.net === net || !R.bloq[oi]) continue;
    const l = meia + folgaPol(pl.pol, tipo === 'via' ? 'via' : 'track', net);
    if (l > R.lim[oi]) { R.lim[oi] = l; if (l > R.T) R.T = l; }
  }
  if (tipo === 'track') {
    /* pad da MESMA net que não é ponta: obstáculo encostado (a trilha nunca passa por cima) */
    const pads = padsDaNet(J, layer, L, N);
    for (const oi of pads) { R.bloq[oi] = 1; R.lim[oi] = meia + ENCOSTA; if (R.lim[oi] > R.T) R.T = R.lim[oi]; }
    R._padsNet = pads;
  }
  J._regras.set(k, R);
  if (J._regras.size > 192) J._regras.delete(J._regras.keys().next().value);
  return R;
}
function padsDaNet(J, layer, L, N){
  let m = J._padsNet.get(layer);
  if (!m) {
    m = new Map();
    L.obst.forEach((o, oi) => { if (o.tipo === 'pad' && o.netId > 0) { let a = m.get(o.netId); if (!a) m.set(o.netId, a = []); a.push(oi); } });
    J._padsNet.set(layer, m);
  }
  return N > 0 ? (m.get(N) || []) : [];
}
/* pendura a camada extra numa regra (ou tira) */
function comExtra(J, R, layer, net, meia, tipo, semExtra){
  if (semExtra) { R.extra = null; return R; }
  const Lx = extraDe(J, layer);
  if (!Lx) { R.extra = null; return R; }
  const M = J.M;
  const Rx = M.regraBase(J.cena, Lx, M.idDaNet(J.cena, net, false), null, meia, M.descMao(tipo, net, tipo === 'via' ? undefined : layer));
  Rx.m = R.m;
  R.extra = Rx;
  return R;
}
/* o estado exato de um ponto (margem zero) */
function pontoOk(M, R, x, y){
  const m = R.m;
  R.m = 0; if (R.extra) R.extra.m = 0;
  const s = M.estadoPonto(R, x, y);
  R.m = m; if (R.extra) R.extra.m = m;
  return s !== M.BLOQ;
}

/* ============================== a busca de várias camadas ============================== */

let POOL = null;
function pool(n, nn){
  if (!POOL || POOL.cap < n || POOL.capN < nn) {
    const cap = Math.max(n, POOL ? POOL.cap : 0), capN = Math.max(nn, POOL ? POOL.capN : 0);
    POOL = { cap, capN, estado: new Uint8Array(cap), arSab: new Uint8Array(cap), arOk: new Uint8Array(cap), g: new Float32Array(cap),
             marca: new Uint32Array(cap), pai: new Int32Array(cap), dirIn: new Uint8Array(cap), viaSab: new Uint8Array(capN), plSab: new Uint8Array(cap),
             hn: new Int32Array(1 << 16), hk: new Float64Array(1 << 16), hlen: 0, gen: 0 };
  }
  POOL.estado.fill(0, 0, n); POOL.arSab.fill(0, 0, n); POOL.viaSab.fill(0, 0, nn);
  return POOL;
}
function heapPush(B, n, f){
  let i = B.hlen++;
  if (i >= B.hn.length) {
    const hn = new Int32Array(B.hn.length * 2); hn.set(B.hn); B.hn = hn;
    const hk = new Float64Array(B.hk.length * 2); hk.set(B.hk); B.hk = hk;
  }
  const hn = B.hn, hk = B.hk;
  while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= f) break; hn[i] = hn[p]; hk[i] = hk[p]; i = p; }
  hn[i] = n; hk[i] = f;
}
function heapPop(B){
  const hn = B.hn, hk = B.hk, top = hn[0], n = --B.hlen;
  if (n > 0) {
    const ln = hn[n], lk = hk[n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && hk[c + 1] < hk[c]) c++;
      if (hk[c] >= lk) break;
      hn[i] = hn[c]; hk[i] = hk[c]; i = c;
    }
    hn[i] = ln; hk[i] = lk;
  }
  return top;
}

/* A BUSCA. S = a conexão pronta (camadas, regras, janela). Devolve o estado de chegada ou -1. */
function busca(J, S){
  const M = J.M, NI = S.NI, NJ = S.NJ, NN = NI * NJ, nl = S.nl, B = pool(nl * NN, NN);
  const estado = B.estado, arSab = B.arSab, arOk = B.arOk, g = B.g, marca = B.marca, pai = B.pai, dirIn = B.dirIn, viaSab = B.viaSab;
  let gen = ++B.gen;
  if (gen >= 0x7ffffff0) { marca.fill(0); B.gen = gen = 1; }
  const ABERTO = gen * 2, FECHADO = ABERTO + 1;
  const res = S.res, x0 = S.dx + S.iMin * res, y0 = S.dy + S.jMin * res;
  const LIVRE = M.LIVRE, BANDA = M.BANDA, BLOQ = M.BLOQ;
  const ti = S.ti, tj = S.tj, peso = S.peso, K2 = SQ2 - 2, viaP = S.viaPassos;
  /* modo '90': só os 4 vizinhos (a rota sai em L, como a Trilha da vista em 90°) */
  const passoDir = J.modo === '90' ? 2 : 1;
  const est = (li, n) => {
    const s = li * NN + n;
    let e = estado[s];
    if (e) return e;
    const i = n % NI, j = (n - i) / NI;
    e = M.estadoPonto(S.RL[li], x0 + i * res, y0 + j * res);
    estado[s] = e;
    return e;
  };
  const aresta = (li, n, d, m) => {
    const s = li * NN + n, bit = 1 << d;
    if (arSab[s] & bit) return (arOk[s] & bit) !== 0;
    const i = n % NI, j = (n - i) / NI, i2 = m % NI, j2 = (m - i2) / NI;
    const ok = M.segLivre(S.RL[li], x0 + i * res, y0 + j * res, x0 + i2 * res, y0 + j2 * res);
    const s2 = li * NN + m, bitR = 1 << ((d + 4) & 7);
    arSab[s] |= bit; arSab[s2] |= bitR;
    if (ok) { arOk[s] |= bit; arOk[s2] |= bitR; } else { arOk[s] &= ~bit; arOk[s2] &= ~bitR; }
    return ok;
  };
  const viaOk = n => {
    let v = viaSab[n];
    if (v) return v === 1;
    const i = n % NI, j = (n - i) / NI, x = x0 + i * res, y = y0 + j * res;
    let ok = !viaProibida(J, S, x, y) && viaFuroOk(J, S, x, y, null, false);
    if (ok) for (const Rv of S.RV) if (!pontoOk(M, Rv, x, y)) { ok = false; break; }
    viaSab[n] = ok ? 1 : 2;
    return ok;
  };
  const h = (i, j, li) => {
    const a = i > ti ? i - ti : ti - i, b = j > tj ? j - tj : tj - j;
    return ((a + b + K2 * (a < b ? a : b)) + (S.fimCam[li] ? 0 : viaP)) * peso;
  };
  /* o plano de outra net que esta conexão pode cruzar (19): 1 fora, 2 dentro (custa), 3 faixa estreita */
  const plS = S.cruza ? B.plSab : null;
  if (plS) plS.fill(0, 0, nl * NN);
  const plano = (li, n) => {
    const s = li * NN + n;
    let v = plS[s];
    if (v) return v;
    const i = n % NI, j = (n - i) / NI;
    v = estadoPlano(J, S, li, x0 + i * res, y0 + j * res);
    plS[s] = v;
    return v;
  };
  B.hlen = 0;
  const n0 = S.s0;
  for (let li = 0; li < nl; li++) {
    if (!S.iniCam[li] || !S.iniOk[li]) continue;
    const s = li * NN + n0;
    g[s] = 0; marca[s] = ABERTO; dirIn[s] = SEM_DIR; pai[s] = -1;
    heapPush(B, s, h(n0 % NI, (n0 - n0 % NI) / NI, li));
  }
  const ax = S.b.x, ay = S.b.y, r2 = S.rFim * S.rFim;
  let nos = 0;
  while (B.hlen > 0) {
    const s = heapPop(B);
    if (marca[s] === FECHADO) continue;
    marca[s] = FECHADO;
    nos++;
    const li = (s / NN) | 0, n = s - li * NN, i = n % NI, j = (n - i) / NI;
    const x = x0 + i * res, y = y0 + j * res;
    if (S.fimCam[li]) {
      const dx = x - ax, dy = y - ay;
      if (dx * dx + dy * dy <= r2 && M.segLivre(S.RL[li], x, y, ax, ay)) { S.nos = nos; return s; }
    }
    if (nos >= S.orcNos) { S.nos = nos; S.estourou = true; return -1; }
    const gn = g[s], din = dirIn[s], sn = est(li, n);
    for (let d = 0; d < 8; d += passoDir) {
      let curva = 0;
      if (din !== SEM_DIR && din !== d) {
        let dd = d > din ? d - din : din - d;
        if (dd > 4) dd = 8 - dd;
        if (dd > 2) continue;                /* volta de mais de 90°: ângulo agudo, nunca */
        curva = dd * S.curva;
      }
      const ii = i + DI[d], jj = j + DJ[d];
      if (ii < 0 || ii >= NI || jj < 0 || jj >= NJ) continue;
      const m = n + DI[d] + DJ[d] * NI, sm2 = li * NN + m;
      if (marca[sm2] === FECHADO) continue;
      const em = est(li, m);
      if (em === BLOQ) continue;
      if ((sn !== LIVRE || em !== LIVRE) && !aresta(li, n, d, m)) continue;
      let dentro = 0;
      if (plS && S.cruza[li]) {
        const pv = plano(li, m);
        if (pv === 3) continue;
        if (pv === 2) dentro = ((d & 1) ? SQ2 : 1) * S.custoPlano;
      }
      const ng = gn + ((d & 1) ? SQ2 : 1) + curva + (em === BANDA ? CUSTO_BANDA : 0) + dentro;
      if (marca[sm2] !== ABERTO || ng < g[sm2]) {
        g[sm2] = ng; dirIn[sm2] = d; pai[sm2] = s; marca[sm2] = ABERTO;
        heapPush(B, sm2, ng + h(ii, jj, li));
      }
    }
    /* a via: as outras camadas no mesmo ponto */
    if (nl > 1) {
      let fez = 0;
      for (let lj = 0; lj < nl; lj++) {
        if (lj === li) continue;
        const s2 = lj * NN + n;
        if (marca[s2] === FECHADO) continue;
        const ng = gn + viaP;
        if (marca[s2] === ABERTO && ng >= g[s2]) continue;
        if (est(lj, n) === BLOQ) continue;
        if (fez === 0) fez = viaOk(n) ? 1 : 2;
        if (fez === 2) break;
        g[s2] = ng; dirIn[s2] = SEM_DIR; pai[s2] = s; marca[s2] = ABERTO;
        heapPush(B, s2, ng + h(i, j, lj));
      }
    }
  }
  S.nos = nos;
  S.esgotou = true;
  return -1;
}

/* ============================== uma conexão ============================== */

/* a janela da busca: as pontas com margem, presa à caixa da cena (que já tem 2 mm em volta da placa) */
function janela(J, a, b, margem){
  const bb = J.cena.bbox;
  return { x1: Math.max(bb.x1, Math.min(a.x, b.x) - margem), y1: Math.max(bb.y1, Math.min(a.y, b.y) - margem),
           x2: Math.min(bb.x2, Math.max(a.x, b.x) + margem), y2: Math.min(bb.y2, Math.max(a.y, b.y) + margem) };
}
/* monta a busca da conexão com uma largura (pref ou mín. por camada) e uma janela */
function preparaBusca(J, con, larg, jan, semExtra){
  const M = J.M, net = con.net, res = J.res;
  const Lr = J.camadasRota.filter(l => J.RT.camadaPermitida(J.cena, net, l));
  const S = { con, net, res, camadas: Lr, nl: Lr.length, a: con.a, b: con.b, semExtra: !!semExtra, peso: J.peso, curva: J.curva,
              viaPassos: J.custoVia / res, orcNos: J.nosPorBusca, nos: 0, estourou: false, esgotou: false };
  if (!Lr.length) { S.motivo = 'camada-proibida'; return S; }
  S.iniCam = Lr.map(l => !con.a.camadas || con.a.camadas.includes(l));
  S.fimCam = Lr.map(l => !con.b.camadas || con.b.camadas.includes(l));
  if (!S.iniCam.some(Boolean) || !S.fimCam.some(Boolean)) { S.motivo = 'camada-proibida'; return S; }
  S.w = Lr.map(l => larg(l));
  /* as regras das camadas de sinal, com os pads das pontas liberados: o pad que é a ponta e todo pad
     da net que CONTÉM uma das pontas (a ponta de trilha que o ratsnest escolheu no centro de um pad) */
  const libera = [con.a.padId, con.b.padId].filter(Boolean);
  S.RL = Lr.map((l, li) => {
    const R = regraGuardada(J, l, net, S.w[li] / 2, 'track');
    R.m = res * SQ2 / 2;
    return comExtra(J, R, l, net, S.w[li] / 2, 'track', semExtra);
  });
  S.soltos = [];
  S.RL.forEach(R => {
    const L = R.L;
    for (const oi of R._padsNet || []) {
      if (!R.bloq[oi]) continue;
      if (libera.includes(L.obst[oi].id) || M.sdObst(L, null, oi, con.a.x, con.a.y) <= M.TOL || M.sdObst(L, null, oi, con.b.x, con.b.y) <= M.TOL) {
        S.soltos.push([R, oi, R.bloq[oi]]);
        R.bloq[oi] = 0;
      }
    }
  });
  /* a via: a da regra da net, conferida em TODA camada de cobre (a passante atravessa os planos) */
  S.vd = J.RT.viaDaRegra(J.cena, net);
  S.descVia = descDRC('via', net, 'Multi');
  S.descFuro = descDRC('hole', net, 'Multi');
  S.mask = { Top: mascaraDe(J, {}, S.descVia, 'via', 'Top'), Bottom: mascaraDe(J, {}, S.descVia, 'via', 'Bottom') };
  S.maskMax = { e: Math.max(S.mask.Top.e, S.mask.Bottom.e, 0) };
  S.RV = Lr.length > 1 ? J.camadasVia.map(l => {
    const R = regraGuardada(J, l, net, S.vd.size / 2, 'via');
    R.m = 0;
    return comExtra(J, R, l, net, S.vd.size / 2, 'via', semExtra);
  }) : [];
  /* 19: os planos de outra net que esta conexão pode atravessar saem do caminho (o redespejo recua) —
     na trilha, com custo por mm dentro (busca), e na via; nunca na faixa estreita (20) */
  S.cruza = null;
  S.custoPlano = J.custoPlano;
  if (J.planos.cruzaveis) {
    const pode = pl => pl.cruzavel && pl.net !== net && !(con.semCruzar && con.semCruzar.has(pl.id));
    const solta = (R, layer) => {
      const L = R.L, out = [];
      for (const [oi, pl] of obstPlano(J, layer, L)) {
        if (!pode(pl) || !R.bloq[oi]) continue;
        S.soltos.push([R, oi, R.bloq[oi]]);
        R.bloq[oi] = 0;
        out.push([oi, pl]);
      }
      return out;
    };
    const porCam = S.RL.map((R, li) => solta(R, Lr[li]));
    S.RV.forEach((R, k) => solta(R, J.camadasVia[k]));
    if (porCam.some(x => x.length)) S.cruza = porCam;
  }
  /* a grade: ancorada na partida */
  S.dx = con.a.x; S.dy = con.a.y;
  S.iMin = Math.min(0, Math.floor((jan.x1 - S.dx) / res)); S.jMin = Math.min(0, Math.floor((jan.y1 - S.dy) / res));
  const iMax = Math.max(0, Math.ceil((jan.x2 - S.dx) / res)), jMax = Math.max(0, Math.ceil((jan.y2 - S.dy) / res));
  S.NI = iMax - S.iMin + 1; S.NJ = jMax - S.jMin + 1;
  if (S.NI * S.NJ * S.nl > MAX_ESTADOS) { S.motivo = 'orcamento'; return S; }
  S.s0 = (0 - S.jMin) * S.NI + (0 - S.iMin);
  let ti = Math.round((con.b.x - S.dx) / res) - S.iMin, tj = Math.round((con.b.y - S.dy) / res) - S.jMin;
  S.ti = Math.max(0, Math.min(S.NI - 1, ti)); S.tj = Math.max(0, Math.min(S.NJ - 1, tj));
  /* a chegada encaixa a última perna (conferida exata) de qualquer nó até o maior meio-lado da ponta:
     no pad comprido de passo fino, os nós ao longo do eixo dele */
  S.rFim = Math.max(1.5 * res * SQ2, Math.min(con.b.raioMax || con.b.raio || 0, 1.0));
  /* as pontas cabem? (o ponto exato, com a largura desta tentativa) */
  S.iniOk = S.RL.map((R, li) => S.iniCam[li] && pontoOk(M, R, con.a.x, con.a.y));
  S.fimOk = S.RL.map((R, li) => S.fimCam[li] && pontoOk(M, R, con.b.x, con.b.y));
  if (!S.iniOk.some(Boolean)) S.motivo = 'partida-bloqueada';
  else if (!S.fimOk.some(Boolean)) S.motivo = 'chegada-bloqueada';
  return S;
}
function soltaRegras(S){
  for (const [R, oi, v] of S.soltos || []) R.bloq[oi] = v;
  S.soltos = [];
}
/* o caminho da busca -> trechos por camada e vias, suavizados e conferidos */
function montaRota(J, S, sFim){
  const M = J.M, B = POOL, NN = S.NI * S.NJ, res = S.res, x0 = S.dx + S.iMin * res, y0 = S.dy + S.jMin * res;
  const estados = [];
  for (let s = sFim, guarda = S.nl * NN + 1; s >= 0 && guarda-- > 0; s = B.pai[s]) estados.push(s);
  estados.reverse();
  const xy = s => { const n = s % NN, i = n % S.NI, j = (n - i) / S.NI; return [x0 + i * res, y0 + j * res]; };
  const trechos = [];
  let cur = null;
  for (const s of estados) {
    const li = (s / NN) | 0, p = xy(s);
    if (!cur) { cur = { li, pts: [[S.a.x, S.a.y]] }; continue; }
    if (li === cur.li) cur.pts.push(p);
    else { trechos.push(cur); cur = { li, pts: [cur.pts[cur.pts.length - 1].slice()], via: true }; }
  }
  cur.pts.push([S.b.x, S.b.y]);
  trechos.push(cur);
  /* suaviza cada trecho na regra da camada dele (pontas fixas: a partida, as vias, a chegada) */
  const trilhas = [], vias = [], cruza = new Set();
  let comp = 0, ok = true;
  trechos.forEach((T, k) => {
    const R = S.RL[T.li], layer = S.camadas[T.li], w = S.w[T.li];
    const cru = M.limpa(T.pts);
    let pts = cru;
    if (pts.length > 1) {
      const sv = M.suaviza(R, pts, true, J.modo, J.modo === '45' ? 'diag' : 'v');
      if (sv.chegou) pts = sv.pts;
      pts = M.limpa(M.tiraDegraus(R, M.limpa(pts), J.modo, M.DEGRAU * res));
    }
    /* a suavização não sabe da faixa estreita do plano que a conexão cruza: se o atalho dela entra na
       faixa, fica o caminho da grade (que a busca já desviou dela) */
    if (S.cruza && S.cruza[T.li] && S.cruza[T.li].length) {
      const confere = P => { const c = new Set(); for (let q = 1; q < P.length; q++) if (!segPlano(J, S, T.li, P[q - 1], P[q], c)) return null; return c; };
      let c = confere(pts);
      if (!c) { pts = cru; c = confere(pts); }
      if (!c) ok = false; else for (const id of c) cruza.add(id);
    }
    for (let q = 1; q < pts.length; q++) {
      const A = pts[q - 1], C = pts[q];
      if (!M.segLivre(R, A[0], A[1], C[0], C[1])) ok = false;
      trilhas.push({ layer, x1: A[0], y1: A[1], x2: C[0], y2: C[1], w, net: S.net });
      comp += Math.hypot(C[0] - A[0], C[1] - A[1]);
    }
    if (k > 0) {
      const p = T.pts[0];
      vias.push({ x: p[0], y: p[1], size: S.vd.size, drill: S.vd.drill, net: S.net });
    }
  });
  /* a conferência final da via: furo, máscara e cobre em toda camada, exata */
  for (const v of vias) {
    if (viaProibida(J, S, v.x, v.y)) ok = false;
    if (!viaFuroOk(J, S, v.x, v.y, null, false)) ok = false;
    for (const Rv of S.RV) if (!pontoOk(M, Rv, v.x, v.y)) ok = false;
    /* a via dentro de plano de outra net também o recorta */
    if (S.cruza) for (const pl of J.planos.lista) if (pl.cruzavel && pl.net !== S.net && dentroPlano(J, pl, v.x, v.y)) cruza.add(pl.id);
  }
  return { ok, trilhas, vias, comprimento: comp, camadas: [...new Set(trechos.map(t => S.camadas[t.li]))], cruza };
}
/* uma tentativa: largura e janela dadas */
function tenta(J, con, larg, jan, semExtra){
  const S = preparaBusca(J, con, larg, jan, semExtra);
  if (S.motivo) { soltaRegras(S); return { ok: false, motivo: S.motivo, nos: 0, S }; }
  const sFim = busca(J, S);
  let out;
  if (sFim < 0) out = { ok: false, motivo: S.estourou ? 'orcamento' : 'sem-caminho', nos: S.nos, S };
  else {
    const r = montaRota(J, S, sFim);
    out = r.ok ? { ok: true, rota: r, nos: S.nos, S } : { ok: false, motivo: 'sem-caminho', nos: S.nos, S, conferencia: false };
  }
  soltaRegras(S);
  return out;
}
/* A CONEXÃO: largura preferida da regra (na janela, depois na placa toda); se a ponta não cabe nela,
   a mínima da regra. semExtra = só contra a placa (o teste do arranca-e-refaz). */
function roteia(J, con, semExtra){
  const RT = J.RT, C = J.cena, net = con.net;
  const pref = l => RT.larguraDaRegra(C, net, l).pref;
  const minima = l => { const r = RT.larguraDaRegra(C, net, l); return isNum(r.min) && r.min > 0 && r.min < r.pref ? r.min : r.pref; };
  const larguras = [pref];
  if (J.camadasRota.some(l => minima(l) < pref(l) - 1e-9)) larguras.push(minima);
  const m = Math.max(J.janelaMm, J.janelaFrac * con.len);
  const janelas = [janela(J, con.a, con.b, m)];
  const bb = C.bbox, jt = janelas[0];
  if (jt.x1 > bb.x1 + 1e-9 || jt.y1 > bb.y1 + 1e-9 || jt.x2 < bb.x2 - 1e-9 || jt.y2 < bb.y2 - 1e-9) janelas.push({ x1: bb.x1, y1: bb.y1, x2: bb.x2, y2: bb.y2 });
  let ult = null, nos = 0;
  for (const larg of larguras) {
    for (const jan of janelas) {
      const r = tenta(J, con, larg, jan, semExtra);
      nos += r.nos || 0;
      if (r.ok) { r.nos = nos; return r; }
      ult = r;
      /* a ponta não cabe com esta largura: janela maior não ajuda, vai para a mínima */
      if (r.motivo === 'partida-bloqueada' || r.motivo === 'chegada-bloqueada' || r.motivo === 'camada-proibida' || r.motivo === 'orcamento') break;
    }
    if (ult && ult.motivo === 'camada-proibida') break;
  }
  ult.nos = nos;
  return ult;
}

/* ============================== os planos (P2: itens 17 a 20) ============================== */

/* OS PLANOS DO HUB: cada polígono de cobre (eb.polygons) com os pedaços que o despejo deixou na placa
   (regions poly:true com `de` = o id dele). É o cobre de verdade — a ilha recortada não entra no
   contorno —, e é ele que o lote redespeja. `pol` leva a folga das regras (HubPcbPour.comRegras, a
   mesma que a vista e o MCP põem antes de despejar). cruzar = true | [id, nome ou net de polígono]. */
function planosDe(J, cruzar){
  const eb = J.eb, out = { lista: [], porId: new Map(), porRegiao: new Map(), cruzaveis: false };
  const pols = (eb.polygons || []).filter(q => q && q.id != null && q.pour !== 'none' && Array.isArray(q.pts) && q.pts.length >= 3 && J.M.ehCobre(q.layer));
  if (!pols.length) return out;
  let comR = null;
  if (J.PO && typeof J.PO.comRegras === 'function' && J.RES) { try { comR = J.PO.comRegras(eb, J.RES); } catch (e) { comR = null; } }
  const polR = new Map(((comR && comR.polygons) || []).filter(Boolean).map(q => [String(q.id), q]));
  const lista = Array.isArray(cruzar) ? new Set(cruzar.map(String)) : null;
  for (const q of pols) {
    const id = String(q.id), net = typeof q.net === 'string' ? q.net : '';
    const cruzavel = cruzar === true || (!!lista && (lista.has(id) || (net !== '' && lista.has(net)) || (q.nome != null && lista.has(String(q.nome)))));
    const pl = { id, net, layer: q.layer, nome: q.nome || '', pol: polR.get(id) || q, regioes: [], cruzavel, aneis: null, zonas: null, bb: null };
    out.lista.push(pl);
    out.porId.set(id, pl);
  }
  for (const g of eb.regions || []) {
    if (!g || !g.poly || g.de == null || !Array.isArray(g.points) || g.points.length < 3) continue;
    const pl = out.porId.get(String(g.de));
    if (!pl) continue;
    pl.regioes.push(g);
    if (g.id != null) out.porRegiao.set(String(g.id), pl);
  }
  for (const pl of out.lista) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const g of pl.regioes) for (const q of g.points) { if (q[0] < x1) x1 = q[0]; if (q[0] > x2) x2 = q[0]; if (q[1] < y1) y1 = q[1]; if (q[1] > y2) y2 = q[1]; }
    pl.bb = x1 <= x2 ? [x1, y1, x2, y2] : null;
  }
  out.cruzaveis = out.lista.some(p => p.cruzavel);
  return out;
}
/* a folga do polígono para um objeto de outra net (a do hub-pcbpour.js » folgaDe) */
function folgaPol(pol, tipo, net){
  const cn = pol && pol.clearanceNet && net ? pol.clearanceNet[net] : null;
  if (cn) { if (isNum(cn[tipo])) return cn[tipo]; if (isNum(cn['*'])) return cn['*']; }
  if (pol && pol.clearanceTipo && isNum(pol.clearanceTipo[tipo])) return pol.clearanceTipo[tipo];
  if (pol && isNum(pol.clearance)) return pol.clearance;
  return 0.254;
}
/* os obstáculos da camada que são pedaço de plano do hub: [[oi, plano]] (guardado pelo índice) */
function obstPlano(J, layer, L){
  if (!J.planos || !J.planos.lista.length) return [];
  let c = J._obstPlano.get(layer);
  if (c && c.L === L) return c.v;
  const v = [];
  L.obst.forEach((ob, oi) => {
    if (ob.tipo !== 'regiao') return;
    const pl = J.planos.porRegiao.get(String(ob.id));
    if (pl) v.push([oi, pl]);
  });
  J._obstPlano.set(layer, { L, v });
  return v;
}
/* ponto em anel (par/ímpar) e o anel com a caixa, para as contas fora do índice do motor */
function anelDe(pts){
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const q of pts) { if (q[0] < x1) x1 = q[0]; if (q[0] > x2) x2 = q[0]; if (q[1] < y1) y1 = q[1]; if (q[1] > y2) y2 = q[1]; }
  return { pts, bb: [x1, y1, x2, y2] };
}
function noAnel(A, x, y){
  const b = A.bb;
  if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) return false;
  const P = A.pts;
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const xi = P[i][0], yi = P[i][1], xj = P[j][0], yj = P[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function distAnelPt(A, x, y){
  const P = A.pts;
  let d = Infinity;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const ax = P[j][0], ay = P[j][1], dx = P[i][0] - ax, dy = P[i][1] - ay, L2 = dx * dx + dy * dy;
    let t = L2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + t * dx - x, qy = ay + t * dy - y, e = qx * qx + qy * qy;
    if (e < d) d = e;
  }
  return Math.sqrt(d);
}
/* uma "área" (contorno + furos) a partir de {points|pts, holes} */
function areaDe(g){
  return { fora: anelDe(g.points || g.pts), furos: (Array.isArray(g.holes) ? g.holes : []).filter(h => Array.isArray(h) && h.length >= 3).map(anelDe) };
}
function naArea(A, x, y){
  if (!noAnel(A.fora, x, y)) return false;
  for (const h of A.furos) if (noAnel(h, x, y)) return false;
  return true;
}
/* o ponto está no cobre do plano? */
function dentroPlano(J, pl, x, y){
  const b = pl.bb;
  if (!b || x < b[0] || x > b[2] || y < b[1] || y > b[3]) return false;
  if (!pl.aneis) pl.aneis = pl.regioes.map(areaDe);
  for (const A of pl.aneis) if (naArea(A, x, y)) return true;
  return false;
}
/* 20: o ponto está na FAIXA ESTREITA do plano (HubPcbPour.estreitas: o cobre que não cabe num disco de
   faixaPlano mm, crescido de metade dela)? Montada só quando alguém pergunta perto do plano */
function emFaixa(J, pl, x, y){
  const b = pl.bb;
  if (!b || !(J.faixaPlano > 0) || x < b[0] || x > b[2] || y < b[1] || y > b[3]) return false;
  if (!pl.zonas) {
    let z = [];
    if (J.PO && typeof J.PO.estreitas === 'function') {
      try { z = J.PO.estreitas(pl.regioes, J.faixaPlano, J.faixaPlano / 2); } catch (e) { z = []; }
    }
    pl.zonas = z.map(areaDe);
  }
  for (const A of pl.zonas) if (naArea(A, x, y)) return true;
  return false;
}
/* o estado do nó (li, x, y) quanto aos planos que a conexão cruza: 1 fora, 2 dentro, 3 faixa estreita */
function estadoPlano(J, S, li, x, y){
  const L = S.RL[li].L;
  for (const [oi, pl] of S.cruza[li]) {
    if (!J.M.dentroObst(L, oi, x, y)) continue;
    return emFaixa(J, pl, x, y) ? 3 : 2;
  }
  return 1;
}
/* a perna A-C na camada li: false se entra em faixa estreita; `cruza` recebe os planos atravessados */
function segPlano(J, S, li, A, C, cruza){
  const lista = S.cruza[li], L = S.RL[li].L;
  const len = Math.hypot(C[0] - A[0], C[1] - A[1]), n = Math.max(1, Math.ceil(len / Math.min(0.05, J.res / 2)));
  for (let k = 0; k <= n; k++) {
    const x = A[0] + (C[0] - A[0]) * k / n, y = A[1] + (C[1] - A[1]) * k / n;
    for (const [oi, pl] of lista) {
      if (!J.M.dentroObst(L, oi, x, y)) continue;
      if (emFaixa(J, pl, x, y)) return false;
      cruza.add(pl.id);
    }
  }
  return true;
}
/* 20: a via em (x,y) cairia num pad SMD (de qualquer net) ou na faixa estreita de um plano? */
function viaProibida(J, S, x, y){
  const r = S.vd.size / 2;
  if (J.smd) {
    let em = false;
    cadaFuro(J.smd, x, y, r + 0.05, it => { if (!em && J.M.sdPontoCaixa(it.g, 0, x, y) < r - 1e-9) em = true; });
    if (em) return true;
  }
  for (const pl of J.planos.lista) if (emFaixa(J, pl, x, y)) return true;
  return false;
}
/* os pads SMD (o cobre deles, pela forma do Gerber) num índice de grade */
function indiceSmd(J){
  const M = J.M, itens = [];
  const pad = p => {
    if (!p || ehTH(p) || !isNum(p.x) || !isNum(p.y)) return;
    const f = M.caixaDaForma(M.formaLado(p, p.layer === 'Bottom'));
    if (!f) return;
    const c0 = M.centroCobre(p), cx = caixaG(c0[0], c0[1], f.hx, f.hy, f.rr, p.rot || 0, M);
    if (cx) itens.push({ g: cx.g, bb: cx.bb, id: p.id });
  };
  for (const c of J.eb.components || []) for (const p of (c && c.pads) || []) pad(p);
  for (const p of J.eb.freepads || []) pad(p);
  return gradeFuros(itens);
}
/* as rotas do lote como ops (sem arredondar: para o redespejo e o ratsnest de conferência) */
function opsDasRotas(J){
  const ops = [];
  for (const r of J.rotas.values()) {
    for (const t of r.trilhas) ops.push({ op: 'track_add', layer: t.layer, x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2, w: t.w, net: t.net });
    for (const v of r.vias) ops.push({ op: 'via_add', x: v.x, y: v.y, size: v.size, drill: v.drill, net: v.net });
  }
  return ops;
}

/* 17: A PLACA COM AS OPS E OS PLANOS REDESPEJADOS — a mesma conta da placaDespejada do MCP e do
   comDespejo da vista: a folga das regras nos polígonos (comRegras), cada um despejado na ordem, e
   os pedaços dele (regions poly:true com `de`) trocados pelos novos (ids q:<polígono>:<n>). O cobre
   do Altium sem polígono no espelho fica como veio. Sem hub-pcbpour ou sem polígono: o comPrevia.
   opts {pour (o HubPcbPour), regras (conjunto ou resolvedor), textoGeo} */
function redespeja(eb, ops, opts){
  const o = opts || {}, PO = o.pour || mod('HubPcbPour', './hub-pcbpour.js');
  const base = ops && ops.length ? comPrevia(eb, ops) : eb;
  const pols = (base.polygons || []).filter(q => q && q.id != null && q.pour !== 'none' && Array.isArray(q.pts) && q.pts.length >= 3);
  if (!PO || typeof PO.despeja !== 'function' || !pols.length) return base;
  const ids = new Set(pols.map(q => String(q.id)));
  let ebR = base;
  if (o.regras && typeof PO.comRegras === 'function') { try { ebR = PO.comRegras(base, o.regras); } catch (e) { ebR = base; } }
  const polR = new Map((ebR.polygons || []).filter(Boolean).map(q => [q.id, q]));
  const opD = typeof o.textoGeo === 'function' ? { texto: o.textoGeo } : undefined;
  let novas = [];
  for (const pol of pols.map(q => polR.get(q.id) || q).sort((a, b) => (a.ordem || 0) - (b.ordem || 0))) {
    const d = PO.despeja(ebR, pol, opD);
    const reg = (d && (d.regioes || d)) || [];
    if (Array.isArray(reg)) novas = novas.concat(reg);
  }
  return Object.assign({}, base, {
    regions: (base.regions || []).filter(g => !(g && g.poly && g.de != null && ids.has(String(g.de))))
      .concat(novas.map((g, i) => {
        const r = { id: 'q:' + g.de + ':' + i, layer: g.layer, net: g.net, points: g.pts || g.points, poly: true, de: g.de };
        if (g.holes && g.holes.length) r.holes = g.holes;
        return r;
      })),
  });
}
/* 17: as nets cujo ratsnest PIOROU só porque os planos foram redespejados em volta das rotas do lote (o
   plano partiu: um pad ficou numa ilha recortada), e as rotas que cruzaram um plano delas.
   -> null (nada piorou) | {nets, rotas:[[conId, [plano...]]]} */
function cortaramPlano(J, eb){
  if (!J.planos.lista.length || !J.PO) return null;
  const NETS = exige('HubPcbNets', './hub-pcbnets.js');
  const ops = opsDasRotas(J);
  if (!ops.length) return null;
  const sem = NETS.naoRoteadas(comPrevia(eb, ops));
  const com = NETS.naoRoteadas(redespeja(eb, ops, { pour: J.PO, regras: J.RES, textoGeo: J.textoGeo }));
  const f0 = new Map(sem.nets.map(n => [n.net, n.faltam]));
  const nets = com.nets.filter(n => n.faltam > (f0.get(n.net) || 0)).map(n => n.net);
  if (!nets.length) return null;
  const ns = new Set(nets), rotas = [];
  for (const [id, r] of J.rotas) {
    if (!r.cruza || !r.cruza.size) continue;
    const pls = [...r.cruza].filter(pid => { const pl = J.planos.porId.get(pid); return pl && ns.has(pl.net); });
    if (pls.length) rotas.push([id, pls]);
  }
  return { nets, rotas };
}

/* ============================== 18: o fanout ============================== */

/* O FANOUT DE UMA NET (o GND de 77 pads da placa de potência): cada pad SMD da net que ainda não chega
   ao plano dela ganha uma trilha reta curta, na camada do pad, até uma via que cai DENTRO do cobre do
   plano (a pelo menos o raio da via + o térmico do polígono da borda dele: o raio do térmico precisa
   achar cobre). A via respeita o mesmo que a do lote — folga de cada camada pela regra, furo a furo,
   ponte de máscara, nada em pad SMD nem em faixa estreita de plano — e as vias que o fanout acabou de
   pôr (são cobre do lote: a seguinte não cai em cima). A direção preferida é a de FORA do componente.
   opts (além das do rotearLote: regras, cena, roteador, textoGeo, cruzarPlanos, faixaPlano...):
     net (obrigatória), camada | [camadas] (as do plano; padrão: todas em que a net tem cobre de plano),
     pads 'abertos' (padrão: só os que não chegam ao plano) | 'todos', distMax (mm além da borda do pad,
     padrão 2,5), note
   -> {ops, net, camadas, pads, jaLigados, feitos, falhas:[{pad, motivo}], vias, comprimento, ms,
       depois:{ligados, semPlano:[pad...]}}   motivo: 'sem-lugar' | 'camada-proibida' |
       'plano-so-na-camada-do-pad' */
function fanout(eb, opts){
  const t0 = agora(), o = opts || {};
  const NETS = exige('HubPcbNets', './hub-pcbnets.js');
  const net = typeof o.net === 'string' ? o.net.trim() : '';
  if (!net) throw new Error('HubAutoRoteador.fanout: falta a net (ex.: GND)');
  const J = montaJob(eb, o), M = J.M, RT = J.RT, C = J.cena;
  const note = typeof o.note === 'string' && o.note ? String(o.note).replace(/":/g, '" :') : 'fanout ' + net;
  const distMax = isNum(o.distMax) && o.distMax > 0 ? o.distMax : FANOUT_DIST;
  const pedidas = o.camada ? new Set([].concat(o.camada).map(String)) : null;
  const ehPlanoDaNet = g => g && !g.keepout && g.net === net && M.ehCobre(g.layer) && Array.isArray(g.points) && g.points.length >= 3 && (!pedidas || pedidas.has(g.layer));
  const rel = { ops: [], net, camadas: [], pads: 0, jaLigados: 0, feitos: 0, falhas: [], vias: 0, comprimento: 0, ms: 0 };
  /* o plano: os pedaços de cobre da net (o despejo do hub e o que veio do Altium) */
  const planoDe = e => (e.regions || []).filter(ehPlanoDaNet);
  const regs = planoDe(eb).map(g => Object.assign(areaDe(g), { g, layer: g.layer, pl: g.de != null ? J.planos.porId.get(String(g.de)) : null }));
  rel.camadas = [...new Set(regs.map(r => r.layer))];
  if (!regs.length) { rel.motivo = 'sem-plano'; rel.ms = Math.round(agora() - t0); return rel; }
  /* os pads SMD da net */
  const pads = [];
  for (const c of eb.components || []) for (const p of (c && c.pads) || []) if (p && p.net === net && !ehTH(p) && isNum(p.x) && isNum(p.y)) pads.push({ p, comp: c });
  for (const p of eb.freepads || []) if (p && p.net === net && !ehTH(p) && isNum(p.x) && isNum(p.y)) pads.push({ p, comp: null });
  const nomeDe = x => (x.comp && x.comp.ref ? x.comp.ref + '.' : 'pad ') + (x.p.name != null ? x.p.name : x.p.id);
  pads.sort((a, b) => nomeDe(a) < nomeDe(b) ? -1 : nomeDe(a) > nomeDe(b) ? 1 : 0);
  /* o pad já chega ao plano? (a ilha dele no ratsnest tem um pedaço do plano — o pad SMD na própria camada
     do plano já está nele pelo despejo) */
  const ligadosEm = e => {
    const cam = new Map((e.regions || []).filter(ehPlanoDaNet).map(g => [String(g.id), g.layer]));
    const I = ((NETS.conexoes(e).nets || {})[net] || {}).ilhas || [];
    const m = new Map();
    for (const ilha of I) {
      const cams = new Set(ilha.filter(r => r.tipo === 'region' && cam.has(String(r.id))).map(r => cam.get(String(r.id))));
      for (const r of ilha) if (r.tipo === 'pad') m.set(String(r.id), cams);
    }
    return x => { const cams = m.get(String(x.p.id)); return !!cams && cams.size > 0; };
  };
  const ligado = ligadosEm(eb);
  /* a via da regra da net e o S que o viaFuroOk / viaProibida pedem */
  const vd = RT.viaDaRegra(C, net);
  const S = { vd, net, descVia: descDRC('via', net, 'Multi'), descFuro: descDRC('hole', net, 'Multi'), semExtra: false };
  S.mask = { Top: mascaraDe(J, {}, S.descVia, 'via', 'Top'), Bottom: mascaraDe(J, {}, S.descVia, 'via', 'Bottom') };
  S.maskMax = { e: Math.max(S.mask.Top.e, S.mask.Bottom.e, 0) };
  const rv = vd.size / 2;
  /* a via cai no plano, longe da borda: raio + o térmico do polígono (o raio precisa achar cobre) */
  const noPlano = (x, y, alvo) => regs.some(A => {
    if (!alvo.includes(A.layer) || !naArea(A, x, y)) return false;
    const P = A.pl && A.pl.pol, con = P && (P.conexaoVia || P.conexao);
    const prof = rv + (A.pl ? (con && isNum(con.gap) ? con.gap : 0.254) + (con && isNum(con.largura) ? con.largura : 0.254) : 0.1);
    if (distAnelPt(A.fora, x, y) < prof) return false;
    for (const h of A.furos) if (distAnelPt(h, x, y) < prof) return false;
    return true;
  });
  let k = 0;
  for (const x of pads) {
    rel.pads++;
    const p = x.p, nome = nomeDe(x);
    if (o.pads !== 'todos' && ligado(x)) { rel.jaLigados++; continue; }
    const alvo = rel.camadas.filter(l => l !== p.layer);
    if (!alvo.length) { rel.falhas.push({ pad: nome, motivo: 'plano-so-na-camada-do-pad' }); continue; }
    if (!RT.camadaPermitida(C, net, p.layer)) { rel.falhas.push({ pad: nome, motivo: 'camada-proibida' }); continue; }
    const c0 = M.centroCobre(p), f = M.caixaDaForma(M.formaLado(p, p.layer === 'Bottom'));
    const hx = f ? f.hx : (p.w || 0) / 2, hy = f ? f.hy : (p.h || 0) / 2;
    const cs = M.cosSen(p.rot || 0);
    /* para fora do componente */
    let ox = 0, oy = 0;
    if (x.comp && isNum(x.comp.x) && isNum(x.comp.y)) { ox = c0[0] - x.comp.x; oy = c0[1] - x.comp.y; const n = Math.hypot(ox, oy); if (n > 1e-9) { ox /= n; oy /= n; } else ox = oy = 0; }
    const larg = RT.larguraDaRegra(C, net, p.layer);
    const larguras = [larg.pref];
    if (isNum(larg.min) && larg.min > 0 && larg.min < larg.pref - 1e-9) larguras.push(larg.min);
    let achou = null;
    for (const w of larguras) {
      const R = regraGuardada(J, p.layer, net, w / 2, 'track');
      R.m = 0;
      comExtra(J, R, p.layer, net, w / 2, 'track', false);
      const soltos = [];
      for (const oi of R._padsNet || []) if (R.bloq[oi] && (String(R.L.obst[oi].id) === String(p.id) || M.sdObst(R.L, null, oi, c0[0], c0[1]) <= M.TOL)) { soltos.push(oi); R.bloq[oi] = 0; }
      const RV = J.camadasVia.map(l => { const Rv = regraGuardada(J, l, net, rv, 'via'); Rv.m = 0; return comExtra(J, Rv, l, net, rv, 'via', false); });
      /* cruzarPlanos vale para a via do fanout também (fora da faixa estreita) */
      const soltosV = [];
      if (J.planos.cruzaveis) RV.forEach((Rv, i) => { for (const [oi, pl] of obstPlano(J, J.camadasVia[i], Rv.L)) if (pl.cruzavel && pl.net !== net && Rv.bloq[oi]) { soltosV.push([Rv, oi]); Rv.bloq[oi] = 0; } });
      const cand = [];
      for (let d = 0; d < 8; d++) {
        const a = ((p.rot || 0) + d * 45) * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a);
        const lx = ux * cs[0] + uy * cs[1], ly = -ux * cs[1] + uy * cs[0];
        const ext = Math.abs(lx) * hx + Math.abs(ly) * hy;
        const pena = (1 - (ux * ox + uy * oy)) * 0.75;
        for (let t = ext + rv + 0.1; t <= ext + distMax + 1e-9; t += J.res) cand.push({ x: c0[0] + ux * t, y: c0[1] + uy * t, t, custo: t + pena });
      }
      cand.sort((a, b) => a.custo - b.custo);
      for (const c of cand) {
        if (viaProibida(J, S, c.x, c.y)) continue;
        if (!viaFuroOk(J, S, c.x, c.y, null, false)) continue;
        let ok = true;
        for (const Rv of RV) if (!pontoOk(M, Rv, c.x, c.y)) { ok = false; break; }
        if (!ok || !M.segLivre(R, c0[0], c0[1], c.x, c.y)) continue;
        if (!noPlano(c.x, c.y, alvo)) continue;
        achou = { x: c.x, y: c.y, t: c.t, w };
        break;
      }
      for (const oi of soltos) R.bloq[oi] = 1;
      for (const [Rv, oi] of soltosV) Rv.bloq[oi] = 1;
      if (achou) break;
    }
    if (!achou) { rel.falhas.push({ pad: nome, motivo: 'sem-lugar' }); continue; }
    const rota = { trilhas: [{ layer: p.layer, x1: c0[0], y1: c0[1], x2: achou.x, y2: achou.y, w: achou.w, net }],
                   vias: [{ x: achou.x, y: achou.y, size: vd.size, drill: vd.drill, net }], comprimento: achou.t, camadas: [p.layer], cruza: new Set() };
    poe(J, { id: 'F' + (++k), net }, rota);
    rel.feitos++; rel.vias++; rel.comprimento += achou.t;
  }
  for (const r of J.rotas.values()) {
    for (const t of r.trilhas) rel.ops.push({ op: 'track_add', layer: t.layer, x1: r6(t.x1), y1: r6(t.y1), x2: r6(t.x2), y2: r6(t.y2), w: t.w, net, note });
    for (const v of r.vias) rel.ops.push({ op: 'via_add', x: r6(v.x), y: r6(v.y), size: v.size, drill: v.drill, net, note });
  }
  rel.comprimento = r6(rel.comprimento);
  /* 17: quem chega ao plano DEPOIS, na placa redespejada (a via ganha o térmico dela) */
  if (rel.ops.length) {
    const ebD = J.planos.lista.length ? redespeja(eb, rel.ops, { pour: J.PO, regras: J.RES, textoGeo: J.textoGeo }) : comPrevia(eb, rel.ops);
    const lig = ligadosEm(ebD), sem = pads.filter(x => !lig(x)).map(nomeDe);
    rel.depois = { ligados: pads.length - sem.length, semPlano: sem.slice(0, 80) };
  } else rel.depois = { ligados: rel.jaLigados, semPlano: [] };
  rel.ms = Math.round(agora() - t0);
  return rel;
}

/* ============================== o lote ============================== */

function poe(J, con, rota){
  const rid = 'R' + con.id;
  rota.trilhas.forEach((t, k) => { t.id = rid + '#t' + k; t.tipo = 'trilha'; });
  rota.vias.forEach((v, k) => { v.id = rid + '#v' + k; v.tipo = 'via'; });
  rota.con = con;
  J.rotas.set(con.id, rota);
  J.versao++;
}
function tira(J, conId){
  const r = J.rotas.get(conId);
  if (r) { J.rotas.delete(conId); J.versao++; }
  return r;
}
/* as rotas deste lote que o caminho (achado só contra a placa) atravessa */
function culpados(J, con, rota){
  const M = J.M, out = new Set(), net = con.net;
  for (const t of rota.trilhas) {
    const Lx = extraDe(J, t.layer);
    if (!Lx) continue;
    const R = M.regraBase(J.cena, Lx, M.idDaNet(J.cena, net, false), null, t.w / 2, M.descMao('track', net, t.layer));
    for (const oi of M.conflitosSeg(R, t.x1, t.y1, t.x2, t.y2, new Map()).keys()) out.add(rotaDoObst(Lx.obst[oi].id));
  }
  if (rota.vias.length) {
    const vd = J.RT.viaDaRegra(J.cena, net);
    const S = { vd, descVia: descDRC('via', net, 'Multi'), descFuro: descDRC('hole', net, 'Multi'), semExtra: false };
    S.mask = { Top: mascaraDe(J, {}, S.descVia, 'via', 'Top'), Bottom: mascaraDe(J, {}, S.descVia, 'via', 'Bottom') };
    S.maskMax = { e: Math.max(S.mask.Top.e, S.mask.Bottom.e, 0) };
    for (const v of rota.vias) {
      for (const l of J.camadasVia) {
        const Lx = extraDe(J, l);
        if (!Lx) continue;
        const R = M.regraBase(J.cena, Lx, M.idDaNet(J.cena, net, false), null, vd.size / 2, M.descMao('via', net));
        for (const oi of M.conflitosPonto(R, v.x, v.y, new Map()).keys()) out.add(rotaDoObst(Lx.obst[oi].id));
      }
      const quem = new Set();
      viaFuroOk(J, S, v.x, v.y, quem, true);
      for (const id of quem) out.add(rotaDoObst(String(id)));
    }
  }
  /* o id da rota é 'R' + id da conexão */
  return [...out].filter(x => /^R/.test(x)).map(x => x.slice(1));
}
function fotografia(J, falhas){ return { rotas: new Map(J.rotas), falhas: new Map(falhas) }; }
function placar(J, f){
  let vias = 0, comp = 0;
  for (const r of f.rotas.values()) { vias += r.vias.length; comp += r.comprimento; }
  return [f.falhas.size, vias, comp];
}
const melhorQue = (a, b) => a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2] - 1e-6)));

function montaJob(eb, opts){
  const o = opts || {};
  /* o roteador de quem montou a cena (o MCP recarrega os módulos pelo mtime): cena e motor da mesma carga */
  const RT = o.roteador && o.roteador.motor ? o.roteador : exige('HubRoteador', './hub-roteador.js');
  const RG = mod('HubPcbRegras', './hub-pcbregras.js');
  const cena = o.cena || RT.cena(eb, { regras: o.regras, clearance: o.clearance, placa: o.placa, textoGeo: o.textoGeo, res: o.res });
  const M = RT.motor;
  /* as camadas montadas antes de qualquer pergunta pela net (o número da net nasce no índice) */
  for (const l of cena.camadas) M.camada(cena, l);
  const pedidas = Array.isArray(o.camadas) && o.camadas.length ? new Set(o.camadas.map(String)) : null;
  const camadasRota = cena.camadas.filter(l => !ehPlano(l) && (!pedidas || pedidas.has(l)));
  /* o resolvedor que o DRC usaria (o da cena, ou o padrão da casa + board.rules quando a cena não tem
     regras): é dele que saem o furo a furo, a ponte de máscara e a expansão de máscara da via */
  let RES = cena.regras;
  if (!RES && RG) { try { RES = RG.resolvedor(RG.doBoard(eb), { board: eb }); } catch (e) { RES = null; } }
  const S0 = RES && RES.regras ? RES : null;
  const maior = (kind, campo) => { let m = 0; for (const r of S0 ? S0.regras(kind) : []) if (r && isNum(r[campo])) m = Math.max(m, r[campo]); return m; };
  const orc = o.orcamento || {};
  const J = {
    eb, cena, RT, RG, M, RES, camadasRota, camadasVia: cena.camadas.slice(), res: cena.res,
    custoVia: isNum(o.custoVia) && o.custoVia >= 0 ? o.custoVia : CUSTO_VIA,
    peso: isNum(o.peso) && o.peso >= 1 ? o.peso : PESO, curva: M.CURVA,
    modo: o.modo === '90' ? '90' : '45',
    janelaMm: JANELA_MM, janelaFrac: JANELA_FRAC,
    tempoMs: isNum(orc.tempoMs) && orc.tempoMs > 0 ? orc.tempoMs : TEMPO_MS,
    nosPorBusca: isNum(orc.nosPorBusca) && orc.nosPorBusca > 0 ? orc.nosPorBusca : NOS_BUSCA,
    rotas: new Map(), versao: 0, _extra: new Map(), _regras: new Map(), _padsNet: new Map(), _peso: new Map(), _regraPar: new WeakMap(),
    maxSliver: S0 ? maior('MinimumSolderMaskSliver', 'min') : 0.254, maxFuroFuro: S0 ? maior('HoleToHoleClearance', 'gap') : 0.254,
  };
  J.furos = novoIndiceFuros(J);
  /* P2 (17-20): os planos do hub, o pad SMD (via proibida), o redespejo */
  J.PO = mod('HubPcbPour', './hub-pcbpour.js');
  J.textoGeo = typeof o.textoGeo === 'function' ? o.textoGeo : cena.textoGeo;
  J.custoPlano = isNum(o.custoPlano) && o.custoPlano >= 0 ? o.custoPlano : CUSTO_PLANO;
  J.faixaPlano = isNum(o.faixaPlano) && o.faixaPlano >= 0 ? o.faixaPlano : FAIXA_PLANO;
  J.viaEmPad = o.viaEmPad === true;
  J.planos = planosDe(J, o.cruzarPlanos);
  J._obstPlano = new Map();
  J.smd = J.viaEmPad ? null : indiceSmd(J);
  return J;
}

/* uma conexão só, fora de lote (a mesma busca): {ok, rota:{trilhas, vias, comprimento}, motivo} */
function rotearConexao(cena, eb, con, opts){
  const J = montaJob(eb, Object.assign({}, opts || {}, { cena }));
  const r = roteia(J, con, false);
  return { ok: r.ok, rota: r.ok ? r.rota : null, motivo: r.ok ? null : r.motivo, nos: r.nos };
}

/* O LOTE COMO GERADOR (2026-10-28, para a vista PCB): o mesmo lote do rotearLote, que para depois de
   cada conexão com o progresso — {fase:'rota'|'conserto', feitas, total, passe, roteadas, falhas} — e
   devolve (done) o relatório. Quem o roda decide o ritmo: o rotearLote vai direto ao fim; o worker da
   vista (hub-autoroteador-worker.js) manda o progresso à tela; sem worker, o rodaEmFatias o roda em
   fatias de tempo, sem travar a página, e para quando pedem para cancelar. */
function* lote(eb, opts){
  const t0 = agora(), o = opts || {};
  const NETS = exige('HubPcbNets', './hub-pcbnets.js');
  const J = montaJob(eb, o);
  const tempoAcabou = () => agora() - t0 > J.tempoMs;
  const nrAntes = NETS.naoRoteadas(eb);
  const cons = ordena(J, conexoesAbertas(eb, J.cena, o), o.ordem, o.nets);
  const porId = new Map(cons.map(c => [c.id, c]));
  const falhas = new Map(), permanentes = new Map(), arrancadas = new Map();
  let esgotouTempo = false, totalArranca = 0, passes = 0, nosTotal = 0;
  const progresso = (fase, feitas, total) => ({ fase, feitas, total, passe: passes, roteadas: J.rotas.size, falhas: falhas.size, conexoes: cons.length, ms: Math.round(agora() - t0) });
  yield progresso('rota', 0, cons.length);

  /* 1a passada: na ordem */
  let feitas = 0;
  for (const con of cons) {
    if (tempoAcabou()) { esgotouTempo = true; falhas.set(con.id, 'tempo'); continue; }
    const r = roteia(J, con, false);
    nosTotal += r.nos || 0;
    if (r.ok) poe(J, con, r.rota); else falhas.set(con.id, r.motivo);
    yield progresso('rota', ++feitas, cons.length);
  }
  let melhor = fotografia(J, falhas), placarMelhor = placar(J, melhor);
  const primeira = { falhas: falhas.size };

  /* arranca e refaz */
  const npasses = isNum(o.passes) && o.passes >= 0 ? Math.floor(o.passes) : PASSES;
  for (let ps = 0; ps < npasses && falhas.size && !esgotouTempo; ps++) {
    passes++;
    const pend = cons.filter(c => falhas.has(c.id));
    let vistas = 0;
    for (const con of pend) {
      if (vistas++) yield progresso('conserto', vistas - 1, pend.length);
      if (!falhas.has(con.id)) continue;
      if (tempoAcabou()) { esgotouTempo = true; break; }
      const motivo = falhas.get(con.id);
      if (permanentes.has(con.id) || motivo === 'camada-proibida' || motivo === 'partida-bloqueada' || motivo === 'chegada-bloqueada') continue;
      /* a que estourou os nós da busca ganha um orçamento maior nas passadas de conserto */
      const nos0 = J.nosPorBusca;
      if (motivo === 'orcamento') J.nosPorBusca = nos0 * 4;
      /* sem o cobre do lote há caminho? */
      const sozinha = roteia(J, con, true);
      nosTotal += sozinha.nos || 0;
      if (!sozinha.ok) { J.nosPorBusca = nos0; permanentes.set(con.id, sozinha.motivo); falhas.set(con.id, sozinha.motivo === 'orcamento' ? 'orcamento' : 'sem-caminho'); continue; }
      const conserta = () => { const r = roteia(J, con, false); nosTotal += r.nos || 0; return r; };
      const cul = culpados(J, con, sozinha.rota).filter(id => J.rotas.has(id));
      if (!cul.length) {
        const r = conserta();
        J.nosPorBusca = nos0;
        if (r.ok) { poe(J, con, r.rota); falhas.delete(con.id); }
        else falhas.set(con.id, r.motivo === 'orcamento' ? 'orcamento' : 'bloqueada');
        continue;
      }
      if (cul.some(id => (arrancadas.get(id) || 0) >= MAX_ARRANCA)) { J.nosPorBusca = nos0; falhas.set(con.id, 'bloqueada'); continue; }
      const tiradas = cul.map(id => [id, tira(J, id)]);
      const r = conserta();
      J.nosPorBusca = nos0;
      if (!r.ok) {
        /* nem assim: devolve as arrancadas e segue */
        for (const [id, rt] of tiradas) { J.rotas.set(id, rt); }
        J.versao++;
        falhas.set(con.id, 'bloqueada');
        continue;
      }
      poe(J, con, r.rota);
      falhas.delete(con.id);
      for (const [id] of tiradas.sort((a, b) => cons.indexOf(porId.get(a[0])) - cons.indexOf(porId.get(b[0])))) {
        arrancadas.set(id, (arrancadas.get(id) || 0) + 1);
        totalArranca++;
        const c2 = porId.get(id);
        const r2 = roteia(J, c2, false);
        nosTotal += r2.nos || 0;
        if (r2.ok) poe(J, c2, r2.rota); else falhas.set(id, 'bloqueada');
      }
    }
    const f = fotografia(J, falhas), pl = placar(J, f);
    if (melhorQue(pl, placarMelhor)) { melhor = f; placarMelhor = pl; }
  }
  /* fica o melhor */
  J.rotas = melhor.rotas; J.versao++;
  for (const k of [...falhas.keys()]) falhas.delete(k);
  for (const [k, v] of melhor.falhas) falhas.set(k, v);

  /* 17: redespeja e confere — a rota que cortou um plano de outra net (o pad que ficou numa ilha
     recortada) sai e é refeita sem cruzá-lo */
  const planos = { cruzaveis: J.planos.lista.filter(p => p.cruzavel).map(p => p.id), voltas: 0, desfeitas: 0, pioraram: [] };
  for (let v = 0; v < VOLTAS_PLANO && !esgotouTempo; v++) {
    const ruins = cortaramPlano(J, eb);
    if (!ruins) break;
    planos.voltas++;
    planos.pioraram = ruins.nets;
    if (!ruins.rotas.length) break;
    yield progresso('planos', v, VOLTAS_PLANO);
    for (const [conId, plIds] of ruins.rotas) {
      const con = porId.get(conId);
      tira(J, conId);
      planos.desfeitas++;
      con.semCruzar = con.semCruzar || new Set();
      for (const id of plIds) con.semCruzar.add(id);
      const r = roteia(J, con, false);
      nosTotal += r.nos || 0;
      if (r.ok) { poe(J, con, r.rota); falhas.delete(conId); } else falhas.set(conId, 'corta-plano');
    }
    if (tempoAcabou()) esgotouTempo = true;
  }

  return relatorio(J, eb, cons, falhas, { t0, nrAntes, passes, totalArranca, esgotouTempo, nosTotal, primeira, o, planos });
}
function rotearLote(eb, opts){
  const g = lote(eb, opts);
  for (;;) { const p = g.next(); if (p.done) return p.value; }
}

/* as ops do changes.js e o relatório */
function relatorio(J, eb, cons, falhas, X){
  const NETS = exige('HubPcbNets', './hub-pcbnets.js');
  const note = typeof X.o.note === 'string' && X.o.note ? String(X.o.note).replace(/":/g, '" :') : 'autorotear';
  const ops = [], porNet = new Map(), rotas = [];
  let vias = 0, comp = 0;
  const net0 = net => { let x = porNet.get(net); if (!x) porNet.set(net, x = { net, conexoes: 0, roteadas: 0, falhas: 0, vias: 0, comprimento: 0 }); return x; };
  for (const con of cons) {
    const pn = net0(con.net);
    pn.conexoes++;
    const r = J.rotas.get(con.id);
    if (!r) { pn.falhas++; continue; }
    pn.roteadas++; pn.vias += r.vias.length; pn.comprimento += r.comprimento;
    vias += r.vias.length; comp += r.comprimento;
    for (const t of r.trilhas) {
      const op = { op: 'track_add', layer: t.layer, x1: r6(t.x1), y1: r6(t.y1), x2: r6(t.x2), y2: r6(t.y2), w: t.w };
      /* a perna que o arredondamento a 6 casas zera (o nó a menos de 1 µm da ponta) não vira linha: a
         vizinha já encosta na ponta (a ligação do ratsnest tolera 1 µm) */
      if (op.x1 === op.x2 && op.y1 === op.y2) continue;
      if (con.net) op.net = con.net;
      op.note = note;
      ops.push(op);
    }
    for (const v of r.vias) {
      const op = { op: 'via_add', x: r6(v.x), y: r6(v.y), size: v.size, drill: v.drill };
      if (con.net) op.net = con.net;
      op.note = note;
      ops.push(op);
    }
    const rr = { net: con.net, de: con.a.nome || [r6(con.a.x), r6(con.a.y)], para: con.b.nome || [r6(con.b.x), r6(con.b.y)],
                 camadas: r.camadas, vias: r.vias.length, comprimento: r6(r.comprimento), largura: [...new Set(r.trilhas.map(t => t.w))] };
    if (r.cruza && r.cruza.size) rr.cruzaPlanos = [...r.cruza];
    rotas.push(rr);
  }
  /* 17: o "depois" sai da placa REDESPEJADA (o plano recua das rotas novas, como na tela e no Gerber) */
  const nrDepois = NETS.naoRoteadas(J.planos.lista.length ? redespeja(eb, ops, { pour: J.PO, regras: J.RES, textoGeo: J.textoGeo }) : comPrevia(eb, ops));
  const netsAlvo = new Set(cons.map(c => c.net));
  const lista = [];
  for (const con of cons) if (falhas.has(con.id)) lista.push({ net: con.net, de: con.a.nome || [r6(con.a.x), r6(con.a.y)], para: con.b.nome || [r6(con.b.x), r6(con.b.y)], motivo: falhas.get(con.id) });
  return {
    ops,
    antes: { conexoes: X.nrAntes.conexoes, nets: X.nrAntes.total },
    depois: { conexoes: nrDepois.conexoes, nets: nrDepois.total,
              doAlvo: (nrDepois.nets || []).filter(n => netsAlvo.has(n.net)).reduce((s, n) => s + n.faltam, 0) },
    alvo: { conexoes: cons.length, nets: new Set(cons.map(c => c.net)).size },
    roteadas: J.rotas.size, falhas: lista, vias, comprimento: r6(comp),
    primeiraPassada: { roteadas: cons.length - X.primeira.falhas, falhas: X.primeira.falhas },
    passes: X.passes, arrancadas: X.totalArranca, ms: Math.round(agora() - X.t0), nos: X.nosTotal,
    porNet: [...porNet.values()].map(x => Object.assign(x, { comprimento: r6(x.comprimento) })),
    orcamento: { tempoMs: J.tempoMs, nosPorBusca: J.nosPorBusca, esgotouTempo: X.esgotouTempo },
    parametros: { ordem: Array.isArray(X.o.ordem) ? X.o.ordem : (X.o.ordem || 'curta'), passes: isNum(X.o.passes) ? X.o.passes : PASSES,
                  custoVia: J.custoVia, res: J.res, camadas: J.camadasRota, peso: J.peso,
                  cruzarPlanos: J.planos.lista.filter(p => p.cruzavel).map(p => p.id), custoPlano: J.custoPlano,
                  faixaPlano: J.faixaPlano, viaEmPad: J.viaEmPad },
    planos: Object.assign({ poligonos: J.planos.lista.length, redespejado: J.planos.lista.length > 0 && !!J.PO }, X.planos || {}),
    rotas,
  };
}

/* ============================== para a vista (2026-10-28) ============================== */

/* AS OPS COMO OBJETOS DA PLACA: os track_add e via_add do lote no formato do board.js (o que o
   effectiveBoard faria com elas), com ids auto-t1.. e auto-v1.. — a prévia que a vista desenha antes
   de aplicar, e a placa "depois" que o ratsnest e o DRC conferem */
function previa(ops){
  const tracks = [], vias = [];
  for (const o of ops || []) {
    if (!o) continue;
    if (o.op === 'track_add') tracks.push({ id: 'auto-t' + (tracks.length + 1), layer: o.layer, x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2, w: o.w, net: o.net || '' });
    else if (o.op === 'via_add') vias.push({ id: 'auto-v' + (vias.length + 1), x: o.x, y: o.y, size: o.size, drill: o.drill, net: o.net || '', from: 'Top', to: 'Bottom' });
  }
  return { tracks, vias };
}
function comPrevia(eb, ops){
  const p = previa(ops), E = eb || {};
  return Object.assign({}, E, { tracks: (E.tracks || []).concat(p.tracks), vias: (E.vias || []).concat(p.vias) });
}
/* AS VIOLAÇÕES NOVAS de DRC: as da placa com as rotas que a de antes não tinha — a mesma conta do
   pcb_autorotear do MCP. A net não roteada fica de fora (a árvore do ratsnest muda quando as ilhas se
   juntam), e o pedaço de plano redespejado (q:<polígono>:<n>) vale pelo polígono, não pelo número */
const chaveViolacao = v => v.tipo + '|' + (v.ids || []).map(x => String(x).replace(/^(q:[^:]*):\d+$/, '$1')).sort().join('|');
function novasViolacoes(antes, depois){
  const ja = new Set(((antes && antes.violacoes) || []).map(chaveViolacao));
  return ((depois && depois.violacoes) || []).filter(v => v.tipo !== 'UnRoutedNet' && !ja.has(chaveViolacao(v)));
}
/* O LOTE EM FATIAS, sem worker: roda o gerador (lote) em fatias de `fatiaMs` e devolve a página ao
   navegador entre elas (setTimeout 0, ou o `agenda` dado), com o último progresso em `aoProgresso`.
   `cancelado()` verdadeiro para no próximo intervalo. Uma conexão não se corta ao meio: a fatia é
   o tempo até a primeira parada depois dele.
   -> Promise {ok:true, valor} | {ok:false, cancelado:true} | {ok:false, erro} */
function rodaEmFatias(gen, opts){
  const o = opts || {}, fatia = isNum(o.fatiaMs) && o.fatiaMs > 0 ? o.fatiaMs : 30;
  const agenda = typeof o.agenda === 'function' ? o.agenda : (f => setTimeout(f, 0));
  return new Promise(resolve => {
    const passo = () => {
      if (typeof o.cancelado === 'function' && o.cancelado()) {
        try { gen.return(); } catch (e) { /* o gerador ja acabou */ }
        resolve({ ok: false, cancelado: true });
        return;
      }
      const t0 = agora();
      let ult = null;
      try {
        for (;;) {
          const p = gen.next();
          if (p.done) { if (ult && o.aoProgresso) o.aoProgresso(ult); resolve({ ok: true, valor: p.value }); return; }
          ult = p.value;
          if (agora() - t0 >= fatia) break;
        }
      } catch (e) { resolve({ ok: false, erro: String(e && e.message || e) }); return; }
      if (ult && o.aoProgresso) o.aoProgresso(ult);
      agenda(passo);
    };
    agenda(passo);
  });
}

return { rotearLote, lote, rotearConexao, conexoesAbertas, previa, comPrevia, novasViolacoes, rodaEmFatias,
         redespeja, fanout,
         CUSTO_VIA, PASSES, TEMPO_MS, NOS_BUSCA, CUSTO_PLANO, FAIXA_PLANO, FANOUT_DIST };
})();
if (typeof module === 'object' && module.exports) module.exports = HubAutoRoteador;
