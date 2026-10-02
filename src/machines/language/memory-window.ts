import { deviceModels, isDeviceKind } from "../../components/devices/models.ts";
import type { ComponentDefinition } from "./composition.ts";
import type { MachineSyntax, Token } from "./syntax.ts";

export interface MemoryRoute {
  readonly target: { readonly component: string; readonly offset: number } | "discard";
  readonly when: readonly { readonly component: string; readonly view: string }[];
}
export interface MemoryWindowDefinition {
  readonly size: number;
  readonly read: readonly MemoryRoute[];
  readonly write: readonly MemoryRoute[];
}

/** Resolve routes after component declarations; conditions can only inspect pure flag views. */
export function readMemoryWindow(syntax: MachineSyntax, component: (token: Token) => ComponentDefinition) {
  const { take, current, expect, readNumber, fail } = syntax;
  const checks: (() => void)[] = [];
  const token = take(), size = readNumber(token, "Window size", 0x1000000);
  if (!size) fail(token, "Window size must be positive");
  const routes: { read: MemoryRoute[]; write: MemoryRoute[] } = { read: [], write: [] };
  expect("{");
  while (current().text !== "}") {
    const direction = take();
    if (direction.text !== "read" && direction.text !== "write") return fail(direction, "Expected window read or write route");
    const list = routes[direction.text];
    if (list.at(-1)?.when.length === 0) fail(direction, "An unconditional route must be last in its direction");
    expect("=");
    const destination = take();
    let target: MemoryRoute["target"];
    if (destination.text === "discard") {
      if (direction.text !== "write") fail(destination, "Only writes may be discarded");
      target = "discard";
    } else {
      let offset = 0;
      if (current().text === "offset") { take(); offset = readNumber(take(), "Component offset", 0xffffff); }
      target = { component: destination.text, offset };
      checks.push(() => {
        const value = component(destination);
        const length = "size" in value ? value.size : deviceModels[value.kind].size;
        if (offset + size > length) fail(destination, "Window extends beyond its target component");
      });
    }
    const when: { component: string; view: string }[] = [];
    if (current().text === "when") {
      take();
      do {
        const selector = take();
        const match = /^([a-z][a-z0-9_]*)\.([A-Za-z][A-Za-z0-9_]*)$/.exec(selector.text);
        if (!match) return fail(selector, "Expected component.view condition");
        const name = match[1]!, view = match[2]!;
        when.push({ component: name, view });
        checks.push(() => {
          const value = component({ ...selector, text: name });
          const selectors: readonly string[] = isDeviceKind(value.kind) ? deviceModels[value.kind].selectors : [];
          if (!selectors.includes(view)) fail(selector, "Window conditions require a zero-input flag view of a device");
        });
        if (current().text !== "and") break;
        take();
      } while (true);
    }
    list.push({ target, when });
  }
  take();
  for (const direction of ["read", "write"] as const) {
    if (routes[direction].at(-1)?.when.length !== 0) fail(token, `Window requires an unconditional ${direction} route`);
  }
  return { definition: { size, ...routes } satisfies MemoryWindowDefinition,
    validate: (): void => { for (const check of checks) check(); } };
}
