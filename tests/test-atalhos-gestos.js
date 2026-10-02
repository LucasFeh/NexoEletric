/* A tabela de gestos do editor de atalhos (hub-atalhos.js » GESTOS) diz o que o canvas faz, e
   o canvas não lê essa tabela — ela pode mentir calada. Foi o que aconteceu em 2026-09-24: o
   fio passou a ser pego em dois cliques, como no Altium, e a tabela seguiu mandando dar
   "Clique duplo" para pegar o fio inteiro.
   Desde 2026-10-02 o arquivo tem duas tabelas, uma por vista: HubAtalhos (o Esquema, de sempre)
   e HubAtalhos.pcb. A da PCB é o contrato com o pcbframe.js, que programa contra os ids e as
   teclas dela — por isso ela vai conferida tecla por tecla, e não só pela forma.
   Rode: node tests/test-atalhos-gestos.js */
'use strict';
const assert = require('assert');
const path = require('path');
const A = require(path.join(__dirname, '..', 'hub-atalhos.js'));

const G = A.GESTOS;
assert.ok(Array.isArray(G) && G.length, 'GESTOS exportado');

/* o fio: o primeiro clique pega o fio inteiro, o segundo o trecho; duplo clique não é gesto */
assert.ok(!G.some(g => g.teclas.includes('Clique duplo')), 'nenhum gesto de clique duplo');
assert.ok(G.some(g => /fio inteiro/.test(g.rotulo) && g.teclas.join('+') === 'Clique'), 'clique = fio inteiro');
assert.ok(G.some(g => /trecho/.test(g.rotulo) && g.teclas.join('+') === 'Segundo clique'), 'segundo clique = trecho');
/* a net só acende com Alt */
assert.ok(G.some(g => /net/.test(g.rotulo) && g.teclas.join('+') === 'Alt+Clique'), 'Alt+Clique acende a net');

/* as teclas do fio valem SÓ com o fio na mão: sem o `quando`, o editor diria que o Espaço da
   vista inverte o canto, e ele gira a seleção */
const doFio = G.filter(g => g.teclas.some(t => t === 'Espaço' || t === 'Backspace'));
assert.ok(doFio.length >= 3, 'as teclas do fio estão na tabela');
for (const g of doFio) assert.ok(/fio na mão/.test(g.quando || ''), g.rotulo + ': quando = fio na mão');
for (const g of G) assert.ok(g.quando === undefined || (typeof g.quando === 'string' && g.quando), g.rotulo + ': quando é texto');

/* ══ AS DUAS VISTAS ══ */

const S = A.sch, P = A.pcb;
/* O Esquema continua sendo o HubAtalhos de antes: o schframe.js desestrutura estes nomes do
   topo, e o hub chama o pane. Mudar o que eles apontam mudaria o teclado da folha calado. */
assert.ok(S && P, 'HubAtalhos.sch e HubAtalhos.pcb exportados');
assert.strictEqual(A.CHAVE, 'altiumhub.sch.atalhos', 'a chave do Esquema é a de sempre (quem trocou tecla não perde)');
assert.strictEqual(S.CHAVE, A.CHAVE);
assert.strictEqual(S.ATALHOS_PADRAO, A.ATALHOS_PADRAO);
assert.strictEqual(S.GESTOS, A.GESTOS);
for (const f of ['mapaAtalhos', 'defineAtalho', 'carrega', 'grava']) assert.strictEqual(A[f], S[f], 'HubAtalhos.' + f + ' é o do Esquema');
assert.strictEqual(typeof A.normalizaTecla, 'function');
assert.strictEqual(typeof A.pane, 'function');
assert.ok(Array.isArray(A.TECLAS_PROIBIDAS));
assert.strictEqual(S.QUANDO, 'vista Esquema');

/* a PCB tem a mesma forma, com chave e Quando próprios */
assert.strictEqual(P.CHAVE, 'altiumhub.pcb.atalhos');
assert.strictEqual(P.QUANDO, 'vista PCB');
assert.notStrictEqual(P.CHAVE, S.CHAVE, 'cada vista grava na sua chave');
for (const f of ['mapaAtalhos', 'defineAtalho', 'carrega', 'grava']) assert.strictEqual(typeof P[f], 'function', 'pcb.' + f);
assert.ok(Array.isArray(P.ATALHOS_PADRAO) && Array.isArray(P.GESTOS));

