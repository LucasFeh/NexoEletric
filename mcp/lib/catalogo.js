/* NexoEletric - catalogo.js: o código de produto da placa nova, no catálogo da DIEletrons.

   Pedido do dono (2026-11-04): "toda placa nova precisa ser registrada em CATALOGAÇÃO TODOS OS PRODUTOS. Toda PCB
   nova segue a regra: código do projeto, um P na frente de placa, mais o ano: DI(ano)(número do produto no
   Excel)". Ex.: "PLACA DISPLAY DO INDICADOR DIGITAL (POTENCIOMETRO)", item 1945 em 2026 -> PDIDP-DI261945.

   O CATÁLOGO: \\192.168.15.31\Controle de Projetos\CATALOGAÇÃO TODOS OS PRODUTOS .xlsx (o espaço antes do .xlsx é do
   nome real). Uma aba, "Planilha1": linha 1 o título, linha 2 o cabeçalho ITEM | TIPO | NOME | CLIENTE | MODELO |
   VÍNCULO, e um produto por linha (o código em MODELO). Embaixo há linhas com só o último ITEM repetido (sobra de
   quem arrastou a coluna): a placa nova ocupa a primeira linha sem MODELO depois do último produto.
   NEXO_CATALOGO troca o arquivo (os testes usam uma cópia; nunca o de verdade).

   UM motor para os dois caminhos: o "Novo projeto" do hub (tools/rotas/projeto_novo.py roda `node catalogo.js
   --cli`) e a ferramenta projeto_criar do MCP (chama as funções daqui).

   A ESCRITA mexe só na planilha (xl/worksheets/sheet1.xml): a linha nova vai com texto embutido (inlineStr), com os
   estilos da linha do produto anterior; sharedStrings, estilos e o resto do .xlsx seguem iguais. Antes de gravar:
   relê o arquivo (o número é o do momento), confere que o Excel não o tem aberto (o Windows nega abrir para
   escrita) e guarda uma cópia em %TEMP%\NexoEletric-catalogo. Grava num temporário ao lado e troca. */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const PADRAO = '\\\\192.168.15.31\\Controle de Projetos\\CATALOGAÇÃO TODOS OS PRODUTOS .xlsx';
const arquivo = a => a || process.env.NEXO_CATALOGO || PADRAO;

/* ============================== o .zip do .xlsx ============================== */

const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(b) { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }

/* as entradas do .zip, na ordem: [{nome, dados (Buffer), data, hora}] */
function lerZip(buf) {
  let fim = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { fim = i; break; }
  if (fim < 0) throw new Error('o catálogo não é um .xlsx válido (sem o fim do .zip)');
  const n = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  const out = [];
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('o catálogo não é um .xlsx válido (diretório do .zip)');
    const metodo = buf.readUInt16LE(p + 10), hora = buf.readUInt16LE(p + 12), data = buf.readUInt16LE(p + 14);
    const comp = buf.readUInt32LE(p + 20), ln = buf.readUInt16LE(p + 28), le = buf.readUInt16LE(p + 30), lc = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nome = buf.slice(p + 46, p + 46 + ln).toString('utf8');
    const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const cru = buf.slice(ini, ini + comp);
    const dados = metodo === 0 ? Buffer.from(cru) : metodo === 8 ? zlib.inflateRawSync(cru) : null;
    if (!dados) throw new Error('o catálogo usa uma compressão que este leitor não conhece (' + metodo + ')');
    out.push({ nome, dados, data, hora });
    p += 46 + ln + le + lc;
  }
  return out;
}
function escreverZip(ents) {
  const locais = [], centrais = [];
  let off = 0;
  for (const e of ents) {
    const nome = Buffer.from(e.nome, 'utf8'), comp = zlib.deflateRawSync(e.dados, { level: 6 }), crc = crc32(e.dados);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt16LE(e.hora || 0, 10); h.writeUInt16LE(e.data || 0x21, 12); h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(e.dados.length, 22); h.writeUInt16LE(nome.length, 26); h.writeUInt16LE(0, 28);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(e.hora || 0, 12); c.writeUInt16LE(e.data || 0x21, 14); c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(e.dados.length, 24); c.writeUInt16LE(nome.length, 28);
    c.writeUInt32LE(off, 42);
    locais.push(h, nome, comp); centrais.push(c, nome);
    off += 30 + nome.length + comp.length;
  }
  const dir = Buffer.concat(centrais), f = Buffer.alloc(22);
  f.writeUInt32LE(0x06054b50, 0); f.writeUInt16LE(ents.length, 8); f.writeUInt16LE(ents.length, 10);
  f.writeUInt32LE(dir.length, 12); f.writeUInt32LE(off, 16);
  return Buffer.concat(locais.concat([dir, f]));
}

