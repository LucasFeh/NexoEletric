/* O "Odoo ↗" de todo componente (hub-odoolink.js), em Node.
 *
 *     node tests/test-odoolink.js
 *
 * Link errado não levanta exceção: abre a ficha de OUTRO produto, ou uma ficha em branco, e
 * quem clicou acha que o Odoo está desatualizado. Por isso a regra é testada, e não conferida
 * no olho.
 *
 * O que este arquivo prende:
 *  1. a URL usa o TEMPLATE, nunca o OdooId (a variante) — o exemplo medido do dono;
 *  2. a base sai do `fonte` do índice, e o `setFonte` da casca manda nela;
 *  3. valor com mais de um item: o OdooId desempata; sem ele, o primeiro;
 *  4. product.product → template pelos espelhos, refeito quando o acervo é recarregado;
 *  5. sem base ou sem tmpl não há link — nunca uma URL pela metade.
 */
const assert = require('assert');
const { loadVar } = require('./load.js');
const L = require('../hub-odoolink.js');

const FONTE = 'Odoo completo · http://192.168.15.192:8070/ · odoo_db';
globalThis.almoxIndex = { fonte: FONTE, libs: [{ var: 'almoxBasicos' }, { var: 'almoxEspeciais' }] };

/* ── (2) a base: sem a barra do fim, sem o "· odoo_db" ─────────────────────── */
assert.strictEqual(L.base(), 'http://192.168.15.192:8070');
assert.strictEqual(L.ACAO, 282);

/* ── (1)(5) a URL ──────────────────────────────────────────────────────────── */
assert.strictEqual(L.url('2116'), 'http://192.168.15.192:8070/odoo/action-282/2116');
assert.strictEqual(L.url({ odoo: '2118', tmpl: '2116' }), 'http://192.168.15.192:8070/odoo/action-282/2116',
  'o item leva à ficha do TEMPLATE, não da variante');
assert.strictEqual(L.url(''), '');
assert.strictEqual(L.url(null), '');
assert.strictEqual(L.url({ itens: [] }), '', 'valor sem item não tem ficha');

/* ── (3) valor com mais de um item ─────────────────────────────────────────── */
const dois = { label: '10K', itens: [{ odoo: '11', tmpl: '101' }, { odoo: '12', tmpl: '102' }] };
assert.strictEqual(L.tmplDe(dois), '101', 'sem OdooId, o primeiro item');
assert.strictEqual(L.tmplDe(dois, '12'), '102', 'o OdooId escolhe o item certo');
assert.strictEqual(L.tmplDe(dois, '99'), '101', 'OdooId que não é deste valor cai no primeiro');

/* ── (4) variante → template pelos espelhos ────────────────────────────────── */
globalThis.almoxBasicos = { symbols: [{ valores: [dois] }] };
globalThis.almoxEspeciais = { symbols: [{ valores: [{ itens: [{ odoo: 7, tmpl: 70 }] }] }] };
assert.strictEqual(L.tmplDoProduto('12'), '102');
assert.strictEqual(L.tmplDoProduto(7), '70', 'número e texto são o mesmo id');
assert.strictEqual(L.tmplDoProduto('404'), '');
assert.strictEqual(L.tmplDoProduto(''), '');
/* o __hubRecarregaLibs troca o OBJETO do global: o mapa velho não pode sobreviver a isso */
globalThis.almoxBasicos = { symbols: [{ valores: [{ itens: [{ odoo: '12', tmpl: '555' }] }] }] };
assert.strictEqual(L.tmplDoProduto('12'), '555', 'a recarga do acervo refaz o mapa');

/* ── (2) a casca apaga o global e entrega a fonte pelo setFonte ─────────────── */
const idx = globalThis.almoxIndex;
delete globalThis.almoxIndex;
assert.strictEqual(L.url('1'), '', 'sem índice e sem setFonte não há base');
L.setFonte('Odoo incremental · http://192.168.15.182:8070 · odoo_db');
assert.strictEqual(L.url('1'), 'http://192.168.15.182:8070/odoo/action-282/1');
L.setFonte({ fonte: 'snapshot em disco', odooUrl: 'http://10.0.0.5:8070' });
assert.strictEqual(L.base(), 'http://10.0.0.5:8070', 'a casca passa o ÍNDICE: o odooUrl vale');
L.setFonte('');
globalThis.almoxIndex = idx;

/* ── (6) regerar sem puxar: `fonte` vira "snapshot em disco", o `odooUrl` segura o link ── */
globalThis.almoxIndex = { fonte: 'snapshot em disco', odooUrl: 'http://192.168.15.192:8070', libs: idx.libs };
assert.strictEqual(L.base(), 'http://192.168.15.192:8070', 'snapshot com odooUrl continua com link');
globalThis.almoxIndex = { fonte: 'snapshot em disco', libs: idx.libs };
assert.strictEqual(L.url('1'), '', 'sem url nenhuma não se inventa uma');

