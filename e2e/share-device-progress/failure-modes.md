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
