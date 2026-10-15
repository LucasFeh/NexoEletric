/* Um Nexo Hub DE MENTIRA, em memoria, para os testes (contrato: ..\nexohub\docs\CONTRATO.md §3).

   So o pedaco da API v1 que o NexoEletric usa: saude, categorias, itens (lista/um/cria/patch),
   blobs, revisoes, arquivo por papel, chaves (uma/resolver/put), vinculos, eventos (SSE e json).

     const F = require('./nexohub-falso.js');
     const s = await F.inicia({ porta: 8311 });     // {url, fecha(), estado, pedidos}
     node tests/nexohub-falso.js --porta 8311       // para o teste em Python (imprime "pronto <url>")

   Nada vai para o disco. `estado` da acesso direto aos dados (o teste cria uma revisao 2 "do
   NexoCAD" por ele, por exemplo). */
'use strict';
const http = require('node:http');
const crypto = require('node:crypto');

function novoEstado() {
  const cats = [
    ['eletronicos', 'Eletrônicos', null], ['mecanicos', 'Mecânicos', null], ['fixadores', 'Fixadores', null],
    ['caixas', 'Caixas', null], ['placas', 'Placas', null], ['outros', 'Outros', null],
    ['eletronicos/modelos-3d', 'Modelos 3D da PcbLib', 'eletronicos'],
  ].map(([id, nome, pai_id], ordem) => ({ id, nome, pai_id, ordem }));
  return { categorias: cats, itens: new Map(), blobs: new Map(), chaves: new Map(), vinculos: [], eventos: [], seq: 0, nVinc: 0 };
}

const PREFIXO = { componente: 'el', modelo3d: 'el', peca: 'me', montagem: 'me', placa: 'pl', caixa: 'cx', fixador: 'fx', outro: 'ou' };
const slug = s => String(s || 'item').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'item';

