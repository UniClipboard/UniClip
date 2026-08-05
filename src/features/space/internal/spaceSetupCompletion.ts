import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { createLogger } from '@/support/observability';

const log = createLogger('SpaceSetupCompletion');
const SPACE_SETUP_COMPLETION_KEY = '@syncclipboard:space:setup-completed';

export type SpaceSetupCompletionStatus = 'unknown' | 'complete' | 'incomplete';

export interface SpaceSetupCompletionReporter {
  resolveFromCore(completed: boolean): Promise<void>;
  markComplete(): Promise<void>;
  markIncomplete(): Promise<void>;
}

interface CompletionStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

interface SpaceSetupCompletionSnapshot {
  status: SpaceSetupCompletionStatus;
}

export const useSpaceSetupCompletionStore = create<SpaceSetupCompletionSnapshot>(() => ({
  status: 'unknown',
}));

function publishSpaceSetupCompletion(status: SpaceSetupCompletionStatus): void {
  useSpaceSetupCompletionStore.setState({ status }, true);
}

export class SpaceSetupCompletionState implements SpaceSetupCompletionReporter {
  private status: SpaceSetupCompletionStatus = 'unknown';
  private loadPromise: Promise<SpaceSetupCompletionStatus> | null = null;
  private loaded = false;
  private pendingValue: string | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: CompletionStorage = AsyncStorage,
    private readonly publish: (
      status: SpaceSetupCompletionStatus
    ) => void = publishSpaceSetupCompletion
  ) {}

  load(): Promise<SpaceSetupCompletionStatus> {
    if (this.loaded) return Promise.resolve(this.status);
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = this.storage
      .getItem(SPACE_SETUP_COMPLETION_KEY)
      .then((value) => {
        if (!this.loaded && value === '1') this.status = 'complete';
        if (!this.loaded && value === '0') this.status = 'incomplete';
        return this.status;
      })
      .catch((error) => {
        log.error('Failed to load Space setup completion:', error);
        return this.status;
      })
      .finally(() => {
        this.loaded = true;
        this.loadPromise = null;
        this.publish(this.status);
      });

    return this.loadPromise;
  }

  async resolveFromCore(completed: boolean): Promise<void> {
    await this.load();
    if (completed) {
      if (this.status !== 'complete') await this.setStatus('complete');
      return;
    }
    if (this.status === 'unknown') await this.setStatus('incomplete');
  }

  markComplete(): Promise<void> {
    return this.setStatus('complete');
  }

  markIncomplete(): Promise<void> {
    return this.setStatus('incomplete');
  }

  async retryPendingWrite(): Promise<void> {
    if (!this.pendingValue) return;
    await this.persist(this.pendingValue);
  }

  private async setStatus(status: Exclude<SpaceSetupCompletionStatus, 'unknown'>): Promise<void> {
    this.loaded = true;
    this.status = status;
    this.publish(status);
    await this.persist(status === 'complete' ? '1' : '0');
  }

  private persist(value: string): Promise<void> {
    this.pendingValue = value;
    const write = this.writeQueue.then(async () => {
      try {
        await this.storage.setItem(SPACE_SETUP_COMPLETION_KEY, value);
        if (this.pendingValue === value) this.pendingValue = null;
      } catch (error) {
        log.error('Failed to persist Space setup completion:', error);
        if (this.pendingValue !== value) return;
        try {
          await this.storage.setItem(SPACE_SETUP_COMPLETION_KEY, value);
          if (this.pendingValue === value) this.pendingValue = null;
        } catch (retryError) {
          log.error('Failed to retry Space setup completion persistence:', retryError);
        }
      }
    });
    this.writeQueue = write.catch(() => undefined);
    return write;
  }
}

const sharedSpaceSetupCompletion = new SpaceSetupCompletionState();

export function getSpaceSetupCompletion(): SpaceSetupCompletionState {
  return sharedSpaceSetupCompletion;
}
