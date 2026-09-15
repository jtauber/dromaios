"use strict";

// This prototype owns presentation state only. These fixtures do not import or
// implement a CPU. The ordinary case follows the documented 6502 example.
const cases = {
  ordinary: { name: "2 + 3 · ordinary addition", left: 2, right: 3, result: 5, c: 0, v: 0, n: 0, z: 0 },
  wrap: { name: "255 + 1 · unsigned wraparound", left: 255, right: 1, result: 0, c: 1, v: 0, n: 0, z: 1 },
  overflow: { name: "127 + 1 · signed overflow", left: 127, right: 1, result: 128, c: 0, v: 1, n: 1, z: 0 },
};
const state = { scenario: "ordinary", step: 0, timer: null, softwareInput: 131, softwareView: "bits" };
const scrollPositions = new Map();
let currentPath = "";
const main = document.getElementById("main");
const hex = (value, width = 2) => value.toString(16).toUpperCase().padStart(width, "0");
const bin = (value) => value.toString(2).padStart(8, "0");
const signed = (value) => value > 127 ? value - 256 : value;
const link = (path, text, classes = "") => `<a href="#${path}"${classes ? ` class="${classes}"` : ""}>${text}</a>`;
const button = (action, text, classes = "", disabled = false) => `<button type="button" data-action="${action}" class="${classes}"${disabled ? " disabled" : ""}>${text}</button>`;
const crumbs = (parts) => `<nav class="breadcrumbs" aria-label="Breadcrumb">${[["/", "Home"], ...parts].map(([path, label], i, all) => `<span>${i === all.length - 1 ? label : link(path, label)}</span>`).join("")}</nav>`;
const heading = (eyebrow, title, description = "") => `<div class="page-heading"><div class="eyebrow">${eyebrow}</div><h1>${title}</h1>${description ? `<p class="lead">${description}</p>` : ""}</div>`;
const entry = (label, title, text, path, action = "Explore →") => `<article class="entry"><div class="eyebrow">${label}</div><h3>${path ? link(path, title) : title}</h3><p>${text}</p>${path ? link(path, action, "link") : '<span class="tag">Page planned</span>'}</article>`;
const row = (number, title, description, path) => `<a class="row-link" href="#${path}"><span class="number">${number}</span><div><h3>${title}</h3><p>${description}</p></div><span aria-hidden="true">→</span></a>`;
const section = (title, content) => `<section class="section"><h2>${title}</h2>${content}</section>`;
const exploreTabs = () => `<nav class="tabs" aria-label="Explore categories">${[["/explore", "Overview"], ["/explore/cpus", "CPUs"], ["/explore/machines", "Machines"], ["/explore/software", "Software"], ["/explore/comparisons", "Comparisons"]].map(([path, label]) => `<a href="#${path}"${currentPath === path ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</nav>`;

function snapshot(step = state.step) {
  const example = cases[state.scenario];
  const snapshots = [
    { pc: 0x200, a: 0, c: 1, n: 0, z: 0, v: 0, memory: 0 },
    { pc: 0x201, a: 0, c: 0, n: 0, z: 0, v: 0, memory: 0 },
    { pc: 0x203, a: example.left, c: 0, n: example.left > 127 ? 1 : 0, z: example.left === 0 ? 1 : 0, v: 0, memory: 0 },
    { pc: 0x205, a: example.result, c: example.c, n: example.n, z: example.z, v: example.v, memory: 0 },
    { pc: 0x208, a: example.result, c: example.c, n: example.n, z: example.z, v: example.v, memory: example.result },
  ];
  return snapshots[step];
}

function program() {
  const example = cases[state.scenario];
  return [
    [0x200, "18", "CLC", "Clear incoming carry"],
    [0x201, `A9 ${hex(example.left)}`, `LDA #$${hex(example.left)}`, "Load the first value"],
    [0x203, `69 ${hex(example.right)}`, `ADC #$${hex(example.right)}`, "Add the second value and carry"],
    [0x205, "8D 80 00", "STA $0080", "Store the result in RAM"],
  ];
}

function explanation() {
  const example = cases[state.scenario];
  return [
    "Ready to begin. The initial carry is 1. First, CLC will clear it so it contributes zero to the addition.",
    "CLC cleared carry. The accumulator is still $00. Next, LDA will load the first value into A.",
    `LDA loaded ${example.left} ($${hex(example.left)}) into A. Next, ADC will add ${example.right} and the incoming carry, currently 0.`,
    `ADC produced $${hex(example.result)}. Carry is ${example.c}; signed overflow is ${example.v}. The result is still in A; the store has not happened yet.`,
    `STA wrote $${hex(example.result)} to $0080. The example is complete at $0208. This is the example's completion boundary.`,
  ][state.step];
}

function controls() {
  return `<div class="controls">${button("step", "Step →", "primary", state.step === 4 || state.timer !== null)}${button("run", state.timer ? "Pause" : "Run", "", state.step === 4)}${button("restart", "Restart example")}</div>`;
}

function casePicker() {
  return `<label class="small">Example <select data-action="scenario" aria-label="Addition example">${Object.entries(cases).map(([id, item]) => `<option value="${id}"${id === state.scenario ? " selected" : ""}>${item.name}</option>`).join("")}</select></label>`;
}

