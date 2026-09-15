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

### 1.8 ~~Sem `hub-almox.json`, o sincronismo puxa do ERP de teste em silêncio~~ FEITO
**Resolvido em 2026-09-15**, a pedido do usuário, no branch do integrador — e não pelos
donos, como o cabeçalho desta lista prescreve. `tools/almox/odoo_pull.py` e `hubserver.py`
são do `agente/bom-almox`; o `APM-bom` estava sem nada pendente na hora, então nada dele
foi publicado pela metade, mas o rebase de lá vai encostar nestes três pontos:

- `odoo_pull.py`: `PADRAO['url']` virou `''`, nasceu `SemUrl(RuntimeError)` e o
  `Odoo.__init__` a levanta com url vazia. `RuntimeError` e não `SystemExit` de propósito:
  quem chama pelo hub tem `except Exception`, e `SystemExit` herda de `BaseException`
  (é o mesmo defeito do item 2.2, ainda aberto na linha de baixo).
- `odoolista.py`: `PADRAO['url']` virou `''`; o guard do `ClienteLista` separou a url dos
  outros campos e diz onde configurar.
- `hubserver.py`: o `"em branco = não mexe"` deixou de valer só para a senha e passou a
  valer para todos os campos — era a segunda frase do conserto prescrito abaixo.

Cobertura: `tests/test_odoo_pull.py` (url vazia, `le_config` sem arquivo, `SemUrl` dentro
de `Exception`) e `tests/test_odoolista.py`.

O texto original, para quem for revisar o rebase:

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

### 2.2 Login recusado some com a mensagem certa — METADE FEITA
**`tools/almox/odoo_pull.py` resolvido em 2026-09-15**, depois de o defeito custar uma
sessão inteira de diagnóstico: com `SEU_LOGIN` no `shared/hub-almox.json`, o painel da BoM
mostrava `sem resposta do servidor: Failed to fetch`, e o usuário foi procurar defeito em
rede, porta e container. O que havia era `SystemExit` — `BaseException`, atravessa o
`except Exception` de quem chama pelo hub, mata a thread do Flask **sem escrever resposta**, e
o navegador chama isso de erro de rede. Virou `LoginRecusado(RuntimeError)`, com a base e o
servidor na mensagem; a CLI reconverte para `SystemExit` no `main()`, então ela continua
mostrando uma linha em vez de pilha. `tests/test_odoo_pull.py` trava as duas metades: que
descende de `Exception` e que **não** descende de `SystemExit`.

Falta `tools/symbols/symserver.py`, e o `except xmlrpc.client.Fault` que diria
"base X não existe nesse Odoo".

O texto original:

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

### 2.7 `tools/symbols/config.json` é versionado — e agora isso é de propósito
~~O certo é `git rm --cached`~~. **Reavaliado**: depois que a biblioteca da casa passou a
ser publicada dentro do repositório (`tools/libpath.py`), esse arquivo virou o **único
lugar que declara onde está a lib VIVA** — `libpath.viva()` lê `schlib` cru dele. Um clone
sem o config não quebra (a ordem cai na cópia publicada), mas a bancada passaria a reciclar
da publicação e a publicação congelaria: ninguém mais saberia de onde atualizar.

O valor apontar para `Y:` também deixou de ser problema no servidor: a ordem só aceita o
config **se o arquivo existir**, e um `Y:\...` lido do Linux nem é reconhecido como
absoluto. O congelamento em `shared/` (`deploy.sh:65`) ficou inofensivo — e é por isso que
esta migração não precisou de uma linha no `deploy.sh`.

O que sobra de válido: um `config.exemplo.json` versionado ajudaria quem clona numa
máquina nova. E a referência antiga a `symserver.py:175-186` caindo em `L.LIB_PADRAO`
está velha: `_config` hoje chama `LP.schlib(ROOT)`, e `sch_leitor.LIB_PADRAO` já não é o
`Y:` — é a própria cópia publicada.

### 2.8 A tela só trava por senha, nunca por url
`hub.html:2059-2062`, `:2093-2094`, `:2101`, `:2147`, `:2151` · dono: `agente/page`
`hub-i18n.js` · dono: `agente/page` · `hub-odoocfg.js:160`, `hub-odoolista.js:331`, `:353`

Rastro medido depois que o 1.8 tirou a url do `PADRAO`. O backend agora recusa sem url,
com frase própria; a interface não sabe disso e só pergunta por `temSenha`:

- `pull.disabled = !temSenha` (`:2093-2094`, espelhado em `:2101`) libera **Puxar do Odoo**
  sem servidor configurado — o clique vai até o backend só para voltar com erro.
- `alxLinhaCfg` (`:2059-2062`) escreve `Odoo — · base odoo_db · … · senha gravada`: o
  travessão no lugar do servidor é a única pista de que falta o essencial.
- `det.open = !cfg.config.temSenha` (`:2147`) não abre o formulário quando o que falta é a
  url, então a pessoa não vê o campo que precisa preencher.
- ~~`:2151` ainda oferece `http://192.168.15.182:8070` como *placeholder*~~ **FEITO em
  2026-09-15**: Servidor e Base viraram somente-leitura (o Odoo da casa é um só) e o
  placeholder do servidor de teste saiu. Só a credencial é editável, e só ela é enviada no
  POST. Mesma coisa em `hub-odoocfg.js`, onde Modelo entrou no grupo dos fixos.
- `hub-odoolista.js:331` repete o pré-voo só-senha, e `:353` deixa o modal escrever
  `odoo_db em  · login`, contra a promessa do README de que o modal sempre mostra o destino.

São ~6 linhas em `hub.html`, 4 em `hub-i18n.js` (uma chave `alx.semUrl` em pt e en, mais a
nota de `:76`/`:298` passando a dizer que "em branco = não mexe" vale para os quatro campos)
e 2 em `hub-odoocfg.js` — que já tem a frase certa escrita para a senha, em `:60`.

### 2.9 `hub-almox.json` ilegível vira `{}`, e o POST seguinte apaga a configuração
`hubserver.py` (`_almox_cfg_read` e `api_almox_config_set`) · dono: `agente/bom-almox`

Arquivo com uma vírgula sobrando (ou BOM do Bloco de Notas) é lido como `{}` sem aviso. O
formulário então grava `{}` mais o campo enviado **por cima do arquivo bom**: url, login e
senha somem. O guard de "em branco = não mexe" do 1.8 não cobre este caso, porque não há
nada em branco — há um dicionário vazio se passando por configuração.

O `odoolista` já resolveu o mesmo problema do lado dele, com a bandeira `arquivoIlegivel`
(`odoolista.py:401`): ler falhou é diferente de não ter nada, e o POST recusa em vez de
sobrescrever. Falta a mesma distinção aqui.

### 2.10 Envio da lista herda a url do almoxarifado quando o próprio arquivo está corrompido
`odoolista.py` (`destino`)

Herdar `url`/`db`/`login` do `hub-almox.json` é de propósito e está documentado. Mas a
herança também acontece quando o `.hub-odoo.json` existe e está **ilegível** — e aí a lista
sai para o Odoo do almoxarifado por causa de uma vírgula, não por escolha de ninguém. Na
bancada isso significa voltar ao `.182`. A bandeira `arquivoIlegivel` já existe e já é
reportada; falta ela impedir a herança silenciosa.
