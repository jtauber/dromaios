import { Dos33Disk } from "../../src/components/devices/dos33-disk.js";
import { checkMachineSnapshot } from "../../src/machines/snapshot.js";
import { sha256 } from "./rom-file.js";

export interface Apple2DiskEntry { readonly name: string; readonly disk: Dos33Disk }
export interface Apple2DiskSetSnapshot {
  readonly mounted: number | null;
  readonly disks: readonly { readonly name: string; readonly writable: boolean; readonly bytes: readonly number[] | null }[];
}
export interface SavedApple2DiskSet {
  readonly mounted: number | null;
  readonly disks: readonly { readonly name: string; readonly writable: boolean; readonly base64: string | null; readonly sha256: string | null }[];
}

function checkDiskName(name: string): void {
  if (typeof name !== "string" || !name.trim() || name.length > 1024) throw new Error("Invalid disk filename.");
}

/** Host-owned media. The drive borrows one of these disks; ejection does not discard it. */
export class Apple2DiskSet {
  static readonly limit = 16;
  #entries: readonly Apple2DiskEntry[] = Object.freeze([]);

  get entries(): readonly Apple2DiskEntry[] { return this.#entries; }
  checkCapacity(count: number): void {
    if (!Number.isSafeInteger(count) || count < 0 || this.#entries.length + count > Apple2DiskSet.limit) {
      throw new Error(`A disk set holds up to ${Apple2DiskSet.limit} disks. Remove a disk before adding more.`);
    }
  }
  add(entries: readonly Apple2DiskEntry[]): void {
    this.checkCapacity(entries.length);
    const added = entries.map(({ name, disk }) => {
      checkDiskName(name);
      if (!(disk instanceof Dos33Disk)) throw new Error("Invalid disk image.");
      return Object.freeze({ name, disk });
    });
    const next = [...this.#entries, ...added];
    if (new Set(next.map(entry => entry.disk)).size !== next.length) throw new Error("This disk is already in the set.");
    this.#entries = Object.freeze(next);
  }
  remove(entry: Apple2DiskEntry, mounted: Dos33Disk | null): void {
    if (entry.disk === mounted) throw new Error("Eject this disk before removing it from the set.");
    if (!this.#entries.includes(entry)) throw new Error("This disk is no longer in the set.");
    this.#entries = Object.freeze(this.#entries.filter(item => item !== entry));
  }
  snapshot(mounted: Dos33Disk | null): Apple2DiskSetSnapshot {
    const index = this.#entries.findIndex(entry => entry.disk === mounted);
    if (mounted !== null && index === -1) throw new Error("The mounted disk is missing from the set.");
    return { mounted: mounted === null ? null : index, disks: this.#entries.map(({ name, disk }) => ({
      name, writable: disk.writable, bytes: disk === mounted ? null : disk.snapshot(),
    })) };
  }
}

/** Store the mounted bytes only in the hardware snapshot; other disks use compact base64. */
export async function encodeApple2DiskSet(snapshot: Apple2DiskSetSnapshot): Promise<SavedApple2DiskSet> {
  return { mounted: snapshot.mounted, disks: await Promise.all(snapshot.disks.map(async ({ name, writable, bytes }) => {
    if (bytes === null) return { name, writable, base64: null, sha256: null };
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.slice(i, i + 8192));
    return { name, writable, base64: btoa(binary), sha256: await sha256(Uint8Array.from(bytes)) };
  })) };
}

/** Validate every disk before the caller replaces either the live machine or its set. */
export async function prepareApple2DiskSet(value: SavedApple2DiskSet, mounted: Dos33Disk | null, diskName: string | null): Promise<Apple2DiskSet> {
  checkMachineSnapshot(value, ["mounted", "disks"]);
  if (!Array.isArray(value.disks) || value.disks.length > Apple2DiskSet.limit
    || (mounted === null ? value.mounted !== null : !Number.isInteger(value.mounted)
      || value.mounted === null || value.mounted < 0 || value.mounted >= value.disks.length)) {
    throw new Error("Invalid saved disk set selection.");
  }
  const entries: Apple2DiskEntry[] = [];
  for (const [index, entry] of value.disks.entries()) {
    checkMachineSnapshot(entry, ["name", "writable", "base64", "sha256"]);
    checkDiskName(entry.name);
    if (typeof entry.writable !== "boolean") throw new Error("Invalid saved disk write permission.");
    if (index === value.mounted) {
      if (entry.base64 !== null || entry.sha256 !== null || entry.name !== diskName || entry.writable !== mounted!.writable) {
        throw new Error("Saved disk set does not match the mounted disk.");
      }
      entries.push({ name: entry.name, disk: mounted! });
    } else {
      if (typeof entry.base64 !== "string" || entry.base64.length !== Math.ceil(Dos33Disk.size / 3) * 4
        || !/^[A-Za-z0-9+/]+=$/.test(entry.base64) || typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
        throw new Error("Invalid saved disk image.");
      }
      const bytes = Uint8Array.from(atob(entry.base64), char => char.charCodeAt(0));
      if (bytes.length !== Dos33Disk.size || await sha256(bytes) !== entry.sha256) throw new Error("Saved disk set image does not match its digest.");
      entries.push({ name: entry.name, disk: new Dos33Disk(bytes, { writable: entry.writable }) });
    }
  }
  const set = new Apple2DiskSet(); set.add(entries); return set;
}
