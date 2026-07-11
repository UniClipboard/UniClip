/**
 * 文件名清洗工具。
 *
 * 分享来的文件名可能是签名 URL 的临时名（如 `xxx?t=<token>.pdf`），其中的 `?`/`%` 等
 * 字符会让服务端 `/file/{dataName}` 的 staging（`begin_stage`）建文件失败（返回 500）。
 * 这里把路径分隔、文件系统/URL 非法字符与控制字符替换成 `_`，保留扩展名与可读性。
 *
 * profileHash 只取原始字节 SHA256、与文件名无关（见 calculateFileProfileHash），清洗
 * 文件名不影响去重。函数幂等：sanitizeDataName(sanitizeDataName(x)) === sanitizeDataName(x)。
 */

/** 保留扩展名时的最大总长度（多数文件系统 255 上限，留余量）。 */
const MAX_LENGTH = 200;
/** 判定为「扩展名」的最长后缀长度（超过则视为普通点，不当扩展名保留）。 */
const MAX_EXT_LENGTH = 20;

export function sanitizeDataName(name: string | null | undefined): string {
  let cleaned = (name ?? '')
    .replace(/[/\\]/g, '_') // 路径分隔
    .replace(/[?%*:|"<>\x00-\x1F]/g, '_') // FS / URL 非法 + 控制字符
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, ''); // 去前导点（避免空名 / 隐藏文件）
  if (cleaned.length > MAX_LENGTH) {
    const dot = cleaned.lastIndexOf('.');
    const ext = dot > 0 && cleaned.length - dot <= MAX_EXT_LENGTH ? cleaned.slice(dot) : '';
    cleaned = cleaned.slice(0, MAX_LENGTH - ext.length) + ext;
  }
  return cleaned || 'file';
}
