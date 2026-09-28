'use strict';
// Biblioteca do servidor (1.2.0): a decisao do app (lib/lib-remota.js), a importacao sem os
// grupos do espelho, e o contrato com o hubserver no modo remoto (libremota.py).
//
// Os testes com hub sobem o hubserver.py do pacote (build/hub), como import.test.js. O de
// ponta a ponta so liga quando o pacote tem o backend do modo remoto (ALTIUMHUB_LIB_REMOTA em
// algum .py): ate o merge do principal e um `npm run build:prep`, ele e pulado.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { Backend } = require('../lib/backend');
const workspace = require('../lib/workspace');
const importer = require('../lib/import-server');
const libRemota = require('../lib/lib-remota');
const settings = require('../lib/settings');

const APP = path.resolve(__dirname, '..');
const PYTHON = path.join(APP, 'build', 'python', 'python.exe');
const BUNDLE = path.join(APP, 'build', 'hub');
const PRONTO = fs.existsSync(PYTHON) && fs.existsSync(path.join(BUNDLE, 'altiumhub-manifest.json'));
const SKIP = !PRONTO && 'rode npm run build:prep antes';

// O pacote ja traz o backend do modo remoto?
function pacoteTemLibRemota() {
  if (!PRONTO) return false;
  try {
    return workspace.lerManifesto(BUNDLE).code.some((e) => e.p.endsWith('.py') &&
      fs.readFileSync(path.join(BUNDLE, ...e.p.split('/')), 'utf8').includes('ALTIUMHUB_LIB_REMOTA'));
  } catch {
    return false;
  }
}
const COM_BACKEND = pacoteTemLibRemota();

function tmp(p) { return fs.mkdtempSync(path.join(os.tmpdir(), p)); }
function escreve(ws, rel, txt) {
  const f = path.join(ws, ...rel.split('/'));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, txt);
  return f;
}
const ler = (ws, rel) => fs.readFileSync(path.join(ws, ...rel.split('/')), 'utf8');
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function pede(base, caminho, { method = 'GET', json } = {}) {
  const r = await fetch(base + caminho, {
    method,
    headers: json === undefined ? {} : { 'Content-Type': 'application/json' },
    body: json === undefined ? undefined : JSON.stringify(json),
    signal: AbortSignal.timeout(30000),
  });
  const texto = await r.text();
  let corpo = null;
  try { corpo = JSON.parse(texto); } catch { /* HTML */ }
  return { status: r.status, corpo, texto };
}

// Espera uma condicao que depende de uma thread do hub (o espelho ao subir, o estado online).
async function ate(cond, ms, oQue) {
  const fim = Date.now() + ms;
  for (;;) {
    const v = await cond();
    if (v) return v;
    if (Date.now() > fim) throw new Error('nao aconteceu em ' + ms + ' ms: ' + oQue);
    await espera(250);
  }
}

// ───────────────────────────── a decisao (funcoes puras) ─────────────────────────────

test('modo remoto: ligado por padrao, desligado pela caixa, pela pasta de desenvolvedor ou por endereco invalido', () => {
  assert.strictEqual(settings.PADRAO.libRemota, true, 'a setting nasce ligada');
  const s = { ...settings.PADRAO };
  assert.strictEqual(libRemota.servidor(s, false), 'http://192.168.15.192:8100');
  assert.ok(libRemota.ligada(s, false));
  assert.ok(libRemota.ligada({ serverUrl: 'http://h:8100' }, false), 'settings.json antigo, sem a chave: vale o padrao');
  assert.ok(!libRemota.ligada({ ...s, libRemota: false }, false), 'caixa desmarcada');
  assert.ok(!libRemota.ligada(s, true), 'pasta de desenvolvedor (git) nunca liga');
  for (const ruim of ['', '   ', 'ftp://h/x', 'file:///C:/Libs', '192.168.15.192:8100', 'nao e url', null]) {
    assert.strictEqual(libRemota.servidor({ ...s, serverUrl: ruim }, false), '', String(ruim));
  }
  assert.ok(!libRemota.ligada(null, false));
  // o que o hubserver recebe: sem barra final (o repasse concatena o caminho)
  assert.strictEqual(libRemota.servidor({ ...s, serverUrl: ' https://hub.exemplo:8443/ ' }, false), 'https://hub.exemplo:8443');
  assert.deepStrictEqual(libRemota.envDoHub(s, false), { ALTIUMHUB_LIB_REMOTA: 'http://192.168.15.192:8100' });
  assert.deepStrictEqual(libRemota.envDoHub({ ...s, libRemota: false }, false), {}, 'modo local: nenhuma variavel');
  assert.deepStrictEqual(libRemota.envDoHub(s, true), {});
});

