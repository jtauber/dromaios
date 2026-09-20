import type { AddressExpression, Expression, FlagExpression, InstructionDefinition, NumberExpression, SourceDefinitions, Statement, ValueType, Width } from "./model.ts";
import { readSource, value } from "./model.ts";
import { defineInstruction } from "./validate.ts";
import { opcodeTable } from "../opcodes.ts";

interface CapturedValue { readonly code: string; readonly type: ValueType }
type CapturedNumber = CapturedValue & { readonly type: Width };
type Scope = ReadonlyMap<string, CapturedValue>;
type Capability = "fetchByte" | "readByte" | "writeByte" | "readPort" | "writePort" | "deferInterrupt" | "notifyReti" | "reportInterrupt" | "readTest" | "sendEscape"
  | "fetchWord" | "resolveAddress" | "commitAddressUpdates" | "readProgramByte" | "nextAddress" | "jump" | "resetDevices";

/** Compile the bounded experiment to ordinary typed statements, without executing any effects. */
export function generateInstructions(cpu: string, definitions: Readonly<Record<string, InstructionDefinition>>,
  { bindOpcodes = false, sources, state, origin = `semantics/definitions/${cpu}.ts` }: {
    bindOpcodes?: boolean | readonly number[]; sources?: SourceDefinitions;
    state?: { readonly name: string; readonly module: string }; origin?: string;
  } = {}): string {
  // Numeric definition keys are the opcode authority when generating execution bindings.
  const boundNames = new Set(bindOpcodes === true ? Object.keys(definitions) : bindOpcodes === false ? [] : bindOpcodes.map(String));
  if (bindOpcodes) opcodeTable((bindOpcodes === true ? Object.keys(definitions) : bindOpcodes).map(opcode => {
    const definition = definitions[opcode];
    if (!Object.hasOwn(definitions, opcode) || !definition) throw new Error(`Opcode ${opcode} has no instruction definition.`);
    return [Number(opcode), definition];
  }), cpu === "68000" ? 16 : 8);
  const stateType = state?.name ?? `Cpu${cpu === "z80" ? "Z80" : cpu}State`;
  const helpers = new Set<string>();
  const outcomes = new Set<string>();
  let alignmentFaults = false, targetFaults = false;
  const allCapabilities = new Set<Capability>();
  const irqDeferral = cpu === "z80" || Object.values(definitions).some(definition => definition.cpu.irqDeferral === true);
  const contextExtensions: readonly { name: string; type?: string; file: string; capabilities: readonly Capability[] }[] = [
    { name: "BytePorts", file: "port-access", capabilities: ["readPort", "writePort"] },
    { name: "InterruptDeferralContext", type: `InterruptDeferralContext${irqDeferral ? '<"irq">' : ""}`, file: "instruction-context", capabilities: ["deferInterrupt"] },
    { name: "RetiNotificationContext", file: "instruction-context", capabilities: ["notifyReti"] },
    { name: "InterruptReportContext", file: "instruction-context", capabilities: ["reportInterrupt"] },
    { name: "Cpu8088ExternalContext", file: "8088-external", capabilities: ["readTest", "sendEscape"] },
    { name: "WordInstructionContext", file: "instruction-context", capabilities: ["fetchWord"] },
    { name: "Cpu68000AddressContext", file: "68000-context", capabilities: ["resolveAddress", "commitAddressUpdates", "readProgramByte"] },
    { name: "Cpu68000ControlContext", file: "68000-context", capabilities: ["nextAddress", "jump"] },
    { name: "Cpu68000ResetContext", file: "68000-context", capabilities: ["resetDevices"] },
  ];
  const extensions = (capabilities: ReadonlySet<Capability>) => contextExtensions.filter(extension => extension.capabilities.some(name => capabilities.has(name)));
  const contextType = (capabilities: ReadonlySet<Capability>) => "ByteInstructionContext" + extensions(capabilities).map(extension => " & " + (extension.type ?? extension.name)).join("");
  function compile(name: string, input: InstructionDefinition, result?: NumberExpression): string {
    const definition = defineInstruction(input);
    if (definition.cpu.name !== cpu) throw new Error(`${name}: expected a ${cpu} definition.`);
    const lines: string[] = [];
    const capabilities = new Set<Capability>();
    const rejections = new Set<string>();
    let rejectsAlignment = false, rejectsTarget = false;
    let nextValue = 0;
    const indent = result ? "      " : "  ";
    let depth = "";
    const emit = (line: string): void => { lines.push(`${indent}  ${depth}${line}`); };
    const local = (hint: string): string => `v${nextValue++}_${hint}`;
    const helper = (name: string): string => { helpers.add(name); return name; };
    const access = (name: Capability): string => { capabilities.add(name); return `instruction.${name}`; };
    const field = (name: string): string => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) ? `.${name}` : `[${JSON.stringify(name)}]`;
    const bank = (ref: { readonly bank?: string }): string => `state${ref.bank === undefined ? "" : field(ref.bank)}`;
    const comment = (text: string): void => { emit(`// ${JSON.stringify(text)}`); };
    const reject = (reason: string): string => { rejections.add(reason); outcomes.add(reason); return `return ${JSON.stringify(reason)};`; };
    const signed = (operand: CapturedNumber): string => `((${operand.code} ^ ${2 ** (operand.type - 1)}) - ${2 ** (operand.type - 1)})`;
    const integer = (operand: CapturedNumber, isSigned: boolean): string => !isSigned ? operand.code
      : operand.type === 32 ? `(${operand.code} | 0)` : signed(operand);

    function number(expr: Expression, scope: Scope): CapturedNumber {
      switch (expr.kind) {
        case "select": {
          const yes = number(expr.yes, scope), no = number(expr.no, scope);
          return { code: `((${flag(expr.condition, scope)}) ? ${yes.code} : ${no.code})`, type: yes.type };
        }
        case "value": return scope.get(expr.name)! as CapturedNumber; // Validation has resolved names and types.
        case "literal": return { code: `0x${expr.value.toString(16)}`, type: expr.width };
        case "high-byte": return { code: `(${number(expr.value, scope).code} >>> 8)`, type: 8 };
        case "low-byte": return { code: `(${number(expr.value, scope).code} & 0xff)`, type: 8 };
        case "extend": return { code: number(expr.value, scope).code, type: expr.width };
        case "truncate": return { code: `(${number(expr.value, scope).code} & 0x${(2 ** expr.width - 1).toString(16)})`, type: expr.width };
        case "sign-extend": {
          const operand = number(expr.value, scope);
          return { code: expr.width === 32 ? `(${signed(operand)} >>> 0)` : `(${signed(operand)} & ${2 ** expr.width - 1})`, type: expr.width };
        }
        case "shift-left": case "shift-right": {
          const operand = number(expr.value, scope), operation = helper(expr.kind === "shift-left" ? "shiftLeft" : "shiftRight");
          return { code: `${operation}(${operand.type}, ${operand.code}, (${flag(expr.incoming, scope)}) ? 1 : 0).result`, type: operand.type };
        }
        case "shift-bits": {
          const operand = number(expr.value, scope);
          return { code: expr.count === 32 ? "0" : expr.direction === "right" ? `(${operand.code} >>> ${expr.count})`
            : operand.type === 32 ? `((${operand.code} << ${expr.count}) >>> 0)`
            : `((${operand.code} << ${expr.count}) & 0x${(2 ** operand.type - 1).toString(16)})`, type: operand.type };
        }
        case "bit-and": case "bit-or": case "bit-xor": {
          const left = number(expr.left, scope), right = number(expr.right, scope);
          const operator = { "bit-and": "&", "bit-or": "|", "bit-xor": "^" }[expr.kind];
          const code = `(${left.code} ${operator} ${right.code})`;
          return { code: left.type === 32 ? `(${code} >>> 0)` : code, type: left.type };
        }
        case "concat": {
          const high = number(expr.left, scope), low = number(expr.right, scope);
          return high.type === 8 ? { code: `((${high.code} << 8) | ${low.code})`, type: 16 }
            : { code: `(${high.code} * 0x10000 + ${low.code})`, type: 32 };
        }
        case "multiply": {
          const left = number(expr.left, scope), right = number(expr.right, scope), width = left.type === 8 ? 16 : 32;
          const product = `(${integer(left, expr.signed ?? false)} * ${integer(right, expr.signed ?? false)})`;
          return { code: expr.signed ? `(${product} ${width === 32 ? ">>> 0" : "& 0xffff"})` : product, type: width };
        }
        case "subtract": case "add-wrap": {
          const left = number(expr.left, scope), right = number(expr.right, scope);
          const operation = helper(expr.kind === "subtract" ? "subtract" : "add");
          return { code: `${operation}(${left.type}, ${left.code}, ${right.code}${incoming(expr.incoming, scope)}).result`, type: left.type };
        }
        default: throw new Error("Expected a validated numeric expression.");
      }
    }
    function incoming(expr: FlagExpression | undefined, scope: Scope): string {
      return expr === undefined ? "" : `, (${flag(expr, scope)}) ? 1 : 0`;
    }
    function flag(expr: Expression, scope: Scope): string {
      switch (expr.kind) {
        case "flag-value": return scope.get(expr.name)!.code;
        case "flag-literal": return String(expr.value);
        case "not": return `!(${flag(expr.value, scope)})`;
        case "xor": return `(${flag(expr.left, scope)}) !== (${flag(expr.right, scope)})`;
        case "or": return `(${flag(expr.left, scope)}) || (${flag(expr.right, scope)})`;
        case "and": return `(${flag(expr.left, scope)}) && (${flag(expr.right, scope)})`;
        case "negative": case "low-bit": case "zero": case "even-parity": {
          const value = number(expr.value, scope);
          if (expr.kind === "negative" || expr.kind === "low-bit") return `(${value.code} & 0x${(expr.kind === "low-bit" ? 1 : 2 ** (value.type - 1)).toString(16)}) !== 0`;
          if (expr.kind === "zero") return `${value.code} === 0`;
          return `${helper("evenParity8")}(${value.code})`;
        }
        case "borrow": case "half-borrow": case "subtract-overflow": case "carry": case "half-carry": case "add-overflow": {
          const left = number(expr.left, scope), right = number(expr.right, scope);
          const property = { borrow: "borrow", "half-borrow": "halfBorrow", "subtract-overflow": "overflow",
            carry: "carry", "half-carry": "halfCarry", "add-overflow": "overflow" }[expr.kind];
          const operation = ["carry", "half-carry", "add-overflow"].includes(expr.kind) ? "add" : "subtract";
          return `${helper(operation)}(${left.type}, ${left.code}, ${right.code}${incoming(expr.incoming, scope)}).${property}`;
        }
        default: throw new Error("Expected a validated flag expression.");
      }
    }
    function address(expr: AddressExpression, scope: Scope): string {
      return expr.kind === "address-projection"
        ? `((${number(expr.base, scope).code} * ${2 ** expr.baseShift} + ${number(expr.offset, scope).code}) % ${2 ** expr.addressBits})`
        : number(expr, scope).code;
    }
    function body(steps: readonly Statement[], scope: Map<string, CapturedValue>): void {
      for (const step of steps) {
        let captured: CapturedValue;
        switch (step.kind) {
          case "perform": {
            comment(`Action: ${step.action.name}`);
            const actionScope = new Map<string, CapturedValue>();
            for (const name of Object.keys(step.action.inputs ?? {})) {
              const argument = number(step.arguments[name]!, scope), captured = local(name);
              emit(`const ${captured}: number = ${argument.code};`);
              actionScope.set(name, { code: captured, type: argument.type });
            }
            body(step.action.steps, actionScope);
            continue;
          }
          case "when":
            emit(`if (${flag(step.condition, scope)}) {`);
            depth += "  ";
            body(step.steps, new Map(scope));
            depth = depth.slice(0, -2);
            emit("}");
            continue;
          case "iterate": {
            const count = local("count"), current = local(step.name), index = local("iteration");
            const initial = number(step.initial, scope), inner = new Map(scope);
            emit(`const ${count} = ${number(step.count, scope).code};`);
            emit(`let ${current} = ${initial.code};`);
            emit(`for (let ${index} = 0; ${index} < ${count}; ${index}++) {`);
            depth += "  ";
            inner.set(step.name, { code: current, type: initial.type });
            body(step.steps, inner);
            emit(`${current} = ${number(step.result, inner).code};`);
            depth = depth.slice(0, -2);
            emit("}");
            scope.set(step.name, { code: current, type: initial.type });
            continue;
          }
          case "iterate-together": {
            const count = local("count"), index = local("iteration"), inner = new Map(scope);
            const expression = (expr: Expression, type: ValueType, names: Scope) => type === "flag" ? flag(expr, names) : number(expr, names).code;
            emit(`const ${count} = ${number(step.count, scope).code};`);
            const entries = Object.entries(step.values).map(([name, item]) => {
              const code = local(name);
              emit(`let ${code}: ${item.type === "flag" ? "boolean" : "number"} = ${expression(item.initial, item.type, scope)};`);
              inner.set(name, { code, type: item.type });
              return { name, code, type: item.type, next: item.next };
            });
            emit(`for (let ${index} = 0; ${index} < ${count}; ${index}++) {`);
            depth += "  ";
            body(step.steps, inner);
            const updates = entries.map(item => {
              const next = local("next");
              emit(`const ${next}: ${item.type === "flag" ? "boolean" : "number"} = ${expression(item.next, item.type, inner)};`);
              return `${item.code} = ${next};`;
            });
            updates.forEach(emit);
            depth = depth.slice(0, -2);
            emit("}");
            for (const item of entries) scope.set(item.name, { code: item.code, type: item.type });
            continue;
          }
          case "reject": emit(reject(step.reason)); continue;
          case "divide": {
            const dividend = number(step.dividend, scope), divisor = number(step.divisor, scope);
            const left = local("dividend"), right = local("divisor"), quotient = local("quotient");
            const modulus = 2 ** divisor.type, limit = step.signed ? modulus / 2 : modulus;
            emit(`const ${left} = ${integer(dividend, step.signed)};`);
            emit(`const ${right}: number = ${integer(divisor, step.signed)};`);
            emit(`const ${quotient} = Math.trunc(${left} / ${right});`);
            const overflow = `${quotient} < ${step.signed ? -limit : 0} || ${quotient} >= ${limit}`;
            emit(`if (${right} === 0${step.overflow === undefined ? ` || ${overflow}` : ""}) ${reject(step.onError)}`);
            if (step.overflow !== undefined) {
              const code = local(step.overflow);
              emit(`const ${code} = ${overflow};`);
              scope.set(step.overflow, { code, type: "flag" });
            }
            for (const [name, code] of [[step.quotient, quotient], [step.remainder, `(${left} % ${right})`]] as const) {
              const captured = local(name);
              emit(`const ${captured} = ${code} & ${modulus - 1};`);
              scope.set(name, { code: captured, type: divisor.type });
            }
            continue;
          }
          case "capture": captured = number(step.value, scope); break;
          case "read-register": captured = { code: `${bank(step.register)}${field(step.register.field)}`, type: step.register.width }; break;
          case "read-element": captured = { code: `state${field(step.array.field)}[${number(step.index, scope).code}]!`, type: step.array.width }; break;
          case "read-flag": captured = { code: `state.flags${field(step.flag.field)}`, type: "flag" }; break;
          case "test-choice": captured = { code: `state${field(step.choice.field)} === ${JSON.stringify(step.value)}`, type: "flag" }; break;
          case "read-latch": captured = { code: `state${field(step.latch.field)}`, type: "flag" }; break;
          case "exchange-flags": {
            const right = local("rightFlags"), left = local("leftFlags");
            emit(`const ${right} = ${bank(step.right)}.flags;`);
            emit(`const ${left} = ${bank(step.left)}.flags;`);
            emit(`${bank(step.left)}.flags = ${right};`);
            emit(`${bank(step.right)}.flags = ${left};`);
            continue;
          }
          case "fetch-byte": captured = { code: `${access("fetchByte")}()`, type: 8 }; break;
          case "fetch-word": captured = { code: `${access("fetchWord")}()`, type: 16 }; break;
          case "read-next-address": captured = { code: `${access("nextAddress")}()`, type: 32 }; break;
          case "select-target": emit(`${access("jump")}(${number(step.address, scope).code});`); continue;
          case "resolve-address": captured = { code: `${access("resolveAddress")}(${step.size}, ${number(step.mode, scope).code}, ${number(step.code, scope).code})`, type: 32 }; break;
          case "commit-address-updates": emit(`${access("commitAddressUpdates")}();`); continue;
          case "alignment-fault":
            if (step.operation === "fetch") targetFaults = rejectsTarget = true;
            else alignmentFaults = rejectsAlignment = true;
            emit(`return { operation: ${JSON.stringify(step.operation)}, address: ${number(step.address, scope).code}${step.operation === "read" ? `, programSpace: ${step.space === "program"}` : ""} };`);
            continue;
          case "read-program-memory": captured = { code: `${access("readProgramByte")}(${number(step.address, scope).code})`, type: 8 }; break;
          case "read-port": captured = { code: `${access("readPort")}(${number(step.port, scope).code})`, type: 8 }; break;
          case "read-memory": captured = { code: `${access("readByte")}(${address(step.address, scope)})`, type: 8 }; break;
          case "read-source": {
            comment(`Source: ${step.source.name}`);
            const sourceScope = new Map<string, CapturedValue>();
            body(step.source.steps, sourceScope);
            captured = number(step.source.result, sourceScope);
            break;
          }
          case "write-register": emit(`${bank(step.register)}${field(step.register.field)} = ${number(step.value, scope).code};`); continue;
          case "write-element": emit(`state${field(step.array.field)}[${number(step.index, scope).code}] = ${number(step.value, scope).code};`); continue;
          case "fill-array": emit(`state${field(step.array.field)}.fill(${number(step.value, scope).code});`); continue;
          case "write-latch": emit(`state${field(step.latch.field)} = ${typeof step.value === "boolean" ? step.value : flag(step.value, scope)};`); continue;
          case "read-test": captured = { code: `${access("readTest")}()`, type: "flag" }; break;
          case "report-interrupt": emit(`${access("reportInterrupt")}(${number(step.vector, scope).code});`); continue;
          case "send-escape": {
            const memory = step.memory;
            const operand = memory ? `{ segment: ${number(memory.segment, scope).code}, offset: ${number(memory.offset, scope).code}, address: ${address(memory.address, scope)}, value: ${number(memory.value, scope).code} }` : "null";
            emit(`${access("sendEscape")}({ opcode: ${number(step.opcode, scope).code}, modRM: ${number(step.modRM, scope).code}, memory: ${operand} });`);
            continue;
          }
          case "notify-reti": emit(`${access("notifyReti")}();`); continue;
          case "reset-devices": emit(`${access("resetDevices")}();`); continue;
          case "write-choice": emit(`state${field(step.choice.field)} = ${JSON.stringify(step.value)};`); continue;
          case "defer-interrupt": emit(`${access("deferInterrupt")}(${JSON.stringify(step.scope)});`); continue;
          case "write-port": emit(`${access("writePort")}(${number(step.port, scope).code}, ${number(step.value, scope).code});`); continue;
          case "write-memory": emit(`${access("writeByte")}(${address(step.address, scope)}, ${number(step.value, scope).code});`); continue;
          case "update-flags": case "replace-flags": {
            comment(`Flags: ${step.policy.name}; ${step.kind === "replace-flags" ? "replace flag object" : "preserve unlisted flags"}`);
            // Arguments are pure expressions in the caller's scope. Evaluate once, before the policy.
            const parameters = new Map<string, CapturedValue>();
            for (const name of Object.keys(step.policy.parameters)) {
              const expr = step.arguments[name]!;
              const argument = step.policy.parameters[name] === "flag" ? { code: flag(expr, scope), type: "flag" as const } : number(expr, scope);
              const code = local(name);
              emit(`const ${code} = ${argument.code};`);
              parameters.set(name, { code, type: argument.type });
            }
            // Compute every right-hand side before making any of the flag assignments.
            const updates = step.policy.updates.map(update => {
              const code = local("flag");
              emit(`const ${code} = ${flag(update.value, parameters)};`);
              return { field: update.flag.field, code };
            });
            if (step.kind === "replace-flags") emit(`state.flags = { ${updates.map(update => `[${JSON.stringify(update.field)}]: ${update.code}`).join(", ")} };`);
            else for (const update of updates) emit(`state.flags${field(update.field)} = ${update.code};`);
            continue;
          }
        }
        const code = local(step.name);
        emit(`const ${code} = ${captured.code};`);
        scope.set(step.name, { code, type: captured.type });
      }
    }
    const scope = new Map<string, CapturedValue>();
    const parameters = result ? [] : [`state: ${stateType}`];
    const bound = !result && boundNames.has(name);
    for (const [name, type] of Object.entries(definition.inputs ?? {})) {
      if (bound) throw new Error(`${definition.name}: opcode bindings cannot supply instruction inputs.`);
      const code = local(name);
      parameters.push(`${code}: number`);
      scope.set(name, { code, type });
    }
    body(definition.steps, scope);
    if (result) emit(`return ${number(result, scope).code};`);
    for (const name of capabilities) allCapabilities.add(name);
    if (capabilities.size) parameters.push(`instruction: Pick<${contextType(capabilities)}, ${[...capabilities].map(name => JSON.stringify(name)).join(" | ")}>`);
    const key = bound ? `0x${Number(name).toString(16).padStart(2, "0")}` : JSON.stringify(name);
    return `${indent}// ${JSON.stringify(`${cpu} ${definition.name}`)}\n`
      + `${indent}${key}(${parameters.join(", ")}): ${result ? "number" : ["void", ...[...rejections].map(reason => JSON.stringify(reason)), ...(rejectsAlignment ? ["OperandAlignmentFault"] : []), ...(rejectsTarget ? ["TargetAlignmentFault"] : [])].join(" | ")} {\n${lines.join("\n")}\n${indent}},`;
  }
  const methods = Object.entries(definitions).map(([name, definition]) => compile(name, definition));
  const readers = sources ? Object.entries(sources.groups).map(([group, members]) => {
    const methods = Object.entries(members).map(([name, source]) => compile(name, {
      cpu: sources.cpu, name: source.name, explanation: "Reusable value source.", steps: [readSource("result", source)],
    }, value("result")));
    return `    [${JSON.stringify(group)}]: {\n${methods.join("\n\n")}\n    },`;
  }) : [];
  const imports = [`import type { ${stateType} } from ${JSON.stringify(state?.module ?? `../state/${cpu}.ts`)};`];
  if (bindOpcodes || allCapabilities.size) imports.push('import type { ByteInstructionContext } from "../instruction-context.ts";');
  for (const extension of extensions(allCapabilities)) imports.push(`import type { ${extension.name} } from "../${extension.file}.ts";`);
  if (alignmentFaults) imports.push('import type { OperandAlignmentFault } from "../68000-context.ts";');
  if (targetFaults) imports.push('import type { TargetAlignmentFault } from "../68000-context.ts";');
  if (bindOpcodes) imports.push('import type { OpcodeEntry } from "../opcodes.ts";');
  if (helpers.size) imports.push(`import { ${[...helpers].sort().join(", ")} } from "../alu.ts";`);
  const boundContext = contextType(allCapabilities);
  const outcome = ["void", ...[...outcomes].map(reason => JSON.stringify(reason)), ...(alignmentFaults ? ["OperandAlignmentFault"] : []), ...(targetFaults ? ["TargetAlignmentFault"] : [])].join(" | ");
  const executeType = `(state: ${stateType}, instruction: ${boundContext}) => ${outcome}`;
  // A selected inventory can coexist with named helpers that require decoded inputs.
  const bindings = bindOpcodes === true
    ? `  return Object.entries(instructions).map(([opcode, execute]: [string, ${executeType}]) =>\n`
      + "    [Number(opcode), instruction => execute(state, instruction)]);"
    : [
      `  const entries: readonly OpcodeEntry<${executeType}>[] = [`,
      ...[...boundNames].map(name => `    [0x${Number(name).toString(16)}, instructions[${JSON.stringify(name)}]],`),
      "  ];", "  return entries.map(([opcode, execute]) => [opcode, instruction => execute(state, instruction)]);",
    ].join("\n");
  return `// Generated by scripts/generate-cpu-semantics.ts; edit ${origin} instead.\n`
    + `${imports.join("\n")}\n\nexport const instructions = {\n${methods.join("\n\n")}\n};\n`
    + (sources ? `\n/** Bind reusable sources; fetching and memory access occur only when a reader is called. */
export function sourceReaders(state: ${stateType}) {
  return {\n${readers.join("\n")}\n  };
}\n` : "")
    + (bindOpcodes ? `
/** Bind this CPU instance's state without performing any instruction effects. */
export function opcodeEntries(state: ${stateType}): readonly OpcodeEntry<(instruction: ${boundContext}) => ${outcome}>[] {
${bindings}
}
` : "");
}
