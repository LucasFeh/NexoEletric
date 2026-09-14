/* Recarga de biblioteca da vista Esquema, parte PURA (schframe.js » montaAcervos/carimbo).

   O pedido era "troquei o desenho do símbolo e salvei: o resto tem que atualizar na hora".
   Quem faz isso sem F5 é o __hubRecarregaLibs: re-injeta os <script src> de Libs\ e remonta
   os acervos a partir dos globais novos. A injeção de <script> precisa de DOM e não roda
   aqui; o que roda — e é onde mora a lógica que pode errar — é a REMONTAGEM. É ela que este
   arquivo prova: a lista certa a partir de globais novos, a geometria nova chegando ao
   índice que o desenho consulta, e o acervo que não carregou sendo PRESERVADO em vez de
   sumir (sumir viraria metade da folha em quadrado vermelho).

   schframe.js em Node vale só pela parte pura: ele sai no module.exports antes de tocar em
   document/window. Se alguém puser DOM acima disso, o require abaixo morre e diz isso. */
const assert = require('assert');
const SF = require('../schframe.js');
const fs = require('fs'), path = require('path');

/* ── acervos sintéticos: pequenos e explícitos, independentes do que houver em Libs/ hoje ── */
const parte = marca => ({ part: 1, pins: [{ num: '1', name: 'A', x: -100, y: 0, len: 100, orient: 180 },
                                          { num: '2', name: 'B', x: 100, y: 0, len: 100, orient: 0 }],
                          graphics: [{ g: 'rect', x1: -100, y1: -40, x2: 100, y2: 40, w: 10, marca }] });
const schlibV1 = { format: 'schlib-v2', title: 'Biblioteca do Altium', generated: '01/01/2026 10:00:00',
                   symbols: [{ name: 'RES', description: 'resistor', parts: [parte('velha')] },
                             { name: 'CAP', description: 'capacitor', parts: [parte('velha')] }] };
/* o MESMO símbolo com outro desenho e outro carimbo de geração: é exatamente o que o editor
   de símbolos grava em Libs/schlib.js quando se troca a geometria de um componente */
const schlibV2 = { format: 'schlib-v2', title: 'Biblioteca do Altium', generated: '02/01/2026 11:22:33',
                   symbols: [{ name: 'RES', description: 'resistor', parts: [parte('nova')] },
                             { name: 'CAP', description: 'capacitor', parts: [parte('velha')] },
                             { name: 'LED', description: 'led novo', parts: [parte('nova')] }] };
const basicos = { format: 'schlib-v2', title: 'Almoxarifado — Básicos', generated: '01/01/2026 09:00:00',
                  symbols: [{ name: 'RESISTOR [SMD]', familia: 'RESISTOR', designator: 'R',
                              parts: [parte('almox')], footprints: [{ name: 'R0805', current: true, incurrentlib: true }],
                              valores: [{ id: 7, altium: 'SMD 0805 10K 1/8W', label: '10K',
                                          itens: [{ nome: 'RESISTOR SMD 0805 10K' }] },
                                        /* valor com geometria PRÓPRIA: o alias tem de usar a dele, não a da família */
                                        { id: 8, altium: 'SMD 0805 4K7 1/8W', label: '4K7', parts: [parte('doValor')] },
                                        /* xará do símbolo do Altium: não pode roubar o nome */
                                        { id: 9, altium: 'CAP', label: 'xará' }] }] };

/* ── 1. montagem normal ── */
const m1 = SF.montaAcervos({ schlib: schlibV1, almoxBasicos: basicos });
assert.deepStrictEqual(m1.acervos.map(a => a.id), ['altium', 'almox-basicos'],
  'acervo sem global (almox-especiais) simplesmente não entra na primeira montagem');
assert.strictEqual(m1.acervos[0].titulo, 'Biblioteca do Altium');
assert.strictEqual(m1.acervos[0].almox, false, 'o do Altium não é do almoxarifado');
assert.strictEqual(m1.acervos[1].almox, true);
/* SLIB = famílias + um alias por VALOR: 2 do Altium + 1 família + 2 valores (o terceiro é xará) */
assert.deepStrictEqual(m1.symbols.map(s => s.name),
  ['RES', 'CAP', 'RESISTOR [SMD]', 'SMD 0805 10K 1/8W', 'SMD 0805 4K7 1/8W'],
  'a lista que o desenho/nets/validação consultam precisa ter os alias por valor');
assert.strictEqual(m1.acervoDe.get('CAP').id, 'altium',
  'xará: o símbolo do Altium ganha do valor do almoxarifado com o mesmo nome');
