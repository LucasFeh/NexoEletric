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
/* e nenhuma linha marcada pode trocar o tipo da peça — menos o jumper, que troca por regra: o
   destino dele é uma barra de pinos (J) ou um resistor 0R (R), e quem o prende é a seção 12 */
for (const l of fora)
  if (l.marcado && l.perfil.tipo && l.escolha.alvo.tipo && !l.perfil.jumper)
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

/* ── 9. quem JÁ é do almoxarifado sai da lista, mesmo com outro nome ─────────
   Casar pelo NOME é o que havia, e o nome é a coisa mais instável do acervo. Medido aqui:
   dos componentes do corpus que carregam OdooId (alguém já os converteu), a maioria NÃO
   casa por nome — o acervo renomeou o valor, ou o acento veio gravado em UTF-8 dentro do
   espelho latin-1. O resultado era o pior possível: a peça CERTA aparecia em "a converter"
   com uma sugestão de trocar por OUTRA coisa. */
const POR_ODOO = new Map();
for (const c of CANDS) if (c.odooId && !POR_ODOO.has(c.odooId)) POR_ODOO.set(c.odooId, c.nome);
assert.ok(POR_ODOO.size > 1000, 'o espelho tem de emitir OdooId em todo valor: ' + POR_ODOO.size);

/* o MESMO detector do hub-converte.js » varreFolha */
const NOME_DE = new Map(CANDS.map(c => [c.nome, c.nome]));
const detecta = (c, perfil) => {
  const oid = (perfil && perfil.odooId) || P.paramsPlanos(c && c.params).ODOOID || '';
  if (oid && POR_ODOO.has(String(oid).trim())) return POR_ODOO.get(String(oid).trim());
  return NOME_DE.get(String((c && c.sym) || '')) || '';
};

/* o contrato: componente com OdooId que existe no acervo É do almoxarifado, diga o nome o
   que disser — e nunca recebe sugestão de troca */
const comOdoo = COMPS.filter(c => {
  const oid = P.paramsPlanos(c.params).ODOOID;
  return oid && POR_ODOO.has(String(oid).trim());
});
assert.ok(comOdoo.length >= 10, 'o corpus tem de ter componentes já convertidos: ' + comOdoo.length);
const porId = P.varre(comOdoo, CANDS, detecta);
for (const l of porId){
  assert.strictEqual(l.almox, true,
    'tem OdooId no acervo e não foi reconhecido: ' + l.refs.join(',') + ' sym=' + l.perfil.sym);
  assert.strictEqual(l.escolha, null, 'linha já do almoxarifado não pode trazer sugestão');
  assert.strictEqual(l.marcado, false, 'linha já do almoxarifado não pode vir marcada');
}
/* e o nome do acervo tem de viajar, senão a tela não sabe dizer "mesma peça, outro nome" */
const renomeados = porId.filter(l => l.almoxNome && l.almoxNome !== l.perfil.sym);
assert.ok(renomeados.length, 'o corpus tem casos de nome diferente; nenhum foi marcado');

/* o detector velho (só nome) deixava esses passar — é a regressão que este teste prende */
const soNome = P.varre(comOdoo, CANDS, c => NOME_DE.has(String(c.sym || '')));
const escapavam = soNome.filter(l => !l.almox).length;
assert.ok(escapavam > 0, 'se ninguém mais escapa por nome, este teste perdeu o sentido');
console.log('    já-do-almoxarifado: ' + porId.length + ' tipos com OdooId, '
  + renomeados.length + ' com outro nome no acervo, ' + escapavam
  + ' que o casamento por nome deixava passar');
console.log('(9) quem já é do almoxarifado sai da lista, mesmo renomeado ok');

/* ── 10. "180g" vira "180°", e código de peça NÃO ─────────────────────────
   O cadastro escreve o ângulo do conector com "g" de graus. Trocar todo <número>g por grau
   parece inofensivo e não é: medido no espelho do servidor, das 122 ocorrências 4 são código
   de peça ("LM2575D2T-5G", "LP2950CZ-3.3G", "BDMU-12G") ou PESO ("...200g 750v"). Por isso a
   regra só aceita 90 e 180 — os dois ângulos que a casa usa. É este teste que impede alguém
   de "generalizar" a regra depois e reescrever part number. */
