/* EletricHUB MCP - grupo "footprint": o editor de footprint do hub (hub-fpeditor.js) para a IA.

   Le os footprints das duas bibliotecas -- a do Altium (Libs/pcblib.js, so leitura, com os corpos 3D
   de Libs/pcblib-3d.js) e a do hub (Libs/pcblib-hub.js) -- e GRAVA so na do hub, pelo mesmo
   HubFpLib (valida, bbox, serializa) que o editor usa: o footprint do hub com o nome de um do Altium
   passa na frente dele, e a PcbLib do Altium nao muda. O assistente de pacote e o hub-fppacote.js
   da tela. Vincular um footprint a um componente passa pelo servidor do hub (/api/symbols/*), como
   a aba Biblioteca » Componentes faz.

   Os 3D da PcbLib (Libs/pcblib-3d.js) quase nunca estao no disco: o hubserver os tira da PcbLib sob
   demanda. Sem o arquivo, o MCP pede ao hub no ar. */
'use strict';
const path = require('node:path');
const { ErroMcp } = require('../lib/contexto.js');
const { avaliaVar } = require('../lib/arquivo-linhas.js');
const { hubNoAr } = require('../lib/util.js');

const tem = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const copia = o => JSON.parse(JSON.stringify(o));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const HF = ctx => ctx.exige('hub-fplib.js', 'HubFpLib');
function libHub(ctx) { return HF(ctx).normaliza(copia(ctx.lib('pcblib-hub.js', 'pcblibHub') || null)); }
function libAltium(ctx) { return ctx.lib('pcblib.js', 'pcblib') || { footprints: [] }; }

let cache3d = null;   // {quando, v}
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

/* o footprint pelo nome: o do hub na frente; o do Altium com os corpos 3D da PcbLib */
async function acha(ctx, nome) {
  const lib = libHub(ctx);
  const h = HF(ctx).acha(lib, nome);
  if (h) return { origem: 'hub', fp: copia(h), lib };
  const a = (libAltium(ctx).footprints || []).find(f => f && f.name === nome);
  if (!a) return null;
  const fp = copia(a);
  const L3 = await lib3d(ctx);
  fp.bodies = L3 && tem(L3.footprints, nome) ? copia(L3.footprints[nome].bodies || []) : [];
  return { origem: 'altium', fp, lib, L3 };
}
function modeloDe(lib, L3, id) {
  return (tem(lib.models, id) && lib.models[id]) || (L3 && tem(L3.models, id) && L3.models[id]) || null;
}

/* grava no Libs/pcblib-hub.js: valida como o editor, leva o indice dos modelos que o fp usa */
async function salva(ctx, fp, opcoes, ferramenta) {
  const hf = HF(ctx);
  const o = opcoes || {};
  fp = copia(fp);
  for (const k of ['pads', 'silk', 'bodies']) if (!Array.isArray(fp[k])) fp[k] = [];
  if (typeof fp.description !== 'string') fp.description = '';
  const erros = hf.valida(fp);
  if (erros.length) throw new ErroMcp('o footprint não pode ser salvo: ' + erros.join('; '), { erros });
  const lib = libHub(ctx);
  const ja = hf.acha(lib, fp.name);
  const doAltium = (libAltium(ctx).footprints || []).some(f => f && f.name === fp.name);
  if (ja && !o.substituir) throw new ErroMcp(`já existe "${fp.name}" na biblioteca do hub: passe substituir:true para trocar`);
  const L3 = fp.bodies.some(b => b && b.kind === 'step') ? await lib3d(ctx) : null;
  for (const b of fp.bodies) if (b && b.kind === 'step') {
    if (!b.model) throw new ErroMcp('corpo STEP sem "model" (o id do modelo: fp_modelos3d lista)');
    if (!tem(lib.models, b.model)) {
      const m = modeloDe(lib, L3, b.model);
      if (!m || !m.file) throw new ErroMcp(`modelo 3D "${b.model}" não existe na PcbLib nem na biblioteca do hub (fp_modelos3d lista os ids)`);
      lib.models[b.model] = { file: m.file, name: m.name || b.name || '', bytes: m.bytes || 0 };
    }
    if (!b.name) b.name = (lib.models[b.model] || {}).name || '';
  }
  const agora = new Date().toISOString();
  fp.hub = Object.assign({}, (ja && ja.hub) || {}, fp.hub || {}, { editado: agora, por: 'mcp' });
  if (!fp.hub.criado) fp.hub.criado = agora;
  if (!fp.hub.base && doAltium) fp.hub.base = fp.name;
  fp.bbox = hf.bbox(fp);
  hf.poe(lib, fp);
  const abs = path.join(ctx.root, 'Libs', 'pcblib-hub.js');
  ctx.grava(abs, hf.serializa(lib), ferramenta);
  return { salvo: fp.name, arquivo: ctx.rel(abs), substituiu: !!ja, passaNaFrenteDoAltium: doAltium,
           pads: fp.pads.length, silk: fp.silk.length, corpos3d: fp.bodies.length, bbox: fp.bbox };
}

