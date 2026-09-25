import type { AddressExpression, Expression, FlagExpression, InstructionDefinition, SourceDefinitions, Statement, ValueType, Width } from "./model.ts";
import { flagValue, readSource, value } from "./model.ts";
import { defineInstruction } from "./validate.ts";
import { generatePageBindings } from "./generate-pages.ts";
import { opcodePageLayouts } from "./opcode-pages.ts";
import type { OpcodePage } from "./opcode-pages.ts";
import { opcodeTable } from "../opcodes.ts";
import type { OpcodeEntry } from "../opcodes.ts";

interface CapturedValue { readonly code: string; readonly type: ValueType }
type CapturedNumber = CapturedValue & { readonly type: Width };
const typeName = (type: ValueType): string => type === "flag" ? "boolean" : "number";
type Scope = ReadonlyMap<string, CapturedValue>;
type Capability = "fetchByte" | "readByte" | "writeByte" | "readPort" | "writePort" | "deferInterrupt" | "notifyReti" | "reportInterrupt" | "readTest" | "sendEscape"
  | "fetchWord" | "resolveAddress" | "commitAddressUpdates" | "readProgramByte" | "nextAddress" | "jump" | "resetDevices" | "readPendingRegister" | "stageRegister";

/** Compile the bounded experiment to ordinary typed statements, without executing any effects. */
export function generateInstructions(cpu: string, definitions: Readonly<Record<string, InstructionDefinition>>,
  { opcodeBits = 8, bindOpcodes = false, opcodeAliases = [], pages = {}, sources, state, origin = `semantics/definitions/${cpu}.ts` }: {
    opcodeBits?: 8 | 16 | 24; bindOpcodes?: boolean | readonly number[]; opcodeAliases?: readonly OpcodeEntry<string>[]; pages?: Readonly<Record<string, OpcodePage>>; sources?: SourceDefinitions;
    state?: { readonly name: string; readonly module: string }; origin?: string;
  } = {}): string {
  // Numeric definition keys are the opcode authority when generating execution bindings.
  const boundNames = new Set(bindOpcodes === true ? Object.keys(definitions) : bindOpcodes === false ? [] : bindOpcodes.map(String));
  const prefixes = opcodePageLayouts(pages);
  if (prefixes.length && !bindOpcodes) throw new Error("Opcode pages require execution bindings.");
  const prefixBytes = new Set(prefixes.map(page => page.key));
  if ([...boundNames].some(name => prefixBytes.has(Number(name)))) throw new Error("Duplicate or colliding opcode page prefix.");
  if (bindOpcodes) opcodeTable((bindOpcodes === true ? Object.keys(definitions) : bindOpcodes).map(opcode => {
    const definition = definitions[opcode];
    if (!Object.hasOwn(definitions, opcode) || !definition) throw new Error(`Opcode ${opcode} has no instruction definition.`);
    if (prefixes.length && Number(opcode) > 255 && !prefixBytes.has(Number(opcode) >>> 8)) throw new Error(`Opcode ${opcode} has no declared page.`);
    return [Number(opcode), definition];
  }), prefixes.some(page => page.on) ? 24 : prefixes.length ? 16 : opcodeBits);
  opcodeTable(opcodeAliases.map(([opcode, name]) => {
    if (!Object.hasOwn(definitions, name)) throw new Error(`Opcode alias ${opcode} has no definition ${name}.`);
    return [opcode, name];
  }), opcodeBits);
  const stateType = state?.name ?? "StoredState";
  const helpers = new Set<string>();
  const outcomes = new Set<string>();
  let alignmentFaults = false, targetFaults = false;
  const allCapabilities = new Set<Capability>();
  // Decoders are shared generated functions; ordinary straight-line sources still inline.
  const decoders = new Map<string, { key: string; code: string; capabilities: Set<Capability> }>();
  const irqDeferral = Object.values(definitions).some(definition => definition.cpu.irqDeferral === true);
  const contextExtensions: readonly { name: string; type?: string; file: string; capabilities: readonly Capability[] }[] = [
    { name: "BytePorts", file: "port-access", capabilities: ["readPort", "writePort"] },
    { name: "InterruptDeferralContext", type: `InterruptDeferralContext${irqDeferral ? '<"irq">' : ""}`, file: "instruction-context", capabilities: ["deferInterrupt"] },
    { name: "RetiNotificationContext", file: "instruction-context", capabilities: ["notifyReti"] },
    { name: "InterruptReportContext", file: "instruction-context", capabilities: ["reportInterrupt"] },
    { name: "CoprocessorContext", file: "coprocessor-access", capabilities: ["readTest", "sendEscape"] },
    { name: "WordInstructionContext", file: "instruction-context", capabilities: ["fetchWord"] },
    { name: "WordAddressContext", file: "word-execution", capabilities: ["resolveAddress", "commitAddressUpdates", "readProgramByte"] },
    { name: "WordControlContext", file: "word-execution", capabilities: ["nextAddress", "jump"] },
    { name: "DeviceResetContext", file: "word-execution", capabilities: ["resetDevices"] },
    { name: "RegisterUpdateContext", file: "register-updates", capabilities: ["readPendingRegister", "stageRegister"] },
  ];
  const extensions = (capabilities: ReadonlySet<Capability>) => contextExtensions.filter(extension => extension.capabilities.some(name => capabilities.has(name)));
  const contextType = (capabilities: ReadonlySet<Capability>) => "ByteInstructionContext" + extensions(capabilities).map(extension => " & " + (extension.type ?? extension.name)).join("");
  function compile(name: string, input: InstructionDefinition, result?: { readonly value: Expression; readonly type: ValueType },
    decoderCapabilities?: Set<Capability>): string {
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
    // The encoded path distinguishes root fields from equally named fields in groups.
    const registerKeyLiteral = (ref: { readonly bank?: string; readonly field: string }): string => JSON.stringify(JSON.stringify([ref.bank ?? null, ref.field]));
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
        case "pack": {
          // Disjoint positive weights also keep bit 31 unsigned, without host bitwise coercion.
          const terms = expr.bits.map((bit, index) => `((${flag(bit, scope)}) ? 0x${(2 ** (expr.width - index - 1)).toString(16)} : 0)`);
          return { code: `(${terms.join(" + ")})`, type: expr.width };
        }
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
    function evaluated(expr: Expression, type: ValueType | undefined, scope: Scope): CapturedValue {
      return type === "flag" ? { code: flag(expr, scope), type } : number(expr, scope);
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
        case "bit": return `(${number(expr.value, scope).code} & 0x${(2 ** expr.position).toString(16)}) !== 0`;
        case "negative": case "low-bit": case "zero": case "even-parity": {
          const value = number(expr.value, scope);
          if (expr.kind === "negative" || expr.kind === "low-bit") return `(${value.code} & 0x${(expr.kind === "low-bit" ? 1 : 2 ** (value.type - 1)).toString(16)}) !== 0`;
          if (expr.kind === "zero") return `${value.code} === 0`;
          return `${helper("evenParity8")}(${value.code})`;
        }
        case "equal": case "less-than": {
          const left = number(expr.left, scope), right = number(expr.right, scope);
          return expr.kind === "equal" ? `${left.code} === ${right.code}`
            : `${integer(left, expr.signed)} < ${integer(right, expr.signed)}`;
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
          case "dispatch": case "match": {
            const selector = local("selector"), result = step.kind === "match" ? local(step.name) : undefined;
            emit(`const ${selector} = ${number(step.selector, scope).code};`);
            if (step.kind === "match") emit(`let ${result}: ${typeName(step.type)};`);
            for (const [index, branch] of step.cases.entries()) {
              emit(`${index ? "else " : ""}if ((${selector} & 0x${branch.mask.toString(16)}) === 0x${branch.value.toString(16)}) {`);
              depth += "  ";
              const inner = new Map(scope);
              body(branch.steps, inner);
              if (step.kind === "match") emit(`${result} = ${evaluated(step.cases[index]!.result, step.type, inner).code};`);
              depth = depth.slice(0, -2); emit("}");
            }
            emit(`else { ${reject("unsupported")} }`);
            if (step.kind === "match") scope.set(step.name, { code: result!, type: step.type });
            continue;
          }
          case "perform": {
            comment(`Action: ${step.action.name}`);
            const actionScope = new Map<string, CapturedValue>();
            for (const [name, type] of Object.entries(step.action.inputs ?? {})) {
              const argument = evaluated(step.arguments[name]!, type, scope), captured = local(name);
              emit(`const ${captured}: ${typeName(argument.type)} = ${argument.code};`);
              actionScope.set(name, { code: captured, type: argument.type });
            }
            body(step.action.steps, actionScope);
            continue;
          }
          case "choose": {
            const result = local(step.name);
            emit(`let ${result}: ${typeName(step.type)};`);
            emit(`if (${flag(step.condition, scope)}) {`);
            for (const [index, branch] of [step.yes, step.no].entries()) {
              if (index) emit("} else {");
              depth += "  ";
              const inner = new Map(scope);
              body(branch.steps, inner);
              emit(`${result} = ${evaluated(branch.result, step.type, inner).code};`);
              depth = depth.slice(0, -2);
            }
            emit("}");
            scope.set(step.name, { code: result, type: step.type });
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
          case "capture": captured = evaluated(step.value, step.type, scope); break;
          case "read-register": captured = { code: `${bank(step.register)}${field(step.register.field)}`, type: step.register.width }; break;
          case "read-pending-register": captured = { code: `${access("readPendingRegister")}(${registerKeyLiteral(step.register)}, () => ${bank(step.register)}${field(step.register.field)})`, type: step.register.width }; break;
          case "stage-register":
            emit(`${access("stageRegister")}(${registerKeyLiteral(step.register)}, ${number(step.value, scope).code}, value => { ${bank(step.register)}${field(step.register.field)} = value; });`); continue;
          case "read-element": captured = { code: `${bank(step.array)}${field(step.array.field)}[${number(step.index, scope).code}]!`, type: step.array.width }; break;
          case "read-flag": captured = { code: `${bank(step.flag)}.flags${field(step.flag.field)}`, type: "flag" }; break;
          case "test-choice": captured = { code: `${bank(step.choice)}${field(step.choice.field)} === ${JSON.stringify(step.value)}`, type: "flag" }; break;
          case "read-latch": captured = { code: `${bank(step.latch)}${field(step.latch.field)}`, type: "flag" }; break;
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
            if (step.source.steps.some(step => step.kind === "match")) {
              const identity = JSON.stringify(step.source);
              let decoder = decoders.get(identity);
              if (!decoder) {
                decoder = { key: `decode${decoders.size}`, code: "", capabilities: new Set<Capability>() };
                decoders.set(identity, decoder);
                decoder.code = compile(decoder.key, { cpu: definition.cpu, name: step.source.name,
                  explanation: "Reusable byte decoding.", ...(step.source.inputs ? { inputs: step.source.inputs } : {}), steps: step.source.steps }, { value: step.source.result, type: step.source.type }, decoder.capabilities);
              }
              for (const capability of decoder.capabilities) capabilities.add(capability);
              rejections.add("unsupported"); outcomes.add("unsupported");
              const decoded = local("decoded");
              const args = Object.entries(step.source.inputs ?? {}).map(([name, type]) => evaluated(step.arguments![name]!, type, scope).code);
              emit(`const ${decoded} = decoders.${decoder.key}(state${args.map(arg => `, ${arg}`).join("")}${decoder.capabilities.size ? ", instruction" : ""});`);
              emit(`if (${decoded} === "unsupported") return ${decoded};`);
              captured = { code: decoded, type: step.source.type };
              break;
            }
            const sourceScope = new Map<string, CapturedValue>();
            for (const [name, type] of Object.entries(step.source.inputs ?? {})) {
              const argument = evaluated(step.arguments![name]!, type, scope), captured = local(name);
              emit(`const ${captured}: ${typeName(argument.type)} = ${argument.code};`);
              sourceScope.set(name, { code: captured, type: argument.type });
            }
            body(step.source.steps, sourceScope);
            captured = evaluated(step.source.result, step.source.type, sourceScope);
            break;
          }
          case "write-register": emit(`${bank(step.register)}${field(step.register.field)} = ${number(step.value, scope).code};`); continue;
          case "write-element": emit(`${bank(step.array)}${field(step.array.field)}[${number(step.index, scope).code}] = ${number(step.value, scope).code};`); continue;
          case "fill-array": emit(`${bank(step.array)}${field(step.array.field)}.fill(${number(step.value, scope).code});`); continue;
          case "write-latch": emit(`${bank(step.latch)}${field(step.latch.field)} = ${typeof step.value === "boolean" ? step.value : flag(step.value, scope)};`); continue;
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
          case "write-choice": emit(`${bank(step.choice)}${field(step.choice.field)} = ${JSON.stringify(step.value)};`); continue;
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
              return { bank: bank(update.flag), field: update.flag.field, code };
            });
            if (step.kind === "replace-flags") emit(`${updates[0]?.bank ?? "state"}.flags = { ${updates.map(update => `[${JSON.stringify(update.field)}]: ${update.code}`).join(", ")} };`);
            else for (const update of updates) emit(`${update.bank}.flags${field(update.field)} = ${update.code};`);
            continue;
          }
        }
        const code = local(step.name);
        // Semantic numeric captures are width-checked values, not TypeScript singleton types.
        const annotation = step.kind === "capture" || step.kind === "read-source" ? `: ${typeName(captured.type)}` : "";
        emit(`const ${code}${annotation} = ${captured.code};`);
        scope.set(step.name, { code, type: captured.type });
      }
    }
    const scope = new Map<string, CapturedValue>();
    const parameters = result && !decoderCapabilities ? [] : [`state: ${stateType}`];
    const bound = !result && boundNames.has(name);
    const pageInputs = bound ? prefixes.find(page => page.key === Math.floor(Number(name) / 256))?.operands ?? [] : [];
    if (bound && JSON.stringify(Object.entries(definition.inputs ?? {})) !== JSON.stringify(pageInputs.map(name => [name, 8]))) {
      throw new Error(`${definition.name}: opcode inputs must match its page captures.`);
    }
    for (const [name, type] of Object.entries(definition.inputs ?? {})) {
      const code = local(name);
      parameters.push(`${code}: ${typeName(type)}`);
      scope.set(name, { code, type });
    }
    body(definition.steps, scope);
    if (result) emit(`return ${evaluated(result.value, result.type, scope).code};`);
    for (const name of capabilities) allCapabilities.add(name);
    for (const name of capabilities) decoderCapabilities?.add(name);
    if (capabilities.size) parameters.push(`instruction: Pick<${contextType(capabilities)}, ${[...capabilities].map(name => JSON.stringify(name)).join(" | ")}>`);
    const key = bound ? `0x${Number(name).toString(16).padStart(2, "0")}` : JSON.stringify(name);
    return `${indent}// ${JSON.stringify(`${cpu} ${definition.name}`)}\n`
      + `${indent}${key}(${parameters.join(", ")}): ${[result ? typeName(result.type) : "void", ...[...rejections].map(reason => JSON.stringify(reason)), ...(rejectsAlignment ? ["OperandAlignmentFault"] : []), ...(rejectsTarget ? ["TargetAlignmentFault"] : [])].join(" | ")} {\n${lines.join("\n")}\n${indent}},`;
  }
  const methods = Object.entries(definitions).map(([name, definition]) => compile(name, definition));
  const readers = sources ? Object.entries(sources.groups).map(([group, members]) => {
    const methods = Object.entries(members).map(([name, source]) => compile(name, {
      cpu: sources.cpu, name: source.name, explanation: "Reusable value source.", ...(source.inputs ? { inputs: source.inputs } : {}),
      steps: [readSource("result", source, source.inputs && Object.fromEntries(Object.entries(source.inputs).map(([name, type]) => [name, type === "flag" ? flagValue(name) : value(name)])))],
    }, { value: source.type === "flag" ? flagValue("result") : value("result"), type: source.type }));
    return `    [${JSON.stringify(group)}]: {\n${methods.join("\n\n")}\n    },`;
  }) : [];
  if (prefixes.length) { allCapabilities.add("fetchByte"); outcomes.add("unsupported"); }
  const imports = [`import type { ${stateType} } from ${JSON.stringify(state?.module ?? `../semantics/generated/state/${cpu}.ts`)};`];
  if (bindOpcodes || allCapabilities.size) imports.push('import type { ByteInstructionContext } from "../instruction-context.ts";');
  for (const extension of extensions(allCapabilities)) imports.push(`import type { ${extension.name} } from "../${extension.file}.ts";`);
  if (alignmentFaults) imports.push('import type { OperandAlignmentFault } from "../word-execution.ts";');
  if (targetFaults) imports.push('import type { TargetAlignmentFault } from "../word-execution.ts";');
  if (bindOpcodes) imports.push('import type { OpcodeEntry } from "../opcodes.ts";');
  if (bindOpcodes) imports.push('import { opcodeTable } from "../opcodes.ts";');
  if (helpers.size) imports.push(`import { ${[...helpers].sort().join(", ")} } from "../alu.ts";`);
  const boundContext = contextType(allCapabilities);
  const outcome = ["void", ...[...outcomes].map(reason => JSON.stringify(reason)), ...(alignmentFaults ? ["OperandAlignmentFault"] : []), ...(targetFaults ? ["TargetAlignmentFault"] : [])].join(" | ");
  const executeType = `(state: ${stateType}, instruction: ${boundContext}) => ${outcome}`;
  // A selected inventory can coexist with named helpers that require decoded inputs.
  let bindings = bindOpcodes === true
    ? `  return Object.entries(instructions).map(([opcode, execute]: [string, ${executeType}]) =>\n`
      + "    [Number(opcode), instruction => execute(state, instruction)]);"
    : [
      `  const entries: readonly OpcodeEntry<${executeType}>[] = [`,
      ...[...boundNames].map(name => `    [0x${Number(name).toString(16)}, instructions[${JSON.stringify(name)}]],`),
      "  ];", "  return entries.map(([opcode, execute]) => [opcode, instruction => execute(state, instruction)]);",
    ].join("\n");
  const generatedPages = prefixes.length ? generatePageBindings(prefixes, boundNames, stateType, boundContext, outcome) : undefined;
  const additional = generatedPages?.additional ?? "";
  if (generatedPages) bindings = generatedPages.bindings;
  return `// Generated by scripts/generate-cpu-semantics.ts; edit ${origin} instead.\n`
    + `${imports.join("\n")}\n\n`
    + (decoders.size ? `const decoders = {\n${[...decoders.values()].map(decoder => decoder.code).join("\n\n")}\n};\n\n` : "")
    + `export const instructions = {\n${methods.join("\n\n")}\n};\n`
    + (opcodeAliases.length ? `\n/** Chapter encodings select shared bodies; this table performs no instruction effects. */\nexport const opcodeInstructions = {\n${opcodeAliases.map(([opcode, name]) => `  ${opcode}: instructions[${JSON.stringify(name)}],`).join("\n")}\n};\n` : "")
    + (sources ? `\n/** Bind reusable sources; fetching and memory access occur only when a reader is called. */
export function sourceReaders(state: ${stateType}) {
  return {\n${readers.join("\n")}\n  };
}\n` : "")
    + (prefixes.length ? `
/** Bind separate opcode spaces for cores that decode prefixes before executing a body. */
export function opcodePages(state: ${stateType}${additional}) {
${generatedPages!.pageBindings}
}

/** Decode bytes and bind captured operands without reading or writing CPU state. */
${generatedPages!.decoder}
` : "")
    + (bindOpcodes ? `
/** Bind this CPU instance's state without performing any instruction effects. */
export function opcodeEntries(state: ${stateType}${additional}): readonly OpcodeEntry<(instruction: ${boundContext}) => ${outcome}>[] {
${bindings}
}
` : "")
    + (bindOpcodes && !prefixes.length ? `
/** Decode a single-byte encoding without executing its body. */
export function opcodeDecoder(state: ${stateType}) {
  const handlers = opcodeTable(opcodeEntries(state));
  return (opcode: number, _nextByte: (opcodeFetch: boolean) => number) => ({ handler: handlers[opcode], opcodeFetches: 1 });
}
` : "");
}
