/* NexoEletric - hub-pcbartes.js — as ARTES DE OVERLAY da PCB: o motor (puro, sem DOM).

   Pedido do dono (2026-11-10): "nas PCBs a gente sempre coloca o código da placa com revisão, e sempre a logo com o
   QR CODE pro site da dieletrons, eu queria que isso virasse uma logo overlay padrão, onde a gente só puxa e já vem
   com o código da placa + a revisão automática, e a logo fica lá adicionada por padrão, mas pode adicionar novas,
   criar, é um studio pra criação desse tipo de arte". E: "é como se fosse uma ferramenta mesmo, na área de PCB".

   A ARTE (o que a biblioteca guarda: Libs/pcb-artes.json, que viaja pelo NexoBD como o resto da Libs/):
     { id, nome, versao (sobe a cada gravação), padrao (as duas da casa), atualizado, autor,
       elementos:[ ... ] }   em mm, Y para cima, em torno da origem da arte (o ponto que a pessoa segura)
   Os elementos (o Studio, hub-pcbartes-ui.js, cria e edita):
     {tipo:'texto', x, y, texto, h, w, rot}            centrado em x,y (a fonte stroke da placa). Os CAMPOS
                                                       "=CodigoDaPlaca", "=Revisao", "=NomeDaPlaca"... (HubCore.CAMPOS_ARTE)
                                                       resolvem sozinhos, na tela e no Gerber, em qualquer lugar do texto
     {tipo:'linha', x1, y1, x2, y2, w}
     {tipo:'retangulo', x, y, larg, alt, w, cheio}     x,y = centro; cheio = região, senão quatro traços de w
     {tipo:'circulo', x, y, r, w, cheio}
     {tipo:'qr', x, y, tam, texto, ec, borda, invertido}  QR de verdade (hub-qr.js): os módulos viram regiões
                                                       retangulares; tam = o lado com a borda; invertido = a serigrafia é a
                                                       parte CLARA do QR (placa escura, como o QR das placas da casa)
     {tipo:'regioes', x, y, escala, regioes:[{pts, holes}]}   a imagem/logo convertida (HubSilkGen), em torno de 0,0
   Compilar (compila) dá o desenho pronto para a placa {l, a, r, t} (o `fp` do comp_add: HubCore.arteGeom).

   API:
     PADRAO                         as duas artes da casa (não se apagam; só o admin edita)
     lista(lib)                     as artes da biblioteca (as da casa + as do arquivo; a do arquivo com o mesmo id ganha)
     compila(arte) -> {fp, avisos, caixa}
     confere(fp, escala) -> [avisos]   o mínimo da serigrafia da JLC (traço 0,15 mm, texto 0,8 mm de altura)
     opColocar(arte, {ref, x, y, rot, layer, escala}) -> a linha comp_add do changes.js
     proximoRef(usados) -> 'ARTE1', 'ARTE2'...
     qrRegioes(el) -> [{pts}]       os módulos do QR em mm (em torno de x,y)
     novoId(nome, usados), novaArte(nome), duplica(arte, usados)
     CAMPOS                         os campos com o rótulo (para o Studio) */
