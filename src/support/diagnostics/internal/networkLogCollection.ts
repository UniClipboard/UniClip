import { File, FileMode } from "expo-file-system";
import {
  prepareNetworkLogExport,
  releaseNetworkLogExport,
  type NetworkLogExport,
  type NetworkLogResult,
} from "uc-engine";

/** Network log segments are bounded by the Engine budget; this only guards a runaway file. */
const MAX_NETWORK_LOG_BYTES_PER_FILE = 32 * 1024 * 1024;

export type NetworkLogCollectionStatus =
  | "included"
  | "partial"
  | "missing"
  | "notConfigured"
  | "unsupported"
  | "unavailable";

export interface NetworkLogCollection {
  /** Archive entries keyed by path. The bytes are exactly what the Engine wrote. */
  entries: Record<string, Uint8Array>;
  manifest: Record<string, unknown>;
  /** The user should be told the network evidence may be incomplete. */
  incomplete: boolean;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("Diagnostic archive creation was aborted");
  error.name = "AbortError";
  throw error;
}

function readStagedFile(uri: string, expectedBytes: number): Uint8Array {
  const file = new File(uri);
  const handle = file.open(FileMode.ReadOnly);
  try {
    const size = handle.size ?? 0;
    if (size !== expectedBytes || size > MAX_NETWORK_LOG_BYTES_PER_FILE)
      throw new Error("staged size mismatch");
    return handle.readBytes(size);
  } finally {
    handle.close();
  }
}

/**
 * Collects the network-library log as its own evidence source.
 *
 * Network files are written by the Engine after its own privacy filter, so they are copied
 * byte for byte: redacting or truncating them would break the SHA-256 the manifest lists.
 * Only the exporting process is flushed; the manifest says so rather than implying that the
 * keyboard extension's log is current.
 */
export async function collectNetworkLogs(
  signal?: AbortSignal
): Promise<NetworkLogCollection> {
  throwIfAborted(signal);
  let result: NetworkLogResult<NetworkLogExport>;
  try {
    result = await prepareNetworkLogExport();
  } catch {
    result = { ok: false, error: "internal" };
  }
  throwIfAborted(signal);

  const base = {
    source: "engineNetworkLog",
    flushScope: "currentProcessOnly",
    otherProcessesFlushed: false,
  };
  if (!result.ok) {
    const status: NetworkLogCollectionStatus =
      result.error === "notConfigured"
        ? "notConfigured"
        : result.error === "unsupported"
        ? "unsupported"
        : "unavailable";
    return {
      entries: {},
      // Not configured and unsupported are states, not failures: no log was ever promised.
      incomplete: status === "unavailable",
      manifest: {
        ...base,
        status,
        error: result.error,
        configuration: result.configuration ?? null,
        files: [],
      },
    };
  }

  const exported = result.value;
  const entries: Record<string, Uint8Array> = {};
  const files: Array<Record<string, unknown>> = [];
  let unreadable = exported.unreadableFileCount;
  try {
    for (const file of exported.files) {
      throwIfAborted(signal);
      const path = `logs/network/${file.role}/${file.runId}/${file.name}`;
      const record = {
        path,
        role: file.role,
        runId: file.runId,
        name: file.name,
        bytes: file.bytes,
        sha256: file.sha256,
        isCurrentRun: file.isCurrentRun,
        engineCheck: file.engineCheck,
      };
      try {
        entries[path] = readStagedFile(file.uri, file.bytes);
        files.push({ ...record, included: true });
      } catch {
        unreadable += 1;
        files.push({ ...record, included: false });
      }
    }
  } finally {
    if (exported.exportId)
      await releaseNetworkLogExport(exported.exportId).catch(() => undefined);
  }

  const engine = exported.engine;
  const flushFailed = engine !== null && engine.flush !== "completed";
  // An export the Engine could not flush has no trustworthy current-run bytes, whatever the disk holds.
  const engineMissing =
    engine === null && exported.engineError !== "notConfigured";
  const mismatched = exported.files.some(
    (file) => file.engineCheck === "mismatch"
  );
  const includedCount = Object.keys(entries).length;
  const problems =
    unreadable > 0 ||
    flushFailed ||
    engineMissing ||
    mismatched ||
    !exported.rootAvailable;
  const status: NetworkLogCollectionStatus =
    includedCount === 0
      ? problems
        ? "unavailable"
        : exported.engineError === "notConfigured"
        ? "notConfigured"
        : "missing"
      : problems
      ? "partial"
      : "included";

  return {
    entries,
    incomplete: problems,
    manifest: {
      ...base,
      status,
      engineError: exported.engineError,
      rootAvailable: exported.rootAvailable,
      flushStatus:
        engine === null
          ? "notAttempted"
          : engine.flush === "completed"
          ? "completed"
          : "incomplete",
      // Counters are what the Engine observed: a missing file is not proof that no packet arrived.
      engine: engine && {
        flush: engine.flush,
        requestedAtUtc: engine.requestedAtUtc,
        completedAtUtc: engine.completedAtUtc,
        otherProcessesFlushed: engine.otherProcessesFlushed,
        status: engine.status,
        reportedFiles: engine.files,
      },
      discoveredRunCount: exported.discoveredRunCount,
      skippedEntryCount: exported.skippedEntryCount,
      unreadableFileCount: unreadable,
      includedFileCount: includedCount,
      files,
    },
  };
}
