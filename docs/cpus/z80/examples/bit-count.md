# Z80 bit counting and nested calls

[Model contract](../model.md) ·
[Machine definition](../../../../src/machines/z80/bit-count-example.machine) ·
[Tests](../../../../tests/machines/z80/bit-count-example.test.ts) ·
[Coverage](../../coverage.md#z80)

Count the set bits in three bytes while preserving the caller's main register
bank and flags. A CB shift supplies carry to a conditional call, and nested
subroutines share the external memory stack. The generated factory is
`createZ80BitCountExample()`; its memory-only companion is
`createZ80BitCountExampleMemory()`.

The explicit initial state sets `interruptDeferred` and `nmiDeferred` to false.

## Initial state and memory

All addresses and byte/word values below are hexadecimal unless explicitly
identified as decimal. The `.machine` definition gives every stored field.

| State | Value |
| --- | --- |
| A, BC, DE, HL | `11`, `2233`, `4455`, `6677` |
| S/Z/H/PV/N/C | All set |
| Alternate A, BC, DE, HL | `88`, `99AA`, `BBCC`, `DDEE` |
| Alternate S/Z/H/PV/N/C | `0/1/0/1/0/1` |
| IX, IY, PC, SP | `1234`, `5678`, `0200`, `ABCD` |
| I, R, IM | `42`, `FE`, `2` |
| IFF1, IFF2, halted | true, false, false |

RAM is 64 KiB, initially zero outside the explicitly loaded blocks. Input bytes
at `0080`–`0082` are `81 7F A5`. Their binary representations contain **2, 7,
and 4** set bits, so the expected total is **13 decimal (`0D`)**. Output `0084`
starts as `CC`; guards `007F`, `0083`, and `0085` contain `AA`, `BB`, and `55`.
Stack guards at `8FEF` and `9000` contain `AA` and `BB`.

## Program

The main program sets SP, calls the counting routine, and halts after it returns.
The outer routine saves AF/BC/DE/HL and traverses the input with HL and B.
Each byte is passed in A to a helper that preserves BC, counts eight bits, and
returns the count in E. SRL A moves each low bit into C; CALL C invokes an
increment helper only for set bits. DJNZ preserves flags while testing B.
The outer routine accumulates each result in D, writes the total, and restores
the saved registers and flags.

| Address | Bytes | Instruction |
| --- | --- | --- |
| `0200` | `31 00 90` | LD SP,9000 |
| `0203` | `CD 20 02` | CALL 0220 |
| `0206` | `76` | HALT |
| `0220` | `F5` | PUSH AF |
| `0221` | `C5` | PUSH BC |
| `0222` | `D5` | PUSH DE |
| `0223` | `E5` | PUSH HL |
| `0224` | `21 80 00` | LD HL,0080 |
| `0227` | `06 03` | LD B,03 |
| `0229` | `16 00` | LD D,00 |
| `022B` | `7E` | LD A,(HL) |
| `022C` | `CD 40 02` | CALL 0240 |
| `022F` | `7A` | LD A,D |
| `0230` | `83` | ADD A,E |
| `0231` | `57` | LD D,A |
| `0232` | `2C` | INC L |
| `0233` | `10 F6` | DJNZ 022B |
| `0235` | `7A` | LD A,D |
| `0236` | `32 84 00` | LD (0084),A |
| `0239` | `E1` | POP HL |
| `023A` | `D1` | POP DE |
| `023B` | `C1` | POP BC |
| `023C` | `F1` | POP AF |
| `023D` | `C9` | RET |
| `0240` | `C5` | PUSH BC |
| `0241` | `06 08` | LD B,08 |
| `0243` | `1E 00` | LD E,00 |
| `0245` | `CB 3F` | SRL A |
| `0247` | `DC 50 02` | CALL C,0250 |
| `024A` | `10 F9` | DJNZ 0245 |
| `024C` | `C1` | POP BC |
| `024D` | `C9` | RET |
| `0250` | `1C` | INC E |
| `0251` | `C9` | RET |

## Expected result and records

The example halts after **151 instructions**. There are 24 SRL instructions,
so R receives 175 opcode-fetch increments: one per instruction and an extra
one for each CB prefix. Its low seven bits wrap while bit 7 stays set,
leaving R at `AD`. PC is `0207`, SP is `9000`, and `halted` is true. Every
other register, modeled flag, and interrupt latch matches its initial value.

Output `0084` is `0D`. Input bytes, guards, and code remain intact. The deepest
SP is `8FF0`, with three return addresses and five saved register-pair words
on the stack. Popping leaves the memory bytes behind:

| Address | Final low/high bytes | Last saved value |
| --- | --- | --- |
| `8FF0` | `4A 02` | Return from increment helper |
| `8FF2` | `33 01` | Outer BC on the final byte iteration |
| `8FF4` | `2F 02` | Return from byte helper |
| `8FF6` | `77 66` | Caller HL |
| `8FF8` | `55 44` | Caller DE |
| `8FFA` | `33 22` | Caller BC |
| `8FFC` | `D7 11` | Caller AF under the six-flag packing policy |
| `8FFE` | `06 02` | Return to main |

Every record includes full before/after snapshots, exact captured instruction
bytes, and ordered memory transactions. CALL reads all three instruction bytes
before writing high then low return bytes. An untaken CALL C reads those same
three bytes without accessing the stack. RET reads low then high. SRL A reads
only its two opcode bytes; its shifted result and flags feed the next call.
No target fetch or dummy cycle is synthesized.

## Acceptance checks

- Independently authored expectations match all 151 records, actual RAM calls,
  final state, and the entire initial/final memory image.
- Stopping and resuming at every instruction boundary gives the same trace,
  including while return addresses and saved flags are live on the stack.
- Already halted steps make no accesses. Reset applies the model's defined
  register changes while retaining stack memory and the output; earlier records
  survive reset and caller memory edits.
- Factories create fresh components and the original memory image.
- Three zero bytes produce `00` in **125 instructions**; three `FF` bytes produce
  `18` in **173 instructions**, exercising both conditional-call paths while
  preserving registers, flags, and stack guards.

Instruction counts measure bounded runner steps, not clock cycles. Interrupts
and I/O remain outside this example and the current CPU-only checkpoint.
