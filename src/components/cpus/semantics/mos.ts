import { addOverflow, addWrap, bitAnd, bitOr, bitXor, borrow, capture, carry, extend, flagValue, literal, lowByte, negative, not,
  overflow, readFlag, readRegister, select, subtract, updateFlags, value, when, writeRegister, zero } from "./model.ts";
import type { NumberExpression, Statement } from "./model.ts";
import { atLeast } from "./builders.ts";
import type { AccumulatorCpu } from "./builders.ts";
import { flagPolicy } from "./status.ts";

/** NMOS ADC/SBC: binary facts and decimal digit correction have separate flag/write stages. */
export function mosArithmetic(cpu: AccumulatorCpu, operation: "ADC" | "SBC"): readonly Statement[] {
  const adding = operation === "ADC", a = value("left"), b = value("right"), incoming = adding ? flagValue("carry") : not(flagValue("carry"));
  const result = value("binary"), low = value("low"), intermediate = value("intermediate");
  const nibble = (byte: NumberExpression) => extend(bitAnd(byte, literal(8, 0x0f)), 16);
  const high = (byte: NumberExpression) => extend(bitAnd(byte, literal(8, 0xf0)), 16);
  const wideOperation = adding ? addWrap : subtract;
  const correctedLow = adding
    ? select(atLeast(low, literal(16, 10)), bitOr(bitAnd(addWrap(low, literal(16, 6)), literal(16, 0x0f)), literal(16, 0x10)), low)
    : select(negative(low), subtract(bitAnd(subtract(low, literal(16, 6)), literal(16, 0x0f)), literal(16, 0x10)), low);
  const decimalCarry = atLeast(intermediate, literal(16, 0xa0));
  const decimalResult = lowByte(adding ? addWrap(intermediate, select(decimalCarry, literal(16, 0x60), literal(16, 0)))
    : select(negative(intermediate), subtract(intermediate, literal(16, 0x60)), intermediate));
  const nz = flagPolicy(cpu, `${operation} binary N/Z`, { result: 8 }, { n: negative(value("result")), z: zero(value("result")) });
  const cv = flagPolicy(cpu, `${operation} binary C/V`, { left: 8, right: 8, carry: "flag" }, {
    c: adding ? carry(value("left"), value("right"), flagValue("carry"))
      : not(borrow(value("left"), value("right"), not(flagValue("carry")))),
    v: (adding ? addOverflow : overflow)(value("left"), value("right"), adding ? flagValue("carry") : not(flagValue("carry"))),
  });
  const binarySteps: readonly Statement[] = [writeRegister(cpu.register("a"), result), updateFlags(nz, { result }),
    updateFlags(cv, { left: a, right: b, carry: flagValue("carry") })];
  const decimalSteps: readonly Statement[] = [
    capture("low", wideOperation(nibble(a), nibble(b), incoming)),
    capture("intermediate", addWrap(wideOperation(high(a), high(b)), correctedLow)),
    ...(adding ? [updateFlags(flagPolicy(cpu, "ADC NMOS decimal flags", { left: 8, right: 8, binary: 8, intermediate: 16 }, {
      z: zero(value("binary")), n: negative(lowByte(value("intermediate"))),
      v: not(zero(bitAnd(bitAnd(bitXor(value("left"), lowByte(value("intermediate"))),
        bitXor(bitXor(value("left"), value("right")), literal(8, 0xff))), literal(8, 0x80)))),
      c: atLeast(value("intermediate"), literal(16, 0xa0)),
    }), { left: a, right: b, binary: result, intermediate })] : []),
    writeRegister(cpu.register("a"), decimalResult),
  ];
  return [readRegister("left", cpu.register("a")), readFlag("carry", cpu.flag("c")),
    capture("binary", wideOperation(a, b, incoming)),
    ...(!adding ? binarySteps : []), readFlag("decimal", cpu.flag("d")),
    ...(adding ? [when(not(flagValue("decimal")), binarySteps)] : []), when(flagValue("decimal"), decimalSteps)];
}
