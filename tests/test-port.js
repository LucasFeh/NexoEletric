/* Port do Altium e a regra "nome igual conecta".
   Fica em arquivo proprio de proposito: test-netextract.js morre na linha 10 por causa da
   fixture _DemoKit descasada do espelho real (falha PRE-EXISTENTE, nao mexida aqui), e um
   assert de port escrito la dentro nunca chegaria a rodar. */
const assert = require('assert');
const { loadVar } = require('./load');
const Core = require('../hub-core.js');

const lib = loadVar('Libs/schlib.js', 'schlib');

/* Simbolo REAL do espelho, nao da fixture: 2 pinos, pino 1 com ponta quente em (-200,0)
   relativo ao componente e pino 2 em (+200,0). Se este simbolo sumir da lib um dia, o
   teste falha dizendo isso — melhor que passar medindo nada. */
const SYM = 'DIODO TVS BIDIR [SMD]';
assert.ok(Core.symbolOf(lib, SYM), `o simbolo "${SYM}" precisa existir em Libs/schlib.js`);
const comp = (ref, x, sheet) => ({ t:'comp', sheet: sheet || 'm', ref, sym:SYM, part:1,
                                   x, y:1000, rot:0, mirror:false, footprint:'X' });
const folha = (name) => ({ t:'sheet', name: name || 'm', size:'A4' });
const sch = items => ({ format:'schmirror-v2', project:'t', units:'mil', items });

/* ---- 1. o port existe como tipo: sem isto o Salvar da vista Esquema quebrava para o
        arquivo INTEIRO, nao so para o port (serializeSchematic devolve text:null se
        houver qualquer erro) ---- */
/* style/io sao os INTEIROS CRUS do Altium (|Style=n| do .SchDoc), nao nomes: as
   constantes nomeadas foram recusadas pelo compilador do Altium. -1 = nao foi lido. */
const comPort = sch([ folha(), { t:'port', sheet:'m', net:'SDA', io:3,
                                 style:0, x:2000, y:2000, w:400 } ]);
const so = Core.serializeSchematic(comPort);
assert.strictEqual(so.errors.length, 0, 'serializeSchematic deve aceitar t:port: ' + JSON.stringify(so.errors));
assert.deepStrictEqual(new Function(so.text + ';return schematic;')(), comPort,
  'round-trip do port tem que preservar io/style/w (inteiros, nao nomes)');

/* port sem net e erro; io/style/w ausentes NAO sao (o Altium pode nao trazer todos) */
assert.ok(Core.serializeSchematic(sch([ folha(), { t:'port', sheet:'m', net:'', x:0, y:0 } ])).errors.length,
  'port sem net deve ser recusado');
assert.strictEqual(
  Core.serializeSchematic(sch([ folha(), { t:'port', sheet:'m', net:'A', x:0, y:0 } ])).errors.length, 0,
  'port sem io/style/w deve passar — sao opcionais');

/* ---- 2. o port chega ao modelo, nas duas formas de folha (a declarada e a implicita:
        buildSchModel monta o literal duas vezes) ---- */
assert.strictEqual(Core.buildSchModel(comPort).sheets[0].ports.length, 1, 'folha declarada');
assert.strictEqual(Core.buildSchModel({ items:[{ t:'port', sheet:'x', net:'A', x:0, y:0 }] }).sheets[0].ports.length, 1,
  'folha implicita tambem precisa do balde ports');

/* ---- 3. O PEDIDO: duas palavras iguais viram a mesma net, sem fio entre elas.
        D1 em x=1000 -> pino 2 quente em 1200 ; D2 em x=3000 -> pino 1 quente em 2800 */
const doisTrechos = extra => sch([ folha(), comp('D1', 1000), comp('D2', 3000),
  { t:'wire', sheet:'m', pts:[[1200,1000],[1400,1000]] },
  { t:'wire', sheet:'m', pts:[[2600,1000],[2800,1000]] },
  ...extra ]);

const rotulos = Core.extractNets(doisTrechos([
  { t:'netlabel', sheet:'m', net:'CLK', x:1400, y:1000, rot:0 },
  { t:'netlabel', sheet:'m', net:'CLK', x:2600, y:1000, rot:0 },
]), lib);
const clk = rotulos.nets.find(n => n.name === 'CLK');
assert.ok(clk, 'a net CLK tem que existir');
assert.deepStrictEqual(clk.pins.slice().sort(), ['D1-2','D2-1'],
  'dois netlabel com o mesmo nome sao UMA net, mesmo sem fio ligando');
