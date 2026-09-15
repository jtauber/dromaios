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
  "6800": `ram 10000
cpu 6800 {
  A=00 B=00 X=3456 SP=9ABC PC=0000
  flags { H=1 I=0 N=1 Z=0 V=1 C=0 }
}`,
  "6809": `ram 10000
cpu 6809 {
  A=00 B=00 DP=00 X=0000 Y=0000 S=0000 U=0000 PC=0000
  flags { E=0 F=0 H=0 I=0 N=0 Z=0 V=0 C=0 }
}`,
};

test("6800 parsing preserves its word-sized X/SP and six condition flags in any declaration order", () => {
  const state = { a: 0, b: 0, x: 0x3456, sp: 0x9abc, pc: 0,
    flags: { h: true, i: false, n: true, z: false, v: true, c: false } };
  const suffix = "memory FFFE { 12 AB } end FFFF";
  for (const text of [`${sources["6800"]} ${suffix}`, `${suffix} ${sources["6800"]}`]) {
    assert.deepEqual(parseMachine(text), { cpu: "6800", ramSize: 0x10000, initialState: state,
      memory: [{ address: 0xfffe, bytes: [0x12, 0xab] }], endAddress: 0xffff });
  }
  const first = parseMachine(sources["6800"]);
  assert.equal(first.cpu, "6800");
  first.initialState.flags.h = false;
  first.initialState.sp = 0;
  assert.deepEqual(parseMachine(sources["6800"]).initialState, state);
});

test("6800 parsing validates every flag, rejects foreign registers and latches, and requires complete 64 KiB state", () => {
  const source = sources["6800"];
  for (const name of ["H", "I", "N", "Z", "V", "C"]) {
    for (const value of ["2", "true", "false"]) {
      assert.throws(() => parseMachine(set(source, name, value)), SyntaxError);
    }
    const missing = source.replace(new RegExp(`\\b${name}=\\w+`), "");
    assert.throws(() => parseMachine(missing), new RegExp(`Missing fields in 6800.flags: ${name}`));
  }
  for (const field of ["D=0000", "DP=00", "Y=0000", "S=0000", "U=0000", "halted=false"]) {
    assert.throws(() => parseMachine(source.replace("A=00", `A=00 ${field}`)), /Unknown field/);
  }
  assert.throws(() => parseMachine(source.replace("SP=9ABC", "")), /Missing fields in 6800: SP/);
  assert.throws(() => parseMachine(source.replace("SP=9ABC", "SP=9ABC sp=0")), /Duplicate field SP/);
  assert.throws(() => parseMachine(source.replace("H=1", "H=1 h=0")), /Duplicate field H/);
  assert.throws(() => parseMachine(source.replace("ram 10000", "ram 4000")), /RAM size for 6800 must be 10000/);
});

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
  assert.equal(first.cpu, "8080");
  first.initialState.a = 0xff;
  first.initialState.flags.z = true;
  const second = parseMachine(sources["8080"]);
  assert.equal(second.cpu, "8080");
  assert.equal(second.initialState.a, 0);
  assert.equal(second.initialState.flags.z, false);
  assert.equal(Object.hasOwn(second, "endAddress"), false);
  assert.deepEqual(second.memory, []);
});

