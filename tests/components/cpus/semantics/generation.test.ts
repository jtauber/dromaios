import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { instructions as mos, opcodeEntries } from "../../../../src/components/cpus/generated/6502.js";
import { instructions as intel } from "../../../../src/components/cpus/generated/8080.js";
import { instructions as motorola } from "../../../../src/components/cpus/generated/6809.js";
import { instructions as motorola6800 } from "../../../../src/components/cpus/generated/6800.js";
import { instructionModules, instructions6502, instructions6809 } from "../../../../src/components/cpus/semantics/definitions.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { compileCpuChapter } from "../../../../src/components/cpus/semantics/literate/compile.js";
import { generateChapterExecution } from "../../../../src/components/cpus/semantics/literate/execution.js";
import { generateChapterInterface } from "../../../../src/components/cpus/semantics/literate/interface.js";
import { instructionBodies, instructionSet } from "../../../../src/components/cpus/semantics/builders.js";
import { cpuSymbols, addWrap, capture, highByte, lowByte, literal, readRegister, value, writeLatch, writeRegister, zero } from "../../../../src/components/cpus/semantics/model.js";
import { cpu6502StateDescription } from "../../../../src/components/cpus/state/6502.js";
import type { Cpu6502State } from "../../../../src/components/cpus/state/6502.js";
import type { Cpu8080State } from "../../../../src/components/cpus/semantics/generated/state/8080.js";
import type { Cpu6809State } from "../../../../src/components/cpus/state/6809.js";
import type { Cpu6800State } from "../../../../src/components/cpus/state/6800.js";

function mosState(): Cpu6502State {
  return { a: 0, x: 0, y: 0, sp: 0xff, pc: 0x1000, flags: { n: false, z: false, c: true, v: true, d: true, i: true } };
}
function intelState(): Cpu8080State {
  return { a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, pc: 0x1000, sp: 0xffff,
    flags: { s: false, z: false, p: false, cy: true, ac: true },
    interruptEnabled: true, interruptDeferred: true, halted: false };
}
function motorolaState(): Cpu6809State {
  return { a: 0, b: 0, dp: 0, x: 0, y: 0, s: 0xffff, u: 0, pc: 0x1000, waitMode: "none", nmiArmed: true,
    flags: { e: true, f: true, h: true, i: true, n: false, z: false, v: true, c: true } };
}

test("shared body keys build only their first form and retain encounter order, including object-property names", () => {
  const first = instructions6502[0xea]!, later = instructions6502[0x18]!;
  const forms = [
    { body: "second", definition: first }, { body: "first", definition: later },
    { body: "second", definition: later }, { body: "__proto__", definition: first },
  ];
  const built: typeof forms = [];
  const bodies = instructionBodies(forms, form => { built.push(form); return form.definition; });
  assert.deepEqual(built, [forms[0], forms[1], forms[3]]);
  assert.deepEqual(Object.keys(bodies), ["second", "first", "__proto__"]);
  assert.equal(bodies.second, first);
  assert.equal(bodies.__proto__, first);
  assert.ok(Object.isFrozen(bodies));
});

