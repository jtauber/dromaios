# Apple II Language Card: RAM behind ROM

The Language Card added 16 KiB of RAM to a 48 KiB Apple II. It supported
languages loaded from disk, including Pascal and Integer BASIC, by replacing
the ROM's address range with writable storage. The [installation manual][manual],
Appendix D, describes its software interface. At D000–DFFF, two 4 KiB banks
share one address range; E000–FFFF uses a common 8 KiB area. Reads and writes
have independent enables, allowing a ROM-copy loop to read firmware and write
the same addresses in RAM. Selecting RAM for reads subsequently exposes that copy.

This chapter owns the control device at C080–C08F. The
[machine chapter](../../../machines/6502/apple2.md#components-and-address-decoding)
owns its storage and wiring. The original card's F800–FFFF Autostart ROM is
represented by the machine's existing combined firmware image; it needs no
additional ROM file.

## Four retained signals

Jim Sather's circuit analysis in [Understanding the Apple II][sather],
pages 5-28–5-30 and Table 5.4, distinguishes the four flip-flops. Power-on
selects bank 2, reads ROM, enables RAM writes, and clears the pending read.
CPU RESET does not alter them. Our latches use positive logical names even
where the electrical signal is active low.

```device
device "apple2-language-card"

state {
  latch RAM_READ
  latch RAM_WRITE
  latch BANK2
  latch PREWRITE
}

action initialize "Power-on configuration" {
  RAM_READ <- 0
  RAM_WRITE <- 1
  BANK2 <- 1
  PREWRITE <- 0
}

action reset "CPU reset leaves card selection and protection intact" {
}

source validState "All four-latch combinations can be restored" : flag {
  return 1
}
```

## Address bits and transfer direction

A3 clear selects bank 2; A3 set selects bank 1. A2 is ignored. A1 equal to A0
selects RAM reads; unequal bits select ROM. The manual's table and assembly
examples use this bank numbering (its preceding prose reverses the bank names).

An even control access clears write permission and PREWRITE. An odd read sets
PREWRITE and, if it was already set, enables writes. An odd write clears
PREWRITE but preserves existing write permission. Other memory accesses do
not interrupt the sequence. The two reads need not use the same odd address.
These direction-sensitive details follow Sather's circuit analysis.

```device
action selectMapping "Decode bank and read source" (address: 8) {
  BANK2 <- not(bit(address, 3))
  RAM_READ <- not(xor(bit(address, 1), bit(address, 0)))
}

action protect "An even control access protects RAM" {
  RAM_WRITE <- 0
  PREWRITE <- 0
}

source readSwitch "Decode a control read and advance the enable sequence" (address: 8): 8 {
  perform selectMapping(address)
  when bit(address, 0) {
    pending = latch PREWRITE
    when pending {
      RAM_WRITE <- 1
    }
    PREWRITE <- 1
  }
  when not(bit(address, 0)) {
    perform protect()
  }
  return u8($00)
}

source writeSwitch "Decode a control write without arming writes" (address: 8, byte: 8): flag {
  perform selectMapping(address)
  PREWRITE <- 0
  when not(bit(address, 0)) {
    perform protect()
  }
  return 1
}
```

Returned data is 00, the machine's declared undriven-bus approximation.
Write data is immaterial. The reference emulator's common read/write handler
does not implement this distinction, so it is not used as a behavioral oracle.

## Wiring and inspection

Pure views expose routing decisions without accessing a switch or advancing
PREWRITE. The address bindings pass the local byte address to the decoder;
the same bit pattern therefore describes all sixteen aliases.

```device
source ramRead "RAM supplies reads" : flag {
  selected = latch RAM_READ
  return selected
}

source ramWrite "RAM accepts writes" : flag {
  selected = latch RAM_WRITE
  return selected
}

source bank2 "The lower window selects bank 2" : flag {
  selected = latch BANK2
  return selected
}

interface Apple2LanguageCard {
  size 16
  initialize initialize
  reset reset
  validate validState
  view ramRead
  view ramWrite
  view bank2
  read * readSwitch
  write * writeSwitch
}
```

Snapshots retain `ram_read`, `ram_write`, `bank2`, and `prewrite`; the machine
snapshot separately owns all RAM bytes. Restoring between enable reads must
retain the pending read. Snapshots are detached and views do not mutate them.
Invalid host addresses or non-byte writes throw before changing latches.

This is a transfer-level model, without refresh, electrical timing, or video
floating-bus data. It reacts to accesses issued by the CPU's declared model;
6502 dummy bus cycles are not synthesized here. Code depending on those cycles
at control addresses is outside this contract. No disk software is installed
by enabling the card.

The [device tests](../../../../tests/components/devices/apple2-language-card.test.ts)
check every address in both directions from every latch combination, aliases,
enable sequences, reset, and restoration. The
[machine tests](../../../../tests/machines/6502/apple2-language-card.test.ts)
check bank isolation, shared upper RAM, ROM overlays, and actual CPU transfers.

[manual]: https://retronik.silicium.org/DOCUMENTS/Info/Apple_II/Apple%20Langage%20Card%20Installation%20Manual%20%28Apple%20Computers%20%23A2L0043%201981%29.pdf
[sather]: https://archive.org/stream/understanding_the_apple_ii/understanding_the_apple_ii_djvu.txt