assert.strictEqual(rotulos.warnings.length, 0, 'sem avisos: ' + rotulos.warnings.join(' | '));

/* nomes diferentes NAO podem unir — prova que a fusao e por nome, nao por acidente */
assert.strictEqual(Core.extractNets(doisTrechos([
  { t:'netlabel', sheet:'m', net:'CLK',  x:1400, y:1000, rot:0 },
  { t:'netlabel', sheet:'m', net:'MOSI', x:2600, y:1000, rot:0 },
]), lib).nets.length, 2, 'palavras diferentes continuam duas nets');

/* port e netlabel se misturam: os dois sao nomeadores */
const misto = Core.extractNets(doisTrechos([
  { t:'port',     sheet:'m', net:'SDA', x:1400, y:1000, w:400 },
  { t:'netlabel', sheet:'m', net:'SDA', x:2600, y:1000, rot:0 },
]), lib);
assert.deepStrictEqual((misto.nets.find(n => n.name === 'SDA') || {}).pins,
  ['D1-2','D2-1'], 'port e netlabel de mesmo nome sao a mesma net');

/* ---- 4. port atravessa folhas, que e para isso que o Altium tem Port ---- */
const entreFolhas = Core.extractNets(sch([
  folha('A'), folha('B'), comp('D1', 1000, 'A'), comp('D2', 3000, 'B'),
  { t:'wire', sheet:'A', pts:[[1200,1000],[1400,1000]] },
  { t:'wire', sheet:'B', pts:[[2600,1000],[2800,1000]] },
  { t:'port', sheet:'A', net:'BUS_EN', x:1400, y:1000, w:400 },
  { t:'port', sheet:'B', net:'BUS_EN', x:2600, y:1000, w:400 },
]), lib);
assert.deepStrictEqual((entreFolhas.nets.find(n => n.name === 'BUS_EN') || {}).pins,
  ['D1-2','D2-1'], 'port com o mesmo nome liga folhas diferentes');

/* ---- 5. port solta avisa, simetrico ao netlabel e ao power ---- */
assert.ok(Core.extractNets(sch([ folha(), { t:'port', sheet:'m', net:'NC', x:9000, y:9000, w:400 } ]), lib)
  .warnings.some(w => /port "NC" solta/.test(w)), 'port sem fio nem pino deve avisar');

/* ---- 6. validateSchematic cobre o port ---- */
assert.ok(Core.validateSchematic(sch([ folha(), { t:'port', sheet:'m', net:'', x:0, y:0 } ]), lib, { footprints:[] })
  .errors.some(e => /port sem "net"/.test(e)), 'port sem net e erro de validacao');

/* ---- 7. o contrato em prosa (AI-GUIDE.md) e o contrato em codigo (SCH_ITEM_REQUIRED)
        precisam listar os MESMOS tipos. Ja divergiram antes e ninguem conferia. ---- */
const fs = require('fs'), path = require('path');
const guia = fs.readFileSync(path.join(__dirname, '..', 'AI-GUIDE.md'), 'utf8');
const tabela = guia.slice(guia.indexOf('### Campos por item'), guia.indexOf('### Regras de conectividade'));
for (const t of ['sheet','comp','wire','netlabel','power','port','junction','text'])
  assert.ok(tabela.includes('| `' + t + '` |'), `AI-GUIDE: falta a linha do tipo "${t}" na tabela`);

/* ---- 8. COR da port: viaja no espelho e nao vira campo obrigatorio ----
   As tres cores sao opcionais (espelho antigo nao tem nenhuma) e passam de raspao pelo
   serializador, que grava o item inteiro. O deepStrictEqual e a prova de que uma cor
   escolhida na ficha da vista Esquema sobrevive ao Salvar. */
const comCor = sch([ folha(), { t:'port', sheet:'m', net:'SDA', io:3, style:0, x:2000, y:2000,
                                w:400, fill:'#ffff00', textColor:'#000000', color:'#0000c8' } ]);
const sc = Core.serializeSchematic(comCor);
assert.strictEqual(sc.errors.length, 0, 'port com cor deve serializar: ' + JSON.stringify(sc.errors));
assert.deepStrictEqual(new Function(sc.text + ';return schematic;')(), comCor,
  'round-trip tem que preservar fill/textColor/color da port');
