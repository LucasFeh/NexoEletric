/* AltiumPCBMirror v2 - hub-gerber.js
   Gerador de Gerber X2 do hub. Entra a placa EFETIVA no formato do board.js (o que
   HubCore.effectiveBoard devolve, com as mudancas ja assadas; um board.js sem mudancas ja e uma)
   e sai o conjunto que o Altium 21.5.1 gera em Fabrication Outputs > Gerber X2, mm 4:5, objeto a
   objeto como foi medido no DMB DI231765_P2 (pesquisa de 2026-10-02, gerber_spec.md):

     <base>_Copper_Signal_Top/_Bot/_<k>  cobre: a camada + a Multi-Layer (pad PTH e via)
     <base>_Pads_Top/_Bot                Pad Master: so os pads, sem expansao
     <base>_Legend_Top/_Bot              serigrafia
     <base>_Soldermask_Top/_Bot          mascara: FilePolarity Negative, escuro = abertura
     <base>_Paste_Top/_Bot               pasta: so pad SMD
     <base>_Profile                      recortes da placa como regioes + o contorno em C 0,0254
     <base>_PTH_Drill/_NPTH_Drill        furacao em Gerber (flash do furo); recortes no NPTH

   Logica pura, sem DOM: navegador (global HubGerber) e node (tests/test-gerber.js).
   Dependencias: hub-font.js (texto sem contorno exato) e hub-laser.js - a regra de o que e furo
   da placa mora no boardCutouts de la (o recorte do tamanho da placa NAO e furo) e a tela, o laser
   e o Gerber tem que concordar.

   API
     HubGerber.gerar(board, opts) -> { arquivos, avisos, resumo }
       arquivos: [{nome, camada, funcao, rotulo, texto, vazio, contagens:{flashes,tracos,arcos,regioes}}]
       avisos:   [texto pt-BR] do que o espelho nao trouxe; o alto primeiro, com "ATENCAO:"
       resumo:   {base, zip (nome sugerido), arquivos:[... + furos, bytes, descartado], descartadas,
                  avisos, texto (o resumo pronto para mostrar)}
       opts.base     nome base dos arquivos (o do .PcbDoc sem extensao; sem ele, o do board.source)
       opts.nomes    'fabricacao' (padrao: minusculas, espaco -> _, como a pasta FABRICACAO e o
                     pacote que vai para a JLCPCB) | 'altium' (como o Project Outputs)
       opts.vazias   false (padrao: camada sem objeto sai do pacote, como o pacote) | true
       opts.gtoGbo   false (padrao) | true: legenda com extensao .gto/.gbo
       opts.x2       true (padrao: atributos TF/TA e o %TF.MD5) | false (sem atributos, como o
                     CAMtastic reexporta)
       opts.software 'NexoEletric'      opts.guid  o TF.SameCoordinates (o teste fixa; sem ele, um
                                                   GUID novo por geracao, como o Altium)
     HubGerber.zip(arquivos, {deflate, data}) -> Promise<Uint8Array>   (.zip proprio, crc32 proprio;
       deflate pelo CompressionStream('deflate-raw') quando existe, senao store)
     HubGerber.md5(texto) -> hex   (o %TF.MD5 e o MD5 de tudo antes dele, sem CR e sem LF)

   O que nao foi medido no acervo (octogono, furo deslocado, fill girado fora de 90 graus, texto
   em cobre, furo NPTH de pad, via cega) sai pela convencao mais provavel e com aviso; os glifos
   que a HubFont nao tem (GLIFOS_EXTRA: so o '+' medido) vem desenhados na grade do Altium. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports)
    module.exports = factory(root, require('./hub-font.js'), require('./hub-laser.js'));
  else root.HubGerber = factory(root, root.HubFont, root.HubLaser);
})(typeof self !== 'undefined' ? self : this, function (root, HubFont0, HubLaser0) {
"use strict";

/* ============================== constantes ============================== */

const VERSAO = '2026.10';
const FABRICANTE = 'Dieletrons';
const ESCALA = 1e5;                 /* FSLAX45 em mm: 1 unidade = 0,00001 mm */
const MASCARA_PADRAO = 0.1016;      /* SolderMaskExpansion 4 mil: padrao do Altium e da casa (110 de 111) */
const TOL_ROT = 1e-4;               /* graus: abaixo disso o angulo e multiplo de 90 */
const TOL_ENCADEIA = 1e-3;          /* mm: ponta que encosta (a mesma do hub-laser) */
const LARGURA_PERFIL = 0.0254;      /* o Profile do Altium e desenhado com C 1 mil */
const TRACO_TEXTO = 0.15;           /* texto sem w: largura do traco = h x 0,15 */
const PASSO_LINHA = 1.765;          /* texto de varias linhas: passo = h x 1,765, medido no DMB
                                       ("PDMB-DI231765_P2\r\nREV. C", h 1,524: 2,69 mm) */
const SEM_PASTA = -500;             /* expansao de pasta manual <= -500 mm = "sem pasta" do Altium */
const TT_ALTURA = 0.52, TT_TRACO = 0.12;   /* TrueType sem contorno na HubFont: maiuscula e traco em h */

/* cor das camadas no G04 Layer_Color: COLORREF (0xBBGGRR) em decimal, medida nos 1.013 Gerbers
   da casa. A do board.layers manda quando vier. */
const COR_PADRAO = {
  Top: '#FF0000', Bottom: '#0000FF', TopOverlay: '#FFFF00', BottomOverlay: '#808000',
  TopSolder: '#800080', BottomSolder: '#FF00FF', TopPaste: '#808080', BottomPaste: '#800000',
};
const COR_MID = ['#BC8E00', '#70DBFA', '#00CC66', '#9966FF', '#00FFFF', '#FF8000', '#FF6699', '#99CC00'];

const FUNCAO_SMD = 'SMDPad,CuDef', FUNCAO_PTH = 'ComponentPad', FUNCAO_VIA = 'ViaPad';
const FUNCAO_COBRE = 'Conductor', FUNCAO_DESENHO = 'NonConductor', FUNCAO_PERFIL = 'Profile';
const FUNCAO_FURO = 'ComponentDrill', FUNCAO_FURO_VIA = 'ViaDrill,NotFilled';

/* ============================== dependencias ============================== */

function dep(nome, v) {
  if (v) return v;
  if (root && root[nome]) return root[nome];
  if (typeof globalThis !== 'undefined' && globalThis[nome]) return globalThis[nome];
  return null;
}
function fonte() {
  const f = dep('HubFont', HubFont0);
  if (!f || typeof f.textPolylines !== 'function') throw new Error('hub-gerber: falta o hub-font.js (fonte do texto)');
  return f;
}
function laser() {
  const l = dep('HubLaser', HubLaser0);
  if (!l || typeof l.boardCutouts !== 'function') throw new Error('hub-gerber: falta o hub-laser.js (regra do recorte da placa)');
  return l;
}

/* ============================== numeros e formato ============================== */

const isNum = v => typeof v === 'number' && isFinite(v);
/* mm -> inteiro em 0,00001 mm. Meio vai para longe do zero (o Altium escreve 0,99033 para
   0,990325); o 1e-6 come o ruido do float, que poria 99032,4999999 abaixo do meio. */
function unid(mm) {
  const a = Math.round(Math.abs(mm) * ESCALA + 1e-6);
  return a === 0 ? 0 : (mm < 0 ? -a : a);
}
/* parametro de abertura: sempre 5 casas ("0.41000"), nunca "-0.00000" */
function f5(mm) {
  const n = unid(mm), a = Math.abs(n);
  return (n < 0 ? '-' : '') + Math.floor(a / ESCALA) + '.' + String(a % ESCALA).padStart(5, '0');
}
/* sem os zeros da direita, como o comentario AMPARAMS ("0.6", "0") */
function g5(mm) { return f5(mm).replace(/\.?0+$/, ''); }
/* angulo com `casas` decimais (1 nas macros, 3 no AMPARAMS) */
function fN(v, casas) {
  const k = Math.pow(10, casas), a = Math.round(Math.abs(v) * k + 1e-6);
  return (v < 0 && a ? '-' : '') + Math.floor(a / k) + (casas ? '.' + String(a % k).padStart(casas, '0') : '');
}
function normAng(g) {
  let v = (isNum(g) ? g : 0) % 360;
  if (v < 0) v += 360;
  return v >= 360 - 1e-9 ? 0 : v;
}
/* 0 = 0/180, 1 = 90/270, -1 = angulo quebrado */
function classeRot(g) {
  const v = normAng(g), k = Math.round(v / 90);
  return Math.abs(v - 90 * k) < TOL_ROT ? (k % 2) : -1;
}
/* o angulo multiplo de 90 vira exato (o 269,99999 do Altium sai 270) */
function angulo(g) {
  const v = normAng(g), k = Math.round(v / 90);
  return Math.abs(v - 90 * k) < TOL_ROT ? (90 * k) % 360 : v;
}
/* cosseno/seno com os multiplos de 90 exatos */
function cosSen(g) {
  const v = angulo(g);
  if (v === 0) return [1, 0];
  if (v === 90) return [0, 1];
  if (v === 180) return [-1, 0];
  if (v === 270) return [0, -1];
  const a = v * Math.PI / 180;
  return [Math.cos(a), Math.sin(a)];
}
function gira(x, y, g) { const cs = cosSen(g); return [x * cs[0] - y * cs[1], x * cs[1] + y * cs[0]]; }
function pontoArco(cx, cy, r, g) { const cs = cosSen(g); return [cx + r * cs[0], cy + r * cs[1]]; }
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const perto = (a, b) => !!a && !!b && Math.abs(a[0] - b[0]) <= TOL_ENCADEIA && Math.abs(a[1] - b[1]) <= TOL_ENCADEIA;
const mesmo = (a, b) => unid(a) === unid(b);

/* ============================== aberturas ============================== */

/* geo = {tipo, chave, ad} (padrao) ou {tipo:'M', nome, corpo, params, branco, chave}. A chave
   deduplica: geometria em 5 casas e, nas macros, o angulo modulo 180 - pad girado 90 e 270 e a
   mesma forma, e o Altium serve os dois com a mesma abertura (D17 do U1 a 270 e do U2 a 90). */
function apC(d) { const s = 'C,' + f5(d); return { tipo: 'C', ad: s, chave: s }; }
function apR(w, h) { const s = 'R,' + f5(w) + 'X' + f5(h); return { tipo: 'R', ad: s, chave: s }; }
function apO(w, h) { const s = 'O,' + f5(w) + 'X' + f5(h); return { tipo: 'O', ad: s, chave: s }; }
/* quadrado em angulo quebrado: poligono regular de 4 vertices, diametro = lado x raiz de 2,
   rotacao = angulo + 45 sem normalizar (o acervo tem P...X4X404.1) */
