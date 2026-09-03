/* Contrato das bibliotecas do almoxarifado (Libs/almox-*.js), geradas pelo
   tools/almox/almox2lib.py a partir do dump do Odoo.

   O modelo: o símbolo é a FAMÍLIA e tem UMA parte (a geometria); os valores são um
   CATÁLOGO de parâmetros ao lado. Foi assim que ficou depois de o multi-part não
   servir — no Altium a parte se identifica só por letra (A, B, C…) e o valor ficava
   invisível na hora de escolher.

   O que este teste protege: schlib-v2 legítimo (senão a aba Biblioteca não desenha),
   ids de valor estáveis, ordem crescente, e o diff da sincronização apontando só para
   coisas que existem. */
const assert = require('assert');
const { loadVar } = require('./load');
const Core = require('../hub-core.js');
const Draw = require('../hub-draw.js');

const idx = loadVar('Libs/almox-index.js', 'almoxIndex');
const mapaIds = JSON.parse(require('fs').readFileSync(
  require('path').join(__dirname, '..', 'Libs', 'almox-parts.json'), 'utf8'));
assert.ok(idx && Array.isArray(idx.libs) && idx.libs.length === 2, 'almox-index com 2 acervos');

const ISO = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
const CAMPOS = ['Comment', 'Value', 'MPN', 'Mouser', 'OdooId', 'Estoque', 'Local'];

for (const meta of idx.libs) {
  const lib = loadVar(meta.file, meta.var);
  assert.strictEqual(lib.format, 'schlib-v2', meta.id + ': formato');
  assert.strictEqual(lib.symbols.length, meta.symbols, meta.id + ': contagem no índice');

  let valores = 0, estoque = 0;
  for (const s of lib.symbols) {
    assert.ok(s.name && s.designator, s.name + ': nome e designador');
    assert.ok(ISO.test(s.desde || ''), s.name + ': sem data de entrada');

    /* uma parte só: é o que faz o Altium mostrar o componente sem A/B/C */
    assert.strictEqual(s.partcount, 1, s.name + ': partcount deveria ser 1');
    assert.strictEqual(s.parts.length, 1, s.name + ': mais de uma geometria');
    const geom = s.parts[0];
    assert.strictEqual(Core.partOf(s, 1), geom, s.name + ': partOf(1)');
    assert.ok(geom.pins.length, s.name + ': símbolo sem pinos');
    assert.ok(geom.graphics.length, s.name + ': símbolo sem geometria');
    const bb = Draw.symBBox(geom);
    assert.ok(isFinite(bb.x1) && bb.x2 > bb.x1, s.name + ': bbox');

    assert.ok(Array.isArray(s.valores) && s.valores.length, s.name + ': sem catálogo de valores');
    const ids = s.valores.map(v => v.id);
    assert.strictEqual(new Set(ids).size, ids.length, s.name + ': id de valor repetido');
    assert.ok(Math.min.apply(null, ids) >= 1, s.name + ': id menor que 1');

    for (const v of s.valores) {
      assert.ok(v.label, s.name + ' #' + v.id + ': sem rótulo');
      assert.ok(ISO.test(v.desde || ''), s.name + ' #' + v.id + ': desde inválido');
      assert.ok(v.desde >= s.desde, s.name + ' #' + v.id + ': entrou antes do símbolo');
      /* o valor é um conjunto de parâmetros, e o Comment é o que aparece na folha */
      const nomes = (v.params || []).map(p => p.n);
      for (const c of CAMPOS)
        assert.ok(nomes.indexOf(c) >= 0, s.name + ' #' + v.id + ': falta o parâmetro ' + c);
      assert.strictEqual((v.params.find(p => p.n === 'Comment') || {}).v, v.label,
        s.name + ' #' + v.id + ': Comment diferente do rótulo');
      /* footprint do próprio valor: nunca herdar um de outro tamanho em silêncio */
      assert.ok(typeof v.footprint === 'string', s.name + ' #' + v.id + ': sem footprint');
      if (v.fora) assert.strictEqual(v.estoque, 0, s.name + ' #' + v.id + ': fora com saldo');
      else assert.ok(v.itens.length, s.name + ' #' + v.id + ': sem item do Odoo');
      estoque += v.estoque;
      valores++;
    }
  }
  assert.strictEqual(valores, meta.parts, meta.id + ': total de valores no índice');
  assert.ok(Math.abs(estoque - meta.estoque) < 0.5, meta.id + ': estoque somado bate com o índice');

  /* o mapa de ids é o que faz a lib acumular em vez de ser recriada */
  for (const nome in mapaIds) {
    const s = lib.symbols.find(x => x.name === nome);
    if (!s) continue;
    for (const label in mapaIds[nome].ids) {
      const v = s.valores.find(x => x.label === label);
      if (v) assert.strictEqual(v.id, mapaIds[nome].ids[label],
        nome + ': "' + label + '" mudou de id (' + mapaIds[nome].ids[label] + ' → ' + v.id + ')');
    }
  }
}

