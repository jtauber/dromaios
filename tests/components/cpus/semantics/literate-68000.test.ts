import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { Cpu68000 } from "../../../../src/components/cpus/68000.js";
import type { Cpu68000AddressContext, OperandAlignmentFault } from "../../../../src/components/cpus/68000-context.js";
import type { ByteMemory } from "../../../../src/components/cpus/memory-access.js";
import { cpu68000StateDescription } from "../../../../src/components/cpus/state/68000.js";
import type { Cpu68000State } from "../../../../src/components/cpus/state/68000.js";
import { instructions as registerBodies } from "../../../../src/components/cpus/generated/68000.js";
import { opcodeInstructions as memoryBodies } from "../../../../src/components/cpus/generated/68000-moves.js";
import { opcodeInstructions as quickBodies } from "../../../../src/components/cpus/generated/68000-quick.js";
import { instructions68000, moves68000 } from "../../../../src/components/cpus/semantics/definitions/68000.js";
import { instructionAliases } from "../../../../src/components/cpus/semantics/builders.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { ChapterError } from "../../../../src/components/cpus/semantics/literate/document.js";
import { initialState } from "../../../helpers/68000-state.js";

const file = "src/components/cpus/specifications/68000.md";
const markdown = readFileSync(file, "utf8");
const compile = (text = markdown) => compileCpuChapter(text, { name: "68000" }, file);
const data = ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7"] as const;
const addressRegisters = ["a0", "a1", "a2", "a3", "a4", "a5", "a6"] as const;
type Context = ByteMemory & Pick<Cpu68000AddressContext, "resolveAddress" | "commitAddressUpdates">;
type Body = (state: Cpu68000State, context: Context) => OperandAlignmentFault | "unsupported" | void;
const allMemoryBodies: Readonly<Record<number, (state: Cpu68000State, sm: number, sc: number, dm: number, dc: number,
  context: Context & Pick<Cpu68000AddressContext, "readProgramByte"> & { fetchWord(): number }) => OperandAlignmentFault | "unsupported" | void>> = memoryBodies;
const bodies: Readonly<Record<number, Body>> = { ...registerBodies, ...Object.fromEntries(Object.entries(allMemoryBodies).map(([word, execute]) => {
  const opcode = Number(word);
  return [opcode, (state: Cpu68000State, context: Context) => execute(state, (opcode >>> 3) & 7, opcode & 7, (opcode >>> 6) & 7, (opcode >>> 9) & 7,
    { ...context, fetchWord() { throw Error("Indirect MOVE has no extension words."); }, readProgramByte() { throw Error("Indirect MOVE uses data space."); } })];
})) };
interface Form { readonly opcode: number; readonly kind: "copy" | "load" | "store"; readonly d: number; readonly r: number; readonly name: string }

// Independent operation-word bases; no production pattern or operand catalogue is used.
const forms: Form[] = [];
for (const [kind, base] of [["copy", 0x3000], ["load", 0x3010], ["store", 0x3080]] as const) {
  for (let d = 0; d < 8; d++) for (let r = 0; r < 8; r++) forms.push({ kind, d, r, opcode: base + d * 512 + r,
    name: `MOVE.W ${kind === "load" ? `(A${r})` : `D${r}`},${kind === "store" ? `(A${d})` : `D${d}`}` });
}

test("the 68000 chapter owns its state and 36,029 documented forms and software emulator lines across 54,008 operation words", () => {
  const chapter = compile();
  assert.deepEqual(chapter.state, cpu68000StateDescription);
  const definitions = Object.fromEntries(Object.values(chapter.families).flat());
  assert.equal(Object.keys(definitions).length, 54008);
  // Operand literals do not multiply forms; software emulator lines have no documented forms.
  const counted = new Set(Object.keys(definitions).map(Number).filter(opcode => opcode >>> 12 !== 10 && opcode >>> 12 !== 15).map(opcode => {
    if (opcode >>> 12 === 7) return opcode & 0xff00; // MOVEQ immediate byte.
    if (opcode >>> 12 === 6) return opcode & 0xff ? (opcode & 0xff00) | 1 : opcode; // Byte/word branches.
    if ((opcode & 0xfff0) === 0x4e40) return 0x4e40; // TRAP literal.
    if (opcode >>> 12 === 5 && (opcode & 0xc0) !== 0xc0
      || opcode >>> 12 === 14 && (opcode & 0xc0) !== 0xc0 && !(opcode & 0x20)) return opcode & ~0x0e00;
    return opcode;
  }));
  assert.equal(counted.size, 36029);
  assert.equal(Object.keys(memoryBodies).length, 9150);
  assert.deepEqual(Object.keys(quickBodies).map(Number), chapter.families.moveQuick!.map(([opcode]) => opcode).sort((a, b) => a - b));
  for (const form of forms) {
    const expectedName = form.kind === "copy" ? form.name
      : `MOVE.W ${form.kind === "load" ? "MEMORY" : `D${form.r}`},${form.kind === "store" ? "MEMORY" : `D${form.d}`}`;
    assert.equal(definitions[form.opcode]!.name, expectedName);
    assert.deepEqual(definitions[form.opcode], form.kind === "copy" ? instructions68000[form.opcode] : moves68000[expectedName]);
  }
});

