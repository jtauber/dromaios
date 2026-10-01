export interface BasicTape {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** Verify the entire local file before the caller replaces the machine. */
export async function readBasicTape(file: {
  readonly name: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}, expected: { readonly bytes: number; readonly sha256: string }): Promise<BasicTape> {
  if (file.size !== expected.bytes) throw new Error(`This machine needs the ${expected.bytes}-byte 4K BASIC 3.2 tape.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== expected.sha256) throw new Error("This file does not match the 4K BASIC 3.2 tape in the guide.");
  return { name: file.name, bytes };
}

/** The verified file survives reset; the session's attached tape does not. */
export function describeBasicTape(tape: BasicTape | undefined, position: number, length: number): string {
  if (tape === undefined) return "No tape selected.";
  if (length === 0) return `${tape.name} · tape ejected by reset. Reload tape to prepare a fresh boot.`;
  return `${tape.name} · ${position.toLocaleString()} / ${length.toLocaleString()} bytes offered`;
}
