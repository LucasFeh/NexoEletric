---
nome: pcb-serigrafia-livre
titulo: Serigrafia (overlay) sem passar por cima de nada
descricao: Regra da casa — texto e desenho de overlay nunca ficam por cima de pad, via, furo, trilha, fill, outra serigrafia ou da borda da placa; o plano de terra PODE passar por baixo do overlay (não recorte o plano por causa de texto). Use ao escrever textos/legendas na TopOverlay/BottomOverlay, mover designadores, criar plano ou revisar uma placa.
---

# Serigrafia sem passar por cima de nada (regra da casa)

**Por quê:** tinta de serigrafia em cima de pad/via atrapalha a solda; em cima de trilha ou de outra legenda
fica ilegível e confunde a montagem e a manutenção.

## A regra

Nenhum objeto de overlay (texto, designador, linha, arco, contorno de componente) pode encostar em:

1. **Pad e via** (cobre exposto): folga ≥ expansão da máscara + 0,254 mm.
2. **Furo / recorte** (inclusive furo de parafuso e o quadrado isolado em volta dele): folga ≥ 0,254 mm.
3. **Trilha, fill e região de cobre do mesmo lado** (Top para TopOverlay, Bottom para BottomOverlay):
   folga ≥ 0,1 mm — o texto vai na faixa livre entre as trilhas, não em cima delas.
4. **Outra serigrafia** (outro texto, contorno de outro componente): folga ≥ 0,254 mm.
5. **Borda da placa:** ≥ 0,3 mm para dentro.

**O plano de terra pode passar por baixo do overlay** (o dono liberou): texto, designador e legenda podem ficar em
cima do cobre despejado do plano (polígono de GND; o verificador trata igual qualquer plano despejado, como o +5V).
Não recorte o plano em volta do texto e não tire texto de cima do plano por causa disso. A regra continua valendo
para pad, via, furo, trilha e fill: aba de fill que liga um pino ao plano é fill, não plano — o texto não fica em
cima dela (desvie a aba ou mova o texto).

Altura mínima 1,0 mm e traço ≥ 0,15 mm para sair legível. O verificador confere (`texto_tamanho`).

**Exceção por projeto ou por área** (só quando o dono pedir, e diga qual): `regras_casa_definir` grava em
`Projects/<p>/regras-casa.json` os números (`texto_h_min`, `silk_cobre`...), as regras desligadas (inteiras ou
uma parte: `serigrafia_trilha`, `serigrafia_pad`, `texto_tamanho`...) e áreas da placa com regras próprias.
O verificador, o `serigrafia_checar` e o `serigrafia_posicionar` seguem o arquivo; `regras_casa_ler` mostra.

## Como fazer no NexoEletric (MCP)

- Escreva com `pcb_aplicar` (`text_add` com x,y = CENTRO do texto, `h`, `rot`, `layer:"TopOverlay"`).
- **Designadores:** `serigrafia_posicionar {projeto}` acha lugar para os que violam hoje (altura entre
  `altura_min`/`altura_max`, fora do corpo, sem ambiguidade, `modo:"fileira"` para fileiras) — simula por padrão;
  confira com `pcb_render` e grave com `gravar:true`. Os que não acham lugar voltam em `falhas` com o que bloqueou.
- **Lugar candidato:** `serigrafia_checar {projeto, textos:[{ref|id|text+layer, x, y, h?, w?, rot?}]}` diz em
  milissegundos se o lugar viola alguma regra da casa, sem gravar e sem rodar o DRC.
- `designator_move` pelo `pcb_aplicar`: x/y = onde o texto FICA (a resposta traz a posição efetiva e acusa
  `fora_da_placa`); `drc:true` devolve as violações novas e as que saíram.
- Antes de escolher a posição, olhe o que tem em volta: `pcb_consultar {tipo:"trilhas", caixa:{...}}` e
  `{tipo:"pads"}` na região; prefira colunas sem trilha (ex.: coluna de pino de GND, ponta da fileira).
- **Conferir sempre:** `regras_casa_verificar {projeto}` — a regra "serigrafia" lista cada texto que encosta em
  algo, com o objeto e a posição; mova (`pcb_mudanca_editar` no `text_add`, ou `pcb_editar` no texto do board)
  até zerar. `drc_rodar` cobre silk×pad e silk×silk; o verificador da casa cobre também trilha e furo.