const GRAU = '°';
for (const [ent, esp] of [
  ['1x10 P2.54mm Macho 180g',              '1x10 P2.54mm Macho 180' + GRAU],
  ['1x6 P2.54mm Macho 90g',                '1x6 P2.54mm Macho 90' + GRAU],
  ['FKCT 2.5/ 5-STF-5.08 1902330 90g',     'FKCT 2.5/ 5-STF-5.08 1902330 90' + GRAU],
  ['Switch 4 vias P2.54mm 180g 642-3ETL',  'Switch 4 vias P2.54mm 180' + GRAU + ' 642-3ETL'],
  ['Latch 2x8 16 vias P2.54mm 180G',       'Latch 2x8 16 vias P2.54mm 180' + GRAU],
  /* os quatro que NAO podem ser tocados */
  ['LM2575D2T-5G',                         'LM2575D2T-5G'],
  ['LP2950CZ-3.3G',                        'LP2950CZ-3.3G'],
  ['Nylon C/Fix. BDMU-12G 12 vias',        'Nylon C/Fix. BDMU-12G 12 vias'],
  ['Cofisil Sensor Silo 1 6m 200g 750v',   'Cofisil Sensor Silo 1 6m 200g 750v'],
  /* o que ja esta em grau fica como esta */
  ['Kk 6 vias Macho, passo 3.96mm, 180º', 'Kk 6 vias Macho, passo 3.96mm, 180º'],
]) assert.strictEqual(P.comGraus(ent), esp, 'comGraus("' + ent + '")');
/* e contra o acervo de verdade: nenhum part number pode mudar */
let trocados = 0, suspeitos = [];
for (const c of CANDS){
  const novo2 = P.comGraus(c.nome);
  if (novo2 === c.nome) continue;
  trocados++;
  if (!/vias|pinos|macho|fêmea|femea|passo|p\d|barra|latch|kk|header|switch|db\d|fkc|mc /i.test(c.nome))
    suspeitos.push(c.nome);
}
assert.deepStrictEqual(suspeitos, [], 'trocou grau fora de contexto de conector: ' + suspeitos.join(' | '));
console.log('    graus: ' + trocados + ' nomes do acervo ganharam o simbolo, 0 fora de contexto');
console.log('(10) "180g" vira grau, e codigo de peca fica intacto ok');

