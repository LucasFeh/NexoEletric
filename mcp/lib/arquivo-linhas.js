/* EletricHUB MCP - arquivo-linhas.js
   Os tres arquivos que a IA edita (changes.js, schematic.js, annotations.js) tem a mesma forma:
   um cabecalho, a abertura do array, UM OBJETO JSON POR LINHA e o fecho. O parser do Altium
   (DelphiScript) le linha a linha, e o usuario escreve no mesmo arquivo pelo hub. Por isso a
   edicao aqui e CIRURGICA: so a linha do objeto muda, entra ou sai; comentario, cabecalho e as
   linhas dos outros ficam byte a byte como estavam. So quando o arquivo nao tem essa forma (alguem
   escreveu o array numa linha so) e que se cai na reserializacao do hub-core, que leva os
   comentarios para cima do array -- o mesmo que o Salvar da vista faz.

   Gravacao atomica (.tmp -> rename), igual ao /api/save do hubserver.py: o vigia dele nunca ve
   meio arquivo, e a vista aberta recarrega sozinha com o arquivo inteiro. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

/* o JSON de uma linha, com >= U+007E escapado como \uXXXX: a MESMA convencao do jline() do
   hub-core e do JS() dos .pas (o TStringList do Delphi le ANSI e quebraria acento cru) */
function jline(obj) {
  return JSON.stringify(obj).replace(/[~-￿]/g,
    c => '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4));
}

/* Le "var X = ...;" e devolve o valor (o mesmo truque do tests/load.js). undefined se nao existe. */
function lerVar(arquivo, nome) {
  if (!fs.existsSync(arquivo)) return undefined;
  const src = fs.readFileSync(arquivo, 'utf8');
  return avaliaVar(src, nome);
}
function avaliaVar(src, nome) {
  if (!nome) {
    const m = /^\s*var\s+([A-Za-z_$][\w$]*)\s*=/m.exec(src);
    if (!m) throw new Error('o arquivo não declara "var X = ..."');
    nome = m[1];
  }
  // eslint-disable-next-line no-new-func
  return new Function(src + '\n;return (typeof ' + nome + ' === "undefined") ? undefined : ' + nome + ';')();
}

function gravaAtomico(arquivo, texto) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const tmp = arquivo + '.tmp';
  fs.writeFileSync(tmp, texto, { encoding: 'utf8' });
  let alvo = arquivo;
  try { if (fs.lstatSync(arquivo).isSymbolicLink()) alvo = fs.realpathSync(arquivo); } catch (_) { /* ainda nao existe */ }
  fs.renameSync(tmp, alvo);
}

/* Formas conhecidas: a abertura e o fecho do array de cada arquivo. */
const FORMAS = {
  changes:     { abre: /^\s*var\s+changes\s*=\s*\[\s*$/, fecha: /^\s*\]\s*;?\s*$/, varNome: 'changes', campo: null },
  annotations: { abre: /^\s*var\s+annotations\s*=\s*\[\s*$/, fecha: /^\s*\]\s*;?\s*$/, varNome: 'annotations', campo: null },
  schematic:   { abre: /^\s*"items"\s*:\s*\[\s*$/, fecha: /^\s*\]\s*\}\s*;?\s*$/, varNome: 'schematic', campo: 'items' },
  projects:    { abre: /^\s*var\s+projects\s*=\s*\[\s*$/, fecha: /^\s*\]\s*;?\s*$/, varNome: 'projects', campo: null },
};

/* Um arquivo de lista aberto para edicao. `itens` sao os objetos na ordem do arquivo; cada um
   sabe a linha de onde veio (`linhas[i]`), e `texto()` remonta o arquivo so trocando o que mudou. */
