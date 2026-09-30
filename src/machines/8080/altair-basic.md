# Altair 8800: loading 4K BASIC

This is a four-kilobyte Altair with an Intel 8080 and the first channel of a
MITS 88-2SIO serial board. It starts with the short bootstrap an operator would
enter through the panel. The rest of the software must arrive as serial bytes:
the historical loaders execute on the CPU and place BASIC in RAM.

The [BASIC manual][manual], Appendix A supplement, printed page 99, provides
the 2SIO bootstrap for version 3.2. The archived [assembly listing][loader]
and [Intel HEX image][loader-hex] independently identify its bytes. The selected
software is [MITS 4K BASIC 3.2 paper tape][tape]. The browser uses this generated
machine for its terminal and execution controls; fuller panel integration remains
work toward the [complete machine target](../../../docs/machines/altair-basic.md).

## Components and address space

Only addresses 0000–0FFF contain RAM. The CPU still drives sixteen address bits;
1000–FFFF have no storage. This machine declares a fixed FF value for undriven
memory reads and discards writes with no responding component. This is a model
choice for the unused bus, not a claim that floating electrical lines always
read identically on every Altair. There is no mirroring or ROM. BASIC's memory
probe can therefore discover the actual writable limit instead of being given
a precomputed memory size.

```machine
components {
    ram = ram 1000
    serial = mc6850-polling
    sense = altair-sense-switches
}

cpu 8080 {
    A = 00  B = 00  C = 00  D = 00  E = 00  H = 00  L = 00
    PC = 0000  SP = 0000
    flags { S = 0  Z = 0  AC = 0  P = 0  CY = 0 }
    interruptEnabled = false  interruptDeferred = false  halted = false
}

map 10000 {
    0000 = ram
    unmapped = FF
}
```

## Serial and panel connections

The [MC6850 polling profile](../../components/devices/specifications/mc6850-polling.md)
owns serial readiness, buffering, control, and reset. The board connects status
and control at port 10, receive/transmit data at 11. The
[sense-switch device](../../components/devices/specifications/altair-sense-switches.md)
is read at FF. These are hexadecimal addresses (octal 20, 21, and 377).
Unconnected input ports return FF and unconnected output writes are discarded,
as explicitly declared below. BASIC reads the old serial data port 01 during
startup before selecting the 2SIO; leaving that read unanswered must not abort
execution. Invalid host port numbers and byte values still throw.

```machine
ports {
    unmapped = FF
    in 10 = serial 0
    out 10 = serial 0
    in 11 = serial 1
    out 11 = serial 1
    in FF = sense 0
}
reset { cpu serial sense }
```

Raise A11 and A10 before running the bootstrap, with the other sense switches
down: `sense.offer(0x0c)`. This is an operator action, not a CPU register or a
serial character. Keep the switches there through BASIC initialization so both
the loader and interpreter select the 2SIO and one stop bit. Construction leaves
all switches down. Machine reset resets the CPU and serial device, preserves
RAM, and leaves the physical switch positions alone.

## The entered bootstrap

The 28-byte image begins at zero. All other RAM starts zeroed. Its first four
instructions reset the ACIA and select eight data bits, no parity, one stop bit,
and division by sixteen. H:L starts at 0FAE. The tape's AE leader bytes are
ignored; each following byte is deposited backwards into the top page of RAM.
Once L reaches zero, PCHL enters the downloaded checksum loader at 0F00.

LXI SP points to a word holding 000B. The conditional returns use this word to
branch back to the polling loop; each pass restores SP. This saves bootstrap
bytes without requiring a CALL instruction or a separately initialized stack.

```machine
image ram 0000 {
    3E 03       // 0000: MVI A,03 — reset ACIA.
    D3 10       // 0002: OUT 10.
    3E 15       // 0004: MVI A,15 — select 8N1.
    D3 10       // 0006: OUT 10.
    21 AE 0F    // 0008: LXI H,0FAE — loader end/leader byte.
    31 1A 00    // 000B: LXI SP,001A — return word.
    DB 10       // 000E: IN 10 — receive status.
    0F          // 0010: RRC — readiness into carry.
    D0          // 0011: RNC — wait if no character.
    DB 11       // 0012: IN 11 — receive a byte.
    BD          // 0014: CMP L — ignore leader.
    C8          // 0015: RZ.
    2D          // 0016: DCR L — descending load address.
    77          // 0017: MOV M,A — store the byte.
    C0          // 0018: RNZ — keep loading.
    E9          // 0019: PCHL — enter downloaded loader.
    0B 00       // 001A: loop address, low byte first.
}
```