assert.strictEqual(m1.valorDe.get('SMD 0805 10K 1/8W').valor.id, 7);
assert.strictEqual(m1.symbols[3].parts, basicos.symbols[0].parts,
  'o alias REAPROVEITA a geometria da família (mesma referência, sem cópia)');
assert.strictEqual(m1.symbols[4].parts[0].graphics[0].marca, 'doValor',
  'valor com parts próprio não pode ser desenhado com a geometria da família');
assert.strictEqual(m1.symbols[3].footprints[0].name, 'R0805');

/* ── 2. O PEDIDO: o símbolo foi salvo com outro desenho — remontar com o global novo tem de
      entregar a geometria nova no índice que a folha consulta, sem F5 ── */
const m2 = SF.montaAcervos({ schlib: schlibV2, almoxBasicos: basicos }, m1.acervos);
assert.strictEqual(m2.symbols.find(s => s.name === 'RES').parts[0].graphics[0].marca, 'nova',
  'depois da recarga o RES tem de vir com a geometria NOVA');
assert.ok(m2.symbols.some(s => s.name === 'LED'), 'símbolo criado no editor aparece sem recarregar a página');
assert.strictEqual(m2.acervos.filter(a => a.caiu).length, 0, 'ninguém caiu: os dois arquivos vieram');
assert.notStrictEqual(SF.carimbo(m2.acervos), SF.carimbo(m1.acervos),
  'o carimbo é o que diz ao usuário "biblioteca recarregada" em vez de "nada mudou"');
assert.strictEqual(SF.carimbo(SF.montaAcervos({ schlib: schlibV1, almoxBasicos: basicos }, m1.acervos).acervos),
  SF.carimbo(m1.acervos), 'recarga que não trouxe nada novo tem de dar carimbo IGUAL');

/* ── 3. DEGRADAÇÃO: um arquivo não veio (404, servidor caído, sync escrevendo no meio).
      O acervo velho é preservado — perder metade do acervo viraria metade da folha em
      quadrado vermelho, que é pior que mostrar a geração anterior ── */
const m3 = SF.montaAcervos({ schlib: undefined, almoxBasicos: basicos }, m2.acervos);
assert.deepStrictEqual(m3.acervos.map(a => a.id), ['altium', 'almox-basicos'], 'o acervo que caiu continua na lista');
assert.strictEqual(m3.acervos[0].caiu, true, 'quem foi preservado vem marcado (é o que o toast avisa)');
assert.strictEqual(m3.acervos[0].syms, schlibV2.symbols, 'preservado é o CONTEÚDO de antes, não uma lista vazia');
assert.ok(m3.symbols.some(s => s.name === 'RES'), 'os símbolos do acervo caído continuam resolvendo');
assert.strictEqual(m3.acervoDe.get('CAP').id, 'altium', 'o índice também sobrevive à queda');
assert.notStrictEqual(SF.carimbo(m3.acervos), SF.carimbo(m2.acervos), 'uma queda não pode passar por "nada mudou"');
/* arquivo que carregou mas veio VAZIO conta como queda: schlib sem symbols é lib pela metade */
assert.strictEqual(SF.montaAcervos({ schlib: { symbols: [] }, almoxBasicos: basicos }, m2.acervos).acervos[0].caiu, true,
  'lista vazia não substitui um acervo que estava cheio');
/* e sem nada anterior para preservar, a montagem segue com o que sobrou em vez de explodir */
const m4 = SF.montaAcervos({ almoxBasicos: basicos });
assert.deepStrictEqual(m4.acervos.map(a => a.id), ['almox-basicos']);
assert.deepStrictEqual(SF.montaAcervos().acervos, [], 'sem global nenhum: lista vazia, sem exceção');
assert.deepStrictEqual(SF.montaAcervos(null, null).symbols, []);

/* ── 4. um acervo que APARECE depois (o almox-especiais que ainda não existia) ── */
const especiais = { format: 'schlib-v2', generated: '03/01/2026 08:00:00',
                    symbols: [{ name: 'CI ESPECIAL', parts: [parte('esp')], valores: [] }] };
const m5 = SF.montaAcervos({ schlib: schlibV2, almoxBasicos: basicos, almoxEspeciais: especiais }, m2.acervos);
assert.deepStrictEqual(m5.acervos.map(a => a.id), ['altium', 'almox-basicos', 'almox-especiais']);
assert.strictEqual(m5.acervos[2].titulo, 'Almoxarifado — Especiais', 'sem title no arquivo vale o título padrão');
assert.ok(m5.symbols.some(s => s.name === 'CI ESPECIAL'));

/* ── 5. a lista de arquivos a recarregar TEM de ser a mesma dos <script src> do
      schframe.html. Elas vivem em arquivos diferentes: quem acrescentar um acervo lá e
      esquecer aqui ganha um acervo que nunca se recarrega sozinho — falha silenciosa. ── */
