/**
 * 一次性凭据 drop-box
 *
 * 用途：扫码 / 深链解析出的 SyncClipboard 接入凭据在被 UI 消费前的中转。
 * 通过 store 传递而不是 navigation params，避免明文密码进入 nav state / dev tools / crash report。
 *
 * 使用约定：
 * - 写入方（QrScannerModal）：`set({ url, user, pwd, label? })`
 * - 消费方（多处 UI 在挂载 / 扫码完成时调用 `consume()` 取值并立即清空 store）：
 *   HomeView（onboarding 配对交接，仅首帧消费一次）、SettingsScreen、
 *   settings/ServerModals、ServerConfigModal、AddServerSheet（内嵌扫码器）。
 *   注意：`consume()` 是先到先得，任何新增消费方都要保证不会抢走别人的凭据（见 HomeView 的 `[]` 依赖注释）。
 * - 永远不要把这个 store 的内容序列化到磁盘或日志
 */
import { create } from 'zustand';

export interface PendingConnectIntent {
  url: string;
  urls?: string[];
  user: string;
  pwd: string;
  label?: string;
}

interface PendingConnectState {
  intent: PendingConnectIntent | null;
  set: (intent: PendingConnectIntent) => void;
  consume: () => PendingConnectIntent | null;
  clear: () => void;
}

export const usePendingConnectStore = create<PendingConnectState>((set, get) => ({
  intent: null,
  set: (intent) => set({ intent }),
  consume: () => {
    const v = get().intent;
    if (v !== null) set({ intent: null });
    return v;
  },
  clear: () => set({ intent: null }),
}));
