/* NexoEletric - hub-nexocode.js — o botao NexoCODE do esquema (1.100.0).
   Abre, por cima da janela inteira, as perguntas que montam o pedido de firmware para o NexoCode (o editor de
   firmware da atmosfera Nexo): o produto animado de um lado (o microcontrolador do esquema com os GPIO ligados se
   acendendo) e as perguntas uma a uma do outro — ja tem software? onde (pasta ou GitHub)? o que o sistema faz?
   referencias (interface, repositorio, codigo...)? No fim o pedido vai para POST /api/nexocode/abrir
   (tools/rotas/nexocode.py), que abre o NexoCode com ele; a IA de la comeca pelo esquema.
   O esquema vem da tela (window.__hubEsquemaFirmware, schframe.js): o que esta desenhado agora, salvo ou nao. */
(function(){
  'use strict';
  const TOPO = (function(){ try { return window.top.document ? window.top : window; } catch (_e){ return window; } })();
  const DOC = TOPO.document;
  const API = '/api/nexocode';

  /* ------------------------------------------------------------ o esquema visto pelo firmware ------------------------------ */
  const RE_MCU = /\bESP32|ESP-?WROOM|ESP-?WROVER|ESP8266|ESP-?12|RP2040|STM32|ATMEGA|ATTINY/i;
  const ALIM = /^(GND|AGND|DGND|PGND|VCC|VDD|VDDA|3V3|3\.3V|\+3V3|\+3\.3V|5V|\+5V|VIN|VBUS|VBAT|\+12V|12V|\+24V|24V|EPAD|EP|PAD)$/i;
  function gpioDe(nome){
    const n = String(nome || '').toUpperCase().replace(/[\s-]+/g, '_');
    const esp = { TXD0:1, U0TXD:1, RXD0:3, U0RXD:3, SENSOR_VP:36, VP:36, SENSOR_VN:39, VN:39 };
    if (esp[n] !== undefined) return esp[n];
    let m = /^(?:GPIO|IO)_?(\d{1,2})\b/.exec(n) || /(?:^|[/_])(?:GPIO|IO)_?(\d{1,2})(?:$|[/_])/.exec(n);
    return m ? +m[1] : null;
  }
  function resumo(esq){
    const porRef = new Map();
    for (const c of esq.componentes){ const a = porRef.get(c.ref); if (a) a.pinos = a.pinos.concat(c.pinos); else porRef.set(c.ref, Object.assign({}, c, { pinos:c.pinos.slice() })); }
    const comps = [...porRef.values()];
    const conector = c => /^(J|CN|P|X|CON|JP|H)\d/i.test(c.ref);
    const mcus = comps.filter(c => !conector(c) && RE_MCU.test((c.comment || '') + ' ' + (c.sym || '') + ' ' + (c.footprint || '')));
    mcus.sort((a, b) => b.pinos.filter(p => p.net).length - a.pinos.filter(p => p.net).length);
    const mcu = mcus[0] || null;
    const netComps = new Map();
    for (const c of comps) for (const p of c.pinos){ if (!p.net) continue; if (!netComps.has(p.net)) netComps.set(p.net, new Set()); netComps.get(p.net).add(c.ref); }
    const gpios = [];
    if (mcu) for (const p of mcu.pinos){
      if (!p.net || ALIM.test(p.net) || ALIM.test(p.name || '')) continue;
      const g = gpioDe(p.name); if (g === null) continue;
      const outros = [...(netComps.get(p.net) || [])].filter(r => r !== mcu.ref);
      if (!outros.length && /^Net/i.test(p.net)) continue;
      gpios.push({ g, net:p.net, outros });
    }
    gpios.sort((a, b) => a.g - b.g);
    return { mcu, gpios, total:comps.length };
  }

  /* ------------------------------------------------------------ estilo (tokens do hub-tema.css) ---------------------------- */
  const CSS = `
  .ncw-fundo{position:fixed;inset:0;z-index:9500;display:grid;grid-template-columns:minmax(380px,1fr) minmax(460px,560px);background:radial-gradient(1100px 700px at 25% 40%,rgba(var(--tint),.10),transparent 60%),var(--scrim,rgba(0,0,0,.72));backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);font-family:var(--font);color:var(--text);animation:ncw-in .35s ease-out}
  @keyframes ncw-in{from{opacity:0}to{opacity:1}}
  .ncw-palco{position:relative;display:grid;place-items:center;overflow:hidden}
  .ncw-palco svg{width:min(92%,720px);height:auto;overflow:visible}
  .ncw-palco .ncw-produto{position:absolute;left:36px;top:30px;max-width:60%}
  .ncw-produto small{display:block;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--text-3)}
  .ncw-produto b{display:block;font-size:26px;letter-spacing:-.02em;margin-top:2px}
  .ncw-produto span{color:var(--text-2);font-size:13px}
  .ncw-lado{display:flex;flex-direction:column;justify-content:center;padding:40px 44px 40px 8px;gap:18px;min-height:0}
  .ncw-marca{display:flex;align-items:center;gap:10px;font-weight:700;font-size:15px}
  .ncw-marca i{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:var(--hi);color:var(--on-hi);font:800 11px var(--mono);font-style:normal;box-shadow:0 0 30px -6px var(--hi)}
  .ncw-marca span{color:var(--hi)}
  .ncw-x{margin-left:auto;width:32px;height:32px;border-radius:8px;border:1px solid var(--edge);background:transparent;color:var(--text-2);cursor:pointer;font-size:16px}
  .ncw-x:hover{color:var(--text);background:var(--surface-3)}
  .ncw-passos{display:flex;gap:6px}
  .ncw-passos i{height:4px;flex:1;border-radius:2px;background:var(--surface-3);transition:background .4s}
  .ncw-passos i.feito{background:var(--hi)}
  .ncw-passos i.agora{background:linear-gradient(90deg,var(--hi),var(--surface-3));background-size:200% 100%;animation:ncw-barra 1.4s linear infinite}
  @keyframes ncw-barra{to{background-position:-200% 0}}
  .ncw-cartao{background:var(--surface);border:1px solid var(--edge);border-radius:var(--r-lg,14px);padding:26px 26px 22px;box-shadow:0 40px 90px -40px rgba(0,0,0,.8);animation:ncw-sobe .45s cubic-bezier(.2,.8,.2,1);max-height:calc(100vh - 220px);overflow:auto}
  .ncw-cartao.sai{animation:ncw-desce .22s ease-in forwards}
  @keyframes ncw-sobe{from{opacity:0;transform:translateY(22px) scale(.98)}to{opacity:1;transform:none}}
  @keyframes ncw-desce{to{opacity:0;transform:translateY(-14px) scale(.98)}}
  .ncw-cartao h2{margin:0 0 6px;font-size:21px;line-height:1.3;letter-spacing:-.01em;min-height:1.3em}
  .ncw-cartao h2 .cur{display:inline-block;width:2px;height:1em;background:var(--hi);margin-left:2px;vertical-align:-2px;animation:ncw-pisca .8s steps(1) infinite}
  @keyframes ncw-pisca{50%{opacity:0}}
  .ncw-cartao p{margin:0 0 16px;color:var(--text-2);font-size:13.5px;line-height:1.5}
  .ncw-ops{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:6px 0 4px}
  .ncw-op{display:flex;flex-direction:column;gap:4px;align-items:flex-start;text-align:left;padding:16px;border-radius:12px;border:1px solid var(--edge);background:var(--surface-2);color:var(--text);cursor:pointer;font:inherit;transition:border-color .15s,transform .15s,background .15s}
  .ncw-op:hover{border-color:var(--hi);transform:translateY(-2px)}
  .ncw-op.sel{border-color:var(--hi);background:rgba(var(--tint),.10);box-shadow:0 0 0 3px rgba(var(--tint),.12)}
  .ncw-op b{font-size:15px}.ncw-op span{font-size:12px;color:var(--text-3)}
  .ncw-op .ico{font-size:22px;line-height:1;margin-bottom:4px}
  .ncw-campo{display:flex;flex-direction:column;gap:6px;margin:12px 0 0}
  .ncw-campo label{font-size:12px;color:var(--text-3);font-weight:600}
  .ncw-campo input,.ncw-campo textarea,.ncw-campo select{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:1px solid var(--edge);background:var(--sunken,var(--bg));color:var(--text);font:inherit;font-size:13.5px;outline:none}
  .ncw-campo textarea{min-height:120px;resize:vertical;line-height:1.5}
  .ncw-campo input:focus,.ncw-campo textarea:focus,.ncw-campo select:focus{border-color:var(--hi);box-shadow:0 0 0 3px rgba(var(--tint),.15)}
  .ncw-linha{display:flex;gap:8px;align-items:center}
  .ncw-linha>input{flex:1}
  .ncw-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
  .ncw-chip{padding:5px 11px;border-radius:14px;border:1px solid var(--edge);background:var(--surface-2);color:var(--text-2);font:inherit;font-size:12px;cursor:pointer}
  .ncw-chip:hover,.ncw-chip.sel{border-color:var(--hi);color:var(--hi)}
  .ncw-refs{display:flex;flex-direction:column;gap:6px;margin-top:12px}
  .ncw-ref{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;background:var(--surface-2);border:1px solid var(--edge);font-size:12.5px;animation:ncw-sobe .3s}
  .ncw-ref .t{font-size:10.5px;padding:2px 7px;border-radius:8px;background:rgba(var(--tint),.14);color:var(--hi);text-transform:uppercase;letter-spacing:.06em;flex:none}
  .ncw-ref .u{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ncw-ref button{border:0;background:transparent;color:var(--text-3);cursor:pointer;font-size:14px}
  .ncw-rodape{display:flex;align-items:center;gap:10px;margin-top:20px}
  .ncw-rodape .cresce{flex:1}
  .ncw-btn{height:38px;padding:0 18px;border-radius:10px;border:1px solid var(--edge);background:var(--surface-2);color:var(--text);font:inherit;font-weight:600;font-size:13.5px;cursor:pointer}
  .ncw-btn:hover{border-color:var(--text-3)}
  .ncw-btn.pri{background:var(--hi);border-color:var(--hi);color:var(--on-hi)}
  .ncw-btn.pri:hover{filter:brightness(1.1)}
  .ncw-btn:disabled{opacity:.45;cursor:default}
  .ncw-dica{font-size:12px;color:var(--text-3)}
  .ncw-aviso{padding:10px 12px;border-radius:10px;background:var(--warn-soft,rgba(255,180,0,.1));color:var(--warn);font-size:12.5px;margin-top:12px}
  .ncw-resumo{display:grid;grid-template-columns:130px 1fr;gap:6px 12px;font-size:13px;margin:4px 0 6px}
  .ncw-resumo dt{color:var(--text-3)}.ncw-resumo dd{margin:0;overflow:hidden;text-overflow:ellipsis}
  .ncw-voando{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none}
  .ncw-voando i{width:16px;height:16px;border-radius:50%;background:var(--hi);box-shadow:0 0 30px 8px var(--hi);animation:ncw-voa 1.1s cubic-bezier(.5,0,.2,1) forwards}
  @keyframes ncw-voa{from{transform:translate(0,0) scale(1);opacity:1}to{transform:translate(52vw,-30vh) scale(.2);opacity:0}}
  .ncw-svg-chip{fill:var(--surface-3);stroke:var(--edge);stroke-width:1.5}
  .ncw-svg-txt{fill:var(--text);font:700 15px var(--mono)}
  .ncw-svg-sub{fill:var(--text-3);font:11px var(--font)}
  .ncw-svg-pino{fill:var(--text-4,var(--text-3))}
  .ncw-svg-fio{fill:none;stroke:var(--edge);stroke-width:1.6}
  .ncw-svg-pulso{fill:none;stroke:var(--hi);stroke-width:2.4;stroke-linecap:round;stroke-dasharray:14 400;animation:ncw-corre 2.6s linear infinite;filter:drop-shadow(0 0 4px var(--hi))}
  @keyframes ncw-corre{from{stroke-dashoffset:414}to{stroke-dashoffset:0}}
  .ncw-svg-no{fill:var(--surface-2);stroke:var(--edge)}
  .ncw-svg-no.aceso{stroke:var(--hi);animation:ncw-acende 2.6s ease-in-out infinite}
  @keyframes ncw-acende{0%,100%{fill:var(--surface-2)}50%{fill:rgba(var(--tint),.22)}}
  .ncw-svg-rot{fill:var(--text-2);font:11px var(--mono)}
  .ncw-svg-g{fill:var(--hi);font:700 10.5px var(--mono)}
  .ncw-svg-anel{fill:none;stroke:var(--hi);stroke-width:1.5;opacity:.5;transform-origin:center;transform-box:fill-box;animation:ncw-anel 3s ease-out infinite}
  @keyframes ncw-anel{from{transform:scale(1);opacity:.45}to{transform:scale(1.7);opacity:0}}
  @media (max-width:980px){.ncw-fundo{grid-template-columns:1fr}.ncw-palco{display:none}.ncw-lado{padding:30px}}`;
  function garanteCss(){
    if (DOC.getElementById('ncw-css')) return;
    const s = DOC.createElement('style'); s.id = 'ncw-css'; s.textContent = CSS; DOC.head.appendChild(s);
  }
  const h = (tag, cls, txt) => { const e = DOC.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));

  /* ------------------------------------------------------------ o produto animado ------------------------------------------ */
  function palco(info, projeto){
    const W = 720, H = 560, cx = W / 2, cy = H / 2, cw = 150, ch = 190;
    const lista = info.gpios.slice(0, 16);
    const esq = lista.filter((_, i) => i % 2 === 0), dir = lista.filter((_, i) => i % 2 === 1);
    let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;
    s += `<rect class="ncw-svg-anel" x="${cx - cw / 2}" y="${cy - ch / 2}" width="${cw}" height="${ch}" rx="14"/>`;
    const lado = (arr, sinal) => arr.forEach((p, i) => {
      const n = arr.length, yP = cy - ch / 2 + 22 + i * ((ch - 44) / Math.max(1, n - 1 || 1));
      const yN = 40 + i * ((H - 80) / Math.max(1, n - 1 || 1));
      const xP = cx + sinal * cw / 2, xN = cx + sinal * 255;
      const d = `M${xP},${yP} C${xP + sinal * 70},${yP} ${xN - sinal * 90},${yN} ${xN},${yN}`;
      const atraso = (i * 0.37 + (sinal > 0 ? 0.18 : 0)).toFixed(2);
      s += `<path class="ncw-svg-fio" d="${d}"/><path class="ncw-svg-pulso" d="${d}" style="animation-delay:${atraso}s"/>`;
      s += `<rect class="ncw-svg-pino" x="${sinal > 0 ? xP : xP - 8}" y="${yP - 2}" width="8" height="4" rx="1"/>`;
      const bw = 118, bx = sinal > 0 ? xN : xN - bw;
      s += `<rect class="ncw-svg-no aceso" x="${bx}" y="${yN - 15}" width="${bw}" height="30" rx="8" style="animation-delay:${(+atraso + 1.6).toFixed(2)}s"/>`;
      s += `<text class="ncw-svg-g" x="${bx + 9}" y="${yN - 1}">IO${p.g}</text>`;
      s += `<text class="ncw-svg-rot" x="${bx + 9}" y="${yN + 10}">${esc((p.outros[0] || p.net).slice(0, 15))}</text>`;
    });
    lado(esq, -1); lado(dir, 1);
    s += `<rect class="ncw-svg-chip" x="${cx - cw / 2}" y="${cy - ch / 2}" width="${cw}" height="${ch}" rx="14"/>`;
    s += `<rect x="${cx - cw / 2 + 16}" y="${cy - ch / 2 + 14}" width="${cw - 32}" height="34" rx="4" fill="none" stroke="var(--edge)" stroke-dasharray="3 3"/>`;
    s += `<text class="ncw-svg-txt" x="${cx}" y="${cy + 4}" text-anchor="middle">${esc(info.mcu ? (info.mcu.comment || info.mcu.sym || 'MCU').slice(0, 16) : 'sem MCU')}</text>`;
    s += `<text class="ncw-svg-sub" x="${cx}" y="${cy + 24}" text-anchor="middle">${info.mcu ? esc(info.mcu.ref) + ' · ' + info.gpios.length + ' GPIO' : 'nenhum microcontrolador'}</text>`;
    s += `</svg>`;
    const p = h('div', 'ncw-palco');
    p.innerHTML = s;
    const prod = h('div', 'ncw-produto');
    prod.append(h('small', '', 'Produto'), h('b', '', projeto), h('span', '', info.total + ' componentes no esquema'));
    p.append(prod);
    return p;
  }

  /* ------------------------------------------------------------ as perguntas ---------------------------------------------- */
  function digitar(alvo, texto){
    alvo.textContent = '';
    const cur = h('span', 'cur');
    let i = 0;
    const passo = () => { alvo.textContent = texto.slice(0, i); alvo.append(cur); if (i++ < texto.length) setTimeout(passo, 14 + Math.random() * 18); else setTimeout(() => cur.remove(), 900); };
    passo();
  }
  const pedir = (url, corpo) => fetch(url, corpo === undefined ? {} : { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(corpo) })
    .then(r => r.json().catch(() => ({ ok:false, erro:'HTTP ' + r.status })));

  function abrir(){
    garanteCss();
    if (DOC.querySelector('.ncw-fundo')) return;
    let esq;
    try { esq = window.__hubEsquemaFirmware(); } catch (e){ (window.HubDialog || {}).toast && HubDialog.toast('não deu para ler o esquema: ' + (e && e.message || e), 'err'); return; }
    const info = resumo(esq);
    const codigo = (/CodigoDaPlaca=([^;]*)/.exec(esq.params || '') || [])[1] || '';
    const r = { temSoftware:null, origem:{ tipo:'', valor:'' }, destino:'', framework:'arduino', funcionalidade:'', referencias:[], gerar:true };
    let estado = { instalado:true, aberto:false };
    pedir(API + '/estado').then(j => { if (j && j.ok) estado = j; }).catch(() => {});

    const fundo = h('div', 'ncw-fundo');
    const lado = h('div', 'ncw-lado');
    const cab = h('div', 'ncw-marca');
    const logo = h('i', '', '</>');
    const nome = h('div'); nome.innerHTML = 'Nexo<span>CODE</span>';
    const fechar = h('button', 'ncw-x', '×'); fechar.title = 'Fechar (Esc)';
    cab.append(logo, nome, fechar);
    const barra = h('div', 'ncw-passos');
    const area = h('div');
    lado.append(cab, barra, area);
    fundo.append(palco(info, esq.projeto + (codigo ? ' · ' + codigo : '')), lado);
    DOC.body.appendChild(fundo);

    const sair = () => { fundo.style.transition = 'opacity .2s'; fundo.style.opacity = '0'; setTimeout(() => fundo.remove(), 220); DOC.removeEventListener('keydown', teclas, true); };
    fechar.onclick = sair;
    const teclas = e => { e.stopPropagation(); if (e.key === 'Escape'){ e.preventDefault(); sair(); } };
    DOC.addEventListener('keydown', teclas, true);

    const etapas = ['inicio', 'tem', 'onde', 'func', 'refs', 'fim'];
    let atual = 0;
    function marcarBarra(){ barra.replaceChildren(...etapas.map((_, i) => h('i', i < atual ? 'feito' : i === atual ? 'agora' : ''))); }
    function cartao(titulo, texto){
      const velho = area.firstChild;
      const c = h('div', 'ncw-cartao');
      const t = h('h2'); c.append(t);
      if (texto){ const p = h('p'); p.innerHTML = texto; c.append(p); }
      const montar = () => { area.replaceChildren(c); digitar(t, titulo); };
      if (velho){ velho.classList.add('sai'); setTimeout(montar, 200); } else montar();
      marcarBarra();
      return c;
    }
    function rodape(c, { voltar = true, proximo = 'Continuar', ao, pular } = {}){
      const f = h('div', 'ncw-rodape');
      if (voltar && atual > 0){ const b = h('button', 'ncw-btn', 'Voltar'); b.onclick = () => ir(atual - 1); f.append(b); }
      f.append(h('div', 'cresce'));
      if (pular){ const b = h('button', 'ncw-btn', pular); b.onclick = () => ir(atual + 1); f.append(b); }
      let p = null;
      if (proximo){ p = h('button', 'ncw-btn pri', proximo); p.onclick = ao || (() => ir(atual + 1)); f.append(p); }
      c.append(f);
      return p;
    }
    function opcao(icone, titulo, sub, sel, ao){
      const b = h('button', 'ncw-op' + (sel ? ' sel' : ''));
      b.append(h('div', 'ico', icone), h('b', '', titulo), h('span', '', sub));
      b.onclick = ao;
      return b;
    }
    function ir(n){ atual = Math.max(0, Math.min(etapas.length - 1, n)); ({ inicio, tem, onde, func, refs, fim })[etapas[atual]](); }

    function inicio(){
      const c = cartao('Vamos criar o firmware de ' + esq.projeto + '?',
        info.mcu ? 'Achei o <b>' + esc(info.mcu.comment || info.mcu.sym) + '</b> (' + esc(info.mcu.ref) + ') com <b>' + info.gpios.length + ' GPIO</b> ligados no esquema. Umas perguntas rápidas e o NexoCode abre com tudo pronto: os pinos viram código e a IA começa pelo esquema.'
                 : 'Não reconheci um microcontrolador neste esquema (ESP32, ESP8266, RP2040, STM32...). Dá para seguir: a IA lê o esquema inteiro e pergunta o que faltar.');
      const p = rodape(c, { voltar:false, proximo:'Começar' });
      setTimeout(() => p.focus(), 300);
    }
    function tem(){
      const c = cartao('Este produto já tem um software?', 'Se já existe código (mesmo que velho ou incompleto), a IA lê, compara com o esquema e continua de onde parou.');
      const ops = h('div', 'ncw-ops');
      ops.append(opcao('✓', 'Sim, já tem', 'numa pasta deste PC ou no GitHub', r.temSoftware === true, () => { r.temSoftware = true; ir(2); }),
                 opcao('✦', 'Não, do zero', 'o NexoCode cria o projeto', r.temSoftware === false, () => { r.temSoftware = false; ir(2); }));
      c.append(ops);
      rodape(c, { proximo:null });
    }
    function onde(){
      if (r.temSoftware){
        const c = cartao('Onde está o software?', 'Uma pasta deste PC ou o link do repositório (o NexoCode clona).');
        const ops = h('div', 'ncw-ops');
        const campo = h('div', 'ncw-campo');
        const desenhaCampo = () => {
          campo.replaceChildren();
          if (r.origem.tipo === 'github'){
            campo.append(h('label', '', 'Link do repositório'));
            const i = h('input'); i.placeholder = 'https://github.com/empresa/firmware-produto'; i.value = r.origem.valor;
            i.oninput = () => { r.origem.valor = i.value.trim(); valida(); };
            campo.append(i); setTimeout(() => i.focus(), 50);
          } else if (r.origem.tipo === 'pasta'){
            campo.append(h('label', '', 'Pasta do software'));
            const l = h('div', 'ncw-linha'); const i = h('input'); i.placeholder = 'C:\\...\\firmware'; i.value = r.origem.valor;
            i.oninput = () => { r.origem.valor = i.value.trim(); valida(); };
            const b = h('button', 'ncw-btn', 'Procurar…');
            b.onclick = async () => { b.disabled = true; const j = await pedir(API + '/pasta', { titulo:'Pasta do software de ' + esq.projeto }); b.disabled = false; if (j && j.pasta){ i.value = r.origem.valor = j.pasta; valida(); } };
            l.append(i, b); campo.append(l);
          }
        };
        ops.append(opcao('📁', 'Pasta neste PC', 'escolher a pasta', r.origem.tipo === 'pasta', () => { r.origem = { tipo:'pasta', valor:r.origem.tipo === 'pasta' ? r.origem.valor : '' }; marca(); desenhaCampo(); valida(); }),
                   opcao('⎇', 'GitHub', 'link do repositório', r.origem.tipo === 'github', () => { r.origem = { tipo:'github', valor:r.origem.tipo === 'github' ? r.origem.valor : '' }; marca(); desenhaCampo(); valida(); }));
        const marca = () => { ops.children[0].classList.toggle('sel', r.origem.tipo === 'pasta'); ops.children[1].classList.toggle('sel', r.origem.tipo === 'github'); };
        c.append(ops, campo);
        const p = rodape(c);
        const valida = () => { p.disabled = !(r.origem.tipo && (r.origem.tipo === 'pasta' ? r.origem.valor.length > 2 : /^(https?:\/\/|git@)/.test(r.origem.valor))); };
        desenhaCampo(); valida();
      } else {
        const c = cartao('Onde criar o projeto?', 'O padrão é Documentos\\NexoCode\\' + esc(esq.projeto) + '. O NexoCode cria um projeto PlatformIO com os pinos do esquema em include/pinos_placa.h.');
        const campo = h('div', 'ncw-campo');
        campo.append(h('label', '', 'Pasta (vazio = padrão)'));
        const l = h('div', 'ncw-linha'); const i = h('input'); i.placeholder = 'Documentos\\NexoCode\\' + esq.projeto; i.value = r.destino;
        i.oninput = () => { r.destino = i.value.trim(); };
        const b = h('button', 'ncw-btn', 'Escolher…');
        b.onclick = async () => { b.disabled = true; const j = await pedir(API + '/pasta', { titulo:'Onde criar o firmware de ' + esq.projeto }); b.disabled = false; if (j && j.pasta){ i.value = r.destino = j.pasta.replace(/[\\/]$/, '') + '\\' + esq.projeto.replace(/[<>:"/\\|?*]+/g, '_'); } };
        l.append(i, b); campo.append(l);
        const fw = h('div', 'ncw-campo'); fw.append(h('label', '', 'Framework'));
        const chips = h('div', 'ncw-chips');
        for (const [v, rot] of [['arduino', 'Arduino (recomendado)'], ['espidf', 'ESP-IDF']]){
          const ch = h('button', 'ncw-chip' + (r.framework === v ? ' sel' : ''), rot);
          ch.onclick = () => { r.framework = v; for (const x of chips.children) x.classList.toggle('sel', x === ch); };
          chips.append(ch);
        }
        fw.append(chips);
        c.append(campo, fw);
        rodape(c);
      }
    }
    function func(){
      const c = cartao('O que o sistema deve fazer?', 'Descreva o funcionamento como contaria a um colega: entradas, saídas, telas, comunicação, regras. Quanto mais claro, melhor o código.');
      const campo = h('div', 'ncw-campo');
      const t = h('textarea'); t.placeholder = 'Ex.: ao apertar o botão liga o relé por 5 s e acende o LED; mostra a temperatura numa página web; manda os dados por MQTT a cada minuto…'; t.value = r.funcionalidade;
      t.oninput = () => { r.funcionalidade = t.value; valida(); };
      campo.append(t);
      const chips = h('div', 'ncw-chips');
      const ideias = ['Página web de configuração do WiFi', 'Controle pelo celular (WiFi)', 'Ler sensores e mandar para um servidor', 'MQTT', 'Modbus RS-485', 'Salvar a configuração na memória', 'Atualização pelo ar (OTA)', 'Modo ponto de acesso na primeira vez', 'Botão com toque longo para resetar', 'Watchdog e reinício seguro'];
      for (const s2 of ideias){ const ch = h('button', 'ncw-chip', '+ ' + s2); ch.onclick = () => { t.value = (t.value.trim() ? t.value.trim() + '\n' : '') + '- ' + s2; r.funcionalidade = t.value; ch.classList.add('sel'); valida(); t.focus(); }; chips.append(ch); }
      c.append(campo, chips);
      const p = rodape(c);
      const valida = () => { p.disabled = r.funcionalidade.trim().length < 8 && !r.temSoftware; };
      valida();
      setTimeout(() => t.focus(), 400);
    }
    function refs(){
      const c = cartao('Quer passar referências?', 'Links de interface (o visual que você quer), repositórios, códigos de exemplo, datasheets. A IA usa na construção — repositórios são clonados para ela ler.');
      const tipo = h('select'); for (const [v, rot] of [['interface', 'Interface'], ['repositorio', 'Repositório'], ['codigo', 'Código / exemplo'], ['datasheet', 'Datasheet'], ['link', 'Outro']]){ const o = h('option', '', rot); o.value = v; tipo.append(o); }
      const url = h('input'); url.placeholder = 'https://…';
      url.oninput = () => { if (/github\.com|gitlab\.com|\.git$/.test(url.value)) tipo.value = 'repositorio'; else if (/\.pdf($|\?)/i.test(url.value)) tipo.value = 'datasheet'; };
      const nota = h('input'); nota.placeholder = 'para que serve (opcional)';
      const add = h('button', 'ncw-btn', 'Adicionar');
      const lista = h('div', 'ncw-refs');
      const desenha = () => {
        lista.replaceChildren(...r.referencias.map((x, i) => { const d = h('div', 'ncw-ref'); const rm = h('button', '', '×'); rm.onclick = () => { r.referencias.splice(i, 1); desenha(); }; d.append(h('span', 't', x.tipo), h('span', 'u', x.url + (x.nota ? ' — ' + x.nota : '')), rm); return d; }));
        prox.textContent = r.referencias.length ? 'Continuar' : 'Pular';
      };
      const incluir = () => { const u = url.value.trim(); if (!u) return; r.referencias.push({ tipo:tipo.value, url:u, nota:nota.value.trim() }); url.value = ''; nota.value = ''; desenha(); url.focus(); };
      add.onclick = incluir;
      url.onkeydown = e => { if (e.key === 'Enter'){ e.preventDefault(); incluir(); } };
      const l1 = h('div', 'ncw-campo'); l1.append(h('label', '', 'Link')); const lin = h('div', 'ncw-linha'); lin.append(url, tipo); l1.append(lin);
      const l2 = h('div', 'ncw-campo'); l2.append(h('label', '', 'Nota')); const lin2 = h('div', 'ncw-linha'); lin2.append(nota, add); l2.append(lin2);
      c.append(l1, l2, lista);
      const prox = rodape(c, { proximo:'Pular' });
      desenha();
      setTimeout(() => url.focus(), 400);
    }
    function fim(){
      const c = cartao('Tudo certo. Abro no NexoCode?', 'O NexoCode monta o projeto, grava os pinos do esquema e a IA começa a escrever o firmware. Dá para acompanhar, simular o ESP32 e depurar lá dentro.');
      const dl = h('dl', 'ncw-resumo');
      const item = (k, v) => { dl.append(h('dt', '', k), h('dd', '', v)); };
      item('Produto', esq.projeto + (codigo ? ' (' + codigo + ')' : ''));
      item('Microcontrolador', info.mcu ? (info.mcu.comment || info.mcu.sym) + ' · ' + info.gpios.length + ' GPIO' : '—');
      item('Software', r.temSoftware ? (r.origem.tipo === 'github' ? 'GitHub: ' : 'Pasta: ') + r.origem.valor : 'novo · ' + (r.framework === 'espidf' ? 'ESP-IDF' : 'Arduino') + (r.destino ? ' · ' + r.destino : ''));
      item('Funcionalidade', r.funcionalidade.trim() ? r.funcionalidade.trim().split('\n')[0].slice(0, 80) + (r.funcionalidade.length > 80 ? '…' : '') : '—');
      item('Referências', r.referencias.length ? r.referencias.length + ' link(s)' : 'nenhuma');
      c.append(dl);
      const lbl = h('label', 'ncw-dica'); const ck = h('input'); ck.type = 'checkbox'; ck.checked = r.gerar; ck.onchange = () => { r.gerar = ck.checked; };
      lbl.append(ck, ' A IA já começa a gerar o código ao abrir');
      c.append(lbl);
      if (!estado.instalado) { const a = h('div', 'ncw-aviso'); a.textContent = 'O NexoCode não está instalado nesta máquina: instale pelo Nexo Hub › Instaladores. O pedido fica guardado e abre quando ele for instalado.'; c.append(a); }
      const p = rodape(c, { proximo:'Abrir no NexoCode', ao: async () => {
        p.disabled = true; p.textContent = 'Enviando…';
        const briefing = { versao:1, projeto:esq.projeto, codigoPlaca:codigo, esquema:{ componentes:esq.componentes }, temSoftware:!!r.temSoftware,
          origem:r.temSoftware ? r.origem : null, destino:r.temSoftware ? '' : r.destino, framework:r.framework, funcionalidade:r.funcionalidade.trim(),
          referencias:r.referencias, gerar:r.gerar };
        const j = await pedir(API + '/abrir', { briefing }).catch(e => ({ ok:false, erro:String(e && e.message || e) }));
        if (j && j.ok){
          const v = h('div', 'ncw-voando'); v.append(h('i')); fundo.append(v);
          p.textContent = 'Abrindo o NexoCode…';
          setTimeout(() => { sair(); if (window.HubDialog) HubDialog.toast('Pedido enviado ao NexoCode — ' + esq.projeto, 'ok', 5000); }, 1100);
        } else {
          p.disabled = false; p.textContent = 'Tentar de novo';
          const a = h('div', 'ncw-aviso'); a.textContent = (j && j.erro) || 'não consegui falar com o NexoCode'; c.insertBefore(a, c.lastChild);
        }
      } });
      setTimeout(() => p.focus(), 400);
    }
    ir(0);
  }

  /* ------------------------------------------------------------ o botao na barra do esquema -------------------------------- */
  function montaBotao(){
    const tb = document.getElementById('schtb');
    if (!tb || document.getElementById('tbNexoCode')) return;
    const sep = document.createElement('span'); sep.className = 'sep';
    const b = document.createElement('button');
    b.id = 'tbNexoCode';
    b.setAttribute('aria-label', 'NexoCODE');
    b.title = 'NexoCODE — gerar o firmware deste esquema com IA (abre o NexoCode com os pinos, a funcionalidade e as referências)';
    b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16"/></svg>';
    const lb = document.createElement('span'); lb.className = 'lb'; lb.textContent = 'NexoCODE';
    b.append(lb);
    b.style.color = 'var(--hi)';
    b.addEventListener('click', abrir);
    tb.append(sep, b);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montaBotao); else montaBotao();
  window.HubNexoCode = { abrir, resumo };
})();
