/* NexoEletric MCP - grupo "saidas": Gerber, PDF de layout e lista de materiais.

   O Gerber sai do MESMO gerador da vista PCB (hub-gerber.js) a partir da placa com as mudancas, e
   vai para a MESMA pasta e manifesto que a rota /api/gerber do hubserver.py usa
   (Projects/<p>/Gerber/ + gerber.json): o "Ver salvo" da vista abre o que a IA gerou. As regras
   da rota valem aqui tambem: nomes so com letras sem acento, numeros, espaco e _ . ( ) + -;
   primeiro todos os .tmp, depois as trocas; sai da pasta a camada/furacao que nao veio agora e
   o que o hub gravou da outra vez. A pasta Gerber/ fica fora do vigia do hubserver (gravar nao
   recarrega a vista). */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ErroMcp } = require('../lib/contexto.js');
const { PROJETO } = require('../lib/util.js');

const GERBER_DIR = 'Gerber', MANIFESTO = 'gerber.json', PDF_DIR = 'PDF';
const EXTS = ['.gbr', '.gtl', '.gbl', '.gto', '.gbo', '.gts', '.gbs', '.gtp', '.gbp', '.gko', '.gm1', '.drl', '.txt'];
const SEMPRE_SAI = ['.gbr', '.drl'];
const NOME_OK = /^[A-Za-z0-9 _.()+-]+$/;
const RESERVADO = /^(con|prn|aux|nul|com[0-9]|lpt[0-9]) *\./i;

function nomeRuim(n) {
  if (typeof n !== 'string' || !n) return 'falta o nome';
  if (n.length > 150) return 'nome comprido demais';
  if (n.startsWith('.') || n !== n.trim() || !NOME_OK.test(n)) return 'nome inválido';
  if (!EXTS.includes(path.extname(n).toLowerCase())) return 'extensão não aceita';
  if (RESERVADO.test(n)) return 'nome reservado do Windows';
  return '';
}
/* o json.dump(ensure_ascii=False, indent=1, sort_keys=True) do _bom_json_write */
function jsonOrdenado(v, nivel) {
  const ind = ' '.repeat((nivel || 0) + 1), fim = ' '.repeat(nivel || 0);
  if (Array.isArray(v)) return v.length ? '[\n' + v.map(x => ind + jsonOrdenado(x, (nivel || 0) + 1)).join(',\n') + '\n' + fim + ']' : '[]';
  if (v && typeof v === 'object') {
    const k = Object.keys(v).filter(x => v[x] !== undefined).sort();
    return k.length ? '{\n' + k.map(x => ind + JSON.stringify(x) + ': ' + jsonOrdenado(v[x], (nivel || 0) + 1)).join(',\n') + '\n' + fim + '}' : '{}';
  }
  return JSON.stringify(v);
}
function anteriores(gdir) {
  try {
    const l = JSON.parse(fs.readFileSync(path.join(gdir, MANIFESTO), 'utf8')).arquivos;
    return new Set((Array.isArray(l) ? l : []).map(a => a && a.nome).filter(n => !nomeRuim(n)));
  } catch (_) { return new Set(); }
}
function gravaConjunto(gdir, novos, ant) {
  fs.mkdirSync(gdir, { recursive: true });
  const pares = novos.map(([nome, corpo]) => [path.join(gdir, nome) + '.tmp', path.join(gdir, nome), corpo]);
  try {
    for (const [tmp, , corpo] of pares) fs.writeFileSync(tmp, corpo);
    for (const [tmp, full] of pares) fs.renameSync(tmp, full);
  } finally { for (const [tmp] of pares) { try { fs.unlinkSync(tmp); } catch (_) { /* ja trocado */ } } }
  const fica = new Set(novos.map(([n]) => n.toLowerCase())), feitos = new Set([...ant].map(n => n.toLowerCase()));
  const removidos = [];
  for (const f of fs.readdirSync(gdir).sort()) {
    const k = f.toLowerCase();
    if (fica.has(k) || !fs.statSync(path.join(gdir, f)).isFile() || f === MANIFESTO) continue;
    if (SEMPRE_SAI.includes(path.extname(f).toLowerCase()) || feitos.has(k)) { fs.unlinkSync(path.join(gdir, f)); removidos.push(f); }
  }
  return removidos;
}
function baseDoPcbDoc(board, nome) {
  const n = String(board.source || '').split(/[\\/]/).pop().replace(/\.pcbdoc$/i, '');
  return n || nome || 'placa';
}

