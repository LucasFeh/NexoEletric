# NexoEletric (Rust)

Reescrita nativa do NexoEletric (hoje Electron + hub Python + UI web com Canvas 2D) em Rust,
com a vista PCB desenhada direto na GPU (wgpu). Trabalho em fases.

## Fase 1 (esta)
- `crates/nexo-core`: o modelo da placa `pcbmirror-v1` (board.js), a leitura dos arquivos .js do
  projeto sem executar nada, o motor de mudancas (changes.js: as ops do `applyPcbChanges` +
  `effectiveBoard` do hub-core.js), a tabela de camadas do Altium (cores e ordem de desenho), a
  fonte vetorial da serigrafia, a geometria, a malha para a GPU e a selecao (indice espacial).
- `crates/nexoeletric`: o app (eframe/egui + renderizador wgpu proprio): projetos, vista PCB,
  abas de camada como no Altium, Propriedades, lista de mudancas com ok/aviso/erro, realce de net
  (Ctrl+clique), camada unica (Shift+S), virar placa (B), recarga automatica quando o
  board.js/changes.js muda.

Ainda nao portado: esquema, BOM, Gerber/PDF, DRC, ratsnest, despejo de poligono (pour),
biblioteca de footprints (comp_add pega a geometria de um componente igual na placa), editores,
roteadores, 3D, NexoBD/Nexo Hub, MCP.

## Rodar
    cargo run --release -p nexoeletric -- "C:\AltiumHub\Projects\PRJ-DI161455"
    cargo test --release -p nexo-core

## Comparativo com o Electron
`bench/comparar.ps1` (CPU, memoria e GPU da arvore de processos inteira, fases abrir/parado/animando,
mesma camera nos dois). ATENCAO: o lado Electron sobe uma segunda instancia do NexoEletric
instalado; rode so com o NexoEletric da pessoa FECHADO (a instancia de teste compartilha o
~/.nexoeletric/session.json e ja derrubou o hub/app aberto).
