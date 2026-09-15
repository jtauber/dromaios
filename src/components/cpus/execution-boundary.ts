/** Protect a CPU transition from nested mutations through external callbacks. */
export function executionBoundary(message: string): <Result>(action: () => Result) => Result {
  let active = false;
  return action => {
    if (active) throw new Error(message);
    active = true;
    try {
      return action();
    } finally {
      active = false;
    }
  };
}
