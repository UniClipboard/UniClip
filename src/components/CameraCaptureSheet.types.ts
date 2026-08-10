import type { useTheme } from '@/hooks/useTheme';

/**
 * 相机拍摄/录制完成的成果。字段与 expo-image-picker 的 asset 对齐,
 * 便于直接喂给 saveAndPush 落库。
 */
export interface CameraCaptureResult {
  uri: string;
  fileName: string;
  mimeType: string;
  fileSize?: number;
}

export interface CameraCaptureSheetProps {
  /** 是否展示(iOS 从不置 true:走系统相机) */
  visible: boolean;
  /** 用户关闭相机页;拍摄成功后由父层负责收起 */
  onClose: () => void;
  /** 拍照或录像完成 */
  onCapture: (result: CameraCaptureResult) => void;
  theme: ReturnType<typeof useTheme>['theme'];
}