test("the catalogue and chapter bindings name exactly the generated modules, each reproducible without changing its inputs", () => {
  const directory = "src/components/cpus/generated";
  const filenames = [...instructionModules.map(({ name }) => `${name}.ts`), "8008-execution.ts", "8008-cpu.ts", "8080-execution.ts", "8080-cpu.ts"];
  assert.equal(new Set(filenames).size, filenames.length, "module names must not overwrite one another");
  assert.deepEqual(readdirSync(directory).sort(), filenames.sort());
  for (const module of instructionModules) {
    const { name, cpu, definitions, options } = module;
    const before = JSON.stringify(module);
    const source = generateInstructions(cpu, definitions, options);
    assert.equal(source, readFileSync(`${directory}/${name}.ts`, "utf8"), name);
    assert.equal(generateInstructions(cpu, definitions, options), source, `${name}: repeat generation`);
    assert.equal(JSON.stringify(module), before, `${name}: unchanged inputs`);
  }
  for (const cpu of ["8008", "8080"] as const) {
    const chapter = compileCpuChapter(readFileSync(`src/components/cpus/specifications/${cpu}.md`, "utf8"), { name: cpu });
    const before = JSON.stringify(chapter);
    const source = generateChapterExecution(cpu, cpu, chapter.execution!);
    assert.equal(source, readFileSync(`${directory}/${cpu}-execution.ts`, "utf8"));
    assert.equal(generateChapterExecution(cpu, cpu, chapter.execution!), source);
    if (chapter.interface) {
      const publicSource = generateChapterInterface(cpu, chapter.state!, chapter.interface);
      assert.equal(publicSource, readFileSync(`${directory}/${cpu}-cpu.ts`, "utf8"));
      assert.equal(generateChapterInterface(cpu, chapter.state!, chapter.interface), publicSource);
    }
    assert.equal(JSON.stringify(chapter), before);
  }
});

test("generation rejects definitions from a different CPU", () => {
  assert.throws(() => generateInstructions("8080", instructions6502), /expected a 8080 definition/);
});

