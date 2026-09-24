/* O conector multiparte na folha (pedido de 2026-09-24):
     - o número do pino — que no conector de uma parte por pino É o número da parte — não pode
       sair de cabeça para baixo quando o componente está girado 180° (hub-draw.js » dePe);
     - o designador aparece só na parte 1 do conector; CI multiparte continua com ele em toda
       parte (schframe.js » designadorAparece).
   Provado com um ctx de mentira, sem navegador: ele anota o ângulo total com que cada texto foi
   escrito, e a conta é a mesma que o canvas faria. */
const assert = require('assert');
const D = require('../hub-draw.js');
const SF = require('../schframe.js');

/* ── 1. a regra ── */
{
  const t = (ang, rot, align) => { const r = D.dePe(ang, rot, align); return [((r.ang % 360) + 360) % 360, r.align]; };
  assert.deepStrictEqual(t(0, 0, 'center'),   [0, 'center'],   'sem giro, nada muda');
  assert.deepStrictEqual(t(0, 180, 'center'), [180, 'center'], '180°: meia volta, e o total fica 360 — de pé');
  assert.deepStrictEqual(t(0, 90, 'center'),  [0, 'center'],   '90°: vertical lendo de baixo para cima, como no Altium');
  assert.deepStrictEqual(t(0, 270, 'center'), [180, 'center'], '270°: vira 90, não lê de cima para baixo');
  assert.deepStrictEqual(t(90, 180, 'left'),  [270, 'right'],  'o alinhamento troca de lado junto com a meia volta');
  assert.deepStrictEqual(t(0, 180, 'left'),   [180, 'right']);
}

/* ── 2. o desenho: o ângulo TOTAL com que o número do pino é escrito ── */
function ctxEspiao(rotInicial){
  let ang = rotInicial, pilha = [];
  const escritos = [];
  return {
    escritos,
    save(){ pilha.push(ang); }, restore(){ ang = pilha.pop(); },
    rotate(r){ ang += r * 180 / Math.PI; },
    translate(){}, scale(){}, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, fill(){}, rect(){},
    arc(){}, ellipse(){}, closePath(){}, measureText: s => ({ width: String(s).length * 6 }),
    fillText(txt){ escritos.push({ txt, ang: Math.round(((ang % 360) + 360) % 360), align: this.textAlign }); },
  };
}
/* a parte 3 do CONE PADRAO: um pino só, número 3 */
const parte3 = { part:3, pins:[{ num:'3', name:'3', x:-100, y:0, len:100, orient:0 }],
                 graphics:[{ g:'arc', cx:-195, cy:0, r:30, sa:0, ea:360, w:10 }] };
for (const rot of [0, 90, 180, 270]){
  const ctx = ctxEspiao(rot);          /* o schframe gira o componente antes de chamar */
  D.drawSymbolPart(ctx, parte3, { rot, honraOlho:false });
  const num = ctx.escritos.find(e => e.txt === '3');
  assert.ok(num, 'o número do pino foi escrito');
  assert.ok(num.ang === 0 || num.ang === 90, 'rot ' + rot + ': o número sai de pé (ângulo total ' + num.ang + '°)');
}
/* sem `rot` (as previews de biblioteca), o desenho é o de sempre */
{
  const ctx = ctxEspiao(0);
  D.drawSymbolPart(ctx, parte3, { honraOlho:false });
  assert.strictEqual(ctx.escritos.find(e => e.txt === '3').ang, 0);
}
/* o nome do pino (dentro do corpo) também fica de pé */
{
  const ci = { part:1, pins:[{ num:'1', name:'VCC', x:-100, y:0, len:100, orient:180 },
                             { num:'2', name:'GND', x:0, y:-100, len:100, orient:270 }], graphics:[] };
  for (const rot of [0, 90, 180, 270]){
    const ctx = ctxEspiao(rot);
    D.drawSymbolPart(ctx, ci, { rot, honraOlho:false });
    for (const nome of ['VCC', 'GND']){
      const e = ctx.escritos.find(x => x.txt === nome);
      assert.ok(e && (e.ang === 0 || e.ang === 90), 'rot ' + rot + ': ' + nome + ' de pé (' + (e && e.ang) + '°)');
    }
  }
}

/* ── 3. o designador do conector multiparte ── */
{
  const conector = { parts:[{ pins:[{ num:'1' }] }, { pins:[{ num:'2' }] }, { pins:[{ num:'3' }] }] };
  const ci = { parts:[{ pins:[1, 2, 3].map(n => ({ num:String(n) })) }, { pins:[4, 5, 6].map(n => ({ num:String(n) })) }] };
  const vis = (ref, part, sym) => SF.designadorAparece({ ref, part }, sym, sym && sym.parts[part - 1]);
  assert.strictEqual(vis('CN2', 1, conector), true,  'parte 1 do conector: designador');
  assert.strictEqual(vis('CN2', 2, conector), false, 'parte 2 do conector: só o número');
  assert.strictEqual(vis('CN2', 3, conector), false);
  assert.strictEqual(vis('U4', 2, ci), true,         'CI multiparte: designador em toda parte');
  /* um pino por parte, mesmo com outro prefixo, é conector */
  assert.strictEqual(vis('K1', 2, conector), false);
  /* conector SEM DESENHO (símbolo não resolvido, quadrado vermelho sem pino): o designador fica —
     escondido, o quadrado ficaria anônimo (134 partes medidas em 2026-09-24) */
  assert.strictEqual(SF.designadorAparece({ ref:'CN7', part:4 }, null, null), true);
  assert.strictEqual(SF.designadorAparece({ ref:'CN7', part:4 }, null, { pins:[{ num:'4' }] }), false, 'com desenho de emergência (tem pino): só o número');
  assert.strictEqual(SF.designadorAparece({ ref:'IC3', part:2 }, null, null), true, 'sem símbolo e sem prefixo de conector: mostra');
  assert.strictEqual(SF.designadorAparece({ ref:'CN1' }, null, null), true, 'sem part é a parte 1');
}

console.log('test-pino-de-pe: OK');
