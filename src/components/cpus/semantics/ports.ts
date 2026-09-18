import { addWrap, concat, highByte, literal, lowByte, readPort, readSource, value, writePort } from "./model.ts";
import type { CpuDeclaration, ValueSource } from "./model.ts";
import type { RegisterView } from "./builders.ts";
import { defineInstruction } from "./validate.ts";

/** Capture the port before transferring a byte or a low-first word; leave flags untouched. */
export function portTransfer(cpu: CpuDeclaration, name: string, port: ValueSource, operand: RegisterView, output: boolean) {
  const width = operand.source.width;
  if (port.width !== 16 || (width !== 8 && width !== 16)) throw new Error("Port transfers require a word port and a byte or word operand.");
  const next = addWrap(value("port"), literal(16, 1));
  return defineInstruction({ cpu, name,
    explanation: "Capture the port address before accessing the operand. " + (output
      ? "Capture the complete operand before any output. A failed write retains any earlier output. "
      : "Complete all input reads before writing the operand; byte views preserve their live other half. ")
      + (width === 16 ? "Transfer low then high bytes, wrapping the second port within 16 bits. " : "Transfer one byte. ")
      + "Preserve flags. Failed accesses stop later effects; completed effects remain.",
    steps: [readSource("port", port), ...(output
      ? [readSource("contents", operand.source), writePort(value("port"), width === 8 ? value("contents") : lowByte(value("contents"))),
        ...(width === 16 ? [writePort(next, highByte(value("contents")))] : [])]
      : [readPort("low", value("port")), ...(width === 16 ? [readPort("high", next)] : []),
        ...operand.write(width === 8 ? value("low") : concat(value("high"), value("low")))])],
  });
}
