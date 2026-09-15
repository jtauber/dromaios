# 68000 immediate arithmetic and logic example

[Model contract](../model.md#immediate-arithmetic-and-logic) ·
[Machine definition](../../../../src/machines/68000/alu-example.machine) ·
[Example tests](../../../../tests/machines/68000/alu-example.test.ts)

This program transforms two bytes, a word, and a long word in RAM, compares
the results, and reads them back into a data register. It combines ADDI, SUBI,
ANDI, ORI, EORI, and CMPI with byte/word/long operands. Its traces distinguish
carry from signed overflow, show X surviving logic and comparison, and expose
address auto-updates without duplicate increments during read/modify/write.

## Initial state and memory

| Registers | Values |
| --- | --- |
| D0, D1, D2, D3 | `11223344`, `55667788`, `99AABBCC`, `DDEEFF00` |
| D4, D5, D6, D7 | `01234567`, `89ABCDEF`, `FEDCBA98`, `76543210` |
| A0, A1, A2, A3 | `10000000`, `20000000`, `30000000`, `40000000` |
| A4, A5, A6 | `50000000`, `60000000`, `70000000` |
| USP, SSP, PC | `34008000`, `56009000`, `AB002000` |
| interruptMask | `2` |
| halted, tracePending | `false`, `false` |
| X, N, Z, V, C, T, S | `1`, `0`, `1`, `1`, `1`, `0`, `0` |

The 16 MiB RAM image starts zero-filled. Reset vectors at `000000` contain
`56 00 90 00 AB 00 20 00`, supplying SSP `56009000` and PC `AB002000`.
The 74-byte program starts at physical `002000`. At physical `002FFE`, the
bytes are `DE AD 7F 00 AB CD 11 22 33 44 BE EF`; `DE AD` and `BE EF` guard
the eight-byte data block. A7 initially exposes USP. Construction does not
reset or execute the CPU.

## Program and expected execution

All PC values below have the logical prefix `AB00`. Instruction immediates,
displacements, and register values are hexadecimal. `XNZVC` lists the five
condition flags after each instruction; T, S, and the interrupt mask stay unchanged.
The machine definition gives the literal instruction bytes beside each mnemonic.

| PC | Instruction | Result / address update | XNZVC |
| --- | --- | --- | --- |
| `2000` | `MOVEA.L #AB003000,A0` | A0 = `AB003000`; preserve flags | `10111` |
| `2006` | `ADDI.B #1,(A0)+` | `7F` → `80`; A0 = `AB003001` | `01010` |
| `200A` | `SUBI.B #1,(A0)+` | `00` → `FF`; A0 = `AB003002` | `11001` |
| `200E` | `ANDI.W #0FFF,(A0)` | `ABCD` → `0BCD` | `10000` |
| `2012` | `ORI.W #8000,(A0)+` | `0BCD` → `8BCD`; A0 = `AB003004` | `11000` |
| `2016` | `EORI.L #FFFFFFFF,(A0)` | `11223344` → `EEDDCCBB` | `11000` |
| `201C` | `SUBI.L #1,(A0)` | `EEDDCCBB` → `EEDDCCBA` | `01000` |
| `2022` | `ADDI.L #11223346,(A0)+` | `EEDDCCBA` → `00000000`; A0 = `AB003008` | `10101` |
| `2028` | `CMPI.L #0,-(A0)` | Equal; A0 = `AB003004`; no write | `10100` |
| `202E` | `MOVE.L -(A0),D0` | D0 = `80FF8BCD`; A0 = `AB003000` | `11000` |
| `2030` | `ANDI.L #00FFFFFF,D0` | D0 = `00FF8BCD` | `10000` |
| `2036` | `EORI.B #FF,D0` | D0 = `00FF8B32` | `10000` |
| `203A` | `ORI.W #8000,D0` | D0 = `00FF8B32`; N reflects the word | `11000` |
| `203E` | `ADDI.W #74CE,D0` | D0 = `00FF0000`; carry out of the low word | `10101` |
| `2042` | `CMPI.B #1,(A0)+` | `80` − `01` overflows; A0 = `AB003001`; no write | `10010` |
| `2046` | `CMPI.B #FF,(A0)+` | Equal; A0 = `AB003002`; no write | `10100` |

The final PC is `AB00204A`. D0 is `00FF0000` and A0 is `AB003002`;
other registers are unchanged. Physical `003000`–`003007` contains
`80 FF 8B CD 00 00 00 00`. All other RAM, including the guards and program,
is unchanged.

Every immediate instruction fetches its opcode, immediate, and any address
extensions before reading its destination. Memory arithmetic/logic reads the
selected bytes, then writes that same address in ascending order, high byte
first. Each `(A0)+` or `-(A0)` updates A0 once. CMPI reads without writing;
its predecrement and postincrement still take effect. Byte/word operations on
D0 preserve its upper bytes, including on carry out of the selected size.

## Running and acceptance checks

`runCpu(cpu, { maxSteps: 16, endAddress: 0xAB00204A })` returns sixteen
executed records and `stopReason: "completed"`. The physical address `00204A`
is not the logical endpoint. A budget of eight instructions pauses immediately
before the first comparison; a further eight completes the program. A CPU
restored from that snapshot gives the same remaining records with the same RAM.

External reset reloads SSP/PC, sets S, clears T, and masks interrupts. It
preserves RAM and the data/address registers, so rerunning would transform the
current RAM values. Creating the example again restores the original image.
Tests also execute a fresh image after reset in supervisor mode.

The tests specify all sixteen full records independently, compare their access
lists with actual RAM calls, and check the complete initial/final images. They
cover factory isolation, logical completion, bounded resumption, snapshot
restoration, retained traces, changed input, and reset preservation. CPU tests
supply the broader size/address, flag, boundary, and alignment coverage.

Encoding and flag expectations follow Motorola's
[M68000 Family Programmer's Reference Manual](https://www.nxp.com/docs/en/reference-manual/M68000PRM.pdf):
ADDI (4-9–4-10), ANDI (4-18–4-19), CMPI (4-79–4-80), EORI (4-102–4-103),
ORI (4-153–4-154), and SUBI (4-179–4-180), restricted to the original 68000.
