import { completeHostSuspension, subscribeHostSuspension } from 'uc-engine';

import { createLogger } from '@/support/observability';

import { resumeDatabase, suspendDatabase } from './sqliteDatabase';

const log = createLogger('DB');

/**
 * Closes the App Group history database before iOS may suspend the process.
 * The native background task stays open until `completeHostSuspension`, so this
 * JS work runs inside granted background time, never after the process froze.
 */
export function startDatabaseSuspension(): () => void {
  return subscribeHostSuspension(({ phase, transitionId }) => {
    if (phase === 'resume') {
      resumeDatabase();
      return;
    }
    void suspendDatabase()
      .catch((error: unknown) => {
        log.error('closing the database for suspension failed:', error);
        return false;
      })
      .then((released) => completeHostSuspension(transitionId, released))
      .catch((error: unknown) => log.error('reporting database suspension failed:', error));
  });
}