function apP(lado, th) {
  const s = 'P,' + f5(lado * Math.SQRT2) + 'X4X' + fN(th + 45, 1);
  return { tipo: 'P', ad: s, chave: 'P,' + f5(lado * Math.SQRT2) + 'X4X' + fN(normAng(th) % 90, 1) };
}
function apM(nome, corpo, params, branco) {
  const p = params;
  return { tipo: 'M', nome, corpo, params: p, branco: !!branco,
           chave: nome + '|' + f5(p.X) + '|' + f5(p.Y) + '|' + f5(p.r || 0) + '|' + fN(normAng(p.rot) % 180, 3) };
}
/* ROUNDEDRECT do Altium (formula exata, conferida em 139 pads do DMB e no DI231768 a 15 graus):
   dois retangulos (X por Y-2r e X-2r por Y) com a rotacao do pad e quatro circulos de diametro 2r
   nos cantos (+-(X/2-r), +-(Y/2-r)) ja girados, na ordem inferior-direito, inferior-esquerdo,
   superior-esquerdo, superior-direito. Centro escrito "0,0". */
function macroRoundRect(X, Y, r, th) {
  const rs = fN(th, 1), a = X / 2 - r, b = Y / 2 - r;
  const corpo = ['21,1,' + f5(X) + ',' + f5(Y - 2 * r) + ',0,0,' + rs,
                 '21,1,' + f5(X - 2 * r) + ',' + f5(Y) + ',0,0,' + rs];
  for (const c of [[a, -b], [-a, -b], [-a, b], [a, b]]) {
    const q = gira(c[0], c[1], th);
    corpo.push('1,1,' + f5(2 * r) + ',' + f5(q[0]) + ',' + f5(q[1]));
  }
  return apM('ROUNDEDRECT', corpo, { X, Y, r, rot: th, forma: 'RoundedRectangle' }, false);
}
/* retangulo em angulo quebrado: contorno (primitiva 4) com os cantos ja girados, na ordem
   (-X/2,-Y/2) (-X/2,+Y/2) (+X/2,+Y/2) (+X/2,-Y/2) e de volta ao primeiro (GEP DI231744) */
function macroRotRect(X, Y, th) {
  const v = [[-X / 2, -Y / 2], [-X / 2, Y / 2], [X / 2, Y / 2], [X / 2, -Y / 2]].map(c => gira(c[0], c[1], th));
  v.push(v[0]);
  const corpo = ['4,1,4,' + v.map(q => f5(q[0]) + ',' + f5(q[1])).join(',') + ',0.0'];
  return apM('ROTATEDRECT', corpo, { X, Y, r: 0, rot: th, forma: 'Rectangle' }, true);
}
/* oblongo em angulo quebrado: retangulo (L-S) x S no eixo longo + dois circulos de diametro S
   nas pontas; eixo longo a th + 90 quando Y > X. Centro escrito "0.00000,0.00000". */
function macroOval(X, Y, th) {
  const L = Math.max(X, Y), S = Math.min(X, Y), phi = Y > X ? th + 90 : th, m = (L - S) / 2, cs = cosSen(phi);
  const corpo = ['21,1,' + f5(L - S) + ',' + f5(S) + ',0.00000,0.00000,' + fN(phi, 1),
                 '1,1,' + f5(S) + ',' + f5(-m * cs[0]) + ',' + f5(-m * cs[1]),
                 '1,1,' + f5(S) + ',' + f5(m * cs[0]) + ',' + f5(m * cs[1])];
  return apM('OVAL', corpo, { X, Y, r: 0, rot: th, forma: 'Round' }, true);
}
/* octogono: nenhum no acervo (0 em 444 PcbDoc). Chanfro de 1/4 do lado menor, como o
   importador do KiCad le o octogono do Altium; contorno girado como o ROTATEDRECT. */
function macroOctogono(X, Y, th) {
  const c = Math.min(X, Y) / 4, hx = X / 2, hy = Y / 2;
  const loc = [[-hx + c, -hy], [hx - c, -hy], [hx, -hy + c], [hx, hy - c], [hx - c, hy], [-hx + c, hy], [-hx, hy - c], [-hx, -hy + c]];
  const v = loc.map(q => gira(q[0], q[1], th));
  v.push(v[0]);
  const corpo = ['4,1,8,' + v.map(q => f5(q[0]) + ',' + f5(q[1])).join(',') + ',0.0'];
  return apM('OCTAGON', corpo, { X, Y, r: 0, rot: th, forma: 'Octagonal' }, true);
}
function amparams(a) {
  const p = a.params;
  return 'G04:AMPARAMS|DCode=' + a.d + '|XSize=' + g5(p.X) + 'mm|YSize=' + g5(p.Y) + 'mm|CornerRadius=' + g5(p.r || 0) +
         'mm|HoleSize=0mm|Usage=FLASHONLY|Rotation=' + fN(p.rot, 3) + '|XOffset=0mm|YOffset=0mm|HoleType=Round|Shape=' + p.forma + '|*';
}

/* Pad (forma f = {shape, w, h, radius} do lado que se quer) -> abertura, ja com a expansao e
   (mascara/pasta: e > 0 cresce, e < 0 encolhe). Tabela do gerber_spec 4.1-4.3:
     circle -> C; rect/oval a 0/180 -> R/O w x h, a 90/270 -> h x w; roundrect -> ROUNDEDRECT;
     angulo quebrado: rect -> ROTATEDRECT (quadrado -> P), oval -> OVAL. null = tamanho invalido. */
function geoPad(f, rot, e, av, dono) {
  e = e || 0;
  let shape = String((f && f.shape) || 'rect').toLowerCase();
  const W = (f && f.w) + 2 * e, H = (f && f.h) + 2 * e;
  if (!(W > 0) || !(H > 0)) return null;
  const cls = classeRot(rot || 0), th = angulo(rot || 0);
  if (shape === 'circle' || shape === 'round') {
    if (mesmo(W, H)) return apC(W);
    shape = 'oval';
  }
  if (shape === 'oval' || shape === 'oblong' || shape === 'obround') {
    if (mesmo(W, H)) return apC(W);
    if (cls === 0) return apO(W, H);
    if (cls === 1) return apO(H, W);
    return macroOval(W, H, th);
  }
  if (shape === 'roundrect') {
    let r0 = f.radius;
    if (!isNum(r0)) { av.add('roundrect-raio', dono); r0 = Math.min(f.w, f.h) / 8; }
    const r = Math.min(r0 + e, Math.min(W, H) / 2);
    if (r > 0) return macroRoundRect(W, H, r, th);
    shape = 'rect';
  }
  if (shape === 'octagon') { av.add('pad-octogono', dono); return macroOctogono(W, H, th); }
  if (shape !== 'rect' && shape !== 'square' && shape !== 'rectangle') av.add('pad-forma', dono);
  if (cls === 0) return apR(W, H);
  if (cls === 1) return apR(H, W);
  if (mesmo(W, H)) return apP(W, th);
  return macroRotRect(W, H, th);
}
/* Furo de pad -> abertura do arquivo de furacao. Retangular e slot: drillw ao longo do X do pad e
   drill ao longo do Y, girados pela rotacao do pad + holerot, com a mesma troca de 90/270 do pad
   (CN1 do DMB: drill 0,4, drillw 1,6, rot 270 -> R,0.40000X1.60000). Slot sai como flash O, como
   no acervo (DI211625). */
function geoFuro(p, av) {
  const d = p.drill;
  if (!(d > 0)) return null;
  const forma = String(p.drillshape || 'circle').toLowerCase(), dw = p.drillw;
  const rot = (isNum(p.rot) ? p.rot : 0) + (isNum(p.holerot) ? p.holerot : 0);
  if ((forma === 'rect' || forma === 'square') && dw > 0) return geoPad({ shape: 'rect', w: dw, h: d }, rot, 0, av, p);
  if ((forma === 'oblong' || forma === 'slot') && dw > 0) return geoPad({ shape: 'oval', w: dw, h: d }, rot, 0, av, p);
  return apC(d);
}

/* ============================== avisos ============================== */

/* Cada aviso conta OBJETOS distintos: [alto, texto no plural com {n}, texto para 1]. O alto vai
   primeiro, com o prefixo de atencao. {c} = os detalhes juntados (os caracteres sem glifo, as
   strings especiais), sem repetir, na ordem em que apareceram. */
