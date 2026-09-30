# Changelog — EletricHUB desktop

Versões do app desktop (tags `vX.Y.Z` deste repositório). Cada versão carrega o hub do
commit em que foi gerada; o commit aparece em **Ajuda › Sobre o EletricHUB**.

## 1.2.4 — 2026-09-30

- **A parte se troca na ficha, direto na folha.** Clique no componente: se o símbolo tem várias partes, a **Parte** das Propriedades é um seletor com todas elas, como o Part do Altium. Cada opção diz os pinos da parte, se ela já está colocada noutro item do mesmo designador (escolher uma dessas troca os dois) e se os pinos dela não têm pad no footprint. Um Ctrl+Z desfaz. Antes a ficha contava só as partes da folha, e um componente de duas partes com a 1 colocada dizia "1 de 1".
- **Enviar para o Odoo: tirar da lista uma linha do esquema.** Toda linha do esquema tem **remover**: ela não vai para o Odoo, o esquema não muda, e ela desce para o fim, apagada, com **devolver**. Um aviso no topo, o total e a pergunta do Enviar dizem quantas foram tiradas. Trocada por outra peça, a linha volta sozinha para a lista. Com tudo tirado, a lista ainda aparece para devolver, mas conferir e enviar ficam recusados.
- O `lista-extras.json` de um projeto com linhas tiradas passa a ser o formato v2: um app de versão anterior recusa montar a lista desse projeto, em vez de mandar ao Odoo o que foi tirado — atualize os PCs que usam a lista.

## 1.2.3 — 2026-09-30

- **Trocar componente: a parte.** No rodapé do **Trocar componente** (aberto pela ficha de um componente), o seletor **Parte** mostra as partes do componente escolhido — ou, sem escolha, as do componente de hoje, e o botão vira **Trocar a parte**: é assim que se troca só a parte, inclusive de um símbolo da Biblioteca do Altium. Cada opção diz quantos pinos a parte tem. A parte vale para o item que abriu o modal; os outros designadores do alcance trocam de componente e ficam com a parte que têm. Se o designador já tem a parte pedida noutro item, os dois trocam de parte. Um Ctrl+Z desfaz tudo.
- **Componente de várias partes troca de desenho** quando o componente novo tem todas as partes que ele usa na folha (um relé de duas partes por outro de duas). Faltando alguma, recebe só a identidade, como antes.

## 1.2.2 — 2026-09-30

- **Adicionar componentes: a parte, em qualquer acervo.** Componente de várias partes (um relé com bobina e contatos, um amplificador duplo) mostra o seletor **Parte** também no almoxarifado — para o componente desenhado em várias partes no editor (**+ parte**) —, e não só na Biblioteca do Altium. Cada opção diz quantos pinos a parte tem, e a lista da direita mostra a parte na frente do nome. No **Finalizar**, a parte vai para o componente que ainda não a tem: parte 1 e parte 2 na mesma lista viram **um** U1, como o "completar os existentes" do Altium. O campo *comment* não fica mais espremido quando o componente tem uma parte só.
- **Apagar os componentes fora do Odoo.** Em **Configurações › Projeto**, a contagem dos componentes que saíram do Odoo e **Apagar os N fora…**. Na Biblioteca, o painel de valores ganhou **Selecionar fora** (Ctrl+clique marca ou desmarca um) e **Apagar N…**, e a faixa de cima, **Apagar fora (N)…**. Todos perguntam antes, dizendo onde cada componente é usado; se o produto voltar ao Odoo, volta com o mesmo número.
- **Excluir da biblioteca** (botão direito num valor) volta a funcionar para os componentes da biblioteca Especiais — o hub respondia "não está no espelho do almoxarifado".
- **Tudo segue o ID do Odoo.** Renomear um produto no Odoo troca só o nome do componente: o desenho, o símbolo aplicado, o footprint escolhido à mão e o componente já colocado na folha acompanham o produto. O produto que aparece em mais de um componente da biblioteca é avisado na Biblioteca (**⚠ N produtos repetidos**), com **Apagar os antigos**.

## 1.2.1 — 2026-09-29

