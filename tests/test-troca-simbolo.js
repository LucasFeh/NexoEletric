/* Trocar o símbolo de um componente — a regra da tela (schframe.js » decideTroca), sem DOM.

   Este arquivo existe por um caso real. O componente CI2 do projeto "DMB - DI231765_P2" tem
   comment SN65HVD75DR, um transceptor RS-485 de 8 pinos. Uma escolha gravada em
   Libs\lib-subs.js mandava a folha desenhar "(TVS) CDSOD323-T15SC", um diodo TVS de 3 pinos.
   Ficou assim três dias sem ninguém ver, e a extração de nets foi junto. Duas falhas de
   interface, as duas caladas:

     - a ficha dizia em que símbolo tinha resolvido e não dizia POR QUE (nada distinguia
       "achei pelo nome" de "você mandou");
     - o botão de procurar símbolo só nascia dentro de `if (!sym)`, ou seja, sumia justamente
       quando a escolha resolvia o nome — a escolha errada virava definitiva pela interface.

   Aqui se prova a decisão pura: qual rótulo, qual motivo, qual aviso, dado o estado já
   medido. O resto (o botão existir, o modal abrir) é DOM e o navegador prova.

   schframe.js em Node vale só pela parte pura: ele sai no module.exports antes de tocar em
   document/window. Se alguém puser DOM acima disso, o require abaixo morre e diz isso. */
const assert = require('assert');
const SF = require('../schframe.js');
const d = SF.decideTroca;

assert.strictEqual(typeof d, 'function', 'decideTroca tem de ser exportada');

/* ── 1. RESOLVIDO POR ESCOLHA — o caso do CI2 ──
   O rótulo vira "Trocar", o motivo aponta o arquivo onde a escolha mora, e há como desfazer.
   Se um destes três voltar a faltar, o RS-485 vira TVS de novo sem uma linha de aviso. */
const esc = d({ sym: '(TVS) CDSOD323-T15SC', how: 'escolha', quantos: 1 });
assert.strictEqual(esc.rotulo, 'Trocar componente…');
assert.strictEqual(esc.destaque, false, 'com símbolo resolvido o botão é ação secundária, não alarme');
assert.strictEqual(esc.porEscolha, true);
assert.ok(/escolha sua/.test(esc.motivo), 'o motivo tem de dizer que foi o usuário: ' + esc.motivo);
assert.ok(/lib-subs\.js/.test(esc.motivo), 'e onde ela está gravada: ' + esc.motivo);
assert.ok(!/^escolha$/.test(esc.motivo), 'o valor cru do campo `how` não serve de texto de tela');
assert.ok(esc.desfazer, 'escolha tem de poder ser desfeita');
assert.ok(/"\(TVS\) CDSOD323-T15SC"/.test(esc.title), 'o title diz o que a folha desenha hoje');
assert.ok(/comment/.test(esc.title) && /pinagem/.test(esc.title),
  'o title continua explicando como a sugestão é feita: ' + esc.title);

/* ── 2. RESOLVIDO NATURAL ──
   Nome exato é o caso mudo de propósito: o nome pedido e o achado são o mesmo, e uma linha
   dizendo o óbvio em todo componente esconderia a linha que importa. Mas trocar continua
   possível — é o pedido "mesmo depois de estabelecer o símbolo, poder trocar livremente". */
const ex = d({ sym: 'RES', how: 'exato', quantos: 1 });
assert.strictEqual(ex.rotulo, 'Trocar componente…', 'resolvido também tem botão de troca');
assert.strictEqual(ex.motivo, null, 'nome exato não vira linha de ficha');
assert.strictEqual(ex.desfazer, null, 'não há escolha para desfazer');
assert.strictEqual(ex.porEscolha, false);
assert.strictEqual(ex.destaque, false);

/* os outros caminhos naturais DIZEM de onde vieram, sem oferecer desfazer (não é escolha
   de ninguém: é o rename-map e a chave normalizada do resolvedor) */
const ren = d({ sym: 'DDPAK-5', how: 'rename', quantos: 1 });
assert.ok(/rename-map\.js/.test(ren.motivo), 'renomeação aponta o rename-map: ' + ren.motivo);
assert.strictEqual(ren.desfazer, null);
const chv = d({ sym: 'CAP 0805', how: 'chave', quantos: 1 });
assert.ok(/aproxima/.test(chv.motivo), 'chave normalizada se explica: ' + chv.motivo);
assert.strictEqual(chv.desfazer, null);

/* ── 3. SEM SÍMBOLO ──
   Aí o componente é um quadrado vermelho e some da extração de nets: o botão é a saída e
   pode gritar. */
const sem = d({ sym: null, how: null, quantos: 1 });
assert.strictEqual(sem.rotulo, 'Procurar componente no acervo…');
assert.strictEqual(sem.destaque, true, 'sem símbolo o botão é a ação principal');
assert.strictEqual(sem.desfazer, null);
assert.ok(!/continua com/.test(sem.title), 'não há símbolo atual para prometer no title');
/* ambíguo resolve em NADA de propósito (dois candidatos, nenhum escolhido) — e isso tem de
   aparecer, senão o componente some sem explicação */
