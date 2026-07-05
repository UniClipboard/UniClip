import { create } from 'zustand';
import i18n from '@/i18n';

interface ErrorInfo {
  title: string;
  message: string;
}

interface ErrorState {
  error: ErrorInfo | null;

  setError: (error: ErrorInfo | null) => void;
  clearError: () => void;
  showNetworkError: (operation: string, detail?: string) => void;
}

export const useErrorStore = create<ErrorState>((set) => ({
  error: null,

  setError: (error) => set({ error }),

  clearError: () => set({ error: null }),

  showNetworkError: (operation: string, detail?: string) => {
    set({
      error: {
        title: i18n.t('sync:error.operationFailedTitle', { operation }),
        message: detail || i18n.t('sync:error.networkDefault'),
      },
    });
  },
}));
