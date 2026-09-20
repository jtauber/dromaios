import { languages, treeSitter } from './common.mjs';

for (const language of languages) treeSitter(language, ['generate', '--abi', '14']);
