/* AltiumPCBMirror v2 - hub-core.js
   Logica pura compartilhada pelo hub (browser, global HubCore) e pelos testes (node).
   NAO acessa DOM. Contratos: esquema em mil (Y para cima), PCB em mm (Y para cima).
   A extracao de nets e um PREVIEW - a verdade e sempre o compilador do Altium. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HubCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
"use strict";

const TOL = 1e-3, TOL_ANG = 1e-2;  // PCB (mm)
const STOL = 0.5;                   // esquema (mil)

function near(a, b, t){ return Math.abs(a - b) <= (t || TOL); }
function nearAng(a, b){ let d = Math.abs(a - b) % 360; if (d > 180) d = 360 - d; return d <= TOL_ANG; }
function isNum(v){ return typeof v === 'number' && isFinite(v); }
function distSeg(px, py, x1, y1, x2, y2){
  const dx = x2 - x1, dy = y2 - y1, l2 = dx*dx + dy*dy;
  let t = l2 ? ((px-x1)*dx + (py-y1)*dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x1 + t*dx - px, y1 + t*dy - py);
}

/* Tamanhos NOMEADOS de folha do Altium em mil [largura, altura] — o legado, nao o ISO real.
   Isto e FALLBACK, nao a verdade: os templates da casa usam folha CUSTOM (a "A4" deles e a
   ISO de verdade, 297x210 mm = 11693x8268 mil), e uma folha custom nao tem nome nenhum a
   consultar aqui. Quem sabe a medida e o Altium — o ExportProject emite w/h junto do size, e
   sheetSize() abaixo prefere esses numeros. A tabela so responde por espelho antigo. */
const SHEET_SIZES = { A4:[11500,7600], A3:[15500,11000], A2:[22000,15500], A1:[31000,22000],
                      A0:[44000,31000],
                      A:[9500,7500], B:[15000,9500], C:[20000,15000], D:[32000,20000],
                      E:[42000,32000] };

/* Medida da folha, com a precedencia num lugar so: w/h medidos no Altium > tabela por nome
   > A4. Sem isto cada vista repetiria a regra e uma delas ficaria para tras. */
function sheetSize(s){
  if (s && isNum(s.w) && s.w > 0 && isNum(s.h) && s.h > 0) return [s.w, s.h];
  return SHEET_SIZES[s && s.size] || SHEET_SIZES.A4;
}
const ORIENT_DIR = { 0:[1,0], 90:[0,1], 180:[-1,0], 270:[0,-1] };

/* ============ PCB: board + changes -> modelo efetivo (port do viewer v1) ============ */

function applyPcbChanges(board, changes){
  const B = board || {};
  const CH = Array.isArray(changes) ? changes : [];
  const model = { comps:[], compByRef:{}, tracks:[], arcs:[], vias:[], texts:[], added:[],
                  validation:[], changeItems:[],
                  outline:((B.board && B.board.outline) || []).slice(), outlineChanged:false };
  for (const c of (B.components || [])) {
    const m = { kind:'comp', src:c, eff:{ x:c.x, y:c.y, rot:c.rot, layer:c.layer }, changed:false, attrChanged:false };
    model.comps.push(m); model.compByRef[c.ref] = m;
  }
  const byId = {};
  for (const t of (B.tracks || [])) { const m = { kind:'track', src:t, eff:{...t}, changed:false, deleted:false }; model.tracks.push(m); byId[t.id] = m; }
  for (const a of (B.arcs  || [])) { const m = { kind:'arc',   src:a, eff:{...a}, changed:false, deleted:false }; model.arcs.push(m);  byId[a.id] = m; }
  for (const v of (B.vias  || [])) { const m = { kind:'via',   src:v, eff:{...v}, changed:false, deleted:false }; model.vias.push(m);  byId[v.id] = m; }
  for (const x of (B.texts || [])) { const m = { kind:'text',  src:x, eff:{...x}, changed:false }; model.texts.push(m); byId[x.id] = m; }

  let addSeq = 0;
  CH.forEach((ch, idx) => {
    const item = { ch, idx, status:'ok', msg:'', target:null };
    model.changeItems.push(item);
    const bad  = (m) => { item.status='err'; item.msg=m; model.validation.push({ level:'err', msg:`#${idx+1} ${ch.op||'?'}: ${m}`, target:item.target }); };
    const warn = (m) => { if (item.status!=='err') item.status='warn'; item.msg=m; model.validation.push({ level:'warn', msg:`#${idx+1} ${ch.op}: ${m}`, target:item.target }); };

    switch (ch.op) {
      case 'comp_move': {
        const m = model.compByRef[ch.ref];
        if (!m) return bad(`componente "${ch.ref}" não existe no board.js`);
        item.target = m;
        if (!isNum(ch.orig_x)||!isNum(ch.orig_y)||!isNum(ch.orig_rot)||!ch.orig_layer)
          return bad('faltam orig_x/orig_y/orig_rot/orig_layer (copie do board.js)');
        if (!near(ch.orig_x,m.src.x)||!near(ch.orig_y,m.src.y)||!nearAng(ch.orig_rot,m.src.rot)||ch.orig_layer!==m.src.layer)
          warn('orig_* não confere com o board.js — espelho pode estar desatualizado');
        if (isNum(ch.x)) m.eff.x = ch.x;
        if (isNum(ch.y)) m.eff.y = ch.y;
        if (isNum(ch.rot)) m.eff.rot = ch.rot;
        if (ch.layer) m.eff.layer = ch.layer;
        m.changed = !(near(m.eff.x,m.src.x)&&near(m.eff.y,m.src.y)&&nearAng(m.eff.rot,m.src.rot)&&m.eff.layer===m.src.layer);
        break;
      }
      case 'comp_attr': {
        // Nota de design: no motor JS a ordem não importa — compByRef é chaveado pelo ref do board.js
        // e as demais ops também procuram pelo ref do board; só o .pas precisa aplicar renames por último.
        const m = model.compByRef[ch.ref];
        if (!m) return bad(`componente "${ch.ref}" não existe no board.js`);
        item.target = m;
        if (typeof ch.orig_designator !== 'string' || typeof ch.orig_comment !== 'string')
          return bad('faltam orig_designator/orig_comment (copie do board.js)');
        if (ch.orig_designator !== m.src.ref || ch.orig_comment !== (m.src.comment || ''))
          warn('orig_* não confere com o board.js — espelho pode estar desatualizado');
        if (typeof ch.designator === 'string' && ch.designator) m.eff.designator = ch.designator;
        if (typeof ch.comment === 'string') m.eff.comment = ch.comment;
        m.attrChanged = (m.eff.designator !== undefined && m.eff.designator !== m.src.ref) ||
                        (m.eff.comment !== undefined && m.eff.comment !== (m.src.comment || ''));
        break;
      }
      case 'track_edit': case 'track_del': {
        let m = ch.id ? byId[ch.id] : null;
        if (m && m.kind!=='track') m = null;
        if (!m) return bad(`trilha id "${ch.id}" não existe no board.js`);
        item.target = m;
        for (const k of ['x1','y1','x2','y2','w'])
          if (!isNum(ch['orig_'+k])) return bad('faltam campos orig_* (copie do board.js)');
        if (!ch.orig_layer) return bad('falta orig_layer');
        const s = m.src;
        const direct = near(ch.orig_x1,s.x1)&&near(ch.orig_y1,s.y1)&&near(ch.orig_x2,s.x2)&&near(ch.orig_y2,s.y2);
        const rev    = near(ch.orig_x1,s.x2)&&near(ch.orig_y1,s.y2)&&near(ch.orig_x2,s.x1)&&near(ch.orig_y2,s.y1);
        if (!(direct||rev) || !near(ch.orig_w,s.w) || ch.orig_layer!==s.layer)
          warn('orig_* não confere com o board.js');
        if (ch.op==='track_del'){ m.deleted = true; break; }
        for (const k of ['x1','y1','x2','y2','w']) if (isNum(ch[k])) m.eff[k] = ch[k];
        if (ch.layer) m.eff.layer = ch.layer;
        if (typeof ch.net==='string') m.eff.net = ch.net;
        m.changed = true;
        break;
      }
      case 'track_add': {
        for (const k of ['x1','y1','x2','y2','w']) if (!isNum(ch[k])) return bad(`campo "${k}" ausente/inválido`);
        if (ch.layer!=='Top' && ch.layer!=='Bottom') return bad('layer deve ser Top ou Bottom');
        if (ch.w<=0) return bad('largura w deve ser > 0');
        const m = { kind:'track', src:null, eff:{ id:'new-t'+(++addSeq), ...ch }, changed:false, added:true };
        model.added.push(m); item.target = m;
        break;
      }
      case 'via_edit': case 'via_del': {
        let m = ch.id ? byId[ch.id] : null;
        if (m && m.kind!=='via') m = null;
        if (!m) return bad(`via id "${ch.id}" não existe no board.js`);
        item.target = m;
        if (!isNum(ch.orig_x)||!isNum(ch.orig_y)) return bad('faltam orig_x/orig_y');
        if (!near(ch.orig_x,m.src.x)||!near(ch.orig_y,m.src.y)) warn('orig_* não confere com o board.js');
        if (ch.op==='via_del'){ m.deleted = true; break; }
        for (const k of ['x','y','size','drill']) if (isNum(ch[k])) m.eff[k] = ch[k];
        m.changed = true;
        break;
      }
      case 'via_add': {
        for (const k of ['x','y','size','drill']) if (!isNum(ch[k])) return bad(`campo "${k}" ausente/inválido`);
        if (ch.drill>=ch.size) warn('drill >= size (anel nulo)');
        const m = { kind:'via', src:null, eff:{ id:'new-v'+(++addSeq), from:'Top', to:'Bottom', ...ch }, changed:false, added:true };
        model.added.push(m); item.target = m;
        break;
      }
      case 'arc_edit': case 'arc_del': {
        let m = ch.id ? byId[ch.id] : null;
        if (m && m.kind!=='arc') m = null;
        if (!m) return bad(`arco id "${ch.id}" não existe no board.js`);
        item.target = m;
        for (const k of ['cx','cy','r','sa','ea']) if (!isNum(ch['orig_'+k])) return bad('faltam campos orig_*');
        if (!ch.orig_layer) return bad('falta orig_layer');
        const s = m.src;
        if (!near(ch.orig_cx,s.cx)||!near(ch.orig_cy,s.cy)||!near(ch.orig_r,s.r)||
            !nearAng(ch.orig_sa,s.sa)||!nearAng(ch.orig_ea,s.ea)||ch.orig_layer!==s.layer)
          warn('orig_* não confere com o board.js');
        if (ch.op==='arc_del'){ m.deleted = true; break; }
        for (const k of ['cx','cy','r','sa','ea','w']) if (isNum(ch[k])) m.eff[k] = ch[k];
        if (ch.layer) m.eff.layer = ch.layer;
        m.changed = true;
        break;
      }
      case 'arc_add': {
        for (const k of ['cx','cy','r','sa','ea','w']) if (!isNum(ch[k])) return bad(`campo "${k}" ausente/inválido`);
        if (ch.layer!=='Top' && ch.layer!=='Bottom') return bad('layer deve ser Top ou Bottom');
        const m = { kind:'arc', src:null, eff:{ id:'new-a'+(++addSeq), ...ch }, changed:false, added:true };
        model.added.push(m); item.target = m;
        break;
      }
      case 'text_edit': {
        let m = ch.id ? byId[ch.id] : null;
        if (m && m.kind!=='text') m = null;
        if (!m) return bad(`texto id "${ch.id}" não existe no board.js`);
        item.target = m;
        if (!isNum(ch.orig_x)||!isNum(ch.orig_y)||!ch.orig_layer||typeof ch.orig_text!=='string')
          return bad('faltam orig_x/orig_y/orig_text/orig_layer (copie do board.js)');
        const s = m.src;
        if (s.designator || s.comment)
          return bad('só textos livres podem ser editados (este pertence a um componente)');
        if (!near(ch.orig_x,s.x)||!near(ch.orig_y,s.y)||ch.orig_layer!==s.layer||ch.orig_text!==s.text)
          warn('orig_* não confere com o board.js — espelho pode estar desatualizado');
        if (typeof ch.text==='string') m.eff.text = ch.text;
        for (const k of ['x','y','h','rot','w']) if (isNum(ch[k])) m.eff[k] = ch[k];
        m.changed = true;
        break;
      }
      case 'designator_move': {
        const m = model.texts.find(t => t.src.designator && t.src.owner === ch.ref);
        if (!m) return bad(`designator do componente "${ch.ref}" não existe no board.js`);
        item.target = m;
        if (!isNum(ch.orig_x)||!isNum(ch.orig_y))
          return bad('faltam orig_x/orig_y (copie do item do designator em board.js » texts)');
        if (!near(ch.orig_x,m.src.x)||!near(ch.orig_y,m.src.y))
          warn('orig_* não confere com o board.js — espelho pode estar desatualizado');
        for (const k of ['x','y','h','rot']) if (isNum(ch[k])) m.eff[k] = ch[k];
        m.changed = true;
        break;
      }
      case 'outline_set': {
        if (!Array.isArray(ch.pts) || ch.pts.length < 3 ||
            ch.pts.some(p => !Array.isArray(p) || !isNum(p[0]) || !isNum(p[1])))
          return bad('pts deve ser [[x,y],...] com >= 3 vértices');
        const segs = [];
        for (let i = 0; i < ch.pts.length; i++) {
          const a = ch.pts[i], b = ch.pts[(i+1) % ch.pts.length];
          segs.push({ kind:'line', x1:a[0], y1:a[1], x2:b[0], y2:b[1] });
        }
        model.outline = segs; model.outlineChanged = true;
        break;
      }
      default:
        bad(`operação desconhecida "${ch.op}"`);
    }
  });
  return model;
}

