/* AltiumPCBMirror - hub-pcbeco.js
   O "Design » Update PCB Document" do Altium no hub: compara o schematic.js do projeto com a placa
   EFETIVA (board.js + changes.js) e monta a lista de Engineering Change Orders, cada uma com o
   status da validacao (a coluna Check do dialogo do Altium); `aplica` transforma as marcadas em
   linhas do changes.js. Puro (sem DOM): browser (global HubPcbEco) e testes (node).

   O que ele compara, e como o Altium da casa compara (DieletronsAltium.PrjPcb, o projeto-modelo):
   - componente: pelo DESIGNATOR. O Altium casa pelo UniqueID do simbolo, que o espelho nao
     carrega; o designator e o que sobra -- e e o que a casa nunca renomeia na placa;
   - footprint: pelo nome RESOLVIDO (HubCore.resolveFp: substituicao, exato, rename-map, chave) --
     o esquema fala o nome novo e a placa do Altium o antigo, e os dois sao o mesmo footprint;
   - comment: so quando o do esquema e texto. "=Value + ..." e formula de parametro que o Altium
     avalia no ECO; o espelho do esquema nao traz os parametros, entao nao ha com o que comparar;
   - net: [Comparison Options] do PrjPcb, "Kind=Net|MinPercent=75|MinMatch=3|UseName=-1": casa
     pelo nome; sem nome igual, a net da placa que tem >= 75% dos pinos (e pelo menos 3) e a
     MESMA net com outro nome -> "Change Net Name", e nao remover + criar;
   - pino: o pad da placa (nome do pad = numero do pino) na net que o esquema diz. Pino sem pad no
     footprint e o "Unknown Pin" do Altium: erro, a acao nao executa;
   - Rooms: o PrjPcb liga ClassGenCCAutoRoomEnabled (uma Room por folha). O hub nao tem Room; o que
     fica dela e o AGRUPAMENTO da colocacao: os componentes novos estacionam a direita da placa,
     uma coluna (ou mais) por folha, como o Altium os deixa dentro da Room de cada folha.
   Nets extraidas pelo HubCore.extractNets (o PREVIEW do compilador). Pino sozinho nao vira net
   (NetlistSinglePinNets=0 no PrjPcb da casa).

   API:
     compara(schematic, board, opts) -> eco
       opts: { schlib, pcblib, changes (as que ja estao no changes.js), eb (placa efetiva pronta) }
     valida(eco, opts?) -> eco (status de cada acao refeito, considerando as desmarcadas)
     aplica(eco, opts?) -> { linhas:[op...], puladas:[{acao, motivo}] }
       opts: { margem (mm, 5), folga (mm, 1.27), x0, y0 } -- onde estacionar os novos
     relatorio(eco) -> texto (o "Report Changes...")
   Acao: { id, grupo, tipo, objeto, para, ativo, status:'ok'|'warn'|'err', msg, dados } */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./hub-core.js'));
  else root.HubPcbEco = factory(root.HubCore);
})(typeof self !== 'undefined' ? self : this, function (HC) {
"use strict";

/* os grupos, na ordem do dialogo do Altium (e na ordem em que aplica() escreve as linhas) */
const GRUPOS = [
  { chave:'netRename',  titulo:'Renomear nets',               altium:'Change Net Names', acao:'Change Net Name' },
  { chave:'netAdd',     titulo:'Adicionar nets',              altium:'Add Nets', acao:'Add Net' },
  { chave:'compDel',    titulo:'Remover componentes',         altium:'Remove Components', acao:'Remove Component' },
  { chave:'compFp',     titulo:'Trocar footprint',            altium:'Change Component Footprints', acao:'Change Component Footprint' },
  { chave:'compAdd',    titulo:'Adicionar componentes',       altium:'Add Components', acao:'Add Component' },
  { chave:'pinAdd',     titulo:'Adicionar pinos às nets',     altium:'Add Pins To Nets', acao:'Add Pin To Net' },
  { chave:'pinDel',     titulo:'Remover pinos das nets',      altium:'Remove Pins From Nets', acao:'Remove Pin From Net' },
  { chave:'compComent', titulo:'Trocar comment',              altium:'Change Component Comments', acao:'Change Component Comment' },
  { chave:'netDel',     titulo:'Remover nets',                altium:'Remove Nets', acao:'Remove Net' },
];
const GRUPO = Object.create(null);
GRUPOS.forEach((g, i) => { GRUPO[g.chave] = Object.assign({ ordem:i }, g); });

const isNum = v => typeof v === 'number' && isFinite(v);
const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric:true, sensitivity:'base' });
const r4 = v => Math.round(v * 1e4) / 1e4;
const ehFormula = c => typeof c === 'string' && /^\s*=/.test(c);
const COMP_MIN = 3, COMP_PCT = 0.75;          /* [Comparison Options] Kind=Net do PrjPcb da casa */

