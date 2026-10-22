// Nexo Hub — espelho pasta ⇄ item do NexoBD (Node 18+). Sem dependências além do nexohub-cliente.mjs: copie os dois
// para o seu projeto (o NexoEletric guarda uma cópia idêntica em electron/lib/).
//
// Um item do NexoBD guarda uma pasta: um papel por arquivo (o caminho "limpo", papelDe) com o caminho de verdade no
// nome do arquivo, e cada mudança é uma revisão nova com a lista inteira (os blobs que não mudaram não sobem de novo).
// A pasta local é só cópia: apagar a pasta não apaga nada no NexoBD, ela volta inteira na próxima rodada.
//
//   modo 'ambos'  : três vias contra a última rodada (estado.base). Mudou só de um lado, vale esse lado; mudou dos dois
//                   com conteúdo diferente, vale o local e a cópia do NexoBD vai para a pasta de conflitos.
//   modo 'baixar' : a pasta fica igual ao NexoBD (a do Altium no Nexo Hub: a biblioteca e os scripts).
//   modo 'subir'  : o NexoBD fica igual à pasta (os scripts do Altium que o NexoEletric traz no instalador).
//
// O que o NexoEletric guarda no NexoBD (todos fora do catálogo, NexoBD 1.5.0):
//   projeto  tipo 'projeto', chave nexoeletric-projeto = nome da pasta em Projects/
//   biblioteca  tipo 'outro', categoria 'nexoeletric', chave nexoeletric-biblioteca = 'principal' (a pasta Libs/)
//   scripts  tipo 'outro', categoria 'nexoeletric', chave nexoeletric-scripts = 'altium' (os .pas e o .PrjScr)
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export const SISTEMA_PROJETO = "nexoeletric-projeto";
export const SISTEMA_BIBLIOTECA = "nexoeletric-biblioteca";
export const SISTEMA_SCRIPTS = "nexoeletric-scripts";
export const CATEGORIA_INTERNA = {
  id: "nexoeletric", nome: "NexoEletric (interno)", ordem: 90, oculta: true,
  descricao: "Guardado pelo NexoEletric e mostrado só nele: a biblioteca de símbolos (sincronizada com o Odoo) e os scripts do Altium",
};
export const ALVO_BIBLIOTECA = {
  sistema: SISTEMA_BIBLIOTECA, chave: "principal",
  criar: { tipo: "outro", categoria: CATEGORIA_INTERNA.id, nome: "Biblioteca do NexoEletric", descricao: "Símbolos, footprints e o almoxarifado (sincronizado com o Odoo): a pasta Libs do NexoEletric", atributos: { programa: "nexoeletric", pasta: "Libs" } },
};
export const ALVO_SCRIPTS = {
  sistema: SISTEMA_SCRIPTS, chave: "altium",
  criar: { tipo: "outro", categoria: CATEGORIA_INTERNA.id, nome: "Scripts do Altium (NexoEletric)", descricao: "ExportProject, ExportBoard, BuildSchematic e ApplyChanges: o Nexo Hub os põe na pasta do Altium", atributos: { programa: "nexoeletric" } },
};
export const alvoProjeto = (nome) => ({
  sistema: SISTEMA_PROJETO, chave: nome,
  criar: { tipo: "projeto", nome, atributos: { programa: "nexoeletric", pasta: nome } },
});

/** Nunca espelhados: ocultos, temporários, backups e as travas do Office/Altium. */
export const LIXO = (rel) => /(^|\/)[.~]/.test(rel) || /\.(tmp|bak|lock)$/i.test(rel) || /\.bak[-.]/i.test(rel) || /(^|\/)(Thumbs\.db|desktop\.ini|__pycache__)(\/|$)/i.test(rel);

/** O caminho relativo → papel aceito pelo NexoBD ([A-Za-z0-9._-] por trecho, sem começar com ponto, até 160). */
export function papelDe(rel) {
  return rel.split("/").map((t) => {
    let s = t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_");
    if (!/^[A-Za-z0-9]/.test(s)) s = `x${s}`;
    return s;
  }).join("/").slice(0, 160);
}

/** O nome guardado no arquivo da revisão → caminho relativo seguro (null = não dá para pôr na pasta). */
export function relSeguro(nome) {
  const r = String(nome ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!r || /^[a-z]:/i.test(r) || r.split("/").some((t) => !t || t === "." || t === "..")) return null;
  return r;
}

