const assert = require('assert');

/* ═══════════════ mudanças vindas do Altium (parte pura) ═══════════════
   hub-libsync.js tem de carregar em Node sem DOM: o badge, o modal e o fetch moram dentro
   de função. O que se prova aqui é o que decide se o hub pergunta ou não: a assinatura do
   que "Agora não" adia, a lista do modal (12 nomes + "+k"), o corpo do altium-apply, o
   cruzamento com o editor de símbolos e o throttle de 30 s que segura a casca, que chama
   verifica() a cada renderPanes(). */

const M = require('../hub-libsync.js');
const P = M.pure;
assert.strictEqual(typeof M.verifica, 'function');
assert.strictEqual(typeof M.badge, 'function');
assert.strictEqual(M.verifica(), null, 'sem location http, verifica() não faz nada e não estoura');
assert.strictEqual(M.estado.pendente, false, 'nasce sem pendência');

/* ── assinatura: só os arquivos que mudaram, sem depender da ordem ── */
const arqs = [
  { arquivo: 'Y:\\Biblioteca\\BIBLIOTECA DE ESQUEMA.SchLib', acervo: 'altium', mudou: true, mtime: 1725000000.5, size: 1725440 },
  { arquivo: 'Libs\\Almox\\RESISTOR ALMOX.SchLib', acervo: 'almox', mudou: false, mtime: 1724000000, size: 9000 },
  { arquivo: 'Libs\\Almox\\DIAC ALMOX.SchLib', acervo: 'almox', mudou: true, mtime: 1725000100, size: 5120 },
];
const itens = [
  { acervo: 'altium', name: 'RES [SMD]', mudou: ['geometria', 'descricao'] },
  { acervo: 'altium', name: 'NE555', mudou: ['novo'] },
  { acervo: 'almox', familia: 'DIAC', componente: 'DB3 DO-35', mudou: ['geometria'] },
];
const a1 = P.assinatura(arqs, itens);
assert.ok(a1.includes('BIBLIOTECA DE ESQUEMA.SchLib@1725000000.5@1725440'), 'arquivo mudado entra com mtime e size');
assert.ok(!a1.includes('RESISTOR ALMOX'), 'arquivo que não mudou fica de fora');
assert.strictEqual(P.assinatura(arqs.slice().reverse(), itens.slice().reverse()), a1, 'a ordem não muda a assinatura');
const arqs2 = arqs.map(a => Object.assign({}, a)); arqs2[0].mtime = 1725000999;
assert.notStrictEqual(P.assinatura(arqs2, itens), a1, 'mtime novo = mudança nova: pergunta de novo');
assert.notStrictEqual(P.assinatura(arqs, itens.slice(0, 2)), a1, 'um item a menos também muda a assinatura');
assert.notStrictEqual(P.assinatura(arqs, [Object.assign({}, itens[0], { mudou: ['geometria'] })].concat(itens.slice(1))), a1,
  'o que mudou no item conta: só geometria ≠ geometria + descrição');
/* servidor que só manda {arquivo, acervo, mudou}: a assinatura continua funcionando pelo nome */
const semMtime = arqs.map(a => ({ arquivo: a.arquivo, acervo: a.acervo, mudou: a.mudou }));
assert.strictEqual(P.assinatura(semMtime, itens), P.assinatura(semMtime.slice().reverse(), itens), 'sem mtime/size ainda é estável');
assert.strictEqual(P.assinatura([], []), '#', 'vazio é vazio');
assert.strictEqual(P.assinatura(null, null), '#', 'null não explode');

