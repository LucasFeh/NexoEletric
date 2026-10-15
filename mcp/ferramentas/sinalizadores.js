/* NexoEletric MCP - grupo "sinal": os sinalizadores do usuario (annotations.js, AI-GUIDE Parte C).
   Contrato: a IA LE os abertos antes de mexer, corrige, e so muda status/reply. Nunca apaga nem
   renumera; quem apaga ou reabre e o usuario, pelo hub. A IA pode CRIAR um sinalizador para
   chamar a atencao do usuario (id novo, nunca reaproveitado). */
'use strict';
const { ArquivoLinhas } = require('../lib/arquivo-linhas.js');
const { ErroMcp } = require('../lib/contexto.js');
const { PROJETO, isNum } = require('../lib/util.js');

function abre(p) { return ArquivoLinhas.abrir('annotations', p.arq('annotations.js')); }
function grava(ctx, p, arq, ferramenta) {
  const ser = ctx.hc.serializeAnnotations(arq.itens);
  if (!ser.text) throw new ErroMcp('sinalizadores inválidos: ' + ser.errors.map(e => e.msg).join('; '));
  return ctx.grava(p.arq('annotations.js'), arq.texto(itens => ctx.hc.serializeAnnotations(itens).text), ferramenta);
}
const agora = () => { const d = new Date(), z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`; };

module.exports = {
  grupo: 'sinal',
  ordem: 60,
  titulo: 'Sinalizadores — annotations.js (pendências do usuário)',
  ferramentas: [
    {
      nome: 'sinal_listar', titulo: 'Listar sinalizadores', leitura: true,
      descricao: 'Lista os sinalizadores do projeto (bandeirinhas que o usuário põe na vista PCB): id, view (pcb em mm / sch em mil), posição, camada, severidade, mensagem, ref, status e resposta. LEIA OS ABERTOS ANTES de mexer na placa ou no esquema — são pedidos do usuário para você.',
      entrada: { type: 'object', properties: { projeto: PROJETO, status: { type: 'string', enum: ['open', 'resolved', 'todos'], description: 'padrão open' } }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const L = abre(p).itens;
        const st = a.status || 'open';
        return { total: L.length, abertos: L.filter(x => x.status !== 'resolved').length, sinalizadores: L.filter(x => st === 'todos' || (st === 'open' ? x.status !== 'resolved' : x.status === st)) };
      },
    },
    {
      nome: 'sinal_responder', titulo: 'Responder/resolver sinalizador',
      descricao: 'Marca um sinalizador como resolvido (ou mantém aberto com resolver:false) e escreve a resposta (reply) dizendo o que foi feito. Só status e reply mudam — o resto é do usuário. Faça a correção antes (com note "nX: ..." nas mudanças).',
      entrada: { type: 'object', properties: { projeto: PROJETO, id: { type: 'string' }, reply: { type: 'string' }, resolver: { type: 'boolean', description: 'padrão true' } }, required: ['projeto', 'id', 'reply'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const arq = abre(p);
        const i = arq.itens.findIndex(x => x && x.id === a.id);
        if (i < 0) throw new ErroMcp(`sinalizador "${a.id}" não existe (sinal_listar)`);
        const n = Object.assign({}, arq.itens[i], { reply: String(a.reply).replace(/":/g, '" :'), status: a.resolver === false ? 'open' : 'resolved' });
        arq.substitui(i, n);
        return { ok: true, gravado: grava(ctx, p, arq, 'sinal_responder'), sinalizador: n };
      },
    },
    {
      nome: 'sinal_criar', titulo: 'Criar sinalizador',
      descricao: 'Cria um sinalizador para o USUÁRIO ver na vista (ex.: "confirmar valor de R3", "trilha no limite da folga"). view pcb: x/y em mm e layer; view sch: x/y em mil e sheet. O id é o próximo livre (nunca reaproveitado).',
      entrada: { type: 'object', properties: { projeto: PROJETO, view: { type: 'string', enum: ['pcb', 'sch'] }, x: { type: 'number' }, y: { type: 'number' },
        layer: { type: 'string' }, sheet: { type: 'string' }, severity: { type: 'string', enum: ['err', 'warn', 'info'] }, msg: { type: 'string' }, ref: { type: 'string' } },
        required: ['projeto', 'view', 'x', 'y', 'msg'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const arq = abre(p);
        let n = 0;
        for (const x of arq.itens) { const m = /^n(\d+)$/.exec((x && x.id) || ''); if (m) n = Math.max(n, +m[1]); }
        const s = { id: 'n' + (n + 1), view: a.view, x: a.x, y: a.y };
        if (a.view === 'pcb') s.layer = a.layer || 'Top';
        else s.sheet = a.sheet || ((ctx.schematic(p).items || []).find(x => x.t === 'sheet') || {}).name || 'main';
        Object.assign(s, { severity: a.severity || 'info', msg: '[IA] ' + String(a.msg).replace(/":/g, '" :'), ref: a.ref || '', status: 'open', created: agora(), reply: '' });
        if (!isNum(s.x) || !isNum(s.y)) throw new ErroMcp('x/y inválidos');
        arq.insere(null, s);
        return { ok: true, gravado: grava(ctx, p, arq, 'sinal_criar'), sinalizador: s };
      },
    },
  ],
};
