# microcomputer.world

**microcomputer.world** presents interactive lessons and guides to classic processors. Dromaios supplies
the processor models and executable specifications; it is credited alongside
the site’s other tools, Ryland and Sauvignon.

Ryland builds the home page, the lesson index, the introductory lessons, one
guide per processor, and the Altair and Apple II Plus machine guides from executable specifications. Sauvignon renders both
architecture diagrams and state maps
derived from the CPU compiler. Pages use ordinary HTML, CSS, and SVG, with
small TypeScript modules for the lesson interactions. Processor guides need no
JavaScript; diagrams are rendered during the build. No CDN requests are needed.

## Lesson navigation

The Learn link opens `/learn/`, a contents page grouped into bits and memory,
8080 programming, the Altair panel and I/O, text, buffers, and subroutines, and
BASIC on the Altair.
Each lesson has an All lessons link alongside Previous/Next navigation.

[`lessons.py`](lessons.py) owns lesson titles, summaries, grouping, and order.
The build uses this catalogue both to render the lesson pages and to populate
[`learn.html`](templates/learn.html) and the shared
[navigation include](templates/lesson-navigation.html). Add new lessons to the
catalogue in their intended learning order; the shared navigation supplies their
neighbors. BASIC lessons use the Markdown format below; earlier lessons retain
their individual templates. The index works without JavaScript.

## Altair BASIC

`/machines/altair-8800/` pairs the executable
[machine chapter](../src/machines/8080/altair-basic.md) with a working browser
terminal. `machines.py` selects the chapter and validates its JSON media record;
the build passes that size/digest into the file control. The site neither fetches
nor distributes BASIC. `interactive/altair-basic-media.ts` verifies the complete
local file before replacement and distinguishes attached tape from the verified
file retained after reset. The chapter owns loading instructions, terminal conventions,
reset/reload behavior, and limitations.

BASIC lessons under [`content/basic/`](content/basic/) are literate Markdown.
They share the [loading explanation](content/basic-loading.md),
[page template](templates/basic-lesson.html), [machine instrument](templates/instruments/altair-basic.html),
browser controller, and chapter-owned media record. BASIC lessons opt into a shared
tab-local session through the template's `session_key`, scoped to the published
base path. The machine guide retains its independent, unsaved machine. Guide links
open in a new tab so consulting them does not replace a lesson's machine.

[`altair-basic-session.ts`](interactive/altair-basic-session.ts) encodes the generated
machine snapshot, host transport, verified tape, terminal cursor and bounded text,
panel choices, instruction count, execution error, and last execution PC. STOP,
page hiding, and navigation save it in `sessionStorage`; a new lesson or refresh
validates it and restores a stopped machine. Back/Forward restores the latest
checkpoint rather than reviving an older cached program. Recent instruction
records start empty on each page. No instruction, guest reset, or host output is
produced by restoration. Retained media is verified against the chapter again.

The saved format is versioned; bump it for incompatible machine or host changes.
Invalid snapshots fall back to a fresh machine with an explanation. Failed writes
remove a stale checkpoint when storage permits, and a visible message explains
that continuation is unavailable. Storage is temporary and local; no program or
tape is uploaded. Tabs are independent after any browser-provided initial copy.
Start fresh reloads the retained tape and replaces the saved program. `NEW` at
BASIC's OK prompt clears only the program and variables, keeping BASIC loaded.

`interactive/altair-basic.ts` connects the generated factory and shared
`SerialSession` to browser controls. `serial-execution.ts` schedules cancellable
batches; `serial-terminal.ts` supplies bounded printing-terminal presentation.
`altair-machine-panel.ts` connects the shared panel model and view to this
machine's mapped memory, PC, and live sense switches. Reload rebinds and opens
the panel on the fresh machine; CPU/serial reset preserves both switch banks.
If panel actions change PC after execution, a reminder beside RUN compares it
with the last execution record. It does not restore state automatically.
The earlier lessons retain their individual-instruction pacing. The machine's
script loads only on the machine guide and BASIC lessons; their prose remains
readable without JavaScript.

