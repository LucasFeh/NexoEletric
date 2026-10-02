# Migrar a criação de PCB do Altium para o hub — o que falta

Levantamento de 2026-10-02, a pedido do dono: "veja o que tá faltando pra deixar a criação de PCB
idêntica ao do Altium, pra ficar fácil a migração para o nosso sistema; exportação de gerber, pdf,
layout são as únicas coisas que a gente usa".

Tudo aqui foi medido. As placas do acervo foram lidas direto do arquivo, em modo só leitura (X:/Y:
não foram tocados):

- **444 `.PcbDoc` de 111 projetos**, da lista `D:\Pessoal\varredura de projetos`;
- **71.412 arquivos de saída**: Gerber, `.rar`/`.zip` da FABRICAÇÃO, OutJobs, `.PrjPcb` e PDFs `LO -`.

Quando um número é **por projeto**, ele conta o PcbDoc mais recente de cada um (111). Quando é **por
arquivo**, conta todos.

## 1. Em uma tela

1. **O Gerber já sai do hub.** É o mesmo conjunto do Altium 21.5.1, em X2 mm 4:5, empacotado como na
   pasta FABRICAÇÃO.
   - **Conferência:** no DMB, contra o X2 do Altium da mesma revisão da placa. Deu XOR zero em
     10 das 13 camadas: pads, trilhas, vias, furos, máscara, pasta, contorno e fills batem. Os
     textos TrueType ficam a 97% (IoU). Sobram duas diferenças:
     - o Altium funde regiões de cobre sobrepostas (0,01 mm² no cobre de cima);
     - a fonte stroke do hub não é a do Altium (os textos stroke das duas legendas).
   - **A condição:** o espelho da placa tem de ser completo. Ele sai do **ExportBoard novo** (ainda
     não rodou no Altium) ou do **`pcbdoc2board.py`**, que lê o `.PcbDoc` direto.
2. **O layout (editor) ficou no padrão do Altium.** Tem barra no topo, painel Properties à direita,
   abas de camada, W, Ctrl+2, troca de camada pelo painel, as formas na camada atual e seleção como
   no Altium.
   - **O que falta para fazer placa do zero sem o Altium:** DRC, linhas de conexão, polygon pour,
     teardrops e colocar componente a partir do esquema.
3. **O PDF de layout ainda não sai do hub.** É a peça que falta entre as três saídas. O formato está
   levantado (seção 4) e não depende de nada novo no espelho.

## 2. O que o acervo usa (e portanto o hub precisa ter)

| recurso | projetos | situação no hub |
|---|---|---|
| placa de 2 camadas | 104 de 111 | ok |
| 4 camadas com roteamento interno (APR, IT, MIF, PCVD, PRR, TT) | 7 | ok: Mid na tela e no Gerber (`_Copper_Signal_L<n>`) |
| plano interno, via cega/enterrada, par diferencial | 0 | não precisa |
| trilha, via, pad SMD/PTH, componente no Bottom (49%) | ~100% | ok |
| silk: linha, arco, texto, texto espelhado (71%), multilinha (67%) | ~100% | ok |
| **fill no silk** (o QR code da casa, os logos) | 78 (70%) | ok com espelho novo; o antigo não traz |
| **board cutout** (o furo de fixação da casa) | 74 (67%) | ok, inclusive a ferramenta Furo |
| **teardrop** | 52 (47%) | desenhado e no Gerber; **o hub não refaz** (seção 5) |
| desenho solto em camada mecânica (na Mech1: contorno, cotas à mão) | 106 (96%) | ok com espelho novo |
| texto TrueType (rótulos de pino do ESP32, quase sempre em footprint) | 37 (33%) | ok com espelho novo: contorno exato |
| pad com máscara/pasta manual | 32 / 44 | ok com espelho novo (`sm`/`pm` por pad) |
| polygon pour (sólido, quase sempre GND) | 20 (18%) | **despejo do Altium aparece; o hub não despeja** |
| Keep-Out: linha na camada / objeto com flag keepout | 11 (10%) / 26 (23%) | camada e flag existem; regra de keepout não |
| regra de largura por net (`InNet('0V')`…) | 22 (20%) | **não há regras no hub** |
| corpo 3D / STEP | 100 (90%) | não vem; só serve à vista realista do PDF |

**Saídas que a casa usa de fato:**

- **Gerber.** X2 do menu *File » Fabrication Outputs*, desde 2023; o RS-274X com Excellon é anterior.
  O que vai para a JLCPCB é a reexportação do CAMtastic: nomes em minúsculas, sem camada vazia.
  - 91 dos 95 últimos pacotes são assim.
  - Pelo `.PrjPcb`, o conjunto de 10 camadas da referência é o de 48 projetos.
- **PDF de layout.** São 399 `LO -` em 100 projetos, A4 paisagem, saídos do Draftsman.
- **O resto quase não aparece.** Pick & Place em 3 projetos, ODB++ em 1, IPC-2581 em 1. A BOM é
  planilha, fora do Altium.

