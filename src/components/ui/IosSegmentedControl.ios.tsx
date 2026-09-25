import { Button, Capsule, HStack, Text as SwiftUIText, ZStack } from '@expo/ui/swift-ui';
import {
  accessibilityAddTraits,
  animation,
  Animation,
  background,
  buttonStyle,
  contentShape,
  font,
  foregroundStyle,
  frame,
  offset,
  onGeometryChange,
  opacity,
  padding,
  shadow,
  shapes,
  type ModifierConfig,
} from '@expo/ui/swift-ui/modifiers';
import { useState } from 'react';
import { DynamicColorIOS, PlatformColor } from 'react-native';

import { iosColors } from '@/theme/iosDesignTokens';

export interface IosSegmentedControlOption<T extends string> {
  value: T;
  label: string;
}

export interface IosSegmentedControlProps<T extends string> {
  options: readonly IosSegmentedControlOption<T>[];
  selection: T;
  onSelectionChange: (value: T) => void;
  testID?: string;
  modifiers?: ModifierConfig[];
}

const HEIGHT = 36;
const INSET = 2;
const thumbColor = DynamicColorIOS({ light: '#FFFFFF', dark: '#636366' });

/**
 * Capsule segmented control drawn in SwiftUI. Use it instead of `Picker` +
 * `pickerStyle('segmented')` when the selection can be changed from code (for example, a
 * confirmation reverts it): the native control only animates user taps and jumps on
 * programmatic changes, while this thumb slides for both.
 */
export function IosSegmentedControl<T extends string>({
  options,
  selection,
  onSelectionChange,
  testID,
  modifiers = [],
}: IosSegmentedControlProps<T>) {
  const [width, setWidth] = useState(0);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === selection)
  );
  const segmentWidth = width > 0 ? (width - INSET * 2) / options.length : 0;

  return (
    <ZStack
      testID={testID}
      alignment="leading"
      modifiers={[
        padding({ all: INSET }),
        frame({ maxWidth: Infinity, height: HEIGHT }),
        background(PlatformColor('tertiarySystemFill'), shapes.capsule()),
        onGeometryChange((frame) => setWidth(frame.width)),
        ...modifiers,
      ]}
    >
      <Capsule
        modifiers={[
          foregroundStyle(thumbColor),
          frame({ width: segmentWidth, height: HEIGHT - INSET * 2 }),
          shadow({ radius: 3, y: 2, color: 'rgba(0,0,0,0.12)' }),
          offset({ x: selectedIndex * segmentWidth }),
          opacity(segmentWidth > 0 ? 1 : 0),
          animation(Animation.spring({ response: 0.3, dampingFraction: 0.85 }), selectedIndex),
        ]}
      />
      <HStack spacing={0}>
        {options.map((option) => {
          const selected = option.value === selection;
          return (
            <Button
              key={option.value}
              onPress={() => {
                if (!selected) onSelectionChange(option.value);
              }}
              modifiers={[
                buttonStyle('plain'),
                ...(selected ? [accessibilityAddTraits(['isSelected'])] : []),
              ]}
            >
              <SwiftUIText
                modifiers={[
                  font({ size: 14, weight: selected ? 'semibold' : 'medium' }),
                  foregroundStyle(iosColors?.label ?? 'primary'),
                  frame({ maxWidth: Infinity, maxHeight: Infinity }),
                  contentShape(shapes.rectangle()),
                ]}
              >
                {option.label}
              </SwiftUIText>
            </Button>
          );
        })}
      </HStack>
    </ZStack>
  );
}
