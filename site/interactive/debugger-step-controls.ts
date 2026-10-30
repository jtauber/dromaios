/** Step over/out share controls and availability; machines supply execution and observations. */
export function createDebuggerStepControls(root: HTMLElement, actions: {
  readonly over: () => void; readonly out: () => void;
  readonly run: () => void; readonly error: (message: string) => void;
}) {
  const over = root.querySelector<HTMLButtonElement>("[data-machine-over]"), out = root.querySelector<HTMLButtonElement>("[data-machine-out]");
  for (const [button, action] of [[over, actions.over], [out, actions.out]] as const) button?.addEventListener("click", () => {
    try { action(); actions.run(); } catch (cause) { actions.error((cause as Error).message); }
  });
  return (disabled: boolean, canStepOut: boolean): void => {
    if (over) over.disabled = disabled;
    if (out) {
      out.disabled = disabled || !canStepOut;
      out.title = canStepOut ? "Run until the observed call returns" : "No observed caller. Step into a call first.";
    }
  };
}
