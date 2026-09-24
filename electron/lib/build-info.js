'use strict';
// Versao, commit e token de atualizacao carimbados no build (scripts/prepare.mjs grava
// gen/build-info.json). Fora do instalador, o commit vem do git e nao ha token.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

let cache = null;

function get() {
  if (cache) return cache;
  const arq = path.join(__dirname, '..', 'gen', 'build-info.json');
  let d = {};
  try {
    d = JSON.parse(fs.readFileSync(arq, 'utf8'));
  } catch {
    try {
      d.commit = execFileSync('git', ['-C', path.join(__dirname, '..'), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch { /* sem git */ }
  }
  cache = {
    version: app.getVersion(),
    commit: d.commit || '',
    builtAt: d.builtAt || '',
    updateToken: d.updateToken || '',
    python: d.python || '',
  };
  return cache;
}

module.exports = { get };
