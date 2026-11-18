import { readFileSync } from "node:fs";
import type { XtCheckpoint } from "../../site/interactive/xt-rom-guide.js";

export function ultimaSteps<T extends NonNullable<XtCheckpoint["expect"]>>(id: string) {
  const guide = readFileSync("docs/machines/pc-xt-ultima-v.md", "utf8");
  for (const [, json] of guide.matchAll(/^```json\n([\s\S]*?)^```$/gm)) {
    const tour: { id: string; steps: (XtCheckpoint & { execution: string; expect: T })[] } = JSON.parse(json!);
    if (tour.id === id) return tour.steps;
  }
  throw new Error(`Missing Ultima V walkthrough: ${id}`);
}