test('grupos da importacao: o modo remoto tira libs e almox, e so eles', () => {
  const todos = ['projetos', 'libs', 'almox', 'almoxLibs'];
  assert.deepStrictEqual(libRemota.gruposDaImportacao(todos, false), { grupos: todos, recusados: [] });
  assert.deepStrictEqual(libRemota.gruposDaImportacao(todos, true),
    { grupos: ['projetos', 'almoxLibs'], recusados: ['libs', 'almox'] });
  assert.deepStrictEqual(libRemota.gruposDaImportacao(undefined, true),
    { grupos: ['projetos', 'almoxLibs'], recusados: ['libs', 'almox'] }, 'sem lista = todos, como o importar()');
  assert.deepStrictEqual(libRemota.gruposDaImportacao(['almox'], true), { grupos: [], recusados: ['almox'] },
    'o que o guarda antigo pediria: nada sobra (o processo principal recusa)');
  assert.deepStrictEqual(libRemota.gruposDaImportacao(['projetos', 'projetos'], true), { grupos: ['projetos'], recusados: [] });
  assert.deepStrictEqual(libRemota.GRUPOS, todos, 'a lista bate com as caixas de ui/import.html');
});

test('o hub no ar desmente o pedido so com todas as letras', () => {
  assert.strictEqual(libRemota.modoDoHub(false, { status: 200, json: { modo: 'remota' } }), false, 'sem pedido nunca e remota');
  assert.strictEqual(libRemota.modoDoHub(true, null), true, 'sem resposta: vale o pedido');
  assert.strictEqual(libRemota.modoDoHub(true, { status: 404, json: null }), false, 'hub de antes do libremota.py');
  assert.strictEqual(libRemota.modoDoHub(true, { status: 200, json: { ok: true, modo: 'local' } }), false, 'endereco recusado pelo hub');
  assert.strictEqual(libRemota.modoDoHub(true, { status: 200, json: { ok: true, modo: 'remota', online: false } }), true, 'offline continua remota');
  assert.strictEqual(libRemota.modoDoHub(true, { status: 500, json: null }), true);
});

// ───────────────────────────── desligar a caixa depois do espelho ─────────────────────────────

const sha1 = (x) => crypto.createHash('sha1').update(x).digest('hex');

// Um "servidor" so de arquivos, sem Python: a importacao so faz GET com ETag (hubserver »
// _serve). Porta da faixa de teste; o listen do Node no Windows nao liga por cima de outro.
async function servidorDeArquivos(dir) {
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
    let buf;
    try {
      buf = fs.readFileSync(path.join(dir, ...rel.split('/')));
    } catch {
      res.writeHead(404);
      return res.end();
    }
    const etag = '"' + sha1(buf) + '"';
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag });
      return res.end();
    }
    res.writeHead(200, { ETag: etag, 'Content-Length': buf.length });
    return res.end(buf);
  });
  for (let p = 18560; p < 18570; p++) {
    const ok = await new Promise((resolve) => {
      const falhou = () => resolve(false);
      srv.once('error', falhou);
      srv.listen({ port: p, host: '127.0.0.1', exclusive: true }, () => {
        srv.off('error', falhou);
        resolve(true);
      });
    });
    if (ok) {
      return {
        url: `http://127.0.0.1:${p}`,
        fecha: () => new Promise((r) => { srv.closeAllConnections(); srv.close(() => r()); }),
      };
    }
  }
  throw new Error('nenhuma porta livre entre 18560 e 18569');
}

