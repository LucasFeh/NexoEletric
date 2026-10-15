// Nexo Hub — cliente JS universal (Node 18+ com fetch global, ou navegador). Sem dependências: copie este arquivo
// para o seu projeto. Contrato: docs/CONTRATO.md do repositório nexohub.
//
//   import * as hub from "./nexohub-cliente.mjs";
//   const { url } = await hub.conexao();
//   const it = await hub.criarItem({ tipo: "modelo3d", categoria: "eletronicos/modelos-3d", nome: "R0603",
//                                    chaves: [{ sistema: "nexoeletric-modelo", chave: "3d/123.step" }] }, );
//   await hub.novaRevisao(it.id, { arquivos: { step: bufferDoStep }, base: it.rev, app: "nexoeletric" });
//   const ev = hub.eventos(it.revisao, (e) => console.log(e.tipo, e.item_id));  ...  ev.fechar();
//
// Todas as funções existem soltas (usam a conexão padrão) e também em criarCliente({url, token, app}).

export const URL_PADRAO = "http://127.0.0.1:47800";
const SHA_OK = /^[0-9a-f]{64}$/;
const ehNode = typeof process !== "undefined" && !!process.versions?.node;

/** Erro do Nexo Hub: .status (HTTP), .codigo ('fora_do_ar', 'conflito', 'nao_encontrado'...), .dados (corpo). */
export class ErroNexoHub extends Error {
  constructor(mensagem, { status = 0, codigo = "erro", dados = null, causa } = {}) {
    super(mensagem);
    this.name = "ErroNexoHub"; this.status = status; this.codigo = codigo; this.dados = dados;
    if (causa) this.cause = causa;
  }
}

function caminhoConexaoPadrao() {
  if (!ehNode) return null;
  if (process.env.NEXOHUB_CONEXAO) return process.env.NEXOHUB_CONEXAO;
  const pub = process.env.PUBLIC || "C:\\Users\\Public";
  return `${pub.replace(/[\\/]+$/, "")}\\NexoHub\\conexao.json`;
}

/**
 * Onde está o Nexo Hub: NEXOHUB_URL/NEXOHUB_TOKEN > C:\Users\Public\NexoHub\conexao.json > http://127.0.0.1:47800.
 * Devolve {url, token, origem}.
 */
export async function conexao() {
  if (ehNode && process.env.NEXOHUB_URL) return { url: limpaUrl(process.env.NEXOHUB_URL), token: process.env.NEXOHUB_TOKEN ?? "", origem: "ambiente" };
  const arq = caminhoConexaoPadrao();
  if (arq) {
    try {
      const { readFile } = await import("node:fs/promises");
      const j = JSON.parse((await readFile(arq, "utf8")).replace(/^\uFEFF/, ""));
      if (j?.url) return { url: limpaUrl(j.url), token: (ehNode && process.env.NEXOHUB_TOKEN) || j.token || "", origem: arq };
    } catch { /* sem arquivo: vale o padrão */ }
  }
  return { url: URL_PADRAO, token: (ehNode && process.env.NEXOHUB_TOKEN) || "", origem: "padrão" };
}
const limpaUrl = (u) => String(u).trim().replace(/\/+$/, "");

const paraBytes = (d) => {
  if (d == null) throw new ErroNexoHub("Nada para enviar", { codigo: "dados_invalidos" });
  if (typeof d === "string") return new TextEncoder().encode(d);
  if (d instanceof Uint8Array) return d;
  if (d instanceof ArrayBuffer) return new Uint8Array(d);
  if (ArrayBuffer.isView(d)) return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
  throw new ErroNexoHub("Formato não suportado: use Buffer, Uint8Array, ArrayBuffer ou texto", { codigo: "dados_invalidos" });
};
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
/** sha256 (hex) de bytes, com o WebCrypto (Node 18+ e navegadores). */
export async function sha256(dados) {
  const b = paraBytes(dados);
  if (ehNode && b.byteLength > 64 * 1024 * 1024) { // arquivos grandes: o node:crypto não copia tudo de novo
    const { createHash } = await import("node:crypto");
    return createHash("sha256").update(b).digest("hex");
  }
  return hex(await globalThis.crypto.subtle.digest("SHA-256", b));
}
const comoSaida = (ab) => (ehNode && globalThis.Buffer ? globalThis.Buffer.from(ab) : new Uint8Array(ab));
const enc = encodeURIComponent;

