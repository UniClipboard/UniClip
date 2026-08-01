import type { SendReport } from 'uc-engine';
import type { ClipboardContent } from '@/types/clipboard';
import type { P2pDeliveryState } from '@/types/clipboard';
import { p2pDeliveryStateFromReport } from './P2pDeliveryState';
import type { OutboundDeliveryOutcome } from './OutboundDeliveryCoordinator';

export interface UnifiedContentApi {
  sendText(text: string, targetDevices: string[]): Promise<SendReport>;
  sendImage(bytes: Uint8Array, mimeType: string, targetDevices: string[]): Promise<SendReport>;
  registerInputFile(uri: string, displayName?: string): string;
  sendFiles(fileHandles: string[], targetDevices: string[]): Promise<SendReport>;
  releaseFileHandle(handle: string): void;
}

export interface ImportedContentAsset {
  kind: 'image' | 'file';
  uri: string;
  fileName?: string;
  mimeType?: string | null;
}

export interface UnifiedContentDependencies {
  readClipboard(): Promise<ClipboardContent | null>;
  readFileBytes(uri: string): Promise<Uint8Array>;
  p2p: UnifiedContentApi;
  completeOutboundDelivery(send: () => Promise<SendReport>): Promise<OutboundDeliveryOutcome>;
}

export interface ImportedAssetSendOptions {
  targetDeviceIds?: string[];
}

export interface UnifiedContentResult {
  channel: 'p2p';
  success: boolean;
  entryId: string;
  profileHash: string | undefined;
  deliveryState: P2pDeliveryState;
  report: SendReport;
}

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
const MAX_INLINE_IMAGE_BYTES = 64 * 1024;

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

  async sendImportedText(text: string, profileHash: string): Promise<UnifiedContentResult> {
    return this.p2pResult(await this.deps.p2p.sendText(text, []), profileHash);
  }

  async sendCurrentClipboard(): Promise<UnifiedContentResult> {
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
        return this.p2pResult(await this.deps.p2p.sendText(text, []), content.profileHash);
      }
      case 'Image': {
        if (!content.fileUri) {
          throw new UnifiedContentError('fileUnavailable', 'The clipboard image is unavailable');
        }
        const bytes = await this.deps.readFileBytes(content.fileUri);
        const mimeType = imageMimeType(content.fileUri, undefined);
        return this.sendP2pImage(bytes, mimeType, content.profileHash);
      }
      case 'File':
        if (!content.fileUri) {
          throw new UnifiedContentError('fileUnavailable', 'The clipboard file is unavailable');
        }
        return this.sendP2pFile(content.fileUri, content.profileHash, content.fileName);
      default:
        throw new UnifiedContentError(
          'clipboardUnsupported',
          `Unsupported clipboard content: ${content.type}`
        );
    }
  }

  async sendImportedAsset(
    asset: ImportedContentAsset,
    profileHash: string,
    options?: ImportedAssetSendOptions
  ): Promise<UnifiedContentResult> {
    if (asset.kind === 'image') {
      const bytes = await this.deps.readFileBytes(asset.uri);
      return this.sendP2pImage(
        bytes,
        imageMimeType(asset.uri, asset.mimeType),
        profileHash,
        options?.targetDeviceIds ?? []
      );
    }

    return this.sendP2pFile(asset.uri, profileHash, asset.fileName, options?.targetDeviceIds ?? []);
  }

  private async sendP2pImage(
    bytes: Uint8Array,
    mimeType: string,
    profileHash?: string,
    targetDeviceIds: string[] = []
  ): Promise<UnifiedContentResult> {
    const send = () => this.deps.p2p.sendImage(bytes, mimeType, targetDeviceIds);
    if (bytes.byteLength <= MAX_INLINE_IMAGE_BYTES) {
      return this.p2pResult(await send(), profileHash);
    }
    const outcome = await this.deps.completeOutboundDelivery(send);
    return this.p2pResult(reportAfterOutboundDelivery(outcome), profileHash);
  }

  private async sendP2pFile(
    uri: string,
    profileHash?: string,
    displayName?: string,
    targetDeviceIds: string[] = []
  ): Promise<UnifiedContentResult> {
    const handle = this.deps.p2p.registerInputFile(uri, displayName);
    try {
      const outcome = await this.deps.completeOutboundDelivery(() =>
        this.deps.p2p.sendFiles([handle], targetDeviceIds)
      );
      return this.p2pResult(reportAfterOutboundDelivery(outcome), profileHash);
    } finally {
      this.deps.p2p.releaseFileHandle(handle);
    }
  }

  private p2pResult(report: SendReport, profileHash?: string): UnifiedContentResult {
    const deliveryState = p2pDeliveryStateFromReport(report);
    return {
      channel: 'p2p',
      success: deliveryState === 'delivered' || deliveryState === 'partial',
      entryId: report.entryId,
      profileHash,
      deliveryState,
      report,
    };
  }
}

function reportAfterOutboundDelivery(outcome: OutboundDeliveryOutcome): SendReport {
  return {
    ...outcome.report,
    totalAccepted: outcome.completed,
    totalErrored: outcome.report.totalErrored + outcome.failed + outcome.cancelled,
    totalPending: outcome.pending,
  };
}

function createDefaultDependencies(): UnifiedContentDependencies {
  const p2p: UnifiedContentApi = {
    sendText: (text, targetDevices) => require('uc-engine').sendText(text, targetDevices),
    sendImage: (bytes, mimeType, targetDevices) =>
      require('uc-engine').sendImage(bytes, mimeType, targetDevices),
    registerInputFile: (uri, displayName) =>
      require('uc-engine').registerInputFile(uri, displayName),
    sendFiles: (fileHandles, targetDevices) =>
      require('uc-engine').sendFiles(fileHandles, targetDevices),
    releaseFileHandle: (handle) => require('uc-engine').releaseFileHandle(handle),
  };

  return {
    readClipboard: () => require('./ClipboardManager').clipboardManager.getClipboardContent(),
    readFileBytes: async (uri) => {
      const { File } = require('expo-file-system');
      return new File(uri).bytes();
    },
    p2p,
    completeOutboundDelivery: (send) =>
      require('./OutboundDeliveryCoordinator').getOutboundDeliveryCoordinator().run(send),
  };
}

let instance: UnifiedContentService | null = null;

export function getUnifiedContentService(): UnifiedContentService {
  if (!instance) instance = new UnifiedContentService(createDefaultDependencies());
  return instance;
}
