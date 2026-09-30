import { posix } from "node:path";
import { cpuModels } from "../src/components/cpus/models.ts";
import { deviceModels, isDeviceKind } from "../src/components/devices/models.ts";
import type { ComponentMachineDefinition, ComposedMachineDefinition } from "../src/machines/machine-language.ts";

const componentTypes = {
  ram: ["Ram", "memory/ram"],
  rom: ["Rom", "memory/rom"],
} as const;

/** Emit concrete construction and wiring; generated machines need no runtime interpreter. */
export function compileComposition(machine: ComposedMachineDefinition | ComponentMachineDefinition, name: string, from: string): string {
  const imports: string[] = [];
  for (const kind of new Set(machine.components.map(component => component.kind))) {
    const [type, module] = isDeviceKind(kind) ? [deviceModels[kind].name, deviceModels[kind].module] : componentTypes[kind];
    imports.push(`import { ${type}${isDeviceKind(kind) ? ` as ${deviceType(kind)}` : ""} } from "${path(module)}";`);
  }

  const outputs = machine.components.filter(component => isDeviceKind(component.kind) && deviceModels[component.kind].output);
  const argument = outputs.length ? `bindings: { ${outputs.map(component => `readonly ${component.name}: (value: number) => void`).join("; ")} }` : "";
  const body: string[] = [];
  for (const component of machine.components) {
    const local = part(component.name);
    const images = machine.images.filter(image => image.component === component.name);
    switch (component.kind) {
      case "ram":
        body.push(`const ${local} = new Ram(${component.size});`);
        for (const image of images) body.push(`${JSON.stringify(image.bytes)}.forEach((value, offset) => ${local}.write(${image.address} + offset, value));`);
        break;
      case "rom":
        body.push(`const image_${component.name} = new Uint8Array(${component.size});`);
        for (const image of images) body.push(`image_${component.name}.set(${JSON.stringify(image.bytes)}, ${image.address});`);
        body.push(`const ${local} = new Rom(image_${component.name});`);
        break;
      default: {
        const device = deviceModels[component.kind];
        body.push(`const ${local} = new ${deviceType(component.kind)}(${device.output ? `bindings.${component.name}` : ""});`);
      }
    }
  }

  const returned = machine.components.map(component => `${component.name}: ${part(component.name)}`);
  if (machine.cpu !== undefined) {
    const { name: cpuClass, module: cpuModule } = cpuModels[machine.cpu];
    imports.unshift(`import { ${cpuClass} } from "${path(`cpus/${cpuModule}`)}";`);
    if (machine.connection.kind === "mapped") imports.push(`import { MemoryMap } from "${path("memory/memory-map")}";`);
    if (machine.ports !== undefined) imports.push(`import type { BytePorts } from "${path("cpus/port-access")}";`);

    let memory: string;
    if (machine.connection.kind === "mapped") {
      memory = "memory";
      const { size, regions, unmapped } = machine.connection;
      if (unmapped !== undefined) imports.push(`import { ByteMemoryBus } from "${path("memory/byte-memory-bus")}";`);
      body.push(`const memory = ${unmapped === undefined ? "" : "new ByteMemoryBus("}new MemoryMap(${size}, [`,
        ...regions.map(region => `  { start: ${region.start}, memory: ${part(region.component)} },`),
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
    body.push(`const cpu = new ${cpuClass}(${memory}, ${JSON.stringify(machine.initialState, null, 2)}${connection});`);
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
  if (machine.cpu !== undefined && machine.reset !== undefined) {
    body.push(`const instance = { ${returned.join(", ")} };`, "return instance;");
  } else body.push(`return { ${returned.join(", ")} };`);
  return `${imports.join("\n")}\n\nexport function ${name}(${argument}) {\n${body.join("\n").split("\n").map(line => `  ${line}`).join("\n")}\n}\n`;

  function path(module: string): string { return posix.relative(from, `../components/${module}.js`); }
  function part(component: string): string { return `part_${component}`; }
  function deviceType(kind: string): string { return `Device_${kind.replaceAll("-", "_")}`; }
}
