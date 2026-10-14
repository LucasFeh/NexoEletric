/* O DNA do Altium (hub-altiumdna.js) e a predefinição "Padrão Altium" do hub-atalhos.js.

   O hub-altiumdna.js é dado versionado, gerado por tools/altiumdna/extrai-rcs.js a partir dos .rcs
   do Altium Designer 21. Aqui se confere (1) que a consulta responde o que o Altium faz — os
   valores esperados foram lidos à mão nos .rcs (arquivo:linha no docs/altium-dna/README.md); (2)
   que cada tecla da predefinição "Padrão Altium" é mesmo a do Altium para o comando que a ação
   espelha, com as exceções escritas e justificadas; e (3), se o Altium estiver instalado nesta
   máquina, que rodar o extrator de novo dá o mesmo arquivo (o dado versionado não envelheceu).
   Rode: node tests/test-altiumdna.js */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const D = require(path.join(__dirname, '..', 'hub-altiumdna.js'));
const A = require(path.join(__dirname, '..', 'hub-atalhos.js'));

/* ══ 1. A CONSULTA ══ */

assert.ok(/Altium Designer 21/.test(D.VERSAO));
assert.deepStrictEqual(D.EDITORES, ['pcb', 'sch']);
for (const f of ['comando', 'caminho', 'acelerador', 'porSequencia', 'teclas', 'porTecla', 'teclaHub', 'busca', 'menu', 'contagens'])
  assert.strictEqual(typeof D[f], 'function', f);
assert.throws(() => D.comando('xyz', 'PLPCB:Copy'), /editor desconhecido/);

/* os menus de cima, como o Altium 21 mostra */
const C = D.contagens();
assert.deepStrictEqual(C.pcb.menus, ['File', 'Edit', 'View', 'Project', 'Place', 'Design', 'Tools', 'Route', 'Reports', 'Window', 'Help']);
assert.deepStrictEqual(C.sch.menus, ['File', 'Edit', 'View', 'Project', 'Place', 'Design', 'Tools', 'Simulator', 'Reports', 'Window', 'Help']);
assert.ok(C.pcb.comandos > 800 && C.sch.comandos > 500, 'comandos: ' + JSON.stringify(C));
assert.ok(C.pcb.aceleradores > 400 && C.sch.aceleradores > 250);
assert.ok(C.pcb.teclas > 150 && C.sch.teclas > 100);

/* um comando inteiro (AdvPcb.rcs: PL PLPCB:Copy) */
assert.deepStrictEqual(D.comando('pcb', 'PLPCB:Copy'), { plid:'PLPCB:Copy', comando:'PCB:Copy',
  params:'ClipboardMode=ClipboardRing', rotulo:'Copy', tecla1:'Ctrl+C', tecla2:'Ctrl+Insert', descricao:'Copy' });
assert.strictEqual(D.comando('pcb', 'PLManRoute:Track').comando, 'PCB:AdvancedRoute', 'o P,T roda o roteamento interativo');
assert.strictEqual(D.comando('pcb', 'PLPCB:DesignRuleCheck').rotulo, 'Design Rule Check...', 'o & do caption sai');
assert.strictEqual(D.comando('pcb', 'naoExiste'), null);

/* os aceleradores: Popup= do menu + a letra sublinhada */
const SEQ_PCB = { 'P,T':'PLManRoute:Track', 'P,V':'PLPCB:PlaceVia', 'P,P':'PLPCB:PlacePad', 'P,G':'PLPCB:PlacePolygonPlane',
  'T,D':'PLPCB:DesignRuleCheck', 'D,R':'PLPCB:DesignRules', 'T,E':'PLPCB:TearDrops', 'T,G,A':'PLPCB:RepourAllPolygonsNoContext',
  'A,L':'PLPCB:AlignComponentsLeft', 'A,R':'PLPCB:AlignComponentsRight', 'A,T':'PLPCB:AlignComponentsTop',
  'N,S,A':'PLPCB:PopupShowConnectionsAll', 'D,I':'PLPCB:CompareAndUpdateMe', 'F,M':'PLWorkspaceManager:ExportToPDF',
  'F,N,P':'PLWorkspaceManager:NewPCB', 'U,T':'PLManRoute:AdvancedRouting', 'E,A':'PLPCB:PasteSpecial', 'V,F':'PLPCB:ViewFitBoard' };
for (const [s, id] of Object.entries(SEQ_PCB)) assert.strictEqual((D.porSequencia('pcb', s) || {}).plid, id, 'pcb ' + s);
const SEQ_SCH = { 'P,W':'PLSch:PlaceWire', 'P,N':'PLSch:PlaceNetLabel', 'P,P':'PLSch:PlacePart', 'P,O':'PLSch:PlacePowerPort',
  'P,V,N':'PLSch:PlaceNoERCGeneric', 'D,U':'PLSch:CompareAndUpdateOther1', 'O,D':'PLSch:DocumentPreferencesSchDocumentOptions',
  'D,T,L':'PLSch:SetTemplateFromLocal', 'T,A,A':'PLWorkspaceManager:ConfigureAnnotate', 'C,C':'PLWorkspaceManager:CompileProject' };
