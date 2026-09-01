const assert = require('assert');
const Core = require('../hub-core.js');
const { loadVar } = require('./load');

/* ═══════════════ NormKey ═══════════════
   Porte da NormKey do RenameLibs.pas:37-56. Se as duas divergirem, o hub e o Altium passam
   a discordar sobre o que e "o mesmo nome" - e a discordancia so aparece na bancada. */

const nk = Core.normKey;
assert.strictEqual(nk('CAP [  SMD  ]'), 'CAPSMD');
assert.strictEqual(nk('CAP [SMD]'), 'CAPSMD', 'espaco e pontuacao somem');
assert.strictEqual(nk('RES [ SMD ]'), 'RESSMD');
assert.strictEqual(nk('Relé Finder 30.22_Part_1'), 'RELEFINDER3022PART1');
assert.strictEqual(nk('chave_1_polo_4_posições'), 'CHAVE1POLO4POSICOES', 'acento dobra p/ letra base');
assert.strictEqual(nk('Cap Cerâmico'), 'CAPCERAMICO');
assert.strictEqual(nk('CONECTOR PADRÃO'), 'CONECTORPADRAO');
assert.strictEqual(nk(''), '');
assert.strictEqual(nk(null), '', 'nome ausente nao pode explodir o indice');

/* a NormKey do Pascal NAO trata 223 (sz) nem 255 (y com trema): as duas caem fora de
   A-Z0-9 e sao descartadas. Um normalizador NFD+strip devolveria 'SS'/'Y' e divergiria. */
assert.strictEqual(nk('aßb'), 'AB');
assert.strictEqual(nk('aÿb'), 'AB');
/* o travessao (U+2013) nao existe em Latin-1 - e descartado, e e o que faz "TO-220AB" e
   "TO<travessao>220AB" colidirem na chave */
assert.strictEqual(nk('TO–220AB'), nk('TO-220AB'));

/* ═══════════════ a cascata ═══════════════ */

const lib = { symbols: [{ name:'CAP [SMD]' }, { name:'DIODO TVS BIDIR [PTH]' },
                        { name:'SOIC 8' }, { name:'SOIC - 8' }] };

Core.setLibTables(null, null);                       /* sem tabelas: so exato e chave */
assert.strictEqual(Core.resolveSym(lib, 'CAP [SMD]').how, 'exato');
assert.strictEqual(Core.resolveSym(lib, 'CAP [  SMD  ]').how, 'chave');
assert.strictEqual(Core.resolveSym(lib, 'CAP [  SMD  ]').name, 'CAP [SMD]');
assert.strictEqual(Core.resolveSym(lib, 'NAO EXISTE'), null);
assert.strictEqual(Core.resolveSym(lib, ''), null);

/* EMPATE DE CHAVE NAO E RESOLUCAO. "SOIC 8" e "SOIC - 8" sao dois footprints diferentes na
   lib real; escolher um no chute poe o componente errado na placa. */
const amb = Core.resolveSym(lib, 'SOIC8');
assert.strictEqual(amb.how, 'ambiguo');
assert.strictEqual(amb.item, null, 'ambiguo tem que sair SEM item, senao vira palpite');
assert.deepStrictEqual(amb.cands.sort(), ['SOIC - 8', 'SOIC 8']);
assert.strictEqual(Core.symbolOf(lib, 'SOIC8'), null, 'a fachada tambem recusa o empate');

/* rename nos DOIS sentidos: o projeto antigo referencia o nome antigo, o projeto escrito
   depois do rename referencia o novo, e os dois estao em uso ao mesmo tempo */
Core.setLibTables({ symRename: {
  'DIODO [ SUPRESSOR DE TRANSIENTE BIDIRECIONAL ] PTH': 'DIODO TVS BIDIR [PTH]',
  'CAP [  SMD  ]': 'CAP [SMD]',
} }, null);
const fwd = Core.resolveSym(lib, 'DIODO [ SUPRESSOR DE TRANSIENTE BIDIRECIONAL ] PTH');
assert.strictEqual(fwd.how, 'rename');
assert.strictEqual(fwd.name, 'DIODO TVS BIDIR [PTH]');
/* o sentido inverso e o que vale enquanto a lib mestra NAO foi renomeada */
const libAntiga = { symbols: [{ name:'DIODO [ SUPRESSOR DE TRANSIENTE BIDIRECIONAL ] PTH' }] };
const bwd = Core.resolveSym(libAntiga, 'DIODO TVS BIDIR [PTH]');
assert.strictEqual(bwd.how, 'rename');
assert.strictEqual(bwd.name, 'DIODO [ SUPRESSOR DE TRANSIENTE BIDIRECIONAL ] PTH');