const html = fs.readFileSync(path.join(__dirname, '..', 'schframe.html'), 'utf8');
const noHtml = (html.match(/<script src="(Libs\/[^"]+)"/g) || []).map(m => m.replace(/.*"(.*)"/, '$1'));
assert.deepStrictEqual(SF.LIBS.map(l => l.src).slice().sort(), noHtml.slice().sort(),
  'schframe.js » LIBS e os <script src="Libs/..."> do schframe.html têm de bater');
/* e cada uma precisa dizer qual global espera, senão a recarga não sabe o que ler de volta */
for (const l of SF.LIBS) assert.ok(l.nome && typeof l.nome === 'string', 'sem nome de global: ' + l.src);
/* os três acervos apontam para globais que estão na lista de recarga */
for (const d of SF.ACERVO_DEFS)
  assert.ok(SF.LIBS.some(l => l.nome === d.nome), 'acervo ' + d.id + ' não tem arquivo na lista de recarga');

/* ── 6. contra o espelho REAL, se ele estiver aí: a montagem tem de aguentar o acervo de
      verdade (milhares de valores) e o do Altium tem de ganhar dos xarás ── */
const { loadVar } = require('./load');
let real = null;
try { real = loadVar('Libs/schlib.js', 'schlib'); } catch (e) { real = null; }
if (real && real.symbols && real.symbols.length) {
  const mr = SF.montaAcervos({ schlib: real });
  assert.strictEqual(mr.acervos[0].syms.length, real.symbols.length);
  assert.strictEqual(mr.symbols.length, real.symbols.length, 'sem almoxarifado não há alias por valor');
  assert.strictEqual(mr.acervos[0].gerado, real.generated || '', 'o carimbo sai do generated do arquivo');
  console.log('espelho real: ' + real.symbols.length + ' símbolos, gerado em ' + (real.generated || '—'));
}

/* ── O DEFEITO QUE DERRUBOU A PRIMEIRA ENTREGA ──────────────────────────────────────────
   Remontar os acervos certo NAO basta: quem desenha a folha e quem extrai as nets nao le
   SLIB.symbols direto, le por HubCore.symbolOf(SLIB, nome). E o HubCore indexa a biblioteca
   num WeakMap chaveado pela IDENTIDADE do array (hub-core.js » libIndex). Esvaziar e
   repovoar o mesmo array mantinha a identidade: os modais mostravam o simbolo novo e a folha
   continuava desenhando o velho, com os pinos velhos indo para a extracao de nets.
   Por isso aplicaAcervos TROCA SLIB.symbols por um array novo. Este teste prende as duas
   pontas: o jeito antigo tem de ficar preso ao velho, e o novo tem de ver o novo. */
{
  const C = require('../hub-core.js');
  const velho = { name: 'ZZTESTE', parts: [{ part: 1,
    pins: [{ num: '1', name: 'B', x: 200, y: 0, len: 100, orient: 180 }],
    graphics: [{ g: 'line', x1: 0, y1: 0, x2: 10, y2: 0, w: 6 }] }] };
  const novo = { name: 'ZZTESTE', parts: [{ part: 1,
    pins: [{ num: '1', name: 'B', x: -300, y: 0, len: 100, orient: 180 }],
    graphics: [{ g: 'line', x1: 0, y1: 0, x2: 10, y2: 0, w: 6 },
               { g: 'rect', x1: -50, y1: -50, x2: 50, y2: 50, w: 6 }] }] };
  const graficos = L => C.partOf(C.symbolOf(L, 'ZZTESTE'), 1).graphics.length;
  const pinoX = L => C.partOf(C.symbolOf(L, 'ZZTESTE'), 1).pins[0].x;

  // o jeito antigo (esvaziar e repovoar) NAO propaga -- e a regressao a evitar
  const antigo = { symbols: [velho] };
  assert.strictEqual(graficos(antigo), 1);
  antigo.symbols.length = 0; antigo.symbols.push(novo);
  assert.strictEqual(graficos(antigo), 1, 'se isto virar 2, o WeakMap do HubCore mudou e esta nota envelheceu');
  assert.strictEqual(pinoX(antigo), 200);

  // trocar o array propaga para o desenho E para os pinos que alimentam as nets
  const trocado = { symbols: [velho] };
  assert.strictEqual(graficos(trocado), 1);
  trocado.symbols = [novo];
  assert.strictEqual(graficos(trocado), 2, 'a geometria nova tem de chegar ao desenho da folha');
  assert.strictEqual(pinoX(trocado), -300, 'o pino novo tem de chegar a extracao de nets');
}

console.log('test-schframe-libs OK');
