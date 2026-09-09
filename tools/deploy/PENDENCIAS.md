# Correções de código que o deploy exige

Os arquivos abaixo **não são do integrador**, então esta lista é um pedido aos
donos, não uma mudança feita. Cada item traz arquivo:linha medido nesta árvore.

O corte é este: o **Grupo 1 precisa estar pronto antes de o hub existir numa porta
da LAN**, no .192 ou em qualquer outra máquina. O Grupo 2 pode vir depois.

---

## Grupo 1 — antes de expor o hub

### 1.1 `GET /hub-almox.json` entrega a senha do Odoo em texto claro
`hubserver.py:120-133` · dono: `agente/bom-almox`

`_serve` só recusa segmento começado por ponto (`:121`); a curinga
`/<path:path>` (`:141`) serve qualquer arquivo do ROOT. Reproduzido com
`REMOTE_ADDR` de outra máquina: **200** com `url`, `db`, `login` e `senha`. Pela
mesma rota saem `tools/almox/componentes_odoo.csv` (723 KB: custo, preço de venda,
part number de fornecedor), `Libs/Almox/almox.sqlite` e os `.py` de `tools/`.

Lista de nomes proibidos **não resolve**: `api_almox_config_set`
(`hubserver.py:599-603`) grava `hub-almox.json.tmp` antes do `os.replace`, e esse
nome escapa de qualquer denylist. O que fecha é allowlist — servir só
`ROOT/*.{html,js,css}`, `Projects/**` e `Libs/**` menos `Libs/Almox/`, e `abort(404)`
no resto.

O comentário de `hubserver.py:548` afirma o contrário do que o código faz e precisa
sair junto.

### 1.2 As credenciais não podem morar no diretório servido
`hubserver.py:551` · `tools/symbols/symserver.py:782` · `tools/almox/odoo_pull.py:31`

Enquanto o arquivo estiver no ROOT, cada furo novo de path o expõe de novo.

```python
ALMOX_CFG_FILE = os.environ.get('ALTIUMHUB_ALMOX') or 'hub-almox.json'
```

No servidor, `Environment=ALTIUMHUB_ALMOX=/etc/altiumhub/almox.json` no drop-in do
systemd, `chmod 600`, dono `altiumhub`.

### 1.3 A mesma senha está replicada em quatro worktrees e servida em quatro portas
`tools/wt-novo.ps1:38-45`

O script copia `hub-almox.json` e `componentes_odoo.csv` para cada worktree novo, e
os quatro irmãos já têm a sua cópia. Com `app.run(host='0.0.0.0')`
(`hubserver.py:938`), a credencial é baixável de `LUCAS-PC:8001` a `:8004` enquanto
os agentes trabalham. Nenhum dos quatro precisa dela para mexer em `hub-laser.js`
ou `pcbframe.js`.

Tirar as duas linhas do script, apagar as quatro cópias e **trocar a senha no
Odoo** — ela deve ser considerada comprometida antes de virar a de produção.

### 1.4 Injeção de argumento em `POST /api/symbols/extract`
`tools/symbols/symserver.py:609-611` e `:637-638`

`fonte` é aceito cru (só `isinstance` e não-vazio) e concatenado **depois** de
`--config/--saida/--relatorio`. Reproduzido contra o parser real de
`extrair.py:1056-1063`: `fonte=["/etc","--saida","/srv/altiumhub/current/hub-core.js"]`
sai como `Namespace(saida='/srv/altiumhub/current/hub-core.js', ...)`, e
`escreve_symlib` grava ali incondicionalmente (`extrair.py:1077`). É escrita de
arquivo arbitrária a partir de um POST sem credencial.

Duas pernas: recusar `f.startswith('-')`, e pôr os argumentos fixos **por último**,
para o last-wins do argparse favorecer o servidor.

### 1.5 Sete rotas POST do symserver escrevem sem autenticação nenhuma
`tools/symbols/symserver.py` linhas 357, 415, 531, 596, 669, 757, 789

`/save` aplica patch na `.SchLib` real da casa (`_patch_altium`, `:319`);
`/save-almox` grava em `Libs/Almox/` e no ledger; `/lib` tem `op=delete`;
`/mirror` regera `Libs/schlib.js` inteiro; `/almox-sync` dispara XML-RPC contra o
Odoo. O `_is_local` existe em `:111` e aparece **uma única vez** no arquivo, em
`:354`, só como campo informativo de um GET.

Mínimo viável: `@bp.before_request` que exija, para `request.method == 'POST'`, um
header comparado com `hmac.compare_digest` contra `os.environ['ALTIUMHUB_TOKEN']`.
Paliativo barato: `if not _is_local(request): return _erro(..., 403)` nas cinco
rotas de edição.

### 1.6 `POST /api/save` grava `Libs/lib-subs.js`, que o hub executa como `<script>`
`hubserver.py:153-176` · `hub.html:1877-1886`

