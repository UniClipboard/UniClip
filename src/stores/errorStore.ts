import { create } from 'zustand';

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
        title: `${operation} Failed`,
        message: detail || 'Network connection failed, check network settings',
      },
    });
  },
}));