/* a tabela da PCB, tecla por tecla e na ordem (o pedido do dono: W trilha, Ctrl+2 via) */
const PCB = {
  trilha:'W', via:'Ctrl+2', linha:'L', arco:'A', circulo:'O', retangulo:'R', poligono:'G', texto:'T',
  preencher:'P', sinalizar:'N', medir:'Ctrl+M', unidade:'Q', camadaUnica:'S', proxCamada:'+', antCamada:'-',
  outraFace:'*', virar:'V', grade:'B', diff:'D', enquadrar:'F', girar:'Espaço', espelhoX:'X', espelhoY:'Y',
  apagar:'Delete', desfazer:'Ctrl+Z', refazer:'Ctrl+Y', tudo:'Ctrl+A', editar:'E', salvar:'Ctrl+S', ajuda:'H',
};
assert.deepStrictEqual(P.ATALHOS_PADRAO.map(a => a.id), Object.keys(PCB), 'os ids da PCB, na ordem');
for (const a of P.ATALHOS_PADRAO){
  assert.strictEqual(a.tecla, PCB[a.id], a.id + ' = ' + PCB[a.id]);
  assert.ok(typeof a.rotulo === 'string' && a.rotulo.trim(), a.id + ': rótulo');
}
/* com a trilha na mão a via e a outraFace põem via e trocam de camada: o rótulo tem de dizer */
for (const id of ['via', 'outraFace'])
  assert.ok(/trilha na mão/.test(P.ATALHOS_PADRAO.find(a => a.id === id).rotulo), id + ': rótulo cita a trilha na mão');

/* nas DUAS tabelas: ids únicos, tecla única dentro da vista, nenhuma proibida, e o padrão não
   perde ninguém no mapa */
for (const v of [S, P]){
  const ids = v.ATALHOS_PADRAO.map(a => a.id), teclas = v.ATALHOS_PADRAO.map(a => a.tecla);
  assert.strictEqual(new Set(ids).size, ids.length, v.QUANDO + ': ids únicos');
  assert.strictEqual(new Set(teclas).size, teclas.length, v.QUANDO + ': nenhuma tecla repetida no padrão');
  for (const t of teclas)
    assert.ok(!A.TECLAS_PROIBIDAS.includes(t) && !/(^|\+)Escape$/.test(t), v.QUANDO + ': ' + t + ' não é proibida');
  const m = v.mapaAtalhos({});
  assert.strictEqual(Object.keys(m.porTecla).length, ids.length, v.QUANDO + ': duas ações na mesma tecla seria uma delas morta');
  assert.deepStrictEqual(m.descartados, []);
  assert.deepStrictEqual(m.repetidas, []);
  for (const a of v.ATALHOS_PADRAO) assert.strictEqual(m.porAcao[a.id], a.tecla);
}

/* ══ A TECLA COMO O NAVEGADOR A ENTREGA ══ */

const N = ev => A.normalizaTecla(ev);
/* toda tecla padrão tem de sair do normalizaTecla: uma que ele nunca escreve seria um atalho
   morto (o Shift+S do Altium, por exemplo — o Shift cai em tecla de um caractere) */
function eventoDe(t){
  const p = t === '+' ? ['+'] : t.split('+');
  const k = p[p.length - 1];
  const ev = { key: k === 'Espaço' ? ' ' : (k.length === 1 ? k.toLowerCase() : k) };
  for (const mod of p.slice(0, -1)) ev[{ Ctrl:'ctrlKey', Alt:'altKey', Shift:'shiftKey' }[mod]] = true;
  return ev;
}
for (const v of [S, P])
  for (const a of v.ATALHOS_PADRAO) assert.strictEqual(N(eventoDe(a.tecla)), a.tecla, v.QUANDO + ': ' + a.tecla + ' sai do normalizaTecla');

