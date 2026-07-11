/**
 * File Action Utilities — 跨平台契约
 *
 * 文件操作的共享接口。iOS 与 Android 各自在 `fileActions.ios.ts` /
 * `fileActions.android.ts` 中实现，由 Metro 的平台文件解析自动选择。
 * 调用方一律从 `@/utils/fileActions` 导入，不感知平台差异。
 */

export interface FileActions {
  /**
   * 用系统能力打开/预览文件。
   * - Android：ACTION_VIEW Intent（APK 会引导开启「安装未知来源」）。
   * - iOS：系统预览 / 分享面板。
   */
  openFile(fileUri: string): Promise<void>;

  /**
   * 将文件保存到用户自己选择的位置。
   * - Android：SAF 目录选择器，复制到所选文件夹。
   * - iOS：系统文件导出选择器（UIDocumentPicker export 模式）。
   *
   * @returns `true` 已保存；`false` 用户取消。真正的失败会 throw。
   */
  saveFile(fileUri: string, fileName?: string): Promise<boolean>;

  /**
   * 通过系统分享对话框分享文件（两端一致）。
   */
  shareFile(fileUri: string, fileName?: string): Promise<void>;

  /**
   * 保存图片到系统相册（两端一致，仅支持图片类型）。
   */
  saveToGallery(fileUri: string): Promise<void>;
}
