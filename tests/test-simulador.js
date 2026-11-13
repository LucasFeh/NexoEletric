/* O SIMULADOR (1.101.0): hub-simulador-motor.js (MNA, Newton com busca em linha e continuação pseudo-transiente),
   hub-simulador-circuito.js (o esquema vira circuito; as contas) e hub-simulador-pcb.js (a corrente nas trilhas).
     node tests/test-simulador.js

   1. o motor: divisor, LED com resistor, RC no tempo (contra a exponencial), fonte com onda;
   2. os modelos contra a teoria: 555 astável (período 0,693·(RA+2RB)·C), BJT em saturação, amp-op não inversor
      (ganho 1 + Rf/Rg), AMS1117 3,3 V, LM2575-5 (buck pelo FB), LM317 (Vout = 1,25·(1 + R2/R1)), zener, MOSFET chave;
   3. o multivibrador astável de dois transistores VIRA (a dobra que o Newton puro não atravessa) com o meio
      período perto de 0,69·R·C;
   4. reconhecimento: nets de alimentação pelo nome (+5V, 3V3, P12/N12, VCC_12...), terra, fonte suposta na entrada do
      regulador, jumper aberto por padrão (jumper de seleção em par não põe a fonte em curto), potenciômetro pelo W;
   5. as contas e os alertas: Ohm com sentido, potência acima da nominal pelo footprint, LED, regulador, GPIO lido;
   6. a corrente nas trilhas: a lei de Kirchhoff no cobre (o que entra num pad sai pelas trilhas), R = ρ·L/(w·t);
   7. as placas do acervo (Projects/, só leitura) convergem;
   8. o MCP: o grupo sim registrado, sim_rodar/sim_componente/sim_trilhas pelo arquivo;
   9. as vistas: os ganchos no schframe.js/pcbframe.js e os <script> nas cascas, a ação "simulador" nos dois hubs, a aba
      Simulador do hub (hub-simulador-aba.js) e as entradas pelos conectores (sim_testar). */
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path');
const M = require('../hub-simulador-motor.js');
const C = require('../hub-simulador-circuito.js');
const P = require('../hub-simulador-pcb.js');
const RAIZ = path.join(__dirname, '..');

let falhou = 0, n = 0;
const fila = [];
function caso(nome, fn) {
  fila.push(async () => {
    try { await fn(); n++; console.log('ok  ' + nome); }
    catch (e) { falhou++; console.log('FALHOU  ' + nome + '\n   ' + (e && e.stack || e)); }
  });
}
const perto = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ': ' + a + ' ≠ ' + b + ' (±' + tol + ')');
const pin = (num, name, net) => ({ num: String(num), name, net });
function roda(comps, cfg, opts) {
  const mt = C.monta(comps, cfg || {});
  const s = M.cria(mt.elementos, Object.assign({ terra: mt.terra }, opts || {}));
  const r = s.dc();
  return { mt, s, r, an: C.analisa(mt, r) };
}

/* ------------------------------------------------------------------ 1. o motor */
caso('motor: divisor resistivo e corrente com sinal', () => {
  const s = M.cria([{ ref: 'V1', tipo: 'V', nos: ['a', 'GND'], v: 10 }, { ref: 'R1', tipo: 'R', nos: ['a', 'b'], r: 1000 }, { ref: 'R2', tipo: 'R', nos: ['b', 'GND'], r: 3000 }]);
  const r = s.dc();
  assert.ok(r.ok);
  perto(r.v.b, 7.5, 1e-4, 'Vb (o GMIN de 1 nS em cada nó)');
  perto(r.el[1].i[0], 2.5e-3, 1e-7, 'I(R1) entrando pelo a');
  perto(r.el[0].i[0], -2.5e-3, 1e-7, 'a fonte entrega (corrente negativa no +)');
});
caso('motor: LED com resistor (Newton) e RC no tempo contra a exponencial', () => {
  const Is = 0.01 / Math.exp(2.0 / (2 * M.VT));
  const d = { ref: 'D1', tipo: 'NL', nos: ['k', 'GND'], f: (v, e, c) => { const i = Is * (c.limexp((v[0] - v[1]) / (2 * c.VT)) - 1); return [i, -i]; } };
  let s = M.cria([{ ref: 'V1', tipo: 'V', nos: ['a', 'GND'], v: 5 }, { ref: 'R1', tipo: 'R', nos: ['a', 'k'], r: 300 }, d]);
  const r = s.dc();
  assert.ok(r.ok);
  perto(r.el[1].i[0], (5 - r.v.k) / 300, 1e-9, 'KCL no LED');
  perto(r.v.k, 2.0, 0.05, 'Vf perto de 2 V a 10 mA');
  s = M.cria([{ ref: 'V1', tipo: 'V', nos: ['a', 'GND'], v: 5 }, { ref: 'R1', tipo: 'R', nos: ['a', 'c'], r: 1000 }, { ref: 'C1', tipo: 'C', nos: ['c', 'GND'], c: 1e-6 }], { dt: 1e-6 });
  s.liga();
  for (let k = 0; k < 1000; k++) s.passo(1);
  perto(s.tensao('c'), 5 * (1 - Math.exp(-1)), 0.02, 'Vc em t = RC');
});
caso('motor: onda quadrada e média no DC', () => {
  assert.strictEqual(M.valorDaOnda({ forma: 'quadrada', v: 5, f: 10, duty: 0.25 }, 0.01), 5);
  assert.strictEqual(M.valorDaOnda({ forma: 'quadrada', v: 5, f: 10, duty: 0.25 }, 0.05), 0);
  assert.strictEqual(M.mediaDaOnda({ forma: 'quadrada', v: 4, f: 10, duty: 0.25 }), 1);
  perto(M.valorDaOnda({ forma: 'seno', v: 2, f: 50 }, 0.005), 2, 1e-9, 'pico do seno');
});

