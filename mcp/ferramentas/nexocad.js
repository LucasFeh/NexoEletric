/* NexoEletric MCP - grupo "nexo": a integracao com o NexoCAD (contrato: docs/INTEGRACAO-NEXOCAD.md).

   A biblioteca compartilhada (o "BD") e do NexoCAD: aqui ela so e LIDA, direto do disco
   (DIELETRONS_BIBLIOTECA > ponteiro C:\Users\Public\Dieletrons\biblioteca.json > o padrao
   C:\Users\Public\Dieletrons\Biblioteca). Tudo o que grava -- editar um modelo, montar a placa,
   vincular um footprint -- e PEDIDO ao NexoCAD: pelo hub no ar (as rotas /api/nexo/*, que baixam os
   STEP do proprio hub, inclusive o 3D da PcbLib tirado sob demanda) ou, sem o hub, direto no /rpc
   do NexoCAD (session.json; abre o exe e espera ate 60 s), com os STEP lidos do disco. */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { ErroMcp } = require('../lib/contexto.js');
const { avaliaVar } = require('../lib/arquivo-linhas.js');
const { PROJETO, hubNoAr } = require('../lib/util.js');

const PADRAO_DIR = 'C:\\Users\\Public\\Dieletrons\\Biblioteca';
const PONTEIRO = 'C:\\Users\\Public\\Dieletrons\\biblioteca.json';
const CATEGORIA = 'Eletrônicos';
const semAcento = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const tem = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const lerJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch (_) { return null; } };

/* ---------- a biblioteca (so leitura) ---------- */
function raiz() {
  if (process.env.DIELETRONS_BIBLIOTECA) return path.resolve(process.env.DIELETRONS_BIBLIOTECA);
  const p = lerJson(process.env.DIELETRONS_PONTEIRO || PONTEIRO);
  if (p && typeof p.dir === 'string' && p.dir.trim()) return path.resolve(p.dir.trim());
  return PADRAO_DIR;
}
function indice() {
  const dir = raiz();
  const ind = lerJson(path.join(dir, 'biblioteca.json'));
  return { dir, existe: fs.existsSync(dir), ind: ind && typeof ind === 'object' ? ind : null };
}
const itensDe = ind => ((ind && ind.itens) || []).filter(i => i && i.id);
function arquivoItem(dir, it, tipo) {
  const rel = (it && it.arquivos && it.arquivos[tipo]) || (it ? `itens/${it.id}/${tipo === 'step' ? 'modelo.step' : tipo === 'thumb' ? 'thumb.png' : 'modelo.nexo'}` : '');
  if (!rel || /(^|[\\/])\.\.([\\/]|$)/.test(rel) || /:/.test(rel)) return '';
  const f = path.join(dir, ...rel.split(/[\\/]+/).filter(Boolean));
  const r = path.relative(dir, f);
  return r.startsWith('..') || path.isAbsolute(r) ? '' : f;
}
function resumo(dir, it) {
  const el = it.eletronico || null;
  const step = arquivoItem(dir, it, 'step');
  return { id: it.id, nome: it.nome, categoria: it.categoria, subcategoria: it.subcategoria || '', rev: it.rev, descricao: it.descricao || '',
           tags: it.tags || [], footprints: el ? (el.footprints || []) : [], mpn: el ? el.mpn || '' : '', substitui: it.substitui || [],
           bbox: it.bbox || null, step: step && fs.existsSync(step) ? step : '', atualizado: it.atualizado || '' };
}

