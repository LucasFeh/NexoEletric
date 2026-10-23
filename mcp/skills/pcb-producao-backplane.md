---
nome: pcb-producao-backplane
titulo: Produção — backplane de conectores EDGE (técnica da CBM-DI251877)
descricao: Como rotear e fazer os planos de terra de um backplane de 2 camadas com conectores EDGE de 80 pinos em blocos (barramento pino a pino), no padrão da CBM-DI251877 que já foi para produção — campo sem plano em volta das fileiras, GND no Top fora do campo, +5V no Bottom com retângulos de GND entre os conectores, abas, corrente de +5V, leque em escada só com 45°, sem via, parafuso isolado e serigrafia fora do cobre — com os números e a conferência. Use ao fazer ou refazer plano/roteamento de backplane (CBM-DI2518xx e parecidas).
---

# Produção — backplane de conectores EDGE (técnica da CBM-DI251877)

**O que é:** placa de 2 camadas, FR-4, com conectores EDGE de 80 pinos (2 fileiras × 40, passo 2,54 mm, fileiras a
5,08 mm) empilhados em **blocos**: no mesmo bloco o pino *k* de um conector liga no pino *k* de todos os outros
(barramento). A CBM-DI251877 foi feita assim e está em produção; a CBM-DI251876 foi refeita com esta técnica
(DRC 0, nada pendente, 0 curto, nenhuma trilha fora de 0/45/90°, nenhuma via). Siga junto as regras da casa
(`pcb-parafusos-isolados`, `pcb-plano-folga-pads`, `pcb-serigrafia-livre`, `pcb-cobre-sem-curto`) e termine com
`pcb-verificar-antes-de-entregar`.

**Antes de mexer:** `pcb_resumo` e `pcb_consultar` (pads de cada conector: net de cada pino, qual é GND, +5V,
+5VB...), `nets_ratsnest`, e a de referência aberta ao lado (`pcb_render` da CBM-DI251877). Guarde a lista de
índices do changes.js que vai refazer (planos `poly_add`, trilhas de +5V, leque, vias "planos de terra") — sai com
`pcb_mudanca_remover`, entra com `pcb_aplicar` (lotes de até 300 ops; `simular:true` primeiro).

## 1. O campo de cada bloco (onde NÃO tem plano no Top)

- **Campo** = retângulo em volta das fileiras do bloco: x do 1º pino − 3,3 mm até o último pino + 4,3 mm (na 251877
  a borda fica 2–4 mm além dos pads de fora); y da fileira mais baixa − 2,25 mm até a mais alta + 2,25 mm.
- Zonas extras sem plano onde passa leque ou tem latch/header (ex.: CN10 e CN12 da 251876): caixa dos pads + 1,5 mm.
- Dentro do campo o Top só tem barramento; o plano fica fora. **Cada fileira fica numa faixa limpa de 2,25 mm**
  (nenhum plano em volta dos pads — regra da casa: plano a ≥ 1,0 mm de pad de outra net).

## 2. Planos (poly_add)

| Camada | Net | Onde |
|---|---|---|
| Top | GND | placa − campos − zonas extras − quadrados dos parafusos |
| Bottom | +5V | placa − campos − quadrados (e − zona da 2ª fonte, se houver, com 1,5 mm de vão) |
| Bottom | +5VB (2ª fonte) | só no canto da entrada dela (na 251876: canto do CN9 e faixa embaixo do CN6) |
| Bottom | GND | **um retângulo entre cada par de conectores** do bloco: x do 1º pino − 1,9 até o último + 1,9; y da fileira de cima do conector de baixo + 2,25 até a fileira de baixo do de cima − 2,25 (borda a ~1,5–2,1 mm do pad, como na 251877) |

Parâmetros de todo plano: `pour:'solid', pourOver:'all', removeDead:true, removeNecks:true, neck:0.25,
minArea:1.6129, clearance:0.3, clearanceBorda:0.6, clearanceTipo:{th:1.0, smd:1.0}` e alívio térmico
`conexao:{tipo:'relief', condutores:4, largura:0.381, gap:0.3, angulo:45}` (mais os `con_*` iguais).

- `poly_add` tem **um anel só** (sem furo). Plano com buraco (o campo é um buraco no plano): corte na vertical no
  meio de cada buraco e grave os pedaços; em **cada corte ponha 2 pontes** = `fill_add` 1×1 mm da mesma net em cima
  da linha do corte, num lugar com ≥ 2 mm de qualquer cobre de outra net e fora de texto de serigrafia — senão um
  pedaço vira cobre morto e o `removeDead` apaga.
- **Parafuso:** quadrado de furo/2 + 3,05 mm recortado de todos os planos (a regra é 3 mm; os 0,05 cobrem o
  arredondamento — com 3,000 exato o verificador acusa 0,0003 mm de plano dentro do quadrado). Furo de fixação sem
  net do borne (pad ≥ 2,5 mm sem anel) também ganha quadrado. A 251877 usa folga redonda (8,3 mm no furo de 3,4);
  na casa vale o quadrado.

## 3. Abas (fill_add) ligando os pinos aos planos

- **GND da fileira de cima de um conector → retângulo de GND acima** (Bottom): para cada sequência de pinos GND,
  x da sequência ± 0,85, do centro da fileira até a borda do retângulo + 0,6.
