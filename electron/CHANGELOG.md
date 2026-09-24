# Changelog — AltiumHub desktop

Versões do app desktop (tags `vX.Y.Z` deste repositório). Cada versão carrega o hub do
commit em que foi gerada; o commit aparece em **Ajuda › Sobre o AltiumHub**.

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