assert.strictEqual(
  Core.serializeSchematic(sch([ folha(), { t:'port', sheet:'m', net:'A', x:0, y:0 } ])).errors.length, 0,
  'port SEM cor continua valida — cor e opcional, nunca obrigatoria');

/* ---- 9. MEDIDA DA FOLHA: w/h reais mandam na tabela por nome ----
   Os templates da casa usam folha custom (ISO de verdade), e o nome legado "A4" do Altium
   vale 11500x7600 — menor que a folha. Sem isto, carimbo e fios da borda caem para fora. */
const D = require('../hub-draw.js');
assert.deepStrictEqual(Core.sheetSize({ size:'A4' }), [11500, 7600],
  'sem medida, vale a tabela por nome');
assert.deepStrictEqual(Core.sheetSize({ size:'A4', w:11693, h:8268 }), [11693, 8268],
  'com medida do Altium, ela manda — mesmo com size dizendo A4');
assert.deepStrictEqual(Core.sheetSize({ size:'Nao Existe' }), [11500, 7600],
  'nome desconhecido cai em A4, nao em undefined');
const mod = Core.buildSchModel(sch([ { t:'sheet', name:'m', size:'Custom', w:11693, h:8268 },
                                     { t:'port', sheet:'m', net:'A', x:0, y:0 } ]));
assert.deepStrictEqual([mod.sheets[0].w, mod.sheets[0].h], [11693, 8268],
  'buildSchModel precisa levar w/h da folha adiante — e onde a medida morria antes');
const impl = Core.buildSchModel({ items:[{ t:'port', sheet:'x', net:'A', x:0, y:0 }] }).sheets[0];
assert.deepStrictEqual([impl.w, impl.h], [0, 0],
  'folha implicita nasce sem medida (0), com a MESMA forma da declarada');

/* ---- 10. A caixa de clique da port e o retangulo DESENHADO ----
   Ela cobria os dois lados da ancora (o dobro da largura) e 140 mil de altura. A barra
   nasce na ancora e cresce numa direcao so; caixa e desenho leem a mesma geometria. */
const pb = D.portBBox({ x:1000, y:2000, w:400 });
assert.deepStrictEqual([pb.x1, pb.x2], [1000, 1400], 'a caixa cresce SO para frente da ancora');
assert.strictEqual(pb.y2 - pb.y1, 90, 'altura da caixa = altura da barra desenhada');
const pv = D.portBBox({ x:1000, y:2000, w:400, rot:90 });
assert.deepStrictEqual([pv.y1, pv.y2], [2000, 2400], 'port em 90 graus cresce em y');
assert.strictEqual(pv.x2 - pv.x1, 90, 'e engorda so no eixo transversal');

/* ---- 8. Folha: o "A4" do Altium nao e a A4 ISO, e os templates da casa usam custom.
        O w/h medido pelo export TEM que ganhar da tabela por nome, senao componente
        legitimo aparece fora da pagina (medido: DMB vai a 11022x7710 numa folha que o
        espelho chamava de A4 = 11500x7600). ---- */
const folhaMedida = Core.buildSchModel(sch([{ t:'sheet', name:'m', size:'A4', w:11693, h:8268 }])).sheets[0];
assert.deepStrictEqual(Core.sheetSize(folhaMedida), [11693, 8268], 'w/h do Altium tem precedencia');

const folhaSemMedida = Core.buildSchModel(sch([{ t:'sheet', name:'m', size:'A3' }])).sheets[0];
assert.deepStrictEqual(Core.sheetSize(folhaSemMedida), Core.SHEET_SIZES.A3,
  'sem w/h, cai na tabela por nome');

/* medida invalida (0, negativa, texto) nao pode virar folha de tamanho zero */
for (const ruim of [{ w:0, h:0 }, { w:-5, h:100 }, { w:'11693', h:'8268' }]){
  const f = Core.buildSchModel(sch([{ t:'sheet', name:'m', size:'A4', ...ruim }])).sheets[0];
  assert.deepStrictEqual(Core.sheetSize(f), Core.SHEET_SIZES.A4,
    'medida invalida ' + JSON.stringify(ruim) + ' deve cair no fallback');
}

/* o item sheet com w/h faz round-trip */
const comFolha = sch([{ t:'sheet', name:'m', size:'A4', w:11693, h:8268 }]);
const sf = Core.serializeSchematic(comFolha);
assert.strictEqual(sf.errors.length, 0, 'sheet com w/h deve serializar: ' + JSON.stringify(sf.errors));
assert.deepStrictEqual(new Function(sf.text + ';return schematic;')(), comFolha,
  'round-trip da folha tem que preservar w/h');

