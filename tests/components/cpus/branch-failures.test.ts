import assert from "node:assert/strict";
import { test } from "node:test";
import { Cpu6502 } from "../../../src/components/cpus/generated/6502-cpu.js";
import { Cpu6800 } from "../../../src/components/cpus/generated/6800-cpu.js";
import { Cpu6809 } from "../../../src/components/cpus/6809.js";
import { Cpu8080 } from "../../../src/components/cpus/generated/8080-cpu.js";
import { CpuZ80 } from "../../../src/components/cpus/z80.js";
import type { CpuZ80InterruptAccess } from "../../../src/components/cpus/z80.js";
import { ObservedRam } from "../../helpers/observed-ram.js";
import { wordState } from "../../helpers/intel-words.js";
import { readAccess } from "./z80/helpers.js";

type CpuName = "6502" | "6800" | "6809" | "8080" | "z80";
interface Flags { n: boolean; v: boolean; z: boolean; c: boolean }
interface Form {
  readonly opcode: readonly number[];
  readonly operands?: readonly number[];
  readonly displacement?: 8 | 16;
  readonly target?: number;
  readonly taken?: (flags: Flags) => boolean;
  readonly djnz?: boolean;
  readonly reads?: readonly { readonly address: number; readonly value: number }[];
}
// Literal encodings and independent Boolean predicates; do not import the production pattern or condition builders.
const motorola: readonly Form[] = ([
  { opcode: [0x20], taken: () => true }, { opcode: [0x21], taken: () => false },
  { opcode: [0x22], taken: f => !f.c && !f.z }, { opcode: [0x23], taken: f => f.c || f.z },
  { opcode: [0x24], taken: f => !f.c }, { opcode: [0x25], taken: f => f.c },
  { opcode: [0x26], taken: f => !f.z }, { opcode: [0x27], taken: f => f.z },
  { opcode: [0x28], taken: f => !f.v }, { opcode: [0x29], taken: f => f.v },
  { opcode: [0x2a], taken: f => !f.n }, { opcode: [0x2b], taken: f => f.n },
  { opcode: [0x2c], taken: f => f.n === f.v }, { opcode: [0x2d], taken: f => f.n !== f.v },
  { opcode: [0x2e], taken: f => !f.z && f.n === f.v }, { opcode: [0x2f], taken: f => f.z || f.n !== f.v },
] satisfies Form[]).map(form => ({ ...form, displacement: 8 }));
const intel: readonly Form[] = ([
  { opcode: [0xc2], taken: f => !f.z }, { opcode: [0xca], taken: f => f.z },
  { opcode: [0xd2], taken: f => !f.c }, { opcode: [0xda], taken: f => f.c },
  { opcode: [0xe2], taken: f => !f.v }, { opcode: [0xea], taken: f => f.v },
  { opcode: [0xf2], taken: f => !f.n }, { opcode: [0xfa], taken: f => f.n },
  { opcode: [0xc3] },
] satisfies Form[]).map(form => ({ ...form, operands: [0x56, 0x34], target: 0x3456 }));
const forms: Readonly<Record<CpuName, readonly Form[]>> = {
  "6502": [
    ...([
      [0x10, (f: Flags) => !f.n], [0x30, (f: Flags) => f.n], [0x50, (f: Flags) => !f.v], [0x70, (f: Flags) => f.v],
      [0x90, (f: Flags) => !f.c], [0xb0, (f: Flags) => f.c], [0xd0, (f: Flags) => !f.z], [0xf0, (f: Flags) => f.z],
    ] as const).map(([opcode, taken]): Form => ({ opcode: [opcode], taken, displacement: 8 })),
    { opcode: [0x4c], operands: [0x56, 0x34], target: 0x3456 },
    { opcode: [0x6c], operands: [0xff, 0x12], reads: [{ address: 0x12ff, value: 0x56 }, { address: 0x1200, value: 0x34 }], target: 0x3456 },
  ],
  "6800": [...motorola.filter(form => form.opcode[0] !== 0x21),
    { opcode: [0x6e], operands: [0xfe], target: 0xfd }, { opcode: [0x7e], operands: [0x34, 0x56], target: 0x3456 }],
  "6809": [...motorola,
    ...motorola.map((form): Form => ({ ...form, opcode: form.opcode[0] === 0x20 ? [0x16] : [0x10, form.opcode[0]!], displacement: 16 })),
    { opcode: [0x0e], operands: [0xfe], target: 0xabfe }, { opcode: [0x6e], operands: [0x84], target: 0xffff },
    { opcode: [0x7e], operands: [0x34, 0x56], target: 0x3456 }],
  "8080": [...intel, { opcode: [0xe9], target: 0x1234 }],
  z80: [...intel, { opcode: [0xe9], target: 0x1234 }, { opcode: [0xdd, 0xe9], target: 0x3456 }, { opcode: [0xfd, 0xe9], target: 0x5678 },
    { opcode: [0x18], displacement: 8 }, { opcode: [0x10], displacement: 8, djnz: true },
    { opcode: [0x20], displacement: 8, taken: f => !f.z }, { opcode: [0x28], displacement: 8, taken: f => f.z },
    { opcode: [0x30], displacement: 8, taken: f => !f.c }, { opcode: [0x38], displacement: 8, taken: f => f.c }],
};
const constructors = { "6502": Cpu6502, "6800": Cpu6800, "6809": Cpu6809, "8080": Cpu8080, z80: CpuZ80 };

