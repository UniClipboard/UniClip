import { requireOptionalNativeModule } from 'expo-modules-core';

interface DocumentExporterNativeModule {
  exportFileAsync(fileUri: string, fileName: string | null): Promise<string | null>;
}

const NativeModule = requireOptionalNativeModule<DocumentExporterNativeModule>('DocumentExporter');

/** Whether the native document exporter is present in this build (iOS only). */
export function isAvailable(): boolean {
  return NativeModule != null;
}

/**
 * Present the iOS document export picker so the user chooses where to save.
 *
 * @param fileUri Local `file://` URI (or path) of the file to export.
 * @param fileName Preferred name shown / saved (payloads are content-addressed
 *   on disk, so pass the human name here).
 * @returns The saved file URL, or `null` if the user cancelled.
 * @throws If the native module is unavailable or the export fails.
 */
export async function exportFile(fileUri: string, fileName?: string): Promise<string | null> {
  if (!NativeModule) {
    throw new Error('DocumentExporter native module is unavailable');
  }
  return NativeModule.exportFileAsync(fileUri, fileName ?? null);
}