/* ------------------------------------------------------------------ 2. os modelos contra a teoria */
caso('555 astável: período = 0,693·(RA + 2·RB)·C', () => {
  const comps = [
    { ref: 'U1', comment: 'NE555', pinos: [pin(1, 'GND', 'GND'), pin(2, 'TRIG', 'TH'), pin(3, 'OUT', 'OUT'), pin(4, 'RESET', '+9V'), pin(5, 'CTRL', 'CV'), pin(6, 'THR', 'TH'), pin(7, 'DIS', 'DIS'), pin(8, 'VCC', '+9V')] },
    { ref: 'R1', valor: '1k', pinos: [pin(1, '1', '+9V'), pin(2, '2', 'DIS')] },
    { ref: 'R2', valor: '10k', pinos: [pin(1, '1', 'DIS'), pin(2, '2', 'TH')] },
    { ref: 'C1', valor: '10uF', pinos: [pin(1, '1', 'TH'), pin(2, '2', 'GND')] },
    { ref: 'C2', valor: '10nF', pinos: [pin(1, '1', 'CV'), pin(2, '2', 'GND')] },
  ];
  const mt = C.monta(comps, {});
  const s = M.cria(mt.elementos, { terra: mt.terra, dt: 1e-4 }); s.liga();
  const bordas = []; let ult = null;
  for (let k = 0; k < 6000; k++) { const r = s.passo(1); const q = mt.comps.get('U1').q; if (ult !== null && q !== ult) bordas.push(r.t); ult = q; }
  assert.ok(bordas.length >= 6, 'oscilou');
  const per = [];
  for (let k = 2; k + 2 < bordas.length; k += 2) per.push(bordas[k + 2] - bordas[k]);
  perto(per.reduce((a, b) => a + b, 0) / per.length, 0.693 * 21e3 * 10e-6, 0.008, 'período');
  const an = C.analisa(mt, s.resultado());
  assert.ok(an.comps.U1.linhas.some(l => /Frequência/.test(l.t)), 'a conta da frequência');
});
caso('BJT chave satura; amp-op não inversor dá 1 + Rf/Rg', () => {
  let x = roda([
    { ref: 'R1', valor: '1k', pinos: [pin(1, '1', '+5V'), pin(2, '2', 'B')] },
    { ref: 'Q1', comment: 'BC337', footprint: 'TO-92', pinos: [pin(1, 'C', 'C'), pin(2, 'B', 'B'), pin(3, 'E', 'GND')] },
    { ref: 'R2', valor: '100', pinos: [pin(1, '1', '+12V'), pin(2, '2', 'C')] }]);
  assert.ok(x.r.v.C < 0.3, 'Vce de saturação');
  assert.strictEqual(x.an.comps.Q1.estado, 'saturação');
  x = roda([
    { ref: 'U1', comment: 'LM358', pinos: [pin(1, 'OUTA', 'O'), pin(2, '-INA', 'N'), pin(3, '+INA', 'IN'), pin(4, 'GND', 'GND'), pin(8, 'VCC', '+12V'), pin(5, '+INB', 'GND'), pin(6, '-INB', 'GND'), pin(7, 'OUTB', '')] },
    { ref: 'R1', valor: '10k', pinos: [pin(1, '1', 'O'), pin(2, '2', 'N')] }, { ref: 'R2', valor: '1k', pinos: [pin(1, '1', 'N'), pin(2, '2', 'GND')] },
    { ref: 'R3', valor: '10k', pinos: [pin(1, '1', '+5V'), pin(2, '2', 'IN')] }, { ref: 'R4', valor: '1k', pinos: [pin(1, '1', 'IN'), pin(2, '2', 'GND')] }]);
  perto(x.r.v.O, 5 / 11 * 11, 0.01, 'Vout');
});
caso('reguladores: AMS1117-3.3, LM2575-5 pelo FB, LM317 pelo divisor', () => {
  let x = roda([{ ref: 'U1', comment: 'AMS1117-3.3', pinos: [pin(1, 'GND', 'GND'), pin(2, 'VOUT', 'V33'), pin(3, 'VIN', '+5V')] }, { ref: 'R1', valor: '100', pinos: [pin(1, '1', 'V33'), pin(2, '2', 'GND')] }]);
  perto(x.r.v.V33, 3.3, 0.01, 'AMS1117');
  assert.ok(!x.mt.fontes.some(f => f.net === 'V33'), 'a net que o regulador produz não ganha fonte');
  x = roda([
    { ref: 'CI1', comment: 'LM2575-5', pinos: [pin(1, '', 'VE'), pin(2, '', 'SW'), pin(3, '', 'GND'), pin(4, '', 'OUT'), pin(5, '', 'GND')] },
    { ref: 'L1', valor: '330uH', pinos: [pin(1, '1', 'SW'), pin(2, '2', 'OUT')] }, { ref: 'D1', comment: '1N5822', pinos: [pin(1, 'A', 'GND'), pin(2, 'K', 'SW')] },
    { ref: 'R1', valor: '50', pinos: [pin(1, '1', 'OUT'), pin(2, '2', 'GND')] }, { ref: 'J1', comment: 'CONN', pinos: [pin(1, '1', 'VE'), pin(2, '2', 'GND')] }]);
  perto(x.r.v.OUT, 5, 0.02, 'buck 5 V');
  const sup = x.mt.fontes.find(f => f.origem === 'suposta');
  assert.ok(sup && sup.net === 'VE' && sup.v >= 12, 'entrada suposta no conector: ' + JSON.stringify(sup));
  const pin_ = x.an.fontes.find(f => f.net === 'VE');
  perto(pin_.p, (5 * 5 / 50) / 0.8 + 3e-3 * pin_.v, 0.02, 'potência de entrada = Pout/η + Iq');
  x = roda([
    { ref: 'U1', comment: 'LM317', pinos: [pin(1, 'ADJ', 'ADJ'), pin(2, 'OUT', 'O'), pin(3, 'IN', '+12V')] },
    { ref: 'R1', valor: '240', pinos: [pin(1, '1', 'O'), pin(2, '2', 'ADJ')] }, { ref: 'R2', valor: '720', pinos: [pin(1, '1', 'ADJ'), pin(2, '2', 'GND')] }]);
  perto(x.r.v.O, 1.25 * (1 + 720 / 240) + 50e-6 * 720, 0.02, 'LM317');
});
caso('zener grampeia; MOSFET N como chave', () => {
  let x = roda([{ ref: 'R1', valor: '1k', pinos: [pin(1, '1', '+12V'), pin(2, '2', 'Z')] }, { ref: 'DZ1', comment: 'BZX55C5V1', pinos: [pin(1, 'A', 'GND'), pin(2, 'K', 'Z')] }]);
  perto(x.r.v.Z, 5.1, 0.25, 'Vz');
  x = roda([
    { ref: 'Q1', comment: 'IRLZ44N', pinos: [pin(1, 'G', '+5V'), pin(2, 'D', 'D'), pin(3, 'S', 'GND')] },
    { ref: 'R1', valor: '10', pinos: [pin(1, '1', '+12V'), pin(2, '2', 'D')] }]);
  assert.ok(x.r.v.D < 0.5, 'Vds conduzindo: ' + x.r.v.D);
  assert.strictEqual(x.an.comps.Q1.estado, 'conduzindo');
});

/* ------------------------------------------------------------------ 3. multivibrador */
caso('multivibrador astável de dois BC337 vira (continuação pseudo-transiente)', () => {
  const comps = [
    { ref: 'Q1', comment: 'BC337', pinos: [pin(1, 'C', 'C1'), pin(2, 'B', 'B1'), pin(3, 'E', 'GND')] },
    { ref: 'Q2', comment: 'BC337', pinos: [pin(1, 'C', 'C2'), pin(2, 'B', 'B2'), pin(3, 'E', 'GND')] },
    { ref: 'C1', valor: '10uF', pinos: [pin(1, '1', 'C1'), pin(2, '2', 'B2')] }, { ref: 'C2', valor: '10uF', pinos: [pin(1, '1', 'C2'), pin(2, '2', 'B1')] },
    { ref: 'R1', valor: '47k', pinos: [pin(1, '1', '+9V'), pin(2, '2', 'B1')] }, { ref: 'R2', valor: '47k', pinos: [pin(1, '1', '+9V'), pin(2, '2', 'B2')] },
    { ref: 'R3', valor: '470', pinos: [pin(1, '1', '+9V'), pin(2, '2', 'A1')] }, { ref: 'LD1', comment: 'VERMELHO', pinos: [pin('A', 'A', 'A1'), pin('K', 'K', 'C1')] },
    { ref: 'R4', valor: '470', pinos: [pin(1, '1', '+9V'), pin(2, '2', 'A2')] }, { ref: 'LD2', comment: 'VERDE', pinos: [pin('A', 'A', 'A2'), pin('K', 'K', 'C2')] },
  ];
  const mt = C.monta(comps, {});
  const s = M.cria(mt.elementos, { terra: mt.terra, dt: 1e-3 }); s.liga();
  const bordas = []; let ult = null, minB = 0;
  for (let k = 0; k < 3000; k++) { const r = s.passo(1); minB = Math.min(minB, r.v.B2); const on = r.v.C1 < 1; if (ult !== null && on !== ult) bordas.push(r.t); ult = on; }
  assert.ok(bordas.length >= 6, 'virou ' + bordas.length + ' vezes');
  const meios = []; for (let k = 3; k < bordas.length; k++) meios.push(bordas[k] - bordas[k - 1]);
  const media = meios.reduce((a, b) => a + b, 0) / meios.length;
  assert.ok(media > 0.2 && media < 0.4, 'meio período ' + media);
  assert.ok(minB < -5, 'a base cai abaixo de −5 V na virada: ' + minB);
});

