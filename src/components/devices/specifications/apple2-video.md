# Apple II video: text, low-resolution graphics, and display switches

Apple II video hardware repeatedly fetches screen bytes from main RAM. It
does not receive a stream of printed characters: changing a screen byte changes
what the next display refresh sees. The [machine](../../../machines/6502/apple2.md)
maps eight soft switches at C050–C057. Reads and writes select the same modes.

This chapter implements the switch state, text decoding, and low-resolution
graphics decoding. High-resolution graphics, the scanner, composite colour,
and floating bus are not yet modeled. Apple's [Reference Manual][manual], its screen-memory
maps and display controls, and the pinned [dromaios-apple2 video][reference]
are the references. This model uses the original 64-character uppercase set.

```device
device "apple2-video"

state {
  latch TEXT
  latch MIXED
  latch PAGE2
  latch HIRES
}

action initialize "A deterministic text-page-one power-on display" {
  TEXT <- 1
  MIXED <- 0
  PAGE2 <- 0
  HIRES <- 0
}

action reset "CPU reset preserves display switches" {
}

source validState "Every display-switch combination is valid" : flag {
  return 1
}
```

## Addressed switches

C050/C051 select graphics/text, C052/C053 full/mixed, C054/C055 page one/two,
and C056/C057 low/high resolution. Only the addressed pair changes; no CPU
instruction or display read resets the others. Read data is 00 in this profile,
the same declared undriven-bus approximation as the keyboard acknowledgement.

```device
action graphics "Select graphics" {
  TEXT <- 0
}

source readGraphics "Select graphics on a read" : 8 {
  perform graphics()
  return u8($00)
}

source writeGraphics "Select graphics on a write" (byte: 8): flag {
  perform graphics()
  return 1
}

action text "Select text" {
  TEXT <- 1
}

source readText "Select text on a read" : 8 {
  perform text()
  return u8($00)
}

source writeText "Select text on a write" (byte: 8): flag {
  perform text()
  return 1
}

action full "Select full" {
  MIXED <- 0
}

source readFull "Select full on a read" : 8 {
  perform full()
  return u8($00)
}

source writeFull "Select full on a write" (byte: 8): flag {
  perform full()
  return 1
}

action mixed "Select mixed" {
  MIXED <- 1
}

source readMixed "Select mixed on a read" : 8 {
  perform mixed()
  return u8($00)
}

source writeMixed "Select mixed on a write" (byte: 8): flag {
  perform mixed()
  return 1
}

action pageOne "Select pageOne" {
  PAGE2 <- 0
}

source readPageOne "Select pageOne on a read" : 8 {
  perform pageOne()
  return u8($00)
}

source writePageOne "Select pageOne on a write" (byte: 8): flag {
  perform pageOne()
  return 1
}

action pageTwo "Select pageTwo" {
  PAGE2 <- 1
}

source readPageTwo "Select pageTwo on a read" : 8 {
  perform pageTwo()
  return u8($00)
}

source writePageTwo "Select pageTwo on a write" (byte: 8): flag {
  perform pageTwo()
  return 1
}

action lores "Select lores" {
  HIRES <- 0
}

source readLores "Select lores on a read" : 8 {
  perform lores()
  return u8($00)
}

source writeLores "Select lores on a write" (byte: 8): flag {
  perform lores()
  return 1
}

action hires "Select hires" {
  HIRES <- 1
}

source readHires "Select hires on a read" : 8 {
  perform hires()
  return u8($00)
}

source writeHires "Select hires on a write" (byte: 8): flag {
  perform hires()
  return 1
}
```

## Forty columns, twenty-four interleaved rows

A text page occupies 1 KiB, but only 960 bytes are visible. Rows 0–7 begin
at offsets 000, 080, …, 380; rows 8–15 at 028, 0A8, …, 3A8; and rows 16–23
at 050, 0D0, …, 3D0. The eight bytes after each 120-byte group are screen holes.
Page one starts at 0400 and page two at 0800.

The address view accepts eight-bit row and column values. Display callers use
rows 0–23 and columns 0–39; the formula is defined at other byte inputs but
does not make them visible cells. The host reads the resulting address from
RAM directly, never through mapped I/O.

```device
source textAddress "Map a row and column through the selected text page" (row: 8, column: 8): 16 {
  pageTwo = latch PAGE2
  page = select(pageTwo, u16($0800), u16($0400))
  line = extend(and(row, u8($07)), 16)
  group = extend(shiftBits(row, right, 3), 16)
  groupOffset = truncate(multiply(group, u16($0028)), 16)
  offset = add(shiftBits(line, left, 7), groupOffset)
  return add(add(page, offset), extend(column, 16))
}

source visibleRow "Select text rows in full or mixed mode" (row: 8): flag {
  text = latch TEXT
  mixed = latch MIXED
  bottom: flag = not(lessThan(row, u8($14), unsigned))
  return and(lessThan(row, u8($18), unsigned), or(text, and(mixed, bottom)))
}
```

## Character and inverse decoding

Low six bits select a glyph: 00–1F represent @ through underscore, and 20–3F
represent space through question mark. Bytes 00–3F are inverse, 40–7F flash,
and 80–FF are normal. These views return a printable character code and its
current inverse attribute; they do not contain a host font or character ROM.

