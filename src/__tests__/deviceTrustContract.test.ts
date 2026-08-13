import { parseDeviceTrustDecision, parseDeviceTrustSnapshot } from '../platform/engine/deviceTrust';

function snapshotJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    revision: 7,
    local_device_id: 'phone-1',
    local_membership: 'active',
    current_change: {
      change_id: 'change-1',
      proposed_by_device_id: 'desktop-1',
      target_device_ids: ['tablet-1'],
      includes_local_device: false,
      apply_impact: {
        usable_device_ids: ['phone-1', 'desktop-1'],
        paused_device_ids: ['tablet-1'],
        local_device_outcome: 'active',
        requires_rejoin_device_ids: ['tablet-1'],
      },
      keep_current_impact: {
        usable_device_ids: ['phone-1', 'tablet-1'],
        paused_device_ids: ['desktop-1'],
        local_device_outcome: 'active',
        requires_rejoin_device_ids: ['desktop-1'],
      },
      allowed_choices: ['apply_change', 'keep_current_device_group'],
      blocked_reason: null,
    },
    devices: [
      {
        device_id: 'desktop-1',
        display_name: 'Desktop',
        is_local: false,
        reachability: 'online',
        membership: 'active',
        group_relationship: 'pending_local_decision',
        compatibility: 'compatible',
        sync_relationship: 'waiting_for_local_decision',
        available_actions: ['apply_current_change'],
        blocked_reason: null,
      },
    ],
    recovery: 'not_available_in_this_version',
    allowed_actions: ['apply_current_change', 'keep_current_device_group'],
    blocked_reason: null,
    updated_at_ms: 123456,
    ...overrides,
  });
}

describe('device trust Engine contract', () => {
  it('parses a complete Engine snapshot into the application contract', () => {
    expect(parseDeviceTrustSnapshot(snapshotJson())).toEqual(
      expect.objectContaining({
        revision: 7,
        localDeviceId: 'phone-1',
        localMembership: 'active',
        updatedAtMs: 123456,
        currentChange: expect.objectContaining({
          changeId: 'change-1',
          proposedByDeviceId: 'desktop-1',
          allowedChoices: ['applyChange', 'keepCurrentDeviceGroup'],
          applyImpact: expect.objectContaining({ pausedDeviceIds: ['tablet-1'] }),
        }),
        devices: [
          expect.objectContaining({
            deviceId: 'desktop-1',
            groupRelationship: 'pendingLocalDecision',
            syncRelationship: 'waitingForLocalDecision',
          }),
        ],
      })
    );
  });

  it.each([
    ['unknown enum', { local_membership: 'maybe' }],
    ['missing field', { local_device_id: undefined }],
    ['invalid revision', { revision: -1 }],
  ])('rejects an Engine snapshot with %s', (_label, overrides) => {
    expect(() => parseDeviceTrustSnapshot(snapshotJson(overrides))).toThrow(
      'Invalid device trust snapshot'
    );
  });

  it.each([
    ['applied', 'applied'],
    ['kept_current_device_group', 'keptCurrentDeviceGroup'],
    ['already_completed', 'alreadyCompleted'],
    ['state_changed', 'stateChanged'],
    ['local_device_confirmation_required', 'localDeviceConfirmationRequired'],
  ] as const)('parses the %s decision result', (kind, expectedKind) => {
    const result = parseDeviceTrustDecision(
      JSON.stringify({
        kind,
        change_id: 'change-1',
        completed_choice: kind === 'already_completed' ? 'apply_change' : undefined,
        current_change_id: kind === 'state_changed' ? 'change-2' : undefined,
        snapshot: JSON.parse(snapshotJson()),
      })
    );

    expect(result.kind).toBe(expectedKind);
    expect(result.snapshot.revision).toBe(7);
  });

  it('rejects an unknown decision result without exposing a partial snapshot', () => {
    expect(() =>
      parseDeviceTrustDecision(
        JSON.stringify({ kind: 'future_result', snapshot: JSON.parse(snapshotJson()) })
      )
    ).toThrow('Invalid device trust decision');
  });
});
