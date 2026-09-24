/* AltiumPCBMirror v2 - hub-converte.js — converter um projeto para o almoxarifado.

   O PROBLEMA: um projeto extraído do Altium vem com os componentes da biblioteca ANTIGA da
   casa — "RES [ SMD ]" com footprint "RES 1206" e comment "10k". Medido nos 19 projetos
   deste workspace: 1428 componentes colocados, 10 do almoxarifado. Trocar um por um pelo
   seletor da vista Esquema (hub-almoxpick.js) funciona e é o que existe hoje; o que não
   existe é olhar o projeto INTEIRO de uma vez.

   O QUE ESTE ARQUIVO FAZ: lê a folha aberta, separa quem já é do almoxarifado de quem não é,
   agrupa os iguais (mesmo símbolo + footprint + comment viram UMA linha, com todos os
   designadores) e, para cada linha, recomenda componentes do almoxarifado que servem de
   substituto — a partir do comment, dos parâmetros, do valor e do footprint, nesta ordem de
   força. Quem decide é a pessoa: a recomendação vem escolhida mas trocável, e nada é gravado
   antes do "Aplicar".

   QUEM GRAVA NÃO É ESTE ARQUIVO. A gravação é a ponte `__hubAplicaVinculos` do schframe.js —
   a MESMA que o painel da BoM e o "Enviar para o Odoo" usam. É ela que resolve o símbolo,
   monta o `params` com o OdooId, segura o multi-parte (um conector de 16 partes grava só a
   identidade, senão perderia 15 partes e a fiação junto) e encaixa os pinos no lugar antigo.
   Uma segunda implementação disso aqui seria uma segunda chance de divergir.

   Este arquivo é autossuficiente — injeta o próprio CSS, o próprio botão e o próprio modal,
   como o hub-odoolista.js faz. O schframe.html só precisa da linha <script src>.           */