function registers() {
  const now = snapshot();
  const before = snapshot(Math.max(0, state.step - 1));
  const reg = (name, value, old, width = 2) => `<div class="register${state.step > 0 && value !== old ? " changed" : ""}"><span>${name}${state.step > 0 && value !== old ? " · changed" : ""}</span><strong class="mono">${hex(value, width)}</strong></div>`;
  return `<div class="registers">${reg("A", now.a, before.a)}${reg("X", 0, 0)}${reg("Y", 0, 0)}${reg("PC", now.pc, before.pc, 4)}${reg("SP", 255, 255)}<div class="register"><span>Notation</span><strong class="mono">hex</strong></div></div>
    <div class="flags" aria-label="Processor flags">${["n", "v", "z", "c"].map(flag => `<span class="flag mono${state.step > 0 && now[flag] !== before[flag] ? " changed" : ""}">${flag.toUpperCase()} ${now[flag]}</span>`).join("")}<span class="flag mono">D 0</span><span class="flag mono">I 1</span></div>`;
}

function programTable() {
  return `<div class="table-scroll"><table><caption class="small muted" style="text-align:left;padding:12px 14px">6502 · prepared instruction sequence · hexadecimal</caption><thead><tr><th>State</th><th>Address</th><th>Bytes</th><th>Instruction</th></tr></thead><tbody>${program().map(([addr, bytes, instruction], i) => `<tr class="${i === state.step ? "next" : i === state.step - 1 ? "last" : ""}"><td class="marker">${i === state.step ? "Next" : i === state.step - 1 ? "Last" : ""}</td><td class="mono">${hex(addr, 4)}</td><td class="mono">${bytes}</td><td class="mono">${instruction}</td></tr>`).join("")}</tbody></table></div>`;
}

function miniInspector() {
  return `<aside class="inspector" aria-label="Instruction inspector"><div class="panel-title"><h2>Follow the program</h2><span class="mono small">6502</span></div><div class="panel-body">${registers()}${controls()}<p class="status-line" role="status">${state.timer ? "Running" : state.step === 4 ? "Completed" : "Paused"} · ${state.step} of 4 instructions</p><p class="state-note">${explanation()}</p>${link("/workspace/6502/addition", "Open full workspace ↗", "small")}</div><div class="panel-title"><span class="muted">Prepared states · no CPU connected</span></div></aside>`;
}

function home() {
  const example = cases[state.scenario];
  return `<section class="hero"><div><div class="eyebrow">Computers, explained</div><h1>Explore how<br>computers work.</h1><p class="lead">Follow an instruction. Look inside a machine. Discover the ideas behind the software you know.</p><div class="actions">${link("/learn/first-addition", "Start with one addition →", "button primary")}${link("/explore", "Explore the collection", "button")}</div></div>
    <div class="hero-demo"><div class="panel-title"><span>One instruction, made visible</span><span class="mono">6502</span></div><div class="panel-body"><div class="eyebrow">An accumulator and an idea</div><div class="result-expression mono"><span>${example.left}</span><span>+</span><span>${example.right}</span><span>=</span><span class="result">${state.step >= 3 ? example.result : "?"}</span></div><p class="small muted">${state.step >= 3 ? "The stored byte holds the result. Flags tell us more about the arithmetic." : "A small program connects this calculation to registers, flags, and memory."}</p></div><div class="program-mini mono small"><div><span>${state.step < 4 ? program()[state.step][2] : "Example complete"}</span><span>PC ${hex(snapshot().pc, 4)}</span></div><div><span>A ${hex(snapshot().a)}</span><span>Carry ${snapshot().c}</span></div></div><div class="panel-foot">${button("step", state.step === 4 ? "Completed" : "Take one step →", "", state.step === 4)}${link("/learn/first-addition", "Follow the explanation", "small")}</div></div></section>
    <section class="section"><div class="section-heading"><h2>Choose a way in</h2><span class="small muted">From a single bit to a complete program</span></div><div class="grid">${entry("Learn", "Build an understanding", "Short, guided explorations of numbers, instructions, memory, and the ideas that connect them.", "/learn", "Find a starting point →")}${entry("Explore", "Open the machine", "Follow programs on different CPUs and see how components fit into a computer.", "/explore", "Browse CPUs and machines →")}${entry("Software studies", "Read the program", "Connect a software guide to annotated code, data, and a demonstration you can manipulate.", "/explore/software", "Browse software studies →")}</div></section>
    <section class="section"><div class="section-heading"><h2>A closer look at software</h2>${link("/explore/software", "All software studies →", "small")}</div><div class="grid two">${entry("Chapter preview · Elite-A", "Before the square: one bit matters", "A short source excerpt and an interactive bit experiment show how a software chapter could work.", "/software/elite-a/squa", "Read the chapter →")}${entry("Reference", "A companion to exploration", "Look up the registers, instructions, and terms you meet along the way.", "/reference", "Open the reference →")}</div></section>`;
}

