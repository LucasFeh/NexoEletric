// hub-pcbsilkgen.js: a ferramenta Imagem ou texto -> serigrafia da vista PCB (sem navegador).
//   - as contas puras: o raster do texto (px por mm, com teto), o da imagem, a escala px -> mm, a
//     garantia de tamanho e centro, a nota das ops (sem nada que quebre o leitor de linha);
//   - o caminho inteiro (rgba -> region_add) com o motor hub-silkgen.js de verdade quando ele existe,
//     senao com um motor de mentira do mesmo formato (o motor e escrito a parte);
//   - o elo com a vista: o <script src> no pcbframe.html, o case do fazAcao, o botao da barra, o
//     icone e o item Place » Imagem ou texto -> serigrafia logo abaixo do Place » String.
// Rodar: node tests/test-pcbsilkgen.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const R = path.join(__dirname, '..');
const SG = require(path.join(R, 'hub-pcbsilkgen.js'));

const perto = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ': ' + a + ' ~ ' + b + ' (±' + tol + ')');

/* ══ a face e a camada ══ */
assert.strictEqual(SG.faceDe('Top'), 'Top');
assert.strictEqual(SG.faceDe('TopOverlay'), 'Top');
assert.strictEqual(SG.faceDe('Mid3'), 'Top');
assert.strictEqual(SG.faceDe('Bottom'), 'Bottom');
assert.strictEqual(SG.faceDe('BottomOverlay'), 'Bottom');
assert.strictEqual(SG.faceDe('BottomSolder'), 'Bottom');
assert.strictEqual(SG.camadaDaFace('Top'), 'TopOverlay');
assert.strictEqual(SG.camadaDaFace('Bottom'), 'BottomOverlay');

/* ══ o ctx.font ══ */
assert.strictEqual(SG.fonteCss('Segoe UI', true, true, 100.4), 'italic bold 100px "Segoe UI", sans-serif');
assert.strictEqual(SG.fonteCss('Arial', false, false, 48), '48px "Arial", sans-serif');
assert.strictEqual(SG.fonteCss('', false, false, 10), '10px "Arial", sans-serif', 'sem nome: Arial');
assert.strictEqual(SG.fonteCss('Ari"al; color:red', false, false, 10), '10px "Arial color:red", sans-serif', 'aspas e ; de quem digitou saem');
assert.ok(SG.FONTES.length >= 7 && ['Arial', 'Calibri', 'Segoe UI', 'Times New Roman', 'Consolas', 'Verdana', 'Tahoma'].every(f => SG.FONTES.includes(f)));

/* ══ o raster do texto ══ */
{
  const med = { cap:0.7, asc:0.9, desc:0.2, larguras:[3] };
  const d = SG.dimensionaTexto(1, med);
  assert.strictEqual(d.capPx, 200, '1 mm de maiuscula = 200 px (~20 px por 0,1 mm)');
  perto(d.mmPorPx, 0.005, 1e-12, 'mm por px');
  perto(d.fontPx, 200 / 0.7, 1e-9, 'o corpo sai da maiuscula');
  assert.ok(d.w >= 3 * d.fontPx && d.h >= 1.1 * d.fontPx, 'o canvas cabe a linha');
  assert.ok(d.base0 > d.margem && d.base0 < d.h, 'a linha de base dentro do canvas');
  assert.strictEqual(d.reduzido, false);
  /* duas linhas: mais alto, a mesma escala */
  const d2 = SG.dimensionaTexto(1, Object.assign({}, med, { larguras:[3, 2] }));
  assert.ok(d2.h > d.h && d2.w === d.w && d2.mmPorPx === d.mmPorPx, 'a segunda linha so aumenta a altura');
  perto(d2.h - d.h, d2.linha, 1, 'uma entrelinha a mais');
  /* pequeno e grande: o passo fica entre os tetos e a escala acompanha */
  const p = SG.dimensionaTexto(0.1, med);
  assert.strictEqual(p.capPx, 48, 'texto pequeno nao fica com menos de 48 px de maiuscula');
  perto(p.mmPorPx, 0.1 / 48, 1e-12);
  const g = SG.dimensionaTexto(50, med);
  assert.strictEqual(g.capPx, 480, 'texto grande nao passa de 480 px de maiuscula');
  perto(g.mmPorPx, 50 / 480, 1e-12);
  /* texto comprido: o canvas cabe no teto do navegador e a escala continua certa */
  const l = SG.dimensionaTexto(3, Object.assign({}, med, { larguras:[120] }));
  assert.ok(l.reduzido, 'avisa que reduziu');
  assert.ok(l.w <= 8192 && l.h <= 8192 && l.w * l.h <= 24e6, 'cabe: ' + l.w + ' x ' + l.h);
  perto(l.mmPorPx, 3 / l.capPx, 1e-12, 'a escala segue o passo reduzido');
  /* altura que nao vale */
  assert.strictEqual(SG.dimensionaTexto(0, med), null);
  assert.strictEqual(SG.dimensionaTexto(-2, med), null);
  assert.strictEqual(SG.dimensionaTexto('abc', med), null);
  assert.strictEqual(SG.dimensionaTexto('1,5', med).capPx, 300, 'aceita a virgula');
}

