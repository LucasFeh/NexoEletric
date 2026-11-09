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
/* A PLANILHA TRAVADA (1.89.0): o Excel aberto deixa os outros lerem (só não gravarem); um programa com o arquivo em uso
   exclusivo não deixa nem ler. Toda leitura boa guarda uma cópia em %TEMP%\NexoEletric-catalogo\ultima-lida-*.xlsx, e a
   leitura que dá EBUSY/EPERM usa essa cópia (c.copia = {arquivo, de}); quem grava (o gravador da fila) pede semCopia. */
const DIR_COPIA = () => path.join(os.tmpdir(), 'NexoEletric-catalogo');
const travado = e => /EBUSY|EPERM|EACCES/.test((e && e.code) || '');
const arqLida = arq => path.join(DIR_COPIA(), 'ultima-lida-' + require('node:crypto').createHash('sha1').update(String(arq).toLowerCase()).digest('hex').slice(0, 12) + '.xlsx');
function leArquivo(arq, o) {
  try {
    const buf = fs.readFileSync(arq);
    try {
      const cp = arqLida(arq);
      let igual = false;
      try { igual = fs.statSync(cp).size === buf.length && fs.readFileSync(cp).equals(buf); } catch (_) { igual = false; }
      if (!igual) { fs.mkdirSync(DIR_COPIA(), { recursive: true }); fs.writeFileSync(cp + '.' + process.pid, buf); fs.renameSync(cp + '.' + process.pid, cp); }
    } catch (_) { /* a cópia é só para quando travar */ }
    return { buf, copia: null };
  } catch (e) {
    if (travado(e) && !(o && o.semCopia)) {
      const cp = arqLida(arq);
      try { return { buf: fs.readFileSync(cp), copia: { arquivo: cp, de: fs.statSync(cp).mtime.toISOString() } }; } catch (_) { /* sem cópia */ }
      throw new Error('o catálogo de produtos (' + arq + ') está aberto em outro programa que não deixa nem ler, e esta máquina ainda não tem uma cópia dele: feche o programa (Excel?) e abra de novo');
    }
    if (travado(e)) throw Object.assign(new Error(MSG_EM_USO), { travado: true });
    throw new Error('não consegui abrir o catálogo de produtos (' + arq + '): ' + (e.code === 'ENOENT' ? 'o arquivo ou a pasta da rede não existe (o NAS 192.168.15.31 está ligado e esta máquina entra em "Controle de Projetos"?)' : e.message));
  }
}
const MSG_EM_USO = 'o catálogo está aberto em outro programa (Excel?): feche e tente de novo';
function itensDe(L) {
  const itens = [];
  for (const l of L) {
    const v = k => limpa(l.cel[k] && l.cel[k].v);
    if (!v('E') || !/^\d+$/.test(v('A'))) continue;
    itens.push({ linha: l.r, item: Number(v('A')), tipo: v('B'), nome: v('C'), cliente: v('D'), modelo: v('E'), vinculo: v('F') });
  }
  return itens;
}
/* o = {semCopia}: sem a cópia da última leitura quando o arquivo está travado (o erro leva .travado) */
function abre(arq, o) {
  arq = arquivo(arq);
  const { buf, copia } = leArquivo(arq, o);
  const ents = lerZip(buf);
  const aba = caminhoAba(ents);
  const ent = ents.find(e => e.nome === aba);
  if (!ent) throw new Error('o catálogo não tem a planilha ' + aba);
  const ss = textos((ents.find(e => e.nome === 'xl/sharedStrings.xml') || { dados: Buffer.alloc(0) }).dados.toString('utf8'));
  return refaz({ arquivo: arq, ents, aba, ss, copia, ano: anoDe(new Date()) }, ent.dados.toString('utf8'));
}
/* o mesmo catálogo com outro xml da aba (o gravador da fila aplica as mudanças uma a uma, antes de gravar) */
function refaz(c, xml) {
  const L = linhas(xml, c.ss);
  const itens = itensDe(L);
  const ultimo = itens.reduce((m, i) => Math.max(m, i.item), 0);
  return Object.assign({}, c, { xml, linhas: L, itens, ultimo, proximo: ultimo + 1 });
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
  return previaDe(c, c.itens, c.ultimo, o);
}
function previaDe(c, itens, ultimo, o) {
  const sg = o.sigla ? String(o.sigla).toUpperCase().trim() : sigla(o.nome || '', o.tipo);
  const u = itens.find(i => i.item === ultimo) || null;
  return { arquivo: c.arquivo, proximo: ultimo + 1, ano: c.ano, sigla: sg, codigo: codigo(sg, c.ano, ultimo + 1),
           ultimo: u && { item: u.item, nome: u.nome, modelo: u.modelo } };
}

