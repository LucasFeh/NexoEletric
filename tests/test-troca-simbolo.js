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

/* ── 5. ALCANCE DA ESCOLHA, em três viradas ──
   (1) até 2026-09-15 a escolha ia para o `Libs/lib-subs.js`: substituição GLOBAL por nome de
       símbolo, valendo em TODOS os projetos e sem aparecer em lugar nenhum. O usuário pediu o
       fim disso — "um componente não pode influenciar outro de designador diferente";
   (2) o alcance virou UM designador. Resolveu o vazamento e criou outro trabalho: trocar
       quarenta capacitores iguais virava quarenta idas ao modal;
   (3) 2026-09-16, o meio-termo: a troca vale para todos do mesmo tipo NESTE projeto, e a
       caixa de marcar do modal devolve o alcance de um só quando é isso que se quer.

   O que sobrou da recusa (1) é o que importava: nada vaza para outro projeto, e o número
   está na tela ANTES do clique — o toast que contava depois de gravar era o defeito
   original. */
const tres = d({ sym: 'X', how: 'exato', quantos: 3 });
assert.strictEqual(tres.alcance, 3, 'o padrão é trocar todos do tipo');
assert.strictEqual(tres.impactoAlerta, true, 'mexer em três de uma vez tem de se anunciar');
assert.ok(/muda os 3 componentes deste tipo/.test(tres.impacto), tres.impacto);
assert.ok(/escolha abaixo/.test(tres.impacto), 'a saída tem de estar dita junto: ' + tres.impacto);
assert.ok(!/muda só este designador/.test(tres.impacto), 'no modo "todos" não pode prometer um só');

/* desmarcado: o alcance de antes, palavra por palavra — e sem alarme, porque aí nada
   coletivo acontece */
const tresUm = d({ sym: 'X', how: 'exato', quantos: 3, todos: false });
assert.strictEqual(tresUm.alcance, 1);
assert.strictEqual(tresUm.impactoAlerta, false);
assert.ok(/muda só este designador/.test(tresUm.impacto), tresUm.impacto);
assert.ok(/outros 2 componentes/.test(tresUm.impacto), tresUm.impacto);

/* único do tipo: os dois modos dizem a mesma coisa, porque não há diferença nenhuma entre
   eles — e nenhum dos dois pode soar como alarme */
for (const modo of [{}, { todos: false }]){
  const um = d(Object.assign({ sym: 'X', how: 'exato', quantos: 1 }, modo));
  assert.strictEqual(um.impactoAlerta, false, JSON.stringify(modo));
  assert.strictEqual(um.alcance, 1, JSON.stringify(modo));
  assert.ok(/único deste tipo no projeto/.test(um.impacto), um.impacto);
}
assert.strictEqual(d({ sym: 'X', how: 'exato', quantos: 0 }).impacto, null,
  'nenhum componente no projeto: não há alcance para anunciar');
assert.strictEqual(d({ sym: 'X', how: 'exato', quantos: 0 }).alcance, 0);

/* ── 5b. O VALOR, que é a outra metade do "mesmo tipo" ──
   O caso do pedido, medido no PRJ-UR-DI261924: `RES [ SMD ]` tem 24 componentes e QUATRO
   valores (10K x10, 1K x8, 2K2 x4, 15R x2). Até 2026-09-16 trocar o 10K trocava os 24. */
const val = d({ sym: 'RES', how: 'exato', quantos: 24, quantosValor: 10, valor: '10K' });
assert.strictEqual(val.alcance, 10, 'o padrão passou a ser mesmo tipo E mesmo valor');
assert.strictEqual(val.escopo, 'valor');
assert.ok(/10K/.test(val.impacto), 'o valor tem de estar escrito: ' + val.impacto);
assert.ok(/outros 14/.test(val.impacto), 'e quantos ficam de fora: ' + val.impacto);
assert.strictEqual(val.impactoAlerta, true);

/* os três escopos saem prontos daqui — a tela só desenha o que esta função decidiu */
assert.deepStrictEqual(val.escopos.map(o => o.id), ['valor', 'tipo', 'um']);
assert.deepStrictEqual(val.escopos.map(o => o.n), [10, 24, 1]);
assert.ok(/10K/.test(val.escopos[0].rotulo), val.escopos[0].rotulo);
assert.ok(/qualquer valor/.test(val.escopos[1].rotulo), val.escopos[1].rotulo);

/* o alcance de antes continua a um clique, e diz em voz alta o que faz */
const tipo = d({ sym: 'RES', how: 'exato', quantos: 24, quantosValor: 10, valor: '10K',
                 escopo: 'tipo' });
assert.strictEqual(tipo.alcance, 24);
assert.ok(/TODOS os valores/.test(tipo.impacto), tipo.impacto);
assert.strictEqual(tipo.impactoAlerta, true);

const umSo = d({ sym: 'RES', how: 'exato', quantos: 24, quantosValor: 10, valor: '10K',
                 escopo: 'um' });
assert.strictEqual(umSo.alcance, 1);
assert.strictEqual(umSo.impactoAlerta, false);

/* SEM VALOR DECLARADO nada muda: é o conector, o test point, o LED. Medido nos 8 projetos,
   63 dos 76 grupos estão neste caso, e partir qualquer um deles pelo rótulo deixaria os
   outros 27 conectores para trás. */
