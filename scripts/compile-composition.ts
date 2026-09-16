import { posix } from "node:path";
import type { ComposedMachineDefinition } from "../src/machines/machine-language.ts";

const componentTypes = {
  ram: ["Ram", "memory/ram"],
  rom: ["Rom", "memory/rom"],
  "byte-input": ["ByteInput", "devices/byte-input"],
  "byte-output": ["ByteOutput", "devices/byte-output"],
} as const;

/** Emit concrete construction and wiring; generated machines need no runtime interpreter. */
export function compileComposition(machine: ComposedMachineDefinition, name: string, from: string): string {
  const cpuClass = `Cpu${machine.cpu.charAt(0).toUpperCase()}${machine.cpu.slice(1)}`;
  const imports = [`import { ${cpuClass} } from "${path(`cpus/${machine.cpu}`)}";`];
  for (const kind of new Set(machine.components.map(component => component.kind))) {
    const [type, module] = componentTypes[kind];
    imports.push(`import { ${type} } from "${path(module)}";`);
  }
  if (machine.connection.kind === "mapped") imports.push(`import { MemoryMap } from "${path("memory/memory-map")}";`);
  if (machine.ports !== undefined) imports.push(`import type { BytePorts } from "${path("cpus/port-access")}";`);

  const outputs = machine.components.filter(component => component.kind === "byte-output");
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
      case "byte-input": body.push(`const ${local} = new ByteInput();`); break;
      case "byte-output": body.push(`const ${local} = new ByteOutput(bindings.${component.name});`); break;
    }
  }

  let memory: string;
  if (machine.connection.kind === "mapped") {
    memory = "memory";
    body.push(`const memory = new MemoryMap(${machine.connection.size}, [`,
      ...machine.connection.regions.map(region => `  { start: ${region.start}, memory: ${part(region.component)} },`), "]);");
  } else memory = part(machine.connection.component);

  if (machine.ports !== undefined) {
    body.push("const ports: BytePorts = {");
    for (const direction of ["in", "out"] as const) {
      body.push(direction === "in" ? "  readPort: port => {" : "  writePort: (port, value) => {", "    switch (port) {");
      for (const binding of machine.ports.filter(binding => binding.direction === direction)) {
        const call = `${part(binding.component)}.${direction === "in" ? "read" : "write"}(${binding.address}${direction === "out" ? ", value" : ""})`;
        body.push(`      case ${binding.port}: return ${call};`);
      }
      body.push(`      default: throw new Error("Unconnected ${direction === "in" ? "input" : "output"} port " + port + ".");`, "    }", "  },");
    }
    body.push("};");
  }
  if (machine.resetDevices !== undefined) body.push("const resetDevices = (): void => {",
    ...machine.resetDevices.map(target => `  ${part(target)}.reset();`), "};");

  const connection = machine.ports !== undefined ? ", ports" : machine.resetDevices !== undefined ? ", { resetDevices }" : "";
  body.push(`const cpu = new ${cpuClass}(${memory}, ${JSON.stringify(machine.initialState, null, 2)}${connection});`);
  if (machine.reset !== undefined) {
    body.push("const reset = () => {", "  // Check the CPU execution boundary before resetting devices.", "  const record = cpu.reset();",
      ...machine.reset.slice(1).map(target => `  ${part(target)}.reset();`), "  return record;", "};");
  }
  const returned = ["cpu", ...machine.components.map(component => `${component.name}: ${part(component.name)}`)];
  if (machine.connection.kind === "mapped") returned.push("memory");
  if (machine.ports !== undefined) returned.push("ports");
  if (machine.reset !== undefined) returned.push("reset");
  if (machine.endAddress !== undefined) returned.push(`endAddress: ${machine.endAddress}`);
  body.push(`return { ${returned.join(", ")} };`);
  return `${imports.join("\n")}\n\nexport function ${name}(${argument}) {\n${body.join("\n").split("\n").map(line => `  ${line}`).join("\n")}\n}\n`;

  function path(module: string): string { return posix.relative(from, `../components/${module}.js`); }
  function part(component: string): string { return `part_${component}`; }
}