/* AS CATEGORIAS DO "DEFINIR PROJETO". A coluna TIPO do catálogo é escrita à mão (Placa, PLACA, PCB; Equipamento,
   EQUIAPAMENTO, Equipmaento; Acessórios, ASSESORIO; CABO; Software; Sistema; Nacionalização...), então a categoria sai de
   uma regra, e não de uma lista fechada.
   1.88.0 (pedido do dono, 2026-11-09: "não, cabos, softwares, sistema, é diferente de equipamento, é só produtos e
   equipamentos que viram 1 só"): o "produto" de antes deixa de existir -- quem era produto (ou tem TIPO "Produto") conta
   como EQUIPAMENTO, e cabo, software, sistema, acessório e nacionalização são categorias PRÓPRIAS, cada uma com o seu
   filtro. Um TIPO que não cai em nenhuma regra vira uma categoria com o próprio nome (o filtro aparece sozinho).
   O agrupamento é NA LEITURA: a planilha não é reescrita; só o que a pessoa cadastra ou edita pela tela grava. */
const CATEGORIAS = [
  { id: 'placa', rotulo: 'Placas', tipo: 'Placa', re: /PLACA|PCB/ },
  { id: 'equipamento', rotulo: 'Equipamentos', tipo: 'Equipamento', re: /EQU?I?A?P|EQUIPM|PRODUTO|REVENDA/ },
  { id: 'sistema', rotulo: 'Sistemas', tipo: 'Sistema', re: /SISTEMA/ },
  { id: 'cabo', rotulo: 'Cabos', tipo: 'Cabo', re: /CABO/ },
  { id: 'software', rotulo: 'Softwares', tipo: 'Software', re: /SOFTWARE/ },
  { id: 'acessorio', rotulo: 'Acessórios', tipo: 'Acessórios', re: /^A[CS]+ES+OR/ },
  { id: 'nacionalizacao', rotulo: 'Nacionalizações', tipo: 'Nacionalização', re: /NACIONALIZ/ },
];
const slugCat = t => semAcento(String(t || '')).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sem-tipo';
function grupo(tipo) {
  const t = semAcento(String(tipo || '')).toUpperCase().trim();
  for (const c of CATEGORIAS) if (c.re.test(t)) return c.id;
  return t ? slugCat(t) : 'equipamento';      /* sem TIPO: o costume da planilha é equipamento */
}
const normCod = s => String(s || '').replace(/\s+/g, '').toUpperCase();
/* as categorias que a lista tem, na ordem da casa (as conhecidas primeiro, as que a planilha inventou depois) */
function categoriasDe(itens) {
  const n = new Map();
  for (const i of itens) n.set(i.grupo, (n.get(i.grupo) || 0) + 1);
  const out = CATEGORIAS.map(c => ({ id: c.id, rotulo: c.rotulo, tipo: c.tipo, n: n.get(c.id) || 0 }));
  for (const [id, q] of n) if (!CATEGORIAS.some(c => c.id === id)) {
    const ex = itens.find(i => i.grupo === id);
    out.push({ id, rotulo: ex ? ex.tipo : id, tipo: ex ? ex.tipo : id, n: q });
  }
  return out;
}

/* SEM LIMITE DE NOME (1.88.0, pedido do dono: "pode remover o limite de caracter no nome"): o limite de 27 caracteres da
   1.82.0 saiu de vez, para placa e equipamento (o quadro da folha agora mostra só o CÓDIGO do equipamento). */

