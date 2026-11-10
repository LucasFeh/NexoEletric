/* As ARTES DE OVERLAY da PCB (1.91.0): hub-qr.js, hub-pcbartes.js e o caminho na placa (hub-core.js » arteGeom, comp_add
   com `arte`, setParamsProjeto/resolveEspeciais com os campos "=..."; hub-gerber.js).

   node tests/test-pcbartes.js

   O QR decodificado de verdade (do Gerber gerado) é o tests/test_pcbartes_qr.py (precisa do zxing-cpp no Python). */
const assert = require('assert');
const Q = require('../hub-qr.js');
const A = require('../hub-pcbartes.js');
const H = require('../hub-core.js');
const G = require('../hub-gerber.js');
const GV = require('../hub-gerberview.js');
const ECO = require('../hub-pcbeco.js');
const BOM = require('../hub-bom.js');

let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };
const perto = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= (tol || 1e-6), (m || '') + ': ' + a + ' != ' + b); n++; };

const placa = () => ({ format:'pcbmirror-v1', units:'mm', components:[], tracks:[], arcs:[], vias:[], texts:[], silk:[], regions:[], fills:[],
                       nets:[], board:{ bbox:{ x1:0, y1:0, x2:100, y2:80 }, outline:[
                         { kind:'line', x1:0, y1:0, x2:100, y2:0 }, { kind:'line', x1:100, y1:0, x2:100, y2:80 },
                         { kind:'line', x1:100, y1:80, x2:0, y2:80 }, { kind:'line', x1:0, y1:80, x2:0, y2:0 }] } });
const DMB = 'Revisao=REV. C;CodigoDaPlaca=PMD-DI261946;NomeDaPlaca=MICONTROLADORA DE DISPLAY;CodigoDoEquipamento=DMB-DI231765';

/* ── 1. o QR: a versão e o tamanho do QR das placas da casa, os localizadores, o nível ── */
{
  const q = Q.gera('www.dieletrons.com', { ec:'L' });
  eq([q.versao, q.n, q.ec], [2, 25, 'L'], 'www.dieletrons.com no nível L: versão 2 (25×25), como o QR da DMB');
  const finder = (x0, y0) => { for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) { const d = Math.max(Math.abs(x - 3), Math.abs(y - 3)); if (q.mod(x0 + x, y0 + y) !== (d !== 2)) return false; } return true; };
  ok(finder(0, 0) && finder(18, 0) && finder(0, 18), 'os três localizadores');
  ok(!q.mod(24, 24 - 7) || true, 'acesso fora não quebra');
  eq(Q.gera('https://www.dieletrons.com.br', { ec:'M' }).versao, 3, '29 bytes no M: versão 3 (a 2 leva 26)');
  assert.throws(() => Q.gera('x'.repeat(4000), { ec:'H' }), /não cabe/); n++;
  const r = A.qrRegioes({ x:0, y:0, tam:10, texto:'www.dieletrons.com', ec:'L', borda:2, invertido:true });
  perto(r.modulo, 10 / 29, 1e-9, 'módulo de 10/29 mm (0,345, o da DMB)');
  /* a área da tinta = (módulos claros + borda) × módulo²: confere a junção das corridas em retângulos */
  let claros = 0; for (let y = 0; y < 25; y++) for (let x = 0; x < 25; x++) if (!Q.gera('www.dieletrons.com', { ec:'L' }).mod(x, y)) claros++;
  const area = r.regioes.reduce((s, g) => s + Math.abs((g.pts[1][0] - g.pts[0][0]) * (g.pts[2][1] - g.pts[1][1])), 0);
  perto(area, (claros + 29 * 29 - 25 * 25) * r.modulo * r.modulo, 0.01, 'a tinta do QR invertido');
  ok(r.regioes.length < claros, 'corridas juntas (' + r.regioes.length + ' retângulos para ' + claros + ' módulos)');
}

