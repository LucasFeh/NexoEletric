/* AltiumPCBMirror v2 - hub-libremota.js — o indicador da biblioteca remota (app desktop).

   No app desktop o hub local roda com ALTIUMHUB_LIB_REMOTA (libremota.py): a biblioteca é
   a do SERVIDOR, lida e gravada lá, e Libs/ vira espelho dela. Sem o servidor ela abre só
   para leitura, com a última cópia, e toda gravação volta 503 com o motivo. Este módulo
   diz isso na tela, e só isso:

   - modo local (a web, a bancada, o próprio servidor): uma consulta ao carregar e nada
     mais — nem elemento, nem timer. A web nunca mostra nada;
   - modo remoto: um item discreto — na barra de status do app (hub-shell.js » footer
     .eh-status » .dir, à esquerda do servidor) ou, se a casca não tiver barra, uma pílula
     fixa no canto — "Biblioteca do servidor" ou "Servidor fora — biblioteca só leitura",
     com o endereço e a última sincronia no title. Reconsulta a cada 10 s e no focus;
   - notificação na virada online <-> offline, e uma vez por backup novo (o espelho guardou
     um arquivo local que o servidor não tinha antes de sobrescrevê-lo);
   - o backup não depende do toast: o toast() da casca some em 2,8 s e o aviso de boot do app
     escreve por cima dele. O indicador fica em aviso ("cópia local guardada") até o usuário
     clicar nele e ver onde a cópia foi parar; só então o backup conta como visto.

   Da casca, uma linha: o <script src>. CSS e rótulos moram aqui (pt-BR, como os painéis).
   Nunca alert(): a notificação é o toast da casca (HubDialog.toast ou o toast() do hub), e o
   detalhe do backup abre no modal da casca (confirmaNoHub; nas vistas, HubDialog.alert). */
