import { opcodeFamily } from "./opcodes.ts";
import { dataRegisters68000 as data, operand68000, selectors68000 as codes } from "./68000-operands.ts";

export type ShiftKind68000 = "AS" | "LS" | "ROX" | "RO";
const bitOperations = ["BTST", "BCHG", "BCLR", "BSET"] as const;
const shiftKinds = ["AS", "LS", "ROX", "RO"] as const;
const register = (code: number) => ({ kind: "register", name: data[code]! } as const);

export const bitForms68000 = [
  // 0000 bbb 1 oo mmm rrr: bbb selects the bit-number Dn; oo=00 BTST, 01 BCHG, 10 BCLR, 11 BSET.
  // 0000 1000 oo mmm rrr instead fetches the bit-number word before EA extensions.
  // Dn tests modulo 32; every other operand tests modulo 8. Mode 001 belongs to MOVEP.
  ...opcodeFamily("0000 bbb d oo mmm rrr", { b: codes, d: [false, true], o: bitOperations, m: codes, r: codes },
    ({ b, d: dynamic, o: operation, m, r }) => {
      if (!dynamic && b !== 4) return undefined; // Static bits require bbb=100; other d=0 slots belong to separate families.
      if (m === 1) return undefined;
      const size = m === 0 ? 32 : 8;
      const destination = operand68000(size, m, r, operation === "BTST" ? "source" : "destination");
      // BTST alone accepts PC-relative data; only dynamic BTST can test an immediate byte.
      if (!destination || (!dynamic && destination.kind === "immediate")) return undefined;
      const source = dynamic ? register(b) : { kind: "immediate", name: "immediate" } as const;
      return { kind: "bit", operation, size, source, destination,
        sourceMode: dynamic ? 0 : 7, sourceCode: dynamic ? b : 4, destinationMode: m, destinationCode: r } as const;
    }),
  // 1110 ccc d ss i tt rrr: d=0 right, 1 left; ss=00 byte, 01 word, 10 long (11 is memory below).
  // i=0 ccc is a quick count (000 means 8); i=1 Dccc supplies its low six bits, including zero.
  // tt=00 arithmetic, 01 logical, 10 rotate through X, 11 rotate. Capture count before Drrr.
  ...opcodeFamily("1110 ccc d ss i tt rrr", { c: codes, d: ["R", "L"] as const, s: [8, 16, 32, undefined] as const,
    i: [false, true], t: shiftKinds, r: codes }, ({ c, d: direction, s: size, i: dynamic, t: shift, r }) => {
    if (!size) return undefined;
    return { kind: "shift", operation: `${shift}${direction}`, shift, direction, size,
      source: dynamic ? register(c) : { kind: "count", name: "quick" } as const, destination: register(r),
      sourceMode: 0, sourceCode: c, destinationMode: 0, destinationCode: r } as const;
  }),
  // 1110 0 tt d 11 mmm rrr: memory shifts a word once; only memory-alterable EAs are legal.
  // Bit 11=1 belongs to later processors' bit-field instructions.
  ...opcodeFamily("1110 0 tt d 11 mmm rrr", { t: shiftKinds, d: ["R", "L"] as const, m: codes, r: codes }, ({ t: shift, d: direction, m, r }) => {
    const destination = operand68000(16, m, r, "destination");
    return destination?.kind === "memory" ? { kind: "shift", operation: `${shift}${direction}`, shift, direction, size: 16,
      source: { kind: "count", name: "one" }, destination, sourceMode: 0, sourceCode: 0, destinationMode: m, destinationCode: r } as const : undefined;
  }),
  // 0100 1010 11 mmm rrr: TAS tests the original byte then sets bit 7. Only data-alterable EAs.
  // The excluded immediate slot, 0100 1010 1111 1100, is ILLEGAL.
  ...opcodeFamily("0100 1010 11 mmm rrr", { m: codes, r: codes }, ({ m, r }) => {
    const destination = operand68000(8, m, r, "destination");
    return destination && destination.kind !== "immediate" ? { kind: "tas", operation: "TAS", size: 8, source: undefined,
      destination, sourceMode: 0, sourceCode: 0, destinationMode: m, destinationCode: r } as const : undefined;
  }),
].flatMap(([opcode, form]) => form ? [{ opcode, ...form, body: `${form.operation}_${form.size}_${form.source?.name ?? "none"}_${form.destination.name}` }] : []);

export type BitForm68000 = typeof bitForms68000[number];
