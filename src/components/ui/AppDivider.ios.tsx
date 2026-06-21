import { View, StyleSheet, type ColorValue } from 'react-native';

export interface AppDividerProps {
  color?: ColorValue;
  thickness?: number;
}

export function AppDivider({ color, thickness }: AppDividerProps) {
  return (
    <View
      style={{
        height: thickness ?? StyleSheet.hairlineWidth,
        alignSelf: 'stretch',
        backgroundColor: color ?? '#C6C6C8',
      }}
    />
  );
}
