/* AltiumPCBMirror v2 - hub-menutrad.js — os menus do Altium em portugues.

   Pedido do dono (2026-10-14): os nomes dos menus mudam junto com o idioma do sistema
   (Configuracoes do hub » idioma, chave 'altiumhub.lang' do hub-i18n.js). Em ingles o menu e o
   do Altium, palavra por palavra; em pt-BR, esta tabela. Termos que o eletronico brasileiro usa
   em ingles no Altium (net, via, pad, footprint, polygon pour, room, teardrops, xSignals,
   jumper, union, snippet) ficam como estao.

   HubMenuTrad.idioma() -> 'pt-BR' | 'en';  HubMenuTrad.t(rotulo) -> o rotulo no idioma da vez. */
(function (raiz, fabrica) {
  const m = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.HubMenuTrad = m;
})(typeof self !== 'undefined' ? self : this, function () {
"use strict";

/* uma linha por rotulo: ingles|portugues */
const PT = `
0.025 mm|0,025 mm
0.100 mm|0,100 mm
0.250 mm|0,250 mm
0.500 mm|0,500 mm
1.000 mm|1,000 mm
2.500 mm|2,500 mm
2D Layout Mode|Modo de layout 2D
3D Body|Corpo 3D
3D Body Placement|Posicionamento de corpo 3D
3D Body Snap Points|Pontos de snap do corpo 3D
3D Layout Mode|Modo de layout 3D
3D View Control|Controle da vista 3D
90 Degree Rotation|Rotação de 90 graus
ASM Source Document|Documento fonte ASM
About...|Sobre...
Absolute Origin|Origem absoluta
Add C Code Entry|Adicionar entrada de código C
Add Coverlay|Adicionar coverlay
Add Designators for Assembly Drawing|Adicionar designadores ao desenho de montagem
Add Existing to Project...|Adicionar existente ao projeto...
Add Exporter...|Adicionar exportador...
Add Importer...|Adicionar importador...
Add Key Frame to 3D Movie|Adicionar quadro-chave ao filme 3D
Add New to Project|Adicionar novo ao projeto
Add Project to Version Control...|Adicionar projeto ao controle de versão...
Add Selected Nets to NetClass|Adicionar nets selecionadas à classe de nets
Add Selected Primitives to Component|Adicionar primitivas selecionadas ao componente
Add Shielding to Net...|Adicionar blindagem à net...
Add Snap Points From Vertices|Adicionar pontos de snap dos vértices
Add Stitching to Net...|Adicionar costura de vias à net...
Add Subnet Jumpers|Adicionar jumpers de sub-net
Add To Project|Adicionar ao projeto
Add to Version Control...|Adicionar ao controle de versão...
AdvancedSim Model|Modelo AdvancedSim
AdvancedSim Netlist|Netlist AdvancedSim
AdvancedSim Sub-Circuit|Subcircuito AdvancedSim
Align|Alinhar
Align Bottom|Alinhar pela base
Align Bottom (maintain spacing)|Alinhar pela base (manter espaçamento)
Align Face With Board|Alinhar a face com a placa
Align Horizontal Centers|Alinhar centros horizontais
Align Left|Alinhar à esquerda
Align Left (maintain spacing)|Alinhar à esquerda (manter espaçamento)
Align Right|Alinhar à direita
Align Right (maintain spacing)|Alinhar à direita (manter espaçamento)
Align To Grid|Alinhar à grade
Align Top|Alinhar pelo topo
Align Top (maintain spacing)|Alinhar pelo topo (manter espaçamento)
Align Vertical Centers|Alinhar centros verticais
Align...|Alinhar...
All|Tudo
All Locked|Tudo travado
All On Current Document|Tudo no documento atual
All Open Documents|Todos os documentos abertos
All Recent Documents and Projects|Todos os documentos e projetos recentes
All on Layer|Tudo na camada
All...|Tudo...
Angular|Angular
Annotate Compiled Sheets...|Anotar folhas compiladas...
Annotate Schematics Quietly...|Anotar esquemas silenciosamente...
Annotate Schematics...|Anotar esquemas...
Annotation|Anotação
Applicable Binary Rules...|Regras binárias aplicáveis...
Applicable Unary Rules...|Regras unárias aplicáveis...
Apply|Aplicar
Arc|Arco
Arc (Any Angle)|Arco (qualquer ângulo)
Arc (Center)|Arco (centro)
Arc (Edge)|Arco (borda)
Area|Área
Around Point|Em volta do ponto
Arrange All Windows Horizontally|Organizar janelas na horizontal
Arrange All Windows Vertically|Organizar janelas na vertical
Arrange Outside Board|Organizar fora da placa
Arrange Rooms|Organizar rooms
Arrange Within Rectangle|Organizar dentro do retângulo
Arrange Within Room|Organizar dentro da room
Assembly Outputs|Saídas de montagem
Assembly Drawings|Desenhos de montagem
Assign Net|Atribuir net
Auto Route|Roteamento automático
Automatic Cross References Settings|Configurar referências cruzadas automáticas
Automatic Length Tuning|Ajuste automático de comprimento
Automatic Net/Pin Optimizer...|Otimizador automático de net/pino...
Autoroute Component|Autorotear componente
Autoroute Room|Autorotear room
Axes|Eixos
Back Annotate Schematics...|Retroanotar esquemas...
Back Side|Lado de trás
Baseline|Linha de base
Bezier|Bézier
Blanket|Cobertura
Board|Placa
Board Information|Informações da placa
Board Insight|Board Insight
Board Insight Display...|Exibição do Board Insight...
Board Insight...|Board Insight...
Board Layers & Colors (View Options)...|Camadas e cores da placa (opções de vista)...
Board Level Annotate...|Anotar no nível da placa...
Board Planning Mode|Modo de planejamento da placa
Board Region|Região da placa
Board Shape|Forma da placa
Bottom Side|Lado de baixo
Break Track|Quebrar trilha
Break Wire|Quebrar fio
Break all objects Unions|Desfazer todas as unions
Break objects from Union|Tirar objetos da union
Bring To Front|Trazer para a frente
Bring To Front Of|Trazer para a frente de
Bring to front|Trazer para a frente
Browse Library...|Navegar na biblioteca...
Browse Objects|Navegar nos objetos
Browse Violations|Navegar nas violações
Bus|Barramento
Bus Entry|Entrada de barramento
Bus Joiner|Junção de barramento
C Code Symbol|Símbolo de código C
C Source Document|Documento fonte C
C++ Source Document|Documento fonte C++
C/C++ Header Document|Cabeçalho C/C++
CAM Document|Documento CAM
Center|Centro
Check In Whole Project...|Check-in do projeto inteiro...
Check In...|Check-in...
Check Out...|Check-out...
Classes...|Classes...
Clean All Nets...|Limpar todas as nets...
Clean Single Nets...|Limpar nets de um pino...
Clean Up|Limpeza
Clear|Limpar
Clear All Net Colors|Limpar todas as cores de net
Clear All Nets...|Limpar todas as nets...
Clear Filter|Limpar filtro
Clear Net Color|Limpar cor da net
Close|Fechar
Close All|Fechar tudo
Close Documents|Fechar documentos
Close Project|Fechar projeto
Close Project Documents|Fechar documentos do projeto
Combine Selected Polygons|Combinar polígonos selecionados
Command Status|Status de comando
Comment...|Comentário...
Commit Whole Project...|Commit do projeto inteiro...
Commit...|Commit...
Compare and Merge|Comparar e mesclar
Compile Current Project|Compilar o projeto atual
Compile Mask|Máscara de compilação
Component|Componente
Component 3D Body Manager...|Gerenciador de corpos 3D...
Component Actions|Ações do componente
Component Autoplace|Posicionamento automático
Component Class...|Classe de componentes...
Component Connections|Conexões do componente
Component Fast Place|Posicionamento rápido
Component Links...|Vínculos de componentes...
Component Nets|Nets do componente
Component Placement|Posicionamento de componentes
Component Rule Check|Verificar regras do componente
Component...|Componente...
Components Synchronization Configuration|Configuração de sincronização de componentes
Configuration Manager...|Gerenciador de configurações...
Configure Physical Nets...|Configurar nets físicas...
Configure Pin Swapping...|Configurar troca de pinos...
Configure Pin/Part Swapping...|Configurar troca de pino/parte...
Configure...|Configurar...
Connected Copper|Cobre conectado
Connection|Conexão
Connections|Conexões
Connections Between Selected Components|Conexões entre os componentes selecionados
Connections On Selected Components|Conexões nos componentes selecionados
Constraint File|Arquivo de restrições
Convert|Converter
Convert Cross Junctions|Converter junções em cruz
Convert Device Sheet To Schematic Sheet|Converter folha de dispositivo em folha de esquema
Convert Part To Ports|Converter parte em portas
Convert Part To Sheet Symbol|Converter parte em símbolo de folha
Convert Schematic Sheet To Device Sheet|Converter folha de esquema em folha de dispositivo
Convert Selected Free Pads to Vias|Converter pads livres selecionados em vias
Convert Selected Keepouts to Primitives|Converter keepouts selecionados em primitivas
Convert Selected Line to Bend Line|Converter linha selecionada em linha de dobra
Convert Selected Primitives to Keepouts|Converter primitivas selecionadas em keepouts
Convert Selected Tracks to Chamfered Path|Converter trilhas selecionadas em caminho chanfrado
Convert Selected Vias to Free Pads|Converter vias selecionadas em pads livres
Convert To STEP|Converter para STEP
Copy|Copiar
Copy As Text|Copiar como texto
Copy Room Formats|Copiar formatos de room
Coverlay Actions|Ações de coverlay
Create 3D Body From selected primitives|Criar corpo 3D das primitivas selecionadas
Create Board Cutout from Selected Primitives|Criar recorte da placa das primitivas selecionadas
Create Board Region from 3D body|Criar região da placa do corpo 3D
Create Board Region from Selected Object|Criar região da placa do objeto selecionado
Create Component From Sheet|Criar componente da folha
Create Cutout from Selected Primitives|Criar recorte das primitivas selecionadas
Create HDL File From Sheet Symbol|Criar arquivo HDL do símbolo de folha
Create NetClass from Selected Nets|Criar classe de nets das nets selecionadas
Create Netlist From Connected Copper...|Criar netlist do cobre conectado...
Create Non-Orthogonal Room from selected components|Criar room não ortogonal dos componentes selecionados
Create Orthogonal Room from selected components|Criar room ortogonal dos componentes selecionados
Create Polygon from Selected Primitives|Criar polígono das primitivas selecionadas
Create Primitives From Board Shape|Criar primitivas da forma da placa
Create Rectangle Room from selected components|Criar room retangular dos componentes selecionados
Create Region from Selected Primitives|Criar região das primitivas selecionadas
Create Room from Selected Primitives|Criar room das primitivas selecionadas
Create Sheet From Sheet Symbol|Criar folha do símbolo de folha
Create Sheet Symbol From Sheet|Criar símbolo de folha da folha
Create Snippet from selected objects|Criar snippet dos objetos selecionados
Create Snippet from union|Criar snippet da union
Create Union from selected objects|Criar union dos objetos selecionados
Create xSignal from selected pins|Criar xSignal dos pinos selecionados
Create xSignals|Criar xSignals
Create xSignals between components|Criar xSignals entre componentes
Create xSignals from connected nets|Criar xSignals das nets conectadas
Cross Probe|Sondagem cruzada
Cross Probe Next Message|Sondar a próxima mensagem
Cross Probe Previous Message|Sondar a mensagem anterior
Cross Select Mode|Modo de seleção cruzada
Current|Atual
Current Origin|Origem atual
Custom Parts Provider Synchronization Configuration|Configuração de sincronização do fornecedor de peças
Custom...|Personalizado...
Customize...|Personalizar...
Cut|Recortar
Cycle Snap Grid|Alternar grade de snap
Cycle Snap Grid (Reverse)|Alternar grade de snap (inverso)
Database Library|Biblioteca de banco de dados
Database Link File|Arquivo de vínculo de banco de dados
Decrease Horizontal Spacing|Diminuir espaçamento horizontal
Decrease Mask Level|Diminuir nível da máscara
Decrease Vertical Spacing|Diminuir espaçamento vertical
Default Prints...|Impressões padrão...
DeSelect|Desmarcar
Defaults...|Padrões...
Define Bending Line|Definir linha de dobra
Define Board Cutout|Definir recorte da placa
Define Board Shape from 3D body|Definir forma da placa pelo corpo 3D
Define Board Shape from Selected Objects|Definir forma da placa pelos objetos selecionados
Define Split Line|Definir linha de divisão
Delete|Apagar
Delete Split Line|Apagar linha de divisão
Deselect All In Union|Desmarcar tudo na union
Design|Design
Design Project Group|Grupo de projetos
Design Rule Check...|Verificação de regras (DRC)...
Design View|Vista de design
Device Sheet Symbol|Símbolo de folha de dispositivo
Differences|Diferenças
Differential Pair|Par diferencial
Dimension|Cota
Directives|Diretivas
Discard Local Changes|Descartar alterações locais
Discard Project Local Changes|Descartar alterações locais do projeto
Display...|Exibição...
Distribute Horizontally|Distribuir na horizontal
Distribute Vertically|Distribuir na vertical
Document Options...|Opções do documento...
Drag|Arrastar
Drag Selection|Arrastar seleção
Drag Track End|Arrastar ponta da trilha
Drawing Tools|Ferramentas de desenho
Drill Symbols...|Símbolos de furação...
Drill Table|Tabela de furos
Duplicate|Duplicar
EDIF Document|Documento EDIF
Edit|Editar
Edit Board Shape|Editar forma da placa
Edit Nets...|Editar nets...
Edit Polygon Shape|Editar forma do polígono
Edit Polygonal Room Vertices|Editar vértices da room poligonal
Ellipse|Elipse
Elliptical Arc|Arco elíptico
Embedded|Embarcado
Embedded Board Array/Panelize|Painelização / matriz de placas
Enable Basic Script Unit|Habilitar unidade Basic Script
Equalize Net Lengths|Igualar comprimentos das nets
Error Marker|Marcador de erro
Examples|Exemplos
Exit|Sair
Explode Bend Line|Explodir linha de dobra
Explode Board Cutout to Free Primitives|Explodir recorte da placa em primitivas livres
Explode Component to Free Primitives|Explodir componente em primitivas livres
Explode Coordinate to Free Primitives|Explodir coordenada em primitivas livres
Explode Dimension to Free Primitives|Explodir cota em primitivas livres
Explode Length Tuning To Free Primitives|Explodir ajuste de comprimento em primitivas livres
Explode OLE Object To Free Primitives|Explodir objeto OLE em primitivas livres
Explode Polygon to Free Primitives|Explodir polígono em primitivas livres
Explode Rectangle to Free Primitives|Explodir retângulo em primitivas livres
Explode Region to Free Primitives|Explodir região em primitivas livres
Explode To Free Primitives|Explodir em primitivas livres
Exploring %PRODUCTNAME%|Explorando o %PRODUCTNAME%
Export|Exportar
Export Configuration...|Exportar configuração...
Export Mechanical Layers...|Exportar camadas mecânicas...
Extruded 3D Body|Corpo 3D extrudado
FPGA Signal Manager...|Gerenciador de sinais FPGA...
FPGA Third Party IP Import...|Importar IP de terceiros (FPGA)...
FPGA To PCB Project Wizard|Assistente FPGA para PCB
FPGA Workspace Map...|Mapa do espaço FPGA...
Fabrication Outputs|Saídas de fabricação
Fanout|Fanout
Fanout Component|Fanout do componente
Favorite Routing Widths...|Larguras favoritas de roteamento...
File|Arquivo
Files Panel|Painel de arquivos
Fill|Fill
Filter|Filtro
Filter For:|Filtrar por:
Filtered|Filtrados
Filtered Objects|Objetos filtrados
Find Next|Localizar próximo
Find Similar Objects|Localizar objetos semelhantes
Find Similar Objects...|Localizar objetos semelhantes...
Find Text...|Localizar texto...
Finite State Machine Document|Documento de máquina de estados
Fit All Objects|Enquadrar todos os objetos
Fit Board|Enquadrar a placa
Fit Document|Enquadrar o documento
Fit Selected|Enquadrar a seleção
Flip Board|Virar a placa
Flip Selected Sheet Symbols Along X|Espelhar símbolos de folha em X
Flip Selected Sheet Symbols Along Y|Espelhar símbolos de folha em Y
Flip Selection|Virar a seleção
Flipped Isometric View|Vista isométrica invertida
Fold/Unfold|Dobrar/desdobrar
Footprint Manager...|Gerenciador de footprints...
Footprint Origins|Origens dos footprints
Force Annotate All Schematics...|Forçar anotação de todos os esquemas...
Free Objects|Objetos livres
Freeze 3D Visualisation|Congelar visualização 3D
Front Side|Lado da frente
Full Circle|Círculo completo
Full Screen|Tela cheia
Generic No ERC|No ERC genérico
Gerber Files|Arquivos Gerber
Gerber (.zip)|Gerber (.zip)
Gloss Selected|Alisar seleção
Graphic...|Imagem...
Graphics|Imagem
Grid Properties|Propriedades da grade
Grids|Grades
Guides|Guias
Halt Compilation|Interromper compilação
Harness|Harness
Harness Connector|Conector de harness
Harness Entry|Entrada de harness
Help|Ajuda
Hide All|Ocultar tudo
Hide All Jumpers|Ocultar todos os jumpers
Hide Component Jumpers|Ocultar jumpers do componente
Hide Component Nets|Ocultar nets do componente
Hide Connections|Ocultar conexões
Hide Jumpers|Ocultar jumpers
Hide Net|Ocultar net
Hide Net Jumpers|Ocultar jumpers da net
Hide Nets|Ocultar nets
History|Histórico
Home|Início
Import|Importar
Import Changes From FPGA Project...|Importar alterações do projeto FPGA...
Import Changes...|Importar alterações...
Import FPGA Pin File|Importar arquivo de pinos FPGA
Import Mechanical Layers...|Importar camadas mecânicas...
Import Wizard|Assistente de importação
In|Aproximar
Increase Horizontal Spacing|Aumentar espaçamento horizontal
Increase Mask Level|Aumentar nível da máscara
Increase Vertical Spacing|Aumentar espaçamento vertical
Increment Part Number|Incrementar número da parte
Inside Area|Dentro da área
Integrated Library|Biblioteca integrada
Interactive Diff Pair Length Tuning|Ajuste interativo de comprimento de par diferencial
Interactive Differential Pair Routing|Roteamento interativo de par diferencial
Interactive Differential-Pair Swapping|Troca interativa de pares diferenciais
Interactive Length Tuning|Ajuste interativo de comprimento
Interactive Multi-Routing|Multirroteamento interativo
Interactive Part Swapping|Troca interativa de partes
Interactive Pin/Net Swapping|Troca interativa de pino/net
Interactive Routing|Roteamento interativo
Interactive TASKING Pin/Net Swapping|Troca interativa TASKING de pino/net
Intersections|Interseções
Isometric View|Vista isométrica
Item Manager...|Gerenciador de itens...
Java Script Form|Formulário Java Script
Java Script Unit|Unidade Java Script
Jump|Ir para
Jump Component|Ir para componente
Jumpers|Jumpers
Keepout|Keepout
Lasso Deselect|Desmarcar com laço
Lasso Select|Selecionar com laço
Last|Último
Layer Stack Manager...|Gerenciador de camadas (stackup)...
Layer Stack Table|Tabela de stackup
Leader|Chamada
Left Edge|Borda esquerda
Library|Biblioteca
Library Migrator|Migrador de bibliotecas
Licensing|Licenciamento
Line|Linha
Linear|Linear
Linear Diameter|Diâmetro linear
Link Project To Server...|Vincular projeto ao servidor...
Local|Local
Local History|Histórico local
Location Marks|Marcas de posição
Lock...|Travar...
Make Available Online...|Disponibilizar online...
Make Available on Server...|Disponibilizar no servidor...
Make Integrated Library|Gerar biblioteca integrada
Make PCB Library|Gerar biblioteca PCB
Make Schematic Library|Gerar biblioteca de esquema
Manage 3D Bodies|Gerenciar corpos 3D
Manage Layer Sets|Gerenciar conjuntos de camadas
Manage Testbenches...|Gerenciar testbenches...
Measure 3D Objects|Medir objetos 3D
Measure Distance|Medir distância
Measure Distances|Medir distâncias
Measure Primitives|Medir primitivas
Measure Selected Objects|Medir objetos selecionados
Merge|Mesclar
Migrate Project to Altium Versioned Storage...|Migrar projeto para armazenamento versionado...
Mixed-Signal Simulation|Simulação de sinais mistos
Modify Board Shape|Modificar forma da placa
Modify Polygon Border|Modificar contorno do polígono
More 3D Movies...|Mais filmes 3D...
More Windows...|Mais janelas...
More...|Mais...
Mouse Configuration...|Configuração do mouse...
Move|Mover
Move / Resize Tracks|Mover / redimensionar trilhas
Move All Components Origin To Grid|Mover a origem de todos os componentes para a grade
Move Board|Mover a placa
Move Board Shape|Mover a forma da placa
Move Component|Mover componente
Move Component Origin To Grid|Mover a origem do componente para a grade
Move Down|Mover para baixo
Move Left|Mover para a esquerda
Move Polygon|Mover polígono
Move Right|Mover para a direita
Move Room|Mover room
Move Rooms To Grid|Mover rooms para a grade
Move Selected Subcircuit to Different Sheet|Mover subcircuito selecionado para outra folha
Move Selection|Mover seleção
Move Selection by X, Y...|Mover seleção por X, Y...
Move Texture Location|Mover posição da textura
Move To Front|Mover para a frente
Move Up|Mover para cima
Multi-board Assembly|Montagem multiplaca
Multi-board Schematic|Esquema multiplaca
NC Drill Files|Arquivos de furação (NC Drill)
Navigate Next Difference|Próxima diferença
Navigate Previous Difference|Diferença anterior
Net|Net
Net Actions|Ações da net
Net Class...|Classe de nets...
Net Label|Rótulo de net
Net...|Net...
Netlist|Netlist
Netlist For Document|Netlist do documento
Netlist For Project|Netlist do projeto
Netlist Status|Status da netlist
New|Novo
New Location...|Nova posição...
New in %PRODUCTNAME%|Novidades do %PRODUCTNAME%
Note|Nota
Number Schematic Sheets...|Numerar folhas do esquema...
Object From File|Objeto de arquivo
Objects for snapping|Objetos para snap
Off Grid Pads|Pads fora da grade
Off Sheet Connector|Conector fora da folha
On Component|No componente
Open Project Group...|Abrir grupo de projetos...
Open Project...|Abrir projeto...
Open...|Abrir...
OpenBus System Document|Documento de sistema OpenBus
Optimize Component Rotation|Otimizar rotação dos componentes
Options|Opções
Ordinate|Ordenada
Organize Favorites...|Organizar favoritos...
Orient And Position 3D Body|Orientar e posicionar corpo 3D
Origin|Origem
Orthogonal Rotation|Rotação ortogonal
Other|Outro
Out|Afastar
Outline Selected Objects|Contornar objetos selecionados
Output Job File|Arquivo Output Job
Outside Area|Fora da área
PCB|PCB
PCB Library|Biblioteca PCB
PCB Release View|Vista de liberação da PCB
PCB To FPGA Project Wizard|Assistente PCB para FPGA
PCB3D Library|Biblioteca PCB3D
PDF (layout)|PDF (layout)
Pad|Pad
Pad Centers|Centros de pad
Pad Edges|Bordas de pad
Pad Vertices|Vértices de pad
Pad Via Library|Biblioteca de pads e vias
Pad...|Pad...
Page Setup...|Configurar página...
Panels|Painéis
Parameter Manager...|Gerenciador de parâmetros...
Parameter Set|Conjunto de parâmetros
Part...|Parte...
Paste|Colar
Paste Special...|Colar especial...
Paste Text|Colar texto
Pause|Pausar
Physical Connection|Conexão física
Physical Connection Single Layer|Conexão física em uma camada
Pin/Part Swapping|Troca de pino/parte
Place|Colocar
Place +45 Degree Guide|Colocar guia de +45 graus
Place -45 Degree Guide|Colocar guia de -45 graus
Place Coverlay Cutout|Colocar recorte de coverlay
Place Coverlay Polygon|Colocar polígono de coverlay
Place From File...|Colocar a partir de arquivo...
Place Horizontal Guide|Colocar guia horizontal
Place Point Guide|Colocar guia de ponto
Place Polygonal Room|Colocar room poligonal
Place Rectangular Room|Colocar room retangular
Place Vertical Guide|Colocar guia vertical
Point|Ponto
Polygon|Polígono
Polygon Actions|Ações do polígono
Polygon Manager|Gerenciador de polígonos
Polygon Pour Cutout|Recorte de polygon pour
Polygon Pour...|Polygon pour...
Polygon Pours|Polygon pours
Port|Porta
Port Cross Reference|Referência cruzada de portas
Position 3D Body|Posicionar corpo 3D
Position Component Text...|Posicionar texto do componente...
Power Plane Nets...|Nets de plano de alimentação...
Power Port|Porta de alimentação
Predefined Harness Connector|Conector de harness predefinido
Preferences...|Preferências...
Print Preview...|Visualizar impressão...
Print...|Imprimir...
Project|Projeto
Project Documents...|Documentos do projeto...
Project Options...|Opções do projeto...
Project Order...|Ordem dos projetos...
Project Packager...|Empacotador de projeto...
Project Releaser...|Liberador de projeto...
Project Reports|Relatórios do projeto
Project...|Projeto...
Properties...|Propriedades...
Push|Push
Push Part to Sheet|Enviar parte para a folha
Quick Differential Pair Routing|Roteamento rápido de par diferencial
Quick Routing|Roteamento rápido
Radial|Radial
Radial Diameter|Diâmetro radial
Re-Annotate...|Reanotar...
Re-Route|Rerrotear
Rebuild Split Planes on All Layers|Refazer planos divididos em todas as camadas
Rebuild Split Planes on Current Layer|Refazer planos divididos na camada atual
Recall|Recuperar
Recall Plus|Recuperar e somar
Recent Documents|Documentos recentes
Recent Project Groups|Grupos de projetos recentes
Recent Projects|Projetos recentes
Rectangle|Retângulo
Redefine Board Shape|Redefinir forma da placa
Redo|Refazer
Refactor|Refatorar
References|Referências
Refresh|Atualizar
Regions/Polygons/Fills|Regiões/polígonos/fills
Release Project To Server...|Liberar projeto no servidor...
Remove Coverlay|Remover coverlay
Remove Current Template...|Remover o template atual...
Remove From Project|Remover do projeto
Remove Selected Nets from NetClass|Remover nets selecionadas da classe
Remove Snap Points|Remover pontos de snap
Remove Subnet Jumpers|Remover jumpers de sub-net
Remove Unused Pad Shapes...|Remover formas de pad não usadas...
Remove Via Shielding Group|Remover grupo de blindagem de vias
Remove Via Stitching Group|Remover grupo de costura de vias
Remove from Project...|Remover do projeto...
Remove from Version Control...|Remover do controle de versão...
Rename Child Sheet...|Renomear folha filha...
Replace Text...|Substituir texto...
Report 1|Relatório 1
Report 2|Relatório 2
Reports|Relatórios
Reposition Selected Components|Reposicionar componentes selecionados
Repour All|Redespejar todos
Repour Modified|Redespejar modificados
Repour Selected|Redespejar selecionados
Repour Violating Polygons|Redespejar polígonos com violação
Reset|Redefinir
Reset Duplicate Schematic Designators...|Redefinir designadores duplicados...
Reset Error Markers|Limpar marcadores de erro
Reset Schematic Designators...|Redefinir designadores do esquema...
Resets Heads Up Delta Origin|Zerar origem delta do Heads Up
Resize Polygon|Redimensionar polígono
Resize Union|Redimensionar union
Resolve Conflicts|Resolver conflitos
Restore Polygons|Restaurar polígonos
Retrace Selected|Retraçar seleção
Reverse Selected Sheet Entries Order|Inverter ordem das entradas de folha
Revert Local Modifications|Reverter modificações locais
Right Edge|Borda direita
Room|Room
Room Actions|Ações da room
Room Connections|Conexões da room
Rooms|Rooms
Rotate Down|Girar para baixo
Rotate Left|Girar à esquerda
Rotate Right|Girar à direita
Rotate Selection|Girar seleção
Rotate Selection Clockwise|Girar seleção no sentido horário
Rotate Selection...|Girar seleção...
Rotate Up|Girar para cima
Round Rectangle|Retângulo arredondado
Round coordinates of objects...|Arredondar coordenadas dos objetos...
Route|Rotear
Routing Options...|Opções de roteamento...
Rule Wizard...|Assistente de regras...
Rules...|Regras...
Run Script...|Executar script...
Run xSignals Wizard|Executar assistente de xSignals
SVN Database Library|Biblioteca de banco de dados SVN
Save|Salvar
Save All|Salvar tudo
Save As Managed Sheet to Server...|Salvar como folha gerenciada no servidor...
Save As...|Salvar como...
Save Copy As...|Salvar cópia como...
Save Project As Template to Server...|Salvar projeto como template no servidor...
Save Project As...|Salvar projeto como...
Save Project Group As...|Salvar grupo de projetos como...
Save to Server...|Salvar no servidor...
Save to TC2...|Salvar no TC2...
Schematic|Esquema
Schematic Library|Biblioteca de esquema
Script|Script
Script Form|Formulário de script
Script Project|Projeto de script
Script Unit|Unidade de script
Select|Selecionar
Select All In Union|Selecionar tudo na union
Select Component Connections|Selecionar conexões do componente
Select Component Nets|Selecionar nets do componente
Select PCB Components|Selecionar componentes da PCB
Select Room Connections|Selecionar conexões da room
Select next|Selecionar próximo
Select overlapped|Selecionar sobreposto
Select...|Selecionar...
Selected|Selecionados
Selected Components|Componentes selecionados
Selected Objects|Objetos selecionados
Selection|Seleção
Selection Memory|Memória de seleção
Send Interactive Routing Debug Report|Enviar relatório de depuração do roteamento
Send To Back|Enviar para trás
Send To Back Of|Enviar para trás de
Send to back|Enviar para trás
Server|Servidor
Set|Definir
Set Body Height|Definir altura do corpo
Set Global Snap Grid...|Definir grade de snap global...
Set Location Marks|Definir marcas de posição
Set Net Colors|Definir cores de net
Set Snap Grid...|Definir grade de snap...
Set Template from server...|Definir template do servidor...
Setup...|Configurar...
Share...|Compartilhar...
Sheet Entry|Entrada de folha
Sheet Symbol|Símbolo de folha
Sheet Templates|Templates de folha
Sheet...|Folha...
Shelve All|Guardar todos
Shelve Polygons|Guardar polígonos
Shelve Selected|Guardar selecionados
Shortcut Keys|Teclas de atalho
Show All|Mostrar tudo
Show All Jumpers|Mostrar todos os jumpers
Show All Violations...|Mostrar todas as violações...
Show Component In Server|Mostrar componente no servidor
Show Component Jumpers|Mostrar jumpers do componente
Show Component Nets|Mostrar nets do componente
Show Connections|Mostrar conexões
Show Differences...|Mostrar diferenças...
Show Jumpers|Mostrar jumpers
Show Local History...|Mostrar histórico local...
Show Net|Mostrar net
Show Net Color Override|Mostrar cores de net
Show Net Jumpers|Mostrar jumpers da net
Show Nets|Mostrar nets
Show Physical Differences...|Mostrar diferenças físicas...
Show in Explorer|Mostrar no Explorer
Show in Web Browser|Mostrar no navegador
Show/Hide Difference Overlay|Mostrar/ocultar sobreposição de diferenças
Signal Harness|Harness de sinal
Signal Nets...|Nets de sinal...
SimModel File|Arquivo SimModel
Simulate|Simular
Simulator|Simulador
Slice Board Region|Fatiar região da placa
Slice Polygon Pour|Fatiar polygon pour
Slice Room|Fatiar room
Slice Tracks|Fatiar trilhas
Slice and Create Classes|Fatiar e criar classes
Smart PDF...|Smart PDF...
Smart Paste...|Colagem inteligente...
Snap Grid|Grade de snap
Snap Grid X|Grade de snap X
Snap Grid Y|Grade de snap Y
Snippets|Snippets
Software Platform Document|Documento de plataforma de software
Solid Region|Região sólida
Split Planes|Planos divididos
Stackup Compatibility Report|Relatório de compatibilidade de stackup
Standard|Padrão
Status Bar|Barra de status
Stop|Parar
Storage Manager...|Gerenciador de armazenamento...
Store|Guardar
Store Plus|Guardar e somar
String|Texto
String...|Texto...
Subtract Polygons From Selected|Subtrair polígonos dos selecionados
Swap Components|Trocar componentes
Swap Selected Sheet Entries Sides|Trocar lado das entradas de folha
Synchronize Sheet Entries and Ports|Sincronizar entradas de folha e portas
TASKING PinSwap|TASKING PinSwap
TCL Script Unit|Unidade de script TCL
Teardrops...|Teardrops...
Test Graphics System|Testar sistema gráfico
Testpoint Manager...|Gerenciador de pontos de teste...
Text Document|Documento de texto
Text Frame|Quadro de texto
Text String|Texto
Texts|Textos
Tile|Lado a lado
Tile Horizontally|Lado a lado na horizontal
Tile Vertically|Lado a lado na vertical
Toggle All Sheet Entry IO Type In Selected Sheet Symbols|Alternar tipo de E/S de todas as entradas de folha
Toggle Component Comment|Mostrar/ocultar comentário do componente
Toggle Component Designator|Mostrar/ocultar designador do componente
Toggle Electrical Grid|Alternar grade elétrica
Toggle Heads Up Delta Origin|Alternar origem delta do Heads Up
Toggle Heads Up Display|Alternar Heads Up Display
Toggle Heads Up Tracking|Alternar rastreio do Heads Up
Toggle Object Hotspot Snapping|Alternar snap nos pontos dos objetos
Toggle Primitive Lock|Travar/destravar primitiva
Toggle Resolved|Alternar resolvido
Toggle Selected Sheet Entries IO Type|Alternar tipo de E/S das entradas selecionadas
Toggle Selection|Inverter seleção
Toggle Units|Alternar unidades
Toggle Visible Grid|Mostrar/ocultar grade
Toggle Visible Grid Kind|Alternar tipo de grade visível
Toolbars|Barras de ferramentas
Tools|Ferramentas
Top Side|Lado de cima
Touching Line|Tocando a linha
Touching Rectangle|Tocando o retângulo
Track|Trilha
Track/Arcs Lines|Linhas de trilha/arco
Track/Arcs Vertices|Vértices de trilha/arco
TrueType Fonts Options...|Opções de fontes TrueType...
Un-Route|Desrotear
Underlined Connections|Conexões sublinhadas
Undo|Desfazer
Unions|Unions
Unlock|Destravar
Unroute Component|Desrotear componente
Unroute Room|Desrotear room
Up/Down Hierarchy|Subir/descer na hierarquia
Update|Atualizar
Update Current Template...|Atualizar o template atual...
Update Free Primitives From Component Pads...|Atualizar primitivas livres pelos pads...
Update From Libraries...|Atualizar das bibliotecas...
Update From PCB Libraries...|Atualizar das bibliotecas PCB...
Update Parameters From Database...|Atualizar parâmetros do banco de dados...
Update Schematic...|Atualizar o esquema...
Update Selected From Libraries...|Atualizar selecionados das bibliotecas...
Update Whole Project...|Atualizar o projeto inteiro...
User Forums|Fóruns de usuários
VB Script Form|Formulário VB Script
VB Script Unit|Unidade VB Script
VHDL Document|Documento VHDL
VHDL Library|Biblioteca VHDL
VHDL TestBench|TestBench VHDL
Variants...|Variantes...
Vendor Constraint File|Arquivo de restrições do fabricante
Verilog Document|Documento Verilog
Verilog Library|Biblioteca Verilog
Verilog TestBench|TestBench Verilog
Version Control|Controle de versão
Via|Via
Via Centers|Centros de via
Via Stitching/Shielding|Costura/blindagem de vias
View|Exibir
View Area|Ver área
Violations|Violações
Window|Janela
Wire|Fio
Work Guides|Guias de trabalho
Workspace|Espaço de trabalho
Wrap Non-Orthogonal Room Around Components|Envolver componentes com room não ortogonal
Wrap Orthogonal Room Around Components|Envolver componentes com room ortogonal
Wrap Rectangular Room Around Components|Envolver componentes com room retangular
Zero Rotation|Rotação zero
Zoom|Zoom
Zoom In|Aproximar
Zoom Last|Zoom anterior
Zoom Out|Afastar
`;
const DIC = new Map();
for (const l of PT.split('\n')) { const i = l.indexOf('|'); if (i > 0) DIC.set(l.slice(0, i), l.slice(i + 1)); }

/* o idioma do hub-i18n.js: o gravado; sem nada gravado, o do navegador (pt -> pt-BR) */
function idioma() {
  let v = null;
  try { v = localStorage.getItem('altiumhub.lang'); } catch (e) {}
  if (v === 'pt-BR' || v === 'en') return v;
  const nav = (typeof navigator !== 'undefined' && navigator.language || '').toLowerCase();
  return nav.startsWith('en') ? 'en' : 'pt-BR';
}
function t(rot) {
  if (idioma() === 'en') return rot;
  return DIC.get(rot) || rot;
}
return { idioma, t, DIC };
});
