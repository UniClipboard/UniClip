import React, { useCallback, useEffect, useState } from 'react';
import {
  Button as SwiftUIButton,
  HStack,
  Label,
  Picker,
  Section,
  Spacer,
  Text as SwiftUIText,
} from '@expo/ui/swift-ui';
import {
  buttonStyle,
  disabled as disabledMod,
  foregroundStyle,
  frame,
  monospacedDigit,
  pickerStyle,
  tag,
} from '@expo/ui/swift-ui/modifiers';

import { IosSheetForm, IosSheetPage } from '@/components/ui';
import { useSettingsStore } from '@/stores';
import { calculateDirectorySize, clearDirectory, CLIPBOARD_TEMP_DIR } from '@/utils/fileStorage';
import { HeaderCircleButton, SettingsToggle } from './common';

const CACHE_CAP_OPTIONS = [
  { label: '50 MB', value: 50 * 1024 * 1024 },
  { label: '200 MB', value: 200 * 1024 * 1024 },
  { label: '500 MB', value: 500 * 1024 * 1024 },
  { label: '1000 MB', value: 1000 * 1024 * 1024 },
];

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function StoragePage({ onBack, active = true }: { onBack: () => void; active?: boolean }) {
  const { config, updateConfig } = useSettingsStore();
  const [cacheSize, setCacheSize] = useState<number | null>(null);
  const [purging, setPurging] = useState(false);

  const refreshCacheSize = useCallback(async () => {
    try {
      setCacheSize(calculateDirectorySize(CLIPBOARD_TEMP_DIR));
    } catch {
      setCacheSize(0);
    }
  }, []);

  // Mounted off-screen for the slide transition — only walk the cache
  // directory when the page actually comes into view.
  useEffect(() => {
    if (active) refreshCacheSize();
  }, [active, refreshCacheSize]);

  const handlePurgeCache = useCallback(async () => {
    setPurging(true);
    try {
      clearDirectory(CLIPBOARD_TEMP_DIR);
      await refreshCacheSize();
    } catch {
      // ignore
    } finally {
      setPurging(false);
    }
  }, [refreshCacheSize]);

  if (!config) return null;

  const prefetchEnabled = config.attachmentAutoDownload !== 'off';
  const prefetchOnCellular = config.attachmentAutoDownload === 'always';
  const cacheSizeLabel = purging ? '清除中…' : cacheSize !== null ? formatSize(cacheSize) : '—';

  return (
    <IosSheetPage
      title="存储"
      leftSlots={[<HeaderCircleButton key="back" systemName="chevron.left" onPress={onBack} />]}
    >
      <IosSheetForm>
        {/* ── 预下载 ── */}
        <Section
          header={<SwiftUIText>预下载</SwiftUIText>}
          footer={<SwiftUIText>开启后，新内容会在后台静默缓存，点击预览无需等待。</SwiftUIText>}
        >
          <SettingsToggle
            label="预下载附件"
            systemImage="icloud.and.arrow.down"
            isOn={prefetchEnabled}
            onIsOnChange={(v) => updateConfig({ attachmentAutoDownload: v ? 'wifi' : 'off' })}
          />
          {prefetchEnabled && (
            <SettingsToggle
              label="蜂窝下也预下载"
              systemImage="antenna.radiowaves.left.and.right"
              isOn={prefetchOnCellular}
              onIsOnChange={(v) => updateConfig({ attachmentAutoDownload: v ? 'always' : 'wifi' })}
            />
          )}
        </Section>

        {/* ── 缓存 ── */}
        <Section header={<SwiftUIText>缓存</SwiftUIText>}>
          <Picker
            label="缓存上限"
            systemImage="externaldrive"
            selection={config.payloadCacheMaxBytes}
            onSelectionChange={(v) => updateConfig({ payloadCacheMaxBytes: v as number })}
            modifiers={[pickerStyle('menu')]}
          >
            {CACHE_CAP_OPTIONS.map((opt) => (
              <SwiftUIText key={opt.value} modifiers={[tag(opt.value)]}>
                {opt.label}
              </SwiftUIText>
            ))}
          </Picker>

          <HStack modifiers={[frame({ maxWidth: Infinity })]}>
            <Label title="缓存占用" systemImage="internaldrive" />
            <Spacer />
            <SwiftUIText modifiers={[foregroundStyle('secondary'), monospacedDigit()]}>
              {cacheSizeLabel}
            </SwiftUIText>
            <Spacer modifiers={[frame({ width: 8 })]} />
            <SwiftUIButton
              label="清除"
              onPress={handlePurgeCache}
              modifiers={[
                buttonStyle('borderless'),
                foregroundStyle('red'),
                disabledMod(purging || (cacheSize ?? 0) === 0),
              ]}
            />
          </HStack>
        </Section>
      </IosSheetForm>
    </IosSheetPage>
  );
}
