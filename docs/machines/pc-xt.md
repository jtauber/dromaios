# IBM PC/XT target

The IBM PC/XT is the next historical machine after the first untimed CoCo
laboratory. Use **dromaios-pc** as the primary implementation reference and
IBM's hardware documentation as the authority. Retain Dromaios's generated
[8088](../../src/components/cpus/specifications/8088.md); a new CPU is not required.

**Status, 2026-10-31:** reference audit complete; the first native
[keyboard-interrupt example](../../src/machines/8088/xt-keyboard.md) connects
the generated 8088, PIC, PPI, and keyboard receiver. The
[timer example](../../src/machines/8088/xt-timer.md) adds the 8253, saved
oscillator phase, and native IRQ0 handling. Instruction-driven time now passes
isolated original BIOS counter and interrupt timing checks.
There is no complete PC/XT machine or laboratory yet. The reference's DOS
boot works through JavaScript BIOS services; it does not demonstrate original-ROM
startup or a working floppy controller. The first native milestone is original
XT firmware reaching ROM BASIC, followed by a separate DOS milestone.

## Selected first configuration

Target an **IBM 5160 PC/XT**, with the original **11/08/82 BIOS**, IBM ROM BASIC
**C1.10**, an 8088 at the nominal **4.77 MHz** clock, **640 KiB RAM** (256 KiB on
the system board and 384 KiB expansion), an **83-key XT keyboard**, and **CGA
text output**. Select 80-column colour display and one floppy drive in the
equipment switches. The disk milestone uses a **360 KiB drive**, with 40
cylinders, two heads, nine 512-byte sectors per track, and the XT diskette adapter.

CGA text is a bounded first display target. The reference's EGA implementation
remains useful for a later EGA configuration and software-parity work; selecting
CGA does not imply EGA is implemented or that all CGA graphics modes work.
No hard disk, 8087, AT keyboard controller, mouse, or later x86 extensions are
part of this first profile. Speaker control and timer state must be observable;
audible output can follow separately.

IBM's [April 1983 Technical Reference][ibm] describes the system board, port map,
keyboard, CGA, diskette adapter, and BIOS listing. Its printed pages 1-3 through
1-10 establish the board and device connections; Appendix A contains the BIOS.
The 8088 clock is derived from the 14.31818 MHz oscillator divided by three,
and the PIT input from the same oscillator divided by twelve. The timed CPU subset
reports nominal instruction clocks; prefetch and bus-cycle timing remain outside
that model.

## Pinned reference audit

Audit the committed source at
[`a6fb9d10f4274dbd8ba40400e0b6761aec1d4b54`][ref-commit], also the GitHub default
branch when checked on 2026-10-30. The repository is private; its source links
require access. The local checkout additionally contains uncommitted AT/286,
serial-mouse, and other changes. Those were inventoried separately and were not
used for these checks. The committed AT page still loads XT components; it is
not evidence of working 286 support.

