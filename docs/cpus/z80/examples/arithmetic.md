# Z80 arithmetic example

Run the same eight program bytes as the introductory
[8080 example](../../8080/examples/arithmetic.md), with Z80 instruction names
and flag semantics: load 2, add 3, store 5 at address 0080, and halt.

[Model contract](../model.md) ·
[Machine definition](../../../../src/machines/z80/example.machine) ·
[Example tests](../../../../tests/machines/z80/example.test.ts) ·
[CPU tests](../../../../tests/components/cpus/z80)

The explicit initial state sets `interruptDeferred` and `nmiDeferred` to false.

## Initial state and program

The factory creates 64 KiB RAM, initially zero, and loads these bytes at 0000:

| Address | Bytes | Instruction |
| --- | --- | --- |
| 0000 | `3E 02` | `LD A,02H` |
| 0002 | `C6 03` | `ADD A,03H` |
| 0004 | `32 80 00` | `LD (0080H),A` |
| 0007 | `76` | `HALT` |

Every register in both banks, IX, IY, PC, SP, I, and R starts at zero. All six
flags in both banks are clear. IFF1 and IFF2 are false, IM is 0, and `halted`
is false. These are explicit lesson values, not inferred power-on state.
There is no `end` declaration; the program stops with HALT.

## Expected execution

Each step's `before` equals the preceding state and its `after` contains the
changes below. Instruction bytes match the program table above.

| Step | PC after | A after | R after | Ordered accesses | Outcome |
| --- | --- | --- | --- | --- | --- |
| LD | 0002 | 02 | 01 | Read 0000 → 3E; read 0001 → 02 | executed |
| ADD | 0004 | 05 | 02 | Read 0002 → C6; read 0003 → 03 | executed |
| Store | 0007 | 05 | 03 | Read 0004 → 32; read 0005 → 80; read 0006 → 00; write 0080 ← 05 | executed |
| HALT | 0008 | 05 | 04 | Read 0007 → 76 | halted |

ADD replaces S/Z/H/PV/N/C with six clear flags: the result is positive and
nonzero, with no half carry, signed overflow, subtraction, or carry. LD, the
store, and HALT preserve flags. The 8080 sets its P flag for the even parity
of 05; the Z80 leaves P/V clear because ADD gives that flag overflow semantics.

The alternate bank, all other registers, IM, and both interrupt-enable latches
remain at their initial values. Only HALT changes `halted`, setting it true.
Final RAM differs from the initial image only at 0080, which contains 05.
An already halted step has no instruction or accesses and leaves R at 04.

## Acceptance checks

- The memory-only and complete factories create independent components with
  exactly the specified program and complete initial state.
- Four steps produce the complete expected records and actual RAM accesses;
  the final memory image contains the program and its single stored result.
- The shared runner halts at an exact budget of four. Smaller budgets resume
  from current state; a caller endpoint at 0007 stops before HALT with R = 03.
  Resuming without that endpoint executes HALT and leaves R = 04.
- Reset clears PC, I, R, interrupt latches, IM, and HALT, preserving A = 05,
  other state, stored data, and any modified program bytes. Restarting through
  the factory restores the original program and initial values.
- Retained records survive later execution, reset, and a fresh example.
- CPU tests verify arithmetic beyond this program, including overflow and
  carry boundaries, with paired 8080 checks that keep parity and overflow distinct.
