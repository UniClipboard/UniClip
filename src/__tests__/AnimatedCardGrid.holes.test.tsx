/**
 * 空槽位诊断回路(fuzz):随机的列表变更(插入/删除/置顶/重复 hash)与滚动
 * 交错执行,允许弹簧动画处于"未落地"状态时继续变更(覆盖动画取消路径),
 * 最终落定所有动画后断言:
 *   1. 可视区域内的每个下标槽位,恰好有一张卡片停在该槽位坐标上(无空洞);
 *   2. 任意两张已挂载卡片不会停在同一坐标(无堆叠);
 *   3. 槽位上的卡片内容与 items[i] 的业务 hash 一致(无错位)。
 */
import React from 'react';
import TestRenderer, { act, ReactTestRenderer, ReactTestInstance } from 'react-test-renderer';
import { StyleSheet } from 'react-native';

// ---- 可控的 reanimated mock:withSpring 挂起,由测试显式落定/取消 ----
type SpringBox = { _current: number; value: number };
interface PendingSpring {
  box: SpringBox;
  to: number;
  cb?: (finished: boolean) => void;
}
// mock 前缀:jest.mock 工厂只允许引用 mock 前缀的外部变量
const mockAnim: {
  pendingSprings: PendingSpring[];
  // 模拟 Reanimated 样式桥接失效:置 true 后,新挂载组件的 useAnimatedStyle
  // 只保留挂载瞬间的快照,之后共享值更新不再反映到视图上(JS 侧回调照常触发)。
  // 对应真机上"快速挂载/卸载后动画样式不再生效"的故障模式。
  mapperDeadForNewMounts: boolean;
} = { pendingSprings: [], mapperDeadForNewMounts: false };

function settleAllSprings() {
  while (mockAnim.pendingSprings.length > 0) {
    const s = mockAnim.pendingSprings.shift()!;
    s.box._current = s.to;
    s.cb?.(true);
  }
}

jest.mock('react-native-reanimated', () => {
  const ReactActual = require('react');

  const makeSharedValue = (init: number) => {
    const box: any = { _current: init };
    Object.defineProperty(box, 'value', {
      get() {
        return box._current;
      },
      set(v: any) {
        const idx = mockAnim.pendingSprings.findIndex((s) => s.box === box);
        if (idx >= 0) {
          const [cancelled] = mockAnim.pendingSprings.splice(idx, 1);
          cancelled.cb?.(false);
        }
        if (v && typeof v === 'object' && v.__spring) {
          mockAnim.pendingSprings.push({ box, to: v.to, cb: v.cb });
        } else {
          box._current = v;
        }
      },
    });
    box.get = () => box.value;
    box.set = (value: unknown) => {
      box.value = value;
    };
    return box;
  };

  const AnimatedView = ReactActual.forwardRef((props: any, ref: any) =>
    ReactActual.createElement('AnimatedView', { ...props, ref })
  );
  const AnimatedScrollView = ReactActual.forwardRef((props: any, ref: any) =>
    ReactActual.createElement('AnimatedScrollView', { ...props, ref })
  );

  return {
    __esModule: true,
    default: { View: AnimatedView, ScrollView: AnimatedScrollView },
    useSharedValue: (init: number) => {
      const ref = ReactActual.useRef(null);
      if (!ref.current) ref.current = makeSharedValue(init);
      return ref.current;
    },
    useAnimatedStyle: (fn: () => any) => {
      const frozenRef = ReactActual.useRef(null);
      if (frozenRef.current === null) {
        frozenRef.current = mockAnim.mapperDeadForNewMounts
          ? { dead: true, snapshot: { transform: fn().transform } }
          : { dead: false };
      }
      if (frozenRef.current.dead) return frozenRef.current.snapshot;
      return {
        get transform() {
          return fn().transform;
        },
      };
    },
    useAnimatedScrollHandler: (fn: (event: any) => void) => fn,
    withSpring: (to: number, _config: any, cb?: (finished: boolean) => void) => ({
      __spring: true,
      to,
      cb,
    }),
  };
});

jest.mock('react-native-worklets', () => ({
  scheduleOnRN: (fn: (...args: any[]) => void, ...args: any[]) => fn(...args),
}));

import { AnimatedCardGrid } from '@/components/AnimatedCardGrid';

// ---- 布局参数(与断言共用) ----
const NUM_COLUMNS = 2;
const CARD_SIZE = 100;
const SPACING = 10;
const CELL = CARD_SIZE + SPACING;
const PAD_H = 5;
const PAD_TOP = 8;
const PAD_BOTTOM = 80;
const VIEWPORT = 500;

interface Item {
  id: number;
  hash: string;
}

