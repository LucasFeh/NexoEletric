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
