/**
 * heicToJpeg
 * iOS 上相册照片/分享内容常为 HEIC 格式，部分桌面端与其它客户端无法直接渲染。
 * 发送前在此将 HEIC/HEIF 转为 JPEG，其它格式原样返回。
 */

import { Platform } from 'react-native';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

const HEIC_EXT_RE = /\.(heic|heif)$/i;

/** JPEG 压缩质量（0-1，1 为无压缩）。保持较高质量以贴近 quality:1 的原图。 */
const JPEG_COMPRESS = 0.92;

export interface NormalizedImage {
  uri: string;
  fileName: string;
  mimeType: string | null | undefined;
  /** 转换后体积已变化，置为 undefined 让调用方从新文件重新计算。 */
  fileSize: number | undefined;
  converted: boolean;
}

function isHeic(fileName: string, uri: string, mimeType?: string | null): boolean {
  const mt = (mimeType ?? '').toLowerCase();
  if (mt === 'image/heic' || mt === 'image/heif') return true;
  const bareUri = uri.split('?')[0];
  return HEIC_EXT_RE.test(fileName) || HEIC_EXT_RE.test(bareUri);
}

/** 将文件名替换为 .jpg 扩展名（无扩展名则追加）。 */
function toJpegName(name: string): string {
  const stem = name.replace(/\.[^./\\]+$/, '');
  return `${stem || name}.jpg`;
}

/**
 * 若为 HEIC/HEIF（仅 iOS）则转为 JPEG，否则原样返回。
 * 转换失败时回退为原文件，保证发送流程不中断。
 */
export async function convertHeicToJpegIfNeeded(
  uri: string,
  fileName: string,
  mimeType: string | null | undefined,
  fileSize: number | undefined
): Promise<NormalizedImage> {
  if (Platform.OS !== 'ios' || !isHeic(fileName, uri, mimeType)) {
    return { uri, fileName, mimeType, fileSize, converted: false };
  }

  try {
    const rendered = await ImageManipulator.manipulate(uri).renderAsync();
    const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_COMPRESS });
    return {
      uri: result.uri,
      fileName: toJpegName(fileName),
      mimeType: 'image/jpeg',
      fileSize: undefined,
      converted: true,
    };
  } catch (error) {
    console.warn('[heicToJpeg] HEIC→JPEG 转换失败，按原文件发送：', error);
    return { uri, fileName, mimeType, fileSize, converted: false };
  }
}
