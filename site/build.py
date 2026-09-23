#!/usr/bin/env python3
"""Build a static reading site from the executable CPU chapters."""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys

from jinja2 import select_autoescape
from markdown import Markdown
from markupsafe import Markup
from pygments.formatters import HtmlFormatter
from ryland import Ryland

from check import check_site
from diagrams import state_diagram
from rendering import CHAPTERS, REPOSITORY, ChapterRendering, github_slug

SITE = Path(__file__).resolve().parent
ROOT = SITE.parent


def sauvignon_compiler():
    checkout = os.environ.get("SAUVIGNON_PATH")
    if checkout:
        sys.path.insert(0, str(Path(checkout).expanduser().resolve()))
    try:
        from sauvignon import compile_string
    except ModuleNotFoundError as error:
        raise SystemExit("Set SAUVIGNON_PATH to a Sauvignon checkout (see site/README.md).") from error
    return compile_string


def site_base(value):
    if not re.fullmatch(r"/(?:[A-Za-z0-9_-]+/)*", value):
        raise argparse.ArgumentTypeError("Use / or a path with leading and trailing slashes, such as /dromaios/.")
    return value


def chapter_catalogue():
    result = subprocess.run(["node", str(SITE / "chapters.ts")], cwd=ROOT, check=True, stdout=subprocess.PIPE, text=True)
    chapters = {chapter["slug"]: chapter for chapter in json.loads(result.stdout)}
    # The coverage document already owns introduction years and their ordering.
    rows = re.findall(r"^\| \[([^]]+)\]\(#([a-z0-9]+)\) \| (\d{4}) \|", (ROOT / "docs/cpus/coverage.md").read_text(), re.M)
    if len(rows) != len(chapters) or {slug for _, slug, _ in rows} != chapters.keys():
        raise ValueError("The coverage table and discovered CPU chapters must agree.")
    return [{**chapters[slug], "title": title, "year": year, "url": f"cpus/{slug}/"} for title, slug, year in rows]


def build(base):
    compile_diagram = sauvignon_compiler()
    chapters = chapter_catalogue()
    site = Ryland(output_dir=SITE / "output", template_dir=SITE / "templates", url_root=base)
    site.jinja_env.autoescape = select_autoescape(["html"])
    site.clear_output()
    site.copy_to_output(SITE / "assets", "assets")
    site.write_output("assets/highlight.css", HtmlFormatter(style="friendly").get_style_defs(".code-block"))
    site.add_hash("assets/style.css")
    site.set_global("chapters", chapters)
    site.set_global("repository", REPOSITORY)

    def diagram(source, filename):
        site.write_output(f"assets/diagrams/{filename}.svgn", source)
        site.write_output(f"assets/diagrams/{filename}.svg", compile_diagram(source))
        return site.calc_url(f"assets/diagrams/{filename}.svg")

    for index, chapter in enumerate(chapters):
        slug = chapter["slug"]
        source = CHAPTERS / f"{slug}.md"
        title, _, body = source.read_text().partition("\n")
        if title != f'# {chapter["title"]}':
            raise ValueError(f"{source}: title differs from the coverage table")
        markdown = Markdown(extensions=[
            "tables", "fenced_code", "codehilite", "toc",
            ChapterRendering(source, base, diagram),
        ], extension_configs={
            "toc": {"slugify": github_slug, "toc_depth": "2-2"},
            "codehilite": {"css_class": "code-block", "guess_lang": False},
        })
        content = markdown.convert(body)
        chapter["diagram"] = diagram(state_diagram(chapter["state"]), f"{slug}-state")
        site.render_template("chapter.html", f"{chapter['url']}index.html", {
            **chapter, "content": Markup(content), "toc": markdown.toc_tokens,
            "source_url": f"{REPOSITORY}/blob/main/{source.relative_to(ROOT)}",
            "previous": chapters[index - 1] if index else None,
            "next": chapters[index + 1] if index + 1 < len(chapters) else None,
        })
    site.render_template("home.html", "index.html", {
        "title": "Computers, from the instruction up",
        "hero_diagram": diagram(state_diagram(chapters[0]["state"], width=400), "8008-state-compact"),
    })
    check_site(site.output_dir, base)
    print(f"Built home + {len(chapters)} CPU chapters in {site.output_dir} (base {base}).")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=site_base, default="/", help="URL path prefix, including both slashes")
    build(parser.parse_args().base)
