/* Componentes fora do esquema na lista do Odoo — as partes puras da tela.
 *
 *     node tests/test-lista-extras.js
 *
 * O servidor (odoolista.py) resolve o extra pela MESMA cascata do componente do esquema, mas
 * isso so vale se a tela gravar o extra com a MESMA identidade que o "Adicionar componentes"
 * gravaria na folha. Aqui se prova a funcao que as duas coisas usam
 * (schframe.js » identidadeDoComponente, e identidadeDoEscolhido/identidadeDoValor, que tiram
 * a identidade do VALOR clicado e nao do nome) e as duas contas da tela (hub-odoolista.js »
 * qtdDoCampo, totalDaLista). O seletor, o modal e o POST sao DOM: o navegador prova.
 */
'use strict';
const assert = require('assert');

const SF = require('../schframe.js');

/* o modulo da lista se auto-inicia no DOMContentLoaded; com readyState 'loading' ele so
   registra o listener — e o que deixa carrega-lo fora do navegador */
global.document = { readyState: 'loading', addEventListener() {} };
global.window = global;
const { pure } = require('../hub-odoolista.js');

/* ── 1. a identidade do componente escolhido ──────────────────────────────────── */
const id = SF.identidadeDoComponente;
assert.strictEqual(typeof id, 'function', 'identidadeDoComponente tem de sair no PURE');

let r = id(null, 'NAO EXISTE');
assert.ok(!r.ok && /quadrado vermelho/.test(r.porque), r.porque);

/* FAMILIA nao e componente: sem valor unico nao ha OdooId nem comment que preste */
const familia = { name: 'RESISTOR', valores: [{ id: 1 }, { id: 2 }, { id: 3 }] };
r = id({ item: familia, name: 'RESISTOR', how: 'exato' }, 'RESISTOR');
assert.ok(!r.ok && /FAMILIA/.test(r.porque), 'familia tinha de ser recusada: ' + r.porque);

const v10k = { id: 43, label: '10K "1%"', footprint: 'R0805',
               params: [{ n: 'Comment', v: '10K' }, { n: 'Value', v: '10K' }, { n: 'MPN', v: '' },
                        { n: 'OdooId', v: '1891' }, { n: 'Descricao', v: 'a;b=c|d' }] };
const alias = { name: 'SMD 0805 10K 1/8W', valores: [v10k], deValor: true,
                footprints: [{ name: 'R0805', current: true, incurrentlib: true }] };
r = id({ item: alias, name: alias.name, how: 'exato' }, alias.name);
assert.ok(r.ok, r.porque);
assert.strictEqual(r.sym, 'SMD 0805 10K 1/8W');
assert.strictEqual(r.comment, "10K '1%'", 'aspas duplas viram simples, como no cartAdd');
assert.strictEqual(r.params, SF.paramsDoValor(v10k), 'o params e o do paramsDoValor, e so ele');
assert.strictEqual(r.params, 'Comment=10K;Value=10K;OdooId=1891;Descricao=a,b,c,d;ValorId=43',
                   'o formato plano K=V;K=V, sem os vazios e com ValorId no fim: ' + r.params);
assert.strictEqual(r.footprint, 'R0805', 'o footprint do VALOR vem primeiro');
assert.strictEqual(r.valor, v10k);
console.log('(1) valor do almoxarifado: sym, comment, params e footprint como o Adicionar grava ok');

/* o lib-subs.js pode mandar o nome para outro componente: grava-se o nome resolvido, como o
   __hubAplicaVinculos grava (res.name), e nao o clicado */
r = id({ item: alias, name: 'OUTRO NOME', how: 'escolha' }, alias.name);
assert.strictEqual(r.sym, 'OUTRO NOME');

/* sem footprint no valor, o do simbolo: o marcado como atual, senao o primeiro */
const semFp = Object.assign({}, v10k, { footprint: '' });
const aliasSemFp = { name: 'X', valores: [semFp],
                     footprints: [{ name: 'A' }, { name: 'B', current: true }] };
assert.strictEqual(id({ item: aliasSemFp, name: 'X' }, 'X').footprint, 'B');
assert.strictEqual(id({ item: { name: 'Y', valores: [semFp], footprints: [{ name: 'A' }] }, name: 'Y' }, 'Y')
                   .footprint, 'A');
