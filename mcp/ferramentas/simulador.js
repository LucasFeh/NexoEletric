/* NexoEletric MCP - grupo "sim": o SIMULADOR de circuito (1.101.0).
   O mesmo motor da tela (hub-simulador-motor.js + hub-simulador-circuito.js): o esquema vira circuito (resistor,
   capacitor, LED, diodo, transistor, MOSFET, regulador, conversor, 555, amp-op, MCU com GPIO...), as nets de
   alimentação pelo nome viram fontes e o resultado é a tensão de cada net e pino, a corrente de cada componente e as
   contas. Com a vista Esquema do projeto ABERTA, as ferramentas falam com ela (a pessoa vê a simulação na hora: pontos
   da corrente, cores de tensão, cálculos); fechada, calculam pelo arquivo (sem tela). A corrente nas trilhas da placa
   (hub-simulador-pcb.js) usa a simulação e o cobre do board.js. */
'use strict';
const { ErroMcp } = require('../lib/contexto.js');
const { PROJETO } = require('../lib/util.js');
const M = require('../../hub-simulador-motor.js');
const C = require('../../hub-simulador-circuito.js');
const P = require('../../hub-simulador-pcb.js');

const CONFIG = {
  type: 'object', additionalProperties: false,
  description: 'configuração da simulação (sem a vista aberta; com ela, use sim_controlar): fontes {net:{v, onda?:{forma:"seno"|"quadrada"|"triangular", v, f, duty, off}}}, terra [nets], chaves {ref:true=fechada}, pots {ref:0..1}, gpio {"REF-PINO":{modo:"alto"|"baixo"|"pwm"|"entrada"|"pullup"|"pulldown", duty, f}}, valores {ref:"10k"}, desligados [refs], entradaPadrao (V)',
  properties: {
    fontes: { type: 'object', additionalProperties: true }, terra: { type: 'array', items: { type: 'string' } },
    chaves: { type: 'object', additionalProperties: true }, pots: { type: 'object', additionalProperties: true },
    gpio: { type: 'object', additionalProperties: true }, valores: { type: 'object', additionalProperties: true },
    desligados: { type: 'array', items: { type: 'string' } }, entradaPadrao: { type: 'number' },
  },
};

function vista(ctx, nome, args, segundos) {
  return require('./hub.js').pedeVista(ctx, 'sch', nome, 'simulador', args, segundos || 10, true);
}
/* o calculo pelo arquivo: o esquema do projeto, o motor, a analise */
function semTela(ctx, p, a) {
  const s0 = ctx.schematic(p);
  const L = ctx.libsDe(s0);
  const hc = ctx.hc;
  const model = hc.buildSchModel(s0);
  const nets = hc.extractNets(model, L.schlib);
  const comps = C.doEsquema(model, L.schlib, nets, hc);
  const mt = C.monta(comps, a.config || {});
  const sim = M.cria(mt.elementos, { terra: mt.terra, dt: a.dt || 1e-4 });
  let res;
  const amostras = [];
  if (a.modo === 'tempo') {
    sim.liga();
    const dur = Math.min(+a.duracao || 0.05, 10);
    const passos = Math.min(2e6, Math.ceil(dur / sim.dt));
    const obs = (a.nets || []).slice(0, 8);
    const cada = Math.max(1, Math.floor(passos / 400));
    for (let k = 0; k < passos; k++) {
      res = sim.passo(1);
      if (obs.length && k % cada === 0) amostras.push({ t: res.t, v: Object.fromEntries(obs.map(n => [n, res.v[n]])) });
    }
  } else res = sim.dc();
  const an = C.analisa(mt, res);
  return { mt, res, an, amostras, model, nets };
}
/* sem a vista, com as entradas: elas viram fontes (por cima das da config) */
function semTelaComEntradas(ctx, p, a) {
  if (!a.entradas) return semTela(ctx, p, a);
  const s0 = ctx.schematic(p), L = ctx.libsDe(s0), hc = ctx.hc;
  const model = hc.buildSchModel(s0), nets = hc.extractNets(model, L.schlib);
  const comps = C.doEsquema(model, L.schlib, nets, hc);
  const cfg = Object.assign({}, a.config || {});
  cfg.fontes = Object.assign({}, cfg.fontes || {});
  for (const [net, f] of Object.entries(C.entradasParaFontes(comps, a.entradas))) { if (f === null) cfg.fontes[net] = { desligada: true }; else cfg.fontes[net] = f; }
  return semTela(ctx, p, Object.assign({}, a, { config: cfg }));
}
function conectoresDe(r) {
  const { mt, an, res } = r;
  return [...mt.comps.values()].filter(c => c.tipo === 'conector').map(c => ({ ref: c.ref, comment: c.comp.comment || '',
    pinos: c.pinos.map(q => { const pin = an.pinos[c.ref + '-' + q.num] || {}; const f = mt.fontes.find(x => x.net === q.net);
      return { pino: q.num, nome: q.name || '', net: q.net || '', v: pin.v, i: pin.i, entrada: f ? { v: f.v, origem: f.origem, corrente_entregue: (an.fontes.find(x => x.net === f.net) || {}).i } : null,
               terra: !!q.net && mt.terra.includes(q.net), flutuando: !!q.net && (res.flutuantes || []).includes(q.net) }; }) }));
}
/* OS DADOS DE DATASHEET (1.102.0, "Recolher informações"): um registro por COMPONENTE (a chave e o numero da peca,
   HubSimCircuito.chaveDados) em Libs/componentes-dados.json — a pasta Libs/ vai para o NexoBD (item "Biblioteca do
   NexoEletric"), entao o que a IA levantou vale em qualquer projeto e maquina. Pedido do dono: "as informações que
   vierem do datasheet ficam salvas no componente". */
