import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import {
  Column,
  Host,
  Icon,
  NavigationBar,
  NavigationBarItem,
  Shape,
  Surface,
  Text as ComposeText,
  useMaterialColors,
} from '@expo/ui/jetpack-compose';
import {
  clickable,
  fillMaxHeight,
  padding,
  testID,
  width,
} from '@expo/ui/jetpack-compose/modifiers';
import { useTheme } from '@/hooks/useTheme';
import type { MainTabParamList } from '@/navigation/AppNavigator.types';
import { MATERIAL_SEED_COLOR } from '@/theme/colors';
import { NAVIGATION_RAIL_WIDTH } from './mainNavigationMetrics';

const ICONS: Record<keyof MainTabParamList, number> = {
  Clipboard: require('../../assets/icons/content_paste.xml'),
  Devices: require('../../assets/icons/devices.xml'),
  Preferences: require('../../assets/icons/settings.xml'),
};

/** rail 活动指示器:56×32 药丸。 */
const INDICATOR_SHAPE = Shape.RoundedCorner({
  cornerRadii: { topStart: 16, topEnd: 16, bottomStart: 16, bottomEnd: 16 },
});
const RAIL_LABEL_STYLE = { fontSize: 12, fontWeight: '500' } as const;

interface MainNavigationBarProps extends BottomTabBarProps {
  /** 首页进入搜索 / 多选时让出底部空间;侧边 rail 不占底部,始终显示。 */
  hidden: boolean;
}

/**
 * Android 顶级导航(剪贴板 / 设备 / 设置)。作为 bottom-tabs 的自定义 tabBar:
 * 手机为底部 M3 NavigationBar(Compose 原生),平板(tabBarPosition=left)为左侧
 * navigation rail。标签文字取各 Tab.Screen 的 `title`。
 */
export function MainNavigationBar({
  state,
  descriptors,
  navigation,
  insets,
  hidden,
}: MainNavigationBarProps) {
  const { theme } = useTheme();
  const colorScheme = theme.isDark ? 'dark' : 'light';
  const colors = useMaterialColors({
    colorScheme,
    seedColor: MATERIAL_SEED_COLOR,
  });
  const focusedOptions = descriptors[state.routes[state.index].key].options;
  const isRail = focusedOptions.tabBarPosition === 'left';

  if (hidden && !isRail) return null;

  const items = state.routes.map((route, index) => {
    const name = route.name as keyof MainTabParamList;
    const label = descriptors[route.key].options.title ?? route.name;
    const selected = state.index === index;
    const onPress = () => {
      const event = navigation.emit({
        type: 'tabPress',
        target: route.key,
        canPreventDefault: true,
      });
      if (!selected && !event.defaultPrevented) navigation.navigate(route.name, route.params);
    };
    return { key: route.key, name, label, selected, onPress };
  });

  if (isRail) {
    return (
      <View
        style={[
          styles.rail,
          {
            backgroundColor: theme.colors.background,
            // rail 贴左缘纵贯全高:让出状态栏与横屏时的左侧系统栏
            paddingTop: insets.top,
            paddingLeft: insets.left,
            width: NAVIGATION_RAIL_WIDTH + insets.left,
          },
        ]}
      >
        <Host style={styles.fill} colorScheme={colorScheme} seedColor={MATERIAL_SEED_COLOR}>
          <Column
            horizontalAlignment="center"
            verticalArrangement={{ spacedBy: 12 }}
            modifiers={[width(NAVIGATION_RAIL_WIDTH), fillMaxHeight(), padding(0, 12, 0, 12)]}
          >
            {items.map((item) => (
              <Column
                key={item.key}
                horizontalAlignment="center"
                verticalArrangement={{ spacedBy: 4 }}
                modifiers={[
                  testID(`main-tab-${item.name}`),
                  width(NAVIGATION_RAIL_WIDTH),
                  clickable(item.onPress),
                  padding(0, 4, 0, 4),
                ]}
              >
                <Surface
                  color={item.selected ? colors.secondaryContainer : 'transparent'}
                  shape={INDICATOR_SHAPE}
                >
                  <Column modifiers={[padding(16, 4, 16, 4)]}>
                    <Icon
                      source={ICONS[item.name]}
                      size={24}
                      tint={item.selected ? colors.onSecondaryContainer : colors.onSurfaceVariant}
                    />
                  </Column>
                </Surface>
                <ComposeText
                  color={item.selected ? colors.onSurface : colors.onSurfaceVariant}
                  style={RAIL_LABEL_STYLE}
                >
                  {item.label}
                </ComposeText>
              </Column>
            ))}
          </Column>
        </Host>
      </View>
    );
  }

  return (
    <Host
      matchContents={{ vertical: true }}
      style={styles.bar}
      colorScheme={colorScheme}
      seedColor={MATERIAL_SEED_COLOR}
    >
      <NavigationBar>
        {items.map((item) => (
          <NavigationBarItem
            key={item.key}
            selected={item.selected}
            onClick={item.onPress}
            modifiers={[testID(`main-tab-${item.name}`)]}
          >
            <NavigationBarItem.Icon>
              <Icon source={ICONS[item.name]} size={24} />
            </NavigationBarItem.Icon>
            <NavigationBarItem.Label>
              <ComposeText>{item.label}</ComposeText>
            </NavigationBarItem.Label>
          </NavigationBarItem>
        ))}
      </NavigationBar>
    </Host>
  );
}

const styles = StyleSheet.create({
  bar: { width: '100%' },
  rail: { width: NAVIGATION_RAIL_WIDTH },
  fill: { flex: 1 },
});
