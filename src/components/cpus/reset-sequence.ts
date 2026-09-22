/** Complete reset after success or a modeled fault; host exceptions retain only earlier effects. */
export function resetSequence<ReturnedFault, ThrownFault>(
  attempt: () => ReturnedFault | void,
  complete: (failed: boolean) => void,
  faultFromError: (error: unknown) => ThrownFault | undefined,
): ReturnedFault | ThrownFault | void {
  let fault: ReturnedFault | ThrownFault | void;
  try {
    fault = attempt();
  } catch (error) {
    fault = faultFromError(error);
    if (fault === undefined) throw error;
  }
  complete(fault !== undefined);
  return fault;
}
