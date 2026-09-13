import type { Cpu8008AddressStack, Cpu8008State } from "../components/cpus/8008.js";
import type { Cpu8080State } from "../components/cpus/8080.js";
import type { Cpu6502State } from "../components/cpus/6502.js";
import type { Cpu6800State } from "../components/cpus/6800.js";
import type { Cpu6809State } from "../components/cpus/6809.js";
import type { CpuZ80State } from "../components/cpus/z80.js";

interface CpuStates {
  "8008": Cpu8008State;
  "8080": Cpu8080State;
  "6502": Cpu6502State;
  "6800": Cpu6800State;
  "6809": Cpu6809State;
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
    readonly ramSize: Model extends "8008" ? 0x4000 : 0x10000;
  };
}[CpuModel] & {
  readonly memory: readonly { readonly address: number; readonly bytes: readonly number[] }[];
  readonly endAddress?: number;
};

type ValueKind = "byte" | "word" | "flag" | "boolean" | "interrupt-mode" | "address-stack" | "stack-index";
interface Schema { readonly [name: string]: ValueKind | Schema }
type SchemaValues<S extends Schema> = {
  [Name in keyof S]: S[Name] extends Schema ? SchemaValues<S[Name]>
    : S[Name] extends "address-stack" ? Cpu8008AddressStack
    : S[Name] extends "flag" | "boolean" ? boolean : S[Name] extends "interrupt-mode" ? 0 | 1 | 2 : number;
};
type CpuSchema<State> = {
  [Name in keyof State]: Name extends "flags" ? { [Flag in keyof State[Name]]: "flag" }
    : State[Name] extends Readonly<Cpu8008AddressStack> ? "address-stack"
    : State[Name] extends object ? CpuSchema<State[Name]>
    : State[Name] extends 0 | 1 | 2 ? "interrupt-mode"
    : State[Name] extends number ? "byte" | "word" | "stack-index" : "boolean";
};

const z80BankSchema = {
  a: "byte", b: "byte", c: "byte", d: "byte", e: "byte", h: "byte", l: "byte",
  flags: { s: "flag", z: "flag", h: "flag", pv: "flag", n: "flag", c: "flag" },
} as const;

// Constructor state types keep field coverage and Boolean/numeric kinds in sync.
// Widths describe the source format; CPU constructors also validate their state.
const schemas = {
  "8008": {
    a: "byte", b: "byte", c: "byte", d: "byte", e: "byte", h: "byte", l: "byte",
    flags: { s: "flag", z: "flag", p: "flag", c: "flag" },
    addressStack: "address-stack", stackIndex: "stack-index", halted: "boolean",
  },
  "8080": {
    a: "byte", b: "byte", c: "byte", d: "byte", e: "byte", h: "byte", l: "byte",
    pc: "word", sp: "word",
    flags: { s: "flag", z: "flag", ac: "flag", p: "flag", cy: "flag" },
    interruptEnabled: "boolean", halted: "boolean",
  },
  "6502": {
    a: "byte", x: "byte", y: "byte", sp: "byte", pc: "word",
    flags: { n: "flag", v: "flag", d: "flag", i: "flag", z: "flag", c: "flag" },
  },
  "6800": {
    a: "byte", b: "byte", x: "word", sp: "word", pc: "word",
    flags: { h: "flag", i: "flag", n: "flag", z: "flag", v: "flag", c: "flag" },
  },
  "6809": {
    a: "byte", b: "byte", dp: "byte", x: "word", y: "word", s: "word", u: "word", pc: "word",
    flags: { e: "flag", f: "flag", h: "flag", i: "flag", n: "flag", z: "flag", v: "flag", c: "flag" },
  },
  "z80": {
    ...z80BankSchema, alternate: z80BankSchema,
    ix: "word", iy: "word", pc: "word", sp: "word", i: "byte", r: "byte",
    iff1: "boolean", iff2: "boolean", im: "interrupt-mode", halted: "boolean",
  },
} as const satisfies { [Model in CpuModel]: CpuSchema<CpuStates[Model]> };