(function (raiz, fabrica) {
  const m = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.HubPcbArtes = m;
})(typeof self !== 'undefined' ? self : this, function (raiz) {
'use strict';

const QR = (typeof module === 'object' && module.exports && typeof require === 'function') ? require('./hub-qr.js') : raiz.HubQR;

const isNum = v => typeof v === 'number' && isFinite(v);
const r4 = v => { const x = Math.round(v * 1e4) / 1e4; return x === 0 ? 0 : x; };
const LARG_MIN = 0.15;     /* traço mínimo de serigrafia da JLC (e da casa: HubPcbSilkGen.LARGURA_MIN) */
const ALT_MIN = 0.8;       /* altura mínima de texto legível na serigrafia da JLC */

const CAMPOS = [
  { nome: 'CodigoDaPlaca', rot: 'Código da placa', ex: 'PMD-DI261946' },
  { nome: 'Revisao', rot: 'Revisão', ex: 'REV. C' },
  { nome: 'NomeDaPlaca', rot: 'Nome da placa', ex: 'MICROCONTROLADORA DE DISPLAY' },
  { nome: 'CodigoDoEquipamento', rot: 'Código do equipamento', ex: 'DMB-DI231765' },
  { nome: 'NomeDoEquipamento', rot: 'Nome do equipamento', ex: 'DISPLAY ASCII' },
  { nome: 'Cliente', rot: 'Cliente', ex: 'CSN' },
  { nome: 'Data', rot: 'Data de hoje', ex: '10/11/2026' },
  { nome: 'Data_desenho', rot: 'Data do desenho', ex: '10/11/26' },
  { nome: 'Projeto', rot: 'Nome do projeto', ex: 'DMB - DI231765_P2' },
];

/* ── as duas artes da casa ──
   1. A LOGO DiEletrons + o QR do site: o desenho medido na DMB - DI231765_P2 (a placa que o dono mostrou). A logo era
      um bitmap do Altium (1.392 linhas de 0,0508 mm na Top Overlay, 24,0 × 8,1 mm, com "dieletrons.com" embaixo do
      traço) e virou 28 regiões (HubSilkGen.contornos: o mesmo desenho, sem traço abaixo do mínimo). O QR era feito de
      196 fills de 0,345 mm e decodifica para "www.dieletrons.com" (nível L, versão 2, invertido: a serigrafia é a parte
      clara, com 2 módulos de borda); aqui ele é GERADO a partir do texto, com a mesma medida (10 mm de lado).
   2. O CÓDIGO DA PLACA + a REVISÃO: o bloco que a casa digitava à mão ("PDMB-DI231765_P2" / "REV. C", 1,524 mm de
      altura, traço 0,254), agora com os campos =CodigoDaPlaca e =Revisao. */
/* a logo: uma string por regiao, "x,y x,y ...|furo|furo" em mm, em torno do centro da logo */
const LOGO_REGIOES = [
  '-4.1148,4.0132 -4.2418,3.937 -4.2418,0.0762 -3.4036,0.0508 -3.3782,0.0762 -3.4036,4.064',
  '-12.0142,0.0762 -10.2108,0.0508 -10.16,0.1016 -9.9568,0.1016 -9.906,0.1524 -9.7536,0.1524 -9.652,0.2032 -9.3726,0.4826 -9.3218,0.5842 -9.3218,3.3274 -9.3726,3.3782 -9.4234,3.5814 -9.5504,3.7084 -9.7536,3.81 -9.906,3.81 -9.9568,3.8608 -12.0142,3.8354|-10.3632,3.1496 -10.1854,2.921 -10.1854,1.0414 -10.3632,0.8128 -10.5156,0.8128 -10.5664,0.762 -11.1506,0.7874 -11.1506,3.1242',
  '-7.2898,2.5146 -6.4516,2.4892 -6.4008,3.048 -4.826,3.048 -4.8006,3.8354 -7.2644,3.8608',
  '-8.7122,2.921 -7.874,2.8956 -7.8486,3.683 -8.6868,3.7084',
  '0.2286,2.8702 -0.2286,2.8194 -0.2286,2.2606 -0.1524,2.1844 0.2286,2.159 0.2286,0.4826 0.381,0.1778 0.508,0.1524 0.5588,0.1016 0.6604,0.1016 0.7112,0.0508 1.3208,0.0508 1.3716,0.1016 1.5748,0.1016 1.6764,0.1524 1.7018,0.4826 1.651,0.5334 1.651,0.7366 1.5748,0.8128 1.4732,0.762 1.3208,0.762 1.27,0.7112 1.0922,0.7874 1.0922,2.159 1.6764,2.1844 1.7018,2.4638 1.7526,2.5146 1.7526,2.8194 1.0922,2.8702 1.0668,3.556 0.254,3.556',
  '-2.0828,2.9464 -2.3368,2.9464 -2.3876,2.8956 -2.5908,2.8448 -2.8702,2.5654 -2.8702,2.4638 -2.921,2.413 -2.921,2.2098 -2.9718,2.159 -2.9718,0.9906 -2.921,0.9398 -2.921,0.635 -2.7686,0.3302 -2.6924,0.254 -2.3876,0.1016 -2.1844,0.1016 -2.1336,0.0508 -1.27,0.0508 -1.2192,0.1016 -0.9652,0.1016 -0.762,0.2032 -0.6096,0.2032 -0.5334,0.2794 -0.5842,0.3302 -0.5842,0.4826 -0.635,0.5334 -0.6604,0.8128 -0.8128,0.8128 -0.8636,0.762 -1.016,0.762 -1.0668,0.7112 -1.9812,0.7112 -2.1082,0.889 -2.0828,1.1684 -0.5334,1.1938 -0.5334,2.159 -0.5842,2.2098 -0.5842,2.4638 -0.635,2.5146 -0.635,2.6162 -0.9144,2.8956 -1.2192,2.9464 -1.27,2.9972 -2.032,2.9972|-1.6764,2.3368 -1.6256,2.286 -1.524,2.286 -1.397,2.159 -1.4224,1.8288 -2.0574,1.8542 -2.0574,2.159 -1.9304,2.286',
  '5.334,2.9464 5.0292,2.9464 4.9784,2.8956 4.826,2.8956 4.6228,2.794 4.3434,2.5146 4.3434,2.413 4.2926,2.3622 4.2926,2.159 4.2418,2.1082 4.2418,0.9398 4.2926,0.889 4.2926,0.635 4.3434,0.5842 4.3942,0.381 4.572,0.2032 4.7752,0.1016 4.9276,0.1016 4.9784,0.0508 5.9944,0.0508 6.0452,0.1016 6.2992,0.1524 6.4008,0.254 6.4516,0.254 6.731,0.5334 6.7818,0.7366 6.8326,0.7874 6.8326,0.9906 6.8834,1.0414 6.8834,2.0066 6.8326,2.0574 6.8326,2.3114 6.7818,2.3622 6.7818,2.5146 6.731,2.6162 6.5024,2.8448 6.2484,2.8956 6.1976,2.9464 5.842,2.9464 5.7912,2.9972 5.3848,2.9972|5.6896,2.3368 5.7404,2.286 5.842,2.286 5.969,2.159 5.969,2.0574 6.0198,2.0066 6.0198,1.0922 5.9182,0.889 5.6896,0.7112 5.3848,0.7112 5.334,0.762 5.2324,0.762 5.1562,0.8382 5.1562,0.9398 5.1054,0.9906 5.1054,2.0066 5.1562,2.0574 5.1562,2.159 5.2832,2.286 5.3848,2.286 5.4356,2.3368',
  '3.5052,2.8448 3.4036,2.8448 3.048,2.6416 2.9464,2.8448 2.2098,2.8194 2.2098,0.0762 3.048,0.0508 3.0734,0.0762 3.0734,1.8034 3.2004,1.9304 3.5052,2.0828 3.7592,2.1336 3.8354,2.2098 3.7592,2.8956 3.556,2.8956',
  '10.6172,2.8448 10.414,2.8448 10.3632,2.794 10.2616,2.794 10.0838,2.6162 10.0838,2.5146 10.033,2.4638 10.033,1.4478 10.3632,1.2192 10.668,1.1684 10.7188,1.1176 10.8712,1.1176 10.922,1.0668 11.0744,1.0668 11.1506,0.9906 11.1506,0.7366 10.6172,0.7112 10.5664,0.762 10.3632,0.762 10.3124,0.8128 10.1092,0.8636 10.0838,0.7366 10.033,0.6858 10.033,0.4826 9.9822,0.4318 9.9822,0.2286 10.1092,0.2032 10.16,0.1524 10.3124,0.1524 10.3632,0.1016 10.6172,0.1016 10.668,0.0508 11.3792,0.0508 11.43,0.1016 11.6332,0.1016 11.684,0.1524 11.7856,0.1524 11.9126,0.2794 11.9634,0.381 11.9634,0.5334 12.0142,0.5842 12.0142,1.1938 11.9634,1.2446 11.9634,1.3462 11.7856,1.524 11.5824,1.6256 10.922,1.778 10.8458,1.8542 10.8458,2.159 10.922,2.2352 11.5824,2.2352 11.6332,2.1844 11.938,2.1844 12.0142,2.3114 12.0142,2.7686 11.938,2.8448 11.684,2.8448 11.6332,2.8956 10.668,2.8956',
  '8.382,2.794 8.2296,2.794 7.9248,2.6416 7.874,2.794 7.239,2.7686 7.239,0.2286 8.0264,0.2032 8.0518,0.2286 8.0518,1.9558 8.4328,2.1336 8.6868,2.1336 8.7122,0.2286 9.4488,0.2032 9.4742,0.2286 9.4742,2.5146 9.2964,2.794 9.1948,2.794 9.144,2.8448 8.4328,2.8448',
  '-8.7122,0.0762 -7.874,0.0508 -7.8486,0.0762 -7.874,2.794 -8.7122,2.7686',
  '-7.2898,1.6002 -5.334,1.5748 -5.3086,2.3622 -7.2644,2.3876',
  '-7.2898,0.0762 -4.826,0.0508 -4.8006,0.8382 -6.4008,0.8636 -6.4516,1.4732 -7.2644,1.4732',
  '-7.239,-1.6002 11.7348,-1.6256 11.7602,-0.889 -7.2136,-0.8636',
  '-6.0198,-1.9558 -6.0452,-2.4892 -6.604,-2.4892 -6.6548,-2.54 -6.7564,-2.54 -6.8326,-2.6162 -6.8834,-2.7178 -6.8834,-3.7846 -6.8326,-3.8862 -6.604,-4.064 -6.0452,-4.064 -5.9944,-4.0132 -5.9436,-4.064 -5.5118,-4.0386 -5.5372,-1.8796 -5.9436,-1.8796|-6.096,-2.8956 -6.0198,-2.9718 -6.0198,-3.5306 -6.1976,-3.6576 -6.3754,-3.6322 -6.3754,-2.921',
  '-5.2578,-2.3622 -4.7752,-2.3876 -4.7498,-1.905 -5.2324,-1.8796',
  '-3.0734,-1.9558 -3.0734,-4.0386 -2.5146,-4.0386 -2.54,-1.8796 -2.9464,-1.8796',
  '-0.508,-2.0828 -0.5588,-2.1336 -0.762,-2.1336 -0.8382,-2.2098 -0.8382,-2.4638 -1.0414,-2.5146 -1.0668,-2.6924 -1.3208,-2.4892 -2.032,-2.4892 -2.3114,-2.7178 -2.3114,-2.8194 -2.3622,-2.8702 -2.3622,-3.683 -2.3114,-3.7338 -2.2606,-3.937 -2.0828,-4.064 -1.27,-4.064 -1.2192,-4.0132 -1.1176,-4.0132 -1.0414,-3.937 -1.0414,-3.8862 -1.0922,-3.8354 -1.1176,-3.6068 -1.27,-3.6068 -1.3208,-3.6576 -1.778,-3.6576 -1.8034,-3.4798 -1.0668,-3.4544 -1.0414,-2.921 -0.8636,-2.8956 -0.8382,-3.683 -0.7874,-3.7338 -0.7874,-3.937 -0.6604,-4.064 0,-4.064 0.0762,-3.9878 0.0254,-3.683 -0.2794,-3.6322 -0.2794,-2.921 0.0762,-2.8702 0.0762,-2.5146 -0.2794,-2.4638 -0.3048,-2.032|-1.5494,-2.921 -1.5748,-3.048 -1.8034,-3.0226 -1.8034,-2.9718 -1.7272,-2.8956',
  '0.7112,-2.5908 0.635,-2.5654 0.6096,-2.4892 0.1778,-2.5146 0.1778,-4.0386 0.7366,-4.0386 0.7366,-3.0734 1.016,-2.9464 1.0922,-2.8702 1.0922,-2.6162 1.0414,-2.5654 1.016,-2.4384',
  '-5.2578,-4.0386 -4.7498,-4.0386 -4.7752,-2.4892 -5.2578,-2.5146',
  '-4.318,-2.54 -4.5466,-2.8194 -4.5466,-3.7846 -4.4958,-3.8862 -4.2672,-4.064 -3.4544,-4.064 -3.4036,-4.0132 -3.302,-4.0132 -3.2258,-3.937 -3.2766,-3.8862 -3.2766,-3.683 -3.3528,-3.6068 -3.5052,-3.6068 -3.556,-3.6576 -3.9624,-3.6576 -4.0386,-3.5814 -4.0386,-3.4798 -3.2258,-3.429 -3.2258,-2.8194 -3.2766,-2.7686 -3.2766,-2.667 -3.5052,-2.4892 -4.2164,-2.4892|-3.81,-2.8956 -3.7338,-2.9718 -3.7592,-3.048 -4.0386,-3.0226 -3.9624,-2.8956',
  '1.27,-2.5908 1.143,-2.7178 1.143,-2.8702 1.0922,-2.921 1.0922,-3.6322 1.143,-3.683 1.143,-3.8354 1.4224,-4.064 2.1844,-4.064 2.3876,-3.9624 2.5146,-3.7338 2.5146,-2.8194 2.4638,-2.7686 2.4638,-2.667 2.2352,-2.4892 1.4732,-2.4892|1.9304,-2.8956 2.0066,-2.9718 2.0066,-3.5814 1.9304,-3.6576 1.7272,-3.6576 1.651,-3.5814 1.651,-2.9718 1.7272,-2.8956',
  '2.7178,-4.0386 3.2258,-4.0386 3.2258,-3.0734 3.4036,-2.9464 3.556,-2.9464 3.5814,-4.0386 4.0894,-4.0386 4.0894,-2.7178 3.9116,-2.4892 3.3528,-2.4892 3.302,-2.54 3.1496,-2.54 3.0988,-2.4892 2.7178,-2.5146',
  '4.3434,-2.6162 4.2926,-2.7178 4.2926,-3.2258 4.5212,-3.4036 4.9276,-3.5052 4.953,-3.6322 4.5212,-3.6576 4.4704,-3.6068 4.3688,-3.6068 4.2926,-3.7338 4.2926,-3.937 4.2418,-3.9878 4.3688,-4.0132 4.4196,-4.064 5.2324,-4.064 5.4102,-3.937 5.461,-3.8354 5.461,-3.3782 5.4102,-3.2766 5.1308,-3.0988 4.8768,-3.048 4.8006,-2.9718 4.826,-2.8956 5.2324,-2.8956 5.2832,-2.9464 5.3848,-2.9464 5.4102,-2.5654 5.334,-2.4892 4.5212,-2.4892',
  '6.5024,-2.5908 6.4262,-2.7178 6.4262,-2.8702 6.3754,-2.921 6.3754,-3.5814 6.4262,-3.6322 6.4262,-3.8354 6.477,-3.937 6.6548,-4.064 7.4676,-4.064 7.5438,-3.9878 7.5438,-3.8862 7.493,-3.8354 7.4676,-3.6068 7.366,-3.6068 7.3152,-3.6576 7.0104,-3.6576 6.9342,-3.5814 6.9342,-2.9718 7.0104,-2.8956 7.2644,-2.8956 7.3152,-2.9464 7.4676,-2.9464 7.5438,-2.5654 7.4676,-2.4892 6.7056,-2.4892',
  '7.7724,-2.5908 7.6454,-2.7686 7.6454,-2.921 7.5946,-2.9718 7.5946,-3.5814 7.6454,-3.6322 7.6454,-3.8354 7.9248,-4.064 8.6868,-4.064 8.89,-3.9624 9.017,-3.7846 9.017,-2.7686 8.9662,-2.667 8.7376,-2.4892 7.9756,-2.4892|8.4328,-2.8956 8.509,-2.9718 8.509,-3.5814 8.4328,-3.6576 8.2296,-3.6576 8.1534,-3.5814 8.1534,-2.9718 8.2296,-2.8956',
  '9.2202,-4.0386 9.7282,-4.0386 9.7282,-3.0734 9.906,-2.9464 10.0584,-2.9464 10.0838,-4.0386 10.5664,-4.064 10.5918,-3.0734 10.7696,-2.9464 10.8712,-2.9464 10.9474,-3.0226 10.9474,-4.0386 11.43,-4.064 11.4554,-2.7178 11.4046,-2.6162 11.2776,-2.4892 10.7188,-2.4892 10.5156,-2.5908 10.414,-2.4892 9.8552,-2.4892 9.8044,-2.54 9.652,-2.54 9.6012,-2.4892 9.2456,-2.4892',
  '5.6642,-4.0386 6.1722,-4.0386 6.1468,-3.5052 5.6642,-3.5306'];
const decod = s => s.split('|').map(a => a.split(' ').map(p => p.split(',').map(Number)));
const PADRAO = [
  { id: 'dieletrons-logo-qr', nome: 'Logo DiEletrons + QR', padrao: true, versao: 1,
    descricao: 'A logo da casa com o QR do site (www.dieletrons.com), como nas placas (medida na DMB - DI231765_P2)',
    elementos: [
      { tipo: 'qr', x: -12.4655, y: -0.0321, tam: 10, texto: 'www.dieletrons.com', ec: 'L', borda: 2, invertido: true },
      { tipo: 'regioes', nome: 'logo DiEletrons', x: 5.4513, y: 0.9681, escala: 1,
        regioes: LOGO_REGIOES.map(s => { const R = decod(s); return { pts: R[0], holes: R.slice(1) }; }) },
    ] },
  { id: 'codigo-revisao', nome: 'Código da placa + revisão', padrao: true, versao: 1,
    descricao: 'O código da placa do Definir projeto e a revisão do projeto, automáticos',
    elementos: [
      { tipo: 'texto', x: 0, y: 1.345, texto: '=CodigoDaPlaca', h: 1.524, w: 0.254, rot: 0 },
      { tipo: 'texto', x: 0, y: -1.345, texto: '=Revisao', h: 1.524, w: 0.254, rot: 0 },
    ] },
];
const IDS_PADRAO = new Set(PADRAO.map(a => a.id));
const ehPadrao = id => IDS_PADRAO.has(String(id));

/* as artes da biblioteca: as da casa (a versão do arquivo ganha, se o admin a editou) + as do arquivo, sem as apagadas */
function lista(lib) {
  const arq = (lib && Array.isArray(lib.artes)) ? lib.artes.filter(a => a && typeof a.id === 'string' && a.id) : [];
  const porId = new Map(arq.map(a => [a.id, a]));
  const out = [];
  for (const p of PADRAO) {
    const f = porId.get(p.id);
    if (f && f.apagada) continue;
    out.push(f && Array.isArray(f.elementos) ? Object.assign({}, f, { padrao: true }) : p);
  }
  for (const a of arq) if (!ehPadrao(a.id) && !a.apagada && Array.isArray(a.elementos)) out.push(a);
  return out;
}

/* ── QR em regiões ── */
function qrRegioes(el) {
  const q = QR.gera(String(el.texto || ''), { ec: el.ec || 'M' });
  const borda = isNum(el.borda) && el.borda >= 0 ? Math.round(el.borda) : 2;
  const N = q.n + 2 * borda, tam = isNum(el.tam) && el.tam > 0 ? el.tam : 10, mod = tam / N;
  const x0 = (isNum(el.x) ? el.x : 0) - tam / 2, yTopo = (isNum(el.y) ? el.y : 0) + tam / 2;
  /* tinta: o módulo escuro (normal) ou o claro e a borda (invertido) */
  const tinta = (i, j) => {
    const x = i - borda, y = j - borda, dentro = x >= 0 && y >= 0 && x < q.n && y < q.n;
    const escuro = dentro && q.linhas[y][x] === 1;
    return el.invertido ? !escuro : escuro;
  };
  /* corridas por linha e, linhas iguais seguidas, juntas num retângulo só */
  const abertos = new Map(), rets = [];
  for (let j = 0; j <= N; j++) {
    const corr = [];
    if (j < N) for (let i = 0; i < N;) { if (!tinta(i, j)) { i++; continue; } const a = i; while (i < N && tinta(i, j)) i++; corr.push(a + ':' + i); }
    const agora = new Set(corr);
    for (const [k, r] of [...abertos]) if (!agora.has(k)) { rets.push(r); abertos.delete(k); } else r.j2 = j + 1;
    for (const k of corr) if (!abertos.has(k)) { const [a, b] = k.split(':').map(Number); abertos.set(k, { i1: a, i2: b, j1: j, j2: j + 1 }); }
  }
  return { modulo: mod, versao: q.versao, ec: q.ec, n: q.n,
    regioes: rets.map(r => {
      const xa = r4(x0 + r.i1 * mod), xb = r4(x0 + r.i2 * mod), ya = r4(yTopo - r.j2 * mod), yb = r4(yTopo - r.j1 * mod);
      return { pts: [[xa, ya], [xb, ya], [xb, yb], [xa, yb]] };
    }) };
}

const circuloPts = (cx, cy, r, n) => { const o = []; for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; o.push([r4(cx + r * Math.cos(a)), r4(cy + r * Math.sin(a))]); } return o; };

/* a arte -> o desenho da placa {l, a, r, t} + os avisos */
function compila(arte) {
  const fp = { l: [], a: [], r: [], t: [] }, avisos = [];
  for (const el of ((arte && arte.elementos) || [])) {
    if (!el || typeof el !== 'object') continue;
    try {
      switch (el.tipo) {
        case 'texto': {
          const t = String(el.texto == null ? '' : el.texto);
          if (!t.trim() || !(el.h > 0)) break;
          fp.t.push({ x: r4(el.x || 0), y: r4(el.y || 0), text: t, h: r4(el.h), w: r4(el.w > 0 ? el.w : el.h / 10), rot: isNum(el.rot) ? el.rot : 0 });
          break;
        }
        case 'linha':
          if ([el.x1, el.y1, el.x2, el.y2].every(isNum) && el.w > 0) fp.l.push([r4(el.x1), r4(el.y1), r4(el.x2), r4(el.y2), r4(el.w)]);
          break;
        case 'retangulo': {
          const hx = (el.larg || 0) / 2, hy = (el.alt || 0) / 2, x = el.x || 0, y = el.y || 0;
          if (!(hx > 0 && hy > 0)) break;
          if (el.cheio) fp.r.push({ pts: [[r4(x - hx), r4(y - hy)], [r4(x + hx), r4(y - hy)], [r4(x + hx), r4(y + hy)], [r4(x - hx), r4(y + hy)]] });
          else if (el.w > 0) {
            const c = [[x - hx, y - hy], [x + hx, y - hy], [x + hx, y + hy], [x - hx, y + hy]];
            for (let i = 0; i < 4; i++) fp.l.push([r4(c[i][0]), r4(c[i][1]), r4(c[(i + 1) % 4][0]), r4(c[(i + 1) % 4][1]), r4(el.w)]);
          }
          break;
        }
        case 'circulo':
          if (!(el.r > 0)) break;
          if (el.cheio) fp.r.push({ pts: circuloPts(el.x || 0, el.y || 0, el.r, 48) });
          else if (el.w > 0) fp.a.push([r4(el.x || 0), r4(el.y || 0), r4(el.r), 0, 360, r4(el.w)]);
          break;
        case 'qr': {
          if (!String(el.texto || '').length) { avisos.push('QR sem texto: não sai'); break; }
          const q = qrRegioes(el);
          for (const g of q.regioes) fp.r.push(g);
          if (q.modulo < LARG_MIN * 2) avisos.push(`QR: módulo de ${q.modulo.toFixed(3).replace('.', ',')} mm (versão ${q.versao}, ${q.n}×${q.n}) — abaixo de 0,3 mm a leitura pelo celular fica difícil; aumente o QR ou encurte o texto`);
          break;
        }
        case 'regioes': {
          const s = isNum(el.escala) && el.escala > 0 ? el.escala : 1, X = el.x || 0, Y = el.y || 0;
          const T = p => [r4(X + p[0] * s), r4(Y + p[1] * s)];
          for (const g of (el.regioes || [])) {
            if (!g || !Array.isArray(g.pts) || g.pts.length < 3) continue;
            const o = { pts: g.pts.map(T) };
            if (Array.isArray(g.holes) && g.holes.length) o.holes = g.holes.filter(h => Array.isArray(h) && h.length >= 3).map(h => h.map(T));
            fp.r.push(o);
          }
          break;
        }
        default: break;
      }
    } catch (e) { avisos.push((el.tipo || 'elemento') + ': ' + (e && e.message || e)); }
  }
  const caixa = caixaDe(fp);
  return { fp, avisos: avisos.concat(confere(fp, 1)), caixa };
}

function caixaDe(fp, escala) {
  const s = escala > 0 ? escala : 1;
  let b = null;
  const poe = (x, y) => { x *= s; y *= s; if (!b) b = { x1: x, y1: y, x2: x, y2: y }; else { b.x1 = Math.min(b.x1, x); b.y1 = Math.min(b.y1, y); b.x2 = Math.max(b.x2, x); b.y2 = Math.max(b.y2, y); } };
  for (const l of fp.l || []) { poe(Math.min(l[0], l[2]) - l[4] / 2, Math.min(l[1], l[3]) - l[4] / 2); poe(Math.max(l[0], l[2]) + l[4] / 2, Math.max(l[1], l[3]) + l[4] / 2); }
  for (const a of fp.a || []) { poe(a[0] - a[2] - a[5] / 2, a[1] - a[2] - a[5] / 2); poe(a[0] + a[2] + a[5] / 2, a[1] + a[2] + a[5] / 2); }
  for (const g of fp.r || []) for (const p of g.pts) poe(p[0], p[1]);
  for (const t of fp.t || []) {
    const L = t.text.split(/\r?\n/), larg = Math.max(...L.map(x => x.length)) * t.h * 0.8 / 2, alt = L.length * t.h * 1.4 / 2;
    const vert = Math.abs(Math.sin((t.rot || 0) * Math.PI / 180)) > 0.7;
    poe(t.x - (vert ? alt : larg), t.y - (vert ? larg : alt)); poe(t.x + (vert ? alt : larg), t.y + (vert ? larg : alt));
  }
  return b;
}

/* o mínimo da serigrafia: traço (linha, arco, texto) e altura de texto; a região é conferida pela largura média */
function confere(fp, escala) {
  const s = escala > 0 ? escala : 1, av = [];
  const finas = (fp.l || []).filter(l => l[4] * s < LARG_MIN - 1e-9).length + (fp.a || []).filter(a => a[5] * s < LARG_MIN - 1e-9).length;
  if (finas) av.push(`${finas} traço(s) abaixo de ${String(LARG_MIN).replace('.', ',')} mm — a JLC não imprime serigrafia tão fina`);
  for (const t of fp.t || []) {
    if (t.h * s < ALT_MIN - 1e-9) av.push(`texto "${t.text}" com ${(t.h * s).toFixed(2).replace('.', ',')} mm de altura — abaixo de ${String(ALT_MIN).replace('.', ',')} mm não se lê na serigrafia`);
    if (t.w * s < LARG_MIN - 1e-9) av.push(`texto "${t.text}" com traço de ${(t.w * s).toFixed(3).replace('.', ',')} mm — abaixo de ${String(LARG_MIN).replace('.', ',')} mm a JLC não imprime`);
  }
  /* região: 2 × área / perímetro (a largura média de uma tira) */
  let regFinas = 0;
  for (const g of fp.r || []) {
    const A = Math.abs(area(g.pts)) - (g.holes || []).reduce((t, h) => t + Math.abs(area(h)), 0);
    const P = perim(g.pts) + (g.holes || []).reduce((t, h) => t + perim(h), 0);
    if (P > 0 && 2 * A / P * s < LARG_MIN * 0.75) regFinas++;
  }
  if (regFinas) av.push(`${regFinas} região(ões) com partes mais finas que ${String(LARG_MIN).replace('.', ',')} mm — podem não sair na serigrafia`);
  return av;
}
function area(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; }
function perim(p) { let t = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; t += Math.hypot(q[0] - p[i][0], q[1] - p[i][1]); } return t; }

