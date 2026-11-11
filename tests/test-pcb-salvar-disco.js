/* NexoEletric 1.97.2 — a vista PCB não grava por cima de uma edição feita por fora (pedido do dono: "a vista PCB aberta
   regravou o arquivo de mudanças com a lista antiga da memória e desfez uma edição feita por fora pelo MCP").
   Roda o trecho do salvar do pcbframe.js (de "const SOBRESCREVER" até o salvaAnnotations) num vm, com o HubIO, o
   HubDialog e a página de mentira, e o HubCore de verdade:
     1. o MCP grava DEPOIS de a página carregar: o autosave para e avisa; nada é gravado;
     2. o Ctrl+S pergunta: "recarregar" recarrega sem gravar; "sobrescrever" grava a lista daqui;
     3. o changes.js que não existia e o MCP criou: o mesmo (antes ele virava a base calado);
     4. o disco igual ao que a página carregou: grava sem perguntar, e a base passa a ser o gravado;
     5. o vigia (discoMudou) também vê a mudança de fora pela lista, não pelo texto.
   node tests/test-pcb-salvar-disco.js */
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path'), vm = require('vm');
const HC = require('../hub-core.js');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'pcbframe.js'), 'utf8');
const trecho = (de, ate) => { const i = SRC.indexOf(de), j = SRC.indexOf(ate, i); assert.ok(i >= 0 && j > i, 'trecho ' + de); return SRC.slice(i, j); };
const SALVAR = trecho('const SOBRESCREVER', 'async function salvaAnnotations');
const VIGIA = trecho('async function discoMudou', 'window.__hubOnChange');
assert.ok(/let chBase = JSON\.stringify\(CH\);/.test(SRC.slice(0, SRC.indexOf('function opsDoTexto'))), 'a base é tirada no carregamento');

const op = (ref, x) => ({ op:'comp_move', ref, x, y:1, orig_x:0, orig_y:0, orig_rot:0, orig_layer:'Top' });
const texto = ops => HC.serializeChanges(ops).text;

function vista(carregado, disco, escolha){
  const st = { disco, gravados:[], toasts:[], perguntas:[], recarregou:false, rodape:'' };
  const CH = JSON.parse(JSON.stringify(carregado));
  const ctx = {
    CH, HC, CH_REL:'Projects/P/changes.js', chDisco:null, chBase:JSON.stringify(CH), staleWorkspace:false, annDirty:false, chDirty:true,
    console, JSON, Array, String, Function, Promise, isFinite,
    HubIO:{ canPost:true,
      fetchText: async () => { if (st.disco == null) throw new Error('404'); return st.disco; },
      saveFile: async (p, t) => { st.gravados.push(t); st.disco = t; return { mode:'server' }; },
      download(){} },
    HubDialog:{ toast: (t, k) => st.toasts.push([k, t]), confirm: async () => true, alert: async () => {},
      escolhe: async (m, o) => { st.perguntas.push(m); return escolha; } },
    setChDirty: v => { ctx.chDirty = !!v; }, avisoRodape: t => { st.rodape = t; },
    salvaAnnotations: async () => true, assinaturaBoard: async () => null, location:{ reload(){ st.recarregou = true; } },
  };
  vm.createContext(ctx);
  vm.runInContext('var annDisco = null, boardSig = null;\n' + SALVAR + '\n' + VIGIA
    + '\nthis.salvaChanges = salvaChanges; this.discoMudou = discoMudou; this.base = () => chBase;', ctx);
  return { ctx, st, CH };
}