const AVISOS = {
  'espelho-antigo': [true, 'espelho antigo (board.js sem "exporter"): faltam fills, expansão de máscara e de pasta por pad, tenting, metalização dos furos, furos das regiões e a fonte dos textos — o Gerber sai com as regras padrão. Reexporte a placa no Altium (ExportBoard 2026-10) antes de mandar para a fábrica.'],
  'sem-contorno': [true, 'a placa não tem contorno (board.outline): o Profile sai sem a borda.'],
  'sem-fills': [false, 'o espelho não traz fills: logotipo e QR code feitos de fill somem da serigrafia.'],
  'regiao-sem-furos': [false, '{n} regiões de cobre sem a lista de furos (espelho antigo): um polígono derramado com furo sairia em curto.',
                              '1 região de cobre sem a lista de furos (espelho antigo): um polígono derramado com furo sairia em curto.'],
  'pilha-pad': [false, '{n} pads PTH sem a pilha do bottom (espelho antigo): o cobre de baixo usa o tamanho do de cima.',
                       '1 pad PTH sem a pilha do bottom (espelho antigo): o cobre de baixo usa o tamanho do de cima.'],
  'mascara-regra': [false, '{n} pads/vias sem expansão de máscara no espelho nem regra da placa: abertura pela regra padrão de 0,1016 mm (4 mil) por lado.',
                           '1 pad/via sem expansão de máscara no espelho nem regra da placa: abertura pela regra padrão de 0,1016 mm (4 mil) por lado.'],
  'pasta-regra': [false, '{n} pads SMD sem expansão de pasta no espelho nem regra da placa: usado 0 (o padrão do Altium).',
                         '1 pad SMD sem expansão de pasta no espelho nem regra da placa: usado 0 (o padrão do Altium).'],
  'plated': [false, '{n} furos de pad sem "plated" no espelho: tratados como metalizados (PTH).',
                    '1 furo de pad sem "plated" no espelho: tratado como metalizado (PTH).'],
  'via-tent': [false, '{n} vias sem tenting no espelho: saem abertas na máscara (como no DMB, 33 de 33).',
                      '1 via sem tenting no espelho: sai aberta na máscara (como no DMB, 33 de 33).'],
  'via-cega': [false, '{n} vias que não atravessam a placa toda (cega/enterrada): o furo sai no arquivo de furação passante mesmo assim.',
                      '1 via que não atravessa a placa toda (cega/enterrada): o furo sai no arquivo de furação passante mesmo assim.'],
  'via-invalida': [false, '{n} vias sem posição ou diâmetro: ignoradas.', '1 via sem posição ou diâmetro: ignorada.'],
  'recorte-poligono': [false, '{n} recortes de polígono em cutouts (kindn 1 ou numa camada de cobre — não são furo da placa): ficam fora do Profile e do NPTH.',
                              '1 recorte de polígono em cutouts (kindn 1 ou numa camada de cobre — não é furo da placa): fica fora do Profile e do NPTH.'],
  'recorte-kindn': [false, '{n} recortes com kindn ainda não medido (nem 3, Board Cutout, nem 1, recorte de polígono): saíram como furo da placa — confira no Profile.',
                           '1 recorte com kindn ainda não medido (nem 3, Board Cutout, nem 1, recorte de polígono): saiu como furo da placa — confira no Profile.'],
  'texto-hubfont': [false, '{n} textos sem o contorno exato (polys): desenhados com a fonte do hub (HubFont), que não é a do Altium — forma e largura aproximadas.',
                           '1 texto sem o contorno exato (polys): desenhado com a fonte do hub (HubFont), que não é a do Altium — forma e largura aproximadas.'],
  'texto-truetype': [false, '{n} textos TrueType sem contorno: saem na fonte stroke do hub, no tamanho da maiúscula.',
                            '1 texto TrueType sem contorno: sai na fonte stroke do hub, no tamanho da maiúscula.'],
  'texto-sem-w': [false, '{n} textos sem a largura do traço (w): usado h × 0,15.', '1 texto sem a largura do traço (w): usado h × 0,15.'],
  'texto-multilinha': [false, '{n} textos de várias linhas sem a âncora (ax/ay) no espelho: o bloco sai centrado na caixa do texto, que no Altium é a moldura — posição aproximada.',
                              '1 texto de várias linhas sem a âncora (ax/ay) no espelho: o bloco sai centrado na caixa do texto, que no Altium é a moldura — posição aproximada.'],
  'texto-ancora-velha': [false, '{n} textos de várias linhas com a âncora (ax/ay) longe do próprio texto (movido ou editado depois do export): o bloco sai centrado na caixa do texto.',
                                '1 texto de várias linhas com a âncora (ax/ay) longe do próprio texto (movido ou editado depois do export): o bloco sai centrado na caixa do texto.'],
  'texto-polys-velhos': [false, '{n} textos com contorno (polys) longe do próprio texto (movido ou editado depois do export): desenhados com a HubFont.',
                                '1 texto com contorno (polys) longe do próprio texto (movido ou editado depois do export): desenhado com a HubFont.'],
  'texto-barcode': [false, '{n} textos de código de barras: saem como texto comum.', '1 texto de código de barras: sai como texto comum.'],
  'texto-invertido': [false, '{n} textos invertidos (negativos) sem contorno: saem como texto comum, sem o fundo.',
                             '1 texto invertido (negativo) sem contorno: sai como texto comum, sem o fundo.'],
  'texto-sem-h': [false, '{n} textos sem altura ou posição: ignorados.', '1 texto sem altura ou posição: ignorado.'],
  'texto-glifo': [false, '{n} textos com caractere que a fonte do hub não tem ({c}): sai uma caixa no lugar de cada um.',
                         '1 texto com caractere que a fonte do hub não tem ({c}): sai uma caixa no lugar.'],
  'texto-especial': [true, '{n} textos com string especial sem valor ({c}): saem escritos assim na serigrafia, onde o Altium põe o valor do parâmetro do projeto. Leia a placa com o .PrjPcb do projeto (pcbdoc2board --prjpcb) ou corrija o texto.',
                           '1 texto com string especial sem valor ({c}): sai escrito assim na serigrafia, onde o Altium põe o valor do parâmetro do projeto. Leia a placa com o .PrjPcb do projeto (pcbdoc2board --prjpcb) ou corrija o texto.'],
  'pad-forma': [false, '{n} pads de forma desconhecida: saem como retângulo.', '1 pad de forma desconhecida: sai como retângulo.'],
  'pad-octogono': [false, '{n} pads octogonais: chanfro de 1/4 do lado menor (convenção do Altium, não medida no acervo).',
                          '1 pad octogonal: chanfro de 1/4 do lado menor (convenção do Altium, não medida no acervo).'],
  'pad-deslocado': [false, '{n} pads com furo deslocado (hox/hoy): o cobre sai deslocado do furo (convenção não medida no acervo).',
                           '1 pad com furo deslocado (hox/hoy): o cobre sai deslocado do furo (convenção não medida no acervo).'],
  'pad-invalido': [false, '{n} pads sem posição ou tamanho: ignorados.', '1 pad sem posição ou tamanho: ignorado.'],
  'roundrect-raio': [false, '{n} pads roundrect sem raio: usado 1/8 do lado menor (o padrão da tela).',
                            '1 pad roundrect sem raio: usado 1/8 do lado menor (o padrão da tela).'],
  'furo-sem-diametro': [false, '{n} pads PTH sem diâmetro de furo: o furo não sai.', '1 pad PTH sem diâmetro de furo: o furo não sai.'],
  'traco-invalido': [false, '{n} trilhas/linhas sem largura ou sem pontas: ignoradas.', '1 trilha/linha sem largura ou sem pontas: ignorada.'],
  'arco-invalido': [false, '{n} arcos de raio ou ângulo zero: ignorados.', '1 arco de raio ou ângulo zero: ignorado.'],
  'regiao-invalida': [false, '{n} regiões com menos de 3 vértices distintos: ignoradas.', '1 região com menos de 3 vértices distintos: ignorada.'],
  'fill-invalido': [false, '{n} fills sem tamanho: ignorados.', '1 fill sem tamanho: ignorado.'],
  'plano': [false, '{n} objetos em plano interno (Internal Plane): não suportado, ficam de fora.',
                   '1 objeto em plano interno (Internal Plane): não suportado, fica de fora.'],
  'mid-fora-da-pilha': [false, '{n} camadas internas com objeto mas fora da pilha da placa: geradas assim mesmo, na ordem do número.',
                               '1 camada interna com objeto mas fora da pilha da placa: gerada assim mesmo, na ordem do número.'],
};
function criaAvisos() {
  const mapa = new Map();
  return {
    add(chave, obj, detalhes) {
      let a = mapa.get(chave);
      if (!a) mapa.set(chave, a = { objs: new Set(), n: 0, det: new Set() });
      if (obj && typeof obj === 'object') { if (!a.objs.has(obj)) { a.objs.add(obj); a.n++; } }
      else a.n++;
      for (const d of detalhes || []) a.det.add(String(d));
    },
    lista() {
      const out = [];
      for (const alto of [true, false])
        for (const [chave, a] of mapa) {
          const def = AVISOS[chave] || [false, chave];
          if (def[0] !== alto) continue;
          const txt = (a.n === 1 && def[2] ? def[2] : def[1].replace('{n}', String(a.n))).replace('{c}', [...a.det].join(' '));
          out.push((alto ? 'ATENÇÃO: ' : '') + txt);
        }
      return out;
    },
  };
}

/* ============================== a placa ============================== */

const RE_COBRE = /^(Top|Bottom|Mid\d+)$/;
const ehTH = p => p.layer === 'Multi' || (!p.layer && p.type === 'th');
const camadaDoLado = lado => lado === 'bottom' ? 'Bottom' : 'Top';

/* forma do pad no lado pedido: o PTH pode ter pilha (bw/bh/bshape, ou bot:{w,h,shape,radius});
   camada interna usa a de cima (o espelho nao traz o tamanho do meio) */
function formaLado(p, lado) {
  if (lado === 'bottom' && ehTH(p)) {
    const b = p.bot && typeof p.bot === 'object' ? p.bot : null;
    if (b) return { shape: b.shape || p.shape, w: isNum(b.w) ? b.w : p.w, h: isNum(b.h) ? b.h : p.h, radius: isNum(b.radius) ? b.radius : p.radius };
    if ('bw' in p || 'bh' in p || 'bshape' in p)
      return { shape: p.bshape || p.shape, w: isNum(p.bw) ? p.bw : p.w, h: isNum(p.bh) ? p.bh : p.h, radius: isNum(p.bradius) ? p.bradius : p.radius };
  }
  return { shape: p.shape, w: p.w, h: p.h, radius: p.radius };
}
/* centro do cobre: o furo fica em (x, y) e o "furo deslocado" do Altium desloca o COBRE, no
   referencial do pad (nao medido: 0 no DMB, 3 projetos no acervo) */
function centroCobre(p, av) {
  if ((isNum(p.hox) && p.hox) || (isNum(p.hoy) && p.hoy)) {
    av.add('pad-deslocado', p);
    const q = gira(p.hox || 0, p.hoy || 0, p.rot || 0);
    return [p.x + q[0], p.y + q[1]];
  }
  return [p.x, p.y];
}

/* caixa do contorno (arco pelos extremos que ele varre) - para a regra do recorte do tamanho da
   placa quando o board nao traz bbox */
function caixaDoContorno(segs) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  const pt = (x, y) => { if (isNum(x) && isNum(y)) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); } };
  for (const s of segs || []) {
    if (!s) continue;
    if (s.kind === 'arc') {
      if (![s.cx, s.cy, s.r, s.sa, s.ea].every(isNum)) continue;
      const sa = normAng(s.sa), sw0 = normAng(s.ea - s.sa);
      const sw = (Math.abs(s.ea - s.sa) >= 360 - 1e-9 || (sw0 === 0 && s.ea !== s.sa)) ? 360 : sw0;
      const at = g => { const q = pontoArco(s.cx, s.cy, s.r, g); pt(q[0], q[1]); };
      at(sa); at(sa + sw);
      for (let q = 0; q < 720; q += 90) if (q > sa && q < sa + sw) at(q);
    } else { pt(s.x1, s.y1); pt(s.x2, s.y2); }
  }
  return x1 > x2 ? null : { x1, y1, x2, y2 };
}

/* recortes da placa = HubLaser.boardCutouts (o do tamanho da placa cai fora), menos o que nao e
   buraco na placa. kindn (o Kind() do Altium, export 2026-10): 1 = recorte de poligono (o enum da
   API e o KIND do binario concordam) e -1 = a regiao da placa (marca do leitor de .PcbDoc) saem;
   3 = Board Cutout fica. Qualquer outro numero FICA, com aviso: o significado de cada valor nao
   foi medido no Altium (ExportBoard.pas), e tirar um furo de fixacao de verdade e pior do que
   sobrar um. Sem kindn (espelho antigo), o recorte numa camada de COBRE e de poligono - o Board
   Cutout chega na Multi. */
function recortesDaPlaca(B, av) {
  const lista = [];
  for (const k of Array.isArray(B.cutouts) ? B.cutouts : []) {
    if (!k) continue;
    if (isNum(k.kindn)) {
      if (k.kindn === -1) continue;
      if (k.kindn === 1) { av.add('recorte-poligono', k); continue; }
      if (k.kindn !== 3) av.add('recorte-kindn', k);
      lista.push(k);
      continue;
    }
    if (typeof k.layer === 'string' && (RE_COBRE.test(k.layer) || /^Plane\d+$/.test(k.layer))) { av.add('recorte-poligono', k); continue; }
    lista.push(k);
  }
  const bd = (B.board && typeof B.board === 'object') ? B.board : {};
  const bbox = bd.bbox || caixaDoContorno(bd.outline);
  return laser().boardCutouts({ board: { bbox, outline: bd.outline || [] }, cutouts: lista });
}

/* pilha de cobre na ordem fisica: Top = 1 ... Bottom = N. layers[].stack manda; sem ele, as Mid
   pelo numero. Mid com objeto que nao esta em layers entra com aviso. */
