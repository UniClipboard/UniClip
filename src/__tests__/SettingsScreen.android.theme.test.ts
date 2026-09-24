/// <reference types="node" />

import { describe, expect, it } from '@jest/globals';
import fs from 'fs';
import path from 'path';

const readSource = (relativePath: string) =>
  fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

describe('Android settings root', () => {
  it('seeds every settings Compose palette from the same source as the RN palette', () => {
    const rootSource = readSource('screens/SettingsScreen.android.tsx');
    const subScreenSource = readSource('screens/settings/SettingsSubScreen.android.tsx');
    const palette = readSource('theme/colors.android.ts');

    expect(rootSource).toContain('seedColor={MATERIAL_SEED_COLOR}');
    expect(subScreenSource).toContain('seedColor={MATERIAL_SEED_COLOR}');
    // Material You:动态取色时 Host 不传 seed(跟随壁纸),与 RN 侧 getMaterialColors 同源
    expect(palette).toContain('ui.getMaterialColors({ scheme })');
    expect(palette).toContain('export const MATERIAL_SEED_COLOR');
  });

  it('exposes independent auto-write and auto-push direction switches', () => {
    const rootSource = readSource('screens/SettingsScreen.android.tsx');

    expect(rootSource).toContain('value={autoApplyRemote}');
    expect(rootSource).toContain('updateDirection({ autoApplyRemote: enabled })');
    expect(rootSource).toContain('value={autoPushLocal}');
    expect(rootSource).toContain('updateDirection({ autoPushLocal: enabled })');
    expect(rootSource).not.toContain('setAutoSync');
  });
});
