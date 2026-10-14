"""Extrai o carimbo (title block) de um template do Draftsman para o hub-pcbpdf.js.

Le o .DwfDot/.PCBDwf (dwf_xml.descompacta), pega os itens da 1a pagina que vieram do
template (OriginatedFromTemplate) e escreve um JSON em mm, origem no canto INFERIOR esquerdo
da folha, Y para cima (a conta do PDF):

  {"fonte", "folha":{w,h,margem}, "linhas":[[x1,y1,x2,y2,esp]], "retangulos":[[x,y,w,h,esp]],
   "textos":[{x,y,w,h,s,fonte,tam,ha,va,cor}], "imagens":[{x,y,w,h,png(base64)}],
   "fontes":{id:{familia,tam}}}

Unidade do Draftsman: DIP do WPF (1/96 pol; GridSize 3,7795 = 1 mm). Texto que comeca com '='
e parametro (=Formato, =Data_desenho...): o hub preenche.

Uso: python carimbo.py <template.DwfDot> <saida.json> [--js <saida.js>]
"""
import sys, json, os, xml.etree.ElementTree as ET
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dwf_xml import descompacta

MM = 96 / 25.4


def limpa(r):
    for e in r.iter():
        e.tag = e.tag.split('}')[-1]
        for k in list(e.attrib):
            v = e.attrib.pop(k); e.attrib[k.split('}')[-1]] = v
    return r


def num(e, tag, pad=0.0):
    x = e.find(tag)
    return float(x.text) if x is not None and x.text else pad


def mm(v):
    return round(v / MM, 4)


def extrai(caminho):
    raiz = limpa(ET.fromstring(descompacta(open(caminho, 'rb').read())))
    pag = raiz.find('Pages/Page')
    W = num(pag, 'Size/Width'); H = num(pag, 'Size/Height')
    fontes = {}
    for f in raiz.findall('FontStyles/FontStyleData'):
        fontes[f.findtext('Id')] = {'familia': f.findtext('FamilyName'), 'tam': float(f.findtext('Size'))}
    estilos = {}
    for l in raiz.findall('LineStyles/LineStyleData'):
        estilos[l.findtext('Id')] = num(l, 'Thickness')
    out = {'fonte': os.path.basename(caminho),
           'folha': {'w': mm(W), 'h': mm(H), 'margem': mm(num(pag, 'Margin/Left')),
                     'nome': pag.findtext('StandardSizeName')},
           'fontes': fontes, 'linhas': [], 'retangulos': [], 'textos': [], 'imagens': []}
    for it in pag.findall('Items/Item'):
        if it.findtext('OriginatedFromTemplate') != 'true':
            continue
        tipo = it.get('type')
        if tipo == 'Line':
            esp = estilos.get(it.findtext('StyleId'), 0.7559)
            out['linhas'].append([mm(num(it, 'StartPoint/X')), mm(num(it, 'StartPoint/Y')),
                                  mm(num(it, 'EndPoint/X')), mm(num(it, 'EndPoint/Y')), mm(esp)])
        elif tipo == 'Rectangle':
            esp = estilos.get(it.findtext('LineStyleId'), 0.7559)
            out['retangulos'].append([mm(num(it, 'Rect/X')), mm(num(it, 'Rect/Y')),
                                      mm(num(it, 'Rect/Width')), mm(num(it, 'Rect/Height')), mm(esp)])
        elif tipo == 'Text':
            c = it.find('Color')
            cor = '#%02x%02x%02x' % tuple(int(c.findtext(k)) for k in 'RGB') if c is not None else '#000000'
            f = fontes.get(it.findtext('FontStyleId'), {'familia': 'Arial', 'tam': 10})
            out['textos'].append({'x': mm(num(it, 'Rect/X')), 'y': mm(num(it, 'Rect/Y')),
                                  'w': mm(num(it, 'Rect/Width')), 'h': mm(num(it, 'Rect/Height')),
                                  's': it.findtext('Text') or '', 'fonte': f['familia'], 'tam': f['tam'],
                                  'ha': it.findtext('HorizontalAlignment'), 'va': it.findtext('VerticalAlignment'),
                                  'rot': it.findtext('Rotation'), 'cor': cor})
        elif tipo == 'Picture':
            out['imagens'].append({'x': mm(num(it, 'Rect/X')), 'y': mm(num(it, 'Rect/Y')),
                                   'w': mm(num(it, 'Rect/Width')), 'h': mm(num(it, 'Rect/Height')),
                                   'png': it.findtext('Bitmap')})
    return out


