var schematic = {
"format":"schmirror-v2",
"project":"_DemoKit",
"generated":"exemplo sintetico",
"units":"mil",
"items":[
{"t":"sheet","name":"main","size":"A4"},
{"t":"comp","sheet":"main","ref":"P1","sym":"CONN2","part":1,"x":1200,"y":3000,"rot":0,"mirror":true,"footprint":"HDR2X1","comment":"ALIM 5V"},
{"t":"comp","sheet":"main","ref":"R1","sym":"RES","part":1,"x":2400,"y":3400,"rot":0,"mirror":false,"footprint":"R0805","comment":"330R"},
{"t":"comp","sheet":"main","ref":"C1","sym":"CAP","part":1,"x":1800,"y":2800,"rot":90,"mirror":false,"footprint":"C0805","comment":"100n"},
{"t":"comp","sheet":"main","ref":"D1","sym":"LED","part":1,"x":3200,"y":3400,"rot":0,"mirror":false,"footprint":"LED0805","comment":"LED VERMELHO"},
{"t":"wire","sheet":"main","pts":[[1400,3100],[1800,3100],[1800,3400],[2200,3400]]},
{"t":"wire","sheet":"main","pts":[[1800,2900],[1800,3100]]},
{"t":"wire","sheet":"main","pts":[[2600,3400],[3000,3400]]},
{"t":"wire","sheet":"main","pts":[[3400,3400],[3600,3400],[3600,3000]]},
{"t":"wire","sheet":"main","pts":[[1400,3000],[1600,3000]]},
{"t":"netlabel","sheet":"main","net":"VCC","x":1800,"y":3400,"rot":0},
{"t":"netlabel","sheet":"main","net":"NET_LED","x":2800,"y":3400,"rot":0},
{"t":"power","sheet":"main","net":"GND","style":"GndPower","x":1800,"y":2700,"rot":270},
{"t":"power","sheet":"main","net":"GND","style":"GndPower","x":3600,"y":3000,"rot":270},
{"t":"power","sheet":"main","net":"GND","style":"GndPower","x":1600,"y":3000,"rot":270},
{"t":"junction","sheet":"main","x":1800,"y":3100},
{"t":"text","sheet":"main","s":"DEMO KIT - LED + RC","x":2200,"y":3800,"h":12}
]};
