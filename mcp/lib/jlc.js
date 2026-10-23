/* NexoEletric - jlc.js: o Gerber da placa no carrinho da JLCPCB, pelo IntegrateBrowser.

   Pedido do dono (2026-10-23): "em Gerber eu já consiga clicar em 'enviar pra JLC', ele já abre o
   IntegrateBrowser e já coloca no carrinho da JLC o ZIP; e uma skill no MCP pra isso também: pergunta
   o login e a senha, entra e faz todo o processo de adicionar ao carrinho, visualiza pra ver se está
   tudo certo; pela quantidade de layers da PCB ele já sabe o que configurar; só pergunta antes de
   iniciar quantas placas vai querer".

   UM motor para os dois caminhos:
     - o MCP (mcp/ferramentas/jlc.js: jlc_preparar, jlc_enviar, jlc_login) chama as funções daqui;
     - o botão "Enviar pra JLC" da vista PCB chama a rota /api/jlc do hub (tools/rotas/jlc.py), que
       roda `node mcp/lib/jlc.js --cli` (no app: o NexoEletric.exe com ELECTRON_RUN_AS_NODE=1).

   O IntegrateBrowser é o navegador do Nexo Hub. Ele aceita a IA por um HTTP local com token: o
   ponteiro <APPDATA>/Nexo Hub/integratebrowser.json traz {url, token} e POST /ferramenta {nome,
   params} roda uma ferramenta dele (as mesmas do MCP integratebrowser). Hub fechado: abre o
   NexoHub.exe --navegador-ia, como o MCP dele faz. INTEGRATEBROWSER_CONEXAO troca o ponteiro (testes).

   A PÁGINA DA JLC (medida em cart.jlcpcb.com/quote, 2026-10-23):
     - o upload é o <input type=file id=uploadFile> (escondido; o enviar_arquivo põe o .zip nele);
     - a JLC lê o Gerber e escreve "Detected 4 layer board of 45x60mm(...)" e já marca a camada
       (o botão de Layers com a classe `cur`);
     - PCB Qty: o span .qtySelect dentro de #QtyDom abre um popover só com as quantidades da lista
       (QTDS; "3 ou 8 peças" não existem, diz a própria página);
     - button.saveCart; sem login ele leva a passport.jlcpcb.com ("Username or Email", "Password",
       "Sign In", com reCAPTCHA).
   O que não deu para medir ainda (a volta do login e a tela do carrinho) é conferido pelo texto e
   pela captura que voltam: quem chama (a IA ou a pessoa, na janela) olha antes de dizer "pronto".

   A SENHA: só passa por login(); vai digitada no campo e não volta em resultado, aviso nem erro.
   Nada é gravado. O relato do MCP (relato.js) esconde os argumentos senha/token.

   Nunca passa do carrinho: pagar, endereço e frete ficam com a pessoa. */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const QUOTE = 'https://cart.jlcpcb.com/quote';
const LOGIN = 'https://passport.jlcpcb.com/';
/* as quantidades do popover PCB Qty, lidas da página */
const QTDS = [5, 10, 15, 20, 25, 30, 50, 75, 100, 125, 150, 200, 250, 300, 350, 400, 450, 500, 600, 700, 750, 800, 900,
  1000, 1200, 1250, 1400, 1500, 1600, 1750, 1800, 2000, 2400, 2500, 2800, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500,
  7000, 7500, 8000, 8500, 9000, 9500, 10000, 11000, 12000, 13000, 14000, 15000, 16000, 17000, 18000, 19000, 25000, 30000,
  40000, 50000, 60000, 70000];
const EXTS = /\.(gbr|gtl|gbl|gto|gbo|gts|gbs|gtp|gbp|gko|gm1|g[0-9]+|drl|txt)$/i;
const espera = ms => new Promise(r => setTimeout(r, ms));

/* ============================== o Gerber e o .zip ============================== */

