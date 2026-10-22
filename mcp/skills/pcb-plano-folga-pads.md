---
nome: pcb-plano-folga-pads
titulo: Plano de terra afastado dos pads
descricao: Regra da casa — o plano de terra (polygon pour) não chega perto dos pads de outra net: folga mínima de 1,0 mm do cobre do plano até o pad; entre pads vizinhos e entre as fileiras de um conector não fica lasca de plano. Use ao criar/editar polígono de cobre ou revisar uma placa.
---

# Plano de terra afastado dos pads (regra da casa)

**Por quê:** solda de conector/borne (principalmente a manual e a de onda) escorre e faz ponte com o plano se ele
passar a 0,25 mm do pad. Afastando o plano, o risco some: em volta de cada pad o plano é limpo, como nas placas
de referência da casa (fileira de pads dentro de uma faixa sem plano).

## A regra

1. **Folga do plano para pad de OUTRA net: 1,0 mm** (pad TH e SMD), contra 0,25–0,3 mm da folga normal de
   trilha. Com passo de 2,54 mm isso deixa a fileira inteira de pads dentro de uma faixa limpa.
2. **Pad da MESMA net do plano** (ex. pino GND): liga com alívio térmico (4 raios), nunca "direct" em pad TH —
   o térmico é o que deixa soldar. Se o pino GND ficar sem plano em volta, ligue-o com uma trilha curta até o plano
   ou até uma barra de GND.
3. **Sem lasca:** pedaço de plano estreito entre pads vizinhos ou entre as duas fileiras de um conector sai
   (`removeNecks` ligado, `neck` ≥ 0,25 mm, `minArea` ≈ 1,6 mm²) e ilha sem pad/via de GND sai (`removeDead`).
4. Trilhas de outras nets continuam com a folga normal (regra Clearance); a folga de 1,0 mm é só plano × pad.
5. Vias de costura do GND ficam fora das fileiras de pads (nas bordas, nas faixas livres entre conectores).

## Como fazer no NexoEletric (MCP)

- No polígono (`pour_definir` ou `poly_add` no `pcb_aplicar`), além das opções de sempre
  (`pourOver:"all"`, `removeDead:true`, `removeNecks:true`, `neck:0.25`, `clearance:0.3`, `clearanceBorda:0.6`):
  `clearanceTipo: { th: 1.0, smd: 1.0 }` (folga só para pads; trilha continua com `clearance`) e o alívio térmico
  `con_tipo:"relief", con_condutores:4, con_largura:0.381, con_gap:0.3, con_angulo:45`
  (desde a 1.17.0 também vale o objeto `conexao:{tipo, condutores, largura, gap, angulo}`; sem nada disso o
  `poly_add` liga "direct" e com a folga de trilha nos pads).
  Em polígono que já existe: `pcb_mudanca_editar {indice, campos:{clearanceTipo:{th:1,smd:1}, con_tipo:"relief", ...}}`.
  Grave também a regra PolygonConnect como Relief (4 × 0,381 mm, gap 0,3, 45°) para o Altium ligar igual.
- Para o Altium repetir o mesmo despejo, grave a regra com `regras_definir`:
  `{kind:"Clearance", name:"Clearance_PlanoPad", scope1:"IsPolygon", scope2:"IsPad", gap:1.0, priority:1}`
  (a Clearance geral fica com prioridade menor).
- **Conferir:** `pour_despejar` (nenhum aviso), depois `regras_casa_verificar {projeto}` — a regra "plano_pad"
  tem que voltar zerada — e `nets_ratsnest`/`drc_rodar` para ver se nenhum pino de GND ficou solto.
