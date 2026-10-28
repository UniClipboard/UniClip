import { create } from "zustand";
import type { ResendTargetProgress } from "@/platform/engine";

// Session-only facts. Do not persist remote results or business identifiers.
export const useOutboundResendStore = create<{
  results: Record<string, ResendTargetProgress & { entryId: string }>;
}>(() => ({ results: {} }));

export function recordOutboundResend(
  entryId: string,
  results: ResendTargetProgress[],
): void {
  useOutboundResendStore.setState((state) => ({
    results: {
      ...state.results,
      ...Object.fromEntries(
        results.map((target) => [
          JSON.stringify([entryId, target.targetDeviceId]),
          { ...target, entryId },
        ]),
      ),
    },
  }));
}
