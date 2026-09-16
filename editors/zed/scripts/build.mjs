import { cpSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { build, extension, treeSitter } from './common.mjs';

const output = resolve(build, 'extension');
mkdirSync(resolve(output, 'grammars'), { recursive: true });
treeSitter(['build', '--wasm', '--output', resolve(output, 'grammars/dromaios_machine.wasm')]);
cpSync(resolve(extension, 'extension.toml'), resolve(output, 'extension.toml'));
cpSync(resolve(extension, 'languages'), resolve(output, 'languages'), { recursive: true });
console.log(`Built Zed extension: ${output}`);
