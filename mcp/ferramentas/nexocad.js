/* NexoEletric MCP - grupo "nexo": o Nexo Hub (o banco da rede) e o NexoCAD.

   Desde a 1.9.0 a biblioteca compartilhada e o NEXO HUB (contrato: ..\nexohub\docs\CONTRATO.md; o
   lado do NexoEletric em docs/INTEGRACAO-NEXOCAD.md). A conexao: NEXOHUB_URL > o
   C:\Users\Public\NexoHub\conexao.json > http://127.0.0.1:47800 (lib/nexohub.js).
   - Ler a biblioteca: direto na API do Nexo Hub.
   - Publicar (a biblioteca 3D e as placas): lib/nexohub-sync.js, o mesmo codigo que o app desktop roda.
   - Editar um modelo / montar a placa: PEDIDO ao NexoCAD (/rpc do session.json; abre o exe e
     espera ate 60 s), sempre por um item do Nexo Hub: o modelo que ainda nao esta la e publicado antes. */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { ErroMcp } = require('../lib/contexto.js');
const { PROJETO, hubNoAr } = require('../lib/util.js');
const NH = require('../lib/nexohub.js');
const SY = require('../lib/nexohub-sync.js');

const CATEGORIA = 'Eletrônicos';
const semAcento = NH.semAcento;
const tem = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const lerJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch (_) { return null; } };
const cliente = () => NH.cliente();
function errNH(e) { return e instanceof ErroMcp ? e : new ErroMcp(String(e && e.message || e)); }

