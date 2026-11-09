/* Template de folha (hub-schtemplate.js): special strings, primitivas, formato no schematic.js.

   node tests/test-schtemplate.js

   O motor é puro: aqui ele roda contra o Libs/sch-templates.js REAL (os .SchDot do AD21 e o
   carimbo da DIEletrons extraídos pelo tools/schtemplate) e contra o hub-core, que é quem grava
   o schematic.js — o campo novo tem de atravessar o serializador sem ele saber que existe. */
const assert = require('assert');
const { loadVar } = require('./load.js');
const T = require('../hub-schtemplate.js');
const HubCore = require('../hub-core.js');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const perto = (a, b, m) => ok(Math.abs(a - b) < 0.01, (m || '') + ' — ' + a + ' ≠ ' + b);

/* ── 1. o acervo extraído ── */
const lib = loadVar('tools/schtemplate/sch-templates-altium.js', 'schtemplates');
eq(lib.format, 'schtemplate-v1', 'formato do Libs');
/* + o da casa como o app carrega (Libs/sch-templates-casa.js): ele ganha o da extração, como no hub (globais) */
const A = T.acervo([lib, loadVar('Libs/sch-templates-casa.js', 'schtemplatesCasa')]);
for (const id of ['altium:Standard', 'altium:ANSI', 'altium:ISO A3 Landscape', 'altium:ISO A2 Landscape',
                  'altium:ANSI B Landscape', 'altium:ANSI C Landscape', 'altium:ANSI D Landscape',
                  'altium-legado:A4', 'casa:A4_DiEletrons'])
  ok(A[id], 'falta o template ' + id);
const casa = A['casa:A4_DiEletrons'];
perto(casa.folha.w, 11692.913, 'A4 da casa é a ISO de verdade');
perto(casa.folha.h, 8267.717);
eq([casa.folha.zonasX, casa.folha.zonasY, casa.folha.borda], [6, 4, true], 'zonas da casa (preview: 1..6, A..D)');
const logo = casa.itens.find(i => i.g === 'image');
ok(logo && /^data:image\/png;base64,/.test(logo.src), 'o logo da casa sai como PNG embutido (a tabela comum foi resolvida)');
ok(casa.itens.some(i => i.s === '=Desenhista_DiEletrons'), 'o campo do desenhista está no carimbo');
eq(casa.params.Escala, '1:1', 'parâmetro do projeto da casa (.PrjPcb) vira padrão do template');
eq(A['altium-legado:A0_portrait'].folha.w < A['altium-legado:A0_portrait'].folha.h, true, 'retrato fica em pé');

/* ── 2. params: o campo plano ── */
eq(T.parseParams('Title=Fonte 5V;Revision=B;;=x;Vazio='), { Title:'Fonte 5V', Revision:'B', Vazio:'' }, 'parse');
eq(T.parseParams('Formula=a=b'), { Formula:'a=b' }, 'só o primeiro = separa');
const s = T.serializaParams({ Title:'A;B|C', 'Ma;u=': 'x', Nota:'tem ":' });
ok(!/[|]/.test(s) && s.indexOf('":') < 0, 'serializa sem | e sem aspas-dois-pontos: ' + s);
eq(T.parseParams(s).Title, 'A,B,C', 'o ; do valor vira vírgula (a regra do params do comp)');
eq(T.parseParams(T.serializaParams({ A:'1', B:'' })), { A:'1', B:'' }, 'ida e volta');

/* ── 3. special strings ── */
const agora = new Date(2026, 9, 13, 8, 5, 9);
const c = T.contexto({ tpl:casa, doc:'Title=Folha da fonte;drawnby=ANA', proj:'Title=Projeto;CheckedBy=BETO;Revision=C',
                       folhaN:2, folhaTotal:5, documento:'main.SchDoc', projeto:'Demo', agora });
