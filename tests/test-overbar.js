const assert = require('assert');
const { loadVar } = require('./load');
const O = require('../hub-overbar.js');

/* ═══════════════ nome de pino ativo-baixo ═══════════════
   A regra vale por leitura de acervo, nao por gosto: o que barra sao as 54+128 ocorrencias
   da notacao nativa (R\S\T\) e as tres com barra normal abrindo o nome (/CS /RST /WP). O
   que NAO pode barrar e a barra do MEIO — 258 pinos em schlib.js e 485 em symbols-lib.js
   sao separador de funcao alternativa, e barrar esses seria pior que nao fazer nada.
   Os nomes crus deste arquivo tem de ser escritos com '\\' em literal JS: o que se mede e
   sempre a string de UM caractere barra invertida. */

const B = '\\';
const trechos = n => O.parse(n).map(t => (t.bar ? '[' + t.txt + ']' : t.txt)).join('');

/* ── (a) nativa do Altium: cada caractere SEGUIDO de barra invertida ── */
assert.strictEqual(trechos('R\\S\\T\\'), '[RST]');
assert.strictEqual(trechos('A\\B'), '[A]B', 'so o A leva barra; o B nao tem marcador');
assert.strictEqual(trechos('C\\S\\'), '[CS]');
/* o marcador nunca e desenhado */
assert.ok(!O.parse('R\\S\\T\\').some(t => t.txt.indexOf(B) >= 0), 'a barra invertida nao pode sobrar no texto');

/* ── (a) misturada com barra normal: a notacao nativa manda, a barra normal vira letra ── */
assert.strictEqual(trechos('GP3/M\\C\\L\\R\\'), 'GP3/[MCLR]');
assert.strictEqual(trechos('RE1/AN6/W\\R\\'), 'RE1/AN6/[WR]');
assert.strictEqual(trechos('DIN/C\\O\\N\\F\\I\\G\\/DIO14'), 'DIN/[CONFIG]/DIO14');

/* ── (b) malformados: barra invertida SOBRANDO na frente (13 nos dois espelhos) ── */
assert.strictEqual(trechos('\\M\\C\\L\\R\\'), '[MCLR]');
assert.strictEqual(trechos('\\R\\E\\S\\E\\T\\'), '[RESET]');
assert.strictEqual(trechos('\\S\\H\\D\\N\\'), '[SHDN]');
/* o malformado nao pode desenhar diferente do gemeo bem formado, que existe no MESMO
   acervo: \M\C\L\R\/VPP e M\C\L\R\/VPP sao o mesmo pino do mesmo PIC */
assert.deepStrictEqual(O.parse('\\M\\C\\L\\R\\/VPP'), O.parse('M\\C\\L\\R\\/VPP'));
assert.strictEqual(trechos('\\M\\C\\L\\R\\/VPP'), '[MCLR]/VPP', 'o /VPP e separador, nao barra');

/* ── (c) barra normal antes de CADA caractere ── */
assert.strictEqual(trechos('/O/E'), '[OE]');
assert.strictEqual(trechos('/A/B/C'), '[ABC]');

/* ── (d) barra normal UMA vez, abrindo o nome inteiro (os tres que existem no acervo) ── */
assert.strictEqual(trechos('/CS'), '[CS]');
assert.strictEqual(trechos('/RST'), '[RST]');
assert.strictEqual(trechos('/WP'), '[WP]');

/* ── (e) o resto e literal. Este e o bloco que decide se vale a pena ter a funcao ── */
for (const n of ['IO21/SDA', 'IO22/SCL', 'VP/IO36', 'VN/IO39', 'N/C', 'RC6/TX/CK',
                 'PRESET /  ENABLE', 'RA2/AN2/VREF-/CVREF', '3,3V/OUT', '/AB/C', '//', '/'])
  assert.strictEqual(trechos(n), n, 'tem de ficar literal: ' + n);

/* vazio e nulo nao podem explodir nem inventar trecho */
assert.deepStrictEqual(O.parse(''), []);
assert.deepStrictEqual(O.parse(null), []);
assert.strictEqual(O.plain(undefined), '');

