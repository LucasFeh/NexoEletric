# NexoEletric (Rust)

O NexoEletric com a interface web de sempre, trocando por Rust **só o que media como gargalo**.

## O que mudou e por quê (medido na PRJ-DI161455: 231 componentes, 3.937 trilhas)

| gargalo medido no original | o que entrou no lugar |
|---|---|
| casca Electron (Node + Chromium próprio) | `crates/nexoeletric-web`: janela tao + **WebView2 do Windows** (wry), 3 MB |
| `hubserver.py` no caminho da abertura: Python sobe em ~1,8 s; `/api/index.json` reinterpreta o `board.js` de **todos** os projetos a cada pedido (285 ms com 20 projetos); `/api/project` reescreve a placa inteira (~130 ms) | `crates/nexo-hub`: servidor Rust no mesmo processo. Índice 2,5 ms e projeto ~2 ms, com resposta **idêntica** à do Python (conferida campo a campo) |
| vigia do ao vivo varrendo `Projects/` e `Libs/` a cada segundo (`os.walk`) | notificação do sistema (`ReadDirectoryChangesW`): custo zero parado |
| vista PCB: o Canvas 2D rasteriza milhares de caminhos a cada quadro | WebGL2 (`web/nexo-gl.js`) com a malha do **núcleo Rust em WASM** (`crates/nexo-wasm`), montada uma vez por mudança da placa; o 2D fica por cima com o que é interativo |
| vista PCB monta o 3D escondido ao abrir (three.js: ~2 s de CPU + centenas de MB de GPU) | a preferência que já existia ("3D pronto de antemão") passa a vir desligada; o 3D monta quando for aberto |
| 3D: a placa (contorno com ~2.400 furos) passava pelo earcut do three.js **três vezes** (ExtrudeGeometry + duas ShapeGeometry): ~750 ms | `nexo_core::solido` (WASM): uma triangulação (lyon) para as tampas, as faces pintadas e as paredes com normais — ~6 ms. Imagem 99,9% idêntica |
| 3D: o primeiro `render()` travava ~0,9 s compilando os shaders do three.js | `compileAsync` (KHR_parallel_shader_compile): compila em paralelo, fora da thread da página, antes do primeiro quadro |
| 3D com os componentes: cada face do STEP virava um grupo → **8.610 chamadas de desenho por quadro** (PRJ-UR, 130 corpos), 687 geometrias, normais suavizadas em JS | `nexo_core::step3d` (WASM): normais + triângulos reordenados por cor (um grupo por cor), esfera envolvente pronta e geometria compartilhada entre componentes iguais → **807 chamadas**, 262 geometrias; imagem 100% igual |
| 3D remontado INTEIRO a cada revisão da biblioteca da rede Nexo (3 vezes num minuto, parado) | só se a lista de corpos desta placa mudou, e então só os corpos |
| Real View: mapas das faces pixel a pixel em JS (~1 s) e leitura do canvas na GPU (0,2–4,7 s) | laço no WASM (mesmos bytes, 1,8× mais rápido) e o canvas da face na memória quando o Real View está ligado |
| 2D: na abertura, a malha da placa (e o cache de caminhos do Canvas 2D) eram montados na thread da página | a malha sai do WASM num **Web Worker** que nasce com a página; o cache do Canvas 2D só é montado se o desenho original for usado |

O que **não** era gargalo ficou como está: toda a interface (hub.html, esquema, PCB, BOM, Gerber, laser,
editores, roteadores, DRC...) e as rotas do `hubserver.py` que não estão no caminho de abrir/usar a placa
(Gerber, PDF, BOM, Odoo, almoxarifado, importar do Altium, biblioteca do Nexo Hub...). Essas vão a um
**Python de reserva**, que sobe em segundo plano no primeiro pedido, importado como módulo (sem o vigia
de varredura), numa porta livre, preso a um Job Object do Windows (morre com o app).

Os remendos da vista PCB são aplicados **ao servir** (`crates/nexo-hub/src/patches.rs`): a pasta de
trabalho não muda, e se um trecho não casar com a versão do hub, aquele remendo não entra e a vista
segue a original. O teste `remendos_casam_com_o_pcbframe_instalado` confere contra o NexoEletric instalado.

## Rodar

    cargo build --release -p nexoeletric-web
    cargo build --release -p nexo-wasm --target wasm32-unknown-unknown   (e copiar o .wasm para web/)
    target\release\NexoEletric.exe [--workspace C:\AltiumHub] [--projeto NOME] [--aba pcb]

Sem `--workspace`, usa a pasta de trabalho configurada no NexoEletric (Electron). Porta 8250 (a seguinte se
estiver ocupada: nunca toma a de outro programa). Grava o `~/.nexoeletric/session.json` do MCP só se
nenhum outro NexoEletric estiver aberto (`--sem-sessao` desliga).

## Ainda não portado da casca Electron
Sincronismo com o NexoBD/Nexo Hub (`armazem.js`, `nexohub-sync.js`), atualização automática, telas de
configuração/conexão/importar, e os itens de menu correspondentes (avisam "ainda não portado").

## Outros
- `crates/nexoeletric` (`NexoEletric-nativo.exe`): a primeira tentativa, vista PCB 100% nativa (egui + wgpu).
- `crates/nexo-core`: o núcleo (modelo da placa, `changes.js`, camadas, fonte, malha, seleção), usado pelos três.
- `bench/`: perfil (`perfil.mjs`), fotos (`captura-web.mjs`) e o comparativo (`comparar.ps1` + `medir.ps1` +
  `electron.mjs` + `resumo.py`). **Rode o lado Electron só com o NexoEletric da pessoa fechado.**
