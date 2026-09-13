import { opcodePattern, opcodeFamily, opcodeTable } from "../../src/components/cpus/opcodes.js";

// Compiled, never called: selector literals and CPU-specific handler contexts survive expansion.
export function checkOpcodeDefinitions(): void {
  type Context = { fetchByte(): number };
  type Handler = (instruction: Context) => void;
  const table = opcodeTable<Handler>([
    [0x00, ({ fetchByte }) => { const byte: number = fetchByte(); }],
    ...opcodePattern("00 000 100", ({ fetchByte }: Context) => { fetchByte(); }),
    ...opcodePattern("00 xxx 111", ({ fetchByte }: Context) => { fetchByte(); }),
    ...opcodeFamily("ff v 100 00", { f: ["n", "v", "c", "z"], v: [false, true] }, selected => {
      const flag: "n" | "v" | "c" | "z" = selected.f;
      const value: boolean = selected.v;
      // @ts-expect-error Selectors retain their literal values.
      const carry: "c" = selected.f;
      // @ts-expect-error Only declared selectors are available.
      selected.x;
      // @ts-expect-error Bindings are readonly.
      selected.v = true;
      return ({ fetchByte }: Context) => { fetchByte(); };
    }),
  ]);
  const handler: Handler | undefined = table[0x10];
  // @ts-expect-error Unsupported entries must be checked before calling.
  table[0xff]({ fetchByte: () => 0 });
  // @ts-expect-error The table is readonly.
  table[0x00] = () => {};
  // @ts-expect-error Handler contexts remain CPU-specific.
  table[0x00]?.({ readWord: () => 0 });
  // @ts-expect-error A family with a different execution context cannot enter this table.
  opcodeTable<Handler>([
    ...opcodePattern("00 xxx 111", ({ readWord }: { readWord(): number }) => { readWord(); }),
  ]);
}