const fs = require('node:fs');
const path = require('node:path');
function arqDados(ctx) { return path.join(ctx.root, 'Libs', 'componentes-dados.json'); }
function leDados(ctx) {
  try { const j = JSON.parse(fs.readFileSync(arqDados(ctx), 'utf8')); if (j && typeof j === 'object' && j.componentes) return j; } catch (_e) { /* ainda nao existe */ }
  return { formato: 'nexoeletric-componentes-dados-1', componentes: {} };
}
const TIPOS_PINO = ['alimentacao', 'terra', 'entrada', 'saida', 'es', 'analogico', 'comunicacao', 'controle', 'nc', 'outro'];
const resumoComp = c => ({ titulo: c.titulo, tipo: c.tipo, potencia: c.p, alertas: c.alertas });
function saidaSemTela(r, a) {
  const { mt, res, an } = r;
  const nets = Object.fromEntries(Object.entries(an.nets).filter(([n]) => !n.includes('#') && (!a.nets || !a.nets.length || a.nets.includes(n))).map(([n, x]) => [n, { v: x.v, flutuante: x.flutuante }]));
  const comps = {};
  for (const [ref, c] of Object.entries(an.comps)) if (!a.refs || !a.refs.length || a.refs.includes(ref)) comps[ref] = a.detalhe ? c : resumoComp(c);
  return {
    fonte_dos_dados: 'arquivo (vista Esquema fechada: a pessoa não está vendo)', modo: res.modo, t: res.t, convergiu: res.ok, iteracoes: res.iter, aviso: res.aviso || undefined,
    terra: mt.terra, fontes: an.fontes.map(f => ({ net: f.net, v: f.v, origem: f.origem, motivo: f.motivo, corrente: f.i, potencia: f.p })),
    potencia_total: an.resumo.potencia, alertas: an.resumo.alertas, avisos: mt.avisos,
    sem_modelo: [...mt.comps.values()].filter(c => c.tipo === 'desconhecido').map(c => c.ref),
    nets, componentes: comps, amostras: r.amostras.length ? r.amostras : undefined,
  };
}

