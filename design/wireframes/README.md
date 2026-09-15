# microcomputer.world website wireframes

An independent, clickable first pass through the proposed page families.
Open `index.html` in a browser. No package installation or project build is
needed; all styling, scripts, and prepared example data are local.

microcomputer.world is the public site name. dromaios is the underlying
software, credited in the footer and explained on the About page.

For an HTTP preview, run this from `design/wireframes/` and open the printed
address:

```sh
python3 -m http.server 4177 --bind 127.0.0.1
```

## Scope and isolation

All prototype files are contained in this directory. They do not import CPU
models, modify the project build, or depend on generated files. They can be
reviewed and developed in a separate Git worktree while CPU work continues.

The page content is a design preview. Planned machines and future guides are
labeled accordingly. The palette, type, spacing, content, and interaction
choices remain provisional.

## Review paths

1. Home → Learn → One addition → Workspace → ADC reference → Return.
2. Home → Explore → Software → Elite → Before the square → Concept inspector.
3. Explore → Machines → BBC Micro → CPU or software overview.
4. About → This prototype.

The first path checks whether a learner can move from guided reading to fuller
inspection and back. The second checks sustained reading alongside code and
a demonstration. Both should retain the relevant state when following internal
links. Navigation pauses a running prepared sequence; it does not reset it.

## Page inventory

Routes are hash links within the same local page, so browser back/forward works
and no server routing configuration is needed.

| Page family | Routes after `index.html#` |
| --- | --- |
| Home | `/` |
| Section landing pages | `/learn`, `/explore`, `/reference` |
| Collections | `/explore/cpus`, `/explore/machines`, `/explore/software`, `/explore/comparisons` |
| Subject overviews | `/cpus/6502`, `/machines/bbc-micro`, `/software/elite-a` |
| Introductory lesson | `/learn/first-addition` |
| Expanded workspace | `/workspace/6502/addition` |
| Software chapter | `/software/elite-a/squa` |
| Reference entries | `/reference/6502/adc`, `/reference/glossary` |
| Articles | `/about`, `/about/design` |

## Interactive examples

### 6502 prepared states

The ordinary case follows the [load-add-store specification](../../docs/cpus/6502/examples/arithmetic.md):
CLC, LDA immediate, ADC immediate, and STA absolute. Registers, flags, memory,
and instruction-level accesses are prepared presentation data. The code does
not decode or execute opcodes.

The two extra presets illustrate binary arithmetic with incoming carry cleared:

| Inputs | Stored result | Carry | Overflow | Negative | Zero |
| --- | --- | --- | --- | --- | --- |
| 2 + 3 | 5 | 0 | 0 | 0 | 0 |
| 255 + 1 | 0 | 1 | 0 | 0 | 1 |
| 127 + 1 | 128 | 0 | 1 | 1 | 0 |

Step advances one prepared record. Run advances at a reading pace, pauses on
navigation, and stops after the store. Restart example restores the preset's
initial state. Switching presets starts that example at its initial state.
CPU reset is not exposed. Reloading the page starts a fresh prototype session.

### Software chapter

The first chapter uses the SQUA entry point from **Elite-A, Docked**, as
documented in [Mark Moxon's source analysis](https://elite.bbcelite.com/elite-a/docked/subroutine/squa.html).
It includes a short, attributed source excerpt. The accompanying prose is
written for this prototype; no source commentary is reproduced verbatim.

The inspector directly calculates a bit mask and mathematical square. Its
decimal input, slider, bit toggles, and value view share one local input state.
It is explicitly a conceptual demonstration, not execution of SQUA2 or a game.
No game assets are included. A production guide would pin an exact source
revision and executable before associating addresses with runtime state.

## What to review next

- Does the homepage give a visitor a clear first action?
- Are the Learn, Explore, and Reference entry points understandable?
- Does each overview make its relationship to lessons and reference clear?
- Is the last executed instruction distinct from the next instruction?
- Can readers follow long prose with the inspector alongside it?
- At a narrow width, should the inspector remain below the prose, move earlier,
  or open on demand? The initial sketch stacks it below the article.
- How should the simple lesson and substantial guide share navigation and
  inspection while retaining their different reading needs?
- Which visual details should advance beyond this provisional notebook style?

## Checks

Check JavaScript syntax with `node --check app.js`. Review navigation, the three
prepared cases, Step/Run/Pause/Restart, state retention, bit controls, and layout
at desktop and mobile widths in a browser. The production build and CPU tests
are independent of these wireframes.
