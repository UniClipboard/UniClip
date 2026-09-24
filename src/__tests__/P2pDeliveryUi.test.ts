/// <reference types="node" />

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('P2P delivery UI wiring', () => {
  it('persists manual send reports and wires resend through the existing card menu', () => {
    const controller = source('src/screens/useHomeController.ts');

    expect(controller).not.toContain('persistP2pDeliveryReport');
    expect(controller).toContain('p2pDeliveryStateFromResend');
    expect(controller).toContain('onResend:');
    expect(controller).toContain('getUnifiedSpaceService().resendEntry');
  });

  it('shows local copy feedback before starting sync and history follow-up work', () => {
    const controller = source('src/screens/useHomeController.ts');
    const cardPress = controller.match(/const handleItemCopy = useCallback\([\s\S]*?\n  \);/)?.[0];
    const menuCopy = controller.match(/onCopy: async \(\) => \{[\s\S]*?\n        \},/)?.[0];
    const followUp = controller.match(
      /const startPostCopyFlow = useCallback\([\s\S]*?\n  \);/
    )?.[0];

    expect(cardPress).toBeDefined();
    expect(menuCopy).toBeDefined();
    expect(followUp).toBeDefined();
    expect(cardPress!.indexOf('showMessage(')).toBeLessThan(
      cardPress!.indexOf('startPostCopyFlow(')
    );
    expect(menuCopy!.indexOf('showMessage(')).toBeLessThan(menuCopy!.indexOf('startPostCopyFlow('));
    expect(followUp).toContain('void notifyDeviceClipboardChanged(content)');
    expect(followUp).toMatch(/void historyStorage\s*\.updateLastAccessed\(item\.profileHash\)/);
    expect(followUp).not.toContain('await ');
  });

  it.each(['android', 'ios'])(
    'hides delivery and sync status from %s cards while retaining stored delivery data',
    (platform) => {
      const card = source(`src/components/ClipboardCard.${platform}.tsx`);

      expect(card).not.toContain('p2pDeliveryState');
      expect(card).not.toContain('deliveryLabel');
      expect(card).not.toContain('p2pDeliveryCounts');
      expect(card).not.toContain('getHistoryDirectionIndicator');
      expect(card).not.toContain('directionIndicator');
      expect(card).not.toContain('pendingSync');
      expect(card).toContain('formatFileSize');
      expect(card).toContain('meta={sizeLabel}');
    }
  );

  it('upgrades existing history databases with P2P delivery fields', () => {
    const database = source('src/platform/database/sqliteDatabase.ts');

    expect(database).toContain('SCHEMA_VERSION = 4');
    expect(database).toContain('ADD COLUMN p2pEntryId TEXT');
    expect(database).toContain('ADD COLUMN p2pDeliveryState TEXT');
    expect(database).toContain('ADD COLUMN p2pDeliveryCounts TEXT');
  });

  it('provides partial-delivery wording in every supported language', () => {
    for (const locale of ['en', 'pt-BR', 'ru', 'zh']) {
      const history = JSON.parse(source(`src/i18n/locales/${locale}/history.json`));
      const home = JSON.parse(source(`src/i18n/locales/${locale}/home.json`));

      expect(history.delivery.partial).toEqual(expect.any(String));
      expect(home.toast.p2pDelivery.partial).toEqual(expect.any(String));
    }
  });
});
