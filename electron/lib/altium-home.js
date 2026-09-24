'use strict';
// C:\ProgramData\AltiumPCBMirror\home.txt: onde os quatro scripts do Altium procuram o
// workspace (ExportProject.pas, HOME_CFG). A chave home= VENCE a lista de candidatos
// embutidos -- e o unico jeito de o Altium desta maquina exportar para a pasta local em
// vez do share do servidor.
//
// Mesmo formato do HomeCfgSet dos .pas: "chave=valor" por linha, ; e # sao comentario,
// a primeira ocorrencia da chave e reescrita e as repetidas somem, o resto fica como esta.
// O arquivo e da MAQUINA (ProgramData), nao do usuario: trocar aqui troca para todo mundo
// que usa o Altium neste PC. Por isso so acontece com o usuario pedindo.
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(process.env.ProgramData || 'C:\\ProgramData', 'AltiumPCBMirror');
const ARQ = path.join(DIR, 'home.txt');
const MARCA = 'AI-GUIDE.md';            // HOME_MARCA: o que o HomeValida procura
const SERVIDOR = '\\\\192.168.15.192\\altiumhub\\current';

const CABECALHO = [
  '; AltiumPCBMirror - configuracao DESTA maquina. Edite no Bloco de Notas.',
  '; Uma "chave=valor" por linha; linha vazia ou comecando por ; ou # e ignorada.',
  ';   home   = raiz do workspace (a pasta que tem o AI-GUIDE.md)  [obrigatoria]',
  ';   schlib = .SchLib da casa                                    [opcional]',
  ';   pcblib = .PcbLib da casa                                    [opcional]',
];

function lerLinhas() {
  let txt;
  try {
    txt = fs.readFileSync(ARQ, 'utf8');
  } catch {
    return null;
  }
  if (txt.charCodeAt(0) === 0xfeff) txt = txt.slice(1);
  return txt.split(/\r?\n/);
}

function chaveDe(linha) {
  const t = linha.trim();
  if (!t || t[0] === ';' || t[0] === '#') return null;
  const p = t.indexOf('=');
  return p > 0 ? t.slice(0, p).trim().toUpperCase() : null;
}

function get(chave = 'home') {
  const linhas = lerLinhas();
  if (!linhas) return '';
  let v = '';
  for (const l of linhas) {                   // a ULTIMA vence, como no HomeCfgGet
    if (chaveDe(l) === chave.toUpperCase()) v = l.trim().slice(l.trim().indexOf('=') + 1).trim();
  }
  return v.replace(/\\+$/, '');
}

function set(valor, chave = 'home') {
  const linhas = lerLinhas();
  const out = linhas && linhas.some((l) => l.trim()) ? [] : [...CABECALHO];
  let achou = false;
  for (const l of linhas || []) {
    if (chaveDe(l) === chave.toUpperCase()) {
      if (!achou) out.push(`${chave}=${valor}`);
      achou = true;
    } else {
      out.push(l);
    }
  }
  if (!achou) out.push(`${chave}=${valor}`);
  while (out.length && out[out.length - 1] === '') out.pop();
  fs.mkdirSync(DIR, { recursive: true });
  // UTF-8 com BOM e CRLF: o TStringList.LoadFromFile do Altium le assim sem adivinhar
  // codificacao, e um caminho com acento (C:\Users\João) chega inteiro.
  fs.writeFileSync(ARQ, '\ufeff' + out.join('\r\n') + '\r\n', 'utf8');
  return get(chave);
}

// Os dois caminhos que os .pas trocam sozinhos pelo servidor (RaizAposentada, 2026-09-15).
const APOSENTADAS = ['\\\\LUCAS-PC\\D\\MICROCONTROLLER_DEV\\AltiumIA\\AltiumPCBMirror',
  'D:\\MICROCONTROLLER_DEV\\AltiumIA\\AltiumPCBMirror'];

function aposentada(p) {
  const n = String(p || '').replace(/[\\/]+$/, '').toLowerCase();
  return APOSENTADAS.some((a) => a.toLowerCase() === n);
}

function status(workspace) {
  const home = get('home');
  const norm = (p) => path.resolve(p).toLowerCase();
  // Caminho de rede nao e conferido aqui: um existsSync num share fora do ar trava o
  // processo principal pelos segundos do timeout do SMB. null = "nao conferido".
  const rede = home.startsWith('\\\\');
  return {
    arquivo: ARQ,
    home,
    apontaParaCa: Boolean(home && workspace && norm(home) === norm(workspace)),
    homeValida: home ? (rede ? null : fs.existsSync(path.join(home, MARCA))) : false,
    servidor: SERVIDOR,
  };
}

module.exports = { get, set, status, aposentada, ARQ, SERVIDOR, MARCA };