eq(T.resolve('=Title', c), 'Folha da fonte', 'documento ganha do projeto');
eq(T.resolve('=title', c), 'Folha da fonte', 'sem caixa, como o Altium (=sheetnumber nos .SchDot antigos)');
eq(T.resolve('=Revision', c), 'C', 'projeto ganha do padrão do template (Revisao=REV.A)');
/* as pessoas, as datas e a revisão da casa vêm SÓ do cabeçalho, pelo nome exato (2026-11-05: dos carimbos e do
   Aprovar): o DrawnBy/CheckedBy/Revision do Altium não preenchem, e sem ninguém o "NOME_APROVADOR" do template não sai */
eq(T.resolve('=Revisao', c), '=Revisao', 'a Revisao da casa é a do Aprovar, não o Revision do Altium');
eq(T.resolve('=Desenhista_DiEletrons', c), '=Desenhista_DiEletrons', 'o DrawnBy da folha não é o desenhista');
eq(T.resolve('=Verificador_DiEletrons', c), '=Verificador_DiEletrons', 'o CheckedBy não é o verificador');
eq(T.resolve('=Aprovador_DiEletrons', c), '=Aprovador_DiEletrons', 'sem aprovação, nada (nem o padrão do template)');
{
  const c2 = T.contexto({ tpl:casa, doc:'Desenhista_DiEletrons=FOLHA;Formato=A0;Escala=1:5;Arquivo=X', folhaNome:'SCH-DI261944',
                          proj:'Desenhista_DiEletrons=Lucas;Data_desenho=05/11/26;CodigoDaPlaca=PBIDP-DI261944;Equipamento_linha_um=Velho',
                          formato:'A4', projeto:'PBIDP-DI261944' });
  eq(T.resolve('=Desenhista_DiEletrons', c2), 'Lucas', 'o desenhista é o do projeto, a folha não sobrescreve');
  eq(T.resolve('=Data_desenho', c2), '05/11/26', 'a data do desenho do projeto');
  eq([T.resolve('=Formato', c2), T.resolve('=Escala', c2), T.resolve('=Arquivo', c2)], ['A4', '1:1', 'SCH-DI261944'],
     'formato e escala da folha, arquivo = nome da folha (o que a folha gravou não conta)');
  eq(T.resolve('=CodigoDaPlaca', c2), 'PBIDP-DI261944', 'o código da placa do Definir projeto');
  eq(T.resolve('=NomeDoEquipamento', c2), 'Velho', 'o nome antigo (Equipamento_linha_um) vale como o novo');
  eq(T.resolve('=CodigoDaPlaca', T.contexto({ projeto:'PDCD-DI261939 (PTYPE)' })), 'PDCD-DI261939', 'sem definição: o código do nome do projeto');
  ok(T.automatico('Formato') && T.automatico('Data_aprovacao') && T.automatico('CodigoDaPlaca') && T.automatico('Equipamento_linha_um')
     && !T.automatico('Cliente'), 'o que se preenche sozinho');
}
eq(T.resolve('=SheetNumber', c) + '/' + T.resolve('=SheetTotal', c), '2/5', 'folha n de N');
eq(T.resolve('=CurrentDate', c), '13/10/2026', 'data');
eq(T.resolve('=CurrentTime', c), '08:05:09', 'hora');
eq(T.resolve('=Data_desenho', c), '=Data_desenho', 'o apelido não puxa a data do sistema');
eq(T.resolve('=DocumentName', c) + ' ' + T.resolve('=ProjectName', c), 'main.SchDoc Demo', 'nomes');
eq(T.resolve('=NaoExiste', c), '=NaoExiste', 'o que não resolve aparece como o Altium mostra');
eq(T.resolve('=NaoExiste', T.contexto({ faltante:'' })), '', 'a vista pede vazio');
eq(T.resolve('Rev =Revision', c), 'Rev =Revision', 'só o texto INTEIRO é special string');
eq(T.resolve('=Title', T.contexto({ doc:'Title=X', cru:true })), '=Title', 'cru: o editor vê o campo');
eq(T.resolve('=Address1', T.contexto({ tpl:{ params:{ Address1:'*' } } })), '=Address1', 'o * da semente não é valor');
ok(T.campos(casa).includes('NomeDoEquipamento') && T.campos(casa).includes('CodigoDaPlaca') && !T.campos(casa).includes('CurrentDate')
   && !T.campos(casa).some(n => /linha/.test(n)), 'campos da casa (nome e código do equipamento, código da placa)');

