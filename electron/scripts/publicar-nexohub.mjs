// Fim do "npm run dist": publica o instalador desta versão do NexoEletric na central de instalação do Nexo Hub
// (aba Programas do app Nexo Hub e do catálogo). Usa a ferramenta do repositório nexohub (NEXOHUB_REPO, ou
// C:\Users\<voce>\nexohub); notas = a seção da versão no CHANGELOG.md. Sem a ferramenta ou com o Nexo Hub fora
// do ar, só avisa: o build não falha por isso. Uso: node scripts/publicar-nexohub.mjs [pasta-de-saida]
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ELECTRON = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const versao = JSON.parse(readFileSync(path.join(ELECTRON, "package.json"), "utf8")).version;
// NEXOHUB_REPO, C:\Users\<voce>\nexohub, ou o repositório ao lado deste (D:\Pessoal\NexoHub)
const repo = [process.env.NEXOHUB_REPO, path.join(os.homedir(), "nexohub"), path.resolve(ELECTRON, "..", "..", "NexoHub")]
  .filter(Boolean).find((d) => existsSync(path.join(d, "tools", "publicar-instalador.mjs"))) ?? path.join(os.homedir(), "nexohub");
const tool = path.join(repo, "tools", "publicar-instalador.mjs");
if (!existsSync(tool)) { console.warn(`[nexohub] ${tool} não existe — instalador não publicado`); process.exit(0); }

const nome = `NexoEletric-Setup-${versao}.exe`;
const pastaArg = process.argv.slice(2).find((a) => !a.startsWith("-"));
const pastas = pastaArg ? [path.resolve(pastaArg)] : readdirSync(ELECTRON).filter((d) => /^dist/.test(d)).map((d) => path.join(ELECTRON, d));
const achados = pastas.map((d) => path.join(d, nome)).filter(existsSync).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
if (!achados.length) { console.warn(`[nexohub] ${nome} não encontrado em dist*/`); process.exit(0); }

let commit = "";
try { commit = execFileSync("git", ["-c", "safe.directory=*", "rev-parse", "--short", "HEAD"], { cwd: ELECTRON, encoding: "utf8" }).trim(); } catch { /* sem git */ }
const r = spawnSync(process.execPath, [tool, "nexoeletric", versao, achados[0], "--notas-arquivo", path.join(ELECTRON, "CHANGELOG.md"), "--commit", commit, "--nome", "NexoEletric", "--opcional"], { stdio: "inherit" });
process.exit(r.status ?? 0);
