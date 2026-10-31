// A face da placa no 3D sai PRETA (2026-10-30, a PBIDP-DI261944 no NexoEletric): uma textura sRGB com mipmap
// subida de um <canvas> acelerado (na GPU) ganha os niveis 1 em diante pretos no Chromium/ANGLE desta casa
// (medido no Edge 156 com WebGL2 puro: 3725x3463, 3433x3384, 3000x3000 e 4000x3000 pretos; 4096x3000 e
// 2500x1500 certos). O nivel amostrado depende do zoom, da janela e da escala do Windows (125% mostra o
// preto), entao "as vezes fica tudo preto". O mesmo canvas na memoria (willReadFrequently) sobe certo em
// todos os tamanhos medidos. Aqui: todo canvas que vira textura da face nasce com willReadFrequently.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const R = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* um DOM minimo: o canvas guarda os atributos do PRIMEIRO getContext (como o navegador) */
const criados = [];
globalThis.document = {
  createElement(tag){
    assert.strictEqual(tag, 'canvas');
    const c = { width:0, height:0, attrs:undefined, ctx:null,
      getContext(k, a){
        if (!this.ctx) {
          this.attrs = a;
          const w = () => this.width, h = () => this.height;
          this.ctx = { getImageData:() => ({ data:new Uint8ClampedArray(w() * h() * 4).fill(255) }),
                       createImageData:(x, y) => ({ data:new Uint8ClampedArray(x * y * 4) }), putImageData(){} };
        }
        return this.ctx;
      } };
    criados.push(c);
    return c;
  },
};
const T = { SRGBColorSpace:'srgb', NoColorSpace:'',
  CanvasTexture: class { constructor(img){ this.image = img; this.colorSpace = ''; } } };

const M = await import(pathToFileURL(path.join(R, 'hub-pcb3d-real.js')).href);
const fonte = document.createElement('canvas'); fonte.width = 37; fonte.height = 35;
fonte.getContext('2d', { willReadFrequently:true });
const F = M.mapasDaFace(T, fonte, 'hasl');
for (const k of ['map', 'orm', 'coat', 'bump']) {
  const c = F[k].image;
  assert.ok(c.attrs && c.attrs.willReadFrequently === true, 'mapasDaFace: o canvas do ' + k + ' nasce na memoria (willReadFrequently)');
}
assert.strictEqual(F.map.colorSpace, 'srgb');

/* a vista: o canvas da face nasce na memoria ANTES da linha que a janela Rust (NexoEletric-rust,
   remendo "face-na-memoria") troca -- essa linha tem de continuar igual, ou o remendo nao encaixa */
const vista = fs.readFileSync(path.join(R, 'hub-pcb3d-vista.js'), 'utf8').replace(/\r/g, '');
const ancora = "    const x = tc.getContext('2d');\n    x.setTransform(s, 0, 0, -s, -bb.x1 * s, bb.y2 * s);";
const i = vista.indexOf(ancora);
assert.ok(i > 0, 'a ancora do remendo face-na-memoria continua no hub-pcb3d-vista.js');
const antes = vista.slice(vista.lastIndexOf('function texturaFace', i), i);
assert.ok(/tc\.getContext\('2d', \{ willReadFrequently:true \}\)/.test(antes), 'texturaFace: o canvas da face nasce na memoria');
console.log('test-pcb3d-face-cpu OK (as texturas da face saem de canvas na memoria)');
