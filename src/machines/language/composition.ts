import type { MachineSyntax, Token } from "./syntax.ts";

export type ComponentDefinition = { readonly name: string } & (
  | { readonly kind: "ram" | "rom"; readonly size: number }
  | { readonly kind: "byte-input" | "byte-output" }
);
export interface ImageDefinition {
  readonly component: string;
  readonly address: number;
  readonly bytes: readonly number[];
}
export interface PortBinding {
  readonly direction: "in" | "out";
  readonly port: number;
  readonly component: string;
  readonly address: number;
}
export interface CompositionDefinition {
  readonly components: readonly ComponentDefinition[];
  readonly connection: { readonly kind: "direct"; readonly component: string } | {
    readonly kind: "mapped"; readonly size: number;
    readonly regions: readonly { readonly start: number; readonly component: string }[];
  };
  readonly images: readonly ImageDefinition[];
  readonly ports?: readonly PortBinding[];
  readonly reset?: readonly string[];
  readonly resetDevices?: readonly string[];
}

/** Read wiring as data; resolve forward references after all declarations and the CPU are known. */
export function compositionSyntax(syntax: MachineSyntax) {
  const { current, take, expect, readNumber, readByte } = syntax;
  const fail: (token: Token, message: string) => never = syntax.fail;
  const declarations = new Map<string, Token>();
  const components = new Map<string, ComponentDefinition>();
  const images: (ImageDefinition & { token: Token; addressToken: Token; byteTokens: Token[] })[] = [];
  const regions: { start: number; component: string; token: Token }[] = [];
  const ports: (PortBinding & { token: Token; addressToken: Token })[] = [];
  const resets = new Map<string, Token[]>();
  let direct: Token | undefined;
  let mapSize: number | undefined;

  function name(): Token {
    const token = take();
    if (!/^[a-z][a-z0-9_]*$/.test(token.text)) fail(token, "Expected a lowercase component name");
    return token;
  }
  function block(label: string, entry: () => void): void {
    expect("{");
    while (current().text !== "}") {
      if (current().text === "") fail(current(), `Expected "}" to close ${label}`);
      entry();
    }
    take();
  }
  function component(token: Token): ComponentDefinition {
    const value = components.get(token.text);
    if (!value) return fail(token, `Unknown component ${JSON.stringify(token.text)}`);
    return value;
  }
  function size(value: ComponentDefinition): number {
    return "size" in value ? value.size : value.kind === "byte-input" ? 2 : 1;
  }

  return {
    get present(): boolean { return declarations.size > 0; },
    read(declaration: Token): boolean {
      const keyword = declaration.text;
      if (!["components", "map", "image", "ports", "reset", "reset-devices", "memory"].includes(keyword)) return false;
      if (keyword !== "image" && declarations.has(keyword)) fail(declaration, `Duplicate ${keyword} declaration`);
      declarations.set(keyword, declaration);
      switch (keyword) {
        case "components":
          block("components", () => {
            const token = name();
            if (["cpu", "memory", "ports", "reset"].includes(token.text)) fail(token, `Reserved component name ${token.text}`);
            if (components.has(token.text)) fail(token, `Duplicate component ${token.text}`);
            expect("=");
            const kind = take();
            if (kind.text === "ram" || kind.text === "rom") {
              const amount = take();
              const length = readNumber(amount, "Component size", 0x1000000);
              if (!length) fail(amount, "Component size must be positive");
              components.set(token.text, { name: token.text, kind: kind.text, size: length });
            } else if (kind.text === "byte-input" || kind.text === "byte-output") {
              components.set(token.text, { name: token.text, kind: kind.text });
            } else fail(kind, "Expected component kind ram, rom, byte-input, or byte-output");
          });
          break;
        case "memory":
          expect("=");
          direct = name();
          break;
        case "map":
          mapSize = readNumber(take(), "Address-space size", 0x1000000);
          block("map", () => {
            const start = readNumber(take(), "Region start", 0xffffff);
            expect("=");
            const token = name();
            regions.push({ start, component: token.text, token });
          });
          break;
        case "image": {
          const token = name();
          const addressToken = take();
          const address = readNumber(addressToken, "Image address", 0xffffff);
          const bytes: number[] = [], byteTokens: Token[] = [];
          block("image", () => {
            const byte = take();
            bytes.push(readByte(byte));
            byteTokens.push(byte);
          });
          images.push({ component: token.text, address, bytes, token, addressToken, byteTokens });
          break;
        }
        case "ports":
          block("ports", () => {
            const direction = take();
            if (direction.text !== "in" && direction.text !== "out") return fail(direction, 'Expected port direction "in" or "out"');
            const portToken = take();
            const port = readNumber(portToken, "Port", 0xff);
            if (ports.some(binding => binding.direction === direction.text && binding.port === port)) {
              fail(portToken, `Duplicate ${direction.text} port ${port.toString(16).toUpperCase()}`);
            }
            expect("=");
            const token = name(), addressToken = take();
            ports.push({ direction: direction.text, port, component: token.text, token, addressToken,
              address: readNumber(addressToken, "Device address", 0xffffff) });
          });
          break;
        case "reset":
        case "reset-devices": {
          const targets: Token[] = [];
          block(keyword, () => {
            const token = name();
            if (targets.some(target => target.text === token.text)) fail(token, `Duplicate reset target ${token.text}`);
            targets.push(token);
          });
          resets.set(keyword, targets);
          break;
        }
      }
      return true;
    },
    finish(cpu: string, requiredSize: number): CompositionDefinition {
      if (!declarations.has("components")) fail(current(), "Missing components declaration");
      if (direct && mapSize !== undefined) fail(declarations.get("map")!, "Choose memory = component or map, not both");
      let connection: CompositionDefinition["connection"];
      if (direct) {
        const target = component(direct);
        if (target.kind !== "ram" || target.size !== requiredSize) {
          fail(direct, `Direct CPU memory requires RAM of size ${requiredSize.toString(16).toUpperCase()}`);
        }
        connection = { kind: "direct", component: direct.text };
      } else if (mapSize !== undefined) {
        if (cpu !== "68000") fail(declarations.get("map")!, "Mapped memory currently requires CPU 68000");
        if (mapSize !== requiredSize) fail(declarations.get("map")!, `Address-space size for ${cpu} must be ${requiredSize.toString(16).toUpperCase()}`);
        const sorted = regions.map(region => ({ ...region, end: region.start + size(component(region.token)) }))
          .sort((left, right) => left.start - right.start);
        for (const [index, region] of sorted.entries()) {
          if (region.end > mapSize) fail(region.token, "Mapped component extends beyond the address space");
          if (index && region.start < sorted[index - 1]!.end) fail(region.token, "Memory regions overlap");
        }
        connection = { kind: "mapped", size: mapSize, regions: regions.map(({ start, component }) => ({ start, component })) };
      } else return fail(current(), "Missing CPU memory connection: memory = component or map");

      for (const image of images) {
        const target = component(image.token);
        if (target.kind !== "ram" && target.kind !== "rom") fail(image.token, "Images require RAM or ROM");
        const length = size(target);
        if (image.address >= length) fail(image.addressToken, `Image address exceeds component ${image.component}`);
        const remaining = length - image.address;
        if (image.bytes.length > remaining) fail(image.byteTokens[remaining]!, `Image extends beyond component ${image.component}`);
      }
      if (declarations.has("ports") && cpu !== "8080") fail(declarations.get("ports")!, "Port bindings currently require CPU 8080");
      for (const binding of ports) {
        const target = component(binding.token);
        const kind = binding.direction === "in" ? "byte-input" : "byte-output";
        if (target.kind !== kind) fail(binding.token, `${binding.direction} ports require a ${kind} component`);
        if (binding.address >= size(target)) fail(binding.addressToken, `Device address exceeds component ${binding.component}`);
      }
      if (resets.has("reset-devices") && cpu !== "68000") fail(declarations.get("reset-devices")!, "reset-devices currently requires CPU 68000");
      for (const [kind, targets] of resets) {
        if (kind === "reset" && targets[0]?.text !== "cpu") fail(declarations.get(kind)!, "Machine reset must begin with cpu");
        for (const target of kind === "reset" ? targets.slice(1) : targets) {
          const value = component(target);
          if (value.kind !== "byte-input" && value.kind !== "byte-output") fail(target, "Only devices can follow cpu in a reset list or appear in reset-devices");
        }
      }
      return {
        components: [...components.values()], connection,
        images: images.map(({ component, address, bytes }) => ({ component, address, bytes })),
        ...(declarations.has("ports") ? { ports: ports.map(({ direction, port, component, address }) => ({ direction, port, component, address })) } : {}),
        ...(resets.has("reset") ? { reset: resets.get("reset")!.map(token => token.text) } : {}),
        ...(resets.has("reset-devices") ? { resetDevices: resets.get("reset-devices")!.map(token => token.text) } : {}),
      };
    },
  };
}