function learn() {
  return `${crumbs([["/learn", "Learn"]])}${heading("Learn", "Follow an idea.", "Start small, make a prediction, and see what happens. Every lesson opens a route into deeper exploration.")}
    <div class="grid two"><div>${entry("Start here", "One addition, all the way down", "Connect 2 + 3 to instruction bytes, a register, flags, and a location in memory.", "/learn/first-addition", "Start the first lesson →")}</div><div>${entry("Software studies", "From a program to an instruction", "Read a chapter, inspect its code, and experiment with an idea from substantial software.", "/explore/software", "Find a software study →")}</div></div>
    ${section("A first learning path", `<div class="row-list">${row("01", "Values and representations", "See one byte in binary, hexadecimal, unsigned, and signed forms.", "/reference/glossary")}${row("02", "An addition on the 6502", "Follow the example through load, add, and store.", "/learn/first-addition")}${row("03", "Look inside the workspace", "Open the program, registers, and memory together.", "/workspace/6502/addition")}</div>`)}
    ${section("Ideas to explore", `<div class="grid">${entry("Arithmetic", "What flags tell us", "Explore ordinary addition, unsigned wraparound, and signed overflow.", "/reference/6502/adc")}${entry("Bits", "Keep some bits, clear others", "Try a mask alongside a short source-code excerpt.", "/software/elite-a/squa")}${entry("Architectures", "Different ways to organize state", "Compare the register relationships a workspace needs to show.", "/explore/comparisons")}</div>`)}`;
}

function explore() {
  return `${crumbs([["/explore", "Explore"]])}${heading("Explore", "Computers at every scale.", "Choose a processor, a complete machine, or a piece of software. Follow the connections between them.")}${exploreTabs()}<div class="grid">${entry("Components", "CPUs", "Open a small program and follow how instructions change registers and memory.", "/explore/cpus", "Browse CPUs →")}${entry("Systems", "Machines", "Discover the memory, processor, and devices that make up a computer.", "/explore/machines", "Browse machines →")}${entry("Programs", "Software", "Read detailed studies with code, data, and interactive explanations.", "/explore/software", "Browse software →")}</div>${section("Start with a working idea", `<div class="row-list">${row("01", "6502: load, add, and store", "Four instructions connect a calculation to a memory write.", "/cpus/6502")}${row("02", "Elite-A: before the square", "A conceptual demonstration linked to one source instruction.", "/software/elite-a/squa")}</div>`)}`;
}

function cpus() {
  return `${crumbs([["/explore", "Explore"], ["/explore/cpus", "CPUs"]])}${heading("Explore / CPUs", "Many architectures.<br>Shared questions.", "How is a value represented? Where does an operand come from? What changes when an instruction runs?")}${exploreTabs()}<div class="grid">${entry("First overview", "MOS 6502", "A small register set, flags, and direct connections between instructions and memory.", "/cpus/6502", "Open the 6502 →")}${entry("Layout comparison", "Intel 8080", "Registers and their 16-bit pairings provide another view of state.", "/explore/comparisons", "Compare register layouts →")}${entry("Layout comparison", "Motorola 6809", "Two accumulators also form a wider value; two stacks need distinct places in the inspector.", "/explore/comparisons", "Compare register layouts →")}</div>${section("The wider collection", '<p class="muted">The project also has CPU examples for the 8008, 6800, Z80, 8088, and 68000. Their individual overview pages are planned for later prototype passes.</p>')}`;
}

function cpu6502() {
  return `${crumbs([["/explore", "Explore"], ["/explore/cpus", "CPUs"], ["/cpus/6502", "MOS 6502"]])}${heading("CPU / MOS 6502", "A small register set.<br>A lot to discover.", "Meet the accumulator, follow an instruction, and see how a program leaves its result in memory.")}
    <div class="actions">${link("/learn/first-addition", "Follow an introduction →", "button primary")}${link("/workspace/6502/addition", "Open the example workspace", "button")}${link("/reference/6502/adc", "Instruction reference", "small")}</div>
    <div class="grid two section"><div><h2>What to look for</h2><p>A holds the result of our addition. The flags describe properties of the result. PC tells us where execution will continue.</p><p class="muted">The workspace keeps these roles visible while you move between instructions.</p></div><div><div class="diagram" aria-label="CPU and RAM are connected"><span class="mono">6502<br>A · X · Y<br>PC · SP · flags</span><span aria-hidden="true">↔</span><span class="mono">RAM<br>program<br>data</span></div></div></div>
    ${section("Examples", `<div class="row-list">${row("01", "Load, add, and store", "Start with 2 + 3, then investigate two boundary cases.", "/learn/first-addition")}${row("02", "An expanded view", "See instruction bytes and recorded changes beside the relevant memory.", "/workspace/6502/addition")}</div>`)}
    <p class="rule-note">This prototype uses prepared instruction states. The project documentation defines actual CPU behavior and coverage; this page demonstrates the proposed presentation.</p>`;
}

function machines() {
  return `${crumbs([["/explore", "Explore"], ["/explore/machines", "Machines"]])}${heading("Explore / Machines", "See the parts together.", "A machine gives a processor its surroundings: memory, input, display, and other devices.")}${exploreTabs()}<div class="grid">${entry("Overview preview", "BBC Micro", "Follow the proposed connection from a 6502 machine to an Elite software study.", "/machines/bbc-micro", "Explore the overview →")}${entry("Planned", "Apple II", "A future machine entry connecting architecture, software, and inspection.", null)}${entry("Planned", "Altair 8800", "A future machine entry connecting the 8080 to its memory and devices.", null)}</div>`;
}

