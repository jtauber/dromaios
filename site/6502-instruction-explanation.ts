import type { Expression, InstructionDefinition, Statement } from "../src/components/cpus/semantics/model.ts";

/** Presentation of the chapter's data flow, never another implementation of its arithmetic. */
export function instructionExplanation6502(definition: InstructionDefinition) {
  const registers = new Set<string>(), flags = new Set<string>(), calculations: string[] = [];
  function accessOrder(steps: readonly Statement[]): ("fetch" | "read" | "write")[] {
    const accesses: ("fetch" | "read" | "write")[] = [];
    for (const step of steps) {
      if (step.kind === "read-source") accesses.push(...accessOrder(step.source.steps));
      else if (step.kind === "perform") accesses.push(...accessOrder(step.action.steps));
      else if (step.kind === "choose") {
        const yes = accessOrder(step.yes.steps), no = accessOrder(step.no.steps);
        if (yes.join() !== no.join()) throw new Error("Conditional 6502 bus accesses need a path-aware explanation.");
        accesses.push(...yes);
      } else if (step.kind === "when") {
        if (accessOrder(step.steps).length) throw new Error("Conditional 6502 bus accesses need a path-aware explanation.");
      } else if (step.kind === "fetch-word") accesses.push("fetch", "fetch");
      else if (step.kind === "fetch-byte" || step.kind === "read-memory" || step.kind === "write-memory") {
        accesses.push(step.kind === "fetch-byte" ? "fetch" : step.kind === "read-memory" ? "read" : "write");
      }
    }
    return accesses;
  }
  function expression(value: Expression, names: ReadonlyMap<string, string>): string {
    const show = (value: Expression) => expression(value, names);
    switch (value.kind) {
      case "value": case "flag-value": return names.get(value.name) ?? value.name;
      case "literal": return `$${value.value.toString(16).toUpperCase().padStart(Math.ceil(value.width / 4), "0")}`;
      case "flag-literal": return String(+value.value);
      case "select": return `(${show(value.condition)} ? ${show(value.yes)} : ${show(value.no)})`;
      case "not": return `not(${show(value.value)})`;
      case "add-wrap": case "subtract": return `(${show(value.left)} ${value.kind === "add-wrap" ? "+" : "−"} ${show(value.right)}${value.incoming ? ` ${value.kind === "add-wrap" ? "+" : "−"} ${show(value.incoming)}` : ""})`;
      case "bit-and": case "bit-or": case "bit-xor": case "and": case "or": case "xor":
        return `(${show(value.left)} ${{ "bit-and": "AND", "bit-or": "OR", "bit-xor": "XOR", and: "AND", or: "OR", xor: "XOR" }[value.kind]} ${show(value.right)})`;
      case "concat": return `word(${show(value.left)}, ${show(value.right)})`;
      case "extend": return show(value.value);
      case "truncate": return `low${value.width}(${show(value.value)})`;
      case "sign-extend": return `signed(${show(value.value)})`;
      case "high-byte": return `high(${show(value.value)})`;
      case "low-byte": return `low(${show(value.value)})`;
      case "zero": return `${show(value.value)} = 0`;
      case "negative": return `top bit of ${show(value.value)}`;
      case "low-bit": return `low bit of ${show(value.value)}`;
      case "bit": return `bit ${value.position} of ${show(value.value)}`;
      case "shift-left": case "shift-right": return `${value.kind === "shift-left" ? "shiftLeft" : "shiftRight"}(${show(value.value)}, incoming ${show(value.incoming)})`;
      case "borrow": case "carry": case "subtract-overflow": case "add-overflow":
        return `${value.kind}(${show(value.left)}, ${show(value.right)}${value.incoming ? `, ${show(value.incoming)}` : ""})`;
      case "less-than": return `${show(value.left)} < ${show(value.right)}`;
      case "equal": return `${show(value.left)} = ${show(value.right)}`;
      case "bits": return `bits ${value.high}…${value.low} of ${show(value.value)}`;
      case "with-bits": return `${show(value.value)} with bits ${value.high}…${value.low} = ${show(value.replacement)}`;
      case "pack": return `status[${value.bits.map(show).join(" ")}]`;
      default: throw new Error(`6502 explanation does not support ${value.kind}.`);
    }
  }
  function body(steps: readonly Statement[], names: Map<string, string>, prefix = ""): void {
    const show = (value: Expression) => expression(value, names);
    const emit = (text: string) => calculations.push(prefix + text);
    for (const step of steps) switch (step.kind) {
      case "read-register": emit(`${step.name} = ${step.register.field.toUpperCase()}`); names.set(step.name, step.name); break;
      case "read-flag": emit(`${step.name} = ${step.flag.field.toUpperCase()}`); names.set(step.name, step.name); break;
      case "fetch-byte": emit(`${step.name} = next byte`); names.set(step.name, step.name); break;
      case "fetch-word": emit(`${step.name} = next word`); names.set(step.name, step.name); break;
      case "perform": {
        const parameters = new Map(Object.entries(step.arguments).map(([name, value]) => [name, show(value)]));
        body(step.action.steps, parameters, prefix); break;
      }
      case "choose": {
        for (const [condition, branch] of [[show(step.condition), step.yes], [`not(${show(step.condition)})`, step.no]] as const) {
          const inner = new Map(names), heading = `${prefix}If ${condition}: `;
          body(branch.steps, inner, heading);
          calculations.push(`${heading}${step.name} = ${expression(branch.result, inner)}`);
        }
        names.set(step.name, step.name); break;
      }
      case "read-source": {
        // Address and operand sources already have chapter-owned, human-readable names.
        emit(`${step.name} = ${step.source.name}`); names.set(step.name, step.name);
        // Stack sources can write SP: collect their effects as well as the returned value.
        collectWrites(step.source.steps);
        break;
      }
      case "read-memory": emit(`${step.name} = memory[${step.address.kind === "address-projection" ? "address" : show(step.address)}]`); names.set(step.name, step.name); break;
      case "capture": {
        const value = show(step.value);
        // Retain useful named intermediates instead of expanding an unreadable decimal formula.
        if (value.length > 55) { emit(`${step.name} = ${value}`); names.set(step.name, step.name); }
        else names.set(step.name, value);
        break;
      }
      case "write-register": registers.add(step.register.field); emit(`${step.register.field.toUpperCase()} ← ${show(step.value)}`); break;
      case "write-memory": emit(`memory[${step.address.kind === "address-projection" ? "address" : show(step.address)}] ← ${show(step.value)}`); break;
      case "update-flags": case "replace-flags": {
        const parameters = new Map(Object.entries(step.arguments).map(([name, value]) => [name, show(value)]));
        for (const update of step.policy.updates) {
          flags.add(update.flag.field);
          emit(`${update.flag.field.toUpperCase()} ← ${expression(update.value, parameters)}`);
        }
        break;
      }
      case "when": body(step.steps, new Map(names), `${prefix}If ${show(step.condition)}: `); break;
      default: throw new Error(`6502 explanation does not support ${step.kind}.`);
    }
  }
  function collectWrites(steps: readonly Statement[]): void {
    for (const step of steps) {
      if (step.kind === "write-register") registers.add(step.register.field);
      if (step.kind === "read-source") collectWrites(step.source.steps);
      if (step.kind === "perform") collectWrites(step.action.steps);
      if (step.kind === "when") collectWrites(step.steps);
      if (step.kind === "choose") { collectWrites(step.yes.steps); collectWrites(step.no.steps); }
      if (step.kind === "update-flags" || step.kind === "replace-flags") for (const update of step.policy.updates) flags.add(update.flag.field);
    }
  }
  body(definition.steps, new Map());
  const accesses = ["fetch" as const, ...accessOrder(definition.steps)];
  return { explanation: definition.explanation, calculations, accesses, writes: { registers: [...registers], flags: [...flags] } };
}