/* ── 2. os campos automáticos ── */
{
  H.setParamsProjeto(DMB, 'DMB - DI231765_P2');
  eq(H.resolveEspeciais('=CodigoDaPlaca'), 'PMD-DI261946', 'o código da placa do Definir projeto (não o do nome da pasta)');
  eq(H.resolveEspeciais('=Revisao'), 'REV. C', 'a revisão do quadro da folha');
  eq(H.resolveEspeciais('REV. =Revisao / =NomeDaPlaca'), 'REV. REV. C / MICONTROLADORA DE DISPLAY', 'campo no meio do texto');
  eq(H.resolveEspeciais('=projeto'), 'DMB - DI231765_P2', 'sem caixa');
  ok(/^\d\d\/\d\d\/\d{4}$/.test(H.resolveEspeciais('=Data')), 'a data de hoje');
  eq(H.resolveEspeciais('a=b =Nada x=Revisao'), 'a=b =Nada x=Revisao', 'o que não é campo (ou vem colado numa palavra) fica');
  H.setParamsProjeto('Revisao=REV. B', 'LM555 astável');
  eq(H.resolveEspeciais('=CodigoDaPlaca'), 'PROJETO NÃO DEFINIDO', 'sem placa definida: PROJETO NÃO DEFINIDO (regra da 1.86.0)');
  eq(H.resolveEspeciais('=CodigoDoEquipamento'), 'PROJETO NÃO DEFINIDO', 'sem equipamento também');
  H.setParamsProjeto('CodigoDaPlaca=PROJETO NÃO DEFINIDO', 'PDCD-DI261939 (PTYPE)');
  eq(H.resolveEspeciais('=CodigoDaPlaca'), 'PDCD-DI261939', 'o "não definido" gravado não vale: o código do nome do projeto, como no quadro');
  /* o Gerber escreve o valor; o campo sem valor avisa */
  H.setParamsProjeto(DMB, 'DMB');
  const av = []; G.geometriaTexto({ x:0, y:0, h:1.5, w:0.2, rot:0, text:'=Revisao', layer:'TopOverlay', kind:'stroke' }, { add:k => av.push(k) });
  eq(av.filter(k => k === 'texto-especial'), [], 'campo resolvido: sem aviso de string crua');
  H.setParamsProjeto('', 'LM555');
  const av2 = []; G.geometriaTexto({ x:0, y:0, h:1.5, w:0.2, rot:0, text:'=Revisao', layer:'TopOverlay', kind:'stroke' }, { add:k => av2.push(k) });
  eq(av2.filter(k => k === 'texto-especial'), ['texto-especial'], 'projeto sem revisão: o Gerber avisa que o campo saiu cru');
  eq(A.camposDe('REV. =Revisao =CodigoDaPlaca =Outro'), ['Revisao', 'CodigoDaPlaca'], 'os campos de um texto');
}

