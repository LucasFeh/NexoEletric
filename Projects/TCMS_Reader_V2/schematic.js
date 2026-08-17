var schematic = {
"format":"schmirror-v2",
"project":"TCMS_Reader_V2",
"generated":"04/08/2026 11:22:35",
"units":"mil",
"items":[
{"t":"sheet","name":"SCH - Leitor V2","size":"A4"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"IC1","sym":"ESP32 DEV KIT","part":1,"x":2600,"y":4110,"rot":0,"mirror":false,"footprint":"ESP32-DEVKITV1_BOARD","comment":"ESP32 DevKit 30 pinos"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"IC2","sym":"MAX485CPA","part":1,"x":2600,"y":6300,"rot":0,"mirror":false,"footprint":"DIP8","comment":"MAX485 (5V)"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"R3","sym":"RES [SMD]","part":1,"x":3400,"y":6630,"rot":0,"mirror":false,"footprint":"RES 0805","comment":"1k (divisor RO)"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"R4","sym":"RES [SMD]","part":1,"x":3800,"y":6380,"rot":90,"mirror":false,"footprint":"RES 0805","comment":"2k (divisor RO)"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"R5","sym":"RES [SMD]","part":1,"x":4300,"y":5800,"rot":90,"mirror":false,"footprint":"RES 0805","comment":"10k (DE pull-down)"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"C1","sym":"CAP [SMD]","part":1,"x":1700,"y":6900,"rot":0,"mirror":false,"footprint":"CAP 0805","comment":"100nF"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"R1","sym":"RES [SMD]","part":1,"x":4400,"y":6900,"rot":270,"mirror":false,"footprint":"RES 1206","comment":"120R 1% terminador 485"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"J1","sym":"JUMPER [02V]","part":1,"x":4400,"y":6500,"rot":270,"mirror":false,"footprint":"JUMPER 2 VIAS PTH","comment":"Fechado = terminador 485"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"D2","sym":"DIODO TVS BIDIR [SMD]","part":1,"x":4900,"y":6900,"rot":90,"mirror":false,"footprint":"SOD-323","comment":"TVS bidir 12V (SM712)"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"D3","sym":"DIODO TVS BIDIR [SMD]","part":1,"x":5300,"y":6900,"rot":90,"mirror":false,"footprint":"SOD-323","comment":"TVS bidir 12V (SM712)"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"R2","sym":"RES [SMD]","part":1,"x":5800,"y":6900,"rot":270,"mirror":false,"footprint":"RES 1206","comment":"120R 1% terminador CAN"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"J2","sym":"JUMPER [02V]","part":1,"x":5800,"y":6500,"rot":270,"mirror":false,"footprint":"JUMPER 2 VIAS PTH","comment":"Fechado = terminador CAN"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"D4","sym":"DIODO TVS BIDIR [SMD]","part":1,"x":6900,"y":6900,"rot":90,"mirror":false,"footprint":"SOD-323","comment":"TVS bidir 12V (SM712)"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"D5","sym":"DIODO TVS BIDIR [SMD]","part":1,"x":7300,"y":6900,"rot":90,"mirror":false,"footprint":"SOD-323","comment":"TVS bidir 12V (SM712)"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"IC4","sym":"ISO 1540D","part":1,"x":7600,"y":6200,"rot":0,"mirror":true,"footprint":"ISO1540D","comment":"ISO1540 isolador I2C"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"R6","sym":"RES [SMD]","part":1,"x":6100,"y":6500,"rot":90,"mirror":false,"footprint":"RES 0805","comment":"4k7 pull-up SDA"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"R7","sym":"RES [SMD]","part":1,"x":6400,"y":6400,"rot":90,"mirror":false,"footprint":"RES 0805","comment":"4k7 pull-up SCL"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"R8","sym":"RES [SMD]","part":1,"x":8850,"y":6500,"rot":90,"mirror":false,"footprint":"RES 0805","comment":"4k7 pull-up SDA ext"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"R9","sym":"RES [SMD]","part":1,"x":9150,"y":6400,"rot":90,"mirror":false,"footprint":"RES 0805","comment":"4k7 pull-up SCL ext"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"J3","sym":"JUMPER [02V]","part":1,"x":9200,"y":5600,"rot":0,"mirror":false,"footprint":"JUMPER 2 VIAS PTH","comment":"Fechado = pull-ups I2C ext"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"C7","sym":"CAP [SMD]","part":1,"x":6400,"y":4600,"rot":0,"mirror":false,"footprint":"CAP 0805","comment":"100nF"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"C8","sym":"CAP [SMD]","part":1,"x":8600,"y":4600,"rot":0,"mirror":false,"footprint":"CAP 0805","comment":"100nF (dominio isolado)"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"J5","sym":"JUMPER 3Q","part":1,"x":5000,"y":3600,"rot":0,"mirror":false,"footprint":"JUMPER_3VIAS","comment":"RX1: 1-2 TTL, 2-3 RS-232"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"R12","sym":"RES [SMD]","part":1,"x":4600,"y":3600,"rot":0,"mirror":false,"footprint":"RES 0805","comment":"1k (serie RX-TTL)"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"R14","sym":"RES [SMD]","part":1,"x":5000,"y":3950,"rot":90,"mirror":false,"footprint":"RES 0805","comment":"100k (RX1 nao flutua)"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"J4","sym":"JUMPER [02V]","part":1,"x":5200,"y":4700,"rot":0,"mirror":false,"footprint":"JUMPER 2 VIAS PTH","comment":"Fechado = pull-up 1-Wire"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"R10","sym":"RES [SMD]","part":1,"x":5800,"y":4700,"rot":0,"mirror":false,"footprint":"RES 0805","comment":"4k7 pull-up 1-Wire"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"R13","sym":"RES [SMD]","part":1,"x":5800,"y":4300,"rot":0,"mirror":false,"footprint":"RES 0805","comment":"100R (serie 1-WIRE)"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"IC3","sym":"MAX3232","part":1,"x":2600,"y":3100,"rot":0,"mirror":false,"footprint":"SOIC NARROW","comment":"MAX3232 (3V3)"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"C3","sym":"CAP [SMD]","part":1,"x":1500,"y":3200,"rot":0,"mirror":false,"footprint":"CAP 0805","comment":"100nF (C1)"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"C4","sym":"CAP [SMD]","part":1,"x":1500,"y":2900,"rot":0,"mirror":false,"footprint":"CAP 0805","comment":"100nF (C2)"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"C5","sym":"CAP [SMD]","part":1,"x":1500,"y":2600,"rot":0,"mirror":false,"footprint":"CAP 0805","comment":"100nF (V+)"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"C6","sym":"CAP [SMD]","part":1,"x":1500,"y":2300,"rot":0,"mirror":false,"footprint":"CAP 0805","comment":"100nF (V-)"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"C2","sym":"CAP [SMD]","part":1,"x":4300,"y":2800,"rot":0,"mirror":false,"footprint":"CAP 0805","comment":"100nF"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN6","sym":"DB9","part":1,"x":5600,"y":2100,"rot":0,"mirror":false,"footprint":"DB9 PCI","comment":"DB9 femea RS-232"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN5","sym":"CONE PADRAO","part":1,"x":8000,"y":5400,"rot":0,"mirror":true,"footprint":"CONE HEADER 6 VIAS VERTICAL - 2 ROWS","comment":"MODULO CAN"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN5","sym":"CONE PADRAO","part":2,"x":8000,"y":5200,"rot":0,"mirror":true,"footprint":"CONE HEADER 6 VIAS VERTICAL - 2 ROWS","comment":"MODULO CAN"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN5","sym":"CONE PADRAO","part":3,"x":8000,"y":5000,"rot":0,"mirror":true,"footprint":"CONE HEADER 6 VIAS VERTICAL - 2 ROWS","comment":"MODULO CAN"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN5","sym":"CONE PADRAO","part":4,"x":8000,"y":4800,"rot":0,"mirror":true,"footprint":"CONE HEADER 6 VIAS VERTICAL - 2 ROWS","comment":"MODULO CAN"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN5","sym":"CONE PADRAO","part":5,"x":8000,"y":4600,"rot":0,"mirror":true,"footprint":"CONE HEADER 6 VIAS VERTICAL - 2 ROWS","comment":"MODULO CAN"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN5","sym":"CONE PADRAO","part":6,"x":8000,"y":4400,"rot":0,"mirror":true,"footprint":"CONE HEADER 6 VIAS VERTICAL - 2 ROWS","comment":"MODULO CAN"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN4","sym":"CONE PADRAO","part":1,"x":8000,"y":4000,"rot":0,"mirror":true,"footprint":"CONE HEADER 6 VIAS VERTICAL - 2 ROWS","comment":"SPI 3V3"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN4","sym":"CONE PADRAO","part":2,"x":8000,"y":3800,"rot":0,"mirror":true,"footprint":"CONE HEADER 6 VIAS VERTICAL - 2 ROWS","comment":"SPI 3V3"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN4","sym":"CONE PADRAO","part":3,"x":8000,"y":3600,"rot":0,"mirror":true,"footprint":"CONE HEADER 6 VIAS VERTICAL - 2 ROWS","comment":"SPI 3V3"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN4","sym":"CONE PADRAO","part":4,"x":8000,"y":3400,"rot":0,"mirror":true,"footprint":"CONE HEADER 6 VIAS VERTICAL - 2 ROWS","comment":"SPI 3V3"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN4","sym":"CONE PADRAO","part":5,"x":8000,"y":3200,"rot":0,"mirror":true,"footprint":"CONE HEADER 6 VIAS VERTICAL - 2 ROWS","comment":"SPI 3V3"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN4","sym":"CONE PADRAO","part":6,"x":8000,"y":3000,"rot":0,"mirror":true,"footprint":"CONE HEADER 6 VIAS VERTICAL - 2 ROWS","comment":"SPI 3V3"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN3","sym":"CONE PADRAO","part":1,"x":10600,"y":6600,"rot":0,"mirror":true,"footprint":"CONE MSTBH 2,5/ 4 GF","comment":"I2C ISOLADO"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN3","sym":"CONE PADRAO","part":2,"x":10600,"y":6400,"rot":0,"mirror":true,"footprint":"CONE MSTBH 2,5/ 4 GF","comment":"I2C ISOLADO"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN3","sym":"CONE PADRAO","part":3,"x":10600,"y":6200,"rot":0,"mirror":true,"footprint":"CONE MSTBH 2,5/ 4 GF","comment":"I2C ISOLADO"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN3","sym":"CONE PADRAO","part":4,"x":10600,"y":6000,"rot":0,"mirror":true,"footprint":"CONE MSTBH 2,5/ 4 GF","comment":"I2C ISOLADO"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN1","sym":"CONE PADRAO","part":1,"x":10600,"y":5400,"rot":0,"mirror":true,"footprint":"CONE MSTBH 2,5/ 12 GF","comment":"BARRAMENTOS"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN1","sym":"CONE PADRAO","part":2,"x":10600,"y":5200,"rot":0,"mirror":true,"footprint":"CONE MSTBH 2,5/ 12 GF","comment":"BARRAMENTOS"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN1","sym":"CONE PADRAO","part":3,"x":10600,"y":5000,"rot":0,"mirror":true,"footprint":"CONE MSTBH 2,5/ 12 GF","comment":"BARRAMENTOS"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN1","sym":"CONE PADRAO","part":4,"x":10600,"y":4800,"rot":0,"mirror":true,"footprint":"CONE MSTBH 2,5/ 12 GF","comment":"BARRAMENTOS"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN1","sym":"CONE PADRAO","part":5,"x":10600,"y":4600,"rot":0,"mirror":true,"footprint":"CONE MSTBH 2,5/ 12 GF","comment":"BARRAMENTOS"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN1","sym":"CONE PADRAO","part":6,"x":10600,"y":4400,"rot":0,"mirror":true,"footprint":"CONE MSTBH 2,5/ 12 GF","comment":"BARRAMENTOS"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN1","sym":"CONE PADRAO","part":7,"x":10600,"y":4200,"rot":0,"mirror":true,"footprint":"CONE MSTBH 2,5/ 12 GF","comment":"BARRAMENTOS"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN1","sym":"CONE PADRAO","part":8,"x":10600,"y":4000,"rot":0,"mirror":true,"footprint":"CONE MSTBH 2,5/ 12 GF","comment":"BARRAMENTOS"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN1","sym":"CONE PADRAO","part":9,"x":10600,"y":3800,"rot":0,"mirror":true,"footprint":"CONE MSTBH 2,5/ 12 GF","comment":"BARRAMENTOS"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN1","sym":"CONE PADRAO","part":10,"x":10600,"y":3600,"rot":0,"mirror":true,"footprint":"CONE MSTBH 2,5/ 12 GF","comment":"BARRAMENTOS"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN1","sym":"CONE PADRAO","part":11,"x":10600,"y":3400,"rot":0,"mirror":true,"footprint":"CONE MSTBH 2,5/ 12 GF","comment":"BARRAMENTOS"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN1","sym":"CONE PADRAO","part":12,"x":10600,"y":3200,"rot":0,"mirror":true,"footprint":"CONE MSTBH 2,5/ 12 GF","comment":"BARRAMENTOS"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN7","sym":"CONE PADRAO","part":1,"x":10600,"y":2900,"rot":0,"mirror":true,"footprint":"CONE MSTBH 2,5/ 8 GF","comment":"MODULO ETHERNET W5500"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN7","sym":"CONE PADRAO","part":2,"x":10600,"y":2700,"rot":0,"mirror":true,"footprint":"CONE MSTBH 2,5/ 8 GF","comment":"MODULO ETHERNET W5500"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN7","sym":"CONE PADRAO","part":3,"x":10600,"y":2500,"rot":0,"mirror":true,"footprint":"CONE MSTBH 2,5/ 8 GF","comment":"MODULO ETHERNET W5500"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN7","sym":"CONE PADRAO","part":4,"x":10600,"y":2300,"rot":0,"mirror":true,"footprint":"CONE MSTBH 2,5/ 8 GF","comment":"MODULO ETHERNET W5500"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN7","sym":"CONE PADRAO","part":5,"x":10600,"y":2100,"rot":0,"mirror":true,"footprint":"CONE MSTBH 2,5/ 8 GF","comment":"MODULO ETHERNET W5500"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN7","sym":"CONE PADRAO","part":6,"x":10600,"y":1900,"rot":0,"mirror":true,"footprint":"CONE MSTBH 2,5/ 8 GF","comment":"MODULO ETHERNET W5500"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN7","sym":"CONE PADRAO","part":7,"x":10600,"y":1700,"rot":0,"mirror":true,"footprint":"CONE MSTBH 2,5/ 8 GF","comment":"MODULO ETHERNET W5500"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN7","sym":"CONE PADRAO","part":8,"x":10600,"y":1500,"rot":0,"mirror":true,"footprint":"CONE MSTBH 2,5/ 8 GF","comment":"MODULO ETHERNET W5500"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN2","sym":"CONE PADRAO","part":1,"x":700,"y":5400,"rot":0,"mirror":false,"footprint":"CONE MSTBH 2,5/ 2 GF","comment":"5V IN"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"CN2","sym":"CONE PADRAO","part":2,"x":700,"y":5100,"rot":0,"mirror":false,"footprint":"CONE MSTBH 2,5/ 2 GF","comment":"5V IN"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"D1","sym":"DIODO SCHOTTKY [PTH]","part":1,"x":1400,"y":5400,"rot":0,"mirror":false,"footprint":"DO-201AD-COMPACT","comment":"1N5822 anti-inversao"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"C9","sym":"CAP EL [PTH]","part":1,"x":1900,"y":5310,"rot":270,"mirror":false,"footprint":"CAP EL 3MM L15 D8","comment":"100uF/16V"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"R11","sym":"RES [SMD]","part":1,"x":1000,"y":5700,"rot":0,"mirror":false,"footprint":"RES 0805","comment":"1k (LED)"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"LED1","sym":"LED","part":1,"x":1600,"y":5700,"rot":0,"mirror":false,"footprint":"LED 5MM - GREEN","comment":"POWER 3V3"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"MH1","sym":"CONE PARAFUSO ATERRADO","part":1,"x":4700,"y":5000,"rot":0,"mirror":false,"footprint":"Furo GND","comment":"Furo fixacao"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"MH2","sym":"CONE PARAFUSO ATERRADO","part":1,"x":5400,"y":5000,"rot":0,"mirror":false,"footprint":"Furo GND","comment":"Furo fixacao"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"MH3","sym":"CONE PARAFUSO ATERRADO","part":1,"x":6100,"y":5000,"rot":0,"mirror":false,"footprint":"Furo GND","comment":"Furo fixacao"}
,{"t":"comp","sheet":"SCH - Leitor V2","ref":"MH4","sym":"CONE PARAFUSO ATERRADO","part":1,"x":6800,"y":5000,"rot":0,"mirror":false,"footprint":"Furo GND","comment":"Furo fixacao"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[1900,4800],[1400,4800]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":1400,"y":4800,"rot":180,"net":"3v3","style":"Bar"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[1900,4700],[1400,4700]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":1400,"y":4700,"rot":180,"net":"GND","style":"GndPower"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[1900,4400],[1400,4400]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":1400,"y":4400,"net":"485_DIR"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[1900,4300],[1400,4300]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":1400,"y":4300,"net":"485_RX"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[1900,4200],[1400,4200]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":1400,"y":4200,"net":"485_TX"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[1900,4100],[1400,4100]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":1400,"y":4100,"net":"SPI_CS"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[1900,4000],[1400,4000]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":1400,"y":4000,"net":"SPI_SCK"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[1900,3900],[1400,3900]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":1400,"y":3900,"net":"SPI_MISO"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[1900,3800],[1400,3800]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":1400,"y":3800,"net":"SDA"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[1900,3500],[1400,3500]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":1400,"y":3500,"net":"SCL"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[1900,3400],[1400,3400]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":1400,"y":3400,"net":"SPI_MOSI"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[3300,4800],[3800,4800]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":3800,"y":4800,"rot":0,"net":"5v","style":"Bar"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[3300,4700],[3800,4700]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":3800,"y":4700,"rot":0,"net":"GND","style":"GndPower"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[3300,4400],[3800,4400]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":3800,"y":4400,"net":"ETH_RST"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[3300,4300],[3800,4300]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":3800,"y":4300,"net":"TTL_TX"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[3300,4200],[3800,4200]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":3800,"y":4200,"net":"CAN_RX"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[3300,4100],[3800,4100]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":3800,"y":4100,"net":"CAN_TX"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[3300,4000],[3800,4000]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":3800,"y":4000,"net":"ETH_CS"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[3300,3900],[3800,3900]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":3800,"y":3900,"net":"1W_MCU"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[3300,3800],[3800,3800]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":3800,"y":3800,"net":"ETH_INT"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[3300,3700],[5000,3700]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":4050,"y":3700,"net":"RX1"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[5000,4100],[5000,4200]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":5000,"y":4200,"rot":90,"net":"3v3","style":"Bar"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[4750,3600],[4800,3600]]}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[4350,3600],[4000,3600]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":4000,"y":3600,"net":"TTL_RX"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[5200,3600],[5400,3600]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":5400,"y":3600,"net":"RS232_RX"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[2090,6160],[1700,6160]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":1700,"y":6160,"net":"485_A"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[2090,6420],[1700,6420]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":1700,"y":6420,"net":"485_B"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[2090,6630],[1700,6630]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":1700,"y":6630,"rot":180,"net":"5v","style":"Bar"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[2090,5920],[1700,5920]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":1700,"y":5920,"rot":180,"net":"GND","style":"GndPower"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[3000,6630],[3150,6630]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":3000,"y":6630,"net":"485_RO"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[3550,6630],[3800,6630],[3800,6530]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":3600,"y":6630,"net":"485_RX"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[3800,6130],[3800,6030]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":3800,"y":6030,"rot":270,"net":"GND","style":"GndPower"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[3000,6410],[3350,6410]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":3350,"y":6410,"net":"485_DIR"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[3000,6150],[4300,6150],[4300,5950]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":3150,"y":6150,"net":"485_DIR"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[4300,5550],[4300,5450]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":4300,"y":5450,"rot":270,"net":"GND","style":"GndPower"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[3000,5920],[3200,5920]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":3200,"y":5920,"net":"485_TX"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[1550,6900],[1450,6900]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":1450,"y":6900,"rot":180,"net":"5v","style":"Bar"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[1850,6900],[1950,6900]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":1950,"y":6900,"rot":0,"net":"GND","style":"GndPower"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[4400,7150],[4400,7200]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":4400,"y":7200,"net":"485_A"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[4400,6750],[4400,6600]]}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[4400,6300],[4400,6200]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":4400,"y":6200,"net":"485_B"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[4900,7100],[4900,7200]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":4900,"y":7200,"net":"485_A"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[4900,6700],[4900,6600]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":4900,"y":6600,"rot":270,"net":"GND","style":"GndPower"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[5300,7100],[5300,7200]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":5300,"y":7200,"net":"485_B"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[5300,6700],[5300,6600]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":5300,"y":6600,"rot":270,"net":"GND","style":"GndPower"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[5800,7150],[5800,7200]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":5800,"y":7200,"net":"CANH"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[5800,6750],[5800,6600]]}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[5800,6300],[5800,6200]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":5800,"y":6200,"net":"CANL"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[6900,7100],[6900,7200]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":6900,"y":7200,"net":"CANH"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[6900,6700],[6900,6600]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":6900,"y":6600,"rot":270,"net":"GND","style":"GndPower"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[7300,7100],[7300,7200]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":7300,"y":7200,"net":"CANL"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[7300,6700],[7300,6600]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":7300,"y":6600,"rot":270,"net":"GND","style":"GndPower"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[7000,6250],[5900,6250]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":5900,"y":6250,"net":"SDA"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[7000,6150],[5900,6150]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":5900,"y":6150,"net":"SCL"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[7000,6550],[6400,6550]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":6400,"y":6550,"rot":180,"net":"3v3","style":"Bar"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[7000,5850],[6400,5850]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":6400,"y":5850,"rot":180,"net":"GND","style":"GndPower"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[8200,6250],[9000,6250]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":9000,"y":6250,"net":"SDA_EXT"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[8200,6150],[9200,6150]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":9200,"y":6150,"net":"SCL_EXT"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[8200,6550],[8700,6550]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":8700,"y":6550,"net":"VEXT"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[8200,5850],[8700,5850]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":8700,"y":5850,"net":"GND_EXT"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[6100,6650],[6100,6750]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":6100,"y":6750,"rot":90,"net":"3v3","style":"Bar"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[6400,6550],[6400,6750]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":6400,"y":6750,"rot":90,"net":"3v3","style":"Bar"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[8850,6650],[8850,6850]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":8850,"y":6850,"net":"PU_EXT"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[9150,6550],[9150,7050]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":9150,"y":7050,"net":"PU_EXT"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[9100,5600],[8800,5600]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":8800,"y":5600,"net":"VEXT"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[9400,5600],[9600,5600]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":9600,"y":5600,"net":"PU_EXT"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[6250,4600],[6150,4600]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":6150,"y":4600,"rot":180,"net":"3v3","style":"Bar"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[6550,4600],[6650,4600]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":6650,"y":4600,"rot":0,"net":"GND","style":"GndPower"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[8450,4600],[8100,4600]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":8100,"y":4600,"net":"VEXT"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[8750,4600],[8850,4600]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":8850,"y":4600,"net":"GND_EXT"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[5100,4700],[5000,4700],[5000,4800]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":5000,"y":4800,"rot":90,"net":"3v3","style":"Bar"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[5400,4700],[5550,4700]]}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[5950,4700],[6050,4700]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":6050,"y":4700,"net":"1WIRE"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[5550,4300],[5250,4300]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":5250,"y":4300,"net":"1W_MCU"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[5950,4300],[6050,4300]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":6050,"y":4300,"net":"1WIRE"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[2500,3000],[2300,3000]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":2300,"y":3000,"net":"C1P"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[2500,2800],[2300,2800]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":2300,"y":2800,"net":"VPOS"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[2500,2600],[2300,2600]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":2300,"y":2600,"net":"C1N"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[2500,2400],[2300,2400]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":2300,"y":2400,"net":"C2P"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[2500,2200],[2300,2200]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":2300,"y":2200,"net":"C2N"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[2500,2000],[2300,2000]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":2300,"y":2000,"net":"VNEG"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[3500,3000],[3700,3000]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":3700,"y":3000,"rot":0,"net":"3v3","style":"Bar"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[3500,2800],[3700,2800]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":3700,"y":2800,"rot":0,"net":"GND","style":"GndPower"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[3500,2000],[3700,2000]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":3700,"y":2000,"net":"TTL_TX"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[3500,2200],[3700,2200]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":3700,"y":2200,"net":"RS232_RX"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[3500,2400],[3700,2400]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":3700,"y":2400,"net":"RS232_RXIN"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[3500,2600],[3700,2600]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":3700,"y":2600,"net":"RS232_TXOUT"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[3500,1800],[3900,1800],[3900,1600]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":3900,"y":1600,"rot":270,"net":"GND","style":"GndPower"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[1350,3200],[1250,3200]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":1250,"y":3200,"net":"C1P"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[1650,3200],[1750,3200]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":1750,"y":3200,"net":"C1N"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[1350,2900],[1250,2900]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":1250,"y":2900,"net":"C2P"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[1650,2900],[1750,2900]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":1750,"y":2900,"net":"C2N"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[1350,2600],[1250,2600]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":1250,"y":2600,"net":"VPOS"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[1650,2600],[1750,2600]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":1750,"y":2600,"rot":0,"net":"GND","style":"GndPower"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[1350,2300],[1250,2300]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":1250,"y":2300,"net":"VNEG"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[1650,2300],[1750,2300]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":1750,"y":2300,"rot":0,"net":"GND","style":"GndPower"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[4150,2800],[4050,2800]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":4050,"y":2800,"rot":180,"net":"3v3","style":"Bar"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[4450,2800],[4550,2800]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":4550,"y":2800,"rot":0,"net":"GND","style":"GndPower"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[5900,1900],[6100,1900]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":6100,"y":1900,"net":"RS232_TXOUT"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[5900,2100],[6100,2100]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":6100,"y":2100,"net":"RS232_RXIN"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[5900,2500],[6100,2500]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":6100,"y":2500,"rot":0,"net":"GND","style":"GndPower"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[5900,1700],[6100,1700]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":6100,"y":1700,"net":"HS_DTR"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[5900,2300],[6100,2300]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":6100,"y":2300,"net":"HS_DTR"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[5200,1800],[5000,1800]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":5000,"y":1800,"net":"HS_DTR"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[5200,2000],[5000,2000]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":5000,"y":2000,"net":"HS_RTS"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[5200,2200],[5000,2200]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":5000,"y":2200,"net":"HS_RTS"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[8000,5400],[7300,5400]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":7300,"y":5400,"net":"CAN_TX"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[8000,5200],[7300,5200]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":7300,"y":5200,"net":"CAN_RX"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[8000,5000],[7300,5000]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":7300,"y":5000,"rot":180,"net":"3v3","style":"Bar"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[8000,4800],[7300,4800]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":7300,"y":4800,"rot":180,"net":"GND","style":"GndPower"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[8000,4600],[7300,4600]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":7300,"y":4600,"net":"CANH"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[8000,4400],[7300,4400]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":7300,"y":4400,"net":"CANL"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[8000,4000],[7300,4000]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":7300,"y":4000,"net":"SPI_SCK"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[8000,3800],[7300,3800]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":7300,"y":3800,"net":"SPI_CS"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[8000,3600],[7300,3600]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":7300,"y":3600,"net":"SPI_MISO"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[8000,3400],[7300,3400]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":7300,"y":3400,"rot":180,"net":"3v3","style":"Bar"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[8000,3200],[7300,3200]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":7300,"y":3200,"net":"SPI_MOSI"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[8000,3000],[7300,3000]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":7300,"y":3000,"rot":180,"net":"GND","style":"GndPower"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[10600,5400],[9800,5400]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":9800,"y":5400,"rot":180,"net":"GND","style":"GndPower"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[10600,5200],[9800,5200]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":9800,"y":5200,"rot":180,"net":"5v","style":"Bar"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[10600,5000],[9800,5000]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":9800,"y":5000,"rot":180,"net":"3v3","style":"Bar"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[10600,4800],[9800,4800]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":9800,"y":4800,"net":"485_A"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[10600,4600],[9800,4600]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":9800,"y":4600,"net":"485_B"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[10600,4400],[9800,4400]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":9800,"y":4400,"rot":180,"net":"GND","style":"GndPower"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[10600,4200],[9800,4200]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":9800,"y":4200,"net":"CANH"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[10600,4000],[9800,4000]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":9800,"y":4000,"net":"CANL"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[10600,3800],[9800,3800]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":9800,"y":3800,"net":"TTL_RX"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[10600,3600],[9800,3600]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":9800,"y":3600,"net":"TTL_TX"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[10600,3400],[9800,3400]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":9800,"y":3400,"net":"1WIRE"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[10600,3200],[9800,3200]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":9800,"y":3200,"rot":180,"net":"GND","style":"GndPower"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[10600,6600],[9800,6600]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":9800,"y":6600,"net":"VEXT"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[10600,6400],[9800,6400]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":9800,"y":6400,"net":"SDA_EXT"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[10600,6200],[9800,6200]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":9800,"y":6200,"net":"SCL_EXT"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[10600,6000],[9800,6000]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":9800,"y":6000,"net":"GND_EXT"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[10600,2900],[9800,2900]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":9800,"y":2900,"rot":180,"net":"3v3","style":"Bar"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[10600,2700],[9800,2700]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":9800,"y":2700,"rot":180,"net":"GND","style":"GndPower"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[10600,2500],[9800,2500]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":9800,"y":2500,"net":"SPI_SCK"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[10600,2300],[9800,2300]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":9800,"y":2300,"net":"SPI_MISO"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[10600,2100],[9800,2100]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":9800,"y":2100,"net":"SPI_MOSI"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[10600,1900],[9800,1900]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":9800,"y":1900,"net":"ETH_CS"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[10600,1700],[9800,1700]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":9800,"y":1700,"net":"ETH_INT"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[10600,1500],[9800,1500]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":9800,"y":1500,"net":"ETH_RST"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[700,5400],[1200,5400]]}
,{"t":"netlabel","sheet":"SCH - Leitor V2","x":800,"y":5400,"net":"VIN_EXT"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[1600,5400],[2100,5400]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":2100,"y":5400,"rot":0,"net":"5v","style":"Bar"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[1900,5100],[1900,5000]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":1900,"y":5000,"rot":270,"net":"GND","style":"GndPower"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[700,5100],[1000,5100],[1000,5000]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":1000,"y":5000,"rot":270,"net":"GND","style":"GndPower"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[750,5700],[650,5700]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":650,"y":5700,"rot":180,"net":"3v3","style":"Bar"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[1150,5700],[1400,5700]]}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[1700,5700],[1850,5700],[1850,5600]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":1850,"y":5600,"rot":270,"net":"GND","style":"GndPower"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[4450,5000],[4350,5000]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":4350,"y":5000,"rot":180,"net":"GND","style":"GndPower"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[5150,5000],[5050,5000]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":5050,"y":5000,"rot":180,"net":"GND","style":"GndPower"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[5850,5000],[5750,5000]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":5750,"y":5000,"rot":180,"net":"GND","style":"GndPower"}
,{"t":"wire","sheet":"SCH - Leitor V2","pts":[[6550,5000],[6450,5000]]}
,{"t":"power","sheet":"SCH - Leitor V2","x":6450,"y":5000,"rot":180,"net":"GND","style":"GndPower"}
,{"t":"text","sheet":"SCH - Leitor V2","x":600,"y":7250,"s":"TCMS_READER_V2 - LEITOR UNIVERSAL DE BARRAMENTOS (ESP32)","h":12}
,{"t":"text","sheet":"SCH - Leitor V2","x":600,"y":7100,"s":"placa 80x80mm","h":10}
,{"t":"text","sheet":"SCH - Leitor V2","x":600,"y":1300,"s":"CN1: 1 GND | 2 5V-OUT | 3 3V3-OUT | 4 485A | 5 485B | 6 GND | 7 CANH | 8 CANL | 9 RX-TTL | 10 TX-TTL | 11 1WIRE | 12 GND","h":10}
,{"t":"text","sheet":"SCH - Leitor V2","x":600,"y":1100,"s":"JUMPERS: J1/J2 = terminador 120R (485/CAN) | J3 = pull-ups I2C ext | J4 = pull-up 1WIRE | J5 = RX1: 1-2 TTL / 2-3 RS-232 | aberto = sem","h":10}
,{"t":"text","sheet":"SCH - Leitor V2","x":600,"y":900,"s":"CN2 5V IN | CN3 I2C ISOLADO (VEXT/GND-EXT do alvo) | CN4 SPI | CN5 modulo CAN | CN6 RS-232 | CN7 ETHERNET W5500 | borne = 3V3 (RX-TTL 1k, 1WIRE 100R)","h":10}
]};
