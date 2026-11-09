/* NexoEletric MCP - grupo "componentes-locais": criar a peça que o almoxarifado do Odoo ainda não tem.

   Pedido do dono (2026-11-03): "MCP completo pra que a IA possa criar, atribuir símbolo e footprint para aquele
   componente, através do link ou datasheet". O componente criado aqui mora em Libs/almox-locais.js (o formato dos
   acervos do almoxarifado), aparece no "Adicionar componentes" com a tag "criado localmente" e, no "Enviar para o
   Odoo", vai com a ficha inteira no bloco `componente` (prompt-nexoeletric-componente-novo.md). O almoxarifado cria
   a peça com um clique; no sincronismo seguinte ela volta como peça do almoxarifado e perde a tag (local_integrar).

   QUEM GRAVA É O HUB (tools/rotas/componentes_locais.py, rotas /api/locais/*): as ferramentas daqui só chamam as
   rotas, para a regra (o bloco, o nome, a integração) existir num lugar só. Por isso pedem o NexoEletric aberto
   (app_abrir). As regras de família, as listas e a conferência vêm do próprio Odoo (seção 5 do contrato): o hub
   pergunta a ele. O passo a passo da IA está na skill componente-novo. */
'use strict';
const { ErroMcp } = require('../lib/contexto.js');
const { hubNoAr } = require('../lib/util.js');

async function hub(ctx) {
  const h = await hubNoAr(ctx).catch(() => null);
  if (!h) throw new ErroMcp('o NexoEletric não está aberto (o hub é quem grava os componentes locais e fala com o Odoo): rode app_abrir e tente de novo');
  return h.url.replace(/\/+$/, '');
}
async function chama(ctx, caminho, corpo) {
  const url = (await hub(ctx)) + caminho;
  let r, j = {};
  try {
    r = await fetch(url, corpo ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(90000) }
                               : { signal: AbortSignal.timeout(90000) });
  } catch (e) { throw new ErroMcp('o hub não respondeu (' + (e.message || e) + ')'); }
  try { j = await r.json(); } catch (_) { /* sem JSON */ }
  if (r.status === 404 && !j.error) throw new ErroMcp('este NexoEletric ainda não tem os componentes locais (atualize o app)');
  if (!r.ok || j.ok === false) throw new ErroMcp(j.error || ('HTTP ' + r.status));
  return j;
}

