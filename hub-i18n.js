/* AltiumPCBMirror v2 - hub-i18n.js
   Idioma da CASCA do hub: cabecalho, barra do projeto, abas, rodape, modal de
   configuracao e dialogos. Os paineis Laser/BOM/Neoden/Biblioteca continuam em pt-BR -
   sao o vocabulario da bancada, com centenas de rotulos que vivem dentro dos .js deles.

   Duas formas de usar:
   - marcacao estatica: data-i18n / data-i18n-title / data-i18n-ph, e HubI18n.apply(doc);
   - texto gerado em JS: HubI18n.t('chave', { n: 3 }).

   Chave sem traducao volta como ela mesma. E de proposito: nomes de comando do Altium
   (ExportLibs, ApplyChanges...) passam por t() sem precisar entrar no dicionario. */
"use strict";
var HubI18n = (function () {

const DICT = {

'pt-BR': {
  /* cabecalho */
  'hdr.search':      'Buscar projeto…',
  'hdr.noProject':   'nenhum projeto',
  'hdr.projects':    '{n} projetos',
  'hdr.demo':        ' (demo)',
  'hdr.noServer':    'sem servidor',
  'brand.menu':      'Menu do hub',
  'pick.noSch':      'sem esquema',
  'pick.stats':      '{c} comps · {n} nets',

  /* barra do projeto */
  'proj.pending':    '{n} mudanças pendentes',
  'proj.runNow':     'Executa agora',
  'proj.manual':     'Passo manual — ver detalhes do fluxo',
  'stage.esquema':   'esquema',
  'stage.eco':       'eco',
  'stage.roteada':   'roteada',
  'stage.aplicada':  'aplicada',
  'step.ask':        'Pedir schematic.js',
  'step.eco':        'Compile + Update PCB',

  /* abas */
  'tab.esquema':     'Esquema',
  'tab.pcb':         'PCB',
  'tab.comp':        'Componentes',
  'tab.nets':        'Nets',
  'tab.fp':          'Footprints',
  'tab.lib':         'Biblioteca',
  'tab.neoden':      'Neoden',
  'tab.laser':       'Laser',
  'tab.bom':         'BOM',
  'tab.hist':        'Histórico',
  /* sub-abas: a fileira de baixo, que diz de que vista da aba de cima se trata */
  'tab.pcb.placa':   'Placa',
  'tab.lib.sch':     'Sch Lib',
  'tab.lib.fp':      'Footprint Lib',
  'tab.lib.sym':     'Símbolos',

  /* biblioteca: acervo (espelho do Altium ou almoxarifado) */
  'lib.acervo':      'acervo',
  'lib.loading':     'carregando a biblioteca…',
  'lib.escolha':     'escolha um item na lista',
  'lib.semEncap':    'nenhum encapsulamento veio do Odoo para esta família — o vínculo com o footprint é manual',
  'lib.almoxIntro':  'Biblioteca gerada a partir do almoxarifado do Odoo. Cada símbolo é uma família (RESISTOR [SMD]) e cada part é um valor, do menor para o maior — trocar de part é trocar de valor, com os mesmos pinos e o mesmo designador. Escolha um símbolo à esquerda para ver os valores e o saldo de cada um.',
  /* sincronizar almoxarifado */
  'alx.sync':        'Sincronizar almoxarifado',
  'alx.syncHint':    'puxa o Odoo, regera as duas bibliotecas e diz o que mudou',
  'alx.explica':     'Compara o que já está na biblioteca com o Odoo e traz <b>só o que mudou</b>: componente novo vira símbolo ou valor novo, e saldo e prateleira são reescritos para todos. O que já está na lib <b>mantém o seu número de part</b> — um esquema que aponta para a parte 47 continua apontando para o mesmo componente. Roda no PC do servidor e grava as <b>.SchLib</b> do Altium junto, em <b>Libs\Almox</b>.',
  'alx.semServidor': 'sem servidor: a sincronização roda no hubserver.py',
  'alx.semScript':   'este workspace não tem tools\almox\almox2lib.py — nada a sincronizar',
  'alx.semSenha':    'sem credenciais do Odoo gravadas: dá para regerar do snapshot, mas não puxar ao vivo',
  'alx.credOk':      'Odoo {url} · base {db} · {login} · senha gravada',
  'alx.credRemota':  'As credenciais do Odoo só podem ser gravadas no PC que roda o hubserver. Daqui dá para sincronizar a partir do snapshot.',
  'alx.credTitulo':  'credenciais do Odoo',
  'alx.cred.url':    'servidor',
  'alx.cred.db':     'base',
  'alx.cred.login':  'usuário',
  'alx.cred.senha':  'senha',
  'alx.credNota':    'Gravadas em <b>hub-almox.json</b>, na raiz do workspace, fora do git. A senha nunca volta pela rede — deixe o campo em branco para manter a que já está lá.',
  'alx.credGravar':  'Gravar credenciais',
  'alx.credOkToast': 'credenciais gravadas',
  'alx.credFalhou':  'não deu para gravar: {e}',
  'alx.jaRodando':   'já tem uma sincronização rodando',
  'alx.fechar':      'Fechar',
  'alx.soRegerar':   'Só regerar do snapshot',
  'alx.puxar':       'Puxar do Odoo e sincronizar',
  /* o mesmo comando, no cabecalho da Biblioteca: cabe curto e ja comeca sozinho */
  'alx.puxarJa':     'Puxar do Odoo',
  'alx.puxarJaHint': 'puxa o Odoo agora e mostra o que mudou',
  'alx.recarregando': 'recarregando a biblioteca…',
  'alx.pronto':      'almoxarifado sincronizado',
  'alx.falhou':      'a sincronização falhou: {e}',
  'alx.semDiff':     'sincronizou, mas Libs\almox-sync.js não veio — sem comparação para mostrar',
  'alx.primeira':    'Primeira geração deste acervo: não havia com o que comparar, então tudo aqui é novo.',
  'alx.semNovidade': 'Nada mudou nesta execução.',
  'alx.marcarVisto': 'marcar como visto',
  'alx.marcarVistoHint': 'zera as marcações de novo neste acervo; vale só nesta máquina',
  'alx.vistoOk':     'novidades marcadas como vistas',
  'alx.acumulado':   'Na biblioteca há {n} novidade(s) que você ainda não marcou como vista(s) — {s} símbolo(s) e {v} valor(es), acumulados desde {d}.',
  'alx.foraDoOdoo':  'Este valor não está mais no almoxarifado do Odoo. A part continua na biblioteca, com saldo zero, para não renumerar as outras — um esquema que aponta para ela continua apontando para o mesmo componente.',
  'lib.almoxNota':   'Saldo do local DI/Almoxarifado no instante do dump do Odoo. Para regerar tudo, inclusive as .SchLib: python tools\almox\almox2lib.py.',
  /* sincronizar almoxarifado: o guardião (o que a regeneração não sobrescreveu) */
  'alx.preservado':  'desenhos que o gerador não repõe: {n}',
  'alx.preservadoHint': 'desenhos feitos no editor de símbolos do hub — nas famílias com modelo da casa o gerador redesenha por cima, e é este registro que devolve o seu desenho depois',
  'alx.orfaos':      '{n} protegido(s) cujo valor saiu do Odoo — ficam no registro, ignorados',
  'alx.recicladoDe': 'reciclado de: {p}',
  'alx.semGuardiao': 'sincronizou, mas Libs\almox-guardiao.js não veio — sem o resumo do guardião',

  'aggr.comps':      'comps',
  'aggr.nets':       'nets',
  'aggr.tracks':     'trilhas',
  'aggr.vias':       'vias',

  /* vistas Esquema / PCB */
  'view.sch':        'vista esquema',
  'view.pcb':        'vista pcb',
  'view.schMeta':    '{s} folha(s) · {c} comps · {n} nets',
  'view.pcbMeta':    '{t} trilhas · {v} vias · 2 layers',
  'view.openTab':    'Abrir em nova aba',
  'view.noSch':      'sem esquema',
  'view.noRoute':    'sem roteamento',
  'view.noSchMsg':   'Este projeto ainda não tem schematic.js. Peça à IA para gerá-lo e ele aparece aqui.',
  'view.noRouteMsg': 'A placa ainda não foi roteada. Rode ExportBoard e a IA escreve changes.js.',

  /* rodape do fluxo */
  'flow.label':      'fluxo',
  'flow.details':    'Ver detalhes',
  'flow.title':      'Fluxo de um projeto novo',
  'flow.l1':         'Pedir schematic.js',
  'flow.l2':         'Conferir no Esquema',
  'flow.l4':         'Compile + Update PCB',
  'flow.h1':         'Peça à IA — ela cria Projects\\<nome>\\schematic.js.',
  'flow.h2':         'Revise a vista Esquema aqui no hub.',
  'flow.h3':         'No Altium: crie um .PrjPcb com o mesmo nome e rode BuildSchematic.',
  'flow.h4':         'Design » Update PCB (ECO) para levar o esquema à placa.',
  'flow.h5':         'A IA roteia em changes.js; confira na vista PCB.',
  'flow.h6':         'Aplique as mudanças e rode o DRC.',

  /* acoes (o comando real, mostrado embaixo do rotulo) */
  'act.BuildSchematic': 'no Altium: DXP » Run Script » BuildSchematic',
  'act.ExportBoard':    'no Altium: DXP » Run Script » ExportPcb',
  'act.ApplyChanges':   'no Altium: DXP » Run Script » ApplyProject',
  'act.DRC':            'no Altium: Tools » Design Rule Check',
  'act.Rescan':         'reindexa Projects\\ agora (servidor)',
  'run.running':     '{a} em execução…',
  'run.done':        '{a} concluído',
  'run.fail':        '{a} falhou: {e}',
  'run.noServer':    'sem servidor — rode python hubserver.py',

  /* ── modal de configuração ── */
  'cfg.title':       'Configurações',
  'cfg.menuHint':    'projeto, layout e ações',
  'cfg.close':       'Fechar',
  'cfg.tab.proj':    'Projeto',
  'cfg.tab.layout':  'Layout',
  'cfg.tab.atalhos': 'Atalhos',
  'cfg.tab.acoes':   'Ações',

  /* projeto */
  'cfg.proj.now':    'projeto aberto',
  'cfg.proj.lib':    'biblioteca da aba Biblioteca',
  'cfg.proj.libSel': 'acervo',
  'cfg.proj.libHint': 'qual acervo a aba <b>Biblioteca</b> abre: o espelho da SchLib/PcbLib reais da casa ou uma das bibliotecas do <b>almoxarifado</b>, montadas a partir do Odoo. A escolha é desta máquina e vale para todos os projetos — o combobox no alto da aba faz a mesma troca.',
  'cfg.proj.libGer': 'almoxarifado gerado em {d} · {n} de {t} itens do Odoo viraram componente de PCB.',
  'cfg.proj.bomDir': 'pasta padrão do BOM',
  'cfg.proj.browse': 'Selecionar…',
  'cfg.proj.save':   'Gravar pasta',
  'cfg.proj.bomHint': 'para onde o botão "Salvar na pasta padrão" da aba BOM escreve. É o disco do <b>servidor</b>: acessando o hub de outro PC da rede, o arquivo é salvo lá, não aqui — de outra máquina, use <b>Baixar</b>.',
  'cfg.proj.browseHint': '"Selecionar…" abre o diálogo de pastas do Windows <b>no PC que roda o hubserver</b> — e ele às vezes abre <b>atrás do navegador</b>, então olhe a barra de tarefas. De outra máquina da rede, digite o caminho à mão.',
  'cfg.proj.browseRemote': 'o diálogo de pastas só abre no PC do servidor — digite o caminho',
  'cfg.proj.browsing': 'abrindo…',
  'cfg.proj.browseFail': 'não deu para abrir o diálogo de pastas: {e}',
  'cfg.proj.browseOld': 'rota /api/pick-dir não existe neste servidor — reinicie o hubserver.py',
  'cfg.proj.browseNone': 'nenhuma pasta escolhida',
  'cfg.proj.risk':   'excluir',
  'cfg.delete':      'Excluir projeto…',
  'cfg.deleteHint':  'a pasta sai de Projects\\ e vai inteira para Trash\\, no mesmo workspace. Pede a senha mestre.',
  'cfg.deleteNoSrv': 'sem servidor: a exclusão precisa do hubserver.py rodando.',

  /* layout */
  'cfg.lay.color':   'Cor',
  'cfg.lay.colorHint': 'Automático segue o tema do sistema operacional, e acompanha se ele mudar com o hub aberto.',
  'cfg.dark':        'Escuro',
  'cfg.light':       'Claro',
  'cfg.auto':        'Automático',
  'cfg.lay.theme':   'Tema',
  'cfg.lay.themeHint': 'as vistas Esquema e PCB continuam escuras: é a cor de trabalho do Altium, e elas têm folha de estilo própria.',
  'theme.grafite':   'Grafite',
  'theme.papel':     'Papel',
  'theme.altium':    'Altium',
  'theme.placa':     'Placa',
  'cfg.lay.lang':    'Linguagem',
  'cfg.lay.langHint': 'traduz a casca do hub — cabeçalho, barra do projeto, abas, fluxo e diálogos. Os painéis Laser, BOM e Neoden seguem em português.',
  'cfg.lay.font':    'Fonte',
  'cfg.lay.fontHint': 'muda só o texto da interface. O monoespaçado (caminhos, designadores), as vistas Esquema e PCB, a prévia do BOM e o texto desenhado na placa têm tipografia própria.',
  'font.inter':      'Inter',
  'font.sistema':    'Do sistema',
  'font.bancada':    'Bancada',
  'font.mono':       'Monoespaçada',

  /* ações */
  'cfg.act.hint':    'Só o <b>Rescan</b> roda daqui, no servidor. Os outros são passos manuais dentro do Altium — o hub mostra o caminho do menu, nunca finge executá-lo.',
  'cfg.act.run':     'Executar',

  /* excluir projeto */
  'del.title':       'Excluir projeto',
  'del.what':        'A pasta sai de Projects\\ e vai para Trash\\<nome>-<data>, no mesmo workspace. O projeto some do hub na hora; para desfazer, mova a pasta de volta à mão.',
  'del.pwd':         'senha mestre',
  'del.cancel':      'Cancelar',
  'del.ok':          'Excluir',
  'del.needPwd':     'informe a senha mestre',
  'del.wrong':       'senha mestre incorreta',
  'del.done':        '{name} foi para {path}',
  'del.fail':        'não deu para excluir: {e}',

  /* boot / carga */
  'boot.zero':       '0 projetos',
  'boot.noProjTag':  'sem projetos',
  'boot.noProjMsg':  'Nenhum projeto em Projects\\ — rode ExportProject ou ExportBoard no Altium e clique em Reindexar.',
  'load.failDetail': 'detalhe do projeto indisponível — tente Reindexar',
  'load.empty':      'nenhum projeto encontrado em Projects\\',
},

'en': {
  'hdr.search':      'Search project…',
  'hdr.noProject':   'no project',
  'hdr.projects':    '{n} projects',
  'hdr.demo':        ' (demo)',
  'hdr.noServer':    'no server',
  'brand.menu':      'Hub menu',
  'pick.noSch':      'no schematic',
  'pick.stats':      '{c} comps · {n} nets',

  'proj.pending':    '{n} pending changes',
  'proj.runNow':     'Runs now',
  'proj.manual':     'Manual step — see the flow details',
  'stage.esquema':   'schematic',
  'stage.eco':       'eco',
  'stage.roteada':   'routed',
  'stage.aplicada':  'applied',
  'step.ask':        'Ask for schematic.js',
  'step.eco':        'Compile + Update PCB',

  'tab.esquema':     'Schematic',
  'tab.pcb':         'PCB',
  'tab.comp':        'Components',
  'tab.nets':        'Nets',
  'tab.fp':          'Footprints',
  'tab.lib':         'Library',
  'tab.neoden':      'Neoden',
  'tab.laser':       'Laser',
  'tab.bom':         'BOM',
  'tab.hist':        'History',
  'tab.pcb.placa':   'Board',
  'tab.lib.sch':     'Sch Lib',
  'tab.lib.fp':      'Footprint Lib',
  'tab.lib.sym':     'Symbols',

  'lib.acervo':      'source',
  'lib.loading':     'loading the library…',
  'lib.escolha':     'pick an item from the list',
  'lib.semEncap':    'Odoo gave no package for this family — the footprint link is manual',
  'lib.almoxIntro':  'Library generated from the Odoo stockroom. Each symbol is a family (RESISTOR [SMD]) and each part is a value, smallest first — switching part switches value, with the same pins and designator. Pick a symbol on the left to see its values and stock.',
  'alx.sync':        'Sync stockroom',
  'alx.syncHint':    'pulls Odoo, rebuilds both libraries and reports what changed',
  'alx.explica':     'Compares what is already in the library against Odoo and brings in <b>only what changed</b>: a new component becomes a new symbol or value, and stock and bin location are rewritten for everything. What is already in the library <b>keeps its part number</b> — a schematic pointing at part 47 still points at the same component. It runs on the server PC and writes the Altium <b>.SchLib</b> files alongside, under <b>Libs\Almox</b>.',
  'alx.semServidor': 'no server: syncing runs in hubserver.py',
  'alx.semScript':   'this workspace has no tools\almox\almox2lib.py — nothing to sync',
  'alx.semSenha':    'no Odoo credentials stored: you can rebuild from the snapshot, but not pull live',
  'alx.credOk':      'Odoo {url} · database {db} · {login} · password stored',
  'alx.credRemota':  'Odoo credentials can only be stored on the machine running hubserver. From here you can still sync from the snapshot.',
  'alx.credTitulo':  'Odoo credentials',
  'alx.cred.url':    'server',
  'alx.cred.db':     'database',
  'alx.cred.login':  'user',
  'alx.cred.senha':  'password',
  'alx.credNota':    'Stored in <b>hub-almox.json</b> at the workspace root, outside git. The password never travels back — leave the field empty to keep the stored one.',
  'alx.credGravar':  'Save credentials',
  'alx.credOkToast': 'credentials saved',
  'alx.credFalhou':  'could not save: {e}',
  'alx.jaRodando':   'a sync is already running',
  'alx.fechar':      'Close',
  'alx.soRegerar':   'Rebuild from snapshot only',
  'alx.puxar':       'Pull from Odoo and sync',
  'alx.puxarJa':     'Pull from Odoo',
  'alx.puxarJaHint': 'pulls Odoo now and shows what changed',
  'alx.recarregando': 'reloading the library…',
  'alx.pronto':      'stockroom synced',
  'alx.falhou':      'sync failed: {e}',
  'alx.semDiff':     'synced, but Libs\almox-sync.js did not arrive — no comparison to show',
  'alx.primeira':    'First build of this source: there was nothing to compare against, so everything here is new.',
  'alx.semNovidade': 'Nothing changed in this run.',
  'alx.marcarVisto': 'mark as seen',
  'alx.marcarVistoHint': 'clears the new markers for this source; local to this machine',
  'alx.vistoOk':     'novelties marked as seen',
  'alx.acumulado':   'The library holds {n} item(s) you have not marked as seen — {s} symbol(s) and {v} value(s), accumulated since {d}.',
  'alx.foraDoOdoo':  'This value is no longer in the Odoo stockroom. The part stays in the library with zero stock so the others are not renumbered — a schematic pointing at it still points at the same component.',
  'lib.almoxNota':   'Stock at DI/Almoxarifado as of the Odoo dump. Regenerate everything, .SchLib included, with: python tools\almox\almox2lib.py.',
  'alx.preservado':  'drawings the generator will not redraw: {n}',
  'alx.preservadoHint': 'drawings made in the hub symbol editor — in families with a house model the generator redraws over them, and this ledger is what puts yours back afterwards',
  'alx.orfaos':      '{n} protected item(s) whose value left Odoo — kept in the ledger, ignored',
  'alx.recicladoDe': 'recycled from: {p}',
  'alx.semGuardiao': 'synced, but Libs\almox-guardiao.js did not arrive — no guardian summary',

  'aggr.comps':      'comps',
  'aggr.nets':       'nets',
  'aggr.tracks':     'tracks',
  'aggr.vias':       'vias',

  'view.sch':        'schematic view',
  'view.pcb':        'pcb view',
  'view.schMeta':    '{s} sheet(s) · {c} comps · {n} nets',
  'view.pcbMeta':    '{t} tracks · {v} vias · 2 layers',
  'view.openTab':    'Open in a new tab',
  'view.noSch':      'no schematic',
  'view.noRoute':    'not routed',
  'view.noSchMsg':   'This project has no schematic.js yet. Ask the AI to generate it and it shows up here.',
  'view.noRouteMsg': 'The board is not routed yet. Run ExportBoard and the AI writes changes.js.',

  'flow.label':      'flow',
  'flow.details':    'See details',
  'flow.title':      'Flow of a new project',
  'flow.l1':         'Ask for schematic.js',
  'flow.l2':         'Check the Schematic view',
  'flow.l4':         'Compile + Update PCB',
  'flow.h1':         'Ask the AI — it creates Projects\\<name>\\schematic.js.',
  'flow.h2':         'Review the Schematic view here in the hub.',
  'flow.h3':         'In Altium: create a .PrjPcb with the same name and run BuildSchematic.',
  'flow.h4':         'Design » Update PCB (ECO) to carry the schematic to the board.',
  'flow.h5':         'The AI routes in changes.js; check it in the PCB view.',
  'flow.h6':         'Apply the changes and run the DRC.',
  'act.BuildSchematic': 'in Altium: DXP » Run Script » BuildSchematic',
  'act.ExportBoard':    'in Altium: DXP » Run Script » ExportPcb',
  'act.ApplyChanges':   'in Altium: DXP » Run Script » ApplyProject',
  'act.DRC':            'in Altium: Tools » Design Rule Check',
  'act.Rescan':         'reindexes Projects\\ now (server)',
  'run.running':     '{a} running…',
  'run.done':        '{a} finished',
  'run.fail':        '{a} failed: {e}',
  'run.noServer':    'no server — run python hubserver.py',

  'cfg.title':       'Settings',
  'cfg.menuHint':    'project, layout and actions',
  'cfg.close':       'Close',
  'cfg.tab.proj':    'Project',
  'cfg.tab.layout':  'Layout',
  'cfg.tab.atalhos': 'Shortcuts',
  'cfg.tab.acoes':   'Actions',

  'cfg.proj.now':    'open project',
  'cfg.proj.lib':    'library shown in the Library tab',
  'cfg.proj.libSel': 'source',
  'cfg.proj.libHint': 'which source the <b>Library</b> tab opens: the mirror of the real SchLib/PcbLib or one of the <b>stockroom</b> libraries built from Odoo. The choice belongs to this machine and applies to every project — the combo box at the top of the tab makes the same switch.',
  'cfg.proj.libGer': 'stockroom built on {d} · {n} of {t} Odoo items became PCB components.',
  'cfg.proj.bomDir': 'default BOM folder',
  'cfg.proj.browse': 'Browse…',
  'cfg.proj.save':   'Save folder',
  'cfg.proj.bomHint': 'where the BOM tab’s "Save to the default folder" button writes. It is the <b>server</b> disk: reaching the hub from another PC on the network, the file is saved there, not here — from another machine, use <b>Download</b>.',
  'cfg.proj.browseHint': '"Browse…" opens the Windows folder dialog <b>on the PC running hubserver</b> — and it sometimes opens <b>behind the browser</b>, so check the taskbar. From another machine on the network, type the path by hand.',
  'cfg.proj.browseRemote': 'the folder dialog only opens on the server PC — type the path',
  'cfg.proj.browsing': 'opening…',
  'cfg.proj.browseFail': 'could not open the folder dialog: {e}',
  'cfg.proj.browseOld': 'no /api/pick-dir route on this server — restart hubserver.py',
  'cfg.proj.browseNone': 'no folder chosen',
  'cfg.proj.risk':   'delete',
  'cfg.delete':      'Delete project…',
  'cfg.deleteHint':  'the folder leaves Projects\\ and goes whole to Trash\\, in the same workspace. Asks for the master password.',
  'cfg.deleteNoSrv': 'no server: deleting needs hubserver.py running.',

  'cfg.lay.color':   'Colour',
  'cfg.lay.colorHint': 'Automatic follows the operating system theme, and keeps up if it changes with the hub open.',
  'cfg.dark':        'Dark',
  'cfg.light':       'Light',
  'cfg.auto':        'Automatic',
  'cfg.lay.theme':   'Theme',
  'cfg.lay.themeHint': 'the Schematic and PCB views stay dark: that is the Altium working colour, and they carry their own stylesheet.',
  'theme.grafite':   'Graphite',
  'theme.papel':     'Paper',
  'theme.altium':    'Altium',
  'theme.placa':     'Board',
  'cfg.lay.lang':    'Language',
  'cfg.lay.langHint': 'translates the hub shell — header, project bar, tabs, flow and dialogs. The Laser, BOM and Neoden panels stay in Portuguese.',
  'cfg.lay.font':    'Font',
  'cfg.lay.fontHint': 'changes the interface text only. Monospaced text (paths, designators), the Schematic and PCB views, the BOM preview and the text drawn on the board keep their own typeface.',
  'font.inter':      'Inter',
  'font.sistema':    'System',
  'font.bancada':    'Bench',
  'font.mono':       'Monospaced',

  'cfg.act.hint':    'Only <b>Rescan</b> runs from here, on the server. The others are manual steps inside Altium — the hub shows the menu path, it never pretends to run them.',
  'cfg.act.run':     'Run',

  'del.title':       'Delete project',
  'del.what':        'The folder leaves Projects\\ and goes to Trash\\<name>-<date>, in the same workspace. The project disappears from the hub right away; to undo it, move the folder back by hand.',
  'del.pwd':         'master password',
  'del.cancel':      'Cancel',
  'del.ok':          'Delete',
  'del.needPwd':     'enter the master password',
  'del.wrong':       'wrong master password',
  'del.done':        '{name} moved to {path}',
  'del.fail':        'could not delete: {e}',

  'boot.zero':       '0 projects',
  'boot.noProjTag':  'no projects',
  'boot.noProjMsg':  'No project in Projects\\ — run ExportProject or ExportBoard in Altium and click Rescan.',
  'load.failDetail': 'project detail unavailable — try Rescan',
  'load.empty':      'no project found in Projects\\',
},

};

const LANGS = [
  { id: 'pt-BR', label: 'Português' },
  { id: 'en',    label: 'English' },
];
const FALLBACK = 'pt-BR';
const KEY = 'altiumhub.lang';

let lang = FALLBACK;

/* Idioma guardado; sem nada guardado, o do browser - mas so entre os que existem. */
function stored() {
  let v = null;
  try { v = localStorage.getItem(KEY); } catch (e) {}
  if (v && DICT[v]) return v;
  const nav = (navigator.language || '').toLowerCase();
  if (nav.startsWith('pt')) return 'pt-BR';
  if (nav.startsWith('en')) return 'en';
  return FALLBACK;
}

function t(key, vars) {
  const s = (DICT[lang] && DICT[lang][key]) || DICT[FALLBACK][key] || key;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/* Marcacao estatica. Roda de novo a cada troca de idioma - por isso le sempre do
   atributo, nunca do texto que ja esta la. */
function apply(root) {
  const d = root || document;
  d.querySelectorAll('[data-i18n]').forEach(n => { n.textContent = t(n.dataset.i18n); });
  d.querySelectorAll('[data-i18n-title]').forEach(n => { n.title = t(n.dataset.i18nTitle); });
  d.querySelectorAll('[data-i18n-ph]').forEach(n => { n.placeholder = t(n.dataset.i18nPh); });
  document.documentElement.lang = lang;
}

function set(v) {
  if (!DICT[v]) return lang;
  lang = v;
  try { localStorage.setItem(KEY, v); } catch (e) {}
  apply(document);
  return lang;
}

lang = stored();

return { t, set, apply, langs: LANGS, get lang() { return lang; } };

})();
