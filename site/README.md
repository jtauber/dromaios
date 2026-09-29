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
- `templates/register.html`, `templates/add-one.html`, `templates/program.html`,
  `templates/change-program.html`, `templates/jump.html`, `templates/loop.html`,
  `templates/conditional-loop.html`, `templates/countdown.html`, and
  `templates/comparison.html` use the shared
  `templates/instruments/register-explorer.html` and
  `interactive/register-explorer.ts` for the [8080 register lesson](../docs/cpus/8080/examples/register.md)
  and its [add-one](../docs/cpus/8080/examples/add-one.md),
  [stored-program](../docs/cpus/8080/examples/program.md),
  [program-editing](../docs/cpus/8080/examples/change-program.md),
  [jump](../docs/cpus/8080/examples/jump.md),
  [loop](../docs/cpus/8080/examples/loop.md),
  [conditional-loop](../docs/cpus/8080/examples/conditional-loop.md),
  [countdown](../docs/cpus/8080/examples/countdown.md), and
  [comparison](../docs/cpus/8080/examples/comparison.md) successors.
  The template selects a `copy`, `add-one`, `jump`, `loop`, `conditional-loop`,
  `countdown`, or `comparison` machine layout. A is read-only and comes from CPU snapshots;
  each action calls `step()` once. The controller uses PC to enable the next
  action and stops at a declared completion address.
  The unconditional loop has no completion address; every press still executes
  just one instruction. The optional disclosure shows bytes, PC changes, and
  accesses from the last CPU record. Editing memory preserves that record.
  Starting again constructs a fresh machine rather than invoking CPU reset.
  The add-one lesson inserts `ADI 1`
  between load and store, displays CY from CPU state, and retains the last
  addition separately from the latest instruction record. The full sum explains
  the calculation; A and carry come from execution, not a parallel simulation.
- `interactive/register-programs.ts` holds the machine factories, instruction
  layouts, editable operand locations, selected flag, and explanations for these
  known programs. The flag display defaults to CY; countdown and comparison select Z.
  The descriptions never execute an instruction or calculate its result.
  `interactive/register-explorer.ts` owns the shared controls and reads actual
  CPU records. There is no parser or general disassembler in the browser.
- `interactive/program-view.ts` reveals the instructions for the stored-program,
  program-editing, jump, and loop lessons. It reads bytes
  from RAM on each render, marks the next instruction using CPU state, and
  highlights fetches using the record's `instruction` field rather than every
  memory read. Its labels and grouping
  describe the known program; it is not a general disassembler. A single Step
  button advances the CPU. The program-editing lesson adds a decimal operand
  field that writes RAM at `0104` before the first step. Its value updates the
  displayed bytes and addition labels; invalid drafts retain the previous byte
  and block Step independently of the data editor. The field locks during
  execution, and restart restores `01` and unlocks it. Addition explanations
  use the fetched operand, with results from the real CPU record. The jump
  lesson selects one of two destination addresses before execution, writing
  both address bytes in RAM. Its PC path comes from CPU records; the view
  labels instructions passed over by recorded forward transfers.
  `interactive/program-history.ts` keeps per-instruction visit counts and at
  most twelve recent PC transitions, so backward jumps can revisit instructions
  without losing older counts or accumulating an unlimited history. Its tests
  run in the main Node suite and require no browser or Python. Restart clears
  that history along with the machine state.
- The conditional loop uses `JNC` to leave the loop when addition sets carry.
  Its last-instruction explanation reads CY from the before snapshot and the
  destination from the after snapshot; the controller does not decide the path.
  Both taken and untaken jumps count as executions and show their fetched bytes.
  The declared completion address ends lesson stepping without halting the CPU.
- The countdown replaces addition with `SUI 1` and tests Z with `JNZ`. JNC and
  JNZ share a description helper that reports the recorded flag and PC. The
  shared flag display reads CPU state even before arithmetic has run: initial
  A = 0 does not imply Z = 1. Subtraction changes Z; load, store, and jump preserve it.
- The comparison lesson adds `CPI` between store and `JNZ`. It reuses the operand
  editor for the target at `0109`, restoring 44 on restart. Both ADI and CPI
  update Z; the comparison's answer reaches the jump while A retains its value.
  The operand control's label, address, and initial value come from the template;
  the controller reads the current byte and execution from the machine.

Sauvignon fences replace the earlier Mermaid diagrams. GitHub currently shows
these fences as source; the site displays the rendered diagrams and
provides expandable XML source and full-size SVG links.

The [Altair memory-controls lesson](../docs/machines/altair-memory.md) uses a
separate `instruments/altair-panel.html` view and lazily loaded
`interactive/altair-explorer.ts` controller. Its DOM-free `altair-panel.ts` model
keeps the switch word and selected address separate and accesses the RAM from
`lessons/altair-memory.machine`. It supports EXAMINE, EXAMINE NEXT, DEPOSIT, and
DEPOSIT NEXT; it does not construct a CPU or simulate bus cycles. Number guides
are optional teaching aids. Restart replaces both RAM and panel state while
preserving the guide preference. The panel's contract and hardware source live
in the linked lesson specification.

