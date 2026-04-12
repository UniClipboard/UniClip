import { registerRootComponent } from 'expo';
import { AppRegistry } from 'react-native';

import App from './App';
import QuickActionApp from './src/QuickActionApp';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

// Separate entry point for the transparent QuickActionActivity
AppRegistry.registerComponent('quickAction', () => QuickActionApp);
