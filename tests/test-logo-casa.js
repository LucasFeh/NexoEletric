/* A logo DiEletrons na PCB (hub-core.js » LOGO_DIELETRONS, setParamsProjeto, resolveEspeciais; hub-gerber.js » geometriaTexto).

   node tests/test-logo-casa.js

   Pedido do dono (2026-11-05): o botão "Logo DiEletrons" do Definir projeto põe na placa a logo da casa com o código da
   placa e a revisão, os dois automáticos. A logo é um footprint embutido (o LOGOTIPO_P_SILK das placas da casa) com dois
   textos ".CodigoDaPlaca" e ".Revisao", que a placa resolve com os parâmetros do projeto — na tela e no Gerber. */
const assert = require('assert');
const H = require('../hub-core.js');
const G = require('../hub-gerber.js');

let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

const placa = () => ({ format:'pcbmirror-v1', components:[], tracks:[], arcs:[], vias:[], texts:[], silk:[], regions:[], fills:[],
                       board:{ outline:[] } });

/* ── 1. as strings especiais ── */
H.setParamsProjeto('CodigoDaPlaca=PBIDP-DI261944;Revisao=REV.B', 'qualquer');
eq([H.resolveEspeciais('.CodigoDaPlaca'), H.resolveEspeciais('.Revisao'), H.resolveEspeciais('.revisao')], ['PBIDP-DI261944', 'REV.B', 'REV.B'],
   'o código e a revisão do projeto (sem caixa, como o Altium)');
eq(H.resolveEspeciais('3.3V'), '3.3V', 'número com ponto não é string especial');
eq(H.resolveEspeciais('.Nada'), '.Nada', 'o que não resolve fica como está');
H.setParamsProjeto('', 'PDCD-DI261939 (PTYPE)');
eq(H.resolveEspeciais('.CodigoDaPlaca'), 'PDCD-DI261939', 'sem Definir projeto: o código do nome do projeto');
H.setParamsProjeto('Desenho_linha_unica=PVELHO-DI250001', 'X');
eq(H.resolveEspeciais('.CodigoDaPlaca'), 'PVELHO-DI250001', 'o nome antigo do carimbo também vale');

/* ── 2. a logo pelo comp_add: os traços, os dois textos, e o giro do componente ── */
H.setParamsProjeto('CodigoDaPlaca=PAEL-DI261940;Revisao=REV.C', 'X');
for (const rot of [0, 90]) {
  const B = placa();
  const m = H.applyPcbChanges(B, [{ op:'comp_add', ref:'LOGO1', footprint:H.LOGO_FP, x:10, y:20, rot, layer:'Top', des_hidden:true }]);
  eq(m.validation.filter(v => v.level === 'err'), [], 'a logo entra sem erro (rot ' + rot + ')');
  const eb = H.effectiveBoard(B, m);
  eq(eb.silk.filter(s => s.owner === 'LOGO1').length, 47, 'os 47 traços do LOGOTIPO_P_SILK');
  const tx = eb.texts.filter(t => t.owner === 'LOGO1' && !t.designator);
  eq(tx.map(t => t.text), ['.CodigoDaPlaca', '.Revisao'], 'os textos guardam a string especial (a placa não muda quando a revisão muda)');
  ok(tx.every(t => t.rot === rot && t.layer === 'TopOverlay'), 'os textos giram com o componente');
  ok(eb.texts.some(t => t.designator && t.owner === 'LOGO1' && t.hidden), 'o designator escondido');
  /* o Gerber (e a tela, que desenha a geometria dele) escreve o texto resolvido, sem o aviso de string crua */
  const avisos = [];
  const av = { add: (k) => avisos.push(k) };
  const g = G.geometriaTexto(tx[1], av);
  ok(g && (g.tracos || g.regioes), 'a geometria do texto sai');
  ok(!avisos.includes('texto-especial'), 'sem string especial crua: ' + avisos.join(','));
}
/* a mesma op com a revisão nova: o texto acompanha */
H.setParamsProjeto('Revisao=', 'X');
{
  const B = placa();
  const m = H.applyPcbChanges(B, [{ op:'comp_add', ref:'LOGO1', footprint:H.LOGO_FP, x:0, y:0 }]);
  const t = H.effectiveBoard(B, m).texts.find(x => x.text === '.Revisao');
  const avisos = [];
  G.geometriaTexto(t, { add: k => avisos.push(k) });
  ok(avisos.includes('texto-especial'), 'sem revisão no projeto, o Gerber avisa que a string ficou crua');
}

console.log('test-logo-casa: ' + n + ' verificações ok');
