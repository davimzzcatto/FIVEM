#!/usr/bin/env python3
"""Gera dist/ — a versão que vai para o ar (Vercel, Netlify, qualquer host estático).

O index.html desta pasta está no formato de Artifact: começa no <title>, sem
<!doctype>/<html>/<head>/<body>. Aqui ele é embrulhado num documento completo,
com as metas de busca e de compartilhamento, e a pasta img/ é copiada ao lado.

    python3 build.py                      # caminhos relativos
    python3 build.py https://dzin.com.br  # og:image e canonical absolutos
"""
import shutil
import sys
from pathlib import Path

AQUI = Path(__file__).parent
DIST = AQUI / "dist"

TITULO = "dzin.raw"
DESCRICAO = ("dzin.raw — design, motion e edição. "
             "Seu negócio merece um criativo à altura.")
OG_IMAGE = "img/retrato.webp"

CABECA = """<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="{descricao}">
<meta name="theme-color" content="#04070F">
{canonical}<meta property="og:type" content="website">
<meta property="og:locale" content="pt_BR">
<meta property="og:site_name" content="{titulo}">
<meta property="og:title" content="{titulo}">
<meta property="og:description" content="{descricao}">
<meta property="og:image" content="{og_image}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{titulo}">
<meta name="twitter:description" content="{descricao}">
<meta name="twitter:image" content="{og_image}">
<link rel="icon" href="img/retrato.webp">
<style>*{{box-sizing:border-box}}body{{margin:0}}img{{max-width:100%}}[hidden]{{display:none!important}}</style>
"""


def main() -> None:
    site = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else ""
    og = f"{site}/{OG_IMAGE}" if site else OG_IMAGE
    canonical = f'<link rel="canonical" href="{site}/">\n' if site else ""

    fragmento = (AQUI / "index.html").read_text(encoding="utf-8")
    corpo, _, resto = fragmento.partition("</style>")
    cabeca = CABECA.format(titulo=TITULO, descricao=DESCRICAO,
                           og_image=og, canonical=canonical)
    pagina = f"{cabeca}{corpo}</style>\n</head>\n<body>{resto}</body>\n</html>\n"

    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()
    (DIST / "index.html").write_text(pagina, encoding="utf-8")
    shutil.copytree(AQUI / "img", DIST / "img")

    total = sum(f.stat().st_size for f in DIST.rglob("*") if f.is_file())
    print(f"dist/ pronto — {total/1024:.0f} KB"
          + (f", canonical em {site}" if site else ", caminhos relativos"))


if __name__ == "__main__":
    main()