/* ---- preview de comp movido (vista PCB); model = retorno de applyPcbChanges ---- */
function compDelta(m){
  const dr = m.eff.rot - m.src.rot;
  const flip = m.eff.layer !== m.src.layer;
  return { ox:m.src.x, oy:m.src.y, nx:m.eff.x, ny:m.eff.y, dr, flip,
           cos:Math.cos(dr*Math.PI/180), sin:Math.sin(dr*Math.PI/180) };
}
function xfPoint(d, x, y){
  let lx = x - d.ox, ly = y - d.oy;
  if (d.flip) lx = -lx;
  return { x: d.nx + lx*d.cos - ly*d.sin, y: d.ny + lx*d.sin + ly*d.cos };
}
function xfAngle(d, ang){ return d.flip ? (180 - ang + d.dr) : (ang + d.dr); }
function ownerDelta(model, ref){
  if (!ref) return null;
  const m = model.compByRef[ref];
  if (!m || !m.changed) return null;
  return compDelta(m);
}
function effLayerForOwner(model, ref, layer){
  const m = ref ? model.compByRef[ref] : null;
  if (!m || !m.changed) return layer;
  if (m.eff.layer === m.src.layer) return layer;
  const map = { Top:'Bottom', Bottom:'Top', TopOverlay:'BottomOverlay', BottomOverlay:'TopOverlay' };
  return map[layer] || layer;
}

/* ============ Esquema: libs, transform e extracao de nets (preview) ============ */

/* ══════════ resolucao de nome de biblioteca ══════════
   O espelho e a biblioteca mestra do Altium falam vocabularios diferentes. O RenameLibs
   padronizou 152 simbolos e 170 footprints, mas so no ESPELHO: a .SchLib/.PcbLib de
   verdade continua com os nomes antigos, que sao justamente os que os projetos exportados
   referenciam ("CAP [  SMD  ]" contra "CAP [SMD]"). Projeto escrito DEPOIS do rename
   referencia o nome novo. Os dois vocabularios estao em uso ao mesmo tempo, entao casar
   por igualdade exata condena metade a "ausente" - e ausente aqui nao e um aviso: o
   simbolo vira um quadrado vermelho sem pinos na folha, o componente e pulado inteiro na
   extracao de nets (produzindo net faltando sem dizer nada) e a validacao aborta o resto
   das checagens daquele componente.

   A cascata, em ordem de autoridade:
     1. substituicao escolhida por uma pessoa (Libs/lib-subs.js) - decisao explicita
     2. nome exato
     3. rename-map, UM salto so, nos dois sentidos (antigo->novo e novo->antigo)
     4. chave normalizada, e SO quando ela aponta para um unico item

   O passo 3 e um salto so de proposito: no rename-map "INDUTOR MODO COMUM" e nome novo de
   uma entrada e nome antigo de outra, e encadear seguiria para o item errado.

   O passo 4 se recusa a chutar. Na PcbLib real a chave normalizada junta "SOIC 8" com
   "SOIC - 8", "TO-220AB" com "TO\u2013220AB" (travessao), "CAP EL 2mm L11.5 D5" com o mesmo
   nome de dois espacos e "CONE-TE-1-5745967-0" com "CONE - TE - 1-5745967-0" - 4 pares.
   Escolher um dos dois no chute poe o footprint errado na placa; empate vira `ambiguo` e
   cai no fluxo de substituicao manual, que e onde uma pessoa decide. Nos simbolos a chave
   nao colide (404 nomes, 404 chaves), entao la o passo 4 sempre decide sozinho. */

