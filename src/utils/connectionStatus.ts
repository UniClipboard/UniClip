/**
 * 服务器连接状态派生
 *
 * 首页左上角状态指示器的单一数据源。把 SyncEngine 内部的同步状态机
 * （Idle / Succeeded / OfflineRetrying / AuthFailed …）归一化为面向用户的
 * 5 种连接语义，UI 只关心这 5 种，不直接耦合 reducer 的状态名。
 */

import type { SyncEngineState } from '@/services/SyncEngine';

export type ConnectionStatus =
  | 'unconfigured' // 未配置服务器
  | 'connecting' // 正在建立连接 / 首次同步中
  | 'online' // 已连接，最近一次同步成功
  | 'offline' // 服务器不可达（预期状态，非错误）
  | 'error'; // 鉴权失败 / 循环保护等需要用户介入的异常

export interface ConnectionStatusInput {
  /** 是否已配置活动服务器 */
  hasServer: boolean;
  /** SyncEngine 当前状态 */
  state: SyncEngineState;
  /** 是否正在执行用户主动触发的刷新 */
  isExplicitlyRefreshing: boolean;
  /** 是否曾经同步成功过（lastSyncedAt != null） */
  hasSyncedOnce: boolean;
}

/**
 * 将 SyncEngine 状态映射为连接语义。
 * 顺序即优先级：先判定终态（未配置 / 异常），再判定进行中，最后判定在线/离线。
 */
export function deriveConnectionStatus({
  hasServer,
  state,
  isExplicitlyRefreshing,
  hasSyncedOnce,
}: ConnectionStatusInput): ConnectionStatus {
  if (!hasServer) return 'unconfigured';
  if (state === 'AuthFailed' || state === 'LoopDetected') return 'error';
  if (isExplicitlyRefreshing) return 'connecting';
  if (state === 'OfflineRetrying') return 'offline';
  if (state === 'Succeeded' || state === 'HasNewUnwritten') return 'online';
  // Idle：已同步过视为在线（空闲待命），从未同步过视为连接中（刚启动尚未触达服务器）
  if (state === 'Idle') return hasSyncedOnce ? 'online' : 'connecting';
  return 'connecting';
}

/** 无障碍 / tooltip 文案 */
export const CONNECTION_STATUS_TEXT: Record<ConnectionStatus, string> = {
  unconfigured: '未配置服务器',
  connecting: '连接中',
  online: '已连接',
  offline: '服务器离线',
  error: '连接异常',
};