/* ---------- o Nexo Hub ---------- */
async function indice(c) {
  try { return await SY.indiceDoNexoHub(c || cliente()); }
  catch (e) { throw errNH(e); }
}
function resumo(it, url) {
  const el = it.eletronico || it.modelo || {};
  return { id: it.id, nome: it.nome, tipo: it.tipo, categoria: it.categoria, subcategoria: it.subcategoria || '', rev: it.rev,
           descricao: it.descricao || '', tags: it.tags || [], footprints: el.footprints || [], veste_footprint: !!it.eletronico,
           mpn: el.mpn || '', chaves: it.chaves || [], substitui: it.substitui || [], arquivos: Object.keys(it.arquivos || {}),
           bbox: it.bbox || null, atualizado: it.atualizado || '',
           step: it.arquivos && it.arquivos.step ? `${url}/api/v1/itens/${encodeURIComponent(it.id)}/arquivo/step` : '' };
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

/* ---------- o hub no ar (o 3D da PcbLib sai dele sob demanda) ---------- */
async function urlDoHub(ctx) { const h = await hubNoAr(ctx).catch(() => null); return h ? h.url : ''; }
async function lib3d(ctx) { return SY.lib3dDe(ctx, await urlDoHub(ctx)); }

/* o item do Nexo Hub para uma chave de modelo (publica o modelo se faltar) */
async function itemDaChave(ctx, c, chave, nome, footprint) {
  const hubUrl = await urlDoHub(ctx);
  const origem = /^projeto:/.test(chave) ? 'projeto' : /^3d-hub\//.test(chave) ? 'pcblib-hub' : /^3d\//.test(chave) ? 'pcblib-3d' : 'nexoeletric';
  const ler = m => SY.lerModelo(m.file, { root: ctx.root, projetosDir: ctx.dirProjetos(), hubUrl });
  try {
    return await SY.garanteModelo(c, { file: chave, nome: nome || chave.split('/').pop(), origem, footprints: footprint ? [footprint] : [] }, ler,
      `importado do NexoEletric (${origem}, editar no NexoCAD)`);
  } catch (e) { throw errNH(e); }
}

module.exports = {
  grupo: 'nexo', ordem: 47, titulo: 'Nexo Hub e NexoCAD — a biblioteca 3D e as placas no banco da rede, e o CAD da casa',
  modulos: ['hub-nexo.js', 'hub-nexopacote.js', 'hub-pcb3d-modelo.js'],
  ferramentas: [
    {
      nome: 'nexo_estado', titulo: 'Estado do Nexo Hub e do NexoCAD', leitura: true,
      descricao: 'O Nexo Hub (URL, se está no ar, versão, revisão = seq do último evento, quantos itens) e o NexoCAD (aberto, versão, onde está o executável). Use antes das outras ferramentas do grupo.',
      entrada: { type: 'object', properties: {} },
      executa: async (_a, ctx) => {
        const c = cliente();
        let nh = { url: c.url, online: false };
        try {
          const s = await c.saude();
          const L = await c.itens({ limite: 1 });
          nh = { url: c.url, online: true, versao: s.versao || '', revisao: s.revisao || 0, itens: L.total || 0, dados: s.dados || '' };
        } catch (e) { nh.erro = e.message; }
        const h = await saude();
        return { ok: true, nexohub: nh, nexocad: { aberto: h.aberto, versao: h.versao, exe: achaExe(), sessao: caminhoSessao() }, hub: (await urlDoHub(ctx)) || null };
      },
    },
    {
      nome: 'nexo_biblioteca', titulo: 'Listar a biblioteca do Nexo Hub', leitura: true,
      descricao: 'Lista/busca os itens do Nexo Hub no formato do NexoEletric. Padrão: a categoria Eletrônicos (inclui os Modelos 3D da PcbLib); categoria "*" = todas, ou o nome/id (Mecânicos, placas, eletronicos/modelos-3d). texto busca no nome, descrição, tags, footprints, chaves e MPN; id devolve o item completo (revisões, vínculos). Cada item diz as chaves de modelo do hub que ele representa (nexoeletric-modelo), as que ele SUBSTITUI no 3D (só a partir da rev 2, editado no NexoCAD) e, num item componente, os footprints que ele veste.',
      entrada: { type: 'object', properties: {
        categoria: { type: 'string', description: 'Eletrônicos (padrão), Mecânicos, Fixadores, Caixas, Placas, Outros, um id (eletronicos/modelos-3d) ou "*"' },
        texto: { type: 'string' }, id: { type: 'string' }, limite: { type: 'integer', minimum: 1, maximum: 500 } } },
      executa: async (a) => {
        const c = cliente();
        if (a.id) {
          let it;
          try { it = await c.item(a.id); } catch (e) { throw errNH(e); }
          let revisoes = null;
          try { const r = await c.pede('GET', `/api/v1/itens/${encodeURIComponent(a.id)}/revisoes`); revisoes = r.revisoes || r; } catch (_) { /* opcional */ }
          return { ok: true, nexohub: c.url, item: Object.assign({}, NH.paraItem(it, await c.categorias().catch(() => [])), { atributos: it.atributos, vinculos: it.vinculos || [], arquivos_nexohub: it.arquivos || {} }), revisoes };
        }
        const ind = await indice(c);
        let L = ind.itens;
        const cat = a.categoria || CATEGORIA;
        if (cat !== '*') L = L.filter(i => semAcento(i.categoria) === semAcento(cat) || semAcento(i.categoria_id).startsWith(semAcento(cat)));
        if (a.texto) {
          const t = semAcento(a.texto);
          L = L.filter(i => { const el = i.eletronico || i.modelo || {}; return [i.id, i.nome, i.descricao, i.subcategoria, (i.tags || []).join(' '), (el.footprints || []).join(' '), (i.chaves || []).join(' '), el.mpn, el.fabricante].some(x => x && semAcento(x).includes(t)); });
        }
        return { ok: true, nexohub: c.url, revisao: ind.revisao, total: L.length, itens: L.slice(0, a.limite || 50).map(i => resumo(i, c.url)) };
      },
    },
    {
      nome: 'nexo_sincronizar', titulo: 'Sincronizar com o Nexo Hub', destrutiva: false,
      descricao: 'Primeiro traz os componentes do NexoCAD para a biblioteca de footprints (como nexo_componentes). Depois publica no Nexo Hub o que o NexoEletric tem: a biblioteca 3D (cada modelo de Libs/pcblib-hub.js e da PcbLib da casa vira um item modelo3d, revisão 1 com o STEP) e as placas (cada projeto com board.js vira um item placa com o pacote eletrichub-placa-v1). É o mesmo que o app desktop faz sozinho ao abrir. Idempotente: só sobe o que falta, nunca cria revisão de um modelo que já existe (as revisões 2+ são do NexoCAD) e só cria revisão de placa quando o pacote mudou. modelos:false pula a biblioteca; placas:false pula as placas, ou uma lista de projetos.',
      entrada: { type: 'object', properties: { modelos: { type: 'boolean' }, placas: { oneOf: [{ type: 'boolean' }, { type: 'array', items: { type: 'string' } }] } } },
      executa: async (a, ctx) => {
        const logs = [];
        try {
          const r = await SY.sincroniza({ ctx, cliente: cliente(), hubUrl: await urlDoHub(ctx), modelos: a.modelos !== false,
            placas: Array.isArray(a.placas) ? a.placas.map(n => ctx.projeto(n).nome) : a.placas !== false, log: (n, m) => logs.push(m) });
          return { ok: true, resumo: r, log: logs.slice(-20) };
        } catch (e) { throw errNH(e); }
      },
    },
    {
      nome: 'nexo_editar_modelo', titulo: 'Editar um modelo 3D no NexoCAD',
      descricao: 'Abre um corpo 3D no NexoCAD para editar, como o "Editar 3D no NexoCAD" da vista PCB, sempre por um item do Nexo Hub. Diga {projeto, ref} (o corpo STEP que a vista 3D desenha para o componente), {footprint} (o corpo STEP do footprint na biblioteca do hub), {chave} (a chave do modelo: "3d-hub/<sha>.step", "3d/<checksum>.step", "projeto:<p>/<arquivo>") ou {id} (um item do Nexo Hub). A chave que ainda não está no Nexo Hub é publicada antes (item modelo3d, revisão 1 com o STEP). O NexoCAD recebe o id do item, a geometria dos pads (esboço de referência) e a matriz do corpo. Sem STEP (footprint só com caixa), novo:true cria um item vazio vinculado ao footprint. Salvar no NexoCAD (Ctrl+S) cria a revisão seguinte e a vista 3D do hub troca o modelo sozinha.',
      entrada: { type: 'object', properties: { projeto: PROJETO, ref: { type: 'string' }, footprint: { type: 'string' }, chave: { type: 'string' }, id: { type: 'string' },
        novo: { type: 'boolean', description: 'sem STEP: cria um item vazio vinculado ao footprint' } } },
      executa: async (a, ctx) => {
        const HN = ctx.exige('hub-nexo.js', 'HubNexo');
        const M3 = () => ctx.exige('hub-pcb3d-modelo.js', 'HubPcb3dModelo');
        const c = cliente();
        let alvo = null;
        if (a.id) alvo = { id: a.id };
        else if (a.projeto && a.ref) {
          const p = ctx.projeto(a.projeto);
          const { board, eb } = ctx.placa(p);
          const comp = (eb.components || []).find(x => x && x.ref === a.ref);
          if (!comp) throw new ErroMcp(`${a.ref} não está na placa de ${p.nome}`);
          const { corpos, esp } = SY.corposDaPlaca(ctx, p, eb, board, { lib3d: await lib3d(ctx), indice: await indice(c) });
          const b = corpos.find(x => x && x.owner === comp.ref && x.kind === 'step' && (x.modelUrl || x.nexo));
          const geometria = HN.geometriaDeComp(comp);
          if (b && !b.nexo && geometria) geometria.corpo = M3().matrizLocal(b.matrix, comp, esp);
          if (b && b.nexo) alvo = { id: b.nexo };
          else if (b) alvo = { chave: b.modeloChave, nome: b.name || comp.footprint + '.step', footprint: comp.footprint || '', geometria };
          else if (a.novo) alvo = { novo: true, footprint: comp.footprint || '', nome: comp.footprint || comp.ref, geometria };
          else throw new ErroMcp(`${comp.ref} (${comp.footprint}) não tem corpo STEP; passe novo:true para criar um item vazio vinculado ao footprint`);
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
          if (!chave && fp && !(fp.bodies || []).some(x => x && x.kind === 'step')) {
            /* footprint do Altium: os corpos 3D estao na PcbLib 3D */
            const L3 = await lib3d(ctx);
            const f3 = L3 && tem(L3.footprints, a.footprint) ? L3.footprints[a.footprint] : null;
            const b = f3 && (f3.bodies || []).find(x => x && x.kind === 'step' && tem(L3.models, x.model));
            if (b) { chave = L3.models[b.model].file; nome = L3.models[b.model].name || ''; corpoFp = b; }
          }
          const geometria = fp ? HN.geometriaDe(fp) : undefined;
          if (geometria && corpoFp && chave) geometria.corpo = M3().matrizCorpo(corpoFp.raw || {}, { side: corpoFp.side || 'top', thickness: 1.6 });
          if (/^nexo:/.test(chave)) alvo = { id: chave.slice(5).replace(/@.*$/, '') };
          else if (chave) alvo = { chave, nome: nome || chave.split('/').pop(), footprint: a.footprint || '', geometria };
          else if (a.novo && a.footprint) alvo = { novo: true, footprint: a.footprint, nome: a.footprint, geometria };
          else throw new ErroMcp(a.footprint ? `o footprint "${a.footprint}" não tem corpo STEP; passe novo:true para criar um item vazio vinculado a ele` : 'informe chave, footprint, {projeto, ref} ou id');
        } else throw new ErroMcp('informe {projeto, ref}, footprint, chave ou id');

        if (alvo.id) return { ok: true, id: alvo.id, resultado: await rpc('biblioteca_abrir', { id: alvo.id }) };
        const params = { nome: alvo.nome || '', footprint: alvo.footprint || '' };
        if (alvo.geometria) params.geometria = alvo.geometria;
        if (alvo.novo) {
          params.novo = true;
          const r = await rpc('biblioteca_editar_modelo', params);
          return { ok: true, id: r && r.id, criado: r && r.criado, resultado: r };
        }
        const g = await itemDaChave(ctx, c, alvo.chave, alvo.nome, alvo.footprint);
        Object.assign(params, { id: g.id, chave: alvo.chave });
        const r = await rpc('biblioteca_editar_modelo', params);
        return { ok: true, id: g.id, rev: g.rev, publicado: g.criado || g.enviado, resultado: r };
      },
    },
    {
      nome: 'nexo_enviar_placa', titulo: 'Enviar a placa ao NexoCAD', modulo: 'hub-nexopacote.js',
      descricao: 'Publica a placa no Nexo Hub (item placa do projeto, revisão nova só se o pacote mudou; os modelos 3D apontam itens do Nexo Hub) e pede ao NexoCAD para montá-la (pcb_importar {item}): a placa com contorno, recortes e furos, e um componente por corpo 3D. Usa a placa efetiva (board.js + changes.js) e os mesmos corpos 3D da vista 3D. vias:true inclui as vias nos furos. so_publicar:true só publica (não abre o NexoCAD); so_pacote:true só devolve o pacote montado.',
      entrada: { type: 'object', properties: { projeto: PROJETO, vias: { type: 'boolean' }, so_publicar: { type: 'boolean' }, so_pacote: { type: 'boolean', description: 'só devolve o pacote (não publica nem envia)' } }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const c = cliente();
        if (a.so_pacote) {
          const NP = ctx.exige('hub-nexopacote.js', 'HubNexoPacote');
          const { board, eb } = ctx.placa(p);
          let ind = null; try { ind = await indice(c); } catch (_) { /* sem Nexo Hub: as fontes de sempre */ }
          const { corpos, esp } = SY.corposDaPlaca(ctx, p, eb, board, { lib3d: await lib3d(ctx), indice: ind });
          const { pacote, avisos } = NP.monta(eb, { projeto: p.nome, espessura: esp, corpos, vias: !!a.vias, laser: ctx.modulo('hub-laser.js') });
          return { ok: true, pacote, avisos };
        }
        let pub;
        try { pub = await SY.publicaPlaca({ ctx, cliente: c, projeto: p, hubUrl: await urlDoHub(ctx), vias: !!a.vias, nota: 'placa do NexoEletric (MCP)' }); }
        catch (e) { throw errNH(e); }
        const out = { ok: true, item: pub.item, rev: pub.rev, mudou: pub.mudou, componentes: pub.pacote.componentes.length, modelos: Object.keys(pub.pacote.modelos).length, avisos: pub.avisos };
        if (a.so_publicar) return out;
        out.resultado = await rpc('pcb_importar', { item: pub.item });
        return out;
      },
    },
    {
      nome: 'nexo_componentes', titulo: 'Trazer os componentes do NexoCAD para a biblioteca de footprints', destrutiva: true,
      descricao: 'Uma biblioteca só: cada item componente do Nexo Hub (criado/editado no NexoCAD) com footprints (atributos.footprints) entra na biblioteca de footprints do NexoEletric como o corpo 3D desses footprints (nexo:<id>, na identidade, como o "Adicionar componente 3D" do editor). Footprint que só existe no Altium entra como cópia dele. O app desktop faz isso sozinho a cada minuto; aqui é na hora. Resposta: adicionados, semFootprint (o footprint não existe: crie com fp_pacote/fp_salvar e rode de novo) e conflitos (o footprint já tem o corpo de outro item: troque com nexo_vincular_footprint remover no outro). item = só esse.',
      entrada: { type: 'object', properties: { item: { type: 'string', description: 'só este item (id); vazio = todos os componentes' } } },
      executa: async (a, ctx) => {
        const c = cliente();
        try {
          const itens = a.item ? [await c.item(a.item)] : undefined;
          return Object.assign({ ok: true }, await SY.trazComponentes({ ctx, cliente: c, itens }));
        } catch (e) { throw errNH(e); }
      },
    },
    {
      nome: 'nexo_vincular_footprint', titulo: 'Vincular item do Nexo Hub a um footprint', destrutiva: true,
      descricao: 'Liga (ou, com remover:true, desliga) um item do Nexo Hub a um footprint do hub/Altium: atributos.footprints + o vínculo "footprint". Num item componente, o hub passa a desenhar o modelo do item no lugar dos corpos 3D de todo componente com esse footprint (na identidade do footprint); num modelo3d o vínculo só registra quem usa o corpo (o 3D segue pela chave).',
      entrada: { type: 'object', properties: { item: { type: 'string', description: 'id do item (nexo_biblioteca)' }, footprint: { type: 'string' }, remover: { type: 'boolean' } }, required: ['item', 'footprint'] },
      executa: async (a, ctx) => {
        const c = cliente();
        let it;
        try { it = await c.item(a.item); } catch (e) { throw errNH(e); }
        const fps = ((it.atributos || {}).footprints || []).map(String).filter(f => f !== a.footprint);
        if (!a.remover) fps.push(a.footprint);
        try {
          await c.alteraItem(it.id, { atributos: { footprints: fps } });
          if (!a.remover) await c.vincula({ de_item: it.id, relacao: 'footprint', para_ref: a.footprint });
          else for (const v of (it.vinculos || [])) if (v && v.relacao === 'footprint' && v.para_ref === a.footprint && v.id != null) await c.pede('DELETE', '/api/v1/vinculos/' + v.id);
        } catch (e) { throw errNH(e); }
        /* uma biblioteca so: o componente entra (ou sai) do footprint na biblioteca de footprints agora */
        let biblioteca = null;
        if (it.tipo === 'componente') {
          if (a.remover) biblioteca = { tirado: SY.tiraComponente(ctx, it.id, a.footprint) };
          else biblioteca = await SY.trazComponentes({ ctx, cliente: c, itens: [Object.assign({}, it, { atributos: Object.assign({}, it.atributos || {}, { footprints: fps }) })], ferramenta: 'nexo_vincular_footprint' });
        }
        return { ok: true, id: it.id, tipo: it.tipo, footprints: fps, biblioteca,
                 nota: it.tipo === 'componente' ? (a.remover ? 'o corpo do item saiu do footprint' : 'o item está na biblioteca de footprints, como o 3D desses footprints') : 'item ' + it.tipo + ': o vínculo é registrado, mas só item componente veste o footprint inteiro no 3D' };
      },
    },
  ],
};
