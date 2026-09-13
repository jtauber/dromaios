import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMachine } from "../../src/machines/machine-language.js";

const sources = {
  "z80": `ram 10000
cpu z80 {
  A=00 B=00 C=00 D=00 E=00 H=00 L=00
  flags { S=0 Z=0 H=0 PV=0 N=0 C=0 }
  alternate {
    A=11 B=22 C=33 D=44 E=55 H=66 L=77
    flags { S=1 Z=0 H=1 PV=0 N=1 C=0 }
  }
  IX=1234 IY=5678 PC=0000 SP=9ABC I=DE R=FF IM=2
  iff1=true iff2=false halted=false
}`,
  "8080": `ram 10000
cpu 8080 {
  A=00 B=00 C=00 D=00 E=00 H=00 L=00 PC=0000 SP=0000
  flags { S=0 Z=0 AC=0 P=0 CY=0 }
  interruptEnabled=false halted=false
}`,
  "6502": `ram 10000
cpu 6502 {
  A=00 X=00 Y=00 PC=0000 SP=00
  flags { N=0 V=0 D=0 I=0 Z=0 C=0 }
}`,
  "6809": `ram 10000
cpu 6809 {
  A=00 B=00 DP=00 X=0000 Y=0000 S=0000 U=0000 PC=0000
  flags { E=0 F=0 H=0 I=0 N=0 Z=0 V=0 C=0 }
}`,
};

function set(source: string, name: string, value: string): string {
  return source.replace(new RegExp(`\\b${name}=\\w+`), `${name}=${value}`);
}

test("Z80 parsing preserves both banks, index registers, refresh state, and separate interrupt controls", () => {
  const machine = parseMachine(sources.z80);
  assert.equal(machine.cpu, "z80");
  assert.deepEqual(machine.initialState, {
    a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0,
    flags: { s: false, z: false, h: false, pv: false, n: false, c: false },
    alternate: { a: 0x11, b: 0x22, c: 0x33, d: 0x44, e: 0x55, h: 0x66, l: 0x77,
      flags: { s: true, z: false, h: true, pv: false, n: true, c: false } },
    ix: 0x1234, iy: 0x5678, pc: 0, sp: 0x9abc, i: 0xde, r: 0xff, im: 2,
    iff1: true, iff2: false, halted: false,
  });
  machine.initialState.alternate.a = 0;
  machine.initialState.alternate.flags.s = false;
  const fresh = parseMachine(sources.z80);
  assert.equal(fresh.cpu, "z80");
  assert.equal(fresh.initialState.alternate.a, 0x11);
  assert.equal(fresh.initialState.alternate.flags.s, true);
});

