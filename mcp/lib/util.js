/* NexoEletric MCP - util.js: pecas pequenas que varios grupos usam. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { ErroMcp } = require('./contexto.js');

const isNum = v => typeof v === 'number' && isFinite(v);
const r4 = v => isNum(v) ? Math.round(v * 1e4) / 1e4 : v;

/* esquema da propriedade "projeto", repetido em quase toda ferramenta */
const PROJETO = { type: 'string', description: 'Nome da pasta do projeto em Projects/ (projeto_listar mostra). Acento/caixa podem diferir se o casamento for único.' };

/* Chama a primeira funcao que existir no modulo, entre os nomes candidatos. Os modulos dos
   colegas ainda estao sendo escritos: a ferramenta conhece os nomes provaveis e, se nenhum
   existir, diz quais funcoes o modulo exporta (para o integrador ajustar a lista aqui). */
function chamaModulo(ctx, arquivo, global, candidatos, args) {
  const m = ctx.exige(arquivo, global);
  for (const n of candidatos) if (typeof m[n] === 'function') return { funcao: n, valor: m[n](...args) };
  throw new ErroMcp(`o módulo ${arquivo} não tem nenhuma das funções esperadas (${candidatos.join(', ')}). Ele exporta: ${Object.keys(m).join(', ') || '(nada)'}. Use hub_modulo_chamar para chamar direto.`,
    { modulo: arquivo, exporta: Object.keys(m) });
}

/* caixa {x1,y1,x2,y2} normalizada, ou null */
function caixa(c) {
  if (!c || ![c.x1, c.y1, c.x2, c.y2].every(isNum)) return null;
  return { x1: Math.min(c.x1, c.x2), y1: Math.min(c.y1, c.y2), x2: Math.max(c.x1, c.x2), y2: Math.max(c.y1, c.y2) };
}
function noRet(b, x, y) { return x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2; }

/* nome de arquivo que pode virar caminho (o mesmo cuidado do _gerber_nome_ruim do hubserver) */
const RESERVADO = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i;
function nomeDePastaOk(nome) {
  if (typeof nome !== 'string' || !nome.trim()) return 'nome vazio';
  if (nome !== nome.trim() || nome.endsWith('.')) return 'sem espaço ou ponto no começo/fim';
  if (nome.length > 120) return 'nome comprido demais';
  if (/[\\/:*?"<>|\x00-\x1f]/.test(nome) || nome.startsWith('.')) return 'caracteres proibidos (\\ / : * ? " < > | ou ponto no início)';
  if (nome.indexOf('":') >= 0) return 'não pode conter a sequência aspas-dois-pontos';
  if (RESERVADO.test(nome)) return 'nome reservado do Windows';
  return '';
}

/* leitura de um arquivo dentro do projeto (sem sair da pasta) */
function caminhoNoProjeto(p, rel) {
  const partes = String(rel || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (!partes.length || partes.some(s => s === '..' || s.startsWith('.'))) throw new ErroMcp('caminho inválido (sem "..", sem arquivo oculto)');
  const f = path.join(p.dir, ...partes);
  const r = path.relative(p.dir, f);
  if (r.startsWith('..') || path.isAbsolute(r)) throw new ErroMcp('caminho fora do projeto');
  return f;
}

function urlsDaVista(base, nome) {
  if (!base) return null;
  const q = encodeURIComponent(nome);
  return { hub: base + '/', pcb: `${base}/pcbframe.html?p=${q}`, esquema: `${base}/schframe.html?p=${q}` };
}

/* o hub HTTP no ar: --hub, ou 127.0.0.1 nas portas de sempre. Devolve [{url, ok, mcp, mesmaRaiz}] */
async function sondaHub(ctx, ms) {
  const bases = ctx.hubUrl ? [ctx.hubUrl.replace(/\/+$/, '')] : ctx.portas.map(p => `http://127.0.0.1:${p}`);
  const out = await Promise.all(bases.map(async url => {
    const r = { url, ok: false };
    try {
      const resp = await fetch(url + '/api/index.json', { signal: AbortSignal.timeout(ms || 900) });
      r.ok = resp.ok;
      if (resp.ok) { const j = await resp.json(); r.projetos = (j.projects || []).length; }
    } catch (e) { r.erro = (e && e.name === 'TimeoutError') ? 'sem resposta' : 'fora do ar'; }
    if (r.ok) {
      try {
        const s = await fetch(url + '/api/mcp/status', { signal: AbortSignal.timeout(ms || 900) });
        if (s.ok) { const j = await s.json(); r.mcp = true; r.raiz = j.root; r.vistas = j.vistas;
                    r.mesmaRaiz = !!j.root && path.resolve(j.root).toLowerCase() === path.resolve(ctx.root).toLowerCase(); }
        else r.mcp = false;
      } catch (_) { r.mcp = false; }
    }
    return r;
  }));
  return out;
}
async function hubNoAr(ctx) {
  const l = await sondaHub(ctx);
  return l.find(x => x.ok && x.mesmaRaiz) || l.find(x => x.ok && x.mcp) || l.find(x => x.ok) || null;
}

function exists(f) { try { return fs.existsSync(f); } catch (_) { return false; } }

module.exports = { isNum, r4, PROJETO, chamaModulo, caixa, noRet, nomeDePastaOk, caminhoNoProjeto, urlsDaVista, sondaHub, hubNoAr, exists };
