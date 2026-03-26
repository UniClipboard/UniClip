import { Platform } from 'react-native';
import { requireNativeModule, type EventSubscription } from 'expo-modules-core';

export interface HashProgressEvent {
  progress: number;
  bytesRead: number;
  totalBytes: number;
}

export interface UploadProgressEvent {
  jobId: string;
  progress: number;
  bytesWritten: number;
  totalBytes: number;
}

export interface DownloadProgressEvent {
  jobId: string;
  progress: number;
  bytesRead: number;
  totalBytes: number;
}

export interface ProgressInfo {
  progress: number;
  bytesTransferred: number;
  totalBytes: number;
}

export interface NativeUtilModuleType {
  startCalculateFileHash(fileUri: string): string;
  waitForJob(jobId: string): Promise<string>;
  cancelJob(jobId: string): Promise<void>;
  copyFile(srcUri: string, destUri: string): Promise<void>;
  startUploadFile(url: string, headers: Record<string, string>, fileUri: string): string;
  startDownloadFile(url: string, headers: Record<string, string>, fileUri: string): string;
  startUploadMultipart(
    url: string,
    headers: Record<string, string>,
    formFields: Record<string, string>,
    fileUri: string | null
  ): string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addListener(eventName: string, listener: (event: any) => void): EventSubscription;
}

const NativeUtilModule: NativeUtilModuleType = requireNativeModule('NativeUtilModule');

export const isNativeModuleAvailable = Platform.OS === 'android';
export const isNativeHashModuleAvailable = Platform.OS === 'android';

export async function nativeCopyFile(srcUri: string, destUri: string): Promise<void> {
  if (Platform.OS !== 'android') {
    throw new Error('NativeUtilModule is not available on this platform');
  }
  await NativeUtilModule.copyFile(srcUri, destUri);
}

export async function nativeCalculateFileHash(
  fileUri: string,
  signal?: AbortSignal,
  onProgress?: (progress: number) => void
): Promise<string> {
  if (Platform.OS !== 'android') {
    throw new Error('NativeUtilModule is not available on this platform');
  }

  let progressSub: EventSubscription | null = null;
  if (onProgress) {
    progressSub = NativeUtilModule.addListener('onHashProgress', (event: HashProgressEvent) => {
      onProgress(event.progress);
    });
  }

  const jobId = NativeUtilModule.startCalculateFileHash(fileUri);

  const abortHandler = () => NativeUtilModule.cancelJob(jobId);
  signal?.addEventListener('abort', abortHandler);

  try {
    const result = await NativeUtilModule.waitForJob(jobId);
    return result;
  } catch (error) {
    if (
      error instanceof Error &&
      ((error as { code?: string }).code === 'CANCELLED' ||
        error.message === 'Operation was cancelled')
    ) {
      const abortError = new Error('Operation was aborted');
      abortError.name = 'AbortError';
      throw abortError;
    }
    throw error;
  } finally {
    signal?.removeEventListener('abort', abortHandler);
    progressSub?.remove();
  }
}

export async function nativeUploadFile(
  url: string,
  headers: Record<string, string>,
  fileUri: string,
  signal?: AbortSignal,
  onProgress?: (info: ProgressInfo) => void
): Promise<void> {
  if (Platform.OS !== 'android') {
    throw new Error('NativeUtilModule is not available on this platform');
  }

  if (signal?.aborted) {
    throw new DOMException('Upload aborted', 'AbortError');
  }

  let progressSub: EventSubscription | null = null;
  let resolvedJobId: string | null = null;
  if (onProgress) {
    progressSub = NativeUtilModule.addListener('onUploadProgress', (event: UploadProgressEvent) => {
      if (resolvedJobId && event.jobId === resolvedJobId) {
        onProgress({
          progress: event.progress,
          bytesTransferred: event.bytesWritten,
          totalBytes: event.totalBytes,
        });
      }
    });
  }

  const jobId = NativeUtilModule.startUploadFile(url, headers, fileUri);
  resolvedJobId = jobId;

  const abortHandler = () => NativeUtilModule.cancelJob(jobId);
  signal?.addEventListener('abort', abortHandler);

  try {
    await NativeUtilModule.waitForJob(jobId);
  } finally {
    signal?.removeEventListener('abort', abortHandler);
    progressSub?.remove();
  }
}

export async function nativeUploadMultipart(
  url: string,
  headers: Record<string, string>,
  formFields: Record<string, string>,
  fileUri?: string,
  signal?: AbortSignal,
  onProgress?: (info: ProgressInfo) => void
): Promise<void> {
  if (Platform.OS !== 'android') {
    throw new Error('NativeUtilModule is not available on this platform');
  }

  if (signal?.aborted) {
    throw new DOMException('Upload aborted', 'AbortError');
  }

  let progressSub: EventSubscription | null = null;
  let resolvedJobId: string | null = null;
  if (onProgress) {
    progressSub = NativeUtilModule.addListener('onUploadProgress', (event: UploadProgressEvent) => {
      if (resolvedJobId && event.jobId === resolvedJobId) {
        onProgress({
          progress: event.progress,
          bytesTransferred: event.bytesWritten,
          totalBytes: event.totalBytes,
        });
      }
    });
  }

  const jobId = NativeUtilModule.startUploadMultipart(url, headers, formFields, fileUri ?? null);
  resolvedJobId = jobId;

  const abortHandler = () => NativeUtilModule.cancelJob(jobId);
  signal?.addEventListener('abort', abortHandler);

  try {
    await NativeUtilModule.waitForJob(jobId);
  } finally {
    signal?.removeEventListener('abort', abortHandler);
    progressSub?.remove();
  }
}

export async function nativeDownloadFile(
  url: string,
  headers: Record<string, string>,
  fileUri: string,
  signal?: AbortSignal,
  onProgress?: (info: ProgressInfo) => void
): Promise<void> {
  if (Platform.OS !== 'android') {
    throw new Error('NativeUtilModule is not available on this platform');
  }

  if (signal?.aborted) {
    throw new DOMException('Download aborted', 'AbortError');
  }

  let progressSub: EventSubscription | null = null;
  let resolvedJobId: string | null = null;
  if (onProgress) {
    progressSub = NativeUtilModule.addListener(
      'onDownloadProgress',
      (event: DownloadProgressEvent) => {
        if (resolvedJobId && event.jobId === resolvedJobId) {
          onProgress({
            progress: event.progress,
            bytesTransferred: event.bytesRead,
            totalBytes: event.totalBytes,
          });
        }
      }
    );
  }

  const jobId = NativeUtilModule.startDownloadFile(url, headers, fileUri);
  resolvedJobId = jobId;

  const abortHandler = () => NativeUtilModule.cancelJob(jobId);
  signal?.addEventListener('abort', abortHandler);

  try {
    await NativeUtilModule.waitForJob(jobId);
  } finally {
    signal?.removeEventListener('abort', abortHandler);
    progressSub?.remove();
  }
}
