---
nome: pcb-cobre-sem-curto
titulo: Nada de cobre de outra net em cima (ou perto) de pad
descricao: Regra da casa — trilha, arco, via, região, plano ou pad de uma net NUNCA encosta nem passa por cima de pad/via de outra net, em nenhuma camada (pad passante existe no Top E no Bottom): isso é curto. Trilha entre pinos passa no meio do vão, nunca colada num pad. Trilha da mesma net também não cruza o pad sem terminar nele, e faixa de cobre não tapa o alívio térmico. Use ao rotear, criar plano/região, mover componente ou revisar uma placa.
---

# Nada de cobre de outra net em cima (ou perto) de pad (regra da casa)

**Por quê:** cobre de duas nets se tocando é curto: a placa sai da fábrica condenada. Cobre mais perto que a folga
da regra também condena (a fábrica não garante o isolamento, a solda faz ponte). E o dono olha a placa na tela:
trilha cruzando um pad parece curto mesmo quando é da mesma net, e isso não pode aparecer.

## A regra

1. **Pad passante (TH, camada Multi) existe em TODAS as camadas de cobre.** Uma trilha do Top que passa por cima
   de um pad do conector encosta no pad, mesmo o componente sendo "do Bottom". Via também é das duas camadas.
2. **Cobre de outra net nunca toca pad nem via** — trilha, arco, via, pad de outro componente, fill, região,
   polígono/plano. Nem passando por cima, nem encostando na borda.
3. **Folga mínima = a regra Clearance do projeto** (`regras_ler {tipo:"Clearance"}`; na casa 0,254 mm = 10 mil para
   sinal até 50 V; acima disso veja a skill pcb-boas-praticas). Entre pad e trilha de outra net, a distância é
   medida da BORDA do pad (raio = largura/2) até a BORDA da trilha (centro ± largura/2).
4. **Trilha entre dois pinos passa no MEIO do vão**, não colada num deles. Passo 2,54 mm com pad de 1,5 mm deixa
   1,04 mm de vão: trilha de 0,254 mm no centro fica a 0,39 mm de cada pad. Colar no mínimo de um lado só quando
   não houver alternativa — e nunca abaixo da Clearance.
5. **Trilha da mesma net termina no pad** (no centro ou entrando pela borda) e, se precisar seguir, sai de novo do
   pad. Uma trilha que ENTRA de um lado e SAI do outro sem terminar nele (um segmento só por cima do pad) é proibida:
   esconde a ligação e parece curto. Barramento pino a pino (trilha chega no pino, termina, a próxima sai dele) é
   ligação normal.
6. **Pad ligado ao plano com alívio térmico:** nada de faixa/região/fill da mesma net tapando o pad e o vão do
   alívio — anula o alívio (a solda não pega) e na tela é cobre por cima do pad. Deixe o plano ligar pelos raios.
7. **Antes de gritar "curto", confira a net.** `pcb_consultar` na caixa do pad (tipo pads, trilhas e regioes) dá a
   net de cada objeto. Cobre da MESMA net em cima do pad não é curto (é o item 5/6); de net diferente é. Mostre ao
   dono os ids, as nets e a origem (board.js = veio do Altium; changes.js = feito no hub).

## Como fazer no NexoEletric (MCP)

- Antes de gravar uma trilha perto de pads: `pcb_consultar {tipo:"pads", caixa}` em volta do caminho, e calcule a
  distância borda-a-borda para cada pad de outra net. Em fileira de conector, use a linha do centro do vão
  (x = média dos centros dos dois pinos).
- `pcb_rotear` e `pcb_trilha` respondem os "erros" da validação: leia cada resposta.
- Plano: `pour_definir`/`poly_add` com `clearance` ≥ a Clearance do projeto; o despejo contorna os pads de outra
  net sozinho. Cobre que veio despejado do Altium (região `poly` do board.js sem polígono no hub) não se apaga pelo
  hub (`region_del` recusa): avise o dono para apagar/recortar o polígono no Altium.
- **Conferir sempre (as três, nesta ordem):**
  1. `drc_rodar {projeto}` — já redespeja os planos como a tela; tem de voltar `aprovado:true` (Clearance e
     ShortCircuit zerados). Nunca diga "DRC zero" de uma rodada com `despejar:false`.
  2. `regras_casa_verificar {projeto, regras:["pad_outra_net","trilha_sobre_pad"]}` — zero.
  3. `pcb_render {projeto, caixa, camadas:["Top","Multi"]}` e depois `["Bottom","Multi"]` com zoom nas fileiras de
     pads: olhe uma camada de cobre por vez.
