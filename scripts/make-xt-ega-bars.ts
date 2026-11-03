import { readFileSync, writeFileSync } from "node:fs";
import { bootableXtDisk, dosFile } from "./xt-floppy.ts";

/** BARS.COM calls the IBM BIOS and writes all four planes through the CPU aperture. */
export function makeXtEgaBarsDisk(dos: Buffer): Buffer {
  const program = Buffer.from([
    0xb4, 0x12, 0xb3, 0x10, 0xcd, 0x10,       // AH=12h, BL=10h: query EGA configuration
    0x83, 0xfb, 0x03, 0x74, 0x05,             // CMP BX,0003h (colour, 256 KiB); JE start
    0xb8, 0x01, 0x4c, 0xcd, 0x21,             // Return errorlevel 1 to DOS
    0xb8, 0x0d, 0x00, 0xcd, 0x10,             // start: INT 10h, set mode 0Dh
    0x0e, 0x07,                               // PUSH CS; POP ES (the COM segment)
    0xe8, 17, 0,                              // CALL past table; return address points to palette
    0x17, 0x16, 0x15, 0x14, 0x13, 0x12, 0x11, 0x10,
    0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01, 0x00, 0x00, // Reversed RGBI colours, black border
    0x5a, 0xb8, 0x02, 0x10, 0xcd, 0x10,       // POP DX; INT 10h, load palette from ES:DX
    0xb8, 0x00, 0x05, 0xcd, 0x10,             // INT 10h, select page zero
    0xb8, 0x00, 0xa0, 0x8e, 0xc0,             // MOV AX,A000h; MOV ES,AX
    0x31, 0xff, 0xfc,                         // XOR DI,DI; CLD
    0xba, 0xce, 0x03, 0xb8, 0x05, 0x02, 0xef, // OUT 3CEh,AX: graphics register 5 = write mode 2
    0x31, 0xc0,                               // XOR AX,AX: first logical colour is zero
    0xb9, 0xe0, 0x01,                         // band: MOV CX,480 (12 rows of 40 bytes)
    0xa8, 0x01, 0x74, 0x03,                   // TEST AL,1; JZ fill
    0xb9, 0x08, 0x02,                         // Odd bands occupy 520 bytes (13 rows)
    0xf3, 0xaa,                               // fill: REP STOSB, low four bits fan out to the planes
    0xfe, 0xc0, 0x3c, 16, 0x72, 0xee,         // INC AL; CMP AL,16; JB band
    0x31, 0xc0, 0xcd, 0x16,                   // INT 16h, wait for one key
    0xb8, 3, 0, 0xcd, 0x10,                   // Restore BIOS text mode
    0xb8, 0, 0x4c, 0xcd, 0x21,                // Return to DOS
  ]);
  const batch = Buffer.from("@ECHO OFF\r\nBARS\r\nIF ERRORLEVEL 1 ECHO Requires a 256 KiB colour EGA.\r\n");
  return bootableXtDisk(dos, [dosFile("AUTOEXEC.BAT", batch), dosFile("BARS.COM", program)]);
}

if (import.meta.main) {
  const [dos, output, ...extra] = process.argv.slice(2);
  if (!dos || !output || extra.length) throw new Error("Usage: node scripts/make-xt-ega-bars.ts DOS-DISK1.IMG OUTPUT.IMG");
  writeFileSync(output, makeXtEgaBarsDisk(readFileSync(dos)), { flag: "wx" });
}
