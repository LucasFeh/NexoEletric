/* NexoEletric MCP - contexto.js
   O que toda ferramenta precisa: a raiz do hub (o repo, ou a pasta de trabalho do app desktop,
   C:\NexoEletric), os modulos do hub carregados em Node (hub-core.js e companhia), as bibliotecas
   espelhadas (so LEITURA: Libs/ e do hub, do almoxarifado e do Altium -- o MCP nunca grava la),
   os arquivos de cada projeto e a pilha de desfazer da sessao.

   Modulo que ainda nao existe (hub-pcbdrc.js, hub-pcbpour.js... estao sendo escritos) NAO e
   erro de carga: `modulo()` devolve null e a ferramenta responde "modulo ausente". Cada chamada
   confere o arquivo de novo (mtime), entao o modulo que aparecer no meio da sessao passa a valer
   sem reiniciar o servidor. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { ArquivoLinhas, lerVar, gravaAtomico } = require('./arquivo-linhas.js');

class ErroMcp extends Error {
  constructor(msg, extra) { super(msg); this.extra = extra || null; }
}

/* a raiz e valida se tem a cara do hub: hub-core.js ao lado de Projects/ (ou ao menos Libs/) */
function pareceHub(d) {
  try { return fs.existsSync(path.join(d, 'hub-core.js')) && (fs.existsSync(path.join(d, 'Projects')) || fs.existsSync(path.join(d, 'Libs'))); }
  catch (_) { return false; }
}

class Contexto {
  constructor(opts) {
    const o = opts || {};
    const padrao = path.resolve(__dirname, '..', '..');
    this.root = path.resolve(o.root || process.env.ELETRICHUB_ROOT || padrao);
    if (!pareceHub(this.root))
      throw new Error(`"${this.root}" não parece a pasta do hub (falta hub-core.js e Projects/ ou Libs/). Use --root <pasta do hub>, ex.: C:\\NexoEletric`);
    /* Projects/ pode morar fora da raiz (os testes usam uma copia temporaria; nunca os reais) */
    this.projetosDir = o.projetos ? path.resolve(o.projetos) : (process.env.ELETRICHUB_PROJETOS ? path.resolve(process.env.ELETRICHUB_PROJETOS) : path.join(this.root, 'Projects'));
    this.hubUrl = o.hubUrl || process.env.ELETRICHUB_URL || '';
    this.portas = o.portas || [8200, 8000, 8100, 8001];
    this._mods = new Map();
    this._cache = new Map();
    this.desfazer = new Map();       // arquivo -> [{antes, depois, quando, ferramenta}]
    this.log = o.log || (() => {});
  }

  /* ---------------- modulos do hub ---------------- */
  /* require com recarga por mtime; null se o arquivo nao existe (ou nao carrega: o erro fica em
     `erroModulo(arquivo)` para a ferramenta contar o que houve) */
  modulo(arquivo) {
    const f = path.join(this.root, arquivo);
    let st;
    try { st = fs.statSync(f); } catch (_) { this._mods.delete(arquivo); return null; }
    const c = this._mods.get(arquivo);
    if (c && c.mtime === st.mtimeMs) return c.mod;
    try {
      delete require.cache[require.resolve(f)];
      const mod = require(f);
      const ok = mod && (typeof mod === 'object' || typeof mod === 'function') && Object.keys(mod).length ? mod : null;
      this._mods.set(arquivo, { mtime: st.mtimeMs, mod: ok, erro: ok ? null : 'o arquivo não exporta nada em Node (falta o module.exports do UMD)' });
      return ok;
    } catch (e) {
      this._mods.set(arquivo, { mtime: st.mtimeMs, mod: null, erro: String(e && e.message || e) });
      return null;
    }
  }
  erroModulo(arquivo) { const c = this._mods.get(arquivo); return c ? c.erro : null; }
  /* o modulo ou ErroMcp "modulo ausente" com a explicacao */
  exige(arquivo, global) {
    const m = this.modulo(arquivo);
    if (m) return m;
    const e = this.erroModulo(arquivo);
    throw new ErroMcp(e
      ? `módulo ${arquivo} (${global}) existe mas não carregou em Node: ${e}`
      : `módulo ausente: ${arquivo} (${global}) ainda não está nesta instalação do hub. Esta ferramenta passa a funcionar sozinha quando o arquivo chegar.`,
      { modulo: arquivo, global, ausente: !e });
  }
  get hc() { return this.exige('hub-core.js', 'HubCore'); }

