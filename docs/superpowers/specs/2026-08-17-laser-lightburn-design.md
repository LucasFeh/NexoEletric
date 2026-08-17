# Aba Laser — arte vetorial da PCB para o LightBurn — design

Data: 2026-08-17 · Branch: main · Status: aprovado em sessão

## Problema

O `board.js` já tem toda a geometria da placa em mm, mas não há como levar isso para
a bancada. Para gravar uma PCB a laser (tinta + ablação, ou fotolito), falta um arquivo
vetorial 1:1 que o LightBurn importe com as camadas certas — escolhendo o lado, o que
entra na arte, e espelhando quando for o bottom.

## O fato do LightBurn que determina o design

A doc do LightBurn (*Fill Mode*) diz, sobre formas na **mesma** camada de preenchimento:

> When shapes only partially overlap and are assigned to the same Fill Mode layer,
> the area where they overlap will **not be engraved**.

É regra par-ímpar na camada inteira, e nenhuma das três sub-opções (*Fill All Shapes at
Once* / *Fill Groups Together* / *Fill Shapes Individually*) muda isso — elas só mudam a
ordem do percurso.

Consequência: **emitir as primitivas cruas não funciona.** Toda trilha que encosta num pad
deixaria um buraco não gravado exatamente na junção — e isso vale para o positivo, não só
para o negativo. O cobre precisa sair do gerador **já unido** numa geometria só.

O LightBurn tem o *Weld* para isso, mas em ~2000 formas é lento, instável e vira passo
manual em toda exportação. A união é responsabilidade do gerador.

## Abordagem: rasterizar e traçar o contorno

Descartadas:

- **união exata com biblioteca vendorizada** (`polygon-clipping`, MIT ~40 KB) — traria a
  primeira dependência de terceiros do projeto, e libs de boolean sofrem justamente com o
  caso que temos aos montes: centenas de retângulos colineares e tangentes;
- **emitir cru e weldar no LightBurn** — passo manual, instável na escala da placa.

Escolhida: rasterizar as primitivas num bitmap de cobertura e traçar o contorno com
marching squares. Motivos:

1. **o negativo é o mesmo bitmap invertido** — positivo e negativo compartilham o código
   inteiro, em vez de dois caminhos geométricos;
2. **a expansão de compensação** (kerf do laser + sobre-corrosão do percloreto) sai como
   offset exato — ver a nota abaixo;
3. **o recorte pelo contorno real da placa** sai de graça, mesmo em placa chanfrada
   (a TCMS_Reader é);
4. zero dependências, coerente com o resto do projeto, e testável no node sem canvas.

Custo: a precisão é a resolução do raster. A 25 µm/px (padrão) uma placa de 70×70 mm dá
2800² ≈ 8 Mpx. E 25 µm é uma ordem de grandeza **abaixo** do spot do laser (~80 µm) e da
sobre-corrosão lateral, então não é o elo fraco da cadeia.

## Camadas

Cores da paleta do LightBurn — o import só casa cor→camada se o valor for exato.

| Camada | Cor | Grupo | Modo |
|---|---|---|---|
| **C00** | `#000000` | arte de cobre | Fill |
| **C01** | `#0000FF` | serigrafia | Line (ou Fill) |
| **C02** | `#FF0000` | contorno da placa | Line |

Um conjunto **fixo** de camadas não serve. Gravar PCB pede preenchimento, limpeza, furação
e corte, e o número de passadas de limpeza é preferência de bancada, não propriedade da
placa. Então a arte expõe **fontes de geometria** e o usuário monta a lista:

| `src` | geometria | modo |
|---|---|---|
| `fill` | a área a gravar (no negativo, tudo que não é cobre) | Fill |
| `copperEdge` | contorno de cada ilha de cobre | Line |
| `drills` | círculo no diâmetro real da broca, por furo | Line |
| `silk` | serigrafia | Line/Fill |
| `board` | contorno da placa | Line |