function bbcMicro() {
  return `${crumbs([["/explore", "Explore"], ["/explore/machines", "Machines"], ["/machines/bbc-micro", "BBC Micro"]])}${heading("Machine overview / planned", "BBC Micro", "A home for machine architecture, running software, and the explanations that connect them.")}
    <div class="grid two"><section class="entry"><h2>Run and inspect</h2><div class="empty-result"><p>Machine display</p><p class="small muted">A complete machine workspace is planned. This wireframe shows where its display and controls would sit.</p></div></section><section class="entry"><h2>Explore the connections</h2><div class="row-list">${row("01", "MOS 6502", "Explore the processor through a small RAM-based example.", "/cpus/6502")}${row("02", "Elite software study", "Follow a source excerpt from the Elite-A variant.", "/software/elite-a")}</div></section></div><p class="rule-note">This is a layout proposal. It does not run the BBC Micro or load game software.</p>`;
}

function software() {
  return `${crumbs([["/explore", "Explore"], ["/explore/software", "Software"]])}${heading("Explore / Software", "Read how a program works.", "Move from the whole program to a routine, its instructions, and the data behind a visible result.")}${exploreTabs()}<div class="grid two">${entry("Chapter preview · Elite-A / Docked", "Elite", "One small routine anchors the first software chapter layout. Its demonstration explores the mathematics independently.", "/software/elite-a", "Open the software study →")}${entry("Future study", "Ultima IV", "A proposed home for program architecture, subsystem guides, annotated code, and interactive studies. Platform and version remain to be selected.", null)}</div>
    ${section("A study has several ways in", '<div class="flow-strip"><span>Program</span> → <span>Subsystem</span> → <span>Routine</span> → <span>Instruction</span> → <span>Bits</span></div><p class="muted">Guided chapters and independent exploration link to the same code, explanations, and demonstrations for a specific version.</p>')}`;
}

function elite() {
  return `${crumbs([["/explore", "Explore"], ["/explore/software", "Software"], ["/software/elite-a", "Elite"]])}${heading("Software study / source preview", "Elite", "Explore a small idea in the code, then follow it through an interactive explanation.")}
    <p><span class="tag">Elite-A</span><span class="tag">Docked code</span><span class="tag">SQUA routine</span></p><div class="actions">${link("/software/elite-a/squa", "Read the first chapter →", "button primary")}${link("/machines/bbc-micro", "Machine overview", "button")}</div>
    ${section("Guide", `<div class="row-list">${row("01", "Before the square: one bit matters", "Read a source instruction and explore its mask before considering the wider result.", "/software/elite-a/squa")}</div>`)}
    <div class="grid">${entry("Guide structure", "Program architecture", "A future overview will connect systems and identify where each routine belongs.", null)}${entry("Guide structure", "Annotated code", "This preview uses a short attributed excerpt. Wider source navigation is planned.", "/software/elite-a/squa", "See the excerpt →")}${entry("Guide structure", "Data and formats", "A future reference will connect meaningful program structures to their representation.", null)}</div>
    <p class="rule-note">The prototype selects Elite-A's docked SQUA entry point as its source example. It contains a conceptual demonstration and no complete game or game execution.</p>`;
}

function lesson() {
  const example = cases[state.scenario];
  return `${crumbs([["/learn", "Learn"], ["/learn/first-addition", "One addition"]])}${heading("First steps / 02", "One addition, all the way down.", "Follow a number into a register, through an addition, and out to memory.")}
    <div class="article-layout"><nav class="toc" aria-label="Lesson sections"><div class="eyebrow">In this lesson</div><button data-section="lesson-start">1. Predict a result</button><button data-section="lesson-instruction">2. Follow the instruction</button><button data-section="lesson-memory">3. Store the answer</button>${link("/reference/6502/adc", "ADC reference ↗")}</nav>
    <article class="prose"><section id="lesson-start"><h2>A calculation has a place.</h2><p>We can write ${example.left} + ${example.right} on paper. A program needs to put those values somewhere, choose an operation, and decide where its result will go.</p><p>Our 6502 example uses <strong>A</strong>, the accumulator. The instruction <code>LDA</code> loads the first value into A. <code>ADC</code> then adds the second value and the incoming carry.</p><div class="note"><strong>Before you step</strong><p>Predict the stored byte. Will carry be set? Does the result fit when the inputs are interpreted as signed numbers?</p></div><div class="actions">${casePicker()}</div></section>
    <section id="lesson-instruction"><h2>Read the next instruction.</h2><p>The inspector shows the current state. Take a step and look for a changed register or flag. The program counter moves to the next instruction.</p><div class="inline-code">${programTable()}</div><p>We clear carry with <code>CLC</code> before adding. The arithmetic in this example uses binary mode: D remains 0. Incoming carry is part of the addition, even when its value is zero.</p><p>The stored byte is the low eight bits of the mathematical sum. Carry tells us whether the unsigned sum exceeded 255. Overflow tells us whether the signed sum fits from −128 through 127.</p>${link("/reference/6502/adc", "Read the ADC reference →")}</section>
    <section id="lesson-memory"><h2>Give the result a home.</h2><p>After the addition, the result is in A. The final <code>STA</code> instruction writes it to memory at <code>$0080</code>. Storing the result preserves A and the flags.</p><p>Open the workspace to see the same experiment with more room for the instruction bytes, memory, and access records. Returning here preserves your current step.</p><div class="actions">${link("/workspace/6502/addition", "Explore this program →", "button primary")}</div></section><p class="rule-note">Prepared states follow the project’s load-add-store example. The two additional presets illustrate binary-arithmetic boundary cases.</p></article>${miniInspector()}</div>`;
}

