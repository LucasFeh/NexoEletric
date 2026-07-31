const fs = require('fs'), path = require('path');
// Carrega um arquivo "var X = {...};" e devolve o valor de X.
function loadVar(rel, name){
  const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  return new Function(src + ';return ' + name + ';')();
}
module.exports = { loadVar };
