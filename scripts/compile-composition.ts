import { posix } from "node:path";
import { cpuModels } from "../src/components/cpus/models.ts";
import { deviceModels, isDeviceKind } from "../src/components/devices/models.ts";
import type { ComponentMachineDefinition, ComposedMachineDefinition } from "../src/machines/machine-language.ts";
import type { MemoryWindowDefinition } from "../src/machines/language/memory-window.ts";

const componentTypes = {
  ram: ["Ram", "memory/ram"],
  rom: ["Rom", "memory/rom"],
} as const;

/** Emit concrete construction and wiring; generated machines need no runtime interpreter. */
export function compileComposition(machine: ComposedMachineDefinition | ComponentMachineDefinition, name: string, from: string): string {
  const imports: string[] = [`import { checkMachineSnapshot, snapshotRam, restoreRam } from "${posix.relative(from, "snapshot.js")}";`];
  const fields: string[] = [], snapshots: string[] = [];
  const externalImages = new Map(machine.externalImages?.map(image => [image.component, image]));
  for (const kind of new Set(machine.components.filter(component => !externalImages.has(component.name)).map(component => component.kind))) {
    const [type, module] = isDeviceKind(kind) ? [deviceModels[kind].name, deviceModels[kind].module] : componentTypes[kind];
    imports.push(`import { ${type}${isDeviceKind(kind) ? ` as ${deviceType(kind)}` : ""} } from "${path(module)}";`);
  }

  const outputs = machine.components.filter(component => isDeviceKind(component.kind) && deviceModels[component.kind].output);
  const identities: string[] = [];
  if (externalImages.size) imports.push(
    `import { ExternalRom } from "${posix.relative(from, "rom-image.js")}";`,
    `import type { RomImage } from "${posix.relative(from, "rom-image.js")}";`);
  const bindings = [
    ...outputs.map(component => `readonly ${component.name}: (value: number) => void`),
    ...[...externalImages.keys()].map(component => `readonly ${component}: RomImage | null`),
  ];
  const argument = bindings.length ? `bindings: { ${bindings.join("; ")} }, ` : "";
  const body: string[] = [];
  for (const component of machine.components) {
    const local = part(component.name);
    const images = machine.images.filter(image => image.component === component.name);
    switch (component.kind) {
      case "ram":
        fields.push(`readonly ${component.name}: readonly number[]`);
        snapshots.push(`${component.name}: snapshotRam(${local})`);
        body.push(`const ${local} = new Ram(${component.size});`);
        for (const image of images) body.push(`${JSON.stringify(image.bytes)}.forEach((value, offset) => ${local}.write(${image.address} + offset, value));`);
        body.push(`if (initialState !== undefined) restoreRam(${local}, initialState.${component.name});`);
        break;
      case "rom":
        if (externalImages.has(component.name)) {
          const identity = { size: component.size, sha256: externalImages.get(component.name)!.sha256 };
          identities.push(`  ${component.name}: Object.freeze(${JSON.stringify(identity)}),`);
          fields.push(`readonly ${component.name}: string | null`);
          snapshots.push(`${component.name}: ${local}.snapshot()`);
          body.push(`const ${local} = new ExternalRom(romImages.${component.name}, bindings.${component.name}, initialState?.${component.name});`);
        } else {
          body.push(`const image_${component.name} = new Uint8Array(${component.size});`);
          for (const image of images) body.push(`image_${component.name}.set(${JSON.stringify(image.bytes)}, ${image.address});`);
          body.push(`const ${local} = new Rom(image_${component.name});`);
        }
        break;
      default: {
        const device = deviceModels[component.kind];
        fields.push(`readonly ${component.name}: ReturnType<${deviceType(component.kind)}["snapshot"]>`);
        snapshots.push(`${component.name}: ${local}.snapshot()`);
        body.push(`const ${local} = new ${deviceType(component.kind)}(${device.output ? `bindings.${component.name}, ` : ""}initialState?.${component.name});`);
      }
    }
  }

  const returned = machine.components.map(component => `${component.name}: ${part(component.name)}`);
  if (machine.cpu !== undefined) {
    const { name: cpuClass, module: cpuModule } = cpuModels[machine.cpu];
    fields.unshift(`readonly cpu: ConstructorParameters<typeof ${cpuClass}>[1]`);
    snapshots.unshift("cpu: instance.cpu.snapshot()");
    imports.unshift(`import { ${cpuClass} } from "${path(`cpus/${cpuModule}`)}";`);
    if (machine.connection.kind === "mapped") imports.push(`import { MemoryMap } from "${path("memory/memory-map")}";`);
    if (machine.ports !== undefined) imports.push(`import type { BytePorts } from "${path("cpus/port-access")}";`);

    let memory: string;
    if (machine.connection.kind === "mapped") {
      memory = "memory";
      const { size, regions, unmapped } = machine.connection;
      if (unmapped !== undefined) imports.push(`import { ByteMemoryBus } from "${path("memory/byte-memory-bus")}";`);
      body.push(`const memory = ${unmapped === undefined ? "" : "new ByteMemoryBus("}new MemoryMap(${size}, [`,
        ...regions.map(region => `  { start: ${region.start}, memory: ${"window" in region ? window(region.window) : part(region.component)} },`),
        `])${unmapped === undefined ? "" : `, ${unmapped})`};`);
    } else memory = part(machine.connection.component);

    if (machine.ports !== undefined) {
      const unmapped = machine.unmappedPorts;
      if (unmapped !== undefined) imports.push(`import { checkUnsigned } from "${path("validation")}";`);
      body.push("const ports: BytePorts = {");
      for (const direction of ["in", "out"] as const) {
        body.push(direction === "in" ? "  readPort: port => {" : "  writePort: (port, value) => {");
        if (unmapped !== undefined) {
          body.push('    checkUnsigned("Port", port, 0xff);');
          if (direction === "out") body.push('    checkUnsigned("Port byte", value, 0xff);');
        }
        body.push("    switch (port) {");
        for (const binding of machine.ports.filter(binding => binding.direction === direction)) {
          const call = `${part(binding.component)}.${direction === "in" ? "read" : "write"}(${binding.address}${direction === "out" ? ", value" : ""})`;
          body.push(`      case ${binding.port}: return ${call};`);
        }
        body.push(unmapped === undefined
          ? `      default: throw new Error("Unconnected ${direction === "in" ? "input" : "output"} port " + port + ".");`
          : `      default: return${direction === "in" ? ` ${unmapped}` : ""};`, "    }", "  },");
      }
      body.push("};");
    }
    if (machine.resetDevices !== undefined) body.push("const resetDevices = (): void => {",
      ...machine.resetDevices.map(target => `  ${part(target)}.reset();`), "};");

    const connection = machine.ports !== undefined ? ", ports" : machine.resetDevices !== undefined ? ", { resetDevices }" : "";
    body.push(`const cpu = new ${cpuClass}(${memory}, initialState === undefined ? ${JSON.stringify(machine.initialState, null, 2)} : initialState.cpu${connection});`);
    if (machine.reset !== undefined) {
      body.push("const reset = (): ReturnType<typeof cpu.reset> => {", "  // Follow the current CPU, including one restored from a host snapshot.", "  const record = instance.cpu.reset();",
        ...machine.reset.slice(1).map(target => `  ${part(target)}.reset();`), "  return record;", "};");
    }
    returned.unshift("cpu");
    if (machine.connection.kind === "mapped") returned.push("memory");
    if (machine.ports !== undefined) returned.push("ports");
    if (machine.reset !== undefined) returned.push("reset");
    if (machine.endAddress !== undefined) returned.push(`endAddress: ${machine.endAddress}`);
  }
  const snapshotFields = [...(machine.cpu === undefined ? [] : ["cpu"]), ...machine.components
    .filter(component => component.kind !== "rom" || externalImages.has(component.name)).map(component => component.name)];
  body.unshift(`if (initialState !== undefined) checkMachineSnapshot(initialState, ${JSON.stringify(snapshotFields)});`);
  body.push(`const snapshot = (): { ${fields.join("; ")} } => ({ ${snapshots.join(", ")} });`);
  returned.push("snapshot");
  body.push(`const instance = { ${returned.join(", ")} };`, "return instance;");
  const metadata = externalImages.size ? `export const romImages = Object.freeze({\n${identities.join("\n")}\n});\n\n` : "";
  return `${imports.join("\n")}\n\n${metadata}export function ${name}(${argument}initialState?: { ${fields.join("; ")} }) {\n${body.join("\n").split("\n").map(line => `  ${line}`).join("\n")}\n}\n`;

  function path(module: string): string { return posix.relative(from, `../components/${module}.js`); }
  function part(component: string): string { return `part_${component}`; }
  function deviceType(kind: string): string { return `Device_${kind.replaceAll("-", "_")}`; }
  function window(definition: MemoryWindowDefinition): string {
    const lines = [`{ size: ${definition.size},`];
    for (const direction of ["read", "write"] as const) {
      lines.push(`    ${direction}: (address: number${direction === "write" ? ", value: number" : ""}) => {`);
      for (const route of definition[direction]) {
        const condition = route.when.map(({ component, view }) => `${part(component)}.${view}()`).join(" && ");
        const result = route.target === "discard" ? ""
          : ` ${part(route.target.component)}.${direction}(address + ${route.target.offset}${direction === "write" ? ", value" : ""})`;
        lines.push(`      ${condition ? `if (${condition}) ` : ""}return${result};`);
      }
      lines.push("    },");
    }
    return lines.join("\n") + "\n  }";
  }
}