"use strict";
var HubConverte = (function () {

/* ══════════════════ NÚCLEO PURO ══════════════════
   Sem DOM, sem rede: é ele que o tests/test-converte.js roda em Node contra os projetos e o
   almoxarifado de verdade. Recomendação é palpite, e palpite que ninguém mede vira lenda. */

/* "K=V;K=V" — o formato plano do schematic.js (o parser DelphiScript do BuildSchematic lê
   linha a linha e não aguenta objeto aninhado). */
function paramsPlanos(txt){
  const fora = {};
  for (const par of String(txt == null ? '' : txt).split(';')){
    const i = par.indexOf('=');
    if (i <= 0) continue;
    const k = par.slice(0, i).trim(), v = par.slice(i + 1).trim();
    if (k) fora[k.toUpperCase()] = v;
  }
  return fora;
}

/* Sem acento e em MAIÚSCULA: "CONECTOR PADRÃO" e "conector padrao" têm de casar. O espelho
   do almoxarifado é latin-1 e o do projeto é UTF-8 — o mesmo nome chega escrito de dois
   jeitos mais de uma vez por projeto. */
const ACENTO = /[̀-ͯ]/g;
const CX = t => String(t == null ? '' : t).normalize('NFD').replace(ACENTO, '').toUpperCase();
const semSep = t => CX(t).replace(/[\s\-_/.,]/g, '');

/* ── "180g" é 180 graus ──
   O cadastro do Odoo escreve o ângulo do conector com "g" de graus ("1x10 P2.54mm Macho
   180g"). Na tela isso lê como unidade errada, então o símbolo ° entra no lugar.

   SÓ 90 E 180, e a restrição não é frescura — é o que separa ângulo de código de peça.
   Medido no espelho do servidor (3568 valores): "<número>g" aparece 122 vezes, das quais
   118 são 180g (85) ou 90g (33), todas em conector ou chave. As outras 4 seriam estrago:
   "LM2575D2T-5G" e "LP2950CZ-3.3G" são sufixo de part number, "BDMU-12G" é código de régua
   terminal, e o "200g" de "Cofisil Sensor Silo 1 6m 2X1.0mm² 200g 750v" é o PESO do cabo.
   Uma troca cega de número-seguido-de-g teria reescrito os quatro.

   É TROCA DE EXIBIÇÃO, e o nome gravado não muda: o `sym` que vai para o schematic.js
   continua sendo o texto do acervo, e o `title` da linha mostra o nome cru. */
const GRAUS = /(?<![0-9A-Za-z])(90|180)\s*g\b/gi;
const comGraus = t => String(t == null ? '' : t).replace(GRAUS, '$1°');

/* ── o valor de engenharia ──
   "100nF", "0.1uF", "4k7", "10K", "330R", "1M2", "22pF 50V" — a mesma peça se escreve de
   meia dúzia de jeitos, e comparar o literal faz "100nF" e "0.1uF" parecerem coisas
   diferentes. Normaliza para um número em unidade base (ohm, farad, henry) e uma CLASSE.

   O código RKM ("4k7" = 4.7k) é o que a casa escreve à mão, e é ele que quebra o parse
   ingênuo: "4k7" com parseFloat vira 4, e 4 ohms não é 4.7k. */
/* A CAIXA DO M IMPORTA, e é o único lugar deste arquivo onde ela importa: "100mOhms" é
   mili-ohm e "1M2" é mega-ohm — o mesmo texto em maiúscula valeria um bilhão de vezes mais.
   Por isso normValor trabalha no texto CRU, e não no CX(). */
const MULT = { p: 1e-12, P: 1e-12, n: 1e-9, N: 1e-9, u: 1e-6, U: 1e-6, µ: 1e-6, μ: 1e-6,
               m: 1e-3, M: 1e6, k: 1e3, K: 1e3, G: 1e9, g: 1e9, R: 1, r: 1, E: 1, e: 1 };
/* o que NÃO é o valor, e mora na mesma frase: potência ("1/4W", "5W"), tolerância ("1%"),
   coeficiente ("100ppm"), tensão ("50V"), a temperatura do dielétrico ("C0G", "X7R") e o
   ENCAPSULAMENTO ("SMD 1206 100nF" lia 1206). Sem tirar isso antes, "1/4W 10k" lia 1 e
   recomendava um resistor de 1 ohm. */
const RUIDO = /\d+(?:[.,]\d+)?\s*\/\s*\d+\s*W\b|\d+(?:[.,]\d+)?\s*W\b|\d+(?:[.,]\d+)?\s*%|\d+\s*PPM|\d+(?:[.,]\d+)?\s*V(?![A-Z])|\b[CX]\dG?\b|\b(?:0201|0402|0603|0805|1206|1210|1812|2010|2512|2220)\b/gi;
function normValor(txt, classePadrao){
  const cru = String(txt == null ? '' : txt).replace(/Ω/g, 'R').replace(RUIDO, ' ');
  const uniDe = u => !u ? '' : /F/i.test(u) ? 'F' : /H/i.test(u) ? 'H' : 'R';
  let n = null, mult = '', uni = '';

  /* RKM primeiro ("4K7" = 4.7k, "0R22", "1M2"): com parseFloat, "4k7" vira 4 — e 4 ohms não
     é 4.7k. É a notação que a casa escreve à mão. */
  let m = cru.match(/(?:^|[\s(=])(\d+)([pnuµmMkKGRre])(\d+)\s*(F|H|R|ohms?)?/);
  if (m){
    n = parseFloat(m[1] + '.' + m[3]) * (MULT[m[2]] || 1);
    mult = m[2];
    uni = uniDe(m[4]) || (/[RrEe]/.test(m[2]) ? 'R' : '');
  } else {
    /* forma comum: número, multiplicador opcional, unidade opcional. Ganha o primeiro que
       traga multiplicador OU unidade; número pelado só serve se não houver outro. */
    const re = /(?:^|[\s(=\/])(\d+(?:[.,]\d+)?)\s*([pnuµμmMkKGg])?\s*(F|H|R|ohms?)?/g;
    let cand = null, achou;
    while ((achou = re.exec(cru))){
      const bom = !!(achou[2] || achou[3]);
      if (bom){ cand = achou; break; }
      if (!cand) cand = achou;
    }
    if (!cand) return null;
    n = parseFloat(cand[1].replace(',', '.'));
    if (!isFinite(n)) return null;
    mult = cand[2] || '';
    if (mult) n *= (MULT[mult] || 1);
    uni = uniDe(cand[3]);
  }
  const classe = uni === 'F' ? 'C' : uni === 'H' ? 'L' : uni === 'R' ? 'R' : (classePadrao || '');
  if (!classe) return null;
  /* mega-farad não existe numa placa: num capacitor, o M solto é o micro que a casa escreve
     sem o "u" ("100M" = 100µF) */
  if (classe === 'C' && mult === 'M') n = n / 1e6 * 1e-6;
  return { classe, n };
}
const mesmoValor = (a, b) => !!a && !!b && a.classe === b.classe
  && (a.n === b.n || (a.n > 0 && b.n > 0 && Math.abs(a.n - b.n) / Math.max(a.n, b.n) < 0.005));

/* ── a tensão ("25V", "50 V") — desempate, nunca requisito ── */
function tensaoDe(txt){
  const m = CX(txt).match(/(\d+(?:[.,]\d+)?)\s*V(?![A-Z])/);
  return m ? parseFloat(m[1].replace(',', '.')) : null;
}

/* ── o encapsulamento ──
   Vem do NOME DO FOOTPRINT, que é o que o projeto antigo tem na mão: "RES 1206" → 1206,
   "CAP 0805" → 0805, "1206 resistor" → 1206, "SOT-23" → SOT-23, "DIP8" → DIP8. É o segundo
   sinal mais forte depois do valor, e o dono foi explícito: mesmo valor com encap diferente
   são produtos diferentes. */
const IMPERIAL = /\b(0201|0402|0603|0805|1206|1210|1812|2010|2512|2220)\b/;
const PACOTE = /\b(SOT-?\d+[A-Z]*|SOD-?\d+|SMA|SMB|SMC|DO-?\d+[A-Z]*|TO-?\d+[A-Z]*|DIP-?\d+|SOIC-?\d+|SSOP-?\d+|TSSOP-?\d+|MSOP-?\d+|QFN-?\d+|TQFP-?\d+|LQFP-?\d+|SOP-?\d+|DPAK|D2PAK|MELF)\b/;
function encapDe(){
  for (const txt of arguments){
    const t = CX(txt).replace(/[_]/g, ' ');
    let m = t.match(IMPERIAL);
    if (m) return m[1];
    m = t.match(PACOTE);
    if (m) return m[1].replace(/^([A-Z]+)-?(\d)/, '$1-$2');
  }
  return '';
}
const mesmoEncap = (a, b) => !!a && !!b && semSep(a) === semSep(b);

/* ── o número de vias ──
   Para conector é o que o valor e o encapsulamento são para um resistor: "CONECTOR HEADER /
   16 VIAS" e "9 vias 180º 2.54mm Macho" só casam se os dois disserem 16. Sem isso, os 120
   conectores de 20 pinos do corpus recebiam um WEIPU de 3 vias com nota respeitável. */
function viasDe(){
  for (const txt of arguments){
    const t = CX(txt);
    /* O "P" TEM DE ESTAR COLADO NO NÚMERO ("EK508V-02P"). Solto, ele lia "RJ45 P/ PCB"
       como 45 vias — o mesmo erro que o extrator do gerador tinha e que sustentava um
       símbolo fantasma "CONECTOR 45V" com o RJ45 dentro (tools/almox/conectores.py). */
    let m = t.match(/(\d+)\s*(?:VIAS?|PINOS?|PINS?|POS)\b/) || t.match(/(?<![0-9.,])(\d+)P\b/)
         || t.match(/\b(?:VIAS?|PINOS?)\s*(\d+)/);
    if (m) return parseInt(m[1], 10);
    m = t.match(/(?<![0-9.,])(\d+)\s*X\s*(\d+)(?![0-9.,])/);      /* "2x10", "1X4" */
    if (m) return parseInt(m[1], 10) * parseInt(m[2], 10);
  }
  return null;
}

/* ── parece part number? ──
   "1N4148", "TL082", "BC337", "BAV70" — letra e dígito juntos, e é o nome da peça, não uma
   medida. Quando esse texto aparece dentro do nome do candidato, é evidência forte: mais
   forte que encapsulamento, porque part number igual é a MESMA peça. Valor ("100nF", "4k7")
   fica de fora: já tem sinal próprio, e contar duas vezes inflaria a nota. */
const VALOR_PURO = /^\s*\d+(?:[.,]\d+)?\s*[pnuµμmMkKGg]?\s*(?:F|H|R|ohms?)?\s*$/i;
function pareceMPN(txt){
  const t = semSep(txt);
  if (t.length < 4 || t.length > 24) return '';
  if (!/[A-Z]/.test(t) || !/\d/.test(t)) return '';
  /* "10K 1/4W" e "0.1uF/100nF 100V" têm letra e dígito e não são part number nenhum: são o
     VALOR, que já tem sinal próprio. Tirado o ruído (potência, tolerância, tensão), se cada
     pedaço do que sobra é um valor, então o texto todo é valor. "1N4148" e "BC337" sobram
     inteiros e não casam com forma de valor — esses são o que se quer aqui. */
  const resto = String(txt).replace(RUIDO, ' ').split(/[\s/]+/).filter(Boolean);
  if (resto.length && resto.every(x => VALOR_PURO.test(x))) return '';
  return t;
}

/* ── a montagem ──
   O almoxarifado separa a família por montagem ("RESISTOR [SMD]" e "RESISTOR [PTH]" são duas)
   e trocar SMD por PTH muda o furo da placa: é erro caro e silencioso. */
function montagemDe(){
  for (const txt of arguments){
    const t = CX(txt);
    if (/\bSMD\b|\bSMT\b/.test(t) || IMPERIAL.test(t) || /\bSO[TID]|QFN|[TL]QFP|SSOP|MSOP|DPAK|SMA|SMB|SMC\b/.test(t)) return 'SMD';
    if (/\bPTH\b|\bTHT\b|\bDIP\d*\b|\bTO-?\d|\bRADIAL\b|\bAXIAL\b|\d\/\d\s*W/.test(t)) return 'PTH';
  }
  return '';
}

/* ── o tipo, a partir do designador ──
   "R12" é resistor em qualquer projeto desta casa, e o almoxarifado guarda o designador de
   cada família. É o gate barato: sem ele, "10k" casa com um capacitor de 10 kpF. */
const TIPO_POR_PREFIXO = {
  R: 'R', RN: 'R', C: 'C', CP: 'C', L: 'L', D: 'D', DS: 'D', LED: 'D', Q: 'Q', T: 'Q',
  U: 'U', CI: 'U', IC: 'U', J: 'J', CN: 'J', CON: 'J', P: 'J', X: 'Y', Y: 'Y', F: 'F',
  FU: 'F', SW: 'SW', S: 'SW', K: 'K', RL: 'K', TP: 'TP', JP: 'JP', B: 'B', BT: 'B',
  BZ: 'BZ', SP: 'BZ', RV: 'RV', VR: 'RV', OP: 'U', VD: 'D',
};
/* O DESIGNADOR NÃO BASTA. Medido: a família LED do almoxarifado usa "DS" e a VARISTOR usa
   "RV" — dois prefixos que ninguém adivinha —, e um LED 1206 do projeto recebia como
   recomendação um VARISTOR 1206, com nota alta: mesmo encap, mesma montagem, e nenhum dos
   dois lados sabendo dizer que tipo de peça era. O nome diz, e está escrito em três campos
   (símbolo, footprint e comment de um lado; família do outro). */
const TIPO_POR_PALAVRA = [
  [/\bLEDS?\b|\bDIODO EMISSOR/, 'D'], [/\bDIODOS?\b|\bDIODE\b|\bRETIFICADOR|\bSCHOTTKY|\bZENER|\bTVS\b/, 'D'],
  [/\bRESISTORE?S?\b|\bRES\b|\bRESIST/, 'R'], [/\bCAPACITORE?S?\b|\bCAP\b|\bCAPACIT/, 'C'],
  [/\bINDUTOR|\bCHOKE\b|\bFERRITE\b/, 'L'], [/\bTRANSISTOR|\bMOSFET\b|\bNPN\b|\bPNP\b|\bIGBT\b|\bTRIAC\b|\bSCR\b/, 'Q'],
  [/\bCONECTORE?S?\b|\bCONECTOR|\bCONE\b|\bBORNE|\bHEADER\b|\bBARRA DE PINOS|\bJACK\b|\bPLUG\b|\bMSTBH?\b|\bWEIPU\b/, 'J'],
  [/\bFUSIVE/, 'F'], [/\bVARISTOR|\bVDR\b/, 'RV'], [/\bCRISTAL|\bOSCILADOR|\bXTAL\b|\bRESSONADOR/, 'Y'],
  [/\bRELE\b|\bRELAY\b/, 'K'], [/\bJUMPER\b/, 'JP'], [/\bTEST ?POINT|\bPONTO DE TESTE/, 'TP'],
  [/\bBUZZER\b|\bBUZER\b|\bSIRENE|\bALTO ?FALANTE/, 'BZ'], [/\bBATERIA\b|\bBATTERY\b|\bPILHA\b/, 'B'],
  [/\bCHAVE\b|\bSWITCH\b|\bPUSH ?BUTTON|\bBOTAO\b|\bDIP ?SWITCH/, 'SW'],
  [/\bOPTOACOPLADOR|\bOPTO\b|\bCI\b|\bAMPLIFICADOR OPERACIONAL|\bMICROCONTROLADOR|\bREGULADOR\b|\bMEMORIA\b/, 'U'],
  [/\bTRANSFORMADOR|\bTRAFO\b/, 'TR'], [/\bSENSOR\b/, 'SN'], [/\bDISPLAY\b|\bSEGMENTOS?\b/, 'DSP'],
];
function tipoDoTexto(){
  for (const txt of arguments){
    const t = CX(txt);
    if (!t) continue;
    for (const [re, tipo] of TIPO_POR_PALAVRA) if (re.test(t)) return tipo;
  }
  return '';
}
function prefixoDe(ref){
  const m = CX(ref).match(/^([A-Z]+)/);
  return m ? m[1] : '';
}
function tipoDoRef(ref){
  const p = prefixoDe(ref);
  if (!p) return '';
  if (Object.prototype.hasOwnProperty.call(TIPO_POR_PREFIXO, p)) return TIPO_POR_PREFIXO[p];
  return '';
}
/* a classe de valor que cada tipo usa — é o que deixa "10k" virar 10000 ohms num R e nada
   num conector */
const CLASSE_DO_TIPO = { R: 'R', C: 'C', L: 'L' };

/* o perfil do componente da folha: tudo o que se sabe dele, num objeto só */
function perfilDoComp(c){
  const p = paramsPlanos(c && c.params);
  const ref = String((c && c.ref) || '');
  const sym = String((c && c.sym) || '');
  const fp = String((c && c.footprint) || '');
  const comment = String((c && c.comment) || '');
  const tipo = tipoDoRef(ref) || tipoDoTexto(sym, fp, comment);
  /* o comment do Altium pode ser uma FÓRMULA ("=Value + ' - ' + Potência"): ela se resolve
     na folha, não aqui, e o valor de verdade está no params. Medido: 89 componentes. */
  const valorTxt = (comment.charAt(0) === '=' ? (p.VALUE || '') : (p.VALUE || comment));
  return {
    ref, sym, fp, comment, tipo,
    prefixo: prefixoDe(ref),
    mpn: String(p.MPN || '').trim(),
    odooId: String(p.ODOOID || '').trim(),
    valorId: String(p.VALORID || '').trim(),
    valorTxt,
    valor: normValor(valorTxt, CLASSE_DO_TIPO[tipo] || ''),
    tensao: tensaoDe(comment) || tensaoDe(p.VALUE) || null,
    encap: encapDe(p.ENCAPSULAMENTO, fp, sym, comment),
    mont: montagemDe(p.MONTAGEM, fp, sym, comment),
    vias: viasDe(comment, sym, fp),
    pn: pareceMPN(p.MPN) || pareceMPN(comment) || pareceMPN(sym),
  };
}

/* o mesmo perfil, do lado do almoxarifado. `g` é o grupo do hub-almoxpick (família) e `it`
   um valor dela. Em Node o teste monta os dois na mão a partir dos espelhos. */
function perfilDoValor(g, it){
  const v = (it && it.v) || {};
  const par = {};
  for (const q of (v.params || [])) if (q && q.n) par[CX(q.n)] = q.v;
  const familia = String((g && g.familia) || '');
  const tipo = tipoDoRef(String((g && g.designator) || '') + '1') || tipoDoTexto(familia);
  const valorTxt = v.value || par.VALUE || it.rotulo || '';
  return {
    nome: it.nome, rotulo: it.rotulo, familia,
    /* "CAPACITOR CERAMICO [SMD]" → "CAPACITOR CERAMICO": o sufixo é a montagem, que já é
       sinal próprio, e deixá-lo aqui impediria o nome de casar com o texto do projeto */
    familiaBase: CX(familia).replace(/\s*\[.*$/, '').trim(),
    saldo: Number(it.saldo) || 0,
    mpn: String(it.mpn || par.MPN || '').trim(),
    /* O ID DO ODOO E A IDENTIDADE, o nome e so o rotulo do dia. O espelho emite OdooId em
       todo valor (medido: 1756 de 1756 nos basicos) e e ele que diz "esta peca da folha e
       esta peca do acervo" sem depender de texto nenhum. */
    odooId: String(par.ODOOID || '').trim(),
    /* ── o que a ETIQUETA precisa, e mais nada ──
       Campos inertes para a pontuacao: nenhum peso os le, entao a recomendacao nao muda de
       ordem por causa deles. `grupos()` do hub-almoxpick ja os entrega prontos — inclusive a
       `linha` do conector, que nao precisa ser remontada aqui.
       O `it.tipo` do almoxpick e o CODIGO DO FABRICANTE ("MC 1,5/4-G-3,81", "2510") e entra
       como `cod`: por nada neste mundo em `tipo`, que neste arquivo e a classe da peca
       (R/C/D/J...) e e portao de recusa em `pontua`. */
    id: (v && v.id) != null ? v.id : null,
    linha: String(it.linha || '').trim(),
    cod: String(it.tipo || '').trim(),
    pkgs: (v && v.pkgs) || [],
    fora: !!it.fora,
    /* O ID DA FICHA NO ODOO É O `tmpl`, NÃO O `OdooId`. O link do Odoo aponta para o
       product.TEMPLATE; o `OdooId` dos params é o product.product (a variante). Medido no
       componente que o dono usou de exemplo — "Kk Macho 2,54mm 4 Vias 180° Molex Branco
       (2510)": variante 2118, template 2116, e 2116 é o número do link dele. Usar o OdooId
       abriria a ficha errada, ou ficha nenhuma.
       Cobertura: 2545 de 2545 valores têm `itens[].tmpl` — inclusive os marcados `fora`. */
    tmpl: String((((v && v.itens) || [])[0] || {}).tmpl || '').trim(),
    /* 31 valores juntam mais de um item do Odoo; o link vai no primeiro e a contagem diz
       que há mais, em vez de a tela fingir que a ficha é uma só */
    nItens: ((v && v.itens) || []).length,
    tipo,
    valor: normValor(valorTxt, CLASSE_DO_TIPO[tipo] || ''),
    tensao: tensaoDe(it.rotulo) || tensaoDe(par.COMMENT) || null,
    /* O PRIMEIRO E O DO FOOTPRINT DELE. A regra do dono e um encap por componente, mas o
       espelho antigo ainda traz valores com dois ("0603 / 1206", de quando o mesmo rotulo
       juntava duas compras) — e casar pelo segundo fazia a tela recomendar um "SMD 0805 10K"
       para um 1206, dizendo "encap 1206". Casar pelo primeiro vale a nota cheia; pelos
       outros, menos, e a tela diz qual casou. */
    encaps: encapsDoValor(v, it, par),
    mont: montagemDe(par.MONTAGEM, familia, it.nome, it.pkg),
    fp: String(it.pkg || ''),
    /* O NÚMERO DE VIAS JÁ VEM LIDO. O gerador o extrai de cinco pistas do nome do Odoo
       (tools/almox/conectores.py) e o publica em `valores[].conn`; aqui ele é fato, não
       releitura. O `viasDe` fica de reserva para o espelho antigo e para as famílias que
       não são conector — e a família saiu da lista de fontes porque ela não traz mais o
       número ("CONECTOR 10V" virou "CONECTOR HEADER SEM TRAVA"); quem traz é o símbolo. */
    vias: (it.conn && it.conn.vias) || viasDe(it.rotulo, it.nome,
                                              (it.sym && it.sym.name) || familia),
    pn: pareceMPN(it.mpn || par.MPN) || pareceMPN(it.rotulo),
  };
}
function encapsDoValor(v, it, par){
  const fora = [];
  const poe = e => { if (e && fora.indexOf(e) < 0) fora.push(e); };
  poe(encapDe(it.pkg));
  poe(encapDe(par.ENCAPSULAMENTO));
  for (const e of (v.pkgs || [])) poe(encapDe(e) || String(e || '').trim());
  poe(encapDe(it.nome, it.rotulo));
  return fora.filter(Boolean);
}

/* ── a nota ──
   Somar sinais, e DIZER quais somaram: uma recomendação sem motivo é um chute com cara de
   resposta, e quem confere precisa saber se casou o valor ou só o texto. */
const PESO = { mpn: 120, pn: 55, valor: 60, encap: 40, encap2: 26, familia: 35, tipo: 25,
               vias: 30, mont: 15, tensao: 6, texto: 20, saldo: 3 };
/* abaixo disto não é recomendação, é chute: a linha sai com "nada compatível" e o botão de
   escolher à mão. Dizer "não achei" é informação; apontar para o primeiro item de uma lista
   ordenada por acaso não é. */
const MINIMO = 25;
function pontua(a, b){
  const motivos = [];
  let pts = 0;

  const mpnIgual = !!a.mpn && !!b.mpn && semSep(a.mpn) === semSep(b.mpn);
  if (mpnIgual){ pts += PESO.mpn; motivos.push('mesmo MPN'); }

  /* GATE: tipo diferente não é substituto, e ponto — a não ser que o MPN diga o contrário
     (um part number igual vale mais que qualquer heurística de designador). */
  if (a.tipo && b.tipo && a.tipo !== b.tipo && !mpnIgual) return null;
  if (a.tipo && a.tipo === b.tipo){ pts += PESO.tipo; motivos.push('mesmo tipo'); }
  else if (a.tipo && !b.tipo) pts -= 8;      /* o que não sabe dizer o que é entra atrás */

  /* o nome da família escrito no projeto: "LED SMD 1206 RED" traz "LED", "FUSIVEL" traz
     "FUSIVEL". Vale igual para todos os valores da família, então não distorce a ordem
     dentro dela — só levanta a família certa. */
  if (b.familiaBase && b.familiaBase.length >= 3
      && CX(a.sym + ' ' + a.fp + ' ' + a.comment).indexOf(b.familiaBase) >= 0){
    pts += PESO.familia; motivos.push('família "' + b.familiaBase.toLowerCase() + '"');
  }

  if (mesmoValor(a.valor, b.valor)){ pts += PESO.valor; motivos.push('mesmo valor'); }
  else if (a.valor && b.valor && !mpnIgual) return null;   /* valor diferente não substitui */

  const iEnc = (b.encaps || []).findIndex(e => mesmoEncap(a.encap, e));
  if (iEnc === 0){ pts += PESO.encap; motivos.push('encap ' + b.encaps[0]); }
  else if (iEnc > 0){ pts += PESO.encap2; motivos.push('encap ' + b.encaps[iEnc] + ' (o 2º dele)'); }
  else if (a.encap && (b.encaps || []).length && !mpnIgual) pts -= 18;

  /* o part number escrito no comment ou no simbolo, achado dentro do nome do candidato:
     "1N4148" no comment e "PTH 1N4148UR-1" no almoxarifado sao a mesma peca, e nenhum dos
     dois lados tem campo MPN preenchido para dizer isso. */
  if (a.pn && !mpnIgual){
    const alvoCand = semSep(b.nome + ' ' + b.rotulo + ' ' + (b.mpn || ''));
    if (alvoCand.indexOf(a.pn) >= 0){ pts += PESO.pn; motivos.push('part number no nome'); }
  }

  /* vias: para conector e o que o valor e para um resistor */
  if (a.vias && b.vias){
    if (a.vias === b.vias){ pts += PESO.vias; motivos.push(a.vias + ' vias'); }
    else if (!mpnIgual) pts -= 22;
  }

  if (a.mont && b.mont){
    if (a.mont === b.mont){ pts += PESO.mont; motivos.push(a.mont); }
    else if (!mpnIgual) return null;      /* SMD por PTH muda o furo da placa */
  }
  if (a.tensao && b.tensao){
    if (a.tensao === b.tensao){ pts += PESO.tensao; motivos.push(a.tensao + 'V'); }
    else if (b.tensao < a.tensao) pts -= 12;     /* tensão menor não aguenta o circuito */
  }

  /* o texto é o último recurso: serve para o que não tem valor nenhum (um conector, um CI) */
  const alvo = semSep(a.comment || a.sym);
  if (alvo.length >= 3){
    const cand = semSep(b.nome + ' ' + b.rotulo);
    if (cand.indexOf(alvo) >= 0 || alvo.indexOf(semSep(b.rotulo)) >= 0){
      pts += PESO.texto; motivos.push('o texto bate');
    } else {
      const toks = CX(a.comment || a.sym).split(/[\s/,()]+/).filter(t => t.length >= 3);
      const casam = toks.filter(t => CX(b.nome + ' ' + b.rotulo).indexOf(t) >= 0);
      if (toks.length && casam.length){
        pts += Math.round(PESO.texto * casam.length / toks.length);
        if (casam.length >= 2) motivos.push(casam.length + ' de ' + toks.length + ' palavras');
      }
    }
  }
  if (b.saldo > 0) pts += PESO.saldo;
  if (pts < MINIMO) return null;
  let conf = confiancaDe(motivos, pts);
  /* SEM O VALOR NAO HA CONFIANCA, por mais pontos que o resto some. Medido: 48 resistores
     1206 do corpus tem o comment "=Value + ' - ' + Potencia" e NENHUM parametro — a formula
     se resolve dentro do Altium e o export nao trouxe o Value. Eles casavam tipo, encap e
     montagem, somavam 83 e vinham marcados: um "Aplicar" trocaria 48 resistores por 0.1R. */
  if (precisaValor(a) && !a.valor) conf = 'baixa';
  return { pts, motivos, confianca: conf };
}
const precisaValor = a => !!CLASSE_DO_TIPO[a && a.tipo];
function confiancaDe(motivos, pts){
  if (motivos.indexOf('mesmo MPN') >= 0) return 'alta';
  const tem = t => motivos.indexOf(t) >= 0;
  const temEncap = motivos.some(m => m.indexOf('encap ') === 0);
  const temVias = motivos.some(m => /^\d+ vias$/.test(m));
  if (tem('mesmo valor') && temEncap) return 'alta';
  if (tem('part number no nome') && (temEncap || tem('mesmo tipo'))) return 'alta';
  /* vias sozinhas nao fazem meia-confianca: TODO conector tem um numero de vias, e casar so
     isso recomendava um conector baioneta de 2 pinos para um jumper de 2 pinos. */
  if (tem('mesmo valor') || tem('part number no nome')
      || (temVias && pts >= 90) || (temEncap && pts >= 70)) return 'media';
  return 'baixa';
}

/* as sugestões de UM componente, da melhor para a pior */
function sugere(perfil, cands, quantas){
  const fora = [];
  for (const b of cands){
    const n = pontua(perfil, b);
    if (n) fora.push({ alvo: b, pts: n.pts, motivos: n.motivos, confianca: n.confianca });
  }
  fora.sort((x, y) => y.pts - x.pts
    || (y.alvo.saldo > 0) - (x.alvo.saldo > 0)
    || String(x.alvo.nome).localeCompare(String(y.alvo.nome), 'pt-BR'));
  return quantas ? fora.slice(0, quantas) : fora;
}

/* ── a varredura ──
   Componentes iguais viram UMA linha: num projeto com 175 resistores, decidir 175 vezes a
   mesma coisa é o trabalho que este painel existe para poupar. A chave é o que define a
   peça — símbolo, footprint e comment —, nunca o designador. */
function chaveDoComp(c){
  return [String(c.sym || ''), String(c.footprint || ''), String(c.comment || ''),
          String(c.params || '')].join('  ');
}
function varre(comps, cands, jaAlmox){
  const linhas = new Map();
  const ehAlmox = jaAlmox || (() => false);
  for (const c of comps || []){
    const k = chaveDoComp(c);
    let ln = linhas.get(k);
    if (!ln){
      const perfil = perfilDoComp(c);
      /* o detector pode devolver o NOME da peca que casou, e nao so um sim/nao: quando o
         acervo renomeia um valor, o nome da folha e o do acervo sao dois textos para a
         mesma peca, e a linha precisa poder dizer isso */
      const achou = ehAlmox(c, perfil);
      ln = { chave: k, comp: c, perfil: perfil, refs: [], partes: 0,
             almox: !!achou, almoxNome: (typeof achou === 'string' ? achou : ''),
             sugestoes: [], escolha: null, marcado: false, alerta: '' };
      linhas.set(k, ln);
    }
    ln.partes++;
    if (ln.refs.indexOf(c.ref) < 0) ln.refs.push(c.ref);
  }
  const fora = [];
  for (const ln of linhas.values()){
    if (!ln.almox){
      ln.sugestoes = sugere(ln.perfil, cands, 8);
      ln.escolha = ln.sugestoes.length ? ln.sugestoes[0] : null;
      /* SÓ alta e média vêm marcadas. Uma recomendação de confiança baixa é um ponto de
         partida para a busca, não uma resposta — se ela viesse marcada, um "Aplicar tudo"
         trocaria o projeto inteiro por palpites, e desfazer isso é reabrir 300 linhas. */
      ln.marcado = !!ln.escolha && ln.escolha.confianca !== 'baixa';
      if (precisaValor(ln.perfil) && !ln.perfil.valor)
        ln.alerta = (String(ln.perfil.comment).charAt(0) === '='
          ? 'o comment e uma formula do Altium e o Value nao veio no export'
          : 'o projeto nao diz o valor desta peca')
          + ' — da para escolher o encapsulamento, nao o valor';
    }
    fora.push(ln);
  }
  fora.sort((a, b) => (a.almox - b.almox)
    || (b.refs.length - a.refs.length)
    || String(a.refs[0]).localeCompare(String(b.refs[0]), 'pt-BR', { numeric: true }));
  return fora;
}

/* ── o mais próximo, quando o valor exato não existe ──
   "30K em PTH" não está no almoxarifado, e a lista de substitutos sai vazia — corretamente,
   porque 33K não é 30K e trocar por conta própria é decidir pelo projetista. Mas "não achei"
   sem mais nada manda a pessoa procurar o que não existe: dizer QUAL é o mais perto responde
   a pergunta seguinte, e ela decide. */
function aproxima(perfil, cands, quantos){
  if (!perfil.valor || !perfil.valor.n) return [];
  const fora = [];
  for (const b of cands){
    if (perfil.tipo && b.tipo && perfil.tipo !== b.tipo) continue;
    if (perfil.mont && b.mont && perfil.mont !== b.mont) continue;
    if (!b.valor || !b.valor.n || b.valor.classe !== perfil.valor.classe) continue;
    if (mesmoValor(perfil.valor, b.valor)) continue;
    const razao = b.valor.n / perfil.valor.n;
    fora.push({ alvo: b, razao, dist: Math.abs(Math.log(razao)) });
  }
  fora.sort((x, y) => x.dist - y.dist || (y.alvo.saldo > 0) - (x.alvo.saldo > 0));
  return fora.slice(0, quantos || 5);
}

const PURO = { paramsPlanos, normValor, mesmoValor, tensaoDe, encapDe, montagemDe, viasDe,
               pareceMPN, tipoDoRef, tipoDoTexto, perfilDoComp, perfilDoValor, pontua, sugere,
               varre, aproxima, chaveDoComp, semSep, CX, comGraus, MINIMO };

/* ══════════════════ TELA ══════════════════ */
if (typeof document === 'undefined') return { pure: PURO };

const CSS = `
/* O TEMA É O DO HUB. Os nomes curtos (--panel, --fg, --border, --accent) são a ponte do
   schframe.html; --tint, --hi, --on-hi, --warn-soft, --scrim, --font e --mono vêm direto do
   hub-tema.css, que a vista carrega. O que vem depois da vírgula é o escuro antigo, a reserva
   para a página sem tema. Nenhuma cor fixa aqui: este modal é interface, não desenho, e com o
   azul e os cinzas cravados ele ficava escuro no meio do tema claro. */
#cvmodal{position:fixed; inset:0; z-index:60; display:none; background:var(--scrim,rgba(11,11,13,.62));}
#cvmodal.on{display:flex;}
#cvmodal .cv-box{position:absolute; inset:14px; display:grid; grid-template-rows:auto auto 1fr auto;
  background:var(--panel,#242424); border:1px solid var(--border,#3a3a3a); border-radius:8px;
  box-shadow:var(--shadow-menu,0 22px 60px rgba(0,0,0,.62)); overflow:hidden; min-height:0;}
#cvmodal .cv-head{display:flex; align-items:center; gap:10px; padding:11px 13px;
  border-bottom:1px solid var(--border,#3a3a3a); background:var(--panel2,#2d2d2d);}
#cvmodal .cv-head h2{font-size:13px; font-weight:600; margin:0; letter-spacing:-.01em;}
#cvmodal .cv-head .alvo{font-size:11px; color:var(--fg-dim,#9a9a9a); flex:1;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
#cvmodal .cv-bar{display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding:9px 13px;
  border-bottom:1px solid var(--border,#3a3a3a);}
#cvmodal .cv-bar input[type=text]{background:var(--panel2,#2d2d2d); color:var(--fg,#d8d8d8);
  font:inherit; border:1px solid var(--border,#3a3a3a); border-radius:3px; padding:3px 7px;
  min-width:180px;}
#cvmodal .cv-seg{display:flex; gap:0;}
#cvmodal .cv-seg button{font-size:11px; padding:3px 9px; border:1px solid var(--border,#3a3a3a);
  background:var(--panel2,#2d2d2d); color:var(--fg-dim,#9a9a9a); cursor:pointer;}
#cvmodal .cv-seg button:first-child{border-radius:3px 0 0 3px;}
#cvmodal .cv-seg button:last-child{border-radius:0 3px 3px 0;}
#cvmodal .cv-seg button[aria-pressed=true]{background:var(--hi,#0d47a1); border-color:var(--hi,#0d47a1);
  color:var(--on-hi,#fff);}
#cvmodal .cv-cont{font-size:11px; color:var(--fg-dim,#9a9a9a); margin-left:auto;
  display:flex; gap:10px; align-items:center;}
#cvmodal .cv-body{overflow:auto; min-height:0; padding:0 13px 10px;}
#cvmodal .cv-row{display:grid; gap:9px; align-items:start; padding:6px 4px;
  grid-template-columns:22px 128px minmax(0,1fr) 14px minmax(0,1.25fr) 74px;
  border-bottom:1px solid var(--border,#3a3a3a);}
#cvmodal .cv-row.hd{position:sticky; top:0; background:var(--panel,#242424); z-index:1;
  letter-spacing:.09em; text-transform:uppercase; color:var(--fg-dim,#9a9a9a); align-items:center;}
#cvmodal .cv-row.hd > *{font-size:10px;}
#cvmodal .cv-row.ja{opacity:.5;}
/* a caixa de marcar no destaque do tema, como as do hub — a nativa vinha no azul do sistema */
#cvmodal .cv-row input[type=checkbox]{accent-color:var(--hi,auto);}
#cvmodal .cv-row .seta{color:var(--fg-dim,#9a9a9a); font-size:13px; text-align:center;}
#cvmodal .cv-refs{display:flex; flex-wrap:wrap; gap:3px;}
#cvmodal .cv-refs button{font:11px/1.3 var(--mono,Consolas,ui-monospace,monospace); padding:1px 5px;
  border:1px solid var(--border,#3a3a3a); border-radius:3px; background:var(--panel2,#2d2d2d);
  color:var(--fg,#d8d8d8); cursor:pointer;}
#cvmodal .cv-refs button:hover{border-color:var(--accent,#4fc3f7); color:var(--accent,#4fc3f7);}
#cvmodal .cv-refs .mais{font-size:10px; color:var(--fg-dim,#9a9a9a); align-self:center;}
/* A LINHA GRANDE É O QUE SE TROCA. O valor vem em destaque, o corpo do componente
   (o footprint) ao lado em tamanho de leitura, e o nome do símbolo — que não decide
   substituição nenhuma — desce para a linha de baixo. */
#cvmodal .cv-hoje .chave{display:flex; flex-wrap:wrap; align-items:baseline; gap:3px 8px;}
/* o fundo do valor é o destaque do tema diluído: âmbar no Altium, dourado na Placa, cinza no
   Grafite — o mesmo color-mix do hub-bom.js */
#cvmodal .cv-hoje .val{font:600 15px/1.25 var(--font,'Segoe UI',sans-serif); color:var(--accent,#4fc3f7);
  background:color-mix(in srgb, var(--accent,#4fc3f7) 12%, transparent);
  border-radius:3px; padding:1px 7px; letter-spacing:-.01em;}
#cvmodal .cv-hoje .val.sem{color:var(--warn,#ffd54f); background:var(--warn-soft,rgba(255,213,79,.10));
  font-weight:500; font-style:italic;}
#cvmodal .cv-hoje .fp{font-size:13px; color:var(--fg,#d8d8d8); min-width:0; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap;}
#cvmodal .cv-hoje .nm{font-size:10px; color:var(--fg-dim,#9a9a9a); margin-top:3px;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
/* ── o seletor com etiquetas ──
   NADA DE CRASE DAQUI PARA BAIXO: este bloco é um template literal, e uma crase de comentário
   o fecha no meio. O node --check aceita (vira expressão válida) e os testes não pegam, porque
   em Node o módulo retorna antes desta linha — só a página quebra, com "row is not defined".
   Mesma grade do .alx-row da lib (30px / 1fr / auto / auto), vocabulário do :root desta
   página. Sem teto de largura nas etiquetas: quem encolhe é o NOME (minmax(0,1fr)) e,
   depois dele, a FAMÍLIA — código e encapsulamento cortados não identificam peça nenhuma. */
#cvmodal .cv-sel{min-width:0;}
/* a FAIXA é o flex; quem desenha a caixa é o botão de escolher, para o "Odoo" ficar fora
   dela e continuar clicável por conta própria */
#cvmodal .cv-esc{flex:1; min-width:0; display:flex; align-items:center; gap:6px;
  text-align:left; border:0; background:transparent; color:var(--fg,#d8d8d8);
  cursor:pointer; padding:3px 6px;}
#cvmodal .cv-esc > .cv-op{flex:1; min-width:0;}
#cvmodal .cv-esc .seta{color:var(--fg-dim,#9a9a9a); font-size:10px; flex:none;}
#cvmodal .cv-opcoes{margin-top:3px; max-height:290px; overflow:auto;
  border:1px solid var(--border,#3a3a3a); border-radius:3px; background:var(--panel,#242424);}
/* hover e escolhida como a árvore do hub: o véu do --tint (vira tinta escura no claro sozinho)
   e o traço do destaque à esquerda */
#cvmodal .cv-opb:hover{background:rgba(var(--tint,79,195,247),.08);}
#cvmodal .cv-opb:has(.cv-esc[aria-selected=true]){background:rgba(var(--tint,79,195,247),.12);
  box-shadow:inset 2px 0 0 var(--hi,#4fc3f7);}
#cvmodal .cv-op{display:grid; grid-template-columns:30px minmax(0,1fr) auto auto; gap:8px;
  align-items:center; min-width:0;}
#cvmodal .cv-op .ix{font-size:10px; color:var(--fg-dim,#9a9a9a); text-align:right;
  font-variant-numeric:tabular-nums;}
#cvmodal .cv-op .nm{min-width:0;}
#cvmodal .cv-op .n1{display:block; font-size:12px; overflow:hidden; text-overflow:ellipsis;
  white-space:nowrap;}
#cvmodal .cv-op .n1 i{font-style:normal; font-size:9px; letter-spacing:.06em;
  text-transform:uppercase; margin-left:6px; padding:0 4px; border-radius:3px;
  background:var(--warn-soft,rgba(255,213,79,.12)); color:var(--warn,#ffd54f);}
#cvmodal .cv-op .n2{display:block; font-size:10px; color:var(--fg-dim,#9a9a9a);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
#cvmodal .cv-op .tags{display:flex; align-items:center; gap:6px; justify-content:flex-end;
  min-width:0;}
#cvmodal .cv-op .fam, #cvmodal .cv-op .pk, #cvmodal .cv-op .mp{padding:1px 7px;
  border-radius:999px; font-family:var(--mono,Consolas,ui-monospace,monospace); white-space:nowrap;}
/* as pílulas usam os véus do --tint, como as da lib (.alx-row .pk/.mp), e a força do véu é
   a hierarquia: família mais apagada, código no meio, encapsulamento o mais forte */
/* a família é a que cede espaço: contexto, não identidade */
#cvmodal .cv-op .fam{font-size:10px; color:var(--fg-dim,#9a9a9a); min-width:0;
  overflow:hidden; text-overflow:ellipsis;
  box-shadow:inset 0 0 0 1px rgba(var(--tint,154,154,154),.16);}
#cvmodal .cv-op .pk{font-size:11px; color:var(--fg,#d8d8d8); background:rgba(var(--tint,79,195,247),.12);}
/* deduzido do footprint, não escrito no catálogo: pílula vazada diz a procedência */
#cvmodal .cv-op .pk.deduz{background:transparent; color:var(--fg-dim,#9a9a9a);
  box-shadow:inset 0 0 0 1px rgba(var(--tint,79,195,247),.30);}
#cvmodal .cv-op .mp{font-size:10px; color:var(--fg-dim,#9a9a9a);
  box-shadow:inset 0 0 0 1px rgba(var(--tint,79,195,247),.22);}
#cvmodal .cv-op .qt{font-size:11px; font-variant-numeric:tabular-nums; color:var(--ok,#00e676);
  min-width:46px; text-align:right;}
#cvmodal .cv-op .qt.zero{color:var(--fg-dim,#9a9a9a);}
#cvmodal .cv-sel .nada{font-size:12px; color:var(--fg-dim,#9a9a9a);}
#cvmodal .cv-trig, #cvmodal .cv-opb{display:flex; align-items:stretch; gap:4px; min-width:0;}
#cvmodal .cv-trig .cv-esc{border:1px solid var(--border,#3a3a3a); border-radius:3px;
  background:var(--panel2,#2d2d2d);}
#cvmodal .cv-trig.on .cv-esc{border-color:var(--accent,#4fc3f7);}
#cvmodal .cv-odoo{flex:none; align-self:center; font-size:10px; letter-spacing:.04em;
  padding:4px 8px; border-radius:3px; cursor:pointer; white-space:nowrap;
  text-decoration:none; border:1px solid var(--border,#3a3a3a);
  background:transparent; color:var(--fg-dim,#9a9a9a);}
#cvmodal .cv-odoo:hover{border-color:var(--accent,#4fc3f7); color:var(--accent,#4fc3f7);}
#cvmodal .cv-vai .pq{font-size:10px; color:var(--fg-dim,#9a9a9a); margin-top:2px;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
#cvmodal .cv-vai .alerta{font-size:10px; color:var(--warn,#ffd54f); margin-top:2px; white-space:normal;}
#cvmodal .cv-vai .busca{display:flex; gap:5px; margin-top:4px;}
#cvmodal .cv-vai button.lnk{margin-top:3px; padding:0; border:0; background:transparent;
  color:var(--fg-dim,#9a9a9a); font:10px var(--font,'Segoe UI',sans-serif); cursor:pointer;
  text-decoration:underline; text-underline-offset:2px;}
#cvmodal .cv-vai button.lnk:hover{color:var(--accent,#4fc3f7);}
#cvmodal .cv-vai .busca input{flex:1; min-width:0; background:var(--panel2,#2d2d2d);
  color:var(--fg,#d8d8d8); font:11px var(--font,'Segoe UI',sans-serif);
  border:1px solid var(--border,#3a3a3a); border-radius:3px; padding:2px 6px;}
#cvmodal .cv-achados{max-height:168px; overflow:auto; margin-top:3px;
  border:1px solid var(--border,#3a3a3a); border-radius:3px;}
#cvmodal .cv-achados button{display:block; width:100%; text-align:left; border:0;
  background:transparent; color:var(--fg,#d8d8d8); font:11px var(--font,'Segoe UI',sans-serif);
  padding:4px 7px; cursor:pointer;}
#cvmodal .cv-achados button:hover{background:rgba(var(--tint,79,195,247),.08);}
#cvmodal .cv-achados .fam{color:var(--fg-dim,#9a9a9a);}
#cvmodal .cv-conf{font-size:10px; text-align:right;}
#cvmodal .pill{display:inline-block; padding:1px 6px; border-radius:9px; font-size:10px;
  border:1px solid var(--border,#3a3a3a); color:var(--fg-dim,#9a9a9a);}
/* a confiança é STATUS, e status tem as três cores do modo (hub-tema.css): o verde, o âmbar e
   o vermelho do escuro são claros e os do claro são escuros, e é isso que as deixa legíveis nos
   dois. A baixa não tem cor de propósito — é palpite, não alarme. */
#cvmodal .pill.alta, #cvmodal .pill.ja{border-color:var(--ok,#2e7d32); color:var(--ok,#81c784);}
#cvmodal .pill.media{border-color:var(--warn,#ef6c00); color:var(--warn,#ffb74d);}
#cvmodal .pill.baixa{border-color:rgba(var(--tint,109,76,65),.28); color:var(--fg-dim,#bcaaa4);}
#cvmodal .pill.nada{border-color:var(--err,#b71c1c); color:var(--err,#ef9a9a);}
#cvmodal .cv-vazio{padding:26px 6px; text-align:center; color:var(--fg-dim,#9a9a9a); font-size:12px;}
#cvmodal .cv-aviso{font-size:11px; padding:7px 9px; border-radius:4px; margin:9px 0;
  border:1px solid var(--border,#3a3a3a); border-left:3px solid var(--warn,#ffd54f);
  background:var(--panel2,#2d2d2d); white-space:pre-wrap;}
#cvmodal .cv-aviso.ok{border-left-color:var(--ok,#00e676);}
#cvmodal .cv-aviso button{margin-left:9px;}
#cvmodal .cv-foot{display:flex; align-items:center; gap:10px; padding:10px 13px;
  border-top:1px solid var(--border,#3a3a3a); background:var(--panel2,#2d2d2d);}
#cvmodal .cv-foot .est{font-size:11px; color:var(--fg-dim,#9a9a9a); flex:1;
  overflow:hidden; text-overflow:ellipsis;}
/* o botão principal como o .btn-primary do hub e o OK do hub-dialog.js: CONTORNADO no destaque
   do tema, nunca preenchido (hub.html » .btn-primary) -- cheio fica o botão ligado de uma
   ferramenta, e os dois não podem se confundir */
#cvmodal .cv-foot button.pri{background:transparent; border-color:var(--hi,#4fc3f7);
  color:var(--hi,#4fc3f7);}
#cvmodal .cv-foot button.pri:hover:not(:disabled){background:rgba(var(--tint,216,216,216),0.10);}
`;

const $ = id => document.getElementById(id);
function el(tag, cls, text){
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const proj = () => (typeof SCH_P === 'string' && SCH_P) || '';

const ST = { aberto: false, rodando: false, linhas: [], cands: [], filtro: 'pend', busca: '',
             aplicados: 0, aberta: null };

/* os candidatos: SÓ o almoxarifado, pelo mesmo caminho que o seletor da folha usa. A
   biblioteca da casa fica de fora de propósito — é dela que se está saindo. */
function candidatos(){
  const gs = (window.HubAlmoxPick && HubAlmoxPick.grupos()) || [];
  const fora = [];
  for (const g of gs){
    const gg = { familia: g.familia, designator: (g.sym && g.sym.designator) || '' };
    for (const it of (g.valores || [])) fora.push(perfilDoValor(gg, it));
  }
  return fora;
}

/* ── quem JA e do almoxarifado ──
   Casar pelo NOME e o que havia, e o nome e a coisa mais instavel do acervo: medido nos 19
   projetos, 13 componentes carregam OdooId (ou seja, alguem ja os converteu) e 8 deles NAO
   casam por nome. Tres causas, todas reais:

     - o acervo RENOMEIA o valor. O D2 do DMB-DI231765_P2 tem "Supressor Transiente TVS
       CDSOT23-SM712" e o acervo hoje o chama de "(TVS) CDSOT23-SM712"; os R1-R4 do
       PAEL-DI261940 ficaram com o codigo do fabricante no nome, que saiu do nome do valor
       e virou etiqueta ao lado. Peca identica, dois textos.
     - o espelho tem valor com o acento gravado em UTF-8 dentro de um arquivo latin-1
       ("180 graus" do _DemoKit): o mesmo nome, byte diferente.
     - o nome simplesmente nunca foi igual.

   O resultado era o pior possivel: a peca CERTA aparecia em "a converter" com uma sugestao
   de trocar por outra coisa. O D2 vinha marcado para virar um BAV99 — um diodo duplo no
   lugar de um supressor TVS.

   O OdooId nao tem esse problema: e o id da variante no Odoo, o espelho o emite em todo
   valor e o AI-GUIDE o define como o que liga componente a produto SEM depender de texto.

   A CASA JA TEM UMA ROTINA PARA ISSO e ela mora no servidor: `_usos_do_valor` do
   symserver.py, com as "tres marcas" (OdooId; ValorId corroborado pelo texto; sym/comment).
   Esta aqui e a terceira implementacao da ideia e por isso segue a ordem de la — id antes de
   texto — em vez de inventar outra. As duas diferencas sao deliberadas e medidas:

     - NAO uso o ValorId. La ele vale corroborado; aqui nao vale nada: o `valores[].id` e por
       SIMBOLO (a bateria e a barra de pinos tem, as duas, um valor de id 1) e ja acusou o J1
       do _DemoKit como uso de uma BATERIA. Sem ele nao perco caso nenhum medido.

     - NAO uso `comment == label`. La um falso positivo e um aviso a mais; aqui ele ESCONDE da
       lista um componente que precisava ser convertido — custo invertido. Medido: 123
       componentes do corpus casariam so por essa marca, e eles sao justamente o alvo do
       painel. Os U1/U2 do DMB tem `sym` "88901bc343d40937cf0e66f0656714f" (simbolo da lib
       antiga) e comment "SN74HC245DWR", que por acaso e o nome de um valor do acervo: sao
       componentes A CONVERTER, e o painel ja os recomenda com confianca alta.

   Uma divergencia a mais, esta na precedencia: a rotina do servidor, quando o params TEM
   OdooId, decide so por ele. Aqui, se o OdooId nao casar, o nome ainda vale — a pergunta e
   outra ("esta peca ja e do almoxarifado?", e nao "esta peca e ESTE valor?"). Medido: 1 caso,
   o CI2 do DMB, com OdooId=67 que sumiu do acervo e `sym` que casa exato. Como esse ramo so
   aceita nome EXATO, o `almoxNome` sai igual ao `sym` e a linha "outro nome no acervo" nunca
   aparece por engano. */
function varreFolha(){
  ST.cands = candidatos();
  const nomes = new Map();
  const porOdoo = new Map();
  for (const c of ST.cands){
    if (!nomes.has(c.nome)) nomes.set(c.nome, c.nome);
    if (c.odooId && !porOdoo.has(c.odooId)) porOdoo.set(c.odooId, c.nome);
  }
  const comps = (window.__hubComponentes && window.__hubComponentes()) || [];
  ST.linhas = varre(comps, ST.cands, (c, perfil) => {
    const oid = (perfil && perfil.odooId) || paramsPlanos(c && c.params).ODOOID || '';
    /* o id vale mais que o nome: o nome muda, o id nao */
    if (oid && porOdoo.has(String(oid).trim())) return porOdoo.get(String(oid).trim());
    return nomes.get(String((c && c.sym) || '')) || '';
  });
  for (const ln of ST.linhas){ ln.busca = ''; ln.buscando = false; }
  return comps.length;
}

/* ── pintura ── */
const PASSA = {
  pend: ln => !ln.almox,
  marc: ln => !ln.almox && ln.marcado && ln.escolha,
  sem: ln => !ln.almox && !ln.escolha,
  tudo: () => true,
};
function visiveis(){
  const q = CX(ST.busca).trim();
  return ST.linhas.filter(ln => {
    if (!(PASSA[ST.filtro] || PASSA.tudo)(ln)) return false;
    if (!q) return true;
    const p = ln.perfil;
    return CX(p.sym + ' ' + p.fp + ' ' + p.comment + ' ' + ln.refs.join(' ')
              + ' ' + (ln.escolha ? ln.escolha.alvo.nome : '')).indexOf(q) >= 0;
  });
}

function pinta(){
  const box = $('cvLista');
  box.textContent = '';
  const hd = el('div', 'cv-row hd');
  hd.append(el('span'), el('span', null, 'designadores'), el('span', null, 'hoje no projeto'),
            el('span'), el('span', null, 'vira'), el('span', null, 'confiança'));
  box.append(hd);

  const lista = visiveis();
  if (!lista.length){
    box.append(el('div', 'cv-vazio', ST.linhas.length
      ? 'nenhuma linha neste filtro.'
      : 'esta folha não tem componentes.'));
    return;
  }
  for (const ln of lista) box.append(linha(ln));
  atualizaRodape();
}

function linha(ln){
  const row = el('div', 'cv-row' + (ln.almox ? ' ja' : ''));

  const cb = el('input');
  cb.type = 'checkbox';
  cb.checked = !!ln.marcado;
  cb.disabled = ln.almox || !ln.escolha;
  cb.title = ln.almox ? 'já é do almoxarifado' : 'trocar estes componentes';
  cb.addEventListener('change', () => { ln.marcado = cb.checked; atualizaRodape(); });
  row.append(cb);

  /* os designadores levam à peça na folha: conferir o que se vai trocar é metade do
     trabalho, e procurar "R47" no desenho à mão é a outra metade */
  const refs = el('div', 'cv-refs');
  for (const r of ln.refs.slice(0, 8)){
    const b = el('button', null, r);
    b.type = 'button';
    b.title = 'mostrar na folha';
    b.addEventListener('click', () => {
      if (window.__hubSelectComp) window.__hubSelectComp(r);
      fecha(true);
    });
    refs.append(b);
  }
  if (ln.refs.length > 8) refs.append(el('span', 'mais', '+' + (ln.refs.length - 8)));
  row.append(refs);

  /* QUEM DECIDE A TROCA É O VALOR E O CORPO, não o nome do símbolo. "CAP EL [ PTH ]" é o
     nome da família antiga e se repete em dezenas de linhas; o que muda de uma para a
     outra — "10uF", "Cap El 3mm L15 D7" — é o que a pessoa compara com a peça do
     almoxarifado ao lado. Estava ao contrário: o nome em 12px em cima e o valor em 10px
     cinza embaixo. */
  const hoje = el('div', 'cv-hoje');
  const c = ln.perfil.comment;
  /* comment que começa com "=" é fórmula do Altium: ela se resolve na folha, e o valor de
     verdade (quando veio no export) está no params */
  const valor = (c && c.charAt(0) !== '=') ? c : (ln.perfil.valorTxt || '');
  const chave = el('div', 'chave');
  /* SEM VALOR TAMBÉM É RESPOSTA. A linha que não tem valor é justo aquela em que trocar
     é arriscado (o comment é uma fórmula, ou o export não trouxe o Value): deixar o lugar
     do valor vazio faz a linha parecer só mais curta, e o footprint ao lado assume o
     destaque como se FOSSE o valor. */
  chave.append(valor ? el('span', 'val', valor) : el('span', 'val sem', 'sem valor'));
  chave.append(el('span', 'fp', ln.perfil.fp || 'sem footprint'));
  hoje.append(chave);
  const nm = [ln.perfil.sym || '(sem símbolo)'];
  if (ln.partes > ln.refs.length) nm.push(ln.partes + ' partes');
  hoje.append(el('div', 'nm', nm.join('  ·  ')));
  hoje.title = (valor ? valor : 'sem valor') + '  ·  ' + (ln.perfil.fp || 'sem footprint')
             + '  ·  ' + nm.join('  ·  ');
  row.append(hoje);

  row.append(el('div', 'seta', ln.almox ? '' : '→'));

  const vai = el('div', 'cv-vai');
  if (ln.almox){
    /* o nome do ACERVO, nao o da folha: quando os dois diferem e porque o valor foi
       renomeado, e esconder isso deixa a pessoa procurando na lib um nome que saiu de la */
    const atual = ln.almoxNome || ln.perfil.sym;
    vai.append(el('div', 'nm', atual));
    /* "outro nome", e nao "renomeada": as duas causas medidas produzem nomes diferentes
       para a MESMA peca, e so uma delas e renome. A outra e o acento gravado em UTF-8
       dentro do espelho latin-1 (o "180 graus" do _DemoKit), em que o nome nem mudou. */
    if (ln.almoxNome && ln.almoxNome !== ln.perfil.sym)
      vai.append(el('div', 'pq', 'mesma peça, outro nome no acervo — a folha ainda diz "'
        + ln.perfil.sym + '"'));
  } else {
    vai.append(seletor(ln));
    /* o estoque saiu daqui: ele agora está na própria linha da opção, no fim, como o dono
       pediu — repetir na linha de motivos era dizer duas vezes a mesma coisa */
    if (ln.escolha) vai.append(el('div', 'pq', ln.escolha.motivos.join(' · ')));
    if (ln.alerta) vai.append(el('div', 'alerta', '⚠ ' + ln.alerta));
    if (!ln.escolha) vai.append(semSugestao(ln));
    vai.append(busca(ln));
  }
  row.append(vai);

  const conf = el('div', 'cv-conf');
  conf.append(el('span', 'pill ' + (ln.almox ? 'ja' : ln.escolha ? ln.escolha.confianca : 'nada'),
                 ln.almox ? 'almox' : ln.escolha ? ln.escolha.confianca : 'nada'));
  row.append(conf);
  return row;
}

/* ── a etiqueta de encapsulamento ──
   A lib escreve o `pkgs` LITERAL, desempatado pelo footprint (schframe.js » buildAddList).
   Copiar a REGRA e não o resultado importa: o `encaps` deste arquivo é normalizado para a
   pontuação — ele escreve "TO-220" onde o catálogo diz "TO-220-2" — e usá-lo aqui faria as
   duas telas dizerem coisas diferentes sobre a mesma peça.

   Só que o literal sozinho não resolve o que o dono pediu: medido no espelho, 1683 dos 2545
   valores NÃO têm `pkgs`, e a etiqueta ficaria vazia em dois terços das opções — que é
   exatamente a queixa ("do jeito que tá não dá pra vê essas coisas"). Daí o segundo degrau:
   o encapsulamento DEDUZIDO do footprint, na pílula vazada em vez da cheia. A procedência
   fica visível sem precisar de legenda, e o catálogo continua sendo o único que fala pela
   pílula cheia. */
function encapDaOpcao(a){
  const pks = (a.pkgs || []).filter(x => String(x).trim());
  const fpl = String(a.fp || '').toLowerCase();
  const lit = pks.length <= 1 ? (pks[0] || '')
            : (pks.find(x => fpl.includes(String(x).toLowerCase())) || pks[0]);
  if (lit) return { txt: String(lit).trim(), literal: true };
  return { txt: String((a.encaps || [])[0] || '').trim(), literal: false };
}
/* ── o link da ficha no Odoo ──
   Mora no hub-odoolink.js desde que TODA tela com componente passou a ter o seu (pedido do
   dono, 2026-09-24): a base lida do `almoxIndex.fonte`, a ação 282 e a regra do `tmpl` estão
   lá, uma vez só. Aqui fica o atalho, e o desenho `.cv-odoo` deste modal. */
function linkOdoo(a){
  return (a && typeof HubOdooLink !== 'undefined') ? HubOdooLink.url(a.tmpl) : '';
}

/* o saldo como a lib o escreve: inteiro quando é inteiro */
function saldoTxt(n){
  const x = Number(n) || 0;
  return Math.round(x) === x ? String(x)
                             : x.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

/* A LINHA DE UMA OPÇÃO — a mesma leitura da lib, no vocabulário desta tela.
   O desenho é o do `.alx-row` (schframe.js » buildAddList): id, nome, etiquetas, saldo, na
   mesma grade 30px / 1fr / auto / auto. O CSS NÃO é reusado, e a razão era medida: os
   seletores `.alx-row` de schframe.html são crus e casariam aqui, mas os TOKENS deles
   (--tint, --hi, --text-2) estavam declarados em `#addmodal, #symmodal`, não no `:root`, e
   herdar a classe traria a grade certa com a paleta morta. Desde o hub-tema.css (2026-09-24)
   os tokens moram no `:root` e as pílulas daqui usam os mesmos véus de --tint da lib; juntar
   as duas classes ficou possível e não foi feito. */
function opcaoRow(a){
  const row = el('div', 'cv-op');
  row.append(el('span', 'ix', a.id != null ? String(a.id) : ''));

  const nm = el('span', 'nm');
  /* O QUE SE LÊ É O QUE SE GRAVA. `alvo.nome` é o texto que vai para o `sym` do
     schematic.js; o rótulo legível da lib difere dele em 1483 dos 2545 valores. Numa tela
     cuja função é conferir ANTES de aplicar, mostrar só o nome bonito e esconder o que será
     gravado troca a conferência por uma aposta. Os dois aparecem, e o gravado manda. */
  const n1 = el('span', 'n1', comGraus(a.nome));
  if (a.fora) n1.append(el('i', null, 'fora'));
  nm.append(n1);
  const leg = a.linha || a.rotulo || '';
  if (leg && leg !== a.nome) nm.append(el('span', 'n2', comGraus(leg)));
  row.append(nm);

  const tags = el('span', 'tags');
  /* A FAMÍLIA é a etiqueta que o dono pediu e a lib não tem — lá a lista já está DENTRO de
     uma família, aqui as 8 sugestões podem vir de famílias diferentes. É também a única que
     pode ser cortada: nome e código não identificam peça pela metade (a regra do commit das
     duas etiquetas), família identifica. */
  if (a.familia) tags.append(el('span', 'fam', a.familia));
  const enc = encapDaOpcao(a);
  if (enc.txt) tags.append(el('span', 'pk' + (enc.literal ? '' : ' deduz'), enc.txt));
  const cod = a.cod || a.mpn || '';
  if (cod) tags.append(el('span', 'mp', cod));
  row.append(tags);

  row.append(el('span', 'qt' + (a.saldo > 0 ? '' : ' zero'), saldoTxt(a.saldo)));
  row.title = a.nome + (leg && leg !== a.nome ? '\n' + leg : '')
            + '\n' + (a.familia || '') + (cod ? '  ·  ' + cod : '')
            + '  ·  ' + saldoTxt(a.saldo) + ' em estoque';
  return row;
}

/* ── o seletor ──
   Era um <select> nativo, e <option> não aceita HTML: etiqueta colorida dentro dele não
   existe. A lista própria é o preço de ver o que o dono pediu.

   EM FLUXO, NÃO FLUTUANDO. O painel se desdobra logo abaixo do gatilho, no mesmo molde do
   `.cv-achados` do "escolher outro…" que já vive neste arquivo. Nada de `position:fixed`: o
   `.cv-body` tem `overflow:auto` e uma lista absoluta seria cortada, o que obrigaria a
   z-index, a medir espaço na tela e a fechar no scroll. Desdobrar não depende de nada disso
   e funciona igual no toque.

   UMA SÓ ABERTA (`ST.aberta`), montada sob demanda: 368 linhas × 9 opções pré-montadas
   seriam mais de 3000 itens remontados a cada `pinta()`, que roda a cada troca. */
function seletor(ln){
  const fora = el('div', 'cv-sel');
  const opcoes = ln.sugestoes.slice();
  if (ln.escolha && opcoes.indexOf(ln.escolha) < 0) opcoes.unshift(ln.escolha);
  const aberta = ST.aberta === ln;

  /* BOTÃO DENTRO DE BOTÃO NÃO EXISTE. O "ver no Odoo" precisa ser clicável por conta
     própria, então a faixa é um <div> com dois botões lado a lado — o que escolhe ocupa a
     largura toda, o do Odoo fica no fim. Aninhar um no outro é HTML inválido e o navegador
     desmonta a árvore sozinho: some o clique de um dos dois, e não dá aviso nenhum. */
  const faixa = (alvo, onClick, cls, extra) => {
    const cx = el('div', cls);
    const b = el('button', 'cv-esc');
    b.type = 'button';
    b.append(alvo ? opcaoRow(alvo) : el('span', 'nada', '— não trocar —'));
    /* DEPOIS do append da linha: o `extra` acrescenta a seta, e ela tem de ser o último
       filho. Rodando antes, a seta virava o primeiro item da faixa e subia para cima do
       nome — que foi exatamente o que aconteceu na primeira tentativa. */
    if (extra) extra(b);
    b.addEventListener('click', onClick);
    cx.append(b);
    const url = linkOdoo(alvo);
    if (url){
      /* <a> DE VERDADE, e não um botão com window.open: assim o clique do meio abre em aba
         nova, o Ctrl+clique e o "copiar endereço do link" funcionam, e nenhum bloqueador de
         pop-up entra no caminho. O stopPropagation é o que impede o clique de escorrer para
         a faixa e trocar a escolha junto. */
      const o = el('a', 'cv-odoo', 'Odoo ↗');
      o.href = url;
      o.target = '_blank';
      o.rel = 'noopener';
      o.title = 'abrir a ficha de ' + alvo.nome + ' no Odoo'
              + (alvo.nItens > 1 ? '  (este valor junta ' + alvo.nItens + ' fichas; abre a primeira)' : '');
      o.addEventListener('click', e => e.stopPropagation());
      cx.append(o);
    }
    return cx;
  };

  fora.append(faixa(ln.escolha ? ln.escolha.alvo : null,
    () => { ST.aberta = aberta ? null : ln; pinta(); },
    'cv-trig' + (aberta ? ' on' : ''),
    b => { b.setAttribute('aria-haspopup', 'listbox');
           b.setAttribute('aria-expanded', String(aberta));
           b.append(el('span', 'seta', aberta ? '▴' : '▾')); }));
  if (!aberta) return fora;

  const lista = el('div', 'cv-opcoes');
  lista.setAttribute('role', 'listbox');
  const poe = (alvo, escolha) => lista.append(faixa(alvo, () => {
    ln.escolha = escolha;
    ln.marcado = !!escolha;
    ST.aberta = null;
    pinta();
  }, 'cv-opb', b => {
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', String(ln.escolha === escolha));
  }));
  poe(null, null);
  for (const o of opcoes) poe(o.alvo, o);
  fora.append(lista);
  /* Abrir numa linha do fim desdobrava a lista por baixo do rodapé, e ela só aparecia se a
     pessoa adivinhasse que precisava rolar. `block:'nearest'` rola o `.cv-body` o mínimo para
     caber e não faz nada quando a lista já está à vista — não rouba a rolagem de quem abriu
     uma linha do meio. Depois do append, senão não há o que medir. */
  setTimeout(() => { try { lista.scrollIntoView({ block: 'nearest' }); } catch (e) {} }, 0);
  return fora;
}

function semSugestao(ln){
  const box = el('div', 'pq');
  const perto = aproxima(ln.perfil, ST.cands, 3);
  if (!perto.length){
    box.textContent = 'nada compatível no almoxarifado — procure abaixo ou deixe como está';
    return box;
  }
  const p = ln.perfil.valor;
  box.textContent = 'o almoxarifado não tem esse valor. O mais perto: '
    + perto.map(x => x.alvo.rotulo).join(', ')
    + (p ? '' : '');
  return box;
}

/* a busca da linha: o almoxarifado inteiro, por texto. É a saída para tudo o que a
   recomendação não acerta — e ela existe em toda linha, não só nas sem sugestão. */
function busca(ln){
  const fora = el('div');
  /* A BUSCA SO APARECE QUANDO CHAMADA. Um campo de texto em cada uma das 368 linhas e ruido
     constante para uma acao ocasional: o que se le na linha e o que a peca VIRA, nao um
     formulario. */
  if (!ln.busca && !ln.buscando){
    const abrir = el('button', 'lnk', 'escolher outro…');
    abrir.type = 'button';
    abrir.addEventListener('click', () => { ln.buscando = true; pinta(); });
    fora.append(abrir);
    return fora;
  }
  const cx = el('div', 'busca');
  const i = el('input');
  i.type = 'text';
  i.placeholder = 'procurar no almoxarifado…';
  i.value = ln.busca || '';
  const achados = el('div', 'cv-achados');
  achados.hidden = true;

  const roda = () => {
    ln.busca = i.value;
    const q = CX(i.value).trim();
    achados.textContent = '';
    if (q.length < 2){ achados.hidden = true; return; }
    const qs = semSep(q);
    const hit = [];
    for (const b of ST.cands){
      if (hit.length >= 60) break;
      if (CX(b.nome + ' ' + b.rotulo + ' ' + b.familia).indexOf(q) >= 0
          || (b.mpn && semSep(b.mpn).indexOf(qs) >= 0)) hit.push(b);
    }
    if (!hit.length){
      const nada = el('button', null, 'nada com "' + i.value + '"');
      nada.type = 'button';
      nada.disabled = true;
      achados.append(nada);
    }
    for (const b of hit){
      const bt = el('button');
      bt.type = 'button';
      bt.append(document.createTextNode(b.nome + '  '));
      bt.append(el('span', 'fam', b.familia + (b.saldo > 0 ? '  ·  ' + b.saldo : '  ·  0')));
      bt.addEventListener('click', () => {
        const n = pontua(ln.perfil, b);
        const escolha = { alvo: b, pts: n ? n.pts : 0,
                          motivos: n ? n.motivos : ['escolhido à mão'],
                          confianca: n ? n.confianca : 'baixa' };
        if (!n) escolha.motivos = ['escolhido à mão'];
        ln.sugestoes = [escolha].concat(ln.sugestoes.filter(s => s.alvo !== b));
        ln.escolha = escolha;
        ln.marcado = true;
        ln.busca = '';
        pinta();
      });
      achados.append(bt);
    }
    achados.hidden = false;
  };
  i.addEventListener('input', roda);
  const x = el('button', null, '✕');
  x.type = 'button';
  x.title = 'fechar a busca';
  x.addEventListener('click', () => { ln.buscando = false; ln.busca = ''; pinta(); });
  cx.append(i, x);
  fora.append(cx, achados);
  if (ln.busca) roda();
  setTimeout(() => { try { i.focus(); } catch (e) {} }, 0);
  return fora;
}

function atualizaRodape(){
  const fora = ST.linhas.filter(l => !l.almox);
  const marc = fora.filter(l => l.marcado && l.escolha);
  const comps = marc.reduce((a, l) => a + l.partes, 0);
  const cont = (n, t) => { const e = $(n); if (e) e.textContent = t; };
  const ja = ST.linhas.filter(l => l.almox).reduce((x, l) => x + l.partes, 0);
  cont('cvCont', ST.linhas.length + ' tipos · '
       + ST.linhas.reduce((x, l) => x + l.partes, 0) + ' componentes · '
       + (ja ? ja + ' já do almoxarifado · ' : '')
       + fora.filter(l => !l.escolha).length + ' sem sugestão');
  cont('cvEstado', marc.length
    ? marc.length + (marc.length === 1 ? ' linha marcada' : ' linhas marcadas')
      + ' · ' + comps + (comps === 1 ? ' componente' : ' componentes')
    : 'nada marcado');
  const b = $('cvAplicar');
  if (b) b.disabled = !marc.length || ST.rodando;
}

/* ── aplicar ── */
async function aplica(){
  const marc = ST.linhas.filter(l => !l.almox && l.marcado && l.escolha);
  if (!marc.length) return;
  const comps = marc.reduce((a, l) => a + l.partes, 0);
  const baixas = marc.filter(l => l.escolha.confianca === 'baixa').length;
  const ok = await HubDialog.confirm(
    'Trocar ' + comps + ' componente' + (comps === 1 ? '' : 's') + ' por peças do almoxarifado'
    + (baixas ? ', ' + baixas + (baixas === 1 ? ' deles com recomendação de confiança baixa'
                                             : ' deles com recomendação de confiança baixa') : '')
    + '. O esquema muda aqui na tela; só o Salvar grava no arquivo.',
    { title: 'converter para o almoxarifado', ok: 'Trocar' });
  if (!ok) return;

  ST.rodando = true;
  atualizaRodape();
  const vinculos = marc.map(l => ({ componente: l.escolha.alvo.nome, refs: l.refs }));
  let r;
  try { r = window.__hubAplicaVinculos(vinculos); }
  catch (e){ r = { ok: false, erro: String((e && e.message) || e) }; }
  ST.rodando = false;

  if (!r || !r.ok){
    await HubDialog.alert('Não troquei nada: ' + ((r && r.erro) || 'a ponte do esquema não respondeu')
      + (r && r.recusados && r.recusados.length
         ? '\n\n' + r.recusados.map(x => '· ' + x.componente + ': ' + x.porque).join('\n') : ''),
      { title: 'a troca não seguiu' });
    atualizaRodape();
    return;
  }
  ST.aplicados += r.itens || 0;
  const conta = varreFolha();
  pinta();
  relatorio(r, conta);
}

function relatorio(r, conta){
  const box = $('cvLista');
  const av = el('div', 'cv-aviso ok');
  const linhas = [(r.itens || 0) + ' componente' + (r.itens === 1 ? '' : 's') + ' trocado'
                  + (r.itens === 1 ? '' : 's') + ' no esquema aberto — ainda sem salvar.'];
  if (r.soIdentidade && r.soIdentidade.length)
    linhas.push('multi-parte (só a identidade, o desenho fica): ' + r.soIdentidade.join('; '));
  if (r.desvios && r.desvios.length)
    linhas.push('resolveu por outro nome: ' + r.desvios.map(d => d.refs.join(',') + ' → ' + d.vira).join('; '));
  if (r.encaixes && r.encaixes.length)
    linhas.push(r.encaixes.length + ' componente(s) deslocado(s) para os pinos caírem onde estavam.');
  if (r.recusados && r.recusados.length)
    linhas.push('recusados: ' + r.recusados.map(x => x.componente + ' (' + x.porque + ')').join('; '));
  av.append(el('div', null, linhas.join('\n')));
  const b = el('button', 'pri', 'Salvar o esquema');
  b.type = 'button';
  b.addEventListener('click', async () => {
    b.disabled = true;
    const salvo = await salva();
    b.disabled = false;
    if (salvo){
      av.textContent = '';
      av.append(el('div', null, 'esquema salvo. ' + conta + ' componentes na folha.'));
    }
  });
  av.append(b);
  box.prepend(av);
}

/* reusa o botão de gravação do schframe em vez de reimplementar: ele relê o disco, pergunta
   se alguém gravou por cima e sabe cair no download quando o POST falha */
async function salva(){
  const btn = $('btnSave');
  if (!btn){
    await HubDialog.alert('Não achei o botão de salvar desta vista.', { title: 'sem salvar' });
    return false;
  }
  btn.click();
  for (let i = 0; i < 300 && window.__hubDirty && window.__hubDirty(); i++)
    await new Promise(r => setTimeout(r, 100));
  if (window.__hubDirty && window.__hubDirty()){
    HubDialog.toast('o esquema ainda tem alterações pendentes', 'warn', 6000);
    return false;
  }
  HubDialog.toast('esquema salvo', 'ok', 3000);
  return true;
}

/* ── abrir/fechar ── */
function abre(){
  if (ST.aberto) return;
  if (!window.__hubComponentes){
    HubDialog.alert('Esta vista do esquema é antiga e não expõe os componentes para o '
      + 'conversor. Recarregue a página (Ctrl+F5).', { title: 'sem ponte' });
    return;
  }
  const t0 = Date.now();
  const conta = varreFolha();
  ST.filtro = 'pend';
  ST.busca = '';
  $('cvBusca').value = '';
  marcaSeg();
  $('cvAlvo').textContent = proj() + ' · ' + conta + ' componentes · '
    + ST.cands.length + ' peças no almoxarifado · ' + (Date.now() - t0) + 'ms';
  ST.aberto = true;
  $('cvmodal').classList.add('on');
  pinta();
}
function fecha(quieto){
  if (!ST.aberto || ST.rodando) return;
  ST.aberto = false;
  $('cvmodal').classList.remove('on');
  if (!quieto && ST.aplicados && window.__hubDirty && window.__hubDirty())
    HubDialog.toast(ST.aplicados + ' troca(s) ainda sem salvar', 'warn', 6000);
}
function marcaSeg(){
  for (const b of document.querySelectorAll('#cvmodal .cv-seg button'))
    b.setAttribute('aria-pressed', String(b.dataset.f === ST.filtro));
}

function montaDom(){
  const st = el('style');
  st.textContent = CSS;
  document.head.appendChild(st);

  /* o botão: no #converte se a casca deu o âncora, senão no fim da aba Configurações */
  let sec = $('converte');
  if (!sec){
    const pane = $('pane-cfg');
    if (!pane) return false;
    sec = el('div', 'sec');
    sec.id = 'converte';
    pane.appendChild(sec);
  }
  sec.append(el('h2', null, 'Almoxarifado'));
  const b = el('button', 'wide');
  b.id = 'btnConverte';
  b.type = 'button';
  b.title = 'Lista os componentes que não são do almoxarifado e recomenda substitutos';
  b.append(el('span', null, '⇄ Converter para o almoxarifado'));
  sec.append(b, el('div', 'hint', 'compara comment, parâmetros, valor e footprint de cada '
    + 'componente com as peças do almoxarifado'));
  b.addEventListener('click', () => { if (!ST.rodando) abre(); });

  const m = el('div');
  m.id = 'cvmodal';
  m.innerHTML = ''
    + '<div class="cv-box" role="dialog" aria-modal="true" aria-labelledby="cvTitulo">'
    +   '<div class="cv-head">'
    +     '<h2 id="cvTitulo">Converter para o almoxarifado</h2>'
    +     '<span class="alvo" id="cvAlvo"></span>'
    +     '<button type="button" id="cvFechar" title="Fechar (Esc)">✕</button>'
    +   '</div>'
    +   '<div class="cv-bar">'
    +     '<div class="cv-seg">'
    +       '<button type="button" data-f="pend">a converter</button>'
    +       '<button type="button" data-f="marc">marcados</button>'
    +       '<button type="button" data-f="sem">sem sugestão</button>'
    +       '<button type="button" data-f="tudo">tudo</button>'
    +     '</div>'
    +     '<input type="text" id="cvBusca" placeholder="filtrar por designador, símbolo, valor…">'
    +     '<span class="cv-cont" id="cvCont"></span>'
    +   '</div>'
    +   '<div class="cv-body"><div id="cvLista"></div></div>'
    +   '<div class="cv-foot">'
    +     '<button type="button" id="cvMarcaTudo">Marcar as de confiança alta</button>'
    +     '<span class="est" id="cvEstado"></span>'
    +     '<button type="button" class="pri" id="cvAplicar" disabled>Aplicar</button>'
    +   '</div>'
    + '</div>';
  document.body.appendChild(m);

  $('cvFechar').addEventListener('click', () => fecha());
  m.addEventListener('mousedown', e => { if (e.target === m) fecha(); });
  $('cvAplicar').addEventListener('click', aplica);
  $('cvBusca').addEventListener('input', () => { ST.busca = $('cvBusca').value; pinta(); });
  for (const bt of m.querySelectorAll('.cv-seg button'))
    bt.addEventListener('click', () => { ST.filtro = bt.dataset.f; marcaSeg(); pinta(); });
  $('cvMarcaTudo').addEventListener('click', () => {
    for (const ln of ST.linhas)
      if (!ln.almox && ln.escolha && ln.escolha.confianca === 'alta') ln.marcado = true;
    pinta();
  });

  /* Na BOLHA do document: os atalhos da folha (W, G, L, Del) moram num listener de window e
     só recebem a tecla depois daqui — e o HubDialog, que é de captura, continua ganhando
     quando abre por cima (o Esc do "tem certeza?" não fecha o painel atrás). */
  document.addEventListener('keydown', e => {
    if (!ST.aberto) return;
    e.stopPropagation();
    /* PRECEDÊNCIA EXPLÍCITA, um handler só: o Esc fecha primeiro a lista de opções aberta e
       só depois o painel. Registrar um listener novo para a lista criaria a mesma disputa de
       fase que este bloco existe para evitar. */
    if (e.key === 'Escape'){
      if (ST.aberta){ e.preventDefault(); ST.aberta = null; pinta(); return; }
      if (!ST.rodando){ e.preventDefault(); fecha(); }
    }
  });
  return true;
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montaDom);
else montaDom();

return { abre, fecha, estado: ST, pure: PURO };
})();
if (typeof module === 'object' && module.exports) module.exports = HubConverte;