/** Nome de pasta que o Windows aceita (o nome do projeto vira pasta). */
export const nomeDePastaOk = (n) => typeof n === "string" && n.length > 0 && n.length <= 120 && !/[<>:"/\\|?*\x00-\x1f]/.test(n) && !/[. ]$/.test(n) && !/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(n);

const sha256 = (b) => createHash("sha256").update(b).digest("hex");

/**
 * {rel: {sha, tamanho}} da pasta (recursivo). cache {rel: {m, t, sha}} evita refazer o hash do que não mudou (mtime e
 * tamanho iguais); é atualizado aqui. aceita(rel) filtra (o LIXO já fica de fora).
 */
export function lerPasta(pasta, { aceita = () => true, cache = {} } = {}) {
  const out = {};
  const vistos = new Set();
  const anda = (dir, base) => {
    let ents;
    try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const rel = base ? `${base}/${e.name}` : e.name;
      if (LIXO(rel)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { if (aceita(`${rel}/`)) anda(abs, rel); continue; }
      if (!e.isFile() || !aceita(rel)) continue;
      let st;
      try { st = statSync(abs); } catch { continue; }
      const c = cache[rel];
      let sha = c && c.m === st.mtimeMs && c.t === st.size ? c.sha : null;
      if (!sha) {
        try { sha = sha256(readFileSync(abs)); } catch { continue; } // sumiu ou está travado: fica para a próxima
        cache[rel] = { m: st.mtimeMs, t: st.size, sha };
      }
      vistos.add(rel);
      out[rel] = { sha, tamanho: st.size };
    }
  };
  if (existsSync(pasta)) anda(pasta, "");
  for (const k of Object.keys(cache)) if (!vistos.has(k)) delete cache[k];
  return out;
}

/** Os arquivos da revisão atual do item → {rel: {sha, papel}} (a miniatura e as saídas anexadas ficam de fora). */
export function arquivosDoItem(it) {
  const out = {};
  for (const [papel, a] of Object.entries(it?.arquivos ?? {})) {
    if (papel === "thumb" || papel.startsWith("saida/")) continue;
    const rel = relSeguro(a.nome) ?? relSeguro(papel);
    if (rel && !LIXO(rel)) out[rel] = { sha: a.sha256, papel };
  }
  return out;
}

function gravarAtomico(alvo, bytes) {
  mkdirSync(path.dirname(alvo), { recursive: true });
  const tmp = `${alvo}.${process.pid}.${randomBytes(3).toString("hex")}.tmp`;
  writeFileSync(tmp, bytes);
  for (let i = 0; ; i++) {
    try { renameSync(tmp, alvo); return; } catch (err) {
      if (i >= 20 || !["EPERM", "EACCES", "EBUSY"].includes(err.code)) { rmSync(tmp, { force: true }); throw err; }
      const t = Date.now(); while (Date.now() - t < 50) { /* alguém está lendo o arquivo */ }
    }
  }
}

const carimbo = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");

/** Garante a categoria interna do NexoEletric (fora do catálogo). Num NexoBD antes do 1.5.0 ela nasce visível. */
export async function garantirCategoriaInterna(cliente) {
  try { await cliente.criarCategoria(CATEGORIA_INTERNA); } catch (err) { if (err?.status !== 409) throw err; }
}

/**
 * Espelha uma pasta num item. estado = {item, rev, base:{rel:sha}, local:{rel:sha}, cache:{}} (mudado aqui; quem chama
 * guarda). itemPronto: o item já lido (a lista dos projetos traz). transforma(rel, bytes) → bytes: ajuste local de um
 * arquivo baixado (o caminho dentro do ALMOX.DbLib); o arquivo local passa a ser comparado com o que foi escrito.
 * → {item, rev, baixados, subidos, apagados, conflitos, falhas, revisao}
 */
export async function espelhar({ cliente, pasta, alvo, estado, modo = "ambos", aceita, transforma, conflitos, nota = "", app, log = () => {}, itemPronto }) {
  estado.base ??= {}; estado.local ??= {}; estado.cache ??= {};
  const r = { item: null, rev: 0, baixados: [], subidos: [], apagados: [], conflitos: [], falhas: [], revisao: null };
  const nomeAlvo = alvo.chave;

  let it = itemPronto ?? null;
  if (!it) it = await cliente.chave(alvo.sistema, alvo.chave); // a rota da chave devolve o item inteiro (ou null)
  if (it?.apagado_em) it = null;
  // a pasta sumiu inteira: é cópia, volta do NexoBD (nunca vale como "apaguei tudo")
  if (!existsSync(pasta)) { estado.base = {}; estado.local = {}; }
  const local = lerPasta(pasta, { aceita, cache: estado.cache });
  const remoto = it ? arquivosDoItem(it) : {};
  if (it && aceita) for (const k of Object.keys(remoto)) if (!aceita(k)) delete remoto[k];
  const temBase = !!(it && estado.item === it.id);
  const base = temBase ? estado.base : {};
  const escrito = temBase ? estado.local : {};

  const abs = (rel) => path.join(pasta, ...rel.split("/"));
  const baixar = async (rel, sha) => {
    let bytes = Buffer.from(await cliente.blob(sha));
    if (transforma) bytes = Buffer.from(transforma(rel, bytes) ?? bytes);
    gravarAtomico(abs(rel), bytes);
    const shaLocal = sha256(bytes);
    if (shaLocal !== sha) estado.local[rel] = shaLocal; else delete estado.local[rel];
    try { const st = statSync(abs(rel)); estado.cache[rel] = { m: st.mtimeMs, t: st.size, sha: shaLocal }; } catch { /* lido na próxima */ }
    r.baixados.push(rel);
  };
  const guardarConflito = (rel, bytes, quem) => {
    if (!conflitos) return;
    const alvoArq = path.join(conflitos, nomeAlvo, ...`${rel}.${quem}-${carimbo()}`.split("/"));
    gravarAtomico(alvoArq, bytes);
    r.conflitos.push({ rel, guardado: alvoArq });
  };
  // o sha "do NexoBD" de um arquivo local que foi ajustado ao baixar (transforma)
  const comoRemoto = (rel) => (local[rel] && escrito[rel] === local[rel].sha ? base[rel] : local[rel]?.sha);

  // ---------------------------------------------------------------- baixar
  if (modo === "baixar") {
    if (!it) return { ...r, item: null };
    for (const [rel, { sha }] of Object.entries(remoto)) {
      if (comoRemoto(rel) === sha && local[rel]) continue;
      try { await baixar(rel, sha); } catch (err) { r.falhas.push({ rel, erro: err.message }); }
    }
    for (const rel of Object.keys(base)) {
      if (remoto[rel] || !local[rel]) continue;
      try { rmSync(abs(rel), { force: true }); delete estado.cache[rel]; r.apagados.push(rel); } catch (err) { r.falhas.push({ rel, erro: err.message }); }
    }
    estado.item = it.id; estado.rev = it.rev;
    estado.base = Object.fromEntries(Object.entries(remoto).filter(([rel]) => !r.falhas.some((f) => f.rel === rel)).map(([rel, a]) => [rel, a.sha]));
    for (const rel of Object.keys(estado.local)) if (!estado.base[rel]) delete estado.local[rel];
    return { ...r, item: it.id, rev: it.rev };
  }

  // ---------------------------------------------------------------- decidir arquivo a arquivo
  const final = {};       // rel → sha que a revisão nova (ou a atual) deve ter
  const doLocal = new Set();
  const nomes = new Set([...Object.keys(local), ...Object.keys(remoto), ...Object.keys(base)]);
  for (const rel of nomes) {
    const l = comoRemoto(rel), rm = remoto[rel]?.sha, b = base[rel];
    if (modo === "subir") { if (l) { final[rel] = l; if (l !== rm) doLocal.add(rel); } continue; }
    if (l === rm) { if (l) final[rel] = l; continue; }
    if (l === b) { // mudou só no NexoBD
      if (rm) { try { await baixar(rel, rm); final[rel] = rm; } catch (err) { r.falhas.push({ rel, erro: err.message }); if (l) final[rel] = l; } }
      else { try { rmSync(abs(rel), { force: true }); delete estado.cache[rel]; r.apagados.push(rel); } catch (err) { r.falhas.push({ rel, erro: err.message }); if (l) final[rel] = l; } }
      continue;
    }
    if (rm === b || !temBase && !rm) { if (l) { final[rel] = l; doLocal.add(rel); } continue; } // mudou só aqui
    // mudou dos dois lados, diferente
    if (temBase) {
      if (rm) { try { guardarConflito(rel, Buffer.from(await cliente.blob(rm)), `nexobd-r${it.rev}`); } catch (err) { r.falhas.push({ rel, erro: err.message }); } }
      if (l) { final[rel] = l; doLocal.add(rel); }
    } else { // primeiro contato com um item que já existe: vale o NexoBD, a cópia local fica guardada
      try { if (l) guardarConflito(rel, readFileSync(abs(rel)), "local"); await baixar(rel, rm); final[rel] = rm; }
      catch (err) { r.falhas.push({ rel, erro: err.message }); if (l) { final[rel] = l; } }
    }
  }

  const igual = it && Object.keys(final).length === Object.keys(remoto).length && Object.entries(final).every(([rel, sha]) => remoto[rel]?.sha === sha);
  if (igual || !Object.keys(final).length) {
    if (it) { estado.item = it.id; estado.rev = it.rev; estado.base = Object.fromEntries(Object.entries(remoto).map(([rel, a]) => [rel, a.sha])); }
    for (const rel of Object.keys(estado.local)) if (!estado.base[rel]) delete estado.local[rel];
    return { ...r, item: it?.id ?? null, rev: it?.rev ?? 0 };
  }

  // ---------------------------------------------------------------- subir (revisão nova com a lista inteira)
  if (!it) {
    it = await cliente.criarItem({ ...alvo.criar, chaves: [{ sistema: alvo.sistema, chave: alvo.chave }], app });
    log(`+ ${nomeAlvo}: item ${it.id} criado no NexoBD`);
  }
  const arquivos = {};
  for (const [rel, sha] of Object.entries(final)) {
    if (doLocal.has(rel) && !(estado.local[rel] && estado.local[rel] === local[rel]?.sha)) arquivos[papelDe(rel)] = { bytes: readFileSync(abs(rel)), nome: rel };
    else arquivos[papelDe(rel)] = { sha256: sha, nome: rel };
  }
  // dois caminhos que dão o mesmo papel: o segundo ganha um sufixo (raro: só acentos e símbolos diferem)
  const usados = new Map();
  for (const [p, a] of Object.entries(arquivos)) {
    const k = p.toLowerCase();
    if (usados.has(k)) { delete arquivos[p]; arquivos[`${p.slice(0, 150)}-${sha256(a.nome).slice(0, 6)}`] = a; } else usados.set(k, p);
  }
  try {
    const rv = await cliente.novaRevisao(it.id, { arquivos, base: it.rev ?? 0, nota, app, forcar: modo === "subir" });
    r.revisao = rv.numero ?? rv.rev;
    r.subidos = [...doLocal];
    estado.item = it.id; estado.rev = r.revisao;
    // o que foi escrito ajustado (transforma) continua ajustado: o NexoBD tem o sha do NexoBD
    estado.base = { ...final };
    for (const rel of Object.keys(estado.local)) if (!estado.base[rel] || doLocal.has(rel)) delete estado.local[rel];
    log(`↑ ${nomeAlvo}: revisão ${r.revisao} (${r.subidos.length} arquivo(s) daqui)`);
    return { ...r, item: it.id, rev: r.revisao };
  } catch (err) {
    // não subiu: a base passa a ser o que o NexoBD tem (o que mudou aqui continua diferente e sobe na próxima)
    estado.item = it.id; estado.rev = it.rev ?? 0;
    estado.base = Object.fromEntries(Object.entries(remoto).map(([rel, a]) => [rel, a.sha]));
    for (const rel of r.baixados) estado.base[rel] = final[rel];
    if (err?.codigo === "conflito") { r.repetir = true; return { ...r, item: it.id, rev: it.rev }; }
    throw err;
  }
}

/** espelhar() com até 3 tentativas quando outro escritor salvou no meio (409 conflito). */
export async function espelharComRetentativa(op) {
  let res;
  for (let i = 0; i < 3; i++) {
    res = await espelhar({ ...op, itemPronto: i === 0 ? op.itemPronto : undefined });
    if (!res.repetir) return res;
  }
  return res;
}

/** Qual NexoBD está do outro lado (pelo Hub ou direto): "<máquina>|<pasta de dados>". */
export async function identidadeBD(cliente) {
  const s = await cliente.saude();
  return `${s.bd?.maquina ?? s.maquina ?? "?"}|${s.bd?.dados ?? s.dados ?? "?"}`;
}

/** Os projetos do NexoEletric no NexoBD: {nome → item resumido} (vivos) e os nomes dos apagados. */
export async function listarProjetos(cliente) {
  const vivos = new Map();
  for (let pagina = 1; ; pagina++) {
    const r = await cliente.itens({ tipo: "projeto", sistema: SISTEMA_PROJETO, limite: 500, pagina });
    for (const it of r.itens) {
      const ch = (it.chaves ?? []).find((c) => c.sistema === SISTEMA_PROJETO);
      if (ch) vivos.set(ch.chave, it);
    }
    if (pagina * 500 >= r.total || !r.itens.length) break;
  }
  return vivos;
}

/**
 * A pasta Projects/ inteira: um item por subpasta. estado = {projetos: {nome: estadoDoEspelho}}.
 *  - projeto no NexoBD e não aqui: baixa (pasta apagada à mão volta: a pasta é cópia);
 *  - pasta nova aqui (modo 'ambos'): vira projeto no NexoBD;
 *  - projeto apagado no NexoBD que já esteve aqui: a pasta vai para a lixeira (ou some, sem lixeira);
 *  - apagar: [nomes] que o programa apagou (o NexoEletric anota quando o hub manda para a lixeira) → apaga no NexoBD.
 * → {projetos: {nome: resultado}, erros: [{nome, erro}], apagadosNoNexoBD: [], removidosDaqui: []}
 */
export async function espelharProjetos({ cliente, raiz, estado, modo = "ambos", apagar = [], lixeira, conflitos, app, log = () => {}, nota }) {
  const out = { projetos: {}, erros: [], apagadosNoNexoBD: [], removidosDaqui: [] };
  // outro NexoBD (o Hub foi religado em outro banco): a memória da última rodada não vale lá. Sem ela, nada daqui é
  // tomado por "apagado no NexoBD"; as pastas que o banco novo não tem sobem para ele.
  const bd = await identidadeBD(cliente);
  if (estado.bd !== bd) { estado.projetos = {}; estado.bd = bd; }
  estado.projetos ??= {};
  const vivos = await listarProjetos(cliente);

  const tirarDaqui = (nome) => {
    const pasta = path.join(raiz, nome);
    if (!existsSync(pasta)) return false;
    if (lixeira) { mkdirSync(lixeira, { recursive: true }); renameSync(pasta, path.join(lixeira, `${nome}-${carimbo()}`)); }
    else rmSync(pasta, { recursive: true, force: true });
    return true;
  };
  for (const nome of apagar) {
    if (!nomeDePastaOk(nome)) continue;
    const it = vivos.get(nome);
    if (it) { await cliente.apagarItem(it.id); vivos.delete(nome); out.apagadosNoNexoBD.push(nome); log(`− ${nome}: apagado no NexoBD`); }
    try { tirarDaqui(nome); } catch (err) { out.erros.push({ nome, erro: `apagado no NexoBD, mas a pasta ficou: ${err.message}` }); }
    delete estado.projetos[nome];
  }

  mkdirSync(raiz, { recursive: true });
  const locais = new Set(readdirSync(raiz, { withFileTypes: true }).filter((e) => e.isDirectory() && !LIXO(e.name)).map((e) => e.name));
  const nomes = new Set([...vivos.keys(), ...locais]);
  for (const nome of [...nomes].sort((a, b) => a.localeCompare(b))) {
    if (!nomeDePastaOk(nome)) { out.erros.push({ nome, erro: "nome de projeto que não dá pasta no Windows" }); continue; }
    const pasta = path.join(raiz, nome);
    const est = (estado.projetos[nome] ??= {});
    const it = vivos.get(nome);
    if (!it && locais.has(nome) && est.item) {
      // já esteve sincronizado e sumiu do NexoBD: foi apagado lá
      if (modo === "subir") { delete est.item; delete est.rev; est.base = {}; }
      else {
        try { tirarDaqui(nome); } catch (err) { out.erros.push({ nome, erro: `apagado no NexoBD, mas a pasta ficou: ${err.message}` }); continue; }
        delete estado.projetos[nome];
        out.removidosDaqui.push(nome);
        log(`− ${nome}: apagado no NexoBD, saiu daqui`);
        continue;
      }
    }
    if (!it && modo === "baixar") continue;
    try {
      out.projetos[nome] = await espelharComRetentativa({ cliente, pasta, alvo: alvoProjeto(nome), estado: est, modo, conflitos, app, log, nota, itemPronto: it });
    } catch (err) { out.erros.push({ nome, erro: err.message }); }
  }
  return out;
}

/** Lê/grava o estado de um espelho num JSON (gravação atômica). */
export function lerEstado(arq) {
  try { return JSON.parse(readFileSync(arq, "utf8")); } catch { return {}; }
}
export function gravarEstado(arq, estado) {
  gravarAtomico(arq, Buffer.from(JSON.stringify(estado)));
}
