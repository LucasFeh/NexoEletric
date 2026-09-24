/* O fio maleável — as regras que a vista Esquema passou a ter em 2026-09-16, provadas sem DOM.

   Este arquivo existe por uma queixa e por duas medições.

   A queixa: "se passa por cima de 2 conexões ela gera uma bolinha pra dizer que tem mais de 1
   conexão ali, se não tiver conexão ela muda pra uma ponte"; e "quero ser possível selecionar
   cada seção da trilha e não a trilha toda, do jeito que tá eu sou obrigado a apagar tudo pra
   refazer a trilha".

   As medições, feitas nos 15 projetos de Projects/ antes de escrever qualquer linha:

     - 18 pontos com três ou mais incidências (a estrela de três pontas de fio) NÃO ganhavam
       bolinha. O `autoJunctions` do HubCore só enxerga o T — uma ponta pousando no meio de um
       fio — e a guarda de extremidade (hub-core.js:672) pula justamente a estrela. Contar
       RAMOS resolve os dois casos de uma vez sem afrouxar aquela guarda, que existe para o
       canto em L não virar bolinha em toda dobra de fio da folha;
     - 58 cruzamentos sem conexão, TODOS ortogonais (um horizontal contra um vertical). Por isso
       "o horizontal salta o vertical" decide 100% do acervo, e por isso a regra de desempate
       (mesmo eixo nos dois) nunca foi exercitada por dado real — ela está aqui só para o
       desenho não piscar entre um quadro e outro.

   A testemunha de que a conta bate com a realidade não é só este arquivo: rodando o
   `topologiaFolha` sobre os 15 projetos saem exatamente 58 pontes, e no TCMS_Reader saem 13
   bolinhas contra as 13 junções (RECORD=29) do .SchDoc real daquele projeto.

   schframe.js em Node vale só pela parte pura: o require abaixo morre se alguém puser DOM
   acima do module.exports. */
const assert = require('assert');
const SF = require('../schframe.js');

const fio = pts => ({ pts });
const xy = (x, y) => ({ x, y });
const pontos = l => l.map(b => b.x + ',' + b.y).sort().join(' · ');

/* ── 1. A BOLINHA ── */

/* a estrela: três pontas de fio no mesmo ponto. É o caso que faltava. */
{
  const t = SF.topologiaFolha([fio([[0,0],[100,0]]), fio([[100,0],[200,0]]), fio([[100,0],[100,100]])], [], []);
  assert.strictEqual(t.bolinhas.length, 1, 'três pontas de fio no mesmo ponto pedem bolinha');
  assert.strictEqual(pontos(t.bolinhas), '100,0');
  assert.strictEqual(t.bolinhas[0].ramos, 3, 'três ramos: uma ponta de cada fio');
}
/* o canto em L: dois ramos. Se isto virar bolinha, toda dobra de fio da folha vira bolinha —
   é o motivo de a conta ser por RAMO e não por "quantos objetos tocam aqui". */
{
  const t = SF.topologiaFolha([fio([[0,0],[100,0],[100,100]])], [], []);
  assert.strictEqual(t.bolinhas.length, 0, 'canto em L não é derivação');
}
/* dois fios emendados ponta com ponta também são dois ramos: é a continuação de um fio só. */
{
  const t = SF.topologiaFolha([fio([[0,0],[100,0]]), fio([[100,0],[200,0]])], [], []);
  assert.strictEqual(t.bolinhas.length, 0, 'emenda ponta a ponta não é derivação');
}
/* o T: uma ponta pousando no meio de um fio. É o único caso que o autoJunctions já pegava. */
{
  const t = SF.topologiaFolha([fio([[0,0],[200,0]]), fio([[100,0],[100,100]])], [], []);
  assert.strictEqual(t.bolinhas.length, 1, 'T pede bolinha');
  assert.strictEqual(t.bolinhas[0].ramos, 3, 'dois ramos do fio que passa + um da ponta');
}
/* fio terminando num pino são dois ramos — e não há bolinha nenhuma no Altium ali. */
{
  const t = SF.topologiaFolha([fio([[0,0],[100,0]])], [xy(100,0)], []);
  assert.strictEqual(t.bolinhas.length, 0, 'fio encostando num pino não é derivação');
}
/* pino no MEIO de um fio: o fio passa (2) e o pino entra (1). O Altium desenha bolinha. */
{
  const t = SF.topologiaFolha([fio([[0,0],[200,0]])], [xy(100,0)], []);
  assert.strictEqual(t.bolinhas.length, 1, 'pino no meio do fio pede bolinha');
}
/* a junção EXPLÍCITA desenha mesmo sem chegar a três ramos: é um objeto que alguém pôs no
   arquivo (ou que veio do Altium), e sumir com ele seria o desenho contradizer o dado. */
{
  const t = SF.topologiaFolha([fio([[0,0],[200,0]])], [], [xy(100,0)]);
  assert.strictEqual(t.bolinhas.length, 1, 'junção explícita sempre desenha');
}
/* e ela não inventa bolinha de si mesma quando está sozinha... ela desenha, porque é explícita;
   o que ela não faz é somar ramo e contaminar a conta de um ponto vizinho. */
{
  const t = SF.topologiaFolha([], [], [xy(0,0)]);
  assert.strictEqual(t.bolinhas.length, 1);
  assert.strictEqual(t.bolinhas[0].ramos, 0, 'junção não traz ramo: quem tem ramo é o fio');
}

