/* O recomendador da conversão para o almoxarifado — contra os projetos e o acervo REAIS.
 *
 *     node tests/test-converte.js
 *
 * Recomendação é palpite, e palpite que ninguém mede vira lenda. Este teste roda o núcleo
 * puro do hub-converte.js sobre os 19 projetos de Projects/ e os espelhos do almoxarifado,
 * e prende:
 *
 *   1. a leitura do valor: "4k7" não é 4 ohms, "1/4W 10k" não é 1 ohm, "100nF" é "0.1uF",
 *      "100mOhms" não é "100MOhms" e "SMD 1206 4.7pF" não é 1206;
 *   2. os portões que impedem a troca errada: tipo, valor e montagem;
 *   3. o que o corpus real produz — números que uma mudança de peso não pode piorar sem
 *      alguém ver;
 *   4. os casos que já deram errado uma vez: o LED que recebia um VARISTOR, o resistor sem
 *      Value que vinha marcado, o encapsulamento secundário passando por primário.
 *
 * Roda sem rede, sem Altium e sem navegador; não escreve em nada.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const RAIZ = path.dirname(__dirname);
/* o módulo se auto-inicia no DOMContentLoaded; sem `document` ele devolve só o núcleo puro */
const { pure: P } = require(path.join(RAIZ, 'hub-converte.js'));

/* ── o acervo de verdade ─────────────────────────────────────────────────── */
function carregaMirror(arq){
  /* latin-1: é como o gerador escreve os espelhos (tools/almox/almox2lib.py) */
  const t = fs.readFileSync(path.join(RAIZ, 'Libs', arq), 'latin1');
  return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
}
const CANDS = [], POR_NOME = new Map();
for (const arq of ['almox-basicos.js', 'almox-especiais.js']){
  if (!fs.existsSync(path.join(RAIZ, 'Libs', arq))){
    console.log('SEM ESPELHO (' + arq + '): rode o sincronismo do almoxarifado. Pulei.');
    process.exit(0);
  }
  for (const sy of carregaMirror(arq).symbols || []){
    const g = { familia: sy.name, designator: sy.designator || '' };
    for (const v of sy.valores || []){
      if (!v.altium) continue;
      const it = { v, nome: v.altium, rotulo: v.label || v.altium, saldo: Number(v.estoque) || 0,
                   pkg: v.footprint || (v.pkgs || [])[0] || '', mpn: String(v.mpn || '').trim() };
      const p = P.perfilDoValor(g, it);
      CANDS.push(p);
      POR_NOME.set(v.altium, p);
    }
  }
}
assert.ok(CANDS.length > 1000, 'o acervo veio pequeno demais: ' + CANDS.length);

/* ── os projetos de verdade ──────────────────────────────────────────────── */
const COMPS = [];
for (const proj of fs.readdirSync(path.join(RAIZ, 'Projects'))){
  const p = path.join(RAIZ, 'Projects', proj, 'schematic.js');
  if (!fs.existsSync(p)) continue;
  for (let ln of fs.readFileSync(p, 'utf8').split('\n')){
    ln = ln.trim().replace(/^,/, '').replace(/,$/, '');
    if (ln.indexOf('"t":"comp"') < 0) continue;
    try { COMPS.push(JSON.parse(ln)); } catch (e) { /* linha que não é objeto: não é comp */ }
  }
}
assert.ok(COMPS.length > 500, 'poucos componentes no corpus: ' + COMPS.length);

