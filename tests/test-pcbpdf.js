const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const W = require('../hub-pdfwriter.js');
const P = require('../hub-pcbpdf.js');
const C = require('../hub-pcbpdf-carimbo.js');
const HubCore = require('../hub-core.js');
const { loadVar } = require('./load.js');

/* O PDF de layout do hub (hub-pdfwriter.js + hub-pcbpdf.js). O PDF e lido de volta pelo leitor
   minimo do proprio escritor (HubPdfWriter.le: startxref, cada offset do xref, trailer, /Length
   de cada stream e a arvore Catalog -> Pages -> Page) e os conteudos sao descomprimidos com o
   zlib para conferir o que foi desenhado. No fim, o PDF do DMB e gravado em
   $HUB_PDF_SAIDA (se a variavel existir) para conferir no olho. */

let n = 0;
const t = (nome, fn) => { fn(); n++; process.stdout.write('.'); void nome; };
const perto = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= (tol == null ? 1e-6 : tol), (msg || '') + ': ' + a + ' != ' + b);

function conteudos(bytes) {
  const r = W.le(bytes);
  assert.deepStrictEqual(r.erros, [], 'estrutura do PDF');
  return { r, pags: r.paginas.map(p => {
    const o = r.objetos[p.conteudo];
    const cru = /\/FlateDecode/.test(o.dic) ? zlib.inflateSync(Buffer.from(o.stream)) : Buffer.from(o.stream);
    return cru.toString('latin1');
  }) };
}

/* ---------------- escritor ---------------- */

t('pdf minimo valido', () => {
  const doc = W.novo({ titulo: 'Teste ç', data: new Date(2026, 0, 2, 3, 4, 5) });
  const pg = doc.pagina(297, 210);
  pg.corTraco('#ff0000').espessura(0.5).move(10, 10).reta(100, 100).traca();
  pg.texto(20, 20, 'MARCAÇÃO (ok) \\ é', { fonte: 'Times-Roman', tam: 3 });
  const b = doc.bytes({ deflate: null });
  const s = Buffer.from(b).toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4\n'));
  assert.ok(/%%EOF\n$/.test(s));
  const { r, pags } = conteudos(b);
  assert.strictEqual(r.paginas.length, 1);
  perto(r.paginas[0].mediaBox[2], 841.8898, 1e-3, 'A4 largura em pt');
  perto(r.paginas[0].mediaBox[3], 595.2756, 1e-3, 'A4 altura em pt');
  /* WinAnsi: C cedilha = 307, A til = 303, e agudo = 351; parenteses e barra escapados */
  assert.ok(pags[0].indexOf('(MARCA\\307\\303O \\(ok\\) \\\\ \\351)') >= 0, pags[0]);
  assert.ok(/\/BaseFont \/Times-Roman \/Encoding \/WinAnsiEncoding/.test(s));
  assert.ok(s.indexOf('/Title (Teste \\347)') >= 0);
});

t('compressao flate e leitor', () => {
  const doc = W.novo();
  const pg = doc.pagina(420, 297);
  for (let i = 0; i < 300; i++) pg.move(i, 0).reta(i, 100);
  pg.traca();
  const b = doc.bytes();
  const s = Buffer.from(b).toString('latin1');
  assert.ok(/\/Filter \/FlateDecode/.test(s), 'comprimido no node');
  const { r, pags } = conteudos(b);
  perto(r.paginas[0].mediaBox[2], 420 * 72 / 25.4, 1e-3, 'A3');
  assert.ok(pags[0].indexOf('299 100 l') >= 0);
});

t('leitor acusa xref quebrado', () => {
  const doc = W.novo(); doc.pagina(100, 100).retangulo(0, 0, 1, 1).traca();
  const b = Buffer.from(doc.bytes({ deflate: null }));
  const s = b.toString('latin1').replace('%PDF-1.4\n', '%PDF-1.4\n%x\n');
  assert.ok(W.le(Buffer.from(s, 'latin1')).erros.length > 0);
});

