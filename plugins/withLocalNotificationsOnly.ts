import { ConfigPlugin, createRunOncePlugin, withEntitlementsPlist } from 'expo/config-plugins';

const withLocalNotificationsOnly: ConfigPlugin = (config) =>
  withEntitlementsPlist(config, (entitlementsConfig) => {
    delete entitlementsConfig.modResults['aps-environment'];
    return entitlementsConfig;
  });

export default createRunOncePlugin(
  withLocalNotificationsOnly,
  'withLocalNotificationsOnly',
  '1.0.0'
);
