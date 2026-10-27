#!/usr/bin/env node
// Migra o servidor central antigo (o hubserver em http://192.168.15.192:8100, o "servidor central" do NexoEletric até
// a 1.30) para o NexoBD, pelo caminho normal: o Nexo Hub desta máquina (127.0.0.1:47800), que repassa ao NexoBD.
// Só LÊ o central (HTTP e, se der, o compartilhamento \\192.168.15.192\altiumhub para listar as pastas): nada é
// apagado nem gravado lá.
//
//   node tools/nexobd/migrar-central.mjs [--simular] [--central http://192.168.15.192:8100]
//        [--pasta \\192.168.15.192\altiumhub\shared] [--url http://127.0.0.1:47800] [--relatorio arq.json]
//        [--sem-biblioteca]
//
// Por projeto do central (/api/index.json):
//  - não existe no NexoBD (chave nexoeletric-projeto = nome da pasta): cria o item e uma revisão com todos os arquivos;
//  - existe: arquivo a arquivo, o do central entra se o NexoBD não tem, ou se o do central é mais novo (data do
//    arquivo lá) que a revisão do NexoBD em que o arquivo atual entrou. Uma revisão nova com o que mudou (herdar: o
//    resto fica); o NexoBD guarda o histórico, nada se perde. Igual: nada.
//  - a BOM (item "BOM: <projeto>", chave nexoeletric-bom = o id do link): os vistos do central (/api/bom/<id>/vistos,
//    somados aos que o NexoBD já tem), as opções (/opts, se o NexoBD não tem) e a fonte (/api/bom/<id>/source, o
//    gerador do central) quando o board.js/schematic.js do NexoBD são os mesmos do central.
// A biblioteca (Libs) NÃO é migrada: o sincronismo do Odoo no NexoBD é a fonte dela. O script compara e relata o que o
// central tem de diferente (--sem-biblioteca pula).
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.join(AQUI, "..", "..", "electron", "lib");
const { criarCliente } = await import(pathToFileURL(path.join(LIB, "nexohub-cliente.mjs")).href);
const esp = await import(pathToFileURL(path.join(LIB, "espelho-nexobd.mjs")).href);

const APP = "nexoeletric-migracao";
const SISTEMA_BOM = "nexoeletric-bom";
// sem a listagem do compartilhamento: os nomes que os scripts do Altium e o hub escrevem numa pasta de projeto
const NOMES_CONHECIDOS = ["board.js", "schematic.js", "changes.js", "annotations.js", "rules.js", "board3d.js", "pcb-list.csv",
  "history.jsonl", "build-report.txt", "apply-report.txt", "lista-extras.json", "odoo-lista.json", "bom-opts.json", "bom-vistos.json", "Gerber/gerber.json"];
// estado (não sai de export): falta no NexoBD, entra
const ESTADO = new Set(["bom-opts.json", "bom-vistos.json", "odoo-lista.json", "lista-extras.json", "annotations.js", "history.jsonl"]);
const IGNORA = (rel) => esp.LIXO(rel) || /\.bak($|[-.])/i.test(rel);

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const slugProjeto = (nome) => String(nome || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "proj";
const jsonCanonico = (v) => {
  const ord = (x) => (Array.isArray(x) ? x.map(ord) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, ord(x[k])])) : x);
  return JSON.stringify(ord(v));
};
const quando = (ms) => (ms ? new Date(ms).toISOString().replace("T", " ").slice(0, 19) : "?");

export function lerArgs(argv) {
  const a = { simular: false, central: "http://192.168.15.192:8100", pasta: "\\\\192.168.15.192\\altiumhub\\shared", url: null, relatorio: null, biblioteca: true };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--simular") a.simular = true;
    else if (k === "--sem-biblioteca") a.biblioteca = false;
    else if (["--central", "--pasta", "--url", "--relatorio"].includes(k)) a[k.slice(2)] = argv[++i];
    else throw new Error(`opção desconhecida: ${k}`);
  }
  a.central = a.central.replace(/\/+$/, "");
  return a;
}

