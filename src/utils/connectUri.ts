/**
 * uniclipboard://connect URI 解析器
 *
 * 协议规范：docs (移动端扫码接入协议)
 * 任何在客户端处理本 URI 的代码路径都必须遵守 spec 的安全约束：
 * - 不得把完整 URI / payload / pwd 写入日志、analytics、crash 报告
 * - 本模块内部不调用任何 logger
 *
 * 实现委托给 Rust core (uc-mobile) 通过 UniFFI FFI 调用。
 */

import { parseConnectUri as rustParseConnectUri } from 'uc-core';

export const CONNECT_URI_SCHEME = 'uniclipboard';
export const CONNECT_URI_HOST = 'connect';
export const CONNECT_URI_SVC = 'mobile-sync';
export const CONNECT_URI_VERSION = 1;

export type ConnectUriError =
  | 'INVALID_SCHEME'
  | 'UNSUPPORTED_VERSION'
  | 'UNSUPPORTED_SERVICE'
  | 'PAYLOAD_DECODE_FAILED'
  | 'MISSING_FIELD'
  | 'INVALID_URL';

export const CONNECT_URI_ERROR_MESSAGES: Record<ConnectUriError, string> = {
  INVALID_SCHEME: '不是 UniClipboard 的二维码。',
  UNSUPPORTED_VERSION: '请升级 App。',
  UNSUPPORTED_SERVICE: '当前版本不支持该服务。',
  PAYLOAD_DECODE_FAILED: '二维码已损坏，请重新生成。',
  MISSING_FIELD: '二维码内容不完整，请重新生成。',
  INVALID_URL: '二维码里的服务地址无效。',
};

export interface ConnectUriResult {
  url: string;
  urls: string[];
  user: string;
  pwd: string;
  label?: string;
}

export type ParseConnectUriOutcome =
  | { ok: true; value: ConnectUriResult }
  | { ok: false; error: ConnectUriError };

function mapRustError(message: string): ConnectUriError {
  if (message.includes('InvalidScheme')) return 'INVALID_SCHEME';
  if (message.includes('UnsupportedVersion')) return 'UNSUPPORTED_VERSION';
  if (message.includes('UnsupportedService')) return 'UNSUPPORTED_SERVICE';
  if (message.includes('PayloadDecodeFailed')) return 'PAYLOAD_DECODE_FAILED';
  if (message.includes('MissingField')) return 'MISSING_FIELD';
  if (message.includes('InvalidUrl')) return 'INVALID_URL';
  return 'PAYLOAD_DECODE_FAILED';
}

export function parseConnectUri(rawInput: string): ParseConnectUriOutcome {
  const raw = (rawInput ?? '').trim();
  if (raw.length === 0) return { ok: false, error: 'INVALID_SCHEME' };

  try {
    const payload = rustParseConnectUri(raw);
    const label = payload.other?.label;
    return {
      ok: true,
      value: {
        url: payload.url,
        urls: payload.urls,
        user: payload.user,
        pwd: payload.pwd,
        ...(label ? { label } : {}),
      },
    };
  } catch (e: unknown) {
    return { ok: false, error: mapRustError((e as Error).message) };
  }
}
