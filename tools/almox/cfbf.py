# -*- coding: utf-8 -*-
"""Escritor de arquivo composto OLE2 (MS-CFB) — o contêiner de uma .SchLib.

O `olefile` lê CFBF mas não cria; este módulo cria. É a única peça que faltava para
escrever uma .SchLib sem abrir o Altium.

Só o necessário para o caso de uso: setor de 512 bytes (versão 3), mini-stream para os
streams abaixo de 4 KB, DIFAT dentro do cabeçalho (até 109 setores de FAT, ou ~7 MB de
FAT — muito além do que estas bibliotecas usam).

A prova de que está certo é `tests/test_cfbf.py`: escrever e reler com o `olefile`, que
é uma implementação independente, e exigir a mesma árvore de streams byte a byte.
"""
import struct
from datetime import datetime, timezone

SETOR = 512
MINI = 64
CORTE_MINI = 4096                 # o padrão manda ser exatamente isto

LIVRE = 0xFFFFFFFF
FIM = 0xFFFFFFFE
FATSECT = 0xFFFFFFFD
DIFSECT = 0xFFFFFFFC
SEM_FILHO = 0xFFFFFFFF

ASSINATURA = bytes.fromhex('d0cf11e0a1b11ae1')

VAZIO, STORAGE, STREAM, RAIZ = 0, 1, 2, 5
VERMELHO, PRETO = 0, 1


def _agora_filetime():
    """FILETIME: 100 ns desde 1601-01-01."""
    delta = datetime.now(timezone.utc) - datetime(1601, 1, 1, tzinfo=timezone.utc)
    return int(delta.total_seconds() * 10_000_000)


def _pad(b, n):
    resto = len(b) % n
    return b if resto == 0 else b + b'\x00' * (n - resto)


class _Entrada(object):
    __slots__ = ('nome', 'tipo', 'dados', 'filhos', 'id', 'esq', 'dir', 'filho',
                 'inicio', 'tamanho', 'cor')

    def __init__(self, nome, tipo):
        self.nome, self.tipo = nome, tipo
        self.dados = b''
        self.filhos = []
        self.id = -1
        self.esq = self.dir = self.filho = SEM_FILHO
        self.inicio, self.tamanho, self.cor = 0, 0, PRETO


def _chave(nome):
    """Ordem do diretório CFBF: primeiro pelo COMPRIMENTO do nome, depois maiúsculo."""
    return (len(nome), nome.upper())


def _arvore(ids, entradas):
    """Monta uma árvore balanceada com os irmãos já ordenados e devolve a raiz.

    O padrão pede rubro-negra; uma árvore balanceada com todos os nós pretos satisfaz as
    invariantes de busca, que é do que os leitores precisam."""
    if not ids:
        return SEM_FILHO
    meio = len(ids) // 2
    no = entradas[ids[meio]]
    no.esq = _arvore(ids[:meio], entradas)
    no.dir = _arvore(ids[meio + 1:], entradas)
    no.cor = PRETO
    return no.id


def _monta_entradas(arvore):
    """{'nome': bytes | {...}} -> lista de _Entrada, com a raiz no índice 0."""
    raiz = _Entrada('Root Entry', RAIZ)
    entradas = [raiz]

    def anda(no_dict, pai):
        filhos = []
        for nome in sorted(no_dict, key=_chave):
            v = no_dict[nome]
            e = _Entrada(nome, STORAGE if isinstance(v, dict) else STREAM)
            if isinstance(v, dict):
                e.id = len(entradas)
                entradas.append(e)
                anda(v, e)
            else:
                e.dados = v
                e.tamanho = len(v)
                e.id = len(entradas)
                entradas.append(e)
            filhos.append(e.id)
        pai.filho = _arvore(filhos, entradas)

    anda(arvore, raiz)
    return entradas