test("Z80 nested fields, flag bits, interrupt modes, and latches are validated in their own scope", () => {
  for (const value of ["0", "1", "2", "$02", "0x2", "02h"]) {
    const machine = parseMachine(set(sources.z80, "IM", value));
    assert.equal(machine.cpu, "z80");
    assert.ok([0, 1, 2].includes(machine.initialState.im));
  }
  for (const value of ["3", "FF", "true", "-1", "1.0"]) {
    assert.throws(() => parseMachine(set(sources.z80, "IM", value)), SyntaxError);
  }
  for (const field of ["iff1", "iff2", "halted"]) {
    for (const value of ["0", "1", "TRUE", "False"]) {
      assert.throws(() => parseMachine(set(sources.z80, field, value)), /Expected true or false/);
    }
  }
  const alternate = /alternate \{[\s\S]*?\n  \}/;
  for (const field of ["A", "B", "C", "D", "E", "H", "L"]) {
    assert.throws(() => parseMachine(sources.z80.replace(alternate, block => set(block, field, "100"))),
      /z80.alternate.*must be in 0..FF/);
  }
  for (const flag of ["S", "Z", "H", "PV", "N", "C"]) {
    for (const value of ["2", "true", "false"]) {
      assert.throws(() => parseMachine(sources.z80.replace(/flags \{[^}]*\}/g, block => set(block, flag, value))), SyntaxError);
      assert.throws(() => parseMachine(sources.z80.replace(alternate, block =>
        block.replace(/flags \{[^}]*\}/, flags => set(flags, flag, value)))), SyntaxError);
    }
  }
  for (const [source, error] of [
    [sources.z80.replace(alternate, ""), /Missing fields in z80: alternate/],
    [sources.z80.replace("A=11", ""), /Missing fields in z80.alternate: A/],
    [sources.z80.replace("A=11", "A=11 a=22"), /Duplicate field A/],
    [sources.z80.replace("A=11", "BC=1122"), /Unknown field "BC" in z80.alternate/],
    [sources.z80.replace("A=00", "AF=0000"), /Unknown field "AF"/],
    [sources.z80.replace(alternate, block => block.replace("PV=0", "")), /Missing fields in z80.alternate.flags: PV/],
    [sources.z80.replace(alternate, block => block.replace("PV=0", "PV=0 pv=1")), /Duplicate field PV/],
    [sources.z80.replace("alternate", "ALTERNATE"), /Expected lowercase keyword "alternate"/],
    [sources.z80.replace("alternate {", "alternate = {"), /Expected "\{"/],
    [sources.z80.replace("IX=1234", "alternate {} IX=1234"), /Duplicate field alternate/],
  ] as const) assert.throws(() => parseMachine(source), error);
});

test("machine parsing preserves explicit state, ordered images, and a zero completion address", () => {
  const source = `// Declarations can appear in any order.
end 0000
memory 0200 { 3e 02// Comments can immediately follow bytes.
  c6 03 }
cpu 8080 {
  a=10 B=00 C=00 D=00 E=00 H=00 L=00
  pC=01e2 SP=0100
  flags { cy=1 S=0 z=1 AC=0 P=1 }
  INTERRUPTENABLED=true HaLtEd=false
}
memory 0201 { fF }
memory FFFF { AB }
memory 0000 {}
ram 10000 // The model name above is an identifier; numbers here are hex.\n`;
  const expected = {
    cpu: "8080", ramSize: 0x10000, endAddress: 0,
    initialState: {
      a: 0x10, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, pc: 0x1e2, sp: 0x100,
      flags: { s: false, z: true, ac: false, p: true, cy: true },
      interruptEnabled: true, halted: false,
    },
    memory: [
      { address: 0x0200, bytes: [0x3e, 2, 0xc6, 3] },
      { address: 0x0201, bytes: [0xff] },
      { address: 0xffff, bytes: [0xab] },
      { address: 0, bytes: [] },
    ],
  };
  for (const newline of ["\n", "\r\n", "\r"]) {
    assert.deepEqual(parseMachine(source.replaceAll("\n", newline)), expected);
  }
  const first = parseMachine(sources["8080"]);
  first.initialState.a = 0xff;
  first.initialState.flags.z = true;
  const second = parseMachine(sources["8080"]);
  assert.equal(second.initialState.a, 0);
  assert.equal(second.initialState.flags.z, false);
  assert.equal(Object.hasOwn(second, "endAddress"), false);
  assert.deepEqual(second.memory, []);
});

test("hexadecimal values and aliases have the same meaning for every CPU", () => {
  for (const source of Object.values(sources)) {
    for (const value of ["100", "0100", "0x100", "0X100", "$100", "100h", "100H"]) {
      assert.equal(parseMachine(set(source, "PC", value)).initialState.pc, 0x100, value);
    }
    for (const value of ["ff", "FF", "0xFF", "$ff", "0ffh", "0FFH"]) {
      assert.equal(parseMachine(set(source, "A", value)).initialState.a, 0xff, value);
    }
  }
  for (const size of ["10000", "0x10000", "0X10000", "$10000", "10000h", "10000H"]) {
    assert.equal(parseMachine(sources["8080"].replace("ram 10000", `ram ${size}`)).ramSize, 0x10000);
  }
  assert.equal(parseMachine(`${sources["6502"]} end $FFFF`).endAddress, 0xffff);
  assert.deepEqual(parseMachine(`${sources["6809"]} memory 0FFFEH { 02 00 }`).memory,
    [{ address: 0xfffe, bytes: [2, 0] }]);
});