/* ── 2. A PONTE ── */

/* o cruzamento puro: ninguém declarou nada naquele ponto. Não liga (é a regra do Altium e a do
   HubCore.extractNets) e por isso ganha o arco — e NÃO ganha bolinha. */
{
  const t = SF.topologiaFolha([fio([[0,0],[200,0]]), fio([[100,-100],[100,100]])], [], []);
  assert.strictEqual(t.bolinhas.length, 0, 'cruzamento sem âncora não liga, logo não pinga');
  assert.strictEqual(t.pontes.length, 1, 'cruzamento sem âncora ganha ponte');
  assert.strictEqual(t.pontes[0].wi, 0, 'quem salta é o horizontal');
  assert.strictEqual(t.pontes[0].x, 100);
  assert.strictEqual(t.pontes[0].y, 0);
}
/* o mesmo cruzamento COM junção: aí liga, e o desenho é a bolinha — nunca as duas coisas. */
{
  const t = SF.topologiaFolha([fio([[0,0],[200,0]]), fio([[100,-100],[100,100]])], [], [xy(100,0)]);
  assert.strictEqual(t.pontes.length, 0, 'onde há junção não há ponte');
  assert.strictEqual(t.bolinhas.length, 1, 'onde há junção há bolinha');
}
/* um fio não salta por cima de si mesmo: dois trechos do mesmo item que se cruzam são um
   desenho estranho, mas são a mesma net — arco ali seria mentira. */
{
  const t = SF.topologiaFolha([fio([[0,0],[200,0],[100,-100],[100,100]])], [], []);
  assert.strictEqual(t.pontes.length, 0, 'fio não salta por cima de si mesmo');
}
/* encosto de ponta (T) não é cruzamento: quem decide é a âncora, e a ponta É uma âncora. */
{
  const t = SF.topologiaFolha([fio([[0,0],[200,0]]), fio([[100,0],[100,100]])], [], []);
  assert.strictEqual(t.pontes.length, 0, 'T não é cruzamento');
}
/* paralelos não se cruzam, e sobrepostos também não ganham arco (não há ponto único). */
{
  const t = SF.topologiaFolha([fio([[0,0],[200,0]]), fio([[0,50],[200,50]])], [], []);
  assert.strictEqual(t.pontes.length, 0, 'paralelos não cruzam');
}

/* ── 3. O TRECHO ── */

const P = [[0,0],[100,0],[100,100],[200,100]];

/* trecho no eixo Y só anda em X, e os vizinhos esticam sozinhos porque compartilham o vértice.
   É o que o Altium faz, e é o que separa "maleável" de "duro". */