(async () => {
  let ok = 0;
  /* 1. o MCP gravou depois do carregamento; aqui houve uma edição: o autosave não grava por cima */
  {
    const carregado = [op('R1', 1)];
    const v = vista(carregado, texto([op('R1', 1), op('R2', 2)]), null);
    v.CH.push(op('R3', 3));
    assert.strictEqual(await v.ctx.salvaChanges(true), false);
    assert.strictEqual(v.st.gravados.length, 0, 'nada gravado');
    assert.ok(v.st.toasts.some(([k, t]) => k === 'warn' && /autosave parou/.test(t)), JSON.stringify(v.st.toasts));
    assert.ok(/R2/.test(v.st.disco), 'a edição do MCP ficou no disco');
    ok++;
  }
  /* 2. o Ctrl+S pergunta: recarregar ou sobrescrever */
  {
    const v = vista([op('R1', 1)], texto([op('R1', 1), op('R2', 2)]), 'recarregar');
    v.CH.push(op('R3', 3));
    await v.ctx.salvaChanges(false);
    assert.strictEqual(v.st.perguntas.length, 1);
    assert.ok(v.st.recarregou && !v.st.gravados.length, 'recarregou sem gravar');
    const w = vista([op('R1', 1)], texto([op('R1', 1), op('R2', 2)]), 'sobrescrever');
    w.CH.push(op('R3', 3));
    assert.strictEqual(await w.ctx.salvaChanges(false), true);
    assert.ok(/R3/.test(w.st.gravados[0]) && !/R2/.test(w.st.gravados[0]), 'gravou a lista daqui');
    const c = vista([op('R1', 1)], texto([op('R1', 1), op('R2', 2)]), null);
    c.CH.push(op('R3', 3));
    assert.strictEqual(await c.ctx.salvaChanges(false), false, 'cancelar não grava');
    assert.strictEqual(c.st.gravados.length, 0);
    ok++;
  }
  /* 3. o changes.js não existia quando a página abriu; o MCP o criou */
  {
    const v = vista([], texto([op('R9', 9)]), null);
    assert.deepStrictEqual([...(await v.ctx.discoMudou())], ['changes.js'], 'o vigia vê');
    v.CH.push(op('R1', 1));
    assert.strictEqual(await v.ctx.salvaChanges(true), false);
    assert.strictEqual(v.st.gravados.length, 0, 'não passou por cima do que o MCP criou');
    ok++;
  }
  /* 4. o disco é o que a página carregou: grava sem perguntar, e o gravado vira a base */
  {
    const v = vista([op('R1', 1)], '// um comentário\n' + texto([op('R1', 1)]), null);
    v.CH.push(op('R2', 2));
    assert.strictEqual(await v.ctx.salvaChanges(true), true);
    assert.strictEqual(v.st.perguntas.length + v.st.toasts.filter(([k]) => k === 'warn').length, 0);
    assert.ok(/um comentário/.test(v.st.gravados[0]), 'os comentários // do disco ficam');
    assert.strictEqual(v.ctx.base(), JSON.stringify(v.CH), 'a base agora é o gravado');
    v.CH.push(op('R3', 3));
    assert.strictEqual(await v.ctx.salvaChanges(true), true, 'a segunda gravação daqui também passa');
    assert.deepStrictEqual([...(await v.ctx.discoMudou())], [], 'o vigia não acusa a gravação daqui');
    ok++;
  }
  /* 5. a vista Esquema: o mesmo (a base tirada no carregamento, e o vigia pela base) */
  {
    const SCH = fs.readFileSync(path.join(__dirname, '..', 'schframe.js'), 'utf8');
    const corte = (de, ate) => { const i = SCH.indexOf(de), j = SCH.indexOf(ate, i); assert.ok(i >= 0 && j > i, de); return SCH.slice(i, j); };
    assert.ok(SCH.includes('let schBase = JSON.stringify(schematic);'), 'a base do esquema é tirada no carregamento');
    assert.ok(SCH.includes('agenda(async () => { if (schDirty) await saveSchematic(true); })'), 'o autosave do esquema é quieto');
    const codigo = corte('function baseDoTexto', 'function el(tag') + corte('async function schemaDoDiscoMudou', 'window.__hubOnChange');
    const esq = itens => 'var schematic = ' + JSON.stringify({ format:'schmirror-v2', items:itens }) + ';';
    const carregado = { format:'schmirror-v2', items:[{ t:'sheet', name:'s', size:'A4' }] };
    const st = { disco:null };
    const ctx = { JSON, Function, HubIO:{ canPost:true, fetchText: async () => { if (st.disco == null) throw new Error('404'); return st.disco; } },
                  SCH_REL:'x', schDiskSnapshot:null, schBase:JSON.stringify(carregado) };
    vm.createContext(ctx);
    vm.runInContext(codigo + ';this.mudou = schemaDoDiscoMudou;', ctx);
    st.disco = esq(carregado.items);
    assert.strictEqual(await ctx.mudou(), false, 'o disco é o que a aba carregou');
    st.disco = '// outro formato' + String.fromCharCode(10) + esq(carregado.items);
    assert.strictEqual(await ctx.mudou(), false, 'só o texto mudou, o esquema não');
    st.disco = esq(carregado.items.concat([{ t:'netlabel', sheet:'s', net:'A', x:0, y:0 }]));
    assert.strictEqual(await ctx.mudou(), true, 'o MCP acrescentou um rótulo: mudou (antes a base vazia adotava calada)');
    ok++;
  }
  console.log('test-pcb-salvar-disco: ' + ok + ' ok');
})().catch(e => { console.error(e); process.exit(1); });