/* ── 4. primitivas: moldura e zonas ── */
const std = A['altium:Standard'];
const P = T.primitivas(std, [11500, 7600], { agora });
const txt = P.filter(p => p.g === 'text');
const rotulo = s => txt.find(p => p.s === s);
/* zonas medidas no IL do DrawVerticalReferenceZone: A em CIMA, a contagem 1.. da esquerda */
ok(rotulo('A').y > rotulo('D').y, 'zona A em cima');
ok(txt.filter(p => p.s === '1').every(p => p.x < 11500 / 4), 'zona 1 à esquerda');
eq(txt.filter(p => /^[1-4]$/.test(p.s)).length, 8, '4 zonas X, em cima e embaixo');
ok(P.some(p => p.g === 'rect' && p.x1 === 200 && p.y2 === 7400), 'margem de 200 mil (A4 do Altium)');

/* carimbo Standard: 3500x800 no canto (largura − margem, margem) — Altium.Sch.Painter.dll */
const linhas = P.filter(p => p.g === 'line' && Math.abs(p.y1 - p.y2) < 1e-9 && p.x2 === 11300);
ok(linhas.some(p => p.y1 === 1000 && p.x1 === 7800), 'topo do carimbo Standard em y=200+800, de x=11300−3500');
const tit = rotulo('Title');
eq([tit.x, tit.y, tit.h, tit.v], [7850, 1000, 'left', 'top'], 'Title ancorado em cima-esquerda a 50 mil da borda');
eq(rotulo('A4') ? true : false, true, 'o estilo da folha aparece no campo Size');
eq(rotulo('13/10/2026') ? true : false, true, 'a data do sistema no Date:');

const ansi = T.primitivas(A['altium:ANSI'], [11500, 7600], {});
const dentro = p => [p.x1, p.x2].every(x => x >= 11300 - 6250 && x <= 11300) && [p.y1, p.y2].every(y => y >= 200 && y <= 1950);
eq(ansi.filter(p => p.g === 'line' && dentro(p)).length, 11, 'ANSI: 11 linhas (DrawAnsiTitleBlock)');
ok(ansi.some(p => p.g === 'text' && p.s === 'FCSM No.' && p.x === 11300 - 3820 && p.y === 200 + 630), 'ANSI: FCSM No.');
/* sem arquivo, o carimbo acompanha a folha que já existe */
const A3 = T.primitivas(std, [15500, 11100], {});
ok(A3.some(p => p.g === 'text' && p.s === 'A3'), 'Standard numa folha A3 diz A3');
eq(A3.filter(p => p.g === 'text' && /^[1-8]$/.test(p.s)).length, 16, 'A3 do Altium tem 8 zonas X (ArkGlobalSettings)');

/* ── 5. primitivas do template da casa ── */
const PC = T.primitivas(casa, null, { proj:'NomeDoEquipamento=Oscilador', faltante:'' });
ok(PC.some(p => p.g === 'text' && p.s === 'Oscilador' && p.origem === '=NomeDoEquipamento'), 'campo resolvido, com a origem');
ok(PC.some(p => p.s === 'PLACA:') && !PC.some(p => p.s === 'DESENHO:'), 'o quadro do desenho virou o da placa');
const desen = PC.find(p => p.s === 'DESEN.');
eq([desen.h, desen.v, desen.fonte, desen.tam], ['left', 'top', 'Times New Roman', 100], 'Justification=6 = em cima-esq; 10 pt = 100 mil');
const iso = T.primitivas(A['altium:ISO A3 Landscape'], null, {});
const end = iso.find(p => p.origem === '=Address1');
eq(end.h, 'left', 'IsMirrored troca o lado: BottomRight espelhado fica à esquerda (à direita do logo)');
ok(iso.some(p => p.g === 'text' && p.rot === 270), 'Orientation=3 = 270°');

