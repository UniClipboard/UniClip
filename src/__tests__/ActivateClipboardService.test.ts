import { writeActivate, clearActivate, noteApplied } from '@/services/ActivateClipboardService';
import type { ClipboardContent } from '@/types/clipboard';

// 进程内的 activate 单行寄存器 + history Map,让 writeActivate/clearActivate 走真实逻辑。
let mockActivateRow: any = null;
const mockHistoryMap = new Map<string, any>();

jest.mock('@/services/db/activateRepository', () => ({
  activateRepository: {
    get: jest.fn(async () => mockActivateRow),
    upsert: jest.fn(
      async (profileHash: string, contentId: string | null, activatedAtMs: number) => {
        mockActivateRow = { profileHash, contentId, activatedAtMs };
      }
    ),
    clear: jest.fn(async () => {
      mockActivateRow = null;
    }),
  },
}));

jest.mock('@/services/db/historyRepository', () => ({
  historyRepository: {
    getByProfileHash: jest.fn(async (h: string) => mockHistoryMap.get(h.toLowerCase()) ?? null),
    replace: jest.fn(async (item: any) => {
      mockHistoryMap.set(item.profileHash.toLowerCase(), item);
    }),
  },
}));

const content = (profileHash: string, text = 'x'): ClipboardContent => ({
  type: 'Text',
  text,
  profileHash,
});

describe('ActivateClipboardService', () => {
  beforeEach(() => {
    mockActivateRow = null;
    mockHistoryMap.clear();
    noteApplied(null);
    jest.clearAllMocks();
  });

  it('writeActivate 首次写入:创建历史行(指针目标)并 upsert 寄存器,content_id 为 null', async () => {
    await writeActivate(content('AAA'));
    expect(mockHistoryMap.has('aaa')).toBe(true);
    expect(mockActivateRow).toMatchObject({ profileHash: 'AAA', contentId: null });
  });

  it('writeActivate 对相同 profileHash 去重:第二次是 no-op(不再 upsert)', async () => {
    const { activateRepository } = require('@/services/db/activateRepository');
    await writeActivate(content('AAA'));
    await writeActivate(content('AAA'));
    expect(activateRepository.upsert).toHaveBeenCalledTimes(1);
  });

  it('anti-echo:等于刚应用的远端 hash 时不写入(不制造陈旧 re-push)', async () => {
    const { activateRepository } = require('@/services/db/activateRepository');
    noteApplied('YYY');
    await writeActivate(content('YYY'));
    expect(activateRepository.upsert).not.toHaveBeenCalled();
    expect(mockActivateRow).toBeNull();
  });

  it('主动激活(active=true)绕过 anti-echo:即便等于刚 apply 的 hash 也写入', async () => {
    noteApplied('YYY');
    await writeActivate(content('YYY'), { active: true });
    expect(mockActivateRow).toMatchObject({ profileHash: 'YYY' });
  });

  it('重新激活服务端拉取项:带回历史行的 contentId', async () => {
    mockHistoryMap.set('bbb', { profileHash: 'BBB', contentId: 'blake3v1:deadbeef' });
    await writeActivate(content('BBB'));
    expect(mockActivateRow).toMatchObject({ profileHash: 'BBB', contentId: 'blake3v1:deadbeef' });
  });

  it('§3 apply 后 clearActivate 删除寄存器 → device_present=false', async () => {
    await writeActivate(content('AAA'));
    expect(mockActivateRow).not.toBeNull();
    await clearActivate();
    expect(mockActivateRow).toBeNull();
  });
});
