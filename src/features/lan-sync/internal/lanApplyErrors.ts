/**
 * The remote content is on the clipboard but its history record was not saved. The next pull
 * retries only the history record; the clipboard is not written again.
 */
export class LanHistorySaveError extends Error {
  constructor(readonly cause: unknown) {
    super('LAN content was applied but its history record was not saved');
    this.name = 'LanHistorySaveError';
  }
}