function pilhaDeCobre(B, av) {
  const naPilha = new Map();
  for (const l of Array.isArray(B.layers) ? B.layers : [])
    if (l && typeof l.key === 'string' && /^Mid\d+$/.test(l.key)) naPilha.set(l.key, isNum(l.stack) ? l.stack : null);
  const usadas = new Set();
  const ve = o => { if (o && typeof o.layer === 'string' && /^Mid\d+$/.test(o.layer) && !o.keepout) usadas.add(o.layer); };
  for (const k of ['tracks', 'arcs', 'silk', 'lines', 'fills', 'regions', 'texts'])
    for (const o of Array.isArray(B[k]) ? B[k] : []) ve(o);
  for (const c of B.components || []) for (const p of (c && c.pads) || []) ve(p);
  for (const p of B.freepads || []) ve(p);
  for (const k of usadas) if (!naPilha.has(k)) {
    if (Array.isArray(B.layers) && B.layers.length) av.add('mid-fora-da-pilha', { k });
    naPilha.set(k, null);
  }
  const num = k => parseInt(k.slice(3), 10);
  const mids = [...naPilha.keys()].sort((a, b) => {
    const sa = naPilha.get(a), sb = naPilha.get(b);
    if (isNum(sa) && isNum(sb) && sa !== sb) return sa - sb;
    return num(a) - num(b);
  });
  return ['Top'].concat(mids, ['Bottom']);
}

