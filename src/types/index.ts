/**
 * Common Types & Interfaces
 */

// Export API types
export * from './api';

// Export Clipboard types
export * from './clipboard';

// Export Storage types
export * from './storage';

// API Response Types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export type { AppSettings } from './settings';
