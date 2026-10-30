import type { Expression, Statement } from "../src/components/cpus/semantics/model.ts";
import type { FlagCondition, InstructionControlFlow, InstructionShape } from "./interactive/instruction-shape.ts";

interface Origin { readonly kind: "origin"; readonly source: "register" | "memory"; readonly field: string; readonly offset?: number }
type Known = number | boolean | FlagCondition | Origin | undefined;
const origin = (value: Known): value is Origin => typeof value === "object" && value.kind === "origin";
type Names = ReadonlyMap<string, Known>;
export class NeedsPostbyte extends Error {}
const condition = (value: Known): value is FlagCondition => typeof value === "object" && value.kind !== "origin";
const negate = (value: FlagCondition): FlagCondition => value.kind === "not" ? value.value : { kind: "not", value };

/** Track constants, branch tests, and value origins; never evaluate live registers or memory.
 * Origins identify stack effects, not concrete addresses. */
function known(value: Expression, names: Names): Known {
  const read = (value: Expression) => known(value, names);
  switch (value.kind) {
    case "literal": case "flag-literal": return value.value;
    case "value": case "flag-value": return names.get(value.name);
    case "not": { const v = read(value.value); return typeof v === "boolean" ? !v : condition(v) ? negate(v) : undefined; }
    case "and": case "or": case "xor": {
      const left = read(value.left), right = read(value.right);
      if (typeof left === "boolean" && typeof right === "boolean") return value.kind === "and" ? left && right : value.kind === "or" ? left || right : left !== right;
      if (condition(left) && condition(right)) return { kind: value.kind, left, right };
      const test = condition(left) ? left : condition(right) ? right : undefined;
      const fixed = typeof left === "boolean" ? left : typeof right === "boolean" ? right : undefined;
      if (test === undefined || fixed === undefined) return undefined;
      return value.kind === "xor" ? fixed ? negate(test) : test
        : value.kind === "and" ? fixed ? test : false : fixed ? true : test;
    }
    case "add-wrap": case "subtract": {
      const left = read(value.left), right = read(value.right);
      if (origin(left)) return { ...left, offset: left.offset !== undefined && typeof right === "number"
        ? left.offset + (value.kind === "add-wrap" ? right : -right) : undefined };
      return undefined;
    }
    case "select": { const test = read(value.condition); return typeof test === "boolean" ? read(test ? value.yes : value.no) : undefined; }
    case "bit": case "low-bit": case "zero": case "bits": case "low-byte": case "high-byte":
    case "extend": case "truncate": case "sign-extend": {
      const v = read(value.value);
      if (origin(v) && ["low-byte", "high-byte", "extend", "truncate", "sign-extend"].includes(value.kind)) return v;
      if (typeof v !== "number") return undefined;
      switch (value.kind) {
        case "bit": return Boolean(v & 2 ** value.position);
        case "low-bit": return Boolean(v & 1);
        case "zero": return v === 0;
        case "bits": return v >>> value.low & (2 ** (value.high - value.low + 1) - 1);
        case "low-byte": return v & 255;
        case "high-byte": return v >>> 8 & 255;
        case "extend": return v;
        case "truncate": return v % 2 ** value.width;
        // These folds only select instruction encodings, never compute a live effective address.
        case "sign-extend": return undefined;
      }
    }
    case "bit-and": case "bit-or": case "bit-xor": case "concat": case "equal": case "less-than": {
      const left = read(value.left), right = read(value.right);
      if (value.kind === "concat" && origin(left) && origin(right) && left.source === right.source && left.field === right.field) return left;
      if (typeof left !== "number" || typeof right !== "number") return undefined;
      switch (value.kind) {
        case "bit-and": return left & right;
        case "bit-or": return left | right;
        case "bit-xor": return left ^ right;
        case "concat": return left * 256 + right;
        case "equal": return left === right;
        case "less-than": return value.signed ? undefined : left < right;
      }
    }
    default: return undefined;
  }
}

