import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const extension = fileURLToPath(new URL('../', import.meta.url));
export const languages = ['machine', 'cpu'];
export const build = resolve(extension, '.build');
export const repository = resolve(extension, '../..');
const executable = resolve(extension, 'node_modules/tree-sitter-cli',
  process.platform === 'win32' ? 'tree-sitter.exe' : 'tree-sitter');

mkdirSync(build, { recursive: true });
// Keep parser discovery deterministic and compiler caches out of user settings.
const config = resolve(build, 'tree-sitter-config.json');
writeFileSync(config, JSON.stringify({
  'parser-directories': [extension],
  // The CLI's default theme omits Zed's boolean category. Include the categories
  // we test so HTML output reflects all captures supported by Zed themes.
  theme: Object.fromEntries([
    'keyword', 'type', 'property', 'variable', 'number', 'boolean', 'constant',
    'comment', 'operator', 'punctuation.bracket', 'punctuation.delimiter',
    'string', 'string.escape', 'function',
  ].map(name => [name, 7])),
}));
export const configArgs = ['--config-path', config];

export function treeSitter(language, args, { capture = false } = {}) {
  const result = spawnSync(executable, args, {
    cwd: resolve(extension, `tree-sitter-${language}`),
    env: { ...process.env, XDG_CACHE_HOME: process.env.XDG_CACHE_HOME ?? resolve(build, 'cache') },
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.signal || result.status !== 0) {
    throw new Error(`tree-sitter ${args[0]} failed (${result.signal ?? result.status})\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  }
  return result;
}
