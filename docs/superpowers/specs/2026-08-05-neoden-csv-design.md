# Interface Neoden 4 (pick-and-place CSV) no hub — design

Data: 2026-08-05 · Branch: code-improve · Status: derivado do pedido do usuário em sessão (execução autorizada em modo contínuo)

## Problema / Objetivo

O usuário hoje gera o CSV da Neoden 4 com o script `Neoden4-Altium` (`py neodenAltium.py "X.csv" -r -o 100 140`), partindo do Pick&Place exportado do Altium. O hub v2 já tem as coordenadas de todos os componentes (board.js) — o CSV intermediário deixa de ser necessário. Nova aba **Neoden** no hub: escolher o **componente de referência** (o "primeiro da lista", que vira o ponto de partida do mapeamento), informar as coordenadas de máquina dele, aplicar opcionalmente rotação e deslocamento pós-N, e baixar o CSV formatado exatamente como a Neoden precisa. A visualização fiel da PCB já existe (aba PCB, com o ponto "0" da placa desenhado na origem) — sem matplotlib.

## Pipeline (paridade exata com o neodenAltium.py)

Ordem de aplicação idêntica ao script original:

1. **Relativo** (`-r`): componente de referência vira (0,0); os demais = posição − posição da referência. No hub a referência é ESCOLHIDA (não a primeira linha do CSV): a lista de saída é reordenada com a referência em primeiro.
2. **Rotação** (`-a ox oy ang`): todos os pontos giram `ang`° anti-horário em torno de `(ox,oy)` — mesma fórmula `rotate` do script. A coluna Rotation dos componentes NÃO muda (paridade).
3. **Offset** (`-o x y`): soma as coordenadas de máquina (posição real da referência na Neoden).
4. **Move pós-N** (`-m dx dy n`): soma `(dx,dy)` a todos os componentes DEPOIS dos `n` primeiros da lista de saída (útil para painel).

## Fonte das coordenadas

`S.detail.board.components` (board.js embutido no `/api/project/<id>.json`): `ref`, `comment`, `footprint`, `layer` (Top/Bottom), `x`, `y`, `rot`, `bbox`. **Mid X/Y = centro do bbox** (`(x1+x2)/2`) quando o bbox existe, senão `x,y` — o bbox de cobre é o análogo disponível do "Center-X/Y" do Pick&Place do Altium; a convenção é ÚNICA para todos os componentes (consistência relativa) e fica documentada na própria aba.

## Formato de saída (byte-compatível com o script)

```
Designator,Footprint,Mid X,Mid Y,Layer,Rotation,Comment
,,,,,,
C4,CAP_0805,88.13mm,61.39mm,T,0,1uF-16V
```

- Cabeçalho + linha `,,,,,,`; X/Y arredondados a 2 casas + sufixo `mm`; coluna Layer literal `T`; Rotation e Comment crus.
- Um arquivo por lado, filtrado por `layer`: `<projeto>-NEODEN-TopLayer.csv` / `-BottomLayer.csv` (nomes do script). Download via Blob (padrão BOM/CSV existente).

## Interface (aba Neoden no hub v2)

- **Referência**: seletor com busca sobre os designators (default: primeiro componente do board). Botão `Ver no PCB` usa o hook `__hubSelectComp` existente (destaca na vista fiel, onde o ponto "0" já é desenhado).
- **Coordenadas de máquina** da referência: campos X/Y (mm) — o offset (`-o`).
- **Rotação** (opcional): ponto `ox,oy` (default 0,0) + ângulo.
- **Move pós-N** (opcional): `dx`, `dy`, `n` (default n=1 = pula a referência).
- **Lado**: Top / Bottom / Ambos (default Ambos, como o script sem `-s`).
- **Prévia**: tabela com as linhas TRANSFORMADAS (Designator, Footprint, Mid X, Mid Y, Layer, Rotation, Comment), atualizada ao vivo — é a conferência numérica; a visual é a aba PCB.
- Botões `Baixar TopLayer` / `Baixar BottomLayer` (ou um `Baixar` por lado conforme seleção).

## Arquitetura

- Transformação e serialização como **funções puras no `hub-core.js`** (`neodenTransform(components, opts)` → linhas; `neodenCsv(rows)` → texto), testadas em node (`tests/test-neoden.js`) com casos de paridade contra a matemática do script (relativo, rotação, offset, move-pós-N, arredondamento, filtro de lado, formato).
- `hub.html` passa a carregar `hub-core.js` (`<script src>`, file://-safe) e ganha a aba/pane Neoden.
- Nenhuma mudança no servidor (os dados já chegam no detail).

## Fora de escopo

Ajustes específicos de máquina além do formato (nozzles, feeders, skip por componente — o próprio README do script diz que isso é feito na UI da Neoden); leitura do CSV antigo; matplotlib; PTH vs SMT (o script original inclui tudo e o operador pula na máquina — mantido).