/* ── 11. o rascunho: fechar o painel não desfaz o que a pessoa decidiu ────────
   O abre() refazia a varredura do zero a cada vez: a escolha feita à mão voltava a ser a
   recomendação, a linha desmarcada voltava marcada. O rascunho guarda SÓ o que a pessoa mudou,
   pela chave da linha, com a peça pelo id do Odoo. O ciclo inteiro roda aqui contra o corpus e
   o acervo reais, com um JSON no meio — é o que o localStorage devolve. */
{
  const tem = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const porChave = L => new Map(L.map(l => [l.chave, l]));
  const ida = o => JSON.parse(JSON.stringify(o));

  const L1 = P.varre(COMPS, CANDS, detecta);
  assert.deepStrictEqual(P.rascunhoDe(L1), {},
    'uma varredura sem mão nenhuma não tem rascunho — senão toda abertura gravaria lixo');
  const pend = L1.filter(l => !l.almox);
  const desmarcada = pend.find(l => l.escolha && l.marcado);
  const trocada = pend.find(l => l !== desmarcada && l.sugestoes.length >= 2);
  const semTroca = pend.find(l => l !== desmarcada && l !== trocada && l.escolha);
  const aMao = pend.find(l => l !== desmarcada && l !== trocada && l !== semTroca);
  assert.ok(desmarcada && trocada && semTroca && aMao, 'o corpus precisa de quatro linhas a converter');
  /* a peça à mão: fora das sugestões da linha, viva e de id único no acervo — senão o caso do
     renome acharia um gêmeo pelo mesmo id e passaria por sorte */
  const quantosId = new Map();
  for (const b of CANDS) if (b.odooId) quantosId.set(b.odooId, (quantosId.get(b.odooId) || 0) + 1);
  const outra = CANDS.find(b => b.odooId && quantosId.get(b.odooId) === 1 && !b.fora
    && !aMao.sugestoes.some(s => s.alvo === b));
  assert.ok(outra, 'o acervo precisa de uma peça viva de id único');

  /* as quatro decisões da tela: desmarcar, trocar de opção, "não trocar" e escolher à mão */
  desmarcada.marcado = false;
  trocada.escolha = trocada.sugestoes[1];
  trocada.marcado = true;
  semTroca.escolha = null;
  semTroca.marcado = false;
  const esc = P.escolhaPara(aMao.perfil, outra);
  aMao.sugestoes = [esc].concat(aMao.sugestoes);
  aMao.escolha = esc;
  aMao.marcado = true;
  const R = ida(P.rascunhoDe(L1));
  assert.strictEqual(Object.keys(R).length, 4, 'só as quatro linhas mexidas entram: ' + Object.keys(R).length);

  /* reabrir: varredura nova, objetos novos — da primeira só sobrevive o JSON */
  const L2 = P.varre(COMPS, CANDS, detecta);
  const r2 = P.aplicaRascunho(L2, R, CANDS);
  assert.strictEqual(r2.restauradas, 4);
  assert.deepStrictEqual(r2.perdidas, []);
  const M2 = porChave(L2);
  const d2 = M2.get(desmarcada.chave), t2 = M2.get(trocada.chave);
  const s2 = M2.get(semTroca.chave), m2 = M2.get(aMao.chave);
  assert.strictEqual(d2.marcado, false, 'a linha desmarcada voltou marcada');
  assert.strictEqual(d2.escolha.alvo, desmarcada.escolha.alvo);
  assert.strictEqual(t2.escolha.alvo, trocada.escolha.alvo, 'a outra opção escolhida não voltou');
  assert.strictEqual(t2.marcado, true);
  assert.strictEqual(s2.escolha, null, 'o "não trocar" não voltou');
  assert.strictEqual(s2.marcado, false);
  assert.strictEqual(m2.escolha.alvo, outra, 'a peça escolhida à mão não voltou');
  assert.strictEqual(m2.marcado, true);
  assert.strictEqual(m2.sugestoes[0], m2.escolha, 'a peça à mão volta para a lista de opções');
  for (const l of L2) if (!tem(R, l.chave)){
    assert.strictEqual(l.escolha, l.padrao.escolha, 'linha que ninguém mexeu mudou: ' + l.refs.join(','));
    assert.strictEqual(l.marcado, l.padrao.marcado);
  }
  assert.deepStrictEqual(ida(P.rascunhoDe(L2)), R, 'a ida e volta mudou o rascunho');

  /* o produto renomeado no Odoo: mesmo id, outro nome — a escolha segue o id, e a entrada
     passa a guardar o nome novo */
  const renomeada = Object.assign({}, outra, { nome: outra.nome + ' (renomeado)' });
  const C3 = CANDS.map(b => b === outra ? renomeada : b);
  const L3 = P.varre(COMPS, C3, detecta);
  P.aplicaRascunho(L3, R, C3);
  assert.strictEqual(porChave(L3).get(aMao.chave).escolha.alvo, renomeada, 'renomear no Odoo perdeu a escolha');
  assert.strictEqual(P.rascunhoDe(L3)[aMao.chave].e.n, renomeada.nome);

  /* a peça que não está no acervo: a linha fica desmarcada e diz qual era, e a escolha NÃO sai
     do rascunho — volta inteira quando a peça voltar */
  const C4 = CANDS.filter(b => b.odooId !== outra.odooId && b.nome !== outra.nome);
  const L4 = P.varre(COMPS, C4, detecta);
  const r4 = P.aplicaRascunho(L4, R, C4);
  const m4 = porChave(L4).get(aMao.chave);
  assert.deepStrictEqual(r4.perdidas.map(p => p.nome), [outra.nome]);
  assert.strictEqual(m4.marcado, false, 'sem a peça, a linha não pode ficar marcada');
  assert.strictEqual(m4.perdida, outra.nome);
  assert.deepStrictEqual(ida(P.rascunhoDe(L4))[aMao.chave], R[aMao.chave],
    'a escolha saiu do rascunho por falta da peça');
  const L5 = P.varre(COMPS, CANDS, detecta);
  P.aplicaRascunho(L5, ida(P.rascunhoDe(L4)), CANDS);
  assert.strictEqual(porChave(L5).get(aMao.chave).escolha.alvo, outra, 'a peça voltou e a escolha não');
  assert.strictEqual(porChave(L5).get(aMao.chave).marcado, true);

  /* o acervo que não carregou: nenhuma decisão pode sair do rascunho — nem o "não trocar", que
     fica IGUAL à recomendação quando não há recomendação, e sairia se fosse medido de novo */
  const L6 = P.varre(COMPS, [], detecta);
  P.aplicaRascunho(L6, R, []);
  assert.deepStrictEqual(ida(P.rascunhoDe(L6)), R, 'o acervo vazio apagou decisões do rascunho');

  /* o "Trocar": o componente trocado ganha outro sym e outros params, muda de chave, e a
     decisão sobre ele sai sozinha; as que ficaram de fora da troca continuam */
  const alvoT = trocada.escolha.alvo;
  const depois = COMPS.map(c => P.chaveDoComp(c) === trocada.chave
    ? Object.assign({}, c, { sym: alvoT.nome, params: 'OdooId=' + alvoT.odooId }) : c);
  const L7 = P.varre(depois, CANDS, detecta);
  P.aplicaRascunho(L7, R, CANDS);
  const R7 = P.rascunhoDe(L7);
  assert.ok(!tem(R7, trocada.chave), 'a linha trocada continuou no rascunho');
  assert.deepStrictEqual(Object.keys(R7).sort(),
    [desmarcada.chave, semTroca.chave, aMao.chave].sort(), 'a troca levou decisões que não eram dela');

  /* com o id repetido, a peça viva ganha do duplicado antigo ("fora"); o nome sozinho vale
     quando o id não acha nada; e o lixo não restaura nada */
  const zumbi = Object.assign({}, outra, { nome: outra.nome + ' (antigo)', fora: true });
  assert.strictEqual(P.achaAlvo({ n: zumbi.nome, o: outra.odooId }, [zumbi, outra]), outra);
  assert.strictEqual(P.achaAlvo({ n: outra.nome, o: '' }, [zumbi, outra]), outra);
  assert.strictEqual(P.achaAlvo({ n: 'nao existe', o: 'nao existe' }, CANDS), null);
  assert.strictEqual(P.achaAlvo(null, CANDS), null);
  assert.strictEqual(P.aplicaRascunho(L2, 'lixo', CANDS).restauradas, 0);
  assert.strictEqual(P.aplicaRascunho(L2, { [aMao.chave]: 'lixo' }, CANDS).restauradas, 0);
  console.log('    rascunho: 4 decisões, ' + pend.length + ' linhas a converter no corpus');
}
console.log('(11) o rascunho: fecha, reabre, renomeia, some, volta e troca sem perder decisão ok');

