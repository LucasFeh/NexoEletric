---
nome: pcb-boas-praticas
titulo: Boas práticas de layout de PCB (checklist da casa)
descricao: Checklist de boas práticas de PCB pesquisado (IPC-2221, guias de DFM de fabricantes e do Altium) com os números que a casa usa — folga por tensão, largura por corrente, anel, furo-cobre, borda, entrada de trilha no pad, ângulo agudo, alívio térmico, plano/vias de costura, serigrafia, teardrop. Use ao começar a rotear uma placa, ao criar regras e antes de entregar.
---

# Boas práticas de layout de PCB (checklist da casa)

Os números abaixo são o padrão da casa para placa de 2 camadas, FR-4, 1 oz, fabricação comum. Quando o
fabricante ou o dono der outro valor, vale o deles. Os valores de norma são ponto de partida: confira na norma ou
na capacidade do fabricante antes de usar em projeto crítico.

## 1. Folgas (Clearance)

- **Sinal até 50 V: 0,254 mm (10 mil)** entre cobre de nets diferentes (trilha, pad, via, plano). O mínimo de
  fábrica comum é 0,1 mm (4 mil); a casa fica bem acima para a solda e a fabricação não fazerem ponte.
- **Acima de 50 V a folga cresce com a tensão** (IPC-2221, tabela 6-1, camada externa sem verniz, ao nível do mar —
  ordem de grandeza: ~0,6 mm até 150 V, ~1,25 mm até 300 V, ~2,5 mm até 500 V; confira na norma). Separe as áreas de
  alta e baixa tensão desde o posicionamento; distância por superfície (creepage) é outra conta.
- **Faça a folga a maior possível**, não a mínima: trilha entre dois pinos vai no meio do vão.
- Nada de cobre de outra net em cima ou perto de pad: skill **pcb-cobre-sem-curto**.

## 2. Trilhas

- **Largura pela corrente** (calculadora IPC-2152/2221 com 10 °C de elevação). Sinal: 0,254 mm. Alimentação: largo
  (na casa, regra `Width_Power` até 3 mm) e curto.
- **Trilha mais fina que o pad** em que entra; trilha larga demais puxa a máscara e esfria a solda.
- **Entrada no pad a 90° ou 45°**, pelo lado ou pela ponta; **nada de ângulo agudo** (< 90°) entre trilhas ou
  trilha-pad: vira "acid trap" (o ácido fica no canto e come o cobre). Cantos a 45°.
- **Trilha termina no pad** — não passa por cima dele para seguir adiante.
- Dois pads de um componente pequeno (resistor, capacitor SMD) ligados por larguras parecidas (equilíbrio térmico,
  evita tombstoning).
- **Teardrop** em pad/via com trilha fina (`teardrop_aplicar`).

## 3. Furos, anéis e bordas

- **Anel anular** (cobre em volta do furo): mínimo de norma 0,05 mm externo; a casa usa ≥ 0,15 mm em pad passante
  (via 1,27 mm com furo 0,71 mm).
- **Furo até cobre de outra net ≥ 0,2 mm (8 mil).**
- **Cobre até a borda da placa ≥ 0,25 mm (10 mil)**; nos planos a casa usa `clearanceBorda: 0.6`.
- **Furo de parafuso isolado** do plano com o quadrado de 3 mm: skill **pcb-parafusos-isolados**.

## 4. Planos de cobre (polygon pour)

- **Todo plano ligado a uma net** (normalmente GND); nada de cobre solto: `removeDead: true` tira ilha sem ligação.
- **Sem lasca:** `removeNecks: true`, `neck` ≥ 0,25 mm, `minArea` ≈ 1,6 mm².
- **Alívio térmico** em pad passante ligado ao plano: 4 raios de 0,25–0,5 mm (a casa usa 0,381 mm, vão 0,3 mm,
  45°). Ligação direta só onde a corrente pede, e aí sem alívio no mesmo pad.
- **Plano afastado dos pads de outra net:** skill **pcb-plano-folga-pads**.
- **Vias de costura** do GND a cada 5–10 mm pelas bordas e nas faixas livres, fora das fileiras de pads.
- Um polígono = uma net; nada de plano cortado embaixo de par diferencial rápido.

## 5. Serigrafia e máscara

- **Serigrafia nunca em cima de pad, via, furo ou trilha**: skill **pcb-serigrafia-livre** (folga 0,254 mm além da
  máscara).
- Expansão de máscara 0,1 mm (4 mil); ponte de máscara entre pads pela regra `MinimumSolderMaskSliver` (padrão do
  Altium 0,254 mm).
- Via fora de pad SMD (via no pad só tampada/preenchida).

## 6. Antes de entregar

Skill **pcb-verificar-antes-de-entregar**: validação, DRC com os planos, ratsnest, regras da casa e o olho em cada
camada.

## Fontes da pesquisa (out/2026)

- IPC-2221 (tabela 6-1 de espaçamento; anel anular por classe) — resumo em Ultra Librarian, "IPC-2221 PCB Design Standards".
- Wevolver, "The ultimate guide to trace to pad clearance in PCB design".
- ALLPCB, "Copper pour design rules: a comprehensive guide for PCB layout" (alívio 4 raios 0,25–0,5 mm; costura 5–10 mm; plano sempre com net).
- Altium Resources, "8 Common DFM Problems PCB Design Rules Catch Before Fab" (acid trap, anel, serigrafia sobre pad, máscara).
- Altium Resources, "Thermal Relief Guidelines for PCB Layout" e "How Trace Routing Can Affect Solder Joints".
- Sierra Circuits, "9-Point PCB Design Checklist for DFM Compliance" (furo-cobre 8 mil, borda 10 mil, serigrafia-pad 4,5 mil).
- Fórum SparkFun, "PCB Routing between tracks and pads" (trilha no meio do vão; folga a maior possível).
