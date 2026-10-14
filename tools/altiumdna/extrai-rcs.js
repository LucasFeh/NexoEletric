/* AltiumPCBMirror v2 - tools/altiumdna/extrai-rcs.js — o "DNA" de comandos do Altium, tirado dos .rcs.

   O Altium Designer 21 não guarda os comandos, os menus e as teclas dentro dos executáveis: o
   X2.EXE lê em tempo de execução os arquivos de recursos `System\*.rcs`, que são TEXTO puro
   (as palavras do formato — ShortCut1, TreeCopy, LinkRepeat, UpdatePLSuffix — estão no X2.EXE,
   que é o parser; veja docs/altium-dna/README.md). Este script lê esses .rcs e escreve o
   hub-altiumdna.js, que é DADO VERSIONADO: o hub roda offline e não pode depender de um Altium
   instalado. Rode de novo só quando trocar de versão do Altium.

     node tools/altiumdna/extrai-rcs.js ["C:\Program Files\Altium\AD21\System"] [saida.js]

   O formato .rcs, como medido no AD21:
     PL <id> Command='...' Caption='&...' Shortcut1='...' Shortcut2='...' Params='...' Description='...' End
         um "process launcher": o comando, os parâmetros e as teclas diretas. Pode ocupar várias
         linhas, e BasePL=<id> herda os campos de outro PL (é assim que as variantes _PCAD trocam
         só a tecla).
     PLRepeat <id> Symbol1='%1' BeginIndex1=1 EndIndex1=30 ... End     PLs gerados em série
     Tree <id> Caption='&Place' Popup='P' ... <filhos> End               menu (ou barra, ou teclado)
         Popup='P' é a tecla que, no editor, abre aquele menu solto no cursor: é daí que vem o
         "P,T" do Altium (P abre o Place, T é a letra sublinhada de &Track).
     Link <id> PLID='<pl>' End | Separator <id> End | LinkRepeat ... End
     TreeCopy <id> OriginalID=<tree> ... End                              uma cópia de outra árvore
     Insertion/Change/Deletion                                            ajustes das variantes P-CAD
   Comentário é `//` até o fim da linha (fora de aspas); aspas simples dobradas ('') são uma aspa. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = process.argv[2] || 'C:\\Program Files\\Altium\\AD21\\System';
const SAIDA = process.argv[3] || path.join(__dirname, '..', '..', 'hub-altiumdna.js');

/* ══ 1. O LEITOR DO FORMATO ══ */

/* tira o comentário // (fora de aspas) de cada linha e devolve os tokens com a linha de origem */
function tokens(texto){
  const out = [];
  const linhas = texto.split(/\r?\n/);
  for (let n = 0; n < linhas.length; n++){
    let s = linhas[n], aspas = false, corte = s.length;
    for (let i = 0; i < s.length; i++){
      if (s[i] === "'") aspas = !aspas;
      else if (!aspas && s[i] === '/' && s[i + 1] === '/'){ corte = i; break; }
    }
    s = s.slice(0, corte);
    const re = /([A-Za-z_][\w]*)\s*=\s*('(?:[^']|'')*'|[^\s']+)|('(?:[^']|'')*')|(\S+)/g;
    let m;
    while ((m = re.exec(s))){
      if (m[1]) out.push({ k:m[1], v:tiraAspas(m[2]), linha:n + 1 });
      else if (m[4]) out.push({ w:m[4], linha:n + 1 });
    }
  }
  return out;
}
function tiraAspas(v){ return v[0] === "'" ? v.slice(1, -1).replace(/''/g, "'") : v; }

const FOLHA = new Set(['PL', 'PLRepeat', 'Link', 'LinkRepeat', 'Separator', 'TreeCopy', 'Change', 'Deletion']);
const BLOCO = new Set(['Tree', 'Insertion']);
const ehFim = t => t.w && /^end$/i.test(t.w);

