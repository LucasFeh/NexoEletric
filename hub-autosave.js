/* AltiumPCBMirror v2 - hub-autosave.js — o Autosave das vistas (Arquivo » Autosave).

   Pedido do dono (2026-10-28): "em salvar no arquivo, tenha autosave: você seleciona, fica uma
   vez selecionado e toda vez que mexe em qualquer coisa já salva". Uma escolha so para a maquina
   (localStorage, a mesma origem do hub): marcou na PCB, vale no Esquema e nas proximas aberturas;
   as outras vistas abertas ficam sabendo pelo evento `storage`.

   A vista chama agenda(salva) a cada edicao. O salvamento sai um pouco depois da ULTIMA edicao
   (arrastar, digitar uma cota: nao grava a cada passo) e nunca dois ao mesmo tempo: o que chega
   durante uma gravacao entra na fila e sai quando ela termina.

   HubAutosave.ligado() -> bool      HubAutosave.liga(bool)      HubAutosave.alterna() -> bool
   HubAutosave.agenda(salva, ms?)    salva() -> Promise (o salvamento da vista, sem perguntar nada
                                     que ja nao perguntasse no Salvar)
   HubAutosave.aoMudar(f)            f(ligado) quando outra vista troca a escolha */
(function (raiz, fabrica) {
  const m = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.HubAutosave = m;
})(typeof self !== 'undefined' ? self : this, function () {
"use strict";

const CHAVE = 'nexoeletric.autosave';
const ESPERA = 900;                 /* ms depois da ultima edicao */
let timer = null, gravando = false, deNovo = null;
let memoria = false;                /* sem localStorage (janela privada): vale so nesta pagina */
const ouvintes = [];

function ligado() {
  try { return localStorage.getItem(CHAVE) === '1'; } catch (e) { return memoria; }
}
function liga(v) {
  memoria = !!v;
  try { localStorage.setItem(CHAVE, v ? '1' : '0'); } catch (e) { /* sem storage: so nesta pagina */ }
  for (const f of ouvintes) { try { f(!!v); } catch (e) {} }
}
function alterna() { const v = !ligado(); liga(v); return v; }

function agenda(salva, ms) {
  if (!ligado()) return;
  clearTimeout(timer);
  timer = setTimeout(() => roda(salva), ms != null ? ms : ESPERA);
}
async function roda(salva) {
  if (gravando) { deNovo = salva; return; }
  gravando = true;
  try { await salva(); }
  catch (e) { console.warn('autosave:', e); }
  finally {
    gravando = false;
    if (deNovo) { const f = deNovo; deNovo = null; agenda(f, 0); }
  }
}

function aoMudar(f) { if (typeof f === 'function') ouvintes.push(f); }
if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => {
    if (e.key !== CHAVE) return;
    for (const f of ouvintes) { try { f(e.newValue === '1'); } catch (er) {} }
  });
}

return { ligado, liga, alterna, agenda, aoMudar };
});
