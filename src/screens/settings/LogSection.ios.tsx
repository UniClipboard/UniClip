import { DiagnosticsPage } from './ios/DiagnosticsPage';
import type { LogSectionProps } from './LogSection.types';

export function LogSection({ onBack, onSendArchive }: LogSectionProps) {
  if (!onBack || !onSendArchive) return null;
  return <DiagnosticsPage onBack={onBack} onSendArchive={onSendArchive} />;
}
