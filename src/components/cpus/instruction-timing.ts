/** A supported instruction can still be outside the declared instruction-clock model. */
export class InstructionTimingUnavailable extends Error {
  readonly address: number;
  readonly bytes: readonly number[];

  constructor(cpu: string, address: number, bytes: readonly number[]) {
    super(`${cpu} instruction timing unavailable at $${address.toString(16).toUpperCase()}.`);
    this.name = "InstructionTimingUnavailable";
    this.address = address;
    this.bytes = [...bytes];
  }
}
