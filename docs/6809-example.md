# Third example: the same calculation on a 6809

**Status: reviewed specification; no 6809 implementation yet.**
This defines the third small example after the completed
[8080](first-example.md) and [6502](6502-example.md) examples. It loads 2,
adds 3, and stores 5. The CPU-specific interfaces remain provisional while
these examples expose the differences shared support must represent.

## Model boundary

- The original Motorola MC6809 instruction set, also used by the MC6809E,
  connected to the existing flat 64 KiB `Ram`. Clock and pin differences
  between those parts are outside this instruction-level model. This is not
  an HD6309 model or a complete Color Computer.
- Three forms: `LDA #n` (`86`), `ADDA #n` (`8B`), and `STA addr` with extended
  addressing (`B7`). Encodings and lengths follow the
  [Motorola instruction summary][summary].
- Explicit initial state, detached snapshots, instruction records, and CPU
  reset. No interrupt inputs, stack instructions, direct or indexed addressing,
  prefixed instructions, devices, timing, dummy bus accesses, or browser UI.
- One `step()` attempts one instruction. The caller owns the completion
  address and execution budget; the CPU has no lesson-specific halt latch.

The proposed source locations are `src/components/cpus/6809.ts` and
`src/machines/6809-example.ts`, with corresponding CPU, machine, and public-type
checks under `tests/`. They will be added in reviewed implementation changes.

## Program and memory image

Addresses and bytes below are hexadecimal. In assembly, `#` introduces an
immediate value and `$` introduces a hexadecimal number. The `>` in the store
explicitly selects extended addressing; the literal bytes determine the form.

| Address | Bytes | Instruction | Effect |
| --- | --- | --- | --- |
| `0200` | `86 02` | `LDA #2` | Load A and update load flags |
| `0202` | `8B 03` | `ADDA #3` | Add 3 to A, ignoring incoming carry |
| `0204` | `B7 00 80` | `STA >$0080` | Store A using the full address |
| `0207` | — | Lesson completion address | Caller stops before fetching |

The seven-byte program is:

```text
86 02 8B 03 B7 00 80
```

Start with zero-filled RAM, load those bytes at `0200`, and write reset-vector
bytes `02` at `FFFE` and `00` at `FFFF`. All other bytes initially remain zero,
including `0080`, `0207`, and `1280`.

The address bytes in extended instructions are high byte then low byte.
Extended addressing bypasses DP; this lesson deliberately initializes DP to
`12`, yet stores at `0080`. Direct STA (`97`) is outside the subset. Motorola's
[addressing descriptions and vector table][model] establish these distinctions.

## State, initialization, and ownership

`Cpu6809State` will contain `a`, `b`, `dp`, `x`, `y`, `s`, `u`, `pc`, and
`flags`. `Cpu6809Flags` will contain eight booleans: `e`, `f`, `h`, `i`, `n`,
`z`, `v`, and `c`, corresponding to the condition-code register's bit order.

| State | Width | Lesson initial value |
| --- | --- | --- |
| A | 8 bits | `00` |
| B | 8 bits | `34` |
| DP | 8 bits | `12` |
| X, Y | 16 bits each | `0000` each |
| S | 16 bits | `8000` |
| U | 16 bits | `4000` |
| PC | 16 bits | `0200` |
| F, I | Boolean each | True |
| H, V, C | Boolean each | True |
| E, N, Z | Boolean each | False |
| D, derived from A and B | 16 bits | `0034` |

These are deliberate lesson values, not power-on or reset defaults. B makes
the D view visible; DP demonstrates the scope of extended addressing. Distinct
S and U values make preservation checks meaningful. Incoming C remains true
through LDA so ADDA visibly ignores it; H and V start true to expose their
replacement. Flags are supplied state, not inferred from the initial A value.

Motorola's [programming model][model] describes A and B as the two halves of D,
with A providing the high byte. Store A and B only. Each snapshot will include
a plain numeric `d` computed as `(a << 8) | b`, without retaining a third
mutable register or a getter linked to live CPU state:

```ts
export type Cpu6809Snapshot = Readonly<Omit<Cpu6809State, "flags">> & {
  readonly flags: Readonly<Cpu6809Flags>;
  readonly d: number;
};
```

The constructor will accept
`new Cpu6809(ram, initialState: Omit<Cpu6809Snapshot, "d">)`. D is not a separate
initialization input. Passing an existing snapshot is structurally permitted;
its `d` is ignored and recomputed from the copied A and B. Extra properties,
including a supplied `d` getter, must not be read. There is no public setter
for D in this subset. Future instructions that write D must update A and B.

Require exactly 64 KiB of RAM. Validate A, B, and DP as integers in `00`–`FF`;
validate X, Y, S, U, and PC as integers in `0000`–`FFFF`. Invalid numeric values
or RAM sizes throw `RangeError`; non-boolean flags throw `TypeError`. Copy only
declared stored fields, including inherited getters and non-enumerable fields,
before validation. Do not retain the caller's state or nested flags object.

Construction performs no reset, vector read, or instruction fetch.
`snapshot()` returns a detached `Cpu6809Snapshot` without accessing RAM.
Before/after snapshots, instruction bytes, and access entries are recursively
readonly to TypeScript and independent of later CPU or RAM changes. JavaScript
edits to returned objects cannot affect live state or other records. No runtime
freezing is required. D is consistent with A/B when a snapshot is produced;
bypassing readonly checks does not make the returned copy a live register view.

F and I are stored interrupt-mask bits; E is a stored stacking indicator.
Interrupt handling and packed CC access are deferred. S is the hardware stack
pointer used by calls and interrupts; U is a separate programmer-controlled
stack pointer. Neither stack is exercised by this program. See the
[register descriptions][model].

`create6809Example()` will return fresh `{ cpu, ram, endAddress }` values, with
`endAddress` equal to `0207`. Setup supplies the initial PC directly and does
not call reset. Calling the factory again restarts the lesson from its original
state and complete memory image.

## Instruction behavior

The flag behavior follows Motorola's [instruction details][instructions].
All three forms preserve B, X, Y, S, U, DP, E, F, and I. D changes only as a
consequence of A changing.

| Instruction | State changes | Additional preserved state |
| --- | --- | --- |
| LDA immediate | A receives the byte; N/Z reflect A; V becomes false; PC advances by 2 | H, C |
| ADDA immediate | A receives the low byte of A + operand; replace H/N/Z/V/C; PC advances by 2 | — |
| STA extended | Write A once; N/Z reflect A; V becomes false; PC advances by 3 | A, H, C |

For these 8-bit operations, N reflects bit 7 and Z tests the byte for zero.
In particular, A = `00`, B = `34` gives Z true after LDA or STA even though
the derived D is nonzero. A store's flags depend on A, not on the destination's
old contents. It must not read that old value or skip an unchanged-value write.

For ADDA, H indicates a carry out of bit 3, C indicates an unsigned sum above
`FF`, and V indicates that the signed sum is outside -128 through 127.
There is no carry input and no 6502-style decimal-mode flag. Decimal adjustment
uses a separate DAA instruction, which remains unsupported here.

The CPU wraps PC and operand fetches to 16 bits. RAM itself continues to
validate host addresses. Fetch both extended-address bytes before writing,
including when STA overwrites its opcode or either operand.

Useful arithmetic cases, each with old C both false and true:

| A | Operand | Result | H | N | Z | V | C |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `02` | `03` | `05` | 0 | 0 | 0 | 0 | 0 |
| `0F` | `01` | `10` | 1 | 0 | 0 | 0 | 0 |
| `FF` | `01` | `00` | 1 | 0 | 1 | 0 | 1 |
| `7F` | `01` | `80` | 1 | 1 | 0 | 1 | 0 |
| `80` | `80` | `00` | 0 | 0 | 1 | 1 | 1 |
| `FF` | `00` | `FF` | 0 | 1 | 0 | 0 | 0 |

## Step records and unsupported instructions

`Cpu6809MemoryAccess` has readonly `kind: "read" | "write"`, `address: number`,
and `value: number`. `Cpu6809Instruction` has readonly `address: number` and
`bytes: readonly number[]`. The step record will be:

```ts
export type Cpu6809StepRecord = {
  readonly instruction: Cpu6809Instruction;
  readonly before: Cpu6809Snapshot;
  readonly after: Cpu6809Snapshot;
  readonly accesses: readonly Cpu6809MemoryAccess[];
} & (
  | { readonly outcome: "executed" }
  | { readonly outcome: "unsupported"; readonly reason: "opcode" }
);
```

Every attempt returns a non-null instruction. Executed records have no
`reason`; the CPU has no `halted` or `complete` outcome. It retains no record
history. Instruction bytes come from actual opcode and operand fetches; data
writes appear only in `accesses`. Do not reread RAM to construct a record.

Every first byte other than `86`, `8B`, and `B7` is unsupported in the completed
subset. Record one opcode read and unchanged state and RAM. A repeated attempt
repeats the same read and leaves PC in place. During implementation, an opcode
remains unsupported until its handler is added.

**Prefix policy:** `10` and `11` select additional opcode pages in the
[hardware opcode map][opcodes]. This subset stops after reading the prefix
byte itself: bytes `[10]` or `[11]`, one read, reason `opcode`, unchanged PC.
It does not fetch the next byte or dispatch it as a base-page instruction.
These records are partial attempts, not decoded full prefixed instructions.
Supporting either page will require a separate change to this boundary.

## Expected lesson execution and completion

Each record's `before` equals the preceding `after`, starting with the initial
state above. All three outcomes are `executed`:

| Step | Address | Bytes | PC after | A after | D after | H | V | C |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `0200` | `86 02` | `0202` | `02` | `0234` | True | False | True |
| 2 | `0202` | `8B 03` | `0204` | `05` | `0534` | False | False | False |
| 3 | `0204` | `B7 00 80` | `0207` | `05` | `0534` | False | False | False |

Throughout these records, B = `34`, DP = `12`, X/Y = `0000`, S = `8000`,
U = `4000`, F/I = true, and E/N/Z = false. The table plus these preserved
values defines every field in every after snapshot.

| Step | Actual accesses, in order |
| --- | --- |
| 1 | `R 0200:86`, `R 0201:02` |
| 2 | `R 0202:8B`, `R 0203:03` |
| 3 | `R 0204:B7`, `R 0205:00`, `R 0206:80`, `W 0080:05` |

The final RAM image differs from the initial image only at `0080`, now `05`.
In particular, `1280` remains zero despite DP = `12`.

The caller checks `cpu.snapshot().pc === endAddress` before stepping, stops on
unsupported results, and uses a bounded instruction budget. The unchanged
lesson finishes after three records without reading `0207`. Tests can exercise
this directly; no generic runner is introduced.

A direct fourth CPU step at `0207` reads `00` and reports `unsupported`, reason
`opcode`, with equal before/after snapshots. On hardware, `00` is direct NEG,
not a stop instruction ([opcode map][opcodes]). This subset does not fetch its
operand or access the direct page. Completion belongs solely to the caller.

## CPU reset and lesson restart

`reset()` will return a separate `Cpu6809ResetRecord` with readonly `before`,
`after`, and `accesses` using the same snapshot/access types and detached
ownership as step records. It has no instruction, outcome, or reason fields.

The model's reset operation:

1. Reads `FFFE`, then `FFFF`, combining high and low bytes into the new PC.
2. Sets DP to `00` and F/I to true.
3. Preserves A, B, X, Y, S, U, E, H, N, Z, V, C, and all RAM. D consequently
   remains unchanged. Neither stack pointer is initialized or decremented.

The vector, DP, and mask effects follow Motorola's
[RESTART entry][instructions]. Its `X1X1XXXX` CC notation does not specify
fixed values for the other bits. Preserving those bits and other supplied
register values is this model's deterministic reset policy, not a claim about
their power-on values. Reset and creating a fresh lesson are separate actions.