/* Porte literal da NormKey do RenameLibs.pas:37-56, para JS e Pascal concordarem sobre o
   que e "o mesmo nome". Ela dobra acento por FAIXA DE BYTE Latin-1 (nao por Unicode), e o
   UpCase do Delphi so mexe em a-z ASCII - por isso a minuscula acentuada e pega pelas
   faixas 224-252 e nao por toUpperCase(). Nao troque por NFD+strip: o resultado diverge em
   'sz' (223) e 'y' com trema (255), que a NormKey NAO trata. */
function normKey(s){
  const t = String(s == null ? '' : s);
  let r = '';
  for (let i = 0; i < t.length; i++){
    let c = t.charAt(i);
    if (c >= 'a' && c <= 'z') c = c.toUpperCase();
    const o = c.charCodeAt(0);
    if      ((o >= 192 && o <= 198) || (o >= 224 && o <= 230)) c = 'A';
    else if (o === 199 || o === 231)                           c = 'C';
    else if ((o >= 200 && o <= 203) || (o >= 232 && o <= 235)) c = 'E';
    else if ((o >= 204 && o <= 207) || (o >= 236 && o <= 239)) c = 'I';
    else if (o === 209 || o === 241)                           c = 'N';
    else if ((o >= 210 && o <= 216) || (o >= 242 && o <= 248)) c = 'O';
    else if ((o >= 217 && o <= 220) || (o >= 249 && o <= 252)) c = 'U';
    if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) r += c;
  }
  return r;
}

/* Indice por nome e por chave, montado UMA vez por lista (a lib tem 401 simbolos e 618
   footprints, e o find() linear de antes rodava por componente desenhado). A chave guarda
   TODOS os candidatos - quem decide se um empate pode ser usado e o resolvedor, nao aqui. */
const LIB_IDX = (typeof WeakMap === 'function') ? new WeakMap() : null;
function libIndex(list){
  const arr = list || [];
  if (LIB_IDX && LIB_IDX.has(arr)) return LIB_IDX.get(arr);
  const byName = new Map(), byKey = new Map();
  for (const it of arr){
    if (!it || typeof it.name !== 'string') continue;
    if (!byName.has(it.name)) byName.set(it.name, it);
    const k = normKey(it.name);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(it);
  }
  const idx = { byName, byKey };
  if (LIB_IDX) LIB_IDX.set(arr, idx);
  return idx;
}

/* Tabelas de apelido, que valem para o espelho inteiro e nao para uma chamada: por isso
   moram no modulo e nao viajam em cada symbolOf(). `setLibTables` e chamada uma vez, depois
   que Libs/rename-map.js e Libs/lib-subs.js carregam; sem elas o resolvedor ainda funciona,
   so perde os passos 1 e 3. */
function emptyTables(){
  return { sym:{ subs:{}, fwd:{}, bwd:{} }, fp:{ subs:{}, fwd:{}, bwd:{} } };
}
let LIB_TABLES = emptyTables();

function setLibTables(renameMap, libSubs){
  const t = emptyTables();
  /* `mergeSym`/`mergeFp` entram junto: sao os itens que o RenameLibs julgou REDUNDANTES -
     sairam do espelho e viraram ZZ-OBSOLETO na lib do Altium, mas continuam com o nome
     antigo nos projetos ja exportados. Sem eles, "TO-263-5" e "NMAXXXXSC" ficam ausentes
     mesmo com "DDPAK-5" e "NMA0515SC" vivos no espelho e o proprio mapa dizendo que um
     virou o outro - e a chave normalizada nao junta os dois (TO2635 x DDPAK5). */
  const par = [['sym', ['symRename', 'mergeSym']], ['fp', ['fpRename', 'mergeFp']]];
  for (const [kind, campos] of par){
    for (const campo of campos){
      const m = (renameMap && renameMap[campo]) || {};
      for (const antigo of Object.keys(m)){
        const novo = m[antigo];
        if (typeof novo !== 'string' || !novo) continue;
        if (!(antigo in t[kind].fwd)) t[kind].fwd[antigo] = novo;
        /* o sentido inverso e uma LISTA: dois nomes antigos podem levar ao mesmo novo, e
           um novo com dois antigos VIVOS na lib e ambiguo, nao um palpite */
        (t[kind].bwd[novo] = t[kind].bwd[novo] || []).push(antigo);
      }
    }
  }
  for (const r of (libSubs || [])){
    if (!r || !r.from || !r.to) continue;
    const kind = r.kind === 'fp' ? 'fp' : 'sym';
    t[kind].subs[r.from] = r.to;
  }
  LIB_TABLES = t;
  return t;
}
const libTables = () => LIB_TABLES;

/* Devolve { item, name, how, cands } ou null. `how`: 'escolha' | 'exato' | 'rename' |
   'chave' | 'ambiguo'. Em 'ambiguo' o item vem null de proposito - quem chama tem que
   tratar como nao resolvido e oferecer a escolha, nunca desempatar sozinho. */
/* ============ Sugestao de simbolo (o 5o passo que resolveLib NAO tem) ============

   resolveLib e uma cascata sobre o NOME: escolha do usuario, nome exato, rename-map,
   chave normalizada. Quando o componente vem de outra biblioteca do Altium, o nome nao
   bate com nada e ele fica sem simbolo — 290 de 782 componentes dos projetos reais
   (37%), em 44 nomes distintos.

   Esta parte NAO resolve nada: ela SUGERE, ranqueada, para a pessoa escolher. E de
   proposito. Medindo nos projetos reais, os tres primeiros candidatos empatam com
   frequencia (tres capacitores 0805 100nF diferentes servem igualmente), e escolher
   sozinho um deles gravaria um esquema silenciosamente errado. Quem confirma vira
   escolha em Libs/lib-subs.js, e ai o resolveLib passa a resolver pelo primeiro passo.

   O que o componente do projeto tem: sym, comment, footprint, ref (designador).
   O que o acervo tem: name, description, designator, familia, grupo, categorias e,
   no almoxarifado, valores[] com label/value/mpn/mouser e itens[].nome do Odoo.       */

/* Tokens de uma frase. A quebra e no texto CRU e o normKey vai token a token: normKey
   COLA a frase inteira ("Conector 2 Filas 20pin" -> "CONECTOR2FILAS20PIN"), e um token
   desse tamanho nunca casa com nada. Foi assim que os 120 conectores ficaram sem
   candidato nenhum. */
function frasToks(s, dentro){
  for (const bruto of String(s == null ? '' : s).split(/[^A-Za-z0-9À-ÿ]+/)) {
    if (!bruto) continue;
    const t = normKey(bruto);
    if (t.length > 1) dentro.add(t);
  }
  return dentro;
}

/* Todo texto que identifica um item do acervo, como CONJUNTO de tokens — inclusive o
   nome do produto no Odoo, que e onde mora "Barra de pinos macho 5.08 10 pinos 2 linhas". */
function libToks(it){
  const set = new Set();
  const add = v => { if (v) frasToks(v, set); };
  add(it.name); add(it.description); add(it.familia); add(it.grupo);
  for (const c of (it.categorias || [])) add(c);
  for (const f of (it.footprints || [])) add(f && f.name);
  for (const v of (it.valores || [])) {
    add(v.label); add(v.value); add(v.mpn); add(v.mouser); add(v.footprint);
    for (const i of (v.itens || [])) { add(i.nome); add(i.categoria); }
  }
  return set;
}

/* quantos pinos o item tem somando as partes — e o que separa um CONECTOR 20V de um 6V */
function libPins(it){
  let n = 0;
  for (const pt of (it.parts || [])) n += ((pt.pins || []).length);
  if (!n) for (const v of (it.valores || [])) for (const pt of (v.parts || [])) n += ((pt.pins || []).length);
  return n;
}

