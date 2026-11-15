/** Skip the original 8088's segment, LOCK and repeat prefixes in captured instruction bytes. */
export function opcode8088Index(bytes: readonly number[]): number {
  let index = 0;
  while ([0x26, 0x2e, 0x36, 0x3e, 0xf0, 0xf2, 0xf3].includes(bytes[index]!)) index++;
  return index;
}