t('arco em bezier fica no circulo', () => {
  const a = W.fatiasArco(5, 5, 10, 0, 270, false);
  assert.strictEqual(a.fatias.length, 3);
  let ini = a.ini;
  for (const f of a.fatias) {
    perto(Math.hypot(f[4] - 5, f[5] - 5), 10, 1e-9, 'ponta no raio');
    /* ponto medio da cubica: erro de raio < 0,03% */
    const m = [0, 1].map(k => (ini[k] + 3 * f[k] + 3 * f[2 + k] + f[4 + k]) / 8);
    perto(Math.hypot(m[0] - 5, m[1] - 5), 10, 10 * 3e-4, 'meio da fatia no raio');
    ini = [f[4], f[5]];
  }
  const b = W.fatiasArco(0, 0, 1, 90, 0, true);
  assert.strictEqual(b.fatias.length, 1);
  perto(b.fatias[0][4], 1, 1e-12); perto(b.fatias[0][5], 0, 1e-12);
});

t('larguras do AFM', () => {
  perto(W.larguraTexto('DESEN.', 'Times-Roman', 1), 3.472, 1e-9, 'DESEN. em Times');
  perto(W.larguraTexto('Ação', 'Helvetica', 10), (667 + 500 + 556 + 556) / 100, 1e-9, 'acento cai na letra base');
  assert.strictEqual(W.codigoWin('€'), 0x80);
  assert.strictEqual(W.codigoWin('ç'), 0xe7);
  assert.strictEqual(W.codigoWin('Ω'), 63);
});

t('imagem rgb com alfa', () => {
  const doc = W.novo();
  const im = doc.imagem({ w: 2, h: 2, rgb: new Uint8Array(12).fill(200), alfa: new Uint8Array([0, 255, 255, 0]) });
  doc.pagina(50, 50).imagem(im, 1, 1, 10, 10);
  const b = doc.bytes();
  const s = Buffer.from(b).toString('latin1');
  assert.ok(/\/Subtype \/Image \/Width 2 \/Height 2 \/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/SMask \d+ 0 R/.test(s));
  assert.ok(/\/ColorSpace \/DeviceGray/.test(s));
  const { pags } = conteudos(b);
  assert.ok(pags[0].indexOf('/Im1 Do') >= 0);
});

/* ---------------- escala ---------------- */

t('escalas redondas', () => {
  assert.strictEqual(P.rotuloEscala(1), '1:1');
  assert.strictEqual(P.rotuloEscala(1.5), '3:2');
  assert.strictEqual(P.rotuloEscala(2), '2:1');
  assert.strictEqual(P.rotuloEscala(1.27), '1,27:1');
  assert.strictEqual(P.rotuloEscala(0.5), '1:2');
  assert.strictEqual(P.leEscala('3:2'), 1.5);
  assert.strictEqual(P.leEscala('1,27:1'), 1.27);
  assert.strictEqual(P.leEscala('x'), null);
  assert.strictEqual(P.escalaQueCabe(100, 50, 160, 160), 1.5);
  assert.strictEqual(P.escalaQueCabe(100, 50, 99, 160), 0.75);
});

/* ---------------- carimbo extraido ---------------- */

t('carimbo do template', () => {
  assert.strictEqual(C.folha.w, 297); assert.strictEqual(C.folha.h, 210); assert.strictEqual(C.folha.margem, 5);
  const textos = C.textos.map(x => x.s);
  for (const k of ['ARQUIVO:', 'R.', 'FL.', 'DESEN.', 'VERIF.', 'APROV.', 'EQUIPAMENTO:', 'DESENHO:', 'ESCALA:', 'FORMATO:',
                   '=Arquivo', '=Escala', '=Formato', '=Data_desenho', '=SheetNumber', '=SheetTotal'])
    assert.ok(textos.indexOf(k) >= 0, 'falta ' + k);
  /* o retangulo do carimbo encosta na moldura: 178 x 20 mm no canto de baixo a direita */
  const r = C.retangulos[0];
  perto(r[0] + r[2], 292, 1e-3); perto(r[1], 5, 1e-3); perto(r[2], 178, 1e-3); perto(r[3], 20, 1e-3);
  assert.strictEqual(C.imagens.length, 1);
  const lg = C.imagens[0];
  assert.strictEqual(lg.pw, 801); assert.strictEqual(lg.ph, 113);
  assert.strictEqual(zlib.inflateSync(Buffer.from(lg.rgbFlate, 'base64')).length, 801 * 113 * 3);
});

/* ---------------- placa sintetica ---------------- */