for (const [s, id] of Object.entries(SEQ_SCH)) assert.strictEqual((D.porSequencia('sch', s) || {}).plid, id, 'sch ' + s);
assert.strictEqual(D.porSequencia('pcb', 'p, t').plid, 'PLManRoute:Track', 'aceita minúscula e espaço');
assert.strictEqual(D.porSequencia('pcb', ['P', 'T']).plid, 'PLManRoute:Track', 'e lista');
assert.strictEqual(D.porSequencia('pcb', 'Q,Q,Q'), null);
assert.strictEqual(D.acelerador('pcb', 'PLManRoute:Track'), 'P,T');
assert.strictEqual(D.acelerador('pcb', 'PLPCB:AlignComponentsLeft'), 'A,L', 'a mais curta (A,L e não E,G,L)');
assert.ok(D.DADOS.pcb.aceleradores.some(([s, id]) => s === 'E,G,L' && id === 'PLPCB:AlignComponentsLeft'), 'o caminho longo também existe');

/* o caminho no menu */
assert.deepStrictEqual(D.caminho('pcb', 'PLPCB:RepourAllPolygonsNoContext'), ['Tools', 'Polygon Pours', 'Repour All']);
assert.deepStrictEqual(D.caminho('pcb', 'PLManRoute:Track'), ['Place', 'Track']);
assert.deepStrictEqual(D.caminho('sch', 'PLSch:SetTemplateFromLocal'), ['Design', 'Sheet Templates', 'Local']);
assert.deepStrictEqual(D.caminho('pcb', 'naoExiste'), []);

/* as teclas diretas, e a tradução para a escrita do HubAtalhos.normalizaTecla */
assert.deepStrictEqual(D.teclas('pcb', 'PLPCB:AlignComponentsLeft'), ['Shift+Ctrl+L']);
assert.ok(D.porTecla('pcb', 'Ctrl+Shift+L').some(c => c.plid === 'PLPCB:AlignComponentsLeft'));
assert.ok(D.porTecla('pcb', 'Shift+Ctrl+L').some(c => c.plid === 'PLPCB:AlignComponentsLeft'), 'aceita a escrita do Altium também');
assert.ok(D.porTecla('pcb', 'Q').some(c => c.plid === 'PLPCB:ToggleUnits'));
assert.ok(D.porTecla('pcb', 'Ctrl+R').some(c => c.plid === 'PLPCB:RubberStamp'), 'o Rubber Stamp é Ctrl+R no Altium');
assert.ok(D.porTecla('sch', 'Ctrl+D').some(c => c.plid === 'PLSCH:Duplicate'), 'e o Duplicate do Esquema do Altium é Ctrl+D');
const TH = { 'Shift+Ctrl+L':'Ctrl+Shift+L', 'PgUp':'PageUp', 'Ctrl+PgDn':'Ctrl+PageDown', 'Multiply':'*', 'Shift+Multiply':'*',
  'Plus':'+', 'Minus':'-', 'Space':'Espaço', 'Shift+Space':'Espaço', 'Shift+S':'S', 'CTRL+W':'Ctrl+W', 'Left':'ArrowLeft',
  'Shift+Left':'Shift+ArrowLeft', 'Alt+Backspace':'Alt+Backspace', 'Ctrl+Shift+L':'Ctrl+Shift+L', 'F11':'F11', '':'' };
for (const [alt, hub] of Object.entries(TH)) assert.strictEqual(D.teclaHub(alt), hub, alt + ' -> ' + hub);
/* toda tecla do Altium sai do jeito que o normalizaTecla a escreveria (menos as de mouse) */
for (const ed of D.EDITORES) for (const [t] of D.DADOS[ed].teclas){
  if (/Click|Wheel/i.test(t)) continue;
  const h = D.teclaHub(t), p = h === '+' ? ['+'] : h.split('+');
  if (h.endsWith('++')) p.splice(p.length - 2, 2, '+');
  const k = p[p.length - 1], ev = { key: k === 'Espaço' ? ' ' : (k.length === 1 ? k.toLowerCase() : k) };
  for (const m of p.slice(0, -1)) ev[{ Ctrl:'ctrlKey', Alt:'altKey', Shift:'shiftKey' }[m]] = true;
  assert.strictEqual(A.normalizaTecla(ev), h, ed + ': ' + t + ' -> ' + h);
}

