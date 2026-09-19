import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { cpu8088StateDescription } from "../../../../src/components/cpus/state/8088.js";
import { readWord, writeWord } from "../../../../src/components/cpus/semantics/builders.js";
import { addWrap, cpuSymbols, literal, projectAddress, value, writeRegister } from "../../../../src/components/cpus/semantics/model.js";
import type { AddressExpression } from "../../../../src/components/cpus/semantics/model.js";
import { defineInstruction } from "../../../../src/components/cpus/semantics/validate.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";

const cpu = cpuSymbols("8088", cpu8088StateDescription);
const offset = value("offset"), next = addWrap(offset, literal(16, 1));
interface AccessCase {
  readonly name: string;
  readonly order: "low-first" | "high-first";
  readonly addresses: readonly [AddressExpression, AddressExpression];
  readonly expected: readonly [number, number];
  readonly bytes: readonly [number, number];
}
const cases: readonly AccessCase[] = [
  { name: "low first through word wrap", order: "low-first", addresses: [offset, next], expected: [0xffff, 0], bytes: [0x81, 0xa5] },
  { name: "high first through word wrap", order: "high-first", addresses: [offset, next], expected: [0xffff, 0], bytes: [0xa5, 0x81] },
  { name: "high first in reverse address order", order: "high-first", addresses: [next, offset], expected: [0, 0xffff], bytes: [0xa5, 0x81] },
  { name: "separate reads at the same address", order: "low-first", addresses: [offset, offset], expected: [0xffff, 0xffff], bytes: [0x81, 0xa5] },
  { name: "logical wrap before segment projection", order: "low-first",
    addresses: [projectAddress(value("segment"), offset, 4, 20), projectAddress(value("segment"), next, 4, 20)],
    expected: [0xffef, 0xffff0], bytes: [0x81, 0xa5] },
];

for (const { name, order, addresses, expected, bytes } of cases) {
  test(`word access builders preserve ${name} and completed effects at either failure`, async () => {
    const word = readWord(order, ...addresses, "capturedLow", "capturedHigh");
    const definition = (steps: Parameters<typeof defineInstruction>[0]["steps"]) => defineInstruction({
      cpu: cpu.declaration, name, explanation: "Access the two supplied addresses in order, then update AX.",
      inputs: { segment: 16, offset: 16 }, steps,
    });
    const source = generateInstructions("8088", {
      read: definition([...word.steps, writeRegister(cpu.register("ax"), word.result)]),
      write: definition([...writeWord(order, ...addresses, literal(16, 0xa581)), writeRegister(cpu.register("ax"), literal(16, 0x1234))]),
    });
    type Context = { readByte(address: number): number; writeByte(address: number, byte: number): void };
    type Body = (state: { ax: number }, segment: number, offset: number, context: Context) => void;
    const javascript = stripTypeScriptTypes(source).replace('"../alu.ts"', JSON.stringify(new URL("../../../../src/components/cpus/alu.js", import.meta.url).href));
    const compiled: { instructions: { read: Body; write: Body } } = await import(`data:text/javascript,${encodeURIComponent(javascript)}`);
    for (const operation of ["read", "write"] as const) for (const failAt of [-1, 0, 1]) {
      const state = { ax: 0xbeef }, failure = new Error("byte access failed");
      const completed: [number, number][] = [];
      let attempts = 0;
      const access = (address: number, byte?: number): number => {
        const index = attempts++;
        assert.ok(index < 2, "exactly two byte accesses");
        assert.equal(address, expected[index]);
        if (operation === "write") assert.equal(byte, bytes[index]);
        assert.equal(state.ax, 0xbeef, "do not commit the word before both accesses succeed");
        if (index === failAt) throw failure;
        completed.push([address, bytes[index]!]);
        return bytes[index]!;
      };
      const run = () => compiled.instructions[operation](state, 0xffff, 0xffff, {
        readByte(address) { assert.equal(operation, "read"); return access(address); },
        writeByte(address, byte) { assert.equal(operation, "write"); access(address, byte); },
      });
      if (failAt < 0) run();
      else assert.throws(run, error => error === failure);
      assert.equal(attempts, failAt < 0 ? 2 : failAt + 1);
      assert.deepEqual(completed, expected.map((address, index) => [address, bytes[index]]).slice(0, failAt < 0 ? 2 : failAt));
      assert.equal(state.ax, failAt < 0 ? operation === "read" ? 0xa581 : 0x1234 : 0xbeef);
    }
  });
}
