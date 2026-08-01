/**
 * Web 入口 —— 仅注册主 App,跳过 Android 快捷入口和服务恢复入口。
 */

import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);