interface Token { readonly text: string; readonly offset: number }
type Value = number | boolean | Cpu8008AddressStack | { [name: string]: Value };

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
  function readValue(kind: ValueKind, label: string): number | boolean | Cpu8008AddressStack {
    if (kind === "address-stack") {
      expect("[");
      const addresses: number[] = [];
      while (current.text !== "]") {
        if (current.text === "") fail(current, `Expected "]" to close ${label}`);
        if (addresses.length === 8) fail(current, `${label} requires exactly eight addresses`);
        addresses.push(readNumber(take(), `${label}[${addresses.length}]`, 0x3fff));
      }
      if (addresses.length !== 8) fail(current, `${label} requires exactly eight addresses`);
      take();
      // Length and the 14-bit range of every element have been validated.
      return addresses as Cpu8008AddressStack;
    }
    const token = take();
    if (kind === "boolean") {
      if (token.text !== "true" && token.text !== "false") fail(token, `Expected true or false for ${label}`);
      return token.text === "true";
    }
    const maximum = kind === "byte" ? 0xff : kind === "word" ? 0xffff
      : kind === "interrupt-mode" ? 2 : kind === "stack-index" ? 7 : 1;
    const value = readNumber(token, label, maximum);
    return kind === "flag" ? value === 1 : value;
  }
  function fieldLabel(name: string, kind: ValueKind | Schema): string {
    return typeof kind === "object" || kind === "boolean" || kind === "address-stack" || kind === "stack-index"
      ? name : name.toUpperCase();
  }
  function readState<S extends Schema>(schema: S, context: string): SchemaValues<S> {
    expect("{");
    const fields = new Map(Object.entries(schema).map(([name, kind]) => [name.toLowerCase(), { name, kind }]));
    const values: { [name: string]: Value } = {};
    while (current.text !== "}") {
      if (current.text === "") fail(current, `Expected "}" to close ${context}`);
      const token = take();
      const field = fields.get(token.text.toLowerCase());
      if (!field) fail(token, `Unknown field ${describe(token)} in ${context}`);
      const { name, kind } = field;
      if (Object.hasOwn(values, name)) fail(token, `Duplicate field ${fieldLabel(name, kind)} in ${context}`);
      if (typeof kind === "object") {
        if (token.text !== name) fail(token, `Expected lowercase keyword ${JSON.stringify(name)}`);
        values[name] = readState(kind, `${context}.${name}`);
      } else {
        expect("=");
        values[name] = readValue(kind, `${context}.${fieldLabel(name, kind)}`);
      }
    }
    const missing = [...fields.values()].filter(({ name }) => !Object.hasOwn(values, name));
    if (missing.length) fail(current, `Missing fields in ${context}: ${missing.map(({ name, kind }) => fieldLabel(name, kind)).join(", ")}`);
    take();
    // Every schema field is present exactly once, with its declared kind validated.
    return values as SchemaValues<S>;
  }
  function readCpu(): CpuDefinition {
    const model = take();
    switch (model.text) {
      case "8008": return { cpu: model.text, initialState: readState(schemas["8008"], model.text) };
      case "8080": return { cpu: model.text, initialState: readState(schemas["8080"], model.text) };
      case "6502": return { cpu: model.text, initialState: readState(schemas["6502"], model.text) };
      case "6800": return { cpu: model.text, initialState: readState(schemas["6800"], model.text) };
      case "6809": return { cpu: model.text, initialState: readState(schemas["6809"], model.text) };
      case "z80": return { cpu: model.text, initialState: readState(schemas.z80, model.text) };
      default: return fail(model, `Expected CPU model 8008, 8080, 6502, 6800, 6809, or z80, found ${describe(model)}`);
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
        const value = readNumber(size, "RAM size", 0x10000);
        if (value !== 0x4000 && value !== 0x10000) fail(size, "RAM size must be 4000 (16 KiB) or 10000 (64 KiB)");
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
        completion = { address: readNumber(token, "Completion address", 0xffff), token };
        break;
      }
      case "memory": {
        const addressToken = take();
        const address = readNumber(addressToken, "Memory address", 0xffff);
        memoryBounds.push({ token: addressToken, address, isByte: false });
        expect("{");
        const bytes: number[] = [];
        while (current.text !== "}") {
          if (current.text === "") fail(current, 'Expected "}" to close memory block');
          const token = take();
          if (!/^[\da-fA-F]{2}$/.test(token.text)) fail(token, `Expected a two-digit hexadecimal byte, found ${describe(token)}`);
          if (address + bytes.length >= 0x10000) fail(token, "Memory block extends beyond address FFFF");
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
  const requiredSize = cpu.cpu === "8008" ? 0x4000 : 0x10000;
  if (ram.size !== requiredSize) fail(ram.token, `RAM size for ${cpu.cpu} must be ${requiredSize.toString(16).toUpperCase()}`);
  const lastAddress = (requiredSize - 1).toString(16).toUpperCase();
  for (const { token, address, isByte } of memoryBounds) {
    if (address >= requiredSize) fail(token, isByte ? `Memory block extends beyond address ${lastAddress}`
      : `Memory address must be in 0..${lastAddress}`);
  }
  if (completion !== undefined && completion.address >= requiredSize) {
    fail(completion.token, `Completion address must be in 0..${lastAddress}`);
  }
  const machine = cpu.cpu === "8008"
    ? { ...cpu, ramSize: 0x4000 as const, memory }
    : { ...cpu, ramSize: 0x10000 as const, memory };
  return completion === undefined ? machine : { ...machine, endAddress: completion.address };
}