test("the independent control-flow inventory covers exactly the 90 migrated native forms", () => {
  assert.deepEqual(Object.values(forms).map(entries => entries.length), [10, 17, 35, 10, 18]);
  for (const entries of Object.values(forms)) assert.equal(new Set(entries.map(form => form.opcode.join(","))).size, entries.length);
});

for (const name of Object.keys(forms) as CpuName[]) {
  test(`${name} jumps and branches preserve complete records and partial effects at every failed read`, () => {
    const failure = new Error("branch read failure"), isIntel = name === "8080" || name === "z80", z80 = name === "z80";
    for (const form of forms[name]) for (const pc of [0, 0xfffe, 0xffff]) for (let mask = 0; mask < 16; mask++) {
      const flags: Flags = { n: Boolean(mask & 8), v: Boolean(mask & 4), z: Boolean(mask & 2), c: Boolean(mask & 1) };
      for (const offset of form.displacement ? [0, 2 ** (form.displacement - 1) - 1, 2 ** (form.displacement - 1), 2 ** form.displacement - 1] : [0]) {
        const operands = form.displacement ? form.displacement === 16 ? [Math.floor(offset / 256), offset % 256] : [offset] : form.operands ?? [];
        const bytes = [...form.opcode, ...operands], count = bytes.length + (form.reads?.length ?? 0);
        for (const external of isIntel ? [false, true] : [false]) for (const b of form.djnz ? [0, 1, 2, 0xff] : [0x22]) {
          for (let failAt = -1; failAt < count; failAt++) {
            let running = false, attempts = 0;
            const completed: CpuZ80InterruptAccess[] = [], attempt = () => { if (attempts++ === failAt) throw failure; };
            class FaultRam extends ObservedRam {
              override read(address: number): number {
                if (running) attempt(); const value = super.read(address);
                if (running) completed.push(readAccess(address, value)); return value;
              }
            }
            const ram = new FaultRam();
            if (!external) bytes.forEach((value, index) => ram.write((pc + index) % 65536, value));
            for (const { address, value } of form.reads ?? []) ram.write(address, value);
            const initial = { ...wordState(), pc, b, h: 0x12, l: 0x34, x: name === "6502" ? 0xff : 0xffff, y: name === "6502" ? 0x67 : 0x4567, s: 0x789a, u: 0x9abc, dp: 0xab,
              sp: name === "6502" ? 0xff : 0x9876, ix: 0x3456, iy: 0x5678, waiting: false, waitMode: "none" as const, nmiArmed: true,
              flags: { ...wordState().flags, ...flags, s: flags.n, p: flags.v, pv: flags.v, cy: flags.c, i: true, d: true, e: true, f: true },
              r: 0xff, im: 0 as const, iff1: true, iff2: true, halted: external, interruptDeferred: !external, nmiDeferred: true };
            const cpu = new constructors[name](ram, initial), before = cpu.snapshot(), success = failAt < 0;
            const reads = success ? count : failAt, decoded = success || failAt >= form.opcode.length;
            const sequential = external ? pc : (pc + (z80 && !decoded ? 0 : Math.min(reads, bytes.length))) % 65536;
            const taken = form.djnz ? b !== 1 : form.taken ? form.taken(flags) : true;
            const signed = form.displacement && offset >= 2 ** (form.displacement - 1) ? offset - 2 ** form.displacement : offset;
            const target = form.displacement ? (sequential + signed + 65536) % 65536 : form.target!;
            const refresh = external ? form.opcode.length === 2 && failAt !== 0 ? 2 : 1 : decoded ? form.opcode.length : 0;
            const after = { ...before, pc: success && taken ? target : sequential,
              ...(isIntel ? { halted: false, interruptDeferred: !external && !success } : {}),
              ...(z80 ? { r: 0x80 + (127 + refresh) % 128, iff1: !external, iff2: !external, nmiDeferred: !success }
                : name === "8080" ? { interruptEnabled: !external } : {}),
              ...(form.djnz && success ? { b: (b + 255) % 256, bc: (b + 255) % 256 * 256 + initial.c } : {}),
            };
            const accesses: CpuZ80InterruptAccess[] = [
              ...bytes.map((value, index) => external ? { kind: "acknowledge" as const, value } : readAccess((pc + index) % 65536, value)),
              ...(form.reads ?? []).map(({ address, value }) => readAccess(address, value)),
            ];
            ram.accesses.length = 0; running = true;
            const run = () => {
              let supplied = 0;
              const acknowledge = () => { attempt(); const value = bytes[supplied++]!; completed.push({ kind: "acknowledge", value }); return value; };
              return external ? cpu instanceof CpuZ80 ? cpu.interrupt("irq", acknowledge)
                : cpu instanceof Cpu8080 ? cpu.interrupt(acknowledge) : assert.fail("not an Intel CPU") : cpu.step();
            };
            if (success) assert.deepEqual(run(), { before, after, accesses, outcome: "executed",
              ...(external && z80 ? { source: "irq" } : {}), instruction: external ? { source: "interrupt", bytes } : { address: pc, bytes } });
            else assert.throws(run, error => error === failure);
            assert.deepEqual(cpu.snapshot(), after, `${name} ${bytes.join(",")}, PC=${pc}, flags=${mask}, external=${external}, failure=${failAt}`);
            assert.deepEqual(completed, accesses.slice(0, reads));
            assert.deepEqual(ram.accesses, completed.filter(access => access.kind !== "acknowledge"));
            assert.equal(attempts, success ? count : failAt + 1);
          }
        }
      }
    }
  });
}