const SUG_IDX = (typeof WeakMap === 'function') ? new WeakMap() : null;
function sugIndex(list){
  const arr = list || [];
  if (SUG_IDX && SUG_IDX.has(arr)) return SUG_IDX.get(arr);
  const idx = arr.filter(it => it && typeof it.name === 'string')
                 .map(it => { const toks = libToks(it);
                              /* colado: o acervo escreve "BAT85" e o Altium "BAT 85".
                                 Token exato erra isso; o grudado acha. Vale menos porque
                                 tambem casa pedaco de palavra. */
                              return { it, toks, pins: libPins(it), colado: [...toks].join('') }; });
  if (SUG_IDX) SUG_IDX.set(arr, idx);
  return idx;
}

/* Comment do Altium as vezes e uma FORMULA nao resolvida ("=Value + ' ' + Voltage"):
   parece texto, nao identifica peca nenhuma e envenena a busca. Medido em Cap
   Eletrolitico e Cap Poliester dos projetos reais. */
const FORMULA_RE = /^\s*=|Value|Voltage|Volts/i;
const ehFormula = c => !c || FORMULA_RE.test(String(c));

const sugToks = s => [...frasToks(s, new Set())];
/* numeros soltos no nome/footprint ("2 Filas 20pin", "CONN20_250-710") — um deles
   costuma ser a contagem de pinos */
function sugNums(s){
  const out = [];
  const m = String(s || '').match(/\d+/g) || [];
  for (const x of m) { const n = +x; if (n >= 2 && n <= 200) out.push(n); }
  return out;
}
/* So o MAIOR numero conta como pinagem. Em "CONE FIO 15P - 5.08" os candidatos eram
   15, 5 e 8, e o 5 casava com qualquer peca de 5 pinos do acervo — ruido puro. Em
   "Conector 2 Filas 20pin" e "CONN20_250-710", o maior util e justamente o 20. */
const maiorNum = arr => (arr.length ? Math.max.apply(null, arr) : 0);

/* comp = { sym, comment, footprint, ref }. Devolve os melhores candidatos, cada um com
   `pontos` e `porque` (os motivos em texto, para a UI mostrar em vez de um numero solto). */
function suggestSym(comp, list, opts){
  const o = opts || {};
  const lim = o.limit || 8;
  const c = comp || {};
  const cm = ehFormula(c.comment) ? '' : String(c.comment || '');
  const tc = sugToks(cm), ts = sugToks(c.sym), tf = sugToks(c.footprint);
  const nPinos = maiorNum(sugNums(c.sym).concat(sugNums(c.footprint)));
  const des = String(c.ref || '').replace(/[0-9]+$/, '').toUpperCase();
  const nomeCm = normKey(cm), nomeFp = normKey(c.footprint);
  const colCm = tc.join('');

  const out = [];
  for (const e of sugIndex(list)) {
    let pts = 0; const porque = [];
    const cobre = (toks, peso, rot) => {
      if (!toks.length) return 0;
      const n = toks.filter(t => e.toks.has(t)).length;
      if (!n) return 0;
      const f = n / toks.length;
      pts += peso * f;
      if (f >= 0.5) porque.push(rot + (f < 1 ? ' ' + Math.round(f * 100) + '%' : ''));
      return f;
    };
    cobre(tc, 50, 'comment');
    cobre(ts, 20, 'nome');
    cobre(tf, 12, 'footprint');
    /* o acervo grava "BAT85" e o Altium "BAT 85": sem isto o casamento certo some */
    if (colCm && colCm.length > 3 && e.colado.indexOf(colCm) >= 0) {
      pts += 22; porque.push('comment colado');
    }
    if (nomeCm && normKey(e.it.name) === nomeCm) { pts += 45; porque.push('comment = nome'); }
    if (nomeFp) for (const f of (e.it.footprints || []))
      if (normKey(f && f.name) === nomeFp) { pts += 25; porque.push('mesmo footprint'); break; }
    /* Prefixo INTEIRO, nao prefixo-de-prefixo: "CN1" da "CN", que NAO e o "C" de
       capacitor. Com startsWith, os 120 "Conector 2 Filas 20pin" casavam com CAPACITOR. */
    if (des && e.it.designator && des === String(e.it.designator).toUpperCase()) {
      pts += 10; porque.push('designador ' + e.it.designator);
    }
    /* Pinagem: e o unico sinal para "Conector 2 Filas 20pin", onde o comment repete o
       nome e nenhuma palavra bate com o acervo. Duas travas, aprendidas medindo:
       - so numero >= 4: "2 Filas" casava com toda peca de 2 pinos do acervo;
       - so quando ja ha OUTRO sinal: contagem de pino sozinha nao identifica nada, e
         era assim que "Cone Parafuso" virava "24LC256" (8 pinos, e nada mais em comum). */
    if (e.pins >= 4 && pts > 0 && e.pins === nPinos) {
      pts += 30; porque.push(e.pins + ' pinos');
    }
    if (pts > 0) out.push({ name: e.it.name, item: e.it, pontos: Math.round(pts),
                            porque, especifico: !!e.it.deValor });
  }
  /* Empate e comum e nao e ruido: tres capacitores 0805 100nF servem igualmente. Mas
     entre "SMD BAW56" (o valor) e "DIODO RETIFICADOR [SMD]" (a familia inteira), o valor
     e a resposta — e a peca, nao a gaveta. Por isso o especifico sobe no empate. */
  out.sort((a, b) => (b.pontos - a.pontos)
                  || (b.especifico - a.especifico)
                  || a.name.localeCompare(b.name));
  return out.slice(0, lim);
}

function resolveLib(list, name, kind, tables){
  const nm = String(name == null ? '' : name);
  if (!nm) return null;
  const t = (tables || LIB_TABLES)[kind === 'fp' ? 'fp' : 'sym'] || { subs:{}, fwd:{}, bwd:{} };
  const idx = libIndex(list);
  const hit = (n, how) => ({ item: idx.byName.get(n), name: n, how });

  const escolhido = t.subs[nm];
  if (escolhido && idx.byName.has(escolhido)) return hit(escolhido, 'escolha');
  if (idx.byName.has(nm)) return hit(nm, 'exato');

  const novo = t.fwd[nm];
  if (novo && idx.byName.has(novo)) return hit(novo, 'rename');
  const antigos = (t.bwd[nm] || []).filter(a => idx.byName.has(a));
  if (antigos.length === 1) return hit(antigos[0], 'rename');
  if (antigos.length > 1) return { item:null, name:null, how:'ambiguo', cands:antigos };

  const cand = idx.byKey.get(normKey(nm)) || [];
  if (cand.length === 1) return hit(cand[0].name, 'chave');
  if (cand.length > 1) return { item:null, name:null, how:'ambiguo', cands:cand.map(x => x.name) };
  return null;
}

const resolveSym = (schlib, name, tables) =>
  resolveLib((schlib && schlib.symbols) || [], name, 'sym', tables);
const resolveFp = (pcblib, name, tables) =>
  resolveLib((pcblib && pcblib.footprints) || [], name, 'fp', tables);

/* Fachada historica: todo o resto do sistema (desenho da folha, hit-test, extracao de
   nets, validacao, hub classico) chama por aqui, entao resolver AQUI DENTRO e o que faz os
   quatro passos valerem em todas as telas de uma vez. */
function symbolOf(schlib, name){
  const r = resolveSym(schlib, name);
  return (r && r.item) || null;
}
function partOf(sym, part){
  if (!sym || !sym.parts || !sym.parts.length) return null;
  return sym.parts.find(p => p.part === (part || 1)) || null;
}
function footprintOf(pcblib, name){
  const r = resolveFp(pcblib, name);
  return (r && r.item) || null;
}
/* ponta quente do pino (onde o fio conecta), em coords locais do simbolo */
function pinHot(pin){
  const d = ORIENT_DIR[((pin.orient % 360) + 360) % 360] || [1, 0];
  return { x: pin.x + d[0]*pin.len, y: pin.y + d[1]*pin.len };
}
/* transform local->mundo de um componente: espelha X, rotaciona anti-horario, translada */
function compTransform(comp){
  const rot = (((comp.rot || 0) % 360) + 360) % 360;
  const cos = Math.cos(rot * Math.PI/180), sin = Math.sin(rot * Math.PI/180);
  const mx = comp.mirror ? -1 : 1;
  return {
    map(x, y){ const lx = x*mx, ly = y; return { x: comp.x + lx*cos - ly*sin, y: comp.y + lx*sin + ly*cos }; },
    ang(a){ return ((((comp.mirror ? 180 - a : a) + rot) % 360) + 360) % 360; }
  };
}
/* pontas quentes de todos os pinos do componente, em coords da folha; null se simbolo desconhecido */
function compPinsWorld(comp, schlib){
  const sym = symbolOf(schlib, comp.sym); if (!sym) return null;
  const part = partOf(sym, comp.part);    if (!part) return null;
  const tf = compTransform(comp);
  return (part.pins || []).map(p => {
    const h = pinHot(p), w = tf.map(h.x, h.y);
    return { num: p.num, name: p.name, x: w.x, y: w.y };
  });
}