assert.deepStrictEqual(SF.moveSegmento(P, 1, 40, 40), [[0,0],[140,0],[140,100],[200,100]]);
/* trecho no eixo X só anda em Y */
assert.deepStrictEqual(SF.moveSegmento(P, 0, 40, 40), [[0,40],[100,40],[100,100],[200,100]]);
/* fio de dois pontos anda inteiro: ali o trecho É o fio, e travar um eixo tiraria o gesto de
   mover o fio de lugar */
assert.deepStrictEqual(SF.moveSegmento([[0,0],[100,0]], 0, 30, 50), [[30,50],[130,50]]);
/* diagonal (as que vêm do Altium) anda livre: nela não existe "a perpendicular certa" */
assert.deepStrictEqual(SF.moveSegmento([[0,0],[100,100],[200,100]], 0, 10, 20), [[10,20],[110,120],[200,100]]);
/* a foto de partida não é tocada: o arrasto é sempre base + delta */
{
  const antes = JSON.stringify(P);
  SF.moveSegmento(P, 1, 999, 999);
  assert.strictEqual(JSON.stringify(P), antes, 'moveSegmento não escreve no array que recebeu');
}

/* ── 4. APAGAR SEM REFAZER O FIO TODO ── */

/* o pedido, em uma linha: tirar o trecho errado do meio parte o fio em dois. */
assert.deepStrictEqual(SF.apagaSegmento(P, 1), [[[0,0],[100,0]], [[100,100],[200,100]]]);
/* ponta que sobraria com um ponto só não vira fio: o serializeSchematic recusa o ARQUIVO
   inteiro por causa de um wire com menos de dois pontos (hub-core.js), então ela é descartada */
assert.deepStrictEqual(SF.apagaSegmento(P, 0), [[[100,0],[100,100],[200,100]]]);
assert.deepStrictEqual(SF.apagaSegmento(P, 2), [[[0,0],[100,0],[100,100]]]);
/* fio de dois pontos com o único trecho apagado some inteiro — e não vira dois fios de um ponto */
assert.deepStrictEqual(SF.apagaSegmento([[0,0],[100,0]], 0), []);
/* apagar vértice endireita o fio ali */
assert.deepStrictEqual(SF.apagaVertice(P, 1), [[0,0],[100,100],[200,100]]);
/* e recusa quando sobraria menos de um fio */
assert.strictEqual(SF.apagaVertice([[0,0],[100,0]], 0), null);

/* VÁRIOS cortes no MESMO fio, que é o caso que o `deleteSel` resolve de uma vez só. Ele corta
   do maior índice para o menor, e a peça que contém o próximo índice é sempre a primeira — é
   essa invariante que o laço abaixo reproduz. Cortar um por vez, em ordem crescente, invalidaria
   os índices dos outros no meio do caminho. */
function corta(pts, alvos){
  let pedacos = [pts];
  for (const a of alvos.slice().sort((p, q) => q.i - p.i)){
    const saida = [];
    for (const P of pedacos){
      if (P !== pedacos[0]){ saida.push(P); continue; }
      if (a.k === 'seg') saida.push.apply(saida, SF.apagaSegmento(P, a.i));
      else { const r = SF.apagaVertice(P, a.i); if (r) saida.push(r); }
    }
    pedacos = saida;
    if (!pedacos.length) break;
  }
  return pedacos;
}
{
  const L = [[0,0],[100,0],[200,0],[300,0],[400,0],[500,0]];      /* 6 pontos, 5 trechos */
  assert.deepStrictEqual(corta(L, [{k:'seg',i:1},{k:'seg',i:3}]),
    [[[0,0],[100,0]], [[200,0],[300,0]], [[400,0],[500,0]]], 'dois cortes viram três fios');
  assert.deepStrictEqual(corta(L, [{k:'seg',i:0},{k:'seg',i:4}]),
    [[[100,0],[200,0],[300,0],[400,0]]], 'cortar as duas pontas deixa o miolo');
  assert.deepStrictEqual(corta(L, [{k:'vert',i:1},{k:'vert',i:3}]),
    [[[0,0],[200,0],[400,0],[500,0]]], 'dois vértices somem de uma vez');
  assert.deepStrictEqual(corta(L, [0,1,2,3,4].map(i => ({k:'seg',i}))), [], 'apagar todos os trechos apaga o fio');
  for (const r of corta(L, [{k:'seg',i:1},{k:'seg',i:3}]))
    assert.ok(r.length >= 2, 'nenhum pedaço fica com menos de dois pontos');
}