test("6502 families generate exactly the migrated encodings, including opposite-index transfers and omitted store modes", () => {
  // Explicit opcode expectations are independent of the authored bit-pattern expansion.
  const expected = {
    0x00: "BRK", 0x40: "RTI", 0x08: "PHP", 0x28: "PLP", 0xea: "NOP",
    0x18: "CLC", 0x38: "SEC", 0x58: "CLI", 0x78: "SEI", 0xb8: "CLV", 0xd8: "CLD", 0xf8: "SED",
    0x61: "ADC (zero page,X)", 0x65: "ADC zero page", 0x69: "ADC #byte", 0x6d: "ADC absolute",
    0x71: "ADC (zero page),Y", 0x75: "ADC zero page,X", 0x79: "ADC absolute,Y", 0x7d: "ADC absolute,X",
    0xe1: "SBC (zero page,X)", 0xe5: "SBC zero page", 0xe9: "SBC #byte", 0xed: "SBC absolute",
    0xf1: "SBC (zero page),Y", 0xf5: "SBC zero page,X", 0xf9: "SBC absolute,Y", 0xfd: "SBC absolute,X",
    0x20: "JSR", 0x60: "RTS", 0x48: "PHA", 0x68: "PLA",
    0x10: "BPL", 0x30: "BMI", 0x50: "BVC", 0x70: "BVS",
    0x90: "BCC", 0xb0: "BCS", 0xd0: "BNE", 0xf0: "BEQ",
    0x4c: "JMP absolute", 0x6c: "JMP indirect",
    0x01: "ORA (zero page,X)", 0x05: "ORA zero page", 0x09: "ORA #byte", 0x0d: "ORA absolute",
    0x11: "ORA (zero page),Y", 0x15: "ORA zero page,X", 0x19: "ORA absolute,Y", 0x1d: "ORA absolute,X",
    0x21: "AND (zero page,X)", 0x25: "AND zero page", 0x29: "AND #byte", 0x2d: "AND absolute",
    0x31: "AND (zero page),Y", 0x35: "AND zero page,X", 0x39: "AND absolute,Y", 0x3d: "AND absolute,X",
    0x41: "EOR (zero page,X)", 0x45: "EOR zero page", 0x49: "EOR #byte", 0x4d: "EOR absolute",
    0x51: "EOR (zero page),Y", 0x55: "EOR zero page,X", 0x59: "EOR absolute,Y", 0x5d: "EOR absolute,X",
    0x24: "BIT zero page", 0x2c: "BIT absolute",
    0x8a: "TXA", 0x98: "TYA", 0x9a: "TXS", 0xa8: "TAY", 0xaa: "TAX", 0xba: "TSX",
    0x0a: "ASL A", 0x06: "ASL zero page", 0x0e: "ASL absolute", 0x16: "ASL zero page,X", 0x1e: "ASL absolute,X",
    0x2a: "ROL A", 0x26: "ROL zero page", 0x2e: "ROL absolute", 0x36: "ROL zero page,X", 0x3e: "ROL absolute,X",
    0x4a: "LSR A", 0x46: "LSR zero page", 0x4e: "LSR absolute", 0x56: "LSR zero page,X", 0x5e: "LSR absolute,X",
    0x6a: "ROR A", 0x66: "ROR zero page", 0x6e: "ROR absolute", 0x76: "ROR zero page,X", 0x7e: "ROR absolute,X",
    0xc6: "DEC zero page", 0xce: "DEC absolute", 0xd6: "DEC zero page,X", 0xde: "DEC absolute,X",
    0xe6: "INC zero page", 0xee: "INC absolute", 0xf6: "INC zero page,X", 0xfe: "INC absolute,X",
    0x88: "DEY", 0xc8: "INY", 0xca: "DEX", 0xe8: "INX",
    0xa1: "LDA (zero page,X)", 0xa5: "LDA zero page", 0xa9: "LDA #byte", 0xad: "LDA absolute",
    0xb1: "LDA (zero page),Y", 0xb5: "LDA zero page,X", 0xb9: "LDA absolute,Y", 0xbd: "LDA absolute,X",
    0xa2: "LDX #byte", 0xa6: "LDX zero page", 0xae: "LDX absolute", 0xb6: "LDX zero page,Y", 0xbe: "LDX absolute,Y",
    0xa0: "LDY #byte", 0xa4: "LDY zero page", 0xac: "LDY absolute", 0xb4: "LDY zero page,X", 0xbc: "LDY absolute,X",
    0x81: "STA (zero page,X)", 0x85: "STA zero page", 0x8d: "STA absolute", 0x91: "STA (zero page),Y",
    0x95: "STA zero page,X", 0x99: "STA absolute,Y", 0x9d: "STA absolute,X",
    0x86: "STX zero page", 0x8e: "STX absolute", 0x96: "STX zero page,Y",
    0x84: "STY zero page", 0x8c: "STY absolute", 0x94: "STY zero page,X",
    0xc1: "CMP (zero page,X)", 0xc5: "CMP zero page", 0xc9: "CMP #byte", 0xcd: "CMP absolute",
    0xd1: "CMP (zero page),Y", 0xd5: "CMP zero page,X", 0xd9: "CMP absolute,Y", 0xdd: "CMP absolute,X",
    0xe0: "CPX #byte", 0xe4: "CPX zero page", 0xec: "CPX absolute",
    0xc0: "CPY #byte", 0xc4: "CPY zero page", 0xcc: "CPY absolute",
  };
  assert.deepEqual(Object.fromEntries(Object.entries(instructions6502).map(([opcode, definition]) => [opcode, definition.name])), expected);
  assert.deepEqual(opcodeEntries(mosState()).map(([opcode]) => opcode), Object.keys(expected).map(Number));
});

