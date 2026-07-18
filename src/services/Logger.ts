import {
  logger,
  consoleTransport,
  type ConsoleTransportOptions,
  type transportFunctionType,
} from 'react-native-logs';
import { Paths, Directory, File } from 'expo-file-system';
import { deleteAsync, StorageAccessFramework } from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { nativeCopyFile, nativeZipFiles } from 'android-util';
import * as Application from 'expo-application';
import i18n from '@/i18n';
import { redactLogText, redactLogValue } from './logRedaction';

const LOG_DIR = new Directory(Paths.document, 'logs');
const LOG_EXPORT_DIR = new Directory(Paths.cache, 'log_exports');
const MAX_LOG_DAYS = 3;
const LOG_EXPORT_RETENTION_MS = 24 * 60 * 60 * 1000;

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatLocalDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

function formatLocalTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogConfig {
  level: LogLevel;
  enableConsole: boolean;
}

export interface ExportedLogArchive {
  uri: string;
  fileName: string;
}

interface CustomTransportOptions {
  _custom?: string;
}

let isInitialized = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let logInstance: any = null;

const redactingConsoleTransport: transportFunctionType<ConsoleTransportOptions> = (props) => {
  consoleTransport({
    ...props,
    msg: redactLogText(props.msg),
    rawMsg: redactLogValue(props.rawMsg),
  });
};

/** 导出仅用于单测（append-only 回归锁定）；运行时经由 createLogger 使用 */
export const customFileTransport = (props: {
  msg: string;
  rawMsg: unknown;
  level: { severity: number; text: string };
  extension?: string | null;
  options?: CustomTransportOptions;
}): void => {
  try {
    if (!LOG_DIR.exists) {
      LOG_DIR.create();
    }

    const today = new Date();
    const dateStr = formatLocalDate(today);
    const fileName = `app_${dateStr}.txt`;
    const logFile = new File(LOG_DIR, fileName);

    const timestamp = formatLocalTimestamp(today);
    const level = props.level.text.toUpperCase();
    const extension = props.extension ? ` [${props.extension}]` : '';
    const message = redactLogText(props.msg);

    const logLine = `${timestamp} ${level}${extension}: ${message}\n`;

    // 必须追加写。整读整写是 O(文件大小) 的同步 JS 阻塞，文件到数 MB 后
    // 每条日志都会冻结 JS 线程 100ms+（见 Logger.appendOnly.test.ts）
    logFile.write(logLine, { append: true });
  } catch (error) {
    console.error('Failed to write log file:', error);
  }
};

export function initLogger(config?: Partial<LogConfig>): void {
  if (isInitialized) {
    return;
  }

  const logConfig = {
    level: config?.level ?? (__DEV__ ? 'debug' : 'info'),
    enableConsole: config?.enableConsole ?? true,
  };

  const transports = logConfig.enableConsole
    ? [redactingConsoleTransport, customFileTransport]
    : [customFileTransport];

  logInstance = logger.createLogger({
    levels: {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
    },
    severity: logConfig.level,
    transport: transports,
    async: true,
    dateFormat: 'iso',
    printLevel: true,
    printDate: true,
  });

  logInstance.patchConsole();
  isInitialized = true;

  cleanOldLogs();
  if (Platform.OS === 'android') {
    cleanExportedLogArchives();
  }
  logSystemInfo();
}

function logSystemInfo(): void {
  if (Platform.OS !== 'android') return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (Platform as any).constants;
  const appVersion = Application.nativeApplicationVersion ?? 'unknown';
  const buildVersion = Application.nativeBuildVersion ?? 'unknown';
  const androidRelease: string = c?.Release ?? 'unknown';
  const apiLevel: number = Platform.Version as number;
  const model: string = c?.Model ?? 'unknown';
  const manufacturer: string = c?.manufacturer ?? 'unknown';
  logInstance.info(
    `App started | version: ${appVersion} (build ${buildVersion}) | ` +
      `Android ${androidRelease} (API ${apiLevel}) | ${manufacturer} ${model}`
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getLogger(): any {
  if (!logInstance) {
    initLogger();
  }
  return logInstance;
}

export function setLogLevel(level: LogLevel): void {
  if (logInstance) {
    logInstance.setSeverity(level);
  }
}

export function getLogDirectory(): Directory {
  return LOG_DIR;
}

export function getLogFilePaths(): string[] {
  if (!LOG_DIR.exists) {
    return [];
  }

  const files = LOG_DIR.list();
  return files
    .filter((entry): entry is File => entry instanceof File)
    .filter((file) => file.name.endsWith('.txt'))
    .map((file) => file.uri);
}

export function calculateLogSize(): number {
  if (!LOG_DIR.exists) {
    return 0;
  }

  let totalSize = 0;
  const files = LOG_DIR.list();

  for (const entry of files) {
    if (entry instanceof File) {
      try {
        const info = entry.info();
        totalSize += info.size || 0;
      } catch {
        // ignore
      }
    }
  }

  return totalSize;
}

export function clearLogs(): void {
  if (LOG_DIR.exists) {
    const files = LOG_DIR.list();
    for (const entry of files) {
      try {
        if (entry instanceof File) {
          entry.delete();
        }
      } catch {
        // ignore
      }
    }
  }
}

export function cleanOldLogs(): void {
  if (!LOG_DIR.exists) {
    return;
  }

  const today = new Date();
  const cutoffDate = new Date(today);
  cutoffDate.setDate(cutoffDate.getDate() - MAX_LOG_DAYS);

  const files = LOG_DIR.list();
  for (const entry of files) {
    if (entry instanceof File && entry.name.endsWith('.txt')) {
      const match = entry.name.match(/app_(\d{4}-\d{2}-\d{2})\.txt/);
      if (match) {
        const fileDate = new Date(match[1]);
        if (fileDate < cutoffDate) {
          try {
            entry.delete();
          } catch {
            // ignore
          }
        }
      }
    }
  }
}

export const log = {
  debug: (...args: unknown[]) =>
    getLogger().debug(redactLogValue(args.length === 1 ? args[0] : args)),
  info: (...args: unknown[]) =>
    getLogger().info(redactLogValue(args.length === 1 ? args[0] : args)),
  warn: (...args: unknown[]) =>
    getLogger().warn(redactLogValue(args.length === 1 ? args[0] : args)),
  error: (...args: unknown[]) =>
    getLogger().error(redactLogValue(args.length === 1 ? args[0] : args)),
};

export function getLogFileUris(): string[] {
  if (!LOG_DIR.exists) {
    return [];
  }

  return LOG_DIR.list()
    .filter((entry): entry is File => entry instanceof File && entry.name.endsWith('.txt'))
    .map((file) => file.uri);
}

function createExportAbortError(): Error {
  const error = new Error('Log export was aborted');
  error.name = 'AbortError';
  return error;
}

function throwIfExportAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createExportAbortError();
  }
}

