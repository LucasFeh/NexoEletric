---
nome: pcb-parafusos-isolados
titulo: Furos de parafuso isolados
descricao: Regra da casa — todo furo de parafuso/fixação fica dentro de um quadrado SEM COBRE nenhum (plano, trilha, via), 3 mm além do furo, nas duas camadas. Use ao criar plano de terra, rotear perto de furos de fixação ou revisar uma placa.
---

# Furos de parafuso isolados (regra da casa)

**Por quê:** a cabeça do parafuso, a arruela e o espaçador encostam na placa. Se houver cobre ali (plano de
terra, +5V, sinal), o parafuso curto-circuita com o gabinete/rack ou rasga a máscara e encosta no cobre com o
aperto e a vibração.

## A regra

1. **Quais furos:** recorte de placa redondo (board cutout pequeno, ex. Ø3,4 do M3), furo de fixação de
   componente sem anel de cobre (pad sem net com furo ≥ 2,5 mm e pad do tamanho do furo, ex. os furos de
   fixação de bornes) e qualquer furo que o usuário disser que é de parafuso.
2. **O quadrado:** centrado no furo, lado = diâmetro do furo + 2 × 3 mm (furo Ø3,4 → 9,4 mm; Ø4 → 10 mm).
   Se o usuário der outra folga, vale a dele.
3. **Nada de cobre dentro do quadrado, em TODAS as camadas de cobre:** nem plano (de nenhuma net, inclusive
   GND), nem trilha, nem via, nem pad, nem fill/região. Não é só "tirar o GND": +5V embaixo do parafuso é pior.
4. Dois quadrados que quase se tocam (sobra < 1 mm de cobre entre eles) viram um retângulo só — tira de cobre
   estreita entre dois furos não serve para nada e vira lasca.

## Como fazer no NexoEletric (MCP)

- Ache os furos: `regras_casa_verificar {projeto}` lista cada furo de parafuso com o quadrado (x1,y1,x2,y2);
  ou `pcb_consultar {tipo:"recortes"}` e `pcb_componente` dos bornes (pads sem net com `drill` ≥ 2,5 e `w` = `drill`).
- **Trilhas/vias que passam no quadrado:** desvie por fora (`pcb_editar`, ou `pcb_mudanca_editar` quando a trilha
  foi acrescentada pelo changes.js). Barramento largo de alimentação contorna o quadrado com dois dentes de 45°.
- **Plano de terra:** o `poly_add` do hub é um polígono simples (sem furo no meio). Para tirar o quadrado do plano,
  divida o plano da camada em blocos encostados cujas divisas passam pelos furos, e recorte em cada bloco a
  metade do quadrado como um dente na borda (o quadrado inteiro fica vazio; fora dele a divisa é cobre contínuo,
  porque os blocos são da mesma net). No Altium o equivalente é um *Polygon Pour Cutout* do tamanho do quadrado.
  Depois do ApplyChanges no Altium: Tools » Polygon Pours » Repour All.
- **Conferir:** `regras_casa_verificar {projeto}` — a regra "parafuso" tem que voltar zerada. Veja também com
  `pcb_render` (o quadrado aparece vazio nas duas camadas).