def escreve(arvore):
    """{'FileHeader': b'...', 'RES': {'Data': b'...'}} -> bytes do arquivo CFBF."""
    entradas = _monta_entradas(arvore)

    # ── mini-stream: tudo que é menor que 4 KB entra aqui ─────────────────────
    mini = bytearray()
    minifat = []
    for e in entradas:
        if e.tipo != STREAM or not e.dados:
            continue
        if len(e.dados) < CORTE_MINI:
            e.inicio = len(mini) // MINI
            bloco = _pad(e.dados, MINI)
            n = len(bloco) // MINI
            for k in range(n):
                minifat.append(e.inicio + k + 1)
            minifat[-1] = FIM
            mini += bloco

    setores = []       # cada item: 512 bytes
    fat = []

    def cadeia(dados):
        """grava `dados` numa cadeia de setores e devolve o primeiro (ou FIM se vazio)"""
        if not dados:
            return FIM
        bloco = _pad(dados, SETOR)
        primeiro = len(setores)
        n = len(bloco) // SETOR
        for k in range(n):
            setores.append(bloco[k * SETOR:(k + 1) * SETOR])
            fat.append(primeiro + k + 1)
        fat[-1] = FIM
        return primeiro

    # o mini-stream é um stream comum, de dono a raiz
    entradas[0].inicio = cadeia(bytes(mini))
    entradas[0].tamanho = len(mini)

    for e in entradas:
        if e.tipo == STREAM and e.dados and len(e.dados) >= CORTE_MINI:
            e.inicio = cadeia(e.dados)
        elif e.tipo == STREAM and not e.dados:
            e.inicio, e.tamanho = FIM, 0

    # mini-FAT
    mf = b''.join(struct.pack('<I', v) for v in minifat)
    minifat_inicio = cadeia(mf)
    minifat_n = (len(_pad(mf, SETOR)) // SETOR) if mf else 0

    # diretório
    agora = _agora_filetime()
    dirbytes = bytearray()
    for e in entradas:
        nome16 = e.nome.encode('utf-16-le') + b'\x00\x00'
        if len(nome16) > 64:
            raise ValueError('nome de stream longo demais: %r' % e.nome)
        d = bytearray(128)
        d[0:len(nome16)] = nome16
        struct.pack_into('<H', d, 64, len(nome16))
        d[66] = e.tipo
        d[67] = e.cor
        struct.pack_into('<III', d, 68, e.esq, e.dir, e.filho)
        if e.tipo in (RAIZ, STORAGE):
            struct.pack_into('<QQ', d, 100, agora, agora)
        struct.pack_into('<I', d, 116, e.inicio if e.inicio != FIM else 0)
        struct.pack_into('<Q', d, 120, e.tamanho)
        dirbytes += d
    dir_inicio = cadeia(bytes(dirbytes))
    dir_n = len(_pad(bytes(dirbytes), SETOR)) // SETOR

    # ── FAT: os próprios setores de FAT ocupam lugar, então é ponto fixo ──────
    n_fat = 1
    while True:
        total = len(setores) + n_fat
        precisa = (total + 127) // 128
        if precisa <= n_fat:
            break
        n_fat = precisa
    if n_fat > 109:
        raise ValueError('FAT maior que o DIFAT do cabecalho (%d setores)' % n_fat)

    fat_inicio = len(setores)
    for _ in range(n_fat):
        setores.append(b'\x00' * SETOR)
        fat.append(FATSECT)

    entradas_fat = fat + [LIVRE] * (n_fat * 128 - len(fat))
    bruto_fat = b''.join(struct.pack('<I', v) for v in entradas_fat)
    for k in range(n_fat):
        setores[fat_inicio + k] = bruto_fat[k * SETOR:(k + 1) * SETOR]

    # ── cabeçalho ─────────────────────────────────────────────────────────────
    cab = bytearray(SETOR)
    cab[0:8] = ASSINATURA
    struct.pack_into('<HH', cab, 24, 0x003E, 0x0003)     # versao menor / maior
    struct.pack_into('<H', cab, 28, 0xFFFE)              # little-endian
    struct.pack_into('<HH', cab, 30, 9, 6)               # 2^9 = 512, 2^6 = 64
    struct.pack_into('<I', cab, 44, n_fat)
    struct.pack_into('<I', cab, 48, dir_inicio)
    struct.pack_into('<I', cab, 56, CORTE_MINI)
    struct.pack_into('<I', cab, 60, minifat_inicio if mf else FIM)
    struct.pack_into('<I', cab, 64, minifat_n)
    struct.pack_into('<I', cab, 68, FIM)                 # primeiro setor de DIFAT
    struct.pack_into('<I', cab, 72, 0)                   # setores de DIFAT
    for k in range(109):
        v = fat_inicio + k if k < n_fat else LIVRE
        struct.pack_into('<I', cab, 76 + 4 * k, v)
    # versão 3 grava 0 aqui; o número de setores de diretório fica implícito
    struct.pack_into('<I', cab, 40, 0)
    _ = dir_n

    return bytes(cab) + b''.join(setores)