module.exports = {
  grupo: 'sim',
  ordem: 35,
  titulo: 'Simulador de circuito (tensão, corrente, cálculos, corrente nas trilhas)',
  modulos: ['hub-simulador-motor.js', 'hub-simulador-circuito.js', 'hub-simulador-pcb.js'],
  ferramentas: [
    {
      nome: 'sim_rodar', titulo: 'Simular o circuito', leitura: true,
      descricao: 'Simula o esquema do projeto como o botão Simular da vista Esquema (estilo Falstad): reconhece os componentes (R, C, L, LED pela cor, diodo/zener/TVS, BJT/MOSFET pelo nome, regulador 78xx/1117/LM317, buck/boost LM2575/2596/MP1584/MT3608, 555, amp-op/comparador, optoacoplador, ULN2003, portas 74xx/40xx, MCU ESP32/STM32/AVR/RP2040 com GPIO, relé, chave, potenciômetro, bateria) e põe fonte nas nets de alimentação pelo nome (+5V, 3V3, 12V, VCC...) e na entrada dos reguladores (suposta, editável). modo "dc" (padrão) = ponto de operação; "tempo" = transiente desde o "ligar" por `duracao` segundos (amostra as `nets` pedidas). Com a vista Esquema aberta e ao_vivo (padrão), devolve o que a TELA está simulando (com a configuração dela); senão calcula pelo arquivo com `config`. Devolve fontes (com o motivo), tensões das nets, componentes (alertas: potência acima da nominal, LED sem corrente, regulador em dropout, alimentação fora da faixa) e os sem modelo.',
      entrada: { type: 'object', properties: { projeto: PROJETO, modo: { type: 'string', enum: ['dc', 'tempo'] }, duracao: { type: 'number', description: 'segundos de simulação (modo tempo; máx. 10)' },
        nets: { type: 'array', items: { type: 'string' }, description: 'só estas nets (e, no modo tempo, as amostradas)' }, refs: { type: 'array', items: { type: 'string' } },
        detalhe: { type: 'boolean', description: 'traz as contas de cada componente' }, ao_vivo: { type: 'boolean', description: 'false = sempre pelo arquivo' }, config: CONFIG }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        if (a.ao_vivo !== false && !a.config) {
          const v = await vista(ctx, p.nome, { acao: 'estado', detalhe: !!a.detalhe }, 6).catch(e => ({ ok: false, erro: e.message }));
          if (v && v.ok && v.dados && v.dados.ligado) return Object.assign({ fonte_dos_dados: 'vista Esquema aberta (o que a pessoa está vendo)' }, v.dados);
        }
        return saidaSemTela(semTela(ctx, p, a), a);
      },
    },
    {
      nome: 'sim_pinos', titulo: 'Tensão e corrente nos pinos', leitura: true,
      descricao: 'A tensão, a corrente (positiva = entrando no componente) e o papel de cada pino — como o mouse em cima do pino mostra na tela: alimentação (com a faixa do CI e ✓), terra, GPIO (saída alta/baixa/PWM, entrada que lê 0/1/indefinido), sinal, flutuando; e o alerta (acima da alimentação, corrente demais no GPIO). Filtre por ref ou net. Ao vivo se a vista Esquema estiver simulando.',
      entrada: { type: 'object', properties: { projeto: PROJETO, ref: { type: 'string' }, net: { type: 'string' }, config: CONFIG, ao_vivo: { type: 'boolean' } }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        if (a.ao_vivo !== false && !a.config) {
          const v = await vista(ctx, p.nome, { acao: 'pinos', ref: a.ref, net: a.net }, 6).catch(() => null);
          if (v && v.ok && v.dados) return Object.assign({ fonte_dos_dados: 'vista Esquema aberta' }, v.dados);
        }
        const r = semTela(ctx, p, a);
        const out = {};
        for (const [k, x] of Object.entries(r.an.pinos)) if ((!a.ref || x.ref === a.ref) && (!a.net || x.net === a.net)) out[k] = x;
        return { fonte_dos_dados: 'arquivo', modo: r.res.modo, pinos: out };
      },
    },
    {
      nome: 'sim_componente', titulo: 'Cálculos de um componente', leitura: true,
      descricao: 'As contas de um componente com a fórmula e os números (a área Cálculos do painel): Ohm e potência do resistor, Vf e corrente do LED (e o resistor de limitação), região do transistor (corte/ativo/saturação, β·Ib), Vgs/Rds do MOSFET, dropout/dissipação/rendimento do regulador, FB e corrente de entrada do conversor, tempos e frequência do 555 astável, canal do amp-op, faixa de alimentação do CI. Com a vista aberta, também foca o componente e fixa as contas no painel.',
      entrada: { type: 'object', properties: { projeto: PROJETO, ref: { type: 'string' }, config: CONFIG, mostrar: { type: 'boolean', description: 'false = não mexe na tela' } }, required: ['projeto', 'ref'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        if (!a.config) {
          const v = await vista(ctx, p.nome, { acao: 'componente', ref: a.ref, mostrar: a.mostrar }, 6).catch(() => null);
          if (v && v.ok && v.dados) return Object.assign({ fonte_dos_dados: 'vista Esquema aberta' }, v.dados);
        }
        const r = semTela(ctx, p, a);
        const c = r.an.comps[a.ref];
        if (!c) throw new ErroMcp(`o componente ${a.ref} não está no esquema`);
        return Object.assign({ fonte_dos_dados: 'arquivo' }, c);
      },
    },
    {
      nome: 'sim_controlar', titulo: 'Comandar o simulador na tela',
      descricao: 'Comanda o simulador da vista Esquema ABERTA (a pessoa vê na hora; a configuração fica guardada na máquina dela). acao: parametros {ref, e o campo do tipo — sem campo devolve a lista {campos:[{k, rot, un, v}]}: resistor potencia (W; queima acima de 2×) e tol (%: o valor real cai na faixa); rede de resistores potencia (cada); capacitor vmax (V; queima acima de 1,2× e o polarizado com mais de 1 V ao contrário); LED vf (V) e imax (A; queima acima de 1,5× ou com mais de 5 V ao contrário); diodo ifmax (A; 1,5×) e vrrm (V; o retificador queima acima), zener vz (V) e pz (W; 1,5×), TVS vz (Vbr); transistor bf (β), icmax (A; 1,5×), pd (W; 1,5×), vceo (V); MOSFET/IGBT vth, rdson (Ω), idmax (A; 1,5×), vdss (V; 1,1×), pd (W; 1,5×), vgsmax (V; acima rompe o gate); potenciômetro pos (%) e potencia (W da pista; o trecho de fração f aguenta f·P, queima acima de 2×); NTC temp (°C), beta e potencia; PTC de partida inom; fusível inom (A) e retardo (0 rápido: abre acima de In; 1 lento: acima de 1,5×) — o rearmável (PTC) dispara acima de 2× e rearma sozinho; indutor inom (A; satura acima, queima acima de 1,5×) e dcr (Ω); ferrite inom. Acima da nominal (abaixo da queima) vem o alerta "ACIMA da nominal"} · trocar {ref} (o componente QUEIMADO volta novo) · queimados (a lista: o LED acima de 1,5× a nominal e o resistor acima de 2× a potência queimam e abrem) · ligar {modo:"dc"|"tempo", velocidade (s de simulação por s; 1 = tempo real)} · desligar · pausar · continuar · religar (tudo descarregado em t=0) · estado {detalhe} · modo {modo, velocidade} · mostrar {mostrar:{pontos, cores, tensoes, valores, brilho}, calculos:true|false (a área de cálculos)} · chave {ref, fechada} (chave, botão, jumper) · pot {ref, posicao 0..1} (potenciômetro, LDR) · fonte {net, v, onda:{forma, v, f, duty, off}, desligada, remover} · gpio {ref, pino, modo:"alto"|"baixo"|"pwm"|"entrada"|"pullup"|"pulldown"|null, duty, f} · terra {nets} · valor {ref, valor} (só na simulação) · desligar_componente {ref, desligado} · osciloscopio {nets, remover, esperar_ms, amostras} · rodar {duracao} (avança o tempo de simulação já) · analisar {ref, num} | {net} | {ref} + modo:"lista"|"osc" (abre na tela a janela Analisar da pessoa: os valores e as contas, ou o osciloscópio do sinal; devolve o texto) · analisar_fechar · pecas (as peças vivas do Wokwi que o NexoCode 0.4.0+ manda: OLED, LCD, servo, NeoPixel, teclado, sensores — por designador) · peca {id, entrada:{acao:"apertar"|"soltar"|"attr"|"girar"|"movimento", valor, attr, linha, coluna}} (mexe na peça: vai para o firmware no próximo sincronismo) · limpar (volta a configuração ao padrão). Os valores mostrados no tempo são a MÉDIA (como um multímetro; o PWM não pisca); o osciloscópio guarda cada passo. Precisa da vista Esquema do projeto aberta (vista_abrir).',
      entrada: { type: 'object', properties: { projeto: PROJETO, acao: { type: 'string', enum: ['ligar', 'desligar', 'pausar', 'continuar', 'religar', 'estado', 'modo', 'mostrar', 'chave', 'pot', 'fonte', 'gpio', 'terra', 'valor', 'desligar_componente', 'osciloscopio', 'rodar', 'analisar', 'analisar_fechar', 'pecas', 'peca', 'parametros', 'trocar', 'queimados', 'limpar'] } }, required: ['projeto', 'acao'], additionalProperties: true },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const args = Object.assign({}, a); delete args.projeto;
        const v = await vista(ctx, p.nome, args, Math.min(20, 6 + (+a.duracao || 0) * 2 + (+a.esperar_ms || 0) / 1000));
        if (!v || !v.ok) throw new ErroMcp((v && v.erro) || 'a vista não respondeu' + (v && v.semVista ? ': abra o esquema do projeto (vista_abrir {projeto, aba:"esquema"})' : ''));
        return v.dados;
      },
    },
    {
      nome: 'sim_conectores', titulo: 'Entradas e saídas da placa', leitura: true,
      descricao: 'Os conectores da placa (J, CN, P, X...) pino a pino: net, tensão e corrente simuladas, se o pino é ENTRADA (tem fonte: aplicada, pelo nome da net, pelo comment do conector ou suposta), terra, ou saída/medida (aberto), e se está flutuando — a seção "Entradas e saídas" do painel. Ao vivo se a vista Esquema estiver simulando (a aba Simulador), senão pelo arquivo com `config`/`entradas`.',
      entrada: { type: 'object', properties: { projeto: PROJETO, entradas: { type: 'object', additionalProperties: true, description: 'só sem a vista: {"CN2-1": 24, "+5V": 5}' }, config: CONFIG }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        if (!a.config && !a.entradas) {
          const v = await vista(ctx, p.nome, { acao: 'conectores' }, 6).catch(() => null);
          if (v && v.ok && Array.isArray(v.dados) && v.dados.length) return { fonte_dos_dados: 'vista Esquema aberta', conectores: v.dados };
        }
        const r = semTelaComEntradas(ctx, p, a);
        return { fonte_dos_dados: 'arquivo', conectores: conectoresDe(r) };
      },
    },
    {
      nome: 'sim_testar', titulo: 'Aplicar tensões nas entradas e conferir o esperado', leitura: true,
      descricao: 'O banco de testes da placa: aplica tensões nas ENTRADAS (`entradas`: {"CN2-1": 24, "J1-2": {v:5, onda:{forma:"quadrada", v:5, f:1000}}, "+12V": 12, "CN3-4": null = abre}; a chave é o pino REF-NUM do conector ou o nome da net), simula (modo "dc" ou "tempo" por `duracao` s) e CONFERE cada ponto de `verificar`: [{alvo: pino "U1-2" | net "+3.3V" | componente "R5", esperado, tol, min, max, grandeza: "v" (padrão) | "i" | "p"}] — devolve medido, ok/falhou e o motivo, mais os alertas (dissipação, dropout, LED, alimentação fora da faixa) e todos os conectores. Use para responder "sai o esperado?": defina o que cada saída deveria dar e leia os que falharam. ao_vivo (padrão, com a vista Esquema/aba Simulador aberta) aplica NA TELA — a pessoa vê; sem a vista, calcula pelo arquivo.',
      entrada: { type: 'object', properties: { projeto: PROJETO, entradas: { type: 'object', additionalProperties: true },
        verificar: { type: 'array', items: { type: 'object', properties: { alvo: { type: 'string' }, esperado: { type: 'number' }, tol: { type: 'number' }, min: { type: 'number' }, max: { type: 'number' }, grandeza: { type: 'string', enum: ['v', 'i', 'p'] } }, required: ['alvo'] } },
        modo: { type: 'string', enum: ['dc', 'tempo'] }, duracao: { type: 'number' }, ao_vivo: { type: 'boolean' }, config: CONFIG }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        if (a.ao_vivo !== false && !a.config) {
          const v = await vista(ctx, p.nome, { acao: 'testar', entradas: a.entradas || {}, verificar: a.verificar || [], modo: a.modo, duracao: a.duracao }, Math.min(20, 8 + (+a.duracao || 0) * 3)).catch(e => ({ ok: false, erro: e.message }));
          if (v && v.ok && v.dados) return Object.assign({ fonte_dos_dados: 'vista Esquema aberta (aplicado na tela)' }, v.dados);
          if (v && !v.semVista && v.erro && !/nenhum hub|nenhuma vista|não tem as rotas/.test(v.erro)) throw new ErroMcp(v.erro);
        }
        const r = semTelaComEntradas(ctx, p, a);
        const res = C.verifica(r.an, a.verificar || []);
        return { fonte_dos_dados: 'arquivo (sem a vista: a pessoa não está vendo)', modo: r.res.modo, t: r.res.t, convergiu: r.res.ok,
          passou: res.every(x => x.ok), resultados: res, alertas: r.an.resumo.alertas, avisos: r.mt.avisos,
          fontes: r.an.fontes.map(f => ({ net: f.net, v: f.v, origem: f.origem, corrente: f.i })), conectores: conectoresDe(r) };
      },
    },
    {
      nome: 'sim_datasheet_pendentes', titulo: 'Componentes sem dados de datasheet', leitura: true,
      descricao: 'O começo do "Recolher informações" do simulador: os componentes do projeto que precisam de datasheet (CIs, MCU, reguladores, transistores, diodos especiais — passivos não), cada um com a CHAVE (o número da peça que o sim_datasheet_gravar usa), o comment, o símbolo, o footprint, e os pinos como estão no esquema (número, nome, net), e se já tem dados salvos. Fluxo: sim_datasheet_pendentes → achar o datasheet oficial na internet (IntegrateBrowser pesquisar/ler_links) → sim_datasheet_gravar por componente.',
      entrada: { type: 'object', properties: { projeto: PROJETO, todos: { type: 'boolean', description: 'true = também os que já têm dados' } }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const r = semTela(ctx, p, {});
        const banco = leDados(ctx);
        const vistos = new Map();
        for (const info of r.mt.comps.values()) {
          const cc = Object.assign({}, info.comp, { valor: info.valorTxt });
          const k = C.chaveDados(cc, info.tipo);
          if (!k) continue;
          const tem = C.dadosDe(banco, cc, info.tipo);
          if (tem && !a.todos) continue;
          const v = vistos.get(k) || { chave: k, refs: [], comment: info.comp.comment || '', simbolo: info.comp.sym || '', footprint: info.comp.footprint || '', tipo_no_simulador: info.tipo, ja_tem: tem ? tem.chave : null,
            pinos: info.pinos.map(q => ({ num: q.num, nome: q.name || '', net: q.net || '' })) };
          v.refs.push(info.ref);
          vistos.set(k, v);
        }
        return { arquivo: path.relative(ctx.root, arqDados(ctx)), salvos: Object.keys(banco.componentes).length, pendentes: [...vistos.values()] };
      },
    },
    {
      nome: 'sim_datasheet_gravar', titulo: 'Gravar os dados de datasheet no componente',
      descricao: 'Grava (ou completa) o registro de UM componente em Libs/componentes-dados.json — a biblioteca do NexoEletric, sincronizada com o NexoBD: vale para todo projeto que usa a peça. O simulador mostra no mouse em cima do pino (esquema, PCB 2D e 3D) e nos cálculos. pinos = {"<número do pino como no esquema>": {nome, funcao (o que faz, uma linha), tipo: ' + TIPOS_PINO.join('|') + ', descricao, vmax, imax}}. Só o que está no datasheet — não invente. apelidos = outros nomes da mesma peça (ESP32-WROOM-32D, ESP32-WROOM-32E).',
      entrada: { type: 'object', properties: {
        chave: { type: 'string', description: 'a chave que o sim_datasheet_pendentes deu (número da peça)' },
        fabricante: { type: 'string' }, resumo: { type: 'string', description: 'uma linha: o que é a peça' }, datasheet_url: { type: 'string' },
        alimentacao: { type: 'object', properties: { vmin: { type: 'number' }, vmax: { type: 'number' }, icc_a: { type: 'number' } } },
        pinos: { type: 'object', additionalProperties: { type: 'object', properties: { nome: { type: 'string' }, funcao: { type: 'string' }, tipo: { type: 'string' }, descricao: { type: 'string' }, vmax: { type: 'number' }, imax: { type: 'number' } } } },
        apelidos: { type: 'array', items: { type: 'string' } }, notas: { type: 'string' }, substituir: { type: 'boolean', description: 'true = troca o registro inteiro; padrão completa' } }, required: ['chave'] },
      executa: async (a, ctx) => {
        const banco = leDados(ctx);
        const k = String(a.chave).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim().replace(/\s+/g, ' ');
        if (!k) throw new ErroMcp('chave vazia');
        const ant = a.substituir ? {} : (banco.componentes[k] || {});
        const novo = Object.assign({}, ant);
        for (const c of ['fabricante', 'resumo', 'datasheet_url', 'notas']) if (a[c] != null) novo[c] = String(a[c]);
        if (a.alimentacao) novo.alimentacao = Object.assign({}, ant.alimentacao || {}, a.alimentacao);
        if (a.apelidos) novo.apelidos = [...new Set([].concat(ant.apelidos || [], a.apelidos.map(String)))];
        if (a.pinos) {
          novo.pinos = Object.assign({}, ant.pinos || {});
          for (const [n, pi] of Object.entries(a.pinos)) {
            if (pi && pi.tipo && !TIPOS_PINO.includes(String(pi.tipo))) pi.tipo = 'outro';
            novo.pinos[String(n)] = Object.assign({}, novo.pinos[String(n)] || {}, pi);
          }
        }
        novo.fonte = 'IA (datasheet)';
        novo.atualizado = new Date().toISOString();
        banco.componentes[k] = novo;
        const abs = arqDados(ctx);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        ctx.grava(abs, JSON.stringify(banco, null, 1) + '\n', 'sim_datasheet_gravar');
        /* a tela aberta rele os dados (sem a vista, nada a fazer) */
        try { await require('./hub.js').pedeVista(ctx, 'sch', '*', 'simulador', { acao: 'dados' }, 1, true); } catch (_e) { /* sem vista */ }
        return { chave: k, pinos: Object.keys(novo.pinos || {}).length, arquivo: path.relative(ctx.root, abs), total: Object.keys(banco.componentes).length };
      },
    },
    {
      nome: 'sim_datasheet_ler', titulo: 'Ler os dados de datasheet de um componente', leitura: true,
      descricao: 'O que está salvo para um componente (por chave = número da peça) ou para um ref de um projeto ({projeto, ref}); sem nada, a lista das chaves salvas.',
      entrada: { type: 'object', properties: { chave: { type: 'string' }, projeto: PROJETO, ref: { type: 'string' } } },
      executa: async (a, ctx) => {
        const banco = leDados(ctx);
        if (a.projeto && a.ref) {
          const r = semTela(ctx, ctx.projeto(a.projeto), {});
          const info = r.mt.comps.get(a.ref);
          if (!info) throw new ErroMcp('o componente ' + a.ref + ' não está no esquema');
          const cc = Object.assign({}, info.comp, { valor: info.valorTxt });
          return { ref: a.ref, chave: C.chaveDados(cc, info.tipo), dados: C.dadosDe(banco, cc, info.tipo) };
        }
        if (a.chave) { const k = String(a.chave).toUpperCase().trim(); return { chave: k, dados: banco.componentes[k] || null }; }
        return { total: Object.keys(banco.componentes).length, chaves: Object.keys(banco.componentes) };
      },
    },
    {
      nome: 'sim_bancada', titulo: 'Bancada do simulador (itens e fios)',
      descricao: 'A BANCADA da aba Simulador (o 3D da aba: a vista PCB no modo 3D é a bancada): a placa em 3D sobre a mesa, os itens da biblioteca do Nexo Hub com atributos.bancada (motor DC, fonte — criados no NexoCAD) e os fios. acao: bancada_estado · bancada_biblioteca (os itens que podem ir para a bancada) · bancada_colocar {item: id|nome|rotulo, tipo?: "motor_dc"|"fonte", pos?: [x,y] mm} · bancada_fio {de, para} (pad da placa "CN1-1" ou terminal "M1:+" / "PS1:-") · bancada_mover {item, pos?: [x,y] mm, rot?: graus} · bancada_remover {item|fio} · bancada_limpar · bancada_ativar {ligado}. O que fica ligado entra na simulação do Esquema: o motor gira (rpm e corrente em sim_rodar/sim_componente {ref:"M1"}), a fonte alimenta. Precisa da vista PCB do projeto aberta (a aba Simulador › 3D).',
      entrada: { type: 'object', properties: { projeto: PROJETO, acao: { type: 'string', enum: ['bancada_estado', 'bancada_biblioteca', 'bancada_colocar', 'bancada_fio', 'bancada_mover', 'bancada_remover', 'bancada_limpar', 'bancada_ativar'] } }, required: ['projeto', 'acao'], additionalProperties: true },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const args = Object.assign({}, a); delete args.projeto;
        const v = await require('./hub.js').pedeVista(ctx, 'pcb', p.nome, 'simulador', args, 12, true);
        if (!v || !v.ok) throw new ErroMcp((v && v.erro) || 'a vista PCB não respondeu' + (v && v.semVista ? ': abra a aba Simulador › Bancada do projeto' : ''));
        return v.dados;
      },
    },
    {
      nome: 'sim_trilhas', titulo: 'Corrente nas trilhas da placa', leitura: true,
      descricao: 'A corrente de cada trilha da PCB a partir da simulação (a mesma conta da opção "Corrente nas trilhas" da vista 3D): cada pino vira o pad de mesmo nome e a corrente se divide pelo cobre (trilhas com R = ρ·L/(w·t), vias, polígonos de cobre). Por trecho: net, camada, corrente com sentido (de x1,y1 para x2,y2), resistência, queda de tensão, potência e aquecimento IPC-2221 (e a corrente máxima para +10 °C). As mais carregadas primeiro. mostrar_3d liga/desliga a opção na vista PCB aberta.',
      entrada: { type: 'object', properties: { projeto: PROJETO, limite: { type: 'integer', minimum: 1, maximum: 500 }, net: { type: 'string' }, cobre_um: { type: 'number', description: 'espessura do cobre em µm (padrão 35 = 1 oz)' },
        config: CONFIG, mostrar_3d: { type: 'boolean' } }, required: ['projeto'] },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        if (a.mostrar_3d != null) await require('./hub.js').pedeVista(ctx, 'pcb', p.nome, 'simulador', { acao: 'pcb_mostrar', ligado: a.mostrar_3d }, 6, true).catch(() => null);
        /* os pinos: da tela (se simulando) ou do arquivo */
        let pinos = null, de = 'arquivo';
        if (!a.config) {
          const v = await vista(ctx, p.nome, { acao: 'pinos' }, 6).catch(() => null);
          if (v && v.ok && v.dados && v.dados.pinos && Object.keys(v.dados.pinos).length) { pinos = v.dados.pinos; de = 'vista Esquema aberta'; }
        }
        if (!pinos) pinos = semTela(ctx, p, a).an.pinos;
        const pl = ctx.placa(p);
        const r = P.correntes(pl.eb, pinos, { cobre_um: a.cobre_um });
        const segs = r.segs.filter(s => !a.net || s.net === a.net).sort((x, y) => Math.abs(y.i) - Math.abs(x.i)).slice(0, a.limite || 40);
        return { fonte_dos_dados: de, imax: r.imax, nets: r.nets, pads_sem_pino: r.sem.slice(0, 40), trilhas: segs };
      },
    },
  ],
};