No CPU execution record is produced by initial image loading. Subsequent tape
deposits are ordinary CPU memory writes and are recorded. The checksum loader
eventually overwrites this bootstrap. Reset therefore does not promise to reload
BASIC or recreate the bootstrap: construct a fresh machine to repeat loading.

## Media and host delivery

The [selected tape][tape] is supplied separately; source generation neither downloads
nor embeds it. This media record supplies the browser's local file checks:

```json
{
  "bytes": 4352,
  "sha256": "fd01fd8b5c3dfbf67709809a1da6409ff1e0cb9c108fbe6a5129f8ad8e68d90f"
}
```

Selecting a file checks its complete size and digest before replacing the
stopped machine. The file stays in the browser; it is not uploaded or included
in the published site. A rejected selection preserves the previous machine
and selected tape, stopped for inspection.

The host retains each byte until `serial.offer(byte)` accepts it. Acceptance
fills the receive register; only the CPU's IN consumes it. This backpressure
models a paced reader without serial wire timing or receive overrun.

The terminal displays seven-bit ASCII; it strips bit 7 from received characters
without changing the eight-bit serial-device data. BASIC emits some string
terminators with that bit still set. It also emits repeated carriage returns;
the raw output retains them. Input uses carriage return to submit a response. For
the initial acceptance run, answer MEMORY SIZE? with an empty response so BASIC
probes RAM; retain the default terminal width and answer Y to WANT SIN?.

## Acceptance and limits

The [machine tests](../../../tests/machines/8080/altair-basic.test.ts) check the
entered bytes against the published listing, RAM boundaries and bus records,
sense-switch IN, port decoding, reset, and independent instances. An acceptance
run with the supplied tape must execute both loaders, reach the initialization
dialog and OK, and evaluate PRINT 40+2 as 42. It must not replace the loaded RAM
with a prepared snapshot or intercept BASIC routines.

The [external-media test](../../../tests/machines/8080/altair-basic-tape.test.ts)
performs that run with a supplied tape, validating its size and digest first.
After building, run it from the repository root:

```sh
ALTAIR_BASIC_TAPE=/path/to/4k-basic-3-2.tap node --test dist/tests/machines/8080/altair-basic-tape.test.js
```

Set the same variable for `npm test` to include it in the full regression run.
Without the variable, the external-media tests are explicitly skipped; all synthetic device,
bus, machine, and bootstrap checks still run. Nothing is downloaded by the test.
The observed startup reports **727 BYTES FREE** when retaining SIN, SQR, and RND.
The test checks the full displayed response, including carriage returns, and
observes the actual RAM probe past 0FFF.

The checksum loader consumes 4,300 tape bytes through its start record; the
remaining 52 bytes are zero padding. The host continues offering that padding
before console input. BASIC's serial reinitialization can clear a buffered
padding byte, just as a master reset clears received data in the device model.
The acceptance run observes both the reverse-order bootstrap deposits and the
checksum loader's transfer to BASIC; reaching a prompt alone is not the test.

### Programs, editing, and execution controls

The same test now drives a shared [serial session](../../../docs/runtime/serial-session.md).
The session owns host queues and bounded execution; every BASIC operation below
still executes in the original interpreter. The program is entered out of line
number order, and LIST must produce this ordered result:

```basic
10 INPUT N
20 FOR I=1 TO N
30 GOSUB 100
40 NEXT I
50 END
100 PRINT I*2
110 RETURN
```

RUN prompts for a number. Entering 3 prints 2, 4, and 6, then returns to OK.
Replacing line 100 with `100 PRINT I*3` must change the existing line rather
than add a duplicate. Entering the number 110 alone deletes that line; LIST
must omit it. Restoring `110 RETURN` and running again with input 3 prints
3, 6, and 9. NEW clears the program; a subsequent LIST contains no numbered lines.