Only the two vector reads are performed and recorded, with no dummy cycles,
stack accesses, or opcode prefetch. Always use the current vector. Hardware
also inhibits NMI recognition after reset until S is loaded; that latch and its
arming rules are deferred together with interrupt handling, as described in
Motorola's [NMI discussion][model]. No NMI behavior is claimed by this subset.

After the lesson, reset yields PC `0200`, DP `00`, and the exact accesses
`R FFFE:02`, `R FFFF:00`. A stays `05`, B stays `34`, D stays `0534`, S/U stay
`8000`/`4000`, and the result byte stays `05`. A repeated reset has the same
state effects; editing the vector changes the destination.

Restarting through `create6809Example()` restores the full initial state,
including DP `12`, H/V/C true, A `00`, and D `0034`, plus the original program,
vector, and zero result byte. It does not apply an additional CPU reset.

## Acceptance checks and implementation order

The eventual tests should cover:

1. Constructor validation of every field and RAM size, with no memory accesses;
   copying declared fields only; fresh independent factory calls and the entire
   initial memory image. Extra metadata and `d` getters must not be evaluated.
2. D as A:B in fresh snapshots and both sides of records, using nonzero B and
   boundary values. Old snapshots remain fixed after A changes; editing a
   snapshot's A, B, or D cannot change the CPU or another snapshot.
3. LDA values `00`, `7F`, `80`, and `FF`, replacing N/Z and clearing old V while
   preserving H/C and unrelated state. Include A = zero with nonzero B.
4. ADDA for all 65,536 accumulator/operand pairs, with both old carry values
   and old H/N/Z/V both clear and set. Compute expected half-carry from low-nibble
   arithmetic and overflow from signed arithmetic, independently of the
   implementation. Check unchanged B/DP/pointers/E/F/I and correct derived D.
5. STA to `0000`, `1234`, and `FFFF`, including unchanged-value writes and each
   possible overlap with its three instruction bytes. Require three reads then
   one write, no destination read, and independent retained bytes/write values.
   Use mixed flags, nonzero DP, and A values `00`, `80`, and `FF` to verify N/Z/V
   replacement and preservation of H/C/E/F/I and every stored register except PC.
6. All operand/PC wrapping positions at `FFFF` for the two instruction lengths.
   All unsupported first bytes on repeated attempts, particularly `10`/`11`
   followed by an otherwise supported byte, including a prefix at `FFFF`.
7. All three exact lesson records, the complete final RAM image, observed RAM
   calls proving no endpoint prefetch, and a direct fourth CPU step remaining
   an unsupported attempt rather than a lesson-completion result.
8. Reset's ordered reads and DP/F/I changes across mixed initial flags and
   nonzero pointers/registers; preservation of all other modeled state and RAM;
   repeated reset, changed vectors, and resumed execution at targets including
   `0000`, `3456`, and `FFFF`. Restart restores the full original state/image.
9. Detached records across execution, reset, restart, host memory edits, and
   JavaScript edits to returned objects; public readonly types and outcome/reason
   relationships, including a reset record being distinct from a step record.

Implement in small reviewed changes: state, snapshots, fixture, LDA immediate,
and step records; reset and its record; ADDA immediate; then STA extended and
the complete lesson. The initial fixture contains the entire seven-byte
program even while its later instructions remain unsupported.

Use private operation helpers composed with recorded operand/address access
through the opcode table. Keep CPU-specific byte order and flag behavior
explicit. No generic CPU base class, shared opcode schema, or DSL is required.
After this lesson, focused register, stack, addressing, and I/O examples still
need to exercise the distinctions identified in the [CPU roadmap](cpu-roadmap.md).
Three versions of this calculation alone do not settle those interfaces.

## Findings from dromaios-coco

Reviewed the existing repository at
[`099aeb7c54f0a3d27299bcad490ad883ead9fa6f`][coco-tree]. These are design evidence
and targeted observations, not a certification of the complete emulator.