/* ── 12. o jumper: barra de pinos, resistor 0R ou nenhuma peça ───────────────
   Pedido do dono (2026-10-09): jumper vindo do Altium só tem três destinos — a barra de pinos
   de 2 vias, o resistor 0R, ou nenhuma peça, porque o jumper é na solda. Pelo recomendador
   genérico ele era conector (todo jumper do corpus usa designador J) e recebia baioneta, KK,
   borne e circular MIL. O footprint escolhe qual dos três vem escolhido: com SMD no nome são
   pads de solda, sem SMD é barra de 2,54 mm, e footprint de resistor pede o 0R do tamanho dele. */
{
  const ehBarra = b => /BARRA DE PINOS/i.test(b.familia);
  const eh0R = b => b.tipo === 'R' && !!b.valor && b.valor.n === 0;
  const umaLinha = c => P.varre([c], CANDS, () => false)[0];
  assert.ok(CANDS.some(b => ehBarra(b) && b.vias === 2) && CANDS.some(b => ehBarra(b) && b.vias === 3)
            && CANDS.some(eh0R), 'o acervo precisa ter barra de 2 e de 3 vias e resistor 0R');

  /* o corpus inteiro: nenhum jumper recebe nada fora das três */
  const jumpers = COMPS.filter(c => /jumper/i.test([c.sym, c.footprint, c.comment].join(' ')));
  assert.ok(jumpers.length >= 40, 'o corpus tem 41 jumpers em 7 projetos; vieram ' + jumpers.length);
  const L = P.varre(jumpers, CANDS, () => false);
  for (const l of L){
    assert.ok(l.perfil.jumper, 'jumper não reconhecido: ' + l.refs.join(',') + ' ' + l.perfil.fp);
    assert.ok(l.sugestoes.length, 'jumper sem opção nenhuma: ' + l.refs.join(','));
    for (const s of l.sugestoes)
      assert.ok(ehBarra(s.alvo) || eh0R(s.alvo),
        'jumper recebeu outra coisa: ' + l.refs.join(',') + ' → ' + s.alvo.familia + ' :: ' + s.alvo.nome);
  }

  /* PTH: a barra de 2 vias, marcada; o 0R fica na lista, desmarcado de saída */
  const pth = umaLinha({ ref: 'J1', sym: 'JUMPER [02V]', footprint: 'JUMPER 2 VIAS PTH',
                         comment: 'Fechado = terminador CAN' });
  assert.ok(pth.escolha && ehBarra(pth.escolha.alvo) && pth.escolha.alvo.vias === 2,
            'jumper PTH vira a barra de 2 vias: veio ' + (pth.escolha && pth.escolha.alvo.nome));
  assert.strictEqual(pth.escolha.confianca, 'alta');
  assert.strictEqual(pth.marcado, true);
  assert.ok(pth.sugestoes.some(s => eh0R(s.alvo)), 'o 0R fica na lista do jumper PTH');
  /* o "JUMPER_2VIAS" do TCMS_Reader não diz PTH e é barra do mesmo jeito (medido na placa) */
  assert.ok(ehBarra(umaLinha({ ref: 'J3', sym: 'Jumper 2', footprint: 'JUMPER_2VIAS',
                               comment: 'Jumper' }).escolha.alvo));

  /* SMD: pads de solda — nenhuma peça, desmarcada, com a barra e o 0R à mão na lista */
  for (const fp of ['JUMPER 2 VIAS SMD', 'JUMPER_2VIAS_SMD']){
    const s = umaLinha({ ref: 'J2', sym: 'Jumper 2', footprint: fp, comment: 'JUMPER' });
    assert.strictEqual(s.perfil.jumper.solda, true, fp + ' é jumper de solda');
    assert.strictEqual(s.escolha, null, fp + ': a recomendação é nenhuma peça');
    assert.strictEqual(s.marcado, false);
    assert.ok(s.sugestoes.some(x => ehBarra(x.alvo)) && s.sugestoes.some(x => eh0R(x.alvo)),
              fp + ': a barra e o 0R ficam na lista');
  }

  /* 3 pinos: a barra de 3, e nunca o 0R — dois terminais no lugar de três perdem uma ligação */
  const tres = umaLinha({ ref: 'J5', sym: 'JUMPER 3Q', footprint: 'JUMPER_3VIAS',
                          comment: 'Jumper de 3 pinos' });
  assert.strictEqual(tres.perfil.jumper.vias, 3);
  assert.ok(tres.escolha && ehBarra(tres.escolha.alvo) && tres.escolha.alvo.vias === 3,
            'jumper de 3 pinos vira barra de 3: veio ' + (tres.escolha && tres.escolha.alvo.nome));
  for (const s of tres.sugestoes) assert.ok(!eh0R(s.alvo), 'jumper de 3 pinos não aceita 0R');
  assert.strictEqual(P.perfilDoComp({ ref: 'J1', sym: 'JUMPER [03V]', footprint: 'JUMPER 3V REFORCADO',
                                      comment: '' }).jumper.vias, 3, '"3V" num jumper é vias');

  /* footprint de resistor: o 0R do mesmo tamanho */
  const r = umaLinha({ ref: 'JP1', sym: 'JUMPER', footprint: 'JUMPER 0805', comment: 'JUMPER' });
  assert.ok(r.escolha && eh0R(r.escolha.alvo) && r.escolha.alvo.encaps[0] === '0805',
            'jumper 0805 vira 0R 0805: veio ' + (r.escolha && r.escolha.alvo.nome));
  assert.strictEqual(r.escolha.confianca, 'alta');

  /* fora das três é escolha à mão: o recomendador não dá nota a um KK de 2 vias */
  const kk = CANDS.find(b => /\bKK\b/i.test(b.familia) && b.vias === 2);
  assert.ok(kk, 'o acervo precisa ter um KK de 2 vias');
  assert.strictEqual(P.pontua(pth.perfil, kk), null, 'KK não é recomendação para jumper');
  /* e o que não é jumper segue o caminho de sempre */
  assert.strictEqual(P.perfilDoComp({ ref: 'J9', sym: 'CONECTOR', footprint: 'BARRA 2 VIAS',
                                      comment: '2 vias' }).jumper, null);

  const nSolda = L.filter(l => !l.escolha).reduce((a, l) => a + l.partes, 0);
  const nBarra = L.filter(l => l.escolha && ehBarra(l.escolha.alvo)).reduce((a, l) => a + l.partes, 0);
  console.log('    jumpers: ' + jumpers.length + ' no corpus, ' + nBarra + ' viram barra de pinos, '
    + nSolda + ' ficam na solda, 0 fora das três');
}
console.log('(12) jumper: barra de pinos, resistor 0R ou nenhuma peça ok');

console.log('test-converte OK (o portão é tipo, valor e montagem; o resto é ordem)');