/* camadas de COBRE de um conjunto Gerber: o atributo X2 %TF.FileFunction,Copper,...% de cada arquivo
   (o hub-gerber escreve; o Altium também); sem X2, o nome (copper_signal / .gtl .gbl .g1..) */
function camadasCobre(arquivos) {
  let x2 = 0, nome = 0;
  for (const a of arquivos) {
    const t = String(a.texto || '').slice(0, 4000);
    if (/%TF\.FileFunction,Copper,/i.test(t)) x2++;
    if (/copper|\.(gtl|gbl|g[0-9]+)$/i.test(a.nome) && !/drill/i.test(a.nome)) nome++;
  }
  return x2 || nome;
}
/* a JLC fabrica 1, 2 ou número par: placa de 3 ou 5 camadas sai com 4 ou 6 (o aviso da própria página) */
const camadasJlc = n => (n <= 2 ? Math.max(1, n) : n % 2 ? n + 1 : n);

/* os arquivos do último Gerber gravado em Projects/<p>/Gerber/ (o gerber.json diz quais) */
function lerGerber(gdir) {
  let man = null;
  try { man = JSON.parse(fs.readFileSync(path.join(gdir, 'gerber.json'), 'utf8')); } catch (_) { /* sem manifesto */ }
  let nomes = man && Array.isArray(man.arquivos) ? man.arquivos.map(a => a && a.nome).filter(Boolean) : null;
  if (!nomes) { try { nomes = fs.readdirSync(gdir).filter(f => EXTS.test(f)); } catch (_) { nomes = []; } }
  const arquivos = [];
  for (const n of nomes) { try { arquivos.push({ nome: n, texto: fs.readFileSync(path.join(gdir, n), 'utf8') }); } catch (_) { /* sumiu */ } }
  return { arquivos, base: (man && man.base) || '', gerado: (man && man.gerado) || '' };
}
const nomeLimpo = s => String(s || 'placa').replace(/[^A-Za-z0-9 _.()+-]+/g, '_').replace(/\s+/g, '_').slice(0, 80) || 'placa';

/* monta o .zip (hub-gerber.js, o mesmo do "Baixar .zip") numa pasta temporária: o que sobe para a
   JLC se refaz a partir de Gerber/, então não fica nada a mais no projeto */
async function preparar(gdir, o) {
  o = o || {};
  const G = require(path.join(__dirname, '..', '..', 'hub-gerber.js'));
  const { arquivos, base, gerado } = lerGerber(gdir);
  if (!arquivos.length) throw new Error('nenhum Gerber gravado em ' + gdir + ' (gere e salve no projeto antes)');
  const cobre = camadasCobre(arquivos);
  if (!cobre) throw new Error('o Gerber não tem camada de cobre (confira o conjunto)');
  const dir = o.pasta || path.join(os.tmpdir(), 'NexoEletric-JLC');
  fs.mkdirSync(dir, { recursive: true });
  const zip = path.join(dir, nomeLimpo(o.nome || base) + '.zip');
  fs.writeFileSync(zip, Buffer.from(await G.zip(arquivos, { deflate: true })));
  return { zip, base, gerado, arquivos: arquivos.length, camadas: cobre, camadasJlc: camadasJlc(cobre), bytes: fs.statSync(zip).size };
}

/* ============================== o IntegrateBrowser ============================== */