Uma camada é `{ src, ci, name }`. **A mesma `src` pode aparecer em várias camadas** — é
assim que se pedem duas passadas de limpeza com parâmetros diferentes.

`freeCi(layers)` escolhe o índice ao somar ou duplicar: duas linhas no mesmo `Cxx` **se
fundem numa camada só** no LightBurn, o que anula justamente o motivo de duplicar. O índice
tem que ser o primeiro livre, e não o seguinte.

`copperEdge` segue o **cobre** nos dois modos, não o preenchimento: no negativo o `fill`
inverte, mas a borda que a limpeza precisa tratar continua sendo a do traço. Por isso `art()`
traça o cobre recortado **antes** de inverter, e só inverte o bitmap depois.

`drills` é independente da opção `holes`: subtrair o furo da máscara e ter uma camada para
furar são coisas ortogonais — dá para querer o pad cheio na máscara e ainda assim a furação.
Furo circular sai como `<circle>`, não poligonizado: é menor e o LightBurn importa como
elipse de verdade. A cor vai em **cada elemento**, nunca num grupo em volta — atributo
herdado de grupo é ponto fraco de importador, e a cor é o que define a camada.

### Configuração de corte embutida

SVG **não** carrega velocidade/potência/modo: o LightBurn casa cor→camada e aplica o que já
estiver na biblioteca dele. Para o arquivo vir configurado é preciso o formato nativo
`.lbrn`, XML que guarda `<CutSetting>` por `CutIndex`, com
`<Shape Type="Path" CutIndex="n">` + `<V vx vy/>` + `<P T="L" p0 p1/>`; o `.lbrn2` é o mesmo
com a forma condensada. Fica para quando os parâmetros de bancada estiverem definidos — a
lista de camadas já é onde eles vão pendurar.

## Fonte dos dados: `board.js` cru

Igual à aba Neoden (`S.detail.board`). O `changes.js` **não** entra: o payload do servidor
(`build_detail`) nem o carrega, e a arte tem que ser a placa que o Altium tem de verdade.
Havendo mudanças pendentes, a barra avisa em amarelo — *"N mudanças pendentes; a arte não
as inclui"*.

## Conversão board.js → primitivas

| `board.js` | entra quando | primitiva |
|---|---|---|
| `tracks[]` | `layer === lado` | cápsula (segmento de largura `w`, pontas redondas) |
| `arcs[]` | `layer === lado` | cadeia de cápsulas (arco achatado a 10 µm) |
| `regions[]` | `layer === lado` | polígono de `points` |

Trilhas, arcos e regiões ficam **sob o mesmo toggle** (`show.tracks`): é tudo cobre roteado,
e separar o plano do traço que chega nele nunca ajuda na hora de gravar.

### O sentido do polígono não pode importar

O rasterizador combina tudo numa lista de arestas só, com regra **nonzero**. Isso só é união
se todos os polígonos girarem no mesmo sentido — e o `board.js` traz **1170 das 1232 regiões
do repo no sentido horário**, enquanto cápsula, disco e retângulo que o gerador constrói são
anti-horários. Horário (−1) sobre anti-horário (+1) soma zero: abre um buraco branco
exatamente na junção da trilha com o pad, no formato de cunha.

Por isso `rasterPolys` **normaliza o sentido** (inverte quem tem área com sinal negativa)
antes de montar as arestas. A alternativa — regra par-ímpar — não serve: ela cancela
qualquer sobreposição, que é justamente o que se quer unir.

O exportador usa `RegionPrim.GetMainContour()`, então região é sempre contorno cheio, sem
recorte: preencher todas é o correto.
| `components[].pads[]` | `layer === lado` **ou** `layer === 'Multi'` | por `shape` (abaixo) |
| `freepads[]` | idem | idem |
| `vias[]` | sempre (atravessam) | disco de raio `size/2` |
| `silk[]` | `layer === lado+'Overlay'` | `line` → cápsula · `arc` → cadeia de cápsulas |
| `texts[]` | `layer === lado+'Overlay'` | polilinhas da fonte vetorial |
| `board.outline[]` | sempre | `line` e `arc` → polilinhas encadeadas em laços → camada C02, **nunca** entra no cobre |