/* os componentes do esquema por designator (multiparte vira um so: CN1 partes 1 e 2) */
function compsDoEsquema(sch, schlib){
  const M = HC.buildSchModel(sch || {});
  const out = new Map();
  for (const s of M.sheets) for (const c of s.comps) {
    if (!c || !c.ref) continue;
    let r = out.get(c.ref);
    if (!r) { r = { ref:c.ref, footprint:'', comment:'', sheet:s.name, sym:c.sym, partes:0, cego:false }; out.set(c.ref, r); }
    r.partes++;
    /* simbolo (ou parte) que nenhuma lib tem: a pinagem e desconhecida, e o extractNets pula os
       pinos dele -- comparar daria "remover pino" em todos. Nao conferido e diferente de errado. */
    if (!HC.compPinsWorld(c, schlib)) r.cego = true;
    if (!r.footprint && typeof c.footprint === 'string') r.footprint = c.footprint;
    if (!r.comment && typeof c.comment === 'string') r.comment = c.comment;
  }
  return { comps:out, folhas:M.sheets.map(s => s.name) };
}

/* footprint igual: mesma string, mesma chave normalizada, ou os dois resolvem no mesmo item da lib */
function mesmoFootprint(a, b, pcblib){
  if (a === b) return true;
  if (!a || !b) return false;
  if (HC.normKey(a) === HC.normKey(b)) return true;
  if (pcblib) {
    const ra = HC.resolveFp(pcblib, a), rb = HC.resolveFp(pcblib, b);
    if (ra && rb && ra.item && ra.item === rb.item) return true;
  }
  return false;
}

function placaEfetiva(board, opts){
  if (opts && opts.eb) return opts.eb;
  const m = HC.applyPcbChanges(board || {}, (opts && opts.changes) || [], { pcblib:opts && opts.pcblib });
  return HC.effectiveBoard(board || {}, m);
}