function proximoRef(usados) {
  const u = new Set([...(usados || [])].map(String));
  for (let i = 1; ; i++) if (!u.has('ARTE' + i)) return 'ARTE' + i;
}

/* a linha do changes.js que põe a arte na placa (um comp_add com o desenho compilado) */
function opColocar(arte, o) {
  o = o || {};
  const c = compila(arte);
  if (!c.fp.l.length && !c.fp.a.length && !c.fp.r.length && !c.fp.t.length) throw new Error('a arte "' + (arte && arte.nome) + '" não tem desenho');
  const op = { op: 'comp_add', ref: o.ref || 'ARTE1', footprint: 'ARTE_' + String(arte.id || 'arte').replace(/[^A-Za-z0-9_-]/g, '_'),
    x: r4(isNum(o.x) ? o.x : 0), y: r4(isNum(o.y) ? o.y : 0), rot: isNum(o.rot) ? ((o.rot % 360) + 360) % 360 : 0,
    layer: o.layer === 'Bottom' ? 'Bottom' : 'Top', comment: String(arte.nome || ''), des_hidden: true,
    arte: { id: String(arte.id || ''), nome: String(arte.nome || ''), versao: isNum(arte.versao) ? arte.versao : 0,
            escala: isNum(o.escala) && o.escala > 0 ? r4(o.escala) : 1, fp: c.fp },
    note: 'arte de overlay: ' + (arte.nome || arte.id) };
  return op;
}

