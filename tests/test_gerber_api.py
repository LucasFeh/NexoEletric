# -*- coding: utf-8 -*-
"""POST /api/gerber: o Gerber gerado pela vista PCB vai para Projects/<proj>/Gerber/.

    python3 tests/test_gerber_api.py

A rota GRAVA e APAGA arquivos na pasta do projeto, entao tudo roda num workspace de mentira
(H.ROOT trocado por um tempdir, como no test_hubapi.py). O bloco do fim le o X2 e o pacote de
fabricacao REAIS do DMB no Y: (so leitura) quando o disco esta montado, e pula calado quando
nao esta -- nada do cliente entra no repositorio.
"""
import hashlib
import io
import json
import os
import shutil
import sys
import tempfile
from urllib.parse import quote

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except (AttributeError, ValueError):
    pass

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
import hubserver as H  # noqa: E402


def gbr(funcao, marca=''):
    """Um Gerber X2 pequeno, com o CRLF do Altium."""
    linhas = ['G04 EletricHUB teste%s*' % marca, '%FSLAX45Y45*%', '%MOMM*%',
              '%TF.FileFunction,' + funcao + '*%', '%ADD10C,0.25400*%', 'D10*',
              'X100000Y100000D02*', 'X200000Y100000D01*', 'M02*']
    return '\r\n'.join(linhas) + '\r\n'


def md5(b):
    return hashlib.md5(b).hexdigest()


def foto(pasta):
    """caminho relativo -> md5 de tudo debaixo da pasta: prova que nada foi gravado nem apagado."""
    r = {}
    for base, _dirs, arqs in os.walk(pasta):
        for a in arqs:
            p = os.path.join(base, a)
            with open(p, 'rb') as f:
                r[os.path.relpath(p, pasta)] = md5(f.read())
    return r


def posta(cli, proj, arquivos, manifesto=None, **kw):
    corpo = {'proj': proj, 'arquivos': [{'nome': n, 'texto': t} for n, t in arquivos]}
    if manifesto is not None:
        corpo['manifesto'] = manifesto
    return cli.post('/api/gerber', json=corpo, **kw)


def escreve(caminho, texto):
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    with io.open(caminho, 'w', encoding='utf-8', newline='\n') as f:
        f.write(texto)


def manifesto_de(gdir):
    with io.open(os.path.join(gdir, H.GERBER_MANIFESTO), encoding='utf-8') as f:
        return json.load(f)


def arquivos_de(gdir):
    return sorted(os.listdir(gdir))


