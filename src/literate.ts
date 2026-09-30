export interface LiterateLine { readonly text: string; readonly line: number }
export interface LiterateBlock { readonly lines: readonly LiterateLine[]; readonly explanation: string }

/** Read unindented fences with the exact language tag, retaining Markdown locations.
 * Other fences are skipped as a whole, so examples inside them remain prose.
 */
export function literateBlocks(markdown: string, language: string, unclosed: (line: number) => never): readonly LiterateBlock[] {
  const lines = markdown.split(/\r\n|\r|\n/), blocks: LiterateBlock[] = [];
  let paragraph: string[] = [], preceding: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index]!;
    const fence = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(text);
    if (!fence) {
      if (text.trim() === "") { if (paragraph.length) preceding = paragraph; paragraph = []; }
      else if (/^#{1,6} /.test(text)) { paragraph = []; preceding = []; }
      else paragraph.push(text.trim());
      continue;
    }
    const marker = fence[2]!, executable = fence[1] === "" && fence[3]!.trim() === language, start = index + 1;
    const closing = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`);
    const body: LiterateLine[] = [];
    while (++index < lines.length && !closing.test(lines[index]!)) {
      body.push({ text: lines[index]!, line: index + 1 });
    }
    if (index === lines.length && executable) unclosed(start);
    if (executable) blocks.push({ lines: body, explanation: (paragraph.length ? paragraph : preceding).join(" ") });
    paragraph = []; preceding = [];
  }
  return blocks;
}
