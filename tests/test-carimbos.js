/* Carimbos e aprovação (hub-carimbos.js): a edição salva no Esquema derruba a aprovação (a data do desenho fica: ela só
   muda quando o projeto é criado ou assumido).

   node tests/test-carimbos.js

   O lado do servidor (assinatura, rotas) é o tests/test_carimbos.py. Aqui só o que a vista faz antes de gravar, contra o
   serializador DE VERDADE (hub-core.js) — o texto que ele escreve é o que o servidor lê. */
const assert = require('assert');
global.HubSchTemplate = require('../hub-schtemplate.js');
require('../hub-carimbos.js');
const HubCore = require('../hub-core.js');
const CB = globalThis.HubCarimbos;

let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };
const T = global.HubSchTemplate;
const d = new Date(), z = x => String(x).padStart(2, '0');
const HOJE = z(d.getDate()) + '/' + z(d.getMonth() + 1) + '/' + z(d.getFullYear() % 100);

function esquema(params, folha){
  return { format:'schmirror-v2', project:'CBM-DI251876', units:'mil', params,
           items:[Object.assign({ t:'sheet', name:'F1', size:'A4', template:'casa:A4_DiEletrons' }, folha || {})] };
}
const APROVADO = 'Desenhista_DiEletrons=Lucas;Data_desenho=01/11/26;Verificador_DiEletrons=Lucas;Aprovador_DiEletrons=Lucas;'
               + 'Data_verificacao=02/11/26;Data_aprovacao=02/11/26;Aprovacao_carimbo=lucas;Aprovacao_assinatura=abc';

/* 1. a edição de um projeto aprovado: os campos da aprovação saem; o desenhista e a data do desenho ficam */
{
  const sch = esquema(APROVADO, { params:'Aprovador_DiEletrons=Outro;Escala=1:2' });
  const disco = HubCore.serializeSchematic(sch).text;
  eq(CB._paramsDoTexto(disco).Aprovador_DiEletrons, 'Lucas', 'lê o cabeçalho do texto gravado');
  ok(CB.antesDeSalvar(sch, disco), 'mudou');
  const p = T.parseParams(sch.params);
  for (const k of CB.CAMPOS_APROVACAO) ok(!(k in p), 'saiu ' + k);
  eq(p.Data_desenho, '01/11/26', 'a data do desenho não muda na edição');
  eq(p.Desenhista_DiEletrons, 'Lucas', 'o resto fica');
  eq(sch.items[0].params, 'Escala=1:2', 'a folha perde só o que é da aprovação');
}

/* 2. projeto sem aprovação: a edição não mexe em nada */
{
  const disco = HubCore.serializeSchematic(esquema('Data_desenho=01/11/26')).text;
  const sch = esquema('Data_desenho=01/11/26;Desenhista_DiEletrons=Lucas');
  eq(CB.antesDeSalvar(sch, disco), false, 'nada a fazer');
  eq(sch.params, 'Data_desenho=01/11/26;Desenhista_DiEletrons=Lucas', 'fica como estava');
}

/* 3. projeto sem carimbo (sem params e sem template) não ganha campo nenhum */
{
  const sch = { format:'schmirror-v2', project:'X', units:'mil', items:[{ t:'sheet', name:'F1', size:'A4' }] };
  eq(CB.antesDeSalvar(sch, HubCore.serializeSchematic(sch).text), false, 'sem carimbo, nada');
  ok(!('params' in sch), 'sem params');
}

/* 4. projeto com template e sem params: não ganha campo nenhum */
{
  const sch = esquema(undefined);
  delete sch.params;
  eq(CB.antesDeSalvar(sch, HubCore.serializeSchematic(sch).text), false, 'nada a fazer');
  ok(!('params' in sch), 'sem params');
}
void HOJE;

console.log('test-carimbos: ' + n + ' verificações ok');