/* agrupa a lista plana "items" em folhas */
function buildSchModel(schematic){
  const model = { project: (schematic && schematic.project) || '', units: (schematic && schematic.units) || 'mil', sheets: [] };
  const byName = {};
  for (const it of ((schematic && schematic.items) || [])) {
    if (it.t === 'sheet') {
      if (byName[it.name]) continue;
      /* w/h = medida REAL da folha no Altium, quando o export a trouxe; 0 = "nao sei", e ai
         sheetSize() cai na tabela por nome. Nao inventar medida a partir do size aqui. */
      const s = { name: it.name, size: it.size || 'A4', w: isNum(it.w) ? it.w : 0, h: isNum(it.h) ? it.h : 0,
                  comps:[], wires:[], netlabels:[], powers:[], ports:[], junctions:[], noercs:[], texts:[] };
      model.sheets.push(s); byName[it.name] = s;
      continue;
    }
    let s = byName[it.sheet];
    if (!s) {
      /* folha IMPLICITA (ninguem declarou): mesma forma da declarada, sem medida de onde sair */
      s = { name: it.sheet || 'main', size:'A4', w:0, h:0,
            comps:[], wires:[], netlabels:[], powers:[], ports:[], junctions:[], noercs:[], texts:[] };
      model.sheets.push(s); byName[s.name] = s;
    }
    if      (it.t === 'comp')     s.comps.push(it);
    else if (it.t === 'wire')     s.wires.push(it);
    else if (it.t === 'netlabel') s.netlabels.push(it);
    else if (it.t === 'power')    s.powers.push(it);
    else if (it.t === 'port')     s.ports.push(it);
    else if (it.t === 'junction') s.junctions.push(it);
    /* o No ERC entra no modelo mas NAO na extracao de nets: ele e um recado para o ERC
       do Altium, nao um condutor — somar seu ponto aos nos faria o preview inventar
       ligacao que a folha real nao tem */
    else if (it.t === 'noerc')    s.noercs.push(it);
    else if (it.t === 'text')     s.texts.push(it);
  }
  return model;
}

/* Extracao de nets (PREVIEW - a verdade e o compilador do Altium).
   Regras: pontos coincidentes conectam; ponto de conexao (extremo de fio, pino,
   junction, ancora de rotulo/power) SOBRE um segmento conecta (T); cruzamento sem
   ponto de conexao NAO conecta; netlabel funde grupos por nome; power funde por
   nome globalmente. Nome automatico: Net<ref>_<pino> do menor pino. */
function extractNets(schematicOrModel, schlib){
  const model = schematicOrModel.sheets ? schematicOrModel : buildSchModel(schematicOrModel);
  const warnings = [];
  const parent = [];
  const mk = () => { parent.push(parent.length); return parent.length - 1; };
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };

  const nodeMap = {};
  const key = (si, x, y) => si + '|' + Math.round(x*2) + '|' + Math.round(y*2);
  const nodeAt = (si, x, y) => { const k = key(si, x, y); if (!(k in nodeMap)) nodeMap[k] = mk(); return nodeMap[k]; };

  const segs = [], attach = [], pinRecs = [], labelRecs = [], powerRecs = [], portRecs = [];
  const wireNet = model.sheets.map(s => s.wires.map(() => ''));

  model.sheets.forEach((s, si) => {
    s.wires.forEach((w, wi) => {
      const pts = w.pts || [];
      for (let i = 0; i < pts.length - 1; i++) {
        const nA = nodeAt(si, pts[i][0], pts[i][1]), nB = nodeAt(si, pts[i+1][0], pts[i+1][1]);
        uni(nA, nB);
        segs.push({ si, wi, x1:pts[i][0], y1:pts[i][1], x2:pts[i+1][0], y2:pts[i+1][1], node:nA });
      }
      pts.forEach(p => attach.push({ si, x:p[0], y:p[1], node:nodeAt(si, p[0], p[1]), kind:'wend' }));
    });
    s.comps.forEach(c => {
      const pins = compPinsWorld(c, schlib);
      if (!pins) {
        const symKnown = symbolOf(schlib, c.sym);
        warnings.push(symKnown
          ? `${c.ref}: parte ${c.part || 1} não existe no símbolo "${c.sym}" — pinos ignorados na extração`
          : `${c.ref}: símbolo "${c.sym}" desconhecido — pinos ignorados na extração`);
        return;
      }
      pins.forEach(p => {
        const n = nodeAt(si, p.x, p.y);
        pinRecs.push({ ref:c.ref, num:p.num, node:n });
        attach.push({ si, x:p.x, y:p.y, node:n, kind:'pin' });
      });
    });
    s.junctions.forEach(j => attach.push({ si, x:j.x, y:j.y, node:nodeAt(si, j.x, j.y), kind:'junction' }));
    s.netlabels.forEach(l => { const n = nodeAt(si, l.x, l.y); labelRecs.push({ net:l.net, node:n, x:l.x, y:l.y }); attach.push({ si, x:l.x, y:l.y, node:n, kind:'label' }); });
    s.powers.forEach(p => { const n = nodeAt(si, p.x, p.y); powerRecs.push({ net:p.net, node:n, x:p.x, y:p.y }); attach.push({ si, x:p.x, y:p.y, node:n, kind:'power' }); });
    /* A Port do Altium conecta pelo NOME, como o rotulo — a diferenca e so grafica (a
       seta) e hierarquica (ela e o pino da folha vista de fora). Para a extracao ela e
       um nomeador a mais; por isso entra em portRecs e nao ganha regra propria. */
    s.ports.forEach(p => { const n = nodeAt(si, p.x, p.y); portRecs.push({ net:p.net, node:n, x:p.x, y:p.y }); attach.push({ si, x:p.x, y:p.y, node:n, kind:'port' }); });
  });

  /* conexoes em T: ponto de conexao sobre o interior de um segmento */
  const autoJunctions = [];
  for (const a of attach) {
    for (const g of segs) {
      if (g.si !== a.si) continue;
      if ((near(a.x,g.x1,STOL) && near(a.y,g.y1,STOL)) || (near(a.x,g.x2,STOL) && near(a.y,g.y2,STOL))) continue;
      if (distSeg(a.x, a.y, g.x1, g.y1, g.x2, g.y2) <= STOL) {
        uni(a.node, g.node);
        if (a.kind === 'pin' || a.kind === 'wend' || a.kind === 'junction')
          autoJunctions.push({ sheet:a.si, x:a.x, y:a.y });
      }
    }
  }

  /* fusao por nome (netlabel, power e port) */
  const nameRoot = {};
  for (const rec of labelRecs.concat(powerRecs, portRecs)) {
    const r = find(rec.node);
    if (rec.net in nameRoot) uni(nameRoot[rec.net], r); else nameRoot[rec.net] = r;
  }

  /* agrupamento e nomeacao */
  const groups = {};
  const gof = n => { const r = find(n); if (!groups[r]) groups[r] = { names:new Set(), pins:[] }; return groups[r]; };
  for (const rec of labelRecs) gof(rec.node).names.add(rec.net);
  for (const rec of powerRecs) gof(rec.node).names.add(rec.net);
  for (const rec of portRecs)  gof(rec.node).names.add(rec.net);
  for (const rec of pinRecs)   gof(rec.node).pins.push(rec.ref + '-' + rec.num);
  for (const g of segs) gof(g.node);
  const segRoots = new Set(segs.map(g => find(g.node)));

  const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric:true, sensitivity:'base' });
  const netByRoot = {}, nets = [];
  for (const r in groups) {
    const g = groups[r];
    const names = [...g.names].sort(natural);
    let name = '', auto = false;
    if (names.length > 1) warnings.push('nomes de net conflitantes no mesmo grupo: ' + names.join(', '));
    if (names.length) name = names[0];
    else if (g.pins.length) {
      const ps = g.pins.slice().sort(natural);
      name = 'Net' + ps[0].replace('-', '_'); auto = true;
    }
    netByRoot[r] = name;
    /* net so entra na lista se: tem rotulo/power (e algum fio ou pino), ou tem >= 2 pinos.
       Pino solto sem fio NAO vira net (equivale a NetlistSinglePinNets=0 do Altium). */
    if (names.length) {
      if (g.pins.length || segRoots.has(+r))
        nets.push({ name, pins: g.pins.slice().sort(natural), auto: false });
    } else if (g.pins.length >= 2) {
      nets.push({ name, pins: g.pins.slice().sort(natural), auto: true });
    }
    if (!name && !g.pins.length && segRoots.has(+r))
      warnings.push('fio sem conexão (nenhum pino ou rótulo)');
  }
  for (const rec of labelRecs) {
    const r = find(rec.node), g = groups[r];
    if (!segRoots.has(r) && (!g || !g.pins.length))
      warnings.push(`netlabel "${rec.net}" solta em (${rec.x},${rec.y})`);
  }
  for (const rec of powerRecs) {
    const r = find(rec.node), g = groups[r];
    if (!segRoots.has(r) && (!g || !g.pins.length))
      warnings.push(`power "${rec.net}" solto em (${rec.x},${rec.y})`);
  }
  for (const rec of portRecs) {
    const r = find(rec.node), g = groups[r];
    if (!segRoots.has(r) && (!g || !g.pins.length))
      warnings.push(`port "${rec.net}" solta em (${rec.x},${rec.y})`);
  }
  nets.sort((a, b) => natural(a.name, b.name));

  const pinNet = {};
  for (const rec of pinRecs) { const nm = netByRoot[find(rec.node)]; if (nm) pinNet[rec.ref + '-' + rec.num] = nm; }
  for (const g of segs) { const nm = netByRoot[find(g.node)]; if (nm) wireNet[g.si][g.wi] = nm; }

  return { nets, pinNet, wireNet, autoJunctions, warnings };
}