/* ---- 11. FORMATO DE FOLHA: duas familias de numeros e o retrato ----
   O usuario tem projeto em A0 RETRATO e o espelho chamava tudo de "A4" (o SheetSizeName do
   ExportProject so sabe A4/A3/A2/A1/A/B/C e joga o resto no else). A partir daqui o hub sabe
   escolher formato, e quem sabe qual e a folha e a MEDIDA, nunca o nome. */

/* a tabela ISO e a ISO de verdade, e nao "uns numeros parecidos": 1 mil = 0,0254 mm */
const MM = { A0:[1189,841], A1:[841,594], A2:[594,420], A3:[420,297], A4:[297,210] };
for (const [n, [lmm, amm]] of Object.entries(MM)){
  const t = Core.SHEET_ISO[n];
  assert.ok(t, 'falta ' + n + ' na tabela ISO');
  assert.ok(Math.abs(t[0] - lmm / 0.0254) < 0.01 && Math.abs(t[1] - amm / 0.0254) < 0.01,
    n + ' ISO tem que ser ' + lmm + 'x' + amm + ' mm em mil, veio ' + t.join('x'));
}

/* as duas familias convivem e NENHUMA das duas some: o legado continua sendo o que o
   sheetSize() usa quando o espelho nao traz medida */
assert.deepStrictEqual(Core.SHEET_SIZES.A3, [15500, 11000], 'o legado do Altium nao pode mudar');
assert.deepStrictEqual(Core.sheetSize({ size:'A3' }), [15500, 11000],
  'espelho antigo (sem w/h) tem que desenhar como desenhava: fallback e o LEGADO, nao o ISO');
assert.deepStrictEqual(Core.sheetSize({ size:'A0' }), [44000, 31000],
  'idem para A0 — a tabela nova nao pode vazar para o fallback');
assert.deepStrictEqual(Core.sheetSize({ size:'A3', w:16535.433, h:11692.913 }), [16535.433, 11692.913],
  'com medida, ela manda — a regra de precedencia nao mudou');

/* escolha NOVA de formato: por nome ganha o ISO (e o que a casa usa); o legado continua
   alcancavel pelo id, que e o unico jeito de pedir "o A3 do Altium" e nao o A3 de verdade */
assert.deepStrictEqual(Core.sheetPreset('A3'), Core.SHEET_ISO.A3, 'sheetPreset por nome = ISO');
assert.deepStrictEqual(Core.sheetPreset('iso:A3'), Core.SHEET_ISO.A3, 'id iso: = ISO');
assert.deepStrictEqual(Core.sheetPreset('leg:A3'), [15500, 11000], 'id leg: = legado do Altium');
assert.deepStrictEqual(Core.sheetPreset('A', false), [9500, 7500], 'A/B/C/D/E so existem no legado');
assert.strictEqual(Core.sheetPreset('Z9'), null, 'formato que nao existe devolve null, nao A4 calado');

/* RETRATO E SO w/h TROCADOS — nao ha campo novo no espelho, e e assim que ele atravessa os
   dois .pas sem que nenhum deles precise aprender orientacao */
assert.deepStrictEqual(Core.sheetPreset('A0', true), [Core.SHEET_ISO.A0[1], Core.SHEET_ISO.A0[0]],
  'A0 em pe = A0 deitado com largura e altura trocadas');
assert.ok(Core.sheetPreset('A0', true)[1] > Core.sheetPreset('A0', true)[0],
  'em pe quer dizer mais alto que largo');
assert.notDeepStrictEqual(Core.sheetPreset('A0', true), Core.sheetPreset('A0', false),
  'em pe e deitado nao podem ser a mesma medida');
/* e o preset nao pode ser um alias da tabela: girar duas vezes nao pode ter virado a tabela */
Core.sheetPreset('A0', true);
assert.deepStrictEqual(Core.SHEET_ISO.A0, [46811.024, 33110.236], 'sheetPreset nao pode mexer na tabela');

/* RECONHECER A FOLHA PELA MEDIDA — o antidoto para o nome mentiroso.
   Numeros medidos nos projetos do usuario (o `size` dos dois diz "A4"). */
assert.deepStrictEqual(Core.sheetMatch({ size:'A4', w:16535.433, h:11692.913 }),
  { id:'iso:A3', name:'A3', fam:'iso', retrato:false },
  'PRJ-UR-DI261924 mede A3 ISO, por mais que o espelho o chame de A4');
