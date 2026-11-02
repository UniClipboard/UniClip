# Share device progress failure modes

Record before implementation. Run the actual Share controller, transport coordinator, and platform renderers with controlled native boundaries. Save a JSON receipt. Native hit testing and real transfers require a separate simulator/device run.

- A historical transfer or another target must not fill the selected device row.
- Progress must arrive before the send promise resolves.
- Unknown byte counts must remain indeterminate. Decimal u64 byte counts must not lose precision.
- Multiple jobs must contribute to each target's aggregate byte progress.
- Full bytes, a send admission, a stale snapshot, or a partial batch must not establish success.
- Different selected targets may complete or fail independently.
- A repeated send must reconcile the existing Engine entry and must not start a duplicate transfer.
- A read failure must preserve uncertainty instead of preserving a false success.
- Selection and refresh must remain locked during a send. The full row must remain the selection target before sending.
- Closing or reopening the sheet must not expose another session's progress.
- Both platforms must omit the results section and keep status in the target row.
- LAN transports without byte callbacks must show indeterminate progress and only show success after the request is acknowledged.
- Completion must remain visible until the user presses Done.

# React Doctor follow-up

Record before the row refactor. The state presentation must preserve selection,
percentage, activity, success, and warning markers on both platforms. Extracting
marker rendering must not move the press handler off the full row. Removing the
redundant session-target reset must preserve target freezing during a send and
replace the target snapshot before a subsequent send after reopening.

# Review 5733238726

Record before the fixes. The 1/10000 progress grid must display exact integer
percentages at 29% and 57% on both platform rows. Values below the next percentage
must still round down, and 99.99% must not display 100%.

SwiftUI must apply the row's rectangular content shape after its padding. The
geometry observer must continue measuring the padded row. The replay checks
modifier order; native edge hit testing remains a separate acceptance layer.

Each LAN retry must clear the previous attempt's target results and delivery
state before dispatch. A previously delivered, failed, or unconfirmed target must
show the current attempt's activity until a new target callback arrives. Retain
the P2P entry mapping and default reconciliation behavior.