/* Os eventos de verdade das teclas novas. Medido em 2026-10-02 com o ToUnicodeEx do Windows (de
   onde o Chrome tira o e.key) nos dois layouts da bancada, US (0409) e ABNT (0416): nos dois o *
   de cima é Shift+8 e o + de cima é Shift+=; no numérico +, - e * saem sem Shift; com Ctrl o
   Windows não dá caractere imprimível e o Chrome entrega a tecla sem o Ctrl ('2', 'm', 's'). */
assert.strictEqual(N({ key:'2', code:'Digit2', ctrlKey:true }), 'Ctrl+2', 'Ctrl + o 2 de cima');
assert.strictEqual(N({ key:'2', code:'Numpad2', location:3, ctrlKey:true }), 'Ctrl+2', 'Ctrl + o 2 do numérico, NumLock ligado');
assert.strictEqual(N({ key:'+', code:'Equal', shiftKey:true }), '+', 'o + de cima é Shift+= (US e ABNT): o Shift cai');
assert.strictEqual(N({ key:'+', code:'NumpadAdd', location:3 }), '+', 'o + do numérico');
assert.strictEqual(N({ key:'+', code:'NumpadAdd', location:3, shiftKey:true }), '+', 'o + do numérico com Shift');
assert.strictEqual(N({ key:'-', code:'Minus' }), '-', 'o - de cima');
assert.strictEqual(N({ key:'-', code:'NumpadSubtract', location:3 }), '-', 'o - do numérico');
assert.strictEqual(N({ key:'*', code:'Digit8', shiftKey:true }), '*', 'o * de cima é Shift+8 (US e ABNT): o Shift cai');
assert.strictEqual(N({ key:'*', code:'NumpadMultiply', location:3 }), '*', 'o * do numérico');
assert.strictEqual(N({ key:'m', code:'KeyM', ctrlKey:true }), 'Ctrl+M');
assert.strictEqual(N({ key:'M', code:'KeyM', ctrlKey:true }), 'Ctrl+M', 'Ctrl+M com o Caps Lock ligado');
assert.strictEqual(N({ key:'s', code:'KeyS', ctrlKey:true }), 'Ctrl+S');
assert.strictEqual(N({ key:'s', code:'KeyS', metaKey:true }), 'Ctrl+S', 'o Command do Mac entra como Ctrl');
/* O que NÃO dá, documentado aqui para ninguém "consertar" às cegas: com o NumLock desligado o 2
   do numérico é a seta para baixo. O Ctrl+2 (e o 2 da trilha) pedem o 2 de cima ou o NumLock. */
assert.strictEqual(N({ key:'ArrowDown', code:'Numpad2', location:3, ctrlKey:true }), 'Ctrl+ArrowDown');

/* e cada uma cai na ação certa do mapa da PCB */
{
  const m = P.mapaAtalhos({});
  const casos = [
    [{ key:'w' }, 'trilha'], [{ key:'2', ctrlKey:true }, 'via'], [{ key:'*', shiftKey:true }, 'outraFace'],
    [{ key:'*' }, 'outraFace'], [{ key:'+', shiftKey:true }, 'proxCamada'], [{ key:'+' }, 'proxCamada'],
    [{ key:'-' }, 'antCamada'], [{ key:'m', ctrlKey:true }, 'medir'], [{ key:'s', ctrlKey:true }, 'salvar'],
    [{ key:'S', shiftKey:true }, 'camadaUnica'], [{ key:' ' }, 'girar'], [{ key:'Delete' }, 'apagar'],
  ];
  for (const [ev, id] of casos) assert.strictEqual(m.porTecla[N(ev)], id, JSON.stringify(ev) + ' → ' + id);
  assert.strictEqual(m.porTecla['2'], undefined, 'o 2 sozinho não é ação: é o gesto fixo da trilha (via sem trocar de camada)');
}