/* UM SALTO SO: no rename-map real "INDUTOR MODO COMUM" e nome novo de uma entrada e nome
   antigo de outra. Encadear seguiria para o item errado. */
Core.setLibTables({ symRename: { 'A':'INDUTOR MODO COMUM', 'INDUTOR MODO COMUM':'B' } }, null);
assert.strictEqual(Core.resolveSym({ symbols:[{ name:'B' }] }, 'A'), null,
                   'A -> INDUTOR MODO COMUM -> B seria dois saltos');
assert.strictEqual(Core.resolveSym({ symbols:[{ name:'INDUTOR MODO COMUM' }] }, 'A').how, 'rename');

/* merge (dois antigos para o mesmo novo) com os dois vivos na lib = ambiguo, nao chute */
Core.setLibTables({ symRename: { 'X1':'NOVO', 'X2':'NOVO' } }, null);
const merge = Core.resolveSym({ symbols:[{ name:'X1' }, { name:'X2' }] }, 'NOVO');
assert.strictEqual(merge.how, 'ambiguo');
assert.deepStrictEqual(merge.cands.sort(), ['X1', 'X2']);
/* com um so vivo, nao ha o que desempatar */
assert.strictEqual(Core.resolveSym({ symbols:[{ name:'X2' }] }, 'NOVO').name, 'X2');

/* a escolha de uma pessoa ganha de tudo, inclusive do nome exato */
Core.setLibTables({ symRename: { 'CAP [  SMD  ]':'CAP [SMD]' } },
                  [{ kind:'sym', from:'CAP [SMD]', to:'SOIC 8' }]);
assert.strictEqual(Core.resolveSym(lib, 'CAP [SMD]').how, 'escolha');
assert.strictEqual(Core.resolveSym(lib, 'CAP [SMD]').name, 'SOIC 8');
/* substituicao apontando para nome que nao existe e ignorada, nao quebra a cascata */
Core.setLibTables(null, [{ kind:'sym', from:'CAP [SMD]', to:'FANTASMA' }]);
assert.strictEqual(Core.resolveSym(lib, 'CAP [SMD]').how, 'exato');
/* substituicao de simbolo nao pode valer para footprint */
Core.setLibTables(null, [{ kind:'fp', from:'CAP [SMD]', to:'SOIC 8' }]);
assert.strictEqual(Core.resolveSym(lib, 'CAP [SMD]').how, 'exato');

/* ═══════════════ Libs/lib-subs.js ═══════════════
   O formato existe para ser lido pelos .pas: um objeto JSON PLANO por linha, chaves fixas
   e nao-ASCII em \uXXXX (o TStringList do Delphi le ANSI e corromperia acento cru). */

const ser = Core.serializeLibSubs([{ kind:'sym', from:'Cap Cerâmico', to:'CAP [SMD]' },
                                   { kind:'fp',  from:'Cap Ceram',    to:'CAP 0805', when:'01/09/2026' }]);
