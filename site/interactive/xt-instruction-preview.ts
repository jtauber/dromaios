import { Cpu8088, cpu8088StateDescription } from "../../src/components/cpus/generated/8088-cpu.js";
import type { Cpu8088Snapshot } from "../../src/components/cpus/generated/8088-cpu.js";
import { InstructionTimingUnavailable } from "../../src/components/cpus/instruction-timing.js";
import { XtIo } from "../../src/machines/8088/pc-xt/io.js";
import { decode8088, logical8088, physical8088, xtHex as hex } from "./8088-disassembly.js";
import type { Row8088 } from "./8088-disassembly.js";
import { readXtStorage } from "./xt-inspection.js";
import type { XtCatalogue } from "./xt-inspection.js";
import { stepXtSessionCpu } from "./xt-session.js";
import type { XtMachine } from "./xt-session.js";
import { XtKeyboard } from "./xt-keyboard.js";
import { previewMemory } from "./preview-memory.js";
import { describeFlagCondition, testFlagCondition } from "./instruction-shape.js";

export function explain8088Address(state: Cpu8088Snapshot, row: Row8088): readonly string[] {
  const operand = row.operand;
  if (!operand) return [];
  const value = (name: string) => Number(state[name.toLowerCase() as keyof Cpu8088Snapshot]);
  const offset = (operand.bases.reduce((sum, name) => sum + value(name), 0) + operand.displacement) & 0xffff;
  const terms = operand.bases.map(name => `${name}(${hex(value(name), 4)})`);
  const base = terms.join(" + ");
  const displacement = hex(Math.abs(operand.displacement), 4);
  const calculation = !base ? displacement : base + (operand.displacement === 0 ? ""
    : ` ${operand.displacement < 0 ? "−" : "+"} ${displacement}`);
  const result = [`Effective offset ${calculation} → ${hex(offset, 4)} (16 bits).`];
  if (operand.addressOnly) result.push("LEA uses the offset alone.");
  else result.push(`${operand.segment}:${hex(offset, 4)} = ${logical8088(value(operand.segment), offset)} → physical $${hex(physical8088(value(operand.segment), offset), 5)}.`);
  return result;
}

/** A copied CPU, board I/O and keyboard preserve native boundary ordering. Only declared storage is observed. */
export function previewXtInstruction(session: { readonly machine: XtMachine; readonly keyboard: XtKeyboard }, catalogue: XtCatalogue) {
  const { machine } = session, state = machine.cpu.snapshot();
  const read = (address: number) => readXtStorage(machine, catalogue.storage, address);
  const row = decode8088(catalogue.cpu, state.cs, state.ip, index => read(physical8088(state.cs, state.ip + index)));
  const unavailable = Symbol("XT preview unavailable");
  let external: string | undefined, reads = 0;
  function stop(reason: string): never { external = reason; throw unavailable; }
  function writeKind(address: number) {
    const kind = catalogue.storage.find(r => address >= r.start && address < r.start + r.size)?.component;
    if (kind === "ega") return "device" as const;
    return kind === "ram" || kind === "video" ? "ram" as const : "ignored" as const;
  }
  const memory = previewMemory(address => {
    if (++reads > 64) stop("Preview limit of 64 memory reads reached.");
    return read(address);
  }, writeKind, 0x100000);
  const cpu = new Cpu8088(memory.memory, state, {
    ports: { readPort: port => stop(`Input from port ${hex(port, 4)} requires the running machine.`),
      writePort: (port, value) => stop(`Output to port ${hex(port, 4)} ← ${hex(value, 2)} requires the running machine.`) },
    test: () => stop("WAIT needs the TEST pin."), escape: () => stop("ESC needs the coprocessor connection."),
  });
  let record: ReturnType<typeof stepXtSessionCpu> | undefined, timingUnavailable = false;
  try {
    record = memory.attempt(() => stepXtSessionCpu({ cpu, memory: memory.memory, ram: machine.ram, io: new XtIo(machine.io.snapshot()) },
      new XtKeyboard(session.keyboard.snapshot())));
  } catch (error) {
    if (error instanceof InstructionTimingUnavailable) timingUnavailable = true;
    else if (error !== unavailable) throw error;
  }
  const ordinary = record?.instruction != null, effects: string[] = [];
  let assembly = row.assembly, explanation = row.encoding?.explanation;
  if (record && !ordinary) {
    const source = "source" in record ? record.source : record.interrupt?.source;
    assembly = source ? `${source.toUpperCase()} · ${record.outcome}` : record.outcome.toUpperCase();
    explanation = "External entry, a pending trap, and an idle halt are CPU boundaries. The instruction at CS:IP is not fetched.";
  }
  const condition = row.encoding?.condition;
  if (ordinary && condition && record?.outcome === "executed") {
    effects.push(`Branch if ${describeFlagCondition(condition)}.`,
      `OF=${+state.flags.of} CF=${+state.flags.cf} ZF=${+state.flags.zf} SF=${+state.flags.sf} PF=${+state.flags.pf} · branch ${testFlagCondition(condition, state.flags) ? "taken" : "not taken"}.`);
  }
  const blocked = memory.blocked;
  if (timingUnavailable) effects.push("Timing for this boundary is not yet modeled. The XT cannot step it.");
  else if (blocked || external) {
    effects.push(external ?? `${blocked!.kind === "read" ? "Read" : "Write"} physical $${hex(blocked!.address, 5)} requires unavailable storage.`,
      "Preview stops here. Step to observe the actual result.");
  } else if (record?.outcome === "unsupported") effects.push("Unsupported instruction or encoding.");
  else if (record) {
    for (const [key, field] of Object.entries(cpu8088StateDescription)) {
      if (field.kind !== "unsigned" || key === "cs" || key === "ip") continue;
      const name = key as keyof Cpu8088Snapshot;
      if (state[name] !== record.after[name]) effects.push(`${key.toUpperCase()}  ${hex(Number(state[name]), 4)} → ${hex(Number(record.after[name]), 4)}`);
    }
    const flags = (Object.keys(state.flags) as (keyof typeof state.flags)[]).filter(flag => state.flags[flag] !== record.after.flags[flag]);
    if (flags.length) effects.push(flags.map(flag => `${flag.toUpperCase()} ${+state.flags[flag]} → ${+record.after.flags[flag]}`).join("   "));
    for (const name of ["halted", "waiting", "interruptDeferred", "recognitionDeferred", "trapPending"] as const) {
      if (state[name] !== record.after[name]) effects.push(`${name} ${+state[name]} → ${+record.after[name]}`);
    }
    for (const access of memory.accesses) if (access.kind === "write") {
      effects.push(`Write physical $${hex(access.address, 5)} ← ${hex(access.value, 2)}${writeKind(access.address) === "ignored" ? " (ignored by this map)" : ""}`);
    }
    effects.push(`CS:IP → ${logical8088(record.after.cs, record.after.ip)} · physical $${hex(record.after.pc, 5)}`);
  }
  return { row, assembly, explanation, effects, record, blocked, external, timingUnavailable, accesses: memory.accesses,
    addressing: ordinary || !record ? explain8088Address(state, row) : [] };
}
