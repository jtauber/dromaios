import assert from 'node:assert/strict';
import { globSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { literateBlocks } from '../../../src/literate.ts';
import { build, configArgs, extension, languages, repository, treeSitter } from './common.mjs';

for (const language of languages) treeSitter(language, ['test', ...configArgs]);

const machines = globSync('src/machines/**/*.machine', { cwd: repository })
  .sort().map(path => resolve(repository, path));
assert.ok(machines.length > 0, 'Discover the real machine examples');
const directory = resolve(build, 'machine-blocks');
rmSync(directory, { recursive: true, force: true });
mkdirSync(directory, { recursive: true });
const chapters = globSync('src/machines/**/*.md', { cwd: repository }).sort();
for (const [chapter, path] of chapters.entries()) {
  const blocks = literateBlocks(readFileSync(resolve(repository, path), 'utf8'), 'machine', line => {
    throw new Error(`${path}:${line}: Unclosed machine fence.`);
  });
  assert.ok(blocks.length > 0, `${path} contains executable fences`);
  for (const [index, { lines }] of blocks.entries()) {
    const output = resolve(directory, `${chapter}-${index}.machine`);
    writeFileSync(output, lines.map(({ text }) => text).join('\n') + '\n');
    machines.push(output);
  }
}
const parsed = treeSitter('machine', ['parse', ...configArgs, ...machines], { capture: true });
assert.doesNotMatch(parsed.stdout, /\((?:ERROR|MISSING|invalid_byte)\b/);
console.log(`Parsed all ${machines.length} machine definitions and fences without errors or invalid bytes.`);

// Compile both queries against the generated grammar, including bracket pairs.
for (const query of ['highlights.scm', 'brackets.scm']) {
  treeSitter('machine', ['query', ...configArgs, '--quiet', resolve(extension, 'languages/machine', query), ...machines], { capture: true });
}

// Independently check actual rendered highlight categories. Query matches alone
// do not expose which category wins when two patterns capture the same token.
const fixture = resolve(extension, 'tree-sitter-machine/test/fixtures/categories.machine');
function highlight(path) {
  return treeSitter('machine', ['highlight', ...configArgs, '--html', '--style', 'minimal', '--layout', 'fragment', path], { capture: true }).stdout;
}
const html = highlight(fixture);
for (const [text, category] of [
  ['cpu', 'keyword'], ['8080', 'type'], ['A', 'property'], ['FF', 'number'],
  ['false', 'boolean'], ['fault', 'constant'], ['flags', 'keyword'],
  ['byte-input', 'type'], ['ram', 'variable'], ['rom', 'type'],
  ['dead', 'variable'], ['0FFH', 'number'], ['00', 'number'], ['ram', 'keyword'],
]) {
  assert.ok(html.includes(`<span class='${category}'>${text}</span>`), `${text} is highlighted as ${category}`);
}
assert.ok(html.includes("class='comment'"), 'Assembly annotations remain comments');

// In the ROM boot example both storage kinds must have the same category.
// A global "ram" keyword capture used to nest inside its type capture, overriding
// that colour in Zed, while "rom" had only the correct type capture.
const romBoot = highlight(resolve(repository, 'src/machines/68000/rom-boot-example.machine'));
for (const kind of ['rom', 'ram']) {
  assert.ok(romBoot.includes(
    `<span class='variable'>${kind}</span> <span class='operator'>=</span> <span class='type'>${kind}</span>`,
  ), `${kind} declarations distinguish component names from storage types without overlapping captures`);
}

console.log('Highlight categories and bracket queries checked.');
const config = readFileSync(resolve(extension, 'languages/machine/config.toml'), 'utf8');
assert.match(config, /^path_suffixes = \["machine"\]$/m);
assert.match(config, /^code_fence_block_name = "machine"$/m);

await import('./test-cpu.mjs');
