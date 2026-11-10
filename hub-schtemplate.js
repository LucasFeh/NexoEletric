/* AltiumPCBMirror v2 - hub-schtemplate.js — o TEMPLATE DE FOLHA do Altium (o .SchDot).

   É o "Design » Templates" e o "Document Options" do Altium: tamanho da folha, moldura com
   zonas de referência, carimbo (title block) com textos e "special strings" (`=Title`,
   `=DocumentNumber`, `=SheetNumber`…), logo. Motor PURO: não sabe de DOM nem da vista — a
   vista Esquema chama `desenha(ctx, ...)` no mundo dela (mil, Y para cima), e quem preferir
   pede as `primitivas(...)` e desenha do seu jeito (o teste faz isso).

   DE ONDE VEM CADA COISA
     Libs/sch-templates.js        `schtemplates`: os .SchDot do Altium e o carimbo da casa,
                                  extraídos pelo tools/schtemplate/schtemplate.py
     Libs/sch-templates-casa.js   `schtemplatesCasa`: os templates CRIADOS no hub (editor do
                                  hub-schtemplate-ui.js). Ausente = nenhum.
     "altium:Standard"/"altium:ANSI"  os carimbos que o Altium desenha SEM arquivo (Document
                                  Options › Title Block). Não há registro para extrair: o
                                  desenho saiu do Altium.Sch.Painter.dll do AD21 (reflexão nas
                                  constantes do SchematicConstants e no IL do DrawTitleBlock /
                                  DrawAnsiTitleBlock / DrawReferenceZones), e vai em CARIMBOS.

   ONDE O TEMPLATE DE UMA FOLHA FICA GUARDADO (schematic.js, schmirror-v2) — acréscimo puro:
     item `sheet`    "template":"casa:A4_DiEletrons"   o id do template; AUSENTE = folha sem
                                                       template, desenhada como sempre
                     "params":"Title=Fonte;Revision=B" os parâmetros DO DOCUMENTO (Altium:
                                                       Document Options › Parameters)
     cabeçalho       "params":"CompanyName=DIEletrons" os parâmetros DO PROJETO (o .PrjPcb)
   Campo plano `Chave=Valor;Chave=Valor` — o mesmo do `params` do comp — porque o
   BuildSchematic lê linha a linha e não aguenta objeto aninhado. Tamanho e orientação
   continuam sendo `size` + `w`/`h` (retrato = h > w), como já são. Quem não conhece os campos
   (o BuildSchematic de hoje, espelho antigo) os ignora: a folha só não ganha carimbo. */
