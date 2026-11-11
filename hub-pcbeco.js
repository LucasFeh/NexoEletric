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
     trocasFp(eco) -> [{id, ref, de, para, ativo, status, msg, pads_mudam, pads_ficam_da_placa, pads_saem}]
   Troca de footprint (comp_del + comp_add no mesmo lugar, com o designator de antes): os pads
   levam a net que tem HOJE na placa; cada diferenca do esquema e uma acao de pino propria
   (dados.troca = id da troca), marcada, que se desmarca para ficar com a net da placa.
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
  /* o Graphical (1.97.0) não vai para a placa: nem componente, nem pino nas nets */
  const graf = typeof HC.graficoRefs === 'function' ? HC.graficoRefs(sch) : new Set();
  for (const s of M.sheets) for (const c of s.comps) {
    if (!c || !c.ref || graf.has(String(c.ref))) continue;
    let r = out.get(c.ref);
    if (!r) { r = { ref:c.ref, footprint:'', comment:'', sheet:s.name, sym:c.sym, partes:0, cego:false }; out.set(c.ref, r); }
    r.partes++;
    /* simbolo (ou parte) que nenhuma lib tem: a pinagem e desconhecida, e o extractNets pula os
       pinos dele -- comparar daria "remover pino" em todos. Nao conferido e diferente de errado. */
    if (!HC.compPinsWorld(c, schlib)) r.cego = true;
    if (!r.footprint && typeof c.footprint === 'string') r.footprint = c.footprint;
    /* o mapa pino↔pad (1.96.0, HubCore.mapaPinoPad): o pino do esquema vai no pad do mapa */
    if (!r.mapa && typeof HC.mapaPinoPad === 'function') r.mapa = HC.mapaPinoPad(c);
    if (!r.comment && typeof c.comment === 'string') r.comment = c.comment;
  }
  return { comps:out, folhas:M.sheets.map(s => s.name), graficos:graf };
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
  const { comps:sch, folhas, graficos } = compsDoEsquema(schematic, o.schlib);
  const cegos = new Set([...sch.values()].filter(s => s.cego).map(s => s.ref));
  const ex = HC.extractNets(schematic || { items:[] }, o.schlib);
  const acoes = [];
  let seq = 0;
  const acao = (grupo, a) => { const x = Object.assign({ id:'e' + (++seq), grupo, ativo:true, status:'ok', msg:'' }, a); acoes.push(x); return x; };

  /* ---- nets do esquema: so as da lista (pino sozinho nao vira net) ---- */
  const netSch = new Map();
  const autoSch = new Set();
  /* REF-PINO do esquema vira REF-PAD da placa pelo mapa pino↔pad do componente (o CAP 0805 com pads A/B).
     1.96.1: contra os pads de VERDADE — o do componente que já está na placa (com o mesmo footprint), ou o do
     footprint da biblioteca (componente novo, troca de footprint). O pino que tem pad de mesmo nome vai nele; só o
     que não tem vai pelo mapa (HubCore.padDoPino com os pads). O dono pôs "A=1;B=2" no C5 (a biblioteca chama de
     1/2, a placa de A/B) e o ECO dava Unknown Pin: o mapa valia contra a placa também. */
  const naPlaca = new Map();
  for (const c of (eb.components || [])) if (c && c.ref && !naPlaca.has(c.ref)) naPlaca.set(c.ref, c);
  const padsAlvo = new Map();
  const padsDe = ref => {
    if (padsAlvo.has(ref)) return padsAlvo.get(ref);
    const s = sch.get(ref), c = naPlaca.get(ref);
    let pads = null;
    if (c && (!s.footprint || mesmoFootprint(s.footprint, c.footprint || '', o.pcblib))) pads = new Set((c.pads || []).map(p => String(p.name)));
    else if (s.footprint) { const g = HC.footprintGeom(s.footprint, eb, { pcblib:o.pcblib }); if (g) pads = new Set((g.fp.pads || []).map(p => String(p.name))); }
    padsAlvo.set(ref, pads);
    return pads;
  };
  const paraPad = k => {
    const i = k.lastIndexOf('-'), ref = i > 0 ? k.slice(0, i) : '', s = ref ? sch.get(ref) : null;
    if (!s || !s.mapa) return k;
    const pad = typeof HC.padDoPino === 'function' ? HC.padDoPino(null, k.slice(i + 1), s.mapa, padsDe(ref)) : k.slice(i + 1);
    return ref + '-' + pad;
  };
  const doGrafico = k => graficos.has(k.slice(0, k.lastIndexOf('-')));
  for (const n of ex.nets) {
    const pins = n.pins.filter(k => !doGrafico(k));
    /* a net que só o Graphical ligava (o contator e a port) não existe na placa */
    if (!pins.length) continue;
    /* sem nome, com um pino só depois de tirar o Graphical: o Altium não a põe na placa (pino solto) */
    if (n.auto && pins.length < 2) continue;
    netSch.set(n.name, new Set(pins.map(paraPad))); if (n.auto) autoSch.add(n.name);
  }
  const pinSch = Object.create(null);
  for (const [nome, pins] of netSch) for (const p of pins) pinSch[p] = nome;

  /* ---- placa ---- */
  const pcb = new Map();
  /* a arte de overlay (1.91.0: o desenho que se puxa na placa) não é peça do esquema: o ECO não a tira */
  for (const c of (eb.components || [])) if (c && c.ref && !(c.arte && typeof c.arte === 'object')) pcb.set(c.ref, c);
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

  /* ---- nets: nome igual; senao >= 75% dos pinos (min 3) = renomear; senao criar ----
     1.96.0 (pedido do dono: "a sincronização com o Altium falha com placa multi-esquema: as nets com sufixo de folha
     (_4) fazem o ECO querer apagar dezenas de nets"). Duas coisas:
       - o SUFIXO DE FOLHA: o Altium, com "Append Sheet Numbers to Local Nets", chama a net local EN da folha 4 de
         EN_4; o esquema daqui a chama de EN. A net da placa X_<n> com os pinos da X do esquema é a mesma net, mesmo
         com 2 pinos só (abaixo do mínimo de 3 da comparação por pinos);
       - a net VAZIA de mesmo nome: um ECO antigo pôs `net_add EN` (vazia) e deixou os pads na EN_4; o nome igual
         ganhava, e a EN_4 — com os pads, as trilhas e o plano — saía como "Remover net" e 51 objetos ficavam sem net.
         Agora a vazia só casa pelo nome se nenhuma net da placa tiver os pinos; se tiver, a vazia sai e a outra é
         renomeada (as duas linhas juntas, na ordem). */
  const mapaPcb = Object.create(null);           /* net da placa -> nome final */
  const casadas = new Set();
  const vaziaComNome = [];
  for (const nome of netSch.keys()) if (netPcbPins.has(nome)) {
    if (!netPcbPins.get(nome).size && netSch.get(nome).size) { vaziaComNome.push(nome); continue; }
    mapaPcb[nome] = nome; casadas.add(nome);
  }
  const sufixoDeFolha = (bn, nome) => bn.length > nome.length + 1 && bn.slice(0, nome.length + 1) === nome + '_' && /^\d+$/.test(bn.slice(nome.length + 1));
  /* a net da placa (ainda sem dono, fora do esquema) que tem os pinos da net `nome` do esquema: { bn, ov, porFolha } */
  const melhorPorPinos = nome => {
    const P = netSch.get(nome);
    let melhor = null, mOv = 0, folha = null;
    for (const [bn, bp] of netPcbPins) {
      if (bn in mapaPcb || netSch.has(bn) || !bp.size) continue;
      let ov = 0; for (const p of P) if (bp.has(p)) ov++;
      if (ov > mOv) { mOv = ov; melhor = bn; }
      const pct = ov / Math.max(P.size, bp.size);
      if (sufixoDeFolha(bn, nome) && ov && pct >= COMP_PCT && (!folha || ov > folha.ov)) folha = { bn, ov };
    }
    if (folha) return { bn: folha.bn, ov: folha.ov, porFolha: true };
    if (melhor && mOv >= COMP_MIN && mOv / Math.max(P.size, netPcbPins.get(melhor).size) >= COMP_PCT) return { bn: melhor, ov: mOv };
    return null;
  };
  const renomeia = (nome, m, apagaVazia) => {
    const P = netSch.get(nome);
    mapaPcb[m.bn] = nome; casadas.add(nome);
    if (apagaVazia) mapaPcb[nome] = nome;        /* a vazia sai: nao e "net que sobrou" */
    acao('netRename', { tipo:'net_rename', objeto:m.bn, para:nome,
                        msg: `${m.ov} de ${P.size} pinos iguais` + (m.porFolha ? ' (sufixo de folha do Altium)' : '')
                           + (apagaVazia ? ` — a "${nome}" vazia da placa sai antes` : ''),
                        dados:{ net:nome, orig_net:m.bn, apagaVazia: !!apagaVazia } });
  };
  for (const nome of vaziaComNome.sort(natural)) {
    const m = melhorPorPinos(nome);
    if (m) renomeia(nome, m, true);
    else { mapaPcb[nome] = nome; casadas.add(nome); }
  }
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
    const m = melhorPorPinos(nome);
    if (m) renomeia(nome, m, false);
    else {
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
    /* 1.97.4 (pedido do dono: "o ECO deveria recusar, ou pelo menos avisar alto, quando vai apagar uma net que ainda
       tem cobre — eram 51 e 55 objetos"): a net com cobre não sai pelo ECO. Ela sai desmarcada e com erro (não
       grava nem marcando): renomeie a net (se for a mesma ligação com outro nome) ou tire o cobre antes. */
    acao('netDel', { tipo:'net_del', objeto:bn, para:'PCB', dados:{ net:bn, usos }, ativo: !usos, status: usos ? 'err' : 'ok',
                     msg: usos ? `a net ainda tem ${usos} objeto(s) de cobre na placa — apagar deixaria esse cobre sem net (curto no DRC): o ECO não apaga net com cobre; se é a mesma ligação com outro nome, é renomear` : '' });
  }
  const netFinal = n => (n && n in mapaPcb) ? mapaPcb[n] : n;

  /* ---- troca de footprint ----
     O componente sai e volta (comp_del + comp_add) com as nets que os pads tem HOJE na placa,
     pelo nome do pad -- como o "Update PCB With" da vista (opsTrocaFp do pcbframe). Trocar o
     footprint nao religa nada calado: onde o esquema discorda (outra net, ou pad que so o
     footprint novo tem), a diferenca vira acao de pino PROPRIA, marcada (aceitar tudo deixa a
     placa como o esquema), que se desmarca para ficar com a net da placa. Pad do footprint velho
     que o novo nao tem sai com a net dele: vai no aviso da troca. Pinagem desconhecida (cego):
     so as nets da placa, sem acao de pino. */
  const trocaFp = (a, s, c) => {
    const ref = a.dados.ref;
    const velhos = new Map();                     /* nome do pad -> net crua da placa */
    for (const p of (c.pads || [])) if (p && p.name != null && p.name !== '' && !velhos.has(String(p.name))) velhos.set(String(p.name), p.net || '');
    const g = HC.footprintGeom(s.footprint, eb, { pcblib:o.pcblib });
    /* sem a geometria (o valida acusa) os pads sao os de hoje: as acoes de pino ainda valem nele */
    const novosPads = g ? [...new Set((g.fp.pads || []).filter(p => p && p.name != null && p.name !== '').map(p => String(p.name)))]
                        : [...velhos.keys()];
    const temPad = new Set(novosPads);
    const nets = {};
    for (const pad of novosPads) if (velhos.get(pad)) nets[pad] = velhos.get(pad);
    a.dados.nets = nets;
    a.dados.somem = [...velhos].filter(([pad]) => !temPad.has(pad)).map(([pad, net]) => ({ pad, net }));
    if (cegos.has(ref)) return;
    for (const pad of novosPads) {
      const k = ref + '-' + pad, cru = velhos.get(pad) || '';
      const quer = pinSch[k] || '', tem = netFinal(cru);
      if (quer === tem) continue;
      const base = { ref, pad, orig_net:cru, troca:a.id, padNovo:!velhos.has(pad) };
      if (quer) acao('pinAdd', { tipo:'pad_net', objeto:k, para:quer,
                                 msg:'troca de footprint: ' + (tem ? `na placa está em ${tem}` : velhos.has(pad) ? 'sem net na placa' : `pad novo do ${s.footprint}`),
                                 dados:Object.assign({ net:quer }, base) });
      else if ([...(netPcbPins.get(cru) || [])].some(q => cegos.has(q.slice(0, q.lastIndexOf('-'))))) continue;
      else acao('pinDel', { tipo:'pad_net', objeto:k, para:cru, msg:`troca de footprint: o esquema não liga o pino ${pad}`,
                            dados:Object.assign({ net:'' }, base) });
    }
    for (const k of Object.keys(pinSch)) {
      if (k.slice(0, ref.length + 1) !== ref + '-') continue;
      const pino = k.slice(ref.length + 1);
      if (!temPad.has(pino))
        acao('pinAdd', { tipo:'pad_net', objeto:k, para:pinSch[k], status:'err', ativo:false,
                         msg:`pino ${pino} não tem pad no footprint ${s.footprint} (Unknown Pin)`,
                         dados:{ ref, pad:pino, net:pinSch[k], orig_net:'' }, semPad:true });
    }
  };

  /* o footprint achado por OUTRO nome (rename-map ou chave) sem os pads que o esquema liga: a acao avisa (1.96.0,
     o caso do "Barra Prog Atmega") */
  const avisaRenome = (a, ref, fp) => {
    if (!o.pcblib || typeof HC.avisoFootprintRenomeado !== 'function') return;
    const esp = Object.keys(pinSch).filter(k => k.slice(0, ref.length + 1) === ref + '-').map(k => k.slice(ref.length + 1));
    const t = HC.avisoFootprintRenomeado(o.pcblib, fp, esp);
    if (!t) return;
    if (a.status === 'ok') a.status = 'warn';
    a.msg = (a.msg ? a.msg + ' — ' : '') + t;
  };

  /* ---- componentes ---- */
  const novos = [];
  for (const ref of [...sch.keys()].sort(natural)) {
    const s = sch.get(ref), c = pcb.get(ref);
    if (!c) {
      const a = acao('compAdd', { tipo:'comp_add', objeto:ref, para:'PCB',
                                  dados:{ ref, footprint:s.footprint, comment:ehFormula(s.comment) ? '' : (s.comment || ''), sheet:s.sheet } });
      avisaRenome(a, ref, s.footprint);
      novos.push(a);
      continue;
    }
    if (s.footprint && !mesmoFootprint(s.footprint, c.footprint || '', o.pcblib)) {
      const a = acao('compFp', { tipo:'comp_fp', objeto:ref, para:s.footprint,
                                 msg:`${c.footprint || '(sem footprint)'} → ${s.footprint}`,
                                 dados:{ ref, footprint:s.footprint, sheet:s.sheet,
                                         comment:(!ehFormula(s.comment) && s.comment) ? s.comment : (c.comment || ''),
                                         x:c.x, y:c.y, rot:c.rot, layer:c.layer, orig_footprint:c.footprint || '',
                                         des:designatorDe(eb, ref) } });
      trocaFp(a, s, c);
      avisaRenome(a, ref, s.footprint);
      continue;                                    /* os pinos da troca sao do trocaFp */
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
  /* nets dos componentes novos: pino do esquema -> pad do footprint (a troca de footprint leva
     as da placa: trocaFp) */
  for (const a of novos) {
    const nets = {};
    for (const k of Object.keys(pinSch)) if (k.slice(0, a.dados.ref.length + 1) === a.dados.ref + '-') nets[k.slice(a.dados.ref.length + 1)] = pinSch[k];
    a.dados.nets = nets;
  }

  /* componente de pinagem desconhecida: uma linha de aviso, sem acao de pino */
  for (const ref of [...cegos].sort(natural)) if (pcb.has(ref))
    acao('pinAdd', { tipo:'info', objeto:ref, para:'', ativo:false, status:'warn', semPad:false, info:true,
                     msg:`símbolo "${sch.get(ref).sym}" não está na schlib: pinos de ${ref} não conferidos`, dados:{ ref } });
  /* AS DUAS JUNTAS (1.97.1). Pedido do dono: "o ECO deixou aplicar o 'Adicionar pino à net' de um pad sem a
     renomeação da net a que ele pertence. O pad fica com um nome e o cobre dele com outro, e o DRC acusa curto.
     Quando houver renomeação pendente para a net de um pad, o ECO deveria aplicar as duas juntas ou avisar antes."
     A ação de pino que leva o pad para o nome NOVO de uma renomeação depende dela (dados.ren): marcar a de pino
     marca a renomeação, e desmarcar a renomeação desmarca as de pino (junta, abaixo; o diálogo e o eco_aplicar
     usam). E a validação avisa, antes, o pad que muda de net com cobre da net antiga ligado nele. */
  const renPorNet = Object.create(null);
  for (const a of acoes) if (a.tipo === 'net_rename') renPorNet[a.dados.net] = a;
  for (const a of acoes) if (a.tipo === 'pad_net' && a.dados && a.dados.net && renPorNet[a.dados.net]) a.dados.ren = renPorNet[a.dados.net].id;
  const eco = { acoes, folhas, eb, avisosNets:ex.warnings.slice(),
                resumo:null, opts:{ pcblib:o.pcblib || null } };
  Object.defineProperty(eco, 'opts', { enumerable:false, value:eco.opts, writable:true });
  Object.defineProperty(eco, 'eb', { enumerable:false, value:eb, writable:true });
  valida(eco);
  return eco;
}

/* trilhas, arcos e vias da net `net` que encostam no pad `ref-pad` da placa efetiva: { n, txt } */
function cobreNoPad(eb, ref, pad, net){
  const c = (eb.components || []).find(x => x && x.ref === ref);
  const p = c && (c.pads || []).find(q => q && String(q.name) === String(pad));
  if (!p || !isNum(p.x) || !isNum(p.y)) return { n:0, txt:'' };
  const r = Math.max(+p.w || 0, +p.h || 0) / 2 + 0.05;
  const perto = (x, y) => isNum(x) && isNum(y) && Math.hypot(x - p.x, y - p.y) <= r;
  let t = 0, v = 0;
  for (const o of (eb.tracks || [])) if (o && o.net === net && (perto(o.x1, o.y1) || perto(o.x2, o.y2))) t++;
  for (const o of (eb.arcs || [])) if (o && o.net === net && isNum(o.cx)) {
    const pt = g => [o.cx + o.r * Math.cos(g * Math.PI / 180), o.cy + o.r * Math.sin(g * Math.PI / 180)];
    if (perto(...pt(o.sa)) || perto(...pt(o.ea))) t++;
  }
  for (const o of (eb.vias || [])) if (o && o.net === net && perto(o.x, o.y)) v++;
  const partes = [];
  if (t) partes.push(t + (t === 1 ? ' trilha' : ' trilhas'));
  if (v) partes.push(v + (v === 1 ? ' via' : ' vias'));
  return { n:t + v, txt:partes.join(' e ') };
}
/* Marca (ou desmarca) a ação `a` com as que vão junto (1.97.1): a ação de pino puxa a renomeação de que depende
   (dados.ren); desmarcar a renomeação desmarca as de pino que dependem dela. Devolve as OUTRAS que mudaram. */
function junta(eco, a, ligado){
  const mudou = [];
  const poe = (x, v) => { if (x && !x.semPad && !x.info && x.ativo !== v) { x.ativo = v; if (x !== a) mudou.push(x); } };
  poe(a, !!ligado);
  if (ligado && a.dados && a.dados.ren) poe(eco.acoes.find(x => x.id === a.dados.ren), true);
  if (!ligado && a.tipo === 'net_rename') for (const x of eco.acoes) if (x.dados && x.dados.ren === a.id) poe(x, false);
  return mudou;
}
function contaUsos(eb, net){
  let n = 0;
  for (const k of ['tracks', 'arcs', 'vias', 'fills', 'regions', 'freepads', 'polygons']) for (const o of (eb[k] || [])) if (o && o.net === net) n++;
  return n;
}

/* o designator do componente na placa efetiva, para o comp_add da troca de footprint nao o
   devolver ao lugar padrao: x/y = centro do texto (a convencao do board.js » texts e dos des_*) */
function designatorDe(eb, ref){
  const t = (eb.texts || []).find(x => x && x.designator && x.owner === ref);
  if (!t || !isNum(t.x) || !isNum(t.y)) return null;
  const d = { x:t.x, y:t.y };
  if (isNum(t.h) && t.h > 0) d.h = t.h;
  if (isNum(t.w) && t.w > 0) d.w = t.w;
  if (isNum(t.rot)) d.rot = t.rot;
  if (t.hidden === true) d.hidden = true;
  return d;
}

/* net da placa depois do ECO: a renomeada (net_rename marcada) leva o nome novo */
function netRenomeada(eco, n, vale){
  const r = n ? eco.acoes.find(x => x.tipo === 'net_rename' && x.dados.orig_net === n && vale(x)) : null;
  return r ? r.dados.net : n;
}

/* o que a troca de footprint faz com as nets, com as marcacoes de agora:
   muda = pads cuja net o ECO troca (acoes de pino marcadas e sem erro), fica = diferencas do
   esquema desmarcadas (o pad fica com a net da placa), somem = pads que o footprint novo nao tem */
function resumoTroca(eco, a){
  const d = a.dados || {};
  const pinos = eco.acoes.filter(x => x.tipo === 'pad_net' && x.dados && x.dados.troca === a.id);
  const vai = x => x.ativo && x.status !== 'err';
  const muda = pinos.filter(vai).map(x => ({ pad:x.dados.pad, de:x.dados.orig_net || '', para:x.dados.net || '' }));
  const fica = pinos.filter(x => !vai(x)).map(x => ({ pad:x.dados.pad, net:x.dados.orig_net || '', esquema:x.dados.net || '' }));
  const somem = (d.somem || []).slice();
  const nome = n => n || 'sem net';
  const lista = (L, f) => L.slice(0, 4).map(f).join(', ') + (L.length > 4 ? ', …' : '');
  let t = `${d.orig_footprint || '(sem footprint)'} → ${d.footprint}`;
  if (muda.length) t += ` · ${muda.length} ${muda.length === 1 ? 'pad muda' : 'pads mudam'} de net: ` + lista(muda, m => `${m.pad} ${nome(m.de)}→${nome(m.para)}`);
  if (fica.length) t += ` · ${fica.length} ${fica.length === 1 ? 'fica' : 'ficam'} com a net da placa: ` + lista(fica, m => `${m.pad} ${nome(m.net)}`);
  if (somem.length) t += ` · ${somem.length} ${somem.length === 1 ? 'pad sai' : 'pads saem'} (não existe${somem.length === 1 ? '' : 'm'} no ${d.footprint}): ` + lista(somem, m => m.pad + (m.net ? ` (${m.net})` : ''));
  if (!muda.length && !fica.length && !somem.length) t += ' · nets da placa mantidas';
  return { muda, fica, somem, texto:t, aviso:!!(muda.length || somem.length) };
}

/* as trocas de footprint do ECO, para quem mostra (o MCP) */
function trocasFp(eco){
  return eco.acoes.filter(a => a.tipo === 'comp_fp').map(a => {
    const r = resumoTroca(eco, a);
    return { id:a.id, ref:a.dados.ref, de:a.dados.orig_footprint || '', para:a.dados.footprint, ativo:a.ativo, status:a.status,
             msg:[a.msg, a.msgValida].filter(Boolean).join(' — '), pads_mudam:r.muda, pads_ficam_da_placa:r.fica, pads_saem:r.somem };
  });
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
    if (netRen[n]) return ativa.has(netRen[n].id) ? '' : `depende de "Renomear net ${netRen[n].dados.orig_net} → ${n}", desmarcada — as duas vão juntas (marque a renomeação)`;
    if (netSai[n] && ativa.has(netSai[n].id)) return `a net ${n} também está sendo removida`;
    return existe.has(n) ? '' : `net ${n} não existe na placa`;
  };
  for (const a of eco.acoes) {
    if (a.semPad) { a.status = 'err'; continue; }
    /* a net com cobre não se apaga pelo ECO (1.97.4) */
    if (a.tipo === 'net_del' && a.dados && a.dados.usos) { a.status = 'err'; a.msgValida = 'recusado: a net tem ' + a.dados.usos + ' objeto(s) de cobre'; continue; }
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
      /* na troca as nets sao as da placa: a renomeada marcada ja tem o nome novo */
      const nn = a.tipo === 'comp_fp' ? (n => netRenomeada(eco, n, x => ativa.has(x.id))) : (n => n);
      const dep = [...new Set(Object.values(a.dados.nets || {}).map(nn))].map(netOk).filter(Boolean);
      if (dep.length) ruim('warn', dep[0] + ' — o pad entra sem net');
    } else if (a.tipo === 'pad_net' && a.dados.net) {
      const m = netOk(a.dados.net);
      if (m) ruim('err', m);
    }
    /* o cobre da net antiga ligado ao pad que muda de net (1.97.1): o pad muda, a trilha e a via não — o DRC acusa
       curto. Avisa antes (a ação continua valendo: o cobre se refaz depois, ou se renomeia a net inteira) */
    if (a.tipo === 'pad_net' && a.dados && a.dados.orig_net && a.dados.orig_net !== (a.dados.net || '') && !a.dados.padNovo) {
      const vai = netRenomeada(eco, a.dados.orig_net, x => ativa.has(x.id));
      const c = cobreNoPad(eb, a.dados.ref, a.dados.pad, a.dados.orig_net);
      if (c.n && vai !== (a.dados.net || '')) ruim('warn', `o cobre ligado a este pad (${c.txt} da net ${vai}) continua em ${vai}: o pad vai para ${a.dados.net || '(sem net)'} sozinho e o DRC acusa curto — refaça a ligação depois`);
    }
  }
  /* troca de footprint: o pad que so o footprint novo tem depende da troca; e a mensagem da
     troca diz, com as marcacoes de agora, quantos pads mudam de net e quais saem */
  const troca = Object.create(null);
  for (const a of eco.acoes) if (a.tipo === 'comp_fp') troca[a.id] = a;
  for (const a of eco.acoes) {
    if (a.tipo !== 'pad_net' || !a.dados || !a.dados.troca || !a.dados.padNovo || a.status === 'err') continue;
    const t = troca[a.dados.troca];
    if (!t || !ativa.has(t.id)) { a.status = 'err'; a.msgValida = `o pad ${a.dados.pad} só existe no ${t ? t.dados.footprint : 'footprint novo'} — depende de "Trocar footprint ${a.dados.ref}", desmarcada`; }
    else if (t.status === 'err') { a.status = 'err'; a.msgValida = `o pad ${a.dados.pad} só existe no ${t.dados.footprint} — a troca de footprint tem erro`; }
  }
  for (const a of Object.values(troca)) {
    const r = resumoTroca(eco, a);
    a.msg = r.texto;
    if (r.aviso && a.status === 'ok') a.status = 'warn';
  }
  const conta = s => eco.acoes.filter(a => a.ativo && a.status === s).length;
  eco.resumo = { total:eco.acoes.length, ativas:ativa.size, ok:conta('ok'), avisos:conta('warn'), erros:conta('err') };
  return eco;
}

