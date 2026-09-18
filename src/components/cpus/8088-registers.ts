// Encoded rrr order, shared by runtime operands and instruction definitions.
export const wordRegisters8088 = ["ax", "cx", "dx", "bx", "sp", "bp", "si", "di"] as const;
export const byteRegisters8088 = [
  { word: "ax", shift: 0 }, { word: "cx", shift: 0 }, { word: "dx", shift: 0 }, { word: "bx", shift: 0 }, // AL, CL, DL, BL
  { word: "ax", shift: 8 }, { word: "cx", shift: 8 }, { word: "dx", shift: 8 }, { word: "bx", shift: 8 }, // AH, CH, DH, BH
] as const;

export type WordRegister8088 = typeof wordRegisters8088[number];
export type ByteRegister8088 = typeof byteRegisters8088[number];
