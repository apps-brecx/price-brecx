/**
 * Cooperative cancellation for the Lost Buy Box scan. Ported from the
 * Missed-Buy-Box app's in-memory `activeRuns` map: a scan registers a control
 * handle keyed by workspace, the cancel endpoint flips `cancel = true`, and the
 * scan loop checks it between batches and bails out.
 *
 * In-process only (matches the source app + this codebase's single-instance
 * pg-boss + websocket model — the API process runs the workers itself).
 */
export interface RunCtl {
  cancel: boolean;
}

const active = new Map<string, RunCtl>();

/** Register a run for a workspace, cancelling any prior run still going. */
export function beginScan(workspaceId: string): RunCtl {
  const prev = active.get(workspaceId);
  if (prev) prev.cancel = true;
  const ctl: RunCtl = { cancel: false };
  active.set(workspaceId, ctl);
  return ctl;
}

/** Deregister a run (only if it's still the current one for the workspace). */
export function endScan(workspaceId: string, ctl: RunCtl): void {
  if (active.get(workspaceId) === ctl) active.delete(workspaceId);
}

/** Request cancellation of a workspace's active scan. Returns false if none. */
export function requestCancel(workspaceId: string): boolean {
  const ctl = active.get(workspaceId);
  if (!ctl) return false;
  ctl.cancel = true;
  return true;
}

/** Thrown by the scan when a cancel was requested — handled, not an error. */
export class ScanCancelledError extends Error {
  constructor() {
    super("Scan cancelled by user.");
    this.name = "ScanCancelledError";
  }
}
