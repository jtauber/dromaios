import type { CompositionDefinition } from "../src/machines/language/composition.ts";
import type { DeviceChapter } from "../src/components/devices/semantics/compile.ts";
import { deviceModels } from "../src/components/devices/models.ts";
import type { Apple2HardwareCatalogue } from "./interactive/apple2-hardware.ts";

/** Export wiring and declared device descriptions, without shipping their compilers or effects. */
export function apple2HardwareCatalogue(machine: CompositionDefinition, chapters: Readonly<Record<string, DeviceChapter>>): Apple2HardwareCatalogue {
  if (machine.connection.kind !== "mapped" || machine.connection.unmapped === undefined) throw new Error("Apple II inspection requires its mapped byte bus.");
  const components = Object.fromEntries(machine.components.map(component => {
    const chapter = chapters[component.kind];
    if (!("size" in component) && !chapter && component.kind !== "apple2-disk-ii") throw new Error(`Missing device chapter: ${component.kind}`);
    const bindings = (direction: "read" | "write") => chapter
      ? Object.fromEntries([...chapter.interface[direction === "read" ? "reads" : "writes"]].map(([address, binding]) => [address, chapter.sources[binding.source]!.name]))
      : {};
    const description = { kind: component.kind,
      source: chapter ? `src/components/devices/specifications/${component.kind}.md` : "src/machines/6502/apple2.md#components-and-address-decoding",
      read: bindings("read"), write: bindings("write") };
    // Disk II remains the concrete handwritten component described in the machine chapter.
    if (component.kind === "apple2-disk-ii") {
      description.read = Object.fromEntries(deviceModels[component.kind].reads.map(address => [address, address < 16 ? "Disk II controller read" : "Read Disk II bootstrap ROM"]));
      description.write = Object.fromEntries(deviceModels[component.kind].writes.map(address => [address, "Disk II controller write"]));
    }
    return [component.name, description];
  }));
  const regions: Apple2HardwareCatalogue["regions"][number][] = [];
  let next = 0;
  for (const region of [...machine.connection.regions].sort((a, b) => a.start - b.start)) {
    if (region.start > next) regions.push({ start: next, size: region.start - next, read: [], write: [] });
    if ("window" in region) regions.push({ start: region.start, ...region.window });
    else {
      const component = machine.components.find(component => component.name === region.component)!;
      const size = "size" in component ? component.size : deviceModels[component.kind].size;
      const route = [{ target: { component: component.name, offset: 0 }, when: [] }];
      regions.push({ start: region.start, size, read: route, write: route });
    }
    next = regions.at(-1)!.start + regions.at(-1)!.size;
  }
  if (next < machine.connection.size) regions.push({ start: next, size: machine.connection.size - next, read: [], write: [] });
  return { size: machine.connection.size, undriven: machine.connection.unmapped, components, regions };
}
