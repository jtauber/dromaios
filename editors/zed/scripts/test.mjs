import assert from 'node:assert/strict';
import { globSync } from 'node:fs';
import { resolve } from 'node:path';
import { configArgs, extension, repository, treeSitter } from './common.mjs';

treeSitter(['test', ...configArgs]);

const machines = globSync('src/machines/**/*.machine', { cwd: repository })
  .sort().map(path => resolve(repository, path));
assert.ok(machines.length > 0, 'Discover the real machine examples');
const parsed = treeSitter(['parse', ...configArgs, ...machines], { capture: true });
assert.doesNotMatch(parsed.stdout, /\((?:ERROR|MISSING|invalid_byte)\b/);
console.log(`Parsed all ${machines.length} machine examples without errors or invalid bytes.`);

// Compile both queries against the generated grammar, including bracket pairs.
for (const query of ['highlights.scm', 'brackets.scm']) {
  treeSitter(['query', ...configArgs, '--quiet', resolve(extension, 'languages/machine', query), ...machines], { capture: true });
}

// Independently check actual rendered highlight categories. Query matches alone
// do not expose which category wins when two patterns capture the same token.
const fixture = resolve(extension, 'tree-sitter-machine/test/fixtures/categories.machine');
function highlight(path) {
  return treeSitter(['highlight', ...configArgs, '--html', '--style', 'minimal', '--layout', 'fragment', path], { capture: true }).stdout;
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
