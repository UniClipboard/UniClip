# Share device progress acceptance

Both platform Share pages remove `OutboundResultsSection`. Each selected destination owns one progress background. The background uses the current Share session's exact Engine entry and target identifiers.

P2P files and large images publish their entry identifier before the delivery wait. The Share controller reads complete Engine snapshots while the sheet remains visible. Multiple jobs contribute to one byte-weighted progress value per destination. Integer arithmetic preserves native decimal u64 values.

A complete byte count shows a confirmation state. Only a confirmed terminal result shows success. Unknown counts show an activity indicator. Failed or unconfirmed destinations keep their status in the same row. Completion stays visible until the user presses Done.

LAN retains its existing single-attempt HTTP transport. This transport does not publish byte progress. LAN rows show an activity indicator until each server returns a result. The implementation does not simulate a percentage or replace the transport. A missing acknowledgement remains unconfirmed.

## Replay

From the repository root, use the Node version in `.nvmrc`:

```sh
node e2e/share-device-progress/run.cjs
node e2e/outbound-progress/run-share.cjs /tmp/share-existing-replay.json
node e2e/outbound-progress/run.cjs /tmp/outbound-existing-replay.json
```

The first command writes these reproducible artifacts under `e2e/results/share-device-progress/`:

- `receipt.json`: checks and SHA-256 hashes of the product source.
- `android-tree.json`: the production Android component tree with progress.
- `ios-tree.json`: the production iOS component tree with progress.

The replay executes the real Share controller, P2P content service, P2P adapter, delivery coordinator, LAN adapter, and platform React renderers. Native transport and rendering boundaries are controlled. It covers progress before send completion, target isolation, file weighting, exact u64 arithmetic, unknown counts, unavailable snapshots, confirmation, independent target outcomes, duplicate-send prevention, session reopening, full-row ownership, selection locking, and explicit completion.

## Review regression cases

Review `5733238726` identified percentage drift, padded hit-shape ordering, and
stale LAN retry results. The flow replay checks the visible platform rows at
29%, 57%, 28.99%, and 99.99%. It also checks SwiftUI modifier order and both queued
jobs during retries after unconfirmed and failed results.

Run a specific review case while retaining the original product-flow checks:

```sh
SHARE_REVIEW_CASE=rounding node e2e/share-device-progress/run.cjs /tmp/share-review-rounding
SHARE_REVIEW_CASE=hit-shape node e2e/share-device-progress/run.cjs /tmp/share-review-hit-shape
SHARE_REVIEW_CASE=retry node e2e/share-device-progress/run.cjs /tmp/share-review-retry
```

Before the fixes, the commands failed on the visible 29% label, the content
shape preceding padding, and retained target-result facts. The complete replay
now passes all cases. Modifier ordering does not certify native edge hit testing.

## Validation boundary

Type checking, lint, and Expo Hermes exports verify the TypeScript and both platform dependency graphs. They do not verify native layout or delivery.

Native simulator/device E2E, actual trailing-space hit testing, and real network transfers are **NOT RUN**. This checkout has no generated `ios/` or `android/` project. Build a current native artifact before running the existing disposable-device E2E environment. HTML prototype checks do not verify the application.

Existing Jest expectations now use explicit completion and allow send observer callbacks. This change adds no unit test cases. The replay checks the new behavior across the production flow.