function arqConexao() {
  if (process.env.INTEGRATEBROWSER_CONEXAO) return path.resolve(process.env.INTEGRATEBROWSER_CONEXAO);
  return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Nexo Hub', 'integratebrowser.json');
}
const lerPonteiro = () => { try { return JSON.parse(fs.readFileSync(arqConexao(), 'utf8')); } catch (_) { return null; } };
async function vivo(c) {
  if (!c || !c.url || !c.token) return false;
  try { const r = await fetch(c.url + '/saude', { headers: { authorization: 'Bearer ' + c.token }, signal: AbortSignal.timeout(2500) }); return r.ok; } catch (_) { return false; }
}
function exeDoHub() {
  if (process.env.NEXOHUB_EXE) return process.env.NEXOHUB_EXE;
  for (const p of [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'NexoHub', 'NexoHub.exe'),
                   path.join(process.env.LOCALAPPDATA || '', 'Programs', 'NexoHub', 'NexoHub.exe')]) if (fs.existsSync(p)) return p;
  return null;
}
async function conexao() {
  const c = lerPonteiro();
  if (await vivo(c)) return c;
  const exe = exeDoHub();
  if (!exe) throw new Error('não achei o Nexo Hub nesta máquina (o IntegrateBrowser vem dentro dele): instale-o pelo painel do Nexo Hub');
  const env = Object.assign({}, process.env); delete env.ELECTRON_RUN_AS_NODE;
  spawn(exe, ['--navegador-ia'], { detached: true, stdio: 'ignore', env, windowsHide: false }).unref();
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    await espera(500);
    const n = lerPonteiro();
    if (await vivo(n)) return n;
  }
  throw new Error('o Nexo Hub não abriu o IntegrateBrowser em 30 s — abra o Nexo Hub e tente de novo');
}

/* uma guia só, a deste envio: toda ferramenta vai nela (aba), para não mexer na guia que a IA ou a
   pessoa estão usando */
class Guia {
  constructor(c) { this.c = c; this.aba = null; }
  async chama(nome, params) {
    const p = Object.assign({}, params || {});
    if (this.aba && !p.aba && nome !== 'janela') p.aba = this.aba;
    let r, j;
    try {
      r = await fetch(this.c.url + '/ferramenta', { method: 'POST', headers: { authorization: 'Bearer ' + this.c.token, 'content-type': 'application/json' },
        body: JSON.stringify({ nome, params: p }), signal: AbortSignal.timeout(3 * 60000) });
      j = await r.json();
    } catch (e) { throw new Error('IntegrateBrowser (' + nome + '): ' + (e && e.message || e)); }
    if (!j.ok) throw new Error('IntegrateBrowser (' + nome + '): ' + (j.erro || 'HTTP ' + r.status));
    const res = j.resultado;
    if (res && res.aba && !this.aba) this.aba = res.aba;
    return res;
  }
  js(codigo) { return this.chama('js', { codigo }).then(r => r && r.resultado); }
  url() { return this.js('location.href'); }
  async ate(codigo, ms, passo) {
    const t0 = Date.now();
    for (;;) {
      let v = null;
      try { v = await this.js(codigo); } catch (_) { v = null; }
      if (v) return v;
      if (Date.now() - t0 > ms) return null;
      await espera(passo || 800);
    }
  }
  async captura() {
    try { const r = await this.chama('captura', {}); return r && r.__imagem ? { base64: r.__imagem, mime: r.mime || 'image/jpeg' } : null; } catch (_) { return null; }
  }
}
async function abreGuia(url, mostrar) {
  const g = new Guia(await conexao());
  if (mostrar) { try { await g.chama('janela', { mostrar: true }); } catch (_) { /* modo leve */ } }
  await g.chama('navegar', { url, nova: true });
  return g;
}

/* ============================== o carrinho ============================== */