function workspace() {
  const now = snapshot();
  const example = cases[state.scenario];
  const accesses = [[], ["R $0200 → $18"], [`R $0201 → $A9`, `R $0202 → $${hex(example.left)}`], [`R $0203 → $69`, `R $0204 → $${hex(example.right)}`], ["R $0205 → $8D", "R $0206 → $80", "R $0207 → $00", `W $0080 ← $${hex(example.result)}`]][state.step];
  return `${crumbs([["/explore", "Explore"], ["/cpus/6502", "6502"], ["/workspace/6502/addition", "Addition workspace"]])}${heading("6502 / Example workspace", "Load, add, and store.")}
    <div class="workspace-top">${controls()}${casePicker()}${link("/learn/first-addition", "Return to the lesson ↗", "small")}</div><div class="workspace-grid"><div><section class="panel"><div class="panel-title"><h2>Program</h2><span class="small">Last executed / next to execute</span></div>${programTable()}<div class="panel-body"><p role="status" class="status-line">${state.timer ? "Running" : state.step === 4 ? "Completed at $0208" : `Paused before ${program()[state.step][2]}`} · ${state.step} / 4 instructions</p><p>${explanation()}</p>${link("/reference/6502/adc", "Look up ADC →", "small")}</div></section>
    <section class="panel"><div class="panel-title"><h2>What the last instruction accessed</h2><span class="small">Prepared record</span></div><div class="panel-body"><div class="trace">${accesses.length ? accesses.map(access => `<div class="mono">${access}</div>`).join("") : '<p class="small muted">Take the first step to see its instruction fetch.</p>'}</div></div></section></div>
    <div><section class="panel"><div class="panel-title"><h2>Registers and flags</h2><span class="small">Changed values marked</span></div><div class="panel-body">${registers()}<p class="small muted">D = 0: binary arithmetic. I stays 1 in this example.</p></div></section><section class="panel"><div class="panel-title"><h2>Memory</h2><span class="small">Relevant locations</span></div><div class="panel-body"><div class="readout"><span>Result <code>$0080</code></span><span class="value${state.step === 4 && now.memory !== snapshot(3).memory ? " changed" : ""}">${hex(now.memory)}</span></div><div class="readout"><span>Current PC</span><span class="value">${hex(now.pc, 4)}</span></div><p class="small muted" style="margin-top:20px">Only the final store writes the result. Restart example restores the initial state and memory.</p></div></section></div></div>
    <p class="rule-note">Prototype: prepared instruction states and access records. Run advances them at a reading pace; it does not model processor timing.</p>`;
}

function softwareInspector() {
  const input = state.softwareInput;
  const masked = input & 127;
  const product = masked * masked;
  return `<aside class="inspector" aria-label="Software concept inspector"><div class="panel-title"><h2>Try the idea</h2><span class="small">Concept demo</span></div><div class="panel-body"><p class="small muted">Change the input byte. First mask it; then examine the mathematical square.</p><label class="range-label small" for="software-number">Input byte (decimal)<input id="software-number" data-action="software-value" type="number" min="0" max="255" step="1" value="${input}"></label><input aria-label="Input byte slider" data-action="software-range" type="range" min="0" max="255" value="${input}"><div class="controls"><button data-action="software-bits" aria-pressed="${state.softwareView === "bits"}">Bits</button><button data-action="software-values" aria-pressed="${state.softwareView === "values"}">Values</button></div>
    ${state.softwareView === "bits" ? `<div class="bit-row" aria-label="Input bits, most significant first">${bin(input).split("").map((bit, i) => `<button data-bit="${7 - i}" aria-label="Toggle bit ${7 - i}, currently ${bit}" aria-pressed="${bit === "1"}">${bit}</button>`).join("")}</div><p class="mono small">${bin(input)} &amp;<br>01111111<br>────────<br>${bin(masked)}</p>` : `<div class="readout"><span>Unsigned input</span><span class="value">${input}</span></div><div class="readout"><span>Same bits, signed</span><span class="value">${signed(input)}</span></div>`}
    <div class="readout"><span>After the mask</span><span class="value">${masked} <span class="small muted">$${hex(masked)}</span></span></div><div class="readout"><span>Mathematical square</span><span class="value">${product}</span></div><div class="readout"><span>High / low byte</span><span class="value">${hex(product >> 8)} / ${hex(product & 255)}</span></div><p class="state-note" role="status">${input} → ${masked} → ${product}<br>This demonstration computes the mask and square directly. It does not execute SQUA2.</p>${button("software-restart", "Restore input 131")}</div></aside>`;
}

