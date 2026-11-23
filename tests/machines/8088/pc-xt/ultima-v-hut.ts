import assert from "node:assert/strict";
import type { Cpu8088Snapshot } from "../../../../src/components/cpus/generated/8088-cpu.js";
import type { create8088PcXtEga } from "../../../../src/machines/generated/8088/pc-xt-ega.js";
import { stepTimedXtCpu } from "../../../../src/machines/8088/pc-xt/interrupts.js";
import { createXtDebugger, parseXtDebugAddress } from "../../../../site/interactive/xt-debugger.js";
import { matchesXtDosObservation } from "../../../../site/interactive/xt-dos-observation.js";
import { matchesUltimaObservation } from "../../../../site/interactive/xt-ultima-v.js";
import { ultimaSteps } from "../../../helpers/ultima-v-guide.js";
import { runInput } from "./rom-console.js";

type EgaXt = ReturnType<typeof create8088PcXtEga>;

/** Follow the selected map byte through the view buffer and into the driver's BX argument. */
function traceTableSelection(m: EgaXt) {
  const select = ultimaSteps("ultima-v-ega-hut").find(step => step.title === "Select table tile")!;
  const { expect } = select;
  assert.ok("bytes" in expect);
  function executeAt(ip: number, when?: (cpu: Cpu8088Snapshot) => boolean) {
    runInput(m, [], { limit: 1_000_000, until: (_, { after }) =>
      after.cs === 0x0c6f && after.ip === ip && (!when || when(after)) });
    return stepTimedXtCpu(m).record;
  }

  // Watch the map cell and discover its reader before the later tile-selection stop.
  const debug = createXtDebugger(() => m);
  debug.setReadWatchpoints([{ address: 0x22529, enabled: true }]);
  function continueToSelection() {
    debug.runTo(parseXtDebugAddress(select.execution));
    while (!debug.beforeStep()) debug.capture(() => stepTimedXtCpu(m).record);
  }
  continueToSelection();
  const read = debug.readHit;
  assert.ok(read);
  assert.deepEqual([read.caller.space, read.address, read.value, m.cpu.snapshot().al], ["CS:IP 0C6F:5BC8", 0x22529, 0x95, 0x95]);
  debug.setWatchpoints([{ address: 0x268b9, enabled: true }]);
  continueToSelection();
  const write = debug.hit!;
  assert.deepEqual([write.caller.space, write.address, write.before, write.after, write.instruction?.bytes],
    ["CS:IP 0C6F:5C97", 0x268b9, 0xff, read.value, [0x88, 0x04]]);
  debug.dispose();
  const load = executeAt(0x570f, cpu => matchesXtDosObservation(expect, m, cpu));
  assert.equal(load.before.pc, parseXtDebugAddress(select.execution).address);
  assert.deepEqual(load.accesses.at(-1), { kind: "read", address: 0x268b9, value: 0x95 });
  assert.deepEqual([load.before.bx, load.after.bx], [0x0080, 0x0095]);

  const translate = executeAt(0x5715);
  assert.deepEqual(translate.accesses.at(-1), { kind: "read", address: 0x26ee3, value: 0x95 });
  const push = executeAt(0x571b), argument = executeAt(0x10ee);
  const stack = (push.after.ss << 4) + push.after.sp;
  const word = [{ address: stack, value: 0x95 }, { address: stack + 1, value: 0 }];
  assert.deepEqual(push.accesses.slice(-2), word.map(byte => ({ kind: "write", ...byte })));
  assert.deepEqual(argument.accesses.slice(-2), word.map(byte => ({ kind: "read", ...byte })));
  assert.deepEqual([translate.after.al, push.before.ax, argument.after.bx], [0x95, 0x95, 0x95]);
  const call = executeAt(0x1107);
  assert.deepEqual([call.after.cs, call.after.ip, call.after.bx, call.after.ax], [0x9d27, 0x0051, 0x95, 0x0407]);
}