/* A PLACA COMEÇA COM "P" (1.88.0, pedido do dono: "as placa precisam começar com P, se tiver placa começando sem P tá
   errado"): placa nova ou editada com código sem o P é recusada; as antigas ficam marcadas (codigoErrado) na lista. */
const codigoDePlacaOk = c => /^P/.test(normCod(c));
const MSG_PLACA_SEM_P = c => 'o código de placa tem que começar com "P" (' + (c || '—') + ' não começa): placa é P<sigla>-DI<ano><item>, como PAEL-DI261940';

/* MUDAR A CATEGORIA (2026-11-05): a categoria é a coluna TIPO. Se o TIPO de agora já cai na categoria pedida, fica; senão
   vira a palavra da categoria. O código não muda. "produto" (de antes da 1.88.0) é Equipamento. */
function tipoDoGrupo(g, atual) {
  if (g === 'produto') g = 'equipamento';
  const c = CATEGORIAS.find(x => x.id === g);
  if (!c) throw new Error('categoria desconhecida: ' + g + ' (' + CATEGORIAS.map(x => x.id).join(', ') + ')');
  return atual && grupo(atual) === g ? atual : c.tipo;
}

/* o catálogo inteiro, para a tela: {itens:[{item, tipo, grupo, nome, cliente, modelo, vinculo, codigoErrado?}], categorias:[{id,
   rotulo, tipo, n}], ultimo, proximo, ano} */
function itemDaLista(i) {
  const g = grupo(i.tipo);
  const o = { item: i.item, tipo: i.tipo, grupo: g, nome: i.nome, cliente: i.cliente, modelo: i.modelo, vinculo: i.vinculo };
  if (g === 'placa' && !codigoDePlacaOk(i.modelo)) o.codigoErrado = true;
  return o;
}
/* a lista de um catálogo já lido (crus = os itens da planilha, ou com a fila por cima: catalogo-fila.js) */
function listaDe(c, crus, ultimo) {
  const itens = crus.map(i => Object.assign(itemDaLista(i), i.fila ? { fila: i.fila } : {}));
  const u = ultimo != null ? ultimo : c.ultimo;
  return { arquivo: c.arquivo, ultimo: u, proximo: u + 1, ano: c.ano, categorias: categoriasDe(itens), itens, copia: c.copia || null };
}
function lista(o) {
  const c = abre(o && o.arquivo);
  return listaDe(c, c.itens);
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
    return travado(e) ? MSG_EM_USO : null;
  } finally { if (fd != null) try { fs.closeSync(fd); } catch (_) { /* foi */ } }
}

/* O CADASTRO NOVO, em pedaços (1.89.0: a fila do catálogo, mcp/lib/catalogo-fila.js, usa os mesmos):
   novoRegistro(itens, o, ano, numero) confere e monta o item -- itens = a planilha e, com a fila, o que ainda vai ser
   gravado de todas as máquinas; acrescenta(c, d) põe a linha no xml da aba (sem gravar). */
function novoRegistro(itens, o, ano, numero) {
  o = o || {};
  const nome = limpa(o.nome).toUpperCase();
  if (!nome) throw new Error('falta o nome do produto');
  const tipo = limpa(o.tipo || 'PLACA').toUpperCase();
  const sg = o.sigla ? String(o.sigla).toUpperCase().trim() : sigla(nome, tipo);
  if (!siglaOk(sg)) throw new Error('sigla inválida: ' + sg + ' (letras e números, começando por letra)');
  const cod = codigo(sg, ano, numero);
  if (grupo(tipo) === 'placa' && !codigoDePlacaOk(cod)) throw new Error(MSG_PLACA_SEM_P(cod));
  if (itens.some(i => normCod(i.modelo) === cod)) throw new Error('o código ' + cod + ' já está no catálogo');
  /* o mesmo produto duas vezes também não (2026-11-05: "não pode deixar repetir"): mesmo nome no mesmo grupo */
  const igual = !o.permitirMesmoNome && itens.find(i => limpa(i.nome).toUpperCase() === nome && grupo(i.tipo) === grupo(tipo));
  if (igual) throw new Error('"' + nome + '" já está no catálogo com o código ' + igual.modelo + ' (item ' + igual.item + '): use esse');
  return { item: numero, codigo: cod, sigla: sg, ano, nome, tipo, cliente: limpa(o.cliente).toUpperCase(), vinculo: limpa(o.vinculo) };
}
/* a linha nova no xml (d = o de novoRegistro): a primeira sem MODELO depois do último produto (as de sobra só têm o ITEM
   repetido), com os estilos e a altura da linha do produto anterior -> {xml, linha} */
