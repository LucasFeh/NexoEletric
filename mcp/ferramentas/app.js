/* NexoEletric MCP - grupo "app": o app NexoEletric aberto, a janela do usuario e o lote.

   Mesma mecanica do NexoCAD (gui_status/gui_open, batch): o app aberto grava
   ~/.nexoeletric/session.json {hub, root, pid} (electron/main.js), o MCP le e fala com o hub dele.
   Sem o app, as ferramentas de arquivo continuam valendo (o MCP grava direto na pasta de trabalho e
   o NexoEletric sobe para o NexoBD quando abrir); o que precisa da tela (vista_*, Biblioteca de
   simbolos, fp_vincular) pede app_abrir. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { ErroMcp, sessaoDoApp, ARQ_SESSAO } = require('../lib/contexto.js');
const { hubNoAr } = require('../lib/util.js');

const espera = ms => new Promise(r => setTimeout(r, ms));

function exeDoApp() {
  const cands = [];
  if (/nexoeletric\.exe$/i.test(process.execPath)) cands.push(process.execPath);   // o MCP instalado roda no proprio exe
  const s = sessaoDoApp();
  if (s && s.exe) cands.push(s.exe);
  for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')])
    if (base) cands.push(path.join(base, 'NexoEletric', 'NexoEletric.exe'));
  return cands.find(f => { try { return fs.statSync(f).isFile(); } catch (_) { return false; } }) || '';
}

async function estado(ctx) {
  const s = sessaoDoApp();
  const hub = await hubNoAr(ctx);
  return {
    app: s ? { aberto: true, versao: s.versao, pid: s.pid, hub: s.hub, pasta: s.root, desde: s.iniciado } : { aberto: false },
    hub: hub ? { url: hub.url, mesmaPasta: !!hub.mesmaRaiz, vistas: hub.vistas || [] } : null,
    mcp: { pasta: ctx.root, origem: ctx.origemRaiz, aviso: ctx.avisoRaiz || undefined, sessao: ARQ_SESSAO() },
    modo: hub ? 'ao vivo: o que a IA grava aparece na tela na hora' : 'só arquivos: grava na pasta de trabalho; abra o app (app_abrir) para ver ao vivo',
  };
}

/* pedido a pagina principal do hub (hub-mcp.js): alvo "hub", proj "*" */
async function pedeHub(ctx, acao, args, segundos) {
  const hub = await hubNoAr(ctx);
  if (!hub) throw new ErroMcp('o NexoEletric não está aberto (app_abrir abre)');
  const r = await fetch(hub.url + '/api/mcp/pedido', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alvo: 'hub', proj: '*', acao, args }), signal: AbortSignal.timeout(3000) });
  const j = await r.json().catch(() => null);
  if (!j || !j.ok) throw new ErroMcp((j && j.error) || 'o hub recusou o pedido (versão sem o alvo "hub"?)');
  const s = Math.min(20, segundos || 10);
  const q = await fetch(`${hub.url}/api/mcp/resposta/${encodeURIComponent(j.id)}?espera=${s}`, { signal: AbortSignal.timeout((s + 3) * 1000) });
  return q.json();
}

/* "$id.campo.sub" / "$anterior.campo" nos args do lote viram o valor do resultado daquele passo */
function resolve(v, res, ultimo) {
  if (typeof v === 'string') {
    const m = /^\$([A-Za-z_][\w-]*)((?:\.[\w-]+)*)$/.exec(v);
    if (!m) return v;
    let o = m[1] === 'anterior' ? ultimo : res[m[1]];
    if (o === undefined) throw new ErroMcp(`"${v}": não há passo "${m[1]}" antes deste`);
    for (const k of m[2].split('.').filter(Boolean)) { o = o == null ? undefined : (Array.isArray(o) && /^\d+$/.test(k) ? o[+k] : o[k]); }
    return o;
  }
  if (Array.isArray(v)) return v.map(x => resolve(x, res, ultimo));
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = resolve(v[k], res, ultimo); return o; }
  return v;
}
function objetoDe(r) {
  if (r && r.structuredContent) return r.structuredContent;
  try { return JSON.parse(r.content[0].text); } catch (_) { return r && r.content && r.content[0] ? r.content[0].text : null; }
}