function placa() {
  return {
    format: 'pcbmirror-v1', source: 'C:\\x\\PTESTE - DI260001.PcbDoc', units: 'mm',
    board: { bbox: { x1: 0, y1: 0, x2: 40, y2: 30 }, outline: [
      { kind: 'line', x1: 0, y1: 0, x2: 40, y2: 0 }, { kind: 'line', x1: 40, y1: 0, x2: 40, y2: 25 },
      { kind: 'arc', cx: 35, cy: 25, r: 5, sa: 0, ea: 90 }, { kind: 'line', x1: 35, y1: 30, x2: 0, y2: 30 },
      { kind: 'line', x1: 0, y1: 30, x2: 0, y2: 0 }] },
    layers: [{ key: 'Mech13', name: 'Top 3D Body' }, { key: 'Mech14', name: 'Bottom 3D Body' }],
    components: [
      { id: 'c1', ref: 'R1', footprint: 'R0805', layer: 'Top', x: 10, y: 10, rot: 0, bbox: { x1: 8, y1: 9, x2: 12, y2: 11 },
        pads: [{ id: 'c1p1', name: '1', layer: 'Top', type: 'smd', shape: 'rect', x: 9, y: 10, w: 1, h: 1.2, rot: 0 },
               { id: 'c1p2', name: '2', layer: 'Top', type: 'smd', shape: 'roundrect', x: 11, y: 10, w: 1, h: 1.2, rot: 0, radius: 0.2 }] },
      { id: 'c2', ref: 'J1', footprint: 'PH', layer: 'Bottom', x: 30, y: 15, rot: 90, bbox: { x1: 28, y1: 12, x2: 32, y2: 18 },
        pads: [{ id: 'c2p1', name: '1', layer: 'Multi', type: 'th', shape: 'circle', x: 30, y: 15, w: 3, h: 3, drill: 2 }] },
    ],
    freepads: [], tracks: [{ id: 't1', layer: 'Top', x1: 9, y1: 10, x2: 30, y2: 15, w: 0.5 }], arcs: [],
    vias: [{ id: 'v1', x: 20, y: 20, size: 0.6, drill: 0.3 }],
    texts: [
      { id: 'x1', layer: 'TopOverlay', x: 10, y: 12.5, text: 'R1', h: 1, rot: 0, mirror: false, designator: true, owner: 'R1' },
      { id: 'x2', layer: 'TopOverlay', x: 20, y: 5, text: 'REV. B', h: 1.5, rot: 0, mirror: false },
      { id: 'x3', layer: 'BottomOverlay', x: 30, y: 20, text: 'J1', h: 1, rot: 0, mirror: true, designator: true, owner: 'J1',
        polys: [{ pts: [[29, 19.5], [31, 19.5], [31, 20.5], [29, 20.5]] }, { hole: true, pts: [[29.5, 19.8], [30.5, 19.8], [30.5, 20.2], [29.5, 20.2]] }] },
    ],
    silk: [{ id: 's1', layer: 'TopOverlay', kind: 'line', x1: 8, y1: 9, x2: 12, y2: 9, w: 0.15, owner: 'R1' },
           { id: 's2', layer: 'TopOverlay', kind: 'arc', cx: 25, cy: 10, r: 2, sa: 0, ea: 360, w: 0.2 }],
    lines: [{ id: 'l1', layer: 'Mech13', kind: 'line', x1: 8.5, y1: 9.3, x2: 11.5, y2: 9.3, w: 0.05, owner: 'R1' },
            { id: 'l2', layer: 'Mech14', kind: 'line', x1: 28.5, y1: 12.5, x2: 31.5, y2: 12.5, w: 0.05, owner: 'J1' }],
    fills: [{ id: 'f1', layer: 'TopOverlay', x1: 2, y1: 2, x2: 4, y2: 3, rot: 0 }],
    regions: [{ id: 'g1', layer: 'Top', points: [[2, 25], [6, 25], [6, 28], [2, 28]], holes: [[[3, 26], [4, 26], [4, 27], [3, 27]]] }],
    cutouts: [{ id: 'k1', layer: 'Multi', points: [[18, 13], [22, 13], [22, 17], [18, 17]] }],
    stats: {},
  };
}
const efetiva = (B, ch) => HubCore.effectiveBoard(B, HubCore.applyPcbChanges(B, ch || []));

