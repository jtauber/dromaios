import assert from "node:assert/strict";
import { dosTransfer } from "./dos-transfer.js";
import { runInput } from "./rom-console.js";

type Xt = Parameters<typeof runInput>[0];

/** Drive Ultima V through the XT keyboard and observe the live record loaded from SAVED.GAM. */
export function ultimaVParty(machine: Xt, base: number) {
  const position = () => [0x2ed, 0x2f0, 0x2f1].map(offset => machine.ram.read(base + offset)); // Location, X, Y

  function press(scan: number) {
    let consumed = false;
    const { keyboardInterrupts } = runInput(machine, [scan, scan | 0x80], { limit: 2_000_000, until: (_, { before, instruction }) => {
      if (instruction?.bytes[0] !== 0xcd || instruction.bytes[1] !== 0x16) return false;
      if (before.ah === 0) consumed = true;
      // Return to the game's keyboard poll after it consumes the key and finishes drawing.
      return consumed && before.cs === 0x0c6f && before.ip === 0x1d6c && before.ah === 1;
    } });
    assert.equal(keyboardInterrupts, 2); // One make and one break.
  }

  function move(scan: number, location: number, x: number, y: number) {
    press(scan); assert.deepEqual(position(), [location, x, y]);
  }

  function leaveHut() {
    assert.deepEqual(position(), [13, 15, 16]);
    for (let y = 17; y <= 18; y++) move(0x50, 13, 15, y);
    press(0x18); press(0x50); // O, Down opens the south door.
    for (let y = 19; y <= 31; y++) move(0x50, 13, 15, y);
    press(0x50); // "Dost thou wish to leave?"
    move(0x15, 0, 45, 62); // Y enters Britannia.
  }

  function save() {
    press(0x10); // Q: Quit and Save.
    const saved = dosTransfer(machine, [0x15, 0x95], "write", 4192); // Y at "Save game?"
    // DOS writes SAVED.OOL next. Export only after the BIOS releases the drive motor.
    runInput(machine, [], { limit: 2_000_000, until: (_, { before, instruction }) =>
      !machine.io.disketteMotorOn && before.cs === 0x0c6f && before.ah === 1
      && instruction?.bytes[0] === 0xcd && instruction.bytes[1] === 0x16 });
    return { record: saved.bytes, disk: machine.io.exportDiskette() };
  }

  return { position, move, leaveHut, save };
}
