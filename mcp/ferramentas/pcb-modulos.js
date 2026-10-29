/* NexoEletric MCP - grupo "pcbmod": as ferramentas que vem dos modulos novos da vista PCB
   (regras/DRC, conectividade, polygon pour, teardrops, ECO), pela API que cada um declara no
   cabecalho:
     HubPcbRegras  ler(rules.js) / doBoard(board) / serializa / normaliza / resolvedor
     HubPcbDrc     rodar(eb, regras, {ids, modo, tipos, textoGeo, max}) / relatorioTexto
     HubPcbNets    naoRoteadas(eb) / conexoes(eb) / curtos(eb) / objetosDaNet(eb, net)
     HubPcbPour    despejaTodos(eb, {texto}) / despeja(eb, poligono) / desatualizado
     HubPcbTeardrop gera(eb, {pula}) / reconhece(eb)
     HubPcbEco     compara(sch, board, {schlib, pcblib, changes, eb}) / valida / aplica -> {linhas}
   Faltando o modulo, a ferramenta responde "modulo ausente" sem derrubar nada -- ou usa a reserva
   daqui quando ha uma honesta (ratsnest e comparacao de componentes). */
'use strict';
const { ErroMcp } = require('../lib/contexto.js');
const ops = require('../lib/pcb-ops.js');
const geo = require('../lib/geometria.js');
const { PROJETO } = require('../lib/util.js');

const r6 = v => Math.round(v * 1e6) / 1e6;
function aplicaOps(ctx, p, lista, a, ferramenta) {
  return ops.transacao(ctx, p, (arq, board) => lista.map(o => ops.mescla(arq, ops.origDe(Object.assign({}, o), board)).obj),
    { simular: a.simular, forcar: a.forcar, ferramenta });
}
/* o conjunto de regras do projeto como a vista o carrega: o rules.js (HubPcbRegras.ler) ou,
   sem ele, o padrao da casa + o board.rules do espelho (doBoard) */
function regras(ctx, p) {
  ctx.exige('hub-pcbregras.js', 'HubPcbRegras');
  return ops.regrasDoProjeto(ctx, p);
}
function textoGeo(ctx) {
  const G = ctx.modulo('hub-gerber.js');
  return G && G.geometriaTexto ? (t => { if (!t || t.hidden) return null; try { return G.geometriaTexto(t); } catch (_) { return null; } }) : undefined;
}
const SIM = { simular: { type: 'boolean', description: 'só valida e mostra' }, forcar: { type: 'boolean' } };

