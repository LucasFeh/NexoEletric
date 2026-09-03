const assert = require('assert');
const Bom = require('../hub-bom.js');
const Font = require('../hub-font.js');
const { loadVar } = require('./load');

const approx = (a, b, t) => Math.abs(a - b) <= (t || 1e-6);

/* Placa de teste: 20x20 mm, dois componentes iguais e um diferente, um deles no verso. */
const OUTLINE = [
  { kind:'line', x1:0,  y1:0,  x2:20, y2:0  },
  { kind:'line', x1:20, y1:0,  x2:20, y2:20 },
  { kind:'line', x1:20, y1:20, x2:0,  y2:20 },
  { kind:'line', x1:0,  y1:20, x2:0,  y2:0  },
];
const comp = (ref, layer, val, fp, x, y, pads) => ({
  id:'c' + ref, ref, footprint:fp, comment:val, layer, x, y, rot:0,
  bbox:{ x1:x-1, y1:y-1, x2:x+1, y2:y+1 }, pads: pads || [],
});
const board = (over) => Object.assign({
  board: { bbox:{ x1:0, y1:0, x2:20, y2:20 }, outline: OUTLINE },
  components: [], freepads: [], tracks: [], arcs: [], vias: [], regions: [],
  silk: [], texts: [],
}, over);

const B = board({
  components: [
    comp('R1', 'Top', '10k', 'RES 0805', 5, 5, [
      { id:'p1', name:'1', layer:'Top', type:'smd', shape:'rect', x:4.4, y:5, w:1, h:1.2, rot:0 },
      { id:'p2', name:'2', layer:'Top', type:'smd', shape:'rect', x:5.6, y:5, w:1, h:1.2, rot:0 },
    ]),
    comp('R10', 'Top', '10k', 'RES 0805', 9, 5),
    comp('R2', 'Bottom', '1k', 'RES 0805', 5, 15, [
      { id:'p3', name:'1', layer:'Multi', type:'th', shape:'circle', x:5, y:15, w:1.8, h:1.8,
        rot:0, drill:0.9, drillshape:'circle' },
    ]),
    /* no canto oposto da mesma face: e o par distante que a transicao guiada percorre */
    comp('C1', 'Top', '100n', 'CAP 0805', 17, 17),
    /* SMD so do verso, sem pad passante: e a peça que so existe na face escondida, e o unico
       caso em que a guiada em 3D precisa VIRAR a placa para mostra-la */
    comp('C2', 'Bottom', '22u', 'CAP 1206', 16, 4),
  ],
  /* o owner vem do board.js de verdade (ExportPcb marca de quem e cada primitivo); o s2 fica
     sem dono de proposito - contorno de placa e serigrafia solta existem */
  silk: [{ id:'s1', layer:'TopOverlay', kind:'line', x1:1, y1:1, x2:9, y2:1, w:0.2, owner:'R1' },
         { id:'s2', layer:'BottomOverlay', kind:'arc', cx:5, cy:15, r:1, sa:0, ea:180, w:0.2 }],
  texts: [{ id:'x1', layer:'TopOverlay', x:5, y:7, text:'R1', h:1, rot:0, mirror:false, designator:true, owner:'R1' },
          { id:'x2', layer:'TopOverlay', x:12, y:12, text:'TESTE', h:1, rot:0, mirror:false, designator:false }],
  tracks: [{ id:'t1', layer:'Top', x1:2, y1:2, x2:8, y2:2, w:0.5, net:'GND' },
           { id:'t2', layer:'Mid1', x1:2, y1:3, x2:8, y2:3, w:0.5 }],
  vias: [{ id:'v1', x:10, y:10, size:1.2, drill:0.6, net:'GND' }],
});

const m = Bom.model(B, {});

/* ═══════════════ lado ═══════════════
   Camada interna nao entra: quem monta a placa nao alcança ela, e desenhar por cima da
   frente so suja o que a pessoa esta procurando. */
assert.strictEqual(Bom.ladoDe('Top'), 0);
assert.strictEqual(Bom.ladoDe('TopOverlay'), 0);
assert.strictEqual(Bom.ladoDe('Bottom'), 1);
assert.strictEqual(Bom.ladoDe('BottomOverlay'), 1);
assert.strictEqual(Bom.ladoDe('Mid1'), null);
assert.strictEqual(m.tracks.length, 1, 'a trilha de camada interna nao entra');

/* ═══════════════ agrupamento ═══════════════ */
assert.strictEqual(m.stats.comps, 5);
assert.strictEqual(m.stats.frente, 3);
assert.strictEqual(m.stats.verso, 2);
assert.strictEqual(m.groups.length, 4, '10k/RES 0805 junta R1 e R10; o resto e um por grupo');

/* R2 antes de R10: ordem natural, senao a bancada procura na sequencia errada */
assert.deepStrictEqual(m.comps.map(c => c.ref), ['C1', 'C2', 'R1', 'R2', 'R10']);
const g10k = m.groups.find(g => g.val === '10k');
assert.strictEqual(g10k.qty, 2);
assert.deepStrictEqual(g10k.refs.map(i => m.comps[i].ref), ['R1', 'R10']);
/* o grupo cruza os dois lados de proposito: quem compra quer uma linha por peça */
const misto = Bom.model(board({ components: [
  comp('C1', 'Top', '100n', 'CAP 0805', 3, 3), comp('C2', 'Bottom', '100n', 'CAP 0805', 3, 8) ] }), {});
assert.strictEqual(misto.groups.length, 1, 'mesma peça em faces diferentes e uma compra so');
assert.strictEqual(misto.groups[0].qty, 2);

/* A chave do grupo separa valor de footprint por um caractere que nao aparece em nome:
   com espaco, val="A B"/fp="C" cairia no mesmo grupo que val="A"/fp="B C". */
const colide = Bom.model(board({ components: [
  Object.assign(comp("X1", "Top", "A B", "C", 3, 3)),
  Object.assign(comp("X2", "Top", "A", "B C", 6, 3)) ] }), {});
assert.strictEqual(colide.groups.length, 2, "valor e footprint diferentes nao podem virar um grupo so");

/* todo componente aponta para o seu grupo, e o grupo aponta de volta */
m.comps.forEach((c, i) => assert.ok(m.groups[c.g].refs.indexOf(i) >= 0, c.ref));

/* ═══════════════ geometria ═══════════════ */
/* pad passante aparece nos DOIS lados: s === -1 */
const th = m.pads.filter(p => p.th);
assert.strictEqual(th.length, 1);
assert.strictEqual(th[0].s, -1, 'pad passante nao pertence a um lado so');
assert.ok(th[0].h && th[0].h[0].length > 3, 'o furo sai junto, como poligono');
/* pad SMD fica no seu lado e nao tem furo */
const smd = m.pads.filter(p => !p.th);
assert.strictEqual(smd.length, 2);
assert.ok(smd.every(p => p.s === 0 && !p.h));
/* o contorno do pad e uma LISTA de poligonos fechados dentro da placa */
smd.forEach(p => {
  assert.ok(Array.isArray(p.p) && p.p.length >= 1);
  p.p.forEach(poly => {
    assert.ok(poly.length >= 4);
    poly.forEach(q => assert.ok(q[0] >= 0 && q[0] <= 20 && q[1] >= 0 && q[1] <= 20));
  });
});

/* ── a forma do pad e a UNIAO dos poligonos, nao o primeiro deles ──
   O primPolys devolve pedaços sobrepostos. Ficar so com polys[0] desenhava o retangulo
   INTERNO de um roundrect e, num oval mais alto que largo, so o disco de uma das pontas -
   fora do centro. Sao as duas formas que mais aparecem no acervo (132 pads), e nenhuma
   delas estava coberta porque o resto do teste so usa 'rect' e 'circle'. */
const uniao = g => {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  g.p.forEach(poly => poly.forEach(q => {
    x1 = Math.min(x1, q[0]); y1 = Math.min(y1, q[1]);
    x2 = Math.max(x2, q[0]); y2 = Math.max(y2, q[1]);
  }));
  return { w:x2-x1, h:y2-y1, cx:(x1+x2)/2, cy:(y1+y2)/2 };
};
/* oval em pe (h > w): o caso que virava um circulo deslocado */
const oval = uniao(Bom.padGeom({ shape:'oval', x:10, y:10, w:0.5, h:1, rot:0 }, false));
assert.ok(approx(oval.w, 0.5, 0.01) && approx(oval.h, 1, 0.01), 'oval em pe: ' + JSON.stringify(oval));
assert.ok(approx(oval.cx, 10, 0.01) && approx(oval.cy, 10, 0.01), 'oval centrado: ' + JSON.stringify(oval));
/* oval deitado (w > h) saia certo por acaso - tem que continuar certo */
const oval2 = uniao(Bom.padGeom({ shape:'oval', x:10, y:10, w:1, h:0.5, rot:0 }, false));
assert.ok(approx(oval2.w, 1, 0.01) && approx(oval2.h, 0.5, 0.01));
/* roundrect: saia encolhido de 2x o raio em cada eixo */
const rr = uniao(Bom.padGeom({ shape:'roundrect', x:5, y:5, w:4, h:1.5, radius:0.375, rot:0 }, false));
assert.ok(approx(rr.w, 4, 0.01) && approx(rr.h, 1.5, 0.01), 'roundrect: ' + JSON.stringify(rr));
assert.ok(approx(rr.cx, 5, 0.01) && approx(rr.cy, 5, 0.01));
/* girado 90 graus os eixos trocam */
const rr90 = uniao(Bom.padGeom({ shape:'roundrect', x:5, y:5, w:4, h:1.5, radius:0.375, rot:90 }, false));
assert.ok(approx(rr90.w, 1.5, 0.01) && approx(rr90.h, 4, 0.01), 'roundrect girado: ' + JSON.stringify(rr90));
/* octogono e circulo continuam com a caixa certa */
const oct = uniao(Bom.padGeom({ shape:'octagon', x:0, y:0, w:2, h:2, rot:0 }, false));
assert.ok(approx(oct.w, 2, 0.01) && approx(oct.h, 2, 0.01));
const cir = uniao(Bom.padGeom({ shape:'circle', x:0, y:0, w:1.8, h:1.8, rot:0 }, false));
assert.ok(approx(cir.w, 1.8, 0.02) && approx(cir.h, 1.8, 0.02));

/* componente com pad passante existe nas DUAS faces: sem a marca, o verso de uma placa toda
   passante desenha os pads e nao responde a clique nenhum */
assert.strictEqual(m.comps.find(c => c.ref === 'R2').t, 1);
assert.ok(!m.comps.find(c => c.ref === 'R1').t, 'componente so de SMD nao atravessa');