A validação de caminho é sólida (tentei `..`, `%2e%2e` e `Projects/C:/` e nenhum
passa). O problema é o alvo permitido: `lib-subs.js` entra por `loadVarScript`, e o
conteúdo é `str(data['content'])` livre. XSS armazenado na mesma origem que serve o
item 1.1.

O que fazer depende da decisão 0.1 do [INSTALL.md](INSTALL.md): se o Windows
continua dono, gatear `/api/save` por `_is_local`; se o servidor é o dono, a rota
precisa da mesma autenticação do item 1.5.

### 1.7 `MASTER_PASSWORD` com default público
`hubserver.py:470`

`os.environ.get('ALTIUMHUB_MASTER') or 'LucasGatao'`, em arquivo versionado no
GitHub. Vira `os.environ.get('ALTIUMHUB_MASTER')`, e `api_project_delete` responde
503 quando for `None` e o request não for local. O drop-in do systemd já está no
[INSTALL.md](INSTALL.md) item 4.

### 1.8 Sem `hub-almox.json`, o sincronismo puxa do ERP de teste em silêncio
`tools/almox/odoo_pull.py:34-35`, `:50-61`

`PADRAO` traz `http://192.168.15.182:8070` cravado. Um servidor novo nasce sem o
arquivo (`.gitignore`), então `le_config()` devolve o servidor de **teste** sem
avisar. Medido em quatro cenários: arquivo ausente, `ODOO_SENHA` no ambiente,
`"url":""` gravado pela tela e JSON com vírgula sobrando — os quatro voltam ao .182.

Tirar a URL do `PADRAO` e falhar alto quando não houver `url` configurada. E
`hubserver.py:597` não deve gravar string vazia por cima de uma URL válida.

---

## Grupo 2 — depois, mas antes de doer

### 2.1 O gerador do espelho escreve CRLF
`tools/symbols/sch_leitor.py:784` e `:797` · `tools/almox/schlib_escritor.py:692`

`Libs/schlib.js` (410 CRLF / 0 LF), `libs-report.txt` (182/0), `symbols-lib.js`
(901/0) e `pcblib.js` (627/0) já estão assim no disco. O `.gitattributes` que
acabei de versionar impede o ping-pong entre as máquinas, mas o gerador continua
escrevendo CRLF. Trocar por `'\n'.join(...)`: nenhum consumidor exige CRLF
(`schframe.html:587` carrega como `<script>`, `hubserver.py:355` via
`load_var_file`, `tests/load.js` via `new Function`).

### 2.2 Login recusado some com a mensagem certa
`tools/almox/odoo_pull.py:82-83` · `tools/symbols/symserver.py:842-845`

`raise SystemExit` atravessa o `except Exception` de `guardiao.py:671` e pula
`grava_ledger`/`escreve_resumo`. O balão da tela mostra o resumo da rodada
**anterior**, ou uma mensagem genérica. Trocar por `RuntimeError`, e envolver o
`authenticate` num `except xmlrpc.client.Fault` que diga "base X não existe nesse
Odoo".

### 2.3 Sem `componentes_odoo.csv`, o botão "só regerar" estoura
`tools/almox/almox2lib.py:675`

`csv.DictReader(io.open(CSV_ODOO))` sem guarda. O arquivo está no `.gitignore`, e
um clone novo nasce sem ele — e o caminho alternativo (`pull:true`) exige senha
gravada, que exige localhost. Ovo e galinha no dia um do servidor. O
[INSTALL.md](INSTALL.md) item 5 contorna semeando por `scp`; o conserto é degradar
com mensagem em vez de traceback.

### 2.4 Sem `MAX_CONTENT_LENGTH`, um POST anônimo enche o disco
`hubserver.py` (config do app)

Numa máquina que hospeda o ERP, disco cheio é incidente de ERP.

### 2.5 O watcher varre `Libs/Almox` a cada segundo
`hubserver.py:53-70`

`_snapshot()` faz `os.walk` em `Libs` e `Projects` a cada 1,0 s. `Libs/Almox` é a
maior árvore e nada dentro dela dispara reload útil. Podar o diretório no walk é
barato e tira I/O constante de cima do Odoo.

### 2.6 O hub não mostra qual versão está no ar
`hub-ui.js` / cabeçalho · dono: `agente/page`

O `deploy.sh` imprime o hash no push, mas quem abre a tela não tem como saber. O
cabeçalho já existe; falta uma linha lendo um `/api/version` que devolva
`os.path.basename(os.path.realpath(ROOT))` — que, com o desenho de release, é
exatamente o short hash do commit.

### 2.7 `tools/symbols/config.json` é versionado e é 100% da máquina
Aponta para `Y:\Biblioteca\ALTIUM LIBRARY ------ LUCAS\...`. O `deploy.sh` já o
trata como estado compartilhado, mas o certo é `git rm --cached`, entrada no
`.gitignore` ao lado de `hub-config.json`, e um `config.exemplo.json` versionado.
`symserver.py:175-186` já trata a ausência caindo em `L.LIB_PADRAO`, então tirar do
git não exige código.