/* ============================== a planilha ============================== */

const desescapa = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
const escapa = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function textos(xml) {
  const out = [];
  if (!xml) return out;
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) out.push(desescapa([...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')));
  return out;
}
/* a planilha da aba 1 (pelo workbook e os rels, como o Excel) */
function caminhoAba(ents) {
  const ach = n => ents.find(e => e.nome === n);
  const wb = ach('xl/workbook.xml'), rels = ach('xl/_rels/workbook.xml.rels');
  const rid = wb && /<sheet\b[^>]*\br:id="([^"]+)"/.exec(wb.dados.toString('utf8'));
  const alvo = rid && rels && new RegExp('<Relationship\\b[^>]*Id="' + rid[1] + '"[^>]*Target="([^"]+)"').exec(rels.dados.toString('utf8'))
    || rid && rels && new RegExp('<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="' + rid[1] + '"').exec(rels.dados.toString('utf8'));
  const t = alvo ? alvo[1].replace(/^\/?xl\//, '').replace(/^\//, '') : 'worksheets/sheet1.xml';
  return 'xl/' + t;
}
/* as linhas: [{r, cel:{A:{v, s}, ...}, xml}] */
function linhas(sheetXml, ss) {
  const out = [];
  for (const m of sheetXml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = Number((/\br="(\d+)"/.exec(m[1]) || [])[1]);
    const cel = {};
    for (const c of (m[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = (/\br="([A-Z]+)\d+"/.exec(c[1]) || [])[1];
      if (!ref) continue;
      const t = (/\bt="([^"]+)"/.exec(c[1]) || [])[1], s = (/\bs="(\d+)"/.exec(c[1]) || [])[1];
      const v = (/<v>([\s\S]*?)<\/v>/.exec(c[2] || '') || [])[1];
      let val = '';
      if (t === 's' && v != null) val = ss[Number(v)] || '';
      else if (t === 'inlineStr') val = desescapa([...(c[2] || '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''));
      else if (v != null) val = desescapa(v);
      cel[ref] = { v: val, s };
    }
    out.push({ r, cel, xml: m[0] });
  }
  return out;
}
const limpa = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/* o catálogo lido: {arquivo, itens:[{linha, item, tipo, nome, cliente, modelo, vinculo}], ultimo, proximo, ano} */
function abre(arq) {
  arq = arquivo(arq);
  let buf;
  try { buf = fs.readFileSync(arq); } catch (e) {
    throw new Error('não consegui abrir o catálogo de produtos (' + arq + '): ' + (e.code === 'ENOENT' ? 'o arquivo ou a pasta da rede não existe (o NAS 192.168.15.31 está ligado e esta máquina entra em "Controle de Projetos"?)' : e.message));
  }
  const ents = lerZip(buf);
  const aba = caminhoAba(ents);
  const ent = ents.find(e => e.nome === aba);
  if (!ent) throw new Error('o catálogo não tem a planilha ' + aba);
  const ss = textos((ents.find(e => e.nome === 'xl/sharedStrings.xml') || { dados: Buffer.alloc(0) }).dados.toString('utf8'));
  const xml = ent.dados.toString('utf8');
  const L = linhas(xml, ss);
  const itens = [];
  for (const l of L) {
    const v = k => limpa(l.cel[k] && l.cel[k].v);
    if (!v('E') || !/^\d+$/.test(v('A'))) continue;
    itens.push({ linha: l.r, item: Number(v('A')), tipo: v('B'), nome: v('C'), cliente: v('D'), modelo: v('E'), vinculo: v('F') });
  }
  const ultimo = itens.reduce((m, i) => Math.max(m, i.item), 0);
  return { arquivo: arq, ents, aba, xml, linhas: L, itens, ultimo, proximo: ultimo + 1, ano: anoDe(new Date()) };
}
const anoDe = d => String(d.getFullYear()).slice(-2);

/* ============================== o código ============================== */

const LIGA = new Set(['DE', 'DO', 'DA', 'DOS', 'DAS', 'PARA', 'E', 'COM', 'EM', 'A', 'O', 'AS', 'OS', 'POR', 'NO', 'NA', 'NOS', 'NAS', 'AO', 'P/', '-']);
const semAcento = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
/* a sigla de uma placa: P + a inicial de cada palavra do nome, sem "placa"/"cartão" e sem os conectivos
   (o costume do catálogo em 2026: "PLACA UNIDADE SENSOR INCLINÔMETRO" -> PUSI, "DISPOSITIVO DE COMISSIONAMENTO PARA
   DRIVERS" -> PDCD). Outros tipos não ganham o P. */
function sigla(nome, tipo) {
  const ps = semAcento(nome).toUpperCase().replace(/[()\[\]{},.;:/]+/g, ' ').split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < ps.length && /^(PLACA|CARTAO|PCB)$/.test(ps[i])) i++;
  const ini = ps.slice(i).filter(p => !LIGA.has(p)).map(p => (/[A-Z0-9]/.exec(p) || [''])[0]).join('');
  const placa = /PLACA|PCB/i.test(semAcento(tipo || 'PLACA'));
  return ((placa ? 'P' : '') + ini).slice(0, 10) || (placa ? 'P' : 'X');
}
const siglaOk = s => /^[A-Z][A-Z0-9]{0,11}$/.test(String(s || ''));
const codigo = (sg, ano, numero) => sg + '-DI' + ano + String(numero).padStart(4, '0');

/* o que o "Novo projeto" mostra antes de registrar: {proximo, ano, sigla, codigo, ultimo:{...}} */
function previa(o) {
  o = o || {};
  const c = abre(o.arquivo);
  const sg = o.sigla ? String(o.sigla).toUpperCase().trim() : sigla(o.nome || '', o.tipo);
  const u = c.itens.find(i => i.item === c.ultimo) || null;
  return { arquivo: c.arquivo, proximo: c.proximo, ano: c.ano, sigla: sg, codigo: codigo(sg, c.ano, c.proximo),
           ultimo: u && { item: u.item, nome: u.nome, modelo: u.modelo } };
}

/* OS GRUPOS DO "DEFINIR PROJETO" (2026-11-05: "separar em filtro Placas, Produtos, Equipamentos"): a coluna TIPO do
   catálogo é escrita à mão (Placa, PLACA, PCB; Equipamento, EQUIAPAMENTO, Equipmaento, Sistema, Nacionalização...),
   então o grupo sai de uma regra, e não de uma lista fechada. O que não é placa nem equipamento é produto (acessório,
   cabo, software). */
function grupo(tipo) {
  const t = semAcento(String(tipo || '')).toUpperCase();
  if (/PLACA|PCB/.test(t)) return 'placa';
  if (/EQU?I?A?P|EQUIPM|SISTEMA|NACIONALIZ|REVENDA/.test(t)) return 'equipamento';
  return 'produto';
}
const normCod = s => String(s || '').replace(/\s+/g, '').toUpperCase();

/* o catálogo inteiro, para a tela: {itens:[{item, tipo, grupo, nome, cliente, modelo, vinculo}], ultimo, proximo, ano} */
function lista(o) {
  const c = abre(o && o.arquivo);
  return { arquivo: c.arquivo, ultimo: c.ultimo, proximo: c.proximo, ano: c.ano,
           itens: c.itens.map(i => ({ item: i.item, tipo: i.tipo, grupo: grupo(i.tipo), nome: i.nome, cliente: i.cliente,
                                      modelo: i.modelo, vinculo: i.vinculo })) };
}

/* o produto de um código ("PDCD-DI261939", espaços em volta do hífen não contam): {item, nome, cliente, modelo, ...} ou null */
function busca(o) {
  const cod = String((o && o.codigo) || '').replace(/\s+/g, '').toUpperCase();
  if (!cod) return { achou: null };
  const c = abre(o.arquivo);
  const num = (/DI\d+$/.exec(cod) || [''])[0];
  const i = c.itens.find(x => x.modelo.replace(/\s+/g, '').toUpperCase() === cod)
    || (num && c.itens.find(x => x.modelo.replace(/\s+/g, '').toUpperCase().endsWith('-' + num))) || null;
  return { achou: i };
}

/* o Excel (ou outro programa) está com o arquivo aberto? No Windows, o Excel nega abrir para escrita */
function emUso(arq) {
  let fd = null;
  try { fd = fs.openSync(arq, 'r+'); return null; } catch (e) {
    return /EBUSY|EPERM|EACCES/.test(e.code || '') ? 'o catálogo está aberto em outro programa (Excel?): feche e tente de novo' : null;
  } finally { if (fd != null) try { fs.closeSync(fd); } catch (_) { /* foi */ } }
}

/* Registra o produto novo: {nome, tipo ('PLACA'), cliente, vinculo, sigla?, arquivo?}
   -> {item, codigo, sigla, ano, linha, arquivo, copia} */
function registra(o) {
  o = o || {};
  const nome = limpa(o.nome).toUpperCase();
  if (!nome) throw new Error('falta o nome do produto');
  const tipo = limpa(o.tipo || 'PLACA').toUpperCase();
  const c = abre(o.arquivo);
  const sg = o.sigla ? String(o.sigla).toUpperCase().trim() : sigla(nome, tipo);
  if (!siglaOk(sg)) throw new Error('sigla inválida: ' + sg + ' (letras e números, começando por letra)');
  const numero = c.proximo, cod = codigo(sg, c.ano, numero);
  if (c.itens.some(i => normCod(i.modelo) === cod)) throw new Error('o código ' + cod + ' já está no catálogo');
  /* o mesmo produto duas vezes também não (2026-11-05: "não pode deixar repetir"): mesmo nome no mesmo grupo */
  const igual = !o.permitirMesmoNome && c.itens.find(i => limpa(i.nome).toUpperCase() === nome && grupo(i.tipo) === grupo(tipo));
  if (igual) throw new Error('"' + nome + '" já está no catálogo com o código ' + igual.modelo + ' (item ' + igual.item + '): use esse');
  const uso = emUso(c.arquivo);
  if (uso) throw new Error(uso);
  /* a linha: a primeira sem MODELO depois do último produto (as de sobra só têm o ITEM repetido) */
  const ultimaLinha = c.itens.reduce((m, i) => Math.max(m, i.linha), 2);
  const ref = c.linhas.find(l => l.r === ultimaLinha);
  const r = ultimaLinha + 1;
  const est = k => (ref && ref.cel[k] && ref.cel[k].s) || '';
  const cel = (k, v, num) => {
    const s = est(k) ? ' s="' + est(k) + '"' : '';
    if (v === '' || v == null) return s ? '<c r="' + k + r + '"' + s + '/>' : '';
    return num ? '<c r="' + k + r + '"' + s + '><v>' + v + '</v></c>'
      : '<c r="' + k + r + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + escapa(v) + '</t></is></c>';
  };
  const ht = ref && /\bht="([^"]+)"/.exec(ref.xml);
  const linhaXml = '<row r="' + r + '" spans="1:6"' + (ht ? ' ht="' + ht[1] + '" customHeight="1"' : '') + '>'
    + cel('A', numero, true) + cel('B', tipo) + cel('C', nome) + cel('D', limpa(o.cliente).toUpperCase()) + cel('E', cod) + cel('F', limpa(o.vinculo)) + '</row>';
  let xml = c.xml;
  const existente = c.linhas.find(l => l.r === r);
  if (existente) {
    const outros = Object.keys(existente.cel).filter(k => k !== 'A' && existente.cel[k].v !== '');
    if (outros.length) throw new Error('a linha ' + r + ' do catálogo não está livre (tem ' + outros.join(', ') + '): confira a planilha');
    xml = xml.replace(existente.xml, linhaXml);
  } else {
    const prox = c.linhas.find(l => l.r > r);
    xml = prox ? xml.replace(prox.xml, linhaXml + prox.xml) : xml.replace('</sheetData>', linhaXml + '</sheetData>');
  }
  /* a dimensão cobre a linha nova */
  xml = xml.replace(/<dimension ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/, (m, a, b, cc, d) => Number(d) >= r ? m : '<dimension ref="' + a + b + ':' + cc + r + '"/>');
  const copia = gravaPlanilha(c, xml, cod);
  return { item: numero, codigo: cod, sigla: sg, ano: c.ano, linha: r, arquivo: c.arquivo, copia, nome, tipo };
}

/* grava a planilha com o xml novo da aba (o resto do .xlsx igual), conferindo que o texto `deveTer` está nela; guarda
   antes uma cópia em %TEMP%\NexoEletric-catalogo -> o caminho da cópia */
function gravaPlanilha(c, xml, deveTer) {
  const ents = c.ents.map(e => e.nome === c.aba ? Object.assign({}, e, { dados: Buffer.from(xml, 'utf8') }) : e);
  const novo = escreverZip(ents);
  /* confere antes de gravar: o .zip novo se lê e tem o produto */
  const conf = lerZip(novo).find(e => e.nome === c.aba);
  if (!conf || !conf.dados.toString('utf8').includes('>' + escapa(deveTer) + '<')) throw new Error('não consegui montar o catálogo com a mudança');
  const dirCopia = path.join(os.tmpdir(), 'NexoEletric-catalogo');
  fs.mkdirSync(dirCopia, { recursive: true });
  const copia = path.join(dirCopia, 'catalogo-' + new Date().toISOString().replace(/[:.]/g, '-') + '.xlsx');
  fs.copyFileSync(c.arquivo, copia);
  const tmp = path.join(path.dirname(c.arquivo), '~nexo-' + process.pid + '-' + path.basename(c.arquivo));
  fs.writeFileSync(tmp, novo);
  try { fs.renameSync(tmp, c.arquivo); } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) { /* foi */ }
    throw new Error(/EBUSY|EPERM|EACCES/.test(e.code || '') ? 'o catálogo está aberto em outro programa (Excel?): feche e tente de novo' : 'não consegui gravar o catálogo: ' + e.message);
  }
  return copia;
}

