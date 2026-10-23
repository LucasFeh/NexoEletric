/* NexoEletric MCP - grupo "jlc": a placa no carrinho da JLCPCB, pelo IntegrateBrowser.

   O motor é o mcp/lib/jlc.js (o mesmo do botão "Enviar pra JLC" da vista PCB). O passo a passo que
   a IA segue está na skill pcb-enviar-jlc (mcp/skills): perguntar a quantidade ANTES, entrar na
   conta com o login e a senha que a pessoa der, salvar no carrinho e conferir a captura.

   Nunca passa do carrinho: pagar, frete e endereço ficam com a pessoa. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { ErroMcp } = require('../lib/contexto.js');
const { PROJETO } = require('../lib/util.js');
const JLC = require('../lib/jlc.js');

const gerberGerar = () => require('./saidas.js').ferramentas.find(t => t.nome === 'gerber_gerar');
const temGerber = dir => fs.existsSync(path.join(dir, 'Gerber', 'gerber.json'));

/* o Gerber do projeto em .zip: gera e grava antes (gerber_gerar) quando pedido ou quando não há */
async function prepara(a, ctx) {
  const p = ctx.projeto(a.projeto);
  let gerado = null;
  if (a.gerar !== false && (a.gerar === true || !temGerber(p.dir))) gerado = await gerberGerar().executa({ projeto: a.projeto, salvar: true }, ctx);
  const pr = await JLC.preparar(path.join(p.dir, 'Gerber'), { nome: p.nome });
  let tamanho = '';
  try { const bb = ctx.placa(p).eb.board.bbox; tamanho = (bb.x2 - bb.x1).toFixed(2) + ' x ' + (bb.y2 - bb.y1).toFixed(2) + ' mm'; } catch (_) { /* sem placa */ }
  return { p, pr, tamanho, avisosGerber: gerado ? (gerado.avisos || []).filter(x => /^ATEN/i.test(x)) : [] };
}
const imagem = r => { const img = r.imagem; delete r.imagem; return img ? Object.assign(r, { _imagem: img }) : r; };

module.exports = {
  grupo: 'jlc',
  ordem: 80,
  titulo: 'JLCPCB — a placa no carrinho (IntegrateBrowser)',
  modulos: ['hub-gerber.js'],
  ferramentas: [
    {
      nome: 'jlc_preparar', titulo: 'JLC: preparar o pedido', leitura: true,
      descricao: 'Primeiro passo do envio à JLCPCB (skill pcb-enviar-jlc): gera o Gerber do projeto (gerar:true, ou quando não há um salvo), monta o .zip e diz quantas camadas de cobre a placa tem, o que a JLC vai receber (1, 2 ou par) e o tamanho. Use a resposta para PERGUNTAR A QUANTIDADE ao usuário antes de jlc_enviar — quantidades_jlc são as únicas que a JLC aceita. Não abre o navegador.',
      entrada: { type: 'object', properties: { projeto: PROJETO, gerar: { type: 'boolean', description: 'true: gera e grava o Gerber de novo antes; padrão: usa o salvo (gera se não houver)' } }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const { pr, tamanho, avisosGerber } = await prepara(a, ctx);
        return { zip: pr.zip, arquivos: pr.arquivos, gerber_gerado: pr.gerado, camadas_cobre: pr.camadas, camadas_jlc: pr.camadasJlc, tamanho,
                 avisos_gerber: avisosGerber, quantidades_jlc: JLC.QTDS,
                 proximo: 'pergunte quantas placas o usuário quer (uma de quantidades_jlc) e só então chame jlc_enviar' };
      },
    },
    {
      nome: 'jlc_enviar', titulo: 'JLC: pôr no carrinho',
      descricao: 'Abre o orçamento da JLCPCB no IntegrateBrowser, sobe o .zip do Gerber do projeto, confere as camadas que a JLC leu contra as da placa, põe a quantidade e clica SAVE TO CART. Só chame DEPOIS de o usuário dizer a quantidade (jlc_preparar). etapa:"login" = a conta não está aberta: peça o login e a senha ao usuário, chame jlc_login e depois jlc_enviar de novo. etapa:"carrinho" = salvo; a captura vem junto: CONFIRA na imagem (arquivo, camadas, quantidade, preço) antes de dizer ao usuário que está pronto. Nunca vai além do carrinho (pagamento é com o usuário).',
      entrada: { type: 'object', properties: {
        projeto: PROJETO,
        quantidade: { type: 'integer', description: 'quantas placas (uma das quantidades da JLC: 5, 10, 15, 20, 25, 30, 50, 75, 100...)' },
        gerar: { type: 'boolean', description: 'true: gera e grava o Gerber de novo antes; padrão: o salvo (gera se não houver)' },
        mostrar: { type: 'boolean', description: 'padrão true: a janela do IntegrateBrowser aparece para o usuário acompanhar' },
      }, required: ['projeto', 'quantidade'] },
      executa: async (a, ctx) => {
        if (!JLC.QTDS.includes(Number(a.quantidade))) throw new ErroMcp('a JLC não vende ' + a.quantidade + ' placas — a mais perto é ' + JLC.qtdPerto(Number(a.quantidade)) + ' (quantidades: ' + JLC.QTDS.slice(0, 14).join(', ') + '…)');
        const { pr, tamanho } = await prepara(a, ctx);
        const r = await JLC.enviar({ zip: pr.zip, camadas: pr.camadas, quantidade: Number(a.quantidade), mostrar: a.mostrar !== false });
        return imagem(Object.assign(r, { zip: pr.zip, camadas_cobre: pr.camadas, tamanho_placa: tamanho,
          proximo: r.etapa === 'login' ? 'peça ao usuário o login e a senha da JLC, chame jlc_login e depois jlc_enviar de novo'
            : r.etapa === 'carrinho' ? 'confira a captura (arquivo, camadas, quantidade, preço) e diga ao usuário que está no carrinho — pagar é com ele'
            : 'confira a captura: a tela depois do SAVE TO CART não foi reconhecida' }));
      },
    },
    {
      nome: 'jlc_login', titulo: 'JLC: entrar na conta',
      descricao: 'Entra na conta da JLCPCB no IntegrateBrowser com o usuário (ou e-mail) e a senha que o USUÁRIO deu nesta conversa. A senha é só digitada no campo: não volta na resposta, não é gravada e não aparece no indicador do app. Nunca a repita nem a guarde em memória/arquivo. etapa:"captcha" = a JLC pediu verificação: a janela abre e o usuário resolve lá; depois chame jlc_enviar. A sessão fica no IntegrateBrowser: da próxima vez normalmente não precisa entrar de novo.',
      entrada: { type: 'object', properties: {
        usuario: { type: 'string', description: 'o usuário ou e-mail da conta JLCPCB' },
        senha: { type: 'string', description: 'a senha da conta (dada pelo usuário agora; não guarde)' },
        mostrar: { type: 'boolean', description: 'padrão false: a janela só aparece se houver captcha' },
      }, required: ['usuario', 'senha'] },
      executa: async (a) => imagem(await JLC.login({ usuario: a.usuario, senha: a.senha, mostrar: !!a.mostrar })),
    },
  ],
};