## 3. O que ficou pronto nesta etapa

### Layout (vista PCB)

- **Barra de ferramentas no topo:**
  - Trilha (W), roteamento interativo:
    - 45°/90°/livre com Shift+Espaço; Espaço inverte o canto; Backspace desfaz o último trecho;
    - via no meio: `2` sem trocar de camada; `*` ou Ctrl+2 troca de camada;
    - herda a net e termina sozinha num ponto elétrico.
  - Via (Ctrl+2).
  - Linha, Arco, Círculo, Retângulo, Triângulo, Polígono e Texto, todos na camada atual.
  - Preencher: retângulo vira fill; o resto, região.
  - Furo de fixação, Contorno, Medir, Sinalizar e Gerber.
- **Painel à direita**, como o Properties: Placa (Board Information, filtro de seleção, grade de
  5 mil, unidade mm/mil), ficha do objeto com a **Camada no primeiro campo**, Camadas, Componentes
  (a PCB List) e Mudanças.
- **Abas de camada embaixo**: as 74 camadas do Altium, na cor que o próprio Altium grava nos Gerbers
  da casa (medida em 1.013 arquivos).
- **Seleção e movimento como no Altium:**
  - clique, Shift+clique, janela (esquerda→direita pega o que está dentro, direita→esquerda o que
    toca), Ctrl+A;
  - arrastar com Espaço (girar), L (trocar de face) e X/Y (espelhar);
  - ponta de trilha arrastável; desfazer/refazer.
- **Atalhos** editáveis nas Configurações do hub (tabela própria da vista PCB).
- **Uma vista só na web e no desktop**, no tema do hub.

### Gerber

- Gerado da **placa com as mudanças**, inclusive as não salvas. O motor é o mesmo da tela.
- Visualizador com:
  - camadas na cor do Altium;
  - vista de baixo;
  - modo realista;
  - **Comparar com…** outro conjunto (arraste os `.gbr` ou o `.zip` da FABRICAÇÃO).
- **Baixar .zip** e **Salvar no projeto** (`Projects/<nome>/Gerber/`), além de reabrir o salvo.
- Sub-aba **PCB › Gerber** no hub.

### Espelho e importação

- **ExportBoard.pas:** traz fills, todas as camadas, linhas mecânicas, máscara e pasta por pad,
  tenting, `plated`, furos das regiões, contorno exato dos textos e regras.
  - Os ids de hoje não mudam.
  - Toda leitura nova fica numa sonda: se o Altium recusar uma propriedade, cai só aquele campo.
- **ApplyChanges.pas:**
  - trilha e arco em qualquer camada;
  - texto novo, apagado ou trocado de camada;
  - fill e região (inclusive Board Cutout).
- **`tools/pcbdoc/pcbdoc2board.py`:** lê o `.PcbDoc` sem o Altium e grava o `board.js` completo.
  - Foi validado contra o painel do Altium no DMB (100%).
  - É a porta de entrada da migração: qualquer placa do acervo vira projeto do hub sem abrir o Altium.

## 4. O que falta, por saída

Esforço: **P** até 1 dia; **M** de 2 a 5 dias; **G** mais de uma semana.

### 4.1 Gerber

| # | falta | por quê | esf. |
|---|---|---|---|
| G1 | **Rodar o ExportBoard novo no Altium** e conferir as sondas (seção 6) | sem ele, o espelho antigo não traz fills, máscara por pad, `plated` nem furos de região; o Gerber avisa alto | P |
| G2 | **Fonte stroke do Altium** | os 34 textos stroke do DMB saem na altura e no lugar certos, mas com outro desenho de letra (e a palavra até 13% mais curta). O contorno exato que o ExportBoard novo tenta trazer (`texts[].polys`) resolve onde a sonda pegar; senão, levantar a tabela de glifos do Altium nos Gerbers do acervo | M |
| G3 | **Polygon pour** | o hub mostra o despejo que veio do Altium, mas não redespeja. Mover trilha ou via perto de um polígono deixa o cobre antigo no lugar, e o Gerber sai em curto. Até o pour existir, quem mexe numa placa com polígono redespeja no Altium | G |
| G4 | **Refazer teardrops** | 47% dos projetos. Mover a trilha ou a via deixa o teardrop velho para trás | M |
| G5 | Excellon e RS-274X (o formato antigo) | só se a fábrica pedir: 0 de 143 pacotes X2 levam Excellon | P |
| G6 | Fundir regiões sobrepostas como o Altium | cosmético (0,01 mm² no DMB): a fábrica recebe a mesma placa | M |

### 4.2 PDF de layout

**Não existe ainda: o botão aparece travado.** O formato medido nos 284 `LO -` com texto e numa
amostra de 12:

- **A4 paisagem, 1 a 3 folhas.**
- **Vistas de montagem de cima e de baixo:** contorno, serigrafia, corpo do componente e designators,
  em escala livre (1:1, 3:2, 2:1, 1,27…).
- **Página "Realistic View" opcional:** render de cima e de baixo, em 31 PDFs.
- **Quadros "OBS:" opcionais.**
- **Carimbo novo da DIEletrons** (273 de 284): logo, ARQUIVO, R., FL., DESEN., VERIF., APROV. (com
  datas), EQUIPAMENTO, DESENHO, ESCALA e FORMATO.
- **Não aparece em nenhum:** tabela de furos, layer stack, BOM ou cotas.

| # | falta | esf. |
|---|---|---|
| P1 | Gerador de PDF vetorial no hub: as duas vistas de montagem a partir da placa efetiva (o mesmo motor do Gerber), escala escolhida e carimbo com os campos preenchidos pelo projeto | M |
| P2 | Página "Realistic View": o modo realista do visualizador de Gerber já desenha máscara, cobre exposto e serigrafia; falta compor no PDF | P (depois de P1) |
| P3 | Corpo 3D na vista realista (90% dos projetos têm STEP) | G — e só se a vista 2D realista não bastar |

### 4.3 Layout (o editor)

| # | falta | por quê | esf. |
|---|---|---|---|
| L1 | **Regras + DRC**: clearance, largura com escopo por net, furo, furo-a-furo, ponte de máscara e silk sobre a máscara | sem DRC, largar o Altium é mandar a placa para a JLC sem verificação. O que a casa personaliza é largura por net (22 projetos); o resto é o padrão do Altium (clearance de 10 mil em 95 de 111) | G |
| L2 | **Linhas de conexão (ratsnest)** e realçar net | não se roteia do zero sem ver o que falta ligar | M |
| L3 | **Colocar componente** do `schematic.js` com o footprint do `Libs/pcblib.js` (o ECO) | sem isso, placa nova não nasce no hub: hoje ela nasce no Altium e vem pelo espelho | G |
| L4 | **`board.js` como documento mestre** | hoje o `changes.js` é um diff sobre o espelho, amarrado por `orig_*`. Placa que nasce no hub não tem espelho de origem. Na migração total, o hub grava o próprio `board.js`, e o `changes.js` fica só para a ida e volta com o Altium enquanto ele existir | M |
| L5 | Arrastar trilha **mantendo a ligação** (o Drag do Altium) | hoje a trilha inteira se move sozinha; só a ponta arrastada leva a ligação junto | M |
| L6 | Pad avulso / furo NPTH (`pad_add`) | botão travado; 53% das placas têm pad solto | M |
| L7 | Posição do comment (`comment_move`) | o designator já se move; o comment, não | P |
| L8 | Copiar, colar, duplicar, alinhar | conforto | M |
| L9 | Cantos com arco no roteamento, push/walkaround | raro em placa de 2 camadas da casa | G |
| L10 | Contorno com arcos editável (`outline_set` só aceita retas) | 29% dos projetos têm contorno com arco; hoje ele é desenhado mas só se edita no Altium | M |

## 5. Ordem sugerida

1. **G1:** rodar o ExportBoard novo uma vez num projeto e ler o diálogo (seção 6). Sem isso, nada
   do resto pode ser conferido no Altium.
2. **P1 + P2:** o PDF de layout. É a única das três saídas que ainda não existe, e não depende de
   regra nem de motor novo.
3. **L1 + L2:** DRC e ratsnest. É o que separa "ajustar uma placa do Altium" de "fazer a placa no
   hub".
4. **G3 + G4:** polygon pour e teardrops.
5. **L3 + L4:** placa nova sem o Altium.

## 6. O que ainda não foi conferido dentro do Altium

O Altium roda noutra máquina; daqui não dá para executar os `.pas`. Por isso eles foram escritos com
uma separação:

- **Sondas** (`ExportBoard.pas`, bloco `SONDAS`): leituras novas protegidas. Se o Altium recusar
  uma propriedade, cai só aquele campo e o relatório diz qual.
- **Apostas** (`ApplyChanges.pas`, bloco `APOSTAS`): nomes de API que podem nem compilar. Exemplos:
  `SetOutlineContour`, `X1Location`, `UseTTFonts`.
  - No DelphiScript, nome desconhecido é **erro de compilação**: o `try/except` não salva.
  - O bloco lista cada um e o que trocar se o Altium reclamar.
- **Primeira rodada:** rodar o ExportBoard num projeto pequeno e ler o `export-report.txt`; depois
  um ApplyChanges com uma mudança de cada tipo novo.
- **Ctrl+2:** no Chrome a tecla chega à página (medido). No EletricHUB, o menu do app não usa
  Ctrl+2 (conferido no `electron/main.js`), então ela chega do mesmo jeito; falta só apertá-la no
  app instalado.