"use strict";
var HubLibRemota = (function () {
  if (typeof document === 'undefined' || typeof fetch === 'undefined') return {};

  /* sem crase aqui dentro: o CSS vive num template literal */
  const CSS = `
.hlr { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;
  font-size: 11px; color: var(--text-3, #7a7a80); cursor: default; }
.hlr-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; background: var(--ok, #4bbf7b); }
.hlr.aviso .hlr-dot { background: var(--warn, #d6a75a); }
.hlr.fora { color: var(--warn, #d6a75a); }
.hlr.fora .hlr-dot { background: var(--warn, #d6a75a); }
.hlr.pendente { cursor: pointer; }
.hlr.pendente:hover .hlr-txt, .hlr.pendente:focus-visible .hlr-txt { text-decoration: underline; }
.hlr.pendente:focus-visible { outline: 1px solid var(--warn, #d6a75a); outline-offset: 2px; }
.hlr.barra::after { content: ''; width: 1px; height: 12px; margin-left: 4px;
  background: var(--line, rgba(128,128,128,0.25)); }
.hlr.pilula { position: fixed; left: 12px; bottom: 12px; z-index: 900; padding: 4px 11px 4px 9px;
  border-radius: 999px; font-size: 11.5px; background: var(--surface, #1a1a1d);
  box-shadow: 0 0 0 1px var(--edge, #2a2a2e), 0 4px 14px rgba(0,0,0,0.22); }
`;

  const TXT = {
    online: 'Biblioteca do servidor',
    onlineBackup: 'Biblioteca do servidor · cópia local guardada',
    offline: 'Servidor fora — biblioteca só leitura',
    caiu: 'O servidor da biblioteca não responde: ela fica só para leitura, com a última cópia. Nada é gravado até ele voltar.',
    voltou: 'O servidor da biblioteca voltou: gravação liberada.',
    servidor: 'Servidor: ',
    sincronia: 'Última sincronia: ',
    nunca: 'nenhuma ainda',
    backupTitulo: 'Último backup: ',
    cliqueVer: 'Clique para ver onde a cópia local foi guardada.',
    backup: function (nomes, pasta) {
      const lista = nomes.length > 4
        ? nomes.slice(0, 4).join(', ') + ' e mais ' + (nomes.length - 4)
        : nomes.join(', ');
      return 'A biblioteca local tinha mudanças que o servidor não tem; guardadas em '
        + pasta + ' (' + lista + '). Detalhes no indicador da biblioteca.';
    },
    detalheTitulo: 'Cópia local guardada',
    detalhe: function (lista) {
      return 'Estes arquivos da biblioteca deste PC tinham mudanças que o servidor não tem. '
        + 'A biblioteca agora é a do servidor, então eles foram trocados pela versão de lá — '
        + 'e a versão deste PC ficou guardada, sem perder nada:\n\n'
        + lista.map(function (b) {
          return '• ' + b.arquivo + (b.em ? '  (' + b.em + ')' : '') + '\n   → ' + b.para;
        }).join('\n')
        + '\n\nSe essas mudanças importam, refaça-as na biblioteca do servidor.';
    },
    entendi: 'Entendi',
  };

  const INTERVALO = 10000;
  /* dois conjuntos: o toast sai uma vez por backup (avisados); o indicador só sai do aviso
     quando o usuário abriu o detalhe (vistos) */
  const LS_AVISADOS = 'altiumhub.libremota.backups';
  const LS_VISTOS = 'altiumhub.libremota.backups.vistos';

  let el = null;
  let ativo = false;
  let timer = null;
  let emCurso = false;
  let ultimoOnline = null;          // null = ainda não viu nenhum estado
  let ultimo = null;                // o último status, para repintar depois do clique
  const avisados = carregaSet(LS_AVISADOS);
  const vistos = carregaSet(LS_VISTOS);

  function carregaSet(k) {
    try {
      const v = JSON.parse(localStorage.getItem(k) || '[]');
      return new Set(Array.isArray(v) ? v : []);
    } catch (e) { return new Set(); }
  }
  function guardaSet(k, set) {
    try { localStorage.setItem(k, JSON.stringify(Array.from(set).slice(-200))); } catch (e) { /* conforto */ }
  }
  function chave(b) { return (b.arquivo || '') + '|' + (b.para || '') + '|' + (b.em || ''); }
  function pendentes(st) {
    return ((st && st.backups) || []).filter(function (b) { return b && !vistos.has(chave(b)); });
  }

  function avisa(msg, tipo, ms) {
    try {
      if (window.HubDialog && typeof window.HubDialog.toast === 'function') { window.HubDialog.toast(msg, tipo, ms); return; }
      if (typeof window.toast === 'function') window.toast(msg, tipo);
    } catch (e) { /* sem toast, o indicador continua dizendo */ }
  }

  function injetaCss() {
    if (document.getElementById('hlr-css')) return;
    const st = document.createElement('style');
    st.id = 'hlr-css';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  /* A barra do app é montada pelo hub-shell.js (defer, e de novo enquanto o hub não desenhou
     as abas): pode aparecer depois deste item. Quem já é pílula muda para a barra quando ela
     chega; o renderStatus da casca só reescreve .info e .srv, então o item não some. */
  function posiciona() {
    if (!el) {
      injetaCss();
      el = document.createElement('span');
      el.className = 'hlr';
      const dot = document.createElement('span');
      dot.className = 'hlr-dot';
      const txt = document.createElement('span');
      txt.className = 'hlr-txt';
      el.append(dot, txt);
      el.addEventListener('click', mostraBackup);
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); mostraBackup(); }
      });
    }
    const dir = document.querySelector('footer.eh-status .dir');
    if (dir) {
      if (el.parentNode !== dir) {
        el.classList.remove('pilula');
        el.classList.add('barra');
        dir.insertBefore(el, dir.firstChild);
      }
      return true;
    }
    if (!el.parentNode && document.body) {
      el.classList.add('pilula');
      document.body.appendChild(el);
    }
    return false;
  }

  function procuraBarra(n) {
    if (!ativo || posiciona() || n <= 0) return;
    setTimeout(function () { procuraBarra(n - 1); }, 500);
  }

  function pinta(st) {
    posiciona();
    ultimo = st;
    const on = !!st.online;
    const pend = pendentes(st);
    el.classList.toggle('fora', !on);
    el.classList.toggle('aviso', on && (!!st.erro || pend.length > 0));
    el.classList.toggle('pendente', pend.length > 0);
    if (pend.length) { el.setAttribute('role', 'button'); el.tabIndex = 0; }
    else { el.removeAttribute('role'); el.removeAttribute('tabindex'); }
    el.querySelector('.hlr-txt').textContent = on ? (pend.length ? TXT.onlineBackup : TXT.online) : TXT.offline;
    const linhas = [TXT.servidor + (st.servidor || ''), TXT.sincronia + (st.ultimaSincronia || TXT.nunca)];
    if (st.erro) linhas.push(st.erro);
    const bk = st.backups || [];
    if (bk.length) linhas.push(TXT.backupTitulo + bk[bk.length - 1].para);
    if (pend.length) linhas.push(TXT.cliqueVer);
    el.title = linhas.join('\n');
  }

  /* O clique no indicador em aviso: o detalhe no modal da casca, e só aí o backup conta como
     visto. Fechar pelo Esc ou por fora também conta — o usuário viu o texto. */
  let mostrando = false;
  async function mostraBackup() {
    const pend = pendentes(ultimo);
    if (!pend.length || mostrando) return;
    mostrando = true;
    try {
      const texto = TXT.detalhe(pend);
      if (typeof window.confirmaNoHub === 'function') {
        await window.confirmaNoHub(texto, { title: TXT.detalheTitulo, ok: TXT.entendi, cancel: false });
      } else if (window.HubDialog && typeof window.HubDialog.alert === 'function') {
        await window.HubDialog.alert(texto, { title: TXT.detalheTitulo });
      }
      /* sem modal nenhum, o title do indicador já mostrou o caminho */
    } catch (e) { /* o modal falhou: marca mesmo assim, senão o clique não faz nada */ }
    finally { mostrando = false; }
    pend.forEach(function (b) { vistos.add(chave(b)); });
    guardaSet(LS_VISTOS, vistos);
    if (ultimo) pinta(ultimo);
  }

  function viradas(st) {
    const on = !!st.online;
    /* a primeira vista conta como virada só quando é "fora": abrir o app com o servidor
       desligado é exatamente o momento de dizer que nada vai ser gravado */
    if (ultimoOnline === null ? !on : on !== ultimoOnline) avisa(on ? TXT.voltou : TXT.caiu, on ? 'ok' : 'warn', 8000);
    ultimoOnline = on;
    /* o toast sai uma vez por backup; quem segura o aviso até o usuário ver é o indicador */
    const novos = pendentes(st).filter(function (b) { return !avisados.has(chave(b)); });
    if (!novos.length) return;
    novos.forEach(function (b) { avisados.add(chave(b)); });
    guardaSet(LS_AVISADOS, avisados);
    const ult = novos[novos.length - 1];
    const pasta = String(ult.para || '').replace(/\/Libs\/[^/]+$/, '/');
    avisa(TXT.backup(novos.map(function (b) { return String(b.arquivo || '').replace(/^Libs\//, ''); }), pasta), 'warn', 15000);
  }

  function liga() {
    ativo = true;
    timer = setInterval(consulta, INTERVALO);
    window.addEventListener('focus', consulta);
    procuraBarra(30);
  }
  function desliga() {
    ativo = false;
    clearInterval(timer);
    window.removeEventListener('focus', consulta);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  async function consulta() {
    if (emCurso) return;
    emCurso = true;
    let st = null;
    try {
      const r = await fetch('/api/lib-remota/status', { cache: 'no-store' });
      if (r.ok) st = await r.json();
    } catch (e) {
      st = null;                    // file://, hub antigo sem a rota, ou o próprio hub caiu
    } finally {
      emCurso = false;
    }
    if (!st) return;                // sem resposta não muda nada: nem liga, nem avisa
    if (st.modo !== 'remota') {
      if (ativo) desliga();         // o hub voltou a subir local
      return;
    }
    if (!ativo) liga();
    pinta(st);
    viradas(st);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', consulta);
  else consulta();

  return { consulta: consulta };
})();
