import type { useTheme } from '@/hooks/useTheme';

export interface AddActionsFabProps {
  /** 悬浮菜单是否展开(受控) */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 相机拍摄后上传 */
  onTakePhoto: () => void;
  /** 从相册选择图片上传 */
  onPickImage: () => void;
  /** 选择任意文件上传 */
  onPickFile: () => void;
  /** 上传当前系统剪贴板内容 */
  onUploadClipboard: () => void;
  /** 立即与服务器同步(融合入菜单末项) */
  onSync: () => void;
  theme: ReturnType<typeof useTheme>['theme'];
}
