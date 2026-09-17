/* O desfecho do envio da lista ao Odoo — a regra que o DMB quebrou.
 *
 *     node tests/test-odoolista-desfecho.js
 *
 * O DEFEITO QUE ISTO PRENDE: `enviar()` testava `estado === 'recusada'` ANTES de
 * `gravou === false`, e um uid já decidido volta com os DOIS ao mesmo tempo. Resultado: todo
 * reenvio de uma lista recusada — que não altera nada no Odoo — abria o modal vermelho
 * bloqueante com o motivo VELHO, como se a recusa tivesse acabado de acontecer. O ramo
 * honesto ("já está decidida, nada mudou") era inalcançável. Foi isso que fez o
 * "DMB - DI231765_P2", recusado uma vez em 16/09/2026, cobrar para sempre.
 *
 * A raiz é conceitual: o código lia o ESTADO devolvido como se fosse um EVENTO. Recusa é
 * evento quando o estado MUDOU — daí o `estadoAntes`.
 *
 * E o pedido do dono, de 2026-09-17: recusa não precisa de motivo. Foi recusada e pronto;
 * a tela não pode tratar motivo ausente como falta, nem mandar ninguém trocar de revisão.
 */
'use strict';
const assert = require('assert');

/* o módulo se auto-inicia no DOMContentLoaded; com readyState 'loading' ele só registra o
   listener e `inicia()` não roda — é o que deixa carregá-lo fora do navegador */
global.document = { readyState: 'loading', addEventListener() {} };
global.window = global;

const { pure } = require('../hub-odoolista.js');
const desfecho = pure.desfechoDoEnvio;
assert.strictEqual(typeof desfecho, 'function', 'desfechoDoEnvio precisa estar no `pure`');

/* ── 1. o caso do DMB: reenvio de uma lista já recusada ──────────────────────
   O Odoo devolve estado E gravou:false juntos. Isso NÃO é recusa nova. */
let d = desfecho({ referencia: 'LISTA/2026/0210', estado: 'recusada', gravou: false,
                   motivo_recusa: '' }, 'recusada');
assert.strictEqual(d.tipo, 'nada-mudou', 'reenvio de lista decidida não é recusa nova');
assert.strictEqual(d.titulo, '', 'sem título = sem modal bloqueante');
assert.ok(/não alterou nada/.test(d.texto), d.texto);
assert.ok(!/revis/i.test(d.texto), 'não pode mandar trocar a revisão: ' + d.texto);
console.log('(1) reenvio de lista recusada: toast honesto, sem modal e sem mandar trocar revisão ok');

/* mesmo com motivo escrito, o reenvio continua sendo "nada mudou" — o motivo é velho */
d = desfecho({ referencia: 'LISTA/2026/0210', estado: 'recusada', gravou: false,
               motivo_recusa: 'faltou o capacitor X' }, 'recusada');
assert.strictEqual(d.tipo, 'nada-mudou', 'motivo velho não ressuscita a recusa');
assert.ok(!/faltou o capacitor/.test(d.texto), 'não repetir o motivo velho: ' + d.texto);
console.log('(2) motivo antigo não reabre o modal num reenvio ok');

/* ── 3. recusa NOVA com motivo: aí sim o modal, porque há texto para ler ───── */
d = desfecho({ referencia: 'LISTA/2026/0210', estado: 'recusada', gravou: true,
               motivo_recusa: 'faltou o capacitor X' }, 'recebida');
assert.strictEqual(d.tipo, 'recusa-nova', 'estado mudou: é recusa nova');
assert.strictEqual(d.titulo, 'Lista recusada', 'recusa nova com motivo abre modal');
assert.ok(/faltou o capacitor X/.test(d.texto), d.texto);
console.log('(3) recusa NOVA com motivo: modal, com o motivo dentro ok');

/* ── 4. recusa NOVA sem motivo: foi recusada e pronto ────────────────────── */
d = desfecho({ referencia: 'LISTA/2026/0210', estado: 'recusada', gravou: true,
               motivo_recusa: '' }, 'recebida');
assert.strictEqual(d.tipo, 'recusa-nova');
assert.strictEqual(d.titulo, '', 'sem motivo não abre modal bloqueante');
assert.ok(!/escrito|motivo/i.test(d.texto),
          'motivo ausente não pode ser tratado como falta: ' + d.texto);
assert.ok(/foi recusada/.test(d.texto), d.texto);
console.log('(4) recusa sem motivo: avisa e acabou, sem cobrar explicação ok');

/* ── 5. o caminho feliz não mudou ─────────────────────────────────────────── */
d = desfecho({ referencia: 'LISTA/2026/0218', estado: 'recebida', gravou: true,
               linhas_pendentes: 3 }, '');
assert.strictEqual(d.tipo, 'ok');
assert.ok(/LISTA\/2026\/0218/.test(d.texto) && /recebida/.test(d.texto)
          && /3 pend/.test(d.texto), d.texto);
console.log('(5) envio normal continua dizendo referência, estado e pendências ok');

/* ── 6. bordas: recibo vazio e recusada que continua recusada sem gravou ──── */
d = desfecho(null, '');
assert.strictEqual(d.tipo, 'ok', 'recibo ausente não pode explodir');
d = desfecho({ estado: 'recusada' }, 'recusada');
assert.strictEqual(d.tipo, 'ok',
                   'recusada que já era recusada e o Odoo regravou não merece alarme');
console.log('(6) recibo vazio e recusa repetida sem gravou não viram alarme ok');

console.log('test-odoolista-desfecho OK (recusa é evento, não estado; e sem motivo está tudo bem)');
