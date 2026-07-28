# AI-GUIDE — Como editar esta placa (contrato para a sessão de IA)

Você está numa pasta `PCBMirror\` gerada pelo **AltiumPCBMirror** a partir de uma PCB real
aberta no Altium Designer. Sua tarefa é personalizar a placa **editando apenas o arquivo
`changes.js`**. Depois, um script dentro do Altium aplica suas mudanças na PCB real.

## Regras absolutas

1. **NUNCA edite `board.js`** — ele é o espelho exportado (verdade da placa). Só leitura.
2. **Edite somente `changes.js`** (e nada mais nesta pasta).
3. Em `changes.js`, escreva **um objeto JSON por linha**, dentro do array `var changes = [...]`.
   Objetos **planos** (sem aninhamento), terminados com `,` — o parser do Altium lê linha a linha.
4. Toda edição/remoção **deve carregar os campos `orig_*` copiados EXATAMENTE do `board.js`**
   (mesmos números, sem arredondar). É a trava de segurança: se a placa real não casar com o
   `orig_*` (tolerância 0,001 mm), a mudança é rejeitada.
5. Não invente `id`s: use os que existem em `board.js` (`t1`, `v2`, `a1`...). Adições não levam `id`.
6. Strings não podem conter a sequência `":` (quebra o parser de linha). Use `note` com texto simples.

## Sistema de coordenadas (idêntico ao Altium)

- Unidade: **mm** (use até 6 casas decimais).
- Eixo **X para a direita, Y para CIMA**, relativo à **origem da placa** — os mesmos números
  do PCB List / Properties do Altium.
- Rotação: **graus, anti-horário** (0–360). Componentes no bottom usam o valor bruto do Altium
  (não converta nada).
- Camadas de cobre: `Top` e `Bottom`. Silk: `TopOverlay`/`BottomOverlay`. Pads TH: `Multi`.
- `board.js » board.bbox` dá os limites da placa. Mantenha tudo dentro do contorno.

## Formato do `changes.js`

```js
// comentarios com // sao permitidos em linhas proprias
var changes = [
{"op":"comp_move","ref":"R5","x":12.7,"y":8.4,"rot":90,"layer":"Top","orig_x":10.16,"orig_y":8.4,"orig_rot":0,"orig_layer":"Top","note":"afastar do conector"},
{"op":"track_edit","id":"t42","w":0.5,"orig_x1":10.8,"orig_y1":20,"orig_x2":14,"orig_y2":20,"orig_w":0.3,"orig_layer":"Top"},
{"op":"track_add","layer":"Top","x1":16,"y1":22,"x2":19,"y2":22,"w":0.3,"net":"GND"},
{"op":"track_del","id":"t7","orig_x1":9.2,"orig_y1":20,"orig_x2":9.2,"orig_y2":22,"orig_w":0.3,"orig_layer":"Top"},
{"op":"via_edit","id":"v3","x":21,"y":13,"orig_x":20,"orig_y":13.1},
{"op":"via_add","x":16,"y":22,"size":0.6,"drill":0.3,"net":"GND"},
{"op":"via_del","id":"v9","orig_x":36,"orig_y":5},
{"op":"arc_edit","id":"a1","r":2.5,"orig_cx":33,"orig_cy":22,"orig_r":2,"orig_sa":0,"orig_ea":90,"orig_layer":"Top"},
{"op":"arc_add","layer":"Top","cx":33,"cy":22,"r":3,"sa":0,"ea":90,"w":0.3,"net":""},
{"op":"arc_del","id":"a2","orig_cx":5,"orig_cy":5,"orig_r":1,"orig_sa":0,"orig_ea":360,"orig_layer":"Bottom"},
];
```

### Campos por operação

| op | obrigatórios | opcionais |
|---|---|---|
| `comp_move` | `ref`, `orig_x`, `orig_y`, `orig_rot`, `orig_layer` | `x`, `y`, `rot`, `layer` (mudar layer = flip), `note` |
| `track_edit` | `id`, `orig_x1..orig_y2`, `orig_w`, `orig_layer` | `x1`,`y1`,`x2`,`y2`,`w`,`layer`,`net`,`note` |
| `track_add` | `layer` (Top/Bottom), `x1`,`y1`,`x2`,`y2`,`w` | `net`, `note` |
| `track_del` | `id`, `orig_x1..orig_y2`, `orig_w`, `orig_layer` | `note` |
| `via_edit` | `id`, `orig_x`, `orig_y` | `x`,`y`,`size`,`drill`,`note` |
| `via_add` | `x`,`y`,`size`,`drill` | `net`, `from`, `to`, `note` |
| `via_del` | `id`, `orig_x`, `orig_y` | `note` |
| `arc_edit` | `id`, `orig_cx`,`orig_cy`,`orig_r`,`orig_sa`,`orig_ea`,`orig_layer` | `cx`,`cy`,`r`,`sa`,`ea`,`w`,`layer`,`note` |
| `arc_add` | `layer`, `cx`,`cy`,`r`,`sa`,`ea`,`w` | `net`, `note` |
| `arc_del` | `id`, `orig_cx..orig_ea`, `orig_layer` | `note` |

- `size` = diâmetro do anel da via; `drill` = diâmetro do furo (`drill < size`).
- `sa`/`ea` = ângulos inicial/final do arco em graus, anti-horário a partir de +X.
- `net`: use um nome existente em `board.js » nets` (net inexistente gera aviso e objeto sem net).

## Boas práticas de layout (o DRC final é do Altium)

- Clearance típico: mantenha **≥ 0,2 mm** entre cobres de nets diferentes (confira as regras
  reais do projeto se o usuário informar).
- Ao mover um componente, ajuste/adicione/remova as trilhas que chegavam nos pads dele —
  os pads estão em `board.js » components[].pads` (posições absolutas ANTES do movimento;
  após `comp_move`, cada pad gira/translada junto com o componente em torno de `x,y`).
- Vias novas: conecte camadas com trilha chegando na mesma coordenada da via.
- Não deixe trilhas órfãs: remova com `track_del` o que ficou sem função.
- Furos de fixação e NPTH estão em `freepads` — não coloque cobre em cima.

## Fluxo de trabalho recomendado

1. Leia `board.js` (cabeçalho, `stats`, `board.bbox`, depois os objetos relevantes).
2. Planeje as mudanças; copie os `orig_*` exatos do `board.js`.
3. Escreva `changes.js` (uma linha por mudança, com `note` explicando cada uma).
4. Peça ao usuário para conferir no `viewer.html` (F5) — ele valida `orig_*`, mostra o diff
   e a tabela PCB List pós-mudanças.
5. O usuário roda `ApplyChanges` no Altium e depois o DRC. O relatório fica em
   `apply-report.txt`; se algo falhar, corrija e repita.