/* ══ REPETIÇÃO: SÓ DENTRO DA MESMA VISTA ══ */
{
  /* o W já é das duas no padrão, cada uma no seu mapa */
  assert.strictEqual(S.mapaAtalhos({}).porTecla.W, 'fio');
  assert.strictEqual(P.mapaAtalhos({}).porTecla.W, 'trilha');

  const ocupada = P.defineAtalho({}, 'trilha', 'Q');
  assert.ok(!ocupada.ok && /já é trocar a unidade/.test(ocupada.erro), 'Q já é a unidade na PCB: ' + ocupada.erro);
  const daOutra = P.defineAtalho({}, 'texto', 'C');          /* C é "adicionar componentes" no Esquema */
  assert.ok(daOutra.ok && daOutra.salvos.texto === 'C', 'tecla do Esquema vale na PCB');
  const doSch = S.defineAtalho({}, 'fio', 'Ctrl+M');          /* Ctrl+M é medir na PCB */
  assert.ok(doSch.ok && doSch.salvos.fio === 'Ctrl+M', 'tecla da PCB vale no Esquema');
  assert.ok(!S.defineAtalho({}, 'fio', 'C').ok, 'e no Esquema o C continua ocupado');
  /* gravado numa vista não muda o mapa da outra; id de uma vista não existe na outra */
  assert.strictEqual(P.mapaAtalhos({ trilha:'K' }).porTecla.K, 'trilha');
  const cruzado = S.mapaAtalhos({ trilha:'K' });
  assert.strictEqual(cruzado.porTecla.K, undefined, 'id da PCB gravado no Esquema não vira tecla');
  assert.ok(cruzado.descartados.some(d => /^trilha:/.test(d)), 'e sai como descartado');
  assert.ok(!P.defineAtalho({}, 'fio', 'K').ok, 'ação do Esquema não existe na PCB');
  assert.ok(!S.defineAtalho({}, 'trilha', 'K').ok, 'ação da PCB não existe no Esquema');
}

/* ══ AS MESMAS REGRAS DE TECLA ══ */
{
  const r = P.defineAtalho({}, 'trilha', 'K');
  assert.ok(r.ok && r.salvos.trilha === 'K');
  const nav = P.defineAtalho({}, 'trilha', 'Ctrl+W');
  assert.ok(!nav.ok && /navegador/.test(nav.erro), 'Ctrl+W é do navegador também na PCB');
  for (const t of A.TECLAS_PROIBIDAS) assert.ok(!P.defineAtalho({}, 'medir', t).ok, t + ' recusada na PCB');
  const esc = P.defineAtalho({}, 'via', 'Shift+Escape');
  assert.ok(!esc.ok && /Esc/.test(esc.erro), 'o Esc é reservado nas duas');
  assert.ok(!P.defineAtalho({}, 'trilha', '').ok, 'tecla vazia');
  assert.ok(P.defineAtalho({ trilha:'K' }, 'trilha', 'K').ok, 'regravar a MESMA tecla na MESMA ação não é conflito');
  /* voltar ao padrão apaga a entrada em vez de gravar o padrão por cima */
  const volta = P.defineAtalho({ trilha:'K' }, 'trilha', 'W');
  assert.ok(volta.ok && !('trilha' in volta.salvos));
  /* trocar a via de tecla libera o Ctrl+2 */
  const m3 = P.mapaAtalhos({ via:'Ctrl+3' });
  assert.strictEqual(m3.porTecla['Ctrl+3'], 'via');
  assert.strictEqual(m3.porTecla['Ctrl+2'], undefined);
  /* chave estragada no localStorage não pode deixar a placa sem teclado nenhum */
  for (const lixo of [null, undefined, 'nada', 42, [], { naoExiste:'K' }, { trilha:'' }, { trilha:'Escape' },
                      { trilha:'Ctrl+W' }, { constructor:'K' }]){
    const m = P.mapaAtalhos(lixo);
    assert.strictEqual(m.porAcao.trilha, 'W', 'entrada inválida cai no padrão: ' + JSON.stringify(lixo));
    assert.strictEqual(Object.keys(m.porTecla).length, P.ATALHOS_PADRAO.length);
  }
  assert.ok(P.mapaAtalhos({ constructor:'K' }).descartados.length, '"constructor" não passa por ação que existe');
  /* duas ações na mesma tecla gravada à mão: a que repetiu volta ao padrão em vez de sumir */
  const rep = P.mapaAtalhos({ texto:'W' });
  assert.strictEqual(rep.porTecla.W, 'trilha');
  assert.strictEqual(rep.porTecla.T, 'texto');
  assert.strictEqual(Object.keys(rep.porTecla).length, P.ATALHOS_PADRAO.length, 'ninguém fica sem tecla');
}

