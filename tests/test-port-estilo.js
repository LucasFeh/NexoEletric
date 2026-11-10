/* A PORT ESTILIZÁVEL (1.94.0): a ferramenta Port da barra do Esquema e o estilo da port (hub-draw.js).
     node tests/test-port-estilo.js
   O que se prende aqui:
     1. a port nova nasce no estilo da casa (borda azul escura, fundo branco, texto azul centralizado, ponta à direita),
        com o `style` do Altium certo para a seta e a largura pelo nome;
     2. o estilo confere cada campo (o ruim é recusado e não suja a port), e a port importada sem os campos novos desenha
        como antes (os dois bicos, amarela);
     3. a geometria: a seta decide as pontas, a letra maior engorda a barra, a largura automática acompanha o nome, a
        port em pé grava o style 4..7;
     4. o desenho: fundo transparente não pinta, a espessura e a fonte chegam ao canvas, o alinhamento põe o texto
        onde pedido;
     5. o schematic.js aceita e devolve os campos novos (serializeSchematic);
     6. a conectividade: port nova com o mesmo nome de outra port (ou de um rótulo) é a mesma net;
     7. o PDF do esquema leva a port (a fonte serifada vira Times no PDF);
     8. o MCP: sch_adicionar com port nasce no estilo da casa, e sch_port_estilo estiliza várias de uma vez. */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const { loadVar } = require('./load');
const D = require('../hub-draw.js');
const Core = require('../hub-core.js');
const RAIZ = path.join(__dirname, '..');
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

/* ── 1. a port nova ── */
const p = D.portNova({ sheet:'m', net:'SLCK', x:1000, y:2000 });
eq([p.t, p.sheet, p.net, p.x, p.y], ['port', 'm', 'SLCK', 1000, 2000], 'o objeto port de sempre');
eq([p.seta, p.color, p.fill, p.textColor, p.alinha, p.larguraAuto], ['direita', '#1f3a93', '#ffffff', '#1f4fd1', 'centro', true],
   'o estilo da imagem: borda azul escura, fundo branco, texto azul centralizado, ponta à direita');
eq(p.style, 2, 'style 2 (ePortRight) para o Altium');
eq(p.w, D.portLargura(p), 'a largura gravada é a do nome');
ok(p.rot === undefined, 'sem rot: o eixo vai no style');
const emPe = D.portNova({ sheet:'m', net:'RST', x:0, y:0, emPe:true });
/* direita = a ponta longe da âncora; em pé a âncora é embaixo, então a ponta fica em cima: ePortTop = 5 */
eq([emPe.style, D.portGeom(emPe).ang, D.portGeom(emPe).pontaDir, D.portGeom(emPe).pontaEsq], [5, 90, true, false], 'em pé: ePortTop, a ponta em cima');
eq([D.portEstiloAltium('nenhuma', false), D.portEstiloAltium('esquerda', false), D.portEstiloAltium('direita', false), D.portEstiloAltium('ambos', false),
    D.portEstiloAltium('nenhuma', true), D.portEstiloAltium('esquerda', true), D.portEstiloAltium('direita', true), D.portEstiloAltium('ambos', true)],
   [0, 1, 2, 3, 4, 6, 5, 7], 'os números do TPortArrowStyle do Altium');
/* o padrão do projeto (o "Usar como padrão") por cima do da casa, conferido */
const pp = D.portNova({ sheet:'m', net:'L1', x:0, y:0, estilo:{ fill:'none', txtH:60, fonte:'Arial', seta:'ambos', bobagem:1, color:'azul' } });
eq([pp.fill, pp.txtH, pp.fonte, pp.seta, pp.style, pp.color], ['none', 60, 'Arial', 'ambos', 3, '#1f3a93'], 'o padrão do projeto, sem o lixo');
ok(!('bobagem' in pp), 'campo desconhecido não entra');