/* o menu resolvido */
{
  const place = D.menu('pcb').find(m => m.rotulo === 'Place');
  assert.strictEqual(place.popup, 'P');
  assert.ok(place.filhos.some(f => f.plid === 'PLManRoute:Track' && f.acelerador === 'P,T'));
  const polys = D.menu('pcb').find(m => m.rotulo === 'Tools').filhos.find(f => f.rotulo === 'Polygon Pours');
  assert.strictEqual(polys.acelerador, 'T,G', 'o submenu também diz a sequência que o abre');
  assert.ok(D.menu('pcb', 'popups').some(m => m.popup === 'N' && m.rotulo === 'Netlist'), 'o N abre o Netlist solto');
  const file = D.menu('sch').find(m => m.rotulo === 'File');
  const tem = (ns, p) => ns.some(n => p(n) || (n.filhos && tem(n.filhos, p)));
  assert.ok(tem(file.filhos, n => n.dinamico), 'as listas dinâmicas (recentes, importadores) aparecem marcadas');
  assert.ok(!file.filhos.length || file.filhos[0].separador !== true, 'separador não abre menu');
}
assert.ok(D.busca('pcb', 'teardrop').some(c => c.plid === 'PLPCB:TearDrops'));
assert.deepStrictEqual(D.busca('pcb', ''), []);

/* ══ 2. A PREDEFINIÇÃO "PADRÃO ALTIUM" BATE COM O ALTIUM ══
   Para cada ação que espelha um comando do Altium (altium:'<plid>' na tabela ou no ALTIUM_* do
   hub-atalhos), a tecla da predefinição tem de ser um acelerador daquele comando ou uma tecla
   direta dele. As exceções, cada uma com o porquê: */
const EXCECOES = {
  pcb: {
    duplicar: 'Ctrl+R (Rubber Stamp) recarrega a página: Ctrl+D, o Duplicate do Esquema do Altium',
    ratsnest: 'no Altium o N abre o menu Netlist (N,S,A mostra todas); aqui o N alterna as linhas',
  },
  sch: {
    template: 'D,T abre o submenu Design » Sheet Templates (D,T,L é o Local)',
  },
};
for (const v of [A.sch, A.pcb]){
  for (const a of v.ATALHOS_PADRAO){
    const plid = v.altiumDe(a.id);
    if (!plid) continue;
    assert.ok(D.comando(v.nome, plid), v.QUANDO + ': ' + a.id + ' espelha ' + plid + ', que existe no .rcs');
    const t = v.PADRAO_ALTIUM[a.id];
    const aceitas = new Set(D.DADOS[v.nome].aceleradores.filter(x => x[1] === plid).map(x => x[0])
      .concat(D.teclas(v.nome, plid).map(D.teclaHub)));
    if (EXCECOES[v.nome][a.id]) { assert.ok(!aceitas.has(t), a.id + ': exceção que já não é exceção'); continue; }
    assert.ok(aceitas.has(t), v.QUANDO + ': ' + a.id + ' = ' + t + ' no padrão Altium, mas o Altium usa ' + [...aceitas].join(' / '));
  }
}
/* a tecla da CASA, quando é a do Altium, também confere (o Ctrl+Shift+L é o Shift+Ctrl+L de lá) */
for (const id of ['copiar', 'recortar', 'colar', 'alinharEsq', 'alinharBase', 'distribuirH', 'distribuirV']){
  const a = A.pcb.ATALHOS_PADRAO.find(x => x.id === id);
  assert.ok(D.teclas('pcb', a.altium).map(D.teclaHub).includes(a.tecla), id + ': ' + a.tecla + ' é a do Altium');
}

/* ══ 3. O DADO VERSIONADO NÃO ENVELHECEU (só com o Altium instalado) ══ */
const RCS = 'C:\\Program Files\\Altium\\AD21\\System';
if (fs.existsSync(path.join(RCS, 'AdvPcb.rcs'))){
  const tmp = path.join(os.tmpdir(), 'altiumdna-' + process.pid + '.js');
  try {
    execFileSync(process.execPath, [path.join(__dirname, '..', 'tools', 'altiumdna', 'extrai-rcs.js'), RCS, tmp], { stdio:'pipe' });
    const novo = fs.readFileSync(tmp, 'utf8'), velho = fs.readFileSync(path.join(__dirname, '..', 'hub-altiumdna.js'), 'utf8').replace(/\r\n/g, '\n');
    assert.ok(novo === velho, 'hub-altiumdna.js difere do que o extrator gera hoje: rode node tools/altiumdna/extrai-rcs.js');
  } finally { try { fs.unlinkSync(tmp); } catch (e) {} }
} else console.log('  (sem o Altium em ' + RCS + ': a regeneração não foi conferida)');

console.log('test-altiumdna: OK (' + C.pcb.comandos + ' + ' + C.sch.comandos + ' comandos, '
  + C.pcb.aceleradores + ' + ' + C.sch.aceleradores + ' aceleradores)');
