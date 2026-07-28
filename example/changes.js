// AltiumPCBMirror - arquivo de mudancas (EXEMPLO).
// Edite ESTE arquivo (nunca o board.js). Um objeto JSON por linha. Consulte AI-GUIDE.md.
var changes = [
{"op":"comp_move","ref":"R1","x":10,"y":24,"rot":90,"layer":"Top","orig_x":10,"orig_y":20,"orig_rot":0,"orig_layer":"Top","note":"afastar R1 do C1"},
{"op":"track_edit","id":"t1","w":0.5,"orig_x1":10.8,"orig_y1":20,"orig_x2":14,"orig_y2":20,"orig_w":0.3,"orig_layer":"Top","note":"engrossar trilha NET1"},
{"op":"track_del","id":"t3","orig_x1":9.2,"orig_y1":20,"orig_x2":9.2,"orig_y2":22,"orig_w":0.3,"orig_layer":"Top","note":"trilha orfa apos mover R1"},
{"op":"via_add","x":16,"y":22,"size":0.6,"drill":0.3,"net":"NET1","note":"nova via de costura"},
{"op":"comp_move","ref":"D1","x":30,"y":5,"rot":0,"layer":"Bottom","orig_x":30,"orig_y":8,"orig_rot":0,"orig_layer":"Bottom","note":"descer D1"}
];