- **GND da fileira de baixo do conector de cima → o mesmo retângulo** (Bottom), descendo do mesmo jeito.
- **Pontas da fileira de cima (pinos de GND nas duas pontas) → GND do Top fora do campo:** aba de ±1,21 mm em volta
  da fileira, do pad até a borda do campo + 0,5 (na 251877: 8,51 × 2,41 no bloco esquerdo, 4,95 × 1,78 no direito).
  Se o rótulo da fileira (40A, 1A...) estiver no caminho: o pedaço dos pads para 0,25 mm antes do rótulo e a
  ligação **dá a volta por cima dele** (subida de 1,5 mm de largura + barra de 1,2 mm a 0,25 mm acima do rótulo até
  o plano); onde em cima passa leque, a volta é por baixo (entre as fileiras).
- **Pontas da fileira de baixo com +5V → +5V do Bottom:** aba de ±1,0 mm até a borda do campo + 0,5.
- **Conector do topo do bloco:** GND da fileira de cima sobe no Top até o plano (borda do campo + 0,5), mas **não
  pela coluna que tem número de pino em cima**; pino de GND sozinho embaixo de número: trilha de 0,5 mm que sai do pad
  em 45° para o lado do número (0,12 mm de folga do texto) e sobe reta até 0,6 mm dentro do plano.
- **Conector da base do bloco:** GND da fileira de baixo desce no Top até o plano (borda − 0,6); +5V/+5VB desce no
  Bottom.
- Na 251877 há também faixas verticais de 1,52 mm sobre colunas de GND/alimentação e abas de 1,52 × 3,56 subindo
  para o plano. Não são necessárias (a 251876 fecha todas as nets sem elas). Se usar, no máximo 1,4 mm de largura:
  com 1,52 a folga para os pads vizinhos (passo 2,54, pad 1,52) é 0,98 mm e a regra do plano (≥ 1,0) acusa.

## 4. +5V do meio da fileira (corrente)

Os pinos de +5V no meio da fileira de baixo (na 251876: posições 0, 1, 13, 30, 38, 39) ligam um no outro por trilha
de 0,8 mm que corre **no meio das duas fileiras** e entra em cada pino a 45°: pino → 45° até o meio → reta → 45° até
o próximo pino. Use a camada em que esse canal está livre (na 251877 o Top; na 251876 o Top tem os desvios do
barramento, foi no Bottom). Os pinos das pontas já vão ao plano pelas abas.

## 5. Barramentos e leque — só 0°, 45° e 90°

- Barramento pino a pino em 0,25 mm (0,254), reta vertical; para passar entre os pads de outro conector, desvio a
  45° para o meio do vão (1,27 mm do centro) e volta a 45°. Teardrop nos pads (`teardrop_aplicar`).
- **Nenhum canto de 90°**: todo canto vira dois de 45° (corte de min(1,0 mm, metade de cada trecho) de cada lado).
  Nenhum segmento fora de 0/45/90°.
- **Leque de um conector para latches/headers (CN11 → CN10/CN12 na 251876) em escada:** todas as trilhas de um lado
  seguem o MESMO perfil, deslocado pelo x de saída: chanfro de 45° de 0,4 mm saindo do pad, reta de 1,0, e degraus
  de 45° de 0,6 mm separados por retas de 1,75 mm; no fim, 45° para a vertical e sobe até o pino de destino. Cópias
  deslocadas de ≥ 2,54 mm não se cruzam e guardam folga (degrau × degrau = |1,75 − 2,54|/√2 ≈ 0,56 mm; reta × reta
  = 0,6 mm, menos a largura). Fileira A pelo Top; fileira B pelo Bottom (sai do pad, sobe 1,2 mm, 45° para o canal
  entre os pinos). A 1ª reta fica logo acima do pad (fileira + 0,75 + largura + folga); confira que a mais alta
  cabe antes da fileira do latch (pad − 0,76 − 0,381).
- **Sem via.** Tudo se resolve com as duas camadas e os planos.

## 6. Serigrafia fora do cobre

Texto de overlay não encosta em trilha/fill do mesmo lado (plano pode ficar embaixo). Primeiro ajuste o cobre (abas
que dão a volta, coluna sem subida); se não der, mova o texto pouco: rótulos 40A/40B com h 1,3 a 2,885 mm do pino 40
(saem do quadrado do parafuso do borne); designator do Bottom que cai na aba sobe 0,6 mm; designator/números do
conector do leque vão para o plano ao lado ou abaixo do conector (`designator_move`, texto do changes.js reescrito).

## 7. Conferência (não entregue sem)

1. `pcb_validar` — 0 erro. 2. `drc_rodar` — `aprovado: true` (com o despejo). 3. `nets_ratsnest` — 0 pendente,
0 curto; e a placa não pode depender de cobre despejado no Altium sem polígono no hub (`despejo.altium_sem_poligono`
— o Gerber não leva): confira as nets sem ele. 4. `regras_casa_verificar` — `ok: true`; o que sobrar e vier do
Altium (faixa de polygon pour sem polígono no hub) diga ao dono onde apagar. 5. Nenhum segmento fora de 0/45/90° e
nenhum canto > 45° (fora de pad). 6. `pcb_render` de cada camada com zoom nas pontas das fileiras, no leque, nos
parafusos e no topo/base de cada bloco; `vista_screenshot` com o app aberto. Responda com os números.