function colorref(hex) {
  const v = parseInt(String(hex).slice(1), 16);
  return ((v & 255) << 16) | (v & 0xff00) | ((v >> 16) & 255);
}
function corDe(B, chave, padrao) {
  for (const l of Array.isArray(B.layers) ? B.layers : [])
    if (l && l.key === chave && /^#[0-9a-fA-F]{6}$/.test(l.color)) return colorref(l.color);
  return padrao ? colorref(padrao) : 0;
}

/* O conjunto, NA ORDEM EM QUE O ALTIUM GERA (.REP do DMB): e nessa ordem que os D-codes globais
   nascem - Top Layer D10-D38, Bottom Overlay D39-D84, Bottom Solder D85-D97... */
function definicoes(B, pilha) {
  const N = pilha.length, defs = [];
  pilha.forEach((k, i) => {
    const fis = i + 1;
    if (k === 'Top') defs.push({ id: k, tipo: 'cobre', camada: k, lado: 'top', sufixo: 'Copper_Signal_Top', funcao: 'Copper,L1,Top,Signal', fisica: 1, cor: corDe(B, k, COR_PADRAO.Top), rotulo: 'Cobre (cima)' });
    else if (k === 'Bottom') defs.push({ id: k, tipo: 'cobre', camada: k, lado: 'bottom', sufixo: 'Copper_Signal_Bot', funcao: 'Copper,L' + N + ',Bot,Signal', fisica: N, cor: corDe(B, k, COR_PADRAO.Bottom), rotulo: 'Cobre (baixo)' });
    /* interna: o Altium chama de _Copper_Signal_1, _2 ... (MIF DI261898, IT DI221705, FIV DI03843) */
    else defs.push({ id: k, tipo: 'cobre', camada: k, lado: 'mid', sufixo: 'Copper_Signal_' + (fis - 1), funcao: 'Copper,L' + fis + ',Inr,Signal', fisica: fis,
                     cor: corDe(B, k, COR_MID[(parseInt(k.slice(3), 10) - 1) % COR_MID.length]), rotulo: 'Cobre interno ' + (fis - 1) });
  });
  const pads = colorref('#FF0000');
  defs.push({ id: 'PadsBottom', tipo: 'pads', camada: 'PadsBottom', lado: 'bottom', sufixo: 'Pads_Bot', funcao: 'Pads,Bot', cor: pads, rotulo: 'Pads (baixo)' });
  defs.push({ id: 'PadsTop', tipo: 'pads', camada: 'PadsTop', lado: 'top', sufixo: 'Pads_Top', funcao: 'Pads,Top', cor: pads, rotulo: 'Pads (cima)' });
  const lado = (l, tipo, chave, sufixo, funcao, rotulo, negativa) =>
    defs.push({ id: chave, tipo, camada: chave, lado: l, sufixo, funcao, cor: corDe(B, chave, COR_PADRAO[chave]), rotulo, negativa: !!negativa });
  lado('bottom', 'legenda', 'BottomOverlay', 'Legend_Bot', 'Legend,Bot', 'Serigrafia (baixo)');
  lado('bottom', 'mascara', 'BottomSolder', 'Soldermask_Bot', 'Soldermask,Bot', 'Máscara (baixo)', true);
  lado('bottom', 'pasta', 'BottomPaste', 'Paste_Bot', 'Paste,Bot', 'Pasta (baixo)');
  lado('top', 'legenda', 'TopOverlay', 'Legend_Top', 'Legend,Top', 'Serigrafia (cima)');
  lado('top', 'pasta', 'TopPaste', 'Paste_Top', 'Paste,Top', 'Pasta (cima)');
  lado('top', 'mascara', 'TopSolder', 'Soldermask_Top', 'Soldermask,Top', 'Máscara (cima)', true);
  defs.push({ id: 'Profile', tipo: 'perfil', camada: 'Profile', sufixo: 'Profile', funcao: 'Profile,NP', cor: 0, rotulo: 'Perfil (contorno)' });
  defs.push({ id: 'DrillNPTH', tipo: 'npth', camada: 'DrillNPTH', sufixo: 'NPTH_Drill', funcao: 'NonPlated,1,' + N + ',NPTH,Drill', cor: 0, rotulo: 'Furos não metalizados (NPTH)' });
  defs.push({ id: 'DrillPTH', tipo: 'pth', camada: 'DrillPTH', sufixo: 'PTH_Drill', funcao: 'Plated,1,' + N + ',PTH,Drill', cor: 0, rotulo: 'Furos metalizados (PTH)' });
  return defs;
}

/* ============================== coleta (por arquivo) ============================== */

/* Os objetos entram na ordem em que o Altium os percorre - e a ordem que numera os D-codes novos
   e a ordem dentro de cada D-code (a do board.js): no cobre, pad SMD -> trilha -> pad PTH -> via;
   na legenda, linha -> texto -> fill. Item: flash/linha/arco em unidades de 0,00001 mm. */
function novaCamada(def) {
  return { def, itens: [], regs: { furadas: [], simples: [], txtEsc: [], txtClaras: [] } };
}
const itemFlash = (ap, x, y) => ({ ap, k: 'flash', x: unid(x), y: unid(y) });
const itemLinha = (ap, x1, y1, x2, y2) => ({ ap, k: 'line', x1: unid(x1), y1: unid(y1), x2: unid(x2), y2: unid(y2) });
/* arco com as pontas ja decididas; o que arredonda para inicio = fim sem ser volta inteira vira
   linha (no G75, inicio = fim e circulo cheio) */
function itemArco(ap, a) {
  const sx = unid(a.sx), sy = unid(a.sy), ex = unid(a.ex), ey = unid(a.ey);
  if (!a.cheio && sx === ex && sy === ey) return { ap, k: 'line', x1: sx, y1: sy, x2: ex, y2: ey };
  return { ap, k: 'arc', sx, sy, ex, ey, cx: unid(a.cx), cy: unid(a.cy), cw: !!a.cw };
}
/* arco do Altium (anti-horario de sa a ea) -> pontas; null = raio ou varredura zero */
function arcoDe(o) {
  if (![o.cx, o.cy, o.r, o.sa, o.ea].every(isNum) || !(o.r > 0)) return null;
  const varre = o.ea - o.sa;
  let cheio = Math.abs(varre) >= 360 - 1e-9;
  if (!cheio && normAng(varre) === 0) { if (o.ea === o.sa) return null; cheio = true; }
  const S = pontoArco(o.cx, o.cy, o.r, o.sa), E = cheio ? S : pontoArco(o.cx, o.cy, o.r, o.ea);
  return { sx: S[0], sy: S[1], ex: E[0], ey: E[1], cx: o.cx, cy: o.cy, cw: false, cheio };
}
/* contorno de regiao: em unidades, sem vertice repetido em sequencia e sem o fechamento
   explicito (quem escreve fecha); null se sobram menos de 3 */
function limpaContorno(pts) {
  const out = [];
  for (const q of Array.isArray(pts) ? pts : []) {
    if (!Array.isArray(q) || !isNum(q[0]) || !isNum(q[1])) continue;
    const u = [unid(q[0]), unid(q[1])], ult = out[out.length - 1];
    if (ult && ult[0] === u[0] && ult[1] === u[1]) continue;
    out.push(u);
  }
  while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out.length >= 3 ? out : null;
}

/* trilhas, arcos, silk e linhas da camada (o array nao importa: a camada decide o arquivo) */
function coletaTracos(ctx, cam, chave, funcao) {
  const B = ctx.B, av = ctx.av;
  const ve = (o, ehArco) => {
    if (!o || o.layer !== chave || o.keepout) return;
    if (!isNum(o.w) || o.w < 0) { av.add('traco-invalido', o); return; }
    if (ehArco) {
      const a = arcoDe(o);
      if (!a) { av.add('arco-invalido', o); return; }
      cam.itens.push(itemArco(ctx.abertura(funcao, apC(o.w)), a));
    } else {
      if (![o.x1, o.y1, o.x2, o.y2].every(isNum)) { av.add('traco-invalido', o); return; }
      cam.itens.push(itemLinha(ctx.abertura(funcao, apC(o.w)), o.x1, o.y1, o.x2, o.y2));
    }
  };
  for (const t of B.tracks || []) ve(t, false);
  for (const a of B.arcs || []) ve(a, true);
  for (const s of B.silk || []) if (s && (s.kind === 'line' || s.kind === 'arc' || !s.kind)) ve(s, s.kind === 'arc');
  for (const s of B.lines || []) if (s && (s.kind === 'line' || s.kind === 'arc' || !s.kind)) ve(s, s.kind === 'arc');
}

/* fill: flash R |x2-x1| x |y2-y1| no centro (392/392 no DMB, desvio max. 7 um); a 90/270 troca;
   em angulo quebrado vira regiao (nao medido no acervo) */
function coletaFills(ctx, cam, chave, funcao) {
  for (const f of ctx.B.fills || []) {
    if (!f || f.layer !== chave || f.keepout) continue;
    if (![f.x1, f.y1, f.x2, f.y2].every(isNum)) { ctx.av.add('fill-invalido', f); continue; }
    const w = Math.abs(f.x2 - f.x1), h = Math.abs(f.y2 - f.y1), cx = (f.x1 + f.x2) / 2, cy = (f.y1 + f.y2) / 2;
    if (!(w > 0) || !(h > 0)) { ctx.av.add('fill-invalido', f); continue; }
    const cls = classeRot(f.rot || 0);
    if (cls >= 0) { cam.itens.push(itemFlash(ctx.abertura(funcao, cls ? apR(h, w) : apR(w, h)), cx, cy)); continue; }
    const pts = limpaContorno([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]
      .map(q => { const g = gira(q[0], q[1], f.rot); return [cx + g[0], cy + g[1]]; }));
    if (pts) cam.regs.simples.push({ pts, f: funcao });
  }
}

function coletaRegioes(ctx, cam, chave, funcao) {
  for (const g of ctx.B.regions || []) {
    if (!g || g.layer !== chave || g.keepout) continue;
    const pts = limpaContorno(g.points);
    if (!pts) { ctx.av.add('regiao-invalida', g); continue; }
    const furos = (Array.isArray(g.holes) ? g.holes : []).map(limpaContorno).filter(Boolean);
    if (furos.length) cam.regs.furadas.push({ pts, furos, f: funcao });
    else cam.regs.simples.push({ pts, f: funcao });
  }
}

/* contorno exato do texto (texts[].polys, do PCBContourMaker) - so vale se ainda esta em cima do
   texto: o effectiveBoard move o x/y de um texto de componente movido, mas nao os polys */
function polysDoTexto(t, av) {
  const P = (Array.isArray(t.polys) ? t.polys : []).filter(q => q && Array.isArray(q.pts) && q.pts.length >= 3);
  if (!P.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const q of P) if (!q.hole) for (const p of q.pts) if (Array.isArray(p) && isNum(p[0]) && isNum(p[1])) {
    x1 = Math.min(x1, p[0]); x2 = Math.max(x2, p[0]); y1 = Math.min(y1, p[1]); y2 = Math.max(y2, p[1]);
  }
  if (!(x1 <= x2)) return null;
  if (isNum(t.x) && isNum(t.y) && dist([(x1 + x2) / 2, (y1 + y2) / 2], [t.x, t.y]) > Math.max(1, isNum(t.h) ? t.h : 0)) {
    av.add('texto-polys-velhos', t);
    return null;
  }
  return P;
}
/* ---- texto sem contorno: a fonte do hub ---- */

/* Glifos que faltam na HubFont (hub-font.js) e aparecem no acervo - em 40 board.js, '+' em 91
   textos (polaridade, "+5V"), 'X' em 23, 'Z' em 9, '(' ')' ':' '%' '>' '*' '?' em ate 5. Sem eles a
   HubFont poe uma caixa no lugar, e o '+' de polaridade do C3/C5 do DMB saia um retangulo de
   0,9 x 1,5 mm. Desenhados na grade da fonte stroke do Altium (u = h/6, maiuscula de 6u, glifo de
   4u de largura): o '+' e o medido no X2 do DMB (cruz de 4u x 4u com o centro a 3u da linha de
   base); os outros seguem a mesma grade, sem medida. A HubFont manda quando tiver o glifo, e
   HubGerber.GLIFOS_EXTRA ja sai no formato do FONTDATA dela (escala = altura, Y negativo para
   cima, linha de base em -1/21, maiuscula em -22/21): copiados para la, a tela e o laser passam a
   desenhar igual ao Gerber. */
const LINHA_BASE = 1 / 21;          /* a linha de base da HubFont fica 1/21 h acima do pe da caixa dela */
const U_ALTIUM = 1 / 6;
const pontoGrade = (x, y) => [[x, y + 0.5], [x + 0.25, y + 0.25], [x, y], [x - 0.25, y + 0.25], [x, y + 0.5], [x, y]];
/* [tracos em u (x desde o comeco da tinta, y desde a linha de base), largura da tinta em u, margem
   de cada lado em h: a do 'A'/'V'/'Y' da HubFont (2/21) e, nos estreitos, a do '.' e da ',' (4/21)] */
const GRADE_EXTRA = {
  '+': [[[[0, 3], [4, 3]], [[2, 1], [2, 5]]], 4],
  'X': [[[[0, 6], [4, 0]], [[0, 0], [4, 6]]], 4],
  'Z': [[[[0, 6], [4, 6], [0, 0], [4, 0]]], 4],
  '*': [[[[2, 1], [2, 5]], [[0.27, 2], [3.73, 4]], [[0.27, 4], [3.73, 2]]], 4],
  '=': [[[[0, 2], [4, 2]], [[0, 4], [4, 4]]], 4],
  '<': [[[[4, 5], [0, 3], [4, 1]]], 4],
  '>': [[[[0, 5], [4, 3], [0, 1]]], 4],
  '?': [[[[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [2, 3], [2, 1.5]], pontoGrade(2, 0)], 4],
  '%': [[[[0, 0], [4, 6]], [[0, 5], [0.75, 5.75], [1.5, 5], [0.75, 4.25], [0, 5]], [[2.5, 1], [3.25, 1.75], [4, 1], [3.25, 0.25], [2.5, 1]]], 4],
  '(': [[[[1.6, 6.5], [0.6, 5.5], [0, 4], [0, 2], [0.6, 0.5], [1.6, -0.5]]], 1.6, 4 / 21],
  ')': [[[[0, 6.5], [1, 5.5], [1.6, 4], [1.6, 2], [1, 0.5], [0, -0.5]]], 1.6, 4 / 21],
  ':': [[pontoGrade(0.25, 0), pontoGrade(0.25, 3.5)], 0.5, 4 / 21],
};
const GLIFOS_EXTRA = {};
for (const c of Object.keys(GRADE_EXTRA)) {
  const g = GRADE_EXTRA[c], m = g[2] || 2 / 21, r6 = v => Math.round(v * 1e6) / 1e6;
  GLIFOS_EXTRA[c] = { l: g[0].map(s => s.map(p => [r6(m + p[0] * U_ALTIUM), r6(-(LINHA_BASE + p[1] * U_ALTIUM))])),
                      w: r6(2 * m + g[1] * U_ALTIUM) };
}
/* glifo do caractere: o da HubFont (a minuscula que falta cai na maiuscula, como nela), senao o do
   complemento; null = falta nos dois */
function glifo(F, c) {
  return F.glyphFor(c) || GLIFOS_EXTRA[c] || GLIFOS_EXTRA[c.toUpperCase()] || null;
}
/* uma linha de texto em coordenadas locais - caneta comecando em x = 0, linha de base em y = 0, Y
   para cima -> {polys, tinta: caixa [x1, y1, x2, y2] das linhas de centro (null sem traco),
   faltam: os caracteres sem glifo}. Espaco e caractere sem glifo levam o avanco da HubFont; no
   lugar do que falta, a caixa dela (a mesma da tela). */
function linhaDeTexto(F, txt, h) {
  const polys = [], faltam = [];
  let cx = 0;
  for (const c of String(txt)) {
    if (!c.trim()) { cx += F.textWidth(' ', h); continue; }
    const g = glifo(F, c);
    if (g) {
      for (const s of g.l) polys.push(s.map(p => [cx + p[0] * h, -(p[1] + LINHA_BASE) * h]));
      cx += g.w * h;
      continue;
    }
    const a = F.textWidth(c, h);
    faltam.push(c);
    for (const s of F.textPolylines(c, h)) polys.push(s.map(p => [cx + a / 2 + p[0], p[1] + h / 2 - LINHA_BASE * h]));
    cx += a;
  }
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const s of polys) for (const p of s) { x1 = Math.min(x1, p[0]); x2 = Math.max(x2, p[0]); y1 = Math.min(y1, p[1]); y2 = Math.max(y2, p[1]); }
  return { polys, tinta: x1 <= x2 ? [x1, y1, x2, y2] : null, faltam };
}

/* strings especiais do Altium que nao viraram valor (".Revisao" lido sem o .PrjPcb do projeto):
   ponto no comeco de palavra seguido de um nome, a regra do leitor de .PcbDoc
   (pcbdoc_leitor._RX_ESPECIAL). O ExportBoard ja grava o texto convertido pelo Altium. */
const RE_ESPECIAL = /(^|[^A-Za-z0-9_.\u00C0-\u024F])(\.[A-Za-z_][A-Za-z0-9_]*)/g;
function especiaisCrus(txt) {
  const out = [];
  RE_ESPECIAL.lastIndex = 0;
  for (let m; (m = RE_ESPECIAL.exec(txt));) out.push(m[2]);
  return out;
}

/* Texto: com contorno exato -> regioes (escuras primeiro, depois os miolos em LPC, como o
   Altium escreve o TrueType); sem -> tracos da HubFont, girados e espelhados como a tela desenha
   (espelho no X local antes de girar), posicionados pela TINTA, nunca pela caixa de avanco da
   HubFont (que punha a tinta 1/21 h acima e deslocada pela margem lateral do 1o/ultimo glifo:
   0,10 mm no "T1" do DMB, 0,36 mm na borda do bloco "PDMB...").
   Uma linha: a caixa dos tracos centrada no x/y do board.js - o retangulo de selecao do Altium e
   a caixa da tinta (centro = centro dos tracos em 32 de 32 textos do DMB; o leitor de .PcbDoc o
   confere pelo retangulo gravado). Varias linhas - qualquer quebra de linha, mesmo so a do fim
   ("DS\r\n" do DMB): o Altium so as faz com moldura, e a caixa do export e a moldura, nao a tinta
   (no DMB o centro erra 1,1 mm em Y). Medido nos 2 textos de moldura do DMB: cada linha alinhada a
   esquerda pela tinta (a fonte do Altium nao tem margem lateral: as duas linhas do "PDMB..." e o
   "DS" comecam em ancora + w), a linha de base da ULTIMA linha nao vazia a w acima da ancora, passo
   de 1,765 h. Com a ancora (ax/ay do export novo) o bloco sai assim; sem ela, o bloco centrado no
   x/y, com aviso. A linha vazia do fim nao conta. */
/* A GEOMETRIA de um texto no referencial da placa, sem Gerber nenhum - e o que a vista PCB
   desenha, para a tela e o arquivo da fabrica nunca discordarem:
     {regioes:[{pts, hole}]}  contorno exato (polys do export novo ou do leitor de .PcbDoc);
     {tracos:[[[x,y],...]], w} a fonte do hub, posicionada pela tinta (regras acima);
     null                      nada a desenhar.
   av e o coletor de avisos do gerador; quem so desenha passa nada. */
const SEM_AVISO = { add() {} };
function geometriaTexto(t, av) {
  av = av || SEM_AVISO;
  if (!t) return null;
  const txt = t.text == null ? '' : String(t.text);
  const crus = especiaisCrus(txt);
  if (crus.length) av.add('texto-especial', t, crus);
  const P = polysDoTexto(t, av);
  if (P) {
    const regioes = [];
    for (const q of P) {
      const pts = limpaContorno(q.pts);
      if (pts) regioes.push({ pts, hole: !!q.hole });
    }
    return { regioes };
  }
  if (!txt.trim()) return null;
  if (!(t.h > 0) || !isNum(t.x) || !isNum(t.y)) { av.add('texto-sem-h', t); return null; }
  const tipo = t.kind || (/^(stroke|truetype|barcode)$/.test(t.font) ? t.font : null);
  av.add('texto-hubfont', t);
  if (tipo === 'barcode') av.add('texto-barcode', t);
  if (t.inverted) av.add('texto-invertido', t);
  let w = t.w, h = t.h;
  if (tipo === 'truetype') {
    /* no TrueType o h do Altium e o corpo da fonte, nao a maiuscula, e o w nao e traco: a
       maiuscula do Arial Rounded do DMB tem ~0,64 h de tinta (1,0 mm para h 1,5748) */
    av.add('texto-truetype', t);
    h = t.h * TT_ALTURA; w = t.h * TT_TRACO;
  } else if (!(w > 0)) { w = t.h * TRACO_TEXTO; av.add('texto-sem-w', t); }
  const F = fonte();
  const rot = isNum(t.rot) ? t.rot : 0, esp = t.mirror ? -1 : 1;
  const tracos = [];
  /* as polilinhas de uma linha: desloca (dx, dy) no referencial do texto, espelha o X local,
     gira e soma (ox, oy) */
  const poe = (polys, ox, oy, dx, dy) => {
    for (const s of polys)
      tracos.push(s.map(q => { const g = gira((q[0] + dx) * esp, q[1] + dy, rot); return [ox + g[0], oy + g[1]]; }));
  };
  const linhas = txt.split(/\r\n|\r|\n/), moldura = linhas.length > 1;
  while (linhas.length > 1 && !linhas[linhas.length - 1].trim()) linhas.pop();
  const L = linhas.map(l => linhaDeTexto(F, l, h));
  const faltam = [].concat(...L.map(l => l.faltam));
  if (faltam.length) av.add('texto-glifo', t, faltam);
  if (!moldura) {
    const k = L[0].tinta;
    if (k) poe(L[0].polys, t.x, t.y, -(k[0] + k[2]) / 2, -(k[1] + k[3]) / 2);
    return { tracos, w };
  }
  const n = linhas.length, passo = h * PASSO_LINHA;
  const W = Math.max(0, ...L.map(l => l.tinta ? l.tinta[2] - l.tinta[0] : 0));
  let ancora = isNum(t.ax) && isNum(t.ay);
  if (ancora) {
    /* o centro da caixa (a moldura) tem que cair no bloco que a ancora desenha; se nao cai, a
       ancora ficou para tras - o effectiveBoard move o x/y do texto, nao o ax/ay */
    const q = gira(t.x - t.ax, t.y - t.ay, -rot), lx = q[0] * esp, ly = q[1];
    if (lx < -h || lx > W + w + h || ly < -h || ly > (n - 1) * passo + h + w + h) { ancora = false; av.add('texto-ancora-velha', t); }
  } else av.add('texto-multilinha', t);
  /* linha i: a tinta comeca em x = 0 e a linha de base fica (n-1-i) passos acima da ultima */
  const blocos = [];
  L.forEach((l, i) => { if (l.tinta) blocos.push({ l, dx: -l.tinta[0], dy: (n - 1 - i) * passo }); });
  let ox = t.ax, oy = t.ay, sx = w, sy = w;
  if (!ancora) {
    let y1 = Infinity, y2 = -Infinity;
    for (const b of blocos) { y1 = Math.min(y1, b.l.tinta[1] + b.dy); y2 = Math.max(y2, b.l.tinta[3] + b.dy); }
    ox = t.x; oy = t.y; sx = -W / 2; sy = -(y1 + y2) / 2;
  }
  for (const b of blocos) poe(b.l.polys, ox, oy, b.dx + sx, b.dy + sy);
  return { tracos, w };
}

function coletaTextos(ctx, cam, chave, funcao) {
  for (const t of ctx.B.texts || []) {
    if (!t || t.layer !== chave || t.hidden) continue;
    const g = geometriaTexto(t, ctx.av);
    if (!g) continue;
    if (g.regioes) {
      for (const r of g.regioes) (r.hole ? cam.regs.txtClaras : cam.regs.txtEsc).push({ pts: r.pts, f: funcao });
      continue;
    }
    const ap = ctx.abertura(funcao, apC(g.w));
    for (const s of g.tracos)
      for (let k = 1; k < s.length; k++) cam.itens.push(itemLinha(ap, s[k - 1][0], s[k - 1][1], s[k][0], s[k][1]));
  }
}

/* expansoes: a do pad (o export novo grava a efetiva, regra ou manual) > a regra da placa > o
   padrao de 4 mil, com aviso */
function expMascara(ctx, o) {
  if (isNum(o.sm)) return o.sm;
  const R = ctx.B.rules;
  if (R && isNum(R.sm)) return R.sm;
  ctx.av.add('mascara-regra', o);
  return MASCARA_PADRAO;
}
function expPasta(ctx, p) {
  if (isNum(p.pm)) return p.pm;
  const R = ctx.B.rules;
  if (R && isNum(R.pm)) return R.pm;
  ctx.av.add('pasta-regra', p);
  return 0;
}
const tampado = (o, lado) => lado === 'bottom' ? o.tentBot === true : o.tentTop === true;
const padValido = p => isNum(p.x) && isNum(p.y) && p.w > 0 && p.h > 0;

/* pads SMD da camada de cobre `chave`; modo 'cobre'|'pads' sem expansao, 'mascara' e 'pasta' com */
function coletaPadsSMD(ctx, cam, chave, modo, lado) {
  for (const it of ctx.pads) {
    const p = it.p;
    if (ehTH(p) || p.layer !== chave) continue;
    if (!padValido(p)) { ctx.av.add('pad-invalido', p); continue; }
    let e = 0;
    if (modo === 'mascara') { if (tampado(p, lado)) continue; e = expMascara(ctx, p); }
    else if (modo === 'pasta') {
      if (p.nopaste === true || (isNum(p.pm) && p.pm <= SEM_PASTA)) continue;
      e = expPasta(ctx, p);
    }
    const geo = geoPad(formaLado(p, 'top'), p.rot, e, ctx.av, p);
    if (!geo) continue;           /* a pasta encolhida ate sumir */
    const c = centroCobre(p, ctx.av);
    cam.itens.push(itemFlash(ctx.abertura(FUNCAO_SMD, geo), c[0], c[1]));
  }
}
/* pads PTH (Multi-Layer) com o tamanho daquele lado */
function coletaPadsTH(ctx, cam, lado, modo) {
  for (const it of ctx.pads) {
    const p = it.p;
    if (!ehTH(p)) continue;
    if (!padValido(p)) { ctx.av.add('pad-invalido', p); continue; }
    if (lado === 'bottom' && !ctx.B.exporter && !('bw' in p) && !p.bot) ctx.av.add('pilha-pad', p);
    let e = 0;
    if (modo === 'mascara') { if (tampado(p, lado)) continue; e = expMascara(ctx, p); }
    const geo = geoPad(formaLado(p, lado), p.rot, e, ctx.av, p);
    if (!geo) continue;
    const c = centroCobre(p, ctx.av);
    cam.itens.push(itemFlash(ctx.abertura(FUNCAO_PTH, geo), c[0], c[1]));
  }
}
/* a via vai nas camadas de cobre entre from e to (sem from/to: todas) */
function viaAtravessa(ctx, v, chave) {
  const pos = ctx.posicao, N = ctx.pilha.length;
  const a = pos[v.from] || 1, b = pos[v.to] || N, k = pos[chave];
  return k >= Math.min(a, b) && k <= Math.max(a, b);
}
function viaValida(v) { return v && isNum(v.x) && isNum(v.y) && v.size > 0; }
function coletaVias(ctx, cam, chave, modo, lado) {
  for (const v of ctx.B.vias || []) {
    if (!viaValida(v)) { ctx.av.add('via-invalida', v); continue; }
    if (!viaAtravessa(ctx, v, chave)) continue;
    let d = v.size;
    if (modo === 'mascara') { if (tampado(v, lado)) continue; d += 2 * expMascara(ctx, v); }
    if (!(d > 0)) continue;
    cam.itens.push(itemFlash(ctx.abertura(FUNCAO_VIA, apC(d)), v.x, v.y));
  }
}

/* contorno da placa -> pontas na ordem do Board6, fechando no ponto inicial. O board.js nao diz
   o sentido do arco (so cx, cy, r, sa, ea): ele vem do percurso - chegando na ponta do sa o arco
   e anti-horario (G03), na do ea, horario (G02) (DMB: G02, G03, G02 na aba). As pontas encostam
   nas retas vizinhas dentro de 0,001 mm, para a polilinha continuar sem D02. */
function caminhoContorno(segs) {
  /* a reta de comprimento zero cai fora: o Board6 fecha o poligono repetindo o 1o vertice (v94 do
     DMB), e o export a escreveria como um segmento nulo no fim */
  const S = (segs || []).filter(s => s && (
    (s.kind === 'line' && [s.x1, s.y1, s.x2, s.y2].every(isNum) && !(mesmo(s.x1, s.x2) && mesmo(s.y1, s.y2))) ||
    (s.kind === 'arc' && [s.cx, s.cy, s.r, s.sa, s.ea].every(isNum) && s.r > 0)));
  const n = S.length, out = [];
  if (!n) return out;
  const pontas = s => {
    const varre = s.ea - s.sa;
    const cheio = Math.abs(varre) >= 360 - 1e-9 || (s.ea !== s.sa && normAng(varre) === 0);
    return { a: pontoArco(s.cx, s.cy, s.r, s.sa), b: pontoArco(s.cx, s.cy, s.r, s.ea), cheio };
  };
  let cur = null;
  if (S[0].kind === 'arc') {
    const pa = pontas(S[0]), ant = S[n - 1], prox = S[1 % n];
    if (n > 1 && ant.kind === 'line') cur = [ant.x2, ant.y2];
    else if (n > 1 && prox.kind === 'line') { const ref = [prox.x1, prox.y1]; cur = dist(pa.b, ref) <= dist(pa.a, ref) ? pa.a : pa.b; }
    else cur = pa.a;
  }
  for (let i = 0; i < n; i++) {
    const s = S[i];
    if (s.kind === 'line') { out.push({ k: 'line', x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 }); cur = [s.x2, s.y2]; continue; }
    const pa = pontas(s);
    let ini, fim, cw = false;
    if (pa.cheio) { ini = fim = perto(cur, pa.a) ? cur : pa.a; }
    else {
      if (!cur || dist(cur, pa.a) <= dist(cur, pa.b)) { ini = pa.a; fim = pa.b; }
      else { ini = pa.b; fim = pa.a; cw = true; }
      if (perto(cur, ini)) ini = cur;
      const prox = S[(i + 1) % n];
      if (prox !== s && prox.kind === 'line' && perto([prox.x1, prox.y1], fim)) fim = [prox.x1, prox.y1];
    }
    out.push({ k: 'arc', sx: ini[0], sy: ini[1], ex: fim[0], ey: fim[1], cx: s.cx, cy: s.cy, cw, cheio: pa.cheio });
    cur = fim;
  }
  return out;
}

function coletaFurosPad(ctx, cam, metalizado) {
  for (const it of ctx.pads) {
    const p = it.p;
    if (!ehTH(p) || !isNum(p.x) || !isNum(p.y)) continue;
    if ((p.plated !== false) !== metalizado) continue;
    if (metalizado && p.plated === undefined) ctx.av.add('plated', p);
    const geo = geoFuro(p, ctx.av);
    if (!geo) { if (metalizado) ctx.av.add('furo-sem-diametro', p); continue; }
    cam.itens.push(itemFlash(ctx.abertura(FUNCAO_FURO, geo), p.x, p.y));
  }
}

function coleta(ctx, def) {
  const cam = novaCamada(def);
  switch (def.tipo) {
    case 'cobre': {
      const k = def.camada;
      coletaPadsSMD(ctx, cam, k, 'cobre');
      coletaTracos(ctx, cam, k, FUNCAO_COBRE);
      coletaFills(ctx, cam, k, FUNCAO_COBRE);
      coletaTextos(ctx, cam, k, FUNCAO_DESENHO);
      coletaRegioes(ctx, cam, k, FUNCAO_COBRE);
      coletaPadsTH(ctx, cam, def.lado, 'cobre');
      coletaVias(ctx, cam, k, 'cobre');
      /* objeto desenhado na propria Multi-Layer sai em todo cobre */
      coletaTracos(ctx, cam, 'Multi', FUNCAO_COBRE);
      coletaFills(ctx, cam, 'Multi', FUNCAO_COBRE);
      coletaRegioes(ctx, cam, 'Multi', FUNCAO_COBRE);
      break;
    }
    case 'pads':
      coletaPadsSMD(ctx, cam, camadaDoLado(def.lado), 'pads');
      coletaPadsTH(ctx, cam, def.lado, 'pads');
      break;
    case 'legenda':
      coletaTracos(ctx, cam, def.camada, FUNCAO_DESENHO);
      coletaTextos(ctx, cam, def.camada, FUNCAO_DESENHO);
      coletaFills(ctx, cam, def.camada, FUNCAO_DESENHO);
      coletaRegioes(ctx, cam, def.camada, FUNCAO_DESENHO);
      break;
    case 'mascara':
    case 'pasta':
      /* objeto desenhado na camada de mascara/pasta soma (escuro = abertura/pasta) */
      coletaTracos(ctx, cam, def.camada, FUNCAO_DESENHO);
      coletaTextos(ctx, cam, def.camada, FUNCAO_DESENHO);
      coletaFills(ctx, cam, def.camada, FUNCAO_DESENHO);
      coletaRegioes(ctx, cam, def.camada, FUNCAO_DESENHO);
      coletaPadsSMD(ctx, cam, camadaDoLado(def.lado), def.tipo, def.lado);
      if (def.tipo === 'mascara') {
        coletaPadsTH(ctx, cam, def.lado, 'mascara');
        coletaVias(ctx, cam, camadaDoLado(def.lado), 'mascara', def.lado);
      }
      break;
    case 'perfil': {
      for (const r of ctx.recortes) { const pts = limpaContorno(r); if (pts) cam.regs.simples.push({ pts, f: FUNCAO_PERFIL }); }
      const segs = (ctx.B.board && ctx.B.board.outline) || [];
      if (!segs.length) { ctx.av.add('sem-contorno'); break; }
      const ap = ctx.abertura(FUNCAO_PERFIL, apC(LARGURA_PERFIL));
      for (const s of caminhoContorno(segs))
        cam.itens.push(s.k === 'line' ? itemLinha(ap, s.x1, s.y1, s.x2, s.y2) : itemArco(ap, s));
      break;
    }
    case 'npth':
      for (const r of ctx.recortes) { const pts = limpaContorno(r); if (pts) cam.regs.simples.push({ pts, f: null }); }
      coletaFurosPad(ctx, cam, false);
      break;
    case 'pth':
      coletaFurosPad(ctx, cam, true);
      for (const v of ctx.B.vias || []) {
        if (!viaValida(v) || !(v.drill > 0)) continue;
        cam.itens.push(itemFlash(ctx.abertura(FUNCAO_FURO_VIA, apC(v.drill)), v.x, v.y));
      }
      break;
  }
  return cam;
}

/* ============================== escrita ============================== */

/* regioes em sequencia: as com furo primeiro (escura + furos em LPC, como o Altium escreve o
   poligono derramado), depois as simples, por fim o texto com contorno (todas as escuras, depois
   todos os miolos). Nessa ordem um LPC nunca apaga regiao escura que vem depois dele. */
function seqRegioes(cam) {
  const r = cam.regs, seq = [];
  for (const g of r.furadas) {
    seq.push({ pts: g.pts, claro: false, f: g.f });
    for (const h of g.furos) seq.push({ pts: h, claro: true, f: g.f });
  }
  for (const g of r.simples) seq.push({ pts: g.pts, claro: false, f: g.f });
  for (const g of r.txtEsc) seq.push({ pts: g.pts, claro: false, f: g.f });
  for (const g of r.txtClaras) seq.push({ pts: g.pts, claro: true, f: g.f });
  return seq;
}

function contagens(cam, seq) {
  const n = { flashes: 0, tracos: 0, arcos: 0, regioes: seq.length };
  for (const it of cam.itens) n[it.k === 'flash' ? 'flashes' : it.k === 'line' ? 'tracos' : 'arcos']++;
  return n;
}

/* Um arquivo, como o Altium escreve: CRLF, um comando por linha; cabecalho; aberturas em ordem de
   D-code com o %TA.AperFunction a cada troca de funcao (macro logo antes do seu AD); regioes;
   objetos agrupados por D-code; %TF.MD5; M02. Coordenada modal (o eixo que nao mudou sai fora),
   menos no fim do arco, que leva X e Y sempre. */
function escreve(ctx, cam, seq) {
  const o = ctx.o, d = cam.def, L = [];
  if (o.x2) {
    L.push('%TF.GenerationSoftware,' + FABRICANTE + ',' + o.software + ',' + VERSAO + '*%');
    if (d.fisica) L.push('G04 Layer_Physical_Order=' + d.fisica + '*');
    L.push('G04 Layer_Color=' + d.cor + '*');
  }
  L.push('%FSLAX45Y45*%');
  L.push('%MOMM*%');
  if (o.x2) {
    L.push('%TF.SameCoordinates,' + o.guid + '*%');
    L.push('%TF.FilePolarity,' + (d.negativa ? 'Negative' : 'Positive') + '*%');
    L.push('%TF.FileFunction,' + d.funcao + '*%');
    L.push('%TF.Part,Single*%');
  }
  L.push('G01*');
  L.push('G75*');

  const usadas = [...new Set(cam.itens.map(i => i.ap))].sort((a, b) => a.d - b.d);
  let ta = null;
  const poeTA = f => {
    if (!o.x2 || f === ta || f === undefined) return;
    L.push(f ? '%TA.AperFunction,' + f + '*%' : '%TD.AperFunction*%');
    ta = f;
  };
  for (const a of usadas) {
    poeTA(a.funcao);
    if (a.tipo === 'M') {
      L.push(amparams(a));
      L.push('%AM' + a.nome + 'D' + a.d + '*');
      for (const b of a.corpo) L.push(b + '*');
      L.push('%');
      L.push('%ADD' + a.d + a.nome + 'D' + a.d + '*%');
      if (a.branco) L.push('');
    } else L.push('%ADD' + a.d + a.ad + '*%');
  }

  let px = null, py = null;
  const xy = (x, y, forca) => {
    let s = '';
    if (forca || px === null || x !== px) s += 'X' + x;
    if (forca || py === null || y !== py) s += 'Y' + y;
    px = x; py = y;
    return s;
  };

  /* regioes: G36, D02 no primeiro vertice, D01 nos outros, fecha repetindo o primeiro, D02, G37 */
  let claro = false;
  for (const r of seq) {
    poeTA(r.f);
    if (r.claro !== claro) { L.push(r.claro ? '%LPC*%' : '%LPD*%'); claro = r.claro; }
    const p = r.pts;
    L.push('G36*');
    L.push(xy(p[0][0], p[0][1], true) + 'D02*');
    for (let i = 1; i < p.length; i++) L.push(xy(p[i][0], p[i][1]) + 'D01*');
    L.push(xy(p[0][0], p[0][1]) + 'D01*');
    L.push('D02*');
    L.push('G37*');
    px = py = null;          /* depois do G37 o proximo ponto sai completo */
  }
  if (claro) L.push('%LPD*%');

  /* objetos por D-code; dentro dele, na ordem da coleta. Flash: D02 ate o ponto + D03. Traco:
     D02 so quando nao comeca onde o anterior terminou (a polilinha continua). Arco: sempre um
     D02 antes (sem coordenada se ja esta no inicio), G02/G03, fim com I/J, G01. */
  const grupos = new Map();
  for (const it of cam.itens) { let g = grupos.get(it.ap); if (!g) grupos.set(it.ap, g = []); g.push(it); }
  for (const a of usadas) {
    L.push('D' + a.d + '*');
    for (const it of grupos.get(a)) {
      if (it.k === 'flash') {
        const s = xy(it.x, it.y);
        if (s) L.push(s + 'D02*');
        L.push('D03*');
      } else if (it.k === 'line') {
        if (it.x1 !== px || it.y1 !== py) L.push(xy(it.x1, it.y1) + 'D02*');
        L.push(xy(it.x2, it.y2, it.x1 === it.x2 && it.y1 === it.y2) + 'D01*');
      } else {
        if (it.sx !== px || it.sy !== py) L.push(xy(it.sx, it.sy) + 'D02*');
        else L.push('D02*');
        L.push(it.cw ? 'G02*' : 'G03*');
        L.push('X' + it.ex + 'Y' + it.ey + 'I' + (it.cx - it.sx) + 'J' + (it.cy - it.sy) + 'D01*');
        px = it.ex; py = it.ey;
        L.push('G01*');
      }
    }
  }
  /* MD5 de tudo o que veio antes, sem CR e sem LF (conferido em 13/13 arquivos do DMB) */
  if (o.x2) L.push('%TF.MD5,' + md5(L.join('')) + '*%');
  L.push('M02*');
  return L.join('\r\n') + '\r\n';
}

/* ============================== nomes ============================== */

/* o nome base vira nome de arquivo no disco do servidor (POST /api/gerber aceita so letras sem
   acento, numeros, espaco e _ . ( ) + -): acento sai (MARCACAO), o resto vira _ */
function baseDe(B, opts) {
  let b = opts && opts.base;
  if (!b && B && typeof B.source === 'string') b = B.source.split(/[\\/]/).pop().replace(/\.pcbdoc$/i, '');
  b = String(b || 'placa');
  if (typeof b.normalize === 'function') b = b.normalize('NFD').replace(/[̀-ͯ]/g, '');
  b = b.replace(/[^A-Za-z0-9 _.()+-]+/g, '_').replace(/^[.\s]+/, '').trim();
  return b || 'placa';
}
function nomeDoArquivo(o, def) {
  let ext = 'gbr';
  if (o.gtoGbo && def.tipo === 'legenda') ext = def.lado === 'bottom' ? 'gbo' : 'gto';
  const n = o.base + '_' + def.sufixo + '.' + ext;
  return o.nomes === 'altium' ? n : n.toLowerCase().replace(/ /g, '_');
}
function novoGuid() {
  try {
    const c = dep('crypto', null);
    if (c && typeof c.randomUUID === 'function') return c.randomUUID().toUpperCase();
  } catch (_) { /* sem crypto: cai no Math.random */ }
  const h = n => { let s = ''; for (let i = 0; i < n; i++) s += '0123456789ABCDEF'[Math.floor(Math.random() * 16)]; return s; };
  return h(8) + '-' + h(4) + '-4' + h(3) + '-' + '89AB'[Math.floor(Math.random() * 4)] + h(3) + '-' + h(12);
}
/* valor de atributo X2 nao pode ter * % , nem quebra de linha */
const valorAtributo = s => String(s).replace(/[*%,\r\n]+/g, ' ').trim();

/* ============================== gerar ============================== */

function gerar(board, opts) {
  const B = (board && typeof board === 'object') ? board : {};
  opts = opts || {};
  const o = {
    base: baseDe(B, opts),
    nomes: opts.nomes === 'altium' ? 'altium' : 'fabricacao',
    vazias: opts.vazias === true,
    gtoGbo: opts.gtoGbo === true,
    x2: opts.x2 !== false,
    software: valorAtributo(opts.software || 'NexoEletric') || 'NexoEletric',
    guid: valorAtributo(opts.guid || novoGuid()).toUpperCase(),
  };
  const av = criaAvisos();
  if (!B.exporter) av.add('espelho-antigo');
  if (!Array.isArray(B.fills)) av.add('sem-fills');

  const pads = [];
  for (const c of B.components || []) for (const p of (c && c.pads) || []) if (p) pads.push({ p, ref: c.ref });
  for (const p of B.freepads || []) if (p) pads.push({ p, ref: null });

  const pilha = pilhaDeCobre(B, av), posicao = {};
  pilha.forEach((k, i) => { posicao[k] = i + 1; });

  /* avisos que olham a placa inteira, uma vez por objeto */
  for (const v of B.vias || []) {
    if (!viaValida(v)) continue;
    if (v.tentTop === undefined || v.tentBot === undefined) av.add('via-tent', v);
    const a = posicao[v.from] || 1, b = posicao[v.to] || pilha.length;
    if (Math.min(a, b) !== 1 || Math.max(a, b) !== pilha.length) av.add('via-cega', v);
  }
  for (const k of ['tracks', 'arcs', 'silk', 'lines', 'fills', 'regions', 'texts'])
    for (const x of Array.isArray(B[k]) ? B[k] : []) if (x && /^Plane\d+$/.test(x.layer)) av.add('plano', x);
  if (!B.exporter)
    for (const g of B.regions || []) if (g && RE_COBRE.test(g.layer) && !Array.isArray(g.holes)) av.add('regiao-sem-furos', g);

  /* D-codes globais: o mesmo numero e a mesma abertura no cobre, na mascara, na pasta e no Pad
     Master (D16 do DMB). Numerados a partir de D10 na ordem em que aparecem. */
  const porChave = new Map();
  let proxD = 10;
  const ctx = {
    B, o, av, pads, pilha, posicao,
    abertura(funcao, geo) {
      const chave = funcao + '|' + geo.chave;
      let a = porChave.get(chave);
      if (!a) { a = Object.assign({ d: proxD++, funcao }, geo); porChave.set(chave, a); }
      return a;
    },
  };
  ctx.recortes = recortesDaPlaca(B, av);

  const todos = [];
  for (const def of definicoes(B, pilha)) {
    const cam = coleta(ctx, def);
    const seq = seqRegioes(cam);
    const n = contagens(cam, seq);
    const vazio = !cam.itens.length && !seq.length;
    const texto = escreve(ctx, cam, seq);
    todos.push({ nome: nomeDoArquivo(o, def), camada: def.camada, funcao: def.funcao, rotulo: def.rotulo,
                 texto, vazio, contagens: n, furos: (def.tipo === 'pth' || def.tipo === 'npth') ? n.flashes + n.regioes : 0 });
  }
  const arquivos = todos.filter(a => o.vazias || !a.vazio).map(a => ({
    nome: a.nome, camada: a.camada, funcao: a.funcao, rotulo: a.rotulo, texto: a.texto, vazio: a.vazio, contagens: a.contagens }));
  const avisos = av.lista();
  const descartadas = todos.filter(a => !o.vazias && a.vazio).map(a => a.nome);
  const resumo = {
    base: o.base, zip: o.base + '.zip', nomes: o.nomes, x2: o.x2, gtoGbo: o.gtoGbo, guid: o.guid, software: o.software,
    exporter: B.exporter || null, camadasCobre: pilha.length,
    arquivos: todos.map(a => Object.assign({ nome: a.nome, camada: a.camada, rotulo: a.rotulo, funcao: a.funcao,
      vazio: a.vazio, descartado: !o.vazias && a.vazio, furos: a.furos, bytes: a.texto.length }, a.contagens)),
    descartadas, avisos,
  };
  resumo.texto = textoDoResumo(resumo, arquivos.length);
  return { arquivos, avisos, resumo };
}

function textoDoResumo(r, n) {
  const L = ['Gerber X2 (mm 4:5) de "' + r.base + '": ' + n + ' arquivo' + (n === 1 ? '' : 's') +
             (r.descartadas.length ? ' (' + r.descartadas.length + ' vazio' + (r.descartadas.length === 1 ? '' : 's') + ' fora do pacote)' : '') + '.'];
  for (const a of r.arquivos) {
    if (a.descartado) continue;
    const p = [];
    if (a.flashes) p.push(a.flashes + ' flashes');
    if (a.tracos) p.push(a.tracos + ' traços');
    if (a.arcos) p.push(a.arcos + ' arcos');
    if (a.regioes) p.push(a.regioes + ' regiões');
    if (a.furos) p.push(a.furos + ' furos');
    L.push('- ' + a.nome + ' — ' + a.rotulo + ': ' + (p.length ? p.join(', ') : 'vazio'));
  }
  if (r.avisos.length) { L.push('Avisos:'); for (const a of r.avisos) L.push('- ' + a); }
  return L.join('\n');
}

/* ============================== MD5 ============================== */

const MD5_K = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];
const MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];