/* ══ o raster da imagem ══ */
assert.deepStrictEqual(SG.dimensionaImagem(64, 32, false), { w:768, h:384, fator:12 }, 'bitmap pequeno sobe');
assert.deepStrictEqual(SG.dimensionaImagem(4000, 3000, false), { w:2048, h:1536, fator:2048 / 4000 }, 'bitmap grande desce');
assert.deepStrictEqual(SG.dimensionaImagem(1000, 500, false), { w:1000, h:500, fator:1 }, 'no meio, fica');
assert.deepStrictEqual(SG.dimensionaImagem(300, 150, true), { w:2048, h:1024, fator:2048 / 300 }, 'vetor sempre no teto');
assert.deepStrictEqual(SG.dimensionaImagem(0, 0, true), { w:2048, h:2048, fator:2048 }, 'SVG sem tamanho: um quadrado');

/* ══ caixa, vertices, escala, normaliza, desloca ══ */
const quadrado = (x, y, l) => [[x, y], [x + l, y], [x + l, y + l], [x, y + l]];
{
  const polys = [{ pts:quadrado(0, 0, 10), holes:[quadrado(3, 3, 4)] }, { pts:quadrado(20, 0, 2) }];
  assert.deepStrictEqual(SG.caixa(polys), { x1:0, y1:0, x2:22, y2:10, w:22, h:10 });
  assert.strictEqual(SG.caixa([]), null);
  assert.strictEqual(SG.contaVertices(polys), 12);
  assert.strictEqual(SG.escalaImagem({ w:100, h:50 }, 'largura', 10), 0.1);
  assert.strictEqual(SG.escalaImagem({ w:100, h:50 }, 'altura', 10), 0.2);
  assert.strictEqual(SG.escalaImagem({ w:100, h:50 }, 'largura', 0), 0);
  /* o lado maior vira maxMm e o centro da caixa vai para (x, y); os furos andam junto */
  const n = SG.normaliza([{ pts:quadrado(5, 5, 2), holes:[quadrado(5.5, 5.5, 1)] }], { x:0, y:0, maxMm:4 });
  assert.deepStrictEqual(SG.caixa(n), { x1:-2, y1:-2, x2:2, y2:2, w:4, h:4 });
  assert.deepStrictEqual(n[0].holes[0], [[-1, -1], [1, -1], [1, 1], [-1, 1]]);
  /* ja do tamanho e no lugar: o mesmo objeto, sem conta */
  const certo = [{ pts:quadrado(-2, -2, 4) }];
  assert.strictEqual(SG.normaliza(certo, { x:0, y:0, maxMm:4 }), certo);
  const d = SG.desloca([{ op:'region_add', layer:'TopOverlay', pts:quadrado(0, 0, 1), holes:[quadrado(0.25, 0.25, 0.5)] }], 10, -5);
  assert.deepStrictEqual(d[0].pts, [[10, -5], [11, -5], [11, -4], [10, -4]]);
  assert.deepStrictEqual(d[0].holes[0][0], [10.25, -4.75]);
  assert.strictEqual(d[0].layer, 'TopOverlay', 'o resto da op fica');
}

