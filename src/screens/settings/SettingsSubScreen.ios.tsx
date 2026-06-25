/**
 * 二级设置页 — iOS 占位。
 *
 * iOS 的设置页(SettingsScreen.ios.tsx)是独立的单页 transparentModal 实现,不走二级路由。
 * 这里仅提供一个空组件让共享的 AppNavigator 在 iOS 也能注册 SettingsSub 路由而不报错
 * (不会被导航到)。
 */
export const SettingsSubScreen = () => null;