test("generated 6502 stores capture the source only after addressing, write once, and never touch flags even on failure", () => {
  type Access = readonly [kind: "fetch", byte: number] | readonly [kind: "read", address: number, byte: number];
  const cases: readonly [opcode: keyof typeof mos, register: "a" | "x" | "y", address: number, accesses: readonly Access[]][] = [
    [0x81, "a", 0xffff, [["fetch", 0xfe], ["read", 0, 0xff], ["read", 1, 0xff]]],
    [0x85, "a", 0xff, [["fetch", 0xff]]],
    [0x8d, "a", 0xffff, [["fetch", 0xff], ["fetch", 0xff]]],
    [0x91, "a", 2, [["fetch", 0xff], ["read", 0xff, 0xff], ["read", 0, 0xff]]],
    [0x95, "a", 1, [["fetch", 0xff]]],
    [0x99, "a", 2, [["fetch", 0xff], ["fetch", 0xff]]],
    [0x9d, "a", 1, [["fetch", 0xff], ["fetch", 0xff]]],
    [0x86, "x", 0xff, [["fetch", 0xff]]],
    [0x8e, "x", 0xffff, [["fetch", 0xff], ["fetch", 0xff]]],
    [0x96, "x", 2, [["fetch", 0xff]]],
    [0x84, "y", 0xff, [["fetch", 0xff]]],
    [0x8c, "y", 0xffff, [["fetch", 0xff], ["fetch", 0xff]]],
    [0x94, "y", 1, [["fetch", 0xff]]],
  ];
  for (const [opcode, register, target, accesses] of cases) for (let failAt = -1; failAt <= accesses.length; failAt++) {
    const state = { ...mosState(), x: 2, y: 3 }, flags = { ...state.flags }, events: string[] = [], failure = new Error("store access failed");
    let reads = 0, writes = 0;
    const observed = new Proxy(state, {
      get(object, key, receiver) {
        if (key === "flags") assert.fail("Stores must not read or replace flags");
        if (key === register) events.push("source");
        return Reflect.get(object, key, receiver);
      },
      set() { assert.fail("Stores must not change CPU state"); },
    });
    const read = (kind: "fetch" | "read", address?: number): number => {
      const expected = accesses[reads];
      assert.ok(expected, "unexpected operand or destination read");
      assert.equal(expected[0], kind);
      if (expected[0] === "read") assert.equal(address, expected[1]);
      events.push(kind);
      if (reads === failAt) throw failure;
      state[register] = 0x40 + ++reads; // A premature source capture would write a stale value.
      return expected[0] === "fetch" ? expected[1] : expected[2];
    };
    const run = () => mos[opcode](observed, {
      fetchByte: () => read("fetch"), readByte: address => read("read", address),
      writeByte(address, byte) {
        assert.equal(address, target); assert.equal(byte, 0x40 + accesses.length);
        events.push("write");
        if (failAt === accesses.length) throw failure;
        writes++;
      },
    });
    if (failAt < 0) run();
    else assert.throws(run, error => error === failure);
    assert.deepEqual(events, [
      ...accesses.slice(0, failAt < 0 ? accesses.length : failAt + 1).map(([kind]) => kind),
      ...(failAt < 0 || failAt === accesses.length ? ["source", "write"] : []),
    ]);
    assert.equal(writes, failAt < 0 ? 1 : 0);
    assert.deepEqual(state.flags, flags);
  }
});

test("opcode inventories reject collisions and invalid encodings before generation", () => {
  const definition = instructions6502[0xaa]!;
  assert.throws(() => instructionSet([[0xaa, definition], [0xaa, definition]]), /Duplicate opcode/);
  for (const opcode of [-1, 256, 1.5, NaN]) {
    assert.throws(() => instructionSet([[opcode, definition]]), /opcode/);
    assert.throws(() => generateInstructions("6502", { [opcode]: definition }, { bindOpcodes: true }), /opcode/);
  }
  assert.throws(() => generateInstructions("6502", { tax: definition }, { bindOpcodes: true }), /opcode/);
  assert.throws(() => generateInstructions("6502", { "170": definition, "0xAA": definition }, { bindOpcodes: true }), /Duplicate opcode/);
  assert.throws(() => generateInstructions("6502", { "170": { ...definition, inputs: { address: 16 } } }, { bindOpcodes: true }), /cannot supply instruction inputs/);
});

