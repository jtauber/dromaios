"""Publication checks: source fidelity and navigation are part of the contract."""

from html.parser import HTMLParser
from pathlib import Path
import re
import tempfile
import unittest
import xml.etree.ElementTree as ET

from markdown import Markdown

from check import check_site
from diagrams import state_diagram
from rendering import CHAPTERS, REPOSITORY, ChapterRendering, chapter_link, github_slug


class CpuBlocks(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.blocks, self.current = [], None
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        if tag == "code" and dict(attrs).get("class") == "language-cpu":
            self.current = []

    def handle_data(self, data):
        if self.current is not None:
            self.current.append(data)

    def handle_endtag(self, tag):
        if tag == "code" and self.current is not None:
            self.blocks.append("".join(self.current))
            self.current = None


class PublishingTests(unittest.TestCase):
    def test_every_cpu_block_survives_highlighting_verbatim(self):
        for path in CHAPTERS.glob("*.md"):
            with self.subTest(cpu=path.stem):
                source = path.read_text()
                expected = re.findall(r"^```cpu\n(.*?)^```$", source, re.M | re.S)
                markdown = Markdown(extensions=["fenced_code", ChapterRendering(path, "/", lambda *_: "/diagram.svg")])
                self.assertEqual(CpuBlocks(markdown.convert(source)).blocks, expected)

    def test_links_keep_chapters_local_and_repo_material_on_github(self):
        source = CHAPTERS / "8008.md"
        self.assertEqual(chapter_link("8080.md#stored-state", source, "/demo/"), "/demo/cpus/8080/#stored-state")
        self.assertEqual(chapter_link("#reset", source, "/"), "#reset")
        self.assertEqual(chapter_link("https://example.com/manual.pdf", source, "/"), "https://example.com/manual.pdf")
        self.assertEqual(chapter_link("../../../../docs/cpus/coverage.md#8008", source, "/"), f"{REPOSITORY}/blob/main/docs/cpus/coverage.md#8008")
        with self.assertRaises(ValueError):
            chapter_link("missing.md", source, "/")

    def test_references_are_rewritten_and_headings_keep_github_anchors(self):
        markdown = Markdown(extensions=["toc", ChapterRendering(CHAPTERS / "8008.md", "/demo/", lambda *_: "")], extension_configs={"toc": {"slugify": github_slug}})
        output = markdown.convert("## The programmer's machine\n\nSee [the other chip][chip].\n\n[chip]: 8080.md#stored-state")
        self.assertIn('id="the-programmers-machine"', output)
        self.assertIn('href="/demo/cpus/8080/#stored-state"', output)

    def test_cpu_source_cannot_become_markup(self):
        markdown = Markdown(extensions=[ChapterRendering(CHAPTERS / "8008.md", "/", lambda *_: "")])
        output = markdown.convert('```cpu\n// <script>alert("&")</script>\n```')
        self.assertNotIn("<script>", output)
        self.assertEqual(CpuBlocks(output).blocks, ['// <script>alert("&")</script>\n'])

    def test_storage_map_uses_the_given_schema_including_nested_fields(self):
        diagram = ET.fromstring(state_diagram({
            "accumulator": {"kind": "unsigned", "bits": 12},
            "saved": {"kind": "array", "length": 3, "element": {"bits": 20}},
            "alternate": {"kind": "group", "fields": {"carry": {"kind": "flag"}}},
            "mode": {"kind": "named-choice", "values": ["ready", "waiting"]},
            "stopped": {"kind": "boolean"},
        }))
        labels = [node.get("label") for node in diagram.iter()]
        self.assertIn("accumulator", labels)
        self.assertIn("saved · 3 × 20 bits", labels)
        self.assertIn("alternate", labels)
        self.assertIn("carry", labels)
        self.assertIn("mode · ready / waiting", labels)
        self.assertIn("stopped", labels)
        self.assertIn("12-bit registers", [node.text for node in diagram.iter("text")])

    def test_local_link_audit_catches_missing_fragments_and_assets(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            page = output / "index.html"
            page.write_text('<h1 id="heading">Title</h1><a href="/demo/#heading">Jump</a>')
            check_site(output, "/demo/")
            for bad in ('<a href="#absent">Missing</a>', '<img src="gone.svg">', '<a href="/">Wrong prefix</a>', '<b id="same"></b><i id="same"></i>'):
                with self.subTest(html=bad), self.assertRaises(ValueError):
                    page.write_text(bad)
                    check_site(output, "/demo/")


if __name__ == "__main__":
    unittest.main()
