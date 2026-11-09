/* AltiumPCBMirror v2 - hub-io.js — persistencia do browser.
   Em HTTP (hubserver): POST /api/save grava direto no workspace.
   Em file:// (duplo clique): download do arquivo para substituir manualmente. */
(function (root) {
"use strict";
const canPost = location.protocol === 'http:' || location.protocol === 'https:';

function download(filename, content){
  const blob = new Blob([content], { type: 'text/javascript' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* 1.84.0: o projeto tem dono (hub-equipe.js): na vista de um projeto em que a pessoa nao mexe, o Salvar nem sai daqui;
   e a recusa do servidor (403 sem_permissao) volta como um erro com semPermissao, para a vista avisar sem oferecer
   "baixar o arquivo" */
function semPermissao(msg){ const e = new Error(msg); e.semPermissao = true; return e; }
async function saveFile(relPath, content){
  if (!canPost) { download(relPath.split('/').pop(), content); return { mode: 'download' }; }
  const nao = root.HubEquipe && root.HubEquipe.bloqueia ? root.HubEquipe.bloqueia(relPath) : null;
  if (nao) throw semPermissao(nao);
  const r = await fetch('/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: relPath, content })
  });
  if (!r.ok) {
    let msg = 'HTTP ' + r.status, j = null;
    try { j = await r.json(); if (j && j.error) msg += ' — ' + j.error; } catch (e) {}
    if (j && j.codigo === 'sem_permissao') {
      if (root.HubEquipe && root.HubEquipe.recusado) root.HubEquipe.recusado(j);
      throw semPermissao(j.error);
    }
    throw new Error(msg);
  }
  return { mode: 'server' };
}

async function fetchText(relPath){
  if (!canPost) throw new Error('sem servidor');
  const r = await fetch('/' + relPath, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}

root.HubIO = { canPost, saveFile, download, fetchText };
})(typeof self !== 'undefined' ? self : this);