/* ══ a nota das ops ══ */
{
  assert.strictEqual(SG.notaDe('imagem', 'logo.png'), 'serigrafia de imagem logo.png');
  assert.strictEqual(SG.notaDe('texto', 'DIEletrons'), 'serigrafia de texto “DIEletrons”');
  const t = SG.notaDe('texto', 'A"B:\nC\\D');
  assert.strictEqual(t, 'serigrafia de texto “AB: / CD”');
  for (const s of [t, SG.notaDe('imagem', 'a":b.png')]) {
    assert.ok(!/["\\]/.test(s), 'sem aspas nem barra: ' + s);
    assert.ok(!JSON.stringify(s).slice(1, -1).includes('":'), 'a sequencia ": nao aparece: ' + s);
  }
  const longa = SG.notaDe('texto', 'x'.repeat(200));
  assert.ok(longa.length < 80 && longa.includes('…'), 'nota comprida e cortada');
}

/* ══ os avisos ══ */
assert.deepStrictEqual(SG.avisosDe({ avisos:['traço de 0,1 mm'], descartadas:[{ motivo:'abaixo de 0,15 mm' }, { motivo:'abaixo de 0,15 mm' }, { motivo:'área mínima' }] }),
  ['traço de 0,1 mm', '2 pedaços descartados: abaixo de 0,15 mm', '1 pedaço descartado: área mínima']);
assert.deepStrictEqual(SG.avisosDe({}), []);

/* ══ o caminho inteiro, com o motor ══ */
/* SILKGEN_MENTIRA=1 forca o motor de mentira (confere o caminho sem o motor) */
const REAL = !process.env.SILKGEN_MENTIRA && fs.existsSync(path.join(R, 'hub-silkgen.js'));
const HS = REAL ? require(path.join(R, 'hub-silkgen.js')) : motorDeMentira();
/* o motor de mentira: o formato do contrato (mascara {w,h,m}, contornos em px com y para baixo,
   paraPlaca em mm com Y para cima centrada em x,y, opsDe com region_add) -- a tinta vira a caixa dela */
function motorDeMentira() {
  return {
    mascaraDeRGBA(rgba, w, h, o) {
      const m = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) {
        const a = rgba[4 * i + 3], l = 0.299 * rgba[4 * i] + 0.587 * rgba[4 * i + 1] + 0.114 * rgba[4 * i + 2];
        let tinta = l < o.limiar ? 1 : 0;
        if (o.inverter) tinta ^= 1;
        if (o.alfa && a < 128) tinta = 0;
        m[i] = tinta;
      }
      return { w, h, m };
    },
    contornos(M) {
      let x1 = Infinity, y1 = Infinity, x2 = -1, y2 = -1;
      for (let y = 0; y < M.h; y++) for (let x = 0; x < M.w; x++) if (M.m[y * M.w + x]) {
        x1 = Math.min(x1, x); x2 = Math.max(x2, x); y1 = Math.min(y1, y); y2 = Math.max(y2, y);
      }
      return x2 < 0 ? [] : [{ pts:[[x1, y1], [x2 + 1, y1], [x2 + 1, y2 + 1], [x1, y2 + 1]], holes:[] }];
    },
    paraPlaca(polys, o) {
      const bb = SG.caixa(polys), cx = (bb.x1 + bb.x2) / 2, cy = (bb.y1 + bb.y2) / 2, k = o.escala, sx = o.espelhar ? -1 : 1;
      const t = q => [o.x + sx * (q[0] - cx) * k, o.y - (q[1] - cy) * k];
      return polys.map(p => ({ pts:p.pts.map(t), holes:(p.holes || []).map(h => h.map(t)) }));
    },
    opsDe(polys, o) {
      return { ops:polys.map(p => Object.assign({ op:'region_add', layer:o.layer, pts:p.pts }, p.holes.length ? { holes:p.holes } : {}, o.note ? { note:o.note } : {})),
               descartadas:[], avisos:[], area_mm2:0, caixa:null };
    },
  };
}
/* um anel preto em fundo branco, 200x100 px: tinta de x 40..160, y 10..90 com o miolo de 80..120 x 35..65 */
function anel() {
  const w = 200, h = 100, rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = 4 * (y * w + x);
    const tinta = x >= 40 && x < 160 && y >= 10 && y < 90 && !(x >= 80 && x < 120 && y >= 35 && y < 65);
    const v = tinta ? 0 : 255;
    rgba[i] = rgba[i + 1] = rgba[i + 2] = v; rgba[i + 3] = 255;
  }
  return { rgba, w, h };
}
{
  const f = anel();
  /* imagem: 12 mm de largura, na face de cima */
  const r = SG.gera(HS, f, { limiar:128, medida:'largura', mm:12, face:'Top', rot:0, simplificar:0, x:0, y:0, nota:SG.notaDe('imagem', 'anel.png') });
  assert.ok(!r.vazio && r.ops.length >= 1, 'saiu serigrafia');
  for (const op of r.ops) {
    assert.strictEqual(op.op, 'region_add');
    assert.strictEqual(op.layer, 'TopOverlay');
    assert.ok(Array.isArray(op.pts) && op.pts.length >= 3);
    assert.ok(!('cutout' in op) && !('net' in op && op.net), 'serigrafia nao e recorte nem cobre');
  }
  perto(r.caixa.w, 12, 0.12, 'a largura pedida');
  perto(r.caixa.h, 8, 0.12, 'a altura segue a proporcao (120 x 80 px de tinta)');
  perto((r.caixa.x1 + r.caixa.x2) / 2, 0, 0.01, 'centro x');
  perto((r.caixa.y1 + r.caixa.y2) / 2, 0, 0.01, 'centro y');
  perto(r.mmPorPx, 0.1, 0.002, 'mm por px');
  assert.strictEqual(r.vertices, SG.contaVertices(r.polys));
  if (REAL) assert.ok(r.ops.some(op => Array.isArray(op.holes) && op.holes.length), 'o miolo do anel e furo (holes)');
  if (REAL) assert.ok(r.ops.every(op => op.note === 'serigrafia de imagem anel.png'), 'a nota em toda op');
  /* altura pedida */
  const a = SG.gera(HS, f, { limiar:128, medida:'altura', mm:4, face:'Top', x:0, y:0 });
  perto(a.caixa.h, 4, 0.06, 'a altura pedida');
  perto(a.caixa.w, 6, 0.08, 'a largura segue');
  /* face de baixo: BottomOverlay, no lugar pedido */
  const b = SG.gera(HS, f, { limiar:128, medida:'largura', mm:12, face:'Bottom', x:30, y:-7 });
  assert.ok(b.ops.length && b.ops.every(op => op.layer === 'BottomOverlay'), 'a face de baixo vai para a BottomOverlay');
  perto((b.caixa.x1 + b.caixa.x2) / 2, 30, 0.01, 'centro x na placa');
  perto((b.caixa.y1 + b.caixa.y2) / 2, -7, 0.01, 'centro y na placa');
  /* giro de 90: o lado maior continua o pedido */
  const g = SG.gera(HS, f, { limiar:128, medida:'largura', mm:12, face:'Top', rot:90, x:0, y:0 });
  perto(Math.max(g.caixa.w, g.caixa.h), 12, 0.12, 'girado, o lado maior e o pedido');
  if (REAL) perto(g.caixa.h, 12, 0.12, 'girado 90, a largura vira altura');
  /* o texto: a escala ja vem do raster */
  const t = SG.gera(HS, f, { limiar:128, alfa:false, mmPorPx:0.005, face:'Top', x:0, y:0 });
  perto(t.caixa.w, 120 * 0.005, 0.01, 'texto: a escala do raster');
  /* inverter: o fundo vira tinta (a caixa e a imagem inteira) */
  const inv = SG.gera(HS, f, { limiar:128, inverter:true, medida:'largura', mm:20, face:'Top', x:0, y:0 });
  assert.ok(!inv.vazio, 'invertido tambem sai');
  /* nada para converter */
  const branco = { rgba:new Uint8ClampedArray(40 * 40 * 4).fill(255), w:40, h:40 };
  const v = SG.gera(HS, branco, { limiar:128, medida:'largura', mm:10, face:'Top' });
  assert.ok(v.vazio && v.ops.length === 0 && v.avisos.length, 'imagem branca: nada, com aviso');
  /* sem tamanho */
  const s = SG.gera(HS, f, { limiar:128, medida:'largura', mm:0, face:'Top' });
  assert.ok(s.vazio && /tamanho/.test(s.avisos.join(' ')), 'sem tamanho: pede o tamanho');
}

