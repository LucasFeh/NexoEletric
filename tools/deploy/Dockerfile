# Imagem do hub. Ela carrega SO o interpretador e as dependencias; o codigo
# entra por bind mount de /srv/altiumhub/current. Consequencia pratica: um
# deploy normal nao reconstroi imagem nenhuma, e so precisa de --build quando
# o requirements.txt muda.
FROM python:3.12-slim

# tzdata: sem ela o TZ do compose nao tem o que ler e o container fica em UTC,
#         o que joga 3 h em cima de toda data do hub.
# curl:   e o healthcheck do compose.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata curl \
 && rm -rf /var/lib/apt/lists/*

# UID fixo. Os mesmos arquivos que este processo escreve sao servidos por Samba
# para o Windows, entao o dono tem que casar com o usuario altiumhub do host --
# senao o Altium grava board.js e o hub nao consegue reescrever, ou o contrario.
ARG UID=1500
ARG GID=1500
RUN groupadd -g ${GID} altiumhub \
 && useradd -u ${UID} -g ${GID} -M -s /usr/sbin/nologin altiumhub

COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt && rm /tmp/requirements.txt

USER altiumhub
WORKDIR /srv/altiumhub/current
CMD ["python", "hubserver.py", "--port", "8100"]