function chapter() {
  return `${crumbs([["/explore", "Explore"], ["/explore/software", "Software"], ["/software/elite-a", "Elite"], ["/software/elite-a/squa", "Before the square"]])}${heading("Elite-A / Docked / SQUA", "Before the square:<br>one bit matters.", "Read a source instruction, inspect a bit pattern, and connect the code to a small experiment.")}
    <div class="article-layout"><nav class="toc" aria-label="Chapter sections"><div class="eyebrow">In this chapter</div><button data-section="chapter-intro">1. The entry point</button><button data-section="chapter-mask">2. Read the mask</button><button data-section="chapter-result">3. A wider result</button><button data-section="chapter-source">Sources and scope</button>${link("/software/elite-a", "← Software overview")}</nav><article class="prose"><section id="chapter-intro"><h2>Start with a small boundary.</h2><p>The <code>SQUA</code> entry point in Elite-A’s docked code clears the top bit of A, then continues into <code>SQUA2</code> to square the value. The result occupies two bytes, written as <code>(A P)</code> in the source commentary.</p><p>We can separate two questions: what reaches the multiplication, and how wide its result can be. This chapter preview begins with the first question.</p><div class="note"><strong>Predict before changing the input</strong><p>With an input byte of 131, what remains after its top bit is cleared? Use the inspector to follow the bits.</p></div></section>
    <section id="chapter-mask"><h2>Read the mask, one bit at a time.</h2><p>Select the excerpt to focus its conceptual demonstration. The code uses a mask with a zero in the top position and ones in the seven remaining positions.</p><div class="inline-code"><div class="panel-title"><span>Source excerpt · SQUA</span><span class="small">Elite-A / Docked</span></div><button class="code-select mono" data-action="focus-mask">AND #%01111111 <span>Inspect the mask ↗</span></button></div><p>A bitwise AND keeps a bit only where both inputs have a 1. For 131, the input pattern is <code>10000011</code>. Applying the mask leaves <code>00000011</code>: the value 3.</p><p>Try toggling the top input bit. The masked value stays the same. Now toggle one of the lower bits and observe how both the masked value and its square change.</p><p>The same byte also has a two’s-complement interpretation. Clearing its top bit is a mask operation; it does not generally compute the absolute value of that signed interpretation.</p></section>
    <section id="chapter-result"><h2>Make room for the result.</h2><p>The masked input ranges from 0 through 127. Its square can reach 16,129, which needs more than eight bits. The inspector splits the mathematical result into a high and low byte.</p><p>This direct calculation helps us predict an outcome. A later chapter could follow the original multiplication routine instruction by instruction and compare the result with that prediction.</p><div class="note"><strong>Try a new case</strong><p>Set the input to 255. Predict the masked value and the two result bytes. Switch between Bits and Values to check your interpretation.</p></div></section>
    <section id="chapter-source"><h2>Source and scope</h2><p class="small">The routine description and short source excerpt are grounded in <a href="https://elite.bbcelite.com/elite-a/docked/subroutine/squa.html" target="_blank" rel="noopener noreferrer">Mark Moxon’s SQUA analysis for Elite-A, Docked</a>. The demonstration and explanatory prose here are written for this prototype.</p><p class="small muted">This is a conceptual demonstration of masking and squaring. It does not load Elite, execute the original multiplication routine, or show a processor trace. A full study would pin an exact source revision and executable before binding code addresses to execution.</p></section><div class="actions">${link("/reference/glossary", "Review bits and bytes →", "button")}${link("/software/elite-a", "Back to the guide", "small")}</div></article>${softwareInspector()}</div>`;
}

function reference() {
  return `${crumbs([["/reference", "Reference"]])}${heading("Reference", "A place to look closer.", "Find a definition, inspect an instruction, and return to the experiment that raised the question.")}<div class="grid">${entry("Processor reference", "6502 · ADC", "Inputs, affected flags, an example encoding, and links into the workspace.", "/reference/6502/adc", "Read the entry →")}${entry("Glossary", "Bits, bytes, and interpretations", "A compact reference for the terms in the introductory examples.", "/reference/glossary", "Open the glossary →")}${entry("Software reference", "SQUA source study", "A routine reference connected to a guide and conceptual demonstration.", "/software/elite-a/squa", "Open the chapter →")}</div>`;
}

function adc() {
  return `${crumbs([["/reference", "Reference"], ["/cpus/6502", "6502"], ["/reference/6502/adc", "ADC"]])}${heading("Instruction reference / 6502", "ADC — add with carry", "Binary arithmetic, immediate operand. A compact reference beside the learning experience.")}
    <div class="article-layout wide-text"><nav class="toc" aria-label="Reference navigation">${link("/reference", "Reference index")}${link("/learn/first-addition", "Addition lesson")}${link("/workspace/6502/addition", "Return to workspace")}</nav><article class="prose"><h2>Inputs and result</h2><p>Add the operand and incoming carry to A. Keep the low eight bits of the sum in A.</p><div class="note mono">A ← (A + operand + C) mod 256</div><h2>Flags</h2><table><thead><tr><th>Flag</th><th>Meaning after binary ADC</th></tr></thead><tbody><tr><td>C · Carry</td><td>The unsigned sum exceeded 255.</td></tr><tr><td>V · Overflow</td><td>The signed sum lies outside −128 through 127.</td></tr><tr><td>N · Negative</td><td>Bit 7 of the stored result.</td></tr><tr><td>Z · Zero</td><td>The stored result is zero.</td></tr></tbody></table><h2>Our example</h2><p><code>69 03</code> encodes <code>ADC #$03</code>. With A = 2 and C = 0, the result is 5. The example keeps D = 0, selecting binary mode.</p><p>Different initial values let us see unsigned carry and signed overflow separately. The lesson includes three prepared cases.</p><div class="actions">${link("/learn/first-addition", "Try the cases →", "button primary")}${link("/workspace/6502/addition", "Return to current experiment", "button")}</div><p class="rule-note">This entry covers the example’s binary arithmetic mode. The repository’s 6502 model contract defines the implemented decimal behavior and remaining limitations.</p></article></div>`;
}

