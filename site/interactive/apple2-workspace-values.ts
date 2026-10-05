import type { MemoryLabel } from "./apple2-explorer.js";
import type { Apple2MemoryChange } from "./apple2-inspection.js";

/** Names describe this firmware's conventions, not exclusive ownership of the addresses. */
export function monitorWorkspace(labels: readonly MemoryLabel[]) {
  const bytes = labels.filter(label => label.scope === "workspace" && parseInt(label.address, 16) < 0x100)
    .sort((a, b) => parseInt(a.address, 16) - parseInt(b.address, 16));
  return bytes.filter(label => !bytes.some(word => word.bytes === 2 && parseInt(word.address, 16) + 1 === parseInt(label.address, 16)))
    .map(label => {
      const address = parseInt(label.address, 16), high = bytes.find(byte => parseInt(byte.address, 16) === address + 1);
      return { ...label, address, bytes: label.bytes ?? 1,
        description: label.bytes === 2 ? label.description.replace(/ low$/, "") : label.description,
        name: label.bytes === 2 && high ? `${label.name}/${high.name}` : label.name };
    });
}

export function workspaceValue(address: number, bytes: number, read: (address: number) => number | undefined): number | undefined {
  const low = read(address), high = bytes === 2 ? read(address + 1) : 0;
  return low === undefined || high === undefined ? undefined : low + (high << 8);
}

/** Retain the last changed named entry across instructions between display refreshes. */
export function createWorkspacePosition(entries: readonly { address: number; bytes: number }[]) {
  const owners = new Map(entries.flatMap(entry => Array.from({ length: entry.bytes }, (_, offset) =>
    [entry.address + offset, entry.address] as const)));
  let target: number | undefined;
  return {
    get target() { return target; },
    reset(): void { target = undefined; },
    observe(writes: readonly Apple2MemoryChange[]): void {
      const before = new Map<number, number>();
      for (const write of writes) {
        if (write.region === "ram" && owners.has(write.address) && !before.has(write.address)) before.set(write.address, write.before);
      }
      // Walk final writes backwards: intermediate changes that were undone do not move the view.
      for (let index = writes.length - 1; index >= 0; index--) {
        const write = writes[index]!;
        if (write.region !== "ram" || !before.has(write.address)) continue;
        if (before.get(write.address) !== write.after) { target = owners.get(write.address); break; }
        before.delete(write.address);
      }
    },
  };
}
