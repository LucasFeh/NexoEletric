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

/* O app desktop aberto: %USERPROFILE%\.nexoeletric\session.json = {hub, root, pid, versao}, gravado
   pelo electron/main.js quando o hub sobe e apagado quando o app fecha (a mesma mecanica do
   ~/.nexocad/session.json do NexoCAD). null se nao existe ou se o processo ja morreu. */
const ARQ_SESSAO = () => process.env.NEXOELETRIC_SESSION || path.join(process.env.USERPROFILE || process.env.HOME || '', '.nexoeletric', 'session.json');
function sessaoDoApp() {
  try {
    const s = JSON.parse(fs.readFileSync(ARQ_SESSAO(), 'utf8'));
    if (!s || typeof s !== 'object') return null;
    if (s.pid) { try { process.kill(s.pid, 0); } catch (e) { if (e.code === 'ESRCH') return null; } }
    return s;
  } catch (_) { return null; }
}
/* a pasta de trabalho configurada no app (%APPDATA%\NexoEletric\settings.json » workspace) */
function workspaceDoApp() {
  const base = process.env.APPDATA || path.join(process.env.HOME || '', '.config');
  for (const nome of ['NexoEletric', 'EletricHUB', 'AltiumHub']) {
    try { const s = JSON.parse(fs.readFileSync(path.join(base, nome, 'settings.json'), 'utf8')); if (s && s.workspace) return s.workspace; } catch (_) { /* proximo */ }
  }
  return '';
}
/* A raiz do MCP, na ordem: --root (se for a pasta do hub), ELETRICHUB_ROOT, a do app aberto
   (session.json), a pasta de trabalho configurada no app, e a pasta acima deste script (o repo).
   Um --root que nao e pasta do hub (o C:\NexoEletric de um registro antigo, num PC cuja pasta e
   outra) nao derruba o servidor: cai no proximo, e o aviso diz o que foi ignorado.
   -> {root, origem, aviso} */
function resolveRaiz(pedida) {
  const cands = [];
  if (pedida) cands.push([pedida, '--root']);
  if (process.env.ELETRICHUB_ROOT) cands.push([process.env.ELETRICHUB_ROOT, 'ELETRICHUB_ROOT']);
  const s = sessaoDoApp();
  if (s && s.root) cands.push([s.root, 'app aberto (session.json)']);
  const w = workspaceDoApp();
  if (w) cands.push([w, 'pasta de trabalho do app (settings.json)']);
  cands.push([path.resolve(__dirname, '..', '..'), 'pasta do servidor']);
  const ruins = [];
  for (const [d, origem] of cands) {
    const abs = path.resolve(d);
    if (pareceHub(abs)) return { root: abs, origem, aviso: ruins.length ? `ignorado: ${ruins.join('; ')}` : '' };
    ruins.push(`${origem} ${abs} não é a pasta do hub`);
  }
  return { root: path.resolve(pedida || cands[0][0]), origem: 'nenhuma', aviso: ruins.join('; ') };
}

