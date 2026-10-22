# A placa do .PrjPcb (tools/pcbdoc/abrir_placa.py » placas_do_prjpcb): o arquivo arrastado para o
# NexoEletric e so o .PrjPcb, e o hubserver acha o .PcbDoc por ele. Rodar da raiz:
#   python tests/test_abrir_placa.py
import os
import shutil
import sys
import tempfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, 'tools', 'pcbdoc'))
import abrir_placa as AP  # noqa: E402

tmp = tempfile.mkdtemp()
try:
    os.makedirs(os.path.join(tmp, 'PCB'))
    os.makedirs(os.path.join(tmp, 'ESQUEMÁTICO'))
    open(os.path.join(tmp, 'PCB', 'PCBM-DI261905.PcbDoc'), 'wb').close()
    open(os.path.join(tmp, 'Outra.PcbDoc'), 'wb').close()          # veio solta, sem a subpasta
    prj = os.path.join(tmp, 'CBM-DI251876.PrjPcb')
    texto = ('[Design]\r\nVersion=1.0\r\n\r\n'
             '[Document1]\r\nDocumentPath=ESQUEMÁTICO\\UPSIDE.SchDoc\r\n\r\n'
             '[Document2]\r\nDocumentPath=PCB\\PCBM-DI261905.PcbDoc\r\n\r\n'
             '[Document3]\r\nDocumentPath=FABRICACAO\\Outra.PcbDoc\r\n\r\n'
             '[Document4]\r\nDocumentPath=PCB\\NaoExiste.PcbDoc\r\n\r\n'
             '[OutputGroup1]\r\nDocumentPath=C:\\Templates\\PCB-DI.PcbDoc\r\n')
    for cod in ('utf-8-sig', 'cp1252'):                              # o Altium grava nos dois
        with open(prj, 'wb') as f:
            f.write(texto.encode(cod))
        achadas = AP.placas_do_prjpcb(prj)
        assert [os.path.relpath(p, tmp) for p in achadas] == [os.path.join('PCB', 'PCBM-DI261905.PcbDoc'), 'Outra.PcbDoc'], achadas
    # o vazio que o ExportBoard criaria: um array JSON por linha que o hub e o ApplyChanges leem
    assert AP.CHANGES_VAZIO.splitlines()[-2:] == ['var changes = [', '];']
    assert AP.ANNOTATIONS_VAZIO.splitlines()[-2:] == ['var annotations = [', '];']
finally:
    shutil.rmtree(tmp, ignore_errors=True)
print('test_abrir_placa OK')
