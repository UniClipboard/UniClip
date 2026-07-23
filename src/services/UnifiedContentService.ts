import type { SendReport } from 'uc-engine';
import type { ClipboardContent } from '@/types/clipboard';
import type { SyncChannel } from '@/types/settings';

export interface UnifiedContentApi {
  sendText(text: string, targetDevices: string[]): Promise<SendReport>;
  sendImage(bytes: Uint8Array, mimeType: string, targetDevices: string[]): Promise<SendReport>;
  registerInputFile(uri: string): string;
  sendFiles(fileHandles: string[], targetDevices: string[]): Promise<SendReport>;
  releaseFileHandle(handle: string): void;
}

export interface ImportedContentAsset {
  kind: 'image' | 'file';
  uri: string;
  mimeType?: string | null;
}

interface LanUploadResult {
  success: boolean;
  error?: string;
}

export interface UnifiedContentDependencies {
  getChannel(): SyncChannel;
  readClipboard(): Promise<ClipboardContent | null>;
  readFileBytes(uri: string): Promise<Uint8Array>;
  p2p: UnifiedContentApi;
  uploadLanClipboard(): Promise<LanUploadResult>;
  enqueueLanUpload(profileHash: string): void;
}

export type UnifiedContentResult =
  | { channel: 'p2p'; success: true; entryId: string }
  | { channel: 'lan'; success: boolean; error?: string };

export type UnifiedContentErrorCode =
  | 'clipboardEmpty'
  | 'clipboardUnsupported'
  | 'fileUnavailable'
  | 'imageTypeUnknown';

export class UnifiedContentError extends Error {
  constructor(readonly code: UnifiedContentErrorCode, message: string) {
    super(message);
    this.name = 'UnifiedContentError';
  }
}

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  bmp: 'image/bmp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

function imageMimeType(uri: string, supplied?: string | null): string {
  const path = uri.split(/[?#]/, 1)[0].toLowerCase();
  const extension = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1) : '';
  const inferred = IMAGE_MIME_BY_EXTENSION[extension];
  if (inferred) return inferred;
  if (supplied?.startsWith('image/') && supplied !== 'image/*') return supplied;
  throw new UnifiedContentError('imageTypeUnknown', 'Unable to determine the image media type');
}

export class UnifiedContentService {
  constructor(private readonly deps: UnifiedContentDependencies) {}

  async sendCurrentClipboard(): Promise<UnifiedContentResult> {
    if (this.deps.getChannel() === 'lan') {
      const result = await this.deps.uploadLanClipboard();
      return { channel: 'lan', success: result.success, error: result.error };
    }

    const content = await this.deps.readClipboard();
    if (!content) {
      throw new UnifiedContentError('clipboardEmpty', 'The clipboard is empty');
    }

    switch (content.type) {
      case 'Text': {
        let text = content.text ?? '';
        if (content.hasData && content.fileUri) {
          text = new TextDecoder().decode(await this.deps.readFileBytes(content.fileUri));
        }
        if (!text) {
          throw new UnifiedContentError('clipboardEmpty', 'The clipboard is empty');
        }
        return this.p2pResult(await this.deps.p2p.sendText(text, []));
      }
      case 'Image': {
        if (!content.fileUri) {
          throw new UnifiedContentError('fileUnavailable', 'The clipboard image is unavailable');
        }
        const bytes = await this.deps.readFileBytes(content.fileUri);
        const mimeType = imageMimeType(content.fileUri, undefined);
        return this.p2pResult(await this.deps.p2p.sendImage(bytes, mimeType, []));
      }
      case 'File':
        if (!content.fileUri) {
          throw new UnifiedContentError('fileUnavailable', 'The clipboard file is unavailable');
        }
        return this.sendP2pFile(content.fileUri);
      default:
        throw new UnifiedContentError(
          'clipboardUnsupported',
          `Unsupported clipboard content: ${content.type}`
        );
    }
  }

  async sendImportedAsset(
    asset: ImportedContentAsset,
    profileHash: string
  ): Promise<UnifiedContentResult> {
    if (this.deps.getChannel() === 'lan') {
      this.deps.enqueueLanUpload(profileHash);
      return { channel: 'lan', success: true };
    }

    if (asset.kind === 'image') {
      const bytes = await this.deps.readFileBytes(asset.uri);
      const report = await this.deps.p2p.sendImage(
        bytes,
        imageMimeType(asset.uri, asset.mimeType),
        []
      );
      return this.p2pResult(report);
    }

    return this.sendP2pFile(asset.uri);
  }

  private async sendP2pFile(uri: string): Promise<UnifiedContentResult> {
    const handle = this.deps.p2p.registerInputFile(uri);
    try {
      return this.p2pResult(await this.deps.p2p.sendFiles([handle], []));
    } finally {
      this.deps.p2p.releaseFileHandle(handle);
    }
  }

  private p2pResult(report: SendReport): UnifiedContentResult {
    return { channel: 'p2p', success: true, entryId: report.entryId };
  }
}

function createDefaultDependencies(): UnifiedContentDependencies {
  const p2p: UnifiedContentApi = {
    sendText: (text, targetDevices) => require('uc-engine').sendText(text, targetDevices),
    sendImage: (bytes, mimeType, targetDevices) =>
      require('uc-engine').sendImage(bytes, mimeType, targetDevices),
    registerInputFile: (uri) => require('uc-engine').registerInputFile(uri),
    sendFiles: (fileHandles, targetDevices) =>
      require('uc-engine').sendFiles(fileHandles, targetDevices),
    releaseFileHandle: (handle) => require('uc-engine').releaseFileHandle(handle),
  };

  return {
    getChannel: () =>
      require('@/stores/settingsStore').useSettingsStore.getState().config?.syncChannel ?? 'lan',
    readClipboard: () => require('./ClipboardManager').clipboardManager.getClipboardContent(),
    readFileBytes: async (uri) => {
      const { File } = require('expo-file-system');
      return new File(uri).bytes();
    },
    p2p,
    uploadLanClipboard: () =>
      require('./ClipboardSyncService').getClipboardSyncService().triggerUpload(),
    enqueueLanUpload: (profileHash) =>
      require('./BackgroundUploadManager').BackgroundUploadManager.enqueue(profileHash),
  };
}

let instance: UnifiedContentService | null = null;

export function getUnifiedContentService(): UnifiedContentService {
  if (!instance) instance = new UnifiedContentService(createDefaultDependencies());
  return instance;
}
