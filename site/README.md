# microcomputer.world

**microcomputer.world** presents guides to classic processors. Dromaios supplies
the processor models and executable specifications; it is credited alongside
the site’s other tools, Ryland and Sauvignon.

Ryland builds the home page and one guide per processor from its executable
specification. Sauvignon renders both architecture diagrams and state maps
derived from the CPU compiler. The result is ordinary HTML, CSS, and SVG with no JavaScript,
CDN requests, or browser-side diagram rendering.

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

Sauvignon fences replace the earlier Mermaid diagrams. GitHub currently shows
these fences as source; the site displays the rendered diagrams and
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
