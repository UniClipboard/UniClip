import AsyncStorage from '@react-native-async-storage/async-storage';
import { RuntimeState, RUNTIME_STATE_DEFAULTS } from '../types/settings';

const RUNTIME_STATE_KEY = '@syncclipboard:runtime_state';

export class RuntimeStateStorage {
  async load(): Promise<RuntimeState> {
    try {
      const json = await AsyncStorage.getItem(RUNTIME_STATE_KEY);
      if (!json) return { ...RUNTIME_STATE_DEFAULTS };
      const parsed = JSON.parse(json);
      return { ...RUNTIME_STATE_DEFAULTS, ...parsed };
    } catch {
      return { ...RUNTIME_STATE_DEFAULTS };
    }
  }

  async save(state: RuntimeState): Promise<void> {
    await AsyncStorage.setItem(RUNTIME_STATE_KEY, JSON.stringify(state));
  }

  async update(partial: Partial<RuntimeState>): Promise<void> {
    const current = await this.load();
    await this.save({ ...current, ...partial });
  }
}

export const runtimeStateStorage = new RuntimeStateStorage();