**O contorno tem arco, e isso foi descoberto no dado real.** Duas placas do repo
(`SD - DI251838`, `VDCB - DI251879`) têm o contorno com cantos em `kind:'arc'` — a segunda é
só de arcos. Aceitar apenas `line` fazia o laço não fechar, e o negativo dessas placas
queimaria um retângulo no lugar da placa. O encadeamento trabalha com polilinhas, não com
segmentos de dois pontos, justamente para o arco achatado entrar junto.

`Multi` é o que faz o pad PTH aparecer nos dois lados — mesmo critério que a aba Neoden
usa para classificar SMD/PTH.

Formas de pad: `circle` → disco · `rect` → retângulo rotacionado · `roundrect` → retângulo
com raio (`p.radius`, senão `min(w,h)/4`) · `oval` → raio `min(w,h)/2` · `octagon` →
polígono de 8 lados. Forma desconhecida cai em retângulo e emite aviso.

Em `texts[]`, `designator:true` é substituído pelo `ref` do dono e `comment:true` pelo
`comment` do dono, como o `pcbframe.js` já faz no canvas.

## Furos

Select na UI, três valores, aplicados como **subtração** do bitmap de cobre:

| valor | o que subtrai |
|---|---|
| `mark` (padrão) | disco de `markD` (padrão 0,3 mm) no centro do pad/via |
| `none` | nada — pad sólido |
| `drill` | o furo real, **na forma do `board.js`** |

**O furo real segue as regras do `pcbframe.drawPad`, não um círculo sempre.** Um pad tem
`drillshape` (`circle`/`rect`/`oblong`), `drillw` e `holerot`; `rect` e `oblong` são furos de
`drillw × drill` girados por `holerot`, e sem `holerot` o furo herda a rotação do pad. E o
furo só existe em pad *through-hole* (`type === 'th'` ou camada `Multi`) — SMD nunca é furado.
Tratar tudo como círculo errava 27% da área naqueles furos: a `VDCB - DI251879` tem dois pads
`rect` 1,5×1,5 com `holerot:90` (2,250 mm² reais contra 1,767 mm² de um círculo ø1,5).
A marca de centro continua sendo sempre um disco — é marca de broca, não a forma do furo.

A marca de centro vira uma covinha de cobre que centra a broca sem comer o anel. No
negativo ela é gravada junto do fundo — a inversão do bitmap resolve sozinha, sem caso
especial.

## Pipeline

```
board.js + opts
  │
  │ collect()     filtra lado e toggles; converte em primitivas; substitui designator/comment
  ├──────────►    { copper[], holes[], silk[], outline[], bbox }
  │
  │ rasterize()   scanline próprio (sem canvas), cobertura 0..255 a `res` mm/px
  ├──────────►    copper = união(copper) MENOS união(holes), depois dilate(expand)
  │
  │ clip/invert   máscara do contorno rasterizada;  negativo = máscara AND NOT copper
  ├──────────►    um caminho só para positivo e negativo
  │
  │ contours()    marching squares interpolado no nível 0,5 (sub-pixel)
  ├──────────►    anéis fechados; externo CCW, buraco CW (área com sinal)
  │
  │ simplify()    Douglas-Peucker, tolerância res/2
  │
  └ svg()         espelho em X e flip de Y aplicados uma vez só, aqui
                  width/height em mm + viewBox 1:1
```

**A expansão não usa morfologia.** Dilatar o bitmap com kernel circular seria O(W·H·kernel);
inflar as primitivas antes de rasterizar dá o **mesmo** resultado de graça, porque para cada
uma delas o offset é exato: cápsula e disco crescem o raio; retângulo de canto vivo vira
retângulo de canto redondo de raio `e` (que é exatamente a soma de Minkowski com o disco);
polígono usa `offset(P) = P ∪ (∂P ⊕ disco)`, que é a identidade correspondente. O furo é uma
ilha *sem* cobre, então recebe `-e`: se a máscara cresce `e`, a ilha encolhe `e`.