function slug(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'arte';
}
function novoId(nome, usados) {
  const u = new Set(usados || []), b = slug(nome);
  if (!u.has(b) && !ehPadrao(b)) return b;
  for (let i = 2; ; i++) if (!u.has(b + '-' + i) && !ehPadrao(b + '-' + i)) return b + '-' + i;
}
function novaArte(nome, usados) {
  return { id: novoId(nome || 'Arte nova', usados), nome: nome || 'Arte nova', versao: 0, elementos: [
    { tipo: 'texto', x: 0, y: 0, texto: '=CodigoDaPlaca', h: 1.5, w: 0.2, rot: 0 }] };
}
function duplica(arte, usados) {
  const c = JSON.parse(JSON.stringify(arte));
  c.nome = (arte.nome || 'Arte') + ' (cópia)';
  c.id = novoId(c.nome, usados);
  delete c.padrao; c.versao = 0; delete c.atualizado; delete c.autor;
  return c;
}

/* os campos de um texto ("=CodigoDaPlaca" ...) */
function camposDe(texto) {
  const out = [];
  const re = /(^|[^A-Za-z0-9_])=([A-Za-z_][A-Za-z0-9_]*)/g;
  for (let m; (m = re.exec(String(texto || '')));) if (CAMPOS.some(c => c.nome.toLowerCase() === m[2].toLowerCase())) out.push(m[2]);
  return out;
}

