# Color Computer sound circuit

The CoCo's CPU supplies the waveform. PIA 1 PA7–PA2 feed a six-bit
digital-to-analogue converter; PIA 0 CA2 and CB2 select its output, cassette
audio, cartridge audio, or an unused input. PIA 1 CB2 enables that multiplexer.
PIA 1 PB1 supplies a separate one-bit sound output, connected even when the
multiplexer is disabled. The [Tandy technical reference][technical], page 31,
Table 4 and Figure 11, describes the selection and recommends using one source
at a time. The [machine chapter](../../../machines/6809/coco.md#sound) supplies
the PIA connections and explains BASIC SOUND and PLAY.

| Enable | CA2 (SEL1) | CB2 (SEL2) | Multiplexer source |
| --- | --- | --- | --- |
| 0 | any | any | Disabled |
| 1 | 0 | 0 | Six-bit DAC |
| 1 | 1 | 0 | Cassette (silent in this model) |
| 1 | 0 | 1 | Cartridge (silent in this model) |
| 1 | 1 | 1 | Unused (silent) |

This is a combinational decoder, with no oscillator, tone table, or retained
audio state. Its inputs are resolved PIA pins, including the machine's existing
released-high approximation for input pins. Changing an output latch while its
direction bit selects input cannot drive sound. The one-bit path contributes
either 0 or 63; the selected DAC contributes 0–63. Equal full-scale weights
are a playback approximation, not an electrical model of their interaction.
The host divides the sum by 126 before sampling. Constant offsets are removed
by the shared audio transport. Resistor tolerances, switching delays, analogue
loading, the RF modulator, and the television amplifier are not modeled.

```device
device "coco-sound"

state {
}

action reset "The sound circuit retains no state beyond its PIA inputs" {
}

source validState "There is no retained sound state" : flag {
  return 1
}

source output "Combine the selected DAC and the independent one-bit path" (portA: 8, portB: 8, select1: flag, select2: flag, enabled: flag): 8 {
  dacSelected: flag = and(enabled, and(not(select1), not(select2)))
  dac = select(dacSelected, shiftBits(portA, right, 2), u8($00))
  singleBit = select(bit(portB, 1), u8($3F), u8($00))
  return add(dac, singleBit)
}

interface CocoSound {
  size 1
  initialize reset
  reset reset
  validate validState
  view output
}
```

The circuit has no CPU-addressable register. The board observes it after each
completed instruction, interrupt, or waiting boundary, using elapsed CPU
clocks. A boundary retains only its final output level, so within-instruction
pulses and omitted CPU bus accesses are outside the model. Restoring the PIAs
and clock restores waveform generation; host audio queues are discarded.

[technical]: https://colorcomputerarchive.com/repo/Documents/Manuals/Hardware/Color%20Computer%20Technical%20Reference%20Manual%20%28Tandy%29.pdf