function compara(schematic, board, opts){
  const o = opts || {};
  const eb = placaEfetiva(board, o);
  const { comps:sch, folhas } = compsDoEsquema(schematic, o.schlib);
  const cegos = new Set([...sch.values()].filter(s => s.cego).map(s => s.ref));
  const ex = HC.extractNets(schematic || { items:[] }, o.schlib);
  const acoes = [];
  let seq = 0;
  const acao = (grupo, a) => { const x = Object.assign({ id:'e' + (++seq), grupo, ativo:true, status:'ok', msg:'' }, a); acoes.push(x); return x; };

  /* ---- nets do esquema: so as da lista (pino sozinho nao vira net) ---- */
  const netSch = new Map();
  const autoSch = new Set();
  for (const n of ex.nets) { netSch.set(n.name, new Set(n.pins)); if (n.auto) autoSch.add(n.name); }
  const pinSch = Object.create(null);
  for (const [nome, pins] of netSch) for (const p of pins) pinSch[p] = nome;

  /* ---- placa ---- */
  const pcb = new Map();
  for (const c of (eb.components || [])) if (c && c.ref) pcb.set(c.ref, c);
  const netPcbPins = new Map();
  const listaPcb = Array.isArray(eb.nets) ? eb.nets.filter(n => typeof n === 'string' && n) : [];
  for (const n of listaPcb) netPcbPins.set(n, new Set());
  const padNet = Object.create(null);
  for (const c of pcb.values()) for (const p of (c.pads || [])) {
    if (!p || p.name == null || p.name === '') continue;
    const k = c.ref + '-' + p.name;
    if (k in padNet) continue;
    padNet[k] = p.net || '';
    if (p.net) { if (!netPcbPins.has(p.net)) netPcbPins.set(p.net, new Set()); netPcbPins.get(p.net).add(k); }
  }

  /* ---- nets: nome igual; senao >= 75% dos pinos (min 3) = renomear; senao criar ---- */
  const mapaPcb = Object.create(null);           /* net da placa -> nome final */
  const casadas = new Set();
  for (const nome of netSch.keys()) if (netPcbPins.has(nome)) { mapaPcb[nome] = nome; casadas.add(nome); }
  const nomesSch = [...netSch.keys()].sort(natural);
  for (const nome of nomesSch) {
    if (casadas.has(nome)) continue;
    const P = netSch.get(nome);
    /* nome automatico (Net<ref>_<pino>) com componente de pinagem desconhecida na conta: o nome
       sai do MENOR pino, e o menor pode ser justamente o que a previa nao enxerga (no LM555, o
       Altium chama de NetCI1_7 a net que a previa, sem o pino do CI1, chama de NetR1_1). Os
       pinos CONHECIDOS iguais bastam: e a mesma net, sem acao. */
    if (autoSch.has(nome) && cegos.size) {
      const igual = [...netPcbPins].find(([bn, bp]) => !(bn in mapaPcb) && !netSch.has(bn) &&
        [...bp].filter(k => !cegos.has(k.slice(0, k.lastIndexOf('-')))).sort().join('|') === [...P].sort().join('|'));
      if (igual) { mapaPcb[igual[0]] = nome; casadas.add(nome); continue; }
    }
    let melhor = null, mOv = 0;
    for (const [bn, bp] of netPcbPins) {
      if (bn in mapaPcb || netSch.has(bn)) continue;
      let ov = 0; for (const p of P) if (bp.has(p)) ov++;
      if (ov > mOv) { mOv = ov; melhor = bn; }
    }
    if (melhor && mOv >= COMP_MIN && mOv / Math.max(P.size, netPcbPins.get(melhor).size) >= COMP_PCT) {
      mapaPcb[melhor] = nome; casadas.add(nome);
      acao('netRename', { tipo:'net_rename', objeto:melhor, para:nome,
                          msg:`${mOv} de ${P.size} pinos iguais`, dados:{ net:nome, orig_net:melhor } });
    } else {
      acao('netAdd', { tipo:'net_add', objeto:nome, para:'PCB', dados:{ net:nome } });
      casadas.add(nome);
    }
  }
  for (const bn of [...netPcbPins.keys()].sort(natural)) {
    if (bn in mapaPcb || netSch.has(bn)) continue;
    if (!listaPcb.includes(bn)) continue;          /* net so num pad, fora da lista: nada a remover */
    /* net com pino de componente de pinagem desconhecida: nao da para dizer que sobrou */
    if ([...netPcbPins.get(bn)].some(k => cegos.has(k.slice(0, k.lastIndexOf('-'))))) continue;
    const usos = contaUsos(eb, bn);
    acao('netDel', { tipo:'net_del', objeto:bn, para:'PCB', dados:{ net:bn },
                     msg: usos ? `${usos} objeto(s) da placa ficam sem net` : '' });
  }
  const netFinal = n => (n && n in mapaPcb) ? mapaPcb[n] : n;

  /* ---- componentes ---- */
  const novos = [];
  for (const ref of [...sch.keys()].sort(natural)) {
    const s = sch.get(ref), c = pcb.get(ref);
    if (!c) {
      const a = acao('compAdd', { tipo:'comp_add', objeto:ref, para:'PCB',
                                  dados:{ ref, footprint:s.footprint, comment:ehFormula(s.comment) ? '' : (s.comment || ''), sheet:s.sheet } });
      novos.push(a);
      continue;
    }
    if (s.footprint && !mesmoFootprint(s.footprint, c.footprint || '', o.pcblib)) {
      const a = acao('compFp', { tipo:'comp_fp', objeto:ref, para:s.footprint,
                                 msg:`${c.footprint || '(sem footprint)'} -> ${s.footprint}`,
                                 dados:{ ref, footprint:s.footprint, sheet:s.sheet,
                                         comment:(!ehFormula(s.comment) && s.comment) ? s.comment : (c.comment || ''),
                                         x:c.x, y:c.y, rot:c.rot, layer:c.layer, orig_footprint:c.footprint || '' } });
      novos.push(a);
      continue;                                    /* os pinos vem no comp_add da troca */
    }
    if (!ehFormula(s.comment) && s.comment && s.comment !== (c.comment || ''))
      acao('compComent', { tipo:'comp_attr', objeto:ref, para:s.comment, msg:`"${c.comment || ''}" -> "${s.comment}"`,
                           dados:{ ref, comment:s.comment, orig_designator:ref, orig_comment:c.comment || '' } });
    /* pinos: cada nome de pad da placa contra a net que o esquema da ao pino */
    if (cegos.has(ref)) continue;
    const vistos = new Set();
    for (const p of (c.pads || [])) {
      if (!p || p.name == null || p.name === '' || vistos.has(String(p.name))) continue;
      vistos.add(String(p.name));
      const k = ref + '-' + p.name;
      const quer = pinSch[k] || '', tem = netFinal(padNet[k] || '');
      if (quer === tem) continue;
      if (quer) acao('pinAdd', { tipo:'pad_net', objeto:k, para:quer, msg:tem ? `sai de ${tem}` : '',
                                 dados:{ ref, pad:String(p.name), net:quer, orig_net:padNet[k] || '' } });
      /* o pino ficou sozinho na previa porque os outros da net sao de componente de pinagem
         desconhecida (C2-2 com o CI1-5 no LM555): nao da para afirmar que ele sai da net */
      else if ([...(netPcbPins.get(padNet[k]) || [])].some(q => cegos.has(q.slice(0, q.lastIndexOf('-'))))) continue;
      else acao('pinDel', { tipo:'pad_net', objeto:k, para:padNet[k],
                            dados:{ ref, pad:String(p.name), net:'', orig_net:padNet[k] || '' } });
    }
    /* pino do esquema sem pad no footprint: o "Unknown Pin" do Altium */
    for (const k of Object.keys(pinSch)) {
      if (k.slice(0, ref.length + 1) !== ref + '-') continue;
      const pino = k.slice(ref.length + 1);
      if (!vistos.has(pino))
        acao('pinAdd', { tipo:'pad_net', objeto:k, para:pinSch[k], status:'err', ativo:false,
                         msg:`pino ${pino} não tem pad no footprint ${c.footprint || ''} (Unknown Pin)`,
                         dados:{ ref, pad:pino, net:pinSch[k], orig_net:'' }, semPad:true });
    }
  }
  for (const ref of [...pcb.keys()].sort(natural)) {
    if (sch.has(ref)) continue;
    const c = pcb.get(ref);
    acao('compDel', { tipo:'comp_del', objeto:ref, para:'PCB', msg:c.footprint || '',
                      dados:{ ref, orig_x:c.x, orig_y:c.y, orig_rot:c.rot, orig_layer:c.layer, orig_footprint:c.footprint || '' } });
  }
  /* nets dos componentes novos: pino do esquema -> pad do footprint */
  for (const a of novos) {
    const nets = {};
    /* troca de footprint de componente de pinagem desconhecida: as nets que o pad tinha ficam
       (pelo nome do pad) -- a previa nao sabe as do esquema, e o Altium sabe */
    if (a.tipo === 'comp_fp' && cegos.has(a.dados.ref)) {
      for (const p of (pcb.get(a.dados.ref).pads || [])) if (p && p.net && !(String(p.name) in nets)) nets[String(p.name)] = netFinal(p.net);
      a.dados.nets = nets;
      continue;
    }
    for (const k of Object.keys(pinSch)) if (k.slice(0, a.dados.ref.length + 1) === a.dados.ref + '-') nets[k.slice(a.dados.ref.length + 1)] = pinSch[k];
    a.dados.nets = nets;
  }

  /* componente de pinagem desconhecida: uma linha de aviso, sem acao de pino */
  for (const ref of [...cegos].sort(natural)) if (pcb.has(ref))
    acao('pinAdd', { tipo:'info', objeto:ref, para:'', ativo:false, status:'warn', semPad:false, info:true,
                     msg:`símbolo "${sch.get(ref).sym}" não está na schlib: pinos de ${ref} não conferidos`, dados:{ ref } });
  const eco = { acoes, folhas, eb, avisosNets:ex.warnings.slice(),
                resumo:null, opts:{ pcblib:o.pcblib || null } };
  Object.defineProperty(eco, 'opts', { enumerable:false, value:eco.opts, writable:true });
  Object.defineProperty(eco, 'eb', { enumerable:false, value:eb, writable:true });
  valida(eco);
  return eco;
}