test("hexadecimal values and aliases have the same meaning for every CPU", () => {
  for (const source of Object.values(sources)) {
    for (const value of ["100", "0100", "0x100", "0X100", "$100", "100h", "100H"]) {
      const machine = parseMachine(set(source, "PC", value));
      assert.ok(machine.cpu !== "8008" && machine.cpu !== "8088");
      assert.equal(machine.initialState.pc, 0x100, value);
    }
    for (const value of ["ff", "FF", "0xFF", "$ff", "0ffh", "0FFH"]) {
      const machine = parseMachine(set(source, "A", value));
      assert.ok(machine.cpu !== "8088" && machine.cpu !== "68000");
      assert.equal(machine.initialState.a, 0xff, value);
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
    "6800": { byte: ["A", "B"], word: ["X", "SP", "PC"] },
    "z80": { byte: ["A", "B", "C", "D", "E", "H", "L", "I", "R"], word: ["IX", "IY", "PC", "SP"] },
    "6809": { byte: ["A", "B", "DP"], word: ["X", "Y", "S", "U", "PC"] },
  };
  for (const model of ["8080", "6502", "6800", "6809", "z80"] as const) {
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
    ["cpu 68020 {}", /Expected CPU model/],
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

const source8008 = `ram 4000
cpu 8008 {
  A=11 B=22 C=33 D=44 E=55 H=E6 L=77
  flags { S=1 Z=0 P=1 C=0 }
  addressStack=[0111 1222 2333 2000 3444 0555 1666 3777]
  stackIndex=3 halted=false
}`;

test("8008 parsing preserves explicit physical address slots, selector, flags, and 16 KiB RAM", () => {
  const machine = parseMachine(`${source8008} memory 3FFF { AA } end 0`);
  assert.equal(machine.cpu, "8008");
  assert.equal(machine.ramSize, 0x4000);
  assert.equal(machine.endAddress, 0);
  assert.deepEqual(machine.memory, [{ address: 0x3fff, bytes: [0xaa] }]);
  assert.deepEqual(machine.initialState, { a: 0x11, b: 0x22, c: 0x33, d: 0x44, e: 0x55, h: 0xe6, l: 0x77,
    flags: { s: true, z: false, p: true, c: false },
    addressStack: [0x111, 0x1222, 0x2333, 0x2000, 0x3444, 0x555, 0x1666, 0x3777], stackIndex: 3, halted: false });
  Reflect.set(machine.initialState.addressStack, 3, 0);
  const fresh = parseMachine(source8008);
  assert.equal(fresh.cpu, "8008");
  assert.equal(fresh.initialState.addressStack[3], 0x2000);
  assert.equal(Object.hasOwn(fresh.initialState, "pc"), false);
});

test("8008 address lists require exactly eight 14-bit values and preserve hexadecimal aliases and comments", () => {
  const list = /\[[^\]]*\]/;
  const accepted = parseMachine(source8008.replace(list, '[0 $100 0x200 0300h\n // Slots continue after comments.\n 0400 0500 0600 3FFF]'));
  assert.equal(accepted.cpu, "8008");
  assert.deepEqual(accepted.initialState.addressStack, [0, 0x100, 0x200, 0x300, 0x400, 0x500, 0x600, 0x3fff]);
  for (const count of [0, 1, 7, 9]) {
    assert.throws(() => parseMachine(source8008.replace(list, `[${Array(count).fill("0000").join(" ")}]`)), /exactly 8 values/);
  }
  for (let index = 0; index < 8; index++) {
    const values = Array<string>(8).fill("0000");
    for (const value of ["4000", "FFFF", "-1", "1.0", "true", "0000,"]) {
      values[index] = value;
      assert.throws(() => parseMachine(source8008.replace(list, `[${values.join(" ")}]`)), SyntaxError);
    }
  }
  for (const value of ["0", "7", "$7", "07h"]) {
    const machine = parseMachine(set(source8008, "stackIndex", value));
    assert.equal(machine.cpu, "8008");
    assert.ok([0, 7].includes(machine.initialState.stackIndex));
  }
  for (const value of ["8", "FF", "-1", "0.5", "true"]) {
    assert.throws(() => parseMachine(set(source8008, "stackIndex", value)), SyntaxError);
  }
  assert.throws(() => parseMachine(source8008.replace(list, '{0000}')), /Expected "\["/);
  assert.throws(() => parseMachine(source8008.slice(0, source8008.indexOf("]"))), /close 8008.addressStack/);
  for (const field of ["PC", "HL", "SP"]) {
    assert.throws(() => parseMachine(source8008.replace("A=11", `A=11 ${field}=0`)), /Unknown field/);
  }
  for (const [source, expected] of [
    [source8008.replace(/addressStack=\[[^\]]*\]/, ""), /Missing fields in 8008: addressStack/],
    [source8008.replace("stackIndex=3", ""), /Missing fields in 8008: stackIndex/],
    [source8008.replace("stackIndex=3", "stackIndex=3 STACKINDEX=4"), /Duplicate field stackIndex/],
    [source8008.replace("stackIndex=3", "addressStack=[] stackIndex=3"), /Duplicate field addressStack/],
  ] as const) assert.throws(() => parseMachine(source), expected);
});

test("8008 byte registers and flags validate in their own scopes", () => {
  for (const field of ["A", "B", "C", "D", "E", "H", "L"]) {
    for (const value of ["00", "FF"]) assert.doesNotThrow(() => parseMachine(set(source8008, field, value)));
    assert.throws(() => parseMachine(set(source8008, field, "100")), /must be in 0..FF/);
  }
  for (const field of ["S", "Z", "P", "C"]) {
    const setFlag = (value: string) => source8008.replace(/flags \{[^}]*\}/, block => set(block, field, value));
    for (const value of ["0", "1"]) assert.doesNotThrow(() => parseMachine(setFlag(value)));
    for (const value of ["2", "true", "false"]) assert.throws(() => parseMachine(setFlag(value)), SyntaxError);
  }
  for (const value of ["0", "1", "TRUE"]) {
    assert.throws(() => parseMachine(set(source8008, "halted", value)), /Expected true or false/);
  }
});

test("machine RAM size follows the selected CPU and checks bounds regardless of declaration order", () => {
  assert.throws(() => parseMachine(source8008.replace("ram 4000", "ram 10000")), /RAM size for 8008 must be 4000/);
  for (const source of Object.values(sources)) {
    assert.throws(() => parseMachine(source.replace("ram 10000", "ram 4000")), /RAM size for .* must be 10000/);
  }
  for (const suffix of ["memory 4000 {}", "memory 3FFF { AA BB }", "end 4000"]) {
    assert.throws(() => parseMachine(`${source8008}\n${suffix}`), /3FFF/);
    assert.throws(() => parseMachine(`${suffix}\n${source8008}`), /3FFF/);
  }
  for (const newline of ["\n", "\r\n", "\r"]) {
    const text = `memory 3FFF {\n  AA BB\n}\n${source8008}`.replaceAll("\n", newline);
    assert.throws(() => parseMachine(text, "8008.machine"), {
      name: "SyntaxError", message: "8008.machine:2:6: Memory block extends beyond address 3FFF\n  AA BB\n     ^",
    });
  }
  assert.deepEqual(parseMachine(`memory 3FFF {} end 3FFF ${source8008}`).memory, [{ address: 0x3fff, bytes: [] }]);
});

const source8088 = `ram 100000
cpu 8088 {
  AX=1122 BX=3344 CX=5566 DX=7788 SP=8000 BP=9000 SI=0010 DI=0020
  CS=1234 DS=2000 SS=3000 ES=4000 IP=0100
  halted=false
  flags { CF=1 PF=0 AF=1 ZF=1 SF=1 TF=0 IF=1 DF=1 OF=1 }
}`;

test("8088 parsing preserves logical word registers and validates twenty-bit physical image and completion addresses", () => {
  const suffix = "memory FFFFE { 12 AB } end FFFFF";
  const expected = { cpu: "8088", ramSize: 0x100000,
    initialState: { ax: 0x1122, bx: 0x3344, cx: 0x5566, dx: 0x7788, sp: 0x8000, bp: 0x9000, si: 0x10, di: 0x20,
      cs: 0x1234, ds: 0x2000, ss: 0x3000, es: 0x4000, ip: 0x100, halted: false,
      flags: { cf: true, pf: false, af: true, zf: true, sf: true, tf: false, if: true, df: true, of: true } },
    memory: [{ address: 0xffffe, bytes: [0x12, 0xab] }], endAddress: 0xfffff };
  for (const source of [`${source8088} ${suffix}`, `${suffix} ${source8088}`]) {
    assert.deepEqual(parseMachine(source), expected);
  }
  const first = parseMachine(`${source8088} ${suffix}`);
  assert.equal(first.cpu, "8088");
  first.initialState.ax = 0;
  first.initialState.flags.if = false;
  assert.deepEqual(parseMachine(`${source8088} ${suffix}`), expected);
  for (const value of ["100", "$100", "0x100", "100h"]) {
    const machine = parseMachine(set(source8088, "IP", value));
    assert.equal(machine.cpu, "8088");
    assert.equal(machine.initialState.ip, 0x100);
  }
});

test("8088 parsing checks every word and flag and rejects assignments to byte views and derived PC", () => {
  for (const name of ["AX", "BX", "CX", "DX", "SP", "BP", "SI", "DI", "CS", "DS", "SS", "ES", "IP"]) {
    for (const value of ["0000", "FFFF"]) assert.doesNotThrow(() => parseMachine(set(source8088, name, value)));
    assert.throws(() => parseMachine(set(source8088, name, "10000")), /must be in 0..FFFF/);
    assert.throws(() => parseMachine(source8088.replace(new RegExp(`\\b${name}=\\w+`), "")), /Missing fields/);
    assert.throws(() => parseMachine(source8088.replace(`${name}=`, `${name.toLowerCase()}=0 ${name}=`)), /Duplicate field/);
  }
  for (const name of ["CF", "PF", "AF", "ZF", "SF", "TF", "IF", "DF", "OF"]) {
    for (const value of ["2", "true", "false"]) assert.throws(() => parseMachine(set(source8088, name, value)), SyntaxError);
    assert.throws(() => parseMachine(source8088.replace(new RegExp(`\\b${name}=\\w+`), "")), /Missing fields/);
  }
  for (const name of ["AL", "AH", "BL", "BH", "CL", "CH", "DL", "DH", "PC", "A"]) {
    assert.throws(() => parseMachine(source8088.replace("AX=1122", `AX=1122 ${name}=0`)), /Unknown field/);
  }
  for (const value of ["0", "1", "FALSE"]) {
    assert.throws(() => parseMachine(set(source8088, "halted", value)), /Expected true or false/);
  }
  const stopped = parseMachine(set(source8088, "halted", "true"));
  assert.equal(stopped.cpu, "8088");
  assert.equal(stopped.initialState.halted, true);
  assert.throws(() => parseMachine(source8088.replace("halted=false", "")), /Missing fields/);
});

test("larger 8088 images do not relax the smaller CPUs' bounds and memory blocks never wrap", () => {
  for (const size of ["4000", "10000"]) {
    assert.throws(() => parseMachine(source8088.replace("ram 100000", `ram ${size}`)), /RAM size for 8088 must be 100000/);
  }
  for (const suffix of ["memory 100000 {}", "memory FFFFF { AA BB }", "end 100000"]) {
    for (const text of [`${source8088} ${suffix}`, `${suffix} ${source8088}`]) {
      assert.throws(() => parseMachine(text), /FFFFF/);
    }
  }
  for (const source of [...Object.values(sources), source8008]) {
    for (const suffix of ["memory FFFFF {}", "end FFFFF"]) {
      for (const text of [`${source} ${suffix}`, `${suffix} ${source}`]) assert.throws(() => parseMachine(text), SyntaxError);
    }
    assert.throws(() => parseMachine(source.replace(/ram \w+/, "ram 100000")), /RAM size for/);
  }
  for (const newline of ["\n", "\r\n", "\r"]) {
    const text = `memory FFFFF {\n  AA BB\n}\n${source8088}`.replaceAll("\n", newline);
    assert.throws(() => parseMachine(text, "8088.machine"), {
      name: "SyntaxError", message: "8088.machine:2:6: Memory block extends beyond address FFFFF\n  AA BB\n     ^",
    });
  }
});

const source68000 = `ram 1000000
cpu 68000 {
  D0=11223344 D1=55667788 D2=99AABBCC D3=DDEEFF00 D4=01234567 D5=89ABCDEF D6=FEDCBA98 D7=76543210
  A0=10000000 A1=20000000 A2=30000000 A3=40000000 A4=50000000 A5=60000000 A6=70000000
  USP=34FFE000 SSP=56FFD000 PC=AB001000 interruptMask=2 halted=false
  flags { X=1 N=0 Z=1 V=1 C=1 T=0 S=0 }
}`;

test("68000 parsing keeps full long registers and logical completion separate from physical memory bounds", () => {
  const suffix = "memory FFFFFE { 12 AB } end FFFFFFFF";
  for (const source of [`${source68000} ${suffix}`, `${suffix} ${source68000}`]) {
    const machine = parseMachine(source);
    assert.equal(machine.cpu, "68000");
    assert.equal(machine.ramSize, 0x1000000);
    assert.equal(machine.endAddress, 0xffffffff);
    assert.deepEqual(machine.memory, [{ address: 0xfffffe, bytes: [0x12, 0xab] }]);
    assert.deepEqual(machine.initialState, {
      d0: 0x11223344, d1: 0x55667788, d2: 0x99aabbcc, d3: 0xddeeff00,
      d4: 0x01234567, d5: 0x89abcdef, d6: 0xfedcba98, d7: 0x76543210,
      a0: 0x10000000, a1: 0x20000000, a2: 0x30000000, a3: 0x40000000,
      a4: 0x50000000, a5: 0x60000000, a6: 0x70000000, usp: 0x34ffe000, ssp: 0x56ffd000,
      pc: 0xab001000, halted: false, interruptMask: 2, flags: { x: true, n: false, z: true, v: true, c: true, t: false, s: false },
    });
  }
  for (const suffix of ["memory 1000000 {}", "memory FFFFFF { AA BB }", "end 100000000"]) {
    for (const source of [`${source68000} ${suffix}`, `${suffix} ${source68000}`]) assert.throws(() => parseMachine(source), SyntaxError);
  }
  for (const size of ["4000", "10000", "100000"]) {
    assert.throws(() => parseMachine(source68000.replace("ram 1000000", `ram ${size}`)), /RAM size for 68000 must be 1000000/);
  }
  for (const source of [...Object.values(sources), source8008, source8088]) {
    for (const suffix of ["memory FFFFFF {}", "end AB001012"]) {
      for (const text of [`${source} ${suffix}`, `${suffix} ${source}`]) assert.throws(() => parseMachine(text), SyntaxError);
    }
    assert.throws(() => parseMachine(source.replace(/ram \w+/, "ram 1000000")), /RAM size for/);
  }
});

test("68000 parsing validates complete long state, three-bit mask, and original-68000 flags", () => {
  for (const name of ["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "A0", "A1", "A2", "A3", "A4", "A5", "A6", "USP", "SSP", "PC"]) {
    for (const value of ["0", "FFFFFFFF", "$FFFFFFFF", "0xFFFFFFFF", "0FFFFFFFFh"]) {
      const machine = parseMachine(set(source68000, name, value));
      assert.equal(Object.entries(machine.initialState).find(([key]) => key === name.toLowerCase())?.[1], value === "0" ? 0 : 0xffffffff);
    }
    assert.throws(() => parseMachine(set(source68000, name, "100000000")), /must be in 0..FFFFFFFF/);
    assert.throws(() => parseMachine(source68000.replace(new RegExp(`\\b${name}=\\w+`), "")), /Missing fields/);
    assert.throws(() => parseMachine(source68000.replace(`${name}=`, `${name.toLowerCase()}=0 ${name}=`)), /Duplicate field/);
  }
  for (const name of ["X", "N", "Z", "V", "C", "T", "S"]) {
    for (const value of ["2", "true", "false"]) assert.throws(() => parseMachine(set(source68000, name, value)), SyntaxError);
    assert.throws(() => parseMachine(source68000.replace(new RegExp(`\\b${name}=\\w+`), "")), /Missing fields/);
  }
  for (const value of ["0", "7"]) assert.doesNotThrow(() => parseMachine(set(source68000, "interruptMask", value)));
  for (const value of ["8", "true", "-1"]) assert.throws(() => parseMachine(set(source68000, "interruptMask", value)), SyntaxError);
  for (const value of ["true", "false"]) assert.doesNotThrow(() => parseMachine(set(source68000, "halted", value)));
  for (const value of ["0", "1"]) assert.throws(() => parseMachine(set(source68000, "halted", value)), SyntaxError);
  assert.throws(() => parseMachine(source68000.replace("halted=false", "")), /Missing fields in 68000: halted/);
  for (const field of ["A7=0", "physicalPc=0", "SR=0"]) {
    assert.throws(() => parseMachine(source68000.replace("D0=11223344", `D0=11223344 ${field}`)), /Unknown field/);
  }
  for (const field of ["M", "T0", "T1"]) {
    assert.throws(() => parseMachine(source68000.replace("X=1", `X=1 ${field}=0`)), /Unknown field/);
  }
});
