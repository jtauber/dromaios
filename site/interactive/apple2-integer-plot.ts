import type { Cpu6502StepRecord } from "../../src/components/cpus/generated/6502-cpu.js";
import type { DebugLocation } from "./instruction-debugger.js";

export interface IntegerPlot { readonly line: number; readonly token: number }

/** Follow the System Master's Integer BASIC token reader, PLOT handler, and Monitor store. */
export function createIntegerPlotTrace() {
  let token: (IntegerPlot & { lineStart: number }) | undefined, drawing: IntegerPlot | undefined;
  return {
    reset(): void { token = drawing = undefined; },
    observe(record: Cpu6502StepRecord, caller: DebugLocation, ram: { read(address: number): number }): IntegerPlot | undefined {
      const pc = caller.address;
      if (caller.space !== "lc-upper" || record.outcome !== "executed") {
        token = drawing = undefined;
        return;
      }
      const bytes = record.instruction.bytes;
      if (pc === 0xe684 && record.after.a === 0x67 && bytes[0] === 0xb1 && bytes[1] === 0xe0) {
        // LDA ($E0),Y fetched the PLOT token in a numbered line. Direct commands live elsewhere.
        const read = record.accesses.at(-1)!, lineStart = ram.read(0xdc) + 256 * ram.read(0xdd);
        token = undefined;
        if (read.kind === "read" && read.value === 0x67 && lineStart >= 0x0800 && lineStart < 0xc000
          && read.address >= lineStart + 3 && read.address < Math.min(0xc000, lineStart + ram.read(lineStart))) {
          token = { lineStart, line: ram.read(lineStart + 1) + 256 * ram.read(lineStart + 2), token: read.address };
        }
      }
      if (record.after.pc === 0xf800) {
        // Attribute the next plot only when the interpreter itself transfers control to PLOT.
        drawing = pc === 0xee4b && bytes[0] === 0x4c && token?.lineStart === ram.read(0xdc) + 256 * ram.read(0xdd) ? token : undefined;
        token = undefined;
      } else if (drawing) {
        if (pc === 0xf816 && bytes[0] === 0x91 && bytes[1] === 0x26) {
          const source = drawing; drawing = undefined; return source;
        }
        // PLOT calls GBASCALC at $F847 to find the interleaved row address.
        if (!(pc >= 0xf800 && pc < 0xf818 || pc >= 0xf847 && pc <= 0xf85e)) drawing = undefined;
      }
    },
  };
}