| Area | Reference behavior | Treatment in Dromaios |
| --- | --- | --- |
| CPU | A handwritten 8088 core with interrupt hooks and some later x86 instructions/prefix aliases. | Keep the native original-8088 model and its independently checked instruction contracts. Do not import later instructions to satisfy a software title. |
| Firmware and boot | JavaScript initializes the interrupt vector table and BIOS data area. Boot copies a sector to `0000:7C00` and sets registers directly; BIOS interrupts are serviced by host code. | Start at the hardware reset vector and execute the selected ROM. Firmware must initialize its own RAM and reach the bootstrap without host service traps. |
| Memory | 640 KiB RAM, EGA memory at `A0000`, 32 KiB text backing at `B8000`, and a simplified ROM region. Expansion ROM space is not implemented. | Declare the selected physical map, ROM mirrors, CGA's 16 KiB storage and aliases, and unmapped-read policy. Add option ROMs only with a selected controller. |
| Keyboard and PPI | A scan-code latch at port `60` and partial port `61`; a generated IRQ handler sends bytes to a host translator through invented port `E0`. | Model XT keyboard signalling and the 8255 ports/switches. The original IRQ1 ROM routine performs scan-code translation. Do not substitute an AT 8042. |
| PIC | Fixed-priority requests, masks, in-service state, and EOI, but initialization assumes a cascaded controller. | Implement the XT's single 8259A initialization and acknowledge/EOI behavior, including masked pending requests. |
| PIT and time | Browser time advances channel 0; other channels are incomplete. Running and manual stepping use different interrupt paths. | Use one machine execution path and an explicit, saved emulated-time contract. Model the channels needed by POST, refresh, IRQ0, and speaker control. |
| Video | EGA planes/latches and several display modes; text uses a host monospace font. Status port `3DA` is constant; cursor blinking uses browser time. | Preserve useful EGA algorithms for later checks, not as proof of CGA or retrace fidelity. Use the selected character set and pure display observation. |
| Storage | Host INT 13h services copy CHS sectors directly; FAT12 helpers and IndexedDB manage images. No FDC/DMA disk-transfer path. | Disk access must pass through guest BIOS, the diskette controller, and DMA. Offline image inspection can remain a separate tool. |
| Sessions | Disk persistence, but no complete machine snapshots. Reset clears RAM/device state without fully rebuilding the BIOS scaffold. | Distinguish CPU reset, fresh power-on, and firmware warm boot. Save the complete machine and input schedule, not just disk bytes. |

Sources: [CPU][ref-cpu], [memory][ref-memory], [BIOS services][ref-bios],
[PIC][ref-pic], [PIT][ref-pit], [EGA][ref-ega], [application][ref-main], and
[reference architecture][ref-architecture]. These are comparison material,
not authority for hardware behavior.

### Executed checks

Temporary Node.js 24 harnesses loaded an archive of the unmodified pinned
source. These were headless checks; they did not exercise browser controls,
canvas rendering, Windows, or Ultima.

- The reference's [`node test.js` suite][ref-tests] passed **168 unit tests and
  six demo smoke tests**.
  This establishes those cases, not complete PC compatibility.
- The committed DOS image reached `A>` within a 500,000-instruction sample.
  Keyboard make/break input then ran `VER` and `DIR`, producing
  `MS-DOS Version 3.30` and a complete five-file listing before another prompt.
  The run used 1,240,000 instructions in total and 103 host INT 13h calls, with
  no diskette-controller or DMA accesses. DOS's own INT 21h implementation ran;
  the BIOS services remained host code. No timer ticks were supplied, and the
  input schedule used 12,000 instructions after each make and break code solely
  as an audit scaffold, with another 500,000 after the DIR sample to reach its
  completed listing. These budgets are not measured hardware time.
- The image's banner identifies **NEC's MS-DOS 3.30**, not IBM PC DOS. Its BPB
  describes a **1.44 MB** floppy: 80 cylinders, two heads, 18 sectors per track.
  It is not a valid acceptance disk for the selected 360 KiB drive.

Focused probes exposed these gaps relevant to native firmware:

| Probe | Observed result | Acceptance requirement |
| --- | --- | --- |
| Original BIOS PIC initialization | Writes `13` to port `20`, then `08`, `09`, `FF` to port `21`, leave IMR=`00`. The reference consumes an ICW3 even in single-controller mode. | Match the ROM's sequence: ICW4 follows ICW2, and the final `FF` masks all IRQs. IBM's listing is on printed page A-9. |
| PIT mode 0 | Count 10 followed by a 1 ms update produces ten reported IRQs, capped by the reference, rather than one terminal-count event. | Test modes and output transitions independently of the browser. |
| Two unconsumed keys | Make codes `1E`, then `30`, leave only `30` in the latch. | Preserve the keyboard's transfer/acknowledgement sequence; do not overwrite an unconsumed code. |
| Empty blocking BIOS input | INT 16h/AH=`00` returns AX=`0000` immediately. | The original ROM must wait for a key; no host approximation of the BIOS call. |
| Out-of-range sector | Reads return zeroes and success; writes are ignored but mark the image dirty and report success. | Reject invalid geometry/access and expose real controller errors and write protection. |
| Default interrupt stub | IVT entries point to `F000:EF00`, but the intended IRET byte was written through ROM protection and remains `00`. | Firmware owns valid vectors and handler code; no injected stub hidden by host traps. |
| Reset | CPU IF becomes true, PIC mask is `FF`, and the cleared IVT/BDA are not reconstructed. | Check each reset operation against its declared scope. |