/* Muda o código (MODELO) ou o nome de um item que já está no catálogo (2026-11-05: "clicar com o lado direito na lista
   e mudar o código ou o nome do equipamento"): {item, codigo (o de agora, confere que é a mesma linha), novoCodigo?,
   novoNome?}. Código repetido é recusado, como no registrar. -> {item, codigo, nome, linha, copia} */
function edita(o) {
  o = o || {};
  const c = abre(o.arquivo);
  const it = c.itens.find(i => i.item === Number(o.item) && normCod(i.modelo) === normCod(o.codigo));
  if (!it) throw new Error('o item ' + o.item + ' (' + (o.codigo || '?') + ') não está mais no catálogo assim: abra de novo o Definir projeto');
  const novoCod = o.novoCodigo != null ? limpa(o.novoCodigo).toUpperCase() : null;
  const novoNome = o.novoNome != null ? limpa(o.novoNome) : null;
  if (novoCod === null && novoNome === null) throw new Error('nada para mudar');
  if (novoCod !== null) {
    if (!/^[A-Z0-9][A-Z0-9 ._\/-]*$/.test(novoCod)) throw new Error('código inválido: ' + novoCod);
    const outro = c.itens.find(i => i !== it && normCod(i.modelo) === normCod(novoCod));
    if (outro) throw new Error('o código ' + novoCod + ' já é do item ' + outro.item + ' (' + outro.nome + ')');
  }
  if (novoNome !== null && !novoNome) throw new Error('o nome não pode ficar vazio');
  const uso = emUso(c.arquivo);
  if (uso) throw new Error(uso);
  const linha = c.linhas.find(l => l.r === it.linha);
  let row = linha.xml;
  const troca = (col, v) => {
    const s = linha.cel[col] && linha.cel[col].s;
    const nova = '<c r="' + col + it.linha + '"' + (s ? ' s="' + s + '"' : '') + ' t="inlineStr"><is><t xml:space="preserve">' + escapa(v) + '</t></is></c>';
    const re = new RegExp('<c r="' + col + it.linha + '"(?=[\\s/>])(?:[^>]*?/>|[^>]*?>[\\s\\S]*?</c>)');
    if (re.test(row)) { row = row.replace(re, nova); return; }
    /* a célula não existia: entra na ordem das colunas */
    const depois = [...row.matchAll(/<c r="([A-Z]+)\d+"/g)].find(m => m[1] > col);
    row = depois ? row.replace(depois[0], nova + depois[0]) : row.replace('</row>', nova + '</row>');
  };
  if (novoNome !== null) troca('C', novoNome);
  if (novoCod !== null) troca('E', novoCod);
  const xml = c.xml.replace(linha.xml, row);
  const copia = gravaPlanilha(c, xml, novoCod !== null ? novoCod : novoNome);
  return { item: it.item, codigo: novoCod !== null ? novoCod : it.modelo, nome: novoNome !== null ? novoNome : it.nome, linha: it.linha, copia };
}

