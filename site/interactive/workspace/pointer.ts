export interface PointerPosition { readonly x: number; readonly y: number }

/** One cancellable gesture. Nothing is committed until pointer-up; Escape restores the preview. */
export function dragPointer(event: PointerEvent, callbacks: {
  move(position: PointerPosition): void;
  finish(position: PointerPosition): void;
  cancel(): void;
}): () => void {
  if (event.button !== 0 || !event.isPrimary) return () => {};
  const start = { x: event.clientX, y: event.clientY }, controller = new AbortController();
  let dragging = false, finished = false;
  const options = { capture: true, signal: controller.signal };
  function cleanup(): void {
    finished = true;
    controller.abort(); document.body.classList.remove("workspace-dragging");
    if (dragging) {
      // Suppress the synthetic click following this drag, without suppressing ordinary tab clicks.
      const stop = (event: MouseEvent) => { event.preventDefault(); event.stopImmediatePropagation(); };
      document.addEventListener("click", stop, { capture: true, once: true });
      window.setTimeout(() => document.removeEventListener("click", stop, true), 0);
    }
  }
  function cancel(): void { if (!finished) { cleanup(); if (dragging) callbacks.cancel(); } }
  document.addEventListener("pointermove", next => {
    if (next.pointerId !== event.pointerId) return;
    const position = { x: next.clientX, y: next.clientY };
    if (!dragging && Math.hypot(position.x - start.x, position.y - start.y) < 5) return;
    dragging = true; document.body.classList.add("workspace-dragging"); next.preventDefault();
    callbacks.move(position);
  }, options);
  document.addEventListener("pointerup", next => {
    if (next.pointerId !== event.pointerId) return;
    cleanup(); if (dragging) callbacks.finish({ x: next.clientX, y: next.clientY });
  }, options);
  document.addEventListener("pointercancel", cancel, options);
  document.addEventListener("keydown", next => {
    if (next.key === "Escape") { next.preventDefault(); next.stopImmediatePropagation(); cancel(); }
  }, options);
  window.addEventListener("blur", cancel, { signal: controller.signal });
  return cancel;
}