module.exports = {
  grupo: 'saidas',
  ordem: 50,
  titulo: 'Saídas — Gerber, PDF de layout, BOM',
  modulos: ['hub-gerber.js', 'hub-pcbpdf.js'],
  ferramentas: [
    {
      nome: 'gerber_gerar', titulo: 'Gerar Gerber',
      descricao: 'Gera o Gerber X2 (mm 4:5, o conjunto do Altium 21.5.1) da placa COM as mudanças e grava em Projects/<p>/Gerber/ com o manifesto gerber.json — a mesma pasta e formato do botão "Salvar no projeto" da vista PCB. Devolve os arquivos, os avisos do gerador (leia os "ATENÇÃO") e o que saiu da pasta. salvar:false só gera e resume.',
      entrada: { type: 'object', properties: {
        projeto: PROJETO, salvar: { type: 'boolean', description: 'padrão true' },
        nomes: { type: 'string', enum: ['fabricacao', 'altium'], description: 'fabricacao (padrão, minúsculas como o pacote da JLCPCB) ou altium' },
        despejar: { type: 'boolean', description: 'padrão true: redespeja os polígonos (hub-pcbpour.js) antes de gerar' }, vazias: { type: 'boolean' }, gtoGbo: { type: 'boolean' }, x2: { type: 'boolean', description: 'padrão true' }, base: { type: 'string', description: 'nome base dos arquivos (padrão: o do .PcbDoc)' },
      }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const G = ctx.exige('hub-gerber.js', 'HubGerber');
        const { board, changes, eb } = ctx.placa(p);
        const opc = { nomes: a.nomes || 'fabricacao', vazias: !!a.vazias, gtoGbo: !!a.gtoGbo, x2: a.x2 !== false };
        /* polygon pour: o despejo novo no lugar do que veio do Altium (hub-pcbpour.js), senao o
           cobre velho fica e o Gerber sai em curto (PCB-MIGRACAO G3) */
        let ebG = eb, pour = null;
        const P = ctx.modulo('hub-pcbpour.js'), G2 = ctx.modulo('hub-gerber.js');
        if (P && (eb.polygons || []).length && a.despejar !== false) {
          try {
            const d = P.despejaTodos(eb, { texto: G2 && G2.geometriaTexto ? (t => { try { return G2.geometriaTexto(t); } catch (_) { return null; } }) : undefined });
            ebG = P.placaSemDespejoVelho(eb, d.regioes); pour = { poligonos: eb.polygons.length, regioes: (d.regioes || []).length, avisos: d.avisos };
          } catch (e) { pour = { erro: e.message }; }
        }
        const r = G.gerar(ebG, Object.assign({ base: a.base || baseDoPcbDoc(board, p.nome), software: 'NexoEletric' }, opc));
        const out = { base: r.resumo.base, arquivos: r.arquivos.map(x => ({ nome: x.nome, camada: x.camada, funcao: x.funcao, bytes: Buffer.byteLength(x.texto), contagens: x.contagens })),
                      descartadas: r.resumo.descartadas, avisos: r.avisos, mudancas_incluidas: changes.length, pour: pour || undefined };
        if (a.salvar === false) return out;
        const novos = [], vistos = new Set();
        for (const x of r.arquivos) {
          const m = nomeRuim(x.nome);
          if (m) throw new ErroMcp(`${x.nome}: ${m}`);
          if (vistos.has(x.nome.toLowerCase())) throw new ErroMcp('nome repetido: ' + x.nome);
          vistos.add(x.nome.toLowerCase());
          novos.push([x.nome, Buffer.from(x.texto, 'utf8')]);
        }
        const gdir = path.join(p.dir, GERBER_DIR);
        const lista = novos.map(([nome, c]) => ({ nome, bytes: c.length, md5: crypto.createHash('md5').update(c).digest('hex') }));
        const removidos = gravaConjunto(gdir, novos, anteriores(gdir));
        const d = new Date(), z = n => String(n).padStart(2, '0');
        const man = { base: r.resumo.base, opcoes: opc, avisos: (r.avisos || []).slice(0, 60), software: 'NexoEletric', origem: 'MCP (gerber_gerar)',
                      mudancas: changes.length, changesSalvo: true, arquivos: lista,
                      gerado: `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}` };
        const mf = path.join(gdir, MANIFESTO);
        fs.writeFileSync(mf + '.tmp', jsonOrdenado(man), 'utf8'); fs.renameSync(mf + '.tmp', mf);
        return Object.assign(out, { ok: true, pasta: ctx.rel(gdir), gravados: lista, removidos });
      },
    },
    {
      nome: 'gerber_salvo', titulo: 'Gerber salvo no projeto', leitura: true,
      descricao: 'Mostra o manifesto do último Gerber gravado (Projects/<p>/Gerber/gerber.json) e, com conferir:true, lê cada arquivo com o leitor de Gerber do hub (hub-gerberview.js) e conta os objetos por camada.',
      entrada: { type: 'object', properties: { projeto: PROJETO, conferir: { type: 'boolean' } }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const gdir = path.join(p.dir, GERBER_DIR);
        if (!fs.existsSync(path.join(gdir, MANIFESTO))) throw new ErroMcp('nenhum Gerber salvo neste projeto (gerber_gerar)');
        const man = JSON.parse(fs.readFileSync(path.join(gdir, MANIFESTO), 'utf8'));
        if (!a.conferir) return man;
        const V = ctx.exige('hub-gerberview.js', 'HubGerberView');
        man.conferencia = (man.arquivos || []).map(x => {
          try {
            const t = fs.readFileSync(path.join(gdir, x.nome), 'utf8');
            const g = V.parse(t, x.nome);
            const c = {};
            for (const q of (g && g.prims) || []) c[q.k] = (c[q.k] || 0) + 1;
            return { nome: x.nome, ok: true, funcao: g && g.funcao, contagens: c, bbox: g && g.bbox, avisos: g && g.avisos && g.avisos.slice(0, 5) };
          } catch (e) { return { nome: x.nome, ok: false, erro: e.message }; }
        });
        return man;
      },
    },
    {
      nome: 'pdf_layout', titulo: 'PDF de layout',
      descricao: 'Gera o PDF de layout (A4 paisagem, vistas de montagem de cima e de baixo, carimbo da casa) com o hub-pcbpdf.js (HubPcbPdf) e grava em Projects/<p>/PDF/<nome>.pdf, como a rota /api/pdf.',
      modulo: 'hub-pcbpdf.js',
      entrada: { type: 'object', properties: { projeto: PROJETO, nome: { type: 'string', description: 'nome do arquivo (padrão "LO - <base>")' },
        opcoes: { type: 'object', additionalProperties: true, description: 'as do HubPcbPdf: formato A4|A3, escala auto|2|"3:2", folhas {cima, baixo}, juntas, designators serigrafia|centro|nao, obs (texto), carimbo {arquivo, revisao, equipamento, desenho, desenhista, dataDesenho, verificador, dataVerificacao, aprovador, dataAprovacao}' } }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const { board, eb } = ctx.placa(p);
        const M = ctx.exige('hub-pcbpdf.js', 'HubPcbPdf');
        const opc = Object.assign({ projeto: p.nome, base: baseDoPcbDoc(board, p.nome) }, a.opcoes || {});
        const r = { funcao: 'gera' };
        let v = M.gera(eb, opc);
        let avisos;
        try { avisos = M.plano(eb, opc).avisos; } catch (_) { avisos = undefined; }
        let bytes = null;
        if (v instanceof Uint8Array) bytes = Buffer.from(v);
        else if (typeof v === 'string') bytes = v.startsWith('%PDF-') ? Buffer.from(v, 'latin1') : Buffer.from(v, 'base64');
        else if (v && (v.bytes || v.pdf || v.base64)) { const b = v.bytes || v.pdf; bytes = b ? Buffer.from(b) : Buffer.from(v.base64, 'base64'); }
        if (!bytes || bytes.slice(0, 5).toString('latin1') !== '%PDF-') throw new ErroMcp('HubPcbPdf.' + r.funcao + ' não devolveu um PDF (esperado Uint8Array, base64 ou {bytes})');
        let nome = (a.nome || (typeof M.nomeArquivo === 'function' ? M.nomeArquivo(eb, opc) : 'LO - ' + baseDoPcbDoc(board, p.nome))).trim().replace(/\.pdf$/i, '').trim();
        if (!nome || nome.length > 150 || nome.startsWith('.') || nome.endsWith('.') || !/^[A-Za-z0-9 _.()+,-]+$/.test(nome))
          nome = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 _.()+,-]+/g, '_').replace(/^[.\s]+|[.\s]+$/g, '') || 'layout';
        const f = path.join(p.dir, PDF_DIR, nome + '.pdf');
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f + '.tmp', bytes); fs.renameSync(f + '.tmp', f);
        return { ok: true, arquivo: ctx.rel(f), bytes: bytes.length, via: 'HubPcbPdf.' + r.funcao, avisos };
      },
    },
    {
      nome: 'bom_listar', titulo: 'Lista de materiais (simples)', leitura: true,
      descricao: 'Lista de materiais simples do projeto, agrupada por valor (comment) + footprint: da placa efetiva (lado de cada um) ou, sem placa, do esquema (com a identidade do Odoo em params, quando houver). Para a BOM de montagem/Odoo use o painel BOM do hub.',
      entrada: { type: 'object', properties: { projeto: PROJETO, fonte: { type: 'string', enum: ['placa', 'esquema'] } }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const usarPlaca = a.fonte !== 'esquema' && ctx.temBoard(p);
        const linhas = new Map();
        const soma = (chave, ref, extra) => { if (!linhas.has(chave)) linhas.set(chave, Object.assign({ qtd: 0, refs: [] }, extra)); const l = linhas.get(chave); l.qtd++; l.refs.push(ref); };
        if (usarPlaca) {
          const { eb } = ctx.placa(p);
          for (const c of eb.components || []) {
            const k = (c.comment || '') + '|' + (c.footprint || '');
            soma(k, c.ref, { valor: c.comment || '', footprint: c.footprint || '', lados: {} });
            linhas.get(k).lados[c.layer] = 1;
          }
        } else {
          const s = ctx.schematic(p);
          const vistos = new Set();
          for (const it of s.items || []) {
            if (it.t !== 'comp' || vistos.has(it.ref)) continue;
            vistos.add(it.ref);
            soma((it.comment || it.sym) + '|' + (it.footprint || ''), it.ref, { valor: it.comment || '', simbolo: it.sym, footprint: it.footprint || '', params: it.params || undefined });
          }
        }
        const nat = (x, y) => String(x).localeCompare(String(y), undefined, { numeric: true });
        const L = [...linhas.values()].map(l => Object.assign(l, { refs: l.refs.sort(nat), lados: l.lados ? Object.keys(l.lados) : undefined })).sort((x, y) => nat(x.refs[0], y.refs[0]));
        return { fonte: usarPlaca ? 'placa (board.js + changes.js)' : 'esquema', itens: L.length, componentes: L.reduce((s, l) => s + l.qtd, 0), linhas: L };
      },
    },
  ],
};
