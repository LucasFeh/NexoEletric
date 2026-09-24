# Changelog — EletricHUB desktop

Versões do app desktop (tags `vX.Y.Z` deste repositório). Cada versão carrega o hub do
commit em que foi gerada; o commit aparece em **Ajuda › Sobre o EletricHUB**.

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