// Uma gravacao do espelho do hub, no formato do libremota.py » Remota._um/_grava_estado: o
// arquivo em Libs/ e, em .altiumhub/lib-remota.json, arquivos[<nome>] = {etag, sha1 do disco}.
function espelhoGrava(ws, nome, txt, servidor) {
  escreve(ws, 'Libs/' + nome, txt);
  const f = path.join(ws, '.altiumhub', 'lib-remota.json');
  let e = {};
  try { e = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* primeira rodada */ }
  e.servidor = servidor;
  e.arquivos = e.arquivos || {};
  e.backups = e.backups || [];
  e.arquivos[nome] = { etag: '"do-servidor"', sha1: sha1(Buffer.from(txt)) };
  e.ultimaSincronia = '2026-09-28 12:00:00';
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(e, null, 1));
}

test('o que o espelho gravou vira base: os dois lugares do estado, e nada do que nao se reconhece', () => {
  const ws = tmp('ahlrgrav-');
  assert.deepStrictEqual(libRemota.gravadosPeloEspelho(ws), {}, 'sem estado: nada');
  assert.deepStrictEqual(libRemota.gravadosPeloEspelho(''), {});
  const a = sha1('a');
  const b = sha1('b');
  escreve(ws, '.altiumhub/lib-remota.json', JSON.stringify({
    servidor: 'http://h:8100',
    arquivos: {
      'schlib.js': { etag: '"1"', sha1: a },
      'BIBLIOTECA DE ESQUEMA.SchLib': { sha1: b },       // estado de outro servidor: so o sha1
      'sem-sha.js': { etag: '"2"' },
      'curto.js': { sha1: 'abc' },
      'Almox/X.SchLib': { sha1: a },                     // o espelho nao escreve fora do topo
      'nulo.js': null,
    },
  }));
  // hub que subiu antes de a .altiumhub existir (libremota.py: fora do app, .lib-remota/)
  escreve(ws, '.lib-remota/estado.json', JSON.stringify({ arquivos: { 'schlib.js': { sha1: b }, 'pcblib.js': { sha1: a } } }));
  assert.deepStrictEqual(libRemota.gravadosPeloEspelho(ws), {
    'Libs/schlib.js': [a, b],
    'Libs/BIBLIOTECA DE ESQUEMA.SchLib': [b],
    'Libs/pcblib.js': [a],
  });
  escreve(ws, '.altiumhub/lib-remota.json', '{ quebrado');
  assert.deepStrictEqual(libRemota.gravadosPeloEspelho(ws), { 'Libs/schlib.js': [b], 'Libs/pcblib.js': [a] },
    'estado ilegivel nao derruba o outro, e so faz a protecao de sempre acontecer');
});

