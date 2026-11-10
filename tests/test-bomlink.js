const assert = require('assert');

/* ═══════════════ o BOM servido por link ═══════════════
   O BOM deixou de ser um arquivo que se baixa: cada projeto tem uma URL fixa, /bom/<id>, e
   o servidor monta a pagina na hora com ESTE gerador. Nada fica gravado, e e daí que vem a
   propriedade que se queria — melhorar o gerador melhora o BOM de todos os projetos no
   mesmo instante.

   O que se garante aqui é o CONTRATO entre os dois lados: o que a página recebe do
   servidor (api, vistos, revisões) e o que ela faz com isso. O servidor tem o seu lado
   coberto em tests/test_hubapi.py. */

global.window = { addEventListener() {} };            /* sem isSecureContext: força o caminho do textarea */
const Bom = require('../hub-bom.js');
/* O painel BOM mora no script inline do hub. Um erro de sintaxe ali derruba o hub inteiro,
   mesmo que o servidor e a pagina /bom/<id> respondam 200. */
const hub = require('fs').readFileSync(require('path').join(__dirname, '..', 'hub.html'), 'utf8');
for (const trecho of hub.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))
  new Function(trecho[1]);

/* placa mínima: um resistor no topo, com bbox e outline, que é o que o model exige */
const B = {
  board: { bbox: { x1: 0, y1: 0, x2: 10, y2: 10 }, outline: [
    { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 }, { kind: 'line', x1: 10, y1: 0, x2: 10, y2: 10 },
    { kind: 'line', x1: 10, y1: 10, x2: 0, y2: 10 }, { kind: 'line', x1: 0, y1: 10, x2: 0, y2: 0 },
  ] },
  components: [{ id: 'cR1', ref: 'R1', footprint: 'RES 0805', comment: '10k', layer: 'Top',
                 x: 5, y: 5, rot: 0, bbox: { x1: 4, y1: 4, x2: 6, y2: 6 }, pads: [] }],
  freepads: [], tracks: [], arcs: [], vias: [], regions: [], silk: [], texts: [],
};

const partes = h => [...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x => x[1]);
const dDe = h => new Function(partes(h)[0] + ';return D;')();
const runtimeDe = h => partes(h)[1];

/* ── servida por /bom/<id>: a página fala com o servidor ── */
{
  const h = Bom.gerar(B, null, { proj: 'Placa X', api: '/api/bom/placa-x',
                                 vistos: { 'R1|10k': true }, rev: 7, sourceRev: 'abc123' }).html;
  const D = dDe(h);
  assert.strictEqual(D.api, '/api/bom/placa-x', 'a página não recebeu com quem falar');
  assert.deepStrictEqual(D.vistos, { 'R1|10k': true }, 'os vistos da bancada não vieram');
  assert.strictEqual(D.rev, 7);
  assert.strictEqual(D.sourceRev, 'abc123', 'sem sourceRev a página não nota esquema/PCB novos');

  const js = runtimeDe(h);
  /* o que sobe é um DELTA: dois tablets marcando peças diferentes têm de se somar, e não
     um sobrescrever o mapa inteiro do outro */
  assert.ok(/corpo = \{ set: delta \}/.test(js), 'não manda delta');
  assert.ok(/enviados\[k\]/.test(js), 'não compara com o que o servidor já confirmou');
  /* "Limpar vistos" vai numa chamada, e não num false por peça da placa */
  assert.ok(/salvaFeitos\(\{ limpar: true \}\)/.test(js), 'limpar não usa clear');
  assert.ok(/clear: true/.test(js));
  /* servidor fora do ar tem de aparecer na tela: silêncio faria a bancada marcar no vazio */
  assert.ok(/servidor fora do ar/.test(js), 'não avisa quando para de salvar');
  assert.ok(h.includes('id="semrede"'), 'o aviso não existe no HTML (abriria morto)');
  /* sincronia entre quem abriu o link, e recarga quando o board muda */
  assert.ok(/setInterval\(sincroniza, 4000\)/.test(js), 'não busca o que os outros marcaram');
  assert.ok(/visibilitychange/.test(js), 'voltar para a aba não re-sincroniza');
  assert.ok(/j\.sourceRev !== D\.sourceRev/.test(js), 'fonte nova nao recarrega');
  assert.ok(h.includes('id="btRefresh"') && /btRefresh'\)\.onclick/.test(js),
            'botao de refresh manual nao esta ligado');
}