/* ── O CÓDIGO DA PLACA NA SERIGRAFIA (1.92.2, pedido do dono: "um alerta, dizendo que o código não foi colocado na
   PCB, todas as PCBs precisam ter código") ──
   codigoNaPlaca(eb, codigo) -> {estado, codigo, achado, onde, msg}
     estado 'nao-definido'  o projeto não tem o código da placa (o "PROJETO NÃO DEFINIDO" do quadro): defina o projeto;
            'ok'            há um texto de serigrafia (Top/Bottom Overlay, à vista) com o campo =CodigoDaPlaca (a arte
                            "Código da placa + revisão", qualquer arte com o campo, a logo da 1.77 com o .CodigoDaPlaca)
                            ou com o código de agora escrito (sem caixa e sem espaço: "pmd - di261946" vale);
            'desatualizado' não há o de agora, mas há um código de placa escrito à mão que é outro (ex.: o
                            "PDMB-DI231765_P2" da DMB, de antes do Definir projeto) -- `achado` diz qual;
            'falta'         nenhum código na serigrafia.
   `codigo` é o código da placa de agora (HubCore.valorCampoArte('CodigoDaPlaca'): o do Definir projeto, ou o do nome
   do projeto, ou PROJETO NÃO DEFINIDO). Com a variante de projeto ativa vale o código da PLACA (a PCB é a mesma). */