function acrescenta(c, d) {
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
    + cel('A', d.item, true) + cel('B', d.tipo) + cel('C', d.nome) + cel('D', d.cliente) + cel('E', d.codigo) + cel('F', d.vinculo) + '</row>';
  let xml = c.xml;
  const existente = c.linhas.find(l => l.r === r);
  if (existente) {
    const outros = Object.keys(existente.cel).filter(k => k !== 'A' && existente.cel[k].v !== '');
    if (outros.length) throw new Error('a linha ' + r + ' do catálogo não está livre (tem ' + outros.join(', ') + '): confira a planilha');
    xml = xml.replace(existente.xml, () => linhaXml);
  } else {
    const prox = c.linhas.find(l => l.r > r);
    xml = prox ? xml.replace(prox.xml, () => linhaXml + prox.xml) : xml.replace('</sheetData>', () => linhaXml + '</sheetData>');
  }
  /* a dimensão cobre a linha nova */
  xml = xml.replace(/<dimension ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/, (m, a, b, cc, dd) => Number(dd) >= r ? m : '<dimension ref="' + a + b + ':' + cc + r + '"/>');
  return { xml, linha: r };
}

/* Registra o produto novo DIRETO na planilha: {nome, tipo ('PLACA'), cliente, vinculo, sigla?, arquivo?}
   -> {item, codigo, sigla, ano, linha, arquivo, copia}. Com a planilha aberta no Excel, recusa (MSG_EM_USO); a fila do
   catálogo (catalogo-fila.js » registra) é quem não recusa. */
function registra(o) {
  o = o || {};
  const c = abre(o.arquivo);
  const d = novoRegistro(c.itens, o, c.ano, c.proximo);
  const uso = emUso(c.arquivo);
  if (uso) throw Object.assign(new Error(uso), { travado: true });
  const { xml, linha } = acrescenta(c, d);
  const copia = gravaPlanilha(c, xml, [d.codigo]);
  return { item: d.item, codigo: d.codigo, sigla: d.sigla, ano: c.ano, linha, arquivo: c.arquivo, copia, nome: d.nome, tipo: d.tipo };
}

/* grava a planilha com o xml novo da aba (o resto do .xlsx igual), conferindo que os textos `deveTer` estão nela;
   guarda antes uma cópia em %TEMP%\NexoEletric-catalogo -> o caminho da cópia. Arquivo em uso: o erro leva .travado */
function gravaPlanilha(c, xml, deveTer) {
  const ents = c.ents.map(e => e.nome === c.aba ? Object.assign({}, e, { dados: Buffer.from(xml, 'utf8') }) : e);
  const novo = escreverZip(ents);
  /* confere antes de gravar: o .zip novo se lê e tem o produto */
  const conf = lerZip(novo).find(e => e.nome === c.aba);
  const txt = conf ? conf.dados.toString('utf8') : '';
  if (!conf || [].concat(deveTer).some(t => !txt.includes('>' + escapa(t) + '<'))) throw new Error('não consegui montar o catálogo com a mudança');
  const dirCopia = DIR_COPIA();
  fs.mkdirSync(dirCopia, { recursive: true });
  const copia = path.join(dirCopia, 'catalogo-' + new Date().toISOString().replace(/[:.]/g, '-') + '.xlsx');
  try { fs.copyFileSync(c.arquivo, copia); } catch (e) {
    if (travado(e)) throw Object.assign(new Error(MSG_EM_USO), { travado: true });
    throw e;
  }
  const tmp = path.join(path.dirname(c.arquivo), '~nexo-' + process.pid + '-' + path.basename(c.arquivo));
  fs.writeFileSync(tmp, novo);
  try { fs.renameSync(tmp, c.arquivo); } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) { /* foi */ }
    if (travado(e)) throw Object.assign(new Error(MSG_EM_USO), { travado: true });
    throw new Error('não consegui gravar o catálogo: ' + e.message);
  }
  return copia;
}

