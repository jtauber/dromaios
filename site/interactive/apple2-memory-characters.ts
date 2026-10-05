import { Apple2Video } from "../../src/components/devices/generated/apple2-video.js";

// Use the device chapter's pure decoding views, independently of the running video device.
const decoder = new Apple2Video();
const characters = Array.from({ length: 256 }, (_, byte) => {
  const inverse = decoder.inverse(byte, false), flashing = !inverse && decoder.inverse(byte, true);
  return { character: String.fromCharCode(decoder.characterCode(byte)), inverse, flashing };
});

/** A static text interpretation of a stored byte; unavailable storage remains unavailable. */
export function apple2MemoryCharacter(byte: number | undefined): Readonly<typeof characters[number]> | undefined {
  return byte === undefined ? undefined : characters[byte];
}
