/* A parte pura da tela de vínculo (hub-odoobom.js), rodando em Node.
 *
 *     node tests/test-odoobom.js
 *
 * O que este arquivo existe para impedir, em ordem de importância:
 *
 *  1. SUGESTÃO INCERTA NASCER MARCADA. "Kk 4 vias Fêmea" e "Kk 4 vias macho" pontuam igual
 *     contra o mesmo grupo — o comment da folha não diz o gênero — e desempatar por ordem
 *     escolheu a fêmea, que era a errada. O servidor marca essas como `confianca:'mao'`, e
 *     aqui se prende que `mao` NUNCA vem com o visto.
 *  2. TROCAR O SÍMBOLO DE UM MULTI-PARTE. Todo alias de valor do almoxarifado tem uma parte
 *     só; o CN1 do projeto medido é um conector desenhado em 16. Trocar o `sym` largaria 15
 *     partes e a fiação junto — então o plano desses tem de sair com `sym` nenhum e
 *     `soParams: true`.
 *  3. O RESUMO MENTIR sobre o que o botão vai fazer. Ele é a última coisa que a pessoa lê
 *     antes de aplicar.
 */
const assert = require('assert');
const { pure } = require('../hub-odoobom.js');

const g1 = { id:'G1', refs:['C4','C6'], multiparte:false, partes:1, sym:'CAP [  SMD  ]' };
const gMulti = { id:'G2', refs:['CN1'], multiparte:true, partes:16, sym:'CONECTOR PADRÃO' };
const gDois = { id:'G3', refs:['CN2'], multiparte:true, partes:6, sym:'CONECTOR PADRÃO' };

const sAlta = { product_id:116, componente:'SMD 0805 0.1uF / 100nF 16V', grupo:'G1', confianca:'alta' };
const sMedia = { product_id:1428, componente:'Latch 16 vias (2x8) passo 2.54mm 180º', grupo:'G2', confianca:'media' };
const sMao1 = { product_id:2512, componente:'Kk 4 vias Fêmea', grupo:'G4', confianca:'mao' };
const sMao2 = { product_id:1432, componente:'Kk 4 vias macho', grupo:'G4', confianca:'mao' };

/* ── (1) o que nasce marcado ───────────────────────────────────────────────── */
const m = pure.marcadasDeSaida([sAlta, sMedia, sMao1, sMao2]);
assert.strictEqual(m[116], true, 'alta nasce marcada');
assert.strictEqual(m[1428], true, 'media nasce marcada');
assert.strictEqual(m[2512], false, 'MÃO NUNCA nasce marcada — é a regra que segura o zero vínculo errado');
assert.strictEqual(m[1432], false);
assert.deepStrictEqual(pure.marcadasDeSaida(null), {}, 'sem sugestão, nada marcado');
assert.deepStrictEqual(pure.marcadasDeSaida([]), {});
console.log('(1) alta e média nascem marcadas; as duas do par empatado nascem em branco');

/* ── (2) o plano de um componente de UMA parte ─────────────────────────────── */
const p1 = pure.planoDoVinculo(sAlta, g1);
assert.deepStrictEqual(p1.refs, ['C4','C6'], 'o plano vale para TODOS os refs do grupo');
assert.strictEqual(p1.componente, 'SMD 0805 0.1uF / 100nF 16V');
assert.strictEqual(p1.soParams, false, 'uma parte: troca o símbolo');
assert.ok(/trocado/.test(p1.efeito), p1.efeito);
/* o plano NÃO carrega sym/comment/params: quem os resolve é a ponte, no espelho da vista,
   pela mesma função que o modal "Adicionar componentes" usa */
assert.strictEqual(p1.sym, undefined, 'o plano não decide o sym — a vista decide');
assert.strictEqual(p1.params, undefined, 'nem o params: uma segunda implementação do formato é o bug');
/* mexer no plano não pode mexer no grupo */
p1.refs.push('XX');
assert.deepStrictEqual(g1.refs, ['C4','C6'], 'o plano leva uma CÓPIA dos refs');
console.log('(2) plano de uma parte: troca o símbolo e não decide o params');

/* ── (3) o plano de um MULTI-PARTE ─────────────────────────────────────────── */
for (const [s, g, n] of [[sMedia, gMulti, 16], [sMedia, gDois, 6]]){
  const p = pure.planoDoVinculo(s, g);
  assert.strictEqual(p.soParams, true, 'multi-parte grava só a identidade');
  assert.ok(p.efeito.includes(String(n)), 'o efeito diz quantas partes são: ' + p.efeito);
  assert.ok(/desenho fica/.test(p.efeito), p.efeito);
}
console.log('(3) plano de multi-parte: identidade sim, símbolo não, e o efeito diz quantas partes');

/* ── (4) plano impossível devolve null, não meio-plano ─────────────────────── */
assert.strictEqual(pure.planoDoVinculo(null, g1), null);
assert.strictEqual(pure.planoDoVinculo(sAlta, null), null);
assert.strictEqual(pure.planoDoVinculo({ componente:'' }, g1), null, 'sem componente não há vínculo');
assert.strictEqual(pure.planoDoVinculo(sAlta, { refs:[], multiparte:false }), null, 'grupo sem designador');
console.log('(4) vínculo impossível devolve null — nunca um plano pela metade');

/* ── (5) o resumo é o que a pessoa lê antes de aplicar ─────────────────────── */
const porGrupo = { G1:g1, G2:gMulti, G3:gDois, G4:{ id:'G4', refs:['CN4'], multiparte:true, partes:4 } };
const todas = [sAlta, sMedia, sMao1, sMao2];
let r = pure.resumo(todas, pure.marcadasDeSaida(todas), porGrupo);
assert.deepStrictEqual(r, { grupos:2, trocam:1, soId:1 },
  'dois marcados: o capacitor troca, o conector só recebe identidade — ' + JSON.stringify(r));
/* desmarcar tudo zera */
assert.deepStrictEqual(pure.resumo(todas, {}, porGrupo), { grupos:0, trocam:0, soId:0 });
/* marcar na mão o par empatado entra na conta */
r = pure.resumo(todas, { 116:true, 1428:true, 2512:true, 1432:true }, porGrupo);
assert.strictEqual(r.grupos, 4);
assert.strictEqual(r.soId, 3, 'CN1, CN2... os multi-parte contam como identidade: ' + JSON.stringify(r));
/* grupo que o servidor não mandou não derruba a conta */
assert.doesNotThrow(() => pure.resumo([{ product_id:9, grupo:'NAO_EXISTE' }], { 9:true }, porGrupo));
assert.strictEqual(pure.resumo([{ product_id:9, grupo:'NAO_EXISTE' }], { 9:true }, porGrupo).trocam, 1,
  'sem o grupo, o resumo assume troca — que é o caso mais alarmante, não o mais brando');
console.log('(5) o resumo separa quem troca de quem só recebe identidade, e não quebra com grupo faltando');

console.log('\ntest-odoobom OK (mão nunca marcada, multi-parte não troca símbolo, '
          + 'plano sem meio-termo, resumo honesto)');