/* A EDIÇÃO, em pedaços (a fila usa os mesmos): validaEdicao(itens, it, o) confere contra a lista (a planilha e, com a fila,
   o que está para gravar) -> {codigo?, nome?, tipo?} (só o que muda); mudaLinha(c, it, m) troca as células no xml. */
function validaEdicao(itens, it, o) {
  const novoCod = o.novoCodigo != null ? limpa(o.novoCodigo).toUpperCase() : null;
  const novoNome = o.novoNome != null ? limpa(o.novoNome) : null;
  let novoTipo = o.novoGrupo != null ? tipoDoGrupo(String(o.novoGrupo), it.tipo) : null;
  if (novoTipo === it.tipo) novoTipo = null;          /* já está nessa categoria */
  if (novoCod === null && novoNome === null && novoTipo === null) throw new Error(o.novoGrupo != null ? 'o item já é dessa categoria' : 'nada para mudar');
  if (novoCod !== null) {
    if (!/^[A-Z0-9][A-Z0-9 ._\/-]*$/.test(novoCod)) throw new Error('código inválido: ' + novoCod);
    const outro = itens.find(i => i !== it && !(i.item === it.item && normCod(i.modelo) === normCod(it.modelo)) && normCod(i.modelo) === normCod(novoCod));
    if (outro) throw new Error('o código ' + novoCod + ' já é do item ' + outro.item + ' (' + outro.nome + ')');
  }
  if (novoNome !== null && !novoNome) throw new Error('o nome não pode ficar vazio');
  /* placa com código sem o P: recusada quando a edição mexe no código ou faz do item uma placa (só o nome, não) */
  if ((novoCod !== null || novoTipo !== null) && grupo(novoTipo !== null ? novoTipo : it.tipo) === 'placa'
      && !codigoDePlacaOk(novoCod !== null ? novoCod : it.modelo)) throw new Error(MSG_PLACA_SEM_P(novoCod !== null ? novoCod : it.modelo));
  const m = {};
  if (novoCod !== null && novoCod !== it.modelo) m.codigo = novoCod;
  if (novoNome !== null && novoNome !== it.nome) m.nome = novoNome;
  if (novoTipo !== null) m.tipo = novoTipo;
  if (!Object.keys(m).length) throw new Error('nada para mudar');
  return m;
}
function mudaLinha(c, it, m) {
  const linha = c.linhas.find(l => l.r === it.linha);
  if (!linha) throw new Error('a linha ' + it.linha + ' do item ' + it.item + ' sumiu da planilha');
  let row = linha.xml;
  const troca = (col, v) => {
    const s = linha.cel[col] && linha.cel[col].s;
    const nova = '<c r="' + col + it.linha + '"' + (s ? ' s="' + s + '"' : '') + ' t="inlineStr"><is><t xml:space="preserve">' + escapa(v) + '</t></is></c>';
    const re = new RegExp('<c r="' + col + it.linha + '"(?=[\\s/>])(?:[^>]*?/>|[^>]*?>[\\s\\S]*?</c>)');
    if (re.test(row)) { row = row.replace(re, () => nova); return; }
    /* a célula não existia: entra na ordem das colunas */
    const depois = [...row.matchAll(/<c r="([A-Z]+)\d+"/g)].find(x => x[1] > col);
    row = depois ? row.replace(depois[0], () => nova + depois[0]) : row.replace('</row>', () => nova + '</row>');
  };
  if (m.nome != null) troca('C', m.nome);
  if (m.codigo != null) troca('E', m.codigo);
  if (m.tipo != null) troca('B', m.tipo);
  return c.xml.replace(linha.xml, () => row);
}

/* Muda o código (MODELO), o nome ou a categoria de um item DIRETO na planilha (2026-11-05: "clicar com o lado direito na
   lista e mudar o código ou o nome do equipamento"): {item, codigo (o de agora, confere que é a mesma linha), novoCodigo?,
   novoNome?, novoGrupo?}. Código repetido é recusado, como no registrar. -> {item, codigo, nome, tipo, grupo, linha, copia} */
