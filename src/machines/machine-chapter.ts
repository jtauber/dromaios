import { literateBlocks } from "../literate.ts";

/** Blank prose and fence delimiters so the machine parser reports Markdown line numbers. */
export function machineChapterSource(markdown: string, file: string): string {
  const blocks = literateBlocks(markdown, "machine", line => {
    throw new SyntaxError(`${file}:${line}:1: Unclosed machine fence.`);
  });
  if (!blocks.length) throw new SyntaxError(`${file}:1:1: Expected at least one machine fence.`);
  const lines = markdown.split(/\r\n|\r|\n/).map(() => "");
  for (const block of blocks) {
    for (const { text, line } of block.lines) lines[line - 1] = text;
  }
  return lines.join("\n");
}