test("generated numeric inputs preserve declaration order, widths, and names independently of host identifiers", async () => {
  const cpu = cpuSymbols("6502", cpu6502StateDescription);
  const definition = { cpu: cpu.declaration, name: "inputs", explanation: "Captured numeric inputs.",
    inputs: { instruction: 16, state: 8, class: 8 }, steps: [
      { kind: "write-register", register: cpu.register("pc"), value: value("instruction") },
      { kind: "read-source", name: "local", source: { name: "shadow", width: 8,
        steps: [{ kind: "capture", name: "state", value: literal(8, 0) }], result: value("state") } },
      { kind: "write-register", register: cpu.register("a"), value: value("state") },
      { kind: "write-memory", address: addWrap(value("instruction"), literal(16, 1)), value: value("class") },
      { kind: "write-register", register: cpu.register("x"), value: value("local") },
    ],
  } as const;
  const source = generateInstructions("6502", { probe: definition });
  const alu = new URL("../../../../src/components/cpus/alu.js", import.meta.url).href;
  const javascript = stripTypeScriptTypes(source).replace('"../alu.ts"', JSON.stringify(alu));
  const compiled: { instructions: { probe(state: Cpu6502State, address: number, a: number, byte: number,
    instruction: { writeByte(address: number, byte: number): void }): void } } =
    await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
  const state = mosState(), writes: number[][] = [];
  compiled.instructions.probe(state, 0xffff, 0x80, 0x42, { writeByte: (address, byte) => { writes.push([address, byte]); } });
  assert.deepEqual(writes, [[0, 0x42]]);
  assert.equal(state.pc, 0xffff); assert.equal(state.a, 0x80); assert.equal(state.x, 0);
});

test("selected opcode bindings coexist with unbound helpers and reject missing, repeated, or input-bearing entries", async () => {
  const definition = instructions6502[0xaa]!;
  const helper = { ...definition, inputs: { address: 16 as const } };
  const definitions = { 170: definition, helper };
  const source = generateInstructions("6502", definitions, { bindOpcodes: [170] });
  const compiled: { opcodeEntries(state: Cpu6502State): readonly (readonly [number, () => void])[] } =
    await import(`data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(source))}`);
  const state = mosState(); state.a = 0x80;
  const entries = compiled.opcodeEntries(state);
  assert.deepEqual(entries.map(([opcode]) => opcode), [170]);
  entries[0]![1](); assert.equal(state.x, 0x80);
  assert.throws(() => generateInstructions("6502", definitions, { bindOpcodes: [171] }), /no instruction definition/);
  assert.throws(() => generateInstructions("6502", definitions, { bindOpcodes: [170, 170] }), /Duplicate opcode/);
  assert.throws(() => generateInstructions("6502", { 170: helper }, { bindOpcodes: [170] }), /cannot supply instruction inputs/);
});

test("generated opcode bindings capture their own CPU instance and read live state only on execution", () => {
  const first = mosState(), second = mosState();
  let a = 0x12, reads = 0;
  Object.defineProperty(first, "a", { get() { reads++; return a; } });
  const firstHandlers = Object.fromEntries(opcodeEntries(first)), secondHandlers = Object.fromEntries(opcodeEntries(second));
  assert.equal(reads, 0);
  a = 0x80;
  const unusedContext = { fetchByte: () => assert.fail("unexpected fetch"), readByte: () => assert.fail("unexpected read"), writeByte: () => assert.fail("unexpected write") };
  firstHandlers[0xaa]!(unusedContext);
  assert.equal(reads, 1);
  assert.equal(first.x, 0x80); assert.equal(first.flags.n, true);
  assert.equal(second.x, 0); assert.equal(second.flags.n, false);
  second.a = 0x44;
  secondHandlers[0xaa]!(unusedContext);
  assert.equal(second.x, 0x44); assert.equal(first.x, 0x80);
});

