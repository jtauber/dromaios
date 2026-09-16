import { negative, subtract, value, zero } from "./model.ts";
import type { Flag, FlagPolicy, Register, Statement, ValueSource, Width } from "./model.ts";

// Construction-time recipes return inspectable data; none reads live CPU state.
// Every source owns its captures. Only the yielded value enters the caller's scope.
export const immediateByte: ValueSource = {
  name: "immediate byte", width: 8,
  steps: [{ kind: "fetch-byte", name: "byte" }], result: value("byte"),
};

export function registerSource(register: Register): ValueSource {
  return { name: `register ${register.field.toUpperCase()}`, width: register.width,
    steps: [{ kind: "read-register", name: "contents", register }], result: value("contents") };
}

export function negativeZeroPolicy(name: string, n: Flag, z: Flag, width: Width): FlagPolicy {
  return { name, parameters: { result: width }, unlisted: "preserve", updates: [
    { flag: n, value: negative(value("result")) }, { flag: z, value: zero(value("result")) },
  ] };
}

/** Finish all source effects before capturing the comparison register; never write it back. */
export function compare(register: Register, source: ValueSource, policy: FlagPolicy): readonly Statement[] {
  return [
    { kind: "read-source", name: "right", source },
    { kind: "read-register", name: "left", register },
    { kind: "capture", name: "result", value: subtract(value("left"), value("right")) },
    { kind: "update-flags", policy, arguments: { left: value("left"), right: value("right"), result: value("result") } },
  ];
}

/** Capture the source once, write the destination, then optionally apply a policy parameterized by result. */
export function transfer(destination: Register, source: ValueSource, policy?: FlagPolicy): readonly Statement[] {
  const steps: Statement[] = [
    { kind: "read-source", name: "result", source },
    { kind: "write-register", register: destination, value: value("result") },
  ];
  if (policy !== undefined) steps.push({ kind: "update-flags", policy, arguments: { result: value("result") } });
  return steps;
}