A separate probe connected Dromaios's generated 8088 to the selected ROMs,
RAM, and disconnected I/O. Reset fetched `EA 5B E0 00 F0` at physical `FFFF0`
and entered `F000:E05B`. After 100,000 steps it was still polling PIT channel 1
during POST. This confirms the reset entry and an immediate hardware dependency;
it does **not** establish successful native POST or ROM BASIC.

## Firmware and media identity

The audited firmware was decoded from PCjs's numeric ROM dumps. Keep firmware
and software images external to the public repository and published site;
identify exact bytes rather than accepting a filename as proof of version.

| Image | Bytes | SHA-256 |
| --- | ---: | --- |
| [XT BIOS, 11/08/82][bios-image] | 8,192 | `2798f8a9a7dcab651ede40373d35269ad573b75acf811115c263e034ef80a1f2` |
| [IBM ROM BASIC C1.10][basic-image] | 32,768 | `3033d1a54c99d7e2aa1fc7c8c2e51a56ae1b61bf4e70e8aa580f43c43e37a63e` |
| Reference `disks/Dos3.3.img` (NEC MS-DOS 3.30) | 1,474,560 | `dcde53d1a4e4c1abed2d30f05a4674730eac14f4504924b83c97262d0f8c58d2` |

Map BIOS at `FE000–FFFFF` and BASIC at `F6000–FDFFF`. The original XT's ROM
decoding also repeats BASIC's first 8 KiB at `F0000`, `F2000`, and `F4000`;
this must not become writable RAM or a host stub area. The
[ROM layout notes][rom-layout] distinguish this arrangement from later 64 KiB
XT firmware. Check ROM mapping and write protection independently of boot.

The remaining fixture gates are a documented CGA character set and a pinned,
IBM-compatible **360 KiB DOS boot disk**. Select the DOS edition, bytes, boot
files, and expected transcript before claiming DOS acceptance. Do not relabel
or resize the reference's NEC image to fit the drive. Windows 2.0 and Ultima V
images in the reference are later software candidates, not verified native
targets. Hard-disk and EGA configurations need their own firmware/device choices.

## Native implementation boundaries

Author the machine composition and hardware explanation together in an
executable chapter under `src/machines/8088/`, using the existing
[machine](definitions.md) and [device](../devices/literate-specifications.md)
guides. Move implemented contracts and acceptance programs there as they land;
this document retains the reference comparison and remaining milestone criteria.
Prefer concrete device models and board wiring. Do not build a general
peripheral language from the XT alone.

The first board needs these observable behaviors:

- **8259A:** single-controller initialization, request/mask/in-service registers,
  priority, acknowledgement, and EOI. Offer INTR at CPU boundaries, and supply
  the vector only when the 8088 accepts it. An interrupt deferred by IF or an
  instruction's interrupt shadow must not consume the PIC request. Connect
  timer IRQ0, keyboard IRQ1, and later diskette IRQ6 explicitly.
- **8255 and XT keyboard:** ports `60–63`, direction changes, equipment switches,
  keyboard clock/clear, reset/self-test, and make/break delivery. POST first uses
  diagnostic configurations before normal keyboard input. Port `61` connects
  timer gate, speaker, parity controls, and keyboard signals; port `62` exposes
  the selected switches and status lines. Follow IBM's wiring rather than
  treating these as independent byte registers.
- **8253 and 8237A:** implement the timer and DMA register behavior used by POST
  and DRAM refresh. RAM need not physically decay, but the observable refresh
  and controller state must be consistent. Later disk transfers use DMA channel
  2, including address/count, page selection, direction, and terminal count.
- **Board glue:** declare the NMI enable latch at port `A0`, parity/I/O-check
  status and reset behavior, and unpopulated-device responses. These remain
  machine wiring rather than hidden CPU or BIOS special cases.