assert.deepStrictEqual(Core.sheetMatch({ size:'A4', w:11692.913, h:8267.717 }),
  { id:'iso:A4', name:'A4', fam:'iso', retrato:false }, 'PRJ - DI261930 mede A4 ISO');
assert.deepStrictEqual(Core.sheetMatch({ size:'A4', w:33110.236, h:46811.024 }),
  { id:'iso:A0', name:'A0', fam:'iso', retrato:true }, 'A0 em pe tem que ser reconhecida como A0 em pe');
/* medida arredondada em inteiro (espelho antigo escrevia assim) ainda casa: a tolerancia e 1 mil */
assert.strictEqual((Core.sheetMatch({ w:11693, h:8268 }) || {}).id, 'iso:A4',
  'medida arredondada em inteiro tem que continuar sendo A4 ISO');
/* sem medida nenhuma, quem responde e o fallback legado — e o match diz isso, em vez de mentir ISO */
assert.deepStrictEqual(Core.sheetMatch({ size:'A4' }),
  { id:'leg:A4', name:'A4', fam:'legado', retrato:false },
  'sem w/h a folha E a legada: o match tem que dizer legado');
assert.strictEqual(Core.sheetMatch({ size:'A4', w:11022, h:7710 }), null,
  'medida que nao e de formato nenhum e Custom (null), nao o formato mais parecido');

/* rotulo curto: e o que o cartao da folha e a ficha mostram */
assert.strictEqual(Core.sheetLabel({ size:'A4', w:16535.433, h:11692.913 }), 'A3');
assert.strictEqual(Core.sheetLabel({ size:'A4', w:33110.236, h:46811.024 }), 'A0 em pé');
assert.strictEqual(Core.sheetLabel({ size:'A4' }), 'A4 legado');
assert.strictEqual(Core.sheetLabel({ size:'A4', w:11022, h:7710 }), 'Custom');

/* DOIS FORMATOS NUNCA PODEM CASAR COM A MESMA MEDIDA, senao o sheetMatch (que devolve o
   primeiro) escolheria por ordem de tabela. Confere todos contra todos, nas duas orientacoes. */
const todas = [];
for (const p of Core.SHEET_PRESETS)
  for (const r of [false, true]) todas.push([p.id + (r ? ' em pe' : ''), Core.sheetPreset(p.id, r)]);
let menor = [Infinity, ''];
for (let i = 0; i < todas.length; i++)
  for (let j = i + 1; j < todas.length; j++){
    const d = Math.max(Math.abs(todas[i][1][0] - todas[j][1][0]),
                       Math.abs(todas[i][1][1] - todas[j][1][1]));
    if (d < menor[0]) menor = [d, todas[i][0] + ' x ' + todas[j][0]];
  }
/* medido: o par mais proximo e iso:A4 x leg:A4, a 667,7 mil (17 mm). A folga de 10x sobre a
   tolerancia e o que sustenta o comentario do SHEET_TOL no hub-core. */
assert.ok(menor[0] > Core.SHEET_TOL * 10,
  'dois formatos quase colidem (' + menor[1] + ', ' + menor[0].toFixed(1) + ' mil): a tolerancia '
  + 'de ' + Core.SHEET_TOL + ' mil do sheetMatch deixaria a escolha depender da ordem da tabela');

/* O CAMINHO INTEIRO: escolher A0 em pe grava size+w/h, sobrevive ao Salvar e volta igual —
   e o modelo leva a medida adiante (e ali que ela morria antes). */
const a0 = Core.sheetPreset('A0', true);
const escolhida = sch([ { t:'sheet', name:'m', size:'A0', w:a0[0], h:a0[1] }, comp('R1', 2000) ]);
const sa0 = Core.serializeSchematic(escolhida);
assert.strictEqual(sa0.errors.length, 0, 'folha A0 em pe deve serializar: ' + JSON.stringify(sa0.errors));
assert.deepStrictEqual(new Function(sa0.text + ';return schematic;')(), escolhida,
  'round-trip de A0 em pe tem que preservar size e w/h, casas decimais inclusive');
const mA0 = Core.buildSchModel(escolhida).sheets[0];
assert.deepStrictEqual(Core.sheetSize(mA0), a0, 'o modelo tem que levar a medida escolhida adiante');
assert.strictEqual(Core.sheetLabel(mA0), 'A0 em pé', 'e o rotulo dela e A0 em pe');

console.log('test-port OK');
