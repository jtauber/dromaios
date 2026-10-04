import type { RomRegion, AddressLabel } from "./apple2-explorer.js";

/** A software reference, independent of memory reads or instruction execution. */
export function createRomReference(regions: readonly RomRegion[], routines: readonly AddressLabel[], labels: readonly AddressLabel[] = []) {
  const entries = [...routines, ...labels].sort((a, b) => parseInt(a.address, 16) - parseInt(b.address, 16));
  const routineEntries = [...routines].sort((a, b) => parseInt(a.address, 16) - parseInt(b.address, 16));
  return {
    at(address: number): AddressLabel | undefined { return entries.find(entry => parseInt(entry.address, 16) === address); },
    search(query: string): readonly AddressLabel[] {
      const text = query.trim().replace(/^\$/, "").toLowerCase();
      return entries.filter(entry => `${entry.address} ${entry.name} ${entry.description}`.toLowerCase().includes(text));
    },
    locate(address: number, romMapped: boolean): { region: RomRegion; entry: AddressLabel | undefined; offset: number | undefined } | undefined {
      if (!romMapped) return undefined;
      const region = regions.find(region => address >= parseInt(region.start, 16) && address <= parseInt(region.end, 16));
      if (!region) return undefined;
      let entry: AddressLabel | undefined;
      for (const candidate of routineEntries) {
        const start = parseInt(candidate.address, 16);
        if (start >= parseInt(region.start, 16) && start <= address) entry = candidate;
      }
      // The nearest label is a navigation aid, not an inferred routine boundary.
      return { region, entry, offset: entry === undefined ? undefined : address - parseInt(entry.address, 16) };
    },
  };
}
