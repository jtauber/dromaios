import { SerialSession } from "../../src/runtime/serial-session.js";
import { create8080AltairBasic } from "../../src/machines/generated/8080/altair-basic.js";
import type { Cpu8080ResetRecord, Cpu8080StepRecord } from "../../src/components/cpus/generated/8080-cpu.js";

export function checkSerialSession(): void {
  const session = new SerialSession(output => create8080AltairBasic({ serial: output }));
  const record: Cpu8080StepRecord = session.step();
  const reset: Cpu8080ResetRecord = session.reset();
  const records: readonly Cpu8080StepRecord[] = session.run(10).records;
  const flags: boolean = record.after.flags.cy;
  session.machine.sense.offer(12);
  session.machine.ram.read(0);
  // @ts-expect-error CPU records retain their concrete flag names.
  record.after.flags.v;
  // @ts-expect-error CPU snapshots remain readonly.
  record.after.a = 0;
  // @ts-expect-error Batch records remain readonly.
  session.run(10).records.push(record);
  // @ts-expect-error Replacing the machine must go through reload.
  session.machine = create8080AltairBasic({ serial: () => {} });
  // @ts-expect-error Input consists of bytes, not implicitly encoded text.
  session.send("PRINT 40+2\r");
}
