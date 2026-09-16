import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { instructions } from "../../../../src/components/cpus/generated/6502.js";
import { cpu6809StateDescription } from "../../../../src/components/cpus/state/6809.js";
import type { Cpu6809State } from "../../../../src/components/cpus/state/6809.js";
import type { Cpu6502State } from "../../../../src/components/cpus/state/6502.js";
import { capture, cpuSymbols, flagLiteral, flagValue, lowBit, negative, readFlag, readRegister,
  shiftLeft, shiftRight, updateFlags, value, writeRegister } from "../../../../src/components/cpus/semantics/model.js";
import { defineInstruction } from "../../../../src/components/cpus/semantics/validate.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";

test("generated word shifts preserve a captured incoming flag and handle every unsigned word in either direction", async () => {
  const cpu = cpuSymbols("6809", cpu6809StateDescription);
  // Compiler probes, not 6809 instructions: clear live C after capturing it, then use the capture.
  const definitions = Object.fromEntries(([
    ["left", shiftLeft, negative], ["right", shiftRight, lowBit],
  ] as const).map(([name, shift, outgoing]) => [name, defineInstruction({
    cpu: cpu.declaration, name, explanation: "Word shift and flag-capture probe.", steps: [
      readRegister("original", cpu.register("x")), readFlag("carry", cpu.flag("c")),
      updateFlags({ name: "clear live C", parameters: {}, unlisted: "preserve",
        updates: [{ flag: cpu.flag("c"), value: flagLiteral(false) }],
      }, {}),
      capture("result", shift(value("original"), flagValue("carry"))),
      writeRegister(cpu.register("x"), value("result")),
      updateFlags({ name: "outgoing bit", parameters: { original: 16 }, unlisted: "preserve",
        updates: [{ flag: cpu.flag("c"), value: outgoing(value("original")) }],
      }, { original: value("original") }),
    ],
  })]));
  const source = generateInstructions("6809", definitions);
  const alu = new URL("../../../../src/components/cpus/alu.js", import.meta.url).href;
  const javascript = stripTypeScriptTypes(source).replace('"../alu.ts"', JSON.stringify(alu));
  const compiled: { instructions: Record<"left" | "right", (state: Cpu6809State) => void> } =
    await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
  const state: Cpu6809State = { a: 0, b: 0, dp: 0, x: 0, y: 0, s: 0, u: 0, pc: 0, waitMode: "none", nmiArmed: false,
    flags: { e: false, f: false, h: false, i: false, n: false, z: false, v: false, c: false } };
  for (const direction of ["left", "right"] as const) for (const incoming of [false, true]) for (let original = 0; original < 65536; original++) {
    state.x = original; state.flags.c = incoming;
    compiled.instructions[direction](state);
    assert.equal(state.x, direction === "left" ? (original * 2 + Number(incoming)) % 65536 : Math.floor(original / 2) + Number(incoming) * 32768);
    assert.equal(state.flags.c, direction === "left" ? original >= 32768 : original % 2 === 1);
  }
});

test("generated memory shifts read carry only for rotates, after the original write and before the result write", () => {
  for (const [opcode, original, result, outgoing, rotate] of [
    [0x06, 0x80, 0, true, false], [0x26, 0x80, 1, true, true],
    [0x46, 1, 0, true, false], [0x66, 1, 0x80, true, true],
  ] as const) {
    const state: Cpu6502State = { a: 0x22, x: 0, y: 0, pc: 0, sp: 0xff,
      flags: { n: false, z: false, v: true, d: true, i: true, c: false } };
    let carry = false, writes = 0;
    const events: string[] = [];
    Object.defineProperty(state.flags, "c", {
      get() { events.push("read C"); return carry; },
      set(next: boolean) { events.push(`C=${Number(next)}`); carry = next; },
    });
    instructions[opcode](state, {
      fetchByte() { events.push("fetch"); return 0x80; },
      readByte(address) { assert.equal(address, 0x80); events.push("read byte"); return original; },
      writeByte(address, byte) {
        assert.equal(address, 0x80);
        events.push(`write ${byte}`);
        assert.equal(state.flags.n, false); assert.equal(state.flags.z, false);
        if (++writes === 1) carry = true; // The incoming carry is observed AFTER this effect.
        else { assert.equal(carry, outgoing); assert.equal(byte, result); }
      },
    });
    assert.deepEqual(events, ["fetch", "read byte", `write ${original}`, ...(rotate ? ["read C"] : []), `C=${Number(outgoing)}`, `write ${result}`]);
    assert.equal(state.flags.n, result >= 128); assert.equal(state.flags.z, result === 0);
    assert.equal(state.a, 0x22);
  }
});