- **CGA:** physical text storage, attribute/character decoding, mode control,
  CRTC cursor/start address, and status behavior required by the ROM. Select and
  document the font source. Display reads must use detached observation, not
  CPU device reads. Declare absent graphics/composite behavior explicitly.
- **Diskette adapter:** original controller command/result phases, reset,
  drive selection, no-media errors, and IRQ behavior are needed even for the
  failed bootstrap that enters BASIC. Add sector/DMA transfers for DOS; do not
  skip the controller by recognizing INT 13h or a ROM address.

### Time is a prerequisite for firmware acceptance

Unlike the untimed CoCo BASIC profile, XT POST immediately checks the PIT and
refresh system. Before accepting ROM startup, define and independently test how
execution advances machine time: instruction and interrupt costs, halted CPU
progress, scheduled device events, and saved clock phase. Keep device ticks
integer and independent of rendering, host dates, and browser batch size.

The [timer chapter](../../src/machines/8088/xt-timer.md) now owns the explicit
oscillator clock, device-event ordering, and saved-phase contract. Its timed
path now consumes nominal clock declarations from the 8088 chapter and passes
the original BIOS’s channel-1 counter and channel-0 interrupt timing checks.
Timing coverage is partial; prefetch overlap and bus contention remain omitted.
Manual device ticks remain useful in component tests. An arbitrary tick per instruction or host-frame
timer is not evidence that POST or software timing is correct. Full electrical
simulation need not precede a documented, tested timing model.

## Acceptance checkpoints

### 1. Board and firmware startup

Use synthetic ROMs and independent expected values for the physical map,
segment/address wrap, port routing, PPI switch/keyboard behavior, PIC sequences,
PIT modes, DMA state, and CGA observation. Include interrupt masking, EOI,
keyboard acknowledgement, and idle CPU progress. Inspection must not consume
input, acknowledge requests, or advance clocks.

Then start the exact original firmware at `FFFF:0000`. Require POST to complete
without unexpected diagnostic errors, execute INT 19h's unsuccessful disk boot
with an empty drive, and enter ROM BASIC through INT 18h. Capture the firmware
path, configured memory/display, and prompt. Do not seed the IVT/BDA, intercept
BIOS calls, patch ROM, or jump directly to a convenient entry point. Publish
any expected diagnostics of the selected configuration explicitly.

### 2. ROM BASIC and repeatable sessions

At the prompt, `PRINT 2+3` must produce 5. Enter and list this program, then run
it and observe 5:

```basic
10 A=2
20 A=A+3
30 PRINT A
```

Replace line 20 with `20 A=A+4`, list and run again, and observe 6. Verify NEW,
Backspace editing, Shift, repeated keys separated by releases, and Ctrl-Break
from `10 GOTO 10`, followed by another successful immediate command. Capture
exact screen expectations from the selected ROM when implementing the test.
Pasted input must follow the same keyboard path as individual keys.

Distinguish CPU-only reset, fresh power-on, and Ctrl-Alt-Del's firmware warm
boot. Save/restore a stored program and a session with keyboard transfer and
interrupt work pending. Include CPU state, RAM/video memory, device registers,
pending events, clock phases, and host input schedule; validate firmware/media
identity. Replaying the same remaining inputs must reproduce execution and
output across stepping and different batch sizes. Focus loss must not leave a
key stuck; rejected media or snapshots preserve the current session.

### 3. Shared laboratory

Reuse the docking workspace, execution controls, debugger, change log, watches,
and history tools already shared by Apple II and CoCo. Add adapters for 8088
state, disassembly, instruction explanations, and PC devices. Keep hardware,
tools, and workspace layout separate.

The PC exposes concrete gaps to resolve in those shared tools: the memory
inspector currently assumes 64 KiB, while the 8088 has a 20-bit physical memory
space, logical segment:offset addresses, and a separate 16-bit port space.
Show both `CS:IP` and its physical address; retain `SS:SP` and segment context
for near/far calls, interrupts, RET/RETF/IRET, and stack inspection. Define
whether a breakpoint matches a logical execution location or a physical byte.
Do not merge aliased logical addresses or wrap memory displays at 64 KiB.
Account for the native CPU's recorded REP iterations when stepping and logging.

