import assert from "node:assert/strict";
import type { Cpu8088ExternalContext } from "../../src/components/cpus/8088-external.js";
import type { InterruptReportContext } from "../../src/components/cpus/instruction-context.js";

/** Ordinary instructions in mixed tables must not sample pins, send ESC, or report interrupt delivery. */
export const no8088Control: Cpu8088ExternalContext & InterruptReportContext = {
  readTest: () => assert.fail("Unexpected TEST sample"),
  sendEscape: () => assert.fail("Unexpected ESC request"),
  reportInterrupt: () => assert.fail("Unexpected software delivery"),
};