/* ══ CADA VISTA NA SUA CHAVE ══ */
{
  const mem = new Map();
  global.localStorage = {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)); },
    removeItem: k => { mem.delete(k); },
  };
  try {
    P.grava({ trilha:'K' });
    assert.strictEqual(mem.get('altiumhub.pcb.atalhos'), '{"trilha":"K"}');
    assert.ok(!mem.has('altiumhub.sch.atalhos'), 'gravar a PCB não toca o Esquema');
    assert.deepStrictEqual(P.carrega(), { trilha:'K' });
    assert.deepStrictEqual(A.carrega(), {});
    A.grava({ fio:'K' });
    assert.deepStrictEqual(A.carrega(), { fio:'K' });
    assert.deepStrictEqual(P.carrega(), { trilha:'K' }, 'gravar o Esquema não toca a PCB');
    P.grava({});
    assert.ok(!mem.has('altiumhub.pcb.atalhos'), 'restaurar a PCB apaga só a chave dela');
    assert.deepStrictEqual(A.carrega(), { fio:'K' });
    mem.set('altiumhub.pcb.atalhos', '{estragado');
    assert.deepStrictEqual(P.carrega(), {}, 'chave estragada volta vazia');
  } finally { delete global.localStorage; }
  assert.deepStrictEqual(P.carrega(), {}, 'sem localStorage (Node, aba privada travada): vazio, sem erro');
}

/* ══ OS GESTOS FIXOS DA PCB ══ */

const GP = P.GESTOS;
assert.ok(Array.isArray(GP) && GP.length, 'pcb.GESTOS exportado');
for (const g of GP){
  assert.ok(typeof g.rotulo === 'string' && g.rotulo.trim(), 'gesto com rótulo');
  assert.ok(Array.isArray(g.teclas) && g.teclas.length && g.teclas.every(t => typeof t === 'string' && t), g.rotulo + ': teclas');
  assert.ok(g.quando === undefined || (typeof g.quando === 'string' && g.quando), g.rotulo + ': quando é texto');
}
const TRILHA = GP.find(g => /canto da trilha/.test(g.rotulo)).quando;
assert.ok(/trilha na mão/.test(TRILHA), 'o estado da trilha: ' + TRILHA);
/* procura um gesto pelo rótulo, pela combinação e pelo estado (sem estado = vale na vista toda) */
const gesto = (re, teclas, quando) => GP.find(g => re.test(g.rotulo) && g.teclas.join('+') === teclas
  && (quando ? g.quando === quando : !g.quando));

/* mouse, na vista toda */
assert.ok(gesto(/^Selecionar$/, 'Clique'), 'clique seleciona');
assert.ok(gesto(/objeto de baixo/, 'Segundo clique'), 'o segundo clique no mesmo ponto pega o de baixo');
assert.ok(gesto(/Somar.*tirar/, 'Shift+Clique'), 'Shift+clique soma ou tira');
assert.ok(gesto(/dentro/, 'Arrastar no vazio →'), 'janela da esquerda para a direita: o que está dentro');
assert.ok(gesto(/toca/, 'Arrastar no vazio ←'), 'janela da direita para a esquerda: o que toca');
assert.ok(gesto(/Mover o objeto/, 'Arrastar'), 'arrastar move');
assert.ok(gesto(/só a ponta/, 'Arrastar a ponta'), 'arrastar a ponta da trilha selecionada move só a ponta');
assert.ok(gesto(/tela/, 'Botão direito+Arrastar'), 'botão direito arrastando = tela');
assert.ok(gesto(/menu/, 'Botão direito'), 'botão direito parado = menu');
assert.ok(gesto(/Aproximar/, 'Roda do mouse'), 'roda = zoom');
assert.ok(gesto(/lado/, 'Shift+Roda do mouse'), 'Shift+roda = lateral');
assert.ok(gesto(/Propriedades/, 'Clique duplo'), 'na PCB o clique duplo É gesto: abre as Propriedades');
assert.ok(gesto(/Largar o que estiver/, 'Escape'), 'Esc larga o que estiver na mão');