Exercise watchpoints and before/after values for RAM, video, and I/O separately.
Disassembly and preview must not execute device reads. With an IRQ pending and
a key held, opening, freezing, hiding, and repainting every panel must leave the
machine unchanged. Preserve both existing laboratories' behavior when extending
shared address and execution interfaces.

### 4. DOS through the diskette controller

Use the pinned 360 KiB fixture to boot from the original ROM through the real
INT 13h handler, controller commands, IRQ6, and DMA channel 2. Require a DOS
prompt, `VER`, `DIR`, `TYPE` of a known text file, and a small known COM program
that returns to DOS. Assert transferred bytes and the actual device path, not
just the screen. Test empty drive, invalid sector, write protection, reset, and
snapshot continuation during an in-flight transfer.

Begin with explicitly write-protected images. Writable media is a subsequent
checkpoint: create/read/delete a file, export and reload the changed image, and
verify bytes independently. Host FAT helpers may inspect images but must not
perform guest filesystem operations. EGA, audible speaker output, fixed disks,
and selected games follow as named configurations with their own acceptance;
AT/286 and later x86 remain separate CPU and machine projects.

## Next implementation slice

The PIC, PPI/keyboard, and PIT now have executable device descriptions and
native 8088 examples. Their chapters own supported profiles, clock/gate behavior,
snapshots, and acceptance tests. Original IRQ0 and IRQ1 handlers have separate
ROM-backed fixtures; neither test establishes POST.

Instruction-driven timing now passes isolated original BIOS timer checks.
Next add 8237A DMA/refresh behavior and extend checked instruction timing as
required by the next POST stages. Follow with CGA and the empty diskette-controller
path before attempting complete native POST. Keep every
firmware operation on the modeled hardware path.

[ibm]: https://minuszerodegrees.net/manuals/IBM_5160_Technical_Reference_APR83.pdf
[rom-layout]: https://www.pcjs.org/machines/pcx86/ibm/5160/rom/
[bios-image]: https://www.pcjs.org/machines/pcx86/ibm/5160/rom/bios/1982-11-08/XTBIOS-REV1.json5
[basic-image]: https://www.pcjs.org/machines/pcx86/ibm/5160/rom/basic/BASIC110.json5
[ref-commit]: https://github.com/jtauber/dromaios-pc/commit/a6fb9d10f4274dbd8ba40400e0b6761aec1d4b54
[ref-architecture]: https://github.com/jtauber/dromaios-pc/blob/a6fb9d10f4274dbd8ba40400e0b6761aec1d4b54/ARCHITECTURE.md
[ref-cpu]: https://github.com/jtauber/dromaios-pc/blob/a6fb9d10f4274dbd8ba40400e0b6761aec1d4b54/js/cpu_8088.js
[ref-memory]: https://github.com/jtauber/dromaios-pc/blob/a6fb9d10f4274dbd8ba40400e0b6761aec1d4b54/js/mem_xt.js
[ref-bios]: https://github.com/jtauber/dromaios-pc/blob/a6fb9d10f4274dbd8ba40400e0b6761aec1d4b54/js/bios.js
[ref-pic]: https://github.com/jtauber/dromaios-pc/blob/a6fb9d10f4274dbd8ba40400e0b6761aec1d4b54/js/pic.js
[ref-pit]: https://github.com/jtauber/dromaios-pc/blob/a6fb9d10f4274dbd8ba40400e0b6761aec1d4b54/js/pit.js
[ref-ega]: https://github.com/jtauber/dromaios-pc/blob/a6fb9d10f4274dbd8ba40400e0b6761aec1d4b54/js/ega.js
[ref-main]: https://github.com/jtauber/dromaios-pc/blob/a6fb9d10f4274dbd8ba40400e0b6761aec1d4b54/js/main.js
[ref-tests]: https://github.com/jtauber/dromaios-pc/blob/a6fb9d10f4274dbd8ba40400e0b6761aec1d4b54/test.js