/* Um arquivo .rcs em declarações. Árvore e Insertion têm filhos até o End deles; o resto é
   palavra-chave, id e atributos até o End. */
function leRcs(arquivo){
  const tk = tokens(fs.readFileSync(arquivo, 'latin1'));
  let i = 0;
  function declaracao(){
    const t = tk[i++];
    if (!t.w) return null;                                /* atributo solto: lixo, segue */
    if (ehFim(t)) return null;                            /* End órfão */
    const tipo = t.w;
    if (!FOLHA.has(tipo) && !BLOCO.has(tipo)) return null;
    const d = { tipo, id: tk[i] && tk[i].w ? tk[i++].w : '', at:{}, linha:t.linha, arq:path.basename(arquivo) };
    while (i < tk.length && tk[i].k){ d.at[tk[i].k] = tk[i].v; i++; }
    if (FOLHA.has(tipo)){
      while (i < tk.length && !ehFim(tk[i])) i++;         /* palavra solta antes do End (raro) */
      i++;
      return d;
    }
    d.filhos = [];
    while (i < tk.length){
      if (ehFim(tk[i])){ i++; break; }
      const f = declaracao();
      if (f) d.filhos.push(f);
    }
    return d;
  }
  const decl = [];
  while (i < tk.length){ const d = declaracao(); if (d) decl.push(d); }
  return decl;
}

/* ══ 2. TODOS OS .rcs: PLs e árvores num lugar só (os menus do PCB citam PLs do WorkspaceManager,
   do Client...) ══ */
const PL = new Map(), ARVORE = new Map(), ARQ_PL = new Map();
const arquivos = fs.readdirSync(DIR).filter(f => /\.rcs$/i.test(f)).sort();
const hashes = {};
for (const f of arquivos){
  const cheio = path.join(DIR, f);
  if (/^(AdvPcb|advsch|dxp|WorkspaceManager)\.rcs$/i.test(f))
    hashes[f] = crypto.createHash('sha256').update(fs.readFileSync(cheio)).digest('hex');
  for (const d of leRcs(cheio)){
    if (d.tipo === 'PL') PL.set(d.id, d), ARQ_PL.set(d.id, f);
    else if (d.tipo === 'PLRepeat') PL.set(d.id, d), ARQ_PL.set(d.id, f);
    else if (d.tipo === 'Tree') registraArvore(d);
  }
}
function registraArvore(d){
  if (!ARVORE.has(d.id)) ARVORE.set(d.id, d);
  for (const f of d.filhos || []) if (f.tipo === 'Tree') registraArvore(f);
}
/* o PL efetivo: BasePL herdado, campo do próprio por cima */
function pl(id){
  const d = PL.get(id);
  if (!d) return null;
  if (d.at.BasePL && d.at.BasePL !== id){
    const b = pl(d.at.BasePL);
    if (b) return { id, at:Object.assign({}, b.at, d.at), linha:d.linha, arq:d.arq, base:d.at.BasePL };
  }
  return d;
}

/* ══ 3. (a tecla do Altium -> a do hub mora na API: api.js » teclaHub) ══ */

/* ══ 4. UM EDITOR ══ */
const semE = c => String(c || '').replace(/&&/g, '\u0000').replace(/&/g, '').replace(/\u0000/g, '&').trim();
function mnemonico(c){
  const m = /&([^&])/.exec(String(c || '').replace(/&&/g, ''));
  return m ? m[1].toUpperCase() : '';
}
/* a tecla de Popup= que o editor aceita sozinha (P, F2...), não 'Right_Click' nem 'Alt+Ctrl+K' */
const popupTecla = p => (p && /^([A-Za-z0-9]|F\d{1,2})$/.test(p)) ? p.toUpperCase() : '';

/* A linha de comando, enxuta (a API desfaz): comando igual ao plid sem o 'PL' vira '=', descrição
   igual ao rótulo vira '=', e os campos vazios do fim saem. */