/* ── 6. canvas: o desenho chama o contexto 2D com o que as primitivas dizem ── */
const chamadas = [];
const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : (...a) => chamadas.push([k, a])), set: (o, k, v) => { o[k] = v; return true; } });
const prims = T.desenha(ctx, std, [11500, 7600], {}, { esc:0.1 });
ok(prims.length > 20 && chamadas.some(c => c[0] === 'fillText' && c[1][0] === 'Title'), 'desenha() escreve o carimbo');
eq(T.desenha(ctx, null, [1, 1], {}).length, 0, 'sem template, nada');

/* ── 7. o formato no schematic.js ── */
const sch = { format:'schmirror-v2', project:'Demo', units:'mil', params:'CompanyName=DIEletrons',
  items:[ { t:'sheet', name:'main', size:'A4', w:11692.913, h:8267.717, template:'casa:A4_DiEletrons', params:'Title=Fonte' },
          { t:'sheet', name:'sem', size:'A4' },
          { t:'text', sheet:'main', s:'oi', x:100, y:100 } ] };
const d = T.daFolha(sch, 'main', [lib]);
eq([d.tpl && d.tpl.id, d.ctxo.folhaN, d.ctxo.folhaTotal, d.ctxo.doc, d.ctxo.proj],
   ['casa:A4_DiEletrons', 1, 2, 'Title=Fonte', 'CompanyName=DIEletrons'], 'daFolha');
eq(T.daFolha(sch, 'sem', [lib]).tpl, null, 'folha sem `template` continua sem template');
const out = HubCore.serializeSchematic(sch);
eq(out.errors, [], 'o serializador aceita os campos novos');
const volta = new Function(out.text + ';return schematic;')();
eq(volta.items[0].template, 'casa:A4_DiEletrons', 'template atravessa a gravação');
eq(volta.items[0].params, 'Title=Fonte', 'params da folha atravessa');
eq(volta.params, 'CompanyName=DIEletrons', 'params do projeto atravessa');
ok(out.text.split('\n').some(l => l.startsWith('{"t":"sheet"') && l.includes('"template"')), 'item plano, numa linha (o parser do .pas)');
eq(HubCore.buildSchModel(volta).sheets.length, 2, 'o modelo não estranha o campo');

/* escolher template: a folha passa a ter a medida dele; os sem arquivo não mexem na medida */
const it = { t:'sheet', name:'x', size:'A4' };
eq(T.aplica(it, A['altium:ISO A3 Landscape'], HubCore.sheetMatch), [16535.433, 11692.913], 'aplica devolve a medida nova');
eq([it.template, it.size], ['altium:ISO A3 Landscape', 'A3'], 'size pelo formato que a medida é');
eq(T.aplica(it, A['altium:Standard'], HubCore.sheetMatch), null, 'Standard não muda a medida');
T.aplica(it, null);
ok(!('template' in it) && it.w === 16535.433, 'tirar o template deixa a medida');
const ib = { t:'sheet', name:'b', size:'A4' };
T.aplica(ib, A['altium:ANSI B Landscape'], HubCore.sheetMatch);
eq(ib.size, 'Custom', 'medida sem formato conhecido = Custom');