assert.strictEqual(id({ item: { name: 'Z', valores: [semFp] }, name: 'Z' }, 'Z').footprint, '');
/* e o seletor do Adicionar abre no mesmo footprint (renderAddPreview usa a mesma funcao) */
assert.deepStrictEqual(SF.modelosDeFootprint({ footprints: [{ name: 'R0805' }, { name: 'R1206' }] }, v10k)
                         .map(m => m.name), ['R0805', 'R1206'], 'o do valor na frente, sem repetir');
console.log('(2) footprint padrao: valor, depois o atual do simbolo, depois o primeiro ok');

/* a sequencia aspas-dois-pontos derruba a gravacao do schematic.js inteiro */
const quebra = Object.assign({}, v10k, { params: [{ n: 'Nota', v: 'x":y' }] });
r = id({ item: { name: 'Q', valores: [quebra] }, name: 'Q' }, 'Q');
assert.ok(!r.ok && /gravador/.test(r.porque), r.porque);
console.log('(3) familia, nome inexistente e texto que quebra o gravador sao recusados ok');

/* ── 1b. o VALOR clicado manda, e nao o nome ─────────────────────────────────────
   O seletor so escolhe devolvia a identidade pelo NOME do valor, e o nome nao identifica o
   valor. Medido nos 2545 valores reais: dois "Cartão Micro SD" em familias diferentes
   (OdooId 910 e 149) — escolher o soquete gravava o OdooId do outro —, e nove valores (BC807,
   TL431, 78L05...) com o nome de um simbolo da biblioteca da casa, que vence o alias e nao
   tem `valores`: pelo nome eles eram recusados como "FAMILIA". */
const HubCore = require('../hub-core.js');
HubCore.setLibTables({}, []);
const valor = (id, altium, odoo, extra) => Object.assign({ id, altium, label: altium,
  params: [{ n: 'Comment', v: altium }, { n: 'OdooId', v: String(odoo) }] }, extra || {});
const sdA = valor(20, 'Cartão Micro SD', 910, { mpn: 'DM3CS-SF' });
const sdB = valor(80, 'Cartão Micro SD', 149, { mpn: 'MEM2075-00-140-01-A' });
const bc = valor(7, 'BC807', 555, { footprint: 'SOT23' });
const famA = { name: 'CONECTOR CARTAO SD', familia: 'CONECTOR CARTAO SD', valores: [sdA], parts: [] };
const famB = { name: 'CONECTOR SOQUETE', familia: 'CONECTOR SOQUETE', valores: [sdB], parts: [] };
const famT = { name: 'TRANSISTOR', familia: 'TRANSISTOR', valores: [bc], parts: [],
               footprints: [{ name: 'TO92', current: true }] };
const casaBC = { name: 'BC807', parts: [{ part: 1, pins: [], graphics: [] }] };   /* lib da casa */
const m = SF.montaAcervos({ schlib: { symbols: [casaBC] },
                            almoxBasicos: { symbols: [famA, famB, famT] } });
const SLIB = { symbols: m.symbols };
const resolve = n => HubCore.resolveSym(SLIB, n);
/* o candidato como o seletor o monta ao clicar (schframe.js » candidatoDoValor(nome, it)) */
const cand = (v, fam) => ({ name: v.altium, item: HubCore.symbolOf(SLIB, v.altium), valor: v, familia: fam });
const esc = SF.identidadeDoEscolhido;
assert.strictEqual(typeof esc, 'function', 'identidadeDoEscolhido tem de sair no PURE');

/* o defeito, documentado: pelo nome, os dois xaras viram o PRIMEIRO */
assert.ok(/OdooId=910/.test(esc({ name: sdB.altium }, resolve).params), 'pelo nome e sempre o primeiro xara');
r = esc(cand(sdB, famB), resolve);
assert.ok(r.ok, r.porque);
assert.ok(/OdooId=149/.test(r.params) && /ValorId=80/.test(r.params),
          'escolhi o soquete e veio outra peca: ' + r.params);
