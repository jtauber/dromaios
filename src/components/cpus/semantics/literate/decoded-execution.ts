import { generateInterruptEntries } from "./interrupt-entries.ts";
import type { DecodedExecution } from "./execution.ts";

/** Bind chapter state operations to the shared full-encoding execution boundary. */
export function generateDecodedExecution(cpu: string, module: string, policy: DecodedExecution): string {
  const quoted = JSON.stringify;
  const retirement = [
    ...(policy.retireDeferral === undefined ? [] : [`state[${quoted(policy.retireDeferral)}] = deferred;`]),
    ...(policy.retire === undefined ? [] : [`actions[${quoted(policy.retire)}](state);`]),
  ].join(" ");
  return `// Generated from the chapter's execution contract. Do not edit.
import { decodedExecution } from "../decoded-execution.ts";
${policy.interrupt === "entries" ? 'import { interruptEntries } from "../interrupt-entries.ts";\n' : ""}
import { checkByteMemory } from "../byte-execution.ts";
import { programCounter } from "../execute-byte-instruction.ts";
import type { Ram } from "../../memory/ram.ts";
import type { BytePorts } from "../port-access.ts";
import { opcodeDecoder } from "./${module}.ts";
import { instructions as actions, sourceReaders } from "./${module}-state.ts";

export const checkMemory = (ram: Ram): void => checkByteMemory(${quoted(cpu.toUpperCase())}, ram, ${policy.memoryBits});

export function createExecution<Snapshot>(state: Parameters<typeof opcodeDecoder>[0], ram: Ram,
  snapshot: () => Snapshot, ports?: BytePorts${policy.notifyReti ? ", onReti?: () => void" : ""}) {
  const views = sourceReaders(state).views;
  const boundary = decodedExecution(${quoted(cpu.toUpperCase())}, ram, ports, snapshot, {
    memoryBits: ${policy.memoryBits},
    counter: programCounter(views[${quoted(policy.counter)}], value => actions[${quoted(policy.writeCounter)}](state, value)),
    stopped: () => state[${quoted(policy.stopped)}],
    reset: () => actions[${quoted(policy.reset)}](state),
    retire: ${policy.retireDeferral === undefined ? "()" : "deferred"} => { ${retirement} },
    opcodeFetched: count => actions[${quoted(policy.opcodeFetched)}](state, count),
${policy.notifyReti ? "    notifyReti: () => onReti?.(),\n" : ""}    word: ${quoted(policy.word)},
    decode: opcodeDecoder(state),
  });
${policy.interrupt === "entries" ? `  const interrupt = interruptEntries(${quoted(cpu.toUpperCase())}, ram, ports, snapshot, boundary, {
${generateInterruptEntries(policy.entries)}
  }, () => state[${quoted(policy.stopped)}], ${quoted(policy.word)});
  return { ...boundary, interrupt };` : "  return boundary;"}
}
`;
}