- **Enviar para o Odoo: componentes fora do esquema.** O botão **Adicionar componente fora do esquema** abre o seletor do almoxarifado num modo que só escolhe (a folha não muda); a quantidade se digita no próprio painel e a peça entra como uma linha **EXTRA n**, com a marca *fora do esquema*. Na linha, a quantidade se edita ali mesmo (Enter ou sair do campo grava, Esc desfaz, as setas contam), **remover** tira a linha sem perguntar e **resolver** troca a peça mantendo a quantidade. As mudanças gravam na hora, em fila, e a lista se reconfere sozinha. Um extra da mesma peça de uma linha do esquema vai numa linha separada, com a marca *mesma peça de R1, R2*. Os extras moram em `lista-extras.json`, ao lado do esquema, e o **Importar do servidor** os traz junto com o projeto.
- **O envio confere a lista inteira.** Se a lista mudou depois da conferência (uma quantidade mexida noutra aba, o esquema gravado), o envio é recusado sem mandar nada, e a tela remonta e confere de novo. Um caractere que o Odoo não aceita (colado do Word na observação, por exemplo) não derruba mais o envio.
- **Componentes de mesmo nome** (o *Cartão Micro SD* do conector e o do soquete) não se confundem mais: o seletor marca e grava a peça clicada — no Trocar componente, no resolver da lista do Odoo e nos extras — e a linha sai com o produto, o nome e o encapsulamento dela.
- **Trocar componente › Editar símbolo ↗ volta a abrir o editor no componente**, e não só na família. O botão já aparece quando o seletor abre.
- **Adicionar componentes:** valor sem footprint conhecido entra com **— sem footprint —** (antes o seletor pegava o primeiro footprint da biblioteca), e o esquema salva assim; o BuildSchematic avisa para definir no Altium.

## 1.2.0 — 2026-09-28

