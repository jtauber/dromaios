import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/** Drive the real laboratory controls in a disposable Chrome context; never expose a second execution path. */
async function connect(url: string) {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  socket.addEventListener("message", event => {
    const message = JSON.parse(String(event.data));
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  });
  socket.addEventListener("close", () => {
    for (const request of pending.values()) request.reject(new Error("Browser connection closed"));
    pending.clear();
  });
  return {
    call<T = unknown>(method: string, params: object = {}, sessionId?: string): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const id = ++sequence;
        pending.set(id, { resolve: value => resolve(value as T), reject });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
      });
    },
    close: () => socket.close(),
  };
}

const workloads = {
  "mystery-house": [["title", "G", "0800", "2,000,000"], ["yard", "GO STAIRS", "63DF", "224,100"]],
  "ultima-iv": [["ultima-iv-boot", "", "0800", "2,000,000"]],
} as const;
const [site, debugging, checkpoints, count = "3", workload = "mystery-house", ...extra] = process.argv.slice(2);
const repetitions = Number(count), romPath = process.env.APPLE2_ROM;
if (!site || !debugging || !checkpoints || !romPath || extra.length || !Number.isSafeInteger(repetitions) || repetitions < 1
  || (workload !== "mystery-house" && workload !== "ultima-iv")) {
  throw new Error("Set APPLE2_ROM; usage: node scripts/benchmark-apple2-laboratory.ts SITE-URL CHROME-DEBUG-URL CHECKPOINT-DIRECTORY [REPETITIONS] [mystery-house|ultima-iv]");
}
for (const url of [site, debugging]) {
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname), "Use local-only site and debugging servers");
}
const scenes = workloads[workload];
const fixtures = scenes.map(([name]) => {
  const saved = JSON.parse(readFileSync(join(checkpoints, `${name}.json`), "utf8"));
  assert.equal(saved.name, name, "The checkpoint name must match its workload scene");
  return saved;
});
const checkpointHashes = fixtures.map(saved => ({ name: saved.name,
  sha256: createHash("sha256").update(JSON.stringify(saved.state)).digest("hex") }));
const rom = { name: "apple2p.rom", base64: readFileSync(romPath).toString("base64") };
const version = await (await fetch(new URL("/json/version", debugging))).json() as { webSocketDebuggerUrl: string; Browser: string };
const browser = await connect(version.webSocketDebuggerUrl);
const { browserContextId } = await browser.call<{ browserContextId: string }>("Target.createBrowserContext");
try {
  const { targetId } = await browser.call<{ targetId: string }>("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await browser.call<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
  const call = <T = unknown>(method: string, params: object = {}) => browser.call<T>(method, params, sessionId);
  async function evaluate<T = unknown>(expression: string): Promise<T> {
    const response = await call<{ result: { value: T }; exceptionDetails?: object }>("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  }
  async function wait(expression: string): Promise<void> {
    const deadline = performance.now() + 120_000;
    while (!await evaluate<boolean>(expression)) {
      if (performance.now() > deadline) throw new Error(`Timed out: ${expression}`);
      await delay(50);
    }
  }
  await call("Page.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 1800, height: 1013, deviceScaleFactor: 1, mobile: false });
  await call("Page.navigate", { url: new URL("/", site).href });
  await wait(`location.origin === ${JSON.stringify(new URL(site).origin)} && document.readyState === 'complete'`);
  await evaluate(`localStorage.setItem('dromaios:apple2-rom:v1', ${JSON.stringify(JSON.stringify(rom))});
    for (const saved of ${JSON.stringify(fixtures)}) localStorage.setItem('dromaios:apple2-saved-state:' + saved.name, JSON.stringify(saved));`);
  const laboratory = new URL("/machines/apple-ii-plus/laboratory/", site).href;
  await call("Page.navigate", { url: laboratory });
  await wait(`document.querySelector('[data-machine-run]')?.disabled === false`);
  const results: { scene: string; mode: string; repeat: number; ms: number; status: string; pc: number; clocks: number; hash: string }[] = [];
  const expected = new Map<string, string>();
  for (let repeat = 0; repeat < repetitions; repeat++) {
    for (const [scene, command, target, instructions] of scenes) {
      for (const [mode, live, recording] of [["all-live", true, true], ["no-live", false, true], ["no-recording", false, false]] as const) {
        await evaluate(`localStorage.setItem('dromaios:inspectors:apple2:live', JSON.stringify(Object.fromEntries(
          [...document.querySelectorAll('[data-panel-live]')].map(panel => [panel.dataset.workspacePanel, ${live}]))));`);
        // A fresh document warms up in the same way for every sample and applies preferences to hidden tabs too.
        await call("Page.navigate", { url: "about:blank" });
        await call("Page.navigate", { url: laboratory });
        await wait(`document.querySelector('[data-machine-run]')?.disabled === false`);
        await evaluate(`document.querySelector('[data-state-choice]').value = '${scene}'; document.querySelector('[data-state-restore]').click();`);
        await wait(`document.querySelector('[data-state-status]').textContent.startsWith('Restored') && !document.querySelector('[data-state-restore]').disabled`);
        await evaluate(`for (const selector of ['[data-log-recording]', '[data-disk-record]', '[data-basic-events-record]']) {
          const box = document.querySelector(selector); box.checked = ${recording}; box.dispatchEvent(new Event('change'));
        }
        document.querySelector('[data-machine-speed="unlimited"]').click();
        for (const key of ${JSON.stringify(command ? [...command, "Enter"] : [])}) document.querySelector('[data-apple2-screen]').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        document.querySelector('[data-disassembly-address]').value = '${target}';
        window.benchmarkStart = performance.now(); window.benchmarkEnd = null;
        const pause = document.querySelector('[data-machine-pause]');
        const observer = new MutationObserver(() => {
          if (pause.disabled) { window.benchmarkEnd = performance.now(); observer.disconnect(); }
        });
        observer.observe(pause, { attributes: true, attributeFilter: ['disabled'] });
        document.querySelector('[data-disassembly-run]').click();`);
        await wait("window.benchmarkEnd !== null");
        const timing = await evaluate<{ ms: number; status: string }>(`({ ms: window.benchmarkEnd - window.benchmarkStart, status: document.querySelector('[data-machine-status]').textContent })`);
        assert.ok(timing.status.includes(`${instructions} instructions`), timing.status);
        await evaluate(`document.querySelector('[data-state-name]').value = 'result'; document.querySelector('[data-state-form]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));`);
        await wait(`localStorage.getItem('dromaios:apple2-saved-state:result') !== null`);
        const saved = JSON.parse(await evaluate<string>(`localStorage.getItem('dromaios:apple2-saved-state:result')`));
        const hash = createHash("sha256").update(JSON.stringify(saved.state)).digest("hex");
        if (expected.has(scene)) assert.equal(hash, expected.get(scene), "Observers must not change hardware or input state");
        else expected.set(scene, hash);
        const row = { scene, mode, repeat, ...timing, pc: saved.state.hardware.cpu.pc, clocks: saved.state.hardware.clock.ticks, hash }; results.push(row);
        console.error(`${scene} / ${mode}: ${timing.ms.toFixed(1)} ms`);
        await evaluate(`localStorage.removeItem('dromaios:apple2-saved-state:result')`);
      }
    }
  }
  console.log(JSON.stringify({ workload, browser: version.Browser, viewport: "1800 × 1013", checkpointHashes, repetitions, results }, null, 2));
} finally {
  await browser.call("Target.disposeBrowserContext", { browserContextId });
  browser.close();
}
