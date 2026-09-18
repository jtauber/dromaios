import assert from "node:assert/strict";

/** Mixed opcode tables still forbid port access when testing ordinary instructions. */
export const noPorts = {
  readPort: (): never => assert.fail("Unexpected port input"),
  writePort: (): never => assert.fail("Unexpected port output"),
};