/* ------------------------------------------------------------------ 4. reconhecimento */
caso('nets de alimentação e terra pelo nome', () => {
  const t = C.tensaoDoNome;
  const casos = { '+5V': 5, '5V': 5, '3V3': 3.3, '+3.3V': 3.3, '-15V': -15, '12V': 12, 'P12': 12, 'N12': -12, 'VCC_12': 12, 'VCC': 5, 'VDD': 3.3, 'VBAT': 3.7, '5V ISO': 5, '+5V(PIC)': 5 };
  for (const [k, v] of Object.entries(casos)) assert.strictEqual(t(k), v, k);
  for (const k of ['IO12', 'N1', 'P2', 'NetC1_2', 'RS-485A', 'EN', 'T', 'GND', '0V']) assert.strictEqual(t(k), null, k);
  for (const k of ['GND', '0V', 'AGND', 'VSS', 'GND_ISO', 'PGND']) assert.ok(C.RE_TERRA.test(k), k);
});
caso('valores: 4K7, 1R5, 100nF 25V, 0.1uF/50V, 330uH, 10K 1/4W', () => {
  const v = C.leValor;
  perto(v('4K7').v, 4700, 1e-9); perto(v('1R5').v, 1.5, 1e-9); perto(v('2M2').v, 2.2e6, 1e-6);
  perto(v('100nF 25V').v, 1e-7, 1e-15); assert.strictEqual(v('100nF 25V').tensao, 25);
  perto(v('0.1uF/50V').v, 1e-7, 1e-15); perto(v('330uH').v, 330e-6, 1e-12);
  const r = v('10K 1/4W'); perto(r.v, 1e4, 1e-9); perto(r.potencia, 0.25, 1e-9);
  assert.ok(isNaN(v("=Value + ' - '").v), 'fórmula não é valor');
});
caso('jumper de seleção abre por padrão; pot pelo W; chave pelo clique', () => {
  const x = roda([
    { ref: 'J1', comment: 'JUMPER', pinos: [pin(1, '1', 'GND'), pin(2, '2', 'SEL')] }, { ref: 'J2', comment: 'JUMPER', pinos: [pin(1, '1', 'SEL'), pin(2, '2', '+5V')] },
    { ref: 'RV1', comment: 'POT', valor: '10k', pinos: [pin(1, '', '+5V'), pin(2, '', 'GND'), pin(3, 'W', 'CUR')] }]);
  const f = x.an.fontes.find(q => q.net === '+5V');
  assert.ok(Math.abs(f.i) < 2e-3, 'sem curto: ' + f.i);
  perto(x.r.v.CUR, 2.5, 0.01, 'cursor no meio');
  const x2 = roda([{ ref: 'J1', comment: 'JUMPER', pinos: [pin(1, '1', '+5V'), pin(2, '2', 'L')] }, { ref: 'R1', valor: '1k', pinos: [pin(1, '1', 'L'), pin(2, '2', 'GND')] }], { chaves: { J1: true } });
  perto(x2.r.v.L, 5, 0.01, 'jumper fechado pela config');
});

/* ------------------------------------------------------------------ 5. contas e alertas */
caso('contas: Ohm com sentido, potência acima da nominal pelo footprint, GPIO', () => {
  const x = roda([
    { ref: 'R1', valor: '10R', footprint: 'RES 0603', pinos: [pin(1, '1', 'GND'), pin(2, '2', '+5V')] },
    { ref: 'U1', comment: 'ESP32-WROOM-32', pinos: [pin(2, '3V3', '+3.3V'), pin(1, 'GND', 'GND'), pin(25, 'IO2', 'L'), pin(26, 'IO4', 'IN')] },
    { ref: 'R2', valor: '330', pinos: [pin(1, '1', 'L'), pin(2, '2', 'A')] }, { ref: 'LD1', comment: 'VERMELHO', pinos: [pin('A', 'A', 'A'), pin('K', 'K', 'GND')] },
    { ref: 'R3', valor: '10k', pinos: [pin(1, '1', '+3.3V'), pin(2, '2', 'IN')] }], { gpio: { 'U1-25': { modo: 'alto' } } });
  const r1 = x.an.comps.R1;
  assert.ok(r1.linhas.some(l => l.t === 'Sentido' && /\+5V → GND/.test(l.r)), 'sentido: ' + JSON.stringify(r1.linhas));
  assert.ok(r1.alertas.some(a => /ACIMA da potência nominal/.test(a)), '2,5 W num 0603');
  assert.ok(x.an.comps.LD1.brilho > 0.15, 'o GPIO alto acende o LED: (3,3 − 1,9)/360 Ω ≈ 3,9 mA');
  assert.ok(/lê 1/.test(x.an.pinos['U1-26'].papel), 'a entrada com pull-up lê 1: ' + x.an.pinos['U1-26'].papel);
  assert.ok(/alimentação .*✓/.test(x.an.pinos['U1-2'].papel), x.an.pinos['U1-2'].papel);
  perto(x.an.pinos['U1-2'].i, 0.08, 0.01, 'consumo do ESP32 no pino 3V3');
});

caso('entradas pelos conectores e a verificação do esperado (sim_testar)', () => {
  const comps = [
    { ref: 'J1', comment: 'ENTRADA', pinos: [pin(1, '1', 'ENT'), pin(2, '2', 'GND')] },
    { ref: 'R1', valor: '470', pinos: [pin(1, '1', 'ENT'), pin(2, '2', 'A')] }, { ref: 'LD1', comment: 'VERMELHO', pinos: [pin('A', 'A', 'A'), pin('K', 'K', 'GND')] },
    { ref: 'R2', valor: '10k', pinos: [pin(1, '1', 'ENT'), pin(2, '2', 'S')] }, { ref: 'R3', valor: '10k', pinos: [pin(1, '1', 'S'), pin(2, '2', 'GND')] },
    { ref: 'J2', comment: 'SAIDA', pinos: [pin(1, '1', 'S'), pin(2, '2', 'GND')] },
  ];
  const f = C.entradasParaFontes(comps, { 'J1-1': 12 });
  assert.deepStrictEqual(Object.keys(f), ['ENT']);
  assert.throws(() => C.entradasParaFontes(comps, { 'J9-1': 5 }), /não é pino/);
  const x = roda(comps, { fontes: f });
  const r = C.verifica(x.an, [{ alvo: 'J2-1', esperado: 6 }, { alvo: 'S', min: 5.9, max: 6.1 }, { alvo: 'LD1', grandeza: 'i', max: 0.02 }, { alvo: 'R1', grandeza: 'p', max: 0.25 }, { alvo: 'X9' }]);
  assert.ok(r[0].ok && r[1].ok, 'divisor na saída J2: ' + JSON.stringify(r.slice(0, 2)));
  assert.ok(!r[2].ok && /acima do máximo/.test(r[2].motivo), 'LED com 21 mA passa do máximo: ' + JSON.stringify(r[2]));
  assert.ok(r[3].ok, 'R1 dissipa ~0,2 W');
  assert.ok(!r[4].ok && /não achei/.test(r[4].motivo));
  const sem = roda(comps, {});
  assert.ok(!sem.mt.fontes.some(q => q.net === 'ENT'), 'sem a entrada aplicada a net fica aberta');
});