function compacta(c){
  if (c[1] && c[1] === c[0].replace(/^PL/, '')) c[1] = '=';
  if (c[6] && c[6] === c[3]) c[6] = '=';
  while (c.length > 1 && c[c.length - 1] === '') c.pop();
  return c;
}

function extraiEditor(nome, raizes, hotkeys, barras, arquivoPrincipal){
  const usados = new Set();
  const acel = new Map();                                 /* 'P,T' -> plid */
  /* um nó do menu -> forma compacta:
       '-'                         separador
       'PLID'                      item (o rótulo é o caption do comando)
       ['PLID', 'rótulo']          item cujo PL não está nos .rcs
       ['~', 'rótulo']             lista dinâmica (LinkRepeat: arquivos recentes, importadores...)
       [rótulo, popup, filhos, seq] submenu (popup = tecla que o abre sozinho, ou ''; seq = a
                                   sequência que o abre, quando há) */
  function no(d, prefixos, pilha){
    if (d.tipo === 'Separator') return '-';
    if (d.tipo === 'LinkRepeat'){
      const base = String(d.at.PLID || '').replace(/_%1$/, '');
      const r = pl(base);
      return ['~', r ? semE(r.at.Caption).replace(/%1/g, '…') || base : base];
    }
    if (d.tipo === 'Link'){
      const id = d.at.PLID;
      const r = pl(id);
      usados.add(id);
      if (r) for (const p of prefixos){
        const m = mnemonico(r.at.Caption);
        if (m){ const seq = p.concat(m).join(','); if (!acel.has(seq)) acel.set(seq, id); }
      }
      return r ? id : [id, id.replace(/^PL[^:]*:/, '')];
    }
    let t = d;
    if (d.tipo === 'TreeCopy'){
      t = ARVORE.get(d.at.OriginalID);
      if (!t) return null;
    }
    if (t.tipo !== 'Tree') return null;
    if (pilha.includes(t.id)) return null;                /* cópia de si mesma: não acontece, mas não trava */
    const m = mnemonico(t.at.Caption), pk = popupTecla(t.at.Popup);
    const seguintes = prefixos.filter(() => m).map(p => p.concat(m));
    if (pk) seguintes.push([pk]);
    if (t.at.PLID) usados.add(t.at.PLID);
    const filhos = (t.filhos || []).map(f => no(f, seguintes, pilha.concat(t.id))).filter(x => x != null);
    while (filhos[0] === '-') filhos.shift();
    while (filhos[filhos.length - 1] === '-') filhos.pop();
    const seqT = seguintes.map(s => s.join(',')).sort((a, b) => a.length - b.length)[0] || '';
    return seqT ? [semE(t.at.Caption), pk, filhos, seqT] : [semE(t.at.Caption), pk, filhos];
  }
  const menus = {};
  for (const [chave, raiz] of Object.entries(raizes)){
    const t = ARVORE.get(raiz);
    if (!t) throw new Error(nome + ': árvore ' + raiz + ' não achada');
    /* a raiz (PCB Menu, PCB Popups) é um contêiner: as entradas de cima são os menus de verdade */
    menus[chave] = (t.filhos || []).map(f => no(f, [], [t.id])).filter(x => x != null);
    if (chave === 'popups' && menus[chave].length === 1 && Array.isArray(menus[chave][0])) menus[chave] = menus[chave][0][2];
  }
  /* as teclas diretas: as do Shortcut1/2 dos PLs do editor (menu, teclado, barras) */
  const teclado = new Set();
  for (const h of hotkeys){
    const t = ARVORE.get(h);
    (function anda(d){ for (const f of d.filhos || []){ if (f.at.PLID) { usados.add(f.at.PLID); teclado.add(f.at.PLID); } if (f.filhos) anda(f); } })(t);
  }
  /* as barras de ferramentas e a Active Bar: os comandos delas também são do editor */
  for (const b of barras){
    const t = ARVORE.get(b);
    if (t) (function anda(d){ for (const f of d.filhos || []){ if (f.at.PLID) usados.add(f.at.PLID); if (f.tipo === 'TreeCopy' && ARVORE.get(f.at.OriginalID)) anda(ARVORE.get(f.at.OriginalID)); if (f.filhos) anda(f); } })(t);
  }
  /* os comandos: os que o editor alcança (menus, popups, teclado, barras) e os do arquivo dele que
     têm tecla. Fica de fora o resto do arquivo (o editor de biblioteca, o Situs, as variantes
     P-CAD): o módulo vai inteiro para o navegador, e eles não são do editor de placa/folha. */
  const ids = new Set(), doArquivo = [];
  for (const [id, f] of ARQ_PL) if (f === arquivoPrincipal && !/_PCAD$/.test(id) && PL.get(id).tipo === 'PL') doArquivo.push(id);
  for (const id of doArquivo){ const r = pl(id); if (r && (r.at.Shortcut1 || r.at.Shortcut2)) ids.add(id); }
  for (const id of usados) if (PL.has(id) && !/_PCAD$/.test(id)) ids.add(id);
  const comandos = [];
  for (const id of [...ids].sort()){
    const r = pl(id);
    if (!r || r.tipo === 'PLRepeat') continue;
    const a = r.at;
    comandos.push(compacta([id, a.Command || '', a.Params || '', semE(a.Caption), a.Shortcut1 || '', a.Shortcut2 || '', a.Description || '']));
  }
  const teclas = [];
  for (const c of comandos) for (const s of [c[4], c[5]]) if (s) teclas.push([s, c[0]]);
  teclas.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  const aceleradores = [...acel].sort((a, b) => a[0].length - b[0].length || (a[0] < b[0] ? -1 : 1));
  return { comandos, menus, teclas, aceleradores, nTeclado: teclado.size, nArquivo: doArquivo.length };
}