test('desligar a biblioteca do servidor: o que o espelho gravou se atualiza na importacao, sem conflito nem backup', async (t) => {
  // O defeito: o espelho grava Libs/ sem passar pelo import-state.json. Desmarcada a caixa, a
  // importacao tomava a copia do espelho por edicao local -- biblioteca em conflito para
  // sempre, almoxarifado com backup espurio antes de cada sincronismo.
  const srv = tmp('ahlrespsrv-');
  const s = await servidorDeArquivos(srv);
  t.after(s.fecha);
  const v = (n) => ({
    'schlib.js': `var schlib = {"symbols":["servidor v${n}"]};\n`,
    'lib-subs.js': `var libSubs = [{"v":${n}}];\n`,
    'almox-parts.json': JSON.stringify({ proximo: n }),
    'lib-ledger.json': JSON.stringify({ arquivos: {}, v: n }),
  });
  const publica = (n) => { for (const [nome, txt] of Object.entries(v(n))) escreve(srv, 'Libs/' + nome, txt); };
  const imp = (ws) => importer.importar({ ws, serverUrl: s.url, grupos: libRemota.gruposDaImportacao(['libs', 'almox'], false).grupos, seedHashes: {} });

  // com a base de uma importacao da 1.1.x, e numa instalacao nova (sem import-state)
  for (const comBase of [true, false]) {
    const ws = tmp('ahlrespws-');
    fs.mkdirSync(path.join(ws, '.altiumhub'));
    publica(0);
    if (comBase) {
      const r0 = await imp(ws);
      assert.deepStrictEqual(r0.novos.sort(), Object.keys(v(0)).map((n) => 'Libs/' + n).sort());
    }

    // modo remoto: o espelho traz a v1 de tudo
    publica(1);
    for (const [nome, txt] of Object.entries(v(1))) espelhoGrava(ws, nome, txt, s.url);
    // a caixa desmarcada, o hub local: alguem mexe em dois deles DEPOIS do espelho. Esses
    // continuam sendo trabalho de alguem e seguem protegidos como sempre.
    const subsLocal = 'var libSubs = [{"editado":"aqui"}];\n';
    escreve(ws, 'Libs/lib-subs.js', subsLocal);
    const ledgerLocal = JSON.stringify({ arquivos: {}, editado: 'aqui' });
    escreve(ws, 'Libs/lib-ledger.json', ledgerLocal);

    // o servidor segue andando
    publica(2);
    const r = await imp(ws);
    const qual = comBase ? 'com base da 1.1.x' : 'instalacao nova';
    assert.deepStrictEqual(r.erros, [], qual);
    assert.deepStrictEqual(r.conflitos, ['Libs/lib-subs.js'], `${qual}: so a edicao local vira conflito: ${JSON.stringify(r)}`);
    assert.deepStrictEqual(r.backups, ['Libs/lib-ledger.json'], `${qual}: so a edicao local vai para o backup: ${JSON.stringify(r)}`);
    assert.deepStrictEqual(r.atualizados.sort(), ['Libs/almox-parts.json', 'Libs/lib-ledger.json', 'Libs/schlib.js'], qual);
    assert.strictEqual(ler(ws, 'Libs/schlib.js'), v(2)['schlib.js'], `${qual}: a biblioteca publicada se atualiza`);
    assert.strictEqual(ler(ws, 'Libs/almox-parts.json'), v(2)['almox-parts.json'], qual);
    assert.strictEqual(ler(ws, 'Libs/lib-subs.js'), subsLocal, `${qual}: a edicao local fica`);
    assert.strictEqual(fs.readFileSync(path.join(r.pastaBackup, 'Libs', 'lib-ledger.json'), 'utf8'), ledgerLocal);
    assert.ok(!fs.existsSync(path.join(r.pastaBackup, 'Libs', 'almox-parts.json')), `${qual}: sem backup do que o espelho gravou`);

    // e a base ficou registrada: a proxima rodada nao repete nada disso
    const r2 = await imp(ws);
    assert.deepStrictEqual(r2.atualizados.concat(r2.backups), [], `${qual}: ${JSON.stringify(r2)}`);
    assert.deepStrictEqual(r2.conflitos, ['Libs/lib-subs.js'], `${qual}: o conflito de verdade continua`);
  }
});

// ───────────────────────────── com hub de verdade ─────────────────────────────