test("MOVEQ opcode entries follow a chapter encoding edit without changing its signed immediate behavior", async () => {
  const changed = markdown.replace('"0111 ddd 0 xxxxxxxx"', '"0111 ddd 1 xxxxxxxx"');
  const { definitions, opcodeAliases } = instructionAliases(compile(changed).families.moveQuick!);
  const alu = new URL("../../../../src/components/cpus/alu.js", import.meta.url).href;
  const javascript = stripTypeScriptTypes(generateInstructions("68000", definitions, { opcodeAliases }))
    .replace('"../alu.ts"', JSON.stringify(alu));
  const compiled: { opcodeInstructions: Readonly<Record<number, (state: Cpu68000State, immediate: number) => void>> } =
    await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
  assert.equal(compiled.opcodeInstructions[0x7080], undefined);
  const execute = compiled.opcodeInstructions[0x7180];
  assert.ok(execute);
  const state = initialState(0);
  execute(state, 0x80);
  assert.equal(state.d0, 0xffffff80);
  assert.equal(state.flags.n, true);
  assert.equal(state.flags.z, false);
});

function reference(form: Form, state: Cpu68000State, context: Context): OperandAlignmentFault | void {
  let result: number;
  if (form.kind === "load") {
    const address = context.resolveAddress(16, 2, form.r);
    if (address % 2) return { operation: "read", address, programSpace: false };
    const high = context.readByte(address), low = context.readByte((address + 1) % 4294967296);
    result = high * 256 + low;
  } else result = state[data[form.r]!] % 65536;
  if (form.kind === "store") {
    const address = context.resolveAddress(16, 2, form.d);
    if (address % 2) return { operation: "write", address };
    context.commitAddressUpdates();
    context.writeByte(address, Math.floor(result / 256));
    context.writeByte((address + 1) % 4294967296, result % 256);
  } else {
    if (form.kind === "load") context.commitAddressUpdates();
    const register = data[form.d]!;
    state[register] = Math.floor(state[register] / 65536) * 65536 + result;
  }
  state.flags.n = result >= 32768; state.flags.z = result === 0;
  state.flags.v = false; state.flags.c = false;
}

function observe(form: Form, word: number, address: number, mutate: boolean, failAt: number, generated: boolean) {
  const state = initialState((form.opcode + word) % 128), events: unknown[][] = [], writes: number[][] = [];
  for (const register of data) state[register] = 0x89ab0000 + word;
  const failure = Error("injected word-transfer effect failure");
  const effect = (...event: unknown[]) => { events.push(event); if (events.length - 1 === failAt) throw failure; };
  const observed = new Proxy(state, {
    get(target, key, receiver) {
      if (key === "flags") return new Proxy(target.flags, {
        get(target, key, receiver) { const contents = Reflect.get(target, key, receiver); effect("read flag", key, contents); return contents; },
        set(target, key, contents) { effect("write flag", key, contents); return Reflect.set(target, key, contents); },
      });
      const contents = Reflect.get(target, key, receiver); effect("read", key, contents); return contents;
    },
    set(target, key, contents) { effect("write", key, contents); return Reflect.set(target, key, contents); },
  });
  const liveChange = () => { if (mutate) for (const register of data) state[register] = (state[register] ^ 0xfedcffff) >>> 0; };
  const context: Context = {
    resolveAddress(size, mode, code) { effect("resolve", size, mode, code); liveChange(); return address; },
    commitAddressUpdates() { effect("commit"); liveChange(); },
    readByte(location) { effect("read memory", location); liveChange(); return location === address ? Math.floor(word / 256) : word % 256; },
    writeByte(location, contents) { effect("write memory", location, contents); writes.push([location, contents]); liveChange(); },
  };
  let outcome: OperandAlignmentFault | "unsupported" | void = undefined, failed = false;
  try { outcome = generated ? bodies[form.opcode]!(observed, context) : reference(form, observed, context); }
  catch (error) { assert.equal(error, failure); failed = true; }
  return { state, events, writes, outcome, failed };
}

