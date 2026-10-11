import {
  createDefaultClipboardItem,
  HistorySyncStatus,
  type ClipboardContent,
  type ClipboardItem,
} from '@/types/clipboard';
import type { ApplyLanRemoteContentInput } from './lanSyncAdapter';
import { contentAlias, traceLan } from './lanSyncTrace';

export interface LanRemoteContentApplierDependencies {
  pauseClipboardMonitoring(): void;
  resumeClipboardMonitoring(): void;
  setClipboardContent(content: ClipboardContent): Promise<void>;
  readClipboardContent(): Promise<ClipboardContent | null>;
  setClipboardWatermark(content: ClipboardContent): Promise<void>;
  noteApplied(hash: string | null): void;
  clearActivate(): Promise<void>;
  addHistoryItem(item: ClipboardItem): Promise<ClipboardItem>;
  setCurrentContentDisplay(content: ClipboardContent): void;
  readTextFile(uri: string): Promise<string>;
}

export class LanRemoteContentApplier {
  constructor(private readonly dependencies: LanRemoteContentApplierDependencies) {}

  async apply(input: ApplyLanRemoteContentInput): Promise<void> {
    const timestamp = Date.now();
    const clipboardText =
      input.type === 'Text' && input.hasData
        ? await this.dependencies.readTextFile(this.requiredFileUri(input))
        : input.text;
    const content: ClipboardContent = {
      type: input.type,
      text: clipboardText,
      profileHash: input.profileHash,
      localClipboardHash: input.profileHash,
      fileSize: input.size,
      hasData: input.hasData,
      timestamp,
      ...(input.dataName ? { fileName: input.dataName } : {}),
      ...(input.fileUri ? { fileUri: input.fileUri } : {}),
    };

    const cid = contentAlias(input.contentId ?? input.profileHash);
    if (input.type !== 'File') {
      await this.applyToClipboard(content, input.profileHash);
      traceLan('clipboard_applied', { cid });
    }

    const saved = await this.dependencies.addHistoryItem(
      createDefaultClipboardItem({
        type: input.type,
        text: input.text,
        profileHash: input.profileHash,
        localClipboardHash: input.profileHash,
        hasData: input.hasData,
        dataName: input.dataName,
        size: input.size,
        timestamp,
        syncStatus: HistorySyncStatus.Synced,
        fileUri: input.fileUri,
        from: 'server',
        contentId: input.contentId,
      })
    );
    traceLan('history_saved', { cid });
    this.dependencies.setCurrentContentDisplay({
      type: saved.type,
      text: input.type === 'Text' && !input.hasData ? clipboardText : saved.text,
      profileHash: saved.profileHash,
      localClipboardHash: saved.localClipboardHash,
      fileSize: saved.size,
      hasData: saved.hasData,
      timestamp: saved.timestamp,
      ...(saved.dataName ? { fileName: saved.dataName } : {}),
      ...(saved.fileUri ? { fileUri: saved.fileUri } : {}),
    });
  }

  private async applyToClipboard(content: ClipboardContent, profileHash: string): Promise<void> {
    this.dependencies.pauseClipboardMonitoring();
    try {
      await this.dependencies.setClipboardContent(content);
      let watermark = content;
      if (content.type === 'Image') {
        const observed = await this.dependencies.readClipboardContent().catch(() => null);
        if (observed?.type === 'Image' && observed.localClipboardHash) {
          watermark = { ...content, localClipboardHash: observed.localClipboardHash };
        }
      }
      await this.dependencies.setClipboardWatermark(watermark);
      this.dependencies.noteApplied(profileHash);
      await this.dependencies.clearActivate();
    } finally {
      this.dependencies.resumeClipboardMonitoring();
    }
  }

  private requiredFileUri(input: ApplyLanRemoteContentInput): string {
    if (!input.fileUri) throw new Error('LAN text payload is missing its local file');
    return input.fileUri;
  }
}
