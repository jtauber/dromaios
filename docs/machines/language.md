# Machine language

Dromaios uses `.machine` files for its flat-RAM example definitions. The language
has four declarations: `ram`, `cpu`, `memory`, and optional `end`. All numeric
data is hexadecimal by default. Register and flag names are uppercase by
convention; flags use `1` for set and `0` for clear.

See [machine definitions](definitions.md) for example source files and
the build workflow.

## Example

The [6502 lesson](../cpus/6502/examples/arithmetic.md) supplies a reset vector as a second memory
block. `end` records the caller's completion address, one byte past the program.

```text
ram 10000

cpu 6502 {
    A = 00  X = 00  Y = 00
    PC = 0200  SP = FF
    flags { N = 0  V = 0  D = 0  I = 1  Z = 0  C = 1 }
}

memory 0200 {
    18          // CLC
    A9 02       // LDA #2
    69 03       // ADC #3
    8D 80 00    // STA $0080
}

memory FFFC {
    00 02       // Reset vector: 0200, low byte first
}

end 0208
```

## Reading rules

- A file describes one machine. It has exactly one `ram` and one `cpu`
  declaration, zero or more `memory` blocks, and at most one `end` declaration.
  Top-level declarations can appear in any order. Memory blocks are applied in
  their source order.
- `ram` gives the byte count. This first version describes the existing flat
  64 KiB machines, so its supported value is `10000` (hexadecimal for 65,536).
  RAM starts at address zero and is filled with zero before loading images.
- `cpu` selects the model by name: `8080`, `6502`, `6809`, or `z80`. Its block contains
  the initial state. Stored registers and control latches use `name = value`;
  `flags { ... }` groups assignments to the flags. The Z80's `alternate { ... }`
  block contains another register bank and its own `flags` block. CPU model
  names are case-sensitive identifiers, not numeric data.
- CPU state field names are case-insensitive. Uppercase is the convention for
  registers and flags: `A`, `PC`, `SP`, `N`, `CY`. Keywords such as `cpu`, `flags`,
  `alternate`, and `memory` are lowercase. Descriptive control fields retain the
  spellings `interruptEnabled`, `iff1`, `iff2`, and `halted`. Duplicate detection
  ignores case, so assigning both `PC` and `pc` is an error. Register and flag names are resolved within
  their respective blocks for the selected CPU.
- Inside `flags`, each assignment supplies a bit value: `1` means set and `0`
  means clear. Every flag must appear exactly once; assignments can appear in
  any order. Missing flags, unknown names, repeated names, and values other
  than zero or one are errors.
- State is complete and explicit. Missing fields, duplicate fields, unknown
  fields, derived register views, wrong value types, and out-of-range values
  are errors. Control latches such as `interruptEnabled` and `halted` use the
  Boolean values `true` and `false`. Numeric flag bits map to the same Boolean
  state internally.
- All numeric data is unsigned hexadecimal. Thus bare `10` means sixteen,
  `100` means 256, and `FF` means 255. This applies equally to registers,
  addresses, RAM size, and bytes. Leading zeros affect presentation only.
  The first version has no decimal notation.
- Outside memory byte bodies, explicit forms are optional aliases: `0x100`,
  `0X100`, `$100`, `100h`, and `100H` mean the same as bare `100`, for every CPU.
  Suffix-form numbers start with a decimal digit (`0FFH`); the preferred bare
  form is simply `FF`.
- Hexadecimal digits accept either letter case. By convention, examples use
  uppercase digits `A` through `F`, two digits for byte registers, four for
  word registers and addresses, and a single digit for flag bits. Register
  ranges come from the CPU model; padding does not determine a register's width.
- Inside a memory body, every token is exactly two bare hexadecimal digits.
  Single digits, prefixed or suffixed numbers, and tokens longer than two
  digits are errors. No encoding keyword is needed.
- Braces delimit blocks; whitespace separates tokens. Indentation and line
  breaks are for readability. Assignments can share a line or occupy separate
  lines. Bytes continue across lines without commas, quotes, or continuation
  characters. An empty memory block contributes no bytes.
- `//` starts a comment through the end of the line. Assembly in comments
  explains the bytes; it does not generate or validate them. Instruction
  boundaries are determined by the CPU when executing, regardless of layout.
- `memory` gives a starting address. Bytes are written consecutively without
  address wrapping. Block starts must be within RAM and whole blocks must fit.
  Where blocks overlap, later bytes overwrite earlier ones.
- `end` is an optional caller completion address within RAM. It maps to the
  `endAddress` field. It neither executes instructions nor halts the CPU;
  the caller can stop stepping when PC reaches it. Omission leaves this
  metadata absent, as in the 8080 lessons that use HLT and the Z80 lesson that
  uses HALT.

Constructing a machine allocates RAM, loads its images, and constructs the CPU
with the supplied state. Every instance is fresh; construction performs no CPU
reset or execution.

## CPU state fields

All fields listed for the selected CPU are required, including every flag.

| CPU | Byte registers | Word registers | Flags | Control latches |
| --- | --- | --- | --- | --- |
| 8080 | A, B, C, D, E, H, L | PC, SP | S, Z, AC, P, CY | interruptEnabled, halted |
| 6502 | A, X, Y, SP | PC | N, V, D, I, Z, C | — |
| 6809 | A, B, DP | X, Y, S, U, PC | E, F, H, I, N, Z, V, C | — |
| z80 | A, B, C, D, E, H, L in both banks; I, R | IX, IY, PC, SP | S, Z, H, PV, N, C in both banks | iff1, iff2, halted |

The Z80 also requires `IM`, an integer in `0`–`2`, for its interrupt mode.
`PV` names the manual's P/V flag. Its initial state includes a complete alternate
bank using the same register and flag names in a separate scope:

```text
cpu z80 {
    A = 00  B = 00  C = 00  D = 00  E = 00  H = 00  L = 00
    flags { S = 0  Z = 0  H = 0  PV = 0  N = 0  C = 0 }
    alternate {
        A = 00  B = 00  C = 00  D = 00  E = 00  H = 00  L = 00
        flags { S = 0  Z = 0  H = 0  PV = 0  N = 0  C = 0 }
    }
    IX = 0000  IY = 0000  PC = 0000  SP = 0000
    I = 00  R = 00  IM = 0
    iff1 = false  iff2 = false  halted = false
}
```

Derived views such as 8080/Z80 `BC`, `DE`, and `HL`, and 6809 `D`, cannot be assigned,
including inside the Z80's alternate bank.
Supply their stored byte registers instead. The parser resolves names to the
CPU's existing TypeScript fields, for example `PC` to `pc` and `CY` to `cy`,
and converts numeric flag bits to Booleans.

## Errors

The [parser](../../src/machines/machine-language.ts) validates syntax, complete CPU
state, register widths, flag bits, and memory bounds before generating code.
Errors identify the filename, line, and column, with the offending source line
and a caret. For example, a block that runs past the end of RAM reports:

```text
lesson.machine:3:6: Memory block extends beyond address FFFF
  AA BB
     ^
```

## Scope and future extensions

This version describes explicit state and byte images for one CPU with flat
64 KiB RAM. More complex device wiring can still use TypeScript. The language
does not define instruction behavior or assemble the comments beside the bytes.

Repeated addresses remain a future design question. In the 6502 and 6809
examples, the starting address appears in PC, the program origin, and the
reset-vector bytes. The end address must also track the program length. Named
images with start/end references could reduce that maintenance, but would
introduce symbol resolution and address encoding. For now, literal byte images
keep the two reset-vector byte orders explicit.