function utf8(s) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
  const t = unescape(encodeURIComponent(s)), out = new Uint8Array(t.length);
  for (let i = 0; i < t.length; i++) out[i] = t.charCodeAt(i);
  return out;
}
/* md5(texto) -> hex minusculo (texto em UTF-8; o Gerber e ASCII) */
function md5(str) {
  const b = typeof str === 'string' ? utf8(str) : (str instanceof Uint8Array ? str : utf8(String(str)));
  const n = b.length, blocos = ((n + 8) >>> 6) + 1, M = new Uint32Array(blocos * 16);
  for (let i = 0; i < n; i++) M[i >> 2] |= b[i] << ((i & 3) * 8);
  M[n >> 2] |= 0x80 << ((n & 3) * 8);
  M[blocos * 16 - 2] = (n * 8) >>> 0;
  M[blocos * 16 - 1] = Math.floor(n * 8 / 4294967296) >>> 0;
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let k = 0; k < M.length; k += 16) {
    let A = a0, Bv = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (Bv & C) | (~Bv & D); g = i; }
      else if (i < 32) { F = (D & Bv) | (~D & C); g = (5 * i + 1) & 15; }
      else if (i < 48) { F = Bv ^ C ^ D; g = (3 * i + 5) & 15; }
      else { F = C ^ (Bv | ~D); g = (7 * i) & 15; }
      const s = MD5_S[(i >> 4) * 4 + (i & 3)];
      const x = (A + F + MD5_K[i] + M[k + g]) | 0;
      A = D; D = C; C = Bv;
      Bv = (Bv + ((x << s) | (x >>> (32 - s)))) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + Bv) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  let hex = '';
  for (const v of [a0, b0, c0, d0]) for (let j = 0; j < 4; j++) hex += ((v >>> (8 * j)) & 255).toString(16).padStart(2, '0');
  return hex;
}