/* ── 5. ESPELHO NOS DOIS EIXOS ── */

/* o formato só tem `mirror` (espelho em X ANTES da rotação) + rot 0/90/180/270; espelhar o que
   se vê é composição. Medido em Node contra o HubCore.compTransform antes de virar código. */
assert.deepStrictEqual(SF.espelha(0, false, 'y'), { rot:180, mirror:true }, 'Y em rot 0');
assert.deepStrictEqual(SF.espelha(0, false, 'x'), { rot:0,   mirror:true }, 'X em rot 0 é o de sempre');
assert.deepStrictEqual(SF.espelha(90, false, 'x'), { rot:270, mirror:true }, 'X em rot 90 NÃO é só o booleano');
assert.deepStrictEqual(SF.espelha(90, false, 'y'), { rot:90,  mirror:true }, 'Y em rot 90');
assert.deepStrictEqual(SF.espelha(270, true, 'y'), { rot:270, mirror:false });
/* espelhar duas vezes no mesmo eixo volta ao começo, em qualquer rotação — é o que faz a tecla
   ser um interruptor e não um caminho de ida */
for (const r of [0, 90, 180, 270]) for (const m of [true, false]) for (const e of ['x', 'y']){
  const a = SF.espelha(r, m, e), b = SF.espelha(a.rot, a.mirror, e);
  assert.deepStrictEqual(b, { rot:r, mirror:m }, 'ida e volta em rot ' + r + ' eixo ' + e);
}

/* ── 6. O ENCAIXE DA TROCA ── */

/* o componente novo desenha os pinos noutro lugar em volta da mesma âncora; o encaixe escolhe o
   deslocamento que devolve o MAIOR número de pinos ao ponto antigo */
{
  const r = SF.encaixeDaTroca([{num:'1',x:0,y:0},{num:'2',x:100,y:0}],
                              [{num:'1',x:50,y:20},{num:'2',x:150,y:20}]);
  assert.deepStrictEqual({ dx:r.dx, dy:r.dy, encaixa:r.encaixa, comuns:r.comuns },
                         { dx:-50, dy:-20, encaixa:2, comuns:2 });
}
/* é a MODA e não a média: a média não devolveria nenhum pino ao lugar */
{
  const r = SF.encaixeDaTroca([{num:'1',x:0,y:0},{num:'2',x:0,y:100},{num:'3',x:0,y:200}],
                              [{num:'1',x:10,y:0},{num:'2',x:10,y:100},{num:'3',x:900,y:900}]);
  assert.strictEqual(r.dx, -10, 'ganha o deslocamento de dois pinos, não a média com o terceiro');
  assert.strictEqual(r.encaixa, 2);
  assert.strictEqual(r.comuns, 3);
}
/* pino que não existe nos dois lados não vota */
{
  const r = SF.encaixeDaTroca([{num:'1',x:0,y:0}], [{num:'9',x:5,y:5}]);
  assert.deepStrictEqual({ dx:r.dx, dy:r.dy, encaixa:r.encaixa }, { dx:0, dy:0, encaixa:0 });
}
/* desenho que já está no lugar não move nada */
{
  const r = SF.encaixeDaTroca([{num:'1',x:7,y:7}], [{num:'1',x:7,y:7}]);
  assert.deepStrictEqual({ dx:r.dx, dy:r.dy }, { dx:0, dy:0 });
}

/* ── 7. A GRADE ── */