test('importacao no modo remoto: projetos com o indice, Libs/Almox pela lista do ledger do SERVIDOR, biblioteca local intocada', { skip: SKIP }, async (t) => {
  const srv = tmp('ahlrsrv-');
  workspace.sync(srv, BUNDLE);
  const P = 'Projects/PLACA-1';
  escreve(srv, `${P}/board.js`, 'var pcbmirror = {"components":[],"nets":[],"tracks":[],"vias":[]};');
  escreve(srv, `${P}/schematic.js`, 'var schematic = {"items":[]};');
  escreve(srv, 'projects.js', 'var projects = [{"name":"PLACA-1"}];');
  escreve(srv, 'Libs/lib-ledger.json', JSON.stringify({ arquivos: { 'Libs/Almox/NOVO ALMOX.SchLib': {} }, v: 'servidor' }));
  escreve(srv, 'Libs/Almox/NOVO ALMOX.SchLib', Buffer.alloc(5000, 3));
  escreve(srv, 'Libs/Almox/NOVO ALMOX.LibPkg', 'pkg');
  escreve(srv, 'Libs/schlib.js', 'var schlib = {"symbols":["do servidor"]};');
  const hub = new Backend({ python: PYTHON, workspace: srv, logDir: tmp('ahlrlog-') });
  await hub.start({ port: 18500, lan: false });
  t.after(() => hub.stop());
  const serverUrl = `http://127.0.0.1:${hub.port}`;

  // a maquina local: o ledger e a semente do instalador (nao conhece o NOVO), e a biblioteca
  // e a que o espelho do hub mantem -- a importacao nao pode encostar nela
  const ws = tmp('ahlrloc-');
  workspace.sync(ws, BUNDLE);
  const ledgerAntes = ler(ws, 'Libs/lib-ledger.json');
  escreve(ws, 'Libs/schlib.js', 'var schlib = {"symbols":["o espelho"]};');

  const g = libRemota.gruposDaImportacao(['projetos', 'libs', 'almox', 'almoxLibs'], true);
  const r = await importer.importar({ ws, serverUrl, grupos: g.grupos, seedHashes: workspace.seedHashes(ws, BUNDLE) });

  assert.deepStrictEqual(r.erros, []);
  assert.strictEqual(ler(ws, `${P}/schematic.js`), 'var schematic = {"items":[]};');
  assert.strictEqual(ler(ws, 'projects.js'), 'var projects = [{"name":"PLACA-1"}];', 'o indice vem com os projetos');
  assert.strictEqual(fs.statSync(path.join(ws, 'Libs/Almox/NOVO ALMOX.SchLib')).size, 5000,
    'a lista de Libs/Almox saiu do ledger do servidor, e nao da semente local');
  assert.ok(fs.existsSync(path.join(ws, 'Libs/Almox/NOVO ALMOX.LibPkg')));
  assert.strictEqual(ler(ws, 'Libs/lib-ledger.json'), ledgerAntes, 'o ledger local nao e gravado (e do espelho)');
  assert.strictEqual(ler(ws, 'Libs/schlib.js'), 'var schlib = {"symbols":["o espelho"]};', 'biblioteca local intocada');
  assert.ok(!r.novos.concat(r.atualizados, r.backups, r.conflitos).some((rel) => rel.startsWith('Libs/') && !rel.startsWith('Libs/Almox/')),
    'nada do topo de Libs/ entrou: ' + JSON.stringify(r));
});

test('o app segue o que o hub no ar diz de si', { skip: SKIP }, async (t) => {
  // Servidor inalcancavel de proposito: o que importa aqui e a resposta do hub LOCAL. Sem o
  // backend no pacote ele ignora a variavel e responde 404 -- o app tem de ficar no modo local.
  const ws = tmp('ahlrmodo-');
  workspace.sync(ws, BUNDLE);
  const hub = new Backend({ python: PYTHON, workspace: ws, logDir: tmp('ahlrmodolog-'), env: { ALTIUMHUB_LIB_REMOTA: 'http://127.0.0.1:1' } });
  await hub.start({ port: 18510, lan: false });
  t.after(() => hub.stop());
  const r = await pede(hub.url(), '/api/lib-remota/status');
  assert.strictEqual(libRemota.modoDoHub(true, { status: r.status, json: r.corpo }), COM_BACKEND,
    `status ${r.status} ${r.texto.slice(0, 200)}`);
  if (COM_BACKEND) {
    assert.strictEqual(r.corpo.modo, 'remota');
    assert.strictEqual(r.corpo.servidor, 'http://127.0.0.1:1');
  }
});

