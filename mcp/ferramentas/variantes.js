/* NexoEletric MCP - grupo "variantes": a VARIANTE DE PROJETO (1.88.0) — a mesma PCB para projetos diferentes, mudando só o
   que é montado (tools/rotas/variantes.py, hub-variantes.js).

   variante_listar   as variantes do projeto, a ativa nesta máquina e os códigos (PCB montada / virgem)
   variante_ativar   troca a variante ativa NESTA máquina (a vista e as saídas — BOM, Neoden, lista do Odoo, PDF — a
                     seguem); sem id = a padrão (todos montados). Livre também para o apenas visualizador (ver e exportar)
   variante_suprimir suprime (ou volta a montar, suprimir:false) componentes na variante: eles saem do BOM, da Neoden e da
                     lista do Odoo; a PCB (cobre, pads, furos, Gerber) não muda. É edição: a equipe do projeto
   Criar, renomear e apagar variante ficam na tela (o código da variante vem do catálogo, escolhido pela pessoa). */
'use strict';
const { ErroMcp } = require('../lib/contexto.js');
const { PROJETO } = require('../lib/util.js');
const VR = require('../lib/variantes.js');
const equipe = require('../lib/equipe.js');

function sch(ctx, p) { try { return ctx.schematic(p); } catch (_) { return null; } }
function estado(ctx, p) {
  const d = VR.le(p.dir);
  const v = VR.ativa(p.dir, d);
  const s = sch(ctx, p);
  return { projeto: p.nome, ativa: v ? { id: v.id, nome: v.nome, codigo: v.codigo } : null,
           codigos: VR.codigos(s || {}, v),
           variantes: d.variantes.map(x => ({ id: x.id, nome: x.nome, codigo: x.codigo, nomeCatalogo: x.nomeCatalogo || '',
             suprimidos: x.suprimidos.map(r => r.ref), ativa: Boolean(v && v.id === x.id) })),
           regra: 'a variante é um equipamento (código = o do equipamento, no quadro da folha). Na padrão: PCB montada e PCB virgem = código da PCB. Com uma variante ativa (1.89.0): PCB montada = <código da placa> <NOME DA VARIANTE> e a PCB virgem NÃO vai ao Odoo (é a do projeto padrão)' };
}
function historico(p, mud) {
  try {
    const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
    const u = equipe.usuario();
    const d = path.join(p.dir, 'Historico');
    const nome = String(u ? u.id : 'sem-login').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+|[._]+$/g, '') || 'sem-login';
    const iso = VR.agora();
    fs.mkdirSync(d, { recursive: true });
    fs.appendFileSync(path.join(d, nome + '.jsonl'), JSON.stringify({ id: crypto.randomBytes(6).toString('hex'), quando: iso, ate: iso,
      usuario: u ? { id: u.id, login: u.login, nome: u.nome } : null, origem: 'ia', arquivo: '', tipo: 'variante', mudancas: mud, gravacoes: 1 }) + '\n', 'utf8');
  } catch (_) { /* o histórico nunca impede */ }
}

