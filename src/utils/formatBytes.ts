/** Human-readable byte count with one decimal above 1 KB. */
export function formatBytes(byteCount: number): string {
  if (byteCount < 1024) return `${byteCount} B`;
  if (byteCount < 1024 * 1024) return `${(byteCount / 1024).toFixed(1)} KB`;
  if (byteCount < 1024 * 1024 * 1024) return `${(byteCount / (1024 * 1024)).toFixed(1)} MB`;
  return `${(byteCount / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