const NAO_DEF = 'PROJETO NÃO DEFINIDO';
const RE_CAMPO_COD = /(^|[^A-Za-z0-9_])[=.]CodigoDaPlaca(?![A-Za-z0-9_])/i;
const RE_COD_PLACA = /[A-Z][A-Z0-9]*\s*-\s*DI\d{4,8}[A-Z0-9_]*/gi;
/* sem caixa; o espaço em volta do "-" não conta ("PMD - DI261946"), a quebra de linha e o espaço separam palavras */
const normCod = s => String(s || '').toUpperCase().replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
/* o código inteiro, não pedaço de outro: "PDMB-DI231765_P2" não contém o código "DMB-DI231765" */
function contemCodigo(txt, alvo) {
  for (let i = txt.indexOf(alvo); i >= 0; i = txt.indexOf(alvo, i + 1)) {
    const antes = txt.charAt(i - 1), depois = txt.charAt(i + alvo.length);
    if (!/[A-Z0-9]/.test(antes) && !/[A-Z0-9]/.test(depois)) return true;
  }
  return false;
}
function codigoNaPlaca(eb, codigo) {
  const cod = String(codigo || '').trim();
  if (!cod || normCod(cod) === normCod(NAO_DEF))
    return { estado: 'nao-definido', codigo: '', msg: 'Projeto não definido: a placa não tem código — defina o projeto (Definir projeto, no Esquema) e ponha o código da placa na serigrafia' };
  const alvo = normCod(cod);
  let outro = null, onde = '';
  for (const t of (eb && eb.texts) || []) {
    if (!t || t.hidden || t.designator || t.comment || !/Overlay$/.test(String(t.layer || ''))) continue;
    const s = String(t.text || '');
    if (RE_CAMPO_COD.test(s)) return { estado: 'ok', codigo: cod, achado: s, onde: t.owner || t.id || '', msg: '' };
    if (contemCodigo(normCod(s), alvo)) return { estado: 'ok', codigo: cod, achado: s, onde: t.owner || t.id || '', msg: '' };
    RE_COD_PLACA.lastIndex = 0;
    const m = RE_COD_PLACA.exec(s);
    if (m && !outro) { outro = m[0]; onde = t.owner || t.id || ''; }
  }
  if (outro) return { estado: 'desatualizado', codigo: cod, achado: outro, onde,
    msg: 'O código da placa na serigrafia está desatualizado: "' + outro + '" — o de agora é ' + cod + '. Ponha o código + revisão automáticos (ele muda sozinho) e tire o texto antigo' };
  return { estado: 'falta', codigo: cod, msg: 'O código da placa (' + cod + ') não está na serigrafia — toda PCB precisa ter o código' };
}

return { PADRAO, IDS_PADRAO: [...IDS_PADRAO], ehPadrao, codigoNaPlaca, lista, compila, confere, caixaDe, opColocar, proximoRef, qrRegioes,
         novoId, novaArte, duplica, camposDe, CAMPOS, LARG_MIN, ALT_MIN };
});