const pcb = extraiEditor('pcb', { principal:'MNPCBMenu', popups:'MNPCBPopup' }, ['HTPCBHotKeys'],
  ['TLPCBToolbar', 'TLPCBWiring', 'TLPCBUtilities', 'TLFilter', 'TopBarPCB', 'MNPCB_Place', 'MNUPCB_CursorSnapPopup', 'MNPCB_FilterPopup'], 'AdvPcb.rcs');
const sch = extraiEditor('sch', { principal:'MNSchematicMenu', popups:'MNSchematicPopup' }, ['HTSchematicHotKeys', 'HTSchInteractiveHotKeys'],
  ['TLSchematicTools', 'TLWiringTools', 'TLSchUtilities', 'TLFormatting', 'TLModeToolbar', 'TopBarSchematic', 'MNSchematic_Place', 'MNSchematic_FilterPanel'], 'advsch.rcs');

/* ══ 5. A SAÍDA ══
   Uma linha por comando, para o diff de uma versão do Altium para outra ser legível. */
const J = v => JSON.stringify(v);
function bloco(nome, e){
  const L = [];
  L.push('  ' + nome + ': {');
  L.push("    /* [plid, comando, params, rótulo, tecla1, tecla2, descrição]; '=' no comando = o plid sem 'PL',");
  L.push("       '=' na descrição = o rótulo; campo vazio do fim omitido */");
  L.push('    comandos: [');
  for (const c of e.comandos) L.push('      ' + J(c) + ',');
  L.push('    ],');
  L.push('    menus: {');
  for (const [k, v] of Object.entries(e.menus)){
    L.push('      ' + k + ': [');
    for (const m of v) L.push('        ' + J(m) + ',');
    L.push('      ],');
  }
  L.push('    },');
  L.push('    /* [tecla do Altium, plid] — Shortcut1/Shortcut2 dos comandos */');
  L.push('    teclas: ' + J(e.teclas) + ',');
  L.push('    /* [sequência, plid] — Popup= do menu + a letra sublinhada de cada nível (P,T = Place » Track) */');
  L.push('    aceleradores: ' + J(e.aceleradores) + ',');
  L.push('  },');
  return L.join('\n');
}
const cab = `/* AltiumPCBMirror v2 - hub-altiumdna.js — o "DNA" de comandos do Altium Designer 21: os comandos,
   os menus e as teclas dos editores PCB e Esquema, como o Altium os define.

   GERADO por tools/altiumdna/extrai-rcs.js a partir dos .rcs de C:\\Program Files\\Altium\\AD21\\System
   (AdvPcb.rcs, advsch.rcs e os que os menus deles citam: dxp.rcs, WorkspaceManager.rcs...). É dado
   VERSIONADO, e não saída de build: o hub roda offline, sem Altium. Não edite à mão; rode o extrator
   de novo. O que é cada campo e de onde veio: docs/altium-dna/README.md.

   sha256 das fontes: ${Object.entries(hashes).map(([f, h]) => f + ' ' + h.slice(0, 16)).join(', ')}

   API (pura, sem DOM; HubAltiumDNA no navegador, module.exports no Node):
     comando(ed, plid)          {plid, comando, params, rotulo, tecla1, tecla2, descricao} ou null
     menu(ed, 'principal'|'popups')   a árvore já resolvida: {rotulo, plid, acelerador, teclas} no item,
                                {rotulo, popup, acelerador, filhos} no submenu, {separador}, {dinamico}
     caminho(ed, plid)          ['Place', 'Track'] — onde o comando mora no menu principal (ou nos popups)
     acelerador(ed, plid)       'P,T' — a sequência mais curta que chega nele, ou ''
     porSequencia(ed, 'P,T')    o comando da sequência, ou null
     teclas(ed, plid)           as teclas diretas do comando, no jeito do Altium ('Shift+Ctrl+L')
     porTecla(ed, tecla)        os comandos de uma tecla direta (aceita 'Ctrl+Shift+L' do hub)
     teclaHub(teclaAltium)      'Shift+Ctrl+L' -> 'Ctrl+Shift+L' (a escrita do HubAtalhos.normalizaTecla)
     busca(ed, texto)           os comandos cujo rótulo, comando ou descrição contém o texto
     contagens()                quantos comandos, teclas e aceleradores, e os menus de cima
     DADOS                      os dados crus (forma compacta, descrita em cada bloco)
   ed = 'pcb' | 'sch'. */
"use strict";
(function (raiz, fabrica) {
  const m = fabrica();
  if (typeof module !== 'undefined' && module.exports) module.exports = m;
  else raiz.HubAltiumDNA = m;
})(typeof self !== 'undefined' ? self : this, function () {

const VERSAO = 'Altium Designer 21 (rcs de ${fs.statSync(path.join(DIR, 'AdvPcb.rcs')).mtime.toISOString().slice(0, 10)})';
const DADOS = {
`;
const funcoes = fs.readFileSync(path.join(__dirname, 'api.js'), 'utf8');
const txt = cab + bloco('pcb', pcb) + '\n' + bloco('sch', sch) + '\n};\n\n' + funcoes;
fs.writeFileSync(SAIDA, txt.replace(/\r?\n/g, '\n'));
const kb = (fs.statSync(SAIDA).size / 1024).toFixed(0);
for (const [n, e] of [['pcb', pcb], ['sch', sch]])
  console.log(n + ': ' + e.comandos.length + ' comandos, ' + e.menus.principal.length + ' menus no principal, '
    + e.teclas.length + ' teclas diretas, ' + e.aceleradores.length + ' aceleradores, ' + e.nTeclado + ' no teclado (' + e.nArquivo + ' PLs no .rcs do editor)');
console.log('arquivos .rcs lidos: ' + arquivos.length + ', PLs: ' + PL.size + ', árvores: ' + ARVORE.size);
console.log(SAIDA + ' (' + kb + ' KB)');
