---
nome: pcb-enviar-jlc
titulo: Enviar a placa para a JLCPCB (carrinho)
descricao: Processo da casa para pôr a placa no carrinho da JLCPCB pelo IntegrateBrowser — perguntar a quantidade antes, camadas pela placa, login com a conta do usuário, SAVE TO CART e conferir a captura. Use quando o usuário pedir para mandar/encomendar/fabricar a placa na JLC, pôr o Gerber no carrinho ou fazer o pedido da PCB.
---

# Enviar a placa para a JLCPCB (processo da casa)

**O que é:** o Gerber do projeto vai, em .zip, para o orçamento da JLCPCB (cart.jlcpcb.com/quote) no
**IntegrateBrowser** (o navegador do Nexo Hub). A JLC lê as camadas e o tamanho; a quantidade é a que o
usuário pedir. O pedido para no **carrinho**: pagar, frete e endereço são sempre com o usuário.

O botão **Enviar pra JLC** do visualizador de Gerber (vista PCB) faz o mesmo sem IA: lá o usuário entra na
conta pela janela do navegador.

## Passo a passo

1. **Antes de tudo:** confira se a placa está pronta para fabricar: `regras_casa_verificar` e `drc_rodar`.
   Achou violação? Diga ao usuário e pergunte se envia assim mesmo.
2. **`jlc_preparar {projeto}`**: gera o Gerber se não houver um salvo e monta o .zip. Ele devolve quantas
   camadas de cobre a placa tem, o que a JLC vai receber e o tamanho. Para refazer o Gerber com as mudanças
   de agora, use `gerar:true`.
3. **PERGUNTE A QUANTIDADE e só depois comece.** Mostre o resumo:
   - projeto;
   - camadas: 2 camadas, ou "3 camadas → a JLC fabrica 4";
   - tamanho.

   A JLC só aceita as quantidades da lista: 5, 10, 15, 20, 25, 30, 50, 75, 100, 125, 150, 200…
   Se o usuário pedir outra (ex.: 8), ofereça a mais perto. **Não envie nada sem a quantidade dita pelo
   usuário nesta conversa.**
4. **`jlc_enviar {projeto, quantidade}`**: a janela do IntegrateBrowser aparece. A ferramenta sobe o .zip,
   confere as camadas que a JLC leu contra as da placa, marca as camadas, põe a quantidade e clica SAVE TO CART.
   - Os outros campos ficam no padrão da JLC: FR-4, 1,6 mm, verde, HASL, 1 oz. Se o usuário pediu outra
     espessura, cor ou acabamento, diga que o padrão foi mantido e que ele muda no carrinho. Ou ajuste na
     página antes do SAVE TO CART, com as ferramentas do IntegrateBrowser, e confira na captura.
5. **`etapa: "login"`** quer dizer que a conta não está aberta:
   - Peça ao usuário **o login (usuário ou e-mail) e a senha da JLC** e chame **`jlc_login {usuario, senha}`**.
   - **A senha:** use só nesta chamada. Nunca a repita na resposta, nunca a guarde em memória, nota, arquivo,
     `changes.js` ou sinalizador, e não a escreva em comando de shell.
   - O usuário prefere entrar ele mesmo? Mostre a janela (`janela {mostrar:true}` do IntegrateBrowser) e
     espere ele dizer que entrou.
   - **`etapa: "captcha"`:** a JLC pediu verificação. A janela já está aberta; peça ao usuário para resolver
     lá e avisar.
   - **`etapa: "erro"`:** a JLC não aceitou o login. Diga a mensagem, sem a senha, e peça de novo.
   - Depois de entrar, chame **`jlc_enviar` de novo**: o orçamento recomeça depois do login.
6. **Confira antes de dizer "pronto".** A resposta de `jlc_enviar` traz a captura. Olhe nela e no retorno:
   - o arquivo (`noCarrinho`);
   - as camadas e o tamanho que a JLC detectou (`detectado`, `dimensoes`), contra os do `jlc_preparar`;
   - a quantidade;
   - o preço.

   Se algo não bate (camada diferente, tamanho errado, `avisos`), diga o quê e não chame de pronto. Para ver
   mais, use `captura` do IntegrateBrowser, e para ver a página inteira, `captura {completa:true}`.
7. **Diga ao usuário:**
   - o que foi para o carrinho: placa, camadas, tamanho, quantidade e preço;
   - os avisos;
   - que **o pagamento é com ele**, no carrinho da JLC (o IntegrateBrowser fica aberto nessa página).

## Não faça

- Não clique em Checkout, pagamento, endereço ou frete, nem aceite cupom ou termos em nome do usuário.
- Não envie o Gerber de um projeto que o usuário não pediu, nem uma quantidade que ele não disse.
- Não guarde nem repita credenciais.