module.exports = {
  grupo: 'variantes',
  ordem: 46,
  titulo: 'Variante de projeto — a mesma PCB, só o que é montado muda',
  ferramentas: [
    {
      nome: 'variante_listar', titulo: 'Variantes do projeto', leitura: true,
      descricao: 'As variantes de projeto (Projects/<p>/variantes.json): nome, código (do catálogo), os componentes suprimidos em cada uma, qual está ativa NESTA máquina e os códigos da PCB montada e da virgem. A PCB é a mesma em todas: a variante só suprime (não monta) componentes.',
      entrada: { type: 'object', properties: { projeto: PROJETO }, required: ['projeto'] },
      executa: async (a, ctx) => estado(ctx, ctx.projeto(a.projeto)),
    },
    {
      nome: 'variante_ativar', titulo: 'Ativar uma variante (ver e exportar)',
      descricao: 'Troca a variante ativa NESTA máquina: a vista (esquema e PCB) e as saídas (BOM, Neoden, lista do Odoo, PDF) passam a usá-la. Sem "id" (ou id vazio) volta à padrão (todos montados). Com uma variante ativa, schematic.js/changes.js/annotations.js/rules.js ficam travados para a IA e para a tela (só variante_suprimir).',
      entrada: { type: 'object', properties: { projeto: PROJETO, id: { type: 'string', description: 'o id da variante (variante_listar); vazio = a padrão' } }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const id = String(a.id || '').trim() || null;
        if (id && !VR.le(p.dir).variantes.some(v => v.id === id)) throw new ErroMcp(`a variante "${id}" não existe neste projeto (variante_listar)`);
        VR.defineAtiva(p.dir, id);
        return estado(ctx, p);
      },
    },
    {
      nome: 'variante_suprimir', titulo: 'Suprimir / montar componentes na variante',
      descricao: 'Suprime (suprimir: true, o padrão) ou volta a montar (suprimir: false) componentes numa variante (a ativa, ou "id"). O suprimido continua na PCB (footprint, cobre, pads, furos, Gerber iguais), mas sai do BOM, da Neoden/pick-and-place e da lista do Odoo, e a vista o mostra com o X vermelho e esmaecido. Na padrão não se suprime nada. Edição: só a equipe do projeto (o apenas visualizador e quem não foi convidado são recusados).',
      entrada: { type: 'object', properties: { projeto: PROJETO, refs: { type: 'array', items: { type: 'string' }, description: 'designadores (R5, U3...)' },
        suprimir: { type: 'boolean', description: 'true = suprimir (padrão); false = voltar a montar' }, id: { type: 'string', description: 'a variante (padrão: a ativa)' } }, required: ['projeto', 'refs'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const nao = equipe.recusa(p.dir);
        if (nao) throw new ErroMcp(nao, { codigo: 'sem_permissao' });
        const d = VR.le(p.dir);
        const v = a.id ? d.variantes.find(x => x.id === String(a.id)) : VR.ativa(p.dir, d);
        if (!v) throw new ErroMcp('nenhuma variante ativa: ative uma (variante_ativar) ou passe "id" — na padrão todos são montados');
        const s = sch(ctx, p);
        const noEsq = new Map();
        for (const it of ((s && s.items) || [])) if (it && it.t === 'comp' && it.ref != null && !noEsq.has(String(it.ref))) noEsq.set(String(it.ref), it);
        const pedidos = [...new Set((a.refs || []).map(r => String(r || '').trim()).filter(Boolean))];
        if (!pedidos.length) throw new ErroMcp('informe "refs"');
        const fora = s ? pedidos.filter(r => !noEsq.has(r)) : [];
        if (fora.length) throw new ErroMcp('não estão no esquema: ' + fora.join(', '));
        const on = a.suprimir !== false;
        const tem = new Set(v.suprimidos.map(x => x.ref));
        const mudou = [];
        const u = equipe.usuario();
        if (on) for (const r of pedidos) { if (tem.has(r)) continue; const it = noEsq.get(r) || {}; v.suprimidos.push({ ref: r, sym: it.sym || '', footprint: it.footprint || '', por: u ? { id: u.id, login: u.login, nome: u.nome } : null, em: VR.agora() }); mudou.push(r); }
        else { for (const r of pedidos) if (tem.has(r)) mudou.push(r); v.suprimidos = v.suprimidos.filter(x => !mudou.includes(x.ref)); }
        if (mudou.length) {
          VR.grava(p.dir, d);
          historico(p, [`${on ? 'suprimiu' : 'voltou a montar'} ${mudou.join(', ')} na variante "${v.nome}" (${v.codigo}) (pela IA)`]);
        }
        return Object.assign(estado(ctx, p), { mudou });
      },
    },
  ],
};
