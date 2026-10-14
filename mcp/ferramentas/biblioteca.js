/* EletricHUB MCP - grupo "biblioteca": consulta (SO LEITURA) ao almoxarifado espelhado do Odoo
   (Libs/almox-basicos.js, Libs/almox-especiais.js). Regra do dono: biblioteca, almoxarifado,
   simbolos e integracao com o Odoo ficam como estao -- o MCP so le. O componente escolhido entra
   no esquema com sch_adicionar usando o `comp` pronto que esta ferramenta devolve: o sym e o nome
   do VALOR no Altium, o comment e o rotulo, o footprint o do valor e o params a identidade no
   Odoo (o mesmo que o "Adicionar componentes" da vista Esquema grava: schframe.js »
   paramsDoValor). */
'use strict';

const limpaPar = t => String(t == null ? '' : t).replace(/[;=|]/g, ',').trim();
function paramsDoValor(v) {
  const pares = [];
  for (const q of (v.params || [])) if (q.v) pares.push(limpaPar(q.n) + '=' + limpaPar(q.v));
  pares.push('ValorId=' + v.id);
  return pares.join(';');
}
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

module.exports = {
  grupo: 'biblioteca',
  ordem: 25,
  titulo: 'Biblioteca — almoxarifado (só leitura)',
  ferramentas: [
    {
      nome: 'almox_buscar', titulo: 'Buscar no almoxarifado', leitura: true,
      descricao: 'Procura peças do almoxarifado (espelho do Odoo) por valor, família, MPN, encapsulamento ou local: devolve estoque, local, MPN, id do Odoo e um "comp" pronto para sch_adicionar (sym/comment/footprint/params). Prefira peça com estoque. Só leitura.',
      entrada: { type: 'object', properties: { busca: { type: 'string', description: 'ex.: "10k 0805", "BC547", "capacitor 100nF"' }, so_com_estoque: { type: 'boolean' }, limite: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['busca'] },
      executa: async (a, ctx) => {
        const termos = norm(a.busca).split(/\s+/).filter(Boolean);
        const out = [];
        for (const [arq, nome, acervo] of [['almox-basicos.js', 'almoxBasicos', 'básicos'], ['almox-especiais.js', 'almoxEspeciais', 'especiais']]) {
          const g = ctx.lib(arq, nome);
          for (const s of (g && g.symbols) || []) for (const v of s.valores || []) {
            const txt = norm([s.name, s.familia, s.description, v.label, v.value, v.mpn, v.footprint, v.local, (v.itens || []).map(i => i.nome).join(' ')].join(' '));
            if (!termos.every(t => txt.includes(t))) continue;
            if (a.so_com_estoque && !(v.estoque > 0)) continue;
            out.push({ acervo, familia: s.name, valor: v.label, estoque: v.estoque, local: v.local, mpn: v.mpn || undefined, odoo: (v.itens || []).map(i => i.odoo),
              comp: { t: 'comp', sym: v.altium, comment: v.label, footprint: v.footprint || '', params: paramsDoValor(v), ref: (s.designator || 'U') .replace(/\?+$/, '') + '?' } });
          }
        }
        out.sort((x, y) => (y.estoque || 0) - (x.estoque || 0));
        return { total: out.length, pecas: out.slice(0, a.limite || 20), nota: 'acrescente x, y (mil) ao "comp" e passe em sch_adicionar' };
      },
    },
  ],
};