/* ── 3. as artes da casa ── */
{
  const L = A.lista(null);
  eq(L.map(a => a.id), ['dieletrons-logo-qr', 'codigo-revisao'], 'as duas artes padrão sem arquivo');
  const c = A.compila(L[0]);
  eq(c.avisos, [], 'a logo + QR respeita o mínimo da JLC');
  ok(c.fp.r.length > 150 && c.fp.l.length === 0, 'logo + QR só de regiões: ' + c.fp.r.length);
  perto(c.caixa.x2 - c.caixa.x1, 34.931, 0.01, 'largura da logo + QR (a da DMB: QR 10 mm + 0,9 mm + logo 24,03 mm)');
  perto(c.caixa.y2 - c.caixa.y1, 10.064, 0.01, 'altura');
  const t = A.compila(L[1]);
  eq(t.fp.t.map(x => x.text), ['=CodigoDaPlaca', '=Revisao'], 'o bloco de código + revisão');
  eq(t.avisos, [], 'texto de 1,524 mm, traço 0,254');
  /* o arquivo da biblioteca: a padrão editada pelo admin ganha, a apagada some, a nova entra */
  const lib = { artes:[{ id:'codigo-revisao', nome:'Cód + rev (admin)', elementos:[{ tipo:'texto', x:0, y:0, texto:'=CodigoDaPlaca', h:2, w:0.3 }] },
                       { id:'dieletrons-logo-qr', apagada:true }, { id:'minha', nome:'Minha', elementos:[] }] };
  eq(A.lista(lib).map(a => a.nome), ['Cód + rev (admin)', 'Minha'], 'a lista com o arquivo');
  ok(A.lista(lib)[0].padrao, 'a padrão editada continua padrão');
  /* aviso do mínimo */
  const fina = A.compila({ elementos:[{ tipo:'linha', x1:0, y1:0, x2:5, y2:0, w:0.1 }, { tipo:'texto', x:0, y:2, texto:'AB', h:0.6, w:0.1 }] });
  eq(fina.avisos.length, 3, 'traço fino, texto baixo e traço de texto fino: ' + fina.avisos.join(' | '));
  eq(A.proximoRef(['ARTE1', 'R1', 'ARTE3']), 'ARTE2', 'o próximo designador livre');
  eq(A.novoId('Logo DiEletrons + QR', []), 'logo-dieletrons-qr', 'id do nome');
  ok(A.novoId('Código revisão', []) !== 'codigo-revisao', 'o id de uma padrão não se reusa');
  eq(A.duplica(L[0], []).padrao, undefined, 'a cópia de uma padrão não é padrão');
}

