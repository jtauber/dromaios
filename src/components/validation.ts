export function checkUnsigned(name: string, value: unknown, maximum: number): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`${name} must be an integer from 0 to ${maximum}.`);
  }
}
