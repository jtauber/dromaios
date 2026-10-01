import { create8080AltairBasic } from "../../src/machines/generated/8080/altair-basic.js";
import { SerialSession } from "../../src/runtime/serial-session.js";
import type { SerialTransportSnapshot } from "../../src/runtime/serial-session.js";
import { checkUnsigned } from "../../src/components/validation.js";
import { readBasicTape } from "./altair-basic-media.js";
import type { BasicTape } from "./altair-basic-media.js";
import { createSerialTerminal } from "./serial-terminal.js";
import type { SerialTerminalSnapshot } from "./serial-terminal.js";
import type { SerialExecutionSnapshot } from "./serial-execution.js";

type BasicMachine = ReturnType<typeof create8080AltairBasic>;
interface PanelState {
  readonly lowSwitches: number;
  readonly open: boolean;
  readonly guides: boolean;
}
interface SavedBasicSession {
  readonly version: 1;
  readonly machine: ReturnType<BasicMachine["snapshot"]>;
  readonly transport: SerialTransportSnapshot;
  readonly terminal: SerialTerminalSnapshot;
  readonly tape: { readonly name: string; readonly bytes: readonly number[] } | null;
  readonly panel: PanelState;
  readonly execution: SerialExecutionSnapshot;
  readonly previousPc?: number;
}

export interface BasicSession {
  readonly session: SerialSession<BasicMachine>;
  readonly terminal: ReturnType<typeof createSerialTerminal>;
  readonly tape?: BasicTape;
  readonly panel: PanelState;
  readonly execution: SerialExecutionSnapshot;
  readonly previousPc?: number;
}

/** Capture hardware and host state together at a stopped instruction boundary. */
export function saveBasicSession(state: BasicSession): string {
  if (state.session.running) throw new Error("Stop BASIC before saving its session.");
  const saved: SavedBasicSession = {
    version: 1, machine: state.session.machine.snapshot(), transport: state.session.snapshotTransport(),
    terminal: state.terminal.snapshot(),
    tape: state.tape === undefined ? null : { name: state.tape.name, bytes: Array.from(state.tape.bytes) },
    panel: state.panel, execution: state.execution, previousPc: state.previousPc,
  };
  return JSON.stringify(saved);
}

/** Constructors validate hardware state; storage never supplies executable code or callbacks. */
export async function readBasicSession(text: string, media: { readonly bytes: number; readonly sha256: string }): Promise<BasicSession> {
  if (text.length > 250_000) throw new RangeError("Saved BASIC session is too large.");
  // Treat this shape as untrusted until the checks and component constructors below succeed.
  const saved = JSON.parse(text) as SavedBasicSession;
  if (saved?.version !== 1 || saved.machine === undefined || saved.terminal === undefined
    || saved.transport === undefined || saved.execution === undefined) throw new TypeError("Incompatible BASIC session.");
  checkUnsigned("Lower switches", saved.panel.lowSwitches, 0xff);
  if (typeof saved.panel.open !== "boolean" || typeof saved.panel.guides !== "boolean") throw new TypeError("Invalid panel state.");
  checkUnsigned("Executed instructions", saved.execution.steps, Number.MAX_SAFE_INTEGER);
  if (saved.execution.error !== undefined && typeof saved.execution.error !== "string") throw new TypeError("Invalid execution error.");
  if (saved.previousPc !== undefined) checkUnsigned("Previous PC", saved.previousPc, 0xffff);
  let tape: BasicTape | undefined;
  if (saved.tape !== null) {
    if (typeof saved.tape.name !== "string" || !Array.isArray(saved.tape.bytes) || saved.tape.bytes.length !== media.bytes) {
      throw new TypeError("Invalid saved tape.");
    }
    for (const byte of saved.tape.bytes) checkUnsigned("Tape byte", byte, 0xff);
    const bytes = Uint8Array.from(saved.tape.bytes);
    tape = await readBasicTape({ name: saved.tape.name, size: bytes.length, arrayBuffer: async () => bytes.buffer }, media);
  }
  const transport = saved.transport;
  if (!Array.isArray(transport.tape) || !Array.isArray(transport.input) || !Array.isArray(transport.output)
    || transport.input.length > 4096 || transport.output.length > 4096
    || (transport.tape.length !== 0 && (tape === undefined || transport.tape.length !== tape.bytes.length
      || transport.tape.some((byte, index) => byte !== tape.bytes[index])))) throw new TypeError("Invalid saved transport.");
  const session = new SerialSession(output => create8080AltairBasic({ serial: output }), [],
    output => create8080AltairBasic({ serial: output }, saved.machine));
  session.restoreTransport(transport);
  const terminal = createSerialTerminal(saved.terminal);
  return { session, terminal, tape, panel: saved.panel, execution: saved.execution, previousPc: saved.previousPc };
}

interface TabStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Isolate storage failures, including browsers that deny access to sessionStorage itself. */
export function basicSessionStorage(storage: () => TabStorage, key: string) {
  return {
    read: () => storage().getItem(key),
    clear: () => storage().removeItem(key),
    write(value: string): void {
      try { storage().setItem(key, value); }
      catch (error) {
        // Do not silently offer an older program after the latest save failed.
        try { storage().removeItem(key); } catch { /* Storage may be entirely unavailable. */ }
        throw error;
      }
    },
  };
}