test('contrato do hub no modo remoto: espelho, repasse, 409 da rota legada, offline so leitura', {
  skip: SKIP || (!COM_BACKEND && 'o pacote ainda nao tem o backend do modo remoto (merge do principal + npm run build:prep)'),
}, async (t) => {
  // ── o "servidor" ──
  const srv = tmp('ahlrsrv2-');
  workspace.sync(srv, BUNDLE);
  const schlibSrv = 'var schlib = {"symbols":["do servidor"]};\n';
  escreve(srv, 'Libs/schlib.js', schlibSrv);
  const servidor = new Backend({ python: PYTHON, workspace: srv, logDir: tmp('ahlrsrvlog-') });
  await servidor.start({ port: 18520, lan: false });
  let servidorNoAr = true;
  t.after(() => (servidorNoAr ? servidor.stop() : null));
  const serverUrl = `http://127.0.0.1:${servidor.port}`;

  // modo local (sem a variavel): a rota existe e diz isso
  const semVar = await pede(serverUrl, '/api/lib-remota/status');
  assert.deepStrictEqual(semVar.corpo, { ok: true, modo: 'local' });

  // ── este PC: uma edicao de biblioteca que so ele tem (a da 1.1.x, antes do modo remoto) ──
  const ws = tmp('ahlrloc2-');
  workspace.sync(ws, BUNDLE);
  const schlibLocal = 'var schlib = {"symbols":["editado so aqui"]};\n';
  escreve(ws, 'Libs/schlib.js', schlibLocal);
  escreve(ws, 'Projects/LOCAL/schematic.js', 'var schematic = {"items":[]};');
  const hub = new Backend({ python: PYTHON, workspace: ws, logDir: tmp('ahlrloclog-'), env: libRemota.envDoHub({ serverUrl }, false) });
  await hub.start({ port: 18530, lan: false });
  t.after(() => hub.stop());
  const local = hub.url();

  // (a) espelho ao subir, e o que era local vai para o backup antes de ser trocado
  await ate(() => ler(ws, 'Libs/schlib.js') === schlibSrv, 20000, 'o espelho trazer o schlib.js do servidor');
  // online vem antes (a sonda, o /__events); a ultimaSincronia so no fim da rodada inteira
  const st = await ate(async () => {
    const x = (await pede(local, '/api/lib-remota/status')).corpo;
    return x && x.online && x.ultimaSincronia ? x : null;
  }, 20000, 'o status dizer online, com a primeira rodada do espelho completa');
  assert.strictEqual(st.modo, 'remota');
  assert.strictEqual(st.servidor, serverUrl);
  assert.match(String(st.ultimaSincronia), /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
  assert.ok(JSON.stringify(st.backups || []).includes('schlib.js'), 'a edicao local foi guardada: ' + JSON.stringify(st.backups));
  const dirBk = path.join(ws, '.altiumhub', 'backup');
  const bk = fs.readdirSync(dirBk).filter((d) => d.startsWith('lib-remota-'))
    .map((d) => path.join(dirBk, d, 'Libs', 'schlib.js')).find((f) => fs.existsSync(f));
  assert.ok(bk, 'backup em .altiumhub/backup/lib-remota-<carimbo>/Libs/schlib.js');
  assert.strictEqual(fs.readFileSync(bk, 'utf8'), schlibLocal, 'nada some calado');

  // (b) o lib-subs.js grava NO servidor, e o espelho ja o tem quando a resposta chega
  const subs = 'var libSubs = [\n{"kind":"sym","from":"A","to":"B","key":"A"}\n];\n';
  const sv = await pede(local, '/api/save', { method: 'POST', json: { path: 'Libs/lib-subs.js', content: subs } });
  assert.strictEqual(sv.status, 200, sv.texto);
  assert.strictEqual(ler(srv, 'Libs/lib-subs.js'), subs, 'gravou no servidor');
  assert.strictEqual(ler(ws, 'Libs/lib-subs.js'), subs, 'e o espelho ja estava em dia na resposta');

  // (c) projeto continua local
  const sp = await pede(local, '/api/save', { method: 'POST', json: { path: 'Projects/LOCAL/schematic.js', content: 'var schematic = {"items":[1]};' } });
  assert.strictEqual(sp.status, 200, sp.texto);
  assert.strictEqual(ler(ws, 'Projects/LOCAL/schematic.js'), 'var schematic = {"items":[1]};');
  assert.ok(!fs.existsSync(path.join(srv, 'Projects', 'LOCAL')), 'projeto nao vai ao servidor');

  // (d) a rota legada do sincronismo e recusada aqui
  const leg = await pede(local, '/api/almox/sync', { method: 'POST', json: {} });
  assert.strictEqual(leg.status, 409, leg.texto);

  // (e) servidor fora: leitura cai no local, gravacao e recusada alto e nada muda
  await servidor.stop();
  servidorNoAr = false;
  const off = await pede(local, '/api/save', { method: 'POST', json: { path: 'Libs/lib-subs.js', content: 'var libSubs = [];' } });
  assert.strictEqual(off.status, 503, off.texto);
  assert.strictEqual(off.corpo && off.corpo.offline, true);
  assert.strictEqual(ler(ws, 'Libs/lib-subs.js'), subs, 'nada foi gravado');
  const offSym = await pede(local, '/api/symbols/save', { method: 'POST', json: {} });
  assert.strictEqual(offSym.status, 503, 'toda gravacao de biblioteca e recusada: ' + offSym.texto);
  assert.strictEqual((await pede(local, '/api/symbols/footprints')).status, 200, 'leitura cai no handler local');
  await ate(async () => (await pede(local, '/api/lib-remota/status')).corpo.online === false, 10000, 'o status dizer offline');
});

test('desligar a biblioteca do servidor com o espelho de verdade: a importacao local segue o servidor', {
  skip: SKIP || (!COM_BACKEND && 'o pacote ainda nao tem o backend do modo remoto (merge do principal + npm run build:prep)'),
}, async (t) => {
  // O mesmo caso do teste com o servidor de arquivos, agora com o estado que o libremota.py
  // escreve de fato: e ele que prova que o formato lido em gravadosPeloEspelho e o dele.
  const srv = tmp('ahlrsrv3-');
  workspace.sync(srv, BUNDLE);
  const schlib = (n) => `var schlib = {"symbols":["servidor v${n}"]};\n`;
  const parts = (n) => JSON.stringify({ proximo: n });
  escreve(srv, 'Libs/schlib.js', schlib(1));
  escreve(srv, 'Libs/almox-parts.json', parts(1));
  const servidor = new Backend({ python: PYTHON, workspace: srv, logDir: tmp('ahlrsrv3log-') });
  await servidor.start({ port: 18540, lan: false });
  t.after(() => servidor.stop());
  const serverUrl = `http://127.0.0.1:${servidor.port}`;

  const ws = tmp('ahlrloc3-');
  workspace.sync(ws, BUNDLE);
  const hub = new Backend({ python: PYTHON, workspace: ws, logDir: tmp('ahlrloc3log-'), env: libRemota.envDoHub({ serverUrl }, false) });
  await hub.start({ port: 18550, lan: false });
  let hubNoAr = true;
  t.after(() => (hubNoAr ? hub.stop() : null));

  // a primeira rodada inteira do espelho, com o estado JA no disco (parar o hub antes disso
  // mediria um estado que o espelho ainda nao escreveu)
  const estado = path.join(ws, '.altiumhub', 'lib-remota.json');
  await ate(() => {
    try {
      const e = JSON.parse(fs.readFileSync(estado, 'utf8'));
      return e.ultimaSincronia && e.arquivos['schlib.js'].sha1 === sha1(schlib(1)) &&
        e.arquivos['almox-parts.json'].sha1 === sha1(parts(1));
    } catch {
      return false;
    }
  }, 20000, 'o espelho gravar o schlib.js e o almox-parts.json do servidor, e o estado deles');
  assert.strictEqual(ler(ws, 'Libs/schlib.js'), schlib(1));

  // a caixa desmarcada: o hub volta a subir local, sem espelho (aqui basta para-lo)
  await hub.stop();
  hubNoAr = false;
  escreve(srv, 'Libs/schlib.js', schlib(2));
  escreve(srv, 'Libs/almox-parts.json', parts(2));

  const g = libRemota.gruposDaImportacao(['libs', 'almox'], false);
  const r = await importer.importar({ ws, serverUrl, grupos: g.grupos, seedHashes: workspace.seedHashes(ws, BUNDLE) });
  assert.deepStrictEqual(r.erros, []);
  assert.deepStrictEqual(r.conflitos, [], 'o que o espelho gravou nao e edicao local: ' + JSON.stringify(r));
  assert.deepStrictEqual(r.backups, [], 'nem gera backup no almoxarifado: ' + JSON.stringify(r));
  assert.ok(r.atualizados.includes('Libs/schlib.js') && r.atualizados.includes('Libs/almox-parts.json'), JSON.stringify(r));
  assert.strictEqual(ler(ws, 'Libs/schlib.js'), schlib(2));
  assert.strictEqual(ler(ws, 'Libs/almox-parts.json'), parts(2));
});