assert.strictEqual(r.params, SF.paramsDoValor(sdB), 'o params e o do valor clicado, como no cartAdd');
assert.strictEqual(r.sym, 'Cartão Micro SD', 'sym = v.altium, como o cartAdd grava');
assert.ok(/OdooId=910/.test(esc(cand(sdA, famA), resolve).params));
console.log('(1b) dois valores de mesmo nome: vem o OdooId do CLICADO ok');

/* nome que e tambem de um simbolo da casa: pelo nome, recusado como familia; pelo valor, entra */
assert.ok(!esc({ name: 'BC807' }, resolve).ok, 'pelo nome o BC807 da casa vence e nao tem valor');
r = esc(cand(bc, famT), resolve);
assert.ok(r.ok, 'o BC807 do almoxarifado tinha de entrar: ' + r.porque);
assert.strictEqual(r.sym, 'BC807');
assert.ok(/OdooId=555/.test(r.params), r.params);
assert.strictEqual(r.footprint, 'SOT23', 'o footprint do valor primeiro');
assert.strictEqual(SF.identidadeDoValor(Object.assign({}, bc, { footprint: '' }), famT).footprint, 'TO92',
                   'sem footprint no valor, o da familia');
/* sem footprint no valor nem na familia: VAZIO — e o que o "Adicionar componentes" passou a
   mostrar como padrao ("— sem footprint —"), em vez da primeira da PcbLib (o diodo "M7") */
assert.strictEqual(SF.identidadeDoValor(sdB, famB).footprint, '');
assert.strictEqual(SF.footprintPadrao(famB, sdB), '');
console.log('(1c) nome da biblioteca da casa entra pelo valor; footprint vazio e vazio ok');

/* ── 2. a quantidade digitada ─────────────────────────────────────────────────── */
const q = pure.qtdDoCampo;
for (const [v, esperado] of [['1', 1], ['4', 4], [' 12 ', 12], ['100000', 100000], [7, 7]])
  assert.strictEqual(q(v), esperado, JSON.stringify(v));
for (const v of ['', '0', '-3', '1.5', '1e3', '100001', 'abc', null, undefined, '  '])
  assert.strictEqual(q(v), null, 'aceitou ' + JSON.stringify(v));
console.log('(4) quantidade: inteiro de 1 a 100000, e mais nada ok');

/* ── 3. o total conta os extras ───────────────────────────────────────────────── */
const t = pure.totalDaLista;
assert.strictEqual(t(null), '');
assert.strictEqual(t({ linhas: [] }), '');
assert.strictEqual(t({ linhas: [{ quantidade: 2 }, { quantidade: 1 }] }), '2 linha(s) · 3 peça(s)');
assert.strictEqual(t({ linhas: [{ quantidade: 2 }, { quantidade: 4, _extra: 1 }, { quantidade: 1, _extra: 3 }] }),
                   '3 linha(s) · 7 peça(s) · 2 fora do esquema');
console.log('(5) o total conta os extras e diz quantos sao ok');
/* as linhas do esquema TIRADAS da lista (2026-09-30): fora da conta, porque nao vao, e ditas */
assert.strictEqual(t({ linhas: [{ quantidade: 2 }], _tirados: [{ quantidade: 3 }, { quantidade: 1 }] }),
                   '1 linha(s) · 2 peça(s) · 2 tiradas da lista');
assert.strictEqual(t({ linhas: [{ quantidade: 2 }], _tirados: [{ quantidade: 3 }] }),
                   '1 linha(s) · 2 peça(s) · 1 tirada da lista');
assert.strictEqual(t({ linhas: [], _tirados: [{ quantidade: 3 }] }), '0 linha(s) · 0 peça(s) · 1 tirada da lista',
                   'tudo tirado ainda diz o que ficou de fora');
console.log('(5b) o total diz as tiradas da lista, fora da conta ok');