  /* ---------------- leitura com cache por mtime ---------------- */
  lerVarCache(abs, nome) {
    let st;
    try { st = fs.statSync(abs); } catch (_) { return undefined; }
    const k = abs + '|' + (nome || '');
    const c = this._cache.get(k);
    if (c && c.mtime === st.mtimeMs && c.size === st.size) return c.v;
    const v = lerVar(abs, nome);
    this._cache.set(k, { mtime: st.mtimeMs, size: st.size, v });
    return v;
  }
  lib(nomeArq, varNome) { return this.lerVarCache(path.join(this.root, 'Libs', nomeArq), varNome); }

  /* As bibliotecas como a vista Esquema as monta (schframe.js » montaAcervos): a SchLib do
     Altium + os acervos do almoxarifado, com cada VALOR do almoxarifado virando um simbolo que
     reaproveita o desenho da familia. So leitura. */
  libs() {
    const schlib = this.lib('schlib.js', 'schlib') || { symbols: [] };
    const pcblib = this.lib('pcblib.js', 'pcblib') || { footprints: [] };
    const basicos = this.lib('almox-basicos.js', 'almoxBasicos');
    const especiais = this.lib('almox-especiais.js', 'almoxEspeciais');
    const renameMap = this.lib('rename-map.js', 'renameMap') || null;
    const libSubs = this.lib('lib-subs.js', 'libSubs') || null;
    const chave = [schlib, pcblib, basicos, especiais, renameMap, libSubs];
    if (this._libs && this._libs.chave.every((v, i) => v === chave[i])) { this._aplicaTabelas(); return this._libs.v; }
    const acervos = [{ id: 'altium', titulo: 'Biblioteca do Altium', g: schlib, almox: false },
                     { id: 'almox-basicos', titulo: 'Almoxarifado — Básicos', g: basicos, almox: true },
                     { id: 'almox-especiais', titulo: 'Almoxarifado — Especiais', g: especiais, almox: true }]
      .filter(a => a.g && Array.isArray(a.g.symbols) && a.g.symbols.length);
    const symbols = [], acervoDe = new Map();
    for (const a of acervos) for (const s of a.g.symbols) {
      if (!s || acervoDe.has(s.name)) continue;
      acervoDe.set(s.name, a.id); symbols.push(s);
    }
    for (const a of acervos) {
      if (!a.almox) continue;
      for (const s of a.g.symbols) for (const v of (s.valores || [])) {
        if (!v || !v.altium || acervoDe.has(v.altium)) continue;
        const partes = (v.parts || s.parts) || [];
        symbols.push({ name: v.altium, description: (v.itens && v.itens[0] && v.itens[0].nome) || v.label,
          designator: s.designator, familia: s.familia, partcount: partes.length || 1, parts: partes,
          footprints: v.footprint ? [{ name: v.footprint, current: true, incurrentlib: true }] : (s.footprints || []),
          almoxValor: true, familiaNome: s.name });
        acervoDe.set(v.altium, a.id);
      }
    }
    const slib = { format: schlib.format, symbols };
    const v = { schlib: slib, schlibAltium: schlib, pcblib, renameMap, libSubs, acervoDe,
                acervos: acervos.map(a => ({ id: a.id, titulo: a.titulo, simbolos: a.g.symbols.length })) };
    this._libs = { chave, v };
    this._aplicaTabelas();
    return v;
  }
  _aplicaTabelas() {
    const v = this._libs && this._libs.v;
    try { this.hc.setLibTables(v ? v.renameMap : null, v ? v.libSubs : null); } catch (_) { /* hub-core velho */ }
  }
  symbolsLib() { return this.lib('symbols-lib.js', 'symbolsLib') || { symbols: [] }; }

