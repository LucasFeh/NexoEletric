/* AltiumPCBMirror - hub-altiumabrir.js
   Arquivo » Abrir documento do Altium (.PrjPcb / .SchDoc / .PcbDoc), ou o arquivo ARRASTADO para a
   janela: o projeto do Altium aberto direto no hub, sem o Altium e sem os scripts. A pagina manda ao
   hubserver (POST /api/altium/abrir) o que foi escolhido; ele grava Projects/<projeto>/ como o
   ExportProject + ExportBoard deixariam: o schematic.js (tools/schdoc/schdoc2sch.py), o board.js, o
   rules.js e o 3D (tools/pcbdoc/abrir_placa.py), e o changes.js/annotations.js vazios. Depois o hub
   troca para o projeto.

   No app desktop basta o .PrjPcb: o preload da o caminho do arquivo (eletricApp.caminho) e o
   hubserver acha as folhas e a placa pelo proprio projeto. No navegador so chegam os arquivos
   escolhidos, nunca a pasta: escolha o .PrjPcb JUNTO com as folhas (.SchDoc) e a placa (.PcbDoc).

   API (global HubAltiumAbrir)
     abre({arquivos?, aoAbrir(nomeDoProjeto, resposta)})   sem arquivos, abre a janela de escolha
     soltar(aoSoltar(arquivos))   liga o arrastar-e-soltar na pagina e nas vistas (iframes) dela */
(function (root) {
'use strict';

const EXT = /\.(schdoc|prjpcb|pcbdoc)$/i;
const dlg = () => (typeof HubDialog !== 'undefined' ? HubDialog : null);
const toast = (m, k, ms) => { const d = dlg(); if (d) d.toast(m, k || 'info', ms || 3500); };
const tamanho = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const app = () => (typeof window !== 'undefined' && window.eletricApp && typeof window.eletricApp.caminho === 'function') ? window.eletricApp : null;

function escolhe(){
  return new Promise(ok => {
    const i = document.createElement('input');
    i.type = 'file'; i.multiple = true; i.accept = '.PrjPcb,.prjpcb,.SchDoc,.schdoc,.PcbDoc,.pcbdoc';
    i.style.display = 'none';
    i.onchange = () => { const l = [...(i.files || [])]; i.remove(); ok(l); };
    /* cancelar a janela do sistema nao dispara change: o foco voltando sem arquivo fecha */
    window.addEventListener('focus', () => setTimeout(() => { if (i.isConnected && !(i.files && i.files.length)) { i.remove(); ok([]); } }, 600), { once:true });
    document.body.append(i);
    i.click();
  });
}

function b64(arq){
  return new Promise((ok, falha) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result || ''); ok(s.slice(s.indexOf(',') + 1)); };
    r.onerror = () => falha(r.error || new Error('não leu ' + arq.name));
    r.readAsDataURL(arq);
  });
}

/* o nome do projeto: uma janela no tema do hub (o Electron nao tem window.prompt) */
function pedeNome(sugestao, folhas){
  return new Promise(ok => {
    const fundo = document.createElement('div');
    fundo.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;';
    const cx = document.createElement('div');
    cx.style.cssText = 'width:440px;max-width:calc(100vw - 32px);background:var(--surface);color:var(--text);border:1px solid var(--edge);border-radius:8px;box-shadow:var(--shadow-menu);font:13px/1.45 var(--font);padding:16px;';
    const t = document.createElement('div'); t.textContent = 'Abrir projeto do Altium'; t.style.cssText = 'font-weight:600;font-size:14px;margin-bottom:6px;';
    const n = document.createElement('div'); n.textContent = folhas.join(' · '); n.style.cssText = 'font-size:12px;color:var(--text-2);margin-bottom:12px;word-break:break-word;';
    const l = document.createElement('label'); l.textContent = 'Nome do projeto no NexoEletric'; l.style.cssText = 'display:block;font-size:12px;color:var(--text-2);margin-bottom:4px;';
    const i = document.createElement('input'); i.className = 'input'; i.value = sugestao; i.style.cssText = 'width:100%;box-sizing:border-box;';
    const pe = document.createElement('div'); pe.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:14px;';
    const bt = (txt, cls, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = txt; b.onclick = fn; return b; };
    const fim = v => { fundo.remove(); ok(v); };
    pe.append(bt('Cancelar', 'btn btn-secondary', () => fim(null)), bt('Abrir', 'btn btn-primary', () => fim(i.value.trim() || null)));
    i.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') fim(i.value.trim() || null); else if (e.key === 'Escape') fim(null); });
    cx.append(t, n, l, i, pe); fundo.append(cx); document.body.append(fundo);
    setTimeout(() => { i.focus(); i.select(); }, 20);
  });
}