/* ── 4. as setas do campo de quantidade (texto, nao type=number) ───────────────── */
const passo = pure.passoQtd;
assert.strictEqual(passo('10', 1, 10), 11);
assert.strictEqual(passo('10', -1, 10), 9);
assert.strictEqual(passo('1', -1, 10), 1, 'nao desce de 1');
assert.strictEqual(passo('100000', 1, 10), 100000, 'nao passa do teto');
assert.strictEqual(passo('', 1, 7), 8, 'campo vazio conta a partir da gravada');
assert.strictEqual(passo('abc', -1, 7), 6);
assert.strictEqual(passo('abc', 1, null), 2, 'sem gravada, a partir de 1');
console.log('(6) setas: um passo, entre 1 e 100000, a partir da gravada quando o campo nao presta ok');

/* ── 5. o extra que repete a peca de outra linha ────────────────────────────────── */
const rep = pure.repeticoes;
const lR = { designadores: 'R1, R2', product_id: 1891, quantidade: 2 };
const lE3 = { designadores: 'EXTRA 3', product_id: 1891, quantidade: 5, _extra: 3 };
const lE4 = { designadores: 'EXTRA 4', product_id: 1891, quantidade: 1, _extra: 4 };
const lE5 = { designadores: 'EXTRA 5', product_id: 42, quantidade: 1, _extra: 5 };
const lE6 = { designadores: 'EXTRA 6', quantidade: 1, _extra: 6, mpn: 'X' };      /* sem produto */
const r1 = rep([lR, lE3, lE4, lE5, lE6]);
assert.deepStrictEqual(r1.get(lE3), ['R1, R2', 'EXTRA 4']);
assert.deepStrictEqual(r1.get(lE4), ['R1, R2', 'EXTRA 3']);
assert.ok(!r1.has(lE5), 'produto unico nao e repeticao');
assert.ok(!r1.has(lE6), 'sem product_id nao da para afirmar que e a mesma peca');
assert.ok(!r1.has(lR), 'a linha do esquema nao leva a marca: quem repete e o extra');
assert.strictEqual(rep(null).size, 0);
console.log('(7) extra da mesma peca de outra linha: marcado, e so pelo product_id ok');

/* ── 6. a peca de hoje, o reachado e o vinculo: pela IDENTIDADE, nunca pelo nome ─────
   Os grupos como o hub-almoxpick os monta: { familia, valores:[{ nome, v, sym }] }. */
const grupos = [{ familia: famA.familia, valores: [{ nome: sdA.altium, v: sdA, sym: famA }] },
                { familia: famB.familia, valores: [{ nome: sdB.altium, v: sdB, sym: famB }] }];
/* o params gravado ontem, com o saldo de ontem: o de hoje ja e outro. A comparacao da string
   inteira errava aqui e o seletor voltava ao xara pelo nome (o conector) */
const ontem = SF.paramsDoValor(Object.assign({}, sdB, { params: sdB.params.concat([{ n: 'Estoque', v: '1' }]) }));
assert.notStrictEqual(ontem, SF.paramsDoValor(sdB));
let h = SF.pecaDeHoje(grupos, ontem, sdB.altium);
assert.ok(h && h.item.v === sdB, 'a peca de hoje e o soquete, mesmo com o estoque mudado');
assert.strictEqual(SF.pecaDeHoje(grupos, 'OdooId=910 911', sdA.altium).item.v, sdA, 'OdooId com dois produtos');
/* sem OdooId, o ValorId — que numera por SIMBOLO: so entre os de mesmo nome, e so se sobrar um */
assert.strictEqual(SF.pecaDeHoje(grupos, 'ValorId=80', sdB.altium).item.v, sdB);
assert.strictEqual(SF.pecaDeHoje(grupos, 'ValorId=80', 'OUTRO NOME'), null);
const gEmpate = grupos.concat([{ familia: 'X', valores: [{ nome: sdB.altium, v: Object.assign({}, sdA, { id: 80, params: [] }), sym: famA }] }]);
assert.strictEqual(SF.pecaDeHoje(gEmpate, 'ValorId=80', sdB.altium), null, 'ValorId repetido nao escolhe');
assert.strictEqual(SF.pecaDeHoje(grupos, '', sdB.altium), null, 'sem params, quem chama cai no nome');
assert.deepStrictEqual(SF.idsDoParams('A=1;OdooId=1891 1892;ValorId=43'), { odoo: ['1891', '1892'], valorId: '43' });