- **A biblioteca é a do servidor.** Símbolos, almoxarifado, substituições e a numeração dos componentes são lidos e gravados direto no hub central (http://192.168.15.192:8100). Salvar ou aplicar um símbolo, trocar um footprint, excluir um componente do almoxarifado, escolher uma substituição e sincronizar com o Odoo acontecem no servidor, e o que um PC grava os outros veem. A pasta de trabalho guarda uma cópia para leitura, que o hub atualiza sozinho (ao abrir, a cada mudança no servidor e a cada minuto). O hub, a lista para o Odoo, o chat e o Altium desta máquina leem dela.
- **Sem o servidor, a biblioteca abre só para leitura**, com a última cópia. Toda gravação de biblioteca é recusada com aviso, e nada é gravado. Projetos continuam sendo editados e salvos neste PC normalmente. Um indicador no hub mostra **Biblioteca do servidor** ou **Servidor fora — biblioteca só leitura**, e avisa quando o servidor cai e quando volta.
- **O que era só deste PC não some.** Um arquivo de biblioteca mudado aqui que o servidor não tem vai para `.altiumhub\backup\lib-remota-<data>\Libs\` antes de ser trocado pela versão do servidor, e o hub avisa onde ficou.
- **Sincronizar almoxarifado** roda no servidor, com o Odoo e o login de lá, e é o servidor quem numera. O app não traz mais o estado do almoxarifado antes, nem pergunta "Sincronizar assim mesmo". A caixa correspondente das configurações fica sem efeito, mas continua guardada: volta a valer se a biblioteca do servidor for desligada.
- **Importar do servidor** fica com **Projetos** e **Bibliotecas do almoxarifado para o Altium** (`Libs\Almox`). "Bibliotecas publicadas" e "Estado do almoxarifado" aparecem desligadas, porque a cópia da biblioteca já é o hub quem mantém. O índice dos projetos (`projects.js`) passa a vir com os projetos. As `.SchLib` do almoxarifado não entram na cópia automática: depois de sincronizar, se o Altium desta máquina lê a pasta de trabalho, importe as Bibliotecas do almoxarifado para ele receber as novas.
- **Configurações › Servidor central › Usar a biblioteca do servidor**, ligada. Desligar volta a biblioteca própria deste PC, que se afasta da do servidor a cada edição. A cópia que a biblioteca do servidor deixou na pasta continua se atualizando pelo **Importar do servidor**, sem virar conflito nem backup; só o que foi editado aqui depois dela fica protegido. Mudar o servidor ou essa caixa reinicia o hub. Numa pasta de desenvolvedor (git) a biblioteca continua a do repositório. **Ajuda › Sobre o EletricHUB** diz qual biblioteca está valendo.
- O hub do servidor precisa ser da mesma versão que o deste app: uma função que ele ainda não tem responde com o aviso de atualizar o hub do servidor, em vez de falhar calada.

## 1.1.9 — 2026-09-25

- Biblioteca › Símbolos, a ferramenta de símbolos depois da revisão:
  - Os pinos casam **pelo nome** quando o símbolo e o componente nomeiam os pinos (A/K, B/C/E, +/−). Casar pelo número invertia o transistor e o zener quando a numeração do símbolo segue outra convenção. Quando só um lado nomeia os pinos (o eletrolítico "1"/"2" contra o símbolo "+"/"−"), a linha vem **a conferir**, desmarcada, e a seção mostra como os pinos casariam ("1 → +  2 → -"); conferido, um clique no cabeçalho marca a seção.
  - A **pinagem nunca muda calada**: componente com outra contagem de pinos só recebe o símbolo se for marcado à mão. Ao editar um símbolo, quem teria a pinagem trocada fica de fora do "Atualizar", e o hub diz quantos são; salvar só a descrição não pergunta nada.
  - Componente com desenho próprio do gerador (PNP, conector por vias) vem desmarcado, e categoria de pinagem a definir não recebe desenho padrão.
  - `Enter` no "Aplicar à categoria" só confirma em cima do botão Aplicar.
  - Aplicar e salvar são recusados enquanto a sincronização do almoxarifado roda (ela desfaria a gravação no fim), e editar a biblioteca enquanto a extração roda.
  - Excluir um símbolo mantém a categoria com o desenho padrão. O hub volta a mostrar o desenho do componente de conector e PNP protegido depois de sincronizar.
  - A tela não esvazia mais quando o hub recarrega com um componente aberto, e os avisos do último lote não somem da ficha.

## 1.1.8 — 2026-09-25

- Biblioteca › Símbolos, **ferramenta de símbolos**. Símbolo não é componente: o símbolo é o desenho da biblioteca de símbolos; o componente é a peça do almoxarifado que o usa; a linha da lista da esquerda é a categoria.
  - **Botão direito num símbolo**: *Editar símbolo*, *Aplicar…*, *Renomear…* e *Excluir símbolo…*.
  - **Editar** abre o desenho do símbolo no canvas (marca SÍMBOLO no topo) e **Salvar símbolo** grava na biblioteca. Se ele já estava aplicado, o hub pergunta se leva o desenho novo aos componentes que o usam.
  - **+ Novo símbolo** começa um símbolo em branco, que entra na biblioteca no primeiro Salvar.
  - **Excluir** tira o símbolo de vez (a extração não o traz de volta); os componentes que o usavam ficam com o desenho.
  - **Aplicar à categoria…**: com uma categoria aberta, lista os componentes dela, todos marcados, para conferir e desmarcar, e grava todos de uma vez no espelho, na .SchLib e no ledger. As outras linhas da mesma família (o [SMD] do [PTH]) aparecem desmarcadas, a um clique. Marcada a categoria inteira, o símbolo vira também o **desenho padrão** dela, e o componente que entrar no almoxarifado depois já vem com ele.
  - Os pinos casam **pelo número** quando o símbolo e o componente têm os mesmos números: a polaridade de capacitor, diodo e transistor fica. Pela ordem só quando os números não batem, e o hub avisa.
  - O botão Aplicar diz onde o desenho vai cair: *Aplicar ao componente* ou *Aplicar à categoria…*.

## 1.1.7 — 2026-09-25

- Vista Esquema, **gaveta dos pousos** na barra de ferramentas, como na Active Bar do Altium: GND, 3V3, 5V5, VIN, o rótulo de net e o No ERC ficam num botão só. A face do botão é o último pouso usado, e clicar nela usa de novo; a setinha no canto de baixo, ou o botão direito, abre a lista com os seis. As teclas (`G`, `L`, `N`) continuam valendo e também trocam a face, e a escolha fica lembrada nesta máquina. Clicar fora ou `Esc` fecham a gaveta, e o clique na folha que a fecha não pousa nada.
- O botão do tamanho da folha (**A4**) saiu da barra: o formato continua em **Configurações › Folha**.

## 1.1.6 — 2026-09-25

- Vista Esquema, **fio traçado como no Altium** (ferramenta Fio, `W`): do último ponto saem duas pernas em L até o cursor, a primeira contínua e a segunda pontilhada; o clique fixa só a primeira, e a seguinte sai perpendicular. Clicar num ponto elétrico (pino, ponta ou **meio** de outro fio, junção, power, port) completa o L e termina o fio; no meio de um fio nasce o T. `Espaço` inverte o canto, `Shift+Espaço` troca o modo (90°, 45° ou livre, lembrado nesta máquina) e `Backspace` desfaz o último canto (sem canto fixado, desiste do fio). Botão direito ou `Esc` terminam no último canto fixado, e o duplo clique termina no ponto clicado; a ferramenta continua na mão, e um segundo botão direito ou `Esc` a larga. `Esc`, trocar de ferramenta e trocar de folha agora **gravam** o fio em curso — antes ele sumia. O fio gravado sai sem ponto repetido nem vértice no meio de uma reta.
- As marcas do fio seguem as medidas do Altium: o trecho fixado sai em lavanda com halo e fica azul só ao gravar, cada canto ganha um x, a partida ligada ganha uma bolinha magenta, o cursor sobre um ponto elétrico mostra um X vermelho e uma cruz cinza acompanha o cursor. A barra de status mostra o ponto sob o cursor, o modo, o dX/dY desde o último clique (na unidade da grade) e as teclas que valem.
- Ímã das ferramentas (Fio, pousos, rótulo, No ERC) nas grades finas: vértice de fio, junção, power e port pegam a até 0,6 passo, e o mínimo de 20 mil ficou só para o pino. Nas grades de 10 mil, 0,5 mm e 0,25 mm, o fio vizinho a um ou dois passos não puxa mais o cursor. Os pousos **GND**, **3V3**, **5V5** e **VIN** e o **rótulo de net** também encostam no meio de um fio.
- **Seleção do fio em dois cliques**, como no Altium: o primeiro clique pega o fio inteiro (tracejado claro, alcinha verde em cada vértice); o segundo pega só o trecho, ou o vértice se caiu na alcinha (alcinhas vermelhas). Assim, clique e `Delete` apagam o fio inteiro; para apagar um trecho ou um vértice, pegue-o com o segundo clique. O duplo clique deixou de ser o gesto de pegar o fio inteiro. Parado sobre um fio, a barra de status diz o que o clique vai pegar. A net acende só com **`Alt`+clique**: o clique simples apenas seleciona.
- **Mover um componente não leva mais o fio**: a ligação se desfaz quando o pino sai da ponta. Para levar o fio, selecione-o junto (laço, `Ctrl+A` ou `Shift`+clique): o fio inteiro anda junto, e um trecho ou vértice selecionado fica com a ponta presa ao pino, mesmo girando o componente no meio do arrasto.
- **Guias de alinhamento** no arrasto, em magenta, como no Figma: borda com borda, centro com centro e com o centro da folha, pino com pino, vértice de fio, power, port, rótulo e junção; entre componentes, o **espaço igual** e a **distância** até o vizinho de cada lado, em mm ou mil conforme a grade. A guia prende quando o cursor chega perto e só solta quando ele se afasta um pouco mais, e a barra de status diz qual pegou. Designador e comment arrastados alinham com os dos outros componentes. No arrasto, `Ctrl` solta a guia e `Shift` prende a peça no trilho dela (sem guia, faz a peça andar reta). O botão fica em **Configurações › Vista** e já vem ligado.
- Correções no arrasto: um ajuste curto de componente não volta mais sozinho para o lugar; girar ou espelhar no meio do arrasto (`Espaço`, `X`, `Y`) refaz o ímã e as guias e entra no desfazer; `Esc`, ou a janela perder o foco, desfaz o deslocamento e mantém o giro, que também entra no desfazer; a roda do mouse ou o `F` no meio do arrasto fazem a peça pousar onde se vê; dois pedaços do mesmo fio arrastados juntos andam os dois. O tracinho do designador ou do comment até o componente só aparece enquanto o texto é arrastado.
- **Número e nome de pino ficam de pé** em qualquer rotação: a 180° não saem mais de cabeça para baixo, e a 270° não se leem mais de cima para baixo.
- **Conector desenhado uma parte por pino** (designador CN, J ou X, ou símbolo com um pino por parte): o designador aparece só na parte 1, e nas outras fica o número do pino. Ele volta quando os nomes e números de pino estão desligados em **Configurações › Vista** e o símbolo esconde os números.
- Aba **Atalhos**: os gestos da vista Esquema acompanham o editor novo (segundo clique no fio, `Alt`+clique, `Shift` e `Ctrl` no arrasto, as teclas do fio), e a coluna **Quando** diz em que situação cada linha vale: vista Esquema, arrastando ou fio na mão (W). Saiu o "Clique duplo: pegar o fio inteiro".
- Configurações do hub › Projeto, **Envio da lista para o Odoo**: a ajuda não diz mais que o hub-almox.json é servido em texto claro para a rede, o que já não acontecia.

## 1.1.5 — 2026-09-24

- As vistas **Esquema e PCB seguem o tema do hub**: modo claro ou escuro, os temas Grafite, Papel, Altium e Placa, e a fonte escolhida. Painéis, barras, botões, listas, a ficha de propriedades e os modais (Adicionar componentes, Odoo, almoxarifado) trocam junto, na hora, sem recarregar a folha. O desenho não muda: a folha do Altium, os fios e símbolos, e a placa sobre o fundo preto, como no Altium.
- Aba **Atalhos** das configurações do hub no molde do *Keyboard Shortcuts* do VSCode: busca (por texto ou pela tecla pressionada), tabela Comando · Atalho · Quando · Origem, teclas desenhadas, troca por duplo clique numa caixa "pressione a combinação e depois Enter", voltar ao padrão por linha. Os gestos do mouse aparecem na mesma tabela.

## 1.1.4 — 2026-09-24

- Sem o botão **Painéis** na barra de status. O painel Projetos agora recolhe e expande pelo próprio cabeçalho: clicar em **Projetos** recolhe numa faixa fina à esquerda, e clicar na faixa abre de novo (Exibir › Painel Projetos, Ctrl+Alt+P, faz o mesmo). Duplo clique na borda do painel volta à largura padrão.
- As configurações do hub ficam só em **Arquivo › Configurações do hub…**: o ⚙ ao lado do botão do Claude saiu. O item abre as configurações na janela do hub que estiver à mão; se só houver uma janela à parte da vista Esquema aberta, abre uma janela nova do hub já com elas. Com um diálogo do hub esperando resposta, ele não abre outro por cima.

## 1.1.3 — 2026-09-24

- Vista Esquema: a lista de **Validação** saiu das Configurações. A validação continua valendo (é ela que impede salvar um esquema inválido), só não é mais listada no painel.

## 1.1.2 — 2026-09-24

- Painel Projetos: botão direito num projeto abre um menu com **Excluir projeto…** (e abrir o projeto, abrir/fechar a gaveta). É o mesmo diálogo das Configurações do hub — senha mestre, a pasta vai para `Trash\` —, agora para o projeto clicado, mesmo que não seja o aberto.
- Vista Esquema: o painel da esquerda saiu. O da direita tem duas abas no rodapé, **Configurações** (folhas e formato, vista, salvar, Odoo, almoxarifado e validação) e **Propriedades**. Sem nada selecionado ele mostra as Configurações; ao selecionar, troca para as Propriedades; as abas trocam à mão. O painel fica ao lado da folha em vez de por cima, e o alfinete deixou de existir. A aba Componentes (lista de componentes e de nets) saiu.
- Os atalhos de teclado da vista Esquema foram para as Configurações do hub, aba **Atalhos**. As teclas já trocadas continuam valendo, e trocar ali vale na hora, também para a vista que já estiver aberta.

## 1.1.1 — 2026-09-24

- Sem a faixa do cabeçalho: no topo ficam só as abas. O estágio do projeto (esquema, eco, roteada, aplicada) e as pendências foram para a barra de status; o chat e as configurações do hub (⚙) ficaram no canto direito das abas. As configurações do hub também estão em Arquivo › Configurações do hub…, e as do app passaram a se chamar Configurações do aplicativo….
- Painel Projetos: clicar no projeto abre a gaveta dele e clicar de novo fecha, inclusive no projeto aberto. Novo botão "Fechar todos os projetos". Ctrl+K leva à busca do painel.

## 1.1.0 — 2026-09-24

- O sistema passa a se chamar **EletricHUB**: app, janela, instalador, atalhos, hub e as caixas dos scripts do Altium. A pasta de dados (`%APPDATA%\AltiumHub`) muda de nome sozinha na primeira abertura, com a pasta de trabalho, as configurações e as preferências do hub. Instalações novas usam `C:\EletricHUB` como pasta de trabalho; as existentes continuam onde estão.
- Interface de ambiente de CAD, com a mesma identidade visual: painel **Projetos** à esquerda (projetos, documentos e bibliotecas em árvore, com busca, pendências e largura ajustável), abas de documento com ícone e barra de status com projeto, documento, contagens, servidor e o botão **Painéis**. Exibir › Painel Projetos (Ctrl+Alt+P) mostra e esconde o painel.
- O título da janela mostra o projeto e o documento abertos.

## 1.0.2 — 2026-09-24

- O link do BOM é sempre o do hub do servidor (http://192.168.15.192:8100): "Copiar link", o rodapé do painel e "Abrir numa aba" (que abre no navegador). É lá que a bancada abre o projeto de referência e marca os vistos. Se o projeto ainda não está no servidor, ou o servidor não responde, o app avisa ao copiar. As opções da aba vão junto para o servidor, como quando se copia o link lá.

## 1.0.1 — 2026-09-24

- O instalador reconhece o AltiumHub já instalado: de uma versão mais velha ele **atualiza** (e diz isso), na mesma versão oferece abrir o app em vez de reinstalar, e nunca volta para uma versão mais antiga. Projetos, bibliotecas, a pasta de trabalho e as configurações não são tocados. Mensagens do instalador em português.
- Com o app aberto, o instalador pede para ele fechar como o X da janela: as vistas perguntam pelo que não foi salvo e o hub é parado direito. Só se o app continuar aberto é que ele pergunta de novo.
- Hub que abriu sem projeto nenhum (primeira execução, antes da importação do servidor) não atualizava a lista quando os projetos chegavam: ficava vazio até um F5.

## 1.0.0 — 2026-09-24

Primeira versão: o hub do AltiumPCBMirror como aplicativo do Windows.

- O mesmo `hubserver.py` do servidor, com um CPython 3.12.10 embutido, escutando só em
  127.0.0.1 (porta 8200). O compartilhamento na rede local é opcional e exige senha
  mestre própria.
- Pasta de trabalho local (padrão `C:\AltiumHub`). A cada atualização, o código do hub é
  reposto; projetos, bibliotecas e credenciais nunca são tocados.
- **Importar do servidor**: projetos, bibliotecas publicadas, estado do almoxarifado e
  `Libs/Almox`, a partir do hub central (http://192.168.15.192:8100). A importação tem três
  vias: um arquivo mudado só aqui não é sobrescrito, e um conflito fica guardado à parte.
- Almoxarifado consultando o Odoo de produção (192.168.15.192:8070, `odoo_db`) e gerando
  as bibliotecas localmente. Antes de cada sincronismo, o estado que numera os
  componentes vem do servidor, para a numeração não divergir.
- Os scripts do Altium podem ser apontados para a pasta local (`home.txt`).
- Atualização automática pelos releases do GitHub (repositório privado, com token de
  leitura).
- Janela com o comportamento de aba do Chrome: pop-ups do hub dentro do app, links do
  Odoo no navegador, aviso de edição não salva, F5, captura de tela para o chat,
  downloads direto para a pasta Downloads e a fonte Inter embutida.