/* ============ validacao do schematic.js contra as libs espelhadas ============ */

function validateSchematic(schematic, schlib, pcblib){
  const errors = [], warnings = [];
  if (!schematic || schematic.format !== 'schmirror-v2') warnings.push('format esperado "schmirror-v2"');
  if (!schematic || !schematic.project) errors.push('header: falta "project"');
  const model = buildSchModel(schematic || {});
  if (!model.sheets.length) errors.push('nenhuma folha ({"t":"sheet",...})');
  const seen = {};
  for (const s of model.sheets) {
    for (const c of s.comps) {
      const where = `comp ${c.ref || '?'}`;
      if (!c.ref) { errors.push('comp sem "ref"'); continue; }
      const k = c.ref + '/' + (c.part || 1);
      if (seen[k]) errors.push(`${where}: ref duplicado (parte ${c.part || 1})`);
      seen[k] = true;
      if (!isNum(c.x) || !isNum(c.y)) { errors.push(`${where}: faltam x/y`); continue; }
      const rot = (((c.rot || 0) % 360) + 360) % 360;
      if (![0, 90, 180, 270].includes(rot)) errors.push(`${where}: rot deve ser 0/90/180/270`);
      const sym = symbolOf(schlib, c.sym);
      if (!sym) { errors.push(`${where}: símbolo "${c.sym}" não existe na schlib`); continue; }
      const part = partOf(sym, c.part);
      if (!part) errors.push(`${where}: parte ${c.part || 1} não existe em "${c.sym}"`);
      if (!c.footprint) errors.push(`${where}: falta "footprint" (obrigatório em todo componente)`);
      else {
        const fp = footprintOf(pcblib, c.footprint);
        if (!fp) errors.push(`${where}: footprint "${c.footprint}" não existe na pcblib`);
        else if (part) {
          const padNames = new Set((fp.pads || []).map(p => String(p.name)));
          for (const p of (part.pins || []))
            if (!padNames.has(String(p.num)))
              warnings.push(`${where}: pino "${p.num}" sem pad correspondente no footprint ${c.footprint}`);
        }
        /* compara o footprint RESOLVIDO, e nao a string: o modelo do simbolo no espelho
           carrega o nome novo e o projeto carrega o antigo, e comparar cru dispararia o
           aviso em massa para o mesmo footprint fisico */
        const cur = (sym.footprints || []).find(f => f.current);
        const curR = cur ? resolveFp(pcblib, cur.name) : null;
        if (cur && (curR && curR.item ? curR.item !== fp : cur.name !== c.footprint))
          warnings.push(`${where}: footprint ${c.footprint} difere do modelo da lib (${cur.name})`);
      }
      if ((c.x % 100) || (c.y % 100)) warnings.push(`${where}: fora da grade de 100 mil`);
    }
    for (const w of s.wires) {
      if (!Array.isArray(w.pts) || w.pts.length < 2) { errors.push(`wire na folha ${s.name}: pts precisa de >= 2 pontos`); continue; }
      for (const p of w.pts)
        if ((p[0] % 100) || (p[1] % 100)) { warnings.push(`wire na folha ${s.name}: vértice (${p[0]},${p[1]}) fora da grade de 100 mil`); break; }
    }
    for (const l of s.netlabels) if (!l.net) errors.push(`netlabel sem "net" na folha ${s.name}`);
    for (const p of s.powers)    if (!p.net) errors.push(`power sem "net" na folha ${s.name}`);
    for (const p of s.ports)     if (!p.net) errors.push(`port sem "net" na folha ${s.name}`);
    /* No ERC fora de pino nao marca nada e falha CALADO: o Altium prende a diretiva onde
       ela esta e segue reclamando do pino que ninguem cobriu. Como o erro e invisivel na
       folha (o X aparece, so que 10 mil ao lado), o aviso e o unico jeito de ve-lo. */
    if (s.noercs.length){
      const quentes = new Set();
      for (const c of s.comps)
        for (const p of (compPinsWorld(c, schlib) || [])) quentes.add(p.x + "," + p.y);
      for (const n of s.noercs)
        if (!quentes.has(n.x + "," + n.y))
          warnings.push(`No ERC em (${n.x},${n.y}) nao esta na ponta de nenhum pino`);
    }
  }
  return { errors, warnings };
}

/* ============ serializacao (formato um-objeto-JSON-por-linha dos parsers .pas) ============ */

