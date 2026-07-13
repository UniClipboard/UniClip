import type { ActionMenuItem } from '@/utils/actionMenuItems';
import type { DisplayKind } from '@/utils/displayKind';
import { getDetailActionLayout } from '@/utils/detailActionLayout';
import zhHome from '@/i18n/locales/zh/home.json';
import enHome from '@/i18n/locales/en/home.json';

function action(key: string): ActionMenuItem {
  return {
    key,
    label: key,
    icon: `${key}-outline`,
    destructive: key === 'delete',
    onPress: jest.fn(),
  };
}

// popover 开合 / 分发 / 关闭等交互行为由 ClipboardDetailActionBar.test.tsx 以真实渲染断言;
// 这里只黑盒验证「动作如何分配到 primary / quick / overflow」这层纯逻辑,以及标签数据。
describe('getDetailActionLayout', () => {
  const actions = [
    action('copy'),
    action('copyPlain'),
    action('selectText'),
    action('openBrowser'),
    action('saveImage'),
    action('saveFile'),
    action('share'),
    action('select'),
    action('delete'),
  ];

  const expectedQuick: Record<DisplayKind, string[]> = {
    text: ['selectText', 'share'],
    url: ['openBrowser', 'share'],
    image: ['saveImage', 'share'],
    file: ['saveFile', 'share'],
    group: ['saveFile', 'share'],
  };

  it.each(Object.entries(expectedQuick) as [DisplayKind, string[]][])(
    'picks content-specific quick actions and keeps delete in overflow (%s)',
    (kind, quickKeys) => {
      const layout = getDetailActionLayout(actions, kind);

      expect(layout.primary?.key).toBe('copy');
      expect(layout.quick.map((item) => item.key)).toEqual(quickKeys);
      // copy 是 primary、quick 两项已抽走,其余(含 delete)落 overflow。
      expect(layout.overflow.map((item) => item.key)).not.toContain('copy');
      expect(layout.overflow.map((item) => item.key)).toEqual(
        expect.not.arrayContaining(quickKeys)
      );
      expect(layout.overflow.at(-1)?.key).toBe('delete');
    }
  );

  it('falls back to share + select when no content action is available', () => {
    // 图片未就绪时不会有 saveImage;快捷位应优雅降级到通用 share / select。
    const layout = getDetailActionLayout(
      [action('copy'), action('share'), action('select'), action('delete')],
      'image'
    );

    expect(layout.quick.map((item) => item.key)).toEqual(['share', 'select']);
    expect(layout.overflow.map((item) => item.key)).toEqual(['delete']);
  });

  it('caps quick actions at two entries', () => {
    const layout = getDetailActionLayout(actions, 'text');
    expect(layout.quick).toHaveLength(2);
  });
});

describe('detail quick-action labels', () => {
  it('exposes short labels in both locales', () => {
    expect(zhHome.detail.quickActions).toEqual({ select: '选择', open: '打开', save: '保存' });
    expect(enHome.detail.quickActions).toEqual({ select: 'Select', open: 'Open', save: 'Save' });
  });
});
