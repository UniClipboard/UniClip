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

import i18n from '@/i18n';
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

const CONNECT_URI_ERROR_CODES: ConnectUriError[] = [
  'INVALID_SCHEME',
  'UNSUPPORTED_VERSION',
  'UNSUPPORTED_SERVICE',
  'PAYLOAD_DECODE_FAILED',
  'MISSING_FIELD',
  'INVALID_URL',
];

/** 返回某错误码对应的本地化文案(调用时求值,语言切换即时生效)。 */
export function getConnectUriErrorMessage(error: ConnectUriError): string {
  return i18n.t(`connect:error.${error}`);
}

/**
 * 错误码 → 本地化文案的映射。
 * 用 getter 惰性求值,使 `CONNECT_URI_ERROR_MESSAGES[code]` 的既有消费点无需改动,
 * 同时随语言切换实时返回当前语言文案。
 */
export const CONNECT_URI_ERROR_MESSAGES: Record<ConnectUriError, string> =
  CONNECT_URI_ERROR_CODES.reduce((acc, code) => {
    Object.defineProperty(acc, code, {
      enumerable: true,
      get: () => getConnectUriErrorMessage(code),
    });
    return acc;
  }, {} as Record<ConnectUriError, string>);

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