/* ── 1. o valor ───────────────────────────────────────────────────────────── */
const v = (t, cl) => { const r = P.normValor(t, cl || ''); return r ? r.classe + ':' + r.n : null; };
assert.strictEqual(v('4k7', 'R'), 'R:4700', 'RKM: "4k7" com parseFloat vira 4');
assert.strictEqual(v('1M2', 'R'), 'R:1200000');
assert.strictEqual(v('4M7', 'R'), 'R:4700000');
assert.strictEqual(v('1/4W 10k', 'R'), 'R:10000', 'a potência não é o valor');
assert.strictEqual(v('10k 1% 1/4W', 'R'), 'R:10000');
assert.strictEqual(v('0R', 'R'), 'R:0', 'jumper de 0 ohm é valor legítimo');
assert.strictEqual(v('330R'), 'R:330');
assert.strictEqual(v('1M', 'R'), 'R:1000000', 'M maiúsculo em resistor é mega');
assert.ok(P.normValor('0.1R/100mOhms 5W 1% 90ppm', 'R').n === 0.1, 'm minúsculo é mili');
assert.ok(P.mesmoValor(P.normValor('100nF', 'C'), P.normValor('0.1uF', 'C')),
          '"100nF" e "0.1uF" são a MESMA peça escrita de dois jeitos');
assert.ok(P.mesmoValor(P.normValor('22pF 50V', 'C'), P.normValor('22p', 'C')));
assert.ok(!P.mesmoValor(P.normValor('10k', 'R'), P.normValor('10k', 'C')),
          'classe diferente nunca é o mesmo valor');
assert.strictEqual(v('SMD 1206 4.7pF 50V C0G', 'C'), 'C:4.7e-12',
                   'o encapsulamento não pode ser lido como valor');
assert.strictEqual(P.normValor('1N4148', ''), null, 'part number não é valor');
console.log('(1) valor: RKM, potência, mili/mega, pF/uF e encapsulamento ok');

/* ── 2. encapsulamento, montagem, vias e part number ─────────────────────── */
assert.strictEqual(P.encapDe('RES 1206'), '1206');
assert.strictEqual(P.encapDe('1206 resistor'), '1206');
assert.strictEqual(P.encapDe('SOT-23'), 'SOT-23');
assert.strictEqual(P.encapDe('DIP8'), 'DIP-8');
assert.strictEqual(P.encapDe('', 'CAP 0805'), '0805', 'pula o vazio e usa o próximo');
assert.strictEqual(P.montagemDe('RES 1206'), 'SMD');
assert.strictEqual(P.montagemDe('DIP14'), 'PTH');
assert.strictEqual(P.montagemDe('RES_1/4W'), 'PTH');
assert.strictEqual(P.viasDe('CONECTOR HEADER / 16 VIAS / Fêmea'), 16);
assert.strictEqual(P.viasDe('9 vias 180º 2.54mm Macho'), 9);
assert.strictEqual(P.viasDe('Conector 2 Filas 20pin'), 20);
assert.strictEqual(P.pareceMPN('1N4148'), '1N4148');
assert.strictEqual(P.pareceMPN('BC337'), 'BC337');
assert.strictEqual(P.pareceMPN('10K 1/4W'), '', 'valor com potência NÃO é part number');
assert.strictEqual(P.pareceMPN('0.1uF/100nF 100V'), '', 'dois valores continuam sendo valor');
assert.strictEqual(P.pareceMPN('1206'), '', 'só dígito não é part number');
console.log('(2) encapsulamento, montagem, vias e part number ok');

/* ── 3. o tipo, que é o portão ────────────────────────────────────────────
   O designador sozinho não basta: a família LED do almoxarifado usa "DS" e a VARISTOR usa
   "RV". Sem ler o NOME, um LED 1206 recebia um varistor 1206 com nota de sobra. */
assert.strictEqual(P.tipoDoRef('R12'), 'R');
assert.strictEqual(P.tipoDoRef('DS3'), 'D');
assert.strictEqual(P.tipoDoTexto('LED SMD 1206 RED'), 'D');
assert.strictEqual(P.tipoDoTexto('VARISTOR'), 'RV');
assert.strictEqual(P.tipoDoTexto('CAPACITOR CERAMICO [SMD]'), 'C');
const led = P.perfilDoComp({ ref: 'D1', sym: 'LED', footprint: 'LED SMD 1206 RED', comment: '?' });
assert.strictEqual(led.tipo, 'D');
const varistores = CANDS.filter(c => /VARISTOR/i.test(c.familia));
assert.ok(varistores.length, 'o acervo precisa ter varistores para este caso valer');
for (const vd of varistores)
  assert.strictEqual(P.pontua(led, vd), null, 'varistor não substitui LED: ' + vd.nome);