/* ── (f) nome feito SO de marcador: mostra o cru, nunca some ──
   '\' sozinho caia no ramo (a), perdia a barra como marcador e sobrava NADA: parse dava [],
   plain dava '', o canvas nao desenhava e a celula da ficha ficava em branco — o pino
   mostrava a barra ANTES da conversao existir. Zero ocorrencias nos espelhos de hoje (a
   medicao no fim deste arquivo continua passando), entao e robustez; mas perda silenciosa
   de informacao nao se deixa passar so porque o dado de hoje nao a provoca. */
assert.deepStrictEqual(O.parse(B), [{ txt: B, bar: false }], 'sem nada barravel, o cru');
assert.deepStrictEqual(O.parse(B + B), [{ txt: B + B, bar: false }]);
assert.deepStrictEqual(O.parse(B + B + B), [{ txt: B + B + B, bar: false }]);
assert.strictEqual(O.plain(B), B, 'a busca ve a barra, e nao uma string vazia');
assert.strictEqual(O.plain(B + B), B + B);
assert.strictEqual(O.temBarra(B), false, 'marcador sem caractere nao barra nada');
assert.strictEqual(O.html(B), B, 'sem span, mas tambem sem sumir');
assert.strictEqual(O.unicode(B), B);
/* e o texto nao pode voltar dobrado nem mutilado: o cru sai igual ao que entrou */
for (const n of [B, B + B, B + B + B])
  assert.strictEqual(O.parse(n).map(t => t.txt).join(''), n, 'o cru sai inteiro: ' + JSON.stringify(n));

/* ── o ESP32 30pin: 21 usos no acervo e os quatro casos de (e) de uma vez ── */
const symlib = loadVar('Libs/symbols-lib.js', 'symbolsLib');
const esp = symlib.symbols.find(s => s.name === 'ESP32 30pin');
assert.ok(esp, 'o simbolo "ESP32 30pin" precisa existir em Libs/symbols-lib.js');
for (const p of esp.pins)
  assert.ok(!O.temBarra(p.name), 'nenhum pino do ESP32 30pin pode barrar, e "' + p.name + '" barrou');

/* ── plain(): e o que a busca compara ── */
assert.strictEqual(O.plain('R\\S\\T\\'), 'RST');
assert.ok(O.plain('R\\S\\T\\').includes('RST'), 'procurar RST tem de achar R\\S\\T\\');
assert.strictEqual(O.plain('\\M\\C\\L\\R\\/VPP'), 'MCLR/VPP');
assert.strictEqual(O.plain('/CS'), 'CS');
assert.strictEqual(O.plain('IO21/SDA'), 'IO21/SDA', 'o separador FICA: e parte do nome');
assert.strictEqual(O.temBarra('IO21/SDA'), false);
assert.strictEqual(O.temBarra('R\\S\\T\\'), true);

/* ── html(): escape antes de qualquer coisa ── */
assert.strictEqual(O.html('A<b>&"x"'), 'A&lt;b&gt;&amp;&quot;x&quot;');
/* '<' vem seguido de barra invertida, entao ele TAMBEM e barrado (regra (a) nao olha se o
   caractere e letra) — o que interessa aqui e que o escape vale dentro e fora do span */
assert.strictEqual(O.html('<\\i\\>'), '<span class="ovb">&lt;i</span>&gt;');
assert.strictEqual(O.html('R\\S\\T\\'), '<span class="ovb">RST</span>');
assert.strictEqual(O.html('IO21/SDA'), 'IO21/SDA', 'literal nao ganha span');

/* ── node(): o caminho que a tabela de pinos da vista Esquema usa. Vale um document de
      mentira porque e justamente por AQUI que se escapa de innerHTML — se um dia node()
      passar a montar string, este teste e que diz. ── */
