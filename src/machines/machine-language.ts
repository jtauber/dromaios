import { machineSyntax } from "./language/syntax.ts";
import type { Token } from "./language/syntax.ts";
import { compositionSyntax } from "./language/composition.ts";
import type { CompositionDefinition } from "./language/composition.ts";
import { cpuModels } from "../components/cpus/models.ts";
import type { CpuModel, CpuStates } from "../components/cpus/models.ts";
import type { StateFields, StateField, GroupField, StateValues } from "../components/cpus/state.js";

const ramSizes = new Set<number>(Object.values(cpuModels).map(({ ramSize }) => ramSize));
const maximumRam = Math.max(...ramSizes);

type CpuDefinition = {
  [Model in CpuModel]: {
    readonly cpu: Model;
    readonly initialState: CpuStates[Model];
  };
}[CpuModel];

type RamCpuDefinition = {
  [Model in CpuModel]: Extract<CpuDefinition, { cpu: Model }> & {
    readonly ramSize: typeof cpuModels[Model]["ramSize"];
  };
}[CpuModel];

export type RamMachineDefinition = RamCpuDefinition & {
  readonly memory: readonly { readonly address: number; readonly bytes: readonly number[] }[];
  readonly endAddress?: number;
};

export type ComposedMachineDefinition = CpuDefinition & CompositionDefinition & { readonly endAddress?: number };
export type MachineDefinition = RamMachineDefinition | ComposedMachineDefinition;

type Value = number | string | boolean | number[] | { [name: string]: Value };