async function http(url, { json = false, timeout = 60000 } = {}) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeout), cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
  if (json) return r.json();
  return { bytes: Buffer.from(await r.arrayBuffer()), mtime: Date.parse(r.headers.get("last-modified") || "") || 0 };
}
const urlArq = (central, nome, rel) => `${central}/Projects/${encodeURIComponent(nome)}/${rel.split("/").map(encodeURIComponent).join("/")}`;

/** Os arquivos de um projeto no central: {rel: {bytes, sha, mtime}}. Lista pelo compartilhamento (se der); lê por HTTP. */
async function arquivosDoCentral(a, nome) {
  const out = {};
  const pastaProj = a.pasta ? path.join(a.pasta, "Projects", nome) : null;
  let rels = null;
  if (pastaProj) {
    try {
      rels = [];
      const anda = (dir, base) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const rel = base ? `${base}/${e.name}` : e.name;
          if (IGNORA(rel)) continue;
          if (e.isDirectory()) anda(path.join(dir, e.name), rel); else if (e.isFile()) rels.push(rel);
        }
      };
      anda(pastaProj, "");
    } catch { rels = null; }
  }
  const pelaPasta = rels != null;
  if (!pelaPasta) rels = [...NOMES_CONHECIDOS];
  for (const rel of rels) {
    let f = null;
    try { f = await http(urlArq(a.central, nome, rel)); } catch { f = null; }
    if (!f && pelaPasta) {                                     // o hubserver não serve tudo (estado da bancada): lê da pasta
      try { const abs = path.join(pastaProj, ...rel.split("/")); f = { bytes: readFileSync(abs), mtime: statSync(abs).mtimeMs }; } catch { f = null; }
    } else if (f && pelaPasta) {
      try { f.mtime = statSync(path.join(pastaProj, ...rel.split("/"))).mtimeMs; } catch { /* fica a do HTTP */ }
    }
    if (!f) continue;
    out[rel] = { ...f, sha: sha256(f.bytes) };
  }
  // sem a pasta: o Gerber listado no manifesto
  if (!pelaPasta && out["Gerber/gerber.json"]) {
    try {
      const man = JSON.parse(out["Gerber/gerber.json"].bytes.toString("utf8"));
      for (const x of Object.values(man.arquivos ?? man.files ?? {})) {
        const n = typeof x === "string" ? x : x?.nome ?? x?.arquivo;
        if (!n || out[`Gerber/${n}`]) continue;
        const f = await http(urlArq(a.central, nome, `Gerber/${n}`)).catch(() => null);
        if (f) out[`Gerber/${n}`] = { ...f, sha: sha256(f.bytes) };
      }
    } catch { /* manifesto ilegível */ }
  }
  return { arquivos: out, pelaPasta };
}

/** Em que data o arquivo `papel` passou a ter o sha atual no NexoBD (revisões do mais novo ao mais velho). */
function desdeQuando(revisoes, papel, sha) {
  let data = null;
  for (const r of revisoes) {                                  // ordem: numero DESC
    if (r.arquivos?.[papel]?.sha256 !== sha) break;
    data = r.criado_em;
  }
  return data ? Date.parse(data) : 0;
}