/** Cria um cliente. Sem url, usa conexao(). app vai no cabeçalho X-App (aparece nos eventos e no histórico). */
export function criarCliente({ url, token, app = "" } = {}) {
  let alvo = url ? Promise.resolve({ url: limpaUrl(url), token: token ?? "", origem: "parâmetro" }) : null;
  const destino = () => (alvo ??= conexao().then((c) => (token != null ? { ...c, token } : c)));

  async function pedir(metodo, caminho, { json, corpo, cabecalhos = {}, cru = false, aceitar404 = false, sinal } = {}) {
    const c = await destino();
    const h = { ...cabecalhos };
    if (c.token) h.Authorization = `Bearer ${c.token}`;
    if (app) h["X-App"] = app;
    let body = corpo;
    if (json !== undefined) { h["Content-Type"] = "application/json"; body = JSON.stringify(json); }
    let r;
    try {
      r = await fetch(c.url + caminho, { method: metodo, headers: h, body, signal: sinal });
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      throw new ErroNexoHub(`Nexo Hub fora do ar em ${c.url}`, { codigo: "fora_do_ar", causa: err });
    }
    if (aceitar404 && r.status === 404) { await r.body?.cancel?.().catch?.(() => {}); return null; }
    if (!r.ok) {
      let j = null;
      try { j = await r.json(); } catch { /* corpo não-JSON */ }
      const msg = j?.erro ?? `Nexo Hub respondeu HTTP ${r.status} em ${metodo} ${caminho}`;
      throw new ErroNexoHub(msg, { status: r.status, codigo: j?.codigo ?? (r.status === 401 ? "sem_token" : "erro"), dados: j });
    }
    if (cru) return r;
    if (metodo === "HEAD" || r.status === 204) return true;
    return r.json();
  }

  const saude = () => pedir("GET", "/api/v1/saude");
  const categorias = async () => (await pedir("GET", "/api/v1/categorias")).categorias;
  const criarCategoria = (dados) => pedir("POST", "/api/v1/categorias", { json: dados });

  /** filtro: {categoria, tipo, texto, footprint, sistema, chave, limite, pagina, apagados} → {itens, total, revisao} */
  function itens(filtro = {}) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filtro)) if (v != null && v !== "") p.set(k, String(v));
    const qs = p.toString();
    return pedir("GET", `/api/v1/itens${qs ? `?${qs}` : ""}`);
  }
  /** O item completo, ou null se não existe. */
  const item = (id) => pedir("GET", `/api/v1/itens/${enc(id)}`, { aceitar404: true });
  /** Cria (idempotente pelas chaves e pelo id): devolve o item com existente:true|false. */
  const criarItem = (dados) => pedir("POST", "/api/v1/itens", { json: dados });
  const alterarItem = (id, patch) => pedir("PATCH", `/api/v1/itens/${enc(id)}`, { json: patch });
  const apagarItem = (id, { definitivo = false } = {}) => pedir("DELETE", `/api/v1/itens/${enc(id)}${definitivo ? "?definitivo=1" : ""}`);
  const restaurarItem = (id) => pedir("POST", `/api/v1/itens/${enc(id)}/restaurar`);
  const revisoes = async (id) => (await pedir("GET", `/api/v1/itens/${enc(id)}/revisoes`)).revisoes;

  /** O blob existe no servidor? */
  async function temBlob(sha) {
    const c = await destino();
    try {
      const r = await fetch(`${c.url}/api/v1/blobs/${sha}`, { method: "HEAD", headers: c.token ? { Authorization: `Bearer ${c.token}` } : {} });
      if (r.status === 401) throw new ErroNexoHub("Acesso negado ao Nexo Hub: token inválido", { status: 401, codigo: "sem_token" });
      return r.ok;
    } catch (err) {
      if (err instanceof ErroNexoHub) throw err;
      throw new ErroNexoHub(`Nexo Hub fora do ar em ${c.url}`, { codigo: "fora_do_ar", causa: err });
    }
  }
  /** Envia um arquivo (pula o envio se o servidor já tem esse conteúdo). → {sha256, tamanho, existente} */
  async function enviarBlob(dados, nome = "") {
    const b = paraBytes(dados);
    const sha = await sha256(b);
    if (await temBlob(sha)) return { sha256: sha, tamanho: b.byteLength, existente: true };
    const h = { "Content-Type": "application/octet-stream" };
    if (nome) h["X-Nome"] = enc(nome);
    const r = await pedir("POST", "/api/v1/blobs", { corpo: b, cabecalhos: h });
    if (r.sha256 !== sha) throw new ErroNexoHub(`O servidor calculou outro sha256 (${r.sha256}) para ${nome || "o arquivo"}`, { codigo: "sha_divergente" });
    return r;
  }
  async function bytesDe(caminho) {
    const r = await pedir("GET", caminho, { cru: true });
    return comoSaida(await r.arrayBuffer());
  }
  /** Os bytes de um blob pelo sha256. */
  const blob = (sha) => bytesDe(`/api/v1/blobs/${enc(sha)}`);
  /** Os bytes do arquivo de um papel ('step', 'nexo', 'thumb'...) da revisão atual (ou da rev pedida). */
  const baixar = (id, papel, rev) => bytesDe(`/api/v1/itens/${enc(id)}/arquivo/${enc(papel)}${rev ? `?rev=${Number(rev)}` : ""}`);

  /**
   * Revisão nova. arquivos: {papel: sha256 | Buffer/Uint8Array/texto | {bytes, nome} | {sha256, nome}} (os bytes são
   * enviados antes, sem duplicar). base: a revisão que você editou (diferente da atual → erro codigo 'conflito',
   * com .dados.rev_atual), salvo forcar:true. herdar:true copia os papéis que não vieram. → {numero}
   */
  async function novaRevisao(id, { arquivos = {}, herdar, base, nota, app: appRev, autor, bbox, forcar } = {}) {
    const lista = {};
    for (const [papel, v] of Object.entries(arquivos)) {
      if (typeof v === "string" && SHA_OK.test(v)) lista[papel] = v;
      else if (v && typeof v === "object" && !ArrayBuffer.isView(v) && !(v instanceof ArrayBuffer)) {
        if (v.bytes != null) { const up = await enviarBlob(v.bytes, v.nome ?? ""); lista[papel] = { sha256: up.sha256, nome: v.nome ?? "" }; }
        else lista[papel] = { sha256: v.sha256 ?? v.sha, nome: v.nome ?? "" };
      } else { const up = await enviarBlob(v, papel); lista[papel] = up.sha256; }
    }
    const corpo = { arquivos: lista };
    for (const [k, v] of Object.entries({ herdar, base, nota, app: appRev ?? (app || undefined), autor, bbox, forcar })) if (v !== undefined) corpo[k] = v;
    return pedir("POST", `/api/v1/itens/${enc(id)}/revisoes`, { json: corpo });
  }
  /** Anexa um arquivo a uma revisão existente (o servidor só aceita papel 'thumb'). sha pode ser bytes. */
  async function anexar(id, n, papel, sha) {
    if (!(typeof sha === "string" && SHA_OK.test(sha))) sha = (await enviarBlob(sha, `${papel}.png`)).sha256;
    return pedir("PUT", `/api/v1/itens/${enc(id)}/revisoes/${Number(n)}/arquivos/${enc(papel)}`, { json: { sha } });
  }

  /** O item dono da chave, ou null. */
  const chave = (sistema, ch) => pedir("GET", `/api/v1/chaves/${enc(sistema)}/${enc(ch)}`, { aceitar404: true });
  /** Em lote: {chave: {id, rev, step_sha} | null} */
  const resolverChaves = (sistema, chaves) => pedir("POST", "/api/v1/chaves/resolver", { json: { sistema, chaves } });
  const definirChave = (sistema, ch, item_id) => pedir("PUT", "/api/v1/chaves", { json: { sistema, chave: ch, item_id } });
  const apagarChave = (sistema, ch) => pedir("DELETE", `/api/v1/chaves/${enc(sistema)}/${enc(ch)}`);

  /** vincular({de_item, relacao, para_item?, para_ref?, dados?}) ou vincular(de_item, relacao, {para_item, para_ref, dados}) → {id, existente} */
  function vincular(de, relacao, extra = {}) {
    const v = typeof de === "object" ? de : { de_item: de, relacao, ...(typeof extra === "string" ? { para_ref: extra } : extra) };
    return pedir("POST", "/api/v1/vinculos", { json: v });
  }
  const desvincular = (id) => pedir("DELETE", `/api/v1/vinculos/${Number(id)}`);
  /** filtro: {de_item, para_item, relacao, para_ref} */
  const vinculos = async (filtro) => (await pedir("GET", `/api/v1/vinculos?${new URLSearchParams(filtro)}`)).vinculos;

  /** Polling: {eventos, revisao} desde o seq N. */
  const eventosDesde = (desde = 0, limite) => pedir("GET", `/api/v1/eventos?formato=json&desde=${Number(desde) || 0}${limite ? `&limite=${limite}` : ""}`);

  /**
   * Assina o SSE. desde: o último seq que você já tem (null/undefined = só os novos). aoEvento({seq, tipo, item_id,
   * rev, app, dados, criado_em}). Reconecta sozinho mandando Last-Event-ID. op: {aoErro(err), aoConectar()}.
   * Devolve {fechar(), get ultimo()}.
   */
  function eventos(desde, aoEvento, op = {}) {
    let ultimo = desde == null ? null : Number(desde);
    let fechado = false, ctl = null, espera = 500, timer = null;
    const decodificador = new TextDecoder();
    async function ciclo() {
      while (!fechado) {
        ctl = new AbortController();
        try {
          const h = { Accept: "text/event-stream" };
          if (ultimo != null) h["Last-Event-ID"] = String(ultimo);
          const r = await pedir("GET", "/api/v1/eventos", { cru: true, cabecalhos: h, sinal: ctl.signal });
          espera = 500;
          op.aoConectar?.();
          const leitor = r.body.getReader();
          let resto = "";
          let ev = { id: null, event: "message", data: [] };
          for (;;) {
            const { value, done } = await leitor.read();
            if (done) break;
            resto += decodificador.decode(value, { stream: true });
            let i;
            while ((i = resto.search(/\r?\n/)) >= 0) {
              const linha = resto.slice(0, i);
              resto = resto.slice(i + (resto[i] === "\r" ? 2 : 1));
              if (linha === "") {
                if (ev.data.length) {
                  let d;
                  try { d = JSON.parse(ev.data.join("\n")); } catch { d = { tipo: ev.event, dados: ev.data.join("\n") }; }
                  if (ev.id != null) ultimo = Number(ev.id);
                  try { await aoEvento(d); } catch (err) { op.aoErro?.(err); }
                }
                ev = { id: null, event: "message", data: [] };
              } else if (linha.startsWith(":")) { /* comentário / keep-alive */ }
              else {
                const p = linha.indexOf(":");
                const campo = p < 0 ? linha : linha.slice(0, p);
                const valor = p < 0 ? "" : linha.slice(p + 1).replace(/^ /, "");
                if (campo === "id") ev.id = valor; else if (campo === "event") ev.event = valor; else if (campo === "data") ev.data.push(valor);
              }
            }
          }
        } catch (err) {
          if (fechado) return;
          if (err?.name !== "AbortError") op.aoErro?.(err);
        }
        if (fechado) return;
        // caiu: o servidor parou ou a rede piscou. Espera um pouco e volta do último seq visto.
        if (ultimo == null) { try { ultimo = (await saude()).revisao; } catch { /* ainda fora */ } }
        await new Promise((res) => { timer = setTimeout(res, espera); });
        espera = Math.min(espera * 2, 15_000);
      }
    }
    ciclo();
    return {
      fechar() { fechado = true; clearTimeout(timer); try { ctl?.abort(); } catch { /* já fechado */ } },
      get ultimo() { return ultimo; },
    };
  }

  /** Presença: {id?, app?, versao?, maquina?, usuario?}. Sem id, usa "<app>@<máquina>". */
  async function ping(info = {}) {
    let maquina = info.maquina, usuario = info.usuario;
    if (ehNode && (!maquina || !usuario)) {
      try { const os = await import("node:os"); maquina ??= os.hostname(); usuario ??= os.userInfo().username; } catch { /* sem os */ }
    }
    const a = info.app ?? app ?? "";
    return pedir("POST", "/api/v1/clientes/ping", { json: { ...info, app: a, maquina, usuario, id: info.id ?? `${a || "cliente"}@${maquina ?? "?"}` } });
  }
  const clientes = async () => (await pedir("GET", "/api/v1/clientes")).clientes;
  const backup = () => pedir("POST", "/api/v1/admin/backup");

  return {
    conexao: destino, saude, categorias, criarCategoria, itens, item, criarItem, alterarItem, apagarItem, restaurarItem, revisoes,
    temBlob, enviarBlob, blob, baixar, novaRevisao, anexar, chave, resolverChaves, definirChave, apagarChave,
    vincular, desvincular, vinculos, eventos, eventosDesde, ping, clientes, backup,
  };
}

