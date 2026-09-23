"""Fail a site build on broken local links, fragments, assets, or duplicate ids."""

from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit


class Page(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.ids, self.links = set(), []
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "id" in attrs:
            identity = attrs["id"]
            if identity in self.ids:
                raise ValueError(f"Duplicate HTML id: {identity}")
            self.ids.add(identity)
        for name in ("href", "src"):
            if name in attrs:
                self.links.append(attrs[name])


def check_site(output, base):
    pages = {path: Page(path.read_text()) for path in output.rglob("*.html")}
    count = 0
    for source, page in pages.items():
        url = base + source.relative_to(output).as_posix()
        for href in page.links:
            target = urlsplit(urljoin(url, href))
            if target.scheme or target.netloc:
                continue
            if not target.path.startswith(base):
                raise ValueError(f"{source}: link escapes site base: {href}")
            path = output / unquote(target.path.removeprefix(base))
            if path.is_dir():
                path /= "index.html"
            if not path.is_file():
                raise ValueError(f"{source}: missing local target {href}")
            if target.fragment and path in pages and unquote(target.fragment) not in pages[path].ids:
                raise ValueError(f"{source}: missing fragment {href}")
            count += 1
    print(f"Checked {len(pages)} pages and {count} local links/assets.")
