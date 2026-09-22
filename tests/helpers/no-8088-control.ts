import assert from "node:assert/strict";
import type { CoprocessorContext } from "../../src/components/cpus/coprocessor-access.js";
import type { InterruptReportContext } from "../../src/components/cpus/instruction-context.js";

/** Ordinary instructions in mixed tables must not sample pins, send ESC, or report interrupt delivery. */
export const no8088Control: CoprocessorContext & InterruptReportContext = {
  readTest: () => assert.fail("Unexpected TEST sample"),
  sendEscape: () => assert.fail("Unexpected ESC request"),
  reportInterrupt: () => assert.fail("Unexpected software delivery"),
};