function glossary() {
  return `${crumbs([["/reference", "Reference"], ["/reference/glossary", "Glossary"]])}${heading("Reference / Glossary", "The same bits, different meanings.")}
    <div class="article-layout wide-text"><nav class="toc" aria-label="Reference navigation">${link("/reference", "Reference index")}${link("/learn/first-addition", "Addition lesson")}${link("/software/elite-a/squa", "Software chapter")}</nav><article class="prose"><h2>Bit and byte</h2><p>A bit has a value of 0 or 1. Eight bits form a byte, with 256 possible patterns.</p><h2>Hexadecimal</h2><p>Hexadecimal uses sixteen digits: 0 through 9 and A through F. Two hexadecimal digits can represent one byte. In these examples, a dollar sign marks hexadecimal notation: <code>$FF</code> is 255 when interpreted as unsigned.</p><h2>Signed interpretation</h2><p>In eight-bit two’s complement, patterns from <code>$00</code> to <code>$7F</code> represent 0 through 127. Patterns from <code>$80</code> to <code>$FF</code> represent −128 through −1. The bits themselves do not change when we change the interpretation.</p><h2>Register</h2><p>A register is storage within a processor. Its role depends on the architecture. In our 6502 example, A is the accumulator that holds the arithmetic result.</p><h2>Mask</h2><p>A mask selects bits for an operation. AND with <code>$7F</code> clears the top bit and preserves the lower seven.</p><div class="actions">${link("/software/elite-a/squa", "Try a mask →", "button")}${link("/learn/first-addition", "Return to the lesson", "small")}</div></article></div>`;
}

function comparisons() {
  const layout = (name, fields) => `<section class="entry"><h2>${name}</h2><div class="registers">${fields.map(([field, value]) => `<div class="register"><span>${field}</span><strong class="mono">${value}</strong></div>`).join("")}</div></section>`;
  return `${crumbs([["/explore", "Explore"], ["/explore/comparisons", "Comparisons"]])}${heading("Explore / Comparisons", "Make the relationships visible.", "A first layout check: can each CPU keep its own register organization within a shared inspection system?")}${exploreTabs()}<div class="grid">${layout("6502", [["A", "05"], ["X", "00"], ["Y", "00"], ["PC", "0205"], ["SP", "FF"], ["Flags", "…"]])}${layout("8080", [["A", "05"], ["B:C", "12:34"], ["D:E", "00:00"], ["H:L", "20:00"], ["PC", "0004"], ["SP", "FFFF"]])}${layout("6809", [["A", "12"], ["B", "34"], ["D = A:B", "1234"], ["S", "4000"], ["U", "5000"], ["DP", "00"]])}</div><p class="rule-note">Illustrative register layouts, not equivalent program states or a synchronized comparison. Full comparison views need meaningful points in each program’s computation.</p><div class="actions">${link("/workspace/6502/addition", "Review the 6502 workspace →", "button")}</div>`;
}

function about(design = false) {
  return `${crumbs([["/about", "About"], ...(design ? [["/about/design", "This prototype"]] : [])])}${heading(design ? "About / Design preview" : "About microcomputer.world", design ? "A first shape for the website." : "Understanding is the point.")}
    <div class="article-layout wide-text"><nav class="toc" aria-label="About navigation">${link("/about", "The project")}${link("/about/design", "This prototype")}<a href="https://github.com/jtauber/dromaios" target="_blank" rel="noopener noreferrer">dromaios source ↗</a></nav><article class="prose">${design ? `<h2>What to review</h2><p>This first pass connects the main page families: home, section indexes, subject overviews, lessons, a workspace, reference entries, a software chapter, and ordinary articles.</p><p>Its central question is whether a reader can move from an explanation to an experiment and back without losing their place.</p><h2>Two paths through it</h2><ul><li>${link("/learn/first-addition", "6502 lesson")} → workspace → instruction reference → return.</li><li>${link("/explore/software", "Software collection")} → Elite overview → chapter → concept inspector.</li></ul><h2>What is interactive</h2><p>The four-step 6502 example has prepared states for three arithmetic cases. Step, Run/Pause, Restart example, and navigation operate locally. The software inspector directly calculates a bit mask and square; it does not run the original routine.</p><h2>What remains open</h2><p>The palette and typography are provisional. We still need to review the balance of reading and inspection, smaller-screen behavior, and the amount of information initially visible.</p>` : `<h2>An invitation to look inside.</h2><p>microcomputer.world is a place to explore how computers work: follow an instruction, inspect state, understand a device, and connect the parts of a machine.</p><p>Detailed software guides will extend that exploration into substantial programs, linking architecture and line-by-line analysis to interactive demonstrations.</p><h2>The software: dromaios.</h2><p>microcomputer.world is the public website. Its lessons, exploration workspaces, and machine emulators are powered by <strong>dromaios</strong>, the underlying software platform.</p><h2>One set of models, many ways to learn.</h2><p>A small lesson and a complete computer should use the same underlying components. The interface can reveal the details needed for a particular question, while preserving the differences between architectures.</p><h2>The software’s name</h2><p>Emulator → emu → Dromaius → Greek <em>δρομαῖος</em>. The name dromaios is an emu pun with a Greek connection.</p><h2>Built through careful review.</h2><p>The dromaios software is developed in small steps with close human review. AI agents help write code and documentation; the maintainer directs the design and reviews changes. The source is available under the MIT license.</p><div class="actions">${link("/learn", "Find a starting point →", "button primary")}${link("/about/design", "About this prototype", "small")}</div>`}</article></div>`;
}

