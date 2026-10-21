/** Only iOS suspends the process with App Group files under audit; elsewhere nothing to do. */
export function startDatabaseSuspension(): () => void {
  return () => {};
}
