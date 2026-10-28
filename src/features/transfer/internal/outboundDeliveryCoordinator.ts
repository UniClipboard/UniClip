import type {
  Device,
  EngineEvent,
  OutboundProgress,
  SendReport,
} from "@/platform/engine";

export interface OutboundDeliveryEventSource {
  subscribeEvents(subscriber: (event: EngineEvent) => void): () => void;
  listOutboundProgress(): Promise<OutboundProgress[]>;
  listDevices(): Promise<Device[]>;
}

export interface OutboundDeliveryOutcome {
  report: SendReport;
  completed: number;
  failed: number;
  cancelled: number;
  pending: number;
  reasons: string[];
}

/** Wait only for Engine snapshots. Events never establish delivery. */
export class OutboundDeliveryCoordinator {
  constructor(
    private readonly source: OutboundDeliveryEventSource,
    private readonly timeoutMs = 120_000,
  ) {}

  async run(
    send: () => Promise<SendReport>,
    targetDeviceIds: string[] = [],
  ): Promise<OutboundDeliveryOutcome> {
    const targetIds = new Set(
      targetDeviceIds.length > 0
        ? targetDeviceIds
        : (await this.source.listDevices())
            .filter((device) => !device.isLocal)
            .map((device) => device.deviceId),
    );
    let report: SendReport | null = null;
    let progress: OutboundProgress[] = [];
    let readable = false;
    let active = true;
    let dirty = false;
    let reading: Promise<void> | null = null;
    let finish!: (outcome: OutboundDeliveryOutcome) => void;
    const done = new Promise<OutboundDeliveryOutcome>((resolve) => {
      finish = resolve;
    });
    const collect = (): OutboundDeliveryOutcome => {
      const admitted =
        report!.totalAccepted + report!.totalDuplicate + report!.totalPending;
      const targets =
        admitted === 0
          ? []
          : progress.filter(
              (p) =>
                p.entryId === report!.entryId &&
                targetIds.has(p.targetDeviceId),
            );
      // The aggregate report cannot identify offline peers. Wait conservatively for the selected
      // target set rather than letting an unrelated historical target satisfy a recipient count.
      const expected = admitted === 0 ? 0 : Math.max(admitted, targetIds.size);
      // A partially failed/cancelled batch is settled only when no item remains unknown/running.
      const settled = (p: OutboundProgress) =>
        readable &&
        p.itemsRunning === 0 &&
        p.itemsWaiting === 0 &&
        p.itemsUnconfirmed === 0;
      const completed = targets.filter(
        (p) => settled(p) && p.state === "completed",
      ).length;
      const failed = targets.filter(
        (p) =>
          settled(p) &&
          (p.state === "failed" || p.state === "partially_failed"),
      ).length;
      const cancelled = targets.filter(
        (p) =>
          settled(p) &&
          (p.state === "cancelled" || p.state === "partially_cancelled"),
      ).length;
      return {
        report: report!,
        completed,
        failed,
        cancelled,
        pending: Math.max(0, expected - completed - failed - cancelled),
        reasons: targets.flatMap((p) =>
          p.items.flatMap((item) =>
            item.failureReason
              ? [item.failureReason]
              : item.cancellationReason
                ? [item.cancellationReason]
                : [],
          ),
        ),
      };
    };
    const refresh = (): Promise<void> => {
      dirty = true;
      if (reading) return reading;
      reading = (async () => {
        while (dirty && active && report) {
          dirty = false;
          try {
            progress = await this.source.listOutboundProgress();
            readable = true;
          } catch {
            readable = false;
      }
          if (!active) return;
          const outcome = collect();
          if (outcome.pending === 0) finish(outcome);
        }
      })().finally(() => {
        reading = null;
      });
      return reading;
    };
    const unsubscribe = this.source.subscribeEvents((event) => {
      if (
        event.type === "outboundProgressChanged" ||
        event.type === "refreshRequired" ||
        event.type === "peerPresenceChanged" ||
        event.type === "stateChanged"
      ) {
        if (report) void refresh();
        }
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    try {
      report = await send();
      // The wait deadline bounds the UI wait. It does not rewrite Engine state or cancel work.
      timeout = setTimeout(() => finish(collect()), this.timeoutMs);
      // A lost invalidation must not leave this short-lived delivery waiter permanently stale.
      poll = setInterval(() => {
        void refresh();
      }, 1000);
      void refresh();
      return await done;
    } finally {
      active = false;
      clearTimeout(timeout);
      clearInterval(poll);
      unsubscribe();
    }
  }
}
let sharedCoordinator: OutboundDeliveryCoordinator | null = null;
let sharedEventSource: OutboundDeliveryEventSource | null = null;
export function configureOutboundDeliveryCoordinator(
  source: OutboundDeliveryEventSource,
): void {
  if (sharedCoordinator)
    throw new Error(
      "The outbound delivery coordinator has already been created",
    );
  sharedEventSource = source;
}
export function getOutboundDeliveryCoordinator(): OutboundDeliveryCoordinator {
  if (!sharedCoordinator) {
    if (!sharedEventSource)
      throw new Error("The outbound delivery coordinator is not configured");
    sharedCoordinator = new OutboundDeliveryCoordinator(sharedEventSource);
  }
  return sharedCoordinator;
}
