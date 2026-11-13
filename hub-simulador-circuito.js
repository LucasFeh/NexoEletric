/* NexoEletric - hub-simulador-circuito.js — o ESQUEMA vira CIRCUITO para o simulador (1.101.0).
   Cada componente do esquema (com os pinos e a net de cada pino) e reconhecido pelo designador, pelo comment, pelo
   valor e pelo nome dos pinos, e vira os elementos do motor (hub-simulador-motor.js):
     R resistor · C capacitor (tensao nominal conferida) · L indutor · FB ferrite · F/PTC fusivel (corrente de disparo)
     D diodo, Schottky, zener, TVS, ponte retificadora · LED (cor -> Vf, brilho na tela)
     Q/T transistor NPN/PNP/Darlington (BC547, 2N2222, TIP120...) e MOSFET N/P com diodo de corpo (2N7002, IRF540...)
     U/CI regulador linear (78xx, 79xx, AMS1117, LM317 ADJ...), conversor chaveado (LM2575/2596, MP1584, XL4015,
       MT3608 — modelo medio, com rendimento), microcontrolador (ESP32, STM32, ATmega, RP2040...: alimentacao,
       consumo, GPIO configuravel como saida alta/baixa/PWM/entrada com pull-up), amplificador operacional e
       comparador (LM358, LM324, TL07x, LM393...), 555, optoacoplador (PC817, 4N25), ULN2003/2803, portas logicas
       74xx/40xx, e qualquer outro CI: corrente de repouso entre os pinos de alimentacao e terra
     K rele (bobina + contatos COM/NA/NF) · S/SW chave e botao (clicaveis) · RV/POT potenciometro (roda do mouse)
     BT/BAT bateria · LS/BZ alto-falante e buzzer · M motor · LDR, NTC · J jumper (fechado) · conector: aberto, ou
     fonte quando o comment do pino diz a tensao ("5V ISO") ou quando a pessoa define
   As nets de alimentacao pelo nome (+5V, 3V3, +3.3V, 12V, VCC, VDD, VBAT, -12V...) ganham fonte ideal, a nao ser que
   algum regulador do circuito as produza. Terra: GND, 0V, VSS, AGND, DGND, PGND, GND_ISO... (ou o que a pessoa disser).

   API
     HubSimCircuito.monta(componentes, config) -> {elementos, terra, comps:Map(ref -> info), fontes, avisos, porPino}
       componentes: [{ref, sym, comment, valor, params, footprint, dnp, pinos:[{num, name, net, x?, y?}]}]
       config: {fontes:{net:{v, onda?}}, terra:[net], chaves:{ref:bool}, pots:{ref:0..1}, gpio:{'REF-PINO':
                {modo:'alto'|'baixo'|'pwm'|'entrada'|'pullup'|'pulldown', duty, f}}, valores:{ref:'10k'},
                desligados:[ref], entradaPadrao:12}
     HubSimCircuito.analisa(montado, resultado) -> {pinos:{'REF-PINO':{v, i, net, papel, texto, alerta}},
       comps:{ref:{titulo, linhas:[{t, f, r}], alertas:[], p, brilho?}}, nets:{net:{v, flutuante}}, resumo}
     HubSimCircuito.doEsquema(model, schlib, nets, HubCore) -> componentes (a lista acima) a partir do modelo da vista
     HubSimCircuito.leValor('4K7') -> {v:4700, potencia, tensao}   fmt(v, 'V')  */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.HubSimCircuito = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const VT = 0.025852;
  const lexp = x => x < 90 ? Math.exp(x) : Math.exp(90) * (1 + x - 90);
  const sp = (x, d) => { d = d || 1; const u = x / d; return u > 30 ? x : u < -30 ? d * Math.exp(u) : d * Math.log1p(Math.exp(u)); };
  const sig = x => x > 30 ? 1 : x < -30 ? 0 : 1 / (1 + Math.exp(-x));
  const smin = (a, b, e) => (a + b - Math.sqrt((a - b) * (a - b) + (e || 1e-3) ** 2)) / 2;
  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

  /* ================================================================== numeros e unidades */
  const PREF = { p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9, R: 1, r: 1, E: 1 };
  /* "4K7" "10K 1/4W" "470R" "1R5" "100nF 25V" "0.1uF/50V" "330uH" "2M2" "10 Ω" -> {v, potencia, tensao} */
  function leValor(txt) {
    const s = String(txt == null ? '' : txt).replace(/,/g, '.').trim();
    const out = { v: NaN, potencia: NaN, tensao: NaN, corrente: NaN };
    if (!s || s.charAt(0) === '=') return out;
    const pot = /(\d+)\s*\/\s*(\d+)\s*W\b/i.exec(s) || /(\d+(?:\.\d+)?)\s*(m?)W\b/i.exec(s);
    if (pot) out.potencia = pot[2] && /^\d+$/.test(pot[2]) && pot[0].includes('/') ? +pot[1] / +pot[2] : +pot[1] * (pot[2] === 'm' ? 1e-3 : 1);
    const ten = /(?:^|[\s/_-])(\d+(?:\.\d+)?)\s*V(?:DC|AC)?\b/i.exec(s);
    if (ten) out.tensao = +ten[1];
    const cor = /(\d+(?:\.\d+)?)\s*(m?)A\b/.exec(s);
    if (cor) out.corrente = +cor[1] * (cor[2] ? 1e-3 : 1);
    /* o primeiro token com numero: 4K7, 1R5, 2M2, 10k, 100nF, 0.1uF, 330uH, 10Ω */
    const t = s.split(/[\s/;]+/).find(x => /\d/.test(x) && !/^\d+(?:\.\d+)?V$/i.test(x) && !/W$/i.test(x)) || '';
    let m = /^(\d+)([pnuµμmkKMGRrE])(\d+)/.exec(t);
    if (m) { out.v = parseFloat(m[1] + '.' + m[3]) * PREF[m[2]]; return out; }
    m = /^(\d+(?:\.\d+)?)\s*([pnuµμmkKMG]?)(?:F|H|Ω|OHM|R)?$/i.exec(t.replace(/ohms?$/i, ''));
    if (m) { const p = m[2] ? (m[2] === 'm' && /H$|F$/i.test(t) ? 1e-3 : PREF[m[2]] || 1) : 1; out.v = parseFloat(m[1]) * p; return out; }
    m = /^(\d+(?:\.\d+)?)/.exec(t);
    if (m) out.v = parseFloat(m[1]);
    return out;
  }
  const PREFIXOS = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p']];
  function fmt(v, u, casas) {
    if (v == null || !isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a < 1e-15) return '0 ' + u;
    let p = PREFIXOS.find(([k]) => a >= k * 0.9995) || PREFIXOS[PREFIXOS.length - 1];
    if (u === 'V' && a >= 1e3) p = [1, ''];           // tensao em kV nao aparece aqui
    const n = v / p[0];
    const c = casas != null ? casas : Math.abs(n) >= 100 ? 1 : Math.abs(n) >= 10 ? 2 : 3;
    return n.toFixed(c).replace('.', ',').replace(/,?0+$/, m => m.includes(',') ? '' : m) + ' ' + p[1] + u;
  }

  /* ================================================================== nets: terra e alimentacao */
  const RE_TERRA = /^(?:GND|AGND|DGND|PGND|SGND|GNDA|GNDD|GND\d*|0V|0V\d*|VSS|VSSA|COM|EARTH|CHASSIS|GND[_ -]?ISO\w*|0V[_ -]?ISO\w*|ISO[_ -]?GND|-?VSS)$/;
  /* a tensao que o NOME da net diz: +5V 5V 3V3 +3.3V 12V -12V VCC VDD VBAT VIN VBUS "5V ISO" VCC_3V3 */
  function tensaoDoNome(nome) {
    const n = norm(nome).replace(/\s+/g, '');
    if (!n || RE_TERRA.test(n)) return null;
    let m = /(?:^|[^A-Z0-9])?([+-])?(\d+)V(\d+)(?![0-9])/.exec(n);
    if (m && /(^|[+\-_])\d+V\d+/.test(n)) return (m[1] === '-' ? -1 : 1) * parseFloat(m[2] + '.' + m[3]);
    m = /(?:^|[^A-Z0-9.])([+-]?)(\d+(?:[.,]\d+)?)V(?:[^A-Z0-9]|DC|ISO|$|_|[A-Z]{0,4}$)/.exec(n);
    if (m && /^(?:[+-]?\d|V|\+|-|VCC|VDD|VIN|P\d|PWR)/.test(n.replace(/^NET/, 'X'))) return (m[1] === '-' ? -1 : 1) * parseFloat(m[2].replace(',', '.'));
    /* P12 / N12 / P5 / N15 (a notacao de fonte simetrica), VCC12, 12VDC, VDD_5 */
    m = /^([PN])(\d{1,2})(?:V\d?)?$/.exec(n);
    if (m && +m[2] >= 3 && +m[2] <= 48) return (m[1] === 'N' ? -1 : 1) * +m[2];   // N1, P2 sao nomes de no, nao fonte
    m = /^(?:VCC|VDD|VIN|VS)_?(\d{1,2})(?:V)?$/.exec(n);
    if (m) return +m[1];
    if (/^(?:\+?VCC|VCC\d*|\+VCC)$/.test(n)) return 5;
    if (/^(?:\+?VDD|VDD\d*|VDDIO|IOVDD)$/.test(n)) return 3.3;
    if (/^(?:VBAT|\+?VBATT?|BAT\+?)$/.test(n)) return 3.7;
    if (/^(?:VBUS|USB_?5V|VUSB)$/.test(n)) return 5;
    if (/^(?:VIN|\+?VIN|V_IN|VSUP|VSUPPLY|VPWR|\+?VS)$/.test(n)) return 12;
    return null;
  }

  /* ================================================================== bibliotecas de pecas */
  const DIODOS = [
    [/1N4148|1N914|LL4148|MMSD4148|BAV99|BAS16|BAV21|1N4448/, { is: 2.52e-9, n: 1.75, rs: 0.6, nome: 'sinal' }],
    [/1N400[1-7]|M[1-7]\b|S1[ABDGJKM]\b|RL20|1N540[0-8]|FR10[1-7]|UF400|SMBJ?R?|GS1/, { is: 1.4e-8, n: 1.98, rs: 0.04, nome: 'retificador' }],
    [/1N58(1[7-9]|2[0-2])|SS[1-5][0-9]|SK[1-5][0-9]|BAT(4[0-9]|5[0-9]|8[0-9])|B5819|MBR|SR\d{3}|STPS|PMEG|RB\d{3}|SB\d{3}|SCHOTT/, { is: 3e-6, n: 1.1, rs: 0.03, nome: 'Schottky' }],
  ];
  const ZENER_1N47 = { 28: 3.3, 29: 3.6, 30: 3.9, 31: 4.3, 32: 4.7, 33: 5.1, 34: 5.6, 35: 6.2, 36: 6.8, 37: 7.5, 38: 8.2, 39: 9.1, 40: 10, 41: 11, 42: 12, 43: 13, 44: 15, 45: 16, 46: 18, 47: 20, 48: 22, 49: 24, 50: 27, 51: 30 };
  const CORES_LED = [
    [/VERMELH|RED|\bVM\b/, 1.9, '#ff3b30'], [/LARANJA|ORANGE/, 2.0, '#ff9500'], [/AMAREL|YELLOW|\bAM\b/, 2.0, '#ffd60a'],
    [/VERDE|GREEN|\bVD\b/, 2.1, '#34c759'], [/AZUL|BLUE/, 3.0, '#0a84ff'], [/BRANC|WHITE|\bBR\b/, 3.0, '#f5f5f7'],
    [/\bIR\b|INFRA/, 1.2, '#b0306a'], [/\bUV\b|ULTRA/, 3.3, '#bf5af2'], [/ROSA|PINK/, 3.0, '#ff2d92'],
  ];
  const BJTS = [
    [/TIP12[0-2]|BD67[5-9]|BDX33|MJD122|TIP14[0-2]|BCV27|MMBTA1[34]|MPSA1[34]/, { pol: 1, bf: 1000, is: 1e-12, nf: 2, nome: 'Darlington NPN' }],
    [/TIP12[5-7]|BD67[6-8]|BDX34|MJD127|TIP14[5-7]|MPSA6[34]/, { pol: -1, bf: 1000, is: 1e-12, nf: 2, nome: 'Darlington PNP' }],
    [/BC3[23][78]|BC8[0-1][7-8]?.*|BC54[6-9]|BC81[78]|2N2222|PN2222|MMBT2222|2N3904|MMBT3904|S8050|S9013|S9014|SS8050|BC33[78]|BC63[579]|TIP3[13]|TIP4[13]|BD13[579]|2N4401|2SC|KSC|MJE13|2N5551|BFR|BC847|BC848|BC850|D882|MJE30|2N3055|TIP3055/, { pol: 1, bf: 250, is: 1e-14, nf: 1, nome: 'NPN' }],
    [/BC32[78]|BC80[78]|BC55[6-9]|2N2907|PN2907|MMBT2907|2N3906|MMBT3906|S8550|S9012|S9015|SS8550|BC63[68]|BC640|TIP3[24]|TIP4[24]|BD13[680]|2N4403|2SA|KSA|2N5401|BC857|BC858|BC860|B772|MJE35|MJ2955|TIP2955/, { pol: -1, bf: 250, is: 1e-14, nf: 1, nome: 'PNP' }],
  ];
  const BJT_PNP_FIX = /BC32[78]|BC80[78]|BC55[6-9]|2N2907|2N3906|MMBT3906|S8550|S9012|S9015|BC857|BC858|2N5401|TIP3[24]|TIP4[24]|BD13[680]|2SA|KSA|MJE35/;
  const FETS = [
    [/2N7002|BSS138|BSS123|2N7000|NDS7002|VN2222/, { pol: 1, vth: 1.6, k: 0.3, nome: 'MOSFET N (sinal)' }],
    [/AO340[0-2]|AO3416|SI230[02]|SI2312|IRLML2502|IRLML6344|DMN|FDN3[35]|PMV/, { pol: 1, vth: 0.9, k: 20, nome: 'MOSFET N (nível lógico)' }],
    [/IRLZ|IRLB|IRL5|IRL2|IRL3|IRL7|LR7843|IRLR/, { pol: 1, vth: 1.5, k: 40, nome: 'MOSFET N (nível lógico)' }],
    [/IRF[0-9]{3,4}N?\b|IRFZ|IRFB|IRFP|IRFR|STP\d|FQP\d|IRFS|NTD|AOD4|STD\d/, { pol: 1, vth: 3.0, k: 15, nome: 'MOSFET N' }],
    [/AO340[1-9]|AO3415|SI230[1-9]|IRLML6402|IRLML2244|DMP|FDN3[03][0-9]P|BSS84/, { pol: -1, vth: 0.9, k: 15, nome: 'MOSFET P' }],
    [/IRF9|IRF4905|IRF5305|FQP27P|SPP|STP\d+P/, { pol: -1, vth: 3.0, k: 12, nome: 'MOSFET P' }],
  ];
  /* reguladores lineares: vout fixo ou ADJ (vref entre OUT e ADJ); pinos por nome, senao pela ordem do encapsulamento */
  function reguladorLinear(t) {
    let m = /(?:L|LM|MC|UA|KA|L)?78(?:M|L|S|T)?(\d{2})/.exec(t);
    if (m && /78(?:M|L|S|T)?\d{2}/.test(t)) return { vout: +m[1], vdo: 2.0, iq: 5e-3, ilim: /78L/.test(t) ? 0.1 : /78M/.test(t) ? 0.5 : 1.5, ordem: ['IN', 'GND', 'OUT'], nome: 'regulador linear 78' + m[1] };
    m = /(?:L|LM|MC|UA|KA)?79(?:M|L)?(\d{2})/.exec(t);
    if (m && /79(?:M|L)?\d{2}/.test(t)) return { vout: -m[1], vdo: 2.0, iq: 5e-3, ilim: 1.5, ordem: ['GND', 'IN', 'OUT'], nome: 'regulador negativo 79' + m[1], neg: true };
    if (/LM317|LM1086.*ADJ|1117.*ADJ|LM338|LM350|LD1117.*ADJ/.test(t)) return { adj: 1.25, vdo: /1117|1086/.test(t) ? 1.1 : 2.0, iq: 5e-3, ilim: 1.5, ordem: /1117|1086/.test(t) ? ['ADJ', 'OUT', 'IN'] : ['ADJ', 'OUT', 'IN'], nome: 'regulador ajustável (Vref 1,25 V)' };
    m = /(?:AMS|LM|LD|AP|NCP|TLV|SPX|AZ|HT|MCP|XC|RT|ME|LP|TPS|MIC|LDK|LDL)\s*-?(1117|1086|1084|1085|1585|29150|2950|2985|1700|1702|73\d\d|72\d\d|7333|7350|7533|6206|6219|9193|5205|2992|1801|3985|7302|5150|7330|1803|1702)\s*[-_ ]?\s*(ADJ|\d{2}|\d[.,]\d{1,2})?/.exec(t);
    if (m) {
      let v = m[2] ? m[2].replace(',', '.') : '';
      if (/^\d{2}$/.test(v)) v = v.charAt(0) + '.' + v.charAt(1);
      if (!v && /^7[35]\d\d$|^72\d\d$/.test(m[1])) v = m[1].slice(2, 3) + '.' + m[1].slice(3);
      const vout = parseFloat(v) || (/1117|1086/.test(m[1]) ? 3.3 : 3.3);
      const ldo = !/1117|1086|1084|1085|1585/.test(m[1]);
      return { vout, vdo: ldo ? 0.25 : 1.1, iq: ldo ? 0.1e-3 : 5e-3, ilim: /1117|1086/.test(m[1]) ? 1 : 0.3,
               ordem: /1117|1086|1084|1085|1585/.test(m[1]) ? ['GND', 'OUT', 'IN'] : ['IN', 'GND', 'OUT'], nome: 'regulador ' + (ldo ? 'LDO ' : '') + m[0].trim() };
    }
    return null;
  }
  function conversor(t) {
    let m = /LM257[56](?:HV)?[-\s]?(ADJ|\d{1,2}(?:\.\d)?)?/.exec(t) || /LM259[56][-\s]?(ADJ|\d{1,2}(?:\.\d)?)?/.exec(t) || /LM267[0-9][-\s]?(ADJ|\d{1,2}(?:\.\d)?)?/.exec(t);
    if (m) { const v = m[1] && m[1] !== 'ADJ' ? parseFloat(m[1]) : null;
      return { vfb: v || 1.23, fixo: !!v, vout: v, ordem: ['VIN', 'SW', 'GND', 'FB', 'EN'], enBaixo: true, eta: 0.8, nome: m[0] + ' (buck, modelo médio)' }; }
    if (/MP1584|MP2307|MP2359|MP1482/.test(t)) return { vfb: 0.8, ordem: ['SW', 'EN', 'COMP', 'FB', 'GND', 'FREQ', 'VIN', 'BST'], eta: 0.88, nome: 'buck MP (modelo médio)' };
    if (/XL40(05|15|16)|XL1509|XL4012/.test(t)) return { vfb: 1.25, ordem: ['GND', 'FB', 'SW', 'VIN', 'VIN'], eta: 0.88, nome: 'buck XL (modelo médio)' };
    if (/MT3608|XL6009|XL6019|LM2577|SX1308|B628/.test(t)) return { vfb: /MT3608|SX1308|B628/.test(t) ? 0.6 : 1.25, boost: true, ordem: ['SW', 'GND', 'FB', 'EN', 'VIN', 'NC'], eta: 0.85, nome: 'boost (modelo médio)' };
    if (/TPS54|TPS56|TPS62|AP62|RT8059|SY8089|AOZ|LMR|MP23|TPS5430|LM2675/.test(t)) return { vfb: 0.8, ordem: [], eta: 0.88, nome: 'buck (modelo médio)' };
    return null;
  }
  const MCUS = [
    [/ESP32-?C3|ESP32C3/, { vmin: 3.0, vmax: 3.6, iq: 0.025, nome: 'ESP32-C3' }],
    [/ESP32|ESP-?WROOM-?32|ESP-?WROVER/, { vmin: 3.0, vmax: 3.6, iq: 0.08, nome: 'ESP32' }],
    [/ESP8266|ESP-?12|ESP-?01|ESP-?07/, { vmin: 3.0, vmax: 3.6, iq: 0.07, nome: 'ESP8266' }],
    [/STM32|GD32|AT32|CH32/, { vmin: 2.0, vmax: 3.6, iq: 0.02, nome: 'STM32' }],
    [/ATMEGA\d*U\d|ATMEGA32U4/, { vmin: 2.7, vmax: 5.5, iq: 0.015, nome: 'ATmega USB' }],
    [/ATMEGA|ATTINY|AT90|ATXMEGA/, { vmin: 1.8, vmax: 5.5, iq: 0.008, nome: 'AVR' }],
    [/RP2040|RP2350/, { vmin: 1.8, vmax: 3.6, iq: 0.025, nome: 'RP2040' }],
    [/PIC1[0268]F|PIC24|DSPIC|PIC32/, { vmin: 2.0, vmax: 5.5, iq: 0.005, nome: 'PIC' }],
    [/NRF5[12]|CC2[56]\d\d|EFR32|EFM32|MSP430/, { vmin: 1.8, vmax: 3.6, iq: 0.008, nome: 'MCU baixo consumo' }],
    [/CH340|CP210|FT232|CH9102|PL2303/, { vmin: 3.0, vmax: 5.5, iq: 0.015, nome: 'conversor USB-serial' }],
  ];
  const OPAMPS = [
    [/LM358|LM2904|LM158|LM258|MCP6002|MCP602|TL072|TL082|NE5532|OPA2\d{3}|AD8\d{3}2|LMV358|TLV2372|RC4558|LM833|OP27|TLC272/, { canais: 2, dlo: 0.05, dhi: 1.5, iq: 1e-3 }],
    [/LM324|LM2902|LM124|MCP6004|MCP604|TL074|TL084|LMV324|OPA4\d{3}|TLV2374|LM837/, { canais: 4, dlo: 0.05, dhi: 1.5, iq: 2e-3 }],
    [/LM741|UA741|OP07|TL071|TL081|NE5534|OPA\d{3}(?!\d)|MCP6001|MCP601|LMV321|CA3140|LF351|OPA1\d{2}/, { canais: 1, dlo: 1, dhi: 1.5, iq: 1.7e-3 }],
  ];
  const COMPARADORES = [
    [/LM393|LM2903|LM193|LM293|TLV1702|LMV393/, { canais: 2 }], [/LM339|LM2901|LM139|LMV339/, { canais: 4 }], [/LM311|LM111/, { canais: 1, lm311: true }],
  ];
  const PINAGEM_OPAMP = {
    1: [{ out: 6, n: 2, p: 3 }], 2: [{ out: 1, n: 2, p: 3 }, { out: 7, n: 6, p: 5 }],
    4: [{ out: 1, n: 2, p: 3 }, { out: 7, n: 6, p: 5 }, { out: 8, n: 9, p: 10 }, { out: 14, n: 13, p: 12 }],
  };
  const ALIM_OPAMP = { 1: { vp: 7, vn: 4 }, 2: { vp: 8, vn: 4 }, 4: { vp: 4, vn: 11 } };
  const ALIM_COMP = { 1: { vp: 8, vn: 4 }, 2: { vp: 8, vn: 4 }, 4: { vp: 3, vn: 12 } };
  const PINAGEM_COMP = { 1: [{ out: 7, n: 3, p: 2 }], 2: PINAGEM_OPAMP[2], 4: [{ out: 2, n: 4, p: 5 }, { out: 1, n: 6, p: 7 }, { out: 14, n: 8, p: 9 }, { out: 13, n: 10, p: 11 }] };
  /* portas logicas 74xx / 40xx (14 pinos: VCC 14, GND 7) */
  const PORTAS = {
    '00': { f: 'nand', g: [[1, 2, 3], [4, 5, 6], [9, 10, 8], [12, 13, 11]] }, '08': { f: 'and', g: [[1, 2, 3], [4, 5, 6], [9, 10, 8], [12, 13, 11]] },
    '32': { f: 'or', g: [[1, 2, 3], [4, 5, 6], [9, 10, 8], [12, 13, 11]] }, '86': { f: 'xor', g: [[1, 2, 3], [4, 5, 6], [9, 10, 8], [12, 13, 11]] },
    '02': { f: 'nor', g: [[2, 3, 1], [5, 6, 4], [8, 9, 10], [11, 12, 13]] }, '04': { f: 'not', g: [[1, 2], [3, 4], [5, 6], [9, 8], [11, 10], [13, 12]] },
    '14': { f: 'not', g: [[1, 2], [3, 4], [5, 6], [9, 8], [11, 10], [13, 12]] }, '06': { f: 'not', g: [[1, 2], [3, 4], [5, 6], [9, 8], [11, 10], [13, 12]] },
    '4011': { f: 'nand', g: [[1, 2, 3], [5, 6, 4], [8, 9, 10], [12, 13, 11]] }, '4001': { f: 'nor', g: [[1, 2, 3], [5, 6, 4], [8, 9, 10], [12, 13, 11]] },
    '4069': { f: 'not', g: [[1, 2], [3, 4], [5, 6], [9, 8], [11, 10], [13, 12]] }, '4081': { f: 'and', g: [[1, 2, 3], [5, 6, 4], [8, 9, 10], [12, 13, 11]] },
    '4071': { f: 'or', g: [[1, 2, 3], [5, 6, 4], [8, 9, 10], [12, 13, 11]] }, '4093': { f: 'nand', g: [[1, 2, 3], [5, 6, 4], [8, 9, 10], [12, 13, 11]] },
  };
  /* CI conhecido so pela faixa de alimentacao e consumo (o resto dos pinos fica em alta impedancia) */
  const CIS_ALIM = [
    [/SN65HVD7|SN65HVD1|SP3485|MAX3485|ADM3485|THVD/, { vmin: 3.0, vmax: 3.6, iq: 1e-3, nome: 'transceptor RS-485 3,3 V' }],
    [/MAX485|MAX487|SN75176|ADM485|SP485|MAX13487|RS485/, { vmin: 4.75, vmax: 5.25, iq: 0.5e-3, nome: 'transceptor RS-485 5 V' }],
    [/MAX232|MAX3232|SP3232|ST3232/, { vmin: 3.0, vmax: 5.5, iq: 8e-3, nome: 'transceptor RS-232' }],
    [/MCP2515|MCP2551|TJA105|SN65HVD23|MCP2562|TCAN/, { vmin: 3.0, vmax: 5.5, iq: 10e-3, nome: 'CAN' }],
    [/SCL3300|MPU6050|MPU9250|ADXL|LIS3|BMI\d|BME280|BMP280|SHT[34]|HDC10|AHT[12]/, { vmin: 1.8, vmax: 3.6, iq: 1.2e-3, nome: 'sensor' }],
    [/STWD100|TPS382|MAX6369|TPL5010|ADM809|MAX809|APX803/, { vmin: 1.6, vmax: 5.5, iq: 15e-6, nome: 'supervisor/watchdog' }],
    [/74HC|74AHC|74LVC|CD40|HEF40|MC140/, { vmin: 2.0, vmax: 6.0, iq: 20e-6, nome: 'lógica CMOS' }],
    [/74LS|74F\d|74S\d|SN74LS/, { vmin: 4.75, vmax: 5.25, iq: 5e-3, nome: 'lógica TTL' }],
    [/24C\d|24LC|AT24|W25Q|25Q|AT25|M24/, { vmin: 1.7, vmax: 5.5, iq: 1e-3, nome: 'memória' }],
    [/DS1307|DS3231|PCF8563|RV-?3028/, { vmin: 2.3, vmax: 5.5, iq: 0.2e-3, nome: 'relógio (RTC)' }],
    [/ADS1\d{3}|MCP3\d{3}|HX711|ADS7/, { vmin: 2.0, vmax: 5.5, iq: 0.5e-3, nome: 'conversor A/D' }],
    [/PCF8574|MCP230\d\d|TCA95/, { vmin: 2.5, vmax: 5.5, iq: 0.1e-3, nome: 'expansor de I/O' }],
    [/W5500|ENC28J60|LAN87|KSZ/, { vmin: 3.0, vmax: 3.6, iq: 0.13, nome: 'Ethernet' }],
    [/SIM800|SIM7|A7670|EC2\d|BG9\d/, { vmin: 3.4, vmax: 4.4, iq: 0.1, nome: 'modem celular' }],
    [/L293|L298|DRV88|A4988|TB6612|TMC2\d/, { vmin: 4.5, vmax: 36, iq: 5e-3, nome: 'driver de motor' }],
  ];

  /* ================================================================== componentes -> elementos */
  const PINOS_ALIM = /^(?:VDD\w*|VCC\w*|AVCC|AVDD|DVDD|DVCC|IOVDD|VDDIO\w*|VDDA|3V3|3\.3V|\+3V3|5V|\+5V|VIN|V\+|VS\+?|VSUP|VBAT|VCCIO|V_?USB|VBUS|PVIN|VDD_?3V3|VCC_?3V3)$/i;
  const PINOS_TERRA = /^(?:GND\w*|VSS\w*|AGND|DGND|PGND|SGND|EPAD|EP|PAD|THERMAL|V-|VS-|0V|GROUND|EXPOSED.*)$/i;
  const prefixo = ref => (/^[A-Za-z_]+/.exec(String(ref || '')) || [''])[0].toUpperCase();

  function agrupa(componentes) {
    /* as partes de um componente (conector por via, CI de varias partes) num so, com todos os pinos */
    const por = new Map();
    for (const c of componentes || []) {
      const k = String(c.ref || '');
      if (!k) continue;
      const a = por.get(k);
      if (a) { for (const p of c.pinos || []) if (!a.pinos.some(q => String(q.num) === String(p.num))) a.pinos.push(Object.assign({ comentarioParte: c.comment }, p)); if (!a.valor && c.valor) a.valor = c.valor; a.partes.push(c); }
      else por.set(k, Object.assign({}, c, { pinos: (c.pinos || []).map(p => Object.assign({ comentarioParte: c.comment }, p)), partes: [c] }));
    }
    return por;
  }

  function monta(componentes, config) {
    const cfg = config || {};
    const avisos = [];
    const elementos = [];
    const comps = new Map();
    const porPino = new Map();      // 'REF-PINO' -> [{el, k}]
    const produzidas = new Set();   // nets que um regulador produz
    const usadas = new Set();
    const desligados = new Set((cfg.desligados || []).map(String));
    const grupos = agrupa(componentes);

    /* nets de terra */
    const terra = new Set((cfg.terra || []).map(String));
    for (const c of grupos.values()) for (const p of c.pinos) if (p.net) { usadas.add(p.net); if (RE_TERRA.test(norm(p.net).replace(/\s+/g, ''))) terra.add(p.net); }
    if (!terra.size) {
      /* sem net de terra pelo nome: a net do pino GND/VSS de algum CI, senao a mais ligada */
      for (const c of grupos.values()) for (const p of c.pinos) if (p.net && PINOS_TERRA.test(String(p.name || ''))) terra.add(p.net);
      if (!terra.size) {
        const cont = new Map();
        for (const c of grupos.values()) for (const p of c.pinos) if (p.net) cont.set(p.net, (cont.get(p.net) || 0) + 1);
        const mais = [...cont].sort((a, b) => b[1] - a[1])[0];
        if (mais) { terra.add(mais[0]); avisos.push('nenhuma net de terra pelo nome: usando "' + mais[0] + '" como referência (0 V)'); }
      }
    }
    const ehTerra = n => terra.has(n);
    let serie = 0;
    const nInt = (ref, s) => ref + '#' + s + (++serie);

    function poe(info, el, pinosTerm) {
      el.ref = info.ref; el.id = el.id || info.ref + ':' + elementos.length;
      el.pinos = pinosTerm || [];
      elementos.push(el); info.elementos.push(el);
      el.pinos.forEach((pk, k) => { if (!pk) return; if (!porPino.has(pk)) porPino.set(pk, []); porPino.get(pk).push({ el, k }); });
      return el;
    }
    const pk = (info, p) => p ? info.ref + '-' + p.num : null;
    function achaPino(info, nomes, numero) {
      const ps = info.pinos;
      for (const n of [].concat(nomes || [])) {
        const re = n instanceof RegExp ? n : new RegExp('^' + String(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');
        const p = ps.find(q => re.test(String(q.name || '').trim()));
        if (p) return p;
      }
      if (numero != null) return ps.find(q => String(q.num) === String(numero)) || null;
      return null;
    }
    const netOu = (info, p) => p && p.net ? p.net : (p ? nInt(info.ref, 'solto') : null);
    const nomeTerm = (info, p) => p ? netOu(info, p) : nInt(info.ref, 'x');

    /* -------- os elementos basicos */
    function resistor(info, a, b, r, papel) {
      return poe(info, { tipo: 'R', nos: [nomeTerm(info, a), nomeTerm(info, b)], r: Math.max(r, 1e-4), papel: papel || 'R' }, [pk(info, a), pk(info, b)]);
    }
    function diodo(info, a, k, m, papel) {
      const n = m.n || 1.8, is = m.is || 1e-12, bv = m.bv, nz = m.nz || 1, bid = m.bidir;
      let na = nomeTerm(info, a);
      const nk = nomeTerm(info, k);
      const pinoA = pk(info, a);
      if (m.rs) {
        const meio = nInt(info.ref, 'rs');
        poe(info, { tipo: 'R', nos: [na, meio], r: m.rs, papel: 'Rs ' + (papel || 'diodo'), interno: true }, [pinoA, null]);
        na = meio;
      }
      const f = (v) => {
        const vd = v[0] - v[1];
        let i = is * (lexp(vd / (n * VT)) - 1) + 1e-12 * vd;
        if (bv) i -= 5e-3 * lexp((-vd - bv) / (nz * VT));
        if (bv && bid) i += 5e-3 * lexp((vd - bv) / (nz * VT));
        return [i, -i];
      };
      /* junc: a juncao para o limitador do Newton (pnjlim, 1.103.1) — [anodo, catodo, n·Vt, Is] */
      return poe(info, { tipo: 'NL', nos: [na, nk], f, papel: papel || 'diodo', vf: m.vf, junc: [[0, 1, n * VT, is]] }, [m.rs ? null : pinoA, pk(info, k)]);
    }
    function fonteV(info, mais, menos, v, papel, rs) {
      return poe(info, { tipo: 'V', nos: [mais, menos], v, rs: rs == null ? 1e-3 : rs, papel: papel || 'fonte' }, [null, null]);
    }

    /* -------- cada componente */
    for (const c of grupos.values()) {
      const ref = String(c.ref);
      const pre = prefixo(ref);
      const valorTxt = cfg.valores && cfg.valores[ref] != null ? String(cfg.valores[ref]) : String(c.valor || '');
      const txt = norm([c.comment, c.sym, c.valor, c.footprint].filter(Boolean).join(' '));
      const desc = norm([c.comment, c.sym].filter(Boolean).join(' '));
      const val = leValor(valorTxt || c.comment);
      const info = { ref, pre, comp: c, tipo: 'desconhecido', rotulo: '', modelo: '', valor: val, elementos: [], pinos: c.pinos, avisos: [], interativo: null, valorTxt };
      comps.set(ref, info);
      if (c.dnp || desligados.has(ref)) { info.tipo = 'fora'; info.rotulo = c.dnp ? 'não montado (DNP)' : 'desligado na simulação'; continue; }
      const ps = c.pinos.filter(p => p.net);
      const p1 = c.pinos.find(p => String(p.num) === '1') || c.pinos[0];
      const p2 = c.pinos.find(p => String(p.num) === '2') || c.pinos[1];

      /* --- resistor / potenciometro / NTC / LDR */
      if ((/^(R|RN|RES)$/.test(pre) || /^RES\b|RESIST/.test(desc)) && c.pinos.length === 2 && !/^(RV|VR)$/.test(pre)) {
        let r = val.v;
        if (!(r >= 0)) { r = 10e3; info.avisos.push('sem valor: simulando com 10 kΩ (mude o Value ou em Valores da simulação)'); }
        if (r === 0) r = 1e-3;
        info.tipo = 'resistor'; info.rotulo = 'Resistor ' + fmt(r, 'Ω');
        info.r = r; info.potencia = val.potencia || potenciaDoFootprint(c.footprint);
        resistor(info, p1, p2, r);
        continue;
      }
      if (/^(RV|VR|POT|TRIM|P|RP)$/.test(pre) && c.pinos.length >= 3 || /POTENCI|TRIMPOT|TRIMMER/.test(desc)) {
        let r = val.v; if (!(r > 0)) { r = 10e3; info.avisos.push('sem valor: simulando com 10 kΩ'); }
        const pos = cfg.pots && cfg.pots[ref] != null ? Math.min(1, Math.max(0, +cfg.pots[ref])) : 0.5;
        /* o cursor: o pino chamado W/WIPER/CURSOR (no simbolo da casa e o 3), senao o 2; as pontas sao os outros dois */
        const w = achaPino(info, [/^(W|WIPER|CURSOR|S|SL|C)$/i], null) || achaPino(info, [], 2);
        const resto = c.pinos.filter(p => p !== w);
        const a = resto[0], b = resto[1];
        info.tipo = 'pot'; info.rotulo = 'Potenciômetro ' + fmt(r, 'Ω') + ' (' + Math.round(pos * 100) + ' %)'; info.r = r; info.pos = pos; info.interativo = 'pot';
        /* posicao 1 = o cursor encostado no primeiro pino da ponta (a roda para cima sobe para ele) */
        info.r1 = resistor(info, a, w, Math.max(1, r * (1 - pos)), 'trecho ponta–cursor');
        info.r2 = resistor(info, w, b, Math.max(1, r * pos), 'trecho cursor–ponta');
        continue;
      }
      if ((/^(NTC|PTC|TH|RT)$/.test(pre) && !/0ZC|MF-|RXEF|FUSE|POLYSW|PPTC/.test(txt) || /NTC|TERMIST/.test(desc)) && c.pinos.length === 2) {
        let r = val.v; if (!(r > 0)) r = 10e3;
        info.tipo = 'resistor'; info.rotulo = 'Termistor ' + fmt(r, 'Ω') + ' a 25 °C'; info.r = r; resistor(info, p1, p2, r, 'NTC');
        continue;
      }
      if ((/^LDR$/.test(pre) || /\bLDR\b|FOTORRES/.test(desc)) && c.pinos.length === 2) {
        const luz = cfg.pots && cfg.pots[ref] != null ? +cfg.pots[ref] : 0.5;
        const r = Math.pow(10, 6 - 4 * luz); // 1 MΩ no escuro, 100 Ω na luz forte
        info.tipo = 'pot'; info.interativo = 'pot'; info.pos = luz; info.rotulo = 'LDR (luz ' + Math.round(luz * 100) + ' %)'; info.r = r;
        resistor(info, p1, p2, r, 'LDR');
        continue;
      }
      /* --- fusivel / PTC rearmavel / ferrite */
      if ((/^(F|FU|PTC|PF)$/.test(pre) || /FUSE|FUSIV|0ZC[A-Z]|MF-?[MRS]|POLYSW|PPTC|RXEF|SMD\d{3}P/.test(txt)) && c.pinos.length === 2) {
        info.tipo = 'fusivel';
        let ih = val.corrente;
        const z = /0ZC[A-Z](\d{4})/.exec(txt); if (z) ih = +z[1] / 100;
        const mf = /MF-?[MRS]\w*?(\d{3})/.exec(txt); if (!ih && mf) ih = +mf[1] / 100;
        info.ihold = ih; info.rotulo = 'Fusível' + (ih ? ' ' + fmt(ih, 'A') : '');
        resistor(info, p1, p2, 0.05, 'fusível');
        continue;
      }
      if ((/^FB$/.test(pre) || /FERRITE|BLM\d|MPZ\d/.test(txt)) && c.pinos.length === 2) { info.tipo = 'resistor'; info.rotulo = 'Ferrite'; info.r = 0.1; resistor(info, p1, p2, 0.1, 'ferrite'); continue; }
      /* --- capacitor */
      if ((/^(C|CE|CAP)$/.test(pre) || /^CAP\b|CAPACIT/.test(desc)) && c.pinos.length === 2) {
        let cv = val.v; if (!(cv > 0)) { cv = 100e-9; info.avisos.push('sem valor: simulando com 100 nF'); }
        info.tipo = 'capacitor'; info.c = cv; info.vmax = val.tensao;
        info.rotulo = 'Capacitor ' + fmt(cv, 'F') + (val.tensao ? ' / ' + val.tensao + ' V' : '');
        const mais = achaPino(info, ['+', 'POS', 'A', 'ANODE'], null);
        info.polarizado = !!(mais && /ELETROL|ELECTROL|TANT|CAPE\b|CAP EL|POLAR/.test(txt));
        const a = mais || p1, b = mais ? c.pinos.find(p => p !== mais) : p2;
        info.pMais = a;
        poe(info, { tipo: 'C', nos: [nomeTerm(info, a), nomeTerm(info, b)], c: cv, papel: 'C' }, [pk(info, a), pk(info, b)]);
        continue;
      }
      /* --- indutor */
      if ((/^L$/.test(pre) || /^IND\b|INDUTOR|INDUCTOR/.test(desc)) && c.pinos.length === 2) {
        let lv = val.v; if (!(lv > 0)) { lv = 10e-6; info.avisos.push('sem valor: simulando com 10 µH'); }
        info.tipo = 'indutor'; info.l = lv; info.rotulo = 'Indutor ' + fmt(lv, 'H');
        poe(info, { tipo: 'L', nos: [nomeTerm(info, p1), nomeTerm(info, p2)], l: lv, papel: 'L' }, [pk(info, p1), pk(info, p2)]);
        continue;
      }
      /* --- ponte retificadora */
      if (/^(BR|DB|PR)$/.test(pre) && c.pinos.length === 4 || /PONTE|BRIDGE|\bKBP|\bMB[0-9]+S|\bDB10[0-9]|\bGBU|\bKBL|\bW0[0-9]M|\bDF0[0-9]/.test(txt)) {
        const ac1 = achaPino(info, ['~', 'AC1', 'AC', '~1', 'AC_1'], 2) || c.pinos[0];
        const ac2 = c.pinos.find(p => p !== ac1 && /~|AC/i.test(p.name || '')) || achaPino(info, [], 3);
        const pos = achaPino(info, ['+', 'POS', 'DC+', 'V+'], 1), neg = achaPino(info, ['-', 'NEG', 'DC-', 'V-'], 4);
        info.tipo = 'ponte'; info.rotulo = 'Ponte retificadora';
        const m = { is: 1.4e-8, n: 1.98, rs: 0.04 };
        diodo(info, ac1, pos, m, 'diodo AC1→+'); diodo(info, ac2, pos, m, 'diodo AC2→+');
        diodo(info, neg, ac1, m, 'diodo −→AC1'); diodo(info, neg, ac2, m, 'diodo −→AC2');
        continue;
      }
      /* --- LED */
      if (/^(LD|LED|DL|D)$/.test(pre) && /LED|VERDE|VERMELH|AMAREL|AZUL|BRANC|GREEN|RED|YELLOW|BLUE|WHITE/.test(txt) && !/OPTO|PC817/.test(txt) || /^(LD|LED|DL)$/.test(pre)) {
        const cor = CORES_LED.find(([re]) => re.test(txt)) || [null, 2.0, '#ff3b30'];
        /* 1.109.0: a tensao de ativacao (Vf) e a corrente maxima editaveis na simulacao (cfg.params[ref] = {vf, imax}) */
        const prm = (cfg.params && cfg.params[ref]) || {};
        const vf = isFinite(+prm.vf) && +prm.vf > 0 ? +prm.vf : cor[1], n = 2;
        info.imax = isFinite(+prm.imax) && +prm.imax > 0 ? +prm.imax : 0.02;   // a corrente nominal de um LED de indicacao
        const is = 0.01 / Math.exp((vf - 0.01 * 8) / (n * VT));
        const a = achaPino(info, ['A', 'ANODE', 'ANODO', '+'], 1), k = achaPino(info, ['K', 'C', 'CATHODE', 'CATODO', '-'], 2);
        info.tipo = 'led'; info.vf = vf; info.cor = cor[2]; info.rotulo = 'LED ' + (cor[0] ? norm(c.comment || '').toLowerCase() : '') + ' (Vf ≈ ' + fmt(vf, 'V') + ')';
        info.d = diodo(info, a, k, { is, n, rs: 8, vf }, 'LED');
        continue;
      }
      /* --- diodo, Schottky, zener, TVS */
      if (/^(D|DZ|Z|ZD|TVS|VD)$/.test(pre) && c.pinos.length === 2) {
        const a = achaPino(info, ['A', 'ANODE', 'ANODO', '+', '1'], null) || p1;
        const k = achaPino(info, ['K', 'C', 'CATHODE', 'CATODO', '-'], null) || c.pinos.find(p => p !== a);
        let bv = null, bid = false, nome = 'diodo';
        let m = /1N47(2[89]|3\d|4\d|5[01])/.exec(txt);
        if (m) bv = ZENER_1N47[+m[1]];
        if (!bv && (m = /(?:BZ[XVT]\d*\w*?C?|ZENER|ZMM|MM[SB]Z\w*?|ZPD|DZ\w*)\s*(\d+)V(\d)?/.exec(txt))) bv = parseFloat(m[1] + (m[2] ? '.' + m[2] : ''));
        if (!bv && (m = /(\d+)V(\d)/.exec(txt)) && /^(DZ|Z|ZD)$/.test(pre)) bv = parseFloat(m[1] + '.' + m[2]);
        if (!bv && (m = /(?:SMBJ|SMAJ|SMCJ|SMDJ|P6KE|P4KE|1\.5KE|SMF|SA)(\d+(?:\.\d)?)(C?A)?/.exec(txt))) { bv = +m[1] * 1.11; bid = /C/.test(m[2] || ''); nome = 'TVS'; }
        let mod = (DIODOS.find(([re]) => re.test(txt)) || [null, null])[1];
        if (bv) { mod = { is: 1e-9, n: 1.8, rs: 0.5 }; nome = nome === 'TVS' ? 'TVS ' + (bid ? 'bidirecional ' : '') + fmt(bv, 'V') : 'zener ' + fmt(bv, 'V'); }
        if (!mod) { mod = { is: 1e-9, n: 1.8, rs: 0.5, nome: 'genérico' }; if (!/DIOD|DIODE/.test(txt)) info.avisos.push('diodo sem modelo conhecido: diodo de silício genérico'); }
        info.tipo = 'diodo'; info.bv = bv; info.rotulo = (bv ? nome : 'Diodo ' + (mod.nome || '')) + (c.comment ? ' (' + c.comment + ')' : '');
        info.d = diodo(info, a, k, Object.assign({}, mod, { bv, bidir: bid }), nome);
        continue;
      }
      /* --- transistor bipolar */
      const bjt = BJTS.find(([re]) => re.test(desc));
      const fet = FETS.find(([re]) => re.test(desc));
      if ((/^(Q|T|TR|VT)$/.test(pre) || bjt || fet) && c.pinos.length >= 3 && !(/^(T|TR)$/.test(pre) && /TRAFO|TRANSF/.test(txt))) {
        const temG = achaPino(info, [/^G(ATE)?$/i], null), temB = achaPino(info, [/^B(ASE)?$/i], null);
        const ehFet = fet && !temB || (!bjt && temG) || /MOSFET|NMOS|PMOS|\bFET\b/.test(txt);
        if (ehFet) {
          const m = fet ? fet[1] : { pol: /PMOS|P-?CH|CANAL P/.test(txt) ? -1 : 1, vth: 2, k: 5, nome: 'MOSFET genérico' };
          const sot = /SOT-?23|SOT-?323|SC-?70/.test(norm(c.footprint));
          const g = achaPino(info, [/^G(ATE)?$/i], sot ? 1 : 1), d = achaPino(info, [/^D(RAIN)?$/i], sot ? 3 : 2), s = achaPino(info, [/^S(OURCE)?$/i], sot ? 2 : 3);
          info.tipo = 'mosfet'; info.rotulo = m.nome + (c.comment ? ' ' + c.comment : ''); info.m = m;
          const pol = m.pol, vth = m.vth, K = m.k;
          const f = (v) => {
            let vd = v[0], vg = v[1], vs = v[2];
            let inv = 1;
            if (pol * (vd - vs) < 0) { const t = vd; vd = vs; vs = t; inv = -1; }
            const vgs = pol * (vg - vs), vds = pol * (vd - vs);
            const vov = sp(vgs - vth, 0.04);
            let id = vds < vov ? K * (vov * vds - vds * vds / 2) : K / 2 * vov * vov * (1 + 0.01 * (vds - vov));
            id = pol * id * inv;
            /* diodo de corpo (fonte -> dreno no canal N) */
            const vbd = pol * (v[2] - v[0]);
            const ib = 1e-11 * (lexp(vbd / (1.6 * VT)) - 1) * pol;
            return [id - ib, 0, -id + ib];
          };
          info.q = poe(info, { tipo: 'NL', nos: [nomeTerm(info, d), nomeTerm(info, g), nomeTerm(info, s)], f, dc: [[0, 2]], papel: 'MOSFET', junc: [[2, 0, 1.6 * VT, 1e-11, pol]] }, [pk(info, d), pk(info, g), pk(info, s)]);
          if (!fet) info.avisos.push('MOSFET sem modelo conhecido: Vth 2 V');
          if (!(achaPino(info, [/^G(ATE)?$/i], null))) info.avisos.push('pinos sem nome G/D/S: usei a ordem do encapsulamento');
          continue;
        }
        const m = bjt ? Object.assign({}, bjt[1], BJT_PNP_FIX.test(desc) && bjt[1].pol > 0 && bjt[1].bf < 900 ? { pol: -1, nome: 'PNP' } : {}) : { pol: /PNP/.test(txt) ? -1 : 1, bf: 150, is: 1e-14, nf: 1, nome: /PNP/.test(txt) ? 'PNP' : 'NPN' };
        if (!bjt) info.avisos.push('transistor sem modelo conhecido: ' + m.nome + ' genérico, β = 150');
        const sot = /SOT-?23|SOT-?323|SC-?70/.test(norm(c.footprint)), to92 = /TO-?92/.test(norm(c.footprint));
        const C_ = achaPino(info, [/^C(OL\w*)?$/i], sot ? 3 : 1), B = achaPino(info, [/^B(ASE)?$/i], sot ? 1 : 2), E = achaPino(info, [/^E(MIT\w*)?$/i], sot ? 2 : 3);
        if (!achaPino(info, [/^B(ASE)?$/i], null)) info.avisos.push('pinos sem nome B/C/E: usei a ordem ' + (sot ? 'SOT-23 (1 B, 2 E, 3 C)' : to92 ? 'TO-92 (1 C, 2 B, 3 E)' : '1 C, 2 B, 3 E'));
        info.tipo = 'bjt'; info.m = m; info.rotulo = 'Transistor ' + m.nome + ' ' + (c.comment || '') + ' (β ≈ ' + m.bf + ')';
        const pol = m.pol, Is = m.is, nf = m.nf || 1, BF = m.bf, BR = 3;
        const f = (v) => {
          const vbe = pol * (v[1] - v[2]), vbc = pol * (v[1] - v[0]);
          const ef = lexp(vbe / (nf * VT)), er = lexp(vbc / (nf * VT));
          const ic = Is * (ef - er) - Is / BR * (er - 1);
          const ib = Is / BF * (ef - 1) + Is / BR * (er - 1);
          return [pol * ic + 1e-12 * (v[0] - v[2]), pol * ib, -pol * (ic + ib) - 1e-12 * (v[0] - v[2])];
        };
        info.q = poe(info, { tipo: 'NL', nos: [nomeTerm(info, C_), nomeTerm(info, B), nomeTerm(info, E)], f, papel: 'BJT', junc: [[1, 2, nf * VT, Is, pol], [1, 0, nf * VT, Is, pol]] }, [pk(info, C_), pk(info, B), pk(info, E)]);
        continue;
      }
      /* --- chave / botao */
      if (/^(S|SW|SB|BT|BTN|KEY|PB|K)$/.test(pre) && /TACT|PUSH|BOT|BUTTON|CHAVE|SWITCH|SW|KEY|DIP|TOGGLE|SPST|SPDT|MICRO/.test(txt) || /^(SW|S|SB|BTN|PB|KEY)$/.test(pre)) {
        const mom = /TACT|PUSH|BOT[AÃ]O|BUTTON|PB|KEY|MOMENT/.test(txt) || /^(PB|BTN|KEY|SB)$/.test(pre);
        const fech = cfg.chaves && cfg.chaves[ref] != null ? !!cfg.chaves[ref] : false;
        info.tipo = 'chave'; info.interativo = mom ? 'botao' : 'chave'; info.fechada = fech;
        info.rotulo = (mom ? 'Botão' : 'Chave') + (fech ? ' (fechado)' : ' (aberto)');
        let a = p1, b = p2;
        if (c.pinos.length === 4) {
          /* tactil 6x6: 1-2 ligados, 3-4 ligados; a chave e entre os pares */
          const q3 = achaPino(info, [], 3), q4 = achaPino(info, [], 4);
          resistor(info, p1, p2, 1e-3, 'ligação interna 1–2'); resistor(info, q3, q4, 1e-3, 'ligação interna 3–4');
          a = p1; b = q3;
        } else if (c.pinos.length === 3) {
          /* SPDT: comum no meio (2), 1 e 3 nas pontas: fechada = 2-1, aberta = 2-3 */
          const com = achaPino(info, ['COM', 'C', '2'], 2), x1 = achaPino(info, ['NO', '1'], 1), x3 = achaPino(info, ['NC', '3'], 3);
          info.sw2 = poe(info, { tipo: 'SW', nos: [nomeTerm(info, com), nomeTerm(info, x3)], fechada: !fech, papel: 'posição 2–3' }, [pk(info, com), pk(info, x3)]);
          a = com; b = x1;
        }
        info.sw = poe(info, { tipo: 'SW', nos: [nomeTerm(info, a), nomeTerm(info, b)], fechada: fech, papel: 'contato' }, [pk(info, a), pk(info, b)]);
        continue;
      }
      /* --- jumper (de solda, de pino): ABERTO por padrao — jumper de selecao vem em par (GND ou 5V) e fechar os dois poe
         a fonte em curto; um clique fecha */
      if (/^(JP|J|SJ|JMP|W)$/.test(pre) && /JUMPER|JMP|SOLDER|PONTE DE SOLDA|SJ/.test(txt) && c.pinos.length === 2) {
        const fech = cfg.chaves && cfg.chaves[ref] != null ? !!cfg.chaves[ref] : false;
        info.tipo = 'chave'; info.interativo = 'chave'; info.fechada = fech; info.rotulo = 'Jumper ' + (fech ? '(fechado)' : '(aberto)');
        info.sw = poe(info, { tipo: 'SW', nos: [nomeTerm(info, p1), nomeTerm(info, p2)], fechada: fech, papel: 'jumper' }, [pk(info, p1), pk(info, p2)]);
        continue;
      }
      /* --- rele */
      if (/^(K|RL|RY|REL)$/.test(pre) && c.pinos.length >= 4 || /RELE|RELAY|\bSRD-|\bHK\d|\bJQC|\bG5[VLQ]|\bHF\d/.test(txt)) {
        const vbob = val.tensao || (/(\d+)\s*V(?:DC)?/.exec(txt) || [])[1] * 1 || 12;
        const rb = vbob * vbob / 0.36;
        const b1 = achaPino(info, [/^(A1|COIL\+?|BOB\w*1?|L1|\+)$/i], 1), b2 = achaPino(info, [/^(A2|COIL-?|BOB\w*2|L2|-)$/i], 2);
        const com = achaPino(info, [/^(COM\w*|C|11|COMUM)$/i], null), na = achaPino(info, [/^(NO\w*|NA|14|N\.?A\.?)$/i], null), nf = achaPino(info, [/^(NC\w*|NF|12|N\.?F\.?)$/i], null);
        info.tipo = 'rele'; info.vbob = vbob; info.rotulo = 'Relé ' + fmt(vbob, 'V') + ' (bobina ≈ ' + fmt(rb, 'Ω') + ')';
        const contatos = [];
        if (com && na) contatos.push(poe(info, { tipo: 'SW', nos: [nomeTerm(info, com), nomeTerm(info, na)], fechada: false, papel: 'contato NA' }, [pk(info, com), pk(info, na)]));
        if (com && nf) contatos.push(poe(info, { tipo: 'SW', nos: [nomeTerm(info, com), nomeTerm(info, nf)], fechada: true, papel: 'contato NF', nf: true }, [pk(info, com), pk(info, nf)]));
        if (!com) info.avisos.push('contatos sem nome COM/NO/NC: só a bobina é simulada');
        const bob = resistor(info, b1, b2, rb, 'bobina');
        info.ligado = false;
        bob.reinicia = () => { info.ligado = false; for (const k of contatos) k.fechada = !!k.nf; };
        bob.atualiza = (v) => {
          const vb = Math.abs(v[0] - v[1]);
          const on = info.ligado ? vb > 0.3 * vbob : vb > 0.75 * vbob;
          if (on === info.ligado) return false;
          info.ligado = on;
          for (const k of contatos) k.fechada = k.nf ? !on : on;
          return true;
        };
        continue;
      }
      /* --- bateria */
      if (/^(BT|BAT|B|G|BATT)$/.test(pre) && c.pinos.length === 2 && !/BUZZ|BOT/.test(txt) || /BATER|BATTERY|CR20\d\d|CR1220|18650|LIPO|\bLI-?ION/.test(txt)) {
        let v = val.tensao || val.v;
        if (/CR20|CR1[26]|CR2\d/.test(txt)) v = 3; else if (/18650|LIPO|LI-?ION|21700/.test(txt)) v = 3.7; else if (/\b9V\b/.test(txt)) v = 9; else if (/\bAAA?\b/.test(txt)) v = 1.5;
        if (!(v > 0)) v = 3;
        const mais = achaPino(info, ['+', 'POS', 'VBAT', 'A', '1'], 1), menos = achaPino(info, ['-', 'NEG', 'GND', 'K', '2'], 2);
        info.tipo = 'bateria'; info.rotulo = 'Bateria ' + fmt(v, 'V');
        const e = fonteV(info, nomeTerm(info, mais), nomeTerm(info, menos), v, 'bateria', 0.15);
        e.pinos = [pk(info, mais), pk(info, menos)];
        for (const [k, p] of e.pinos.entries()) if (p) { if (!porPino.has(p)) porPino.set(p, []); porPino.get(p).push({ el: e, k }); }
        continue;
      }
      /* --- buzzer, alto-falante, motor, lampada */
      if (/^(BZ|LS|SP|SPK|M|MOT|LP|LA|H)$/.test(pre) && c.pinos.length === 2 && !/MOUNT|FURO|HOLE|MH|FIXA/.test(txt) || /BUZZER|SPEAKER|ALTO-?FAL|MOTOR|LAMPAD/.test(txt)) {
        const buz = /^BZ$/.test(pre) || /BUZZ/.test(txt), alto = /^(LS|SP|SPK)$/.test(pre) || /SPEAK|FALANTE/.test(txt), motor = /^(M|MOT)$/.test(pre) || /MOTOR/.test(txt);
        const r = val.v > 0 ? val.v : buz ? 170 : alto ? 8 : motor ? 12 : 60;
        info.tipo = 'carga'; info.rotulo = (buz ? 'Buzzer' : alto ? 'Alto-falante' : motor ? 'Motor' : 'Lâmpada') + ' (≈ ' + fmt(r, 'Ω') + ')';
        if (!buz && !alto && !motor && /^H$/.test(pre)) { info.tipo = 'ignorado'; info.rotulo = 'furo/fixação'; continue; }
        info.r = r; resistor(info, p1, p2, r, info.rotulo);
        continue;
      }
      /* --- cristal, ressonador, transformador, furos, pontos de teste */
      if (/^(Y|X|XT|XTAL|Q)$/.test(pre) && /XTAL|CRYST|CRIST|MHZ|KHZ|RESSON|OSC/.test(txt) || /^(Y|XTAL)$/.test(pre)) { info.tipo = 'ignorado'; info.rotulo = 'Cristal (não simulado: só o DC)'; continue; }
      if (/^(TP|FID|MH|H|MK|LOGO|TEST)$/.test(pre)) { info.tipo = 'ignorado'; info.rotulo = 'ponto de teste / fixação'; continue; }
      if (/^(T|TR|TF)$/.test(pre) && /TRAFO|TRANSF/.test(txt)) { info.tipo = 'ignorado'; info.rotulo = 'Transformador (não simulado)'; info.avisos.push('transformador não é simulado: defina a tensão do secundário como fonte'); continue; }

      /* --- CIs */
      if (ps.length) {
        const alim = c.pinos.filter(p => PINOS_ALIM.test(String(p.name || '').trim()));
        const gnds = c.pinos.filter(p => PINOS_TERRA.test(String(p.name || '').trim()) || (p.net && ehTerra(p.net)));

        /* regulador linear */
        const rl = reguladorLinear(desc);
        if (rl && c.pinos.length >= 3 && c.pinos.length <= 8) {
          const ordem = rl.ordem;
          const pIn = achaPino(info, [/^(V?IN|VI|INPUT|ENTRADA|E)$/i], ordem.indexOf('IN') + 1);
          const pOut = achaPino(info, [/^(V?OUT|VO|OUTPUT|SAIDA|S|TAB)$/i], ordem.indexOf('OUT') + 1);
          const pG = rl.adj ? achaPino(info, [/^(ADJ\w*|GND\/ADJ|ADJ\/GND|A)$/i], ordem.indexOf('ADJ') + 1) : achaPino(info, [/^(GND|COM|G|TERRA)$/i], ordem.indexOf('GND') + 1);
          info.tipo = 'regulador'; info.modelo = rl; info.rotulo = rl.nome[0].toUpperCase() + rl.nome.slice(1) + (rl.vout ? ' → ' + fmt(rl.vout, 'V') : '');
          if (pOut && pOut.net) produzidas.add(pOut.net);
          info.pIn = pIn; info.pOut = pOut; info.pG = pG;
          const s = rl.neg ? -1 : 1, G = 50, ilim = rl.ilim, iq = rl.iq;
          /* entrada, saida e o terceiro pino (GND, ou ADJ no ajustavel: ai a saida e medida contra o ADJ e o alvo e 1,25 V) */
          const f = (v) => {
            const vin = s * (v[0] - v[2]), vout = s * (v[1] - v[2]);
            const on = Math.tanh(Math.max(vin, 0) / 0.5);
            const ia = G * ((rl.adj || Math.abs(rl.vout)) - vout);
            const ib = G * (vin - rl.vdo - vout);
            /* linear dentro da faixa (converge num passo); o limite de corrente e a retificacao tem uma rampa leve, para o
               Newton nunca cair num trecho plano */
            const bruto = smin(ia, ib, 1e-3);
            const iout = smin(sp(bruto, 0.02) + 1e-3 * bruto, ilim + 0.02 * bruto, 1e-3) * on;
            const iq_ = rl.adj ? 0 : iq * on, iadj = rl.adj ? 50e-6 * on : 0;
            return [s * (iout + iq_ + iadj), -s * iout, -s * (iq_ + iadj)];
          };
          info.reg = poe(info, { tipo: 'NL', nos: [nomeTerm(info, pIn), nomeTerm(info, pOut), nomeTerm(info, pG)], f, papel: 'regulador' }, [pk(info, pIn), pk(info, pOut), pk(info, pG)]);
          continue;
        }
        /* conversor chaveado (modelo medio) */
        const cv = conversor(desc);
        if (cv) {
          const o = cv.ordem;
          const pIn = achaPino(info, [/^(V?IN|PVIN|VCC|VI)$/i], o.indexOf('VIN') + 1 || null);
          const pSw = achaPino(info, [/^(SW|LX|OUT\w*|VOUT|PH)$/i], o.indexOf('SW') + 1 || null);
          const pG = achaPino(info, [/^(GND|PGND|AGND|VSS)$/i], o.indexOf('GND') + 1 || null) || gnds[0];
          const pFb = achaPino(info, [/^(FB|FEEDBACK|VFB|VSENSE)$/i], o.indexOf('FB') + 1 || null);
          const pEn = achaPino(info, [/^(EN|ON\/?OFF|~?ON\w*|SHDN\w*|RUN)$/i], o.indexOf('EN') + 1 || null);
          if (!pIn || !pSw || !pFb) { info.tipo = 'ci'; info.rotulo = cv.nome + ' — pinos não reconhecidos'; info.avisos.push('conversor sem os pinos VIN/SW/FB identificados'); }
          else {
            info.tipo = 'conversor'; info.modelo = cv;
            info.rotulo = (cv.boost ? 'Conversor boost' : 'Conversor buck') + ' ' + (c.comment || '') + (cv.fixo ? ' → ' + fmt(cv.vout, 'V') : ' (FB ' + fmt(cv.vfb, 'V') + ')');
            info.pIn = pIn; info.pOut = pSw; info.pG = pG; info.pFb = pFb;
            if (pFb.net && cv.fixo) produzidas.add(pFb.net);
            /* a net de saida (depois do indutor) e a do FB no fixo; no ADJ e a de cima do divisor: marca o que o SW alcanca por indutor */
            info.produzSw = pSw.net;
            const G = 30, eta = cv.eta, temEn = !!(pEn && pEn.net);
            const nos = [nomeTerm(info, pIn), nomeTerm(info, pSw), nomeTerm(info, pG), nomeTerm(info, pFb)].concat(temEn ? [nomeTerm(info, pEn)] : []);
            const f = (v) => {
              const vg = v[2], vin = v[0] - vg, vsw = v[1] - vg, vfb = v[3] - vg;
              let on = Math.tanh(Math.max(vin, 0) / 1.5) * sig((vin - 3) * 4);
              if (temEn) { const ve = v[4] - vg; on *= cv.enBaixo ? sig((1.4 - ve) * 8) : sig((ve - 1.2) * 8); }
              const ia = G * (cv.vfb - vfb);
              const ib = cv.boost ? 1e3 : G * (vin - 1.0 - vsw);
              const iout = sp(smin(ia, ib, 1e-3), 1e-4) * on;
              const pout = Math.max(vsw, 0) * iout;
              const iin = pout / (eta * Math.max(vin, 0.5)) + 3e-3 * on;
              const r = [iin, -iout, -(iin - iout), 0];
              if (temEn) r.push(0);
              return r;
            };
            info.reg = poe(info, { tipo: 'NL', nos, f, dc: [[0, 1, 2]], papel: 'conversor' }, [pk(info, pIn), pk(info, pSw), pk(info, pG), pk(info, pFb)].concat(temEn ? [pk(info, pEn)] : []));
            continue;
          }
        }
        /* 555 */
        if (/(?:NE|LM|SA|SE|TLC|ICM|LMC|ICM7)?555|\b7555\b/.test(desc) && c.pinos.length >= 8 && !/556/.test(desc)) {
          const P = (re, n) => achaPino(info, [re], n);
          const pins = [P(/^GND$/i, 1), P(/^(TRIG\w*|TR)$/i, 2), P(/^(OUT\w*|Q)$/i, 3), P(/^(RESET|~?R\w*ST|RST)$/i, 4), P(/^(CTRL|CONT\w*|CV|CON)$/i, 5), P(/^(THR\w*|TH)$/i, 6), P(/^(DIS\w*|DISCH)$/i, 7), P(/^(VCC|V\+|VDD)$/i, 8)];
          info.tipo = '555'; info.rotulo = 'Temporizador 555'; info.q = 1;
          const nos = pins.map(p => nomeTerm(info, p));
          const iq = /TLC|LMC|ICM|7555/.test(desc) ? 0.2e-3 : 3e-3;
          const f = (v) => {
            const g = v[0], vcc = v[7] - g;
            const on = Math.tanh(Math.max(vcc, 0) / 1);
            const out = info.q ? Math.max(vcc - 1.7, 0) : 0.1;
            const iOut = (v[2] - g - out) / 10;                    // entrando pelo OUT
            const iDis = info.q ? (v[6] - g) * 1e-9 : (v[6] - g) / 10;
            const r5 = (v[7] - v[4]) / 5e3, r10 = (v[4] - g) / 10e3;
            const iVcc = iq * on + r5 + sp(-iOut, 1e-4);
            const iGnd = -(iq * on) - r10 - sp(iOut, 1e-4) - iDis;
            const iCtrl = -r5 + r10;
            const r = [iGnd, 1e-9 * (v[1] - g), iOut, 1e-9 * (v[3] - g), iCtrl, 1e-9 * (v[5] - g), iDis, iVcc];
            r[0] -= r[1] + r[3] + r[5];
            return r;
          };
          info.ci = poe(info, { tipo: 'NL', nos, f, dc: [[0, 2, 4, 6, 7]], papel: '555',
            reinicia: () => { info.q = 1; },
            atualiza: (v) => {
              const g = v[0], vctrl = v[4] - g; const antes = info.q;
              if (v[3] - g < 0.7) info.q = 0;
              else if (v[1] - g < vctrl / 2) info.q = 1;
              else if (v[5] - g > vctrl) info.q = 0;
              return info.q !== antes;
            } }, pins.map(p => pk(info, p)));
          continue;
        }
        /* optoacoplador */
        if (/PC81[57]|EL81[57]|LTV-?8[14]7|4N2[5-8]|4N3[5-7]|TLP\d{3}|CNY17|H11A|MOC30|K817|FOD8/.test(desc)) {
          const seis = c.pinos.length >= 6;
          const A = achaPino(info, [/^(A|ANODE|ANODO|1)$/i], 1), K = achaPino(info, [/^(K|C|CATHODE|CATODO)$/i], 2);
          const E = achaPino(info, [/^(E|EMITTER|EMISSOR)$/i], seis ? 4 : 3), Cc = achaPino(info, [/^(C|COL\w*)$/i], seis ? 5 : 4);
          info.tipo = 'opto'; info.rotulo = 'Optoacoplador ' + (c.comment || '') + ' (CTR ≈ 100 %)';
          const is = 0.01 / Math.exp(1.2 / (1.8 * VT));
          const ctr = 1.0;
          const f = (v) => {
            const vd = v[0] - v[1];
            const il = is * (lexp(vd / (1.8 * VT)) - 1) + 1e-12 * vd;
            const vce = v[2] - v[3];
            const ice = ctr * Math.max(il, 0) * Math.tanh(Math.max(vce, 0) / 0.15) + 1e-10 * vce;
            return [il, -il, ice, -ice];
          };
          info.ci = poe(info, { tipo: 'NL', nos: [nomeTerm(info, A), nomeTerm(info, K), nomeTerm(info, Cc), nomeTerm(info, E)], f, dc: [[0, 1], [2, 3]], papel: 'opto', junc: [[0, 1, 1.8 * VT, is]] }, [pk(info, A), pk(info, K), pk(info, Cc), pk(info, E)]);
          continue;
        }
        /* ULN2003 / ULN2803 */
        if (/ULN200[34]|ULN280[34]|MC1413|TD62003/.test(desc)) {
          const n = /280/.test(desc) ? 8 : 7, gnd = achaPino(info, [/^(GND|E)$/i], n + 1), com = achaPino(info, [/^(COM|CD\+|K)$/i], n + 2);
          info.tipo = 'driver'; info.rotulo = 'Driver Darlington ' + (c.comment || '') + ' (' + n + ' canais)';
          for (let k = 1; k <= n; k++) {
            const pi = achaPino(info, [new RegExp('^(I|IN|B)' + k + '$', 'i')], k), po = achaPino(info, [new RegExp('^(O|OUT|C)' + k + '$', 'i')], 2 * n + 3 - k);
            if (!pi || !po || !pi.net || !po.net) continue;
            const f = (v) => {
              const g = v[2], vi = v[0] - g, vo = v[1] - g;
              const ib = sp(vi - 1.3, 0.02) / 2.7e3;
              const on = sig((vi - 1.4) / 0.05);
              const ic = on * sp(vo - 0.9, 0.03) / 1.5 + 1e-10 * vo;
              const idc = com && com.net ? 1e-9 * (lexp((v[1] - v[3] - 0.0) / (1.8 * VT)) - 1) : 0;
              return [ib, ic + idc, -ib - ic, -idc];
            };
            poe(info, { tipo: 'NL', nos: [nomeTerm(info, pi), nomeTerm(info, po), nomeTerm(info, gnd), nomeTerm(info, com)], f, dc: [[1, 2], [0, 2]], papel: 'canal ' + k }, [pk(info, pi), pk(info, po), pk(info, gnd), pk(info, com)]);
          }
          continue;
        }
        /* amplificador operacional / comparador */
        const op = OPAMPS.find(([re]) => re.test(desc)), cmp = !op && COMPARADORES.find(([re]) => re.test(desc));
        if (op || cmp) {
          const m = (op || cmp)[1];
          const tab = (cmp ? PINAGEM_COMP : PINAGEM_OPAMP)[m.canais] || PINAGEM_OPAMP[2];
          const al = (cmp ? ALIM_COMP : ALIM_OPAMP)[m.canais];
          const vp = achaPino(info, [/^(V\+|VCC|VDD|VS\+|\+VS|V\+\w*|POWER|VPOS)$/i], al.vp), vn = achaPino(info, [/^(V-|VEE|VSS|GND|VS-|-VS|GROUND|VNEG)$/i], al.vn);
          info.tipo = cmp ? 'comparador' : 'opamp';
          info.rotulo = (cmp ? 'Comparador ' : 'Amplificador operacional ') + (c.comment || '') + ' (' + m.canais + ' canal' + (m.canais > 1 ? 'is' : '') + ')';
          info.canais = [];
          tab.forEach((t, i) => {
            const L = String.fromCharCode(65 + i);
            const out = achaPino(info, [new RegExp('^(OUT\\s*' + L + '|' + L + '?OUT|OUT' + (i + 1) + '|' + (i + 1) + 'OUT|OUTPUT\\s*' + L + ')$', 'i'), ...(m.canais === 1 ? [/^(OUT|OUTPUT|VOUT|VO)$/i] : [])], t.out);
            let inn = achaPino(info, [new RegExp('^(-IN\\s*' + L + '|IN' + L + '-|IN-\\s*' + L + '|' + L + 'IN-|IN' + (i + 1) + '-|-IN' + (i + 1) + ')$', 'i'), ...(m.canais === 1 ? [/^(-IN|IN-|INV\w*|-)$/i] : [])], t.n);
            let inp = achaPino(info, [new RegExp('^(\\+IN\\s*' + L + '|IN' + L + '\\+|IN\\+\\s*' + L + '|' + L + 'IN\\+|IN' + (i + 1) + '\\+|\\+IN' + (i + 1) + ')$', 'i'), ...(m.canais === 1 ? [/^(\+IN|IN\+|NON\w*|\+)$/i] : [])], t.p);
            if (!out || !out.net) return;
            /* simbolo com nomes genericos repetidos ("PLUS INPUT"/"MINUS INPUT" nos dois canais) e pinagem fora do padrao:
               a ordem do encapsulamento acha o par, o nome diz qual e o + */
            if (inp && inn && /MINUS|INV(?!.*NON)|^-|IN-/i.test(String(inp.name || '')) && /PLUS|NON|^\+|IN\+/i.test(String(inn.name || ''))) { const t = inp; inp = inn; inn = t; }
            const A = 2e4;
            const f = cmp ? (v) => {
              const vlo = v[4];
              const on = sig((v[1] - v[0]) * 200);
              const io = on * (v[2] - vlo) / 30 + 1e-10 * (v[2] - vlo);
              return [1e-12 * v[0], 1e-12 * v[1], io, 0, -io - 1e-12 * (v[0] + v[1])];
            } : (v) => {
              const vlo = v[4] + m.dlo, vhi = v[3] - m.dhi;
              const meio = (vhi + vlo) / 2, meia = Math.max((vhi - vlo) / 2, 0.01);
              const alvo = meio + meia * Math.tanh(A * (v[0] - v[1]) / meia);
              const iIn = (v[2] - alvo) / 40;          // entrando pelo OUT
              return [1e-12 * v[0], 1e-12 * v[1], iIn, sp(-iIn, 1e-5), -sp(iIn, 1e-5) - 1e-12 * (v[0] + v[1])];
            };
            const el = poe(info, { tipo: 'NL', nos: [nomeTerm(info, inp), nomeTerm(info, inn), nomeTerm(info, out), nomeTerm(info, vp), nomeTerm(info, vn)], f, dc: [[2, 3, 4]], papel: (cmp ? 'comparador ' : 'canal ') + L },
              [pk(info, inp), pk(info, inn), pk(info, out), pk(info, vp), pk(info, vn)]);
            info.canais.push({ L, el, out, inn, inp });
          });
          if (vp && vn) poe(info, { tipo: 'I', nos: [nomeTerm(info, vp), nomeTerm(info, vn)], i: m.iq || 1e-3, papel: 'repouso' }, [pk(info, vp), pk(info, vn)]);
          continue;
        }
        /* portas logicas */
        const lg = /(?:74(?:HC|HCT|LS|AHC|AC|ACT|LV|LVC|F|ALS)?|SN74\w*?|CD|HEF|MC1)(\d{2,4})/.exec(desc);
        const porta = lg && (PORTAS[lg[1]] || PORTAS[(lg[1].length === 4 ? lg[1] : '')]) || (/\b40(11|01|69|81|71|93)\b/.test(desc) && PORTAS['40' + /\b40(11|01|69|81|71|93)\b/.exec(desc)[1]]);
        if (porta && c.pinos.length >= 14) {
          const vcc = achaPino(info, [/^(VCC|VDD)$/i], 14), gnd = achaPino(info, [/^(GND|VSS)$/i], 7);
          info.tipo = 'logica'; info.rotulo = 'Portas lógicas ' + porta.f.toUpperCase() + ' ' + (c.comment || '');
          const fn = { nand: (a, b) => 1 - a * b, and: (a, b) => a * b, or: (a, b) => a + b - a * b, nor: (a, b) => 1 - (a + b - a * b), xor: (a, b) => a + b - 2 * a * b, not: a => 1 - a }[porta.f];
          for (const g of porta.g) {
            const ins = g.slice(0, -1).map(n => achaPino(info, [], n)), out = achaPino(info, [], g[g.length - 1]);
            if (!out || !out.net) continue;
            const f = (v) => {
              const vg = v[v.length - 1], vc = v[v.length - 2] - vg;
              const L = ins.map((_, k) => sig(((v[k] - vg) - vc / 2) / 0.04));
              const alvo = fn(L[0], L[1]) * Math.max(vc, 0);
              const io = (v[ins.length] - vg - alvo) / 25;
              const r = ins.map((_, k) => 1e-12 * (v[k] - vg));
              r.push(io, sp(-io, 1e-5), -sp(io, 1e-5));
              r[r.length - 1] -= r.slice(0, ins.length).reduce((a, b) => a + b, 0);
              return r;
            };
            poe(info, { tipo: 'NL', nos: ins.map(p => nomeTerm(info, p)).concat([nomeTerm(info, out), nomeTerm(info, vcc), nomeTerm(info, gnd)]), f, dc: [[ins.length, ins.length + 1, ins.length + 2]], papel: porta.f.toUpperCase() },
              ins.map(p => pk(info, p)).concat([pk(info, out), pk(info, vcc), pk(info, gnd)]));
          }
          poe(info, { tipo: 'I', nos: [nomeTerm(info, vcc), nomeTerm(info, gnd)], i: 20e-6, papel: 'repouso' }, [pk(info, vcc), pk(info, gnd)]);
          continue;
        }
        /* microcontrolador e CI generico: consumo entre alimentacao e terra; GPIO configuravel */
        const mcu = MCUS.find(([re]) => re.test(desc));
        const fam = mcu ? mcu[1] : (CIS_ALIM.find(([re]) => re.test(desc)) || [null, null])[1];
        if (/^(J|CN|P|X|CON|JP|XS|XP|K\d?)$/.test(pre) && !mcu && !fam) { /* conector: tratado abaixo */ }
        else {
          info.tipo = mcu ? 'mcu' : 'ci';
          info.fam = fam;
          info.rotulo = (mcu ? 'Microcontrolador ' + fam.nome : fam ? fam.nome[0].toUpperCase() + fam.nome.slice(1) : 'CI') + (c.comment ? ' (' + c.comment + ')' : '');
          const alimNets = [...new Map(alim.filter(p => p.net && !ehTerra(p.net)).map(p => [p.net, p])).values()];
          const g0 = gnds.find(p => p.net);
          info.alim = alimNets; info.gnd = g0;
          if (alimNets.length && g0) {
            const iq = (fam ? fam.iq : 1e-3) / alimNets.length;
            for (const pa of alimNets) {
              const f = (v) => { const vv = v[0] - v[1]; const i = iq * Math.tanh(Math.max(vv, 0) / 0.6) + 1e-9 * vv; return [i, -i]; };
              poe(info, { tipo: 'NL', nos: [pa.net, g0.net], f, papel: 'consumo' }, [pk(info, pa), pk(info, g0)]);
            }
          } else if (!fam && !mcu) info.avisos.push('sem modelo: pinos em alta impedância' + (alim.length ? '' : ' (nenhum pino de alimentação reconhecido)'));
          if (!fam && !mcu && alimNets.length) info.avisos.push('CI sem modelo: só o consumo de repouso (1 mA); os outros pinos em alta impedância');
          /* GPIO configurados */
          const vddPino = alimNets[0];
          for (const p of c.pinos) {
            const g = cfg.gpio && cfg.gpio[ref + '-' + p.num];
            if (!g || !p.net || !vddPino || !g0) continue;
            /* o modo e lido A CADA conta do objeto da config (nao copiado): o NexoCode (gpio_lote) e o painel mudam o
               duty do PWM ou o nivel sem remontar o circuito — o tempo da simulacao continua */
            const f = (v, e, ctx) => {
              const modo = g.modo, duty = g.duty == null ? 0.5 : +g.duty, fr = +g.f || 1000;
              const vdd = v[1] - v[2];
              let alvo = null, rr = 30;
              if (modo === 'entrada' || !modo) { const io = 1e-12 * (v[0] - v[2]); return [io, 0, -io]; }
              if (modo === 'alto') alvo = vdd;
              else if (modo === 'baixo') alvo = 0;
              /* PWM: no DC vale a media; no tempo, mais rapido que o passo (20 kHz com dt de ms) o pino CHAVEIA distribuindo
                 o duty entre os passos (sigma-delta, g._on no atualiza) — o MOSFET liga e desliga como na placa e o motor
                 recebe duty·V na media (a media no gate deixava o transistor meio aberto) */
              else if (modo === 'pwm') alvo = ctx.modo === 'dc' ? duty * vdd : ctx.dt * fr > 0.25 ? (g._on ? vdd : 0) : ((ctx.t * fr) % 1 < duty ? vdd : 0);
              else if (modo === 'pullup') { alvo = vdd; rr = 45e3; }
              else if (modo === 'pulldown') { alvo = 0; rr = 45e3; }
              const io = (v[0] - v[2] - alvo) / rr;   // entrando pelo pino
              return [io, sp(-io, 1e-6), -sp(io, 1e-6)].map((x, k) => k === 2 ? -(io + sp(-io, 1e-6)) : x);
            };
            poe(info, { tipo: 'NL', nos: [p.net, vddPino.net, g0.net], f, dc: [[0, 1, 2]], papel: 'GPIO ' + (p.name || p.num), gpio: g,
              reinicia: () => { g._acc = 0; g._on = false; },
              atualiza: (v, e, ctx) => {
                if (g.modo !== 'pwm' || ctx.modo === 'dc' || !(ctx.dt * (+g.f || 1000) > 0.25)) return false;
                g._acc = (g._acc || 0) + (g.duty == null ? 0.5 : +g.duty);
                g._on = g._acc >= 1 - 1e-9;
                if (g._on) g._acc -= 1;
                return false;   // vale no proximo passo
              } }, [pk(info, p), pk(info, vddPino), pk(info, g0)]);
          }
          continue;
        }
      }
      /* --- conector (e o resto): aberto; o comment da parte com tensao vira fonte sugerida */
      if (/^(J|CN|P|X|CON|XS|XP|JP|K)$/.test(pre) || /CONECT|CONN|HEADER|BORNE|TERMINAL|BARRA|MOLEX|KK|JST|USB|RJ45|DB9|P4|JACK/.test(txt)) {
        info.tipo = 'conector'; info.rotulo = 'Conector' + (c.comment && !/CONE|CONN/i.test(c.comment) ? ' ' + c.comment : '');
        info.sugeridas = [];
        for (const p of c.pinos) {
          if (!p.net || ehTerra(p.net)) continue;
          const t = tensaoDoNome(p.comentarioParte || '') ;
          if (t != null && t !== 0) info.sugeridas.push({ net: p.net, v: t, pino: p.num, motivo: 'o pino ' + p.num + ' do ' + ref + ' diz "' + p.comentarioParte + '"' });
        }
        continue;
      }
      info.tipo = ps.length ? 'desconhecido' : 'solto';
      info.rotulo = ps.length ? 'Sem modelo de simulação' : 'Sem pinos ligados';
      if (ps.length) info.avisos.push('sem modelo de simulação: os pinos ficam em alta impedância');
    }

    /* -------- os itens da BANCADA ligados por fio (1.102.0): cfg.externos = [{ref, tipo:'motor_dc'|'fonte', nos:[a, b],
       rotulo, eletrico:{r_ohm, kv_rpm_v, i0_a} | {v, imax_a}}]. O motor DC: R em serie com a forca contraeletromotriz
       E = Ke·w, e a inercia (J·dw/dt = Kt·I − b·w); a fonte de bancada: tensao com resistencia interna. */
    for (const x of cfg.externos || []) {
      if (!x || !x.ref || !Array.isArray(x.nos) || x.nos.length < 2 || !x.nos[0] || !x.nos[1]) continue;
      const el = x.eletrico || {};
      const info = { ref: x.ref, pre: 'BANC', comp: { ref: x.ref, comment: x.rotulo || x.tipo }, tipo: x.tipo === 'fonte' ? 'fonte_bancada' : 'motor', rotulo: x.rotulo || x.tipo, valor: {}, elementos: [],
                     pinos: [{ num: '+', name: '+', net: x.nos[0] }, { num: '-', name: '-', net: x.nos[1] }], avisos: [], interativo: null, valorTxt: '', externo: true };
      comps.set(x.ref, info);
      for (const n of x.nos) usadas.add(n);
      if (x.tipo === 'fonte') {
        const v = +el.v || 12;
        info.rotulo = (x.rotulo || 'Fonte de bancada') + ' ' + fmt(v, 'V');
        info.v = v; info.imax = +el.imax_a || 3;
        const e = poe(info, { tipo: 'V', nos: [x.nos[0], x.nos[1]], v, rs: 0.05, papel: 'fonte de bancada' }, [info.ref + '-+', info.ref + '--']);
        e.pinos = [info.ref + '-+', info.ref + '--'];
        produzidas.add(x.nos[0]);
        continue;
      }
      /* motor DC */
      const R = +el.r_ohm > 0 ? +el.r_ohm : 2.5, kv = +el.kv_rpm_v > 0 ? +el.kv_rpm_v : 2500, i0 = +el.i0_a >= 0 ? +el.i0_a : 0.15;
      const Ke = 60 / (2 * Math.PI * kv);                 // V por rad/s (= Kt em N·m/A)
      const wNom = 6 / Ke;                                // a velocidade sem carga a 6 V (rad/s)
      const bv = Ke * i0 / wNom;                          // atrito viscoso que da a corrente sem carga
      const J = 0.06 * (bv + Ke * Ke / R);                // a partida leva ~60 ms (o freio eletrico Ke²/R entra na conta)
      Object.assign(info, { R, kv, i0, Ke, bv, J, w: 0, rotulo: (x.rotulo || 'Motor DC') + ' (' + fmt(R, 'Ω') + ', ' + kv + ' rpm/V)' });
      /* a INDUTANCIA do enrolamento (equivalente: L/R = 20 ms, para valer com o passo de tempo da tela): com o PWM, quando o
         MOSFET abre a corrente continua pelo diodo de roda livre e o motor ve duty·V na media, como na placa de verdade */
      const meio = x.ref + '#L';
      poe(info, { tipo: 'L', nos: [x.nos[0], meio], l: R * 0.02, papel: 'indutância do motor', interno: true }, [info.ref + '-+', null]);
      const f = (v, e, ctx) => {
        const vm = v[0] - v[1];
        /* no DC: o regime (w = Kt·I/b) -> I = V/(R + Ke²/b); no tempo: a w da inercia */
        const i = ctx.modo === 'dc' ? vm / (R + Ke * Ke / bv) : (vm - Ke * info.w) / R;
        return [i, -i];
      };
      info.el = poe(info, { tipo: 'NL', nos: [meio, x.nos[1]], f, papel: 'motor',
        reinicia: () => { info.w = 0; },
        atualiza: (v, e, ctx) => {
          const vm = v[0] - v[1];
          if (ctx.modo === 'dc') { info.w = Ke * (vm / (R + Ke * Ke / bv)) / bv; return false; }
          const i = (vm - Ke * info.w) / R;
          info.w += ctx.dt * (Ke * i - bv * info.w) / J;
          return false;
        } }, [null, info.ref + '--']);
    }

    /* -------- fontes: as nets de alimentacao pelo nome, as dos conectores, as que a pessoa definiu */
    const fontes = [];
    const cfgF = cfg.fontes || {};
    const temFonte = new Set();
    for (const [net, f] of Object.entries(cfgF)) {
      if (!f || f.desligada) { temFonte.add(net); continue; }
      fontes.push({ net, v: +f.v || 0, onda: f.onda || null, origem: 'definida', motivo: 'definida na simulação' });
      temFonte.add(net);
    }
    for (const net of usadas) {
      if (temFonte.has(net) || ehTerra(net) || produzidas.has(net)) continue;
      const v = tensaoDoNome(net);
      if (v != null) { fontes.push({ net, v, origem: 'nome', motivo: 'o nome da net "' + net + '" diz ' + fmt(v, 'V') }); temFonte.add(net); }
    }
    for (const info of comps.values()) for (const s of info.sugeridas || []) {
      if (temFonte.has(s.net) || produzidas.has(s.net)) continue;
      fontes.push({ net: s.net, v: s.v, origem: 'conector', motivo: s.motivo }); temFonte.add(s.net);
    }
    /* regulador/conversor cuja entrada nao tem fonte nenhuma: supoe a entrada no conector que chega nela */
    const alimentadas = () => new Set(fontes.map(f => f.net));
    for (const info of comps.values()) {
      if (!(info.tipo === 'regulador' || info.tipo === 'conversor') || !info.pIn || !info.pIn.net) continue;
      const vinNet = info.pIn.net;
      if (alimentadas().has(vinNet) || produzidas.has(vinNet)) continue;
      /* sobe pelo caminho serie (fusivel, diodo, ferrite, indutor, resistor baixo) ate um conector */
      const alvo = sobeAteConector(comps, vinNet, ehTerra);
      const net = alvo ? alvo.net : vinNet;
      if (alimentadas().has(net)) continue;
      const vmin = info.modelo && (info.modelo.vout || 0) + (info.modelo.vdo || 2) + 1;
      const v = cfg.entradaPadrao || Math.max(12, Math.ceil((vmin || 0) / 12) * 12);
      fontes.push({ net, v, origem: 'suposta', motivo: 'a entrada do ' + info.ref + ' (' + (alvo ? 'pelo ' + alvo.ref + ' pino ' + alvo.pino : 'net ' + vinNet) + ') não tem fonte: supondo ' + fmt(v, 'V') + ' — mude em Fontes' });
    }
    /* duas nets com a mesma tensao pelo nome e sem ligacao (3V3 e +3.3V): quase sempre e o esquema que esqueceu de juntar */
    const porTensao = new Map();
    for (const f of fontes) if (f.origem === 'nome') { const k = f.v.toFixed(2); if (!porTensao.has(k)) porTensao.set(k, []); porTensao.get(k).push(f.net); }
    for (const [k, ns] of porTensao) if (ns.length > 1) avisos.push('as nets ' + ns.join(', ') + ' têm a mesma tensão pelo nome (' + fmt(+k, 'V') + ') mas não estão ligadas no esquema: cada uma ganhou uma fonte própria');
    /* 1.109.0: o componente QUEIMADO (cfg.queimados[ref] = motivo): sai do circuito — abre, como o de verdade (o LED
       queimado nao acende, o resistor queimado nao conduz) — ate a pessoa trocar */
    const queimados = Object.keys(cfg.queimados || {}).filter(k => cfg.queimados[k]);
    if (queimados.length) {
      const fora = new Set();
      for (const r of queimados) {
        const inf = comps.get(r); if (!inf) continue;
        inf.queimado = true; inf.motivoQueima = String(cfg.queimados[r] === true ? '' : cfg.queimados[r]);
        for (const e of inf.elementos) fora.add(e);
        inf.elementos = [];
      }
      for (let i = elementos.length - 1; i >= 0; i--) if (fora.has(elementos[i])) elementos.splice(i, 1);
      for (const [k, lst] of porPino) porPino.set(k, lst.filter(x => !fora.has(x.el)));
    }
    const terraRef = [...terra][0];
    for (const f of fontes) {
      if (!terraRef) break;
      elementos.push({ tipo: 'V', nos: [f.net, terraRef], v: f.v, onda: f.onda || undefined, rs: 1e-3, ref: 'FONTE:' + f.net, id: 'FONTE:' + f.net, papel: 'fonte ' + f.net, pinos: [null, null], fonte: f });
    }
    if (!fontes.length && !elementos.some(e => e.tipo === 'V')) avisos.push('nenhuma fonte: nomeie as nets de alimentação (+5V, 3V3, 12V...) ou defina uma fonte num conector');

    return { elementos, terra: [...terra], comps, fontes, avisos, porPino, produzidas: [...produzidas] };
  }

  function sobeAteConector(comps, net, ehTerra) {
    const vistos = new Set([net]);
    let fila = [net];
    for (let passo = 0; passo < 4 && fila.length; passo++) {
      const prox = [];
      for (const n of fila) {
        for (const info of comps.values()) {
          if (info.tipo === 'conector') { const p = info.pinos.find(q => q.net === n); if (p) return { ref: info.ref, pino: p.num, net: n }; }
          if (!/^(fusivel|diodo|resistor|indutor|chave)$/.test(info.tipo) || info.pinos.length !== 2) continue;
          if (info.tipo === 'resistor' && info.r > 10) continue;
          const i = info.pinos.findIndex(q => q.net === n);
          if (i < 0) continue;
          const o = info.pinos[1 - i];
          if (o && o.net && !vistos.has(o.net) && !ehTerra(o.net)) { vistos.add(o.net); prox.push(o.net); }
        }
      }
      fila = prox;
    }
    return null;
  }

  function potenciaDoFootprint(fp) {
    const f = norm(fp);
    const m = /\b(0201|0402|0603|0805|1206|1210|1812|2010|2512)\b/.exec(f);
    if (m) return { '0201': 0.05, '0402': 0.0625, '0603': 0.1, '0805': 0.125, '1206': 0.25, '1210': 0.5, '1812': 0.75, '2010': 0.75, '2512': 1 }[m[1]];
    if (/AXIAL|PTH|THT|DO-?35|0207/.test(f)) return 0.25;
    return null;
  }

  /* ================================================================== leitura do resultado: pinos, calculos e alertas */
  function analisa(mt, res) {
    const v = n => (n == null ? NaN : res.v[n] != null ? res.v[n] : NaN);
    const flut = new Set(res.flutuantes || []);
    const elRes = new Map();
    res.el.forEach((r, k) => elRes.set(mt.elementos[k], r));
    const correnteDoPino = key => {
      let i = 0, achou = false;
      for (const { el, k } of mt.porPino.get(key) || []) { const r = elRes.get(el); if (r) { i += r.i[k]; achou = true; } }
      return achou ? i : 0;
    };
    const pinos = {}, comps = {}, nets = {};
    for (const n of Object.keys(res.v)) nets[n] = { v: res.v[n], flutuante: flut.has(n) };
    for (const f of mt.fontes) {
      const el = mt.elementos.find(e => e.id === 'FONTE:' + f.net);
      const r = el && elRes.get(el);
      if (r) { f.i = -r.i[0]; f.p = f.i * v(f.net); }
    }
    const L = (t, f, r) => ({ t, f: f || '', r: r || '' });
    for (const info of mt.comps.values()) {
      const out = { titulo: info.ref + ' — ' + (info.rotulo || info.tipo), linhas: [], alertas: info.avisos.slice(), p: 0, tipo: info.tipo };
      comps[info.ref] = out;
      let p = 0;
      for (const el of info.elementos) { const r = elRes.get(el); if (r) p += r.p; }
      out.p = p;
      if (info.queimado) {
        out.queimado = true; out.motivo = info.motivoQueima || 'passou do limite';
        out.alertas.unshift('QUEIMADO: ' + out.motivo);
        out.linhas.push(L('Estado', 'o componente queimou e abriu: não conduz mais (troque-o)', 'QUEIMADO'));
        out.corrente = 0; out.p = 0;
        if (info.tipo === 'led') { out.brilho = 0; out.cor = info.cor; out.imax = info.imax; out.vf = info.vf; }
        continue;
      }
      const pv = pino => pino && pino.net ? v(pino.net) : NaN;
      const doisPinos = () => { const a = info.pinos[0] || { num: '?' }, b = info.pinos[1] || { num: '?' }; return { a, b, va: pv(a), vb: pv(b), ia: correnteDoPino(info.ref + '-' + a.num) }; };
      switch (info.tipo) {
        case 'resistor': {
          let { a, b, va, vb, ia } = doisPinos();
          /* do lado de tensao maior para o menor: os numeros saem positivos e o sentido fica escrito */
          if (vb > va) { [a, b] = [b, a]; [va, vb] = [vb, va]; ia = -ia; }
          const vr = va - vb;
          out.linhas.push(L('Tensão no resistor', 'V = V(' + (a.net || '?') + ') − V(' + (b.net || '?') + ') = ' + fmt(va, 'V') + ' − ' + fmt(vb, 'V'), fmt(vr, 'V')));
          out.linhas.push(L('Lei de Ohm', 'I = V / R = ' + fmt(vr, 'V') + ' / ' + fmt(info.r, 'Ω'), fmt(Math.abs(ia), 'A')));
          if (Math.abs(ia) > 1e-12) out.linhas.push(L('Sentido', 'a corrente vai de ' + (a.net || 'pino ' + a.num) + ' para ' + (b.net || 'pino ' + b.num), (a.net || a.num) + ' → ' + (b.net || b.num)));
          out.linhas.push(L('Potência', 'P = V² / R = (' + fmt(vr, 'V') + ')² / ' + fmt(info.r, 'Ω'), fmt(vr * vr / info.r, 'W')));
          if (info.potencia && vr * vr / info.r > info.potencia * 0.8) out.alertas.push('dissipa ' + fmt(vr * vr / info.r, 'W') + ': ' + (vr * vr / info.r > info.potencia ? 'ACIMA' : 'perto') + ' da potência nominal (' + fmt(info.potencia, 'W') + ')');
          out.corrente = ia; out.de = ia >= 0 ? a : b;
          break;
        }
        case 'pot': {
          const ra = info.r1 && elRes.get(info.r1), rb = info.r2 && elRes.get(info.r2);
          out.linhas.push(L('Posição do cursor', 'arraste com a roda do mouse sobre o componente', Math.round((info.pos || 0) * 100) + ' %'));
          if (ra && rb) {
            out.linhas.push(L('Trecho ponta–cursor', 'R1 = R·(1 − posição) = ' + fmt(info.r1.r, 'Ω'), fmt(Math.abs(ra.i[0]), 'A')));
            out.linhas.push(L('Trecho cursor–ponta', 'R2 = R·posição = ' + fmt(info.r2.r, 'Ω'), fmt(Math.abs(rb.i[0]), 'A')));
            const v1 = ra.v[0], vw = ra.v[1], v3 = rb.v[1];
            out.linhas.push(L('Divisor de tensão', 'Vcursor = V3 + (V1 − V3)·R2/(R1+R2) = ' + fmt(v3, 'V') + ' + ' + fmt(v1 - v3, 'V') + '·' + fmt(info.r2.r, 'Ω') + '/' + fmt(info.r1.r + info.r2.r, 'Ω'), fmt(vw, 'V')));
          }
          break;
        }
        case 'capacitor': {
          const { a, b, va, vb, ia } = doisPinos(); const vc = va - vb;
          out.linhas.push(L('Tensão no capacitor', 'Vc = ' + fmt(va, 'V') + ' − ' + fmt(vb, 'V'), fmt(vc, 'V')));
          out.linhas.push(L('Carga', 'Q = C·V = ' + fmt(info.c, 'F') + ' · ' + fmt(vc, 'V'), fmt(info.c * vc, 'C')));
          out.linhas.push(L('Energia', 'E = ½·C·V²', fmt(0.5 * info.c * vc * vc, 'J')));
          if (res.modo !== 'dc') out.linhas.push(L('Corrente', 'I = C·dV/dt', fmt(ia, 'A')));
          else out.linhas.push(L('Corrente (DC)', 'em regime o capacitor não conduz', '0 A'));
          if (info.vmax && Math.abs(vc) > info.vmax * 0.8) out.alertas.push('tensão ' + fmt(Math.abs(vc), 'V') + (Math.abs(vc) > info.vmax ? ' ACIMA' : ' perto') + ' da nominal (' + info.vmax + ' V)');
          if (info.polarizado && vc < -0.3) out.alertas.push('capacitor polarizado com tensão invertida (' + fmt(vc, 'V') + ')');
          out.corrente = ia; out.de = ia >= 0 ? a : b;
          break;
        }
        case 'indutor': {
          const { a, b, va, vb, ia } = doisPinos();
          out.linhas.push(L('Corrente no indutor', res.modo === 'dc' ? 'em DC o indutor é um curto' : 'V = L·dI/dt', fmt(ia, 'A')));
          out.linhas.push(L('Energia', 'E = ½·L·I²', fmt(0.5 * info.l * ia * ia, 'J')));
          out.linhas.push(L('Queda', 'V = ' + fmt(va, 'V') + ' − ' + fmt(vb, 'V'), fmt(va - vb, 'V')));
          out.corrente = ia; out.de = ia >= 0 ? a : b;
          break;
        }
        case 'fusivel': {
          const { a, ia } = doisPinos();
          out.linhas.push(L('Corrente', 'I', fmt(Math.abs(ia), 'A')));
          if (info.ihold) { out.linhas.push(L('Corrente de manutenção', 'Ihold', fmt(info.ihold, 'A'))); if (Math.abs(ia) > info.ihold) out.alertas.push('corrente ' + fmt(Math.abs(ia), 'A') + ' acima da de manutenção (' + fmt(info.ihold, 'A') + '): o fusível abre'); }
          out.corrente = ia; out.de = a;
          break;
        }
        case 'led': case 'diodo': {
          const r = info.d && elRes.get(info.d);
          const a = info.pinos.find(p => info.d && info.d.pinos[0] === info.ref + '-' + p.num) || info.pinos[0];
          const vak = r ? (info.d.pinos[0] ? r.v[0] - r.v[1] : NaN) : NaN;
          const i = r ? r.i[0] : 0;
          const vtot = (() => { const pa = info.pinos.find(p => /^(A|ANODE|ANODO|\+|1)$/i.test(p.name || '')) || info.pinos[0], pk_ = info.pinos.find(p => p !== pa); return pv(pa) - pv(pk_); })();
          out.linhas.push(L('Tensão anodo–catodo', 'Vak', fmt(isFinite(vak) ? vak : vtot, 'V')));
          out.linhas.push(L('Corrente direta', 'I = Is·(e^(V/(n·Vt)) − 1)', fmt(i, 'A')));
          out.linhas.push(L('Potência', 'P = V·I', fmt(p, 'W')));
          if (info.tipo === 'led') {
            out.brilho = Math.max(0, Math.min(1, i / 0.015));
            out.cor = info.cor;
            out.linhas.push(L('Brilho', 'proporcional à corrente (15 mA = 100 %)', Math.round(out.brilho * 100) + ' %'));
            /* o resistor em serie: R = (V − Vf)/I */
            const kNet = (info.pinos.find(p => /^(K|C|CATHODE|CATODO|-|2)$/i.test(p.name || '')) || info.pinos[1] || {}).net;
            const aNet = (info.pinos.find(p => /^(A|ANODE|ANODO|\+|1)$/i.test(p.name || '')) || info.pinos[0] || {}).net;
            const rs = [...mt.comps.values()].find(o => o.tipo === 'resistor' && o.pinos.some(q => q.net === aNet || (q.net === kNet && !(mt.terra || []).includes(kNet))) && o !== info);
            if (rs && i > 1e-5) {
              const outro = rs.pinos.find(q => q.net !== aNet && q.net !== kNet);
              const vfonte = outro ? v(outro.net) : NaN;
              if (isFinite(vfonte)) out.linhas.push(L('Resistor de limitação (' + rs.ref + ')', 'I = (V' + (outro.net || '') + ' − Vf − V(cat.)) / R = (' + fmt(vfonte, 'V') + ' − ' + fmt(vtot, 'V') + ') / ' + fmt(rs.r, 'Ω'), fmt((vfonte - vtot - (kNet ? 0 : 0)) / rs.r, 'A')));
            }
            if (i > (info.imax || 0.02)) out.alertas.push('corrente acima da nominal do LED (' + fmt(i, 'A') + ' > ' + fmt(info.imax || 0.02, 'A') + ')');
            out.imax = info.imax || 0.02; out.vf = info.vf;
            out.linhas.push(L('Estado', i < 1e-4 ? 'apagado: a tensão não chega ao Vf (' + fmt(info.vf, 'V') + ')' : 'aceso', i < 1e-4 ? 'apagado' : 'aceso'));
            if (vtot < -5) out.alertas.push('LED com tensão reversa de ' + fmt(-vtot, 'V') + ' (máx. ≈ 5 V)');
          } else if (info.bv && vtot < -info.bv * 0.9) out.linhas.push(L('Em ruptura', 'zener/TVS conduzindo ao contrário: Vz ≈ ' + fmt(info.bv, 'V'), fmt(-i, 'A')));
          out.corrente = i;
          break;
        }
        case 'bjt': {
          const r = elRes.get(info.q); if (!r) break;
          const [vc, vb, ve] = r.v, [ic, ib] = r.i;
          const pol = info.m.pol;
          out.linhas.push(L('Base–emissor', 'Vbe = ' + fmt(vb, 'V') + ' − ' + fmt(ve, 'V'), fmt(vb - ve, 'V')));
          out.linhas.push(L('Coletor–emissor', 'Vce', fmt(vc - ve, 'V')));
          out.linhas.push(L('Corrente de base', 'Ib', fmt(ib, 'A')));
          out.linhas.push(L('Corrente de coletor', 'Ic', fmt(ic, 'A')));
          const est = pol * (vb - ve) < 0.5 ? 'corte' : pol * (vc - ve) < 0.3 ? 'saturação' : 'ativo';
          out.linhas.push(L('Região', est === 'ativo' ? 'Ic = β·Ib = ' + info.m.bf + ' · ' + fmt(ib, 'A') : est === 'saturação' ? 'β·Ib > Ic: a chave está fechada (Vce baixo)' : 'Vbe abaixo de ~0,6 V: não conduz', est));
          out.linhas.push(L('Potência', 'P = Vce·Ic + Vbe·Ib', fmt(p, 'W')));
          if (Math.abs(p) > (/TO-?92|SOT/.test(norm(info.comp.footprint)) ? 0.5 : 1.5)) out.alertas.push('dissipação alta para o encapsulamento (' + fmt(p, 'W') + ')');
          out.estado = est;
          break;
        }
        case 'mosfet': {
          const r = elRes.get(info.q); if (!r) break;
          const [vd, vg, vs] = r.v, id = r.i[0];
          out.linhas.push(L('Gate–source', 'Vgs = ' + fmt(vg, 'V') + ' − ' + fmt(vs, 'V'), fmt(vg - vs, 'V')));
          out.linhas.push(L('Dreno–source', 'Vds', fmt(vd - vs, 'V')));
          out.linhas.push(L('Corrente de dreno', 'Id', fmt(id, 'A')));
          const est = info.m.pol * (vg - vs) < info.m.vth ? 'cortado' : 'conduzindo';
          out.linhas.push(L('Estado', 'Vth ≈ ' + fmt(info.m.pol * info.m.vth, 'V'), est));
          if (est === 'conduzindo' && Math.abs(id) > 1e-4) out.linhas.push(L('Rds(on) efetiva', 'R = Vds / Id', fmt(Math.abs((vd - vs) / id), 'Ω')));
          out.linhas.push(L('Potência', 'P = Vds·Id', fmt(p, 'W')));
          out.estado = est;
          break;
        }
        case 'chave': {
          const { a, ia } = doisPinos();
          out.linhas.push(L(info.fechada ? 'Fechada' : 'Aberta', info.interativo === 'botao' ? 'segure o clique no botão para apertar' : 'clique para abrir/fechar', info.fechada ? fmt(Math.abs(ia), 'A') : '—'));
          out.corrente = info.sw ? (elRes.get(info.sw) || { i: [0] }).i[0] : 0;
          break;
        }
        case 'rele': {
          out.linhas.push(L('Bobina', info.ligado ? 'energizada (acima de 75 % de ' + fmt(info.vbob, 'V') + ')' : 'desligada', info.ligado ? 'LIGADO' : 'desligado'));
          break;
        }
        case 'bateria': {
          const el = info.elementos[0], r = elRes.get(el);
          if (r) { out.linhas.push(L('Corrente entregue', 'I', fmt(-r.i[0], 'A'))); out.linhas.push(L('Potência entregue', 'P = V·I', fmt(-r.p, 'W'))); }
          break;
        }
        case 'regulador': {
          const r = elRes.get(info.reg); if (!r) break;
          const [vin, vout, vg] = r.v, [iin, iout] = r.i;
          const io = -iout, pd = (vin - vout) * io + (vin - vg) * (iin - io);
          out.linhas.push(L('Entrada', 'Vin = V(' + (info.pIn && info.pIn.net) + ')', fmt(vin - vg, 'V')));
          out.linhas.push(L('Saída', info.modelo.adj ? 'Vout = 1,25 V·(1 + R2/R1) (+ Iadj·R2)' : 'Vout regulada = ' + fmt(info.modelo.vout, 'V'), fmt(vout - vg, 'V')));
          out.linhas.push(L('Corrente de saída', 'Iout (a carga)', fmt(io, 'A')));
          out.linhas.push(L('Queda (dropout)', 'Vin − Vout = ' + fmt(vin - vout, 'V') + ' (mínimo ≈ ' + fmt(info.modelo.vdo, 'V') + ')', (vin - vout) < info.modelo.vdo * 1.05 ? 'NO LIMITE' : 'ok'));
          out.linhas.push(L('Dissipação', 'P = (Vin − Vout)·Iout + Vin·Iq = ' + fmt(vin - vout, 'V') + '·' + fmt(io, 'A'), fmt(pd, 'W')));
          out.linhas.push(L('Rendimento', 'η = Vout·Iout / (Vin·Iin)', isFinite((vout - vg) * io / ((vin - vg) * iin)) ? Math.round(100 * (vout - vg) * io / ((vin - vg) * iin)) + ' %' : '—'));
          if (vin - vout < info.modelo.vdo * 1.05 && vin - vg > 0.5) out.alertas.push('em dropout: a entrada (' + fmt(vin - vg, 'V') + ') não dá a saída nominal');
          if (pd > (/SOT-?223|DPAK|TO-?252/.test(norm(info.comp.footprint)) ? 1 : /SOT-?23|SOT-?89/.test(norm(info.comp.footprint)) ? 0.3 : 2)) out.alertas.push('dissipação de ' + fmt(pd, 'W') + ': precisa de cobre/dissipador');
          if (io > info.modelo.ilim * 0.95) out.alertas.push('no limite de corrente (' + fmt(info.modelo.ilim, 'A') + ')');
          out.p = pd;
          break;
        }
        case 'conversor': {
          const r = elRes.get(info.reg); if (!r) break;
          const [vin, vsw, vg, vfb] = r.v, [iin, isw] = r.i;
          const io = -isw;
          out.linhas.push(L('Entrada', 'Vin', fmt(vin - vg, 'V')));
          out.linhas.push(L('Realimentação', 'o conversor ajusta a saída até V(FB) = ' + fmt(info.modelo.vfb, 'V'), fmt(vfb - vg, 'V')));
          out.linhas.push(L('Saída', 'V(SW) médio', fmt(vsw - vg, 'V')));
          out.linhas.push(L('Corrente de saída', 'Iout', fmt(io, 'A')));
          out.linhas.push(L('Corrente de entrada', 'Iin = Vout·Iout / (η·Vin) = ' + fmt(vsw - vg, 'V') + '·' + fmt(io, 'A') + ' / (' + info.modelo.eta + '·' + fmt(vin - vg, 'V') + ')', fmt(iin, 'A')));
          out.linhas.push(L('Perda', 'P = Pin − Pout', fmt((vin - vg) * iin - (vsw - vg) * io, 'W')));
          out.linhas.push(L('Modelo', 'médio (sem o chaveamento); o indutor e o diodo de roda livre ficam no caminho DC', ''));
          if (Math.abs(vfb - vg - info.modelo.vfb) > 0.05 * info.modelo.vfb && vin - vg > 1) out.alertas.push('fora de regulação: FB em ' + fmt(vfb - vg, 'V') + ' (devia ser ' + fmt(info.modelo.vfb, 'V') + ')');
          break;
        }
        case '555': {
          out.linhas.push(L('Flip-flop', 'liga quando TRIG < ⅓·Vcc, desliga quando THR > ⅔·Vcc', info.q ? 'saída ALTA' : 'saída baixa'));
          const rs = [...mt.comps.values()].filter(o => o.tipo === 'resistor'), cs = [...mt.comps.values()].filter(o => o.tipo === 'capacitor');
          const pinoNet = num => (info.pinos.find(p => String(p.num) === String(num)) || {}).net;
          const dis = pinoNet(7), thr = pinoNet(6), vcc = pinoNet(8);
          const ra = rs.find(o => o.pinos.some(q => q.net === vcc) && o.pinos.some(q => q.net === dis));
          const rb = rs.find(o => o.pinos.some(q => q.net === dis) && o.pinos.some(q => q.net === thr));
          const ct = cs.find(o => o.pinos.some(q => q.net === thr) && o.pinos.some(q => (mt.terra || []).includes(q.net)));
          if (ra && rb && ct) {
            const th = 0.693 * (ra.r + rb.r) * ct.c, tl = 0.693 * rb.r * ct.c;
            out.linhas.push(L('Astável: tempo alto', 'tH = 0,693·(RA + RB)·C = 0,693·(' + fmt(ra.r, 'Ω') + ' + ' + fmt(rb.r, 'Ω') + ')·' + fmt(ct.c, 'F'), fmt(th, 's')));
            out.linhas.push(L('Astável: tempo baixo', 'tL = 0,693·RB·C', fmt(tl, 's')));
            out.linhas.push(L('Frequência', 'f = 1,44 / ((RA + 2·RB)·C)', fmt(1 / (th + tl), 'Hz')));
            out.linhas.push(L('Ciclo de trabalho', 'D = tH / (tH + tL)', Math.round(100 * th / (th + tl)) + ' %'));
          }
          break;
        }
        case 'opamp': case 'comparador': {
          for (const ch of info.canais || []) {
            const r = elRes.get(ch.el); if (!r) continue;
            const [vp, vn, vo, vcc, vee] = r.v;
            out.linhas.push(L('Canal ' + ch.L, 'V+ = ' + fmt(vp, 'V') + ', V− = ' + fmt(vn, 'V') + (info.tipo === 'opamp' ? ', Vout = A·(V+ − V−) limitada às trilhas' : ': saída ' + (vp > vn ? 'aberta (alta)' : 'puxada a GND')), fmt(vo, 'V')));
            if (info.tipo === 'opamp' && (vo > vcc - 1.6 || vo < vee + 0.06) && Math.abs(vp - vn) > 1e-3) out.alertas.push('canal ' + ch.L + ' saturado (' + fmt(vo, 'V') + ')');
          }
          break;
        }
        case 'motor': {
          const r = elRes.get(info.el); if (!r) break;
          const vm = r.v[0] - r.v[1], i = r.i[0];
          const rpm = info.w * 60 / (2 * Math.PI);
          out.rpm = rpm; out.corrente = i; out.tensao = vm; out.kv = info.kv;
          out.linhas.push(L('Tensão no motor', 'V', fmt(vm, 'V')));
          out.linhas.push(L('Corrente', res.modo === 'dc' ? 'I = V / (R + Ke²/b) (regime)' : 'I = (V − Ke·ω) / R = (' + fmt(vm, 'V') + ' − ' + fmt(info.Ke * info.w, 'V') + ') / ' + fmt(info.R, 'Ω'), fmt(i, 'A')));
          out.linhas.push(L('Rotação', 'ω·60/2π (Kv = ' + info.kv + ' rpm/V)', Math.round(rpm).toLocaleString('pt-BR') + ' rpm'));
          out.linhas.push(L('Força contraeletromotriz', 'E = Ke·ω', fmt(info.Ke * info.w, 'V')));
          out.linhas.push(L('Potência', 'P = V·I (mecânica ≈ E·I)', fmt(vm * i, 'W') + ' (' + fmt(info.Ke * info.w * i, 'W') + ' no eixo)'));
          if (Math.abs(vm) > 0.3 && Math.abs(rpm) < 50) out.alertas.push('motor travado ou sem tensão suficiente (' + fmt(vm, 'V') + ')');
          if (Math.abs(i) > 2) out.alertas.push('corrente alta no motor (' + fmt(i, 'A') + ')');
          break;
        }
        case 'fonte_bancada': {
          const r = info.elementos[0] && elRes.get(info.elementos[0]); if (!r) break;
          out.linhas.push(L('Tensão', 'ajustada', fmt(info.v, 'V')));
          out.linhas.push(L('Corrente entregue', 'I', fmt(-r.i[0], 'A')));
          if (-r.i[0] > info.imax) out.alertas.push('acima do limite da fonte (' + fmt(info.imax, 'A') + ')');
          break;
        }
        case 'opto': {
          const r = elRes.get(info.ci); if (!r) break;
          out.linhas.push(L('LED interno', 'If', fmt(r.i[0], 'A')));
          out.linhas.push(L('Transistor', 'Ic = CTR·If (limitado pela saturação)', fmt(r.i[2], 'A')));
          break;
        }
        case 'mcu': case 'ci': {
          if (info.fam) for (const pa of info.alim || []) {
            const vv = v(pa.net) - (info.gnd ? v(info.gnd.net) : 0);
            out.linhas.push(L('Alimentação ' + (pa.name || pa.num), 'faixa ' + fmt(info.fam.vmin, 'V') + ' a ' + fmt(info.fam.vmax, 'V'), fmt(vv, 'V')));
            if (vv < info.fam.vmin) out.alertas.push('alimentação ' + fmt(vv, 'V') + ' ABAIXO da mínima (' + fmt(info.fam.vmin, 'V') + ')');
            if (vv > info.fam.vmax) out.alertas.push('alimentação ' + fmt(vv, 'V') + ' ACIMA da máxima (' + fmt(info.fam.vmax, 'V') + ')');
          }
          if (info.fam) out.linhas.push(L('Consumo', 'corrente típica de operação', fmt(info.fam.iq, 'A')));
          break;
        }
      }
      if (Math.abs(out.p) > 1e-9 && !out.linhas.some(l => /Pot[eê]ncia|Dissipa/.test(l.t))) out.linhas.push(L('Potência', 'P = Σ V·I nos pinos', fmt(out.p, 'W')));
    }
    /* os pinos */
    for (const info of mt.comps.values()) {
      const vdd = info.alim && info.alim[0] ? v(info.alim[0].net) - (info.gnd ? v(info.gnd.net) : 0) : NaN;
      for (const p of info.pinos) {
        const key = info.ref + '-' + p.num;
        const vp = p.net ? v(p.net) : NaN;
        const i = correnteDoPino(key);
        let papel = '', alerta = '';
        const nome = String(p.name || '').trim();
        if (PINOS_ALIM.test(nome) && (info.tipo === 'mcu' || info.tipo === 'ci')) {
          papel = 'alimentação';
          if (info.fam) { papel += ' (' + fmt(info.fam.vmin, 'V') + '–' + fmt(info.fam.vmax, 'V') + ')'; if (vp < info.fam.vmin || vp > info.fam.vmax) alerta = 'fora da faixa'; else papel += ' ✓'; }
        } else if (PINOS_TERRA.test(nome) && (info.tipo === 'mcu' || info.tipo === 'ci')) papel = 'terra';
        else if (info.tipo === 'mcu' || info.tipo === 'ci' || info.tipo === 'desconhecido') {
          const g = mtGpio(mt, key);
          if (g) papel = 'GPIO ' + ({ alto: 'saída ALTA', baixo: 'saída BAIXA', pwm: 'PWM ' + Math.round((g.duty == null ? 0.5 : g.duty) * 100) + ' %', entrada: 'entrada', pullup: 'entrada com pull-up', pulldown: 'entrada com pull-down' }[g.modo] || g.modo);
          else papel = 'sinal';
          if (isFinite(vdd) && p.net && !flut.has(p.net)) {
            const vih = 0.7 * vdd, vil = 0.3 * vdd;
            if (!g || g.modo === 'entrada' || g.modo === 'pullup' || g.modo === 'pulldown') papel += vp >= vih ? ' — lê 1' : vp <= vil ? ' — lê 0' : ' — nível indefinido';
            if (vp > vdd + 0.3) alerta = 'acima da alimentação do CI (' + fmt(vdd, 'V') + ')';
            if (vp < -0.3) alerta = 'abaixo do terra';
          }
          if (Math.abs(i) > 0.04 && info.tipo === 'mcu') alerta = 'corrente de ' + fmt(Math.abs(i), 'A') + ' acima do que um GPIO aguenta (~40 mA)';
        }
        if (p.net && flut.has(p.net)) papel = (papel ? papel + ' — ' : '') + 'flutuando (sem caminho DC até o terra)';
        pinos[key] = { ref: info.ref, num: p.num, nome, net: p.net || '', v: vp, i, papel, alerta,
          texto: info.ref + ' pino ' + p.num + (nome && nome !== String(p.num) ? ' (' + nome + ')' : '') };
      }
    }
    /* resumo */
    let pTot = 0;
    for (const f of mt.fontes) if (isFinite(f.p)) pTot += f.p;
    const alertas = [];
    for (const [ref, c] of Object.entries(comps)) for (const a of c.alertas) alertas.push({ ref, texto: a });
    return { pinos, comps, nets, fontes: mt.fontes, resumo: { potencia: pTot, fontes: mt.fontes.length, alertas, t: res.t, modo: res.modo, ok: res.ok, aviso: res.aviso } };
  }
  function mtGpio(mt, key) { return mt.cfg && mt.cfg.gpio ? mt.cfg.gpio[key] : null; }

  /* ================================================================== o esquema da vista (ou do arquivo) -> componentes */
  const RE_VALUE = /(?:^|;)\s*Value\s*=\s*([^;]*)/i;
  function paramDe(c, nome) {
    for (const par of String((c && c.params) || '').split(';')) { const i = par.indexOf('='); if (i > 0 && par.slice(0, i).trim().toLowerCase() === nome.toLowerCase()) return par.slice(i + 1).trim(); }
    return '';
  }
  function commentResolvido(c) {
    const cm = String((c && c.comment) || '').trim();
    if (cm.charAt(0) !== '=') return cm;
    return cm.slice(1).split('+').map(t => { t = t.trim(); const q = /^['"](.*)['"]$/.exec(t); return q ? q[1] : paramDe(c, t); }).join('').trim();
  }
  /* opts.emergencia(c) -> {part} : o desenho EMPRESTADO que a vista usa quando o símbolo do componente não está na
     biblioteca (schframe.js » desenhoDeEmergencia). O extractNets não conhece esses pinos; aqui a net de cada um sai do
     que encosta na ponta quente: ponta ou meio de fio, rótulo, power, port ou o pino de outro componente. */
  function doEsquema(model, schlib, nets, HC, opts) {
    const o = opts || {};
    const out = [];
    const indices = new Map();
    const indice = si => {
      if (indices.has(si)) return indices.get(si);
      const sh = model.sheets[si], pts = [], segs = [];
      const wn = (nets.wireNet && nets.wireNet[si]) || [];
      sh.wires.forEach((w, wi) => {
        const n = wn[wi] || ('fio' + si + '_' + wi);
        const ps = w.pts || [];
        ps.forEach(p => pts.push({ x: p[0], y: p[1], net: n }));
        for (let k = 0; k < ps.length - 1; k++) segs.push({ x1: ps[k][0], y1: ps[k][1], x2: ps[k + 1][0], y2: ps[k + 1][1], net: n });
      });
      for (const l of [].concat(sh.netlabels || [], sh.powers || [], sh.ports || [])) pts.push({ x: l.x, y: l.y, net: l.net });
      for (const c of sh.comps) {
        let ps = null; try { ps = HC.compPinsWorld(c, schlib); } catch (_e) { ps = null; }
        for (const p of ps || []) { const n = nets.pinNet[c.ref + '-' + p.num]; if (n) pts.push({ x: p.x, y: p.y, net: n }); }
      }
      const r = { pts, segs };
      indices.set(si, r);
      return r;
    };
    const netEm = (si, x, y) => {
      const I = indice(si);
      for (const p of I.pts) if (Math.abs(p.x - x) <= 0.6 && Math.abs(p.y - y) <= 0.6) return p.net;
      for (const g of I.segs) {
        const L = Math.hypot(g.x2 - g.x1, g.y2 - g.y1); if (!L) continue;
        const t = ((x - g.x1) * (g.x2 - g.x1) + (y - g.y1) * (g.y2 - g.y1)) / (L * L);
        if (t < 0 || t > 1) continue;
        if (Math.hypot(g.x1 + t * (g.x2 - g.x1) - x, g.y1 + t * (g.y2 - g.y1) - y) <= 0.6) return g.net;
      }
      return '';
    };
    model.sheets.forEach((s, si) => {
      for (const c of s.comps) {
        let pinos = [], emprestado = false;
        let ps = null;
        try { ps = HC.compPinsWorld(c, schlib); } catch (_e) { ps = null; }
        if (ps && ps.length) pinos = ps.map(p => ({ num: String(p.num), name: p.name || '', net: nets.pinNet[c.ref + '-' + p.num] || '', x: p.x, y: p.y, folha: si }));
        else if (typeof o.emergencia === 'function') {
          const e = o.emergencia(c);
          if (e && e.part && e.part.pins) {
            const tf = HC.compTransform(c);
            pinos = e.part.pins.map(p => { const h = HC.pinHot(p), w = tf.map(h.x, h.y); return { num: String(p.num), name: p.name || '', net: netEm(si, w.x, w.y), x: w.x, y: w.y, folha: si, emprestado: true }; });
            emprestado = true;
          }
        }
        const m = RE_VALUE.exec(String(c.params || ''));
        const valor = m ? m[1].trim() : (/^[RCL]\d/i.test(c.ref) ? commentResolvido(c) : '');
        out.push({ ref: c.ref, sym: c.sym, comment: commentResolvido(c), valor, params: c.params, footprint: c.footprint, dnp: !!c.dnp, part: c.part || 1, folha: si, pinos, emprestado });
      }
    });
    return out;
  }

  /* A CHAVE DO COMPONENTE nos dados de datasheet (Libs/componentes-dados.json, "Recolher informações"): o numero da
     peca (o comment: ESP32-WROOM-32, AMS1117-3.3, BC337), senao o valor, senao o simbolo — em maiusculas, sem espacos
     sobrando. Passivo (R, C, L, ferrite) nao precisa de datasheet: null */
  const PASSIVOS = /^(resistor|capacitor|indutor|pot|fusivel|chave|conector|ignorado|fora|solto|carga|bateria|led)$/;
  function chaveDados(c, tipo) {
    if (tipo && PASSIVOS.test(tipo)) return null;
    const bruto = [c && c.comment, c && c.valor, c && c.sym].map(x => String(x || '').trim()).find(x => x && x.charAt(0) !== '=' && !/^(CONE|CONN|JUMPER|-|\*)/i.test(x));
    return bruto ? norm(bruto).replace(/\s+/g, ' ') : null;
  }
  /* os dados de um componente: pela chave, pelos apelidos de cada registro, ou pelo comeco (ESP32-WROOM-32D acha ESP32-WROOM-32) */
  function dadosDe(banco, c, tipo) {
    if (!banco || !banco.componentes) return null;
    const k = chaveDados(c, tipo);
    if (!k) return null;
    const B = banco.componentes;
    if (B[k]) return Object.assign({ chave: k }, B[k]);
    for (const [ch, d] of Object.entries(B)) if ((d.apelidos || []).some(a => norm(a) === k)) return Object.assign({ chave: ch }, d);
    let melhor = null;
    for (const [ch, d] of Object.entries(B)) if (k.startsWith(ch) && ch.length >= 5 && (!melhor || ch.length > melhor.chave.length)) melhor = Object.assign({ chave: ch }, d);
    return melhor;
  }
  /* o numero do GPIO pelo nome do pino do MCU: IO25, GPIO25, IO25/ADC2_8, D25, SENSOR_VP (36)... */
  function gpioDe(nome) {
    const n = norm(nome).replace(/[\s-]+/g, '_');
    const esp = { TXD0: 1, U0TXD: 1, TXD: 1, RXD0: 3, U0RXD: 3, RXD: 3, SENSOR_VP: 36, VP: 36, SENSOR_VN: 39, VN: 39 };
    if (esp[n] !== undefined) return esp[n];
    const m = /^(?:GPIO|IO|D|P)_?(\d{1,2})(?![0-9])/.exec(n) || /(?:^|[/_])(?:GPIO|IO)_?(\d{1,2})(?:$|[/_])/.exec(n);
    return m ? +m[1] : null;
  }
  /* as ENTRADAS da placa para a config de fontes: {"CN2-1": 12, "+5V": 5, "J1-3": {v, onda}, "CN2-2": null} -> {net: {v,
     onda} | null}. A chave e um pino (REF-NUM) ou o nome de uma net; null tira a fonte (o pino fica aberto, so mede) */
  function entradasParaFontes(componentes, entradas) {
    const porPino = new Map(), nets = new Set();
    for (const c of componentes || []) for (const p of c.pinos || []) if (p.net) { porPino.set(c.ref + '-' + p.num, p.net); nets.add(p.net); }
    const out = {};
    for (const [k, val] of Object.entries(entradas || {})) {
      const net = porPino.get(k) || (nets.has(k) ? k : null);
      if (!net) throw new Error('entrada "' + k + '": não é pino (REF-NUM) nem net do esquema');
      if (val === null || val === false) { out[net] = null; continue; }
      const o = typeof val === 'object' ? val : { v: +val };
      out[net] = { v: +o.v || 0, onda: o.onda || null, desligada: false };
    }
    return out;
  }
  /* VERIFICAR: [{alvo: "CN2-3" | net | "U1" (componente: a potencia), min, max, esperado, tol (padrao 5 % ou 50 mV),
     grandeza: "v" | "i" | "p"}] contra a analise -> [{alvo, medido, ok, motivo}] */
  function verifica(an, lista) {
    return (lista || []).map(q => {
      const g = q.grandeza || 'v';
      let medido = NaN, de = '';
      const pin = an.pinos[q.alvo];
      if (pin) { medido = g === 'i' ? pin.i : g === 'p' ? pin.i * pin.v : pin.v; de = 'pino'; }
      else if (an.nets[q.alvo]) { medido = an.nets[q.alvo].v; de = 'net'; }
      else if (an.comps[q.alvo]) { const c = an.comps[q.alvo]; medido = g === 'i' ? c.corrente : c.p; de = 'componente'; }
      if (!isFinite(medido)) return { alvo: q.alvo, ok: false, medido: null, motivo: 'não achei "' + q.alvo + '" (pino REF-NUM, net ou componente)' };
      let ok = true, motivo = '';
      if (q.esperado != null) {
        const tol = q.tol != null ? +q.tol : Math.max(Math.abs(q.esperado) * 0.05, g === 'v' ? 0.05 : 1e-6);
        ok = Math.abs(medido - q.esperado) <= tol;
        motivo = 'esperado ' + q.esperado + ' ± ' + tol;
      }
      if (q.min != null && medido < q.min) { ok = false; motivo += (motivo ? '; ' : '') + 'abaixo do mínimo ' + q.min; }
      if (q.max != null && medido > q.max) { ok = false; motivo += (motivo ? '; ' : '') + 'acima do máximo ' + q.max; }
      const u = g === 'i' ? 'A' : g === 'p' ? 'W' : 'V';
      return { alvo: q.alvo, de, grandeza: g, medido, medido_txt: fmt(medido, u), ok, motivo: motivo || 'dentro' };
    });
  }

  /* monta + guarda a config (para o analisa saber o modo dos GPIO) */
  function montaComConfig(componentes, cfg) { const m = monta(componentes, cfg); m.cfg = cfg || {}; return m; }

  return { monta: montaComConfig, analisa, doEsquema, entradasParaFontes, verifica, gpioDe, chaveDados, dadosDe, leValor, fmt, tensaoDoNome, RE_TERRA, commentResolvido, potenciaDoFootprint };
});