test("literate words match independent effects, live upper bits, alignment faults, and every failure boundary", () => {
  for (const form of forms) for (const word of [0, 1, 0x7fff, 0x8000, 0xffff]) {
    for (const address of [0x01002000, 0xfffffffe, 0x101]) for (const mutate of [false, true]) {
      const expected = observe(form, word, address, mutate, -1, false);
      assert.deepEqual(observe(form, word, address, mutate, -1, true), expected, form.name);
      if (word === 0x8000) for (let failAt = 0; failAt < expected.events.length; failAt++) {
        assert.deepEqual(observe(form, word, address, mutate, failAt, true), observe(form, word, address, mutate, failAt, false),
          `${form.name}, failure ${failAt}`);
      }
    }
  }
});

test("all 192 literate encodings execute through the CPU, including both A7 banks and physical projection", () => {
  for (const form of forms) for (const supervisor of [false, true]) {
    const state = initialState(supervisor ? 95 : 31), bytes = new Map<number, number>([[0x1000, form.opcode >>> 8], [0x1001, form.opcode % 256], [0x2000, 0x80], [0x2001, 0x01]]);
    const code = form.kind === "store" ? form.d : form.r;
    const pointer = code === 7 ? supervisor ? "ssp" : "usp" : addressRegisters[code]!;
    state[pointer] = 0xab002000;
    const cpu = new Cpu68000({ size: 0x1000000, read: address => bytes.get(address) ?? 0,
      write(address, value) { bytes.set(address, value); } }, state);
    const record = cpu.step(), expected = { ...structuredClone(state), a7: supervisor ? state.ssp : state.usp, physicalPc: state.pc % 0x1000000 };
    const word = form.kind === "load" ? 0x8001 : state[data[form.r]!] % 65536;
    if (form.kind !== "store") expected[data[form.d]!] = Math.floor(expected[data[form.d]!] / 65536) * 65536 + word;
    Object.assign(expected.flags, { n: word >= 0x8000, z: word === 0, v: false, c: false });
    expected.pc += 2; expected.physicalPc += 2; expected.ir = form.opcode;
    assert.equal(record.exception, undefined); assert.equal(record.outcome, "executed");
    assert.deepEqual(record.after, expected, form.name);
    assert.deepEqual(record.accesses.slice(2), form.kind === "copy" ? [] : [
      { kind: form.kind === "store" ? "write" : "read", address: 0x2000, value: Math.floor(word / 256) },
      { kind: form.kind === "store" ? "write" : "read", address: 0x2001, value: word % 256 },
    ], form.name);
  }
});

const invalid: readonly [string, string, string, RegExp][] = [
  ["unknown captured value", "truncate(originalSource, 16)", "truncate(missing, 16)", /not been captured/],
  ["non-narrowing truncation", "truncate(originalSource, 16)", "truncate(originalSource, 32)", /truncation must narrow/],
  ["mixed widths", "u32($FFFF0000)", "u16($FFFF)", /equal widths/],
  ["wide byte extraction", "truncate(contents, 8)", "highByte(extend(contents, 32))", /requires a word/],
  ["short program address", "program memory(address)", "program memory(truncate(address, 16))", /32-bit/],
  ["program-space alignment write", "alignment program read(sourceAddress)", "alignment program write(sourceAddress)", /access space/],
  ["wide mode selector", "resolve(16, destinationMode,", "resolve(16, extend(destinationMode, 8),", /3-bit/],
  ["unsupported operand width", "resolve(16,", "resolve(14,", /Operand size/],
  ["short logical address", "read(sourceAddress) if", "read(truncate(sourceAddress, 16)) if", /32-bit/],
  ["unknown alignment operation", "alignment read(sourceAddress)", "alignment execute(sourceAddress)", /read, write, or fetch/],
  ["unknown predicate", "if lowBit(sourceAddress)", "if odd(sourceAddress)", /Unknown flag operation/],
  ["misspelled commit", "commit addresses", "commit registers", /Expected "addresses"/],
  ["spelled-out flag literal", "V = 0", "V = false", /flag literals as 0 or 1/],
  ["duplicate code", '001 "A1"', '000 "A1"', /consecutive binary/],
  ["missing code", '  111 "A7"\n', "", /every value/],
  ["write to encoded value", "destinationCode = operand d", "operand d <- result", /value-only/],
];
for (const [name, before, after, message] of invalid) test(`68000 chapter rejects ${name} at its document location`, () => {
  assert.ok(markdown.includes(before)); const changed = markdown.replace(before, after);
  const expectedLine = markdown.slice(0, markdown.indexOf(before)).split("\n").length;
  assert.throws(() => compile(changed), (error: unknown) => {
    assert.ok(error instanceof ChapterError); assert.equal(error.file, file); assert.match(error.message, message);
    if (name !== "missing code") assert.equal(error.line, expectedLine);
    return true;
  });
});

