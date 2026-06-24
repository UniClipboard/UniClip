/**
 * 存储占用计算 store
 *
 * 存储 section 与日志 section 都需要这组数据（缓存/历史/日志大小、计算中标志），
 * 清理缓存/日志后还要统一刷新。用一个轻量 zustand store 共享，两个组件各自用选择器
 * 细粒度订阅，互不牵连重渲。
 */
import { create } from 'zustand';
import { Paths, Directory } from 'expo-file-system';
import { calculateDirectorySize, CLIPBOARD_TEMP_DIR } from '@/utils/fileStorage';
import { calculateLogSize } from '@/services';

interface StorageSizesState {
  cacheSize: number;
  historySize: number;
  logSize: number;
  isCalculating: boolean;
  recalculate: () => Promise<void>;
}

export const useStorageSizesStore = create<StorageSizesState>((set) => ({
  cacheSize: 0,
  historySize: 0,
  logSize: 0,
  isCalculating: true,
  recalculate: async () => {
    set({ isCalculating: true });
    try {
      // 让出一帧，避免目录遍历阻塞首屏
      await new Promise((resolve) => setTimeout(resolve, 100));
      const cacheDir = CLIPBOARD_TEMP_DIR;
      const historyDir = new Directory(Paths.document, 'clipboards', 'history');
      set({
        cacheSize: calculateDirectorySize(cacheDir),
        historySize: calculateDirectorySize(historyDir),
        logSize: calculateLogSize(),
      });
    } catch (error) {
      console.error('Failed to calculate storage sizes:', error);
    } finally {
      set({ isCalculating: false });
    }
  },
}));
