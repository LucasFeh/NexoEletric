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
    /* 1.114.0: o numero solto (o "3296W" do trimpot e codigo, nao 3296 W) */
    const pot = /(\d+)\s*\/\s*(\d+)\s*W\b/i.exec(s) || /(?:^|[\s/_%-])(\d{1,3}(?:\.\d+)?)\s*(m?)W\b/i.exec(s);   // 1.115.0: o "5%50W" tambem
    if (pot) out.potencia = pot[2] && /^\d+$/.test(pot[2]) && pot[0].includes('/') ? +pot[1] / +pot[2] : +pot[1] * (pot[2] === 'm' ? 1e-3 : 1);
    /* 1.113.0 (lote 1 da lib Almox): a tensao em kV ("3KV", "1.2kV") */
    const kv = /(?:^|[\s/_(-])(\d+(?:\.\d+)?)\s*KV(?:DC|AC)?\b/i.exec(s);
    const ten = /(?:^|[\s/_(-])(\d+(?:\.\d+)?)\s*V(?:DC|AC)?\b/i.exec(s);
    if (kv) out.tensao = +kv[1] * 1000; else if (ten) out.tensao = +ten[1];
    const cor = /(?:^|[\s/_(-])(\d+(?:\.\d+)?)\s*(m?)A\b/.exec(s);   // 1.113.0: o "1N751A" nao e corrente
    if (cor) out.corrente = +cor[1] * (cor[2] ? 1e-3 : 1);
    /* 1.113.0: o numero separado da unidade ("100 nF", "3300 pF") e a unidade em maiuscula ("47PF") */
    const s2 = s.replace(/(\d)\s+([pnuµμmkKMGPNU]?(?:F|H|Ω|OHMS?)\b)/gi, '$1$2');
    /* cada token que e um valor: 4K7, 1R5, 2M2, 10k, 100nF, 0.1uF, 330uH, 10Ω (o "PR03" nao conta: comeca com letra) */
    const leTok = t => {
      let m = /^(\d+)([pnuµμmkKMGRrE])(\d+)$/.exec(t);
      if (m) return { v: parseFloat(m[1] + '.' + m[3]) * PREF[m[2]], pre: /[RrE]/.test(m[2]) ? '' : m[2], un: /[RrE]/.test(m[2]) ? 'Ω' : '', t };
      m = /^(\d+(?:\.\d+)?)([pnuµμmkKMGPNU]?)(F|H|Ω|OHM|R)?$/i.exec(t.replace(/ohms?$/i, ''));
      if (!m) return null;
      const un = (m[3] || '').toUpperCase() === 'F' ? 'F' : (m[3] || '').toUpperCase() === 'H' ? 'H' : m[3] ? 'Ω' : '';
      let pre = m[2] || '';
      if (/^[PNU]$/.test(pre)) pre = pre.toLowerCase();
      const mult = !pre ? 1 : pre === 'm' && /^[FH]$/.test(un) ? 1e-3 : pre === 'M' && un === 'F' ? 1e-6 : PREF[pre] || 1;
      return { v: parseFloat(m[1]) * mult, pre, un, t };
    };
    const toks = s2.split(/[\s/;()]+/).filter(x => /^\d/.test(x) && !/^\d+(?:\.\d+)?k?V(?:DC|AC)?$/i.test(x) && !/W$/i.test(x) && !/^\d+(?:\.\d+)?m?A$/.test(x) && !/%$/.test(x) && !/\d(?:MM|CM)$/i.test(x));   // 1.115.0: o "5.8mm" nao e valor
    const lidos = toks.map(leTok).filter(Boolean);
    out.toks = lidos;
    let esc = lidos[0] || null;
    /* "0.01F/10nF" e "0.0022 uF / 2.2nF": com um valor em pF/nF/uF junto, vale ele (o "F" sem prefixo das pecas antigas) */
    if (esc && esc.un === 'F' && !esc.pre) { const o = lidos.find(x => x !== esc && /^[pnuµμ]$/.test(x.pre)); if (o) esc = o; }
    if (esc) { out.v = esc.v; out.un = esc.un; out.pre = esc.pre; out.tok = esc.t; return out; }
    const m = /^(\d+(?:\.\d+)?)$/.exec(toks.find(x => /^\d+(?:\.\d+)?$/.test(x)) || '');
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
    /* 1.114.0: tira os zeros a direita das casas ("6,300 V" lia como milhar: 6,3 V) */
    let t = n.toFixed(c);
    if (t.includes('.')) t = t.replace(/0+$/, '').replace(/\.$/, '');
    return t.replace('.', ',') + ' ' + p[1] + u;
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
    [/ULTRA ?VERDE|ULTRA ?GREEN|\bUGC\b|SM\d+UGC|INGAN|PURE ?GREEN|TRUE ?GREEN|VERDE PURO/, 3.0, '#22e06a'],
    /* 1.113.0: o infravermelho antes do vermelho ("INFRAVERMELHO") e o RED inteiro (o "REDONDO" do amarelo virava vermelho) */
    [/\bIR\b|INFRA|\b(?:8[5-9]\d|9[0-6]\d)\s*NM\b/, 1.2, '#b0306a'], [/\bUV\b|ULTRAVIOLET/, 3.3, '#bf5af2'],
    [/VERMELH|\bRED\b|\bVM\b/, 1.9, '#ff3b30'], [/LARANJA|ORANGE/, 2.0, '#ff9500'], [/AMAREL|YELLOW|\bAM\b/, 2.0, '#ffd60a'],
    [/VERDE|GREEN|\bVD\b/, 2.1, '#34c759'], [/AZUL|BLUE/, 3.0, '#0a84ff'], [/BRANC|WHITE|\bBR\b/, 3.0, '#f5f5f7'],
    [/ROSA|PINK/, 3.0, '#ff2d92'],
  ];
  const BJTS = [
    /* 1.113.0: os Darlington PNP primeiro (BD676/678/680/682, BDX54 e TIP125-127 caiam no NPN) */
    [/TIP12[5-7]|BD6(?:7[68]|8[02])|BDX34|BDX54|MJD127|TIP14[5-7]|MPSA6[34]/, { pol: -1, bf: 1000, is: 1e-12, nf: 2, nome: 'Darlington PNP' }],
    [/TIP12[0-2]|BD6(?:7[579]|8[13])|BDX33|BDX53|MJD122|TIP14[0-2]|BCV27|MMBTA1[34]|MPSA1[34]/, { pol: 1, bf: 1000, is: 1e-12, nf: 2, nome: 'Darlington NPN' }],
    [/BC3[23][78]|BC8[0-1][7-8]?.*|BC54[6-9]|BC81[78]|2N2222|PN2222|MMBT2222|2N3904|MMBT3904|S8050|S9013|S9014|SS8050|BC33[78]|BC63[579]|TIP3[13]|TIP4[13]|BD13[579]|2N4401|2SC\d|KSC\d|MJE13|2N5551|BFR|BC847|BC848|BC850|D882|MJE30|2N3055|TIP3055|BC23[78]|BC84[6-9]|BD23[3579]|FZT6\d\d|FZT4[59]\d|MJD44H|D44H|FMMT4\d\d|FMMT6\d\d|MMBT4124|MMBT5551|MMBTA4[2-4]|MPSA4[2-4]|BCP5[46]|BCX5[456]/, { pol: 1, bf: 250, is: 1e-14, nf: 1, nome: 'NPN' }],
    [/BC32[78]|BC80[78]|BC55[6-9]|2N2907|PN2907|MMBT2907|2N3906|MMBT3906|S8550|S9012|S9015|SS8550|BC63[68]|BC640|TIP3[24]|TIP4[24]|BD13[680]|2N4403|2SA\d|KSA\d|2N5401|BC857|BC858|BC860|B772|MJE35|MJ2955|TIP2955|BD23[468]|BD240|FZT7\d\d|FZT9\d\d|FMMT5\d\d|FMMT7\d\d|MMBTA9[2-4]|MPSA9[2-4]|BCP5[13]|BCX5[123]|MJD45H|D45H|MMBT5401/, { pol: -1, bf: 250, is: 1e-14, nf: 1, nome: 'PNP' }],
  ];
  /* os limites do transistor (o que queima): Ic max (A), Vceo (V), Pd (W) — o nome da peca ("160V 600mA", "100V 2W 3A") manda */
  const BJT_LIM = [
    [/BC546|BC556/, { ic: 0.1, vceo: 65, pd: 0.5 }], [/BC548|BC549|BC558|BC559/, { ic: 0.1, vceo: 30, pd: 0.5 }], [/BC547|BC557|BC23[78]/, { ic: 0.1, vceo: 45, pd: 0.5 }],
    [/BD6(?:7[56])/, { ic: 4, vceo: 45, pd: 40 }], [/BD6(?:7[78])/, { ic: 4, vceo: 60, pd: 40 }], [/BD6(?:79|80)/, { ic: 4, vceo: 80, pd: 40 }], [/BD6(?:8[12])/, { ic: 4, vceo: 100, pd: 40 }], [/BC84[6-9]/, { ic: 0.1, vceo: 65, pd: 0.25 }], [/BD23[3-9]|BD240/, { ic: 2, vceo: 80, pd: 25 }], [/BC8[45][78]|BC850|BC860/, { ic: 0.1, vceo: 45, pd: 0.25 }],
    [/BC3[23][78]/, { ic: 0.8, vceo: 45, pd: 0.625 }], [/BC8[01][78]/, { ic: 0.5, vceo: 45, pd: 0.31 }],
    [/MMBT2222|MMBT2907/, { ic: 0.6, vceo: 40, pd: 0.35 }], [/2N2222|PN2222/, { ic: 0.6, vceo: 40, pd: 0.5 }], [/2N2907|PN2907/, { ic: 0.6, vceo: 60, pd: 0.4 }],
    [/MMBT390[46]/, { ic: 0.2, vceo: 40, pd: 0.35 }], [/2N390[46]/, { ic: 0.2, vceo: 40, pd: 0.625 }], [/2N440[13]/, { ic: 0.6, vceo: 40, pd: 0.625 }],
    [/2N5551|2N5401|MMBT5551|MMBT5401/, { ic: 0.6, vceo: 150, pd: 0.625 }], [/SS8050|SS8550/, { ic: 1.5, vceo: 25, pd: 1 }], [/S8050|S8550/, { ic: 0.5, vceo: 25, pd: 0.625 }],
    [/S901[2-5]/, { ic: 0.5, vceo: 25, pd: 0.625 }], [/TIP3[12]/, { ic: 3, vceo: 40, pd: 40 }], [/TIP4[12]/, { ic: 6, vceo: 40, pd: 65 }],
    [/TIP12[0-7]/, { ic: 5, vceo: 60, pd: 65 }], [/TIP14[0-7]/, { ic: 10, vceo: 60, pd: 125 }], [/TIP2955|TIP3055/, { ic: 15, vceo: 60, pd: 90 }], [/2N3055|MJ2955/, { ic: 15, vceo: 60, pd: 115 }],
    [/BD13[5-9]|BD140/, { ic: 1.5, vceo: 45, pd: 12.5 }], [/BD6[78]\d/, { ic: 4, vceo: 45, pd: 40 }], [/BDX5[34]|BDX3[34]/, { ic: 8, vceo: 45, pd: 60 }],
    [/D882|B772/, { ic: 3, vceo: 30, pd: 10 }], [/MJE3055|MJE2955/, { ic: 10, vceo: 60, pd: 75 }], [/MJE130/, { ic: 1.5, vceo: 400, pd: 20 }],
  ];
  /* a pinagem quando o simbolo nao da nome aos pinos (a ordem do encapsulamento): 2N2222/3904/3906, S8050 = E-B-C;
     BC5xx/BC3xx = C-B-E; TIP (TO-220) = B-C-E; BD13x/BD67x (TO-126) = E-C-B; SOT-23 = B-E-C */
  const BJT_PINAGEM = [
    [/SOT-?23|SOT-?323|SC-?70/, 'BEC', 'fp'], [/2N2222|PN2222|2N390[46]|2N440[13]|2N2907|PN2907|2N5551|2N5401|S80[5]0|S8550|S901\d|SS8[05]50/, 'EBC'],
    [/TIP\d|MJE\d|D882|B772|BDX/, 'BCE'], [/BD13\d|BD140|BD6\d\d/, 'ECB'],
  ];
  const BJT_PNP_FIX = /BC32[78]|BC80[78]|BC55[6-9]|2N2907|2N3906|MMBT3906|S8550|S9012|S9015|BC857|BC858|2N5401|TIP3[24]|TIP4[24]|BD13[680]|2SA\d|KSA\d|MJE35/;
  const FETS = [
    [/2N7002|BSS138|BSS123|2N7000|NDS7002|VN2222/, { pol: 1, vth: 1.6, k: 0.3, nome: 'MOSFET N (sinal)' }],
    [/AO340[0-2]|AO3416|SI230[02]|SI2312|IRLML2502|IRLML6344|DMN|FDN3[35]|PMV/, { pol: 1, vth: 0.9, k: 20, nome: 'MOSFET N (nível lógico)' }],
    [/IRLZ|IRLB|IRL5|IRL2|IRL3|IRL7|LR7843|IRLR/, { pol: 1, vth: 1.5, k: 40, nome: 'MOSFET N (nível lógico)' }],
    [/IRF[0-9]{3,4}N?\b|IRFZ|IRFB|IRFP|IRFR|STP\d|FQP\d|IRFS|NTD|AOD4|STD\d/, { pol: 1, vth: 3.0, k: 15, nome: 'MOSFET N' }],
    [/AO340[1-9]|AO3415|SI230[1-9]|IRLML6402|IRLML2244|DMP|FDN3[03][0-9]P|BSS84/, { pol: -1, vth: 0.9, k: 15, nome: 'MOSFET P' }],
    [/IRF9|IRF4905|IRF5305|FQP27P|SPP|STP\d+P/, { pol: -1, vth: 3.0, k: 12, nome: 'MOSFET P' }],
  ];
  /* 1.114.0 (lote 2): os MOSFETs da lib Almox — Vdss, Id max, Pd, Vth, Rds(on) e o canal */
  const FET_LIM = [
    [/IRFZ34/, { pol: 1, vdss: 55, id: 29, pd: 68, vth: 3, rds: 0.04 }], [/IRF9Z34/, { pol: -1, vdss: 55, id: 19, pd: 68, vth: 3, rds: 0.1 }],
    [/IRFP460/, { pol: 1, vdss: 500, id: 20, pd: 280, vth: 3, rds: 0.27 }], [/IRFR4615/, { pol: 1, vdss: 150, id: 33, pd: 144, vth: 4, rds: 0.039 }],
    [/IPD047N03/, { pol: 1, vdss: 30, id: 90, pd: 79, vth: 1.6, rds: 0.0047 }], [/FQA9N90/, { pol: 1, vdss: 900, id: 9, pd: 280, vth: 4, rds: 1.3 }],
    [/11N60C3|SPA11N60/, { pol: 1, vdss: 650, id: 11, pd: 33, vth: 3, rds: 0.38 }], [/FDD3N40/, { pol: 1, vdss: 400, id: 2, pd: 30, vth: 3, rds: 3.4 }],
    [/FQD17P06/, { pol: -1, vdss: 60, id: 12, pd: 38, vth: 3, rds: 0.12 }], [/AO3419/, { pol: -1, vdss: 20, id: 3.5, pd: 1.4, vth: 0.8, rds: 0.06, vgs: 12 }],
    [/ZVN4424/, { pol: 1, vdss: 240, id: 0.26, pd: 0.7, vth: 1.8, rds: 5 }], [/AM20P06/, { pol: -1, vdss: 60, id: 20, pd: 50, vth: 2, rds: 0.05 }],
    [/SQJ431/, { pol: -1, vdss: 200, id: 7, pd: 48, vth: 3, rds: 0.6 }], [/IPF067N20/, { pol: 1, vdss: 200, id: 100, pd: 300, vth: 3, rds: 0.0067 }],
    [/FDH038AN08/, { pol: 1, vdss: 75, id: 80, pd: 310, vth: 3, rds: 0.0038 }], [/IRLML6402/, { pol: -1, vdss: 20, id: 3.7, pd: 1.3, vth: 0.8, rds: 0.065, vgs: 12 }],
    [/IRLML2502|IRLML6344|AO340[02]|SI2302/, { pol: 1, vdss: 20, id: 4, pd: 1.25, vth: 0.9, rds: 0.045, vgs: 12 }], [/2N7002|BSS138/, { pol: 1, vdss: 60, id: 0.3, pd: 0.35, vth: 1.6, rds: 3 }],
    [/IRF540/, { pol: 1, vdss: 100, id: 33, pd: 130, vth: 3, rds: 0.044 }], [/IRF3205/, { pol: 1, vdss: 55, id: 110, pd: 200, vth: 3, rds: 0.008 }], [/IRLZ44/, { pol: 1, vdss: 55, id: 47, pd: 110, vth: 1.5, rds: 0.022, vgs: 10 }],
  ];
  /* o IGBT (gate de MOSFET, saida com Vce(sat)) */
  const IGBT_RE = /IGBT|\b[IFGH]K[PWQ]\d+N\d+|\bIRG[BP4]\w*|\bFGA\d|\bFGH\d|\bHGTG|\bSTGW|\bIHW\d/;
  /* reguladores lineares: vout fixo ou ADJ (vref entre OUT e ADJ); pinos por nome, senao pela ordem do encapsulamento */
  /* 1.115.0 (lote 3): os reguladores e referencias da lib Almox — vout, dropout, corrente, Vin max e a pinagem (o nome
     do pino manda; senao a ordem do encapsulamento) */
  function reguladorDaLib(t) {
    let m;
    const ldo = (vout, nome, o) => Object.assign({ vout, vdo: 0.3, iq: 0.1e-3, ilim: 0.15, vinmax: 6, ordem: ['IN', 'GND', 'OUT'], nome }, o || {});
    if ((m = /LM293[17][A-Z]*[-\s]?(\d{1,2}(?:\.\d)?)/.exec(t)) || /LM293[17]/.test(t)) return ldo(m ? +m[1] : 5, 'regulador LDO ' + (m ? m[0] : 'LM2931'), { vdo: 0.4, iq: 1e-3, ilim: /2937/.test(t) ? 0.5 : 0.1, vinmax: 26 });
    if ((m = /LM2940[A-Z]*[-\s]?(\d{1,2}(?:\.\d)?)/.exec(t))) return ldo(+m[1], 'regulador LDO LM2940-' + m[1], { vdo: 0.5, iq: 10e-3, ilim: 1, vinmax: 26 });
    if ((m = /LM340[A-Z]*[-\s]?(\d{1,2})/.exec(t))) return ldo(+m[1], 'regulador linear LM340-' + m[1], { vdo: 2, iq: 5e-3, ilim: 1.5, vinmax: 35 });
    if ((m = /BD4(\d)(\d)M(\d{1,2})/.exec(t))) return ldo(+m[3], 'regulador LDO ' + m[0], { vdo: 0.5, iq: 0.5e-3, ilim: 0.5, vinmax: 45 });
    if ((m = /NCV1117\w*?(\d{2})\b|NCV1117ST(\d{2})/.exec(t))) { const k = m[1] || m[2]; const v = k === '12' ? 12 : k === '50' ? 5 : +(k[0] + '.' + k[1]); return ldo(v, 'regulador NCV1117 ' + v + ' V', { vdo: 1.1, iq: 5e-3, ilim: 1, vinmax: 20, ordem: ['GND', 'OUT', 'IN'] }); }
    if ((m = /NCP700\w*?(\d{2})(?:T|\b)/.exec(t))) return ldo(+(m[1][0] + '.' + m[1][1]), 'regulador LDO NCP700', { ilim: 0.2, vinmax: 6, ordem: ['IN', 'GND', 'EN', 'NC', 'OUT'] });
    if ((m = /RT90(80|45)\w*?[-\s]?(\d{2})/.exec(t))) return ldo(+(m[2][0] + '.' + m[2][1]), 'regulador LDO RT90' + m[1], { ilim: m[1] === '80' ? 0.6 : 0.5, vinmax: 6, ordem: ['IN', 'GND', 'EN', 'NC', 'OUT'] });
    if (/RT9045/.test(t)) return ldo(1.25, 'regulador LDO RT9045 (ajustável)', { ilim: 1.5, vinmax: 6, adj: 0.8, ordem: ['IN', 'GND', 'ADJ', 'OUT'] });
    if ((m = /TS2950\w*?[-\s]?(\d(?:\.\d)?)/.exec(t))) return ldo(+m[1], 'regulador LDO TS2950', { ilim: 0.15, vinmax: 16 });
    if ((m = /LP2951\w*?[-\s]?(\d(?:\.\d)?)/.exec(t))) return ldo(+m[1], 'regulador LDO LP2951', { ilim: 0.1, vinmax: 30, ordem: ['OUT', 'NC', 'NC', 'GND', 'NC', 'NC', 'NC', 'IN'] });
    if ((m = /MIC5283\w*?[-\s]?(\d(?:\.\d)?)/.exec(t))) return ldo(+m[1], 'regulador LDO MIC5283 (alta tensão)', { ilim: 0.03, vdo: 1.2, vinmax: 120, ordem: ['IN', 'NC', 'GND', 'NC', 'OUT'] });
    if ((m = /LT1129\w*?[-\s]?(\d(?:\.\d)?)/.exec(t))) return ldo(+m[1], 'regulador LDO LT1129', { ilim: 0.7, vdo: 0.4, vinmax: 30 });
    if (/NCV4274/.test(t)) return ldo(/4274A?[-\s]?33|3\.3/.test(t) ? 3.3 : 5, 'regulador LDO NCV4274', { ilim: 0.4, vdo: 0.5, vinmax: 40 });
    if (/TL783/.test(t)) return { adj: 1.25, vdo: 2.5, iq: 0, ilim: 0.7, vinmax: 125, ordem: ['ADJ', 'OUT', 'IN'], nome: 'regulador ajustável de alta tensão TL783 (Vref 1,25 V)' };
    if (/TPS7A40/.test(t)) return { adj: 1.175, vdo: 0.3, iq: 0, ilim: 0.05, vinmax: 100, ordem: ['OUT', 'ADJ', 'NC', 'GND', 'NC', 'NC', 'NC', 'IN'], nome: 'regulador LDO ajustável TPS7A4001 (Vref 1,175 V)' };
    if (/LM337|LM79ADJ/.test(t)) return { adj: 1.25, neg: true, vdo: 2, iq: 0, ilim: 1.5, vinmax: 40, ordem: ['ADJ', 'IN', 'OUT'], nome: 'regulador ajustável negativo LM337 (−1,25 V)' };
    /* as referencias de tensao (regulador de pouca corrente) */
    if ((m = /REF19(\d)/.exec(t))) return ldo({ 0: 2.048, 1: 2.048, 2: 2.5, 3: 3, 4: 4.5, 5: 5, 6: 3.3, 8: 4.096 }[m[1]] || 5, 'referência de tensão ' + m[0], { ilim: 0.03, vdo: 0.1, vinmax: 15, ordem: ['NC', 'IN', 'NC', 'GND', 'NC', 'OUT', 'NC', 'NC'] });
    if (/MCP1541/.test(t)) return ldo(4.096, 'referência de tensão MCP1541', { ilim: 0.002, vdo: 0.2, vinmax: 5.5, ordem: ['IN', 'OUT', 'GND'] });
    if ((m = /LT1021\w*?[-\s]?(\d{1,2})?/.exec(t))) return ldo(+(m[1] || 5) || 5, 'referência de tensão LT1021', { ilim: 0.01, vdo: 1, vinmax: 40, ordem: ['NC', 'IN', 'NC', 'GND', 'NC', 'OUT', 'NC', 'NC'] });
    if (/AD584/.test(t)) return ldo(10, 'referência de tensão AD584 (saída de 10 V)', { ilim: 0.01, vdo: 2.5, vinmax: 30, ordem: ['OUT', 'NC', 'NC', 'GND', 'NC', 'NC', 'NC', 'IN'] });
    return null;
  }
  function reguladorLinear(t) {
    const daLib = reguladorDaLib(t); if (daLib) return daLib;
    let m = /(?:L|LM|MC|UA|KA|L)?78(?:M|L|S|T)?(\d{2})/.exec(t);
    if (m && /78(?:M|L|S|T)?\d{2}/.test(t) && +m[1] === 0) { const m0 = /780+([1-9])/.exec(t); if (m0) m = [m0[0], m0[1]]; }   // 1.116.0: "78008AP" = 7808
    if (m && /78(?:M|L|S|T)?\d{2}/.test(t) && +m[1] > 0) return { vout: +m[1], vdo: 2.0, iq: 5e-3, ilim: /78L/.test(t) ? 0.1 : /78M/.test(t) ? 0.5 : 1.5, ordem: ['IN', 'GND', 'OUT'], nome: 'regulador linear 78' + String(m[1]).padStart(2, '0') };
    m = /(?:L|LM|MC|UA|KA)?79(?:M|L)?(\d{2})/.exec(t);
    if (m && /79(?:M|L)?\d{2}/.test(t)) return { vout: -m[1], vdo: 2.0, iq: 5e-3, ilim: /79L/.test(t) ? 0.1 : /79M/.test(t) ? 0.5 : 1.5, ordem: ['GND', 'IN', 'OUT'], nome: 'regulador negativo 79' + m[1], neg: true };
    if (/LM[123]17(?![0-9])|LM1086.*ADJ|1117.*ADJ|LM338|LM350|LD1117.*ADJ/.test(t)) return { adj: 1.25, vdo: /1117|1086/.test(t) ? 1.1 : 2.0, iq: 5e-3, ilim: 1.5, ordem: /1117|1086/.test(t) ? ['ADJ', 'OUT', 'IN'] : ['ADJ', 'OUT', 'IN'], nome: 'regulador ajustável (Vref 1,25 V)' };
    m = /(?:AMS|LM|LD|AP|NCP|TLV|SPX|AZ|HT|MCP|XC|RT|ME|LP|TPS|MIC|LDK|LDL)\s*-?(1117|1086|1084|1085|1585|29150|2950|2985|1700|1702|73\d\d|72\d\d|7333|7350|7533|6206|6219|9193|5205|2992|1801|3985|7302|5150|7330|1803|1702)[A-Z]*\s*[-_ ]?\s*(ADJ|\d{2}|\d[.,]\d{1,2})?/.exec(t);
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
    /* 1.116.0: o sufixo do encapsulamento antes da tensao ("LM2575T-5.0", "LM2575D2T-5G", "LM2575S-15"): saida fixa */
    let m = /LM257[56](?:HV)?(?:D2T|[A-Z])*[-\s]?(ADJ|\d{1,2}(?:\.\d)?)?/.exec(t) || /LM259[56](?:D2T|[A-Z])*[-\s]?(ADJ|\d{1,2}(?:\.\d)?)?/.exec(t) || /LM267[0-9](?:D2T|[A-Z])*[-\s]?(ADJ|\d{1,2}(?:\.\d)?)?/.exec(t);
    if (m) { const v = m[1] && m[1] !== 'ADJ' ? parseFloat(m[1]) : null;
      return { vfb: v || 1.23, fixo: !!v, vout: v, ordem: ['VIN', 'SW', 'GND', 'FB', 'EN'], enBaixo: true, eta: 0.8, nome: m[0] + ' (buck, modelo médio)' }; }
    if (/MP1584|MP2307|MP2359|MP1482/.test(t)) return { vfb: 0.8, ordem: ['SW', 'EN', 'COMP', 'FB', 'GND', 'FREQ', 'VIN', 'BST'], eta: 0.88, nome: 'buck MP (modelo médio)' };
    if (/XL40(05|15|16)|XL1509|XL4012/.test(t)) return { vfb: 1.25, ordem: ['GND', 'FB', 'SW', 'VIN', 'VIN'], eta: 0.88, nome: 'buck XL (modelo médio)' };
    if (/LM2577/.test(t)) return { vfb: 1.23, boost: true, ordem: ['COMP', 'FB', 'GND', 'SW', 'VIN'], eta: 0.8, nome: 'boost LM2577 (modelo médio)' };
    if (/MT3608|XL6009|XL6019|SX1308|B628/.test(t)) return { vfb: /MT3608|SX1308|B628/.test(t) ? 0.6 : 1.25, boost: true, ordem: ['SW', 'GND', 'FB', 'EN', 'VIN', 'NC'], eta: 0.85, nome: 'boost (modelo médio)' };
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
  /* 1.116.0 (lote 4): a alimentacao maxima (V+ − V−) e os rail-to-rail */
  const OPAMP_VMAX = [[/LM358|LM324|LM2904|LM2902|LM224|LM158|LM258|LM124|LM348/, 32], [/OP07|NE553|LF35[5-7]|LT1490|MC3307|ADA4522/, 44], [/TL0[3-8]\d|LM741|UA741|MC1741|HA17741|TBA221|LM1458|MC1458|4558|AD70\d|AD711|TLE2021|LM318|LM30[17]/, 36],
    [/MCP60|LMV|TLV23|ADA4528|LTC2050|TSX56|OPA3\d\d/, 5.5], [/CA3130|CA3140|TLC27/, 16]];
  const OPAMP_R2R = /MCP60|LMV3|TLV23|ADA4528|LTC2050|TSX56|LT1490|OPA3\d\d/;
  const OPAMPS = [
    [/LM1458|MC1458|GL4558|\b4558|MC33072|TL032|TL35072|AD706|ADA4522-2|ADA4528-2|LT1490|UPD5200/, { canais: 2, dlo: 1, dhi: 1.5, iq: 2e-3 }],
    [/LM224|LM348|MC33074|TL034/, { canais: 4, dlo: 0.05, dhi: 1.5, iq: 2e-3 }],
    [/LF35[5-7]|MC1741|HA17741|LM301|LM307|LM318|CA3130|TLE2021|AD711|TBA221|MC33071|TL031|TSX561|LTC2050|TDA2030|TDA2050/, { canais: 1, dlo: 1, dhi: 1.5, iq: 1.7e-3 }],
    [/LM358|LM2904|LM158|LM258|MCP6002|MCP602|TL072|TL082|NE5532|OPA2\d{3}|AD8\d{3}2|LMV358|TLV2372|RC4558|LM833|OP27|TLC272/, { canais: 2, dlo: 0.05, dhi: 1.5, iq: 1e-3 }],
    [/LM324|LM2902|LM124|MCP6004|MCP604|TL074|TL084|LMV324|OPA4\d{3}|TLV2374|LM837/, { canais: 4, dlo: 0.05, dhi: 1.5, iq: 2e-3 }],
    [/LM741|UA741|OP07|TL071|TL081|NE5534|OPA\d{3}(?!\d)|MCP6001|MCP601|LMV321|CA3140|LF351|OPA1\d{2}/, { canais: 1, dlo: 1, dhi: 1.5, iq: 1.7e-3 }],
  ];
  const COMPARADORES = [
    [/LM393|LM2903|LM193|LM293(?![0-9])|TLV1702|LMV393|ADCMP39[12]/, { canais: 2 }], [/LM339|LM2901|LM139|LMV339/, { canais: 4 }], [/LM311|LM111/, { canais: 1, lm311: true }],
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
      /* 1.114.0: o valor trocado na simulacao ("1000uF") nao apaga a tensao, a potencia e a corrente que a peca tem no nome */
      if (cfg.valores && cfg.valores[ref] != null) {
        const vo = leValor(String(c.valor || '') || c.comment);
        for (const k of ['tensao', 'potencia', 'corrente']) if (!(val[k] > 0) && vo[k] > 0) val[k] = vo[k];
      }
      const info = { ref, pre, comp: c, tipo: 'desconhecido', rotulo: '', modelo: '', valor: val, elementos: [], pinos: c.pinos, avisos: [], interativo: null, valorTxt };
      comps.set(ref, info);
      if (c.dnp || desligados.has(ref)) { info.tipo = 'fora'; info.rotulo = c.dnp ? 'não montado (DNP)' : 'desligado na simulação'; continue; }
      /* 1.116.0: as placas da casa usadas como componente (DTN-DI251837, DMPU-ATE220004): nao sao simuladas aqui */
      if (/\bD[A-Z]{2,6}-?(?:DI|ATE?)\d{6}/.test(desc)) { info.tipo = 'ignorado'; info.rotulo = 'Placa da casa (' + (c.comment || '') + '): não simulada'; continue; }
      const ps = c.pinos.filter(p => p.net);
      const p1 = c.pinos.find(p => String(p.num) === '1') || c.pinos[0];
      const p2 = c.pinos.find(p => String(p.num) === '2') || c.pinos[1];

      /* --- varistor (1.117.0, lote 5: MOV/MLV): bidirecional, I = 1 mA·(|V|/V1mA)^α (α ≈ 30), quase nada abaixo; a VAC e a VDC
         maximas continuas do nome ("130VAC/170VDC", "S20K150", "275VAC"), o V1mA do codigo ("201KD14" = 200 V) ou ≈ 1,55·VAC;
         a energia (J) e o pico (kA) do nome so como informacao. No DC acima de 1,1x a VDC ele aquece e falha em CURTO (depois
         abre) — a queima diz isso */
      if ((/VARIST|\bMOV\b|\bMLV\b|\bVDR\b|\bZOV\b|\bTVR\d|\bS\d{2}K\d{2,3}|\b\d{3}KD\d{2}|\bV\d{2,3}ZA|\bERZ/.test(txt) || /VARIST/.test(norm(c.sym || ''))) && c.pinos.length === 2) {
        const prmV = (cfg.params && cfg.params[ref]) || {};
        const cmV = String(c.comment || '').replace(/,/g, '.');
        let mV, vac = NaN, vdc = NaN, v1 = NaN;
        if ((mV = /(\d+(?:\.\d+)?)\s*V\s*(?:AC|CA|AV|RMS)\b/i.exec(cmV))) vac = +mV[1];   // "250VCA" e o "130VAV" da lib tambem
        if ((mV = /(\d+(?:\.\d+)?)\s*V\s*(?:DC|CC)\b/i.exec(cmV))) vdc = +mV[1];
        if ((mV = /\b(\d)(\d)(\d)KD\d{2}/.exec(txt)) || (mV = /\b\d{1,2}D(\d)(\d)(\d)K\b/.exec(txt))) v1 = (+mV[1] * 10 + +mV[2]) * Math.pow(10, +mV[3]);   // 201KD14, 10D561K
        if (!(vac > 0) && (mV = /\bS\d{2}K(\d{2,3})/.exec(txt)) && !(v1 > 0 && /\bS\d{2}K\d{2}1\b/.test(txt))) vac = +mV[1];
        if (!(vac > 0) && !(vdc > 0) && !(v1 > 0) && val.tensao > 0) vac = val.tensao;
        if (!(vac > 0) && v1 > 0) vac = Math.round(v1 / 1.55);
        if (!(vac > 0)) { vac = 275; info.avisos.push('tensão do varistor não lida do nome: 275 VAC (mude no campo)'); }
        if (!(vdc > 0)) vdc = Math.round(vac * 1.28);
        if (!(v1 > 0)) v1 = Math.round(vac * 1.55);
        /* a VAC editada leva junto a VDC e o V1mA (na mesma proporcao do componente) */
        if (isFinite(+prmV.vac) && +prmV.vac > 0) { const k = +prmV.vac / vac; vac = +prmV.vac; vdc = Math.round(vac * 1.28); v1 = Math.round(v1 * k * 10) / 10; }
        if (isFinite(+prmV.v1ma) && +prmV.v1ma > 0) v1 = +prmV.v1ma;
        const ej = grandezaDoNome(cmV, 'J'), ipk = /(\d+(?:\.\d+)?)\s*KA\b/i.exec(cmV);
        info.tipo = 'varistor'; info.vac = vac; info.vdc = vdc; info.v1ma = v1; info.energia = ej > 0 ? ej : null; info.ipico = ipk ? +ipk[1] * 1000 : null;
        info.rotulo = 'Varistor ' + fmt(vac, 'V') + ' AC / ' + fmt(vdc, 'V') + ' DC (V1mA ≈ ' + fmt(v1, 'V') + ')';
        info.campos = [{ k: 'vac', rot: 'Tensão máx contínua AC (V)', un: 'V', v: vac, dica: '130, 275' }, { k: 'v1ma', rot: 'V a 1 mA (V)', un: 'V', v: v1, dica: '200, 430' },
          { k: 'energia', rot: 'Energia (J)', un: '', v: info.energia, dica: '19' }, { k: 'ipico', rot: 'Corrente de pico (A)', un: 'A', v: info.ipico, dica: '2500' }];
        const al = 30;
        const f = v => { const d = v[0] - v[1], a = Math.abs(d); const i = Math.sign(d) * 1e-3 * lexp(al * Math.log(Math.max(a, 1e-6) / v1)) + 1e-9 * d; return [i, -i]; };
        info.el = poe(info, { tipo: 'NL', nos: [nomeTerm(info, p1), nomeTerm(info, p2)], f, papel: 'varistor' }, [pk(info, p1), pk(info, p2)]);
        continue;
      }
      /* --- rede de resistores (1.113.0, lote 1): 4114R/4116R (DIP, isolados: 1-14, 2-13...), SIP isolado (1-2, 3-4...) ou
         em barramento (o pino 1 comum aos outros: 4608X-101, 9/10 pinos) */
      if ((/^(RN|RP|RA|RR|RZ)$/.test(pre) || /RESISTOR REDE|REDE DE RESIST|RES(?:ISTOR)? NETWORK|RESISTOR ARRAY|\b41[0-9]{2}R|\b46\d{2}X|\b43\d{2}R|\bCAY\d|\bEXB/.test(desc)) && c.pinos.length >= 4) {
        let r = val.v;
        if (!(r > 0)) { r = 10e3; info.avisos.push('sem valor: simulando com 10 kΩ em cada resistor'); }
        const prmR = (cfg.params && cfg.params[ref]) || {};
        const ord = [...c.pinos].sort((x, y) => (+x.num || 0) - (+y.num || 0)), n = ord.length;
        const bus = /BUS|BARRAMENTO|COMUM|COMMON|X-?101\b|-1\d\dLF\b/.test(txt) || n % 2 === 1;
        const sip = /SIP|SIL/.test(norm(c.footprint));
        info.tipo = 'rede'; info.r = r; info.rNominal = r; info.resistores = [];
        const poeR = (x, y) => info.resistores.push({ a: x, b: y, el: resistor(info, x, y, r, 'R ' + x.num + '–' + y.num) });
        if (bus) for (const q of ord.slice(1)) poeR(ord[0], q);
        else if (sip) for (let i = 0; i + 1 < n; i += 2) poeR(ord[i], ord[i + 1]);
        else for (let i = 0; i < n / 2; i++) poeR(ord[i], ord[n - 1 - i]);
        info.potencia = isFinite(+prmR.potencia) && +prmR.potencia > 0 ? +prmR.potencia : (val.potencia || 0.125);
        info.campos = [{ k: 'potencia', rot: 'Potência de cada resistor (W)', un: 'W', v: info.potencia, dica: '1/8, 1/4' }];
        info.rotulo = 'Rede de resistores ' + fmt(r, 'Ω') + ' (' + info.resistores.length + (bus ? ', o pino ' + ord[0].num + ' comum' : sip ? ' isolados em pares' : ' isolados') + ')';
        continue;
      }
      /* --- resistor / potenciometro / NTC / LDR */
      if ((/^(R|RN|RES)$/.test(pre) || /^RES\b|RESIST/.test(desc)) && c.pinos.length === 2 && !/^(RV|VR)$/.test(pre) && !/INDUT|INDUCTOR|CHOKE|TERMIST|FUSIV/.test(norm(c.sym || '')) && !/^(L|F|FU|RT|NTC|PTC|TH)$/.test(pre)) {
        let r = val.v;
        if (!(r >= 0)) { r = 10e3; info.avisos.push('sem valor: simulando com 10 kΩ (mude o Value ou em Valores da simulação)'); }
        if (r === 0) r = 1e-3;
        /* 1.111.0 (o dono: "quero um campo de valor de resistência / potência / tolerância e ver o efeito na simulação"):
           cfg.params[ref] = {potencia (W), tol (%)}. A potencia nominal muda quando ele queima (acima de 2x); a
           tolerancia faz o resistor DE VERDADE: o valor real cai num ponto da faixa (fixo por componente, sempre entre
           a metade e a borda da faixa, para o efeito aparecer) e e ele que entra no circuito */
        const prmR = (cfg.params && cfg.params[ref]) || {};
        const nominal = r;
        info.tol = isFinite(+prmR.tol) && +prmR.tol > 0 ? +prmR.tol : null;
        if (info.tol) r = nominal * (1 + info.tol / 100 * desvioDe(ref));
        info.tipo = 'resistor'; info.rotulo = 'Resistor ' + fmt(nominal, 'Ω') + (info.tol ? ' ±' + String(info.tol).replace('.', ',') + ' %' : '');
        info.r = r; info.rNominal = nominal;
        info.potencia = isFinite(+prmR.potencia) && +prmR.potencia > 0 ? +prmR.potencia : (val.potencia || potenciaDoFootprint(c.footprint) || 0.25);
        info.campos = [{ k: 'potencia', rot: 'Potência (W)', un: 'W', v: info.potencia, dica: '1/4, 0,5' }, { k: 'tol', rot: 'Tolerância (%)', un: '%', v: info.tol, dica: '5, 1, 10' }];
        resistor(info, p1, p2, r);
        continue;
      }
      if ((/^(RV|VR|POT|TRIM|P|RP)$/.test(pre) && c.pinos.length >= 3 || /POTENCIOM|TRIMPOT|TRIMMER/.test(desc)) && !/\bX9\d{3}|MCP4[0-6]\d{2}|AD5\d{3}|AD84\d\d|DIGITAL|I2C|SPI\b/.test(txt)) {
        /* 1.114.0 (lote 2): o "1TURN"/"10TURN" do nome nao e o valor; a potencia do nome ("2W", "1/4W") e a queima por trecho */
        const valP = valorTxt ? val : leValor(String(c.comment || '').replace(/\b\d+\s*-?\s*TURNS?\b|\b\d+\s*VOLTAS?\b/ig, ' '));
        let r = valP.v; if (!(r > 0)) { r = 10e3; info.avisos.push('sem valor: simulando com 10 kΩ'); }
        const prmP = (cfg.params && cfg.params[ref]) || {};
        info.potencia = isFinite(+prmP.potencia) && +prmP.potencia > 0 ? +prmP.potencia : valP.potencia > 0 ? valP.potencia : /3296|3006|3852|3266|3386|TRIM/.test(txt) ? 0.5 : 0.25;
        const pos = cfg.pots && cfg.pots[ref] != null ? Math.min(1, Math.max(0, +cfg.pots[ref])) : 0.5;
        info.campos = [{ k: 'pos', rot: 'Posição do cursor (%)', un: '%', v: Math.round(pos * 1000) / 10, dica: '0 a 100' }, { k: 'potencia', rot: 'Potência (W)', un: 'W', v: info.potencia, dica: '1/4, 0,5, 2' }];
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
      /* 1.114.0 (lote 2): a categoria TERMISTOR mistura tres coisas — o PTC rearmavel (polyfuse: vai para o fusivel abaixo),
         o PTC de partida/protecao (a resistencia sobe com a corrente) e o NTC de verdade (R25, β e a TEMPERATURA editavel) */
      const ptcRearm = /LVR\d{3}|MF-?R?[XS]?\d{3}|\b\d{2,3}R\d{3}(?![0-9])|TR600|BK250|0Z[CR][A-Z]|POLYSW|PPTC|RXEF|POLYFUSE|REARM|RESETT|2920L|SMD\d{3}P?|\bLP\d{5}\b/.test(txt) && !/INDUT|INDUCTOR|CHOKE|BOBINA/.test(txt);
      if ((/^(NTC|PTC|TH|RT)$/.test(pre) && !ptcRearm && !/FUSE/.test(txt) || /NTC|TERMIST/.test(desc) && !ptcRearm) && c.pinos.length === 2) {
        const prmT = (cfg.params && cfg.params[ref]) || {};
        const ptc = (/PTC|POSISTOR|B5998|B5997/.test(txt) || /^PTC$/.test(pre)) && !/NTC/.test(txt);
        let r = val.v; if (!(r > 0)) r = ptc ? (/B59985/.test(txt) ? 4.6 : 25) : 10e3;
        if (ptc) {
          /* PTC de partida/protecao: R = R25·(1 + (|V|/Vk)^6), Vk = R25·In — a corrente para perto da nominal */
          const inom = isFinite(+prmT.inom) && +prmT.inom > 0 ? +prmT.inom : val.corrente > 0 ? val.corrente : /B5998/.test(txt) ? 1 : 0.1;
          info.tipo = 'ptc'; info.r = r; info.inom = inom; info.rotulo = 'PTC ' + fmt(r, 'Ω') + ' (corrente nominal ' + fmt(inom, 'A') + ')';
          info.campos = [{ k: 'inom', rot: 'Corrente nominal (A)', un: 'A', v: inom, dica: '1' }];
          const vk = r * inom;
          const f = v => { const vd = v[0] - v[1], x = Math.abs(vd) / vk; const i = vd / (r * (1 + Math.pow(Math.min(x, 50), 6))); return [i, -i]; };
          info.el = poe(info, { tipo: 'NL', nos: [nomeTerm(info, p1), nomeTerm(info, p2)], f, papel: 'PTC' }, [pk(info, p1), pk(info, p2)]);
          continue;
        }
        /* NTC: R = R25·exp(β(1/T − 1/298,15)); o "4000k"/"B3950" do nome e o β */
        const bNome = /\bB\s*=?\s*(\d{4})\b|\b(3[0-9]\d{2}|4[0-9]\d{2})\s*K\b/.exec(norm(c.comment || ''));
        const beta = isFinite(+prmT.beta) && +prmT.beta > 0 ? +prmT.beta : bNome ? +(bNome[1] || bNome[2]) : 3950;
        const temp = isFinite(+prmT.temp) ? +prmT.temp : 25;
        const rt = r * Math.exp(beta * (1 / (temp + 273.15) - 1 / 298.15));
        info.tipo = 'ntc'; info.r = rt; info.r25 = r; info.beta = beta; info.temp = temp;
        info.potencia = isFinite(+prmT.potencia) && +prmT.potencia > 0 ? +prmT.potencia : val.potencia > 0 ? val.potencia : /SG\d|NTC-?\d|LIMIT|PARTIDA|INRUSH/.test(txt) ? 3 : 0.25;
        info.rotulo = 'NTC ' + fmt(r, 'Ω') + ' (β ' + beta + ')' + (temp !== 25 ? ' a ' + String(temp).replace('.', ',') + ' °C = ' + fmt(rt, 'Ω') : '');
        info.campos = [{ k: 'temp', rot: 'Temperatura (°C)', un: '%', v: temp, dica: '25, 80, -10' }, { k: 'beta', rot: 'β (K)', un: '', v: beta, dica: '3950' }, { k: 'potencia', rot: 'Potência (W)', un: 'W', v: info.potencia, dica: '0,25' }];
        resistor(info, p1, p2, rt, 'NTC');
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
      if ((/^(F|FU|PTC|PF)$/.test(pre) || /FUSE|FUSIV|0ZC[A-Z]|MF-?[MRS]|POLYSW|PPTC|RXEF|SMD\d{3}P/.test(txt) || ptcRearm) && c.pinos.length === 2) {
        /* 1.114.0 (lote 2): a corrente nominal (o nome ou o codigo) e o tipo: o fusivel de vidro/ceramico ABRE (queima: fica
           aberto ate trocar) acima de In (rapido) ou 1,5x (retardo); o PTC rearmavel (polyfuse) dispara acima de 2x a
           corrente de manutencao — vira resistencia alta — e REARMA quando o defeito sai (a potencia nele cai) */
        const prmF = (cfg.params && cfg.params[ref]) || {};
        const rearm = ptcRearm || /PTC|PPTC|POLY|0ZC|MF-|2920L|SMD\d{3}/.test(txt) || /^PTC$/.test(pre);
        /* o codigo da peca manda (o nome do PTC costuma trazer a corrente de DISPARO: LVR040K "900mA" tem Ihold 0,4 A) */
        let ih = NaN, m;
        if ((m = /0Z[CR][A-Z](\d{4})/.exec(txt))) ih = +m[1] / 100;
        else if ((m = /MF-?[MRS]?X?(\d{3})/.exec(txt))) ih = +m[1] / 100;
        else if ((m = /LVR(\d{3})/.exec(txt))) ih = +m[1] / 100;
        else if ((m = /TR600-(\d{3})/.exec(txt))) ih = +m[1] / 1000;   // 1.115.0: o Bourns TR600-150 e 150 mA
        else if ((m = /\b\d{2,3}R(\d{3})(?![0-9])|2920L(\d{3})|SMD(\d{3})|\bLP\d{2}(\d{3})\b/.exec(txt))) ih = +(m[1] || m[2] || m[3] || m[4]) / 100;
        if (!(ih > 0)) ih = grandezaDoNome(c.comment, 'A');
        if (!(ih > 0) && val.corrente > 0) ih = val.corrente;
        if (isFinite(+prmF.inom) && +prmF.inom > 0) ih = +prmF.inom;
        /* o porta-fusivel (suporte): a corrente do nome ou nenhuma (conduz e nao abre ate pôr a do fusivel no campo) */
        const porta = /PORTA|SUPORTE|HOLDER|\bPARA (PCB|PAINEL)/.test(txt);
        if (!(ih > 0) && porta) { ih = null; info.avisos.push('porta-fusível: ponha a corrente do fusível no campo'); }
        else if (!(ih > 0)) { ih = 1; info.avisos.push('corrente do fusível não conhecida: simulando com 1 A (mude no campo)'); }
        const lento = isFinite(+prmF.retardo) ? +prmF.retardo > 0 : /RETARD|SLOW|LENTO|TIME ?LAG|\bT\d|\(T\)|\bT\b/.test(txt);
        info.tipo = 'fusivel'; info.ihold = ih; info.inom = ih; info.rearmavel = rearm; info.lento = lento;
        info.rotulo = porta && !ih ? 'Porta-fusível (sem fusível definido)' : (rearm ? 'Fusível rearmável (PTC) ' : (porta ? 'Porta-fusível com fusível ' : 'Fusível ') + (lento ? 'retardado ' : 'rápido ')) + fmt(ih, 'A');
        info.campos = rearm ? [{ k: 'inom', rot: 'Corrente de manutenção (A)', un: 'A', v: ih, dica: '1,1' }]
          : [{ k: 'inom', rot: 'Corrente nominal (A)', un: 'A', v: ih, dica: '0,5, 5' }, { k: 'retardo', rot: 'Retardo (0 rápido, 1 lento)', un: '', v: lento ? 1 : 0, dica: '0 ou 1' }];
        if (!rearm) { resistor(info, p1, p2, 0.05, 'fusível'); continue; }
        /* o rearmavel: Ron em serie com [chave fechada ∥ Rdisparo]; dispara acima de 2x Ihold, rearma com a potencia baixa */
        const meio = nInt(ref, 'ptc');
        const ron = poe(info, { tipo: 'R', nos: [nomeTerm(info, p1), meio], r: 0.05, papel: 'PTC (frio)' }, [pk(info, p1), null]);
        /* 1.115.0: disparado ele fica numa potencia quase constante (a do nome, "2W"; senao 1 W): I = P/V — a 12 V ≈ 80 mA,
           a 60 V ≈ 17 mA. Rearma quando o circuito ja nao consegue manter essa potencia nele (o defeito saiu) */
        const pt = grandezaDoNome(c.comment, 'W') > 0 ? grandezaDoNome(c.comment, 'W') : 1;
        const quente = poe(info, { tipo: 'NL', nos: [meio, nomeTerm(info, p2)], papel: 'PTC disparado',
          f: v => { const d = v[0] - v[1], i = info.disparado ? pt * d / (d * d + 0.25) : 1e-9 * d; return [i, -i]; } }, [null, pk(info, p2)]);
        const sw = poe(info, { tipo: 'SW', nos: [meio, nomeTerm(info, p2)], fechada: true, papel: 'PTC' }, [null, null]);
        info.disparado = false; info.pt = pt;
        ron.reinicia = () => { info.disparado = false; sw.fechada = true; };
        ron.atualiza = v => {
          const i = Math.abs(v[0] - v[1]) / 0.05;
          if (!info.disparado && i > 2 * ih) { info.disparado = true; info.espera = 3; sw.fechada = false; return true; }
          return false;
        };
        quente.atualiza = v => {
          if (!info.disparado) return false;
          /* logo depois de disparar a tensao nele ainda e a de antes (a chave estava fechada): espera alguns passos */
          if (info.espera > 0) { info.espera--; return false; }
          const d = v[0] - v[1], pAgora = Math.abs(d * pt * d / (d * d + 0.25));
          if (pAgora < 0.5 * pt) { info.disparado = false; sw.fechada = true; return true; }
          return false;
        };
        continue;
      }
      /* a ferrite de verdade (o nome em Ω: "600 Ohms 2A", MPZ2012); a "Ferrite 2.2mH" e um choke (indutor, abaixo) */
      if ((/^FB$/.test(pre) || /FERRITE|BLM\d|MPZ\d/.test(txt)) && c.pinos.length === 2 && val.un !== 'H') {
        const prmB = (cfg.params && cfg.params[ref]) || {};
        const inomB = isFinite(+prmB.inom) && +prmB.inom > 0 ? +prmB.inom : grandezaDoNome(c.comment, 'A') > 0 ? grandezaDoNome(c.comment, 'A') : 1;
        /* a DCR e o valor em mΩ do nome ("40ohms 1.5A 50mOhms": 40 Ω e a impedancia em alta frequencia) */
        const dcrB = /(\d+(?:[.,]\d+)?)\s*m(?:Ω|Ohms?)/.exec(String(c.comment || ''));
        const rB = dcrB ? +dcrB[1].replace(',', '.') / 1000 : 0.1;
        info.tipo = 'ferrite'; info.rotulo = 'Ferrite' + (c.comment ? ' (' + c.comment + ')' : ''); info.r = rB; info.inom = inomB;
        info.campos = [{ k: 'inom', rot: 'Corrente nominal (A)', un: 'A', v: inomB, dica: '1,5' }];
        resistor(info, p1, p2, rB, 'ferrite'); continue;
      }
      /* --- capacitor */
      if ((/^(C|CE|CAP)$/.test(pre) || /^CAP\b|CAPACIT/.test(desc)) && c.pinos.length === 2) {
        /* 1.113.0 (lote 1): o supercapacitor (valor em F, 2,7/5,5 V), a tensao nominal editavel e a polaridade pela categoria
           (eletrolitico, tantalo, supercap: o pino "+", senao o 1) */
        const superc = /SUPERCAP|SUPER ?CAP|ULTRACAP|EDLC|GOLD ?CAP/.test(txt);
        let cv = val.v;
        if (cv > 0 && val.un === 'F' && !val.pre && !superc) {
          /* "0.01F" das pecas antigas = 0,01 uF; o codigo de 3 digitos (472 = 4,7 nF) ganha se houver */
          const cod = (val.toks || []).find(x => /^\d{3}$/.test(x.t));
          cv = cod ? +cod.t.slice(0, 2) * Math.pow(10, +cod.t[2]) * 1e-12 : cv * 1e-6;
        }
        if (!(cv > 0)) { cv = superc ? 1 : 100e-9; info.avisos.push('sem valor: simulando com ' + fmt(cv, 'F')); }
        const prmC = (cfg.params && cfg.params[ref]) || {};
        const vSolta = /(\d+(?:[.,]\d+)?)\s*[uµμnpm]F\s+(\d{1,3}(?:[.,]\d)?)(?=\s|$)(?!\s*(?:MM|%))/i.exec(String(c.comment || ''));
        const vNom = isFinite(+prmC.vmax) && +prmC.vmax > 0 ? +prmC.vmax : val.tensao > 0 ? val.tensao : vSolta ? +vSolta[2].replace(',', '.') : superc ? 2.7 : null;
        info.tipo = 'capacitor'; info.c = cv; info.vmax = vNom; info.supercap = superc;
        const tipoC = superc ? 'Supercapacitor' : /TANT/.test(txt) ? 'Capacitor de tântalo' : /ELETROL|ELECTROL/.test(txt) ? 'Capacitor eletrolítico' : /POLIES|POLYEST|MKT|MKP/.test(txt) ? 'Capacitor de poliéster' : /SEGURANC|SAFETY|\bX[12]\b|\bY[12]\b/.test(txt) ? 'Capacitor de segurança' : 'Capacitor';
        info.rotulo = tipoC + ' ' + fmt(cv, 'F') + (vNom ? ' / ' + fmt(vNom, 'V') : '');
        info.polarizado = /ELETROL|ELECTROL|TANT|CAPE\b|CAP EL|POLAR|SUPERCAP|SUPER ?CAP|ULTRACAP|EDLC|GOLD ?CAP/.test(txt);
        const mais = achaPino(info, ['+', 'POS', 'A', 'ANODE'], null) || (info.polarizado ? achaPino(info, [], 1) : null);
        info.campos = [{ k: 'vmax', rot: 'Tensão nominal (V)', un: 'V', v: vNom, dica: '16, 50, 2,7' }];
        const a = mais || p1, b = mais ? c.pinos.find(p => p !== mais) : p2;
        info.pMais = a;
        poe(info, { tipo: 'C', nos: [nomeTerm(info, a), nomeTerm(info, b)], c: cv, papel: 'C' }, [pk(info, a), pk(info, b)]);
        continue;
      }
      /* --- indutor */
      if ((/^L$/.test(pre) || /INDUTOR|INDUCTOR|CHOKE/.test(desc)) && c.pinos.length === 4 && /MODO COMUM|COMMON ?MODE|CHOKE|FILTRO/.test(txt)) {
        const hTok = (val.toks || []).find(x => x.un === 'H');
        const lv = hTok ? hTok.v : val.v > 0 ? val.v : 10e-3, ord = [...c.pinos].sort((x, y) => (+x.num || 0) - (+y.num || 0));
        const iNome = grandezaDoNome(c.comment, 'A');
        info.tipo = 'indutor'; info.l = lv; info.inom = iNome > 0 ? iNome : 1; info.dcr = 0.1;
        info.rotulo = 'Choke de modo comum ' + fmt(lv, 'H') + ' (2 enrolamentos: 1–2 e 3–4)';
        info.campos = [{ k: 'inom', rot: 'Corrente nominal (A)', un: 'A', v: info.inom, dica: '0,6' }];
        info.avisos.push('o acoplamento entre os enrolamentos não é simulado (cada um como um indutor no seu caminho)');
        for (const [x, y] of [[ord[0], ord[1]], [ord[2], ord[3]]]) {
          const meio = nInt(ref, 'w');
          poe(info, { tipo: 'R', nos: [nomeTerm(info, x), meio], r: info.dcr, papel: 'DCR ' + x.num + '–' + y.num }, [pk(info, x), null]);
          const el = poe(info, { tipo: 'L', nos: [meio, nomeTerm(info, y)], l: lv, papel: 'enrolamento ' + x.num + '–' + y.num }, [null, pk(info, y)]);
          if (!info.el) info.el = el;
        }
        continue;
      }
      if ((/^L$/.test(pre) || /^IND\b|INDUTOR|INDUCTOR|CHOKE/.test(desc) || /FERRITE/.test(txt) && val.un === 'H') && c.pinos.length === 2) {
        /* 1.114.0 (lote 2): o valor em H (o "0,6A" do nome nao e a indutancia), a corrente nominal do nome e a DCR */
        const hTok = (val.toks || []).find(x => x.un === 'H');
        let lv = valorTxt ? val.v : hTok ? hTok.v : val.v; if (!(lv > 0)) { lv = 10e-6; info.avisos.push('sem valor: simulando com 10 µH'); }
        const prmL = (cfg.params && cfg.params[ref]) || {};
        const iNome = grandezaDoNome(c.comment, 'A');
        let rNome = grandezaDoNome(c.comment, 'Ω');
        if (!(rNome > 0)) { const r320 = /(?:^|\s)(\d+(?:[.,]\d+)?)R(?![0-9A-Z])/i.exec(String(c.comment || '')); if (r320) rNome = +r320[1].replace(',', '.'); }
        info.inom = isFinite(+prmL.inom) && +prmL.inom > 0 ? +prmL.inom : iNome > 0 ? iNome : 1;
        info.dcr = isFinite(+prmL.dcr) && +prmL.dcr > 0 ? +prmL.dcr : rNome > 0 && rNome < 1e4 ? rNome : 0.05;
        info.tipo = 'indutor'; info.l = lv; info.rotulo = 'Indutor ' + fmt(lv, 'H') + ' (' + fmt(info.inom, 'A') + ', DCR ' + fmt(info.dcr, 'Ω') + ')';
        info.campos = [{ k: 'inom', rot: 'Corrente nominal (A)', un: 'A', v: info.inom, dica: '1,25' }, { k: 'dcr', rot: 'Resistência DCR (Ω)', un: 'Ω', v: info.dcr, dica: '0,05' }];
        const meio = nInt(ref, 'dcr');
        poe(info, { tipo: 'R', nos: [nomeTerm(info, p1), meio], r: info.dcr, papel: 'DCR' }, [pk(info, p1), null]);
        info.el = poe(info, { tipo: 'L', nos: [meio, nomeTerm(info, p2)], l: lv, papel: 'L' }, [null, pk(info, p2)]);
        continue;
      }
      /* --- ponte retificadora */
      if (/^(BR|DB|PR)$/.test(pre) && c.pinos.length === 4 || /PONTE|BRIDGE|\bKBP|\bMB[0-9]+S|\bDB10[0-9]|\bGBU|\bKBL|\bW0[0-9]M|\bDF0[0-9]/.test(txt)) {
        const ac1 = achaPino(info, ['~', 'AC1', 'AC', '~1', 'AC_1'], 2) || c.pinos[0];
        const ac2 = c.pinos.find(p => p !== ac1 && /~|AC/i.test(p.name || '')) || achaPino(info, [], 3);
        const pos = achaPino(info, ['+', 'POS', 'DC+', 'V+'], 1), neg = achaPino(info, ['-', 'NEG', 'DC-', 'V-'], 4);
        /* 1.116.0 (lote 4): If max e VRRM do nome ("1000V 20A GBL", "GBJ 20a 1000v", "VRRM 1kV 4A DF410", "60V 160mA
           B60C160", "SKB1,2/02 200V 1,2A") ou da familia; a queima pela corrente de saida e pelo reverso */
        const prmP = (cfg.params && cfg.params[ref]) || {};
        const iNomeP = grandezaDoNome(c.comment, 'A');
        let mP, ifP = NaN, vrP = val.tensao > 0 ? val.tensao : NaN;
        /* o Semikron SKBa,b/cc: If a,b A e VRRM cc·100 V pelo codigo (o "310V" do nome e a entrada AC) */
        if ((mP = /\bSKB\s?(\d+(?:[.,]\d)?)\s*\/\s*(\d{2})/.exec(txt))) { vrP = +mP[2] * 100; ifP = +mP[1].replace(',', '.'); }
        if ((mP = /\bDF(\d)(\d{2})/.exec(txt)) && !(vrP > 0)) vrP = { '005': 50, '01': 100, '02': 200, '04': 400, '06': 600, '08': 800, '10': 1000 }[mP[2]] || +mP[2] * 100;
        if ((mP = /\bB(\d{2,3})C(\d{3,4})/.exec(txt))) { if (!(vrP > 0)) vrP = +mP[1]; ifP = +mP[2] / 1000; }
        if ((mP = /\b(?:GBJ|GBU|KBP|KBL|GBL|KBU|RS|DB)(\d{1,2})(\d{2})/.exec(txt)) && !(iNomeP > 0)) ifP = { GBJ: 1, GBU: 1, KBU: 1, GBL: 1 }[mP[0].replace(/\d/g, '')] ? +mP[1] : +mP[1];
        const ifmaxP = isFinite(+prmP.ifmax) && +prmP.ifmax > 0 ? +prmP.ifmax : iNomeP > 0 ? iNomeP : ifP > 0 ? ifP : /MB\d+S|DF\d/.test(txt) ? 0.5 : 1;
        const vrrmP = isFinite(+prmP.vrrm) && +prmP.vrrm > 0 ? +prmP.vrrm : vrP > 0 ? vrP : 400;
        info.tipo = 'ponte'; info.ifmax = ifmaxP; info.vrrm = vrrmP; info.pPos = pos; info.pNeg = neg;
        info.rotulo = 'Ponte retificadora ' + fmt(ifmaxP, 'A') + ' / ' + fmt(vrrmP, 'V');
        info.campos = [{ k: 'ifmax', rot: 'Corrente máxima (A)', un: 'A', v: ifmaxP, dica: '1, 20' }, { k: 'vrrm', rot: 'VRRM (V)', un: 'V', v: vrrmP, dica: '1000' }];
        const m = { is: 1.4e-8, n: 1.98, rs: 0.04 };
        info.dios = [diodo(info, ac1, pos, m, 'diodo AC1→+'), diodo(info, ac2, pos, m, 'diodo AC2→+'), diodo(info, neg, ac1, m, 'diodo −→AC1'), diodo(info, neg, ac2, m, 'diodo −→AC2')];
        continue;
      }
      /* --- LED */
      if (/^(LD|LED|DL|D)$/.test(pre) && /LED|VERDE|VERMELH|AMAREL|AZUL|BRANC|GREEN|RED|YELLOW|BLUE|WHITE/.test(txt) && !/OPTO|PC817/.test(txt) || /^(LD|LED|DL)$/.test(pre)) {
        const cor = CORES_LED.find(([re]) => re.test(txt)) || [null, 2.0, '#ff3b30'];
        /* 1.109.0: a tensao de ativacao (Vf) e a corrente maxima editaveis na simulacao (cfg.params[ref] = {vf, imax});
           1.113.0: o nome da peca manda quando traz ("Amarelo Redondo 3V 200mA") */
        const prm = (cfg.params && cfg.params[ref]) || {};
        /* o IR: o "2V" do nome e o Vf maximo (o tipico e 1,2-1,5 V) */
        const ehIR = cor[1] < 1.5;
        const vfNome = val.tensao >= 1 && val.tensao <= 4.5 && !(ehIR && val.tensao > 1.6) ? val.tensao : null, iNome = val.corrente >= 1e-3 && val.corrente <= 3 ? val.corrente : null;
        const vf = isFinite(+prm.vf) && +prm.vf > 0 ? +prm.vf : vfNome || cor[1], n = 2;
        info.imax = isFinite(+prm.imax) && +prm.imax > 0 ? +prm.imax : iNome || 0.02;   // a corrente nominal de um LED de indicacao
        /* 1.114.0: o fototransistor e o display de 7 segmentos que estao na categoria LED: nao simulados aqui (lote 6) */
        if (/FOTOTRANS|PHOTOTRANS|FOTODIOD|PHOTODIOD/.test(txt)) { info.tipo = 'ignorado'; info.rotulo = 'Fototransistor/fotodiodo (sensor: não simulado ainda)'; continue; }
        if (/7 ?SEG|SETE SEG|DISPLAY/.test(txt)) { info.tipo = 'ignorado'; info.rotulo = 'Display de LEDs (não simulado ainda)'; continue; }
        /* o LED enderecavel (WS2812, SK6812, APA102) tem um CI dentro: nao e simulado aqui */
        if (/WS28\d\d|SK68\d\d|APA10\d|ENDERE[CÇ]AVEL|ADDRESSABLE|NEOPIXEL/.test(txt)) { info.tipo = 'ignorado'; info.rotulo = 'LED endereçável (CI interno: não simulado)'; continue; }
        /* LED RGB / bicolor (3-4 pinos): o comum (pino chamado COM/A/K, senao o 2) e um LED por cor */
        if (c.pinos.length >= 3) {
          const anodoComum = /ANODO COMUM|ANODE COMUM|COMMON ANODE|ANODE COMMON|\bCA\b|ANODO COM\b/.test(txt);
          const com = achaPino(info, [/^(COM|COMUM|COMMON|CA|CC|\+|-|A|K|ANODE|CATHODE|ANODO|CATODO|GND|VCC)$/i], null) || achaPino(info, [], 2) || c.pinos[1];
          const resto = c.pinos.filter(q => q !== com);
          const corDe = (q, k) => {
            const nm = norm(q.name || '');
            const porNome = /^(R|RED|VERM\w*)$/.test(nm) ? 0 : /^(G|GREEN|VERDE)$/.test(nm) ? 1 : /^(B|BLUE|AZUL)$/.test(nm) ? 2 : -1;
            const rgb = [[1.9, '#ff3b30', 'vermelho'], [3.0, '#34c759', 'verde'], [3.0, '#0a84ff', 'azul']];
            if (porNome >= 0) return rgb[porNome];
            if (resto.length === 2) { const cs = CORES_LED.filter(([re]) => re.test(txt)); const x = cs[k] || [null, ...rgb[k ? 1 : 0].slice(0, 2)]; return [x[1], x[2], k ? 'cor 2' : 'cor 1']; }
            return rgb[Math.min(k, 2)];
          };
          info.tipo = 'led'; info.vf = null; info.cor = '#ffffff'; info.canais = [];
          resto.forEach((q, k) => {
            const [vfc, hex, nomeC] = corDe(q, k), isc = 0.01 / Math.exp((vfc - 0.08) / (n * VT));
            const d = anodoComum ? diodo(info, com, q, { is: isc, n, rs: 8, vf: vfc }, 'LED ' + nomeC) : diodo(info, q, com, { is: isc, n, rs: 8, vf: vfc }, 'LED ' + nomeC);
            info.canais.push({ pino: q, cor: hex, nome: nomeC, vf: vfc, d });
          });
          info.d = info.canais[0] && info.canais[0].d; info.anodoComum = anodoComum;
          info.rotulo = 'LED ' + (resto.length === 2 ? 'bicolor' : 'RGB') + ' (' + (anodoComum ? 'anodo' : 'catodo') + ' comum no pino ' + com.num + ')';
          info.campos = [{ k: 'imax', rot: 'Corrente máxima por cor (A)', un: 'A', v: info.imax, dica: '20m' }];
          continue;
        }
        info.campos = [{ k: 'vf', rot: 'Tensão de ativação (Vf)', un: 'V', v: vf, dica: '2,1' }, { k: 'imax', rot: 'Corrente máxima (A)', un: 'A', v: info.imax, dica: '20m' }];
        const is = 0.01 / Math.exp((vf - 0.01 * 8) / (n * VT));
        const a = achaPino(info, ['A', 'ANODE', 'ANODO', '+'], 1), k = achaPino(info, ['K', 'C', 'CATHODE', 'CATODO', '-'], 2);
        info.tipo = 'led'; info.vf = vf; info.cor = cor[2]; info.rotulo = 'LED ' + (cor[0] ? norm(c.comment || '').toLowerCase() : '') + ' (Vf ≈ ' + fmt(vf, 'V') + ')';
        info.d = diodo(info, a, k, { is, n, rs: 8, vf }, 'LED');
        continue;
      }
      /* --- diodo, Schottky, zener, TVS */
      if (/^(D|DZ|Z|ZD|TVS|VD)$/.test(pre) && c.pinos.length === 2 && !/\bDIAC\b|\bDB[34]\b|\bDB3TG/.test(txt) && !/DIAC/.test(norm(c.sym || ''))) {   // 1.117.0: o DIAC e tiristor
        const a = achaPino(info, ['A', 'ANODE', 'ANODO', '+', '1'], null) || p1;
        const k = achaPino(info, ['K', 'C', 'CATHODE', 'CATODO', '-'], null) || c.pinos.find(p => p !== a);
        /* 1.113.0 (lote 1): o tipo pela categoria da lib (DIODO ZENER/TVS/SCHOTTKY/RETIFICADOR) e pelo nome; os limites que
           queimam (If max, VRRM, a potencia do zener) do modelo ou do nome ("6A 800V", "12V 1W"); Vz/Vbr editaveis */
        const prmD = (cfg.params && cfg.params[ref]) || {};
        const cm = norm(c.comment || '').replace(/,/g, '.');
        let bv = null, bid = false, nome = 'diodo', sub = 'retificador';
        const ehZener = /ZENER|\bZMM|\bBZ[XVT]|\bZPD|\b1N47[2-6]\d|\b1N5[23]\d\d|\bMMSZ|\bZMD|\bZY\d/.test(txt) || /^(DZ|Z|ZD)$/.test(pre);
        const ehTvs = !ehZener && (/\bTVS\b|TRANSIL|SMAJ|SMBJ|SMCJ|SMDJ|P6KE|P4KE|1\.5KE|\bSMF\d|\bSM712|\bSM\d+T|\bPESD|\bESD\d|\bSA\d/.test(txt) || /^TVS$/.test(pre));
        let m;
        if (ehZener) {
          sub = 'zener';
          if ((m = /1N47(2[89]|3\d|4\d|5[01])/.exec(txt))) bv = ZENER_1N47[+m[1]];
          if (!bv && (m = /(\d+)V(\d)\b/.exec(cm))) bv = parseFloat(m[1] + '.' + m[2]);
          if (!bv && (m = /(?:BZ[XVT]\d*\w*?C?|ZMM|MM[SB]Z\w*?|ZPD)\s*(\d+)V(\d)?/.exec(txt))) bv = parseFloat(m[1] + (m[2] ? '.' + m[2] : ''));
          if (!bv && val.tensao > 0) bv = val.tensao;
          if (!bv && (m = /(\d+(?:\.\d+)?)\s*V\b/.exec(txt))) bv = +m[1];
          info.pz = val.potencia > 0 ? val.potencia : /1N53\d\d/.test(txt) ? 5 : /1N47\d\d/.test(txt) ? 1 : 0.5;
        } else if (ehTvs) {
          sub = 'TVS'; nome = 'TVS';
          let vr = null;
          if ((m = /(?:SMBJ|SMAJ|SMCJ|SMDJ|P6KE|P4KE|1\.5KE|SMF|\bSA)(\d+(?:\.\d)?)(C?A)?/.exec(txt))) { vr = +m[1]; bid = /C/.test(m[2] || ''); if (/P6KE|P4KE|1\.5KE/.test(m[0])) vr = +m[1] / 1.11; }
          else if (/SM712|SP712/.test(txt)) { vr = 12; bid = true; }
          else if ((m = /\bSM(\d{2})C/.exec(txt))) { vr = +m[1]; bid = true; }
          else if ((m = /-T(\d{1,2})S?C\b/.exec(txt))) { vr = +m[1]; bid = /C\b/.test(m[0]); }
          else if ((m = /\bSM(\d{2})T/.exec(txt))) { vr = +m[1]; bid = true; }
          else if (val.tensao > 0) vr = val.tensao / 1.11;   // 1.114.0: a tensao do nome e o Vbr (como no 1.5KE300A)
          if (/BIDIR|\bCA\b|BI-?DIR/.test(txt)) bid = true;
          if (!vr) { vr = 5; info.avisos.push('tensão do TVS não conhecida: simulando com 5 V (mude no campo Vbr)'); }
          bv = vr * 1.11;
        }
        if (isFinite(+prmD.vz) && +prmD.vz > 0) bv = +prmD.vz;
        let mod = (DIODOS.find(([re]) => re.test(txt)) || [null, null])[1];
        if (/SCHOTT/.test(txt) && (!mod || mod.nome !== 'Schottky')) mod = DIODOS[2][1];
        if (bv) { mod = { is: 1e-9, n: 1.8, rs: 0.5 }; nome = sub === 'TVS' ? 'TVS ' + (bid ? 'bidirecional ' : '') + fmt(bv, 'V') : 'zener ' + fmt(bv, 'V'); }
        if (!mod) { mod = { is: 1e-9, n: 1.8, rs: 0.5, nome: 'genérico' }; if (!/DIOD|DIODE/.test(txt)) info.avisos.push('diodo sem modelo conhecido: diodo de silício genérico'); }
        if (!bv) sub = mod.nome === 'Schottky' ? 'Schottky' : mod.nome === 'sinal' ? 'sinal' : 'retificador';
        /* os limites: o nome da peca ("6A 800V", "1.2kV 8A") manda; senao a familia */
        const lim = limitesDiodo(txt);
        info.ifmax = isFinite(+prmD.ifmax) && +prmD.ifmax > 0 ? +prmD.ifmax : val.corrente > 0 && sub !== 'TVS' ? val.corrente : lim.ifmax || (sub === 'sinal' ? 0.3 : 1);
        info.vrrm = isFinite(+prmD.vrrm) && +prmD.vrrm > 0 ? +prmD.vrrm : !bv && val.tensao >= 10 ? val.tensao : lim.vrrm || (sub === 'Schottky' ? 40 : 100);
        if (isFinite(+prmD.pz) && +prmD.pz > 0) info.pz = +prmD.pz;
        if (!lim.ifmax && !(val.corrente > 0) && !bv) info.avisos.push('limites do diodo não conhecidos: If máx ' + fmt(info.ifmax, 'A') + ', VRRM ' + fmt(info.vrrm, 'V') + ' (mude nos campos)');
        info.tipo = 'diodo'; info.sub = sub; info.bv = bv; info.bidir = bid;
        info.rotulo = (bv ? nome : 'Diodo ' + (sub === 'retificador' && mod.nome === 'genérico' ? 'genérico' : sub)) + (c.comment ? ' (' + c.comment + ')' : '');
        if (sub === 'zener' && bv) info.ifmax = isFinite(+prmD.ifmax) && +prmD.ifmax > 0 ? +prmD.ifmax : info.pz / bv;   // Izm = Pz/Vz
        info.campos = sub === 'zener' ? [{ k: 'vz', rot: 'Tensão zener Vz (V)', un: 'V', v: bv, dica: '5,1' }, { k: 'pz', rot: 'Potência (W)', un: 'W', v: info.pz, dica: '0,5' }]
          : sub === 'TVS' ? [{ k: 'vz', rot: 'Tensão de ruptura Vbr (V)', un: 'V', v: bv, dica: '6,7' }, { k: 'ifmax', rot: 'If máx (A)', un: 'A', v: info.ifmax, dica: '1' }]
          : [{ k: 'ifmax', rot: 'Corrente máxima If (A)', un: 'A', v: info.ifmax, dica: '1' }, { k: 'vrrm', rot: 'Tensão reversa VRRM (V)', un: 'V', v: info.vrrm, dica: '1000' }];
        info.d = diodo(info, a, k, Object.assign({}, mod, { bv, bidir: bid }), nome);
        continue;
      }
      /* --- transistor bipolar */
      const bjt = BJTS.find(([re]) => re.test(desc));
      const fet = FETS.find(([re]) => re.test(desc));
      /* --- tiristores (1.117.0, lote 5): SCR (A, K, G; BT151/16TTS TO-220: 1 K, 2 A, 3 G), TRIAC (MT1, MT2, G; BT138/BTA:
         1 MT1, 2 MT2, 3 G), DIAC (2 pinos, dispara em Vbo e cai para ~5 V) e PUT (2N6027/28: 1 A, 2 G, 3 K; dispara com
         Va > Vg + 0,7 V). Todos TRAVAM: ligam pelo gatilho e so soltam quando a corrente cai abaixo da de manutencao (Ih) */
      const ehDiac = /\bDIAC\b|\bDB[34]\b|\bDB3TG|\bHT32/.test(txt) || /DIAC/.test(norm(c.sym || ''));
      const ehTriac = /TRIAC|\bBT13[6-9]|\bBTA\d|\bBTB\d|\bZ0\d{3}|\bMAC\d{2}|\bT\d{3,4}-\d{3}\b/.test(txt) && !/MOC|OPTO/.test(txt);
      const ehPut = /2N602[78]/.test(txt);
      const ehScr = /\bSCR\b|TIRIST|THYRIST|\bBT1[45]\d|\d+TTS\d|\bTYN\d|\bC106|\bMCR\d|\bTIC1\d{2}/.test(txt) && !ehTriac;
      if ((ehDiac && c.pinos.length === 2) || ((ehTriac || ehScr || ehPut) && c.pinos.length >= 3)) {
        const prmS = (cfg.params && cfg.params[ref]) || {};
        const cmS = String(c.comment || '').replace(/,/g, '.');
        const sub = ehDiac ? 'diac' : ehPut ? 'put' : ehTriac ? 'triac' : 'scr';
        let mS, vdrm = grandezaDoNome(cmS, 'V'), it = grandezaDoNome(cmS, 'A');
        if ((mS = /BT1[345]\d-?(\d{3})/.exec(txt))) vdrm = vdrm > 0 ? vdrm : +mS[1];
        if ((mS = /(\d+)TTS(\d{2})/.exec(txt))) { if (!(it > 0)) it = +mS[1]; if (!(vdrm > 0)) vdrm = +mS[2] * 100; }
        if ((mS = /BT[AB](\d{2})-?(\d{3})/.exec(txt))) { if (!(it > 0)) it = +mS[1]; if (!(vdrm > 0)) vdrm = +mS[2]; }
        const ref0 = { scr: { igt: 0.002, ih: 0.007, vdrm: 500, it: 12 }, triac: { igt: 0.01, ih: 0.02, vdrm: 600, it: 12 }, put: { igt: 0, ih: 25e-6, vdrm: 40, it: 0.15 }, diac: { igt: 0, ih: 1e-3, vdrm: 0, it: 2 } }[sub];
        if (/16TTS|\d+TTS/.test(txt)) Object.assign(ref0, { igt: 0.015, ih: 0.1 });
        const vboN = /(\d+)\s*~\s*(\d+)\s*V/.exec(cmS);
        info.vbo = sub === 'diac' ? (isFinite(+prmS.vbo) && +prmS.vbo > 0 ? +prmS.vbo : vboN ? (+vboN[1] + +vboN[2]) / 2 : 32) : null;
        info.igt = isFinite(+prmS.igt) && +prmS.igt > 0 ? +prmS.igt : ref0.igt;
        info.ih = isFinite(+prmS.ih) && +prmS.ih > 0 ? +prmS.ih : ref0.ih;
        info.vdrm = isFinite(+prmS.vdrm) && +prmS.vdrm > 0 ? +prmS.vdrm : vdrm > 0 && sub !== 'diac' ? vdrm : ref0.vdrm;
        info.itrms = isFinite(+prmS.itrms) && +prmS.itrms > 0 ? +prmS.itrms : it > 0 ? it : ref0.it;
        info.tipo = 'tiristor'; info.sub = sub; info.on = false;
        info.rotulo = { scr: 'SCR', triac: 'TRIAC', put: 'PUT (transistor unijunção programável)', diac: 'DIAC' }[sub] + ' ' + (c.comment || '') + (sub === 'diac' ? ' (dispara em ' + fmt(info.vbo, 'V') + ')' : ' (' + fmt(info.itrms, 'A') + ', ' + fmt(info.vdrm, 'V') + ')');
        info.campos = sub === 'diac' ? [{ k: 'vbo', rot: 'Tensão de disparo Vbo (V)', un: 'V', v: info.vbo, dica: '32' }, { k: 'itrms', rot: 'Corrente máx (A)', un: 'A', v: info.itrms, dica: '2' }]
          : (sub === 'put' ? [] : [{ k: 'igt', rot: 'Corrente de gatilho Igt (A)', un: 'A', v: info.igt, dica: '5m' }]).concat([{ k: 'ih', rot: 'Corrente de manutenção Ih (A)', un: 'A', v: info.ih, dica: '7m' },
            { k: 'vdrm', rot: 'Tensão máx VDRM (V)', un: 'V', v: info.vdrm, dica: '600' }, { k: 'itrms', rot: 'Corrente máx IT(RMS) (A)', un: 'A', v: info.itrms, dica: '12' }]);
        if (sub === 'diac') {
          const f = v => { const d = v[0] - v[1]; const i = info.on ? Math.sign(d) * sp(Math.abs(d) - 5, 0.05) / 10 + 1e-6 * d : 1e-9 * d; return [i, -i]; };
          const el = poe(info, { tipo: 'NL', nos: [nomeTerm(info, p1), nomeTerm(info, p2)], f, papel: 'DIAC' }, [pk(info, p1), pk(info, p2)]);
          el.reinicia = () => { info.on = false; };
          el.atualiza = v => { const d = Math.abs(v[0] - v[1]), i = info.on ? sp(d - 5, 0.05) / 10 : 0; const on = info.on ? i > info.ih : d > info.vbo; if (on === info.on) return false; info.on = on; return true; };
          info.el = el;
          continue;
        }
        /* os pinos: pelo nome; senao a ordem do encapsulamento */
        const nomes = { scr: [[/^(A|ANODE|ANODO)$/i, 2], [/^(K|C|CATHODE|CATODO)$/i, 1], [/^(G|GATE)$/i, 3]], triac: [[/^(MT2|A2|T2)$/i, 2], [/^(MT1|A1|T1)$/i, 1], [/^(G|GATE)$/i, 3]], put: [[/^(A|ANODE|ANODO)$/i, 1], [/^(K|C|CATHODE|CATODO)$/i, 3], [/^(G|GATE)$/i, 2]] }[sub];
        const [pA, pK, pG] = nomes.map(([re, n]) => achaPino(info, [re], n));
        if (!c.pinos.some(p => /^(A|K|G|MT\d|A\d|T\d|GATE)$/i.test(String(p.name || '')))) info.avisos.push('pinos sem nome: ' + (sub === 'triac' ? '1 MT1, 2 MT2, 3 G' : sub === 'put' ? '1 A, 2 G, 3 K' : '1 K, 2 A, 3 G'));
        /* [A(MT2), K(MT1), G]: o canal principal trava; o gatilho e um diodo G→K (SCR/TRIAC); o PUT compara A com G */
        const isG = 1e-14, nG = 1.5;
        const f = v => {
          const vak = v[0] - v[1], vgk = v[2] - v[1];
          let ia;
          if (info.on) ia = (sub === 'triac' ? Math.sign(vak) : 1) * sp((sub === 'triac' ? Math.abs(vak) : vak) - 0.9, 0.03) / 0.03 + 1e-9 * vak;
          else ia = 1e-9 * vak;
          const ig = sub === 'put' ? 1e-9 * vgk : (sub === 'triac' ? Math.sign(vgk) : 1) * isG * (lexp((sub === 'triac' ? Math.abs(vgk) : vgk) / (nG * VT)) - 1);
          return [ia, -ia - ig, ig];
        };
        const el = poe(info, { tipo: 'NL', nos: [nomeTerm(info, pA), nomeTerm(info, pK), nomeTerm(info, pG)], f, dc: [[0, 1]], papel: sub.toUpperCase() }, [pk(info, pA), pk(info, pK), pk(info, pG)]);
        el.reinicia = () => { info.on = false; };
        el.atualiza = v => {
          const vak = v[0] - v[1], vgk = v[2] - v[1];
          const ig = Math.abs(isG * (lexp(Math.abs(vgk) / (nG * VT)) - 1));
          const ia = info.on ? sp((sub === 'triac' ? Math.abs(vak) : vak) - 0.9, 0.03) / 0.03 : 0;
          let on = info.on;
          if (!on) {
            if (sub === 'put') on = (v[0] - v[2]) > 0.7 && vak > 0.5;
            else if (sub === 'triac') on = ig > info.igt && Math.abs(vak) > 0.5;
            else on = ig > info.igt && vgk > 0 && vak > 0.5;
          } else if (ia < info.ih) on = false;
          if (on === info.on) return false;
          info.on = on; return true;
        };
        info.el = el;
        continue;
      }
      const igbt = IGBT_RE.test(txt) && c.pinos.length >= 3;
      if ((/^(Q|T|TR|VT)$/.test(pre) || bjt || fet || igbt) && c.pinos.length >= 3 && !(/^(T|TR)$/.test(pre) && /TRAFO|TRANSF/.test(txt))) {
        const temG = achaPino(info, [/^G(ATE)?$/i], null), temB = achaPino(info, [/^B(ASE)?$/i], null);
        const ehFet = fet && !temB || (!bjt && temG) || /MOSFET|NMOS|PMOS|\bFET\b/.test(txt);
        if (ehFet || igbt) {
          /* 1.114.0 (lote 2): os limites (Vdss, Id max, Pd, Vgs max) e a Rds(on) da familia ou do nome ("55V 26A", "150V 144W
             33A"); o canal P pelo nome; Vth e Rds(on) editaveis (mudam o modelo: K = 1/(Rds·(Vgs_ref − Vth))). O IGBT: o
             mesmo gate, com o diodo da juncao PN em serie no coletor (Vce(sat) ≈ 1,5-2 V) */
          const lim = Object.assign({}, (FET_LIM.find(([re]) => re.test(desc)) || [null, {}])[1]);
          const canalP = /PMOS|P-?CH|CANAL P|P-CHANNEL|CANAL-P/.test(txt);
          const m = Object.assign({}, fet ? fet[1] : { pol: canalP ? -1 : 1, vth: igbt ? 5.5 : 2, k: 5, nome: igbt ? 'IGBT' : 'MOSFET genérico' });
          if (lim.pol) m.pol = lim.pol;
          if (canalP) m.pol = -1;
          if (igbt) { m.pol = 1; m.nome = 'IGBT'; }
          else m.nome = (m.pol < 0 ? 'MOSFET canal P' : 'MOSFET canal N') + (fet || lim.vdss ? '' : ' genérico');
          const prmM = (cfg.params && cfg.params[ref]) || {};
          const cmM = c.comment || '';
          const fpM = norm(c.footprint), peq = /SOT|SC-?70|SOIC|SO-?8|TSOP/.test(fpM);
          m.vth = isFinite(+prmM.vth) && +prmM.vth > 0 ? +prmM.vth : lim.vth || m.vth;
          info.vdss = isFinite(+prmM.vdss) && +prmM.vdss > 0 ? +prmM.vdss : grandezaDoNome(cmM, 'V') > 0 ? grandezaDoNome(cmM, 'V') : lim.vdss || (peq ? 30 : 60);
          info.idmax = isFinite(+prmM.idmax) && +prmM.idmax > 0 ? +prmM.idmax : grandezaDoNome(cmM, 'A') > 0 ? grandezaDoNome(cmM, 'A') : lim.id || (peq ? 3 : 10);
          info.pd = isFinite(+prmM.pd) && +prmM.pd > 0 ? +prmM.pd : grandezaDoNome(cmM, 'W') > 0 ? grandezaDoNome(cmM, 'W') : lim.pd || (peq ? 1.25 : 40);
          info.vgsmax = isFinite(+prmM.vgsmax) && +prmM.vgsmax > 0 ? +prmM.vgsmax : lim.vgs || 20;
          const vgsRef = m.vth < 1.5 ? 4.5 : 10;
          const rNomeM = grandezaDoNome(cmM, 'Ω');
          info.rdson = isFinite(+prmM.rdson) && +prmM.rdson > 0 ? +prmM.rdson : rNomeM > 0 && rNomeM < 50 ? rNomeM : lim.rds || (fet ? 1 / (m.k * Math.max(0.5, vgsRef - m.vth)) : Math.max(0.005, 0.5 / info.idmax));
          m.k = 1 / (info.rdson * Math.max(0.5, vgsRef - m.vth));
          info.campos = [{ k: 'vth', rot: 'Vth (V)', un: 'V', v: m.vth, dica: '2, 4' }, { k: 'rdson', rot: igbt ? 'R de condução (Ω)' : 'Rds(on) (Ω)', un: 'Ω', v: info.rdson, dica: '0,04' },
            { k: 'idmax', rot: igbt ? 'Ic máx (A)' : 'Id máx (A)', un: 'A', v: info.idmax, dica: '20' }, { k: 'vdss', rot: igbt ? 'Vces (V)' : 'Vdss (V)', un: 'V', v: info.vdss, dica: igbt ? '600' : '60' },
            { k: 'pd', rot: 'Potência Pd (W)', un: 'W', v: info.pd, dica: '50' }, { k: 'vgsmax', rot: igbt ? 'Vge máx (V)' : 'Vgs máx (V)', un: 'V', v: info.vgsmax, dica: '20' }];
          const sot = /SOT-?23|SOT-?323|SC-?70/.test(fpM);
          const g = achaPino(info, [/^G(ATE)?$/i], 1), d = achaPino(info, igbt ? [/^C(OL\w*)?$/i, /^D(RAIN)?$/i] : [/^D(RAIN)?$/i], sot ? 3 : 2), s = achaPino(info, igbt ? [/^E(MIT\w*)?$/i, /^S(OURCE)?$/i] : [/^S(OURCE)?$/i], sot ? 2 : 3);
          info.tipo = igbt ? 'igbt' : 'mosfet'; info.rotulo = m.nome + (c.comment ? ' ' + c.comment : ''); info.m = m;
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
          if (igbt) {
            /* o coletor entra por uma juncao PN (o Vce(sat)) ate o "dreno" interno */
            const meio = nInt(ref, 'igbt');
            diodo(info, d, null, { is: 1e-10, n: 1.5, rs: 0.01 }, 'junção do coletor');
            const ult = elementos[elementos.length - 1]; ult.nos[1] = meio;
            info.q = poe(info, { tipo: 'NL', nos: [meio, nomeTerm(info, g), nomeTerm(info, s)], f, dc: [[0, 2]], papel: 'IGBT' }, [null, pk(info, g), pk(info, s)]);
            info.junc = ult;
            continue;
          }
          info.q = poe(info, { tipo: 'NL', nos: [nomeTerm(info, d), nomeTerm(info, g), nomeTerm(info, s)], f, dc: [[0, 2]], papel: 'MOSFET', junc: [[2, 0, 1.6 * VT, 1e-11, pol]] }, [pk(info, d), pk(info, g), pk(info, s)]);
          if (!fet && !FET_LIM.some(([re]) => re.test(desc))) info.avisos.push('MOSFET sem modelo conhecido: Vth ' + fmt(m.vth, 'V') + ', os limites do nome');
          if (!(achaPino(info, [/^G(ATE)?$/i], null))) info.avisos.push('pinos sem nome G/D/S: usei a ordem do encapsulamento');
          continue;
        }
        const m = bjt ? Object.assign({}, bjt[1], BJT_PNP_FIX.test(desc) && bjt[1].pol > 0 && bjt[1].bf < 900 ? { pol: -1, nome: 'PNP' } : {}) : { pol: /PNP/.test(txt) ? -1 : 1, bf: 150, is: 1e-14, nf: 1, nome: /PNP/.test(txt) ? 'PNP' : 'NPN' };
        /* 1.113.0 (lote 1): o "PNP"/"NPN" escrito no nome manda; β, Ic max, Pd e Vceo editaveis (o que queima) */
        if (/\bPNP\b/.test(txt) && m.pol > 0) { m.pol = -1; m.nome = m.nome.replace('NPN', 'PNP'); }
        else if (/\bNPN\b/.test(txt) && m.pol < 0) { m.pol = 1; m.nome = m.nome.replace('PNP', 'NPN'); }
        const prmQ = (cfg.params && cfg.params[ref]) || {};
        if (isFinite(+prmQ.bf) && +prmQ.bf > 0) m.bf = +prmQ.bf;
        if (!bjt) info.avisos.push('transistor sem modelo conhecido: ' + m.nome + ' genérico, β = ' + m.bf);
        const limQ = Object.assign({ ic: 0.5, vceo: 40, pd: 0.5 }, (BJT_LIM.find(([re]) => re.test(desc)) || [null, {}])[1]);
        if (/TO-?220|TO-?247|TO-?3P|TO-?126|DPAK|D2PAK/.test(norm(c.footprint)) && !BJT_LIM.some(([re]) => re.test(desc))) Object.assign(limQ, { ic: 3, pd: 20 });
        const cmQ = norm(c.comment || '').replace(/,/g, '.');
        /* o numero solto com a unidade (o BC546A e o MMBT2907A nao sao corrente) */
        const vNome = /(?:^|[\s/_(-])(\d+(?:\.\d+)?)\s*V\b/.exec(cmQ), aNome = /(?:^|[\s/_(-])(\d+(?:\.\d+)?)\s*(M?)A\b/.exec(cmQ), wNome = /(?:^|[\s/_(-])(\d+(?:\.\d+)?)\s*(M?)W\b/.exec(cmQ);
        if (vNome) limQ.vceo = +vNome[1];
        if (aNome) limQ.ic = +aNome[1] * (aNome[2] ? 1e-3 : 1);
        if (wNome) limQ.pd = +wNome[1] * (wNome[2] ? 1e-3 : 1);
        /* 1.114.0: o generico de corrente alta ("100V 5A") e de encapsulamento de potencia: Pd de TO-220/TO-126 */
        else if (!BJT_LIM.some(([re]) => re.test(desc)) && limQ.ic >= 1) limQ.pd = /SOT|SC-?70|TO-?92/.test(norm(c.footprint)) ? 1 : 20;
        info.icmax = isFinite(+prmQ.icmax) && +prmQ.icmax > 0 ? +prmQ.icmax : limQ.ic;
        info.vceo = isFinite(+prmQ.vceo) && +prmQ.vceo > 0 ? +prmQ.vceo : limQ.vceo;
        info.pd = isFinite(+prmQ.pd) && +prmQ.pd > 0 ? +prmQ.pd : limQ.pd;
        info.campos = [{ k: 'bf', rot: 'Ganho β (hFE)', un: '', v: m.bf, dica: '100, 250' }, { k: 'icmax', rot: 'Ic máx (A)', un: 'A', v: info.icmax, dica: '100m, 3' },
          { k: 'pd', rot: 'Potência Pd (W)', un: 'W', v: info.pd, dica: '0,5' }, { k: 'vceo', rot: 'Vceo (V)', un: 'V', v: info.vceo, dica: '45' }];
        /* a pinagem do encapsulamento quando os pinos nao tem nome B/C/E */
        const fpQ = norm(c.footprint), pin = (BJT_PINAGEM.find(([re, , onde]) => re.test(onde === 'fp' ? fpQ : desc)) || [null, 'CBE'])[1];
        const ordQ = l => String(pin.indexOf(l) + 1);
        const C_ = achaPino(info, [/^C(OL\w*)?$/i], ordQ('C')), B = achaPino(info, [/^B(ASE)?$/i], ordQ('B')), E = achaPino(info, [/^E(MIT\w*)?$/i], ordQ('E'));
        if (!achaPino(info, [/^B(ASE)?$/i], null)) info.avisos.push('pinos sem nome B/C/E: usei a ordem ' + pin.split('').map((l, k) => (k + 1) + ' ' + l).join(', '));
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
      /* --- rele (1.115.0, lote 3: antes da chave — o "1 Form C G5LE" virava chave): a bobina pelo nome ou pelo codigo (Finder
         30.22.7.005 = 5 V; G5LE-14-DC5 = 5 V), a resistencia, a corrente do contato; a pinagem sem nome: 1-2 bobina, 3 COM,
         4 NA, 5 NF. O rele de estado solido (photoMOS PVG612, AQY, G3VM, TLP222) e outro modelo: LED na entrada, MOSFET na saida */
      const ehSsr = /PVG6\d\d|PVT\d|AQ[YVW]\d|G3VM|CRYDOM|MCPC\d|\bD24\d\d|TLP22\d|TLP17\d|CPC1\d{3}|LCA\d{3}|\bSSR\b|ESTADO SOLIDO|PHOTOMOS/.test(txt);
      if (ehSsr && c.pinos.length >= 4) {
        const prmS = (cfg.params && cfg.params[ref]) || {};
        const la = achaPino(info, [/^(A|AN\w*|\+|IN\+|LED\+)$/i], 1), lk = achaPino(info, [/^(K|C|CAT\w*|-|IN-|LED-)$/i], 2);
        const o1 = achaPino(info, [/^(D1|OUT1|LOAD1|O1)$/i], c.pinos.length >= 6 ? 4 : 3), o2 = achaPino(info, [/^(D2|OUT2|LOAD2|O2)$/i], c.pinos.length >= 6 ? 6 : 4);
        info.tipo = 'ssr'; info.ion = isFinite(+prmS.ion) && +prmS.ion > 0 ? +prmS.ion : 5e-3;
        info.imax = isFinite(+prmS.imax) && +prmS.imax > 0 ? +prmS.imax : grandezaDoNome(c.comment, 'A') > 0 ? grandezaDoNome(c.comment, 'A') : /PVG612/.test(txt) ? 1 : 0.5;
        info.rotulo = 'Relé de estado sólido ' + (c.comment || '') + ' (LED de entrada, MOSFET na saída)';
        info.campos = [{ k: 'ion', rot: 'Corrente para ligar o LED (A)', un: 'A', v: info.ion, dica: '5m' }, { k: 'imax', rot: 'Corrente máx da saída (A)', un: 'A', v: info.imax, dica: '1' }];
        info.led = diodo(info, la, lk, { is: 1e-16, n: 1.8, rs: 1, vf: 1.2 }, 'LED de entrada');
        info.sw = poe(info, { tipo: 'SW', nos: [nomeTerm(info, o1), nomeTerm(info, o2)], fechada: false, ron: 0.1, papel: 'saída (MOSFET)' }, [pk(info, o1), pk(info, o2)]);
        info.ligado = false;
        info.led.reinicia = () => { info.ligado = false; info.sw.fechada = false; };
        /* a corrente do LED pela equacao do diodo (o mesmo Is/n do modelo): acima da de ligar, a saida fecha */
        info.led.atualiza = v => { const i = 1e-16 * (lexp((v[0] - v[1]) / (1.8 * VT)) - 1), on = info.ligado ? i > info.ion * 0.5 : i > info.ion; if (on === info.ligado) return false; info.ligado = on; info.sw.fechada = on; return true; };
        continue;
      }
      if (/^(K|RL|RY|REL)$/.test(pre) && c.pinos.length >= 4 || /RELE|RELAY|\bSRD-|\bHK\d|\bJQC|\bG5[VLQ]|\bHF\d|\b\d{2}\.\d{2}\.\d\.\d{3}/.test(txt)) {
        const prmK = (cfg.params && cfg.params[ref]) || {};
        let vbob = NaN, mK;
        if ((mK = /\b\d{2}\.\d{2}\.\d\.(\d{3})/.exec(txt))) vbob = +mK[1];                     // Finder: .005/.012/.024
        else if ((mK = /\bDC\s?-?(\d{1,2})\b/.exec(txt))) vbob = +mK[1];                       // G5LE-14-DC5, MY4N-D2-DC24
        else if ((mK = /-(\d{1,2})\s*V\b/.exec(txt))) vbob = +mK[1];                              // Metaltex AX1RC-5V (o "24VDC" depois e do contato)
        else if ((mK = /(\d{1,2})\s*V\s*(?:CC|DC)?\s*(?:\(|BOBINA)|BOBINA\s*(\d{1,2})\s*V/.exec(txt))) vbob = +(mK[1] || mK[2]);
        else if ((mK = /(\d{1,2})\s*VDC\b/.exec(txt))) vbob = +mK[1];
        else if (val.tensao > 0) vbob = val.tensao;
        else if ((mK = /(\d+)\s*V(?:DC)?\b/.exec(txt))) vbob = +mK[1];
        if (!(vbob > 0)) vbob = 12;
        if (isFinite(+prmK.vbob) && +prmK.vbob > 0) vbob = +prmK.vbob;
        const rb = isFinite(+prmK.rbob) && +prmK.rbob > 0 ? +prmK.rbob : vbob * vbob / 0.36;
        const icont = isFinite(+prmK.icontato) && +prmK.icontato > 0 ? +prmK.icontato : grandezaDoNome(c.comment, 'A') > 0 ? grandezaDoNome(c.comment, 'A') : /G5LE|SRD|JQC/.test(txt) ? 10 : /\b41\.52/.test(txt) ? 8 : /\b30\.22/.test(txt) ? 2 : 5;
        const semNome = !c.pinos.some(p => /[A-Z]/i.test(String(p.name || '')));
        const b1 = achaPino(info, [/^(A1|COIL\+?|BOB\w*1?|L1|\+)$/i], 1), b2 = achaPino(info, [/^(A2|COIL-?|BOB\w*2|L2|-)$/i], 2);
        const com = achaPino(info, [/^(COM\w*|C|11|COMUM)$/i], semNome ? 3 : null), na = achaPino(info, [/^(NO\w*|NA|14|N\.?A\.?)$/i], semNome ? 4 : null), nf = achaPino(info, [/^(NC\w*|NF|12|N\.?F\.?)$/i], semNome && c.pinos.length >= 5 ? 5 : null);
        if (semNome) info.avisos.push('pinos sem nome: 1-2 bobina, 3 comum, 4 NA' + (c.pinos.length >= 5 ? ', 5 NF' : ''));
        info.tipo = 'rele'; info.vbob = vbob; info.rbob = rb; info.icontato = icont; info.rotulo = 'Relé ' + fmt(vbob, 'V') + ' (bobina ≈ ' + fmt(rb, 'Ω') + ', contato ' + fmt(icont, 'A') + ')';
        info.campos = [{ k: 'vbob', rot: 'Tensão da bobina (V)', un: 'V', v: vbob, dica: '5, 12, 24' }, { k: 'rbob', rot: 'Resistência da bobina (Ω)', un: 'Ω', v: rb, dica: '70, 400' },
          { k: 'icontato', rot: 'Corrente do contato (A)', un: 'A', v: icont, dica: '10' }];
        const contatos = [];
        if (com && na) contatos.push(poe(info, { tipo: 'SW', nos: [nomeTerm(info, com), nomeTerm(info, na)], fechada: false, papel: 'contato NA' }, [pk(info, com), pk(info, na)]));
        if (com && nf) contatos.push(poe(info, { tipo: 'SW', nos: [nomeTerm(info, com), nomeTerm(info, nf)], fechada: true, papel: 'contato NF', nf: true }, [pk(info, com), pk(info, nf)]));
        if (!com) info.avisos.push('contatos sem nome COM/NO/NC: só a bobina é simulada');
        info.contatos = contatos;
        const bob = resistor(info, b1, b2, rb, 'bobina');
        info.bob = bob; info.b1 = b1; info.b2 = b2;
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
      /* --- chave / botao (1.115.0, lote 3): o DIP switch (N chaves, i ↔ 2N+1−i, cada uma no campo), a chave de 6 vias
         (2 polos, o comum no meio), a de 3 posicoes (liga-desliga-liga), a rotativa (comum + N posicoes); a corrente do
         contato (do nome) — acima de 1,5x o contato queima e ABRE. O CI high-side (BTS711) e o interruptor optico (EE-SX)
         nao sao chave */
      if (/BTS\d{3}|HIGH-?SIDE|HI-?SIDE/.test(txt)) { info.tipo = 'ignorado'; info.rotulo = 'CI chave high-side (não simulado ainda)'; continue; }
      else if (/EE-?SX\d|INTERRUPTOR OPTICO|OPTICAL SWITCH|FOTOINTERR|\bOPB\d|PHCT\d|\bITR\d{4,5}\b|OPTCOELETR|OPTOELETR/.test(txt) && !/~|\//.test(txt)) { info.tipo = 'ignorado'; info.rotulo = 'Interruptor óptico (sensor: não simulado ainda)'; continue; }
      else if (/^(S|SW|SB|BT|BTN|KEY|PB|K|CH)$/.test(pre) && /TACT|PUSH|BOT|BUTTON|CHAVE|SWITCH|SW|KEY|DIP|TOGGLE|SPST|SPDT|MICRO/.test(txt) || /^(SW|S|SB|BTN|PB|KEY)$/.test(pre) || /^(CHAVE|DIP SWITCH)/.test(norm(c.sym || ''))) {
        const prmW = (cfg.params && cfg.params[ref]) || {};
        const mom = /TACT|TATIL|PUSH|BOT[AÃ]O|BUTTON|PB|KEY|MOMENT|SEM TRAVA/.test(txt) || /^(PB|BTN|KEY|SB)$/.test(pre);
        const fech = cfg.chaves && cfg.chaves[ref] != null ? !!cfg.chaves[ref] : false;
        const n = c.pinos.length, ord = [...c.pinos].sort((x, y) => (+x.num || 0) - (+y.num || 0));
        const dip = /DIP/.test(txt) && n >= 4 && n % 2 === 0;
        const rot = n >= 5 && /ROTAT|POSI[CÇ]|POLO|POLE/.test(txt) && !dip;
        const tresPos = n === 3 && /LIGA.*DESLIGA.*LIGA|ON-?OFF-?ON|3 POSI/.test(txt);
        info.tipo = 'chave'; info.interativo = mom ? 'botao' : 'chave'; info.fechada = fech;
        const iNomeW = grandezaDoNome(c.comment, 'A');
        info.imax = isFinite(+prmW.imax) && +prmW.imax > 0 ? +prmW.imax : iNomeW > 0 ? iNomeW : dip ? 0.1 : mom ? 0.05 : 1;
        info.contatos = [];
        const sw = (a, b, quandoFechada, papel) => { const el = poe(info, { tipo: 'SW', nos: [nomeTerm(info, a), nomeTerm(info, b)], fechada: quandoFechada === fech, papel }, [pk(info, a), pk(info, b)]); info.contatos.push({ el, on: quandoFechada }); return el; };
        info.campos = [];
        if (dip) {
          /* N chaves independentes: a k-esima entre o pino k e o 2N+1−k; o campo swK (0/1); o clique liga/desliga todas */
          const N = n / 2;
          info.dip = [];
          for (let k = 0; k < N; k++) {
            const lig = prmW['sw' + (k + 1)] != null ? +prmW['sw' + (k + 1)] > 0 : fech;
            const el = poe(info, { tipo: 'SW', nos: [nomeTerm(info, ord[k]), nomeTerm(info, ord[n - 1 - k])], fechada: lig, papel: 'chave ' + (k + 1) }, [pk(info, ord[k]), pk(info, ord[n - 1 - k])]);
            info.dip.push(el); info.contatos.push({ el, on: true, dip: true });
            info.campos.push({ k: 'sw' + (k + 1), rot: 'Chave ' + (k + 1) + ' (0 aberta, 1 fechada)', un: '', v: lig ? 1 : 0, dica: '0 ou 1' });
          }
          info.sw = info.dip[0];
          info.rotulo = 'DIP switch de ' + N + ' chaves (' + info.dip.map(e => e.fechada ? '1' : '0').join('') + ')';
          info.aplicaChave = f => { for (const e of info.dip) e.fechada = f; };
        } else if (rot || tresPos) {
          /* rotativa / 3 posicoes: o comum (C/COM ou o pino 1 na rotativa, o 2 na de 3 posicoes) e uma posicao fechada por vez */
          const com = achaPino(info, [/^(C|COM\w*|COMUM)$/i], tresPos ? 2 : 1);
          const posP = ord.filter(p => p !== com);
          const nPos = tresPos ? 3 : posP.length;
          const pos = Math.max(0, Math.min(nPos - 1, isFinite(+prmW.posicao) ? Math.round(+prmW.posicao) - 1 : 0));
          info.posicoes = nPos; info.posicao = pos;
          if (tresPos) { const alvo = pos === 0 ? posP[0] : pos === 2 ? posP[1] : null; posP.forEach(p => poe(info, { tipo: 'SW', nos: [nomeTerm(info, com), nomeTerm(info, p)], fechada: p === alvo, papel: 'posição ' + p.num }, [pk(info, com), pk(info, p)])); }
          else posP.forEach((p, k) => poe(info, { tipo: 'SW', nos: [nomeTerm(info, com), nomeTerm(info, p)], fechada: k === pos, papel: 'posição ' + (k + 1) }, [pk(info, com), pk(info, p)]));
          for (const el of info.elementos) info.contatos.push({ el, on: null });
          info.sw = null;
          info.rotulo = (tresPos ? 'Chave de 3 posições (liga-desliga-liga)' : 'Chave rotativa de ' + nPos + ' posições') + ': posição ' + (pos + 1) + (tresPos && pos === 1 ? ' (desligada)' : '');
          info.campos.push({ k: 'posicao', rot: 'Posição (1 a ' + nPos + ')', un: '', v: pos + 1, dica: '1 a ' + nPos });
        } else {
          let a = p1, b = p2;
          if (n === 4) {
            /* tactil 6x6: 1-2 ligados, 3-4 ligados; a chave e entre os pares */
            const q3 = achaPino(info, [], 3), q4 = achaPino(info, [], 4);
            resistor(info, p1, p2, 1e-3, 'ligação interna 1–2'); resistor(info, q3, q4, 1e-3, 'ligação interna 3–4');
            a = p1; b = q3;
          } else if (n === 6) {
            /* 2 polos de 3 vias (1-2-3 e 4-5-6, o comum no meio): fechada = 2-1 e 5-4; aberta = 2-3 e 5-6 */
            const q = k => ord[k - 1];
            sw(q(2), q(3), false, 'polo 1: 2–3'); sw(q(5), q(4), true, 'polo 2: 5–4'); sw(q(5), q(6), false, 'polo 2: 5–6');
            a = q(2); b = q(1);
            if (/LED/.test(txt)) info.avisos.push('a chave com LED: só os contatos são simulados');
          } else if (n === 3) {
            /* SPDT: comum no meio (2), 1 e 3 nas pontas: fechada = 2-1, aberta = 2-3 */
            const com = achaPino(info, ['COM', 'C', '2'], 2), x1 = achaPino(info, ['NO', '1'], 1), x3 = achaPino(info, ['NC', '3'], 3);
            info.sw2 = sw(com, x3, false, 'posição 2–3');
            a = com; b = x1;
          }
          info.sw = sw(a, b, true, 'contato');
          info.rotulo = (mom ? 'Botão' : 'Chave') + (fech ? ' (fechado)' : ' (aberto)');
          info.aplicaChave = f => { for (const k of info.contatos) k.el.fechada = k.on === f; };
        }
        info.campos.push({ k: 'imax', rot: 'Corrente do contato (A)', un: 'A', v: info.imax, dica: '50m, 3' });
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
      /* --- modulo conversor DC/DC isolado (1.115.0, lote 3): Mornsun/Recom/TI ("10.8~13.2/5 2W A1205S", "18~36/±15 3W",
         "E2415S-1WR3", DCP010505, "Mt3608 Step Up"): saida em Vout (Imax = P/Vout), a entrada consome Pout/η, sem saida com
         Vin fora da faixa. Pinagem sem nome (SIP-4): 1 −Vin, 2 +Vin, 3 −Vout/0V, 4 +Vout */
      if ((/CONVERSOR DC\/?DC|DC-?DC/.test(norm(c.sym || '') + ' ' + txt) || /DCP01\d{4}|MT3608|STEP[ -]?(UP|DOWN)|\d+(?:[.,]\d+)?\s*~\s*\d+(?:[.,]\d+)?\s*\/\s*[±+-]?\d/.test(txt)) && c.pinos.length >= 4 && c.pinos.length <= 12 && !/DPA\d|TOP\d{3}|LNK\d/.test(txt)) {
        const prmD = (cfg.params && cfg.params[ref]) || {};
        const cm = String(c.comment || '').replace(/,/g, '.');
        let vin = NaN, vimin = NaN, vimax = NaN, vo = NaN, pw = grandezaDoNome(cm, 'W'), dual = /±|\bD\b|\d{4}D\b/.test(cm), mD;
        if ((mD = /(\d+(?:\.\d+)?)\s*~\s*(\d+(?:\.\d+)?)\s*\/\s*(±|\+\/-)?\s*-?\s*(\d+(?:\.\d+)?)/.exec(cm))) { vimin = +mD[1]; vimax = +mD[2]; vo = +mD[4]; if (mD[3]) dual = true; }
        /* "24/5 2W", "5/±15 2W", "-16.5/±15 1W": Vin/Vout sem a faixa (a entrada nominal ±10 %) */
        else if ((mD = /(?:^|\s)[+-]?(\d+(?:\.\d+)?)\s*\/\s*(±|\+\/-)?\s*-?\s*(\d+(?:\.\d+)?)\s*V?\s+\d/.exec(cm))) { vin = +mD[1]; vo = +mD[3]; if (mD[2]) dual = true; }
        else if ((mD = /\b(?:[ABEFI]\w?|WR)?(\d{2})(\d{2})([SDT])(?:-(\d+)W)?/.exec(cm.toUpperCase()))) { vin = +mD[1]; vo = +mD[2]; if (mD[3] === 'D') dual = true; if (mD[4] && !(pw > 0)) pw = +mD[4]; }
        else if ((mD = /DCP01(\d{2})(\d{2})/.exec(cm.toUpperCase()))) { vin = +mD[1]; vo = +mD[2]; if (!(pw > 0)) pw = 1; }
        /* faixa larga: Mornsun VRB/URB (2:1), TRACO THN/TEN (4:1: "THN30-7215" = 72 V → 15 V, 30 W), "40-160VDC O/P +24V", "XW-1224-3.3-99W" */
        else if ((mD = /\b(?:VR[AB]|UR[AB]|WR[AB])(\d{2})(\d{2})/.exec(cm.toUpperCase()))) { vimin = +mD[1] / 2; vimax = +mD[1] * 1.5; vo = +mD[2]; if (!(pw > 0) && (mD = /-(\d+)W/.exec(cm.toUpperCase()))) pw = +mD[1]; }
        else if ((mD = /\b(?:THN|TEN|TMR|TMA|TES)(\d+)-?(\d{2})(\d{2})/.exec(cm.toUpperCase()))) { vimin = +mD[2] * 0.6; vimax = +mD[2] * 2.2; vo = +mD[3]; if (!(pw > 0)) pw = +mD[1]; }
        else if ((mD = /(\d+)\s*-\s*(\d+)\s*V(?:DC)?\b/.exec(cm)) && /O\/?P\s*\+?(\d+(?:\.\d+)?)\s*V/i.test(cm)) { vimin = +mD[1]; vimax = +mD[2]; vo = +/O\/?P\s*\+?(\d+(?:\.\d+)?)\s*V/i.exec(cm)[1]; const ia = grandezaDoNome(cm.replace(/V(\d)/, 'V $1'), 'A'); if (!(pw > 0) && ia > 0) pw = ia * vo; }
        else if ((mD = /\bXW-?(\d{2})(\d{2})-(\d+(?:\.\d+)?)-(\d+)W/.exec(cm.toUpperCase()))) { vimin = +mD[1] * 0.9; vimax = +mD[2] * 1.1; vo = +mD[3]; pw = +mD[4]; }
        const stepUp = /MT3608|STEP[ -]?UP|BOOST/.test(txt);
        if (stepUp) { vimin = 2; vimax = 24; if (!(vo > 0)) vo = 12; if (!(pw > 0)) pw = 10; }
        if (!(vimin > 0) && vin > 0) { vimin = vin * 0.9; vimax = vin * 1.1; }
        if (!(vo > 0)) { vo = 5; info.avisos.push('tensão de saída não lida do nome: 5 V (mude no campo)'); }
        if (!(pw > 0)) pw = 1;
        if (!(vimin > 0)) { vimin = 4.5; vimax = 36; info.avisos.push('faixa de entrada não lida do nome: 4,5–36 V (mude nos campos)'); }
        if (isFinite(+prmD.vout) && +prmD.vout > 0) vo = +prmD.vout;
        if (isFinite(+prmD.pout) && +prmD.pout > 0) pw = +prmD.pout;
        if (isFinite(+prmD.vinmin) && +prmD.vinmin > 0) vimin = +prmD.vinmin;
        if (isFinite(+prmD.vinmax) && +prmD.vinmax > 0) vimax = +prmD.vinmax;
        const eta = isFinite(+prmD.eta) && +prmD.eta > 0 ? +prmD.eta / 100 : 0.8;
        const ord = [...c.pinos].sort((x, y) => (+x.num || 0) - (+y.num || 0));
        const pVinP = achaPino(info, [/^(\+?VIN\+?|VIN|\+IN|IN\+|VI\+)$/i], ord.length >= 7 ? 2 : 2), pVinN = achaPino(info, [/^(-VIN|VIN-|GND|-IN|IN-|VI-|0V IN)$/i], 1);
        const pVoP = achaPino(info, [/^(\+?VOUT\+?|\+VO|VO\+|OUT\+|\+OUT)$/i], ord.length >= 7 ? 7 : 4), pVoN = achaPino(info, [/^(-VOUT|VOUT-|-VO|VO-|0V|COM|OUT-|-OUT)$/i], ord.length >= 7 ? 6 : 3);
        if (!c.pinos.some(p => /[A-Z]/i.test(String(p.name || '')))) info.avisos.push('pinos sem nome: ' + (ord.length >= 7 ? '1 −Vin, 2 +Vin, 6 0V, 7 +Vout' : '1 −Vin, 2 +Vin, 3 −Vout, 4 +Vout') + (dual ? ' (o ±: só a saída positiva contra o 0V)' : ''));
        const imaxD = pw / vo;
        info.tipo = 'dcdc'; info.vout = vo; info.pout = pw; info.vinmin = vimin; info.vinmax = vimax; info.eta = eta; info.imax = imaxD; info.dual = dual;
        info.rotulo = 'Conversor DC/DC ' + (stepUp ? 'elevador ' : 'isolado ') + fmt(vimin, 'V') + '–' + fmt(vimax, 'V') + ' → ' + (dual ? '±' : '') + fmt(vo, 'V') + ' ' + fmt(pw, 'W');
        info.campos = [{ k: 'vout', rot: 'Tensão de saída (V)', un: 'V', v: vo, dica: '5, 12, 15' }, { k: 'pout', rot: 'Potência (W)', un: 'W', v: pw, dica: '1, 2' },
          { k: 'vinmin', rot: 'Vin mínima (V)', un: 'V', v: vimin, dica: '10,8' }, { k: 'vinmax', rot: 'Vin máxima (V)', un: 'V', v: vimax, dica: '13,2' }, { k: 'eta', rot: 'Rendimento (%)', un: '%', v: Math.round(eta * 100), dica: '80' }];
        if (pVoP && pVoP.net) produzidas.add(pVoP.net);
        const G = 50;
        const f = v => {
          const vi = v[0] - v[1], vout = v[2] - v[3];
          const on = sig((vi - vimin * 0.98) * 25) * sig((vimax * 1.25 - vi) * 4);   // 1.116.0: abaixo da faixa nao sai nada
          const ia = G * (vo * on - vout);
          const io = smin(sp(ia, 0.01) + 1e-3 * ia, imaxD * 2 + 0.01 * ia, 1e-3);
          const iin = Math.max(vout, 0) * Math.max(io, 0) / (eta * Math.max(vi, 0.5)) + 2e-3 * on;
          return [iin, -iin, -io, io];
        };
        info.el = poe(info, { tipo: 'NL', nos: [nomeTerm(info, pVinP), nomeTerm(info, pVinN), nomeTerm(info, pVoP), nomeTerm(info, pVoN)], f, dc: [[0, 1], [2, 3]], papel: 'DC/DC' }, [pk(info, pVinP), pk(info, pVinN), pk(info, pVoP), pk(info, pVoN)]);
        continue;
      }
      /* --- bateria (1.115.0, lote 3): a tensao do nome manda (a quimica so preenche quando falta: "12 V 50 Ah Li-ion" e 12 V);
         a capacidade (mAh/Ah) e a resistencia interna pela quimica; o modulo indicador de carga nao e bateria */
      if (/BATERIA/.test(norm(c.sym || '')) && /INDICADOR|JX-?\d{4}|\d+\s*-\s*\d+\s*V\s*CC|MODULO/.test(txt)) { info.tipo = 'ignorado'; info.rotulo = 'Módulo indicador de bateria (não simulado: consome ~15 mA)'; continue; }
      if ((/^(BT|BAT|B|G|BATT)$/.test(pre) && c.pinos.length === 2 && !/BUZZ|BOT/.test(txt) || /BATER|BATTERY|PILHA|CR20\d\d|CR1220|18650|LIPO|\bLI-?ION|\bLR44/.test(txt)) && !/CLIP|SUPORTE|HOLDER|PORTA[- ]?PILHA|SOQUETE|CONECTOR/.test(txt)) {
        const prmB = (cfg.params && cfg.params[ref]) || {};
        const QUIM = [
          [/CR20\d\d|CR2\d{3}/, 3, 15, false, 0.03, 'lítio (moeda)'], [/CR1[2-6]\d\d/, 3, 30, false, 0.01, 'lítio (moeda)'],
          [/LR4[1-4]|AG1[0-3]|\bA76\b|SR4[1-4]|LR11|LR9\b/, 1.5, 5, false, 0.03, 'alcalina (botão)'], [/\bER\d{5}|LS14|SOCL|TADIRAN|TLH-|SB-AA|XL-050|1\/2AA/, 3.6, 10, false, 0.1, 'lítio-cloreto de tionila'],
          [/CR123|CR-?P2|\bCR2\b/, 3, 0.3, false, 1.5, 'lítio (foto)'], [/LIFEPO/, 12.8, 0.02, true, 0, 'LiFePO4'],
          [/18650|21700|14500|LI-?ION|LIPO|LI-?PO|POLIMERO|POLYMER|\b[0-9]{6}\b/, 3.7, 0.05, true, 0, 'lítio-íon'], [/NIMH|NI-?MH|NICD|NI-?CD/, 1.2, 0.03, true, 0, 'NiMH'],
          [/CHUMBO|\bSLA\b|VRLA|ACIDO|\bGEL\b|SELADA/, 12, 0.02, true, 0, 'chumbo-ácido'], [/\b9\s*V\b|6F22/, 9, 1.5, false, 0.5, '9 V'],
          [/ALCALIN|\bAAA\b|\bAA\b|\bLR6\b|\bLR03\b/, 1.5, 0.15, false, 2, 'alcalina'],
        ];
        let q = QUIM.find(([re]) => re.test(txt));
        /* a recarregavel de 1,2 V sem quimica no nome e NiMH */
        if (!q && /RECARREG|RECHARG/.test(txt) && Math.abs(val.tensao - 1.2) < 0.05) q = QUIM.find(x => x[5] === 'NiMH');
        let vNome = val.tensao > 0 ? val.tensao : NaN;
        if (q && q[5] === 'lítio-íon' && vNome === 37) vNome = 3.7;   // "37V" na Li-Po = 3,7 V
        let v = isFinite(+prmB.v) && +prmB.v > 0 ? +prmB.v : vNome > 0 ? vNome : q ? q[1] : NaN;
        if (!(v > 0)) { v = 3; info.avisos.push('tensão da bateria não lida do nome: 3 V (mude no campo)'); }
        const recarga = /RECARREG|RECHARG/.test(txt) || (q ? q[3] : false);
        const rint = isFinite(+prmB.rint) && +prmB.rint > 0 ? +prmB.rint : q ? q[2] * (/\bAAA\b|LR03/.test(txt) ? 2 : 1) : 0.15;
        const capM = /(\d+(?:[.,]\d+)?)\s*(M?)(?:AH|HA)\b/i.exec(String(c.comment || ''));
        const cap = isFinite(+prmB.cap) && +prmB.cap > 0 ? +prmB.cap : capM ? +capM[1].replace(',', '.') * (capM[2] ? 1 : 1000) : null;
        /* o limite de corrente (curto): 3C quando ha capacidade, senao o da quimica (moeda e botao aguentam pouco) */
        info.imax = q && q[4] > 0 ? q[4] : cap ? cap / 1000 * 3 : 10;
        if (cap && q && q[4] > 0) info.imax = Math.max(q[4], Math.min(info.imax, cap / 1000 * 3));
        const mais = achaPino(info, ['+', 'POS', 'VBAT', 'A', '1'], 1), menos = achaPino(info, ['-', 'NEG', 'GND', 'K', '2'], 2);
        info.tipo = 'bateria'; info.v = v; info.rint = rint; info.cap = cap; info.recarregavel = recarga;
        /* a net do + e da bateria: o nome dela ("BAT", "VBAT") nao vira outra fonte brigando com ela */
        if (mais && mais.net && menos && menos.net && ehTerra(menos.net)) produzidas.add(mais.net);
        info.rotulo = 'Bateria ' + fmt(v, 'V') + (q ? ' (' + q[5] + ')' : '') + (cap ? ' ' + (cap >= 1000 ? fmt(cap / 1000, 'Ah') : Math.round(cap) + ' mAh') : '');
        info.campos = [{ k: 'v', rot: 'Tensão (V)', un: 'V', v, dica: '3,7, 12' }, { k: 'rint', rot: 'Resistência interna (Ω)', un: 'Ω', v: rint, dica: '0,15' }, { k: 'cap', rot: 'Capacidade (mAh)', un: '', v: cap, dica: '2000' }];
        const e = fonteV(info, nomeTerm(info, mais), nomeTerm(info, menos), v, 'bateria', rint);
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
      /* 1.117.0 (lote 5): o cristal guarda a frequencia e a carga (informacao; no DC e aberto); o oscilador ATIVO (4 pinos: 1 EN,
         2 GND, 3 OUT, 4 VCC) consome e poe na saida a media da onda quadrada (Vcc/2) */
      if (/^(Y|X|XT|XTAL|Q)$/.test(pre) && /XTAL|CRYST|CRIST|MHZ|KHZ|RESSON|OSC/.test(txt) || /^(Y|XTAL)$/.test(pre) || /CRISTAL|OSCILAD/.test(norm(c.sym || ''))) {
        const cmX = String(c.comment || '').replace(/,/g, '.');
        const fm = /(\d+(?:\.\d+)?)\s*(G|M|K)HZ/i.exec(cmX), fhz = fm ? +fm[1] * { G: 1e9, M: 1e6, K: 1e3 }[fm[2].toUpperCase()] : null;
        const cl = /(\d+(?:\.\d+)?)\s*PF/i.exec(cmX);
        info.freq = fhz; info.carga = cl ? +cl[1] * 1e-12 : null;
        info.campos = [{ k: 'freq', rot: 'Frequência (Hz)', un: '', v: fhz, dica: '16M' }, { k: 'carga', rot: 'Capacitância de carga (F)', un: 'F', v: info.carga, dica: '18p' }];
        const ativo = c.pinos.length >= 4 && /OSCILAD|OSC\b|\bXO\b|TCXO|LL536|SG-?\d|ATIVO|ACTIVE/.test(txt);
        if (ativo) {
          const N = n => achaPino(info, [], n);
          const pVcc = achaPino(info, [/^(VCC|VDD|V\+)$/i], 4), pGnd = achaPino(info, [/^(GND|VSS)$/i], 2), pOut = achaPino(info, [/^(OUT|CLK|Q)$/i], 3);
          info.tipo = 'oscilador'; info.rotulo = 'Oscilador ' + (fhz ? fmt(fhz, 'Hz') : '') + ' (saída quadrada; no simulador, a média Vcc/2)';
          info.avisos.push('a onda quadrada de ' + (fhz ? fmt(fhz, 'Hz') : '?') + ' é rápida demais para o passo da simulação: a saída é a média (Vcc/2)');
          const f = v => { const vcc = v[0] - v[1], on = Math.tanh(Math.max(vcc, 0) / 0.5); const io = (v[2] - v[1] - vcc / 2 * on) / 50; const iq = 0.01 * on; return [iq + sp(-io, 1e-5), -iq - sp(io, 1e-5), io]; };
          info.el = poe(info, { tipo: 'NL', nos: [nomeTerm(info, pVcc), nomeTerm(info, pGnd), nomeTerm(info, pOut)], f, dc: [[0, 1, 2]], papel: 'oscilador' }, [pk(info, pVcc), pk(info, pGnd), pk(info, pOut)]);
          void N;
          continue;
        }
        info.tipo = 'ignorado'; info.rotulo = 'Cristal ' + (fhz ? fmt(fhz, 'Hz') + ' ' : '') + (info.carga ? '(' + fmt(info.carga, 'F') + ') ' : '') + '— no DC é aberto';
        continue;
      }
      if (/^(TP|FID|MH|H|MK|LOGO|TEST)$/.test(pre)) { info.tipo = 'ignorado'; info.rotulo = 'ponto de teste / fixação'; continue; }
      /* 1.117.0 (lote 5): o transformador (P1, P2, S1, S2): no tempo o secundario = primario × Vs/Vp (com a resistencia dos
         enrolamentos e a corrente refletida no primario); no DC ele nao transfere (o primario e um indutor: alerta) */
      if ((/^(T|TR|TF)$/.test(pre) && /TRAFO|TRANSF/.test(txt) || /TRANSFORM/.test(norm(c.sym || ''))) && c.pinos.length >= 4) {
        const prmT = (cfg.params && cfg.params[ref]) || {};
        const cmT = String(c.comment || '').replace(/,/g, '.');
        let vp = NaN, vs = NaN, mT;
        if ((mT = /(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*V?\s*\/\s*(\d+(?:\.\d+)?)\s*V/i.exec(cmT))) { vp = +mT[2]; vs = +mT[3]; }     // 110/220V/24V
        else if ((mT = /(\d+(?:\.\d+)?)\s*V?\s*\/\s*(\d+(?:\.\d+)?)\s*V/i.exec(cmT))) { vp = +mT[1]; vs = +mT[2]; }                          // 200/30V
        if (isFinite(+prmT.vp) && +prmT.vp > 0) vp = +prmT.vp;
        if (isFinite(+prmT.vs) && +prmT.vs > 0) vs = +prmT.vs;
        if ((!(vp > 0) || !(vs > 0)) && /PULSO|PULSE/.test(txt)) { vp = 5; vs = 5; info.avisos.push('transformador de pulso: 1:1 (mude nos campos)'); }
        if (!(vp > 0) || !(vs > 0)) { vp = vp > 0 ? vp : 220; vs = vs > 0 ? vs : 12; info.avisos.push('relação não lida do nome: ' + vp + ' V / ' + vs + ' V (mude nos campos)'); }
        const vaN = /(\d+(?:\.\d+)?)\s*VA\b/i.exec(cmT);
        const va = isFinite(+prmT.va) && +prmT.va > 0 ? +prmT.va : vaN ? +vaN[1] : 10;
        const pP1 = achaPino(info, [/^(P1|PRI1|1)$/i], 1), pP2 = achaPino(info, [/^(P2|PRI2|2)$/i], 2), pS1 = achaPino(info, [/^(S1|SEC1|3)$/i], 3), pS2 = achaPino(info, [/^(S2|SEC2|4)$/i], 4);
        const n = vs / vp, rs = Math.max(0.05, vs * vs / va * 0.05), rp = Math.max(1, vp * vp / va * 0.05);
        info.tipo = 'trafo'; info.vp = vp; info.vs = vs; info.va = va; info.n = n;
        info.rotulo = 'Transformador ' + fmt(vp, 'V') + ' / ' + fmt(vs, 'V') + ' ' + fmt(va, 'VA');
        info.campos = [{ k: 'vp', rot: 'Tensão do primário (V)', un: 'V', v: vp, dica: '220' }, { k: 'vs', rot: 'Tensão do secundário (V)', un: 'V', v: vs, dica: '12' }, { k: 'va', rot: 'Potência (VA)', un: '', v: va, dica: '10' }];
        const f = (v, e, ctx) => {
          const vpri = v[0] - v[1], vsec = v[2] - v[3];
          const ac = !ctx || ctx.modo !== 'dc';
          const is = ac ? (n * vpri - vsec) / rs : 0;                      // sai pelo S1
          const ip = ac ? n * is + vpri / (rp * 1e4) : vpri / rp;          // no DC o primario e o enrolamento (quase curto)
          return [ip, -ip, -is, is];
        };
        info.el = poe(info, { tipo: 'NL', nos: [nomeTerm(info, pP1), nomeTerm(info, pP2), nomeTerm(info, pS1), nomeTerm(info, pS2)], f, dc: [[0, 1], [2, 3]], papel: 'transformador' }, [pk(info, pP1), pk(info, pP2), pk(info, pS1), pk(info, pS2)]);
        if (pS1 && pS1.net) produzidas.add(pS1.net);
        continue;
      }
      if (/^(T|TR|TF)$/.test(pre) && /TRAFO|TRANSF/.test(txt)) { info.tipo = 'ignorado'; info.rotulo = 'Transformador (não simulado)'; info.avisos.push('transformador não é simulado: defina a tensão do secundário como fonte'); continue; }

      /* --- CIs */
      if (ps.length) {
        const alim = c.pinos.filter(p => PINOS_ALIM.test(String(p.name || '').trim()));
        const gnds = c.pinos.filter(p => PINOS_TERRA.test(String(p.name || '').trim()) || (p.net && ehTerra(p.net)));

        /* 1.115.0 (lote 3): a referencia shunt ajustavel TL431 (2,495 V entre REF e A; drena corrente de K para A) */
        if (/TL431|TLV431|AZ431|KA431|LM431|ATL431|\bTL432/.test(desc) && c.pinos.length >= 3) {
          const prmS = (cfg.params && cfg.params[ref]) || {};
          const sot = /SOT/.test(norm(c.footprint)), ordS = sot ? ['K', 'REF', 'A'] : ['REF', 'A', 'K'];
          const pK = achaPino(info, [/^(K|C|CATH\w*|CATODO)$/i], ordS.indexOf('K') + 1), pA = achaPino(info, [/^(A|AN\w*|ANODO)$/i], ordS.indexOf('A') + 1), pR = achaPino(info, [/^(REF|R|VREF)$/i], ordS.indexOf('REF') + 1);
          const vref = isFinite(+prmS.vref) && +prmS.vref > 0 ? +prmS.vref : /TLV431/.test(desc) ? 1.24 : 2.495;
          info.tipo = 'shunt'; info.vref = vref;
          info.ikmax = isFinite(+prmS.ikmax) && +prmS.ikmax > 0 ? +prmS.ikmax : /TLV431/.test(desc) ? 0.02 : 0.1;
          info.pd = isFinite(+prmS.pd) && +prmS.pd > 0 ? +prmS.pd : sot ? 0.35 : 0.7;
          info.rotulo = 'Referência shunt ' + (c.comment || 'TL431') + ' (Vref ' + fmt(vref, 'V') + ')';
          info.campos = [{ k: 'vref', rot: 'Vref (V)', un: 'V', v: vref, dica: '2,495' }, { k: 'ikmax', rot: 'Ik máx (A)', un: 'A', v: info.ikmax, dica: '100m' }, { k: 'pd', rot: 'Potência (W)', un: 'W', v: info.pd, dica: '0,7' }];
          if (!achaPino(info, [/^(REF|R|VREF)$/i], null)) info.avisos.push('pinos sem nome K/A/REF: a ordem ' + ordS.map((n, k) => (k + 1) + ' ' + n).join(', '));
          const f = v => {
            const vka = v[0] - v[1], vr = v[2] - v[1];
            const on = sig((vka - 1.0) * 6);
            const ik = (sp(10 * (vr - vref), 1e-3) + 1e-6) * on;
            const iref = 2e-6 * on;
            return [ik, -ik - iref, iref];
          };
          info.el = poe(info, { tipo: 'NL', nos: [nomeTerm(info, pK), nomeTerm(info, pA), nomeTerm(info, pR)], f, dc: [[0, 1]], papel: 'TL431' }, [pk(info, pK), pk(info, pA), pk(info, pR)]);
          continue;
        }
        /* o inversor de carga ICL7660 (Vout = −V+; ~55 Ω de saida) */
        if (/ICL7660|MAX1044|LTC1044|TC7660/.test(desc) && c.pinos.length >= 8) {
          const pV = achaPino(info, [/^(V\+|VCC|VDD|V\+IN)$/i], 8), pO = achaPino(info, [/^(VOUT|OUT|V-OUT)$/i], 5), pG = achaPino(info, [/^(GND|VSS)$/i], 3);
          info.tipo = 'inversor'; info.rotulo = 'Inversor de tensão (bomba de carga) ' + (c.comment || 'ICL7660') + ': Vout = −Vin';
          info.vinmax = 10.5;
          if (pO && pO.net) produzidas.add(pO.net);
          const f = v => {
            const vin = v[0] - v[2], vo = v[1] - v[2], on = Math.tanh(Math.max(vin, 0) / 0.8);
            const io = (-vin * on - vo) / 55;   // empurra corrente para dentro da saida
            const iin = Math.abs(io) + 80e-6 * on;
            return [iin, -io, -iin + io];
          };
          info.el = poe(info, { tipo: 'NL', nos: [nomeTerm(info, pV), nomeTerm(info, pO), nomeTerm(info, pG)], f, dc: [[0, 2], [1, 2]], papel: 'ICL7660' }, [pk(info, pV), pk(info, pO), pk(info, pG)]);
          continue;
        }
        /* regulador linear */
        let rl = reguladorLinear(desc);
        if (!rl && /REGULADOR/.test(norm(c.sym || '')) && val.tensao > 0 && !/BUCK|BOOST|STEP|CHAVEAD|SWITCH/.test(txt)) rl = { vout: val.tensao, vdo: /LDO/.test(txt) ? 0.3 : 2, iq: 1e-3, ilim: val.corrente > 0 ? val.corrente : 1, vinmax: /LDO/.test(txt) ? 6 : 35, ordem: ['IN', 'GND', 'OUT'], nome: 'regulador ' + (/LDO/.test(txt) ? 'LDO ' : '') + fmt(val.tensao, 'V') + ' (genérico, pelo nome)' };
        if (rl && c.pinos.length >= 3 && c.pinos.length <= 8) {
          /* 1.115.0 (lote 3): campos vout (fixo), corrente maxima, dropout e Vin max — mudam o modelo e o que queima */
          const prmR = (cfg.params && cfg.params[ref]) || {};
          rl = Object.assign({}, rl);
          if (!rl.adj && isFinite(+prmR.vout) && +prmR.vout > 0) rl.vout = (rl.neg ? -1 : 1) * +prmR.vout;
          if (isFinite(+prmR.ilim) && +prmR.ilim > 0) rl.ilim = +prmR.ilim;
          if (isFinite(+prmR.vdo) && +prmR.vdo > 0) rl.vdo = +prmR.vdo;
          rl.vinmax = isFinite(+prmR.vinmax) && +prmR.vinmax > 0 ? +prmR.vinmax : rl.vinmax || (rl.vdo < 0.6 ? 6 : rl.adj ? 40 : Math.abs(rl.vout || 0) >= 20 ? 40 : 35);
          info.campos = (rl.adj ? [] : [{ k: 'vout', rot: rl.neg ? 'Tensão de saída (módulo, V; sai negativa)' : 'Tensão de saída (V)', un: 'V', v: Math.abs(rl.vout), dica: '5, 3,3' }]).concat([
            { k: 'ilim', rot: 'Corrente máxima (A)', un: 'A', v: rl.ilim, dica: '1' }, { k: 'vdo', rot: 'Dropout (V)', un: 'V', v: rl.vdo, dica: '2, 0,3' },
            { k: 'vinmax', rot: 'Vin máx (V)', un: 'V', v: rl.vinmax, dica: '35' }]);
          if (c.pinos.length > rl.ordem.length || /PINAGEM A DEFINIR/.test(norm(c.sym || ''))) info.avisos.push('pinagem pela ordem do encapsulamento: ' + rl.ordem.map((n, k) => (k + 1) + ' ' + n).join(', '));
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
            const iout = smin(sp(bruto, 0.02) + 1e-3 * bruto, ilim + 2e-4 * bruto, 1e-3) * on * (info.desligado ? 0 : 1);   // 1.116.0: limita de verdade; o termico corta
            const iq_ = rl.adj ? 0 : iq * on, iadj = rl.adj ? 50e-6 * on : 0;
            return [s * (iout + iq_ + iadj), -s * iout, -s * (iq_ + iadj)];
          };
          info.reg = poe(info, { tipo: 'NL', nos: [nomeTerm(info, pIn), nomeTerm(info, pOut), nomeTerm(info, pG)], f, papel: 'regulador' }, [pk(info, pIn), pk(info, pOut), pk(info, pG)]);
          /* 1.116.0: o desligamento termico — acima de 1,5x o que o encapsulamento aguenta a saida corta; no tempo religa
             depois de 0,5 s (liga/desliga como o de verdade); no DC fica desligado */
          const fpR = norm(c.footprint);
          info.pkg = /TO-?92/.test(fpR) ? 0.6 : /SOT-?223/.test(fpR) ? 1 : /DPAK|TO-?252/.test(fpR) ? 1.5 : /SOT-?23|SOT-?89|SC-?70/.test(fpR) ? 0.3 : /SO-?8|SOIC|MSOP/.test(fpR) ? 0.6 : 2;
          info.desligado = false;
          info.reg.reinicia = () => { info.desligado = false; };
          info.reg.atualiza = (v, e, ctx) => {
            if (!info.desligado) {
              const rr = f(v), io = Math.abs(rr[1]), pd = Math.abs((v[0] - v[1]) * io);
              if (pd > info.pkg * 1.5) { info.desligado = true; info.tOff = ctx ? ctx.t : 0; return true; }
            } else if (ctx && ctx.modo !== 'dc' && ctx.t - (info.tOff || 0) > 0.5) { info.desligado = false; return true; }
            return false;
          };
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
        /* 555 / 556 (1.116.0, lote 4: o 556 sao dois 555 em 14 pinos; campos Vcc max e Iout max — o CMOS aguenta 15 V) */
        const e556 = /(?:NE|LM|SA|SE|TLC|ICM|LMC)?556|\b7556\b/.test(desc) && c.pinos.length >= 14;
        if (((/(?:NE|LM|SA|SE|TLC|ICM|LMC|ICM7)?555|\b7555\b/.test(desc) && !/556/.test(desc)) || e556) && c.pinos.length >= 8) {
          const prmT = (cfg.params && cfg.params[ref]) || {};
          const cmos = /TLC|LMC|ICM|7555|7556/.test(desc);
          info.vccmax = isFinite(+prmT.vccmax) && +prmT.vccmax > 0 ? +prmT.vccmax : cmos ? 15 : 16;
          info.ioutmax = isFinite(+prmT.ioutmax) && +prmT.ioutmax > 0 ? +prmT.ioutmax : cmos ? 0.1 : 0.2;
          info.campos = [{ k: 'vccmax', rot: 'Vcc máx (V)', un: 'V', v: info.vccmax, dica: '16' }, { k: 'ioutmax', rot: 'Corrente de saída máx (A)', un: 'A', v: info.ioutmax, dica: '200m' }];
          const P = (re, n) => achaPino(info, [re], n);
          /* o 556: 1 DIS1, 2 THR1, 3 CV1, 4 RST1, 5 OUT1, 6 TRG1, 7 GND, 8 TRG2, 9 OUT2, 10 RST2, 11 CV2, 12 THR2, 13 DIS2, 14 VCC */
          const nucleos = e556 ? [[7, 6, 5, 4, 3, 2, 1, 14], [7, 8, 9, 10, 11, 12, 13, 14]].map(o => o.map(n => achaPino(info, [], n)))
            : [[P(/^GND$/i, 1), P(/^(TRIG\w*|TR)$/i, 2), P(/^(OUT\w*|Q)$/i, 3), P(/^(RESET|~?R\w*ST|RST)$/i, 4), P(/^(CTRL|CONT\w*|CV|CON)$/i, 5), P(/^(THR\w*|TH)$/i, 6), P(/^(DIS\w*|DISCH)$/i, 7), P(/^(VCC|V\+|VDD)$/i, 8)]];
          info.tipo = '555'; info.rotulo = e556 ? 'Temporizador duplo 556 (2 × 555)' : 'Temporizador 555'; info.q = 1; info.nucleos = [];
          for (const pins of nucleos) {
          const nuc = { q: 1, pins }; info.nucleos.push(nuc);
          const nos = pins.map(p => nomeTerm(info, p));
          const iq = /TLC|LMC|ICM|7555/.test(desc) ? 0.2e-3 : 3e-3;
          const f = (v) => {
            const g = v[0], vcc = v[7] - g;
            const on = Math.tanh(Math.max(vcc, 0) / 1);
            const out = nuc.q ? Math.max(vcc - (cmos ? 0.2 : 1.7), 0) : 0.1;
            const iOut = (v[2] - g - out) / 10;                    // entrando pelo OUT
            const iDis = nuc.q ? (v[6] - g) * 1e-9 : (v[6] - g) / 10;
            const r5 = (v[7] - v[4]) / 5e3, r10 = (v[4] - g) / 10e3;
            const iVcc = iq * on + r5 + sp(-iOut, 1e-4);
            const iGnd = -(iq * on) - r10 - sp(iOut, 1e-4) - iDis;
            const iCtrl = -r5 + r10;
            const r = [iGnd, 1e-9 * (v[1] - g), iOut, 1e-9 * (v[3] - g), iCtrl, 1e-9 * (v[5] - g), iDis, iVcc];
            r[0] -= r[1] + r[3] + r[5];
            return r;
          };
          nuc.el = poe(info, { tipo: 'NL', nos, f, dc: [[0, 2, 4, 6, 7]], papel: e556 ? '555 ' + info.nucleos.length : '555',
            reinicia: () => { nuc.q = 1; info.q = info.nucleos[0].q; },
            atualiza: (v) => {
              const g = v[0], vctrl = v[4] - g; const antes = nuc.q;
              if (v[3] - g < 0.7) nuc.q = 0;
              else if (v[1] - g < vctrl / 2) nuc.q = 1;
              else if (v[5] - g > vctrl) nuc.q = 0;
              info.q = info.nucleos[0].q;
              return nuc.q !== antes;
            } }, pins.map(p => pk(info, p)));
          if (!info.ci) info.ci = nuc.el;
          }
          continue;
        }
        /* optoacoplador (1.116.0, lote 4): as familias da lib (SFH618/620, VO618, TIL111/113/117, PS2801, ILD621, CNY74, H11L,
           HCPL, MOC30); a entrada AC (dois LEDs antiparalelos), a saida Darlington, o Schmitt do H11L (liga com If > 1,6 mA,
           com histerese), o TRIAC do MOC30xx (dispara com If acima do IFT e conduz ate a corrente cair abaixo de 0,1 mA);
           varios canais (o simbolo da lib e de uma parte por canal: A/K/C/E repetidos); campos CTR, If max, Ic max, Vceo */
        if (/PC81[57]|EL81[57]|LTV-?8[14]7|4N2[5-8]|4N3[0-7]|TLP\d{3}|CNY17|CNY7\d|H11[ABL]|MOC30|MOC80|K817|FOD8|SFH6\d\d|VO6\d\d|TIL1\d\d|PS2[5-8]\d\d|ILD\d|ILQ\d|HCPL|IL\d{3}|LTV/.test(desc) || /OPTOACOPL/.test(norm(c.sym || ''))) {
          const prmO = (cfg.params && cfg.params[ref]) || {};
          const ac = /SFH62\d|SFH6206|PS2505|H11AA|TLP620|ILD620|LTV-?814|PC814|EL814/.test(desc);
          const darl = /TIL113|4N3[0-3]|H11B|MOC80\d\d|TLP127|PS2502|SFH610|ILD223/.test(desc);
          const schmitt = /H11L/.test(desc), triac = /MOC30\d\d|MOC31\d\d|MOC32\d\d/.test(desc);
          const zc = /MOC30[4-8]\d|MOC316\d/.test(desc);
          const CTR = [[/SFH6\d\dA?-1/, 0.5], [/SFH6\d\dA?-2|CNY17-?2/, 0.9], [/SFH6\d\dA?-3|CNY17-?3/, 1.5], [/SFH6\d\dA?-4|VO6\d\dA?-4|CNY17-?4/, 2.4], [/4N25|4N26/, 0.5], [/4N27|4N28/, 0.2], [/TIL111/, 0.2], [/TIL117/, 0.5], [/CNY74/, 0.5], [/CNY17-?1/, 0.6], [/H11A1/, 0.5]];
          const ctr0 = darl ? 3 : ((CTR.find(([re]) => re.test(desc)) || [null, 1])[1]);
          const ctr = isFinite(+prmO.ctr) && +prmO.ctr > 0 ? +prmO.ctr / 100 : ctr0;
          const ifmax = isFinite(+prmO.ifmax) && +prmO.ifmax > 0 ? +prmO.ifmax : 0.06;
          const icmax = isFinite(+prmO.icmax) && +prmO.icmax > 0 ? +prmO.icmax : triac ? 0.1 : darl ? 0.15 : 0.05;   // 1.117.0: toda a familia MOC30/31/32 e 100 mA (pico 1 A)
          const vceo = isFinite(+prmO.vceo) && +prmO.vceo > 0 ? +prmO.vceo : triac ? (/MOC30[0-2]\d/.test(desc) ? 400 : 600) : /4N25|4N26|4N27|4N28|TIL11/.test(desc) ? 30 : /H11L/.test(desc) ? 16 : darl ? 30 : 35;
          const ift = triac ? (/MOC3\d[0-9]3|MOC3\d\d3/.test(desc) ? 0.005 : /MOC3\d\d2/.test(desc) ? 0.01 : 0.015) : 0.0016;
          info.tipo = 'opto'; info.ctr = ctr; info.ifmax = ifmax; info.icmax = icmax; info.vceo = vceo; info.triac = triac; info.schmitt = schmitt;
          info.rotulo = 'Optoacoplador ' + (c.comment || '') + (triac ? ' (saída TRIAC' + (zc ? ' com zero-cross' : '') + ', dispara com ' + fmt(ift, 'A') + ')' : schmitt ? ' (saída Schmitt, liga com ' + fmt(ift, 'A') + ')' : ' (CTR ' + Math.round(ctr * 100) + ' %' + (darl ? ', Darlington' : '') + (ac ? ', entrada AC' : '') + ')');
          info.campos = (triac || schmitt ? [{ k: 'ift', rot: 'Corrente para disparar (A)', un: 'A', v: ift, dica: '5m' }] : [{ k: 'ctr', rot: 'CTR (%)', un: '%', v: Math.round(ctr * 100), dica: '100' }])
            .concat([{ k: 'ifmax', rot: 'If máx do LED (A)', un: 'A', v: ifmax, dica: '60m' }, { k: 'icmax', rot: triac ? 'Corrente da saída (A)' : 'Ic máx (A)', un: 'A', v: icmax, dica: '50m' }, { k: 'vceo', rot: triac ? 'Tensão da saída (V)' : 'Vceo (V)', un: 'V', v: vceo, dica: '35' }]);
          const iftU = isFinite(+prmO.ift) && +prmO.ift > 0 ? +prmO.ift : ift;
          /* os canais: os pinos A/K/C/E na ordem; as saidas vem ao contrario (TLP521-4: C1 = 16, E1 = 15) */
          const ord = [...c.pinos].sort((x, y) => (+x.num || 0) - (+y.num || 0));
          const deNome = re => ord.filter(p => re.test(String(p.name || '')));
          let As = deNome(/^(A|ANODE|ANODO|A\d)$/i), Ks = deNome(/^(K|CATHODE|CATODO|K\d)$/i), Cs = deNome(/^(C|COL\w*|C\d|MT1|T1)$/i), Es = deNome(/^(E|EMIT\w*|E\d|MT2|T2)$/i);
          if (!As.length) {
            const seis = c.pinos.length >= 6;
            As = [achaPino(info, [], 1)]; Ks = [achaPino(info, [], 2)]; Es = [achaPino(info, [], seis ? 4 : 3)]; Cs = [achaPino(info, [], seis ? 5 : 4)];
            if (triac) { Cs = [achaPino(info, [], seis ? 6 : 4)]; Es = [achaPino(info, [], 4)]; }
          }
          const nCan = Math.min(As.length, Ks.length, Cs.length, Es.length);
          if (nCan > 1 && +Cs[0].num > +As[nCan - 1].num) { Cs = Cs.slice(0, nCan).reverse(); Es = Es.slice(0, nCan).reverse(); }
          info.canais = []; info.ift = iftU;
          const is = 0.01 / Math.exp(1.2 / (1.8 * VT));
          for (let k = 0; k < nCan; k++) {
            const A = As[k], K = Ks[k], Cc = Cs[k], E = Es[k];
            const ch = { k: k + 1, on: false };
            const f = (v) => {
              const vd = v[0] - v[1];
              let il = is * (lexp(vd / (1.8 * VT)) - 1) + 1e-12 * vd;
              if (ac) il -= is * (lexp(-vd / (1.8 * VT)) - 1);
              const vce = v[2] - v[3];
              let ice;
              if (triac) ice = ch.on ? vce / 2 + 1e-10 * vce : 1e-10 * vce;
              else if (schmitt) ice = ch.on ? 0.05 * Math.tanh(Math.max(vce, 0) / 0.2) + 1e-10 * vce : 1e-10 * vce;
              else ice = ctr * Math.abs(ac ? il : Math.max(il, 0)) * Math.tanh(Math.max(vce - (darl ? 0.6 : 0), 0) / (darl ? 0.3 : 0.15)) + 1e-10 * vce;
              return [il, -il, ice, -ice];
            };
            const el = poe(info, { tipo: 'NL', nos: [nomeTerm(info, A), nomeTerm(info, K), nomeTerm(info, Cc), nomeTerm(info, E)], f, dc: [[0, 1], [2, 3]], papel: 'opto ' + (k + 1), junc: [[0, 1, 1.8 * VT, is]] }, [pk(info, A), pk(info, K), pk(info, Cc), pk(info, E)]);
            if (triac || schmitt) {
              el.reinicia = () => { ch.on = false; };
              el.atualiza = v => {
                const vd = v[0] - v[1], il = Math.abs(is * (lexp(vd / (1.8 * VT)) - 1));
                const vce = v[2] - v[3], io = ch.on ? Math.abs(vce / 2) : 0;
                let on = ch.on;
                if (triac) { if (!on && il > iftU) on = true; else if (on && il < iftU * 0.5 && io < 1e-4) on = false; }
                else on = ch.on ? il > iftU * 0.75 : il > iftU;
                if (on === ch.on) return false;
                ch.on = on; return true;
              };
            }
            ch.el = el; ch.A = A; ch.K = K;
            info.canais.push(ch);
            if (!info.ci) info.ci = el;
          }
          if (nCan > 1) info.rotulo += ' — ' + nCan + ' canais';
          continue;
        }
        /* as placas da casa na categoria DRIVER (DTN-DI251837, DMPU-ATE220004): nao sao simuladas aqui */
        if (/\bD[A-Z]{2,6}-?(?:DI|ATE?)\d{6}/.test(desc)) { info.tipo = 'ignorado'; info.rotulo = 'Placa da casa (' + (c.comment || '') + '): não simulada'; continue; }
        /* ULN2003 / ULN2803 (1.116.0, lote 4: campos corrente por canal, Vmax e Pd; queima por canal e pela potencia total) */
        if (/ULN200[34]|ULN280[34]|MC1413|TD62003/.test(desc)) {
          const n = /280/.test(desc) ? 8 : 7, gnd = achaPino(info, [/^(GND|E)$/i], n + 1), com = achaPino(info, [/^(COM|CD\+|K)$/i], n + 2);
          const prmU = (cfg.params && cfg.params[ref]) || {};
          info.ich = isFinite(+prmU.ich) && +prmU.ich > 0 ? +prmU.ich : 0.5;
          info.vmax = isFinite(+prmU.vmax) && +prmU.vmax > 0 ? +prmU.vmax : 50;
          info.pd = isFinite(+prmU.pd) && +prmU.pd > 0 ? +prmU.pd : /SO|SOIC|SOP/.test(norm(c.footprint)) ? 1 : 1.5;
          info.campos = [{ k: 'ich', rot: 'Corrente por canal (A)', un: 'A', v: info.ich, dica: '500m' }, { k: 'vmax', rot: 'Tensão máx da saída (V)', un: 'V', v: info.vmax, dica: '50' }, { k: 'pd', rot: 'Potência total (W)', un: 'W', v: info.pd, dica: '1,5' }];
          info.chs = []; info.com = com;
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
            info.chs.push({ k, po, el: poe(info, { tipo: 'NL', nos: [nomeTerm(info, pi), nomeTerm(info, po), nomeTerm(info, gnd), nomeTerm(info, com)], f, dc: [[1, 2], [0, 2]], papel: 'canal ' + k }, [pk(info, pi), pk(info, po), pk(info, gnd), pk(info, com)]) });
          }
          continue;
        }
        /* 1.116.0 (lote 4): blocos de ganho fixo — o LM386 (ganho 20, saida em Vs/2), o de instrumentacao (G = 1 + 50 kΩ/RG,
           RG entre os pinos 1 e 8; o AMP03 e de ganho 1) e o isolado AMC1200 (saida diferencial = 8·Vin) */
        const ehLm386 = /LM386/.test(desc) && c.pinos.length >= 8, ehIna = /INA11[48]|INA12[189]|INA188|AD620|AD623|AMP03/.test(desc) && c.pinos.length >= 8, ehAmc = /AMC1200|AMC1100|AMC1301/.test(desc) && c.pinos.length >= 8;
        if (ehLm386 || ehIna || ehAmc) {
          const prmG = (cfg.params && cfg.params[ref]) || {};
          const N = n => achaPino(info, [], n);
          let G = 20, ped = [], pinoRef = null, rgTxt = '';
          if (ehIna && !/AMP03/.test(desc)) {
            /* o RG: o componente de 2 pinos entre as nets dos pinos 1 e 8 */
            const n1 = N(1) && N(1).net, n8 = N(8) && N(8).net;
            let rg = null;
            for (const o of grupos.values()) { if (o === c || o.pinos.length !== 2) continue; const ns = o.pinos.map(q => q.net); if (n1 && n8 && ns.includes(n1) && ns.includes(n8)) { rg = leValor((cfg.valores && cfg.valores[o.ref]) || o.valor || o.comment).v; rgTxt = o.ref; break; } }
            const rk = /AD620/.test(desc) ? 49.4e3 : /AD623/.test(desc) ? 100e3 : 50e3;
            G = rg > 0 ? 1 + rk / rg : 1;
          } else if (/AMP03/.test(desc)) G = 1;
          else if (ehAmc) G = 8;
          if (isFinite(+prmG.ganho) && +prmG.ganho > 0) G = +prmG.ganho;
          const ilimG = ehLm386 ? 0.5 : 0.02;
          info.vmax = isFinite(+prmG.vmax) && +prmG.vmax > 0 ? +prmG.vmax : ehLm386 ? (/386N?-4/.test(desc) ? 18 : 12) : ehAmc ? 5.5 : 36;
          info.tipo = 'ganho'; info.ganho = G; info.ilim = ilimG;
          info.rotulo = (ehLm386 ? 'Amplificador de áudio LM386' : ehAmc ? 'Amplificador isolado ' + (c.comment || 'AMC1200') : 'Amplificador de instrumentação ' + (c.comment || '')) + ' (ganho ' + fmt(G, '').trim() + (rgTxt ? ', RG = ' + rgTxt : '') + ')';
          info.campos = [{ k: 'ganho', rot: 'Ganho', un: '', v: G, dica: '20, 100' }, { k: 'vmax', rot: 'Alimentação máx (V)', un: 'V', v: info.vmax, dica: '12' }];
          /* o bloco: Vout = Vref + G·(V+ − V−), limitado as trilhas; [IN+, IN−, OUT, V+, V−, REF] */
          const bloco = (pIp, pIn, pOut, pVp, pVn, pRef, centro) => {
            const f = v => {
              const vlo = v[4] + 0.1, vhi = v[3] - 1, ref0 = pRef ? v[5] : centro ? (v[3] + v[4]) / 2 : v[4];
              const alvo = Math.min(vhi, Math.max(vlo, ref0 + G * (v[0] - v[1])));
              const io = ilimG * Math.tanh((v[2] - alvo) / 10 / ilimG);
              const r = [1e-12 * v[0], 1e-12 * v[1], io, sp(-io, 1e-5), -sp(io, 1e-5)];
              if (pRef) r.push(0);
              return r;
            };
            const nos = [pIp, pIn, pOut, pVp, pVn].concat(pRef ? [pRef] : []);
            const el = poe(info, { tipo: 'NL', nos: nos.map(p => nomeTerm(info, p)), f, dc: [[2, 3, 4]], papel: 'ganho' }, nos.map(p => pk(info, p)));
            ped.push(el); return el;
          };
          /* LM386: 2 −IN, 3 +IN, 4 GND, 5 OUT, 6 VS (a saida no meio da alimentacao) */
          if (ehLm386) bloco(N(3), N(2), N(5), N(6), N(4), null, true);
          /* INA114/121/188/AD620: 2 −IN, 3 +IN, 4 V−, 5 REF, 6 OUT, 7 V+; AMP03: 1 REF, 2 −IN, 3 +IN, 4 V−, 6 OUT, 7 V+ */
          else if (ehIna) bloco(N(3), N(2), N(6), N(7), N(4), /AMP03/.test(desc) ? N(1) : N(5), false);
          /* AMC1200: 1 VDD1, 2 VINP, 3 VINN, 4 GND1, 5 GND2, 6 VOUTN, 7 VOUTP, 8 VDD2 — as duas saidas em torno de 1,29 V */
          else {
            const meiaG = G / 2;
            for (const [po, sinal] of [[N(7), 1], [N(6), -1]]) {
              const f = v => { const alvo = Math.min(v[3] - 0.1, Math.max(v[4] + 0.1, v[4] + 1.29 + sinal * meiaG * (v[0] - v[1]))); const io = 0.02 * Math.tanh((v[2] - alvo) / 10 / 0.02); return [1e-12 * v[0], 1e-12 * v[1], io, sp(-io, 1e-5), -sp(io, 1e-5)]; };
              const nos = [N(2), N(3), po, N(8), N(5)];
              ped.push(poe(info, { tipo: 'NL', nos: nos.map(p => nomeTerm(info, p)), f, dc: [[2, 3, 4]], papel: 'saída ' + (sinal > 0 ? 'P' : 'N') }, nos.map(p => pk(info, p))));
            }
            if (N(1) && N(4)) poe(info, { tipo: 'I', nos: [nomeTerm(info, N(1)), nomeTerm(info, N(4))], i: 5e-3, papel: 'lado 1' }, [pk(info, N(1)), pk(info, N(4))]);
          }
          info.blocos = ped; info.pAlim = ehLm386 ? [N(6), N(4)] : ehAmc ? [N(8), N(5)] : [N(7), N(4)];
          continue;
        }
        /* amplificador operacional / comparador */
        const op = OPAMPS.find(([re]) => re.test(desc)), cmp = !op && COMPARADORES.find(([re]) => re.test(desc));
        if (op || cmp) {
          const m = Object.assign({}, (op || cmp)[1]);
          let tab = (cmp ? PINAGEM_COMP : PINAGEM_OPAMP)[m.canais] || PINAGEM_OPAMP[2];
          let al = (cmp ? ALIM_COMP : ALIM_OPAMP)[m.canais];
          /* 1.116.0 (lote 4): SOT-23-5 (1 OUT, 2 V−, 3 IN+, 4 IN−, 5 V+) e o TDA2030 (1 IN+, 2 IN−, 3 −VS, 4 OUT, 5 +VS) */
          if (m.canais === 1 && c.pinos.length === 5) {
            if (/TDA20[35]0/.test(desc)) { tab = [{ out: 4, n: 2, p: 1 }]; al = { vp: 5, vn: 3 }; }
            else { tab = [{ out: 1, n: 4, p: 3 }]; al = { vp: 5, vn: 2 }; }
          }
          const prmA = (cfg.params && cfg.params[ref]) || {};
          if (!cmp && OPAMP_R2R.test(desc)) { m.dlo = 0.02; m.dhi = 0.02; }
          const potencia = /TDA20[35]0/.test(desc);
          info.vmax = isFinite(+prmA.vmax) && +prmA.vmax > 0 ? +prmA.vmax : ((OPAMP_VMAX.find(([re]) => re.test(desc)) || [null, potencia ? 44 : cmp ? 36 : 36])[1]);
          info.ilim = isFinite(+prmA.ilim) && +prmA.ilim > 0 ? +prmA.ilim : potencia ? 3.5 : cmp ? 0.016 : 0.025;
          info.ganho = isFinite(+prmA.a) && +prmA.a > 0 ? +prmA.a : potencia ? 3e4 : 2e4;
          info.campos = (cmp ? [] : [{ k: 'a', rot: 'Ganho em malha aberta', un: '', v: info.ganho, dica: '20000, 200000' }]).concat([
            { k: 'vmax', rot: 'Alimentação máx (V)', un: 'V', v: info.vmax, dica: '32, 36' }, { k: 'ilim', rot: 'Corrente de saída máx (A)', un: 'A', v: info.ilim, dica: '25m' }]);
          const vp = achaPino(info, [/^(V\+|VCC|VDD|VS\+|\+VS|V\+\w*|POWER|VPOS)$/i], al.vp), vn = achaPino(info, [/^(V-|VEE|VSS|GND|VS-|-VS|GROUND|VNEG)$/i], al.vn);
          info.tipo = cmp ? 'comparador' : 'opamp';
          info.rotulo = (cmp ? 'Comparador ' : 'Amplificador operacional ') + (c.comment || '') + ' (' + m.canais + (m.canais > 1 ? ' canais' : ' canal') + ')';
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
            const A = info.ganho, ilim = info.ilim;
            const f = cmp ? (v) => {
              const vlo = v[4];
              const on = sig((v[1] - v[0]) * 200);
              const io = on * (v[2] - vlo) / 30 + 1e-10 * (v[2] - vlo);
              return [1e-12 * v[0], 1e-12 * v[1], io, 0, -io - 1e-12 * (v[0] + v[1])];
            } : (v) => {
              const vlo = v[4] + m.dlo, vhi = v[3] - m.dhi;
              const meio = (vhi + vlo) / 2, meia = Math.max((vhi - vlo) / 2, 0.01);
              const alvo = meio + meia * Math.tanh(A * (v[0] - v[1]) / meia);
              const iIn = ilim * Math.tanh((v[2] - alvo) / 40 / ilim);          // entrando pelo OUT (limitada: o curto da saida)
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
        /* 1.117.0 (lote 5): a corrente maxima por pino — do nome ("10A") ou da familia (borne 5,08 ~12 A, KK/barra 2,54 ~3 A,
           JST ~1,5 A, USB 1,5 A/USB-C 3 A); o pino acima de 1,5x "derrete" */
        const prmC = (cfg.params && cfg.params[ref]) || {};
        const iNomeC = grandezaDoNome(c.comment, 'A');
        info.imax = isFinite(+prmC.imax) && +prmC.imax > 0 ? +prmC.imax : iNomeC > 0 ? iNomeC
          : /\bP?(1[.,]25|1[.,]5|2[.,]0?)\s*MM/.test(txt) ? 1.5 : /\bP?2[.,]54\s*MM/.test(txt) ? 3   // o passo manda: o borne de 1,5 mm nao leva 12 A
          : /BORNE|TERMINAL|KRE|5[.,]0?8|7[.,]62|PARAFUSO/.test(txt) ? 12 : /USB.?C|TYPE.?C/.test(txt) ? 3 : /USB/.test(txt) ? 1.5 : /JST|\bPH\b|\bZH\b|\bSH\b|1[.,]25|2[.,]0\s*MM/.test(txt) ? 1.5 : /P4|JACK|DC.?JACK|\bJ4\b/.test(txt) ? 2 : 3;
        info.campos = [{ k: 'imax', rot: 'Corrente máx por pino (A)', un: 'A', v: info.imax, dica: '3, 12' }];
        /* o clip de bateria de 9 V: a fonte suposta no + (o pino "+" ou o 1) */
        if (/CLIP/.test(txt) && /BATER|9\s*V/.test(txt)) {
          const vb = val.tensao > 0 ? val.tensao : 9, mais = achaPino(info, ['+', 'POS', 'VBAT', '1'], 1), menos = achaPino(info, ['-', 'NEG', 'GND', '2'], 2);
          info.rotulo = 'Clip de bateria ' + fmt(vb, 'V') + ' (fonte suposta)';
          if (mais && mais.net && menos && menos.net && ehTerra(menos.net)) info.sugeridas.push({ net: mais.net, v: vb, pino: mais.num, motivo: 'o clip de bateria ' + ref + ' (' + fmt(vb, 'V') + ')' });
        }
        /* o USB da placa: o VBUS e uma fonte suposta de 5 V */
        if (/USB/.test(txt)) { const vbus = achaPino(info, [/^(VBUS|V\+|VCC|5V|VUSB)$/i], null); if (vbus && vbus.net && !ehTerra(vbus.net)) info.sugeridas.push({ net: vbus.net, v: 5, pino: vbus.num, motivo: 'o VBUS do USB ' + ref + ' (5 V)' }); }
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
    /* 1.116.0: os valores dos campos arredondados (26.400000000000002 → 26,4) */
    for (const inf of comps.values()) for (const x of inf.campos || []) if (x.v != null && isFinite(x.v)) x.v = +(+x.v).toPrecision(6);
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

  /* o ponto da faixa de tolerancia de cada resistor: -1..-0,5 ou 0,5..1 (fixo pelo nome: o mesmo a cada simulacao) */
  function desvioDe(ref) {
    let h = 2166136261;
    for (const ch of String(ref)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
    const u = (h % 10007) / 10006;
    return (u < 0.5 ? -1 : 1) * (0.5 + Math.abs(u - 0.5));
  }
  /* 1.114.0: o numero solto com a unidade no nome ("55V 26A", "150V 144W", "1.25A", "900mA", "40mΩ") — nao pega o fim de
     um codigo (o "1N751A", o "BC546A") */
  function grandezaDoNome(t, un) {
    const s = String(t || '').replace(/,/g, '.');
    const re = un === 'Ω' ? /(?:^|[\s/_(%-])(\d+(?:\.\d+)?)\s*([mkKM]?)(?:Ω|OHMS?)\b/i : new RegExp('(?:^|[\\s/_(%-])(\\d+(?:\\.\\d+)?)\\s*([mkK]?)' + un + '(?![A-Z0-9])', 'i');
    const m = re.exec(s);
    if (!m) return NaN;
    const p = m[2] === 'm' ? 1e-3 : /^[kK]$/.test(m[2]) ? 1e3 : m[2] === 'M' ? (un === 'Ω' ? 1e6 : 1e-3) : 1;
    return +m[1] * p;
  }
  /* If max e VRRM pela familia do diodo (1N400x, 1N540x, UF/FR, 1N58xx, SSxx, M1-M7, S1A-S1M, 1N4148) */
  function limitesDiodo(t) {
    let m;
    const vr4 = { 1: 50, 2: 100, 3: 200, 4: 400, 5: 600, 6: 800, 7: 1000 };
    if ((m = /1N400([1-7])|UF400([1-7])|FR10([1-7])|\bRL10([1-7])/.exec(t))) return { ifmax: 1, vrrm: vr4[+(m[1] || m[2] || m[3] || m[4])] };
    if ((m = /FR20([1-7])|RL20([1-7])/.exec(t))) return { ifmax: 2, vrrm: vr4[+(m[1] || m[2])] };
    if ((m = /FR30([1-7])/.exec(t))) return { ifmax: 3, vrrm: vr4[+m[1]] };
    if ((m = /1N540([0-8])|UF540([0-8])/.exec(t))) return { ifmax: 3, vrrm: { 0: 50, 1: 100, 2: 200, 4: 400, 6: 600, 7: 800, 8: 1000 }[+(m[1] || m[2])] || 400 };
    if ((m = /1N58(1[7-9]|2[0-2])/.exec(t))) { const k = +m[1]; return { ifmax: k <= 19 ? 1 : 3, vrrm: { 17: 20, 18: 30, 19: 40, 20: 20, 21: 30, 22: 40 }[k] }; }
    if ((m = /\b(?:SS|SK)([1-5])(\d{1,2})\b/.exec(t))) return { ifmax: +m[1], vrrm: +m[2] * 10 };
    if ((m = /\bSB(\d)(\d{2})\b/.exec(t))) return { ifmax: +m[1], vrrm: +m[2] };
    if ((m = /\bM([1-7])\b/.exec(t))) return { ifmax: 1, vrrm: vr4[+m[1]] };
    if ((m = /\bU?S1([ABDGJKM])\b/.exec(t))) return { ifmax: 1, vrrm: { A: 50, B: 100, D: 200, G: 400, J: 600, K: 800, M: 1000 }[m[1]] };
    if (/1N4148|1N914|LL4148|BAV99|BAS16|1N4448/.test(t)) return { ifmax: 0.3, vrrm: 100 };
    return {};
  }
  function potenciaDoFootprint(fp) {
    const f = norm(fp);
    const m = /(?:^|[^0-9])(0201|0402|0603|0805|1206|1210|1812|2010|2512)(?![0-9])/.exec(f);   // 1.113.0: "R0402" tambem
    if (m) return { '0201': 0.05, '0402': 0.0625, '0603': 0.1, '0805': 0.125, '1206': 0.25, '1210': 0.5, '1812': 0.75, '2010': 0.75, '2512': 1 }[m[1]];
    /* 1.113.0: o THT pelo corpo (0204 1/8, 0207 1/4, 0309 1/2, 0411/0414 1 W, 0617 2 W) ou pelo passo do AXIAL (0.3 1/8,
       0.4 1/4, 0.5/0.6 1/2, 0.7-0.8 1 W, 1.0 2 W) */
    const corpo = /\b0(204|207|309|411|414|617)\b/.exec(f);
    if (corpo) return { 204: 0.125, 207: 0.25, 309: 0.5, 411: 1, 414: 1, 617: 2 }[corpo[1]];
    const ax = /AXIAL[-_ ]?(\d+)[.,](\d)/.exec(f);
    if (ax) { const p = +ax[1] * 10 + +ax[2]; return p <= 3 ? 0.125 : p <= 4 ? 0.25 : p <= 6 ? 0.5 : p <= 8 ? 1 : 2; }
    if (/AXIAL|PTH|THT|DO-?35/.test(f)) return 0.25;
    return null;
  }

  /* a queima do MOSFET/IGBT (1.114.0) */
  function mosQueima(out, info, id, vds, vgs, p, queima, lim) {
    out.linhas.push({ t: 'Limites', f: 'Id máx ' + fmt(info.idmax, 'A') + ' · Pd ' + fmt(info.pd, 'W') + ' · Vdss ' + fmt(info.vdss, 'V') + ' · Vgs máx ' + fmt(info.vgsmax, 'V'), r: '' });
    if (Math.abs(p) > info.pd * 0.8 && Math.abs(p) <= info.pd) out.alertas.push('dissipação ' + fmt(Math.abs(p), 'W') + ' perto da Pd (' + fmt(info.pd, 'W') + ')');
    lim(id, info.idmax, 1.5, 'corrente', 'A', 'corrente de ' + fmt(Math.abs(id), 'A') + ' (máx ' + fmt(info.idmax, 'A') + '; queima acima de 1,5×)');
    lim(p, info.pd, 1.5, 'dissipação', 'W', 'dissipou ' + fmt(Math.abs(p), 'W') + ' (Pd ' + fmt(info.pd, 'W') + '; queima acima de 1,5×)');
    lim(vds, info.vdss, 1.1, 'tensão ' + (info.tipo === 'igbt' ? 'Vce' : 'Vds'), 'V', 'tensão de ' + fmt(Math.abs(vds), 'V') + ' entre ' + (info.tipo === 'igbt' ? 'coletor e emissor' : 'dreno e source') + ' (máx ' + fmt(info.vdss, 'V') + ')');
    if (Math.abs(vgs) > info.vgsmax) queima('tensão de gate de ' + fmt(Math.abs(vgs), 'V') + ' (máx ±' + fmt(info.vgsmax, 'V') + ': rompe o óxido do gate)');
    out.corrente = id; out.idmax = info.idmax; out.pd = info.pd; out.vdss = info.vdss;
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
      const out = { titulo: info.ref + ' — ' + (info.rotulo || info.tipo), linhas: [], alertas: info.avisos.slice(), p: 0, tipo: info.tipo, campos: info.campos || null };
      /* 1.113.0: QUEIMA — cada tipo diz aqui se passou do limite (o Simulador queima o componente: abre, vermelho com fumaca) */
      const queima = mot => { if (!out.queima) out.queima = mot; };
      /* 1.114.0: acima da nominal ALERTA; acima do fator, QUEIMA (o mesmo para todos os limites) */
      const lim = (x, max, fq, nome, un, motivo) => {
        if (!(max > 0) || !isFinite(x)) return;
        const a = Math.abs(x);
        if (a > max * fq) queima(motivo);
        else if (a > max) out.alertas.push(nome + ' de ' + fmt(a, un) + ' ACIMA da nominal (' + fmt(max, un) + '; queima acima de ' + (fq === 1 ? 'dela' : String(fq).replace('.', ',') + '×') + ')');
      };
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
          if (info.tol) out.linhas.push(L('Tolerância', fmt(info.rNominal, 'Ω') + ' ±' + String(info.tol).replace('.', ',') + ' %: este resistor mede ' + fmt(info.r, 'Ω'), fmt(info.r, 'Ω')));
          out.potenciaNominal = info.potencia; out.tol = info.tol; out.rReal = info.r; out.rNominal = info.rNominal;
          if (info.potencia && vr * vr / info.r > info.potencia * 2) queima('dissipou ' + fmt(vr * vr / info.r, 'W') + ' (a nominal é ' + fmt(info.potencia, 'W') + '; queima acima de 2×)');
          out.corrente = ia; out.de = ia >= 0 ? a : b;
          break;
        }
        case 'rede': {
          let imx = 0, pmx = 0, pior = null;
          for (const x of info.resistores || []) {
            const r = elRes.get(x.el); if (!r) continue;
            const i = Math.abs(r.i[0]), pr = Math.abs(r.p);
            out.linhas.push(L('R ' + x.a.num + '–' + x.b.num, fmt(i, 'A') + ' · ' + fmt(pr, 'W'), fmt(i, 'A')));
            if (i > imx) imx = i;
            if (pr > pmx) { pmx = pr; pior = x; }
          }
          out.corrente = imx; out.potenciaNominal = info.potencia;
          if (pior && pmx > info.potencia * 2) queima('o resistor ' + pior.a.num + '–' + pior.b.num + ' dissipou ' + fmt(pmx, 'W') + ' (a nominal é ' + fmt(info.potencia, 'W') + ' cada; queima acima de 2×)');
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
            /* 1.114.0 (lote 2): a potencia nominal vale para a pista inteira — um trecho de fracao f aguenta f·P; o trecho pequeno
               com corrente alta queima (acima de 2x) */
            if (info.potencia && info.r) {
              out.corrente = Math.max(Math.abs(ra.i[0]), Math.abs(rb.i[0]));
              for (const [el, rr, nome] of [[info.r1, ra, 'ponta–cursor'], [info.r2, rb, 'cursor–ponta']]) {
                /* P = V²/R com a R de agora (o cursor girado muda a R antes da media do quadro trazer a corrente nova) */
                const dv = rr.v[0] - rr.v[1], lim = info.potencia * Math.max(0.02, el.r / info.r), pr = dv * dv / Math.max(el.r, 1e-6);
                if (pr > lim * 2) queima('o trecho ' + nome + ' (' + fmt(el.r, 'Ω') + ') dissipou ' + fmt(pr, 'W') + ' (aguenta ' + fmt(lim, 'W') + ' de ' + fmt(info.potencia, 'W') + ' da pista; queima acima de 2×)');
              }
            }
          }
          break;
        }
        case 'ntc': {
          const { a, b, va, vb, ia } = doisPinos(), vr = va - vb;
          out.linhas.push(L('Resistência a ' + info.temp + ' °C', 'R = R25·e^(β(1/T − 1/298,15)) = ' + fmt(info.r25, 'Ω') + '·e^(' + info.beta + '·(1/' + (info.temp + 273.15).toFixed(2).replace('.', ',') + ' − 1/298,15))', fmt(info.r, 'Ω')));
          out.linhas.push(L('Corrente', 'I = V/R', fmt(Math.abs(ia), 'A')));
          out.corrente = ia; out.de = ia >= 0 ? a : b;
          if (info.potencia && vr * vr / info.r > info.potencia * 2) queima('dissipou ' + fmt(vr * vr / info.r, 'W') + ' (a nominal é ' + fmt(info.potencia, 'W') + '; queima acima de 2×)');
          break;
        }
        case 'ptc': {
          const { a, b, va, vb, ia } = doisPinos(), vr = va - vb;
          out.linhas.push(L('Resistência agora', 'R = R25·(1 + (V/Vk)⁶): sobe quando a corrente passa da nominal', fmt(Math.abs(ia) > 1e-12 ? Math.abs(vr / ia) : info.r, 'Ω')));
          out.linhas.push(L('Corrente', 'limita perto da nominal (' + fmt(info.inom, 'A') + ')', fmt(Math.abs(ia), 'A')));
          out.corrente = ia; out.de = ia >= 0 ? a : b;
          break;
        }
        case 'ferrite': {
          const { a, ia } = doisPinos();
          out.linhas.push(L('Corrente', 'I (nominal ' + fmt(info.inom, 'A') + ')', fmt(Math.abs(ia), 'A')));
          out.corrente = ia; out.de = a;
          lim(ia, info.inom, 1.5, 'corrente', 'A', 'corrente de ' + fmt(Math.abs(ia), 'A') + ' (nominal ' + fmt(info.inom, 'A') + '; queima acima de 1,5×)');
          break;
        }
        case 'capacitor': {
          const { a, b, va, vb, ia } = doisPinos(); const vc = va - vb;
          out.linhas.push(L('Tensão no capacitor', 'Vc = ' + fmt(va, 'V') + ' − ' + fmt(vb, 'V'), fmt(vc, 'V')));
          out.linhas.push(L('Carga', 'Q = C·V = ' + fmt(info.c, 'F') + ' · ' + fmt(vc, 'V'), fmt(info.c * vc, 'C')));
          out.linhas.push(L('Energia', 'E = ½·C·V²', fmt(0.5 * info.c * vc * vc, 'J')));
          if (res.modo !== 'dc') out.linhas.push(L('Corrente', 'I = C·dV/dt', fmt(ia, 'A')));
          else out.linhas.push(L('Corrente (DC)', 'em regime o capacitor não conduz', '0 A'));
          if (info.vmax && Math.abs(vc) > info.vmax * 0.8 && Math.abs(vc) <= info.vmax) out.alertas.push('tensão ' + fmt(Math.abs(vc), 'V') + ' perto da nominal (' + fmt(info.vmax, 'V') + ')');
          if (info.polarizado && vc < -0.3) out.alertas.push('capacitor polarizado com tensão invertida (' + fmt(vc, 'V') + ')');
          if (info.polarizado && vc < -1) queima('polaridade invertida: ' + fmt(vc, 'V') + ' no + (o polarizado queima com mais de 1 V ao contrário)');
          lim(vc, info.vmax, 1.2, 'tensão', 'V', 'tensão de ' + fmt(Math.abs(vc), 'V') + ' (a nominal é ' + fmt(info.vmax, 'V') + '; queima acima de 1,2×)');
          out.vmax = info.vmax; out.polarizado = !!info.polarizado;
          out.corrente = ia; out.de = ia >= 0 ? a : b;
          break;
        }
        case 'indutor': {
          const { a, b, va, vb, ia } = doisPinos();
          out.linhas.push(L('Corrente no indutor', res.modo === 'dc' ? 'em DC o indutor é um curto' : 'V = L·dI/dt', fmt(ia, 'A')));
          out.linhas.push(L('Energia', 'E = ½·L·I²', fmt(0.5 * info.l * ia * ia, 'J')));
          out.linhas.push(L('Queda', 'V = ' + fmt(va, 'V') + ' − ' + fmt(vb, 'V'), fmt(va - vb, 'V')));
          out.corrente = ia; out.de = ia >= 0 ? a : b;
          /* 1.114.0 (lote 2): acima da nominal satura (alerta); acima de 1,5x aquece e queima */
          if (info.inom) {
            out.linhas.push(L('Corrente nominal', 'Isat/Irms · DCR ' + fmt(info.dcr, 'Ω'), fmt(info.inom, 'A')));
            if (Math.abs(ia) > info.inom) out.alertas.push('corrente ' + fmt(Math.abs(ia), 'A') + ' acima da nominal (' + fmt(info.inom, 'A') + '): o núcleo satura');
            if (Math.abs(ia) > info.inom * 1.5) queima('corrente de ' + fmt(Math.abs(ia), 'A') + ' (nominal ' + fmt(info.inom, 'A') + '; aquece e queima acima de 1,5×)');
          }
          break;
        }
        case 'fusivel': {
          const { a, ia } = doisPinos();
          out.linhas.push(L('Corrente', 'I', fmt(Math.abs(ia), 'A')));
          /* 1.114.0 (lote 2): o fusivel comum ABRE (fica aberto: "Trocar" poe um novo) acima de In (rapido) ou 1,5x (retardo);
             o rearmavel (PTC) dispara acima de 2x Ihold e rearma sozinho quando o defeito sai */
          if (info.rearmavel) {
            out.linhas.push(L('Corrente de manutenção', 'Ihold (dispara acima de 2×)', fmt(info.ihold, 'A')));
            out.linhas.push(L('Estado', info.disparado ? 'disparado: fica em ≈ ' + fmt(info.pt, 'W') + ' (I = P/V); rearma quando o defeito sai' : 'frio: conduz', info.disparado ? 'DISPARADO' : 'normal'));
            if (info.disparado) out.alertas.push('fusível rearmável DISPARADO (rearma sozinho quando a corrente cair)');
            out.disparado = !!info.disparado;
          } else {
            const fator = info.lento ? 1.5 : 1;
            out.linhas.push(L('Corrente nominal', (info.lento ? 'retardado: abre acima de 1,5×' : 'rápido: abre acima da nominal'), fmt(info.inom, 'A')));
            if (info.inom > 0 && Math.abs(ia) > info.inom * fator) queima('fusível aberto: ' + fmt(Math.abs(ia), 'A') + ' (nominal ' + fmt(info.inom, 'A') + (info.lento ? ', retardado: abre acima de 1,5×' : ', rápido') + ')');
          }
          out.corrente = ia; out.de = a;
          break;
        }
        case 'led': case 'diodo': {
          /* 1.113.0: o LED RGB/bicolor — uma linha por cor, a cor que se ve e a mistura das acesas */
          if (info.canais) {
            let br = 0, mix = [0, 0, 0], im = 0, soma = 0;
            for (const ch of info.canais) {
              const r = elRes.get(ch.d), i = r ? r.i[0] : 0, b = Math.max(0, Math.min(1, i / 0.015));
              out.linhas.push(L('LED ' + ch.nome + ' (pino ' + ch.pino.num + ')', 'Vf ≈ ' + fmt(ch.vf, 'V'), fmt(i, 'A')));
              if (i > info.imax * 1.5) queima('corrente de ' + fmt(i, 'A') + ' no ' + ch.nome + ' (a máxima é ' + fmt(info.imax, 'A') + '; queima acima de ' + fmt(info.imax * 1.5, 'A') + ')');
              const vr = r ? r.v[1] - r.v[0] : 0;
              if (vr > 6) queima('tensão reversa de ' + fmt(vr, 'V') + ' no ' + ch.nome + ' (o LED aguenta ≈ 5 V)');
              br = Math.max(br, b); im = Math.max(im, Math.abs(i)); soma += b;
              const h = ch.cor; mix = mix.map((x, k) => x + b * parseInt(h.slice(1 + 2 * k, 3 + 2 * k), 16));
            }
            out.brilho = br; out.corrente = im; out.imax = info.imax;
            out.cor = soma > 0.01 ? '#' + mix.map(x => Math.min(255, Math.round(x / soma)).toString(16).padStart(2, '0')).join('') : info.canais[0].cor;
            out.linhas.push(L('Brilho', 'a cor que se vê é a mistura das acesas', Math.round(br * 100) + ' %'));
            break;
          }
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
            if (i > out.imax * 1.5) queima('corrente de ' + fmt(i, 'A') + ' (a nominal é ' + fmt(out.imax, 'A') + '; queima acima de ' + fmt(out.imax * 1.5, 'A') + ')');
            else if (i > out.imax) out.alertas.push('corrente de ' + fmt(i, 'A') + ' ACIMA da nominal (' + fmt(out.imax, 'A') + '; queima acima de 1,5×)');
            if (vtot < -6) queima('tensão reversa de ' + fmt(-vtot, 'V') + ' (o LED aguenta ≈ 5 V ao contrário)');
          } else {
            if (info.bv && vtot < -info.bv * 0.9) out.linhas.push(L('Em ruptura', 'zener/TVS conduzindo ao contrário: Vz ≈ ' + fmt(info.bv, 'V'), fmt(-i, 'A')));
            /* 1.113.0: os limites do diodo e a queima: If acima da maxima, o retificador com reverso acima do VRRM (o zener e o TVS
               conduzem ao contrario de proposito: nao queimam por isso), o zener dissipando acima da potencia */
            out.ifmax = info.ifmax; out.vrrm = info.vrrm; out.sub = info.sub;
            if (info.ifmax) out.linhas.push(L('Limites', info.sub === 'zener' ? 'Vz ' + fmt(info.bv, 'V') + ' · ' + fmt(info.pz, 'W') : 'If máx ' + fmt(info.ifmax, 'A') + (info.bv ? '' : ' · VRRM ' + fmt(info.vrrm, 'V')), info.sub || ''));
            lim(i > 0 ? i : 0, info.ifmax, 1.5, 'corrente direta', 'A', 'corrente direta de ' + fmt(i, 'A') + ' (If máx ' + fmt(info.ifmax, 'A') + '; queima acima de 1,5×)');
            if (!info.bv) lim(-vtot > 0 ? -vtot : 0, info.vrrm, 1.1, 'tensão reversa', 'V', 'tensão reversa de ' + fmt(-vtot, 'V') + ' (VRRM ' + fmt(info.vrrm, 'V') + ')');
            if (info.sub === 'zener') lim(p, info.pz, 1.5, 'potência no zener', 'W', 'o zener dissipou ' + fmt(Math.abs(p), 'W') + ' (a nominal é ' + fmt(info.pz, 'W') + '; queima acima de 1,5×)');
          }
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
          /* 1.113.0: os limites (o que queima): Ic acima da maxima, Vce·Ic acima da Pd, Vce acima da Vceo */
          out.linhas.push(L('Limites', 'Ic máx ' + fmt(info.icmax, 'A') + ' · Pd ' + fmt(info.pd, 'W') + ' · Vceo ' + fmt(info.vceo, 'V'), ''));
          if (Math.abs(p) > info.pd * 0.8 && Math.abs(p) <= info.pd) out.alertas.push('dissipação ' + fmt(Math.abs(p), 'W') + ' perto da Pd (' + fmt(info.pd, 'W') + ')');
          lim(ic, info.icmax, 1.5, 'corrente de coletor', 'A', 'corrente de coletor de ' + fmt(Math.abs(ic), 'A') + ' (Ic máx ' + fmt(info.icmax, 'A') + '; queima acima de 1,5×)');
          lim(p, info.pd, 1.5, 'dissipação', 'W', 'dissipou ' + fmt(Math.abs(p), 'W') + ' (Pd ' + fmt(info.pd, 'W') + '; queima acima de 1,5×)');
          lim(pol * (vc - ve) > 0 ? vc - ve : 0, info.vceo, 1.1, 'Vce', 'V', 'Vce de ' + fmt(Math.abs(vc - ve), 'V') + ' (Vceo ' + fmt(info.vceo, 'V') + ')');
          out.corrente = ic; out.icmax = info.icmax; out.pd = info.pd; out.vceo = info.vceo; out.bf = info.m.bf;
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
          /* 1.114.0 (lote 2): os limites e a queima — Id acima de 1,5x, P acima de 1,5x a Pd, Vds acima da Vdss, Vgs acima do
             maximo (rompe o oxido do gate) */
          mosQueima(out, info, id, vd - vs, vg - vs, p, queima, lim);
          break;
        }
        case 'igbt': {
          const r = elRes.get(info.q), rj = info.junc && elRes.get(info.junc); if (!r) break;
          const vce = pv(info.pinos.find(q => /^C/i.test(q.name || '')) || info.pinos[1]) - r.v[2], vge = r.v[1] - r.v[2], ic = r.i[0];
          out.linhas.push(L('Gate–emissor', 'Vge', fmt(vge, 'V')));
          out.linhas.push(L('Coletor–emissor', 'Vce = Vjunção + Vcanal' + (rj ? ' = ' + fmt(rj.v[0] - rj.v[1], 'V') + ' + ' + fmt(r.v[0] - r.v[2], 'V') : ''), fmt(vce, 'V')));
          out.linhas.push(L('Corrente de coletor', 'Ic', fmt(ic, 'A')));
          out.linhas.push(L('Estado', 'Vth ≈ ' + fmt(info.m.vth, 'V'), vge < info.m.vth ? 'cortado' : 'conduzindo'));
          out.estado = vge < info.m.vth ? 'cortado' : 'conduzindo';
          mosQueima(out, info, ic, vce, vge, p, queima, lim);
          break;
        }
        case 'chave': {
          const { ia } = doisPinos();
          if (info.dip) out.linhas.push(L('Chaves', 'cada uma no campo (0 aberta, 1 fechada); o clique muda todas', info.dip.map(e => e.fechada ? '1' : '0').join('')));
          else if (info.posicoes) out.linhas.push(L('Posição', 'mude no campo (o clique passa para a próxima)', String((info.posicao || 0) + 1)));
          else out.linhas.push(L(info.fechada ? 'Fechada' : 'Aberta', info.interativo === 'botao' ? 'segure o clique no botão para apertar' : 'clique para abrir/fechar', info.fechada ? fmt(Math.abs(ia), 'A') : '—'));
          /* 1.115.0 (lote 3): a corrente do contato — acima de 1,5x ele queima e ABRE */
          let imx = 0;
          for (const k of info.contatos || (info.sw ? [{ el: info.sw }] : [])) { const r = elRes.get(k.el); if (r && k.el.fechada) imx = Math.max(imx, Math.abs(r.i[0])); }
          out.corrente = info.sw ? (elRes.get(info.sw) || { i: [0] }).i[0] : imx;
          if (info.imax) {
            out.linhas.push(L('Corrente do contato', 'máx ' + fmt(info.imax, 'A'), fmt(imx, 'A')));
            lim(imx, info.imax, 1.5, 'corrente no contato', 'A', 'o contato queimou e abriu: ' + fmt(imx, 'A') + ' (o contato aguenta ' + fmt(info.imax, 'A') + '; queima acima de 1,5×)');
          }
          break;
        }
        case 'ssr': {
          const rl = elRes.get(info.led), rs = elRes.get(info.sw);
          const il = rl ? rl.i[0] : 0, io = rs ? Math.abs(rs.i[0]) : 0;
          out.linhas.push(L('LED de entrada', 'liga acima de ' + fmt(info.ion, 'A'), fmt(il, 'A')));
          out.linhas.push(L('Saída', info.ligado ? 'MOSFET conduzindo' : 'aberta', info.ligado ? fmt(io, 'A') : 'aberta'));
          out.corrente = io; out.estado = info.ligado ? 'ligado' : 'desligado';
          lim(io, info.imax, 1.5, 'corrente na saída', 'A', 'a saída queimou: ' + fmt(io, 'A') + ' (máx ' + fmt(info.imax, 'A') + '; queima acima de 1,5×)');
          lim(il, 0.05, 1, 'corrente no LED', 'A', 'o LED de entrada queimou: ' + fmt(il, 'A') + ' (máx 50 mA)');
          break;
        }
        case 'dcdc': {
          const r = elRes.get(info.el); if (!r) break;
          const vi = r.v[0] - r.v[1], vo = r.v[2] - r.v[3], io = -r.i[2], ii = r.i[0];
          out.linhas.push(L('Entrada', 'faixa ' + fmt(info.vinmin, 'V') + '–' + fmt(info.vinmax, 'V'), fmt(vi, 'V')));
          out.linhas.push(L('Saída', 'nominal ' + (info.dual ? '±' : '') + fmt(info.vout, 'V'), fmt(vo, 'V')));
          out.linhas.push(L('Corrente de saída', 'máx = P/Vout = ' + fmt(info.pout, 'W') + '/' + fmt(info.vout, 'V') + ' = ' + fmt(info.imax, 'A'), fmt(io, 'A')));
          out.linhas.push(L('Corrente de entrada', 'Iin = Pout/(η·Vin), η ' + Math.round(info.eta * 100) + ' %', fmt(ii, 'A')));
          out.corrente = io;
          if (vi < info.vinmin && vi > 0.5) out.alertas.push('entrada de ' + fmt(vi, 'V') + ' abaixo da faixa (' + fmt(info.vinmin, 'V') + '–' + fmt(info.vinmax, 'V') + '): sem saída');
          lim(vi, info.vinmax, 1.2, 'entrada', 'V', 'entrada de ' + fmt(vi, 'V') + ' acima da faixa (máx ' + fmt(info.vinmax, 'V') + '; queima acima de 1,2×)');
          lim(io, info.imax, 1.5, 'corrente de saída', 'A', 'saída sobrecarregada: ' + fmt(io, 'A') + ' (máx ' + fmt(info.imax, 'A') + ' = ' + fmt(info.pout, 'W') + '; queima acima de 1,5×)');
          break;
        }
        case 'shunt': {
          const r = elRes.get(info.el); if (!r) break;
          const vka = r.v[0] - r.v[1], vr = r.v[2] - r.v[1], ik = r.i[0];
          out.linhas.push(L('Tensão K–A', 'regula a REF em ' + fmt(info.vref, 'V') + ' (Vout = Vref·(1 + R1/R2))', fmt(vka, 'V')));
          out.linhas.push(L('REF', 'Vref', fmt(vr, 'V')));
          out.linhas.push(L('Corrente de catodo', 'Ik (mín ≈ 1 mA para regular)', fmt(ik, 'A')));
          if (vka > 2 && ik < 1e-3) out.alertas.push('Ik de ' + fmt(ik, 'A') + ': abaixo de 1 mA não regula');
          out.corrente = ik;
          lim(ik, info.ikmax, 1.5, 'corrente de catodo', 'A', 'corrente de ' + fmt(ik, 'A') + ' (Ik máx ' + fmt(info.ikmax, 'A') + '; queima acima de 1,5×)');
          lim(p, info.pd, 1.5, 'dissipação', 'W', 'dissipou ' + fmt(Math.abs(p), 'W') + ' (máx ' + fmt(info.pd, 'W') + '; queima acima de 1,5×)');
          lim(vka, 37, 1, 'tensão K–A', 'V', 'tensão K–A de ' + fmt(vka, 'V') + ' (máx 37 V)');
          break;
        }
        case 'inversor': {
          const r = elRes.get(info.el); if (!r) break;
          const vin = r.v[0] - r.v[2], vo = r.v[1] - r.v[2], io = -r.i[1];
          out.linhas.push(L('Entrada', 'V+', fmt(vin, 'V'))); out.linhas.push(L('Saída', 'Vout ≈ −Vin − Iout·55 Ω', fmt(vo, 'V')));
          out.linhas.push(L('Corrente de saída', 'I (máx ≈ 40 mA)', fmt(Math.abs(io), 'A')));
          out.corrente = io;
          lim(vin, info.vinmax, 1, 'entrada', 'V', 'entrada de ' + fmt(vin, 'V') + ' (máx ' + fmt(info.vinmax, 'V') + ')');
          if (Math.abs(io) > 0.04) out.alertas.push('corrente de saída de ' + fmt(Math.abs(io), 'A') + ' (o ICL7660 entrega ≈ 40 mA)');
          break;
        }
        case 'rele': {
          out.linhas.push(L('Bobina', info.ligado ? 'energizada (acima de 75 % de ' + fmt(info.vbob, 'V') + ')' : 'desligada', info.ligado ? 'LIGADO' : 'desligado'));
          /* 1.115.0 (lote 3): a bobina (tensao, corrente, nao puxa abaixo de 75 %, queima acima de 1,5x), o contato (queima
             acima de 1,5x) e o diodo de roda livre */
          const rb = info.bob && elRes.get(info.bob), vb = rb ? Math.abs(rb.v[0] - rb.v[1]) : 0;
          out.linhas.push(L('Tensão na bobina', 'nominal ' + fmt(info.vbob, 'V') + ' · ' + fmt(info.rbob, 'Ω'), fmt(vb, 'V')));
          if (!info.ligado && vb > 0.1 * info.vbob && vb < 0.75 * info.vbob) out.alertas.push('bobina com ' + fmt(vb, 'V') + ': abaixo de 75 % da nominal (' + fmt(info.vbob, 'V') + ') o relé não puxa');
          lim(vb, info.vbob, 1.5, 'tensão na bobina', 'V', 'a bobina queimou: ' + fmt(vb, 'V') + ' (nominal ' + fmt(info.vbob, 'V') + '; queima acima de 1,5×)');
          let ic = 0;
          for (const k of info.contatos || []) { const r = elRes.get(k); if (r && k.fechada) ic = Math.max(ic, Math.abs(r.i[0])); }
          out.linhas.push(L('Corrente no contato', 'máx ' + fmt(info.icontato, 'A'), fmt(ic, 'A')));
          out.corrente = ic;
          lim(ic, info.icontato, 1.5, 'corrente no contato', 'A', 'o contato queimou: ' + fmt(ic, 'A') + ' (aguenta ' + fmt(info.icontato, 'A') + '; queima acima de 1,5×)');
          const n1 = info.b1 && info.b1.net, n2 = info.b2 && info.b2.net;
          if (n1 && n2 && ![...mt.comps.values()].some(o => o.tipo === 'diodo' && o.pinos.some(q => q.net === n1) && o.pinos.some(q => q.net === n2)))
            out.alertas.push('sem diodo de roda livre na bobina: o pico ao desligar pode queimar o transistor que aciona o relé');
          break;
        }
        case 'bateria': {
          const el = info.elementos[0], r = elRes.get(el);
          if (r) {
            const i = -r.i[0];
            out.linhas.push(L('Corrente entregue', 'I', fmt(i, 'A'))); out.linhas.push(L('Potência entregue', 'P = V·I', fmt(-r.p, 'W')));
            out.linhas.push(L('Resistência interna', 'a tensão cai I·Rint = ' + fmt(i * info.rint, 'V'), fmt(info.rint, 'Ω')));
            if (info.cap && i > 1e-4) out.linhas.push(L('Autonomia', 'capacidade / corrente = ' + Math.round(info.cap) + ' mAh / ' + fmt(i, 'A'), (info.cap / 1000 / i >= 1 ? (info.cap / 1000 / i).toFixed(1).replace('.', ',') + ' h' : Math.round(info.cap / 1000 / i * 60) + ' min')));
            out.corrente = i;
            /* 1.115.0 (lote 3): carga reversa numa nao-recarregavel; o curto (acima do limite da quimica / 3C) */
            if (!info.recarregavel && i < -1e-3) out.alertas.push('CORRENTE ENTRANDO numa bateria não recarregável (' + fmt(-i, 'A') + '): carga reversa — ela vaza ou estoura');
            lim(i > 0 ? i : 0, info.imax, 1, 'corrente', 'A', 'curto: ' + fmt(i, 'A') + ' (esta bateria aguenta ≈ ' + fmt(info.imax, 'A') + ')');
          }
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
          /* 1.115.0 (lote 3): o que o encapsulamento aguenta sem dissipador; acima, o termico desliga (alerta); Vin acima do maximo queima */
          const fpR = norm(info.comp.footprint), pkg = /TO-?92/.test(fpR) ? 0.6 : /SOT-?223/.test(fpR) ? 1 : /DPAK|TO-?252/.test(fpR) ? 1.5 : /SOT-?23|SOT-?89|SC-?70/.test(fpR) ? 0.3 : /SO-?8|SOIC|MSOP/.test(fpR) ? 0.6 : 2;
          if (pd > pkg) out.alertas.push('dissipação de ' + fmt(pd, 'W') + (pd > pkg * 1.5 ? ': o regulador DESLIGA por temperatura (' : ' acima do que o encapsulamento aguenta sem dissipador (') + fmt(pkg, 'W') + ')');
          if (info.desligado) out.alertas.unshift('DESLIGADO por temperatura: a saída cortou (dissipava acima de ' + fmt(info.pkg * 1.5, 'W') + ')');
          lim(vin - vg, info.modelo.vinmax, 1.1, 'entrada', 'V', 'entrada de ' + fmt(vin - vg, 'V') + ' (Vin máx ' + fmt(info.modelo.vinmax, 'V') + ')');
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
          out.linhas.push(L('Flip-flop', 'liga quando TRIG < ⅓·Vcc, desliga quando THR > ⅔·Vcc', (info.nucleos && info.nucleos.length > 1 ? info.nucleos.map((n, k) => (k + 1) + ': ' + (n.q ? 'ALTA' : 'baixa')).join(', ') : info.q ? 'saída ALTA' : 'saída baixa')));
          /* 1.116.0 (lote 4): Vcc acima do maximo e a corrente da saida queimam */
          for (const nuc of info.nucleos || []) {
            const r = elRes.get(nuc.el); if (!r) continue;
            const vcc = r.v[7] - r.v[0], io = r.i[2];
            lim(vcc, info.vccmax, 1.1, 'Vcc', 'V', 'Vcc de ' + fmt(vcc, 'V') + ' (máx ' + fmt(info.vccmax, 'V') + ')');
            lim(io, info.ioutmax, 1.5, 'corrente na saída', 'A', 'a saída queimou: ' + fmt(Math.abs(io), 'A') + ' (máx ' + fmt(info.ioutmax, 'A') + '; queima acima de 1,5×)');
            out.corrente = io;
          }
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
          /* 1.117.0: o canal com as entradas soltas (ninguem mais na net) e "sem uso": nao entra nos alertas */
          const ligadas = net => !!net && [...mt.comps.values()].some(o => o !== info && o.pinos.some(q => q.net === net)) || mt.fontes.some(f => f.net === net);
          for (const ch of info.canais || []) {
            const r = elRes.get(ch.el); if (!r) continue;
            const [vp, vn, vo, vcc, vee] = r.v;
            if (ch.inp && ch.inn && !ligadas(ch.inp.net) && !ligadas(ch.inn.net)) { out.linhas.push(L('Canal ' + ch.L, 'entradas soltas', 'canal sem uso')); continue; }
            out.linhas.push(L('Canal ' + ch.L, 'V+ = ' + fmt(vp, 'V') + ', V− = ' + fmt(vn, 'V') + (info.tipo === 'opamp' ? ', Vout = A·(V+ − V−) limitada às trilhas' : ': saída ' + (vp > vn ? 'aberta (alta)' : 'puxada a GND')), fmt(vo, 'V')));
            if (info.tipo === 'opamp' && (vo > vcc - 1.6 || vo < vee + 0.06) && Math.abs(vp - vn) > 1e-3) out.alertas.push('canal ' + ch.L + ' saturado (' + fmt(vo, 'V') + ')');
            /* 1.116.0 (lote 4): a saida no limite de corrente (o curto) e a alimentacao acima do maximo (queima) */
            if (info.ilim && Math.abs(r.i[2]) > info.ilim * 0.9) out.alertas.push('canal ' + ch.L + ': saída no limite de corrente (' + fmt(info.ilim, 'A') + ')');
            if (info.vmax) lim(vcc - vee, info.vmax, 1.1, 'alimentação', 'V', 'alimentação de ' + fmt(vcc - vee, 'V') + ' (máx ' + fmt(info.vmax, 'V') + ')');
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
          /* 1.116.0 (lote 4): por canal — If, a saida, os limites e a queima */
          let imx = 0;
          for (const ch of info.canais || [{ el: info.ci, k: 1 }]) {
            const r = elRes.get(ch.el); if (!r) continue;
            const il = r.i[0], ic = r.i[2], vce = r.v[2] - r.v[3], vd = r.v[0] - r.v[1];
            const nm = (info.canais && info.canais.length > 1 ? ' ' + ch.k : '');
            out.linhas.push(L('LED' + nm, 'If (liga acima de ≈ 1 mA' + (info.triac || info.schmitt ? '; dispara com ' + fmt(info.ift, 'A') : '') + ')', fmt(il, 'A')));
            out.linhas.push(L('Saída' + nm, info.triac ? 'TRIAC ' + (ch.on ? 'conduzindo (até a corrente cair abaixo de 0,1 mA)' : 'bloqueado') : info.schmitt ? 'Schmitt ' + (ch.on ? 'ligado' : 'desligado') : 'Ic = CTR·If = ' + Math.round(info.ctr * 100) + ' %·' + fmt(Math.abs(il), 'A') + ' (limitado pela saturação)', fmt(ic, 'A')));
            if (Math.abs(il) > 1e-6 && Math.abs(il) < 1e-3 && !info.triac) out.alertas.push('LED' + nm + ' com ' + fmt(Math.abs(il), 'A') + ': abaixo de ≈ 1 mA o opto não liga direito');
            lim(Math.abs(il), info.ifmax, 1.5, 'corrente no LED' + nm, 'A', 'o LED' + nm + ' queimou: ' + fmt(Math.abs(il), 'A') + ' (If máx ' + fmt(info.ifmax, 'A') + '; queima acima de 1,5×)');
            if (-vd > 6) queima('tensão reversa de ' + fmt(-vd, 'V') + ' no LED' + nm + ' (máx ≈ 6 V)');
            lim(ic, info.icmax, 1.5, 'corrente na saída' + nm, 'A', 'a saída' + nm + ' queimou: ' + fmt(Math.abs(ic), 'A') + ' (máx ' + fmt(info.icmax, 'A') + '; queima acima de 1,5×)');
            lim(Math.abs(vce), info.vceo, 1.1, 'tensão na saída' + nm, 'V', 'tensão de ' + fmt(Math.abs(vce), 'V') + ' na saída' + nm + ' (máx ' + fmt(info.vceo, 'V') + ')');
            imx = Math.max(imx, Math.abs(ic));
          }
          out.corrente = imx;
          break;
        }
        case 'varistor': {
          const r = elRes.get(info.el); if (!r) break;
          const vv = Math.abs(r.v[0] - r.v[1]), ia = Math.abs(r.i[0]);
          out.linhas.push(L('Tensão', 'conduz forte acima de V1mA ≈ ' + fmt(info.v1ma, 'V') + ' (I = 1 mA·(V/V1mA)^30)', fmt(vv, 'V')));
          out.linhas.push(L('Corrente', 'abaixo da V1mA quase nada', fmt(ia, 'A')));
          if (info.energia) out.linhas.push(L('Energia / pico', 'o surto que ele absorve', fmt(info.energia, 'J') + (info.ipico ? ' · ' + fmt(info.ipico, 'A') : '')));
          out.corrente = ia;
          if (vv > info.vdc * 1.1 && ia > 1e-3) queima('aqueceu com ' + fmt(vv, 'V') + ' contínuos (VDC máx ' + fmt(info.vdc, 'V') + ') e falhou: o MOV entra em CURTO e depois abre');
          else if (vv > info.vdc) out.alertas.push('tensão de ' + fmt(vv, 'V') + ' acima da contínua nominal (' + fmt(info.vdc, 'V') + ' DC / ' + fmt(info.vac, 'V') + ' AC)');
          break;
        }
        case 'tiristor': {
          const r = elRes.get(info.el); if (!r) break;
          const vak = r.v[0] - r.v[1], ia = r.i[0];
          out.linhas.push(L('Estado', info.sub === 'diac' ? 'dispara em ' + fmt(info.vbo, 'V') + ' e cai para ≈ 5 V' : 'liga pelo gatilho e só solta com a corrente abaixo de Ih (' + fmt(info.ih, 'A') + ')', info.on ? 'TRAVADO (conduzindo)' : 'bloqueado'));
          out.linhas.push(L(info.sub === 'triac' ? 'Tensão MT2–MT1' : 'Tensão A–K', info.on ? 'Vt ≈ 1 V conduzindo' : 'bloqueando', fmt(vak, 'V')));
          out.linhas.push(L('Corrente', info.on ? 'a carga define' : 'fuga', fmt(ia, 'A')));
          if (r.i[2] != null && info.sub !== 'diac' && info.sub !== 'put') out.linhas.push(L('Gatilho', 'Ig (dispara acima de ' + fmt(info.igt, 'A') + ')', fmt(r.i[2], 'A')));
          out.corrente = ia; out.estado = info.on ? 'TRAVADO' : 'bloqueado';
          lim(ia, info.itrms * Math.SQRT2, 1.5, 'corrente', 'A', 'corrente de ' + fmt(Math.abs(ia), 'A') + ' (IT(RMS) ' + fmt(info.itrms, 'A') + '; queima acima de 1,5× o pico)');
          if (info.vdrm) lim(info.on ? 0 : vak, info.vdrm, 1.1, 'tensão bloqueando', 'V', 'tensão de ' + fmt(Math.abs(vak), 'V') + ' bloqueando (VDRM ' + fmt(info.vdrm, 'V') + ')');
          break;
        }
        case 'oscilador': {
          const r = elRes.get(info.el); if (!r) break;
          out.linhas.push(L('Frequência', 'onda quadrada', info.freq ? fmt(info.freq, 'Hz') : '—'));
          out.linhas.push(L('Saída', 'a média (Vcc/2) — a onda é rápida demais para o passo', fmt(r.v[2] - r.v[1], 'V')));
          out.corrente = r.i[0];
          break;
        }
        case 'trafo': {
          const r = elRes.get(info.el); if (!r) break;
          const vpri = r.v[0] - r.v[1], vsec = r.v[2] - r.v[3], is = -r.i[2], ip = r.i[0];
          const dc = res.modo === 'dc';
          out.linhas.push(L('Relação', 'Vs/Vp = ' + fmt(info.vs, 'V') + '/' + fmt(info.vp, 'V'), '1 : ' + String(+(1 / info.n).toPrecision(3)).replace('.', ',')));
          out.linhas.push(L('Primário', dc ? 'no DC: o enrolamento é quase um curto' : 'Vp', fmt(vpri, 'V')));
          out.linhas.push(L('Secundário', dc ? 'no DC não transfere (0 V)' : 'Vs = Vp·n − Is·Rs', fmt(vsec, 'V')));
          out.linhas.push(L('Corrente no secundário', 'máx ' + fmt(info.va / info.vs, 'A') + ' (= VA/Vs)', fmt(is, 'A')));
          out.corrente = ip;
          if (dc && Math.abs(vpri) > 1) out.alertas.push('transformador em DC: só funciona com AC (o primário é um enrolamento: ' + fmt(Math.abs(ip), 'A') + ')');
          lim(is, info.va / info.vs * Math.SQRT2, 1.5, 'corrente no secundário', 'A', 'o secundário queimou: ' + fmt(Math.abs(is), 'A') + ' (máx ' + fmt(info.va / info.vs, 'A') + ' RMS; queima acima de 1,5× o pico)');
          if (dc) lim(ip, info.va / info.vp * 3, 1, 'corrente no primário', 'A', 'o primário queimou: ' + fmt(Math.abs(ip), 'A') + ' em DC (o enrolamento é quase um curto)');
          break;
        }
        case 'conector': {
          /* 1.117.0: a corrente de cada pino que e entrada (a fonte daquela net entra por ele) */
          let imx = 0, pmx = null;
          for (const p of info.pinos) {
            if (!p.net || (mt.terra || []).includes(p.net)) continue;
            const fo = mt.fontes.find(f => f.net === p.net);
            if (fo && isFinite(fo.i)) { const i = Math.abs(fo.i); if (i > imx) { imx = i; pmx = p; } }
          }
          if (pmx) out.linhas.push(L('Corrente no pino ' + pmx.num, 'a entrada de ' + pmx.net + ' (máx ' + fmt(info.imax, 'A') + ')', fmt(imx, 'A')));
          out.corrente = imx;
          if (pmx) lim(imx, info.imax, 1.5, 'corrente no pino ' + pmx.num, 'A', 'o pino ' + pmx.num + ' derreteu: ' + fmt(imx, 'A') + ' (aguenta ' + fmt(info.imax, 'A') + '; queima acima de 1,5×)');
          break;
        }
        case 'ponte': {
          /* 1.116.0 (lote 4): a corrente de saida (o pino +), o reverso em cada diodo, os limites */
          const rs = (info.dios || []).map(d => elRes.get(d)).filter(Boolean);
          const io = info.pPos ? Math.abs(correnteDoPino(info.ref + '-' + info.pPos.num)) : 0;
          const vrev = rs.reduce((m, r) => Math.max(m, r.v[1] - r.v[0]), 0);
          out.linhas.push(L('Corrente de saída', 'pelo +, máx ' + fmt(info.ifmax, 'A'), fmt(io, 'A')));
          out.linhas.push(L('Tensão reversa (pior diodo)', 'VRRM ' + fmt(info.vrrm, 'V'), fmt(vrev, 'V')));
          out.linhas.push(L('Saída', 'V+ − V− (dois diodos conduzem: ≈ 1,4 V a menos que o pico)', fmt(pv(info.pPos) - pv(info.pNeg), 'V')));
          out.corrente = io;
          lim(io, info.ifmax, 1.5, 'corrente', 'A', 'corrente de ' + fmt(io, 'A') + ' (máx ' + fmt(info.ifmax, 'A') + '; queima acima de 1,5×)');
          lim(vrev, info.vrrm, 1.1, 'tensão reversa', 'V', 'tensão reversa de ' + fmt(vrev, 'V') + ' (VRRM ' + fmt(info.vrrm, 'V') + ')');
          break;
        }
        case 'ganho': {
          for (const el of info.blocos || []) {
            const r = elRes.get(el); if (!r) continue;
            out.linhas.push(L(el.papel === 'ganho' ? 'Saída' : el.papel, 'Vout = ' + (info.ganho !== 1 ? fmt(info.ganho, '').trim() + '·' : '') + '(V+ − V−) = ' + fmt(info.ganho, '').trim() + '·' + fmt(r.v[0] - r.v[1], 'V'), fmt(r.v[2] - r.v[4], 'V')));
            out.corrente = r.i[2];
            if (Math.abs(r.i[2]) > info.ilim * 0.9) out.alertas.push('saída no limite de corrente (' + fmt(info.ilim, 'A') + ')');
          }
          const [pa, pb] = info.pAlim || [];
          if (pa && pb) lim(pv(pa) - pv(pb), info.vmax, 1.1, 'alimentação', 'V', 'alimentação de ' + fmt(pv(pa) - pv(pb), 'V') + ' (máx ' + fmt(info.vmax, 'V') + ')');
          break;
        }
        case 'driver': {
          let ptot = 0, imx = 0;
          for (const ch of info.chs || []) {
            const r = elRes.get(ch.el); if (!r) continue;
            const ic = r.i[1], vo = r.v[1] - r.v[2];
            ptot += Math.abs(ic * vo); imx = Math.max(imx, Math.abs(ic));
            if (Math.abs(ic) > 1e-4) out.linhas.push(L('Canal ' + ch.k, 'Vce(sat) ≈ ' + fmt(vo, 'V'), fmt(ic, 'A')));
            lim(ic, info.ich, 1.5, 'corrente no canal ' + ch.k, 'A', 'o canal ' + ch.k + ' queimou: ' + fmt(Math.abs(ic), 'A') + ' (máx ' + fmt(info.ich, 'A') + '; queima acima de 1,5×)');
            lim(vo, info.vmax, 1.1, 'tensão na saída ' + ch.k, 'V', 'tensão de ' + fmt(vo, 'V') + ' na saída ' + ch.k + ' (máx ' + fmt(info.vmax, 'V') + ')');
            /* carga indutiva (rele, motor, indutor) na saida sem o COM no +: o pico ao desligar queima o canal */
            /* a carga indutiva na saida: o COM tem de estar na net do outro lado dela (o +V da carga), senao o diodo interno nao protege */
            const sai = ch.po && ch.po.net;
            const indut = [...mt.comps.values()].filter(o => /^(rele|indutor|carga)$/.test(o.tipo) && (o.tipo !== 'carga' || /Motor|Buzzer/.test(o.rotulo || '')) && o.pinos.some(q => q.net && q.net === sai));
            const comNet = info.com && info.com.net;
            if (indut.some(o => !o.pinos.some(q => q.net && q.net !== sai && q.net === comNet))) out.alertas.push('canal ' + ch.k + ': carga indutiva sem o COM ligado ao +V dela (o diodo interno não protege)');
          }
          out.linhas.push(L('Potência total', 'Σ Vce·Ic (máx ' + fmt(info.pd, 'W') + ')', fmt(ptot, 'W')));
          out.corrente = imx;
          lim(ptot, info.pd, 1.5, 'potência total', 'W', 'dissipou ' + fmt(ptot, 'W') + ' (máx ' + fmt(info.pd, 'W') + '; queima acima de 1,5×)');
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
