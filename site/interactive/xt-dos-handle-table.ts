import { physical8088 } from "./8088-disassembly.js";

/** Offsets and code guards for the chapter's selected DOS, not a universal DOS layout. */
export interface DosHandleTableProfile {
  readonly name: string;
  readonly entry: string;
  readonly guards: readonly { readonly offset: string; readonly bytes: string }[];
  readonly currentPsp: string;
  readonly count: string;
  readonly pointer: string;
}
export interface DosHandleTable {
  readonly scope: string;
  readonly entries: readonly number[];
}

/** Read declared storage only. A mismatched kernel or malformed PSP supplies no table. */
export function dosHandleTable(profile: DosHandleTableProfile, read: (address: number) => number | undefined): DosHandleTable | undefined {
  const word = (segment: number, offset: number): number | undefined => {
    const low = read(physical8088(segment, offset)), high = read(physical8088(segment, offset + 1));
    return low === undefined || high === undefined ? undefined : low | high << 8;
  };
  const kernel = word(0, 0x86);
  if (kernel === undefined || word(0, 0x84) !== parseInt(profile.entry, 16)) return;
  for (const guard of profile.guards) {
    const offset = parseInt(guard.offset, 16), bytes = guard.bytes.split(" ").map(value => parseInt(value, 16));
    if (!bytes.every((value, i) => read(physical8088(kernel, offset + i)) === value)) return;
  }
  const psp = word(kernel, parseInt(profile.currentPsp, 16));
  if (psp === undefined || word(psp, 0) !== 0x20cd) return;
  const count = word(psp, parseInt(profile.count, 16));
  const pointer = parseInt(profile.pointer, 16), offset = word(psp, pointer), segment = word(psp, pointer + 2);
  if (count === undefined || count < 5 || count > 256 || offset === undefined || segment === undefined || offset + count > 0x10000) return;
  const entries: number[] = [];
  for (let i = 0; i < count; i++) {
    const value = read(physical8088(segment, offset + i));
    if (value === undefined) return;
    entries.push(value);
  }
  return { scope: `${kernel}:${psp}`, entries };
}
