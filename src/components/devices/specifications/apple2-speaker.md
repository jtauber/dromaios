# Apple II speaker

The Apple II has a software-driven speaker, not a tone generator. An access
to C030 changes the output latch; regularly spaced accesses produce a tone.
Apple's [Reference Manual, pages 43–45][manual] demonstrates this with a 6502
delay loop. The motherboard's I/O decoder selects the same circuit throughout
C030–C03F, without qualifying the selection by read/write or the data byte.
The [machine chapter](../../../machines/6502/apple2.md) places this device there.

This model owns one output level. It does not model the amplifier, speaker cone,
electrical power, or individual bus-cycle timing. Fresh construction chooses a
clear latch; CPU reset preserves it. An inspection of the level is not a guest
access and must never toggle it.

```device
device "apple2-speaker"

state {
  latch LEVEL
}

action initialize "Begin with a clear speaker output latch" {
  LEVEL <- 0
}

action reset "CPU reset preserves the speaker output latch" {
}

source validState "Either output level is valid" : flag {
  return 1
}

source level "Inspect the speaker output without toggling it" : flag {
  current = latch LEVEL
  return current
}

action toggle "Reverse the speaker output level" {
  current = latch LEVEL
  LEVEL <- not(current)
}

source readSwitch "Toggle the speaker; the undriven bus reads as zero" (address: 8): 8 {
  perform toggle()
  return u8($00)
}

source writeSwitch "Toggle the speaker regardless of the written byte" (address: 8, byte: 8): flag {
  perform toggle()
  return 1
}

interface Apple2Speaker {
  size 16
  initialize initialize
  reset reset
  validate validState
  view level
  read * readSwitch
  write * writeSwitch
}
```

Reads return 00 as the machine's declared floating-bus approximation. Writes
accept every byte. All sixteen local addresses have identical effects in both
directions. Invalid addresses and non-byte writes throw before changing state.
Snapshots contain only Boolean `level`; restoring one neither toggles the
speaker nor produces sound.

The browser samples this level after each completed instruction and timestamps
changes with the machine's elapsed CPU clocks. Multiple accesses in one
instruction still toggle the device separately, but audio retains only their
net level at the instruction's end. This deliberately omits within-instruction
pulses and any bus accesses omitted by the CPU model. It is suitable for the
Monitor bell and ordinary software delay loops, not cycle-exact sound tricks.
Host audio queues and playback preferences are outside the hardware snapshot.

[manual]: https://apple2history.org/dl/Apple_II_Redbook.pdf