function edita(o) {
  o = o || {};
  const c = abre(o.arquivo);
  const it = c.itens.find(i => i.item === Number(o.item) && normCod(i.modelo) === normCod(o.codigo));
  if (!it) throw new Error('o item ' + o.item + ' (' + (o.codigo || '?') + ') não está mais no catálogo assim: abra de novo o Definir projeto');
  const m = validaEdicao(c.itens, it, o);
  const uso = emUso(c.arquivo);
  if (uso) throw Object.assign(new Error(uso), { travado: true });
  const xml = mudaLinha(c, it, m);
  const copia = gravaPlanilha(c, xml, [m.codigo != null ? m.codigo : m.nome != null ? m.nome : m.tipo]);
  const tipo = m.tipo != null ? m.tipo : it.tipo;
  return { item: it.item, codigo: m.codigo != null ? m.codigo : it.modelo, nome: m.nome != null ? m.nome : it.nome,
           tipo, grupo: grupo(tipo), linha: it.linha, copia };
}

/* o template DIEletrons preenchido para o projeto novo (os parâmetros do projeto, no cabeçalho do schematic.js) */
function paramsTemplate(o) {
  const d = o.data instanceof Date ? o.data : new Date();
  const dd = n => String(n).padStart(2, '0');
  /* 2026-11-05: o template da casa tem o código da placa (CodigoDaPlaca); o equipamento (nome e código) vem do
     Definir projeto, e o Arquivo é o nome da folha */
  const p = {
    CodigoDaPlaca: o.codigo,
    /* 1.88.0: o nome da PCB (o do catálogo, sem limite de tamanho) dá o nome do projeto na árvore; não vai ao quadro */
    NomeDaPlaca: limpa(o.nome).toUpperCase() || undefined,
    Desenhista_DiEletrons: limpa(o.iniciador),
    Data_desenho: dd(d.getDate()) + '/' + dd(d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(-2),
    Revisao: 'REV.A',
  };
  if (o.cliente) p.Cliente = limpa(o.cliente).toUpperCase();
  if (!p.NomeDaPlaca) delete p.NomeDaPlaca;
  return p;
}

module.exports = { PADRAO, MSG_EM_USO, abre, refaz, previa, previaDe, registra, edita, busca, lista, listaDe, novoRegistro, acrescenta, validaEdicao, mudaLinha, gravaPlanilha, emUso, normCod, grupo, tipoDoGrupo, CATEGORIAS, categoriasDe, codigoDePlacaOk, sigla, codigo, paramsTemplate, lerZip, escreverZip };

/* ============================== a linha de comando ==============================
   node mcp/lib/catalogo.js --cli  < {acao, ...} -> uma linha JSON: {ok:true, ...} ou {ok:false, erro, conflito?}
   acao: 'previa' | 'registra' | 'edita' | 'busca' | 'lista' (1.89.0: pela fila do catálogo no NexoBD, catalogo-fila.js:
   a planilha aberta no Excel não impede) | 'fila' (o estado da fila) | 'fila-gravar' (o gravador: o hubserver roda a cada
   45 s) | 'fila-resolver' {id, como: descartar|tentar|por-cima} */
if (require.main === module && process.argv.includes('--cli')) {
  let ent = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { ent += d; });
  process.stdin.on('end', async () => {
    let r;
    try {
      const a = JSON.parse(ent || '{}');
      const F = require('./catalogo-fila.js');
      const fn = { registra: F.registra, edita: F.edita, busca: F.busca, lista: F.lista, previa: F.previa, fila: F.estado,
                   'fila-gravar': F.grava, 'fila-resolver': F.resolve }[a.acao || 'previa'];
      if (!fn) throw new Error('ação desconhecida: ' + a.acao);
      r = Object.assign({ ok: true }, await fn(a));
    } catch (e) { r = { ok: false, erro: String(e && e.message || e) }; if (e && e.conflito) r.conflito = true; }
    process.stdout.write(JSON.stringify(r) + '\n', () => process.exit(0));
  });
}