```device
source characterCode "Decode the original uppercase character set" (byte: 8): 8 {
  glyph = and(byte, u8($3F))
  return select(lessThan(glyph, u8($20), unsigned), add(glyph, u8($40)), glyph)
}

source inverse "Decode inverse and flashing attributes" (byte: 8, flash: flag): flag {
  return and(not(bit(byte, 7)), or(not(bit(byte, 6)), flash))
}
```

The browser uses a monospace font, not a reproduction of the character ROM's
pixel shapes. A host presentation phase alternates flashing characters every
half second while running and freezes while paused. It is not emulated CPU
time, scanner timing, or a claim about the original flash circuit's frequency.
Changing this phase cannot affect guest memory or execution.

## Low-resolution graphics: two blocks per byte

Low-resolution graphics reuses the text pages, including their interleaved rows
and screen holes. Each text cell becomes two vertically stacked colour blocks.
The full display has 40 columns and 48 block rows, numbered from zero. The
lower four bits of the byte colour the upper block (an even row); the upper
four bits colour the lower block (an odd row). A byte of A3 therefore draws
colour 3 above colour A. These are colour indices, not character codes.

The same TEXT, MIXED, PAGE2, and HIRES latches select the display. TEXT takes
precedence; low-resolution blocks are visible only with TEXT and HIRES clear.
Mixed mode shows block rows 0–39 above text rows 20–23. Full graphics shows all
48 block rows. Switching modes or pages changes interpretation, not RAM.

```device
source loresAddress "Two block rows share each interleaved text row" (row: 8, column: 8): 16 {
  address = source textAddress(shiftBits(row, right, 1), column)
  return address
}

source loresColour "The even block takes the low nibble; the odd block takes the high nibble" (byte: 8, row: 8): 8 {
  return select(bit(row, 0), shiftBits(byte, right, 4), and(byte, u8($0F)))
}

source visibleLoresRow "Select low-resolution block rows in full or mixed mode" (row: 8): flag {
  text = latch TEXT
  hires = latch HIRES
  mixed = latch MIXED
  limit = select(mixed, u8($28), u8($30))
  return and(not(or(text, hires)), lessThan(row, limit, unsigned))
}
```

Address callers use rows 0–47 and columns 0–39. As with `textAddress`, the
formula accepts other eight-bit coordinates without making them visible.
The colour view always returns an index from 0 to 15. The display reads main
RAM directly at these addresses; it never acknowledges keys or operates switches.

| Index (hex) | Colour | Index (hex) | Colour |
| --- | --- | --- | --- |
| 0 | Black | 8 | Brown |
| 1 | Magenta | 9 | Orange |
| 2 | Dark blue | A | Grey 2 |
| 3 | Purple | B | Pink |
| 4 | Dark green | C | Light green |
| 5 | Grey 1 | D | Yellow |
| 6 | Medium blue | E | Aquamarine |
| 7 | Light blue | F | White |

The hardware emits repeating bit patterns into a composite video signal, rather
than RGB values. Monitor adjustment and decoding affect the perceived colours.
The [browser renderer](../../../../site/interactive/apple2-screen-view.ts) uses
the pinned reference's fixed RGB palette as a presentation approximation,
including two distinct greys. It neither simulates NTSC decoding nor claims
measured colour fidelity. Its canvas scales the 40-by-48 block grid without
smoothing; the selectable text layer occupies the same display area.

## Public interface and acceptance

```device
interface Apple2Video {
  size 8
  initialize initialize
  reset reset
  validate validState
  read 0 readGraphics
  write 0 writeGraphics
  read 1 readText
  write 1 writeText
  read 2 readFull
  write 2 writeFull
  read 3 readMixed
  write 3 writeMixed
  read 4 readPageOne
  write 4 writePageOne
  read 5 readPageTwo
  write 5 writePageTwo
  read 6 readLores
  write 6 writeLores
  read 7 readHires
  write 7 writeHires
  view textAddress
  view visibleRow
  view characterCode
  view inverse
  view loresAddress
  view loresColour
  view visibleLoresRow
}
```

Read-only views validate input widths and Boolean values and never write state,
read memory, or invoke a guest access. Snapshots contain `text`, `mixed`,
`page2`, and `hires`. Restoration and inspection preserve all four.

[Tests](../../../../tests/components/devices/apple2-video.test.ts) independently
check every visible cell on both pages, every character byte and flash phase,
all switch accesses in both directions, reset, restoration, and inspection.
Low-resolution checks cover every address on both pages, both nibbles of every
byte, all latch combinations, and the mixed-mode boundary. The
[browser-session checks](../../../../tests/site/apple2.test.ts) run real Applesoft
GR, COLOR, PLOT, HLIN, and VLIN commands, then test page and mode switching.
High-resolution rows remain blank with an explicit message; mixed mode retains
the bottom four text rows in either graphics mode.

[manual]: https://www.applelogic.org/files/AIIREF.pdf
[reference]: https://github.com/jtauber/dromaios-apple2/blob/569baf98006f61e80ed93c36aa4f8d9ae23011d3/js/video.js
