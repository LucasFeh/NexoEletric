/* AltiumPCBMirror - hub-altiumabrir.js
   Arquivo » Abrir documento do Altium (.SchDoc / .PrjPcb): o esquema do Altium aberto direto no
   hub, sem o Altium e sem o ExportProject. A pagina manda os arquivos ao hubserver
   (POST /api/altium/abrir), que le o .SchDoc com o tools/schdoc/schdoc2sch.py e grava o
   Projects/<projeto>/schematic.js; depois o hub troca para o projeto e abre a aba Esquema.

   Escolha o .PrjPcb JUNTO com as folhas (.SchDoc): o navegador so entrega os arquivos
   escolhidos, nunca a pasta. Sem o .PrjPcb vale a ordem em que as folhas foram escolhidas e o
   nome do projeto e o da primeira folha.

   API (global HubAltiumAbrir)
     abre({aoAbrir(nomeDoProjeto)})   escolhe os arquivos, pergunta o nome, converte e abre */
(function (root) {
'use strict';

const dlg = () => (typeof HubDialog !== 'undefined' ? HubDialog : null);
const toast = (m, k, ms) => { const d = dlg(); if (d) d.toast(m, k || 'info', ms || 3500); };
const tamanho = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';

function escolhe(){
  return new Promise(ok => {
    const i = document.createElement('input');
    i.type = 'file'; i.multiple = true; i.accept = '.SchDoc,.schdoc,.PrjPcb,.prjpcb';
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
    const t = document.createElement('div'); t.textContent = 'Abrir documento do Altium'; t.style.cssText = 'font-weight:600;font-size:14px;margin-bottom:6px;';
    const n = document.createElement('div'); n.textContent = folhas.join(' · '); n.style.cssText = 'font-size:12px;color:var(--text-2);margin-bottom:12px;word-break:break-word;';
    const l = document.createElement('label'); l.textContent = 'Nome do projeto no hub'; l.style.cssText = 'display:block;font-size:12px;color:var(--text-2);margin-bottom:4px;';
    const i = document.createElement('input'); i.className = 'input'; i.value = sugestao; i.style.cssText = 'width:100%;box-sizing:border-box;';
    const pe = document.createElement('div'); pe.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:14px;';
    const bt = (txt, cls, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = txt; b.onclick = fn; return b; };
    const fim = v => { fundo.remove(); ok(v); };
    pe.append(bt('Cancelar', 'btn btn-secondary', () => fim(null)), bt('Abrir no hub', 'btn btn-primary', () => fim(i.value.trim() || null)));
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

async function abre(opcoes){
  const o = opcoes || {};
  if (!/^https?:/.test(location.protocol)) { toast('abrir documento do Altium pede o hub pelo servidor (hubserver.py), não o arquivo aberto do disco', 'warn', 5000); return null; }
  const arqs = (await escolhe()).filter(f => /\.(schdoc|prjpcb)$/i.test(f.name));
  if (!arqs.length) return null;
  const prj = arqs.find(f => /\.prjpcb$/i.test(f.name));
  const folhas = arqs.filter(f => /\.schdoc$/i.test(f.name));
  const d = dlg();
  if (!folhas.length) {
    if (d) await d.alert('Escolha o .PrjPcb JUNTO com as folhas de esquema (.SchDoc) do projeto: o navegador só entrega os arquivos escolhidos, nunca a pasta.\n\nNa janela de arquivos, segure Ctrl e clique no .PrjPcb e em cada .SchDoc.', { title:'Abrir documento do Altium' });
    return null;
  }
  const base = (prj || folhas[0]).name.replace(/\.[^.]+$/, '');
  const nome = await pedeNome(base, arqs.map(f => f.name));
  if (!nome) return null;
  toast('lendo ' + folhas.length + ' folha(s) do Altium (' + tamanho(arqs.reduce((s, f) => s + f.size, 0)) + ')…', 'info', 2500);
  let corpo;
  try { corpo = { projeto:nome, arquivos:await Promise.all(arqs.map(async f => ({ nome:f.name, b64:await b64(f) }))) }; }
  catch (e) { toast('não deu para ler os arquivos: ' + (e && e.message || e), 'err'); return null; }
  let r = await envia(corpo);
  if (!r.ok && r.existe) {
    const sim = d ? await d.confirm('O projeto "' + nome + '" já tem esquema no hub. Substituir pelo do Altium? O atual fica guardado como schematic.js.bak.', { title:'Abrir documento do Altium', ok:'Substituir', danger:true }) : window.confirm('Substituir o esquema de "' + nome + '"?');
    if (!sim) return null;
    corpo.substituir = true;
    r = await envia(corpo);
  }
  if (!r.ok) { if (d) await d.alert(r.error || 'não abriu', { title:'Abrir documento do Altium' }); else toast(r.error || 'não abriu', 'err'); return null; }
  const s = r.resumo || {};
  const partes = [s.comp + ' componentes', s.wire + ' fios', (s.netlabel || 0) + (s.power || 0) + (s.port || 0) + ' rótulos/power/ports', s.folhas + ' folha(s)'];
  if (s.simbolos) partes.push(s.simbolos + ' símbolos da folha');
  toast('"' + r.projeto + '" aberto do Altium: ' + partes.join(' · '), 'ok', 6000);
  if (s.faltam && s.faltam.length) toast('faltaram folhas do .PrjPcb (escolha-as junto): ' + s.faltam.join(', '), 'warn', 8000);
  if (typeof o.aoAbrir === 'function') { try { await o.aoAbrir(r.projeto, r); } catch (e) { console.warn('aoAbrir', e); } }
  return r;
}

root.HubAltiumAbrir = { abre };
})(typeof self !== 'undefined' ? self : this);
