# IBM CGA: text, scan timing, and the RGBI display

IBM introduced the Color/Graphics Monitor Adapter with the PC in 1981. Its
16 KiB of display RAM stores characters and attributes in text modes, or pixels
in graphics modes. A Motorola 6845 supplies character addresses and raster
position; the adapter adds its own character ROM, colour logic, and blink
counter. This chapter implements the **40/80-column, 25-row text profile** used
by the XT BIOS. It does not implement a general graphics controller.

The references are [IBM's Technical Reference][ibm], printed pages 1-123–1-148
and schematics D-36–D-41, and the [Motorola MC6845 datasheet][motorola], Figures
10–15. IBM's table on 1-138 supplies the standard register values; its schematic
sheet 3 shows the external blink divider, which matters even when the CRTC
itself requests a non-blinking cursor.

## Registers and retained state

Ports `3D0–3D7` alias the CRTC index/data pair. The five-bit index selects a
register; only cursor address registers 14/15 and light-pen registers 16/17
have readback on the original MC6845. Writes to registers 0–15 retain their
implemented bits. Unused indices ignore writes and read zero, as do write-only
CRTC registers. Reads of the index, mode, and colour ports are unanswered.

Port `3D8` captures six mode bits; `3D9` captures six colour-select bits. Bits
6/7 do not stick. Display RAM remains a separate machine component. The CRTC's
14-bit character address is retained, but text RAM connects only its low 13
bits, wrapping within 16 KiB. The display-start register pair is latched at the
start of a frame; cursor-address changes take effect immediately.

```device
device "ibm-cga"

state {
  array CRTC: 8[16]
  register INDEX: 8
  register MODE: 8
  register COLOUR: 8
  register PHASE: 8
  register HORIZONTAL: 8
  register LINE: 16
  register VSYNC_LEFT: 8
  register FIELDS: 8
  register START: 14
}

action initialize "Choose deterministic registers and a cleared scan/blink phase" {
  CRTC[] <- u8(0)
  INDEX <- u8(0)
  MODE <- u8(0)
  COLOUR <- u8(0)
  PHASE <- u8(0)
  HORIZONTAL <- u8(0)
  LINE <- u16(0)
  VSYNC_LEFT <- u8(0)
  FIELDS <- u8(0)
  START <- u14(0)
}

source registerMask "Connected bits of each writable original MC6845 register" (index: 8): 8 {
  seven: flag = or(or(equal(index, u8(4)), equal(index, u8(6))), or(equal(index, u8(7)), equal(index, u8(10))))
  five: flag = or(equal(index, u8(5)), or(equal(index, u8(9)), equal(index, u8(11))))
  six: flag = or(equal(index, u8(12)), equal(index, u8(14)))
  syncMask = select(equal(index, u8(3)), u8($0F), u8($FF))
  interlaceMask = select(equal(index, u8(8)), u8($03), u8($FF))
  rowMask = select(seven, u8($7F), u8($FF))
  rasterMask = select(five, u8($1F), u8($FF))
  addressMask = select(six, u8($3F), u8($FF))
  return and(and(syncMask, interlaceMask), and(rowMask, and(rasterMask, addressMask)))
}

source selectRegister "Latch the five-bit CRTC index" (byte: 8): flag {
  INDEX <- and(byte, u8($1F))
  return 1
}

source writeRegister "Ignore read-only/unused registers and mask unconnected bits" (byte: 8): flag {
  index = register INDEX
  when not(bit(index, 4)) {
    slot = and(index, u8($0F))
    mask = source registerMask(slot)
    CRTC[and(slot, u8($0F))] <- and(byte, mask)
  }
  return 1
}

source readRegister "Only the cursor address is writable and readable; the absent light pen reads zero" : 8 {
  index = register INDEX
  result = choose or(equal(index, u8(14)), equal(index, u8(15))) : 8 {
    then {
      byte = array CRTC[and(index, u8($0F))]
      return byte
    }
    else {
      return u8(0)
    }
  }
  return result
}

source writeMode "Capture mode controls without resetting the free-running divider" (byte: 8): flag {
  MODE <- and(byte, u8($3F))
  return 1
}

source writeColour "Capture border and palette controls" (byte: 8): flag {
  COLOUR <- and(byte, u8($3F))
  return 1
}
```

## Clock, display enable, and vertical sync

The character clock divides the 14.31818 MHz crystal by eight in 80-column
mode, or sixteen in 40-column mode. Every line has `R0+1` character clocks;
every frame has `(R4+1) × (R9+1) + R5` scan lines. The standard text values give
114×8 or 57×16 oscillator ticks per line, and 262 lines per frame. The clock
continues when video is disabled. Port reads never advance it.

`advanceOscillatorTicks` accepts up to 255 oscillator ticks per call. The machine
splits longer intervals; splitting does not change scan or blink state. PHASE
retains the divide-by-sixteen phase across mode changes. The model samples
horizontal/vertical boundaries at character clocks, omitting the board's
pipeline delays. VSYNC starts at row R7 and lasts sixteen scan lines. Its
falling edge clocks the external blink counter: cursor gating uses bit 3,
character blinking bit 4. Thus the cursor alternates every eight fields and
blinking text every sixteen fields, independently of host rendering.

The standard non-interlace modes (`R8=0` or `2`) are supported. Interlaced
signals, mid-frame programming tricks, and precise reset/transient waveforms
are outside this profile. Registers remain programmable during startup; display
inspection explicitly rejects unsupported text geometry or interlace settings.

```device
source rasterHeight "Scan lines per character row" : 16 {
  last = array CRTC[u8(9)]
  return add(extend(last, 16), u16(1))
}

source frameLines "Character rows plus vertical-total adjustment" : 16 {
  rows = array CRTC[u8(4)]
  adjust = array CRTC[u8(5)]
  height = source rasterHeight()
  return add(multiply(add(rows, u8(1)), truncate(height, 8)), extend(adjust, 16))
}

source startAddress "Programmed fourteen-bit start address" : 14 {
  high = array CRTC[u8(12)]
  low = array CRTC[u8(13)]
  return truncate(concat(high, low), 14)
}

action nextLine "Advance vertical counters, latch frame start, and clock the blink divider" {
  sync = register VSYNC_LEFT
  when not(zero(sync)) {
    VSYNC_LEFT <- subtract(sync, u8(1))
    when equal(sync, u8(1)) {
      fields = register FIELDS
      FIELDS <- and(add(fields, u8(1)), u8($3F))
    }
  }
  previous = register LINE
  total = source frameLines()
  nextLine = add(previous, u16(1))
  when not(lessThan(nextLine, total, unsigned)) {
    LINE <- u16(0)
    start = source startAddress()
    START <- start
  }
  when lessThan(nextLine, total, unsigned) {
    LINE <- nextLine
  }
  line = register LINE
  syncRow = array CRTC[u8(7)]
  height = source rasterHeight()
  remaining = register VSYNC_LEFT
  when and(zero(remaining), equal(line, multiply(syncRow, truncate(height, 8)))) {
    VSYNC_LEFT <- u8(16)
  }
}

action characterClock "Advance one CRTC character period" {
  horizontal = register HORIZONTAL
  last = array CRTC[u8(0)]
  HORIZONTAL <- add(horizontal, u8(1))
  when equal(horizontal, last) {
    HORIZONTAL <- u8(0)
    perform nextLine()
  }
}

action advanceOscillatorTicks "Advance a bounded interval without losing divider phase" (ticks: 8) {
  phase = register PHASE
  mode = register MODE
  fast: flag = bit(mode, 0)
  pending = and(extend(phase, 16), select(fast, u16(7), u16(15)))
  total = add(pending, extend(ticks, 16))
  clocks = truncate(select(fast, shiftBits(total, right, 3), shiftBits(total, right, 4)), 8)
  PHASE <- and(add(phase, ticks), u8($0F))
  unused = iterate(clocks, u8(0)) {
    perform characterClock()
    return unused
  }
}

source status "Display-safe interval, absent pen switch, and vertical sync" : 8 {
  horizontal = register HORIZONTAL
  line = register LINE
  columns = array CRTC[u8(1)]
  rows = array CRTC[u8(6)]
  height = source rasterHeight()
  sync = register VSYNC_LEFT
  active: flag = and(lessThan(horizontal, columns, unsigned), lessThan(line, multiply(rows, truncate(height, 8)), unsigned))
  return or(u8(4), or(select(active, u8(0), u8(1)), select(zero(sync), u8(0), u8(8))))
}
```

Status bit 0 is **high outside active display**, despite IBM naming it
"Display Enable": the schematic connects inverted DE. Bit 3 is VSYNC, not the
whole vertical blanking interval. The absent light pen contributes bit 2=1 and
bit 1=0; unused upper bits read zero as a model convention. Light-pen capture and
ports `3DB/3DC` are not implemented. Mode bit 3 gates the picture, not DE/VSYNC.

## Text addresses, attributes, and cursor

Each character cell is eight dots wide and eight lines high. In 40-column mode
those dots take twice as long, so a display can scale the 320×200 active image
to the same physical aspect as 640×200 text. The [machine renderer](../../../machines/8088/pc-xt/video.ts)
returns native pixels and leaves presentation scaling to its caller.

Attribute bits 3:0 select foreground RGBI; bits 6:4 select the background. When
mode bit 5 is clear, attribute bit 7 supplies background intensity. When set,
attribute bit 7 instead makes the glyph disappear during the blank half of the
blink cycle. The cursor uses the foreground colour and replaces glyph dots in
its programmed scan lines, even over a blank character. The CRTC's non-blink
and hidden-cursor settings are supported; its additional internal blink modes
are deferred. The adapter's external cursor gating still applies to non-blink.

```device
source textSupported "Standard 40/80 by 25 non-interlaced text with eight-line characters" : flag {
  mode = register MODE
  columns = array CRTC[u8(1)]
  rows = array CRTC[u8(6)]
  raster = array CRTC[u8(9)]
  interlace = array CRTC[u8(8)]
  cursor = array CRTC[u8(10)]
  expected = select(bit(mode, 0), u8(80), u8(40))
  return and(and(not(bit(mode, 1)), equal(columns, expected)), and(and(equal(rows, u8(25)), equal(raster, u8(7))), and(not(bit(interlace, 0)), not(bit(cursor, 6)))))
}

source videoEnabled "Mode bit 3 gates RGBI output" : flag {
  mode = register MODE
  return bit(mode, 3)
}

source columns "Visible character columns" : 8 {
  columns = array CRTC[u8(1)]
  return columns
}

source characterAddress "Latched display start plus row and column, in character units" (row: 8, column: 8): 14 {
  start = register START
  columns = array CRTC[u8(1)]
  return truncate(add(extend(start, 16), add(multiply(row, columns), extend(column, 16))), 14)
}

source memoryAddress "Low thirteen character-address bits select sixteen KiB of RAM" (address: 14): 16 {
  return shiftBits(and(extend(address, 16), u16($1FFF)), left, 1)
}

source glyphAddress "Default double-dot font in the shared MDA/CGA character ROM" (character: 8, line: 8): 16 {
  return add(u16($1800), add(shiftBits(extend(character, 16), left, 3), extend(and(line, u8(7)), 16)))
}

source foreground "Attribute RGBI foreground" (attribute: 8): 8 {
  return and(attribute, u8($0F))
}

source background "Blink mode removes attribute bit 7 from background intensity" (attribute: 8): 8 {
  mode = register MODE
  return and(shiftBits(attribute, right, 4), select(bit(mode, 5), u8(7), u8(15)))
}

source glyphVisible "External CGA text blink divides VSYNC by thirty-two" (attribute: 8): flag {
  mode = register MODE
  fields = register FIELDS
  return not(and(and(bit(mode, 5), bit(attribute, 7)), bit(fields, 4)))
}

source cursorVisible "Cursor address, shape, enable, and external divide-by-sixteen gating" (address: 14, line: 8): flag {
  high = array CRTC[u8(14)]
  low = array CRTC[u8(15)]
  start = array CRTC[u8(10)]
  end = array CRTC[u8(11)]
  fields = register FIELDS
  shapeStart = and(start, u8($1F))
  matches: flag = equal(address, truncate(concat(high, low), 14))
  shape: flag = and(not(lessThan(line, shapeStart, unsigned)), not(lessThan(end, line, unsigned)))
  return and(and(matches, shape), and(zero(and(start, u8($60))), not(bit(fields, 3))))
}

source validState "Reject unconnected register bits and impossible sync duration" : flag {
  iterate(u8(16)) {
    slot: 8 = u8(0)
    valid: flag = 1
    step {
      byte = array CRTC[and(slot, u8($0F))]
      mask = source registerMask(slot)
      next slot = add(slot, u8(1))
      next valid = and(valid, equal(and(byte, mask), byte))
    }
  }
  sync = register VSYNC_LEFT
  index = register INDEX
  mode = register MODE
  colour = register COLOUR
  phase = register PHASE
  fields = register FIELDS
  line = register LINE
  bounded: flag = and(and(lessThan(index, u8(32), unsigned), lessThan(mode, u8(64), unsigned)), and(lessThan(colour, u8(64), unsigned), lessThan(phase, u8(16), unsigned)))
  return and(and(valid, bounded), and(and(lessThan(fields, u8(64), unsigned), lessThan(line, u16(8192), unsigned)), not(lessThan(u8(16), sync, unsigned))))
}

interface IbmCga {
  size 16
  initialize initialize
  reset initialize
  validate validState
  input advanceOscillatorTicks
  view status
  view textSupported
  view videoEnabled
  view columns
  view characterAddress
  view memoryAddress
  view glyphAddress
  view foreground
  view background
  view glyphVisible
  view cursorVisible
  read 1 readRegister
  read 3 readRegister
  read 5 readRegister
  read 7 readRegister
  read 10 status
  write 0 selectRegister
  write 1 writeRegister
  write 2 selectRegister
  write 3 writeRegister
  write 4 selectRegister
  write 5 writeRegister
  write 6 selectRegister
  write 7 writeRegister
  write 8 writeMode
  write 9 writeColour
}
```

Snapshots include registers, divider phase, scan position, sync duration, blink
count, and latched display start. Inspection is pure. Reset deterministically
clears these fields; installed character ROM and separate video RAM survive.
Hardware does not specify all power-on register contents. Restoring must retain
phase, not reconstruct it from a host timestamp or restart a frame.

The renderer reconstructs one active image from current RAM and this state. It
does not replay raster history, show CGA snow, or emulate composite colour,
borders, graphics pixels, light pens, or precise mid-frame register effects.
Mode bit 2 controls composite colour burst and does not desaturate RGBI text.
Colour-select registers are retained for future border/graphics work; the active
text colours come from cell attributes.

[Component tests](../../../../tests/components/devices/ibm-cga.test.ts) check
independent register masks, line/frame boundaries, blink rates, and restoration.
[Rendering tests](../../../../tests/machines/8088/pc-xt/video.test.ts) check pixel
colours, cursor, display-start wrapping, unsupported configurations, and pure
observation. The [XT chapter](../../../machines/8088/pc-xt.md) owns the ROM
identity, oscillator connection, and original-firmware acceptance.

[ibm]: https://minuszerodegrees.net/manuals/IBM_5160_Technical_Reference_APR83.pdf
[motorola]: https://archive.decromancer.ca/bitsavers.org/components/motorola/_dataSheets/6845.pdf