/* ---------- o NexoCAD (cliente do /rpc) ---------- */
const caminhoSessao = () => process.env.NEXOCAD_SESSION || path.join(os.homedir(), '.nexocad', 'session.json');
function sessao() { const s = lerJson(caminhoSessao()); return s && s.port > 0 && s.token ? s : null; }
function achaExe() {
  if (process.env.NEXOCAD_NAO_ABRIR === '1') return '';      /* testes: nunca o exe instalado */
  const c = ['C:\\Program Files\\NexoCAD\\NexoCAD.exe'];
  if (process.env.LOCALAPPDATA) c.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'NexoCAD', 'NexoCAD.exe'));
  if (process.env.NEXOCAD_EXE) c.push(process.env.NEXOCAD_EXE);
  return c.find(f => { try { return fs.statSync(f).isFile(); } catch (_) { return false; } }) || '';
}
async function saude(s) {
  s = s || sessao();
  if (!s) return { aberto: false, versao: '' };
  try {
    const r = await fetch(`http://127.0.0.1:${s.port}/health`, { headers: { Authorization: 'Bearer ' + s.token }, signal: AbortSignal.timeout(1500) });
    if (!r.ok) return { aberto: false, versao: '' };
    let j = {}; try { j = await r.json(); } catch (_) { /* sem corpo */ }
    return { aberto: true, versao: String(j.versao || j.version || ''), s };
  } catch (_) { return { aberto: false, versao: '' }; }
}
async function garanteAberto() {
  let h = await saude();
  if (h.aberto) return h.s;
  const exe = achaExe();
  if (!exe) throw new ErroMcp('o NexoCAD não está aberto e o executável não foi encontrado (C:\\Program Files\\NexoCAD\\NexoCAD.exe, %LOCALAPPDATA%\\Programs\\NexoCAD ou NEXOCAD_EXE)');
  const p = spawn(exe, [], { cwd: path.dirname(exe), detached: true, stdio: 'ignore', windowsHide: false });
  p.unref();
  const fim = Date.now() + 60000;
  while (Date.now() < fim) {
    await new Promise(ok => setTimeout(ok, 500));
    h = await saude();
    if (h.aberto) return h.s;
  }
  throw new ErroMcp('o NexoCAD não respondeu em 60 s');
}
async function rpc(command, params, ms) {
  const s = await garanteAberto();
  let r, j = null;
  try {
    r = await fetch(`http://127.0.0.1:${s.port}/rpc`, { method: 'POST', signal: AbortSignal.timeout(ms || 300000),
      headers: { Authorization: 'Bearer ' + s.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, params: params || {}, source: 'eletrichub' }) });
    j = await r.json();
  } catch (e) { throw new ErroMcp('NexoCAD não respondeu (' + (e && e.message || e) + ')'); }
  if (!j || !j.ok) {
    const e = j && j.error;
    throw new ErroMcp('NexoCAD: ' + (typeof e === 'string' ? e : (e && e.message) || JSON.stringify(e) || ('HTTP ' + r.status)));
  }
  return j.result;
}

/* ---------- o hub no ar, com as rotas /api/nexo ---------- */
async function hubNexo(ctx) {
  const hub = await hubNoAr(ctx);
  if (!hub) return null;
  try {
    const r = await fetch(hub.url + '/api/nexo/revisao', { signal: AbortSignal.timeout(1500) });
    return r.ok ? hub : null;
  } catch (_) { return null; }
}
async function postaHub(hub, rota, corpo) {
  const r = await fetch(hub.url + '/api/nexo/' + rota, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo), signal: AbortSignal.timeout(600000) });
  let j = null; try { j = await r.json(); } catch (_) { /* sem corpo */ }
  if (!j) throw new ErroMcp(`o hub não respondeu /api/nexo/${rota} (HTTP ${r.status})`);
  if (!j.ok) throw new ErroMcp(j.error || `o hub recusou /api/nexo/${rota}`);
  return j;
}

