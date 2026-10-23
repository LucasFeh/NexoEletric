/* O envio à JLCPCB (mcp/lib/jlc.js, o motor do botão "Enviar pra JLC" e das ferramentas jlc_* do MCP)
   contra um IntegrateBrowser FALSO: um HTTP local com o mesmo protocolo (POST /ferramenta {nome,
   params}, token no ponteiro) que responde como a página medida em cart.jlcpcb.com/quote. Nada sai
   desta máquina. Confere: as camadas pelo X2 do Gerber, o .zip, a quantidade da lista da JLC, o fluxo
   até o carrinho, o desvio para o login, e que a senha não volta em resposta nenhuma nem no relato. */
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'test-jlc-'));
process.env.INTEGRATEBROWSER_CONEXAO = path.join(TMP, 'integratebrowser.json');
const JLC = require('../mcp/lib/jlc.js');

/* ---- 1. camadas e .zip ---- */
const gerb = (nome, funcao) => ({ nome, texto: '%TF.GenerationSoftware,NexoEletric*%\n%TF.FileFunction,' + funcao + '*%\nM02*\n' });
const conj4 = [gerb('a_copper_signal_top.gbr', 'Copper,L1,Top'), gerb('a_copper_signal_1.gbr', 'Copper,L2,Inr'), gerb('a_copper_signal_2.gbr', 'Copper,L3,Inr'),
  gerb('a_copper_signal_bot.gbr', 'Copper,L4,Bot'), gerb('a_legend_top.gbr', 'Legend,Top'), gerb('a_profile.gbr', 'Profile,NP')];
assert.strictEqual(JLC.camadasCobre(conj4), 4);
assert.strictEqual(JLC.camadasCobre([{ nome: 'x.GTL', texto: '' }, { nome: 'x.GBL', texto: '' }, { nome: 'x.GTO', texto: '' }]), 2, 'sem X2: pelo nome');
assert.deepStrictEqual([1, 2, 3, 4, 5, 6].map(JLC.camadasJlc), [1, 2, 4, 4, 6, 6], 'a JLC faz 1, 2 ou par');
const gdir = path.join(TMP, 'Projects', 'Placa X', 'Gerber');
fs.mkdirSync(gdir, { recursive: true });
for (const a of conj4) fs.writeFileSync(path.join(gdir, a.nome), a.texto);
fs.writeFileSync(path.join(gdir, 'gerber.json'), JSON.stringify({ base: 'Placa X', arquivos: conj4.map(a => ({ nome: a.nome })) }));

