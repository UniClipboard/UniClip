import { computeExpandedWorkspaceLayout, computeGridMetrics } from '@/utils/gridLayout';

const PADDING = 16;
const SPACING = 12;

describe('computeGridMetrics', () => {
  it('keeps 2 columns on a phone-width container', () => {
    const { numColumns, cardSize } = computeGridMetrics(390, PADDING, SPACING, 2);
    expect(numColumns).toBe(2);
    // 卡片落在自适应目标区间上沿附近,不会被拉成超大卡
    expect(cardSize).toBeGreaterThan(160);
  });

  it('keeps a reasonable card size in a tablet master pane (~420pt)', () => {
    const { numColumns, cardSize } = computeGridMetrics(420, PADDING, SPACING, 2);
    expect(numColumns).toBeGreaterThanOrEqual(2);
    expect(cardSize).toBeGreaterThanOrEqual(160);
    expect(cardSize).toBeLessThanOrEqual(230);
  });

  it('never drops below minColumns', () => {
    const { numColumns } = computeGridMetrics(120, PADDING, SPACING, 2);
    expect(numColumns).toBe(2);
  });

  it('adds columns as the container widens', () => {
    const narrow = computeGridMetrics(420, PADDING, SPACING, 2).numColumns;
    const wide = computeGridMetrics(900, PADDING, SPACING, 2).numColumns;
    expect(wide).toBeGreaterThan(narrow);
  });

  it('never lets cards balloon past the max target on a wide pane', () => {
    // 回归:floor 少算一列 → 卡片被拉到 300+pt。宽平板栏(含详情打开的三栏)必须保持列数够密、
    // 卡片落在目标上限附近而非撑破它。gridAdaptiveMax = 210。
    // 边界宽度上 min/max 会打架(某些宽度 n 列略超 max、n+1 列又低于 min),允许略过 max;
    // 但绝不能出现 floor bug 那种「卡片被拉到 300+pt」的失控膨胀。取 240 作上限即可捕获回归。
    for (const width of [700, 780, 1000, 1180, 1280]) {
      const { cardSize } = computeGridMetrics(width, PADDING, SPACING, 2);
      expect(cardSize).toBeLessThanOrEqual(240);
    }
  });

  it('returns a safe result for a zero-width (unmeasured) container', () => {
    const { numColumns, cardSize } = computeGridMetrics(0, PADDING, SPACING, 2);
    expect(numColumns).toBe(2);
    expect(cardSize).toBe(0);
  });
});

describe('computeExpandedWorkspaceLayout', () => {
  it('gives a portrait tablet enough grid width by overlaying detail', () => {
    const layout = computeExpandedWorkspaceLayout(711);
    const metrics = computeGridMetrics(layout.gridWidth, PADDING, SPACING, 2);

    expect(layout.detailPlacement).toBe('overlay');
    expect(layout.gridWidth).toBe(603);
    expect(metrics.numColumns).toBe(3);
    expect(metrics.cardSize).toBeGreaterThanOrEqual(160);
  });

  it('keeps detail beside the grid when all panes fit', () => {
    const layout = computeExpandedWorkspaceLayout(1137);
    const metrics = computeGridMetrics(layout.gridWidth, PADDING, SPACING, 2);

    expect(layout.detailPlacement).toBe('side');
    expect(layout.detailWidth).toBe(341);
    expect(layout.gridWidth).toBe(676);
    expect(metrics.numColumns).toBe(3);
  });
});
