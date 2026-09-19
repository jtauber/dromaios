import { opcodeFamily } from "./opcodes.ts";
import { isControlAddress68000 } from "./68000-control.ts";
import { addressRegisters68000 as address, dataRegisters68000 as data, selectors68000 as codes } from "./68000-operands.ts";

export const transferForms68000 = [
  // 0000 ddd 1 t s 001 aaa: MOVEP transfers alternate bytes at (signed displacement,Aaaa).
  // t=0 memory to Dddd, 1 Dddd to memory; s=0 word, 1 long. Odd addresses are legal.
  ...opcodeFamily("0000 ddd 1 t s 001 aaa", { d: data, t: [false, true], s: [16, 32] as const, a: address },
    ({ d: register, t: store, s: size, a: base }) => ({ kind: "peripheral", register, base, store, size, mode: 0, code: 0,
      body: `MOVEP_${size}_${store ? "store" : "load"}_${register}_${base}` } as const)),
  // 0100 1 d 00 1 s mmm rrr: MOVEM fetches a register mask before any EA extensions.
  // d=0 registers to memory, 1 memory to registers; s=0 word, 1 long.
  // Stores allow alterable control EAs and -(An); loads allow control EAs and (An)+.
  ...opcodeFamily("0100 1 d 00 1 s mmm rrr", { d: [false, true], s: [16, 32] as const, m: codes, r: codes },
    ({ d: load, s: size, m: mode, r: code }) => {
      const control = isControlAddress68000(mode, code) && (load || mode !== 7 || code <= 1);
      const predecrement = !load && mode === 4, postincrement = load && mode === 3;
      if (!control && !predecrement && !postincrement) return undefined;
      const base = predecrement || postincrement ? address[code]! : undefined;
      const program = mode === 7 && code >= 2;
      return { kind: "multiple", size, load, base, predecrement, program, mode, code,
        body: `MOVEM_${size}_${load ? "load" : "store"}_${base ?? (program ? "program" : "memory")}` } as const;
    }),
].flatMap(([opcode, form]) => form ? [{ opcode, ...form }] : []);

export type TransferForm68000 = typeof transferForms68000[number];
