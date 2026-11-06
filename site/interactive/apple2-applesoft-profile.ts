import { applesoftSourceAt, resolveApplesoftSource } from "./apple2-applesoft.js";
import type { ApplesoftListing, ApplesoftSourcePosition } from "./apple2-applesoft.js";
import { applesoftDispatch, applesoftLineInput } from "./apple2-applesoft-step.js";
import type { createApple2Session } from "./apple2-session.js";
import type { Cpu6502StepRecord } from "../../src/components/cpus/generated/6502-cpu.js";
import type { DebugLocation } from "./instruction-debugger.js";

type Machine = ReturnType<typeof createApple2Session>["machine"];
interface Profile {
  caller: ApplesoftSourcePosition;
  target: ApplesoftSourcePosition;
  calls: number;
  returned: number;
}
interface Call { address: number; bytes: readonly number[]; profile: Profile }

/** Successful numbered GOSUBs and their stack records in the verified Apple II Plus ROM. */
export function createApplesoftProfile(listing: () => ApplesoftListing) {
  const profiles = new Map<string, Profile>();
  let active: Call[] = [], source: ApplesoftListing | undefined;
  function reconcile(): ApplesoftListing {
    const current = listing();
    if (current !== source) {
      source = current;
      for (const [key, profile] of profiles) {
        const caller = resolveApplesoftSource(current, profile.caller), target = resolveApplesoftSource(current, profile.target);
        if (!caller || !target) {
          profiles.delete(key); active = active.filter(call => call.profile !== profile);
        } else { profile.caller.statement = caller; profile.target.statement = target; }
      }
    }
    return current;
  }
  return {
    entries() {
      return [...profiles.values()].map(profile => ({ ...profile, active: active.filter(call => call.profile === profile).length }));
    },
    clear(): void { profiles.clear(); active = []; source = undefined; },
    observe(machine: Machine, before: DebugLocation, after: Pick<Cpu6502StepRecord["after"], "pc" | "sp">): void {
      const pc = before.address, { ram } = machine;
      if (before.space === "rom" && pc === 0xd93b) {
        // GOSUB's GOTO has succeeded. TXTPTR points one byte before the target line header.
        const word = (at: number) => ram.read(at) | ram.read(at + 1) << 8;
        const listing = reconcile(), address = 0x101 + after.sp;
        if (address + 6 > 0x1ff || ram.read(address) !== 0xb0 || word(address + 5) !== 0xd822) return;
        const header = word(0xb8) + 1;
        if (header + 3 >= ram.size) return;
        const pointer = word(address + 3), caller = applesoftSourceAt(listing, word(address + 1), pointer);
        const targetLine = listing.lines.find(line => line.number === word(header + 2) && line.terminator + 1 === word(header));
        const statement = targetLine?.statements[0];
        if (!caller?.statement.parts.some(part => part.text === "GOSUB" && part.tokenAddress !== undefined && part.tokenAddress <= pointer)
          || !targetLine || !statement) return;
        const key = `${caller.line}:${caller.index}:${targetLine.number}`;
        let profile = profiles.get(key);
        if (!profile) {
          profile = { caller, target: { line: targetLine.number, index: 0, statement }, calls: 0, returned: 0 };
          profiles.set(key, profile);
        }
        profile.calls++;
        // A new frame can reuse space abandoned by RUN, an error, or a stack reset.
        active = active.filter(call => call.address > address);
        active.push({ address, bytes: Array.from({ length: 5 }, (_, i) => ram.read(address + i)), profile });
      }
      if (before.space === "rom" && (pc === 0xd993 || pc === 0xd9c7)) {
        // RETURN restores the caller's text pointer at D993. POP discards its final byte at D9C7.
        const address = 0x100 + after.sp - 4;
        const call = active.find(call => call.address === address);
        if (call && pc === 0xd993 && call.bytes.every((byte, i) => ram.read(call.address + i) === byte)) call.profile.returned++;
        active = active.filter(call => call.address > address);
      }
      if ((after.pc === applesoftDispatch || after.pc === applesoftLineInput) && !machine.language.ramRead()) {
        reconcile();
        // STOP and END can leave frames available to CONT. Retain only records still on the live stack.
        active = active.filter(call => call.address > 0x100 + after.sp
          && call.bytes.every((byte, i) => ram.read(call.address + i) === byte));
      }
    },
  };
}
export type ApplesoftProfile = ReturnType<typeof createApplesoftProfile>;
