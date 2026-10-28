'use strict';
// Parametros com que o app sobe o Python embutido: python.exe -E -s -X utf8 -u <script> ...
//   -E  ignora toda variavel PYTHON* -- e, sem ambiente, o runtime tambem nao le o PythonPath do
//       registro (HKCU\Software\Python\PythonCore\3.12): numa maquina com o Python 3.12 instalado
//       ele carregava o _ctypes.pyd DELE e o import do flask (click -> colorama -> ctypes) derrubava
//       o processo com 0xC0000005. Medido em 2026-10-28.
//   -s  sem a pasta site-packages do usuario (era o PYTHONNOUSERSITE).
//   -X utf8, -u  o que o PYTHONUTF8/PYTHONIOENCODING e o PYTHONUNBUFFERED faziam, que o -E desliga:
//       log em UTF-8 e linha a linha.
// Os filhos que o hub sobe com sys.executable nao herdam parametro, so o ambiente: para eles o
// ambiente continua com PYTHONHOME (a pasta do python.exe) e as variaveis de antes.
const PY_FLAGS = Object.freeze(['-E', '-s', '-X', 'utf8', '-u']);

module.exports = { PY_FLAGS };