const JS_DETECTOU = `(() => {
  const d = [...document.querySelectorAll('div,span,p')].find(e => e.children.length === 0 && /Detected \\d+ layer/i.test(e.textContent));
  if (d) return { texto: d.textContent.trim() };
  const err = [...document.querySelectorAll('.el-message--error,.el-message-box__message,[class*=error]')].find(e => e.offsetParent && e.textContent.trim().length > 3);
  return err ? { erro: err.textContent.trim().slice(0, 300) } : null;
})()`;
const JS_CAMADA = n => `(() => {
  const lab = document.querySelector('.pcb-layers-label'); const row = lab && lab.closest('.main-btn-group');
  if (!row) return { erro: 'não achei a linha Layers' };
  const bs = [...row.querySelectorAll('button')];
  const cur = bs.find(b => /\\bcur\\b/.test(b.className));
  const alvo = bs.find(b => b.textContent.trim() === '${n}');
  if (!alvo) return { erro: 'a JLC não oferece ${n} camadas nesta linha', atual: cur && cur.textContent.trim() };
  if (alvo !== cur) alvo.click();
  return { antes: cur && cur.textContent.trim() };
})()`;
const JS_CAMADA_ATUAL = `(() => { const lab = document.querySelector('.pcb-layers-label'); const row = lab && lab.closest('.main-btn-group');
  const b = row && [...row.querySelectorAll('button')].find(x => /\\bcur\\b/.test(x.className)); return b ? b.textContent.trim() : ''; })()`;
const JS_QTD = n => `(async () => {
  const ref = document.querySelector('#QtyDom .qtySelect'); if (!ref) return { erro: 'não achei o PCB Qty' };
  if (ref.textContent.trim() === '${n}') return { ok: true };
  ref.click(); await new Promise(r => setTimeout(r, 500));
  const pop = document.getElementById(ref.getAttribute('aria-describedby'));
  const b = pop && [...pop.querySelectorAll('button')].find(x => x.textContent.trim() === '${n}');
  if (!b) return { erro: 'a quantidade ${n} não está na lista da JLC' };
  b.click(); await new Promise(r => setTimeout(r, 900));
  return { ok: ref.textContent.trim() === '${n}', agora: ref.textContent.trim() };
})()`;
const JS_PRECO = `(() => {
  const t = document.body.innerText; const i = t.indexOf('Calculated Price');
  const m = i >= 0 ? /\\$\\s?[0-9][0-9,]*\\.[0-9]{2}/.exec(t.slice(i, i + 400)) : null; return m ? m[0] : '';
})()`;

/* a quantidade da JLC mais perto (para a resposta sugerir quando a pedida não existe) */
function qtdPerto(n) {
  let m = QTDS[0];
  for (const q of QTDS) if (Math.abs(q - n) < Math.abs(m - n)) m = q;
  return m;
}

/* Sobe o .zip, confere as camadas, põe a quantidade e salva no carrinho.
   o = {zip, camadas (as de cobre do Gerber), quantidade, mostrar, esperaLogin (ms: com a janela
        aberta, espera a pessoa entrar e refaz), progresso(fn)}
   -> {etapa:'carrinho'|'login'|'conferir', detectado, camadas, quantidade, preco, url, avisos, imagem} */
