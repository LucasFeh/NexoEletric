# -*- coding: utf-8 -*-
"""tools/schdoc/schdoc2sch.py: o esquema do Altium aberto no hub sem o Altium.

    python tests/test_schdoc2sch.py

(a) offline: uma folha no formato ASCII do Altium com um registro de cada tipo -- componente
    (designador, comment, parametro de identidade, footprint atual), fio, rotulo, power, port,
    juncao, No ERC, texto, template (o carimbo fica fora), parametro do documento -- e o
    .PrjPcb que manda na ordem das folhas, com as folhas soltas ao lado dele.
(b) ouro, quando o Z: esta: o PRJ - DI261930 lido do .SchDoc tem de sair igual ao schematic.js
    que o ExportProject.pas gravou no Altium (Projects/PRJ - DI261930), item a item. A unica
    diferenca aceita e a das juncoes, que o ExportProject daquela data ainda nao gravava.
    Sem a rede, PULA (nao falha).
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'schdoc'))
import schdoc2sch as SD  # noqa: E402


def le_js(texto):
    corpo = texto[texto.index('{'):texto.rindex('}') + 1]
    return json.loads(corpo.replace(',\n]', '\n]'))


FOLHA = [
    '|HEADER=Protel for Windows - Schematic Capture Ascii File Version 5.0|WEIGHT=20',
    '|RECORD=31|UseCustomSheet=T|CustomX=1169|CustomX_Frac=29134|CustomY=826|CustomY_Frac=77165'
    '|TemplateFileName=X:\\Biblio Di_Eletrons\\A4_DiEletrons.SchDot',
    '|RECORD=41|Name=Revision|Text=REV. B',
    '|RECORD=41|Name=CurrentTime|Text=*',
    '|RECORD=1|LibReference=RES TESTE|Location.X=100|Location.Y=200|Orientation=1|IsMirrored=T|CurrentPartId=1|PartCount=2',
    '|RECORD=34|OwnerIndex=3|Location.X=110|Location.Y=230|Text=R1|Name=Designator',
    '|RECORD=41|OwnerIndex=3|Name=Comment|Text=10k|Location.X=110|Location.Y=180',
    '|RECORD=41|OwnerIndex=3|Name=MPN|Text=RC0603;FR',
    '|RECORD=41|OwnerIndex=3|Name=Estoque|Text=18',
    '|RECORD=44|OwnerIndex=3',
    '|RECORD=45|OwnerIndex=8|ModelName=R0805|ModelType=PCBLIB',
    '|RECORD=45|OwnerIndex=8|ModelName=R0603|ModelType=PCBLIB|IsCurrent=T',
    '|RECORD=2|OwnerIndex=3|OwnerPartId=1|Location.X=100|Location.Y=200|PinLength=10|PinConglomerate=56|Designator=1|Name=A|Electrical=4',
    '|RECORD=27|LocationCount=3|X1=50|Y1=50|X2=90|Y2=50|X3=90|Y3=80|X3_Frac=50000',
    '|RECORD=25|Location.X=60|Location.Y=50|Text=NET1|Orientation=2',
    '|RECORD=17|Location.X=40|Location.Y=50|Text=GND|Style=4|Orientation=3',
    '|RECORD=18|Location.X=10|Location.Y=10|Name=P1|IOType=1|Style=3|Width=40|AreaColor=65535|TextColor=255',
    '|RECORD=29|Location.X=90|Location.Y=50',
    '|RECORD=22|Location.X=95|Location.Y=95',
    '|RECORD=39|FileName=X:\\Biblio Di_Eletrons\\A4_DiEletrons.SchDot',
    '|RECORD=4|OwnerIndex=18|Location.X=1|Location.Y=1|Text==Title',
    '|RECORD=4|Location.X=20|Location.Y=20|Text=nota "1"',
    '|RECORD=4|Location.X=20|Location.Y=30|Text=  ',
]


def offline():
    tmp = tempfile.mkdtemp(prefix='schdoc2sch-')
    try:
        a = os.path.join(tmp, 'A.SchDoc')
        with open(a, 'w', encoding='latin-1', newline='\r\n') as f:
            f.write('\n'.join(FOLHA) + '\n')
        with open(os.path.join(tmp, 'B.SchDoc'), 'w', encoding='latin-1', newline='\r\n') as f:
            f.write('\n'.join(FOLHA).replace('|Text=R1|', '|Text=R2|') + '\n')
        prj = os.path.join(tmp, 'Teste.PrjPcb')
        with open(prj, 'w', encoding='utf-8-sig') as f:
            f.write('[Design]\nVersion=1.0\n\n[Document1]\nDocumentPath=ESQUEMÁTICO\\B.SchDoc\n\n'
                    '[Document2]\nDocumentPath=A.SchDoc\n\n[Document3]\nDocumentPath=PCB\\X.PcbDoc\n\n'
                    '[Parameter1]\nName=Cliente\nValue=DIEletrons\n')
        avisos = []
        texto, resumo = SD.converte([prj], None, True, avisos)
        s = le_js(texto)
        assert s['project'] == 'Teste' and s['format'] == 'schmirror-v2' and s['units'] == 'mil'
        assert s['params'] == 'Cliente=DIEletrons', s.get('params')
        folhas = [i for i in s['items'] if i['t'] == 'sheet']
        assert [f['name'] for f in folhas] == ['B', 'A'], 'a ordem do .PrjPcb, folha solta ao lado dele'
        sh = folhas[0]
        assert sh['size'] == 'A4' and abs(sh['w'] - 11692.913) < 0.01 and abs(sh['h'] - 8267.717) < 0.01, sh
        assert sh['params'] == 'Revision=REV. B', 'parametro do documento; a semente "*" fica fora'
        de = [i for i in s['items'] if i.get('sheet') == 'B']
        c = next(i for i in de if i['t'] == 'comp')
        assert (c['ref'], c['sym'], c['part'], c['x'], c['y'], c['rot'], c['mirror']) == ('R2', 'RES TESTE', 1, 1000, 2000, 90, True), c
        assert c['footprint'] == 'R0603', 'o modelo PCBLIB marcado IsCurrent, nao o primeiro'
        assert c['comment'] == '10k'
        assert c['params'] == 'MPN=RC0603,FR', 'so os de identidade, com ; trocado por ,'
        assert (c['refdx'], c['refdy'], c['comdx'], c['comdy']) == (100, 300, 100, -200)
        w = next(i for i in de if i['t'] == 'wire')
        assert w['pts'] == [[500, 500], [900, 500], [905, 800]], w['pts']   # _Frac: 1/100000 da unidade de 10 mil
        n = next(i for i in de if i['t'] == 'netlabel')
        assert (n['net'], n['x'], n['y'], n['rot']) == ('NET1', 600, 500, 180)
        p = next(i for i in de if i['t'] == 'power')
        assert (p['net'], p['style'], p['rot']) == ('GND', 'GndPower', 270)
        pt = next(i for i in de if i['t'] == 'port')
        assert (pt['net'], pt['io'], pt['style'], pt['w'], pt['fill'], pt['textColor'], pt['color']) == ('P1', 1, 3, 400, '#FFFF00', '#FF0000', '#000000'), pt
        assert sum(1 for i in de if i['t'] == 'junction') == 1 and sum(1 for i in de if i['t'] == 'noerc') == 1
        tx = [i for i in de if i['t'] == 'text']
        assert [t['s'] for t in tx] == ['nota "1"'], 'o carimbo (filho do template) e o texto vazio ficam fora'
        assert resumo['carimbo'] == 2 and resumo['vazio'] == 2 and resumo['folhas'] == 2 and not resumo['faltam']
        # o template so entra se o hub o conhece; o A4_DiEletrons esta no Libs/sch-templates.js
        if 'casa:A4_DiEletrons' in SD.ids_de_template():
            assert sh['template'] == 'casa:A4_DiEletrons', sh
        # os simbolos da folha: em coordenadas locais (desfeitos o giro e o espelho do Altium)
        sy = next(x for x in s['symbols'] if x['name'] == 'RES TESTE')
        assert sy['partcount'] == 1 and sy['parts'][0]['pins'][0]['num'] == '1'
        assert sy['parts'][0]['pins'][0]['x'] == 0 and sy['parts'][0]['pins'][0]['y'] == 0
        # o HubCore le o que foi gravado e acha os mesmos itens
        out = os.path.join(tmp, 'sch', 'schematic.js')
        SD.grava(out, texto)
        try:
            SD.grava(out, texto)
            raise AssertionError('sobrescreveu sem --forcar')
        except FileExistsError:
            pass
        SD.grava(out, texto, forcar=True)
        assert any(x.startswith('schematic.js.bak-') for x in os.listdir(os.path.dirname(out))), 'o anterior vai para .bak'
        r = subprocess.run(['node', '-e', 'const fs=require("fs");const s=new Function(fs.readFileSync(process.argv[1],"utf8")+";return schematic")();'
                            'const HC=require(process.argv[2]);const v=HC.validateSchematic(s,{symbols:s.symbols||[]},{footprints:[{name:"R0603"}]});if(v.errors.length)console.error(JSON.stringify(v.errors));'
                            'console.log(JSON.stringify({n:s.items.length,erros:v.errors.length}));process.exit(v.errors.length?1:0)', out,
                            os.path.join(RAIZ, 'hub-core.js')], capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
        print('  Node le o schematic.js: ' + r.stdout.strip())
        # disco de rede: recusa
        assert SD.disco_de_rede('\\\\servidor\\x\\schematic.js') and SD.disco_de_rede('Z:\\a\\schematic.js')
        print('(a) offline ok: os 9 tipos de item, a ordem do .PrjPcb, parametros, template, simbolos, .bak')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def ouro():
    prj = (r'Z:\EQUIPAMENTOS ATUALIZADOS\SUI - DI141388XY - SUPERVISOR DE INCLINAÇÃO\PCB E SCH\MODELO 2026'
           r'\PRJ - SENSOR-DI261924')
    esperado = os.path.join(RAIZ, 'Projects', 'PRJ - DI261930', 'schematic.js')
    if not os.path.isdir(prj) or not os.path.isfile(esperado):
        print('(b) PULOU: sem o Z: (ou sem o espelho do PRJ - DI261930)')
        return
    pp = [os.path.join(prj, f) for f in os.listdir(prj) if f.lower().endswith('.prjpcb')]
    if not pp:
        print('(b) PULOU: o .PrjPcb do DI261930 nao esta onde estava')
        return
    texto, _ = SD.converte(pp[:1], 'PRJ - DI261930', False)
    a = le_js(open(esperado, encoding='utf-8').read())
    b = le_js(texto)
    por = lambda s, t: [i for i in s['items'] if i['t'] == t]
    tipos = sorted({i['t'] for i in a['items']} | {i['t'] for i in b['items']})
    for t in tipos:
        if t == 'junction':
            continue
        x, y = por(a, t), por(b, t)
        assert len(x) == len(y), '%s: %d no Altium, %d lidos' % (t, len(x), len(y))
        if t in ('wire', 'noerc'):
            chave = lambda i: json.dumps([[round(v) for v in p] for p in sorted(i['pts'])] if 'pts' in i else [round(i['x']), round(i['y'])])
            x, y = sorted(x, key=chave), sorted(y, key=chave)
        for i, (u, v) in enumerate(zip(x, y)):
            for k in u:
                if k == 'sheet' and t == 'sheet':
                    continue
                uu, vv = u[k], v.get(k)
                if isinstance(uu, (int, float)) and not isinstance(uu, bool):
                    assert abs(uu - vv) < 0.01, '%s %d %s: %r x %r' % (t, i, k, uu, vv)
                elif k == 'pts':
                    assert sorted(map(tuple, uu)) == sorted(map(tuple, vv)) or uu[::-1] == vv, '%s %d pts' % (t, i)
                else:
                    assert uu == vv, '%s %d %s: %r x %r' % (t, i, k, uu, vv)
    print('(b) ouro ok: o DI261930 lido do .SchDoc = o schematic.js do ExportProject (%d itens)' % len(a['items']))


if __name__ == '__main__':
    offline()
    ouro()
    print('test_schdoc2sch OK')