async function migrarProjeto({ a, cliente, p, log }) {
  const nome = p.name;
  const id = p.id || slugProjeto(nome);
  const res = { nome, id, acao: "", arquivos: [], deCentral: 0, bom: "" };
  if (!esp.nomeDePastaOk(nome)) return { ...res, acao: "ignorado", motivo: "nome que não dá pasta no Windows" };
  const { arquivos: central, pelaPasta } = await arquivosDoCentral(a, nome);
  res.deCentral = Object.keys(central).length;
  res.listagem = pelaPasta ? "compartilhamento" : "nomes conhecidos (HTTP)";
  if (!res.deCentral) return { ...res, acao: "ignorado", motivo: "a pasta do projeto no central está vazia" };

  let it = await cliente.chave(esp.SISTEMA_PROJETO, nome);
  if (it?.apagado_em) it = null;
  const nota = `migrado do servidor central (${a.central.replace(/^https?:\/\//, "")})`;
  const paraSubir = {};
  if (!it) {
    res.acao = "novo";
    for (const [rel, f] of Object.entries(central)) { paraSubir[esp.papelDe(rel)] = { bytes: f.bytes, nome: rel }; res.arquivos.push(rel); }
  } else {
    const noBD = esp.arquivosDoItem(it);                       // {rel: {sha, papel}}
    const revisoes = await cliente.revisoes(it.id);
    for (const [rel, f] of Object.entries(central)) {
      const b = noBD[rel];
      if (b && b.sha === f.sha) continue;
      if (b) {
        const desde = desdeQuando(revisoes, b.papel, b.sha);
        if (!(f.mtime > desde)) { res.mantidos = [...(res.mantidos ?? []), `${rel} (NexoBD ${quando(desde)} ≥ central ${quando(f.mtime)})`]; continue; }
        paraSubir[b.papel] = { bytes: f.bytes, nome: rel };
      } else {
        // falta no NexoBD: o estado da bancada/Odoo entra sempre; o que sai de um export (pcb-list.csv, relatórios) só
        // se for mais novo que a última revisão do NexoBD (senão seria de um export mais velho que a placa de lá)
        const ultima = Date.parse(revisoes[0]?.criado_em ?? "") || 0;
        if (!ESTADO.has(rel) && !(f.mtime > ultima)) { res.mantidos = [...(res.mantidos ?? []), `${rel} (só no central, de ${quando(f.mtime)}, mais velho que a revisão ${it.rev} do NexoBD)`]; continue; }
        paraSubir[esp.papelDe(rel)] = { bytes: f.bytes, nome: rel };
      }
      res.arquivos.push(rel);
    }
    res.acao = res.arquivos.length ? "atualizado" : "igual";
  }
  if (res.arquivos.length && !a.simular) {
    if (!it) { it = await cliente.criarItem({ ...esp.alvoProjeto(nome).criar, chaves: [{ sistema: esp.SISTEMA_PROJETO, chave: nome }], app: APP }); log(`  + item ${it.id} criado`); }
    const rv = await cliente.novaRevisao(it.id, { arquivos: paraSubir, herdar: res.acao === "atualizado", base: it.rev || 0, nota, app: APP });
    res.revisao = rv.numero ?? rv.rev;
    it = await cliente.item(it.id);
  }
  res.item = it?.id ?? null;

  // ---- a BOM: vistos, opções e a fonte do central
  const [vis, opt] = await Promise.all([
    http(`${a.central}/api/bom/${encodeURIComponent(id)}/vistos`, { json: true }).catch(() => null),
    http(`${a.central}/api/bom/${encodeURIComponent(id)}/opts`, { json: true }).catch(() => null),
  ]);
  const vistosCentral = vis?.ok && vis.vistos && typeof vis.vistos === "object" ? vis.vistos : {};
  const optsCentral = opt?.ok && opt.opts && typeof opt.opts === "object" ? opt.opts : null;
  const finalBoard = it ? esp.arquivosDoItem(it)["board.js"]?.sha : central["board.js"]?.sha;
  const finalSch = it ? esp.arquivosDoItem(it)["schematic.js"]?.sha ?? null : central["schematic.js"]?.sha ?? null;
  const fonteDoCentralServe = central["board.js"] && finalBoard === central["board.js"].sha && finalSch === (central["schematic.js"]?.sha ?? null);
  if (!central["board.js"] && !Object.keys(vistosCentral).length) { res.bom = "sem board.js: sem BOM"; return res; }

  let bomIt = await cliente.chave(SISTEMA_BOM, id);
  if (bomIt?.apagado_em) bomIt = null;
  const arqsBom = bomIt?.arquivos ?? {};
  const arquivos = {};
  const partes = [];
  // vistos: soma (o NexoBD pode já ter vistos da bancada)
  if (Object.keys(vistosCentral).length) {
    let ja = {};
    if (arqsBom["vistos.json"]) { try { ja = JSON.parse(Buffer.from(await cliente.blob(arqsBom["vistos.json"].sha256)).toString("utf8")); } catch { ja = {}; } }
    const soma = { ...ja };
    for (const [k, v] of Object.entries(vistosCentral)) if (v) soma[k] = true;
    const txt = jsonCanonico(soma);
    if (!arqsBom["vistos.json"] || arqsBom["vistos.json"].sha256 !== sha256(txt)) { arquivos["vistos.json"] = { bytes: Buffer.from(txt), nome: "vistos.json" }; partes.push(`${Object.keys(vistosCentral).length} visto(s)`); }
  }
  if (optsCentral && !arqsBom["opts.json"]) { arquivos["opts.json"] = { bytes: Buffer.from(jsonCanonico(optsCentral)), nome: "opts.json" }; partes.push("opções"); }
  if (fonteDoCentralServe) {
    let fontesLa = null;
    if (arqsBom["fonte.json"]) { try { fontesLa = JSON.parse(Buffer.from(await cliente.blob(arqsBom["fonte.json"].sha256)).toString("utf8")).fontes ?? null; } catch { fontesLa = null; } }
    if (!fontesLa || fontesLa.board !== finalBoard || (fontesLa.schematic ?? null) !== finalSch) {
      const src = await http(`${a.central}/api/bom/${encodeURIComponent(id)}/source`, { json: true, timeout: 120000 }).catch(() => null);
      if (src?.ok && src.board) {
        const tag = sha256(`${finalBoard}|${finalSch || ""}`).slice(0, 12);
        arquivos["fonte.json"] = { bytes: Buffer.from(JSON.stringify({ ok: true, projeto: nome, board: src.board, sourceRev: tag, fontes: { board: finalBoard, schematic: finalSch }, gerado_em: new Date().toISOString(), gerador: `servidor central (${a.central})` })), nome: "fonte.json" };
        partes.push(`fonte (${(src.board.components ?? []).length} componentes)`);
      }
    }
  } else if (central["board.js"]) partes.push("fonte: fica para o NexoEletric (o board/esquema do NexoBD é mais novo que o do central)");
  res.bom = partes.join(", ") || "igual";
  if (Object.keys(arquivos).length && !a.simular) {
    if (!bomIt) bomIt = await cliente.criarItem({ tipo: "outro", categoria: "nexoeletric", nome: `BOM: ${nome}`, descricao: `A BOM do projeto para a bancada: o NexoBD serve em /bom/${id}`, atributos: { programa: "nexoeletric", projeto: nome, id }, chaves: [{ sistema: SISTEMA_BOM, chave: id }], app: APP });
    const rv = await cliente.novaRevisao(bomIt.id, { arquivos, herdar: true, base: bomIt.rev || 0, forcar: true, nota: `BOM ${nota}`, app: APP });
    res.bomItem = bomIt.id; res.bomRevisao = rv.numero ?? rv.rev;
  }
  return res;
}

