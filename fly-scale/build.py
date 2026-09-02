#!/usr/bin/env python3
"""
Gera dist/index.html com as mídias embutidas como data URI.

Por que existe: o index.html referencia media/ e img/ por caminho relativo, que é o
que serve num domínio próprio. O Artifact do claude.ai não resolve caminho relativo
e bloqueia host externo por CSP, então a versão publicada precisa das mídias inline.

    python3 build.py

Arquivo que não existe é ignorado — o índice continua referenciando o caminho e a
página esconde o bloco sozinha (ver o script no fim do index.html).
"""
import base64
import io
import mimetypes
import os
import re
import sys

RAIZ = os.path.dirname(os.path.abspath(__file__))
FONTE = os.path.join(RAIZ, "index.html")
SAIDA = os.path.join(RAIZ, "dist", "index.html")

# o vídeo pesado fica para produção; no artifact entra a versão leve
SUBSTITUI = {"media/convite.mp4": "media/convite-embed.mp4"}

# não faz sentido embutir estes
IGNORA = {"media/convite-embed.mp4"}


def data_uri(caminho_rel: str) -> str | None:
    real = SUBSTITUI.get(caminho_rel, caminho_rel)
    absoluto = os.path.join(RAIZ, real)
    if not os.path.isfile(absoluto):
        return None
    tipo = mimetypes.guess_type(absoluto)[0] or "application/octet-stream"
    with open(absoluto, "rb") as fh:
        return "data:%s;base64,%s" % (tipo, base64.b64encode(fh.read()).decode("ascii"))


def main() -> int:
    html = io.open(FONTE, encoding="utf-8").read()

    # pega src="media/..." e src="img/..." dentro de img/video/source
    alvos = sorted(set(re.findall(r'src="((?:media|img)/[^"]+)"', html)))
    embutidos, ausentes = [], []

    for rel in alvos:
        if rel in IGNORA:
            continue
        uri = data_uri(rel)
        if uri is None:
            ausentes.append(rel)
            continue
        html = html.replace('src="%s"' % rel, 'src="%s"' % uri)
        embutidos.append(rel)

    # o poster do vídeo não vem no src
    for m in sorted(set(re.findall(r'poster="((?:media|img)/[^"]+)"', html))):
        uri = data_uri(m)
        if uri is None:
            ausentes.append(m)
        else:
            html = html.replace('poster="%s"' % m, 'poster="%s"' % uri)
            embutidos.append(m)

    os.makedirs(os.path.dirname(SAIDA), exist_ok=True)
    io.open(SAIDA, "w", encoding="utf-8").write(html)

    mb = len(html.encode("utf-8")) / 1048576
    print("embutidos (%d): %s" % (len(embutidos), ", ".join(embutidos) or "-"))
    print("ausentes  (%d): %s" % (len(ausentes), ", ".join(ausentes) or "-"))
    print("dist/index.html: %.2f MB" % mb)
    if mb > 15:
        print("ATENCAO: passou de 15 MB; o limite do Artifact e 16 MB.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
