# -*- coding: utf-8 -*-
"""O patch de símbolo na .SchLib, provado em CÓPIA da biblioteca real.

    python tests/test_schlib_patch.py [caminho.SchLib]

Copia a lib local (D:) para um tmp e prova, nessa ordem:
  (1) regravar `RES [ SMD ]` com a geometria que o leitor acabou de ler devolve o mesmo
      símbolo; TODOS os outros streams saem byte a byte iguais; o FileHeader não muda.
  (2) geometria alterada (retângulo maior + um pino) num componente com PinFrac: a
      releitura reflete, AllPinCount acompanha, o PinFrac some SÓ dele.
  (3) componente cujo storage não é o LibReference (nome > 31 chars, via SectionKeys).
  (4) nome inexistente é erro claro.
  (5) o backup existe e é idêntico ao original.
  (6) desmonta+monta fecha em todos os streams e `tests/test_schlib_bin.py` passa no
      arquivo patchado.
Mais: rótulos mantêm fonte (negrito/rotacionada), cor (inclusive a ausência dela),
Justification e IsMirrored — e um rótulo movido mantém a fonte pelo texto; rótulo novo
só ganha fonte nova quando o tamanho não existe liso nem em negrito (fonte rotacionada
não serve); partes 1,3 sem a 2 são recusadas antes de escrever; multi-part (LM324) volta
igual; tirar partes atualiza PartCount no FileHeader; rótulo com tamanho que não existe
cria fonte; a lib aberta por outro processo dá LibOcupada. Sem a cópia local em D:, PULA.
"""
import copy
import io
import os
import shutil
import subprocess
import sys
import tempfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'almox'))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'symbols'))

import schlib_bin as SB          # noqa: E402
import sch_leitor as L           # noqa: E402
import schlib_patch as P         # noqa: E402

LOCAL = r'D:\ALTIUM LIBRARY ------ LUCAS\BIBLIOTECA DE ESQUEMA.SchLib'
LONGO = 'DIODO [ SUPRESSOR DE TRANSIENTE BIDIRECIONAL ] PTH'


def streams(caminho):
    """{caminho/do/stream: bytes} pelo olefile (a implementação independente)"""
    import olefile
    o = olefile.OleFileIO(caminho)
    try:
        return {'/'.join(p): o.openstream('/'.join(p)).read() for p in o.listdir()}
    finally:
        o.close()


def cab_de(caminho):
    return SB.le_texto(SB.desmonta(streams(caminho)['FileHeader'])[0][1])


def simbolo(caminho, nome):
    for s in L.le_schlib(caminho)['symbols']:
        if s['name'] == nome:
            return s
    raise AssertionError('%s não está na lib' % nome)


def indice_igual(a, b):
    """Weight e o índice LibRef/CompDescr do FileHeader não podem mudar"""
    assert a.get('Weight') == b.get('Weight'), 'Weight mudou: %s -> %s' % (a.get('Weight'), b.get('Weight'))
    for k in set(a) | set(b):
        if k.startswith(('LibRef', 'CompDescr')):
            assert a.get(k) == b.get(k), '%s mudou: %r -> %r' % (k, a.get(k), b.get(k))


def outros_iguais(antes, depois, editados):
    """tudo que não é do componente editado sai byte a byte igual"""
    pastas = set(editados)
    assert {s.split('/')[0] for s in antes} == {s.split('/')[0] for s in depois}, 'lista de storages mudou'
    for k in set(antes) | set(depois):
        if k.split('/')[0] in pastas or k == 'FileHeader':
            continue
        assert k in antes and k in depois, 'stream %s sumiu/apareceu' % k
        assert antes[k] == depois[k], 'stream %s mudou' % k


def registro1(caminho, storage):
    return SB.le_texto(SB.desmonta(streams(caminho)[storage + '/Data'])[0][1])


