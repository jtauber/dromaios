# Motorola 68000: moving a word

This executable chapter defines 192 `MOVE.W` encodings: 64 data-register
copies, 64 loads through an address register, and 64 stores through an address
register. Other sizes and addressing modes retain their existing definitions.
See the [CPU model](../../../../docs/cpus/68000/model.md) for address decoding,
exception delivery, and instruction retirement, and the
[language guide](../../../../docs/cpus/literate-specifications.md) for syntax.

## A word within a data register

A data register holds 32 bits, but a word transfer reads its low 16 bits.
Writing a word preserves the destination's current upper 16 bits. The source
is captured first; the destination's preserved portion is read at writeback.
Even a register copied to itself follows that order.

```cpu
cpu "68000"
register D0: 32
register D1: 32
register D2: 32
register D3: 32
register D4: 32
register D5: 32
register D6: 32
register D7: 32
flag N
flag Z
flag V
flag C

modes dataRegisters {
  000 "D0" = register D0
  001 "D1" = register D1
  010 "D2" = register D2
  011 "D3" = register D3
  100 "D4" = register D4
  101 "D5" = register D5
  110 "D6" = register D6
  111 "D7" = register D7
}
```

Only a completed destination write changes the condition codes. N reports bit
15 of the transferred word, Z reports an all-zero word, and V and C clear.
X and the trace/supervisor flags are preserved. The word policy also serves
the remaining TypeScript-authored word operations.

```cpu
policy wordResult "68000 result" (result: 16) {
  N = negative(result)
  Z = zero(result)
  V = 0
  C = 0
}
```

The operation word is `0011 ddd mmm sss rrr`. `0011` selects word-sized MOVE;
`ddd/mmm` describe the destination and `sss/rrr` the source. Mode `000` selects
a data register on either side. Unlike MOVEA, these forms update the condition
codes and do not sign-extend the word to replace the whole register.

Capture the source word before reading the destination's live upper word.
Write the destination before setting N/Z and clearing V/C; preserve all other
flags. Register copies make no memory access, including self-copies.

```cpu
family registerCopy "0011 ddd 000 000 rrr" for d in dataRegisters, r in dataRegisters named "MOVE.W {r},{d}" {
  source = operand r
  result = truncate(source, 16)
  preserved = operand d
  operand d <- or(and(preserved, u32($FFFF0000)), extend(result, 32))
  apply wordResult(result)
}
```

## Address-register indirect

Mode `010` means `(An)`: use the address register's contents without increment
or decrement. The three-bit code below is passed to the CPU's existing effective
address resolver. A7 resolves to SSP in supervisor mode or USP in user mode;
only the selected bank is read, at this operand's turn. The chapter does not
create an additional stored A7 register or duplicate that decoding rule.

```cpu
codes addressRegisters {
  000 "A0"
  001 "A1"
  010 "A2"
  011 "A3"
  100 "A4"
  101 "A5"
  110 "A6"
  111 "A7"
}
```

The resolver returns a full 32-bit logical address. The memory connection
projects each access onto the 24-bit physical bus. Word accesses require an
even logical address; `lowBit(address)` detects an odd one before any byte at
that address is accessed. The fault returns to the CPU boundary for normal
address-error delivery. Thrown host errors and explicit bus errors retain the
same boundary handling as other instructions.

In the byte-access model, a word occupies a high byte followed by a low byte.
The expressions below retain logical addresses until the connection applies
physical projection. Address arithmetic wraps at 32 bits. A failed second
read leaves the destination and flags untouched; it cannot undo the first read.

Resolve the source and reject an odd address before reading its high then low
byte. After both reads, commit pending address updates and preserve the live
upper word of the destination. Write the complete result before setting N/Z
and clearing V/C. A failed read prevents writeback and flag changes.

```cpu
family load "0011 ddd 000 010 rrr" for d in dataRegisters, r in addressRegisters named "MOVE.W ({r}),{d}" {
  code = operand r
  address = resolve(16, u3(2), code)
  fault alignment read(address) if lowBit(address)
  high = memory(address)
  low = memory(add(address, u32(1)))
  result = concat(high, low)
  commit addresses
  preserved = operand d
  operand d <- or(and(preserved, u32($FFFF0000)), extend(result, 32))
  apply wordResult(result)
}
```

The destination mode `010` uses the same address-register codes. Stores
capture the source before resolving that destination and never read its old
memory contents. The address-update commit is explicit, as for other MOVE
forms, although plain `(An)` stages no updates. If the second write fails,
the first byte remains written and all flags retain their previous values.

Capture the source word before resolving the destination. Reject an odd
address before committing pending address updates or writing memory. Write
the high byte then the low byte, and only then set N/Z and clear V/C.
Never read destination memory; a failed write retains completed bytes and
preserves flags.

```cpu
family store "0011 ddd 010 000 rrr" for d in addressRegisters, r in dataRegisters named "MOVE.W {r},({d})" {
  source = operand r
  result = truncate(source, 16)
  code = operand d
  address = resolve(16, u3(2), code)
  fault alignment write(address) if lowBit(address)
  commit addresses
  memory(address) <- highByte(result)
  memory(add(address, u32(1))) <- lowByte(result)
  apply wordResult(result)
}
```