[Entering your first program](../docs/machines/altair-program.md) reuses that
panel with the `program` mode and a separate lazy `altair-program-explorer.ts`
controller. Its DOM-free `altair-program.ts` session uses
`8080/altair-program-lesson.machine`: source data is supplied, but the learner
enters the program. The panel's address storage is backed by PC; selecting an
address preserves the remaining CPU snapshot and the RAM. The controller adds
a live reference card, CPU/data readouts, and guarded instruction stepping.
`instruction-trace.ts` formats captured 8080 records for both register and panel
lessons. Panel edits do not rewrite those records. The linked contract explains
the hardware relationship, instruction-level approximation, and acceptance checks.

[Letting the computer run](../docs/machines/altair-running.md) selects the
controller's `running` mode with the existing `8080/countdown-lesson.machine`.
The session checks its fixed reference bytes and instruction starts.
`interactive/execution-controller.ts` supplies DOM-free, cancellable pacing:
one instruction per scheduled callback, STOP/resume, manual stepping, and the
twelve most recent captured results. The browser supplies timers, pauses on
visibility/page changes, and locks memory operations while running. Restart
cancels old callbacks before replacing the session; pace and guide preference
remain selected. The lesson contract owns the complete control and failure rules.

[Sending a byte out](../docs/machines/altair-output.md) uses the `output` mode
and `8080/altair-output-lesson.machine`. The existing byte-output device owns the
lamp value; its host callback counts writes. The view reads snapshots without
port access, and panel PC changes retain the same port connection. The shared
lamp renderer serves both front-panel and device lamps; captured instruction
traces distinguish memory accesses from port transfers. The lesson contract
owns the initial state, program behavior, and acceptance checks.

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
edits. Restart after carry and while an invalid draft is present. For the
stored-program lesson, check initial PC/bytes, the three fetch groups and next
markers, the final boundary, and restart. Verify that the load's data read is
not highlighted as an instruction fetch, and that edits preserve the last
fetch while invalid drafts block Step. For program editing, try operands 0, 2,
10, and 255, verifying the displayed hex, mnemonic, fetch record, result, and
unchanged PC path. Check the lock after the first step, reset to 1, empty and
invalid input, and both operand/data invalid drafts without one editor masking
the other. For the jump lesson, compare both destinations, the actual jump
fetches and PC paths, the skipped/visited markers, and completion in three or
four steps. Check that changing the destination preserves invalid data drafts,
that the selector locks after the first step, and that restart restores the
skip path and clears history. For the loop, step through several iterations,
check the run counts and recent-path truncation, and try 254 → 255 → 0 → 1.
Verify that memory edits do not add history, that invalid drafts block Step,
and that restart clears all counts and returns to the load. For the conditional
loop, verify the default seven-step path, both carry decisions, final counts
1/2/2/2, and completion at `010B`. Try starting at 253 and 255; change memory
between the final store and jump; restart after completion and an invalid draft.
Check that the earlier unconditional loop still has no completion marker.
For the countdown, check stored results 2, 1, 0, final counts 1/3/3/3, and Z = 1
at completion. Try starting at 1 and 5; after loading zero, verify Z remains 0
and the first subtraction wraps to 255. Edit the destination before JNZ and
verify that Z and the decision remain unchanged. Check invalid drafts, restart,
and the CY display in preceding lessons after the shared flag-view change.
For comparison, check the thirteen-step run and counts 1/3/3/3/3, with A = 44
and Z = 1 at completion. Try targets 42 and 43, and source 254 with target 0.
Verify the target's byte, label, lock, and reset; both editors' invalid drafts;
and that editing memory before the final jump preserves the comparison's answer.
Check that the earlier operand editor still changes ADI and displays CY.
Check that preceding lessons still work and do not request CPU runtime modules.
For the Altair panel, follow the 41-at-3 / 42-at-4 exercise, checking that switch
edits alone leave address and data lights unchanged. Check both NEXT controls,
wraparound at FFFF, high switches ignored for data, hidden number guides, restart,
keyboard controls, and narrow layouts. Only the CPU-based lessons should load
CPU modules; the first panel lesson uses RAM alone.
For program entry, deposit and read back all eight bytes, repair a wrong byte,
and verify that stepping becomes available only with valid bytes and PC. Step
through A = 41, A = 42, and RAM[4] = 42. EXAMINE 4 without clearing A, edit
0104 to 02, EXAMINE 0100, and rerun to store 43. Check the retained trace across
panel edits, the live reference card, and restart with the number guides hidden.
Repeat keyboard and narrow-layout checks for the added table and CPU controls.
For paced running, STOP during the countdown and verify that A, PC, Z, and RAM
stay fixed; STEP once and RUN to the endpoint. Check all paces, restart while
running, editing locks, the twelve-entry history limit, hiding and returning to
the page, and completion focus. Manually EXAMINE the endpoint without executing
and ensure the status does not claim the program ran.
The emulator’s `npm test` suite remains independent of the Python toolchain and
Sauvignon.