/* ── "Agora não" numa sessão de mentira ── */
const store = (() => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } }; })();
assert.strictEqual(P.adiado(a1, store), false, 'nada adiado ainda');
P.marcaAdiado(a1, store);
assert.strictEqual(P.adiado(a1, store), true, 'a mesma assinatura está adiada');
assert.strictEqual(P.adiado(P.assinatura(arqs2, itens), store), false, 'assinatura diferente pergunta de novo');
assert.strictEqual(store.getItem(P.SS_KEY), a1, 'grava na chave do módulo');
P.limpaAdiado(store);
assert.strictEqual(P.adiado(a1, store), false, 'depois de aplicar, limpa');
assert.strictEqual(P.adiado(a1, null), false, 'sem sessionStorage não adia (e não explode)');
assert.strictEqual(P.adiado('', store), false, 'assinatura vazia nunca conta como adiada');
const quebrado = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); }, removeItem() { throw new Error('bloqueado'); } };
assert.strictEqual(P.adiado(a1, quebrado), false, 'storage bloqueado = não adiado');
P.marcaAdiado(a1, quebrado); P.limpaAdiado(quebrado);   /* não estouram */

/* ── a lista do modal ── */
const t = (k, v) => ({ 'ls.mud.geometria': 'geometria', 'ls.mud.descricao': 'descrição', 'ls.mud.novo': 'novo no Altium',
                       'ls.almox': 'almoxarifado', 'ls.acervoAltium': 'espelho do Altium',
                       'ls.texto': 'Identificamos modificações vindas do Altium em {n} símbolos:',
                       'ls.texto1': 'Identificamos uma modificação vinda do Altium em 1 símbolo:',
                       'ls.pronto': '{n} símbolos atualizados a partir do Altium', 'ls.pronto1': '1 símbolo atualizado a partir do Altium' }[k] || k)
  .replace(/\{(\w+)\}/g, (m, x) => (v && x in v ? String(v[x]) : m));
const d0 = P.descreveItem(itens[0], t);
assert.deepStrictEqual(d0, { nome: 'RES [SMD]', acervo: 'espelho do Altium', mudou: ['geometria', 'descrição'] });
const d2 = P.descreveItem(itens[2], t);
assert.deepStrictEqual(d2, { nome: 'DIAC / DB3 DO-35', acervo: 'almoxarifado', mudou: ['geometria'] });
assert.deepStrictEqual(P.descreveItem({ acervo: 'altium', name: 'X', mudou: ['sei-la'] }, t).mudou, ['sei-la'], 'mudança desconhecida vai crua, não como chave ls.mud.*');
assert.strictEqual(P.descreveItem({ acervo: 'almox', name: 'SÓ NOME' }, t).nome, 'SÓ NOME', 'almox sem família/componente cai no name');
assert.strictEqual(P.descreveItem({}, t).nome, '?', 'item vazio não explode');
assert.deepStrictEqual(P.descreveItem(itens[0]).mudou, ['ls.mud.geometria', 'ls.mud.descricao'], 'sem t(), a chave volta como ela mesma');

const muitos = []; for (let i = 0; i < 30; i++) muitos.push({ acervo: 'altium', name: 'S' + i, mudou: ['geometria'] });
const L = P.montaLista(muitos, t);
assert.strictEqual(L.linhas.length, 12, 'até 12 nomes');
assert.strictEqual(L.sobra, 18, 'o resto vira +k');
assert.strictEqual(L.total, 30);
assert.strictEqual(L.linhas[0].nome, 'S0'); assert.strictEqual(L.linhas[11].nome, 'S11');
const L3 = P.montaLista(itens, t);
assert.strictEqual(L3.linhas.length, 3); assert.strictEqual(L3.sobra, 0, 'com 3 não sobra nada');
assert.strictEqual(P.montaLista(muitos, t, 5).sobra, 25, 'o limite é parâmetro');
assert.strictEqual(P.montaLista(null, t).total, 0);
assert.strictEqual(P.MAX_LISTA, 12);

/* ── textos com plural ── */
assert.strictEqual(P.textoIntro(3, t), 'Identificamos modificações vindas do Altium em 3 símbolos:');
assert.strictEqual(P.textoIntro(1, t), 'Identificamos uma modificação vinda do Altium em 1 símbolo:');
assert.strictEqual(P.textoPronto(1, t), '1 símbolo atualizado a partir do Altium');
assert.strictEqual(P.textoPronto(7, t), '7 símbolos atualizados a partir do Altium');
assert.strictEqual(P.textoIntro(2), 'ls.texto', 'sem t(), volta a chave — o {n} fica para a casca');

