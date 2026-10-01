# Apple II Plus: ROM and keyboard

The Apple II Plus pairs a MOS 6502 with memory-mapped input and display hardware.
Unlike the Altair's serial terminal, its text output lives in RAM, where video
hardware fetches character codes. Applesoft and the Autostart Monitor occupy
the upper 12 KiB of the address space.

This is the first native composition in the [Apple II Plus plan](../../../docs/machines/apple2.md):
48 KiB of main RAM, caller-supplied firmware, and the keyboard latch. It can boot
the selected ROM and run text BASIC programs headlessly. Display rendering,
display switches, Language Card banking, Disk II, and sound remain future work.
The main reference is the pinned [dromaios-apple2 implementation][reference];
Apple's [Reference Manual][manual] supplies the hardware background.

## Components and address decoding

Main RAM fills 0000–BFFF; page-one text uses 0400–07FF within that same storage.
The [keyboard chapter](../../components/devices/specifications/apple2-keyboard.md)
owns character/strobe state and all C000–C01F aliases. ROM fills D000–FFFF,
including the interrupt and reset vectors. There is no Disk II bootstrap in an
empty slot, so the Autostart Monitor falls through to Applesoft.

```machine
components {
    ram = ram C000
    keyboard = apple2-keyboard
    firmware = rom 3000
}

map 10000 {
    0000 = ram
    C000 = keyboard
    D000 = firmware
    unmapped = 00
}
```

Unanswered reads return 00 and unanswered writes are discarded, including
writes to ROM. This explicit byte-bus policy is an approximation, not a model
of the Apple II video scanner's floating bus. Unimplemented soft switches have
no effect. Programs that depend on them are outside this initial composition.

## Firmware supplied by the caller

The executable declaration identifies the exact 12,288 bytes mapped at D000.
No firmware bytes are downloaded, generated, or committed here.

```machine
image firmware external sha256 378ba00c86a64cca49cedaca7de8d5d351983ebc295d9d11e0752febfc346249
```

The generated module exports `romImages.firmware` (size and SHA-256). The host
uses `RomImage.verify` with its SHA-256 implementation before calling
`create6502Apple2({ firmware })`. The verified image owns its bytes. Factories
remain synchronous and copy ROM into fresh components.

The reference's `roms/apple2p.rom` is a 20,480-byte container with SHA-256
`92c4bef609920842ea472d21b661a0d35dbda6cd90963b8b734a205e22d84108`.
A host accepting that file must validate the **whole file** before extracting
offsets 2000–4FFF, then verify the normalized image above. The exact 12 KiB image
is also accepted directly. Other sizes or altered files are rejected before
replacing an existing machine.

## Construction, reset, and restoration

Construction provides zero-filled RAM and deterministic CPU and keyboard state.
It does not execute or reset the CPU. Call `reset()` to perform the processor's
real reset-vector reads at FFFC and FFFD; the selected firmware points to FA62.
The initial PC below is not a shortcut into the ROM.

```machine
cpu 6502 {
    A = 00  X = 00  Y = 00
    PC = 0000  SP = FF
    flags { N = 0  V = 0  D = 0  I = 0  Z = 0  C = 0 }
}

reset { cpu }
```

CPU reset preserves RAM, firmware, and the keyboard latch. It follows the
[6502 reset contract](../../components/cpus/specifications/6502.md#reset-and-instruction-boundaries),
including its stack-pointer and interrupt-mask changes. Firmware may then
clear the strobe and initialize its own workspace. Fresh construction, followed
by reset, represents power-on in this deterministic model.

`snapshot()` captures CPU, RAM, keyboard, and the firmware digest. Restoration
requires that digest and the same verified ROM binding; it creates independent
hardware without resetting or executing. Snapshot inspection performs no
guest device reads. There is no generic safe preview of mapped I/O: inspect
the keyboard snapshot and read RAM or ROM directly instead.

## Headless acceptance

[Synthetic tests](../../../tests/machines/6502/apple2.test.ts) exercise the
generated map using independently supplied ROM code: real reset-vector reads,
keyboard polling and acknowledgement through CPU instructions, recorded bus
accesses, discarded ROM writes, reset preservation, and snapshot continuation.
The synthetic definition uses its own declared digest; it cannot impersonate
this firmware binding.

The [external-ROM test](../../../tests/machines/6502/apple2-rom.test.ts) boots
the selected firmware without the reference emulator's devices or routine traps.
It checks the APPLE ][ banner and Applesoft prompt, enters a stored two-line
program out of order, checks ordered LIST output, and executes RUN to print 5.
It also checks a line-editing backspace, Control-C from a loop, and independent
continuation from a hardware snapshot. Characters pass through the generated
keyboard; output is decoded from RAM, not intercepted at a ROM routine.

```sh
APPLE2_ROM=/path/to/apple2p.rom node --test dist/tests/machines/6502/apple2-rom.test.js
```

Set the same variable for `npm test` to include the real-ROM acceptance run.
Without it, that test is explicitly skipped; synthetic machine, device, and
media-verification checks still run. No test downloads firmware.

For these checks, text rows use the independently transcribed page-one base
addresses 0400, 0480, …, 0780; 0428, 04A8, …, 07A8; then 0450, 04D0, …, 07D0.
Each row contains forty characters. Low six bits select the original uppercase
character set; inverse/flashing attributes are retained in RAM but not rendered
by this test. Full display decoding and browser presentation are the next slice.

[manual]: https://www.applelogic.org/files/AIIREF.pdf
[reference]: https://github.com/jtauber/dromaios-apple2/tree/569baf98006f61e80ed93c36aa4f8d9ae23011d3
