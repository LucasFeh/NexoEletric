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
      descricao: 'Comanda o simulador da vista Esquema ABERTA (a pessoa vê na hora; a configuração fica guardada na máquina dela). acao: ligar {modo:"dc"|"tempo", velocidade (s de simulação por s; 1 = tempo real)} · desligar · pausar · continuar · religar (tudo descarregado em t=0) · estado {detalhe} · modo {modo, velocidade} · mostrar {mostrar:{pontos, cores, tensoes, valores, brilho}, calculos:true|false (a área de cálculos)} · chave {ref, fechada} (chave, botão, jumper) · pot {ref, posicao 0..1} (potenciômetro, LDR) · fonte {net, v, onda:{forma, v, f, duty, off}, desligada, remover} · gpio {ref, pino, modo:"alto"|"baixo"|"pwm"|"entrada"|"pullup"|"pulldown"|null, duty, f} · terra {nets} · valor {ref, valor} (só na simulação) · desligar_componente {ref, desligado} · osciloscopio {nets, remover, esperar_ms, amostras} · rodar {duracao} (avança o tempo de simulação já) · limpar (volta a configuração ao padrão). Precisa da vista Esquema do projeto aberta (vista_abrir).',
      entrada: { type: 'object', properties: { projeto: PROJETO, acao: { type: 'string', enum: ['ligar', 'desligar', 'pausar', 'continuar', 'religar', 'estado', 'modo', 'mostrar', 'chave', 'pot', 'fonte', 'gpio', 'terra', 'valor', 'desligar_componente', 'osciloscopio', 'rodar', 'limpar'] } }, required: ['projeto', 'acao'], additionalProperties: true },
      executa: async (a, ctx) => {
        const p = ctx.projeto(a.projeto);
        const args = Object.assign({}, a); delete args.projeto;
        const v = await vista(ctx, p.nome, args, Math.min(20, 6 + (+a.duracao || 0) * 2 + (+a.esperar_ms || 0) / 1000));
        if (!v || !v.ok) throw new ErroMcp((v && v.erro) || 'a vista não respondeu' + (v && v.semVista ? ': abra o esquema do projeto (vista_abrir {projeto, aba:"esquema"})' : ''));
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