/* ---------- os corpos 3D da placa (o que a vista 3D desenha) ---------- */
let cache3d = null;
async function lib3d(ctx) {
  const local = ctx.lib('pcblib-3d.js', 'pcblib3d');
  if (local) return local;
  if (cache3d && Date.now() - cache3d.quando < 5 * 60 * 1000) return cache3d.v;
  const hub = await hubNoAr(ctx);
  if (!hub) return null;
  try {
    const r = await fetch(hub.url + '/Libs/pcblib-3d.js', { signal: AbortSignal.timeout(60000) });
    if (!r.ok) return null;
    const v = avaliaVar(await r.text(), 'pcblib3d');
    cache3d = { quando: Date.now(), v };
    return v;
  } catch (_) { return null; }
}
async function corposDaPlaca(ctx, p, eb, board) {
  const M3 = ctx.exige('hub-pcb3d-modelo.js', 'HubPcb3dModelo');
  const HN = ctx.exige('hub-nexo.js', 'HubNexo');
  const HF = ctx.modulo('hub-fplib.js');
  const d3f = p.arq('board3d.js');
  const d3 = fs.existsSync(d3f) ? (ctx.lerVarCache(d3f, 'pcbmirror3d') || null) : null;
  const hub = ctx.lib('pcblib-hub.js', 'pcblibHub');
  const esp = d3 && d3.thickness > 0 ? d3.thickness : 1.6;
  const { ind } = indice();
  const corpos = M3.corpos(eb, d3, { pcblib3d: await lib3d(ctx), pcblib3dHub: hub && HF ? HF.lib3d(HF.normaliza(JSON.parse(JSON.stringify(hub)))) : null,
    base: `Projects/${p.nome}/`, baseLib: 'Libs/', thickness: esp, board, nexo: HN.resolvedorDe(ind), projeto: p.nome });
  return { corpos, esp };
}
/* a url do hub de um modelo -> o arquivo no disco (o caminho direto, sem o hub) */
function urlParaDisco(ctx, p, url) {
  const u = decodeURIComponent(String(url || '').replace(/^\//, '').replace(/\?.*$/, ''));
  const m = /^api\/nexo\/arquivo\/([^/]+)\/modelo\.step$/.exec(u);
  if (m) { const { dir, ind } = indice(); const it = itensDe(ind).find(i => i.id === m[1]); return it ? arquivoItem(dir, it, 'step') : ''; }
  const partes = u.split('/').filter(Boolean);
  if (!partes.length || partes.some(s => s === '..')) return '';
  if (partes[0] === 'Projects') return path.join(ctx.dirProjetos(), ...partes.slice(1));
  return path.join(ctx.root, ...partes);
}
const nomeSeguro = s => String(s || 'placa').replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').replace(/^[ .]+|[ .]+$/g, '').slice(0, 80) || 'placa';

module.exports = {
  grupo: 'nexo', ordem: 47, titulo: 'NexoCAD — a biblioteca 3D compartilhada e o CAD da casa',
  modulos: ['hub-nexo.js', 'hub-nexopacote.js', 'hub-pcb3d-modelo.js'],
  ferramentas: [
    {
      nome: 'nexo_estado', titulo: 'Estado do NexoCAD', leitura: true,
      descricao: 'Onde está a biblioteca compartilhada (a pasta, se existe, a revisão, quantos itens), se o NexoCAD está aberto (versão) e onde está o executável, e se o hub no ar tem as rotas /api/nexo. Use antes das outras ferramentas do grupo.',
      entrada: { type: 'object', properties: {} },
      executa: async (_a, ctx) => {
        const { dir, existe, ind } = indice();
        const h = await saude();
        const hub = await hubNexo(ctx).catch(() => null);
        return { ok: true, dir, existe, indice: !!ind, revisao: ind ? ind.revisao || 0 : 0, itens: itensDe(ind).length,
                 categorias: (ind && ind.categorias) || [], nexocad: { aberto: h.aberto, versao: h.versao, exe: achaExe(), sessao: caminhoSessao() },
                 hub: hub ? hub.url : null };
      },
    },
    {
      nome: 'nexo_biblioteca', titulo: 'Listar a biblioteca do NexoCAD', leitura: true,
      descricao: 'Lista/busca os itens da biblioteca compartilhada (lida do disco, só leitura). Padrão: a categoria Eletrônicos; categoria "*" = todas. texto busca no nome, descrição, tags, footprints, MPN e fabricante; id devolve um item com os caminhos absolutos. Cada item Eletrônicos diz os footprints do hub que ele veste (o vínculo) e as chaves de modelo que ele substitui.',
      entrada: { type: 'object', properties: {
        categoria: { type: 'string', description: 'Eletrônicos (padrão), Mecânicos, Fixadores, Caixas, Placas, Outros ou "*"' },
        texto: { type: 'string' }, id: { type: 'string' }, limite: { type: 'integer', minimum: 1, maximum: 500 } } },
      executa: async (a) => {
        const { dir, existe, ind } = indice();
        if (!ind) return { ok: true, dir, existe, itens: [], nota: existe ? 'a pasta existe mas não tem biblioteca.json (o NexoCAD cria ao gravar o primeiro item)' : 'a biblioteca não existe ainda' };
        if (a.id) {
          const it = itensDe(ind).find(i => i.id === a.id);
          if (!it) throw new ErroMcp(`item "${a.id}" não está na biblioteca`);
          return { ok: true, dir, item: Object.assign({}, it, { caminhos: { step: arquivoItem(dir, it, 'step'), nexo: arquivoItem(dir, it, 'nexo'), thumb: arquivoItem(dir, it, 'thumb') } }) };
        }
        let L = itensDe(ind);
        const cat = a.categoria || CATEGORIA;
        if (cat !== '*') L = L.filter(i => semAcento(i.categoria) === semAcento(cat));
        if (a.texto) {
          const t = semAcento(a.texto);
          L = L.filter(i => { const el = i.eletronico || {}; return [i.id, i.nome, i.descricao, i.subcategoria, (i.tags || []).join(' '), (el.footprints || []).join(' '), el.mpn, el.fabricante, el.encapsulamento].some(x => x && semAcento(x).includes(t)); });
        }
        return { ok: true, dir, revisao: ind.revisao || 0, total: L.length, itens: L.slice(0, a.limite || 50).map(i => resumo(dir, i)) };
      },
    },
    {
      nome: 'nexo_editar_modelo', titulo: 'Editar um modelo 3D no NexoCAD',
      descricao: 'Abre um corpo 3D no NexoCAD para editar, como o "Editar 3D no NexoCAD" da vista PCB. Diga {projeto, ref} (o corpo STEP que a vista 3D desenha para o componente), {footprint} (o corpo STEP do footprint na biblioteca do hub), {chave} (a chave do modelo: "3d-hub/<sha>.step", "3d/<checksum>.step", "projeto:<p>/<arquivo>") ou {id} (um item da biblioteca). Se algum item já substitui aquela chave, abre o item; senão o NexoCAD cria um item importando o STEP, vinculado ao footprint, e o abre. Sem STEP (footprint só com caixa), novo:true cria um item vazio vinculado ao footprint. Salvar no NexoCAD (Ctrl+S) grava na biblioteca e a vista 3D do hub troca o modelo sozinha.',
      entrada: { type: 'object', properties: { projeto: PROJETO, ref: { type: 'string' }, footprint: { type: 'string' }, chave: { type: 'string' }, id: { type: 'string' },
        novo: { type: 'boolean', description: 'sem STEP: cria um item vazio vinculado ao footprint' } } },
      executa: async (a, ctx) => {
        const HN = ctx.exige('hub-nexo.js', 'HubNexo');
        const { ind } = indice();
        const res = HN.resolvedorDe(ind);
        let alvo = null;
        if (a.id) alvo = { id: a.id };
        else if (a.projeto && a.ref) {
          const p = ctx.projeto(a.projeto);
          const { board, eb } = ctx.placa(p);
          const c = (eb.components || []).find(x => x && x.ref === a.ref);
          if (!c) throw new ErroMcp(`${a.ref} não está na placa de ${p.nome}`);
          const { corpos, esp } = await corposDaPlaca(ctx, p, eb, board);
          const b = corpos.find(x => x && x.owner === c.ref && x.kind === 'step' && (x.modelUrl || x.nexo));
          const geometria = HN.geometriaDeComp(c);
          if (b && !b.nexo && geometria) geometria.corpo = ctx.exige('hub-pcb3d-modelo.js', 'HubPcb3dModelo').matrizLocal(b.matrix, c, esp);
          if (b && b.nexo) alvo = { id: b.nexo };
          else if (b) alvo = { chave: b.modeloChave, url: '/' + b.modelUrl, nome: b.name || c.footprint + '.step', footprint: c.footprint || '', geometria };
          else if (a.novo) alvo = { novo: true, footprint: c.footprint || '', nome: c.footprint || c.ref, geometria };
          else throw new ErroMcp(`${c.ref} (${c.footprint}) não tem corpo STEP; passe novo:true para criar um item vazio vinculado ao footprint`);
        } else if (a.footprint || a.chave) {
          const HF = ctx.modulo('hub-fplib.js');
          const hub = HF ? HF.normaliza(JSON.parse(JSON.stringify(ctx.lib('pcblib-hub.js', 'pcblibHub') || {}))) : null;
          const alt = ctx.lib('pcblib.js', 'pcblib') || { footprints: [] };
          const fp = a.footprint ? ((HF && hub && HF.acha(hub, a.footprint)) || (alt.footprints || []).find(f => f && f.name === a.footprint) || null) : null;
          let chave = a.chave || '', nome = '', corpoFp = null;
          if (!chave && fp) {
            const b = (fp.bodies || []).find(x => x && x.kind === 'step' && x.model);
            corpoFp = b || null;
            const L3 = b && !(hub && tem(hub.models, b.model)) ? await lib3d(ctx) : null;
            const m = b ? ((hub && tem(hub.models, b.model) && hub.models[b.model]) || (L3 && tem(L3.models, b.model) && L3.models[b.model]) || null) : null;
            if (m && m.file) { chave = m.file; nome = m.name || b.name || ''; }
            if (!m && L3 === null && b) throw new ErroMcp('o corpo do footprint é da PcbLib e os 3D dela só vêm com o hub no ar');
          }
          const geometria = fp ? HN.geometriaDe(fp) : undefined;
          if (geometria && corpoFp && chave) geometria.corpo = ctx.exige('hub-pcb3d-modelo.js', 'HubPcb3dModelo').matrizCorpo(corpoFp.raw || {}, { side: corpoFp.side || 'top', thickness: 1.6 });
          const ja = chave ? (res.porChave(chave) || (/^nexo:/.test(chave) ? res.porId(chave.slice(5)) : null)) : null;
          if (ja) alvo = { id: ja.id };
          else if (chave) {
            const mp = /^projeto:([^/]+)\/(.+)$/.exec(chave);
            const url = mp ? `/Projects/${mp[1]}/${mp[2]}` : '/Libs/' + chave;
            alvo = { chave, url, nome: nome || chave.split('/').pop(), footprint: a.footprint || '', geometria };
          } else if (a.novo && a.footprint) alvo = { novo: true, footprint: a.footprint, nome: a.footprint, geometria };
          else throw new ErroMcp(a.footprint ? `o footprint "${a.footprint}" não tem corpo STEP; passe novo:true para criar um item vazio vinculado a ele` : 'informe chave, footprint, {projeto, ref} ou id');
        } else throw new ErroMcp('informe {projeto, ref}, footprint, chave ou id');

        if (alvo.geometria == null) delete alvo.geometria;
        const hubN = await hubNexo(ctx);
        if (hubN) { const j = await postaHub(hubN, 'editar', alvo); return { ok: true, via: 'hub', id: j.id, criado: j.criado, resultado: j.result }; }
        /* sem o hub: direto no NexoCAD, com o STEP do disco */
        if (alvo.id) return { ok: true, via: 'nexocad', resultado: await rpc('biblioteca_abrir', { id: alvo.id }), id: alvo.id };
        const params = { chave: alvo.chave || '', nome: alvo.nome || '', footprint: alvo.footprint || '' };
        if (alvo.geometria) params.geometria = alvo.geometria;
        if (alvo.novo) params.novo = true;
        else {
          const f = urlParaDisco(ctx, null, alvo.url);
          if (!f || !fs.existsSync(f)) throw new ErroMcp(`o STEP ${alvo.url} não está no disco (o 3D da PcbLib sai dela sob demanda): abra o NexoEletric e tente de novo`);
          params.step_path = f;
        }
        const r = await rpc('biblioteca_editar_modelo', params);
        return { ok: true, via: 'nexocad', id: r && r.id, criado: r && r.criado, resultado: r };
      },
    },
    {
      nome: 'nexo_enviar_placa', titulo: 'Enviar a placa ao NexoCAD', modulo: 'hub-nexopacote.js',
      descricao: 'Monta a placa no NexoCAD (montagem: a placa com contorno, recortes e furos, e um componente por corpo 3D), como Arquivo » Exportar » Placa para o NexoCAD da vista PCB. Usa a placa efetiva (board.js + changes.js) e os mesmos corpos 3D da vista 3D, com a biblioteca do NexoCAD por cima. O NexoCAD grava o resultado na categoria Placas (base para o pcb_caixa dele). vias:true inclui as vias nos furos.',
      entrada: { type: 'object', properties: { projeto: PROJETO, vias: { type: 'boolean' }, so_pacote: { type: 'boolean', description: 'só devolve o pacote (não envia)' } }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const NP = ctx.exige('hub-nexopacote.js', 'HubNexoPacote');
        const p = ctx.projeto(a.projeto);
        const { board, eb } = ctx.placa(p);
        const { corpos, esp } = await corposDaPlaca(ctx, p, eb, board);
        const { pacote, avisos } = NP.monta(eb, { projeto: p.nome, espessura: esp, corpos, vias: !!a.vias, laser: ctx.modulo('hub-laser.js') });
        if (a.so_pacote) return { ok: true, pacote, avisos };
        const hubN = await hubNexo(ctx);
        if (hubN) {
          const j = await postaHub(hubN, 'placa', { pacote });
          return { ok: true, via: 'hub', dir: j.dir, componentes: pacote.componentes.length, modelos: Object.keys(pacote.modelos).length, avisos: avisos.concat(j.avisos || []), resultado: j.result };
        }
        /* sem o hub: grava o pacote com os STEP do disco e chama o pcb_importar */
        const hora = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
        const dir = path.join(os.tmpdir(), 'eletrichub-nexo', `${nomeSeguro(p.nome)}-${hora}`);
        fs.mkdirSync(path.join(dir, 'modelos'), { recursive: true });
        const falhos = new Set();
        for (const [k, m] of Object.entries(pacote.modelos)) {
          const f = urlParaDisco(ctx, p, m.url);
          if (!f || !fs.existsSync(f)) { avisos.push(`${k}: STEP fora do disco (${m.url}); com o hub no ar ele vai`); falhos.add(k); delete pacote.modelos[k]; continue; }
          fs.copyFileSync(f, path.join(dir, ...m.arquivo.split('/')));
          delete m.url;
        }
        if (falhos.size) for (const c of pacote.componentes) c.corpos = c.corpos.filter(b => !(b.tipo === 'step' && falhos.has(b.modelo)));
        const arq = path.join(dir, 'placa.json');
        fs.writeFileSync(arq + '.tmp', JSON.stringify(pacote, null, 1)); fs.renameSync(arq + '.tmp', arq);
        const r = await rpc('pcb_importar', { path: arq });
        return { ok: true, via: 'nexocad', dir, componentes: pacote.componentes.length, modelos: Object.keys(pacote.modelos).length, avisos, resultado: r };
      },
    },
    {
      nome: 'nexo_vincular_footprint', titulo: 'Vincular item do NexoCAD a um footprint', destrutiva: true,
      descricao: 'Liga (ou, com remover:true, desliga) um item Eletrônicos da biblioteca do NexoCAD a um footprint do hub/Altium: o hub passa a desenhar o modelo do item no lugar dos corpos 3D de todo componente com esse footprint (na identidade do footprint). O hub não grava a biblioteca: o pedido vai ao NexoCAD (biblioteca_editar_item), que precisa estar instalado.',
      entrada: { type: 'object', properties: { item: { type: 'string', description: 'id do item (nexo_biblioteca)' }, footprint: { type: 'string' }, remover: { type: 'boolean' } }, required: ['item', 'footprint'] },
      executa: async (a) => {
        const { ind } = indice();
        const it = itensDe(ind).find(i => i.id === a.item);
        if (!it) throw new ErroMcp(`item "${a.item}" não está na biblioteca (nexo_biblioteca lista)`);
        if (semAcento(it.categoria) !== semAcento(CATEGORIA)) throw new ErroMcp(`"${it.nome}" é da categoria ${it.categoria}: só item Eletrônicos veste footprint`);
        const el = Object.assign({}, it.eletronico || {});
        const fps = (el.footprints || []).filter(f => f !== a.footprint);
        if (!a.remover) fps.push(a.footprint);
        el.footprints = fps;
        const r = await rpc('biblioteca_editar_item', { id: it.id, eletronico: el });
        return { ok: true, id: it.id, footprints: fps, resultado: r };
      },
    },
  ],
};
