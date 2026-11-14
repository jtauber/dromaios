import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { cocoHash, cocoSoftware, cocoSoftwareRoms } from "../helpers/coco-software.js";
import { cocoDisplayMode, renderCocoFrame } from "../../src/machines/6809/coco/runtime.js";

const media = [
  ["edtasm-plus", "df2bcb8064eddc028847b5078851b6ec82005ce0d88616343a1f8c9de3d3f372", "EDTASM+ 1.0"],
  ["wildcatting", "ddc1a5d4e7f83d364198ae760985b34d4f951e311fbf4ec7c3091805ce401383", "WILDCATTING"],
  ["polaris", "e6e3cb8bb3abb97f5179f2374ab0da4754ace777f3621a673c871ef25109c46d", "POLARIS"],
  ["art-gallery", "80640ff96b6611a62387c3d64ac94b135ffc501e8a42f898cca515477203303c", "A R T   G A L L E R Y"],
  ["project-nebula", "c9682d25f1bc53d1aad9ec81791fa12247d09cd41e0591bdb73fa0acabfdcc1b", "PROJECT NEBULA"],
] as const;

for (const [title, hash, heading] of media) test(`${title}: original cartridge boots, accepts input, and replays a packed checkpoint`, {
  skip: !(cocoSoftwareRoms && process.env.COCO_CARTRIDGE_DIR) && "Set the three COCO ROM paths and COCO_CARTRIDGE_DIR for Program Paks.",
}, async () => {
  const h = await cocoSoftware(), { session } = h;
  const image = readFileSync(join(process.env.COCO_CARTRIDGE_DIR!, title + ".ccc")); assert.equal(cocoHash(image), hash);
  session.mountCartridge(title + ".ccc", image);
  assert.equal(session.machine.cpu.snapshot().pc, 0xa027, "the actual Color BASIC reset vector, not a host cartridge jump");
  h.run(1_300_000); assert.ok(h.screen().includes(heading), h.screen());
  assert.equal(session.machine.disk.inspect().control, 0, "Disk BASIC was disconnected during cold boot");
  const key = (text: string) => { h.key(text); h.run(50_000); };
  const frame = () => renderCocoFrame(session.machine);
  if (title === "edtasm-plus") {
    for (const line of ["I", " ORG $6000", "START LDA #42", " STA $6100", " SWI", " END START"]) key(line + "\n");
    h.keys([["Break"]]); h.run(30_000); key("A/IM/AO/NL\n"); h.run(300_000);
    assert.match(h.screen(), /00000 TOTAL ERRORS/);
    assert.deepEqual(h.bytes(0x6000, 6), Uint8Array.of(0x86, 42, 0xb7, 0x61, 0, 0x3f));
    key("Z\n"); key("G6000\n"); assert.equal(session.machine.ram.read(0x6100), 42);
    assert.match(h.screen(), /BRK @ START\+5/);
  } else if (title === "art-gallery") {
    key("1"); assert.deepEqual(cocoDisplayMode(session.machine), { kind: "bitmap", width: 128, height: 96, bitsPerPixel: 2 });
    key("W"); const before = frame();
    // Move far enough to leave ink behind the blinking cursor.
    for (let i = 0; i < 4; i++) { h.keys([["ArrowRight"]]); h.run(50_000); }
    assert.notDeepEqual(frame(), before); assert.ok(frame().includes(3), "red ink selected with W");
  } else if (title === "wildcatting") {
    key("1"); key("JAMES\n"); key("N"); h.run(300_000);
    assert.match(h.screen(), /WEEK\s+1/); assert.match(h.screen(), /JAMES/);
    key(" "); assert.match(h.screen(), /X= 1  Y= 1/);
    h.keys([["ArrowRight"], ["ArrowDown"]]); h.run(50_000);
    assert.match(h.screen(), /X= 2  Y= 2/);
    key(" "); assert.match(h.screen(), /SURVEYOR'S REPORT/); assert.match(h.screen(), /LOCATION    X= 2  Y= 2/);
  } else {
    session.machine.pias.connectJoystick("right", true); session.machine.pias.setJoystickPosition("right", 32, 32);
    if (title === "project-nebula") { key(" "); assert.match(h.screen(), /INPUT GAME MODE/); key("1"); key("0"); }
    else key("1");
    h.run(1_000_000); assert.equal(cocoDisplayMode(session.machine).kind, "bitmap");
    const start = session.snapshot();
    function flight(x: number, fire: boolean) {
      session.restore(start); session.machine.pias.setJoystickPosition("right", x, 15); session.machine.pias.setJoystickButton("right", fire);
      let level = session.machine.pias.soundLevel, edges = 0;
      for (let i = 0; i < 500_000; i++) {
        session.step(); const next = session.machine.pias.soundLevel; if (next !== level) edges++; level = next;
      }
      assert.deepEqual(h.bytes(0x15a, 2), Uint8Array.of(x, 15), "ROM samples the actual joystick axes");
      return { pixels: frame(), edges };
    }
    const centre = flight(32, false), moved = flight(50, false), firing = flight(50, true);
    assert.notDeepEqual(moved.pixels, centre.pixels); assert.notDeepEqual(firing.pixels, moved.pixels);
    if (title === "project-nebula") assert.ok(firing.edges > 100, "the game produces sound");
    session.machine.pias.setJoystickButton("right", false);
  }
  h.checkpoint.save(session.snapshot()); h.run(10_000); const expected = session.snapshot(), raster = frame();
  session.powerOn(); session.ejectCartridge(); session.restore(h.checkpoint.read()!.state); h.run(10_000);
  assert.deepEqual(session.snapshot(), expected); assert.deepEqual(frame(), raster);
  assert.equal(session.cartridgeName, title + ".ccc");
});