/* ── 8. templates da casa: cópia editável e o arquivo ── */
const cp = T.copia(std, 'Meu carimbo', A);
eq([cp.origem, cp.id, cp.folha.carimbo], ['casa', 'casa:Meu carimbo', false], 'cópia vira da casa');
ok(cp.itens.some(i => i.s === 'Drawn By:') && cp.itens.filter(i => i.g === 'line').length === 8, 'o Standard vira itens editáveis');
eq(T.idCasa('A4_DiEletrons', A), 'casa:A4_DiEletrons (2)', 'id novo não colide');
const arq = T.serializaCasa({ [cp.id]: cp });
const lido = new Function(arq + ';return schtemplatesCasa;')();
eq(lido.templates[cp.id].nome, 'Meu carimbo', 'o arquivo da casa se lê de volta');
eq(T.acha('casa:Meu carimbo', [lib, lido]).nome, 'Meu carimbo', 'e entra no acervo');
const it2 = { g:'text', x:0, y:0, s:'ABCD', fonte:1, just:4 };
const b = T.caixaItem(it2, { fontes:{ '1':{ nome:'Arial', tam:10 } } });
ok(b.x1 < 0 && b.x2 > 0 && b.y1 < 0 && b.y2 > 0, 'caixa de texto centrado envolve a âncora');
eq(T.moveItem({ g:'line', x1:0, y1:0, x2:10, y2:10 }, 5, -5), { g:'line', x1:5, y1:-5, x2:15, y2:5 }, 'moveItem');
const tf = { fontes:{ '1':{ nome:'Times New Roman', tam:10 } } };
eq(T.fonteId(tf, 10), 1, 'fonte existente');
eq(T.fonteId(tf, 14, 'Arial'), 2, 'fonte nova');

