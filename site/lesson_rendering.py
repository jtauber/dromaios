"""Publish the same parsed BASIC conversations that the interpreter tests execute."""

import html
import json
from pathlib import Path
import re
import subprocess

from markdown import Markdown
from markdown.extensions import Extension
from markdown.preprocessors import Preprocessor
from rendering import ChapterRendering, github_slug


def basic_lesson_catalogue():
    script = Path(__file__).resolve().parent / "basic-lessons.ts"
    result = subprocess.run(["node", str(script)], check=True, stdout=subprocess.PIPE, text=True)
    return {lesson["slug"]: lesson for lesson in json.loads(result.stdout)}


def lesson_markdown(source, base, sessions=()):
    return Markdown(extensions=[
        "tables", "fenced_code", "toc", "attr_list",
        ChapterRendering(source, base, lambda *_: ""), BasicLessonRendering(sessions),
    ], extension_configs={"toc": {"slugify": github_slug}})


class BasicSessions(Preprocessor):
    def __init__(self, md, sessions):
        super().__init__(md)
        self.sessions = sessions

    def run(self, lines):
        def render(match):
            turns = self.sessions[int(match[1])]
            parts, inputs = [], []

            def flush_inputs():
                if inputs:
                    label = "Type, then Enter" if len(inputs) == 1 else "Type one line at a time, then Enter"
                    parts.append(f'<p class="basic-example-label">{label}</p><pre><code class="language-basic">'
                                 + html.escape("\n".join(inputs)) + '</code></pre>')
                    inputs.clear()

            for turn in turns:
                inputs.append(turn["input"])
                if turn["output"]:
                    flush_inputs()
                    parts.append('<p class="basic-example-label">BASIC replies</p><pre>'
                                 + html.escape(turn["output"]) + '</pre>')
            flush_inputs()
            block = '<div class="basic-example">' + "".join(parts) + '</div>'
            return "\n" + self.md.htmlStash.store(block) + "\n"

        return re.sub(r"^<!-- basic-session:(\d+) -->$", render, "\n".join(lines), flags=re.M).split("\n")


class BasicLessonRendering(Extension):
    def __init__(self, sessions):
        super().__init__()
        self.sessions = sessions

    def extendMarkdown(self, md):
        md.preprocessors.register(BasicSessions(md, self.sessions), "basic-sessions", 27)
