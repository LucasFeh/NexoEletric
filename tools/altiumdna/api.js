/* ══ A CONSULTA ══
   (este trecho vem de tools/altiumdna/api.js e o extrator o cola no fim do hub-altiumdna.js) */

const EDITORES = ['pcb', 'sch'];
const _idx = {};
/* os índices nascem na primeira consulta, não na carga: a vista que não pergunta nada não paga */
function idx(ed){
  if (_idx[ed]) return _idx[ed];
  const d = DADOS[ed];
  if (!d) throw new Error('HubAltiumDNA: editor desconhecido "' + ed + '" (pcb ou sch)');
  const cmd = new Map(), seq = new Map(), acel = new Map(), tec = new Map(), cam = new Map();
  for (const c of d.comandos) cmd.set(c[0], c);
  for (const [s, id] of d.aceleradores){
    seq.set(s, id);
    const a = acel.get(id);
    if (!a || s.length < a.length) acel.set(id, s);
  }
  for (const [t, id] of d.teclas){
    const k = teclaHub(t);
    if (!tec.has(k)) tec.set(k, []);
    tec.get(k).push(id);
  }
  /* o caminho: o menu principal primeiro (é o que a pessoa procura), os popups se só lá */
  for (const nome of ['principal', 'popups']){
    (function anda(nos, pilha){
      for (const n of nos){
        if (n === '-') continue;
        if (typeof n === 'string'){ if (!cam.has(n)) cam.set(n, pilha.concat(rotuloDe(cmd, n))); continue; }
        if (n[0] === '~') continue;
        if (n.length === 2){ if (!cam.has(n[0])) cam.set(n[0], pilha.concat(n[1])); continue; }
        anda(n[2], pilha.concat(n[0]));
      }
    })(d.menus[nome] || [], []);
  }
  return (_idx[ed] = { d, cmd, seq, acel, tec, cam });
}
function rotuloDe(cmd, id){ const c = cmd.get(id); return (c && c[3]) || id.replace(/^PL[^:]*:/, ''); }
/* desfaz a compactação do extrator ('=' e campos do fim omitidos) */
function objeto(c){
  if (!c) return null;
  const f = i => c[i] || '';
  return { plid:c[0], comando:f(1) === '=' ? c[0].replace(/^PL/, '') : f(1), params:f(2), rotulo:f(3),
           tecla1:f(4), tecla2:f(5), descricao:f(6) === '=' ? f(3) : f(6) };
}

function comando(ed, plid){ return objeto(idx(ed).cmd.get(plid)); }
function caminho(ed, plid){ const c = idx(ed).cam.get(plid); return c ? c.slice() : []; }
function acelerador(ed, plid){ return idx(ed).acel.get(plid) || ''; }
/* aceita 'P,T', 'p, t' ou ['P','T'] */
function porSequencia(ed, s){
  const k = (Array.isArray(s) ? s : String(s || '').split(',')).map(x => String(x).trim().toUpperCase()).filter(Boolean).join(',');
  const id = idx(ed).seq.get(k);
  return id ? (comando(ed, id) || { plid:id, comando:'', params:'', rotulo:id, tecla1:'', tecla2:'', descricao:'' }) : null;
}
function teclas(ed, plid){ const c = idx(ed).cmd.get(plid); return c ? [c[4], c[5]].filter(Boolean) : []; }
function porTecla(ed, tecla){ return (idx(ed).tec.get(teclaHub(tecla)) || []).map(id => comando(ed, id)).filter(Boolean); }
function busca(ed, texto){
  const q = String(texto || '').toLowerCase();
  if (!q) return [];
  return idx(ed).d.comandos.map(objeto).filter(o => (o.rotulo + ' ' + o.comando + ' ' + o.descricao).toLowerCase().includes(q));
}
/* a árvore de um menu, resolvida: {rotulo, plid, popup, filhos, separador, dinamico, acelerador} */
function menu(ed, nome){
  const I = idx(ed);
  const conv = n => {
    if (n === '-') return { separador:true };
    if (typeof n === 'string') return { rotulo:rotuloDe(I.cmd, n), plid:n, acelerador:I.acel.get(n) || '', teclas:teclas(ed, n) };
    if (n[0] === '~') return { rotulo:n[1], dinamico:true };
    if (n.length === 2) return { rotulo:n[1], plid:n[0], acelerador:I.acel.get(n[0]) || '', teclas:[] };
    return { rotulo:n[0], popup:n[1], acelerador:n[3] || '', filhos:n[2].map(conv) };
  };
  return (I.d.menus[nome || 'principal'] || []).map(conv);
}

/* A tecla do Altium escrita como o HubAtalhos.normalizaTecla a escreve: Ctrl, Alt, Shift, tecla;
   PgUp -> PageUp, Left -> ArrowLeft, Multiply -> *, Space -> Espaço. O Shift numa tecla de UM
   caractere só fica com Ctrl ou Alt junto (Shift+S do Altium sai 'S': a mão não distingue, e o
   navegador já manda a letra maiúscula). Aceita também a escrita do hub ('Ctrl+Shift+L'). */
const NOME_TECLA = { PgUp:'PageUp', PgDn:'PageDown', Left:'ArrowLeft', Right:'ArrowRight', Up:'ArrowUp',
  Down:'ArrowDown', Multiply:'*', Plus:'+', Add:'+', Minus:'-', Subtract:'-', Divide:'/', Space:'Espaço',
  Del:'Delete', Ins:'Insert', Esc:'Escape', BkSp:'Backspace', Return:'Enter' };
function teclaHub(alt){
  if (!alt) return '';
  const s = String(alt);
  const p = s.split('+').map(x => x.trim()).filter(Boolean);
  if (s.endsWith('++') || s === '+') p.push('+');
  const k0 = p.pop();
  const mods = new Set(p.map(x => x.toLowerCase()));
  let k = NOME_TECLA[k0] || k0;
  if (k.length === 1) k = k.toUpperCase();
  const m = [];
  if (mods.has('ctrl')) m.push('Ctrl');
  if (mods.has('alt')) m.push('Alt');
  if (mods.has('shift') && ((k.length > 1 && k !== 'Espaço') || m.length)) m.push('Shift');
  m.push(k);
  return m.join('+');
}

function contagens(){
  const o = {};
  for (const ed of EDITORES){
    const d = DADOS[ed];
    o[ed] = { comandos:d.comandos.length, teclas:d.teclas.length, aceleradores:d.aceleradores.length,
              menus:d.menus.principal.filter(Array.isArray).map(n => n[0]) };
  }
  return o;
}

return { VERSAO, EDITORES, DADOS, comando, caminho, acelerador, porSequencia, teclas, porTecla, teclaHub,
         busca, menu, contagens };
});