/* depois de recarregar a biblioteca os objetos mudam: reacha pelo simbolo + id; sumiu, null */
const novos = [{ familia: famA.familia, valores: [{ nome: sdA.altium, v: Object.assign({}, sdA), sym: famA }] },
               { familia: famB.familia, valores: [{ nome: sdB.altium, v: Object.assign({}, sdB), sym: famB }] }];
assert.strictEqual(SF.reachaValor(novos, sdB.altium, sdB, famB.name), novos[1].valores[0]);
assert.strictEqual(SF.reachaValor([novos[0]], sdB.altium, sdB, famB.name), null,
                   'o soquete sumiu: nao volta como o conector de mesmo nome');
const mesmoId = [{ familia: 'Y', valores: [{ nome: sdB.altium, v: Object.assign({}, sdA, { id: 80 }), sym: famA }] }].concat(novos);
assert.strictEqual(SF.reachaValor(mesmoId, sdB.altium, sdB, famB.name), novos[1].valores[0],
                   'id 80 nos dois simbolos: vale o do simbolo escolhido');

/* o vinculo ("Trocar componente", "resolver" da lista do Odoo): com o valor, a peca clicada */
r = SF.identidadeDoVinculo({ componente: sdB.altium, valor: sdB, familia: famB }, resolve);
assert.ok(r.ok && /OdooId=149/.test(r.params), r.params);
assert.ok(/OdooId=910/.test(SF.identidadeDoVinculo({ componente: sdB.altium }, resolve).params),
          'so com o nome (o painel da BoM) continua como era');
assert.ok(SF.identidadeDoVinculo({ componente: 'BC807', valor: bc, familia: famT }, resolve).ok,
          'o BC807 do almoxarifado entra pelo valor');
console.log('(8) peca de hoje pelo OdooId, reachado pelo simbolo+id, vinculo pelo valor clicado ok');

/* ── 7. a recomendacao do seletor e o "ja e esse componente" ─────────────────────── */
const porNomeA = { grupo: grupos[0], item: grupos[0].valores[0], por: sdA.altium };   /* o 1o xara */
let rec = SF.recomendacaoDe(grupos, { sym: sdB.altium, params: ontem }, porNomeA);
assert.ok(rec.item.v === sdB && rec.rotulo === '↩ a peça de hoje' && rec.seleciona !== false, 'a peca de hoje vence o nome');
/* a peca do params sumiu do almoxarifado e o nome tem xara: aponta, mas NAO escolhe */
rec = SF.recomendacaoDe(grupos, { sym: sdB.altium, params: 'OdooId=99999;ValorId=999' }, porNomeA);
assert.ok(rec && rec.seleciona === false, 'escolheu o xara de uma peca que sumiu');
/* nome sem xara: continua escolhido, como sempre */
const gUnico = [grupos[0]];
rec = SF.recomendacaoDe(gUnico, { sym: sdA.altium, params: 'OdooId=99999' }, porNomeA);
assert.ok(rec && rec.seleciona !== false);
assert.strictEqual(SF.recomendacaoDe(grupos, { sym: sdA.altium }, porNomeA), porNomeA, 'sem params: pelo nome');
assert.strictEqual(SF.recomendacaoDe(grupos, { sym: 'X' }, null), null);

const mp = SF.mesmaPecaDaFolha;
assert.ok(mp(grupos, { sym: sdB.altium, params: ontem }, sdB.altium, sdB), 'a mesma peca com o saldo de ontem e a mesma');
assert.ok(!mp(grupos, { sym: sdB.altium, params: ontem }, sdB.altium, sdA), 'o xara nao e a mesma peca');
assert.ok(!mp(grupos, { sym: sdB.altium, params: '' }, sdB.altium, sdB), 'sem params: o clique grava a identidade');
assert.ok(mp(grupos, { sym: 'R' }, 'R', null), 'so pelo nome: nome igual e o mesmo, como sempre');
assert.ok(!mp(grupos, { sym: 'R' }, 'S', null));
console.log('(9) recomendacao: peca de hoje, xara so apontado; "ja e esse" pela identidade ok');

console.log('test-lista-extras OK (identidade igual a do Adicionar, familia recusada, quantidade, total, setas, repeticao, xaras)');