assert.strictEqual(SF.snapPasso(1234, 100), 1200);
assert.strictEqual(SF.snapPasso(1234, 0), 1234, 'passo inválido não mexe na coordenada');
/* o passo métrico é dízima: sem o corte de 4 casas a coordenada acumula sujeira de float a cada
   arrasto, e coordenada que não fecha é pino que não liga */
{
  const v = SF.snapPasso(100, SF.MM_MIL);
  assert.strictEqual(v, Math.round(v * 1e4) / 1e4, 'o resultado tem no máximo 4 casas');
  assert.ok(Math.abs(v - 3 * SF.MM_MIL) < 1e-3, '100 mil cai no terceiro milímetro (2,54 arredonda para 3)');
}
/* snapar duas vezes é igual a snapar uma: sem isso o valor anda sozinho a cada arrasto */
for (const p of SF.GRADES.map(g => g.passo))
  for (const v of [0, 37, 1234.567, -880.25]){
    const a = SF.snapPasso(v, p);
    assert.strictEqual(SF.snapPasso(a, p), a, 'snap é idempotente no passo ' + p);
  }

/* ── 8. OS ATALHOS ── */

/* o padrão é o padrão */
{
  const m = SF.mapaAtalhos({});
  assert.strictEqual(m.porAcao.espelhoX, 'X');
  assert.strictEqual(m.porAcao.espelhoY, 'Y');
  assert.strictEqual(m.porTecla['Ctrl+Z'], 'desfazer');
  assert.strictEqual(Object.keys(m.porTecla).length, SF.ATALHOS_PADRAO.length,
    'nenhuma tecla repetida no padrão — duas ações na mesma tecla seria uma delas morta');
}
/* o que o usuário gravou vence */
{
  const m = SF.mapaAtalhos({ fio:'Q' });
  assert.strictEqual(m.porAcao.fio, 'Q');
  assert.strictEqual(m.porTecla.Q, 'fio');
  assert.ok(!m.porTecla.W, 'a tecla antiga fica livre');
}
/* chave estragada no localStorage não pode deixar a folha sem teclado nenhum */
for (const lixo of [null, undefined, 'nada', 42, [], { naoExiste:'K' }, { fio:'' }, { fio:'Escape' }]){
  const m = SF.mapaAtalhos(lixo);
  assert.strictEqual(m.porAcao.fio, 'W', 'entrada inválida cai no padrão: ' + JSON.stringify(lixo));
  assert.strictEqual(Object.keys(m.porTecla).length, SF.ATALHOS_PADRAO.length);
}
/* duas ações na mesma tecla: a que repetiu volta ao padrão em vez de sumir */
{
  const m = SF.mapaAtalhos({ fio:'C' });          /* C já é "adicionar componentes" */
  assert.strictEqual(Object.keys(m.porTecla).length, SF.ATALHOS_PADRAO.length, 'ninguém fica sem tecla');
}
/* gravar: o que a interface tem de dizer */
{
  const r = SF.defineAtalho({}, 'fio', 'Q');
  assert.ok(r.ok && r.salvos.fio === 'Q');
  const ocupada = SF.defineAtalho({}, 'fio', 'C');
  assert.ok(!ocupada.ok && /já é/.test(ocupada.erro), 'tecla ocupada é recusada COM o nome do dono');
  const proibida = SF.defineAtalho({}, 'fio', 'Ctrl+W');
  assert.ok(!proibida.ok && /navegador/.test(proibida.erro),
    'Ctrl+W é do navegador: deixar gravar seria entregar um "gravei e não funciona" sem pista');
  assert.ok(!SF.defineAtalho({}, 'naoExiste', 'Q').ok);
  assert.ok(!SF.defineAtalho({}, 'fio', '').ok);
  /* regravar a MESMA tecla na MESMA ação não é conflito consigo mesma */
  assert.ok(SF.defineAtalho({ fio:'Q' }, 'fio', 'Q').ok);
}
/* a tecla como a tabela a escreve */
{
  const t = (key, mod) => SF.normalizaTecla(Object.assign({ key }, mod || {}));
  assert.strictEqual(t('x'), 'X', 'letra sai maiúscula');
  assert.strictEqual(t('X', { shiftKey:true }), 'X',
    'Shift+letra é a mesma tecla: o navegador já manda X, e distinguir criaria dois atalhos que a mão não distingue');
  assert.strictEqual(t(' '), 'Espaço');
  assert.strictEqual(t('z', { ctrlKey:true }), 'Ctrl+Z');
  assert.strictEqual(t('z', { metaKey:true }), 'Ctrl+Z', 'o Command do Mac entra como Ctrl');
  assert.strictEqual(t('Delete'), 'Delete');
  assert.strictEqual(t('Control', { ctrlKey:true }), '', 'só o modificador não é tecla');
  assert.strictEqual(SF.normalizaTecla(null), '');
}

