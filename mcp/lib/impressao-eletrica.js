/* A IMPRESSÃO ELÉTRICA DO ESQUEMA (2026-11-05, pedido do dono: "hoje no esquema, se eu movimento algo nele, mudo o
   layout, ele já gera uma revisão nova, eu não quero isso, só muda revisão no esquema se troca realmente componente ou
   altera algo relevante na ligação; já na PCB gera revisão de qualquer forma").

   A aprovação (tools/rotas/carimbos.py » assinatura) assina, do schematic.js, só o que é elétrico:
     - os componentes: designador, parte, símbolo, footprint, comentário e os parâmetros que dizem QUAL é a peça
       (Value, MPN, OdooId, ValorId...). Fora: posição, rotação, espelho, folha, onde fica o texto do designador, e o
       que o almoxarifado atualiza sozinho (Estoque, Custo, Local, LocalId, Descricao);
     - a netlist: os pinos de cada net (HubCore.extractNets, o mesmo da tela e do MCP), com o nome só das nets que têm
       nome dado (rótulo, power port, porta). O nome automático (Net<ref>_<pino>) sai dos próprios pinos.
   Mover, arrastar fio sem mudar ligação, mexer em texto, rótulo no mesmo lugar elétrico, folha, template: não muda.

   impressao(sch, libs) -> {comps:[...], nets:[...]}      (o objeto canônico)
   hash(sch, libs)      -> 24 hex                        (sha256 do JSON canônico)
   node mcp/lib/impressao-eletrica.js --cli  < {root, arquivos:[caminho do schematic.js, ...]}
     -> uma linha JSON {ok:true, hashes:{caminho: hash|null}, erros:{caminho: msg}} */
'use strict';
const crypto = require('crypto');
const path = require('path');

const PARAMS_FORA = new Set(['Estoque', 'Custo', 'Local', 'LocalId', 'Descricao']);
const natural = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });

function paramsEletricos(s) {
  const out = [];
  for (const kv of String(s || '').split(';')) {
    const i = kv.indexOf('=');
    if (i <= 0) continue;
    const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim();
    if (!k || PARAMS_FORA.has(k) || v === '') continue;
    out.push(k + '=' + v);
  }
  return out.sort();
}

function impressao(sch, libs, hc) {
  const comps = [];
  for (const it of (sch && sch.items) || []) {
    if (!it || it.t !== 'comp') continue;
    comps.push([String(it.ref || ''), it.part == null ? 1 : Number(it.part), String(it.sym || ''), String(it.footprint || ''),
                String(it.comment || ''), paramsEletricos(it.params)]);
  }
  comps.sort((a, b) => natural(a[0], b[0]) || a[1] - b[1] || natural(a[2], b[2]));
  const r = hc.extractNets(sch, libs.schlib);
  const nets = r.nets.map(n => [n.auto ? '' : String(n.name || ''), n.pins.slice().sort(natural).join(',')])
    .sort((a, b) => natural(a[1], b[1]) || natural(a[0], b[0]));
  return { comps, nets };
}

function hash(sch, libs, hc) {
  return crypto.createHash('sha256').update(JSON.stringify(impressao(sch, libs, hc))).digest('hex').slice(0, 24);
}

module.exports = { impressao, hash, paramsEletricos, PARAMS_FORA };

if (require.main === module && process.argv.includes('--cli')) {
  let ent = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { ent += d; });
  process.stdin.on('end', () => {
    let r;
    try {
      const a = JSON.parse(ent || '{}');
      const { Contexto } = require('./contexto.js');
      const { lerVar } = require('./arquivo-linhas.js');
      const ctx = new Contexto({ root: a.root || path.resolve(__dirname, '..', '..') });
      const hc = ctx.hc;
      const hashes = {}, erros = {};
      for (const arq of a.arquivos || []) {
        try {
          const sch = lerVar(arq, 'schematic');
          hashes[arq] = hash(sch, ctx.libsDe(sch), hc);
        } catch (e) { hashes[arq] = null; erros[arq] = String(e && e.message || e); }
      }
      r = { ok: true, hashes, erros };
    } catch (e) { r = { ok: false, erro: String(e && e.message || e) }; }
    process.stdout.write(JSON.stringify(r) + '\n');
  });
}