/* "em ordem crescente do menor valor pro maior": `ord` é a chave em SI. Quem não teve
   valor legível vem com ord null — e vai para o fim, nunca no meio da escada. */
const bas = loadVar('Libs/almox-basicos.js', 'almoxBasicos');
let conferidos = 0;
for (const s of bas.symbols) {
  let ant = null, jaViuNulo = false;
  for (const v of s.valores) {
    assert.ok('ord' in v, s.name + ' #' + v.id + ': sem chave de ordem');
    if (v.ord === null) { jaViuNulo = true; continue; }
    assert.ok(!jaViuNulo, s.name + ': "' + v.label + '" tem valor mas veio depois de um sem valor');
    if (ant !== null) {
      assert.ok(v.ord >= ant - 1e-12,
        s.name + ': "' + v.label + '" (' + v.ord + ') vem depois de um valor maior (' + ant + ')');
      conferidos++;
    }
    ant = v.ord;
  }
}
assert.ok(conferidos > 500, 'poucas comparações de ordem: ' + conferidos);

/* almox-sync.js: o diff da última sincronização, que alimenta o painel do diálogo */
const sync = loadVar('Libs/almox-sync.js', 'almoxSync');
assert.ok(sync && sync.resumo, 'almox-sync.js com resumo');
const todos = new Map();
for (const meta of idx.libs)
  for (const s of loadVar(meta.file, meta.var).symbols) todos.set(s.name, s);

for (const s of sync.simbolosNovos)
  assert.ok(todos.has(s.nome), 'símbolo novo "' + s.nome + '" não está no acervo');
for (const nome of sync.simbolosSumiram)
  assert.ok(!todos.has(nome), 'símbolo "' + nome + '" consta como sumido mas está no acervo');
for (const campo of ['valoresNovos', 'estoqueMudou']) {
  for (const v of sync[campo]) {
    const s = todos.get(v.sym);
    assert.ok(s, campo + ': símbolo "' + v.sym + '" não está no acervo');
    assert.ok(s.valores.some(p => p.label === v.label),
      campo + ': "' + v.label + '" não existe em ' + v.sym);
  }
}
/* "saiu do Odoo" não quer dizer "sumiu da lib": o valor fica, marcado e zerado, para
   não devolver o id. Só some de vez num `--podar`. */
for (const v of sync.valoresSumiram) {
  const s = todos.get(v.sym);
  if (!s) continue;
  const p = s.valores.find(x => x.label === v.label);
  if (!p) continue;
  assert.ok(p.fora, 'valoresSumiram: "' + v.label + '" em ' + v.sym + ' não está marcado fora');
  assert.strictEqual(p.estoque, 0, 'valoresSumiram: "' + v.label + '" com saldo');
}
for (const nome in sync.novosPorSimbolo) {
  const s = todos.get(nome);
  assert.ok(s, 'novosPorSimbolo: "' + nome + '" não está no acervo');
  for (const label of sync.novosPorSimbolo[nome])
    assert.ok(s.valores.some(v => v.label === label),
      'novosPorSimbolo: "' + label + '" não existe em ' + nome);
}
/* ═══════════════ o footprint combina com o nome ═══════════════
   O componente se chama pelo PRIMEIRO encapsulamento do item ("SMD 0603 1K 1/4W"), e o
   footprint tem de ser desse mesmo encapsulamento. Um valor que exista em 0603 e em 1206
   pulava o 0603 — que a casa nao tinha entre os modelos daquele simbolo — e casava o 1206:
   saia um componente chamado 0603 com o pad de um 1206, e nada na tela dizia isso.
   O footprint tambem tem de existir na PcbLib espelhada, ou entao ser o nome cru do Odoo
   (pendente, e visivel como tal no hub) — nunca um terceiro nome inventado. */
