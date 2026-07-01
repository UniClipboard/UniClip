/**
 * Logger 文件传输器必须以追加模式写入，禁止"整读 + 整写"。
 *
 * 回归背景：customFileTransport 曾对每条日志执行 textSync() 全量读取 +
 * 全文件重写。日志文件增长到数 MB 后，每条日志都在 JS 线程上同步阻塞
 * ~100ms+（文件越大越久）；叠加 SyncEngine 每秒一条 tick 日志，表现为
 * 全应用每秒"顿住"一次（浮层打开动画、滚动、点按均受影响）。
 */
const textSyncCalls: string[] = [];
const writeCalls: { content: string; options?: { append?: boolean } }[] = [];

jest.mock('expo-file-system', () => {
  class MockDirectory {
    exists = true;
    create = jest.fn();
    constructor(..._parts: unknown[]) {}
  }
  class MockFile {
    exists = true;
    constructor(..._parts: unknown[]) {}
    textSync() {
      textSyncCalls.push('read');
      return 'existing content\n';
    }
    write(content: string, options?: { append?: boolean }) {
      writeCalls.push({ content, options });
    }
  }
  return {
    File: MockFile,
    Directory: MockDirectory,
    Paths: { document: 'file://documents', cache: 'file://cache' },
  };
});

import { customFileTransport } from '@/services/Logger';

describe('Logger 文件传输器', () => {
  beforeEach(() => {
    textSyncCalls.length = 0;
    writeCalls.length = 0;
  });

  it('每条日志以 append 模式写入，绝不读取既有文件内容', () => {
    const base = { rawMsg: 'hello', level: { severity: 1, text: 'info' } };
    customFileTransport({ ...base, msg: 'hello' });
    customFileTransport({ ...base, msg: 'world' });

    expect(textSyncCalls).toHaveLength(0);
    expect(writeCalls).toHaveLength(2);
    for (const call of writeCalls) {
      expect(call.options).toEqual({ append: true });
    }
    expect(writeCalls[0].content).toContain('hello');
    expect(writeCalls[1].content).toContain('world');
  });
});
