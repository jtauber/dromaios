# Dromaios for Zed

Local Zed language support for `.machine` definitions: syntax colours, `//`
comment toggling, and matching/autoclosing braces and square brackets. Colours
come from the active Zed theme. Assembly annotations remain comments.

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
**Dromaios Machine**. Rebuild after changing the grammar, queries, or config,
then restart Zed if the colours have not refreshed. Reinstalling the same link
is safe. To uninstall, remove only the `dromaios` symlink from Zed's installed
extensions directory and restart Zed.

Use this local installer rather than **Install Dev Extension** for now. Zed's
dev-extension builder fetches grammar sources from a Git revision, which excludes
uncommitted edits. Our build packages the working-tree grammar directly, so it
can be reviewed and used before a commit. It is not published to the extension
registry. Registry publication would require shipping the generated parser
sources and pinning their commit in `extension.toml`.

## Maintaining the grammar

- `tree-sitter-machine/grammar.js` describes the editor's syntax tree.
- `languages/machine/` holds Zed's file association, bracket settings, and queries.
- `tree-sitter-machine/test/corpus/` contains hand-checked syntax trees, including
  nested state, wiring, numeric aliases, malformed bytes, and incomplete input.
- `scripts/test.mjs` also parses every repository example, compiles the queries,
  and checks rendered colour categories against a small fixture.

The [machine language reference](../../docs/machines/language.md) defines the
format. The [TypeScript parser](../../src/machines/machine-language.ts) and CPU
state descriptions remain authoritative for validity. The editor grammar accepts
unknown state fields/models and semantically invalid compositions so that editing
can continue. It does not check widths, required fields, references, or bounds and
does not provide diagnostics, completion, or navigation. Malformed byte atoms have
an `invalid_byte` node and receive no number colour; for example, `FF00` is kept
whole rather than displayed as two valid bytes.

When changing syntax, update the application parser, reference, and editor tests
together. Generated C, parser metadata, native libraries, and WebAssembly are
ignored. CI runs the editor checks separately from the simulation tests, and
ordinary simulation builds do not require the editor toolchain.

The extension can hold another language and grammar when the CPU DSL's syntax is
established. Shared colour conventions can carry over; CPU-specific validity
should continue to come from its semantic model. A later language server could
reuse those validations for diagnostics and completion.

References: [Zed languages](https://zed.dev/docs/extensions/languages),
[Zed extension development](https://zed.dev/docs/extensions/developing-extensions),
and [Tree-sitter grammar authoring](https://tree-sitter.github.io/tree-sitter/creating-parsers/3-writing-the-grammar.html).
