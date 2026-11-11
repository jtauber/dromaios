# Color Computer cassette interface

The CoCo has no cassette byte controller. BASIC synthesizes each bit with
the six-bit DAC on PIA 1 PA7–PA2, switches the recorder's motor relay with
PIA 1 CA2, and times input transitions on PIA 1 PA0. The [Tandy technical
reference][technical], page 32, describes a 1200 Hz cycle for zero and a
2400 Hz cycle for one. Bytes travel least-significant bit first. Leaders,
filenames, block lengths, checksums, and end-of-file blocks belong to software.

The output attenuator connects the DAC to the recorder independently of the
speaker multiplexer. Playback passes through a zero-crossing detector: the
manual describes negative input as high at the PIA. Tape recorders can invert
phase; BASIC synchronizes to either polarity. Here unsigned PCM 128 is silence,
lower samples are negative, and silence reads high. Voltage, hysteresis,
mechanical acceleration, wow/flutter, and magnetic noise are not modeled.

```device
device "coco-cassette-circuit"

state {
}

action reset "The attenuator and comparator retain no state" {
}

source validState "There is no retained circuit state" : flag {
  return 1
}

source outputSample "Map the resolved six-bit DAC to unsigned eight-bit PCM" (portA: 8): 8 {
  return and(portA, u8($FC))
}

source inputHigh "Negative input and silence produce a high comparator output" (sample: 8): flag {
  return not(lessThan(u8($80), sample, unsigned))
}

interface CocoCassetteCircuit {
  size 1
  initialize reset
  reset reset
  validate validState
  view outputSample
  view inputHigh
}
```

The concrete [tape transport](../coco-cassette.ts) retains the medium, playback
position, fractional sample phase, write permission, and Play/Record/Stop mode.
It advances only when a transport key is engaged **and** the relay is on.
The machine supplies elapsed CPU clocks at instruction and idle boundaries;
browser time never moves the tape. Each boundary uses its starting DAC and
motor levels, then presents the next input sample to the PIA. This is a
44,100-sample-per-second functional recording, not bus-cycle or analogue fidelity.

New blank tapes are writable. Imported WAVs are read-only until explicitly
copied; Record overwrites from the current position and extends the tape.
Stop preserves position and fractional phase. Rewind stops and returns to zero.
At playback end the transport stops and supplies silence. Recording is bounded
to two minutes in this initial profile; reaching the limit stops the transport.
The WAV codec accepts mono, unsigned eight-bit PCM at 44,100 Hz, including
ordinary RIFF metadata chunks. Other encodings are rejected before replacement.
It exports the recorded signal, without decoding or constructing BASIC blocks.
The [CAS adapter](../coco-tape-cas.ts) can also reconstruct a waveform from
ordinary CoCo blocks before inserting it into this same transport. Its
[format limits](../../../machines/6809/coco.md#cassette) belong to media import;
the circuit and recorder still see samples, not filenames or program addresses.

Snapshots copy all tape samples and transport state, including a partially
elapsed sample. CPU reset leaves the recorder alone. The laboratory retains
the mounted tape across fresh power-on, stopped at the same position; Rewind
and Play are explicit. Checkpoint restoration reinstates the saved transport
mode and write permission. No ROM bytes are part of a tape or its snapshot.

[technical]: https://colorcomputerarchive.com/repo/Documents/Manuals/Hardware/Color%20Computer%20Technical%20Reference%20Manual%20%28Tandy%29.pdf
