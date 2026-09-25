import assert from "node:assert/strict";
import { test } from "node:test";
import { group, unsigned } from "../../../../src/components/cpus/state.js";
import { capture, cpuSymbols, flagLiteral, flagValue, literal, lowByte, value, when, writeRegister } from "../../../../src/components/cpus/semantics/model.js";
import { statementValidator, validateInstruction } from "../../../../src/components/cpus/semantics/validate.js";

const cpu = cpuSymbols("probe", { a: unsigned(8), w: unsigned(16), flags: group({}) });

test("statement validation advances typed captures but pending checks cannot publish names or widths", () => {
  const validator = statementValidator(cpu.declaration, "example", { input: 16, carry: "flag" });
  validator.append([capture("word", value("input")), capture("savedCarry", flagValue("carry"), "flag")]);
  validator.check([capture("pending", literal(8, 1))]);
  assert.throws(() => validator.check([writeRegister(cpu.register("a"), value("pending"))]),
    { message: "probe example / body / 3 write-register: value pending has not been captured in this scope" });
  validator.append([capture("pending", value("word"))]);
  validator.append([writeRegister(cpu.register("w"), value("pending"))]);
  assert.throws(() => validator.check([writeRegister(cpu.register("a"), value("pending"))]),
    { message: "probe example / body / 5 write-register: expected 8-bit value" });
  validator.append([capture("byte", lowByte(value("word"))), when(flagValue("savedCarry"), [writeRegister(cpu.register("a"), value("byte"))])]);
});

test("failed appends preserve both the previous scope and the statement position", () => {
  const validator = statementValidator(cpu.declaration, "example");
  validator.append([capture("existing", literal(8, 0))]);
  assert.throws(() => validator.append([capture("temporary", literal(8, 1)), capture("existing", literal(8, 2))]),
    { message: "probe example / body / 3 capture: duplicate capture existing" });
  assert.throws(() => validator.check([capture("copy", value("temporary"))]),
    { message: "probe example / body / 2 capture: value temporary has not been captured in this scope" });
  validator.append([capture("temporary", literal(16, 1))]);
  assert.throws(() => validator.append([writeRegister(cpu.register("a"), value("temporary"))]),
    { message: "probe example / body / 3 write-register: expected 8-bit value" });
  validator.append([writeRegister(cpu.register("w"), value("temporary"))]);
});

test("branch locals stay local and pending bodies are checked again as they grow", () => {
  const validator = statementValidator(cpu.declaration, "example");
  validator.append([capture("outer", literal(8, 1))]);
  const body = [capture("inner", value("outer"))];
  validator.check([when(flagLiteral(true), body)]);
  body.push(capture("copy", value("missing")));
  assert.throws(() => validator.check([when(flagLiteral(true), body)]),
    { message: "probe example / body / 2 when / 2 capture: value missing has not been captured in this scope" });
  body.pop();
  validator.append([when(flagLiteral(true), body)]);
  assert.throws(() => validator.append([capture("copy", value("inner"))]),
    { message: "probe example / body / 3 capture: value inner has not been captured in this scope" });
});

test("validation sessions retain separate inputs and still validate empty input scopes", () => {
  const byte = statementValidator(cpu.declaration, "byte", { input: 8 });
  const word = statementValidator(cpu.declaration, "word", { input: 16 });
  byte.append([writeRegister(cpu.register("a"), value("input"))]);
  assert.throws(() => word.append([writeRegister(cpu.register("a"), value("input"))]), /expected 8-bit value/);
  word.append([writeRegister(cpu.register("w"), value("input"))]);
  const invalid = statementValidator(cpu.declaration, "invalid", { "bad-name": 8 });
  assert.throws(() => invalid.check([]), { message: 'probe invalid / inputs: invalid value name "bad-name"' });
  assert.throws(() => invalid.append([]), /invalid value name/);
});

test("incremental checks do not grant complete definitions cached validity", () => {
  const step = capture("byte", literal(8, 1));
  const definition = { cpu: cpu.declaration, name: "example", explanation: "Independent final validation.", steps: [step] };
  statementValidator(cpu.declaration, "example").append(definition.steps);
  definition.steps.push(capture("byte", literal(8, 2)));
  assert.throws(() => validateInstruction(definition), /duplicate capture byte/);
});