if __name__ == '__main__':
    d = extrai(sys.argv[1])
    open(sys.argv[2], 'w', encoding='utf-8').write(json.dumps(d, ensure_ascii=False, indent=1))


# ---------------------------------------------------------------------------------------------
# o logo para o PDF: o PDF nao le PNG com alfa direto, entao o PNG do template e decodificado
# aqui (sem biblioteca: zlib + os 5 filtros do PNG), composto sobre o branco da folha e
# recomprimido em zlib - o hub-pdfwriter poe os bytes como estao (/FlateDecode), sem decodificar
# nada no navegador.

def png_rgb_sobre_branco(png):
    import struct, zlib
    assert png[:8] == b'\x89PNG\r\n\x1a\n', 'nao e PNG'
    i = 8; idat = b''; W = H = prof = tipo = None
    while i < len(png):
        n, = struct.unpack('>I', png[i:i + 4]); t = png[i + 4:i + 8]; d = png[i + 8:i + 8 + n]
        if t == b'IHDR':
            W, H, prof, tipo, _c, _f, entrel = struct.unpack('>IIBBBBB', d)
            assert prof == 8 and tipo in (2, 6) and entrel == 0, 'PNG fora do caso medido (8 bits RGB/RGBA)'
        elif t == b'IDAT':
            idat += d
        i += 12 + n
    bpp = 4 if tipo == 6 else 3
    cru = zlib.decompress(idat); linha = W * bpp
    out = bytearray(W * H * 3); ant = bytearray(linha); p = 0
    for y in range(H):
        f = cru[p]; cur = bytearray(cru[p + 1:p + 1 + linha]); p += 1 + linha
        for x in range(linha):
            a = cur[x - bpp] if x >= bpp else 0; b = ant[x]; c = ant[x - bpp] if x >= bpp else 0
            if f == 1: cur[x] = (cur[x] + a) & 255
            elif f == 2: cur[x] = (cur[x] + b) & 255
            elif f == 3: cur[x] = (cur[x] + ((a + b) >> 1)) & 255
            elif f == 4:
                pa = abs(b - c); pb = abs(a - c); pc = abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                cur[x] = (cur[x] + pr) & 255
        for x in range(W):
            r, g, bb = cur[x * bpp], cur[x * bpp + 1], cur[x * bpp + 2]
            al = cur[x * bpp + 3] if bpp == 4 else 255
            q = (y * W + x) * 3
            out[q] = (r * al + 255 * (255 - al) + 127) // 255
            out[q + 1] = (g * al + 255 * (255 - al) + 127) // 255
            out[q + 2] = (bb * al + 255 * (255 - al) + 127) // 255
        ant = cur
    return W, H, zlib.compress(bytes(out), 9)


def escreve_js(d, caminho):
    import base64
    imgs = []
    for im in d['imagens']:
        W, H, z = png_rgb_sobre_branco(base64.b64decode(im['png']))
        q = dict(im); q.pop('png'); q.update({'pw': W, 'ph': H, 'rgbFlate': base64.b64encode(z).decode('ascii')})
        imgs.append(q)
    dd = dict(d); dd['imagens'] = imgs
    corpo = json.dumps(dd, ensure_ascii=True, separators=(',', ':'))
    js = ('/* AltiumPCBMirror v2 - hub-pcbpdf-carimbo.js  (GERADO: nao edite a mao)\n'
          '   O carimbo DIEletrons do Draftsman, extraido de ' + d['fonte'] + ' por\n'
          '   tools/draftsman/carimbo.py: linhas, retangulos e textos em mm (origem no canto inferior\n'
          '   esquerdo da folha A4, Y para cima), parametros =Nome que o hub preenche, e o logo ja\n'
          '   composto sobre o branco e comprimido em zlib (rgbFlate, base64) para o /FlateDecode.\n'
          '   Refazer: python tools/draftsman/carimbo.py <A4_DiEletronsDraftsman.DwfDot> <x.json> --js hub-pcbpdf-carimbo.js */\n'
          '(function (root, dados) {\n'
          "  if (typeof module === 'object' && module.exports) module.exports = dados;\n"
          '  else root.HubPcbPdfCarimbo = dados;\n'
          "})(typeof self !== 'undefined' ? self : this, " + corpo + ');\n')
    open(caminho, 'w', encoding='ascii', newline='\n').write(js)


if __name__ == '__main__' and '--js' in sys.argv:
    escreve_js(extrai(sys.argv[1]), sys.argv[sys.argv.index('--js') + 1])
