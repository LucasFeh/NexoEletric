---
nome: componente-novo
titulo: Criar um componente novo (criado localmente) a partir do link ou do datasheet
descricao: Processo da casa para a peça que o almoxarifado do Odoo ainda não tem — ler o datasheet ou a página do produto, perguntar as regras ao Odoo, montar a ficha x_*, atribuir símbolo e footprint, conferir no Odoo e colocar no esquema. Use quando o usuário pedir um componente que não está no almoxarifado, mandar um link de loja ou datasheet de uma peça nova, ou pedir para "cadastrar", "criar" ou "adicionar à biblioteca" uma peça.
---

# Componente novo (criado localmente)

**O que é:** a peça que o almoxarifado do Odoo ainda não tem vira um componente **criado localmente** (o ícone "Novo
componente" ao lado da busca da Biblioteca; arquivo `Libs/almox-locais.js`). Ele aparece no "Adicionar componentes" com a tag
**criado localmente**, vai para o esquema como qualquer peça e, no **Enviar para o Odoo**, vai com a **ficha
completa** (o bloco `componente`). O almoxarifado confere e cria a peça com um clique. No sincronismo seguinte ela
volta como peça do almoxarifado e **perde a tag** (`local_integrar`, que roda sozinho).

**Você nunca cria produto no Odoo nem aprova lista.** O caminho é a ficha; criar e aprovar é clique de gente.

## Passo a passo

1. **A peça já existe?** `almox_buscar {busca: "<MPN>"}`. Se achar no almoxarifado, use ela (o `comp` que volta). Se
   achar com a tag "criado localmente", ela já foi criada: use ou edite (`local_ler`, `local_editar`).
2. **Leia a fonte** que o usuário deu, pelo IntegrateBrowser (`navegar {url, texto: true}`; PDF de datasheet abre
   igual). Tire: MPN, fabricante, o que a peça é (família), montagem (SMD/PTH), encapsulamento, o valor principal, os
   atributos e a **pinagem** (número, nome e tipo de cada pino). Sem fonte, pergunte. **Não invente número.**
3. **Pergunte as regras ao Odoo:** `local_regras {familia}`. Ele diz o que a família pede (valor, vias, polaridade,
   subtipo do cadastro, quais atributos) e as listas fechadas (famílias, encapsulamentos por montagem, subtipos,
   dielétrico, gênero, ângulo). Use **só** valores dessas listas. Pacote que a biblioteca do Odoo não tem: **avise o
   usuário para pedir o cadastro do pacote no Odoo**; não troque por um parecido. No CONECTOR o encapsulamento é
   texto livre (a série mecânica: `KK 2.54mm`).
4. **O símbolo:** `local_opcoes {tipo: "simbolos", busca, pinos}`. Achou um com a pinagem certa (confira os números
   dos pinos com o datasheet): use o nome. Não achou: `sym_gerar` com a lista de pinos do datasheet e
   `sym_salvar {destino: "biblioteca"}`, e use o nome dele.
5. **O footprint:** `local_opcoes {tipo: "footprints", busca}` (ou `fp_buscar`). Não achou: `fp_pacote` (o
   assistente: SOIC, QFN, SOT-23, barra de pinos...) ou `fp_salvar`, com as medidas do datasheet. Os números dos pads
   têm de ser os dos pinos do símbolo.
   **O footprint tem o 3D de verdade** (o STEP do fabricante, da biblioteca ou modelado no NexoCAD): nunca um corpo
   genérico (cubo/cilindro) nem sem 3D. O passo a passo está na skill `projeto-construir` (A regra do 3D).
6. **Crie:** `local_criar {componente: {x_familia, x_montagem, x_encapsulamento, x_mpn, ...}, simbolo, footprint,
   datasheet}`. A pinagem (`x_pinagem`) sai sozinha dos pinos do símbolo. Valor com o sufixo colado e ponto decimal
   (`4.7K`, `100nF`, `40V`); nos semicondutores o valor é a tensão principal (Vce, Vds, Vz, Vrrm), e corrente e
   potência vão nos atributos.
7. **Confira no Odoo:** `local_conferir {id}`. Ele responde `pronto`, `nome_previsto`, `faltas`, `erros`, `avisos`.
   Corrija com `local_editar` e confira de novo até `pronto: true`. Se o Odoo disser que a peça **já existe** (MPN +
   encapsulamento no cadastro), apague a local e use a do almoxarifado.
8. **Coloque no esquema** com o `comp` que o `local_listar` devolve (acrescente `x`, `y`) em `sch_adicionar`. O params
   leva `LocalId=Ln`: é ele que faz a linha ir com a ficha no Enviar para o Odoo.
9. **Diga ao usuário** o nome previsto, o que ficou pronto e o que dependeu de decisão (pacote a cadastrar, dado que o
   datasheet não trazia).

## O que NÃO fazer

- Não mande `name`, `default_code` nem `x_hub_uid` na ficha (o Odoo calcula).
- Não mande atributo que a família não pede: o Odoo recusa (ele não entraria no nome).
- Não fixe as listas: pergunte com `local_regras` (vale o que o Odoo responder hoje).
- Não renomeie um componente local já colocado em esquema: o nome é o `sym` gravado lá.
