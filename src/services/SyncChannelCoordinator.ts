import type { SyncChannel } from '@/types/settings';

export interface SyncChannelRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export class SyncChannelCoordinator {
  private activeChannel: SyncChannel | null = null;
  private selectionQueue: Promise<void> = Promise.resolve();

  constructor(private readonly p2p: SyncChannelRuntime, private readonly lan: SyncChannelRuntime) {}

  getActiveChannel(): SyncChannel | null {
    return this.activeChannel;
  }

  select(channel: SyncChannel): Promise<void> {
    const selection = this.selectionQueue.then(() => this.applySelection(channel));
    this.selectionQueue = selection.catch(() => undefined);
    return selection;
  }

  private async applySelection(channel: SyncChannel): Promise<void> {
    if (this.activeChannel === channel) {
      await this.runtime(channel).start();
      return;
    }

    if (this.activeChannel) {
      await this.runtime(this.activeChannel).stop();
      this.activeChannel = null;
    }

    await this.runtime(channel).start();
    this.activeChannel = channel;
  }

  private runtime(channel: SyncChannel): SyncChannelRuntime {
    return channel === 'p2p' ? this.p2p : this.lan;
  }
}