const keyExtractor = (item: Item) => item.hash;
const renderItem = (item: Item) =>
  React.createElement('cell', { cellId: item.id, cellHash: item.hash });

function renderGrid(items: Item[]) {
  return (
    <AnimatedCardGrid
      items={items}
      numColumns={NUM_COLUMNS}
      cardSize={CARD_SIZE}
      spacing={SPACING}
      paddingHorizontal={PAD_H}
      paddingTop={PAD_TOP}
      paddingBottom={PAD_BOTTOM}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
    />
  );
}

function slotCoords(index: number) {
  const col = index % NUM_COLUMNS;
  const row = Math.floor(index / NUM_COLUMNS);
  return { x: PAD_H + col * CELL, y: PAD_TOP + row * CELL };
}

interface MountedCell {
  x: number;
  y: number;
  hash: string;
  id: number;
}

function readMountedCells(root: ReactTestInstance): MountedCell[] {
  return root
    .findAll((n) => n.type === ('AnimatedView' as any))
    .map((view) => {
      const styles = view.props.style as any[];
      const base = styles[0];
      const live = styles[styles.length - 1];
      const t = live.transform as { translateX?: number; translateY?: number }[];
      // 视觉位置 = 静态 left/top + 动画 transform 增量
      const x = (base.left ?? 0) + t.find((e) => 'translateX' in e)!.translateX!;
      const y = (base.top ?? 0) + t.find((e) => 'translateY' in e)!.translateY!;
      const marker = view.findAll((n) => n.type === ('cell' as any))[0];
      return { x, y, hash: marker.props.cellHash, id: marker.props.cellId };
    });
}

function checkInvariants(root: ReactTestInstance, items: Item[], scrollTop: number, label: string) {
  const cells = readMountedCells(root);

  const occupied = new Map<string, MountedCell>();
  for (const cell of cells) {
    const key = `${cell.x},${cell.y}`;
    const prev = occupied.get(key);
    if (prev) {
      throw new Error(
        `[${label}] 两张卡片堆叠在同一槽位 (${key}): id=${prev.id}/hash=${prev.hash} 与 id=${cell.id}/hash=${cell.hash}`
      );
    }
    occupied.set(key, cell);
  }

  items.forEach((item, i) => {
    const { x, y } = slotCoords(i);
    const visible = y + CARD_SIZE > scrollTop && y < scrollTop + VIEWPORT;
    if (!visible) return;
    const cell = occupied.get(`${x},${y}`);
    if (!cell) {
      throw new Error(
        `[${label}] 可视槽位空洞: index=${i} (${x},${y}) 应为 hash=${item.hash},实际无卡片。已挂载 ${cells.length} 张`
      );
    }
    if (cell.hash !== item.hash) {
      throw new Error(
        `[${label}] 槽位内容错位: index=${i} 应为 hash=${item.hash},实际 hash=${cell.hash}`
      );
    }
  });
}

