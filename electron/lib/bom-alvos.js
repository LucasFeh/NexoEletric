'use strict';
// As BOMs de um projeto e o link de cada uma (1.89.4). Pedido do dono: "no BOM, o nome que vem no link ainda nao ta
// pegando o nome atual da placa" e "precisa ser um link diferente pra cada variante de projeto".
//   padrao   /bom/<slug do CodigoDaPlaca>                      (ex. /bom/pmd-di261946)
//   variante /bom/<slug do CodigoDaPlaca>-<slug do NOME dela>  (ex. /bom/pmd-di261946-sem-display: o slug do codigo da
//            PCB montada da variante no Odoo, "<codigo da placa> <NOME DA VARIANTE>")
// Sem placa definida, o slug da pasta (o de antes). O slug da pasta, quando a placa existe, e um APELIDO da padrao: o
// armazem o deixa como outra chave do mesmo item no NexoBD, e os links ja distribuidos continuam abrindo.
// E a MESMA regra do hubserver.py » bom_alvos (o link que o painel mostra): mude os dois juntos; os testes dos dois
// conferem tests/bom-alvos-casos.json.
const fs = require('node:fs');
const path = require('node:path');

const ID_MAX = 160;                               // o ID_OK do NexoBD (server/bom.mjs): [a-z0-9][a-z0-9-]{0,159}
const NAO_DEFINIDO = 'PROJETO NÃO DEFINIDO';
const ID_VARIANTE = /^v[0-9a-f]{6,16}$/;           // variantes.py » _ID

/** o slug da pasta, o de sempre (hubserver.py » _proj_id): o dos links antigos */
const slugPasta = (nome) => String(nome || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'proj';
/** o slug do link pela placa: sem acento ("Versão 2" -> "versao-2") */
const slugBom = (s) => String(s == null ? '' : s).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const corta = (s) => s.slice(0, ID_MAX).replace(/^-+|-+$/g, '') || 'proj';
const limpa = (s) => String(s == null ? '' : s).split(/\s+/).filter(Boolean).join(' ');

/**
 * [{variante: null|{id, nome, codigo}, id, nome, apelidos}] -- a padrao primeiro.
 * pasta = o nome da pasta; params = o cabecalho do schematic.js ({K: V}); variantes = a lista do variantes.json.
 * nome = o titulo da pagina: "<codigo> · <nome da placa>" na padrao, "<codigo> <NOME DA VARIANTE>" na variante.
 */
function alvos(pasta, params, variantes) {
  const p = params || {};
  let placa = limpa(p.CodigoDaPlaca);
  if (placa.toUpperCase() === NAO_DEFINIDO) placa = '';
  const nomePlaca = limpa(p.NomeDaPlaca);
  const antigo = slugPasta(pasta);
  const base = slugBom(placa) ? corta(slugBom(placa)) : antigo;
  const rotulo = placa ? (nomePlaca ? `${placa} · ${nomePlaca}` : placa) : (nomePlaca || String(pasta || ''));
  const out = [{ variante: null, id: base, nome: rotulo, apelidos: antigo !== base ? [antigo] : [] }];
  const usados = new Set([base]);
  for (const v of variantes || []) {
    if (!v || typeof v !== 'object' || !v.id) continue;
    const vn = limpa(v.nome || v.codigo || v.id).toUpperCase();
    let id = corta(`${base}-${slugBom(vn) || slugBom(v.id)}`);
    if (usados.has(id)) id = corta(`${id.slice(0, ID_MAX - 18)}-${slugBom(v.id)}`);
    usados.add(id);
    out.push({ variante: { id: String(v.id), nome: String(v.nome || ''), codigo: String(v.codigo || '') }, id, nome: `${placa || rotulo} ${vn}`.trim(), apelidos: [] });
  }
  out[0].apelidos = out[0].apelidos.filter((x) => !usados.has(x));
  return out;
}

/** o cabecalho (K=V;K=V) de um esquema ja lido */
function paramsDe(sch) {
  const out = {};
  const s = sch && typeof sch.params === 'string' ? sch.params : '';
  for (const par of s.split(';')) {
    const i = par.indexOf('=');
    if (i >= 0) out[par.slice(0, i).trim()] = limpa(par.slice(i + 1));
  }
  return out;
}

/** o schematic.js ("var schematic = {...};"), como o load_var_file do hubserver; ilegivel = null */
function leVar(arq) {
  let s;
  try { s = fs.readFileSync(arq, 'utf8'); } catch { return null; }
  s = s.replace(/^\s*\/\/[^\n]*\n/gm, '');
  s = s.slice(s.indexOf('=') + 1).trim().replace(/;$/, '').trim().replace(/,\s*([\]}])/g, '$1');
  try { return JSON.parse(s); } catch { return null; }
}

/** a lista do variantes.json, com o mesmo filtro do variantes.py » le (id valido e codigo) */
function variantesDe(pasta) {
  let d;
  try { d = JSON.parse(fs.readFileSync(path.join(pasta, 'variantes.json'), 'utf8').replace(/^﻿/, '')); } catch { return []; }
  const lst = d && Array.isArray(d.variantes) ? d.variantes : [];
  return lst.filter((v) => v && typeof v === 'object' && ID_VARIANTE.test(String(v.id || '')) && String(v.codigo || '').replace(/\s+/g, ''))
    .map((v) => ({ id: String(v.id), nome: limpa(v.nome), codigo: String(v.codigo || '').replace(/\s+/g, '').toUpperCase() }));
}

/** as BOMs da pasta de um projeto (Projects/<nome>) */
function alvosDaPasta(pasta, nome) {
  const sch = leVar(path.join(pasta, 'schematic.js'));
  return alvos(nome || path.basename(pasta), paramsDe(sch), variantesDe(pasta));
}

module.exports = { alvos, alvosDaPasta, paramsDe, variantesDe, slugBom, slugPasta, ID_MAX };
