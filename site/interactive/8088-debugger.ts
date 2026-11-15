import { opcode8088Index } from "./8088-encoding.js";
import type { stepTimedXtCpu } from "../../src/machines/8088/pc-xt/interrupts.js";
import { logical8088, physical8088, xtHex as hex } from "./8088-disassembly.js";
import type { createInstructionDebugger, StackFlow } from "./instruction-debugger.js";

type Boundary = ReturnType<typeof stepTimedXtCpu>["record"];
const location = (cs: number, ip: number) => ({ address: physical8088(cs, ip), space: "CS:IP " + logical8088(cs, ip) });

/** Recognize stack boundaries from captured bytes, without formatting disassembly or reading the bus.
 * Near calls save IP; far calls save CS:IP; interrupt entry saves FLAGS as well. */
export function observe8088Boundary(policy: ReturnType<typeof createInstructionDebugger>, record: Boundary): void {
  const { before, after, instruction } = record, bytes = instruction?.bytes ?? [];
  const index = opcode8088Index(bytes);
  const opcode = bytes[index], modRM = bytes[index + 1] ?? 0, group = modRM >>> 3 & 7;
  let flow: StackFlow | undefined, frameType: string | undefined, discard = 0;
  let returnLocation;
  if (record.outcome === "accepted" || "interrupt" in record && record.interrupt) {
    flow = "interrupt"; frameType = "interrupt";
    // Use the CPU's actual saved pointer: WAIT, REP, traps and divide faults have distinct restart rules.
    const writes = record.accesses.flatMap(access => access.kind === "write" ? [access.value] : []);
    const frame = writes.slice(-6);
    if (frame.length !== 6) throw new Error("8088 interrupt entry did not record its six-byte frame.");
    returnLocation = location(frame[2]! | frame[3]! << 8, frame[4]! | frame[5]! << 8);
  } else if (opcode === 0xe8 || opcode === 0x9a || opcode === 0xff && (group === 2 || group === 3)) {
    flow = "call"; frameType = opcode === 0x9a || opcode === 0xff && group === 3 ? "far" : "near";
  } else if (opcode === 0xc2 || opcode === 0xc3 || opcode === 0xca || opcode === 0xcb || opcode === 0xcf) {
    flow = opcode === 0xcf ? "interrupt-return" : "return";
    frameType = opcode === 0xcf ? "interrupt" : opcode & 8 ? "far" : "near";
    // RET n first restores the caller's SP, then releases n bytes of arguments.
    if (opcode === 0xc2 || opcode === 0xca) discard = bytes[index + 1]! | bytes[index + 2]! << 8;
  }
  // Ordinary pushes, pops and local allocation do not replace a frame.
  const registerSP = modRM >= 0xc0 && (modRM & 7) === 4;
  const replacesSP = opcode === 0xbc || opcode === 0x5c || opcode === 0x94
    || [0x8b, 0x8d, 0xc4, 0xc5].includes(opcode!) && group === 4
    || [0x89, 0x8c, 0x8f, 0xc7].includes(opcode!) && registerSP
    || opcode === 0x87 && (group === 4 || registerSP);
  let resetsStack = before.ss !== after.ss;
  if (replacesSP && before.sp !== after.sp) {
    const frame = policy.frames.at(-1);
    const size = frame?.frameType === "interrupt" ? 6 : frame?.frameType === "far" ? 4 : 2;
    // An epilogue such as MOV SP,BP can discard locals beneath the saved return pointer.
    // An explicit load outside that interval replaces the observed stack instead.
    const available = frame ? (frame.stack - size - before.sp) & 0xffff : 0;
    const released = (after.sp - before.sp) & 0xffff;
    if (!frame || released > available) resetsStack = true;
  }
  if (!flow && !resetsStack) { policy.observeBoundary(); return; }
  returnLocation ??= location(before.cs, (before.ip + bytes.length) & 0xffff);
  policy.observe({ before: location(before.cs, before.ip), after: location(after.cs, after.ip),
    stackRegister: hex(before.ss, 4), stackBefore: before.sp,
    stackAfter: (after.sp - discard) & 0xffff, flow, frameType,
    returnAddress: returnLocation.address, returnSpace: returnLocation.space,
    resetsStack });
}
