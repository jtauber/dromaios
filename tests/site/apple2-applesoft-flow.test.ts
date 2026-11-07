import assert from "node:assert/strict";
import { test } from "node:test";
import { Ram } from "../../src/components/memory/ram.js";
import { createApplesoftListing } from "../../site/interactive/apple2-applesoft.js";
import { applesoftBranches, resolveApplesoftBranch } from "../../site/interactive/apple2-applesoft-flow.js";

const token = { END: 0x80, DATA: 0x83, ONERR: 0xa5, GOTO: 0xab, IF: 0xad, GOSUB: 0xb0, RETURN: 0xb1, REM: 0xb2, ON: 0xb4, PRINT: 0xba, THEN: 0xc4, PLUS: 0xc8 };
type Line = readonly [number, readonly (number | string)[]];
function fixture() {
  const ram = new Ram(0xc000), keywords: string[] = [];
  for (const [name, byte] of Object.entries(token)) keywords[byte - 0x80] = name;
  const decode = createApplesoftListing(keywords);
  const word = (at: number, value: number) => { ram.write(at, value & 255); ram.write(at + 1, value >> 8); };
  return (lines: readonly Line[], start = 0x801) => {
    let at = start;
    for (const [number, parts] of lines) {
      const bytes = parts.flatMap(part => typeof part === "number" ? [part] : Array.from(part, c => c.charCodeAt(0)));
      const next = at + 5 + bytes.length;
      word(at, next); word(at + 2, number);
      bytes.forEach((byte, i) => ram.write(at + 4 + i, byte)); ram.write(next - 1, 0); at = next;
    }
    word(at, 0); word(0x67, start); word(0x69, at + 2);
    return decode(ram);
  };
}

test("flow distinguishes exact statements, IF tails, ON choices and deferred error handlers", () => {
  const listing = fixture()([
    [10, [token.GOTO, "30"]], [20, [token.GOSUB, "100:", token.GOTO, "30"]],
    [30, [token.IF, "X", token.THEN, "100"]],
    [40, [token.IF, "X", token.GOTO, "100:", token.GOSUB, "200"]],
    [50, [token.ON, "X", token.GOTO, "100,200,100"]],
    [60, [token.ON, "X", token.GOSUB, "200,100"]],
    [70, [token.ONERR, token.GOTO, "300"]],
    [80, [token.IF, "X", token.THEN, token.GOSUB, "100:", token.GOTO, "200"]],
    [100, [token.END]], [200, [token.RETURN]], [300, [token.END]],
  ]);
  const branches = applesoftBranches(listing);
  assert.deepEqual(branches.map(b => [b.source.line, b.source.index, b.kind, b.conditional, b.targets.map(t => t.line)]), [
    [10, 0, "GOTO", false, [30]], [20, 0, "GOSUB", false, [100]], [20, 1, "GOTO", false, [30]],
    [30, 0, "THEN", true, [100]], [40, 1, "GOTO", true, [100]], [40, 2, "GOSUB", true, [200]],
    [50, 0, "ON GOTO", false, [100, 200, 100]], [60, 0, "ON GOSUB", false, [200, 100]],
    [70, 0, "ONERR GOTO", false, [300]], [80, 1, "GOSUB", true, [100]], [80, 2, "GOTO", true, [200]],
  ]);
  assert.ok(branches.every(b => !b.unresolved && b.targets.every(t => resolveApplesoftBranch(listing, b, t))));
});

test("quoted keywords, DATA, REM, machine CALLs and ordinary expressions create no branch links", () => {
  const listing = fixture()([
    [10, [token.PRINT, '"GOTO 100:GOSUB 200:THEN 300"']],
    [20, [token.DATA, '100,200,"GOTO 300:",', token.GOTO, "400"]],
    [30, [token.REM, "GOTO 100:", token.GOSUB, "200"]],
    [40, ["A=100", token.PLUS, "200"]], [50, [0x8c, "769"]],
    [60, [token.IF, "X", token.THEN, token.PRINT, '"100"']],
  ]);
  assert.deepEqual(applesoftBranches(listing), []);
});

test("literal operands preserve ON choice order and missing targets; unusual operands remain unresolved", () => {
  const listing = fixture()([
    [0, [token.END]], [10, [token.GOTO, " 0 0 0 "]], [20, [token.ON, "N", token.GOTO, " 0, 100,0 "]],
    [30, [token.GOTO, "X"]], [40, [token.GOTO, "100", token.PLUS, "1"]],
    [50, [token.GOSUB, "100,200"]], [60, [token.ON, "X", token.GOTO, "100,,200"]],
    [70, [token.GOTO, "64000"]], [80, [token.GOTO]], [90, [token.GOTO, "63999"]],
    [63999, [":", token.END]],
  ]);
  const branches = applesoftBranches(listing);
  assert.deepEqual(branches[0]!.targets.map(t => [t.line, !!t.destination]), [[0, true]]);
  assert.deepEqual(branches[1]!.targets.map(t => [t.line, !!t.destination]), [[0, true], [100, false], [0, true]]);
  assert.ok(branches.slice(2, -1).every(b => b.unresolved && b.targets.length === 0));
  const last = branches.at(-1)!;
  assert.ok(resolveApplesoftBranch(listing, last, last.targets[0]!), "An empty leading statement is still a real line destination");
  assert.deepEqual(applesoftBranches({ lines: [], message: "Invalid program" }), []);
});

test("held links follow relocation, but reject changed IF context, targets and source statement positions", () => {
  const load = fixture();
  const program: readonly Line[] = [[10, [token.IF, "X", token.THEN, token.GOTO, "100"]], [100, [token.PRINT, '"TARGET"']]];
  const before = load(program), branch = applesoftBranches(before)[0]!, target = branch.targets[0]!;
  const moved = load([[5, [token.REM, "NEW PREFIX"]], ...program], 0x4001);
  assert.equal(resolveApplesoftBranch(moved, branch, target)?.destination.address, moved.lines[2]!.statements[0]!.address);
  for (const changed of [
    [[10, [token.IF, "Y", token.THEN, token.GOTO, "100"]], program[1]!],
    [program[0]!, [100, [token.PRINT, '"EDITED"']]],
    [[10, [":", token.IF, "X", token.THEN, token.GOTO, "100"]], program[1]!],
    [program[0]!], [program[1]!],
  ] satisfies (readonly Line[])[]) assert.equal(resolveApplesoftBranch(load(changed), branch, target), undefined);
});
