#!/usr/bin/env python3
"""Gera dist/ — a versão que vai para o ar (Vercel).

O index.html desta pasta está no formato de Artifact: começa no <title>, sem
<!doctype>/<html>/<head>/<body>. Aqui ele é embrulhado num documento completo,
com as metas de busca e de compartilhamento, e img/ e media/ são copiadas ao lado.

Também monta dist/contrate/index.html — o currículo — a partir do mesmo
index.html mais os parciais contrate.html (marcação) e contrate.css: hero e
"Quem" saem, o currículo entra, e o resto (trabalhos, serviços, contato,
rodapé, scripts) é o mesmo. O vercel.json faz contrate.davimazzucatto.art
servir essa página na raiz.

O botão "Baixar currículo em PDF" aponta para curriculo/davi-mazzucatto-curriculo.pdf,
que sai de curriculo/curriculo.html via "node curriculo/gerar-pdf.js".

    python3 build.py                      # caminhos relativos
    python3 build.py https://dzin.com.br  # og:image e canonical absolutos
"""
import json
import shutil
import sys
from pathlib import Path

AQUI = Path(__file__).parent
DIST = AQUI / "dist"

TITULO = "Davi Mazzucatto"
DESCRICAO = ("Davi Mazzucatto — design, motion design, edição de vídeo e fotografia. "
             "Seu negócio merece um criativo à altura.")
OG_IMAGE = "img/retrato.webp"
SUB_CONTRATE = "contrate"
TITULO_CV = "Contrate Davi Mazzucatto"
DESCRICAO_CV = ("Currículo de Davi Mazzucatto: 20 anos, Birigui (SP), design, motion design, "
                "edição de vídeo e fotografia. Disponível para Birigui, Araçatuba ou remoto.")

CABECA = """<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="{descricao}">
<meta name="theme-color" content="#F4F4F4">
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
<link rel="icon" href="{icone}">
<style>*{{box-sizing:border-box}}body{{margin:0}}img{{max-width:100%}}[hidden]{{display:none!important}}</style>
"""


def documento(fragmento: str, titulo: str, descricao: str, site: str) -> str:
    """Embrulha um fragmento no formato de Artifact num documento completo."""
    og = f"{site}/{OG_IMAGE}" if site else OG_IMAGE
    canonical = f'<link rel="canonical" href="{site}/">\n' if site else ""
    corpo, _, resto = fragmento.partition("</style>")
    cabeca = CABECA.format(titulo=titulo, descricao=descricao, og_image=og, canonical=canonical, icone=OG_IMAGE)
    return f"{cabeca}{corpo}</style>\n</head>\n<body>{resto}</body>\n</html>\n"


def pagina_curriculo(fragmento: str) -> str:
    """Troca hero + Quem pelo currículo; nav aponta para #curriculo."""
    css = (AQUI / "contrate.css").read_text(encoding="utf-8")
    marcacao = (AQUI / "contrate.html").read_text(encoding="utf-8")
    f = fragmento.replace("<title>Davi Mazzucatto</title>", f"<title>{TITULO_CV}</title>", 1)
    f = f.replace("</style>", css + "</style>", 1)
    inicio = f.index("<main>") + len("<main>")
    fim = f.index('  <section class="sec wrap" id="trabalhos"')
    f = f[:inicio] + "\n" + marcacao + "\n" + f[fim:]
    f = f.replace('<a href="#quem">Quem</a>', '<a href="#curriculo">Currículo</a>')
    f = f.replace('<li><a href="#quem">Quem</a></li>', '<li><a href="#curriculo">Currículo</a></li>')
    return f


def main() -> None:
    site = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else ""
    site_cv = site.replace("https://", f"https://{SUB_CONTRATE}.") if site else ""
    fragmento = (AQUI / "index.html").read_text(encoding="utf-8")

    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()
    (DIST / "index.html").write_text(documento(fragmento, TITULO, DESCRICAO, site), encoding="utf-8")
    (DIST / SUB_CONTRATE).mkdir()
    # caminhos de mídia absolutos: a página é servida tanto em /contrate/ quanto na raiz do subdomínio
    cv = documento(pagina_curriculo(fragmento), TITULO_CV, DESCRICAO_CV, site_cv)
    for pasta in ("img/", "media/"):
        cv = cv.replace(f'"{pasta}', f'"/{pasta}').replace(f"'{pasta}", f"'/{pasta}")
    (DIST / SUB_CONTRATE / "index.html").write_text(cv, encoding="utf-8")
    # o subdomínio do currículo serve /contrate/index.html na raiz; img/ e media/ continuam na raiz
    (DIST / "vercel.json").write_text(json.dumps({"rewrites": [
        {"source": "/", "has": [{"type": "host", "value": f"{SUB_CONTRATE}.davimazzucatto.art"}], "destination": f"/{SUB_CONTRATE}/index.html"},
    ]}, indent=1), encoding="utf-8")
    shutil.copytree(AQUI / "img", DIST / "img")
    # PDF do currículo (gerado por curriculo/gerar-pdf.js), baixado pelo botão da página contrate
    pdf = AQUI / "curriculo" / "davi-mazzucatto-curriculo.pdf"
    if pdf.exists():
        (DIST / "curriculo").mkdir()
        shutil.copy2(pdf, DIST / "curriculo" / pdf.name)
    if (AQUI / "media").exists():
        shutil.copytree(AQUI / "media", DIST / "media")

    total = sum(f.stat().st_size for f in DIST.rglob("*") if f.is_file())
    print(f"dist/ pronto — {total/1024:.0f} KB" + (f", canonical em {site} e {site_cv}" if site else ", caminhos relativos"))


if __name__ == "__main__":
    main()
