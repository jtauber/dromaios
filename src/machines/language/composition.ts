import type { MachineSyntax, Token } from "./syntax.ts";
import { deviceModels, isDeviceKind } from "../../components/devices/models.ts";
import type { DeviceKind } from "../../components/devices/models.ts";

export type ComponentDefinition = { readonly name: string } & (
  | { readonly kind: "ram" | "rom"; readonly size: number }
  | { readonly kind: DeviceKind }
);
export interface ImageDefinition {
  readonly component: string;
  readonly address: number;
  readonly bytes: readonly number[];
}
export interface ExternalImageDefinition {
  readonly component: string;
  readonly sha256: string;
}
export interface PortBinding {
  readonly direction: "in" | "out";
  readonly port: number;
  readonly component: string;
  readonly address: number;
}
export interface ComponentsDefinition {
  readonly components: readonly ComponentDefinition[];
  readonly images: readonly ImageDefinition[];
  readonly externalImages?: readonly ExternalImageDefinition[];
}
export interface CompositionDefinition extends ComponentsDefinition {
  readonly connection: { readonly kind: "direct"; readonly component: string } | {
    readonly kind: "mapped"; readonly size: number;
    readonly unmapped?: number;
    readonly regions: readonly { readonly start: number; readonly component: string }[];
  };
  readonly ports?: readonly PortBinding[];
  readonly unmappedPorts?: number;
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
  const externalImages: (ExternalImageDefinition & { token: Token })[] = [];
  const regions: { start: number; component: string; token: Token }[] = [];
  const ports: (PortBinding & { token: Token; addressToken: Token })[] = [];
  const resets = new Map<string, Token[]>();
  let direct: Token | undefined;
  let mapSize: number | undefined;
  let unmapped: number | undefined;
  let unmappedPorts: number | undefined;

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
    return "size" in value ? value.size : deviceModels[value.kind].size;
  }

  function finishComponents(): ComponentsDefinition {
    if (!declarations.has("components")) fail(current(), "Missing components declaration");
    if (!components.size) fail(declarations.get("components")!, "Declare at least one component");
    for (const image of externalImages) {
      if (component(image.token).kind !== "rom") fail(image.token, "External images require ROM");
      if (images.some(embedded => embedded.component === image.component)) {
        fail(image.token, "External ROM cannot also contain embedded images");
      }
    }
    for (const image of images) {
      const target = component(image.token);
      if (target.kind !== "ram" && target.kind !== "rom") fail(image.token, "Images require RAM or ROM");
      const length = size(target);
      if (image.address >= length) fail(image.addressToken, `Image address exceeds component ${image.component}`);
      const remaining = length - image.address;
      if (image.bytes.length > remaining) fail(image.byteTokens[remaining]!, `Image extends beyond component ${image.component}`);
    }
    return {
      components: [...components.values()],
      images: images.map(({ component, address, bytes }) => ({ component, address, bytes })),
      ...(externalImages.length ? { externalImages: externalImages.map(({ component, sha256 }) => ({ component, sha256 })) } : {}),
    };
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
            if (["cpu", "memory", "ports", "reset", "snapshot"].includes(token.text)) fail(token, `Reserved component name ${token.text}`);
            if (components.has(token.text)) fail(token, `Duplicate component ${token.text}`);
            expect("=");
            const kind = take();
            if (kind.text === "ram" || kind.text === "rom") {
              const amount = take();
              const length = readNumber(amount, "Component size", 0x1000000);
              if (!length) fail(amount, "Component size must be positive");
              components.set(token.text, { name: token.text, kind: kind.text, size: length });
            } else if (isDeviceKind(kind.text)) {
              components.set(token.text, { name: token.text, kind: kind.text });
            } else fail(kind, `Expected component kind ram, rom, or ${Object.keys(deviceModels).join(", ")}`);
          });
          break;
        case "memory":
          expect("=");
          direct = name();
          break;
        case "map":
          mapSize = readNumber(take(), "Address-space size", 0x1000000);
          block("map", () => {
            if (current().text === "unmapped") {
              const token = take();
              if (unmapped !== undefined) fail(token, "Duplicate unmapped bus value");
              expect("=");
              unmapped = readNumber(take(), "Unmapped bus value", 0xff);
              return;
            }
            const start = readNumber(take(), "Region start", 0xffffff);
            expect("=");
            const token = name();
            regions.push({ start, component: token.text, token });
          });
          break;
        case "image": {
          const token = name();
          if (current().text === "external") {
            take();
            expect("sha256");
            const digest = take();
            if (!/^[\da-fA-F]{64}$/.test(digest.text)) fail(digest, "Expected a 64-digit SHA-256 digest");
            if (externalImages.some(image => image.component === token.text)) fail(token, "Duplicate external image");
            externalImages.push({ component: token.text, sha256: digest.text.toLowerCase(), token });
            break;
          }
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
            if (direction.text === "unmapped") {
              if (unmappedPorts !== undefined) fail(direction, "Duplicate unmapped port value");
              expect("=");
              unmappedPorts = readNumber(take(), "Unmapped port value", 0xff);
              return;
            }
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
    finishComponents(): ComponentsDefinition {
      for (const [keyword, token] of declarations) {
        if (keyword !== "components" && keyword !== "image") fail(token, `${keyword} requires a cpu declaration`);
      }
      return finishComponents();
    },
    finish(cpu: string, requiredSize: number): CompositionDefinition {
      const definition = finishComponents();
      if (direct && mapSize !== undefined) fail(declarations.get("map")!, "Choose memory = component or map, not both");
      let connection: CompositionDefinition["connection"];
      if (direct) {
        const target = component(direct);
        if (target.kind !== "ram" || target.size !== requiredSize) {
          fail(direct, `Direct CPU memory requires RAM of size ${requiredSize.toString(16).toUpperCase()}`);
        }
        connection = { kind: "direct", component: direct.text };
      } else if (mapSize !== undefined) {
        if (!["68000", "8080", "6502"].includes(cpu)) fail(declarations.get("map")!, "Mapped memory currently requires CPU 6502, 8080, or 68000");
        if (cpu !== "68000" && unmapped === undefined) fail(declarations.get("map")!, `A ${cpu} map requires an explicit unmapped bus value`);
        if (cpu === "68000" && unmapped !== undefined) fail(declarations.get("map")!, "68000 maps report bus errors; unmapped bus values currently require CPU 6502 or 8080");
        if (mapSize !== requiredSize) fail(declarations.get("map")!, `Address-space size for ${cpu} must be ${requiredSize.toString(16).toUpperCase()}`);
        const sorted = regions.map(region => ({ ...region, end: region.start + size(component(region.token)) }))
          .sort((left, right) => left.start - right.start);
        for (const [index, region] of sorted.entries()) {
          if (region.end > mapSize) fail(region.token, "Mapped component extends beyond the address space");
          if (index && region.start < sorted[index - 1]!.end) fail(region.token, "Memory regions overlap");
        }
        connection = { kind: "mapped", size: mapSize, ...(unmapped === undefined ? {} : { unmapped }),
          regions: regions.map(({ start, component }) => ({ start, component })) };
      } else return fail(current(), "Missing CPU memory connection: memory = component or map");

      if (declarations.has("ports") && cpu !== "8080") fail(declarations.get("ports")!, "Port bindings currently require CPU 8080");
      for (const binding of ports) {
        const target = component(binding.token);
        const kind = target.kind;
        if (!isDeviceKind(kind)) return fail(binding.token, "Ports require a device component");
        const device = deviceModels[kind];
        const addresses: readonly number[] = binding.direction === "in" ? device.reads : device.writes;
        if (!addresses.length) fail(binding.token, `${binding.direction} ports require a ${binding.direction === "in" ? "readable" : "writable"} device`);
        if (binding.address >= size(target)) fail(binding.addressToken, `Device address exceeds component ${binding.component}`);
        if (!addresses.includes(binding.address)) fail(binding.addressToken, `Device register does not support ${binding.direction}`);
      }
      if (resets.has("reset-devices") && cpu !== "68000") fail(declarations.get("reset-devices")!, "reset-devices currently requires CPU 68000");
      for (const [kind, targets] of resets) {
        if (kind === "reset" && targets[0]?.text !== "cpu") fail(declarations.get(kind)!, "Machine reset must begin with cpu");
        for (const target of kind === "reset" ? targets.slice(1) : targets) {
          const value = component(target);
          if (!isDeviceKind(value.kind)) fail(target, "Only devices can follow cpu in a reset list or appear in reset-devices");
        }
      }
      return {
        ...definition, connection,
        ...(declarations.has("ports") ? { ports: ports.map(({ direction, port, component, address }) => ({ direction, port, component, address })) } : {}),
        ...(unmappedPorts === undefined ? {} : { unmappedPorts }),
        ...(resets.has("reset") ? { reset: resets.get("reset")!.map(token => token.text) } : {}),
        ...(resets.has("reset-devices") ? { resetDevices: resets.get("reset-devices")!.map(token => token.text) } : {}),
      };
    },
  };
}