/* o template DIEletrons preenchido para o projeto novo (os parâmetros do projeto, no cabeçalho do schematic.js) */
function paramsTemplate(o) {
  const d = o.data instanceof Date ? o.data : new Date();
  const dd = n => String(n).padStart(2, '0');
  /* 2026-11-05: o template da casa tem o código da placa (CodigoDaPlaca); o equipamento (nome e código) vem do
     Definir projeto, e o Arquivo é o nome da folha */
  const p = {
    CodigoDaPlaca: o.codigo,
    Desenhista_DiEletrons: limpa(o.iniciador),
    Data_desenho: dd(d.getDate()) + '/' + dd(d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(-2),
    Revisao: 'REV.A',
  };
  if (o.cliente) p.Cliente = limpa(o.cliente).toUpperCase();
  return p;
}

module.exports = { PADRAO, abre, previa, registra, edita, busca, lista, grupo, sigla, codigo, paramsTemplate, lerZip, escreverZip };

/* ============================== a linha de comando ==============================
   node mcp/lib/catalogo.js --cli  < {acao:'previa'|'registra'|'busca'|'lista', nome, tipo?, cliente?, vinculo?, sigla?, codigo?, arquivo?}
   -> uma linha JSON: {ok:true, ...} ou {ok:false, erro} */
if (require.main === module && process.argv.includes('--cli')) {
  let ent = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { ent += d; });
  process.stdin.on('end', () => {
    let r;
    try {
      const a = JSON.parse(ent || '{}');
      r = Object.assign({ ok: true }, a.acao === 'registra' ? registra(a) : a.acao === 'edita' ? edita(a) : a.acao === 'busca' ? busca(a)
        : a.acao === 'lista' ? lista(a) : previa(a));
    } catch (e) { r = { ok: false, erro: String(e && e.message || e) }; }
    process.stdout.write(JSON.stringify(r) + '\n');
  });
}