/* ── sem servidor (aberta de um arquivo): volta ao localStorage, como era ── */
{
  const h = Bom.gerar(B, null, { proj: 'Placa X' }).html;
  const D = dDe(h);
  assert.strictEqual(D.api, '', 'sem api a página não pode achar que tem servidor');
  assert.strictEqual(D.vistos, null);
  const js = runtimeDe(h);
  assert.ok(/localStorage\.setItem\(CHAVE/.test(js), 'perdeu a saída sem servidor');
  assert.ok(/if \(API\)/.test(js), 'não decide entre servidor e localStorage');
}

/* ── o link ── */
assert.strictEqual(Bom.linkDe('placa-x'), '/bom/placa-x');
assert.strictEqual(Bom.linkDe('a b'), '/bom/a%20b', 'link sem escape quebraria no browser');
assert.strictEqual(Bom.linkDe(''), '/bom/');

/* ── copiarLink: grava as opções, pede a URL, copia ── */
(async () => {
  const chamadas = [];
  global.document = {
    createElement: () => ({ style: {}, setAttribute() {}, select() {}, setSelectionRange() {}, value: '' }),
    body: { appendChild() {}, removeChild() {} },
    execCommand: () => true,
  };

  global.location = { protocol: 'file:' };
  let r = await Bom.copiarLink('placa-x', { dark: true });
  assert.ok(!r.ok && /hubserver/.test(r.error), 'file:// tem de explicar que precisa do servidor');

  r = await Bom.copiarLink('', {});
  assert.ok(!r.ok, 'sem id não há link');

  global.location = { protocol: 'http:', origin: 'http://127.0.0.1:8001' };
  global.fetch = (u, o) => {
    chamadas.push((o && o.method) || 'GET');
    if (/\/opts$/.test(u)) {
      assert.strictEqual(JSON.parse(o.body).opts.dark, true, 'as opções da aba não subiram');
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () =>
      Promise.resolve({ ok: true, url: 'http://192.168.1.9:8001/bom/placa-x', lan: true }) });
  };
  r = await Bom.copiarLink('placa-x', { dark: true });
  assert.ok(r.ok, 'não montou o link: ' + r.error);
  /* o link copiado é o de REDE, não o localhost que este navegador usou — o ponto do
     link é abrir no tablet da bancada */
  assert.strictEqual(r.url, 'http://192.168.1.9:8001/bom/placa-x');
  assert.ok(r.lan && r.copiou, 'não copiou pelo caminho do textarea');
  assert.deepStrictEqual(chamadas, ['POST', 'GET'], 'grava as opções ANTES de pedir a URL');

  /* servidor antigo, sem a rota: tem de dizer o que fazer, não devolver undefined */
  global.fetch = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  r = await Bom.copiarLink('placa-x', null);
  assert.ok(!r.ok && /reinicie o hubserver/.test(r.error), 'não orienta em servidor velho');

  /* opções são conforto: se a gravação delas falhar, o link ainda sai */
  let n = 0;
  global.fetch = u => /\/opts$/.test(u)
    ? Promise.reject(new Error('sem rede'))
    : (n++, Promise.resolve({ ok: true, status: 200, json: () =>
        Promise.resolve({ ok: true, url: 'http://h/bom/placa-x', lan: true }) }));
  r = await Bom.copiarLink('placa-x', { dark: false });
  assert.ok(r.ok && n === 1, 'opções falhando não podem derrubar o link');

  console.log('test-bomlink OK (contrato api/vistos/rev, delta, sincronia, fallback localStorage, copiarLink)');
})().catch(e => { console.error(e); process.exit(1); });

/* ── 1.89.4: o título e o link pelo nome ATUAL da placa ──
   Pedido do dono: "no BOM, o nome que vem no link ainda não tá pegando o nome atual da placa". O painel pede a fonte
   com a variante ativa e usa o título que o hubserver leu do cabeçalho agora (bomNomeSrv); sem resposta, o cabeçalho
   que o hub tem — nunca mais o nome da pasta quando a placa está definida. */
{
  /* só a parte pura do hub-variantes.js (sem document): a de tela abre um BroadcastChannel que prende o processo */
  const doc = global.document;
  delete global.document;
  const V = require('../hub-variantes.js');
  global.document = doc;
  const trecho = hub.match(/let bomNomeSrv = null;[^\n]*\nfunction bomNome\(p, v\) \{[\s\S]*?\n\}\n/);
  assert.ok(trecho, 'o painel não tem bomNome');
  const sch = { params: 'CodigoDaPlaca=PMD-DI261946;NomeDaPlaca=PLACA MAE DMB;CodigoDoEquipamento=DMB-DI231765' };
  const S = { detail: { schematic: sch } };
  const f = new Function('window', 'S', 'HubVariantes', trecho[0] + ';return { bomNome, srv: x => { bomNomeSrv = x; } };');
  const N = f({ HubVariantes: V }, S, V);
  const p = { id: 'dmb-di231765-p2', name: 'DMB - DI231765_P2' };
  assert.strictEqual(N.bomNome(p, null), 'PMD-DI261946 · PLACA MAE DMB', 'o título é o da placa, não o da pasta');
  assert.strictEqual(N.bomNome(p, { id: 'v1', nome: 'Sem display', codigo: 'X-DI1' }), 'PMD-DI261946 SEM DISPLAY',
                     'na variante, o código da PCB montada (1.89.0)');
  /* o Definir projeto trocou a placa: o hubserver leu o cabeçalho novo e o título acompanha */
  N.srv({ chave: p.id + '|', nome: 'PMD-DI261999 · PLACA NOVA' });
  assert.strictEqual(N.bomNome(p, null), 'PMD-DI261999 · PLACA NOVA');
  assert.strictEqual(N.bomNome(p, { id: 'v1', nome: 'Sem display' }), 'PMD-DI261946 SEM DISPLAY', 'o do servidor é de outra variante');
  S.detail.schematic = { params: '' };
  N.srv(null);
  assert.strictEqual(N.bomNome(p, null), 'DMB - DI231765_P2', 'sem placa definida, a pasta');
  assert.ok(/\/source\?variante=' \+ encodeURIComponent\(\(va && va\.id\) \|\| ''\)/.test(hub), 'a fonte do painel não leva a variante ativa');
  assert.ok(/proj: bomNome\(p, v\)/.test(hub), 'o BOM do painel não usa o nome da placa');
  assert.ok(hub.includes('id="bomOutros"'), 'os links das outras variantes não aparecem');
}
