/// <reference types="node" />

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('P2P delivery UI wiring', () => {
  it('persists manual send reports and wires resend through the existing card menu', () => {
    const controller = source('src/screens/useHomeController.ts');

    expect(controller).toContain('persistP2pDeliveryReport');
    expect(controller).toContain('p2pDeliveryStateFromResend');
    expect(controller).toContain('onResend:');
    expect(controller).toContain('getUnifiedSpaceService().resendEntry');
  });

  it.each(['android', 'ios'])('shows the saved P2P delivery state on %s cards', (platform) => {
    const card = source(`src/components/ClipboardCard.${platform}.tsx`);

    expect(card).toContain('p2pDeliveryState');
    expect(card).toContain('deliveryLabel');
    expect(card).toContain('p2pDeliveryCounts');
    expect(card).toContain('delivery.partial');
  });

  it('upgrades existing history databases with P2P delivery fields', () => {
    const database = source('src/services/db/database.ts');

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
