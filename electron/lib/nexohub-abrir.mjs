// Nexo Hub — garantir a conexão com o Hub na abertura de um programa (2.25.0). Node 18+, sem dependências: copie este
// arquivo para o processo principal do seu programa (Electron main, servidor local, CLI).
//
//   import { garantirHub } from "./nexohub-abrir.mjs";
//   const r = await garantirHub({ app: "nexocad" });   // {ok, url, abriu, login, sessao, erro?}
//
// O que faz: lê onde está o Hub (NEXOHUB_URL > C:\Users\Public\NexoHub\conexao.json > http://127.0.0.1:47800), confere se
// ele responde e, se não, abre o Nexo Hub instalado nesta máquina oculto na bandeja ("NexoHub.exe --oculto") e espera
// ele subir (até timeoutMs, padrão 45 s). Com o Hub no ar, devolve também a sessão (quem está logado).
// O Hub 2.25.0+ responde GET /api/v1/sessao; Hub mais antigo (sem login) responde 404 → login:false (o programa libera).
import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const URL_PADRAO = "http://127.0.0.1:47800";
const limpa = (u) => String(u).trim().replace(/\/+$/, "");

/** Onde está o Nexo Hub desta máquina: {url, origem}. */
export function conexaoHub() {
  if (process.env.NEXOHUB_URL) return { url: limpa(process.env.NEXOHUB_URL), origem: "ambiente" };
  const arq = process.env.NEXOHUB_CONEXAO || path.join(process.env.PUBLIC || "C:\\Users\\Public", "NexoHub", "conexao.json");
  try { const j = JSON.parse(readFileSync(arq, "utf8").replace(/^\uFEFF/, "")); if (j?.url) return { url: limpa(j.url), origem: arq }; } catch { /* sem arquivo */ }
  return { url: URL_PADRAO, origem: "padrão" };
}

/** A sessão do Hub: {noAr, login, logado, usuario, ...} — noAr:false = o Hub não respondeu. */
export async function sessaoHub(url = conexaoHub().url, { app = "", timeoutMs = 3000 } = {}) {
  try {
    const r = await fetch(`${limpa(url)}/api/v1/sessao`, { headers: app ? { "X-App": app } : {}, signal: AbortSignal.timeout(timeoutMs) });
    const j = await r.json().catch(() => null);
    if (r.status === 404 || !j) return { noAr: true, login: false, logado: true, usuario: null, antigo: true };
    return { noAr: true, login: true, ...j };
  } catch { return { noAr: false, login: false, logado: false, usuario: null }; }
}

const regQuery = (chave) => new Promise((ok) => {
  const exe = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "reg.exe");
  execFile(exe, ["query", chave, "/s", "/f", "Nexo Hub", "/d"], { windowsHide: true, timeout: 8000 }, (_e, out) => ok(String(out ?? "")));
});
/** O NexoHub.exe instalado nesta máquina (registro do desinstalador > Arquivos de Programas > AppData), ou null. */
export async function acharNexoHub() {
  if (process.platform !== "win32") return null;
  const candidatos = [];
  for (const raiz of ["HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall", "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall", "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall"]) {
    const txt = await regQuery(raiz);
    for (const bloco of txt.split(/\r?\n\r?\n/)) {
      if (!/DisplayName\s+REG_SZ\s+Nexo Hub\s*$/m.test(bloco)) continue;
      const loc = /InstallLocation\s+REG_\w+\s+(.+)$/m.exec(bloco)?.[1]?.trim();
      const icone = /DisplayIcon\s+REG_\w+\s+(.+)$/m.exec(bloco)?.[1]?.trim().replace(/^"|"?(,\d+)?$/g, "");
      if (loc) candidatos.push(path.join(loc.replace(/^"|"$/g, ""), "NexoHub.exe"));
      if (icone && /\.exe$/i.test(icone)) candidatos.push(icone);
    }
  }
  candidatos.push(
    path.join(process.env.ProgramFiles || "C:\\Program Files", "NexoHub", "NexoHub.exe"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Nexo Hub", "NexoHub.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "NexoHub", "NexoHub.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Nexo Hub", "NexoHub.exe"),
  );
  return candidatos.find((c) => c && /NexoHub\.exe$/i.test(c) && existsSync(c)) ?? null;
}

/** Abre o Nexo Hub oculto na bandeja (sem janela; o login aparece quando o programa pedir). */
export function abrirNexoHub(exe, { mostrar = false } = {}) {
  const pr = spawn(exe, mostrar ? [] : ["--oculto"], { detached: true, stdio: "ignore", windowsHide: false, cwd: path.dirname(exe) });
  pr.on("error", () => {});
  pr.unref();
}

let emAndamento = null;
/**
 * Garante o Hub no ar (abre se preciso). op: {app, url, timeoutMs, abrir (false = só confere), aoAbrir()}.
 * Devolve {ok, url, abriu, login, logado, usuario, erro?}.
 */
export function garantirHub(op = {}) {
  return (emAndamento ??= (async () => {
    const url = limpa(op.url ?? conexaoHub().url);
    let s = await sessaoHub(url, { app: op.app });
    if (s.noAr) return { ok: true, url, abriu: false, ...s };
    if (op.abrir === false) return { ok: false, url, abriu: false, ...s, erro: "O Nexo Hub não está aberto" };
    const exe = await acharNexoHub();
    if (!exe) return { ok: false, url, abriu: false, ...s, erro: "O Nexo Hub não está instalado nesta máquina: instale o Nexo Hub para usar este programa" };
    abrirNexoHub(exe);
    try { op.aoAbrir?.(exe); } catch { /* só aviso */ }
    const fim = Date.now() + (op.timeoutMs ?? 45_000);
    while (Date.now() < fim) {
      await new Promise((r) => setTimeout(r, 700));
      // o Hub pode ter subido noutra porta (sessão secundária): relê o ponteiro
      const u = limpa(op.url ?? conexaoHub().url);
      s = await sessaoHub(u, { app: op.app });
      if (s.noAr) return { ok: true, url: u, abriu: true, exe, ...s };
    }
    return { ok: false, url, abriu: true, exe, ...s, erro: "Abri o Nexo Hub, mas ele não respondeu a tempo" };
  })().finally(() => { emAndamento = null; }));
}
