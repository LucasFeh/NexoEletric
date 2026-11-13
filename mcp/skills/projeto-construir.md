---
nome: projeto-construir
titulo: Construir uma placa inteira — esquema, footprints com 3D de verdade, PCB roteada, simulação, firmware e bancada
descricao: Processo da casa para montar um projeto do começo ao fim pela IA (como o DEMO-MOTOR-ESP32), do esquema à placa com DRC aprovado, passando pela simulação, o firmware do NexoCode e a Bancada. Inclui a regra do 3D: todo componente da placa tem o modelo 3D de verdade, nunca um cubo genérico nem nada. Use sempre que o usuário pedir para fazer, montar, desenhar ou construir uma placa, PCB ou esquema, ou para trocar um componente da placa.
---

# Construir uma placa (do esquema à bancada)

Este é o caminho que fez o **DEMO-MOTOR-ESP32**: ESP32 que gira um motor por PWM num MOSFET, com LED, botão e
potenciômetro, a placa de 72 × 52 mm roteada com DRC aprovado, o firmware no NexoCode e o motor girando na Bancada.
Projeto novo, com código no catálogo: comece pela skill `projeto-novo`. Esta skill continua dali.

## A regra do 3D: nada de cubo, nada sem 3D

**Todo componente da placa tem o modelo 3D de verdade.** Pode ser o STEP do fabricante, um da biblioteca ou um
modelado no NexoCAD.

- **Nunca** ponha corpo genérico no footprint para "ter alguma coisa" no 3D: nada de `extruded`, `cylinder` ou `sphere`
  fazendo papel de caixa. O "cubo verde" no lugar do borne foi recusado pelo dono.
- **Nunca** deixe o componente sem 3D.
- Na hora de escolher o footprint, prefira um que **já tem STEP** e sirva na peça. Exemplo: o borne de 2 vias da
  biblioteca, `CONE MSTBV 5.08/2P GF`, no lugar de um footprint sem 3D. Para achar, use
  `fp_buscar {busca, so_com_3d: true}`.

Para cada footprint usado, nesta ordem:

1. **Já tem STEP?** Rode `fp_ler {nome}` e procure um corpo `kind:"step"`. Se tiver, está feito.
2. **A biblioteca tem o modelo?**
   - `fp_modelos3d`: os STEP embutidos e os subidos. Ache o da peça e prenda com `fp_corpo3d`.
   - `nexo_biblioteca`: os itens da rede (modelo3d e componentes do NexoCAD). Ache o da peça e prenda com
     `fp_3d_nexo {footprint, item}`.
3. **Pegue na internet.** Use o IntegrateBrowser para achar o STEP do fabricante: a página do produto, ou
   SnapEDA/Ultra Librarian/3D ContentCentral pelo MPN.
   - Baixe e prenda com `fp_3d_importar {arquivo, footprint}`. Ele guarda o STEP na biblioteca 3D do hub, que sobe
     para o NexoBD.
   - Confira se o modelo é o do MPN certo e se o pinout bate com os pads.
4. **Não achou? Construa no NexoCAD.**
   - Abra com `nexo_editar_modelo {footprint, novo: true}`. Ele cria o item vinculado ao footprint e manda os pads
     como esboço de referência.
   - Modele pelas medidas do datasheet: corpo, terminais e furos nos pads.
   - Salve (Ctrl+S ou pelo MCP do NexoCAD). O hub troca o modelo sozinho.
5. **Confira deitado e no lugar.**
   - Olhe na vista 3D com `vista_screenshot` (vista PCB, tecla 3) ou nas fotos de `pcb_render_3d`. Se `falhas` vier
     com algum componente, ele está sem modelo carregado.
   - Os terminais têm de entrar nos furos e o corpo tem de assentar na placa.
   - Para ajustar rotação e altura, passe `rotx`/`roty`/`rotz`, `x`, `y`, `dz` em `fp_corpo3d`.

Achou corpo genérico num footprint que vai para a placa? Troque pelo modelo de verdade (passos 2 a 4) com
`substituir_corpos: true`. **Só entregue a placa com todos os componentes em 3D real.** Se algum não tiver jeito (sem
datasheet com medidas), diga ao usuário qual é e o que faltou. Não esconda com um cubo.

