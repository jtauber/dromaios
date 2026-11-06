import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Apple2Video } from "../../src/components/devices/generated/apple2-video.js";
import { romImages } from "../../src/machines/generated/6502/apple2.js";
import { literateBlocks } from "../../src/literate.js";
import { applesoftArrayElement, applesoftArrays, applesoftDataCursor, applesoftMemoryLayout, applesoftStatementText, applesoftVariables } from "../../site/interactive/apple2-applesoft.js";
import { applesoftStepBoundary } from "../../site/interactive/apple2-applesoft-step.js";
import { applesoftStack } from "../../site/interactive/apple2-applesoft-stack.js";
import { applesoftErrorName, applesoftErrorState } from "../../site/interactive/apple2-applesoft-errors.js";
import { createApplesoftHistory } from "../../site/interactive/apple2-applesoft-history.js";
import { createApplesoftProfile } from "../../site/interactive/apple2-applesoft-profile.js";
import { createApplesoftBreakpoints } from "../../site/interactive/apple2-applesoft-breakpoints.js";
import { apple2DebugLocation } from "../../site/interactive/apple2-debugger.js";
import { createInstructionDebugger } from "../../site/interactive/instruction-debugger.js";
import { apple2LoresFrame, apple2TextFrame } from "../../site/interactive/apple2-screen.js";
import { createApple2Session, apple2Input, apple2ControlKey } from "../../site/interactive/apple2-session.js";
import { createExecutionController } from "../../site/interactive/execution-controller.js";
import { readRomFile } from "../../site/interactive/rom-file.js";

const romPath = process.env.APPLE2_ROM;
const chapter = readFileSync("src/machines/6502/apple2.md", "utf8");
const container = JSON.parse(chapter.match(/```json\n([\s\S]*?)```/)![1]!);

test("Apple II host input is uppercase ASCII with original editing and break keys", () => {
  assert.deepEqual(apple2Input("print 2+3\r\n"), [..."PRINT 2+3\r"].map(c => c.charCodeAt(0)));
  for (const text of ["one\ntwo", "ß", "é", "🎹"]) assert.throws(() => apple2Input(text));
  const event = { ctrlKey: false, metaKey: false, altKey: false, isComposing: false };
  for (const [key, byte] of [["Backspace", 8], ["ArrowLeft", 8], ["ArrowRight", 21], ["Escape", 27], ["Enter", 13]] as const) {
    assert.equal(apple2ControlKey({ ...event, key }), byte);
    assert.equal(apple2ControlKey({ ...event, key, isComposing: true }), undefined);
  }
  assert.equal(apple2ControlKey({ ...event, key: "c", ctrlKey: true }), 3);
  assert.equal(apple2ControlKey({ ...event, key: "c", metaKey: true }), undefined);
  assert.equal(apple2ControlKey({ ...event, key: "a", ctrlKey: true }), undefined);
});

test("frame inspection reads selected RAM cells without guest I/O and blanks graphics rows", () => {
  const video = new Apple2Video();
  video.write(5, 0); video.write(0, 0); video.write(3, 0);
  const before = video.snapshot(), reads: number[] = [];
  const frame = apple2TextFrame({ read(address) { reads.push(address); return 0x41; } }, video, true);
  assert.equal(reads.length, 160);
  assert.equal(reads[0], 0xa50); assert.equal(reads.at(-1), 0xbf7);
  assert.ok(frame.slice(0, 20).flat().every(cell => cell.character === " " && !cell.inverse));
  assert.ok(frame.slice(20).flat().every(cell => cell.character === "A" && cell.inverse));
  assert.deepEqual(video.snapshot(), before);
});

