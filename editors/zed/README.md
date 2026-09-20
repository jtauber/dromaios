# Dromaios for Zed

Local Zed language support for `.machine` definitions and the `cpu` language
in [literate CPU specifications](../../docs/cpus/literate-specifications.md).
Both languages have syntax colours, `//` comment toggling, and matching/autoclosing
brackets. Colours come from the active Zed theme. Assembly annotations remain
comments.

CPU highlighting works inside Markdown fences labelled `cpu` and in standalone
`.cpu` snippets. Declarations and effect keywords, state symbols, captured values,
function names, numbers, strings, and comments have distinct syntax categories.
Opcode patterns and mnemonic templates are strings. Each fence is parsed on its
own, so references to declarations in earlier fences still receive highlighting.
Standalone snippets are useful for editing; the CPU build reads Markdown chapters.

## Build and install

From the repository root, using Node.js 24:

```sh
npm ci --prefix editors/zed
npm test --prefix editors/zed
npm run build --prefix editors/zed
npm run install:local --prefix editors/zed
```

The pinned Tree-sitter CLI downloads its executable during installation.
Native grammar tests require a C compiler (Xcode Command Line Tools on macOS,
or a normal C development toolchain on Linux). The first WebAssembly build
downloads the WASI SDK and Binaryen from their official GitHub releases.
Compiler caches and generated output live in the ignored `.build/` directory;
`XDG_CACHE_HOME` can override the cache location. No custom Rust is needed.

The installer links `.build/extension` into Zed's `extensions/installed/dromaios`
directory. It supports the standard macOS and Linux data directories and refuses
to replace a different existing extension. On another platform, or to test in
an isolated profile, supply the data directory explicitly:

```sh
npm run install:local --prefix editors/zed -- --data-dir /tmp/dromaios-zed
zed --user-data-dir /tmp/dromaios-zed
```

Zed normally notices the new extension automatically. If a `.machine` file
still shows Plain Text, restart Zed and reopen it; its language should be
**Dromaios Machine**. A `.cpu` file should show **Dromaios CPU**; a chapter stays
**Markdown**, with CPU colours inside its `cpu` fences.
Rebuild after changing the grammar, queries, or config,
then restart Zed if the colours have not refreshed. Reinstalling the same link
is safe. To uninstall, remove only the `dromaios` symlink from Zed's installed
extensions directory and restart Zed.

Use this local installer rather than **Install Dev Extension** for now. Zed's
dev-extension builder fetches grammar sources from a Git revision, which excludes
uncommitted edits. Our build packages the working-tree grammar directly, so it
can be reviewed and used before a commit. It is not published to the extension
registry. Registry publication would require shipping the generated parser
sources and pinning their commit in `extension.toml`.

## Maintaining the grammars

- `tree-sitter-machine/grammar.js` and `tree-sitter-cpu/grammar.js` describe the
  editor's syntax trees.
- `languages/machine/` and `languages/cpu/` hold Zed's language associations,
  bracket settings, and queries.
- Each grammar's `test/corpus/` contains hand-checked syntax trees, including
  incomplete input. Fixtures under `test/fixtures/` exercise colour categories.
- `scripts/test.mjs` and `scripts/test-cpu.mjs` also parse every machine example
  and every executable CPU fence, compile the queries, and check rendered colours.

The [machine language reference](../../docs/machines/language.md) defines the
format. The [TypeScript parser](../../src/machines/machine-language.ts) and CPU
state descriptions remain authoritative for validity. The editor grammar accepts
unknown state fields/models and semantically invalid compositions so that editing
can continue. It does not check widths, required fields, references, or bounds and
does not provide diagnostics, completion, or navigation. Malformed machine byte
atoms have an `invalid_byte` node and receive no number colour; for example,
`FF00` is kept whole rather than displayed as two valid bytes.

The CPU grammar follows the
[literate specification guide](../../docs/cpus/literate-specifications.md).
The [chapter compiler](../../src/components/cpus/semantics/literate/compile.ts)
remains authoritative for validity. The editor accepts unresolved names and
generic expression calls so incomplete or independently parsed fences keep their
structure. It does not check opcode patterns, widths, or the semantics of effects.

When changing syntax, update the application parser, reference, and editor tests
together. Generated C, parser metadata, native libraries, and WebAssembly are
ignored. CI runs the editor checks separately from the simulation tests, and
ordinary simulation builds do not require the editor toolchain.

A later language server could reuse the application validations for diagnostics
and completion.

References: [Zed languages](https://zed.dev/docs/extensions/languages),
[Zed extension development](https://zed.dev/docs/extensions/developing-extensions),
and [Tree-sitter grammar authoring](https://tree-sitter.github.io/tree-sitter/creating-parsers/3-writing-the-grammar.html).