class Contexto {
  constructor(opts) {
    const o = opts || {};
    const r = resolveRaiz(o.root);
    this.root = r.root;
    this.origemRaiz = r.origem;
    this.avisoRaiz = r.aviso;
    if (!pareceHub(this.root))
      throw new Error(`nenhuma pasta do hub encontrada (${r.aviso}). Abra o NexoEletric uma vez ou use --root <pasta de trabalho>`);
    /* Projects/ pode morar fora da raiz (os testes usam uma copia temporaria; nunca os reais) */
    this.projetosDir = o.projetos ? path.resolve(o.projetos) : (process.env.ELETRICHUB_PROJETOS ? path.resolve(process.env.ELETRICHUB_PROJETOS) : path.join(this.root, 'Projects'));
    this._hubUrlFixo = o.hubUrl || process.env.ELETRICHUB_URL || '';
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
    /* os footprints como a tela os ve: uma biblioteca so (os de Libs/pcblib-hub.js -- criados no
       editor, pela IA ou vindos do NexoCAD -- na frente dos do Altium, HubFpLib.mescla) */
    const pcblibAltium = this.lib('pcblib.js', 'pcblib') || { footprints: [] };
    const pcblibHub = this.lib('pcblib-hub.js', 'pcblibHub') || null;
    const HF = pcblibHub ? this.modulo('hub-fplib.js') : null;
    const pcblib = HF && HF.mescla ? HF.mescla(pcblibAltium, pcblibHub) : pcblibAltium;
    const basicos = this.lib('almox-basicos.js', 'almoxBasicos');
    const especiais = this.lib('almox-especiais.js', 'almoxEspeciais');
    const renameMap = this.lib('rename-map.js', 'renameMap') || null;
    const libSubs = this.lib('lib-subs.js', 'libSubs') || null;
    const chave = [schlib, pcblibAltium, pcblibHub, basicos, especiais, renameMap, libSubs];
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
  /* As bibliotecas para UM esquema: as de sempre + os simbolos guardados no proprio schematic.js
     (`symbols`: os da folha do Altium, ou os que a IA criou com sym_salvar destino "projeto"). Como na
     vista (schframe.js » aplicaAcervos), so entram os nomes que nenhum acervo resolve, e valem
     tambem para as nets. */
  libsDe(sch) {
    const v = this.libs();
    const doc = sch && Array.isArray(sch.symbols) ? sch.symbols : null;
    if (!doc || !doc.length) return v;
    if (this._libsDoc && this._libsDoc.base === v && this._libsDoc.doc === doc) return this._libsDoc.v;
    const hc = this.hc;
    const extras = doc.filter(s => s && s.name && Array.isArray(s.parts) && !hc.symbolOf(v.schlib, s.name))
      .map(s => Object.assign({ partcount: s.parts.length }, s, { doDocumento: true }));
    const out = extras.length ? Object.assign({}, v, { schlib: Object.assign({}, v.schlib, { symbols: v.schlib.symbols.concat(extras) }) }) : v;
    this._libsDoc = { base: v, doc, v: out };
    return out;
  }
  /* o hub HTTP do app: --hub/ELETRICHUB_URL, senao o do app aberto (session.json) desta mesma
     pasta, senao '' (sondaHub procura nas portas de sempre) */
  get hubUrl() {
    if (this._hubUrlFixo) return this._hubUrlFixo;
    const s = sessaoDoApp();
    return s && s.hub && (!s.root || path.resolve(s.root).toLowerCase() === this.root.toLowerCase()) ? String(s.hub) : '';
  }
  set hubUrl(v) { this._hubUrlFixo = v || ''; }

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
  /* o motor com a biblioteca de footprints registrada (a do hub na frente da do Altium, como a vista
     PCB faz em pcbframe.js): sem isso o comp_add so acha footprint que ja esta na placa */
  pcbPronto() {
    const hc = this.hc;
    try { const L = this.libs(); if (L.pcblib && typeof hc.setPcbLib === 'function') hc.setPcbLib(L.pcblib); } catch (_) { /* sem Libs: vale o da placa */ }
    return hc;
  }
  /* a placa com as mudancas: {board, changes, model, eb} -- o mesmo motor da tela */
  placa(p, changes) {
    const hc = this.pcbPronto();
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
  /* a placa como a TELA mostra (pcbframe.js » comDespejo): a de placa() com os poligonos do hub
     (board.js » polygons + poly_add) despejados pelo hub-pcbpour.js, um a um na ordem; sai so o
     despejo velho DESSES poligonos (regiao poly com `de`) e o cobre que veio despejado do Altium
     sem poligono definido fica como veio. Sem isso o DRC, o ratsnest e a imagem nao veem o plano
     (GND "nao roteado", curto com o plano invisivel).
     despejo = {poligonos, regioes, avisos, ms, altium_sem_poligono:[ids]} ou null.
     altium_sem_poligono: regioes de polygon pour do Altium sem poligono no hub -- ficam como
     vieram (o hub nao as redespeja; region_del as apaga, 1.35.0). */
  placaDespejada(p, changes) {
    const r = this.placa(p, changes);
    const P = this.modulo('hub-pcbpour.js');
    const pols = (r.eb.polygons || []).filter(q => q && q.id && q.pour !== 'none' && Array.isArray(q.pts) && q.pts.length >= 3);
    if (!P || typeof P.despeja !== 'function' || !pols.length) return Object.assign(r, { despejo: null });
    const t0 = Date.now();
    const ids = new Set(pols.map(q => String(q.id)));
    let novas = [];
    const avisos = [];
    const ebR = this.comRegras(p, r.eb);
    const polR = new Map((ebR.polygons || []).map(q => [q && q.id, q]));
    for (const pol of pols.map(q => polR.get(q.id) || q).sort((a, b) => (a.ordem || 0) - (b.ordem || 0))) {
      const d = P.despeja(ebR, pol);
      const reg = (d && (d.regioes || d)) || [];
      if (Array.isArray(reg)) novas = novas.concat(reg);
      for (const a of (d && d.avisos) || []) avisos.push(a);
    }
    const velhas = (r.eb.regions || []).filter(g => g && g.poly && !(g.de != null && ids.has(String(g.de))));
    const eb = Object.assign({}, r.eb);
    eb.regions = (r.eb.regions || []).filter(g => !(g && g.poly && g.de != null && ids.has(String(g.de))))
      .concat(novas.map((g, i) => {
        const o = { id: 'q:' + g.de + ':' + i, layer: g.layer, net: g.net, points: g.pts || g.points, poly: true, de: g.de };
        if (g.holes && g.holes.length) o.holes = g.holes;
        return o;
      }));
    return Object.assign(r, { eb, ebSemDespejo: r.eb, despejo: { poligonos: pols.length, regioes: novas.length, avisos, ms: Date.now() - t0,
      altium_sem_poligono: velhas.map(g => g.id || '?') } });
  }
  /* a placa com a folga das regras (classes de net) posta nos poligonos, so para despejar
     (hub-pcbpour.js » comRegras, 1.36.0): o despejo do hub respeita "Fase x baixa tensao" etc. */
  comRegras(p, eb) {
    const P = this.modulo('hub-pcbpour.js');
    if (!P || typeof P.comRegras !== 'function' || !(eb.polygons || []).length) return eb;
    try {
      const R = require('./pcb-ops.js').regrasDoProjeto(this, p);   // aqui (e nao no topo): o pcb-ops requer este arquivo
      return R && R.conjunto ? P.comRegras(eb, R.conjunto) : eb;
    } catch (e) { this.log('regras do despejo: ' + (e && e.message || e)); return eb; }
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

module.exports = { Contexto, ErroMcp, pareceHub, resolveRaiz, sessaoDoApp, workspaceDoApp, ARQ_SESSAO };
