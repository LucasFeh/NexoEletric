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

async function saveFile(relPath, content){
  if (!canPost) { download(relPath.split('/').pop(), content); return { mode: 'download' }; }
  const r = await fetch('/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: relPath, content })
  });
  if (!r.ok) {
    let msg = 'HTTP ' + r.status;
    try { const j = await r.json(); if (j && j.error) msg += ' — ' + j.error; } catch (e) {}
    throw new Error(msg);
  }
  return { mode: 'server' };
}

root.HubIO = { canPost, saveFile, download };
})(typeof self !== 'undefined' ? self : this);