The emulator suite includes scheduler and terminal tests. Set `ALTAIR_BASIC_TAPE`
to include the real-tape browser-session test as well as the headless acceptance
test. Browser checks cover initialization, typing and pasting one line, editing,
LIST/RUN/INPUT, STOP/resume, Control-C, invalid files, reset/reload, keyboard
navigation, and wide/narrow layouts. Also check the shared panel: setting A11/A10
without EXAMINE, PC changes, deposits at and beyond 0FFF, disabled memory actions
while running, live sense switches, the changed-PC reminder, reset's ejected-tape
readout, and reload with number guides hidden. The queue count remains visible
without selected media.
Continuation tests cover the original tape during loading and INPUT, queued bytes,
saved programs, reset/reload, rejected snapshots, and storage failures. Browser
checks also cover Previous/Next, All lessons, Back/Forward, refresh, restored
switches, and an explicit RUN after restoration.

### Authoring a BASIC lesson

Add a Markdown file under `site/content/basic/` and register its filename stem,
title, and summary in the BASIC group of `lessons.py`. Start with a level-one
title, a blank line, an introductory paragraph, and a blank line. The remaining
Markdown follows the shared loading instructions and machine on the page.
Relative links to another BASIC lesson stay local when published; links to
repository material use the same rules as the processor and machine guides.
The shared template supplies the `#load-basic` and `#basic-terminal` anchors
for links back to its loading instructions and terminal.

Use `basic-session` fences for checked examples:

````markdown
```basic-session
> PRINT 2+3
 5

OK
```
````

`> ` introduces one line to type, followed by Enter. The following lines are
the expected reply, excluding the echo of that input. Consecutive input lines
declare no additional reply between them; numbered program lines normally only
echo. Fences continue one session in document order after a fresh BASIC boot.
An INPUT exchange ends its reply at `?`, then supplies the answer as another
input line. Inline code and ordinary code fences are explanatory, not executed.

The [parser](basic-lesson.ts) retains source locations and supplies the same
turns to publication and the [transcript tests](../tests/site/basic-lessons.test.ts).
The renderer labels inputs “Type, then Enter” and outputs “BASIC replies”; it
does not show the source's `>` markers. No interpreter output is generated into
the expectations: authors supply the expected results. Tests use the real tape,
CPU, serial session, browser batching, and terminal display. They check the echo
as well as the reply, allowing time for line storage before the next input.
Only right-hand spaces and final line endings are ignored; leading spaces,
interior blank lines, case, and all other text must match. Byte-level terminal
and machine tests retain their separate exact checks.

Set `ALTAIR_BASIC_TAPE` to run these acceptance tests. Without the external file
they are explicitly skipped; syntax and publication checks still run. These
transcripts are test inputs and published examples, not commands automatically
sent by the browser. The lesson format currently describes linear conversations,
not branching exercises or a general lesson language.

## Apple II Plus

`/machines/apple-ii-plus/` publishes the executable [Apple II chapter](../src/machines/6502/apple2.md)
as the **classroom**, with local ROM selection, text, both graphics resolutions, and Language Card RAM.
`/machines/apple-ii-plus/laboratory/` is the separate dark **laboratory** with the
reference's screen/CPU, memory, and tabbed-tool columns as its starting layout.
It targets a large screen (roughly 1200 CSS pixels wide); smaller windows scroll
across the workspace. `apple2-page.ts` and `apple2-laboratory.ts` both mount `apple2.ts`
and share the machine/session and control templates. They have independent,
unsaved machine state; classroom links from the laboratory open a separate tab.
`apple2-rom-storage.ts` remembers the selected ROM file in `localStorage`, shared
by both views on the same origin. It retains the complete container for Disk II
boot, revalidates every restored file, and keeps storage failures separate from
loading usable media. Forget saved ROM removes only the stored copy. RAM,
programs, and disk selections are not persisted.
`workspace/` and `workspace.css` own docking presentation independently of the
machine. Drag a tab into the middle of a group to combine tools, onto its tab
strip to reorder tabs, or between panels to reorder a row or column. A line marks
the insertion point; moving a standalone panel within that row or column retains
every panel's size. Docking across the other axis creates a nested area. Each
divider resizes only its two neighbours. The header arrow collapses a panel
or tab group; its header stays visible and vertically adjacent panels use the
released space. Expanding restores the previous split proportions. Selecting a
tab also expands its group. The standalone headers retain the compact, uppercase
instrument styling, while grouped tools use tabs.

The top-right page header contains the layout controls.
**Panels** closes and reopens tools; **Arrange panels** provides a keyboard
alternative to docking gestures. Arrow keys navigate tabs and resize focused
dividers (Shift uses larger steps). Collapse/expand buttons work with the
keyboard too. **Reset layout** restores the default arrangement without resetting
the machine or tools. Docking hints and arrangement feedback appear inside
**Arrange panels**. Layout operations preserve the same content elements,
including inputs, navigation, and log capture. Closed panels remain mounted in
a hidden container within the application. Collapse state is part of the saved
layout.

