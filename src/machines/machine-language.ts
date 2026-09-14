import { cpu8008StateDescription } from "../components/cpus/8008.ts";
import { cpu8080StateDescription } from "../components/cpus/8080.ts";
import { cpu8088StateDescription } from "../components/cpus/8088.ts";
import { cpu6502StateDescription } from "../components/cpus/6502.ts";
import { cpu6800StateDescription } from "../components/cpus/6800.ts";
import { cpu6809StateDescription } from "../components/cpus/6809.ts";
import { cpu68000StateDescription } from "../components/cpus/68000.ts";
import { cpuZ80StateDescription } from "../components/cpus/z80.ts";
import type { StateFields, StateField, GroupField, StateValues } from "../components/cpus/state.js";
import type { Cpu8008State } from "../components/cpus/8008.js";
import type { Cpu8080State } from "../components/cpus/8080.js";
import type { Cpu8088State } from "../components/cpus/8088.js";
import type { Cpu6502State } from "../components/cpus/6502.js";
import type { Cpu6800State } from "../components/cpus/6800.js";
import type { Cpu6809State } from "../components/cpus/6809.js";
import type { Cpu68000State } from "../components/cpus/68000.js";
import type { CpuZ80State } from "../components/cpus/z80.js";

interface CpuStates {
  "8008": Cpu8008State;
  "8080": Cpu8080State;
  "8088": Cpu8088State;
  "6502": Cpu6502State;
  "6800": Cpu6800State;
  "6809": Cpu6809State;
  "68000": Cpu68000State;
  "z80": CpuZ80State;
}

type CpuModel = keyof CpuStates;
type CpuDefinition = {
  [Model in CpuModel]: { readonly cpu: Model; readonly initialState: CpuStates[Model] };
}[CpuModel];

export type MachineDefinition = {
  [Model in CpuModel]: {
    readonly cpu: Model;
    readonly initialState: CpuStates[Model];
    readonly ramSize: Model extends "8008" ? 0x4000 : Model extends "8088" ? 0x100000
      : Model extends "68000" ? 0x1000000 : 0x10000;
  };
}[CpuModel] & {
  readonly memory: readonly { readonly address: number; readonly bytes: readonly number[] }[];
  readonly endAddress?: number;
};

interface Token { readonly text: string; readonly offset: number }
type Value = number | boolean | number[] | { [name: string]: Value };