/* escapa >= U+007E como \uXXXX (mesma convencao do JS() dos scripts .pas, que escapa > 125) */
function jline(obj){
  return JSON.stringify(obj).replace(/[\u007e-\uffff]/g,
    c => '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4));
}
function badStr(s){ return typeof s === 'string' && s.indexOf('":') >= 0; }

const CH_REQUIRED = {
  comp_move:       { num:['x','y','orig_x','orig_y','orig_rot'], str:['ref','orig_layer'] },
  comp_attr:       { num:[], str:['ref','orig_designator'] },
  track_edit:      { num:['orig_x1','orig_y1','orig_x2','orig_y2','orig_w'], str:['id','orig_layer'] },
  track_add:       { num:['x1','y1','x2','y2','w'], str:['layer'] },
  track_del:       { num:['orig_x1','orig_y1','orig_x2','orig_y2','orig_w'], str:['id','orig_layer'] },
  via_edit:        { num:['orig_x','orig_y'], str:['id'] },
  via_add:         { num:['x','y','size','drill'], str:[] },
  via_del:         { num:['orig_x','orig_y'], str:['id'] },
  arc_edit:        { num:['orig_cx','orig_cy','orig_r','orig_sa','orig_ea'], str:['id','orig_layer'] },
  arc_add:         { num:['cx','cy','r','sa','ea','w'], str:['layer'] },
  arc_del:         { num:['orig_cx','orig_cy','orig_r','orig_sa','orig_ea'], str:['id','orig_layer'] },
  text_edit:       { num:['orig_x','orig_y'], str:['id','orig_text','orig_layer'] },
  designator_move: { num:['orig_x','orig_y'], str:['ref'] },
  outline_set:     { num:[], str:[] },
};

function checkFields(objs, reqOf, kindOf, errors){
  objs.forEach((o, i) => {
    const req = reqOf(o);
    if (!req){ errors.push({ idx:i, msg:`${kindOf(o)}: tipo desconhecido` }); return; }
    for (const k of req.num) if (!isNum(o[k])) errors.push({ idx:i, msg:`${kindOf(o)}: campo "${k}" ausente/invalido` });
    for (const k of req.str) if (typeof o[k] !== 'string' || !o[k]) errors.push({ idx:i, msg:`${kindOf(o)}: campo "${k}" ausente` });
    for (const k in o) if (badStr(o[k])) errors.push({ idx:i, msg:`${kindOf(o)}: texto em "${k}" nao pode conter a sequencia aspas-dois-pontos` });
  });
}

function serializeChanges(changes){
  const list = Array.isArray(changes) ? changes : [];
  const errors = [];
  checkFields(list, ch => CH_REQUIRED[ch.op], ch => ch.op || '?', errors);
  list.forEach((ch, i) => {
    if (ch.op === 'outline_set' && (!Array.isArray(ch.pts) || ch.pts.length < 3 ||
        ch.pts.some(p => !Array.isArray(p) || !isNum(p[0]) || !isNum(p[1]))))
      errors.push({ idx:i, msg:'outline_set: pts deve ser [[x,y],...] com >= 3 vertices' });
    if (ch.op === 'track_add' && ch.w <= 0) errors.push({ idx:i, msg:'track_add: w deve ser > 0' });
    if (ch.op === 'via_add' && ch.drill >= ch.size) errors.push({ idx:i, msg:'via_add: drill deve ser < size' });
    if (ch.op === 'comp_attr'){
      if (typeof ch.orig_comment !== 'string') errors.push({ idx:i, msg:'comp_attr: campo "orig_comment" ausente' });
      if (!(typeof ch.designator === 'string' && ch.designator) && typeof ch.comment !== 'string')
        errors.push({ idx:i, msg:'comp_attr: nada a alterar (informe designator e/ou comment)' });
    }
  });
  if (errors.length) return { text:null, errors };
  const L = ['// AltiumPCBMirror - arquivo de mudancas.',
             '// Edite ESTE arquivo (nunca o board.js). Um objeto JSON por linha. Consulte AI-GUIDE.md.',
             'var changes = ['];
  for (const ch of list) L.push(jline(ch) + ',');
  L.push('];');
  return { text: L.join('\n') + '\n', errors: [] };
}

/* Libs/lib-subs.js: as substituicoes escolhidas na aba Biblioteca.
   Um registro JSON PLANO por linha e chaves fixas, porque e assim que os .pas leem
   (o JGet procura '"chave":' literal dentro da linha); nao-ASCII sai como \uXXXX pelo
   mesmo motivo - o TStringList do Delphi le ANSI e corromperia acento cru.
   `key` viaja junto para o lado Pascal nao precisar reimplementar a NormKey. */
function serializeLibSubs(subs){
  const list = Array.isArray(subs) ? subs : [];
  const errors = [], seen = {}, out = [];
  list.forEach((r, i) => {
    const o = r || {}, kind = o.kind === 'fp' ? 'fp' : 'sym';
    if (typeof o.from !== 'string' || !o.from) return errors.push({ idx:i, msg:'substituicao sem "from"' });
    if (typeof o.to !== 'string' || !o.to)     return errors.push({ idx:i, msg:'substituicao sem "to"' });
    if (o.from === o.to) return errors.push({ idx:i, msg:`substituicao de "${o.from}" para ela mesma` });
    const k = kind + '\u0000' + o.from;
    /* dois destinos para o mesmo nome nao e conflito de merge, e escolha perdida: a ultima
       venceria em silencio e a pessoa nunca saberia qual das duas valeu */
    if (seen[k]) return errors.push({ idx:i, msg:`duas substituicoes para "${o.from}"` });
    seen[k] = true;
    out.push({ kind, from:o.from, key:normKey(o.from), to:o.to,
               when: typeof o.when === 'string' ? o.when : '' });
  });
  if (errors.length) return { text:null, errors };
  const L = ['// AltiumPCBMirror - substituicoes de biblioteca escolhidas na aba Biblioteca.',
             '// "from" = nome que o projeto referencia e a lib nao tem; "to" = nome que existe na lib.',
             '// "key" = NormKey(from), a mesma do RenameLibs.pas, para JS e Pascal concordarem.',
             'var libSubs = ['];
  for (const r of out) L.push(jline(r) + ',');
  L.push('];');
  return { text: L.join('\n') + '\n', errors: [] };
}

const SCH_ITEM_REQUIRED = {
  /* w/h (medida real da folha, em mil) sao OPCIONAIS e ficam FORA daqui: `size` continua
     obrigatorio para que espelho antigo nao pare de salvar, e um export que trocasse size
     por w/h derrubaria o Salvar do arquivo INTEIRO, nao so o da folha. */
  sheet:    { num:[], str:['name','size'] },
  comp:     { num:['x','y'], str:['sheet','ref','sym','footprint'] },
  wire:     { num:[], str:['sheet'] },
  netlabel: { num:['x','y'], str:['sheet','net'] },
  power:    { num:['x','y'], str:['sheet','net','style'] },
  /* io/style/w/color/fill/textColor sao OPCIONAIS de proposito: o ExportProject emite o que
     o Altium der, e um .SchDoc antigo pode nao trazer todos. Exigir aqui faria um espelho
     legitimo travar o Salvar do arquivo inteiro — o mesmo estrago que um tipo desconhecido
     causava. As cores ausentes caem no padrao amarelo/preto do hub-draw. */
  port:     { num:['x','y'], str:['sheet','net'] },
  junction: { num:['x','y'], str:['sheet'] },
  /* style/color opcionais pelo mesmo motivo da port: o que o Altium der atravessa o
     espelho como veio, e .SchDoc antigo pode nao trazer nenhum dos dois */
  noerc:    { num:['x','y'], str:['sheet'] },
  text:     { num:['x','y'], str:['sheet','s'] },
};

function serializeSchematic(sch){
  if (!sch || typeof sch !== 'object') return { text:null, errors:[{ idx:-1, msg:'schematic ausente' }] };
  const errors = [];
  if (!sch.project) errors.push({ idx:-1, msg:'header: falta "project"' });
  for (const k of Object.keys(sch)) if (k !== 'items' && badStr(sch[k]))
    errors.push({ idx:-1, msg:`header: campo "${k}" nao pode conter a sequencia aspas-dois-pontos` });
  const items = Array.isArray(sch.items) ? sch.items : [];
  checkFields(items, it => SCH_ITEM_REQUIRED[it.t], it => it.t || '?', errors);
  items.forEach((it, i) => {
    if (it.t === 'wire' && (!Array.isArray(it.pts) || it.pts.length < 2))
      errors.push({ idx:i, msg:'wire: pts precisa de >= 2 pontos' });
    if (it.t === 'comp' && it.rot != null && ![0, 90, 180, 270].includes((((it.rot % 360) + 360) % 360)))
      errors.push({ idx:i, msg:'comp: rot deve ser 0/90/180/270' });
  });
  if (errors.length) return { text:null, errors };
  const L = ['var schematic = {'];
  for (const k of Object.keys(sch)) if (k !== 'items') L.push(JSON.stringify(k) + ':' + jline(sch[k]) + ',');
  L.push('"items":[');
  for (const it of items) L.push(jline(it) + ',');
  L.push(']};');
  return { text: L.join('\n') + '\n', errors: [] };
}

const ANN_REQUIRED = { num:['x','y'], str:['id','severity','msg'] };

function serializeAnnotations(list){
  const anns = Array.isArray(list) ? list : [];
  const errors = [];
  checkFields(anns, () => ANN_REQUIRED, a => a.id || 'sinalizador', errors);
  anns.forEach((a, i) => {
    if (a.view !== 'pcb' && a.view !== 'sch') errors.push({ idx:i, msg:`${a.id || '?'}: view deve ser "pcb" ou "sch"` });
    if (a.view === 'sch' && (typeof a.sheet !== 'string' || !a.sheet)) errors.push({ idx:i, msg:`${a.id || '?'}: falta "sheet"` });
    if (!['err','warn','info'].includes(a.severity)) errors.push({ idx:i, msg:`${a.id || '?'}: severity deve ser err/warn/info` });
  });
  if (errors.length) return { text:null, errors };
  const L = ['// AltiumPCBMirror - sinalizadores do usuario para a IA. Um objeto JSON por linha.',
             '// A IA le, corrige via changes.js e marca status resolved + reply. Consulte AI-GUIDE.md Parte C.',
             'var annotations = ['];
  for (const a of anns) L.push(jline(a) + ',');
  L.push('];');
  return { text: L.join('\n') + '\n', errors: [] };
}

/* ============ Neoden 4: pick-and-place (paridade com neodenAltium.py) ============ */

/* Mid X/Y sai da origem do componente (Comp.x/Comp.y = Location X/Y do Altium), nao do
   centro do bbox de cobre: o bbox gira junto com o componente, entao o desvio
   origem->centro cai em eixos diferentes conforme a rotacao e sobra como erro depois de
   subtrair a referencia (dois JUMPER_3VIAS a 0 e 270 graus erravam 0.127mm em X e Y). */
function neodenPos(c){
  if (isNum(c.x) && isNum(c.y)) return { x: c.x, y: c.y };
  const b = c.bbox;
  if (b && isNum(b.x1) && isNum(b.y1) && isNum(b.x2) && isNum(b.y2))
    return { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 };
  return { x: 0, y: 0 };
}
/* Tipo de montagem: sai do pads[].type do board.js ("th"/"smd"), nunca do nome do
   footprint. A Neoden 4 so coloca SMD — PTH na lista trava a maquina. "misto" (pads
   dos dois tipos) e categoria propria e NAO conta como pth: e o modulo que assenta em
   pads SMD com furo de header junto (MD4/ESP32-H2 do VDCB-DI251879), colocavel. Sem
   pads, ou tipo desconhecido, da "?": nao da pra afirmar, entao fica fora de qualquer
   exclusao em lote em vez de virar um chute silencioso. */
function neodenKind(c){
  const pads = (c && c.pads) || [];
  const th = pads.some(p => p.type === 'th'), smd = pads.some(p => p.type === 'smd');
  if (th && smd) return 'misto';
  if (th) return 'pth';
  if (smd) return 'smd';
  return '?';
}
/* Ordem das classes na bancada; o que nao esta aqui vai depois, em ordem alfabetica. */
const NEODEN_CLASS_ORDER = ['R', 'C', 'L', 'D'];
/* Package = o codigo imperial achado no nome do footprint. E o que junta "RES 1206" com
   "1206 resistor" (96 e 35 ocorrencias no acervo, mesmo componente fisico). Sem codigo,
   a chave e o proprio nome — footprints identicos continuam juntos, e so eles. */
function neodenPkg(fp){
  const m = /(?:^|\D)(0201|0402|0603|0805|1206|1210|2010|2512)(?:\D|$)/.exec(String(fp || ''));
  return m ? m[1] : String(fp || '');
}
/* Prefixo de letras INTEIRO: CN1 e conector, nao capacitor. Cortar na primeira letra
   poria os conectores no meio dos capacitores e partiria o bloco em dois. */
function neodenClass(des){
  const m = /^[A-Za-z]+/.exec(String(des || ''));
  return m ? m[0].toUpperCase() : '';
}
/* Numero do designator, para R2 vir antes de R10 dentro do grupo. Sem numero da -1 e o
   desempate cai na string, que e sempre determinista. */
function neodenSeq(des){
  const m = /^[A-Za-z]+(\d+)/.exec(String(des || ''));
  return m ? parseInt(m[1], 10) : -1;
}
function neodenGroupKey(row){
  const cls = neodenClass(row.des);
  const rank = NEODEN_CLASS_ORDER.indexOf(cls);
  return { rank: rank < 0 ? NEODEN_CLASS_ORDER.length : rank, cls: cls,
           pkg: neodenPkg(row.footprint), num: neodenSeq(row.des), des: String(row.des || '') };
}
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/* Devolve uma lista nova, agrupada. `pinned` (a referencia) fica de fora da ordenacao e
   volta na primeira posicao. Os codigos imperiais tem 4 digitos, entao a ordem
   alfabetica ja e a ordem de tamanho (0402 < 0603 < 0805 < 1206 < 2512) e os nomes
   nao-imperiais caem depois deles, porque digito vem antes de letra. */
function neodenGroupSort(rows, pinned){
  const rest = pinned ? rows.filter(r => r !== pinned) : rows.slice();
  const keys = new Map(rest.map(r => [r, neodenGroupKey(r)]));
  rest.sort((a, b) => {
    const ka = keys.get(a), kb = keys.get(b);
    return ka.rank - kb.rank || cmpStr(ka.cls, kb.cls) || cmpStr(ka.pkg, kb.pkg)
        || ka.num - kb.num || cmpStr(ka.des, kb.des);
  });
  return pinned ? [pinned].concat(rest) : rest;
}
function neodenRotatePt(ox, oy, px, py, angle){
  const a = angle * Math.PI / 180;
  return { x: ox + Math.cos(a) * (px - ox) - Math.sin(a) * (py - oy),
           y: oy + Math.sin(a) * (px - ox) + Math.cos(a) * (py - oy) };
}
function neodenTransform(components, opts){
  const o = opts || {};
  const comps = (components || []).slice();
  let ordered = comps;
  if (o.refDes){
    const ref = comps.find(c => c.ref === o.refDes);
    if (!ref) return { rows: null, error: `referência "${o.refDes}" não existe no board.js` };
    ordered = [ref].concat(comps.filter(c => c !== ref));
  }
  const ex = new Set(o.exclude || []);
  ex.delete(o.refDes);        /* a referência é a origem do mapeamento: nunca sai da lista */
  let rows = ordered.map(c => {
    const m = neodenPos(c);
    return { des: c.ref, footprint: c.footprint || '', x: m.x, y: m.y,
             layer: c.layer, rot: c.rot || 0, comment: c.comment || '',
             kind: neodenKind(c), excluded: ex.has(c.ref), idx: null };
  });
  /* Capturada ANTES de ordenar: a partir daqui a referencia e esta linha, nunca rows[0] —
     com agrupamento ela deixa de ser a linha 0 da lista ordenada. */
  const refRow = o.refDes ? rows[0] : null;
  if (o.group) rows = neodenGroupSort(rows, refRow);
  /* idx = índice de exportação, contado SÓ nos incluídos — é o mesmo número no "#" da
     tabela, no campo "mover após N" e na linha do CSV. Se a exclusão ficasse fora do
     pipeline, tirar 32 PTH deslocaria o corte do painel em 32 posições. */
  let k = 0;
  for (const r of rows) if (!r.excluded) r.idx = k++;
  if (o.refDes){                                       /* -r: relativo à referência */
    const rx = refRow.x, ry = refRow.y;
    for (const r of rows){ r.x -= rx; r.y -= ry; }
  }
  if (o.rot && isNum(o.rot.angle) && o.rot.angle){     /* -a ox oy ang */
    for (const r of rows){
      const q = neodenRotatePt(o.rot.ox || 0, o.rot.oy || 0, r.x, r.y, o.rot.angle);
      r.x = q.x; r.y = q.y;
    }
  }
  if (o.off && (isNum(o.off.x) || isNum(o.off.y))){    /* -o x y */
    for (const r of rows){ r.x += o.off.x || 0; r.y += o.off.y || 0; }
  }
  if (o.move && isNum(o.move.n) && (isNum(o.move.dx) || isNum(o.move.dy))){  /* -m dx dy n */
    for (const r of rows) if (r.idx !== null && r.idx > o.move.n){ r.x += o.move.dx || 0; r.y += o.move.dy || 0; }
  }
  return { rows, error: null };
}
function neodenCsv(rows, side){
  const clean = v => String(v).replace(/,/g, '_');
  const L = ['Designator,Footprint,Mid X,Mid Y,Layer,Rotation,Comment', ',,,,,,'];
  for (const r of (rows || [])){
    if (r.excluded || r.layer !== side) continue;
    L.push([clean(r.des), clean(r.footprint), r.x.toFixed(2) + 'mm', r.y.toFixed(2) + 'mm',
            'T', clean(r.rot), clean(r.comment)].join(','));
  }
  return L.join('\r\n') + '\r\n';
}

/* ============ status do projeto na esteira ============ */

function deriveStatus(entry, loaded){
  const f = (entry && entry.files) || {};
  if (f.applyreport) return 'aplicada';
  if (loaded && loaded.changesCount > 0 && f.board) return 'roteada';
  if (f.board) return 'eco';
  if (f.schematic) return 'esquema';
  return 'vazio';
}

return { near, nearAng, isNum, distSeg, TOL, STOL, SHEET_SIZES, sheetSize, ORIENT_DIR,
         symbolOf, partOf, footprintOf, pinHot, compTransform, compPinsWorld,
         normKey, libIndex, setLibTables, libTables, resolveLib, resolveSym, resolveFp,
         suggestSym,
         buildSchModel, extractNets, validateSchematic,
         applyPcbChanges, deriveStatus,
         serializeChanges, serializeSchematic, serializeAnnotations, serializeLibSubs,
         compDelta, xfPoint, xfAngle, ownerDelta, effLayerForOwner,
         neodenTransform, neodenCsv, neodenKind };
});
