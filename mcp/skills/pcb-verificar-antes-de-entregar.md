---
nome: pcb-verificar-antes-de-entregar
titulo: Conferir a placa antes de dizer que está pronta
descricao: Regra da casa — nenhuma placa é entregue (nem se diz "pronto", "DRC zero" ou "sem curto") sem esta sequência: pcb_validar, drc_rodar com os planos despejados (aprovado), nets_ratsnest (nada pendente, nenhum curto), regras_casa_verificar zerado e o olho em cada camada de cobre com zoom. E quando o dono mandar foto de um problema, achar o objeto, dizer a net e a origem antes de mexer. Use ao terminar qualquer mudança na PCB.
---

# Conferir a placa antes de dizer que está pronta (regra da casa)

**Por quê:** o dono abre a placa no app e vê tudo. "Pronto" com erro no DRC, curto, net solta ou trilha passando por
cima de pad faz ele perder tempo e confiança. A conferência é parte do trabalho, não um extra.

## A sequência (depois de cada lote de mudanças e sempre antes de entregar)

1. `pcb_validar {projeto}` — nenhuma linha do changes.js com erro.
2. `drc_rodar {projeto}` — tem de voltar `aprovado: true`. Ele já redespeja os planos como a tela do app
   (`despejo` na resposta); rodada com `despejar:false` NÃO vale para dizer "DRC zero" (o plano some e o GND aparece
   "não roteado").
3. `nets_ratsnest {projeto}` — `nets_pendentes: 0` e `curtos_total: 0`.
4. `regras_casa_verificar {projeto}` — `ok: true` (cobre de outra net no pad, trilha por cima de pad, parafuso
   isolado, plano afastado dos pads, serigrafia livre). Se sobrar violação que você não pode corrigir (cobre que veio
   do Altium, pedido explícito do dono), diga qual e por quê — não esconda.
5. **Olho em cada camada:** `pcb_render {projeto, camadas:["Top","Multi"], caixa}` e depois `["Bottom","Multi"]`,
   com zoom (caixa de 20–40 mm) nas fileiras de conector, em volta dos furos de fixação e onde você mexeu. Com o app
   aberto, `vista_screenshot` mostra o que o dono está vendo.
6. Só então responda, com os números (DRC, pendentes, curtos, regras da casa) e o que mudou.

## Quando o dono manda uma foto dizendo que algo está errado

1. Ache o lugar: compare a foto com `pcb_render`/`vista_screenshot` (fileira, passo, furos) e confirme com
   `vista_comando {acao:"focar", args:{x, y}}` + `vista_screenshot`.
2. `pcb_consultar` na caixa (pads, trilhas, regioes, vias): id, camada, **net** e origem de cada objeto (id do
   board.js = veio do Altium; `new-...`/op no changes.js = feito no hub).
3. Diga o que é, com a net: curto real (nets diferentes) → corrija e confira de novo; mesma net mas feio/proibido
   pelas regras da casa (faixa tapando o alívio, trilha cruzando o pad) → corrija ou, se veio do Altium e o hub não
   apaga, diga onde mexer; nada errado → mostre a prova (ids, nets, DRC).
4. Não mexa no que o dono não pediu. Mudança grande ou que apaga coisa do Altium: pergunte antes.
