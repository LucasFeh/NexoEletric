const assert = require('assert');

/* ═══════════════ a camera compartilhada ═══════════════
   HubDraw.mkCamera e a vista 2D de quase tudo: simbolo e footprint na Biblioteca, o corpo
   dos componentes no Esquema. O que se garante aqui e a NAVEGACAO, que e igual em todas as
   vistas do hub — inclusive a regra pedida depois: Shift + roda anda para os lados em vez
   de ampliar. Sem isto, rolar uma lista larga com Shift preso ampliava sem querer. */

global.window = { addEventListener(){}, devicePixelRatio: 1 };
const HubDraw = require('../hub-draw.js');

function fakeCanvas(W, H) {
  const reg = {};
  const ctx = new Proxy({}, { get: () => () => {}, set: () => true });
  return {
    clientWidth: W, clientHeight: H, width: W, height: H,
    getContext: () => ctx,
    addEventListener(t, fn){ (reg[t] = reg[t] || []).push(fn); },
    fire(t, ev){ (reg[t] || []).forEach(fn => fn(Object.assign({ preventDefault(){} }, ev))); },
  };
}

const cv = fakeCanvas(800, 600);
let pintou = 0;
const cam = HubDraw.mkCamera(cv, () => { pintou++; }, { bg:'#000' });
cam.resize();
cam.fit({ x1:0, y1:0, x2:100, y2:50 });

assert.ok(pintou > 0, 'a camera nao desenhou');
assert.ok(Math.abs(cam.cam.cx - 50) < 1e-9 && Math.abs(cam.cam.cy - 25) < 1e-9, 'fit nao centrou');

/* Shift + roda: anda na horizontal, e a escala nao muda */
{
  const e0 = cam.cam.scale, x0 = cam.cam.cx, y0 = cam.cam.cy;
  cv.fire('wheel', { deltaY:120, shiftKey:true, offsetX:400, offsetY:300, deltaMode:0 });
  assert.strictEqual(cam.cam.scale, e0, 'Shift + roda ampliou');
  assert.ok(cam.cam.cx > x0, 'Shift + roda nao andou para a direita');
  assert.strictEqual(cam.cam.cy, y0, 'Shift + roda mexeu na vertical');
  /* rolar para cima volta: o gesto tem de ser reversivel */
  cv.fire('wheel', { deltaY:-120, shiftKey:true, offsetX:400, offsetY:300, deltaMode:0 });
  assert.ok(Math.abs(cam.cam.cx - x0) < 1e-9, 'nao voltou ao ponto de partida');
}

/* alguns navegadores ja trocam deltaY por deltaX quando o Shift esta preso: vale o que vier */
{
  const x0 = cam.cam.cx;
  cv.fire('wheel', { deltaX:120, deltaY:0, shiftKey:true, offsetX:400, offsetY:300, deltaMode:0 });
  assert.ok(cam.cam.cx > x0, 'deltaX com Shift foi ignorado');
  cv.fire('wheel', { deltaX:-120, deltaY:0, shiftKey:true, offsetX:400, offsetY:300, deltaMode:0 });
}

/* sem Shift a roda continua ampliando, ancorada no cursor */
{
  const e0 = cam.cam.scale;
  const antes = cam.toWorld(200, 150);
  cv.fire('wheel', { deltaY:-120, shiftKey:false, offsetX:200, offsetY:150, deltaMode:0 });
  const depois = cam.toWorld(200, 150);
  assert.ok(cam.cam.scale > e0, 'a roda parou de ampliar');
  assert.ok(Math.abs(antes.x - depois.x) < 1e-6 && Math.abs(antes.y - depois.y) < 1e-6,
    'o ponto sob o cursor escapou ao ampliar');
}

/* deltaMode de linha (Firefox) vale 16 px, e nao 1 */
{
  const x0 = cam.cam.cx;
  cv.fire('wheel', { deltaY:1, shiftKey:true, offsetX:400, offsetY:300, deltaMode:1 });
  assert.ok(Math.abs((cam.cam.cx - x0) - 16 / cam.cam.scale) < 1e-9,
    'uma linha nao virou 16 px: ' + (cam.cam.cx - x0));
}

console.log('test-camera: ok');