/* ══ o elo com a vista ══ */
{
  const html = fs.readFileSync(path.join(R, 'pcbframe.html'), 'utf8');
  const iMotor = html.indexOf('<script src="hub-silkgen.js"></script>');
  const iDialogo = html.indexOf('<script src="hub-pcbsilkgen.js"></script>');
  const iFrame = html.indexOf('<script src="pcbframe.js"></script>');
  assert.ok(iMotor > 0 && iDialogo > iMotor && iFrame > iDialogo, 'o pcbframe.html carrega o motor e o dialogo antes do pcbframe.js');
  const frame = fs.readFileSync(path.join(R, 'pcbframe.js'), 'utf8');
  const corpo = frame.slice(frame.indexOf('function fazAcao(id, arg){'));
  assert.ok(/case 'serigrafia': abreSerigrafia\(\); return;/.test(corpo.slice(0, corpo.indexOf('\n}\n'))), 'o fazAcao abre a ferramenta');
  assert.ok(/\{ id:'serigrafia', ic:'serigrafia', acao:'serigrafia'/.test(frame), 'o botao na barra');
  assert.ok(/function abreSerigrafia\(\)\{[\s\S]*?HubPcbSilkGen\.abre\(/.test(frame), 'o elo chama o modulo');
  const IC = require(path.join(R, 'hub-pcbicones.js'));
  assert.ok(typeof IC.ICONES.serigrafia === 'string' && IC.ICONES.serigrafia, 'o icone');

  /* o menu Place: o item logo abaixo do String (o Altium nao tem o comando) */
  global.document = { getElementById:() => ({}), createElement:() => ({}), head:{ append(){} }, addEventListener(){}, removeEventListener(){} };
  const temWindow = 'window' in global;
  if (!temWindow) global.window = { addEventListener(){}, removeEventListener(){} };
  global.HubAltiumDNA = require(path.join(R, 'hub-altiumdna.js'));
  const ALT = require(path.join(R, 'hub-pcbaltium.js'));
  const chamadas = [];
  const mk = lean => ALT.instala({ vista:'pcb', fazAcao:id => chamadas.push(id), teclaDe:() => '', grades:() => [],
    ctx:() => ({ sel:0, lean, comp:false, net:false }), prefs:() => ({}), camadas:() => [], toast(){} });
  const place = mk(false).itensBarra().find(x => x.ing === 'Place');
  assert.ok(place, 'o menu Place');
  const k = place.filhos.findIndex(x => x && x.acao === 'texto');
  assert.ok(k >= 0, 'Place » String');
  const it = place.filhos[k + 1];
  assert.ok(it && it.acao === 'serigrafia' && /serigrafia/.test(it.rot) && !it.off, 'Place » Imagem ou texto → serigrafia logo abaixo');
  it.f();
  assert.deepStrictEqual(chamadas, ['serigrafia']);
  assert.strictEqual(place.filhos.filter(x => x && x.acao === 'serigrafia').length, 1, 'uma vez so');
  const lean = mk(true).itensBarra().find(x => x.ing === 'Place');
  const itL = lean && lean.filhos.find(x => x && x.acao === 'serigrafia');
  assert.ok(!itL || itL.off, 'no lean (so leitura) fica cinza');
  delete global.document; delete global.HubAltiumDNA;
  if (!temWindow) delete global.window;
}

console.log('ok — hub-pcbsilkgen (' + (REAL ? 'motor hub-silkgen.js de verdade' : 'motor de mentira' + (fs.existsSync(path.join(R, 'hub-silkgen.js')) ? '' : ': o hub-silkgen.js ainda não existe')) + ')');