def main(origem=None):
    origem = origem or LOCAL
    try:
        import olefile  # noqa: F401
    except ImportError:
        print('test_schlib_patch PULADO (olefile nao instalado)')
        return 0
    if not os.path.exists(origem):
        print('test_schlib_patch PULADO (nao alcancei %s)' % origem)
        return 0

    tmp = tempfile.mkdtemp(prefix='schlib_patch_')
    lib = os.path.join(tmp, 'BIBLIOTECA DE ESQUEMA.SchLib')
    shutil.copy2(origem, lib)
    original = open(lib, 'rb').read()
    bk_dir = os.path.join(tmp, 'bk')
    try:
        antes = streams(lib)
        cab0 = cab_de(lib)

        # ── (1) round-trip exato do RES [ SMD ] ─────────────────────────────
        res = simbolo(lib, 'RES [ SMD ]')
        st = P.acha(P.carrega(lib), 'RES [ SMD ]')
        assert st == 'RES [ SMD ]', st
        r = P.patch(lib, copy.deepcopy(res), bk_dir)
        assert r['verificado'] and r['backup'] and r['storage'] == st, r
        depois = streams(lib)
        outros_iguais(antes, depois, [st])
        assert depois['FileHeader'] == antes['FileHeader'], 'FileHeader mudou sem motivo'
        relido = simbolo(lib, 'RES [ SMD ]')
        assert not P.compara(P.esperado(res), relido['parts']), P.compara(P.esperado(res), relido['parts'])
        assert relido['footprints'] == res['footprints'], 'footprints mudaram'
        assert relido['description'] == res['description']
        # os registros que não são desenho ficaram, na ordem, e o bloco de modelos aponta certo
        regs = SB.desmonta(depois[st + '/Data'])
        recs = [SB.le_texto(pl).get('RECORD') if t == SB.TEXTO else 'P' for t, pl in regs]
        assert recs.count('41') == 7 and recs.count('34') == 1 and recs.count('45') == 3, recs
        for j, (t, pl) in enumerate(regs):
            if t != SB.TEXTO:
                continue
            d = SB.le_texto(pl)
            if d.get('RECORD') == '45':
                assert SB.le_texto(regs[int(d['OwnerIndex'])][1]).get('RECORD') == '44', d
            if d.get('RECORD') in ('46', '48'):
                assert SB.le_texto(regs[int(d['OwnerIndex'])][1]).get('RECORD') == '45', d
        # pino regravado: bits altos do conglomerado preservados (o RES esconde nome e número)
        pinos = [SB.le_pino(pl) for t, pl in regs if t == SB.BINARIO]
        assert [p['conglomerado'] for p in pinos] == [32, 34], [p['conglomerado'] for p in pinos]
        # (5) backup idêntico ao original
        assert open(r['backup'], 'rb').read() == original, 'backup difere do original'
        assert os.path.dirname(r['backup']) == bk_dir
        print('  (1) RES [ SMD ] regravado igual; %d outros streams intactos; backup ok' % (len(antes) - 1))

        # ── (2) geometria alterada num componente com PinFrac ───────────────
        com_frac = sorted(k.split('/')[0] for k in antes if k.endswith('/PinFrac'))
        assert com_frac, 'a lib de teste não tem PinFrac'
        alvo = None
        for stf in com_frac:
            nome = SB.le_texto(SB.desmonta(antes[stf + '/Data'])[0][1])['LibReference']
            s = simbolo(lib, nome)
            if s['partcount'] == 1 and any(g['g'] == 'rect' for g in s['parts'][0]['graphics']):
                alvo, stf_alvo = s, stf
                break
        assert alvo, 'nenhum componente de 1 parte com PinFrac e retângulo'
        novo = copy.deepcopy(alvo)
        p0 = novo['parts'][0]
        rect = next(g for g in p0['graphics'] if g['g'] == 'rect')
        rect['x1'], rect['y1'], rect['x2'], rect['y2'] = -400, -400, 400, 400.5     # fração
        p0['pins'].append({'num': 'X99', 'name': 'N̅O̅V̅O̅', 'x': 400, 'y': 5, 'len': 200, 'orient': 0, 'type': 'Power'})
        p0['graphics'].append({'g': 'label', 'x': 12.5, 'y': -7, 'text': 'teste|13pt', 'rot': 90, 'size': 13})
        assert 13 not in L.le_fontes(cab0).values(), 'o teste da fonte nova precisa de um tamanho que não existe'
        antes2 = streams(lib)
        r = P.patch(lib, novo, bk_dir)
        assert r['verificado'], r
        depois2 = streams(lib)
        outros_iguais(antes2, depois2, [stf_alvo])
        assert (stf_alvo + '/PinFrac') not in depois2, 'PinFrac do componente editado ficou'
        assert (stf_alvo + '/PinTextData') not in depois2
        assert stf_alvo + '/Data' in depois2
        for stf in com_frac:
            if stf != stf_alvo:
                assert depois2[stf + '/PinFrac'] == antes2[stf + '/PinFrac'], 'PinFrac de %s mudou' % stf
        relido = simbolo(lib, alvo['name'])
        difs = P.compara(P.esperado(novo), relido['parts'])
        assert not difs, difs
        pr = relido['parts'][0]
        assert pr['pins'][-1]['name'] == 'N̅O̅V̅O̅' and pr['pins'][-1]['type'] == 'Power', pr['pins'][-1]
        assert all(p['x'] % 10 == 0 and p['y'] % 10 == 0 for p in pr['pins']), 'pino fora de 10 mil'
        rr = next(g for g in pr['graphics'] if g['g'] == 'rect')
        assert rr['y2'] == 400.5, rr
        lab = next(g for g in pr['graphics'] if g['g'] == 'label')
        assert lab['size'] == 13 and lab['rot'] == 90 and lab['text'] == 'teste/13pt', lab
        h = registro1(lib, stf_alvo)
        assert int(h['AllPinCount']) == len(p0['pins']), h['AllPinCount']
        assert int(h['PartCount']) == 2
        cab2 = cab_de(lib)
        indice_igual(cab0, cab2)
        assert int(cab2['FontIdCount']) == int(cab0['FontIdCount']) + 1, cab2['FontIdCount']
        assert cab2['Size%s' % cab2['FontIdCount']] == '13'
        assert any('arredondado' in a for a in r['avisos']), r['avisos']       # os pinos com fração
        print('  (2) %s: rect com fração, pino novo, rótulo 13pt (fonte %s criada); PinFrac só dele sumiu'
              % (alvo['name'], cab2['FontIdCount']))

        # ── (3) nome > 31 chars: o storage é outro, achado pelo Data ────────
        longo = simbolo(lib, LONGO)
        st3 = P.acha(P.carrega(lib), LONGO)
        assert st3 == 'DIODO [ SUPRESSOR DE TRANSIENTE', st3
        antes3 = streams(lib)
        r = P.patch(lib, copy.deepcopy(longo), bk_dir)
        assert r['verificado'] and r['storage'] == st3
        depois3 = streams(lib)
        outros_iguais(antes3, depois3, [st3])
        assert not P.compara(P.esperado(longo), simbolo(lib, LONGO)['parts'])
        assert registro1(lib, st3)['LibReference'] == LONGO
        print('  (3) %s -> storage "%s"' % (LONGO, st3))

        # ── (4) nome inexistente ────────────────────────────────────────────
        try:
            P.patch(lib, {'name': 'NAO EXISTE', 'parts': [{'part': 1, 'pins': [], 'graphics': []}]}, bk_dir)
            raise AssertionError('patch de nome inexistente passou')
        except ValueError as e:
            assert 'NAO EXISTE' in str(e), e
        assert streams(lib) == depois3, 'o erro escreveu no arquivo'
        print('  (4) nome inexistente: %s' % 'erro claro, arquivo intacto')

        # ── rótulos: o que o hub não representa sobrevive à regravação ──────
        CHAVES = ('Text', 'FontID', 'Justification', 'IsMirrored', 'Color', 'Orientation')

        def rotulos(st_):
            regs_ = SB.desmonta(streams(lib)[st_ + '/Data'])
            return sorted(tuple(SB.le_texto(pl).get(k) for k in CHAVES)
                          for t, pl in regs_ if t == SB.TEXTO and SB.le_texto(pl).get('RECORD') == '4')
        cab_r = cab_de(lib)
        provados, todos = [], []
        for nome in ('Trafo 3E', 'AMPERIMETRO 0-25A', 'SCR-SKKT 42B16E', 'TL082', 'ADIS ADAPT'):
            try:
                s = simbolo(lib, nome)
            except AssertionError:
                continue
            st_ = P.acha(P.carrega(lib), nome)
            antes_r = rotulos(st_)
            assert antes_r, nome
            r = P.patch(lib, copy.deepcopy(s), bk_dir)
            assert r['verificado'], r
            assert rotulos(st_) == antes_r, (nome, rotulos(st_), antes_r)
            provados.append(nome)
            todos += antes_r
        assert len(provados) >= 3, provados
        assert cab_de(lib)['FontIdCount'] == cab_r['FontIdCount'], 'regravar rótulos criou fonte'
        # e a amostra tinha mesmo o que interessa: justificação, espelho, cor ausente,
        # fonte rotacionada e fonte em negrito
        assert any(t[2] for t in todos) and any(t[3] for t in todos) and any(t[4] is None for t in todos), todos
        assert any(('Rotation%s' % t[1]) in cab_r for t in todos), 'nenhum rótulo com fonte rotacionada'
        assert any(('Bold%s' % t[1]) in cab_r for t in todos), 'nenhum rótulo em negrito'
        # rótulo movido: casa pelo texto e mantém a fonte (o 'A' do amperímetro é negrito 24pt)
        if 'AMPERIMETRO 0-25A' in provados:
            amp = simbolo(lib, 'AMPERIMETRO 0-25A')
            st_a = P.acha(P.carrega(lib), 'AMPERIMETRO 0-25A')
            fid_a = next(t[1] for t in rotulos(st_a) if t[0] == 'A')
            assert ('Bold%s' % fid_a) in cab_r, fid_a
            mov = copy.deepcopy(amp)
            lab_a = next(g for g in mov['parts'][0]['graphics'] if g['g'] == 'label' and g['text'] == 'A')
            lab_a['x'] += 10
            P.patch(lib, mov, bk_dir)
            assert next(t[1] for t in rotulos(st_a) if t[0] == 'A') == fid_a, rotulos(st_a)
            relido_a = next(g for g in simbolo(lib, 'AMPERIMETRO 0-25A')['parts'][0]['graphics']
                            if g['g'] == 'label' and g['text'] == 'A')
            assert relido_a['x'] == lab_a['x'], relido_a
        print('  rótulos de %s: fonte/cor/justificação/espelho iguais; rótulo movido mantém a fonte' % ', '.join(provados))

        # ── rótulo NOVO: fonte lisa > negrito > criar; rotacionada nunca ─────
        por_tam = {}
        for k in range(1, int(cab_r['FontIdCount']) + 1):
            por_tam.setdefault(int(cab_r['Size%d' % k]), []).append(k)
        so_rot = next((s for s, ks in sorted(por_tam.items()) if all(('Rotation%d' % k) in cab_r for k in ks)), None)
        so_bold = next((s for s, ks in sorted(por_tam.items())
                        if all(('Rotation%d' % k) not in cab_r and ('Bold%d' % k) in cab_r for k in ks)), None)
        novo_r = copy.deepcopy(res)
        gs = novo_r['parts'][0]['graphics']
        if so_rot:
            gs.append({'g': 'label', 'x': 100, 'y': 100, 'text': 'rot', 'rot': 0, 'size': so_rot})
        if so_bold:
            gs.append({'g': 'label', 'x': 100, 'y': 150, 'text': 'bold', 'rot': 0, 'size': so_bold})
        cab_antes_n = cab_de(lib)
        P.patch(lib, novo_r, bk_dir)
        cab_dep_n = cab_de(lib)
        rot_res = {t[0]: t[1] for t in rotulos(st)}
        if so_rot:
            fid = int(rot_res['rot'])
            assert fid == int(cab_antes_n['FontIdCount']) + 1 and ('Rotation%d' % fid) not in cab_dep_n, (fid, so_rot)
            assert int(cab_dep_n['Size%d' % fid]) == so_rot
        if so_bold:
            fid = int(rot_res['bold'])
            assert fid in por_tam[so_bold] and ('Bold%d' % fid) in cab_dep_n, (fid, so_bold)
        P.patch(lib, copy.deepcopy(res), bk_dir)          # o RES volta ao que era
        print('  rótulo novo: %spt só rotacionada -> fonte nova; %spt só negrito -> reaproveita' % (so_rot, so_bold))

        # ── partes têm que ser 1..N: parte 3 sem a 2 é recusada antes de escrever ──
        lm = simbolo(lib, 'LM324')
        furado = copy.deepcopy(lm)
        furado['parts'] = [furado['parts'][0], furado['parts'][2]]
        antes_f = streams(lib)
        try:
            P.patch(lib, furado, bk_dir)
            raise AssertionError('parts [1, 3] passou')
        except ValueError as e:
            assert '1..2' in str(e) and '[1, 3]' in str(e), e
        assert streams(lib) == antes_f, 'a recusa escreveu no arquivo'
        print('  partes [1, 3]: ValueError antes de gravar, arquivo intacto')

        # ── multi-part: volta igual; e com menos partes o PartCount acompanha ──
        assert lm['partcount'] == 4
        antes4 = streams(lib)
        r = P.patch(lib, copy.deepcopy(lm), bk_dir)
        assert r['verificado']
        st4 = r['storage']
        outros_iguais(antes4, streams(lib), [st4])
        assert not P.compara(P.esperado(lm), simbolo(lib, 'LM324')['parts'])
        assert int(registro1(lib, st4)['PartCount']) == 5
        menos = copy.deepcopy(lm)
        menos['parts'] = menos['parts'][:2]
        r = P.patch(lib, menos, bk_dir)
        cab5 = cab_de(lib)
        k = next(i for i in range(10000) if cab5.get('LibRef%d' % i) == 'LM324')
        assert cab5['PartCount%d' % k] == 3 or cab5['PartCount%d' % k] == '3', cab5['PartCount%d' % k]
        assert int(registro1(lib, st4)['PartCount']) == 3
        assert simbolo(lib, 'LM324')['partcount'] == 2
        indice_igual(cab0, cab5)
        print('  multi-part: LM324 4 partes iguais; com 2 partes PartCount=3 no RECORD=1 e no FileHeader')

        # ── o que o hub não representa fica: símbolo IEEE e modo de exibição extra ──
        ieee = simbolo(lib, 'EE-SX4330')

        def conta3(st_):
            regs_ = SB.desmonta(streams(lib)[st_ + '/Data'])
            return sum(1 for t, pl in regs_ if t == SB.TEXTO and SB.le_texto(pl).get('RECORD') == '3')
        st6 = P.acha(P.carrega(lib), 'EE-SX4330')
        n3_antes = conta3(st6)
        assert n3_antes >= 1, 'o EE-SX4330 da lib de teste devia ter símbolo IEEE'
        r = P.patch(lib, copy.deepcopy(ieee), bk_dir)
        n3 = conta3(st6)
        assert n3 == n3_antes and any('IEEE' in a for a in r['avisos']), (n3, n3_antes, r['avisos'])
        assert not P.compara(P.esperado(ieee), simbolo(lib, 'EE-SX4330')['parts'])
        pic = simbolo(lib, 'PIC18F4620')
        r = P.patch(lib, copy.deepcopy(pic), bk_dir)
        assert registro1(lib, r['storage'])['DisplayModeCount'] == '2'
        print('  EE-SX4330 mantém %d RECORD=3 (IEEE); PIC18F4620 mantém DisplayModeCount=2' % n3)

        # ── (6) enquadramento fecha e o test_schlib_bin passa no arquivo novo ──
        final = streams(lib)
        for k, dados in final.items():
            assert SB.monta(SB.desmonta(dados)) == dados, k
        assert {s.split('/')[0] for s in final} == {s.split('/')[0] for s in antes}, 'storages diferentes'
        assert len([s for s in final if s.endswith('/Data')]) == len([s for s in antes if s.endswith('/Data')])
        out = subprocess.run([sys.executable, os.path.join(RAIZ, 'tests', 'test_schlib_bin.py'), lib],
                             capture_output=True, text=True)
        assert out.returncode == 0 and 'test_schlib_bin OK' in out.stdout, out.stdout + out.stderr
        print('  (6) ' + out.stdout.strip().splitlines()[-1])

        # ── backups: 30 mais novos ──────────────────────────────────────────
        bks = sorted(os.listdir(bk_dir))
        assert 1 <= len(bks) <= P.BACKUPS and all(b.endswith('.SchLib') for b in bks), bks
        for i in range(P.BACKUPS + 3):
            P.faz_backup(lib, bk_dir)
        assert len(os.listdir(bk_dir)) == P.BACKUPS, len(os.listdir(bk_dir))

        # ── lib aberta em outro lugar: LibOcupada, nada escrito ─────────────
        if sys.platform == 'win32':
            with open(lib, 'rb'):
                try:
                    P.patch(lib, copy.deepcopy(res), bk_dir)
                    raise AssertionError('gravou com a lib aberta')
                except P.LibOcupada as e:
                    assert 'Altium' in str(e)
            assert not os.path.exists(lib + '.tmp'), '.tmp ficou para trás'
            assert streams(lib) == final, 'a tentativa com a lib aberta mudou o arquivo'
            print('  lib aberta por outro processo: LibOcupada, arquivo intacto')

        # ── a conferência pega geometria que não volta e restaura o backup ──
        ruim = copy.deepcopy(res)
        ruim['parts'][0]['graphics'].append({'g': 'nada', 'x': 1})       # o patch ignora: falta na releitura
        try:
            P.patch(lib, ruim, bk_dir)
            raise AssertionError('a verificação deixou passar')
        except RuntimeError as e:
            assert 'backup restaurado' in str(e), e
        assert streams(lib) == final, 'o backup não voltou'

        # ── CLI ────────────────────────────────────────────────────────────
        js = os.path.join(tmp, 'sym.json')
        import json
        with io.open(js, 'w', encoding='utf-8') as f:
            json.dump(res, f, ensure_ascii=False)
        out = subprocess.run([sys.executable, os.path.join(RAIZ, 'tools', 'symbols', 'schlib_patch.py'),
                              lib, js, '--backup-dir', bk_dir], capture_output=True, text=True, encoding='utf-8')
        assert out.returncode == 0 and 'conferido' in out.stdout, out.stdout + out.stderr

        n = len([s for s in final if s.endswith('/Data')])
        print('test_schlib_patch OK (%d componentes na cópia, 6 símbolos regravados, outros streams byte a byte)' % n)
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else None))