/** Compara a biblioteca do central (Libs) com o item da biblioteca no NexoBD. Só relata. */
async function compararBiblioteca({ a, cliente }) {
  const pasta = a.pasta ? path.join(a.pasta, "Libs") : null;
  if (!pasta || !existsSync(pasta)) return { erro: "sem acesso ao compartilhamento do central para listar a biblioteca" };
  const it = await cliente.chave(esp.SISTEMA_BIBLIOTECA, "principal");
  if (!it) return { erro: "o NexoBD não tem a biblioteca do NexoEletric" };
  const noBD = esp.arquivosDoItem(it);
  const revisoes = await cliente.revisoes(it.id);
  const central = esp.lerPasta(pasta, { aceita: (rel) => !/^3d(\/|$)/i.test(rel) && rel !== "pcblib-3d.js" && !/\.bak($|[-.])/i.test(rel) });
  const out = { iguais: 0, soNoCentral: [], soNoNexoBD: [], centralMaisNovo: [], nexobdMaisNovo: [], revisaoNexoBD: it.rev };
  for (const [rel, f] of Object.entries(central)) {
    const b = noBD[rel];
    let mtime = 0;
    try { mtime = statSync(path.join(pasta, ...rel.split("/"))).mtimeMs; } catch { /* sem data */ }
    if (!b) { out.soNoCentral.push(`${rel} (${quando(mtime)})`); continue; }
    if (b.sha === f.sha) { out.iguais++; continue; }
    const desde = desdeQuando(revisoes, b.papel, b.sha);
    (mtime > desde ? out.centralMaisNovo : out.nexobdMaisNovo).push(`${rel} (central ${quando(mtime)}, NexoBD ${quando(desde)})`);
  }
  for (const rel of Object.keys(noBD)) if (!central[rel]) out.soNoNexoBD.push(rel);
  return out;
}