async function enviar(o) {
  const avisos = [], prog = o.progresso || (() => {});
  const qtd = Number(o.quantidade);
  if (!QTDS.includes(qtd)) throw new Error('a JLC não vende ' + o.quantidade + ' placas: escolha uma de ' + QTDS.slice(0, 12).join(', ') + '… (a mais perto é ' + qtdPerto(qtd) + ')');
  if (!o.zip || !fs.existsSync(o.zip)) throw new Error('o .zip do Gerber não existe: ' + o.zip);
  const alvo = camadasJlc(Number(o.camadas) || 0);
  for (let volta = 0; volta < 2; volta++) {
    prog('abrindo o orçamento da JLC');
    const g = await abreGuia(QUOTE, o.mostrar);
    if (!await g.ate(`!!document.querySelector('#uploadFile')`, 40000)) throw new Error('a página de orçamento da JLC não abriu o campo de upload (mudou? confira em ' + QUOTE + ')');
    prog('subindo o Gerber');
    await g.chama('enviar_arquivo', { seletor: '#uploadFile', arquivos: [path.resolve(o.zip)] });
    const det = await g.ate(JS_DETECTOU, 120000, 1200);
    if (!det) throw new Error('a JLC não terminou de ler o Gerber em 2 min — confira na janela do IntegrateBrowser');
    if (det.erro) throw new Error('a JLC recusou o Gerber: ' + det.erro);
    const md = /Detected (\d+) layer board of ([\d.]+)\s*x\s*([\d.]+)\s*mm/i.exec(det.texto) || [];
    const lidas = Number(md[1]) || 0;
    if (alvo && lidas && lidas !== alvo) avisos.push('a JLC leu ' + lidas + ' camada(s) no Gerber e a placa tem ' + alvo + ': ficou ' + alvo + ' (confira o conjunto)');
    if (alvo) {
      const c = await g.js(JS_CAMADA(alvo));
      if (c && c.erro) throw new Error(c.erro);
    }
    prog('quantidade ' + qtd);
    const q = await g.js(JS_QTD(qtd));
    if (!q || q.erro || !q.ok) throw new Error((q && q.erro) || 'a quantidade não pegou na página (ficou ' + (q && q.agora) + ')');
    await espera(1500);
    const camadaFinal = await g.js(JS_CAMADA_ATUAL);
    const preco = await g.js(JS_PRECO);
    const res = { detectado: det.texto, dimensoes: md[2] ? md[2] + ' x ' + md[3] + ' mm' : '', camadas: Number(camadaFinal) || alvo, quantidade: qtd, preco, avisos };
    if (alvo && Number(camadaFinal) !== alvo) throw new Error('a camada não ficou em ' + alvo + ' (a página mostra ' + camadaFinal + ')');
    prog('salvando no carrinho');
    await g.chama('clicar', { seletor: 'button.saveCart' });
    /* sai do orçamento: login (passport) ou o carrinho */
    const destino = await g.ate(`(() => { const u = location.href; if (/passport\\.jlcpcb\\.com/.test(u)) return 'login';
      if (/shopcart|\\/cart(?!\\.)/i.test(location.pathname + location.hash) || /Shopping Cart|Proceed to Checkout|Secure Checkout/i.test(document.body.innerText)) return 'carrinho';
      return ''; })()`, 25000, 1000);
    if (destino === 'login') {
      if (o.esperaLogin && volta === 0) {
        prog('entre na sua conta da JLC na janela do IntegrateBrowser');
        try { await g.chama('janela', { mostrar: true }); } catch (_) { /* segue */ }
        const ok = await g.ate(`!/passport\\.jlcpcb\\.com/.test(location.href) && /jlcpcb\\.com/.test(location.href)`, o.esperaLogin, 2000);
        if (!ok) return Object.assign(res, { etapa: 'login', url: await g.url(), aviso: 'o login não terminou a tempo' });
        avisos.push('entrou na conta: o Gerber foi enviado de novo (o orçamento recomeça depois do login)');
        continue;
      }
      return Object.assign(res, { etapa: 'login', url: await g.url(), imagem: await g.captura() });
    }
    await espera(2000);
    const base = path.basename(o.zip);
    const texto = String(await g.js('document.body.innerText') || '');
    res.noCarrinho = texto.includes(base) || texto.includes(base.replace(/\.zip$/i, ''));
    res.url = await g.url();
    res.imagem = await g.captura();
    res.etapa = destino === 'carrinho' ? 'carrinho' : 'conferir';
    if (res.etapa === 'conferir') avisos.push('não reconheci a tela do carrinho depois do SAVE TO CART — confira a captura');
    return res;
  }
  throw new Error('o envio não terminou depois do login');
}

/* Entra na conta da JLC com o que a pessoa disse. A senha só vai digitada no campo. Captcha ou
   verificação: a janela aparece e a resposta pede à pessoa terminar lá. */