O `viewBox` 1:1 com `width`/`height` em **mm** é o que mata o problema conhecido de
72 vs 96 DPI no import de SVG do LightBurn: com unidade física declarada não há
ambiguidade a resolver.

O espelho ser aplicado só na emissão (e não nas primitivas) mantém uma única
transformação, em vez de espalhar sinal trocado por cinco conversores.

## Opções

```js
{ side:'Top'|'Bottom', invert:false, mirror:false,
  show:{ tracks, pads, vias, silk, texts, outline },   // tracks = trilhas + arcos + regiões
  holes:'mark'|'none'|'drill', markD:0.3,
  expand:0,     // bloat de compensação, mm
  res:0.025,    // mm/px
  margin:2,     // mm ao redor do contorno
  silkMode:'line'|'fill' }
```

`mirror` é auto-marcado ao escolher `Bottom`, e continua editável — a máquina de alguém
pode gravar por baixo do vidro.

Sem `board.outline`, cai para o bbox e emite aviso. Placa grande demais para o teto de
memória faz o gerador **ceder resolução** e dizer que cedeu, em vez de estourar (a
`MID - DI261897`, de 247×108 mm, cai de 0,025 para 0,0265 mm/px).

## Combinações válidas mas fisicamente erradas

`checkOpts(opts)` olha as **opções**, não a geometria que saiu, porque o caso perigoso
produz geometria perfeita: **negativo sem nenhum grupo de cobre marcado** vira um retângulo
cheio, e o laser queimaria a placa inteira. A aba mostra o aviso e bloqueia o download.
Mora no `hub-laser.js`, e não na aba, para ficar sob teste.

## Arquivos

| arquivo | o quê |
|---|---|
| `hub-font.js` (novo) | UMD `HubFont`: `FONTDATA` + `textPolylines(txt,h)` puro, extraídos do `pcbframe.js` |
| `hub-laser.js` (novo) | UMD `HubLaser`: todo o pipeline, sem DOM |
| `pcbframe.js` | passa a desenhar texto em cima do `HubFont` em vez de ter cópia própria |
| `pcbframe.html`, `hub.html` | `<script src="hub-font.js">` / `hub-laser.js` |
| `hub.html` | aba **Laser**: opções · prévia · exportar |
| `tests/test-laser.js` (novo) | ver abaixo |
| `README.md` | a aba nova na lista do hub v2 |

`hub-laser.js` não entra no `hub-core.js`: esse já carrega três assuntos (motor de
changes, esquema/nets, Neoden) em 684 linhas, e o gerador é assunto fechado, com entrada
(`board`) e saída (string SVG) bem definidas.

A extração do `HubFont` é desacoplamento a serviço da tarefa: o `FONTDATA` está preso numa
linha de 9,9 KB no `pcbframe.js`, acoplado ao `ctx` do canvas, e a serigrafia em SVG
precisa dele como geometria pura. Sem a extração seriam duas cópias do mesmo blob.

## Interface (aba Laser)

Três colunas, no molde da aba Neoden:

- **esquerda — opções**: lado (Top/Bottom), presets **Cobre** / **Serigrafia**, checkboxes
  dos grupos, `inverter arte (negativo)`, `espelhar`, select de furo + diâmetro da marca,
  expansão, resolução, margem, modo da serigrafia;
- **centro — prévia**: a arte renderizada como vai sair, em preto/azul/vermelho. Usa
  `HubLaser.place`, a **mesma** transformação do arquivo, então espelho e negativo aparecem
  como vão sair. A prévia cede resolução (teto de 4 Mpx contra 40 Mpx do arquivo) para
  responder ao vivo e diz na barra quando cede — muda o passo do traçado, não a forma;
- **direita — resumo**: dimensões em mm, contagem de anéis e pontos, tamanho estimado do
  arquivo, avisos, e o botão **Baixar SVG**.

