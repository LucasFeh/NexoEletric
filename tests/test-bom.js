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
  ],
  silk: [{ id:'s1', layer:'TopOverlay', kind:'line', x1:1, y1:1, x2:9, y2:1, w:0.2 },
         { id:'s2', layer:'BottomOverlay', kind:'arc', cx:5, cy:15, r:1, sa:0, ea:180, w:0.2 }],
  texts: [{ id:'x1', layer:'TopOverlay', x:5, y:7, text:'R1', h:1, rot:0, mirror:false, designator:true },
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
assert.strictEqual(m.stats.comps, 4);
assert.strictEqual(m.stats.frente, 3);
assert.strictEqual(m.stats.verso, 1);
assert.strictEqual(m.groups.length, 3, '10k/RES 0805 junta R1 e R10; 1k e 100n sao outros');

/* R2 antes de R10: ordem natural, senao a bancada procura na sequencia errada */
assert.deepStrictEqual(m.comps.map(c => c.ref), ['C1', 'R1', 'R2', 'R10']);
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
  ['setTransform','clearRect','save','restore','translate','beginPath','moveTo',
   'lineTo','closePath','fill','stroke','arc','fillRect','strokeRect']
    .forEach(k => { ctx[k] = function(){ ops.push(k); }; });
  /* a escala do desenho e o único sinal daqui de que a câmera mudou de zoom */
  const escalas = [];
  ctx.scale = function (sx, sy){ ops.push('scale'); escalas.push(sy); };
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
       a face escondida e mediria a câmera errada */
    get clientWidth(){ return (this._pai && this._pai.classes.has('oculta')) ? 0 : 400; },
    get clientHeight(){ return (this._pai && this._pai.classes.has('oculta')) ? 0 : 300; },
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
          /* todas as camadas moram na gaveta agora, e todas sao caixa de marcar */
          .map(k => { const e = mk('b'); e.dataset.ver = k; e.type = 'checkbox'; return e; }));
      if (sel === '[data-layout]')
        return (elems.__layout = elems.__layout ||
                ['lr','bom'].map(k => { const e = mk('b'); e.dataset.layout = k; return e; }));
      if (sel === '[data-modo]')
        return (elems.__modo = elems.__modo ||
                ['grupo','peca'].map(k => { const e = mk('b'); e.dataset.modo = k; return e; }));
      return [];
    },
    addEventListener(ev, fn){ if (ev === 'DOMContentLoaded') doc.__boot = fn; },
    body: mk('body'),
  };
  return { ops, doc, elems, escalas };
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
    addEventListener(){},
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
                             blocos[0] + ';' + blocos[1] + '; return { boot: document.__boot };');
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

  /* a caixa da gaveta liga a camada de verdade: com trilha o desenho traça mais */
  const cbT = amb.doc.querySelectorAll('[data-ver]').find(b => b.dataset.ver === 'tracks');
  assert.strictEqual(cbT.type, 'checkbox', 'trilhas e caixa, nao botao');
  amb.ops.length = 0; cbT.checked = true; cbT.onclick();
  const comTrilha = amb.ops.filter(o => o === 'stroke').length;
  amb.ops.length = 0; cbT.checked = false; cbT.onclick();
  const semTrilha = amb.ops.filter(o => o === 'stroke').length;
  assert.ok(comTrilha > semTrilha,
            'a caixa liga a camada: ' + comTrilha + ' contra ' + semTrilha + ' tracos');

  /* ── o modal proprio, no lugar do confirm do navegador ── */
  const primeira = () => amb.elems.linhas.children[0];
  const caixaDaLinha = tr => tr.children[COL_VISTO].children[0];
  caixaDaLinha(primeira()).checked = true;
  caixaDaLinha(primeira()).onclick({ stopPropagation(){} });
  assert.strictEqual(primeira().className, 'feito', 'marcou a linha como montada');

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
    const cofre = { 'altiumbom.PlacaTeste.ui': JSON.stringify({ lado:'dir', w:0, guiada:true }) };
    const janela2 = Object.assign({}, janela, {
      localStorage: { getItem: k => (k in cofre ? cofre[k] : null),
                      setItem: (k, v) => { cofre[k] = v; } },
    });
    const r2 = rodar(amb2.doc, janela2, janela2.localStorage, janela2.requestAnimationFrame,
                     janela2.confirm, 1, janela2.setTimeout, janela2.clearTimeout);
    r2.boot();
    assert.strictEqual(amb2.elems.cbGuiada.checked, true,
                       'a caixa abre marcada quando a sessão anterior deixou a guiada ligada');
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
  /* trilhas, planos, furos e o modo da lista sairam da barra e foram para a gaveta */
  const barra = hn.match(/<div class="tools">[\s\S]*?<\/div><\/header>/)[0];
  const CAMADAS = ['pads','silk','refs','tracks','regions','drills'];
  CAMADAS.forEach(k =>
    assert.ok(barra.indexOf('data-ver="' + k + '"') < 0, k + ' nao pode estar na barra de cima'));
  assert.ok(barra.indexOf('data-modo=') < 0, 'o modo da lista saiu da barra');
  assert.ok(barra.indexOf('id="escuro"') < 0, 'o tema saiu da barra');
  /* sobra na barra so o que muda a VISTA: as tres de layout, o lado da lista e a gaveta */
  assert.strictEqual((barra.match(/<button/g) || []).length, 5,
                     'a barra tem que ficar com cinco bot\u00f5es: ' + (barra.match(/<button/g) || []).length);
  const gaveta = hn.match(/<aside id="gaveta">[\s\S]*?<\/aside>/)[0];
  CAMADAS.forEach(k =>
    assert.ok(gaveta.includes('type="checkbox" data-ver="' + k + '"'), k + ' tem que ser caixa na gaveta'));
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