/* ── o corpo do altium-apply: os itens como vieram, e sem partilhar objeto com o estado ── */
const corpo = P.corpoApply(itens);
assert.deepStrictEqual(corpo, { itens });
assert.notStrictEqual(corpo.itens[0], itens[0], 'cópia rasa: mexer no corpo não mexe no estado');
assert.deepStrictEqual(P.corpoApply(null), { itens: [] });

/* ── cruzamento com o editor de símbolos ── */
assert.strictEqual(P.editorNaLista(itens, 'RES [SMD]'), true, 'símbolo aberto está entre os mudados');
assert.strictEqual(P.editorNaLista(itens, 'CAP [SMD]'), false);
assert.strictEqual(P.editorNaLista(itens, null), false, 'nada aberto');
assert.strictEqual(P.editorNaLista(itens, 'DB3 DO-35'), false, 'componente do almoxarifado não é símbolo do editor');
assert.strictEqual(P.editorNaLista(null, 'RES [SMD]'), false);

/* ── nomes dos arquivos para o badge/modal: só o basename, e só os mudados ── */
assert.deepStrictEqual(P.arquivosMudados(arqs), ['BIBLIOTECA DE ESQUEMA.SchLib', 'DIAC ALMOX.SchLib']);
assert.deepStrictEqual(P.arquivosMudados([{ arquivo: '/srv/libs/x.SchLib', mudou: true }]), ['x.SchLib'], 'barra normal também');
assert.deepStrictEqual(P.arquivosMudados(null), []);

/* ── throttle: uma a cada 30 s, nunca duas em paralelo, e zera() libera ── */
(async () => {
  let agora = 1000;
  const thr = P.mkThrottle(P.INTERVALO, () => agora);
  let rodou = 0;
  let solta;
  const lenta = () => new Promise(r => { rodou++; solta = r; });
  const p1 = thr.tenta(lenta);
  assert.ok(p1 && typeof p1.then === 'function', 'a primeira roda');
  assert.strictEqual(rodou, 0, 'a chamada é assíncrona (microtask) — a casca não espera');
  await Promise.resolve();
  assert.strictEqual(rodou, 1);
  const p2 = thr.tenta(lenta);
  assert.strictEqual(p2, p1, 'em curso: devolve a mesma promise, não roda de novo');
  assert.strictEqual(rodou, 1, 'nunca duas em paralelo');
  solta('ok');
  assert.strictEqual(await p1, 'ok', 'o valor da consulta passa');
  agora += 5000;
  assert.strictEqual(thr.tenta(lenta), null, '5 s depois: segurada');
  assert.strictEqual(rodou, 1);
  agora += 25000;
  const p3 = thr.tenta(lenta);
  assert.ok(p3, '30 s depois: roda de novo');
  await Promise.resolve();
  assert.strictEqual(rodou, 2);
  solta('ok');
  await p3;
  agora += 1000;
  assert.strictEqual(thr.tenta(lenta), null, 'logo depois: segurada de novo');
  thr.zera();
  const p4 = thr.tenta(lenta);
  assert.ok(p4, 'zera() libera a próxima (depois de aplicar, a aba confere na hora)');
  await Promise.resolve(); solta('ok'); await p4;
  /* consulta que falha não deixa o throttle preso em "em curso" */
  agora += 60000;
  const p5 = thr.tenta(() => Promise.reject(new Error('caiu')));
  await p5.then(() => assert.fail('devia rejeitar'), e => assert.strictEqual(e.message, 'caiu'));
  agora += 60000;
  const p6 = thr.tenta(() => 'seco');
  assert.ok(p6, 'depois da falha, roda de novo');
  assert.strictEqual(await p6, 'seco', 'fn síncrona também vale');
  assert.strictEqual(thr.tenta(() => { throw new Error('sinc'); }), null, 'dentro do intervalo: nem chama');

  console.log('test-libsync OK (assinatura, adiado/sessionStorage, descreveItem, montaLista 12+k, plural, corpoApply, editorNaLista, arquivosMudados, throttle 30 s/paralelo/zera/falha)');
})().catch(e => { console.error(e); process.exit(1); });