test("browser Apple II session boots real ROM, pastes BASIC, edits, pauses, breaks, and powers on", {
  skip: romPath === undefined ? "Set APPLE2_ROM to the externally supplied Apple II Plus ROM" : false,
}, async t => {
  assert.ok(romPath);
  const buffer = new Uint8Array(readFileSync(romPath)).buffer;
  const { image } = await readRomFile({ name: "apple2p.rom", size: buffer.byteLength, async arrayBuffer() { return buffer; } }, romImages.firmware, container);
  const session = createApple2Session(), pending: (() => void)[] = [];
  const hardware = session.machine;
  hardware.ram.write(0xbfff, 0x5a);
  const initial = hardware.snapshot();
  session.installFirmware(image);
  assert.equal(session.machine, hardware);
  assert.equal(session.hasFirmware, true);
  assert.deepEqual(hardware.snapshot(), { ...initial, firmware: romImages.firmware.sha256 });
  session.reset();
  assert.equal(hardware.ram.read(0xbfff), 0x5a);
  assert.equal(hardware.cpu.snapshot().pc, 0xfa62);
  assert.equal(hardware.cpu.snapshot().sp, 0xfc);
  const pointsForHistory = createApplesoftBreakpoints(() => session.machine);
  const history = createApplesoftHistory(pointsForHistory.listing);
  const profile = createApplesoftProfile(pointsForHistory.listing);
  function stepWithHistory() {
    const machine = session.machine, before = apple2DebugLocation(machine);
    const record = session.step();
    if (record.outcome === "executed") {
      history.observe(machine, before); profile.observe(machine, before, record.after);
    }
    return record;
  }
  const execution = createExecutionController({
    step: stepWithHistory, canStep: () => true, onChange() {}, batchSize: 2000,
    schedule(callback) { pending.push(callback); return () => {}; },
  });
  function screen(): string {
    return apple2TextFrame(session.machine.ram, session.machine.video, false)
      .map(row => row.map(cell => cell.character).join("").trimEnd()).join("\n").trim();
  }
  function runUntil(ready: () => boolean): void {
    execution.run();
    for (let batch = 0; batch < 200 && !ready(); batch++) pending.shift()!();
    assert.equal(execution.error, undefined);
    assert.ok(ready(), `Condition not reached:\n${screen()}`);
    execution.stop();
  }
  function idle(): boolean {
    const pc = session.machine.cpu.snapshot().pc;
    return session.pendingInput === 0 && !session.machine.keyboard.snapshot().strobe && pc >= 0xfd1b && pc <= 0xfd2f;
  }
  function command(text: string): void { session.send(apple2Input(text + "\n")); runUntil(idle); }
  runUntil(idle);
  assert.match(screen(), /APPLE \]\[/); assert.match(screen(), /\]$/);
  for (const line of ["new", "20 end", "10 print 2+3", "list"]) command(line);
  assert.match(screen(), /\n10\s+PRINT 2\s*\+\s*3\n20\s+END\n/);
  command("run"); assert.match(screen(), /\]RUN\n5\n/);
  session.send([...apple2Input("PRINT 2+9"), 8, ...apple2Input("3\n")]); runUntil(idle);
  assert.match(screen(), /\]PRINT 2\+3\n5\n/);

  session.send(apple2Input("print 1+1\n"));
  const paused = session.machine.snapshot(), queued = session.pendingInput, count = execution.steps;
  for (const callback of pending.splice(0)) callback();
  screen(); assert.deepEqual(session.machine.snapshot(), paused);
  assert.equal(session.pendingInput, queued); assert.equal(execution.steps, count);
  execution.step(); assert.equal(execution.steps, count + 1);
  runUntil(idle); assert.match(screen(), /\]PRINT 1\+1\n2\n/);
  assert.throws(() => session.send([65, 128]), RangeError); assert.equal(session.pendingInput, 0);
  assert.throws(() => session.send(new Array(4097).fill(65)), /queue is full/);
  assert.equal(session.pendingInput, 0);

  for (const line of ["new", "10 goto 10"]) command(line);
  session.send(apple2Input("run\n"));
  const ram = session.machine.ram;
  runUntil(() => session.pendingInput === 0 && ram.read(0x75) === 10 && ram.read(0x76) === 0);
  session.send([3]); runUntil(idle);
  assert.match(screen(), /BREAK IN 10/);
  command("print 1+1"); assert.match(screen(), /\]PRINT 1\+1\n2\n/);

  // Run the ROM guide's scalar example and use PRINT as the independent value oracle.
  const guide = readFileSync("docs/software/apple2p-rom.md", "utf8");
  const [scalarExample, memoryExample, arrayExample, stepExample, stackExample, profileExample, dataExample, errorExample] = literateBlocks(guide, "basic", line => { throw new Error(`Unclosed BASIC fence at ${line}`); });
  assert.ok(scalarExample);
  command("NEW");
  for (const line of scalarExample.lines) command(line.text);
  command("RUN");
  const { variables } = applesoftVariables(ram);
  assert.deepEqual(variables.map(v => [v.name, v.value]), [["X", "1.5"], ["N%", "-42"], ["A$", '"HELLO"']]);
  for (const variable of variables) {
    command(`PRINT ${variable.name}`);
    const output = variable.value.replace(/^"|"$/g, "");
    assert.ok(screen().endsWith(`]PRINT ${variable.name}\n${output}\n\n]`), screen());
  }
  assert.deepEqual(variables.map(v => ram.read(v.address)), [0x58, 0xce, 0x41]);
  const string = variables[2]!;
  assert.equal(string.contentsAddress, 0x081e);
  assert.equal(String.fromCharCode(...Array.from({ length: 5 }, (_, i) => ram.read(string.contentsAddress! + i))), "HELLO");
  command('A$=A$+"!"');
  const appended = applesoftVariables(ram).variables[2]!;
  assert.equal(appended.address, string.address); assert.notEqual(appended.contentsAddress, string.contentsAddress);
  assert.equal(appended.value, '"HELLO!"');
  command("CLEAR");
  assert.deepEqual(applesoftVariables(ram).variables, []);

  assert.ok(arrayExample);
  command("NEW");
  for (const line of arrayExample.lines) command(line.text);
  command("RUN");
  const { arrays } = applesoftArrays(ram);
  assert.deepEqual(arrays.map(a => [a.name, a.dimensions]), [["N%", [2, 3]], ["R", [2]], ["A$", [2]]]);
  const [integers, reals, strings] = arrays;
  const elements = [
    applesoftArrayElement(ram, integers!, 1), applesoftArrayElement(ram, integers!, 2),
    applesoftArrayElement(ram, reals!, 1), applesoftArrayElement(ram, strings!, 1),
  ];
  assert.deepEqual(elements.map(v => [v.name, v.value]), [
    ["N%(1,0)", "-42"], ["N%(0,1)", "1234"], ["R(1)", "1.5"], ["A$(1)", '"HELLO"'],
  ]);
  for (const element of elements) {
    command(`PRINT ${element.name}`);
    assert.ok(screen().endsWith(`]PRINT ${element.name}\n${element.value.replace(/^"|"$/g, "")}\n\n]`), screen());
  }
  const bytesAt = (at: number, count: number) => Array.from({ length: count }, (_, i) => ram.read(at + i));
  assert.deepEqual(bytesAt(elements[0]!.address, 4), [0xff, 0xd6, 0x04, 0xd2]);
  assert.deepEqual(bytesAt(elements[2]!.address, 5), [0x81, 0x40, 0, 0, 0]);
  const chars = elements[3]!.contentsAddress!;
  assert.deepEqual(bytesAt(elements[3]!.address, 3), [5, chars & 0xff, chars >> 8]);
  assert.equal(String.fromCharCode(...bytesAt(chars, 5)), "HELLO");
  command("CLEAR");
  assert.deepEqual(applesoftArrays(ram).arrays, []);

  function stepBasic(): string | undefined {
    const debug = createInstructionDebugger(100_000), location = () => apple2DebugLocation(hardware);
    debug.stepUntil(location(), at => applesoftStepBoundary(hardware, at, session.pendingInput));
    while (!debug.beforeStep(location)) {
      assert.equal(stepWithHistory().outcome, "executed");
      debug.observeBoundary();
    }
    assert.equal(debug.stop?.kind, "step");
    return debug.stop.detail;
  }
  assert.ok(stepExample);
  for (const line of stepExample.lines) command(line.text);
  session.send(apple2Input("RUN\n"));
  const before = (line: number, address: string) => assert.equal(stepBasic(), `Before Applesoft line ${line} at $${address}.`);
  const integer = (index: number) => applesoftArrayElement(ram, applesoftArrays(ram).arrays[0]!, index).value;
  before(10, "0805"); assert.deepEqual(applesoftArrays(ram).arrays, []);
  before(20, "081D"); assert.deepEqual([integer(2), integer(1)], ["0", "0"]);
  before(20, "082A"); assert.deepEqual([integer(2), integer(1)], ["1234", "0"]);
  before(30, "083A"); assert.equal(integer(1), "-42");
  before(30, "0843");
  before(40, "0855");
  for (const value of ["1", "2"]) {
    before(40, "085C"); before(40, "0866"); assert.equal(integer(0), value);
  }
  before(50, "086C"); before(50, "0871"); before(50, "087B"); assert.equal(integer(0), "7");
  assert.equal(stepBasic(), "Applesoft ] prompt."); assert.match(screen(), /\n\n\]$/);
  assert.equal(stepBasic(), "Waiting for keyboard input.");

  await t.test("source breakpoints follow assignments across loops, edits and checkpoint restore", () => {
    let inspected = session.machine;
    const points = createApplesoftBreakpoints(() => inspected);
    const debug = createInstructionDebugger(), location = () => apple2DebugLocation(hardware);
    const sourceAt = (line: number, slot: number) => points.listing().lines.find(l => l.number === line)!.statements[slot]!;
    const assignment = sourceAt(20, 1), loop = sourceAt(40, 1);
    assert.ok(points.toggle(20, 1, assignment)); assert.ok(points.toggle(40, 1, loop));
    function resumeToPoint(line: number, slot: number): void {
      debug.run(location());
      let budget = 100_000;
      while (!debug.beforeStep(location, points.match)) {
        assert.ok(budget-- > 0, "Expected a statement breakpoint");
        assert.equal(session.step().outcome, "executed"); debug.observeBoundary();
      }
      assert.equal(debug.stop?.kind, "breakpoint");
      const address = sourceAt(line, slot).address;
      assert.equal(ram.read(0xb8) | ram.read(0xb9) << 8, address);
      assert.match(debug.stop.detail!, new RegExp(`line ${line}, statement ${slot + 1} `));
    }
    command("5 REM MOVE THE PROGRAM"); // Same statements, different token addresses.
    session.send(apple2Input("RUN\n"));
    resumeToPoint(20, 1); assert.notEqual(sourceAt(20, 1).address, assignment.address);
    assert.deepEqual([integer(2), integer(1)], ["1234", "0"]);
    resumeToPoint(40, 1); assert.deepEqual([integer(1), integer(0)], ["-42", "0"]);
    resumeToPoint(40, 1); assert.equal(integer(0), "1");
    runUntil(idle);
    command("20 N%(0,1)=1234:N%(1,0)=-43");
    points.reconcile();
    assert.equal(points.selected(20, 1, assignment), false);
    assert.equal(points.toggle(20, 1, assignment), false, "A stale listing cannot arm a different statement");
    assert.ok(points.selected(40, 1, sourceAt(40, 1)));
    const restored = createApple2Session(image);
    restored.restore(session.snapshot()); inspected = restored.machine; points.reconnect();
    assert.ok(points.selected(40, 1, sourceAt(40, 1)), "A checkpoint with matching source retains its marker");
    restored.powerOn(); inspected = restored.machine; points.reconnect(); assert.equal(points.active, false);
  });

  await t.test("RETURN reaches the displayed NEXT statement and leaves the FOR frame active", () => {
    assert.ok(stackExample); command("NEW");
    for (const line of stackExample.lines) command(line.text);
    history.clear();
    history.clearCounts();
    const source = pointsForHistory.listing();
    const counts = () => pointsForHistory.listing().lines.map(line =>
      line.statements.map((statement, index) => history.count({ line: line.number, index, statement })));
    const stack = () => applesoftStack(hardware, source);
    session.send(apple2Input("RUN\n"));
    before(10, "0805"); assert.deepEqual(stack(), { frames: [] });
    assert.equal(history.total, 0, "Pausing before the first statement has not dispatched it");
    const loop = (value: string) => ({ kind: "FOR", address: 0x1e7, variable: "I", value, step: "1", limit: "2",
      destination: { kind: "statement", line: 10, address: 0x080c, text: "GOSUB 100" } });
    const call = { kind: "GOSUB", address: 0x1e0,
      destination: { kind: "statement", line: 10, address: 0x0811, text: "NEXT I" } };
    for (const value of ["1", "2"]) {
      before(10, "080C"); assert.deepEqual(stack(), { frames: [loop(value)] });
      before(100, "081E");
      const saved = session.snapshot();
      assert.deepEqual(stack(), { frames: [call, loop(value)] }); assert.deepEqual(session.snapshot(), saved);
      assert.deepEqual(bytesAt(0x1e0, 5), [0xb0, 10, 0, 0x0d, 8]);
      before(100, "0821"); assert.deepEqual(stack(), { frames: [call, loop(value)] });
      before(10, "0811"); assert.deepEqual(stack(), { frames: [loop(value)] });
    }
    before(20, "0818"); assert.deepEqual(stack(), { frames: [] });
    assert.deepEqual(counts(), [[1, 2, 2], [0], [2, 2]], "The ROM has reached END but has not dispatched it");
    const visits = () => history.visits.map(({ line, statement }) => `${line} ${applesoftStatementText(statement)}`);
    const trip = ["10 GOSUB 100", "100 PRINT I", "100 RETURN", "10 NEXT I"];
    assert.deepEqual(visits(), ["10 FOR I = 1 TO 2", ...trip, ...trip]);
    assert.equal(stepBasic(), "Applesoft ] prompt."); assert.ok(screen().endsWith("]RUN\n1\n2\n\n]"));
    assert.deepEqual(visits(), ["10 FOR I = 1 TO 2", ...trip, ...trip, "20 END"]);
    assert.deepEqual(counts(), [[1, 2, 2], [1], [2, 2]]);
    assert.ok(stack().message);

    command("10 FOR I=1 TO 40:GOSUB 100:NEXT I");
    assert.deepEqual(counts(), [[0, 2, 2], [1], [2, 2]]);
    history.clearCounts(); command("RUN");
    assert.deepEqual(counts(), [[1, 40, 40], [1], [40, 40]]);
    assert.equal(history.visits.length, 32);
    assert.ok(screen().endsWith("39\n40\n\n]"));
  });

  await t.test("nested GOSUBs return twice and GOTO adds no call to the subroutine profile", () => {
    assert.ok(profileExample); command("NEW");
    for (const line of profileExample.lines) command(line.text);
    profile.clear(); history.clearCounts();
    const summary = () => profile.entries().map(p => [p.target.line, p.caller.line, p.caller.index, p.calls, p.returned, p.active]);
    const stop = (number: number, slot = 0) => {
      const statement = pointsForHistory.listing().lines.find(line => line.number === number)!.statements[slot]!;
      before(number, statement.address.toString(16).toUpperCase().padStart(4, "0"));
    };
    session.send(apple2Input("RUN\n"));
    stop(10); assert.deepEqual(summary(), []);
    for (let i = 1; i <= 2; i++) {
      stop(10, 1); stop(100); stop(200);
      assert.deepEqual(summary(), [[100, 10, 1, i, i - 1, 1], [200, 100, 0, i, i - 1, 1]]);
      const saved = session.snapshot(); profile.entries(); assert.deepEqual(session.snapshot(), saved);
      stop(210); stop(100, 1);
      assert.deepEqual(summary(), [[100, 10, 1, i, i - 1, 1], [200, 100, 0, i, i, 0]]);
      stop(10, 2);
    }
    stop(20); stop(200); stop(200, 1);
    assert.deepEqual(summary(), [[100, 10, 1, 2, 2, 0], [200, 100, 0, 2, 2, 0]]);
    const conditional = pointsForHistory.listing().lines.find(line => line.number === 200)!.statements[0]!;
    assert.equal(history.count({ line: 200, index: 0, statement: conditional }), 3);
    assert.equal(stepBasic(), "Applesoft ] prompt.");
    assert.deepEqual(summary(), [[100, 10, 1, 2, 2, 0], [200, 100, 0, 2, 2, 0]]);
  });

  await t.test("profiles distinguish ON GOSUB, POP, STOP/CONT, and failed target lookups", () => {
    const summary = () => profile.entries().map(p => [p.target.line, p.calls, p.returned, p.active]);
    function program(lines: string[]): void {
      command("NEW"); for (const line of lines) command(line); profile.clear(); command("RUN");
    }
    program(["10 ON 2 GOSUB 100,200:END", "100 RETURN", "200 POP:END"]);
    assert.deepEqual(summary(), [[200, 1, 0, 0]]);
    program(["10 GOSUB 100:END", "100 STOP:RETURN"]);
    assert.deepEqual(summary(), [[100, 1, 0, 1]]);
    command("CONT"); assert.deepEqual(summary(), [[100, 1, 1, 0]]);
    program(["10 GOSUB 100:END", "100 STOP:RETURN"]);
    profile.clear(); command("CONT"); assert.deepEqual(summary(), []);
    program(["10 I=0:GOSUB 100:END", "100 I=I+1:IF I=3 THEN STOP", "110 IF I<3 THEN GOSUB 100", "120 RETURN"]);
    assert.deepEqual(summary(), [[100, 1, 0, 1], [100, 2, 0, 2]]);
    command("CONT"); assert.deepEqual(summary(), [[100, 1, 1, 0], [100, 2, 2, 0]]);
    program(["10 GOSUB 999:END"]);
    assert.deepEqual(summary(), []); assert.match(screen(), /UNDEF'D STATEMENT ERROR/);
    program(["10 GOSUB 100:END", "100 PRINT 1/0"]);
    assert.deepEqual(summary(), [[100, 1, 0, 0]]); assert.match(screen(), /DIVISION BY ZERO/);
  });

  await t.test("string allocation and collection match the guide's memory layout and FRE output", () => {
    assert.ok(memoryExample);
    const ceiling = ram.read(0x73) | ram.read(0x74) << 8;
    command("NEW"); for (const line of memoryExample.lines) command(line.text);
    session.send(apple2Input("RUN\n"));
    const sizes = () => applesoftMemoryLayout(ram).regions.map(region => region.end - region.start);
    const stop = (line: number) => {
      const statement = pointsForHistory.listing().lines.find(l => l.number === line)!.statements[0]!;
      before(line, statement.address.toString(16).toUpperCase().padStart(4, "0"));
    };
    const scalar = () => applesoftVariables(ram).variables[0]!;
    const element = () => applesoftArrayElement(ram, applesoftArrays(ram).arrays[0]!, 0);
    stop(10); stop(20);
    assert.deepEqual(sizes(), [107, 0, 0, 14228, 0]);
    stop(30); assert.deepEqual(sizes(), [107, 0, 13, 14215, 0]);
    const arrayAddress = applesoftArrays(ram).arrays[0]!.address;
    stop(40); assert.deepEqual(sizes(), [107, 7, 13, 14208, 0]);
    assert.equal(applesoftArrays(ram).arrays[0]!.address, arrayAddress + 7);
    assert.equal(scalar().contentsAddress, 0x81f); assert.equal(scalar().value, '"HELLO"');
    stop(50); assert.deepEqual(sizes(), [107, 7, 13, 14202, 6]);
    assert.equal(scalar().contentsAddress, 0x3ffa); assert.equal(scalar().value, '"HELLO!"');
    stop(60); assert.deepEqual(sizes(), [107, 7, 13, 14196, 12]);
    assert.equal(element().contentsAddress, 0x3ff4); assert.equal(element().value, '"HELLO!"');
    stop(70); assert.deepEqual(sizes(), [107, 7, 13, 14189, 19]);
    assert.equal(scalar().contentsAddress, 0x3fed); assert.equal(scalar().value, '"HELLO!?"');
    stop(80); assert.deepEqual(sizes(), [107, 7, 13, 14189, 19]);
    assert.equal(scalar().contentsAddress, undefined); assert.equal(scalar().value, '""');
    const saved = session.snapshot();
    applesoftMemoryLayout(ram); assert.deepEqual(session.snapshot(), saved, "Inspecting allocation does not collect strings");
    stop(90); assert.deepEqual(sizes(), [107, 7, 13, 14202, 6]);
    assert.equal(element().contentsAddress, 0x3ffa); assert.equal(element().value, '"HELLO!"');
    assert.deepEqual(bytesAt(element().address, 3), [6, 0xfa, 0x3f]);
    assert.deepEqual(bytesAt(0x3ffa, 6), [..."HELLO!"].map(c => c.charCodeAt(0)));
    assert.equal(stepBasic(), "Applesoft ] prompt.");
    assert.ok(screen().endsWith("]RUN\n14202\n\n]"));
    command("PRINT B$(0)"); assert.ok(screen().endsWith("]PRINT B$(0)\nHELLO!\n\n]"));
    const restored = createApple2Session(image); restored.restore(saved);
    const restoredRam = restored.machine.ram;
    assert.deepEqual(applesoftMemoryLayout(restoredRam).regions.map(region => region.end - region.start), [107, 7, 13, 14189, 19]);
    assert.equal(applesoftArrayElement(restoredRam, applesoftArrays(restoredRam).arrays[0]!, 0).contentsAddress, 0x3ff4);
    command("CLEAR"); assert.deepEqual(sizes(), [107, 0, 0, 14228, 0]);
    command("NEW"); assert.deepEqual(sizes(), [3, 0, 0, 14332, 0]);
    command(`HIMEM:${ceiling}`);
  });

  await t.test("READ and RESTORE expose the saved DATA cursor through rewinding, exhaustion and partial failure", () => {
    assert.ok(dataExample);
    command("NEW"); for (const line of dataExample.lines) command(line.text);
    const cursor = () => applesoftDataCursor(ram, pointsForHistory.listing());
    const check = (address: number, line?: number, index?: number) => {
      const value = cursor(); assert.deepEqual([value.address, value.source?.line, value.source?.index], [address, line, index]);
    };
    const stop = (line: number, index = 0) => {
      const statement = pointsForHistory.listing().lines.find(l => l.number === line)!.statements[index]!;
      before(line, statement.address.toString(16).toUpperCase().padStart(4, "0"));
    };
    const value = (name: string) => applesoftVariables(ram).variables.find(v => v.name === name)?.value;
    session.send(apple2Input("RUN\n"));
    stop(10); stop(10, 1); stop(20); stop(30); check(0x800);
    stop(40); check(0x809, 10, 0); assert.equal(value("N"), "12");
    stop(50); check(0x815, 10, 0); assert.equal(value("A$"), '"RED, BLUE"');
    stop(50, 1); check(0x81c, 10, 1); assert.equal(value("X"), "-3.5");
    stop(60); check(0x829, 20, 0); assert.equal(value("B$"), '"DONE"');
    const saved = session.snapshot(); cursor(); assert.deepEqual(session.snapshot(), saved);
    stop(70); check(0x800); assert.equal(ram.read(0x7b), 20, "RESTORE leaves DATLIN stale");
    stop(80); check(0x829, 20, 0);
    assert.deepEqual([value("M"), value("C$"), value("Y"), value("D$")], ["12", '"RED, BLUE"', "-3.5", '"DONE"']);
    assert.equal(stepBasic(), "Applesoft ] prompt.");
    assert.ok(screen().endsWith("?OUT OF DATA ERROR IN 80\n]"));
    check(0x829, 20, 0); assert.equal(ram.read(0x7b), 80, "The failed search advances DATLIN beyond the saved cursor");
    for (const name of ["N", "A$", "X", "B$"]) {
      command(`PRINT ${name}`);
      assert.ok(screen().endsWith(`]PRINT ${name}\n${value(name)!.replace(/^"|"$/g, "")}\n\n]`));
    }
    const restored = createApple2Session(image); restored.restore(saved);
    const points = createApplesoftBreakpoints(() => restored.machine), restoredRam = restored.machine.ram;
    assert.equal(applesoftDataCursor(restoredRam, points.listing()).address, 0x829);
    let budget = 100_000;
    while (restored.machine.cpu.snapshot().pc !== 0xfd21) {
      assert.ok(budget-- > 0); assert.equal(restored.step().outcome, "executed");
    }
    assert.equal(applesoftVariables(restoredRam).variables.find(v => v.name === "C$")?.value, '"RED, BLUE"');
    assert.equal(applesoftDataCursor(restoredRam, points.listing()).source?.line, 20);
    command("RESTORE"); check(0x800);
    command("READ Q,E$,R,F$,S"); assert.match(screen(), /OUT OF DATA/);
    check(0x800); assert.deepEqual([value("Q"), value("E$"), value("R"), value("F$")], ["12", '"RED, BLUE"', "-3.5", '"DONE"']);
    command("READ T"); assert.equal(value("T"), "12"); check(0x809, 10, 0);
  });

  await t.test("ONERR captures division by zero and RESUME retries only the failing statement, including after restore", () => {
    assert.ok(errorExample);
    command("NEW"); for (const line of errorExample.lines) command(line.text);
    const state = () => applesoftErrorState(ram, pointsForHistory.listing());
    const value = (name: string) => applesoftVariables(ram).variables.find(v => v.name === name)?.value;
    session.send(apple2Input("RUN\n"));
    before(10, "0805"); assert.equal(state().enabled, false);
    before(20, "080F");
    assert.equal(state().enabled, true);
    assert.deepEqual([state().handler.line, state().handler.pointer, state().handler.target], [10, 0x807, 100]);
    assert.equal(state().handler.source?.statement.address, 0x805);
    assert.equal(state().handler.destination?.statement.address, 0x835);
    before(30, "0817"); before(30, "081D"); assert.equal(value("N"), "1"); assert.equal(value("D"), "0");
    before(100, "0835");
    assert.deepEqual(bytesAt(0xda, 6), [30, 0, 0x1c, 8, 133, 0xf8]);
    const saved = state().saved!;
    assert.deepEqual([saved.line, saved.pointer, saved.code, saved.stack], [30, 0x81c, 133, 0xf8]);
    assert.equal(applesoftErrorName(hardware.firmware, saved.code), "DIVISION BY ZERO");
    assert.equal(saved.source?.index, 1); assert.equal(saved.source?.statement.address, 0x81d);
    before(110, "083D"); assert.equal(value("D"), "2");
    const checkpoint = session.snapshot(); state(); assert.deepEqual(session.snapshot(), checkpoint);
    before(30, "081D"); assert.equal(value("N"), "1");
    assert.equal(hardware.cpu.snapshot().sp, 0xf6, "RESUME restored $F8, then the dispatcher pushed its two-byte return address");
    before(40, "0828"); assert.equal(value("Q"), "21"); before(50, "082F");
    assert.equal(stepBasic(), "Applesoft ] prompt."); assert.ok(screen().endsWith("]RUN\n21\n\n]"));
    assert.deepEqual(state().saved, saved, "Successful RESUME leaves the saved error in RAM");
    for (const [expression, result] of [["Q", "21"], ["N", "1"], ["PEEK(222)", "133"]]) {
      command(`PRINT ${expression}`); assert.ok(screen().endsWith(`]PRINT ${expression}\n${result}\n\n]`));
      assert.equal(state().enabled, false, "Entering a new direct command disables ONERR");
      assert.equal(state().saved?.code, 133); assert.equal(state().saved?.source, undefined);
    }
    const restored = createApple2Session(image); restored.restore(checkpoint);
    const points = createApplesoftBreakpoints(() => restored.machine), restoredRam = restored.machine.ram;
    assert.deepEqual(applesoftErrorState(restoredRam, points.listing()).saved, saved);
    let budget = 100_000;
    while (restored.machine.cpu.snapshot().pc !== 0xfd21) {
      assert.ok(budget-- > 0); assert.equal(restored.step().outcome, "executed");
    }
    assert.deepEqual(applesoftVariables(restoredRam).variables.filter(v => ["Q", "N"].includes(v.name)).map(v => [v.name, v.value]), [["N", "1"], ["Q", "21"]]);
    command("POKE 216,0"); assert.equal(state().enabled, false); assert.equal(state().saved?.code, 133);
    assert.equal(state().saved?.source, undefined);
    command("RUN"); assert.equal(state().enabled, true);
    command("30 N=N+1:Q=84/D"); assert.equal(state().enabled, false);
    assert.equal(state().handler.source, undefined); assert.equal(state().saved?.source, undefined);
    command("NEW");
    for (const line of ["10 ONERR GOTO 100", "20 NEXT", "100 END"]) command(line);
    session.send(apple2Input("RUN\n")); before(10, "0805"); before(20, "080F"); before(100, "0815");
    assert.equal(state().saved?.code, 0); assert.equal(applesoftErrorName(hardware.firmware, 0), "NEXT WITHOUT FOR");
    assert.equal(state().saved?.pointer, 0x80a); assert.equal(state().saved?.source?.statement.address, 0x80f);
    assert.equal(stepBasic(), "Applesoft ] prompt."); command("POKE 216,0");
  });

  // The published program executes unchanged; expected blocks are independent of its drawing loops.
  const examples = literateBlocks(chapter, "basic", line => { throw new Error(`Unclosed BASIC fence at ${line}`); });
  assert.equal(examples.length, 2);
  command("NEW");
  for (const line of examples[0]!.lines) command(line.text);
  command("RUN");
  assert.match(screen(), /16 COLOURS/);
  const video = session.machine.video;
  assert.deepEqual(video.snapshot(), { text: false, mixed: true, page2: false, hires: false });
  let graphics = apple2LoresFrame(ram, video);
  assert.deepEqual(graphics.slice(0, 32), Array.from({ length: 32 }, (_, row) => new Array(40).fill(Math.floor(row / 2))));
  assert.deepEqual(graphics.slice(32, 40), Array.from({ length: 8 }, (_, row) => Array.from({ length: 40 }, (_, column) =>
    column === 0 || row === 7 && column === 39 ? 15 : 0)));
  assert.ok(graphics.slice(40).every(row => row === undefined));
  const inspected = session.machine.snapshot();
  apple2TextFrame(ram, video, true); apple2LoresFrame(ram, video);
  assert.deepEqual(session.machine.snapshot(), inspected);

  // Page two overlaps BASIC storage, including the zero byte required immediately before the program.
  command("POKE 2048,241:POKE 3063,195:POKE 49237,0");
  graphics = apple2LoresFrame(ram, video);
  assert.equal(graphics[0]![0], 1); assert.equal(graphics[1]![0], 15);
  assert.equal(graphics[46], undefined);
  command("POKE 49234,0"); // Full graphics reveals the bottom eight block rows.
  graphics = apple2LoresFrame(ram, video);
  assert.equal(graphics[46]![39], 3); assert.equal(graphics[47]![39], 12);
  command("POKE 49239,0"); // High-resolution mode must not expose low-resolution rows.
  assert.ok(apple2LoresFrame(ram, video).every(row => row === undefined));
  command("POKE 49238,0:POKE 49236,0:POKE 49235,0");
  assert.deepEqual(apple2LoresFrame(ram, video).slice(0, 32), Array.from({ length: 32 }, (_, row) => new Array(40).fill(Math.floor(row / 2))));
  command("POKE 2048,0"); // Restore Applesoft's leading zero before running the program again.
  command("TEXT");
  assert.equal(video.snapshot().text, true);
  assert.ok(apple2LoresFrame(ram, video).every(row => row === undefined));
  command("PRINT 2+3"); assert.match(screen(), /\]PRINT 2\+3\n5\n/);
  command("RUN"); assert.match(screen(), /16 COLOURS/);
  assert.deepEqual(apple2LoresFrame(ram, video).slice(0, 32), Array.from({ length: 32 }, (_, row) => new Array(40).fill(Math.floor(row / 2))));

  session.machine.video.read(5); session.machine.keyboard.offer(65); session.send([66]);
  const saved = session.machine.snapshot();
  execution.reset(); session.reset();
  assert.equal(session.pendingInput, 0); assert.equal(session.machine.cpu.snapshot().pc, 0xfa62);
  assert.deepEqual(session.machine.snapshot().ram, saved.ram);
  assert.deepEqual(session.machine.keyboard.snapshot(), saved.keyboard);
  assert.deepEqual(session.machine.video.snapshot(), saved.video);
  const previous = session.machine;
  execution.reset(); session.powerOn();
  assert.notEqual(session.machine, previous);
  assert.equal(session.machine.ram.read(0x801), 0);
  assert.deepEqual(session.machine.keyboard.snapshot(), { key: 0, strobe: false });
  assert.deepEqual(session.machine.video.snapshot(), { text: true, mixed: false, page2: false, hires: false });
  runUntil(idle); assert.match(screen(), /APPLE \]\[/);
});