async function login(o) {
  const usuario = String(o && o.usuario || '').trim(), senha = String(o && o.senha || '');
  if (!usuario || !senha) throw new Error('faltam o usuário (ou e-mail) e a senha da JLC');
  const g = await abreGuia(LOGIN, o.mostrar);
  const campo = await g.ate(`(() => { const p = document.querySelector('input[type=password]'); const u = [...document.querySelectorAll('input')].find(i => i.type !== 'password' && i.type !== 'checkbox' && i.type !== 'hidden' && i.offsetParent);
    if (!p || !u) return ''; u.setAttribute('data-nexo-jlc', 'usuario'); p.setAttribute('data-nexo-jlc', 'senha');
    const b = [...document.querySelectorAll('button')].find(x => /^\\s*Sign In\\s*$/i.test(x.textContent)); if (b) b.setAttribute('data-nexo-jlc', 'entrar'); return 'ok'; })()`, 30000);
  if (!campo) {
    const u = await g.url();
    if (!/passport\.jlcpcb\.com/.test(u)) return { etapa: 'logado', url: u };
    throw new Error('a tela de login da JLC não mostrou os campos (mudou?)');
  }
  await g.chama('digitar', { seletor: '[data-nexo-jlc=usuario]', texto: usuario, limpar: true });
  await g.chama('digitar', { seletor: '[data-nexo-jlc=senha]', texto: senha, limpar: true });
  await g.chama('clicar', { seletor: '[data-nexo-jlc=entrar]' });
  const saiu = await g.ate(`!/passport\\.jlcpcb\\.com/.test(location.href)`, 25000, 1000);
  if (saiu) return { etapa: 'logado', url: await g.url() };
  const msg = String(await g.js(`(() => { const e = [...document.querySelectorAll('.el-form-item__error,.el-message,[class*=error],[class*=tip]')].find(x => x.offsetParent && x.textContent.trim().length > 3); return e ? e.textContent.trim().slice(0, 200) : ''; })()`) || '');
  const captcha = await g.js(`[...document.querySelectorAll('iframe')].some(f => /recaptcha|captcha|geetest/i.test(f.src) && f.offsetParent && f.getBoundingClientRect().height > 100)`);
  try { await g.chama('janela', { mostrar: true }); } catch (_) { /* segue */ }
  return { etapa: captcha ? 'captcha' : 'erro', mensagem: msg.replace(senha, '•••'), url: await g.url(), imagem: await g.captura(),
           aviso: captcha ? 'a JLC pediu a verificação (captcha): resolva na janela do IntegrateBrowser' : 'a JLC não aceitou o login' + (msg ? ': ' + msg.replace(senha, '•••') : '') };
}

module.exports = { QTDS, QUOTE, LOGIN, camadasCobre, camadasJlc, lerGerber, preparar, enviar, login, qtdPerto, arqConexao };

/* ============================== a linha de comando (a rota /api/jlc do hub) ==============================
   node mcp/lib/jlc.js --cli  < {gdir, quantidade, nome?, mostrar?, esperaLogin?}
   escreve uma linha JSON por passo: {"progresso":"..."} e, no fim, {"fim":{...}} ou {"erro":"..."}.
   A captura não vai na linha (é grande): o hub mostra a janela do navegador. */
if (require.main === module && process.argv.includes('--cli')) {
  let ent = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { ent += d; });
  process.stdin.on('end', async () => {
    const diz = o => process.stdout.write(JSON.stringify(o) + '\n');
    try {
      const a = JSON.parse(ent || '{}');
      diz({ progresso: 'montando o .zip do Gerber' });
      const p = await preparar(a.gdir, { nome: a.nome });
      diz({ preparado: { camadas: p.camadas, camadasJlc: p.camadasJlc, arquivos: p.arquivos, zip: p.zip } });
      const r = await enviar({ zip: p.zip, camadas: p.camadas, quantidade: a.quantidade, mostrar: a.mostrar !== false,
                               esperaLogin: a.esperaLogin || 0, progresso: t => diz({ progresso: t }) });
      delete r.imagem;
      diz({ fim: Object.assign(r, { zip: p.zip }) });
    } catch (e) { diz({ erro: String(e && e.message || e) }); }
  });
}