/* ── 2. o estilo conferido ── */
const q = D.portNova({ sheet:'m', net:'C4', x:0, y:0 });
eq(D.portEstilo(q, { seta:'esquerda', color:'#AA0000', bordaW:10, alinha:'direita', txtH:70, fonte:'Times New Roman', textColor:'#00aa00', io:2 }), [], 'tudo válido');
eq([q.seta, q.style, q.color, q.bordaW, q.alinha, q.txtH, q.fonte, q.textColor, q.io], ['esquerda', 1, '#aa0000', 10, 'direita', 70, 'Times New Roman', '#00aa00', 2], 'aplicado (cor em minúscula)');
eq(D.portEstilo(q, { seta:'cima', fill:'rgb(1,2,3)', fonte:'Comic Sans', txtH:5, bordaW:99, w:10, io:9 }).sort(), ['bordaW', 'fill', 'fonte', 'io', 'seta', 'txtH', 'w'], 'o ruim é recusado');
eq([q.seta, q.fonte, q.txtH], ['esquerda', 'Times New Roman', 70], 'e não suja a port');
D.portEstilo(q, { w:800 });
eq([q.w, q.larguraAuto], [800, false], 'largura fixa desliga a automática');
D.portEstilo(q, { larguraAuto:true });
eq(q.w, D.portLargura(q), 'automática de novo: o w volta a ser o do nome');
/* a importada, sem os campos novos: como antes */
const imp = { t:'port', sheet:'m', net:'SDA', io:3, style:0, x:0, y:0, w:400 };
const gi = D.portGeom(imp);
eq([gi.w, gi.h, gi.bico, gi.pontaEsq, gi.pontaDir, gi.ang], [400, 45, 24, true, true, 0], 'a port do Altium desenha igual (os dois bicos, 400 mil)');
eq(D.portGeom({ t:'port', net:'X', style:4, x:0, y:0 }).ang, 90, 'style 4 continua em pé');

/* ── 3. geometria ── */
const g = s => { const x = D.portNova({ sheet:'m', net:'WDT_UB', x:0, y:0, estilo:{ seta:s } }); return [D.portGeom(x).pontaEsq, D.portGeom(x).pontaDir]; };
eq([g('nenhuma'), g('esquerda'), g('direita'), g('ambos')], [[false, false], [true, false], [false, true], [true, true]], 'a seta decide as pontas');
const curto = D.portNova({ sheet:'m', net:'C2', x:0, y:0 }), longo = D.portNova({ sheet:'m', net:'SENSOR VP', x:0, y:0 });
ok(longo.w > curto.w, 'a largura automática acompanha o nome');
const grande = D.portNova({ sheet:'m', net:'C2', x:0, y:0, estilo:{ txtH:90 } });
ok(D.portGeom(grande).h > D.portGeom(curto).h && grande.w > curto.w, 'a letra maior engorda e alonga a barra');
const bb = D.portBBox(longo);
eq([bb.x1, bb.x2, bb.y1, bb.y2], [0, longo.w, -45, 45], 'a caixa de clique é o desenho');

/* ── 4. o desenho ── */
function ctxFalso(){
  const log = [];
  let st = { fillStyle:'', strokeStyle:'', lineWidth:1, font:'', textAlign:'' };
  const pilha = [];
  const c = { log, save(){ pilha.push(Object.assign({}, st)); }, restore(){ st = pilha.pop() || st; }, translate(){}, rotate(){}, scale(){},
    beginPath(){}, moveTo(){}, lineTo(){}, closePath(){},
    fill(){ log.push(['fill', st.fillStyle]); }, stroke(){ log.push(['stroke', st.strokeStyle, st.lineWidth]); },
    fillText(t, x, y){ log.push(['text', t, st.font, st.fillStyle, st.textAlign]); } };
  for (const k of Object.keys(st)) Object.defineProperty(c, k, { get: () => st[k], set: v => { st[k] = v; } });
  Object.defineProperty(c, 'lineJoin', { set(){}, get(){ return 'miter'; } });
  Object.defineProperty(c, 'textBaseline', { set(){}, get(){ return 'middle'; } });
  return c;
}
let cx = ctxFalso();
D.drawPort(cx, p);
eq(cx.log.find(l => l[0] === 'fill'), ['fill', '#ffffff'], 'o fundo branco');
eq(cx.log.find(l => l[0] === 'stroke'), ['stroke', '#1f3a93', 6], 'a borda azul escura, 6 mil');
const tx = cx.log.find(l => l[0] === 'text');
eq([tx[1], tx[2], tx[3], tx[4]], ['SLCK', '45px "Segoe UI", sans-serif', '#1f4fd1', 'center'], 'o texto azul centralizado');
cx = ctxFalso();
D.drawPort(cx, pp);
ok(!cx.log.some(l => l[0] === 'fill'), 'transparente: não pinta o fundo');
eq(cx.log.find(l => l[0] === 'text')[2], '60px "Arial", sans-serif', 'a fonte e o tamanho escolhidos');
cx = ctxFalso();
D.drawPort(cx, q);
eq(cx.log.find(l => l[0] === 'text').slice(2, 5), ['70px "Times New Roman", serif', '#00aa00', 'right'], 'Times, a cor e à direita');
cx = ctxFalso();
D.drawPort(cx, imp);
eq([cx.log.find(l => l[0] === 'fill')[1], cx.log.find(l => l[0] === 'stroke')[1], cx.log.find(l => l[0] === 'stroke')[2]],
   [D.SCH.portFill, D.SCH.port, 4], 'a importada: o amarelo e a borda de sempre');