Nome do arquivo: `<projeto>-LASER-<lado>[-negativo][-espelhado].svg`.

Persistência em `localStorage['altiumhub.laser.<projId>']`, como a Neoden faz com as
exclusões.

## Testes (`tests/test-laser.js`)

O teste que justifica o design inteiro é o da união:

- **duas cápsulas cruzadas dão um anel só** — é exatamente o buraco que o LightBurn abriria
  na junção trilha/pad se as formas saíssem cruas;
- disco isolado → 1 anel, área ≈ πr² (tolerância 1%);
- pad com marca de centro → 2 anéis, o interno com orientação invertida;
- negativo → anel externo é o contorno da placa e o cobre virou buraco;
- espelho → x espelhado, y intacto, área preservada;
- `expand` → área cresce ≈ perímetro × expand;
- pad `Multi` entra nos dois lados; pad `Top` não entra no Bottom;
- furo `rect`/`oblong` sai retangular/oblongo com `holerot`, e sem `holerot` herda a rotação
  do pad; pad SMD com `drill` no arquivo não é furado; a marca de centro continua disco;
- desligar trilhas leva as regiões junto, e não existe mais toggle separado delas;
- `designator:true` vira o `ref` do dono;
- contorno com canto em arco encadeia num laço só, e o negativo respeita o canto
  (área = 400 − (4 − π) na placa de teste);
- `checkOpts` pega o negativo sem grupo de cobre, e a arte confirma que ele encheria a placa;
- SVG → contém `width="…mm"`, `viewBox` 1:1 e as três cores exatas da paleta;
- board real (TCMS_Reader) → gera sem aviso, sem cobre fora do contorno, e o `width` em mm
  bate com o `viewBox`.

- **região horária sobre trilha anti-horária dá um anel cheio, sem buraco na junção** — é o
  teste que trava o bug das cunhas brancas, e o mesmo desenho com a região invertida tem que
  dar área igual.

O erro de área é discretização de primeira ordem, não viés: um teste trava que ele **cai
junto com `res`** (metade da resolução, metade do erro).

Conferido contra um Monte Carlo analítico independente (1,5 M amostras, PRNG mulberry32),
na resolução padrão de 0,025 mm/px:

| placa | referência | gerado | erro | recuo linear |
|---|---|---|---|---|
| PESDA - DI241790 | 746,50 | 746,28 | −0,03% | −0,1 µm |
| VDCB - DI251879 | 459,59 | 458,90 | −0,15% | −0,5 µm |
| PRJ-DI221694D | 1186,38 | 1181,06 | −0,45% | −1,5 µm |
| TCMS_Reader | 403,07 | 402,06 | −0,25% | −0,7 µm |
| PACI-DI221687 | 47,93 | 47,98 | +0,10% | — |

O recuo linear (erro de área dividido pelo perímetro dos anéis) é o número que interessa:
sob 2 µm, contra ~80 µm de spot do laser.

**Cuidado com a própria verificação.** A primeira rodada usava um LCG com
`seed*1103515245`, que passa de 2^53 e perde precisão em JavaScript: a sequência degenerava
e a mesma entrada dava 453,88 ou 472,50 conforme o seed. Os números de fidelidade daquela
rodada eram inválidos, e o erro que eles sugeriam (~1%, ~4 µm) foi atribuído a discretização
quando boa parte era o bug de sentido do polígono. Monte Carlo de verificação precisa de
PRNG com aritmética de 32 bits (`Math.imul`).

**E cuidado com a placa de teste.** Todo o desenvolvimento foi verificado na TCMS_Reader —
a única placa do repo cujas regiões (só 2) são anti-horárias. Ela não podia expor o bug.
Verificação de geometria tem que varrer o repo inteiro, não uma placa preferida.

## Fora de escopo

Exportar DXF; incluir `changes.js` na arte; máscara de solda e pasta (não estão no
`board.js`); furação como camada separada de perfuração; painelização; qualquer cálculo
de potência/velocidade do laser (é do LightBurn, e depende da máquina e da tinta).
