import * as nativeEngine from 'uc-engine';
import {
  parseDeviceGroupChoiceResult,
  parseDeviceGroupChoices,
  type DeviceTrustDecision,
} from './deviceTrust';

const parsedNativeEngine = {
  ...nativeEngine,
  async queryDeviceTrust() {
    return parseDeviceGroupChoices(await nativeEngine.queryDeviceGroupChoices());
  },
  async decideDeviceTrustChange(
    issueId: string,
    choiceId: string,
    confirmLocalRemoval: boolean,
    expectedRevision: number
  ): Promise<DeviceTrustDecision> {
    const result = parseDeviceGroupChoiceResult(
      await nativeEngine.chooseDeviceGroup(issueId, choiceId, expectedRevision, confirmLocalRemoval)
    );
    const snapshot = await parsedNativeEngine.queryDeviceTrust();
    switch (result.outcome) {
      case 'alreadyCompleted':
        return { kind: result.outcome, changeId: issueId, completedChoice: choiceId, snapshot };
      case 'stateChanged':
        return {
          kind: result.outcome,
          currentChangeId: snapshot.groupChoices?.issues[0]?.issueId ?? null,
          snapshot,
        };
      case 'localDeviceConfirmationRequired':
        return { kind: result.outcome, changeId: issueId, snapshot };
      default:
        return { kind: result.outcome, snapshot };
    }
  },
};

export { parsedNativeEngine as nativeEngine };
export type * from 'uc-engine';