const paraLed = P.sugere(led, CANDS, 3);
assert.ok(paraLed.length && /LED/i.test(paraLed[0].alvo.familia),
          'um LED 1206 tem de receber um LED: veio ' + (paraLed[0] && paraLed[0].alvo.familia));
console.log('(3) tipo: o LED recebe LED, e o varistor 1206 é recusado ok');

/* ── 4. os portões de valor e montagem ───────────────────────────────────── */
const r10k = P.perfilDoComp({ ref: 'R1', sym: 'RES [ SMD ]', footprint: 'RES 1206',
                              comment: '10K 1/4W' });
for (const s of P.sugere(r10k, CANDS, 40)){
  assert.ok(P.mesmoValor(r10k.valor, s.alvo.valor),
            'nenhum resistor de outro valor pode ser sugerido: ' + s.alvo.nome);
  assert.notStrictEqual(s.alvo.mont, 'PTH', 'SMD não vira PTH sozinho: ' + s.alvo.nome);
}
const melhor = P.sugere(r10k, CANDS, 1)[0];
assert.ok(melhor && melhor.confianca === 'alta', 'um 10K 1206 SMD é caso resolvido');
assert.ok(/1206/.test(melhor.alvo.nome) || (melhor.alvo.encaps || [])[0] === '1206',
          'o encapsulamento escolhido tem de ser o do projeto: ' + melhor.alvo.nome);
console.log('(4) valor e montagem: nada de outro valor, nada de PTH por SMD ok');

/* ── 5. sem valor não há confiança ───────────────────────────────────────
   48 resistores do corpus têm comment "=Value + ' - ' + Potência" e NENHUM parâmetro: a
   fórmula se resolve dentro do Altium e o export não trouxe o Value. Eles casavam tipo,
   encapsulamento e montagem, somavam 83 pontos e vinham MARCADOS — um "Aplicar" trocaria
   48 resistores por 0.1R. */
const semValor = P.perfilDoComp({ ref: 'R9', sym: 'RES [SMD]', footprint: 'RES 1206',
                                  comment: "=Value + ' - ' + Potência" });
assert.strictEqual(semValor.valor, null, 'fórmula não é valor');
const sug = P.sugere(semValor, CANDS, 5);
assert.ok(sug.length, 'ainda dá para sugerir pelo encapsulamento');
for (const s of sug)
  assert.strictEqual(s.confianca, 'baixa', 'sem valor, nada passa de baixa: ' + s.alvo.nome);
const lnSemValor = P.varre([{ ref: 'R9', sym: 'RES [SMD]', footprint: 'RES 1206',
                              comment: "=Value + ' - ' + Potência" }], CANDS, () => false)[0];
assert.strictEqual(lnSemValor.marcado, false, 'linha sem valor não pode vir marcada');
assert.ok(/formula|Value/i.test(lnSemValor.alerta), 'e tem de dizer por quê: ' + lnSemValor.alerta);
console.log('(5) sem valor: sugere, avisa, e NÃO vem marcada ok');

/* ── 6. o corpus inteiro ─────────────────────────────────────────────────── */
const linhas = P.varre(COMPS, CANDS, c => POR_NOME.has(String(c.sym || '')));
const fora = linhas.filter(l => !l.almox);
const conta = { alta: 0, media: 0, baixa: 0, nada: 0 };
for (const l of fora) conta[l.escolha ? l.escolha.confianca : 'nada']++;
const marcadosComp = fora.filter(l => l.marcado).reduce((a, l) => a + l.partes, 0);
console.log('    corpus: ' + COMPS.length + ' componentes, ' + linhas.length + ' tipos, '
  + CANDS.length + ' peças no acervo');