(async () => {
  const pr = await JLC.preparar(gdir, { pasta: path.join(TMP, 'zip'), nome: 'Placa X' });
  assert.strictEqual(pr.camadas, 4); assert.strictEqual(pr.arquivos, 6);
  const z = fs.readFileSync(pr.zip);
  assert.strictEqual(z.readUInt32LE(0), 0x04034b50, 'é um .zip');
  assert.ok(/Placa_X\.zip$/.test(pr.zip), 'nome do .zip sem espaço: ' + pr.zip);
  console.log('  camadas pelo X2, 1/2/par da JLC e o .zip ok');

  /* ---- 2. o IntegrateBrowser falso ---- */
  const SENHA = 'S3nh@-Secreta-Teste';
  const est = { url: '', logado: false, qtd: '5', camada: '2', subiu: null, cliques: [], digitado: [], chamadas: [] };
  const srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', d => { b += d; });
    req.on('end', () => {
      const ok = r => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, resultado: r })); };
      if (req.headers.authorization !== 'Bearer tk') { res.writeHead(403); return res.end('{}'); }
      if (req.url === '/saude') return ok({ ok: true });
      const { nome, params } = JSON.parse(b);
      est.chamadas.push(nome);
      const c = params.codigo || '';
      switch (nome) {
        case 'janela': return ok({});
        case 'navegar': est.url = params.url; return ok({ aba: 'g9', url: params.url });
        case 'enviar_arquivo': est.subiu = params.arquivos[0]; return ok({ aba: 'g9' });
        case 'digitar': est.digitado.push(params.seletor); if (params.seletor.includes('senha')) est.senhaDigitada = params.texto; return ok({ aba: 'g9' });
        case 'captura': return ok({ __imagem: 'AAAA', mime: 'image/jpeg' });
        case 'clicar':
          est.cliques.push(params.seletor);
          if (params.seletor === 'button.saveCart') est.url = est.logado ? 'https://cart.jlcpcb.com/shopcart' : 'https://passport.jlcpcb.com/#/login';
          if (params.seletor === '[data-nexo-jlc=entrar]') { est.logado = est.senhaDigitada === SENHA; if (est.logado) est.url = 'https://jlcpcb.com/'; }
          return ok({ aba: 'g9' });
        case 'js': {
          let r = null;
          if (c === 'location.href') r = est.url;
          else if (c.includes("querySelector('#uploadFile')")) r = /quote/.test(est.url);
          else if (c.includes('Detected')) r = est.subiu ? { texto: 'Detected 4 layer board of 45x60mm(1.772x2.362 inches).' } : null;
          else if (c.includes("textContent.trim() === '") && c.includes('pcb-layers-label')) { const n = /=== '(\d+)'/.exec(c)[1]; const antes = est.camada; est.camada = n; r = { antes }; }
          else if (c.includes('pcb-layers-label')) r = est.camada;
          else if (c.includes('#QtyDom')) { est.qtd = /=== '(\d+)'/.exec(c)[1]; r = { ok: true }; }
          else if (c.includes('Calculated Price')) r = '$18.40';
          else if (c.includes('passport') && c.includes('shopcart')) r = /passport/.test(est.url) ? 'login' : /shopcart/.test(est.url) ? 'carrinho' : '';
          else if (c === 'document.body.innerText') r = 'Shopping Cart\nPlaca_X.zip  4 Layers  10 pcs';
          else if (c.includes('input[type=password]') && c.includes('data-nexo-jlc')) r = /passport/.test(est.url) ? 'ok' : '';
          else if (c.includes('!/passport')) r = !/passport/.test(est.url);
          else if (c.includes('iframe')) r = false;
          else if (c.includes('el-form-item__error')) r = 'Incorrect username or password';
          return ok({ aba: 'g9', resultado: r });
        }
      }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, erro: 'ferramenta ' + nome }));
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  fs.writeFileSync(process.env.INTEGRATEBROWSER_CONEXAO, JSON.stringify({ url: 'http://127.0.0.1:' + srv.address().port, token: 'tk' }));

  /* quantidade fora da lista: recusa sem abrir nada */
  await assert.rejects(JLC.enviar({ zip: pr.zip, camadas: 4, quantidade: 8 }), /a mais perto é 10/);
  assert.strictEqual(est.chamadas.length, 0);

  /* sem login: sobe, marca 4 camadas e a quantidade, e para no login */
  const r1 = await JLC.enviar({ zip: pr.zip, camadas: 4, quantidade: 10 });
  assert.strictEqual(r1.etapa, 'login');
  assert.strictEqual(est.subiu, path.resolve(pr.zip));
  assert.strictEqual(est.camada, '4'); assert.strictEqual(est.qtd, '10');
  assert.strictEqual(r1.camadas, 4); assert.strictEqual(r1.preco, '$18.40'); assert.strictEqual(r1.dimensoes, '45 x 60 mm');

  /* login errado: não entra, e a senha não volta */
  const rErr = await JLC.login({ usuario: 'eu@dieletrons.com', senha: 'errada' });
  assert.strictEqual(rErr.etapa, 'erro');
  /* login certo, e o envio vai até o carrinho */
  const rl = await JLC.login({ usuario: 'eu@dieletrons.com', senha: SENHA });
  assert.strictEqual(rl.etapa, 'logado');
  assert.ok(!JSON.stringify(rl).includes(SENHA) && !JSON.stringify(rErr).includes(SENHA), 'a senha não volta na resposta');
  const r2 = await JLC.enviar({ zip: pr.zip, camadas: 4, quantidade: 10 });
  assert.strictEqual(r2.etapa, 'carrinho'); assert.strictEqual(r2.noCarrinho, true);
  assert.ok(r2.imagem && r2.imagem.base64, 'a captura volta para conferir');
  console.log('  envio: quantidade da lista, 4 camadas, login, carrinho e a captura ok');

  /* 3 camadas de cobre: a JLC recebe 4, e o aviso diz */
  est.camada = '2';
  const r3 = await JLC.enviar({ zip: pr.zip, camadas: 3, quantidade: 5 });
  assert.strictEqual(est.camada, '4'); assert.ok(r3.avisos.some(a => /leu 4/.test(a)) === false, 'a JLC leu 4 = o alvo (4): sem aviso');

  /* o relato do MCP (o indicador "IA" do app) não mostra a senha */
  const relato = fs.readFileSync(path.join(__dirname, '..', 'mcp', 'lib', 'relato.js'), 'utf8');
  const resumo = new Function('module', relato.replace(/^'use strict';/m, '').replace(/const \{ sondaHub \} = require\([^)]*\);/, 'const sondaHub = null;').replace(/const crypto = require\([^)]*\);/, 'const crypto = {};') + ';return resumo;')({});
  const linha = resumo({ usuario: 'eu@x.com', senha: SENHA });
  assert.ok(!linha.includes(SENHA) && /senha •••/.test(linha), 'relato: ' + linha);

  /* a ferramenta do MCP existe e a skill também */
  const F = require('../mcp/ferramentas/jlc.js');
  assert.deepStrictEqual(F.ferramentas.map(t => t.nome), ['jlc_preparar', 'jlc_enviar', 'jlc_login']);
  const S = require('../mcp/lib/skills.js');
  const sk = S.ler('pcb-enviar-jlc');
  assert.ok(sk && /PERGUNTE A QUANTIDADE/.test(sk.corpo) && /jlc_login/.test(sk.corpo), 'a skill pcb-enviar-jlc');
  console.log('  relato sem a senha, ferramentas e skill ok');

  srv.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('test-jlc: ok');
})().catch(e => { console.error(e); process.exit(1); });
