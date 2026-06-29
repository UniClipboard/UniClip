/**
 * 服务器表单/扫码 modal 的共享状态。
 *
 * 服务器列表(ServerSection)是 LazyColumn 的 item(纯 Compose),而服务器配置/扫码用的是
 * RN <Modal>(ServerModals),必须渲染在 LazyColumn 之外。两者通过这个轻量 store 通信:
 * 列表里的「编辑/添加/扫码」触发 store action,LazyColumn 外的 ServerModals 订阅并弹出。
 */
import { create } from 'zustand';
import { ServerConfig } from '@/types/api';

interface ServerFormState {
  formVisible: boolean;
  editingIndex: number | null;
  prefill: ServerConfig | null;
  openAdd: () => void;
  openEdit: (index: number) => void;
  openPrefilled: (config: ServerConfig) => void;
  closeForm: () => void;
}

export const useServerFormStore = create<ServerFormState>((set) => ({
  formVisible: false,
  editingIndex: null,
  prefill: null,
  openAdd: () => set({ formVisible: true, editingIndex: null, prefill: null }),
  openEdit: (index) => set({ formVisible: true, editingIndex: index, prefill: null }),
  openPrefilled: (config) => set({ formVisible: true, editingIndex: null, prefill: config }),
  closeForm: () => set({ formVisible: false, prefill: null }),
}));