caso('GPIO pelo número (NexoCode), PWM chaveado e o motor da bancada', () => {
  assert.deepStrictEqual(['IO25', 'GPIO26', 'IO34/ADC1_6', 'SENSOR_VP', 'TXD0', 'EN', '3V3'].map(C.gpioDe), [25, 26, 34, 36, 1, null, null]);
  const comps = [
    { ref: 'U1', comment: 'ESP32-WROOM-32D', pinos: [pin(2, '3V3', '+3V3'), pin(1, 'GND', 'GND'), pin(10, 'IO25', 'PWM')] },
    { ref: 'R1', valor: '100', pinos: [pin(1, '1', 'PWM'), pin(2, '2', 'G')] }, { ref: 'R2', valor: '100k', pinos: [pin(1, '1', 'G'), pin(2, '2', 'GND')] },
    { ref: 'Q1', comment: 'AO3400', pinos: [pin(1, 'G', 'G'), pin(2, 'D', 'M-'), pin(3, 'S', 'GND')] },
    { ref: 'D1', comment: 'SS14', pinos: [pin(1, 'A', 'M-'), pin(2, 'K', '+5V')] }];
  const rpm = duty => {
    const g = { 'U1-10': { modo: 'pwm', duty, f: 20000 } };
    const mt = C.monta(comps, { gpio: g, externos: [{ ref: 'M1', tipo: 'motor_dc', nos: ['+5V', 'M-'], eletrico: { r_ohm: 2.5, kv_rpm_v: 2500, i0_a: 0.15 } }] });
    const s = M.cria(mt.elementos, { terra: mt.terra, dt: 4e-3 }); s.liga();
    let r; for (let k = 0; k < 300; k++) r = s.passo(1);
    return C.analisa(mt, r).comps.M1.rpm;
  };
  const a = rpm(0.3), b = rpm(0.6), c = rpm(1);
  assert.ok(a < b && b < c, 'a rotação sobe com o duty: ' + [a, b, c].map(Math.round));
  perto(c, 5 * 2500 * 0.93, 900, 'duty 100 %');
  const mt = C.monta([], { externos: [{ ref: 'M1', tipo: 'motor_dc', nos: ['A', 'GND'], eletrico: {} }, { ref: 'PS1', tipo: 'fonte', nos: ['A', 'GND'], eletrico: { v: 6 } }] });
  const s = M.cria(mt.elementos, { terra: mt.terra, dt: 5e-3 });
  perto(C.analisa(mt, s.dc()).comps.M1.rpm, 14100, 300, 'regime a 6 V');
  s.liga(); for (let k = 0; k < 10; k++) s.passo(1);
  const r50 = mt.comps.get('M1').w * 60 / (2 * Math.PI);
  assert.ok(r50 > 5000 && r50 < 13000, 'em 50 ms ainda acelerando: ' + Math.round(r50));
});
caso('datasheet no componente: chave, apelido e gravar/ler (Libs/componentes-dados.json)', async () => {
  assert.strictEqual(C.chaveDados({ comment: 'ESP32-WROOM-32D' }, 'mcu'), 'ESP32-WROOM-32D');
  assert.strictEqual(C.chaveDados({ comment: '10k' }, 'resistor'), null);
  const banco = { componentes: { 'ESP32-WROOM-32': { pinos: { 2: { nome: '3V3' } } }, 'AMS1117-3.3': { apelidos: ['LM1117MP-3.3NOPB'] } } };
  assert.strictEqual(C.dadosDe(banco, { comment: 'ESP32-WROOM-32D' }, 'mcu').chave, 'ESP32-WROOM-32', 'pelo começo');
  assert.strictEqual(C.dadosDe(banco, { comment: 'LM1117MP-3.3NOPB' }, 'regulador').chave, 'AMS1117-3.3', 'pelo apelido');
  const raiz = fs.mkdtempSync(path.join(require('os').tmpdir(), 'simds-'));
  const ctx = { root: raiz, grava: (abs, t) => { fs.writeFileSync(abs, t); return true; } };
  const g = require('../mcp/ferramentas/simulador.js').ferramentas;
  const gravar = g.find(t => t.nome === 'sim_datasheet_gravar'), ler = g.find(t => t.nome === 'sim_datasheet_ler');
  await gravar.executa({ chave: 'ao3400', resumo: 'MOSFET N 30 V', pinos: { 1: { nome: 'G', tipo: 'entrada', funcao: 'gate' } } }, ctx);
  await gravar.executa({ chave: 'AO3400', pinos: { 3: { nome: 'D', tipo: 'saida' } }, apelidos: ['AO3400A'] }, ctx);
  const r = await ler.executa({ chave: 'AO3400' }, ctx);
  assert.ok(r.dados && r.dados.resumo === 'MOSFET N 30 V' && r.dados.pinos['1'].funcao === 'gate' && r.dados.pinos['3'].nome === 'D', 'completa sem perder: ' + JSON.stringify(r));
  assert.ok(fs.existsSync(path.join(raiz, 'Libs', 'componentes-dados.json')));
});

/* ------------------------------------------------------------------ 6. a corrente nas trilhas */
caso('trilhas: Kirchhoff no cobre e R = ρ·L/(w·t)', () => {
  const eb = {
    components: [
      { ref: 'J1', pads: [{ id: 'a', name: '1', net: 'N', layer: 'Top', x: 0, y: 0, w: 1, h: 1 }] },
      { ref: 'R1', pads: [{ id: 'b', name: '1', net: 'N', layer: 'Top', x: 10, y: 0, w: 1, h: 1 }] },
      { ref: 'R2', pads: [{ id: 'c', name: '1', net: 'N', layer: 'Bottom', x: 10, y: 10, w: 1, h: 1 }] },
    ],
    tracks: [
      { id: 't1', net: 'N', layer: 'Top', x1: 0, y1: 0, x2: 10, y2: 0, w: 0.5 },
      { id: 't2', net: 'N', layer: 'Top', x1: 5, y1: 0, x2: 5, y2: 10, w: 0.25 },
      { id: 't3', net: 'N', layer: 'Bottom', x1: 5, y1: 10, x2: 10, y2: 10, w: 0.25 },
    ],
    vias: [{ id: 'v1', net: 'N', x: 5, y: 10, size: 0.6 }],
  };
  /* J1 entrega 30 mA: 10 vão para o R1 (pela t1) e 20 para o R2 (t1 até o meio, desce a t2, via, t3 no Bottom) */
  const r = P.correntes(eb, { 'J1-1': { i: -0.03 }, 'R1-1': { i: 0.01 }, 'R2-1': { i: 0.02 } }, {});
  const seg = id => r.segs.filter(s => s.trilha === id);
  const t1 = seg('t1');
  assert.strictEqual(t1.length, 2, 'a t1 partida onde a t2 encosta');
  perto(Math.abs(t1[0].i), 0.03, 1e-6, 'primeira metade leva os 30 mA');
  perto(Math.abs(t1[1].i), 0.01, 1e-6, 'segunda metade leva os 10 mA do R1');
  perto(Math.abs(seg('t2')[0].i), 0.02, 1e-6, 't2');
  perto(Math.abs(seg('t3')[0].i), 0.02, 1e-6, 't3 (pela via)');
  perto(seg('t2')[0].r, 1.72e-8 * 10e-3 / (0.25e-3 * 35e-6), 1e-6, 'R da t2');
  assert.ok(seg('t2')[0].dT >= 0 && seg('t2')[0].imax10 > 0.1, 'IPC-2221');
});

/* ------------------------------------------------------------------ 7. o acervo */
caso('as placas do acervo convergem (DC)', () => {
  const { Contexto } = require('../mcp/lib/contexto.js');
  const ctx = new Contexto({ root: RAIZ, log: () => {} });
  let feitas = 0;
  for (const nome of ['PRJ - DI261930', 'PESDA - DI241790', 'SHP2 Digitalizada', 'TCMS_Reader_V2', 'SD - DI251838', 'PRJ-UR-DI261924']) {
    let p; try { p = ctx.projeto(nome); } catch (_e) { continue; }
    if (!fs.existsSync(p.arq('schematic.js'))) continue;
    const s0 = ctx.schematic(p), L = ctx.libsDe(s0), hc = ctx.hc;
    const model = hc.buildSchModel(s0), nets = hc.extractNets(model, L.schlib);
    const x = roda(C.doEsquema(model, L.schlib, nets, hc), {});
    assert.ok(x.r.ok, nome + ' não convergiu: ' + x.r.aviso);
    for (const f of x.an.fontes) assert.ok(Math.abs(f.i) < 3, nome + ': fonte ' + f.net + ' com ' + f.i + ' A (curto?)');
    feitas++;
  }
  assert.ok(feitas >= 3, 'placas simuladas: ' + feitas);
});