/* ── 9. A CAIXA DO TEXTO, ANCORADA NO CANTO ── */

/* A âncora é o canto INFERIOR-ESQUERDO, porque é esse o ponto que o Altium guarda (o
   RECORD=34/41 do .SchDoc não traz Justification, e o padrão é BottomLeft — o próprio hub já
   desenhava o net label assim). Isso não é detalhe de desenho: `refdx/refdy` são medidos até
   este ponto nos DOIS lados do espelho. Enquanto o hub ancorava no centro e o Altium no canto,
   a mesma coordenada queria dizer dois lugares, e o texto andava meia palavra a cada ida e
   volta, sem nunca convergir. */
{
  const b = SF.caixaTexto(1000, 500, 'R12', 60);
  assert.ok(b.x1 <= 1000 && b.x2 > 1000 + 60, 'a caixa cresce para a DIREITA da âncora');
  assert.ok(b.y1 <= 500 && b.y2 > 500 + 50, 'e para CIMA da âncora');
  assert.ok(b.x1 > 1000 - 30 && b.y1 > 500 - 30, 'a folga em volta é pequena, não meia palavra');
  const vazio = SF.caixaTexto(0, 0, '', 60);
  assert.ok(vazio.x2 - vazio.x1 >= 60, 'texto vazio ainda tem alvo: o designador pode estar em branco');
  const nulo = SF.caixaTexto(0, 0, null, 60);
  assert.ok(isFinite(nulo.x1) && isFinite(nulo.x2), 'null não vira NaN');
  assert.strictEqual(SF.larguraTexto('R12', 60), Math.max(60, 3 * 60 * 0.58));
  assert.ok(SF.larguraTexto('', 60) >= 60, 'largura mínima: um texto vazio ainda é agarrável');
}

/* ── os eixos do trecho: UMA regra para quem move, para as guias e para o Shift ──
   (o Shift chegou a prender o único eixo em que o trecho anda, e o fio congelava) */
{
  const P = [[0,0],[100,0],[100,100],[200,100]];
  assert.strictEqual(SF.eixosDoTrecho(P, 0), 'y', 'trecho horizontal: só anda em Y');
  assert.strictEqual(SF.eixosDoTrecho(P, 1), 'x', 'trecho vertical: só anda em X');
  assert.strictEqual(SF.eixosDoTrecho([[0,0],[100,0]], 0), 'xy', 'fio de dois pontos anda inteiro');
  assert.strictEqual(SF.eixosDoTrecho([[0,0],[100,100],[200,100]], 0), 'xy', 'diagonal anda livre');
  assert.strictEqual(SF.eixosDoTrecho(P, 9), 'xy', 'índice fora do fio não trava nada');
  /* e o moveSegmento obedece a mesma regra, em todo trecho */
  for (let i = 0; i < P.length - 1; i++){
    const ex = SF.eixosDoTrecho(P, i), m = SF.moveSegmento(P, i, 7, 11);
    assert.strictEqual(m[i][0] - P[i][0], ex.indexOf('x') >= 0 ? 7 : 0);
    assert.strictEqual(m[i][1] - P[i][1], ex.indexOf('y') >= 0 ? 11 : 0);
  }
}

console.log('test-fio-topologia: OK');