(function (root) {
"use strict";

/* SheetStyle do Altium -> [nome, w, h, zonas X, zonas Y, margem] em mil. Medido no
   ArkGlobalSettings..ctor (Altium.Sch.Base.dll): A3 é 15500x11100 com 8 zonas, todas as Y = 4. */
const ESTILOS = [
  ['A4', 11500, 7600, 4, 4, 200], ['A3', 15500, 11100, 8, 4, 200], ['A2', 22300, 15700, 8, 4, 300],
  ['A1', 31500, 22300, 12, 4, 300], ['A0', 44600, 31500, 16, 4, 400], ['A', 9500, 7500, 4, 4, 200],
  ['B', 15000, 9500, 6, 4, 200], ['C', 20000, 15000, 6, 4, 300], ['D', 32000, 20000, 8, 4, 300],
  ['E', 42000, 32000, 16, 4, 400], ['Letter', 11000, 8500, 4, 4, 200], ['Legal', 14000, 8500, 4, 4, 200],
  ['Tabloid', 17000, 11000, 6, 4, 200], ['OrCAD A', 9900, 7900, 4, 4, 200], ['OrCAD B', 15400, 9900, 6, 4, 200],
  ['OrCAD C', 20600, 15600, 6, 4, 300], ['OrCAD D', 32600, 20600, 8, 4, 300], ['OrCAD E', 42800, 32800, 16, 4, 400]];

/* Os dois carimbos "sem arquivo", em mil, a partir do canto inferior-direito (x, y) do
   carimbo — que é (largura − margem, margem) com zonas ligadas e (largura, 0) sem elas
   (DrawWorkSpace -> DrawTitleBlockObject). Texto ancorado no canto SUPERIOR-esquerdo, na
   fonte do sistema da folha. `dx` conta para a esquerda a partir de x. */
const CARIMBOS = {
  standard: {
    linhas: [[3500, 800, 0, 800], [3500, 500, 0, 500], [3500, 200, 0, 200], [3500, 100, 0, 100],
             [3500, 800, 3500, 0], [1000, 500, 1000, 200], [3000, 500, 3000, 200], [1500, 200, 1500, 0]],
    textos: [['Title', 3450, 800], ['Number', 2950, 500], ['Revision', 950, 500], ['Size', 3450, 500],
             ['=$Estilo', 3400, 350], ['Date:', 3450, 200], ['=CurrentDate', 3000, 200],
             ['Sheet    of', 1450, 200], ['File:', 3450, 100], ['=DocumentFullPathAndName', 3000, 100],
             ['Drawn By:', 1450, 100]] },
  ansi: {
    linhas: [[0, 1750, 6250, 1750], [6250, 0, 6250, 1750], [4250, 0, 4250, 1750], [0, 1250, 4250, 1250],
             [0, 630, 4250, 630], [0, 250, 4250, 250], [3870, 250, 3870, 630], [3250, 0, 3250, 250],
             [1750, 0, 1750, 250], [2760, 250, 2760, 630], [360, 250, 360, 630]],
    textos: [['Scale', 4200, 250], ['Sheet', 1700, 250], ['Size', 4200, 630], ['FCSM No.', 3820, 630],
             ['DWG No.', 2710, 630], ['Rev', 310, 630], ['=$Estilo', 4200, 500]] } };

/* Apelidos: o mesmo dado com o nome do Altium e com o nome da casa. Pedir um acha o outro —
   o carimbo da DIEletrons diz `=Desenhista_DiEletrons`, e quem preenche "DrawnBy" (a IA, o
   painel) vê o nome aparecer nele. Comparação sem caixa: o Altium aceita `=sheetnumber`. */
const APELIDOS = [
  ['DrawnBy', 'Desenhista_DiEletrons', 'Author', 'Desenhista'],
  ['CheckedBy', 'Verificador_DiEletrons', 'Verificador'],
  ['ApprovedBy', 'Aprovador_DiEletrons', 'Aprovador'],
  ['Revision', 'Revisao', 'ItemRevision'],
  ['DocumentNumber', 'Arquivo', 'DOC_NO_SCH_DWG'],
  ['Title', 'Equipamento_linha_um', 'Equipamento'],
  ['Date', 'Data_desenho'],
  ['CompanyName', 'Organization', 'Empresa'],
  ['ProjectName', 'Project'],
];
const APELIDO = {};
for (const g of APELIDOS) for (const n of g) APELIDO[n.toLowerCase()] = g;

/* O CARIMBO QUE SE PREENCHE SOZINHO (pedido do dono, 2026-11-05: "o formato é automático, baseado no formato da folha,
   escala também; arquivo é o nome da folha; código da placa, código e nome do equipamento vêm do Definir projeto; as
   datas são automáticas; o carimbo é a assinatura de cada pessoa").
   AUTOMATICOS  o sistema responde, e o que a folha ou o projeto tenham gravado não conta (Formato, Escala, Arquivo e
                o número da folha: a folha é quem sabe).
   DO_PROJETO   só o cabeçalho do schematic.js responde, pelo nome exato, sem o padrão do template: as pessoas e as
                datas (dos carimbos: quem criou/assumiu e quem aprovou), a revisão (do Aprovar) e os códigos (do Definir
                projeto). A folha não sobrescreve, e "NOME_APROVADOR" do template não aparece num projeto sem aprovação.
   ANTIGOS      os nomes de antes (o template da casa até a 1.74.0), lidos como os novos nos projetos que os têm. */
const AUTOMATICOS = ['Formato', 'Escala', 'Arquivo', 'SheetNumber', 'SheetTotal'];
const DO_PROJETO = ['Desenhista_DiEletrons', 'Verificador_DiEletrons', 'Aprovador_DiEletrons', 'Data_desenho', 'Data_verificacao',
                    'Data_aprovacao', 'Revisao', 'CodigoDaPlaca', 'CodigoDoEquipamento', 'NomeDoEquipamento'];
const ANTIGOS = { codigodaplaca: ['Desenho_linha_unica'], codigodoequipamento: ['Equipamento_linha_dois'],
                  nomedoequipamento: ['Equipamento_linha_um'] };
const NOMES_ANTIGOS = ['Desenho_linha_unica', 'Desenho_linha_um', 'Desenho_linha_dois', 'Equipamento_linha_um',
                       'Equipamento_linha_dois', 'Equipamento_linha_unica'];
const _auto = new Set(AUTOMATICOS.map(n => n.toLowerCase()));
const _proj = new Set(DO_PROJETO.map(n => n.toLowerCase()));
/* "PROJETO NÃO DEFINIDO" (1.86.0, pedido do dono, 2026-11-09: "se o projeto não tiver definido, deixa 'projeto não
   definido' nos campos de código de equipamento e código de placa, clica em 'definir projeto' pra definir um").
   O código da placa e o do equipamento que ninguém deu (nem o Definir projeto, nem o Altium com os nomes de antes, nem
   — para a placa — o código que o nome do projeto traz) aparecem com este texto no lugar do vazio, na caixa do template.
   Ele NUNCA é gravado: sai só do desenho (resolve), e um cabeçalho que o traga como valor conta como vazio. Na tela a
   vista Esquema o destaca (vermelho, tracejado em volta) e o clique nele abre o Definir projeto (schframe.js »
   campoNaoDefinido); no PDF do esquema ele sai como o resto do quadro, na cor do template: o projeto está indefinido, e
   a folha impressa tem de dizer isso em vez de fingir um campo em branco. O Gerber/PDF da PCB não passam por aqui (a
   logo da placa usa .CodigoDaPlaca, hub-core.js » resolveEspeciais, que fica como sempre). `naoDefinido:false` no
   contexto desliga (o campo volta a sair vazio/"=Nome"). */
const NAO_DEFINIDO = 'PROJETO NÃO DEFINIDO';
const CAMPOS_DEFINIR = ['CodigoDaPlaca', 'CodigoDoEquipamento'];
const _definir = new Set(CAMPOS_DEFINIR.map(n => n.toLowerCase()));
const ehNaoDefinido = v => String(v == null ? '' : v).trim().toUpperCase() === NAO_DEFINIDO;
/* 1.88.0 (pedido do dono, 2026-11-09: "onde antes ia 'equipamento' no template agora só vai o código do equipamento"): o
   NomeDoEquipamento sai do quadro (continua no cabeçalho, só não aparece). A linha que ele ocupava mostra a VARIANTE de
   projeto ativa ("VARIANTE <nome> · <código>", hub-variantes.js), que é onde ela cabe no quadro da casa; sem variante, vazia.
   setVariante(v) vale para os contextos seguintes (a vista e o PDF do esquema); contexto({variante}) troca.
   1.89.0 (a variante é um equipamento, hub-variantes.js): com a variante ativa, o campo do EQUIPAMENTO (CodigoDoEquipamento)
   mostra o código do equipamento DA VARIANTE no lugar do do projeto; a linha "VARIANTE …" saiu (ficava redundante: a
   barra da vista diz o nome da variante) e o NomeDoEquipamento volta a sair vazio. A PLACA continua o código da PCB. */
const CAMPO_DA_VARIANTE = 'nomedoequipamento';
let VARIANTE = null;
function setVariante(v){ VARIANTE = v && (v.nome || v.codigo) ? { nome: String(v.nome || ''), codigo: String(v.codigo || '') } : null; }
function textoVariante(v){ return v ? ('VARIANTE ' + (v.nome || '') + (v.codigo ? ' · ' + v.codigo : '')).replace(/\s+/g, ' ').trim() : ''; }
/* o campo se preenche sozinho (não vai na tabela de campos do carimbo)? */
function automatico(nome){
  const n = String(nome || '').toLowerCase();
  return _auto.has(n) || _proj.has(n) || NOMES_ANTIGOS.some(x => x.toLowerCase() === n)
    || /^(revision|date|drawnby|checkedby|approvedby|title|documentnumber)$/i.test(n)
    || /^Aprovacao_|^Desenhista_|^Verificador_|^Aprovador_/i.test(nome);
}

/* os campos que o painel oferece para preencher, nesta ordem (os do Altium e os da casa) */
const CAMPOS_PADRAO = ['Title', 'DocumentNumber', 'Revision', 'DrawnBy', 'CheckedBy', 'ApprovedBy',
                       'Date', 'CompanyName', 'SheetNumber', 'SheetTotal'];

/* ─── params: o campo plano `Chave=Valor;Chave=Valor` ─── */
const limpaChave = k => String(k == null ? '' : k).replace(/[;=|"]/g, '').trim();
/* `;` separa pares e `|` corta o registro do Altium; `":` derruba a gravação do schematic.js */
const limpaValor = v => String(v == null ? '' : v).replace(/[;|]/g, ',').replace(/":/g, '" :');
function parseParams(s){
  const o = {};
  if (!s) return o;
  if (typeof s === 'object') { for (const k of Object.keys(s)) o[k] = String(s[k]); return o; }
  for (const par of String(s).split(';')){
    const i = par.indexOf('=');
    if (i <= 0) continue;
    const k = par.slice(0, i).trim();
    if (k) o[k] = par.slice(i + 1);
  }
  return o;
}
function serializaParams(o){
  return Object.keys(o || {}).map(k => [limpaChave(k), o[k]]).filter(p => p[0])
    .map(p => p[0] + '=' + limpaValor(p[1])).join(';');
}

/* ─── acervo ─── */
function globais(){
  const g = typeof self !== 'undefined' ? self : (typeof global !== 'undefined' ? global : {});
  return [g.schtemplates, g.schtemplatesCasa];
}
/* Todos os templates conhecidos: {id: tpl}, com as imagens da tabela comum já resolvidas
   (`img` -> `src`). `fontes` = lista de objetos no formato do Libs (para o teste injetar). */
function acervo(fontes){
  const fora = {};
  const removidos = new Set();
  for (const f of (fontes || globais())){
    if (!f || !f.templates) continue;
    const imgs = f.imagens || {};
    for (const id of Object.keys(f.templates)){
      const t = f.templates[id];
      for (const it of (t.itens || []))
        if (it.g === 'image' && !it.src && it.img && imgs[it.img]) it.src = imgs[it.img];
      fora[id] = t;
    }
    for (const id of (Array.isArray(f.removidos) ? f.removidos : [])) removidos.add(String(id));
  }
  /* os padrões da casa que nascem de outro (o A3 do A4): o arquivo da casa de uma máquina, ou o do NexoBD, pode ser de
     antes deles — eles aparecem mesmo assim, iguais ao que o Libs/sch-templates-casa.js do instalador traz. Quem os
     removeu (Remover template…) fica sem: o id vai para a lista `removidos` do arquivo da casa. */
  for (const [id, de, gera] of PADROES)
    if (!fora[id] && fora[de] && !removidos.has(id)) fora[id] = derivado(id, fora[de], gera);
  return fora;
}

/* ─── os padrões derivados (1.93.0) ───
   Pedido do dono (2026-11-10): "quero que esse template de nome padrão da dieletrons exista dentro da folha pra ser
   adicionado, igual é no A4" — o A3_DiEletrons é o A4_DiEletrons numa folha A3 ISO (420×297 mm): o MESMO quadro, no
   mesmo tamanho físico e com as mesmas fontes (como em folha técnica: o carimbo não cresce com a folha), encostado no
   canto inferior direito, e a régua da borda com as zonas da A3 (ISO 5457: 8 × 6, cada uma ~50 mm, como as 6 × 4 da
   A4). O nome é o do .SchDot do Altium (A3_DiEletrons.SchDot), para o schdoc2sch casar a folha importada com ele. */
const A3_ISO = [16535.433, 11692.913];
function emOutraFolha(base, id, nome, w, h, zonasX, zonasY, formato){
  const t = JSON.parse(JSON.stringify(base));
  const f0 = base.folha || {};
  const dx = w - (f0.w || w), dy = 0;      /* o quadro fica no canto inferior direito: só anda para a direita */
  t.id = id; t.nome = nome; t.origem = 'casa'; t.arquivo = nome + '.SchDot';
  t.folha = Object.assign({}, f0, { w, h, zonasX, zonasY, estilo: formato });
  t.params = Object.assign({}, base.params || {}, { Formato: formato });
  for (const it of (t.itens || [])) moveItem(it, dx, dy);
  return t;
}
const a3DiEletrons = a4 => emOutraFolha(a4, 'casa:A3_DiEletrons', 'A3_DiEletrons', A3_ISO[0], A3_ISO[1], 8, 6, 'A3');
const PADROES = [['casa:A3_DiEletrons', 'casa:A4_DiEletrons', a3DiEletrons]];
/* cache por objeto de origem: o acervo() roda a cada desenho, e copiar o logo (38 kB) a cada quadro não compensa */
const _derivados = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
function derivado(id, base, gera){
  let m = _derivados && _derivados.get(base);
  if (!m){ m = {}; if (_derivados) _derivados.set(base, m); }
  return m[id] || (m[id] = gera(base));
}

/* ─── o rótulo do template no seletor da folha (1.93.0) ───
   "o template fica no lugar [da folha], e todo template novo vai ser a folha 'A3 + (nome do template)'": cada template
   é uma opção do seletor de folha, "<tamanho> + <nome>". O tamanho sai da MEDIDA do template (`match` = o
   HubCore.sheetMatch; sem ele, ou medida de formato nenhum, os números), e o nome perde o prefixo do tamanho que a casa
   costuma pôr ("A4_DiEletrons" → "DiEletrons"). O sem arquivo (Standard/ANSI) acompanha a folha: só o nome. */
function tamanhoDe(tpl, match){
  const f = (tpl && tpl.folha) || {};
  if (!(f.w > 0 && f.h > 0)) return '';
  const m = match ? match({ w:f.w, h:f.h }) : null;
  if (m) return m.name + (m.retrato ? ' em pé' : '') + (m.fam === 'legado' ? ' legado' : '');
  return Math.round(f.w) + '×' + Math.round(f.h);
}
function nomeCurto(tpl, tamanho){
  const nome = String((tpl && tpl.nome) || (tpl && tpl.id) || '').trim();
  const base = String(tamanho || '').split(' ')[0];
  if (!base) return nome;
  const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sem = nome.replace(new RegExp('^' + esc + '(?:[\\s_\\-+·]+|$)', 'i'), '').trim();
  return sem || nome;
}
function rotulo(tpl, match){
  if (!tpl) return '';
  if (tpl.interno) return String(tpl.nome || tpl.id) + ' (na folha atual)';
  const tam = tamanhoDe(tpl, match);
  return tam ? tam + ' + ' + nomeCurto(tpl, tam) : String(tpl.nome || tpl.id);
}
/* As opções do seletor da folha (o menu do canto do Esquema), num lugar que se testa sem DOM:
     {grupos:[{rotulo, opcoes:[{v, t}]}], extra:{v, t}|null, valor}
   `v` é o id do formato ('iso:A3', a folha sem template) ou 'tpl:<id do template>' (o template, com a folha dele).
   SÓ A FOLHA DE VERDADE (pedido do dono, 2026-11-10: "só 'folha de verdade', Altium legado pode ir embora"): os
   formatos são os ISO do HubCore; o legado do Altium não se escolhe mais. A folha que JÁ ESTÁ num tamanho legado (ou
   custom, ou nunca medida) não quebra: o `extra` mostra o tamanho dela ("A4 legado (atual) · 11500×7600") e só existe
   enquanto ela o usar — trocar oferece só os de verdade.
     o.presets    HubCore.SHEET_PRESETS      o.templates  lista()      o.match  HubCore.sheetMatch
     o.item       a folha ({template, w, h}) o.medida     [w, h] (HubCore.sheetSize)
     o.medido     a folha tem w/h de verdade (sem eles a medida é o palpite da tabela legado) */
function opcoesFolha(o){
  o = o || {};
  const match = o.match || null;
  const area = s => s[0] * s[1];
  const reais = (o.presets || []).filter(p => p.fam === 'iso').slice().sort((a, b) => area(a.size) - area(b.size));
  const g1 = { rotulo:'Folha', opcoes: reais.map(p => ({ v:p.id, t:p.name })) };
  const med = t => (t.folha && t.folha.w > 0 && t.folha.h > 0) ? area([t.folha.w, t.folha.h]) : Infinity;
  const tpls = (o.templates || []).slice()
    .sort((a, b) => (med(a) - med(b)) || rotulo(a, match).localeCompare(rotulo(b, match)));
  const g2 = { rotulo:'Folha + template', opcoes: tpls.map(t => ({ v:'tpl:' + t.id, t:rotulo(t, match) })) };
  const it = o.item || {};
  let valor = '', extra = null;
  if (it.template){
    valor = 'tpl:' + it.template;
    /* template que este acervo não tem (outro computador, arquivo da casa não carregado): o nome fica à vista */
    if (!tpls.some(t => t.id === it.template)) g2.opcoes.push({ v:valor, t:it.template + ' (não encontrado)' });
  } else {
    const m = o.medido && match ? match({ w:(o.medida || [])[0], h:(o.medida || [])[1] }) : null;
    if (m && m.fam === 'iso') valor = m.id;
    else {
      const w = Math.round((o.medida || [0])[0]), h = Math.round((o.medida || [0, 0])[1]);
      extra = { v:'', t: !o.medido ? '— não medida: rode o ExportProject —'
        : (m ? m.name + (m.retrato ? ' em pé' : '') + ' legado (atual)' : 'Personalizada (atual)') + ' · ' + w + '×' + h };
    }
  }
  return { grupos:[g1, g2], extra, valor };
}
function lista(fontes){
  const a = acervo(fontes);
  const ordem = { casa:0, altium:1, 'altium-legado':2 };
  return Object.keys(a).map(id => a[id])
    .sort((p, q) => ((ordem[p.origem] ?? 9) - (ordem[q.origem] ?? 9)) || String(p.nome).localeCompare(String(q.nome)));
}
function acha(id, fontes){ return id ? (acervo(fontes)[id] || null) : null; }

/* ─── special strings ─── */
const dois = n => String(n).padStart(2, '0');
function hoje(d){ return dois(d.getDate()) + '/' + dois(d.getMonth() + 1) + '/' + d.getFullYear(); }
function agora(d){ return dois(d.getHours()) + ':' + dois(d.getMinutes()) + ':' + dois(d.getSeconds()); }

/* procura `nome` (sem caixa) num objeto de parâmetros; devolve undefined se não houver */
function pega(o, nome){
  if (!o) return undefined;
  const n = nome.toLowerCase();
  for (const k of Object.keys(o)) if (k.toLowerCase() === n) return o[k];
  return undefined;
}
/* O contexto de resolução, montado uma vez por desenho:
     doc     parâmetros da folha (item sheet `params`)        — ganham de tudo
     proj    parâmetros do projeto (cabeçalho `params`)
     auto    o que o sistema sabe: folha n de N, data, nomes
     tpl     os valores padrão gravados no próprio template   — só se nada acima respondeu */
/* o código de produto que o nome do projeto traz (o costume da casa: "PDCD-DI261939 (PTYPE)", "PAEL - DI261940"):
   {codigo:'PDCD-DI261939', numero:'DI261939'} ou null */
function codigoDoProjeto(nome){
  const m = /([A-Za-z][A-Za-z0-9]*)\s*-\s*(DI\d{5,})/.exec(String(nome || ''));
  return m ? { codigo: m[1].toUpperCase() + '-' + m[2].toUpperCase(), numero: m[2].toUpperCase() } : null;
}
function contexto(o){
  o = o || {};
  const d = o.agora instanceof Date ? o.agora : new Date();
  const auto = {
    SheetNumber: o.folhaN != null ? String(o.folhaN) : '1',
    SheetTotal: o.folhaTotal != null ? String(o.folhaTotal) : '1',
    CurrentDate: hoje(d), CurrentTime: agora(d), Date: hoje(d), Time: agora(d),
    DocumentName: o.documento || '', DocumentFullPathAndName: o.caminho || o.documento || '',
    ProjectName: o.projeto || '', ModifiedDate: hoje(d),
  };
  /* o carimbo da casa se preenche sozinho (2026-11-04/05): o formato e a escala da folha, o nome da folha no Arquivo e,
     enquanto o Definir projeto não disser, o código da placa que o nome do projeto traz */
  if (o.formato) auto.Formato = String(o.formato);
  auto.Escala = o.escala ? String(o.escala) : '1:1';
  if (o.folhaNome) auto.Arquivo = String(o.folhaNome);
  const cod = codigoDoProjeto(o.projeto);
  if (cod){ auto.CodigoDaPlaca = cod.codigo; if (!o.folhaNome) auto.Arquivo = 'SCH-' + cod.numero; }
  return { doc: parseParams(o.doc), proj: parseParams(o.proj), auto, tpl: (o.tpl && o.tpl.params) || {},
           estilo: o.estilo || '', faltante: o.faltante, naoDefinido: o.naoDefinido !== false,
           variante: o.variante !== undefined ? o.variante : VARIANTE,
           /* cru: o editor de template mostra "=Title" como está, para se ver o que é campo */
           cru: !!o.cru };
}
/* valor de um parâmetro pelo nome, ou undefined: cada camada é consultada pelo nome e pelos
   apelidos dele antes de cair para a camada seguinte */
function valor(nome, c){
  const k = nome.toLowerCase();
  if (k === CAMPO_DA_VARIANTE && !c.cru) return '';
  if (k === 'codigodoequipamento' && !c.cru && c.variante && c.variante.codigo) return c.variante.codigo;
  if (_auto.has(k) && !c.cru){
    const v = pega(c.auto, nome);
    if (v !== undefined) return String(v);
  }
  if (_proj.has(k) && !c.cru){
    for (const n of [nome].concat(ANTIGOS[k] || [])){
      const v = pega(c.proj, n);
      if (v !== undefined && v !== '' && v !== '*' && !ehNaoDefinido(v)) return String(v);
    }
    const v = pega(c.auto, nome);
    if (v !== undefined) return String(v);
    /* o código que ninguém deu: "PROJETO NÃO DEFINIDO" (ver NAO_DEFINIDO) */
    if (_definir.has(k) && c.naoDefinido) return NAO_DEFINIDO;
    return undefined;
  }
  const nomes = APELIDO[nome.toLowerCase()] ? [nome].concat(APELIDO[nome.toLowerCase()]) : [nome];
  for (const camada of [c.doc, c.proj, c.auto, c.tpl])
    /* o que o SISTEMA sabe responde só pelo nome exato: "Data_desenho" é apelido de "Date"
       para quem preenche, mas não pode virar a data de hoje por conta própria */
    for (const n of (camada === c.auto ? [nome] : nomes)){
      const v = pega(camada, n);
      if (v !== undefined && v !== '*' && !(camada === c.tpl && String(v).startsWith('='))) return String(v);
    }
  return undefined;
}
/* O texto INTEIRO é a special string ("=Title"), como no Altium: "Rev =Revision" não é. O que
   não resolve aparece como o Altium mostra — o próprio "=Nome" — a não ser que o contexto peça
   outra coisa (`faltante: ''` esconde). */
function resolve(s, c){
  if (typeof s !== 'string' || s.charAt(0) !== '=' || s.length < 2 || c.cru) return s;
  const nome = s.slice(1).trim();
  if (nome === '$Estilo') return c.estilo || '';
  const v = valor(nome, c);
  if (v !== undefined) return v;
  return c.faltante !== undefined ? c.faltante : s;
}
/* os nomes de parâmetro que um template usa (o painel oferece estes para preencher) */
function campos(tpl){
  const vistos = new Map();
  const add = n => { const k = n.toLowerCase(); if (!vistos.has(k)) vistos.set(k, n); };
  for (const it of ((tpl && tpl.itens) || []))
    if ((it.g === 'text' || it.g === 'frame') && typeof it.s === 'string' && /^=[^=\s]/.test(it.s)) add(it.s.slice(1).trim());
  const f = tpl && tpl.folha;
  if (f && f.carimbo && f.estiloCarimbo !== 'ansi') add('DocumentFullPathAndName');
  for (const k of Object.keys((tpl && tpl.params) || {})) add(k);
  const sistema = /^(CurrentDate|CurrentTime|Time|DocumentFullPathAndName|DocumentName|ModifiedDate|ProjectName|Application_BuildNumber|ImagePath|Rule|VersionControl_.*)$/i;
  return Array.from(vistos.values()).filter(n => !sistema.test(n));
}

/* ─── a folha que o template pede ─── */
/* w/h e o resto do "Document Options". Template sem arquivo (Standard/ANSI) acompanha a folha
   que já existe: ele é só carimbo e zonas, e o estilo sai da medida (o mais próximo). */
function folhaDe(tpl, medida){
  const f = Object.assign({}, (tpl && tpl.folha) || {});
  if (tpl && tpl.interno && medida && medida[0] > 0 && medida[1] > 0){
    f.w = medida[0]; f.h = medida[1];
    const e = estiloPorMedida(f.w, f.h);
    if (e){ f.estilo = e[0]; f.zonasX = e[3]; f.zonasY = e[4]; f.margem = e[5]; }
  }
  return f;
}
/* o estilo do Altium com a medida mais próxima (nas duas orientações) — dá o número de zonas
   e a margem a uma folha que só tem w/h */
function estiloPorMedida(w, h){
  let melhor = null, d0 = Infinity;
  for (const e of ESTILOS){
    for (const [a, b, rot] of [[e[1], e[2], false], [e[2], e[1], true]]){
      const d = Math.abs(a - w) + Math.abs(b - h);
      if (d < d0){ d0 = d; melhor = rot ? [e[0], e[2], e[1], e[4], e[3], e[5]] : e; }
    }
  }
  return melhor;
}

/* ─── primitivas ───
   Tudo em mil, Y para cima, no formato:
     {g:'line', x1,y1,x2,y2, w, color}
     {g:'rect', x1,y1,x2,y2, w, color, fill}            (fill ausente = vazado)
     {g:'polyline', pts, w, color, fechado, fill}
     {g:'arc', cx,cy,r, sa,ea, w, color}   {g:'ellipse', cx,cy,rx,ry, w, color, fill}
     {g:'text', x,y, s, fonte, tam, negrito, italico, h:'left|center|right',
                v:'bottom|middle|top', rot, color, origem}
     {g:'image', x1,y1,x2,y2, src, aspecto}
   `origem` no texto é o texto cru do template ("=Title"): o editor usa para saber o que é campo. */
const JUST_H = ['left', 'center', 'right'], JUST_V = ['bottom', 'middle', 'top'];
function fonteDe(tpl, id){
  const f = (tpl && tpl.fontes && (tpl.fontes[id] || tpl.fontes[String(id)])) || {};
  return { fonte: f.nome || 'Times New Roman', tam: (f.tam || 10) * 10, negrito: !!f.negrito, italico: !!f.italico };
}
function moldura(f, out){
  const w = f.w, h = f.h, cor = f.cor || '#000000';
  const zonas = f.zonas !== false && f.zonasX > 0 && f.zonasY > 0;
  const m = zonas ? (f.margem || 0) : 0;
  if (f.borda){
    out.push({ g:'rect', x1:0, y1:0, x2:w, y2:h, w:4, color:cor });
    if (m > 0) out.push({ g:'rect', x1:m, y1:m, x2:w - m, y2:h - m, w:4, color:cor });
  }
  if (!zonas || m <= 0) return;
  const ft = { fonte:'Times New Roman', tam:100, negrito:false, italico:false };
  const asme = f.estiloZona === 1;
  const lx = w / f.zonasX, ly = h / f.zonasY;
  for (let i = 1; i <= f.zonasX; i++){
    const x = asme ? w - i * lx : i * lx;
    if (i < f.zonasX){
      out.push({ g:'line', x1:x, y1:h, x2:x, y2:h - m, w:4, color:cor });
      out.push({ g:'line', x1:x, y1:0, x2:x, y2:m, w:4, color:cor });
    }
    const cx = asme ? x + lx / 2 : x - lx / 2;
    for (const cy of [h - m / 2, m / 2])
      out.push(Object.assign({ g:'text', x:cx, y:cy, s:String(i), h:'center', v:'middle', rot:0, color:cor }, ft));
  }
  for (let i = 1; i <= f.zonasY; i++){
    const y = asme ? h - i * ly : i * ly;
    if (i < f.zonasY){
      out.push({ g:'line', x1:0, y1:y, x2:m, y2:y, w:4, color:cor });
      out.push({ g:'line', x1:w, y1:y, x2:w - m, y2:y, w:4, color:cor });
    }
    /* A..: no padrão a zona A é a de CIMA (o preview da folha da casa: A em cima, D embaixo) */
    const letra = String.fromCharCode(65 + (asme ? i - 1 : f.zonasY - i));
    const cy = asme ? y + ly / 2 : y - ly / 2;
    for (const cx of [m / 2, w - m / 2])
      out.push(Object.assign({ g:'text', x:cx, y:cy, s:letra, h:'center', v:'middle', rot:0, color:cor }, ft));
  }
}
function carimboInterno(f, tpl, c, out){
  const desenho = CARIMBOS[f.estiloCarimbo === 'ansi' ? 'ansi' : 'standard'];
  const zonas = f.zonas !== false && f.zonasX > 0 && f.zonasY > 0;
  const x = zonas ? f.w - (f.margem || 0) : f.w, y = zonas ? (f.margem || 0) : 0;
  const cor = f.cor || '#000000';
  for (const [a, b, p, q] of desenho.linhas) out.push({ g:'line', x1:x - a, y1:y + b, x2:x - p, y2:y + q, w:4, color:cor });
  const ft = fonteDe(tpl, f.fonteSistema || 1);
  for (const [s, dx, dy] of desenho.textos)
    out.push(Object.assign({ g:'text', x:x - dx, y:y + dy, s:resolve(s, c), origem:s, h:'left', v:'top', rot:0,
                             color:'#000000' }, ft));
}
/* o campo (=CodigoDaPlaca, =CodigoDoEquipamento) que o desenho deixou em "PROJETO NÃO DEFINIDO", ou '' */
function campoNaoDefinido(origem, s){
  if (typeof origem !== 'string' || origem.charAt(0) !== '=' || s !== NAO_DEFINIDO) return '';
  const n = origem.slice(1).trim();
  return _definir.has(n.toLowerCase()) ? n : '';
}
function texto(it, tpl, c){
  const j = it.just | 0;
  let hz = j % 3;
  if (it.espelho) hz = 2 - hz;
  const p = Object.assign({ g:'text', x:it.x, y:it.y, s:resolve(it.s, c), origem:it.s,
                            h:JUST_H[hz], v:JUST_V[Math.floor(j / 3) % 3], rot:it.rot || 0,
                            color:it.color || '#000000' }, fonteDe(tpl, it.fonte));
  const nd = campoNaoDefinido(it.s, p.s);
  if (nd) p.naoDefinido = nd;
  return p;
}
function quadro(it, tpl, c, out){
  const x1 = Math.min(it.x1, it.x2), x2 = Math.max(it.x1, it.x2);
  const y1 = Math.min(it.y1, it.y2), y2 = Math.max(it.y1, it.y2);
  if (it.fill || it.borda) out.push({ g:'rect', x1, y1, x2, y2, w:4, color:it.borda ? (it.color || '#000000') : undefined,
                                      fill:it.fill, semTraco:!it.borda });
  const ft = fonteDe(tpl, it.fonte);
  const mg = it.margem || 20;
  const linhas = String(resolve(it.s, c)).split('\n');
  /* quebra por largura APROXIMADA (meio em por letra): o motor não mede fonte; o Altium mede */
  const larg = Math.max(1, x2 - x1 - 2 * mg), porLinha = Math.max(1, Math.floor(larg / (ft.tam * 0.5)));
  const fim = [];
  const nd = campoNaoDefinido(it.s, linhas.join('\n'));
  for (const l of linhas){
    if (!it.quebra || l.length <= porLinha){ fim.push(l); continue; }
    let atual = '';
    for (const pal of l.split(' ')){
      if (atual && (atual + ' ' + pal).length > porLinha){ fim.push(atual); atual = pal; }
      else atual = atual ? atual + ' ' + pal : pal;
    }
    fim.push(atual);
  }
  const hz = it.alinha || 'center';
  const x = hz === 'left' ? x1 + mg : hz === 'right' ? x2 - mg : (x1 + x2) / 2;
  fim.forEach((l, i) => out.push(Object.assign({ g:'text', x, y:y2 - mg - i * ft.tam * 1.15, s:l, h:hz, v:'top', rot:0,
                                                  color:it.textColor || '#000000' }, ft, nd ? { naoDefinido:nd } : null)));
}
/* As primitivas do template numa folha.
   `tpl`    o template (de `acha`) — null = nada
   `medida` [w, h] da folha (para os sem arquivo, que acompanham a folha)
   `ctxo`   o que vai no `contexto()`: doc, proj, folhaN, folhaTotal, documento, projeto… */
function primitivas(tpl, medida, ctxo){
  const out = [];
  if (!tpl) return out;
  const f = folhaDe(tpl, medida);
  const c = contexto(Object.assign({ tpl, estilo: f.estilo === 'Custom' ? '' : f.estilo }, ctxo || {}));
  moldura(f, out);
  if (f.carimbo) carimboInterno(f, tpl, c, out);
  for (const it of (tpl.itens || [])){
    switch (it.g){
      case 'text': out.push(texto(it, tpl, c)); break;
      case 'frame': quadro(it, tpl, c, out); break;
      case 'line': out.push({ g:'line', x1:it.x1, y1:it.y1, x2:it.x2, y2:it.y2, w:it.w || 4, color:it.color || '#000000' }); break;
      case 'rect': out.push({ g:'rect', x1:it.x1, y1:it.y1, x2:it.x2, y2:it.y2, w:it.w || 4, color:it.color || '#000000',
                              fill:it.solid ? (it.fill || it.color) : undefined }); break;
      case 'polyline': out.push({ g:'polyline', pts:it.pts, w:it.w || 4, color:it.color || '#000000' }); break;
      case 'poly': out.push({ g:'polyline', pts:it.pts, w:it.w || 4, color:it.color || '#000000', fechado:true,
                              fill:it.solid ? (it.fill || it.color) : undefined }); break;
      case 'arc': out.push({ g:'arc', cx:it.cx, cy:it.cy, r:it.r, sa:it.sa, ea:it.ea, w:it.w || 4, color:it.color || '#000000' }); break;
      case 'ellipse': out.push({ g:'ellipse', cx:it.cx, cy:it.cy, rx:it.rx, ry:it.ry, w:it.w || 4, color:it.color || '#000000',
                                 fill:it.solid ? (it.fill || it.color) : undefined }); break;
      case 'image': out.push({ g:'image', x1:it.x1, y1:it.y1, x2:it.x2, y2:it.y2, src:it.src || null, aspecto:!!it.aspecto }); break;
    }
  }
  if (!c.cru) alinhaCodigos(out);
  return out;
}
/* 1.90.1 (pedido do dono: "deixa os dois códigos alinhados"): no carimbo da casa (A4_DiEletrons) o código do
   equipamento é a 2ª linha de uma célula de duas — a 1ª era o NomeDoEquipamento, que saiu do quadro na 1.88.0 — e
   ficava mais baixo que o código da placa, sozinho no meio da célula dele. Com o nome vazio, o código do equipamento
   passa para a MESMA linha de base, fonte e tamanho do código da placa (cada um continua centrado na sua célula).
   É regra do desenho, não do dado: vale para todo template (o da casa no NexoBD, sem regravar) na tela, nas miniaturas
   e no PDF do esquema; o editor de template (cru) mostra as posições como estão gravadas. Só quando os dois estão na
   mesma faixa do carimbo (até 1,5 altura de letra de diferença) — outro template com outra arrumação fica como está. */
function alinhaCodigos(out){
  const de = re => out.find(p => p.g === 'text' && typeof p.origem === 'string' && re.test(p.origem.trim()));
  const eq = de(/^=CodigoDoEquipamento$/i), pl = de(/^=CodigoDaPlaca$/i), nome = de(/^=NomeDoEquipamento$/i);
  if (!eq || !pl || (nome && String(nome.s == null ? '' : nome.s).trim())) return;
  if (Math.abs(eq.y - pl.y) > 1.5 * Math.max(eq.tam || 0, pl.tam || 0)) return;
  eq.y = pl.y; eq.v = pl.v;
  for (const k of ['fonte', 'tam', 'negrito', 'italico']) eq[k] = pl[k];
}

/* A caixa de um ITEM do template (não da primitiva), em mil: o editor seleciona e arrasta por
   ela. Texto pela largura aproximada (0,55 em por letra) — o motor não mede fonte. */
function caixaItem(it, tpl){
  const xs = [], ys = [];
  const pt = (x, y) => { xs.push(x); ys.push(y); };
  if (it.g === 'text'){
    const p = texto(it, tpl, contexto({ cru:true }));
    const w = Math.max(1, String(p.s).length) * p.tam * 0.55, h = p.tam;
    const x0 = p.h === 'center' ? -w / 2 : p.h === 'right' ? -w : 0;
    const y0 = p.v === 'middle' ? -h / 2 : p.v === 'top' ? -h : 0;
    const a = (p.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    for (const [u, v] of [[x0, y0], [x0 + w, y0], [x0, y0 + h], [x0 + w, y0 + h]]) pt(p.x + u * c - v * s, p.y + u * s + v * c);
  } else if (it.pts) for (const q of it.pts) pt(q[0], q[1]);
  else if (it.cx != null){ const rx = it.rx != null ? it.rx : it.r, ry = it.ry != null ? it.ry : it.r; pt(it.cx - rx, it.cy - ry); pt(it.cx + rx, it.cy + ry); }
  else { pt(it.x1, it.y1); pt(it.x2, it.y2); }
  return { x1:Math.min(...xs), y1:Math.min(...ys), x2:Math.max(...xs), y2:Math.max(...ys) };
}
/* a caixa de uma primitiva de texto, em mil (a mesma conta aproximada do caixaItem) */
function caixaTexto(p){
  const w = Math.max(1, String(p.s).length) * p.tam * 0.55, h = p.tam;
  const x0 = p.h === 'center' ? -w / 2 : p.h === 'right' ? -w : 0;
  const y0 = p.v === 'middle' ? -h / 2 : p.v === 'top' ? -h : 0;
  const a = (p.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const xs = [], ys = [];
  for (const [u, v] of [[x0, y0], [x0 + w, y0], [x0, y0 + h], [x0 + w, y0 + h]]){ xs.push(p.x + u * c - v * s); ys.push(p.y + u * s + v * c); }
  return { x1:Math.min(...xs), y1:Math.min(...ys), x2:Math.max(...xs), y2:Math.max(...ys) };
}
/* os campos "PROJETO NÃO DEFINIDO" que o template desenha nesta folha: [{campo, caixa:{x1,y1,x2,y2}}] (em mil, com
   folga) — o que a vista Esquema destaca e onde o clique abre o Definir projeto */
function naoDefinidos(tpl, medida, ctxo){
  const out = [];
  if (!tpl) return out;
  for (const p of primitivas(tpl, medida, ctxo)){
    if (p.g !== 'text' || !p.naoDefinido) continue;
    const b = caixaTexto(p), f = p.tam * 0.35;
    out.push({ campo:p.naoDefinido, caixa:{ x1:b.x1 - f, y1:b.y1 - f, x2:b.x2 + f, y2:b.y2 + f } });
  }
  return out;
}
/* o projeto (o cabeçalho `params` do schematic.js e o nome) ainda não tem o código da placa / do equipamento?
   {CodigoDaPlaca:bool, CodigoDoEquipamento:bool} — true = não definido (o mesmo que o carimbo mostra) */
function camposNaoDefinidos(params, projeto){
  const c = contexto({ proj:params, projeto });
  const out = {};
  for (const n of CAMPOS_DEFINIR) out[n] = valor(n, c) === NAO_DEFINIDO;
  return out;
}
/* move um item por (dx, dy) — no lugar */
function moveItem(it, dx, dy){
  if (it.x != null){ it.x += dx; it.y += dy; }
  if (it.x1 != null){ it.x1 += dx; it.x2 += dx; it.y1 += dy; it.y2 += dy; }
  if (it.cx != null){ it.cx += dx; it.cy += dy; }
  if (it.pts) it.pts = it.pts.map(q => [q[0] + dx, q[1] + dy]);
  return it;
}
/* o id da fonte do template com este nome/tamanho (cria se não houver) */
function fonteId(tpl, tam, nome, negrito){
  tpl.fontes = tpl.fontes || {};
  nome = nome || 'Times New Roman';
  for (const k of Object.keys(tpl.fontes)){
    const f = tpl.fontes[k];
    if (f.nome === nome && f.tam === tam && !!f.negrito === !!negrito && !f.italico) return Number(k);
  }
  const id = Object.keys(tpl.fontes).reduce((m, k) => Math.max(m, Number(k) || 0), 0) + 1;
  tpl.fontes[String(id)] = negrito ? { nome, tam, negrito:true } : { nome, tam };
  return id;
}

/* ─── canvas ─── */
const imagens = new Map();       /* src -> HTMLImageElement (carrega uma vez, avisa quando chega) */
function imagem(src, aoChegar){
  if (!src || typeof Image === 'undefined') return null;
  let im = imagens.get(src);
  if (!im){
    im = new Image();
    im.onload = () => { if (aoChegar) aoChegar(); };
    im.src = src;
    imagens.set(src, im);
  }
  return im.complete && im.naturalWidth ? im : null;
}
function fonteCss(p){
  return (p.italico ? 'italic ' : '') + (p.negrito ? 'bold ' : '') + p.tam + 'px "' + p.fonte + '", serif';
}
/* Desenha no ctx que JÁ está no mundo da folha (mil, Y para cima — o da vista Esquema).
   opts: esc (px por mil, para pular texto ilegível), aoChegarImagem (redesenhar quando o logo
   terminar de carregar), cor (força uma cor só — miniatura). Devolve as primitivas. */
function desenha(ctx, tpl, medida, ctxo, opts){
  opts = opts || {};
  const prims = primitivas(tpl, medida, ctxo);
  const esc = opts.esc || 1;
  for (const p of prims){
    const cor = opts.cor || p.color || '#000000';
    ctx.lineWidth = Math.max(p.w || 4, 1 / esc);
    ctx.strokeStyle = cor;
    if (p.g === 'line'){
      ctx.beginPath(); ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); ctx.stroke();
    } else if (p.g === 'rect'){
      const x = Math.min(p.x1, p.x2), y = Math.min(p.y1, p.y2), w = Math.abs(p.x2 - p.x1), h = Math.abs(p.y2 - p.y1);
      if (p.fill){ ctx.fillStyle = p.fill; ctx.fillRect(x, y, w, h); }
      if (!p.semTraco) ctx.strokeRect(x, y, w, h);
    } else if (p.g === 'polyline'){
      if (!p.pts || p.pts.length < 2) continue;
      ctx.beginPath(); ctx.moveTo(p.pts[0][0], p.pts[0][1]);
      for (let i = 1; i < p.pts.length; i++) ctx.lineTo(p.pts[i][0], p.pts[i][1]);
      if (p.fechado) ctx.closePath();
      if (p.fill){ ctx.fillStyle = p.fill; ctx.fill(); }
      ctx.stroke();
    } else if (p.g === 'arc'){
      ctx.beginPath(); ctx.arc(p.cx, p.cy, p.r, (p.sa || 0) * Math.PI / 180, (p.ea || 360) * Math.PI / 180); ctx.stroke();
    } else if (p.g === 'ellipse'){
      ctx.beginPath(); ctx.ellipse(p.cx, p.cy, p.rx, p.ry, 0, 0, 2 * Math.PI);
      if (p.fill){ ctx.fillStyle = p.fill; ctx.fill(); }
      ctx.stroke();
    } else if (p.g === 'text'){
      if (!p.s || p.tam * esc < 2) continue;
      if (p.naoDefinido && opts.destacaNaoDefinido && !opts.cor){
        /* "PROJETO NÃO DEFINIDO" na tela: vermelho, com o tracejado em volta (é clicável: abre o Definir projeto) */
        const b = caixaTexto(p), f = p.tam * 0.35;
        ctx.save();
        ctx.setLineDash([p.tam * 0.25, p.tam * 0.18]);
        ctx.lineWidth = Math.max(p.tam * 0.05, 1 / esc);
        ctx.strokeStyle = '#d32f2f';
        ctx.strokeRect(b.x1 - f, b.y1 - f, b.x2 - b.x1 + 2 * f, b.y2 - b.y1 + 2 * f);
        ctx.restore();
      }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rot || 0) * Math.PI / 180);
      ctx.scale(1, -1);
      ctx.font = fonteCss(p);
      ctx.fillStyle = p.naoDefinido && opts.destacaNaoDefinido && !opts.cor ? '#d32f2f' : cor;
      ctx.textAlign = p.h || 'left';
      ctx.textBaseline = p.v === 'top' ? 'top' : p.v === 'middle' ? 'middle' : 'bottom';
      ctx.fillText(p.s, 0, 0);
      ctx.restore();
    } else if (p.g === 'image'){
      const im = imagem(p.src, opts.aoChegarImagem);
      let x = Math.min(p.x1, p.x2), y = Math.min(p.y1, p.y2), w = Math.abs(p.x2 - p.x1), h = Math.abs(p.y2 - p.y1);
      if (!im){
        ctx.save(); ctx.setLineDash([20, 20]); ctx.strokeStyle = '#999999'; ctx.strokeRect(x, y, w, h); ctx.restore();
        continue;
      }
      if (p.aspecto){
        const r = im.naturalWidth / im.naturalHeight;
        if (w / h > r){ const n = h * r; x += (w - n) / 2; w = n; } else { const n = w / r; y += (h - n) / 2; h = n; }
      }
      ctx.save(); ctx.translate(x, y + h); ctx.scale(1, -1); ctx.drawImage(im, 0, 0, w, h); ctx.restore();
    }
  }
  return prims;
}

/* ─── o template de uma folha do schematic.js ─── */
/* item `sheet` da folha `nome` (ou null) */
function itemFolha(schematic, nome){
  return ((schematic && schematic.items) || []).find(i => i && i.t === 'sheet' && i.name === nome) || null;
}
/* tudo o que o desenho precisa para a folha `nome`: {tpl, ctxo} — tpl null = sem template */
function daFolha(schematic, nome, fontes){
  const it = itemFolha(schematic, nome);
  if (!it || !it.template) return { tpl:null, ctxo:null, item:it };
  const folhas = ((schematic && schematic.items) || []).filter(i => i && i.t === 'sheet');
  const n = folhas.indexOf(it);
  return { item:it, tpl:acha(it.template, fontes), ctxo:{
    doc:it.params, proj:schematic.params, folhaN:n + 1, folhaTotal:folhas.length,
    documento:nome + '.SchDoc', projeto:schematic.project || '', formato:it.size || '', folhaNome:nome,
    escala:it.escala || '' } };
}

/* Escolher um template para a folha, no item `sheet`, como o Altium faz: o template traz a
   folha dele (w/h). `null` tira o template e deixa a medida como está. Os sem arquivo
   (Standard/ANSI) acompanham a folha e não mexem na medida. `match` é o HubCore.sheetMatch
   (dá o nome do formato para o `size`). Devolve a medida nova, ou null se não mudou. */
function aplica(item, tpl, match){
  if (!tpl){ delete item.template; return null; }
  item.template = tpl.id;
  const f = tpl.folha || {};
  if (tpl.interno || !(f.w > 0 && f.h > 0)) return null;
  if (item.w === f.w && item.h === f.h) return null;
  item.w = f.w; item.h = f.h;
  const m = match ? match({ w:f.w, h:f.h }) : null;
  item.size = m ? m.name : (f.estilo && f.estilo !== 'Custom' ? f.estilo : 'Custom');
  return [f.w, f.h];
}

/* ─── templates da casa: o arquivo Libs/sch-templates-casa.js ─── */
const ARQ_CASA = 'Libs/sch-templates-casa.js';
/* id novo a partir do nome, sem colidir */
function idCasa(nome, existentes){
  const base = 'casa:' + (String(nome || 'template').trim().replace(/[^\w\- .À-ú]/g, '_') || 'template');
  let id = base, i = 2;
  while (existentes && existentes[id]) id = base + ' (' + (i++) + ')';
  return id;
}
/* o texto do arquivo: um template por linha, imagens embutidas no próprio item (o arquivo da
   casa é pequeno e editado à mão de vez em quando: a tabela comum não compensa) */
function serializaCasa(templates, removidos){
  const ids = Object.keys(templates || {});
  const L = ['var schtemplatesCasa = {', '"format":"schtemplate-v1",', '"title":"Templates de folha da casa",',
             '"generated":' + JSON.stringify(new Date().toISOString()) + ','];
  /* os padrões derivados que alguém removeu (ver PADROES): sem esta lista eles voltariam no próximo acervo() */
  const rem = Array.from(new Set((removidos || []).map(String))).filter(id => !(templates || {})[id]);
  if (rem.length) L.push('"removidos":' + JSON.stringify(rem) + ',');
  L.push('"templates":{');
  ids.forEach((id, i) => L.push(JSON.stringify(id) + ':' + JSON.stringify(templates[id]) + (i < ids.length - 1 ? ',' : '')));
  L.push('}};');
  return L.join('\n') + '\n';
}
/* cópia editável de um template (o do Altium vira ponto de partida de um da casa) */
function copia(tpl, nome, existentes){
  const t = JSON.parse(JSON.stringify(tpl || { folha:folhaDe({ folha:{} }), fontes:{}, params:{}, itens:[] }));
  delete t.interno; delete t.avisos;
  t.origem = 'casa';
  t.nome = nome || ((tpl && tpl.nome ? tpl.nome : 'Template') + ' (cópia)');
  t.id = idCasa(t.nome, existentes);
  t.fontes = t.fontes || {};
  if (!t.fontes['1']) t.fontes['1'] = { nome:'Times New Roman', tam:10 };
  /* o carimbo "sem arquivo" vira itens de verdade: na cópia ele passa a ser editável */
  if (tpl && tpl.folha && tpl.folha.carimbo){
    const f = folhaDe(tpl, [tpl.folha.w, tpl.folha.h]);
    const prims = [];
    carimboInterno(f, tpl, contexto({ tpl }), prims);
    for (const p of prims){
      if (p.g === 'line') t.itens.push({ g:'line', x1:p.x1, y1:p.y1, x2:p.x2, y2:p.y2, w:4, color:p.color });
      else t.itens.push({ g:'text', x:p.x, y:p.y, s:p.origem === '=$Estilo' ? (f.estilo || '') : p.origem, fonte:1, just:6, color:p.color });
    }
    t.folha.carimbo = false;
  }
  return t;
}

const API = { ESTILOS, CARIMBOS, APELIDOS, CAMPOS_PADRAO, ARQ_CASA, AUTOMATICOS, DO_PROJETO, NOMES_ANTIGOS, automatico,
              parseParams, serializaParams, acervo, lista, acha, contexto, valor, resolve, campos, codigoDoProjeto,
              folhaDe, estiloPorMedida, primitivas, desenha, itemFolha, daFolha,
              caixaItem, moveItem, fonteId, aplica,
              NAO_DEFINIDO, CAMPOS_DEFINIR, ehNaoDefinido, setVariante, textoVariante, naoDefinidos, camposNaoDefinidos, caixaTexto,
              idCasa, serializaCasa, copia, PADROES, a3DiEletrons, emOutraFolha, rotulo, tamanhoDe, nomeCurto, opcoesFolha };
root.HubSchTemplate = API;
if (typeof module === 'object' && module.exports) module.exports = API;
})(typeof self !== 'undefined' ? self : this);
