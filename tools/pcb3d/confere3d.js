/* Confere os corpos 3D de um projeto: o STEP posicionado pela matriz cai onde o Altium disse?

     node tools/pcb3d/confere3d.js <pasta com board3d.js e 3d/> [board.js] --occt <occt-import-js>

   Le o board3d.js (o que o extrai3d.py gravou), passa a placa pelo HubPcb3dModelo.corpos (a mesma
   conta da vista 3D), abre cada STEP com o occt-import-js (o mesmo leitor que o navegador usa; nao
   e dependencia do repo -- aponte com --occt ou OCCT_IMPORT_JS) e mede, por corpo:
     xy  a caixa XY dos vertices transformados contra o contorno que o Altium gravou (`outline`,
         a projecao que ele mesmo calculou do modelo posicionado)        -> erro em mm
     z   a faixa Z contra STANDOFF/OVERALL (Top [so, ov]; Bottom [-esp-ov, -esp-so])
     pads (com board.js) os centros dos pads do componente dentro da caixa XY (+0,3 mm)
     pinos (com board.js, componente com pad passante) cada furo com vertice do modelo ABAIXO da
         placa a menos de raio+0,3 mm -- e o mesmo numero com o modelo girado 180 graus em torno do
         componente: quando o giro errado acerta menos, o pino 1 esta no lugar certo.
   Saida: uma linha por corpo e o resumo; codigo 1 se algum corpo passar de --tol (padrao 0,05 mm). */
'use strict';
const fs = require('fs'), path = require('path');
const M3 = require('../../hub-pcb3d-modelo.js');

function loadVar(arq, nome){ return new Function(fs.readFileSync(arq, 'utf8') + ';return ' + nome + ';')(); }

async function main(argv){
  const args = argv.slice(); let occtPath = process.env.OCCT_IMPORT_JS || '', tol = 0.05;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--occt') { occtPath = args[i+1]; args.splice(i, 2); i--; }
    else if (args[i] === '--tol') { tol = +args[i+1]; args.splice(i, 2); i--; }
  }
  const pasta = args[0];
  if (!pasta || !occtPath) { console.log('uso: node confere3d.js <pasta> [board.js] --occt <caminho do occt-import-js>'); return 2; }
  const d3 = loadVar(path.join(pasta, 'board3d.js'), 'pcbmirror3d');
  const eb = args[1] ? loadVar(args[1], 'pcbmirror') : { components: Object.entries(d3.componentes).map(([ref, c]) => Object.assign({ ref }, c)) };
  const occt = await require(path.resolve(occtPath))();
  const lista = M3.corpos(eb, d3, { base: pasta.replace(/[\\/]*$/, '/'), placeholder: false });
  const porRef = Object.create(null);
  for (const c of (eb.components || [])) porRef[c.ref] = c;
  const esp = d3.thickness, cache = Object.create(null);
  const crus = Object.create(null);
  for (const b of d3.bodies) if (b.kind === 'step') (crus[b.owner] = crus[b.owner] || []).push(b);
  const usados = Object.create(null);
  let n = 0, ok = 0, comPinos = 0, pinosOk = 0, pinoUm = 0, padsTot = 0, padsDentro = 0;
  const falhas = [];
  for (const b of lista) {
    if (b.kind !== 'step' || !b.modelUrl) continue;
    if (!cache[b.modelUrl]) {
      const r = occt.ReadStepFile(fs.readFileSync(b.modelUrl), null);
      const P = [];
      for (const m of r.meshes) { const a = m.attributes.position.array; for (let i = 0; i < a.length; i += 3) P.push([a[i], a[i+1], a[i+2]]); }
      cache[b.modelUrl] = P;
    }
    const k = (usados[b.owner] = (usados[b.owner] || 0) + 1) - 1;
    const cru = (crus[b.owner] || [])[k] || {};
    const M = M3.deColMaior(b.matrix);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const Q = cache[b.modelUrl].map(p => M3.aplica(M, p));
    for (const q of Q) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); z0 = Math.min(z0, q[2]); z1 = Math.max(z1, q[2]); }
    const ol = cru.outline || [];
    const ox = ol.map(p => p[0]), oy = ol.map(p => p[1]);
    const exy = ol.length ? Math.max(Math.abs(x0 - Math.min(...ox)), Math.abs(x1 - Math.max(...ox)), Math.abs(y0 - Math.min(...oy)), Math.abs(y1 - Math.max(...oy))) : NaN;
    const so = b.raw.standoff, ov = b.raw.overall;
    const zz = b.side === 'bottom' ? [-esp - ov, -esp - so] : [so, ov];
    const ez = Math.max(Math.abs(z0 - zz[0]), Math.abs(z1 - zz[1]));
    n++;
    const bom = exy <= tol && ez <= tol;
    if (bom) ok++; else falhas.push(b.owner);
    let txt = `${b.owner.padEnd(6)} ${b.side.padEnd(6)} xy ${exy.toFixed(3)} z ${ez.toFixed(3)} ${bom ? 'ok ' : 'ERRO'}`;
    const c = porRef[b.owner];
    if (c && Array.isArray(c.pads) && c.pads.length) {
      const dentro = c.pads.filter(p => p.x >= x0 - 0.3 && p.x <= x1 + 0.3 && p.y >= y0 - 0.3 && p.y <= y1 + 0.3).length;
      padsTot += c.pads.length; padsDentro += dentro;
      txt += `  pads ${dentro}/${c.pads.length}`;
      const furos = c.pads.filter(p => p.type === 'th' && (p.drill > 0 || p.drillw > 0));
      if (furos.length) {
        const baixo = Q.filter(q => b.side === 'bottom' ? q[2] > 0.05 : q[2] < -esp - 0.05);
        const conta = (pts) => furos.filter(p => { const r = Math.max(p.drill || 0, p.drillw || 0) / 2 + 0.3; return pts.some(q => Math.hypot(q[0] - p.x, q[1] - p.y) <= r); }).length;
        const certo = conta(baixo);
        const gira = baixo.map(q => [2 * c.x - q[0], 2 * c.y - q[1]]);
        const errado = conta(gira);
        if (baixo.length) {
          comPinos++;
          if (certo === furos.length) pinosOk++;
          if (certo > errado) pinoUm++;
          txt += `  pinos ${certo}/${furos.length} (girado 180: ${errado})`;
        }
      }
    }
    console.log(txt);
  }
  console.log(`\nresumo: ${ok}/${n} corpos STEP com caixa e altura dentro de ${tol} mm` +
              (padsTot ? `; pads dentro da caixa ${padsDentro}/${padsTot}` : '') +
              (comPinos ? `; componentes TH com pino abaixo da placa: ${comPinos}, todos os furos com pino ${pinosOk}, giro errado acerta menos ${pinoUm}` : ''));
  if (falhas.length) console.log('fora: ' + falhas.join(', '));
  return falhas.length ? 1 : 0;
}
main(process.argv.slice(2)).then(c => process.exit(c), e => { console.error(e); process.exit(2); });
