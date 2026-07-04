const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

const WEB_STUB = path.resolve(__dirname, 'web-stubs/empty.js');

// web 平台需要 stub 掉的原生模块名
const WEB_STUBBED_MODULES = new Set([
  'native-util',
  'native-timer',
  'clipboard-overlay',
  'sms-forwarder',
  'foreground-service',
  'shortcut',
  'signalr-client',
]);

// iOS 平台: 将 @expo/ui/jetpack-compose 重定向到 RN 原生组件 shim
const IOS_SHIMS = {
  '@expo/ui/jetpack-compose': path.resolve(__dirname, 'ios-shims/expo-ui-jetpack-compose.tsx'),
  '@expo/ui/jetpack-compose/modifiers': path.resolve(__dirname, 'ios-shims/expo-ui-jetpack-compose-modifiers.ts'),
};

const originalResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && WEB_STUBBED_MODULES.has(moduleName)) {
    return { type: 'sourceFile', filePath: WEB_STUB };
  }
  if (platform === 'ios' && IOS_SHIMS[moduleName]) {
    return { type: 'sourceFile', filePath: IOS_SHIMS[moduleName] };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
