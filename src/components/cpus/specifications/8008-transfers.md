# Intel 8008: moving bytes between registers and memory

This executable chapter defines the 8008's 63 register/memory transfers and
eight immediate loads. The same definitions generate their execution bodies
and opcode bindings. See the [CPU model](../../../../docs/cpus/8008/model.md)
for fetching, interrupts, and the address-register stack, and the
[language guide](../../../../docs/cpus/literate-specifications.md) for syntax.

## Seven registers and one memory operand

A, B, C, D, E, H, and L each hold a complete byte. Transfers do not read or write
the flags, the selected address-stack slot, its selector, or the halted latch.
This chapter therefore declares only the seven byte registers it uses.

```cpu
cpu "8008"
register A: 8
register B: 8
register C: 8
register D: 8
register E: 8
register H: 8
register L: 8
```

The eighth operand, M, means the memory byte addressed by H:L. Concatenating H
and L produces sixteen bits, but the 8008 has fourteen address bits. Masking
with `$3FFF` makes the upper two H bits irrelevant to addressing while retaining
them in the register itself. Thus `$3FFF`, `$7FFF`, `$BFFF`, and `$FFFF` all
address the same byte; a transfer *from H* still reads all eight bits of H.

```cpu
source throughHL "memory address through low 14 bits of HL": 16 {
  high = register H
  low = register L
  return and(concat(high, low), u16($3FFF))
}
```

Each three-bit selector uses the order A/B/C/D/E/H/L/M. A register entry can be
read or written directly. A memory entry resolves its address at the time of
the operand read or write; selecting M does not eagerly read H or L.

```cpu
modes bytes {
  000 "A" = register A
  001 "B" = register B
  010 "C" = register C
  011 "D" = register D
  100 "E" = register E
  101 "H" = register H
  110 "L" = register L
  111 "M" = memory throughHL
}
```

## Register and memory transfers

The encoding is `11 ddd sss`: `ddd` selects the destination and `sss` the source.
Intel names a transfer `Lds`, placing the destination before the source: LBA
loads B from A, LAM loads A from memory, and LMA stores A to memory. The name
template below uses those selected operand labels.

The `11 111 111` slot belongs to HLT, so it is explicitly excluded. Transfers
between a register and itself remain real operations: read once, then write
once. A store resolves H:L after capturing its source. In particular, storing
H or L captures that source byte before rereading H and L for the address.

Use the selected byte registers; memory uses H then L at the access point.
Mask the memory address to 3FFF, preserving the full H and L registers.
Capture the source before writing the destination, including self-transfers and unchanged writes.
Stores never read the destination. Do not access flags or control state.
A failed source read or fetch prevents writeback.

```cpu
family transfer "11 ddd sss" for d in bytes, s in bytes named "L{d}{s}" except "11 111 111" {
  result = operand s
  operand d <- result
}
```

## Immediate loads

The encoding `00 ddd 110` selects the destination in the same way, followed by
one immediate byte. All eight destinations exist, including M. Fetching happens
before any destination effect; LMI resolves H:L after that fetch. Fetch failure
prevents destination reads and writes. Fetching advances the selected address
register in ordinary execution, while interrupt-supplied bytes follow the
CPU's existing supplied-stream contract.

Use the selected byte registers; memory uses H then L at the access point.
Mask the memory address to 3FFF, preserving the full H and L registers.
Capture the source before writing the destination, including self-transfers and unchanged writes.
Stores never read the destination. Do not access flags or control state.
A failed source read or fetch prevents writeback.

```cpu
family immediate "00 ddd 110" for d in bytes named "L{d}I n" {
  result = fetch
  operand d <- result
}
```

The remaining 8008 instructions and lifecycle behavior retain their existing
definitions. HLT is still implemented, but is outside these transfer families.
