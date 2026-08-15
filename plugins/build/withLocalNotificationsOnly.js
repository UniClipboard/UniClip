"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_plugins_1 = require("expo/config-plugins");
const withLocalNotificationsOnly = (config) => (0, config_plugins_1.withEntitlementsPlist)(config, (entitlementsConfig) => {
    delete entitlementsConfig.modResults['aps-environment'];
    return entitlementsConfig;
});
exports.default = (0, config_plugins_1.createRunOncePlugin)(withLocalNotificationsOnly, 'withLocalNotificationsOnly', '1.0.0');