async function envia(corpo){
  const r = await fetch('/api/altium/abrir', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(corpo) });
  let j = null; try { j = await r.json(); } catch (e) { /* sem corpo */ }
  if (!j) j = { ok:false, error:r.status === 404 ? 'o servidor do hub é anterior a esta versão (reinicie o hubserver.py)' : 'HTTP ' + r.status };
  j.status = r.status;
  return j;
}

/* os caminhos no disco (so no app desktop, e so se TODOS vierem) */
function caminhos(arqs){
  const a = app();
  if (!a) return null;
  const l = arqs.map(f => a.caminho(f));
  return l.every(Boolean) ? l : null;
}

async function abre(opcoes){
  const o = opcoes || {};
  const d = dlg();
  if (!/^https?:/.test(location.protocol)) { toast('abrir documento do Altium pede o hub pelo servidor (hubserver.py), não o arquivo aberto do disco', 'warn', 5000); return null; }
  const arqs = [...(o.arquivos || await escolhe())].filter(f => EXT.test(f.name));
  if (!arqs.length) {
    if (o.arquivos && d) await d.alert('Solte um projeto do Altium: o .PrjPcb (ou as folhas .SchDoc e a placa .PcbDoc).', { title:'Abrir projeto do Altium' });
    return null;
  }
  const prj = arqs.find(f => /\.prjpcb$/i.test(f.name));
  const folhas = arqs.filter(f => /\.schdoc$/i.test(f.name));
  const placas = arqs.filter(f => /\.pcbdoc$/i.test(f.name));
  const disco = caminhos(arqs);
  if (!disco && !folhas.length && !placas.length) {
    if (d) await d.alert('Escolha o .PrjPcb JUNTO com as folhas de esquema (.SchDoc) e a placa (.PcbDoc) do projeto: o navegador só entrega os arquivos escolhidos, nunca a pasta.\n\nNa janela de arquivos, segure Ctrl e clique em cada um. No app NexoEletric basta o .PrjPcb.', { title:'Abrir projeto do Altium' });
    return null;
  }
  const base = (prj || folhas[0] || placas[0]).name.replace(/\.[^.]+$/, '');
  const nome = await pedeNome(base, arqs.map(f => f.name));
  if (!nome) return null;
  let corpo;
  if (disco) {
    toast('convertendo ' + (prj ? prj.name + ' (esquema e PCB)' : arqs.length + ' arquivo(s)') + '…', 'info', 4000);
    corpo = { projeto:nome, caminhos:disco };
  } else {
    toast('lendo ' + arqs.length + ' arquivo(s) do Altium (' + tamanho(arqs.reduce((s, f) => s + f.size, 0)) + ')…', 'info', 2500);
    try { corpo = { projeto:nome, arquivos:await Promise.all(arqs.map(async f => ({ nome:f.name, b64:await b64(f) }))) }; }
    catch (e) { toast('não deu para ler os arquivos: ' + (e && e.message || e), 'err'); return null; }
  }
  let r = await envia(corpo);
  if (!r.ok && r.existe) {
    const sim = d ? await d.confirm('O projeto "' + nome + '" já existe no NexoEletric. Substituir pelo do Altium? O esquema e a placa atuais ficam guardados como .bak.', { title:'Abrir projeto do Altium', ok:'Substituir', danger:true }) : false;
    if (!sim) return null;
    corpo.substituir = true;
    r = await envia(corpo);
  }
  if (!r.ok) { if (d) await d.alert(r.error || 'não abriu', { title:'Abrir projeto do Altium' }); else toast(r.error || 'não abriu', 'err'); return null; }
  const s = r.resumo || {};
  const partes = [];
  if (r.esquema !== false) partes.push(s.folhas + ' folha(s), ' + s.comp + ' componentes, ' + s.wire + ' fios');
  if (r.placa) partes.push('PCB ' + r.placa.componentes + ' componentes, ' + r.placa.trilhas + ' trilhas' + (r.placa['3d'] ? ', 3D' : ''));
  toast('"' + r.projeto + '" aberto do Altium: ' + partes.join(' · '), 'ok', 6000);
  if (s.faltam && s.faltam.length) toast('faltaram folhas do .PrjPcb (escolha-as junto): ' + s.faltam.join(', '), 'warn', 8000);
  for (const a of (s.avisos || []).filter(x => !/template/.test(x)).slice(0, 3)) toast(a, 'warn', 7000);
  if (typeof o.aoAbrir === 'function') { try { await o.aoAbrir(r.projeto, r); } catch (e) { console.warn('aoAbrir', e); } }
  return r;
}

