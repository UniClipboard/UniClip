import type { EngineFailure, OutboundProgress } from "@/platform/engine";

export interface OutboundProgressSnapshot {
  progress: OutboundProgress[];
  available: boolean;
  error: boolean;
  failure: EngineFailure | null;
}

/** In-memory Engine projection. A read failure never becomes an empty successful view. */
export class OutboundProgressProjection {
  private snapshot: OutboundProgressSnapshot = {
    progress: [],
    available: false,
    error: false,
    failure: null,
  };
  private running: Promise<void> | null = null;
  private invalidated = false;
  private epoch = 0;

  constructor(
    private readonly read: () => Promise<OutboundProgress[]>,
    private readonly publish: (
      snapshot: OutboundProgressSnapshot,
    ) => void = () => {},
  ) {}

  reset(): void {
    ++this.epoch;
    this.snapshot = {
      progress: [],
      available: false,
      error: false,
      failure: null,
    };
  }

  getSnapshot(): OutboundProgressSnapshot {
    return this.snapshot;
  }

  refresh(): Promise<void> {
    this.invalidated = true;
    if (this.running) return this.running;
    this.running = this.drain().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async drain(): Promise<void> {
    while (this.invalidated) {
      this.invalidated = false;
      const epoch = this.epoch;
      try {
        const progress = await this.read();
        if (epoch !== this.epoch) continue;
        this.snapshot = {
          progress,
          available: true,
          error: false,
          failure: null,
        };
      } catch (error) {
        if (epoch !== this.epoch) continue;
        const failure =
          error !== null &&
          typeof error === "object" &&
          "code" in error &&
          typeof error.code === "number" &&
          "category" in error &&
          typeof error.category === "string" &&
          "retryable" in error &&
          typeof error.retryable === "boolean"
            ? {
                code: error.code,
                category: error.category,
                retryable: error.retryable,
              }
            : null;
        this.snapshot = {
          ...this.snapshot,
          available: false,
          error: true,
          failure,
        };
      }
      this.publish(this.snapshot);
    }
  }
}