assert.strictEqual(ser.errors.length, 0);
assert.ok(/^var libSubs = \[$/m.test(ser.text));
assert.ok(!/[^\x00-\x7f]/.test(ser.text), 'nao pode sair byte fora de ASCII');
assert.ok(ser.text.includes('"key":"CAPCERAMICO"'), 'a chave viaja pronta para o lado Pascal');
assert.ok(ser.text.includes('\\u00e2'), 'acento vira \\uXXXX');
ser.text.split('\n').filter(l => l.startsWith('{')).forEach(l => {
  JSON.parse(l.replace(/,$/, ''));                   /* uma linha = um objeto valido */
});
/* duas escolhas para o mesmo nome: a ultima venceria em silencio e ninguem saberia qual valeu */
assert.ok(/duas substituicoes/.test(
  Core.serializeLibSubs([{ kind:'sym', from:'A', to:'B' }, { kind:'sym', from:'A', to:'C' }]).errors[0].msg));
assert.ok(/para ela mesma/.test(
  Core.serializeLibSubs([{ kind:'sym', from:'A', to:'A' }]).errors[0].msg));
/* mesmo nome em kinds diferentes NAO e duplicata */
assert.strictEqual(
  Core.serializeLibSubs([{ kind:'sym', from:'A', to:'B' }, { kind:'fp', from:'A', to:'C' }]).errors.length, 0);

/* ═══════════════ biblioteca real ═══════════════
   O ponto do exercicio todo: os nomes que os projetos referenciam voltarem a resolver. */

const fs = require('fs'), path = require('path');
if (fs.existsSync(path.join(__dirname, '..', 'Libs', 'schlib.js'))) {
  const SL = loadVar('Libs/schlib.js', 'schlib');
  const PL = loadVar('Libs/pcblib.js', 'pcblib');
  const RM = loadVar('Libs/rename-map.js', 'renameMap');
  Core.setLibTables(RM, []);

  /* os quatro da tela: espaco a mais, acento e rename */
  assert.ok(Core.resolveSym(SL, 'CAP [  SMD  ]').item, 'CAP [  SMD  ] tem que resolver');
  assert.ok(Core.resolveSym(SL, 'RES [ SMD ]').item);
  assert.ok(Core.resolveSym(SL, 'CONECTOR PADRÃO').item);
  assert.strictEqual(Core.resolveSym(SL, 'NE555'), null,
                     'NE555 esta na .SchLib do Altium mas nao no espelho - so ExportLibs resolve');

  /* os itens FUNDIDOS (mergeSym/mergeFp) sairam do espelho mas continuam com o nome
     antigo nos projetos ja exportados - se nao entrarem na tabela, ficam ausentes com o
     substituto vivo do lado */
  assert.strictEqual(Core.resolveFp(PL, 'TO-263-5').name, 'DDPAK-5');
  assert.strictEqual(Core.resolveFp(PL, 'NMAXXXXSC').name, 'NMA0515SC');
  assert.strictEqual(Core.resolveSym(SL, 'MC33072P_1').name, 'MC33072P');
  for (const campo of ['mergeSym', 'mergeFp'])
    for (const [antigo, novo] of Object.entries(RM[campo] || {})) {
      const r = campo === 'mergeSym' ? Core.resolveSym(SL, antigo) : Core.resolveFp(PL, antigo);
      assert.ok(r && r.item, 'nome fundido nao resolve: ' + antigo);
      assert.strictEqual(r.name, novo, antigo + ' deveria cair em ' + novo);
    }

  /* o rename-map inteiro tem que apontar para algo que existe, nos dois sentidos */
  for (const [antigo, novo] of Object.entries(RM.symRename)) {
    const r = Core.resolveSym(SL, antigo);
    assert.ok(r && r.item, 'nome antigo nao resolve: ' + antigo);
    assert.strictEqual(r.name, novo, antigo + ' deveria cair em ' + novo);
  }
  for (const [antigo, novo] of Object.entries(RM.fpRename)) {
    const r = Core.resolveFp(PL, antigo);
    assert.ok(r && r.item, 'footprint antigo nao resolve: ' + antigo);
  }

  /* nenhuma resolucao pode mudar de item so por rodar de novo (o indice e cacheado) */
  const a = Core.resolveSym(SL, 'CAP [  SMD  ]'), b = Core.resolveSym(SL, 'CAP [  SMD  ]');
  assert.strictEqual(a.item, b.item, 'o cache do indice tem que devolver o mesmo objeto');

  /* nome com barra invertida no fim existe na PcbLib e nao pode quebrar o indice */
  const barra = PL.footprints.filter(f => f.name.endsWith('\\'));
  for (const f of barra) assert.strictEqual(Core.resolveFp(PL, f.name).item, f, f.name);

  Core.setLibTables(null, null);
}

console.log('test-libresolve OK');