const semVal = d({ sym: 'CONE PADRAO', how: 'exato', quantos: 19 });
assert.strictEqual(semVal.alcance, 19, 'sem valor, o alcance é o símbolo inteiro, como sempre foi');
assert.deepStrictEqual(semVal.escopos.map(o => o.id), ['valor', 'um'],
  'sem valor não existe a opção "qualquer valor": ela seria a mesma coisa duas vezes');
assert.ok(!/valor/.test(semVal.escopos[0].rotulo), semVal.escopos[0].rotulo);

/* único do seu valor entre vários do símbolo: não é alarme, e explica por que é um só.
   E "trocar os 1 com valor 4.7 uF" não pode existir: é "trocar só este" com plural errado. */
const unico = d({ sym: 'CAP', how: 'exato', quantos: 15, quantosValor: 1, valor: '4.7 uF' });
assert.strictEqual(unico.alcance, 1);
assert.strictEqual(unico.impactoAlerta, false);
assert.ok(/único de valor 4\.7 uF/.test(unico.impacto), unico.impacto);
assert.deepStrictEqual(unico.escopos.map(o => o.id), ['tipo', 'um'],
  'a opção "por valor" some quando ela é a mesma que "só este"');
assert.ok(!/os 1 /.test(unico.escopos.map(o => o.rotulo).join(' ')),
  'nenhum rótulo pode dizer "os 1": ' + unico.escopos.map(o => o.rotulo).join(' | '));
assert.strictEqual(unico.escopo, 'um', 'o padrão cai para "só este" quando o valor é único');

/* com um componente só do tipo não há escolha de alcance para oferecer */
assert.deepStrictEqual(d({ sym: 'X', how: 'exato', quantos: 1 }).escopos, []);

/* ── 5c. A LEITURA DO VALOR ──
   De onde ele sai, na ordem medida nos projetos da casa. */
const v = SF.valorDoComp;
assert.strictEqual(v({ params: 'Value=10K' }), '10k', 'o parâmetro Value é a primeira fonte');
assert.strictEqual(v({ params: 'Comment=x;Value=0.1 uF;OdooId=213' }), '0.1 uf',
  'Value no meio da lista, e o espaço interno normalizado');
assert.strictEqual(v({ params: 'value = 2K2 ' }), '2k2', 'maiúsculas e folga não contam');
/* o comment só vale em R… e C…, que foi o pedido: resistor e capacitor */
assert.strictEqual(v({ ref: 'R9', comment: '2k2' }), '2k2');
assert.strictEqual(v({ ref: 'C4', comment: '0,1uF' }), '0,1uf');
assert.strictEqual(v({ ref: 'CN1', comment: 'CONEXÃO COM FIO SOLDADO' }), '',
  'conector não tem valor: partir por rótulo deixaria 18 conectores para trás');
assert.strictEqual(v({ ref: 'TP7', comment: 'test point' }), '');
assert.strictEqual(v({ ref: 'D11', comment: '1A / 1000 V M7 1n4007' }), '',
  'diodo sem parâmetro fica como está: o pedido foi resistor e capacitor');
/* a fórmula do Altium por resolver NÃO é valor: ela é idêntica nos 24 resistores */
assert.strictEqual(v({ ref: 'R17', comment: "=Value + ' - ' + Potência" }), '');
/* o parâmetro vence o comment, inclusive em R e C */
assert.strictEqual(v({ ref: 'R1', params: 'Value=10K', comment: '1K' }), '10k');
assert.doesNotThrow(() => v());
assert.strictEqual(v(null), '');
assert.strictEqual(v({}), '');

/* a chave do "mesmo tipo": símbolo e valor, e um não pode vazar para o outro */
const t = SF.tipoDoComp;
assert.strictEqual(t({ sym: 'RES', params: 'Value=10K' }), t({ sym: 'RES', params: 'Value=10k' }),
  'o valor é comparado sem caixa');
assert.notStrictEqual(t({ sym: 'RES', params: 'Value=10K' }), t({ sym: 'RES', params: 'Value=1K' }));
assert.notStrictEqual(t({ sym: 'RES', params: 'Value=10K' }), t({ sym: 'CAP', params: 'Value=10K' }));
assert.notStrictEqual(t({ sym: 'RES', params: 'Value=10K' }), t({ sym: 'RES1', params: 'Value=0K' }),
  'concatenar sem separador faria RES+10K casar com RES1+0K');

/* ── 6. entrada torta não derruba a tela ── */
assert.doesNotThrow(() => d());
assert.doesNotThrow(() => d({}));
assert.strictEqual(d({}).rotulo, 'Procurar componente no acervo…');
assert.strictEqual(d({ sym: '', how: 'escolha' }).destaque, true, 'nome vazio é ausência de símbolo');
assert.strictEqual(d({ sym: 'X', quantos: -5 }).impacto, null);
assert.strictEqual(d({ sym: 'X', how: 'inventado' }).motivo, null, 'how desconhecido não vaza cru');

console.log('test-troca-simbolo OK (rótulo, motivo do resolveSym, desfazer, pinagem 8x3, '
          + 'pinagem desconhecida, alcance por tipo E VALOR antes do clique, leitura do valor)');
