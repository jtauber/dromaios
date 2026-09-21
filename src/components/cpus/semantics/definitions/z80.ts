import { instructionSet } from "../builders.ts";
import { families } from "../generated/z80.ts";

export { actions as actionsZ80, views as viewsZ80, pages as pagesZ80 } from "../generated/z80.ts";
export const chapterZ80 = instructionSet(Object.values(families).flat(), 24);