/** Follow one Down make/break from the hut keyboard poll back to that same poll. */
export function traceHutStep(m: EgaXt): void {
  const steps = ultimaSteps("ultima-v-ega-hut");
  const move = steps.find(step => step.title === "Update party Y")!, paint = steps.find(step => step.title === "Redraw the table tile")!;
  const start = parseXtDebugAddress(move.execution), destination = parseXtDebugAddress(paint.execution);
  const party = move.expect, draw = paint.expect;
  assert.ok("party" in party && "bytes" in draw);
  const { keyboardInterrupts } = runInput(m, [0x50, 0xd0], { limit: 1_000_000, until: (_, { after }) =>
    after.pc === start.address && matchesUltimaObservation(party, after, m.ram) });
  assert.equal(keyboardInterrupts, 2);
  const add = stepTimedXtCpu(m).record;
  assert.deepEqual([add.before.cs, add.before.ip, add.before.al, add.instruction?.bytes], [0x0c6f, 0x89ea, 1, [0x00, 0x06, 0x97, 0x58]]);
  assert.deepEqual(add.accesses.slice(-2), [
    { kind: "read", address: 0x215c7, value: 15 }, { kind: "write", address: 0x215c7, value: 16 },
  ]);
  assert.deepEqual([0x215c3, 0x215c6, 0x215c7].map(address => m.ram.read(address)), [13, 15, 16]);

  traceTableSelection(m);

  // Capture the two loads of DL and DH for this tile's plane 1 pass.
  const sourceReads: { address: number; value: number }[] = [];
  runInput(m, [], { limit: 1_000_000, until: (_, { before, after, accesses }) => {
    if (before.cs === 0x9d27 && before.si === 0x4a81 && before.di === 0x0b4f && (before.ip === 0x16c6 || before.ip === 0x16c9)) {
      const read = accesses.at(-1)!;
      assert.equal(read.kind, "read");
      sourceReads.push({ address: read.address, value: read.value });
    }
    return after.pc === destination.address && matchesXtDosObservation(draw, m, after);
  } });
  assert.deepEqual(sourceReads, [{ address: 0x914d9, value: 0xdf }, { address: 0x914dd, value: 0xff }]);

  const debug = createXtDebugger(() => m);
  debug.runUntilPixelChanges(123, 77);
  const store = debug.capture(() => stepTimedXtCpu(m).record);
  const hit = debug.pixelHit!;
  assert.deepEqual([store.before.cs, store.before.ip, store.before.dx], [0x9d27, 0x16cc, 0xffdf]);
  assert.deepEqual(store.accesses.slice(-2), [
    { kind: "write", address: 0xa0c17, value: 0xdf }, { kind: "write", address: 0xa0c18, value: 0xff },
  ]);
  assert.deepEqual([hit.store?.write.enabledPlanes, hit.store?.write.writeMode, hit.store?.write.bitMask], [2, 0, 255]);
  assert.deepEqual([hit.before.planeBytes, hit.after.planeBytes], [[4, 3, 19, 1], [4, 0xdf, 19, 1]]);
  assert.deepEqual([hit.before.colour, hit.after.colour], ["#AA0000", "#AA5500"]);
  debug.dispose();

  runInput(m, [], { limit: 1_000_000, until: (_, { after }) => after.cs === 0x0c6f && after.ip === 0x1d6c });
  // Each 16-dot source row has two groups of four plane bytes. The display has 40 bytes per line.
  for (let row = 0; row < 16; row++) {
    for (let half = 0; half < 2; half++) {
      for (let plane = 0; plane < 4; plane++) {
        const source = 0x8ca30 + 0x95 * 128 + row * 8 + half * 4 + plane;
        assert.equal(m.ega.planeByte(plane, 0x0b4f + row * 40 + half), m.ram.read(source));
      }
    }
  }
}