// ---------------------------------------------------------------- cliente padrão (funções soltas)
let padrao = null;
const p = () => (padrao ??= criarCliente());
/** Troca a conexão das funções soltas: configurar({url, token, app}). Sem argumentos: volta a ler conexao(). */
export function configurar(op) { padrao = op ? criarCliente(op) : null; }

export const saude = () => p().saude();
export const categorias = () => p().categorias();
export const criarCategoria = (d) => p().criarCategoria(d);
export const itens = (f) => p().itens(f);
export const item = (id) => p().item(id);
export const criarItem = (d) => p().criarItem(d);
export const alterarItem = (id, patch) => p().alterarItem(id, patch);
export const apagarItem = (id, op) => p().apagarItem(id, op);
export const restaurarItem = (id) => p().restaurarItem(id);
export const revisoes = (id) => p().revisoes(id);
export const temBlob = (sha) => p().temBlob(sha);
export const enviarBlob = (b, nome) => p().enviarBlob(b, nome);
export const blob = (sha) => p().blob(sha);
export const baixar = (id, papel, rev) => p().baixar(id, papel, rev);
export const novaRevisao = (id, c) => p().novaRevisao(id, c);
export const anexar = (id, n, papel, sha) => p().anexar(id, n, papel, sha);
export const chave = (s, c) => p().chave(s, c);
export const resolverChaves = (s, cs) => p().resolverChaves(s, cs);
export const definirChave = (s, c, id) => p().definirChave(s, c, id);
export const apagarChave = (s, c) => p().apagarChave(s, c);
export const vincular = (...a) => p().vincular(...a);
export const desvincular = (id) => p().desvincular(id);
export const vinculos = (f) => p().vinculos(f);
export const eventos = (desde, fn, op) => p().eventos(desde, fn, op);
export const eventosDesde = (desde, lim) => p().eventosDesde(desde, lim);
export const ping = (info) => p().ping(info);
export const clientes = () => p().clientes();
export const backup = () => p().backup();
