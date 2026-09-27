# microcomputer.world

**microcomputer.world** presents interactive lessons and guides to classic processors. Dromaios supplies
the processor models and executable specifications; it is credited alongside
the site’s other tools, Ryland and Sauvignon.

Ryland builds the home page, the introductory lessons, and one guide per processor from its executable
specification. Sauvignon renders both architecture diagrams and state maps
derived from the CPU compiler. Pages use ordinary HTML, CSS, and SVG, with
small TypeScript modules for the lesson interactions. Processor guides need no
JavaScript; diagrams are rendered during the build. No CDN requests are needed.

## Build and preview

Use Node 24 (as in the main project), Python 3.12 or later, and
[uv](https://docs.astral.sh/uv/getting-started/installation/). Python dependencies
are pinned in `pyproject.toml` and `uv.lock`; they are separate from the emulator’s
npm dependencies.

Sauvignon currently has no published Python distribution. Set `SAUVIGNON_PATH`
to an existing checkout containing the `sauvignon/` package. Automated builds use
the exact revision pinned in the [Pages workflow](../.github/workflows/pages.yml);
use the same revision locally when checking a release. The site uses
`compile_string`; the compiler’s source is not copied into this repository.

From the Dromaios root:

```sh
export SAUVIGNON_PATH=/path/to/sauvignon
npm ci
npm run build:site
python3 -m http.server 8000 --directory site/output
```

Open [the local preview](http://localhost:8000/). The build installs its locked
Python dependencies in `site/.venv` on first use. It regenerates CPU and machine
sources so a clean checkout has current schemas and factories, then compiles
only the browser entry point and its imports into `dist/site/`. The memory
lesson imports its generated factory and the shared RAM component. The register
lesson dynamically imports its controller and generated 8080 machine; the
preceding lessons do not load CPU runtime modules. Chapters are rendered
directly from their specifications. The site copies browser modules into a directory named
by their combined content hash, preserving relative imports and invalidating
cached dependencies together. Output lives in the ignored
`site/output/` directory; the next site build replaces that directory.

For a host under a project path, use:

```sh
npm run build:site -- --base /dromaios/
```

Serve the output at that path when previewing it. The build checks links using
the configured prefix. The publishing workflow reads its base path from GitHub
Pages, using `/` for the custom domain and `/dromaios/` for the default project URL.

## Automated publishing

The [Pages workflow](../.github/workflows/pages.yml) builds on pushes to `main`
and can also be run manually from `main`. It checks out the pinned Sauvignon
revision with a dedicated read-only SSH deploy key, installs locked dependencies,
runs the site tests, compiles the complete site, and checks its local links.
Only `site/output/` is uploaded. The private compiler stays outside that artifact.
A separate deploy job receives Pages write and OIDC permissions after the build
succeeds; publishing runs are serialized.

The [CI workflow](../.github/workflows/ci.yml) also runs the site tests on pull
requests, including forks. These tests require neither Sauvignon nor secrets.
The complete diagram build runs only in the trusted publishing workflow.

### Repository setup

These settings must exist before the publishing workflow can run:

1. Create a `site-build` environment in `jtauber/dromaios`, with deployment branch
   rules allowing only the `main` branch (no tags). Add a dedicated **read-only**
   deploy key to `jtauber/sauvignon-new`; save its private half as the environment
   secret `SAUVIGNON_DEPLOY_KEY`. Its only recipient is the protected Dromaios
   site build. It grants no write access to Sauvignon and no access to other repos.
2. Create a `github-pages` environment, also restricted to the `main` branch.
   The deployment uses the workflow's temporary GitHub token, not the SSH key.
3. Set the Dromaios repository’s Pages source to **GitHub Actions**. Set its
   custom domain to `microcomputer.world` before pointing DNS at GitHub.
4. Configure DNS as below. After GitHub provisions the certificate, enable
   **Enforce HTTPS** in the Pages settings.

Use the repository’s [Pages settings](https://github.com/jtauber/dromaios/settings/pages)
and [environments](https://github.com/jtauber/dromaios/settings/environments).
See GitHub’s [custom workflow guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
for the artifact/deployment contract.

### Domain and HTTPS

For the domain’s current Name.com DNS service, replace the apex parking A record
with these four A records and add the `www` CNAME:

| Type | Name.com Host | Answer |
| --- | --- | --- |
| A | *(leave blank)* | `185.199.108.153` |
| A | *(leave blank)* | `185.199.109.153` |
| A | *(leave blank)* | `185.199.110.153` |
| A | *(leave blank)* | `185.199.111.153` |
| CNAME | `www` | `jtauber.github.io` |

Name.com uses an empty Host field for an apex A record; see its
[A record instructions](https://www.name.com/support/articles/115004893508-adding-an-a-record).
The addresses and `www` target follow GitHub’s
[custom-domain instructions](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).
The canonical site is `https://microcomputer.world/`; GitHub redirects the
configured `www` alias to it. DNS and certificate provisioning may take time,
so verify both hostnames before considering publishing complete.

For domain verification, add `microcomputer.world` in the GitHub account’s
[Pages settings](https://github.com/settings/pages) and retain the TXT record
GitHub supplies. Use the account-specific TXT value shown there. See
[GitHub’s verification instructions](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages).

After setup and a reviewed commit, the next push to `main` publishes the site.
To republish the same source, run the **Pages** workflow manually. To roll back,
review and revert the relevant source change on `main`, then let that push build
and deploy. The site follows the same maintainer-review rule as other changes.

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
- The first lesson is `templates/bits-and-numbers.html`. Its reusable byte
  explorer is a template macro in `templates/instruments/byte-explorer.html`,
  enhanced by `interactive/byte-explorer.ts`. Each instance owns its value and
  controls. The browser code has a separate DOM-aware TypeScript configuration;
  simulation code keeps its existing environment-independent checks.
- The byte explorer links unsigned binary, decimal, and hexadecimal forms,
  shows place values and their sum, and groups bits into hexadecimal digits.
  Valid edits update the other representations; invalid drafts retain the
  previous byte and display an explanation. Without scripting, a readable
  example remains with disabled controls. Keyboard users can toggle bits with
  Space or Enter and edit the number fields normally.
- `interactive/lessons.ts` mounts each explorer once, using the appropriate
  controller for its lesson. `templates/byte-wraparound.html` reuses that explorer to add one repeatedly.
  The controller exposes its value, validity, and a programmatic setter; an edit
  callback lets the lesson clear the previous calculation. The lesson shows
  the full sum, the carry out of the byte, and the stored eight bits. Each step
  uses the current byte; restarting restores 254. Valid manual edits clear the
  calculation, while invalid drafts disable addition and preserve the last
  completed step. This is an arithmetic illustration, not a CPU instruction
  or a model of a processor's carry flag.
- `templates/memory.html` and `interactive/memory-explorer.ts` teach addresses
  and contents. The controller imports the factory generated from
  [`eight-byte-memory.machine`](../src/machines/lessons/eight-byte-memory.machine).
  The RAM owns the bytes; the controller owns the selection and views. Valid
  edits write only the selected address. Invalid drafts leave RAM unchanged;
  selecting an address reloads its stored byte and discards any invalid draft.
  Starting again constructs fresh RAM. Reading these RAM locations has no side
  effects; this is not a general-purpose inspector for memory-mapped devices.
- `interactive/memory-editor.ts` shares the selectable RAM view and byte editor
  between the memory and register lessons. It observes the current RAM through a
  callback so restarting can replace the machine. A visible byte count bounds
  both selection and edits; no instruction bytes are editable in the register lesson.
- `templates/register.html` and `templates/add-one.html` use the shared
  `templates/instruments/register-explorer.html` and
  `interactive/register-explorer.ts` for the [8080 register lesson](../docs/cpus/8080/examples/register.md)
  and [add-one lesson](../docs/cpus/8080/examples/add-one.md). A is read-only
  and comes from CPU snapshots; each action calls `step()` once. The controller
  uses PC to enable the next action and stops at the program's end. The optional
  disclosure shows bytes, PC changes, and accesses from the last CPU record.
  Editing memory preserves that record. Starting again constructs a fresh
  machine rather than invoking CPU reset. The add-one lesson inserts `ADI 1`
  between load and store, displays CY from CPU state, and retains the last
  addition separately from the latest instruction record. The full sum explains
  the calculation; A and carry come from execution, not a parallel simulation.

Sauvignon fences replace the earlier Mermaid diagrams. GitHub currently shows
these fences as source; the site displays the rendered diagrams and
provides expandable XML source and full-size SVG links.

## Checks

```sh
npm run test:site
npm run build:site
npm run build:site -- --base /dromaios/
```

The tests type-check the browser code and check lossless rendering of every CPU block, escaping, link rewriting,
state diagrams, and broken-link detection. Every site build compiles all CPU
chapters and diagrams, then checks every local link, fragment, image, and style
asset. Preview wide and narrow layouts when changing styles. For the byte
explorer, check bit toggles, keyboard operation, zero and 255, lowercase hex,
invalid and empty inputs (including tabbing through another field), and recovery
after an invalid edit. For wraparound,
check 254 → 255 → 0 → 1, carries within the byte (15 → 16 and 127 → 128),
restarting, and manual edits after an addition. For memory, store different bytes
at addresses 3 and 4, switch back and forth, try invalid edits, clear one byte,
and start again. Check that selection never writes, other addresses retain their
values, and the address controls work with the keyboard. For the register lesson,
check the default 200 → A → address 4 sequence, source changes before and after
loading, destination changes before storing, invalid drafts, both completed
instructions, restart, keyboard focus, and the recorded accesses. For add-one,
check 41 → 42, 255 → 0 with CY = 1, and 127 → 128 with CY = 0. Change source
memory after loading and destination memory before storing; verify that A and
CY remain independent, and the last addition survives the store and memory
edits. Restart after carry and while an invalid draft is present. Check that
preceding lessons still work and do not request CPU runtime modules. The emulator’s
`npm test` suite remains independent of the Python toolchain and Sauvignon.
