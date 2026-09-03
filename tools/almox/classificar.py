# -*- coding: utf-8 -*-
"""Le o dump do Odoo e diz, para cada produto, a que simbolo e a que "part" ele pertence.

A regra do usuario, em uma frase: o SIMBOLO e o tipo do componente + a montagem
("RESISTOR [SMD]") e a PART e o valor ("1K 1/4W 1% 100ppm"). Tudo que sobra do nome
depois de tirar o tipo e o encapsulamento vira o rotulo da part - foi assim que
"Resistor Fio Enrolado 0.1R/100mOhms 5W 1% 90ppm PTH" virou a part "0.1R/100mOhms 5W 1% 90ppm"
dentro do simbolo "RESISTOR [PTH]".

Duas familias de saida:
  basicos   - mesmo simbolo, mesmos pinos, muitos valores (R, C, L, D, Q, F, SW, J...)
  especiais - pinagem propria por part number (CI, MCU, ADC, conversor, modulo...)
"""
import csv, re, unicodedata, os

BASE = os.path.dirname(os.path.abspath(__file__))
CSV_ODOO = os.path.join(BASE, 'componentes_odoo.csv')


def sa(s):
    """sem acento, minusculo, espacos colapsados - a forma em que todo regex daqui casa"""
    s = ''.join(c for c in unicodedata.normalize('NFD', s or '')
                if unicodedata.category(c) != 'Mn')
    return re.sub(r'\s+', ' ', s).strip().lower()


# ─── encapsulamento ───────────────────────────────────────────────────────────
CHIP = r'0201|0402|0603|0805|1206|1210|1218|1806|1812|2010|2220|2512|2817|2924'
PKG_RX = re.compile(
    r'\b(' + CHIP + r'|'
    r'sot-?\d+-?\d*|sod-?\d+[a-z]*|sma|smb|smc|dpak|d2pak|to-?\d+[a-z]*-?\d*|'
    r'dip-?\d+|pdip-?\d+|soic-?\d+|ssop-?\d+|tssop-?\d+|msop-?\d+|vssop-?\d+|'
    r'qfn-?\d+|tqfp-?\d+|lqfp-?\d+|qfp-?\d+|plcc-?\d+|sip-?\d+|can-?\d+|'
    r'do-?\d+[a-z]*|hc-?49[a-z]*'
    r')\b')


def acha_pkg(nome_sa):
    m = PKG_RX.search(nome_sa)
    return m.group(1).upper().replace(' ', '') if m else ''


def pinos_do_pkg(pkg):
    """DIP8 -> 8, SOT-23-5 -> 5, TO-220-3 -> 3, TO-92 -> 3. 0 quando o nome nao diz."""
    p = sa(pkg).replace(' ', '')
    if not p:
        return 0
    m = re.match(r'^(?:sot|to)-?\d+[a-z]*-(\d+)$', p)
    if m:
        return int(m.group(1))
    m = re.match(r'^(?:dip|pdip|soic|ssop|tssop|msop|vssop|qfn|tqfp|lqfp|qfp|plcc|sip|can)-?(\d+)$', p)
    if m:
        n = int(m.group(1))
        return n if 2 <= n <= 100 else 0
    if re.match(r'^to-?(92|126|220|218|247|251|252|263|3p)', p):
        return 3
    if re.match(r'^sot-?23$', p):
        return 3
    if re.match(r'^sot-?(223|89)$', p):
        return 3
    return 0


MONT_SMD = re.compile(r'\bsmd\b|\bsmt\b|montagem em superficie')
MONT_PTH = re.compile(r'\bpth\b|\bthrough\b|furo passante|\bradial\b|\baxial\b|\bdip\b')


def montagem(nome_sa, pkg):
    p = sa(pkg)
    if MONT_SMD.search(nome_sa):
        return 'SMD'
    if re.match(r'^(' + CHIP + r')$', p):
        return 'SMD'
    if re.match(r'^(soic|ssop|tssop|msop|vssop|qfn|tqfp|lqfp|qfp|sot|sod|sma|smb|smc|dpak|d2pak)', p):
        return 'SMD'
    # DO-213 (MELF) e DO-214 (SMA/SMB/SMC) sao de SUPERFICIE, apesar do prefixo DO- que a
    # regra de baixo trata como axial de vidro. Sem esta linha, 'do-2' casa antes e um
    # Schottky em SMA vai parar no simbolo PTH.
    if re.match(r'^do-?21[34]', p):
        return 'SMD'
    if MONT_PTH.search(nome_sa):
        return 'PTH'
    if re.match(r'^(dip|pdip|to-?9|to-?2|can|hc-?49|do-?[23]|plcc|sip)', p):
        return 'PTH'
    return ''


