"""Render the authored chapter without giving the website its own CPU grammar."""

from pathlib import Path
import html
import re
from urllib.parse import quote, unquote, urlsplit, urlunsplit

from markdown.extensions import Extension
from markdown.preprocessors import Preprocessor
from markdown.treeprocessors import Treeprocessor
from pygments import highlight
from pygments.formatters import HtmlFormatter
from pygments.lexer import RegexLexer, words
from pygments.lexers import XmlLexer
from pygments.token import Comment, Keyword, Name, Number, Operator, Punctuation, String, Text
from machines import MACHINES
from lessons import BASIC_LESSONS

ROOT = Path(__file__).resolve().parent.parent
CHAPTERS = ROOT / "src/components/cpus/specifications"
REPOSITORY = "https://github.com/jtauber/dromaios"
# The editor already owns the highlighted keyword vocabulary.
QUERY = (ROOT / "editors/zed/languages/cpu/highlights.scm").read_text()
KEYWORDS = re.findall(r'"(\w+)"', QUERY.split("] @keyword", 1)[0])


class CpuLexer(RegexLexer):
    name = "Dromaios CPU"
    tokens = {"root": [
        (r"//[^\n]*", Comment.Single),
        (r'"(?:\\.|[^"\\])*"', String),
        (words(KEYWORDS, suffix=r"\b"), Keyword),
        (r"\$[\da-fA-F]+|0[bB][01_]+|\b\d+\b", Number),
        (r"\b[A-Z][A-Z\d_]*\b", Name.Constant),
        (r"[a-zA-Z_][\w]*", Name),
        (r"<-|=", Operator),
        (r"[{}\[\]():,.<>]", Punctuation),
        (r"\s+|.", Text),
    ]}


class MachineLexer(RegexLexer):
    name = "Dromaios machine"
    query = (ROOT / "editors/zed/languages/machine/highlights.scm").read_text()
    keywords = re.findall(r'"([\w-]+)"', query.split("] @keyword", 1)[0]) + ["ram"]
    tokens = {"root": [
        (r"//[^\n]*", Comment.Single),
        (words(keywords, suffix=r"\b"), Keyword),
        (r"\b[0-9][0-9a-fA-F]*\b", Number),
        (r"\b[A-Z][A-Z\d_]*\b", Name.Constant),
        (r"=", Operator), (r"[{}\[\]]", Punctuation), (r"\s+|.", Text),
    ]}


# CPU, machine, and Sauvignon fences in the chapters are top-level fenced blocks. Other
# languages go through Python-Markdown's ordinary fenced-code extension.
FENCE = re.compile(r"^```(cpu|machine|sauvignon) *\n(.*?)^``` *$", re.M | re.S)


class ChapterFences(Preprocessor):
    def __init__(self, md, source, diagram):
        super().__init__(md)
        self.source, self.diagram, self.count = source, diagram, 0

    def run(self, lines):
        def render(match):
            language, source = match.groups()
            if language in ("cpu", "machine"):
                lexer = CpuLexer if language == "cpu" else MachineLexer
                code = highlight(source, lexer(stripnl=False, ensurenl=False), HtmlFormatter(nowrap=True))
                block = f'<div class="code-block"><pre tabindex="0"><code class="language-{language}">{code}</code></pre></div>'
            else:
                self.count += 1
                url = self.diagram(source, f"{self.source.stem}-architecture-{self.count}")
                code = highlight(source, XmlLexer(), HtmlFormatter(nowrap=True))
                block = (f'<figure class="architecture-diagram"><a href="{html.escape(url)}">'
                         f'<img src="{html.escape(url)}" alt="Processor architecture: registers, operations, and their connections."></a>'
                         '<figcaption>Architecture diagram · drawn with Sauvignon. Select to enlarge.</figcaption>'
                         '<details><summary>Diagram source</summary>'
                         f'<div class="code-block"><pre tabindex="0"><code class="language-xml">{code}</code></pre></div></details></figure>')
            return "\n" + self.md.htmlStash.store(block) + "\n"
        return FENCE.sub(render, "\n".join(lines)).split("\n")


def github_slug(text, separator):
    # Retain underscores (GitHub does), discard punctuation, retain Unicode.
    return re.sub(r"\s", separator, re.sub(r"[^\w\s-]", "", text).lower())


def chapter_link(href, source, base):
    url = urlsplit(href)
    if url.scheme or url.netloc or not url.path:
        return href
    destination = (source.parent / unquote(url.path)).resolve()
    if not destination.is_relative_to(ROOT) or not destination.exists():
        raise ValueError(f"{source.name}: missing linked source {href}")
    if destination in MACHINES:
        path = f"{base}{MACHINES[destination]}"
    elif destination.parent == BASIC_LESSONS and destination.suffix == ".md":
        path = f"{base}learn/{destination.stem}/"
    elif destination.parent == CHAPTERS and destination.suffix == ".md":
        path = f"{base}cpus/{destination.stem}/"
    else:
        kind = "tree" if destination.is_dir() else "blob"
        path = f"{REPOSITORY}/{kind}/main/{quote(destination.relative_to(ROOT).as_posix())}"
    return urlunsplit(("", "", path, url.query, url.fragment))


class ChapterLinks(Treeprocessor):
    def __init__(self, md, source, base):
        super().__init__(md)
        self.source, self.base = source, base

    def run(self, root):
        for link in root.iter("a"):
            if "href" in link.attrib:
                link.set("href", chapter_link(link.get("href"), self.source, self.base))
        for image in root.iter("img"):
            # Chapters currently have no image files; fail rather than publish
            # an unhandled relative image if one is added.
            if not urlsplit(image.get("src", "")).scheme:
                raise ValueError(f"{self.source.name}: relative images need an asset copy rule")


class ChapterRendering(Extension):
    def __init__(self, source, base, diagram):
        super().__init__()
        self.source, self.base, self.diagram = source, base, diagram

    def extendMarkdown(self, md):
        md.preprocessors.register(ChapterFences(md, self.source, self.diagram), "chapter-fences", 26)
        md.treeprocessors.register(ChapterLinks(md, self.source, self.base), "chapter-links", 5)