const pcb = loadVar('Libs/pcblib.js', 'pcblib');
const normFp = n => String(n || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const naPcbLib = new Set(pcb.footprints.map(f => normFp(f.name)));
let comFp = 0, pendentes = 0;
for (const meta of idx.libs) {
  const lib = loadVar(meta.file, meta.var);
  for (const sym of lib.symbols) {
    for (const v of sym.valores || []) {
      if (!v.footprint) continue;
      comFp++;
      const pk = (v.pkgs || [])[0];
      if (pk) {
        assert.ok(normFp(v.footprint).includes(normFp(pk)),
          sym.name + ' · "' + v.altium + '": o nome diz ' + pk + ' e o footprint e ' + v.footprint);
      }
      if (!naPcbLib.has(normFp(v.footprint))) {
        /* Fora da PcbLib espelhada so valem duas origens: o encapsulamento cru do Odoo
           (esperando footprint) ou um modelo do proprio simbolo — que pode ser um nome da
           casa que o espelho da PcbLib nao alcanca. Um terceiro nome ali seria invencao. */
        const doOdoo = (v.pkgs || []).some(p => normFp(p) === normFp(v.footprint));
        const doSimbolo = (sym.footprints || []).some(m => normFp(m.name) === normFp(v.footprint));
        assert.ok(doOdoo || doSimbolo,
          sym.name + ' · "' + v.altium + '": footprint "' + v.footprint
          + '" nao esta na PcbLib, nem e encapsulamento do item, nem modelo do simbolo');
        pendentes++;
      }
    }
  }
}
assert.ok(comFp > 1000, 'poucos valores com footprint: ' + comFp);

/* Um valor, uma peca. O Odoo declara o part number entre colchetes; o rotulo o descarta
   porque ele tem campo proprio, e sem cuidado BAV70, BAW56 e 1N4148WS caem todos num valor
   chamado "de Sinal" — com um footprint so, um mpn so e o estoque dos tres somado. BAV70 e
   BAW56 sao duplos SOT-23 de pinagem OPOSTA: e erro de bancada, nao de catalogo. */
const COLCHETE = /\[([^\]]+)\]/;
let comColchete = 0;
for (const meta of idx.libs) {
  const lib = loadVar(meta.file, meta.var);
  for (const sym of lib.symbols) {
    for (const v of sym.valores || []) {
      const pns = new Set();
      for (const it of v.itens || []) {
        const m = COLCHETE.exec(it.nome || '');
        if (m) pns.add(m[1].trim().toUpperCase());
      }
      if (pns.size) comColchete++;
      assert.strictEqual(pns.size <= 1, true,
        sym.name + ' · "' + v.label + '" junta ' + pns.size + ' part numbers: ' + [...pns].join(', '));
    }
  }
}
assert.ok(comColchete > 100, 'poucos valores com part number declarado: ' + comColchete);

/* Num diodo o part number E o nome: ninguem procura "diodo de sinal", procura BAV70. Se o
   que sobra do nome do Odoo nao tem especificacao nenhuma, ele e ruido na frente do part
   number e sai. Onde HA especificacao ("6.2V 500mW 1N753") ela fica — e por ela que se acha
   um zener, e e ela que da a ordem crescente da lista. */
let diodosPn = 0;
for (const meta of idx.libs) {
  const lib = loadVar(meta.file, meta.var);
  for (const sym of lib.symbols) {
    if (!/^DIODO/.test(sym.name)) continue;
    for (const v of sym.valores || []) {
      const it = (v.itens || []).map(i => COLCHETE.exec(i.nome || '')).find(Boolean);
      if (!it) continue;
      const pn = it[1].trim();
      const L = v.label || '';
      const k = L.toUpperCase().indexOf(pn.toUpperCase());
      if (k < 0) continue;                     /* part number encurtado no rotulo: outro caso */
      diodosPn++;
      const resto = (L.slice(0, k) + L.slice(k + pn.length)).replace(/\s+/g, ' ').trim();
      assert.ok(!resto || /[0-9]/.test(resto),
        sym.name + ': "' + L + '" leva "' + resto + '" na frente do part number, sem especificacao');
    }
  }
}
assert.ok(diodosPn > 20, 'poucos diodos com part number: ' + diodosPn);

assert.ok(idx.ultimaSync, 'almox-index sem ultimaSync');
for (const k of Object.keys(sync.resumo))
  assert.strictEqual(idx.ultimaSync[k], sync.resumo[k], 'ultimaSync divergiu do diff em ' + k);

console.log('test-almoxlib OK (' + idx.libs.map(l => l.symbols + ' símbolos/' + l.parts + ' valores').join(', ')
  + ', 1 parte por símbolo, ' + conferidos + ' pares em ordem, '
  + comFp + ' footprints coerentes (' + pendentes + ' pendentes), '
  + comColchete + ' com part number proprio (' + diodosPn + ' diodos), diff com '
  + (sync.resumo.simbolosNovos + sync.resumo.valoresNovos) + ' novidade(s))');