test("each CPU's stored registers use their actual byte or word width", () => {
  const widths = {
    "8080": { byte: ["A", "B", "C", "D", "E", "H", "L"], word: ["PC", "SP"] },
    "6502": { byte: ["A", "X", "Y", "SP"], word: ["PC"] },
    "z80": { byte: ["A", "B", "C", "D", "E", "H", "L", "I", "R"], word: ["IX", "IY", "PC", "SP"] },
    "6809": { byte: ["A", "B", "DP"], word: ["X", "Y", "S", "U", "PC"] },
  };
  for (const model of ["8080", "6502", "6809", "z80"] as const) {
    for (const width of ["byte", "word"] as const) {
      for (const register of widths[model][width]) {
        const maximum = width === "byte" ? "FF" : "FFFF";
        for (const value of ["0", maximum]) {
          const machine = parseMachine(set(sources[model], register, value));
          const entry = Object.entries(machine.initialState).find(([name]) => name === register.toLowerCase());
          assert.deepEqual(entry, [register.toLowerCase(), Number.parseInt(value, 16)]);
        }
        assert.throws(() => parseMachine(set(sources[model], register, width === "byte" ? "100" : "10000")),
          new RegExp(`${model}\\.${register} must be in 0\\.\\.${maximum}`));
      }
    }
  }
});

test("flags are complete bit assignments while control latches require Boolean literals", () => {
  const flags = { "8080": ["S", "Z", "AC", "P", "CY"], "6502": ["N", "V", "D", "I", "Z", "C"], "6809": ["E", "F", "H", "I", "N", "Z", "V", "C"] };
  for (const model of ["8080", "6502", "6809"] as const) {
    for (const flag of flags[model]) {
      const machine = parseMachine(set(sources[model], flag, "1"));
      const entry = Object.entries(machine.initialState.flags).find(([name]) => name === flag.toLowerCase());
      assert.deepEqual(entry, [flag.toLowerCase(), true]);
      for (const value of ["2", "true", "false", "-1"]) {
        assert.throws(() => parseMachine(set(sources[model], flag, value)), SyntaxError);
      }
    }
  }
  for (const field of ["interruptEnabled", "halted"]) {
    for (const value of ["0", "1", "False", "TRUE"]) {
      assert.throws(() => parseMachine(set(sources["8080"], field, value)), /Expected true or false/);
    }
  }
});

test("missing, duplicate, unknown, and derived CPU fields are rejected", () => {
  const cases: readonly (readonly [string, RegExp])[] = [
    [sources["8080"].replace("A=00", ""), /Missing fields in 8080: A/],
    [sources["8080"].replace("Z=0", ""), /Missing fields in 8080.flags: Z/],
    [sources["8080"].replace(/flags \{[^}]*\}/, ""), /Missing fields in 8080: flags/],
    [sources["8080"].replace("halted=false", ""), /Missing fields in 8080: halted/],
    [sources["8080"].replace("PC=0000", "PC=0000 pc=0001"), /Duplicate field PC/],
    [sources["8080"].replace("CY=0", "CY=0 cy=1"), /Duplicate field CY/],
    [sources["8080"].replace("halted=false", "halted=false HALTED=true"), /Duplicate field halted/],
    [sources["8080"].replace("halted=false", "flags {} halted=false"), /Duplicate field flags/],
    [sources["8080"].replace("A=00", "A=00 BC=0000"), /Unknown field "BC" in 8080/],
    [sources["6809"].replace("A=00", "A=00 D=0000"), /Unknown field "D" in 6809/],
    [sources["6502"].replace("A=00", "B=00"), /Unknown field "B" in 6502/],
    [sources["6502"].replace("N=0", "S=0"), /Unknown field "S" in 6502.flags/],
    [sources["8080"].replace("flags", "FLAGS"), /Expected lowercase keyword "flags"/],
    [sources["8080"].replace("A=00", "constructor=00"), /Unknown field "constructor"/],
    [sources["8080"].replace("A=00", "__proto__=00"), /Unknown field "__proto__"/],
  ];
  for (const [source, error] of cases) assert.throws(() => parseMachine(source), error);
});

