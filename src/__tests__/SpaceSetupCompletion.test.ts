import AsyncStorage from '@react-native-async-storage/async-storage';
import * as spaceFeature from '../features/space';

const storage = {
  getItem: jest.mocked(AsyncStorage.getItem),
  setItem: jest.mocked(AsyncStorage.setItem),
};

describe('Space setup completion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storage.getItem.mockResolvedValue(null);
    storage.setItem.mockResolvedValue(undefined);
  });

  it('loads a durable tri-state marker and reconciles missing markers from local Core state', async () => {
    const CompletionState = (
      spaceFeature as unknown as {
        SpaceSetupCompletionState?: new (
          storage: typeof storage,
          publish: (status: string) => void
        ) => {
          load(): Promise<string>;
          resolveFromCore(completed: boolean): Promise<void>;
          markComplete(): Promise<void>;
          markIncomplete(): Promise<void>;
        };
      }
    ).SpaceSetupCompletionState;
    expect(CompletionState).toEqual(expect.any(Function));

    const statuses: string[] = [];
    const completion = new CompletionState!(storage, (status) => statuses.push(status));

    await expect(completion.load()).resolves.toBe('unknown');
    expect(statuses.at(-1)).toBe('unknown');

    await completion.resolveFromCore(true);
    expect(statuses.at(-1)).toBe('complete');
    expect(storage.setItem).toHaveBeenLastCalledWith(expect.any(String), '1');

    await completion.markIncomplete();
    expect(statuses.at(-1)).toBe('incomplete');
    expect(storage.setItem).toHaveBeenLastCalledWith(expect.any(String), '0');

    await completion.markComplete();
    expect(statuses.at(-1)).toBe('complete');
  });

  it('does not let a slower initial read overwrite a completion written during startup', async () => {
    let resolveRead!: (value: string | null) => void;
    storage.getItem.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRead = resolve;
      })
    );
    const CompletionState = (
      spaceFeature as unknown as {
        SpaceSetupCompletionState: new (
          storage: typeof storage,
          publish: (status: string) => void
        ) => {
          load(): Promise<string>;
          markComplete(): Promise<void>;
        };
      }
    ).SpaceSetupCompletionState;
    const statuses: string[] = [];
    const completion = new CompletionState(storage, (status) => statuses.push(status));

    const loading = completion.load();
    await completion.markComplete();
    resolveRead('0');
    await loading;

    expect(statuses.at(-1)).toBe('complete');
  });

  it('keeps a stored completion when a later local read temporarily reports no Space', async () => {
    storage.getItem.mockResolvedValueOnce('1');
    const CompletionState = spaceFeature.SpaceSetupCompletionState;
    const statuses: string[] = [];
    const completion = new CompletionState(storage, (status) => statuses.push(status));

    await completion.load();
    await completion.resolveFromCore(false);

    expect(statuses.at(-1)).toBe('complete');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('keeps the successful in-memory state and retries when persistence fails', async () => {
    storage.setItem
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockRejectedValueOnce(new Error('storage still unavailable'));
    const CompletionState = spaceFeature.SpaceSetupCompletionState;
    const statuses: string[] = [];
    const completion = new CompletionState(storage, (status) => statuses.push(status));

    await expect(completion.markComplete()).resolves.toBeUndefined();
    expect(statuses.at(-1)).toBe('complete');

    await completion.retryPendingWrite();
    expect(storage.setItem).toHaveBeenCalledTimes(3);
    expect(storage.setItem).toHaveBeenLastCalledWith(expect.any(String), '1');
  });

  it('retries a failed leave write before a fresh launch reads the old completion', async () => {
    let storedValue: string | null = '1';
    let remainingFailures = 1;
    const durableStorage = {
      getItem: jest.fn(async () => storedValue),
      setItem: jest.fn(async (_key: string, value: string) => {
        if (remainingFailures > 0) {
          remainingFailures -= 1;
          throw new Error('storage unavailable');
        }
        storedValue = value;
      }),
    };
    const CompletionState = spaceFeature.SpaceSetupCompletionState;
    const leaving = new CompletionState(durableStorage, () => undefined);

    await leaving.load();
    await leaving.markIncomplete();

    const relaunched = new CompletionState(durableStorage, () => undefined);
    await expect(relaunched.load()).resolves.toBe('incomplete');
    expect(durableStorage.setItem).toHaveBeenCalledTimes(2);
  });
});
