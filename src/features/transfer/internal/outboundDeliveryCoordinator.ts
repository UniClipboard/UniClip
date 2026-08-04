import type { EngineEvent, SendReport } from '@/platform/engine';

export interface OutboundDeliveryEventSource {
  subscribeEvents(subscriber: (event: EngineEvent) => void): () => void;
}

export interface OutboundDeliveryOutcome {
  report: SendReport;
  completed: number;
  failed: number;
  cancelled: number;
  pending: number;
  reasons: string[];
}

interface OutboundTransfer {
  entryId: string;
  peerId: string;
}

interface TerminalTransfer {
  entryId: string;
  peerId: string;
  status: 'completed' | 'failed' | 'cancelled';
  reason: string | null;
}

const DEFAULT_OUTBOUND_DELIVERY_TIMEOUT_MS = 120_000;

export class OutboundDeliveryCoordinator {
  constructor(
    private readonly events: OutboundDeliveryEventSource,
    private readonly timeoutMs = DEFAULT_OUTBOUND_DELIVERY_TIMEOUT_MS
  ) {}

  async run(send: () => Promise<SendReport>): Promise<OutboundDeliveryOutcome> {
    const outboundTransfers = new Map<string, OutboundTransfer[]>();
    const terminalTransfers = new Map<string, TerminalTransfer>();
    let report: SendReport | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let resolveOutcome!: (outcome: OutboundDeliveryOutcome) => void;
    const outcomePromise = new Promise<OutboundDeliveryOutcome>((resolve) => {
      resolveOutcome = resolve;
    });

    const collectOutcome = (): OutboundDeliveryOutcome | null => {
      if (!report) return null;
      const expectedReceiverCount = this.expectedReceiverCount(report);
      if (expectedReceiverCount === 0) return this.outcome(report, []);

      const terminalByPeer = new Map<string, TerminalTransfer>();
      for (const terminal of terminalTransfers.values()) {
        if (terminal.entryId !== report.entryId) continue;
        terminalByPeer.set(terminal.peerId, terminal);
      }
      if (terminalByPeer.size < expectedReceiverCount) return null;
      return this.outcome(report, [...terminalByPeer.values()]);
    };

    const finishIfReady = () => {
      const outcome = collectOutcome();
      if (!outcome) return;
      if (timeout) clearTimeout(timeout);
      resolveOutcome(outcome);
    };

    const unsubscribe = this.events.subscribeEvents((event) => {
      if (event.type === 'transferProgress' && event.direction === 'sending' && event.entryId) {
        const transfers = outboundTransfers.get(event.transferId) ?? [];
        if (
          !transfers.some(
            (transfer) => transfer.entryId === event.entryId && transfer.peerId === event.peerId
          )
        ) {
          transfers.push({ entryId: event.entryId, peerId: event.peerId });
          outboundTransfers.set(event.transferId, transfers);
        }
      } else if (event.type === 'transferStatusChanged') {
        const status = event.status.toLowerCase();
        if (status === 'completed' || status === 'failed' || status === 'cancelled') {
          const outbound = outboundTransfers
            .get(event.transferId)
            ?.find(
              (transfer) =>
                transfer.entryId === event.entryId &&
                !terminalTransfers.has(`${event.entryId}\0${transfer.peerId}`)
            );
          const peerId = outbound?.peerId ?? event.transferId;
          terminalTransfers.set(`${event.entryId}\0${peerId}`, {
            entryId: event.entryId,
            peerId,
            status,
            reason: event.reason,
          });
        }
      }
      finishIfReady();
    });

    try {
      report = await send();
      const immediate = collectOutcome();
      if (immediate) return immediate;

      timeout = setTimeout(() => {
        const terminalByPeer = new Map<string, TerminalTransfer>();
        for (const terminal of terminalTransfers.values()) {
          if (terminal.entryId !== report?.entryId) continue;
          terminalByPeer.set(terminal.peerId, terminal);
        }
        resolveOutcome(this.outcome(report!, [...terminalByPeer.values()]));
      }, this.timeoutMs);
      finishIfReady();
      return await outcomePromise;
    } finally {
      if (timeout) clearTimeout(timeout);
      unsubscribe();
    }
  }

  private outcome(report: SendReport, terminals: TerminalTransfer[]): OutboundDeliveryOutcome {
    const completed = terminals.filter((terminal) => terminal.status === 'completed').length;
    const failed = terminals.filter((terminal) => terminal.status === 'failed').length;
    const cancelled = terminals.filter((terminal) => terminal.status === 'cancelled').length;
    return {
      report,
      completed,
      failed,
      cancelled,
      pending: Math.max(0, this.expectedReceiverCount(report) - completed - failed - cancelled),
      reasons: terminals.flatMap((terminal) => (terminal.reason ? [terminal.reason] : [])),
    };
  }

  private expectedReceiverCount(report: SendReport): number {
    return report.totalAccepted + report.totalPending;
  }
}

let sharedCoordinator: OutboundDeliveryCoordinator | null = null;
let sharedEventSource: OutboundDeliveryEventSource | null = null;

export function configureOutboundDeliveryCoordinator(events: OutboundDeliveryEventSource): void {
  if (sharedCoordinator)
    throw new Error('The outbound delivery coordinator has already been created');
  sharedEventSource = events;
}

export function getOutboundDeliveryCoordinator(): OutboundDeliveryCoordinator {
  if (!sharedCoordinator) {
    if (!sharedEventSource) throw new Error('The outbound delivery coordinator is not configured');
    sharedCoordinator = new OutboundDeliveryCoordinator(sharedEventSource);
  }
  return sharedCoordinator;
}