function contaUsos(eb, net){
  let n = 0;
  for (const k of ['tracks', 'arcs', 'vias', 'fills', 'regions', 'freepads', 'polygons']) for (const o of (eb[k] || [])) if (o && o.net === net) n++;
  return n;
}

/* Validate Changes: refaz o status de cada acao (o Check do Altium), com as desmarcadas em conta */
function valida(eco, opts){
  const o = Object.assign({}, eco.opts || {}, opts || {});
  const eb = eco.eb || {};
  const ativa = new Set(eco.acoes.filter(a => a.ativo).map(a => a.id));
  const netNova = Object.create(null), netSai = Object.create(null), netRen = Object.create(null);
  for (const a of eco.acoes) {
    if (a.tipo === 'net_add') netNova[a.dados.net] = a;
    if (a.tipo === 'net_del') netSai[a.dados.net] = a;
    if (a.tipo === 'net_rename') netRen[a.dados.net] = a;
  }
  const existe = new Set((eb.nets || []).filter(n => typeof n === 'string'));
  /* a net existira depois do ECO? (nova marcada, renomeada marcada, ou ja existe e nao sai) */
  const netOk = n => {
    if (!n) return '';
    if (netNova[n]) return ativa.has(netNova[n].id) ? '' : `depende de "Adicionar net ${n}", desmarcada`;
    if (netRen[n]) return ativa.has(netRen[n].id) ? '' : `depende de "Renomear net → ${n}", desmarcada`;
    if (netSai[n] && ativa.has(netSai[n].id)) return `a net ${n} também está sendo removida`;
    return existe.has(n) ? '' : `net ${n} não existe na placa`;
  };
  for (const a of eco.acoes) {
    if (a.semPad) { a.status = 'err'; continue; }
    if (a.info) { a.status = 'warn'; continue; }
    a.status = 'ok'; a.msgValida = '';
    const ruim = (s, m) => { if (a.status !== 'err') { a.status = s; a.msgValida = m; } };
    if (a.tipo === 'comp_add' || a.tipo === 'comp_fp') {
      if (!a.dados.footprint) { ruim('err', 'sem footprint no esquema — defina no símbolo'); continue; }
      const g = HC.footprintGeom(a.dados.footprint, eb, { pcblib:o.pcblib });
      if (!g) { ruim('err', `footprint "${a.dados.footprint}" não encontrado na PcbLib (Libs/pcblib.js)`); continue; }
      a.fonte = g.fonte;
      const pads = new Set((g.fp.pads || []).map(p => String(p.name)));
      const falta = Object.keys(a.dados.nets || {}).filter(k => !pads.has(k));
      if (falta.length) ruim('warn', `pino(s) ${falta.join(', ')} sem pad no footprint — ficam fora da net`);
      const dep = [...new Set(Object.values(a.dados.nets || {}))].map(netOk).filter(Boolean);
      if (dep.length) ruim('warn', dep[0] + ' — o pad entra sem net');
    } else if (a.tipo === 'pad_net' && a.dados.net) {
      const m = netOk(a.dados.net);
      if (m) ruim('err', m);
    }
  }
  const conta = s => eco.acoes.filter(a => a.ativo && a.status === s).length;
  eco.resumo = { total:eco.acoes.length, ativas:ativa.size, ok:conta('ok'), avisos:conta('warn'), erros:conta('err') };
  return eco;
}

