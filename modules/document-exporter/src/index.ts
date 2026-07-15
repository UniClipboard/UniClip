import { requireOptionalNativeModule } from 'expo-modules-core';

interface DocumentExporterNativeModule {
  exportFileAsync(fileUri: string, fileName: string | null): Promise<string | null>;
  saveImageToPhotoLibraryAsync(fileUri: string, fileName: string | null): Promise<void>;
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

/**
 * Save an image to the iOS photo library without creating a renamed temp copy.
 * The native exporter supplies the filename and UTI directly to PhotoKit, so
 * content-addressed App Group payloads can remain extensionless on disk.
 */
export async function saveImageToPhotoLibrary(fileUri: string, fileName?: string): Promise<void> {
  if (!NativeModule) {
    throw new Error('DocumentExporter native module is unavailable');
  }
  await NativeModule.saveImageToPhotoLibraryAsync(fileUri, fileName ?? null);
}