test("malformed values and syntax are rejected as whole tokens", () => {
  for (const value of ["-1", "+1", "1.0", "0b10", "0x", "$", "FFH", "0x1H", "0x12oops", "00,", "00;", "1_000", '"FF"', "20000000000001"]) {
    assert.throws(() => parseMachine(set(sources["8080"], "A", value)), SyntaxError, value);
  }
  for (const value of ["0", "100", "0xFF", "$FF", "0FFH", "GG", "FF,", "FF;", "FF=00", "/*comment*/"]) {
    assert.throws(() => parseMachine(`${sources["8080"]} memory 0000 { ${value} }`), /two-digit hexadecimal byte/, value);
  }
  for (const [source, error] of [
    ["", /Missing ram/],
    ["ram 10000", /Missing cpu/],
    [sources["8080"].replace("ram 10000", ""), /Missing ram/],
    [`${sources["8080"]} ram 10000`, /Duplicate ram/],
    [`${sources["8080"]} cpu 8080 {}`, /Duplicate cpu/],
    [`${sources["8080"]} end 0 end 1`, /Duplicate end/],
    ["cpu 6800 {}", /Expected CPU model/],
    ["cpu Z80 {}", /Expected CPU model/],
    ["cpu 0x8080 {}", /Expected CPU model/],
    ["RAM 10000", /Unknown declaration "RAM"/],
    [`${sources["8080"]} garbage`, /Unknown declaration "garbage"/],
    [sources["8080"].replace("A=00", "A 00"), /Expected "="/],
    [sources["8080"].replace("flags {", "flags = {"), /Expected "\{"/],
    [sources["8080"].slice(0, -1), /close 8080/],
    ["cpu 8080 { flags {", /close 8080.flags/],
    ["ram 10000 memory 0000 { AA", /close memory block/],
    ["ram", /hexadecimal value for RAM size/],
  ] as const) assert.throws(() => parseMachine(source), error, source);
});

test("memory and completion addresses stay within the declared flat RAM", () => {
  for (const [suffix, message] of [
    ["memory 10000 {}", /Memory address must be in 0..FFFF/],
    ["memory FFFF { AA BB }", /Memory block extends beyond address FFFF/],
    ["end 10000", /Completion address must be in 0..FFFF/],
  ] as const) assert.throws(() => parseMachine(`${sources["8080"]} ${suffix}`), message);
  for (const size of ["0", "FFFF", "65536", "10001"]) {
    assert.throws(() => parseMachine(sources["8080"].replace("ram 10000", `ram ${size}`)), /RAM size/);
  }
});

test("diagnostics identify the offending token with filename, line, column, and a caret", () => {
  for (const newline of ["\n", "\r\n", "\r"]) {
    const source = ["ram 10000", "memory FFFF {", "  AA BB", "}"].join(newline);
    assert.throws(() => parseMachine(source, "stack.machine"), {
      name: "SyntaxError",
      message: "stack.machine:3:6: Memory block extends beyond address FFFF\n  AA BB\n     ^",
    });
  }
  assert.throws(() => parseMachine("cpu 6502 {\n\tunknown=00\n}", "lesson.machine"), {
    name: "SyntaxError",
    message: 'lesson.machine:2:2: Unknown field "unknown" in 6502\n\tunknown=00\n\t^',
  });
  assert.throws(() => parseMachine("ram 10000\nmemory 0000 {\n", "lesson.machine"), {
    name: "SyntaxError",
    message: 'lesson.machine:3:1: Expected "}" to close memory block\n\n^',
  });
});