/* Execute Changes: as acoes marcadas e sem erro -> linhas do changes.js, na ordem dos grupos.
   Componente novo estaciona a DIREITA da placa, em colunas (uma por folha, como a Room do
   Altium), de cima para baixo, e sem cair em cima de quem ja estacionou num ECO anterior. A troca
   de footprint fica no mesmo lugar (comp_del + comp_add com x/y/rot/layer de antes). */
function aplica(eco, opts){
  const o = Object.assign({ margem:5, folga:1.27 }, opts || {});
  valida(eco, o);
  const eb = eco.eb || {};
  const linhas = [], puladas = [];
  const vai = eco.acoes.filter(a => {
    if (!a.ativo) return false;
    if (a.status === 'err') { puladas.push({ acao:a, motivo:a.msgValida || a.msg || 'erro de validação' }); return false; }
    return true;
  });
  /* estacionamento */
  const bb = (eb.board && eb.board.bbox) || null;
  let x0 = isNum(o.x0) ? o.x0 : (bb ? bb.x2 + o.margem : 0);
  const topo = isNum(o.y0) ? o.y0 : (bb ? bb.y2 : 0);
  const fundo = bb ? bb.y1 : topo - 100;
  if (!isNum(o.x0)) for (const c of (eb.components || []))
    if (c && c.bbox && bb && c.bbox.x1 > bb.x2) x0 = Math.max(x0, c.bbox.x2 + o.margem);
  const lugar = (() => {
    let cx = x0, cy = topo, larg = 0, folha = null;
    return (fp, sheet) => {
      const b = (fp && fp.bbox) || { x1:-1, y1:-1, x2:1, y2:1 };
      const w = b.x2 - b.x1, h = b.y2 - b.y1;
      const novaColuna = () => { cx += larg + o.folga * 2; cy = topo; larg = 0; };
      if (folha !== null && sheet !== folha && larg > 0) novaColuna();
      folha = sheet;
      if (cy - h < fundo && cy !== topo) novaColuna();
      const x = r4(cx - b.x1), y = r4(cy - b.y2);
      cy -= h + o.folga; larg = Math.max(larg, w);
      return { x, y };
    };
  })();
  const ord = vai.slice().sort((a, b) => (GRUPO[a.grupo].ordem - GRUPO[b.grupo].ordem) ||
                                          (a.tipo === 'comp_add' && b.tipo === 'comp_add' ? natural(eco.folhas.indexOf(a.dados.sheet), eco.folhas.indexOf(b.dados.sheet)) : 0) ||
                                          natural(a.objeto, b.objeto));
  const nota = a => 'ECO: ' + GRUPO[a.grupo].altium + ' ' + a.objeto;
  const netsDe = a => {
    const m = {};
    for (const k of Object.keys(a.dados.nets || {})) {
      const n = a.dados.nets[k];
      const nova = eco.acoes.find(x => x.tipo === 'net_add' && x.dados.net === n);
      if (nova && !vai.includes(nova)) continue;      /* a net nao vai existir: pad sem net */
      m[k] = n;
    }
    return HC.netsCampo(m);
  };
  for (const a of ord) {
    const d = a.dados;
    switch (a.tipo) {
      case 'net_rename': linhas.push({ op:'net_rename', net:d.net, orig_net:d.orig_net, note:nota(a) }); break;
      case 'net_add':    linhas.push({ op:'net_add', net:d.net, note:nota(a) }); break;
      case 'net_del':    linhas.push({ op:'net_del', net:d.net, note:nota(a) }); break;
      case 'comp_del':
        linhas.push({ op:'comp_del', ref:d.ref, orig_x:d.orig_x, orig_y:d.orig_y, orig_rot:d.orig_rot, orig_layer:d.orig_layer,
                      orig_footprint:d.orig_footprint, note:nota(a) });
        break;
      case 'comp_fp': {
        linhas.push({ op:'comp_del', ref:d.ref, orig_x:d.x, orig_y:d.y, orig_rot:d.rot, orig_layer:d.layer,
                      orig_footprint:d.orig_footprint, note:nota(a) });
        const l = { op:'comp_add', ref:d.ref, footprint:d.footprint, x:d.x, y:d.y, rot:d.rot, layer:d.layer };
        if (d.comment) l.comment = d.comment;
        const n = netsDe(a); if (n) l.nets = n;
        l.note = nota(a);
        linhas.push(l);
        break;
      }
      case 'comp_add': {
        const g = HC.footprintGeom(d.footprint, eb, { pcblib:o.pcblib || (eco.opts && eco.opts.pcblib) });
        const p = lugar(g && g.fp, d.sheet);
        const l = { op:'comp_add', ref:d.ref, footprint:d.footprint, x:p.x, y:p.y, rot:0, layer:'Top' };
        if (d.comment) l.comment = d.comment;
        const n = netsDe(a); if (n) l.nets = n;
        l.note = nota(a) + (d.sheet ? ' (folha ' + d.sheet + ')' : '');
        linhas.push(l);
        break;
      }
      case 'pad_net':
        linhas.push({ op:'pad_net', ref:d.ref, pad:d.pad, net:d.net, orig_net:d.orig_net, note:nota(a) });
        break;
      case 'comp_attr':
        linhas.push({ op:'comp_attr', ref:d.ref, comment:d.comment, orig_designator:d.orig_designator, orig_comment:d.orig_comment, note:nota(a) });
        break;
    }
  }
  /* note nao pode ter a sequencia aspas-dois-pontos (o parser de linha) */
  for (const l of linhas) if (typeof l.note === 'string') l.note = l.note.replace(/":/g, '" :');
  return { linhas, puladas };
}

/* Report Changes: o relatorio de texto, agrupado */
function relatorio(eco){
  const L = ['Engineering Change Order — NexoEletric', ''];
  const r = eco.resumo || {};
  L.push(`Ações: ${r.total || 0}  marcadas: ${r.ativas || 0}  ok: ${r.ok || 0}  avisos: ${r.avisos || 0}  erros: ${r.erros || 0}`, '');
  for (const g of GRUPOS) {
    const as = eco.acoes.filter(a => a.grupo === g.chave);
    if (!as.length) continue;
    L.push(`${g.titulo} (${g.altium}) — ${as.length}`);
    for (const a of as) {
      const st = a.status === 'err' ? 'ERRO ' : a.status === 'warn' ? 'AVISO' : 'ok   ';
      const m = [a.msg, a.msgValida].filter(Boolean).join(' — ');
      L.push(`  [${a.ativo ? 'x' : ' '}] ${st} ${a.objeto}${a.para && a.para !== 'PCB' ? ' -> ' + a.para : ''}${m ? '   ' + m : ''}`);
    }
    L.push('');
  }
  if ((eco.avisosNets || []).length) { L.push('Avisos da extração de nets (prévia do compilador):'); for (const w of eco.avisosNets) L.push('  ' + w); }
  return L.join('\n') + '\n';
}

return { GRUPOS, compara, valida, aplica, relatorio, mesmoFootprint, compsDoEsquema };
});
