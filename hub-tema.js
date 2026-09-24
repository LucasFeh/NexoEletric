/* hub-tema.js — escolhe o tema do hub (modo, tema, fonte) ANTES da primeira pintura, em
   qualquer pagina: a casca (hub.html) e as vistas (schframe.html, pcbframe.html). Os tokens de
   cor moram em hub-tema.css; aqui so os tres atributos do <html> que escolhem o bloco.

   Carregue SINCRONO no <head> (sem defer/async): e isso que impede a pagina de abrir escura e
   clarear meio segundo depois.

   AO VIVO. O modal de configuracao do hub grava no localStorage (hub.html » skinSet). As
   vistas sao iframes da mesma origem, ou janelas a parte ("Abrir em nova aba"), e recebem o
   evento `storage` dessa gravacao: o tema troca na hora, sem recarregar a folha. O modo "auto"
   acompanha o sistema operacional. Quem pinta em canvas com cor de tema (o canvas nao le var()
   sozinho) le a cor com HubTema.cor('--token') e ouve o evento 'hubtema' na window para
   redesenhar.

   Os padroes (Escuro, Altium, Inter) tem de ser os mesmos do `skin` do hub.html: sao dois
   leitores da mesma chave, e discordar faz a tela abrir de um jeito e trocar no primeiro frame. */
(function () {
  'use strict';
  var CHAVES = { mode: 'altiumhub.mode', theme: 'altiumhub.theme', font: 'altiumhub.font' };
  var raiz = document.documentElement;
  var claro = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

  function ler(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  function aplica() {
    var m = ler(CHAVES.mode), t = ler(CHAVES.theme), f = ler(CHAVES.font);
    /* Sem nada guardado abre Escuro/Altium: e o padrao DA CASA, nao o do sistema. "auto" so
       entra em cena depois que alguem o escolheu na configuracao. */
    if (!m) m = 'dark';
    if (m === 'auto') m = claro && claro.matches ? 'light' : 'dark';
    var antes = raiz.dataset.mode + '|' + raiz.dataset.theme + '|' + raiz.dataset.font;
    raiz.dataset.mode = m === 'light' ? 'light' : 'dark';
    raiz.dataset.theme = t || 'altium';
    raiz.dataset.font = f || 'inter';     /* so o identificador; a pilha da familia mora no CSS */
    var agora = raiz.dataset.mode + '|' + raiz.dataset.theme + '|' + raiz.dataset.font;
    if (antes !== agora) {
      try { window.dispatchEvent(new Event('hubtema')); } catch (e) { /* navegador antigo */ }
    }
  }

  /* um token ja resolvido pelo tema atual; `reserva` quando a folha ainda nao carregou */
  function cor(nome, reserva) {
    var v = '';
    try { v = getComputedStyle(raiz).getPropertyValue(nome).trim(); } catch (e) { /* sem estilo */ }
    return v || reserva || '';
  }

  aplica();
  window.addEventListener('storage', function (e) {
    /* key null = localStorage.clear() */
    if (e.key === null || e.key === CHAVES.mode || e.key === CHAVES.theme || e.key === CHAVES.font) aplica();
  });
  if (claro) {
    var muda = function () { aplica(); };
    if (claro.addEventListener) claro.addEventListener('change', muda);
    else if (claro.addListener) claro.addListener(muda);
  }

  window.HubTema = { aplica: aplica, cor: cor, CHAVES: CHAVES };
})();
