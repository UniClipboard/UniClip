# Keyboard LAN session lifecycle flow

This flow compiles the product Swift transport and sends real HTTP requests to a
loopback-only synthetic service. The fixture replaces settings, credentials,
clipboard models, history, and the keyboard owner. It does not use an App Group,
Engine, clipboard, device, simulator, or GUI.

## Failure modes

- A canceled publish can enter another candidate or a subsequent pull.
- A canceled pull can enter another candidate or another configured server.
- Stop can invalidate a session while an accepted operation awaits a response.
- Stop can win between an active check and task creation.
- A stopped owner can reopen clients unless admission is terminal.
- Configuration replacement can invalidate clients retained by an older operation.
- A payload request can continue to metadata or fallback after cancellation.
- Cancellation can arrive before request creation or during a receive sleep.
- Ordinary HTTP errors must retain candidate fallback.
- Authentication failure must stop candidate fallback.

## Run the flow

Use macOS with the Xcode command-line tools selected. Each output directory must
be new. The flow preserves artifacts instead of deleting them.

1. Run the current product source:

   ```sh
   python3 e2e/keyboard-lan-session/run.py --repeat 10 \
     --output e2e/results/keyboard-lan-session-current
   ```

2. Inspect `summary.json`. Require `passed: true` and exit status 0.
3. Inspect the per-case `trace.jsonl`, `server.json`, and `stderr.txt`.

To compare a historical source, add `--revision <commit>`. The known failing
baseline is `fcf68bfe917fc7a12a3c0696ac90b5463ae0b724`. That baseline must fail
the cancellation and lifecycle assertions.

## Assertions and artifacts

Each case runs in a separate process with a timeout. A server request marker
establishes the pending-request boundary before cancellation. The admission-race
case instead yields once and closes the transport.

The flow checks process completion, typed cancellation, task creation after
session invalidation, work admitted after cancel/hide, stopped-owner reuse,
configuration replacement, healthy delivery, and HTTP/authentication fallback.
Trace probes add unique session IDs, monotonic timestamps, and request events.
The output preserves the original source, probe diff, generated source, compiler
logs, executable, per-case logs, and a summary with source SHA256 and environment.

A macOS pass proves this transport flow with synthetic dependencies. It does not
prove the cause of historical iOS reports or acceptance of the full iOS extension.