function inicia(opcoes) {
  const o = opcoes || {};
  const E = novoEstado();
  const pedidos = [];
  const ouvintes = new Set();
  const agora = () => new Date().toISOString();

  const evento = (tipo, item_id, rev, dados) => {
    const ev = { seq: ++E.seq, criado_em: agora(), tipo, item_id: item_id || null, rev: rev == null ? null : rev, app: '', dados: dados || {} };
    E.eventos.push(ev);
    for (const r of ouvintes) { try { r.write(`id: ${ev.seq}\nevent: ${tipo}\ndata: ${JSON.stringify(ev)}\n\n`); } catch (_) { /* fechou */ } }
    return ev;
  };
  const chavesDe = id => [...E.chaves.entries()].filter(([, v]) => v === id).map(([k]) => { const [sistema, ...c] = k.split('\u0000'); return { sistema, chave: c.join('\u0000') }; });
  const arquivosDe = (it, n) => {
    const r = it.revisoes.find(x => x.numero === (n == null ? it.rev_atual : n));
    const out = {};
    if (r) for (const [papel, a] of Object.entries(r.arquivos)) { const b = E.blobs.get(a.sha); out[papel] = { sha256: a.sha, tamanho: b ? b.dados.length : 0, nome: a.nome || '' }; }
    return out;
  };
  const vista = (it, comVinculos) => {
    const r = it.revisoes.find(x => x.numero === it.rev_atual);
    const v = { id: it.id, tipo: it.tipo, categoria: it.categoria, nome: it.nome, descricao: it.descricao, tags: it.tags, atributos: it.atributos,
      rev: it.rev_atual, atualizado_em: it.atualizado_em, criado_em: it.criado_em, arquivos: arquivosDe(it), chaves: chavesDe(it.id), bbox: r ? r.bbox || null : null };
    if (comVinculos) v.vinculos = E.vinculos.filter(x => x.de_item === it.id).map(x => ({ id: x.id, relacao: x.relacao, para_item: x.para_item, para_ref: x.para_ref, dados: x.dados }));
    return v;
  };
  const poeChave = (sistema, chave, id) => {
    const k = sistema + '\u0000' + chave;
    if (E.chaves.has(k) && E.chaves.get(k) !== id) return false;
    E.chaves.set(k, id);
    return true;
  };
  const poeVinculo = (de, v) => {
    const ja = E.vinculos.find(x => x.de_item === de && x.relacao === v.relacao && (x.para_item || null) === (v.para_item || null) && (x.para_ref || null) === (v.para_ref || null));
    if (ja) return { v: ja, existente: true };
    const n = { id: ++E.nVinc, de_item: de, relacao: v.relacao, para_item: v.para_item || null, para_ref: v.para_ref || null, dados: v.dados || {}, criado_em: agora() };
    E.vinculos.push(n);
    return { v: n, existente: false };
  };

  const servidor = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const partes = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const corpo = [];
    req.on('data', c => corpo.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(corpo);
      pedidos.push({ metodo: req.method, caminho: u.pathname, query: u.search, tamanho: buf.length });
      const json = (st, obj) => { res.writeHead(st, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
      const erro = (st, m) => json(st, { ok: false, erro: m, codigo: st });
      let a = {};
      if (buf.length && /json/.test(req.headers['content-type'] || '')) { try { a = JSON.parse(buf.toString('utf8')); } catch (_) { return erro(400, 'json inválido'); } }
      try {
        if (partes[0] !== 'api' || partes[1] !== 'v1') return erro(404, 'rota desconhecida');
        const [, , r1, r2, r3, r4, r5, r6] = partes;
        const m = req.method;
        if (r1 === 'saude') return json(200, { ok: true, app: 'nexohub', versao: 'falso', schema: 1, dados: '(memória)', revisao: E.seq });
        if (r1 === 'categorias') return json(200, { ok: true, categorias: E.categorias.map(c => Object.assign({}, c, { itens: [...E.itens.values()].filter(i => !i.apagado_em && i.categoria === c.id).length })) });
        if (r1 === 'blobs' && !r2 && m === 'POST') {
          const sha = crypto.createHash('sha256').update(buf).digest('hex');
          const existente = E.blobs.has(sha);
          if (!existente) E.blobs.set(sha, { dados: buf, nome: req.headers['x-nome'] || '' });
          return json(200, { ok: true, sha256: sha, tamanho: buf.length, existente });
        }
        if (r1 === 'blobs' && r2) {
          const b = E.blobs.get(r2);
          if (!b) return erro(404, 'blob não existe');
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', ETag: '"' + r2 + '"', 'Content-Length': b.dados.length });
          return res.end(m === 'HEAD' ? undefined : b.dados);
        }
        if (r1 === 'chaves' && r2 === 'resolver' && m === 'POST') {
          const out = {};
          for (const c of (a.chaves || [])) {
            const id = E.chaves.get(a.sistema + '\u0000' + c);
            const it = id && E.itens.get(id);
            if (it && !it.apagado_em) { const ar = arquivosDe(it); out[c] = { id: it.id, rev: it.rev_atual, step_sha: ar.step ? ar.step.sha256 : null }; }
          }
          return json(200, out);
        }
        if (r1 === 'chaves' && !r2 && m === 'PUT') {
          if (!E.itens.has(a.item_id)) return erro(404, 'item não existe');
          if (!poeChave(a.sistema, a.chave, a.item_id)) return erro(409, 'chave já é de outro item');
          evento('chave', a.item_id, null, { sistema: a.sistema, chave: a.chave });
          return json(200, { ok: true });
        }
        if (r1 === 'chaves' && r2 && r3 != null) {
          const id = E.chaves.get(r2 + '\u0000' + partes.slice(4).join('/'));
          const it = id && E.itens.get(id);
          return it ? json(200, vista(it, true)) : erro(404, 'chave não existe');
        }
        if (r1 === 'vinculos' && m === 'POST') {
          if (!E.itens.has(a.de_item)) return erro(404, 'item não existe');
          const r = poeVinculo(a.de_item, a);
          if (!r.existente) evento('vinculo', a.de_item, null, { relacao: a.relacao });
          return json(200, Object.assign({ ok: true, existente: r.existente }, r.v));
        }
        if (r1 === 'vinculos' && r2 && m === 'DELETE') {
          const i = E.vinculos.findIndex(v => v.id === Number(r2));
          if (i < 0) return erro(404, 'vínculo não existe');
          const [v] = E.vinculos.splice(i, 1);
          evento('vinculo', v.de_item, null, { acao: 'apagado', id: v.id });
          return json(200, { ok: true });
        }
        if (r1 === 'eventos') {
          const desde = Number(u.searchParams.get('desde') || req.headers['last-event-id'] || 0);
          if (u.searchParams.get('formato') === 'json') return json(200, { eventos: E.eventos.filter(e => e.seq > desde), revisao: E.seq });
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
          res.write(': ola\n\n');
          for (const ev of E.eventos.filter(e => e.seq > desde)) res.write(`id: ${ev.seq}\nevent: ${ev.tipo}\ndata: ${JSON.stringify(ev)}\n\n`);
          ouvintes.add(res);
          res.on('close', () => ouvintes.delete(res));
          return undefined;
        }
        if (r1 === 'itens' && !r2 && m === 'GET') {
          const q = u.searchParams;
          let L = [...E.itens.values()].filter(i => !i.apagado_em);
          const cat = q.get('categoria');
          if (cat) L = L.filter(i => i.categoria === cat || i.categoria.startsWith(cat + '/'));
          if (q.get('tipo')) L = L.filter(i => i.tipo === q.get('tipo'));
          if (q.get('sistema')) L = L.filter(i => chavesDe(i.id).some(c => c.sistema === q.get('sistema') && (!q.get('chave') || c.chave === q.get('chave'))));
          if (q.get('footprint')) L = L.filter(i => ((i.atributos || {}).footprints || []).includes(q.get('footprint')));
          if (q.get('texto')) { const t = q.get('texto').toLowerCase(); L = L.filter(i => JSON.stringify([i.nome, i.descricao, i.tags, i.atributos, chavesDe(i.id)]).toLowerCase().includes(t)); }
          L.sort((x, y) => x.id.localeCompare(y.id));
          const lim = Math.min(Number(q.get('limite') || 200), 1000), pag = Math.max(1, Number(q.get('pagina') || 1));
          return json(200, { itens: L.slice((pag - 1) * lim, pag * lim).map(i => vista(i, false)), total: L.length, revisao: E.seq });
        }
        if (r1 === 'itens' && !r2 && m === 'POST') {
          for (const c of (a.chaves || [])) {
            const id = E.chaves.get(c.sistema + '\u0000' + c.chave);
            if (id && E.itens.has(id)) return json(200, Object.assign(vista(E.itens.get(id), true), { existente: true }));
          }
          if (!a.tipo || !a.categoria || !a.nome) return erro(400, 'faltam tipo, categoria ou nome');
          if (!E.categorias.some(c => c.id === a.categoria)) return erro(422, 'categoria não existe');
          let id = a.id || `${PREFIXO[a.tipo] || 'ou'}-${slug(a.nome)}-${crypto.randomBytes(2).toString('hex')}`;
          while (E.itens.has(id)) id = `${PREFIXO[a.tipo] || 'ou'}-${slug(a.nome)}-${crypto.randomBytes(2).toString('hex')}`;
          const it = { id, tipo: a.tipo, categoria: a.categoria, nome: a.nome, descricao: a.descricao || '', tags: a.tags || [], atributos: a.atributos || {},
            rev_atual: 0, criado_em: agora(), atualizado_em: agora(), criado_por: a.app || '', apagado_em: null, revisoes: [] };
          E.itens.set(id, it);
          for (const c of (a.chaves || [])) poeChave(c.sistema, c.chave, id);
          for (const v of (a.vinculos || [])) poeVinculo(id, v);
          evento('item.criado', id, 0);
          return json(201, vista(it, true));
        }
        const it = r1 === 'itens' && r2 ? E.itens.get(r2) : null;
        if (r1 === 'itens' && r2 && !it) return erro(404, 'item não existe');
        if (it && !r3 && m === 'GET') return json(200, vista(it, true));
        if (it && !r3 && m === 'PATCH') {
          for (const k of ['nome', 'descricao', 'categoria', 'tags']) if (a[k] !== undefined) it[k] = a[k];
          if (a.atributos) it.atributos = Object.assign({}, it.atributos, a.atributos);
          it.atualizado_em = agora();
          evento('item.alterado', it.id, it.rev_atual);
          return json(200, vista(it, true));
        }
        if (it && !r3 && m === 'DELETE') { it.apagado_em = agora(); evento('item.apagado', it.id); return json(200, { ok: true }); }
        if (it && r3 === 'revisoes' && !r4 && m === 'GET') return json(200, { revisoes: it.revisoes.map(r => ({ numero: r.numero, criado_em: r.criado_em, app: r.app, nota: r.nota, arquivos: arquivosDe(it, r.numero) })) });
        if (it && r3 === 'revisoes' && !r4 && m === 'POST') {
          if (a.base != null && a.base !== it.rev_atual && !a.forcar) return erro(409, `a revisão atual é ${it.rev_atual}, não ${a.base}`);
          const arqs = {};
          if (a.herdar && it.rev_atual) { const ant = it.revisoes.find(r => r.numero === it.rev_atual); Object.assign(arqs, ant.arquivos); }
          for (const [papel, sha] of Object.entries(a.arquivos || {})) {
            const s = typeof sha === 'string' ? sha : sha && (sha.sha256 || sha.sha);
            if (!E.blobs.has(s)) return erro(422, `blob ${s} não existe`);
            arqs[papel] = { sha: s, nome: (sha && sha.nome) || '' };
          }
          const numero = it.rev_atual + 1;
          it.revisoes.push({ numero, criado_em: agora(), app: a.app || '', autor: a.autor || '', nota: a.nota || '', base: a.base, bbox: a.bbox || null, arquivos: arqs });
          it.rev_atual = numero; it.atualizado_em = agora();
          evento('item.revisao', it.id, numero);
          return json(200, { ok: true, numero });
        }
        if (it && r3 === 'arquivo' && r4) {
          const n = u.searchParams.get('rev') ? Number(u.searchParams.get('rev')) : it.rev_atual;
          const ar = arquivosDe(it, n)[r4];
          if (!ar) return erro(404, 'a revisão não tem esse papel');
          const b = E.blobs.get(ar.sha256);
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', ETag: '"' + ar.sha256 + '"', 'Content-Length': b.dados.length });
          return res.end(b.dados);
        }
        void r5; void r6;
        return erro(404, 'rota desconhecida');
      } catch (e) {
        return erro(500, String(e && e.stack || e));
      }
    });
  });

  return new Promise((ok, falha) => {
    servidor.once('error', falha);
    servidor.listen(o.porta || 0, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${servidor.address().port}`;
      ok({
        url, estado: E, pedidos, evento,
        /* atalho dos testes: uma revisao nova "do NexoCAD" com um STEP */
        revisaoNexo(id, dados) {
          const it = E.itens.get(id);
          const b = Buffer.from(dados);
          const sha = crypto.createHash('sha256').update(b).digest('hex');
          E.blobs.set(sha, { dados: b, nome: 'modelo.step' });
          const ant = it.revisoes.find(r => r.numero === it.rev_atual);
          const arqs = Object.assign({}, ant ? ant.arquivos : {}, { step: { sha, nome: 'modelo.step' }, nexo: { sha, nome: 'modelo.nexo' } });
          it.rev_atual += 1;
          it.revisoes.push({ numero: it.rev_atual, criado_em: agora(), app: 'nexocad', arquivos: arqs });
          evento('item.revisao', id, it.rev_atual);
          return it.rev_atual;
        },
        fecha() { for (const r of ouvintes) { try { r.end(); } catch (_) { /* */ } } return new Promise(f => { servidor.closeAllConnections && servidor.closeAllConnections(); servidor.close(() => f()); }); },
      });
    });
  });
}

module.exports = { inicia };

if (require.main === module) {
  const i = process.argv.indexOf('--porta');
  inicia({ porta: i > 0 ? Number(process.argv[i + 1]) : 0 }).then(s => {
    process.stdout.write('pronto ' + s.url + '\n');
    /* comandos do teste em Python, uma linha JSON por vez no stdin */
    let resto = '';
    process.stdin.on('data', d => {
      resto += d;
      let k;
      while ((k = resto.indexOf('\n')) >= 0) {
        const linha = resto.slice(0, k); resto = resto.slice(k + 1);
        try {
          const c = JSON.parse(linha);
          if (c.cmd === 'revisaoNexo') process.stdout.write(JSON.stringify({ rev: s.revisaoNexo(c.id, c.dados) }) + '\n');
          else if (c.cmd === 'fim') { s.fecha().then(() => process.exit(0)); }
        } catch (e) { process.stdout.write(JSON.stringify({ erro: String(e) }) + '\n'); }
      }
    });
    process.stdin.on('end', () => process.exit(0));
  });
}
