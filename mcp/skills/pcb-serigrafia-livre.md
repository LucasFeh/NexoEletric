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

Altura mínima 1,0 mm e traço ≥ 0,15 mm para sair legível.

## Como fazer no NexoEletric (MCP)

- Escreva com `pcb_aplicar` (`text_add` com x,y = CENTRO do texto, `h`, `rot`, `layer:"TopOverlay"`).
- Antes de escolher a posição, olhe o que tem em volta: `pcb_consultar {tipo:"trilhas", caixa:{...}}` e
  `{tipo:"pads"}` na região; prefira colunas sem trilha (ex.: coluna de pino de GND, ponta da fileira).
- **Conferir sempre:** `regras_casa_verificar {projeto}` — a regra "serigrafia" lista cada texto que encosta em
  algo, com o objeto e a posição; mova (`pcb_mudanca_editar` no `text_add`, ou `pcb_editar` no texto do board)
  até zerar. `drc_rodar` cobre silk×pad e silk×silk; o verificador da casa cobre também trilha e furo.
