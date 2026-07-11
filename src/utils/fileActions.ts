/**
 * File Action Utilities
 *
 * 文件操作公共函数 - 打开、保存、分享。iOS/Android 各有原生差异，按项目的
 * 平台文件分离范式拆分：契约见 `fileActions.types.ts`，实现见 `.ios.ts` /
 * `.android.ts`，两端一致的部分在 `.shared.ts`。此基础文件是默认/回退入口，
 * 由 Metro 在 iOS 上自动解析为 `.ios.ts`。调用方一律从 `@/utils/fileActions`
 * 导入。
 */

export * from './fileActions.android';
export type { FileActions } from './fileActions.types';