/* ------------------------------------------------------------------ 8. MCP */
caso('MCP: grupo sim e as ferramentas pelo arquivo', () => {
  const g = require('../mcp/ferramentas/simulador.js');
  const nomes = g.ferramentas.map(f => f.nome);
  for (const k of ['sim_rodar', 'sim_pinos', 'sim_componente', 'sim_controlar', 'sim_trilhas']) assert.ok(nomes.includes(k), k);
  const { Registro } = require('../mcp/lib/registro.js');
  const reg = new Registro().carregar();
  assert.ok(!reg.erros.length, reg.erros.join('; '));
  assert.ok(reg.porNome.has('sim_rodar'));
});

/* ------------------------------------------------------------------ 9. as vistas e os hubs */
caso('ganchos nas vistas, <script> nas cascas, ação "simulador" nos dois hubs', () => {
  const ler = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
  const sch = ler('schframe.js');
  assert.ok(/window\.__hubSimVista = \{/.test(sch) && /HubSimulador\.desenha\(ctx, cam\)/.test(sch) && /HubSimulador\.mudou\(\)/.test(sch), 'schframe.js');
  assert.ok(/hub-simulador-motor\.js.*hub-simulador-circuito\.js.*hub-simulador\.js/.test(ler('schframe.html')), 'schframe.html');
  assert.ok(/window\.__hubPcbSim = \{/.test(ler('pcbframe.js')), 'pcbframe.js');
  assert.ok(/hub-simulador-motor\.js.*hub-simulador-pcb\.js/.test(ler('pcbframe.html')), 'pcbframe.html');
  assert.ok(/extra\(nome, ob\)/.test(ler('hub-pcb3d-vista.js')) && /anima\(fn\)/.test(ler('hub-pcb3d-vista.js')), '3D: extra/anima');
  assert.ok(/'simulador'/.test(ler('mcp/rotas_hub.py')), 'rotas_hub.py');
  assert.ok(/"simulador"/.test(ler('rust/crates/nexo-hub/src/mcp.rs')), 'nexo-hub (Rust)');
  assert.ok(/case 'simulador'/.test(ler('mcp/hub-mcpvista.js')), 'hub-mcpvista.js');
  const hub = ler('hub.html');
  assert.ok(/\{ id:'sim', key:'tab\.sim' \}/.test(hub) && /data-pane="sim"/.test(hub) && /HubSimAba\.pane/.test(hub) && /hub-simulador-aba\.js/.test(hub), 'a aba Simulador no hub.html');
  assert.ok((ler('hub-i18n.js').match(/'tab\.sim':/g) || []).length === 2, 'tab.sim em pt e en');
  const aba = ler('hub-simulador-aba.js');
  assert.ok(/modo=sim'/.test(aba) && /\['sim2d', '2D'\]/.test(aba) && /\['sim3d', '3D'\]/.test(aba) && !/\['bancada', 'Bancada'\]/.test(aba), 'os modos da aba: Esquema, 2D, 3D (o 3D é a bancada)');
  assert.ok(/ativa\(m === 'bancada' \|\| m === 'sim3d'\)/.test(ler('hub-simulador-pcb.js')) && /salvo0 === 'bancada' \? 'sim3d'/.test(aba), 'o 3D liga a bancada; o modo Bancada gravado vira o 3D');
  assert.ok(/window\.__simVisual/.test(sch) && /window\.__simVisual/.test(ler('hub-simulador.js')), 'a folha escura sem template/textos');
  assert.ok(/HubSimPcb2d/.test(ler('pcbframe.js')), 'a camada elétrica no 2D');
  assert.ok(/hub-bancada\.js/.test(ler('pcbframe.html')) && /animaExtra/.test(ler('hub-pcb3d-vista.js')) && /modeloStep/.test(ler('hub-pcb3d-vista.js')), 'a bancada no 3D');
  assert.ok(/o\['bancada'\] = at\['bancada'\]/.test(ler('tools/rotas/nexocad.py')), 'o índice da biblioteca passa atributos.bancada');
  assert.ok(/case 'gpio_lote'/.test(ler('hub-simulador.js')) && /\? 120 :/.test(ler('mcp/hub-mcpvista.js')), 'o NexoCode: gpio_lote e a vista perguntando a cada 120 ms');
  for (const k of ['sim_conectores', 'sim_testar', 'sim_datasheet_pendentes', 'sim_datasheet_gravar', 'sim_datasheet_ler', 'sim_bancada']) assert.ok(require('../mcp/ferramentas/simulador.js').ferramentas.some(t => t.nome === k), k);
});

caso('1.102.1: média na tela, Analisar (lista/osciloscópio), acionar do NexoCode, bancada com seleção, skill do 3D', () => {
  const ler = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
  const sim = ler('hub-simulador.js'), pcb = ler('hub-simulador-pcb.js'), banc = ler('hub-bancada.js');
  assert.ok(/st\.acc = null; st\.vis = null;   \/\/ a media e do circuito montado/.test(sim), 'remontar descarta a media velha (o gpio_lote do NexoCode dava "reading map")');
  assert.ok(/u\.el\.hidden = true;/.test(pcb) && /function alternaBalaoTrilha/.test(pcb) && /b\.contas/.test(pcb) && /contas: false/.test(pcb), 'PCB: sem o painel na aba; balão no clique da trilha, contas fechadas');
  assert.ok(/motores\[ref\] = \{ rpm:/.test(sim) && /out\.tensao = vm; out\.kv = info\.kv;/.test(ler('hub-simulador-circuito.js')), 'gpio_lote devolve os motores da bancada (o painel do motor do NexoCode)');
  assert.ok(/__nexoSimAba\[pj\] = window/.test(sim) && /if \(w\) return w\.HubSimulador\.mcp\(a\)/.test(sim) && /if \(abaDoProjeto\(\)\) return;/.test(sim), 'uma simulação por projeto: o Esquema passa os pedidos para a aba Simulador');
  assert.ok(/function resParaMostrar\(\)/.test(sim) && /acumula\(\);/.test(sim) && /st\.sim\.anda\(1\)/.test(sim), 'a média dos passos (o PWM não pisca) e um passo de cada vez');
  assert.ok(/case 'analisar':/.test(sim) && /'📈 Osciloscópio'/.test(sim) && !/dica\.mostra\(h, e\)/.test(sim), 'Analisar no clique, sem balão no mouse');
  assert.ok(/tensoes: false/.test(sim) && /if \(!j\.v2\) st\.mostrar\.tensoes = false/.test(sim), 'as pílulas de tensão começam desligadas');
  assert.ok(/a\.acionar/.test(sim) && /APERTADO \(NexoCode\)/.test(sim), 'gpio_lote acionar: o botão do NexoCode aperta a chave');
  assert.ok(/__nexoSimSerie/.test(sim) && /__nexoSimSerie/.test(pcb) && /data-m="osc"/.test(pcb) && /localStorage\.getItem\('nexoSim\.baloes'\) === '1'/.test(pcb), 'PCB: cartão no clique com osciloscópio; balões das trilhas escondidos');
  assert.ok(/bancada_mover/.test(banc) && /function apagarSel/.test(banc) && /function girarSel/.test(banc), 'a bancada: selecionar, mover, girar e apagar');
  const sk = require('../mcp/lib/skills.js').ler('projeto-construir');
  assert.ok(sk && /cubo/.test(sk.corpo) && /nexo_editar_modelo/.test(sk.corpo) && /fp_3d_importar/.test(sk.corpo), 'a skill projeto-construir com a regra do 3D');
  const ctrl = require('../mcp/ferramentas/simulador.js').ferramentas.find(t => t.nome === 'sim_controlar');
  assert.ok(ctrl.entrada.properties.acao.enum.includes('analisar'), 'sim_controlar analisar');
});

caso('1.103.1: leve — PWM com motor sem a busca em linha travar, anda/soma/média = passo, orçamento do quadro, osciloscópio da simulação ligada', () => {
  const comps = [
    { ref: 'U1', comment: 'ESP32-WROOM-32D', pinos: [pin(2, '3V3', '+3V3'), pin(1, 'GND', 'GND'), pin(10, 'IO25', 'PWM')] },
    { ref: 'R1', valor: '100', pinos: [pin(1, '1', 'PWM'), pin(2, '2', 'G')] }, { ref: 'R2', valor: '100k', pinos: [pin(1, '1', 'G'), pin(2, '2', 'GND')] },
    { ref: 'Q1', comment: 'AO3400', pinos: [pin(1, 'G', 'G'), pin(2, 'D', 'M-'), pin(3, 'S', 'GND')] },
    { ref: 'D1', comment: 'SS14', pinos: [pin(1, 'A', 'M-'), pin(2, 'K', '+5V')] }];
  const monta = () => {
    const mt = C.monta(comps, { gpio: { 'U1-10': { modo: 'pwm', duty: 0.6, f: 20000 } }, externos: [{ ref: 'M1', tipo: 'motor_dc', nos: ['+5V', 'M-'], eletrico: { r_ohm: 2.5, kv_rpm_v: 2500, i0_a: 0.15 } }] });
    const s = M.cria(mt.elementos, { terra: mt.terra, dt: 1 / 1440 }); s.liga();
    return { mt, s };
  };
  /* o MOSFET do PWM desliga a cada poucos passos e a corrente do motor passa para o diodo: antes eram ~100 iterações
     de Newton por passo (a busca em linha andava de 1/64 em 1/64 e caía na continuação) */
  const a = monta();
  let it = 0;
  for (let k = 0; k < 400; k++) { a.s.anda(1); it += a.s.iter; assert.ok(a.s.ok, 'passo ' + k + ' convergiu'); }
  assert.ok(it / 400 < 20, 'iterações por passo com PWM e motor: ' + (it / 400).toFixed(1));
  /* anda + soma + media dá o mesmo que passo(1) somado à mão (a tela mostra a média sem montar o resultado a cada passo) */
  const b = monta(), c = monta();
  const acc = b.s.somador();
  const somaV = {}, somaP = []; let n = 0;
  for (let k = 0; k < 120; k++) {
    b.s.anda(1); b.s.soma(acc);
    const r = c.s.passo(1); n++;
    for (const q in r.v) somaV[q] = (somaV[q] || 0) + r.v[q];
    r.el.forEach((e, j) => { somaP[j] = (somaP[j] || 0) + e.p; });
  }
  const med = b.s.media(acc);
  for (const q of ['M-', 'G', 'PWM']) perto(med.v[q], somaV[q] / n, 1e-9, 'média de ' + q);
  /* os elementos com estado (o pino do PWM vira o _on, o motor anda a rotação) DEPOIS do passo: o resultado() recalcula
     com o estado novo e a soma usa a corrente que o Newton resolveu — so os sem estado batem um a um */
  med.el.forEach((e, j) => { if (!b.s.elementos[j].atualiza) perto(e.p, somaP[j] / n, 1e-6 + Math.abs(somaP[j] / n) * 1e-6, 'potência média de ' + (e.ref || e.papel)); });
  perto(b.s.t, c.s.t, 1e-12, 'o mesmo tempo');
  b.s.zera(acc); assert.strictEqual(acc.n, 0);
  /* a tela: o orçamento do quadro, a soma no motor, o osciloscópio registrado pela simulação ligada, posições só quando mudam */
  const ler = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
  const sim = ler('hub-simulador.js'), pcb = ler('hub-simulador-pcb.js'), pec = ler('hub-simulador-pecas.js');
  assert.ok(/const orc = dtReal > 0\.024 \? 4 : 7;/.test(sim) && /performance\.now\(\) - t0 < orc/.test(sim), 'orçamento de ~7 ms por quadro');
  assert.ok(/if \(andou\) st\.res = st\.sim\.resultado\(\);/.test(sim), 'um resultado por quadro');
  assert.ok(/analise\.tomaSerie\(\)/.test(sim) && /_ligado: \(\) => st\.ligado/.test(sim), 'o osciloscópio do pad lê a simulação ligada');
  assert.ok(/if \(chave === chaveB && svgB\.childNodes\.length\) return;/.test(pcb) && /if \(chave === chaveP\) return;/.test(pec), 'balões e peças só se mexem quando algo mudou');
});
caso('1.109.0: alterar valor e parâmetros; o LED/resistor queima e abre (vermelho com fumaça)', () => {
  const comps = [
    { ref: 'R1', valor: '330', footprint: 'R0603', pinos: [pin(1, '1', '+5V'), pin(2, '2', 'A')] },
    { ref: 'LD1', comment: 'LED VERDE', pinos: [pin(1, 'A', 'A'), pin(2, 'K', 'GND')] }];
  const roda2 = cfg => { const mt = C.monta(comps, cfg); const s = M.cria(mt.elementos, { terra: mt.terra }); return C.analisa(mt, s.dc()).comps; };
  const a = roda2({});
  assert.ok(a.LD1.corrente > 0.005 && a.LD1.corrente < 0.012, 'com 330 Ω o LED acende: ' + a.LD1.corrente);
  perto(a.LD1.imax, 0.02, 1e-12, 'corrente nominal padrão');
  const b = roda2({ valores: { R1: '10' } });
  assert.ok(b.LD1.corrente > 0.045, 'com 10 Ω passa da máxima (queimaria): ' + b.LD1.corrente);
  const c = roda2({ valores: { R1: '10' }, queimados: { LD1: 'corrente alta' } });
  assert.ok(c.LD1.queimado && c.LD1.corrente === 0 && c.LD1.brilho === 0 && /QUEIMADO/.test(c.LD1.alertas[0]), 'queimado: abre, não acende');
  assert.ok(Math.abs(c.R1.corrente || 0) < 1e-6, 'com o LED aberto não passa corrente no R1');
  const d = roda2({ params: { LD1: { vf: 3.0, imax: 0.02 } } });
  assert.ok(d.LD1.corrente < a.LD1.corrente, 'Vf maior, corrente menor: ' + d.LD1.corrente + ' < ' + a.LD1.corrente);
  perto(d.LD1.imax, 0.02, 1e-12, 'a corrente máxima editada');
  const ler = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
  const sim = ler('hub-simulador.js'), pcb = ler('hub-simulador-pcb.js');
  assert.ok(/function verificaQueima\(\)/.test(sim) && /\* 1\.5\) motivo = 'corrente de '/.test(sim) && /inf\.potencia \* 2\) motivo = 'dissipou '/.test(sim), 'a queima: LED > 1,5× a nominal, resistor > 2× a nominal');
  assert.ok(/case 'parametros':/.test(sim) && /case 'trocar':/.test(sim) && /Tensão de ativação \(Vf\)/.test(sim), 'editar pelo menu e pelo MCP; trocar');
  assert.ok(/O QUEIMADO: vermelho com fumaca/.test(sim) && /O QUEIMADO NO 3D/.test(pcb) && /o QUEIMADO no 2D/.test(pcb), 'vermelho com fumaça no esquema, no 3D e no 2D');
  assert.ok(/function edicaoDoComp\(ref, sc, fixo\)/.test(pcb) && /acao: 'trocar', ref/.test(pcb), 'editar e trocar pelo balão da placa');
});
caso('1.108.0: o LED aceso brilha no 3D e no 2D; o balão padrão (tipo, net, tensão no meio, lib, cor do LED)', () => {
  const ler = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
  const pcb = ler('hub-simulador-pcb.js'), sim = ler('hub-simulador.js');
  assert.ok(/tipo: inf\.tipo \|\| '', lib: String\(cp\.comment/.test(sim) && /titulo: c\.titulo \|\| inf\.rotulo \|\| '', vdd,/.test(sim), 'o Esquema publica tipo, lib e Vdd');
  assert.ok(/new T\.Sprite\(new T\.SpriteMaterial\(\{ map: texturaBrilho\(T\)/.test(pcb) && /blending: T\.AdditiveBlending/.test(pcb), 'o brilho do LED no 3D');
  assert.ok(/o LED aceso tambem no 2D/i.test(pcb), 'o brilho do LED no 2D');
  assert.ok(/function caixaBalao\(o\)/.test(pcb) && /\.bx \.vv\.off\{color:#4b5563\} \.bx \.vv\.on\{color:#ff2d2d/.test(pcb), 'a tensão no meio: cinza em 0 V, vermelho energizado');
  assert.ok((pcb.match(/caixaBalao\(\{/g) || []).length >= 3, 'o mesmo padrão no pino, na trilha e no MCU');
  assert.ok(/\['#34c759', 'verde'\]/.test(pcb) && /'<div class="cr" style="color:'/.test(pcb), 'a cor do LED escrita na cor dele');
  assert.ok(/if \(o\.lib && !libRepete\)/.test(pcb) && /: '0 A'\]\] : \[\],/.test(pcb) && /' \(consumo\)'/.test(pcb), '1.108.1: a cor não repete e a corrente sempre aparece');
});
caso('1.107.0: o + sai do conector e o GND volta para ele (sentido certo); cores; nada do simulador no esquema principal', () => {
  /* a fonte da simulacao e ideal (sem pad): o que os pinos nao fecham entra/sai pelo pad do CONECTOR da net */
  const eb = {
    components: [
      { ref: 'J1', pads: [{ id: 'j1', name: '1', net: '+5V', layer: 'Top', x: 0, y: 0, w: 1, h: 1 }, { id: 'j2', name: '2', net: 'GND', layer: 'Top', x: 0, y: 10, w: 1, h: 1 }] },
      { ref: 'R1', pads: [{ id: 'r1', name: '1', net: '+5V', layer: 'Top', x: 20, y: 0, w: 1, h: 1 }, { id: 'r2', name: '2', net: 'GND', layer: 'Top', x: 20, y: 10, w: 1, h: 1 }] },
      { ref: 'R2', pads: [{ id: 'q1', name: '1', net: '+5V', layer: 'Top', x: 10, y: 0, w: 1, h: 1 }, { id: 'q2', name: '2', net: 'GND', layer: 'Top', x: 10, y: 10, w: 1, h: 1 }] },
    ],
    tracks: [
      { id: 'p', net: '+5V', layer: 'Top', x1: 0, y1: 0, x2: 20, y2: 0, w: 0.5 },
      { id: 'g', net: 'GND', layer: 'Top', x1: 0, y1: 10, x2: 20, y2: 10, w: 0.5 },
    ],
  };
  /* R1 puxa 30 mA e R2 10 mA; o J1 (sem modelo) nao tem corrente no pino */
  const r = P.correntes(eb, { 'J1-1': { i: 0 }, 'J1-2': { i: 0 }, 'R1-1': { i: 0.03 }, 'R1-2': { i: -0.03 }, 'R2-1': { i: 0.01 }, 'R2-2': { i: -0.01 } }, {});
  const seg = (id, x) => r.segs.find(s => s.trilha === id && Math.min(s.x1, s.x2) <= x && Math.max(s.x1, s.x2) >= x);
  const sentido = s => Math.sign(s.i) * Math.sign(s.x2 - s.x1);   // +1 = para a direita (para longe do J1)
  assert.strictEqual(sentido(seg('p', 5)), 1, 'no + a corrente sai do conector');
  assert.strictEqual(sentido(seg('g', 5)), -1, 'no GND a corrente volta para o conector');
  perto(Math.abs(seg('p', 5).i), 0.04, 1e-6, 'perto do J1 passam os 40 mA'); perto(Math.abs(seg('p', 15).i), 0.03, 1e-6, 'depois do R2, 30 mA');
  const ler = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
  const pcb = ler('hub-simulador-pcb.js'), sim = ler('hub-simulador.js'), nc = ler('hub-nexocode.js');
  assert.ok(/color: gnd \? 0x050505 : 0xfacc15/.test(pcb) && /terra\.has\(a\.s\.net\) \? cBranco : cVerm/.test(pcb) && /ctx\.fillStyle = terra\.has\(s\.net\) \? '#ffffff' : '#ef4444';/.test(pcb), 'PCB: + amarelo com a corrente vermelha, GND preto com a corrente branca');
  assert.ok(/ctx\.strokeStyle = gnd \? '#050505'/.test(sim) && /terra\.has\(s\.net\) \? '#ffffff' : '#facc15'/.test(sim) && /terra: \(st\.mt && st\.mt\.terra\) \|\| \[\]/.test(sim), 'esquema do Simulador: GND preto com a corrente branca');
  assert.ok(/if \(!st\.aba\) return true;\s*botao\.poe\(\);/.test(sim) && /const st = \{ ligado: naAba, calc: true,/.test(pcb), 'fora da aba Simulador: sem botão, sem clique, sem camada');
  assert.ok(/function montaBotao\(\)\{[\s\S]{0,300}return;/.test(nc) && /window\.HubNexoCode\.abrir\(\)/.test(sim), 'o NexoCODE só na barra da aba Simulador');
  assert.ok(/sem_simulador: true/.test(sim), 'o batimento do NexoCode não abre a aba');
});
caso('1.106.0: "Desconectado" no balão do MCU conecta: abre no NexoCode o firmware ligado ao projeto e roda', () => {
  const ler = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
  const pcb = ler('hub-simulador-pcb.js'), rota = ler('tools/rotas/nexocode.py');
  assert.ok(/<button class="conectar" data-con/.test(pcb) && /fetch\('\/api\/nexocode\/conectar'/.test(pcb), 'o botão chama a rota');
  assert.ok(/@app\.route\('\/api\/nexocode\/conectar', methods=\['POST'\]\)/.test(rota) && /\[exe, '--abrir', pasta\] \+ \(\['--rodar'\] if rodar else \[\]\)/.test(rota) && /args \+= \['--mcu', str\(mcu\)\]/.test(rota) && /args \+= \['--projeto', str\(projeto\)\]/.test(rota), 'a rota abre o NexoCode na pasta com --rodar');
  assert.ok(/def pasta_ligada\(projeto\)/.test(rota) && /'\.nexocode', 'projeto\.json'/.test(rota), 'a pasta pelo vínculo do projeto');
});
caso('1.105.0: o clique no microcontrolador na PCB 2D/3D mostra se o NexoCode está conectado', () => {
  const ler = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
  const sim = ler('hub-simulador.js'), pcb = ler('hub-simulador-pcb.js');
  assert.ok(/mcus: Object\.fromEntries\(/.test(sim) && /conectado: !!n, rodando: !!\(n && n\.rodando\)/.test(sim), 'o Esquema publica os MCUs e a conexão do NexoCode');
  assert.ok(/function mcuEm\(ev\)/.test(pcb) && /function alternaBalaoMcu\(hit\)/.test(pcb) && /return dentro \? \{ tipo: 'mcu', mcu: mc \} : \{ tipo: 'pad', pad: p \};/.test(pcb) && /if \(a\.tipo === 'mcu'\) alternaBalaoMcu\(a\.mcu\);/.test(pcb), 'o clique no corpo do MCU (e no pad de dentro dele) abre o balão');
  assert.ok(/✕ Desconectado/.test(pcb) && /● Conectado ao NexoCode/.test(pcb) && /if \(b\.mcu\) pintaBalaoMcu\(b\)/.test(pcb), 'desconectado/conectado, atualizado com a simulação');
});
caso('1.104.0: só 2D e 3D — o 3D é a bancada, e as peças do NexoCode (Wokwi) ficam sobre a mesa', () => {
  const ler = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
  const pec = ler('hub-simulador-pecas.js'), banc = ler('hub-bancada.js');
  assert.ok(/ativo: \(\) => st\.ativo && !!st\.raiz, mesaZ: \(\) => st\.mesaZ/.test(banc), 'a bancada diz se está ligada e a altura da mesa');
  assert.ok(/function bancadaLigada\(\)/.test(pec) && /function ancoraMesa\(id\)/.test(pec) && /return ancoraMesa\(id\);/.test(pec), 'a peça sem componente na placa vai para a mesa no 3D');
  assert.ok(/'nexoPecas\.mesa\.' \+ PROJ/.test(pec) && /function arrastoNaMesa/.test(pec) && /if \(hd\.dataset\.arrastou\) return;/.test(pec), 'arrastar pela mesa grava o lugar; o clique sem arrastar recolhe');
  assert.ok(/p\.net === net/.test(pec) && /'stroke-dasharray': '7 4'/.test(pec), 'o fio até o pad da net da peça');
  assert.ok(/document\.querySelectorAll\('\.banc'\)/.test(pec), 'o cartão não fica atrás do painel da Bancada');
});
caso('1.103.0: as peças vivas do Wokwi (NexoCode → gpio_lote.pecas) no Simulador, e as entradas de volta', () => {
  const ler = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
  const pc = ler('hub-simulador-pecas.js');
  assert.ok(/hub-simulador-pecas\.js/.test(ler('schframe.html')) && /hub-simulador-pecas\.js/.test(ler('pcbframe.html')), 'o script nas duas vistas');
  assert.ok(fs.existsSync(path.join(RAIZ, 'vendor/wokwi/wokwi-elements.bundle.min.js')) && fs.existsSync(path.join(RAIZ, 'vendor/wokwi/LICENSE')), 'o @wokwi/elements (MIT) com a licença');
  assert.ok(/a\.acao === 'gpio_lote' && a\.pecas/.test(pc) && /r\.pecas_entrada = fila\(\)\.splice\(0\)/.test(pc) && /!\('pecas_entrada' in r\)/.test(pc), 'gpio_lote: recebe pecas e devolve a fila pecas_entrada uma vez');
  assert.ok(/'membrane-keypad' \? \{ id, acao: 'apertar', linha/.test(pc) && /acao: 'girar', valor: 1/.test(pc) && /acao: 'movimento'/.test(pc), 'as entradas no formato do bancada.interagir do NexoCode');
  /* a fila e o estado, sem tela: o contrato do gpio_lote */
  const vm = require('node:vm');
  const H = { mcp: async a => ({ ok: true, eco: a.acao }) };
  const win = { HubSimulador: H, location: { search: '?p=X', pathname: '/schframe.html' }, setInterval, clearInterval, setTimeout, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } }, dispatchEvent() {} };
  win.top = win; win.window = win;
  vm.runInNewContext(pc, Object.assign(win, { URLSearchParams, console }));
  return (async () => {
    await win.HubSimulador.mcp({ acao: 'gpio_lote', gpio: {}, pecas: { U3: { tipo: 'ssd1306', ref: true, png: 'data:x' }, 'net:K': { tipo: 'membrane-keypad', ref: false } } });
    assert.strictEqual(JSON.stringify(Object.keys(win.__nexoPecas.X).sort()), JSON.stringify(['U3', 'net:K']));
    await win.HubSimulador.mcp({ acao: 'peca', id: 'net:K', entrada: { acao: 'apertar', linha: 1, coluna: 2 } });
    const r = await win.HubSimulador.mcp({ acao: 'gpio_lote', gpio: {} });
    assert.strictEqual(JSON.stringify(r.pecas_entrada), JSON.stringify([{ id: 'net:K', acao: 'apertar', linha: 1, coluna: 2 }]));
    const r2 = await win.HubSimulador.mcp({ acao: 'gpio_lote', gpio: {}, pecas: { U3: { remover: true } } });
    assert.strictEqual(JSON.stringify(r2.pecas_entrada), '[]');
    assert.ok(!('U3' in win.__nexoPecas.X), 'remover tira a peça');
    const e = await win.HubSimulador.mcp({ acao: 'pecas' });
    assert.ok(e.pecas['net:K'] && !('png' in e.pecas['net:K']));
  })();
});

caso('1.110.0: no 2D/3D o que o clique vai pegar fica marcado ao passar o mouse (o mesmo teste), pela forma de verdade', () => {
  const pcb = fs.readFileSync(path.join(RAIZ, 'hub-simulador-pcb.js'), 'utf8');
  const fn = nome => { const i = pcb.indexOf('    function ' + nome + '('); const j = pcb.indexOf('\n    }\n', i); assert.ok(i >= 0 && j > i, nome); return pcb.slice(i, j + 6); };
  const ctx = new Function('st', 'padsDaPlaca', 'const TOL_PX = 7;\n' + fn('naFace') + fn('dPad') + fn('padNoPonto') + fn('trilhaNoPonto') + '\nreturn { naFace, dPad, padNoPonto, trilhaNoPonto };');
  const pads = [{ ref: 'U1', nome: '1', x: 0, y: 0, r: 1, camada: 'Top', pad: { w: 2, h: 0.6, rot: 0 } }, { ref: 'U1', nome: '2', x: 0, y: 1.27, r: 1, camada: 'Top', pad: { w: 2, h: 0.6, rot: 0 } }];
  const st = { res: { segs: [{ trilha: 't1', layer: 'Top', x1: -10, y1: 5, x2: 10, y2: 5, w: 2 }] } };
  const G = ctx(st, () => pads);
  assert.strictEqual(G.dPad(pads[0], 0.95, 0.25), 0, 'a ponta do pad comprido está dentro (antes contava só o centro)');
  assert.ok(Math.abs(G.dPad({ x: 0, y: 0, r: 1, pad: { w: 2, h: 0.6, rot: 90 } }, 0, 0.95)) < 1e-9, 'o pad girado');
  assert.strictEqual(G.padNoPonto({ x: 0.9, y: 0.2, esc: 40, lado: 'top' }).p.nome, '1');
  assert.strictEqual(G.padNoPonto({ x: 0.9, y: 0.2, esc: 40, lado: 'bottom' }), null, 'no 3D só a face que a câmera vê');
  assert.ok(G.trilhaNoPonto({ x: 3, y: 5.9, esc: 40, lado: 'top' }).d === 0, 'a borda da trilha larga pega (antes só a linha do meio, 8 px)');
  assert.strictEqual(G.trilhaNoPonto({ x: 3, y: 7, esc: 40, lado: 'top' }), null, 'longe da trilha não pega');
  assert.ok(G.naFace('Multi', 'bottom') && !G.naFace('MidLayer1', 'top') && G.naFace('Bottom', ''), 'as faces');
  assert.ok(/const a = e\.buttons \? null : alvoEm\(e\);/.test(pcb) && /const a = alvoEm\(e\);\n\s+if \(!a\) return false;/.test(pcb), 'o passar do mouse e o clique usam o mesmo alvoEm');
  assert.ok(/V\.extra\('simAlvo', g\)/.test(pcb) && /function marcaAlvo2d\(ctx, px\)/.test(pcb) && /\.simpcb-mira, \.simpcb-mira \*\{cursor:pointer/.test(pcb), 'a marca no 3D e no 2D e a mãozinha');
  assert.ok(/<button class="conectado" data-abre/.test(pcb) && /rodar: !soAbre/.test(pcb), 'o MCU conectado: clicar em Conectado abre o código no NexoCode');
});

(async () => { for (const f of fila) await f();
console.log(falhou ? 'test-simulador: ' + falhou + ' FALHA(S) de ' + (n + falhou) : 'test-simulador: ' + n + ' casos ok');
process.exit(falhou ? 1 : 0); })();