test("generated byte extraction handles every word and composes with wrapped arithmetic", async () => {
  const cpu = cpuSymbols("6502", cpu6502StateDescription);
  const source = generateInstructions("6502", { probe: { cpu: cpu.declaration, name: "probe", explanation: "High-byte extraction probe.", steps: [
    readRegister("word", cpu.register("pc")), capture("high", highByte(value("word"))),
    writeRegister(cpu.register("a"), value("high")),
    writeRegister(cpu.register("x"), highByte(addWrap(value("word"), literal(16, 1)))),
    writeRegister(cpu.register("y"), lowByte(value("word"))),
    writeRegister(cpu.register("sp"), lowByte(addWrap(value("word"), literal(16, 1)))),
  ] } });
  const alu = new URL("../../../../src/components/cpus/alu.js", import.meta.url).href;
  const javascript = stripTypeScriptTypes(source).replace('"../alu.ts"', JSON.stringify(alu));
  const compiled: { instructions: { probe(state: Cpu6502State): void } } = await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
  const state = mosState(), flags = { ...state.flags };
  for (let word = 0; word < 65536; word++) {
    state.pc = word;
    compiled.instructions.probe(state);
    assert.equal(state.a, Math.floor(word / 256));
    assert.equal(state.x, Math.floor(((word + 1) % 65536) / 256));
    assert.equal(state.y, word % 256);
    assert.equal(state.sp, (word + 1) % 256);
    assert.equal(state.pc, word);
    assert.deepEqual(state.flags, flags);
  }
});

test("6800 comparison bodies read complete operands before registers, never write them, and preserve flags on read failure", () => {
  for (const [name, register] of [["cmpa", "a"], ["cmpb", "b"], ["cpx", "x"]] as const) {
    for (const mode of ["Immediate", "Memory"] as const) for (const carry of [false, true]) {
      const bytes = register === "x" ? [0x12, 0x34] : [0x80];
      for (let failAt = -1; failAt < bytes.length; failAt++) {
        const flags = { h: true, i: true, n: true, z: false, v: true, c: carry };
        const state: Cpu6800State = { a: 0, b: 0, x: 0, sp: 0, pc: 0, waiting: false, flags: { ...flags } };
        const events: string[] = [], failure = new Error("operand read failed");
        const observed = new Proxy(state, {
          get(target, key, receiver) {
            if (["a", "b", "x"].includes(String(key))) events.push(`register ${String(key)}`);
            return Reflect.get(target, key, receiver);
          },
          set() { assert.fail("A comparison must not write registers"); },
        });
        let reads = 0;
        const read = () => {
          events.push(`operand ${reads}`);
          if (reads === failAt) throw failure;
          const byte = bytes[reads++]!;
          state[register] = register === "x" ? (reads === 2 ? 0x1234 : 0xffff) : 0x80;
          return byte;
        };
        const execute = () => mode === "Immediate" ? motorola6800[`${name}Immediate`](observed, { fetchByte: read })
          : motorola6800[`${name}Memory`](observed, 0xffff, { readByte(address) { assert.equal(address, reads === 0 ? 0xffff : 0); return read(); } });
        if (failAt >= 0) assert.throws(execute, error => error === failure);
        else execute();
        assert.deepEqual(events, [
          ...bytes.slice(0, failAt < 0 ? bytes.length : failAt + 1).map((_, i) => `operand ${i}`),
          ...(failAt < 0 ? [`register ${register}`] : []),
        ]);
        assert.deepEqual(state.flags, failAt >= 0 ? flags : { ...flags, n: false, z: true, v: false, c: register === "x" && carry });
      }
    }
  }
  const state: Cpu6800State = { a: 0x80, b: 1, x: 0, sp: 0, pc: 0, waiting: false,
    flags: { h: true, i: true, n: true, z: true, v: false, c: true } };
  motorola6800.cba(new Proxy(state, { set() { assert.fail("CBA must not write registers"); } }));
  assert.deepEqual(state.flags, { h: true, i: true, n: false, z: false, v: true, c: false });
});

