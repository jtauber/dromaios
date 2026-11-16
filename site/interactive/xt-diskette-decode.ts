import { xtHex as hex } from "./8088-disassembly.js";

const commands = new Map([[3, "Specify"], [4, "Sense Drive Status"], [7, "Recalibrate"], [8, "Sense Interrupt Status"], [15, "Seek"]]);

/** Names describe the commands implemented by the XT's literate 765 profile. */
export function xtDisketteCommand(command: number | undefined): string {
  if (command === undefined) return "Unobserved command";
  if ((command & 0x1f) === 6) return "Read Data";
  if ((command & 0x3f) === 5) return "Write Data";
  if ((command & 0xbf) === 0x0a) return "Read ID";
  return commands.get(command) ?? `Unknown command $${hex(command, 2)}`;
}

export function xtDisketteParameters(command: number | undefined, p: readonly number[]): string {
  const name = xtDisketteCommand(command);
  if (name === "Specify") return p.length < 2 ? "Receiving timing parameters" : `Step ${(16 - (p[0]! >>> 4)) * 2} ms · ${p[1]! & 1 ? "non-DMA" : "DMA"}`;
  if (!p.length) return "No parameters observed";
  const drive = `Drive ${p[0]! & 3} · head ${p[0]! >> 2 & 1}`;
  if (name === "Seek") return drive + (p.length > 1 ? ` · cylinder ${p[1]}` : " · receiving cylinder");
  if (name === "Read Data" || name === "Write Data") return drive
    + ` · C/H/R/N ${p.slice(1, 5).join("/")}${p.length < 5 ? "/…" : ""}`
    + (p.length > 5 ? ` · EOT ${p[5]}` : "") + ` · ${command! & 0x80 ? "multi-track" : "single-track"} · ${command! & 0x40 ? "MFM" : "FM"}`;
  return drive;
}

/** Decode the status flags produced by this profile; retain unmodeled bits explicitly. */
export function xtDisketteResult(command: number | undefined, bytes: readonly number[]): string {
  if (!bytes.length) return "No result available";
  const [st0, st1, st2] = bytes;
  if (command === 4) return `ST3 $${hex(st0!, 2)} · ${st0! & 0x40 ? "write-protected" : "write-enabled"} · ${st0! & 0x10 ? "track zero" : "away from track zero"}`;
  const interrupt = ["Normal termination", "Abnormal termination", "Invalid command / no pending interrupt", "Ready-change / reset"][st0! >>> 6]!;
  const parts = [interrupt];
  if (bytes.length === 1 && command === undefined) return `Result $${hex(st0!, 2)} · command not observed`;
  if (st0! & 0x20) parts.push("seek end");
  if (st0! & 0x10) parts.push("equipment check");
  if (st0! & 8) parts.push(`other ST0 bits $${hex(st0! & 8, 2)}`);
  if (bytes.length === 2) parts.push(`PCN ${st1}`);
  if (bytes.length === 7) {
    if (st1! & 2) parts.push("write-protected");
    if (st1! & 4) parts.push("no data");
    if (st1! & 0x80) parts.push("end of cylinder");
    if (st2! & 0x10) parts.push("wrong cylinder");
    if (st1! & ~0x86) parts.push(`other ST1 bits $${hex(st1! & ~0x86, 2)}`);
    if (st2! & ~0x10) parts.push(`other ST2 bits $${hex(st2! & ~0x10, 2)}`);
    parts.push(`result C/H/R/N ${bytes.slice(3).join("/")}`);
  }
  return parts.join(" · ");
}
