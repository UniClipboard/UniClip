# PostHog mobile logs: phase one

Related issue: https://github.com/UniClipboard/UniClip/issues/22

## Scope

This phase connects reviewed application diagnostics to PostHog Logs through the
existing React Native PostHog client. It does not enable Engine remote diagnostics,
native crash reporting, session replay, or distributed tracing. A log level named
`trace` is not a distributed trace.

The existing scoped application logger continues to write local logs. Only literal
messages listed in `src/support/observability/internal/postHogLogs.ts` are offered
to PostHog. These cover pairing failures, Engine startup/event failures, peer
recovery, and selected clipboard failures. Unknown sources, dynamic messages,
raw exception messages, stack traces, arbitrary identifiers, and unreviewed fields
are excluded. This intentionally does not upload every local log line.

Allowed attributes are the reviewed source, bounded numeric counts, a numeric
Engine error code, a fixed operation stage, and whether a space already existed.
The SDK adds its normal anonymous identity/session context and platform metadata.
The same filtering is applied at the SDK boundary.

## Configuration and behavior

- Reuses `POSTHOG_PROJECT_KEY` injected by the existing native config plugin.
  There is no project key or personal API key in application source.
- Uses the existing analytics consent and identity, with updated settings text
  describing anonymous diagnostics. Disabled consent or a missing project key
  prevents client creation. Early startup logs before consent is loaded are not
  buffered by the application.
- Service name: `uniclip-mobile`; version from the installed application;
  environment: `development` or `production`; OS metadata supplied by the SDK.
- Normal log-level settings apply. Debug output remains local.
- SDK batching: 10-second interval, 50-record batch/buffer threshold, and a
  100-record/10-second rate cap. The SDK bounds its queue and retries network
  failures. This is best-effort diagnosis, not lossless delivery.
- Disabling consent detaches the client, clears its queues before shutdown, and
  clears persisted pending data even if shutdown rejects. Resetting identity
  clears queued logs along with existing analytics queues.
- Application logs and exported diagnostic archives retain their existing behavior.

## Verification

The focused checks exercise the real installed `posthog-react-native` SDK with an
intercepted network boundary. They decompress and inspect its actual outgoing
payload and confirm the Logs endpoint, service metadata, content filtering,
retry behavior, opt-out queue cleanup, and identity reset. Separate checks cover
the application logger, log levels, failure isolation, and persistence failures.

Existing application-start, space, Engine-event, local-redaction, and log-export
checks are also run. TypeScript and lint checks cover the changed source.

An iOS simulator loaded the updated application modules. Its installed native
configuration returned an empty PostHog project key, so it correctly did not
enable remote collection. Cloud receipt has not yet been verified. Following the
request to configure PostHog directly, project 416399 (`Default project`) was
configured in the ignored local `.env.local` file. Expo config introspection
confirmed both iOS and Android receive the same nonempty project token. The
iOS development app was subsequently rebuilt and installed on the physical
iPhone. `devicectl` confirmed `app.uniclipboard.UniClipboard.dev` is version
`2.0.0` build `179`; the production app remains `2.0.0` build `178`. The built
main app, share extension, and keyboard extension all contain the matching
PostHog project token and version `2.0.0` build `179`. The updated app was launched
successfully. Android installation and cloud receipt remain unverified.

The iOS installation script now regenerates native configuration before building
and refreshes CocoaPods after preparing the Engine. An apple-targets compatibility
patch preserves the configuration-list reference while updating existing extension
targets; the unpatched code failed during repeated prebuild. Five focused script
checks passed, and the physical-device build completed with zero errors or warnings.

## Cloud acceptance still required

1. For Android, regenerate the native development project and rebuild using
   `POSTHOG_PROJECT_KEY` from the configured local environment. iOS is installed.
2. With consent enabled, trigger a supported diagnostic through an actual app
   action, then find the record under service `uniclip-mobile` in PostHog Logs.
3. Verify the received platform/version, allowed fields, and absence of clipboard
   contents or names. Repeat on Android and iOS.
4. Turn consent off with pending logs, then on again; confirm those pending
   records do not arrive. Test offline recovery and background transitions.

Do not close issue #22 based on this phase: Engine logs and complete pairing/sync
traces are separate remaining work.

Official SDK documentation:
https://posthog.com/docs/logs/installation/react-native
