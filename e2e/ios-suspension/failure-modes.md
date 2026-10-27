# Suspension ownership failure modes

Record before the repair and before isolated execution.

1. A failed host close reports released=false, but native ends its background grant.
2. A grant expires before queued host work executes, and that work opens shared storage.
3. An admitted operation is mistaken for drained when a deadline or cancellation returns.
4. A deferred write from an old generation executes after resume in a new generation.
5. A diagnostic queue waits for a flock, then writes after storage admission closes.
6. A late diagnostic finish from an old operation creates a record in the new generation.
7. A keyboard HistoryLog retains SQLite descriptors after disappearance.
8. History fallback writes continue while the database owner is suspended.
9. History resumes eagerly or starts new writes from a task belonging to the prior visible session.
10. A stale host acknowledgement or expiration closes a newer foreground generation.
11. A runtime flock releases before Engine confirms resource shutdown.
12. A native storage operation remains active when the background grant ends.
13. A cancellation check races an actual disk mutation. Admission must cover the mutation itself.
14. Share or payload producers bypass the shared-storage admission owner.
15. A native dependency cycle or duplicate gate instance separates the app from its extensions' process-local storage boundary.

16. Quiescing or ShuttingDown is counted as completed even though runtime ownership remains held.

# Planned nonvisual E2E

Compile production lifecycle, diagnostics, shared-storage and extension-history sources. Use temporary SQLite/WAL data, synthetic rows, independent flock probes and process-local grant substitutes. Run the same acceptance sequence against the pinned baseline and working sources. Keep baseline compatibility adapters explicit. Preserve source hashes, compiler output, execution status and assertions. The baseline has no shared admission or history-close API; baseline adapters reproduce their absent behavior, not an Engine implementation.

No result establishes the descriptor in the original 0xdead10cc reports. No result establishes real UIKit or Rust Engine resource release.

# Additional keyboard diagnostic owner

The KeyboardDiagnostics class at the end of KeyboardModel.swift writes keyboard.jsonl through its own serial queue. It does not use NativeRuntimeDiagnostics. Failure modes include records accepted after disappearance and queued records from an earlier visible generation that write after resume. The host replay extracts that production class. The replay adapts only its container URL, constructor visibility and queue barriers so all I/O stays in temporary data. It does not compile or execute UIKit/KeyboardModel.

# Analytics storage owner

AppleAnalyticsStore also writes App Group queue files. Enumerated failures: queue append after suspension, queue removal after suspension, and an old network acknowledgement that resumes file mutation in a new generation. Test the real temporary queue and defaults without a project key or external network request. Delivery callbacks must retain their original generation. Engine protocol error types must remain unchanged.
