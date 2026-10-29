/* AltiumPCBMirror v2 - pcbframe.js — a vista PCB, no padrao do Altium 21.

   Pedido do dono (2026-10-02): "a interface da criacao de pcb igual ao da imagem [Altium 21],
   menu de configuracao apenas na lateral, W cria trilha nova, ctrl + 2 adiciona via nova, uma
   barra de ferramenta em cima ... circulo, triangulo, retangulo, igual a dos simbolos, texto,
   tudo, eu posso clicar em cima da trilha e mudar a camada que ela pertence" -- e criar e ver
   o Gerber dali mesmo.

   Quem faz o que:
   - o MOTOR e o hub-core.js: applyPcbChanges (board + changes -> modelo) e effectiveBoard (a
     placa com as mudancas assadas, no formato do board.js). A tela desenha a placa EFETIVA --
     a mesma que o Gerber recebe --, entao componente movido/virado sai pela conta unica dele;
   - este arquivo: desenho, selecao, arrasto, ferramentas, teclado e a escrita das ops do
     changes.js (sempre com os orig_* do board.js, e o designator_move antes do comp_move);
   - o painel da direita e o hub-pcbpainel.js (ficha, camadas, componentes, mudancas): ele le
     e age pela API `V` montada no fim deste arquivo;
   - os icones da barra: hub-pcbicones.js; o traçado com cantos 45/90/livre: hub-fio.js; o
     teclado: a tabela da PCB do hub-atalhos.js (HubAtalhos.pcb), com a mesma tabela embutida
     aqui enquanto ela nao existir;
   - o roteador: hub-roteador.js. Pedido do dono (2026-10-02): "trilha de mesma camada nao podem
     se cruzar ... e tenta fazer sozinho a curva em um caminho possivel ate o outro lado, mas sem
     mexer na trilha que ja ta colocada" e "elas so se encontram se forem trilhas de mesma NET".
     A Trilha (W) contorna o cobre de outra net (o Walkaround do Altium; Shift+R troca para parar
     no obstaculo ou ignorar), e a edicao que faria nets diferentes se encontrarem e recusada.
     Sem ele a vista abre igual, so sem conferir (motorLigado);
   - Gerber: hub-gerber.js (gerar/zip) e hub-gerberview.js (o visualizador, num overlay).
   Uma vista so para a web e o desktop, no tema do hub. lean=1 (aba Neoden) e so a placa. */
"use strict";
(function(){

/* ============================== dados de entrada ============================== */

const $ = id => document.getElementById(id);
const fatal = (m) => { const f = $('fatal'); if (f){ f.style.display = 'flex'; f.textContent = m; } };
const QS = new URLSearchParams(location.search);
const PROJ = QS.get('p');
const LEAN = QS.has('lean');
const MODO = QS.get('modo') || '';
if (LEAN) document.body.classList.add('lean');
if (typeof pcbmirror === 'undefined') {
  fatal('board.js não encontrado (ou inválido). Rode o ExportBoard no Altium (ou o leitor de .PcbDoc) para este projeto.');
  throw new Error('no board.js');
}
const B = pcbmirror;
const CH = (typeof changes !== 'undefined' && Array.isArray(changes)) ? changes : [];
const ANN = (typeof annotations !== 'undefined' && Array.isArray(annotations))
  ? annotations.map(a => ({ ...a })) : [];
const HC = HubCore;
/* O que veio do Altium e mora em modulo proprio: sem o arquivo a vista abre igual, so sem o recurso.
   hub-pcbnets.js: conectividade, linhas de conexao (ratsnest) e realce de net;
   hub-pcbteardrop.js: o teardrop orfao do espelho sai e o do mesmo par pad/trilha e refeito. */
const HN = (typeof HubPcbNets !== 'undefined' && HubPcbNets && typeof HubPcbNets.conexoes === 'function') ? HubPcbNets : null;
const HTD = (typeof HubPcbTeardrop !== 'undefined' && HubPcbTeardrop && typeof HubPcbTeardrop.refaz === 'function') ? HubPcbTeardrop : null;
/* hub-pcbtopologia.js: o Drag (a trilha arrastada leva as vizinhas, nao quebra) e o Tab do Altium */
const TOPO = (typeof HubPcbTopologia !== 'undefined' && HubPcbTopologia && typeof HubPcbTopologia.planoArrasto === 'function') ? HubPcbTopologia : null;
const isNum = HC.isNum, distSeg = HC.distSeg, near = HC.near, nearAng = HC.nearAng;

/* ============================== cores e constantes ============================== */

/* O CANVAS FICA FORA DO TEMA, como no Altium: fundo preto e as cores de camada medidas nos
   Gerbers da casa (HubCore.PCB_LAYERS, contrato 1b). Cor de interface mora no CSS. */
/* fora da placa o cinza da area de trabalho do Altium, a placa preta (o print do dono) */
const COR = {
  fundo:'#6b6b6b', placa:'#000000', contorno:'#a8a8a8', grade:'#1c1c1c', grade2:'#303030',
  origem:'#e0e0e0', furo:'#000000', sel:'#ffffff', add:'#00e676', del:'#ff5252', seta:'#ffd54f',
  medida:'#4fc3f7', snap:'#00e5ff', dentro:'#3d8bff', toca:'#00c853',
  conexao:'#c8c8c8',           /* a linha de conexao do Altium (Connection Lines) */
};
/* cor da bandeira NO DESENHO (a lista do painel repete o azul da nota) */
const ANN_COLORS = { err:'#ff5252', warn:'#ffd54f', info:'#4fc3f7' };
const MM_MIL = 1 / 0.0254;                 /* mil por mm */
const RAD = Math.PI / 180;
/* as mesmas regras do hub-gerber.js: a tela mostra a mascara e a pasta que o Gerber gera */
const MASCARA_PADRAO = 0.1016;             /* SolderMaskExpansion de 4 mil (110 de 111 projetos) */
const SEM_PASTA = -500;                    /* expansao de pasta <= -500 mm = "sem pasta" do Altium */
const TT_ALTURA = 0.52, TT_TRACO = 0.12;   /* TrueType sem contorno na HubFont */
const TRACO_TEXTO = 0.15;                  /* texto sem w: traco = h x 0,15 */
const PASSO_LINHA = 1.765;                 /* texto de varias linhas: passo = h x 1,765 (DMB) */
const BASE_HUBFONT = 0.047619;

const r6 = v => { const x = Math.round(v * 1e6) / 1e6; return x === 0 ? 0 : x; };
function normAng(a){ const v = r6((((+a || 0) % 360) + 360) % 360); return v >= 360 ? 0 : v; }
/* cosseno/seno com os multiplos de 90 exatos */
function cs(g){
  const a = (((+g || 0) % 360) + 360) % 360;
  if (a === 0) return [1, 0]; if (a === 90) return [0, 1];
  if (a === 180) return [-1, 0]; if (a === 270) return [0, -1];
  return [Math.cos(a * RAD), Math.sin(a * RAD)];
}
function gira(x, y, g){ const c = cs(g); return [x * c[0] - y * c[1], x * c[1] + y * c[0]]; }
/* texto do usuario vai para uma linha JSON lida linha a linha pelo Altium: sem aspas duplas
   (a sequencia aspas-dois-pontos quebra o parser) */
const limpaTxt = s => String(s == null ? '' : s).replace(/"/g, "'");

/* ============================== preferencias desta maquina ============================== */

const PREF = 'altiumhub.pcb.';
function lePref(k, d){ try { const v = localStorage.getItem(PREF + k); return v === null ? d : v; } catch (e) { return d; } }
function gravaPref(k, v){ try { localStorage.setItem(PREF + k, String(v)); } catch (e) {} }

/* ============================== grade ============================== */

/* 5 mil e o snap do Altium em 61% das placas da casa; a unidade de tela e mm em 86% */
const GRADES = [
  { id:'1mil',    mm:0.0254, rot:'1 mil' },   { id:'5mil',   mm:0.127, rot:'5 mil' },
  { id:'10mil',   mm:0.254,  rot:'10 mil' },  { id:'20mil',  mm:0.508, rot:'20 mil' },  { id:'25mil',  mm:0.635, rot:'25 mil' },
  { id:'50mil',   mm:1.27,   rot:'50 mil' },  { id:'100mil', mm:2.54,  rot:'100 mil' },
  { id:'0.001mm', mm:0.001,  rot:'0,001 mm' },{ id:'0.01mm', mm:0.01,  rot:'0,01 mm' },
  { id:'0.025mm', mm:0.025,  rot:'0,025 mm' }, { id:'0.05mm',  mm:0.05,   rot:'0,05 mm' }, { id:'0.1mm',  mm:0.1,   rot:'0,1 mm' },
  { id:'0.25mm',  mm:0.25,   rot:'0,25 mm' }, { id:'0.5mm',  mm:0.5,   rot:'0,5 mm' },
  { id:'1mm',     mm:1,      rot:'1 mm' },     { id:'2.5mm',   mm:2.5,    rot:'2,5 mm' },
];
const gradePorId = id => GRADES.find(g => g.id === id) || GRADES[1];
const snapV = (v, passo) => passo > 0 ? r6(Math.round(v / passo) * passo) : r6(v);

/* ============================== teclado ==============================
   A tabela da PCB mora no hub-atalhos.js (HubAtalhos.pcb, chave propria no localStorage) e o
   editor dela nas Configuracoes do hub. Enquanto o modulo nao a traz, vale esta copia -- com os
   MESMOS ids, entao a tecla trocada pelo usuario continua valendo quando ela chegar. */
const PCB_PADRAO = [
  { id:'trilha',      tecla:'W',      rotulo:'Trilha (roteamento interativo)' },
  { id:'via',         tecla:'Ctrl+2', rotulo:'Via (com a trilha na mão: via + troca de camada)' },
  { id:'linha',       tecla:'L',      rotulo:'Linha na camada atual' },
  { id:'arco',        tecla:'A',      rotulo:'Arco' },
  { id:'circulo',     tecla:'O',      rotulo:'Círculo' },
  { id:'retangulo',   tecla:'R',      rotulo:'Retângulo' },
  { id:'poligono',    tecla:'G',      rotulo:'Polígono' },
  { id:'texto',       tecla:'T',      rotulo:'Texto' },
  { id:'preencher',   tecla:'P',      rotulo:'Preencher formas (cheio/contorno)' },
  { id:'sinalizar',   tecla:'N',      rotulo:'Sinalizar para a IA' },
  { id:'medir',       tecla:'Ctrl+M', rotulo:'Régua (medir e cotar)' },
  { id:'unidade',     tecla:'Q',      rotulo:'Trocar a unidade mm/mil' },
  { id:'camadaUnica', tecla:'S',      rotulo:'Camada única' },
  { id:'proxCamada',  tecla:'+',      rotulo:'Próxima camada' },
  { id:'antCamada',   tecla:'-',      rotulo:'Camada anterior' },
  { id:'outraFace',   tecla:'*',      rotulo:'Top ↔ Bottom (com a trilha na mão: via + troca)' },
  { id:'virar',       tecla:'V',      rotulo:'Ver por baixo' },
  { id:'grade',       tecla:'B',      rotulo:'Mostrar/ocultar a grade' },
  { id:'diff',        tecla:'D',      rotulo:'Marcações das mudanças (olho)' },
  { id:'enquadrar',   tecla:'F',      rotulo:'Enquadrar a placa' },
  { id:'girar',       tecla:'Espaço', rotulo:'Girar 90°' },
  { id:'espelhoX',    tecla:'X',      rotulo:'Espelhar na horizontal' },
  { id:'espelhoY',    tecla:'Y',      rotulo:'Espelhar na vertical' },
  { id:'apagar',      tecla:'Delete', rotulo:'Apagar a seleção' },
  { id:'desfazer',    tecla:'Ctrl+Z', rotulo:'Desfazer' },
  { id:'refazer',     tecla:'Ctrl+Y', rotulo:'Refazer' },
  { id:'tudo',        tecla:'Ctrl+A', rotulo:'Selecionar tudo' },
  { id:'editar',      tecla:'E',      rotulo:'Travar/destravar a edição' },
  { id:'salvar',      tecla:'Ctrl+S', rotulo:'Salvar o changes.js' },
  { id:'ajuda',       tecla:'H',      rotulo:'Ajuda' },
  { id:'copiar',      tecla:'Ctrl+C', rotulo:'Copiar (referência no cursor)' },
  { id:'recortar',    tecla:'Ctrl+X', rotulo:'Recortar' },
  { id:'colar',       tecla:'Ctrl+V', rotulo:'Colar (clique larga)' },
  { id:'duplicar',    tecla:'Ctrl+D', rotulo:'Duplicar — o Rubber Stamp (Ctrl+R no Altium)' },
  { id:'vista2d',     tecla:'2',      rotulo:'2D Layout Mode' },
  { id:'vista3d',     tecla:'3',      rotulo:'3D Layout Mode' },
];
/* os gestos fixos (nao gravaveis): o canvas os trata antes do mapa */
const TRILHA = 'trilha na mão (W)', ARRASTO = 'arrastando', TRILHA_SEL = 'trilha selecionada', MEDIR = 'régua na mão (Ctrl+M)';
const GESTOS_PCB = [
  { rotulo:'Selecionar (2º clique no mesmo ponto pega o objeto de baixo)', teclas:['Clique'] },
  { rotulo:'Somar/tirar da seleção',                     teclas:['Shift', 'Clique'] },
  { rotulo:'Janela: esquerda→direita pega o que está DENTRO', teclas:['Arrastar no vazio'] },
  { rotulo:'Janela: direita→esquerda pega o que TOCA',   teclas:['Arrastar no vazio'] },
  { rotulo:'Mover',                                      teclas:['Arrastar'] },
  { rotulo:'Trilha (Interactive Routing do Altium, no app desktop)', teclas:['Ctrl', 'W'] },
  { rotulo:'Mover só a ponta de uma trilha selecionada', teclas:['Arrastar a ponta'] },
  { rotulo:'Arrastar a trilha sem soltar das vizinhas',  teclas:['Arrastar'],         quando:TRILHA_SEL },
  { rotulo:'Selecionar a trilha inteira até a via',      teclas:['Tab'],              quando:TRILHA_SEL },
  { rotulo:'De novo: tudo o que liga, além da via',      teclas:['Tab', 'Tab'],       quando:TRILHA_SEL },
  { rotulo:'Arrastar a tela',                            teclas:['Botão direito', 'Arrastar'] },
  { rotulo:'Menu',                                       teclas:['Botão direito'] },
  { rotulo:'Aproximar e afastar (no cursor)',            teclas:['Roda do mouse'] },
  { rotulo:'Andar para os lados',                        teclas:['Shift', 'Roda do mouse'] },
  { rotulo:'Propriedades',                               teclas:['Duplo clique'] },
  { rotulo:'Fixar o canto',                              teclas:['Clique'],           quando:TRILHA },
  { rotulo:'Inverter o canto',                           teclas:['Espaço'],           quando:TRILHA },
  { rotulo:'Modo 45° / 90° / livre',                     teclas:['Shift', 'Espaço'],  quando:TRILHA },
  { rotulo:'Conflito: contornar, parar no obstáculo ou ignorar', teclas:['Shift', 'R'], quando:TRILHA },
  { rotulo:'Desfazer o último trecho',                   teclas:['Backspace'],        quando:TRILHA },
  { rotulo:'Via sem trocar de camada',                   teclas:['2'],                quando:TRILHA },
  { rotulo:'Via e troca de camada',                      teclas:['*'],                quando:TRILHA },
  { rotulo:'Via e troca de camada',                      teclas:['Ctrl', '2'],        quando:TRILHA },
  { rotulo:'Largura no painel',                          teclas:['Tab'],              quando:TRILHA },
  { rotulo:'Terminar a trilha (de novo, larga a ferramenta)', teclas:['Botão direito'], quando:TRILHA },
  { rotulo:'Marcar o ponto (centro, ponta, meio, quadrante, vértice, borda, tangente)', teclas:['Clique'], quando:MEDIR },
  { rotulo:'Medir de um ponto ao outro, num arrasto só',  teclas:['Arrastar'],         quando:MEDIR },
  { rotulo:'Cota automática, alinhada, horizontal, vertical', teclas:['Espaço'],      quando:MEDIR },
  { rotulo:'Voltar um ponto',                            teclas:['Backspace'],        quando:MEDIR },
  { rotulo:'Soltar o agarre (ponto livre)',              teclas:['Ctrl'],             quando:MEDIR },
  { rotulo:'Largar a cota na mão (de novo, a régua)',    teclas:['Escape'],           quando:MEDIR },
  { rotulo:'Mudar por onde passa a cota',                teclas:['Arrastar'],         quando:'cota sob o cursor' },
  { rotulo:'Girar',                                      teclas:['Espaço'],           quando:ARRASTO },
  { rotulo:'Trocar de face (componente)',                teclas:['L'],                quando:ARRASTO },
  { rotulo:'Espelhar (texto e forma)',                   teclas:['X / Y'],            quando:ARRASTO },
  { rotulo:'Soltar o snap e as guias',                   teclas:['Ctrl'],             quando:ARRASTO },
  { rotulo:'Largar o que estiver na mão',                teclas:['Escape'] },
];
const HA = (typeof HubAtalhos !== 'undefined') ? HubAtalhos : null;
const HAP = HA && HA.pcb && typeof HA.pcb === 'object' ? HA.pcb : null;
const TECLADO = {
  padrao: (HAP && Array.isArray(HAP.ATALHOS_PADRAO) && HAP.ATALHOS_PADRAO.length) ? HAP.ATALHOS_PADRAO : PCB_PADRAO,
  chave:  (HAP && typeof HAP.CHAVE === 'string' && HAP.CHAVE) || 'altiumhub.pcb.atalhos',
  gestos: (HAP && Array.isArray(HAP.GESTOS) && HAP.GESTOS.length) ? HAP.GESTOS : GESTOS_PCB,
};
const PROIBIDAS = (HA && Array.isArray(HA.TECLAS_PROIBIDAS)) ? HA.TECLAS_PROIBIDAS
  : ['Ctrl+W','Ctrl+T','Ctrl+N','Ctrl+Shift+N','Ctrl+Shift+T','Ctrl+R','Ctrl+P','F5','F11','F12','Escape','Tab','Ctrl+Tab'];
/* a mesma regra do hub-atalhos.js » normalizaTecla (copia so para quando ele nao carregou) */
function normalizaLocal(e){
  if (!e || !e.key) return '';
  let k = e.key;
  if (k === 'Control' || k === 'Shift' || k === 'Alt' || k === 'Meta') return '';
  if (k === ' ' || k === 'Spacebar') k = 'Espaço';
  else if (k.length === 1) k = k.toUpperCase();
  const m = [];
  if (e.ctrlKey || e.metaKey) m.push('Ctrl');
  if (e.altKey) m.push('Alt');
  if (e.shiftKey && k.length > 1 && k !== 'Espaço') m.push('Shift');
  m.push(k);
  return m.join('+');
}
const normalizaTecla = (HA && typeof HA.normalizaTecla === 'function') ? HA.normalizaTecla : normalizaLocal;
/* o mapa padrao + o gravado; o mesmo algoritmo do mapaAtalhos do Esquema, sobre a tabela da PCB */
function mapaLocal(tabela, salvos){
  const porAcao = {};
  for (const a of tabela) porAcao[a.id] = a.tecla;
  const s = salvos && typeof salvos === 'object' ? salvos : {};
  for (const id of Object.keys(s)){
    const t = String(s[id] || '');
    if (!porAcao[id] || !t || PROIBIDAS.indexOf(t) >= 0 || /(^|\+)Escape$/.test(t)) continue;
    porAcao[id] = t;
  }
  const porTecla = {};
  for (const a of tabela){
    let t = porAcao[a.id];
    if (porTecla[t] && porTecla[t] !== a.id) t = a.tecla;
    if (porTecla[t] && porTecla[t] !== a.id) continue;
    porAcao[a.id] = t; porTecla[t] = a.id;
  }
  return { porAcao, porTecla };
}
function leSalvos(){
  if (HAP && typeof HAP.carrega === 'function') { try { return HAP.carrega() || {}; } catch (e) {} }
  try { const v = JSON.parse(localStorage.getItem(TECLADO.chave) || '{}'); return v && typeof v === 'object' ? v : {}; }
  catch (e) { return {}; }
}
function montaMapa(){
  if (HAP && typeof HAP.mapaAtalhos === 'function') {
    try { const m = HAP.mapaAtalhos(leSalvos()); if (m && m.porTecla && m.porAcao) return m; } catch (e) {}
  }
  return mapaLocal(TECLADO.padrao, leSalvos());
}
let ATALHOS = montaMapa();
/* as sequencias do Altium (P,T; T,D...) na predefinicao "Padrao Altium" do editor de atalhos: o
   leitor do hub-atalhos.js segura o comeco e mostra "P, …" no rodape. Sem ele, so teclas simples */
/* os menus do Altium (hub-pcbaltium.js): a barra, o botao direito, a tecla que abre menu (P, D,
   T, U... com a predefinicao Padrao Altium) e as Preferences */
let ALT = null, ultimoMouse = null;
function popupDoLeitor(seq){
  if (!seq || seq.indexOf(',') >= 0 || !ALT || !ALT.temPopup(seq)) return;
  const r = cv.getBoundingClientRect();
  const p = ultimoMouse || { x:r.left + r.width / 2, y:r.top + r.height / 2 };
  if (ALT.popup(seq, p.x, p.y)) setTimeout(() => LEITOR.cancela(), 0);
}
const LEITOR = (HA && typeof HA.leitor === 'function')
  ? HA.leitor(() => ATALHOS, id => fazAcao(id), { aoEsperar:seq => { avisoRodape(seq ? seq + ', …' : ''); popupDoLeitor(seq); } })
  : { tecla:(t) => { const id = ATALHOS.porTecla[t]; if (id) { fazAcao(id); return true; } return false; }, cancela(){}, pendente:() => '' };
const teclaDe = id => (ATALHOS.porAcao && ATALHOS.porAcao[id]) || '';
const comTecla = (txt, id) => { const t = teclaDe(id); return t ? txt + ' (' + t + ')' : txt; };

/* ============================== estado da vista ============================== */

let model = null, EB = null;
let LAYERS = [], LBYK = Object.create(null);
const view = { scale:10, cx:0, cy:0, flip:false };
const show = { grid:true, ghost:true, unica:false, layers:Object.create(null) };
/* AS COTAS DA RÉGUA (Ctrl+M, hub-pcbcotas.js; pedido do dono, 2026-10-29: "igual ao do NexoCAD ...
   fica lá marcando; esconder ou mostrar com um botão na barra"). Não vão para o changes.js (o Altium
   não as recebe): ficam nas preferências desta máquina, uma lista por projeto. show.cotas é o olho. */
/* DESEMPENHO DO 3D (pedido do dono, 2026-10-29: "quero opção de não ver componente 3D pra ficar mais
   leve"). corpos: desligado, nem o 3D nem a vista 2D carregam os corpos dos componentes (STEP,
   extrudados) -- a 2D fica sem as silhuetas e o 3D so com a placa. antes: o 3D montado escondido ao
   abrir a pagina (a tecla 3 so mostra); desligado, monta na primeira tecla 3. E, ligado ou nao, o 3D
   escondido nao se refaz mais depois de cada edicao (custava ~1 s de tela parada num projeto com
   planos): refaz quando abre, com a cena de antes na tela enquanto isso. */
const OPC3D = { corpos:lePref('3d.corpos', '1') !== '0', antes:lePref('3d.antes', '1') !== '0' };
const HCOT = (typeof HubPcbCotas !== 'undefined' && HubPcbCotas && typeof HubPcbCotas.geometria === 'function') ? HubPcbCotas : null;
const COTAS_PREF = 'cotas.' + (PROJ || '_');
show.cotas = lePref('cotas.ver', '1') !== '0';
const COTAS = (() => {
  try { const l = JSON.parse(lePref(COTAS_PREF, '[]')); return Array.isArray(l) ? l.filter(c => c && c.a && c.b && c.id) : []; }
  catch (e) { return []; }
})();
let cur = 'Top';                              /* a camada atual (aba ativa embaixo) */
let unidade = lePref('unidade', 'mm') === 'mil' ? 'mil' : 'mm';
let grade = gradePorId(lePref('grade', '5mil'));
/* snap a objetos: 'todas' as camadas visiveis, so a 'atual', ou 'off' */
let snapObj = ['todas', 'atual', 'off'].indexOf(lePref('snapobj', 'todas')) >= 0 ? lePref('snapobj', 'todas') : 'todas';
/* o Selection Filter do Altium; Corpos 3D e Rooms nao vem no espelho e ficam travados no painel */
const FILTROS = [
  ['comp', 'Componentes'], ['track', 'Trilhas'], ['arc', 'Arcos'], ['pad', 'Pads'], ['via', 'Vias'],
  ['region', 'Regiões'], ['poly', 'Polígonos'], ['fill', 'Fills'], ['text', 'Textos'],
  ['keepout', 'Keepouts'], ['outros', 'Outros'],
];
const filtro = (() => {
  const f = {}; for (const [k] of FILTROS) f[k] = true;
  try { const s = JSON.parse(lePref('filtro', '{}')); for (const k in s) if (k in f) f[k] = !!s[k]; } catch (e) {}
  return f;
})();
let editOn = false;
let tool = 'select';
let preencher = lePref('preencher', '0') === '1';
const RULES = (B.rules && typeof B.rules === 'object') ? B.rules : {};
/* Os modos de conflito do roteamento interativo do Altium (Shift+R cicla): contornar e o
   Walkaround (o padrao, o pedido do dono), parar e o Stop At First Obstacle e ignorar e o Ignore
   Obstacles -- o comportamento de antes do roteador, o escape para caso especial. Push e
   HugNPush ficam de fora de proposito: nada que ja esta na placa se mexe. */
const CONFLITOS = ['contornar', 'parar', 'ignorar'];
/* o que as ferramentas usam; a trilha e a via pela regra do espelho quando ele a traz */
const CFG = {
  wTrilha: (isNum(RULES.width) && RULES.width > 0) ? RULES.width : 0.254,
  viaSize: (isNum(RULES.viaSize) && RULES.viaSize > 0) ? RULES.viaSize : 0.6,
  viaDrill: (isNum(RULES.viaDrill) && RULES.viaDrill > 0) ? RULES.viaDrill : 0.3,
  viaNet: '',
  wLinha: 0.254, hTexto: 1.524, wTexto: 0.254, furo: 3.2,
  padW: 1.524, padFuro: 0.762,            /* o pad padrao do Altium: 60 mil, furo 30 mil */
  modo: '45',
  /* Polygon Pour: retangulo (2 cliques) ou poligono livre; tipo 'plano:<camada>' ou
     'sem:<camada>' / 'sem:Multi' (o recorte de poligono); net null = a de terra da placa */
  pourForma: lePref('pourForma', 'retangulo') === 'livre' ? 'livre' : 'retangulo',
  pourTipo: lePref('pourTipo', 'plano:Top'),
  pourNet: null,
  conflito: CONFLITOS.indexOf(lePref('conflito', 'contornar')) >= 0 ? lePref('conflito', 'contornar') : 'contornar',
};
if (!(CFG.viaDrill < CFG.viaSize)) CFG.viaDrill = r6(CFG.viaSize / 2);
/* ============================== Preferences (Tools » Preferences, T,P) ==============================
   As paginas "PCB Editor" do Altium (hub-pcbaltium.js desenha; aqui mora o que cada uma faz).
   O padrao e o comportamento de antes: nada muda ate a pessoa mexer. */
const CFG_REGRA = { wTrilha:CFG.wTrilha, viaSize:CFG.viaSize, viaDrill:CFG.viaDrill };
const TEM_REGRA = { w:isNum(RULES.width) && RULES.width > 0, via:isNum(RULES.viaSize) && RULES.viaSize > 0 };
const PREFS_PADRAO = () => ({
  drcOnline:false, duploClique:true, cursor:'small90',
  grade:true, conexoes:true, fantasmas:true,
  conflitosCiclo:CONFLITOS.slice(), conflito:'contornar', larguraDaTrilha:true, larguraModo:'regra', viaModo:'regra', canto:'45',
  roda:{ zoom:'', vertical:'Alt', horizontal:'Shift', camada:'Ctrl+Shift' },
  defaults:{ wTrilha:0.254, wLinha:0.254, viaSize:0.6, viaDrill:0.3, padW:1.524, padFuro:0.762, hTexto:1.524, wTexto:0.254, furo:3.2 },
  cores:{},
});
function normalizaPrefs(p){
  const ok = p && typeof p === 'object';
  const o = Object.assign(PREFS_PADRAO(), ok ? p : {});
  o.roda = Object.assign(PREFS_PADRAO().roda, ok && p.roda);
  o.defaults = Object.assign(PREFS_PADRAO().defaults, ok && p.defaults);
  for (const k of Object.keys(o.defaults)) if (!(isNum(o.defaults[k]) && o.defaults[k] > 0)) o.defaults[k] = PREFS_PADRAO().defaults[k];
  o.cores = (ok && p.cores && typeof p.cores === 'object') ? p.cores : {};
  o.conflitosCiclo = (Array.isArray(o.conflitosCiclo) ? o.conflitosCiclo : []).filter(v => CONFLITOS.indexOf(v) >= 0);
  if (!o.conflitosCiclo.length) o.conflitosCiclo = CONFLITOS.slice();
  if (['small90', 'large90', 'small45', 'tiny45'].indexOf(o.cursor) < 0) o.cursor = 'small90';
  if (['45', '90', 'livre'].indexOf(o.canto) < 0) o.canto = '45';
  return o;
}
let PREFS = (() => { try { return normalizaPrefs(JSON.parse(lePref('prefs', 'null'))); } catch (e) { return normalizaPrefs(null); } })();
/* as larguras e a via com que as ferramentas nascem: Default (a pagina Defaults) ou Preferred (a regra) */
function aplicaDefaults(){
  const d = PREFS.defaults;
  CFG.wTrilha = PREFS.larguraModo === 'regra' && TEM_REGRA.w ? CFG_REGRA.wTrilha : d.wTrilha;
  if (PREFS.viaModo === 'regra' && TEM_REGRA.via) { CFG.viaSize = CFG_REGRA.viaSize; CFG.viaDrill = CFG_REGRA.viaDrill; }
  else { CFG.viaSize = d.viaSize; CFG.viaDrill = d.viaDrill < d.viaSize ? d.viaDrill : r6(d.viaSize / 2); }
  CFG.wLinha = d.wLinha; CFG.hTexto = d.hTexto; CFG.wTexto = d.wTexto; CFG.furo = d.furo; CFG.padW = d.padW; CFG.padFuro = d.padFuro;
  CFG.modo = PREFS.canto;
}
aplicaDefaults();
show.grid = PREFS.grade !== false; show.ghost = PREFS.fantasmas !== false;
let chDirty = false, annDirty = false, staleWorkspace = false;

/* ============================== modelo efetivo ==============================
   model = board + changes (o motor); EB = a placa efetiva no formato do board.js, a MESMA que o
   Gerber recebe. A tela desenha o EB; o que edita e o model (os itens com src/eff). */
const IDX = { item:new Map(), compNome:new Map(), ebComp:new Map(), ebPorId:new Map(), opItem:new Map() };
/* O roteador (hub-roteador.js) le a placa efetiva por uma CENA: o EB com um indice espacial por
   camada de cobre, montado so na primeira consulta de cada camada. O EB mudou, a cena e outra.
   A conferencia de uma edicao (editaConferindo) ja monta o modelo, o EB e a cena de DEPOIS da
   edicao: o commit que vem logo em seguida os adota em vez de calcular tudo de novo (preCalc,
   com a assinatura do changes.js para nao adotar estado de outro changes). ROTA e a ultima rota
   calculada para a trilha na mao (o memo da previa: o clique reaproveita a mesma). */
let CENA = null, CENA_EB = null, preCalc = null, ebSeq = 0, ROTA = null;
let CONEX = null, REALCE = null, verConexoes = null;   /* ratsnest (cache por EB) e a net realcada */
function recalcula(){
  const pre = preCalc;
  preCalc = null;
  if (pre && pre.sig === JSON.stringify(CH)) { model = pre.model; EB = pre.eb; }
  else { model = HC.applyPcbChanges(B, CH); EB = HC.effectiveBoard(B, model); }
  /* teardrop orfao (a trilha ou a via andou): sai da tela e do Gerber, e o do mesmo par e refeito.
     Placa sem mudanca nao troca de EB (o acervo inteiro da 0 removido e 0 gerado) */
  if (HTD) {
    try { const r = HTD.refaz(EB, B); if (r && r.eb && ((r.removidos || []).length || (r.gerados || []).length)) EB = r.eb; }
    catch (e) { console.warn('teardrops:', e); }
  }
  EB = comDespejo(EB);
  CONEX = null;
  if (typeof drcDepoisDaEdicao === 'function') drcDepoisDaEdicao();
  CENA = pre && pre.eb === EB ? pre.cena : null;
  CENA_EB = CENA ? EB : null;
  ebSeq++;
  ROTA = null;
  montaCamadas();
  montaIndices();
  montaAlvos();
  pathPlacaCache = null;
  cacheSujo = true;
  if (typeof refaz3d === 'function') refaz3d();
  avisaHubPlaca();
}
/* Laser, Neoden e BOM andam com esta vista (hub-placaviva.js): a cada recalculo o hub recebe a
   placa daqui, com o que ainda nao foi salvo; ao sair, o hub volta a placa do disco */
function avisaHubPlaca(fim){
  if (LEAN || !PROJ) return;
  try { if (window.parent !== window && typeof window.parent.__hubPcbMudou === 'function') window.parent.__hubPcbMudou(PROJ, fim ? null : EB); } catch (e) {}
}
window.addEventListener('pagehide', () => avisaHubPlaca(true));
/* As abas: a lista do motor (com nome/cor do board.layers quando o espelho novo traz) e a
   Mechanical 1 sempre -- ela existe em toda placa do Altium e e onde a casa desenha cota e
   contorno a mao (86% das placas); sem ela na lista nao haveria onde desenhar. */
function montaCamadas(){
  const L = HC.boardLayers(EB).slice();
  if (!L.some(l => l.key === 'Mech1')) {
    const r = HC.pcbLayer('Mech1');
    L.push({ key:r.key, name:r.name, kind:r.kind, side:r.side, pair:r.pair, altium:r.altium, color:r.color,
             order:r.order, stack:null, used:false, count:0, inBoard:false });
    L.sort((a, b) => a.order - b.order);
  }
  /* sinal na ordem fisica (layers[].stack) quando o espelho diz; senao a da tabela */
  const sinal = L.filter(l => l.kind === 'signal');
  if (sinal.some(l => isNum(l.stack))) {
    const ord = sinal.slice().sort((a, b) => (isNum(a.stack) ? a.stack : 99 + a.order) - (isNum(b.stack) ? b.stack : 99 + b.order));
    let i = 0;
    for (let k = 0; k < L.length; k++) if (L[k].kind === 'signal') L[k] = ord[i++];
  }
  /* Preferences » Layer Colors: a cor trocada pela pessoa; a de fabrica fica em corPadrao */
  for (let k = 0; k < L.length; k++) {
    const base = L[k].corPadrao || L[k].color, c = PREFS.cores[L[k].key];
    L[k] = Object.assign({}, L[k], { corPadrao:base, color:/^#[0-9a-f]{6}$/i.test(c || '') ? c : base });
  }
  LAYERS = L;
  LBYK = Object.create(null);
  let n = 0;
  for (const l of L) {
    LBYK[l.key] = l;
    l.num = l.kind === 'signal' ? ++n : 0;              /* o [1] Top Layer, [2] Bottom Layer das abas */
    /* a visibilidade lembrada deste projeto (o menu Camadas do canto grava) */
    if (!(l.key in show.layers)) show.layers[l.key] = !(VIS_SALVA && VIS_SALVA.ocultas.indexOf(l.key) >= 0);
  }
  if (!LBYK[cur]) cur = LBYK.Top ? 'Top' : (L[0] ? L[0].key : 'Top');
}
const corDe = k => (LBYK[k] && LBYK[k].color) || (HC.pcbLayer(k) || {}).color || '#888888';
const nomeDe = k => (LBYK[k] && LBYK[k].name) || (HC.pcbLayer(k) || {}).name || k;
const cobre = k => HC.isCopper(k);
const camadasCobre = () => LAYERS.filter(l => l.kind === 'signal' || l.kind === 'plane');

function montaIndices(){
  IDX.item = new Map(); IDX.compNome = new Map(); IDX.ebComp = new Map(); IDX.ebPorId = new Map(); IDX.opItem = new Map();
  /* a linha do changes.js -> o item do modelo que ela fez (o id do objeto adicionado no EB) */
  for (const it of model.changeItems) if (it && it.ch && !IDX.opItem.has(it.ch)) IDX.opItem.set(it.ch, it);
  /* o item do modelo -> a PRIMEIRA linha que o tem como alvo (a mesma resposta do find de antes) */
  IDX.opDoItem = new Map(); IDX.opModel = model;
  for (const it of model.changeItems) if (it && it.target && !IDX.opDoItem.has(it.target)) IDX.opDoItem.set(it.target, it.ch);
  for (const list of [model.tracks, model.arcs, model.vias, model.texts, model.fills, model.regions, model.pads || []])
    for (const m of list) if (m.src && m.src.id != null && !IDX.item.has(String(m.src.id))) IDX.item.set(String(m.src.id), m);
  for (const m of model.added) if (m.eff && m.eff.id != null) IDX.item.set(String(m.eff.id), m);
  for (const m of model.polygons || []) {
    const id = m.added ? m.eff.id : (m.src && m.src.id);
    if (id != null && !IDX.item.has(String(id))) IDX.item.set(String(id), m);
  }
  model.comps.forEach((m, i) => {
    IDX.compNome.set(String(m.eff.designator || m.src.ref), m);
    IDX.ebComp.set(m, EB.components[i]);
  });
  for (const k of ['tracks', 'arcs', 'vias', 'texts', 'fills', 'regions', 'silk', 'lines', 'cutouts', 'polygons'])
    for (const o of (EB[k] || [])) if (o && o.id != null && !IDX.ebPorId.has(String(o.id))) IDX.ebPorId.set(String(o.id), o);
  /* o que cada componente leva junto (pelo nome efetivo: o owner do EB ja sai renomeado) */
  IDX.donos = new Map();
  const poeDono = (o, kind) => {
    if (!o || o.owner == null || o.owner === '') return;
    const k = String(o.owner);
    let l = IDX.donos.get(k);
    if (!l) { l = []; IDX.donos.set(k, l); }
    l.push({ kind, o });
  };
  for (const o of EB.tracks || []) poeDono(o, 'line');
  for (const o of EB.arcs || []) poeDono(o, 'arc');
  for (const o of EB.silk || []) poeDono(o, o && o.kind === 'arc' ? 'arc' : 'line');
  for (const o of EB.lines || []) poeDono(o, o && o.kind === 'arc' ? 'arc' : 'line');
  for (const o of EB.fills || []) poeDono(o, 'fill');
  for (const o of EB.regions || []) poeDono(o, 'region');
  for (const o of EB.texts || []) poeDono(o, 'text');
  for (const o of EB.cutouts || []) poeDono(o, 'region');
}
const compDoDono = owner => (owner != null && IDX.compNome.has(String(owner))) ? IDX.compNome.get(String(owner)) : null;
/* a linha do changes.js que criou um objeto adicionado */
function opDe(m){
  if (!m) return null;
  /* o indice do montaIndices (antes era uma busca no changes.js inteiro por objeto: com 3.000 linhas,
     montar os alvos depois de cada edicao fazia ~10 milhoes de comparacoes) */
  if (IDX.opModel === model && IDX.opDoItem) return IDX.opDoItem.get(m) || null;
  const it = model.changeItems.find(i => i.target === m);
  return it ? it.ch : null;
}
/* o objeto efetivo (EB) de um item do modelo */
function ebDe(m){ if (!m) return null; const id = m.added ? m.eff.id : m.src.id; return IDX.ebPorId.get(String(id)) || null; }

/* ============================== geometria basica ============================== */

function bbPts(pts){
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of pts) if (p && isNum(p[0]) && isNum(p[1])) {
    if (p[0] < x1) x1 = p[0]; if (p[0] > x2) x2 = p[0]; if (p[1] < y1) y1 = p[1]; if (p[1] > y2) y2 = p[1];
  }
  return x1 > x2 ? null : [x1, y1, x2, y2];
}
function dentroPoli(pts, x, y){
  let d = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if (((a[1] > y) !== (b[1] > y)) && (x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0])) d = !d;
  }
  return d;
}
function pertoPoli(pts, x, y, tol){
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
    if (distSeg(x, y, pts[j][0], pts[j][1], pts[i][0], pts[i][1]) <= tol) return true;
  return false;
}
/* o arco (sa -> ea, anti-horario) passa pelo angulo g? */
function noArco(sa, ea, g){
  if (Math.abs(ea - sa) >= 359.999) return true;
  const sw = (((ea - sa) % 360) + 360) % 360;
  const d = (((g - sa) % 360) + 360) % 360;
  return d <= sw + 1e-9;
}
const arcoCheio = o => Math.abs(o.ea - o.sa) >= 359.999;
function pontaArco(o, qual){ const g = qual ? o.ea : o.sa; const c = cs(g); return [o.cx + o.r * c[0], o.cy + o.r * c[1]]; }
/* os 4 cantos de um retangulo centrado em (cx,cy), W x H, girado */
function cantos(cx, cy, W, H, rot){
  return [[-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [-W / 2, H / 2]].map(q => { const g = gira(q[0], q[1], rot); return [cx + g[0], cy + g[1]]; });
}
const fillCentro = f => [(f.x1 + f.x2) / 2, (f.y1 + f.y2) / 2];
const fillCantos = f => { const c = fillCentro(f); return cantos(c[0], c[1], Math.abs(f.x2 - f.x1), Math.abs(f.y2 - f.y1), isNum(f.rot) ? f.rot : 0); };

/* ---- pads: as convencoes do hub-gerber.js, para a tela e o Gerber nao discordarem ---- */
const ehTH = p => p.layer === 'Multi' || (!p.layer && p.type === 'th');
function formaLado(p, lado){
  if (lado === 'bottom' && ehTH(p)) {
    const b = p.bot && typeof p.bot === 'object' ? p.bot : null;
    if (b) return { shape:b.shape || p.shape, w:isNum(b.w) ? b.w : p.w, h:isNum(b.h) ? b.h : p.h, radius:isNum(b.radius) ? b.radius : p.radius };
    if ('bw' in p || 'bh' in p || 'bshape' in p)
      return { shape:p.bshape || p.shape, w:isNum(p.bw) ? p.bw : p.w, h:isNum(p.bh) ? p.bh : p.h, radius:isNum(p.bradius) ? p.bradius : p.radius };
  }
  return { shape:p.shape, w:p.w, h:p.h, radius:p.radius };
}
/* o furo fica em (x,y); o "furo deslocado" desloca o COBRE, no referencial do pad */
function centroCobre(p){
  if ((isNum(p.hox) && p.hox) || (isNum(p.hoy) && p.hoy)) { const q = gira(p.hox || 0, p.hoy || 0, p.rot || 0); return [p.x + q[0], p.y + q[1]]; }
  return [p.x, p.y];
}
const tampado = (o, lado) => lado === 'bottom' ? o.tentBot === true : o.tentTop === true;
const expMascara = o => isNum(o.sm) ? o.sm : (isNum(RULES.sm) ? RULES.sm : MASCARA_PADRAO);
const expPasta = p => isNum(p.pm) ? p.pm : (isNum(RULES.pm) ? RULES.pm : 0);
const ladoDaVista = () => view.flip ? 'bottom' : 'top';

/* ---- texto: com o contorno exato do Altium (polys) quando ele ainda esta em cima do texto;
   senao a HubFont com a largura w -- a mesma regra (e as mesmas medidas) do hub-gerber.js ---- */
function polysDoTexto(t){
  const P = (Array.isArray(t.polys) ? t.polys : []).filter(q => q && Array.isArray(q.pts) && q.pts.length >= 3);
  if (!P.length) return null;
  const todos = [];
  for (const q of P) if (!q.hole) for (const p of q.pts) todos.push(p);
  const bb = bbPts(todos);
  if (!bb) return null;
  if (isNum(t.x) && isNum(t.y) && Math.hypot((bb[0] + bb[2]) / 2 - t.x, (bb[1] + bb[3]) / 2 - t.y) > Math.max(1, isNum(t.h) ? t.h : 0)) return null;
  return { P, bb };
}
/* O contorno exato (regioes) do HubGerber.geometriaTexto sai nas unidades do Gerber (0,00001 mm:
   ele passa pelo limpaContorno -> unid) e os tracos saem em mm. A tela desenha em mm: sem a volta,
   o texto com contorno exato (os polys do ExportBoard 2026-10) ia parar 100 mil vezes longe do
   lugar. A escala vem da posicao -- a mesma regra do roteador (hub-roteador.js » poeTexto) --,
   para nao quebrar no dia em que o gerador devolver mm. */
function regioesEmMm(regioes, t){
  let sx = 0, sy = 0, n = 0;
  for (const q of regioes) for (const p of (q && q.pts) || []) if (Array.isArray(p) && isNum(p[0]) && isNum(p[1])) { sx += p[0]; sy += p[1]; n++; }
  if (!n || !isNum(t.x) || !isNum(t.y)) return regioes;
  const cx = sx / n, cy = sy / n, lim = Math.max(10, 10 * (isNum(t.h) ? t.h : 0));
  if (!(Math.hypot(cx - t.x, cy - t.y) > 1000 && Math.hypot(cx * 1e-5 - t.x, cy * 1e-5 - t.y) < lim)) return regioes;
  return regioes.map(q => ({ pts:((q && q.pts) || []).map(p => [p[0] * 1e-5, p[1] * 1e-5]), hole:!!(q && q.hole) }));
}
function geoTexto(t){
  if (!t || t.hidden) return null;
  /* A GEOMETRIA E A DO GERBER: o hub-gerber.js monta o texto (contorno exato, ou a HubFont com os
     glifos que faltam nela, posicionada pela tinta, com moldura de varias linhas) e a tela desenha
     exatamente aquilo -- o que se ve aqui e o que vai para a fabrica. A conta local abaixo so vale
     quando o gerador nao carregou. */
  if (typeof HubGerber !== 'undefined' && typeof HubGerber.geometriaTexto === 'function') {
    let g = null;
    try { g = HubGerber.geometriaTexto(t); } catch (e) { g = null; }
    if (!g) return null;
    if (g.regioes) {
      const regioes = regioesEmMm(g.regioes, t);
      const pts = [];
      for (const q of regioes) if (!q.hole) for (const p of q.pts) pts.push(p);
      const bb = bbPts(pts);
      if (!bb) return null;
      return { polys:regioes, linhas:null, w:0, caixa:[[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]]], inv:false };
    }
    /* a caixa de selecao: a tinta no referencial do texto (justa mesmo girado), mais meio traco */
    const w = g.w > 0 ? g.w : 0, rot = isNum(t.rot) ? t.rot : 0, ox = t.x, oy = t.y;
    const loc = [];
    for (const s of g.tracos) for (const p of s) loc.push(gira(p[0] - ox, p[1] - oy, -rot));
    const bb = bbPts(loc);
    if (!bb) return null;
    const m = w / 2;
    const caixa = [[bb[0] - m, bb[1] - m], [bb[2] + m, bb[1] - m], [bb[2] + m, bb[3] + m], [bb[0] - m, bb[3] + m]]
      .map(q => { const r = gira(q[0], q[1], rot); return [ox + r[0], oy + r[1]]; });
    return { polys:null, linhas:g.tracos, w, caixa, inv:!!t.inverted, h:t.h };
  }
  const pl = polysDoTexto(t);
  if (pl) {
    const bb = pl.bb;
    return { polys:pl.P, linhas:null, w:0, caixa:[[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]]], inv:false };
  }
  const txt = t.text == null ? '' : String(t.text);
  if (!txt.trim() || !(t.h > 0) || !isNum(t.x) || !isNum(t.y)) return null;
  const tipo = t.kind || (/^(stroke|truetype|barcode)$/.test(t.font) ? t.font : null);
  let h = t.h, w = t.w;
  if (tipo === 'truetype') { h = t.h * TT_ALTURA; w = t.h * TT_TRACO; }
  else if (!(w > 0)) w = t.h * TRACO_TEXTO;
  const rot = isNum(t.rot) ? t.rot : 0, esp = t.mirror ? -1 : 1;
  const out = [];
  const poe = (locais, ox, oy) => out.push(locais.map(q => { const g = gira(q[0] * esp, q[1], rot); return [ox + g[0], oy + g[1]]; }));
  const linhas = txt.split(/\r\n|\r|\n/);
  while (linhas.length > 1 && !linhas[linhas.length - 1].trim()) linhas.pop();
  let cx, ox, oy;
  if (linhas.length === 1) {
    for (const poly of HubFont.textPolylines(linhas[0], h)) poe(poly, t.x, t.y);
    const W = HubFont.textWidth(linhas[0], h);
    cx = [-W / 2 - w / 2, -h / 2 - w / 2, W / 2 + w / 2, h / 2 + w / 2]; ox = t.x; oy = t.y;
  } else {
    const n = linhas.length, passo = h * PASSO_LINHA;
    const larg = linhas.map(l => HubFont.textWidth(l, h)), W = Math.max.apply(null, larg);
    let ancora = isNum(t.ax) && isNum(t.ay);
    if (ancora) {
      const q = gira(t.x - t.ax, t.y - t.ay, -rot), lx = q[0] * esp, ly = q[1];
      if (lx < -h || lx > W + w + h || ly < -h || ly > (n - 1) * passo + h + w + h) ancora = false;
    }
    ox = ancora ? t.ax : t.x; oy = ancora ? t.ay : t.y;
    linhas.forEach((l, i) => {
      if (!l.trim()) return;
      const dx = ancora ? larg[i] / 2 + w : larg[i] / 2 - W / 2;
      const dy = ancora ? h / 2 - BASE_HUBFONT * h + w + (n - 1 - i) * passo : ((n - 1) / 2 - i) * passo;
      for (const poly of HubFont.textPolylines(l, h)) poe(poly.map(q => [q[0] + dx, q[1] + dy]), ox, oy);
    });
    cx = ancora ? [0, 0, W + 2 * w, (n - 1) * passo + h + 2 * w]
                : [-W / 2 - w / 2, -(n - 1) / 2 * passo - h / 2 - w / 2, W / 2 + w / 2, (n - 1) / 2 * passo + h / 2 + w / 2];
  }
  const caixa = [[cx[0], cx[1]], [cx[2], cx[1]], [cx[2], cx[3]], [cx[0], cx[3]]]
    .map(q => { const g = gira(q[0] * esp, q[1], rot); return [ox + g[0], oy + g[1]]; });
  return { polys:null, linhas:out, w, caixa, inv:!!t.inverted, h };
}

/* a caixa de um componente: a bbox do board.js transformada (retangulo girado, nao a caixa
   alinhada do effectiveBoard, que engorda o componente girado a 45 graus) */
function caixaComp(m){
  const b = m.src.bbox;
  if (!b || !isNum(b.x1) || !isNum(b.y1) || !isNum(b.x2) || !isNum(b.y2)) return null;
  const c = [[b.x1, b.y1], [b.x2, b.y1], [b.x2, b.y2], [b.x1, b.y2]];
  if (!m.changed) return c;
  const d = HC.compDelta(m);
  return c.map(p => { const q = HC.xfPoint(d, p[0], p[1]); return [q.x, q.y]; });
}

/* ============================== alvos de selecao ==============================
   alvo = o que a selecao guarda e o painel mostra:
     {t:'comp', m}                                   componente
     {t:'pad', comp, pad, eb}                        pad (de componente ou livre: comp null)
     {t:'track'|'arc'|'via'|'fill'|'region'|'text', m}  item do modelo (o texto pode ser o
                                                     designator/comment do componente)
     {t:'regiao-ro', eb, motivo}                     region so de desenho
     {t:'recorte', eb, m?}                           recorte da placa (m: o que o hub pos)
     {t:'ann', ann}                                  sinalizador
   Cada um tem uma CHAVE estavel: a selecao sobrevive ao recalculo (commit, desfazer). */
const opNum = new WeakMap(); let opSeq = 0;
function numDoOp(op){ if (!op) return 0; let n = opNum.get(op); if (!n) { n = ++opSeq; opNum.set(op, n); } return n; }
function chave(a){
  switch (a.t) {
    case 'comp': return 'c:' + a.m.src.ref;
    case 'pad': return (!a.comp && a.m && a.m.added) ? 'o:' + numDoOp(opDe(a.m)) : 'p:' + (a.comp ? a.comp.src.ref : '~') + ':' + (a.pad.id || a.pad.name);
    case 'ann': return 'n:' + a.ann.id;
    case 'cota': return 'm:' + a.cota.id;
    case 'regiao-ro': return 'g:' + a.eb.id;
    case 'recorte': return a.m ? 'o:' + numDoOp(opDe(a.m)) : 'k:' + a.eb.id;
    case 'semplano': return a.m ? 'o:' + numDoOp(opDe(a.m)) : 'q:' + a.eb.id;
    default: return a.m.added ? 'o:' + numDoOp(opDe(a.m)) : a.m.kind + ':' + a.m.src.id;
  }
}
let HITS = [], PORCHAVE = new Map(), ALVO_COMP = new Map();
const alvoAnn = new Map();
function annAlvo(a){ let x = alvoAnn.get(a); if (!x) { x = { t:'ann', ann:a }; alvoAnn.set(a, x); } return x; }
const alvoCota = new Map();
function cotaAlvo(c){ let x = alvoCota.get(c); if (!x) { x = { t:'cota', cota:c }; alvoCota.set(c, x); } return x; }
/* o que nao vai para o changes.js (sinalizador e cota): apagar e mexer nao pedem a edicao destravada */
const soNotas = lista => lista.length > 0 && lista.every(a => a.t === 'ann' || a.t === 'cota');
/* o tipo do Selection Filter de cada objeto */
function tipoFiltro(o, base){
  if (o && (o.keepout || o.layer === 'KeepOut')) return 'keepout';
  return base;
}
function montaAlvos(){
  HITS = []; PORCHAVE = new Map(); ALVO_COMP = new Map();
  const reg = a => { const k = chave(a); if (!PORCHAVE.has(k)) PORCHAVE.set(k, a); return PORCHAVE.get(k); };
  const push = (a, t, layer, bb, hit, prio, o) => { if (bb) HITS.push({ a, t, layer, bb, hit, prio, o }); };
  /* componentes e pads */
  model.comps.forEach((m, i) => {
    const a = reg({ t:'comp', m });
    ALVO_COMP.set(m, a);
    const caixa = caixaComp(m);
    if (caixa) push(a, 'comp', m.eff.layer === 'Bottom' ? 'Bottom' : 'Top', bbPts(caixa),
                    (x, y, tol) => dentroPoli(caixa, x, y) || pertoPoli(caixa, x, y, tol), 9, null);
    const ec = EB.components[i];
    /* a silhueta do 3D pega o componente inteiro (prio 10: perde para tudo, ate para a caixa de outro) */
    for (const q of silhuetasDe(ec)) push(a, 'comp', m.eff.layer === 'Bottom' ? 'Bottom' : 'Top', bbPts(q),
                    (x, y, tol) => dentroPoli(q, x, y) || pertoPoli(q, x, y, tol), 10, null);
    (ec && ec.pads || []).forEach((p, j) => {
      if (!p || !isNum(p.x) || !isNum(p.y)) return;
      const ap = reg({ t:'pad', comp:m, pad:(m.src.pads || [])[j] || p, eb:p });
      entradaPad(ap, p, push);
    });
  });
  for (const p of (EB.freepads || [])) {
    if (!p || !isNum(p.x) || !isNum(p.y)) continue;
    const mp = p.id != null ? IDX.item.get(String(p.id)) : null;
    entradaPad(reg({ t:'pad', comp:null, pad:p, eb:p, m:mp && mp.kind === 'pad' ? mp : null }), p, push);
  }
  /* o que tem dono seleciona o componente (como no Altium); o livre, ele mesmo */
  const doDono = o => { const mc = compDoDono(o.owner); return mc ? ALVO_COMP.get(mc) : null; };
  const doItem = o => { const m = IDX.item.get(String(o.id)); return m ? reg({ t:m.kind, m }) : null; };
  const linha = (o, isArc) => {
    if (!o || !isNum(isArc ? o.cx : o.x1)) return;
    const a = o.owner ? doDono(o) : doItem(o);
    if (!a) return;
    const t = o.owner ? 'comp' : tipoFiltro(o, isArc ? 'arc' : 'track');
    const w2 = (o.w > 0 ? o.w : 0) / 2;
    if (isArc) {
      const bb = [o.cx - o.r - w2, o.cy - o.r - w2, o.cx + o.r + w2, o.cy + o.r + w2];
      push(a, t, o.layer, bb, (x, y, tol) => {
        const d = Math.hypot(x - o.cx, y - o.cy);
        if (Math.abs(d - o.r) > w2 + tol) return false;
        return arcoCheio(o) || noArco(o.sa, o.ea, Math.atan2(y - o.cy, x - o.cx) / RAD);
      }, 3, o);
    } else {
      const bb = [Math.min(o.x1, o.x2) - w2, Math.min(o.y1, o.y2) - w2, Math.max(o.x1, o.x2) + w2, Math.max(o.y1, o.y2) + w2];
      push(a, t, o.layer, bb, (x, y, tol) => distSeg(x, y, o.x1, o.y1, o.x2, o.y2) <= w2 + tol, 3, o);
    }
  };
  for (const o of EB.tracks || []) linha(o, false);
  for (const o of EB.arcs || []) linha(o, true);
  for (const o of EB.silk || []) linha(o, o && o.kind === 'arc');
  for (const o of EB.lines || []) linha(o, o && o.kind === 'arc');
  for (const v of EB.vias || []) {
    if (!v || !isNum(v.x)) continue;
    const a = doItem(v); if (!a) continue;
    const r = (v.size || 0) / 2;
    push(a, 'via', 'Multi', [v.x - r, v.y - r, v.x + r, v.y + r], (x, y, tol) => Math.hypot(x - v.x, y - v.y) <= r + tol, 0, v);
  }
  for (const t of EB.texts || []) {
    const g = geoTexto(t); if (!g) continue;
    let a;
    if (t.designator || t.comment) a = doItem(t);
    else a = t.owner ? doDono(t) : doItem(t);
    if (!a) continue;
    const ft = (t.owner && !t.designator && !t.comment) ? 'comp' : 'text';
    push(a, ft, t.layer, bbPts(g.caixa), (x, y, tol) => dentroPoli(g.caixa, x, y) || pertoPoli(g.caixa, x, y, tol), 2, t);
  }
  for (const f of EB.fills || []) {
    if (!f || !isNum(f.x1)) continue;
    const a = f.owner ? doDono(f) : doItem(f); if (!a) continue;
    const c = fillCantos(f);
    push(a, f.owner ? 'comp' : tipoFiltro(f, 'fill'), f.layer, bbPts(c), (x, y, tol) => dentroPoli(c, x, y) || pertoPoli(c, x, y, tol), 4, f);
  }
  /* Polygon Pour: o contorno (a definicao) seleciona o poligono -- a borda ganha de quase tudo,
     o miolo perde -- e o cobre despejado dele (o do hub pelo `de`; o do Altium pela camada, net e
     contorno que o contem) tambem */
  const polyAlvo = new Map(), polys = [];
  for (const p of EB.polygons || []) {
    if (!p || !Array.isArray(p.pts) || p.pts.length < 3) continue;
    const m = IDX.item.get(String(p.id));
    if (!m || m.kind !== 'poly' || m.deleted) continue;
    const a = reg({ t:'poly', m }), pts = p.pts, bb = bbPts(pts);
    polyAlvo.set(String(p.id), a); polys.push({ p, a });
    push(a, 'poly', p.layer, bb, (x, y, tol) => pertoPoli(pts, x, y, tol), 4, p);
    push(a, 'poly', p.layer, bb, (x, y) => dentroPoli(pts, x, y), 8, p);
  }
  const polyDoCobre = g => {
    if (g.de != null) return polyAlvo.get(String(g.de)) || null;
    const q = g.points[0];
    const x = polys.find(({ p }) => p.layer === g.layer && (p.net || '') === (g.net || '') && dentroPoli(p.pts, q[0], q[1]));
    return x ? x.a : null;
  };
  /* o recorte de poligono ("sem plano"): o do hub edita; o do Altium so se ve */
  for (const k of EB.cutouts || []) {
    if (!k || k.kindn !== 1 || !Array.isArray(k.points) || k.points.length < 3) continue;
    const m = IDX.item.get(String(k.id));
    const a = reg(m && m.added ? { t:'semplano', eb:k, m } : { t:'semplano', eb:k }), pts = k.points;
    push(a, 'poly', k.layer || 'Multi', bbPts(pts), (x, y, tol) => pertoPoli(pts, x, y, tol) || dentroPoli(pts, x, y), 6, k);
  }
  for (const g of EB.regions || []) {
    if (!g || !Array.isArray(g.points) || g.points.length < 3) continue;
    let a = g.owner ? doDono(g) : doItem(g), t;
    const pg = !g.owner && g.poly ? polyDoCobre(g) : null;
    if (g.owner) t = 'comp';
    else if (pg) { a = pg; t = 'poly'; }
    else {
      t = g.keepout ? 'keepout' : g.poly ? 'poly' : 'region';
      if (!a) a = reg({ t:'regiao-ro', eb:g, motivo: g.poly ? 'pedaço de polígono despejado: o Altium redespeja — mexa no polígono lá'
                       : g.keepout ? 'keepout: fica só para desenho (remova no Altium)'
                       : 'espelho antigo (board.js sem "exporter"): não dá para saber se é livre, pedaço de polígono ou do componente — reexporte a placa' });
    }
    if (!a) continue;
    const pts = g.points, holes = Array.isArray(g.holes) ? g.holes : [];
    push(a, t, g.layer, bbPts(pts), (x, y, tol) => {
      if (pertoPoli(pts, x, y, tol)) return true;
      if (!dentroPoli(pts, x, y)) return false;
      return !holes.some(h => Array.isArray(h) && h.length > 2 && dentroPoli(h, x, y));
    }, 5, g);
  }
  for (const k of recortesDaTela()) {
    const pts = k.pts;
    const m = IDX.item.get(String(k.o.id));
    const a = reg(m && m.added ? { t:'recorte', eb:k.o, m } : { t:'recorte', eb:k.o });
    push(a, 'outros', '_placa', bbPts(pts), (x, y, tol) => dentroPoli(pts, x, y) || pertoPoli(pts, x, y, tol), 6, k.o);
  }
}
function entradaPad(ap, p, push){
  const f = formaLado(p, ladoDaVista()), c = centroCobre(p);
  const W = Math.max(f.w || 0, p.drill || 0), H = Math.max(f.h || 0, p.drill || 0);
  const rot = p.rot || 0, redondo = /^(circle|round)$/i.test(String(f.shape || '')) && Math.abs(W - H) < 1e-9;
  const r = Math.hypot(W, H) / 2;
  push(ap, 'pad', ehTH(p) ? 'Multi' : p.layer, [c[0] - r, c[1] - r, c[0] + r, c[1] + r], (x, y, tol) => {
    if (redondo) return Math.hypot(x - c[0], y - c[1]) <= W / 2 + tol;
    const q = gira(x - c[0], y - c[1], -rot);
    return Math.abs(q[0]) <= W / 2 + tol && Math.abs(q[1]) <= H / 2 + tol;
  }, 1, p);
}
/* Recortes da placa = a regra do hub-gerber.js (recortesDaPlaca): sai o recorte de poligono
   (kindn 1, ou o de camada de cobre no espelho antigo) e a regiao da placa (kindn -1); o resto
   passa pelo HubLaser.boardCutouts, que tira o do tamanho da placa. A tela mostra como furo o
   que o Gerber corta. Devolve [{o, pts}] (o: o recorte do EB). O roteador recebe os mesmos furos:
   a trilha fica longe do que a fabrica corta, e so disso. */
let recortesCache = null;
function recortesDe(eb){
  const lista = [];
  const bd = (eb.board && typeof eb.board === 'object') ? eb.board : {};
  for (const k of eb.cutouts || []) {
    if (!k || !Array.isArray(k.points) || k.points.length < 3) continue;
    if (isNum(k.kindn) && (k.kindn === -1 || k.kindn === 1)) continue;
    if (!isNum(k.kindn) && typeof k.layer === 'string' && (cobre(k.layer))) continue;
    const furos = (typeof HubLaser !== 'undefined')
      ? HubLaser.boardCutouts({ board:{ bbox:bd.bbox, outline:bd.outline || [] }, cutouts:[k] }) : [k.points];
    if (furos.length) lista.push({ o:k, pts:furos[0] });
  }
  return lista;
}
function recortesDaTela(){
  if (recortesCache && recortesCache.eb === EB) return recortesCache.lista;
  const lista = recortesDe(EB);
  recortesCache = { eb:EB, lista };
  return lista;
}

/* ============================== selecao ============================== */

let SEL = [];
const selTem = a => SEL.indexOf(a) >= 0;
function selSo(lista, dePainel){ SEL = (lista || []).filter(Boolean); aoMudarSel(dePainel); }
function selSoma(a){ if (a && !selTem(a)) SEL.push(a); aoMudarSel(); }
function selTira(a){ SEL = SEL.filter(x => x !== a); aoMudarSel(); }
function selLimpa(){ if (SEL.length) { SEL = []; aoMudarSel(); } }
/* resolve a selecao pelas chaves depois de um recalculo */
function reSeleciona(chaves){
  SEL = chaves.map(k => k.indexOf('n:') === 0 ? (ANN.find(a => 'n:' + a.id === k) ? annAlvo(ANN.find(a => 'n:' + a.id === k)) : null)
                      : k.indexOf('m:') === 0 ? (COTAS.find(c => 'm:' + c.id === k) ? cotaAlvo(COTAS.find(c => 'm:' + c.id === k)) : null)
                                              : PORCHAVE.get(k)).filter(Boolean);
}
let selChaveAntes = '';
function aoMudarSel(dePainel){
  if (modo3d && V3) V3.realca(refsDaSel());
  const ch = SEL.map(chave).join('|');
  const mudou = ch !== selChaveAntes;
  selChaveAntes = ch;
  pintaStatusSel();
  /* selecionar na tela leva o painel para Propriedades (como a ficha do Esquema); vindo de
     uma lista do proprio painel, ele fica onde a pessoa esta */
  if (painel) { if (mudou && SEL.length && !dePainel) painel.mostra('props'); painel.atualiza(); }
  pede();
}

/* ============================== caminhos (Path2D, em mm) ==============================
   Tudo que e cheio sai ANTI-HORARIO e todo furo HORARIO, e a pintura e nonzero: assim regions
   que se sobrepoem (teardrop sobre o pad, pedacos de poligono) somam em vez de se cancelar, e o
   furo de uma region (e o miolo de uma letra) continua furo. */
const area2 = pts => { let s = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]; return s; };
function pPoli(P, pts, horario){
  if (!pts || pts.length < 3) return;
  let q = pts;
  const a = area2(pts);
  if ((a < 0) !== !!horario) q = pts.slice().reverse();
  P.moveTo(q[0][0], q[0][1]);
  for (let i = 1; i < q.length; i++) P.lineTo(q[i][0], q[i][1]);
  P.closePath();
}
function pRoundRect(P, cx, cy, hw, hh, rot, r){
  const cantosR = [[hw - r, -hh + r, -90, 0], [hw - r, hh - r, 0, 90], [-hw + r, hh - r, 90, 180], [-hw + r, -hh + r, 180, 270]];
  let primeiro = true;
  for (const [lx, ly, a0, a1] of cantosR) {
    const c = gira(lx, ly, rot);
    const s = gira(lx + r * Math.cos(a0 * RAD), ly + r * Math.sin(a0 * RAD), rot);
    if (primeiro) { P.moveTo(cx + s[0], cy + s[1]); primeiro = false; } else P.lineTo(cx + s[0], cy + s[1]);
    if (r > 0) P.arc(cx + c[0], cy + c[1], r, (a0 + rot) * RAD, (a1 + rot) * RAD, false);
  }
  P.closePath();
}
/* a forma de um pad (ou fill), W x H inteiros, centrada e girada; radius so no roundrect */
function pForma(P, cx, cy, W, H, rot, shape, radius){
  if (!(W > 0) || !(H > 0) || !isNum(cx) || !isNum(cy)) return;
  const s = String(shape || 'rect').toLowerCase(), hw = W / 2, hh = H / 2;
  rot = isNum(rot) ? rot : 0;
  if ((s === 'circle' || s === 'round') && Math.abs(W - H) < 1e-9) { P.moveTo(cx + hw, cy); P.arc(cx, cy, hw, 0, 2 * Math.PI, false); P.closePath(); return; }
  if (s === 'circle' || s === 'round' || s === 'oval' || s === 'oblong' || s === 'obround') { pRoundRect(P, cx, cy, hw, hh, rot, Math.min(hw, hh)); return; }
  if (s === 'roundrect') {
    const r = Math.min(isNum(radius) ? radius : Math.min(W, H) / 8, Math.min(hw, hh));
    if (r > 0) { pRoundRect(P, cx, cy, hw, hh, rot, r); return; }
  }
  if (s === 'octagon') {
    const c = Math.min(hw, hh) * 0.4142;
    const L = [[-hw + c, -hh], [hw - c, -hh], [hw, -hh + c], [hw, hh - c], [hw - c, hh], [-hw + c, hh], [-hw, hh - c], [-hw, -hh + c]];
    pPoli(P, L.map(q => { const g = gira(q[0], q[1], rot); return [cx + g[0], cy + g[1]]; }));
    return;
  }
  pPoli(P, cantos(cx, cy, W, H, rot));
}
/* o furo do pad: redondo, retangular ou oblongo (drillw ao longo do X do pad), girado pela
   rotacao do pad + holerot (relativo ao pad, medido no CN1 do DMB -- como o Gerber faz) */
function pFuro(P, p){
  const d = p.drill;
  if (!(d > 0) || !isNum(p.x) || !isNum(p.y)) return;
  const forma = String(p.drillshape || 'circle').toLowerCase(), dw = p.drillw;
  const rot = (isNum(p.rot) ? p.rot : 0) + (isNum(p.holerot) ? p.holerot : 0);
  if ((forma === 'rect' || forma === 'square') && dw > 0) { pForma(P, p.x, p.y, dw, d, rot, 'rect'); return; }
  if ((forma === 'oblong' || forma === 'slot') && dw > 0) { pForma(P, p.x, p.y, dw, d, rot, 'oval'); return; }
  P.moveTo(p.x + d / 2, p.y); P.arc(p.x, p.y, d / 2, 0, 2 * Math.PI, false); P.closePath();
}
function pLinha(P, o){ P.moveTo(o.x1, o.y1); P.lineTo(o.x2, o.y2); }
function pArco(P, o){
  const a0 = o.sa * RAD, a1 = arcoCheio(o) ? a0 + 2 * Math.PI : o.ea * RAD;
  P.moveTo(o.cx + o.r * Math.cos(a0), o.cy + o.r * Math.sin(a0));
  P.arc(o.cx, o.cy, o.r, a0, a1, false);
}
function pRegiao(P, g){
  if (!Array.isArray(g.points) || g.points.length < 3) return;
  pPoli(P, g.points);
  for (const h of (Array.isArray(g.holes) ? g.holes : [])) if (Array.isArray(h) && h.length >= 3) pPoli(P, h, true);
}
function pTextoPolys(P, polys){ for (const q of polys) pPoli(P, q.pts, !!q.hole); }
function pPolilinha(P, pts){ if (!pts.length) return; P.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) P.lineTo(pts[i][0], pts[i][1]); }

/* ============================== cache por camada ==============================
   Cada camada vira uns poucos Path2D (os cheios e um por largura de traco): o DMB tem 2902
   linhas de silk, 310 trilhas e 392 fills, e redesenhar objeto a objeto a cada quadro do pan
   engasgava. O cache refaz so quando o modelo muda (commit) ou a vista vira; durante um
   arrasto, o que esta na mao sai do cache (EXCLUI) e e desenhado por cima a cada quadro. */
let CACHE = null, cacheSujo = true, EXCLUI = null;
function novaCam(){ return { cheios:new Path2D(), tracos:new Map(), kCheios:new Path2D(), kTracos:new Map(), inv:[], k:false }; }
function camC(k){ let c = CACHE.cam.get(k); if (!c) { c = novaCam(); CACHE.cam.set(k, c); } return c; }
function tracoEm(map, w){ const q = Math.max(1, Math.round((w > 0 ? w : 0) * 1e4)); let p = map.get(q); if (!p) { p = new Path2D(); map.set(q, p); } return p; }
/* todas: o cache completo (o 3D pinta as faces com ele). Sem, a 2D so cacheia as camadas a vista: camada
   escondida nao custa no refazer depois de cada edicao (o menu Camadas do canto) -- CACHE.vis diz com qual
   visibilidade ele foi montado, e o draw() refaz quando ela muda */
function montaCache(todas){
  CACHE = { cam:new Map(), furos:new Path2D(), vis:todas ? null : chaveVis() };
  const oculta = o => !todas && typeof o.layer === 'string' && !!LBYK[o.layer] && !camVisivel(o.layer);
  const pula = o => (EXCLUI && EXCLUI.has(o)) || oculta(o);
  for (const o of EB.tracks || []) if (o && !pula(o)) cacheLinha(o, false);
  for (const o of EB.arcs || []) if (o && !pula(o)) cacheLinha(o, true);
  for (const o of EB.silk || []) if (o && !pula(o)) cacheLinha(o, o.kind === 'arc');
  for (const o of EB.lines || []) if (o && !pula(o)) cacheLinha(o, o.kind === 'arc');
  for (const f of EB.fills || []) if (f && !pula(f)) cacheFill(f);
  for (const g of EB.regions || []) if (g && !pula(g)) cacheRegiao(g);
  for (const t of EB.texts || []) if (t && !pula(t)) cacheTexto(t);
  /* pad e via pintam varias camadas (cobre, mascara, pasta): ficam sempre */
  const naMao = o => EXCLUI && EXCLUI.has(o);
  for (const c of EB.components || []) for (const p of (c && c.pads) || []) if (p && !naMao(p)) cachePad(p);
  for (const p of EB.freepads || []) if (p && !naMao(p)) cachePad(p);
  for (const v of EB.vias || []) if (v && !naMao(v)) cacheVia(v);
  cacheSujo = false;
}
function linhaValida(o, isArc){
  return isArc ? (isNum(o.cx) && isNum(o.cy) && o.r > 0 && isNum(o.sa) && isNum(o.ea))
               : (isNum(o.x1) && isNum(o.y1) && isNum(o.x2) && isNum(o.y2));
}
function cacheLinha(o, isArc){
  if (typeof o.layer !== 'string' || !linhaValida(o, isArc)) return;
  const c = camC(o.layer);
  if (o.keepout) c.k = true;
  const P = tracoEm(o.keepout ? c.kTracos : c.tracos, o.w);
  if (isArc) pArco(P, o); else pLinha(P, o);
}
function cacheFill(f){
  if (typeof f.layer !== 'string' || ![f.x1, f.y1, f.x2, f.y2].every(isNum)) return;
  const c = camC(f.layer), cc = fillCentro(f);
  if (f.keepout) c.k = true;
  pForma(f.keepout ? c.kCheios : c.cheios, cc[0], cc[1], Math.abs(f.x2 - f.x1), Math.abs(f.y2 - f.y1), f.rot || 0, 'rect');
}
function cacheRegiao(g){
  if (typeof g.layer !== 'string') return;
  const c = camC(g.layer);
  if (g.keepout) c.k = true;
  pRegiao(g.keepout ? c.kCheios : c.cheios, g);
}
function cacheTexto(t){
  if (typeof t.layer !== 'string') return;
  const g = geoTexto(t);
  if (!g) return;
  const c = camC(t.layer);
  if (g.inv) { c.inv.push(g); return; }
  if (g.polys) { pTextoPolys(c.cheios, g.polys); return; }
  const P = tracoEm(c.tracos, g.w);
  for (const l of g.linhas) pPolilinha(P, l);
}
function cachePad(p){
  if (!isNum(p.x) || !isNum(p.y)) return;
  const cc = centroCobre(p);
  const raio = (f, e) => (String(f.shape || '').toLowerCase() === 'roundrect')
    ? (isNum(f.radius) ? f.radius : Math.min(f.w, f.h) / 8) + e : f.radius;
  if (ehTH(p)) {
    const f = formaLado(p, ladoDaVista());
    pForma(camC('Multi').cheios, cc[0], cc[1], f.w, f.h, p.rot, f.shape, f.radius);
    pFuro(CACHE.furos, p);
    for (const [lado, cam] of [['top', 'TopSolder'], ['bottom', 'BottomSolder']]) {
      if (tampado(p, lado)) continue;
      const fl = formaLado(p, lado), e = expMascara(p);
      pForma(camC(cam).cheios, cc[0], cc[1], fl.w + 2 * e, fl.h + 2 * e, p.rot, fl.shape, raio(fl, e));
    }
    return;
  }
  if (typeof p.layer !== 'string') return;
  const f = formaLado(p, 'top');
  pForma(camC(p.layer).cheios, cc[0], cc[1], f.w, f.h, p.rot, f.shape, f.radius);
  const lado = p.layer === 'Bottom' ? 'bottom' : p.layer === 'Top' ? 'top' : null;
  if (!lado) return;
  if (!tampado(p, lado)) {
    const e = expMascara(p);
    pForma(camC(lado === 'top' ? 'TopSolder' : 'BottomSolder').cheios, cc[0], cc[1], f.w + 2 * e, f.h + 2 * e, p.rot, f.shape, raio(f, e));
  }
  if (!(p.nopaste === true || (isNum(p.pm) && p.pm <= SEM_PASTA))) {
    const e = expPasta(p);
    if (f.w + 2 * e > 0 && f.h + 2 * e > 0)
      pForma(camC(lado === 'top' ? 'TopPaste' : 'BottomPaste').cheios, cc[0], cc[1], f.w + 2 * e, f.h + 2 * e, p.rot, f.shape, raio(f, e));
  }
}
function cacheVia(v){
  if (!isNum(v.x) || !isNum(v.y) || !(v.size > 0)) return;
  pForma(camC('Multi').cheios, v.x, v.y, v.size, v.size, 0, 'circle');
  if (v.drill > 0) { CACHE.furos.moveTo(v.x + v.drill / 2, v.y); CACHE.furos.arc(v.x, v.y, v.drill / 2, 0, 2 * Math.PI, false); CACHE.furos.closePath(); }
  for (const [lado, cam] of [['top', 'TopSolder'], ['bottom', 'BottomSolder']]) {
    if (tampado(v, lado)) continue;
    const d = v.size + 2 * expMascara(v);
    if (d > 0) pForma(camC(cam).cheios, v.x, v.y, d, d, 0, 'circle');
  }
}

/* ============================== ordem de desenho ==============================
   Opaco, como no Altium, e a camada ATUAL por ultimo (por cima de tudo). Do lado de la para o
   de ca: pasta, mascara, cobre e serigrafia de cada face -- a mascara POR BAIXO do cobre e o que
   deixa ver o anel roxo em volta do pad (o print do dono) --, as internas no meio, a Multi
   (pad passante e via) logo acima do cobre de ca, e as mecanicas e o keepout por cima. */
let ORDEM = [], ORDEM_IDX = Object.create(null);
function calculaOrdem(){
  const P = view.flip ? 'Top' : 'Bottom', Q = view.flip ? 'Bottom' : 'Top';
  const seq = [];
  const add = k => { if (LBYK[k] && seq.indexOf(k) < 0) seq.push(k); };
  add(P + 'Paste'); add(P + 'Solder'); add(P); add(P + 'Overlay');
  const internas = LAYERS.filter(l => (l.kind === 'signal' && l.key !== 'Top' && l.key !== 'Bottom') || l.kind === 'plane')
    .sort((a, b) => (a.num || 100 + a.order) - (b.num || 100 + b.order));
  if (!view.flip) internas.reverse();
  for (const l of internas) add(l.key);
  add('DrillGuide'); add('DrillDrawing');
  add(Q + 'Paste'); add(Q + 'Solder'); add(Q); add('Multi'); add(Q + 'Overlay');
  for (const l of LAYERS) if (l.kind === 'mech') add(l.key);
  add('KeepOut');
  for (const l of LAYERS) add(l.key);
  const i = seq.indexOf(cur);
  if (i >= 0) { seq.splice(i, 1); seq.push(cur); }
  ORDEM = seq;
  ORDEM_IDX = Object.create(null);
  seq.forEach((k, j) => { ORDEM_IDX[k] = j; });
}
function camVisivel(k){
  if (k === '_placa') return true;
  if (show.layers[k] === false) return false;
  if (!show.unica) return true;
  return k === cur || (k === 'Multi' && cobre(cur));
}

/* ============================== canvas ============================== */

const cv = $('cv'), ctx = cv.getContext('2d');
let DPR = 1, CW = 0, CHH = 0, agendado = 0;
function mede(){
  DPR = window.devicePixelRatio || 1;
  CW = cv.clientWidth; CHH = cv.clientHeight;
  const w = Math.max(1, Math.round(CW * DPR)), h = Math.max(1, Math.round(CHH * DPR));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
}
function pede(){ if (!agendado) agendado = requestAnimationFrame(draw); }
function transformaMundo(){
  const fx = view.flip ? -1 : 1;
  ctx.setTransform(DPR * view.scale * fx, 0, 0, -DPR * view.scale,
                   DPR * (CW / 2 - view.cx * view.scale * fx), DPR * (CHH / 2 + view.cy * view.scale));
}
function telaParaMundo(sx, sy){
  const fx = view.flip ? -1 : 1;
  return { x:(sx - CW / 2) / (view.scale * fx) + view.cx, y:(CHH / 2 - sy) / view.scale + view.cy };
}
function mundoParaTela(x, y){
  const fx = view.flip ? -1 : 1;
  return { x:CW / 2 + (x - view.cx) * view.scale * fx, y:CHH / 2 - (y - view.cy) * view.scale };
}
const px = n => n / view.scale;               /* n pixels de tela, em mm */

let pathPlacaCache = null;
/* os lacos fechados do contorno (o maior e a placa); sem contorno, o bbox. A tela pinta a placa
   com eles e o roteador os recebe como a borda: a mesma conta, uma placa so */
function lacosDe(eb){
  const segs = [];
  for (const s of ((eb.board && eb.board.outline) || [])) {
    if (!s) continue;
    if (s.kind === 'arc') { if ([s.cx, s.cy, s.r, s.sa, s.ea].every(isNum) && typeof HubLaser !== 'undefined') segs.push(HubLaser.arcPts(s.cx, s.cy, s.r, s.sa, s.ea)); }
    else if ([s.x1, s.y1, s.x2, s.y2].every(isNum)) segs.push([[s.x1, s.y1], [s.x2, s.y2]]);
  }
  const lacos = ((typeof HubLaser !== 'undefined' && HubLaser.chainSegments) ? HubLaser.chainSegments(segs) : segs).filter(l => l.length >= 3);
  if (lacos.length) return lacos;
  const bb = eb.board && eb.board.bbox;
  if (bb && [bb.x1, bb.y1, bb.x2, bb.y2].every(isNum)) return [[[bb.x1, bb.y1], [bb.x2, bb.y1], [bb.x2, bb.y2], [bb.x1, bb.y2]]];
  return [];
}
function pathPlaca(){
  if (pathPlacaCache) return pathPlacaCache;
  const P = new Path2D();
  for (const l of lacosDe(EB)) pPoli(P, l);
  for (const k of recortesDaTela()) pPoli(P, k.pts, true);
  pathPlacaCache = P;
  return P;
}

function desenhaGrade(){
  let passo = grade.mm, n = 0;
  while (passo * view.scale < 7 && n < 30) { passo *= (n % 2 === 0) ? 5 : 2; n++; }
  const a = telaParaMundo(0, 0), b = telaParaMundo(CW, CHH);
  const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
  const k0 = Math.floor(x1 / passo), k1 = Math.ceil(x2 / passo), j0 = Math.floor(y1 / passo), j1 = Math.ceil(y2 / passo);
  if (k1 - k0 > 600 || j1 - j0 > 600) return;
  const fino = new Path2D(), grosso = new Path2D();
  for (let k = k0; k <= k1; k++) { const P = (k % 10 === 0) ? grosso : fino; P.moveTo(k * passo, y1); P.lineTo(k * passo, y2); }
  for (let j = j0; j <= j1; j++) { const P = (j % 10 === 0) ? grosso : fino; P.moveTo(x1, j * passo); P.lineTo(x2, j * passo); }
  ctx.lineWidth = px(1);
  ctx.strokeStyle = COR.grade; ctx.stroke(fino);
  ctx.strokeStyle = COR.grade2; ctx.stroke(grosso);
}
/* a origem da placa (fica por cima da grade e fora do recorte dela) */
function desenhaOrigem(){
  const r = px(9);
  ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.moveTo(0, -r); ctx.lineTo(0, r);
  ctx.strokeStyle = COR.origem; ctx.lineWidth = px(1.2); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, r * 0.55, 0, 2 * Math.PI); ctx.stroke();
}

function pintaCamada(k){
  const c = CACHE.cam.get(k);
  if (!c) return;
  const cor = corDe(k), min = px(1);
  ctx.fillStyle = cor; ctx.strokeStyle = cor;
  ctx.fill(c.cheios);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const [q, P] of c.tracos) { ctx.lineWidth = Math.max(q / 1e4, min); ctx.stroke(P); }
  if (c.k) {
    /* keepout: translucido e tracejado -- e regra, nao cobre */
    ctx.save();
    ctx.globalAlpha = 0.35; ctx.fill(c.kCheios);
    ctx.globalAlpha = 0.9; ctx.setLineDash([px(6), px(4)]); ctx.lineWidth = px(1.2); ctx.stroke(c.kCheios);
    for (const [q, P] of c.kTracos) { ctx.lineWidth = Math.max(q / 1e4, min); ctx.stroke(P); }
    ctx.restore();
  }
  for (const g of c.inv) {
    /* texto invertido sem o contorno exato: a moldura cheia e as letras vazadas na cor da placa */
    const m = Math.max(g.w, g.h * 0.2) * 0.5, cx = g.caixa;
    const cxm = cx[0][0] + cx[2][0], cym = cx[0][1] + cx[2][1];
    const P = new Path2D();
    pPoli(P, cx.map(q => { const dx = q[0] - cxm / 2, dy = q[1] - cym / 2, L = Math.hypot(dx, dy) || 1; return [q[0] + dx / L * m, q[1] + dy / L * m]; }));
    ctx.fillStyle = cor; ctx.fill(P);
    const T = new Path2D(); for (const l of g.linhas) pPolilinha(T, l);
    ctx.strokeStyle = COR.placa; ctx.lineWidth = Math.max(g.w, min); ctx.stroke(T);
    ctx.strokeStyle = cor;
  }
}

/* O Polygon Pour como o Altium o mostra: o contorno do poligono tracejado na cor da camada (o
   cobre despejado ja esta no cache), e o recorte de poligono ("sem plano") hachurado -- na cor da
   camada, ou cinza quando vale para todas (Multi). O que esta na mao (EXCLUI) sai daqui. */
function desenhaPlanos(){
  const pula = o => EXCLUI && EXCLUI.has(o);
  for (const p of EB.polygons || []) {
    if (!p || pula(p) || !Array.isArray(p.pts) || p.pts.length < 3 || !camVisivel(p.layer)) continue;
    const P = new Path2D(); pPoli(P, p.pts);
    ctx.save(); ctx.strokeStyle = corDe(p.layer); ctx.globalAlpha = 0.95; ctx.setLineDash([px(6), px(3)]); ctx.lineWidth = px(1.3);
    ctx.stroke(P); ctx.restore();
  }
  for (const k of EB.cutouts || []) {
    if (!k || k.kindn !== 1 || pula(k) || !Array.isArray(k.points) || k.points.length < 3) continue;
    const multi = !k.layer || k.layer === 'Multi';
    if (multi ? !camadasCobre().some(l => camVisivel(l.key)) : !camVisivel(k.layer)) continue;
    hachura(k.points, multi ? COR.contorno : corDe(k.layer));
  }
}
function hachura(pts, cor){
  const P = new Path2D(); pPoli(P, pts);
  const bb = bbPts(pts); if (!bb) return;
  const alt = bb[3] - bb[1];
  let passo = px(9);
  if ((bb[2] - bb[0] + alt) / passo > 1500) passo = (bb[2] - bb[0] + alt) / 1500;
  const H = new Path2D();
  for (let c = bb[0] - alt; c <= bb[2]; c += passo) { H.moveTo(c, bb[1]); H.lineTo(c + alt, bb[3]); }
  ctx.save(); ctx.clip(P);
  ctx.strokeStyle = cor; ctx.globalAlpha = 0.5; ctx.lineWidth = px(1); ctx.setLineDash([]); ctx.stroke(H);
  ctx.restore();
  ctx.save(); ctx.strokeStyle = cor; ctx.globalAlpha = 0.95; ctx.setLineDash([px(5), px(3)]); ctx.lineWidth = px(1.3); ctx.stroke(P); ctx.restore();
}
function draw(){
  agendado = 0;
  if (!EB || !CW) return;
  if (cacheSujo || !CACHE || (CACHE.vis !== null && CACHE.vis !== chaveVis())) montaCache();
  calculaOrdem();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = COR.fundo; ctx.fillRect(0, 0, cv.width, cv.height);
  transformaMundo();
  ctx.fillStyle = COR.placa; ctx.fill(pathPlaca(), 'evenodd');
  /* a grade so na placa: fora dela e a area de trabalho cinza, como no Altium */
  if (show.grid) { ctx.save(); ctx.clip(pathPlaca(), 'evenodd'); desenhaGrade(); ctx.restore(); }
  desenhaOrigem();
  for (const k of ORDEM) if (camVisivel(k)) pintaCamada(k);
  desenhaPlanos();
  ctx.fillStyle = COR.furo; ctx.fill(CACHE.furos);
  ctx.strokeStyle = COR.contorno; ctx.lineWidth = px(1.3); ctx.setLineDash([]); ctx.stroke(pathPlaca());
  desenhaSilhuetas();
  desenhaRealce();
  desenhaConexoes();
  desenhaPreviaAuto();
  desenhaDrc();
  if (show.ghost) desenhaFantasmas();
  desenhaArrasto();
  desenhaSelecao();
  desenhaHover();
  desenhaAnotacoes();
  desenhaCotas();
  desenhaFerramenta();
  desenhaCursorAltium();
  desenhaJanela();
}
/* Preferences » General » Cursor Type: Small 90 e a cruz do sistema; Large 90 cruza a tela
   inteira; Small 45 e Tiny 45 sao o X do Altium */
function cursorFerramenta(){ return tool === 'medir' || PREFS.cursor === 'small45' || PREFS.cursor === 'tiny45' ? 'none' : 'crosshair'; }
/* A RETICULA DA REGUA (pedido do dono, 2026-10-29: "no Ctrl+M, quando não tem medida, a retícula
   some"). A cruz do sistema (Small 90) e preta no Windows e some no fundo preto da placa; longe de
   um agarre a regua nao desenhava nada. Com a regua na mao, a vista desenha a propria cruz no cursor,
   branca com contorno escuro (visivel na placa e na area cinza), sempre -- o marcador do agarre vem
   por cima, no ponto agarrado. */
function desenhaReticulaRegua(){
  /* na tela, alinhada ao pixel: linha de 1 px branca nitida sobre 3 px escuros */
  const s = mundoParaTela(cursorW.x, cursorW.y);
  const x = Math.round(s.x * DPR) + 0.5, y = Math.round(s.y * DPR) + 0.5;
  const r = Math.round(11 * DPR), g = Math.round(3 * DPR), lw = Math.max(1, Math.round(DPR));
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.setLineDash([]); ctx.lineCap = 'butt'; ctx.globalAlpha = 1;
  const cruz = () => {
    ctx.beginPath();
    ctx.moveTo(x - r, y); ctx.lineTo(x - g, y); ctx.moveTo(x + g, y); ctx.lineTo(x + r, y);
    ctx.moveTo(x, y - r); ctx.lineTo(x, y - g); ctx.moveTo(x, y + g); ctx.lineTo(x, y + r);
    ctx.stroke();
  };
  ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = lw * 3; cruz();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = lw; cruz();
  ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 0.5, y - 0.5, lw, lw);
  ctx.restore();
}
function desenhaCursorAltium(){
  if (tool === 'medir' && cursorW && !pan && (PREFS.cursor === 'small90' || !PREFS.cursor)) { desenhaReticulaRegua(); return; }
  if (tool === 'select' || !cursorW || PREFS.cursor === 'small90' || pan) return;
  const c = SNAP || cursorW;
  ctx.save(); ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = 0.9; ctx.lineWidth = px(1); ctx.setLineDash([]);
  ctx.beginPath();
  if (PREFS.cursor === 'large90') {
    const a = telaParaMundo(0, 0), b = telaParaMundo(CW, CHH);
    ctx.moveTo(Math.min(a.x, b.x), c.y); ctx.lineTo(Math.max(a.x, b.x), c.y);
    ctx.moveTo(c.x, Math.min(a.y, b.y)); ctx.lineTo(c.x, Math.max(a.y, b.y));
  } else {
    const r = px(PREFS.cursor === 'tiny45' ? 5 : 10);
    ctx.moveTo(c.x - r, c.y - r); ctx.lineTo(c.x + r, c.y + r); ctx.moveTo(c.x - r, c.y + r); ctx.lineTo(c.x + r, c.y - r);
  }
  ctx.stroke(); ctx.restore();
}

/* ============================== desenho avulso (fantasma, arrasto, previa) ============================== */

/* um objeto no formato do board.js, desenhado na hora (sem cache) */
function pathDoObj(kind, o){ const P = new Path2D(); pathEm(P, kind, o); return P; }
/* a geometria do objeto num Path2D que ja existe (as marcacoes em lote juntam muitos num so) */
function pathEm(P, kind, o){
  if (kind === 'track' || kind === 'line') pLinha(P, o);
  else if (kind === 'arc') pArco(P, o);
  else if (kind === 'fill') { const c = fillCentro(o); pForma(P, c[0], c[1], Math.abs(o.x2 - o.x1), Math.abs(o.y2 - o.y1), o.rot || 0, 'rect'); }
  else if (kind === 'region') pRegiao(P, o);
  else if (kind === 'via') pForma(P, o.x, o.y, o.size, o.size, 0, 'circle');
  else if (kind === 'pad') { const f = formaLado(o, ladoDaVista()), c = centroCobre(o); pForma(P, c[0], c[1], f.w, f.h, o.rot, f.shape, f.radius); }
}
const ehTraco = kind => kind === 'track' || kind === 'line' || kind === 'arc';
function desenhaObj(kind, o, cor, opt){
  opt = opt || {};
  ctx.save();
  if (opt.alpha != null) ctx.globalAlpha = opt.alpha;
  ctx.setLineDash(opt.dash ? [px(opt.dash[0]), px(opt.dash[1])] : []);
  ctx.strokeStyle = cor; ctx.fillStyle = cor; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (kind === 'text') {
    const g = geoTexto(o);
    if (g) {
      if (g.polys) { const P = new Path2D(); pTextoPolys(P, g.polys); if (opt.contorno) { ctx.lineWidth = px(1); ctx.stroke(P); } else ctx.fill(P); }
      else { const P = new Path2D(); for (const l of g.linhas) pPolilinha(P, l); ctx.lineWidth = Math.max(g.w, px(1)); ctx.stroke(P); }
    }
  } else {
    const P = pathDoObj(kind, o);
    if (ehTraco(kind)) { ctx.lineWidth = Math.max(opt.larg != null ? opt.larg : (o.w || 0), px(1)); ctx.stroke(P); }
    else if (opt.contorno) { ctx.lineWidth = px(opt.linha || 1.2); ctx.stroke(P); }
    else ctx.fill(P);
  }
  ctx.restore();
}
function seta(x1, y1, x2, y2){
  if (Math.hypot(x2 - x1, y2 - y1) < 1e-6) return;
  ctx.save();
  ctx.strokeStyle = COR.seta; ctx.globalAlpha = 0.75; ctx.lineWidth = px(1.3); ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  const a = Math.atan2(y2 - y1, x2 - x1), L = px(8);
  ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - L * Math.cos(a - 0.4), y2 - L * Math.sin(a - 0.4));
  ctx.moveTo(x2, y2); ctx.lineTo(x2 - L * Math.cos(a + 0.4), y2 - L * Math.sin(a + 0.4)); ctx.stroke();
  ctx.restore();
}
const kindDoItem = m => m.kind === 'track' ? 'track' : m.kind;
/* Diff: o original tracejado, o removido em vermelho, o adicionado com o contorno verde, e a
   seta do lugar de antes ate o de agora -- so o hub tem, e fica */
/* AS MARCACOES EM LOTE (pedido do dono, 2026-10-29: "o software no geral tá muito travado,
   principalmente com plano de terra"). Antes cada objeto mudado era desenhado sozinho a cada quadro
   (save/restore, tracejado, Path2D novo): numa placa com 3.000 linhas no changes.js eram 3.000
   desenhos por quadro, ate nas camadas escondidas. Agora os caminhos ficam prontos por estilo (cor,
   alfa, largura) e so se refazem quando a placa ou a visibilidade das camadas muda; camada
   escondida nao entra. A largura do traco e o tracejado (que dependem do zoom) entram na hora. */
let FANT = null;
function chaveVis(){ let s = (show.unica ? 'u:' + cur : '') + '|'; for (const l of LAYERS) if (camVisivel(l.key)) s += l.key + ','; return s; }
function montaFantasmas(){
  const grupos = new Map(), vias = [];
  const P = (chave, base) => { let x = grupos.get(chave); if (!x) { x = Object.assign({ P:new Path2D() }, base); grupos.set(chave, x); } return x.P; };
  for (const list of [model.tracks, model.arcs, model.vias, model.fills, model.regions]) {
    for (const m of list) {
      if (!m.src || (!m.changed && !m.deleted)) continue;
      const k = kindDoItem(m), lay = m.kind === 'via' ? 'Multi' : m.src.layer;
      if (lay && !camVisivel(lay)) continue;
      const cor = m.deleted ? COR.del : corDe(lay), alpha = m.deleted ? 0.8 : 0.6;
      /* o fantasma de trilha e fino: com a largura cheia ele pintava por cima da trilha nova */
      if (ehTraco(k)) { const w = r6(m.src.w || 0); pathEm(P('f|' + cor + '|' + alpha + '|' + w, { cor, alpha, dash:[5, 3], w, fator:0.3, min:1.5 }), k, m.src); }
      else pathEm(P('c|' + cor + '|' + alpha, { cor, alpha, dash:[5, 3], linha:1.2 }), k, m.src);
    }
  }
  for (const m of model.added) {
    const e = m.eff;
    const lay = m.kind === 'via' ? 'Multi' : e.layer;
    if (lay && LBYK[lay] && !camVisivel(lay)) continue;
    if (m.kind === 'via') { if (isNum(e.x) && isNum(e.y)) vias.push(e); }
    else if (m.kind === 'track' || m.kind === 'arc') { const w = r6(e.w || 0); pathEm(P('a|' + w, { cor:COR.add, alpha:1, dash:[4, 3], w, fator:0.3, min:1 }), m.kind, e); }
    else if (m.kind === 'fill' || m.kind === 'region') pathEm(P('ac', { cor:COR.add, alpha:1, dash:[4, 3], linha:1.2 }), m.kind, e);
    else if (m.kind === 'text') { const g = geoTexto(e); if (g) pPoli(P('at', { cor:COR.add, alpha:1, dash:[4, 3], linha:1 }), g.caixa); }
  }
  return { seq:ebSeq, vis:chaveVis(), layers:LAYERS, grupos:[...grupos.values()], vias };
}
function desenhaFantasmas(){
  if (!FANT || FANT.seq !== ebSeq || FANT.layers !== LAYERS || FANT.vis !== chaveVis()) FANT = montaFantasmas();
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const x of FANT.grupos) {
    ctx.globalAlpha = x.alpha; ctx.strokeStyle = x.cor;
    ctx.setLineDash([px(x.dash[0]), px(x.dash[1])]);
    ctx.lineWidth = x.fator ? Math.max(x.w * x.fator, px(x.min)) : px(x.linha);
    ctx.stroke(x.P);
  }
  if (FANT.vias.length) {
    /* a via nova: o anel 2,5 px por fora dela (depende do zoom: monta na hora, sao poucas) */
    const V = new Path2D();
    for (const e of FANT.vias) { const r = (e.size || 0) / 2 + px(2.5); V.moveTo(e.x + r, e.y); V.arc(e.x, e.y, r, 0, 2 * Math.PI); }
    ctx.globalAlpha = 1; ctx.strokeStyle = COR.add; ctx.setLineDash([px(4), px(3)]); ctx.lineWidth = px(1.2); ctx.stroke(V);
  }
  ctx.restore();
  for (const m of model.texts) {
    if (!m.src || (!m.changed && !m.deleted) || !camVisivel(m.src.layer)) continue;
    const e = ebDe(m);
    if (m.deleted) { desenhaObj('text', m.src, COR.del, { alpha:0.6 }); continue; }
    desenhaObj('text', Object.assign({}, m.src, { text: e ? e.text : m.src.text }), corDe(m.src.layer), { alpha:0.3 });
    if (e) seta(m.src.x, m.src.y, e.x, e.y);
  }
  for (const m of model.comps) {
    if (!m.changed) continue;
    const b = m.src.bbox;
    if (b && [b.x1, b.y1, b.x2, b.y2].every(isNum)) {
      ctx.save(); ctx.strokeStyle = corDe(m.src.layer === 'Bottom' ? 'Bottom' : 'Top'); ctx.globalAlpha = 0.55;
      ctx.setLineDash([px(6), px(4)]); ctx.lineWidth = px(1.2); ctx.strokeRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1); ctx.restore();
    }
    seta(m.src.x, m.src.y, m.eff.x, m.eff.y);
    const c = caixaComp(m);
    if (c) { const P = new Path2D(); pPoli(P, c); ctx.save(); ctx.strokeStyle = COR.seta; ctx.globalAlpha = 0.9; ctx.lineWidth = px(1.2); ctx.stroke(P); ctx.restore(); }
  }
  if (model.outlineChanged) {
    ctx.save(); ctx.strokeStyle = COR.seta; ctx.setLineDash([px(6), px(4)]); ctx.lineWidth = px(1.5);
    const P = new Path2D();
    for (const s of ((B.board && B.board.outline) || [])) if (s && s.kind === 'line') pLinha(P, s); else if (s && s.kind === 'arc') pArco(P, s);
    ctx.globalAlpha = 0.6; ctx.stroke(P); ctx.restore();
  }
}

/* a forma de destaque de um alvo (selecao e hover) */
function realcaAlvo(a, cor, forte){
  ctx.save();
  ctx.strokeStyle = cor; ctx.fillStyle = cor; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const contorno = P => { ctx.globalAlpha = forte ? 0.95 : 0.7; ctx.setLineDash(forte ? [px(5), px(3)] : []); ctx.lineWidth = px(1.4); ctx.stroke(P); };
  const veu = P => { ctx.globalAlpha = forte ? 0.22 : 0.12; ctx.fill(P); };
  const traco = (kind, o) => {
    const P = pathDoObj(kind, o);
    ctx.globalAlpha = forte ? 0.45 : 0.3; ctx.lineWidth = Math.max((o.w || 0) + px(4), px(3)); ctx.stroke(P);
  };
  const poli = pts => { const P = new Path2D(); pPoli(P, pts); veu(P); contorno(P); };
  switch (a.t) {
    case 'comp': { const c = caixaComp(a.m); if (c) poli(c); break; }
    case 'pad': { const P = pathDoObj('pad', a.eb); veu(P); contorno(P); break; }
    case 'track': case 'arc': { const o = ebDe(a.m); if (o) traco(a.t, o); break; }
    case 'via': { const o = ebDe(a.m); if (o) { const P = pathDoObj('via', { x:o.x, y:o.y, size:o.size + px(4) }); veu(P); contorno(P); } break; }
    case 'fill': { const o = ebDe(a.m); if (o) poli(fillCantos(o)); break; }
    case 'region': { const o = ebDe(a.m); if (o) { const P = new Path2D(); pRegiao(P, o); veu(P); contorno(P); } break; }
    case 'regiao-ro': { const P = new Path2D(); pRegiao(P, a.eb); veu(P); contorno(P); break; }
    case 'recorte': { const k = recortesDaTela().find(x => x.o === a.eb); if (k) poli(k.pts); break; }
    case 'poly': { const o = ebDe(a.m); if (o && o.pts) poli(o.pts); break; }
    case 'semplano': poli((a.m && ebDe(a.m)) ? ebDe(a.m).points : a.eb.points); break;
    case 'text': { const o = ebDe(a.m); const g = o && geoTexto(o); if (g) poli(g.caixa); break; }
    case 'ann': { const b = caixaBandeira(a.ann); const P = new Path2D(); P.rect(b[0], b[1], b[2] - b[0], b[3] - b[1]); veu(P); contorno(P); break; }
    case 'cota': break;              /* a cota se realca sozinha (desenhaCotas, com a cor da selecao) */
  }
  ctx.restore();
}
/* a bandeira inteira do sinalizador (o mastro sobe 1,6 x 14 px a partir do ponto): o clique nela
   pega o sinalizador -- antes so a base pegava, e o desenho em cima nao respondia (pedido do dono,
   2026-10-29: "o sinalizador eu consigo pôr mas não consigo tirar") */
function caixaBandeira(n){ const s = px(14); return [n.x - px(5), n.y - px(6), n.x + s * 1.1 + px(4), n.y + s * 1.6 + px(4)]; }

/* ---- as cotas da regua (hub-pcbcotas.js): o valor na unidade da vista ---- */
let FONTE_VISTA = null;
const fonteVista = () => FONTE_VISTA || (FONTE_VISTA = (getComputedStyle(document.body).fontFamily || 'sans-serif'));
function geoCota(c){ try { return HCOT ? HCOT.geometria(c) : null; } catch (e) { return null; } }
function textoCota(g){
  const v = fmtDist(g.valor) + ' ' + unidade;
  return g.modo === 'h' ? '↔ ' + v : g.modo === 'v' ? '↕ ' + v : v;
}
const opCota = (forte, cor) => ({ px, aTela:mundoParaTela, DPR, voltaMundo:transformaMundo, texto:textoCota, cor:cor || COR.medida, forte, fonte:fonteVista() });
function desenhaCotas(){
  if (!HCOT || !show.cotas || !COTAS.length) return;
  for (const c of COTAS) {
    const al = alvoCota.get(c), sel = !!al && selTem(al), hov = !!HOVER && HOVER.t === 'cota' && HOVER.cota === c;
    try { HCOT.desenha(ctx, geoCota(c), opCota(sel || hov, sel ? COR.sel : null)); } catch (e) { transformaMundo(); }
  }
}
function gravaCotas(){ gravaPref(COTAS_PREF, JSON.stringify(COTAS)); }
function setCotasVer(v){
  show.cotas = !!v;
  gravaPref('cotas.ver', show.cotas ? '1' : '0');
  if (!show.cotas && SEL.some(a => a.t === 'cota')) { SEL = SEL.filter(a => a.t !== 'cota'); aoMudarSel(); }
  if (HOVER && HOVER.t === 'cota') HOVER = null;
  pintaBarra(); if (painel) painel.atualiza(); pede();
}
function apagaCotas(){
  if (!COTAS.length) { HubDialog.toast('nenhuma cota na placa', 'info', 1600); return; }
  const n = COTAS.length;
  COTAS.splice(0, COTAS.length);
  if (SEL.some(a => a.t === 'cota')) { SEL = SEL.filter(a => a.t !== 'cota'); aoMudarSel(); }
  gravaCotas(); pintaBarra(); if (painel) painel.atualiza(); pede();
  HubDialog.toast(n + (n === 1 ? ' cota apagada' : ' cotas apagadas'), 'ok', 1800);
}
function desenhaSelecao(){
  if (arrasto && arrasto.moveu) return;           /* o que esta na mao ja aparece no lugar novo */
  for (const a of SEL) realcaAlvo(a, COR.sel, true);
  desenhaAlcas();
}
let HOVER = null;
function desenhaHover(){ if (HOVER && !selTem(HOVER) && tool === 'select' && !arrasto && !janela) realcaAlvo(HOVER, COR.sel, false); }

function desenhaAnotacoes(){
  for (const a of ANN) {
    if (a.view !== 'pcb' || !isNum(a.x) || !isNum(a.y)) continue;
    const c = ANN_COLORS[a.severity] || ANN_COLORS.info, s = px(14);
    ctx.save();
    ctx.setLineDash([]);
    ctx.globalAlpha = a.status === 'resolved' ? 0.45 : 1;
    ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = px(2.2); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x, a.y + s * 1.6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(a.x, a.y + s * 1.6); ctx.lineTo(a.x + s * 1.1, a.y + s * 1.25); ctx.lineTo(a.x, a.y + s * 0.9); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(a.x, a.y, px(2.5), 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

/* ============================== mudancas: commit, desfazer, refazer ============================== */

const undoStack = [JSON.stringify(CH)], redoStack = [];
/* o alvo da tela de um item do modelo (o que uma linha do changes.js fez) */
function alvoDoModelo(m){
  if (!m) return null;
  if (m.kind === 'comp') return ALVO_COMP.get(m) || null;
  const e = m.eff || {};
  const t = m.kind === 'region' && e.cutout ? 'recorte' : m.kind === 'region' && e.polycut ? 'semplano' : m.kind;
  return PORCHAVE.get(chave({ t, m })) || null;
}
let selDepois = null;              /* ops cujo objeto vira a selecao depois do proximo recalculo */
function reaplica(){
  const ks = SEL.map(chave), kh = HOVER && HOVER.t !== 'ann' ? chave(HOVER) : null;
  recalcula();
  reSeleciona(ks);
  HOVER = kh ? (PORCHAVE.get(kh) || null) : null;     /* o alvo velho apontaria para o modelo de antes */
  if (selDepois) {
    const alvos = [];
    for (const op of selDepois) {
      const it = model.changeItems.find(i => i.ch === op);
      const a = it ? alvoDoModelo(it.target) : null;
      if (a) alvos.push(a);
    }
    selDepois = null;
    if (alvos.length) SEL = alvos;
  }
  selChaveAntes = SEL.map(chave).join('|');
  if (painel) painel.atualiza();
  pintaAbas(); pintaStatusSel(); pintaBarra();
  pede();
}
function commit(){
  undoStack.push(JSON.stringify(CH));
  if (undoStack.length > 80) undoStack.shift();
  redoStack.length = 0;
  setChDirty(true);
  reaplica();
}
function restauraCH(json){
  CH.length = 0;
  for (const c of JSON.parse(json)) CH.push(c);
  setChDirty(true);
  reaplica();
}
function desfaz(){ if (undoStack.length < 2) return false; encerraDraft(true); redoStack.push(undoStack.pop()); restauraCH(undoStack[undoStack.length - 1]); return true; }
function refaz(){ if (!redoStack.length) return false; encerraDraft(true); const s = redoStack.pop(); undoStack.push(s); restauraCH(s); return true; }
function setChDirty(v){ chDirty = !!v; if (painel) painel.atualizaSalvar(); if (chDirty) autoSalva(); }
function setAnnDirty(v){ annDirty = !!v; if (painel) painel.atualizaSalvar(); if (annDirty) autoSalva(); }

/* ============================== escrever as ops ==============================
   Regra de sempre: um objeto PLANO por linha, orig_* copiados do board.js (a trava do
   ApplyChanges), e mexer de novo no mesmo objeto edita a MESMA linha em vez de empilhar
   outra -- o motor exige que a segunda op traga o orig_* do estado que a primeira deixou. Voltar
   o objeto ao lugar original tira a linha. */
const NOTA = 'editado no hub';
function ultimoOp(pred){ for (let i = CH.length - 1; i >= 0; i--) if (CH[i] && pred(CH[i])) return CH[i]; return null; }
const EDITA = {
  track: { op:'track_edit', orig:['x1', 'y1', 'x2', 'y2', 'w', 'layer'], campos:['x1', 'y1', 'x2', 'y2', 'w', 'layer', 'net'] },
  arc:   { op:'arc_edit',   orig:['cx', 'cy', 'r', 'sa', 'ea', 'layer'], campos:['cx', 'cy', 'r', 'sa', 'ea', 'w', 'layer'] },
  pad:   { op:'pad_edit',   orig:['x', 'y'], campos:['x', 'y', 'w', 'h', 'rot', 'shape', 'radius', 'drill', 'drillshape', 'drillw', 'holerot', 'net', 'name', 'layer'] },
  via:   { op:'via_edit',   orig:['x', 'y'], campos:['x', 'y', 'size', 'drill', 'from', 'to'] },
  fill:  { op:'fill_edit',  orig:['x1', 'y1', 'x2', 'y2', 'layer'], campos:['x1', 'y1', 'x2', 'y2', 'rot', 'layer', 'net'] },
  text:  { op:'text_edit',  orig:['x', 'y', 'text', 'layer'], campos:['text', 'x', 'y', 'h', 'w', 'rot', 'layer', 'mirror'] },
};
const CAMPOS_ADD = {
  track:['x1', 'y1', 'x2', 'y2', 'w', 'layer', 'net'], arc:['cx', 'cy', 'r', 'sa', 'ea', 'w', 'layer', 'net'],
  via:['x', 'y', 'size', 'drill', 'net', 'from', 'to'], fill:['x1', 'y1', 'x2', 'y2', 'rot', 'layer', 'net'],
  text:['text', 'x', 'y', 'h', 'w', 'rot', 'layer', 'mirror'], region:['layer', 'net'],
  pad:['x', 'y', 'w', 'h', 'rot', 'shape', 'radius', 'drill', 'drillshape', 'drillw', 'holerot', 'net', 'name', 'layer'],
};
const ANGULARES = { rot:1, sa:1, ea:1 };
function mesmoValor(k, a, b){
  if (k === 'net') return (a || '') === (b || '');
  if (k === 'from') return (a || 'Top') === (b || 'Top');        /* a via sem from/to e passante */
  if (k === 'to') return (a || 'Bottom') === (b || 'Bottom');
  if (k === 'mirror') return !!a === !!b;
  if (typeof a === 'number' && typeof b === 'number') return ANGULARES[k] ? nearAng(a, b) : near(a, b);
  if (k === 'rot' && (a === undefined || b === undefined)) return normAng(a || 0) === normAng(b || 0);
  return a === b;
}
/* objeto adicionado pelo hub: edita a propria linha *_add */
function patchAdd(op, kind, patch){
  for (const k of (CAMPOS_ADD[kind] || [])) if (k in patch) op[k] = patch[k];
  if (kind === 'region' && Array.isArray(patch.points)) op.pts = patch.points.map(p => [r6(p[0]), r6(p[1])]);
  if (kind !== 'pad' && op.layer && !cobre(op.layer)) delete op.net;
  if (op.net === '') delete op.net;
}
function editaItem(m, patch){
  if (m.added) { const op = opDe(m); if (op) patchAdd(op, m.kind, patch); return !!op; }
  const E = EDITA[m.kind];
  if (!E) return false;
  let c = ultimoOp(x => x.op === E.op && x.id === m.src.id);
  const novo = !c;
  if (novo) { c = { op:E.op, id:m.src.id }; for (const k of E.orig) c['orig_' + k] = m.src[k]; }
  for (const k of Object.keys(patch)) if (E.campos.indexOf(k) >= 0) c[k] = patch[k];
  if (m.kind !== 'pad' && !cobre(c.layer || m.src.layer)) delete c.net;
  if (c.net === '' && !m.src.net) delete c.net;
  /* voltou ao original (e a linha e a primeira desse objeto): sai do arquivo */
  const origDoSrc = E.orig.every(k => mesmoValor(k, c['orig_' + k], m.src[k]));
  const igual = E.campos.every(k => !(k in c) || mesmoValor(k, c[k], m.src[k]));
  if (origDoSrc && igual) { if (!novo) CH.splice(CH.indexOf(c), 1); return true; }
  if (novo) { c.note = NOTA; CH.push(c); }
  return true;
}
function moveComp(m, g){
  let c = ultimoOp(x => x.op === 'comp_move' && x.ref === m.src.ref);
  const novo = !c;
  if (novo) c = { op:'comp_move', ref:m.src.ref, x:0, y:0, rot:m.src.rot, layer:m.src.layer,
                  orig_x:m.src.x, orig_y:m.src.y, orig_rot:m.src.rot, orig_layer:m.src.layer };
  c.x = r6(g.x); c.y = r6(g.y); c.rot = normAng(g.rot); c.layer = g.layer === 'Bottom' ? 'Bottom' : 'Top';
  const origDoSrc = near(c.orig_x, m.src.x) && near(c.orig_y, m.src.y) && nearAng(c.orig_rot, m.src.rot) && c.orig_layer === m.src.layer;
  const volta = near(c.x, m.src.x) && near(c.y, m.src.y) && nearAng(c.rot, m.src.rot) && c.layer === m.src.layer;
  if (origDoSrc && volta) { if (!novo) CH.splice(CH.indexOf(c), 1); return; }
  if (novo) { c.note = NOTA; CH.push(c); }
}
/* O designator anda com o componente, e o ApplyChanges aplica as mudancas EM ORDEM: o
   designator_move vai ANTES do comp_move do mesmo componente, com x/y/rot no referencial de
   antes do componente andar (xfPointInv) -- e o que o motor exige (hubcore-api). */
function moveDesignator(m, g){
  const ref = m.src.owner, comp = ref != null ? model.compByRef[ref] : null;
  /* componente criado por comp_add: o designator dele vai na propria linha do comp_add (des_*),
     o Altium nao o tem no lugar que o hub sintetizou (1.36.0) */
  const d = comp && comp.changed ? HC.compDelta(comp) : null;
  const add = comp && comp.added ? ultimoOp(x => x.op === 'comp_add' && x.ref === ref) : null;
  if (add) {
    if (isNum(g.x) && isNum(g.y)) { const p = d ? HC.xfPointInv(d, g.x, g.y) : { x:g.x, y:g.y }; add.des_x = r6(p.x); add.des_y = r6(p.y); }
    if (isNum(g.rot)) add.des_rot = normAng(d ? (d.flip ? d.phi + 180 - g.rot : g.rot - d.dr) : g.rot);
    if (isNum(g.h) && g.h > 0) add.des_h = r6(g.h);
    return;
  }
  let c = ultimoOp(x => x.op === 'designator_move' && x.ref === ref);
  const novo = !c;
  if (novo) c = { op:'designator_move', ref, orig_x:m.src.x, orig_y:m.src.y };
  c.orig_x = m.src.x; c.orig_y = m.src.y;
  if (isNum(g.x) && isNum(g.y)) { const p = d ? HC.xfPointInv(d, g.x, g.y) : { x:g.x, y:g.y }; c.x = r6(p.x); c.y = r6(p.y); }
  else if (!isNum(c.x) || !isNum(c.y)) { c.x = r6(m.eff.x); c.y = r6(m.eff.y); }
  if (isNum(g.rot)) c.rot = normAng(d ? (d.flip ? d.phi + 180 - g.rot : g.rot - d.dr) : g.rot);
  if (isNum(g.h) && g.h > 0) c.h = r6(g.h);
  if (!novo) CH.splice(CH.indexOf(c), 1);
  const volta = near(c.x, m.src.x) && near(c.y, m.src.y) && (c.rot === undefined || nearAng(c.rot, m.src.rot || 0)) &&
                (c.h === undefined || near(c.h, m.src.h));
  if (volta) return;
  if (novo) c.note = 'designator no hub';
  const iMove = CH.findIndex(x => x && x.op === 'comp_move' && x.ref === ref);
  if (iMove >= 0) CH.splice(iMove, 0, c); else CH.push(c);
}
function attrComp(m, campo, valor){
  let c = ultimoOp(x => x.op === 'comp_attr' && x.ref === m.src.ref);
  const novo = !c;
  if (novo) c = { op:'comp_attr', ref:m.src.ref, orig_designator:m.src.ref, orig_comment:m.src.comment || '' };
  if (campo === 'designator') { const v = limpaTxt(valor).trim(); if (v && v !== m.src.ref) c.designator = v; else delete c.designator; }
  if (campo === 'comment') { const v = limpaTxt(valor); if (v !== (m.src.comment || '')) c.comment = v; else delete c.comment; }
  if (!c.designator && c.comment === undefined) { if (!novo) CH.splice(CH.indexOf(c), 1); return; }
  if (novo) { c.note = 'atributos no hub'; CH.push(c); }
}
/* region nao tem region_edit: mover ou trocar de camada e apagar e recriar (a do hub so
   reescreve a propria linha). Region com furo nao viaja assim -- o region_add nao leva furo. */
function editaRegiao(m, g){
  if (m.added) { const op = opDe(m); if (op) patchAdd(op, 'region', g); return !!op; }
  const s = m.src;
  /* cobre despejado do Altium sem poligono na placa (hub-core » orfa): so apagar */
  if (m.orfa) { HubDialog.toast('cobre despejado do Altium sem polígono na placa: dá só para apagar (Delete)', 'warn'); return false; }
  if (Array.isArray(s.holes) && s.holes.length) { HubDialog.toast('região com furo: o region_add não leva furo — mexa nela no Altium', 'warn'); return false; }
  const del = { op:'region_del', id:s.id, orig_layer:s.layer, orig_n:s.points.length, orig_x0:s.points[0][0], orig_y0:s.points[0][1], note:'movida no hub (apaga e recria)' };
  const lay = g.layer || s.layer;
  const add = { op:'region_add', layer:lay, pts:(g.points || s.points).map(p => [r6(p[0]), r6(p[1])]), note:'movida no hub' };
  const net = g.net !== undefined ? g.net : s.net;
  if (cobre(lay) && net) add.net = net;
  CH.push(del, add);
  (selDepois || (selDepois = [])).push(add);
  return true;
}
/* o Polygon Pour: o do hub reescreve a propria poly_add; o do espelho ganha UMA poly_edit (com os
   orig_* do board.js), e mexer de novo edita a mesma linha */
function editaPoly(m, patch){
  const P = Array.isArray(patch.pts) ? patch.pts.map(p => [r6(p[0]), r6(p[1])]) : null;
  if (m.added) {
    const op = opDe(m); if (!op) return false;
    if (P) op.pts = P;
    if (patch.layer) op.layer = patch.layer;
    if ('net' in patch) { if (patch.net) op.net = patch.net; else delete op.net; }
    return true;
  }
  const s = m.src;
  let c = ultimoOp(x => x.op === 'poly_edit' && x.id === s.id);
  const novo = !c;
  if (novo) c = { op:'poly_edit', id:s.id, orig_layer:s.layer, orig_n:s.pts.length, orig_x0:s.pts[0][0], orig_y0:s.pts[0][1] };
  if (P) c.pts = P;
  if (patch.layer) c.layer = patch.layer;
  if ('net' in patch) c.net = patch.net || '';
  if (novo) { c.note = NOTA; CH.push(c); }
  return true;
}
function apagaItem(m){
  if (m.added) { const op = opDe(m); if (!op) return false; CH.splice(CH.indexOf(op), 1); return true; }
  const s = m.src, kind = m.kind;
  for (let i = CH.length - 1; i >= 0; i--) { const c = CH[i]; if (c && c.id === s.id && c.op === kind + '_edit') CH.splice(i, 1); }
  const del = { op:kind + '_del', id:s.id };
  if (kind === 'track') Object.assign(del, { orig_x1:s.x1, orig_y1:s.y1, orig_x2:s.x2, orig_y2:s.y2, orig_w:s.w, orig_layer:s.layer });
  else if (kind === 'arc') Object.assign(del, { orig_cx:s.cx, orig_cy:s.cy, orig_r:s.r, orig_sa:s.sa, orig_ea:s.ea, orig_layer:s.layer });
  else if (kind === 'via') Object.assign(del, { orig_x:s.x, orig_y:s.y });
  else if (kind === 'fill') Object.assign(del, { orig_x1:s.x1, orig_y1:s.y1, orig_x2:s.x2, orig_y2:s.y2, orig_layer:s.layer });
  else if (kind === 'text') Object.assign(del, { orig_x:s.x, orig_y:s.y, orig_text:s.text, orig_layer:s.layer });
  else if (kind === 'region') Object.assign(del, { orig_layer:s.layer, orig_n:s.points.length, orig_x0:s.points[0][0], orig_y0:s.points[0][1] });
  else if (kind === 'pad') Object.assign(del, { orig_x:s.x, orig_y:s.y });
  else if (kind === 'poly') Object.assign(del, { orig_layer:s.layer, orig_n:s.pts.length, orig_x0:s.pts[0][0], orig_y0:s.pts[0][1] });
  else return false;
  del.note = 'removido no hub';
  CH.push(del);
  return true;
}
/* Delete: o que tem op de apagar sai; o resto diz por que fica */
function apagaSelecao(){
  if (!SEL.length) return;
  let n = 0, annMexeu = false, cotaMexeu = false;
  const fica = [];
  for (const a of SEL) {
    if (a.t === 'ann') { const i = ANN.indexOf(a.ann); if (i >= 0) { ANN.splice(i, 1); annMexeu = true; n++; } continue; }
    if (a.t === 'cota') { const i = COTAS.indexOf(a.cota); if (i >= 0) { COTAS.splice(i, 1); cotaMexeu = true; } continue; }
    if (a.t === 'comp') { fica.push(a.m.src.ref + ' (componente sai pelo esquema e o ECO)'); continue; }
    if (a.t === 'pad' && !a.m) { fica.push('pad ' + (a.comp ? (a.comp.eff.designator || a.comp.src.ref) + '.' : '') + (a.pad.name || '') + ' (é do componente: mude pelo footprint)'); continue; }
    if (a.t === 'regiao-ro') { fica.push('região: ' + a.motivo); continue; }
    if (a.t === 'recorte') { if (a.m && apagaItem(a.m)) n++; else fica.push('recorte do Altium (apague no Altium)'); continue; }
    if (a.t === 'semplano' && !a.m) { fica.push('recorte de polígono do Altium (apague no Altium)'); continue; }
    if (a.t === 'text' && a.m.src && (a.m.src.designator || a.m.src.comment || a.m.src.owner)) { fica.push('texto do componente ' + (a.m.src.owner || '')); continue; }
    if (a.m && apagaItem(a.m)) n++;
  }
  SEL = [];
  HOVER = null;
  if (cotaMexeu) { gravaCotas(); pintaBarra(); }
  if (annMexeu) annChanged();
  if (n) commit(); else { aoMudarSel(); pede(); }
  if (fica.length) HubDialog.toast('Não apagado: ' + fica.slice(0, 4).join('; ') + (fica.length > 4 ? ' …' : ''), 'warn', 5000);
}

/* ============================== geometria editavel de um alvo ==============================
   O "geo" e o alvo no referencial EFETIVO (o que a tela mostra): o arrasto, o giro e o
   espelho trabalham nele, e escreveGeo o devolve como op. */
function geoDe(a){
  switch (a.t) {
    case 'comp': return { x:a.m.eff.x, y:a.m.eff.y, rot:isNum(a.m.eff.rot) ? a.m.eff.rot : 0, layer:a.m.eff.layer };
    case 'track': { const e = a.m.eff; return { x1:e.x1, y1:e.y1, x2:e.x2, y2:e.y2 }; }
    case 'arc': { const e = a.m.eff; return { cx:e.cx, cy:e.cy, r:e.r, sa:e.sa, ea:e.ea }; }
    case 'via': return { x:a.m.eff.x, y:a.m.eff.y };
    case 'pad': return a.m ? { x:a.m.eff.x, y:a.m.eff.y } : null;
    case 'fill': { const e = a.m.eff; return { x1:e.x1, y1:e.y1, x2:e.x2, y2:e.y2, rot:isNum(e.rot) ? e.rot : 0 }; }
    case 'region': return { points:(a.m.eff.points || []).map(p => [p[0], p[1]]) };
    case 'recorte': case 'semplano': return a.m ? { points:(a.m.eff.points || []).map(p => [p[0], p[1]]) } : null;
    case 'poly': return { points:(a.m.eff.pts || []).map(p => [p[0], p[1]]) };
    case 'text': { const e = ebDe(a.m) || a.m.eff; return { x:e.x, y:e.y, rot:isNum(e.rot) ? e.rot : 0, mirror:!!e.mirror }; }
    case 'ann': return { x:a.ann.x, y:a.ann.y };
  }
  return null;
}
/* os alvos cuja geometria e um contorno de pontos (o geo leva `points`) */
const ehPts = t => t === 'region' || t === 'recorte' || t === 'poly' || t === 'semplano';
/* o ponto que a grade prende num arrasto */
function refDoGeo(t, g){
  if (!g) return null;
  if (t === 'track') return [g.x1, g.y1];
  if (t === 'arc') return [g.cx, g.cy];
  if (t === 'fill') return [Math.min(g.x1, g.x2), Math.min(g.y1, g.y2)];
  if (ehPts(t)) return g.points[0] ? [g.points[0][0], g.points[0][1]] : null;
  return [g.x, g.y];
}
function transladaGeo(t, g, dx, dy){
  const n = Object.assign({}, g);
  if (t === 'track') { n.x1 += dx; n.y1 += dy; n.x2 += dx; n.y2 += dy; }
  else if (t === 'arc') { n.cx += dx; n.cy += dy; }
  else if (t === 'fill') { n.x1 += dx; n.x2 += dx; n.y1 += dy; n.y2 += dy; }
  else if (ehPts(t)) n.points = g.points.map(p => [p[0] + dx, p[1] + dy]);
  else { n.x += dx; n.y += dy; }
  return n;
}
/* gira 90 graus anti-horario em volta do pivo */
function giraGeo(t, g, pv){
  const R = (x, y) => [pv[0] - (y - pv[1]), pv[1] + (x - pv[0])];
  const n = Object.assign({}, g);
  if (t === 'track') { const a = R(g.x1, g.y1), b = R(g.x2, g.y2); n.x1 = a[0]; n.y1 = a[1]; n.x2 = b[0]; n.y2 = b[1]; }
  else if (t === 'arc') { const c = R(g.cx, g.cy); n.cx = c[0]; n.cy = c[1]; if (!arcoCheio(g)) { n.sa = normAng(g.sa + 90); n.ea = normAng(g.ea + 90); } }
  else if (t === 'fill') {
    const c = R((g.x1 + g.x2) / 2, (g.y1 + g.y2) / 2), hw = Math.abs(g.x2 - g.x1) / 2, hh = Math.abs(g.y2 - g.y1) / 2;
    n.x1 = c[0] - hw; n.x2 = c[0] + hw; n.y1 = c[1] - hh; n.y2 = c[1] + hh; n.rot = normAng((g.rot || 0) + 90);
  }
  else if (ehPts(t)) n.points = g.points.map(p => R(p[0], p[1]));
  else { const p = R(g.x, g.y); n.x = p[0]; n.y = p[1]; if (t === 'comp' || t === 'text') n.rot = normAng((g.rot || 0) + 90); }
  return n;
}
/* espelha no eixo vertical ('x') ou horizontal ('y') que passa pelo pivo */
function espelhaGeo(t, g, eixo, pv){
  const M = (x, y) => eixo === 'x' ? [2 * pv[0] - x, y] : [x, 2 * pv[1] - y];
  const n = Object.assign({}, g);
  if (t === 'track') { const a = M(g.x1, g.y1), b = M(g.x2, g.y2); n.x1 = a[0]; n.y1 = a[1]; n.x2 = b[0]; n.y2 = b[1]; }
  else if (t === 'arc') {
    const c = M(g.cx, g.cy); n.cx = c[0]; n.cy = c[1];
    if (!arcoCheio(g)) { if (eixo === 'x') { n.sa = normAng(180 - g.ea); n.ea = normAng(180 - g.sa); } else { n.sa = normAng(-g.ea); n.ea = normAng(-g.sa); } }
  }
  else if (t === 'fill') {
    const c = M((g.x1 + g.x2) / 2, (g.y1 + g.y2) / 2), hw = Math.abs(g.x2 - g.x1) / 2, hh = Math.abs(g.y2 - g.y1) / 2;
    n.x1 = c[0] - hw; n.x2 = c[0] + hw; n.y1 = c[1] - hh; n.y2 = c[1] + hh; n.rot = normAng(-(g.rot || 0));
  }
  else if (ehPts(t)) n.points = g.points.map(p => M(p[0], p[1]));
  else if (t === 'text') { const p = M(g.x, g.y); n.x = p[0]; n.y = p[1]; n.mirror = !g.mirror; n.rot = normAng(eixo === 'x' ? -(g.rot || 0) : 180 - (g.rot || 0)); }
  else { const p = M(g.x, g.y); n.x = p[0]; n.y = p[1]; }
  return n;
}
/* L: o componente troca de face espelhando na vertical que passa pelo pivo (a placa vista
   pelo outro lado) -- a rotacao vira 180 - r, como o flip do Altium */
function viraGeo(g, pv){
  const n = Object.assign({}, g);
  n.x = 2 * pv[0] - g.x;
  n.layer = g.layer === 'Bottom' ? 'Top' : 'Bottom';
  n.rot = normAng(180 - (g.rot || 0));
  return n;
}
function escreveGeo(a, g){
  if (!g) return false;
  switch (a.t) {
    case 'comp': moveComp(a.m, g); return true;
    case 'track': return editaItem(a.m, { x1:r6(g.x1), y1:r6(g.y1), x2:r6(g.x2), y2:r6(g.y2) });
    case 'arc': {
      const p = { cx:r6(g.cx), cy:r6(g.cy) };
      if (!arcoCheio(g)) { p.sa = normAng(g.sa); p.ea = normAng(g.ea); }
      return editaItem(a.m, p);
    }
    case 'via': return editaItem(a.m, { x:r6(g.x), y:r6(g.y) });
    case 'pad': return a.m ? editaItem(a.m, { x:r6(g.x), y:r6(g.y) }) : false;
    case 'fill': return editaItem(a.m, { x1:r6(Math.min(g.x1, g.x2)), y1:r6(Math.min(g.y1, g.y2)), x2:r6(Math.max(g.x1, g.x2)), y2:r6(Math.max(g.y1, g.y2)), rot:normAng(g.rot || 0) });
    case 'region': return editaRegiao(a.m, { points:g.points });
    case 'recorte': case 'semplano': {
      if (!a.m) return false;
      const op = opDe(a.m); if (!op) return false;
      op.pts = g.points.map(p => [r6(p[0]), r6(p[1])]); return true;
    }
    case 'poly': return editaPoly(a.m, { pts:g.points });
    case 'text': {
      const s = a.m.src;
      if (s && s.designator) { moveDesignator(a.m, { x:g.x, y:g.y, rot:g.rot }); return true; }
      if (s && (s.comment || s.owner)) return false;
      return editaItem(a.m, { x:r6(g.x), y:r6(g.y), rot:normAng(g.rot), mirror:!!g.mirror });
    }
    case 'ann': a.ann.x = r6(g.x); a.ann.y = r6(g.y); annChanged(); return false;
  }
  return false;
}
/* o que pode andar: componente, trilha/arco/via/fill/region livres, recorte do hub, texto
   livre, designator e sinalizador. Pad arrasta o componente dele. */
function movivel(a){
  if (!a) return null;
  if (a.t === 'pad') return a.comp ? ALVO_COMP.get(a.comp) : (a.m && !a.m.deleted ? a : null);
  if (a.t === 'regiao-ro') return null;
  if (a.t === 'recorte' || a.t === 'semplano') return a.m ? a : null;
  if (a.t === 'text') { const s = a.m.src; if (s && s.comment) return null; if (s && s.owner && !s.designator) return null; }
  if (a.m && a.m.deleted) return null;
  return a;
}
/* o pivo do giro/espelho: o proprio ponto de um objeto so; o centro da selecao, na grade, de varios */
function pivoDe(alvos, bases){
  if (alvos.length === 1) {
    const a = alvos[0], g = bases.get(a);
    if (a.t === 'comp' || a.t === 'text' || a.t === 'via' || a.t === 'ann') return [g.x, g.y];
    if (a.t === 'arc') return [g.cx, g.cy];
    if (a.t === 'fill') return [(g.x1 + g.x2) / 2, (g.y1 + g.y2) / 2];
  }
  const pts = [];
  for (const a of alvos) {
    const g = bases.get(a); if (!g) continue;
    if (a.t === 'track') pts.push([g.x1, g.y1], [g.x2, g.y2]);
    else if (a.t === 'arc') pts.push([g.cx - g.r, g.cy - g.r], [g.cx + g.r, g.cy + g.r]);
    else if (a.t === 'fill') pts.push([g.x1, g.y1], [g.x2, g.y2]);
    else if (g.points) for (const p of g.points) pts.push(p);
    else pts.push([g.x, g.y]);
  }
  const bb = bbPts(pts);
  if (!bb) return [0, 0];
  return [snapV((bb[0] + bb[2]) / 2, grade.mm), snapV((bb[1] + bb[3]) / 2, grade.mm)];
}
/* Espaco/X/Y/L fora do arrasto: valem na selecao, uma mudanca so no desfazer */
function transformaSelecao(como){
  if (!garanteEdicao()) return false;
  const alvos = [];
  for (const a of SEL) { const m = movivel(a); if (m && alvos.indexOf(m) < 0) alvos.push(m); }
  if (!alvos.length) return false;
  if (como === 'vira' && !alvos.some(a => a.t === 'comp')) { HubDialog.toast('L vira de face só componente', 'info'); return false; }
  if ((como === 'x' || como === 'y') && alvos.every(a => a.t === 'comp')) { HubDialog.toast('componente não se espelha: L vira de face', 'info'); return false; }
  const bases = new Map(alvos.map(a => [a, geoDe(a)]));
  const pv = pivoDe(alvos, bases);
  const novas = new Map();
  for (const a of alvos) {
    let g = bases.get(a);
    if (como === 'gira') g = giraGeo(a.t, g, pv);
    else if (como === 'vira') { if (a.t !== 'comp') continue; g = viraGeo(g, pv); }
    else { if (a.t === 'comp') continue; g = espelhaGeo(a.t, g, como, pv); }
    novas.set(a, g);
  }
  /* girar/espelhar trilha ou via para cima de outra net tambem nao passa (editaConferindo); so o
     que de fato muda e conferido -- no L a trilha selecionada fica, e o componente nao se confere */
  const r = editaConferindo(Array.from(novas.keys()), () => {
    for (const [a, g] of novas) if (a.t !== 'ann') escreveGeo(a, g);
    return alvos.some(a => a.t !== 'ann');
  }, 'não deixa');
  if (r === null) { pede(); return true; }
  let annMexeu = false;
  for (const [a, g] of novas) if (a.t === 'ann') { annMexeu = true; escreveGeo(a, g); }
  if (r) commit(); else if (annMexeu) pede();
  return true;
}

/* ============================== copiar, colar, duplicar e alinhar ==============================
   O Edit do Altium: Ctrl+C copia a selecao com o ponto de referencia no cursor, Ctrl+V a traz
   presa ao cursor e um clique a larga (Esc desiste); duplicar e o Rubber Stamp (Ctrl+R no
   Altium, que no navegador recarrega a pagina): cada clique larga mais uma copia. Colar escreve
   ops de ADICAO (track_add, arc_add, via_add, fill_add, region_add, text_add) com a net de
   origem, como o Paste do Altium. Componente entra pelo ECO; designator, comment, pedaco de
   poligono e recorte do Altium nao se copiam.
   Alinhar e distribuir (Edit » Align) movem pelo mesmo escreveGeo do arrasto. */
let CLIP = null;           /* {itens:[{kind, o}], ref:[x, y], fora:[motivos]} */
function itemDeCopia(a){
  if (!a || !a.m || a.m.deleted) return null;
  if (['track', 'arc', 'via', 'fill', 'region', 'text'].indexOf(a.t) < 0) return null;
  const o = ebDe(a.m) || a.m.eff;
  if (!o) return null;
  if (a.t === 'text' && (o.designator || o.comment || o.owner)) return null;
  if (a.t === 'region' && (o.poly || o.cutout)) return null;
  return { kind:a.t, o:JSON.parse(JSON.stringify(o)) };
}
function bbItem(it){
  const o = it.o;
  if (it.kind === 'track') { const w = (o.w || 0) / 2; return [Math.min(o.x1, o.x2) - w, Math.min(o.y1, o.y2) - w, Math.max(o.x1, o.x2) + w, Math.max(o.y1, o.y2) + w]; }
  if (it.kind === 'arc') { const r = o.r + (o.w || 0) / 2; return [o.cx - r, o.cy - r, o.cx + r, o.cy + r]; }
  if (it.kind === 'via') { const r = (o.size || 0) / 2; return [o.x - r, o.y - r, o.x + r, o.y + r]; }
  if (it.kind === 'fill') return [Math.min(o.x1, o.x2), Math.min(o.y1, o.y2), Math.max(o.x1, o.x2), Math.max(o.y1, o.y2)];
  if (it.kind === 'region') return bbPts(o.points || []);
  if (it.kind === 'text') { const g = geoTexto(o); return g ? bbPts(g.caixa) : [o.x, o.y, o.x, o.y]; }
  return null;
}
function copiaSelecao(recortar){
  const itens = [], fora = [];
  for (const a of SEL) {
    if (a.t === 'comp') { fora.push(a.m.src.ref + ' (componente entra pelo ECO)'); continue; }
    const it = itemDeCopia(a);
    if (it) itens.push(it); else if (a.t !== 'ann' && a.t !== 'pad') fora.push(a.t === 'regiao-ro' ? 'região do Altium' : a.t);
  }
  if (!itens.length) { HubDialog.toast(SEL.length ? 'nada copiável na seleção' + (fora.length ? ': ' + fora.slice(0, 3).join('; ') : '') : 'selecione o que copiar', 'info', 3000); return false; }
  let ref;
  if (cursorW && !recortar) ref = [snapV(cursorW.x, grade.mm), snapV(cursorW.y, grade.mm)];
  else {
    const bb = itens.map(bbItem).filter(Boolean).reduce((s, b) => [Math.min(s[0], b[0]), Math.min(s[1], b[1]), Math.max(s[2], b[2]), Math.max(s[3], b[3])], [Infinity, Infinity, -Infinity, -Infinity]);
    ref = [snapV((bb[0] + bb[2]) / 2, grade.mm), snapV((bb[1] + bb[3]) / 2, grade.mm)];
  }
  CLIP = { itens, ref, fora };
  if (recortar) {
    if (!garanteEdicao()) return false;
    SEL = SEL.filter(a => itemDeCopia(a));
    apagaSelecao();
  }
  HubDialog.toast((recortar ? 'recortado' : 'copiado') + ': ' + itens.length + ' objeto(s)' + (fora.length ? ' — ficou de fora: ' + fora.slice(0, 3).join('; ') : ''), fora.length ? 'warn' : 'ok', 2600);
  return true;
}
/* as ops de adicao da copia deslocada de (dx, dy) */
function opsDaCopia(dx, dy){
  const ops = [], nota = 'colado no hub';
  const comNet = (op, o) => { if (o.net && cobre(op.layer)) op.net = o.net; return op; };
  for (const { kind, o } of CLIP.itens) {
    if (kind === 'track') ops.push(comNet({ op:'track_add', layer:o.layer, x1:r6(o.x1 + dx), y1:r6(o.y1 + dy), x2:r6(o.x2 + dx), y2:r6(o.y2 + dy), w:r6(o.w || CFG.wLinha), note:nota }, o));
    else if (kind === 'arc') ops.push(comNet({ op:'arc_add', layer:o.layer, cx:r6(o.cx + dx), cy:r6(o.cy + dy), r:r6(o.r), sa:r6(o.sa), ea:r6(o.ea), w:r6(o.w || CFG.wLinha), note:nota }, o));
    else if (kind === 'via') { const op = { op:'via_add', x:r6(o.x + dx), y:r6(o.y + dy), size:r6(o.size), drill:r6(o.drill), note:nota }; if (o.net) op.net = o.net; poeVao(op, o.from, o.to); ops.push(op); }
    else if (kind === 'fill') ops.push(comNet({ op:'fill_add', layer:o.layer, x1:r6(Math.min(o.x1, o.x2) + dx), y1:r6(Math.min(o.y1, o.y2) + dy), x2:r6(Math.max(o.x1, o.x2) + dx), y2:r6(Math.max(o.y1, o.y2) + dy), rot:r6(o.rot || 0), note:nota }, o));
    else if (kind === 'region') ops.push(comNet({ op:'region_add', layer:o.layer, pts:(o.points || []).map(p => [r6(p[0] + dx), r6(p[1] + dy)]), note:nota }, o));
    else if (kind === 'text') {
      const op = { op:'text_add', layer:o.layer, text:String(o.text || ''), x:r6(o.x + dx), y:r6(o.y + dy), h:r6(o.h || CFG.hTexto), rot:r6(o.rot || 0), note:nota };
      if (o.w > 0) op.w = r6(o.w);
      if (o.mirror) op.mirror = true;
      ops.push(op);
    }
  }
  return ops;
}
function comecaColar(multiplas){
  if (!CLIP || !CLIP.itens.length) { HubDialog.toast('a área de transferência está vazia (' + (teclaDe('copiar') || 'Ctrl+C') + ' copia)', 'info', 2400); return; }
  setTool('colar');
  draft = { tipo:'colar', multiplas:!!multiplas };
  avisoRodape(multiplas ? 'Duplicar: cada clique larga uma cópia; Esc ou botão direito termina' : 'Colar: clique onde largar (Esc desiste)');
  pede();
}
function duplicaSelecao(){ if (SEL.length && !copiaSelecao(false)) return; comecaColar(true); }
function colaNoPonto(w, ev){
  if (!CLIP || !draft || draft.tipo !== 'colar') { setTool('select'); return; }
  const p = snapPonto(w, ev, { soGrade:true });
  const ops = opsDaCopia(p.x - CLIP.ref[0], p.y - CLIP.ref[1]);
  if (!ops.length) return;
  for (const op of ops) CH.push(op);
  selDepois = ops.slice();
  const multiplas = draft.multiplas;
  commit();
  if (!multiplas) { setTool('select'); HubDialog.toast(ops.length + ' objeto(s) colado(s)', 'ok', 1800); }
  else draft = { tipo:'colar', multiplas:true };
}
function desenhaColagem(c){
  if (!CLIP) return;
  const dx = c.x - CLIP.ref[0], dy = c.y - CLIP.ref[1];
  for (const { kind, o } of CLIP.itens) {
    const n = JSON.parse(JSON.stringify(o));
    if (kind === 'track') { n.x1 += dx; n.x2 += dx; n.y1 += dy; n.y2 += dy; }
    else if (kind === 'arc') { n.cx += dx; n.cy += dy; }
    else if (kind === 'fill') { n.x1 += dx; n.x2 += dx; n.y1 += dy; n.y2 += dy; }
    else if (kind === 'region') n.points = (o.points || []).map(q => [q[0] + dx, q[1] + dy]);
    else { n.x += dx; n.y += dy; }
    desenhaObj(kind, n, kind === 'via' ? corDe('Multi') : corDe(o.layer), { alpha:0.55 });
  }
  ctx.save(); ctx.strokeStyle = COR.seta; ctx.lineWidth = px(1); ctx.beginPath();
  ctx.moveTo(c.x - px(8), c.y); ctx.lineTo(c.x + px(8), c.y); ctx.moveTo(c.x, c.y - px(8)); ctx.lineTo(c.x, c.y + px(8)); ctx.stroke(); ctx.restore();
}
/* a caixa de um alvo: a uniao das caixas que o hit-test usa (o componente: a caixa dele) */
function caixaDoAlvo(a){
  let bb = null;
  for (const h of HITS) if (h.a === a && h.bb) bb = bb ? [Math.min(bb[0], h.bb[0]), Math.min(bb[1], h.bb[1]), Math.max(bb[2], h.bb[2]), Math.max(bb[3], h.bb[3])] : h.bb.slice();
  return bb;
}
const ALINHA_ROT = {
  alinharEsq:'à esquerda', alinharDir:'à direita', alinharTopo:'pelo topo', alinharBase:'pela base',
  alinharCentroH:'pelos centros (horizontal)', alinharCentroV:'pelos centros (vertical)',
  distribuirH:'distribuídos na horizontal', distribuirV:'distribuídos na vertical',
};
function alinhaSelecao(modo){
  if (!garanteEdicao()) return false;
  const alvos = [];
  for (const a of SEL) { const m = movivel(a); if (m && m.t !== 'ann' && alvos.indexOf(m) < 0) alvos.push(m); }
  const distrib = /^distribuir/.test(modo);
  const cx = alvos.map(a => ({ a, bb:caixaDoAlvo(a), g:geoDe(a) })).filter(x => x.bb && x.g);
  if (cx.length < (distrib ? 3 : 2)) { HubDialog.toast(distrib ? 'distribuir pede 3 ou mais objetos selecionados' : 'alinhar pede 2 ou mais objetos selecionados', 'info', 2400); return false; }
  const desl = new Map();
  const min = i => Math.min(...cx.map(x => x.bb[i])), max = i => Math.max(...cx.map(x => x.bb[i]));
  if (modo === 'alinharEsq') { const v = min(0); for (const x of cx) desl.set(x, [v - x.bb[0], 0]); }
  else if (modo === 'alinharDir') { const v = max(2); for (const x of cx) desl.set(x, [v - x.bb[2], 0]); }
  else if (modo === 'alinharBase') { const v = min(1); for (const x of cx) desl.set(x, [0, v - x.bb[1]]); }
  else if (modo === 'alinharTopo') { const v = max(3); for (const x of cx) desl.set(x, [0, v - x.bb[3]]); }
  else if (modo === 'alinharCentroH') { const v = (min(1) + max(3)) / 2; for (const x of cx) desl.set(x, [0, v - (x.bb[1] + x.bb[3]) / 2]); }
  else if (modo === 'alinharCentroV') { const v = (min(0) + max(2)) / 2; for (const x of cx) desl.set(x, [v - (x.bb[0] + x.bb[2]) / 2, 0]); }
  else if (distrib) {
    /* como o Altium: os das pontas ficam, e o vao entre as caixas vizinhas fica igual */
    const i0 = modo === 'distribuirH' ? 0 : 1, i1 = i0 + 2;
    const ord = cx.slice().sort((p, q) => (p.bb[i0] + p.bb[i1]) - (q.bb[i0] + q.bb[i1]));
    const ocup = ord.reduce((s, x) => s + (x.bb[i1] - x.bb[i0]), 0);
    const vao = (ord[ord.length - 1].bb[i1] - ord[0].bb[i0] - ocup) / (ord.length - 1);
    let pos = ord[0].bb[i0];
    for (const x of ord) { const d = pos - x.bb[i0]; desl.set(x, i0 === 0 ? [d, 0] : [0, d]); pos += (x.bb[i1] - x.bb[i0]) + vao; }
  } else return false;
  const novas = new Map();
  for (const [x, d] of desl) if (Math.abs(d[0]) > 1e-9 || Math.abs(d[1]) > 1e-9) novas.set(x.a, transladaGeo(x.a.t, x.g, r6(d[0]), r6(d[1])));
  if (!novas.size) { HubDialog.toast('já estão ' + (ALINHA_ROT[modo] || 'alinhados'), 'info', 1800); return true; }
  const r = editaConferindo(Array.from(novas.keys()), () => { for (const [a, g] of novas) escreveGeo(a, g); return true; }, 'não alinha');
  if (r === null) { pede(); return true; }
  if (r) { commit(); HubDialog.toast(novas.size + ' objeto(s) ' + (ALINHA_ROT[modo] || ''), 'ok', 1800); }
  return true;
}

/* ============================== linhas de conexao e realce de net ==============================
   O Show Connections do Altium: o que falta ligar em cada net, pela arvore minima entre as ilhas de
   cobre (HubPcbNets.conexoes, o modo Shortest), em linha fina que nao engrossa com o zoom. Ctrl+clique
   num cobre realca a net dele (escurece o resto, como o mascaramento do Altium); Esc limpa. */
function conexoesLigadas(){ if (verConexoes === null) verConexoes = lePref('conexoes', '1') !== '0'; return verConexoes; }
function toggleConexoes(){
  verConexoes = !conexoesLigadas(); gravaPref('conexoes', verConexoes ? '1' : '0'); pede();
  const r = verConexoes ? conexoes() : null;
  HubDialog.toast(verConexoes ? 'linhas de conexão ligadas' + (r ? ' — ' + r.linhas.length + ' ligação(ões) por fazer' : '') : 'linhas de conexão desligadas', 'info', 2200);
}
function conexoes(){
  if (!HN || !EB) return null;
  if (!CONEX || CONEX.eb !== EB) { let r = null; try { r = HN.conexoes(EB); } catch (e) { console.warn('conexões:', e); } CONEX = { eb:EB, r }; }
  return CONEX.r;
}
function desenhaConexoes(){
  if (!conexoesLigadas()) return;
  const r = conexoes(); if (!r || !r.linhas || !r.linhas.length) return;
  ctx.save(); ctx.strokeStyle = COR.conexao; ctx.lineWidth = px(1); ctx.setLineDash([]); ctx.globalAlpha = 0.9;
  ctx.beginPath();
  for (const l of r.linhas) { if (REALCE && l.net !== REALCE.net) continue; ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); }
  ctx.stroke(); ctx.restore();
}
function realcaNet(net){
  if (!HN || !net) { limpaRealce(); return; }
  let o = null; try { o = HN.objetosDaNet(EB, net); } catch (e) { console.warn('realce:', e); }
  REALCE = { net, ids:new Set(((o && o.ids) || []).map(String)) };
  avisoRodape('net ' + net + ': ' + REALCE.ids.size + ' objeto(s) — Esc limpa');
  pede();
}
function limpaRealce(){ if (!REALCE) return false; REALCE = null; avisoRodape(''); pede(); return true; }
function realcaNetEm(w){
  if (!HN) { HubDialog.toast('realce de net: o hub-pcbnets.js não carregou nesta página', 'warn'); return; }
  let r = null; try { r = HN.netEm(EB, null, w.x, w.y); } catch (e) { console.warn('realce:', e); }
  if (!r || !r.net) { limpaRealce(); return; }
  realcaNet(r.net);
}
function desenhaRealce(){
  if (!REALCE) return;
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = 'rgba(0,0,0,0.62)'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.restore();
  const tem = o => o && o.id != null && REALCE.ids.has(String(o.id));
  const pinta = (kind, o) => {
    const lay = (kind === 'via' || (kind === 'pad' && ehTH(o))) ? 'Multi' : o.layer;
    if (!camVisivel(lay)) return;
    desenhaObj(kind, o, corDe(lay), {});
    if (!ehTraco(kind)) desenhaObj(kind, o, '#ffffff', { contorno:true, linha:1, alpha:0.85 });
  };
  for (const o of EB.regions || []) if (tem(o)) pinta('region', o);
  for (const o of EB.fills || []) if (tem(o)) pinta('fill', o);
  for (const o of EB.tracks || []) if (tem(o)) pinta('track', o);
  for (const o of EB.arcs || []) if (tem(o)) pinta('arc', o);
  for (const o of EB.vias || []) if (tem(o)) pinta('via', o);
  for (const c of EB.components || []) for (const o of (c && c.pads) || []) if (tem(o)) pinta('pad', o);
  for (const o of EB.freepads || []) if (tem(o)) pinta('pad', o);
}
/* Tools » Teardrops: os que faltam (onde a trilha e mais fina que o pad/via e ainda nao ha
   teardrop) entram como region_add -- o Gerber e o Altium os recebem como regiao de cobre */
function poeTeardrops(){
  if (!HTD) { HubDialog.toast('teardrops: o hub-pcbteardrop.js não carregou nesta página', 'warn'); return; }
  if (!garanteEdicao()) return;
  let novos = [];
  try {
    const pula = new Set((HTD.reconhece(EB) || []).map(t => (t.de && t.de.id) + '|' + t.trilha + '|' + t.layer));
    novos = HTD.gera(EB, { pula }) || [];
  } catch (e) { console.warn('teardrops:', e); HubDialog.toast('teardrops: ' + (e && e.message || e), 'err'); return; }
  if (!novos.length) { HubDialog.toast('nenhum teardrop por pôr: todo pad e via com trilha mais fina já tem o seu', 'info', 2600); return; }
  const ops = novos.map(g => ({ op:'region_add', layer:g.layer, net:g.net || '', pts:g.points.map(q => [r6(q[0]), r6(q[1])]), note:'teardrop do hub' }));
  for (const op of ops) { if (!op.net) delete op.net; CH.push(op); }
  commit();
  HubDialog.toast(ops.length + ' teardrop(s) postos', 'ok', 2400);
}

/* ============================== Auto-rotear (Route » Auto Route » All, U,A,A) ==============================
   Pedido do dono (2026-10-28): o auto-roteador em lote na vista, como o Auto Route » All do Altium. A
   conta é a do hub-autoroteador.js (várias camadas, vias, ordem e arranca-e-refaz), com as regras do
   projeto — as mesmas do DRC e da Trilha —, num worker (hub-autoroteador-worker.js) para a vista não
   travar; a conversa (o pedido, o progresso com Cancelar, a prévia com Aplicar/Descartar) é do
   hub-pcbautorota.js. Aqui só se liga: a placa da tela, a prévia desenhada por cima do cobre e o
   Aplicar como uma edição da vista (CH + commit: o Ctrl+Z desfaz, o Salvar e o autosave gravam o
   changes.js como qualquer outra edição). */
const HAR = (typeof HubAutoRoteador !== 'undefined' && HubAutoRoteador && typeof HubAutoRoteador.lote === 'function') ? HubAutoRoteador : null;
let PREVIA_AUTO = null;
/* a geometria dos textos de cobre (a do Gerber): o worker não recebe função, recebe a forma pronta */
function textosDeCobre(){
  const out = {};
  if (typeof HubGerber === 'undefined' || typeof HubGerber.geometriaTexto !== 'function') return out;
  for (const t of EB.texts || []) {
    if (!t || t.hidden || t.id == null || !cobre(t.layer)) continue;
    try { const g = HubGerber.geometriaTexto(t); if (g) out[t.id] = g; } catch (e) { /* sem forma: fica de fora, como na cena da vista */ }
  }
  return out;
}
/* as nets do que está selecionado: pad, cobre com net e os pads dos componentes */
function netsDaSel(){
  const S = new Set();
  for (const a of SEL) {
    if (a.t === 'pad') { if (a.eb && a.eb.net) S.add(a.eb.net); }
    else if (a.t === 'comp') {
      const c = a.m ? IDX.ebComp.get(a.m) : null;
      for (const p of (c && c.pads) || []) if (p.net) S.add(p.net);
    } else if (a.m && a.m.eff && a.m.eff.net) S.add(a.m.eff.net);
  }
  return [...S].sort();
}
function abreAutorotear(escopo, extra){
  if (!HAR || !HR || !HN || typeof HubPcbAutoRota === 'undefined') {
    HubDialog.toast('auto-rotear: o hub-autoroteador.js (ou o hub-pcbautorota.js) não carregou nesta página — atualize com F5', 'warn');
    return null;
  }
  if (!garanteEdicao()) return null;
  encerraDraft(true);
  const x = extra || {};
  return HubPcbAutoRota.abre({
    eb:() => EB, regras:() => regrasAtuais() || null,
    cena:() => { const o = opcoesCena(EB); return { placa:o.placa, clearance:o.clearance }; },
    textos:textosDeCobre,
    camadas:() => LAYERS.filter(l => l.kind === 'signal').map(l => ({ key:l.key, rot:rotuloAba(l), cor:l.color })),
    selNets:netsDaSel,
    abertas:() => { try { const n = HN.naoRoteadas(EB); return { conexoes:n.conexoes, nets:n.total }; } catch (e) { return null; } },
    previa:ops => { PREVIA_AUTO = ops && ops.length ? HAR.previa(ops) : null; pede(); },
    foto:() => JSON.stringify(CH),
    aplica:ops => {
      if (!garanteEdicao()) return false;
      for (const op of ops) CH.push(Object.assign({}, op));
      commit();
      return true;
    },
    toast:(t, tipo, ms) => HubDialog.toast(t, tipo || 'info', ms),
    worker:'worker' in x ? x.worker : 'hub-autoroteador-worker.js',
    escopo:escopo || 'todas',
  });
}
/* a prévia: as trilhas e vias que o Aplicar escreveria, na cor da camada com o contorno verde das
   adições (o das marcações das mudanças), por cima do cobre */
function desenhaPreviaAuto(){
  if (!PREVIA_AUTO) return;
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash([]);
  for (const t of PREVIA_AUTO.tracks) {
    if (!camVisivel(t.layer)) continue;
    ctx.beginPath(); ctx.moveTo(t.x1, t.y1); ctx.lineTo(t.x2, t.y2);
    ctx.globalAlpha = 0.55; ctx.strokeStyle = COR.add; ctx.lineWidth = t.w + px(3); ctx.stroke();
    ctx.globalAlpha = 0.95; ctx.strokeStyle = corDe(t.layer); ctx.lineWidth = Math.max(t.w, px(1)); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (const v of PREVIA_AUTO.vias) {
    ctx.beginPath(); ctx.arc(v.x, v.y, v.size / 2 + px(1.5), 0, 2 * Math.PI); ctx.fillStyle = COR.add; ctx.fill();
    ctx.beginPath(); ctx.arc(v.x, v.y, v.size / 2, 0, 2 * Math.PI); ctx.fillStyle = '#c9c9c9'; ctx.fill();
    ctx.beginPath(); ctx.arc(v.x, v.y, v.drill / 2, 0, 2 * Math.PI); ctx.fillStyle = COR.furo; ctx.fill();
  }
  ctx.restore();
}

/* ============================== PDF de layout ==============================
   O dialogo (hub-pcbpdfui.js) recebe a placa EFETIVA de agora -- a mesma da tela e do Gerber,
   com as mudancas nao salvas e os teardrops refeitos -- e grava em Projects/<p>/PDF/ (/api/pdf). */
function abrePdf(){
  fechaMenu();
  if (LEAN) return;
  if (typeof HubPcbPdfUi === 'undefined' || typeof HubPcbPdf === 'undefined') {
    HubDialog.alert('O gerador de PDF (hub-pcbpdf.js) não carregou nesta página. Atualize o hub (F5); se continuar, o arquivo não chegou nesta instalação.', { title:'PDF de layout' });
    return;
  }
  HubPcbPdfUi.abrir({ placa:() => EB, projeto:PROJ, podeSalvar:HubIO.canPost && !!PROJ, sujo:chDirty });
}

/* ============================== placa nova, ECO, pad avulso e polygon pour ==============================
   O que faz placa nascer no hub (pedido do dono: "fazer placa do zero sem o Altium"):
   - Design » Update PCB (o ECO): hub-pcbeco.js compara o schematic.js com a placa e o dialogo do
     hub-pcbeco-ui.js devolve as linhas (comp_add, net_add, pad_net...) que entram no changes.js;
   - File » New » PCB (o Board Wizard da casa): hub-pcbnova.js gera o board.js MESTRE e a rota
     /api/board-novo (tools/rotas/board_novo.py) cria o projeto;
   - Place » Pad: pad_add passante redondo (o padrao do Altium: 60 mil, furo 30 mil);
   - Place » Polygon Pour: o poligono (poly_add) e despejado pelo hub-pcbpour.js na tela, no
     Gerber e no PDF -- so o que o hub definiu; o cobre que veio despejado do Altium fica como
     veio. O despejo fica guardado pela assinatura do que o afeta: editar longe nao redespeja. */
const HPP = (typeof HubPcbPour !== 'undefined' && HubPcbPour && typeof HubPcbPour.despeja === 'function') ? HubPcbPour : null;
const despejoCache = new Map();      /* id do poligono -> {hash, regioes} */
function comDespejo(eb){
  const pols = (eb.polygons || []).filter(p => p && p.id && p.pour !== 'none' && Array.isArray(p.pts) && p.pts.length >= 3);
  if (!HPP || !pols.length) return eb;
  const ids = new Set(pols.map(p => String(p.id)));
  let novas = [];
  try {
    /* a folga por classe das regras do projeto entra no poligono so para despejar (1.36.0); a placa
       da tela fica com o poligono como esta no arquivo */
    const ebR = typeof HPP.comRegras === 'function' && regrasAtuais() ? HPP.comRegras(eb, regrasAtuais()) : eb;
    const polR = new Map((ebR.polygons || []).map(p => [p && p.id, p]));
    const ord = pols.map(p => polR.get(p.id) || p).sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
    for (const pol of ord) {
      const h = HPP.assinatura(ebR, pol);
      let c = despejoCache.get(pol.id);
      if (!c || c.hash !== h) {
        const r = HPP.despeja(ebR, pol);
        c = { hash:h, regioes:(r && (r.regioes || r)) || [] };
        if (!Array.isArray(c.regioes)) c.regioes = [];
        despejoCache.set(pol.id, c);
      }
      novas = novas.concat(c.regioes);
    }
  } catch (e) { console.warn('polygon pour:', e); return eb; }
  const out = Object.assign({}, eb);
  out.regions = (eb.regions || []).filter(g => !(g && g.poly && g.de != null && ids.has(String(g.de))))
    .concat(novas.map((g, i) => {
      const o = { id:'q:' + g.de + ':' + i, layer:g.layer, net:g.net, points:g.pts || g.points, poly:true, de:g.de };
      if (g.holes && g.holes.length) o.holes = g.holes;
      return o;
    }));
  return out;
}
function repour(){
  despejoCache.clear();
  const n = (EB.polygons || []).length;
  if (!n) { HubDialog.toast('a placa não tem polígono definido no hub (Place » Polygon Pour cria um)', 'info', 2800); return; }
  reaplica();
  HubDialog.toast(n + ' polígono(s) redespejado(s)', 'ok', 1800);
}
/* O Polygon Pour do hub (pedido do dono, 2026-10-23: "editar com clique e arraste, regular o tamanho
   tipo Canva" e "definir se ele e Top, Bottom ou sem plano, uma area que nao deixa plano passar, so
   trilha"). Forma, tipo e net vem da ficha da ferramenta -- nada de menu a cada poligono -- e o
   que nasce fica selecionado, com as alcas para esticar:
     plano:<camada>   poly_add (solido, conexao direta, cobre morto removido) com a net de terra
     sem:<camada>     region_add polycut:true -- o Polygon Pour Cutout do Altium: o plano nao
     sem:Multi        entra, trilha e via passam; na Multi vale para todas as camadas */
function tipoPour(){
  const [k, lay] = String(CFG.pourTipo || '').split(':');
  if ((k === 'plano' && LBYK[lay] && cobre(lay)) || (k === 'sem' && (lay === 'Multi' || (LBYK[lay] && cobre(lay))))) return k + ':' + lay;
  return 'plano:' + (cobre(cur) ? cur : LBYK.Top ? 'Top' : ((camadasCobre()[0] || {}).key || 'Top'));
}
const camadaDoTipo = () => tipoPour().split(':')[1];
function netTerra(){ return NETS.find(n => /^(GND|0V|AGND|DGND|PGND|GNDA|GNDD)$/i.test(n)) || NETS.find(n => /GND/i.test(n)) || ''; }
const netDoPour = () => CFG.pourNet != null ? CFG.pourNet : netTerra();
function opcTipoPlano(){
  const L = camadasCobre(), out = [];
  for (const l of L) out.push({ v:'plano:' + l.key, rot:'Plano — ' + rotuloAba(l), cor:l.color });
  for (const l of L) out.push({ v:'sem:' + l.key, rot:'Sem plano — ' + rotuloAba(l), cor:l.color });
  out.push({ v:'sem:Multi', rot:'Sem plano — todas as camadas' });
  return out;
}
function criaPlano(pts){
  if (!garanteEdicao()) return;
  const [k, lay] = tipoPour().split(':');
  const P = pts.map(p => [r6(p[0]), r6(p[1])]);
  let op;
  if (k === 'sem') op = { op:'region_add', polycut:true, layer:lay, pts:P, note:'sem plano do hub' };
  else { op = { op:'poly_add', layer:lay, pts:P, pour:'solid', note:'plano do hub' }; const n = netDoPour(); if (n) op.net = n; }
  CH.push(op); selDepois = [op]; commit();
  setTool('select');
  HubDialog.toast((k === 'sem' ? 'sem plano em ' + (lay === 'Multi' ? 'todas as camadas' : nomeDe(lay))
    : 'plano em ' + nomeDe(lay) + (op.net ? ' — net ' + op.net : ' — sem net')) + ' · arraste as bordas para ajustar', 'ok', 2600);
}
/* Tipo no painel: trocar a camada edita a mesma linha; trocar plano <-> sem plano apaga um e cria o
   outro no mesmo contorno */
function mudaTipoPlano(a, v){
  const [k, lay] = String(v || '').split(':');
  if (!a.m || (k !== 'plano' && k !== 'sem') || !lay) return false;
  if (k === 'plano' ? !(LBYK[lay] && cobre(lay)) : !(lay === 'Multi' || (LBYK[lay] && cobre(lay)))) return false;
  if (a.t === 'poly' && k === 'plano') return lay !== a.m.eff.layer && editaPoly(a.m, { layer:lay });
  if (a.t === 'semplano' && k === 'sem') {
    if (lay === a.m.eff.layer) return false;
    const op = opDe(a.m); if (!op) return false;
    op.layer = lay; return true;
  }
  const g = geoDe(a); if (!g) return false;
  const net = a.t === 'poly' ? (a.m.eff.net || '') : netDoPour();
  if (!apagaItem(a.m)) return false;
  const P = g.points.map(p => [r6(p[0]), r6(p[1])]);
  const op = k === 'sem' ? { op:'region_add', polycut:true, layer:lay, pts:P, note:'sem plano do hub' }
                         : Object.assign({ op:'poly_add', layer:lay, pts:P, pour:'solid', note:'plano do hub' }, net ? { net } : {});
  CH.push(op); (selDepois || (selDepois = [])).push(op);
  return true;
}
function poePad(w, ev){
  const p = snapPonto(w, ev, { soGrade:true });
  const op = { op:'pad_add', type:'th', shape:'circle', x:p.x, y:p.y, w:r6(CFG.padW), h:r6(CFG.padW), drill:r6(CFG.padFuro), note:'pad do hub' };
  CH.push(op); selDepois = [op]; commit();
}
/* carrega um .js do workspace sob demanda (o esquema e as bibliotecas so quando o ECO pede) */
function carregaScript(src){
  return new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = src + (src.indexOf('?') < 0 ? '?t=' : '&t=') + Date.now();
    s.onload = () => ok(); s.onerror = () => falha(new Error('não carregou ' + src));
    document.head.append(s);
  });
}
async function globalDe(nome, src, deNovo){
  if (!deNovo && typeof window[nome] !== 'undefined') return window[nome];
  try { await carregaScript(src); } catch (e) { return null; }
  return typeof window[nome] !== 'undefined' ? window[nome] : null;
}
async function postJson(url, corpo){
  const r = await fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(corpo) });
  let j = null; try { j = await r.json(); } catch (e) {}
  return j || { ok:false, error:'HTTP ' + r.status };
}
async function abreEco(){
  if (typeof HubPcbEcoUI === 'undefined' || typeof HubPcbEco === 'undefined') { HubDialog.alert('O ECO (hub-pcbeco.js) não carregou nesta página. Atualize o hub (F5).', { title:'Atualizar a PCB' }); return; }
  if (!PROJ) { HubDialog.toast('abra a vista pela lista de projetos do hub', 'warn'); return; }
  const base = 'Projects/' + encodeURIComponent(PROJ) + '/';
  const sch = await globalDe('schematic', base + 'schematic.js', true);
  if (!sch) { HubDialog.alert('Este projeto não tem schematic.js — o ECO compara o esquema com a placa.', { title:'Atualizar a PCB' }); return; }
  const [schlib, pcblib, rm, ls] = await Promise.all([
    globalDe('schlib', 'Libs/schlib.js'), globalDe('pcblib', 'Libs/pcblib.js'),
    globalDe('renameMap', 'Libs/rename-map.js'), globalDe('libSubs', 'Libs/lib-subs.js')]);
  if (typeof HC.setLibTables === 'function') HC.setLibTables(rm, ls);
  if (pcblib && typeof HC.setPcbLib === 'function') HC.setPcbLib(pcblib);
  if (typeof HubFpLib !== 'undefined') { HUBLIB = await HubFpLib.carrega(); registraLibHub(); }
  const pcblibEco = (typeof HubFpLib !== 'undefined' && HUBLIB) ? HubFpLib.mescla(pcblib, HUBLIB) : pcblib;
  await HubPcbEcoUI.eco({ board:B, changes:CH, schematic:sch, schlib, pcblib:pcblibEco,
    gravar:async (linhas) => {
      if (!linhas || !linhas.length) return true;
      if (!garanteEdicao()) return false;
      for (const op of linhas) CH.push(op);
      commit();
      if (HubIO.canPost) await salvar();
      return true;
    } });
}
async function abreNovaPlaca(){
  if (typeof HubPcbEcoUI === 'undefined' || typeof HubPcbNova === 'undefined') { HubDialog.alert('O assistente de placa nova (hub-pcbnova.js) não carregou nesta página. Atualize o hub (F5).', { title:'Placa nova' }); return; }
  if (!HubIO.canPost) { HubDialog.toast('placa nova precisa do hub com gravação (abra pelo servidor ou pelo app)', 'warn'); return; }
  const pr = await globalDe('projects', 'projects.js', true);
  const existentes = Array.isArray(pr) ? pr.map(p => typeof p === 'string' ? p : (p && (p.name || p.id || p.dir)) || '').filter(Boolean) : [];
  let criado = '';
  const r = await HubPcbEcoUI.novaPlaca({ projeto:PROJ, existentes,
    gravar:async ({ proj, conteudo, regrasJs }) => {
      const j = await postJson('/api/board-novo', { proj, conteudo });
      if (!j.ok) return j.error || 'o servidor recusou';
      if (regrasJs) await postJson('/api/save', { path:'Projects/' + proj + '/rules.js', content:regrasJs });
      criado = proj; return true;
    } });
  if (!r || !criado) return;
  const abrir = await HubDialog.confirm('Placa "' + criado + '" criada. Abrir agora? Depois, Design » Update PCB traz os componentes do esquema.', { title:'Placa nova', ok:'Abrir' });
  if (abrir) location.href = location.pathname + '?p=' + encodeURIComponent(criado);
}

/* ============================== regras de projeto e DRC ==============================
   Design » Rules (o PCB Rules and Constraints Editor) e Tools » Design Rule Check, no hub:
   hub-pcbregras.js (o modelo e a query do Altium), hub-pcbdrc.js (o motor) e hub-pcbregrasui.js
   (o editor e o painel Messages). As regras vem do rules.js do projeto; sem ele, das que o espelho
   trouxe (board.rules) sobre o padrao da casa. Depois do primeiro DRC, cada edicao confere de novo
   (o online do Altium) e os marcadores acompanham. */
const HRG = (typeof HubPcbRegras !== 'undefined' && HubPcbRegras && typeof HubPcbRegras.ler === 'function') ? HubPcbRegras : null;
const HDRC = (typeof HubPcbDrc !== 'undefined' && HubPcbDrc && typeof HubPcbDrc.rodar === 'function') ? HubPcbDrc : null;
const HRUI = (typeof HubPcbRegrasUI !== 'undefined' && HubPcbRegrasUI) ? HubPcbRegrasUI : null;
let REGRAS = null, DRC_RES = null, drcPainel = null, drcTimer = null;
function regrasAtuais(){
  if (!REGRAS && HRG) {
    try { REGRAS = (typeof pcbrules !== 'undefined' && pcbrules) ? HRG.ler(pcbrules) : HRG.doBoard(B); }
    catch (e) { console.warn('regras:', e); REGRAS = HRG.padroes(); }
  }
  return REGRAS;
}
function rodaDrc(){
  if (!HDRC || !regrasAtuais()) return null;
  const tg = (typeof HubGerber !== 'undefined' && typeof HubGerber.geometriaTexto === 'function') ? (t => HubGerber.geometriaTexto(t)) : undefined;
  try { DRC_RES = HDRC.rodar(EB, REGRAS, { textoGeo:tg }); }
  catch (e) { console.warn('DRC:', e); HubDialog.toast('DRC: ' + (e && e.message || e), 'err'); DRC_RES = null; }
  pede();
  return DRC_RES;
}
let drcAbertoEm = 0;
function abreDrc(){
  drcAbertoEm = Date.now();
  if (!HDRC || !HRUI) { HubDialog.alert('O DRC (hub-pcbdrc.js) não carregou nesta página. Atualize o hub (F5).', { title:'Design Rule Check' }); return; }
  drcPainel = HRUI.abrirDrc({
    rodar:() => rodaDrc(),
    irPara:(x, y, ids) => {
      view.cx = x; view.cy = y; if (view.scale < 20) view.scale = 20;
      const alvos = (ids || []).map(id => { const m = IDX.item.get(String(id)); return m ? PORCHAVE.get(chave({ t:m.kind, m })) : null; }).filter(Boolean);
      if (alvos.length) selSo(alvos);
      pede();
    },
    arquivo:baseDoPcbDoc(),
    aoFechar:() => { drcPainel = null; DRC_RES = null; pede(); },
  });
  const r = rodaDrc();
  if (drcPainel && r && typeof drcPainel.mostra === 'function') drcPainel.mostra(r);
}
/* depois de cada edicao, com o DRC aberto: confere de novo (com folga para o arrasto acabar) */
function drcDepoisDaEdicao(){
  if (!(DRC_RES && drcPainel) && !PREFS.drcOnline) return;
  clearTimeout(drcTimer);
  drcTimer = setTimeout(() => { const r = rodaDrc(); if (r && drcPainel && typeof drcPainel.mostra === 'function') drcPainel.mostra(r); }, 250);
}
function desenhaDrc(){
  if (!DRC_RES || !HRUI || typeof HRUI.desenhaMarcadores !== 'function') return;
  try { HRUI.desenhaMarcadores(ctx, DRC_RES.violacoes || [], { px:n => px(n), sel:drcPainel && drcPainel.selecionada ? drcPainel.selecionada() : null }); }
  catch (e) { console.warn('marcadores do DRC:', e); }
}
function abreRegras(){
  if (!HRUI || !HRG) { HubDialog.alert('O editor de regras (hub-pcbregrasui.js) não carregou nesta página. Atualize o hub (F5).', { title:'Regras de projeto' }); return; }
  HRUI.abrirEditor({ regras:regrasAtuais(), placa:EB, unidade, salvar:async (conj, txt) => {
    REGRAS = conj;
    CENA = null; ROTA = null;          /* o roteador passa a usar as regras novas na hora */
    if (DRC_RES) drcDepoisDaEdicao();
    if (!HubIO.canPost || !PROJ) { HubDialog.toast('regras valendo nesta sessão (sem gravação neste hub)', 'warn', 3000); return true; }
    const j = await postJson('/api/save', { path:'Projects/' + PROJ + '/rules.js', content:txt });
    if (!j.ok) { HubDialog.toast('não gravei o rules.js: ' + (j.error || ''), 'err', 4000); return false; }
    HubDialog.toast('regras gravadas no rules.js', 'ok', 2000);
    return true;
  } });
}

/* ============================== snap ==============================
   Centro de pad, centro de via e ponta de trilha/arco ganham da grade, como no Altium (Snap
   Options: Pad Centers, Via Centers, Track Vertices); fora deles, a grade. Ctrl solta tudo.
   O alcance e de 9 px na tela -- ou o pad inteiro, se ele for maior. O id e o do objeto em que
   prendeu (a via que cai num pad sem net nao e conflito com ele: conflitosDaViaNova). */
let SNAP = null;
function snapPonto(w, ev, op){
  op = op || {};
  if (ev && ev.ctrlKey) return { x:r6(w.x), y:r6(w.y), net:'', tipo:'livre' };
  if (snapObj !== 'off' && !op.soGrade) {
    const tol = px(9);
    let melhor = null, dm = Infinity;
    const ve = (x, y, net, tipo, layer, alcance, id) => {
      if (!isNum(x) || !isNum(y)) return;
      if (!camVisivel(layer)) return;
      if (snapObj === 'atual' && layer !== cur && !(layer === 'Multi' && cobre(cur))) return;
      if (op.camada && layer !== op.camada && !(layer === 'Multi' && cobre(op.camada))) return;
      const d = Math.hypot(w.x - x, w.y - y);
      if (d <= Math.max(tol, alcance || 0) && d < dm) { dm = d; melhor = { x:r6(x), y:r6(y), net:net || '', tipo, id:id == null ? '' : String(id) }; }
    };
    const fora = o => EXCLUI && EXCLUI.has(o);       /* o que esta na mao nao e alvo de si mesmo */
    const pad = p => { if (!p || !isNum(p.x) || fora(p)) return; const c = centroCobre(p); ve(c[0], c[1], p.net, 'pad', ehTH(p) ? 'Multi' : p.layer, Math.min(p.w || 0, p.h || 0) / 2, p.id); };
    for (const c of EB.components || []) for (const p of (c && c.pads) || []) pad(p);
    for (const p of EB.freepads || []) pad(p);
    for (const v of EB.vias || []) if (v && !fora(v)) ve(v.x, v.y, v.net, 'via', 'Multi', (v.size || 0) / 2, v.id);
    const pontas = list => { for (const o of list || []) { if (!o || o.keepout || fora(o)) continue;
      if (o.kind === 'arc' || isNum(o.cx)) { if (!linhaValida(o, true) || arcoCheio(o)) continue; const a = pontaArco(o, 0), b = pontaArco(o, 1); ve(a[0], a[1], o.net, 'ponta', o.layer, 0, o.id); ve(b[0], b[1], o.net, 'ponta', o.layer, 0, o.id); }
      else if (linhaValida(o, false)) { ve(o.x1, o.y1, o.net, 'ponta', o.layer, 0, o.id); ve(o.x2, o.y2, o.net, 'ponta', o.layer, 0, o.id); } } };
    pontas(EB.tracks); pontas(EB.arcs);
    if (op.camada && !cobre(op.camada)) { pontas(EB.silk); pontas(EB.lines); }
    if (melhor) return melhor;
  }
  return { x:snapV(w.x, grade.mm), y:snapV(w.y, grade.mm), net:'', tipo:'grade' };
}

/* ============================== ferramentas ==============================
   Todas desenham na CAMADA ATUAL (a aba ativa embaixo), como no Altium. Escolher uma destrava
   a edicao. O que cada uma escreve:
     trilha   track_add em serie (e via_add no 2, no * e no Ctrl+2)   via       via_add
     linha    track_add em serie na camada atual                      arco      arc_add
     circulo  region_add (cheio) ou arc_add 0-360 (contorno)          retangulo fill_add ou 4 track_add
     triangulo/poligono  region_add ou track_add em volta            texto     text_add (espelhado embaixo)
     furo     region_add com cutout:true                              contorno  outline_set (com pergunta)
     medir e sinalizar nao escrevem no changes.js. */
const FERRAMENTA_ROT = {
  select:'Selecionar', trilha:'Trilha', via:'Via', linha:'Linha', arco:'Arco', circulo:'Círculo', retangulo:'Retângulo',
  triangulo:'Triângulo', poligono:'Polígono', texto:'Texto', furo:'Furo de fixação', contorno:'Contorno da placa',
  medir:'Medir', sinalizar:'Sinalizar', colar:'Colar', pad:'Pad', pour:'Polygon Pour',
};
let draft = null;          /* o gesto da ferramenta em curso */
let cursorW = null;        /* o cursor no mundo (cru) */
let lembraCanto = { p90:'v', p45:'diag' };
const ladoBaixo = k => !!(LBYK[k] && LBYK[k].side === 'bottom') || /^Bottom/.test(k);
function setTool(t){
  if (t !== 'select' && LEAN) return;
  /* a ferramenta Furo com circulo(s) selecionado(s): eles viram furo de fixacao na hora */
  if (t === 'furo') { const cs = marcacoesSemFuro(SEL.filter(circuloDoAlvo)); if (cs.length) { furosDosCirculos(cs, true); return; } }
  encerraDraft(true);
  if (t !== 'select' && t !== 'medir') garanteEdicao();
  if (t === 'trilha' && !cobre(cur)) {
    const c = camadasCobre()[0];
    if (c) { cur = c.key; pintaAbas(); HubDialog.toast('trilha é em cobre — camada atual: ' + nomeDe(cur), 'info'); }
  }
  tool = t;
  fechaCaixaTexto(); fechaAnnForm(); fechaMenu();
  cv.style.cursor = t === 'select' ? 'default' : cursorFerramenta();
  pintaBarra(); pintaStatus();
  if (painel) { if (t !== 'select') painel.mostra('props'); painel.atualiza(); }
  pede();
}
/* larga o gesto em curso; o que ja foi fixado (trilha, linha) ja esta no changes.js */
function encerraDraft(){
  if (draft && draft.tipo === 'medida') { draft = null; return; }
  draft = null;
  SNAP = null;
}
function garanteEdicao(){
  if (LEAN) return false;
  if (!editOn) { setEdit(true); HubDialog.toast('edição destravada (' + (teclaDe('editar') || 'E') + ' trava de novo)', 'info', 2600); }
  return true;
}
function camadaDesenho(){
  if (cur === 'Multi') { HubDialog.toast('a Multi-Layer é só de pad e via — escolha outra camada nas abas', 'warn'); return null; }
  return cur;
}
function proximaCobre(k, passo){
  const L = camadasCobre().map(l => l.key);
  if (!L.length) return k;
  const i = L.indexOf(k);
  return L[((i < 0 ? 0 : i) + (passo || 1) + L.length) % L.length];
}

/* ---- trilha e linha: o traçado do hub-fio.js (o mesmo do fio do Esquema), em mm ---- */
function novaRota(){
  const lay = tool === 'trilha' ? (cobre(cur) ? cur : proximaCobre('Top', 0)) : camadaDesenho();
  if (!lay) return null;
  return { tipo:'rota', est:null, layer:lay, w:tool === 'trilha' ? CFG.wTrilha : CFG.wLinha, net:'', passos:[] };
}
function opSegmento(a, b){
  const op = { op:'track_add', layer:draft.layer, x1:r6(a[0]), y1:r6(a[1]), x2:r6(b[0]), y2:r6(b[1]), w:r6(draft.w) };
  if (tool === 'trilha' && draft.net && cobre(draft.layer)) op.net = draft.net;
  op.note = tool === 'trilha' ? 'trilha do hub' : 'linha do hub';
  return op;
}
/* a net que a trilha encontrou no caminho vale para os trechos que ela ja tinha posto -- e para
   as vias dela (a via posta antes de a trilha ter net ficava sem net, e a via sem net encosta em
   tudo para o roteador) */
function propagaNet(net){
  if (!net || draft.net || tool !== 'trilha') return;
  draft.net = net;
  for (const p of draft.passos) for (const op of p.ops)
    if (((op.op === 'track_add' && cobre(op.layer)) || op.op === 'via_add') && !op.net) op.net = net;
}
function segmentosNovos(antes, depois){
  const ops = [];
  for (let i = antes.pts.length; i < depois.pts.length; i++) ops.push(opSegmento(depois.pts[i - 1], depois.pts[i]));
  return ops;
}

/* ============================== o roteador ==============================
   "trilha de mesma camada nao podem se cruzar, se forem se cruzar o software nao deixa, e tenta
   fazer sozinho a curva em um caminho possivel ate o outro lado, mas sem mexer na trilha que ja
   ta colocada" e "na vdd elas so se encontram se forem trilhas de mesma NET" (o dono, 2026-10-02).
   O motor (hub-roteador.js) e puro: a cena, as folgas exatas e o caminho. Aqui so se liga: a
   previa e o clique da Trilha, a via da trilha, a ferramenta Via e a conferencia das edicoes.
   So a Trilha usa o motor -- a Linha continua desenho livre, como o Place Line do Altium. Com o
   conflito em 'ignorar' (o escape), no lean ou sem o motor, tudo e como era antes dele. */
const HR = (typeof HubRoteador !== 'undefined' && HubRoteador && typeof HubRoteador.cena === 'function' &&
            typeof HubRoteador.rota === 'function') ? HubRoteador : null;
let motorQuebrado = false;
const CONFLITO_ROT = { contornar:'contornar (Walkaround)', parar:'parar no obstáculo', ignorar:'ignorar (não confere)' };
const CONFLITO_FRASE = {
  contornar:'trilha de outra net é contornada',
  parar:'a trilha para antes da outra net',
  ignorar:'não confere nada — nets diferentes podem se encontrar',
};
/* a folga entre cobres de nets diferentes: a regra Clearance do espelho; sem ela, 10 mil (a regra
   de 95 de 111 projetos da casa) */
const FOLGA = (isNum(RULES.clearance) && RULES.clearance > 0) ? RULES.clearance : 0.254;
const motorEdicao = () => !!HR && !motorQuebrado && !LEAN && CFG.conflito !== 'ignorar';
const motorLigado = () => tool === 'trilha' && motorEdicao();
const eletricoP = p => !!p && (p.tipo === 'pad' || p.tipo === 'via' || p.tipo === 'ponta');
/* motor com defeito nao derruba a vista: avisa uma vez e a sessao segue como antes dele */
function falhaMotor(e){
  if (motorQuebrado) return;
  motorQuebrado = true;
  try { console.error('hub-roteador:', e); } catch (x) {}
  HubDialog.toast('O roteador falhou (' + String(e && e.message || e) + '): a trilha e as edições seguem SEM conferir conflito até recarregar a página.', 'err', 0);
  pintaStatus();
}
function setConflito(v){
  if (CONFLITOS.indexOf(v) < 0) return false;
  CFG.conflito = v;
  gravaPref('conflito', v);
  ROTA = null;
  return true;
}
function cicloConflito(){
  const ciclo = PREFS.conflitosCiclo.length ? PREFS.conflitosCiclo : CONFLITOS;
  setConflito(ciclo[(ciclo.indexOf(CFG.conflito) + 1) % ciclo.length]);
  pintaStatus(); if (painel) painel.atualiza(); pede();
  HubDialog.toast('conflito: ' + CFG.conflito + ' — ' + CONFLITO_FRASE[CFG.conflito] +
    (HR ? '' : ' (o roteador não carregou: nada é conferido)'), CFG.conflito === 'ignorar' ? 'warn' : 'info', 2600);
}

/* ---- a cena: a placa efetiva com o contorno, os furos e a geometria de texto da tela ---- */
function opcoesCena(eb){
  const o = { placa:{ lacos:lacosDe(eb), recortes:(eb === EB ? recortesDaTela() : recortesDe(eb)).map(k => k.pts) } };
  /* as regras do projeto (as mesmas do DRC): a folga de cada par, a do contorno, e a largura, a via
     e a camada da rota pela regra da net. Sem o modulo de regras, a folga unica de antes */
  const S = regrasAtuais();
  if (S) o.regras = S; else o.clearance = FOLGA;
  /* texto em camada de cobre e cobre: a geometria e a do Gerber (a mesma que a tela desenha);
     oculto nao vai para a fabrica e nao e obstaculo */
  if (typeof HubGerber !== 'undefined' && typeof HubGerber.geometriaTexto === 'function')
    o.textoGeo = t => { if (!t || t.hidden) return null; try { return HubGerber.geometriaTexto(t); } catch (e) { return null; } };
  return o;
}
function cenaAtual(){
  if (!HR) return null;
  if (CENA && CENA_EB === EB) return CENA;
  CENA = HR.cena(EB, opcoesCena(EB));
  CENA_EB = EB;
  return CENA;
}
const folgaDaCena = () => (CENA && isNum(CENA.clearance) && CENA.clearance > 0) ? CENA.clearance : FOLGA;
/* Interactive Routing Width / Via Size em "Rule Preferred" (o padrao do Altium e o da vista): a
   regra Width / Routing Via Style que vence para a net. A largura ou a via que o usuario digitou no
   painel nesta sessao manda (o Tab do Altium no meio da rota), presa a faixa da regra da net: o
   Altium nao deixa a rota sair dela, e o valor fora vira o limite, com aviso */
const EDITADO = { w:false, via:false };
let ultimoAvisoRegra = '';
const avisaRegra = t => { if (t === ultimoAvisoRegra) return; ultimoAvisoRegra = t; setTimeout(() => { if (ultimoAvisoRegra === t) ultimoAvisoRegra = ''; }, 2000); HubDialog.toast(t, 'warn', 3500); };
function larguraDaNet(net, layer){
  if (!HR || typeof HR.limitaLargura !== 'function') return CFG.wTrilha;
  try {
    const c = cenaAtual();
    if (!c || !c.regras) return CFG.wTrilha;
    const manual = PREFS.larguraModo !== 'regra' || EDITADO.w;
    const r = HR.limitaLargura(c, net || '', layer, manual ? CFG.wTrilha : 0);
    if (r.ajustada && manual) avisaRegra('largura ' + fmtDist(CFG.wTrilha) + ' fora da regra ' + (r.regra || 'Width') + ' da net ' + (net || '(sem net)') + ': ' + fmtDist(r.w));
    return r.w > 0 ? r6(r.w) : CFG.wTrilha;
  } catch (e) { return CFG.wTrilha; }
}
function viaDaNet(net){
  const cfg = { size:CFG.viaSize, drill:CFG.viaDrill };
  if (!HR || typeof HR.limitaVia !== 'function') return cfg;
  try {
    const c = cenaAtual();
    if (!c || !c.regras) return cfg;
    const manual = PREFS.viaModo !== 'regra' || EDITADO.via;
    const r = HR.limitaVia(c, net || '', manual ? CFG.viaSize : 0, manual ? CFG.viaDrill : 0);
    if (r.ajustada && manual) avisaRegra('via ' + fmtDist(CFG.viaSize) + '/' + fmtDist(CFG.viaDrill) + ' fora da regra ' + (r.regra || 'Routing Via Style') + ': ' + fmtDist(r.size) + '/' + fmtDist(r.drill));
    return r.size > 0 && r.drill > 0 ? { size:r6(r.size), drill:r6(r.drill) } : cfg;
  } catch (e) { return cfg; }
}
/* a net do cobre sob o ponto na camada ('' = nenhum) */
function netNoPonto(layer, x, y){
  if (!HR || typeof HR.netEm !== 'function') return '';
  try { const n = HR.netEm(cenaAtual(), layer, x, y); return typeof n === 'string' ? n : ''; }
  catch (e) { falhaMotor(e); return ''; }
}

/* ---- as palavras do que barrou ---- */
const NOME_OBST = { trilha:'trilha', arco:'arco', pad:'pad', via:'via', fill:'fill', regiao:'região', texto:'texto', keepout:'keepout', borda:'borda da placa' };
function descObstaculo(b){
  if (!b) return 'um obstáculo';
  const t = NOME_OBST[b.tipo] || String(b.tipo || 'obstáculo');
  if (b.tipo === 'keepout' || b.tipo === 'borda') return t;
  return t + (b.net ? ' de ' + b.net : ' sem net');
}
function porqueObstaculo(b){
  if (b && b.tipo === 'borda') return 'o cobre fica dentro da placa, longe da borda';
  if (b && b.tipo === 'keepout') return 'keepout não deixa passar cobre';
  if (b && !b.net) return 'cobre sem net não encosta em net nenhuma';
  return 'trilhas de nets diferentes não se encontram';
}
/* O que barrou. O `bloqueio` do motor e o primeiro obstaculo do L direto; contornando, quando o
   alvo e um pad/via/ponta de OUTRA net, quem impede a chegada e o proprio alvo -- a rota da a
   volta no resto e para antes dele. */
function bloqueioDaRota(r, p, netTrilha){
  if (r && !r.completa && r.motivo !== 'bloqueado' && eletricoP(p) && p.net && netTrilha && p.net !== netTrilha)
    return { tipo:p.tipo === 'ponta' ? 'trilha' : p.tipo, net:p.net };
  return r ? r.bloqueio : null;
}
function textoParou(r, b){
  if (!b) return r && r.motivo === 'orcamento' ? 'não achou passagem perto daqui — clique mais perto do caminho que quer'
                                              : 'não achou passagem até aqui — ' + porqueObstaculo(null);
  return 'parou antes de ' + descObstaculo(b) + ' — ' + porqueObstaculo(b);
}
/* a folga de verdade de um conflito, em mm (negativa = os cobres se sobrepoem) */
const folgaDoConflito = c => isNum(c && c.dist) ? c.dist : 0;
function textoConflito(c){
  const d = descObstaculo(c) + (c && c.layer ? ' na ' + nomeDe(c.layer) : ''), f = folgaDoConflito(c);
  if (f < -1e-6) return 'cruzaria ' + d;
  /* a folga que a regra pede para ESTE par (Clearance com escopo e matriz), a do roteador */
  const pede = c && isNum(c.folga) ? c.folga : folgaDaCena();
  return 'encostaria em ' + d + ' (folga ' + fmtDist(Math.max(0, f)) + ' < ' + fmtDist(pede) + ' ' + unidade + ')';
}
/* o porque da recusa fica no rodape ate a proxima rota ou edicao aceita -- e so ele sai: o rodape
   tambem guarda aviso de outra origem (o changes.js que mudou no disco) */
let avisoDoRoteador = '';
function avisoRota(t){ avisoDoRoteador = t; avisoRodape(t); }
function limpaAvisoRota(){ const el = $('smsg'); if (avisoDoRoteador && el && el.textContent === avisoDoRoteador) avisoRodape(''); avisoDoRoteador = ''; }
function avisaConflito(prefixo, cs){
  const pior = cs.slice().sort((a, b) => folgaDoConflito(a) - folgaDoConflito(b))[0];
  /* "e mais N" conta obstaculos: a via encosta no mesmo pad passante em cada camada */
  const outros = new Set(cs.map(c => String(c.tipo) + ':' + String(c.id))).size - 1;
  const t = prefixo + ': ' + textoConflito(pior) + (outros > 0 ? ' — e mais ' + outros : '');
  avisoRota(t);
  HubDialog.toast(t, 'warn', 5000);
}

/* ---- a trilha na mao ---- */
/* os objetos que a trilha em curso ja pos (as linhas dos passos dela): nao sao obstaculo dela
   mesma -- sem isso a propria trilha sem net a barraria */
function idsDaTrilha(){
  const ids = [];
  if (!draft || !Array.isArray(draft.passos)) return ids;
  for (const ps of draft.passos) for (const op of ps.ops || []) {
    const it = IDX.opItem.get(op);
    if (it && it.target && it.target.eff && it.target.eff.id != null) ids.push(String(it.target.eff.id));
  }
  return ids;
}
/* A rota da trilha na mao ate o ponto p (o snap), com memo pelo que a muda: o alvo (x/y/tipo/net),
   o estado do HubFio, o modo de conflito, a largura, a camada, a net e o EB (ebSeq; os passos da
   trilha so mudam com commit). Mexer o mouse dentro do mesmo ponto de grade nao recalcula, e o
   clique reaproveita a rota da previa: o que se ve e o que se fixa. null = sem motor (a trilha
   segue como antes dele). */
function calculaRota(p){
  if (!motorLigado() || !p || !draft || draft.tipo !== 'rota' || !draft.est) return null;
  const est = draft.est, A = est.pts[est.pts.length - 1], elet = eletricoP(p);
  const chave = [ebSeq, CFG.conflito, draft.layer, draft.w, draft.net || '', est.modo, est.primeiro, A[0], A[1],
                 p.x, p.y, elet ? p.tipo : '', elet ? (p.net || '') : ''].join('|');
  if (ROTA && ROTA.chave === chave && ROTA.est === est) return ROTA.res;
  const req = { layer:draft.layer, w:draft.w, net:draft.net || '', de:[A[0], A[1]], ate:[p.x, p.y],
                alvo:{ eletrico:elet, net:elet ? (p.net || '') : '' }, modo:est.modo, primeiro:est.primeiro,
                conflito:CFG.conflito, ignora:idsDaTrilha() };
  let res = null;
  try {
    res = HR.rota(cenaAtual(), req);
    if (!res || !Array.isArray(res.pts)) throw new Error('a rota veio sem pontos');
    /* sem ponto nenhum (entrada que o motor recusou): parada na partida, nunca o L sem conferir */
    if (!res.pts.length) res = Object.assign({}, res, { pts:[[A[0], A[1]]], completa:false });
  } catch (e) { falhaMotor(e); res = null; }
  ROTA = { chave, est, req, res, alvo:p };
  pintaStatus();
  return res;
}
/* a rota vigente da trilha na mao (para a barra de status) */
const rotaVigente = () => (ROTA && ROTA.res && draft && draft.tipo === 'rota' && draft.est && ROTA.est === draft.est) ? ROTA.res : null;
/* a barra de status: o modo de conflito e, com a trilha na mao, o que o roteador esta fazendo */
function statusConflito(){
  if (!HR) return 'conflito: não confere (o roteador não carregou)';
  if (motorQuebrado) return 'conflito: não confere (o roteador falhou)';
  let s = 'conflito: ' + CFG.conflito;
  const r = CFG.conflito !== 'ignorar' ? rotaVigente() : null;
  if (r && !r.completa) s += ' · sem passagem: ' + descObstaculo(bloqueioDaRota(r, ROTA.alvo, ROTA.req.net));
  else if (r && r.motivo === 'contorno') s += ' · contornando ' + descObstaculo(r.bloqueio);
  return s;
}
/* O lado da perna seguinte: perpendicular ao ultimo trecho fixado, a regra do HubFio.fixa. A
   copia so vale para um hub-fio.js antigo no cache do navegador. */
const depoisDe = (typeof HubFio !== 'undefined' && typeof HubFio.depoisDe === 'function') ? HubFio.depoisDe : function(modo, A, B2, pr){
  if (modo === '90') return Math.abs(B2[0] - A[0]) > 1e-6 ? 'v' : 'h';
  if (modo === '45') { const dx = Math.abs(B2[0] - A[0]), dy = Math.abs(B2[1] - A[1]); return dx > 1e-6 && Math.abs(dx - dy) <= 1e-6 ? 'orto' : 'diag'; }
  return pr;
};
/* o estado do HubFio depois de fixar `novos` (os vertices depois do ultimo ponto fixado). Os
   vertices vao no r6 do changes.js: a rota sai com ruido de float (15.600000000000001) e a
   partida da perna seguinte tem de ser a ponta que foi gravada, nao a que a conta deu */
function estDepois(antes, novos, ult){
  const pts = antes.pts.map(q => [q[0], q[1]]).concat(novos.map(q => [r6(q[0]), r6(q[1])]));
  const n = pts.length;
  const primeiro = n >= 2 ? depoisDe(antes.modo, pts[n - 2], pts[n - 1], antes.primeiro) : antes.primeiro;
  return { pts, modo:antes.modo, primeiro, inicial:antes.inicial, ult:[ult[0], ult[1]] };
}
/* O clique com a rota do motor -- o que a previa mostrou e o que fica:
   - chegou num ponto eletrico: fixa tudo e a trilha acaba ali (como antes);
   - chegou num ponto qualquer: fixa tudo menos o ultimo trecho, que vira a perna de antecipacao
     (com um trecho so, fixa ele: o que o HubFio.fixa sempre fez);
   - nao chegou (completa:false): fixa ate onde chegou e diz o porque.
   Um clique e UM passo do Backspace, quantos trechos ele fixe. */
function fixaRota(p, r){
  const elet = eletricoP(p), P = r.pts, n = P.length - 1;
  /* defesa: rota que diz ter chegado num ponto eletrico de OUTRA net juntaria as duas */
  if (r.completa && elet && draft.net && p.net && p.net !== draft.net) {
    const t = 'não deixa: ' + descObstaculo({ tipo:p.tipo === 'ponta' ? 'trilha' : p.tipo, net:p.net }) + ' é outra net — ' + porqueObstaculo({ net:p.net });
    avisoRota(t); HubDialog.toast(t, 'warn'); return;
  }
  const fim = (!r.completa || elet || n <= 1) ? n : n - 1;
  if (!r.completa) {
    const t = textoParou(r, bloqueioDaRota(r, p, draft.net));
    avisoRota(t);
    HubDialog.toast(fim ? t : 'a trilha não sai daqui: ' + t, 'warn', 4500);
  } else if (fim && Array.isArray(r.violacoes) && r.violacoes.length) {
    /* a partida ja estava perto demais (regra de nao piorar): a trilha sai, mas abaixo da folga da
       regra -- o DRC vai acusar, e o Walkaround do Altium nao a faria. Diz qual e o caminho */
    avisaConflito('a trilha sai da partida abaixo da regra (o DRC vai acusar; diminua a largura ou parta de outro ponto)', r.violacoes);
  } else limpaAvisoRota();
  if (!fim) { pintaStatus(); pede(); return; }
  if (r.completa && elet) propagaNet(p.net);
  const antes = draft.est, novos = P.slice(1, fim + 1);
  const pontos = [antes.pts[antes.pts.length - 1]].concat(novos);
  const ops = [];
  for (let i = 1; i < pontos.length; i++) ops.push(opSegmento(pontos[i - 1], pontos[i]));
  for (const op of ops) CH.push(op);
  draft.passos.push({ ops, est:antes, layer:draft.layer });
  draft.est = estDepois(antes, novos, [p.x, p.y]);
  if (r.completa && elet) { draft.est = null; draft.passos = []; draft.net = ''; }   /* chegou num ponto eletrico: a trilha acaba ali */
  commit();
  pintaStatus();
}

/* ---- a via nova (a da trilha e a da ferramenta Via) ---- */
/* Os conflitos de uma via que ainda nao existe, no ponto p. O objeto sem net em que o snap prendeu
   nao conta: ligar num pad sem net nao junta duas nets (a mesma excecao da chegada da trilha).
   null = o motor falhou (a via segue como antes). */
function conflitosDaViaNova(p, size, net, ignora){
  let r;
  try { r = HR.folgaVia(cenaAtual(), { x:p.x, y:p.y, size }, { net:net || '', ignora:ignora || [] }); }
  catch (e) { falhaMotor(e); return null; }
  const preso = eletricoP(p) && p.id ? String(p.id) : '';
  return ((r && r.conflitos) || []).filter(c => !(preso && String(c.id) === preso && !c.net));
}
/* a previa da ferramenta Via: os conflitos no ponto do cursor (memo pelo ponto, net e EB) */
let VIA_PREVIA = null;
function conflitosNaPrevia(p){
  if (!motorEdicao() || !p) return null;
  const net = netDaViaNova(p);
  const chave = [ebSeq, p.x, p.y, net, CFG.viaSize, eletricoP(p) ? p.id : ''].join('|');
  if (VIA_PREVIA && VIA_PREVIA.chave === chave) return VIA_PREVIA.cs;
  VIA_PREVIA = { chave, cs:conflitosDaViaNova(p, CFG.viaSize, net, []) };
  return VIA_PREVIA.cs;
}
/* A net da via da ferramenta Via: a do snap (pad, via, ponta); senao a ESCOLHIDA no painel -- a
   via e da net que a mao pediu, e em cima do cobre de outra net ela nao entra (a regra do dono);
   sem net no painel, a do cobre em que ela cai, como a partida da Trilha (o Altium da a via a net
   do cobre em que ela cai): a camada atual primeiro, depois as outras de cobre -- a via atravessa
   todas. Antes a do cobre vinha na frente da do painel, e a via "de GND" posta em cima de uma
   trilha de 5V virava de 5V calada. */
function netDaViaNova(p){
  if (p.net) return p.net;
  if (CFG.viaNet) return CFG.viaNet;
  if (motorEdicao() && !eletricoP(p)) {
    const camadas = camadasCobre().map(l => l.key).sort((a, b) => (b === cur) - (a === cur));
    for (const k of camadas) { const n = netNoPonto(k, p.x, p.y); if (n) return n; }
  }
  return '';
}

/* ---- a edicao que faria nets diferentes se encontrarem: recusada ---- */
/* os campos do painel que mudam o cobre de uma trilha, de um arco ou de uma via */
const CAMPOS_COBRE = {
  track:{ layer:1, w:1, net:1, x1:1, y1:1, x2:1, y2:1 },
  arc:{ layer:1, w:1, net:1, cx:1, cy:1, r:1, sa:1, ea:1 },
  via:{ x:1, y:1, size:1, net:1 },
};
/* o que a regra confere: trilha e arco de cobre e via. Componente nao, como no Altium; keepout
   nao e cobre; linha de outra camada so conta se a edicao a leva para o cobre. */
const alvoConferido = a => !!a && !!a.m && !a.m.deleted && (a.t === 'track' || a.t === 'arc' || a.t === 'via');
function cobreConferido(o, t){
  if (!o) return false;
  if (t === 'via') return isNum(o.x) && isNum(o.y) && o.size > 0;
  return typeof o.layer === 'string' && cobre(o.layer) && !o.keepout && linhaValida(o, t === 'arc');
}
const chaveConflito = c => String(c.tipo) + ':' + String(c.id);
/* os conflitos de um objeto do EB na cena (ele mesmo nao conta), por obstaculo */
function conflitosDoObjeto(cn, o, t){
  const op = { net:typeof o.net === 'string' ? o.net : '', ignora:[String(o.id)] };
  const r = t === 'via' ? HR.folgaVia(cn, { x:o.x, y:o.y, size:o.size }, op)
          : t === 'arc' ? HR.folgaArco(cn, o.layer, { cx:o.cx, cy:o.cy, r:o.r, sa:o.sa, ea:o.ea, w:o.w }, op)
          : HR.folgaTrilha(cn, o.layer, { x1:o.x1, y1:o.y1, x2:o.x2, y2:o.y2, w:o.w }, op);
  const M = new Map();
  for (const c of (r && r.conflitos) || []) M.set(chaveConflito(c), c);
  return M;
}
/* o id que o objeto de um item tem no EB de outro modelo (o mesmo changes.js com a edicao) */
function idDepois(m, m2){
  if (!m.added) return m.src ? m.src.id : null;
  const op = opDe(m);
  const it = op ? m2.changeItems.find(i => i.ch === op) : null;
  return it && it.target && it.target.eff ? it.target.eff.id : null;
}
/* o changes.js antes da edicao, com a identidade das linhas: o Backspace da trilha e a selecao
   (chave 'o:') apontam para os objetos-linha, e desfazer uma edicao recusada nao pode troca-los */
function fotoCH(){ return CH.map(op => [op, JSON.parse(JSON.stringify(op))]); }
function voltaCH(foto){
  CH.length = 0;
  for (const [op, era] of foto) {
    for (const k of Object.keys(op)) if (!(k in era)) delete op[k];
    Object.assign(op, era);
    CH.push(op);
  }
}
/* "O software nao deixa": a edicao de trilha/arco de cobre e de via e conferida como ficaria --
   o objeto de depois contra a placa de depois (o modelo, o EB e a cena montados com a edicao ja
   escrita no changes.js), entao o que anda junto (o grupo arrastado, a selecao do painel, o
   componente que vira com a trilha) conta onde fica, e nao onde estava. Conflito NOVO, com um
   obstaculo que o objeto nao tocava antes, desfaz tudo o que a edicao escreveu e avisa; conflito
   que ja existia (placa antiga com DRC sujo) nao trava -- senao nada que ja nasceu encostado
   poderia andar. aplica() escreve no CH e diz se mexeu. Devolve true (escrito: falta o commit),
   false (nada escrito) ou null (recusado: nada escrito, o aviso ja foi dado). */
function editaConferindo(alvos, aplica, prefixo){
  const conf = motorEdicao() ? (alvos || []).filter(alvoConferido) : [];
  if (!conf.length) return !!aplica();
  let antes;
  try {
    const cn = cenaAtual();
    antes = conf.map(a => { const o = ebDe(a.m); return cobreConferido(o, a.t) ? conflitosDoObjeto(cn, o, a.t) : new Map(); });
  } catch (e) { falhaMotor(e); return !!aplica(); }
  const foto = fotoCH(), selAntes = selDepois;
  if (!aplica()) return false;
  const novos = [];
  let pre;
  try {
    const m2 = HC.applyPcbChanges(B, CH), eb2 = HC.effectiveBoard(B, m2), cn2 = HR.cena(eb2, opcoesCena(eb2));
    const porId = new Map();
    for (const [lista, t] of [[eb2.tracks, 'track'], [eb2.arcs, 'arc'], [eb2.vias, 'via']])
      for (const o of lista || []) if (o && o.id != null && !porId.has(t + ':' + o.id)) porId.set(t + ':' + o.id, o);
    conf.forEach((a, i) => {
      const id = idDepois(a.m, m2);
      const o2 = id == null ? null : porId.get(a.t + ':' + id);
      if (!cobreConferido(o2, a.t)) return;
      for (const [k, c] of conflitosDoObjeto(cn2, o2, a.t)) if (!antes[i].has(k)) novos.push(c);
    });
    pre = { sig:JSON.stringify(CH), model:m2, eb:eb2, cena:cn2 };
  } catch (e) { falhaMotor(e); return true; }
  if (novos.length) {
    voltaCH(foto);
    selDepois = selAntes;
    avisaConflito(prefixo || 'não deixa', novos);
    return null;
  }
  preCalc = pre;
  limpaAvisoRota();
  return true;
}
function rotaClique(w, ev){
  if (!draft || draft.tipo !== 'rota') draft = novaRota();
  if (!draft) return;
  const p = snapPonto(w, ev, { camada:draft.layer });
  if (!draft.est) {
    draft.est = HubFio.novo([p.x, p.y], CFG.modo, CFG.modo === '45' ? lembraCanto.p45 : lembraCanto.p90);
    draft.passos = [];
    if (tool === 'trilha') {
      draft.net = p.net || '';
      /* partida no meio de uma trilha (ou fill, regiao...): a net dela -- o Altium comeca a rota
         de qualquer ponto do cobre, e a trilha sem net seria barrada pela propria origem */
      if (!draft.net && !eletricoP(p) && motorLigado()) draft.net = netNoPonto(draft.layer, p.x, p.y);
      /* a largura: a da regra Width vencedora para a net (o Rule Preferred do Altium); Pickup Track
         Width From Existing Routes: comecar na ponta de uma trilha pega a largura dela */
      draft.w = larguraDaNet(draft.net, draft.layer);
      if (PREFS.larguraDaTrilha && p.tipo === 'ponta' && p.id) { const m = IDX.item.get(String(p.id)); const e = m && m.eff; if (e && e.w > 0 && cobre(e.layer)) draft.w = e.w; }
      if (motorLigado() && cenaAtual() && HR.camadaPermitida && !HR.camadaPermitida(cenaAtual(), draft.net, draft.layer))
        HubDialog.toast('a regra Routing Layers da net ' + (draft.net || '(sem net)') + ' não permite ' + draft.layer + ': troque de camada', 'warn', 4000);
    }
    pintaStatus(); pede(); return;
  }
  /* a Trilha com o roteador: a rota que a previa mostrou (ou null, e segue como antes) */
  if (motorLigado()) { const r = calculaRota(p); if (r) { fixaRota(p, r); return; } }
  const eletrico = tool === 'trilha' && (p.tipo === 'pad' || p.tipo === 'via' || p.tipo === 'ponta');
  const antes = draft.est;
  const depois = eletrico ? HubFio.completa(antes, [p.x, p.y]) : HubFio.fixa(antes, [p.x, p.y]);
  if (depois.pts.length === antes.pts.length) return;
  propagaNet(p.net);
  const ops = segmentosNovos(antes, depois);
  for (const op of ops) CH.push(op);
  draft.passos.push({ ops, est:antes, layer:draft.layer });
  draft.est = depois;
  if (eletrico) { draft.est = null; draft.passos = []; draft.net = ''; }   /* chegou num ponto eletrico: a trilha acaba ali */
  commit();
  pintaStatus();
}
function rotaBackspace(){
  if (!draft || draft.tipo !== 'rota' || !draft.est) return false;
  const ult = draft.passos.pop();
  if (!ult) { draft.est = null; pintaStatus(); pede(); return true; }
  for (const op of ult.ops) { const i = CH.indexOf(op); if (i >= 0) CH.splice(i, 1); }
  draft.est = ult.est;
  if (ult.layer && ult.layer !== draft.layer) { draft.layer = ult.layer; cur = ult.layer; }
  commit();
  pintaStatus();
  return true;
}
/* 2: via sem trocar de camada; * e Ctrl+2: via e a trilha segue na outra camada de cobre.
   A via cai no ponto do cursor (o L ate ele e completado), como no Altium. Com o roteador, o
   caminho ate ela e o da previa, e ela so entra se a rota chegou ao cursor e a via ali nao
   encosta em cobre de outra net -- senao nada e fixado. */
function rotaVia(trocaCamada){
  if (!draft || draft.tipo !== 'rota' || !draft.est || tool !== 'trilha') return false;
  const p = snapPonto(cursorW || { x:draft.est.pts[draft.est.pts.length - 1][0], y:draft.est.pts[draft.est.pts.length - 1][1] }, null, { camada:draft.layer });
  const antes = draft.est;
  let depois = null;
  const r = motorLigado() ? calculaRota(p) : null;
  if (r) {
    const elet = eletricoP(p);
    if (!r.completa) { const t = 'via não posta: ' + textoParou(r, bloqueioDaRota(r, p, draft.net)); avisoRota(t); HubDialog.toast(t, 'warn', 4500); pintaStatus(); return true; }
    if (elet && draft.net && p.net && p.net !== draft.net) {
      const t = 'via não posta: ' + descObstaculo({ tipo:p.tipo === 'ponta' ? 'trilha' : p.tipo, net:p.net }) + ' é outra net — ' + porqueObstaculo({ net:p.net });
      avisoRota(t); HubDialog.toast(t, 'warn'); return true;
    }
    const cs = conflitosDaViaNova(p, viaDaNet(draft.net || (elet ? p.net : '') || '').size, draft.net || (elet ? p.net : '') || '', idsDaTrilha());
    if (cs && cs.length) { avisaConflito('via não posta', cs); pintaStatus(); return true; }
    if (cs) { depois = estDepois(antes, r.pts.slice(1), [p.x, p.y]); limpaAvisoRota(); }
  }
  if (!depois) depois = HubFio.completa(antes, [p.x, p.y]);
  propagaNet(p.net);
  const ops = segmentosNovos(antes, depois);
  const vd = viaDaNet(draft.net);
  const via = { op:'via_add', x:r6(p.x), y:r6(p.y), size:r6(vd.size), drill:r6(vd.drill) };
  if (draft.net) via.net = draft.net;
  via.note = trocaCamada ? 'via da trilha (troca de camada)' : 'via da trilha';
  ops.push(via);
  for (const op of ops) CH.push(op);
  const layerAntes = draft.layer;
  draft.passos.push({ ops, est:antes, layer:layerAntes });
  if (trocaCamada) { draft.layer = proximaCobre(draft.layer); cur = draft.layer; }
  draft.est = HubFio.novo([p.x, p.y], depois.modo, depois.primeiro);
  commit();
  pintaStatus();
  return true;
}
function rotaTermina(){
  if (draft && draft.tipo === 'rota' && draft.est) { draft.est = null; draft.passos = []; draft.net = ''; pintaStatus(); pede(); return true; }
  return false;
}
function rotaEspaco(shift){
  if (!draft || draft.tipo !== 'rota') draft = novaRota();
  if (!draft) return;
  if (!draft.est) {
    if (shift) { CFG.modo = HubFio.MODOS[(HubFio.MODOS.indexOf(CFG.modo) + 1) % HubFio.MODOS.length]; }
    else if (CFG.modo === '45') lembraCanto.p45 = HubFio.inverte('45', lembraCanto.p45);
    else if (CFG.modo === '90') lembraCanto.p90 = HubFio.inverte('90', lembraCanto.p90);
  } else {
    draft.est = shift ? HubFio.trocaModo(draft.est, lembraCanto) : HubFio.trocaCanto(draft.est);
    CFG.modo = draft.est.modo;
    if (draft.est.modo === '45') lembraCanto.p45 = draft.est.primeiro;
    if (draft.est.modo === '90') lembraCanto.p90 = draft.est.primeiro;
  }
  pintaStatus(); if (painel) painel.atualiza(); pede();
}

/* ---- formas e o resto ---- */
const circuloPts = (cx, cy, r, n) => { const out = []; for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; out.push([r6(cx + r * Math.cos(a)), r6(cy + r * Math.sin(a))]); } return out; };
const nCirculo = r => Math.max(24, Math.min(96, Math.ceil(2 * Math.PI * r / 0.2)));
/* lados que se cruzam: o Altium e o Gerber nao aceitam region assim (o motor recusaria) */
function seCruza(pts){
  const n = pts.length;
  const lado = (a, b, c) => { const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); return Math.abs(v) < 1e-12 ? 0 : (v > 0 ? 1 : -1); };
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    const p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[j], p4 = pts[(j + 1) % n];
    if (lado(p1, p2, p3) * lado(p1, p2, p4) < 0 && lado(p3, p4, p1) * lado(p3, p4, p2) < 0) return true;
  }
  return Math.abs(area2(pts)) < 1e-9;
}
function poeForma(pts, fechada, nota){
  const lay = camadaDesenho(); if (!lay) return false;
  if (preencher && fechada) {
    if (seCruza(pts)) { HubDialog.toast('polígono com lados que se cruzam (ou sem área) — o Altium e o Gerber não aceitam', 'warn'); return false; }
    const op = { op:'region_add', layer:lay, pts:pts.map(p => [r6(p[0]), r6(p[1])]), note:nota };
    CH.push(op); (selDepois = [op]);
  } else {
    const n = pts.length, ops = [];
    for (let i = 0; i < (fechada ? n : n - 1); i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) continue;
      ops.push({ op:'track_add', layer:lay, x1:r6(a[0]), y1:r6(a[1]), x2:r6(b[0]), y2:r6(b[1]), w:r6(CFG.wLinha), note:nota });
    }
    if (!ops.length) return false;
    for (const op of ops) CH.push(op);
    selDepois = ops;
  }
  commit();
  return true;
}
/* ============================== a regua (Ctrl+M) ==============================
   Como a Cota inteligente do NexoCAD (pedido do dono, 2026-10-29): o 1o clique marca um ponto, o
   2o marca o outro (ou: aperta num, arrasta e solta no outro), e a cota fica na mao -- mexer o mouse
   escolhe por onde passa a linha (acima/abaixo = horizontal, ao lado = vertical, no meio =
   alinhada; Espaco troca) e o clique a deixa na placa. Os pontos agarram em centro, ponta, meio,
   quadrante, vertice, canto, borda do cobre e tangente de circulo (hub-pcbcotas.js); fora deles, a
   grade; Ctrl solta. draft = { tipo:'medida', a, b, modo:'auto'|..., q } */
function snapMedida(w, ev){
  if (ev && ev.ctrlKey) return { x:r6(w.x), y:r6(w.y), tipo:'livre' };
  if (HCOT && snapObj !== 'off') {
    let idx = null;
    try { idx = HCOT.indice(EB, { centroCobre, ehTH, recortes:recortesDaTela() }); } catch (e) { console.warn('régua:', e); }
    const vis = l => camVisivel(l) && (snapObj !== 'atual' || l === cur || l === '_placa' || (l === 'Multi' && cobre(cur)));
    const s = idx ? HCOT.agarra(idx, w, px(10), { visivel:vis }) : null;
    if (s) return s;
  }
  const g = snapPonto(w, ev, { soGrade:true });
  return { x:g.x, y:g.y, tipo:'grade' };
}
const MODOS_CICLO = ['auto', 'alinhada', 'h', 'v'];
function cotaDoDraft(q){
  if (!draft || draft.tipo !== 'medida' || !draft.a) return null;
  const b = draft.b || SNAP || (cursorW ? { x:cursorW.x, y:cursorW.y, tipo:'livre' } : null);
  if (!b) return null;
  return { id:'_', a:draft.a, b, modo:draft.b ? (draft.modo || 'auto') : 'alinhada', q:draft.b ? (q || draft.q || null) : null };
}
function ponto2(b){
  if (Math.hypot(b.x - draft.a.x, b.y - draft.a.y) < 1e-6 && !(b.circ && draft.a.circ)) { HubDialog.toast('o segundo ponto é o mesmo do primeiro', 'info', 1400); return false; }
  draft.b = b; draft.q = cursorW ? { x:cursorW.x, y:cursorW.y } : { x:b.x, y:b.y }; SNAP = null;
  avisoRodape('mexa o mouse para levar a linha da cota (acima/abaixo: horizontal · ao lado: vertical · no meio: alinhada · Espaço troca) e clique para deixá-la na placa');
  return true;
}
function cliqueMedida(w, ev){
  if (!draft || draft.tipo !== 'medida') { draft = { tipo:'medida', a:snapMedida(w, ev), b:null, modo:'auto' }; SNAP = snapMedida(w, ev); pintaStatus(); pede(); return; }
  if (!draft.b) { ponto2(snapMedida(w, ev)); pintaStatus(); if (painel) painel.atualiza(); pede(); return; }
  fixaCota({ x:w.x, y:w.y });
}
function fixaCota(q){
  const c = cotaDoDraft(q);
  if (!c || !HCOT) { draft = null; return; }
  const g = HCOT.geometria(c);
  let n = 0; for (const x of COTAS) { const k = parseInt(String(x.id).replace(/^m/, ''), 10); if (isFinite(k) && k > n) n = k; }
  const limpa = p => { const o = { x:r6(p.x), y:r6(p.y), tipo:p.tipo || 'grade' }; if (p.circ) { o.circ = { cx:r6(p.circ.cx), cy:r6(p.circ.cy), r:r6(p.circ.r) }; if (p.cond) o.cond = p.cond; } return o; };
  const nova = { id:'m' + (n + 1), a:limpa(c.a), b:limpa(c.b), modo:g ? g.modo : 'alinhada', q:{ x:r6(q.x), y:r6(q.y) } };
  COTAS.push(nova);
  gravaCotas();
  draft = null; SNAP = null;
  if (!show.cotas) setCotasVer(true); else pintaBarra();
  avisoRodape('cota ' + (g ? textoCota(g) : '') + ' na placa · o botão da régua com olho, na barra, esconde e mostra as cotas · Esc larga a régua');
  pintaStatus(); if (painel) painel.atualiza(); pede();
}
/* a medida da hora, no rodape e na ficha */
function medidaAoVivo(){
  const c = cotaDoDraft();
  const g = c && HCOT ? HCOT.geometria(c) : null;
  if (!g) return '';
  return 'medida ' + fmtDist(g.valor) + ' ' + unidade + (g.modo !== 'alinhada' ? ' (' + HCOT.MODOS[g.modo] + ')' : '') +
    ' · distância ' + fmtDist(g.dist) + ' · dX ' + fmtDist(g.dx) + ' · dY ' + fmtDist(g.dy);
}
/* ============================== a pilha de camadas (o Layer Stack Manager do hub) ==============================
   Pedido do dono (2026-10-29): "quero que fique fácil de adicionar mais layers ou remover, configurar
   espessura de layer". Uma linha stack_set no changes.js, editada no lugar (o motor: hub-core » stackDaOp
   e aplicaPilha; a pilha muda as abas, o Gerber -- uma camada por cobre -- e a espessura do 3D).
   Sem stack_set, a pilha mostrada e a do espelho do Altium, com cobre de 1 oz e o dieletrico repartido
   pela espessura da placa. Tirar camada com objeto o motor recusa, e o aviso diz quantos. */
const COBRE_PADRAO = 0.035;
const PILHAS_PRONTAS = {
  2:[1.53],
  4:[0.2, 1.065, 0.2],
  6:[0.2, 0.3, 0.36, 0.3, 0.2],
  8:[0.15, 0.2, 0.2, 0.25, 0.2, 0.2, 0.15],
};
function pilhaAtual(){
  const st = EB.stackup;
  if (st && Array.isArray(st.layers)) return { camadas:st.layers.map(l => Object.assign({ name:'' }, l)), mech:LAYERS.filter(l => l.kind === 'mech').map(l => l.key), definida:true };
  const sinal = LAYERS.filter(l => l.kind === 'signal'), n = sinal.length, esp = espessuraPlaca();
  const d = n > 1 ? Math.max(0.05, r6((esp - n * COBRE_PADRAO) / (n - 1))) : 0;
  const doEb = k => (EB.layers || []).find(x => x && x.key === k) || {};
  const camadas = sinal.map((l, i) => {
    const b = doEb(l.key), c = { key:l.key, name:'', copper:isNum(b.copper) && b.copper > 0 ? b.copper : COBRE_PADRAO };
    if (i < n - 1) c.dielectric = isNum(b.dielectric) && b.dielectric > 0 ? b.dielectric : d;
    return c;
  });
  return { camadas, mech:LAYERS.filter(l => l.kind === 'mech').map(l => l.key), definida:false };
}
function opDaPilha(p){
  return { op:'stack_set', layers:p.camadas.map((c, i) => {
    const o = { key:c.key, copper:r6(c.copper) };
    if (c.name) o.name = String(c.name);
    if (i < p.camadas.length - 1) o.dielectric = r6(c.dielectric);
    return o;
  }), mech:p.mech.slice(), note:'pilha de camadas definida no hub' };
}
/* grava a pilha: confere no motor ANTES (camada com objeto nao sai) e edita a linha que ja existe */
function gravaPilha(p, msg){
  if (LEAN || !garanteEdicao()) return false;
  const op = opDaPilha(p);
  const i = CH.findIndex(x => x && x.op === 'stack_set');
  const teste = CH.slice();
  if (i >= 0) teste[i] = op; else teste.unshift(op);
  let it = null;
  try { it = HC.applyPcbChanges(B, teste).changeItems[i >= 0 ? i : 0]; }
  catch (e) { HubDialog.toast('pilha: ' + (e && e.message || e), 'err'); return false; }
  if (it && it.status === 'err') { HubDialog.toast(it.msg, 'warn', 7000); if (painel) painel.atualiza(); return false; }
  if (i >= 0) { CH[i] = op; for (let j = CH.length - 1; j > i; j--) if (CH[j] && CH[j].op === 'stack_set') CH.splice(j, 1); }
  else CH.unshift(op);          /* no comeco: o que for desenhado nas camadas novas vem depois dela */
  commit();
  if (msg) HubDialog.toast(msg, it && it.status === 'warn' ? 'warn' : 'ok', 2600);
  return true;
}
function midLivre(p){ for (let n = 1; n <= 30; n++) if (!p.camadas.some(c => c.key === 'Mid' + n)) return 'Mid' + n; return null; }
const PILHA = {
  ver(){
    const p = pilhaAtual(), cnt = k => (LBYK[k] && LBYK[k].count) || 0;
    const esp = p.camadas.reduce((s, c) => s + c.copper + (c.dielectric || 0), 0);
    const temMech = new Set(p.mech);
    return {
      definida:p.definida, espessura:r6(esp), unidade:'mm',
      camadas:p.camadas.map((c, i) => ({ key:c.key, rot:LBYK[c.key] ? rotuloAba(LBYK[c.key]) : c.key, cor:corDe(c.key), name:c.name || '',
        copper:c.copper, dielectric:c.dielectric, count:cnt(c.key), ultima:i === p.camadas.length - 1,
        podeTirar:/^Mid/.test(c.key) && !cnt(c.key) })),
      mech:p.mech.map(k => ({ key:k, rot:nomeDe(k), cor:corDe(k), count:cnt(k), podeTirar:!cnt(k) })),
      mechLivres:Array.from({ length:16 }, (_, i) => 'Mech' + (i + 1)).filter(k => !temMech.has(k)).map(k => ({ key:k, rot:(HC.pcbLayer(k) || {}).name || k })),
    };
  },
  edita(key, campo, valor){
    const p = pilhaAtual(), c = p.camadas.find(x => x.key === key); if (!c) return;
    if (campo === 'name') c.name = String(valor || '').trim().slice(0, 40);
    else { const v = Number(valor); if (!isNum(v) || v <= 0) { HubDialog.toast('espessura em mm, maior que zero', 'warn'); if (painel) painel.atualiza(); return; } c[campo] = r6(v); }
    gravaPilha(p);
  },
  maisCobre(){
    const p = pilhaAtual(), k = midLivre(p); if (!k) { HubDialog.toast('a pilha já tem as 30 camadas internas', 'warn'); return; }
    /* entra logo acima da Bottom, dividindo o dieletrico que havia ali */
    const n = p.camadas.length, acima = p.camadas[n - 2], d = r6(Math.max(0.05, (acima.dielectric || 0.2) / 2));
    acima.dielectric = d;
    p.camadas.splice(n - 1, 0, { key:k, name:'', copper:COBRE_PADRAO, dielectric:d });
    if (gravaPilha(p, nomeDe(k) + ' entrou na pilha (' + (n + 1) + ' camadas de cobre)')) { setVisivel(k, true); setCur(k); }
  },
  tiraCobre(key){
    const p = pilhaAtual(), i = p.camadas.findIndex(c => c.key === key);
    if (i <= 0 || i >= p.camadas.length - 1) return;
    /* o dieletrico dela soma no de cima: a placa so perde o cobre */
    p.camadas[i - 1].dielectric = r6((p.camadas[i - 1].dielectric || 0) + (p.camadas[i].dielectric || 0) + p.camadas[i].copper);
    p.camadas.splice(i, 1);
    if (cur === key) setCur('Top');
    gravaPilha(p, nomeDe(key) + ' saiu da pilha');
  },
  pronta(n){
    const D = PILHAS_PRONTAS[n]; if (!D) return;
    const p = pilhaAtual(), mids = p.camadas.filter(c => /^Mid/.test(c.key)).map(c => c.key);
    const chaves = ['Top'];
    for (let i = 0; i < n - 2; i++) chaves.push(mids[i] || null);
    chaves.push('Bottom');
    const tmp = { camadas:[] };
    for (const k of chaves) tmp.camadas.push({ key:k || midLivre({ camadas:tmp.camadas.concat(p.camadas) }) });
    p.camadas = tmp.camadas.map((c, i) => {
      const velho = pilhaAtual().camadas.find(x => x.key === c.key) || {};
      const o = { key:c.key, name:velho.name || '', copper:isNum(velho.copper) ? velho.copper : COBRE_PADRAO };
      if (i < n - 1) o.dielectric = D[i];
      return o;
    });
    gravaPilha(p, 'pilha de ' + n + ' camadas, ' + fmtNum(p.camadas.reduce((s, c) => s + c.copper + (c.dielectric || 0), 0), 3) + ' mm');
  },
  maisMech(key){ const p = pilhaAtual(); if (!/^Mech\d+$/.test(key) || p.mech.indexOf(key) >= 0) return; p.mech.push(key); if (gravaPilha(p, nomeDe(key) + ' entrou na placa')) setVisivel(key, true); },
  tiraMech(key){ const p = pilhaAtual(); p.mech = p.mech.filter(k => k !== key); if (cur === key) setCur('Top'); gravaPilha(p, nomeDe(key) + ' saiu da placa'); },
  /* volta a pilha do espelho do Altium (tira a linha stack_set) */
  doAltium(){
    const i = CH.findIndex(x => x && x.op === 'stack_set'); if (i < 0) return;
    if (!garanteEdicao()) return;
    /* seguro: camada com objeto continua nas abas (boardLayers conta o uso) e no Gerber */
    for (let j = CH.length - 1; j >= 0; j--) if (CH[j] && CH[j].op === 'stack_set') CH.splice(j, 1);
    commit();
    HubDialog.toast('pilha de volta à do Altium', 'ok', 2000);
  },
};
/* ---- o vao das vias (pedido do dono, 2026-10-29) ---- */
/* from/to so quando a via nao e passante (Top-Bottom e o padrao do motor e do Altium) */
function poeVao(op, de, ate){ if (de && ate && de !== ate && !((de === 'Top' && ate === 'Bottom') || (de === 'Bottom' && ate === 'Top'))) { op.from = de; op.to = ate; } return op; }
const opcCobreVia = () => LAYERS.filter(l => l.kind === 'signal').map(l => ({ v:l.key, rot:rotuloAba(l), cor:l.color }));
const viaDe = () => (CFG.viaDe && LBYK[CFG.viaDe] && LBYK[CFG.viaDe].kind === 'signal') ? CFG.viaDe : 'Top';
const viaAte = () => (CFG.viaAte && LBYK[CFG.viaAte] && LBYK[CFG.viaAte].kind === 'signal') ? CFG.viaAte : 'Bottom';
function vaoTexto(e){
  const de = e.from || 'Top', ate = e.to || 'Bottom';
  if ((de === 'Top' && ate === 'Bottom') || (de === 'Bottom' && ate === 'Top')) return 'Passante: atravessa todas as camadas de cobre.';
  const cega = de === 'Top' || de === 'Bottom' || ate === 'Top' || ate === 'Bottom';
  return (cega ? 'Via cega' : 'Via enterrada') + ' (' + nomeDe(de) + ' → ' + nomeDe(ate) + '): só liga essas camadas e as do meio. Confira se o fabricante faz — custa mais.';
}
function cliqueFerramenta(w, ev){
  if (tool === 'colar') { colaNoPonto(w, ev); return; }
  if (tool === 'pad') { poePad(w, ev); return; }
  if (tool === 'trilha' || tool === 'linha') { rotaClique(w, ev); return; }
  if (tool === 'medir') { cliqueMedida(w, ev); return; }
  if (tool === 'sinalizar') {
    /* clicar numa bandeira que ja existe a pega (para ver, mudar ou apagar), em vez de pôr outra em cima */
    const ex = hitsEm(w.x, w.y).find(a => a.t === 'ann');
    if (ex) {
      setTool('select'); selSo([ex]);
      if (painel) painel.mostra('props');
      avisoRodape('sinalizador ' + ex.ann.id + ' selecionado — ' + (teclaDe('apagar') || 'Delete') + ' apaga (ou o botão Apagar no painel)');
      return;
    }
    abreAnnForm(snapPonto(w, ev, { soGrade:true })); return;
  }
  if (tool === 'texto') { const lay = camadaDesenho(); if (lay) abreCaixaTexto(snapPonto(w, ev, { soGrade:true })); return; }
  if (tool === 'via') {
    const p = snapPonto(w, ev);
    const net = motorEdicao() ? netDaViaNova(p) : (p.net || CFG.viaNet);
    const vd = viaDaNet(net);
    const op = { op:'via_add', x:p.x, y:p.y, size:r6(vd.size), drill:r6(vd.drill) };
    poeVao(op, viaDe(), viaAte());
    if (net) op.net = net;
    /* via encostada em cobre de outra net nao entra (o conflito em ignorar e o escape) */
    if (motorEdicao()) { const cs = conflitosDaViaNova(p, vd.size, net, []); if (cs && cs.length) { avisaConflito('via não posta', cs); return; } limpaAvisoRota(); }
    op.note = 'via do hub';
    CH.push(op); selDepois = [op]; commit(); return;
  }
  if (tool === 'furo') {
    /* clicou num circulo desenhado (serigrafia, mecanica, cobre...): ele vira o furo de fixacao */
    const circ = hitsEm(w.x, w.y).find(circuloDoAlvo);
    if (circ) { if (marcacoesSemFuro([circ]).length) furosDosCirculos([circ], true); else HubDialog.toast('essa marcação já tem furo', 'info'); return; }
    const p = snapPonto(w, ev, { soGrade:true }), r = CFG.furo / 2;
    const op = { op:'region_add', cutout:true, pts:circuloPts(p.x, p.y, r, 36), note:'furo de fixação ' + fmtNum(CFG.furo, 2) + ' mm' };
    CH.push(op); selDepois = [op]; commit(); return;
  }
  const p = snapPonto(w, ev);
  if (tool === 'arco') {
    if (!draft || draft.tipo !== 'arco') { draft = { tipo:'arco', c:p, ini:null }; pede(); return; }
    if (!draft.ini) { if (Math.hypot(p.x - draft.c.x, p.y - draft.c.y) < 1e-4) return; draft.ini = p; pede(); return; }
    const lay = camadaDesenho(); if (!lay) return;
    const r = Math.hypot(draft.ini.x - draft.c.x, draft.ini.y - draft.c.y);
    const sa = normAng(Math.atan2(draft.ini.y - draft.c.y, draft.ini.x - draft.c.x) / RAD);
    let ea = normAng(Math.atan2(p.y - draft.c.y, p.x - draft.c.x) / RAD);
    if (Math.abs(ea - sa) < 1e-6) ea = sa + 360;
    const op = { op:'arc_add', layer:lay, cx:draft.c.x, cy:draft.c.y, r:r6(r), sa, ea:r6(ea), w:r6(CFG.wLinha), note:'arco do hub' };
    draft = null; CH.push(op); selDepois = [op]; commit(); return;
  }
  if (tool === 'circulo') {
    if (!draft || draft.tipo !== 'circulo') { draft = { tipo:'circulo', c:p }; pede(); return; }
    const r = Math.hypot(p.x - draft.c.x, p.y - draft.c.y), c = draft.c;
    if (r < 1e-4) return;
    draft = null;
    if (preencher) { poeForma(circuloPts(c.x, c.y, r, nCirculo(r)), true, 'círculo cheio do hub'); return; }
    const lay = camadaDesenho(); if (!lay) return;
    const op = { op:'arc_add', layer:lay, cx:c.x, cy:c.y, r:r6(r), sa:0, ea:360, w:r6(CFG.wLinha), note:'círculo do hub' };
    CH.push(op); selDepois = [op]; commit(); return;
  }
  if (tool === 'retangulo' || tool === 'triangulo') {
    if (!draft || draft.tipo !== tool) { draft = { tipo:tool, a:p }; pede(); return; }
    const a = draft.a;
    if (Math.abs(p.x - a.x) < 1e-4 || Math.abs(p.y - a.y) < 1e-4) return;
    draft = null;
    if (tool === 'retangulo') {
      if (preencher) {
        const lay = camadaDesenho(); if (!lay) return;
        const op = { op:'fill_add', layer:lay, x1:r6(Math.min(a.x, p.x)), y1:r6(Math.min(a.y, p.y)), x2:r6(Math.max(a.x, p.x)), y2:r6(Math.max(a.y, p.y)), rot:0, note:'retângulo cheio do hub' };
        CH.push(op); selDepois = [op]; commit(); return;
      }
      poeForma([[a.x, a.y], [p.x, a.y], [p.x, p.y], [a.x, p.y]], true, 'retângulo do hub'); return;
    }
    poeForma(verticesTriangulo(a, p), true, preencher ? 'triângulo cheio do hub' : 'triângulo do hub'); return;
  }
  if (tool === 'pour' && CFG.pourForma === 'retangulo') {
    if (!draft || draft.tipo !== 'pourRet') { draft = { tipo:'pourRet', a:p, layer:camadaDoTipo() }; pede(); return; }
    const a = draft.a;
    if (Math.abs(p.x - a.x) < 1e-4 || Math.abs(p.y - a.y) < 1e-4) return;
    draft = null;
    criaPlano([[a.x, a.y], [p.x, a.y], [p.x, p.y], [a.x, p.y]]); return;
  }
  if (tool === 'poligono' || tool === 'contorno' || tool === 'pour') {
    if (!draft || draft.tipo !== tool) { draft = { tipo:tool, pts:[[p.x, p.y]], layer:tool === 'pour' ? camadaDoTipo() : undefined }; pede(); return; }
    const pts = draft.pts, p0 = pts[0], ult = pts[pts.length - 1];
    if (pts.length >= 3 && Math.hypot(p.x - p0[0], p.y - p0[1]) <= px(8)) { fechaPoligono(); return; }
    if (Math.hypot(p.x - ult[0], p.y - ult[1]) < 1e-6) return;
    pts.push([p.x, p.y]); pede(); return;
  }
}
/* o triangulo cabe na caixa dos dois cliques: base no primeiro clique, bico no meio da outra borda */
function verticesTriangulo(a, b){ return [[a.x, a.y], [b.x, a.y], [(a.x + b.x) / 2, b.y]]; }
async function fechaPoligono(){
  if (!draft || (draft.tipo !== 'poligono' && draft.tipo !== 'contorno' && draft.tipo !== 'pour')) return false;
  const pts = draft.pts.slice(), tipo = draft.tipo;
  if (pts.length < 3) { HubDialog.toast('o polígono precisa de pelo menos 3 vértices', 'warn'); return true; }
  draft = null; pede();
  if (tipo === 'poligono') { poeForma(pts, true, preencher ? 'polígono cheio do hub' : 'polígono do hub'); return true; }
  if (tipo === 'pour') { if (seCruza(pts)) { HubDialog.toast('polígono com lados que se cruzam — desenhe de novo', 'warn'); return true; } criaPlano(pts); return true; }
  if (seCruza(pts)) { HubDialog.toast('contorno com lados que se cruzam — desenhe de novo', 'warn'); return true; }
  const ok = await HubDialog.confirm('Trocar o contorno da placa pelo polígono de ' + pts.length + ' vértices?\n\nO outline_set SUBSTITUI o contorno inteiro no Altium (o ApplyChanges ainda pergunta de novo antes de aplicar). Contorno com arco se desenha no Altium.',
    { title:'Contorno da placa', ok:'Trocar o contorno', danger:true });
  if (!ok) return true;
  const ant = ultimoOp(x => x.op === 'outline_set');
  const op = { op:'outline_set', pts:pts.map(p => [r6(p[0]), r6(p[1])]), note:'contorno desenhado no hub' };
  if (ant) CH.splice(CH.indexOf(ant), 1, op); else CH.push(op);
  commit();
  HubDialog.toast('contorno trocado (' + pts.length + ' vértices) — salve para gravar o changes.js', 'ok');
  return true;
}
function desfazPontoPoligono(){
  if (!draft) return false;
  if ((draft.tipo === 'poligono' || draft.tipo === 'contorno' || draft.tipo === 'pour') && draft.pts.length) {
    draft.pts.pop(); if (!draft.pts.length) draft = null; pede(); return true;
  }
  if (draft.tipo === 'arco' && draft.ini) { draft.ini = null; pede(); return true; }
  if (draft.tipo === 'arco' || draft.tipo === 'circulo' || draft.tipo === 'retangulo' || draft.tipo === 'triangulo' || draft.tipo === 'pourRet') { draft = null; pede(); return true; }
  return false;
}

/* ---- texto: a caixa de digitar no proprio canvas (nada de prompt) ---- */
let caixaPonto = null;
function abreCaixaTexto(p){
  const box = $('txtbox'), inp = $('txtinp');
  if (!box || !inp) return;
  caixaPonto = { x:p.x, y:p.y, layer:cur };
  const s = mundoParaTela(p.x, p.y);
  box.style.left = Math.round(s.x) + 'px'; box.style.top = Math.round(s.y) + 'px';
  box.hidden = false;
  inp.value = '';
  $('txtdica').textContent = nomeDe(cur) + (ladoBaixo(cur) ? ' · espelhado (face de baixo)' : '') + ' · Enter grava · Esc desiste';
  setTimeout(() => inp.focus(), 0);
}
function fechaCaixaTexto(){ const box = $('txtbox'); if (box) box.hidden = true; caixaPonto = null; }
function gravaCaixaTexto(){
  if (!caixaPonto) return;
  const s = limpaTxt($('txtinp').value).replace(/[\r\n]+/g, ' ').trim();
  const p = caixaPonto;
  fechaCaixaTexto();
  if (!s) return;
  const op = { op:'text_add', layer:p.layer, text:s, x:r6(p.x), y:r6(p.y), h:r6(CFG.hTexto), w:r6(CFG.wTexto), rot:0 };
  if (ladoBaixo(p.layer)) op.mirror = true;
  op.note = 'texto do hub';
  CH.push(op); selDepois = [op]; commit();
}

/* ---- sinalizador: o formulario de sempre, no tema ---- */
let annPendente = null;
function abreAnnForm(p){
  annPendente = { x:r6(p.x), y:r6(p.y) };
  $('anntext').value = '';
  $('annform').hidden = false;
  setTimeout(() => $('anntext').focus(), 0);
}
function fechaAnnForm(){ const f = $('annform'); if (f) f.hidden = true; annPendente = null; }
function annProxId(){
  let mx = 0;
  for (const a of ANN) { const n = parseInt(String(a.id || '').replace(/^n/, ''), 10); if (isFinite(n) && n > mx) mx = n; }
  return 'n' + (mx + 1);
}
function agoraTxt(){
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function gravaAnn(){
  const msg = $('anntext').value.trim().replace(/"/g, "'");
  if (!msg || !annPendente) return;
  const sevs = $('annsev').value;
  const a = { id:annProxId(), view:'pcb', x:annPendente.x, y:annPendente.y, layer:cur, severity:sevs,
              msg, ref:'', status:'open', created:agoraTxt(), reply:'' };
  ANN.push(a);
  fechaAnnForm();
  annChanged();
  selSo([annAlvo(a)]);
}
function annChanged(){ setAnnDirty(true); if (painel) painel.atualiza(); pede(); }

/* ============================== previas ============================== */

/* A rota do roteador: o que o clique fixa em linha cheia e o ultimo trecho tracejado (a perna de
   antecipacao de sempre, que o clique num ponto qualquer nao fixa). Rota que nao chega (completa
   false) e toda cheia -- o clique fixa ate ali --, com um X vermelho onde parou e uma linha fina
   vermelha tracejada ate o cursor. */
function desenhaRota(r, c, cor){
  const P = r.pts, n = P.length - 1;
  const tracejaUlt = r.completa && n >= 2, cheios = tracejaUlt ? n - 1 : n;
  ctx.save(); ctx.strokeStyle = cor; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(draft.w, px(1));
  if (cheios > 0) {
    ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]);
    for (let i = 1; i <= cheios; i++) ctx.lineTo(P[i][0], P[i][1]);
    ctx.stroke();
  }
  if (tracejaUlt) { ctx.globalAlpha = 0.6; ctx.setLineDash([px(6), px(4)]); ctx.beginPath(); ctx.moveTo(P[n - 1][0], P[n - 1][1]); ctx.lineTo(P[n][0], P[n][1]); ctx.stroke(); }
  ctx.restore();
  if (r.completa) return;
  const f = P[n], s = px(5);
  ctx.save(); ctx.strokeStyle = COR.del; ctx.lineCap = 'round';
  if (Math.hypot(c.x - f[0], c.y - f[1]) > 1e-9) {
    ctx.globalAlpha = 0.8; ctx.lineWidth = px(1); ctx.setLineDash([px(4), px(3)]);
    ctx.beginPath(); ctx.moveTo(f[0], f[1]); ctx.lineTo(c.x, c.y); ctx.stroke();
  }
  ctx.globalAlpha = 1; ctx.setLineDash([]); ctx.lineWidth = px(2);
  ctx.beginPath(); ctx.moveTo(f[0] - s, f[1] - s); ctx.lineTo(f[0] + s, f[1] + s); ctx.moveTo(f[0] - s, f[1] + s); ctx.lineTo(f[0] + s, f[1] - s); ctx.stroke();
  ctx.restore();
}
function desenhaFerramenta(){
  /* a regua: a cota na mao (do 1o ponto ao cursor, depois com a linha no arrasto) e o agarre */
  if (tool === 'medir') {
    const op = { px, aTela:mundoParaTela, DPR, voltaMundo:transformaMundo, fonte:fonteVista(), cor:COR.snap };
    const c = cotaDoDraft();
    if (c && HCOT) { try { HCOT.desenha(ctx, HCOT.geometria(c), opCota(true)); } catch (e) { transformaMundo(); } }
    if (draft && draft.a && HCOT) {
      /* o 1o ponto fica marcado (com o circulo, se for tangente) */
      const a = draft.a;
      ctx.save(); ctx.strokeStyle = COR.medida; ctx.lineWidth = px(1.4); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(a.x, a.y, px(4), 0, 2 * Math.PI); ctx.stroke();
      if (a.circ) { ctx.globalAlpha = 0.5; ctx.setLineDash([px(4), px(3)]); ctx.beginPath(); ctx.arc(a.circ.cx, a.circ.cy, a.circ.r, 0, 2 * Math.PI); ctx.stroke(); }
      ctx.restore();
    }
    if (SNAP && HCOT && !(draft && draft.b)) { try { HCOT.desenhaAgarre(ctx, SNAP, op); } catch (e) { transformaMundo(); } }
    return;
  }
  /* o ponto de snap num objeto: o anel ciano */
  if (SNAP && tool !== 'select' && (SNAP.tipo === 'pad' || SNAP.tipo === 'via' || SNAP.tipo === 'ponta')) {
    ctx.save(); ctx.strokeStyle = COR.snap; ctx.lineWidth = px(1.5); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(SNAP.x, SNAP.y, px(7), 0, 2 * Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(SNAP.x - px(10), SNAP.y); ctx.lineTo(SNAP.x + px(10), SNAP.y); ctx.moveTo(SNAP.x, SNAP.y - px(10)); ctx.lineTo(SNAP.x, SNAP.y + px(10)); ctx.stroke();
    ctx.restore();
  }
  const c = SNAP || (cursorW ? { x:cursorW.x, y:cursorW.y } : null);
  if (!c) return;
  const lay = draft && draft.layer ? draft.layer : cur, cor = corDe(lay);
  if (draft && draft.tipo === 'rota' && draft.est) {
    /* a Trilha com o roteador: a rota ate o snap (sem motor, ou no ignorar, as pernas de sempre) */
    const r = tool === 'trilha' ? calculaRota(c) : null;
    if (r) { desenhaRota(r, c, cor); return; }
    const pe = HubFio.pernas(draft.est, [c.x, c.y]);
    ctx.save(); ctx.strokeStyle = cor; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(draft.w, px(1));
    if (pe.perna1) { ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.moveTo(pe.perna1[0][0], pe.perna1[0][1]); ctx.lineTo(pe.perna1[1][0], pe.perna1[1][1]); ctx.stroke(); }
    if (pe.perna2) { ctx.globalAlpha = 0.6; ctx.setLineDash([px(6), px(4)]); ctx.beginPath(); ctx.moveTo(pe.perna2[0][0], pe.perna2[0][1]); ctx.lineTo(pe.perna2[1][0], pe.perna2[1][1]); ctx.stroke(); }
    ctx.restore();
    return;
  }
  if (tool === 'colar') { desenhaColagem(c); return; }
  ctx.save();
  ctx.strokeStyle = cor; ctx.fillStyle = cor; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const wl = Math.max(CFG.wLinha, px(1));
  if (tool === 'via' || (tool === 'trilha' && !(draft && draft.est))) {
    if (tool === 'via') {
      ctx.globalAlpha = 0.6; ctx.fillStyle = corDe('Multi'); ctx.beginPath(); ctx.arc(c.x, c.y, CFG.viaSize / 2, 0, 2 * Math.PI); ctx.fill(); ctx.fillStyle = COR.furo; ctx.beginPath(); ctx.arc(c.x, c.y, CFG.viaDrill / 2, 0, 2 * Math.PI); ctx.fill();
      /* a via que o clique recusaria (encosta em cobre de outra net): o anel vermelho avisa antes */
      const cs = conflitosNaPrevia(c);
      if (cs && cs.length) { ctx.globalAlpha = 0.95; ctx.strokeStyle = COR.del; ctx.lineWidth = px(2); ctx.setLineDash([]); ctx.beginPath(); ctx.arc(c.x, c.y, CFG.viaSize / 2 + px(3), 0, 2 * Math.PI); ctx.stroke(); }
    }
  } else if (tool === 'furo') {
    ctx.globalAlpha = 0.9; ctx.strokeStyle = COR.contorno; ctx.lineWidth = px(1.3); ctx.setLineDash([px(4), px(3)]);
    ctx.beginPath(); ctx.arc(c.x, c.y, CFG.furo / 2, 0, 2 * Math.PI); ctx.stroke();
  } else if (draft && draft.tipo === 'arco') {
    ctx.globalAlpha = 0.8; ctx.lineWidth = px(1); ctx.setLineDash([px(4), px(3)]);
    const ini = draft.ini || c, r = Math.hypot(ini.x - draft.c.x, ini.y - draft.c.y);
    ctx.beginPath(); ctx.moveTo(draft.c.x, draft.c.y); ctx.lineTo(ini.x, ini.y); ctx.stroke();
    ctx.beginPath(); ctx.arc(draft.c.x, draft.c.y, px(3), 0, 2 * Math.PI); ctx.stroke();
    if (draft.ini && r > 0) {
      const sa = Math.atan2(draft.ini.y - draft.c.y, draft.ini.x - draft.c.x), ea = Math.atan2(c.y - draft.c.y, c.x - draft.c.x);
      ctx.setLineDash([]); ctx.lineWidth = wl; ctx.beginPath(); ctx.arc(draft.c.x, draft.c.y, r, sa, ea === sa ? sa + 2 * Math.PI : ea, false); ctx.stroke();
    }
  } else if (draft && draft.tipo === 'circulo') {
    const r = Math.hypot(c.x - draft.c.x, c.y - draft.c.y);
    ctx.beginPath(); ctx.arc(draft.c.x, draft.c.y, r, 0, 2 * Math.PI);
    if (preencher) { ctx.globalAlpha = 0.5; ctx.fill(); } else { ctx.globalAlpha = 0.85; ctx.lineWidth = wl; ctx.stroke(); }
  } else if (draft && draft.tipo === 'pourRet') {
    const pts = [[draft.a.x, draft.a.y], [c.x, draft.a.y], [c.x, c.y], [draft.a.x, c.y]];
    if (tipoPour().indexOf('sem:') === 0) hachura(pts, draft.layer === 'Multi' ? COR.contorno : cor);
    else { const P = new Path2D(); pPoli(P, pts); ctx.globalAlpha = 0.3; ctx.fill(P); ctx.globalAlpha = 0.95; ctx.setLineDash([px(6), px(3)]); ctx.lineWidth = px(1.3); ctx.stroke(P); }
  } else if (draft && (draft.tipo === 'retangulo' || draft.tipo === 'triangulo')) {
    const pts = draft.tipo === 'retangulo' ? [[draft.a.x, draft.a.y], [c.x, draft.a.y], [c.x, c.y], [draft.a.x, c.y]] : verticesTriangulo(draft.a, c);
    const P = new Path2D(); pPoli(P, pts);
    if (preencher) { ctx.globalAlpha = 0.5; ctx.fill(P); } else { ctx.globalAlpha = 0.85; ctx.lineWidth = wl; ctx.stroke(P); }
  } else if (draft && (draft.tipo === 'poligono' || draft.tipo === 'contorno' || draft.tipo === 'pour')) {
    const pts = draft.pts.concat([[c.x, c.y]]);
    if (draft.tipo === 'contorno') { ctx.strokeStyle = COR.seta; ctx.lineWidth = px(1.6); }
    else ctx.lineWidth = wl;
    if (preencher && draft.tipo === 'poligono' && pts.length >= 3) { const P = new Path2D(); pPoli(P, pts); ctx.globalAlpha = 0.4; ctx.fill(P); }
    ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const q of pts.slice(1)) ctx.lineTo(q[0], q[1]); ctx.stroke();
    if (pts.length >= 3) { ctx.setLineDash([px(4), px(3)]); ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(pts[0][0], pts[0][1]); ctx.stroke(); }
    ctx.setLineDash([]); ctx.fillStyle = COR.seta; for (const q of draft.pts) { ctx.beginPath(); ctx.arc(q[0], q[1], px(2.5), 0, 2 * Math.PI); ctx.fill(); }
  }
  ctx.restore();
}

/* ============================== arrasto e janela ============================== */

let arrasto = null;      /* {alvos, bases:Map, inicio, dx, dy, moveu, girou, ref, pivo} ou {ponta:{alvo, qual}, base, ...} */
let janela = null;       /* {a:{x,y}, b:{x,y}, shift} em coordenadas de tela */
function objetosDoComp(m){
  const out = [], nome = String(m.eff.designator || m.src.ref), ec = IDX.ebComp.get(m);
  for (const p of (ec && ec.pads) || []) out.push({ kind:'pad', o:p });
  for (const x of (IDX.donos.get(nome) || [])) out.push(x);
  return out;
}
function excluiDoArrasto(alvos){
  const S = new Set();
  for (const a of alvos) {
    if (a.t === 'comp') { for (const x of objetosDoComp(a.m)) S.add(x.o); }
    else if (a.m) { const o = ebDe(a.m); if (o) S.add(o); }
    else if (a.t === 'recorte') S.add(a.eb);
  }
  return S;
}
/* ── AS ALCAS (pedido do dono, 2026-10-23: "editar com clique e arraste, regular o tamanho, tipo
   Canva, clicando nas bordas e aumentando ou diminuindo") ──
   A selecao de contornos (plano, sem plano, regiao, recorte do hub), de fill (giro em multiplo de
   90) ou de varias trilhas ganha a caixa com 8 alcas: canto ou borda (a alca ou a propria linha da
   caixa) estica a partir do lado oposto, na grade; Shift no canto mantem a proporcao, Ctrl solta a
   grade. Um contorno so, que nao e retangulo, mostra tambem os vertices: arrastar um muda a forma. */
const MIN_LADO = 0.01;
const ALCAS = [['x1', 'y1'], ['x2', 'y1'], ['x2', 'y2'], ['x1', 'y2'], ['x1', null], ['x2', null], [null, 'y1'], [null, 'y2']];
function ptsDoGeo(t, g){
  if (t === 'fill') return fillCantos(g);
  if (t === 'track') return [[g.x1, g.y1], [g.x2, g.y2]];
  return g.points || [];
}
function ehRetangulo(pts){
  if (!pts || pts.length !== 4) return false;
  const b = bbPts(pts);
  return pts.every(p => (near(p[0], b[0]) || near(p[0], b[2])) && (near(p[1], b[1]) || near(p[1], b[3])));
}
function alcasDaSel(){
  if (tool !== 'select' || !editOn || LEAN || !SEL.length) return null;
  const alvos = [];
  for (const a of SEL) {
    if (!a.m || a.m.deleted) return null;
    const ok = a.t === 'poly' || a.t === 'semplano'
      || (a.t === 'region' && !(a.m.src && Array.isArray(a.m.src.holes) && a.m.src.holes.length))
      || (a.t === 'recorte' && !circuloDePts((a.m.eff.points || []).map(p => [p[0], p[1]])))
      || (a.t === 'fill' && Math.abs(normAng(a.m.eff.rot || 0) % 90) < 1e-6)
      || (a.t === 'track' && SEL.length > 1);
    if (!ok) return null;
    alvos.push(a);
  }
  const bases = new Map(alvos.map(a => [a, geoDe(a)]));
  const pts = [];
  for (const [a, g] of bases) { if (!g) return null; for (const p of ptsDoGeo(a.t, g)) pts.push(p); }
  const bb = bbPts(pts);
  if (!bb || bb[2] - bb[0] < 1e-6 || bb[3] - bb[1] < 1e-6) return null;
  const um = alvos.length === 1 && ehPts(alvos[0].t) ? bases.get(alvos[0]).points : null;
  return { alvos, bases, bb, vertices:um && !ehRetangulo(um) ? um : null };
}
const pontoAlca = (bb, h) => [h[0] === 'x1' ? bb[0] : h[0] === 'x2' ? bb[2] : (bb[0] + bb[2]) / 2,
                              h[1] === 'y1' ? bb[1] : h[1] === 'y2' ? bb[3] : (bb[1] + bb[3]) / 2];
/* a alca debaixo do ponto de TELA s: vertice, alca quadrada ou a linha da borda */
function alcaEm(s){
  const A = alcasDaSel();
  if (!A) return null;
  if (A.vertices) for (let i = 0; i < A.vertices.length; i++) {
    const q = mundoParaTela(A.vertices[i][0], A.vertices[i][1]);
    if (Math.hypot(s.x - q.x, s.y - q.y) <= 6) return { A, vert:i };
  }
  for (const h of ALCAS) {
    const p = pontoAlca(A.bb, h), q = mundoParaTela(p[0], p[1]);
    if (Math.abs(s.x - q.x) <= 6 && Math.abs(s.y - q.y) <= 6) return { A, h };
  }
  const a = mundoParaTela(A.bb[0], A.bb[1]), b = mundoParaTela(A.bb[2], A.bb[3]);
  const naX = s.x >= Math.min(a.x, b.x) && s.x <= Math.max(a.x, b.x), naY = s.y >= Math.min(a.y, b.y) && s.y <= Math.max(a.y, b.y);
  if (naY && Math.abs(s.x - a.x) <= 4) return { A, h:['x1', null] };
  if (naY && Math.abs(s.x - b.x) <= 4) return { A, h:['x2', null] };
  if (naX && Math.abs(s.y - a.y) <= 4) return { A, h:[null, 'y1'] };
  if (naX && Math.abs(s.y - b.y) <= 4) return { A, h:[null, 'y2'] };
  return null;
}
function cursorAlca(al){
  if (al.vert != null) return 'move';
  const h = al.h;
  if (!h[0]) return 'ns-resize';
  if (!h[1]) return 'ew-resize';
  const p = pontoAlca(al.A.bb, h), q = mundoParaTela(p[0], p[1]);
  const c = mundoParaTela((al.A.bb[0] + al.A.bb[2]) / 2, (al.A.bb[1] + al.A.bb[3]) / 2);
  return (q.x - c.x) * (q.y - c.y) > 0 ? 'nwse-resize' : 'nesw-resize';
}
/* o geo de um alvo com a caixa bb levada para nb (cada ponto na mesma proporcao) */
function escalaGeo(t, g, bb, nb){
  const kx = (nb[2] - nb[0]) / (bb[2] - bb[0]), ky = (nb[3] - nb[1]) / (bb[3] - bb[1]);
  const S = p => [nb[0] + (p[0] - bb[0]) * kx, nb[1] + (p[1] - bb[1]) * ky];
  if (t === 'track') { const a = S([g.x1, g.y1]), b = S([g.x2, g.y2]); return Object.assign({}, g, { x1:a[0], y1:a[1], x2:b[0], y2:b[1] }); }
  if (t === 'fill') {
    const v = bbPts(fillCantos(g)), a = S([v[0], v[1]]), b = S([v[2], v[3]]);
    const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, vw = b[0] - a[0], vh = b[1] - a[1];
    const deitado = Math.round(normAng(g.rot || 0) / 90) % 2 === 1;
    const uw = deitado ? vh : vw, uh = deitado ? vw : vh;
    return Object.assign({}, g, { x1:cx - uw / 2, y1:cy - uh / 2, x2:cx + uw / 2, y2:cy + uh / 2 });
  }
  return Object.assign({}, g, { points:g.points.map(S) });
}
function iniciaEstica(g){
  const A = g.al.A;
  arrasto = { estica:true, alvos:A.alvos, bases:A.bases, bb0:A.bb, h:g.al.h || null, vert:g.al.vert, moveu:true, novas:null, nb:null };
  EXCLUI = excluiDoArrasto(A.alvos); cacheSujo = true;
}
function atualizaEstica(e, w){
  const a = arrasto;
  const sx = e.ctrlKey ? w.x : snapV(w.x, grade.mm), sy = e.ctrlKey ? w.y : snapV(w.y, grade.mm);
  if (a.vert != null) {
    const al = a.alvos[0], g = a.bases.get(al), pts = g.points.map(p => p.slice());
    pts[a.vert] = [sx, sy];
    a.novas = new Map([[al, Object.assign({}, g, { points:pts })]]);
    avisoRodape('vértice ' + (a.vert + 1) + ' → (' + fmtDist(sx) + '; ' + fmtDist(sy) + ') ' + unidade + ' · Ctrl solta a grade · Esc desiste');
    pede(); return;
  }
  const bb = a.bb0, nb = bb.slice(), h = a.h;
  if (h[0] === 'x1') nb[0] = Math.min(sx, bb[2] - MIN_LADO); else if (h[0] === 'x2') nb[2] = Math.max(sx, bb[0] + MIN_LADO);
  if (h[1] === 'y1') nb[1] = Math.min(sy, bb[3] - MIN_LADO); else if (h[1] === 'y2') nb[3] = Math.max(sy, bb[1] + MIN_LADO);
  if (e.shiftKey && h[0] && h[1]) {
    const w0 = bb[2] - bb[0], h0 = bb[3] - bb[1], k = Math.max((nb[2] - nb[0]) / w0, (nb[3] - nb[1]) / h0);
    if (h[0] === 'x1') nb[0] = bb[2] - w0 * k; else nb[2] = bb[0] + w0 * k;
    if (h[1] === 'y1') nb[1] = bb[3] - h0 * k; else nb[3] = bb[1] + h0 * k;
  }
  a.nb = nb;
  a.novas = new Map(a.alvos.map(al => [al, escalaGeo(al.t, a.bases.get(al), bb, nb)]));
  avisoRodape('L ' + fmtDist(nb[2] - nb[0]) + ' × A ' + fmtDist(nb[3] - nb[1]) + ' ' + unidade + ' · Shift no canto mantém a proporção · Ctrl solta a grade · Esc desiste');
  pede();
}
function terminaEstica(a){
  if (!a.novas) { pede(); return; }
  for (const [al, g] of a.novas) if (g.points && seCruza(g.points)) { HubDialog.toast('o contorno ficaria com lados que se cruzam', 'warn'); pede(); return; }
  const r = editaConferindo(a.alvos, () => {
    let mexeu = false;
    for (const [al, g] of a.novas) if (escreveGeo(al, g)) mexeu = true;
    return mexeu;
  }, 'não deixa');
  if (r) commit(); else pede();
}
function desenhaEstica(){
  const a = arrasto;
  if (a.novas) for (const [al, g] of a.novas) desenhaGeoPrevia(al, g);
  if (a.nb) {
    ctx.save(); ctx.strokeStyle = COR.seta; ctx.setLineDash([px(4), px(3)]); ctx.lineWidth = px(1); ctx.globalAlpha = 0.9;
    ctx.strokeRect(a.nb[0], a.nb[1], a.nb[2] - a.nb[0], a.nb[3] - a.nb[1]); ctx.restore();
  }
}
function desenhaAlcas(){
  const A = alcasDaSel();
  if (!A) return;
  const bb = A.bb, r = px(4);
  ctx.save();
  ctx.strokeStyle = COR.seta; ctx.globalAlpha = 0.9; ctx.lineWidth = px(1); ctx.setLineDash([px(4), px(3)]);
  ctx.strokeRect(bb[0], bb[1], bb[2] - bb[0], bb[3] - bb[1]);
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  for (const h of ALCAS) {
    const p = pontoAlca(bb, h);
    ctx.fillStyle = COR.sel; ctx.fillRect(p[0] - r, p[1] - r, 2 * r, 2 * r);
    ctx.strokeStyle = '#1f6feb'; ctx.lineWidth = px(1.2); ctx.strokeRect(p[0] - r, p[1] - r, 2 * r, 2 * r);
  }
  if (A.vertices) for (const p of A.vertices) {
    ctx.beginPath(); ctx.arc(p[0], p[1], px(3.5), 0, 2 * Math.PI);
    ctx.fillStyle = COR.seta; ctx.fill(); ctx.strokeStyle = '#000000'; ctx.lineWidth = px(1); ctx.stroke();
  }
  ctx.restore();
}
function geoAtual(a){ const b = arrasto.bases.get(a); return b ? transladaGeo(a.t, b, arrasto.dx || 0, arrasto.dy || 0) : null; }
function desenhaArrasto(){
  if (!arrasto || (!arrasto.moveu && !arrasto.girou)) return;
  if (arrasto.ponta) {
    const a = arrasto.ponta.alvo, o = Object.assign({}, ebDe(a.m) || a.m.eff, arrasto.pontaGeo || {});
    desenhaObj('track', o, corDe(o.layer), {});
    for (const v of (arrasto.pontaP && arrasto.pontaViz) || []) {
      const e = ebDe(v.al.m) || v.al.m.eff;
      desenhaObj('track', Object.assign({}, e, comPonta(e, v.qual, arrasto.pontaP)), corDe(e.layer), {});
    }
    realcaPonta(o, arrasto.ponta.qual);
    return;
  }
  if (arrasto.estica) { desenhaEstica(); return; }
  const P = arrasto.topo && arrasto.topo.plano;
  for (const a of arrasto.alvos) {
    const g = geoDoPlano(arrasto, a) || geoAtual(a);
    if (!g) continue;
    if (a.t === 'comp') { previaComp(a.m, g); continue; }
    if (a.t === 'ann') continue;
    desenhaGeoPrevia(a, g);
  }
  if (arrasto.topo) {
    const porId = new Map(P ? P.viz.map(v => [String(v.id), v.geo]) : []);
    for (const v of arrasto.topo.viz) desenhaGeoPrevia({ t:'track', m:v.m }, porId.get(v.id) || geoDe({ t:'track', m:v.m }));
    for (const l of (P && P.links) || []) desenhaObj('track', l, corDe(l.layer), {});
  }
  if (arrasto.cena && GUIAS) GUIAS.desenha(ctx, arrasto.cena, { escala:view.scale, fmt:fmtGuia });
  if (arrasto.ima) {
    ctx.save(); ctx.strokeStyle = COR.snap; ctx.lineWidth = px(1.5);
    ctx.beginPath(); ctx.arc(arrasto.ima.x, arrasto.ima.y, px(7), 0, 2 * Math.PI); ctx.stroke(); ctx.restore();
  }
}
/* um alvo (que nao e componente) desenhado no geo `g` -- o arrasto e o esticar */
function desenhaGeoPrevia(a, g){
  const e = ebDe(a.m) || (a.m && a.m.eff) || a.eb;
  if (!e) return;
  if (a.t === 'text') {
    const o = Object.assign({}, e, { x:g.x, y:g.y, rot:g.rot, mirror:g.mirror });
    if (Array.isArray(e.polys)) {
      if (nearAng(g.rot, e.rot || 0) && !!g.mirror === !!e.mirror) { const dx = g.x - e.x, dy = g.y - e.y; o.polys = e.polys.map(q => ({ hole:q.hole, pts:q.pts.map(p => [p[0] + dx, p[1] + dy]) })); }
      else delete o.polys;
    }
    desenhaObj('text', o, corDe(e.layer), {});
    return;
  }
  const contorno = a.t === 'recorte' || a.t === 'poly' || a.t === 'semplano';
  const kind = contorno ? 'region' : a.t;
  const o = Object.assign({}, e, g);
  const cor = a.t === 'via' ? corDe('Multi') : a.t === 'recorte' || (a.t === 'semplano' && (!e.layer || e.layer === 'Multi')) ? COR.contorno : corDe(e.layer);
  desenhaObj(kind, o, cor, contorno ? { contorno:true, dash:a.t === 'recorte' ? null : [6, 3] } : {});
  if (a.t === 'via' && e.drill > 0) desenhaObj('via', { x:g.x, y:g.y, size:e.drill }, COR.furo, {});
}
function realcaPonta(o, qual){
  const x = qual === 1 ? o.x1 : o.x2, y = qual === 1 ? o.y1 : o.y2;
  ctx.save(); ctx.strokeStyle = COR.sel; ctx.lineWidth = px(1.5);
  ctx.beginPath(); ctx.arc(x, y, Math.max((o.w || 0) / 2, px(4)), 0, 2 * Math.PI); ctx.stroke(); ctx.restore();
}
/* o componente na mao: os objetos dele pelo xfObject do motor, do lugar efetivo para o novo
   (o flip e o giro saem pela mesma conta que o Gerber usa) */
function previaComp(m, g){
  const fake = { src:{ x:m.eff.x, y:m.eff.y, rot:isNum(m.eff.rot) ? m.eff.rot : 0, layer:m.eff.layer },
                 eff:{ x:g.x, y:g.y, rot:g.rot, layer:g.layer } };
  if (m.pares) Object.defineProperty(fake, 'pares', { value:m.pares, enumerable:false });
  const d = HC.compDelta(fake);
  const lado = ladoDaVista();
  { const ec = EB.components[model.comps.indexOf(m)];
    pintaSilhuetas(silhuetasDe(ec).map(q => q.map(p => { const r = HC.xfPoint(d, p[0], p[1]); return [r.x, r.y]; })), g.layer); }
  for (const { kind, o } of objetosDoComp(m)) {
    const t = HC.xfObject(d, o, kind === 'track' ? 'line' : kind);
    if (!t) continue;
    if (kind === 'pad') {
      const th = ehTH(t), lay = th ? 'Multi' : t.layer;
      if (!camVisivel(lay)) continue;
      const f = formaLado(t, lado), c = centroCobre(t), P = new Path2D();
      pForma(P, c[0], c[1], f.w, f.h, t.rot, f.shape, f.radius);
      ctx.save(); ctx.fillStyle = corDe(lay); ctx.fill(P);
      if (th && t.drill > 0) { const F = new Path2D(); pFuro(F, t); ctx.fillStyle = COR.furo; ctx.fill(F); }
      ctx.restore();
      continue;
    }
    if (!camVisivel(t.layer)) continue;
    const k = kind === 'line' ? 'track' : kind;
    desenhaObj(k, t, corDe(t.layer), k === 'region' ? {} : {});
  }
  const ca = m.src.bbox;
  if (ca && [ca.x1, ca.y1, ca.x2, ca.y2].every(isNum)) {
    const c = [[ca.x1, ca.y1], [ca.x2, ca.y1], [ca.x2, ca.y2], [ca.x1, ca.y2]].map(p => {
      const q0 = m.changed ? HC.xfPoint(HC.compDelta(m), p[0], p[1]) : { x:p[0], y:p[1] };
      const q = HC.xfPoint(d, q0.x, q0.y); return [q.x, q.y]; });
    const P = new Path2D(); pPoli(P, c);
    ctx.save(); ctx.strokeStyle = COR.sel; ctx.setLineDash([px(5), px(3)]); ctx.lineWidth = px(1.2); ctx.stroke(P); ctx.restore();
  }
}
function desenhaJanela(){
  if (!janela) return;
  const a = telaParaMundo(janela.a.x, janela.a.y), b = telaParaMundo(janela.b.x, janela.b.y);
  const dentro = janela.b.x >= janela.a.x;
  ctx.save();
  const cor = dentro ? COR.dentro : COR.toca;
  ctx.fillStyle = cor; ctx.strokeStyle = cor; ctx.globalAlpha = 0.12;
  ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  ctx.globalAlpha = 0.9; ctx.lineWidth = px(1); ctx.setLineDash(dentro ? [] : [px(5), px(3)]);
  ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  ctx.restore();
}

/* ============================== unidade e numeros ============================== */

function fmtNum(v, dec){
  if (!isNum(v)) return '—';
  let s = v.toFixed(dec);
  if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
  if (s === '-0') s = '0';
  return s.replace('.', ',');
}
const emUnid = mm => unidade === 'mil' ? mm * MM_MIL : mm;
const fmtDist = mm => fmtNum(emUnid(mm), unidade === 'mil' ? 2 : 4);
const fmtFixo = mm => isNum(mm) ? emUnid(mm).toFixed(unidade === 'mil' ? 1 : 3).replace('.', ',') : '—';
/* "12,7", "12.7", "500mil", "0,254 mm": sem sufixo vale a unidade da tela */
function parseDist(s){
  const t = String(s == null ? '' : s).trim().toLowerCase().replace(',', '.');
  const m = t.match(/^(-?\d*\.?\d+(?:e-?\d+)?)\s*(mm|mil)?$/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  if (!isFinite(v)) return null;
  return (m[2] || unidade) === 'mil' ? v / MM_MIL : v;
}
function parseNum(s){
  const t = String(s == null ? '' : s).trim().replace(',', '.').replace(/°$/, '').trim();
  if (!/^-?\d*\.?\d+(?:e-?\d+)?$/.test(t)) return null;
  const v = parseFloat(t);
  return isFinite(v) ? v : null;
}
function setUnidade(u){
  unidade = u === 'mil' ? 'mil' : 'mm';
  gravaPref('unidade', unidade);
  pintaStatus(); if (painel) painel.atualiza(); pede();
  HubDialog.toast('unidade: ' + unidade, 'info', 1600);
}
function setGrade(id){
  grade = gradePorId(id);
  gravaPref('grade', grade.id);
  pintaStatus(); if (painel) painel.atualiza(); pede();
}

/* ============================== trava de edicao ==============================
   A vista abre em LEITURA: o arrasto acidental nao mexe na placa. Escolher uma ferramenta ou
   mudar um campo do painel destrava (com aviso); E trava de novo. lean=1 nunca destrava. */
function setEdit(v){
  editOn = !!v && !LEAN;
  if (!editOn) {
    if (tool !== 'select') { tool = 'select'; encerraDraft(); cv.style.cursor = 'default'; }
    if (arrasto) cancelaArrasto();
  }
  pintaBarra();
  if (painel) painel.atualiza();
  pede();
}

/* ============================== barra de status ============================== */

let ultimoCursor = null;
function pintaCursor(w){
  ultimoCursor = w;
  const el = $('sxy'); if (!el) return;
  el.textContent = w ? 'X ' + fmtFixo(w.x) + '  Y ' + fmtFixo(w.y) + ' ' + unidade : '—';
}
function pintaStatus(){
  if (LEAN) return;
  const g = $('sgrade');
  if (g) g.textContent = 'grade ' + grade.rot + (unidade === 'mil' ? ' (' + fmtNum(grade.mm * MM_MIL, 2) + ' mil)' : ' (' + fmtNum(grade.mm, 4) + ' mm)');
  const sw = $('scamsw'), sn = $('scamn');
  if (sw) sw.style.background = corDe(cur);
  if (sn) sn.textContent = nomeDe(cur) + (show.unica ? ' · camada única' : '') + (view.flip ? ' · vista de baixo' : '');
  const r = $('srota');
  if (r) {
    let s = '';
    if (tool === 'trilha' || tool === 'linha') {
      const modo = draft && draft.est ? HubFio.nomeDoModo(draft.est) : (CFG.modo === 'livre' ? 'ângulo livre' : CFG.modo + '°');
      s = (tool === 'trilha' ? 'trilha ' : 'linha ') + modo + ' · W ' + fmtDist(tool === 'trilha' ? CFG.wTrilha : CFG.wLinha);
      if (tool === 'trilha' && draft && draft.net) s += ' · ' + draft.net;
      if (tool === 'trilha') s += ' · via ' + fmtDist(CFG.viaSize) + '/' + fmtDist(CFG.viaDrill) + ' · ' + statusConflito();
    } else if (tool === 'medir') {
      s = draft && draft.tipo === 'medida' && draft.a ? medidaAoVivo() : 'régua · clique no 1º ponto · ' + COTAS.length + (COTAS.length === 1 ? ' cota' : ' cotas') + (show.cotas ? '' : ' (escondidas)');
    } else if (tool !== 'select') s = FERRAMENTA_ROT[tool] + (preencher && /circulo|retangulo|triangulo|poligono/.test(tool) ? ' · cheio' : '');
    r.textContent = s;
  }
  pintaCursor(ultimoCursor);
}
function rotuloAlvo(a){
  if (!a) return '';
  switch (a.t) {
    case 'comp': return (a.m.eff.designator || a.m.src.ref) + ' · ' + (a.m.src.footprint || '') + ' · ' + a.m.eff.layer;
    case 'pad': return (a.comp ? (a.comp.eff.designator || a.comp.src.ref) + '.' : 'pad ') + (a.pad.name || '') + (a.eb.net ? ' · ' + a.eb.net : '');
    case 'track': { const e = a.m.eff; return (cobre(e.layer) ? 'trilha ' : 'linha ') + (a.m.added ? 'nova' : a.m.src.id) + ' · ' + nomeDe(e.layer) + (e.net ? ' · ' + e.net : '') + ' · W ' + fmtDist(e.w); }
    case 'arc': { const e = a.m.eff; return 'arco ' + (a.m.added ? 'novo' : a.m.src.id) + ' · ' + nomeDe(e.layer) + (e.net ? ' · ' + e.net : ''); }
    case 'via': { const e = a.m.eff; return 'via ' + (a.m.added ? 'nova' : a.m.src.id) + (e.net ? ' · ' + e.net : '') + ' · ' + fmtDist(e.size) + '/' + fmtDist(e.drill); }
    case 'fill': return 'fill ' + (a.m.added ? 'novo' : a.m.src.id) + ' · ' + nomeDe(a.m.eff.layer);
    case 'region': return 'região ' + (a.m.added ? 'nova' : a.m.src.id) + ' · ' + nomeDe(a.m.eff.layer);
    case 'regiao-ro': return 'região ' + a.eb.id + ' · ' + nomeDe(a.eb.layer) + (a.eb.poly ? ' · polígono' : '');
    case 'recorte': return 'recorte da placa' + (a.m ? ' (novo)' : ' ' + a.eb.id);
    case 'poly': { const e = a.m.eff; return 'plano ' + (a.m.added ? 'novo' : a.m.src.id) + ' · ' + nomeDe(e.layer) + ' · ' + (e.net || 'sem net'); }
    case 'semplano': { const l = a.m ? a.m.eff.layer : a.eb.layer; return 'sem plano · ' + (!l || l === 'Multi' ? 'todas as camadas' : nomeDe(l)) + (a.m ? '' : ' (do Altium)'); }
    case 'text': { const s = a.m.src || {}; const e = ebDe(a.m) || a.m.eff;
      return s.designator ? 'designator ' + s.owner : s.comment ? 'comment ' + s.owner : 'texto "' + String(e.text || '').slice(0, 30) + '" · ' + nomeDe(e.layer); }
    case 'ann': return '⚑ ' + a.ann.id + ': ' + a.ann.msg;
    case 'cota': { const g = geoCota(a.cota); return 'cota ' + (g ? textoCota(g) + ' · ' + (HCOT.MODOS[g.modo] || g.modo) : ''); }
  }
  return '';
}
function pintaStatusSel(){
  const el = $('ssel'); if (!el) return;
  if (!SEL.length) { el.textContent = ''; return; }
  if (SEL.length === 1) { el.textContent = 'sel.: ' + rotuloAlvo(SEL[0]); return; }
  el.textContent = SEL.length + ' selecionados';
}
function avisoRodape(t){ const el = $('smsg'); if (el) el.textContent = t || ''; }

/* ============================== a barra flutuante (Active Bar) ==============================
   Cada ferramenta a vista, menos as formas de desenho: pedido do dono (2026-10-23), "todo esse
   conjunto podia estar junto, com uma setinha para abrir uma gaveta, ao inves de deixar a barra
   grande desse jeito". O grupo mostra a ultima forma usada (o clique nela a escolhe) e a setinha
   abre a gaveta com as outras, como as listas da Active Bar do Altium. O que ainda nao existe
   aparece TRAVADO, com o porque no title. */
/* O cadeado da edicao saiu daqui (pedido do dono, 2026-10-29): mora nas Propriedades da placa, com
   nada selecionado (hub-pcbpainel.js » desenhaPlaca); a tecla E e o botao direito continuam. */
const BARRA = [
  { id:'select', ic:'select', tool:'select', titulo:'Selecionar e mover (Esc) — arrastar no vazio: janela (esq→dir dentro, dir→esq toca)' }, '|',
  { id:'trilha', ic:'trilha', tool:'trilha', at:'trilha', titulo:'Trilha — roteamento interativo: clique fixa o canto, Espaço inverte, Shift+Espaço 45°/90°/livre, Shift+R contorna, para no obstáculo ou ignora (trilhas de nets diferentes não se encontram), Backspace desfaz o trecho, 2 via, * ou Ctrl+2 via e troca de camada, Tab largura, botão direito termina' },
  { id:'via', ic:'via', tool:'via', at:'via', titulo:'Via — diâmetro e furo no painel' },
  /* 2026-10-28: o auto-roteador em lote (hub-autoroteador.js), o Route » Auto Route » All do Altium */
  { id:'autorotear', ic:'autorotear', acao:'autorotear', at:'autorotear', titulo:'Auto-rotear (Route » Auto Route » All) — liga as conexões abertas em várias camadas, com vias, pelas regras do projeto; mostra a prévia antes de aplicar' }, '|',
  { id:'formas', titulo:'Formas de desenho', grupo:[
    { id:'linha', ic:'linha', tool:'linha', at:'linha', titulo:'Linha na camada atual — cliques encadeados, botão direito termina' },
    { id:'arco', ic:'arco', tool:'arco', at:'arco', titulo:'Arco — centro, início e fim' },
    { id:'circulo', ic:'circulo', tool:'circulo', at:'circulo', titulo:'Círculo — centro e raio (com Preencher: região cheia)' },
    { id:'retangulo', ic:'retangulo', tool:'retangulo', at:'retangulo', titulo:'Retângulo — dois cantos (com Preencher: fill)' },
    { id:'triangulo', ic:'triangulo', tool:'triangulo', titulo:'Triângulo — dois cantos da caixa (com Preencher: região cheia)' },
    { id:'poligono', ic:'poligono', tool:'poligono', at:'poligono', titulo:'Polígono — um clique por vértice; duplo clique, Enter ou botão direito fecha (com Preencher: região cheia)' },
  ] },
  { id:'texto', ic:'texto', tool:'texto', at:'texto', titulo:'Texto — clique e digite (Enter grava); na face de baixo nasce espelhado' },
  { id:'preencher', ic:'preencher', acao:'preencher', at:'preencher', titulo:'Preencher — ligado: círculo, triângulo e polígono viram região cheia e o retângulo vira fill; desligado: contorno de trilhas' }, '|',
  { id:'furo', ic:'furo', tool:'furo', titulo:'Furo de fixação — Board Cutout redondo (diâmetro no painel)' },
  { id:'contorno', ic:'contorno', tool:'contorno', titulo:'Contorno da placa — polígono que substitui o contorno (pergunta antes)' },
  { id:'pad', ic:'pad', tool:'pad', at:'pad', titulo:'Pad avulso (Place » Pad) — passante redondo de 60 mil, furo 30 mil' },
  /* o plano de terra em retangulo e em poligono livre e a mesma ferramenta: uma gaveta so, como a das
     formas (pedido do dono, 2026-10-29). O item leva a forma (CFG.pourForma) junto com a ferramenta */
  { id:'planos', titulo:'Polygon Pour (plano de terra)', grupo:[
    { id:'pourRet', ic:'pour', tool:'pour', forma:'retangulo', at:'pour', titulo:'Polygon Pour em retângulo — dois cantos; plano (Top/Bottom) ou sem plano, tipo e net no painel; selecionado, as bordas esticam' },
    { id:'pourLivre', ic:'pourLivre', tool:'pour', forma:'livre', at:'pour', titulo:'Polygon Pour em polígono livre — um clique por vértice; duplo clique, Enter ou botão direito fecha; tipo e net no painel' },
  ] },
  { id:'teardrops', ic:'teardrop', acao:'teardrops', at:'teardrops', titulo:'Teardrops (Tools » Teardrops) — põe os que faltam nos pads e vias' }, '|',
  { id:'medir', ic:'medir', tool:'medir', at:'medir', titulo:'Régua — marque dois pontos (centro, ponta, meio, quadrante, vértice, canto, borda, tangente), arraste a linha e clique: a cota fica na placa' },
  /* o olho das cotas da regua (pedido do dono, 2026-10-29) */
  { id:'cotas', ic:'cotas', acao:'cotas', titulo:'Cotas da régua' },
  { id:'sinalizar', ic:'sinalizar', tool:'sinalizar', at:'sinalizar', titulo:'Sinalizar um problema para a IA (annotations.js)' },
  { id:'ratsnest', ic:'ratsnest', acao:'ratsnest', at:'ratsnest', titulo:'Linhas de conexão (ratsnest) — Ctrl+clique num cobre realça a net, Esc limpa' },
  /* o olho das marcações das mudanças (pedido do dono, 2026-10-28): fechado, fica só a placa como ela está */
  { id:'marcas', ic:'eye', acao:'diff', at:'diff', titulo:'Marcações das mudanças' }, '|',
  /* Desfazer/Refazer sairam daqui (pedido do dono, 2026-10-23): moram no fim da fileira "Placa |
     Gerber" do hub (hub-pcbdesfazer.js), e Ctrl+Z/Ctrl+Y e o menu Editar continuam valendo */
  { id:'regras', ic:'regras', acao:'regras', at:'regras', titulo:'Regras de projeto (Design » Rules)' },
  { id:'drc', ic:'drc', acao:'drc', at:'drc', rotulo:'DRC', titulo:'Design Rule Check (Tools » Design Rule Check) — o relatório no painel Messages' },
  { id:'eco', ic:'eco', acao:'atualizarPcb', at:'atualizarPcb', titulo:'Atualizar a PCB pelo esquema (Design » Update PCB Document: o ECO)' },
  { id:'novaPlaca', ic:'novaPlaca', acao:'novaPlaca', at:'novaPlaca', titulo:'Placa nova (o Board Wizard no padrão da casa)' },
  /* Gerber e PDF sairam daqui (pedido do dono, 2026-10-14): ficam so no Arquivo, como no Altium
     (File » Fabrication Outputs » Gerber Files e File » Smart PDF) */
];
/* os botoes de verdade da barra: os soltos e os de dentro das gavetas */
const itensBarra = () => BARRA.reduce((l, b) => l.concat(b && b.grupo ? b.grupo : [b]), []);
const GRUPO_ATUAL = {};
/* o botao esta na mao? o da gaveta do Polygon Pour so com a forma dele (a mesma ferramenta, duas formas) */
const ativoNaBarra = it => !!it.tool && it.tool === tool && (!it.forma || CFG.pourForma === it.forma);
/* escolher um item com forma: troca a forma e pega a ferramenta; o mesmo de novo larga (alterna) */
function escolheForma(it, alterna){
  const muda = CFG.pourForma !== it.forma;
  if (muda) configTool('pourForma', it.forma);
  if (tool === it.tool) { if (!muda && alterna) setTool('select'); else pintaBarra(); return; }
  setTool(it.tool);
}
function atualDoGrupo(b){
  const naMao = b.grupo.find(ativoNaBarra);
  if (naMao) return naMao;
  const porForma = b.grupo.find(x => x.forma && x.forma === CFG.pourForma);
  if (porForma) return porForma;
  const id = GRUPO_ATUAL[b.id] || lePref('grupo.' + b.id, b.grupo[0].id);
  return b.grupo.find(x => x.id === id) || b.grupo[0];
}
function fechaGavetas(exceto){
  for (const g of document.querySelectorAll('#pcbtb .gaveta')) if (g !== exceto && !g.hidden) {
    g.hidden = true;
    const s = g.parentNode && g.parentNode.querySelector('.gseta'); if (s) s.setAttribute('aria-expanded', 'false');
  }
}
function montaGrupo(b){
  const box = document.createElement('span'); box.className = 'grupo'; box.id = 'tb-' + b.id;
  const prin = document.createElement('button'); prin.type = 'button'; prin.className = 'gprin'; prin.setAttribute('aria-pressed', 'false');
  const seta = document.createElement('button'); seta.type = 'button'; seta.className = 'gseta';
  seta.setAttribute('aria-haspopup', 'true'); seta.setAttribute('aria-expanded', 'false');
  seta.title = b.titulo + ' — abrir a gaveta'; seta.setAttribute('aria-label', seta.title);
  seta.append(HubPcbIcones.icone('gaveta'));
  const gav = document.createElement('div'); gav.className = 'gaveta'; gav.hidden = true; gav.setAttribute('role', 'group'); gav.setAttribute('aria-label', b.titulo);
  for (const it of b.grupo) {
    const el = document.createElement('button');
    el.type = 'button'; el.id = 'tb-' + it.id; el.dataset.id = it.id;
    el.append(HubPcbIcones.icone(it.ic));
    if (it.tool) el.setAttribute('aria-pressed', 'false');
    el.addEventListener('click', () => {
      GRUPO_ATUAL[b.id] = it.id; gravaPref('grupo.' + b.id, it.id);
      fechaGavetas();
      fechaMenu();
      if (it.forma) escolheForma(it, false);
      else if (it.tool) { if (tool !== it.tool) setTool(it.tool); else pintaBarra(); } else fazAcao(it.acao);
    });
    gav.append(el);
  }
  prin.addEventListener('click', () => { fechaGavetas(); acaoDaBarra(atualDoGrupo(b)); });
  seta.addEventListener('click', () => {
    const abre = gav.hidden;
    fechaGavetas(gav);
    gav.hidden = !abre; seta.setAttribute('aria-expanded', String(abre));
  });
  box.append(prin, seta, gav);
  return box;
}
document.addEventListener('pointerdown', e => { if (!(e.target && e.target.closest && e.target.closest('#pcbtb .grupo'))) fechaGavetas(); }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') fechaGavetas(); }, true);
/* ── O FILTRO DE SELEÇÃO NO CANTO (pedido do dono, 2026-10-23: "na área de PCB um menuzinho de
   configuração no canto superior esquerdo, em transparência, com esses filtros, em lista; posso
   marcar todos ou um por um, com checkbox") ──
   O único Selection Filter da vista (o do painel saiu em 2026-10-28, era redundante); estado em filtro + V.setFiltro.
   O cabeçalho recolhe a lista (lembrado nas preferências desta máquina). */
let filtroRecolhido = lePref('filtroMenu', 'aberto') === 'recolhido';
function montaFiltroMenu(){
  const box = $('pcbfiltro');
  if (!box || LEAN) return;
  box.textContent = '';
  const cab = document.createElement('div'); cab.className = 'pf-cab'; cab.title = 'Filtro de seleção: o que o clique e a janela pegam';
  cab.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3 H14 L9.5 8.5 V13 L6.5 14 V8.5 Z"/></svg>';
  const nome = document.createElement('b'); nome.textContent = 'Filtro';
  const conta = document.createElement('span'); conta.id = 'pfConta';
  const seta = document.createElement('i'); seta.id = 'pfSeta'; seta.style.display = 'inline-flex';
  cab.append(nome, conta, seta);
  cab.addEventListener('click', () => { filtroRecolhido = !filtroRecolhido; gravaPref('filtroMenu', filtroRecolhido ? 'recolhido' : 'aberto'); pintaFiltroMenu(); });
  const lista = document.createElement('div'); lista.className = 'pf-lista';
  const linha = (k, rot, cls) => {
    const l = document.createElement('label'); if (cls) l.className = cls;
    const c = document.createElement('input'); c.type = 'checkbox'; c.dataset.k = k;
    c.addEventListener('change', () => V.setFiltro(k, c.checked));
    l.append(c, document.createTextNode(rot));
    return l;
  };
  lista.append(linha('*', 'Todos', 'pf-todos'));
  for (const [k, rot] of FILTROS) lista.append(linha(k, rot));
  box.append(cab, lista);
  pintaFiltroMenu();
}
function pintaFiltroMenu(){
  const box = $('pcbfiltro');
  if (!box || !box.firstChild) return;
  const n = FILTROS.filter(([k]) => filtro[k]).length;
  for (const c of box.querySelectorAll('input[data-k]')) {
    if (c.dataset.k === '*') { c.checked = n === FILTROS.length; c.indeterminate = n > 0 && n < FILTROS.length; }
    else c.checked = !!filtro[c.dataset.k];
  }
  $('pfConta').textContent = n === FILTROS.length ? 'todos' : n + '/' + FILTROS.length;
  $('pfSeta').innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="' + (filtroRecolhido ? 'M4 6 L8 10 L12 6' : 'M4 10 L8 6 L12 10') + '"/></svg>';
  box.classList.toggle('pf-recolhido', filtroRecolhido);
}
/* ── AS CAMADAS NO CANTO (pedido do dono, 2026-10-29: "quero poder ver só o layer que eu marquei, pra não
   mostrar tudo e não travar tanto") ──
   Embaixo do Filtro, no mesmo estilo: uma caixa por camada, "Todas" e "só esta" (passe o mouse). A
   escolha fica gravada por projeto (memVis), e camada escondida nao custa: nao entra no cache de desenho
   (montaCache), nas marcacoes das mudancas, no clique nem no agarre. Clicar no nome troca a camada atual. */
let camadasRecolhido = lePref('camadasMenu', 'aberto') === 'recolhido';
const VIS_PREF = 'vis.' + (PROJ || '_');
const VIS_SALVA = (() => { try { const v = JSON.parse(lePref(VIS_PREF, 'null')); return v && Array.isArray(v.ocultas) ? v : null; } catch (e) { return null; } })();
function salvaVis(){
  if (LEAN) return;
  const ocultas = LAYERS.filter(l => show.layers[l.key] === false).map(l => l.key);
  gravaPref(VIS_PREF, JSON.stringify({ ocultas, unica:!!show.unica }));
}
function montaCamadasMenu(){
  const box = $('pcbcamadas');
  if (!box || LEAN) return;
  box.textContent = '';
  const cab = document.createElement('div'); cab.className = 'pf-cab'; cab.title = 'Camadas à vista: desmarque o que não quer ver (a placa fica mais leve)';
  cab.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2 L14 5 L8 8 L2 5 Z"/><path d="M2 8 L8 11 L14 8"/><path d="M2 11 L8 14 L14 11"/></svg>';
  const nome = document.createElement('b'); nome.textContent = 'Camadas';
  const conta = document.createElement('span'); conta.className = 'pc-conta';
  const seta = document.createElement('i'); seta.className = 'pc-seta'; seta.style.display = 'inline-flex';
  cab.append(nome, conta, seta);
  cab.addEventListener('click', () => { camadasRecolhido = !camadasRecolhido; gravaPref('camadasMenu', camadasRecolhido ? 'recolhido' : 'aberto'); pintaCamadasMenu(); });
  const lista = document.createElement('div'); lista.className = 'pf-lista';
  const rod = document.createElement('div'); rod.className = 'pc-rodape';
  const bt = (rot, tit, f) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = rot; b.title = tit; b.addEventListener('click', f); rod.append(b); };
  bt('Cobre', 'Só as camadas de cobre (e a Multi-Layer)', () => conjunto('sinal'));
  bt('Cima', 'Só o lado de cima', () => conjunto('cima'));
  bt('Baixo', 'Só o lado de baixo', () => conjunto('baixo'));
  box.append(cab, lista, rod);
  pintaCamadasMenu();
}
function pintaCamadasMenu(){
  const box = $('pcbcamadas');
  if (!box || !box.firstChild || LEAN) return;
  const lista = box.querySelector('.pf-lista');
  lista.textContent = '';
  const n = LAYERS.filter(l => camVisivel(l.key)).length;
  const todos = document.createElement('label'); todos.className = 'pf-todos';
  const ct = document.createElement('input'); ct.type = 'checkbox'; ct.dataset.k = '*';
  ct.checked = n === LAYERS.length && !show.unica; ct.indeterminate = n > 0 && n < LAYERS.length;
  ct.addEventListener('change', () => { if (ct.checked) mostraTodas(); else { for (const l of LAYERS) show.layers[l.key] = l.key === cur; show.unica = false; pintaAbas(); pintaStatus(); if (painel) painel.atualiza(); pede(); } });
  todos.append(ct, document.createTextNode('Todas'));
  lista.append(todos);
  for (const l of LAYERS) {
    const lb = document.createElement('label');
    if (l.key === cur) lb.classList.add('atual');
    if (!l.used && !l.inBoard) lb.classList.add('vazia');
    const c = document.createElement('input'); c.type = 'checkbox'; c.dataset.k = l.key; c.checked = camVisivel(l.key);
    c.addEventListener('change', () => { if (show.unica) { for (const x of LAYERS) show.layers[x.key] = camVisivel(x.key); show.unica = false; } setVisivel(l.key, c.checked); });
    const sw = document.createElement('i'); sw.className = 'sw'; sw.style.background = l.color;
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = rotuloAba(l);
    nm.addEventListener('click', e => { e.preventDefault(); setCur(l.key); });
    const so = document.createElement('button'); so.type = 'button'; so.className = 'so'; so.textContent = 'só';
    so.title = 'Mostrar só ' + l.name;
    so.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); soEsta(l.key); });
    lb.title = l.name + (l.count ? ' — ' + l.count + ' objeto(s)' : ' — vazia') + '\ncaixa: mostrar/esconder · nome: camada atual · só: só esta';
    lb.append(c, sw, nm, so);
    lista.append(lb);
  }
  box.querySelector('.pc-conta').textContent = n === LAYERS.length ? 'todas' : n + '/' + LAYERS.length;
  box.querySelector('.pc-seta').innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="' + (camadasRecolhido ? 'M4 6 L8 10 L12 6' : 'M4 10 L8 6 L12 10') + '"/></svg>';
  box.classList.toggle('pf-recolhido', camadasRecolhido);
}
/* ── O OLHO DAS MARCAÇÕES (pedido do dono, 2026-10-28: "um ícone de olho pra suprimir as marcações de
   alteração da pcb; desativa o olho, fica só as trilhas e a placa") ──
   Esconde os fantasmas das mudanças (o original tracejado, o removido em vermelho, o novo com o contorno
   verde, as setas de onde estava). É o mesmo show.ghost da tecla D e do Preferences, e fica gravado.
   O botão é o 'marcas' da barra (pintaBarra troca olho aberto/fechado). */
function setMarcas(v){
  show.ghost = !!v;
  PREFS.fantasmas = show.ghost;
  const guarda = Object.assign({}, PREFS); delete guarda.conflito; delete guarda.conexoes;
  gravaPref('prefs', JSON.stringify(guarda));
  pintaBarra();
  if (painel) painel.atualiza(); pede();
}
function montaBarra(){
  const tb = $('pcbtb');
  if (!tb || LEAN) return;
  tb.textContent = '';
  for (const b of BARRA) {
    if (b === '|') { const s = document.createElement('span'); s.className = 'sep'; tb.append(s); continue; }
    if (b.grupo) { tb.append(montaGrupo(b)); continue; }
    const el = document.createElement('button');
    el.type = 'button'; el.id = 'tb-' + b.id; el.dataset.id = b.id;
    el.append(HubPcbIcones.icone(b.ic));
    if (b.rotulo) { const l = document.createElement('span'); l.className = 'lb'; l.textContent = b.rotulo; el.append(l); }
    if (b.trava) { el.disabled = true; el.title = b.trava; el.setAttribute('aria-label', b.trava); }
    else el.addEventListener('click', () => acaoDaBarra(b));
    if (b.tool || b.id === 'preencher' || b.id === 'cotas') el.setAttribute('aria-pressed', 'false');
    tb.append(el);
  }
  pintaBarra();
}
function acaoDaBarra(b){
  fechaMenu();
  if (b.forma) { escolheForma(b, true); return; }
  if (b.tool) { setTool(tool === b.tool && b.tool !== 'select' ? 'select' : b.tool); return; }
  fazAcao(b.acao);
}
function pintaBarra(){
  if (LEAN) return;
  for (const b of BARRA) {
    if (!b || !b.grupo) continue;
    const box = $('tb-' + b.id); if (!box) continue;
    const at = atualDoGrupo(b), prin = box.querySelector('.gprin');
    prin.replaceChildren(HubPcbIcones.icone(at.ic));
    prin.setAttribute('aria-pressed', String(b.grupo.some(x => x.tool && x.tool === tool)));
    const t = at.at ? teclaDe(at.at) : '';
    prin.title = (at.titulo || '') + (t ? ' (' + t + ')' : '');
    prin.setAttribute('aria-label', prin.title);
  }
  for (const b of itensBarra()) {
    if (b === '|' || b.trava) continue;
    const el = $('tb-' + b.id); if (!el) continue;
    let tit = b.titulo || '';
    if (b.tool) el.setAttribute('aria-pressed', String(ativoNaBarra(b)));
    else if (b.id === 'preencher') el.setAttribute('aria-pressed', String(preencher));
    else if (b.id === 'cotas') {
      el.setAttribute('aria-pressed', String(show.cotas));
      el.replaceChildren(HubPcbIcones.icone(show.cotas ? 'cotas' : 'cotasOff'));
      const n = COTAS.length + (COTAS.length === 1 ? ' cota' : ' cotas');
      tit = show.cotas ? 'Cotas da régua à vista (' + n + ') — clique para esconder' : 'Cotas da régua escondidas (' + n + ') — clique para mostrar';
    }
    else if (b.id === 'marcas') {
      el.setAttribute('aria-pressed', String(show.ghost));
      el.replaceChildren(HubPcbIcones.icone(show.ghost ? 'eye' : 'eyeOff'));
      tit = show.ghost ? 'Marcações das mudanças à vista (tracejados, setas, novo e removido) — clique para esconder e ver só a placa' : 'Marcações das mudanças escondidas — clique para mostrar';
    }
    const t = b.at ? teclaDe(b.at) : (b.id === 'select' ? '' : '');
    el.title = t ? tit + ' (' + t + ')' : tit;
    el.setAttribute('aria-label', el.title);
  }
  avisaHistorico();
}
/* conta a casca (hub-pcbdesfazer.js) se ha o que desfazer/refazer: os botoes da fileira Placa | Gerber */
function avisaHistorico(){
  try { if (window.parent !== window && window.parent.HubPcbDesfazer) window.parent.HubPcbDesfazer.estado(undoStack.length > 1, redoStack.length > 0); } catch (e) {}
}
function togglePreencher(){
  preencher = !preencher;
  gravaPref('preencher', preencher ? '1' : '0');
  pintaBarra(); pintaStatus(); if (painel) painel.atualiza(); pede();
  HubDialog.toast(preencher ? 'Preencher ligado: formas cheias (região/fill)' : 'Preencher desligado: contorno de trilhas', 'info', 2200);
}

/* ============================== abas de camada (embaixo do canvas) ============================== */

function setCur(k){
  if (!LBYK[k] || k === cur) return;
  if (draft && draft.tipo === 'rota') rotaTermina();
  cur = k;
  if (show.layers[k] === false) show.layers[k] = true;
  pintaAbas(); pintaStatus(); if (painel) painel.atualiza(); pede();
}
function rotuloAba(l){ return (l.num ? '[' + l.num + '] ' : '') + l.name; }
function pintaAbas(){
  const box = $('abaslista'); if (!box || LEAN) return;
  box.textContent = '';
  for (const l of LAYERS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'aba'; b.dataset.k = l.key;
    if (l.key === cur) b.classList.add('on');
    if (show.layers[l.key] === false) b.classList.add('oculta');
    if (!l.used && !l.inBoard) b.classList.add('vazia');
    b.style.setProperty('--cor', l.color);
    const sw = document.createElement('i'); sw.className = 'sw'; sw.style.background = l.color;
    const nm = document.createElement('span'); nm.textContent = rotuloAba(l);
    b.append(sw, nm);
    b.title = l.name + ' (' + l.key + ') — ' + (l.count ? l.count + ' objeto(s)' : 'sem objeto no espelho') +
      (show.layers[l.key] === false ? ' — oculta' : '') + '\nclique: camada atual · botão direito: ocultar / só esta';
    box.append(b);
  }
  const on = box.querySelector('.aba.on');
  if (on && on.scrollIntoView) { try { on.scrollIntoView({ block:'nearest', inline:'nearest' }); } catch (e) {} }
  const ls = $('lsBtn'); if (ls) ls.classList.toggle('unica', show.unica);
  /* toda troca de visibilidade passa por aqui: grava (por projeto) e repinta o menu do canto */
  salvaVis(); pintaCamadasMenu();
}
function soEsta(k){ for (const l of LAYERS) show.layers[l.key] = l.key === k; setCur(k); pintaAbas(); if (painel) painel.atualiza(); pede(); }
function mostraTodas(){ for (const l of LAYERS) show.layers[l.key] = true; show.unica = false; pintaAbas(); pintaStatus(); if (painel) painel.atualiza(); pede(); }
function setVisivel(k, v){ show.layers[k] = !!v; pintaAbas(); if (painel) painel.atualiza(); pede(); }
const CONJUNTOS = {
  todas:{ rot:'Todas as camadas', f:() => true },
  sinal:{ rot:'Sinal (cobre e Multi)', f:l => l.kind === 'signal' || l.kind === 'plane' || l.kind === 'multi' },
  naosinal:{ rot:'Não-sinal (serigrafia, máscara, pasta, furação, keep-out)', f:l => /overlay|solder|paste|drill|keepout/.test(l.kind) },
  mecanicas:{ rot:'Mecânicas', f:l => l.kind === 'mech' },
  cima:{ rot:'Lado de cima', f:l => l.side === 'top' || l.kind === 'multi' },
  baixo:{ rot:'Lado de baixo', f:l => l.side === 'bottom' || l.kind === 'multi' },
};
function conjunto(nome){
  const c = CONJUNTOS[nome]; if (!c) return;
  for (const l of LAYERS) show.layers[l.key] = !!c.f(l);
  show.unica = false;
  if (show.layers[cur] === false) { const p = LAYERS.find(l => show.layers[l.key]); if (p) cur = p.key; }
  pintaAbas(); pintaStatus(); if (painel) painel.atualiza(); pede();
}
function camadaVizinha(passo){
  const vis = LAYERS.filter(l => show.layers[l.key] !== false);
  if (!vis.length) return;
  const i = vis.findIndex(l => l.key === cur);
  setCur(vis[((i < 0 ? 0 : i) + passo + vis.length) % vis.length].key);
}
function setUnica(v){ show.unica = v === undefined ? !show.unica : !!v; pintaAbas(); pintaStatus(); if (painel) painel.atualiza(); pede(); }
function setFlip(v){ view.flip = v === undefined ? !view.flip : !!v; cacheSujo = true; montaAlvos(); pintaStatus(); if (painel) painel.atualiza(); pede(); }

/* ============================== menu (botao direito e LS) ============================== */

function fechaMenu(){ const m = $('menu'); if (m) { m.hidden = true; m.textContent = ''; } }
function abreMenu(itens, sx, sy){
  const m = $('menu'); if (!m) return;
  m.textContent = '';
  for (const it of itens) {
    if (it === '-') { const s = document.createElement('div'); s.className = 'msep'; m.append(s); continue; }
    if (it.titulo) { const t = document.createElement('div'); t.className = 'mtit'; t.textContent = it.titulo; m.append(t); continue; }
    const b = document.createElement('button');
    b.type = 'button';
    if (it.cor) { const i = document.createElement('i'); i.className = 'sw'; i.style.background = it.cor; b.append(i); }
    const s = document.createElement('span'); s.textContent = it.rot; b.append(s);
    if (it.tecla) { const k = document.createElement('kbd'); k.textContent = it.tecla; b.append(k); }
    if (it.off) { b.disabled = true; if (it.porque) b.title = it.porque; }
    else b.addEventListener('click', () => { fechaMenu(); it.f(); });
    m.append(b);
  }
  m.hidden = false;
  const r = m.getBoundingClientRect();
  const x = Math.min(sx, window.innerWidth - r.width - 6), y = Math.min(sy, window.innerHeight - r.height - 6);
  m.style.left = Math.max(4, x) + 'px'; m.style.top = Math.max(4, y) + 'px';
}
function menuCamada(k, sx, sy){
  const vis = show.layers[k] !== false;
  abreMenu([
    { titulo:nomeDe(k) },
    { rot:'Tornar a camada atual', f:() => setCur(k) },
    { rot:vis ? 'Ocultar' : 'Mostrar', f:() => setVisivel(k, !vis), off:vis && k === cur, porque:'a camada atual não se oculta' },
    { rot:'Mostrar só esta', f:() => soEsta(k) },
    { rot:'Mostrar todas', f:mostraTodas },
  ], sx, sy);
}
function menuLS(sx, sy){
  const itens = [{ titulo:'Conjuntos de camadas' }];
  for (const nome of Object.keys(CONJUNTOS)) itens.push({ rot:CONJUNTOS[nome].rot, f:() => conjunto(nome) });
  itens.push('-');
  itens.push({ rot:(show.unica ? 'Desligar' : 'Ligar') + ' a camada única', tecla:teclaDe('camadaUnica'), f:() => setUnica() });
  itens.push({ rot:view.flip ? 'Ver por cima' : 'Ver por baixo', tecla:teclaDe('virar'), f:() => setFlip() });
  abreMenu(itens, sx, sy);
}
function menuContexto(sx, sy, w){
  const lista = hitsEm(w.x, w.y);
  if (lista.length && !selTem(lista[0])) selSo([lista[0]]);
  if (ALT) { ALT.contexto(sx, sy, { primitivo:lista.length > 0, extras:extrasDoHub(w) }); return; }
  const itens = [];
  const temSel = SEL.length > 0;
  const mudaCamada = SEL.filter(a => (a.t === 'track' || a.t === 'arc' || a.t === 'fill' || (a.t === 'text' && a.m.src && !a.m.src.owner && !a.m.src.designator && !a.m.src.comment) || (a.t === 'text' && a.m.added)));
  if (temSel) {
    itens.push({ titulo:SEL.length === 1 ? rotuloAlvo(SEL[0]).slice(0, 48) : SEL.length + ' objetos' });
    itens.push({ rot:'Propriedades', f:() => { if (painel) { painel.mostra('props'); painel.foca(); } } });
    if (mudaCamada.length) {
      itens.push('-'); itens.push({ titulo:'Camada' });
      for (const l of LAYERS) if (l.kind !== 'multi') itens.push({ rot:rotuloAba(l), cor:l.color, f:() => editarCampo('layer', l.key) });
    }
    if (SEL.some(a => a.t === 'comp')) { itens.push('-'); itens.push({ rot:'Virar de face', tecla:'L', f:() => transformaSelecao('vira') }); }
    itens.push('-');
    itens.push({ rot:'Girar 90°', tecla:teclaDe('girar'), f:() => transformaSelecao('gira') });
    itens.push({ rot:soNotas(SEL) ? (SEL.every(a => a.t === 'ann') ? 'Apagar sinalizador' : 'Apagar') : 'Apagar', tecla:teclaDe('apagar'), f:() => { if (soNotas(SEL) || garanteEdicao()) apagaSelecao(); } });
    itens.push({ rot:'Enquadrar a seleção', f:() => enquadraAlvos(SEL) });
  }
  itens.push('-');
  itens.push({ rot:'Sinalizar aqui', tecla:teclaDe('sinalizar'), f:() => { garanteEdicao(); abreAnnForm(snapPonto(w, null, { soGrade:true })); } });
  itens.push({ rot:'Enquadrar a placa', tecla:teclaDe('enquadrar'), f:enquadra });
  abreMenu(itens, sx, sy);
}

/* o que so o hub tem, no fim do menu do Altium (o formato do hub-pcbaltium.js) */
function extrasDoHub(w){
  const it = [];
  const muda = SEL.filter(CAMADA_LIVRE);
  if (muda.length) {
    const ks = new Set(muda.map(a => a.m.eff.layer));
    it.push({ rot:'Camada', filhos:LAYERS.filter(l => l.kind !== 'multi').map(l => ({ rot:rotuloAba(l), cor:l.color, check:ks.size === 1 && ks.has(l.key), f:() => editarCampo('layer', l.key) })) });
  }
  if (SEL.some(circuloDoAlvo)) {
    it.push({ rot:'Gerar fixação em cima', dica:'um furo de fixação (Board Cutout) do diâmetro do círculo, em cima dele; o círculo fica', f:() => fazAcao('fixacaoMarcacoes') });
    it.push({ rot:'Virar furo de fixação', dica:'o círculo vira o furo de fixação e o desenho sai', f:() => fazAcao('furoDoCirculo') });
  }
  if (compsDaSel().length) it.push({ rot:'Virar de face', tecla:'L', f:() => transformaSelecao('vira') });
  if (compsDaSel().length === 1) it.push({ rot:'Editar footprint…', f:() => fazAcao('editarFp') });
  if (compsDaSel().length === 1 && typeof HubNexo !== 'undefined') it.push({ rot:'Editar 3D no NexoCAD', f:() => fazAcao('nexoEditar3d') });
  /* a placa inteira para o NexoCAD (a caixa em volta): no 2D e no 3D */
  if (typeof HubNexoPacote !== 'undefined') it.push({ rot:'Enviar placa ao NexoCAD', f:() => fazAcao('nexoPlaca') });
  it.push(modo3d ? { rot:'Voltar ao 2D', tecla:teclaDe('vista2d') || '2', f:() => fazAcao('vista2d') }
                 : { rot:'Ver em 3D', tecla:teclaDe('vista3d') || '3', f:() => fazAcao('vista3d') });
  if (SEL.length) it.push({ rot:'Girar 90°', tecla:teclaDe('girar'), f:() => transformaSelecao('gira') });
  /* o Sinalizar aqui saiu: o Comment... do Altium, logo acima, e ele (a nota para a IA). Apagar o
     sinalizador e a cota mora aqui tambem (pedido do dono, 2026-10-29: "consigo pôr mas não consigo tirar") */
  if (SEL.some(a => a.t === 'ann')) it.push({ rot:'Apagar sinalizador', tecla:teclaDe('apagar'), f:() => fazAcao('apagar') });
  if (SEL.some(a => a.t === 'cota')) it.push({ rot:'Apagar cota', tecla:teclaDe('apagar'), f:() => fazAcao('apagar') });
  if (COTAS.length) it.push({ rot:show.cotas ? 'Esconder as cotas' : 'Mostrar as cotas', f:() => fazAcao('cotas') });
  it.push({ rot:editOn ? 'Travar a edição' : 'Destravar a edição', tecla:teclaDe('editar'), f:() => fazAcao('editar') });
  return it;
}
/* o componente da selecao: o proprio, ou o dono do pad clicado (o Component Actions do Altium vale no pad) */
function compsDaSel(){
  const L = [];
  for (const a of SEL) { const m = a.t === 'comp' ? a.m : (a.t === 'pad' ? a.comp : null); if (m && L.indexOf(m) < 0) L.push(m); }
  return L;
}
function netDaSel(){
  for (const a of SEL) {
    const n = a.t === 'pad' ? (a.eb && a.eb.net) : (a.m && a.m.eff && a.m.eff.net);
    if (n) return n;
  }
  return '';
}
/* Edit » Select » Net e Component Nets: o cobre livre das nets (trilha, arco, via, fill, regiao) */
function selecionaNets(nets){
  const S = new Set();
  for (const h of HITS) if (h.o && nets.has(h.o.net) && ['track', 'arc', 'via', 'fill', 'region'].indexOf(h.a.t) >= 0) S.add(h.a);
  selSo(Array.from(S)); pede();
  HubDialog.toast(S.size + ' objeto(s) de ' + Array.from(nets).slice(0, 4).join(', ') + (nets.size > 4 ? '…' : ''), 'info', 2200);
}
function zoomCentro(f){ view.scale = Math.min(Math.max(view.scale * f, 0.3), 30000); pede(); }
/* Preferences: aplica o que o dialogo devolveu (OK/Apply) e grava */
function aplicaPrefs(p){
  const coresAntes = JSON.stringify(PREFS.cores);
  PREFS = normalizaPrefs(p);
  const guarda = Object.assign({}, PREFS); delete guarda.conflito; delete guarda.conexoes;
  gravaPref('prefs', JSON.stringify(guarda));
  show.grid = !!PREFS.grade; show.ghost = !!PREFS.fantasmas; pintaBarra();
  if (conexoesLigadas() !== !!PREFS.conexoes) { verConexoes = !!PREFS.conexoes; gravaPref('conexoes', verConexoes ? '1' : '0'); }
  if (PREFS.conflitosCiclo.indexOf(p.conflito) >= 0) setConflito(p.conflito);
  else if (PREFS.conflitosCiclo.indexOf(CFG.conflito) < 0) setConflito(PREFS.conflitosCiclo[0]);
  aplicaDefaults();
  if (JSON.stringify(PREFS.cores) !== coresAntes) { montaCamadas(); cacheSujo = true; pintaAbas(); }
  if (PREFS.drcOnline) { if (HDRC) rodaDrc(); } else if (!drcPainel) DRC_RES = null;
  cv.style.cursor = tool === 'select' ? 'default' : cursorFerramenta();
  pintaStatus(); if (painel) painel.atualiza(); pede();
  HubDialog.toast('Preferences aplicadas', 'ok', 1500);
}
function ctxAltium(){
  return { sel:SEL.length, comp:compsDaSel().length > 0, poly:SEL.some(a => a.t === 'regiao-ro' && a.eb && a.eb.poly), net:netDaSel(), lean:LEAN, edit:editOn, grade:grade.id,
           conexoes:conexoesLigadas(), ghost:show.ghost, flip:view.flip, unica:show.unica, tres:modo3d,
           autosave:AUTOSAVE ? AUTOSAVE.ligado() : null };
}

/* ============================== enquadrar ============================== */

function enquadraCaixa(bb, folga){
  if (!bb || !CW || !CHH) return;
  const w = Math.max(bb[2] - bb[0], 0.5), h = Math.max(bb[3] - bb[1], 0.5);
  view.cx = (bb[0] + bb[2]) / 2; view.cy = (bb[1] + bb[3]) / 2;
  view.scale = Math.min(CW / (w * (folga || 1.15)), CHH / (h * (folga || 1.15)));
  pede();
}
function enquadra(){
  const bb = EB.board && EB.board.bbox;
  if (bb && [bb.x1, bb.y1, bb.x2, bb.y2].every(isNum)) enquadraCaixa([bb.x1, bb.y1, bb.x2, bb.y2], 1.12);
  else { const b = bbPts(HITS.flatMap(h => [[h.bb[0], h.bb[1]], [h.bb[2], h.bb[3]]])); if (b) enquadraCaixa(b, 1.12); }
}
function caixaDoAlvo(a){
  const h = HITS.filter(x => x.a === a);
  if (a.t === 'ann') return [a.ann.x - 4, a.ann.y - 4, a.ann.x + 4, a.ann.y + 4];
  if (a.t === 'cota') { const g = geoCota(a.cota); return g ? bbPts([g.A, g.B, g.D1, g.D2].map(p => [p.x, p.y])) : null; }
  if (!h.length) return null;
  let bb = null;
  for (const x of h) if (a.t !== 'comp' || x.prio === 9) bb = bb ? [Math.min(bb[0], x.bb[0]), Math.min(bb[1], x.bb[1]), Math.max(bb[2], x.bb[2]), Math.max(bb[3], x.bb[3])] : x.bb.slice();
  return bb || h[0].bb.slice();
}
function enquadraAlvos(lista){
  let bb = null;
  for (const a of lista) { const b = caixaDoAlvo(a); if (b) bb = bb ? [Math.min(bb[0], b[0]), Math.min(bb[1], b[1]), Math.max(bb[2], b[2]), Math.max(bb[3], b[3])] : b; }
  if (!bb) return;
  const m = Math.max(bb[2] - bb[0], bb[3] - bb[1]);
  const c = [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2], r = Math.max(m * 1.6, 3);
  enquadraCaixa([c[0] - r / 2, c[1] - r / 2, c[0] + r / 2, c[1] + r / 2], 1);
}

/* ============================== teste de toque ============================== */

function visivelHit(h){
  if (h.layer === '_placa') return true;
  if (h.prio === 9) return camVisivel(h.layer) || camVisivel(h.layer + 'Overlay');
  return camVisivel(h.layer);
}
const noLadoAtual = k => k === cur || (k === 'Multi' && cobre(cur));
/* todos os alvos sob o ponto, o de cima primeiro: a camada atual, depois a ordem de desenho
   (o desenhado por ultimo esta por cima), depois o tipo (via e pad antes de trilha, componente
   por ultimo). O 2o clique no mesmo ponto anda nesta lista. */
function hitsEm(x, y){
  const tol = px(4), out = [], vistos = new Set();
  if (filtro.outros) for (const a of ANN) {
    if (a.view !== 'pcb' || !isNum(a.x) || !isNum(a.y)) continue;
    const b = caixaBandeira(a);
    if (!(Math.hypot(x - a.x, y - a.y) <= px(12) || (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]))) continue;
    const al = annAlvo(a); if (!vistos.has(al)) { vistos.add(al); out.push({ a:al, k:-1e9 }); }
  }
  if (show.cotas && HCOT) for (const c of COTAS) {
    const g = geoCota(c);
    if (!g || !HCOT.toca(g, { x, y }, px(5), px(16))) continue;
    const al = cotaAlvo(c); if (!vistos.has(al)) { vistos.add(al); out.push({ a:al, k:-1e9 }); }
  }
  const cand = [];
  for (const h of HITS) {
    if (!filtro[h.t] || !visivelHit(h)) continue;
    if (x < h.bb[0] - tol || x > h.bb[2] + tol || y < h.bb[1] - tol || y > h.bb[3] + tol) continue;
    if (!h.hit(x, y, tol)) continue;
    const k = (noLadoAtual(h.layer) ? 0 : 1e6) - (ORDEM_IDX[h.layer] || 0) * 100 + h.prio;
    cand.push({ a:h.a, k });
  }
  cand.sort((p, q) => p.k - q.k);
  for (const c of cand) if (!vistos.has(c.a)) { vistos.add(c.a); out.push(c); }
  return out.map(c => c.a);
}
function selecionaTudo(){
  const S = new Set();
  for (const h of HITS) if (filtro[h.t] && visivelHit(h)) S.add(h.a);
  if (filtro.outros) for (const a of ANN) if (a.view === 'pcb') S.add(annAlvo(a));
  selSo(Array.from(S));
  HubDialog.toast(SEL.length + ' objeto(s) selecionado(s) (respeitando o filtro e as camadas visíveis)', 'info', 2200);
}
function selecionaJanela(j, shift){
  const a = telaParaMundo(j.a.x, j.a.y), b = telaParaMundo(j.b.x, j.b.y);
  const r = [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)];
  const dentro = j.b.x >= j.a.x;
  const S = new Set(shift ? SEL : []);
  const porAlvo = new Map();
  for (const h of HITS) {
    if (!filtro[h.t] || !visivelHit(h)) continue;
    const bb = h.bb;
    const inteiro = bb[0] >= r[0] && bb[2] <= r[2] && bb[1] >= r[1] && bb[3] <= r[3];
    const toca = bb[0] <= r[2] && bb[2] >= r[0] && bb[1] <= r[3] && bb[3] >= r[1];
    if (dentro) {
      /* componente so entra inteiro: vale a caixa dele, nao um pedaco de silk que coube */
      if (h.a.t === 'comp' && h.prio !== 9) continue;
      if (inteiro) S.add(h.a);
    } else if (toca) {
      if (h.o && (h.a.t === 'track' || (h.a.t === 'comp' && h.o.x1 !== undefined)) && isNum(h.o.x1) && !segTocaRet(h.o, r)) continue;
      S.add(h.a);
    }
    porAlvo.set(h.a, true);
  }
  if (filtro.outros) for (const n of ANN) if (n.view === 'pcb' && n.x >= r[0] && n.x <= r[2] && n.y >= r[1] && n.y <= r[3]) S.add(annAlvo(n));
  selSo(Array.from(S));
}
function segTocaRet(o, r){
  const dentro = (x, y) => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];
  if (dentro(o.x1, o.y1) || dentro(o.x2, o.y2)) return true;
  const L = [[r[0], r[1], r[2], r[1]], [r[2], r[1], r[2], r[3]], [r[2], r[3], r[0], r[3]], [r[0], r[3], r[0], r[1]]];
  const cruza = (a, b, c, d) => {
    const o1 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]), o2 = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
    const o3 = (d[0] - c[0]) * (a[1] - c[1]) - (d[1] - c[1]) * (a[0] - c[0]), o4 = (d[0] - c[0]) * (b[1] - c[1]) - (d[1] - c[1]) * (b[0] - c[0]);
    return o1 * o2 <= 0 && o3 * o4 <= 0;
  };
  return L.some(s => cruza([o.x1, o.y1], [o.x2, o.y2], [s[0], s[1]], [s[2], s[3]]));
}

/* ============================== mouse ==============================
   Como na vista Esquema: o esquerdo seleciona e arrasta (no vazio, a janela de selecao), o
   direito arrasta a tela e, parado, abre o menu (ou termina a trilha), a roda da zoom no
   cursor e Shift+roda anda de lado. Ctrl+Shift+roda troca a camada atual, como no Altium. */
let gesto = null;            /* o gesto do botao esquerdo em curso */
let pan = null;              /* o arrasto da tela pelo direito (ou o do meio) */
let engoleClique = false;    /* o click que fecha um arrasto/janela nao e clique */
let ultimoClique = null;     /* para o 2o clique no mesmo ponto pegar o objeto de baixo */
function pontoTela(e){ const r = cv.getBoundingClientRect(); return { x:e.clientX - r.left, y:e.clientY - r.top }; }
function opcoesSnap(){
  if (tool === 'trilha') return { camada:(draft && draft.layer) || cur };
  if (tool === 'linha') return { camada:cur };
  if (tool === 'sinalizar' || tool === 'texto' || tool === 'furo') return { soGrade:true };
  return {};
}
let avisouTrava = false;
function avisoTrava(){
  avisoRodape('só leitura — ' + (teclaDe('editar') || 'E') + ' (ou escolher uma ferramenta) destrava a edição');
  if (!avisouTrava) { avisouTrava = true; HubDialog.toast('Só leitura: ' + (teclaDe('editar') || 'E') + ' destrava a edição (escolher uma ferramenta também).', 'info', 3500); }
}

cv.addEventListener('mousedown', e => {
  fechaMenu();
  const s = pontoTela(e), w = telaParaMundo(s.x, s.y);
  if (e.button === 2 || e.button === 1) { pan = { x:e.clientX, y:e.clientY, moveu:false }; if (e.button === 1) e.preventDefault(); return; }
  if (e.button !== 0) return;
  engoleClique = false;
  if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur &&
      !(document.activeElement.closest && document.activeElement.closest('#txtbox, #annform'))) document.activeElement.blur();
  if (tool !== 'select') {
    gesto = { modo:'ferramenta', s };
    /* a regua: apertar num ponto, arrastar e soltar no outro tambem mede (o mouseup decide) */
    if (tool === 'medir' && !(draft && draft.tipo === 'medida')) gesto.medirA = snapMedida(w, e);
    return;
  }
  /* Ctrl+clique: realca a net do cobre (o do Altium) */
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !LEAN) { realcaNetEm(w); return; }
  /* a cota da regua anda pela linha de cota: arrastar muda por onde ela passa (nao pede edicao) */
  if (!LEAN) { const c = cotaEm(w); if (c) { gesto = { modo:'cota', cota:c, s, inicio:w, moveu:false }; return; } }
  if (editOn && !LEAN) { const al = alcaEm(s); if (al) { gesto = { modo:'alca', al, s, inicio:w }; return; } }
  /* a ponta so com UMA trilha selecionada: a selecao do Tab (varias) anda inteira */
  if (editOn && !LEAN && SEL.length === 1) {
    for (const a of SEL) {
      if (a.t !== 'track' || a.m.deleted) continue;
      const o = ebDe(a.m) || a.m.eff, tolP = Math.max((o.w || 0) / 2, px(6));
      if (Math.hypot(w.x - o.x1, w.y - o.y1) <= tolP) { gesto = { modo:'ponta', alvo:a, qual:1, inicio:w, s }; return; }
      if (Math.hypot(w.x - o.x2, w.y - o.y2) <= tolP) { gesto = { modo:'ponta', alvo:a, qual:2, inicio:w, s }; return; }
    }
  }
  const lista = hitsEm(w.x, w.y);
  if (lista.length) { gesto = { modo:(editOn && !LEAN) ? 'mover' : 'nada', s, inicio:w, topo:lista[0], pegaSel:lista.some(selTem), shift:e.shiftKey }; return; }
  gesto = { modo:'janela', s, shift:e.shiftKey };
});
window.addEventListener('mousemove', e => {
  if (pan) {
    const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
    if (!pan.moveu && Math.hypot(dx, dy) > 3) { pan.moveu = true; cv.style.cursor = 'grabbing'; }
    if (pan.moveu) { const fx = view.flip ? -1 : 1; view.cx -= dx / (view.scale * fx); view.cy += dy / view.scale; pan.x = e.clientX; pan.y = e.clientY; pede(); }
    return;
  }
  const s = pontoTela(e), w = telaParaMundo(s.x, s.y);
  if (gesto) { moveGesto(e, s, w); return; }
  if (e.target !== cv) return;
  ultimoMouse = { x:e.clientX, y:e.clientY };
  cursorW = w; pintaCursor(w);
  if (tool === 'select') {
    const al = alcaEm(s);
    cv.style.cursor = al ? cursorAlca(al) : 'default';
    const h = hitsEm(w.x, w.y)[0] || null;
    if (h !== HOVER) { HOVER = h; $('shover').textContent = h ? rotuloAlvo(h) : ''; pede(); }
  } else if (tool === 'medir') {
    if (draft && draft.tipo === 'medida' && draft.b) { SNAP = null; draft.q = { x:w.x, y:w.y }; $('shover').textContent = ''; }
    else { SNAP = snapMedida(w, e); $('shover').textContent = SNAP && HCOT && HCOT.ROTULO[SNAP.tipo] && SNAP.tipo !== 'grade' ? '⊙ ' + HCOT.ROTULO[SNAP.tipo] : ''; }
    pintaMedidaAoVivo();
    pede();
  } else {
    SNAP = snapPonto(w, e, opcoesSnap());
    $('shover').textContent = SNAP && (SNAP.tipo === 'pad' || SNAP.tipo === 'via' || SNAP.tipo === 'ponta') ? '⊙ ' + SNAP.tipo + (SNAP.net ? ' · ' + SNAP.net : '') : '';
    pede();
  }
});
cv.addEventListener('mouseleave', () => {
  if (!gesto && HOVER) { HOVER = null; $('shover').textContent = ''; pede(); }
  /* a reticula da regua e desenhada na tela: o mouse fora do canvas a leva junto */
  if (tool === 'medir' && !gesto) { cursorW = null; SNAP = null; pede(); }
});
function pintaMedidaAoVivo(){
  const r = $('srota'); if (!r) return;
  r.textContent = draft && draft.tipo === 'medida' && draft.a ? medidaAoVivo() : 'régua: clique no 1º ponto (centro, ponta, meio, quadrante, vértice, canto, borda, tangente)';
}
function moveGesto(e, s, w){
  const g = gesto, longe = Math.hypot(s.x - g.s.x, s.y - g.s.y) > 3;
  cursorW = w; pintaCursor(w);
  if (g.modo === 'janela') { if (longe || janela) { janela = { a:g.s, b:s }; pede(); } return; }
  if (g.modo === 'nada') { if (longe && !g.avisou) { g.avisou = true; avisoTrava(); } return; }
  if (g.modo === 'ponta') { if (!arrasto && !longe) return; if (!arrasto) iniciaPonta(g); atualizaPonta(e, w); return; }
  if (g.modo === 'alca') { if (!arrasto && !longe) return; if (!arrasto) iniciaEstica(g); atualizaEstica(e, w); return; }
  if (g.modo === 'mover') { if (!arrasto && !longe) return; if (!arrasto && !iniciaArrasto(g)) return; atualizaArrasto(e, w); return; }
  if (g.modo === 'cota') {
    if (!g.moveu && !longe) return;
    g.moveu = true; g.cota.q = { x:r6(w.x), y:r6(w.y) };
    const gg = geoCota(g.cota); avisoRodape(gg ? 'cota ' + textoCota(gg) : '');
    pede(); return;
  }
  if (g.modo === 'ferramenta' && tool === 'medir') {
    if (draft && draft.tipo === 'medida' && draft.b) { SNAP = null; draft.q = { x:w.x, y:w.y }; }
    else SNAP = snapMedida(w, e);
    pintaMedidaAoVivo(); pede(); return;
  }
  if (g.modo === 'ferramenta') { SNAP = snapPonto(w, e, opcoesSnap()); pede(); }
}
function cotaEm(w){
  if (!show.cotas || !HCOT || !COTAS.length) return null;
  for (let i = COTAS.length - 1; i >= 0; i--) { const g = geoCota(COTAS[i]); if (g && HCOT.toca(g, w, px(5), px(16))) return COTAS[i]; }
  return null;
}
function iniciaArrasto(g){
  let alvos;
  if (g.pegaSel && !g.shift) alvos = SEL.slice();
  else { if (!g.shift) selSo([g.topo]); else selSoma(g.topo); alvos = g.shift ? SEL.slice() : [g.topo]; }
  const movs = [];
  for (const a of alvos) { const m = movivel(a); if (m && movs.indexOf(m) < 0) movs.push(m); }
  if (!movs.length) {
    g.modo = 'nada';
    const t = g.topo;
    HubDialog.toast(t && t.t === 'regiao-ro' ? 'Esta região não anda daqui: ' + t.motivo
      : t && t.t === 'text' ? 'O comment não tem op de posição (comment_move ainda não existe) — mova pelo Altium'
      : 'Isto não se move daqui', 'info', 4000);
    return false;
  }
  const bases = new Map(movs.map(a => [a, geoDe(a)]));
  const principal = movs.indexOf(movivel(g.topo)) >= 0 ? movivel(g.topo) : movs[0];
  arrasto = { alvos:movs, bases, inicio:g.inicio, dx:0, dy:0, moveu:false, girou:false, principal,
              ref:refDoGeo(principal.t, bases.get(principal)), annBase:new Map() };
  for (const a of movs) if (a.t === 'ann') arrasto.annBase.set(a, { x:a.ann.x, y:a.ann.y });
  arrasto.topo = topoDoArrasto(movs);
  EXCLUI = excluiDoArrasto(movs);
  if (arrasto.topo) for (const v of arrasto.topo.viz) { const o = ebDe(v.m); if (o) EXCLUI.add(o); }
  cacheSujo = true;
  return true;
}
/* ── O DRAG DO ALTIUM (pedido do dono, 2026-10-29: "quando eu arrastar a trilha, eu consiga mover
   ela sem quebrar a trilha, igual o Altium, move nao quebra, mantem a trilha conectada") ──
   A trilha, o arco e a via que andam levam as pontas das vizinhas que encostavam neles: uma trilha
   sozinha anda paralela e as vizinhas deslizam (o canto de 45/90 fica), um grupo anda inteiro e as
   vizinhas esticam, e o que estava preso em pad ou via que fica ganha uma trilha nova do lugar
   antigo ao novo. A conta e o hub-pcbtopologia.js (planoArrasto); aqui so o alvo de cada id e o
   que se desenha e escreve. Girar ou espelhar no arrasto volta ao mover de sempre. */
function alvoDoEb(id){
  const m = IDX.item.get(String(id));
  if (!m || m.deleted) return null;
  return PORCHAVE.get(chave({ t:m.kind, m })) || { t:m.kind, m };
}
function topoDoArrasto(movs){
  if (!TOPO) return null;
  const movem = { tracks:[], arcs:[], vias:[] }, porId = new Map();
  for (const a of movs) {
    if (a.t !== 'track' && a.t !== 'arc' && a.t !== 'via') continue;
    const o = ebDe(a.m);
    if (!o || o.id == null) continue;
    (a.t === 'track' ? movem.tracks : a.t === 'arc' ? movem.arcs : movem.vias).push(o.id);
    porId.set(a.t + ':' + o.id, a);
  }
  if (!movem.tracks.length && !movem.arcs.length && !movem.vias.length) return null;
  let p0, p1;
  try { p0 = TOPO.planoArrasto(EB, movem, 0, 0); p1 = TOPO.planoArrasto(EB, movem, 1, 1); }
  catch (e) { console.warn('topologia:', e); return null; }
  if (!p0.viz.length && !p1.links.length) return null;      /* nada ligado: o mover de sempre (com o ima) */
  const viz = [];
  for (const v of p0.viz) { const al = alvoDoEb(v.id); if (al && al.m) viz.push({ id:String(v.id), m:al.m, al }); }
  return { movem, porId, viz, plano:null };
}
function planoDoArrasto(a){
  const T = a.topo;
  if (!T) return;
  try { T.plano = TOPO.planoArrasto(EB, T.movem, a.dx || 0, a.dy || 0); }
  catch (e) { console.warn('topologia:', e); T.plano = null; }
}
/* o geo de um alvo que anda pelo plano (null: anda pela translacao de sempre) */
function geoDoPlano(a, al){
  const P = a.topo && a.topo.plano;
  if (!P || !al.m) return null;
  const o = ebDe(al.m);
  const g = o && P.mov[al.t] ? P.mov[al.t][String(o.id)] : null;
  return g ? Object.assign({}, a.bases.get(al), g) : null;
}
/* ── AS GUIAS DO ARRASTO (hub-guias.js, as mesmas do Esquema) ──
   Pedido do dono (2026-10-16): "tenha auxilio tipo que tem no esquema, pra ajudar a alinhar os
   componentes, centro de pad, essas coisas". O motor e o do Esquema; aqui so se diz o que anda e o
   que esta parado, no mundo da placa (mm):
     caixa    a caixa do componente (a bbox do board.js, girada): borda com borda, centro com centro
     pontos   o centro de COBRE de cada pad, o centro da via e as pontas da trilha: pad alinha com
              pad, via e ponta de trilha dos vizinhos -- e o que deixa a trilha reta
     medidas  o vao ate o componente vizinho de cada lado, e o espaco igual da fileira
   O centro da placa (a caixa do contorno) vale como o centro da folha do Esquema. A guia gruda
   fora da grade se preciso (o ima com travada do Esquema); o eixo sem guia pousa na grade como
   sempre, contada a partir da posicao ABSOLUTA do ponto de referencia (gradeX/gradeY). O ima
   eletrico de antes (trilha e via pegando pad, via, ponta) continua mandando: com ele pegando, a
   guia so mostra. Ctrl solta tudo, como ja soltava o snap.
   Medido UMA vez por gesto, na posicao de partida (e de novo depois de girar no arrasto). */
const GUIAS = (typeof HubGuias !== 'undefined' && HubGuias && typeof HubGuias.prepara === 'function') ? HubGuias : null;
const nomeComp = m => String(m.eff.designator || m.src.ref || '');
/* os centros de cobre dos pads e a caixa de um componente que estaria em g (o geo do arrasto) --
   a mesma transformacao da previaComp */
function geoDoComp(m, g){
  const fake = { src:{ x:m.eff.x, y:m.eff.y, rot:isNum(m.eff.rot) ? m.eff.rot : 0, layer:m.eff.layer },
                 eff:{ x:g.x, y:g.y, rot:g.rot, layer:g.layer } };
  if (m.pares) Object.defineProperty(fake, 'pares', { value:m.pares, enumerable:false });
  const d = HC.compDelta(fake), pads = [], ref = nomeComp(m);
  for (const { kind, o } of objetosDoComp(m)) {
    if (kind !== 'pad') continue;
    const t = HC.xfObject(d, o, 'pad');
    if (!t || !isNum(t.x) || !isNum(t.y)) continue;
    const c = centroCobre(t);
    pads.push({ x:c[0], y:c[1], nome:ref + '-' + (o.name || '') });
  }
  let caixa = null;
  const ca = m.src.bbox;
  if (ca && [ca.x1, ca.y1, ca.x2, ca.y2].every(isNum)) {
    const c = [[ca.x1, ca.y1], [ca.x2, ca.y1], [ca.x2, ca.y2], [ca.x1, ca.y2]].map(p => {
      const q0 = m.changed ? HC.xfPoint(HC.compDelta(m), p[0], p[1]) : { x:p[0], y:p[1] };
      const q = HC.xfPoint(d, q0.x, q0.y); return [q.x, q.y]; });
    caixa = bbPts(c);
  }
  if (!caixa && pads.length) caixa = bbPts(pads.map(p => [p.x, p.y]));
  return { pads, caixa };
}
function guiasDaPlaca(a){
  const anda = new Set(), pontos = [];
  let caixa = null;
  const soma = b => { if (!b) return; caixa = !caixa ? { x1:b[0], y1:b[1], x2:b[2], y2:b[3] }
    : { x1:Math.min(caixa.x1, b[0]), y1:Math.min(caixa.y1, b[1]), x2:Math.max(caixa.x2, b[2]), y2:Math.max(caixa.y2, b[3]) }; };
  for (const al of a.alvos) {
    const g = a.bases.get(al);
    if (!g) continue;
    if (al.t === 'comp') { anda.add(al.m); const q = geoDoComp(al.m, g); soma(q.caixa); pontos.push(...q.pads); }
    else if (al.t === 'via') pontos.push({ x:g.x, y:g.y, nome:'via' });
    else if (al.t === 'track') pontos.push({ x:g.x1, y:g.y1, nome:'ponta da trilha' }, { x:g.x2, y:g.y2, nome:'ponta da trilha' });
  }
  if (!caixa && !pontos.length) return null;
  const fixos = { caixas:[], pontos:[], sempre:[], folha:null };
  for (const m of model.comps) {
    if (anda.has(m) || m.deleted) continue;
    const ec = IDX.ebComp.get(m), ref = nomeComp(m);
    const pads = ((ec && ec.pads) || []).filter(p => p && isNum(p.x) && isNum(p.y))
      .map(p => { const c = centroCobre(p); return { x:c[0], y:c[1], nome:ref + '-' + (p.name || '') }; });
    const c = caixaComp(m), b = c ? bbPts(c) : null;
    if (b) fixos.caixas.push({ x1:b[0], y1:b[1], x2:b[2], y2:b[3], nome:ref, tipo:'comp', pontos:pads });
    else for (const p of pads) fixos.pontos.push(p);
  }
  const fora = o => EXCLUI && EXCLUI.has(o);
  for (const p of EB.freepads || []) if (p && isNum(p.x) && isNum(p.y) && !fora(p)) { const c = centroCobre(p); fixos.pontos.push({ x:c[0], y:c[1], nome:'pad ' + (p.name || '') }); }
  for (const v of EB.vias || []) if (v && isNum(v.x) && isNum(v.y) && !fora(v)) fixos.pontos.push({ x:v.x, y:v.y, nome:'via' + (v.net ? ' ' + v.net : '') });
  for (const t of EB.tracks || []) {
    if (!t || t.keepout || fora(t) || !cobre(t.layer) || ![t.x1, t.y1, t.x2, t.y2].every(isNum)) continue;
    const n = 'trilha' + (t.net ? ' ' + t.net : '');
    fixos.pontos.push({ x:t.x1, y:t.y1, nome:n }, { x:t.x2, y:t.y2, nome:n });
  }
  const bb = EB.board && EB.board.bbox;
  if (caixa && bb && [bb.x1, bb.y1, bb.x2, bb.y2].every(isNum)) fixos.folha = { x1:bb.x1, y1:bb.y1, x2:bb.x2, y2:bb.y2, rotulo:'no centro da placa' };
  const principal = a.principal && a.principal.t === 'comp' ? nomeComp(a.principal.m) : '';
  return GUIAS.prepara({ caixa, tipoCaixa:'comp', nome:principal, pontos }, fixos, { eps:1e-3 });
}
const fmtGuia = v => fmtDist(v) + ' ' + unidade;
/* o deslocamento passado pelas guias: null quando nao ha guia (o hub-guias.js nao carregou, o
   gesto so leva o que nao tem guia, ou o motor falhou -- ai o arrasto e o de sempre) */
function guiasDoArrasto(a, rx, ry, e){
  if (!GUIAS || !a.ref || a.guiasFalhou) return null;
  try {
    if (a.guias === undefined) a.guias = guiasDaPlaca(a);
    if (!a.guias || !a.guias.box0) return null;
    const ref = a.ref, passo = grade.mm;
    return GUIAS.resolve(a.guias, rx, ry, { escala:view.scale, fmt:fmtGuia, desliga:!!e.ctrlKey,
      gradeX: d => snapV(ref[0] + d, passo) - ref[0], gradeY: d => snapV(ref[1] + d, passo) - ref[1],
      trava: a.ima ? { dx:a.ima.x - ref[0], dy:a.ima.y - ref[1] } : null });
  } catch (err) {
    a.guiasFalhou = true;
    try { console.error('hub-guias:', err); } catch (x) {}
    return null;
  }
}
function atualizaArrasto(e, w){
  const a = arrasto;
  let dx = w.x - a.inicio.x, dy = w.y - a.inicio.y;
  const rx = dx, ry = dy;
  a.ima = null; a.cena = null;
  if (a.ref && !e.ctrlKey) {
    const alvo = { x:a.ref[0] + dx, y:a.ref[1] + dy };
    /* trilha, arco e via grudam em pad/via/ponta (a ligacao); o resto, na grade */
    const eletrico = a.alvos.length === 1 && (a.principal.t === 'via' || a.principal.t === 'track' || a.principal.t === 'arc');
    /* no Drag a ligacao ja vai junto: o ima puxaria a ponta de volta para a via ou o pad onde ela estava */
    const p = snapPonto(alvo, e, eletrico && !a.topo ? {} : { soGrade:true });
    if (p.tipo === 'pad' || p.tipo === 'via' || p.tipo === 'ponta') a.ima = p;
    dx = p.x - a.ref[0]; dy = p.y - a.ref[1];
  }
  let guia = '';
  const g = guiasDoArrasto(a, rx, ry, e);
  if (g) {
    if (!e.ctrlKey) { dx = g.lx; dy = g.ly; }
    a.cena = g.cena; guia = g.rotulo || '';
  }
  a.dx = dx; a.dy = dy; a.moveu = true;
  planoDoArrasto(a);
  for (const [al, b] of a.annBase) { al.ann.x = b.x + dx; al.ann.y = b.y + dy; }
  avisoRodape('dX ' + fmtDist(dx) + '  dY ' + fmtDist(dy) + ' ' + unidade + (guia ? ' · ' + guia : '') + (a.topo ? ' · a trilha leva as vizinhas' : '') + ' · Espaço gira · L vira · X/Y espelha · Ctrl solta o snap e as guias · Esc desiste');
  pede();
}
function giraNoArrasto(como){
  const a = arrasto;
  if (!a || a.ponta || a.estica) return;
  if (como === 'vira' && !a.alvos.some(x => x.t === 'comp')) return;
  if (a.topo) { a.topo = null; EXCLUI = excluiDoArrasto(a.alvos); cacheSujo = true; }   /* girou: o mover de sempre */
  const pv = pivoDe(a.alvos, a.bases);
  for (const al of a.alvos) {
    let g = a.bases.get(al);
    if (como === 'gira') g = giraGeo(al.t, g, pv);
    else if (como === 'vira') { if (al.t !== 'comp') continue; g = viraGeo(g, pv); }
    else { if (al.t === 'comp') continue; g = espelhaGeo(al.t, g, como, pv); }
    a.bases.set(al, g);
  }
  a.ref = refDoGeo(a.principal.t, a.bases.get(a.principal));
  a.girou = true;
  a.guias = undefined; a.cena = null;     /* girou: os pads e a caixa sao outros, as guias se medem de novo */
  pede();
}
function iniciaPonta(g){
  arrasto = { ponta:{ alvo:g.alvo, qual:g.qual }, pontaGeo:null, moveu:true, alvos:[], bases:new Map(), pontaViz:[] };
  const o = ebDe(g.alvo.m);
  EXCLUI = new Set(o ? [o] : []); cacheSujo = true;
  /* o vertice inteiro anda: as trilhas com a ponta no mesmo lugar (mesma camada) vao junto, como no Altium */
  if (TOPO && o) {
    try {
      const P = g.qual === 1 ? [o.x1, o.y1] : [o.x2, o.y2];
      for (const e of TOPO.grafo(EB).pontasEm(P[0], P[1], TOPO.TOL, o.layer)) {
        if (e.seg.tipo !== 'track' || String(e.seg.id) === String(o.id)) continue;
        const al = alvoDoEb(e.seg.id);
        if (!al || al.t !== 'track') continue;
        arrasto.pontaViz.push({ al, qual:e.qual + 1 });
        EXCLUI.add(e.seg.o);
      }
    } catch (err) { console.warn('topologia:', err); arrasto.pontaViz = []; }
  }
}
/* o geo de uma trilha com a ponta `qual` (1|2) em p */
const comPonta = (e, qual, p) => qual === 1 ? { x1:p.x, y1:p.y, x2:e.x2, y2:e.y2 } : { x1:e.x1, y1:e.y1, x2:p.x, y2:p.y };
function atualizaPonta(e, w){
  const a = arrasto, m = a.ponta.alvo.m;
  const p = snapPonto(w, e, { camada:m.eff.layer });
  a.ima = (p.tipo === 'pad' || p.tipo === 'via' || p.tipo === 'ponta') ? p : null;
  a.pontaGeo = a.ponta.qual === 1 ? { x1:p.x, y1:p.y } : { x2:p.x, y2:p.y };
  a.pontaP = { x:p.x, y:p.y };
  pede();
}
/* Soltar: a edicao que faria cobre de nets diferentes se encontrarem volta tudo para o lugar
   (editaConferindo) -- trilha, arco e via, sozinhos ou no grupo, e a ponta da trilha; o
   componente nao e conferido, como no Altium. */
function terminaArrasto(){
  const a = arrasto;
  arrasto = null; EXCLUI = null; cacheSujo = true;
  avisoRodape('');
  if (a.estica) { terminaEstica(a); return; }
  if (a.ponta) {
    if (a.pontaGeo) {
      const m = a.ponta.alvo.m, e = m.eff;
      const g = Object.assign({ x1:e.x1, y1:e.y1, x2:e.x2, y2:e.y2 }, a.pontaGeo);
      if (Math.hypot(g.x2 - g.x1, g.y2 - g.y1) < 1e-6) { HubDialog.toast('a trilha ficaria com comprimento zero', 'warn'); pede(); return; }
      const viz = (a.pontaViz || []).filter(v => { const ev = v.al.m.eff, q = comPonta(ev, v.qual, a.pontaP);
        return Math.hypot(q.x2 - q.x1, q.y2 - q.y1) >= 1e-6; });
      const r = editaConferindo([a.ponta.alvo].concat(viz.map(v => v.al)), () => {
        let mexeu = editaItem(m, { x1:r6(g.x1), y1:r6(g.y1), x2:r6(g.x2), y2:r6(g.y2) });
        for (const v of viz) { const q = comPonta(v.al.m.eff, v.qual, a.pontaP);
          if (editaItem(v.al.m, { x1:r6(q.x1), y1:r6(q.y1), x2:r6(q.x2), y2:r6(q.y2) })) mexeu = true; }
        return mexeu;
      }, 'não deixa');
      if (r) commit(); else pede();
    } else pede();
    return;
  }
  if (!a.moveu && !a.girou) { pede(); return; }
  const P = a.topo && a.topo.plano;
  const vizP = P ? a.topo.viz.map(v => ({ v, g:(P.viz.find(x => String(x.id) === v.id) || {}).geo })).filter(x => x.g) : [];
  const r = editaConferindo(a.alvos.concat(vizP.map(x => x.v.al)), () => {
    let mexeu = false;
    for (const al of a.alvos) if (al.t !== 'ann' && escreveGeo(al, geoDoPlano(a, al) || transladaGeo(al.t, a.bases.get(al), a.dx, a.dy))) mexeu = true;
    /* as vizinhas esticadas e as trilhas novas que seguram a ligacao (o Drag do Altium) */
    for (const { v, g } of vizP) if (editaItem(v.m, { x1:r6(g.x1), y1:r6(g.y1), x2:r6(g.x2), y2:r6(g.y2) })) mexeu = true;
    for (const l of (P && P.links) || []) {
      const op = { op:'track_add', layer:l.layer, x1:r6(l.x1), y1:r6(l.y1), x2:r6(l.x2), y2:r6(l.y2), w:r6(l.w || CFG.wLinha), note:'arrastado no hub: liga a trilha' };
      if (l.net && cobre(l.layer)) op.net = l.net;
      CH.push(op); mexeu = true;
    }
    return mexeu;
  }, 'não deixa');
  /* recusado: o sinalizador que andava junto volta tambem (o arrasto inteiro nao aconteceu) */
  if (r === null) { for (const [al, b] of (a.annBase || new Map())) { al.ann.x = b.x; al.ann.y = b.y; } pede(); return; }
  let ann = false;
  for (const al of a.alvos) {
    if (al.t !== 'ann') continue;
    const g = transladaGeo(al.t, a.bases.get(al), a.dx, a.dy);
    ann = true; al.ann.x = r6(g.x); al.ann.y = r6(g.y);
  }
  if (ann) annChanged();
  if (r) commit(); else pede();
}
function cancelaArrasto(){
  const a = arrasto;
  if (!a) return;
  arrasto = null; EXCLUI = null; cacheSujo = true;
  for (const [al, b] of (a.annBase || new Map())) { al.ann.x = b.x; al.ann.y = b.y; }
  gesto = null; engoleClique = true;
  avisoRodape('');
  pede();
}
window.addEventListener('mouseup', e => {
  if (e.button !== 0) { if (e.button === 1) { pan = null; cv.style.cursor = tool === 'select' ? 'default' : cursorFerramenta(); } return; }
  const g = gesto; gesto = null;
  if (!g) return;
  if (g.modo === 'cota') { if (g.moveu) { engoleClique = true; gravaCotas(); selSo([cotaAlvo(g.cota)]); avisoRodape(''); pede(); } return; }
  /* a regua por arrasto: apertou no 1o ponto, soltou no 2o -- a cota fica na mao para o arrasto da linha */
  if (g.modo === 'ferramenta' && g.medirA && tool === 'medir') {
    const r = cv.getBoundingClientRect(), s = { x:e.clientX - r.left, y:e.clientY - r.top };
    if (Math.hypot(s.x - g.s.x, s.y - g.s.y) > 6) {
      const w = telaParaMundo(s.x, s.y);
      draft = { tipo:'medida', a:g.medirA, b:null, modo:'auto' };
      if (!ponto2(snapMedida(w, e))) draft = null;
      engoleClique = true; pintaStatus(); if (painel) painel.atualiza(); pede();
      return;
    }
  }
  if (arrasto) { engoleClique = true; terminaArrasto(); return; }
  if (g.modo === 'janela' && janela) { const j = janela; janela = null; engoleClique = true; selecionaJanela(j, g.shift); pede(); return; }
  if (g.modo === 'nada' && g.avisou) engoleClique = true;
  janela = null;
});
cv.addEventListener('click', e => {
  if (engoleClique) { engoleClique = false; return; }
  const s = pontoTela(e), w = telaParaMundo(s.x, s.y);
  if (tool !== 'select') { cliqueFerramenta(w, e); pintaStatus(); return; }
  const lista = hitsEm(w.x, w.y);
  if (!lista.length) { if (!e.shiftKey) selLimpa(); ultimoClique = null; return; }
  let i = 0;
  const mesma = ultimoClique && Math.hypot(s.x - ultimoClique.sx, s.y - ultimoClique.sy) <= 4 &&
                ultimoClique.lista.length === lista.length && ultimoClique.lista.every((a, k) => a === lista[k]);
  if (mesma && !e.shiftKey) i = (ultimoClique.i + 1) % lista.length;
  ultimoClique = { sx:s.x, sy:s.y, lista, i };
  const a = lista[i];
  if (e.shiftKey) { if (selTem(a)) selTira(a); else selSoma(a); }
  else selSo([a]);
  if (mesma && lista.length > 1) avisoRodape('objeto ' + (i + 1) + ' de ' + lista.length + ' neste ponto — clique de novo para o próximo');
  else avisoRodape('');
});
cv.addEventListener('dblclick', e => {
  if (tool === 'poligono' || tool === 'contorno' || tool === 'pour') { fechaPoligono(); return; }
  if (tool === 'trilha' || tool === 'linha') { rotaTermina(); return; }
  if (tool !== 'select') return;
  if (!PREFS.duploClique) return;
  const s = pontoTela(e), w = telaParaMundo(s.x, s.y), h = hitsEm(w.x, w.y)[0];
  if (!h) return;
  if (!selTem(h)) selSo([h]);
  if (painel) { painel.mostra('props'); painel.foca(); }
});
cv.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('contextmenu', e => {
  if (!pan) return;
  e.preventDefault();
  const moveu = pan.moveu;
  pan = null;
  cv.style.cursor = tool === 'select' ? 'default' : cursorFerramenta();
  if (moveu || e.target !== cv) return;
  const s = pontoTela(e), w = telaParaMundo(s.x, s.y);
  if (LEAN) return;
  if (tool === 'trilha' || tool === 'linha') { if (!rotaTermina()) setTool('select'); return; }
  if (tool === 'poligono' || tool === 'contorno' || tool === 'pour') {
    if (draft && draft.pts && draft.pts.length >= 3) fechaPoligono();
    else if (draft) { draft = null; pede(); } else setTool('select');
    return;
  }
  if (tool !== 'select') { if (draft) { draft = null; SNAP = null; pintaStatus(); pede(); } else setTool('select'); return; }
  menuContexto(e.clientX, e.clientY, w);
});
/* Preferences » Mouse Wheel Configuration: a combinacao exata escolhe a acao; a que nao esta na
   tabela cai no zoom (o de sempre) */
function acaoDaRoda(e){
  const mods = [(e.ctrlKey || e.metaKey) ? 'Ctrl' : '', e.shiftKey ? 'Shift' : '', e.altKey ? 'Alt' : ''].filter(Boolean).join('+');
  for (const id of ['zoom', 'vertical', 'horizontal', 'camada']) if ((PREFS.roda[id] || '') === mods) return id;
  return 'zoom';
}
cv.addEventListener('wheel', e => {
  e.preventDefault();
  const acao = acaoDaRoda(e);
  const escala = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  if (acao === 'camada') { if (!LEAN) camadaVizinha((e.deltaY || e.deltaX) > 0 ? 1 : -1); return; }
  if (acao === 'horizontal') {
    const d = (e.deltaX || e.deltaY) * escala;
    view.cx += d / (view.scale * (view.flip ? -1 : 1)); pede(); return;
  }
  if (acao === 'vertical') { const d = (e.deltaY || e.deltaX) * escala; view.cy -= d / view.scale; pede(); return; }
  if (!e.deltaY) return;
  const s = pontoTela(e), w = telaParaMundo(s.x, s.y);
  view.scale = Math.min(Math.max(view.scale * (e.deltaY < 0 ? 1.18 : 1 / 1.18), 0.3), 30000);
  const fx = view.flip ? -1 : 1;
  view.cx = w.x - (s.x - CW / 2) / (view.scale * fx);
  view.cy = w.y + (s.y - CHH / 2) / view.scale;
  pede();
}, { passive:false });
document.addEventListener('mousedown', e => { const m = $('menu'); if (m && !m.hidden && !m.contains(e.target)) fechaMenu(); }, true);
window.addEventListener('blur', () => { if (arrasto) cancelaArrasto(); gesto = null; pan = null; janela = null; fechaMenu(); });

/* ============================== teclado ============================== */

/* ── O TAB DO ALTIUM (pedido do dono, 2026-10-29: "o tab 1x seleciona toda a trilha ate a via, e tab
   2x seleciona tudo conectado, as outras trilhas alem da via") ──
   Com trilha, arco ou via selecionado (ou sob o cursor), o 1o Tab pega a trilha inteira, ponta com
   ponta na mesma camada, ate a via ou o pad; o 2o pega tudo o que se liga, atravessando as vias
   (para no pad, que e do componente). A conta e o hub-pcbtopologia.js. O Tab seguinte, sem mexer na
   selecao, fica no 2o nivel. Arrastar a selecao do Tab leva tudo junto, e as vizinhas de fora
   esticam (o Drag). */
let ultimoTab = null;        /* { sel, nivel, sementes } */
function tabTopologia(){
  if (!TOPO) return;
  const chaveSel = SEL.map(chave).join('|');
  let nivel = 1, sementes;
  if (ultimoTab && ultimoTab.sel === chaveSel && SEL.length) { nivel = 2; sementes = ultimoTab.sementes; }
  else {
    let base = SEL.filter(a => a && a.m && !a.m.deleted && (a.t === 'track' || a.t === 'arc' || a.t === 'via'));
    if (!base.length && HOVER && HOVER.m && !HOVER.m.deleted && (HOVER.t === 'track' || HOVER.t === 'arc' || HOVER.t === 'via')) base = [HOVER];
    if (!base.length) { avisoRodape('Tab: selecione uma trilha (ou passe o mouse em cima dela)'); return; }
    sementes = { tracks:[], arcs:[], vias:[] };
    for (const a of base) {
      const o = ebDe(a.m);
      if (o && o.id != null) (a.t === 'track' ? sementes.tracks : a.t === 'arc' ? sementes.arcs : sementes.vias).push(o.id);
    }
    /* so via: o 1o Tab ja e o de atravessar */
    if (!sementes.tracks.length && !sementes.arcs.length) nivel = 2;
  }
  let r;
  try { r = nivel === 1 ? TOPO.trilhaAteVia(EB, sementes) : TOPO.tudoLigado(EB, sementes); }
  catch (e) { console.warn('topologia:', e); return; }
  const lista = [];
  for (const id of [].concat(r.tracks || [], r.arcs || [], r.vias || [])) { const al = alvoDoEb(id); if (al && lista.indexOf(al) < 0) lista.push(al); }
  for (const id of sementes.vias) { const al = alvoDoEb(id); if (al && lista.indexOf(al) < 0) lista.push(al); }
  if (!lista.length) return;
  selSo(lista);
  ultimoTab = { sel:SEL.map(chave).join('|'), nivel, sementes };
  const nT = (r.tracks || []).length + (r.arcs || []).length, nV = (r.vias || []).length;
  avisoRodape(nivel === 1
    ? 'Tab: ' + nT + ' trilha(s) até a via ou o pad · Tab de novo: tudo o que liga, além da via · arrastar leva tudo junto'
    : 'Tab Tab: ' + nT + ' trilha(s) e ' + nV + ' via(s) ligadas · arrastar leva tudo junto');
}

function ehCampo(t){ return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }
function escape(){
  const m = $('menu');
  if (m && !m.hidden) { fechaMenu(); return; }
  if (caixaPonto) { fechaCaixaTexto(); return; }
  if (annPendente) { fechaAnnForm(); return; }
  if (arrasto) { cancelaArrasto(); return; }
  if (janela || gesto) { janela = null; gesto = null; pede(); return; }
  /* a regua: o 1o Esc larga a cota na mao; o 2o, a regua */
  if (tool === 'medir' && draft && draft.tipo === 'medida') { draft = null; SNAP = null; avisoRodape(''); pintaStatus(); if (painel) painel.atualiza(); pede(); return; }
  if (tool !== 'select') { setTool('select'); return; }
  if (limpaRealce()) return;
  if (SEL.length) { selLimpa(); return; }
  avisoRodape('');
}
window.addEventListener('keydown', e => {
  if (e.target && e.target.closest && e.target.closest('.apf-fundo')) return;
  if (gerberAberto()) { if (e.key === 'Escape') { e.preventDefault(); fechaGerber(); } return; }
  if (ajudaAberta()) { if (e.key === 'Escape' || normalizaTecla(e) === teclaDe('ajuda')) { e.preventDefault(); toggleAjuda(false); } return; }
  if (e.key === 'Escape') { if (LEITOR.pendente()) { LEITOR.cancela(); return; } if (!ehCampo(e.target) || e.target.closest('#txtbox, #annform')) escape(); return; }
  if (ehCampo(e.target)) return;
  const k = normalizaTecla(e);
  if (modo3d && V3 && !LEITOR.pendente()) {
    const v3 = { '0':'v3topo', 'Ctrl+0':'v3base', '8':'v3iso', 'Ctrl+8':'v3isoVirada', '9':'v3gira90' }[k]
      || (!e.ctrlKey && !e.altKey ? { ArrowLeft:'v3girarEsq', ArrowRight:'v3girarDir', ArrowUp:'v3subir', ArrowDown:'v3descer' }[e.key] : null);
    if (v3) { e.preventDefault(); fazAcao(v3); return; }
  }
  if (LEAN) { if (k === (teclaDe('enquadrar') || 'F')) enquadra(); return; }
  /* o Chrome entrega Ctrl+1..8 a pagina antes de trocar de aba so se a pagina segurar */
  if (k === 'Ctrl+2' || k === 'Ctrl+S' || k === 'Ctrl+M' || k === 'Ctrl+A' || k === 'Ctrl+Z' || k === 'Ctrl+Y' || k === 'Ctrl+D' ||
      k === 'Ctrl+C' || k === 'Ctrl+X' || k === 'Ctrl+V' || /^Ctrl\+Shift\+[A-Z]$/.test(k)) e.preventDefault();
  /* Ctrl+W: o Interactive Routing do Altium (pedido do dono, 2026-10-16: "apertando Ctrl+W você
     desenha trilha igual ao Altium"). E a mesma Trilha do W -- o roteador que contorna a outra net
     sem mexer no que ja esta na placa --, fixa e ao lado do W, que continua (e continua trocavel
     nas Configuracoes). No app desktop a tecla chega a vista: o menu do app nao tem Fechar com
     Ctrl+W. No navegador ela fecha a aba antes de a pagina ver, e fica o W. Com a trilha ja na mao
     nao faz nada (a acao do W alterna e largaria a trilha). */
  if (k === 'Ctrl+W') {
    e.preventDefault();
    if (tool !== 'trilha' && !LEITOR.pendente() && !(arrasto && !arrasto.ponta)) fazAcao('trilha');
    return;
  }
  if (arrasto && !arrasto.ponta) {
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); giraNoArrasto('gira'); return; }
    if (k === 'L') { giraNoArrasto('vira'); return; }
    if (k === 'X') { giraNoArrasto('x'); return; }
    if (k === 'Y') { giraNoArrasto('y'); return; }
  }
  if (tool === 'trilha' || tool === 'linha') {
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); rotaEspaco(e.shiftKey); return; }
    if (e.key === 'Backspace') { e.preventDefault(); rotaBackspace(); return; }
    /* Shift+R: o modo de conflito, como no Altium. Antes do mapa: o normalizaTecla larga o Shift
       de tecla de um caractere, e no mapa ele chegaria como R (o Retangulo) */
    if (tool === 'trilha' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && (e.key === 'R' || e.key === 'r')) { e.preventDefault(); cicloConflito(); return; }
    if (tool === 'trilha' && draft && draft.est) {
      if (e.key === '2' && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); rotaVia(false); return; }
      if (e.key === '*' || k === 'Ctrl+2' || k === teclaDe('via') || k === teclaDe('outraFace')) { e.preventDefault(); rotaVia(true); return; }
    }
  }
  if (tool === 'select' && e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey && !arrasto && !LEITOR.pendente()) {
    e.preventDefault(); tabTopologia(); return;
  }
  if (tool !== 'select' && e.key === 'Tab') {
    e.preventDefault();
    if (painel) { painel.mostra('props'); painel.foca(tool === 'trilha' ? 'tool.wTrilha' : null); }
    return;
  }
  if (tool === 'medir' && draft && draft.tipo === 'medida') {
    if ((e.key === ' ' || e.code === 'Space') && draft.b) {
      e.preventDefault();
      const i = MODOS_CICLO.indexOf(draft.modo || 'auto');
      draft.modo = MODOS_CICLO[(i + 1) % MODOS_CICLO.length];
      avisoRodape('cota ' + HCOT.MODOS[draft.modo] + ' (Espaço troca)'); pintaStatus(); pede(); return;
    }
    if (e.key === 'Backspace') { e.preventDefault(); if (draft.b) { draft.b = null; draft.modo = 'auto'; } else draft = null; pintaStatus(); pede(); return; }
    if (e.key === 'Enter' && draft.b) { e.preventDefault(); fixaCota(draft.q || draft.b); return; }
  }
  if ((tool === 'poligono' || tool === 'contorno' || tool === 'pour') && e.key === 'Enter') { e.preventDefault(); fechaPoligono(); return; }
  if (tool !== 'select' && tool !== 'trilha' && tool !== 'linha' && e.key === 'Backspace' && desfazPontoPoligono()) { e.preventDefault(); return; }
  if (k === 'Espaço') { if (!SEL.length || LEITOR.pendente()) return; e.preventDefault(); }
  /* T, D, R do Altium: o R logo depois de abrir o DRC e o "Run Design Rule Check" do dialogo */
  if (k === 'R' && drcPainel && Date.now() - drcAbertoEm < 4000) {
    e.preventDefault(); drcAbertoEm = 0;
    const r = rodaDrc(); if (r && typeof drcPainel.mostra === 'function') drcPainel.mostra(r);
    HubDialog.toast('DRC: ' + (r ? (r.violacoes || []).length + ' violação(ões)' : 'não rodou'), r && (r.violacoes || []).length ? 'warn' : 'ok', 2200);
    return;
  }
  /* a letra que nao e de nenhuma acao abre o menu do Altium dela no cursor (T Tools, D Design...) */
  if (ALT && /^[A-Z]$/.test(k) && !LEITOR.pendente() && !ATALHOS.porTecla[k] && !(ATALHOS.prefixos && ATALHOS.prefixos.has(k)) && ALT.temPopup(k)) {
    e.preventDefault(); popupDoLeitor(k); return;
  }
  if (LEITOR.tecla(k)) e.preventDefault();
});
/* ============================== vista 3D (View » 3D Layout Mode, tecla 3) ==============================
   A placa em WebGL (hub-pcb3d-vista.js): contorno, recortes e furos vazados, as faces pintadas com
   o MESMO cache da vista 2D (mascara, cobre sob ela, metal onde ela abre, serigrafia) e os corpos
   dos componentes pelo HubPcb3dModelo -- o STEP/extrudado que o editor de footprint do hub prendeu
   ao footprint (Libs/pcblib-hub.js) vale primeiro, depois o board3d.js do PcbDoc, depois o
   pcblib-3d.js; sem nenhum, so o footprint (nada de caixa inventada). A tecla 2 volta ao 2D. Ferramenta de desenho
   chamada no 3D volta ao 2D antes, como no Altium. */
let V3 = null, modo3d = false, HUBLIB = null, D3 = undefined, LIB3D = undefined, v3Agendado = 0;
/* O 3D PRONTO DE ANTEMAO (pedido do dono, 2026-10-19: "aperto 3 vai pro 3D, aperto de novo sai, mas
   precisa ser instantaneo igual ao do Altium; talvez carregar o 3D assim que entra na pagina"). A
   vista e criada logo que a pagina fica ociosa, escondida com visibility:hidden (tem tamanho: compila
   os shaders e sobe as texturas na GPU), e depois de cada mudanca a cena se refaz em segundo plano,
   quando a tela para. A tecla 3 so mostra; a 2 so esconde. */
let sujo3d = true, prepara3dP = null, fundo3d = 0, cena3dSeq = 0, poseFlip = null;
const v3Esconde = h => { h.hidden = false; h.style.visibility = 'hidden'; h.style.pointerEvents = 'none'; };
const v3Mostra = h => { h.hidden = false; h.style.visibility = ''; h.style.pointerEvents = ''; };
const SO_2D = new Set(['trilha', 'via', 'linha', 'arco', 'circulo', 'retangulo', 'poligono', 'texto', 'triangulo', 'furo',
  'contorno', 'medir', 'sinalizar', 'pad', 'pour', 'fill', 'solidRegion', 'retanguloContorno', 'colar', 'duplicar',
  'espelhoX', 'espelhoY', 'camadaUnica', 'proxCamada', 'antCamada', 'outraFace', 'grade', 'diff', 'gradeId', 'zoomIn', 'zoomOut',
  'enquadrarSel', 'painelGrade', 'autorotear', 'autorotearNets']);
function hubLib(){
  if (HUBLIB) return HUBLIB;
  if (typeof HubFpLib === 'undefined') return null;
  HUBLIB = HubFpLib.normaliza(typeof pcblibHub !== 'undefined' ? pcblibHub : null);
  return HUBLIB;
}
/* o comp_add (ECO, Update PCB) acha o footprint do hub antes do do Altium com o mesmo nome */
function registraLibHub(){
  const h = hubLib();
  if (typeof HubFpLib === 'undefined' || !h) return;
  const alt = typeof pcblib !== 'undefined' ? pcblib : null;
  if (h.footprints.length) HC.setPcbLib(HubFpLib.mescla(alt, h));
  else if (alt) HC.setPcbLib(alt);
}
const refDoComp = m => { const i = model.comps.indexOf(m); return i >= 0 && EB.components[i] ? EB.components[i].ref : (m.src && m.src.ref); };
/* o 3D Body do footprint, para a ficha do componente */
function corpos3dDe(nome){
  const h = hubLib(), f = h && typeof HubFpLib !== 'undefined' ? HubFpLib.acha(h, nome) : null;
  const n = f ? (f.bodies || []).length : 0;
  if (n) return n + ' corpo(s) — biblioteca do hub';
  if (D3 && (D3.bodies || []).length) return 'do PcbDoc (board3d.js)';
  return 'nenhum — no 3D aparece só o footprint (Edit Footprint… prende o STEP)';
}
function refsDaSel(){ return compsDaSel().map(refDoComp).filter(Boolean); }
function alvoDoRef(ref){
  const i = (EB.components || []).findIndex(c => c && c.ref === ref);
  return i >= 0 && model.comps[i] ? ALVO_COMP.get(model.comps[i]) : null;
}
/* a face da placa para a textura: o cache da vista 2D, com as cores do 3D do Altium */
function pintaFace3d(c, lado){
  if (cacheSujo || !CACHE || CACHE.vis !== null) montaCache(true);
  const L = lado === 'top' ? 'Top' : 'Bottom';
  const pinta = (k, cor) => {
    const cc = CACHE.cam.get(k); if (!cc) return;
    c.fillStyle = cor; c.strokeStyle = cor; c.fill(cc.cheios);
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (const [q, P] of cc.tracos) { c.lineWidth = q / 1e4; c.stroke(P); }
  };
  c.fillStyle = '#1b6233'; c.fill(pathPlaca(), 'evenodd');
  pinta(L, '#2c8446'); pinta('Multi', '#2c8446');
  const sm = CACHE.cam.get(L + 'Solder');
  if (sm) {
    c.save(); c.clip(sm.cheios);
    c.fillStyle = '#b8a76f'; c.fill(pathPlaca(), 'evenodd');
    pinta(L, '#d9d6cf'); pinta('Multi', '#d9d6cf');
    c.restore();
  }
  pinta(L + 'Overlay', '#f4f4f4');
}
/* os corpos 3D da placa efetiva, com a biblioteca do NexoCAD por cima (hub-nexo.js): a vista 3D,
   o "Editar 3D no NexoCAD" e o pacote da placa usam a MESMA lista */
/* a espessura da placa: a da pilha de camadas do hub (stack_set) manda; senao a do board3d.js do PcbDoc */
function espessuraPlaca(){
  const s = EB && EB.stackup;
  if (s && isNum(s.thickness) && s.thickness > 0) return s.thickness;
  return (D3 && isNum(D3.thickness) && D3.thickness > 0) ? D3.thickness : 1.6;
}
/* tela: a vista 3D (vista) e as silhuetas da 2D -- so elas obedecem ao "Componentes 3D" desligado;
   o pacote do NexoCAD e o Editar 3D levam os corpos sempre */
async function corpos3d(vista, tela){
  if (D3 === undefined) D3 = PROJ ? await globalDe('pcbmirror3d', 'Projects/' + encodeURIComponent(PROJ) + '/board3d.js') : null;
  if (LIB3D === undefined) LIB3D = await globalDe('pcblib3d', 'Libs/pcblib-3d.js');
  const esp = espessuraPlaca();
  if ((vista || tela) && !OPC3D.corpos) return { corpos:[], esp };
  if (typeof HubNexo !== 'undefined') { try { await HubNexo.carrega(); } catch (e) { /* sem a biblioteca: as fontes de sempre */ } }
  const h = hubLib();
  let corpos = [];
  if (typeof HubPcb3dModelo !== 'undefined') {
    try {
      corpos = HubPcb3dModelo.corpos(EB, D3 || null, { pcblib3d:LIB3D || null, pcblib3dHub:h && typeof HubFpLib !== 'undefined' ? HubFpLib.lib3d(h) : null,
        base:'Projects/' + encodeURIComponent(PROJ || '') + '/', baseLib:'Libs/', thickness:esp, board:B,
        nexo:typeof HubNexo !== 'undefined' ? HubNexo.resolvedor() : null, projeto:PROJ || '',
        solda:() => !!vista && soldaNo3d(),
        /* na tela, componente sem 3D fica so com o footprint (pedido do dono, 2026-10-19: nada de caixa inventada) */
        placeholder:!vista });
    } catch (e) { console.warn('3D: corpos', e); }
  }
  /* a solda e so de visualizacao: fora da tela (o pacote da placa para o NexoCAD, o Editar 3D) o
     corpo vai inteiro e sem o ponto de solda */
  if (!vista) corpos = corpos.filter(b => b && b.kind !== 'solda').map(b => { if (!b.corte) return b; const c = Object.assign({}, b); delete c.corte; return c; });
  return { corpos, esp };
}
/* Editar 3D no NexoCAD: o corpo STEP sob o cursor (no 3D) ou o primeiro do componente; sem STEP,
   um item novo vinculado ao footprint. Salvou no NexoCAD: o HubNexo.aoMudar refaz o 3D */
let CORPO_MENU = null, nexoDesliga = null;
async function editar3dNexo(m){
  if (typeof HubNexo === 'undefined') return;
  const i = m ? model.comps.indexOf(m) : -1, ec = i >= 0 ? EB.components[i] : null;
  if (!ec) { HubDialog.toast('escolha um componente', 'info'); return; }
  const { corpos, esp } = await corpos3d();
  const meus = corpos.filter(b => b && b.owner === ec.ref);
  const sob = CORPO_MENU && CORPO_MENU.owner === ec.ref && CORPO_MENU.kind === 'step' ? CORPO_MENU : null;
  const b = sob || meus.find(x => x.kind === 'step' && (x.modelUrl || x.nexo)) || null;
  const geometria = HubNexo.geometriaDeComp(ec);
  const fp = ec.footprint || '';
  if (b && b.nexo) return HubNexo.editar({ id:b.nexo });
  /* geometria.corpo: modelo (STEP) -> footprint, para o NexoCAD por o esboco dos pads no referencial do modelo */
  if (b && b.modelUrl && geometria && Array.isArray(b.matrix) && typeof HubPcb3dModelo !== 'undefined') geometria.corpo = HubPcb3dModelo.matrizLocal(b.matrix, ec, esp);
  if (b && b.modelUrl) return HubNexo.editar({ chave:b.modeloChave || '', url:b.modelUrl, nome:b.name || (fp + '.step'), footprint:fp, geometria });
  return HubNexo.editar({ novo:true, footprint:fp, nome:fp || ec.ref, geometria });
}
async function enviaPlacaNexo(){
  if (typeof HubNexoPacote === 'undefined' || typeof HubNexo === 'undefined') { HubDialog.toast('o envio ao NexoCAD (hub-nexopacote.js) não carregou nesta página', 'warn'); return; }
  const { corpos, esp } = await corpos3d();
  let r;
  try { r = HubNexoPacote.monta(EB, { projeto:PROJ || '', espessura:esp, corpos, laser:typeof HubLaser !== 'undefined' ? HubLaser : null }); }
  catch (e) { HubDialog.toast('não montei o pacote da placa: ' + (e && e.message || e), 'err', 5000); return; }
  if (r.avisos.length) console.warn('NexoCAD: pacote', r.avisos);
  return HubNexo.enviarPlaca(r.pacote);
}
/* a caixa "Solda embaixo" do painel Vista (HubPcb3dVista.soldaLigada: a mesma do editor de footprint) */
const soldaNo3d = () => !!(typeof HubPcb3dVista !== 'undefined' && typeof HubPcb3dVista.soldaLigada === 'function' && HubPcb3dVista.soldaLigada());
async function cena3d(){
  if (!V3) return;
  const seq = ++cena3dSeq;
  sujo3d = false;
  const { corpos, esp } = await corpos3d(true);
  if (seq !== cena3dSeq || !V3) return;   /* outra mudanca chegou durante a espera: vale a dela */
  const furos = [];
  const furo = p => { if (p && p.drill > 0 && isNum(p.x) && isNum(p.y)) furos.push({ x:p.x, y:p.y, r:p.drill / 2 }); };
  for (const c of (EB.components || [])) for (const p of ((c && c.pads) || [])) furo(p);
  for (const p of (EB.freepads || [])) furo(p);
  for (const v of (EB.vias || [])) furo(v);
  V3.cena({ lacos:lacosDe(EB), recortes:recortesDaTela().map(k => k.pts), furos, esp,
            bbox:EB.board && EB.board.bbox, pintaFace:pintaFace3d, corpos, realce:refsDaSel() });
}
/* a placa mudou: na tela 3D refaz ja; escondida, fica para quando a tela parar (agendaFundo3d) */
function refaz3d(){
  if (OPC3D.corpos) agendaSilhuetas();
  if (!V3) return;
  sujo3d = true;
  if (!modo3d) return;            /* escondido: refaz quando abrir (entra3d), nao a cada edicao */
  if (!v3Agendado) v3Agendado = setTimeout(() => { v3Agendado = 0; cena3d(); }, 120);
}
/* as opcoes de desempenho do 3D (painel » Propriedades da placa » Desempenho) */
function setOpc3d(k, v){
  if (!(k in OPC3D)) return;
  OPC3D[k] = !!v; gravaPref('3d.' + k, v ? '1' : '0');
  if (k === 'corpos') {
    SILH = new Map();
    if (v) agendaSilhuetas();
    if (V3) { sujo3d = true; if (modo3d) cena3d(); }
  }
  if (k === 'antes' && v && !V3 && !LEAN) agendaPrepara3d();
  if (painel) painel.atualiza(); pede();
}
function agendaFundo3d(){
  clearTimeout(fundo3d);
  fundo3d = setTimeout(() => {
    fundo3d = 0;
    if (!V3 || modo3d || !sujo3d) return;
    if (arrasto || draft || pan) { agendaFundo3d(); return; }   /* no meio de um gesto: espera ele acabar */
    const vai = () => { if (V3 && !modo3d && sujo3d) cena3d(); };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(vai, { timeout:4000 }); else vai();
  }, 1500);
}
/* cria a vista escondida e monta a cena: na carga da pagina (ocioso) ou na primeira tecla 3 */
function prepara3d(){
  if (V3) return Promise.resolve(V3);
  if (prepara3dP) return prepara3dP;
  if (typeof HubPcb3dVista === 'undefined' || !HubPcb3dVista.disponivel()) return Promise.resolve(null);
  const host = $('v3d');
  if (!modo3d) v3Esconde(host);
  prepara3dP = (async () => {
    try {
      V3 = await HubPcb3dVista.cria(host, {
        aoClicar(ref, ev){
          const a = ref ? alvoDoRef(ref) : null;
          if (!a) { if (!ev.shiftKey) selLimpa(); }
          else if (ev.shiftKey) { if (selTem(a)) selTira(a); else selSoma(a); }
          else selSo([a]);
        },
        aoMenu(ref, ev, corpo){
          CORPO_MENU = corpo || null;
          const a = ref ? alvoDoRef(ref) : null;
          if (a && !selTem(a)) selSo([a]);
          if (ALT) ALT.contexto(ev.clientX, ev.clientY, { primitivo:!!a, extras:extrasDoHub(null) });
        },
      });
    } catch (e) {
      prepara3dP = null;
      if (!modo3d) host.hidden = true;
      throw e;
    }
    /* salvou no NexoCAD (a revisao da biblioteca mudou): o 3D se refaz, sem recarregar a pagina */
    if (typeof HubNexo !== 'undefined' && !nexoDesliga) nexoDesliga = HubNexo.aoMudar(() => refaz3d());
    await cena3d();
    poseFlip = view.flip;
    V3.pose(view.flip ? 'base' : 'topo');
    return V3;
  })();
  return prepara3dP;
}
function agendaPrepara3d(){
  const vai = () => { prepara3d().catch(e => console.warn('3D: pre-carga', e)); };
  setTimeout(() => { if (typeof requestIdleCallback === 'function') requestIdleCallback(vai, { timeout:3000 }); else vai(); }, 400);
}
async function entra3d(){
  if (modo3d) return;
  if (typeof HubPcb3dVista === 'undefined' || !HubPcb3dVista.disponivel()) { HubDialog.toast('esta máquina não tem WebGL: a vista 3D não abre', 'warn', 4000); return; }
  if (tool !== 'select') setTool('select');
  const host = $('v3d');
  modo3d = true; v3Mostra(host);
  avisoRodape('3D — Shift+botão direito (ou arrastar) gira · botão direito arrasta · 0 topo · 8 isométrica · 9 gira 90° · 2 volta ao 2D');
  if (!V3) {
    try { await prepara3d(); }
    catch (e) {
      modo3d = false; host.hidden = true; avisoRodape('');
      HubDialog.toast('a vista 3D não abriu: ' + (e && e.message || e), 'err', 5000); return;
    }
    if (!V3 || !modo3d) return;
  } else if (sujo3d) { clearTimeout(fundo3d); fundo3d = 0; cena3d(); }   /* a cena de antes aparece ja; a nova entra por cima */
  /* a camera fica onde estava, como no Altium; so o Flip Board (outra face) recoloca */
  if (poseFlip !== view.flip) { poseFlip = view.flip; V3.pose(view.flip ? 'base' : 'topo'); }
  V3.realca(refsDaSel());
  V3.redimensiona();
  try { V3.canvas.focus(); } catch (e) { /* ok */ }
}
function sai3d(){
  if (!modo3d) return;
  modo3d = false;
  v3Esconde($('v3d'));
  avisoRodape('');
  try { cv.focus(); } catch (e) { /* ok */ }
  pede();
}

/* ============================== a silhueta do 3D na placa ==============================
   Pedido do dono (2026-10-19): o contorno azul que o editor de footprint mostra de cada corpo 3D
   aparece tambem na vista PCB, em cada componente. E do componente: nao se seleciona nem anda
   sozinha -- clicar ou arrastar nela pega o componente inteiro. A conta e a do editor: o STEP vira o
   retangulo que o envolve no referencial do componente (o giro dele), o extrudado o proprio
   contorno, o cilindro e a esfera o circulo; a caixa de placeholder (sem 3D nenhum) nao tem silhueta.
   Cada silhueta guarda a pose do componente em que foi medida: o componente andou (arrasto,
   comp_move) e ela vai junto pela conta do motor (HC.compDelta), sem esperar a proxima medida. */
let SILH = new Map(), silhSeq = 0, silhAgendado = 0;
const STEP_PTS = new Map();   /* chave do modelo -> amostra dos vertices da malha (x,y,z em serie) */
const poseDe = c => ({ x:c.x, y:c.y, rot:isNum(c.rot) ? c.rot : 0, layer:c.layer === 'Bottom' ? 'Bottom' : 'Top' });
function agendaSilhuetas(){
  if (LEAN || silhAgendado) return;
  silhAgendado = setTimeout(() => { silhAgendado = 0; atualizaSilhuetas().catch(e => console.warn('silhueta 3D', e)); }, 200);
}
function amostraStep(malhas){
  let n = 0;
  for (const mm of malhas || []) n += mm && mm.pos ? mm.pos.length / 3 : 0;
  const passo = Math.max(1, Math.floor(n / 6000)), out = [];
  for (const mm of malhas || []) {
    const P = mm && mm.pos; if (!P) continue;
    for (let i = 0; i + 2 < P.length; i += 3 * passo) out.push(P[i], P[i + 1], P[i + 2]);
  }
  return out;
}
function ptsDoStep(b){
  const k = b.chave || b.model || b.modelUrl;
  if (STEP_PTS.has(k)) return STEP_PTS.get(k);
  if (typeof HubPcb3dStep === 'undefined' || !b.modelUrl) return null;
  const p = HubPcb3dStep.carrega(b.modelUrl, { chave:k }).then(r => { const a = amostraStep(r && r.malhas); STEP_PTS.set(k, a); return a; },
                                                               () => { STEP_PTS.set(k, null); return null; });
  STEP_PTS.set(k, p);
  return p;
}
/* o retangulo que envolve os pontos (x,y) no referencial girado de `rot` graus */
function retanguloGirado(xy, rot){
  const a = rot * RAD, c = Math.cos(a), s = Math.sin(a);
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  for (const [x, y] of xy) { const u = x * c + y * s, v = -x * s + y * c; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
  if (!isFinite(u0)) return null;
  return [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => [u * c - v * s, u * s + v * c]);
}
async function silhuetaDe(b, comp){
  const m = Array.isArray(b.matrix) && b.matrix.length === 16 ? b.matrix : null;
  if (b.kind === 'extruded') return (b.pts || []).length >= 3 ? b.pts.map(p => [p[0], p[1]]) : null;
  if ((b.kind === 'cylinder' || b.kind === 'sphere') && b.radius > 0 && m) {
    const q = []; for (let i = 0; i < 24; i++) q.push([m[12] + b.radius * Math.cos(i * Math.PI / 12), m[13] + b.radius * Math.sin(i * Math.PI / 12)]);
    return q;
  }
  if (b.kind !== 'step' || !m) return null;
  const P = await ptsDoStep(b);
  if (!P || !P.length) return null;
  const xy = [];
  for (let i = 0; i < P.length; i += 3) { const x = P[i], y = P[i + 1], z = P[i + 2]; xy.push([m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13]]); }
  return retanguloGirado(xy, comp && isNum(comp.rot) ? comp.rot : 0);
}
async function atualizaSilhuetas(){
  const seq = ++silhSeq;
  const { corpos } = await corpos3d(false, true);
  if (seq !== silhSeq) return;
  const porRef = new Map();
  for (const c of (EB.components || [])) if (c && c.ref) porRef.set(c.ref, c);
  const novo = new Map();
  await Promise.all(corpos.map(async b => {
    if (!b || !b.owner || b.placeholder || b.kind === 'solda') return;
    const c = porRef.get(b.owner);
    if (!c) return;
    let q = null;
    try { q = await silhuetaDe(b, c); } catch (e) { q = null; }
    if (!q || q.length < 3) return;
    let s = novo.get(b.owner);
    if (!s) { s = { pose:poseDe(c), polys:[] }; novo.set(b.owner, s); }
    s.polys.push(q);
  }));
  if (seq !== silhSeq) return;
  SILH = novo;
  montaAlvos();
  pede();
}
/* as silhuetas de um componente da placa efetiva, na pose de agora */
function silhuetasDe(ec){
  const s = ec && SILH.get(ec.ref);
  if (!s) return [];
  const p = poseDe(ec), o = s.pose;
  if (Math.abs(p.x - o.x) < 1e-9 && Math.abs(p.y - o.y) < 1e-9 && Math.abs(p.rot - o.rot) < 1e-9 && p.layer === o.layer) return s.polys;
  const d = HC.compDelta({ src:o, eff:p });
  return s.polys.map(q => q.map(pt => { const r = HC.xfPoint(d, pt[0], pt[1]); return [r.x, r.y]; }));
}
function pintaSilhuetas(polys, lado){
  if (!polys.length || !camVisivel(lado === 'Bottom' ? 'BottomOverlay' : 'TopOverlay')) return;
  const P = new Path2D();
  for (const q of polys) pPoli(P, q);
  ctx.save();
  ctx.fillStyle = 'rgba(0,200,210,0.10)'; ctx.fill(P);
  ctx.strokeStyle = '#00c8d2'; ctx.lineWidth = px(1.2); ctx.setLineDash([px(6), px(4)]); ctx.stroke(P);
  ctx.restore();
}
function desenhaSilhuetas(){
  if (!SILH.size || !OPC3D.corpos) return;
  const naMao = new Set();
  if (arrasto && !arrasto.ponta && (arrasto.moveu || arrasto.girou)) for (const a of arrasto.alvos) if (a.t === 'comp') naMao.add(a.m);
  model.comps.forEach((m, i) => {
    const ec = EB.components[i];
    if (!ec || naMao.has(m) || !SILH.has(ec.ref)) return;
    pintaSilhuetas(silhuetasDe(ec), ec.layer);
  });
}

/* ============================== editor de footprint (o PCB Library do Altium) ==============================
   hub-fpeditor.js, por cima da vista. Gravou: a biblioteca do hub e registrada de novo (o proximo
   comp_add ja usa), o 3D refaz, e -- se os pads/serigrafia mudaram -- oferece o "Update PCB With"
   do Altium: os componentes da placa com esse footprint saem e voltam (comp_del + comp_add, no
   mesmo lugar, com as mesmas nets por nome de pad). Gravou com OUTRO nome a partir de um
   componente: oferece trocar o footprint dele. */
function opsTrocaFp(m, fpNome, nota){
  const i = model.comps.indexOf(m), c = EB.components[i];
  if (!c) return [];
  const nets = {};
  for (const p of (c.pads || [])) if (p && p.name != null && p.net) nets[String(p.name)] = p.net;
  const add = { op:'comp_add', ref:c.ref, footprint:fpNome, x:c.x, y:c.y, rot:isNum(c.rot) ? c.rot : 0, layer:c.layer === 'Bottom' ? 'Bottom' : 'Top' };
  if (c.comment) add.comment = c.comment;
  const n = HC.netsCampo(nets); if (n) add.nets = n;
  add.note = nota;
  return [{ op:'comp_del', ref:m.src.ref, orig_x:c.x, orig_y:c.y, orig_rot:isNum(c.rot) ? c.rot : 0, orig_layer:c.layer,
            orig_footprint:m.src.footprint || '', note:nota }, add];
}
async function editaFootprint(m){
  if (typeof HubFpEditor === 'undefined' || typeof HubFpLib === 'undefined') { HubDialog.alert('O editor de footprint (hub-fpeditor.js) não carregou nesta página. Atualize o hub (F5).', { title:'Footprint' }); return; }
  const i = m ? model.comps.indexOf(m) : -1;
  const ec = i >= 0 ? EB.components[i] : null;
  const nome = ec ? (ec.footprint || '') : '';
  const alt = await globalDe('pcblib', 'Libs/pcblib.js');
  HUBLIB = await HubFpLib.carrega();
  registraLibHub();
  /* reserva: o footprint que so existe na placa (embutido ou tirado do componente) */
  let reserva = null;
  if (nome && !HubFpLib.acha(HUBLIB, nome) && !(alt && (alt.footprints || []).some(f => f && f.name === nome))) {
    try { const g = HC.footprintGeom(nome, B, {}); if (g && g.fp) reserva = Object.assign(JSON.parse(JSON.stringify(g.fp)), { name:nome }); } catch (e) { /* sem geometria */ }
  }
  const geo = f => f ? JSON.stringify([f.pads || [], f.silk || []]) : '';
  const antes = new Map();
  const fpDe = n => HubFpLib.acha(HUBLIB, n) || (alt && (alt.footprints || []).find(f => f && f.name === n)) || (n === nome ? reserva : null);
  await HubFpEditor.abre({ nome, fp:reserva, pcblib:alt, titulo:'PCB Library',
    async aoSalvar(fp, lib){
      HUBLIB = lib; registraLibHub();
      if (!antes.has(fp.name)) antes.set(fp.name, geo(fpDe(fp.name) || (fp.name === nome ? reserva : null)));
      const usam = model.comps.filter((c, j) => EB.components[j] && EB.components[j].footprint === fp.name);
      const mudouGeo = antes.get(fp.name) !== geo(fp);
      antes.set(fp.name, geo(fp));
      let ops = [];
      if (m && ec && fp.name !== nome && model.comps.indexOf(m) >= 0 &&
          await HubDialog.confirm('Trocar o footprint de ' + ec.ref + ' de "' + nome + '" para "' + fp.name + '"?', { title:'Footprint', ok:'Trocar' })) {
        ops = ops.concat(opsTrocaFp(m, fp.name, 'footprint trocado no editor de footprint do hub'));
      }
      if (mudouGeo && usam.length &&
          await HubDialog.confirm(usam.length + ' componente(s) da placa usam "' + fp.name + '". Atualizar com os pads novos? (o "Update PCB With" do Altium: saem e voltam no mesmo lugar, com as mesmas nets)', { title:'Update PCB', ok:'Atualizar' })) {
        for (const c of usam) if (!(m && c === m && ops.length)) ops = ops.concat(opsTrocaFp(c, fp.name, 'footprint atualizado no editor de footprint do hub'));
      }
      if (ops.length && garanteEdicao()) { for (const op of ops) CH.push(op); commit(); HubDialog.toast(ops.length / 2 + ' componente(s) atualizados', 'ok'); }
      refaz3d();
    } });
  HUBLIB = await HubFpLib.carrega(); registraLibHub();
  refaz3d();
}

/* o que cada acao da tabela faz (a tabela da a tecla; aqui, o efeito) */
function fazAcao(id, arg){
  fechaMenu();
  if (modo3d && SO_2D.has(id)) sai3d();
  if (modo3d && V3) {
    switch (id) {
      case 'enquadrar': V3.enquadra(); return;
      case 'virar': V3.vira(); return;
    }
  }
  switch (id) {
    case 'vista3d': entra3d(); return;
    case 'vista2d': sai3d(); return;
    case 'v3topo': case 'v3base': case 'v3frente': case 'v3tras': case 'v3esq': case 'v3dir': case 'v3iso': case 'v3isoVirada':
      if (!modo3d) { entra3d().then(() => { if (V3 && modo3d) fazAcao(id); }); return; }
      V3.pose({ v3topo:'topo', v3base:'base', v3frente:'frente', v3tras:'tras', v3esq:'esq', v3dir:'dir', v3iso:'iso', v3isoVirada:'isoVirada' }[id]); return;
    case 'v3girarEsq': if (V3 && modo3d) V3.gira(-30); return;
    case 'v3girarDir': if (V3 && modo3d) V3.gira(30); return;
    case 'v3subir': if (V3 && modo3d) V3.inclina(30); return;
    case 'v3descer': if (V3 && modo3d) V3.inclina(-30); return;
    case 'v3gira90': if (V3 && modo3d) V3.gira(90); return;
    case 'editarFp': { const L = compsDaSel(); editaFootprint(L.length === 1 ? L[0] : null); return; }
    case 'nexoEditar3d': { const L = compsDaSel(); const c = CORPO_MENU; editar3dNexo(L.length === 1 ? L[0] : null).finally(() => { if (CORPO_MENU === c) CORPO_MENU = null; }); return; }
    case 'nexoPlaca': enviaPlacaNexo(); return;
    case 'gradeId': setGrade(arg); HubDialog.toast('grade ' + grade.rot, 'info', 1400); return;
    case 'desselecionar': selLimpa(); return;
    case 'selNet': { const n = netDaSel(); if (n) selecionaNets(new Set([n])); return; }
    case 'selNetsComp': {
      const s = new Set();
      for (const m of compsDaSel()) for (const p of m.src.pads || []) if (p.net) s.add(p.net);
      if (s.size) selecionaNets(s); else HubDialog.toast('o componente não tem net', 'info');
      return;
    }
    case 'virarSel': transformaSelecao('vira'); return;
    case 'compNaGrade': {
      /* Move Component Origin To Grid / Align To Grid: a origem do componente cai no passo da grade */
      const L = compsDaSel(); if (!L.length || !garanteEdicao()) return;
      let n = 0;
      for (const m of L) {
        const g = { x:m.eff.x, y:m.eff.y, rot:isNum(m.eff.rot) ? m.eff.rot : 0, layer:m.eff.layer };
        const nx = snapV(g.x, grade.mm), ny = snapV(g.y, grade.mm);
        if (near(nx, g.x) && near(ny, g.y)) continue;
        g.x = nx; g.y = ny; moveComp(m, g); n++;
      }
      if (n) commit();
      HubDialog.toast(n ? n + ' componente(s) na grade ' + grade.rot : 'já estão na grade ' + grade.rot, 'info', 2000);
      return;
    }
    case 'enquadrarSel': if (SEL.length) enquadraAlvos(SEL); return;
    case 'zoomIn': zoomCentro(1.4); return;
    case 'zoomOut': zoomCentro(1 / 1.4); return;
    case 'conexoesOn': if (!conexoesLigadas()) toggleConexoes(); return;
    case 'conexoesOff': if (conexoesLigadas()) toggleConexoes(); return;
    case 'limparFiltro': limpaRealce(); return;
    case 'fill': if (!preencher) togglePreencher(); setTool('retangulo'); return;
    case 'solidRegion': if (!preencher) togglePreencher(); setTool('poligono'); return;
    case 'retanguloContorno': if (preencher) togglePreencher(); setTool('retangulo'); return;
    case 'propriedades': if (painel) { painel.mostra('props'); painel.foca(); } return;
    case 'painelGrade': case 'boardInfo': if (tool !== 'select') setTool('select'); selLimpa(); if (painel) painel.mostra('props'); return;
    case 'preferencias': if (ALT) ALT.preferencias(); return;
    case 'atalhos': if (ALT) ALT.preferencias('Shortcuts'); return;
    case 'sobre': HubDialog.toast('NexoEletric — vista PCB no padrão do Altium Designer 21', 'info', 3000); return;
    case 'trilha': setTool(tool === 'trilha' ? 'select' : 'trilha'); return;
    case 'via':
      if (tool === 'trilha' && draft && draft.est) { rotaVia(true); return; }
      setTool(tool === 'via' ? 'select' : 'via'); return;
    case 'linha': case 'arco': case 'circulo': case 'retangulo': case 'poligono': case 'texto':
      setTool(tool === id ? 'select' : id); return;
    case 'furo': setTool('furo'); return;
    case 'fixacaoMarcacoes': fixacaoNasMarcacoes(); return;
    case 'furoDoCirculo': { const cs = SEL.filter(circuloDoAlvo); if (cs.length) furosDosCirculos(cs); else HubDialog.toast('selecione um círculo (arco de 360°) para virar furo de fixação', 'info'); return; }
    case 'triangulo': case 'contorno':
      setTool(tool === id ? 'select' : id); return;
    case 'medir': setTool(tool === 'medir' ? 'select' : 'medir'); return;
    case 'cotas': setCotasVer(!show.cotas); HubDialog.toast(show.cotas ? 'cotas à vista (' + COTAS.length + ')' : 'cotas escondidas', 'info', 1400); return;
    case 'apagarCotas': apagaCotas(); return;
    case 'sinalizar': setTool(tool === 'sinalizar' ? 'select' : 'sinalizar'); return;
    case 'preencher': togglePreencher(); return;
    case 'unidade': setUnidade(unidade === 'mm' ? 'mil' : 'mm'); return;
    case 'camadaUnica': setUnica(); HubDialog.toast(show.unica ? 'camada única: ' + nomeDe(cur) : 'todas as camadas', 'info', 1600); return;
    case 'proxCamada': camadaVizinha(1); return;
    case 'antCamada': camadaVizinha(-1); return;
    case 'outraFace': {
      if (tool === 'trilha' && draft && draft.est) { rotaVia(true); return; }
      const par = HC.flipLayer(cur, B);
      setCur(par !== cur && LBYK[par] ? par : proximaCobre(cobre(cur) ? cur : 'Top'));
      return;
    }
    case 'virar': setFlip(); HubDialog.toast(view.flip ? 'vista de baixo (como o Flip Board do Altium)' : 'vista de cima', 'info', 1600); return;
    case 'grade': show.grid = !show.grid; if (painel) painel.atualiza(); pede(); return;
    case 'diff': setMarcas(!show.ghost); HubDialog.toast(show.ghost ? 'marcações das mudanças: à vista' : 'marcações das mudanças: escondidas', 'info', 1600); return;
    case 'enquadrar': enquadra(); return;
    case 'girar': if (arrasto) giraNoArrasto('gira'); else transformaSelecao('gira'); return;
    case 'espelhoX': if (arrasto) giraNoArrasto('x'); else transformaSelecao('x'); return;
    case 'espelhoY': if (arrasto) giraNoArrasto('y'); else transformaSelecao('y'); return;
    case 'apagar': if (!SEL.length) return; if (!editOn && !soNotas(SEL)) { avisoTrava(); return; } apagaSelecao(); return;
    case 'desfazer': if (!desfaz()) HubDialog.toast('nada para desfazer', 'info', 1400); return;
    case 'refazer': if (!refaz()) HubDialog.toast('nada para refazer', 'info', 1400); return;
    case 'tudo': selecionaTudo(); return;
    case 'editar': setEdit(!editOn); HubDialog.toast(editOn ? 'edição destravada' : 'edição travada (só leitura)', 'info', 1600); return;
    case 'salvar': salvar(); return;
    case 'autosave': alternaAutosave(); return;
    case 'ajuda': toggleAjuda(); return;
    case 'gerber': abreGerber(); return;
    case 'pdf': abrePdf(); return;
    case 'pad': setTool(tool === 'pad' ? 'select' : 'pad'); return;
    case 'pour': setTool(tool === 'pour' ? 'select' : 'pour'); return;
    case 'repour': repour(); return;
    case 'atualizarPcb': abreEco(); return;
    case 'drc': abreDrc(); return;
    case 'regras': abreRegras(); return;
    case 'novaPlaca': abreNovaPlaca(); return;
    case 'ratsnest': toggleConexoes(); return;
    case 'realcarNet': if (!limpaRealce() && SEL.length === 1 && SEL[0].m && SEL[0].m.eff && SEL[0].m.eff.net) realcaNet(SEL[0].m.eff.net); return;
    case 'teardrops': poeTeardrops(); return;
    case 'autorotear': abreAutorotear('todas'); return;
    case 'autorotearNets': abreAutorotear(netsDaSel().length ? 'sel' : 'todas'); return;
    case 'copiar': copiaSelecao(false); return;
    case 'recortar': if (!SEL.length) return; copiaSelecao(true); return;
    case 'colar': comecaColar(false); return;
    case 'duplicar': duplicaSelecao(); return;
    case 'alinharEsq': case 'alinharDir': case 'alinharTopo': case 'alinharBase':
    case 'alinharCentroH': case 'alinharCentroV': case 'distribuirH': case 'distribuirV':
      alinhaSelecao(id); return;
  }
}

/* ============================== ajuda ============================== */

function ajudaAberta(){ const h = $('help'); return !!h && !h.hidden; }
function toggleAjuda(v){
  const h = $('help'); if (!h) return;
  const abrir = v === undefined ? h.hidden : !!v;
  if (abrir) montaAjuda();
  h.hidden = !abrir;
}
function montaAjuda(){
  const h = $('help');
  const linha = (rot, teclas, quando) => {
    const tr = document.createElement('tr');
    const a = document.createElement('td'); a.textContent = rot;
    const b = document.createElement('td');
    teclas.forEach((t, i) => { if (i) b.append(' + '); const k = document.createElement('kbd'); k.textContent = t; b.append(k); });
    const c = document.createElement('td'); c.className = 'q'; c.textContent = quando || '';
    tr.append(a, b, c); return tr;
  };
  h.textContent = '';
  const t1 = document.createElement('h2'); t1.textContent = 'Vista PCB — teclas e gestos';
  const p = document.createElement('p');
  p.textContent = 'Espelho da placa exportada do Altium, em mm (ou mil, Q), Y para cima, relativo à origem da placa. ' +
    'O que se desenha e edita aqui vira linhas do changes.js, que o ApplyChanges leva ao Altium. As teclas trocam-se nas Configurações do hub, aba Atalhos.';
  const tab = document.createElement('table');
  for (const a of TECLADO.padrao) tab.append(linha(a.rotulo, [teclaDe(a.id) || a.tecla], 'vista PCB'));
  for (const g of TECLADO.gestos) tab.append(linha(g.rotulo, g.teclas || [], g.quando || 'vista PCB'));
  const leg = document.createElement('p');
  leg.className = 'leg';
  leg.textContent = 'Fantasmas (D): tracejado = como era; contorno verde = adicionado; vermelho = removido; seta amarela = de onde para onde andou.';
  const fim = document.createElement('p'); fim.className = 'leg'; fim.textContent = 'Feche com Esc, ' + (teclaDe('ajuda') || 'H') + ' ou clicando aqui.';
  h.append(t1, p, tab, leg, fim);
}

/* ============================== a ficha (o que o painel mostra e edita) ==============================
   O painel (hub-pcbpainel.js) so desenha: a ficha diz QUAIS campos, com que valor e tipo, e a
   volta vem por editarCampo(chave, valor). Tipos: camada/enum (select), net, dist (mm, mostrado na
   unidade da tela), ang (graus), texto, bool, ro (so leitura). A CAMADA e sempre o primeiro campo:
   e o "clico na trilha e mudo a camada" do dono. */
const NETS = Array.isArray(B.nets) ? B.nets.filter(n => typeof n === 'string' && n) : [];
function opcCamadas(f){ return LAYERS.filter(l => l.kind !== 'multi' && (!f || f(l))).map(l => ({ v:l.key, rot:rotuloAba(l), cor:l.color })); }
const opcFaces = () => ['Top', 'Bottom'].filter(k => LBYK[k]).map(k => ({ v:k, rot:rotuloAba(LBYK[k]), cor:corDe(k) }));
function opcNets(atual){
  const L = [{ v:'', rot:'(sem net)' }].concat(NETS.map(n => ({ v:n, rot:n })));
  if (atual && NETS.indexOf(atual) < 0) L.push({ v:atual, rot:atual + ' (não está nas nets do espelho)' });
  return L;
}
const par = (rot, a, b) => ({ par:[a, b], rot });
const ESTADO = m => m.added ? 'novo (changes.js)' : m.deleted ? 'removido' : m.changed ? 'editado' : '';
/* ---- o pad no painel ----
   Pad de COMPONENTE: a forma vem do footprint (muda no editor de footprint), mas clicar nele e o
   jeito mais comum de "clicar no componente" -- entao a ficha traz o componente editavel em cima
   (comp.x, comp.y, comp.rot, comp.layer), como o Altium deixa a partir do pad.
   Pad SOLTO (o do Altium sem componente, ou o que a ferramenta Pad pos): tudo editavel, pelo
   pad_edit do motor (ou a propria linha pad_add, se e do hub). Trocar o tipo (SMD / passante / NPTH)
   nao e edicao no contrato: vira pad_del + pad_add no mesmo lugar. */
const PAD_FORMAS_OPC = [['circle', 'Round'], ['rect', 'Rectangular'], ['roundrect', 'Rounded Rectangle'], ['oval', 'Oval'], ['octagon', 'Octagonal']].map(([v, rot]) => ({ v, rot }));
const FURO_OPC = [['circle', 'Round'], ['rect', 'Rectangle'], ['oblong', 'Slot']].map(([v, rot]) => ({ v, rot }));
const TIPO_PAD_OPC = [{ v:'smd', rot:'SMD (uma face)' }, { v:'th', rot:'Passante (metalizado)' }, { v:'npth', rot:'Furo NPTH (sem cobre)' }];
const tipoDoPad = p => p.type === 'smd' ? 'smd' : (p.plated === false ? 'npth' : 'th');
function camposDoPadRo(p){
  const f = formaLado(p, ladoDaVista());
  return [
    { k:'layer', rot:'Layer', tipo:'ro', v:ehTH(p) ? 'Multi-Layer (passante)' : nomeDe(p.layer) },
    { k:'net', rot:'Net', tipo:'ro', v:p.net || '—' },
    { k:'shape', rot:'Shape', tipo:'ro', v:String(f.shape || 'rect') },
    par('Size (X/Y)', { k:'w', rot:'X', tipo:'ro', v:fmtDist(f.w) + ' ' + unidade }, { k:'h', rot:'Y', tipo:'ro', v:fmtDist(f.h) + ' ' + unidade }),
    { k:'drill', rot:'Hole Size', tipo:'ro', v:p.drill > 0 ? fmtDist(p.drill) + ' ' + unidade + (p.drillw > 0 ? ' × ' + fmtDist(p.drillw) : '') + (p.plated === false ? ' · NPTH' : '') : '—' },
    par('Location (X/Y)', { k:'x', rot:'X', tipo:'ro', v:fmtDist(p.x) }, { k:'y', rot:'Y', tipo:'ro', v:fmtDist(p.y) }),
    { k:'rot', rot:'Rotation', tipo:'ro', v:fmtNum(p.rot || 0, 3) + '°' },
    { k:'sm', rot:'Solder Mask', tipo:'ro', v:(tampado(p, 'top') && tampado(p, 'bottom')) ? 'tampado' : '+' + fmtDist(expMascara(p)) + ' ' + unidade + (isNum(p.sm) ? '' : ' (regra)') },
  ];
}
function fichaPadDoComp(a){
  const m = a.comp, e = m.eff, ref = e.designator || m.src.ref, p = a.eb;
  return { titulo:'Pad ' + ref + '.' + (p.name || ''), sub:'do componente ' + ref + ' — a forma do pad vem do footprint', campos:[
    { sec:'Component ' + ref },
    par('Location (X/Y)', { k:'comp.x', rot:'X', tipo:'dist', v:e.x }, { k:'comp.y', rot:'Y', tipo:'dist', v:e.y }),
    { k:'comp.rot', rot:'Rotation', tipo:'ang', v:e.rot || 0 },
    { k:'comp.layer', rot:'Layer', tipo:'enum', v:e.layer, opc:opcFaces() },
    { k:'comp.comment', rot:'Comment', tipo:'texto', v:e.comment !== undefined ? e.comment : (m.src.comment || '') },
    { botoes:[{ id:'selComp', rot:'Select Component' }, { id:'girar', rot:'Rotate 90°' }, { id:'virar', rot:'Flip' }] },
    { botoes:[{ id:'editarFp', rot:'Edit Footprint…' }] },
    { sec:'Pad ' + (p.name || '') },
    /* as camadas do pad pelo footprint (pedido do dono, 2026-10-29: "pad configura camada pelo footprint,
       só clicar nele e definir quais layers ele pega"): muda o footprint na biblioteca do hub e os
       componentes da placa com ele se atualizam (padNoFootprint) */
    { k:'fp.camadas', rot:'Camadas', tipo:'enum', v:camadasDoPad(p, IDX.ebComp.get(m)), opc:CAMADAS_PAD_OPC,
      dica:'muda no footprint "' + (m.src.footprint || '') + '": vale para todos os componentes com ele' },
    { botoes:[{ id:'fpPadsTodos', rot:'Todos os pads do footprint assim', dica:'as camadas deste pad em todos os pads do footprint' }] },
  ].concat(camposDoPadRo(p)) };
}
const CAMADAS_PAD_OPC = [{ v:'smd:Top', rot:'SMD — lado do componente' }, { v:'smd:Bottom', rot:'SMD — lado oposto' }, { v:'th', rot:'Passante — todas as camadas' }];
const ROT_CAMADAS_PAD = { 'smd:Top':'SMD do lado do componente', 'smd:Bottom':'SMD do lado oposto', th:'passante' };
/* o pad visto do footprint: passante, ou SMD do lado do componente / do lado oposto */
function camadasDoPad(p, ec){
  if (ehTH(p)) return 'th';
  const lado = ec && ec.layer === 'Bottom' ? 'Bottom' : 'Top';
  return p.layer === lado ? 'smd:Top' : 'smd:Bottom';
}
/* o pad no referencial do footprint (para achar qual e, entre pads de nome repetido) */
function localDoPad(p, ec){
  const dx = p.x - ec.x, dy = p.y - ec.y, a = -(isNum(ec.rot) ? ec.rot : 0) * Math.PI / 180;
  let x = dx * Math.cos(a) - dy * Math.sin(a); const y = dx * Math.sin(a) + dy * Math.cos(a);
  if (ec.layer === 'Bottom') x = -x;
  return { x, y };
}
function mudaCamadasPad(q, v){
  if (v === 'th') {
    if (q.type === 'th') return false;
    const menor = Math.min(q.w || 0, q.h || 0);
    let d = isNum(q.drill) && q.drill > 0 ? q.drill : Math.round(menor * 0.5 * 1e4) / 1e4;
    if (!(d < menor)) d = Math.round(menor * 0.6 * 1e4) / 1e4;
    q.type = 'th'; q.layer = 'Multi'; q.drill = d; q.drillshape = q.drillshape || 'circle'; delete q.plated;
    return true;
  }
  const lado = v === 'smd:Bottom' ? 'Bottom' : 'Top';
  if (q.type === 'smd' && q.layer === lado) return false;
  q.type = 'smd'; q.layer = lado;
  for (const k of ['drill', 'drillshape', 'drillw', 'holerot', 'plated']) delete q[k];
  return true;
}
async function padNoFootprint(a, v, todos){
  if (!a || a.t !== 'pad' || !a.comp || !ROT_CAMADAS_PAD[v]) return;
  if (typeof HubFpLib === 'undefined' || !HubIO.canPost) { HubDialog.toast('este hub não grava a biblioteca de footprints: use o Edit Footprint no app', 'warn', 4000); return; }
  const m = a.comp, i = model.comps.indexOf(m), ec = i >= 0 ? EB.components[i] : null;
  const nome = ec ? (ec.footprint || '') : '';
  if (!nome) { HubDialog.toast('o componente não tem footprint', 'warn'); return; }
  HUBLIB = await HubFpLib.carrega();
  const alt = await globalDe('pcblib', 'Libs/pcblib.js');
  let fonte = HubFpLib.acha(HUBLIB, nome) || (alt && (alt.footprints || []).find(f => f && f.name === nome)) || null;
  if (!fonte) { try { const g = HC.footprintGeom(nome, B, {}); if (g && g.fp) fonte = g.fp; } catch (e) { /* sem geometria */ } }
  if (!fonte) { HubDialog.toast('não achei o footprint "' + nome + '" (nem no hub, nem no Altium, nem na placa)', 'warn', 4000); return; }
  const fp = HubFpLib.copia(fonte); fp.name = nome;
  let alvos;
  if (todos) alvos = (fp.pads || []).filter(Boolean);
  else {
    const loc = localDoPad(a.eb, ec), d = q => Math.hypot((q.x || 0) - loc.x, (q.y || 0) - loc.y);
    const mesmos = (fp.pads || []).filter(q => q && String(q.name) === String(a.eb.name));
    const q = mesmos.length ? mesmos.reduce((b, x) => d(x) < d(b) ? x : b) : (fp.pads || []).filter(Boolean).reduce((b, x) => !b || d(x) < d(b) ? x : b, null);
    alvos = q ? [q] : [];
  }
  let n = 0; for (const q of alvos) if (mudaCamadasPad(q, v)) n++;
  if (!n) { HubDialog.toast(todos ? 'todos os pads já são assim' : 'o pad já é assim', 'info', 1800); if (painel) painel.atualiza(); return; }
  const usam = model.comps.filter((c, j) => EB.components[j] && EB.components[j].footprint === nome);
  const quem = todos ? n + ' pad(s) do footprint "' + nome + '"' : 'O pad ' + (a.eb.name || '') + ' do footprint "' + nome + '"';
  const ok = await HubDialog.confirm(quem + ' vira ' + ROT_CAMADAS_PAD[v] + '.\n\nO footprint mudado fica na biblioteca do hub (vale nas outras placas que o usam) e ' +
    usam.length + ' componente(s) desta placa se atualizam (saem e voltam no mesmo lugar, com as mesmas nets; Ctrl+Z desfaz na placa).', { title:'Camadas do pad', ok:'Mudar' });
  if (!ok) { if (painel) painel.atualiza(); return; }
  if (!garanteEdicao()) return;
  fp.hub = Object.assign({}, fp.hub || {}, { editado:new Date().toISOString(), base:(fonte.hub && fonte.hub.base) || nome });
  HubFpLib.poe(HUBLIB, fp);
  try { await HubFpLib.grava(HUBLIB); } catch (e) { HubDialog.toast('não gravei a biblioteca: ' + (e && e.message || e), 'err', 5000); return; }
  registraLibHub();
  let ops = []; for (const c of usam) ops = ops.concat(opsTrocaFp(c, nome, 'camadas do pad mudadas no hub (' + ROT_CAMADAS_PAD[v] + ')'));
  for (const op of ops) CH.push(op);
  if (ops.length) commit();
  refaz3d();
  HubDialog.toast(quem + ': ' + ROT_CAMADAS_PAD[v] + ' · ' + usam.length + ' componente(s) atualizado(s)', 'ok', 3500);
}
function fichaPadSolto(a){
  const m = a.m, p = m.eff, t = tipoDoPad(p), furo = t !== 'smd';
  return { titulo:(t === 'npth' ? 'Hole ' : 'Pad ') + (p.name || '') , sub:['pad livre', ESTADO(m)].filter(Boolean).join(' · '), campos:[
    { k:'type', rot:'Type', tipo:'enum', v:t, opc:TIPO_PAD_OPC },
    t === 'smd' ? { k:'layer', rot:'Layer', tipo:'camada', v:p.layer, opc:opcFaces() } : { k:'layer', rot:'Layer', tipo:'ro', v:'Multi-Layer' },
    t === 'npth' ? { k:'net', rot:'Net', tipo:'ro', v:'— (furo sem cobre)' } : { k:'net', rot:'Net', tipo:'net', v:p.net || '', opc:opcNets(p.net) },
    { k:'name', rot:'Designator', tipo:'texto', v:p.name || '' },
    { sec:'Size and Shape' },
    { k:'shape', rot:'Shape', tipo:'enum', v:p.shape || 'circle', opc:PAD_FORMAS_OPC },
    par('Size (X/Y)', { k:'w', rot:'X', tipo:'dist', v:p.w }, { k:'h', rot:'Y', tipo:'dist', v:p.h }),
    p.shape === 'roundrect' ? { k:'radius', rot:'Corner Radius', tipo:'dist', v:isNum(p.radius) ? p.radius : 0 } : null,
    furo ? { sec:'Hole' } : null,
    furo ? { k:'drill', rot:'Hole Size', tipo:'dist', v:p.drill, dica:'diâmetro do furo' } : null,
    furo ? { k:'drillshape', rot:'Hole Shape', tipo:'enum', v:p.drillshape || 'circle', opc:FURO_OPC } : null,
    furo && p.drillshape && p.drillshape !== 'circle' ? { k:'drillw', rot:'Hole Length', tipo:'dist', v:p.drillw } : null,
    { sec:'Location' },
    par('(X/Y)', { k:'x', rot:'X', tipo:'dist', v:p.x }, { k:'y', rot:'Y', tipo:'dist', v:p.y }),
    { k:'rot', rot:'Rotation', tipo:'ang', v:p.rot || 0 },
  ].filter(Boolean) };
}
function campoDoPad(a, k, v){
  const m = a.m, p = m.eff, pos = x => isNum(x) && x > 0;
  if (k === 'type') {
    const novo = String(v), atual = tipoDoPad(p);
    if (novo === atual || !['smd', 'th', 'npth'].includes(novo)) return false;
    const op = { op:'pad_add', type:novo, x:r6(p.x), y:r6(p.y), w:r6(p.w), h:r6(p.h), shape:p.shape || 'circle', rot:normAng(p.rot || 0), note:'pad ' + novo + ' (tipo trocado no hub)' };
    if (p.name) op.name = p.name;
    if (novo === 'smd') op.layer = p.layer === 'Bottom' ? 'Bottom' : 'Top';
    else op.drill = r6(pos(p.drill) ? p.drill : Math.min(p.w, p.h) / 2);
    if (novo !== 'npth' && p.net) op.net = p.net;
    if (!apagaItem(m)) return false;
    CH.push(op); selDepois = [op];
    return true;
  }
  if (k === 'layer') { if (tipoDoPad(p) !== 'smd' || (v !== 'Top' && v !== 'Bottom') || v === p.layer) return false; return editaItem(m, { layer:v }); }
  if (k === 'net') return editaItem(m, { net:String(v || '') });
  if (k === 'name') return editaItem(m, { name:String(v || '').replace(/":/g, '" :') });
  if (k === 'shape') return PAD_FORMAS_OPC.some(o => o.v === v) ? editaItem(m, { shape:v }) : false;
  if (k === 'drillshape') {
    if (!FURO_OPC.some(o => o.v === v)) return false;
    const patch = { drillshape:v };
    if (v !== 'circle' && !pos(p.drillw)) patch.drillw = r6(Math.max(p.drill * 2, p.drill + 0.5));
    return editaItem(m, patch);
  }
  if (!isNum(v)) return false;
  if ((k === 'w' || k === 'h' || k === 'drill' || k === 'drillw') && !pos(v)) { HubDialog.toast('o valor tem de ser maior que zero', 'warn'); return false; }
  if (k === 'radius' && v < 0) return false;
  if (k === 'drill' && tipoDoPad(p) === 'th' && v >= Math.min(p.w, p.h)) HubDialog.toast('furo >= cobre do pad: o pad fica sem anel', 'warn');
  return editaItem(m, { [k]:(k === 'rot' || k === 'holerot') ? normAng(v) : r6(v) });
}
/* ---- marcacao redonda -> furo de fixacao ----
   Um circulo desenhado (arco de 360 graus em qualquer camada: serigrafia, mecanica, cobre) ou uma
   regiao redonda (o circulo preenchido) ganha o furo de fixacao do hub EM CIMA: um Board Cutout
   redondo do mesmo diametro (region_add cutout, como a ferramenta Furo). A marcacao fica (pedido do
   dono: "gerar fixacao em cima da marcacao"); o "Virar furo" do painel e o que tira o desenho. O
   diametro e o do circulo como esta desenhado (o centro da linha); o painel do furo ajusta depois.
   Marcacao que ja tem furo no mesmo centro nao ganha outro. */
function circuloDePts(pts){
  if (!Array.isArray(pts) || pts.length < 12) return null;
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; }
  cx /= pts.length; cy /= pts.length;
  const ds = pts.map(p => Math.hypot(p[0] - cx, p[1] - cy)), r = ds.reduce((s, d) => s + d, 0) / ds.length;
  if (!(r > 0) || ds.some(d => Math.abs(d - r) > Math.max(0.002, r * 0.02))) return null;
  return { cx, cy, r };
}
function circuloDoAlvo(a){
  if (!a || !a.m || a.m.deleted) return null;
  if (a.t === 'arc' && arcoCheio(a.m.eff) && !(a.m.src && a.m.src.owner)) return { cx:a.m.eff.cx, cy:a.m.eff.cy, r:a.m.eff.r };
  if (a.t === 'region') return circuloDePts(a.m.eff.points);
  return null;
}
/* os centros dos furos que a placa ja tem (do Altium e do hub) */
function centrosDeFuros(){
  const L = [];
  for (const k of recortesDaTela()) { const c = circuloDePts(k.pts); if (c) L.push(c); else { const bb = bbPts(k.pts); L.push({ cx:(bb[0] + bb[2]) / 2, cy:(bb[1] + bb[3]) / 2, r:Math.max(bb[2] - bb[0], bb[3] - bb[1]) / 2 }); } }
  return L;
}
const temFuroEm = (c, furos) => furos.some(f => Math.hypot(f.cx - c.cx, f.cy - c.cy) < Math.max(0.05, Math.min(f.r, c.r) * 0.25));
/* as marcacoes que podem ganhar furo: as selecionadas; sem selecao, todo circulo solto que nao e de
   cobre (serigrafia, mecanica, keep-out...) e ainda nao tem furo no centro */
function marcacoesSemFuro(alvos){
  const furos = centrosDeFuros();
  const lista = alvos || [...PORCHAVE.values()].filter(a => a.t === 'arc' && !(a.m.eff && cobre(a.m.eff.layer)));
  return lista.filter(a => { const c = circuloDoAlvo(a); return c && !temFuroEm(c, furos); });
}
function fixacaoNasMarcacoes(){
  const sel = SEL.filter(circuloDoAlvo);
  const alvos = marcacoesSemFuro(sel.length ? sel : null);
  if (!alvos.length) { HubDialog.toast(sel.length ? 'as marcações selecionadas já têm furo' : 'nenhuma marcação redonda sem furo (círculo de serigrafia ou mecânica)', 'info'); return; }
  furosDosCirculos(alvos, true);
}
function furosDosCirculos(alvos, manter){
  if (!garanteEdicao()) return;
  const novos = [];
  for (const a of alvos) {
    const c = circuloDoAlvo(a);
    if (!c || (!manter && !apagaItem(a.m))) continue;
    const op = { op:'region_add', cutout:true, pts:circuloPts(c.cx, c.cy, c.r, 36), note:'furo de fixação ' + fmtNum(2 * c.r, 2) + ' mm (' + (manter ? 'em cima da marcação' : 'de um círculo') + ')' };
    CH.push(op); novos.push(op);
  }
  if (!novos.length) return;
  selDepois = novos;
  if (tool !== 'select') setTool('select');
  commit();
  HubDialog.toast((novos.length === 1 ? '1 furo de fixação gerado' : novos.length + ' furos de fixação gerados') + (manter ? ' em cima da marcação' : ' (a marcação saiu)') + ' — o diâmetro se ajusta no painel', 'ok');
}
function fichaDe(a){
  switch (a.t) {
    case 'comp': {
      /* o Properties do Altium para Component: Location, Properties, Footprint e Primitives */
      const m = a.m, e = m.eff, s = m.src, bb = s.bbox;
      const est = [m.changed ? 'movido' : '', m.attrChanged ? 'atributos mudados' : ''].filter(Boolean).join(' · ');
      return { titulo:'Component', sub:(e.designator || s.ref) + (est ? ' · ' + est : ''), campos:[
        { sec:'Location' },
        par('(X/Y)', { k:'x', rot:'X', tipo:'dist', v:e.x }, { k:'y', rot:'Y', tipo:'dist', v:e.y }),
        { k:'rot', rot:'Rotation', tipo:'ang', v:e.rot },
        { sec:'Properties' },
        { k:'layer', rot:'Layer', tipo:'enum', v:e.layer, opc:opcFaces(), dica:'trocar de face espelha o componente como olhar a placa por baixo (a rotação vira 180 − r), igual ao L no arrasto' },
        { k:'designator', rot:'Designator', tipo:'texto', v:e.designator || s.ref, dica:'renomear na PCB dessincroniza do esquema — o ECO vai acusar' },
        { k:'comment', rot:'Comment', tipo:'texto', v:e.comment !== undefined ? e.comment : (s.comment || '') },
        { k:'tipo', rot:'Type', tipo:'ro', v:'Standard' },
        { sec:'Footprint' },
        { k:'footprint', rot:'Footprint Name', tipo:'ro', v:s.footprint || '—' },
        { k:'dim', rot:'Dimensions', tipo:'ro', v:bb && isNum(bb.x1) ? fmtDist(bb.x2 - bb.x1) + ' × ' + fmtDist(bb.y2 - bb.y1) + ' ' + unidade : '—' },
        { k:'corpo3d', rot:'3D Body', tipo:'ro', v:corpos3dDe(s.footprint) },
        { botoes:[{ id:'girar', rot:'Rotate 90°' }, { id:'virar', rot:'Flip Component' }, { id:'enquadrar', rot:'Zoom' }] },
        { botoes:[{ id:'editarFp', rot:'Edit Footprint…' }, { id:'vista3d', rot:'View 3D' }] },
        { sec:'Primitives — Pads (' + (s.pads || []).length + ')' },
        { tab:{ cab:['Pad', 'Net'], linhas:(s.pads || []).map(p => [p.name, p.net || '—']) } },
      ] };
    }
    case 'pad': {
      if (a.comp) return fichaPadDoComp(a);
      if (a.m && !a.m.deleted) return fichaPadSolto(a);
      const p = a.eb, f = formaLado(p, ladoDaVista());
      return { titulo:'Pad ' + (p.name || ''), sub:'pad livre', campos:[
        { k:'layer', rot:'Layer', tipo:'ro', v:ehTH(p) ? 'Multi-Layer (passante)' : nomeDe(p.layer) },
        { k:'net', rot:'Net', tipo:'ro', v:p.net || '—' },
        { k:'shape', rot:'Shape', tipo:'ro', v:String(f.shape || 'rect') },
        par('Size (X/Y)', { k:'w', rot:'X', tipo:'ro', v:fmtDist(f.w) + ' ' + unidade }, { k:'h', rot:'Y', tipo:'ro', v:fmtDist(f.h) + ' ' + unidade }),
        { k:'drill', rot:'Hole Size', tipo:'ro', v:p.drill > 0 ? fmtDist(p.drill) + ' ' + unidade + (p.drillw > 0 ? ' × ' + fmtDist(p.drillw) : '') + (p.plated === false ? ' · NPTH' : '') : '—' },
        par('Location (X/Y)', { k:'x', rot:'X', tipo:'ro', v:fmtDist(p.x) }, { k:'y', rot:'Y', tipo:'ro', v:fmtDist(p.y) }),
        { k:'rot', rot:'Rotation', tipo:'ro', v:fmtNum(p.rot || 0, 3) + '°' },
        { k:'sm', rot:'Solder Mask', tipo:'ro', v:(tampado(p, 'top') && tampado(p, 'bottom')) ? 'tampado' : '+' + fmtDist(expMascara(p)) + ' ' + unidade + (isNum(p.sm) ? '' : ' (regra)') },
      ] };
    }
    case 'track': {
      const m = a.m, e = m.eff, cu = cobre(e.layer);
      return { titulo:(cu ? 'Track ' : 'Line ') + (m.added ? '(nova)' : m.src.id), sub:[nomeDe(e.layer), ESTADO(m)].filter(Boolean).join(' · '), campos:[
        { k:'layer', rot:'Layer', tipo:'camada', v:e.layer, opc:opcCamadas(), dica:'qualquer camada menos a Multi-Layer; fora do cobre a net cai' },
        cu ? { k:'net', rot:'Net', tipo:'net', v:e.net || '', opc:opcNets(e.net) } : { k:'net', rot:'Net', tipo:'ro', v:'— (só em cobre)' },
        { k:'w', rot:'Width', tipo:'dist', v:e.w },
        par('Start (X/Y)', { k:'x1', rot:'X', tipo:'dist', v:e.x1 }, { k:'y1', rot:'Y', tipo:'dist', v:e.y1 }),
        par('End (X/Y)', { k:'x2', rot:'X', tipo:'dist', v:e.x2 }, { k:'y2', rot:'Y', tipo:'dist', v:e.y2 }),
        { k:'len', rot:'Length', tipo:'ro', v:fmtDist(Math.hypot(e.x2 - e.x1, e.y2 - e.y1)) + ' ' + unidade },
      ] };
    }
    case 'arc': {
      const m = a.m, e = m.eff, cu = cobre(e.layer), cheio = arcoCheio(e);
      return { titulo:(cheio ? 'Circle ' : 'Arc ') + (m.added ? '(novo)' : m.src.id), sub:[nomeDe(e.layer), ESTADO(m)].filter(Boolean).join(' · '), campos:[
        { k:'layer', rot:'Layer', tipo:'camada', v:e.layer, opc:opcCamadas() },
        !cu ? { k:'net', rot:'Net', tipo:'ro', v:'— (só em cobre)' }
          : m.added ? { k:'net', rot:'Net', tipo:'net', v:e.net || '', opc:opcNets(e.net) }
          : { k:'net', rot:'Net', tipo:'ro', v:(e.net || '—'), dica:'o arc_edit do Altium não troca a net de um arco que já existe (a do arco fica)' },
        par('Center (X/Y)', { k:'cx', rot:'X', tipo:'dist', v:e.cx }, { k:'cy', rot:'Y', tipo:'dist', v:e.cy }),
        { k:'r', rot:'Radius', tipo:'dist', v:e.r },
        cheio ? { k:'diam', rot:'Diameter', tipo:'dist', v:2 * e.r } : par('Angles', { k:'sa', rot:'Start', tipo:'ang', v:e.sa }, { k:'ea', rot:'End', tipo:'ang', v:e.ea }),
        { k:'w', rot:'Width', tipo:'dist', v:e.w },
        cheio ? { botoes:[{ id:'fixacaoMarcacoes', rot:'Gerar fixação em cima' }, { id:'furoDoCirculo', rot:'Virar furo (tira o desenho)' }] } : null,
      ].filter(Boolean) };
    }
    case 'via': {
      const m = a.m, e = m.eff;
      return { titulo:'Via ' + (m.added ? '(nova)' : m.src.id), sub:ESTADO(m), campos:[
        par('Location (X/Y)', { k:'x', rot:'X', tipo:'dist', v:e.x }, { k:'y', rot:'Y', tipo:'dist', v:e.y }),
        { k:'size', rot:'Diameter', tipo:'dist', v:e.size },
        { k:'drill', rot:'Hole Size', tipo:'dist', v:e.drill },
        { k:'net', rot:'Net', tipo:'ro', v:e.net || '—', dica:'via_edit ainda não troca a net' },
        /* o vao da via (pedido do dono, 2026-10-29: "configurar camada da via"): de onde ate onde ela vai */
        { sec:'Camadas (vão da via)' },
        { k:'from', rot:'De', tipo:'camada', v:e.from || 'Top', opc:opcCobreVia() },
        { k:'to', rot:'Até', tipo:'camada', v:e.to || 'Bottom', opc:opcCobreVia() },
        { nota:vaoTexto(e) },
      ] };
    }
    case 'fill': {
      const m = a.m, e = m.eff, cu = cobre(e.layer);
      return { titulo:'Fill ' + (m.added ? '(novo)' : m.src.id), sub:[nomeDe(e.layer), ESTADO(m)].filter(Boolean).join(' · '), campos:[
        { k:'layer', rot:'Layer', tipo:'camada', v:e.layer, opc:opcCamadas() },
        cu ? { k:'net', rot:'Net', tipo:'net', v:e.net || '', opc:opcNets(e.net) } : { k:'net', rot:'Net', tipo:'ro', v:'— (só em cobre)' },
        par('Corner 1', { k:'x1', rot:'X', tipo:'dist', v:e.x1 }, { k:'y1', rot:'Y', tipo:'dist', v:e.y1 }),
        par('Corner 2', { k:'x2', rot:'X', tipo:'dist', v:e.x2 }, { k:'y2', rot:'Y', tipo:'dist', v:e.y2 }),
        { k:'rot', rot:'Rotation', tipo:'ang', v:e.rot || 0 },
      ] };
    }
    case 'region': {
      const m = a.m, e = m.eff, cu = cobre(e.layer);
      const ar = Math.abs(area2(e.points || [])) / 2;
      return { titulo:'Region ' + (m.added ? '(nova)' : m.src.id), sub:[nomeDe(e.layer), m.orfa ? 'despejo do Altium sem polígono (só apagar)' : '', ESTADO(m)].filter(Boolean).join(' · '), campos:[
        { k:'layer', rot:'Layer', tipo:'camada', v:e.layer, opc:opcCamadas(), dica:m.added ? '' : 'trocar a camada de uma região do espelho é apagar e recriar (region_del + region_add)' },
        cu ? { k:'net', rot:'Net', tipo:'net', v:e.net || '', opc:opcNets(e.net) } : { k:'net', rot:'Net', tipo:'ro', v:'— (só em cobre)' },
        ...camposCaixa(e.points),
        { k:'n', rot:'Vertices', tipo:'ro', v:String((e.points || []).length) },
        { k:'area', rot:'Area', tipo:'ro', v:fmtNum(ar, 3) + ' mm²' },
      ] };
    }
    case 'regiao-ro': {
      const g = a.eb;
      return { titulo:'Region ' + (g.id || ''), sub:nomeDe(g.layer) + (g.poly ? ' · polígono' : '') + (g.keepout ? ' · keepout' : ''), aviso:a.motivo, campos:[
        { k:'layer', rot:'Layer', tipo:'ro', v:nomeDe(g.layer) },
        { k:'net', rot:'Net', tipo:'ro', v:g.net || '—' },
        { k:'n', rot:'Vertices', tipo:'ro', v:String((g.points || []).length) + (Array.isArray(g.holes) && g.holes.length ? ' · ' + g.holes.length + ' furo(s)' : '') },
      ] };
    }
    case 'poly': {
      const m = a.m, e = m.eff;
      return { titulo:'Plano (Polygon Pour) ' + (m.added ? '(novo)' : m.src.id), sub:[nomeDe(e.layer), e.net || 'sem net', ESTADO(m)].filter(Boolean).join(' · '), campos:[
        { k:'tipo', rot:'Tipo', tipo:'enum', v:'plano:' + e.layer, opc:opcTipoPlano(), dica:'Sem plano = o plano não entra nesta área; trilha e via passam (o Polygon Pour Cutout do Altium)' },
        { k:'net', rot:'Net', tipo:'net', v:e.net || '', opc:opcNets(e.net) },
        ...camposCaixa(e.pts),
        { k:'n', rot:'Vértices', tipo:'ro', v:String((e.pts || []).length) },
        { nota:'Arraste as bordas ou os cantos para mudar o tamanho (Shift no canto mantém a proporção, Ctrl solta a grade) e um vértice para mudar a forma. Delete apaga.' },
      ] };
    }
    case 'semplano': {
      const lay = a.m ? a.m.eff.layer : (a.eb.layer || 'Multi'), pts = a.m ? a.m.eff.points : a.eb.points;
      const onde = !lay || lay === 'Multi' ? 'todas as camadas' : nomeDe(lay);
      if (!a.m) return { titulo:'Sem plano (recorte de polígono)', sub:onde + ' · do Altium — mude no Altium', campos:[
        { k:'tam', rot:'Tamanho', tipo:'ro', v:(() => { const b = bbPts(pts); return b ? fmtDist(b[2] - b[0]) + ' × ' + fmtDist(b[3] - b[1]) + ' ' + unidade : '—'; })() },
      ] };
      return { titulo:'Sem plano', sub:onde + ' · ' + ESTADO(a.m), campos:[
        { k:'tipo', rot:'Tipo', tipo:'enum', v:'sem:' + lay, opc:opcTipoPlano() },
        ...camposCaixa(pts),
        { nota:'O plano (polygon pour) não entra nesta área; trilha e via passam — o Polygon Pour Cutout do Altium. Arraste as bordas ou os cantos para ajustar.' },
      ] };
    }
    case 'recorte': {
      const k = recortesDaTela().find(x => x.o === a.eb), bb = k ? bbPts(k.pts) : null;
      const circ = a.m ? circuloDePts((a.m.eff.points || []).map(p => [p[0], p[1]])) : null;
      if (circ) return { titulo:'Furo de fixação', sub:'Board Cutout redondo do hub — Delete tira', campos:[
        { k:'diam', rot:'Diameter', tipo:'dist', v:2 * circ.r, dica:'o furo da fábrica (Gerber, laser, 3D)' },
        par('Center (X/Y)', { k:'cx', rot:'X', tipo:'dist', v:circ.cx }, { k:'cy', rot:'Y', tipo:'dist', v:circ.cy }),
      ] };
      return { titulo:'Board Cutout', sub:a.m ? 'recorte do hub (region_add cutout) — Delete tira' : 'Board Cutout do Altium (mude no Altium)', campos:[
        { k:'tam', rot:'Size', tipo:'ro', v:bb ? fmtDist(bb[2] - bb[0]) + ' × ' + fmtDist(bb[3] - bb[1]) + ' ' + unidade : '—' },
        { k:'c', rot:'Center', tipo:'ro', v:bb ? fmtDist((bb[0] + bb[2]) / 2) + ' ; ' + fmtDist((bb[1] + bb[3]) / 2) : '—' },
      ] };
    }
    case 'text': {
      const m = a.m, s = m.src || {}, e = ebDe(m) || m.eff;
      if (s.designator) return { titulo:'Designator — ' + s.owner, sub:ESTADO(m), campos:[
        par('Location (X/Y)', { k:'x', rot:'X', tipo:'dist', v:e.x }, { k:'y', rot:'Y', tipo:'dist', v:e.y }),
        { k:'h', rot:'Text Height', tipo:'dist', v:e.h },
        { k:'rot', rot:'Rotation', tipo:'ang', v:e.rot || 0 },
        { nota:'O designator_move vai antes do comp_move do componente no changes.js (o ApplyChanges aplica em ordem).' },
      ] };
      if (s.comment) return { titulo:'Comment — ' + s.owner, sub:'', campos:[
        { k:'comment', rot:'Comment', tipo:'texto', v:e.text || '' },
        par('Location (X/Y)', { k:'x', rot:'X', tipo:'ro', v:fmtDist(e.x) }, { k:'y', rot:'Y', tipo:'ro', v:fmtDist(e.y) }),
        { nota:'A posição do comment ainda não tem op (comment_move): mova pelo Altium.' },
      ] };
      return { titulo:'Text ' + (m.added ? '(novo)' : s.id), sub:[nomeDe(e.layer), ESTADO(m), e.kind === 'truetype' ? 'TrueType' : ''].filter(Boolean).join(' · '), campos:[
        { k:'layer', rot:'Layer', tipo:'camada', v:e.layer, opc:opcCamadas(), dica:'na face de baixo o texto fica espelhado, como no Altium' },
        { k:'text', rot:'Text', tipo:'texto', v:e.text || '' },
        par('Location (X/Y)', { k:'x', rot:'X', tipo:'dist', v:e.x }, { k:'y', rot:'Y', tipo:'dist', v:e.y }),
        par('Size', { k:'h', rot:'Height', tipo:'dist', v:e.h }, { k:'w', rot:'Stroke', tipo:'dist', v:e.w > 0 ? e.w : (e.h || 0) * TRACO_TEXTO }),
        { k:'rot', rot:'Rotation', tipo:'ang', v:e.rot || 0 },
        { k:'mirror', rot:'Mirror', tipo:'bool', v:!!e.mirror },
      ] };
    }
    case 'ann': {
      const n = a.ann;
      return { titulo:'Sinalizador ' + n.id, sub:(n.created || '') + (n.status === 'resolved' ? ' · resolvido' : ''), semTrava:true, campos:[
        { k:'msg', rot:'Mensagem', tipo:'texto', v:n.msg || '' },
        { k:'severity', rot:'Cor', tipo:'enum', v:n.severity, opc:[{ v:'err', rot:'vermelho (erro)', cor:ANN_COLORS.err }, { v:'warn', rot:'amarelo (atenção)', cor:ANN_COLORS.warn }, { v:'info', rot:'azul (nota)', cor:ANN_COLORS.info }] },
        { k:'status', rot:'Situação', tipo:'enum', v:n.status || 'open', opc:[{ v:'open', rot:'aberto' }, { v:'resolved', rot:'resolvido' }] },
        { k:'reply', rot:'Resposta', tipo:'ro', v:n.reply || '—' },
        { botoes:[{ id:'apagar', rot:'Apagar sinalizador', dica:'tira a bandeira da placa (Delete também); grave com Salvar' }, { id:'enquadrar', rot:'Enquadrar' }] },
      ] };
    }
    case 'cota': {
      const c = a.cota, g = geoCota(c);
      if (!g) return { titulo:'Cota', campos:[{ nota:'Cota sem geometria (os dois pontos coincidem).' }, { botoes:[{ id:'apagar', rot:'Apagar cota' }] }] };
      const cond = (p, k, rot) => p.circ ? { k, rot, tipo:'enum', v:p.cond || 'perto', opc:[
        { v:'perto', rot:'tangente de perto' }, { v:'longe', rot:'tangente de longe' }, { v:'centro', rot:'centro do círculo' }] } : null;
      const nome = p => p.circ ? 'círculo Ø' + fmtDist(2 * p.circ.r) : (HCOT.ROTULO[p.tipo] || p.tipo || 'ponto');
      return { titulo:'Cota ' + textoCota(g), semTrava:true, sub:(HCOT.MODOS[g.modo] || g.modo) + ' · ' + nome(c.a) + ' → ' + nome(c.b), campos:[
        { k:'v', rot:'Valor', tipo:'ro', v:fmtDist(g.valor) + ' ' + unidade },
        { k:'d', rot:'Distância', tipo:'ro', v:fmtDist(g.dist) + ' ' + unidade },
        par('Δ', { k:'dx', rot:'dX', tipo:'ro', v:fmtDist(g.dx) }, { k:'dy', rot:'dY', tipo:'ro', v:fmtDist(g.dy) }),
        { k:'modo', rot:'Tipo', tipo:'enum', v:c.modo || 'auto', opc:Object.keys(HCOT.MODOS).map(v => ({ v, rot:HCOT.MODOS[v] })),
          dica:'automática: acima ou abaixo dos pontos dá a horizontal, ao lado dá a vertical, no meio dá a alinhada' },
        cond(c.a, 'condA', 'Ponta 1'), cond(c.b, 'condB', 'Ponta 2'),
        { nota:'Arraste a cota para mudar onde passa a linha. Ela não vai para o Altium: fica nesta máquina, com o projeto. O botão da régua com olho, na barra, esconde e mostra todas.' },
        { botoes:[{ id:'apagar', rot:'Apagar cota' }, { id:'apagarCotas', rot:'Apagar todas (' + COTAS.length + ')' }, { id:'enquadrar', rot:'Enquadrar' }] },
      ].filter(Boolean) };
    }
  }
  return { titulo:'?', campos:[] };
}
/* tamanho e canto da caixa de um contorno: editar escala os vertices a partir do canto de baixo */
function camposCaixa(pts){
  const b = bbPts(pts || []);
  if (!b) return [];
  return [par('Tamanho (L/A)', { k:'bw', rot:'L', tipo:'dist', v:b[2] - b[0] }, { k:'bh', rot:'A', tipo:'dist', v:b[3] - b[1] }),
          par('Canto (X/Y)', { k:'bx', rot:'X', tipo:'dist', v:b[0] }, { k:'by', rot:'Y', tipo:'dist', v:b[1] })];
}
function caixaNoAlvo(a, k, v){
  if (!isNum(v)) return false;
  const g = geoDe(a); if (!g || !g.points) return false;
  const bb = bbPts(g.points);
  if (!bb || bb[2] - bb[0] < 1e-9 || bb[3] - bb[1] < 1e-9) return false;
  const nb = bb.slice();
  if ((k === 'bw' || k === 'bh') && !(v > 0)) { HubDialog.toast('o tamanho tem de ser maior que zero', 'warn'); return false; }
  if (k === 'bw') nb[2] = bb[0] + v;
  else if (k === 'bh') nb[3] = bb[1] + v;
  else if (k === 'bx') { nb[0] = v; nb[2] = v + bb[2] - bb[0]; }
  else if (k === 'by') { nb[1] = v; nb[3] = v + bb[3] - bb[1]; }
  else return false;
  return escreveGeo(a, escalaGeo(a.t, g, bb, nb));
}
const CAMADA_LIVRE = a => a.t === 'track' || a.t === 'arc' || a.t === 'fill' || a.t === 'region' ||
  (a.t === 'text' && a.m && (!a.m.src || (!a.m.src.owner && !a.m.src.designator && !a.m.src.comment)));
function fichaMulti(lista){
  const n = {};
  for (const a of lista) n[a.t] = (n[a.t] || 0) + 1;
  const nomes = { comp:'componente', track:'trilha/linha', arc:'arco', via:'via', fill:'fill', region:'região', text:'texto', pad:'pad', 'regiao-ro':'região (só desenho)', recorte:'recorte', ann:'sinalizador', cota:'cota' };
  const campos = [];
  const comCamada = lista.filter(a => a.t === 'comp' || CAMADA_LIVRE(a));
  if (comCamada.length === lista.length) {
    const soFaces = lista.some(a => a.t === 'comp');
    const vals = new Set(lista.map(a => a.t === 'comp' ? a.m.eff.layer : a.m.eff.layer));
    campos.push({ k:'layer', rot:'Camada', tipo:'camada', v:vals.size === 1 ? Array.from(vals)[0] : '', misto:vals.size > 1, opc:soFaces ? opcFaces() : opcCamadas(),
                  dica:soFaces ? 'com componente na seleção, só Top/Bottom (componente vira de face)' : '' });
  }
  if (lista.every(a => a.t === 'track' || a.t === 'arc')) {
    const ws = new Set(lista.map(a => r6(a.m.eff.w)));
    campos.push({ k:'w', rot:'Largura', tipo:'dist', v:ws.size === 1 ? Array.from(ws)[0] : null, misto:ws.size > 1 });
  }
  if (lista.every(a => (a.t === 'track' || a.t === 'arc' || a.t === 'fill') && cobre(a.m.eff.layer))) {
    const ns = new Set(lista.map(a => a.m.eff.net || ''));
    campos.push({ k:'net', rot:'Net', tipo:'net', v:ns.size === 1 ? Array.from(ns)[0] : '', misto:ns.size > 1, opc:opcNets() });
  }
  campos.push({ botoes:[{ id:'girar', rot:'Girar 90°' }, { id:'apagar', rot:'Apagar' }, { id:'enquadrar', rot:'Enquadrar' }] });
  if (lista.some(circuloDoAlvo)) campos.push({ botoes:[{ id:'fixacaoMarcacoes', rot:'Gerar fixação nas marcações' }] });
  return { titulo:lista.length + ' objetos selecionados', sub:Object.keys(n).map(k => n[k] + ' ' + (nomes[k] || k)).join(' · '), campos };
}
function fichaFerramenta(){
  const F = { titulo:FERRAMENTA_ROT[tool] || tool, sub:'camada atual: ' + nomeDe(cur), campos:[], ferramenta:tool };
  const camada = f => ({ k:'tool.camada', rot:'Camada', tipo:'camada', v:cur, opc:opcCamadas(f) });
  const larg = { k:'tool.wLinha', rot:'Largura', tipo:'dist', v:CFG.wLinha };
  const cheio = { k:'tool.preencher', rot:'Preencher', tipo:'bool', v:preencher, dica:'ligado: região cheia (retângulo: fill); desligado: contorno de trilhas' };
  switch (tool) {
    case 'trilha': {
      const regra = isNum(RULES.clearance) && RULES.clearance > 0;
      F.campos.push(camada(l => l.kind === 'signal' || l.kind === 'plane'),
        { k:'tool.wTrilha', rot:'Largura', tipo:'dist', v:CFG.wTrilha, dica:PREFS.larguraModo === 'regra' && !EDITADO.w ? 'cada rota sai com a preferida da regra Width que vence para a net dela (Rule Preferred, como o Altium); o valor digitado aqui passa a valer, preso à faixa da regra' : 'a largura digitada, presa à faixa da regra Width da net' },
        { k:'tool.modo', rot:'Canto', tipo:'enum', v:CFG.modo, opc:[{ v:'45', rot:'45°' }, { v:'90', rot:'90°' }, { v:'livre', rot:'ângulo livre' }] },
        { k:'tool.conflito', rot:'Conflito', tipo:'enum', v:CFG.conflito, opc:CONFLITOS.map(v => ({ v, rot:CONFLITO_ROT[v] })),
          dica:'Shift+R troca · ' + CONFLITO_FRASE[CFG.conflito] + ' · folga geral ' + fmtDist(folgaDaCena()) + ' ' + unidade + (regrasAtuais() ? ' — as regras Clearance do projeto valem por par (escopo e matriz), as mesmas do DRC' : (regra ? ' (regra Clearance do espelho)' : ' (o espelho não trouxe a regra Clearance: 10 mil)')) },
        { k:'net', rot:'Net', tipo:'ro', v:(draft && draft.net) || '— (vem do pad, via ou trilha em que começar)' },
        par('Via', { k:'tool.viaSize', rot:'Diâmetro', tipo:'dist', v:CFG.viaSize }, { k:'tool.viaDrill', rot:'Furo', tipo:'dist', v:CFG.viaDrill }),
        { nota:'Clique fixa o canto · Espaço inverte · Shift+Espaço 45°/90°/livre · Shift+R contornar/parar/ignorar · Backspace desfaz o trecho · 2 via · * ou Ctrl+2 via e troca de camada · botão direito termina · Esc larga.' },
        { nota:'Trilhas de nets diferentes não se encontram (a folga da regra Clearance do par, a mesma do DRC): contornar dá a volta no obstáculo sem mexer no que já está na placa; parar no obstáculo para antes dele; ignorar não confere nada. A mesma regra recusa arrastar ou editar trilha, arco e via para cima de outra net.' });
      if (!HR) F.aviso = 'O roteador (hub-roteador.js) não carregou: a trilha não confere conflito — atualize a página (F5).';
      else if (motorQuebrado) F.aviso = 'O roteador falhou nesta sessão: nada é conferido até recarregar a página (F5).';
      break;
    }
    case 'via':
      F.campos.push(par('Via', { k:'tool.viaSize', rot:'Diâmetro', tipo:'dist', v:CFG.viaSize }, { k:'tool.viaDrill', rot:'Furo', tipo:'dist', v:CFG.viaDrill }),
        { k:'tool.viaNet', rot:'Net', tipo:'net', v:CFG.viaNet, opc:opcNets(CFG.viaNet), dica:'vazio: a via pega a net do pad/trilha em que cair; com uma net aqui, a via é dela — e não entra em cima de cobre de outra net' },
        { k:'tool.viaDe', rot:'De', tipo:'camada', v:viaDe(), opc:opcCobreVia(), dica:'a camada de cobre onde a via começa' },
        { k:'tool.viaAte', rot:'Até', tipo:'camada', v:viaAte(), opc:opcCobreVia(), dica:'a camada de cobre onde ela acaba (Top → Bottom = passante)' },
        { nota:vaoTexto({ from:viaDe(), to:viaAte() }) },
        { nota:regrasAtuais() ? 'Padrão: a preferida da regra Routing Via Style que vence para a net; o valor digitado fica preso à faixa dela.' : (isNum(RULES.viaSize) ? 'Padrão pela regra RoutingVias do espelho.' : 'O espelho não trouxe a regra de via: 0,6/0,3 mm.') },
        { nota:CFG.conflito === 'ignorar' ? 'Conflito em ignorar (ficha da Trilha, Shift+R): a via não é conferida.'
              : 'A via não entra encostada em cobre de outra net (a folga da regra Clearance do par): o anel vermelho avisa antes do clique.' });
      break;
    case 'linha': case 'arco': F.campos.push(camada(), larg); break;
    case 'circulo': case 'retangulo': case 'triangulo': case 'poligono': F.campos.push(camada(), larg, cheio); break;
    case 'texto':
      F.campos.push(camada(), par('Tamanho', { k:'tool.hTexto', rot:'Altura', tipo:'dist', v:CFG.hTexto }, { k:'tool.wTexto', rot:'Traço', tipo:'dist', v:CFG.wTexto }),
        { nota:'Fonte de traço (stroke). Na face de baixo (' + (ladoBaixo(cur) ? 'como agora' : 'Bottom, Bottom Overlay…') + ') o texto nasce espelhado.' });
      break;
    case 'furo':
      F.campos.push({ k:'tool.furo', rot:'Diâmetro', tipo:'dist', v:CFG.furo }, { nota:'Clique num lugar vazio: um furo novo deste diâmetro. Clique numa MARCAÇÃO redonda (círculo de serigrafia, mecânica, cobre): o furo de fixação sai em cima dela, com o diâmetro dela, e a marcação fica. Board Cutout redondo (region_add com cutout:true), o furo de fixação da casa.' }, { botoes:[{ id:'fixacaoMarcacoes', rot:'Gerar fixação em todas as marcações' }] });
      break;
    case 'contorno':
      F.campos.push({ nota:'Um clique por vértice; duplo clique, Enter ou botão direito fecha. Substitui o contorno inteiro (outline_set), só com retas — pergunta antes.' });
      break;
    case 'medir': {
      F.titulo = 'Régua (cotas)';
      const c = draft && draft.tipo === 'medida' && draft.b ? cotaDoDraft() : null, g = c && HCOT ? HCOT.geometria(c) : null;
      F.campos.push({ k:'d', rot:'Medida', tipo:'ro', v:g ? fmtDist(g.valor) + ' ' + unidade + ' · ' + HCOT.MODOS[g.modo] : '— (marque os dois pontos)' });
      if (g) F.campos.push(par('Δ', { k:'dx', rot:'dX', tipo:'ro', v:fmtDist(g.dx) }, { k:'dy', rot:'dY', tipo:'ro', v:fmtDist(g.dy) }));
      F.campos.push({ k:'tool.cotasVer', rot:'Mostrar as cotas', tipo:'bool', v:show.cotas, dica:'o mesmo botão da régua com olho, na barra' });
      F.campos.push(
        { nota:'1º clique: um ponto. 2º clique: o outro (ou aperte num, arraste e solte no outro). Depois mexa o mouse para levar a linha da cota e clique para deixá-la na placa.' },
        { nota:'Agarra em centro (pad, via, furo, círculo), ponta, meio, quadrante (borda do círculo), vértice, canto, borda do cobre e na tangente de um círculo ou arco — a tangente encosta do lado da outra ponta. Fora deles, a grade; Ctrl solta tudo.' },
        { nota:'A linha acima ou abaixo dos pontos dá a cota horizontal, ao lado dá a vertical, no meio dá a alinhada; Espaço troca. Esc larga a cota na mão (de novo, a régua). Clique numa cota (com a Seleção) para ver, arrastar ou apagar.' },
        { botoes:[{ id:'cotas', rot:show.cotas ? 'Esconder as cotas' : 'Mostrar as cotas' }, { id:'apagarCotas', rot:'Apagar todas (' + COTAS.length + ')', off:!COTAS.length }] });
      break;
    }
    case 'sinalizar': F.campos.push({ nota:'Clique no ponto do problema e escreva o que a IA deve corrigir (annotations.js).' },
      { nota:'Para tirar um sinalizador: clique na bandeira (com esta ferramenta ou com a Seleção) e aperte ' + (teclaDe('apagar') || 'Delete') + ', ou use Apagar no painel ou no botão direito. A aba Mudanças lista todos, com o × de apagar. Depois, Salvar.' }); break;
    case 'pour': {
      const tp = tipoPour();
      F.campos.push(
        { k:'tool.pourForma', rot:'Forma', tipo:'enum', v:CFG.pourForma, opc:[{ v:'retangulo', rot:'Retângulo — 2 cliques' }, { v:'livre', rot:'Polígono livre — um clique por vértice' }] },
        { k:'tool.pourTipo', rot:'Tipo', tipo:'enum', v:tp, opc:opcTipoPlano(), dica:'Sem plano = o plano não entra nesta área; trilha e via passam (o Polygon Pour Cutout do Altium)' });
      if (tp.indexOf('plano:') === 0) F.campos.push({ k:'tool.pourNet', rot:'Net', tipo:'net', v:netDoPour(), opc:opcNets(netDoPour()) });
      F.campos.push({ nota:(CFG.pourForma === 'livre' ? 'Um clique por vértice; duplo clique, Enter ou botão direito fecha.' : 'Clique num canto e depois no canto oposto.') +
        ' O que nasce fica selecionado: arraste as bordas ou os cantos para mudar o tamanho (Shift no canto mantém a proporção), um vértice para mudar a forma, e troque Top/Bottom/Sem plano no painel.' });
      break;
    }
  }
  return F;
}
function ficha(){
  if (tool !== 'select') return Object.assign({ tipo:'ferramenta' }, fichaFerramenta());
  if (!SEL.length) return { tipo:'placa' };
  if (SEL.length === 1) return Object.assign({ tipo:'objeto' }, fichaDe(SEL[0]));
  return Object.assign({ tipo:'multi' }, fichaMulti(SEL));
}

/* ============================== edicao pelo painel ============================== */

function configTool(k, v){
  const pos = x => isNum(x) && x > 0;
  switch (k) {
    case 'camada': setCur(v); if (draft && draft.tipo === 'rota') draft.layer = cur; break;
    case 'wTrilha': if (pos(v)) { CFG.wTrilha = r6(v); EDITADO.w = true; if (draft && draft.tipo === 'rota' && tool === 'trilha') draft.w = CFG.wTrilha; } break;
    case 'wLinha': if (pos(v)) { CFG.wLinha = r6(v); if (draft && draft.tipo === 'rota' && tool === 'linha') draft.w = CFG.wLinha; } break;
    case 'viaSize': if (pos(v)) { CFG.viaSize = r6(v); EDITADO.via = true; } if (CFG.viaDrill >= CFG.viaSize) HubDialog.toast('furo >= diâmetro: a via fica sem anel', 'warn'); break;
    case 'viaDrill': if (pos(v)) { CFG.viaDrill = r6(v); EDITADO.via = true; } if (CFG.viaDrill >= CFG.viaSize) HubDialog.toast('furo >= diâmetro: a via fica sem anel', 'warn'); break;
    case 'viaNet': CFG.viaNet = String(v || ''); break;
    case 'viaDe': case 'viaAte': {
      if (!LBYK[v] || LBYK[v].kind !== 'signal') break;
      const de = k === 'viaDe' ? v : viaDe(), ate = k === 'viaAte' ? v : viaAte();
      if (de === ate) { HubDialog.toast('a via liga duas camadas diferentes', 'warn'); break; }
      CFG.viaDe = de; CFG.viaAte = ate; break;
    }
    case 'modo':
      if (HubFio.MODOS.indexOf(v) >= 0) {
        CFG.modo = v;
        if (draft && draft.tipo === 'rota' && draft.est) draft.est = Object.assign({}, draft.est, { modo:v, primeiro:v === '45' ? lembraCanto.p45 : v === '90' ? lembraCanto.p90 : draft.est.primeiro });
      }
      break;
    case 'hTexto': if (pos(v)) CFG.hTexto = r6(v); break;
    case 'wTexto': if (pos(v)) CFG.wTexto = r6(v); break;
    case 'furo': if (pos(v)) CFG.furo = r6(v); break;
    case 'preencher': if (!!v !== preencher) togglePreencher(); break;
    case 'conflito': setConflito(String(v || '')); break;
    case 'pourForma': if (v === 'retangulo' || v === 'livre') { CFG.pourForma = v; gravaPref('pourForma', v); if (draft && (draft.tipo === 'pour' || draft.tipo === 'pourRet')) draft = null; pintaBarra(); } break;
    case 'pourTipo': CFG.pourTipo = String(v || ''); gravaPref('pourTipo', CFG.pourTipo); if (draft && (draft.tipo === 'pour' || draft.tipo === 'pourRet')) draft.layer = camadaDoTipo(); break;
    case 'pourNet': CFG.pourNet = String(v || ''); break;
    case 'cotasVer': setCotasVer(!!v); break;
  }
  pintaStatus(); if (painel) painel.atualiza(); pede();
}
function campoNoAlvo(a, k, v){
  const pos = x => isNum(x) && x > 0;
  /* o pad de componente mostra o componente em cima ("comp.x"...): a edicao vai para ele */
  if (a.t === 'pad' && a.comp && k === 'fp.camadas') { padNoFootprint(a, v, false); return false; }
  if (a.t === 'pad' && a.comp && String(k).indexOf('comp.') === 0) { const c = ALVO_COMP.get(a.comp); return c ? campoNoAlvo(c, String(k).slice(5), v) : false; }
  switch (a.t) {
    case 'pad': return a.m ? campoDoPad(a, k, v) : false;
    case 'recorte': {
      if (!a.m) return false;
      const op = opDe(a.m), c = circuloDePts((a.m.eff.points || []).map(p => [p[0], p[1]]));
      if (!op || !c || !isNum(v)) return false;
      if (k === 'diam') { if (!pos(v)) { HubDialog.toast('diâmetro tem de ser maior que zero', 'warn'); return false; } op.pts = circuloPts(c.cx, c.cy, v / 2, 36); op.note = 'furo de fixação ' + fmtNum(v, 2) + ' mm'; return true; }
      if (k === 'cx' || k === 'cy') { op.pts = circuloPts(k === 'cx' ? v : c.cx, k === 'cy' ? v : c.cy, c.r, 36); return true; }
      return false;
    }
    case 'poly': case 'semplano': {
      if (!a.m) return false;
      if (k === 'tipo') return mudaTipoPlano(a, v);
      if (k === 'net' && a.t === 'poly') return editaPoly(a.m, { net:String(v || '') });
      if (/^b[whxy]$/.test(k)) return caixaNoAlvo(a, k, v);
      return false;
    }
    case 'comp': {
      const g = geoDe(a);
      if (k === 'layer') { if ((v !== 'Top' && v !== 'Bottom') || v === g.layer) return false; moveComp(a.m, viraGeo(g, [g.x, g.y])); return true; }
      if (k === 'x' || k === 'y' || k === 'rot') { if (!isNum(v)) return false; g[k] = k === 'rot' ? normAng(v) : v; moveComp(a.m, g); return true; }
      if (k === 'designator' || k === 'comment') { attrComp(a.m, k, v); return true; }
      return false;
    }
    case 'track': case 'arc': case 'fill': {
      const e = a.m.eff;
      if (a.t === 'arc' && k === 'diam') { if (!pos(v)) { HubDialog.toast('diâmetro tem de ser maior que zero', 'warn'); return false; } return editaItem(a.m, { r:r6(v / 2) }); }
      if (a.t === 'arc' && k === 'net' && !a.m.added) return false;
      if (k === 'layer') { if (!LBYK[v] || v === 'Multi' || v === e.layer) return false; return editaItem(a.m, { layer:v }); }
      if (k === 'net') { if (!cobre(e.layer)) return false; return editaItem(a.m, { net:String(v || '') }); }
      if ((k === 'w' || k === 'r') && !pos(v)) { HubDialog.toast((k === 'w' ? 'largura' : 'raio') + ' tem de ser maior que zero', 'warn'); return false; }
      if (!isNum(v)) return false;
      if (a.t === 'fill' && /^[xy][12]$/.test(k)) {
        const n = Object.assign({}, e, { [k]:v });
        if (near(n.x1, n.x2) || near(n.y1, n.y2)) { HubDialog.toast('o fill ficaria sem área', 'warn'); return false; }
      }
      return editaItem(a.m, { [k]:(k === 'rot' || k === 'sa' || k === 'ea') ? normAng(v) : r6(v) });
    }
    case 'via': {
      if (k === 'from' || k === 'to') {
        const e = a.m.eff, de = k === 'from' ? v : (e.from || 'Top'), ate = k === 'to' ? v : (e.to || 'Bottom');
        if (!LBYK[v] || LBYK[v].kind !== 'signal') return false;
        if (de === ate) { HubDialog.toast('a via liga duas camadas diferentes', 'warn'); return false; }
        return editaItem(a.m, { from:de, to:ate });
      }
      if (!isNum(v)) return false;
      if ((k === 'size' || k === 'drill') && !pos(v)) return false;
      const ok = editaItem(a.m, { [k]:r6(v) });
      const e = a.m.eff, s = k === 'size' ? v : e.size, d = k === 'drill' ? v : e.drill;
      if (d >= s) HubDialog.toast('furo >= diâmetro: a via fica sem anel', 'warn');
      return ok;
    }
    case 'region': {
      const e = a.m.eff;
      if (k === 'layer') { if (!LBYK[v] || v === 'Multi' || v === e.layer) return false; return editaRegiao(a.m, { layer:v, points:e.points, net:cobre(v) ? e.net : '' }); }
      if (k === 'net') { if (!cobre(e.layer)) return false; return editaRegiao(a.m, { net:String(v || ''), points:e.points, layer:e.layer }); }
      if (/^b[whxy]$/.test(k)) return caixaNoAlvo(a, k, v);
      return false;
    }
    case 'text': {
      const s = a.m.src || {}, e = ebDe(a.m) || a.m.eff;
      if (s.designator) {
        if (k === 'h') { if (!pos(v)) return false; moveDesignator(a.m, { h:v }); return true; }
        if (k === 'rot') { if (!isNum(v)) return false; moveDesignator(a.m, { rot:v }); return true; }
        if (k === 'x' || k === 'y') { if (!isNum(v)) return false; moveDesignator(a.m, { x:k === 'x' ? v : e.x, y:k === 'y' ? v : e.y }); return true; }
        return false;
      }
      if (s.comment) {
        if (k === 'comment') { const c = model.compByRef[s.owner]; if (!c) return false; attrComp(c, 'comment', v); return true; }
        return false;
      }
      if (s.owner && !a.m.added) return false;
      if (k === 'layer') {
        if (!LBYK[v] || v === 'Multi' || v === e.layer) return false;
        const p = { layer:v };
        if (ladoBaixo(v) !== ladoBaixo(e.layer)) p.mirror = ladoBaixo(v);
        return editaItem(a.m, p);
      }
      if (k === 'text') { const t = limpaTxt(v); if (!t.trim()) { HubDialog.toast('texto vazio: para tirar o texto, Delete', 'warn'); return false; } return editaItem(a.m, { text:t }); }
      if (k === 'mirror') return editaItem(a.m, { mirror:!!v });
      if ((k === 'h' || k === 'w') && !pos(v)) return false;
      if (!isNum(v)) return false;
      return editaItem(a.m, { [k]:k === 'rot' ? normAng(v) : r6(v) });
    }
    case 'ann': {
      const n = a.ann;
      if (k === 'msg') { const t = String(v || '').replace(/"/g, "'").trim(); if (!t) return false; n.msg = t; }
      else if (k === 'severity' && ANN_COLORS[v]) n.severity = v;
      else if (k === 'status' && (v === 'open' || v === 'resolved')) n.status = v;
      else return false;
      return 'ann';
    }
    case 'cota': {
      const c = a.cota;
      if (k === 'modo' && HCOT && HCOT.MODOS[v]) { c.modo = v; return 'cota'; }
      if ((k === 'condA' || k === 'condB') && (v === 'perto' || v === 'longe' || v === 'centro')) {
        const p = k === 'condA' ? c.a : c.b; if (!p.circ) return false; p.cond = v; return 'cota';
      }
      return false;
    }
  }
  return false;
}
function editarCampo(k, v){
  if (String(k).indexOf('tool.') === 0) { configTool(String(k).slice(5), v); return; }
  if (!SEL.length || LEAN) return;
  if (!soNotas(SEL) && !garanteEdicao()) return;
  let ann = false, cota = false;
  const alvos = SEL.slice();
  /* camada, largura, pontas, centro, raio, angulos ou net de trilha/arco, e posicao ou diametro de
     via: a mudanca que faria cobre de nets diferentes se encontrarem nao entra (editaConferindo) */
  const conferir = alvos.filter(a => CAMPOS_COBRE[a.t] && CAMPOS_COBRE[a.t][k]);
  const r = editaConferindo(conferir, () => {
    let mexeu = false;
    for (const a of alvos) {
      const x = campoNoAlvo(a, k, v);
      if (x === 'ann') ann = true; else if (x === 'cota') cota = true; else if (x) mexeu = true;
    }
    return mexeu;
  }, 'não deixa');
  if (cota) { gravaCotas(); pede(); if (painel) painel.atualiza(); }
  if (ann) annChanged();
  if (r) commit(); else if (painel) painel.atualiza();
}
function acaoPainel(id){
  switch (id) {
    case 'girar': transformaSelecao('gira'); return;
    case 'virar': transformaSelecao('vira'); return;
    case 'apagar': if (soNotas(SEL) || garanteEdicao()) apagaSelecao(); return;
    case 'enquadrar': enquadraAlvos(SEL); return;
    case 'enquadrar_placa': enquadra(); return;
    case 'fpPadsTodos': { const a = SEL[0]; if (a && a.t === 'pad' && a.comp) padNoFootprint(a, camadasDoPad(a.eb, IDX.ebComp.get(a.comp)), true); return; }
    case 'selComp': { const cs = compsDaSel(); if (cs.length) { selSo(cs.map(m => ALVO_COMP.get(m)).filter(Boolean)); aoMudarSel(); pede(); } return; }
  }
  fazAcao(id);
}

/* ============================== o que o painel lista ============================== */

function infoPlaca(){
  const bb = EB.board && EB.board.bbox;
  const W = bb ? bb.x2 - bb.x1 : 0, H = bb ? bb.y2 - bb.y1 : 0;
  let area = 0;
  try {
    const segs = [];
    for (const s of ((EB.board && EB.board.outline) || [])) {
      if (s && s.kind === 'arc' && [s.cx, s.cy, s.r, s.sa, s.ea].every(isNum)) segs.push(HubLaser.arcPts(s.cx, s.cy, s.r, s.sa, s.ea));
      else if (s && [s.x1, s.y1, s.x2, s.y2].every(isNum)) segs.push([[s.x1, s.y1], [s.x2, s.y2]]);
    }
    for (const l of HubLaser.chainSegments(segs)) area = Math.max(area, Math.abs(area2(l)) / 2);
    for (const k of recortesDaTela()) area -= Math.abs(area2(k.pts)) / 2;
  } catch (e) { area = W * H; }
  const comps = EB.components || [];
  const conta = (arr, f) => (arr || []).filter(f || (() => true)).length;
  const reta = o => o && o.kind !== 'arc', curva = o => o && o.kind === 'arc';
  let pads = conta(EB.freepads);
  for (const c of comps) pads += ((c && c.pads) || []).length;
  return {
    fonte:String(B.source || '').split(/[\\/]/).pop() || '—', gerado:B.generated || '?',
    exporter:B.exporter || '', novo:!!B.exporter,
    W, H, area,
    comps:comps.length, top:conta(comps, c => c.layer !== 'Bottom'), bottom:conta(comps, c => c.layer === 'Bottom'),
    trilhas:conta(EB.tracks) + conta(EB.silk, reta) + conta(EB.lines, reta), cobre:conta(EB.tracks),
    arcos:conta(EB.arcs) + conta(EB.silk, curva) + conta(EB.lines, curva),
    pads, vias:conta(EB.vias), fills:conta(EB.fills), regioes:conta(EB.regions), textos:conta(EB.texts),
    recortes:recortesDaTela().length, nets:NETS.length,
    camadas:LAYERS.filter(l => l.used || l.inBoard).length, sinal:camadasCobre().length,
    regras:RULES,
  };
}
function chLabel(ch){
  const f = v => fmtNum(v, 4);
  switch (ch && ch.op) {
    case 'comp_move': return 'mover ' + ch.ref + ' → (' + f(ch.x) + ', ' + f(ch.y) + ') rot ' + f(ch.rot) + (ch.layer ? ' ' + ch.layer : '');
    case 'comp_attr': return 'atributos ' + ch.ref + (ch.designator ? ' → ' + ch.designator : '') + (typeof ch.comment === 'string' ? ' (' + ch.comment + ')' : '');
    case 'track_edit': return 'editar trilha ' + ch.id + (ch.layer ? ' → ' + ch.layer : '');
    case 'track_add': return 'nova ' + (cobre(ch.layer) ? 'trilha' : 'linha') + ' ' + ch.layer + ' (' + f(ch.x1) + ',' + f(ch.y1) + ')–(' + f(ch.x2) + ',' + f(ch.y2) + ')';
    case 'track_del': return 'remover trilha ' + ch.id;
    case 'via_edit': return 'editar via ' + ch.id;
    case 'via_add': return 'nova via (' + f(ch.x) + ', ' + f(ch.y) + ')' + (ch.net ? ' ' + ch.net : '');
    case 'via_del': return 'remover via ' + ch.id;
    case 'arc_edit': return 'editar arco ' + ch.id + (ch.layer ? ' → ' + ch.layer : '');
    case 'arc_add': return 'novo arco ' + ch.layer + (Math.abs((ch.ea || 0) - (ch.sa || 0)) >= 360 ? ' (círculo)' : '');
    case 'arc_del': return 'remover arco ' + ch.id;
    case 'text_edit': return 'editar texto ' + ch.id + (typeof ch.text === 'string' ? ' → "' + ch.text + '"' : '');
    case 'text_add': return 'novo texto "' + ch.text + '" ' + ch.layer;
    case 'text_del': return 'remover texto ' + ch.id;
    case 'designator_move': return 'designator ' + ch.ref + ' → (' + f(ch.x) + ', ' + f(ch.y) + ')';
    case 'fill_add': return 'novo fill ' + ch.layer;
    case 'fill_edit': return 'editar fill ' + ch.id + (ch.layer ? ' → ' + ch.layer : '');
    case 'fill_del': return 'remover fill ' + ch.id;
    case 'region_add': return ch.cutout ? 'novo recorte (' + (Array.isArray(ch.pts) ? ch.pts.length : '?') + ' vértices)' : 'nova região ' + ch.layer;
    case 'region_del': return 'remover região ' + ch.id;
    case 'outline_set': return 'novo contorno da placa (' + (Array.isArray(ch.pts) ? ch.pts.length : '?') + ' vértices)';
    case 'pad_add': return 'novo pad ' + (ch.type === 'npth' ? 'NPTH ' : ch.type === 'smd' ? 'SMD ' : '') + (ch.name || '') + ' (' + f(ch.x) + ', ' + f(ch.y) + ')';
    case 'pad_edit': return 'editar pad ' + ch.id;
    case 'pad_del': return 'remover pad ' + ch.id;
    case 'pad_net': return 'net do pad ' + ch.ref + '.' + ch.pad + ' → ' + (ch.net || '(sem net)');
    case 'comp_add': return 'novo componente ' + ch.ref + ' (' + ch.footprint + ')';
    case 'comp_del': return 'remover componente ' + ch.ref;
    case 'comment_move': return 'comment ' + ch.ref + ' → (' + f(ch.x) + ', ' + f(ch.y) + ')';
    case 'poly_add': return 'novo polígono ' + ch.layer + (ch.net ? ' ' + ch.net : '');
    case 'poly_edit': return 'editar polígono ' + ch.id;
    case 'poly_del': return 'remover polígono ' + ch.id;
    case 'net_add': return 'nova net ' + ch.net;
    case 'net_del': return 'remover net ' + ch.net;
    case 'net_rename': return 'renomear net ' + ch.orig_net + ' → ' + ch.net;
    case 'stack_set': return 'pilha de camadas: ' + ((ch.layers || []).length) + ' de cobre (' + (ch.layers || []).map(l => l && l.key).join(', ') + ')';
    default: return '?? ' + (ch && ch.op);
  }
}
function linhasComponentes(){
  return model.comps.map(m => ({
    ref:m.eff.designator || m.src.ref, srcRef:m.src.ref, footprint:m.src.footprint || '',
    comment:m.eff.comment !== undefined ? m.eff.comment : (m.src.comment || ''),
    layer:m.eff.layer, x:m.eff.x, y:m.eff.y, rot:m.eff.rot,
    mudou:{ ref:!!(m.attrChanged && m.eff.designator), comment:!!(m.attrChanged && m.eff.comment !== undefined),
            layer:m.changed && m.eff.layer !== m.src.layer, x:m.changed && !near(m.eff.x, m.src.x),
            y:m.changed && !near(m.eff.y, m.src.y), rot:m.changed && !nearAng(m.eff.rot, m.src.rot) },
    movido:m.changed || m.attrChanged,
    sel:SEL.some(a => a.t === 'comp' && a.m === m),
  }));
}
function exportCsv(){
  const L = ['Designator\tFootprint\tComment\tLayer\tX_mm\tY_mm\tRotation'];
  for (const r of linhasComponentes()) L.push([r.ref, r.footprint, r.comment, r.layer, (+r.x).toFixed(4), (+r.y).toFixed(4), fmtNum(r.rot, 4).replace(',', '.')].join('\t'));
  const blob = new Blob([L.join('\r\n')], { type:'text/tab-separated-values' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'pcb-list-updated.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function irPara(alvo, dePainel){ if (!alvo) return; selSo([alvo], dePainel); enquadraAlvos([alvo]); }
const V = {
  LEAN, PROJ,
  marcacoes:() => { try { return marcacoesSemFuro(null).length; } catch (e) { return 0; } },
  get B(){ return B; }, get model(){ return model; }, get EB(){ return EB; }, get CH(){ return CH; }, ANN,
  camadas:() => LAYERS.map(l => ({ key:l.key, nome:l.name, rot:rotuloAba(l), cor:l.color, count:l.count, usada:!!(l.used || l.inBoard),
                                   vis:show.layers[l.key] !== false, atual:l.key === cur, kind:l.kind })),
  cur:() => cur, setCur, setVisivel, soEsta, mostraTodas, conjunto,
  conjuntos:() => Object.keys(CONJUNTOS).map(k => ({ id:k, rot:CONJUNTOS[k].rot })),
  show:() => ({ grid:show.grid, ghost:show.ghost, unica:show.unica, flip:view.flip, cotas:show.cotas, nCotas:COTAS.length }),
  /* Real View do 3D: o icone do painel Vista liga (abrindo o 3D) e desliga */
  /* desempenho: as opcoes do 3D e quantas linhas tem o changes.js (as marcacoes pesam com muitas) */
  opc3d:() => Object.assign({}, OPC3D), setOpc3d, nMudancas:() => CH.length,
  /* a pilha de camadas (painel » Camadas) */
  pilha:PILHA,
  realView:() => !!(typeof HubPcb3dVista !== 'undefined' && (V3 ? V3.realView() : HubPcb3dVista.preferido())),
  setRealView(on){
    if (typeof HubPcb3dVista === 'undefined') return;
    HubPcb3dVista.prefere(!!on);
    if (V3) V3.realView(!!on);
    if (on && !modo3d) entra3d();
    if (painel) painel.atualiza();
  },
  /* Solda embaixo (so visualizacao): marcada, no 3D o pino de todo componente para na placa e a
     outra face mostra o ponto de solda de cada pad passante */
  solda:() => soldaNo3d(),
  setSolda(on){
    if (typeof HubPcb3dVista === 'undefined' || typeof HubPcb3dVista.soldaPrefere !== 'function') return;
    HubPcb3dVista.soldaPrefere(!!on);
    if (V3) cena3d();
    if (painel) painel.atualiza();
  },
  setShow(k, v){
    if (k === 'grid') show.grid = !!v; else if (k === 'ghost') { setMarcas(v); return; }
    else if (k === 'unica') { setUnica(!!v); return; } else if (k === 'flip') { setFlip(!!v); return; }
    else if (k === 'cotas') { setCotasVer(!!v); return; }
    if (painel) painel.atualiza(); pede();
  },
  unidade:() => unidade, setUnidade, grades:() => GRADES, grade:() => grade.id, setGrade,
  snapObj:() => snapObj, setSnapObj(v){ if (['todas', 'atual', 'off'].indexOf(v) >= 0) { snapObj = v; gravaPref('snapobj', v); if (painel) painel.atualiza(); } },
  filtros:() => FILTROS.map(([k, rot]) => ({ k, rot, on:!!filtro[k] })),
  setFiltro(k, v){
    if (k === '*') { for (const [f] of FILTROS) filtro[f] = !!v; }
    else if (k in filtro) filtro[k] = !!v;
    gravaPref('filtro', JSON.stringify(filtro));
    pintaFiltroMenu();
    if (painel) painel.atualiza(); pede();
  },
  info:infoPlaca, ficha, editar:editarCampo, acao:acaoPainel,
  fmtDist, fmtNum, parseDist, parseNum,
  componentes:linhasComponentes,
  selComp(srcRef){ const m = model.compByRef[srcRef]; if (m) irPara(ALVO_COMP.get(m), true); },
  mudancas:() => model.changeItems.map((it, i) => ({ i, rot:chLabel(it.ch), status:it.status, msg:it.msg, temAlvo:!!it.target, nota:(it.ch && it.ch.note) || '' })),
  irMudanca(i){
    const it = model.changeItems[i]; if (!it || !it.target) return;
    const m = it.target;
    const a = alvoDoModelo(m);
    if (a) irPara(a, true);
  },
  tiraMudanca(i){
    const it = model.changeItems[i]; if (!it) return;
    if (!garanteEdicao()) return;
    const k = CH.indexOf(it.ch); if (k < 0) return;
    CH.splice(k, 1); commit();
    HubDialog.toast('mudança tirada (Ctrl+Z devolve)', 'info', 2200);
  },
  validacao:() => model.validation.map(v => ({ level:v.level, msg:v.msg })),
  sinalizadores:() => ANN.filter(a => a.view === 'pcb'),
  irAnn(a){ irPara(annAlvo(a), true); },
  annDel(a){ if (LEAN) return; const i = ANN.indexOf(a); if (i >= 0) { ANN.splice(i, 1); SEL = SEL.filter(x => x.ann !== a); if (HOVER && HOVER.ann === a) HOVER = null; annChanged(); aoMudarSel(); } },
  annReabre(a){ if (LEAN) return; a.status = 'open'; a.reply = ''; annChanged(); },
  editOn:() => editOn, setEdit(v){ setEdit(v); },
  sujo:() => ({ ch:chDirty, ann:annDirty }), salvar:() => salvar(), csv:exportCsv,
  gerber:() => abreGerber(), verGerberSalvo:() => verGerberSalvo(), temGerber:() => typeof HubGerber !== 'undefined' && typeof HubGerberView !== 'undefined',
  teclaDe, podeGravar:HubIO.canPost && !!PROJ,
  sel:() => SEL.slice(), tool:() => tool, ajuda:() => toggleAjuda(true),
  rotaAtiva:() => !!(draft && draft.tipo === 'rota' && draft.est), preencher:() => preencher,
};

/* os ganchos do MCP (mcp/hub-mcpvista.js): a IA foca um ponto, seleciona por id/ref e roda
   qualquer acao da barra/teclado pelo nome (drc, gerber, pdf, repour...) */
window.HubMcpVista = {
  focar(x, y, zoom){ if (isNum(x) && isNum(y)) { view.cx = x; view.cy = y; if (isNum(zoom) && zoom > 0) view.scale = zoom; pede(); } return true; },
  selecionar(o){
    o = o || {};
    const alvos = [];
    for (const id of o.ids || []) { const m = IDX.item.get(String(id)); const a = m ? PORCHAVE.get(chave({ t:m.kind, m })) : null; if (a) alvos.push(a); }
    for (const r of o.refs || []) { const m = model.compByRef[r]; const a = m ? ALVO_COMP.get(m) : null; if (a) alvos.push(a); }
    selSo(alvos); pede(); return alvos.length;
  },
  comando(nome){ if (typeof nome !== 'string' || !nome) return false; fazAcao(nome); return true; },
  captura(){ return cv; },
};

/* ============================== Gerber ==============================
   O visualizador (hub-gerberview.js) abre POR CIMA da vista, com o conjunto gerado agora pelo
   hub-gerber.js a partir da placa EFETIVA (board.js + changes.js de agora) -- o mesmo motor que
   a tela desenha. Na barra dele: Gerar de novo, Baixar .zip, Salvar no projeto (POST
   /api/gerber -> Projects/<p>/Gerber/) e Ver salvo (o ultimo conjunto gravado, para comparar). */
let GV = null, gerIdx = -1, gerUltimo = null;
const gerOpc = {
  nomes:lePref('gerber.nomes', 'fabricacao') === 'altium' ? 'altium' : 'fabricacao',
  vazias:lePref('gerber.vazias', '0') === '1',
  gtoGbo:lePref('gerber.gtogbo', '0') === '1',
  x2:lePref('gerber.x2', '1') !== '0',
};
function gerberAberto(){ const o = $('gerber'); return !!o && !o.hidden; }
function baseDoPcbDoc(){
  const n = String(B.source || '').split(/[\\/]/).pop().replace(/\.pcbdoc$/i, '');
  return n || PROJ || 'placa';
}
function abreGerber(){
  fechaMenu();
  if (LEAN) return;
  if (typeof HubGerberView === 'undefined') {
    HubDialog.alert('O visualizador de Gerber (hub-gerberview.js) não carregou nesta página. Atualize o hub (F5); se continuar, o arquivo não chegou nesta instalação.', { title:'Gerber' });
    return;
  }
  $('gerber').hidden = false;
  /* o visualizador tem o rodape dele (X/Y, zoom): o da vista sai enquanto ele esta aberto */
  document.body.classList.add('gerber-on');
  if (!GV) montaGerberView();
  if (gerIdx < 0) { if (libPronta) libPronta.then(() => { if (gerIdx < 0) regeraGerber(true); }); else regeraGerber(true); }
  else { pintaGerberTopo(); GV.redesenhar(); }
}
function fechaGerber(){ const o = $('gerber'); if (o) o.hidden = true; document.body.classList.remove('gerber-on'); try { cv.focus(); } catch (e) {} pede(); }
function montaGerberView(){
  GV = HubGerberView.montar($('gerberVista'), {
    conjuntos:[],
    menu:true,
    aoFechar:() => fechaGerber(),
    barraExtra:[
      { rotulo:'Gerar de novo', curto:'Gerar de novo', ic:'gerar', titulo:'Gera de novo a partir da placa com as mudanças de agora (inclusive as ainda não salvas)', primario:true, acao:() => regeraGerber(false) },
      { rotulo:'Baixar .zip', curto:'Baixar .zip', ic:'baixar', titulo:'Baixa o pacote num .zip com o nome do .PcbDoc', acao:() => baixaZipGerber() },
      { rotulo:'Salvar no projeto', curto:'Salvar', ic:'salvar', titulo:V.podeGravar ? 'Salvar no projeto: grava em Projects/' + PROJ + '/Gerber/ (o conjunto anterior sai da pasta)' : 'Só com o hubserver e um projeto aberto (?p=)', desabilitado:!V.podeGravar, acao:() => salvaGerber() },
      { rotulo:'Ver salvo', curto:'Ver salvo', ic:'salvo', titulo:V.podeGravar ? 'Abre o último conjunto gravado em Projects/' + PROJ + '/Gerber/ ao lado do gerado, para comparar' : 'Só com o hubserver e um projeto aberto', desabilitado:!V.podeGravar, acao:() => verGerberSalvo() },
      { rotulo:'Enviar pra JLC', curto:'Enviar pra JLC', ic:'carrinho', titulo:V.podeGravar ? 'Salva o Gerber no projeto e põe no carrinho da JLCPCB pelo IntegrateBrowser — pergunta a quantidade antes; o pagamento fica com você' : 'Só no app (ou com o hubserver) e um projeto aberto', desabilitado:!V.podeGravar,
        acao:() => enviaJlc().catch(e => HubDialog.toast('Enviar pra JLC: ' + (e && e.message || e), 'err', 0)) },
    ],
  });
  /* as opcoes do pacote e os avisos do gerador vao para dentro do menu do canto */
  const opc = $('gbOpcoes');
  if (opc && GV.menuExtra) {
    GV.menuExtra.append(opc);
    const sum = $('gbOpcSum');
    if (sum && HubGerberView.icone) sum.insertAdjacentHTML('afterbegin', HubGerberView.icone('opcoes'));
  }
}
function geraGerber(){
  if (typeof HubGerber === 'undefined' || typeof HubGerber.gerar !== 'function')
    throw new Error('o gerador de Gerber (hub-gerber.js) não carregou nesta página — o visualizador abre, mas não há o que gerar');
  /* a placa da TELA: com os teardrops refeitos e os poligonos do hub despejados (recalcula) */
  const eb = EB || HC.effectiveBoard(B, model);
  gerUltimo = HubGerber.gerar(eb, { base:baseDoPcbDoc(), nomes:gerOpc.nomes, vazias:gerOpc.vazias, gtoGbo:gerOpc.gtoGbo, x2:gerOpc.x2, software:'NexoEletric' });
  /* componente do comp_add sem footprint nao entra na placa: o Gerber sairia sem ele, calado */
  const sem = compsSemFootprint();
  if (sem.length && Array.isArray(gerUltimo.avisos))
    gerUltimo.avisos.unshift('ATENÇÃO: ' + sem.length + (sem.length === 1 ? ' componente ficou' : ' componentes ficaram') + ' FORA do Gerber — footprint não encontrado na biblioteca (' +
      sem.slice(0, 6).map(i => i.ch.ref).join(', ') + (sem.length > 6 ? '…' : '') + '). Veja a aba Mudanças.');
  return gerUltimo;
}
function regeraGerber(primeiro){
  let r;
  try { r = geraGerber(); }
  catch (e) { pintaGerberTopo(String(e && e.message || e)); if (!primeiro) HubDialog.toast('Gerber: ' + (e && e.message || e), 'err', 0); return; }
  const conj = { titulo:r.resumo.base + (chDirty ? ' *' : ''), arquivos:r.arquivos.map(a => ({ nome:a.nome, texto:a.texto })) };
  if (gerIdx >= 0 && GV.estado.conjuntos[gerIdx]) GV.substituir(gerIdx, conj);
  else { GV.adicionar(conj, GV.estado.conjuntos.length > 0, r.avisos); gerIdx = GV.estado.conjuntos.length - 1; }
  pintaGerberTopo();
  if (!primeiro) HubDialog.toast('Gerber gerado: ' + r.arquivos.length + ' arquivo(s)', 'ok');
}
function pintaGerberTopo(erro){
  const meta = $('gbMeta'), av = $('gbAvisos');
  if (!meta || !av) return;
  av.textContent = '';
  if (erro) { meta.textContent = erro; av.hidden = true; return; }
  const r = gerUltimo;
  if (!r) { meta.textContent = ''; av.hidden = true; return; }
  const desc = (r.resumo.descartadas || []).length;
  meta.textContent = r.arquivos.length + ' arquivos · ' + (gerOpc.x2 ? 'X2' : 'RS-274X') + ' mm 4:5' + (desc ? ' · ' + desc + ' vazias fora' : '') + (B.exporter ? '' : ' · espelho antigo');
  meta.title = r.resumo.base + ' · ' + r.arquivos.length + ' arquivo(s)' + (desc ? ' · ' + desc + ' camada(s) vazia(s) fora do pacote' : '') +
    ' · ' + (gerOpc.x2 ? 'Gerber X2' : 'RS-274X sem atributos') + ' mm 4:5';
  const lista = r.avisos || [];
  if (!lista.length) { av.hidden = true; return; }
  av.hidden = false;
  const alto = lista.filter(a => /^ATEN/i.test(a));
  const sum = document.createElement('summary');
  if (typeof HubGerberView !== 'undefined' && HubGerberView.icone) sum.innerHTML = HubGerberView.icone('aviso');
  sum.append(lista.length + (lista.length === 1 ? ' aviso' : ' avisos'));
  sum.title = 'Avisos do gerador' + (alto.length ? ' — ' + alto[0] : '');
  av.append(sum);
  const ul = document.createElement('ul');
  for (const a of lista) { const li = document.createElement('li'); li.textContent = a; ul.append(li); }
  av.append(ul);
}
function opcaoGerber(k, v){
  gerOpc[k] = v;
  gravaPref('gerber.' + k.toLowerCase(), k === 'nomes' ? v : (v ? '1' : '0'));
  if (GV) regeraGerber(false);
}
async function baixaZipGerber(){
  if (libPronta) await libPronta;
  if (!gerUltimo) regeraGerber(false);
  const r = gerUltimo;
  if (!r) return;
  if (typeof HubGerber.zip !== 'function') throw new Error('o hub-gerber.js desta instalação não monta .zip');
  const bytes = await HubGerber.zip(r.arquivos);
  const blob = new Blob([bytes], { type:'application/zip' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = r.resumo.zip || (baseDoPcbDoc() + '.zip');
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  HubDialog.toast('baixado ' + a.download + ' (' + Math.max(1, Math.round(bytes.length / 1024)) + ' KB, ' + r.arquivos.length + ' arquivos)', 'ok');
}
async function salvaGerber(){
  if (!V.podeGravar) { HubDialog.toast('Salvar no projeto só funciona com o hubserver e um projeto aberto', 'warn'); return; }
  if (libPronta) await libPronta;
  if (!gerUltimo) regeraGerber(false);
  const r = gerUltimo;
  if (!r) return;
  const corpo = { proj:PROJ, arquivos:r.arquivos.map(a => ({ nome:a.nome, texto:a.texto })),
    manifesto:{ base:r.resumo.base, opcoes:Object.assign({}, gerOpc), avisos:(r.avisos || []).slice(0, 60), software:'NexoEletric',
                origem:'vista PCB', mudancas:CH.length, changesSalvo:!chDirty } };
  const resp = await fetch('/api/gerber', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(corpo) });
  let j = null;
  try { j = await resp.json(); } catch (e) {}
  if (!resp.ok || !j || !j.ok) throw new Error((j && j.error) || ('HTTP ' + resp.status));
  HubDialog.toast('Gerber salvo em ' + j.pasta + ' — ' + (j.arquivos || []).length + ' arquivo(s)' +
    ((j.removidos || []).length ? '; saíram ' + j.removidos.length + ' de antes' : '') + (chDirty ? '. Atenção: inclui mudanças ainda não salvas no changes.js.' : ''), chDirty ? 'warn' : 'ok', 7000);
}
/* ── Enviar pra JLC (pedido do dono, 2026-10-23: "em Gerber clicar em 'enviar pra JLC', ele já abre o
   IntegrateBrowser e já coloca no carrinho da JLC o ZIP; pela quantidade de layers ele já sabe o que
   configurar; só pergunta antes quantas placas") ──
   Pergunta a quantidade (as da lista da JLC), salva o Gerber gerado no projeto e pede ao hub
   (/api/jlc, tools/rotas/jlc.py) que rode o mcp/lib/jlc.js -- o mesmo motor das ferramentas jlc_* do
   MCP. Sem login na JLC a janela do IntegrateBrowser aparece e espera a pessoa entrar: a senha nunca
   passa pelo hub. O pedido para no carrinho. */
/* o envio em curso: fechar a vista (ou o app) no meio cancela a ação (POST /api/jlc/cancelar) */
let jlcJob = null;
window.addEventListener('pagehide', () => {
  if (!jlcJob) return;
  try { navigator.sendBeacon('/api/jlc/cancelar', new Blob([JSON.stringify({ job:jlcJob })], { type:'application/json' })); } catch (e) {}
});
const JLC_QTDS = [5, 10, 15, 20, 25, 30, 50, 75, 100, 125, 150, 200, 250, 300, 350, 400, 450, 500, 600, 700, 750, 800, 900, 1000];
async function enviaJlc(){
  if (!V.podeGravar) { HubDialog.toast('Enviar pra JLC só funciona no app (ou com o hubserver) e um projeto aberto', 'warn'); return; }
  if (libPronta) await libPronta;
  if (!gerUltimo) regeraGerber(false);
  const r = gerUltimo;
  if (!r) return;
  const cobre = r.arquivos.filter(a => /%TF\.FileFunction,Copper,/i.test(String(a.texto || '').slice(0, 4000))).length;
  const jlc = cobre <= 2 ? Math.max(1, cobre) : cobre % 2 ? cobre + 1 : cobre;
  const bb = EB && EB.board && EB.board.bbox;
  const tam = bb ? fmtNum(bb.x2 - bb.x1, 2) + ' × ' + fmtNum(bb.y2 - bb.y1, 2) + ' mm' : '';
  const qtd = await HubDialog.escolhe(r.resumo.base + '\n' + cobre + ' camada(s) de cobre' + (jlc !== cobre ? ' — a JLC fabrica ' + jlc : '') + (tam ? ' · ' + tam : '') +
    '\n\nO Gerber gerado agora é salvo no projeto e sobe para o orçamento da JLCPCB no IntegrateBrowser, com as camadas da placa e a quantidade abaixo. O pedido para no carrinho: o pagamento fica com você. Se a conta não estiver aberta, a janela do navegador aparece para você entrar.' +
    (chDirty ? '\n\nAtenção: inclui mudanças ainda não salvas no changes.js.' : ''),
    { title:'Enviar pra JLC', rotulo:'Quantas placas', opcoes:JLC_QTDS.map(v => ({ v, rot:v + ' placas' })), v:lePref('jlc.qtd', '5'), ok:'Enviar' });
  if (qtd == null) return;
  gravaPref('jlc.qtd', qtd);
  await salvaGerber();
  const resp = await fetch('/api/jlc/enviar', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ proj:PROJ, quantidade:Number(qtd) }) });
  let j = null;
  try { j = await resp.json(); } catch (e) {}
  if (!resp.ok || !j || !j.ok) throw new Error((j && j.error) || ('HTTP ' + resp.status));
  jlcJob = j.job;
  try { await acompanhaJlc(j.job, qtd); } finally { jlcJob = null; }
}
async function acompanhaJlc(job, qtd){
  const j = { job };
  let aviso = HubDialog.toast('JLC: começando…', 'info', 0), ultimo = '';
  const t0 = Date.now();
  for (;;) {
    await new Promise(res => setTimeout(res, 1500));
    let e = null;
    try { e = await (await fetch('/api/jlc/estado?job=' + encodeURIComponent(j.job), { cache:'no-store' })).json(); } catch (x) {}
    if (!e || !e.ok) { aviso.close(); throw new Error((e && e.error) || 'o hub perdeu o envio'); }
    const passo = e.passos[e.passos.length - 1] || '';
    if (passo && passo !== ultimo) { ultimo = passo; aviso.close(); aviso = HubDialog.toast('JLC: ' + passo + '…', 'info', 0); }
    if (e.fim) {
      aviso.close();
      if (e.erro && /navegador foi fechado|envio cancelado/.test(e.erro)) { HubDialog.toast('Enviar pra JLC: ' + (/navegador/.test(e.erro) ? 'o navegador foi fechado — ' : '') + 'envio cancelado', 'info', 4000); return; }
      if (e.erro) throw new Error(e.erro);
      const s = e.resultado || {};
      const av = (s.avisos || []).length ? '\n\nAvisos:\n• ' + s.avisos.join('\n• ') : '';
      if (s.etapa === 'login') { HubDialog.toast('JLC: a conta não foi aberta a tempo — entre na conta na janela do IntegrateBrowser e clique em Enviar pra JLC de novo', 'warn', 0); return; }
      await HubDialog.alert((s.etapa === 'carrinho' ? 'Está no carrinho da JLCPCB.' : 'O SAVE TO CART foi clicado, mas a tela do carrinho não foi reconhecida: confira na janela do IntegrateBrowser.') +
        '\n\n' + (s.detectado || '') + '\nCamadas: ' + (s.camadas || '?') + ' · Quantidade: ' + (s.quantidade || qtd) + (s.preco ? ' · Preço: ' + s.preco : '') +
        (s.etapa === 'carrinho' && s.noCarrinho === false ? '\n\nNão achei o nome do arquivo na página do carrinho: confira lá.' : '') + av +
        '\n\nO pagamento é com você, no carrinho da JLC (aberto no IntegrateBrowser).', { title:'Enviar pra JLC' });
      return;
    }
    if (Date.now() - t0 > 12 * 60000) { aviso.close(); throw new Error('o envio passou de 12 minutos — confira a janela do IntegrateBrowser'); }
  }
}
async function verGerberSalvo(){
  if (!V.podeGravar) { HubDialog.toast('Ver o Gerber salvo só funciona com o hubserver e um projeto aberto', 'warn'); return; }
  if (typeof HubGerberView === 'undefined') { abreGerber(); return; }
  const base = 'Projects/' + PROJ + '/Gerber/';
  let man;
  try { man = JSON.parse(await HubIO.fetchText(base + 'gerber.json')); }
  catch (e) { HubDialog.toast('Nenhum Gerber salvo neste projeto ainda (' + base + 'gerber.json)', 'warn', 5000); return; }
  const arquivos = [];
  for (const a of (man && man.arquivos) || []) {
    try { arquivos.push({ nome:a.nome, texto:await HubIO.fetchText(base + encodeURIComponent(a.nome)) }); } catch (e) {}
  }
  if (!arquivos.length) { HubDialog.toast('O gerber.json não lista arquivo legível em ' + base, 'warn'); return; }
  $('gerber').hidden = false;
  document.body.classList.add('gerber-on');
  if (!GV) montaGerberView();
  GV.adicionar({ titulo:'Salvo em ' + (man.gerado || '?') + ' — ' + (man.base || ''), arquivos }, GV.estado.conjuntos.length > 0);
  pintaGerberTopo();
  HubDialog.toast('conjunto salvo aberto' + (GV.estado.conjuntos.length > 1 ? ' para comparar com o gerado (C alterna)' : ''), 'info');
}

/* ============================== salvar ==============================
   Dois escritores (a IA e esta tela): guarda o que veio do disco e pergunta antes de passar por
   cima de uma gravacao de fora; os comentarios // do changes.js em disco sao preservados. */
const CH_REL = PROJ ? 'Projects/' + PROJ + '/changes.js' : 'changes.js';
const ANN_REL = PROJ ? 'Projects/' + PROJ + '/annotations.js' : 'annotations.js';
const BOARD_REL = PROJ ? 'Projects/' + PROJ + '/board.js' : 'board.js';
let chDisco = null, annDisco = null, boardSig = null;
async function assinaturaBoard(){
  try {
    const r = await fetch('/' + BOARD_REL.split('/').map(encodeURIComponent).join('/'), { method:'HEAD', cache:'no-store' });
    if (!r.ok) return null;
    return [r.headers.get('etag'), r.headers.get('last-modified'), r.headers.get('content-length')].join('|');
  } catch (e) { return null; }
}
if (HubIO.canPost) (async () => {
  try { chDisco = await HubIO.fetchText(CH_REL); } catch (e) {}
  try { annDisco = await HubIO.fetchText(ANN_REL); } catch (e) {}
  boardSig = await assinaturaBoard();
})();
const SOBRESCREVER = { title:'Salvar', ok:'Sobrescrever', danger:true };
async function falhaSalvar(err, nome, texto){
  if (await HubDialog.confirm('Salvar no servidor falhou: ' + err.message + '\nBaixar o arquivo em vez disso?', { title:'Falha ao salvar', ok:'Baixar' }))
    HubIO.download(nome, texto);
}
function comentariosDoDisco(txt){
  if (!txt) return [];
  const out = [];
  for (const ln of txt.split('\n')) {
    const t = ln.trim();
    if (t.indexOf('//') === 0 && t.indexOf('// AltiumPCBMirror') !== 0 && t.indexOf('// Edite ESTE arquivo') !== 0) out.push(ln.replace(/\r$/, ''));
  }
  return out;
}
async function salvaChanges(quieto){
  if (staleWorkspace && !(await HubDialog.confirm('O workspace mudou desde o carregamento — salvar vai sobrescrever o changes.js do disco. Continuar?', SOBRESCREVER))) return false;
  const out = HC.serializeChanges(CH);
  if (!out.text) {
    /* no autosave nao abre um alerta a cada edicao: o Salvar fica marcado e o rodape diz por que */
    if (quieto) { avisoRodape('⚠ autosave parado: há mudança inválida — Salvar (Ctrl+S) mostra qual'); return false; }
    await HubDialog.alert(out.errors.map(e => '#' + (e.idx + 1) + ' ' + e.msg).join('\n'), { title:'Mudanças inválidas — nada foi gravado' }); return false;
  }
  let atual = null;
  if (HubIO.canPost) {
    try { atual = await HubIO.fetchText(CH_REL); } catch (e) {}
    if (atual !== null && (chDisco === null || atual !== chDisco) &&
        !(await HubDialog.confirm('O changes.js mudou no disco desde o carregamento (outro escritor — a IA?). Sobrescrever mesmo assim?', SOBRESCREVER))) return false;
  }
  const extra = comentariosDoDisco(atual !== null ? atual : chDisco);
  const texto = extra.length ? out.text.replace('var changes = [', extra.join('\n') + '\nvar changes = [') : out.text;
  try {
    const r = await HubIO.saveFile(CH_REL, texto);
    chDisco = texto; staleWorkspace = false; setChDirty(false);
    avisoRodape('');
    if (!quieto) HubDialog.toast(r.mode === 'server' ? 'changes.js salvo (' + CH.length + ' mudança' + (CH.length === 1 ? '' : 's') + ')' : 'arquivo baixado — substitua ' + CH_REL, r.mode === 'server' ? 'ok' : 'warn');
    return true;
  } catch (err) { await falhaSalvar(err, 'changes.js', texto); return false; }
}
async function salvaAnnotations(quieto){
  const out = HC.serializeAnnotations(ANN);
  if (!out.text) { await HubDialog.alert(out.errors.map(e => e.msg).join('\n'), { title:'Sinalizadores inválidos' }); return false; }
  try {
    const r = await HubIO.saveFile(ANN_REL, out.text);
    annDisco = out.text; setAnnDirty(false);
    if (!quieto) HubDialog.toast(r.mode === 'server' ? 'sinalizadores salvos' : 'arquivo baixado — substitua ' + ANN_REL, r.mode === 'server' ? 'ok' : 'warn');
    return true;
  } catch (err) { await falhaSalvar(err, 'annotations.js', out.text); return false; }
}
let salvando = false;
async function salvar(){
  if (salvando || LEAN) return;
  if (!chDirty && !annDirty) { HubDialog.toast('nada a salvar', 'info', 1500); return; }
  salvando = true;
  try {
    if (chDirty) await salvaChanges();
    if (annDirty) await salvaAnnotations();
  } finally { salvando = false; if (painel) painel.atualizaSalvar(); }
}
/* Arquivo » Autosave (hub-autosave.js): ligado, cada edicao grava sozinha logo depois da ultima,
   sem o aviso de "salvo"; com algo na mao (arrasto, trilha sendo desenhada) espera ela acabar */
var AUTOSAVE = typeof HubAutosave !== 'undefined' ? HubAutosave : null;   /* var: setChDirty pode rodar antes desta linha */
function autoSalva(){
  if (!AUTOSAVE || LEAN || !HubIO.canPost || !PROJ) return;
  AUTOSAVE.agenda(salvarAuto);
}
async function salvarAuto(){
  if (LEAN || (!chDirty && !annDirty)) return;
  if (salvando || arrasto || draft) { autoSalva(); return; }
  salvando = true;
  try {
    if (chDirty) await salvaChanges(true);
    if (annDirty) await salvaAnnotations(true);
  } finally { salvando = false; if (painel) painel.atualizaSalvar(); }
}
function alternaAutosave(){
  if (!AUTOSAVE) return;
  const v = AUTOSAVE.alterna();
  HubDialog.toast(v ? 'Autosave ligado: cada mudança já é salva' : 'Autosave desligado: salve com Ctrl+S', 'info', 2200);
  if (v && (chDirty || annDirty)) autoSalva();
  if (painel) painel.atualizaSalvar();
}
if (AUTOSAVE) AUTOSAVE.aoMudar(v => { if (v && (chDirty || annDirty)) autoSalva(); if (painel) painel.atualizaSalvar(); });

/* ============================== o hub (iframe) ============================== */

/* O aviso do hubserver e so um contador: ele chega tambem quando ESTA vista acabou de gravar.
   Recarrega so se o changes.js, o annotations.js ou o board.js do disco nao sao os nossos. */
async function discoMudou(){
  if (!HubIO.canPost) return [];
  const m = [];
  try { const t = await HubIO.fetchText(CH_REL); if (chDisco === null) chDisco = t; else if (t !== chDisco) m.push('changes.js'); } catch (e) {}
  try { const t = await HubIO.fetchText(ANN_REL); if (annDisco === null) annDisco = t; else if (t !== annDisco) m.push('annotations.js'); } catch (e) {}
  const s = await assinaturaBoard();
  if (s !== null) { if (boardSig === null) boardSig = s; else if (s !== boardSig) m.push('board.js'); }
  return m;
}
window.__hubOnChange = function(){
  discoMudou().then(lista => {
    if (!lista.length) return;
    if (!chDirty && !annDirty) { HubDialog.ocioso().then(() => location.reload()); return; }
    staleWorkspace = true;
    avisoRodape('⚠ ' + lista.join(', ') + ' mudou no disco — salve e recarregue (F5)');
    HubDialog.toast(lista.join(', ') + ' mudou no disco com edições pendentes aqui — salve e recarregue (F5).', 'warn', 0);
  });
};
window.__hubDirty = function(){ return chDirty || annDirty; };
let enquadrarPendente = null;
window.__hubSelectComp = function(ref){
  if (!model) return false;
  const m = model.compByRef[ref] || IDX.compNome.get(String(ref));
  if (!m) return false;
  const a = ALVO_COMP.get(m);
  selSo([a], true);
  if (CW && CHH) enquadraAlvos([a]); else enquadrarPendente = [a];
  return true;
};
window.addEventListener('beforeunload', e => { if (chDirty || annDirty) { e.preventDefault(); e.returnValue = ''; } });

/* ============================== divisoria do painel ============================== */

const SIDE_SNAP = 90, SIDE_VIEW_MIN = 260;
function montaDivisoria(){
  const sp = $('splitR'), el = $('props');
  if (!sp || !el) return;
  let larg = 340;
  try { const v = localStorage.getItem('pcbframe.propsW'); if (v !== null && isFinite(+v)) larg = Math.max(0, +v); } catch (e) {}
  const aplica = () => {
    document.documentElement.style.setProperty('--props-w', larg + 'px');
    el.style.display = larg ? '' : 'none';
    const bp = $('btnPaineis'); if (bp) bp.hidden = larg > 0;
  };
  const salva = () => { try { localStorage.setItem('pcbframe.propsW', String(larg)); } catch (e) {} };
  sp.addEventListener('pointerdown', e => {
    const total = $('main').getBoundingClientRect().width;
    const teto = Math.max(SIDE_SNAP, total - SIDE_VIEW_MIN - 12);
    const x0 = e.clientX, w0 = larg;
    sp.classList.add('on'); sp.setPointerCapture(e.pointerId);
    const move = ev => { const w = w0 - (ev.clientX - x0); larg = w < SIDE_SNAP ? 0 : Math.min(w, teto); aplica(); };
    const up = () => { sp.classList.remove('on'); sp.removeEventListener('pointermove', move); sp.removeEventListener('pointerup', up); sp.removeEventListener('pointercancel', up); salva(); };
    sp.addEventListener('pointermove', move); sp.addEventListener('pointerup', up); sp.addEventListener('pointercancel', up);
    e.preventDefault();
  });
  sp.addEventListener('dblclick', () => { larg = larg ? 0 : 340; aplica(); salva(); });
  const bp = $('btnPaineis');
  if (bp) { bp.replaceChildren(HubPcbIcones.icone('paineis')); bp.addEventListener('click', () => { larg = 340; aplica(); salva(); }); }
  aplica();
}

/* ============================== inicio ============================== */

let painel = null;
function liga(){
  /* formularios da pagina */
  const on = (id, ev, fn) => { const x = $(id); if (x) x.addEventListener(ev, fn); };
  on('annok', 'click', gravaAnn);
  on('anncancel', 'click', fechaAnnForm);
  on('anntext', 'keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); gravaAnn(); } });
  on('txtinp', 'keydown', e => { if (e.key === 'Enter') { e.preventDefault(); gravaCaixaTexto(); } });
  on('txtinp', 'blur', () => { if (caixaPonto && $('txtinp').value.trim()) gravaCaixaTexto(); else fechaCaixaTexto(); });
  on('help', 'click', () => toggleAjuda(false));
  on('lsBtn', 'click', e => { const r = e.currentTarget.getBoundingClientRect(); menuLS(r.left, r.top - 8 - 220); });
  on('lsBtn', 'contextmenu', e => { e.preventDefault(); menuLS(e.clientX, e.clientY - 220); });
  const ab = $('abaslista');
  if (ab) {
    ab.addEventListener('click', e => { const b = e.target.closest('.aba'); if (b) setCur(b.dataset.k); });
    ab.addEventListener('contextmenu', e => { const b = e.target.closest('.aba'); if (!b) return; e.preventDefault(); menuCamada(b.dataset.k, e.clientX, e.clientY - 150); });
    ab.addEventListener('wheel', e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { ab.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive:false });
  }
  for (const [id, k] of [['gbNomes', 'nomes']]) on(id, 'change', e => opcaoGerber(k, e.target.value));
  for (const [id, k] of [['gbVazias', 'vazias'], ['gbGto', 'gtoGbo'], ['gbX2', 'x2']]) on(id, 'change', e => opcaoGerber(k, !!e.target.checked));
  const sel = $('gbNomes'); if (sel) sel.value = gerOpc.nomes;
  const ck = (id, v) => { const x = $(id); if (x) x.checked = v; };
  ck('gbVazias', gerOpc.vazias); ck('gbGto', gerOpc.gtoGbo); ck('gbX2', gerOpc.x2);
  /* a tecla trocada nas Configuracoes do hub vale na hora (o hub e a vista dividem o localStorage) */
  window.addEventListener('storage', e => { if (e.key === TECLADO.chave || e.key === null) { ATALHOS = montaMapa(); pintaBarra(); if (painel) painel.atualiza(); } });
  /* o canvas acompanha a divisoria e a janela */
  const ro = new ResizeObserver(() => {
    mede();
    if (CW && CHH && enquadrarPendente) { const p = enquadrarPendente; enquadrarPendente = null; if (p === 'placa') enquadra(); else enquadraAlvos(p); }
    pede();
  });
  ro.observe($('cvwrap'));
  window.addEventListener('resize', () => { mede(); pede(); });
}
function inicia(){
  registraLibHub();
  recalcula();
  if (VIS_SALVA && VIS_SALVA.unica && !LEAN) show.unica = true;
  mede();
  liga();
  if (!LEAN) {
    montaBarra();
    montaFiltroMenu();
    montaCamadasMenu();
    pintaAbas();
    montaDivisoria();
    if (typeof HubPcbAltium !== 'undefined') {
      ALT = HubPcbAltium.instala({
        fazAcao:(id, arg) => fazAcao(id, arg), teclaDe, ctx:ctxAltium, grades:() => GRADES,
        prefs:() => Object.assign(JSON.parse(JSON.stringify(PREFS)), { grade:show.grid, fantasmas:show.ghost, conexoes:conexoesLigadas(), conflito:CFG.conflito }),
        aplicaPrefs, prefsPadrao:PREFS_PADRAO,
        camadas:() => LAYERS.map(l => ({ key:l.key, rot:rotuloAba(l), padrao:l.corPadrao || l.color })),
        toast:(t, tipo, ms) => HubDialog.toast(t, tipo || 'info', ms), fmtDist, parseDist, unidade:() => unidade,
      });
      /* embutida no hub do desktop, os menus sobem para a barra do topo (hub-menubar.js), junto
         com Arquivo/Exibir/Ajuda do app; aberta sozinha, a barra e a dela */
      window.__hubMenus = { vista:'pcb', itens:() => ALT.itensBarra(), popup:(l, x, y) => ALT.popup(l, x, y) };
      let doTopo = false;
      try { doTopo = window.parent !== window && !!window.parent.EletricMenubar; } catch (e) {}
      if (doTopo) { const mb = $('menubar'); if (mb) mb.hidden = true; try { window.parent.EletricMenubar.vistaPronta(window); } catch (e) {} }
      else ALT.barra($('menubar'));
      window.addEventListener('storage', e => { if (e.key === 'altiumhub.lang' && !doTopo) ALT.redesenhaBarra(); });
    }
    if (typeof HubPcbPainel !== 'undefined') painel = HubPcbPainel.instala($('props'), V);
    else { const p = $('props'); if (p) p.textContent = 'O painel (hub-pcbpainel.js) não carregou — atualize a página.'; }
  }
  if (CW && CHH) enquadra(); else enquadrarPendente = 'placa';
  setEdit(false);
  pintaStatus();
  if (painel) painel.atualiza();
  draw();
  if (!LEAN) { if (OPC3D.corpos) agendaSilhuetas(); if (OPC3D.antes) agendaPrepara3d(); }
  /* a aba Gerber so gera depois da biblioteca: antes, o projeto aberto direto no Gerber saia sem os
     componentes do comp_add (os SMD da biblioteca) e com o plano por cima deles (2026-10-28) */
  const lib = carregaLibSePreciso();
  if (MODO === 'gerber' && !LEAN) lib.then(() => abreGerber());
}
/* PLACA QUE NASCEU NO HUB: o changes.js traz comp_add (o ECO feito antes, nesta tela ou pelo MCP)
   cujo footprint so existe na biblioteca -- e a pagina nao carrega o Libs/pcblib.js de inicio (3 MB,
   so o ECO o pedia). Sem ele, ao reabrir o projeto o componente nao aparecia e a validacao acusava
   "footprint nao encontrado" ate alguem abrir o ECO. Aqui a biblioteca (a do Altium e a do hub, que
   passa na frente) vem sozinha quando falta, e a placa e refeita. */
const compsSemFootprint = () => model.changeItems.filter(i => i.ch && i.ch.op === 'comp_add' && i.status === 'err' && /não encontrado/.test(i.msg || ''));
let libPronta = null;
function carregaLibSePreciso(){ return libPronta || (libPronta = carregaLib()); }
async function carregaLib(){
  const falta = () => compsSemFootprint().length > 0;
  if (!falta()) return;
  try {
    await globalDe('pcblib', 'Libs/pcblib.js');
    if (typeof HubFpLib !== 'undefined' && typeof HubFpLib.carrega === 'function') { try { HUBLIB = await HubFpLib.carrega(); } catch (e) { /* sem a do hub */ } }
    if (typeof pcblib !== 'undefined' && typeof HC.setPcbLib === 'function') HC.setPcbLib(pcblib);
    registraLibHub();
    CENA = null; ROTA = null;
    reaplica();
    sujo3d = true;
    if (painel) painel.atualiza();
    pede();
    /* o Gerber que ja estava aberto foi gerado sem esses componentes: refaz */
    if (GV && gerIdx >= 0) regeraGerber(true);
    if (falta()) HubDialog.toast('há componente com footprint que não está na biblioteca (veja Mudanças)', 'warn', 5000);
  } catch (e) { console.warn('biblioteca de footprints:', e); }
}
try { inicia(); }
catch (e) { fatal('A vista PCB não abriu: ' + (e && e.message || e)); throw e; }
/* gancho de teste (o smoke por CDP le e age por aqui): a mesma API que o painel usa, mais o que
   a tela tem de estado. Nao e contrato com o hub -- o hub fala por __hubSelectComp/__hubOnChange. */
window.__hubPcb = Object.assign(Object.create(V), {
  estado:() => ({ tool, editOn, cur, unidade, grade:grade.id, flip:view.flip, unica:show.unica, preencher,
                  sel:SEL.map(chave), ch:CH.length, chDirty, annDirty, view:Object.assign({}, view), draft:draft ? draft.tipo : null,
                  conflito:CFG.conflito, roteador:!!HR && !motorQuebrado }),
  telaDe:(x, y) => mundoParaTela(x, y), mundoDe:(sx, sy) => telaParaMundo(sx, sy),
  setTool, fazAcao, hitsEm:(x, y) => hitsEm(x, y).map(chave),
  snap:(x, y) => snapPonto({ x, y }, null, {}),
  setView(cx, cy, scale){ view.cx = cx; view.cy = cy; if (scale > 0) view.scale = scale; pede(); },
  /* o roteador: a ultima rota calculada (previa ou clique) e o modo de conflito */
  rota:() => ROTA ? ROTA.res : null,
  conflito:() => CFG.conflito,
  setConflito(v){ const ok = setConflito(v); pintaStatus(); if (painel) painel.atualiza(); pede(); return ok; },
  /* o smoke do painel de propriedades (pad, furo, cores): os alvos e as fichas sem clicar na tela */
  alvos:() => [...PORCHAVE.values()], selecionar(lista){ selSo(lista); aoMudarSel(); }, fichaDe, arcoCheio, circuloDePts,
  changes:() => CH, fazAcao, destravar(){ editOn = true; pintaBarra(); },
  historico:() => ({ desfazer:undoStack.length > 1, refazer:redoStack.length > 0 }),
  valida:() => HC.applyPcbChanges(B, CH).changeItems.map(i => ({ op:i.ch.op, status:i.status, msg:i.msg || '' })),
  /* o Auto-rotear: abrir (com o worker ou, worker:null, em fatias), o controle aberto e a prévia na placa */
  autorotear(o){ const x = o || {}; return !!abreAutorotear(x.escopo || 'todas', 'worker' in x ? { worker:x.worker } : null); },
  autoRota:() => { const c = typeof HubPcbAutoRota !== 'undefined' ? HubPcbAutoRota.atual() : null; return c ? c.resumo() : null; },
  previaAuto:() => PREVIA_AUTO ? { tracks:PREVIA_AUTO.tracks.length, vias:PREVIA_AUTO.vias.length } : null,
  /* a regua: as cotas na placa (com o valor resolvido), o agarre num ponto e a medida na mao */
  cotas:() => COTAS.map(c => { const g = geoCota(c); return { id:c.id, modo:g ? g.modo : c.modo, valor:g ? g.valor : null, a:c.a, b:c.b }; }),
  cotasVer:() => show.cotas,
  agarreMedida:(x, y) => snapMedida({ x, y }, null),
  medida:() => medidaAoVivo(),
  sinalizadores:() => ANN.filter(a => a.view === 'pcb').map(a => Object.assign({}, a)),
  poeSinalizador(x, y, msg){ const a = { id:'n' + (ANN.length + 90), view:'pcb', x, y, severity:'info', status:'open', msg:msg || 'teste', created:'' }; ANN.push(a); annChanged(); return a.id; },
});

})();