## 1. O esquema

- **As peças:**
  - Busque cada uma no almoxarifado: `almox_buscar` / `sch_buscar_simbolo`.
  - Peça que não existe vai pela skill `componente-novo`.
  - O footprint de cada uma segue a regra do 3D acima.
- **Coloque e ligue:** `sch_adicionar {projeto, itens}`, com `comp`, `x`, `y` e os fios pelos pinos.
  - Dê nomes às nets: alimentação pelo nome (`+5V`, `+3V3`, `GND`), que o simulador entende sozinho, e sinais pelo
    que fazem (`PWM_MOTOR`, `BOTAO`, `POT`).
  - Use a folha do projeto (`ESQUEMA_1`...), nunca uma folha solta.
- **Pinos que não batem com os pads:** passe `pinoPad` no params. O MOSFET SOT-23 é `1=1;2=3;3=2`, o diodo é
  `1=2;2=1` e o capacitor A/B é `A=1;B=2`. Confira cada um com o datasheet.
- **Valide:** `sch_validar` e `sch_nets`, e zere o que eles apontarem.

## 2. A placa

- **Leve o esquema para a placa:** `eco_comparar` → `eco_aplicar`.
- **Posicione** com `pcb_mover_lote`:
  - conectores na borda e com a abertura para fora;
  - o desacoplamento colado no pino de alimentação;
  - o regulador perto da entrada;
  - a antena do ESP32 fora do cobre;
  - e as skills `pcb-boas-praticas`, `pcb-parafusos-isolados` e `pcb-plano-folga-pads`.
- **Roteie** com `pcb_autorotear {nets, gravar: true}`, começando pelas nets de potência, e confira depois com
  `nets_ratsnest`: `ligacoes_faltando` tem de dar 0.
- **Trocou ou moveu um componente já roteado?** Não arraste as trilhas junto: isso cria curto entre as nets. Apague as
  trilhas e vias das nets dele (`pcb_apagar`) e roteie essas nets de novo.
- **Confira:** `drc_rodar` (aprovado, 0 violações) e `regras_casa_verificar` (zerado).

## 3. A simulação (aba Simulador)

- `sim_rodar {projeto}` em DC e depois `modo: "tempo"`. Leia os alertas (potência acima da nominal, regulador em
  dropout, LED sem corrente) e corrija o esquema.
- `sim_testar {entradas: {"J1-1": 5}, verificar: [...]}`: aplique a tensão nas entradas da placa e confira as saídas
  contra o esperado.
- `sim_trilhas`: a corrente e o aquecimento de cada trilha. Engorde as que passarem do limite.
- **Recolher informações:** `sim_datasheet_pendentes` → ache o datasheet → `sim_datasheet_gravar`. A pinagem fica
  salva no componente para todos os projetos.

## 4. O firmware (NexoCode) e a bancada

- **Firmware:** faça o firmware no NexoCode, na pasta `Documents/NexoCode/<projeto>`, com os GPIO pelos números do
  esquema.
  - O "Sincronizar com o esquema" manda os pinos por `gpio_lote`.
  - O botão e o potenciômetro da tela do NexoCode acionam a chave e o pot do esquema.
- **Bancada** (o 3D da aba Simulador: a placa sobre a mesa; as peças do NexoCode também ficam nela): `sim_bancada`.
  - Ponha os itens da biblioteca com `atributos.bancada` (motor, fonte, hélice) e ligue os fios dos pads da placa aos
    terminais deles.
  - Esses itens também são 3D de verdade, feitos no NexoCAD e salvos na biblioteca (categoria Bancada).
  - Item novo na bancada segue a mesma regra: modele no NexoCAD ou baixe, nunca um cubo.

## Antes de dizer que está pronto

- `sch_validar` limpo; `nets_ratsnest` com 0 ligações faltando; `drc_rodar` aprovado; `regras_casa_verificar` zerado.
- **Todos os componentes com 3D real**, conferido na vista 3D, sem cubo e sem falta.
- A simulação sem alerta (ou com o motivo explicado ao usuário).
- Diga o que ficou feito, o que dependeu de decisão e qual peça precisou de modelo novo no NexoCAD.