export async function migrar(a, log = console.log) {
  const cliente = criarCliente({ ...(a.url ? { url: a.url } : {}), app: APP });
  const s = await cliente.saude();
  if (s.bd && s.bd.ok === false) throw new Error(`o Nexo Hub está sem o NexoBD: ${s.bd.erro ?? ""}`);
  log(`Nexo Hub ${s.versao ?? "?"} → NexoBD ${s.bd?.versao ?? s.versao} em ${s.bd?.url ?? "?"} (${s.bd?.dados ?? s.dados})${a.simular ? "  [SIMULANDO: nada é gravado]" : ""}`);
  await esp.garantirCategoriaInterna(cliente);
  const idx = await http(`${a.central}/api/index.json`, { json: true });
  if (!idx?.projects) throw new Error(`o central não devolveu /api/index.json em ${a.central}`);
  log(`central ${a.central}: ${idx.projects.length} projeto(s)`);
  const projetos = [];
  for (const p of idx.projects) {
    try {
      const r = await migrarProjeto({ a, cliente, p, log });
      projetos.push(r);
      log(`- ${r.nome}: ${r.acao}${r.motivo ? ` (${r.motivo})` : ""}${r.arquivos.length ? ` — ${r.arquivos.length} arquivo(s): ${r.arquivos.join(", ")}` : ""}${r.mantidos?.length ? ` — mantidos do NexoBD: ${r.mantidos.join("; ")}` : ""} | BOM: ${r.bom || "—"}`);
    } catch (err) {
      projetos.push({ nome: p.name, id: p.id, acao: "erro", erro: err.message });
      log(`- ${p.name}: ERRO ${err.message}`);
    }
  }
  let biblioteca = null;
  if (a.biblioteca) {
    biblioteca = await compararBiblioteca({ a, cliente }).catch((err) => ({ erro: err.message }));
    if (biblioteca.erro) log(`biblioteca: ${biblioteca.erro}`);
    else log(`biblioteca (só comparada, nada gravado): ${biblioteca.iguais} iguais; só no central ${biblioteca.soNoCentral.length}; central mais novo ${biblioteca.centralMaisNovo.length}; NexoBD mais novo ${biblioteca.nexobdMaisNovo.length}; só no NexoBD ${biblioteca.soNoNexoBD.length}`);
  }
  const rel = { quando: new Date().toISOString(), simular: a.simular, central: a.central, nexobd: s.bd ?? null, projetos, biblioteca };
  if (a.relatorio) writeFileSync(a.relatorio, JSON.stringify(rel, null, 2));
  return rel;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const r = await migrar(lerArgs(process.argv.slice(2)));
    const n = (x) => r.projetos.filter((p) => p.acao === x).length;
    console.log(`\nfim: ${n("novo")} novo(s), ${n("atualizado")} atualizado(s), ${n("igual")} igual(is), ${n("ignorado")} ignorado(s), ${n("erro")} erro(s)`);
    process.exit(n("erro") ? 1 : 0);
  } catch (err) { console.error(`ERRO: ${err.message}`); process.exit(2); }
}
