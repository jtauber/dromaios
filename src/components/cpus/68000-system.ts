import { opcodeFamily, opcodePattern } from "./opcodes.ts";
import { addressRegisters68000 as address, operand68000, selectors68000 as codes } from "./68000-operands.ts";

export const systemForms68000 = [
  // 0000 ooo0 0 f 111100: immediate status logic. ooo=000 OR, 001 AND, 101 XOR;
  // f=0 CCR, 1 privileged SR. Even CCR consumes a complete immediate word.
  ...([
    { pattern: "0000 0000 0 f 111100", operation: "ORI" },
    { pattern: "0000 0010 0 f 111100", operation: "ANDI" },
    { pattern: "0000 1010 0 f 111100", operation: "EORI" },
  ] as const).flatMap(({ pattern, operation }) => opcodeFamily(pattern, { f: [false, true] }, ({ f: full }) => ({
    kind: "immediate", operation, full, mode: 0, code: 0, body: `${operation}_${full ? "SR" : "CCR"}`,
  } as const))),
  // 0100 0 ff0 11 mmm rrr: ff=00 SR to data-alterable EA (unprivileged on 68000),
  // 10 data EA to CCR, 11 data EA to privileged SR. No address-register operands.
  ...opcodeFamily("0100 0 ff0 11 mmm rrr", { f: [0, 1, 2, 3], m: codes, r: codes }, ({ f, m: mode, r: code }) => {
    if (f === 1 || mode === 1) return undefined;
    const operand = operand68000(16, mode, code, f === 0 ? "destination" : "source");
    if (!operand) return undefined;
    return f === 0 ? operand.kind === "immediate" ? undefined : { kind: "from-status", operand, mode, code, body: `MOVE_SR_${operand.name}` } as const
      : { kind: "to-status", operand, full: f === 3, mode, code, body: `MOVE_${operand.name}_${f === 3 ? "SR" : "CCR"}` } as const;
  }),
  // 0100 1110 0110 d rrr: d=0 An to USP, 1 USP to An; both directions are privileged.
  ...opcodeFamily("0100 1110 0110 d rrr", { d: [false, true], r: address }, ({ d: load, r: register }) => ({
    kind: "user-stack", load, register, mode: 0, code: 0, body: load ? `MOVE_USP_${register}` : `MOVE_${register}_USP`,
  } as const)),
  // Fixed system words; low 0100 is reserved on the original chip. RTS lives with control flow.
  ...([
    ["0100 1110 0111 0000", "RESET"], ["0100 1110 0111 0001", "NOP"],
    ["0100 1110 0111 0010", "STOP"], ["0100 1110 0111 0011", "RTE"],
    ["0100 1110 0111 0110", "TRAPV"], ["0100 1110 0111 0111", "RTR"],
  ] as const).flatMap(([pattern, operation]) => opcodePattern(pattern, { kind: "simple", operation, mode: 0, code: 0, body: operation } as const)),
  // TRAP's low nibble selects vector 32..47 at the boundary; Line-A/F's low bits belong to software.
  ...([
    ["0100 1010 1111 1100", "ILLEGAL", "illegal-instruction"],
    ["0100 1110 0100 xxxx", "TRAP", "trap"],
    ["1010 xxxx xxxx xxxx", "LINE_A", "line-a"], ["1111 xxxx xxxx xxxx", "LINE_F", "line-f"],
  ] as const).flatMap(([pattern, body, reason]) => opcodePattern(pattern, { kind: "exception", reason, mode: 0, code: 0, body } as const)),
].flatMap(([opcode, form]) => form ? [{ opcode, ...form }] : []);

export type SystemForm68000 = typeof systemForms68000[number];
