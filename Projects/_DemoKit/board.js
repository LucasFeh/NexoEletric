var pcbmirror = {
"format":"pcbmirror-v1",
"generated":"exemplo sintetico",
"source":"_DemoKit.PcbDoc",
"units":"mm",
"axis":"y-up",
"origin_note":"coordenadas em mm relativas a origem da placa (Board.XOrigin/YOrigin), Y para cima - identicas ao PCB List / Properties do Altium",
"board":{"bbox":{"x1":0,"y1":0,"x2":30,"y2":20},
"outline":[
{"kind":"line","x1":0,"y1":0,"x2":30,"y2":0},
{"kind":"line","x1":30,"y1":0,"x2":30,"y2":20},
{"kind":"line","x1":30,"y1":20,"x2":0,"y2":20},
{"kind":"line","x1":0,"y1":20,"x2":0,"y2":0}
]},
"nets":["","GND","NET_LED","VCC"],
"components":[
{"id":"c1","ref":"P1","footprint":"HDR2X1","comment":"ALIM 5V","layer":"Top","x":3,"y":10,"rot":0,"bbox":{"x1":1.6,"y1":7.33,"x2":4.4,"y2":12.67},"pads":[
{"id":"c1p1","name":"1","layer":"Multi","type":"th","shape":"rect","x":3,"y":11.27,"w":1.7,"h":1.7,"rot":0,"drillshape":"circle","drill":1,"holerot":0,"net":"VCC"},
{"id":"c1p2","name":"2","layer":"Multi","type":"th","shape":"circle","x":3,"y":8.73,"w":1.7,"h":1.7,"rot":0,"drillshape":"circle","drill":1,"holerot":0,"net":"GND"}]},
{"id":"c2","ref":"R1","footprint":"R0805","comment":"330R","layer":"Top","x":10,"y":14,"rot":0,"bbox":{"x1":8.5,"y1":13.2,"x2":11.5,"y2":14.8},"pads":[
{"id":"c2p1","name":"1","layer":"Top","type":"smd","shape":"rect","x":9.05,"y":14,"w":0.9,"h":1.3,"rot":0,"net":"VCC"},
{"id":"c2p2","name":"2","layer":"Top","type":"smd","shape":"rect","x":10.95,"y":14,"w":0.9,"h":1.3,"rot":0,"net":"NET_LED"}]},
{"id":"c3","ref":"D1","footprint":"LED0805","comment":"LED VERMELHO","layer":"Top","x":16,"y":14,"rot":0,"bbox":{"x1":14.4,"y1":13.2,"x2":17.6,"y2":14.8},"pads":[
{"id":"c3p1","name":"A","layer":"Top","type":"smd","shape":"rect","x":15.05,"y":14,"w":0.9,"h":1.3,"rot":0,"net":"NET_LED"},
{"id":"c3p2","name":"K","layer":"Top","type":"smd","shape":"rect","x":16.95,"y":14,"w":0.9,"h":1.3,"rot":0,"net":"GND"}]},
{"id":"c4","ref":"C1","footprint":"C0805","comment":"100n","layer":"Top","x":10,"y":6,"rot":0,"bbox":{"x1":8.5,"y1":5.2,"x2":11.5,"y2":6.8},"pads":[
{"id":"c4p1","name":"1","layer":"Top","type":"smd","shape":"rect","x":9.05,"y":6,"w":0.9,"h":1.3,"rot":0,"net":"GND"},
{"id":"c4p2","name":"2","layer":"Top","type":"smd","shape":"rect","x":10.95,"y":6,"w":0.9,"h":1.3,"rot":0,"net":"VCC"}]}
],
"freepads":[],
"tracks":[
{"id":"t1","layer":"Top","x1":3,"y1":11.27,"x2":3,"y2":14,"w":0.3,"net":"VCC"},
{"id":"t2","layer":"Top","x1":3,"y1":14,"x2":9.05,"y2":14,"w":0.3,"net":"VCC"},
{"id":"t3","layer":"Top","x1":10.95,"y1":14,"x2":15.05,"y2":14,"w":0.3,"net":"NET_LED"},
{"id":"t4","layer":"Top","x1":16.95,"y1":14,"x2":18,"y2":14,"w":0.3,"net":"GND"},
{"id":"t5","layer":"Top","x1":18,"y1":14,"x2":18,"y2":6,"w":0.3,"net":"GND"},
{"id":"t6","layer":"Top","x1":18,"y1":6,"x2":9.05,"y2":6,"w":0.3,"net":"GND"},
{"id":"t7","layer":"Top","x1":3,"y1":8.73,"x2":3,"y2":6,"w":0.3,"net":"GND"}
],
"arcs":[],
"vias":[],
"texts":[
{"id":"x1","layer":"TopOverlay","x":3,"y":13.2,"text":".Designator","h":0.8,"rot":0,"mirror":false,"designator":true,"comment":false,"owner":"P1"},
{"id":"x2","layer":"TopOverlay","x":10,"y":15.4,"text":".Designator","h":0.8,"rot":0,"mirror":false,"designator":true,"comment":false,"owner":"R1"},
{"id":"x3","layer":"TopOverlay","x":16,"y":15.4,"text":".Designator","h":0.8,"rot":0,"mirror":false,"designator":true,"comment":false,"owner":"D1"},
{"id":"x4","layer":"TopOverlay","x":10,"y":7.4,"text":".Designator","h":0.8,"rot":0,"mirror":false,"designator":true,"comment":false,"owner":"C1"}
],
"silk":[
{"id":"s1","layer":"TopOverlay","kind":"line","x1":9.65,"y1":14.85,"x2":10.35,"y2":14.85,"w":0.15,"owner":"R1"},
{"id":"s2","layer":"TopOverlay","kind":"line","x1":9.65,"y1":13.15,"x2":10.35,"y2":13.15,"w":0.15,"owner":"R1"},
{"id":"s3","layer":"TopOverlay","kind":"line","x1":17.55,"y1":13.2,"x2":17.55,"y2":14.8,"w":0.15,"owner":"D1"}
],
"regions":[],
"stats":{"components":4,"freepads":0,"tracks":7,"arcs":0,"vias":0,"texts":4,"silk":3,"regions":0}
};