tmp = tempfile.mkdtemp(prefix='gerber-api-')
real_root, H.ROOT = H.ROOT, tmp
lim_antes = (H.GERBER_MAX_BYTES, H.GERBER_MAX_CORPO)
try:
    # Nome de projeto com espaco, hifen e parenteses, como os de verdade.
    PROJ = 'PTESTE - DI000000_P1 (rev 2)'
    BASE = 'PTESTE - DI000000_P1'
    pdir = os.path.join(tmp, 'Projects', PROJ)
    gdir = os.path.join(pdir, H.GERBER_DIR)
    escreve(os.path.join(pdir, 'board.js'), 'var pcbmirror = {"components":[]};\n')
    escreve(os.path.join(pdir, 'History', 'nota.txt'), 'subpasta que o vigia continua vendo')
    escreve(os.path.join(tmp, 'Projects', 'So Esquema', 'schematic.js'), 'var schematic = {"items":[]};\n')
    # um PROJETO chamado Gerber e projeto como outro qualquer: a poda do vigia e so da subpasta
    escreve(os.path.join(tmp, 'Projects', 'Gerber', 'board.js'), 'var pcbmirror = {};\n')
    cli = H.app.test_client()

    # ── 1. grava: bytes intactos (CRLF e UTF-8), manifesto com md5, nada de .tmp ──────────
    conj1 = [
        (BASE + '_Copper_Signal_Top.gbr', gbr('Copper,L1,Top,Signal', ' MÓDULO')),
        (BASE + '_Copper_Signal_Bot.gbr', gbr('Copper,L2,Bot,Signal')),
        (BASE + '_Profile.gbr', gbr('Profile,NP')),
        (BASE + '_Legend_Top.gto', gbr('Legend,Top')),
    ]
    opcoes = {'nomes': 'altium', 'vazias': True, 'gtoGbo': True, 'x2': True}
    vigia_antes = H._snapshot()
    r = posta(cli, PROJ, conj1, {'base': BASE, 'opcoes': opcoes, 'avisos': ['espelho antigo'],
                                 'arquivos': 'o cliente nao manda nesta chave'})
    assert r.status_code == 200, (r.status_code, r.get_json())
    j = r.get_json()
    assert j['ok'] is True and j['pasta'] == 'Projects/' + PROJ + '/Gerber', j
    for nome, texto in conj1:
        with open(os.path.join(gdir, nome), 'rb') as f:
            bruto = f.read()
        assert bruto == texto.encode('utf-8'), nome + ': o disco nao tem os bytes que a vista mandou'
        assert bruto.count(b'\r\n') == texto.count('\r\n'), nome + ': o CRLF do Gerber nao sobreviveu'
    esperado = [{'nome': n, 'bytes': len(t.encode('utf-8')), 'md5': md5(t.encode('utf-8'))}
                for n, t in conj1]
    man = manifesto_de(gdir)
    assert man['arquivos'] == esperado, 'manifesto errado: %r' % man['arquivos']
    assert man['base'] == BASE and man['opcoes'] == opcoes, man
    assert man['avisos'] == ['espelho antigo'], 'o que a vista mandou alem de base/opcoes se perdeu'
    assert isinstance(man['gerado'], str) and len(man['gerado']) == 19, man['gerado']
    assert j['arquivos'] == esperado and j['removidos'] == [], j
    assert arquivos_de(gdir) == sorted([n for n, _ in conj1] + [H.GERBER_MANIFESTO]), \
        'sobrou lixo na pasta (um .tmp?): %r' % arquivos_de(gdir)
    # a vista consegue ler o manifesto pelo HTTP, como qualquer arquivo do projeto
    r = cli.get('/' + quote('Projects/%s/Gerber/%s' % (PROJ, H.GERBER_MANIFESTO)))
    assert r.status_code == 200 and json.loads(r.data) == man, r.status_code
    print('  ok  grava o conjunto byte a byte, com o manifesto (md5, bytes, base, opcoes)')

    # ── 2. o vigia nao ve a pasta: salvar o Gerber nao recarrega as paginas abertas ────────
    assert H._snapshot() == vigia_antes, \
        'gravar o Gerber mudou o que o vigia ve: recarregaria todas as paginas abertas, ' \
        'inclusive a vista que acabou de gerar'
    chaves = H._snapshot()
    assert os.path.join(pdir, 'board.js') in chaves, 'o vigia deixou de ver o projeto'
    assert os.path.join(pdir, 'History', 'nota.txt') in chaves, 'a poda tem de ser so da Gerber/'
    assert os.path.join(tmp, 'Projects', 'Gerber', 'board.js') in chaves, \
        'um projeto chamado "Gerber" sumiu do vigia'
    assert not [k for k in chaves if k.startswith(gdir + os.sep)], 'o vigia ve a pasta do Gerber'
    print('  ok  o vigia (_snapshot) nao ve Projects/<nome>/Gerber/ e ve o resto')

    # ── 3. nome perigoso: recusado, e o conjunto INTEIRO nao grava ────────────────────────
    antes = foto(tmp)
    bom = (BASE + '_Pads_Top.gbr', gbr('Pads,Top'))
    perigosos = ['../fora.gbr', '..\\fora.gbr', '../../hub.gbr', 'sub/dentro.gbr', 'sub\\dentro.gbr',
                 '/raiz.gbr', 'C:\\raiz.gbr', 'C:raiz.gbr', '.oculto.gbr', '.gbr', '..gbr',
                 'x.gbr::$DATA', 'x.gbr:fluxo', 'CON.gbr', 'nul.txt', 'Com1.drl', 'LPT9 .gbr',
                 'aux.GTL', ' x.gbr', 'x\x00.gbr', 'x\n.gbr', 'x\t.gbr', 'MÓDULO.gbr', 'placa[1].gbr',
                 'a<b.gbr', 'a|b.gbr', 'a*b.gbr', 'a?.gbr', 'a"b.gbr', "a'b.gbr", 'x' * 200 + '.gbr',
                 '', None, 123]
    for ruim in perigosos:
        r = posta(cli, PROJ, [bom, (ruim, gbr('x'))])
        assert r.status_code == 403 and r.get_json()['ok'] is False, (ruim, r.status_code)
        assert foto(tmp) == antes, '%r: nome recusado, e mesmo assim algo foi gravado ou apagado' % (ruim,)
    print('  ok  recusa %d nomes perigosos sem gravar nada' % len(perigosos))

    # ── 4. extensao errada ────────────────────────────────────────────────────────────────
    for ruim in ('x.exe', 'x.html', 'x.js', 'board.js', 'changes.js', 'x.json', H.GERBER_MANIFESTO,
                 'x.gbr.tmp', 'x.gbr.bak', 'x', 'x.zip', 'x.rar', 'x.pdf', 'x.gb', 'x.gbrx'):
        r = posta(cli, PROJ, [(ruim, gbr('x'))])
        assert r.status_code == 403 and 'extensao' in r.get_json()['error'], (ruim, r.get_json())
        assert foto(tmp) == antes, ruim
    # a extensao vale em qualquer caixa (o Protel antigo grava .GTL)
    assert all(H._gerber_nome_ruim(n) == '' for n in ('PLACA.GTL', 'placa.Gbr', 'cam.DRL', 'X.TXT'))
    print('  ok  recusa extensao fora da lista (o gerber.json nao se sobrescreve por ela)')

    # ── 5. projeto inexistente, sem board.js ou com nome que nao e o da pasta ───────────────
    for proj in ('Nao Existe', 'So Esquema', '..', '.', '', None, ['x'], 5, '../' + PROJ, PROJ + '/..',
                 PROJ + '/', 'Projects', 'Projects/' + PROJ, PROJ.upper(), PROJ + ' ', PROJ + '.',
                 '.' + PROJ, tmp, pdir):
        r = posta(cli, proj, [bom])
        assert r.status_code == 404 and r.get_json()['ok'] is False, (proj, r.status_code, r.get_json())
        assert foto(tmp) == antes, proj
    assert 'board.js' in posta(cli, 'So Esquema', [bom]).get_json()['error'], \
        'projeto sem board.js tem de dizer o que falta'
    assert not os.path.exists(os.path.join(tmp, 'Projects', 'So Esquema', H.GERBER_DIR))
    print('  ok  recusa projeto inexistente, sem board.js e nome que nao e exatamente o da pasta')

    # ── 6. corpo malformado ────────────────────────────────────────────────────────────────
    malformados = [
        dict(data='nao e json', content_type='application/json'),
        dict(json=[]),
        dict(json={'proj': PROJ}),
        dict(json={'proj': PROJ, 'arquivos': 'x'}),
        dict(json={'proj': PROJ, 'arquivos': []}),             # conjunto vazio apagaria a pasta
        dict(json={'proj': PROJ, 'arquivos': ['x']}),
        dict(json={'proj': PROJ, 'arquivos': [{'nome': 'a.gbr'}]}),
        dict(json={'proj': PROJ, 'arquivos': [{'nome': 'a.gbr', 'texto': 5}]}),
        dict(json={'proj': PROJ, 'arquivos': [{'nome': 'A.gbr', 'texto': 'x'}, {'nome': 'a.gbr', 'texto': 'y'}]}),
        dict(json={'proj': PROJ, 'arquivos': [{'nome': 'a.gbr', 'texto': 'x\ud800'}]}),
        dict(json={'proj': PROJ, 'arquivos': [{'nome': 'a.gbr', 'texto': 'x'}], 'manifesto': [1]}),
        dict(json={'proj': PROJ, 'arquivos': [{'nome': 'a.gbr', 'texto': 'x'}], 'manifesto': 'x'}),
        dict(json={'proj': PROJ, 'arquivos': [{'nome': 'a.gbr', 'texto': 'x'}],
                   'manifesto': {'avisos': ['x' * (H.GERBER_MAX_MANIFESTO + 1)]}}),
        dict(json={'proj': PROJ, 'arquivos': [{'nome': 'a%d.gbr' % i, 'texto': 'x'}
                                              for i in range(H.GERBER_MAX_ARQUIVOS + 1)]}),
    ]
    for kw in malformados:
        r = cli.post('/api/gerber', **kw)
        assert r.status_code == 400 and r.get_json()['ok'] is False, (str(kw)[:120], r.status_code)
        assert foto(tmp) == antes, str(kw)[:120]
    print('  ok  corpo malformado e 400 sem gravar nada')

    # ── 7. limite de tamanho (com e sem Content-Length) ──────────────────────────────────
    H.GERBER_MAX_BYTES, H.GERBER_MAX_CORPO = 1000, 1000000
    r = posta(cli, PROJ, [('a.gbr', 'x' * 600), ('b.gbr', 'y' * 600)])
    assert r.status_code == 413 and r.get_json()['ok'] is False, 'a soma passou do limite e gravou'
    H.GERBER_MAX_CORPO = 4096
    r = posta(cli, PROJ, [('a.gbr', 'x' * 5000)])
    assert r.status_code == 413 and r.get_json()['ok'] is False, \
        'corpo grande demais tem de virar o JSON de erro do hub, nao a pagina do werkzeug'
    gordo = json.dumps({'proj': PROJ, 'arquivos': [{'nome': 'a.gbr', 'texto': 'x' * 5000}]}).encode()
    r = cli.post('/api/gerber', input_stream=io.BytesIO(gordo), content_type='application/json',
                 environ_overrides={'wsgi.input_terminated': True})       # chunked: sem Content-Length
    assert r.status_code == 413 and r.get_json()['ok'] is False, 'corpo chunked passou do limite'
    H.GERBER_MAX_BYTES, H.GERBER_MAX_CORPO = lim_antes
    assert foto(tmp) == antes
    print('  ok  limite de tamanho: 413 com e sem Content-Length, nada gravado')

    # ── 8. substitui o conjunto: a pasta e o ULTIMO gerado ───────────────────────────────
    escreve(os.path.join(gdir, 'notas.txt'), 'anotacao de alguem: fica')
    escreve(os.path.join(gdir, 'leia-me.md'), 'fica')
    escreve(os.path.join(gdir, 'furos-feitos-a-mao.drl'), 'furacao que nao veio no conjunto: sai')
    escreve(os.path.join(gdir, 'Revisao A', 'velho.gbr'), 'subpasta: ninguem mexe')
    B2 = BASE.lower().replace(' ', '_')             # os nomes da FABRICACAO (CAMtastic)
    conj2 = [
        (B2 + '_copper_signal_top.gbr', gbr('Copper,L1,Top,Signal', ' v2')),
        (B2 + '_legend_top.gbr', gbr('Legend,Top', ' v2')),
        (B2 + '_npth_drill.gbr', gbr('NonPlated,1,2,NPTH,Drill')),
        (BASE + '_Profile.gbr', gbr('Profile,NP', ' v2')),          # mesmo nome: troca no lugar
    ]
    r = posta(cli, PROJ, conj2, {'base': BASE, 'opcoes': {'nomes': 'fabricacao'}})
    assert r.status_code == 200, r.get_json()
    j = r.get_json()
    assert arquivos_de(gdir) == sorted([n for n, _ in conj2] + [H.GERBER_MANIFESTO, 'notas.txt',
                                                                 'leia-me.md', 'Revisao A']), \
        'a pasta nao ficou com o ultimo conjunto: %r' % arquivos_de(gdir)
    assert sorted(j['removidos']) == sorted([BASE + '_Copper_Signal_Top.gbr', BASE + '_Copper_Signal_Bot.gbr',
                                             BASE + '_Legend_Top.gto', 'furos-feitos-a-mao.drl']), \
        j['removidos']
    # a .gto saiu porque o hub a gravou (estava no gerber.json anterior), nao pela extensao
    for nome, texto in conj2:
        with open(os.path.join(gdir, nome), 'rb') as f:
            assert f.read() == texto.encode('utf-8'), nome
    man = manifesto_de(gdir)
    assert [a['nome'] for a in man['arquivos']] == [n for n, _ in conj2], 'manifesto com o conjunto velho'
    assert man['opcoes'] == {'nomes': 'fabricacao'} and 'avisos' not in man, \
        'o manifesto de antes vazou para o novo'
    assert os.path.isfile(os.path.join(gdir, 'Revisao A', 'velho.gbr'))
    print('  ok  substitui o conjunto: sai o que nao veio, ficam anotacao e subpasta')

    # So a caixa muda (A.GBR no lugar de a.gbr): uma entrada so, com a caixa nova -- no Windows
    # o replace troca o nome, no Linux o antigo e sobra e sai.
    novo = B2.upper() + '_COPPER_SIGNAL_TOP.GBR'
    r = posta(cli, PROJ, [(novo, gbr('Copper,L1,Top,Signal', ' v3'))])
    assert r.status_code == 200, r.get_json()
    mesmos = [n for n in os.listdir(gdir) if n.lower() == novo.lower()]
    assert mesmos == [novo], 'trocar so a caixa deixou %r' % mesmos
    assert manifesto_de(gdir)['base'] == '' and manifesto_de(gdir)['opcoes'] == {}, \
        'sem manifesto da vista, base e opcoes ficam vazias'
    assert arquivos_de(gdir) == sorted([novo, H.GERBER_MANIFESTO, 'notas.txt', 'leia-me.md', 'Revisao A'])
    print('  ok  trocar so a caixa do nome deixa uma entrada, com a caixa nova')

    # ── 9. corpo chunked dentro do limite grava normal ───────────────────────────────────
    magro = json.dumps({'proj': PROJ, 'arquivos': [{'nome': novo, 'texto': gbr('Copper,L1,Top,Signal', ' v4')}]})
    r = cli.post('/api/gerber', input_stream=io.BytesIO(magro.encode('utf-8')),
                 content_type='application/json', environ_overrides={'wsgi.input_terminated': True})
    assert r.status_code == 200, r.get_json()
    with open(os.path.join(gdir, novo), 'rb') as f:
        assert b' v4' in f.read()

    # ── 10. symlink (o servidor): grava ATRAVES do link, nunca troca o link por arquivo ─────
    def pode_symlink():
        try:
            a = os.path.join(tmp, '_probe')
            with open(a, 'wb') as f:
                f.write(b'x')
            os.symlink(a, a + '.lnk')
            os.remove(a + '.lnk')
            return True
        except (OSError, NotImplementedError, AttributeError):
            return False

    if pode_symlink():
        # como o deploy monta: release/Projects -> shared/Projects
        shared = os.path.join(tmp, 'shared')
        release = os.path.join(tmp, 'release')
        sgdir = os.path.join(shared, 'Projects', 'Placa Link', H.GERBER_DIR)
        escreve(os.path.join(shared, 'Projects', 'Placa Link', 'board.js'), 'var pcbmirror = {};\n')
        os.makedirs(sgdir)
        os.makedirs(release)
        os.symlink(os.path.join(shared, 'Projects'), os.path.join(release, 'Projects'))
        alvo = os.path.join(tmp, 'fora-da-pasta.gbr')
        escreve(alvo, 'antes')
        os.symlink(alvo, os.path.join(sgdir, 'L_Copper_Signal_Top.gbr'))
        H.ROOT = release
        try:
            r = posta(cli, 'Placa Link', [('L_Copper_Signal_Top.gbr', 'novo'), ('L_Profile.gbr', 'perfil')])
        finally:
            H.ROOT = tmp
        assert r.status_code == 200, r.get_json()
        assert os.path.islink(os.path.join(sgdir, 'L_Copper_Signal_Top.gbr')), \
            'o symlink virou arquivo real (e o que fazia o deploy "voltar tudo")'
        with open(alvo, 'rb') as f:
            assert f.read() == b'novo', 'gravou, mas nao no arquivo apontado pelo link'
        assert os.path.isfile(os.path.join(sgdir, 'L_Profile.gbr')), 'o arquivo novo nao foi para o shared/'
        assert not [n for n in os.listdir(sgdir) if n.endswith('.tmp')], 'sobrou .tmp'
        print('  ok  grava ATRAVES do symlink do deploy')
    else:
        print('  --  este sistema nao deixa criar symlink (Windows sem privilegio): a prova do')
        print('      link fica para o servidor; a varredura do test_symlink_sobrevive cobre a rota.')

    # ── 11. opcional: o X2 e o pacote de fabricacao REAIS do DMB (so leitura, Y:) ─────────
    # Prova que os nomes de verdade (espaco, hifen, maiusculas; e os minusculos do CAMtastic)
    # passam e voltam byte a byte, e que o pacote de fabricacao substitui o X2 por inteiro.
    DMB = ('Y:/EQUIPAMENTOS_REVISADOS/DMB - DI231765 - DISPLAY ASCII PARA MARCAÇÃO DE BOBINAS/'
           'PCB E SCH/PDMB - DI231765_P2 (Microntrolladora)/')
    reais = [DMB + 'Project Outputs for DMB - DI231765_P2', DMB + 'FABRICAÇÃO']
    if all(os.path.isdir(p) for p in reais):
        rdir = os.path.join(tmp, 'Projects', 'DMB - DI231765_P2')
        escreve(os.path.join(rdir, 'board.js'), 'var pcbmirror = {};\n')
        for pasta in reais:
            conj = []
            for n in sorted(os.listdir(pasta)):
                if n.lower().endswith('.gbr'):
                    with open(os.path.join(pasta, n), 'rb') as f:
                        conj.append((n, f.read()))
            r = posta(cli, 'DMB - DI231765_P2', [(n, b.decode('utf-8')) for n, b in conj],
                      {'base': 'PDMB - DI231765_P2'})
            assert r.status_code == 200, (pasta, r.get_json())
            rg = os.path.join(rdir, H.GERBER_DIR)
            assert arquivos_de(rg) == sorted([n for n, _ in conj] + [H.GERBER_MANIFESTO]), arquivos_de(rg)
            for n, b in conj:
                with open(os.path.join(rg, n), 'rb') as f:
                    assert f.read() == b, n + ': o disco nao ficou igual ao do Altium'
            assert [(a['nome'], a['md5']) for a in manifesto_de(rg)['arquivos']] == \
                [(n, md5(b)) for n, b in conj]
        print('  ok  X2 e pacote de fabricacao reais do DMB passam e voltam byte a byte')
finally:
    H.ROOT = real_root
    H.GERBER_MAX_BYTES, H.GERBER_MAX_CORPO = lim_antes
    shutil.rmtree(tmp, ignore_errors=True)

print('test_gerber_api OK')