/* o bloco `componente` (seção 3 do contrato): as chaves SÃO os campos do produto no Odoo */
const COMPONENTE = {
  type: 'object',
  description: 'A ficha do componente: os campos x_* do produto no Odoo (seção 3 do contrato). Obrigatórios em toda peça nova: x_familia, x_montagem (smd|pth), x_encapsulamento (o pacote da biblioteca do Odoo, ou NA) e x_mpn. Conforme a família (local_regras diz): x_valor_txt (número com sufixo colado: 10K, 4.7K, 100nF, 16MHz, 40V — ponto decimal), x_vias (conector, barra de pinos, chave, dip switch, rede de resistores), x_polaridade (npn/pnp, n/p, uni/bi) e x_subtipo (do cadastro, em CONECTOR). Atributos SÓ os que a família pede. Não mande name, default_code nem x_hub_uid.',
  properties: {
    x_familia: { type: 'string', description: 'da lista do Odoo (local_regras → listas.x_familia), ex. RESISTOR, CAPACITOR CERAMICO, MICROCONTROLADOR' },
    x_montagem: { type: 'string', enum: ['smd', 'pth'] },
    x_encapsulamento: { type: 'string', description: "o pacote da biblioteca do Odoo (local_regras → encapsulamentos[smd|pth]); 'NA' sem pacote nomeável; texto livre só em CONECTOR (a série mecânica)" },
    x_mpn: { type: 'string', description: 'o código do fabricante (part number), do datasheet ou da loja' },
    x_fabricante: { type: 'string' },
    x_subtipo: { type: 'string' },
    x_valor_txt: { type: 'string' },
    x_vias: { type: 'integer', minimum: 1, maximum: 80 },
    x_polaridade: { type: 'string' },
    x_tensao: { type: 'string', description: '50V, 6.3V, 250VAC' }, x_potencia: { type: 'string', description: '1/4W, 500mW' },
    x_corrente: { type: 'string', description: '1A, 200mA' }, x_tolerancia: { type: 'string', description: '1%, 20%' },
    x_coeficiente: { type: 'string', description: '100ppm' }, x_dieletrico: { type: 'string', description: 'C0G, NP0, X5R, X7R...' },
    x_carga: { type: 'string', description: 'cristal: 18pF' }, x_dimensao: { type: 'string', description: 'D10x20mm (D, nunca Ø)' },
    x_passo: { type: 'string', description: 'P2.54mm' }, x_genero: { type: 'string', enum: ['macho', 'femea', 'misto'] },
    x_angulo: { type: 'string', enum: ['180g', '90g'] },
    x_pinos: { type: 'integer', description: 'só nas famílias de CI (o perfil diz pinos: true)' },
    x_pinagem: { type: 'string', description: '1:VDD:Power;2:RA0:IO;... (sai sozinha dos pinos do símbolo se não vier)' },
    x_designator: { type: 'string', description: 'só se diferente do padrão da família' },
    links: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, url: { type: 'string' } }, required: ['name', 'url'] },
             description: 'loja + página DO PRODUTO: [{name:"Mouser", url:"https://..."}]' },
  },
};
const CAMPOS = {
  nome: { type: 'string', description: 'o nome no NexoEletric (é o sym gravado nos esquemas). Vazio = automático; o nome_previsto do Odoo vem no local_conferir' },
  simbolo: { type: 'string', description: 'o nome de um símbolo existente (local_opcoes tipo "simbolos"): da Biblioteca de símbolos do hub, da SchLib ou de uma família do almoxarifado. Não tem? sym_gerar + sym_salvar destino "biblioteca" e use o nome. Vazio (com x_pinos na ficha) = o retângulo genérico com os N pinos, o que o modal da tela faz quando ninguém escolhe' },
  footprint: { type: 'string', description: 'o nome exato de um footprint (local_opcoes tipo "footprints"). Não tem? fp_pacote/fp_salvar e use o nome' },
  datasheet: { type: 'string', description: 'o link do datasheet (vai como link "Datasheet" da peça no Odoo)' },
  componente: COMPONENTE,
};
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

