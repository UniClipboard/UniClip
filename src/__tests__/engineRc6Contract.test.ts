import {
  parseDeviceGroupChoices,
  parseDeviceGroupChoiceResult,
} from '../platform/engine/deviceTrust';
import {
  buildDeviceTrustDecisionView,
  buildDeviceTrustDeviceViews,
} from '../features/space/deviceTrustPresentation';

const device = {
  device_id: 'phone',
  display_name: 'Phone',
  is_local: true,
  reachability: 'online',
  membership: 'active',
  group_relationship: 'confirmation_pending',
  compatibility: 'compatible',
  sync_relationship: 'unknown',
  available_actions: [],
  blocked_reason: null,
};
const trust = {
  revision: 7,
  local_device_id: 'phone',
  local_membership: 'active',
  current_change: null,
  devices: [device],
  recovery: 'not_available_in_this_version',
  allowed_actions: [],
  blocked_reason: null,
  updated_at_ms: 123,
};
const choices = {
  revision: 12,
  device_trust: trust,
  issues: [
    {
      issue_id: 'conflict-opaque',
      choices: [
        {
          choice_id: 'local-opaque',
          is_current_group: true,
          requires_re_pairing: false,
          member_device_ids: ['phone'],
          members_complete: true,
        },
        {
          choice_id: 'other-opaque',
          is_current_group: false,
          requires_re_pairing: true,
          member_device_ids: [],
          members_complete: false,
        },
      ],
    },
  ],
};

describe('Engine rc.6 device groups', () => {
  it('preserves opaque choices and the choice revision independently of device trust', () => {
    const result = parseDeviceGroupChoices({ ok: true, value: JSON.stringify(choices) });
    expect(result.revision).toBe(7);
    expect(result.groupChoices).toEqual({
      revision: 12,
      issues: [
        {
          issueId: 'conflict-opaque',
          choices: [
            {
              choiceId: 'local-opaque',
              isCurrentGroup: true,
              requiresRePairing: false,
              memberDeviceIds: ['phone'],
              membersComplete: true,
            },
            {
              choiceId: 'other-opaque',
              isCurrentGroup: false,
              requiresRePairing: true,
              memberDeviceIds: [],
              membersComplete: false,
            },
          ],
        },
      ],
    });
    const view = buildDeviceTrustDecisionView(result);
    expect(view?.changeId).toBe('conflict-opaque');
    expect(view?.choices.map((c) => c.choice)).toEqual(['local-opaque', 'other-opaque']);
    expect(view?.choices[1]).toMatchObject({ membersComplete: false, exitsCurrentSpace: true });
  });

  it('does not label unconfirmed membership as ready to sync', () => {
    const result = parseDeviceGroupChoices({
      ok: true,
      value: JSON.stringify({
        ...choices,
        device_trust: { ...trust, devices: [{ ...device, sync_relationship: 'usable' }] },
      }),
    });
    expect(buildDeviceTrustDeviceViews(result, [])[0]).toMatchObject({
      primaryStatus: 'updating',
      canSync: false,
      canRemove: false,
    });
  });

  it.each([
    'pending',
    're_pairing_required',
    'state_changed',
    'local_device_confirmation_required',
    'completed',
    'already_completed',
  ])('preserves outcome %s without claiming completion', (outcome) => {
    expect(
      parseDeviceGroupChoiceResult(JSON.stringify({ outcome, current_revision: 13 }))
    ).toMatchObject({ currentRevision: 13 });
  });

  it('rejects invalid or ambiguous choices', () => {
    expect(() =>
      parseDeviceGroupChoices({ ok: true, value: JSON.stringify({ ...choices, revision: -1 }) })
    ).toThrow();
    expect(() =>
      parseDeviceGroupChoices({
        ok: true,
        value: JSON.stringify({ ...choices, issues: [choices.issues[0], choices.issues[0]] }),
      })
    ).toThrow();
    expect(() =>
      parseDeviceGroupChoiceResult('{"outcome":"future","current_revision":null}')
    ).toThrow();
  });
});

it('invalidates a reviewed choice when the same issue gets a new revision', () => {
  const { initialDeviceTrustChoice } = require('../features/space/deviceTrustPresentation');
  const before = parseDeviceGroupChoices({ ok: true, value: JSON.stringify(choices) });
  const selected = initialDeviceTrustChoice(before, null, null);
  const after = parseDeviceGroupChoices({
    ok: true,
    value: JSON.stringify({ ...choices, revision: 13 }),
  });
  expect(initialDeviceTrustChoice(after, selected.changeId, 'local-opaque').choice).toBeNull();
});