/** Parse and validate a machine without constructing components or executing it. */
export function parseMachine(source: string, filename = "<machine>"): MachineDefinition {
  const syntax = machineSyntax(source, filename);
  const { take, expect, describe, readNumber, readByte } = syntax;
  const fail: (token: Token, message: string) => never = syntax.fail;
  const composition = compositionSyntax(syntax);
  function readValue(field: Exclude<StateField, GroupField>, label: string): number | string | boolean | number[] {
    if (field.kind === "array") {
      expect("[");
      const values: number[] = [];
      while (syntax.current().text !== "]") {
        if (syntax.current().text === "") fail(syntax.current(), `Expected "]" to close ${label}`);
        if (values.length === field.length) fail(syntax.current(), `${label} requires exactly ${field.length} values`);
        values.push(readNumber(take(), `${label}[${values.length}]`, field.element.maximum));
      }
      if (values.length !== field.length) fail(syntax.current(), `${label} requires exactly ${field.length} values`);
      take();
      return values;
    }
    const token = take();
    if (field.kind === "named-choice") {
      if (!field.values.includes(token.text)) fail(token, `${label} must be one of ${field.values.join(", ")}`);
      return token.text;
    }
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
    return field.kind === "group" || field.kind === "boolean" || field.kind === "named-choice" || field.kind === "array" || /[A-Z]/.test(name)
      ? name : name.toUpperCase();
  }
  function readState<Fields extends StateFields>(description: Fields, context: string): StateValues<Fields> {
    expect("{");
    const fields = new Map(Object.entries(description).map(([name, field]) => [name.toLowerCase(), { name, field }]));
    const values: { [name: string]: Value } = {};
    while (syntax.current().text !== "}") {
      if (syntax.current().text === "") fail(syntax.current(), `Expected "}" to close ${context}`);
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
    if (missing.length) fail(syntax.current(), `Missing fields in ${context}: ${missing.map(({ name, field }) => fieldLabel(name, field)).join(", ")}`);
    take();
    // Every described field is present exactly once, including validated choices and fixed array lengths.
    return values as StateValues<Fields>;
  }
  function readCpu(): RamCpuDefinition {
    const model = take();
    if (!Object.hasOwn(cpuModels, model.text)) {
      return fail(model, `Expected CPU model ${Object.keys(cpuModels).join(", ")}, found ${describe(model)}`);
    }
    const cpu = model.text as CpuModel, description = cpuModels[cpu];
    // The same catalogue entry supplies the schema and RAM size, preserving their model correlation.
    return { cpu, initialState: readState(description.state, cpu), ramSize: description.ramSize } as RamCpuDefinition;
  }

  let ram: { size: number; token: Token } | undefined;
  let cpu: RamCpuDefinition | undefined;
  let completion: { address: number; token: Token } | undefined;
  const memory: { address: number; bytes: number[] }[] = [];
  // CPU and RAM declarations may follow images. Retain locations for the final size check.
  const memoryBounds: { token: Token; address: number; isByte: boolean }[] = [];
  while (syntax.current().text !== "") {
    const declaration = take();
    switch (declaration.text) {
      case "ram": {
        if (ram !== undefined) fail(declaration, "Duplicate ram declaration");
        const size = take();
        const value = readNumber(size, "RAM size", maximumRam);
        if (!ramSizes.has(value)) {
          fail(size, `RAM size must be one of ${[...ramSizes].sort((a, b) => a - b).map(size => size.toString(16).toUpperCase()).join(", ")}`);
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
        if (syntax.current().text === "=") {
          composition.read(declaration);
          break;
        }
        const addressToken = take();
        const address = readNumber(addressToken, "Memory address", maximumRam - 1);
        memoryBounds.push({ token: addressToken, address, isByte: false });
        expect("{");
        const bytes: number[] = [];
        while (syntax.current().text !== "}") {
          if (syntax.current().text === "") fail(syntax.current(), 'Expected "}" to close memory block');
          const token = take();
          const byte = readByte(token);
          const limit = ram?.size ?? maximumRam;
          if (address + bytes.length >= limit) {
            fail(token, `Memory block extends beyond address ${(limit - 1).toString(16).toUpperCase()}`);
          }
          memoryBounds.push({ token, address: address + bytes.length, isByte: true });
          bytes.push(byte);
        }
        take();
        memory.push({ address, bytes });
        break;
      }
      default:
        if (!composition.read(declaration)) fail(declaration, `Unknown declaration ${describe(declaration)}; expected ram, cpu, memory, end, components, image, map, ports, reset, or reset-devices`);
    }
  }
  if (!composition.present && ram === undefined) fail(syntax.current(), "Missing ram declaration");
  if (cpu === undefined) fail(syntax.current(), "Missing cpu declaration");
  const requiredSize = cpu.ramSize, maximumPc = cpuModels[cpu.cpu].maximumPc;
  if (completion) {
    if (maximumPc === undefined) fail(completion.token, `CPU ${cpu.cpu} has no public PC view for completion`);
    else if (completion.address > maximumPc) fail(completion.token, `Completion address must be in 0..${maximumPc.toString(16).toUpperCase()}`);
  }
  if (composition.present) {
    if (ram !== undefined || memory.length) fail(ram?.token ?? memoryBounds[0]!.token, "Named components cannot be mixed with flat ram or memory blocks; use image blocks");
    const { ramSize, ...cpuState } = cpu;
    const definition = { ...cpuState, ...composition.finish(cpu.cpu, requiredSize) };
    return completion === undefined ? definition : { ...definition, endAddress: completion.address };
  }
  if (ram === undefined) return fail(syntax.current(), "Missing ram declaration");
  if (ram.size !== requiredSize) fail(ram.token, `RAM size for ${cpu.cpu} must be ${requiredSize.toString(16).toUpperCase()}`);
  const lastAddress = (requiredSize - 1).toString(16).toUpperCase();
  for (const { token, address, isByte } of memoryBounds) {
    if (address >= requiredSize) fail(token, isByte ? `Memory block extends beyond address ${lastAddress}`
      : `Memory address must be in 0..${lastAddress}`);
  }
  const machine = { ...cpu, memory };
  return completion === undefined ? machine : { ...machine, endAddress: completion.address };
}