/* ============================== .zip ============================== */

let TABELA_CRC = null;
function crc32(bytes) {
  if (!TABELA_CRC) {
    TABELA_CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      TABELA_CRC[n] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = TABELA_CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
/* deflate cru pelo CompressionStream; null quando o ambiente nao tem (cai em store) */
async function deflateRaw(dados) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const cs = new CompressionStream('deflate-raw');
    const w = cs.writable.getWriter();
    w.write(dados).catch(() => {});
    w.close().catch(() => {});
    const r = cs.readable.getReader(), partes = [];
    let total = 0;
    for (;;) {
      const x = await r.read();
      if (x.done) break;
      partes.push(x.value);
      total += x.value.length;
    }
    const out = new Uint8Array(total);
    let p = 0;
    for (const q of partes) { out.set(q, p); p += q.length; }
    return out;
  } catch (_) {
    return null;
  }
}
/* zip(arquivos, {deflate, data}) -> Promise<Uint8Array>. arquivos: [{nome, texto}] (ou {nome,
   bytes}). deflate: padrao = usar quando o ambiente tem; arquivo que nao encolhe vai store. Nome
   com acento sai em UTF-8 (bit 11). Sem descritor de dados: os tamanhos vao no cabecalho local. */
async function zip(arquivos, opts) {
  opts = opts || {};
  const quer = opts.deflate !== false;
  const data = opts.data instanceof Date ? opts.data : new Date();
  const hora = ((data.getHours() << 11) | (data.getMinutes() << 5) | (data.getSeconds() >> 1)) & 0xffff;
  const dia = ((Math.max(0, data.getFullYear() - 1980) << 9) | ((data.getMonth() + 1) << 5) | data.getDate()) & 0xffff;
  const ents = [];
  for (const a of arquivos || []) {
    if (!a) continue;
    const nome = String(a.nome || 'arquivo').replace(/\\/g, '/');
    const dados = a.bytes instanceof Uint8Array ? a.bytes : utf8(a.texto == null ? '' : String(a.texto));
    let metodo = 0, comp = dados;
    if (quer) { const z = await deflateRaw(dados); if (z && z.length < dados.length) { metodo = 8; comp = z; } }
    ents.push({ nb: utf8(nome), utf: /[^\x00-\x7f]/.test(nome), crc: crc32(dados), tam: dados.length, comp, metodo });
  }
  let total = 22;
  for (const e of ents) total += 30 + e.nb.length + e.comp.length + 46 + e.nb.length;
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  let p = 0;
  const u16 = v => { dv.setUint16(p, v, true); p += 2; };
  const u32 = v => { dv.setUint32(p, v >>> 0, true); p += 4; };
  const bytes = b => { out.set(b, p); p += b.length; };
  for (const e of ents) {
    e.off = p;
    u32(0x04034b50); u16(e.metodo ? 20 : 10); u16(e.utf ? 0x0800 : 0); u16(e.metodo);
    u16(hora); u16(dia); u32(e.crc); u32(e.comp.length); u32(e.tam);
    u16(e.nb.length); u16(0); bytes(e.nb); bytes(e.comp);
  }
  const cd = p;
  for (const e of ents) {
    u32(0x02014b50); u16(20); u16(e.metodo ? 20 : 10); u16(e.utf ? 0x0800 : 0); u16(e.metodo);
    u16(hora); u16(dia); u32(e.crc); u32(e.comp.length); u32(e.tam);
    u16(e.nb.length); u16(0); u16(0); u16(0); u16(0); u32(0); u32(e.off); bytes(e.nb);
  }
  const tamCd = p - cd;
  u32(0x06054b50); u16(0); u16(0); u16(ents.length); u16(ents.length); u32(tamCd); u32(cd); u16(0);
  return out;
}

return {
  gerar, zip, md5, crc32, VERSAO,
  /* os glifos que a HubFont nao tem, no formato do FONTDATA dela (para o dono do hub-font.js) */
  GLIFOS_EXTRA,
  /* a geometria do texto que o Gerber escreve: a vista PCB desenha com ela */
  geometriaTexto,
  /* para os testes e para quem quiser a mesma conta */
  geoPad, caminhoContorno, unid, f5,
};
});
