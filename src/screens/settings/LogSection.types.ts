import type { DiagnosticArtifact } from '@/support/diagnostics';

export interface LogSectionProps {
  onBack?: () => void;
  onSendArchive?: (artifact: DiagnosticArtifact) => void;
}
