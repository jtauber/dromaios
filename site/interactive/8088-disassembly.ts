import type { FlagCondition } from "./instruction-shape.js";

/** An absent forms list means no ModR/M byte. An empty list admits every ModR/M byte. */
export interface Encoding8088 {
  readonly notation: string | readonly string[];
  readonly explanation: string;
  readonly condition?: FlagCondition;
  readonly forms?: readonly (readonly [mask: number, value: number])[];
}
export interface Catalogue8088 {
  readonly instructions: Readonly<Record<number, Encoding8088>>;
  readonly prefixes: Readonly<Record<number, string>>;
  readonly bytes: readonly string[];
  readonly words: readonly string[];
  readonly segments: readonly string[];
  readonly bases: readonly string[];
}
export const xtHex = (value: number, width: number) => value.toString(16).toUpperCase().padStart(width, "0");
export const logical8088 = (cs: number, ip: number) => xtHex(cs, 4) + ":" + xtHex(ip, 4);
export const physical8088 = (segment: number, offset: number) => ((segment << 4) + (offset & 0xffff)) & 0xfffff;
const literal = (value: number, width: number) => xtHex(value, width).replace(/^[A-F]/, "0$&") + "h";
const signed = (value: number, bits: number) => value << (32 - bits) >> (32 - bits);

export interface Row8088 {
  readonly cs: number;
  readonly ip: number;
  readonly bytes: readonly (number | undefined)[];
  readonly assembly: string;
  readonly complete: boolean;
  readonly flow?: "conditional" | "unconditional";
  readonly encoding?: Encoding8088;
  readonly operand?: { readonly bases: readonly string[]; readonly displacement: number; readonly segment: string; readonly addressOnly: boolean };
  readonly target?: { readonly cs: number; readonly ip: number };
}

// Bound the inspector's work even in RAM filled with prefix bytes. The CPU has its own fetch limit.
class PreviewStopped extends Error {}

/** Read instruction bytes only. The caller supplies either observed storage or a recorded fetch. */
export function decode8088(cpu: Catalogue8088, cs: number, ip: number, read: (index: number) => number | undefined): Row8088 {
  const bytes: (number | undefined)[] = [];
  function byte(): number {
    if (bytes.length === 32) throw new PreviewStopped("Preview limit (32 bytes)");
    const value = read(bytes.length);
    bytes.push(value);
    if (value === undefined) throw new PreviewStopped(bytes.length === 1 ? "No storage" : "Incomplete instruction");
    return value;
  }
  const word = () => byte() | byte() << 8;
  try {
    let lock = "", repeat = "", segment = "";
    let opcode = byte();
    while (cpu.prefixes[opcode]) {
      const prefix = cpu.prefixes[opcode]!;
      if (prefix === "LOCK") lock = prefix;
      else if (prefix.startsWith("REP")) repeat = prefix;
      else segment = prefix + ":";
      opcode = byte();
    }
    const encoding = cpu.instructions[opcode];
    if (!encoding) throw new PreviewStopped("Unsupported opcode " + literal(opcode, 2));
    const stringInstruction = typeof encoding.notation === "string" && /^(CMPS|SCAS|MOVS|LODS|STOS)[BW]$/.test(encoding.notation);
    const compares = typeof encoding.notation === "string" && /^(CMPS|SCAS)/.test(encoding.notation);
    if (repeat && (!stringInstruction || repeat === "REPNE" && !compares)) throw new PreviewStopped("Unsupported repeat prefix");
    if (repeat === "REP" && compares) repeat = "REPE";

    let mode = 0, reg = 0, rm = 0, memory = "";
    let bases: readonly string[] = [], displacement = 0, memoryOperand = false, addressOnly = false;
    let target: Row8088["target"];
    if (encoding.forms) {
      const post = byte();
      if (encoding.forms.length && !encoding.forms.some(([mask, value]) => (post & mask) === value))
        throw new PreviewStopped("Unsupported ModR/M " + literal(post, 2));
      mode = post >> 6; reg = (post >> 3) & 7; rm = post & 7;
      if (mode !== 3) {
        let address = cpu.bases[rm]!;
        bases = address.split("+"); memoryOperand = true;
        if (mode === 0 && rm === 6) { displacement = word(); bases = []; address = literal(displacement, 4); }
        else if (mode !== 0) {
          const disp = mode === 1 ? signed(byte(), 8) : signed(word(), 16);
          displacement = disp;
          if (disp) address += (disp < 0 ? "-" : "+") + literal(Math.abs(disp), 1);
        }
        memory = "[" + address + "]";
      }
    }
    const notation = typeof encoding.notation === "string" ? encoding.notation : encoding.notation[reg];
    if (!notation) throw new Error("Missing operand notation for a documented 8088 encoding.");
    if ((notation === "AAM" || notation === "AAD") && byte() !== 10) throw new PreviewStopped("Unsupported decimal radix");

    function operand(token: string): string {
      switch (token) {
        case "reg8": return cpu.bytes[reg]!;
        case "reg16": return cpu.words[reg]!;
        case "Sreg": return cpu.segments[reg]!;
        case "rm8": return mode === 3 ? cpu.bytes[rm]! : "BYTE PTR " + memory;
        case "rm16": return mode === 3 ? cpu.words[rm]! : "WORD PTR " + memory;
        case "farMem": return "DWORD PTR " + memory;
        case "mem": addressOnly = true; return memory;
        case "escape": return literal((opcode & 7) * 8 + reg, 2);
        case "escOperand": return mode === 3 ? String(rm) : memory;
        case "imm8": return literal(byte(), 2);
        case "imm16": return literal(word(), 4);
        case "signed8": return literal(signed(byte(), 8) & 0xffff, 4);
        case "[offset]": displacement = word(); memoryOperand = true; return "[" + literal(displacement, 4) + "]";
        case "ptr16:16": { const offset = word(); target = { cs: word(), ip: offset }; return logical8088(target.cs, target.ip); }
        case "rel8": case "rel16": {
          const delta = token === "rel8" ? signed(byte(), 8) : signed(word(), 16);
          target = { cs, ip: (ip + bytes.length + delta) & 0xffff };
          return logical8088(target.cs, target.ip);
        }
        default: return token;
      }
    }
    const [mnemonic, operands] = notation.split(" ");
    const formatted = operands?.split(",").map(operand).join(", ");
    const assembly = [lock, repeat, segment, mnemonic, formatted].filter(Boolean).join(" ");
    const flow = /^(JMP|CALL|RET|RETF|IRET|INT|INT3)$/.test(mnemonic!) ? "unconditional"
      : /^(J|LOOP|INTO)/.test(mnemonic!) ? "conditional" : undefined;
    const operandInfo = memoryOperand ? { bases, displacement, segment: segment.slice(0, -1) || (bases.includes("BP") ? "SS" : "DS"), addressOnly } : undefined;
    return { cs, ip, bytes, assembly, flow, complete: true, encoding, operand: operandInfo, target };
  } catch (error) {
    if (!(error instanceof PreviewStopped)) throw error;
    return { cs, ip, bytes, assembly: error.message, complete: false };
  }
}
