import * as nativeEngine from 'uc-engine';
import { parseDeviceTrustDecision, parseDeviceTrustSnapshot } from './deviceTrust';

const parsedNativeEngine = {
  ...nativeEngine,
  async queryDeviceTrust() {
    return parseDeviceTrustSnapshot(await nativeEngine.queryDeviceTrust());
  },
  async decideDeviceTrustChange(
    changeId: string,
    choice: nativeEngine.DeviceTrustChoice,
    confirmLocalRemoval: boolean
  ) {
    return parseDeviceTrustDecision(
      await nativeEngine.decideDeviceTrustChange(changeId, choice, confirmLocalRemoval)
    );
  },
};

export { parsedNativeEngine as nativeEngine };
export type * from 'uc-engine';