/* com a trilha na mão */
assert.ok(gesto(/Fixar o canto/, 'Clique', TRILHA));
assert.ok(gesto(/Inverter o canto/, 'Espaço', TRILHA));
assert.ok(gesto(/modo da trilha/, 'Shift+Espaço', TRILHA));
assert.ok(gesto(/Desfazer o último trecho/, 'Backspace', TRILHA));
assert.ok(gesto(/Via sem trocar/, '2', TRILHA), '2 = via sem trocar de camada');
assert.ok(gesto(/Largura/, 'Tab', TRILHA));
assert.ok(gesto(/Terminar a trilha/, 'Botão direito', TRILHA));
assert.ok(gesto(/Largar a trilha/, 'Escape', TRILHA));
/* via + troca de camada: são as AÇÕES via e outraFace, e o editor mostra a tecla gravada delas */
{
  const g = gesto(/troca de camada/, '*', TRILHA);
  assert.ok(g, '* = via + troca de camada');
  assert.deepStrictEqual(g.acoes, ['outraFace', 'via'], '* ou Ctrl+2: as teclas das ações outraFace e via');
}
/* arrastando */
const ARRASTO = GP.find(g => /Trocar de face/.test(g.rotulo)).quando;
assert.strictEqual(ARRASTO, 'arrastando');
assert.ok(gesto(/Trocar de face/, 'L', ARRASTO), 'L troca o componente de face');
assert.ok(gesto(/snap/, 'Ctrl', ARRASTO), 'Ctrl solta o snap');
assert.deepStrictEqual(gesto(/Girar/, 'Espaço', ARRASTO).acoes, ['girar'], 'Espaço gira: a ação girar');
assert.deepStrictEqual(gesto(/Espelhar/, 'X', ARRASTO).acoes, ['espelhoX', 'espelhoY'], 'X/Y espelham: as ações');

/* `acoes` aponta para ações que existem, o `teclas` é o padrão da primeira, e só vale num estado */
const idsPcb = new Set(P.ATALHOS_PADRAO.map(a => a.id));
for (const g of GP.filter(x => x.acoes)){
  assert.ok(Array.isArray(g.acoes) && g.acoes.length && g.acoes.every(id => idsPcb.has(id)), g.rotulo + ': ações da PCB');
  assert.strictEqual(g.teclas.join('+'), P.ATALHOS_PADRAO.find(a => a.id === g.acoes[0]).tecla, g.rotulo + ': teclas = padrão da 1ª ação');
  assert.ok(g.quando, g.rotulo + ': ação num estado da vista');
}
/* Gesto fixo SEM estado só pode ser de mouse (ou modificador, ou o Esc): uma tecla de verdade ali
   valeria na vista inteira ANTES do mapa, e brigaria calada com a ação gravada nela. */
const DE_MOUSE = new Set(['Clique', 'Segundo clique', 'Clique duplo', 'Arrastar', 'Arrastar no vazio →', 'Arrastar no vazio ←',
  'Arrastar a ponta', 'Botão direito', 'Roda do mouse', 'Shift', 'Ctrl', 'Alt', 'Escape']);
for (const g of GP.filter(x => !x.quando))
  assert.ok(g.teclas.every(t => DE_MOUSE.has(t)), g.rotulo + ': gesto da vista toda é de mouse, não tecla');
/* as teclas de verdade dos estados (Espaço, Backspace, 2, L...) têm estado */
for (const g of GP.filter(x => x.teclas.some(t => ['Espaço', 'Backspace', '2', 'L', 'Tab', 'X', '*'].includes(t))))
  assert.ok(g.quando, g.rotulo + ': tecla de estado tem quando');

console.log('test-atalhos-gestos: OK');
