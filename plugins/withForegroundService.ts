import { ConfigPlugin, withAndroidManifest } from 'expo/config-plugins';

const withForegroundService: ConfigPlugin = (config) => {
  return withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults.manifest;

    // Add FOREGROUND_SERVICE permission
    if (!manifest['uses-permission']) {
      manifest['uses-permission'] = [];
    }
    const permissions = manifest['uses-permission'];

    const addPermission = (name: string) => {
      if (
        !permissions.some(
          (p: { $?: { 'android:name'?: string } }) => p.$?.['android:name'] === name
        )
      ) {
        permissions.push({ $: { 'android:name': name } });
        console.log(`✅ Added permission: ${name}`);
      }
    };

    addPermission('android.permission.FOREGROUND_SERVICE');
    // The service keeps a live peer-to-peer link to the user's own devices over the local network
    // (mDNS discovery plus direct connections), which is what connectedDevice describes. dataSync
    // would impose a 6 h/24 h budget on Android 15+ and cannot be started from BOOT_COMPLETED.
    addPermission('android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE');
    // Required by the foreground service type, and by the multicast lock mDNS discovery needs.
    addPermission('android.permission.CHANGE_WIFI_MULTICAST_STATE');

    // Register Service in <application>
    const application = manifest.application?.[0];
    if (application) {
      if (!application.service) {
        application.service = [];
      }
      const serviceClassName = 'expo.modules.foregroundservice.SyncForegroundService';
      if (
        !application.service.some(
          (s: { $?: { 'android:name'?: string } }) => s.$?.['android:name'] === serviceClassName
        )
      ) {
        application.service.push({
          $: {
            'android:name': serviceClassName,
            'android:enabled': 'true',
            'android:exported': 'false',
            'android:foregroundServiceType': 'connectedDevice',
          },
        });
        console.log(`✅ Registered service: ${serviceClassName}`);
      }
    }

    return modConfig;
  });
};

export default withForegroundService;