const FP_SCHEMA = {
  type: 'object',
  description: 'mm, origem do footprint, Top. pads:[{name, type:"smd"|"th", shape:"rect"|"roundrect"|"circle"|"oval"|"octagon", x, y, w, h, rot, layer:"Top"|"Bottom"|"Multi", drill (th), radius (roundrect)}]; silk (Top Overlay):[{kind:"line", x1,y1,x2,y2,w} | {kind:"arc", cx,cy,r,sa,ea,w}] (ângulos em graus, anti-horário; círculo = sa 0, ea 360); bodies:[{kind:"step", model:<id>, raw:{x2d,y2d,rotx,roty,rotz,dz}} | {kind:"extruded", pts:[[x,y]...], standoff, height} | {kind:"cylinder", radius, height, raw} | {kind:"sphere", radius, raw}] (color "#rrggbb", opacity 0..1)',
  properties: { name: { type: 'string' }, description: { type: 'string' }, pads: { type: 'array' }, silk: { type: 'array' }, bodies: { type: 'array' } },
  required: ['name', 'pads'],
};

module.exports = {
  grupo: 'footprint',
  ordem: 27,
  titulo: 'Footprint — o editor de footprint do hub (grava em Libs/pcblib-hub.js)',
  modulos: ['hub-fplib.js', 'hub-fppacote.js'],
  ferramentas: [
    {
      nome: 'fp_buscar', titulo: 'Buscar footprints', leitura: true, modulo: 'hub-fplib.js',
      descricao: 'Lista os footprints das duas bibliotecas (a do hub na frente da do Altium com o mesmo nome) por nome/descrição: origem, pads e corpos 3D. Use antes de fp_ler / fp_salvar / sch_editar (footprint do componente).',
      entrada: { type: 'object', properties: { busca: { type: 'string', description: 'pedaço do nome, ex.: "SOT-23", "0805", "TO-220"' }, so_com_3d: { type: 'boolean' }, limite: { type: 'integer', minimum: 1, maximum: 500 } } },
      executa: async (a, ctx) => {
        const lib = libHub(ctx), alt = libAltium(ctx), L3 = await lib3d(ctx);
        const termos = norm(a.busca).split(/\s+/).filter(Boolean);
        const vistos = new Set(), out = [];
        const poe = (f, origem) => {
          if (!f || !f.name || vistos.has(f.name)) return;
          vistos.add(f.name);
          const n3d = origem === 'hub' ? (f.bodies || []).length : (L3 && tem(L3.footprints, f.name) ? (L3.footprints[f.name].bodies || []).length : 0);
          if (a.so_com_3d && !n3d) return;
          const txt = norm(f.name + ' ' + (f.description || ''));
          if (!termos.every(t => txt.includes(t))) return;
          out.push({ nome: f.name, origem, pads: (f.pads || []).length, corpos3d: n3d, descricao: f.description || undefined });
        };
        for (const f of lib.footprints) poe(f, 'hub');
        for (const f of alt.footprints || []) poe(f, 'altium');
        out.sort((x, y) => x.nome.localeCompare(y.nome));
        return { total: out.length, footprints: out.slice(0, a.limite || 50), lib3d: L3 ? 'carregada' : 'indisponível (sem o hub no ar não há os 3D da PcbLib)' };
      },
    },
    {
      nome: 'fp_ler', titulo: 'Ler um footprint', leitura: true, modulo: 'hub-fplib.js',
      descricao: 'A geometria inteira de um footprint (pads, serigrafia, corpos 3D com os modelos STEP), no formato que fp_salvar grava. Para editar: fp_ler, mude o objeto, fp_salvar com substituir:true.',
      entrada: { type: 'object', properties: { nome: { type: 'string' } }, required: ['nome'] },
      executa: async (a, ctx) => {
        const r = await acha(ctx, a.nome);
        if (!r) throw new ErroMcp(`footprint "${a.nome}" não existe (fp_buscar)`);
        const L3 = r.L3 || await lib3d(ctx);
        const modelos = {};
        for (const b of r.fp.bodies || []) if (b && b.kind === 'step' && b.model) modelos[b.model] = modeloDe(r.lib, L3, b.model);
        return { origem: r.origem, footprint: r.fp, modelos,
                 nota: r.origem === 'altium' ? 'do Altium: fp_salvar grava uma cópia na biblioteca do hub, que passa na frente' : 'da biblioteca do hub' };
      },
    },
    {
      nome: 'fp_salvar', titulo: 'Salvar footprint', destrutiva: true, modulo: 'hub-fplib.js',
      descricao: 'Grava um footprint na biblioteca do hub (Libs/pcblib-hub.js), validado como no editor (designadores, tamanhos, furo menor que o pad). Com o nome de um footprint do Altium, a cópia do hub passa a valer no lugar dele (o Altium não muda). Para trocar um do hub, substituir:true.',
      entrada: { type: 'object', properties: { footprint: FP_SCHEMA, substituir: { type: 'boolean' } }, required: ['footprint'] },
      executa: async (a, ctx) => salva(ctx, a.footprint, { substituir: !!a.substituir }, 'fp_salvar'),
    },
    {
      nome: 'fp_pacote', titulo: 'Assistente de footprint', modulo: 'hub-fppacote.js',
      descricao: 'Gera o footprint de um pacote padrão (o assistente do editor): chip (2 terminais), soic, qfp, dip, sot23, header. Pads numerados como o Altium (pino 1 no alto à esquerda, anti-horário), serigrafia com a marca do pino 1 e um corpo 3D extrudado. Parâmetros em mm (sem eles, os de fábrica do tipo). Por padrão já salva na biblioteca do hub; salvar:false só devolve.',
      entrada: { type: 'object', properties: {
        tipo: { type: 'string', enum: ['chip', 'soic', 'qfp', 'dip', 'sot23', 'header'] },
        nome: { type: 'string', description: 'sem ele: SOIC-8_P1.27, QFP-32_P0.8, DIP-8, SOT-23-3, HDR_1x4_P2.54, CHIP_2x1.25' },
        parametros: { type: 'object', description: 'n (pinos), passo, span (entre fileiras, centro a centro), padX (sai do corpo), padY (na fileira), furo (PTH), cx/cy (corpo: comprimento/largura), alt (altura 3D), fil (fileiras da barra: 1|2)' },
        salvar: { type: 'boolean' }, substituir: { type: 'boolean' },
      }, required: ['tipo'] },
      executa: async (a, ctx) => {
        const PK = ctx.exige('hub-fppacote.js', 'HubFpPacote');
        let fp;
        try { fp = PK.gera(a.tipo, a.parametros || {}, a.nome || null); } catch (e) { throw new ErroMcp(String(e && e.message || e)); }
        if (a.salvar === false) return { footprint: fp, salvo: false };
        const r = await salva(ctx, fp, { substituir: !!a.substituir }, 'fp_pacote');
        return Object.assign(r, { footprint: fp });
      },
    },
    {
      nome: 'fp_modelos3d', titulo: 'Modelos 3D (STEP) disponíveis', leitura: true,
      descricao: 'Os modelos STEP que já existem: os embutidos na PcbLib da casa e os subidos no hub, com os footprints que usam cada um. O "id" vai em fp_corpo3d (ou no corpo {kind:"step", model:id} de fp_salvar).',
      entrada: { type: 'object', properties: { busca: { type: 'string', description: 'pelo nome do modelo ou do footprint que o usa' }, limite: { type: 'integer', minimum: 1, maximum: 300 } } },
      executa: async (a, ctx) => {
        const lib = libHub(ctx), L3 = await lib3d(ctx);
        const usos = new Map();
        const conta = fps => { for (const n of Object.keys(fps || {})) for (const b of ((fps[n] || {}).bodies || [])) if (b && b.kind === 'step' && b.model) { const u = usos.get(b.model) || []; if (!u.includes(n)) u.push(n); usos.set(b.model, u); } };
        conta(L3 && L3.footprints);
        const fh = {}; for (const f of lib.footprints) fh[f.name] = f; conta(fh);
        const termos = norm(a.busca).split(/\s+/).filter(Boolean);
        const out = [], vistos = new Set();
        for (const [src, origem] of [[lib.models, 'hub'], [L3 && L3.models, 'pcblib']]) for (const id of Object.keys(src || {})) {
          if (vistos.has(id)) continue; vistos.add(id);
          const m = src[id]; if (!m || !m.file) continue;
          const u = usos.get(id) || [];
          const txt = norm((m.name || '') + ' ' + u.join(' '));
          if (!termos.every(t => txt.includes(t))) continue;
          out.push({ id, nome: m.name || '', origem, bytes: m.bytes || 0, usadoEm: u.slice(0, 10), usos: u.length });
        }
        out.sort((x, y) => y.usos - x.usos || x.nome.localeCompare(y.nome));
        return { total: out.length, modelos: out.slice(0, a.limite || 40), lib3d: L3 ? 'carregada' : 'indisponível (sem o hub no ar só os modelos do hub)' };
      },
    },
    {
      nome: 'fp_corpo3d', titulo: 'Prender modelo 3D ao footprint', destrutiva: true, modulo: 'hub-fplib.js',
      descricao: 'Põe um modelo STEP (fp_modelos3d) no footprint e salva na biblioteca do hub. Sem rotação dada, usa a do footprint que já usa o modelo (o STEP do fabricante raramente vem deitado como a placa pede); sem x/y, o centro dos pads. substituir_corpos:true tira os corpos que o footprint tinha. Confira no editor (Biblioteca » Footprints, tecla 3) ou por vista_screenshot.',
      entrada: { type: 'object', properties: {
        footprint: { type: 'string' }, modelo: { type: 'string', description: 'id do modelo (ou o nome do arquivo, se único)' },
        x: { type: 'number' }, y: { type: 'number' }, dz: { type: 'number', description: 'altura da origem do modelo sobre a placa (mm)' },
        rotx: { type: 'number' }, roty: { type: 'number' }, rotz: { type: 'number' },
        substituir_corpos: { type: 'boolean' },
      }, required: ['footprint', 'modelo'] },
      executa: async (a, ctx) => {
        const r = await acha(ctx, a.footprint);
        if (!r) throw new ErroMcp(`footprint "${a.footprint}" não existe (fp_buscar)`);
        const L3 = r.L3 || await lib3d(ctx);
        let id = a.modelo, m = modeloDe(r.lib, L3, id);
        if (!m) {
          const cands = [];
          for (const src of [r.lib.models, L3 && L3.models]) for (const k of Object.keys(src || {})) if (src[k] && norm(src[k].name) === norm(a.modelo) && !cands.includes(k)) cands.push(k);
          if (cands.length !== 1) throw new ErroMcp(cands.length ? `"${a.modelo}" casa com ${cands.length} modelos: use o id (fp_modelos3d)` : `modelo "${a.modelo}" não encontrado (fp_modelos3d)`);
          id = cands[0]; m = modeloDe(r.lib, L3, id);
        }
        let base = null;
        for (const fps of [L3 && L3.footprints, Object.fromEntries(r.lib.footprints.map(f => [f.name, f]))]) {
          for (const n of Object.keys(fps || {})) { base = ((fps[n] || {}).bodies || []).find(b => b && b.kind === 'step' && b.model === id && b.raw); if (base) break; }
          if (base) break;
        }
        const fp = r.fp;
        const bb = fp.pads.length ? HF(ctx).bbox({ pads: fp.pads, silk: [] }) : { x1: 0, y1: 0, x2: 0, y2: 0 };
        const num = (v, p) => typeof v === 'number' && isFinite(v) ? v : p;
        const raw = {
          x2d: num(a.x, Math.round((bb.x1 + bb.x2) / 2 * 1e4) / 1e4), y2d: num(a.y, Math.round((bb.y1 + bb.y2) / 2 * 1e4) / 1e4), rot2d: 0,
          rotx: num(a.rotx, base ? base.raw.rotx || 0 : 0), roty: num(a.roty, base ? base.raw.roty || 0 : 0), rotz: num(a.rotz, base ? base.raw.rotz || 0 : 0),
          dz: num(a.dz, base ? base.raw.dz || 0 : 0),
        };
        if (a.substituir_corpos) fp.bodies = [];
        fp.bodies.push({ kind: 'step', model: id, name: m.name || '', side: 'top', raw, color: '#9a9a9a', opacity: 1 });
        const s = await salva(ctx, fp, { substituir: true }, 'fp_corpo3d');
        return Object.assign(s, { modelo: { id, nome: m.name || '' }, raw, rotacaoDe: base ? 'do footprint que já usa o modelo' : 'zero (nenhum footprint usa o modelo)' });
      },
    },
    {
      nome: 'fp_apagar', titulo: 'Apagar footprint do hub', destrutiva: true, modulo: 'hub-fplib.js',
      descricao: 'Tira um footprint da biblioteca do hub (Libs/pcblib-hub.js). Se o Altium tem um com o mesmo nome, ele volta a valer. Não apaga nada do Altium.',
      entrada: { type: 'object', properties: { nome: { type: 'string' } }, required: ['nome'] },
      executa: async (a, ctx) => {
        const hf = HF(ctx), lib = libHub(ctx);
        if (!hf.acha(lib, a.nome)) throw new ErroMcp(`"${a.nome}" não está na biblioteca do hub`);
        hf.tira(lib, a.nome);
        const abs = path.join(ctx.root, 'Libs', 'pcblib-hub.js');
        ctx.grava(abs, hf.serializa(lib), 'fp_apagar');
        return { apagado: a.nome, voltaOdoAltium: (libAltium(ctx).footprints || []).some(f => f && f.name === a.nome) };
      },
    },
    {
      nome: 'fp_vincular', titulo: 'Vincular footprint a um componente', destrutiva: true,
      descricao: 'Liga um footprint a um componente, como Biblioteca » Componentes » faixa Footprints faz: {familia, componente} para um valor do almoxarifado (família = o símbolo, componente = o nome do valor no Altium, o "comp.sym" do almox_buscar), ou {simbolo} para um símbolo da biblioteca. footprint "" desvincula. Passa pelo servidor do hub (precisa dele no ar).',
      entrada: { type: 'object', properties: {
        footprint: { type: 'string' }, familia: { type: 'string' }, componente: { type: 'string' }, simbolo: { type: 'string' },
      }, required: ['footprint'] },
      executa: async (a, ctx) => {
        if (!(a.simbolo || (a.familia && a.componente))) throw new ErroMcp('passe {familia, componente} (almoxarifado) ou {simbolo}');
        if (a.footprint && !(await acha(ctx, a.footprint))) throw new ErroMcp(`footprint "${a.footprint}" não existe (fp_buscar)`);
        const hub = await hubNoAr(ctx);
        if (!hub) throw new ErroMcp('o hub não está no ar: vincular passa pelo servidor da biblioteca (abra o EletricHUB)');
        const valor = !!(a.familia && a.componente);
        const corpo = valor ? { familia: a.familia, componente: a.componente, footprint: a.footprint } : { simbolo: a.simbolo, footprint: a.footprint };
        const r = await fetch(hub.url + (valor ? '/api/symbols/almox-footprint' : '/api/symbols/footprint'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(30000) });
        let j = null; try { j = await r.json(); } catch (_) { /* sem corpo */ }
        if (!j || !j.ok) throw new ErroMcp((j && j.error) || ('o servidor recusou (HTTP ' + r.status + ')'));
        return { ok: true, alvo: valor ? `${a.familia} » ${a.componente}` : a.simbolo, footprint: a.footprint || '(nenhum)', resposta: j };
      },
    },
  ],
};
