import { DiagnosticsPage } from './ios/DiagnosticsPage';
import type { LogSectionProps } from './LogSection.types';

export function LogSection({ onBack }: LogSectionProps) {
  if (!onBack) return null;
  return <DiagnosticsPage onBack={onBack} />;
}