  /* ---------------- projetos ---------------- */
  dirProjetos() { return this.projetosDir; }
  listaProjetos() {
    try {
      return fs.readdirSync(this.dirProjetos(), { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name).sort((a, b) => a.localeCompare(b));
    } catch (_) { return []; }
  }
  /* O nome tem de ser o de uma pasta que EXISTE (o cuidado do _gerber_projeto do hubserver):
     nunca se monta caminho com o que veio de fora. Aceita caixa/acento diferentes se o casamento
     for unico, para a IA nao tropecar em "LM555 astavel". */
  projeto(nome) {
    if (typeof nome !== 'string' || !nome.trim()) throw new ErroMcp('informe "projeto" (o nome da pasta em Projects/; projeto_listar mostra os nomes)');
    const todos = this.listaProjetos();
    let achou = todos.find(n => n === nome);
    if (!achou) {
      const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
      const c = todos.filter(n => norm(n) === norm(nome));
      if (c.length === 1) achou = c[0];
    }
    if (!achou) throw new ErroMcp(`projeto "${nome}" não encontrado em Projects/. Existem: ${todos.join(' | ')}`);
    const dir = path.join(this.dirProjetos(), achou);
    return { nome: achou, dir, arq: f => path.join(dir, f) };
  }
  board(p) {
    const b = this.lerVarCache(p.arq('board.js'), 'pcbmirror');
    if (b === undefined) {
      const alt = this.lerVarCache(p.arq('board.js'));
      if (alt) return alt;
      throw new ErroMcp(`o projeto "${p.nome}" ainda não tem board.js (placa). Rode o ExportPcb no Altium, importe o .PcbDoc (tools/pcbdoc/pcbdoc2board.py) ou crie uma placa nova (projeto_criar com placa, quando o hub-pcbnova.js existir).`);
    }
    return b;
  }
  temBoard(p) { return fs.existsSync(p.arq('board.js')); }
  changes(p) { return ArquivoLinhas.abrir('changes', p.arq('changes.js')).itens; }
  /* a placa com as mudancas: {board, changes, model, eb} -- o mesmo motor da tela */
  placa(p, changes) {
    const hc = this.hc;
    const board = this.board(p);
    const ch = changes || this.changes(p);
    const model = hc.applyPcbChanges(board, ch);
    let eb = hc.effectiveBoard(board, model);
    /* como a vista PCB (pcbframe.js » recalcula): teardrop orfao sai e o do mesmo par e refeito,
       para a tela, o Gerber e o que a IA consulta serem a mesma placa */
    const T = this.modulo('hub-pcbteardrop.js');
    if (T && typeof T.refaz === 'function') {
      try { const r = T.refaz(eb, board); if (r && r.eb && ((r.removidos || []).length || (r.gerados || []).length)) eb = r.eb; }
      catch (e) { this.log('teardrops: ' + (e && e.message || e)); }
    }
    return { board, changes: ch, model, eb };
  }
  schematic(p) {
    const s = this.lerVarCache(p.arq('schematic.js'), 'schematic');
    if (s === undefined) throw new ErroMcp(`o projeto "${p.nome}" não tem schematic.js`);
    return s;
  }

  /* ---------------- gravacao com desfazer ---------------- */
  grava(abs, texto, ferramenta) {
    const antes = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    if (antes === texto) return false;
    gravaAtomico(abs, texto);
    const pilha = this.desfazer.get(abs) || [];
    pilha.push({ antes, depois: texto, quando: new Date().toISOString(), ferramenta: ferramenta || '' });
    if (pilha.length > 50) pilha.shift();
    this.desfazer.set(abs, pilha);
    this._cache.forEach((_v, k) => { if (k.startsWith(abs + '|')) this._cache.delete(k); });
    return true;
  }
  rel(abs) { return path.relative(this.root, abs).split(path.sep).join('/'); }
}

module.exports = { Contexto, ErroMcp, pareceHub };