/* ── 9. "PROJETO NÃO DEFINIDO" (1.86.0): o código da placa e o do equipamento que ninguém deu ── */
{
  eq(T.NAO_DEFINIDO, 'PROJETO NÃO DEFINIDO', 'o texto, na caixa do template (maiúsculas)');
  const c0 = T.contexto({ tpl:casa, proj:'Revisao=REV.A', projeto:'Projeto qualquer', faltante:'' });
  eq([T.resolve('=CodigoDaPlaca', c0), T.resolve('=CodigoDoEquipamento', c0)], [T.NAO_DEFINIDO, T.NAO_DEFINIDO],
     'sem Definir projeto: os dois códigos dizem PROJETO NÃO DEFINIDO');
  eq(T.resolve('=NomeDoEquipamento', c0), '', 'o nome do equipamento continua vazio (só os códigos)');
  eq(T.resolve('=Title', c0), '', 'os outros campos não mudam');
  /* o Definir projeto (e o Altium com os nomes de antes) tiram o texto; o código do nome do projeto vale para a placa */
  const cd = T.contexto({ proj:'CodigoDaPlaca=PBIDP-DI261944;CodigoDoEquipamento=EQP-DI261945', projeto:'x' });
  eq([T.resolve('=CodigoDaPlaca', cd), T.resolve('=CodigoDoEquipamento', cd)], ['PBIDP-DI261944', 'EQP-DI261945'], 'definido: os códigos');
  const ca = T.contexto({ proj:'Desenho_linha_unica=CBM-DI251876;Equipamento_linha_dois=EQ-DI1', projeto:'x' });
  eq([T.resolve('=CodigoDaPlaca', ca), T.resolve('=CodigoDoEquipamento', ca)], ['CBM-DI251876', 'EQ-DI1'], 'projeto do Altium (nomes antigos) não quebra');
  const cn = T.contexto({ projeto:'PDCD-DI261939 (PTYPE)' });
  eq([T.resolve('=CodigoDaPlaca', cn), T.resolve('=CodigoDoEquipamento', cn)], ['PDCD-DI261939', T.NAO_DEFINIDO],
     'o código da placa que o nome traz continua; o equipamento, não definido');
  /* nunca vira valor: o cabeçalho que traga o texto conta como vazio; desligável; o editor (cru) vê o campo */
  const cm = T.contexto({ proj:'CodigoDaPlaca=projeto não definido', projeto:'x' });
  eq(T.resolve('=CodigoDaPlaca', cm), T.NAO_DEFINIDO, 'o texto gravado por engano não é código');
  ok(T.ehNaoDefinido(' Projeto Não Definido ') && !T.ehNaoDefinido('PDCD-DI1'), 'ehNaoDefinido');
  eq(T.resolve('=CodigoDaPlaca', T.contexto({ projeto:'x', naoDefinido:false, faltante:'' })), '', 'naoDefinido:false desliga');
  eq(T.resolve('=CodigoDaPlaca', T.contexto({ projeto:'x', cru:true })), '=CodigoDaPlaca', 'cru: o editor vê o campo');
  eq(T.camposNaoDefinidos('', 'x'), { CodigoDaPlaca:true, CodigoDoEquipamento:true }, 'camposNaoDefinidos: nada definido');
  eq(T.camposNaoDefinidos('CodigoDoEquipamento=EQ-DI1', 'PDCD-DI261939'), { CodigoDaPlaca:false, CodigoDoEquipamento:false }, 'definidos');
  /* as primitivas marcam o campo (a tela destaca e o clique acha); a caixa cobre o texto */
  const P0 = T.primitivas(casa, null, { proj:'', projeto:'x', faltante:'' });
  const nd = P0.filter(p => p.naoDefinido);
  eq(nd.map(p => [p.naoDefinido, p.s]).sort(), [['CodigoDaPlaca', T.NAO_DEFINIDO], ['CodigoDoEquipamento', T.NAO_DEFINIDO]], 'as duas primitivas marcadas');
  const caixas = T.naoDefinidos(casa, null, { proj:'', projeto:'x', faltante:'' });
  eq(caixas.map(x => x.campo).sort(), ['CodigoDaPlaca', 'CodigoDoEquipamento'], 'naoDefinidos: um por campo');
  const placa = caixas.find(x => x.campo === 'CodigoDaPlaca').caixa;
  ok(placa.x1 < 7753.317 && placa.x2 > 7753.317 && placa.y1 < 354.331 && placa.y2 > 354.331, 'a caixa da placa envolve a âncora do campo');
  ok(placa.x1 > 6732 && placa.x2 < 8819, 'e cabe na célula do código da placa no quadro da casa');
  eq(T.naoDefinidos(casa, null, { proj:'CodigoDaPlaca=P-DI1;CodigoDoEquipamento=E-DI2', projeto:'x' }), [], 'definido: nada para clicar');
  /* o desenho: na tela (destacaNaoDefinido) em vermelho com o tracejado; no PDF (sem destaque), na cor do template */
  const traco = [], cores = [];
  const ctx = { save(){}, restore(){}, translate(){}, rotate(){}, scale(){}, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){},
                fillRect(){}, arc(){}, ellipse(){}, closePath(){}, fill(){}, drawImage(){}, setLineDash(){},
                strokeRect(){ traco.push(this.strokeStyle); }, fillText(s){ if (s === T.NAO_DEFINIDO) cores.push(this.fillStyle); } };
  T.desenha(ctx, casa, null, { proj:'', projeto:'x', faltante:'' }, { esc:1, destacaNaoDefinido:true });
  eq([cores, traco.filter(c => c === '#d32f2f').length], [['#d32f2f', '#d32f2f'], 2], 'na tela: vermelho e tracejado em volta');
  cores.length = 0; traco.length = 0;
  T.desenha(ctx, casa, null, { proj:'', projeto:'x', faltante:'' }, { esc:1 });
  eq([cores, traco.filter(c => c === '#d32f2f').length], [['#110f0a', '#110f0a'], 0], 'no PDF: a cor do template, sem destaque');
}

console.log('test-schtemplate: ' + n + ' verificações ok');
