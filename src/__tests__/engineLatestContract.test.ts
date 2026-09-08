import { parseDeviceGroupChoices } from '@/platform/engine/deviceTrust';
import { buildDeviceTrustDecisionView } from '@/features/space/deviceTrustPresentation';

const device = (id: string) => ({ device_id: id, display_name: id });
const option = {
  choice_id: 'selected',
  is_current_group: false,
  requires_re_pairing: false,
  member_device_ids: ['phone', 'laptop', 'tablet'],
  members_complete: true,
  members: [
    { ...device('phone'), is_local: true, active: true },
    {
      ...device('laptop'),
      display_name: 'Work laptop',
      is_local: false,
      active: true,
    },
    {
      ...device('tablet'),
      display_name: 'Tablet',
      is_local: false,
      active: true,
    },
  ],
  source_device_ids: ['laptop'],
  impact: {
    sync_scope_device_ids: ['phone', 'laptop', 'tablet'],
    paused_device_ids: ['desktop'],
    pending_confirmation_device_ids: ['tablet'],
    requires_rejoin_device_ids: ['desktop'],
    local_device_outcome: 'active',
  },
};
const reason = {
  kind: 'pending_removal',
  details_complete: true,
  changes: [
    {
      side: 'remote',
      kind: 'removed_device',
      actor: device('laptop'),
      target: device('desktop'),
    },
  ],
  decisions: [
    {
      device: device('tablet'),
      decision: 'rejected',
      target: device('desktop'),
    },
  ],
};
function payload(choice: unknown = option) {
  return {
    revision: 12,
    device_trust: {
      revision: 12,
      local_device_id: 'phone',
      local_membership: 'active',
      current_change: null,
      devices: [],
      recovery: 'not_available_in_this_version',
      allowed_actions: [],
      blocked_reason: null,
      updated_at_ms: 123,
    },
    issues: [{ issue_id: 'conflict', reason, choices: [choice] }],
  };
}
const parse = (choice?: unknown) =>
  parseDeviceGroupChoices({ ok: true, value: JSON.stringify(payload(choice)) });

it('uses Engine impact and member names instead of guessing from the roster', () => {
  const view = buildDeviceTrustDecisionView(parse());
  expect(view?.choices[0]).toMatchObject({
    continueSyncNames: ['Work laptop'],
    stopSyncNames: ['desktop'],
    requiresRejoinNames: ['desktop'],
    pendingConfirmationNames: ['Tablet'],
    exitsCurrentSpace: false,
  });
});

it('requires confirmation when the chosen group removes this phone', () => {
  const view = buildDeviceTrustDecisionView(
    parse({
      ...option,
      impact: { ...option.impact, local_device_outcome: 'removed' },
    })
  );
  expect(view?.choices[0].exitsCurrentSpace).toBe(true);
});

it('preserves the verified explanation and source devices', () => {
  const issue = parse().groupChoices?.issues[0];
  expect(issue).toMatchObject({
    reason: {
      kind: 'pending_removal',
      detailsComplete: true,
      changes: [{ actor: { deviceId: 'laptop' }, target: { deviceId: 'desktop' } }],
      decisions: [{ decision: 'rejected' }],
    },
    choices: [{ sourceDeviceIds: ['laptop'] }],
  });
  expect(buildDeviceTrustDecisionView(parse())?.reasonLines).toEqual([
    { key: 'space.deviceTrust.reason.pending_removal' },
    {
      key: 'space.deviceTrust.reason.removed_device',
      values: { actor: 'Work laptop', target: 'desktop' },
    },
    {
      key: 'space.deviceTrust.reason.rejected',
      values: { actor: 'Tablet', target: 'desktop' },
    },
  ]);
});

it('does not infer synchronization impact when Engine cannot provide it', () => {
  const view = buildDeviceTrustDecisionView(parse({ ...option, impact: null }));
  expect(view?.choices[0]).toMatchObject({
    continueSyncNames: [],
    stopSyncNames: [],
    membersComplete: false,
  });
});

it('disambiguates candidate names even when those devices are absent from the roster', () => {
  const view = buildDeviceTrustDecisionView(parse({
    ...option,
    members: option.members.map((member) => ({ ...member, display_name: 'Work' })),
  }));
  expect(view?.choices[0].continueSyncNames).toEqual(['Work · laptop']);
  expect(view?.choices[0].pendingConfirmationNames).toEqual(['Work · tablet']);
});

it('keeps incomplete explanations explicit', () => {
  const source = payload();
  source.issues[0].reason = { ...reason, details_complete: false };
  const result = parseDeviceGroupChoices({ ok: true, value: JSON.stringify(source) });
  expect(buildDeviceTrustDecisionView(result)?.reasonLines).toContainEqual({
    key: 'space.deviceTrust.reason.incomplete',
  });
});

it.each([
  { ...option, impact: { ...option.impact, local_device_outcome: 'future' } },
  { ...option, members: [{ ...option.members[0], active: 'yes' }] },
  {
    ...option,
    impact: { ...option.impact, pending_confirmation_device_ids: null },
  },
])('rejects malformed new fields', (choice) => {
  expect(() => parse(choice)).toThrow('Invalid device group choices');
});