The manual's special-character rules (printed pages 41–42) belong to BASIC,
not to the session. In `PRINT 40+9_2`, underscore erases the 9, producing 42.
In `PRINT 99@PRINT 6*7`, at-sign cancels the first line; only the replacement
expression executes, also producing 42. These input bytes and BASIC's echoes
are preserved in the checked transcript. Modern keyboard-to-byte mapping is
handled by the browser terminal as described below.

An endless `10 GOTO 10` distinguishes two kinds of stopping. Host STOP leaves
CPU, RAM, serial state, and queued transport unchanged; another batch does
nothing until RUN resumes. Resumption produces no guest break or OK. Sending
Control-C (03) lets BASIC return to OK, after which `PRINT 1+1` produces 2.
For this 4K version the tested break response is OK without an 8K-style line-number message.

Session reset delegates to the machine reset declared above: it stops execution,
discards pending host input, preserves RAM and physical switches, and holds the
ACIA in reset. It is not a BASIC warm-start command. Session reload constructs
the chapter's initial machine, restores the panel bootstrap, clears host output,
and resets the switches to down. With A11/A10 raised again and the same supplied
tape, the checked reload reaches MEMORY SIZE? once more.

This chapter defines a headless machine composition, not a complete Altair
electrical model. It has no clock counts, DMA, wait states, second serial channel,
baud-rate delay, interrupts from peripherals, or cycle-level panel signals.
Only the declared polling serial profile is supported. Full front-panel
examination/deposit and cycle-level lights remain subsequent work.

## Using the browser machine

Download the [selected tape][tape], choose it in the file control, raise A11/A10
with the loading-switch control, then select RUN. Click the keyboard field
below the terminal. At MEMORY SIZE? press Enter; press Enter for the default
terminal width, then type Y and Enter at WANT SIN?. BASIC should report
727 BYTES FREE and OK. Type `PRINT 40+2` and Enter to see 42.

The keyboard sends ASCII as typed, with no local echo or automatic capitalization;
use uppercase BASIC commands. Enter sends carriage return. Backspace sends
underscore, BASIC's erase character; @ cancels a line. Control-C or the Break
button sends byte 03. Paste one line at a time, waiting for BASIC to finish
between lines: its input checks can discard typeahead while storing a program.
Multiline/non-ASCII pastes are rejected as a whole. Tab leaves the keyboard
field normally, and copy shortcuts remain available on the output.

The printing-terminal view masks bit 7, returns its cursor on CR, advances a
line on LF, moves back on BS, and uses eight-column tab stops. It retains the
latest 200 lines, wrapping at 132 columns. Other non-printing codes are ignored;
there are no escape sequences, sound, or terminal identification. Characters
are rendered as text. This is a small presentation model, not a particular
historical terminal. It does not change the serial device's raw bytes.

RUN executes batches of at most 2,000 instructions and yields between them.
STOP cancels further batches. Hiding or leaving the page also stops execution;
returning does not resume it automatically. There is no claim of hardware clock
speed. The trace retains twelve records and inspection uses snapshots without
consuming device input. The terminal and host input queue are bounded; a full
keyboard queue rejects another offer rather than silently dropping characters.

The [browser-session test](../../../tests/site/altair-basic.test.ts) checks this
scheduler and printing terminal with the supplied tape, a BASIC loop, STOP,
Control-C, and reload. The same `ALTAIR_BASIC_TAPE` setting enables it.

Reset preserves loaded RAM and switches but ejects host input and resets the
CPU and ACIA; it does not warm-start BASIC. Reload tape constructs a fresh
machine with the original bootstrap and the last verified tape, clears the
terminal, and lowers the switches. Raise A11/A10 again and RUN to repeat loading.

[manual]: https://altairclone.com/downloads/manuals/BASIC%20Manual%2075.pdf
[loader]: https://altairclone.com/downloads/basic/Paper%20Tape%20and%20Cassette/2SIO%20Loaders/Ldr4k32.asm
[loader-hex]: https://altairclone.com/downloads/basic/Paper%20Tape%20and%20Cassette/2SIO%20Loaders/LDR4K32.HEX
[tape]: https://altairclone.com/downloads/basic/Paper%20Tape%20and%20Cassette/4K%20BASIC%20Ver%203-2.tap