// 定长线性同余,保证可复现
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('AnimatedCardGrid 空槽位模糊回路', () => {
  afterEach(() => {
    mockAnim.pendingSprings.length = 0;
    mockAnim.mapperDeadForNewMounts = false;
  });

  function setup(initialCount: number) {
    let nextId = 1;
    const makeItem = (): Item => {
      const id = nextId++;
      return { id, hash: `hash-${id}` };
    };
    let items: Item[] = Array.from({ length: initialCount }, makeItem);

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(renderGrid(items));
    });
    const scrollView = () =>
      renderer.root.findAll((n) => n.type === ('AnimatedScrollView' as any))[0];
    act(() => {
      scrollView().props.onLayout({ nativeEvent: { layout: { height: VIEWPORT } } });
    });

    return {
      renderer,
      makeItem,
      getItems: () => items,
      setItems: (next: Item[]) => {
        items = next;
        act(() => {
          renderer.update(renderGrid(items));
        });
      },
      scrollTo: (y: number) => {
        act(() => {
          scrollView().props.onScroll({ contentOffset: { y } });
        });
      },
      settle: () => {
        act(() => {
          settleAllSprings();
        });
      },
    };
  }

  it('随机变更与滚动交错后,可视窗口内不出现空槽位/堆叠/错位', () => {
    const rng = makeRng(20260704);
    const world = setup(40);
    let scrollTop = 0;

    for (let iter = 0; iter < 300; iter++) {
      const opCount = 1 + Math.floor(rng() * 3);
      for (let k = 0; k < opCount; k++) {
        const items = world.getItems();
        const roll = rng();
        if (roll < 0.2) {
          world.setItems([world.makeItem(), ...items]);
        } else if (roll < 0.35 && items.length > 0) {
          // 重复业务 hash(脏数据/扩展重复导入)
          const src = items[Math.floor(rng() * items.length)];
          world.setItems([{ id: -src.id, hash: src.hash }, ...items]);
        } else if (roll < 0.55 && items.length > 4) {
          const idx = Math.floor(rng() * items.length);
          world.setItems(items.filter((_, i) => i !== idx));
        } else if (roll < 0.75 && items.length > 1) {
          // 已有条目置顶(重新复制既有内容)
          const idx = Math.floor(rng() * items.length);
          const picked = items[idx];
          world.setItems([picked, ...items.filter((_, i) => i !== idx)]);
        } else {
          const totalRows = Math.ceil(world.getItems().length / NUM_COLUMNS);
          const contentHeight = PAD_TOP + totalRows * CELL + PAD_BOTTOM;
          scrollTop = Math.max(0, Math.floor(rng() * Math.max(1, contentHeight - VIEWPORT)));
          world.scrollTo(scrollTop);
        }
        // 一半概率在动画未落地时就叠加下一个变更,覆盖弹簧取消路径
        if (rng() < 0.5) world.settle();
      }
      world.settle();
      checkInvariants(world.renderer.root, world.getItems(), scrollTop, `iter=${iter}`);
    }
  });

  it('样式桥接失效(动画更新丢失)时,静止卡片仍停在正确槽位', () => {
    // 真机故障模式:卡片挂载后 Reanimated 的样式更新不再作用于视图。
    // 期望:位置不应只活在动画 transform 里——静止时卡片必须停在正确槽位,
    // 最坏只是丢一次动画,而不是永久滞留在别的坐标留下空槽位。
    mockAnim.mapperDeadForNewMounts = true;
    const world = setup(20);
    const items = world.getItems();
    // 置顶一个中部条目,触发前面所有卡片重排飞行,随后落定
    world.setItems([items[7], ...items.filter((_, i) => i !== 7)]);
    world.settle();
    checkInvariants(world.renderer.root, world.getItems(), 0, 'dead-mapper');
  });

  it('删除可视区中部条目并落定后,不留空槽位', () => {
    const world = setup(20);
    const items = world.getItems();
    world.setItems(items.filter((_, i) => i !== 5));
    world.settle();
    checkInvariants(world.renderer.root, world.getItems(), 0, 'delete-middle');
  });

  it.each([2, 4])('头部新增在 %i 列布局中只提交一次界面更新', (numColumns) => {
    let items: Item[] = Array.from({ length: 20 }, (_, index) => ({
      id: index + 1,
      hash: `hash-${index + 1}`,
    }));
    const commits: string[] = [];
    const render = () => (
      <React.Profiler id={`grid-${numColumns}`} onRender={(_id, phase) => commits.push(phase)}>
        <AnimatedCardGrid
          items={items}
          numColumns={numColumns}
          cardSize={CARD_SIZE}
          spacing={SPACING}
          paddingHorizontal={PAD_H}
          paddingTop={PAD_TOP}
          paddingBottom={PAD_BOTTOM}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
        />
      </React.Profiler>
    );

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(render());
    });
    act(() => {
      renderer.root.findByType('AnimatedScrollView' as any).props.onLayout({
        nativeEvent: { layout: { height: VIEWPORT } },
      });
    });
    commits.length = 0;

    items = [{ id: 21, hash: 'hash-21' }, ...items];
    act(() => {
      renderer.update(render());
    });
    act(() => {
      settleAllSprings();
    });

    expect(commits).toEqual(['update']);
  });

  it('keeps card content at a fixed layout size while the visual slot resizes', () => {
    const items: Item[] = [{ id: 1, hash: 'hash-1' }];
    const render = (cardSize: number) => (
      <AnimatedCardGrid
        items={items}
        numColumns={1}
        cardSize={cardSize}
        renderCardSize={200}
        spacing={SPACING}
        paddingHorizontal={PAD_H}
        paddingTop={PAD_TOP}
        paddingBottom={PAD_BOTTOM}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
      />
    );

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(render(100));
    });
    const firstFrame = StyleSheet.flatten(
      renderer.root.findByType('cell' as any).parent?.props.style
    );
    expect(firstFrame.width).toBe(200);
    expect(firstFrame.height).toBe(200);
    expect(firstFrame.transform).toEqual([{ scale: 0.5 }]);

    act(() => {
      renderer.update(render(120));
    });
    const secondFrame = StyleSheet.flatten(
      renderer.root.findByType('cell' as any).parent?.props.style
    );
    expect(secondFrame.width).toBe(200);
    expect(secondFrame.height).toBe(200);
    expect(secondFrame.transform).toEqual([{ scale: 0.6 }]);
  });
});