console.log('    alta ' + conta.alta + ' · média ' + conta.media + ' · baixa ' + conta.baixa
  + ' · sem sugestão ' + conta.nada + ' · ' + marcadosComp + ' componentes viriam marcados');
assert.ok(conta.alta >= 100, 'o corpus já rendeu 134 linhas de confiança alta; vieram ' + conta.alta);
assert.ok(conta.nada <= 40, 'muita linha sem sugestão nenhuma: ' + conta.nada);
/* NENHUMA linha marcada pode ter confiança baixa — é essa a promessa do "Aplicar" */
for (const l of fora)
  if (l.marcado) assert.notStrictEqual(l.escolha.confianca, 'baixa',
    'linha de confiança baixa veio marcada: ' + l.refs.join(',') + ' → ' + l.escolha.alvo.nome);
/* e nenhuma linha marcada pode trocar o tipo da peça */
for (const l of fora)
  if (l.marcado && l.perfil.tipo && l.escolha.alvo.tipo)
    assert.strictEqual(l.perfil.tipo, l.escolha.alvo.tipo,
      'troca de tipo marcada: ' + l.refs.join(',') + ' (' + l.perfil.tipo + ') → '
      + l.escolha.alvo.nome + ' (' + l.escolha.alvo.tipo + ')');
console.log('(6) corpus real: nada marcado com confiança baixa nem trocando de tipo ok');

/* ── 7. agrupamento: 175 resistores iguais são UMA decisão ───────────────── */
const iguais = P.varre([
  { ref: 'R1', sym: 'RES [ SMD ]', footprint: 'RES 1206', comment: '10K' },
  { ref: 'R2', sym: 'RES [ SMD ]', footprint: 'RES 1206', comment: '10K' },
  { ref: 'R3', sym: 'RES [ SMD ]', footprint: 'RES 0805', comment: '10K' },
], CANDS, () => false);
assert.strictEqual(iguais.length, 2, 'mesmo símbolo e comment com footprint diferente são 2');
assert.deepStrictEqual(iguais[0].refs, ['R1', 'R2']);
assert.strictEqual(iguais[0].partes, 2);
/* multi-parte: o mesmo designador em 16 partes continua sendo UM designador na lista */
const multi = P.varre(Array.from({ length: 16 }, (x, i) => (
  { ref: 'CN1', sym: 'CONECTOR PADRÃO', footprint: 'CONECTOR LATCH FEMEA',
    comment: 'CONECTOR HEADER / 16 VIAS', part: i + 1 })), CANDS, () => false);
assert.strictEqual(multi.length, 1);
assert.deepStrictEqual(multi[0].refs, ['CN1'], 'as 16 partes são um designador só');
assert.strictEqual(multi[0].partes, 16);
console.log('(7) agrupamento: encapsulamento separa, e as 16 partes são uma linha ok');

/* ── 8. o "mais perto" quando o valor não existe ─────────────────────────── */
const r30k = P.perfilDoComp({ ref: 'R7', sym: 'R', footprint: 'RES_1/4W', comment: '30K' });
const perto = P.aproxima(r30k, CANDS, 3);
if (P.sugere(r30k, CANDS, 1).length === 0){
  assert.ok(perto.length, 'sem valor exato, tem de dizer qual é o mais perto');
  for (const p of perto)
    assert.strictEqual(p.alvo.valor.classe, 'R', 'o mais perto tem de ser da mesma classe');
  assert.ok(perto[0].dist <= perto[perto.length - 1].dist, 'o mais perto vem primeiro');
}
console.log('(8) sem o valor exato, a tela sabe dizer o mais próximo ok');

console.log('test-converte OK (o portão é tipo, valor e montagem; o resto é ordem)');
