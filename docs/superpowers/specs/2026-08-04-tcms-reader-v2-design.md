# TCMS_Reader_V2 — Leitor universal de barramentos (design)

Data: 2026-08-04 · Status: aprovado pelo usuário (painel de decisões desta sessão)

## Objetivo

Nova versão do TCMS_Reader: uma placa quadrada 80×80 mm com ESP32 que lê os
barramentos de comunicação mais comuns por um conector de entrada genérico, com
serigrafia descritiva e todos os jumpers documentados. Projeto novo em
`Projects\TCMS_Reader_V2\` (o v1 fica intacto).

Decisões do usuário: CAN com pinos reservados + header para módulo (transceiver entra
na lib depois); extras RS-232 (DB9), SPI 3V3, 1-Wire e I2C isolado (ISO1540); entrada
genérica em borne Phoenix MSTB 12 vias; placa 80×80 mm. Adição posterior: **Ethernet
via módulo W5500 (SPI) no CN7** — RMII/LAN8720 foi descartado porque tomaria os pinos
já usados pelos outros barramentos (IO19/21/22/25/26/27 + strap IO0).

## Restrição de contrato

Todo componente usa símbolo de `Libs\schlib.js` + footprint de `Libs\pcblib.js`
(BuildSchematic só resolve nessas libs — confirmado em `BuildSchematic.pas`). Os
componentes MFG do v1 (SN65HVD75, MAX3051, SM712) não existem no espelho e por isso
**não** são usados.

## Blocos

- **ESP32 DEV KIT** (30 pinos, footprint `ESP32-DEVKITV1_BOARD`): programação e
  monitor pela USB do próprio devkit.
- **RS-485 / Modbus RTU**: MAX485CPA (DIP8, 5 V) na UART2. RO (5 V) chega ao ESP32
  por divisor resistivo 1k/2k2; DI/DE aceitam 3V3 direto. DE+R̄Ē juntos no IO4 com
  pull-down 10k (placa nasce ouvindo). Terminador 120 Ω em série com jumper J1 entre
  A e B; TVS bidirecional em A e em B.
- **CAN (reservado)**: TWAI no IO25/IO26 levado ao header CN5 (2x3) junto com
  3V3/GND/CANH/CANL — espeta-se um módulo transceiver (ex. SN65HVD230) até o CI
  entrar na lib + ExportLibs. CANH/CANL do borne já têm TVS e terminador 120 Ω com
  jumper J2.
- **I2C isolado**: ISO1540 entre o ESP32 (lado 1: 3V3, pull-ups 4k7 fixos) e o
  conector CN3 (lado 2). O lado externo é alimentado pelo equipamento alvo via
  VEXT/GND-EXT (3,0–5,5 V) — isolação galvânica e nível automático (3V3 ou 5V).
  Pull-ups externos 4k7 chaveados por J3.
- **UART TTL 3V3**: UART1 — TX=IO27 no borne (pino 10) e no MAX3232; RX=IO34
  selecionado por J5 (3 pinos): ou borne TTL (pino 9) ou RS-232.
- **RS-232**: MAX3232 (3V3) + DB9 fêmea (CN6): pino 3 do DB9 → R1IN, T1OUT → pino 2,
  pino 5 = GND (cabo direto de PC funciona).
- **SPI 3V3**: header 2x3 CN4 com VSPI (SCK=IO18, MISO=IO19, MOSI=IO23, CS=IO5) +
  3V3/GND. Sem componente extra.
- **1-Wire**: IO32 no borne (pino 11) com pull-up 4k7 chaveado por J4.
- **Ethernet (módulo)**: borne CN7 (MSTB 8 vias) para módulo W5500 — compartilha o
  VSPI (SCK/MISO/MOSI) com CS dedicado IO33, INT no IO35 (input-only, perfeito para
  interrupção) e RST no IO14. RJ45/magnetics ficam no próprio módulo.
- **Alimentação**: USB do devkit OU borne CN2 (5 V) com Schottky D1 anti-inversão no
  VIN; 100 µF eletrolítico + LED verde de power no 3V3.
- **Fixação**: 4× `Parafuso Aterrado` (furo aterrado) nas laterais da placa.

## Pinout do borne principal CN1 (MSTB 2,5/12, passo 5.08)

| Pino | Sinal | Pino | Sinal |
|---|---|---|---|
| 1 | GND | 7 | CANH |
| 2 | 5V (saída) | 8 | CANL |
| 3 | 3V3 (saída) | 9 | RX-TTL (entra no ESP32) |
| 4 | RS-485 A | 10 | TX-TTL (sai do ESP32) |
| 5 | RS-485 B | 11 | 1-WIRE |
| 6 | GND | 12 | GND |

Demais conectores: CN2 = [1: +5V, 2: GND]; CN3 = [1: VEXT, 2: SDA, 3: SCL,
4: GND-EXT] (domínio isolado!); CN4 SPI = [1: SCK, 2: CS, 3: MISO, 4: 3V3, 5: MOSI,
6: GND]; CN5 CAN = [1: CAN-TX, 2: CAN-RX, 3: 3V3, 4: GND, 5: CANH, 6: CANL];
CN6 = DB9 fêmea RS-232; CN7 ETHERNET (módulo W5500) = [1: 3V3, 2: GND, 3: SCK,
4: MISO, 5: MOSI, 6: CS (IO33), 7: INT (IO35), 8: RST (IO14)].

## Jumpers (tudo isso vira texto no esquema e serigrafia na PCB)

| Jumper | Fechado | Aberto |
|---|---|---|
| J1 | terminador 120 Ω entre A-B (placa no fim da linha Modbus) | sem terminação |
| J2 | terminador 120 Ω entre CANH-CANL | sem terminação |
| J3 | pull-ups 4k7 do I2C externo alimentados por VEXT | barramento alvo já tem pull-ups |
| J4 | pull-up 4k7 no 1-WIRE | barramento alvo já tem pull-up |
| J5 (3 pinos) | 1-2: RX1 escuta o borne TTL (pino 9) · 2-3: RX1 escuta o RS-232 (DB9) | nunca fechar os dois |

## Mapa de pinos do ESP32

IO16=RX2 (485, pós-divisor) · IO17=TX2 (485 DI) · IO4=DE/R̄Ē · IO25=CAN-TX ·
IO26=CAN-RX · IO21=SDA · IO22=SCL · IO27=TX1 (TTL/RS-232) · IO34=RX1 (via J5) ·
IO32=1-WIRE · IO18/IO19/IO23/IO5=SPI · IO33=CS Ethernet · IO35=INT Ethernet ·
IO14=RST Ethernet · VIN=nó 5V · Livres p/ expansão: IO1, IO2, IO3, IO12, IO13,
IO15, VP(IO36), VN(IO39), EN.

## BOM (símbolo da lib → footprint)

| Ref | Símbolo (schlib.js) | Footprint (pcblib.js) | Comment |
|---|---|---|---|
| IC1 | ESP32 DEV KIT | ESP32-DEVKITV1_BOARD | ESP32 DevKit 30p |
| IC2 | MAX485CPA | DIP8 | MAX485 5V |
| IC3 | MAX3232 | SOIC NARROW | MAX3232 3V3 |
| IC4 | ISO 1540D | ISO1540D | ISO1540 |
| D1 | DIODO [ Schottky ] PTH | DO-201AD-COMPACT | 1N5822 |
| D2-D5 | DIODO [ SUPRESSOR DE TRANSIENTE BIDIRECIONAL ] SMD | SOD-323 | TVS bidirecional (A, B, CANH, CANL) |
| LED1 | LED | LED 5MM - GREEN | POWER |
| R1, R2 | RES [ SMD ] | RES 1206 | 120R 1% (terminadores) |
| R3 | RES [ SMD ] | RES 0805 | 1k (divisor RO) |
| R4 | RES [ SMD ] | RES 0805 | 2k2 (divisor RO) |
| R5 | RES [ SMD ] | RES 0805 | 10k (DE pull-down) |
| R6-R10 | RES [ SMD ] | RES 0805 | 4k7 (I2C ×4, 1-Wire) |
| R11 | RES [ SMD ] | RES 0805 | 1k (LED) |
| C1-C8 | CAP [  SMD  ] | CAP 0805 | 100nF |
| C9 | CAP EL [  PTH  ] | CAP EL 3mm L15 D8 | 100uF/16V |
| CN1 | CONECTOR PADRÃO (parts 1-12) | CONE MSTBH 2,5/ 12 GF | BARRAMENTOS |
| CN2 | CONECTOR PADRÃO (parts 1-2) | CONE MSTBH 2,5/ 2 GF | 5V IN |
| CN3 | CONECTOR PADRÃO (parts 1-4) | CONE MSTBH 2,5/ 4 GF | I2C ISOLADO |
| CN4 | CONECTOR PADRÃO (parts 1-6) | CONECTOR HEADER 6 VIAS VERTICAL - 2 ROWS | SPI 3V3 |
| CN5 | CONECTOR PADRÃO (parts 1-6) | CONECTOR HEADER 6 VIAS VERTICAL - 2 ROWS | MODULO CAN |
| CN6 | DB9 | DB9 PCI | RS-232 |
| CN7 | CONECTOR PADRÃO (parts 1-8) | CONE MSTBH 2,5/ 8 GF | MODULO ETHERNET W5500 |
| J1-J4 | Jumper 2 Vias | JUMPER 2 VIAS PTH | ver tabela de jumpers |
| J5 | Jumper 3q | JUMPER_3VIAS | RX1: TTL ou RS-232 |
| MH1-MH4 | Parafuso Aterrado | Furo GND | fixação lateral |

Crosscheck pinos↔pads já feito via extração das libs: todos os pares acima batem
(`pins[].num` ⊆ `pads[].name`). O nome `CONECTOR PADRÃO` vai escapado
(`PADRÃO`) — o parser do BuildSchematic resolve `\uXXXX` (JGet).

## Redes

GND · 5v · 3v3 (convenção do v1, power ports) · 485_A/485_B/485_TX/485_RX/485_RO/
485_DIR · CANH/CANL/CAN_TX/CAN_RX · SDA/SCL (lado ESP32) · SDA_EXT/SCL_EXT/VEXT/
GND_EXT (domínio isolado — GND_EXT **nunca** encosta em GND) · TTL_TX/TTL_RX/RX1 ·
RS232_RXIN/RS232_TXOUT · 1WIRE · SPI_SCK/SPI_MISO/SPI_MOSI/SPI_CS · VIN_EXT ·
nós dos capacitores do MAX3232.

Conectividade por net labels em stubs curtos a partir da ponta quente de cada pino
(folha única "SCH - Leitor V2", tamanho A3); séries curtas (divisor, terminador+jumper)
com fio direto. Wires calculados programaticamente na ponta quente exata (símbolos com
pinos fora da grade de 100 mil — ex. MAX485 — seguem o precedente do v1: coordenada
exata, não arredondada).

## Limitações e avisos

- **CAN**: sem transceiver na lib nesta versão — usar módulo no CN5. Quando o CI
  entrar no SchLib/PcbLib + ExportLibs, o esquema ganha o CI e o CN5 vira opcional.
- **Serigrafia**: `changes.js` não tem operação de texto de silk; as descrições da
  placa (nome de cada conector/jumper) são desenhadas no Altium na etapa de PCB. O
  esquema carrega toda a documentação como itens `text`.
- **Contorno 80×80 + furos**: o contorno quadrado entra na etapa PCB via
  `outline_set`; os furos MH1-4 já entram pelo ECO (são componentes).
- RS-485 fica em 5 V fixo (MAX485); I2C do lado externo é alimentado pelo alvo.

## Passos de build (fluxo AI-GUIDE)

1. Gerar `Projects\TCMS_Reader_V2\schematic.js` (gerador node com validação) +
   entrada em `projects.js`.
2. Conferir no hub, vista **Esquema**.
3. Altium: criar `TCMS_Reader_V2.PrjPcb`, rodar **BuildSchematic**, Compile +
   **Design » Update PCB** (ECO).
4. **ExportBoard** → IA posiciona/roteia em `changes.js` (contorno 80×80, furos nas
   laterais, conectores na borda) → **ApplyChanges** + DRC.
