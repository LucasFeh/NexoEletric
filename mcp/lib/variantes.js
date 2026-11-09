/* NexoEletric MCP - variantes.js — a variante de projeto (1.88.0), do lado da IA: o mesmo arquivo e a mesma regra do
   tools/rotas/variantes.py (Projects/<p>/variantes.json; a ativa desta máquina em .variante-ativa.json) e do
   hub-variantes.js (refs, aplica, codigos). Com uma variante ativa, a IA não muda schematic.js, changes.js,
   annotations.js nem rules.js (contexto.js » grava): a PCB é a mesma, só se suprime ou monta componente. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const V = require('../../hub-variantes.js');

const ARQ = 'variantes.json', ATIVA = '.variante-ativa.json';
const TRAVADOS = new Set(['schematic.js', 'changes.js', 'annotations.js', 'rules.js']);
const agora = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19); };
const leJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch (_) { return null; } };

function le(pdir) {
  const d = leJson(path.join(pdir, ARQ));
  const lista = (d && Array.isArray(d.variantes) ? d.variantes : []).filter(v => v && /^v[0-9a-f]{6,16}$/.test(String(v.id || '')) && V.normCod(v.codigo))
    .map(v => Object.assign({}, v, { codigo: V.normCod(v.codigo), suprimidos: (v.suprimidos || []).map(s => (s && typeof s === 'object') ? s : { ref: String(s) }) }));
  return { formato: V.FORMATO, variantes: lista };
}
function grava(pdir, d) {
  const f = path.join(pdir, ARQ);
  fs.writeFileSync(f + '.tmp', JSON.stringify({ formato: V.FORMATO, variantes: d.variantes }, null, 1) + '\n', 'utf8');
  fs.renameSync(f + '.tmp', f);
}
function idAtiva(pdir) { const j = leJson(path.join(pdir, ATIVA)); return (j && j.id) || null; }
function ativa(pdir, d) { const id = idAtiva(pdir); return id ? ((d || le(pdir)).variantes.find(v => v.id === id) || null) : null; }
function defineAtiva(pdir, id) {
  const f = path.join(pdir, ATIVA);
  if (!id) { try { fs.unlinkSync(f); } catch (_) { /* já era a padrão */ } return; }
  fs.writeFileSync(f, JSON.stringify({ id, em: agora() }), 'utf8');
}
/* null = pode gravar; senão a mensagem (a variante ativa trava o desenho) */
function recusaGravar(pdir, arquivo, texto) {
  if (!TRAVADOS.has(arquivo)) return null;
  const v = ativa(pdir);
  if (!v) return null;
  let atual = null;
  try { atual = fs.readFileSync(path.join(pdir, arquivo), 'utf8').replace(/\r\n/g, '\n'); } catch (_) { atual = null; }
  if (atual !== null && atual === String(texto).replace(/\r\n/g, '\n')) return null;
  return `A variante "${v.nome}" (${v.codigo}) está ativa: a PCB é a mesma, nela só se suprime ou monta componente (variante_suprimir). Para editar o esquema ou a PCB, volte para a padrão (variante_ativar sem id).`;
}
function novoId() { return 'v' + crypto.randomBytes(4).toString('hex'); }

module.exports = Object.assign({ le, grava, ativa, idAtiva, defineAtiva, recusaGravar, novoId, agora, ARQ, ATIVA, TRAVADOS }, {
  refs: V.refs, aplica: V.aplica, codigos: V.codigos, sufixo: V.sufixo, filtraPlaca: V.filtraPlaca });
