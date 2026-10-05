import { hex } from "./apple2-explorer.js";
import { memoryAccessRoles } from "./apple2-memory-accesses.js";
import type { UpcomingMemoryAccesses } from "./apple2-memory-accesses.js";

/** Upcoming accesses decorate the edge, leaving last-change backgrounds intact. */
export function markMemoryAccess(field: HTMLElement, upcoming: UpcomingMemoryAccesses, address: number, bytes = 1, description = ""): string {
  const entries = Array.from({ length: bytes }, (_, offset) => ({ address: address + offset, roles: upcoming.get(address + offset) ?? [] }));
  for (const role of memoryAccessRoles) field.classList.toggle(`is-next-${role}`, entries.some(entry => entry.roles.includes(role)));
  const accesses = entries.filter(entry => entry.roles.length).map(entry => `${entry.roles.join(" + ")} $${hex(entry.address)}`);
  const writes = entries.some(entry => entry.roles.includes("write")) ? " Writes are bus requests, not confirmed storage changes." : "";
  field.title = [description, accesses.length ? `Next instruction: ${accesses.join("; ")}.${writes}` : ""].filter(Boolean).join("\n");
  return field.title;
}