t('campos do carimbo vem do projeto', () => {
  const eb = efetiva(placa());
  const c = P.camposCarimbo(eb, { data: new Date(2026, 9, 13) });
  assert.strictEqual(c.arquivo, 'PTESTE - DI260001');
  assert.strictEqual(c.revisao, 'REV.B');
  assert.strictEqual(c.dataDesenho, '13/10/26');
  assert.strictEqual(c.formato, 'A4');
  const d = P.camposCarimbo(eb, { carimbo: { arquivo: 'X', revisao: '' }, formato: 'A3' });
  assert.strictEqual(d.arquivo, 'X'); assert.strictEqual(d.revisao, ''); assert.strictEqual(d.formato, 'A3');
  assert.strictEqual(P.nomeArquivo(eb, {}), 'LO - PTESTE - DI260001.pdf');
  assert.strictEqual(P.nomeArquivo(eb, { carimbo: { arquivo: 'a/b' } }), 'LO - a_b.pdf');
  assert.strictEqual(P.nomeArquivo(eb, { carimbo: { arquivo: 'Placa Ação #2.' } }), 'LO - Placa Acao _2.pdf');
});

t('plano: juntas, separadas e realista', () => {
  const eb = efetiva(placa());
  /* sozinha cabe em 4:1; as duas lado a lado so em 3:1 -> uma folha por vista */
  const a = P.plano(eb, {});
  assert.deepStrictEqual(a.folhas.map(f => f.tipo), ['cima', 'baixo']);
  assert.strictEqual(a.rotulo, '4:1');
  const j = P.plano(eb, { juntas: true });
  assert.deepStrictEqual(j.folhas.map(f => f.tipo), ['juntas']); assert.strictEqual(j.rotulo, '3:1');
  /* a placa larga e baixa: as duas cabem na mesma escala de uma so -> juntas */
  const larga = efetiva(Object.assign(placa(), { board: { bbox: { x1: 0, y1: 0, x2: 100, y2: 30 }, outline: [] } }));
  assert.deepStrictEqual(P.plano(larga, {}).folhas.map(f => f.tipo), ['juntas']);
  const b = P.plano(eb, { juntas: false, folhas: { realista: true } });
  assert.deepStrictEqual(b.folhas.map(f => f.tipo), ['cima', 'baixo', 'realista']);
  const c = P.plano(eb, { escala: '20:1' });
  assert.ok(c.avisos.some(x => /não cabe/.test(x)));
  const d = P.plano(eb, { folhas: { baixo: false } });
  assert.deepStrictEqual(d.folhas.map(f => f.tipo), ['cima']);
});

t('pdf da placa sintetica', () => {
  const eb = efetiva(placa());
  const opc = { juntas: false, folhas: { realista: true }, pads: true, data: new Date(2026, 9, 13),
                obs: { cima: 'Nota de teste\ncom acento: ação' }, carimbo: { equipamento: 'LINHA UM\nLINHA DOIS', desenhista: 'FULANO' } };
  const m = P.monta(eb, opc);
  assert.deepStrictEqual(m.folhas.map(f => f.tipo), ['cima', 'baixo', 'realista']);
  assert.ok(!m.avisos.some(x => /3D Body/.test(x)), 'achou a camada de corpo pelo nome');
  const { r, pags } = conteudos(P.gera(eb, opc));
  assert.strictEqual(r.paginas.length, 3);
  /* carimbo: rotulos, valores e FL. n / total */
  for (const p of pags) for (const k of ['(ARQUIVO:)', '(PTESTE - DI260001)', '(FULANO)', '(LINHA UM)', '(LINHA DOIS)', '(13/10/26)', '(A4)'])
    assert.ok(p.indexOf(k) >= 0, 'falta ' + k);
  assert.ok(pags[1].indexOf('(2)') >= 0 && pags[1].indexOf('(3)') >= 0);
  assert.ok(pags[0].indexOf('(View from Top side \\(Scale 4:1\\))') >= 0, 'legenda do Draftsman');
  assert.ok(pags[0].indexOf('(TOP VIEW)') >= 0 && pags[1].indexOf('(BOTTOM VIEW)') >= 0);
  assert.ok(pags[0].indexOf('(OBS:.)') >= 0 && pags[0].indexOf('(com acento: a\\347\\343o)') >= 0);
  assert.ok(pags[1].indexOf('(OBS:.)') < 0, 'sem texto, sem quadro');
  /* vista de baixo espelhada: a da matriz negativo */
  assert.ok(/\n4 0 0 4 [\d.]+ [\d.-]+ cm/.test(pags[0]), 'cima sem espelho');
  assert.ok(/\n-4 0 0 4 [\d.]+ [\d.-]+ cm/.test(pags[1]), 'baixo espelhado');
  /* texto com contorno exato sai por par-impar (o miolo vazado) */
  assert.ok(/\nf\*/.test(pags[1]));
  /* realista: as cores do hub-gerberview */
  assert.ok(pags[2].indexOf('0.0549 0.3529 0.1725 rg') >= 0, 'mascara #0e5a2c');
  assert.ok(pags[2].indexOf('0.8471 0.6588 0.2431 rg') >= 0, 'ouro #d8a83e');
  assert.ok(/W\* n/.test(pags[2]), 'recortado pela placa');
  /* o logo do carimbo vai como imagem */
  assert.ok(pags.every(p => /\/Im1 Do/.test(p)));
});

