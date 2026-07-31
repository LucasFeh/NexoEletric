var schlib = {
"format":"schlib-v2",
"generated":"exemplo sintetico - sera substituido pelo ExportLibs",
"source":"BIBLIOTECA DE ESQUEMA.SchLib",
"units":"mil",
"symbols":[
{"name":"RES","description":"Resistor","partcount":1,"parts":[
 {"part":1,
  "pins":[
   {"num":"1","name":"1","x":-100,"y":0,"len":100,"orient":180,"type":"Passive"},
   {"num":"2","name":"2","x":100,"y":0,"len":100,"orient":0,"type":"Passive"}],
  "graphics":[
   {"g":"rect","x1":-100,"y1":-40,"x2":100,"y2":40,"solid":true}]}],
 "footprints":[{"name":"R0805","incurrentlib":true,"current":true}]},
{"name":"CAP","description":"Capacitor ceramico","partcount":1,"parts":[
 {"part":1,
  "pins":[
   {"num":"1","name":"1","x":-10,"y":0,"len":90,"orient":180,"type":"Passive"},
   {"num":"2","name":"2","x":10,"y":0,"len":90,"orient":0,"type":"Passive"}],
  "graphics":[
   {"g":"line","x1":-10,"y1":-60,"x2":-10,"y2":60,"w":10},
   {"g":"line","x1":10,"y1":-60,"x2":10,"y2":60,"w":10}]}],
 "footprints":[{"name":"C0805","incurrentlib":true,"current":true}]},
{"name":"LED","description":"Diodo emissor de luz","partcount":1,"parts":[
 {"part":1,
  "pins":[
   {"num":"A","name":"A","x":-50,"y":0,"len":150,"orient":180,"type":"Passive"},
   {"num":"K","name":"K","x":50,"y":0,"len":150,"orient":0,"type":"Passive"}],
  "graphics":[
   {"g":"poly","pts":[[-50,-50],[-50,50],[50,0]],"solid":true},
   {"g":"line","x1":50,"y1":-50,"x2":50,"y2":50,"w":10},
   {"g":"line","x1":10,"y1":70,"x2":40,"y2":100,"w":6},
   {"g":"line","x1":40,"y1":60,"x2":70,"y2":90,"w":6}]}],
 "footprints":[]},
{"name":"CONN2","description":"Conector 2 vias","partcount":1,"parts":[
 {"part":1,
  "pins":[
   {"num":"1","name":"1","x":-100,"y":100,"len":100,"orient":180,"type":"Passive"},
   {"num":"2","name":"2","x":-100,"y":0,"len":100,"orient":180,"type":"Passive"}],
  "graphics":[
   {"g":"rect","x1":-100,"y1":-50,"x2":100,"y2":150,"solid":false},
   {"g":"label","x":0,"y":100,"text":"1","rot":0,"size":8},
   {"g":"label","x":0,"y":0,"text":"2","rot":0,"size":8}]}],
 "footprints":[{"name":"HDR2X1","incurrentlib":true,"current":true}]}
],
"stats":{"symbols":4,"nofootprint":1}
};
