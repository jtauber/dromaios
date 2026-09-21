import type { DecodedPage } from "./opcode-pages.ts";

/** Generate binding and decode stages separately so cores choose when state effects begin. */
export function generatePageBindings(pages: readonly DecodedPage[], names: ReadonlySet<string>, stateType: string, context: string, outcome: string) {
  const handler = `(instruction: ${context}) => ${outcome}`;
  const pageHandler = (page: DecodedPage) => `(${page.operands.map((_, index) => `operand${index}: number, `).join("")}instruction: ${context}) => ${outcome}`;
  const additional = `, additional: { ${pages.map(page => `${page.name}?: readonly OpcodeEntry<${pageHandler(page)}>[]`).join("; ")} } = {}`;
  const groups = [{ key: 0, operands: [] }, ...pages];
  const pageBindings = [
    ...groups.flatMap((page, index) => {
      const captures = page.operands.map((_, index) => `operand${index}`);
      const parameters = [...captures.map(name => `${name}: number`), `instruction: ${context}`].join(", ");
      const argumentsList = [...captures, "instruction"].join(", ");
      return [
        `  const bodies${index}: readonly OpcodeEntry<(state: ${stateType}, ${parameters}) => ${outcome}>[] = [`,
        ...[...names].filter(name => Math.floor(Number(name) / 256) === page.key)
          .map(name => `    [0x${(Number(name) & 255).toString(16)}, instructions[${name}]],`),
        "  ];",
        `  const entries${index}: OpcodeEntry<(${parameters}) => ${outcome}>[] = bodies${index}.map(([opcode, execute]) =>`,
        `    [opcode, (${argumentsList}) => execute(state, ${argumentsList})]);`,
      ];
    }),
    "  const pages = {",
    ...pages.map((page, index) =>
      `    ${page.name}: { prefix: ${page.prefix}, handlers: opcodeTable([...entries${index + 1}, ...(Object.hasOwn(additional, "${page.name}") ? additional.${page.name}! : [])]) },`),
    "  };",
    ...pages.filter(page => page.on).map(page =>
      `  if (Object.hasOwn(pages.${page.on}.handlers, pages.${page.name}.prefix)) throw new Error("Duplicate opcode page prefix.");`),
    "  return { base: entries0, pages };",
  ].join("\n");
  function decode(page: DecodedPage, count: number, indent: string): string[] {
    const nextCount = count + Number(page.opcodeFetch), name = page.name;
    const captures = page.operands.map((_, index) => `operand${index}`);
    return [
      ...captures.map(operand => `${indent}const ${operand} = nextByte(false);`),
      `${indent}const opcode = nextByte(${page.opcodeFetch});`,
      ...pages.filter(child => child.on === name).flatMap(child => [
        `${indent}if (opcode === pages.${child.name}.prefix) {`, ...decode(child, nextCount, indent + "  "), `${indent}}`,
      ]),
      `${indent}const execute = pages.${name}.handlers[opcode];`,
      `${indent}return { handler: ${page.operands.length ? `execute && (instruction => execute(${[...captures, "instruction"].join(", ")}))` : "execute"}, opcodeFetches: ${nextCount} };`,
    ];
  }
  const decoder = [
    `export function opcodeDecoder(state: ${stateType}${additional}) {`,
    "  const { base, pages } = opcodePages(state, additional), handlers = opcodeTable(base);",
    `  return (opcode: number, nextByte: (opcodeFetch: boolean) => number): { handler: (${handler}) | undefined; opcodeFetches: number } => {`,
    ...pages.filter(page => !page.on).flatMap(page => [
      `    if (opcode === pages.${page.name}.prefix) {`, ...decode(page, 1, "      "), "    }",
    ]), "    return { handler: handlers[opcode], opcodeFetches: 1 };", "  };", "}",
  ].join("\n");
  const entryOpcodes = [...[...names].map(Number).filter(opcode => opcode < 256), ...pages.filter(page => !page.on).map(page => page.prefix)];
  const bindings = [
    "  const decode = opcodeDecoder(state, additional);",
    `  return ${JSON.stringify(entryOpcodes)}.map(opcode => [opcode, instruction => {`,
    "    const { handler } = decode(opcode, () => instruction.fetchByte());",
    '    return handler ? handler(instruction) : "unsupported";', "  }]);",
  ].join("\n");
  return { additional, pageBindings, decoder, bindings };
}
