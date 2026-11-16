import type { XtIo } from "../../src/machines/8088/pc-xt/io.js";
import { xtHex as hex } from "./8088-disassembly.js";
import { memoryLink } from "./memory-link.js";

/** Controller state is detached; no port reads, acknowledgements or media copies. */
export function createXtDmaView(root: HTMLElement, browse: (address: number) => void) {
  const at = (name: string) => root.querySelector<HTMLElement>(`[data-${name}]`)!;
  const ram = (address: number) => memoryLink(address, () => browse(address), `$${hex(address, 5)}`);
  return {
    refresh({ dma, page, diskette: fdc, status, dreq, irq }: ReturnType<XtIo["disketteState"]>): void {
      const mode = dma.mode[2]!, address = page * 0x10000 + dma.address[2]!, base = page * 0x10000 + dma.base_address[2]!;
      const direction = mode & 8 ? "RAM → disk (DMA read)" : mode & 4 ? "disk → RAM (DMA write)" : "Verify / unconfigured";
      at("dma-address").replaceChildren("Next RAM ", ram(address), " · base ", ram(base), ` · page $${hex(page, 2)}`);
      at("dma-count").textContent = `Count $${hex(dma.count[2]!, 4)} · base ${dma.base_count[2]! + 1} bytes · mode $${hex(mode, 2)} · ${direction}`;
      at("dma-signals").textContent = `DREQ2 ${+dreq} · masked ${+Boolean(dma.mask & 4)} · terminal count ${+Boolean(dma.terminal & 4)}`
        + ` · controller disabled ${+Boolean(dma.command & 4)} · next register byte ${dma.high_byte ? "high" : "low"}`;
      const phases = ["Idle", "Receiving command", "Result", "Searching for sector", "Transferring data"];
      at("fdc-command").textContent = `${phases[fdc.phase]} · command $${hex(fdc.command, 2)} · MSR $${hex(status, 2)} · DOR $${hex(fdc.dor, 2)}`;
      const [select, c, h, r, n] = fdc.parameters;
      at("fdc-position").textContent = `Physical cylinder ${fdc.cylinder} · command C/H/R/N ${c}/${h}/${r}/${n} · byte ${fdc.byte_offset}/512`
        + ` · next byte in ${fdc.byte_us} µs`;
      at("fdc-signals").textContent = `Media ${fdc.media ? (fdc.writable ? "writable" : "read-only") : "absent"} · motor ${fdc.dor & 16 ? "on" : "off"}`
        + ` · head ${select! >> 2 & 1} · seek ${fdc.seek_busy ? "busy" : "idle"} · IRQ6 ${+irq} · parameters ${fdc.received}/${fdc.expected}`;
      at("fdc-result").textContent = fdc.result_left
        ? `Unread result: ${fdc.results.slice(fdc.result_index, fdc.result_index + fdc.result_left).map(byte => hex(byte, 2)).join(" ")}`
        : "No unread result bytes.";
    },
  };
}