# ─── valor numerico (para ordenar as parts do menor para o maior) ─────────────
MULT = {'p': 1e-12, 'n': 1e-9, 'u': 1e-6, 'm': 1e-3, '': 1.0, 'k': 1e3, 'M': 1e6, 'g': 1e9}

RE_OHM  = re.compile(r'(?<![\w.,/])(\d+(?:[.,]\d+)?)\s*(m|k|M|G|R|E)(?:ohms?)?(?![\w.,])', re.I)
RE_OHM2 = re.compile(r'(?<![\w.,/])(\d+(?:[.,]\d+)?)\s*(?:ohms?)(?![\w.,])', re.I)
RE_FAR  = re.compile(r'(?<![\w.,/])(\d+(?:[.,]\d+)?)\s*(p|n|u|m)?F(?![\w.,])', re.I)
RE_HEN  = re.compile(r'(?<![\w.,/])(\d+(?:[.,]\d+)?)\s*(p|n|u|m)?H(?![\w.,z])', re.I)
RE_VOLT = re.compile(r'(?<![\w.,/])(\d+(?:[.,]\d+)?)\s*(m|k)?V(?:dc|cc|ac|ca)?(?![\w.,])', re.I)
RE_AMP  = re.compile(r'(?<![\w.,/])(\d+(?:[.,]\d+)?)\s*(m|u)?A(?![\w.,])', re.I)
RE_HZ   = re.compile(r'(?<![\w.,/])(\d+(?:[.,]\d+)?)\s*(k|M|G)?Hz(?![\w.,])', re.I)


def _num(t):
    return float(t.replace(',', '.'))


def _fmt(x):
    s = ('%.4f' % x).rstrip('0').rstrip('.')
    return s if s else '0'


def canon_ohm(v):
    if v == 0:   return '0R'
    if v >= 1e6: return _fmt(v / 1e6) + 'M'
    if v >= 1e3: return _fmt(v / 1e3) + 'K'
    if v >= 1:   return _fmt(v) + 'R'
    return _fmt(v * 1e3) + 'm'


def canon_si(v, un):
    for lim, suf in ((1e9, 'G'), (1e6, 'M'), (1e3, 'k'), (1, ''), (1e-3, 'm'),
                     (1e-6, 'u'), (1e-9, 'n'), (1e-12, 'p')):
        if abs(v) >= lim:
            return _fmt(v / lim) + suf + un
    return _fmt(v) + un


def valor_de(nome, unidade):
    """(valor em SI, texto canonico) do primeiro valor da unidade pedida no nome."""
    if unidade == 'R':
        m = RE_OHM.search(nome)
        if m:
            n, suf = _num(m.group(1)), m.group(2)
            if suf.upper() in ('R', 'E'): v = n
            elif suf == 'm':              v = n * 1e-3
            elif suf.upper() == 'K':      v = n * 1e3
            elif suf == 'M':              v = n * 1e6
            elif suf.upper() == 'G':      v = n * 1e9
            else:                         v = n
            return v, canon_ohm(v)
        m = RE_OHM2.search(nome)
        if m:
            return _num(m.group(1)), canon_ohm(_num(m.group(1)))
        return None, ''
    rx, esc = {'F': (RE_FAR, 'F'), 'H': (RE_HEN, 'H'), 'V': (RE_VOLT, 'V'),
               'A': (RE_AMP, 'A'), 'Hz': (RE_HZ, 'Hz')}.get(unidade, (None, ''))
    if not rx:
        return None, ''
    m = rx.search(nome)
    if not m:
        return None, ''
    suf = (m.group(2) or '')
    if unidade == 'Hz':
        suf = suf.upper() if suf else ''
        mult = {'': 1.0, 'K': 1e3, 'M': 1e6, 'G': 1e9}[suf]
    else:
        s = suf.lower()
        mult = MULT.get('M' if suf == 'M' and unidade in ('V', 'A') else s, 1.0)
    v = _num(m.group(1)) * mult
    return v, canon_si(v, esc)