test("generated byte comparisons match independent arithmetic for every operand pair", () => {
  const m = mosState(), i = intelState(), b = motorolaState();
  const signed = (value: number): number => value < 128 ? value : value - 256;
  for (let left = 0; left < 256; left++) for (let right = 0; right < 256; right++) {
    m.a = i.a = b.a = left;
    const context = { fetchByte: () => right };
    mos[0xc9](m, context); intel[0xfe](i, context); motorola.cmpaImmediate(b, context);
    const result = (left - right + 256) % 256;
    const signedResult = signed(left) - signed(right);
    assert.deepEqual(m.flags, { n: result >= 128, z: result === 0, c: left >= right, v: true, d: true, i: true });
    assert.deepEqual(i.flags, { s: result >= 128, z: result === 0, cy: left < right,
      ac: left % 16 >= right % 16, p: [...result.toString(2)].filter(bit => bit === "1").length % 2 === 0 });
    assert.deepEqual(b.flags, { e: true, f: true, h: true, i: true, n: result >= 128, z: result === 0,
      v: signedResult < -128 || signedResult > 127, c: left < right });
    assert.equal(m.a, left); assert.equal(i.a, left); assert.equal(b.a, left);
  }
});

test("generated word comparison uses bit 15 for sign and word overflow while preserving the destination", () => {
  const state = motorolaState();
  const signed = (value: number): number => value < 32768 ? value : value - 65536;
  for (const left of [0, 1, 0x7fff, 0x8000, 0xffff]) for (const right of [0, 1, 0x7fff, 0x8000, 0xffff]) {
    state.x = left;
    const bytes = [Math.floor(right / 256), right % 256];
    motorola.cmpxImmediate(state, { fetchByte: () => bytes.shift()! });
    const result = (left - right + 65536) % 65536, difference = signed(left) - signed(right);
    assert.deepEqual(state.flags, { e: true, f: true, h: true, i: true, n: result >= 32768, z: result === 0,
      v: difference < -32768 || difference > 32767, c: left < right });
    assert.equal(state.x, left);
    assert.deepEqual(bytes, []);
  }
});

test("generated comparison never writes its destination, and captures it after source effects", () => {
  const state = intelState();
  Object.defineProperty(state, "a", { get: () => 0x20, set: () => assert.fail("CMP must not write A") });
  intel[0xfe](state, { fetchByte: () => 0x20 });
  assert.equal(state.flags.z, true);
  const changed = mosState();
  mos[0xcd](changed, { fetchByte: () => 0, readByte: () => { changed.a = 0x44; return 0x44; } });
  assert.equal(changed.flags.z, true);
});

test("generated transfers capture their source and differ only in the declared flag effects", () => {
  const m = mosState(), i = intelState();
  m.a = i.a = 0x80;
  mos[0xaa](m); intel[0x47](i);
  assert.equal(m.x, 0x80); assert.equal(i.b, 0x80);
  assert.deepEqual(m.flags, { n: true, z: false, c: true, v: true, d: true, i: true });
  assert.deepEqual(i.flags, intelState().flags);
});

test("generated 6809 comparisons capture every register or D view after all operand reads and stop at each failure", () => {
  for (const register of ["a", "b", "d", "x", "y", "u", "s"] as const) for (const mode of ["Immediate", "Memory"] as const) {
    const word = register !== "a" && register !== "b", bytes = word ? [0x12, 0x34] : [0x80];
    for (let failAt = -1; failAt < bytes.length; failAt++) {
      const state = motorolaState(), flags = { ...state.flags }, events: string[] = [], failure = new Error("read failed");
      let reads = 0;
      const observed = new Proxy(state, {
        get(target, key, receiver) {
          if (["a", "b", "x", "y", "u", "s"].includes(String(key))) events.push(`register ${String(key)}`);
          return Reflect.get(target, key, receiver);
        },
        set() { assert.fail("A comparison must not write any register"); },
      });
      const read = () => {
        events.push(`operand ${reads}`);
        if (reads === failAt) throw failure;
        const byte = bytes[reads++]!;
        // Source effects replace the compared value: capturing it before the final read gives the wrong answer.
        if (register === "d") { state.a = 0x12; state.b = reads === 2 ? 0x34 : 0xff; }
        else state[register] = word ? (reads === 2 ? 0x1234 : 0xffff) : 0x80;
        return byte;
      };
      const execute = () => mode === "Immediate" ? motorola[`cmp${register}Immediate`](observed, { fetchByte: read })
        : motorola[`cmp${register}Memory`](observed, 0xffff, { readByte(address) {
          assert.equal(address, reads === 0 ? 0xffff : 0); return read();
        } });
      if (failAt >= 0) assert.throws(execute, error => error === failure);
      else execute();
      assert.deepEqual(events, [
        ...bytes.slice(0, failAt < 0 ? bytes.length : failAt + 1).map((_, i) => `operand ${i}`),
        ...(failAt < 0 ? (register === "d" ? ["register a", "register b"] : [`register ${register}`]) : []),
      ]);
      assert.deepEqual(state.flags, failAt >= 0 ? flags : { ...flags, n: false, z: true, v: false, c: false });
    }
  }
});

