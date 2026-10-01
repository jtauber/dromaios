import { literateBlocks } from "../src/literate.ts";

export interface BasicTurn {
  readonly input: string;
  readonly output: string;
  readonly line: number;
}

/** Compare terminal lines, ignoring right padding and final line endings only. */
export function basicDisplay(text: string): string {
  return text.split("\n").map(line => line.replace(/ +$/, "")).join("\n").replace(/\n+$/, "");
}

/** One lesson is one ordered session after a fresh BASIC boot. */
export function parseBasicLesson(markdown: string, file: string) {
  const source = markdown.replace(/\r\n?/g, "\n");
  function fail(line: number, message: string): never { throw new SyntaxError(`${file}:${line}: ${message}`); }
  const preamble = /^# ([^\n]+)\n\n([^\n]+(?:\n[^\n]+)*)\n\n/.exec(source);
  if (!preamble) fail(1, "Expected a title, blank line, introductory paragraph, and blank line.");
  const lines = source.split("\n");
  const blocks = literateBlocks(source, "basic-session", line => fail(line, "Unclosed basic-session fence."));
  if (!blocks.length) fail(1, "Expected at least one basic-session fence.");
  const sessions = blocks.map((block, index) => {
    if (!block.lines.length) fail(1, "A basic-session fence must contain input.");
    const turns: { input: string; output: string; line: number }[] = [];
    for (const { text, line } of block.lines) {
      if (!/^[\x20-\x7e]*$/.test(text)) fail(line, "A BASIC transcript uses printable ASCII only.");
      if (text.startsWith("> ")) turns.push({ input: text.slice(2), output: "", line });
      else {
        if (text.startsWith(">")) fail(line, "Separate > from the input with a space.");
        const turn = turns.at(-1);
        if (!turn) fail(line, "Start each session fence with > followed by the line to type.");
        turn.output += text + "\n";
      }
    }
    for (const turn of turns) turn.output = basicDisplay(turn.output);
    // Preserve the prose as Markdown; publication consumes these parsed turns,
    // rather than maintaining a second parser for their syntax.
    const start = block.lines[0]!.line - 2, end = block.lines.at(-1)!.line;
    lines[start] = `<!-- basic-session:${index} -->`;
    for (let line = start + 1; line <= end; line++) lines[line] = "";
    return turns as readonly BasicTurn[];
  });
  return { title: preamble[1]!, introduction: preamble[2]!, body: lines.join("\n").slice(preamble[0].length), sessions };
}
