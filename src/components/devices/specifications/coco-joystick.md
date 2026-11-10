# Color Computer joystick

Each original CoCo joystick has two potentiometers and one fire button. The
machine selects one of four axes with PIA 0 CA2/CB2, compares its voltage with
the six-bit sound DAC, and reads the comparator on PA7. Software performs
the successive approximation; there is no joystick-position register on the
CPU bus. The [Tandy technical reference][technical], page 30, describes this
circuit and the fire switches shared with keyboard rows PA0 and PA1.

This model represents one connected or disconnected joystick. X increases
rightward and Y downward, from 0 to 63. These are quantized positions in DAC
steps, not voltages. Centre is 32; an input beyond the upper stop saturates at
63. Byte inputs still reject negative, fractional, and non-byte values before
changing state. Analogue tolerances, settling delay, jitter, and high-resolution
joystick adapters are outside this profile.

```device
device "coco-joystick"

state {
  register X: 8
  register Y: 8
  latch CONNECTED
  latch PRESSED
}

action initialize "A disconnected, centred joystick with its button released" {
  X <- u8(32)
  Y <- u8(32)
  CONNECTED <- 0
  PRESSED <- 0
}

action reset "Board reset does not move or disconnect the physical joystick" {
}

source validState "Both axes must lie within their travel" : flag {
  x = register X
  y = register Y
  return and(lessThan(x, u8(64), unsigned), lessThan(y, u8(64), unsigned))
}

source bounded "Stop at the end of the axis travel" (position: 8): 8 {
  return select(lessThan(position, u8(64), unsigned), position, u8(63))
}

action setPosition "Move both potentiometers" (x: 8, y: 8) {
  horizontal = source bounded(x)
  vertical = source bounded(y)
  X <- horizontal
  Y <- vertical
}

action connect "Plug or unplug the joystick without moving it" (connected: flag) {
  CONNECTED <- connected
}

action setButton "Press or release the physical fire switch" (pressed: flag) {
  PRESSED <- pressed
}

source buttonLow "A connected pressed button grounds its keyboard row" : flag {
  connected = latch CONNECTED
  pressed = latch PRESSED
  return and(connected, pressed)
}

source comparatorHigh "Compare the selected axis with PIA 1 PA7–PA2" (vertical: flag, dacPins: 8): flag {
  connected = latch CONNECTED
  x = register X
  y = register Y
  position = select(vertical, y, x)
  dac = shiftBits(dacPins, right, 2)
  return or(not(connected), not(lessThan(position, dac, unsigned)))
}

interface CocoJoystick {
  size 1
  initialize initialize
  reset reset
  validate validState
  input setPosition
  input connect
  input setButton
  view buttonLow
  view comparatorHigh
}
```

At equality the ideal comparator reads high; this quantization convention also
matches [MAME's standard joystick comparator][mame]. An unconnected axis reads
high, preserving the board's existing disconnected-input approximation. It is
not a claim that an actual open analogue input has a stable position.
The sound multiplexer enable does not disable joystick conversion.

Snapshots retain X, Y, connection, and the physical switch. Disconnecting a
held switch removes its electrical effect without moving the stick. Reading
the comparator or button cannot acknowledge a PIA interrupt or change a BASIC
cached reading. The [machine chapter](../../../machines/6809/coco.md#joysticks)
owns the selector wiring, keyboard interaction, and ROM acceptance examples.

[technical]: https://colorcomputerarchive.com/repo/Documents/Manuals/Hardware/Color%20Computer%20Technical%20Reference%20Manual%20%28Tandy%29.pdf
[mame]: https://github.com/mamedev/mame/blob/master/src/mame/trs/coco.cpp
