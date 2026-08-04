// AltiumPCBMirror - arquivo de mudancas.
// Edite ESTE arquivo (nunca o board.js). Um objeto JSON por linha. Consulte AI-GUIDE.md.
//
// Numeracao dos canais no TopOverlay: os 32 textos livres (todos "1", h=2) viram os
// numeros 1..32, CENTRO na coluna do LED (x = 20 + k*19.2) e altura h=0.9 para o numero
// caber dentro do quadrado da celula (a borda esquerda fica a so 1.25mm da coluna do LED;
// com h=2 um numero de 2 digitos estourava a borda).
// Fileiras: cima = canais 1-11; meio = 17-22 + 12-16; baixo = 23-24 + 25-32 (coluna 3 vazia).
//
// Designators F1..F32: padronizados no ponto da fileira de baixo (que ja estava certa):
// centro em (coluna do LED, topo do quadrado - 0.46), dentro da marcacao, ao lado do
// porta-fusivel e acima do LED. Topos: 82.931 / 60.931 / 38.931 -> y 82.47149 / 60.47149 / 38.47149.
var changes = [
// --- numeros dos canais ---
{"op":"text_edit","id":"x31","text":"1","x":20,"y":78.869675,"h":0.9,"orig_x":20.037225,"orig_y":78.361675,"orig_text":"1","orig_layer":"TopOverlay","note":"canal 1 - h 0.9 para caber no quadrado - recentraliza na coluna do LD1"},
{"op":"text_edit","id":"x33","text":"2","x":39.2,"y":78.869675,"h":0.9,"orig_x":39.214225,"orig_y":78.615675,"orig_text":"1","orig_layer":"TopOverlay","note":"canal 2 - h 0.9 para caber no quadrado - recentraliza na coluna do LD2"},
{"op":"text_edit","id":"x32","text":"3","x":58.4,"y":78.869675,"h":0.9,"orig_x":58.645225,"orig_y":78.869675,"orig_text":"1","orig_layer":"TopOverlay","note":"canal 3 - h 0.9 para caber no quadrado"},
{"op":"text_edit","id":"x30","text":"4","x":77.6,"y":78.869675,"h":0.9,"orig_x":77.845225,"orig_y":78.869675,"orig_text":"1","orig_layer":"TopOverlay","note":"canal 4 - h 0.9 para caber no quadrado"},
{"op":"text_edit","id":"x29","text":"5","x":96.8,"y":78.869675,"h":0.9,"orig_x":97.045225,"orig_y":78.869675,"orig_text":"1","orig_layer":"TopOverlay","note":"canal 5 - h 0.9 para caber no quadrado"},
{"op":"text_edit","id":"x28","text":"6","x":116,"y":78.869675,"h":0.9,"orig_x":116.245225,"orig_y":78.869675,"orig_text":"1","orig_layer":"TopOverlay","note":"canal 6 - h 0.9 para caber no quadrado"},
{"op":"text_edit","id":"x27","text":"7","x":135.2,"y":78.869675,"h":0.9,"orig_x":135.445225,"orig_y":78.869675,"orig_text":"1","orig_layer":"TopOverlay","note":"canal 7 - h 0.9 para caber no quadrado"},
{"op":"text_edit","id":"x26","text":"8","x":154.4,"y":78.869675,"h":0.9,"orig_x":154.645225,"orig_y":78.869675,"orig_text":"1","orig_layer":"TopOverlay","note":"canal 8 - h 0.9 para caber no quadrado"},
{"op":"text_edit","id":"x25","text":"9","x":173.6,"y":78.869675,"h":0.9,"orig_x":173.845225,"orig_y":78.869675,"orig_text":"1","orig_layer":"TopOverlay","note":"canal 9 - h 0.9 para caber no quadrado"},
{"op":"text_edit","id":"x24","text":"10","x":192.8,"y":78.869675,"h":0.9,"orig_x":193.045225,"orig_y":78.869675,"orig_text":"1","orig_layer":"TopOverlay","note":"canal 10 - h 0.9 para caber no quadrado"},
{"op":"text_edit","id":"x23","text":"11","x":212,"y":78.869675,"h":0.9,"orig_x":212.245225,"orig_y":78.869675,"orig_text":"1","orig_layer":"TopOverlay","note":"canal 11 - h 0.9 para caber no quadrado"},
{"op":"text_edit","id":"x16","text":"12","x":135.2,"y":56.869675,"h":0.9,"orig_x":135.445225,"orig_y":56.869675,"orig_text":"1","orig_layer":"TopOverlay","note":"canal 12 - h 0.9 para caber no quadrado"},
{"op":"text_edit","id":"x15","text":"13","x":154.4,"y":56.869675,"h":0.9,"orig_x":154.645225,"orig_y":56.869675,"orig_text":"1","orig_layer":"TopOverlay","note":"canal 13 - h 0.9 para caber no quadrado"},
{"op":"text_edit","id":"x14","text":"14","x":173.6,"y":56.869675,"h":0.9,"orig_x":173.845225,"orig_y":56.869675,"orig_text":"1","orig_layer":"TopOverlay","note":"canal 14 - h 0.9 para caber no quadrado"},
{"op":"text_edit","id":"x13","text":"15","x":192.8,"y":56.869675,"h":0.9,"orig_x":193.045225,"orig_y":56.869675,"orig_text":"1","orig_layer":"TopOverlay","note":"canal 15 - h 0.9 para caber no quadrado"},
{"op":"text_edit","id":"x12","text":"16","x":212,"y":56.869675,"h":0.9,"orig_x":212.245225,"orig_y":56.869675,"orig_text":"1","orig_layer":"TopOverlay","note":"canal 16 - h 0.9 para caber no quadrado"},
{"op":"text_edit","id":"x22","text":"17","x":20,"y":56.869675,"h":0.9,"orig_x":20.245225,"orig_y":56.869675,"orig_text":"1","orig_layer":"TopOverlay","note":"canal 17 - h 0.9 para caber no quadrado"},
{"op":"text_edit","id":"x21","text":"18","x":39.2,"y":56.869675,"h":0.9,"orig_x":39.445225,"orig_y":56.869675,"orig_text":"1","orig_layer":"TopOverlay","note":"canal 18 - h 0.9 para caber no quadrado"},
{"op":"text_edit","id":"x20","text":"19","x":58.4,"y":56.869675,"h":0.9,"orig_x":58.645225,"orig_y":56.869675,"orig_text":"1","orig_layer":"TopOverlay","note":"canal 19 - h 0.9 para caber no quadrado"},
{"op":"text_edit","id":"x19","text":"20","x":77.6,"y":56.869675,"h":0.9,"orig_x":77.845225,"orig_y":56.869675,"orig_text":"1","orig_layer":"TopOverlay","note":"canal 20 - h 0.9 para caber no quadrado"},
{"op":"text_edit","id":"x18","text":"21","x":96.8,"y":56.869675,"h":0.9,"orig_x":97.045225,"orig_y":56.869675,"orig_text":"1","orig_layer":"TopOverlay","note":"canal 21 - h 0.9 para caber no quadrado"},
{"op":"text_edit","id":"x17","text":"22","x":116,"y":56.869675,"h":0.9,"orig_x":116.245225,"orig_y":56.869675,"orig_text":"1","orig_layer":"TopOverlay","note":"canal 22 - h 0.9 para caber no quadrado"},
{"op":"text_edit","id":"x11","text":"23","x":20,"y":34.869675,"h":0.9,"orig_x":20.245225,"orig_y":34.869675,"orig_text":"1","orig_layer":"TopOverlay","note":"canal 23 - h 0.9 para caber no quadrado"},
{"op":"text_edit","id":"x10","text":"24","x":39.2,"y":34.869675,"h":0.9,"orig_x":39.445225,"orig_y":34.869675,"orig_text":"1","orig_layer":"TopOverlay","note":"canal 24 - h 0.9 para caber no quadrado"},
{"op":"text_edit","id":"x9","text":"25","x":77.6,"y":34.869675,"h":0.9,"orig_x":77.845225,"orig_y":34.869675,"orig_text":"1","orig_layer":"TopOverlay","note":"canal 25 - h 0.9 para caber no quadrado"},
{"op":"text_edit","id":"x8","text":"26","x":96.8,"y":34.869675,"h":0.9,"orig_x":97.045225,"orig_y":34.869675,"orig_text":"1","orig_layer":"TopOverlay","note":"canal 26 - h 0.9 para caber no quadrado"},
{"op":"text_edit","id":"x7","text":"27","x":116,"y":34.869675,"h":0.9,"orig_x":116.245225,"orig_y":34.869675,"orig_text":"1","orig_layer":"TopOverlay","note":"canal 27 - h 0.9 para caber no quadrado"},
{"op":"text_edit","id":"x6","text":"28","x":135.2,"y":34.869675,"h":0.9,"orig_x":135.445225,"orig_y":34.869675,"orig_text":"1","orig_layer":"TopOverlay","note":"canal 28 - h 0.9 para caber no quadrado"},
{"op":"text_edit","id":"x5","text":"29","x":154.4,"y":34.869675,"h":0.9,"orig_x":154.645225,"orig_y":34.869675,"orig_text":"1","orig_layer":"TopOverlay","note":"canal 29 - h 0.9 para caber no quadrado"},
{"op":"text_edit","id":"x4","text":"30","x":173.6,"y":34.869675,"h":0.9,"orig_x":173.845225,"orig_y":34.869675,"orig_text":"1","orig_layer":"TopOverlay","note":"canal 30 - h 0.9 para caber no quadrado"},
{"op":"text_edit","id":"x3","text":"31","x":192.8,"y":34.869675,"h":0.9,"orig_x":193.045225,"orig_y":34.869675,"orig_text":"1","orig_layer":"TopOverlay","note":"canal 31 - h 0.9 para caber no quadrado"},
{"op":"text_edit","id":"x2","text":"32","x":212,"y":34.869675,"h":0.9,"orig_x":212.245225,"orig_y":34.869675,"orig_text":"1","orig_layer":"TopOverlay","note":"canal 32 - h 0.9 para caber no quadrado"},
// --- designators dos fusiveis ---
{"op":"designator_move","ref":"F1","x":20,"y":82.47149,"orig_x":20.821115,"orig_y":82.85249,"note":"designator F1 dentro do quadrado, faixa acima do LED"},
{"op":"designator_move","ref":"F2","x":39.2,"y":82.47149,"orig_x":40.005,"orig_y":82.804,"note":"designator F2 dentro do quadrado, faixa acima do LED"},
{"op":"designator_move","ref":"F3","x":58.4,"y":82.47149,"orig_x":58.801,"orig_y":82.55,"note":"designator F3 dentro do quadrado, faixa acima do LED"},
{"op":"designator_move","ref":"F4","x":77.6,"y":82.47149,"orig_x":77.978,"orig_y":82.931,"note":"designator F4 dentro do quadrado, faixa acima do LED"},
{"op":"designator_move","ref":"F5","x":96.8,"y":82.47149,"orig_x":97.028,"orig_y":82.804,"note":"designator F5 dentro do quadrado, faixa acima do LED"},
{"op":"designator_move","ref":"F6","x":116,"y":82.47149,"orig_x":116.205,"orig_y":82.55,"note":"designator F6 dentro do quadrado, faixa acima do LED"},
{"op":"designator_move","ref":"F7","x":135.2,"y":82.47149,"orig_x":135.509,"orig_y":82.931,"note":"designator F7 dentro do quadrado, faixa acima do LED"},
{"op":"designator_move","ref":"F8","x":154.4,"y":82.47149,"orig_x":154.686,"orig_y":82.677,"note":"designator F8 dentro do quadrado, faixa acima do LED"},
{"op":"designator_move","ref":"F9","x":173.6,"y":82.47149,"orig_x":173.99,"orig_y":82.296,"note":"designator F9 dentro do quadrado, faixa acima do LED"},
{"op":"designator_move","ref":"F10","x":192.8,"y":82.47149,"orig_x":193.04,"orig_y":82.677,"note":"designator F10 dentro do quadrado, faixa acima do LED"},
{"op":"designator_move","ref":"F11","x":212,"y":82.47149,"orig_x":212.344,"orig_y":82.677,"note":"designator F11 dentro do quadrado, faixa acima do LED"},
{"op":"designator_move","ref":"F12","x":135.2,"y":60.47149,"orig_x":135.382,"orig_y":60.579,"note":"designator F12 dentro do quadrado, faixa acima do LED"},
{"op":"designator_move","ref":"F13","x":154.4,"y":60.47149,"orig_x":154.686,"orig_y":60.579,"note":"designator F13 dentro do quadrado, faixa acima do LED"},
{"op":"designator_move","ref":"F14","x":173.6,"y":60.47149,"orig_x":173.863,"orig_y":60.706,"note":"designator F14 dentro do quadrado, faixa acima do LED"},
{"op":"designator_move","ref":"F15","x":192.8,"y":60.47149,"orig_x":193.04,"orig_y":60.706,"note":"designator F15 dentro do quadrado, faixa acima do LED"},
{"op":"designator_move","ref":"F16","x":212,"y":60.47149,"orig_x":212.02492,"orig_y":60.34469,"note":"designator F16 dentro do quadrado, faixa acima do LED"},
{"op":"designator_move","ref":"F17","x":20,"y":60.47149,"orig_x":20.45812,"orig_y":60.34469,"note":"designator F17 dentro do quadrado, faixa acima do LED"},
{"op":"designator_move","ref":"F18","x":39.2,"y":60.47149,"orig_x":39.497,"orig_y":60.198,"note":"designator F18 dentro do quadrado, faixa acima do LED"},
{"op":"designator_move","ref":"F19","x":58.4,"y":60.47149,"orig_x":58.928,"orig_y":60.579,"note":"designator F19 dentro do quadrado, faixa acima do LED"},
{"op":"designator_move","ref":"F20","x":77.6,"y":60.47149,"orig_x":77.978,"orig_y":60.579,"note":"designator F20 dentro do quadrado, faixa acima do LED"},
{"op":"designator_move","ref":"F21","x":96.8,"y":60.47149,"orig_x":97.155,"orig_y":60.452,"note":"designator F21 dentro do quadrado, faixa acima do LED"},
{"op":"designator_move","ref":"F22","x":116,"y":60.47149,"orig_x":116.332,"orig_y":60.452,"note":"designator F22 dentro do quadrado, faixa acima do LED"},
{"op":"designator_move","ref":"F23","x":20,"y":38.47149,"orig_x":20.398635,"orig_y":38.47149,"note":"designator F23 dentro do quadrado, faixa acima do LED"},
{"op":"designator_move","ref":"F24","x":39.2,"y":38.47149,"orig_x":39.599635,"orig_y":38.47149,"note":"designator F24 dentro do quadrado, faixa acima do LED"},
{"op":"designator_move","ref":"F25","x":77.6,"y":38.47149,"orig_x":77.99174,"orig_y":38.47149,"note":"designator F25 dentro do quadrado, faixa acima do LED"},
{"op":"designator_move","ref":"F26","x":96.8,"y":38.47149,"orig_x":96.743235,"orig_y":38.47149,"note":"designator F26 dentro do quadrado, faixa acima do LED"},
{"op":"designator_move","ref":"F27","x":116,"y":38.47149,"orig_x":115.942435,"orig_y":38.47149,"note":"designator F27 dentro do quadrado, faixa acima do LED"},
{"op":"designator_move","ref":"F28","x":135.2,"y":38.47149,"orig_x":135.14143,"orig_y":38.47149,"note":"designator F28 dentro do quadrado, faixa acima do LED"},
{"op":"designator_move","ref":"F29","x":154.4,"y":38.47149,"orig_x":154.79804,"orig_y":38.47149,"note":"designator F29 dentro do quadrado, faixa acima do LED"},
{"op":"designator_move","ref":"F30","x":173.6,"y":38.47149,"orig_x":173.99765,"orig_y":38.47149,"note":"designator F30 dentro do quadrado, faixa acima do LED"},
{"op":"designator_move","ref":"F31","x":192.8,"y":38.47149,"orig_x":192.786,"orig_y":38.481,"note":"designator F31 dentro do quadrado, faixa acima do LED"},
{"op":"designator_move","ref":"F32","x":212,"y":38.47149,"orig_x":212.217,"orig_y":38.481,"note":"designator F32 dentro do quadrado, faixa acima do LED"},
];