module.exports = {
  grupo: 'app',
  ordem: 5,
  titulo: 'App — o NexoEletric aberto, a janela do usuário e o lote de comandos',
  ferramentas: [
    {
      nome: 'app_status', titulo: 'Estado do app e do MCP', leitura: true,
      descricao: 'O NexoEletric está aberto? Em que pasta de trabalho, com que hub, e quais vistas (Esquema/PCB) estão abertas agora. Mostra também de onde o MCP tirou a pasta (--root, app aberto ou configuração). Ao vivo = o que a IA grava aparece na tela na hora.',
      entrada: { type: 'object', properties: {} },
      executa: async (a, ctx) => estado(ctx),
    },
    {
      nome: 'app_abrir', titulo: 'Abrir o NexoEletric',
      descricao: 'Abre o app NexoEletric nesta máquina (se ainda não estiver aberto) e espera o hub subir — depois disso o que a IA grava aparece na tela, e vista_screenshot/vista_abrir/sym_salvar (biblioteca) funcionam. Com "projeto", já abre esse projeto na aba pedida.',
      entrada: { type: 'object', properties: { projeto: { type: 'string' }, aba: { type: 'string', enum: ['esquema', 'pcb', 'gerber', 'lib', 'bom', 'hist'] } } },
      executa: async (a, ctx, srv) => {
        let e = await estado(ctx);
        let abriu = false;
        if (!e.app.aberto || !e.hub) {
          const exe = exeDoApp();
          if (!exe) throw new ErroMcp('não achei o NexoEletric instalado (C:\\Program Files\\NexoEletric). Instale pelo Nexo Hub › Programas da rede.');
          const env = Object.assign({}, process.env); delete env.ELECTRON_RUN_AS_NODE;
          spawn(exe, [], { detached: true, stdio: 'ignore', env, windowsHide: false }).unref();
          abriu = true;
          for (let i = 0; i < 180; i++) {       // a primeira abertura traz projetos e biblioteca do NexoBD
            await espera(500);
            e = await estado(ctx);
            if (e.app.aberto && e.hub) break;
          }
          if (!e.hub) throw new ErroMcp('o NexoEletric abriu mas o hub não respondeu em 90 s (veja a janela dele)');
        }
        const out = Object.assign({ abriu }, e);
        if (a.projeto) {
          for (let i = 0; i < 20; i++) {         // a casca do hub leva uns segundos para escutar a fila
            const r = await pedeHub(ctx, 'abrir', { projeto: ctx.projeto(a.projeto).nome, aba: a.aba || 'esquema' }, 4).catch(err => ({ ok: false, erro: err.message }));
            if (r.ok) { out.aberto = r.dados; break; }
            out.aberto = { erro: r.erro };
            await espera(1000);
          }
        }
        return out;
      },
    },
    {
      nome: 'vista_abrir', titulo: 'Abrir projeto na janela do usuário',
      descricao: 'Mostra ao usuário um projeto no NexoEletric aberto, na aba pedida (esquema, pcb, gerber, lib, bom, hist) — para ele ver o que a IA fez. Precisa do app aberto (app_abrir).',
      entrada: { type: 'object', properties: { projeto: { type: 'string' }, aba: { type: 'string', enum: ['esquema', 'pcb', 'gerber', 'lib', 'bom', 'hist'] } }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const r = await pedeHub(ctx, 'abrir', { projeto: p.nome, aba: a.aba || 'esquema' }, 8);
        if (!r.ok) throw new ErroMcp(r.erro || 'a janela do hub não respondeu');
        return r.dados;
      },
    },
    {
      nome: 'lote', titulo: 'Lote de comandos',
      descricao: 'Roda várias ferramentas em sequência numa chamada só (como o batch do NexoCAD): passos [{id?, ferramenta, args}]. Um argumento "$id.campo" (ou "$anterior.campo") recebe o valor do resultado de um passo anterior — ex.: gerar um símbolo e salvá-lo, colocar vários componentes, ligar uma fila de pinos. Para no primeiro erro (parar_no_erro:false segue). Cada passo grava como a ferramenta sozinha gravaria (projeto_desfazer volta um por um).',
      entrada: { type: 'object', properties: {
        passos: { type: 'array', minItems: 1, maxItems: 200, items: { type: 'object', properties: { id: { type: 'string' }, ferramenta: { type: 'string' }, args: { type: 'object', additionalProperties: true } }, required: ['ferramenta'] } },
        parar_no_erro: { type: 'boolean' },
      }, required: ['passos'] },
      executa: async (a, ctx, srv) => {
        const res = {}, saida = [];
        let ultimo, falhas = 0;
        for (let i = 0; i < a.passos.length; i++) {
          const ps = a.passos[i];
          const f = srv.reg.get(ps.ferramenta);
          const id = ps.id || 'p' + (i + 1);
          if (!f || f.nome === 'lote') { saida.push({ passo: id, ok: false, erro: f ? 'lote dentro de lote não' : `ferramenta desconhecida: ${ps.ferramenta}` }); falhas++; if (a.parar_no_erro !== false) break; continue; }
          let args;
          try { args = resolve(ps.args || {}, res, ultimo); } catch (e) { saida.push({ passo: id, ok: false, erro: e.message }); falhas++; if (a.parar_no_erro !== false) break; continue; }
          const t0 = Date.now();
          const r = await srv.executa(f, args);
          if (srv.opts && srv.opts.aoChamar) { try { srv.opts.aoChamar(f, args, r, Date.now() - t0); } catch (_) { /* relato */ } }
          const obj = objetoDe(r);
          const ok = !r.isError;
          res[id] = obj; ultimo = obj;
          saida.push({ passo: id, ferramenta: f.nome, ok, resultado: obj });
          if (!ok) { falhas++; if (a.parar_no_erro !== false) break; }
        }
        return { ok: !falhas, passos: saida.length, de: a.passos.length, falhas, resultados: saida };
      },
    },
  ],
  _interno: { resolve },
};
