/* AltiumPCBMirror v2 - hub-schtemplate-ui.js — o "Document Options" e o editor de TEMPLATE de
   folha na vista Esquema (browser). O motor (desenho, special strings, formato) é o
   hub-schtemplate.js; aqui só mora a interface, no tema da página.

   O QUE A VISTA GANHA
     Configurações › Folha    escolher o template da folha, preencher os campos do carimbo
                              (parâmetros DO DOCUMENTO) e os do projeto; tudo no schematic.js
                              (`template`/`params` no item sheet, `params` no cabeçalho)
     Editor de template       linhas, retângulos, textos, campos (=Parâmetro) e logo, sobre a
                              folha inteira; "Salvar como template da casa" grava em
                              Libs/sch-templates-casa.js pelo /api/save — o mesmo HubIO.saveFile
                              com que a vista grava o schematic.js. Se a rota recusar, avisa e
                              oferece baixar o arquivo.

   A vista passa as alças em `secao(api)` (ver schframe.js » secFolha): schematic, nome e
   índice da folha, item(), medida(), commit(), sujo(), redesenha(), enquadra(), contaFora().
   A última api recebida fica guardada: `abreEditor()` e `abreParametros()` (as teclas que a
   casca registrar) agem na folha ativa. */
(function (root) {
"use strict";
const T = root.HubSchTemplate;
const DLG = () => root.HubDialog;
let api = null;

/* ─── CSS: os tokens do tema (hub-tema.css + a ponte do schframe.html) ─── */
const CSS = `
.st-sec{margin-top:8px; padding-top:8px; border-top:1px solid var(--border);}
.st-sec .st-t{font-size:10px; text-transform:uppercase; letter-spacing:.09em; color:var(--fg-dim); margin-bottom:5px;}
.st-row{display:grid; grid-template-columns:86px minmax(0,1fr); gap:3px 8px; align-items:center; font-size:12px; margin-bottom:3px;}
.st-row .k{color:var(--fg-dim); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.st-row select, .st-row input{width:100%; min-width:0;}
.st-inp{background:transparent; color:var(--fg); border:1px solid transparent; border-radius:3px; padding:2px 4px;
  font:12px var(--font);}
.st-inp:hover{border-color:var(--border);} .st-inp:focus{border-color:var(--accent); outline:none; background:var(--panel2);}
.st-inp::placeholder{color:var(--fg-dim); opacity:.7;}
.st-bts{display:flex; flex-wrap:wrap; gap:4px; margin-top:6px;}
.st-dim{font-size:11px; color:var(--fg-dim);}
.st-ov{position:fixed; inset:0; z-index:60; background:var(--scrim); display:flex; align-items:center; justify-content:center;
  color:var(--fg); font:13px/1.45 var(--font);}
.st-box{background:var(--panel); border:1px solid var(--border); border-radius:8px; box-shadow:var(--shadow-menu);
  display:flex; flex-direction:column; min-height:0;}
.st-ed{width:min(1400px, 96vw); height:min(900px, 94vh);}
.st-pp{width:min(560px, 94vw); max-height:86vh;}
.st-head{display:flex; align-items:center; gap:8px; padding:8px 10px; border-bottom:1px solid var(--border);}
.st-head h2{font-size:13px; font-weight:600; margin-right:4px;}
.st-head .sp{flex:1;}
.st-body{flex:1; display:flex; min-height:0;}
.st-tools{display:flex; flex-direction:column; gap:3px; padding:6px; border-right:1px solid var(--border);}
.st-tools button{text-align:left; min-width:92px;}
.st-tools button[aria-pressed="true"]{background:var(--hi); color:var(--on-hi); border-color:var(--hi);}
.st-cvw{flex:1; position:relative; min-width:0; background:var(--bg);}
.st-cvw canvas{position:absolute; inset:0; width:100%; height:100%;}
.st-side{width:270px; overflow:auto; padding:8px 10px; border-left:1px solid var(--border);}
.st-side h3{font-size:10px; text-transform:uppercase; letter-spacing:.09em; color:var(--fg-dim); margin:8px 0 5px;}
.st-side .st-row{grid-template-columns:72px minmax(0,1fr);}
.st-side input, .st-side select{background:var(--panel2); color:var(--fg); border:1px solid var(--border); border-radius:3px;
  padding:2px 4px; font:12px var(--font);}
.st-side input[type=checkbox]{width:auto;}
.st-list{overflow:auto; padding:8px 10px;}
.st-kvl{display:grid; grid-template-columns:1fr 1.4fr auto; gap:4px; align-items:center;}
.st-kvl input{background:var(--panel2); color:var(--fg); border:1px solid var(--border); border-radius:3px; padding:3px 5px;
  font:12px var(--font); min-width:0;}
.st-foot{display:flex; justify-content:flex-end; gap:6px; padding:8px 10px; border-top:1px solid var(--border);}
`;
function css(){
  if (typeof document === 'undefined' || document.getElementById('st-css')) return;
  const s = document.createElement('style'); s.id = 'st-css'; s.textContent = CSS; document.head.append(s);
}
function el(tag, cls, text){ const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function botao(txt, titulo, fn){ const b = el('button', null, txt); if (titulo) b.title = titulo; b.type = 'button'; b.addEventListener('click', fn); return b; }
function linha(box, k, node){ const r = el('div', 'st-row'); const kk = el('span', 'k', k); kk.title = k; r.append(kk, node); box.append(r); return r; }
const ROTULO_ORIGEM = { casa:'Casa', altium:'Altium', 'altium-legado':'Altium legado (2014)' };

/* ─── o acervo da casa (Libs/sch-templates-casa.js) ─── */
function casa(){
  if (!root.schtemplatesCasa || !root.schtemplatesCasa.templates)
    root.schtemplatesCasa = { format:'schtemplate-v1', title:'Templates de folha da casa', templates:{} };
  return root.schtemplatesCasa;
}
async function gravaCasa(){
  const texto = T.serializaCasa(casa().templates);
  const io = root.HubIO;
  if (!io){ DLG().toast('sem HubIO: o template ficou só nesta aba', 'warn', 6000); return false; }
  try {
    const r = await io.saveFile(T.ARQ_CASA, texto);
    if (r.mode === 'server'){ DLG().toast('template salvo em ' + T.ARQ_CASA, 'ok'); return true; }
    DLG().toast('arquivo baixado — substitua ' + T.ARQ_CASA, 'warn', 7000);
    return true;
  } catch (err) {
    /* a rota pode ainda não aceitar este arquivo: o template continua valendo nesta aba, e o
       arquivo pode ser baixado e posto no lugar à mão */
    if (await DLG().confirm('O servidor recusou gravar ' + T.ARQ_CASA + ': ' + err.message
        + '\nO template continua valendo nesta aba. Baixar o arquivo para pôr no lugar à mão?',
        { title:'Template não gravado', ok:'Baixar' }))
      io.download('sch-templates-casa.js', texto);
    return false;
  }
}

/* ─── Configurações › Folha: template + campos ─── */
function secao(a){
  css();
  api = a;
  const box = el('div', 'st-sec');
  box.append(el('div', 'st-t', 'Template'));
  const it = a.item ? (a.schematic.items.find(i => i && i.t === 'sheet' && i.name === a.nome) || null) : null;
  const atual = it && it.template ? it.template : '';
  const tpl = atual ? T.acha(atual) : null;

  const sel = el('select');
  sel.title = 'o template da folha: moldura, zonas e carimbo (o .SchDot do Altium)';
  const o0 = el('option', null, '— sem template —'); o0.value = ''; sel.append(o0);
  const grupos = {};
  for (const t of T.lista()){
    const g = grupos[t.origem] || (grupos[t.origem] = (() => { const x = document.createElement('optgroup');
      x.label = ROTULO_ORIGEM[t.origem] || t.origem; sel.append(x); return x; })());
    const o = el('option', null, t.nome + (t.interno ? '' : ' · ' + Math.round(t.folha.w) + '×' + Math.round(t.folha.h)));
    o.value = t.id; g.append(o);
  }
  if (atual && !tpl){
    /* template que este acervo não tem (outro computador, arquivo da casa não carregado): o
       nome fica à vista em vez de o seletor fingir "sem template" */
    const o = el('option', null, atual + ' (não encontrado)'); o.value = atual; sel.append(o);
  }
  sel.value = atual;
  sel.addEventListener('change', () => escolhe(sel.value));
  linha(box, 'template', sel);

  if (tpl){
    const doc = T.parseParams(it.params);
    const ctx = T.contexto({ tpl, doc:{}, proj:a.schematic.params, folhaN:a.indice + 1, folhaTotal:a.total,
                             documento:a.nome + '.SchDoc', projeto:a.schematic.project });
    let nomes = T.campos(tpl);
    if (!nomes.length) nomes = T.CAMPOS_PADRAO.slice();
    for (const n of nomes){
      const inp = el('input', 'st-inp');
      inp.value = doc[n] != null ? doc[n] : '';
      const herdado = T.valor(n, ctx);
      inp.placeholder = herdado != null && herdado !== '' ? herdado : '—';
      inp.title = '=' + n + ' — vazio usa o do projeto/template (' + (herdado || 'nada') + ')';
      inp.addEventListener('change', () => mudaParam(n, inp.value));
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
      linha(box, n.replace(/_DiEletrons$/, ''), inp);
    }
  }
  const bts = el('div', 'st-bts');
  bts.append(botao('Projeto…', 'parâmetros do PROJETO (valem para todas as folhas)', () => abreParametros()));
  bts.append(botao(tpl && tpl.origem === 'casa' ? 'Editar template…' : 'Editar cópia…',
                   'abrir o editor de template' + (tpl ? '' : ' (um novo, em branco)'), () => abreEditor()));
  bts.append(botao('Novo…', 'criar um template da casa em branco', () => abreEditor({ novo:true })));
  box.append(bts);
  return box;
}
function itemDaFolha(){ return api.item(); }
function escolhe(id){
  const it = itemDaFolha();
  const tpl = id ? T.acha(id) : null;
  if (id && !tpl) return;
  const nova = T.aplica(it, tpl, root.HubCore && root.HubCore.sheetMatch);
  api.commit();
  if (nova){
    api.enquadra();
    const fora = api.contaFora ? api.contaFora(nova) : 0;
    if (fora) DLG().toast(tpl.nome + ' · ' + fora + (fora > 1 ? ' itens ficaram' : ' item ficou') + ' fora da página', 'warn', 5000);
  }
  if (tpl) DLG().toast('template ' + tpl.nome, 'ok');
}
function mudaParam(nome, v){
  const it = itemDaFolha();
  const p = T.parseParams(it.params);
  if (v === '') delete p[nome]; else p[nome] = v;
  const s = T.serializaParams(p);
  if (s) it.params = s; else delete it.params;
  api.commit();
}

/* ─── parâmetros do projeto (cabeçalho do schematic.js) ─── */
function abreParametros(){
  if (!api) return;
  css();
  const sch = api.schematic;
  const p = T.parseParams(sch.params);
  /* sugestões: os campos que o template da folha usa e ainda não têm valor no projeto */
  const it = itemDaFolha();
  const tpl = it && it.template ? T.acha(it.template) : null;
  const linhas = Object.keys(p).map(k => [k, p[k]]);
  for (const n of (tpl ? T.campos(tpl) : T.CAMPOS_PADRAO)) if (!(n in p) && !/^Sheet(Number|Total)$/i.test(n)) linhas.push([n, '']);

  const ov = el('div', 'st-ov');
  const bx = el('div', 'st-box st-pp');
  const hd = el('div', 'st-head'); hd.append(el('h2', null, 'Parâmetros do projeto'), el('span', 'st-dim', 'valem para todas as folhas; a folha pode sobrescrever'));
  const lista = el('div', 'st-list');
  const grade = el('div', 'st-kvl');
  const campos = [];
  const add = (k, v) => {
    const ik = el('input'); ik.value = k; ik.placeholder = 'Nome';
    const iv = el('input'); iv.value = v; iv.placeholder = 'valor';
    const x = botao('✕', 'remover', () => { ik.remove(); iv.remove(); x.remove(); campos.splice(campos.indexOf(par), 1); });
    const par = [ik, iv];
    campos.push(par); grade.append(ik, iv, x);
  };
  linhas.forEach(([k, v]) => add(k, v));
  lista.append(grade);
  const ft = el('div', 'st-foot');
  const fecha = () => { ov.remove(); document.removeEventListener('keydown', esc, true); };
  const esc = e => { if (e.key === 'Escape'){ e.stopPropagation(); fecha(); } };
  ft.append(botao('+ parâmetro', null, () => add('', '')), el('span', 'sp'),
    botao('Cancelar', null, fecha),
    botao('Aplicar', 'grava no cabeçalho do schematic.js (Salvar para ir ao disco)', () => {
      const o = {};
      for (const [ik, iv] of campos) if (ik.value.trim() && iv.value !== '') o[ik.value.trim()] = iv.value;
      const s = T.serializaParams(o);
      if (s) sch.params = s; else delete sch.params;
      /* o cabeçalho não entra no desfazer (ele guarda só os itens): marca sujo e redesenha */
      api.sujo(); api.redesenha();
      fecha();
      DLG().toast('parâmetros do projeto aplicados', 'ok');
    }));
  ft.querySelector('.sp').style.flex = '1';
  bx.append(hd, lista, ft); ov.append(bx); document.body.append(ov);
  document.addEventListener('keydown', esc, true);
  ov.addEventListener('mousedown', e => { if (e.target === ov) fecha(); });
}

/* ─── o editor de template ─── */
const FERRAMENTAS = [['sel', 'Selecionar', 'selecionar e arrastar (Del apaga)'], ['line', 'Linha', 'arraste para traçar'],
  ['rect', 'Retângulo', 'arraste para traçar'], ['text', 'Texto', 'clique para pousar um texto fixo'],
  ['campo', 'Campo', 'clique para pousar um campo (=Parâmetro), preenchido pela folha'],
  ['logo', 'Logo…', 'escolher uma imagem e pousar']];
const JUSTS = ['embaixo-esq', 'embaixo-centro', 'embaixo-dir', 'meio-esq', 'centro', 'meio-dir', 'em cima-esq', 'em cima-centro', 'em cima-dir'];
const PASSO = 10;   /* mil: o encaixe do editor — carimbo pede ajuste fino */
const enc = v => Math.round(v / PASSO) * PASSO;

function abreEditor(o){
  o = o || {};
  if (!root.HubDraw){ DLG().toast('o editor precisa do hub-draw.js', 'err'); return; }
  css();
  const it = api ? itemDaFolha() : null;
  const base = !o.novo && it && it.template ? T.acha(it.template) : null;
  const existentes = Object.assign({}, T.acervo());
  /* template da casa edita no lugar; o do Altium (ou nenhum) vira cópia nova */
  let tpl;
  if (base && base.origem === 'casa') tpl = JSON.parse(JSON.stringify(base));
  else if (base) tpl = T.copia(base, base.nome.replace(/ \(Altium, sem template\)$/, '') + ' (casa)', existentes);
  else {
    const med = api ? api.medida() : [11692.913, 8267.717];
    tpl = T.copia({ folha:{ estilo:'Custom', w:med[0], h:med[1], margem:200, zonasX:6, zonasY:4, zonas:true, estiloZona:0,
                            borda:true, carimbo:false, estiloCarimbo:'standard', fonteSistema:1, cor:'#000000', area:'#fffcf8' },
                    fontes:{ '1':{ nome:'Times New Roman', tam:10 } }, params:{}, itens:[] }, 'Novo template', existentes);
  }
  let selI = -1, ferramenta = 'sel', arrasto = null, fantasma = null, sujo = false;

  const ov = el('div', 'st-ov');
  const bx = el('div', 'st-box st-ed');
  const hd = el('div', 'st-head');
  const nome = el('input'); nome.value = tpl.nome; nome.title = 'o nome do template';
  nome.style.cssText = 'background:var(--panel2);color:var(--fg);border:1px solid var(--border);border-radius:3px;padding:3px 6px;font:12px var(--font);width:260px';
  nome.addEventListener('input', () => { tpl.nome = nome.value; sujo = true; });
  const sp = el('span', 'sp');
  hd.append(el('h2', null, 'Template de folha'), nome, el('span', 'st-dim', tpl.id), sp);
  const corpo = el('div', 'st-body');
  const tools = el('div', 'st-tools');
  const cvw = el('div', 'st-cvw'); const cv = el('canvas'); cvw.append(cv);
  const side = el('div', 'st-side');
  corpo.append(tools, cvw, side);
  bx.append(hd, corpo); ov.append(bx); document.body.append(ov);

  const arquivo = el('input'); arquivo.type = 'file'; arquivo.accept = 'image/*'; arquivo.style.display = 'none'; ov.append(arquivo);
  const botoesF = {};
  for (const [k, rot, dica] of FERRAMENTAS){
    const b = botao(rot, dica, () => { if (k === 'logo') arquivo.click(); else poe(k); });
    b.setAttribute('aria-pressed', String(k === ferramenta));
    botoesF[k] = b; tools.append(b);
  }
  function poe(k){ ferramenta = k; fantasma = null; for (const x of Object.keys(botoesF)) botoesF[x].setAttribute('aria-pressed', String(x === k)); }

  const fechar = async () => {
    if (sujo && !(await DLG().confirm('Descartar as mudanças neste template?', { title:'Fechar o editor', ok:'Descartar', danger:true }))) return;
    ov.remove(); document.removeEventListener('keydown', tecla, true);
  };
  const salvar = async () => {
    tpl.nome = (nome.value || '').trim() || 'Template';
    /* renomear cria id novo só para template NOVO; editar um da casa mantém o id (as folhas
       que o usam continuam apontando para ele) */
    const ct = casa().templates;
    tpl.origem = 'casa';
    ct[tpl.id] = tpl;
    const ok = await gravaCasa();
    sujo = false;
    if (api){
      const it2 = itemDaFolha();
      if (it2 && it2.template !== tpl.id &&
          await DLG().confirm('Usar “' + tpl.nome + '” nesta folha agora?', { title:'Template salvo', ok:'Usar' })) escolhe(tpl.id);
      else api.redesenha();
    }
    if (ok) { ov.remove(); document.removeEventListener('keydown', tecla, true); }
  };
  hd.append(botao('Salvar como template da casa', 'grava em ' + T.ARQ_CASA, salvar), botao('Fechar', 'Esc', fechar));

  const D = root.HubDraw;
  const cam = D.mkCamera(cv, drawWorld, { bg:getComputedStyle(document.body).getPropertyValue('--bg') || '#222',
    onDragStart, onDrag, onDragEnd, onClick, onMove });
  function drawWorld(ctx, c){
    const f = tpl.folha;
    ctx.fillStyle = '#fffef2'; ctx.fillRect(0, 0, f.w, f.h);
    T.desenha(ctx, tpl, [f.w, f.h], { cru:true }, { esc:c.scale, aoChegarImagem:() => cam.draw() });
    const px = 1 / c.scale;
    if (selI >= 0 && tpl.itens[selI]){
      const b = T.caixaItem(tpl.itens[selI], tpl);
      ctx.save(); ctx.setLineDash([6 * px, 4 * px]); ctx.strokeStyle = '#2979ff'; ctx.lineWidth = 1.5 * px;
      ctx.strokeRect(b.x1 - 4 * px, b.y1 - 4 * px, b.x2 - b.x1 + 8 * px, b.y2 - b.y1 + 8 * px); ctx.restore();
    }
    if (fantasma){
      ctx.save(); ctx.strokeStyle = '#2979ff'; ctx.lineWidth = 10;
      if (fantasma.g === 'line'){ ctx.beginPath(); ctx.moveTo(fantasma.x1, fantasma.y1); ctx.lineTo(fantasma.x2, fantasma.y2); ctx.stroke(); }
      else ctx.strokeRect(Math.min(fantasma.x1, fantasma.x2), Math.min(fantasma.y1, fantasma.y2),
                          Math.abs(fantasma.x2 - fantasma.x1), Math.abs(fantasma.y2 - fantasma.y1));
      ctx.restore();
    }
  }
  function acerta(p){
    const tol = 8 / cam.cam.scale;
    for (let i = tpl.itens.length - 1; i >= 0; i--){
      const b = T.caixaItem(tpl.itens[i], tpl);
      if (p.x >= b.x1 - tol && p.x <= b.x2 + tol && p.y >= b.y1 - tol && p.y <= b.y2 + tol) return i;
    }
    return -1;
  }
  function onDragStart(p){
    if (ferramenta === 'line' || ferramenta === 'rect'){
      fantasma = { g:ferramenta, x1:enc(p.x), y1:enc(p.y), x2:enc(p.x), y2:enc(p.y) }; return true;
    }
    if (ferramenta !== 'sel') return false;
    const i = acerta(p);
    if (i < 0) return false;
    selI = i; arrasto = { x:enc(p.x), y:enc(p.y) }; ficha(); cam.draw();
    return true;
  }
  function onDrag(p){
    if (fantasma){ fantasma.x2 = enc(p.x); fantasma.y2 = enc(p.y); cam.draw(); return; }
    if (!arrasto || selI < 0) return;
    const x = enc(p.x), y = enc(p.y);
    if (x === arrasto.x && y === arrasto.y) return;
    T.moveItem(tpl.itens[selI], x - arrasto.x, y - arrasto.y);
    arrasto = { x, y }; sujo = true; cam.draw();
  }
  function onDragEnd(){
    if (fantasma){
      if (fantasma.x1 !== fantasma.x2 || fantasma.y1 !== fantasma.y2){
        const n = fantasma.g === 'line'
          ? { g:'line', x1:fantasma.x1, y1:fantasma.y1, x2:fantasma.x2, y2:fantasma.y2, w:10, color:'#000000' }
          : { g:'rect', x1:Math.min(fantasma.x1, fantasma.x2), y1:Math.min(fantasma.y1, fantasma.y2),
              x2:Math.max(fantasma.x1, fantasma.x2), y2:Math.max(fantasma.y1, fantasma.y2), solid:false, w:10, color:'#000000' };
        tpl.itens.push(n); selI = tpl.itens.length - 1; sujo = true;
      }
      fantasma = null; ficha(); cam.draw();
    }
    arrasto = null; ficha();
  }
  function onClick(p){
    if (ferramenta === 'text' || ferramenta === 'campo'){
      const campo = ferramenta === 'campo';
      tpl.itens.push({ g:'text', x:enc(p.x), y:enc(p.y), s:campo ? '=Title' : 'TEXTO', fonte:T.fonteId(tpl, campo ? 12 : 10),
                       just:3, color:'#000000' });
      selI = tpl.itens.length - 1; sujo = true; poe('sel'); ficha(true); cam.draw();
      return;
    }
    if (ferramenta === 'sel'){ selI = acerta(p); ficha(); cam.draw(); }
  }
  function onMove(){}
  arquivo.addEventListener('change', () => {
    const f = arquivo.files && arquivo.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      const src = String(rd.result);
      const im = new Image();
      im.onload = () => {
        /* pousa no canto inferior-direito, 1500 mil de largura, na proporção da imagem */
        const w = 1500, h = Math.round(w * im.naturalHeight / Math.max(1, im.naturalWidth));
        const fo = tpl.folha, m = fo.zonas ? fo.margem || 0 : 0;
        tpl.itens.push({ g:'image', x1:enc(fo.w - m - w - 100), y1:enc(m + 100), x2:enc(fo.w - m - 100), y2:enc(m + 100 + h),
                         aspecto:true, arquivo:f.name, src });
        selI = tpl.itens.length - 1; sujo = true; poe('sel'); ficha(); cam.draw();
      };
      im.src = src;
    };
    rd.readAsDataURL(f);
    arquivo.value = '';
  });
  function tecla(e){
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); if (ferramenta !== 'sel') poe('sel'); else fechar(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selI >= 0){ e.preventDefault(); e.stopPropagation(); apaga(); }
  }
  document.addEventListener('keydown', tecla, true);
  function apaga(){ tpl.itens.splice(selI, 1); selI = -1; sujo = true; ficha(); cam.draw(); }

  /* ── a ficha do lado: o item selecionado, ou a folha do template ── */
  function num(v, fn){ const i = el('input'); i.type = 'number'; i.step = String(PASSO); i.value = String(Math.round(v * 1000) / 1000);
    i.addEventListener('change', () => { const n = parseFloat(i.value); if (isFinite(n)){ fn(n); sujo = true; cam.draw(); } }); return i; }
  function texto(v, fn){ const i = el('input'); i.value = v == null ? '' : String(v);
    i.addEventListener('input', () => { fn(i.value); sujo = true; cam.draw(); }); return i; }
  function caixa(v, fn){ const i = el('input'); i.type = 'checkbox'; i.checked = !!v; i.addEventListener('change', () => { fn(i.checked); sujo = true; cam.draw(); }); return i; }
  function escolha(ops, v, fn){ const s = el('select'); for (const [val, t] of ops){ const o = el('option', null, t); o.value = String(val); s.append(o); }
    s.value = String(v); s.addEventListener('change', () => { fn(s.value); sujo = true; cam.draw(); ficha(); }); return s; }
  function cor(v, fn){ const i = el('input'); i.type = 'color'; i.value = v || '#000000'; i.addEventListener('input', () => { fn(i.value); sujo = true; cam.draw(); }); return i; }
  function ficha(foca){
    side.textContent = '';
    const x = selI >= 0 ? tpl.itens[selI] : null;
    if (!x){
      const f = tpl.folha;
      side.append(el('h3', null, 'Folha do template'));
      const pres = (root.HubCore && root.HubCore.SHEET_PRESETS) || [];
      linha(side, 'formato', escolha([['', 'Custom']].concat(pres.map(p => [p.id, p.name + ' ' + (p.fam === 'iso' ? 'ISO' : 'legado')])), '', v => {
        const m = v && root.HubCore.sheetPreset(v, f.h > f.w);
        if (m){ f.w = m[0]; f.h = m[1]; const p = pres.find(q => q.id === v); f.estilo = p ? p.name : 'Custom'; cam.fit({ x1:0, y1:0, x2:f.w, y2:f.h }); }
      }));
      linha(side, 'largura', num(f.w, v => { f.w = v; f.estilo = 'Custom'; }));
      linha(side, 'altura', num(f.h, v => { f.h = v; f.estilo = 'Custom'; }));
      linha(side, 'moldura', caixa(f.borda, v => { f.borda = v; }));
      linha(side, 'zonas', caixa(f.zonas !== false, v => { f.zonas = v; }));
      linha(side, 'zonas X', num(f.zonasX || 0, v => { f.zonasX = Math.max(0, Math.round(v)); }));
      linha(side, 'zonas Y', num(f.zonasY || 0, v => { f.zonasY = Math.max(0, Math.round(v)); }));
      linha(side, 'margem', num(f.margem || 0, v => { f.margem = v; }));
      linha(side, 'carimbo Altium', escolha([['', 'nenhum'], ['standard', 'Standard'], ['ansi', 'ANSI']],
        f.carimbo ? f.estiloCarimbo : '', v => { f.carimbo = !!v; if (v) f.estiloCarimbo = v; }));
      side.append(el('h3', null, 'Valores padrão dos campos'));
      const pd = el('div', 'st-dim'); pd.textContent = 'o que o campo mostra quando nem a folha nem o projeto preenchem';
      side.append(pd);
      for (const n of T.campos(tpl)){
        linha(side, n, texto((tpl.params || {})[n], v => { tpl.params = tpl.params || {}; if (v === '') delete tpl.params[n]; else tpl.params[n] = v; }));
      }
      const dica = el('p', 'st-dim'); dica.style.marginTop = '10px';
      dica.textContent = 'Clique num item para editá-lo. Arraste com o botão do meio ou em área vazia para mover a vista; a roda amplia.';
      side.append(dica);
      return;
    }
    const tipo = { line:'Linha', polyline:'Linha', rect:'Retângulo', text:(String(x.s).charAt(0) === '=' ? 'Campo' : 'Texto'),
                   image:'Imagem', frame:'Quadro de texto', poly:'Polígono', arc:'Arco', ellipse:'Elipse' }[x.g] || x.g;
    side.append(el('h3', null, tipo));
    if (x.g === 'text'){
      const campo = String(x.s).charAt(0) === '=';
      if (campo){
        const nomes = Array.from(new Set(T.CAMPOS_PADRAO.concat(T.campos(tpl), ['Desenhista_DiEletrons', 'Verificador_DiEletrons',
          'Aprovador_DiEletrons', 'Equipamento_linha_um', 'Equipamento_linha_dois', 'Revisao', 'Escala', 'Arquivo',
          'Data_desenho', 'Data_verificacao', 'Data_aprovacao', 'CurrentDate', 'DocumentName', 'ProjectName'])));
        const lista = 'st-campos-' + Math.random().toString(36).slice(2, 7);
        const dl = el('datalist'); dl.id = lista; for (const n of nomes){ const o = el('option'); o.value = n; dl.append(o); }
        const i = texto(String(x.s).slice(1), v => { x.s = '=' + v.trim(); });
        i.setAttribute('list', lista);
        side.append(dl); linha(side, 'parâmetro', i);
        if (foca) setTimeout(() => i.select(), 0);
      } else {
        const i = texto(x.s, v => { x.s = v; });
        linha(side, 'texto', i);
        if (foca) setTimeout(() => i.select(), 0);
      }
      linha(side, 'x', num(x.x, v => { x.x = v; }));
      linha(side, 'y', num(x.y, v => { x.y = v; }));
      const ft = (tpl.fontes || {})[String(x.fonte)] || { nome:'Times New Roman', tam:10 };
      linha(side, 'tamanho', num(ft.tam, v => { x.fonte = T.fonteId(tpl, Math.max(1, Math.round(v)), ft.nome, ft.negrito); }));
      linha(side, 'fonte', escolha([['Times New Roman', 'Times New Roman'], ['Arial', 'Arial'], ['Arial Narrow', 'Arial Narrow']],
        ft.nome, v => { x.fonte = T.fonteId(tpl, ft.tam, v, ft.negrito); }));
      linha(side, 'negrito', caixa(ft.negrito, v => { x.fonte = T.fonteId(tpl, ft.tam, ft.nome, v); }));
      linha(side, 'âncora', escolha(JUSTS.map((t, i) => [i, t]), x.just || 0, v => { x.just = Number(v) || 0; if (!x.just) delete x.just; }));
      linha(side, 'rotação', escolha([[0, '0°'], [90, '90°'], [180, '180°'], [270, '270°']], x.rot || 0, v => { x.rot = Number(v); if (!x.rot) delete x.rot; }));
      linha(side, 'cor', cor(x.color, v => { x.color = v; }));
    } else if (x.g === 'line' || x.g === 'rect' || x.g === 'image' || x.g === 'frame'){
      for (const k of ['x1', 'y1', 'x2', 'y2']) linha(side, k, num(x[k], v => { x[k] = v; }));
      if (x.g !== 'image'){
        linha(side, 'espessura', escolha([[4, 'mínima'], [10, 'fina'], [20, 'média'], [30, 'grossa']], x.w || 4, v => { x.w = Number(v); }));
        linha(side, 'cor', cor(x.color, v => { x.color = v; }));
      }
      if (x.g === 'rect'){
        linha(side, 'preenchido', caixa(x.solid, v => { x.solid = v; if (v && !x.fill) x.fill = '#ffffff'; }));
        if (x.solid) linha(side, 'fundo', cor(x.fill, v => { x.fill = v; }));
      }
      if (x.g === 'image') linha(side, 'proporção', caixa(x.aspecto, v => { x.aspecto = v; }));
    } else {
      side.append(el('p', 'st-dim', 'Este item veio do Altium: dá para mover e apagar; a forma não se edita aqui.'));
    }
    const bts = el('div', 'st-bts');
    bts.append(botao('Duplicar', null, () => { const c = T.moveItem(JSON.parse(JSON.stringify(x)), 100, -100); tpl.itens.push(c); selI = tpl.itens.length - 1; sujo = true; ficha(); cam.draw(); }),
               botao('Apagar', 'Del', apaga));
    side.append(bts);
  }
  ficha();
  requestAnimationFrame(() => { cam.resize(); cam.fit({ x1:0, y1:0, x2:tpl.folha.w, y2:tpl.folha.h }, 1.05); });
}

root.HubSchTemplateUI = { secao, abreEditor: o => abreEditor(o), abreParametros, escolhe: id => api && escolhe(id) };
})(typeof self !== 'undefined' ? self : this);
