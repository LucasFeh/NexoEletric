/* As escritas da IA respeitam a equipe do projeto e entram no histórico "pela IA" (mcp/lib/equipe.js, 1.84.0).

   Um Nexo Hub de mentira (equipe._provedor: a resposta do /api/v1/sessao), um projeto numa pasta temporária com
   responsável e um colaborador, e o Contexto do MCP gravando por ctx.grava (o caminho de toda ferramenta). Sem o app
   aberto nesta pasta, o histórico vai na linha simples, direto em Projects/<p>/Historico/<id>.jsonl.

     node tests/test-mcp-equipe.js */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');

const RAIZ = path.join(__dirname, '..');
const equipe = require('../mcp/lib/equipe.js');
const { Contexto } = require('../mcp/lib/contexto.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-equipe-'));
const D = path.join(TMP, 'Projects', 'P1');
fs.mkdirSync(D, { recursive: true });
fs.writeFileSync(path.join(D, 'changes.js'), 'var changes = [\n];\n');
fs.writeFileSync(path.join(D, 'equipe.json'), JSON.stringify({ formato: 'nexoeletric-equipe-1',
  responsavel: { id: 'u-dono', login: 'dono', nome: 'Davi Dono' }, colaboradores: [{ id: 'u-colab', login: 'colab', nome: 'Carla' }] }));

let resposta = null;
equipe._provedor(() => resposta);
const como = (id, admin) => ({ ok: true, logado: true, usuario: { id, login: id, nome: 'Nome ' + id, admin: !!admin } });

(async () => {
  const ctx = new Contexto({ root: RAIZ, projetos: path.join(TMP, 'Projects'), hubUrl: 'http://127.0.0.1:1', log: () => {} });
  const arq = path.join(D, 'changes.js');
  const grava = async (sessao, n) => {
    resposta = sessao;
    await equipe.sessao(true);
    return ctx.grava(arq, `var changes = [\n{"op":"via_add","x":${n},"y":1},\n];\n`, 'pcb_via');
  };

  // quem é de fora não grava (nem ninguém logado)
  await assert.rejects(grava(como('u-fora'), 1), e => /Só o responsável \(Davi Dono\)/.test(e.message) && e.extra.codigo === 'sem_permissao');
  await assert.rejects(grava({ ok: true, logado: false, usuario: null }, 2), /Só o responsável/);
  assert.strictEqual(fs.readFileSync(arq, 'utf8'), 'var changes = [\n];\n', 'o arquivo não mudou');
  // o colaborador, o responsável e o admin gravam; o Hub antigo (404) libera
  assert.strictEqual(await grava(como('u-colab'), 3), true);
  assert.strictEqual(await grava(como('u-dono'), 4), true);
  assert.strictEqual(await grava(como('u-admin', true), 5), true);
  assert.strictEqual(await grava({ status: 404 }, 6), true);
  // fora do projeto (Libs/): sem dono
  resposta = como('u-fora'); await equipe.sessao(true);
  const lib = path.join(TMP, 'Libs', 'x.js');
  assert.strictEqual(ctx.grava(lib, '// x\n', 't'), true);

  // o histórico: a linha simples (o app não está aberto nesta pasta), com quem estava logado e a ferramenta
  await new Promise(r => setTimeout(r, 1500));
  const h = path.join(D, 'Historico', 'u-colab.jsonl');
  assert.ok(fs.existsSync(h), 'o histórico do colaborador');
  const e = JSON.parse(fs.readFileSync(h, 'utf8').trim().split('\n')[0]);
  assert.deepStrictEqual([e.origem, e.usuario.nome, e.arquivo, e.tipo, e.ferramentas], ['ia', 'Nome u-colab', 'changes.js', 'pcb', ['pcb_via']]);
  assert.ok(fs.existsSync(path.join(D, 'Historico', 'sem-login.jsonl')), 'Hub antigo: sem autor');
  assert.ok(!fs.existsSync(path.join(TMP, 'Libs', 'Historico')), 'Libs/ não tem histórico');

  // projeto_criar: quem está logado é o responsável
  resposta = como('u-novo'); await equipe.sessao(true);
  const novo = path.join(TMP, 'Projects', 'P2');
  fs.mkdirSync(novo);
  assert.strictEqual(equipe.nova(novo), true);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(novo, 'equipe.json'), 'utf8')).responsavel.nome, 'Nome u-novo');

  // 1.87.0: o apenas visualizador (Nexo Hub 2.27.0) -- a IA não edita por ele, nem no projeto em que é o responsável,
  // nem na biblioteca; as ferramentas de leitura e de saída (exportar, JLC) seguem
  const vis = (id) => ({ ok: true, logado: true, usuario: { id, login: id, nome: 'Nome ' + id, admin: false, visualizador: true, funcao: 'visualizador' } });
  const MSG = /apenas visualizador — peça ao administrador do Nexo Hub/;
  const antesVis = fs.readFileSync(arq, 'utf8');
  await assert.rejects(grava(vis('u-dono'), 7), e => MSG.test(e.message) && e.extra.codigo === 'sem_permissao');
  assert.strictEqual(fs.readFileSync(arq, 'utf8'), antesVis, 'o visualizador não gravou');
  assert.throws(() => ctx.grava(lib, '// y\n', 't'), e => MSG.test(e.message) && e.extra.codigo === 'sem_permissao');
  assert.strictEqual(equipe.usuario().visualizador, true);
  const ferr = {};
  for (const f of fs.readdirSync(path.join(RAIZ, 'mcp', 'ferramentas'))) {
    const m = require(path.join(RAIZ, 'mcp', 'ferramentas', f));
    for (const t of [].concat(Array.isArray(m) ? m : (m.ferramentas || Object.values(m)))) if (t && t.nome) ferr[t.nome] = t;
  }
  for (const n of equipe.SAIDAS) assert.ok(ferr[n], 'a saída ' + n + ' existe');
  for (const n of ['pcb_via', 'sch_adicionar', 'sym_salvar', 'fp_salvar', 'projeto_criar', 'projeto_abrir_altium', 'regras_definir', 'local_criar', 'sinal_criar', 'nexo_projeto_restaurar'])
    assert.match(equipe.recusaFerramenta(ferr[n]) || '', MSG, n + ' é edição');
  for (const n of ['gerber_gerar', 'pdf_layout', 'pcb_render_3d', 'jlc_enviar', 'vista_abrir', 'lote'])
    assert.strictEqual(equipe.recusaFerramenta(ferr[n]), null, n + ' é saída');
  const leituras = Object.values(ferr).filter(t => t.leitura);
  assert.ok(leituras.length > 20 && leituras.every(t => equipe.recusaFerramenta(t) === null), 'as de leitura passam');
  // o mesmo login, de volta a usuário comum no Hub (sem reiniciar): grava de novo; e o comum não tem ferramenta barrada
  assert.strictEqual(await grava(como('u-dono'), 8), true);
  assert.strictEqual(equipe.recusaFerramenta(ferr.pcb_via), null);

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('ok: test-mcp-equipe (permissão, histórico pela IA, responsável do projeto novo, visualizador)');
})().catch(e => { console.error(e); fs.rmSync(TMP, { recursive: true, force: true }); process.exit(1); });