/* ── 5. o schematic.js ── */
const sch = items => ({ format:'schmirror-v2', project:'t', units:'mil', items });
const arq = sch([{ t:'sheet', name:'m', size:'A4' }, p, pp, q]);
const so = Core.serializeSchematic(arq);
eq(so.errors, [], 'serializa');
eq(new Function(so.text + ';return schematic;')(), arq, 'e volta igual, com os campos novos');

/* ── 6. conectividade: o nome liga ── */
const lib = loadVar('Libs/schlib.js', 'schlib');
const SYM = 'DIODO TVS BIDIR [SMD]';
const comp = (ref, x) => ({ t:'comp', sheet:'m', ref, sym:SYM, part:1, x, y:1000, rot:0, mirror:false, footprint:'X' });
const base = extra => sch([{ t:'sheet', name:'m', size:'A4' }, comp('D1', 1000), comp('D2', 3000),
  { t:'wire', sheet:'m', pts:[[1200, 1000], [1400, 1000]] }, { t:'wire', sheet:'m', pts:[[2600, 1000], [2800, 1000]] }, ...extra]);
let N = Core.extractNets(base([D.portNova({ sheet:'m', net:'SDN', x:1400, y:1000 }), D.portNova({ sheet:'m', net:'SDN', x:2600, y:1000, estilo:{ seta:'esquerda', fill:'none' } })]), lib);
eq((N.nets.find(x => x.name === 'SDN') || {}).pins, ['D1-2', 'D2-1'], 'duas ports novas de mesmo nome: uma net');
N = Core.extractNets(base([D.portNova({ sheet:'m', net:'L3', x:1400, y:1000 }), { t:'netlabel', sheet:'m', net:'L3', x:2600, y:1000, rot:0 }]), lib);
eq((N.nets.find(x => x.name === 'L3') || {}).pins, ['D1-2', 'D2-1'], 'port nova e rótulo de mesmo nome: uma net');
N = Core.extractNets(base([D.portNova({ sheet:'m', net:'L1', x:1400, y:1000 }), D.portNova({ sheet:'m', net:'L4', x:2600, y:1000 })]), lib);
ok(!N.nets.some(x => x.pins && x.pins.length === 2), 'nomes diferentes: duas nets');

/* ── 7. o PDF do esquema ── */
global.HubPdfWriter = require('../hub-pdfwriter.js');
const S = require('../hub-schpdf.js');
const doc = HubPdfWriter.novo({ titulo:'t' });
const pg = doc.pagina(11693 * 0.0254, 8268 * 0.0254);
const pc = S.contexto(doc, pg, { largura:11693, altura:8268, unidade:0.0254 });
pc.setTransform(1, 0, 0, -1, 0, 8268);
D.drawPort(pc, D.portNova({ sheet:'m', net:'SENSOR VP', x:1000, y:1000 }));
D.drawPort(pc, Object.assign(D.portNova({ sheet:'m', net:'RST', x:1000, y:2000 }), { fonte:'Times New Roman' }));
const ops = pg.ops.join('\n');
ok(/SENSOR VP/.test(ops) && /RST/.test(ops), 'os nomes vão para o PDF');
ok(/Tf/.test(ops), 'como texto do PDF (Tf)');