/* ─── arrastar e soltar ───────────────────────────────────────────────────
   Na pagina e em cada vista (iframe da mesma origem): o arquivo solto em qualquer lugar da janela
   abre. Sem isso o Chromium navegaria para o arquivo. O aviso "Solte para abrir" fica por cima de
   tudo enquanto o arquivo esta sobre a janela. */
function soltar(aoSoltar){
  const doc = document;
  let aviso = null, saida = null;
  const temArquivo = e => !!(e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files'));
  const mostra = () => {
    clearTimeout(saida);
    if (aviso) return;
    aviso = doc.createElement('div');
    aviso.style.cssText = 'position:fixed;inset:12px;z-index:2147483000;pointer-events:none;border:2px dashed var(--accent,#4c8bf5);border-radius:12px;background:rgba(20,22,26,.55);display:flex;align-items:center;justify-content:center;font:600 16px var(--font,sans-serif);color:#fff;';
    aviso.textContent = 'Solte o projeto do Altium (.PrjPcb, .SchDoc ou .PcbDoc) para abrir no NexoEletric';
    doc.body.append(aviso);
  };
  const esconde = (ms) => { clearTimeout(saida); saida = setTimeout(() => { if (aviso) { aviso.remove(); aviso = null; } }, ms || 0); };
  const liga = (w) => {
    if (!w || w.__hubAltiumSoltar) return;
    try { w.__hubAltiumSoltar = true; } catch (e) { return; } /* outra origem: nao mexe */
    const d = w.document;
    d.addEventListener('dragover', e => { if (!temArquivo(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; mostra(); });
    d.addEventListener('dragleave', () => esconde(150));
    d.addEventListener('drop', e => {
      if (!temArquivo(e)) return;
      e.preventDefault();
      esconde();
      const l = [...(e.dataTransfer.files || [])];
      if (l.length) aoSoltar(l);
    });
  };
  liga(window);
  /* as vistas (Esquema, PCB...) sao iframes: liga em cada um quando ele carrega */
  const ligaFrames = () => { for (const f of doc.querySelectorAll('iframe')) { try { if (f.contentWindow && f.contentDocument) liga(f.contentWindow); } catch (e) { /* outra origem */ } } };
  doc.addEventListener('load', e => { if (e.target && e.target.tagName === 'IFRAME') ligaFrames(); }, true);
  ligaFrames();
}

root.HubAltiumAbrir = { abre, soltar };

/* a pagina do hub liga sozinha: o que for solto vai para o mesmo caminho do menu (window.__hubAbrirAltium,
   do hub.html, troca para o projeto aberto); sem ele, so abre */
if (typeof document !== 'undefined' && typeof window !== 'undefined' && window.top === window) {
  const liga = () => soltar(arqs => (typeof window.__hubAbrirAltium === 'function' ? window.__hubAbrirAltium(arqs) : abre({ arquivos:arqs })));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', liga); else liga();
}
})(typeof self !== 'undefined' ? self : this);
