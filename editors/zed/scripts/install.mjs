import { existsSync, lstatSync, mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { build, languages } from './common.mjs';

// An explicit data directory also allows testing with zed --user-data-dir.
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--data-dir')) {
  throw new Error('Usage: npm run install:local -- [--data-dir PATH]');
}
const defaultDataDirectory = process.platform === 'darwin'
  ? resolve(homedir(), 'Library/Application Support/Zed')
  : process.platform === 'linux'
    ? resolve(process.env.XDG_DATA_HOME ?? resolve(homedir(), '.local/share'), 'zed')
    : undefined;
const dataDirectory = args[1] ?? defaultDataDirectory;
if (!dataDirectory) throw new Error('Supply Zed\'s data directory with --data-dir PATH on this platform.');
const source = resolve(build, 'extension');
if (!languages.every(language => existsSync(resolve(source, `grammars/dromaios_${language}.wasm`)))) {
  throw new Error('Build the extension first with npm run build.');
}
const installed = resolve(dataDirectory, 'extensions/installed');
const target = resolve(installed, 'dromaios');
mkdirSync(installed, { recursive: true });
const existing = lstatSync(target, { throwIfNoEntry: false });
if (existing) {
  if (!existing.isSymbolicLink() || realpathSync(target) !== realpathSync(source)) {
    throw new Error(`An unrelated extension already exists at ${target}; it has been left untouched.`);
  }
} else {
  symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir');
}
console.log(`Installed local extension: ${target}\nRestart Zed to load the current build.`);