class ArquivoLinhas {
  constructor(tipo, arquivo, textoAtual) {
    this.tipo = tipo;
    this.forma = FORMAS[tipo];
    if (!this.forma) throw new Error('tipo de arquivo desconhecido: ' + tipo);
    this.arquivo = arquivo;
    this.original = textoAtual;               // null = o arquivo nao existe
    this.cirurgico = false;
    this._parse();
  }
  static abrir(tipo, arquivo) {
    const t = fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8') : null;
    return new ArquivoLinhas(tipo, arquivo, t);
  }
  _parse() {
    const f = this.forma;
    this.valor = this.original == null ? undefined : avaliaVar(this.original, f.varNome);
    const lista = this.valor === undefined ? [] : (f.campo ? (this.valor && this.valor[f.campo]) : this.valor);
    this.itensAvaliados = Array.isArray(lista) ? lista : [];
    if (this.original == null) { this.cirurgico = false; this.itens = []; return; }
    const L = this.original.replace(/\r\n/g, '\n').split('\n');
    const ia = L.findIndex(l => f.abre.test(l));
    let ifc = -1;
    if (ia >= 0) for (let i = L.length - 1; i > ia; i--) if (f.fecha.test(L[i])) { ifc = i; break; }
    const linhasObj = [];
    if (ia >= 0 && ifc > ia) {
      for (let i = ia + 1; i < ifc; i++) {
        const s = L[i].trim();
        if (s.startsWith('{')) linhasObj.push(i);
      }
    }
    /* so e cirurgico se cada objeto avaliado esta numa linha propria e na mesma ordem */
    let ok = ia >= 0 && ifc > ia && linhasObj.length === this.itensAvaliados.length;
    const objs = [];
    if (ok) {
      for (const i of linhasObj) {
        try { objs.push(JSON.parse(L[i].trim().replace(/,\s*$/, ''))); } catch (_) { ok = false; break; }
      }
    }
    this.cirurgico = ok;
    this.L = L; this.ia = ia; this.ifc = ifc;
    if (ok) {
      this.itens = objs;
      this.linhas = linhasObj.map(i => ({ i, texto: L[i], mexido: false }));
    } else {
      this.itens = this.itensAvaliados.map(o => JSON.parse(JSON.stringify(o)));
    }
  }
  /* ----- edicao: a lista `itens` e a verdade; marque o que mudou ----- */
  substitui(idx, obj) {
    if (idx < 0 || idx >= this.itens.length) throw new Error('índice fora da lista: ' + idx);
    this.itens[idx] = obj;
    if (this.cirurgico) this.linhas[idx].mexido = true;
  }
  insere(idx, obj) {
    if (idx == null || idx > this.itens.length) idx = this.itens.length;
    this.itens.splice(idx, 0, obj);
    if (this.cirurgico) this.linhas.splice(idx, 0, { i: null, texto: null, mexido: true });
  }
  remove(idx) {
    if (idx < 0 || idx >= this.itens.length) throw new Error('índice fora da lista: ' + idx);
    this.itens.splice(idx, 1);
    if (this.cirurgico) this.linhas.splice(idx, 1);
  }
  /* o texto novo do arquivo. `cabecalho` = as linhas de um arquivo que ainda nao existe
     (ou o que o hub-core serializaria) -- quem chama passa a funcao de reserializar. */
  texto(reserializa) {
    if (!this.cirurgico) {
      const comentarios = this.original == null ? [] :
        this.original.replace(/\r\n/g, '\n').split('\n').filter(l => /^\s*\/\//.test(l));
      let t = reserializa(this.itens, this.valor);
      if (comentarios.length) {
        const dele = new Set(t.split('\n').filter(l => /^\s*\/\//.test(l)));
        const extra = comentarios.filter(c => !dele.has(c));
        if (extra.length) {
          const ab = t.split('\n').findIndex(l => this.forma.abre.test(l) || /^\s*var\s/.test(l));
          const ls = t.split('\n');
          ls.splice(Math.max(0, ab), 0, ...extra);
          t = ls.join('\n');
        }
      }
      return t;
    }
    const out = this.L.slice(0, this.ia + 1);
    this.itens.forEach((o, k) => {
      const l = this.linhas[k];
      /* linha intocada sai como estava; so ganha a virgula se nao tinha (o ultimo objeto do
         arquivo pode vir sem ela, e com um objeto novo depois dele o JS quebraria) */
      out.push(l.mexido ? jline(o) + ',' : (/,\s*$/.test(l.texto) ? l.texto : l.texto.replace(/\s*$/, ',')));
      /* comentarios e linhas em branco que estavam DEPOIS deste objeto, antes do proximo */
      if (l.i != null) {
        const prox = this.linhas.slice(k + 1).find(x => x.i != null);
        const ate = prox ? prox.i : this.ifc;
        for (let i = l.i + 1; i < ate; i++) if (!this.L[i].trim().startsWith('{')) out.push(this.L[i]);
      }
    });
    /* comentarios entre a abertura e o primeiro objeto */
    const primeiro = this.linhas.find(x => x.i != null);
    const fimTopo = primeiro ? primeiro.i : this.ifc;
    const topo = [];
    for (let i = this.ia + 1; i < fimTopo; i++) if (!this.L[i].trim().startsWith('{')) topo.push(this.L[i]);
    out.splice(this.ia + 1, 0, ...topo);
    for (let i = this.ifc; i < this.L.length; i++) out.push(this.L[i]);
    let t = out.join('\n');
    if (this.original && /\r\n/.test(this.original)) t = t.replace(/\n/g, '\r\n');
    return t;
  }
}

module.exports = { ArquivoLinhas, jline, lerVar, avaliaVar, gravaAtomico, FORMAS };
