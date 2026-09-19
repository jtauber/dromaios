# MOS 6502: loading and storing the accumulator

This chapter is executable source for all eight documented LDA encodings and
all seven STA encodings. Its `cpu` fences also define the address sources shared
by the remaining 6502 instruction definitions. The build reads these fences;
the paragraphs immediately before the LDA and STA fences become their generated
instruction explanations.

The model records instruction-level effects in order. It does not describe
cycles or dummy reads. If a memory access fails, execution stops at that access:
earlier effects remain and later effects do not occur. See the
[CPU model](../../../../docs/cpus/6502/model.md) for the complete execution
contract and the [language guide](../../../../docs/cpus/literate-specifications.md)
for this prototype's syntax and boundaries.

## State used by this chapter

A is the accumulator. X and Y supply eight-bit indices. N records the sign bit
of a loaded byte; Z records whether that byte is zero. These declarations check
the existing CPU state schema; this chapter does not yet own the complete state
layout, opcode fetching, reset, or interrupt recognition.

```cpu
cpu "6502"
register A: 8
register X: 8
register Y: 8
flag N
flag Z
```

## Addressing a byte

An address source returns a sixteen-bit address without reading the final data
byte. This distinction lets LDA read that byte and STA write it. Each source has
its own capture scope. `fetch` consumes the next instruction byte; `register`
reads live state at that point. An expression uses already captured values.

Zero-page addressing extends an eight-bit offset to sixteen bits. For indexed
zero-page addressing, addition happens **before** extension: `$FF + $01` wraps
to `$00`. The Y variant is shared with the index-register instructions outside
this chapter; LDA and STA use the X variant.

```cpu
source zeroPage "zero page": 16 {
  offset = fetch
  return extend(offset, 16)
}
source zeroPageX "zero page indexed by X": 16 {
  offset = fetch
  index = register X
  return extend(add(offset, index), 16)
}
source zeroPageY "zero page indexed by Y": 16 {
  offset = fetch
  index = register Y
  return extend(add(offset, index), 16)
}
```

Absolute addresses arrive low byte first. `concat(high, low)` joins the two
bytes into a word. For indexed absolute addressing, the index is extended before
addition, so a carry crosses a page boundary and `$FFFF + $01` wraps to `$0000`.

```cpu
source absolute "absolute address, low byte first": 16 {
  low = fetch
  high = fetch
  return concat(high, low)
}
source absoluteX "absolute indexed by X": 16 {
  low = fetch
  high = fetch
  index = register X
  return add(concat(high, low), extend(index, 16))
}
source absoluteY "absolute indexed by Y": 16 {
  low = fetch
  high = fetch
  index = register Y
  return add(concat(high, low), extend(index, 16))
}
```

The two indirect modes read a low-first pointer from zero page. In both modes,
the pointer's high-byte address wraps within zero page: a pointer at `$FF` reads
its high byte from `$00`, not `$0100`. `u8($01)` makes the width of that addition
explicit. Indexed indirect adds X before reading the pointer; indirect indexed
reads the complete pointer before reading Y and adding it to the address.

```cpu
source indexedIndirect "indexed indirect (zero page,X)": 16 {
  offset = fetch
  index = register X
  pointer = add(offset, index)
  low = memory(extend(pointer, 16))
  high = memory(extend(add(pointer, u8($01)), 16))
  base = concat(high, low)
  return base
}
source indirectIndexed "indirect indexed (zero page),Y": 16 {
  offset = fetch
  pointer = offset
  low = memory(extend(pointer, 16))
  high = memory(extend(add(pointer, u8($01)), 16))
  base = concat(high, low)
  index = register Y
  return add(base, extend(index, 16))
}
```

An immediate operand is the next instruction byte itself. It has no destination
address, so it is available to loads but cannot be selected by a store.

```cpu
source immediateByte "immediate byte": 8 {
  byte = fetch
  return byte
}
```

## Encoding the addressing mode

These instructions share the pattern `aaa bbb 01`: `aaa=101` selects LDA and
`aaa=100` selects STA. The three `b` bits select the following modes in binary
order. A `memory` entry provides both its address and the byte read there; a
`value` entry provides only a value. Selecting `.address` therefore omits the
immediate encoding, rather than inventing an immediate STA instruction.

```cpu
modes accumulator {
  000 "(zero page,X)" = memory indexedIndirect
  001 "zero page" = memory zeroPage
  010 "#byte" = value immediateByte
  011 "absolute" = memory absolute
  100 "(zero page),Y" = memory indirectIndexed
  101 "zero page,X" = memory zeroPageX
  110 "absolute,Y" = memory absoluteY
  111 "absolute,X" = memory absoluteX
}
```

## Loading A

Only N and Z change on a load. A policy updates its listed flags together and
preserves every unlisted flag. Its parameter is a captured byte, so flags do not
depend on a subsequent read of live A. This policy also serves other 6502
instructions whose result sets N and Z.

```cpu
policy NZ "6502 result N/Z" (result: 8) {
  N = negative(result)
  Z = zero(result)
}
```

Finish the source reads before writing the destination, then set N/Z from the captured byte.
Preserve V, D, I, and C. A failed source read leaves the destination and every flag unchanged.

```cpu
family LDA "101 bbb 01" for b in accumulator.read {
  result = source b
  A <- result
  apply NZ(result)
}
```

## Storing A

Resolve the address once, including any pointer reads, before capturing the source register.
Write that byte once, even if unchanged, without reading the destination. Preserve every flag.
A failed access prevents later effects; completed fetches and pointer reads remain.

```cpu
family STA "100 bbb 01" for b in accumulator.address {
  address = source b
  byte = register A
  memory(address) <- byte
}
```

The rest of the CPU continues to use TypeScript-authored semantic definitions.
This chapter is the maintained source for these two families and their shared
addressing rules; generated TypeScript is a disposable build artifact.