/* o contorno da placa vira UM laco fechado (4 segmentos encadeados) */
assert.strictEqual(m.outline.length, 1);
assert.ok(m.outline[0].length >= 5, 'laco fechado repete o primeiro ponto');

/* ═══════════════ texto ═══════════════
   O texto sai achatado em polilinha para a pagina nao precisar da fonte. Tem que ser
   exatamente o que o HubFont desenha, so que ja no mundo. */
const alvo = { x:5, y:7, text:'R1', h:1, rot:0, mirror:false };
const saiu = Bom.textoPolys(alvo);
const esperado = Font.textPolylines('R1', 1);
assert.strictEqual(saiu.length, esperado.length, 'mesma quantidade de tracos do HubFont');
saiu.forEach((poly, i) => {
  assert.strictEqual(poly.length, esperado[i].length);
  poly.forEach((pt, j) => {
    assert.ok(approx(pt[0], esperado[i][j][0] + 5, 0.001), 'x transladado');
    assert.ok(approx(pt[1], esperado[i][j][1] + 7, 0.001), 'y transladado');
  });
});
/* rotacao de 90 graus leva o eixo x local para o y do mundo */
const rot90 = Bom.textoPolys({ x:0, y:0, text:'R1', h:1, rot:90, mirror:false });
esperado.forEach((poly, i) => poly.forEach((pt, j) => {
  assert.ok(approx(rot90[i][j][0], -pt[1], 0.001));
  assert.ok(approx(rot90[i][j][1], pt[0], 0.001));
}));
/* espelho inverte so o x local */
const esp = Bom.textoPolys({ x:0, y:0, text:'R1', h:1, rot:0, mirror:true });
esperado.forEach((poly, i) => poly.forEach((pt, j) => {
  assert.ok(approx(esp[i][j][0], -pt[0], 0.001));
  assert.ok(approx(esp[i][j][1], pt[1], 0.001));
}));
/* texto vazio nao vira traco nenhum */
assert.deepStrictEqual(Bom.textoPolys({ x:0, y:0, text:'', h:1 }), []);

/* o designador sai marcado, para a pagina poder liga-lo e desliga-lo sozinho */
const designadores = m.silk.filter(s => s.d);
assert.ok(designadores.length > 0, 'o texto de designador vira silk com d=1');
assert.ok(m.silk.some(s => !s.d && s.k === 'l'), 'o silk comum continua sem a marca');
assert.ok(m.silk.some(s => s.k === 'a' && s.s === 1), 'arco de silk do verso entra');

/* O primitivo de serigrafia guarda o INDICE do dono, como o pad ja guardava: e por ele que a
   peça montada sai verde inteira - pad, serigrafia e furo - sem o desenho ter que adivinhar
   por geometria quem e de quem. Sem dono, o campo nem aparece: sao milhares de primitivos
   numa placa, e um campo vazio em cada um so incha o JSON. */
const iR1 = m.comps.findIndex(c => c.ref === 'R1');
assert.ok(m.silk.some(s => s.c === iR1 && !s.d), 'a linha de serigrafia do R1 sabe de quem e');
assert.ok(m.silk.some(s => s.c === iR1 && s.d), 'e o designador dele tambem');
assert.ok(m.silk.some(s => s.c === undefined), 'serigrafia sem dono nao ganha o campo a toa');

/* ═══════════════ a pagina ═══════════════ */
/* ── as opcoes da aba tem que chegar na pagina ──
   O runtime abria com um literal fixo, entao marcar "trilhas" na aba gerava uma pagina sem
   trilha nenhuma - seis das sete opcoes eram inertes. */
{
  const hv = Bom.html(Bom.model(B, { pads:false, silk:false, refs:false,
                                     tracks:true, regions:true, drills:false }), { proj:'x' });
  const ver = JSON.parse(hv.match(/"ver":(\{[^}]*\})/)[1]);
  assert.deepStrictEqual(ver, { pads:0, silk:0, refs:0, tracks:1, regions:1, drills:0 });
  assert.ok(/var mostra = D\.ver;/.test(hv), 'o runtime le o estado inicial de D.ver');
  assert.ok(hv.includes('data-ver="drills"'), 'a caixa de furos tem botao na pagina');
  ['pads','silk','refs','tracks','regions','drills'].forEach(k =>
    assert.ok(hv.includes('data-ver="' + k + '"'), 'sem botao para ' + k));
}