t('corpo: mecanica x caixa', () => {
  const B = placa();
  const so = pags => pags[0];
  const mec = conteudos(P.gera(efetiva(B), { folhas: { baixo: false }, corpo: 'mecanica', titulos: false })).pags;
  const cx = conteudos(P.gera(efetiva(B), { folhas: { baixo: false }, corpo: 'caixa', titulos: false })).pags;
  assert.ok(/8\.5 9\.3 m\n11\.5 9\.3 l/.test(so(mec)), 'linha da Mech13');
  assert.ok(/8 9 4 2 re/.test(so(cx)), 'caixa do R1');
  assert.ok(!/8 9 4 2 re/.test(so(mec)));
  /* sem board.layers vale o padrao do Altium: Mech13 (3D Body) e Mech15 (Courtyard), nao a 14 */
  const semNome = placa(); delete semNome.layers;
  assert.ok(!P.monta(efetiva(semNome), {}).avisos.some(x => /3D Body/.test(x)), 'Mech13 pelo padrao');
  semNome.lines = semNome.lines.filter(l => l.layer === 'Mech14');
  assert.ok(P.monta(efetiva(semNome), {}).avisos.some(x => /3D Body/.test(x)), 'Mech14 sem nome nao e corpo');
});

t('a placa efetiva: componente movido sai no lugar novo', () => {
  const B = placa();
  const ch = [{ op: 'comp_move', ref: 'R1', x: 15, y: 10, rot: 0, layer: 'Top', orig_x: 10, orig_y: 10, orig_rot: 0, orig_layer: 'Top' }];
  const eb = efetiva(B, ch);
  assert.strictEqual(eb.components[0].x, 15);
  const p = conteudos(P.gera(eb, { folhas: { baixo: false }, corpo: 'caixa', titulos: false })).pags[0];
  assert.ok(/13 9 4 2 re/.test(p), 'caixa andou 5 mm');
});

t('raster do chamador na folha realista', () => {
  const eb = efetiva(placa());
  const rgb = new Uint8Array(4 * 3 * 3).fill(128);
  const b = P.gera(eb, { folhas: { cima: false, baixo: false, realista: true }, realista: { cima: { w: 4, h: 3, rgb } } });
  const { r, pags } = conteudos(b);
  assert.strictEqual(r.paginas.length, 1);
  assert.ok(/\/Im2 Do/.test(pags[0]), 'imagem da face de cima');
});

t('A3 leva o carimbo para o canto', () => {
  const eb = efetiva(placa());
  const { r, pags } = conteudos(P.gera(eb, { formato: 'A3', folhas: { baixo: false } }));
  perto(r.paginas[0].mediaBox[2], 1190.5512, 1e-3);
  assert.ok(/\n415(\.000\d)? 10 m\n347(\.000\d)? 10 l/.test(pags[0]), 'linha do carimbo deslocada 123 mm');
  assert.ok(pags[0].indexOf('(A3)') >= 0);
});

/* ---------------- a placa real ---------------- */

t('DMB do repo', () => {
  const B = loadVar('Projects/DMB - DI231765_P2/board.js', 'pcbmirror');
  const eb = efetiva(B);
  const opc = { folhas: { realista: true }, data: new Date(2026, 9, 13),
                carimbo: { equipamento: 'DISPLAY ASCII PARA MARCAÇÃO DE BOBINAS\nDMB - DI231765' } };
  const b = P.gera(eb, opc);
  const { r, pags } = conteudos(b);
  assert.strictEqual(r.paginas.length, 2);
  assert.ok(pags[0].indexOf('(REV.C)') >= 0, 'revisao lida da serigrafia');
  assert.ok(pags[0].indexOf('(PDMB - DI231765_P2)') >= 0);
  assert.ok(b.length < 400 * 1024, 'tamanho razoavel: ' + b.length);
  const saida = process.env.HUB_PDF_SAIDA;
  if (saida) fs.writeFileSync(path.join(saida, 'LO - PDMB - DI231765_P2.pdf'), b);
});

console.log('\ntest-pcbpdf: ' + n + ' ok');
