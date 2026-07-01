/**
 * buildOccurrenceKeys 测试
 * 网格渲染 key 消歧:列表中出现重复业务 key(profileHash)时,
 * 必须生成互不相同且稳定的 React key,否则虚拟化窗口同时罩住
 * 两份副本时会触发 React key 冲突(卡片乱飞/空洞)。
 */

import { buildOccurrenceKeys } from '../utils/occurrenceKeys';

describe('buildOccurrenceKeys', () => {
  const extract = (s: string) => s;

  it('无重复时原样返回业务 key', () => {
    expect(buildOccurrenceKeys(['a', 'b', 'c'], extract)).toEqual(['a', 'b', 'c']);
  });

  it('重复 key 按出现序消歧,保证全局唯一', () => {
    const keys = buildOccurrenceKeys(['a', 'b', 'a', 'a'], extract);
    expect(keys[0]).toBe('a');
    expect(keys[1]).toBe('b');
    expect(keys[2]).not.toBe('a');
    expect(keys[3]).not.toBe('a');
    expect(new Set(keys).size).toBe(4);
  });

  it('相同输入产生相同输出(key 稳定,不随渲染次数漂移)', () => {
    const items = ['x', 'y', 'x', 'z', 'x'];
    expect(buildOccurrenceKeys(items, extract)).toEqual(buildOccurrenceKeys(items, extract));
  });

  it('首份副本保留原始 key(正常数据下动画身份不变)', () => {
    const keys = buildOccurrenceKeys(['h1', 'h2', 'h1'], extract);
    expect(keys[0]).toBe('h1');
    expect(keys[1]).toBe('h2');
  });

  it('支持自定义 keyExtractor', () => {
    const items = [{ hash: 'p' }, { hash: 'q' }, { hash: 'p' }];
    const keys = buildOccurrenceKeys(items, (i) => i.hash);
    expect(keys[0]).toBe('p');
    expect(new Set(keys).size).toBe(3);
  });

  it('空列表返回空数组', () => {
    expect(buildOccurrenceKeys([], extract)).toEqual([]);
  });
});