function cleanExportedLogArchives(now = Date.now()): void {
  if (!LOG_EXPORT_DIR.exists) return;

  for (const entry of LOG_EXPORT_DIR.list()) {
    if (
      !(entry instanceof File) ||
      !entry.name.startsWith('logs_') ||
      !entry.name.endsWith('.zip')
    ) {
      continue;
    }
    if (entry.lastModified === null || now - entry.lastModified >= LOG_EXPORT_RETENTION_MS) {
      entry.delete();
    }
  }
}

function getExportableLogFileUris(): string[] {
  const fileUris = getLogFileUris();
  if (fileUris.length === 0) {
    throw new Error(i18n.t('errors:log.noFilesToExport'));
  }
  return fileUris;
}

async function createLogArchiveFromFiles(
  fileUris: string[],
  signal?: AbortSignal
): Promise<ExportedLogArchive> {
  const timestamp = formatLocalDateTime(new Date());
  const fileName = `logs_${timestamp}.zip`;

  if (!LOG_EXPORT_DIR.exists) {
    LOG_EXPORT_DIR.create();
  }
  const archive = new File(LOG_EXPORT_DIR, fileName);
  const sanitizedDirectory = new Directory(LOG_EXPORT_DIR, `sanitized_${timestamp}_${Date.now()}`);
  if (archive.exists) {
    archive.delete();
  }

  try {
    throwIfExportAborted(signal);
    sanitizedDirectory.create({ intermediates: true });
    const sanitizedFileUris: string[] = [];
    for (const fileUri of fileUris) {
      throwIfExportAborted(signal);
      const source = new File(fileUri);
      const sanitizedFile = new File(sanitizedDirectory, source.name);
      sanitizedFile.write(redactLogText(await source.text()));
      sanitizedFileUris.push(sanitizedFile.uri);
    }
    throwIfExportAborted(signal);
    await nativeZipFiles(sanitizedFileUris, archive.uri, signal);
    throwIfExportAborted(signal);
    return { uri: archive.uri, fileName };
  } catch (error) {
    if (archive.exists) {
      archive.delete();
    }
    throw error;
  } finally {
    try {
      if (sanitizedDirectory.exists) sanitizedDirectory.delete();
    } catch {
      // Temporary sanitized files contain no credentials; cache cleanup remains best-effort.
    }
  }
}

export function createLogArchive(signal?: AbortSignal): Promise<ExportedLogArchive> {
  if (Platform.OS !== 'android') {
    throw new Error('createLogArchive is only supported on Android');
  }

  cleanExportedLogArchives();
  return createLogArchiveFromFiles(getExportableLogFileUris(), signal);
}

export async function saveLogsToFile(signal?: AbortSignal): Promise<void> {
  if (Platform.OS !== 'android') {
    throw new Error('saveLogsToFile is only supported on Android');
  }

  const fileUris = getExportableLogFileUris();
  cleanExportedLogArchives();
  const permissions = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permissions.granted) {
    throw createExportAbortError();
  }

  let archive: ExportedLogArchive | null = null;
  let destUri: string | null = null;
  try {
    archive = await createLogArchiveFromFiles(fileUris, signal);
    throwIfExportAborted(signal);
    destUri = await StorageAccessFramework.createFileAsync(
      permissions.directoryUri,
      archive.fileName,
      'application/zip'
    );
    await nativeCopyFile(archive.uri, destUri);
    throwIfExportAborted(signal);
  } catch (error) {
    if (destUri) {
      try {
        await deleteAsync(destUri, { idempotent: true });
      } catch {
        // Preserve the original export error if the document provider cannot delete the partial file.
      }
    }
    throw error;
  } finally {
    if (archive) {
      deleteExportedLogArchive(archive.uri);
    }
  }
}

export function deleteExportedLogArchive(fileUri: string): void {
  const archive = new File(fileUri);
  if (archive.exists) {
    archive.delete();
  }
}

export function scheduleExportedLogArchiveCleanup(fileUri: string): void {
  setTimeout(() => deleteExportedLogArchive(fileUri), LOG_EXPORT_RETENTION_MS);
}