module.exports = {
  grupo: 'pcbmod',
  ordem: 40,
  titulo: 'PCB — regras, DRC, conectividade, pour, teardrops, ECO (módulos do hub)',
  modulos: ['hub-pcbregras.js', 'hub-pcbdrc.js', 'hub-pcbnets.js', 'hub-pcbpour.js', 'hub-pcbteardrop.js', 'hub-pcbeco.js'],
  ferramentas: [
    {
      nome: 'regras_ler', titulo: 'Ler regras de projeto', leitura: true, modulo: 'hub-pcbregras.js',
      descricao: 'As regras de projeto (Design Rules do Altium 21) do projeto: o rules.js, ou — sem ele — o padrão da casa com as regras que vieram do Altium (board.rules). Cada regra: tipo (Clearance, Width, RoutingVias, HoleSize...), nome, escopo (a query do Altium: InNet(\'GND\'), All...), prioridade e valores em mm. Com "tipo" mostra só aquele; com "net" diz qual regra vence para ela.',
      entrada: { type: 'object', properties: { projeto: PROJETO, tipo: { type: 'string', description: 'kind, ex.: Clearance, Width, RoutingVias' }, net: { type: 'string' } }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const R = ctx.exige('hub-pcbregras.js', 'HubPcbRegras');
        const { conjunto, fonte } = regras(ctx, p);
        const lista = (conjunto.regras || conjunto.rules || []).filter(r => !a.tipo || r.kind === a.tipo || r.tipo === a.tipo);
        const out = { fonte, formato: conjunto.format || conjunto.formato, total: lista.length, regras: lista, tipos_conhecidos: Object.keys(R.TIPOS || {}) };
        if (a.net && a.tipo) {
          try { out.vencedora = R.regraPara(conjunto, a.tipo, { tipo: 'track', net: a.net, layer: 'Top' }); } catch (e) { out.vencedora = { erro: e.message }; }
        }
        return out;
      },
    },
    {
      nome: 'regras_definir', titulo: 'Gravar regras de projeto', modulo: 'hub-pcbregras.js',
      descricao: 'Grava o rules.js do projeto pelo serializador do hub-pcbregras.js (o mesmo formato do editor de regras da vista). Duas formas: "conjunto" completo (leia com regras_ler, mude, devolva) ou "regras" = lista de regras a acrescentar/substituir (pelo nome) no conjunto atual. Valores em mm; escopo na linguagem do Altium. Depois rode drc_rodar.',
      entrada: { type: 'object', properties: { projeto: PROJETO,
        conjunto: { type: 'object', additionalProperties: true },
        regras: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'ex.: [{"kind":"Width","name":"Width_GND","scope1":"InNet(\'GND\')","priority":1, ...}] — copie uma regra do mesmo kind de regras_ler e mude os valores (mm); o mesmo name substitui' },
        remover: { type: 'array', items: { type: 'string' }, description: 'nomes de regras a tirar' } }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const R = ctx.exige('hub-pcbregras.js', 'HubPcbRegras');
        let c = a.conjunto ? a.conjunto : regras(ctx, p).conjunto;
        if (!a.conjunto) {
          const campo = Array.isArray(c.regras) ? 'regras' : 'rules';
          let L = (c[campo] || []).slice();
          const nomeDe = r => r.name || r.nome;
          if (a.remover) L = L.filter(r => !a.remover.includes(nomeDe(r)));
          for (const n of a.regras || []) { const i = L.findIndex(r => nomeDe(r) === nomeDe(n) && (r.kind || r.tipo) === (n.kind || n.tipo || r.kind)); if (i >= 0) L[i] = Object.assign({}, L[i], n); else L.push(n); }
          c = Object.assign({}, c, { [campo]: L });
        }
        if (typeof R.normaliza === 'function') c = R.normaliza(c) || c;
        const t = R.serializa(c);
        const texto = typeof t === 'string' ? t : t && t.text;
        if (!texto) throw new ErroMcp('regras inválidas: ' + JSON.stringify((t && t.errors) || t).slice(0, 800));
        try { R.ler(texto); } catch (e) { throw new ErroMcp('o rules.js gerado não relê: ' + e.message); }
        return { ok: true, gravado: ctx.grava(p.arq('rules.js'), texto, 'regras_definir'), arquivo: ctx.rel(p.arq('rules.js')) };
      },
    },
    {
      nome: 'drc_rodar', titulo: 'DRC (verificação de regras)', leitura: true, modulo: 'hub-pcbdrc.js',
      descricao: 'Roda o DRC do hub (hub-pcbdrc.js) na placa COM as mudanças e COM os planos despejados (como a tela do app), com as regras do projeto: clearance, curto, net não roteada, largura, via, furo, furo-a-furo, ponte de máscara, silk, contorno, antena. Devolve as violações (regra, msg, x/y, camada, ids dos objetos) e a contagem por regra. ids = DRC online só nos objetos dados; tipos = só essas checagens; relatorio:true traz o texto do "DRC Report"; despejar:false roda sem redespejar os polígonos (aí o plano não conta e o GND aparece "não roteado").',
      entrada: { type: 'object', properties: { projeto: PROJETO, ids: { type: 'array', items: { type: 'string' } }, tipos: { type: 'array', items: { type: 'string' } },
        limite: { type: 'integer', minimum: 1, maximum: 5000, description: 'violações listadas (padrão 200)' }, relatorio: { type: 'boolean' },
        despejar: { type: 'boolean', description: 'padrão true: redespeja os polígonos (poly_add) antes, como a vista PCB faz' } }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const D = ctx.exige('hub-pcbdrc.js', 'HubPcbDrc');
        const { eb, despejo } = a.despejar === false ? ctx.placa(p) : ctx.placaDespejada(p);
        const { conjunto, fonte } = ctx.modulo('hub-pcbregras.js') ? regras(ctx, p) : { conjunto: undefined, fonte: 'padrão do DRC' };
        const o = { textoGeo: textoGeo(ctx) };
        if (a.ids) o.ids = a.ids;
        if (a.tipos) o.tipos = a.tipos;
        const r = D.rodar(eb, conjunto, o);
        const lim = a.limite || 200;
        const out = { aprovado: !r.total, total: r.total, regras_de: fonte, despejo: despejo || (a.despejar === false ? 'sem redespejo (despejar:false)' : 'sem polígono'),
                      porRegra: (r.porRegra || []).filter(x => x.n), avisos: r.avisos, tempoMs: r.tempoMs,
                      violacoes: (r.violacoes || []).slice(0, lim), cortadas: Math.max(0, (r.violacoes || []).length - lim) };
        if (a.relatorio && typeof D.relatorioTexto === 'function') out.relatorio = D.relatorioTexto(r, { projeto: p.nome });
        return out;
      },
    },
    {
      nome: 'nets_ratsnest', titulo: 'Ratsnest / nets não roteadas', leitura: true,
      descricao: 'O que falta ligar (as linhas de conexão do Altium): por net, as ilhas de cobre ainda separadas e as ligações que faltam (x1,y1 → x2,y2 e de/para), mais os curtos entre nets. Conta o cobre dos planos despejados (como a tela; despejar:false ignora os polígonos). Usa o hub-pcbnets.js (o motor da vista); sem ele, a reserva do MCP. Desenhe com pcb_render {ratsnest:true}; ligue com pcb_rotear.',
      entrada: { type: 'object', properties: { projeto: PROJETO, net: { type: 'string' }, so_pendentes: { type: 'boolean', description: 'padrão true' },
        despejar: { type: 'boolean', description: 'padrão true: redespeja os polígonos antes' } }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const { eb } = a.despejar === false ? ctx.placa(p) : ctx.placaDespejada(p);
        const N = ctx.modulo('hub-pcbnets.js');
        if (!N) {
          const c = geo.conectividade(ctx.hc, eb);
          c.nets = c.nets.filter(n => (!a.net || n.net === a.net) && (a.so_pendentes === false || !n.roteada || a.net));
          return c;
        }
        const nr = N.naoRoteadas(eb), cx = N.conexoes(eb);
        const linhasDe = net => ((cx.nets && cx.nets[net] && cx.nets[net].linhas) || []).map(l => ({ x1: r6(l.x1), y1: r6(l.y1), x2: r6(l.x2), y2: r6(l.y2), de: l.de, para: l.para }));
        const nets = (nr.nets || []).filter(n => !a.net || n.net === a.net).map(n => ({ net: n.net, ilhas: n.ilhas, faltam: n.faltam, ligacoes: linhasDe(n.net) }));
        const curtos = N.curtos(eb) || [];
        return { motor: 'HubPcbNets', nets_total: (eb.nets || []).length, nets_pendentes: nr.total, ligacoes_faltando: nr.conexoes != null ? nr.conexoes : (cx.linhas || []).length,
                 nets, curtos: curtos.slice(0, 100), curtos_total: curtos.length };
      },
    },
    {
      nome: 'pour_definir', titulo: 'Definir polígono de cobre',
      descricao: 'Cria um polígono de cobre (polygon pour, quase sempre GND) com a op poly_add do changes.js: layer, net, pts (contorno [[x,y],...] em mm) e as opções do Altium (pourOver all|polygons|none, removeNecks, neck, clearanceBorda, nome...). O despejo é feito pelo hub-pcbpour.js (pour_despejar mostra; o Gerber já sai despejado).',
      entrada: { type: 'object', properties: Object.assign({ projeto: PROJETO, layer: { type: 'string' }, net: { type: 'string' },
        pts: { type: 'array', minItems: 3, items: { type: 'array', items: { type: 'number' } } }, nome: { type: 'string' },
        opcoes: { type: 'object', additionalProperties: true }, note: { type: 'string' } }, SIM), required: ['projeto', 'layer', 'net', 'pts'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const op = Object.assign({ op: 'poly_add', layer: a.layer, net: a.net, pts: a.pts }, a.nome ? { nome: a.nome } : {}, a.opcoes || {}, a.note ? { note: a.note } : {});
        return aplicaOps(ctx, p, [op], a, 'pour_definir');
      },
    },
    {
      nome: 'pour_despejar', titulo: 'Polygon pour (despejar)', leitura: true, modulo: 'hub-pcbpour.js',
      descricao: 'Despeja os polígonos da placa (board.js » polygons + poly_add) com o hub-pcbpour.js, respeitando as folgas: área, nº de regiões e avisos por polígono, e se o despejo gravado está desatualizado. O Gerber (gerber_gerar) já sai com o despejo novo; veja com pcb_render.',
      entrada: { type: 'object', properties: { projeto: PROJETO }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const P = ctx.exige('hub-pcbpour.js', 'HubPcbPour');
        const { eb } = ctx.placa(p);
        if (!(eb.polygons || []).length) return { poligonos: 0, nota: 'a placa não tem polígono (pour_definir cria)' };
        const r = P.despejaTodos(ctx.comRegras(p, eb), { texto: textoGeo(ctx) });
        return { poligonos: eb.polygons.length, ms: r.ms, avisos: r.avisos, regioes: (r.regioes || []).length,
                 por_poligono: Object.entries(r.porPoligono || {}).map(([id, x]) => ({ id, area_mm2: x.area, regioes: (x.regioes || []).length, avisos: x.avisos,
                   desatualizado_no_espelho: (() => { try { const pol = eb.polygons.find(q => q.id === id); return pol ? P.desatualizado(eb, pol) : undefined; } catch (_) { return undefined; } })() })) };
      },
    },
    {
      nome: 'teardrop_aplicar', titulo: 'Teardrops', modulo: 'hub-pcbteardrop.js',
      descricao: 'Põe os teardrops que faltam (pad/via com trilha mais fina e sem gota, e a junção em T: trilha que termina no meio de outra da mesma net) como o Tools » Teardrops da vista: region_add no changes.js, que o Gerber e o Altium recebem como região de cobre. Os órfãos (trilha/via que andou) a placa já refaz sozinha. opcoes: {estilo:"linha"|"curva", vias, pads, smd, th, tjuncao (padrão true), ids:[pads/vias] (só esses; sem T)}. Tirar: teardrop_remover.',
      entrada: { type: 'object', properties: Object.assign({ projeto: PROJETO, opcoes: { type: 'object', additionalProperties: true } }, SIM), required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const T = ctx.exige('hub-pcbteardrop.js', 'HubPcbTeardrop');
        const { eb } = ctx.placa(p);
        let novos;
        if (typeof T.faltam === 'function') novos = T.faltam(eb, a.opcoes || {}) || [];
        else { const pula = new Set((T.reconhece(eb) || []).map(t => (t.de && t.de.id) + '|' + t.trilha + '|' + t.layer)); novos = T.gera(eb, Object.assign({ pula }, a.opcoes || {})) || []; }
        if (!novos.length) return { ok: true, postos: 0, nota: 'nenhum teardrop por pôr: todo pad e via com trilha mais fina e toda junção em T já tem o seu' };
        const L = novos.map(g => { const o = { op: 'region_add', layer: g.layer, pts: g.points.map(q => [r6(q[0]), r6(q[1])]), note: 'teardrop do hub' }; if (g.net) o.net = g.net; return o; });
        return Object.assign({ postos: L.length, em_t: novos.filter(g => g.tipo === 'trilha').length }, aplicaOps(ctx, p, L, a, 'teardrop_aplicar'));
      },
    },
    {
      nome: 'teardrop_remover', titulo: 'Tirar teardrops', modulo: 'hub-pcbteardrop.js',
      descricao: 'Tira os teardrops da placa, como o "Tirar teardrops" da vista: o posto pelo hub sai tirando a linha region_add do changes.js; o do espelho (board.js) ganha um region_del com os orig_*. O do espelho antigo (board.js sem "exporter") não se apaga daqui e volta em "ficaram". nets/camadas limitam a esses. simular:true só mostra.',
      entrada: { type: 'object', properties: Object.assign({ projeto: PROJETO,
        nets: { type: 'array', items: { type: 'string' }, description: 'só os teardrops destas nets' },
        camadas: { type: 'array', items: { type: 'string' }, description: 'só nestas camadas (Top, Bottom...)' } }, SIM), required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const T = ctx.exige('hub-pcbteardrop.js', 'HubPcbTeardrop');
        if (typeof T.todos !== 'function') throw new ErroMcp('o hub-pcbteardrop.js desta instalação não sabe tirar teardrops (precisa da 1.42.0)');
        const { board, model, eb } = ctx.placa(p);
        const nets = Array.isArray(a.nets) && a.nets.length ? new Set(a.nets) : null;
        const camadas = Array.isArray(a.camadas) && a.camadas.length ? new Set(a.camadas) : null;
        const vale = r => (!nets || nets.has(r.net)) && (!camadas || camadas.has(r.layer));
        const lista = (T.todos(eb, board) || []).filter(vale);
        const livres = new Set((model.regions || []).filter(m => !m.deleted).map(m => String(m.src.id)));
        const doEspelho = [], doHub = [], ficaram = [];
        const ebPorId = new Map((eb.regions || []).map(g => [String(g.id), g]));
        for (const r of lista) {
          const id = String(r.id);
          if (r.espelho) { if (livres.has(id)) doEspelho.push(id); else if (!(model.regions || []).some(m => String(m.src.id) === id && m.deleted)) ficaram.push(id); continue; }
          if (/^new-g/.test(id) && ebPorId.has(id)) doHub.push(ebPorId.get(id));
        }
        const mesmo = (x, g) => x && x.op === 'region_add' && x.layer === g.layer && Array.isArray(x.pts) && x.pts.length === g.points.length &&
          x.pts.every((q, i) => Math.abs(q[0] - g.points[i][0]) < 1e-6 && Math.abs(q[1] - g.points[i][1]) < 1e-6);
        let nHub = 0;
        const monta = (arq, brd) => {
          const tocados = [];
          nHub = 0;
          for (const g of doHub) { const i = arq.itens.findIndex(x => mesmo(x, g)); if (i >= 0) { arq.remove(i); nHub++; } }
          /* o do hub que ficou orfao (a trilha andou) nao e mais reconhecido: a nota da linha diz */
          for (let i = arq.itens.length - 1; i >= 0; i--) {
            const x = arq.itens[i];
            if (x && x.op === 'region_add' && x.note === 'teardrop do hub' && (!nets || nets.has(x.net)) && (!camadas || camadas.has(x.layer))) { arq.remove(i); nHub++; }
          }
          for (const id of doEspelho) tocados.push(ops.mescla(arq, ops.origDe({ op: 'region_del', id, note: 'teardrop tirado' }, brd)).obj);
          return tocados;
        };
        const antes = ctx.changes(p).filter(x => x && x.op === 'region_add' && x.note === 'teardrop do hub').length;
        if (!doEspelho.length && !doHub.length && !antes) return { ok: true, tirados: 0, ficaram: ficaram.length, nota: ficaram.length ? 'só há teardrops do espelho antigo: reexporte a placa com o ExportBoard novo' : 'nenhum teardrop na placa' };
        const r = ops.transacao(ctx, p, monta, { simular: a.simular, forcar: a.forcar, ferramenta: 'teardrop_remover' });
        return Object.assign({ tirados: doEspelho.length + nHub, do_espelho: doEspelho.length, do_hub: nHub, ficaram: ficaram.length }, r);
      },
    },
    {
      nome: 'eco_comparar', titulo: 'ECO: comparar esquema × placa', leitura: true,
      descricao: 'O "Design » Update PCB Document" do Altium: compara o schematic.js com a placa efetiva e lista as Engineering Change Orders (componente a acrescentar/remover, footprint/comment diferente, net nova/renomeada, pino em outra net), cada uma com status ok/warn/err e mensagem. Usa o hub-pcbeco.js; sem ele, só a comparação de componentes.',
      entrada: { type: 'object', properties: { projeto: PROJETO, relatorio: { type: 'boolean' } }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const sch = ctx.schematic(p), L = ctx.libsDe(sch);
        const E = ctx.modulo('hub-pcbeco.js');
        if (E) {
          const pl = ctx.temBoard(p) ? ctx.placa(p) : null;
          const eco = E.compara(sch, pl ? pl.board : {}, { schlib: L.schlib, pcblib: L.pcblib, changes: pl ? pl.changes : [], eb: pl ? pl.eb : undefined });
          const acoes = eco.acoes || eco.actions || [];
          const out = { motor: 'HubPcbEco', total: acoes.length, por_status: acoes.reduce((s, x) => (s[x.status] = (s[x.status] || 0) + 1, s), {}),
                        acoes: acoes.map(x => ({ id: x.id, grupo: x.grupo, tipo: x.tipo, objeto: x.objeto, para: x.para, status: x.status, msg: x.msg })) };
          if (a.relatorio && E.relatorio) out.relatorio = E.relatorio(eco);
          return out;
        }
        const temPlaca = ctx.temBoard(p);
        const eb = temPlaca ? ctx.placa(p).eb : { components: [] };
        const doSch = new Map();
        for (const it of sch.items || []) if (it.t === 'comp' && !doSch.has(it.ref)) doSch.set(it.ref, it);
        const daPlaca = new Map((eb.components || []).map(c => [c.ref, c]));
        const difs = [];
        for (const [ref, s] of doSch) {
          const c = daPlaca.get(ref);
          if (c && (s.footprint || '') !== (c.footprint || '')) difs.push({ ref, campo: 'footprint', esquema: s.footprint, placa: c.footprint });
        }
        return { motor: 'reserva do MCP (sem hub-pcbeco.js)', placa: temPlaca,
                 faltam_na_placa: [...doSch.values()].filter(c => !daPlaca.has(c.ref)).map(c => ({ ref: c.ref, footprint: c.footprint })),
                 sobram_na_placa: [...daPlaca.values()].filter(c => !doSch.has(c.ref)).map(c => ({ ref: c.ref, footprint: c.footprint })), diferencas: difs };
      },
    },
    {
      nome: 'eco_aplicar', titulo: 'ECO: levar o esquema para a placa', modulo: 'hub-pcbeco.js',
      descricao: 'Executa o ECO (hub-pcbeco.js): transforma as ações marcadas em linhas do changes.js (comp_add com o footprint da PcbLib estacionado ao lado da placa, net_add, pad_net, comp_attr...) e grava validado. ids = só essas ações (eco_comparar mostra os ids); refs = só esses componentes. simular:true mostra as linhas sem gravar. Depois: pcb_mover para posicionar e nets_ratsnest/pcb_rotear para ligar.',
      entrada: { type: 'object', properties: Object.assign({ projeto: PROJETO, ids: { type: 'array', items: { type: 'string' } }, refs: { type: 'array', items: { type: 'string' } },
        opcoes: { type: 'object', additionalProperties: true, description: '{margem, folga, x0, y0} onde estacionar os novos' } }, SIM), required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const E = ctx.exige('hub-pcbeco.js', 'HubPcbEco');
        const sch = ctx.schematic(p), L = ctx.libsDe(sch);
        if (!ctx.temBoard(p)) throw new ErroMcp('o projeto não tem board.js: crie a placa antes (projeto_criar com placa, ou o assistente de placa nova da vista)');
        const pl = ctx.placa(p);
        let eco = E.compara(sch, pl.board, { schlib: L.schlib, pcblib: L.pcblib, changes: pl.changes, eb: pl.eb });
        const acoes = eco.acoes || eco.actions || [];
        if (a.ids || a.refs) {
          for (const x of acoes) {
            const txt = JSON.stringify([x.objeto, x.para, x.dados]);
            x.ativo = (a.ids ? a.ids.includes(x.id) : true) && (a.refs ? a.refs.some(r => new RegExp('\\b' + r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(txt)) : true);
          }
          eco = E.valida(eco) || eco;
        }
        const r = E.aplica(eco, a.opcoes || {});
        const linhas = r.linhas || [];
        if (!linhas.length) return { ok: true, linhas: 0, puladas: r.puladas, nota: 'nada a aplicar: esquema e placa já concordam (ou as ações foram puladas)' };
        return Object.assign({ via: 'HubPcbEco.aplica', puladas: r.puladas }, aplicaOps(ctx, p, linhas, a, 'eco_aplicar'));
      },
    },
  ],
};
