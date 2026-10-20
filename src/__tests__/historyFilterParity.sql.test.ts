import { historyRepository } from '../features/history/internal/historyRepository';
import { getDatabase, TABLE_HISTORY } from '../platform/database';
import { createDefaultClipboardItem, type ClipboardItem } from '../types/clipboard';
import type { HistoryFilter } from '../types/storage';
import { filterHistoryItems, matchesHistoryFilter } from '../utils/historyFilters';

function item(profileHash: string, overrides: Partial<ClipboardItem> = {}): ClipboardItem {
  return createDefaultClipboardItem({
    profileHash,
    type: 'Text',
    text: '',
    timestamp: 0,
    hasData: false,
    ...overrides,
  });
}

const hashes = (items: ClipboardItem[]) => items.map((entry) => entry.profileHash);

// Executes production queries through the better-sqlite3 adapter, not a SQL mock.
async function expectParity(filter: HistoryFilter, expected: string[]) {
  const persisted = await historyRepository.getAll();
  const incremental = filterHistoryItems(persisted, filter);
  expect(hashes(incremental)).toEqual(expected);
  expect(hashes(await historyRepository.find(filter))).toEqual(expected);
  expect(await historyRepository.count(filter)).toBe(expected.length);
}

describe('history SQL / incremental filter contract', () => {
  it.each<[string, Partial<ClipboardItem>, HistoryFilter, boolean]>([
    ['ASCII text', { text: 'Hello' }, { keyword: 'hELLo' }, true],
    ['Cyrillic different case', { text: 'ПРИВЕТ' }, { keyword: 'привет' }, false],
    ['Cyrillic exact case', { text: 'ПРИВЕТ' }, { keyword: 'ПРИВЕТ' }, true],
    ['accent different case', { text: 'ÉCOLE' }, { keyword: 'école' }, false],
    ['accent exact case / ASCII folding', { text: 'ÉCOLE' }, { keyword: 'École' }, true],
    ['Unicode filename', { dataName: 'ПРИВЕТ.TXT' }, { keyword: 'ПРИВЕТ.txt' }, true],
    [
      'Unicode filename different case',
      { dataName: 'ÉCOLE.txt' },
      { keyword: 'école' },
      false,
    ],
    ['ASCII filename', { dataName: 'Report.PDF' }, { keyword: 'report.pdf' }, true],
    ['absent filename', { dataName: undefined }, { keyword: 'null' }, false],
    ['empty keyword', { text: 'anything' }, { keyword: '' }, true],
    ['whitespace is literal', { text: 'hello' }, { keyword: ' ' }, false],
    ['percent literal', { text: '100%' }, { keyword: '%' }, true],
    ['percent is not wildcard', { text: '100' }, { keyword: '%' }, false],
    ['underscore literal', { text: 'a_b' }, { keyword: '_' }, true],
    ['underscore is not wildcard', { text: 'abc' }, { keyword: '_' }, false],
    ['backslash literal', { dataName: 'a\\b' }, { keyword: '\\' }, true],
    ['combined LIKE escapes', { text: 'x\\_%y' }, { keyword: '\\_%' }, true],
    ['before zero start', { timestamp: -1 }, { startDate: 0 }, false],
    ['after zero end', { timestamp: 1 }, { endDate: 0 }, false],
    ['inclusive zero', { timestamp: 0 }, { startDate: 0, endDate: 0 }, true],
    ['inclusive negative date', { timestamp: -1 }, { startDate: -1, endDate: -1 }, true],
    ['reversed dates', { timestamp: 0 }, { startDate: 1, endDate: -1 }, false],
  ])('%s', async (_label, overrides, filter, matches) => {
    await historyRepository.replace(item('case', overrides));
    await expectParity(filter, matches ? ['case'] : []);
  });

  it('combines type, display kind, source, dates and status flags with AND semantics', async () => {
    const matching = item('match', {
      text: 'https://example.com/Hello',
      from: 'server',
      timestamp: 5,
      starred: true,
      pinned: true,
      synced: true,
      isLocalFileReady: true,
      syncStatus: 2,
    });
    const filter: HistoryFilter = {
      type: ['Text'],
      displayKinds: ['url'],
      source: 'remote',
      keyword: 'HELLO',
      startDate: 0,
      endDate: 10,
      starredOnly: true,
      pinnedOnly: true,
      syncedOnly: true,
      localOnly: true,
      syncStatus: [2],
      transferringOnly: true,
    };
    const exclusions: Partial<ClipboardItem>[] = [
      { type: 'File' },
      { text: 'hello' },
      { from: undefined },
      { timestamp: -1 },
      { timestamp: 11 },
      { starred: false },
      { pinned: false },
      { synced: false },
      { isLocalFileReady: false },
      { syncStatus: 0 },
      { isDeleted: true },
    ];
    await historyRepository.replaceMany([
      matching,
      ...exclusions.map((override, i) => ({
        ...matching,
        ...override,
        profileHash: `no-${i}`,
      })),
    ]);
    await expectParity(filter, ['match']);
    await expectParity({ syncStatus: [0], transferringOnly: true }, []);
  });

  it('preserves defaults on round trip, empty lists, false flags and local source', async () => {
    await historyRepository.replace(
      item('defaults', {
        syncStatus: undefined,
        starred: undefined,
        pinned: undefined,
        synced: undefined,
        isLocalFileReady: undefined,
        from: undefined,
        dataName: undefined,
      })
    );
    await expectParity({ type: [], displayKinds: [], syncStatus: [], starredOnly: false }, [
      'defaults',
    ]);
    await expectParity({ source: 'local', syncStatus: [0] }, ['defaults']);
    await expectParity({ source: 'remote' }, []);
    await expectParity({ syncedOnly: true }, []);
  });

  it('keeps pinned ordering, SQL pagination and unpaged counts after insert and update', async () => {
    await historyRepository.replaceMany([
      item('old', { text: 'ÉCOLE', timestamp: 1 }),
      item('pinned', { text: 'École', timestamp: 0, pinned: true }),
      item('different-case', { text: 'école', timestamp: 10 }),
    ]);
    const filter = { keyword: 'École', startDate: 0 };
    await expectParity(filter, ['pinned', 'old']);
    const added = item('new', { text: 'ÉCOLE', timestamp: 2 });
    expect(matchesHistoryFilter(added, filter)).toBe(true);
    await historyRepository.replace(added);
    await expectParity(filter, ['pinned', 'new', 'old']);
    expect(
      hashes(await historyRepository.find(filter, undefined, { limit: 1, offset: 1 }))
    ).toEqual(['new']);
    expect(await historyRepository.count(filter, { limit: 1, offset: 1 })).toBe(3);
    expect(
      hashes(await historyRepository.find(filter, { field: 'timestamp', order: 'asc' }))
    ).toEqual(['pinned', 'old', 'new']);
    const updated = { ...added, text: 'école' };
    expect(matchesHistoryFilter(updated, filter)).toBe(false);
    await historyRepository.replace(updated);
    await expectParity(filter, ['pinned', 'old']);
  });

  it('keeps includeDeleted as a repository-only option', async () => {
    const deleted = item('deleted', { text: 'HELLO', isDeleted: true });
    await historyRepository.replace(deleted);
    await expectParity({ keyword: 'hello' }, []);
    expect(
      hashes(
        await historyRepository.find({ keyword: 'hello' }, undefined, {
          includeDeleted: true,
        })
      )
    ).toEqual(['deleted']);
    expect(
      await historyRepository.count({ keyword: 'hello' }, { includeDeleted: true })
    ).toBe(1);
    expect(matchesHistoryFilter(deleted, { keyword: 'hello' })).toBe(false);
  });

  it('reads existing / extension-style rows without rewriting or materializing search data', async () => {
    const db = await getDatabase();
    // Direct writer supplies displayKind, like HistoryDatabase.swift; no JS row mapper.
    await db.runAsync(
      `INSERT INTO ${TABLE_HISTORY}
      (profileHash, type, text, displayKind, timestamp, dataName, "from")
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['external', 'Text', 'ÉCOLE', 'text', 0, null, null]
    );
    await expectParity(
      {
        keyword: 'École',
        startDate: 0,
        endDate: 0,
        source: 'local',
        displayKinds: ['text'],
        syncStatus: [0],
      },
      ['external']
    );
    await expectParity({ keyword: 'école' }, []);
    expect(await db.getFirstAsync(`SELECT text, dataName FROM ${TABLE_HISTORY}`)).toEqual({
      text: 'ÉCOLE',
      dataName: null,
    });
  });

  it('propagates query errors instead of returning empty results', async () => {
    const db = await getDatabase();
    await db.execAsync(`DROP TABLE ${TABLE_HISTORY}`);
    // Native SQLite errors may originate in another Jest VM; inspect their message.
    const failure = { message: expect.stringContaining(`no such table: ${TABLE_HISTORY}`) };
    await expect(historyRepository.find({ keyword: 'hello' })).rejects.toMatchObject(
      failure
    );
    await expect(historyRepository.count({ keyword: 'hello' })).rejects.toMatchObject(
      failure
    );
  });
});