test("generated source scopes and policy parameters are hygienic, even for host names and keywords", async () => {
  const cpu = cpuSymbols("6502", cpu6502StateDescription);
  const definition = { cpu: cpu.declaration, name: "scope probe", explanation: "Compiler contract, not an opcode.", steps: [
    { kind: "capture", name: "state", value: literal(8, 7) },
    { kind: "read-source", name: "instruction", source: { name: "outer", width: 8, steps: [
      { kind: "capture", name: "state", value: literal(8, 9) },
      { kind: "read-source", name: "class", source: { name: "inner", width: 8,
        steps: [{ kind: "capture", name: "state", value: literal(8, 255) }], result: addWrap(value("state"), literal(8, 1)) } },
    ], result: addWrap(value("class"), value("state")) } },
    { kind: "write-register", register: cpu.register("a"), value: value("state") },
    { kind: "write-register", register: cpu.register("x"), value: value("instruction") },
    { kind: "update-flags", policy: { name: "swapped arguments", parameters: { state: 8, instruction: 8 }, unlisted: "preserve",
      updates: [{ flag: cpu.flag("z"), value: zero(value("state")) }, { flag: cpu.flag("c"), value: zero(value("instruction")) }] },
      arguments: { state: addWrap(value("instruction"), literal(8, 247)), instruction: value("state") } },
  ] } as const;
  const source = generateInstructions("6502", { probe: definition });
  const alu = new URL("../../../../src/components/cpus/alu.js", import.meta.url).href;
  // Exercise a fresh generated body through Node's normal TypeScript stripping and module execution.
  const javascript = stripTypeScriptTypes(source).replace('"../alu.ts"', JSON.stringify(alu));
  const compiled: { instructions: { probe(state: Cpu6502State): void } } = await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
  const state = mosState();
  compiled.instructions.probe(state);
  assert.equal(state.a, 7); assert.equal(state.x, 9);
  assert.equal(state.flags.z, true); assert.equal(state.flags.c, false);
});


test("generated control-latch writes set and clear without reading the latch or flags", async () => {
  const cpu = instructions6809.ldsImmediate!.cpu;
  const source = generateInstructions("6809", Object.fromEntries([false, true].map(value => [String(value), {
    cpu, name: "latch", explanation: "Constant latch assignment.",
    steps: [writeLatch({ kind: "latch", cpu: "6809", field: "nmiArmed" }, value)],
  }])));
  const compiled: { instructions: Record<string, (state: Cpu6809State) => void> } =
    await import(`data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(source))}`);
  for (const value of [false, true]) {
    const writes: unknown[] = [];
    const state = new Proxy(motorolaState(), {
      get() { assert.fail("A constant latch write must not read state"); },
      set(target, key, value) { writes.push([key, value]); return Reflect.set(target, key, value); },
    });
    compiled.instructions[String(value)]!(state);
    assert.deepEqual(writes, [["nmiArmed", value]]);
  }
});