module.exports = {
  grupo: 'componentes-locais',
  ordem: 26,
  titulo: 'Componentes novos — a peça que o almoxarifado do Odoo ainda não tem (criado localmente)',
  ferramentas: [
    {
      nome: 'local_regras', titulo: 'Regras do Odoo para um componente novo', leitura: true,
      descricao: 'Pergunta ao Odoo as regras de hoje (seção 5 do contrato; NÃO adivinhe): as listas fechadas (famílias, montagem, polaridade, dielétrico, gênero, ângulo), os encapsulamentos da biblioteca por montagem, os subtipos de conector, os footprints cadastrados e, com "familia", o perfil dela (o que pede: valor, vias, polaridades, atributos, pinos, subtipo do cadastro). Use ANTES de montar a ficha.',
      entrada: { type: 'object', properties: { familia: { type: 'string', description: 'ex. TRANSISTOR, CONECTOR' }, resumido: { type: 'boolean', description: 'sem as listas longas (encapsulamentos e footprints): só o perfil e as listas fechadas' } } },
      executa: async (a, ctx) => {
        const j = await chama(ctx, '/api/locais/regras' + (a.familia ? '?familia=' + encodeURIComponent(a.familia) : ''));
        delete j.ok;
        if (a.resumido) { j.encapsulamentos = Object.fromEntries(Object.entries(j.encapsulamentos || {}).map(([k, v]) => [k, (v || []).length + ' pacotes'])); j.footprints = (j.footprints || []).length + ' footprints'; }
        return j;
      },
    },
    {
      nome: 'local_opcoes', titulo: 'Símbolos e footprints que um componente local pode usar', leitura: true,
      descricao: 'Procura um símbolo (Biblioteca de símbolos do hub, SchLib da casa, famílias do almoxarifado) ou um footprint (PcbLib da casa e biblioteca do hub) pelo nome, para o "simbolo"/"footprint" do local_criar. Devolve o nome exato, de onde vem e quantos pinos o símbolo tem (confira com o datasheet).',
      entrada: { type: 'object', properties: { tipo: { type: 'string', enum: ['simbolos', 'footprints'] }, busca: { type: 'string', description: 'palavras do nome: "sot-23", "npn", "lqfp48"' }, pinos: { type: 'integer', description: 'só símbolos com este número de pinos' }, limite: { type: 'integer', minimum: 1, maximum: 200 } }, required: ['tipo'] },
      executa: async (a, ctx) => {
        const j = await chama(ctx, '/api/locais/opcoes');
        const termos = norm(a.busca).split(/\s+/).filter(Boolean);
        const casa = n => termos.every(t => norm(n).includes(t));
        const lim = a.limite || 40;
        if (a.tipo === 'footprints') {
          const l = (j.footprints || []).filter(casa);
          return { total: l.length, footprints: l.slice(0, lim) };
        }
        const l = (j.simbolos || []).filter(s => casa(s.nome) && (a.pinos == null || s.pinos === a.pinos));
        return { total: l.length, simbolos: l.slice(0, lim) };
      },
    },
    {
      nome: 'local_listar', titulo: 'Listar os componentes criados localmente', leitura: true,
      descricao: 'Os componentes criados localmente (tag "criado localmente"), com a situação de cada um (incompleto, não conferido, com faltas, pronto) e o "comp" pronto para sch_adicionar; e os já integrados ao almoxarifado. Antes de listar, integra os que o Odoo já criou (o MPN + encapsulamento chegaram no almoxarifado pelo sincronismo).',
      entrada: { type: 'object', properties: {} },
      executa: async (a, ctx) => {
        const j = await chama(ctx, '/api/locais');
        return { componentes: j.componentes, integrados: j.integrados, nota: 'acrescente x, y (mil) ao "comp" e passe em sch_adicionar para colocar no esquema' };
      },
    },
    {
      nome: 'local_ler', titulo: 'Ler um componente local inteiro', leitura: true,
      descricao: 'A ficha inteira de um componente local (o bloco componente, o símbolo, o footprint, a última conferência do Odoo).',
      entrada: { type: 'object', properties: { id: { type: 'string', description: 'L1, L2...' } }, required: ['id'] },
      executa: async (a, ctx) => {
        const j = await chama(ctx, '/api/locais/' + encodeURIComponent(a.id));
        const s = j.componente || {};
        return { resumo: j.resumo, componente: (s.criadoLocal || {}).componente, simbolo: (s.criadoLocal || {}).simbolo,
                 pinos: (s.parts || []).reduce((n, p) => n + (p.pins || []).length, 0), conferencia: (s.criadoLocal || {}).conferencia || null };
      },
    },
    {
      nome: 'local_criar', titulo: 'Criar um componente local',
      descricao: 'Cria um componente que o almoxarifado do Odoo ainda não tem, com a tag "criado localmente": a ficha x_* (do datasheet ou da página do produto), o símbolo e o footprint (nomes existentes; crie antes com sym_gerar/sym_salvar destino "biblioteca" e fp_pacote/fp_salvar se precisar). Confira depois com local_conferir. Antes: confira com almox_buscar que a peça não existe no almoxarifado (mesmo MPN).',
      entrada: { type: 'object', properties: CAMPOS, required: ['componente', 'simbolo', 'footprint'] },
      executa: async (a, ctx) => {
        const corpo = { componente: a.componente, simbolo: a.simbolo, footprint: a.footprint, datasheet: a.datasheet || '', por: 'IA (MCP)' };
        if (a.nome) corpo.nome = a.nome;
        const j = await chama(ctx, '/api/locais', corpo);
        return { componente: j.componente, avisos: j.avisos, proximo: 'local_conferir {id:"' + j.componente.id + '"} para o Odoo conferir a ficha' };
      },
    },
    {
      nome: 'local_editar', titulo: 'Editar um componente local',
      descricao: 'Muda um componente local: a ficha (por padrão MESCLA os campos x_* mandados com os que já estão; mesclar:false substitui a ficha inteira), o símbolo, o footprint, o datasheet ou o nome (o nome é o sym gravado nos esquemas: trocar não muda os já colocados). Mudar a ficha zera a conferência: rode local_conferir de novo.',
      entrada: { type: 'object', properties: Object.assign({ id: { type: 'string' }, mesclar: { type: 'boolean' } }, CAMPOS), required: ['id'] },
      executa: async (a, ctx) => {
        const corpo = { id: a.id };
        for (const k of ['nome', 'simbolo', 'footprint', 'datasheet']) if (a[k] != null) corpo[k] = a[k];
        if (a.componente) { corpo.componente = a.componente; corpo.mesclar = a.mesclar !== false; }
        const j = await chama(ctx, '/api/locais', corpo);
        return { componente: j.componente, avisos: j.avisos };
      },
    },
    {
      nome: 'local_conferir', titulo: 'Conferir a ficha no Odoo',
      descricao: 'Manda a ficha ao di_confere_lista do Odoo (ENSAIO: não grava nada lá) e devolve: pronto (passa em todas as regras do cadastro novo), nome_previsto (o nome que a peça vai ter), faltas (campo obrigatório que não veio), erros (fora da lista, pacote fora da biblioteca, atributo que a família não pede, MPN+encapsulamento que já existe), avisos e ignorados. Corrija com local_editar e confira de novo até pronto:true.',
      entrada: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      executa: async (a, ctx) => {
        const j = await chama(ctx, '/api/locais/' + encodeURIComponent(a.id) + '/conferir', {});
        return { conferencia: j.conferencia, componente: j.componente };
      },
    },
    {
      nome: 'local_apagar', titulo: 'Apagar um componente local',
      descricao: 'Apaga um componente local — SÓ o administrador do Nexo Hub (1.89.0; usuário comum, visualizador e sem login são recusados). Os esquemas que já o usam ficam com o símbolo em quadrado vermelho: só apague o que ninguém colocou (ou troque antes pelo do almoxarifado).',
      entrada: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      executa: async (a, ctx) => {
        /* 1.89.0 (pedido do dono: "sim só pro admin"): o hub barra também (tools/rotas/equipe.py » recusa_so_admin) */
        const s = await require('../lib/equipe.js').sessao(true);
        if (!(s && s.usuario && s.usuario.admin)) throw new ErroMcp('Só o administrador do Nexo Hub apaga componentes da biblioteca', { codigo: 'sem_permissao' });
        await chama(ctx, '/api/locais/' + encodeURIComponent(a.id) + '/apagar', {}); return { apagado: a.id }; },
    },
    {
      nome: 'local_integrar', titulo: 'Integrar os locais que o Odoo já criou',
      descricao: 'Procura no almoxarifado (o espelho do Odoo, depois do sincronismo) os componentes locais que o almoxarifado já criou — o mesmo MPN e encapsulamento — e os integra: perdem a tag "criado localmente" e passam a apontar para o produto (o envio da lista manda o product_id dele, mesmo nos esquemas antigos). Roda sozinho no local_listar e quando a Biblioteca carrega.',
      entrada: { type: 'object', properties: {} },
      executa: async (a, ctx) => { const j = await chama(ctx, '/api/locais/integrar', {}); return { integrados: j.integrados }; },
    },
  ],
};