test("low-resolution frames read only visible RAM and refresh the selected page without effects", () => {
  const video = new Apple2Video({ text: false, mixed: true, page2: true, hires: false });
  const before = video.snapshot(), reads: number[] = [];
  const ram = { read(address: number) { reads.push(address); return address === 0x800 ? 0xa3 : 0x51; } };
  const frame = apple2LoresFrame(ram, video);
  assert.equal(reads.length, 1600);
  assert.deepEqual(reads.slice(0, 40), Array.from({ length: 40 }, (_, column) => 0x800 + column));
  assert.deepEqual(reads.slice(40, 80), reads.slice(0, 40));
  assert.equal(frame[0]![0], 3); assert.equal(frame[1]![0], 10);
  assert.equal(frame[0]![1], 1); assert.equal(frame[1]![1], 5);
  assert.ok(frame.slice(40).every(row => row === undefined));
  assert.deepEqual(video.snapshot(), before);
  video.write(4, 0); // No writes to RAM: only the displayed page changes.
  assert.equal(apple2LoresFrame(ram, video)[0]![0], 1);
  for (const switchAddress of [7, 1]) {
    video.read(switchAddress); reads.length = 0;
    assert.ok(apple2LoresFrame(ram, video).every(row => row === undefined));
    assert.deepEqual(reads, []);
  }
});
