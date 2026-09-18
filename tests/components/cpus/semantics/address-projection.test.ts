import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { cpu8088StateDescription } from "../../../../src/components/cpus/state/8088.js";
import { cpuSymbols, flagLiteral, literal, projectAddress, readMemory, value, writeMemory, writeRegister } from "../../../../src/components/cpus/semantics/model.js";
import type { AddressExpression, NumberExpression } from "../../../../src/components/cpus/semantics/model.js";
import { defineInstruction } from "../../../../src/components/cpus/semantics/validate.js";
import { generateInstructions } from "../../../../src/components/cpus/semantics/generate.js";
import { describeInstruction } from "../../../../src/components/cpus/semantics/describe.js";

const cpu = cpuSymbols("8088", cpu8088StateDescription);
const definition = (address: AddressExpression) => defineInstruction({ cpu: cpu.declaration, name: "projected byte", explanation: "Project captured words onto a byte bus.",
  inputs: { base: 16, offset: 16 }, steps: [readMemory("byte", address), writeMemory(address, value("byte"))] });

test("address projections validate their word operands, lexical captures, and bounded integer layout", () => {
  const projection = projectAddress(value("base"), value("offset"), 4, 20);
  definition(projection);
  for (const baseShift of [-1, 17, 0.5, NaN, Infinity]) assert.throws(() => definition({ ...projection, baseShift }), /base shift/);
  for (const addressBits of [0, 33, 20.5, NaN, Infinity]) assert.throws(() => definition({ ...projection, addressBits }), /address width/);
  for (const field of ["base", "offset"] as const) {
    assert.throws(() => definition({ ...projection, [field]: literal(8, 1) }), /word base and offset/);
    assert.throws(() => definition({ ...projection, [field]: value("missing") }), /not been captured/);
    assert.throws(() => definition({ ...projection, [field]: flagLiteral(true) as unknown as NumberExpression }));
  }
  assert.throws(() => definition(literal(8, 1)), /16-bit/);
  assert.throws(() => defineInstruction({ ...definition(projection), steps: [writeRegister(cpu.register("ax"), projection as unknown as NumberExpression)] }));
  assert.match(describeInstruction(definition(projection)), /projectAddress\(base \* 16 \+ offset, 20 bits\)/);
});

test("address projection emits unsigned physical addresses, including bus wrap and the full 32-bit range", async () => {
  for (const [baseShift, addressBits] of [[0, 13], [4, 20], [16, 32]] as const) {
    const source = generateInstructions("8088", { run: definition(projectAddress(value("base"), value("offset"), baseShift, addressBits)) });
    assert.doesNotMatch(source, /from "..\/alu/);
    const compiled: { instructions: { run(state: object, base: number, offset: number, context: { readByte(address: number): number; writeByte(address: number, value: number): void }): void } } =
      await import(`data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(source))}`);
    const forbidden = new Proxy({}, { get() { assert.fail("projection must not read live state"); } });
    const check = (base: number, offset: number) => {
      const expected = Number(((BigInt(base) << BigInt(baseShift)) + BigInt(offset)) % (1n << BigInt(addressBits)));
      let reads = 0, writes = 0;
      compiled.instructions.run(forbidden, base, offset, {
        readByte(address) { assert.equal(address, expected); reads++; return 0x81; },
        writeByte(address, byte) { assert.equal(address, expected); assert.equal(byte, 0x81); writes++; },
      });
      assert.equal(reads, 1); assert.equal(writes, 1);
    };
    for (let base = 0; base < 65536; base++) check(base, 65535 - base);
    for (const base of [0, 0x1234, 0xf000, 0xffff]) for (let offset = 0; offset < 65536; offset++) check(base, offset);
  }
});
