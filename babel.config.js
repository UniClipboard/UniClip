module.exports = function (api) {
  // 平台敏感缓存:让 web/android 使用不同的 babel 配置
  const platform = api.caller((caller) => (caller && caller.platform) || 'unknown');
  api.cache.using(() => platform);
  const isWeb = platform === 'web';

  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['./src'],
          extensions: [
            '.web.tsx',
            '.web.ts',
            '.web.js',
            '.ios.js',
            '.android.js',
            '.js',
            '.ts',
            '.tsx',
            '.json',
          ],
          alias: {
            '@': './src',
            '@components': './src/components',
            '@screens': './src/screens',
            '@services': './src/services',
            '@stores': './src/stores',
            '@types': './src/types',
            '@utils': './src/utils',
            '@constants': './src/constants',
            '@navigation': './src/navigation',
            '@hooks': './src/hooks',
            '@assets': './src/assets',
            // web 平台跳过原生模块 alias,让 metro resolver 接管(映射到 stub)
            ...(isWeb
              ? {}
              : {
                  'android-util': './modules/android-util/src',
                  'app-group-store': './modules/app-group-store/src',
                  shortcut: './modules/shortcut/src',
                }),
          },
        },
      ],
      'react-native-reanimated/plugin',
    ],
    // jest(NODE_ENV=test)下把 `await import()` 转成 require,否则 Node vm 会因缺少
    // --experimental-vm-modules 抛错。仅影响测试,Metro/生产构建不走此分支。
    env: {
      test: {
        plugins: ['dynamic-import-node'],
      },
    },
  };
};
