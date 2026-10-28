# Failure modes and acceptance
Record before implementation. Use only isolated temporary data.

- A stale binding or binary can compile against an old API. Verify exact source, network tree, binding and artifact hashes.
- Nullable bytes, phase, round, attempt and current can be lost. Preserve null across both bridges and TypeScript.
- u64 conversion can round a revision or byte count. Use exact decimal strings at the bridge.
- Events can arrive before send returns, arrive late, be lost or refer to an old attempt. Read complete snapshots; events only invalidate.
- A failed read can look like an empty result. Retain uncertainty and expose the read error; never infer success.
- Multiple targets or items can overwrite each other. Key snapshots by entry and target; retain item facts.
- Accepted headers or full bytes can look delivered. Only Engine item/batch terminal facts establish file completion.
- A local wait deadline can look failed. End the wait with pending/unconfirmed; do not rewrite Engine facts.
- Default resend can start another transfer. Pass false unless a separate explicit user confirmation selects eligible targets.
- Running, Superseded, Busy, Unreachable or authorization errors can be bypassed by confirmation. Keep Engine classification and current view; let Engine enforce policy.
- Foreground or event-stream recovery can reuse a stale projection. Read a complete list again.
- Pending/Failed cleanup can release an Android instance or service too early. Retain actual instance until Released; keep operation errors.
- iOS progress edits can replace PR96 owner work. Restrict changes to action/event/mapping hunks; leave integration gated.

Acceptance: replay real product projection/coordinator with controlled native boundary, preserve machine-readable receipts, separately compile real generated native bindings. Mark real App, devices, transitions and network changes NOT RUN.

Keyboard path audit: a legacy extension waiter can falsely finish on a transport event.
Replace its production call with direct complete snapshots. Read before waiting; re-read
on bounded event waits so lost hints do not certify success. Preserve unknown bytes and
never collapse unknown or partial batch results to delivery.

Share retry boundary: repeated sends in one live Share session must check the remembered
Engine entry instead of creating another transfer. Keep this mapping in memory only.
Do not change interrupted Share policy, queue claiming, expiration or close behavior.