/* Execute Changes: as acoes marcadas e sem erro -> linhas do changes.js, na ordem dos grupos.
   Componente novo estaciona a DIREITA da placa, em colunas (uma por folha, como a Room do
   Altium), de cima para baixo, e sem cair em cima de quem ja estacionou num ECO anterior. A troca
   de footprint fica no mesmo lugar (comp_del + comp_add com x/y/rot/layer e o designator de antes),
   com as nets da placa e as acoes de pino dela que vao dobradas nas nets do comp_add. */
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
  /* troca de footprint: as nets da placa (com o nome novo da renomeada que vai), e por cima as
     acoes de pino da troca que vao -- dobradas no comp_add, em vez de pad_net depois dele */
  const vaiId = new Set(vai.map(x => x.id));
  const netsTroca = a => {
    const m = {};
    for (const k of Object.keys(a.dados.nets || {})) m[k] = netRenomeada(eco, a.dados.nets[k], x => vaiId.has(x.id));
    for (const x of vai) if (x.tipo === 'pad_net' && x.dados.troca === a.id) {
      if (x.dados.net) m[x.dados.pad] = x.dados.net; else delete m[x.dados.pad];
    }
    return HC.netsCampo(m);
  };
  for (const a of ord) {
    const d = a.dados;
    switch (a.tipo) {
      case 'net_rename':
        /* a net vazia de mesmo nome sai antes (senão o net_rename recusa: "já existe") */
        if (d.apagaVazia) linhas.push({ op:'net_del', net:d.net, note:'ECO: Remove Nets ' + d.net + ' (vazia; a ' + d.orig_net + ' leva o nome)' });
        linhas.push({ op:'net_rename', net:d.net, orig_net:d.orig_net, note:nota(a) });
        break;
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
        const n = netsTroca(a); if (n) l.nets = n;
        /* o designator fica onde estava, do tamanho e no giro que tinha (e oculto, se era) */
        const t = d.des;
        if (t) {
          l.des_x = t.x; l.des_y = t.y;
          if (isNum(t.h)) l.des_h = t.h;
          if (isNum(t.w)) l.des_w = t.w;
          if (isNum(t.rot)) l.des_rot = t.rot;
          if (t.hidden === true) l.des_hidden = true;
        }
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
        /* pino da troca de footprint que vai: ja esta nas nets do comp_add; sem a troca, o
           pad_net vale no componente de hoje (o pad que so o novo tem nao chega aqui: erro) */
        if (d.troca && vaiId.has(d.troca)) break;
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

return { GRUPOS, compara, valida, aplica, relatorio, mesmoFootprint, compsDoEsquema, resumoTroca, trocasFp , junta, cobreNoPad };
});