const h = Bom.html(m, { proj: 'PlacaTeste', generated: '01/09/2026' });
assert.ok(h.startsWith('<!doctype html>'));
assert.ok(h.includes('<title>BOM — PlacaTeste</title>'));
assert.ok(/id="cv0"/.test(h) && /id="cv1"/.test(h), 'os dois canvas');
assert.ok(/id="linhas"/.test(h), 'o corpo da tabela do BOM');
/* autossuficiente: nada de rede e nada de arquivo ao lado */
assert.ok(!/<script[^>]+src=/.test(h), 'nao pode referenciar script externo');
assert.ok(!/<link[^>]+href=/.test(h), 'nao pode referenciar css externo');
assert.ok(!/https?:\/\//.test(h.replace(/https?:\/\/www\.w3\.org[^"']*/g, '')), 'nada de URL externa');
/* nenhum caractere de controle cru no arquivo: um NUL perdido faz o git tratar o fonte como
   BINARIO e o diff some da revisao - foi o que aconteceu com o proprio hub-bom.js */
const controle = h.match(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g);
assert.strictEqual(controle, null, 'caractere de controle cru na pagina: ' + JSON.stringify(controle));

/* o JSON nao pode fechar a tag que o contem */
const hEvil = Bom.html(Bom.model(board({ components:[comp('R1', 'Top', '</script><b>x', 'F', 5, 5)] }), {}),
                       { proj: 'a</script>b' });
const linhaJson = hEvil.split('\n').find(l => l.indexOf('var D = ') >= 0);
assert.ok(linhaJson.indexOf('</script>') === linhaJson.length - '</script>'.length,
          'o unico </script> da linha e o que fecha o bloco');
assert.ok(linhaJson.includes('\\u003c'), '< virou escape dentro do JSON');
/* e o titulo escapa como HTML */
assert.ok(hEvil.includes('<title>BOM — a&lt;/script&gt;b</title>'));

/* os dois blocos de script tem que ser JS valido, e o modelo tem que voltar do JSON */
const blocos = [...hEvil.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x => x[1]);
assert.strictEqual(blocos.length, 2);
const D = new Function(blocos[0] + ';return D;')();
assert.strictEqual(D.comps[0].val, '</script><b>x', 'o valor volta inteiro do JSON');
new Function(blocos[1]);                               /* runtime parseia */

/* todo id que o runtime procura existe no HTML - senao a pagina abre morta */
const ids = [...new Set([...blocos[1].matchAll(/getElementById\('([^']+)'\)/g)].map(x => x[1]))];
assert.ok(ids.length >= 8);
ids.forEach(id => assert.ok(hEvil.includes('id="' + id + '"'), 'id ausente no HTML: ' + id));

assert.strictEqual(Bom.filename('TCMS_Reader'), 'TCMS_Reader-BOM.html');
assert.strictEqual(Bom.filename('a/b:c'), 'a_b_c-BOM.html', 'nome de arquivo sem caractere proibido');

/* placa sem board.js nao pode explodir - a aba trata, mas o modulo tambem */
const vazio = Bom.model({}, {});
assert.strictEqual(vazio.stats.comps, 0);
assert.strictEqual(vazio.bbox, null);
assert.ok(vazio.warnings.length, 'avisa que nao ha bbox');
assert.ok(Bom.html(vazio, {}).startsWith('<!doctype html>'));

/* ═══════════════ placa real ═══════════════ */
const fs = require('fs'), path = require('path');
if (fs.existsSync(path.join(__dirname, '..', 'Projects', 'TCMS_Reader', 'board.js'))) {
  const R = loadVar('Projects/TCMS_Reader/board.js', 'pcbmirror');
  const mr = Bom.model(R, {});
  assert.strictEqual(mr.warnings.length, 0, 'placa real nao deve avisar: ' + mr.warnings);
  assert.strictEqual(mr.stats.comps, R.components.length);
  assert.ok(mr.groups.length > 0 && mr.groups.length <= mr.stats.comps);
  /* a soma das quantidades tem que fechar com o total de componentes */
  assert.strictEqual(mr.groups.reduce((s, g) => s + g.qty, 0), mr.stats.comps);
  /* nenhum pad fora da placa (com folga de 1 mm para pad na borda) */
  const bb = R.board.bbox;
  mr.pads.forEach(p => p.p.forEach(poly => poly.forEach(q => {
    assert.ok(q[0] >= bb.x1 - 1 && q[0] <= bb.x2 + 1 && q[1] >= bb.y1 - 1 && q[1] <= bb.y2 + 1);
  })));
  const hr = Bom.html(mr, { proj: 'TCMS_Reader' });
  assert.ok(hr.length > 20000, 'a pagina real tem conteudo');
  new Function([...hr.matchAll(/<script>([\s\S]*?)<\/script>/g)][1][1]);
}

/* ═══════════════ o runtime da pagina ═══════════════
   A pagina gerada E o produto: se o runtime dela quebrar, nenhum teste de geometria percebe
   (o HTML continua saindo bonito e a placa abre em branco). Entao aqui ele roda de verdade,
   contra um DOM e um canvas de mentira, e o teste confere que desenhou e montou a lista. */
function montaAmbiente(){
  const ops = [];
  const ctx = {};
  ['setTransform','save','restore','translate','beginPath','moveTo',
   'lineTo','closePath','fill','stroke','arc','fillRect','strokeRect']
    .forEach(k => { ctx[k] = function(){ ops.push(k); }; });
  /* clearRect abre cada quadro: e o gancho para medir onde a placa esta DURANTE a animação */
  const amb = { aoLimpar: null };
  ctx.clearRect = function(){ ops.push('clearRect'); if (amb.aoLimpar) amb.aoLimpar(); };
  /* a escala do desenho e o único sinal daqui de que a câmera mudou de zoom */
  const escalas = [], cores = [];
  ctx.scale = function (sx, sy){ ops.push('scale'); escalas.push(sy); };
  /* a cor diz O QUE foi desenhado - e o único jeito, daqui, de separar substrato de cobre */
  ctx.fill = function (){ ops.push('fill'); cores.push(ctx.fillStyle); };
  ctx.stroke = function (){ ops.push('stroke'); cores.push(ctx.strokeStyle); };
  /* o arco guarda ONDE e DE QUE COR: o tique de montado e o único desenho em pixel de tela,
     e e por aqui que o teste confere que ele caiu em cima da peça certa. A cor separa o disco
     do tique dos outros arcos do desenho (silk, trilha em arco, via). */
  const arcos = [];
  ctx.arc = function (x, y, r){ ops.push('arc'); arcos.push([x, y, r, ctx.fillStyle]); };
  /* o retangulo diz COMO a peça montada e marcada: o entorno dela e um contorno, e nao mais
     um quadrado cheio por cima do que se quer conferir */
  const rets = [];
  ctx.fillRect = function (){ ops.push('fillRect'); rets.push(['fill', ctx.fillStyle]); };
  ctx.strokeRect = function (){ ops.push('strokeRect'); rets.push(['stroke', ctx.strokeStyle]); };
  const elems = {};
  /* textContent = '' limpa os filhos, como no DOM de verdade - sem isso a tabela
     acumularia as linhas de cada montaBom e o teste mediria lixo */
  const mk = (id) => ({
    id, className:'', value:'', checked:false, type:'',
    _txt:'',
    get textContent(){ return this._txt; },
    set textContent(v){ this._txt = v; if (v === '') this.children.length = 0; },
    style:{ display:'', props:{}, setProperty(k, v){ this.props[k] = v; } },
    dataset:{}, children:[], width:400, height:300,
    /* canvas dentro de pai display:none mede zero no navegador - sem isso o teste desenharia
       a face escondida e mediria a câmera errada. Vale para os dois jeitos de esconder: a
       classe 'oculta' de um layout de uma face só, e a regra #placas.tres-d .cv que apaga as
       duas vistas 2D enquanto o 3D está aberto. */
    escondido(){
      if (this._pai && this._pai.classes.has('oculta')) return true;
      return (this.id === 'cv0' || this.id === 'cv1') &&
             !!(elems.placas && elems.placas.classes.has('tres-d'));
    },
    get clientWidth(){ return this.escondido() ? 0 : 400; },
    get clientHeight(){ return this.escondido() ? 0 : 300; },
    classes:new Set(),
    get classList(){
      const self = this;
      return {
        toggle(k, v){ const on = v === undefined ? !self.classes.has(k) : !!v;
                      if (on) self.classes.add(k); else self.classes.delete(k); },
        contains(k){ return self.classes.has(k); },
        add(k){ self.classes.add(k); }, remove(k){ self.classes.delete(k); },
      };
    },
    appendChild(c){ this.children.push(c); return c; },
    append(...cs){ cs.forEach(c => this.children.push(c)); },
    setAttribute(k, v){ this[k] = v; }, getAttribute(k){ return this[k]; },
    ouvintes: {},
    addEventListener(ev, fn){ (this.ouvintes[ev] = this.ouvintes[ev] || []).push(fn); },
    removeEventListener(ev, fn){ this.ouvintes[ev] = (this.ouvintes[ev] || []).filter(f => f !== fn); },
    scrollIntoView(){}, focus(){}, setPointerCapture(){}, releasePointerCapture(){},
    getBoundingClientRect(){ return { left:0, top:0, width:400, height:300 }; },
    getContext(){ return ctx; },
    /* o mesmo pai sempre: com um novo a cada acesso, a classe que o aplicaLayout poe nele
       se perderia e o teste nao teria como ver o layout */
    get parentNode(){ return (this._pai = this._pai || mk('pai')); },
  });
  const doc = {
    getElementById(id){ return (elems[id] = elems[id] || mk(id)); },
    querySelector(sel){
      if (sel === '[data-m3="pos"]')
        return doc.querySelectorAll('[data-m3]').find(b => b.dataset.m3 === 'pos');
      if (!elems['@' + sel]) {
        const e = mk(sel);
        /* uma janela de 1000 px: com 400 o piso da lista satura e o teste nao mede nada */
        if (sel === 'main') e.getBoundingClientRect = () => ({ left:0, top:0, width:1000, height:600 });
        elems['@' + sel] = e;
      }
      return elems['@' + sel];
    },
    createElement(t){ return mk(t); },
    querySelectorAll(sel){
      if (sel === '[data-ver]')
        return (elems.__ver = elems.__ver || ['pads','silk','refs','tracks','regions','drills']
          /* trilhas e botao na barra de cima; as outras camadas sao caixa de marcar na gaveta */
          .map(k => { const e = mk('b'); e.dataset.ver = k;
                      if (k !== 'tracks') e.type = 'checkbox'; return e; }));
      if (sel === '[data-layout]')
        return (elems.__layout = elems.__layout ||
                ['lr','bom'].map(k => { const e = mk('b'); e.dataset.layout = k; return e; }));
      if (sel === '[data-modo]')
        return (elems.__modo = elems.__modo ||
                ['grupo','peca'].map(k => { const e = mk('b'); e.dataset.modo = k; return e; }));
      if (sel === '[data-m3]')
        return (elems.__m3 = elems.__m3 ||
                ['centrar','pos','p90','p180','p270','esp']
                  .map(k => { const e = mk('b'); e.dataset.m3 = k; return e; }));
      return [];
    },
    /* guarda TODO ouvinte de documento: os atalhos e o fecha-menu moram nele */
    ouvintes:{},
    addEventListener(ev, fn){
      if (ev === 'DOMContentLoaded') doc.__boot = fn;
      (doc.ouvintes[ev] = doc.ouvintes[ev] || []).push(fn);
    },
    dispara(ev, arg){ (doc.ouvintes[ev] || []).forEach(fn => fn(arg)); },
    body: mk('body'),
  };
  amb.ops = ops; amb.doc = doc; amb.elems = elems; amb.escalas = escalas; amb.cores = cores;
  amb.arcos = arcos; amb.rets = rets;
  return amb;
}

{
  const html = Bom.html(m, { proj: 'PlacaTeste' });
  const blocos = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x => x[1]);
  const amb = montaAmbiente();
  /* setTimeout guardado, e nao real: o filtro so mira depois que a digitacao para, e o
     teste precisa decidir a hora de "parar" */
  const pendentes = [];
  /* relógio de quadro: sem ele a transição guiada terminaria no primeiro passo e o teste
     nunca veria o caminho - que é justamente o que precisa ser conferido */
  let relogio = 0;
  const janela = {
    devicePixelRatio: 1,
    ouvintes: {},
    addEventListener(ev, fn){ (janela.ouvintes[ev] = janela.ouvintes[ev] || []).push(fn); },
    dispara(ev, arg){ (janela.ouvintes[ev] || []).forEach(fn => fn(arg)); },
    requestAnimationFrame(fn){ relogio += 16; fn(relogio); },
    confirm(){ return true; },
    setTimeout(fn){ pendentes.push(fn); return pendentes.length; },
    clearTimeout(id){ if (id) pendentes[id - 1] = null; },
    localStorage: { getItem(){ return null; }, setItem(){ throw new Error('origem opaca'); } },
  };
  const correTimers = () => {
    const fs = pendentes.filter(Boolean);
    pendentes.length = 0;
    fs.forEach(fn => fn());
  };
  /* o srcdoc da previa tem origem opaca e o localStorage LANCA - o runtime tem que aguentar */
  const rodar = new Function('document', 'window', 'localStorage', 'requestAnimationFrame',
                             'confirm', 'devicePixelRatio', 'setTimeout', 'clearTimeout',
                             blocos[0] + ';' + blocos[1] +
                             '; return { boot: document.__boot, v3: function(){ return v3; },' +
                             '   pr3: function (a,b,c){ return pr3(a,b,c); }, ladoV3: ladoV3,' +
                             '   cams0: function(){ return cams[0]; },' +
                             '   cams1: function(){ return cams[1]; } };');
  const r = rodar(amb.doc, janela, janela.localStorage, janela.requestAnimationFrame,
                  janela.confirm, 1, janela.setTimeout, janela.clearTimeout);
  assert.ok(typeof r.boot === 'function', 'o runtime registra o boot no DOMContentLoaded');
  r.boot();                                   /* e aqui a pagina abre */

  /* colunas da lista: 0 = #, 1 = visto, 2 = Qtd, 3 = Designadores, 4 = Footprint,
     5 = Comentário. O # ficou na ponta para nao ser lido junto com a Qtd. */
  const COL_REFS = 3, COL_VISTO = 1;

  const conta = k => amb.ops.filter(o => o === k).length;
  assert.ok(conta('fill') > 0, 'desenhou pad/regiao');
  assert.ok(conta('stroke') > 0, 'desenhou contorno/silk');
  assert.ok(conta('clearRect') >= 2, 'limpou os dois canvas');
  /* a lista do BOM tem que ter uma linha por grupo */
  assert.strictEqual(amb.elems.linhas.children.length, m.groups.length,
                     'uma linha por grupo na tabela');
  /* o rodape de contas fala dos numeros certos */
  assert.ok(amb.elems.contas.textContent.indexOf(m.stats.comps + ' comps') === 0,
            'contas: ' + amb.elems.contas.textContent);
  assert.ok(amb.elems.contas.textContent.indexOf('0 montados') > 0,
            'sem localStorage, nada aparece como montado');

  /* ── a vista por peça ── uma linha por designador, e nao por compra */
  const btPeca = amb.doc.querySelectorAll('[data-modo]').find(b => b.dataset.modo === 'peca');
  btPeca.onclick();
  assert.strictEqual(amb.elems.linhas.children.length, m.comps.length,
                     'na vista por peça e uma linha por componente');
  assert.ok(amb.elems.contas.textContent.indexOf('0 montados') > 0);
  const btGrupo = amb.doc.querySelectorAll('[data-modo]').find(b => b.dataset.modo === 'grupo');
  btGrupo.onclick();
  assert.strictEqual(amb.elems.linhas.children.length, m.groups.length, 'e volta a agrupar');

  /* ── o clique no pad acende a net ──
     Repete a conta da camera para mirar num pad conhecido: a placa e 20x20 com margem 2, num
     canvas de 400x300, entao a escala e 300/24 e o centro do mundo e (10,10). */
  const alvoPad = { x:4.4, y:5 };                        /* pad 1 do R1, net ausente */
  const esc = Math.min(400 / 24, 300 / 24), W = 400, H = 300;
  const sx = (alvoPad.x - 10) * esc + W/2, sy = H/2 - (alvoPad.y - 10) * esc;
  const cv0 = amb.elems.cv0;
  const disparar = (ev, x, y) => (cv0.ouvintes[ev] || []).forEach(fn =>
    fn({ clientX:x, clientY:y, buttons:1, pointerId:1, preventDefault(){}, deltaY:0, deltaMode:0 }));
  disparar('pointerdown', sx, sy);
  disparar('pointerup', sx, sy);
  /* o pad do R1 nao tem net no board de teste, mas o clique tem que ter achado o COMPONENTE */
  assert.ok(amb.elems.linhas.children.some(tr => tr.getAttribute('aria-selected') === 'true'),
            'clicar no pad seleciona a linha do dono dele');

  /* arrastar NAO pode virar clique: o limiar mede ate onde o botao desceu */
  const antes = amb.elems.linhas.children.filter(tr => tr.getAttribute('aria-selected') === 'true').length;
  disparar('pointerdown', sx, sy);
  disparar('pointermove', sx + 150, sy);
  disparar('pointerup', sx + 150, sy);
  assert.strictEqual(
    amb.elems.linhas.children.filter(tr => tr.getAttribute('aria-selected') === 'true').length,
    antes, 'o pan nao pode trocar a sele\u00e7\u00e3o no fim do arrasto');

  /* ── a lateral da lista ── largura e lado, os dois na mão de quem monta */
  const mn = amb.doc.querySelector('main'), botLado = amb.elems.ladoLista;
  /* a largura inicial sai da janela: 42% de 1000 */
  assert.strictEqual(mn.style.props['--bomw'], '420px',
                     'largura inicial sai da janela: ' + mn.style.props['--bomw']);
  assert.ok(!mn.classList.contains('esq'), 'a lista comeca a direita');

  botLado.onclick();
  assert.ok(mn.classList.contains('esq'), 'o icone troca o lado da lista');
  assert.ok(botLado.classList.contains('esq'), 'e o proprio icone espelha junto');
  botLado.onclick();
  assert.ok(!mn.classList.contains('esq'), 'e volta');

  /* arrastar a divisoria: com a lista a DIREITA, puxar para a esquerda aumenta a lista */
  const sp = amb.elems.hsplit;
  const dispSp = (ev, x) => (sp.ouvintes[ev] || []).forEach(fn =>
    fn({ clientX:x, clientY:0, pointerId:1, preventDefault(){} }));
  dispSp('pointerdown', 300);
  dispSp('pointermove', 200);
  assert.strictEqual(mn.style.props['--bomw'], '520px',
                     'lista a direita cresce ao arrastar para a esquerda: ' + mn.style.props['--bomw']);
  /* o teto guarda 240 px de desenho mais os 6 da divisoria: 1000 - 246 = 754 */
  dispSp('pointermove', -5000);
  assert.strictEqual(mn.style.props['--bomw'], '754px', 'o teto nao deixa o desenho sumir');
  dispSp('pointerup', 0);
  /* e o piso nao deixa a lista sumir */
  dispSp('pointerdown', 0);
  dispSp('pointermove', 5000);
  assert.strictEqual(mn.style.props['--bomw'], '200px', 'o piso nao deixa a lista sumir');
  dispSp('pointermove', 400);
  assert.strictEqual(mn.style.props['--bomw'], '354px', 'arrastar para a direita encolhe a lista');
  dispSp('pointerup', 0);

  /* com a lista na ESQUERDA o gesto inverte, e continua sendo o mesmo movimento da mao */
  botLado.onclick();
  dispSp('pointerdown', 0);
  dispSp('pointermove', 100);
  assert.strictEqual(mn.style.props['--bomw'], '454px',
                     'lista a esquerda cresce ao arrastar para a direita: ' + mn.style.props['--bomw']);
  dispSp('pointerup', 0);

  /* ── o tamanho da lista, num botão só que cicla ──
     O tamanho de sempre é o "pequena": ligar a página não pode mudar o que já estava bom. */
  const bom = amb.elems.bom, btFonte = amb.elems.btFonte;
  const tamanho = () => bom.classList.contains('f-g') ? 'g'
                      : bom.classList.contains('f-m') ? 'm' : 'p';
  assert.strictEqual(tamanho(), 'p', 'abre no tamanho de sempre');
  assert.strictEqual(btFonte.getAttribute('data-fonte'), 'p', 'e o botão mostra esse tamanho');
  assert.ok(/pequena/.test(btFonte.title), 'o title nomeia: ' + btFonte.title);
  /* cicla nos três e volta ao começo */
  const roda = [];
  for (let i = 0; i < 4; i++){ btFonte.onclick(); roda.push(tamanho()); }
  assert.deepStrictEqual(roda, ['m', 'g', 'p', 'm'], 'clicar percorre os três em ciclo');
  /* o botão acompanha a lista, sempre */
  assert.strictEqual(btFonte.getAttribute('data-fonte'), tamanho());
  assert.ok(/média/.test(btFonte.title), btFonte.title);
  btFonte.onclick(); btFonte.onclick();          /* volta ao pequeno */
  assert.strictEqual(tamanho(), 'p');

  /* ── a gaveta ── */
  const gv = amb.elems.gaveta, gvBg = amb.elems.gavetaBg;
  assert.ok(!gv.classList.contains('on'), 'a gaveta comeca fechada');
  amb.elems.btGaveta.onclick();
  assert.ok(gv.classList.contains('on') && gvBg.classList.contains('on'), 'o icone abre a gaveta');
  gvBg.onclick();
  assert.ok(!gv.classList.contains('on'), 'clicar fora fecha');
  amb.elems.btGaveta.onclick();
  amb.elems.gavetaFecha.onclick();
  assert.ok(!gv.classList.contains('on'), 'o X fecha');

  /* Trilhas e botao da BARRA (a unica camada que se mexe na bancada) e liga a camada de
     verdade: com trilha o desenho traça mais. As outras continuam caixa na gaveta. */
  const acha = k => amb.doc.querySelectorAll('[data-ver]').find(b => b.dataset.ver === k);
  const btT = acha('tracks');
  assert.notStrictEqual(btT.type, 'checkbox', 'trilhas e botao da barra, e nao caixa da gaveta');
  assert.strictEqual(acha('drills').type, 'checkbox', 'as outras camadas continuam caixas');
  assert.strictEqual(btT.getAttribute('aria-pressed'), 'false', 'e abre apagado');
  amb.ops.length = 0; btT.onclick();
  const comTrilha = amb.ops.filter(o => o === 'stroke').length;
  assert.strictEqual(btT.getAttribute('aria-pressed'), 'true', 'clicar acende o botao');
  amb.ops.length = 0; btT.onclick();
  const semTrilha = amb.ops.filter(o => o === 'stroke').length;
  assert.strictEqual(btT.getAttribute('aria-pressed'), 'false', 'e clicar de novo apaga');
  assert.ok(comTrilha > semTrilha,
            'o botao liga a camada: ' + comTrilha + ' contra ' + semTrilha + ' tracos');

  /* ── o visto pinta a PLACA, e nao so a linha ──
     Quem monta olha o desenho: a peça marcada fica verde e ganha o tique de conferida. Sem
     isto o visto era um estado que existia numa das duas telas so. */
  const primeira = () => amb.elems.linhas.children[0];
  const caixaDaLinha = tr => tr.children[COL_VISTO].children[0];
  const marca = v => { const cx = caixaDaLinha(primeira()); cx.checked = v;
                       amb.cores.length = 0; cx.onclick({ stopPropagation(){} }); };
  marca(true);
  assert.strictEqual(primeira().className, 'feito', 'marcou a linha como montada');
  assert.ok(amb.cores.includes(Bom.COR.feito), 'a peça montada sai no verde de montado');
  marca(false);
  assert.ok(!amb.cores.includes(Bom.COR.feito), 'desmarcar apaga o verde na hora');
  marca(true);

  /* o visto e por GRUPO ou por PEÇA: trocar a granularidade troca o que a placa mostra
     verde, senao o desenho contaria uma historia que a lista aberta nao conta */
  const botaoModo = k => amb.doc.querySelectorAll('[data-modo]').find(b => b.dataset.modo === k);
  amb.cores.length = 0; botaoModo('peca').onclick();
  assert.ok(!amb.cores.includes(Bom.COR.feito), 'visto de grupo nao pinta a lista por peça');
  amb.cores.length = 0; botaoModo('grupo').onclick();
  assert.ok(amb.cores.includes(Bom.COR.feito), 'e o verde volta ao reagrupar');

  /* ── e o tique cai EM CIMA da peça ──
     A placa entra limpa: um visto ja marcado poria o tique de outra peça na conta.
     A marca sai do sistema da placa: escrita em milimetros ela viria espelhada no verso e de
     cabeça para baixo. Quem confere isso aqui e o caminho de VOLTA - o mesmo c.mundo() que o
     clique usa: o centro do disco, desfeito pela camera, tem que dar a peça de novo. */
  marca(false);
  const marcaDaLinha = ref => {
    const tr = amb.elems.linhas.children.find(t =>
      t.children[COL_REFS] && t.children[COL_REFS].textContent.indexOf(ref) >= 0);
    const cx = caixaDaLinha(tr);
    amb.arcos.length = 0; cx.checked = true; cx.onclick({ stopPropagation(){} });
    const arcs = amb.arcos.filter(a => a[3] === Bom.COR.selo);
    cx.checked = false; cx.onclick({ stopPropagation(){} });
    return arcs;
  };
  const emCima = (p, x, y) => Math.abs(p.x - x) < 0.05 && Math.abs(p.y - y) < 0.05;
  const noTopo = marcaDaLinha('R1');            /* grupo do R1 com o R10, os dois na frente */
  assert.strictEqual(noTopo.length, 2, 'o visto do grupo poe um tique em cada peça dele');
  const ondeCaiu = noTopo.map(a => r.cams0().mundo(a[0], a[1]));
  assert.ok(ondeCaiu.some(q => emCima(q, 5, 5)) && ondeCaiu.some(q => emCima(q, 9, 5)),
            'cada tique no centro da sua peça: ' + JSON.stringify(ondeCaiu));
  assert.ok(noTopo.every(a => a[2] >= 3 && a[2] <= 9),
            'com raio de instrumento de tela, e nao de peça: ' + noTopo.map(a => a[2]));
  /* o verso e espelhado em X: em milimetros a marca cairia do outro lado da placa */
  const soNoVerso = marcaDaLinha('C2');        /* SMD do verso, sem pad passante */
  assert.strictEqual(soNoVerso.length, 1, 'peça de uma face so ganha um tique so');
  assert.ok(emCima(r.cams1().mundo(soNoVerso[0][0], soNoVerso[0][1]), 16, 4),
            'o tique do verso acompanha o espelho da camera de baixo');
  /* ── e a peça montada troca de cor NAS PROPRIAS formas ──
     Pad, serigrafia e furo saem em verde, e o entorno e so um contorno: o quadrado cheio de
     antes escondia justamente o que a bancada precisa ver para conferir a peça. */
  const trR1 = amb.elems.linhas.children.find(t =>
    t.children[COL_REFS] && t.children[COL_REFS].textContent.indexOf('R1') >= 0);
  const cxR1 = caixaDaLinha(trR1);
  amb.cores.length = 0; amb.rets.length = 0;
  cxR1.checked = true; cxR1.onclick({ stopPropagation(){} });
  const comVisto = amb.cores.slice(), retsCom = amb.rets.slice();
  amb.cores.length = 0;
  cxR1.checked = false; cxR1.onclick({ stopPropagation(){} });
  const semVisto = amb.cores.slice();
  const quantos = (a, c) => a.filter(x => x === c).length;
  assert.strictEqual(quantos(semVisto, Bom.COR.feito), 0, 'sem visto, nenhum verde na placa');
  assert.strictEqual(quantos(comVisto, Bom.COR[0].pad), quantos(semVisto, Bom.COR[0].pad) - 2,
                     'os dois pads do R1 saem do vermelho da frente');
  assert.ok(quantos(comVisto, Bom.COR.feito) >= 3,
            'e entram no verde, com a serigrafia dele junto: ' + quantos(comVisto, Bom.COR.feito));
  assert.ok(retsCom.some(r => r[0] === 'stroke' && r[1] === Bom.COR.feito),
            'o entorno da peça montada e um contorno');
  assert.ok(!retsCom.some(r => r[0] === 'fill' && r[1] === Bom.COR.feito),
            'e nao um quadrado cheio por cima dela');

  marca(true);                     /* e volta marcada, que e como o teste do modal segue */

  /* ── o modal proprio, no lugar do confirm do navegador ── */

  amb.elems.limpar.onclick();
  assert.ok(amb.elems.modalBg.classList.contains('on'), '"Limpar vistos" abre o modal');
  assert.ok(amb.elems.modalTit.textContent.length > 0 && amb.elems.modalTxt.textContent.length > 0,
            'o modal diz o que vai acontecer');
  amb.elems.modalNao.onclick();
  assert.ok(!amb.elems.modalBg.classList.contains('on'), '"Nao" fecha');
  assert.strictEqual(primeira().className, 'feito', 'e nao apaga nada');

  amb.elems.limpar.onclick();
  amb.elems.modalSim.onclick();
  assert.ok(!amb.elems.modalBg.classList.contains('on'), '"Sim" fecha');
  assert.strictEqual(primeira().className, '', '"Sim" desmarca tudo');

  /* ── visão guiada ──
     Desligada, escolher na lista NÃO pode mexer a câmera; ligada, ela vai até a peça. */
  /* o único sinal daqui de que a câmera mudou e a escala aplicada no ctx a cada desenho */
  const linhaDe = ref => amb.elems.linhas.children.find(tr =>
    tr.children[COL_REFS] && tr.children[COL_REFS].textContent.indexOf(ref) >= 0);

  const oculto = cv => amb.elems[cv].parentNode.classList.contains('oculta');
  /* pinta() desenha as duas câmeras; a que interessa e a de MAIOR zoom, que e a enquadrada */
  const maiorZoom = a => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

  /* guiada DESLIGADA (o padrao): escolher na lista nao pode mover a câmera nem trocar a vista.
     Sao linhas DIFERENTES de proposito - clicar duas vezes na mesma so desfaz a seleção. */
  amb.escalas.length = 0;
  linhaDe('R1').onclick();
  const semGuia = maiorZoom(amb.escalas);
  amb.escalas.length = 0;
  linhaDe('R2').onclick();
  assert.strictEqual(maiorZoom(amb.escalas), semGuia, 'sem visão guiada a câmera fica onde estava');
  assert.ok(!oculto('cv0') && !oculto('cv1'), 'e as duas faces continuam na tela');

  /* liga pela gaveta com nada selecionado, para o próprio ligar nao enquadrar */
  linhaDe('R2').onclick();                       /* desfaz a seleção */
  const cbG = amb.elems.cbGuiada;
  cbG.checked = true; cbG.onclick();

  /* peça da FRENTE (R1/R10 sao Top): a vista vai para a frente, e nao para as duas */
  amb.escalas.length = 0;
  linhaDe('R1').onclick();
  assert.ok(amb.escalas.length, 'redesenhou ao guiar');
  assert.ok(!oculto('cv0') && oculto('cv1'), 'peça do topo -> só a frente na tela');
  assert.ok(maiorZoom(amb.escalas) > semGuia,
            'guiada dá zoom na peça: ' + maiorZoom(amb.escalas) + ' contra ' + semGuia);

  /* peça do VERSO (R2 e Bottom): a vista vira para o verso */
  linhaDe('R2').onclick();
  assert.ok(oculto('cv0') && !oculto('cv1'), 'peça do verso -> só o verso na tela');

  /* ── a transição ──
     Ir de uma peça a outra tem que AFASTAR no caminho: o campo de visão cresce no meio e volta
     a fechar no destino. Em escala, isso é o zoom passar por um mínimo menor que as duas
     pontas. É o que deixa o olho seguir de R1 até C1 em vez de perder a referência. */
  const zoomFinal = () => Math.abs(amb.escalas[amb.escalas.length - 1]);
  linhaDe('R1').onclick();                       /* grupo 10k, no canto de baixo à esquerda */
  const zoomR1 = zoomFinal();
  amb.escalas.length = 0;
  linhaDe('C1').onclick();                       /* 100n, no canto oposto da mesma face */
  const zoomC1 = zoomFinal();
  const minimo = amb.escalas.reduce((m, v) => Math.min(m, Math.abs(v)), Infinity);
  assert.ok(amb.escalas.length > 8,
            'a transição desenha vários quadros, e não um salto: ' + amb.escalas.length);
  assert.ok(minimo < Math.min(zoomR1, zoomC1) * 0.8,
            'tem que afastar no caminho: mínimo ' + minimo.toFixed(1) +
            ' contra pontas ' + zoomR1.toFixed(1) + '/' + zoomC1.toFixed(1));
  /* e termina exatamente no alvo, sem sobra */
  const alvoC1 = 300 / (2 * 1.6 + 2);            /* bbox de 2 mm, mesma folga do zoomToObj */
  assert.ok(Math.abs(zoomC1 - alvoC1) < 0.01,
            'a transição para no enquadramento certo: ' + zoomC1.toFixed(2) + ' x ' + alvoC1.toFixed(2));

  /* pegar a placa na mão interrompe a viagem */
  linhaDe('R1').onclick();
  amb.escalas.length = 0;
  (amb.elems.cv0.ouvintes.pointerdown || []).forEach(fn =>
    fn({ clientX:10, clientY:10, pointerId:1, preventDefault(){} }));
  const depoisDoToque = amb.escalas.length;
  janela.requestAnimationFrame(() => {});       /* deixa passar um quadro */
  assert.strictEqual(amb.escalas.length, depoisDoToque,
                     'a transição para quando a mão pega a placa');

  /* ── o ícone único das faces ──
     Por invariante, e nao por estado absoluto: a ordem dos blocos acima muda qual face esta
     na tela, e um teste preso a ela quebra por motivo errado. */
  const bf = amb.elems.btFace;
  const noVerso = () => oculto('cv0') && !oculto('cv1');
  const naFrente = () => !oculto('cv0') && oculto('cv1');
  amb.doc.querySelectorAll('[data-layout]').find(b => b.dataset.layout === 'lr').onclick();
  assert.ok(!oculto('cv0') && !oculto('cv1'), 'as duas na tela');
  bf.onclick();
  assert.ok(noVerso() || naFrente(), 'de "as duas", o ícone leva a uma face só');
  assert.strictEqual(bf.classList.contains('verso'), noVerso(),
                     'o desenho do ícone mostra a face que está na tela');
  const eraVerso = noVerso();
  bf.onclick();
  assert.strictEqual(noVerso(), !eraVerso, 'clicar troca para a outra face');
  assert.strictEqual(bf.classList.contains('verso'), noVerso(), 'e o desenho acompanha');
  amb.doc.querySelectorAll('[data-layout]').find(b => b.dataset.layout === 'lr').onclick();

  /* o filtro também guia: "R10" e um designador exato */
  amb.elems.filtro.value = 'R10';
  amb.elems.filtro.oninput({ target:{ value:'R10' } });
  amb.escalas.length = 0;
  correTimers();                       /* a digitação "parou" */
  assert.ok(amb.escalas.length, 'o filtro mira sozinho quando a digitação para');
  assert.ok(amb.elems.linhas.children.some(tr => tr.getAttribute('aria-selected') === 'true'),
            'e deixa a linha selecionada');
  /* Enter não espera o tempo */
  amb.elems.filtro.oninput({ target:{ value:'R2' } });
  amb.escalas.length = 0;
  amb.elems.filtro.onkeydown({ key:'Enter' });
  assert.ok(amb.escalas.length, 'Enter mira na hora');
  /* escolher a mão DEPOIS de digitar desarma o tiro pendente: sem isso, digitar "R" e clicar
     numa peça fazia o filtro atropelar a escolha 350 ms depois, e ainda mexer na câmera */
  amb.elems.filtro.oninput({ target:{ value:'R' } });
  linhaDe('R2').onclick();
  const selDepois = amb.elems.linhas.children
    .filter(tr => tr.getAttribute('aria-selected') === 'true').map(tr => tr.dataset.k);
  amb.escalas.length = 0;
  correTimers();
  assert.strictEqual(amb.escalas.length, 0, 'o tiro do filtro não pode disparar depois da escolha');
  assert.deepStrictEqual(amb.elems.linhas.children
    .filter(tr => tr.getAttribute('aria-selected') === 'true').map(tr => tr.dataset.k), selDepois,
    'e não pode trocar a linha escolhida');
  amb.elems.filtro.oninput({ target:{ value:'' } });

  /* e com a guiada desligada o filtro só filtra */
  cbG.checked = false; cbG.onclick();
  amb.elems.filtro.oninput({ target:{ value:'R1' } });
  amb.escalas.length = 0;
  amb.elems.filtro.onkeydown({ key:'Enter' });
  assert.strictEqual(amb.escalas.length, 0, 'desligada, o filtro não mexe na câmera');
  amb.elems.filtro.oninput({ target:{ value:'' } });
  cbG.checked = true; cbG.onclick();

  /* ── reabrir o arquivo com a guiada LIGADA na sessão anterior ──
     A caixa da gaveta tem que abrir marcada. Antes ela vinha do HTML (gerado desligado) e
     mentia sobre o estado real, e o primeiro clique só remarcava a caixa sem desligar nada. */
  {
    const amb2 = montaAmbiente();
    const cofre = { 'altiumbom.PlacaTeste.ui':
      JSON.stringify({ lado:'dir', w:0, guiada:true, fonte:'g' }) };
    const janela2 = Object.assign({}, janela, {
      localStorage: { getItem: k => (k in cofre ? cofre[k] : null),
                      setItem: (k, v) => { cofre[k] = v; } },
    });
    const r2 = rodar(amb2.doc, janela2, janela2.localStorage, janela2.requestAnimationFrame,
                     janela2.confirm, 1, janela2.setTimeout, janela2.clearTimeout);
    r2.boot();
    assert.strictEqual(amb2.elems.cbGuiada.checked, true,
                       'a caixa abre marcada quando a sessão anterior deixou a guiada ligada');
    /* mesma armadilha, outro controle: o tamanho gravado tem que valer NA LISTA e aparecer
       no botão - marcar "Pequena" com a lista grande seria mentir sobre o estado */
    assert.ok(amb2.elems.bom.classList.contains('f-g'), 'a lista abre no tamanho gravado');
    assert.strictEqual(amb2.elems.btFonte.getAttribute('data-fonte'), 'g',
                       'e o botão mostra o tamanho gravado, e não o do HTML emitido');
    /* e um clique só desliga de verdade: escolher na lista deixa de mover a câmera */
    amb2.elems.cbGuiada.checked = false;
    amb2.elems.cbGuiada.onclick();
    const linha2 = ref => amb2.elems.linhas.children.find(tr =>
      tr.children[COL_REFS] && tr.children[COL_REFS].textContent.indexOf(ref) >= 0);
    amb2.escalas.length = 0;
    linha2('R1').onclick();
    const antes2 = amb2.escalas.slice();
    amb2.escalas.length = 0;
    linha2('C1').onclick();
    assert.deepStrictEqual(amb2.escalas, antes2,
                           'um clique na caixa desliga a guiada de verdade');
  }

  /* ── a vista 3D ──
     A placa é 2,5D: tudo mora em três alturas, e por isso o pintor resolve a oclusão sem
     z-buffer. O que dá para conferir daqui é a projeção (exata) e o que foi desenhado (pela
     cor de cada preenchimento). */
  {
    const v3 = r.v3(), cams0 = r.cams0;
    /* clicar na linha ja selecionada desfaz a seleção - limpar antes evita esse tropeco */
    const escolheNada = () => {
      const sel = amb.elems.linhas.children.find(tr => tr.getAttribute('aria-selected') === 'true');
      if (sel) sel.onclick();
    };
    const perto = (a, b) => Math.abs(a - b) < 1e-9;
    /* onde o centro da placa cai na tela, pela mesma conta que o desenho usa */
    const centroNaTela = () => {
      const b = m.bbox;
      const p = r.pr3((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, 0);
      const W = amb.elems.cv3.clientWidth, H = amb.elems.cv3.clientHeight;
      return [W/2 + (p[0] - v3.cx) * v3.esc, H/2 - (p[1] - v3.cy) * v3.esc];
    };
    const noMeio = (msg) => {
      const c = centroNaTela();
      const W = amb.elems.cv3.clientWidth, H = amb.elems.cv3.clientHeight;
      assert.ok(Math.abs(c[0] - W/2) < 1e-9 && Math.abs(c[1] - H/2) < 1e-9,
                msg + ': ' + c.map(v => v.toFixed(2)).join(', '));
    };

    /* de cima (pitch 90°) a projeção é a identidade em XY e a espessura desaparece */
    v3.yaw = 0; v3.pitch = Math.PI / 2;
    assert.ok(perto(r.pr3(10, 20, 0)[0], 10) && perto(r.pr3(10, 20, 0)[1], 20),
              'de cima, a projeção é o próprio XY');
    assert.ok(perto(r.pr3(0, 0, 0.8)[1], 0), 'e a espessura não aparece');
    /* de lado (pitch 0) o Y desaparece e quem manda é a espessura */
    v3.pitch = 0;
    assert.ok(perto(r.pr3(0, 10, 0)[1], 0), 'de lado, o Y some');
    assert.ok(perto(r.pr3(0, 0, 0.8)[1], 0.8), 'e a espessura vira a altura na tela');
    /* girar troca os eixos */
    v3.yaw = Math.PI / 2; v3.pitch = Math.PI / 2;
    assert.ok(perto(r.pr3(10, 0, 0)[1], 10), 'yaw de 90° leva o X para o Y');
    /* o sinal do pitch é o lado que se vê */
    v3.pitch = 0.9;  assert.strictEqual(r.ladoV3(), 0, 'olhando de cima, vê-se a frente');
    v3.pitch = -0.9; assert.strictEqual(r.ladoV3(), 1, 'olhando de baixo, vê-se o verso');

    /* o quadradinho liga o 3D e desenha a placa */
    amb.ops.length = 0; amb.cores.length = 0;
    amb.elems.d3f.onclick();
    assert.ok(v3.on, 'o quadradinho liga o 3D');
    assert.ok(amb.elems.placas.classList.contains('tres-d'), 'e a área troca de vista');
    assert.strictEqual(r.ladoV3(), 0, 'o quadradinho da frente entra por cima');
    /* e ABRE na pose de origem: reta, virada para cima e centrada - abrir de esguelha
       obrigaria a centralizar antes de olhar qualquer coisa */
    assert.strictEqual(v3.yaw, 0, 'o 3D abre com a placa reta');
    assert.ok(perto(Math.abs(v3.pitch), Math.PI/2), 'e virada para cima');
    noMeio('o 3D abre com a placa centrada');
    assert.ok(amb.ops.filter(o => o === 'fill').length > 10, 'desenhou o substrato e o cobre');
    /* parede, face e metal têm que aparecer: é o que faz a placa parecer uma placa */
    assert.ok(amb.cores.includes('#0d4a22'), 'a parede do FR4 (a espessura)');
    assert.ok(amb.cores.includes('#176a32'), 'a face de cima');
    assert.ok(amb.cores.includes('#d7d9de'), 'o metal dos pads');
    assert.ok(v3.esc > 0 && isFinite(v3.cx) && isFinite(v3.cy), 'enquadrou a placa');

    /* ── navegação no molde do Altium: esquerdo move, direito gira ── */
    const d3 = (ev, arg) => (amb.elems.cv3.ouvintes[ev] || []).forEach(f => f(arg));
    /* onde o pivô está na tela, pela mesma conta que o desenho usa */
    const telaDoPivo = () => {
      const p = r.pr3(v3.piv[0], v3.piv[1], 0);
      const W = amb.elems.cv3.clientWidth, H = amb.elems.cv3.clientHeight;
      return [W/2 + (p[0] - v3.cx) * v3.esc, H/2 - (p[1] - v3.cy) * v3.esc];
    };

    /* o ESQUERDO move a vista, e não gira */
    const cx0 = v3.cx, yaw0 = v3.yaw, pitch0 = v3.pitch;
    d3('pointerdown', { button:0, clientX:0, clientY:0, pointerId:1, preventDefault(){} });
    d3('pointermove', { clientX:40, clientY:25 });
    assert.ok(Math.abs(v3.cx - cx0) > 1e-9, 'o botão esquerdo move a vista');
    assert.strictEqual(v3.yaw, yaw0, 'e não gira');
    assert.strictEqual(v3.pitch, pitch0);
    d3('pointerup', {});
    assert.strictEqual(v3.piv, null, 'mover não acende pivô nenhum');

    /* o DIREITO gira em torno do ponto clicado, e marca o pivô na tela */
    amb.cores.length = 0;
    d3('pointerdown', { button:2, clientX:120, clientY:90, pointerId:1, preventDefault(){} });
    assert.ok(v3.piv, 'o botão direito fixa um pivô');
    const nasceu = telaDoPivo();
    assert.ok(Math.abs(nasceu[0] - 120) < 0.01 && Math.abs(nasceu[1] - 90) < 0.01,
              'o pivô nasce exatamente sob o cursor: ' + nasceu.map(v => v.toFixed(2)).join(', '));
    assert.ok(amb.cores.includes('#eaeaea'), 'a esfera com a cruz aparece enquanto se segura');

    const yaw1 = v3.yaw;
    d3('pointermove', { clientX:180, clientY:60 });
    assert.ok(Math.abs(v3.yaw - yaw1) > 0.1, 'arrastar com o direito gira');
    const depois = telaDoPivo();
    /* ESTE é o ponto do exercício: girar em torno do que se está olhando. Se o pivô sair do
       lugar, a placa foge do cursor e a pessoa perde o que mirava. */
    assert.ok(Math.abs(depois[0] - 120) < 0.01 && Math.abs(depois[1] - 90) < 0.01,
              'o pivô fica parado no mesmo pixel enquanto gira: ' +
              depois.map(v => v.toFixed(2)).join(', '));

    /* passar do plano vira a placa e mostra o verso */
    d3('pointermove', { clientX:180, clientY:460 });
    assert.strictEqual(r.ladoV3(), 1, 'arrastar para baixo vira a placa e mostra o verso');
    d3('pointerup', {});
    assert.strictEqual(v3.piv, null, 'soltando, a esfera some');
    amb.cores.length = 0;
    d3('wheel', { deltaY:0, deltaMode:0, clientX:100, clientY:80, preventDefault(){} });
    assert.ok(!amb.cores.includes('#eaeaea'), 'e não volta a ser desenhada');
    /* evento sem coordenada nao pode levar NaN para a camera - dali em diante a placa
       simplesmente sumiria */
    d3('wheel', { deltaY:-100, deltaMode:0, preventDefault(){} });
    assert.ok(isFinite(v3.cx) && isFinite(v3.cy), 'a camera sobrevive a um evento capenga');

    /* a roda amplia ancorada no cursor: o ponto sob o ponteiro não sai do lugar */
    v3.pitch = 0.9;
    const soltaWheel = { deltaY:-200, deltaMode:0, clientX:150, clientY:110, preventDefault(){} };
    const noCursor = () => {
      const W = amb.elems.cv3.clientWidth, H = amb.elems.cv3.clientHeight;
      return [(150 - W/2) / v3.esc + v3.cx, -(110 - H/2) / v3.esc + v3.cy];
    };
    const esc0 = v3.esc, alvo = noCursor();
    d3('wheel', soltaWheel);
    const alvo2 = noCursor();
    assert.ok(v3.esc > esc0, 'a roda aproxima');
    assert.ok(Math.abs(alvo2[0] - alvo[0]) < 1e-9 && Math.abs(alvo2[1] - alvo[1]) < 1e-9,
              'e o ponto sob o cursor fica onde estava');

    /* ── atalhos e menu do clique direito ── */
    /* ── virar a face espelha em X, e não em Y ──
       É a mesma convenção da vista "Verso" 2D. Só inverter a inclinação espelharia o Y, e a
       mesma placa apareceria espelhada de um jeito no 2D e de outro no 3D. */
    amb.elems.d3off.onclick(); amb.elems.d3f.onclick();     /* pose de origem */
    const antesX = r.pr3(30, 10, 0), antesY = r.pr3(10, 30, 0);
    amb.doc.dispara('keydown', { key:'f', ctrlKey:true, target:{ tagName:'BODY' }, preventDefault(){} });
    const depoisX = r.pr3(30, 10, 0), depoisY = r.pr3(10, 30, 0);
    assert.ok(Math.abs(depoisX[0] + antesX[0]) < 1e-9, 'o X inverte de sinal');
    assert.ok(Math.abs(depoisY[1] - antesY[1]) < 1e-9, 'e o Y não');
    amb.doc.dispara('keydown', { key:'f', ctrlKey:true, target:{ tagName:'BODY' }, preventDefault(){} });

    /* ── C: a placa volta CENTRADA e RETA, e não só reenquadrada no ângulo torto ── */
    amb.elems.d3off.onclick(); amb.elems.d3f.onclick();
    /* tomba a vista de todo jeito: gira e arrasta para longe */
    d3('pointerdown', { button:2, clientX:100, clientY:80, pointerId:1, preventDefault(){} });
    d3('pointermove', { clientX:190, clientY:40 });
    d3('pointerup', { clientX:190, clientY:40 });
    d3('pointerdown', { button:0, clientX:0, clientY:0, pointerId:1, preventDefault(){} });
    d3('pointermove', { clientX:90, clientY:70 });
    d3('pointerup', { clientX:90, clientY:70 });
    assert.ok(Math.abs(v3.yaw) > 0.1, 'a vista ficou torta');
    const foraDoCentro = centroNaTela();
    assert.ok(Math.abs(foraDoCentro[0] - 200) > 1, 'e fora do centro');

    amb.doc.dispara('keydown', { key:'c', target:{ tagName:'BODY' } });
    assert.strictEqual(v3.yaw, 0, 'C põe a placa reta');
    assert.ok(Math.abs(Math.abs(v3.pitch) - Math.PI/2) < 1e-9, 'e virada para cima, como no 2D');
    const W3 = amb.elems.cv3.clientWidth, H3 = amb.elems.cv3.clientHeight;
    noMeio('e o centro da placa cai no centro da tela');
    /* a FACE é preservada: quem confere o verso não pode ser jogado para a frente */
    const face = r.ladoV3();
    amb.doc.dispara('keydown', { key:'f', ctrlKey:true, target:{ tagName:'BODY' }, preventDefault(){} });
    amb.doc.dispara('keydown', { key:'c', target:{ tagName:'BODY' } });
    assert.strictEqual(r.ladoV3(), face ? 0 : 1, 'centralizar não troca a face');
    amb.doc.dispara('keydown', { key:'f', ctrlKey:true, target:{ tagName:'BODY' }, preventDefault(){} });

    /* ── Ctrl+F vira a face SEM tirar a placa do lugar ──
       Inverter a inclinação espelha o eixo Y da projeção: sem recolocar a câmera, uma placa
       centrada em Y = 40 mm saltaria para -40. Quem virou queria o outro lado do que estava
       olhando, e não caçar a placa de novo. */
    d3('pointerdown', { button:0, clientX:0, clientY:0, pointerId:1, preventDefault(){} });
    d3('pointermove', { clientX:70, clientY:-45 });     /* sai do centro de propósito */
    d3('pointerup', { clientX:70, clientY:-45 });
    d3('wheel', { deltaY:-120, deltaMode:0, clientX:150, clientY:110, preventDefault(){} });
    const ondeEstava = centroNaTela(), escAntes = v3.esc;
    const antesLado = r.ladoV3(), yawAntesF = v3.yaw;
    let barrou = false;
    amb.doc.dispara('keydown', { key:'f', ctrlKey:true, target:{ tagName:'BODY' },
                                 preventDefault(){ barrou = true; } });
    assert.strictEqual(r.ladoV3(), antesLado ? 0 : 1, 'Ctrl+F vira a face');
    assert.ok(barrou, 'e impede a busca do navegador');
    assert.ok(Math.abs(((v3.yaw - yawAntesF) % (2*Math.PI) + 2*Math.PI) % (2*Math.PI) - Math.PI) < 1e-9,
              'e dá meia volta junto, como a mão faz ao virar a placa');
    const ondeFicou = centroNaTela();
    assert.ok(Math.abs(ondeFicou[0] - ondeEstava[0]) < 1e-9 &&
              Math.abs(ondeFicou[1] - ondeEstava[1]) < 1e-9,
              'e a placa fica exatamente onde estava: ' +
              ondeEstava.map(v => v.toFixed(2)).join(', ') + ' -> ' +
              ondeFicou.map(v => v.toFixed(2)).join(', '));
    assert.strictEqual(v3.esc, escAntes, 'e no mesmo zoom');
    amb.doc.dispara('keydown', { key:'f', ctrlKey:true, target:{ tagName:'BODY' },
                                 preventDefault(){} });

    /* digitando no filtro, letra e letra: nao pode virar atalho */
    const cxAntes = v3.cx;
    d3('pointerdown', { button:0, clientX:0, clientY:0, pointerId:1, preventDefault(){} });
    d3('pointermove', { clientX:70, clientY:0 });
    d3('pointerup', { clientX:70, clientY:0 });
    amb.doc.dispara('keydown', { key:'c', target:{ tagName:'INPUT' } });
    assert.ok(Math.abs(v3.cx - cxAntes) > 1e-9, 'C dentro de um campo não centraliza');

    /* clique direito RÁPIDO abre o menu no ponto clicado */
    const menu = amb.elems.menu3;
    d3('pointerdown', { button:2, clientX:200, clientY:140, pointerId:1, preventDefault(){} });
    d3('pointerup', { clientX:202, clientY:141 });
    assert.ok(menu.classList.contains('on'), 'o clique direito rápido abre o menu');
    assert.strictEqual(menu.style.left, '202px', 'no ponto clicado');
    assert.strictEqual(menu.style.top, '141px');
    /* arrastar com o direito gira, e NÃO abre menu */
    menu.classList.remove('on');
    d3('pointerdown', { button:2, clientX:200, clientY:140, pointerId:1, preventDefault(){} });
    d3('pointermove', { clientX:260, clientY:140 });
    d3('pointerup', { clientX:260, clientY:140 });
    assert.ok(!menu.classList.contains('on'), 'arrastar não abre menu');

    /* os dois itens do menu */
    const item = k => amb.doc.querySelectorAll('[data-m3]').find(b => b.dataset.m3 === k);
    d3('pointerdown', { button:0, clientX:0, clientY:0, pointerId:1, preventDefault(){} });
    d3('pointermove', { clientX:80, clientY:60 });
    d3('pointerup', { clientX:80, clientY:60 });
    item('centrar').onclick();
    /* por invariante: depois de girar, o enquadramento certo NÃO e mais o de antes - o que
       tem que valer e que centralizar leve sempre ao MESMO lugar, saindo de onde for */
    const centrado = [v3.cx, v3.cy, v3.esc];
    d3('pointerdown', { button:0, clientX:0, clientY:0, pointerId:1, preventDefault(){} });
    d3('pointermove', { clientX:-55, clientY:40 });
    d3('pointerup', { clientX:-55, clientY:40 });
    assert.ok(Math.abs(v3.cx - centrado[0]) > 1e-9, 'saiu do lugar de novo');
    item('centrar').onclick();
    assert.deepStrictEqual([v3.cx, v3.cy, v3.esc], centrado,
                           '"Centralizar" leva sempre ao mesmo enquadramento');
    /* ── o submenu "Posicionar" ── */
    const sub = amb.elems.sub3, pai = item('pos');
    assert.ok(!sub.classList.contains('on'), 'o submenu comeca fechado');
    pai.onclick();
    assert.ok(sub.classList.contains('on'), '"Posicionar" desdobra');
    assert.strictEqual(pai.getAttribute('aria-expanded'), 'true');
    pai.onclick();
    assert.ok(!sub.classList.contains('on'), 'e dobra de volta');

    /* cada pose e um angulo ABSOLUTO em torno da normal da placa, e reenquadra */
    [['p90', 90], ['p180', 180], ['p270', 270]].forEach(([k, g]) => {
      item(k).onclick();
      assert.ok(Math.abs(v3.yaw - g * Math.PI / 180) < 1e-9, k + ' poe a placa em ' + g + ' graus');
      const c = centroNaTela();
      assert.ok(Math.abs(c[0] - W3/2) < 1e-9 && Math.abs(c[1] - H3/2) < 1e-9,
                'e ela continua centrada em ' + g + ' graus');
      assert.ok(!amb.elems.menu3.classList.contains('on'), 'e o menu fecha ao escolher');
    });
    /* "Espelhar" troca a face, e mantem a placa centrada */
    const faceAntes = r.ladoV3(), ondeEsp = centroNaTela();
    item('esp').onclick();
    assert.strictEqual(r.ladoV3(), faceAntes ? 0 : 1, '"Espelhar" vira a face');
    const depoisEsp = centroNaTela();
    assert.ok(Math.abs(depoisEsp[0] - ondeEsp[0]) < 1e-9 &&
              Math.abs(depoisEsp[1] - ondeEsp[1]) < 1e-9,
              '"Espelhar" e o mesmo gesto do Ctrl+F: nao tira a placa do lugar');
    item('esp').onclick();

    /* ── REGRESSÃO: sair do 3D não pode devolver as telas 2D com a câmera destruída ──
       Com o 3D aberto as duas vistas 2D estão em display:none e medem zero. Enquadrar um
       canvas sem tamanho gravava esc = 1/(largura+4), e a placa voltava com menos de um pixel. */
    amb.elems.d3off.onclick();
    /* parte de um enquadramento limpo: o bloco acima passeou pelo 3D e pelas duas faces, e a
       regressão tem que medir o que ELA faz, e nao o que sobrou dali */
    amb.doc.querySelectorAll('[data-layout]').find(b => b.dataset.layout === 'lr').onclick();
    const escBom = cams0().esc;
    assert.ok(escBom > 1, 'a câmera 2D está sã antes: ' + escBom);
    amb.elems.d3f.onclick();
    janela.dispara('resize');                     /* o caminho que envenenava */
    amb.elems.d3off.onclick();
    assert.strictEqual(cams0().esc, escBom,
                       'voltar do 3D devolve a câmera 2D intacta: ' + cams0().esc);
    /* e o outro caminho: a visão guiada chama aplicaLayout de dentro do 3D */
    amb.elems.d3f.onclick();
    linhaDe('R1').onclick();
    amb.elems.d3off.onclick();
    assert.strictEqual(cams0().esc, escBom, 'nem pela visão guiada');
    amb.elems.d3f.onclick();

    /* ── REGRESSÃO: de perfil não se inventa pivô ──
       Com |sin(pitch)| pequeno não existe ponto da placa sob o cursor. Fingir que existe punha
       a esfera longe do clique e teleportava a vista no primeiro pixel de arrasto. */
    v3.pitch = 0.01;
    const cxPerfil = v3.cx;
    d3('pointerdown', { button:2, clientX:30, clientY:20, pointerId:1, preventDefault(){} });
    assert.strictEqual(v3.piv, null, 'de perfil não há pivô');
    d3('pointermove', { clientX:34, clientY:20 });
    assert.strictEqual(v3.cx, cxPerfil, 'e a vista não é teleportada');
    d3('pointerup', { clientX:34, clientY:20 });
    amb.elems.d3off.onclick(); amb.elems.d3f.onclick();

    /* ── REGRESSÃO: em 3D a guiada vira a placa para achar a peça do outro lado ── */
    assert.strictEqual(r.ladoV3(), 0, 'olhando a frente');
    /* a guiada tem que estar ligada: e ela quem leva a câmera até a peça */
    if (!amb.elems.cbGuiada.checked){ amb.elems.cbGuiada.checked = true; amb.elems.cbGuiada.onclick(); }
    escolheNada();                                /* limpa a seleção, para o clique não desfazer */
    amb.cores.length = 0;
    linhaDe('C2').onclick();                      /* C2 só existe no verso */
    assert.strictEqual(r.ladoV3(), 1, 'a guiada vira a placa para a face da peça');
    assert.ok(amb.cores.includes('#25d07d'), 'e a peça acende');

    /* o realce continua valendo em 3D */
    amb.cores.length = 0;
    linhaDe('R2').onclick();                      /* R2 é do verso, e o verso está à vista */
    assert.ok(amb.cores.includes('#25d07d'), 'a peça escolhida acende também em 3D');

    /* escolher um layout 2D sai do 3D - não dá para estar nos dois */
    amb.doc.querySelectorAll('[data-layout]').find(b => b.dataset.layout === 'lr').onclick();
    assert.ok(!v3.on, 'escolher um layout 2D sai do 3D');
    assert.ok(!amb.elems.placas.classList.contains('tres-d'));
    /* e o quadradinho do verso entra por baixo */
    v3.pitch = 0.9;
    amb.elems.d3b.onclick();
    assert.strictEqual(r.ladoV3(), 1, 'o quadradinho do verso entra olhando por baixo');
    amb.elems.d3off.onclick();
    assert.ok(!v3.on, 'o "2D" volta');
  }

  /* no layout "so a lista" nao ha o que dividir */
  amb.doc.querySelectorAll('[data-layout]').find(b => b.dataset.layout === 'bom').onclick();
  assert.ok(sp.classList.contains('oculta'), 'sem desenho, a divisoria some');
  amb.doc.querySelectorAll('[data-layout]').find(b => b.dataset.layout === 'lr').onclick();
  assert.ok(!sp.classList.contains('oculta'), 'e volta com o desenho');
  /* e a lista deixa de ter largura fixa quando e a unica coisa na tela */
  assert.ok(/#placas\.só-bom~#bom\{flex:1 1 auto\}/.test(Bom.html(m, { proj:'x' })),
            'no "so a lista" o painel toma a tela toda');
}

/* ═══════════════ net no modelo ═══════════════
   O realce de net so funciona se o dado chegar na pagina: pad, trilha, regiao e via tem que
   carregar o nome da net. */
{
  const bn = board({
    components: [comp('J1', 'Top', 'x', 'F', 5, 5, [
      { id:'p', name:'1', layer:'Top', type:'smd', shape:'rect', x:5, y:5, w:1, h:1, rot:0, net:'GND' }])],
    tracks: [{ id:'t', layer:'Top', x1:0, y1:0, x2:5, y2:5, w:0.3, net:'GND' }],
    regions: [{ id:'g', layer:'Top', net:'GND', points:[[0,0],[2,0],[2,2],[0,2]] }],
    vias: [{ id:'v', x:8, y:8, size:1, drill:0.5, net:'GND' }],
  });
  const mn = Bom.model(bn, {});
  assert.strictEqual(mn.pads[0].n, 'GND');
  assert.strictEqual(mn.tracks[0].n, 'GND');
  assert.strictEqual(mn.regions[0].n, 'GND');
  assert.strictEqual(mn.vias[0].n, 'GND');
  const hn = Bom.html(mn, { proj:'n' });
  assert.ok(hn.includes('data-modo="peca"'), 'a pagina tem o bot\u00e3o da vista por peça');
  assert.ok(hn.includes('id="hsplit"'), 'a divis\u00f3ria da lista');
  /* o quadradinho "3D" em cada vista, e a vista 3D, que \u00e9 uma s\u00f3 */
  ['d3f','d3b','d3off'].forEach(k =>
    assert.ok(hn.includes('id="' + k + '"'), 'falta o bot\u00e3o ' + k));
  assert.ok(hn.includes('id="cv3"'), 'o canvas do 3D');
  assert.ok(/contextmenu/.test(hn), 'o menu do bot\u00e3o direito tem que ser impedido sobre o 3D');
  assert.ok(hn.includes('id="menu3"'), 'o menu do clique direito');
  ['centrar','pos','p90','p180','p270','esp'].forEach(k =>
    assert.ok(hn.includes('data-m3="' + k + '"'), 'falta o item ' + k + ' no menu'));
  assert.ok(!hn.includes('data-m3="girar"'), 'o "Virar 360" saiu do menu');
  assert.ok(hn.includes('id="sub3"'), 'o submenu de posicionar');
  /* a ajuda dos atalhos mora na gaveta, junto do resto dos ajustes */
  const gav = hn.match(/<aside id="gaveta">[\s\S]*?<\/aside>/)[0];
  assert.ok(gav.includes('atalhos da vista 3D'), 'a se\u00e7\u00e3o de atalhos');
  assert.ok(!gav.includes('data-fte'), 'o tamanho saiu da gaveta');
  /* ele mora com a lista, ao lado do "Limpar vistos" - é ali que se lê */
  const barraLista = hn.match(/<div class="bom-bar">[\s\S]*?<\/div>/)[0];
  assert.ok(barraLista.includes('id="btFonte"'), 'o bot\u00e3o de fonte fica na barra da lista');
  assert.ok(barraLista.indexOf('id="limpar"') < barraLista.indexOf('id="btFonte"'),
            'ao lado do "Limpar vistos"');
  assert.ok(/data-fonte="p"/.test(barraLista), 'e abre no tamanho de sempre');
  /* o tamanho sai de UMA medida: cabe\u00e7alho, designadores e etiqueta derivam dela */
  ['th{', 'td.refs{', '.lado{'].forEach(sel =>
    assert.ok(new RegExp(sel.replace(/[.{]/g, '\\$&') + '[^}]*calc\\(var\\(--fte\\)').test(hn),
              sel + ' tem que derivar da medida base'));
  assert.ok(gav.includes('<kbd>C</kbd>') && gav.includes('<kbd>Ctrl</kbd>'),
            'os atalhos escritos com as teclas');
  assert.ok((hn.match(/<canvas /g) || []).length === 3, 'dois canvas 2D e um 3D');
  /* a busca e o limpar moram COM a lista, e nao na barra de cima */
  assert.ok(/<div class="bom-bar">[\s\S]*?id="filtro"[\s\S]*?id="limpar"[\s\S]*?<\/div>/.test(hn),
            'filtro e limpar ficam colados na lista');
  assert.ok(/<div id="bomRolo"><table>/.test(hn), 'so a tabela rola, a barra fica parada');
  /* o # na ponta, longe da Qtd - dois n\u00fameros seguidos alinhados \u00e0 direita viravam um so */
  assert.ok(hn.includes('<th>#</th><th></th><th>Qtd</th><th>Designadores</th><th>Footprint</th><th>Coment\u00e1rio</th>'),
            'a ordem das colunas da lista');
  /* os layouts sao icones, e nao rotulos */
  ['lr','bom'].forEach(k =>
    assert.ok(new RegExp('data-layout="' + k + '"[^>]*><svg').test(hn), 'layout ' + k + ' sem icone'));
  /* as duas faces cabem num icone so, com os dois desenhos dentro e o CSS mostrando um */
  assert.ok(/id="btFace"/.test(hn), 'o \u00edcone das faces');
  const face = hn.match(/<button class="t ic face"[\s\S]*?<\/button>/)[0];
  assert.ok(face.includes('class="sv-f"') && face.includes('class="sv-b"'),
            'os dois desenhos saem no HTML');
  assert.ok(hn.includes('.face .sv-b,.face.verso .sv-f{display:none}'), 'e o CSS mostra s\u00f3 um');
  assert.ok(!/data-layout="f"/.test(hn) && !/data-layout="b"/.test(hn),
            'nao pode sobrar bot\u00e3o separado de frente/verso');
  /* planos, furos e o modo da lista moram na gaveta; TRILHAS fica na barra - e a unica
     camada que se liga e desliga na bancada, para ver por onde o sinal anda antes de soldar */
  const barra = hn.match(/<div class="tools">[\s\S]*?<\/div><\/header>/)[0];
  const NA_GAVETA = ['pads','silk','refs','regions','drills'];
  NA_GAVETA.forEach(k =>
    assert.ok(barra.indexOf('data-ver="' + k + '"') < 0, k + ' nao pode estar na barra de cima'));
  assert.ok(/data-ver="tracks"[^>]*><svg/.test(barra), 'trilhas tem que ser \u00edcone na barra');
  assert.ok(barra.indexOf('data-modo=') < 0, 'o modo da lista saiu da barra');
  assert.ok(barra.indexOf('id="escuro"') < 0, 'o tema saiu da barra');
  /* sobra na barra so o que muda a VISTA: as tres de layout, as trilhas, o lado da lista e
     a gaveta */
  assert.strictEqual((barra.match(/<button/g) || []).length, 6,
                     'a barra tem que ficar com seis bot\u00f5es: ' + (barra.match(/<button/g) || []).length);
  const gaveta = hn.match(/<aside id="gaveta">[\s\S]*?<\/aside>/)[0];
  NA_GAVETA.forEach(k =>
    assert.ok(gaveta.includes('type="checkbox" data-ver="' + k + '"'), k + ' tem que ser caixa na gaveta'));
  assert.ok(gaveta.indexOf('data-ver="tracks"') < 0, 'trilhas saiu da gaveta - agora e da barra');
  assert.ok(gaveta.includes('id="escuro"'), 'o tema tem que estar na gaveta');
  assert.ok(gaveta.includes('data-modo="grupo"') && gaveta.includes('data-modo="peca"'));
  /* e o modal proprio, com Sim e Nao */
  assert.ok(hn.includes('id="modalSim"') && hn.includes('id="modalNao"'), 'o modal tem Sim e N\u00e3o');
  assert.ok(!/[^.]confirm\(/.test(hn.replace(/\/\*[\s\S]*?\*\//g, '')),
            'nada de confirm() do navegador');
  assert.ok(hn.includes('id="ladoLista"'), 'o \u00edcone que troca o lado');
  assert.ok(/main\.esq\{flex-direction:row-reverse\}/.test(hn), 'o CSS que inverte a ordem');
  assert.ok(/netSel/.test(hn), 'o runtime carrega o realce de net');
}

console.log('test-bom OK');
