#!/usr/bin/env node
// Leva os projetos do NexoEletric (pastas Projects/<projeto>/ com schematic.js, board.js, changes.js...) para o NexoBD,
// pelo Nexo Hub: um item tipo 'projeto' por pasta (chave nexoeletric-projeto = nome da pasta), um papel por arquivo
// (o caminho relativo, "limpo"; o nome original vai no arquivo) e uma revisão por cópia diferente do projeto.
//   node tools/nexobd/importar-projetos.mjs --origem servidor=<pasta Projects> --origem local=<pasta Projects> [--simular]
//        [--url http://127.0.0.1:47800] [--relatorio relatorio.json]
// Mesma pasta em mais de uma origem: cópias iguais viram uma revisão só; diferentes viram revisões em ordem (a de
// arquivo mais recente por último, que fica sendo a atual) — nada é misturado arquivo a arquivo. Pode rodar de novo:
// projeto que já está no NexoBD com o mesmo conteúdo fica como está; com conteúdo diferente, é avisado e não mexido.
// Fica de fora: backups (*.bak, *.bak-<data>) e a lixeira.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { criarCliente } from "../../electron/lib/nexohub-cliente.mjs";

export const SISTEMA = "nexoeletric-projeto";
const IGNORA = (rel) => /\.bak($|[-.])/i.test(rel) || /(^|\/)(Trash|\.altiumhub)(\/|$)/i.test(rel);

/** O caminho relativo do arquivo → papel aceito pelo NexoBD ([a-z0-9._-] por trecho, sem começar com ponto). */
export function papelDe(rel) {
  return rel.split("/").map((t) => {
    let s = t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_");
    if (!/^[A-Za-z0-9]/.test(s)) s = `x${s}`;
    return s;
  }).join("/").slice(0, 160);
}

/** {rel: {bytes, sha, mtime}} de uma pasta de projeto (recursivo). */
export function lerProjeto(pasta) {
  const out = {};
  const anda = (dir, base) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const rel = base ? `${base}/${e.name}` : e.name;
      if (IGNORA(rel)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) anda(abs, rel);
      else if (e.isFile()) { const bytes = readFileSync(abs); out[rel] = { bytes, sha: createHash("sha256").update(bytes).digest("hex"), mtime: statSync(abs).mtimeMs }; }
    }
  };
  anda(pasta, "");
  return out;
}

const assinatura = (arqs) => JSON.stringify(Object.keys(arqs).sort().map((k) => [papelDe(k), arqs[k].sha]));
const maisNovo = (arqs) => Math.max(0, ...Object.values(arqs).map((a) => a.mtime));
const dia = (ms) => new Date(ms).toLocaleString("pt-BR");

/** Compara duas cópias: arquivos só numa, e os diferentes com a data de cada lado. */
function diferencas(a, b) {
  const nomes = [...new Set([...Object.keys(a.arquivos), ...Object.keys(b.arquivos)])].sort();
  return nomes.flatMap((n) => {
    const x = a.arquivos[n], y = b.arquivos[n];
    if (!x) return [`${n}: só em ${b.origem}`];
    if (!y) return [`${n}: só em ${a.origem}`];
    return x.sha === y.sha ? [] : [`${n}: ${a.origem} ${dia(x.mtime)} × ${b.origem} ${dia(y.mtime)}`];
  });
}

