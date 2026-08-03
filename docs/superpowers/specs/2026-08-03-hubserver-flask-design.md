# hubserver.py — servidor Flask com auto-reload — design

Data: 2026-08-03 · Branch: v2-esquema · Status: aprovado pelo usuário

## Problema / Objetivo

O hub é 100% estático e abre por duplo clique, mas o usuário quer **ver em tempo real**
os espelhos que exporta do Altium (esquema, libs, PCB dos projetos), inclusive de outras
máquinas da rede local. Solução: um servidor Flask opcional que serve o workspace inteiro
e recarrega o browser sozinho quando um export grava arquivos.

## Decisões aprovadas

- **Acesso**: rede local (`0.0.0.0`), porta padrão **8000** (flag `--port`). O servidor
  imprime ao subir as duas URLs: `http://127.0.0.1:8000` e `http://<IP-LAN>:8000`.
- **Auto-reload**: sim (SSE + polling de mtime), sem dependências além do Flask já
  instalado (Python 3.11 + Flask 3.1.3 verificados na máquina).
- **Aditivo**: NENHUM arquivo existente do hub é editado; `file://` por duplo clique
  continua funcionando idêntico. Scripts `.pas` e formatos de dados intocados.

## Arquivo único: `hubserver.py` (raiz do workspace)

| Rota | Comportamento |
|---|---|
| `/` | serve o conteúdo de `hub.html` diretamente (com a injeção de HTML abaixo; sem redirect) |
| `/<path>` | serve qualquer arquivo do workspace (safe_join — sem traversal; segmentos iniciados por `.` retornam 404; `.html` injetado via Response), UTF-8, com `Cache-Control: no-store` (dados `.js` sempre frescos) |
| `/__events` | SSE (`text/event-stream`): emite `event: change` quando o watcher detecta mudança; heartbeat (comentário) a cada ~15 s para manter a conexão viva |
| `/__live.js` | script gerado pelo servidor: abre `EventSource('/__events')` e faz `location.reload()` ao receber `change`; reconecta sozinho se o servidor cair/voltar |

**Injeção**: ao servir qualquer `.html`, o servidor insere `<script src="/__live.js"></script>`
imediatamente antes do último `</body>` (se não houver `</body>`, anexa ao final). Por isso
nenhum HTML do repo precisa mudar.

**Watcher**: thread de fundo revarre a cada ~1 s os mtimes de `projects.js`, `Libs\*.js`
e `Projects\**` (árvore pequena; `os.scandir` recursivo é suficiente). Mudança detectada →
incrementa um contador global; os handlers SSE observam o contador e emitem `change`.

**Execução**: `python hubserver.py [--port N]`, `threaded=True` (SSE segura conexões
abertas). Primeira execução pode disparar o prompt do firewall do Windows (documentar).

## Limitações assumidas (v1)

- Reload é da **página inteira**: um export com o hub aberto volta a vista para
  "Projetos" (iframes recarregam mantendo o projeto). Refino futuro: reload escopado.
- Servidor de desenvolvimento do Flask (suficiente para uso interno na LAN; não é
  exposição pública).
- Sem autenticação — mesma premissa de confiança do compartilhamento de rede já usado.

## Verificação

- Subir numa porta alternativa e, via curl/PowerShell: `/` responde 200 com
  `<script src="/__live.js">` injetado antes de `</body>`; `Libs/schlib.js` responde 200
  com `Cache-Control: no-store`; `/__live.js` responde 200; `curl -N /__events` recebe
  `event: change` em ≤ ~3 s após tocar um arquivo dentro de `Projects\`.
- `python -m py_compile hubserver.py` limpo.
- Nenhum arquivo além de `hubserver.py`, README e spec/plano no diff.
- Verificação manual do usuário: rodar o servidor, abrir de outra máquina da rede,
  rodar um Export no Altium e ver a página recarregar sozinha.

## Fora de escopo

- Reload escopado por projeto/vista; produção (waitress/nginx); autenticação; HTTPS;
  empacotamento (exe). Correção das fixtures de teste em `Libs\` (pendência separada já
  registrada).