const routes = {
  "/": ["Home", "", home],
  "/learn": ["Learn", "learn", learn],
  "/learn/first-addition": ["One addition", "learn", lesson],
  "/explore": ["Explore", "explore", explore],
  "/explore/cpus": ["CPUs", "explore", cpus],
  "/cpus/6502": ["MOS 6502", "explore", cpu6502],
  "/explore/machines": ["Machines", "explore", machines],
  "/machines/bbc-micro": ["BBC Micro", "explore", bbcMicro],
  "/explore/software": ["Software", "explore", software],
  "/software/elite-a": ["Elite software study", "explore", elite],
  "/software/elite-a/squa": ["Before the square", "explore", chapter],
  "/explore/comparisons": ["Comparisons", "explore", comparisons],
  "/workspace/6502/addition": ["Addition workspace", "explore", workspace],
  "/reference": ["Reference", "reference", reference],
  "/reference/6502/adc": ["ADC reference", "reference", adc],
  "/reference/glossary": ["Glossary", "reference", glossary],
  "/about": ["About", "about", () => about(false)],
  "/about/design": ["About this prototype", "about", () => about(true)],
};

function stopRunning() {
  if (state.timer !== null) window.clearInterval(state.timer);
  state.timer = null;
}

function render() {
  const route = routes[currentPath];
  const focused = document.activeElement;
  const action = focused?.dataset?.action;
  const bit = focused?.dataset?.bit;
  const id = focused?.id;
  const y = window.scrollY;
  if (!route) {
    main.innerHTML = `${heading("Page not found", "That page is not in this prototype.")}${link("/", "Return home", "button")}`;
    return;
  }
  main.innerHTML = route[2]();
  document.title = `${route[0]} — microcomputer.world wireframes`;
  document.querySelectorAll("#main-nav a").forEach(anchor => {
    if (anchor.hash === `#/${route[1]}`) anchor.setAttribute("aria-current", "page");
    else anchor.removeAttribute("aria-current");
  });
  const replacement = id ? document.getElementById(id) : action ? main.querySelector(`[data-action="${action}"]`) : bit !== undefined ? main.querySelector(`[data-bit="${bit}"]`) : null;
  if (replacement && !replacement.disabled) replacement.focus({ preventScroll: true });
  window.scrollTo(0, y);
}

function navigate() {
  if (currentPath) scrollPositions.set(currentPath, window.scrollY);
  stopRunning();
  currentPath = location.hash.startsWith("#/") ? location.hash.slice(1) : "/";
  render();
  window.scrollTo(0, scrollPositions.get(currentPath) || 0);
  main.focus({ preventScroll: true });
}

document.addEventListener("click", (event) => {
  const skip = event.target.closest(".skip-link");
  if (skip) { event.preventDefault(); main.focus(); return; }
  const sectionButton = event.target.closest("[data-section]");
  if (sectionButton) { document.getElementById(sectionButton.dataset.section)?.scrollIntoView(); return; }
  const bitButton = event.target.closest("[data-bit]");
  if (bitButton) { state.softwareInput ^= 1 << Number(bitButton.dataset.bit); render(); return; }
  const control = event.target.closest("button[data-action]");
  if (!control) return;
  switch (control.dataset.action) {
    case "step": state.step = Math.min(4, state.step + 1); break;
    case "restart": stopRunning(); state.step = 0; break;
    case "run":
      if (state.timer !== null) stopRunning();
      else if (state.step < 4) {
        state.timer = window.setInterval(() => {
          state.step = Math.min(4, state.step + 1);
          if (state.step === 4) stopRunning();
          render();
        }, 850);
      }
      break;
    case "software-bits": state.softwareView = "bits"; break;
    case "software-values": state.softwareView = "values"; break;
    case "software-restart": state.softwareInput = 131; break;
    case "focus-mask":
      state.softwareView = "bits";
      render();
      document.getElementById("software-number")?.focus({ preventScroll: true });
      if (window.innerWidth < 821) main.querySelector(".inspector")?.scrollIntoView();
      return;
    default: return;
  }
  render();
});

document.addEventListener("change", (event) => {
  if (event.target.dataset.action === "scenario") {
    stopRunning();
    state.scenario = event.target.value;
    state.step = 0;
    render();
  }
  if (event.target.dataset.action === "software-value") {
    const value = Number(event.target.value);
    state.softwareInput = Number.isFinite(value) ? Math.max(0, Math.min(255, Math.round(value))) : 131;
    render();
  }
});
document.addEventListener("input", (event) => {
  const action = event.target.dataset.action;
  if (action === "software-range" || action === "software-value") {
    const value = Number(event.target.value);
    // Leave an empty or partially edited field alone; change validates it.
    if (event.target.value === "" || !Number.isInteger(value) || value < 0 || value > 255) return;
    state.softwareInput = value;
    render();
  }
});
window.addEventListener("hashchange", navigate);
window.addEventListener("pagehide", stopRunning);
navigate();
