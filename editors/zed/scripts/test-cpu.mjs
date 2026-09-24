import assert from 'node:assert/strict';
import { globSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { chapterBlocks } from '../../../src/components/cpus/semantics/literate/document.ts';
import { build, configArgs, extension, repository, treeSitter } from './common.mjs';

// Parse each actual fence on its own, just as Markdown injection does. A fence
// may refer to state and operands declared earlier in its chapter.
const directory = resolve(build, 'cpu-blocks');
rmSync(directory, { recursive: true, force: true });
mkdirSync(directory, { recursive: true });
const chapters = globSync('src/components/cpus/specifications/*.md', { cwd: repository }).sort();
const blocks = chapters.flatMap(path => chapterBlocks(readFileSync(resolve(repository, path), 'utf8'), path)
  .map(({ lines }, index) => {
    const output = resolve(directory, `${basename(path, '.md')}-${index + 1}.cpu`);
    writeFileSync(output, lines.map(({ text }) => text).join('\n') + '\n');
    return output;
  }));
assert.ok(blocks.length > 0, 'Discover the executable chapter fences');
const fixture = resolve(extension, 'tree-sitter-cpu/test/fixtures/categories.cpu');
const paths = [...blocks, fixture];
const parsed = treeSitter('cpu', ['parse', ...configArgs, ...paths], { capture: true });
assert.doesNotMatch(parsed.stdout, /\((?:ERROR|MISSING)\b/);
console.log(`Parsed all ${blocks.length} CPU fences from ${chapters.length} chapters independently.`);

for (const query of ['highlights.scm', 'brackets.scm']) {
  treeSitter('cpu', ['query', ...configArgs, '--quiet', resolve(extension, 'languages/cpu', query), ...paths], { capture: true });
}
const html = treeSitter('cpu', ['highlight', ...configArgs, '--html', '--style', 'minimal', '--layout', 'fragment', fixture], { capture: true }).stdout;
for (const [text, category] of [
  ['bit', 'function'],
  ['group', 'keyword'], ['choose', 'keyword'], ['then', 'keyword'], ['else', 'keyword'], ['ENTRY', 'property'],
  ['segmented', 'keyword'], ['prefixes', 'keyword'], ['sampling', 'keyword'], ['limit', 'keyword'], ['pending', 'keyword'],
  ['attempt', 'keyword'], ['complete', 'keyword'], ['stage', 'keyword'], ['stage', 'variable'], ['pending', 'variable'], ['staging', 'keyword'], ['staging', 'variable'], ['target', 'keyword'], ['target', 'variable'], ['devices', 'keyword'], ['reset', 'variable'], ['select', 'variable'], ['sample', 'keyword'], ['boundary', 'keyword'], ['report', 'keyword'], ['send', 'keyword'], ['escape', 'keyword'], ['test', 'keyword'], ['iterate', 'keyword'], ['step', 'keyword'], ['next', 'keyword'], ['next', 'variable'], ['divide', 'keyword'], ['reject', 'keyword'], ['signed', 'keyword'],
  ['projected', 'function'], ['projectAddress', 'function'], ['segment', 'variable'], ['offset', 'variable'],
  ['entries', 'keyword'], ['offers', 'keyword'], ['select', 'keyword'], ['supplied', 'keyword'], ['enter', 'keyword'],
  ['exchange', 'keyword'], ['FLAGS', 'property'], ['bank', 'keyword'], ['ALTERNATE', 'property'], ['MODE', 'property'], ['resume', 'keyword'], ['resumeSync', 'function'], ['match', 'keyword'], ['case', 'keyword'], ['otherwise', 'keyword'], ['unsupported', 'constant'], ['as', 'keyword'], ['waiting', 'constant'], ['page', 'keyword'], ['on', 'keyword'], ['cpu', 'keyword'], ['state', 'keyword'], ['family', 'keyword'], ['encoding', 'keyword'],
  ['perform', 'keyword'], ['prepare', 'function'], ['enter', 'function'], ['defer', 'keyword'], ['notify', 'keyword'], ['reti', 'keyword'], ['shiftBits', 'function'], ['irq', 'keyword'], ['intr', 'keyword'], ['all', 'keyword'], ['into', 'keyword'], ['unless', 'keyword'],
  ['callback', 'keyword'], ['validate', 'keyword'], ['using', 'keyword'], ['vectors', 'keyword'], ['DEFERRED', 'property'], ['ENABLED', 'property'],
  ['A', 'property'], ['C', 'property'], ['ADDRESS', 'property'], ['STOPPED', 'property'], ['WAIT', 'property'], ['choice', 'keyword'],
  ['addressStack', 'variable'], ['slot', 'variable'], ['source', 'variable'], ['carry', 'variable'],
  ['equal', 'function'], ['lessThan', 'function'], ['unsigned', 'keyword'],
  ['needsCorrection', 'function'], ['aboveNine', 'variable'], ['decision', 'variable'], ['flag', 'keyword'],
  ['multiply', 'function'], ['signExtend', 'function'], ['addOverflow', 'function'], ['overflow', 'function'], ['transfer', 'function'], ['add', 'function'], ['carry', 'function'], ['u14', 'function'],
  ['bits', 'type'], ['increment', 'function'], ['u', 'function'], ['&lt;', 'punctuation bracket'], ['&gt;', 'punctuation bracket'], ['Cpu8008', 'type'], ['8', 'number'], ['$0000', 'number'], ['000', 'number'],
  ['pair', 'keyword'], ['replace', 'keyword'], ['little', 'constant'], ['none', 'constant'], ['&lt;-', 'operator'],
]) {
  assert.ok(html.includes(`<span class='${category}'>${text}</span>`), `${text} is highlighted as ${category}`);
}
assert.ok(html.includes("<span class='string'>&quot;11 ddd sss&quot;</span>"), 'Opcode patterns are strings');
assert.ok(html.includes("<span class='string'>&quot;L{d}{s}&quot;</span>"), 'Braces in mnemonic templates remain string text');
assert.ok(html.includes("class='string escape'"), 'JSON string escapes are highlighted');
assert.ok(html.includes('// text&quot;</span>'), 'Comment markers inside descriptions remain string text');
assert.ok(html.includes("<span class='comment'>// This remains a comment: $FF &quot;text&quot;</span>"), 'Quoted text and numbers inside comments stay comments');

// Markdown in Zed resolves fence labels by language name or file extension.
// The explicit fence name is also used when Zed inserts a CPU code block.
const config = readFileSync(resolve(extension, 'languages/cpu/config.toml'), 'utf8');
assert.match(config, /^path_suffixes = \["cpu"\]$/m);
assert.match(config, /^code_fence_block_name = "cpu"$/m);
console.log('CPU colours, brackets, string/comment boundaries, and Markdown fence association checked.');