export async function importarProjetos({ origens, cliente, simular = false, log = console.log }) {
  const porProjeto = new Map();
  for (const { nome: origem, pasta } of origens) {
    for (const e of readdirSync(pasta, { withFileTypes: true })) {
      if (!e.isDirectory() || IGNORA(e.name)) continue;
      const arquivos = lerProjeto(path.join(pasta, e.name));
      if (!Object.keys(arquivos).length) continue;
      if (!porProjeto.has(e.name)) porProjeto.set(e.name, []);
      porProjeto.get(e.name).push({ origem, arquivos });
    }
  }
  const relatorio = [];
  for (const [projeto, copias] of [...porProjeto].sort(([a], [b]) => a.localeCompare(b))) {
    // cópias iguais viram uma (as origens juntas); diferentes, em ordem do arquivo mais recente
    const unicas = [];
    for (const c of copias) {
      const igual = unicas.find((u) => assinatura(u.arquivos) === assinatura(c.arquivos));
      if (igual) igual.origem += ` + ${c.origem}`; else unicas.push({ ...c });
    }
    unicas.sort((a, b) => maisNovo(a.arquivos) - maisNovo(b.arquivos));
    const r = { projeto, revisoes: unicas.map((u) => ({ origem: u.origem, arquivos: Object.keys(u.arquivos).length, ate: dia(maisNovo(u.arquivos)) })), diferencas: [] };
    for (let i = 1; i < unicas.length; i++) r.diferencas.push(...diferencas(unicas[i - 1], unicas[i]));

    const ja = await cliente.chave(SISTEMA, projeto);
    if (ja) {
      const it = await cliente.item(ja.id);
      const atual = JSON.stringify(Object.entries(it.arquivos ?? {}).filter(([p]) => !p.startsWith("saida/") && p !== "thumb").map(([p, a]) => [p, a.sha256]).sort());
      const nova = assinatura(unicas.at(-1).arquivos);
      r.item = ja.id;
      r.estado = atual === nova ? "já estava no NexoBD (igual)" : "já está no NexoBD com conteúdo diferente: não mexi";
      relatorio.push(r);
      log(`= ${projeto}: ${r.estado}`);
      continue;
    }
    if (simular) { r.estado = "simulado"; relatorio.push(r); log(`~ ${projeto}: ${unicas.length} revisão(ões) [${unicas.map((u) => u.origem).join(" → ")}]`); continue; }

    const it = await cliente.criarItem({ tipo: "projeto", categoria: "projetos/eletronica", nome: projeto, atributos: { programa: "nexoeletric", pasta: projeto }, chaves: [{ sistema: SISTEMA, chave: projeto }] });
    let base = it.rev ?? 0;
    for (const u of unicas) {
      const arquivos = Object.fromEntries(Object.entries(u.arquivos).map(([rel, a]) => [papelDe(rel), { bytes: a.bytes, nome: rel }]));
      const rv = await cliente.novaRevisao(it.id, { arquivos, base, app: "nexoeletric", nota: `importado da pasta (${u.origem}; arquivos até ${dia(maisNovo(u.arquivos))})` });
      base = rv.rev;
    }
    r.item = it.id; r.estado = `importado: ${unicas.length} revisão(ões)`;
    relatorio.push(r);
    log(`+ ${projeto} → ${it.id} (${unicas.map((u) => u.origem).join(" → ")})`);
  }
  return relatorio;
}

// ---------------------------------------------------------------- linha de comando
const aqui = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
if (aqui) {
  const args = process.argv.slice(2);
  const origens = [];
  let url, relatorioArq, simular = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--origem") { const [nome, ...p] = String(args[++i]).split("="); origens.push({ nome, pasta: p.join("=") }); }
    else if (args[i] === "--url") url = args[++i];
    else if (args[i] === "--relatorio") relatorioArq = args[++i];
    else if (args[i] === "--simular") simular = true;
  }
  if (!origens.length) { console.error("uso: importar-projetos.mjs --origem <nome>=<pasta Projects> [--origem ...] [--simular] [--url ...] [--relatorio arq.json]"); process.exit(2); }
  const cliente = criarCliente({ ...(url ? { url } : {}), app: "nexoeletric-importar" });
  const rel = await importarProjetos({ origens, cliente, simular });
  if (relatorioArq) writeFileSync(relatorioArq, JSON.stringify(rel, null, 2));
  const dif = rel.filter((r) => r.diferencas.length);
  if (dif.length) { console.log("\nCópias diferentes (a última da lista é a atual):"); for (const r of dif) { console.log(`- ${r.projeto}: ${r.revisoes.map((v) => `${v.origem} (até ${v.ate})`).join(" → ")}`); for (const d of r.diferencas) console.log(`    ${d}`); } }
}