/* ── (7) o Odoo "local" do servidor não é o do navegador ─────────────────────── */
/* com http://127.0.0.1:8070 na config do servidor, o link abriria o PC de quem clica */
globalThis.almoxIndex = { fonte: 'Odoo completo · http://127.0.0.1:8070 · odoo_db', libs: idx.libs };
globalThis.location = { hostname: '192.168.15.192' };
assert.strictEqual(L.base(), 'http://192.168.15.192:8070', 'loopback vira o host do hub, a porta fica');
globalThis.location = { hostname: 'localhost' };
assert.strictEqual(L.base(), 'http://127.0.0.1:8070', 'na própria máquina, loopback continua valendo');
delete globalThis.location;
globalThis.almoxIndex = idx;

/* ── (8) a ficha de um componente da folha: a cascata do odoolista.py ────────── */
globalThis.almoxBasicos = { symbols: [{ valores: [
  { altium: 'SMD 1206 10R 1/4W', label: '10R', itens: [{ odoo: '110', tmpl: '110', pkg: '1206' }] },
  { altium: 'SMD 1206 10K', label: '10K', itens: [{ odoo: '2118', tmpl: '2116', pkg: '1206' }] },
  { altium: 'CAP 2 FICHAS', label: '1uF', itens: [{ odoo: '31', tmpl: '301', pkg: '0805' },
                                                    { odoo: '32', tmpl: '302', pkg: '1206' }] },
] }] };
globalThis.almoxEspeciais = { symbols: [] };
const F = c => L.fichaDoComp(c);
/* 1. OdooId é final */
assert.strictEqual(L.tmplDe(F({ sym: 'x', params: 'Value=10K;OdooId=2118' }).alvo), '2116');
const semEspelho = F({ sym: 'SMD 1206 10K', params: 'OdooId=6255' });
assert.ok(!semEspelho.alvo && /6255/.test(semEspelho.motivo),
  'OdooId fora do espelho NÃO cai no nome: a lista manda o 6255, a ficha não pode abrir outro');
/* dois ids não são um id: a lista pula o degrau, a ficha também */
assert.strictEqual(L.tmplDe(F({ sym: 'SMD 1206 10K', params: 'OdooId=1, 2' }).alvo), '2116');
/* 2. o NOME EXATO do sym — nunca o desenho emprestado do lib-subs */
assert.strictEqual(F({ sym: 'RES [ SMD ]', params: 'Value=10K' }), null,
  'o "RES [ SMD ]" desenhado com o 10R não é o produto 10R');
assert.strictEqual(L.tmplDe(F({ sym: 'SMD 1206 10K' }).alvo), '2116');
/* valor com dois itens: o footprint desempata; sem desempate, ambíguo e sem link */
assert.strictEqual(L.tmplDe(F({ sym: 'CAP 2 FICHAS', footprint: '1206' }).alvo), '302');
const amb = F({ sym: 'CAP 2 FICHAS', footprint: 'CAP 0603' });
assert.ok(!amb.alvo && /ambíguo: 2/.test(amb.motivo), 'ambíguo não escolhe o primeiro calado');
/* 3. nada */
assert.strictEqual(F({ sym: 'BC337' }), null);
assert.strictEqual(F(null), null);

/* ── (1) com o espelho de verdade: o exemplo que o dono deu ─────────────────── */
/* "Kk Macho 2,54mm 4 Vias 180° Molex Branco (2510)": variante 2118, template 2116 — e 2116
   é o número do link dele. Se o espelho não tiver o item (sincronismo novo, produto
   renumerado), o teste diz isso em vez de passar calado. */
let real = null;
try { real = loadVar('Libs/almox-basicos.js', 'almoxBasicos'); } catch (e) { real = null; }
if (real){
  globalThis.almoxBasicos = real;
  globalThis.almoxEspeciais = { symbols: [] };
  const t = L.tmplDoProduto('2118');
  if (t) assert.strictEqual(t, '2116', 'o exemplo do dono: variante 2118 abre a ficha 2116');
  else console.log('  (aviso) o espelho não tem mais o produto 2118 — exemplo do dono não conferido');
  /* o caso que a revisão achou, no dado real: R17 do PRJ-UR-DI261924 é "RES [ SMD ]" 10K, sem
     OdooId, e o lib-subs.js o desenha com o 10R. Ficha nenhuma é a resposta certa. */
  assert.strictEqual(L.fichaDoComp({ ref: 'R17', sym: 'RES [ SMD ]', params: 'Value=10K' }), null,
    'R17 (RES [ SMD ] 10K) não abre produto nenhum — muito menos o 10R');
}

console.log('test-odoolink OK (template e não variante, base do índice/setFonte/odooUrl, snapshot '
          + 'sem url, loopback vira o host do hub, desempate por OdooId, variante→template refeito '
          + 'na recarga, a ficha da folha segue a cascata do odoolista.py e não o desenho)');