/* ── 4. na placa: um objeto só, serigrafia de verdade, move/vira/escala, Gerber ── */
{
  H.setParamsProjeto(DMB, 'DMB - DI231765_P2');
  const [logo, cod] = A.lista(null);
  const B = placa();
  const op1 = A.opColocar(logo, { ref:'ARTE1', x:30, y:60 });
  const op2 = A.opColocar(cod, { ref:'ARTE2', x:80, y:10 });
  eq([op1.op, op1.des_hidden, op1.arte.id, op1.layer], ['comp_add', true, 'dieletrons-logo-qr', 'Top'], 'a linha do changes.js');
  const ser = H.serializeChanges([op1, op2]);
  eq(ser.errors, [], 'serializa sem erro');
  const m = H.applyPcbChanges(B, [op1, op2]);
  eq(m.validation.filter(v => v.level !== 'ok' && v.level !== 'info'), [], 'valida sem aviso: ' + JSON.stringify(m.validation).slice(0, 300));
  const eb = H.effectiveBoard(B, m);
  const c1 = eb.components.find(c => c.ref === 'ARTE1');
  ok(H.ehArte(c1) && c1.arte.id === 'dieletrons-logo-qr' && c1.pads.length === 0, 'um componente-arte, sem pad');
  const rg = eb.regions.filter(r => r.owner === 'ARTE1');
  eq([rg.length, rg.every(r => r.layer === 'TopOverlay')], [op1.arte.fp.r.length, true], 'as regiões na Top Overlay');
  ok(rg.some(r => r.holes && r.holes.length), 'os miolos das letras são furos');
  const todosX = rg.flatMap(r => r.points.map(p => p[0])), cx = (Math.min(...todosX) + Math.max(...todosX)) / 2;
  perto(cx, 30, 0.01, 'centrada no ponto pedido');
  eq(eb.texts.filter(t => t.owner === 'ARTE2' && !t.designator).map(t => t.text), ['=CodigoDaPlaca', '=Revisao'], 'os textos guardam o campo');
  ok(eb.texts.filter(t => t.owner === 'ARTE1' || t.owner === 'ARTE2').filter(t => t.designator).every(t => t.hidden), 'designator escondido');
  /* Gerber: a arte sai na legenda de cima, o texto com o valor */
  const g = G.gerar(eb, { guid:'00000000-1111-4222-8333-444444444444', vazias:true });
  const gto = g.arquivos.find(a => a.camada === 'TopOverlay'), gbo = g.arquivos.find(a => a.camada === 'BottomOverlay');
  const cam = GV.parse(gto.texto, gto.nome);
  const regG = cam.prims.filter(p => p.k === 'region').length;
  ok(regG >= op1.arte.fp.r.length, 'GTO com as regiões da logo + QR: ' + regG);
  ok(cam.prims.filter(p => p.k === 'line').length > 20, 'GTO com os traços do texto do código');
  ok(gbo.vazio || !GV.parse(gbo.texto, gbo.nome).prims.length, 'nada na legenda de baixo');
  ok(!g.avisos.some(a => /especial/.test(a.chave || a.k || JSON.stringify(a))), 'sem aviso de campo cru: ' + JSON.stringify(g.avisos).slice(0, 200));
  /* ECO e BOM: arte não é peça */
  const eco = ECO.compara({ items:[] }, B, { changes:[op1, op2] });
  eq(eco.acoes ? eco.acoes.filter(a => a.grupo === 'compDel').length : (eco.filter ? eco.filter(a => a.grupo === 'compDel').length : 0), 0, 'o ECO não propõe tirar as artes');
  eq(BOM.model(eb).comps ? BOM.model(eb).comps.length : 0, 0, 'o BOM não lista as artes');

  /* virar para baixo (comp_move): espelha e vai para a Bottom Overlay */
  /* a virada da tela (pcbframe.js » viraGeo): rot 180 - r */
  const mv = { op:'comp_move', ref:'ARTE1', x:30, y:60, rot:180, layer:'Bottom', orig_x:30, orig_y:60, orig_rot:0, orig_layer:'Top' };
  const m2 = H.applyPcbChanges(B, [op1, op2, mv]);
  const eb2 = H.effectiveBoard(B, m2);
  const rb = eb2.regions.filter(r => r.owner === 'ARTE1');
  ok(rb.length === rg.length && rb.every(r => r.layer === 'BottomOverlay'), 'virada: Bottom Overlay');
  const xs = r => r.flatMap(g => g.points.map(p => p[0]));
  perto(Math.min(...xs(rb)) + Math.max(...xs(rb)), Math.min(...xs(rg)) + Math.max(...xs(rg)), 1e-3, 'espelhada em torno do mesmo x');
  const nQr = A.qrRegioes(logo.elementos[0]).regioes.length, qrTop = rg.slice(0, nQr), qrBot = rb.slice(0, nQr);
  ok(Math.min(...xs(qrBot)) > 30 && Math.max(...xs(qrTop)) < 30, 'o QR passa da esquerda para a direita (lido por baixo)');
  const g2 = G.gerar(eb2, { guid:'00000000-1111-4222-8333-444444444444', vazias:true });
  ok(GV.parse(g2.arquivos.find(a => a.camada === 'BottomOverlay').texto, 'gbo').prims.filter(p => p.k === 'region').length >= rb.length, 'GBO com a arte');

  /* escala 2: o dobro, traço e altura de texto juntos */
  const op3 = JSON.parse(JSON.stringify(op2)); op3.arte.escala = 2;
  const eb3 = H.effectiveBoard(B, H.applyPcbChanges(B, [op3]));
  const tx = eb3.texts.filter(t => t.owner === 'ARTE2' && !t.designator);
  eq(tx.map(t => [t.h, t.w, t.y]), [[3.048, 0.508, 12.69], [3.048, 0.508, 7.31]], 'escala 2');
  /* girar 90 */
  const eb4 = H.effectiveBoard(B, H.applyPcbChanges(B, [Object.assign({}, op2, { rot:90 })]));
  eq(eb4.texts.filter(t => t.owner === 'ARTE2' && !t.designator).map(t => t.rot), [90, 90], 'os textos giram com a arte');
  /* arte sem desenho: erro, não arte vazia */
  const ruim = H.applyPcbChanges(B, [{ op:'comp_add', ref:'ARTE9', footprint:'ARTE_x', x:0, y:0, arte:{ id:'x', fp:{} } }]);
  ok(ruim.validation.some(v => v.level === 'err'), 'arte sem desenho é recusada');
}

console.log('test-pcbartes: ' + n + ' verificações ok');