global.document = {
  head: null,
  createElement(tag) { return { tag: tag, className: '', textContent: '', filhos: [] }; },
  createTextNode(t) { return { tag: '#text', textContent: t }; },
  createDocumentFragment() { return { tag: '#frag', filhos: [], appendChild(n) { this.filhos.push(n); } }; },
};
const frag = O.node('GP3/M\\C\\L\\R\\');
assert.deepStrictEqual(frag.filhos.map(n => n.tag), ['#text', 'span']);
assert.strictEqual(frag.filhos[0].textContent, 'GP3/');
assert.strictEqual(frag.filhos[1].className, 'ovb');
assert.strictEqual(frag.filhos[1].textContent, 'MCLR');
assert.deepStrictEqual(O.node('IO21/SDA').filhos.map(n => n.tag), ['#text'], 'literal nao vira span');
/* (f) no DOM: fragmento vazio e a celula em branco da ficha */
const soMarc = O.node(B);
assert.deepStrictEqual(soMarc.filhos.map(n => n.tag), ['#text'], 'so marcador vira texto, nao fragmento vazio');
assert.strictEqual(soMarc.filhos[0].textContent, B);
delete global.document;

/* ── unicode(): a previa que cabe num title, que so aceita texto puro ── */
assert.strictEqual(O.unicode('R\\S\\T\\'), 'R̅S̅T̅');
assert.strictEqual(O.unicode('IO21/SDA'), 'IO21/SDA');

/* ── canvas(): sem text-decoration, a barra e fillRect — e o textAlign do chamador manda ──
   ctx de mentira com largura fixa por caractere, para a conta de alinhamento ficar visivel */
function ctxFake(align) {
  return {
    font: '10px x', textAlign: align, textBaseline: 'middle', fills: [], rects: [],
    measureText(t) { return { width: t.length * 2, actualBoundingBoxAscent: 3.6 }; },
    fillText(t, x, y) { this.fills.push([t, x, y]); },
    fillRect(x, y, w, h) { this.rects.push([x, y, w, h]); },
  };
}
const esq = ctxFake('left');
assert.strictEqual(O.canvas(esq, 'R\\S\\T\\', 0, 0), 6, 'devolve a largura total desenhada');
assert.deepStrictEqual(esq.fills, [['RST', 0, 0]]);
assert.strictEqual(esq.rects.length, 1);
assert.strictEqual(esq.rects[0][0], 0);
assert.strictEqual(esq.rects[0][2], 6, 'a barra cobre o trecho inteiro');
assert.ok(esq.rects[0][3] > 0, 'espessura proporcional a fonte');
assert.ok(esq.rects[0][1] + esq.rects[0][3] <= -3.6, 'a barra fica ACIMA das maiusculas');
assert.strictEqual(esq.textAlign, 'left', 'o textAlign do chamador volta intacto');

const cen = ctxFake('center');
O.canvas(cen, 'R\\S\\T\\', 0, 0);
assert.deepStrictEqual(cen.fills, [['RST', -3, 0]], 'center desloca meia largura');
assert.strictEqual(cen.textAlign, 'center');

const dir = ctxFake('right');
O.canvas(dir, 'R\\S\\T\\', 0, 0);
assert.deepStrictEqual(dir.fills, [['RST', -6, 0]], 'right desloca a largura inteira');

/* misto: dois trechos em sequencia, barra so no segundo */
const mix = ctxFake('center');
O.canvas(mix, 'GP3/M\\C\\L\\R\\', 0, 0);
assert.deepStrictEqual(mix.fills, [['GP3/', -8, 0], ['MCLR', 0, 0]]);
assert.strictEqual(mix.rects.length, 1);
assert.deepStrictEqual([mix.rects[0][0], mix.rects[0][2]], [0, 8], 'a barra cobre so o MCLR');

/* fonte maior = barra mais grossa e mais alta (o footprint desenha com fonte 0.3 mm) */
const gr = ctxFake('left'); gr.font = '40px x';
O.canvas(gr, 'R\\S\\T\\', 0, 0);
assert.ok(gr.rects[0][3] > esq.rects[0][3], 'a espessura acompanha o tamanho da fonte');

