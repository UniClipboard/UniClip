import type { ClipboardAccessMethod } from '@/types/settings';

export interface OpenClipboardAccessMethodSheetOptions {
  selectedMethod: ClipboardAccessMethod;
  onSelect: (method: ClipboardAccessMethod) => void | Promise<void>;
}

export type AdbSetupStage = 'instructions' | 'copied' | 'notDetected';

export interface OpenAdbSetupSheetOptions {
  stage: AdbSetupStage;
  command: string;
  onCopy: () => void;
  onCheck: () => void;
}

export interface ClipboardAccessMethodSheetController {
  openMethodSheet: (options: OpenClipboardAccessMethodSheetOptions) => void;
  openAdbSetupSheet: (options: OpenAdbSetupSheetOptions) => void;
  closeSheet: () => void;
}