const amb = d({ sym: null, how: 'ambiguo', quantos: 2 });
assert.strictEqual(amb.rotulo, 'Procurar componente no acervo…');
assert.ok(/ambíguo/.test(amb.motivo), 'nome ambíguo se explica: ' + amb.motivo);

/* ── 4. PINAGEM ──
   O erro de origem foi trocar 8 pinos por 3. A comparação não proíbe (pode haver motivo),
   mas não passa em silêncio. */
const bate = d({ sym: 'X', how: 'exato', quantos: 1, pinosEsperados: 8, pinosDoCandidato: 8 });
assert.strictEqual(bate.pinosAlerta, false);
assert.ok(/8/.test(bate.pinos) && /bate/.test(bate.pinos), bate.pinos);

const naoBate = d({ sym: 'X', how: 'exato', quantos: 1, pinosEsperados: 8, pinosDoCandidato: 3 });
assert.strictEqual(naoBate.pinosAlerta, true, '8 pinos viram 3 e ninguém avisa: era o bug');
assert.ok(/8/.test(naoBate.pinos) && /3/.test(naoBate.pinos),
  'o aviso diz os dois números: ' + naoBate.pinos);
assert.ok(/NÃO bate/.test(naoBate.pinos), naoBate.pinos);

/* singular/plural, porque "1 pinos" num aviso tira a credibilidade do aviso */
assert.ok(/1 pino\b/.test(d({ sym: 'X', pinosEsperados: 1, pinosDoCandidato: 2 }).pinos));
assert.ok(/2 pinos\b/.test(d({ sym: 'X', pinosEsperados: 2, pinosDoCandidato: 2 }).pinos));

/* pinagem esperada DESCONHECIDA: o símbolo de origem pode não existir em acervo nenhum —
   é o caso do CI2. Dizer isso, e não inventar um número nem calar. */
const semEsp = d({ sym: 'Y', how: 'escolha', quantos: 1, pinosEsperados: null, pinosDoCandidato: 3 });
assert.strictEqual(semEsp.pinosAlerta, false, 'não saber não é motivo de alarme');
assert.ok(/não há pinagem esperada/.test(semEsp.pinos), semEsp.pinos);
assert.ok(/3 pinos/.test(semEsp.pinos), 'mas a pinagem do candidato é conhecida: ' + semEsp.pinos);
assert.ok(!/\b0 pino/.test(semEsp.pinos), 'desconhecido não pode virar zero');

/* sem candidato selecionado não há o que comparar */
assert.strictEqual(d({ sym: 'X', pinosEsperados: 8 }).pinos, null);
assert.strictEqual(d({ sym: 'X', pinosEsperados: 8, pinosDoCandidato: null }).pinosAlerta, false);
/* candidato com zero pinos é uma informação, não um "não sei" */
const zero = d({ sym: 'X', pinosEsperados: 8, pinosDoCandidato: 0 });
assert.strictEqual(zero.pinosAlerta, true);
assert.ok(/0/.test(zero.pinos), zero.pinos);

/* ── 5. ALCANCE DA ESCOLHA ──
   A escolha é global: vale para todo componente com aquele comp.sym, em todo projeto. O
   toast só contava DEPOIS de gravar; a contagem tem de estar na tela antes do clique. */
const tres = d({ sym: 'X', how: 'exato', quantos: 3 });
assert.strictEqual(tres.impactoAlerta, true, 'mais de um componente tem de estar visível');
assert.ok(/3 componentes/.test(tres.impacto), tres.impacto);
assert.ok(/todos os projetos/.test(tres.impacto), 'a escolha não é só deste projeto: ' + tres.impacto);
const um = d({ sym: 'X', how: 'exato', quantos: 1 });
assert.strictEqual(um.impactoAlerta, false);
assert.ok(/só este componente/.test(um.impacto), um.impacto);
assert.strictEqual(d({ sym: 'X', how: 'exato', quantos: 0 }).impacto, null,
  'nenhum componente na folha: não há alcance para anunciar');

/* ── 6. entrada torta não derruba a tela ── */
assert.doesNotThrow(() => d());
assert.doesNotThrow(() => d({}));
assert.strictEqual(d({}).rotulo, 'Procurar componente no acervo…');
assert.strictEqual(d({ sym: '', how: 'escolha' }).destaque, true, 'nome vazio é ausência de símbolo');
assert.strictEqual(d({ sym: 'X', quantos: -5 }).impacto, null);
assert.strictEqual(d({ sym: 'X', how: 'inventado' }).motivo, null, 'how desconhecido não vaza cru');

console.log('test-troca-simbolo OK (rótulo, motivo do resolveSym, desfazer, pinagem 8x3, '
          + 'pinagem desconhecida, alcance global antes do clique)');
