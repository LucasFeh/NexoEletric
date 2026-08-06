// AltiumPCBMirror - arquivo de mudancas.
// Edite ESTE arquivo (nunca o board.js). Um objeto JSON por linha. Consulte AI-GUIDE.md.
//
// IMPORTANTE: rode com o ApplyChanges.pas ATUAL (recarregue o .PrjScr no Altium).
// O apply de 04/08 14:01 tinha um bug: escrever XLocation em texto e ignorado pelo
// engine - trocou texto/altura mas NAO moveu nada (o relatorio ecoava o alvo).
// Corrigido: estilo e movimento em ciclos separados + MoveByXY + relatorio mede o
// centro real de volta e acusa falha se nao chegar no alvo.
//
// LOTE A (este arquivo) - "mesmo design da secao 1" (gabarito ajustado a mao pelo
// usuario no Altium, espelho de 14:22):
//  (a) 32 numeros de canal: fonte h=2, stroke w=0.2, na posicao do gabarito
//      (1 digito: centro na coluna do LED, y = topo da celula - 3.245; 2 digitos:
//      +0.9mm a direita para a borda esquerda alinhar com os de 1 digito e nao
//      estourar a borda da celula).
//  (b) 16 fusiveis girados 180 (rot 90 -> 270, ancora vai para o outro pad, que cai
//      na MESMA posicao - nenhuma trilha muda). O DRC vai acusar troca de net nos
//      pinos desses 16 (fusivel e simetrico; pin swap no esquema ou ignorar).
// LOTE B (depois de aplicar e rodar ExportPcb): recentralizar os 32 designators
// F1..F32 no padrao do gabarito (o giro arrasta o designator dos 16 junto).
var changes = [
// --- numeros: fileira de cima (canais 1-11, y alvo 79.68568) ---
{"op":"text_edit","id":"x64","text":"1","x":20,"y":79.68568,"h":2,"w":0.2,"orig_x":19.964225,"orig_y":79.68568,"orig_text":"1","orig_layer":"TopOverlay","note":"canal 1 - gabarito normalizado (snap na coluna do LED)"},
{"op":"text_edit","id":"x63","text":"2","x":39.2,"y":79.68568,"h":2,"w":0.2,"orig_x":39.214225,"orig_y":78.615675,"orig_text":"2","orig_layer":"TopOverlay","note":"canal 2 - design da secao 1"},
{"op":"text_edit","id":"x62","text":"3","x":58.4,"y":79.68568,"h":2,"w":0.2,"orig_x":58.645225,"orig_y":78.869675,"orig_text":"3","orig_layer":"TopOverlay","note":"canal 3 - design da secao 1"},
{"op":"text_edit","id":"x61","text":"4","x":77.6,"y":79.68568,"h":2,"w":0.2,"orig_x":77.845225,"orig_y":78.869675,"orig_text":"4","orig_layer":"TopOverlay","note":"canal 4 - design da secao 1"},
{"op":"text_edit","id":"x60","text":"5","x":96.8,"y":79.68568,"h":2,"w":0.2,"orig_x":97.045225,"orig_y":78.869675,"orig_text":"5","orig_layer":"TopOverlay","note":"canal 5 - design da secao 1"},
{"op":"text_edit","id":"x59","text":"6","x":116,"y":79.68568,"h":2,"w":0.2,"orig_x":116.245225,"orig_y":78.869675,"orig_text":"6","orig_layer":"TopOverlay","note":"canal 6 - design da secao 1"},
{"op":"text_edit","id":"x58","text":"7","x":135.2,"y":79.68568,"h":2,"w":0.2,"orig_x":135.445225,"orig_y":78.869675,"orig_text":"7","orig_layer":"TopOverlay","note":"canal 7 - design da secao 1"},
{"op":"text_edit","id":"x57","text":"8","x":154.4,"y":79.68568,"h":2,"w":0.2,"orig_x":154.645225,"orig_y":78.869675,"orig_text":"8","orig_layer":"TopOverlay","note":"canal 8 - design da secao 1"},
{"op":"text_edit","id":"x56","text":"9","x":173.6,"y":79.68568,"h":2,"w":0.2,"orig_x":173.845225,"orig_y":78.869675,"orig_text":"9","orig_layer":"TopOverlay","note":"canal 9 - design da secao 1"},
{"op":"text_edit","id":"x55","text":"10","x":193.7,"y":79.68568,"h":2,"w":0.2,"orig_x":193.045225,"orig_y":78.869675,"orig_text":"10","orig_layer":"TopOverlay","note":"canal 10 - design da secao 1 - 2 digitos +0.9"},
{"op":"text_edit","id":"x54","text":"11","x":212.9,"y":79.68568,"h":2,"w":0.2,"orig_x":212.245225,"orig_y":78.869675,"orig_text":"11","orig_layer":"TopOverlay","note":"canal 11 - design da secao 1 - 2 digitos +0.9"},
// --- numeros: fileira do meio (canais 12-22, y alvo 57.68568) ---
{"op":"text_edit","id":"x53","text":"12","x":136.1,"y":57.68568,"h":2,"w":0.2,"orig_x":135.445225,"orig_y":56.869675,"orig_text":"12","orig_layer":"TopOverlay","note":"canal 12 - design da secao 1 - 2 digitos +0.9"},
{"op":"text_edit","id":"x52","text":"13","x":155.3,"y":57.68568,"h":2,"w":0.2,"orig_x":154.645225,"orig_y":56.869675,"orig_text":"13","orig_layer":"TopOverlay","note":"canal 13 - design da secao 1 - 2 digitos +0.9"},
{"op":"text_edit","id":"x51","text":"14","x":174.5,"y":57.68568,"h":2,"w":0.2,"orig_x":173.845225,"orig_y":56.869675,"orig_text":"14","orig_layer":"TopOverlay","note":"canal 14 - design da secao 1 - 2 digitos +0.9"},
{"op":"text_edit","id":"x50","text":"15","x":193.7,"y":57.68568,"h":2,"w":0.2,"orig_x":193.045225,"orig_y":56.869675,"orig_text":"15","orig_layer":"TopOverlay","note":"canal 15 - design da secao 1 - 2 digitos +0.9"},
{"op":"text_edit","id":"x49","text":"16","x":212.9,"y":57.68568,"h":2,"w":0.2,"orig_x":212.245225,"orig_y":56.869675,"orig_text":"16","orig_layer":"TopOverlay","note":"canal 16 - design da secao 1 - 2 digitos +0.9"},
{"op":"text_edit","id":"x48","text":"17","x":20.9,"y":57.68568,"h":2,"w":0.2,"orig_x":20.245225,"orig_y":56.869675,"orig_text":"17","orig_layer":"TopOverlay","note":"canal 17 - design da secao 1 - 2 digitos +0.9"},
{"op":"text_edit","id":"x47","text":"18","x":40.1,"y":57.68568,"h":2,"w":0.2,"orig_x":39.445225,"orig_y":56.869675,"orig_text":"18","orig_layer":"TopOverlay","note":"canal 18 - design da secao 1 - 2 digitos +0.9"},
{"op":"text_edit","id":"x46","text":"19","x":59.3,"y":57.68568,"h":2,"w":0.2,"orig_x":58.645225,"orig_y":56.869675,"orig_text":"19","orig_layer":"TopOverlay","note":"canal 19 - design da secao 1 - 2 digitos +0.9"},
{"op":"text_edit","id":"x45","text":"20","x":78.5,"y":57.68568,"h":2,"w":0.2,"orig_x":77.845225,"orig_y":56.869675,"orig_text":"20","orig_layer":"TopOverlay","note":"canal 20 - design da secao 1 - 2 digitos +0.9"},
{"op":"text_edit","id":"x44","text":"21","x":97.7,"y":57.68568,"h":2,"w":0.2,"orig_x":97.045225,"orig_y":56.869675,"orig_text":"21","orig_layer":"TopOverlay","note":"canal 21 - design da secao 1 - 2 digitos +0.9"},
{"op":"text_edit","id":"x43","text":"22","x":116.9,"y":57.68568,"h":2,"w":0.2,"orig_x":116.245225,"orig_y":56.869675,"orig_text":"22","orig_layer":"TopOverlay","note":"canal 22 - design da secao 1 - 2 digitos +0.9"},
// --- numeros: fileira de baixo (canais 23-32, y alvo 35.68568; coluna 3 vazia) ---
{"op":"text_edit","id":"x42","text":"23","x":20.9,"y":35.68568,"h":2,"w":0.2,"orig_x":20.245225,"orig_y":34.869675,"orig_text":"23","orig_layer":"TopOverlay","note":"canal 23 - design da secao 1 - 2 digitos +0.9"},
{"op":"text_edit","id":"x41","text":"24","x":40.1,"y":35.68568,"h":2,"w":0.2,"orig_x":39.445225,"orig_y":34.869675,"orig_text":"24","orig_layer":"TopOverlay","note":"canal 24 - design da secao 1 - 2 digitos +0.9"},
{"op":"text_edit","id":"x40","text":"25","x":78.5,"y":35.68568,"h":2,"w":0.2,"orig_x":77.845225,"orig_y":34.869675,"orig_text":"25","orig_layer":"TopOverlay","note":"canal 25 - design da secao 1 - 2 digitos +0.9"},
{"op":"text_edit","id":"x39","text":"26","x":97.7,"y":35.68568,"h":2,"w":0.2,"orig_x":97.045225,"orig_y":34.869675,"orig_text":"26","orig_layer":"TopOverlay","note":"canal 26 - design da secao 1 - 2 digitos +0.9"},
{"op":"text_edit","id":"x38","text":"27","x":116.9,"y":35.68568,"h":2,"w":0.2,"orig_x":116.245225,"orig_y":34.869675,"orig_text":"27","orig_layer":"TopOverlay","note":"canal 27 - design da secao 1 - 2 digitos +0.9"},
{"op":"text_edit","id":"x37","text":"28","x":136.1,"y":35.68568,"h":2,"w":0.2,"orig_x":135.445225,"orig_y":34.869675,"orig_text":"28","orig_layer":"TopOverlay","note":"canal 28 - design da secao 1 - 2 digitos +0.9"},
{"op":"text_edit","id":"x36","text":"29","x":155.3,"y":35.68568,"h":2,"w":0.2,"orig_x":154.645225,"orig_y":34.869675,"orig_text":"29","orig_layer":"TopOverlay","note":"canal 29 - design da secao 1 - 2 digitos +0.9"},
{"op":"text_edit","id":"x35","text":"30","x":174.5,"y":35.68568,"h":2,"w":0.2,"orig_x":173.845225,"orig_y":34.869675,"orig_text":"30","orig_layer":"TopOverlay","note":"canal 30 - design da secao 1 - 2 digitos +0.9"},
{"op":"text_edit","id":"x34","text":"31","x":193.7,"y":35.68568,"h":2,"w":0.2,"orig_x":193.045225,"orig_y":34.869675,"orig_text":"31","orig_layer":"TopOverlay","note":"canal 31 - design da secao 1 - 2 digitos +0.9"},
{"op":"text_edit","id":"x33","text":"32","x":212.9,"y":35.68568,"h":2,"w":0.2,"orig_x":212.245225,"orig_y":34.869675,"orig_text":"32","orig_layer":"TopOverlay","note":"canal 32 - design da secao 1 - 2 digitos +0.9"},
// --- fusiveis girados 180 graus (design da secao 1: rot 270, ancora col+13.588) ---
{"op":"comp_move","ref":"F4","x":91.188,"y":75.797,"rot":270,"orig_x":83.188,"orig_y":75.797,"orig_rot":90,"orig_layer":"Top","note":"gira 180 igual secao 1 - pads nas mesmas posicoes"},
{"op":"comp_move","ref":"F5","x":110.388,"y":75.797,"rot":270,"orig_x":102.388,"orig_y":75.797,"orig_rot":90,"orig_layer":"Top","note":"gira 180 igual secao 1 - pads nas mesmas posicoes"},
{"op":"comp_move","ref":"F6","x":129.588,"y":75.797,"rot":270,"orig_x":121.588,"orig_y":75.797,"orig_rot":90,"orig_layer":"Top","note":"gira 180 igual secao 1 - pads nas mesmas posicoes"},
{"op":"comp_move","ref":"F10","x":206.388,"y":75.797,"rot":270,"orig_x":198.388,"orig_y":75.797,"orig_rot":90,"orig_layer":"Top","note":"gira 180 igual secao 1 - pads nas mesmas posicoes"},
{"op":"comp_move","ref":"F11","x":225.588,"y":75.797,"rot":270,"orig_x":217.588,"orig_y":75.797,"orig_rot":90,"orig_layer":"Top","note":"gira 180 igual secao 1 - pads nas mesmas posicoes"},
{"op":"comp_move","ref":"F12","x":148.788,"y":53.797,"rot":270,"orig_x":140.788,"orig_y":53.797,"orig_rot":90,"orig_layer":"Top","note":"gira 180 igual secao 1 - pads nas mesmas posicoes"},
{"op":"comp_move","ref":"F15","x":206.388,"y":53.797,"rot":270,"orig_x":198.388,"orig_y":53.797,"orig_rot":90,"orig_layer":"Top","note":"gira 180 igual secao 1 - pads nas mesmas posicoes"},
{"op":"comp_move","ref":"F16","x":225.588,"y":53.797,"rot":270,"orig_x":217.588,"orig_y":53.797,"orig_rot":90,"orig_layer":"Top","note":"gira 180 igual secao 1 - pads nas mesmas posicoes"},
{"op":"comp_move","ref":"F20","x":91.188,"y":53.797,"rot":270,"orig_x":83.188,"orig_y":53.797,"orig_rot":90,"orig_layer":"Top","note":"gira 180 igual secao 1 - pads nas mesmas posicoes"},
{"op":"comp_move","ref":"F21","x":110.388,"y":53.797,"rot":270,"orig_x":102.388,"orig_y":53.797,"orig_rot":90,"orig_layer":"Top","note":"gira 180 igual secao 1 - pads nas mesmas posicoes"},
{"op":"comp_move","ref":"F22","x":129.588,"y":53.797,"rot":270,"orig_x":121.588,"orig_y":53.797,"orig_rot":90,"orig_layer":"Top","note":"gira 180 igual secao 1 - pads nas mesmas posicoes"},
{"op":"comp_move","ref":"F26","x":110.388,"y":31.797,"rot":270,"orig_x":102.388,"orig_y":31.797,"orig_rot":90,"orig_layer":"Top","note":"gira 180 igual secao 1 - pads nas mesmas posicoes"},
{"op":"comp_move","ref":"F27","x":129.588,"y":31.797,"rot":270,"orig_x":121.588,"orig_y":31.797,"orig_rot":90,"orig_layer":"Top","note":"gira 180 igual secao 1 - pads nas mesmas posicoes"},
{"op":"comp_move","ref":"F28","x":148.788,"y":31.797,"rot":270,"orig_x":140.788,"orig_y":31.797,"orig_rot":90,"orig_layer":"Top","note":"gira 180 igual secao 1 - pads nas mesmas posicoes"},
{"op":"comp_move","ref":"F31","x":206.388,"y":31.797,"rot":270,"orig_x":198.388,"orig_y":31.797,"orig_rot":90,"orig_layer":"Top","note":"gira 180 igual secao 1 - pads nas mesmas posicoes"},
{"op":"comp_move","ref":"F32","x":225.588,"y":31.797,"rot":270,"orig_x":217.588,"orig_y":31.797,"orig_rot":90,"orig_layer":"Top","note":"gira 180 igual secao 1 - pads nas mesmas posicoes"},
];
