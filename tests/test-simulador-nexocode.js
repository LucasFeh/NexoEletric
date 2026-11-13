/* O MCU e o NexoCode no Simulador (1.103.2): sem código do NexoCode ligado o microcontrolador fica cinza com um X;
   com o NexoCode ligado (gpio_lote a cada 0,3 s rodando, batimento de 1 s parado), verde.
     node tests/test-simulador-nexocode.js
   Confere no hub-simulador.js: o estado por designador, o desconectar, que o lote só de batimento não anda a
   simulação nem repinta o painel, que o desenho vai no quadro do laço (nenhum requestAnimationFrame a mais) e o
   estado no MCP. */
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path');
const s = fs.readFileSync(path.join(__dirname, '..', 'hub-simulador.js'), 'utf8');

let n = 0;
function caso(nome, fn) { fn(); n++; console.log('ok  ' + nome); }

caso('estado da conexão por MCU, com validade de 3,5 s', () => {
  assert.ok(/const NC_VALIDO = 3500;/.test(s));
  const m = /function ncLigado\(ref\) \{([^}]*)\}/.exec(s);
  assert.ok(m, 'ncLigado');
  /* a função de verdade, com um st de mentira */
  const st = { nexoCode: { U1: { em: Date.now(), rodando: true }, U9: { em: Date.now() - 5000, rodando: false } } };
  const ncLigado = new Function('st', 'NC_VALIDO', 'return function ncLigado(ref) {' + m[1] + '}')(st, 3500);
  assert.ok(ncLigado('U1') && ncLigado('U1').rodando === true);
  assert.strictEqual(ncLigado('U9'), null, 'sem lote há mais de 3,5 s: cinza');
  assert.ok(!ncLigado('U2'));
});

caso('gpio_lote guarda a conexão; desconectar apaga na hora', () => {
  const i = s.indexOf("case 'gpio_lote': {"), j = s.indexOf("case 'recolher':", i);
  const g = s.slice(i, j);
  assert.ok(/if \(a\.desconectar\) delete st\.nexoCode\[mcu\.ref\];/.test(g));
  assert.ok(/else if \(a\.origem === 'nexocode'\) st\.nexoCode\[mcu\.ref\] = \{ em: Date\.now\(\), rodando: a\.rodando !== false \};/.test(g));
  /* o batimento (lote vazio) não anda a simulação nem analisa nem repinta o painel */
  assert.ok(/else if \(aplicado\.length && st\.sim\)/.test(g) && /if \(acionados\.length\) \{ st\.res/.test(g));
  assert.ok(/if \(remonta \|\| aplicado\.length \|\| acionados\.length\) painel\.atualiza\(\);/.test(g));
});

caso('desenho no quadro do laço: cinza com X ou contorno verde, e a pílula', () => {
  const i = s.indexOf('function desenha(ctx, cam) {'), j = s.indexOf('function hexA(', i);
  const d = s.slice(i, j);
  assert.ok(/const mcusNc = \[\];/.test(d) && /if \(!nc && !\(inf && inf\.tipo === 'mcu'\)\) continue;/.test(d));
  assert.ok(/rgba\(55,65,81,\.55\)/.test(d) && /ctx\.moveTo\(cx - d, cy - d\); ctx\.lineTo\(cx \+ d, cy \+ d\)/.test(d), 'cinza com o X');
  assert.ok(/ctx\.strokeStyle = '#22c55e'/.test(d), 'verde');
  assert.ok(/sem NexoCode \(sem controle\)/.test(d) && /firmware rodando/.test(d));
  assert.ok(!/requestAnimationFrame|agenda\(\)/.test(d), 'nenhum quadro extra');
});

caso('o estado do MCP diz qual MCU está com o NexoCode', () => {
  assert.ok(/nexocode: Object\.fromEntries\(Object\.keys\(st\.nexoCode \|\| \{\}\)/.test(s));
});

const pcb = fs.readFileSync(path.join(__dirname, '..', 'hub-simulador-pcb.js'), 'utf8');
const pf = fs.readFileSync(path.join(__dirname, '..', 'pcbframe.js'), 'utf8');
caso('1.105.1: o clique no 3D chega ao Simulador (pointerdown) e não seleciona o componente do editor', () => {
  /* a vista 3D da preventDefault no pointerdown: o mousedown nunca chega (so pointerdown, pointerup e click) */
  assert.ok(/alvo\.addEventListener\('pointerdown', e => \{[\s\S]{0,200}if \(trataClique\(e\)\) \{ e\.stopPropagation\(\); return; \}/.test(pcb), 'o 3D trata o clique no pointerdown');
  assert.ok(/if \(H\.em3d\(\)\) return;   \/\* o 3D trata no pointerdown/.test(pcb), 'o mousedown não trata de novo no 3D');
  assert.ok(/if \(AREA_SIM\) return;/.test(pf) && (pf.match(/if \(AREA_SIM\) return;/g) || []).length >= 2, 'aoClicar/aoMenu sem efeito na área do Simulador');
  assert.ok(/function soltaAnel\(\)/.test(pcb) && /if \(fixo\) soltaAnel\(\);/.test(pcb), 'o anel do pad não gruda');
});
caso('1.105.2: o MCU marcado fica SELECIONADO (o destaque do editor) enquanto o balão está aberto — sem a seta 3D', () => {
  assert.ok(!/ConeGeometry\(2\.6, 4\.5/.test(pcb) && /V\.extra\('nexocode-mcu', null\)/.test(pcb), 'sem a seta enorme');
  assert.ok(/window\.HubMcpVista\.selecionar\(\{ refs: \[\.\.\.setasMcu\.keys\(\)\] \}\)/.test(pcb), 'a seleção acompanha o balão');
  assert.ok(/marcaSetaMcu\(hit, \/\^\(rod\|par\)\\|\/\.test\(b\.sig \|\| ''\)\);/.test(pcb), 'abre com o balão do MCU');
  assert.ok(/if \(sa && sa\.con !== con\) \{ sa\.con = con; montaSetas\(\); \}/.test(pcb), 'muda de cor quando conecta/desconecta');
  assert.ok(/if \(b\.mcu && setasMcu\.delete\(b\.mcu\)\) montaSetas\(\);/.test(pcb), 'fecha com o balão');
});
console.log('test-simulador-nexocode: ' + n + ' casos ok');