- **Keep one source of register state.** The [CPU's D getter/setter][coco-cpu]
  already derives D from A/B and splits D writes into those bytes. Use that
  relationship here, with detached numeric snapshots and no public mutation API.
- **Compose operations with operand access.** The [instruction definitions][coco-instructions]
  pass addressing-specific reads into operation families, and keep the extended
  store's address resolution separate from a data read. Retain that separation.
  Broad opcode-family generators can wait until more forms justify them.
- **Specify reset and stopping independently.** The old CPU reset clears A/B,
  X/Y, S/U, and CC before setting F/I and reading the vector. A targeted run of
  the proposed lesson confirmed that reset clears the registers while leaving
  the stored result intact. The new reset follows the narrower policy above.
  The old step path advances PC before reporting unsupported instructions and
  fetches a second byte after a prefix. Here both boundaries stop without
  changing state, using the explicit prefix policy above.
- **Check prose against hardware.** The [CoCo architecture note][coco-architecture]
  assigns BSR/JSR to U, but those calls use S in both Motorola's instruction
  definitions and the reference implementation. Do not carry that statement
  into the two-stack model or later lessons.
- **Keep inspection separate from CPU access.** A [memory watchpoint][coco-memory]
  rereads instruction bytes through the normal memory read path, which also
  routes accesses to PIAs. Completed-step explanations should use captured
  records; future previews need side-effect-free inspection. This agrees with
  the [6502 reference notes](6502-reference-notes.md).
- **Revisit broader test ideas later.** The [embedded CPU tests][coco-main]
  include D transfers, stack round-trips, indexed addressing, and flag operations.
  They are candidates for later focused examples. Derive new expectations from
  hardware references, and keep Dromaios tests independent of the browser and
  CoCo devices. The old CPU's timing counters, interrupt logic, and trace buffer
  do not expand this example's scope.

A focused run of the pinned CPU with flat observed RAM confirmed the proposed
instruction sequence's A/D values, flag changes, and ordered accesses. Separate
probes confirmed D writes splitting into A/B, register clearing on reset, and
PC advancement by one for an unsupported base byte or two for an unsupported
prefixed opcode. These checks inform the comparison; acceptance tests for the
new implementation must use the specification's own expected values.

## References

- [Motorola MC6809–MC6809E programming manual, sections 1–3][model]: register
  relationships, addressing, reset, NMI arming, and vector byte order.
- [Motorola instruction details, Appendix A][instructions]: LD (8-bit), ADD
  (8-bit), ST (8-bit), calls, and RESTART.
- [Motorola instruction summary, Appendix D][summary]: opcode forms, lengths,
  and affected flags; [Appendix F opcode map][opcodes]: prefixes and opcode `00`.
  These links are HTML transcriptions of the manufacturer manual, not emulator
  documentation.
- The pinned CoCo sources linked above provide implementation ideas. The
  initial values, preservation policy for reset, prefix rejection, record API,
  and omitted accesses are deliberate choices for this model.

Each implementation change waits for maintainer review and
explicit permission to commit, as recorded in [AGENTS.md](../AGENTS.md).

[model]: https://www.maddes.net/m6809pm/sections.htm
[instructions]: https://www.maddes.net/m6809pm/appendix_a.htm
[summary]: https://www.maddes.net/m6809pm/appendix_d.htm
[opcodes]: https://www.maddes.net/m6809pm/appendix_f.htm
[coco-tree]: https://github.com/jtauber/dromaios-coco/tree/099aeb7c54f0a3d27299bcad490ad883ead9fa6f
[coco-cpu]: https://github.com/jtauber/dromaios-coco/blob/099aeb7c54f0a3d27299bcad490ad883ead9fa6f/js/cpu.js
[coco-instructions]: https://github.com/jtauber/dromaios-coco/blob/099aeb7c54f0a3d27299bcad490ad883ead9fa6f/js/instructions.js
[coco-architecture]: https://github.com/jtauber/dromaios-coco/blob/099aeb7c54f0a3d27299bcad490ad883ead9fa6f/ARCHITECTURE.md
[coco-memory]: https://github.com/jtauber/dromaios-coco/blob/099aeb7c54f0a3d27299bcad490ad883ead9fa6f/js/mem.js
[coco-main]: https://github.com/jtauber/dromaios-coco/blob/099aeb7c54f0a3d27299bcad490ad883ead9fa6f/js/main.js