/** Derive fetches, PC writes, and selected stack effects without running a CPU or reading memory. */
export function instructionShape(steps: readonly Statement[], opcodeBytes: number, postbyte?: number, stackRegisters: readonly string[] = []): InstructionShape {
  let fetched = 0, supported = true, flow: InstructionControlFlow = "sequential", branch: FlagCondition | undefined;
  const savedPC = new Set<string>(), returnedPC = new Set<string>(), replacedStacks = new Set<string>();
  const stores = new Map<string, number>(), advances = new Set<string>();
  const stackOrigin = (value: Known) => origin(value) && value.source === "register" && stackRegisters.includes(value.field) ? value.field : undefined;
  function transfer(next: InstructionControlFlow, test?: FlagCondition): void {
    if (flow === "unconditional" || next === "sequential") return;
    // RTI's full and short frames both restore PC, under complementary tests.
    if (flow === "conditional" && branch && test && JSON.stringify(branch) === JSON.stringify(negate(test))) {
      flow = "unconditional"; branch = undefined; return;
    }
    branch = flow === "sequential" && next === "conditional" ? test : undefined; flow = next;
  }
  function nested(body: readonly Statement[], names: Names) {
    const before = fetched, oldFlow = flow, oldBranch = branch, oldSupport = supported;
    flow = "sequential"; branch = undefined;
    walk(body, new Map(names));
    const result = { length: fetched - before, flow, branch, supported };
    fetched = before; flow = oldFlow; branch = oldBranch; supported = oldSupport;
    return result;
  }
  function walk(body: readonly Statement[], names: Map<string, Known>): void {
    for (const step of body) {
      if (!supported) return;
      switch (step.kind) {
        case "fetch-byte": names.set(step.name, fetched++ === 0 ? postbyte : undefined); break;
        case "fetch-word": names.set(step.name, undefined); fetched += 2; break;
        case "capture": names.set(step.name, known(step.value, names)); break;
        case "read-flag": names.set(step.name, { kind: "flag", name: step.flag.field }); break;
        case "read-source": {
          const inner = new Map(Object.entries(step.arguments ?? {}).map(([name, value]) => [name, known(value, names)]));
          walk(step.source.steps, inner);
          names.set(step.name, known(step.source.result, inner)); break;
        }
        case "perform": walk(step.action.steps, new Map(Object.entries(step.arguments).map(([name, value]) => [name, known(value, names)]))); break;
        case "match": case "dispatch": {
          const selector = known(step.selector, names);
          if (typeof selector !== "number") throw new NeedsPostbyte("Instruction selection needs its postbyte.");
          const selected = step.cases.find(branch => (selector & branch.mask) === branch.value);
          if (!selected) { supported = false; break; }
          const inner = new Map(names); walk(selected.steps, inner);
          if (step.kind === "match") {
            const result = step.cases.find(branch => branch === selected)!;
            names.set(step.name, known(result.result, inner));
          }
          break;
        }
        case "when": {
          const test = known(step.condition, names);
          if (test === true) { walk(step.steps, new Map(names)); break; }
          if (test === false) break;
          const inner = nested(step.steps, names);
          if (inner.length || !inner.supported) throw new NeedsPostbyte("Conditional encoding needs its postbyte.");
          if (inner.flow !== "sequential") {
            if (!condition(test)) throw new NeedsPostbyte("Conditional control transfer needs its postbyte.");
            transfer("conditional", inner.branch ? { kind: "and", left: test, right: inner.branch } : test);
          }
          break;
        }
        case "choose": {
          const test = known(step.condition, names);
          if (typeof test === "boolean") {
            const selected = test ? step.yes : step.no, inner = new Map(names); walk(selected.steps, inner);
            names.set(step.name, known(selected.result, inner)); break;
          }
          const yes = nested(step.yes.steps, names), no = nested(step.no.steps, names);
          if (yes.length !== no.length || !yes.supported || !no.supported) throw new NeedsPostbyte("Conditional layout needs its postbyte.");
          fetched += yes.length;
          transfer(yes.flow === no.flow ? yes.flow : "conditional");
          names.set(step.name, undefined); break;
        }
        case "write-register": {
          const value = known(step.value, names), field = step.register.field;
          if (field === "pc") {
            transfer("unconditional");
            if (origin(value) && value.source === "memory" && stackRegisters.includes(value.field)) returnedPC.add(value.field);
          } else if (stackRegisters.includes(field)) {
            if (stackOrigin(value) !== field) replacedStacks.add(field);
            else if (origin(value) && value.offset !== undefined && value.offset > 0) advances.add(field);
          }
          break;
        }
        case "read-register": names.set(step.name, { kind: "origin", source: "register", field: step.register.field, offset: 0 }); break;
        case "read-memory": {
          const field = stackOrigin(step.address.kind === "address-projection" ? undefined : known(step.address, names));
          names.set(step.name, field ? { kind: "origin", source: "memory", field } : undefined); break;
        }
        case "write-memory": {
          const field = stackOrigin(step.address.kind === "address-projection" ? undefined : known(step.address, names)), value = known(step.value, names);
          if (field) {
            stores.set(field, (stores.get(field) ?? 0) + 1);
            if (origin(value) && value.source === "register" && value.field === "pc") savedPC.add(field);
          }
          break;
        }
        case "read-latch": case "test-choice": names.set(step.name, undefined); break;
        case "write-latch": case "write-choice": case "update-flags": case "replace-flags": break;
        default: throw new Error(`Instruction layout does not support ${step.kind}.`);
      }
    }
  }
  walk(steps, new Map());
  // Saving PC plus a full status/register frame distinguishes entry from an ordinary call.
  // A PC loaded through an advancing stack is a return; the runtime checks the observed frame.
  const saved = [...savedPC], returned = [...returnedPC].filter(field => advances.has(field));
  if (saved.length > 1 || returned.length > 1) throw new Error("Ambiguous instruction stack transfer.");
  function transferShape(): InstructionShape["stack"] {
    if (flow !== "unconditional") return undefined;
    const pushed = saved[0], pulled = returned[0];
    if (pushed) return { flow: stores.get(pushed) === 2 ? "call" : "interrupt", register: pushed };
    if (pulled) return { flow: "stack-return", register: pulled };
  }
  const stack = transferShape();
  return { length: opcodeBytes + fetched, supported, controlFlow: flow, ...(branch && { condition: branch }),
    ...(supported && stack && { stack }), ...(supported && replacedStacks.size && { replacedStacks: [...replacedStacks] }) };
}
