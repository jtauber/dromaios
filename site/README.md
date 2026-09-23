# microcomputer.world

The reading site is branded **microcomputer.world**. Dromaios supplies the
processor models and executable chapters; it is credited alongside the site’s
other tools, Ryland and Sauvignon.

Ryland builds the home page and one page per executable CPU chapter. Sauvignon
renders both the chapters’ architecture diagrams and state maps derived from the
CPU compiler. The result is ordinary HTML, CSS, and SVG with no JavaScript,
CDN requests, or browser-side diagram rendering.

## Build and preview

Use Node 24 (as in the main project), Python 3.12 or later, and
[uv](https://docs.astral.sh/uv/getting-started/installation/). Python dependencies
are pinned in `pyproject.toml` and `uv.lock`; they are separate from the emulator’s
npm dependencies.

Sauvignon currently has no published Python distribution. Set `SAUVIGNON_PATH`
to an existing checkout containing the `sauvignon/` package. The site has been
checked with revision `b5a85cad3179e7cb087ee785c17b6547d2e80efd` (version 0.8.0).
It uses `compile_string`; the compiler’s source is not copied into this repository.

From the Dromaios root:

```sh
export SAUVIGNON_PATH=/path/to/sauvignon
npm run build:site
python3 -m http.server 8000 --directory site/output
```

Open [the local preview](http://localhost:8000/). The build installs its locked
Python dependencies in `site/.venv` on first use. It compiles the chapters directly
without generating or rebuilding emulator modules. Output lives in the ignored
`site/output/` directory; the next site build replaces that directory.

For a host under a project path, use:

```sh
npm run build:site -- --base /dromaios/
```

Serve the output at that path when previewing it. The build checks links using
the configured prefix. No deployment is configured in this change; the current
private Sauvignon dependency must be made available to a build host before
adding a public CI publishing workflow.

## Authoring

- Edit processor text, links, `cpu` blocks, and `sauvignon` diagram blocks in
  `src/components/cpus/specifications/*.md`. The site does not maintain copies.
- `chapters.ts` calls the existing CPU compiler and exports its validated state
  schemas and memory widths. `diagrams.py` draws storage maps from those schemas;
  they deliberately distinguish stored fields from physical architecture.
- Processor names, introduction years, and their ordering come from the existing
  coverage table. There is no separate website support inventory.
- `rendering.py` handles Markdown, highlights CPU definitions using the editor’s
  keyword vocabulary, and compiles Sauvignon fences. Ordinary code uses Pygments.
- Links to other CPU chapters stay within the site. Links to other repository
  material go to GitHub; external hardware references keep their original URLs.
- Edit page layout in `templates/` and presentation in `assets/style.css`.
  The site uses system fonts. Long code and tables scroll within the reading
  column; contents navigation and diagram disclosures work without JavaScript.

Sauvignon fences replace the earlier Mermaid diagrams. GitHub currently shows
these fences as source; the reading site displays the rendered diagrams and
provides expandable XML source and full-size SVG links.

## Checks

```sh
npm run test:site
npm run build:site
npm run build:site -- --base /dromaios/
```

The tests check lossless rendering of every CPU block, escaping, link rewriting,
state diagrams, and broken-link detection. Every site build compiles all CPU
chapters and diagrams, then checks every local link, fragment, image, and style
asset. Preview wide and narrow layouts when changing styles. The emulator’s
`npm test` suite remains independent of the Python toolchain and Sauvignon.
