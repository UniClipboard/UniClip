import type { SyncChannel } from '@/types/settings';

export interface SyncChannelRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export class SyncChannelCoordinator {
  private activeChannel: SyncChannel | null = null;

  constructor(private readonly p2p: SyncChannelRuntime, private readonly lan: SyncChannelRuntime) {}

  getActiveChannel(): SyncChannel | null {
    return this.activeChannel;
  }

  async select(channel: SyncChannel): Promise<void> {
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
