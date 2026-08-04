import { Directory, File } from 'expo-file-system';
import { createLogger } from '@/support/observability';

const log = createLogger('FileStorage');

export function getFileExtension(fileName: string): string {
  const match = fileName.match(/\.[^.]+$/);
  return match ? match[0] : '';
}

export function calculateDirectorySize(directory: Directory): number {
  try {
    if (!directory.exists) return 0;

    return directory.list().reduce((totalSize, entry) => {
      try {
        if (entry instanceof File) return totalSize + (entry.info().size || 0);
        if (entry instanceof Directory) return totalSize + calculateDirectorySize(entry);
      } catch {
        // Ignore inaccessible entries so settings remains available.
      }
      return totalSize;
    }, 0);
  } catch (error) {
    log.error('Failed to calculate directory size:', error);
    return 0;
  }
}

export function clearDirectory(directory: Directory): void {
  try {
    if (!directory.exists) return;
    for (const entry of directory.list()) {
      try {
        entry.delete();
      } catch {
        // Ignore individual cleanup failures.
      }
    }
  } catch (error) {
    log.error('Failed to clear directory:', error);
    throw error;
  }
}