/* ── 8. o MCP ── */
(async () => {
  const PROJ = 'LM555 astável';
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nexoeletric-port-'));
  const PROJETOS = path.join(TMP, 'Projects');
  fs.mkdirSync(PROJETOS);
  fs.cpSync(path.join(RAIZ, 'Projects', PROJ), path.join(PROJETOS, PROJ), { recursive: true });
  fs.writeFileSync(path.join(PROJETOS, PROJ, 'changes.js'), Core.serializeChanges([]).text);
  const pr = spawn(process.execPath, [path.join(RAIZ, 'mcp', 'eletrichub-mcp.js'), '--root', RAIZ, '--projetos', PROJETOS], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '', erro = '', id = 0;
  const espera = new Map();
  pr.stdout.setEncoding('utf8');
  pr.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (!l.trim()) continue; const m = JSON.parse(l); const w = espera.get(m.id); if (w) { espera.delete(m.id); w(m); } } });
  pr.stderr.on('data', d => { erro += d; });
  const pede = (method, params) => new Promise((res, rej) => { const k = ++id; const t = setTimeout(() => rej(new Error('sem resposta ' + method + '\n' + erro)), 120000); espera.set(k, m => { clearTimeout(t); res(m); }); pr.stdin.write(JSON.stringify({ jsonrpc:'2.0', id:k, method, params }) + '\n'); });
  const chama = async (name, args) => { const r = await pede('tools/call', { name, arguments: args }); assert.ok(r.result, name + ': ' + JSON.stringify(r.error)); return { j: JSON.parse(r.result.content[0].text), texto: r.result.content[0].text, erro: !!r.result.isError }; };
  try {
    await pede('initialize', { protocolVersion:'2025-06-18', capabilities:{}, clientInfo:{ name:'teste', version:'0' } });
    pr.stdin.write(JSON.stringify({ jsonrpc:'2.0', method:'notifications/initialized', params:{} }) + '\n');
    const lista = await pede('tools/list', {});
    ok(lista.result.tools.some(t => t.name === 'sch_port_estilo'), 'o MCP tem o sch_port_estilo');
    const SCH = path.join(PROJETOS, PROJ, 'schematic.js');
    const ler = () => new Function(fs.readFileSync(SCH, 'utf8') + ';return schematic;')();
    let r = await chama('sch_adicionar', { projeto: PROJ, itens: [{ t:'port', net:'SLCK', x:9000, y:6000 }, { t:'port', net:'C4', x:9000, y:5800 },
      { t:'port', net:'C3', x:9000, y:5600, estilo:{ seta:'ambos' } }] });
    ok(!r.erro, r.texto);
    let ports = ler().items.filter(it => it.t === 'port');
    eq(ports.map(x => [x.net, x.seta, x.fill, x.color, x.style]), [['SLCK', 'direita', '#ffffff', '#1f3a93', 2], ['C4', 'direita', '#ffffff', '#1f3a93', 2], ['C3', 'ambos', '#ffffff', '#1f3a93', 3]],
       'sch_adicionar: as ports no estilo da casa');
    r = await chama('sch_adicionar', { projeto: PROJ, itens: [{ t:'port', net:'X', x:9000, y:5000, estilo:{ seta:'cima' } }] });
    ok(r.erro && /seta/.test(r.texto), 'estilo ruim recusado: ' + r.texto.slice(0, 120));
    r = await chama('sch_port_estilo', { projeto: PROJ, nets: ['SLCK', 'C4'], estilo:{ fill:'#ffff00', textColor:'#000000', alinha:'esquerda', txtH:55 } });
    ok(!r.erro, r.texto);
    ports = ler().items.filter(it => it.t === 'port');
    eq(ports.map(x => [x.net, x.fill, x.alinha, x.txtH]), [['SLCK', '#ffff00', 'esquerda', 55], ['C4', '#ffff00', 'esquerda', 55], ['C3', '#ffffff', 'centro', 45]],
       'sch_port_estilo: só as pedidas, de uma vez');
    r = await chama('sch_port_estilo', { projeto: PROJ, nets: ['NADA'], estilo:{ fill:'none' } });
    ok(r.erro && /nenhuma port/.test(r.texto), 'nenhuma achada: avisa');
    r = await chama('sch_nets', { projeto: PROJ });
    ok(!r.erro, 'as nets continuam lendo com as ports novas');
  } finally {
    pr.stdin.end(); try { pr.kill(); } catch (e) {}
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  }
  console.log('test-port-estilo: ' + n + ' verificações ok');
})().catch(e => { console.error(e); process.exit(1); });