/** Parse and validate one flat-RAM machine without constructing or running it. */
export function parseMachine(source: string, filename = "<machine>"): MachineDefinition {
  // Keep atoms whole: malformed values such as FF, or 0x12oops cannot parse in part.
  const tokens = source.matchAll(/\/\/[^\r\n]*|\s+|[{}=\[\]]|[^\s{}=\[\]/]+|\//g);
  function nextToken(): Token {
    for (let next = tokens.next(); !next.done; next = tokens.next()) {
      const match = next.value;
      if (/^(?:\s|\/\/)/.test(match[0])) continue;
      return { text: match[0], offset: match.index };
    }
    return { text: "", offset: source.length };
  }
  let current = nextToken();

  function fail(token: Token, message: string): never {
    const lines = source.slice(0, token.offset).split(/\r\n|\r|\n/);
    const prefix = lines.at(-1) ?? "";
    const line = prefix + source.slice(token.offset).split(/\r\n|\r|\n/, 1)[0];
    const caret = prefix.replace(/[^\t]/g, " ") + "^";
    throw new SyntaxError(`${filename}:${lines.length}:${prefix.length + 1}: ${message}\n${line}\n${caret}`);
  }
  function take(): Token {
    const token = current;
    current = nextToken();
    return token;
  }
  function expect(text: string): Token {
    if (current.text !== text) fail(current, `Expected ${JSON.stringify(text)}, found ${describe(current)}`);
    return take();
  }
  function describe(token: Token): string {
    return token.text === "" ? "end of file" : JSON.stringify(token.text);
  }
  function readNumber(token: Token, label: string, maximum: number): number {
    const match = /^(?:0[xX]([\da-fA-F]+)|\$([\da-fA-F]+)|([\d][\da-fA-F]*)[hH]|([\da-fA-F]+))$/.exec(token.text);
    const digits = match?.slice(1).find(value => value !== undefined);
    if (digits === undefined) fail(token, `Expected a hexadecimal value for ${label}, found ${describe(token)}`);
    const value = Number.parseInt(digits, 16);
    if (!Number.isSafeInteger(value) || value > maximum) {
      fail(token, `${label} must be in 0..${maximum.toString(16).toUpperCase()} (hexadecimal)`);
    }
    return value;
  }
  function readValue(field: Exclude<StateField, GroupField>, label: string): number | boolean | number[] {
    if (field.kind === "array") {
      expect("[");
      const values: number[] = [];
      while (current.text !== "]") {
        if (current.text === "") fail(current, `Expected "]" to close ${label}`);
        if (values.length === field.length) fail(current, `${label} requires exactly ${field.length} values`);
        values.push(readNumber(take(), `${label}[${values.length}]`, field.element.maximum));
      }
      if (values.length !== field.length) fail(current, `${label} requires exactly ${field.length} values`);
      take();
      return values;
    }
    const token = take();
    if (field.kind === "boolean") {
      if (token.text !== "true" && token.text !== "false") fail(token, `Expected true or false for ${label}`);
      return token.text === "true";
    }
    const maximum = field.kind === "unsigned" ? field.maximum
      : field.kind === "choice" ? Math.max(...field.values) : 1;
    const value = readNumber(token, label, maximum);
    if (field.kind === "choice" && !field.values.includes(value)) {
      fail(token, `${label} must be one of ${field.values.map(value => value.toString(16).toUpperCase()).join(", ")} (hexadecimal)`);
    }
    return field.kind === "flag" ? value === 1 : value;
  }
  function fieldLabel(name: string, field: StateField): string {
    return field.kind === "group" || field.kind === "boolean" || field.kind === "array" || /[A-Z]/.test(name)
      ? name : name.toUpperCase();
  }
  function readState<Fields extends StateFields>(description: Fields, context: string): StateValues<Fields> {
    expect("{");
    const fields = new Map(Object.entries(description).map(([name, field]) => [name.toLowerCase(), { name, field }]));
    const values: { [name: string]: Value } = {};
    while (current.text !== "}") {
      if (current.text === "") fail(current, `Expected "}" to close ${context}`);
      const token = take();
      const entry = fields.get(token.text.toLowerCase());
      if (!entry) fail(token, `Unknown field ${describe(token)} in ${context}`);
      const { name, field } = entry;
      if (Object.hasOwn(values, name)) fail(token, `Duplicate field ${fieldLabel(name, field)} in ${context}`);
      if (field.kind === "group") {
        if (token.text !== name) fail(token, `Expected lowercase keyword ${JSON.stringify(name)}`);
        values[name] = readState(field.fields, `${context}.${name}`);
      } else {
        expect("=");
        values[name] = readValue(field, `${context}.${fieldLabel(name, field)}`);
      }
    }
    const missing = [...fields.values()].filter(({ name }) => !Object.hasOwn(values, name));
    if (missing.length) fail(current, `Missing fields in ${context}: ${missing.map(({ name, field }) => fieldLabel(name, field)).join(", ")}`);
    take();
    // Every described field is present exactly once, including validated choices and fixed array lengths.
    return values as StateValues<Fields>;
  }
  function readCpu(): CpuDefinition {
    const model = take();
    switch (model.text) {
      case "8008": return { cpu: model.text, initialState: readState(cpu8008StateDescription, model.text) };
      case "8080": return { cpu: model.text, initialState: readState(cpu8080StateDescription, model.text) };
      case "8088": return { cpu: model.text, initialState: readState(cpu8088StateDescription, model.text) };
      case "6502": return { cpu: model.text, initialState: readState(cpu6502StateDescription, model.text) };
      case "6800": return { cpu: model.text, initialState: readState(cpu6800StateDescription, model.text) };
      case "6809": return { cpu: model.text, initialState: readState(cpu6809StateDescription, model.text) };
      case "68000": return { cpu: model.text, initialState: readState(cpu68000StateDescription, model.text) };
      case "z80": return { cpu: model.text, initialState: readState(cpuZ80StateDescription, model.text) };
      default: return fail(model, `Expected CPU model 8008, 8080, 8088, 6502, 6800, 6809, 68000, or z80, found ${describe(model)}`);
    }
  }

  let ram: { size: number; token: Token } | undefined;
  let cpu: CpuDefinition | undefined;
  let completion: { address: number; token: Token } | undefined;
  const memory: { address: number; bytes: number[] }[] = [];
  // CPU and RAM declarations may follow images. Retain locations for the final size check.
  const memoryBounds: { token: Token; address: number; isByte: boolean }[] = [];
  while (current.text !== "") {
    const declaration = take();
    switch (declaration.text) {
      case "ram": {
        if (ram !== undefined) fail(declaration, "Duplicate ram declaration");
        const size = take();
        const value = readNumber(size, "RAM size", 0x1000000);
        if (value !== 0x4000 && value !== 0x10000 && value !== 0x100000 && value !== 0x1000000) {
          fail(size, "RAM size must be 4000 (16 KiB), 10000 (64 KiB), 100000 (1 MiB), or 1000000 (16 MiB)");
        }
        ram = { size: value, token: size };
        break;
      }
      case "cpu": {
        if (cpu !== undefined) fail(declaration, "Duplicate cpu declaration");
        cpu = readCpu();
        break;
      }
      case "end": {
        if (completion !== undefined) fail(declaration, "Duplicate end declaration");
        const token = take();
        completion = { address: readNumber(token, "Completion address", 0xffffffff), token };
        break;
      }
      case "memory": {
        const addressToken = take();
        const address = readNumber(addressToken, "Memory address", 0xffffff);
        memoryBounds.push({ token: addressToken, address, isByte: false });
        expect("{");
        const bytes: number[] = [];
        while (current.text !== "}") {
          if (current.text === "") fail(current, 'Expected "}" to close memory block');
          const token = take();
          if (!/^[\da-fA-F]{2}$/.test(token.text)) fail(token, `Expected a two-digit hexadecimal byte, found ${describe(token)}`);
          const limit = ram?.size ?? 0x1000000;
          if (address + bytes.length >= limit) {
            fail(token, `Memory block extends beyond address ${(limit - 1).toString(16).toUpperCase()}`);
          }
          memoryBounds.push({ token, address: address + bytes.length, isByte: true });
          bytes.push(Number.parseInt(token.text, 16));
        }
        take();
        memory.push({ address, bytes });
        break;
      }
      default: fail(declaration, `Unknown declaration ${describe(declaration)}; expected ram, cpu, memory, or end`);
    }
  }
  if (ram === undefined) fail(current, "Missing ram declaration");
  if (cpu === undefined) fail(current, "Missing cpu declaration");
  const requiredSize = cpu.cpu === "8008" ? 0x4000 : cpu.cpu === "8088" ? 0x100000
    : cpu.cpu === "68000" ? 0x1000000 : 0x10000;
  if (ram.size !== requiredSize) fail(ram.token, `RAM size for ${cpu.cpu} must be ${requiredSize.toString(16).toUpperCase()}`);
  const lastAddress = (requiredSize - 1).toString(16).toUpperCase();
  for (const { token, address, isByte } of memoryBounds) {
    if (address >= requiredSize) fail(token, isByte ? `Memory block extends beyond address ${lastAddress}`
      : `Memory address must be in 0..${lastAddress}`);
  }
  // Completion compares snapshot.pc: the 68000 retains all 32 bits of that register.
  const maximumPc = cpu.cpu === "68000" ? 0xffffffff : requiredSize - 1;
  if (completion !== undefined && completion.address > maximumPc) {
    fail(completion.token, `Completion address must be in 0..${maximumPc.toString(16).toUpperCase()}`);
  }
  const machine = cpu.cpu === "8008"
    ? { ...cpu, ramSize: 0x4000 as const, memory }
    : cpu.cpu === "8088" ? { ...cpu, ramSize: 0x100000 as const, memory }
    : cpu.cpu === "68000" ? { ...cpu, ramSize: 0x1000000 as const, memory }
    : { ...cpu, ramSize: 0x10000 as const, memory };
  return completion === undefined ? machine : { ...machine, endAddress: completion.address };
}