test("formal edits to byte order and flag constants change the generated word store", async () => {
  const changed = markdown.replace("memory(address) <- truncate(shiftBits(contents, right, 8), 8)", "memory(address) <- truncate(contents, 8)")
    .replace("memory(add(address, u32(1))) <- truncate(contents, 8)", "memory(add(address, u32(1))) <- truncate(shiftBits(contents, right, 8), 8)")
    .replaceAll("C = 0", "C = 1");
  const definition = compile(changed).families.operandMove16DataMemory![0]![1];
  const alu = new URL("../../../../src/components/cpus/alu.js", import.meta.url).href;
  const javascript = stripTypeScriptTypes(generateInstructions("68000", { probe: definition })).replace('"../alu.ts"', JSON.stringify(alu));
  const compiled: { instructions: { probe: typeof allMemoryBodies[number] } } = await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
  const state = initialState(0), writes: number[][] = [];
  compiled.instructions.probe(state, 0, 0, 2, 0, { resolveAddress: () => 0x1000, commitAddressUpdates() {},
    fetchWord() { throw Error("No extension expected."); }, readProgramByte() { throw Error("No program read expected."); },
    readByte() { throw new Error("A store cannot read destination memory."); }, writeByte(address, byte) { writes.push([address, byte]); } });
  assert.deepEqual(writes, [[0x1000, 0x44], [0x1001, 0x33]]);
  assert.equal(state.flags.c, true);
});

test("chapter status views preserve reserved bits, every flag/mask combination, and in-place restoration", async () => {
  const { sourceReaders, instructions } = await import("../../../../src/components/cpus/generated/68000-state.js");
  for (let bits = 0; bits < 128; bits++) for (let mask = 0; mask < 8; mask++) {
    const state = initialState(bits); state.interruptMask = mask;
    const flags = state.flags, readers = sourceReaders(state).views;
    const ccr = Number(flags.x) * 16 + Number(flags.n) * 8 + Number(flags.z) * 4 + Number(flags.v) * 2 + Number(flags.c);
    assert.equal(readers.CCR(), ccr);
    assert.equal(readers.SR(), Number(flags.t) * 32768 + Number(flags.s) * 8192 + mask * 256 + ccr);
    assert.equal(readers.A7(), flags.s ? state.ssp : state.usp);
    assert.equal(readers.PHYSICALPC(), state.pc % 16777216);
  }
  for (let status = 0; status < 65536; status++) {
    const state = initialState(127), flags = state.flags;
    state.interruptMask = 5;
    instructions.writeCCR(state, status);
    assert.equal(state.flags, flags);
    assert.deepEqual(flags, { x: Boolean(status & 16), n: Boolean(status & 8), z: Boolean(status & 4), v: Boolean(status & 2), c: Boolean(status & 1), t: true, s: true });
    assert.equal(state.interruptMask, 5);
    instructions.writeSR(state, status);
    assert.equal(state.flags, flags);
    assert.equal(sourceReaders(state).views.SR(), status & 0xa71f);
  }
});

test("formal edits change bank selection, register execution, and status views without native definitions", async () => {
  const changed = markdown.replace('return select(supervisor, u8(1), u8(0))', 'return select(supervisor, u8(0), u8(1))')
    .replaceAll('C = 0', 'C = 1').replace('u16($8000)', 'u16($4000)');
  const chapter = compile(changed), definitions = Object.fromEntries(Object.values(chapter.families).flat());
  const source = generateInstructions("68000", { move: definitions[0x300f]!, exchange: definitions[0xcf4f]! }, {
    sources: { cpu: { name: "68000", state: chapter.state! }, groups: { views: chapter.views } },
  });
  const alu = new URL("../../../../src/components/cpus/alu.js", import.meta.url).href;
  const javascript = stripTypeScriptTypes(source).replace('"../alu.ts"', JSON.stringify(alu));
  const compiled: { instructions: { move(state: Cpu68000State): void; exchange(state: Cpu68000State): void }; sourceReaders(state: Cpu68000State): { views: { A7(): number; SR(): number } } } =
    await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
  const state = initialState(127); state.ssp = 0x8001; state.usp = 0x1234;
  compiled.instructions.move(state);
  assert.equal(state.d0 % 65536, 0x1234); assert.equal(state.flags.c, true);
  assert.equal(compiled.sourceReaders(state).views.A7(), state.usp);
  assert.equal(compiled.sourceReaders(state).views.SR() & 0xc000, 0x4000);
  const before = structuredClone(state); compiled.instructions.exchange(state); assert.deepEqual(state, before);
});