/* nome literal nao desenha barra nenhuma */
const lit = ctxFake('left');
O.canvas(lit, 'IO21/SDA', 0, 0);
assert.deepStrictEqual(lit.fills, [['IO21/SDA', 0, 0]]);
assert.strictEqual(lit.rects.length, 0);

/* (f) no canvas: so marcador desenhava NADA (largura 0, nenhum fillText) */
const marc = ctxFake('left');
assert.ok(O.canvas(marc, B, 0, 0) > 0, 'so marcador tem de ocupar largura');
assert.deepStrictEqual(marc.fills, [[B, 0, 0]], 'desenha o cru');
assert.strictEqual(marc.rects.length, 0, 'e sem barra: nao ha o que barrar');
/* nome vazio, esse sim, nao desenha nada */
const nada = ctxFake('left');
assert.strictEqual(O.canvas(nada, '', 0, 0), 0);
assert.deepStrictEqual(nada.fills, []);

/* ── a medicao dos dois espelhos, presa no teste: a regra (e) tem de deixar a esmagadora
      maioria dos nomes com barra normal SEM barra nenhuma ── */
const schlib = loadVar('Libs/schlib.js', 'schlib');
const nomes = [];
for (const s of schlib.symbols) for (const p of (s.parts || [])) for (const pin of (p.pins || [])) nomes.push(String(pin.name || ''));
for (const s of symlib.symbols) for (const pin of (s.pins || [])) nomes.push(String(pin.name || ''));
const barrados = nomes.filter(n => O.temBarra(n)).length;
const comBarraNormal = nomes.filter(n => n.indexOf('/') >= 0 && n.indexOf(B) < 0);
const barraNormalIntacta = comBarraNormal.filter(n => !O.temBarra(n)).length;

/* A PROPRIEDADE, essa e cravada em ZERO e nao depende de acervo nenhum: separador do MEIO
   (IO21/SDA, VP/IO36, N/C) nunca barra. Se um dia um deles aparecer aqui, a regra (e)
   quebrou — e e esse o estrago que esta funcao existe para nao causar. */
const meioBarrado = comBarraNormal.filter(n => n.charAt(0) !== '/' && O.temBarra(n));
assert.deepStrictEqual(meioBarrado, [], 'separador do meio nao pode barrar: ' + meioBarrado.join(' | '));
/* e quem barra e sempre quem a barra ABRE — /CS, /RST, /WP */
for (const n of comBarraNormal.filter(n => O.temBarra(n)))
  assert.ok(n.charAt(0) === '/', 'so barra quem comeca com barra, e "' + n + '" nao comeca');

/* Ja os NUMEROS entram como faixa larga, de proposito: os dois espelhos sao regenerados
   (o symbols-lib.js mudou de simbolos e ganhou descricoes no meio desta rodada) e uma
   contagem cravada quebraria a cada sync sem que a regra tivesse mudado. A faixa so
   garante que os espelhos foram mesmo lidos e que a notacao nativa continua sendo a
   minoria que se barra — quem guarda o comportamento e a propriedade acima. */
assert.ok(nomes.length > 3000, 'os dois espelhos precisam ter sido lidos: nomes=' + nomes.length);
assert.ok(barrados > 100 && barrados < nomes.length * 0.15,
  'a notacao nativa e uma minoria dos pinos: barrados=' + barrados + ' de ' + nomes.length);
assert.ok(comBarraNormal.length > 100, 'comBarraNormal=' + comBarraNormal.length);
assert.ok(barraNormalIntacta / comBarraNormal.length > 0.95,
  'quase todo nome com barra normal e separador e tem de ficar literal: ' +
  barraNormalIntacta + '/' + comBarraNormal.length);

console.log('test-overbar OK — ' + barrados + ' pinos barrados nos dois espelhos, ' +
            barraNormalIntacta + '/' + comBarraNormal.length + ' com barra normal intactos, ' +
            nomes.length + ' nomes lidos');
