/* NexoEletric MCP - skills.js
   As skills da casa: regras de projeto que a IA segue sempre que mexe numa placa (mcp/skills/*.md,
   cabeçalho "---" com nome, titulo e descricao). Elas chegam ao cliente MCP por quatro caminhos,
   para nenhuma IA deixar de ver: as INSTRUCOES do initialize (o resumo), recursos
   eletrichub://skill/<nome>, prompts skill_<nome> e as ferramentas skills_listar / skill_ler.
   A pasta mora ao lado deste arquivo (vale no repositório, no app instalado e na pasta de
   trabalho). Arquivo novo na pasta entra sozinho: a leitura confere o mtime a cada chamada. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const PASTA = path.join(__dirname, '..', 'skills');
let cache = { chave: '', lista: [] };

function cabecalho(texto) {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(texto);
  if (!m) return { meta: {}, corpo: texto };
  const meta = {};
  for (const l of m[1].split(/\r?\n/)) {
    const i = l.indexOf(':');
    if (i > 0) meta[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  }
  return { meta, corpo: texto.slice(m[0].length) };
}

/* [{nome, titulo, descricao, arquivo, texto, corpo}] em ordem de nome */
function listar(pasta) {
  const dir = pasta || PASTA;
  let arqs = [];
  try { arqs = fs.readdirSync(dir).filter(f => /\.md$/i.test(f)).sort(); } catch (_) { return []; }
  const chave = dir + '|' + arqs.map(f => { try { return f + ':' + fs.statSync(path.join(dir, f)).mtimeMs; } catch (_) { return f; } }).join(',');
  if (!pasta && cache.chave === chave) return cache.lista;
  const lista = arqs.map(f => {
    const texto = fs.readFileSync(path.join(dir, f), 'utf8');
    const { meta, corpo } = cabecalho(texto);
    const nome = meta.nome || f.replace(/\.md$/i, '');
    return { nome, titulo: meta.titulo || nome, descricao: meta.descricao || '', arquivo: f, texto, corpo };
  });
  if (!pasta) cache = { chave, lista };
  return lista;
}
function ler(nome, pasta) {
  const n = String(nome || '').trim().toLowerCase();
  return listar(pasta).find(s => s.nome.toLowerCase() === n || s.arquivo.toLowerCase() === n || s.arquivo.toLowerCase() === n + '.md') || null;
}
/* o resumo que vai nas INSTRUCOES do initialize */
function resumo(pasta) {
  const L = listar(pasta);
  if (!L.length) return '';
  return 'REGRAS DA CASA (skills — siga sempre ao mexer numa placa; texto completo em skill_ler {nome}): ' +
    L.map(s => `${s.nome} = ${s.descricao.replace(/\s*Use ao[\s\S]*$/, '')}`).join(' | ') +
    ' Antes de entregar uma placa rode regras_casa_verificar {projeto} e zere o que ele apontar.';
}

module.exports = { listar, ler, resumo, cabecalho, PASTA };