`workspace/layout.ts` defines pure layout operations on ordered, weighted rows
and columns; adjacent splits along the same axis are flattened. `state.ts`
validates versioned local preferences and migrates the earlier binary splits,
retaining their proportions, tabs, and collapse state. `dock.ts`, `pointer.ts`, and `controls.ts` render
and operate that model. `apple2-laboratory.ts` supplies the panel list and
visibility refresh callback; `apple2-workspace.ts` owns the default arrangement
and adds Execution below Screen when migrating older saved layouts. No simulation objects cross that
boundary. Layouts are saved per browser origin; unavailable or invalid saved
preferences fall back to the default. This storage is separate from the ROM
and does not persist machine state across page reloads. `panel-updates.ts` owns
inspector Live preferences in separate storage; docking only reparents the
optional tool-owned header controls. The controller gates display refreshes,
while capture and execution availability remain independent.

Apple II instruments remain concrete in `apple2-inspection-view.ts`; their storage reader
uses RAM/ROM and pure device snapshots, never the guest bus. Device-space bytes
without a storage view appear as `--`. `apple2-memory-view.ts` owns the shared
byte renderer and per-panel 8/16-byte row toggle. Its header control regroups
existing cells without refreshing held values; preferences are separate from
docking and machine state. `apple2-memory-scroll-view.ts` keeps a detached 64K
storage image and renders the visible range computed by `apple2-memory-window.ts`.
Scrolling and reformatting a held view never acquire newer values. The address
form lives in the tool-owned header. `apple2-stack-view.ts` offers entries above
SP or the full stack page. `inspector-controls.ts` supplies the compact choice
buttons used by memory, stack, and disassembly.
`apple2-disassembly-view.ts` uses the same storage reader for its live listing;
its PC/MEM header toggle follows the CPU or Memory's selected address.
`apple2-disassembly.ts` prepends the last three captured instructions while
following PC, retaining their bytes and ROM mapping. Executed and upcoming
instructions both carry the chapter-derived control-flow classification for
solid unconditional-transfer and dotted conditional-branch separators.
The Routine column precedes Address; the Operand column labels encoded addresses
from calls, branches, loads, stores, comparisons, and other memory instructions.
It preserves indexed and indirect notation without resolving registers or
pointers. The ROM guide owns the labels and their ROM/workspace/hardware scopes.
Mapping and captured-byte rules also apply to operand labels. Exact reference
lookup covers all labels; nearest-routine navigation only considers routine
entries.
`apple2-history-view.ts` combines the recent executed-instruction list with
selectable captured details. Selecting pins a record even as the recent list
advances; Follow latest restores tracking. It shares a default tab group with
Changes, while both remain independent tools. `apple2-instruction-view.ts` owns
the upcoming-instruction panel. Its pure `apple2-instruction-preview.ts` runs a
copied generated CPU against safe storage reads and private writes, stopping at
unavailable/device reads. It does not duplicate the instruction set or operate
the guest bus. Its branch explanations use the catalogue's chapter-derived flag
tests, including taken branches with a zero offset; equality of the final PC and
the next instruction's address does not determine whether a branch was taken.
The Execution panel owns Run, Pause, Step, Reset CPU, Fresh power-on,
instruction count, and status messages. Below Screen, Execution, MOS 6502, and
Instruction form a narrow column beside a full-height Disassembly panel.
Execution can be moved, collapsed, tabbed, or reopened through Panels.
Disassembly owns execution targets and ROM owns firmware selection
and reference browsing. `apple2-rom-reference.ts` searches the guide's entries and
locates the nearest documented label within its declared ROM region, without
inventing routine extents. The reference view follows PC or Memory, and exposes
navigation callbacks to the concrete tools. Only the composition layer opens
the destination panel; no machine objects enter the docking system.
Screen accepts keyboard and paste directly; only the classroom has a separate
keyboard field.
`apple2-change-log.ts` captures instruction-boundary CPU changes and observes
physical `Ram` stores for old/new memory values, independently of the display
refresh rate. Its bounded history includes Language Card bank identities and
completed effects of interrupted steps. `apple2-change-log-view.ts` provides the
laboratory's Changes tab; the machine chapter owns capture and lifetime behavior.
Last-step RAM observations also feed the inspection panels' byte highlights,
independently of log recording. The inspector matches physical banks to the
currently displayed storage, without reading a soft switch or treating bank
selection as a memory write. `apple2-memory-position.ts` observes every executed
instruction's RAM changes and computes the Memory window only when that view
refreshes. Its tests cover batches ending with a non-writing instruction,
recording disabled, repeated writes, bank visibility, and address boundaries.
`6502-instruction-catalogue.ts` derives fixed instruction lengths and control flow
from the chapter's operand fetches and explicit PC writes at build time, including
BRK's padding byte. PC/SP writes and ordered data accesses also identify the four
stacked control transfers without consulting their mnemonics. The browser receives names, lengths, and transfer kinds
alongside the versioned ROM labels; it does not load the
semantic compiler or maintain a second opcode table. Address buttons share the
shared `instruction-debugger.ts` policy for bounded run-to, Step over / Step out,
persistent breakpoint matching, and observed caller tracking. The policy has no
machine, memory, DOM, or scheduler connection. `apple2-debugger.ts` supplies mapping
and completed-step observations; `apple2-breakpoint-view.ts` owns the saved address
preferences and controls. `apple2-watchpoints.ts` matches saved stop choices against
completed instruction accesses, using chapter-derived fetch/read/write roles and
physical RAM observations from the change log, independently of its recording
switch. The debugger cancels temporary requests when a watchpoint stops execution
after an instruction. `apple2-call-stack-view.ts` displays detached observed frames,
including captured mappings and persistent lost-history notices; it never reads
the hardware stack. Workspace migrations introduce Call stack beside Stack and,
in version 5, Device activity beside System; version 6 adds Walkthrough beside ROM, preserving existing arrangements
and deliberately hidden instruments. ROM labels
remain in the versioned software guide. The [replacement plan](../docs/machines/apple2.md#replacement-progress)
tracks feature gaps separately from the layout. The Machines navigation opens the
home-page machine index. `rom-file.ts` checks the complete container and extracted
ROM; `apple2-session.ts` creates hardware immediately with an explicit empty
firmware binding and delivers queued keys through the generated latch. Its
`installFirmware` method installs a verified image without resetting or
replacing the machine; `reset` prepares execution. The first browser ROM
selection performs both steps, while later selections keep the fresh-machine
workflow. RAM and devices are inspectable before boot, with missing ROM shown
as unavailable. Browser execution and keyboard input remain disabled until
firmware is installed.
`apple2-hardware-catalogue.ts` exports the machine chapter's read/write routes and
compiled device binding descriptions at build time. `apple2-hardware.ts` evaluates
those routes against detached selector snapshots for the laboratory System map;
`apple2-system-view.ts` displays keyboard, video, and Language Card state with
changes since the previous displayed sample. Neither reads the guest bus nor
copies disk media. These remain concrete Apple II adapters; no new peripheral
language or runtime compiler is introduced. Disk II descriptions use its existing
binding metadata and the machine chapter.
`apple2-rom-guide.ts` types the versioned guide and supplies byte/mapping-checked
instruction notes and checkpoint position text. `apple2-rom-reference-view.ts`
renders optional routine inputs, effects, workspace links, and related entries;
`apple2-walkthrough-view.ts` renders authored checkpoints and requests the existing
ROM-only debugger stops. Selecting a checkpoint is read-only. The guide contains
no setup scripts, assertions that an address match proves a scenario, or hidden
machine mutations. `apple2_rom.py` validates addresses, references, and instruction
lengths during the site build; optional real-ROM tests follow every authored
checkpoint and compare each note's bytes against the verified image.

`apple2-device-history.ts` retains bounded completed-instruction I/O transfers,
including slot-ROM fetches, coalescing identical polls with counts. The explorer
observes it on every successful step, independently of visibility and Live.
`apple2-device-history-view.ts` owns filtering, links, and rendering. Code navigation
checks the captured mapping before browsing current bytes. The
[ROM guide](../docs/software/apple2p-rom.md#watching-the-hardware) owns the UI's
retention, clear/reset, and interpretation rules.
`apple2-screen.ts` reads RAM using generated, read-only video views.
`apple2-raster.ts` combines decoded graphics with the pinned reference's bitmap
character set on a 280-by-192 raster. Its fixed RGB palettes also follow that
reference. `apple2-screen-view.ts` presents the pixels with a transparent,
selectable text layer and a switchable scanline overlay, shared by both views.
The laboratory adds `apple2-screen-inspector-view.ts`: an explicit text-cell selection
mode with Memory/watch navigation and a last-writer strip. The pure
`apple2-screen-inspection.ts` reuses generated video address/visibility views and
shared character decoding. It retains at most one observed store per byte of the
two text pages. `apple2-change-log.ts` supplies all physical RAM stores separately
from changed-byte highlights and log entries; unchanged stores still establish
provenance. Selection never accesses the guest bus. The ROM guide owns the
interaction and history-reset contract and the output/scrolling walkthrough.
Both offer a Monochrome toggle: green bitmap text, individual high-resolution
dots, and five low-resolution brightness levels, with immediate redraw while paused.
The device chapter owns the glyph, flashing, and high-resolution colour-pair
choices, including their limitations. The controller
owns host events and scheduling; it contains no ROM traps or hardware decoding.
The shared execution controller supports bounded batches with single-instruction
manual stepping; existing lessons retain their original pacing.

Set `APPLE2_ROM` for the production browser-session acceptance test. Check local
file selection, a real Applesoft session, editing, Control-C, failed replacement,
pause/resume, reset/power-on, keyboard focus, and wide/narrow layouts in the browser.
For workspace changes, also check tab reordering, splits, divider resizing, collapse/expand, keyboard controls,
close/reopen, and layout restoration after reload.
Check that rearranging and resetting the layout preserve CPU state, tool inputs,
and captured history. The
chapter's drawing programs exercise colour bands, HLIN, VLIN, PLOT, HGR, HGR2,
HCOLOR, and HPLOT. Check full/mixed modes, both pages, returning to text, and
switching between graphics resolutions without a stale image or incorrect scale.
The chapter owns the behavior and limitations, including session lifetime,
the character set, and approximate flash timing. In the laboratory, switch individual Live squares off during Run; their
contents should hold while other views advance, then catch up on Pause or Step.
Check their state survives tab changes, docking, close/reopen, and reload.
Try Memory's fixed/PC/changes modes with Live both on and off, then enter a
manual address to return to Fixed. Check Disassembly's
PC/MEM selection, address browsing, ROM labels, and run-to stops. Scroll Memory
from 0000 to FFFF in both row widths, including with Live off during Run. Check
its header address and MEM listing agree. Switch Stack between entries and PAGE;
check JSR/RTS push and pull addresses. Check Instruction before a RAM operation
and a device read: only the former can predict the complete result. Browsing device
addresses must leave keyboard, disk, and Language Card state unchanged.
In ROM, search by label/address/description, select an entry, and browse its
Disassembly and Memory. Check PC and instruction count do not change. Follow PC and
Memory independently, hold the view with Live, and follow a Disassembly label back to
its reference. Without ROM, or with Language Card RAM mapped over it, the view
must distinguish the static reference from the machine's current storage.
Check history selection across repeated addresses, stepping, running past the
twelve-entry window, and reset. Closing Screen must leave machine controls usable.
Check Changes across steps and running batches, filtering, paused recording, clear,
reset, power-on, and media replacement. Memory before-values must come from the
written bank even when ROM is mapped for reads.

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

[Receiving a byte](../docs/machines/altair-input.md) adds an `input` mode with
`8080/altair-input-lesson.machine`. The input view owns prepared switches;
`ByteInput` owns the pending byte. Send offers data without starting execution,
and snapshots inspect it without consuming it. A lesson guard pauses before
an empty IN; the raw device still follows its empty-read contract. The same
switch markup serves input and the memory panel. The linked lesson specifies
arrival between instructions, reset, and the distinction from CPU polling.

[Waiting for a byte](../docs/machines/altair-polling.md) selects `polling` with
`8080/altair-polling-lesson.md`. The program reads the same input device's
status at port 0, compares it with zero, and branches before receiving and
echoing data. This mode has neither the empty-input guard nor an end boundary;
it reuses the same pacing, input, output, and history views. The live readiness
readout comes from a snapshot and remains distinct from the CPU's sampled
answer. The linked contract owns the polling and arrival behavior.

[Bytes can be letters](templates/bytes-as-characters.html) adds an ASCII
interpretation to the reusable byte editor, initially 65 / A. The DOM-free
`interactive/ascii.ts` classifies seven-bit ASCII: graphic characters, space,
controls, Delete, or outside ASCII. It never strips the high bit or chooses an
extended encoding. The view in `interactive/ascii-explorer.ts` writes text,
labels non-printing codes without executing them, and preserves the last valid
byte when a number draft is invalid. Selecting an example replaces the byte
and clears invalid drafts through the editor's existing setter. Clear all bits
selects NUL. It creates no CPU, memory, or device instance.

The [mapping tests](../tests/site/ascii.test.ts) cover every byte against explicit
ASCII rows and control labels, distinguish zero from the character 0, and reject
non-byte inputs. Browser checks cover numeric and bit edits, examples, space,
control labels, the high bit, punctuation rendered as text, invalid drafts and
recovery, keyboard use, and wide/narrow layouts. The static page retains the
65 / A example with disabled controls when JavaScript is unavailable.

[Typing to the computer](../docs/machines/terminal-lesson.md) selects `terminal`
presentation with the same polling program and generated factory. The session
in `interactive/terminal-lesson.ts` retains bounded output through the existing
device callback; `character-input-view.ts` prepares a character and
`terminal-output-view.ts` renders received bytes. Both input views share the
latch-status rendering. The linked contract owns input validation, display
conventions, retention, restart behavior, and acceptance checks.

[A different reply](../docs/machines/reply-lesson.md) selects `reply` with
`8080/altair-reply-lesson.machine`. It reuses the terminal session, devices, and
views, initially preparing lowercase a. The CPU compares the received byte,
skips or executes MVI, and sends the reply; the host does no character conversion.
The linked contract owns the program paths and acceptance checks.

[Printing a message](../docs/machines/message-lesson.md) selects `message` and
reuses `8080/output-example.machine` unchanged. The shared panel derives its
program start address, accepts a completed HLT record, and blocks further
execution while halted. `ram-window-view.ts` inspects the message in concrete
RAM and marks HL; B, HL, Z, and the halted state remain separate CPU readouts.
The linked contract owns data editing, completion, and acceptance checks.

[Where does a message end?](../docs/machines/terminated-message-lesson.md)
selects `terminated-message` with `8080/altair-terminated-message-lesson.machine`.
The CPU compares each loaded byte with zero before reaching OUT. It uses the
same pointer, RAM, terminal, and halted-state views; the window includes NUL
and the unused B counter is omitted. Both message lessons share pointer and
halt descriptions. The linked contract owns terminator edits, the sampled
comparison, and behavior beyond the visible RAM range.

[Remembering what you type](../docs/machines/buffer-lesson.md) selects `buffer`
with `8080/altair-buffer-lesson.machine`. It combines the existing character
input, RAM window, and terminal output. Captured MOV M,A writes explain stores;
the guest program owns polling, capacity, termination, and readback. The linked
contract specifies the eight-character limit, pending input after collection,
and the distinction between an empty input latch and stored buffer contents.

[Remembering where to return](../docs/machines/subroutine-lesson.md) selects
`subroutine` with `8080/altair-subroutine-lesson.machine`. Two RAM windows follow
HL and SP independently; stack bytes have low/high roles instead of character
labels. CALL and RET descriptions retain the captured continuation and accesses,
and traces include SP changes. The linked contract owns stack reuse, return
address edits, and the distinction between returning and erasing RAM.

[A routine inside a routine](../docs/machines/nested-call-lesson.md) selects
`nested-call` with `8080/altair-nested-call-lesson.machine`. It reuses the same
CALL/RET descriptions and RAM renderer, expanding the stack window to four
bytes with fixed inner/outer roles. Both return destinations come from CPU
reads of RAM; there is no host call stack. The linked contract covers nested
returns, stack reuse, and editing one continuation while both calls are active.

[Keeping a value across a call](../docs/machines/save-registers-lesson.md)
selects `save-registers` with `8080/altair-save-registers-lesson.machine`.
The four-byte stack window distinguishes saved H/L from the return address.
PUSH/POP descriptions use captured CPU records. The guest routine preserves HL,
so the caller can print twice after choosing the message once. The linked
contract covers editing saved data and skipping POP before RET.

[A tiny command prompt](../docs/machines/command-prompt-lesson.md) selects
`command-prompt` with `8080/altair-command-prompt-lesson.machine`. It combines
character input, the buffer and stack windows, and the bounded terminal display.
The 8080 handles line completion, overflow draining, command recognition, and
response selection. MOV A,B adds a captured count-copy explanation; the other
instruction views are shared with earlier lessons. The linked contract owns
repeated commands, exact matching, and reset/restart behavior.

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
