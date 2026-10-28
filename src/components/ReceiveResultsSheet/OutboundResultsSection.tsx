import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { AppButton, AppHost } from "@/components/ui";
import { useTheme } from "@/hooks/useTheme";
import { useUnifiedEngineStore } from "@/stores/unifiedEngineStore";
import {
  recordOutboundResend,
  useOutboundResendStore,
} from "@/stores/outboundResendStore";
import {
  getUnifiedEngineService,
  type OutboundProgress,
} from "@/platform/engine";
import { getUnifiedSpaceService, useUnifiedSpaceStore } from "@/features/space";

/** Shared facts, rendered with the existing platform-native buttons and Host. */
export function OutboundResultsSection({
  actionsEnabled = true,
}: {
  actionsEnabled?: boolean;
}) {
  const { t } = useTranslation("home");
  const { theme } = useTheme();
  const snapshot = useUnifiedEngineStore((s) => s.outbound);
  const devices = useUnifiedSpaceStore((s) => s.devices);
  const results = useOutboundResendStore((s) => s.results);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void getUnifiedEngineService().refreshOutboundProgress();
  }, []);
  const targets = new Map<
    string,
    {
      entryId: string;
      targetDeviceId: string;
      progress: OutboundProgress | null;
    }
  >();
  for (const result of Object.values(results)) {
    targets.set(JSON.stringify([result.entryId, result.targetDeviceId]), {
      ...result,
      progress: result.current,
    });
  }
  for (const progress of snapshot.progress) {
    targets.set(JSON.stringify([progress.entryId, progress.targetDeviceId]), {
      ...progress,
      progress,
    });
  }
  const run = async (
    entryId: string,
    targetDeviceId: string,
    confirmed = false,
  ) => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    setConfirming(null);
    try {
      const outcome = await getUnifiedSpaceService().resendEntry(
        entryId,
        [targetDeviceId],
        confirmed,
      );
      if (outcome.kind === "completed")
        recordOutboundResend(entryId, outcome.reconciled);
      else setFailed(true);
      await getUnifiedEngineService().refreshOutboundProgress();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  if (targets.size === 0) return null;
  const entryIds = [
    ...new Set([...targets.values()].map((target) => target.entryId)),
  ];
  return (
    <View style={styles.section}>
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: theme.colors.textPrimary }]}
      >
        {t("outbound.title")}
      </Text>
      {!snapshot.available || failed ? (
        <Text style={{ color: theme.colors.warning }}>
          {t("outbound.unavailable")}
        </Text>
      ) : null}
      {[...targets].map(([key, target], index) => {
        const result = results[key];
        // Keep the classification separate from complete current and list views.
        const p = target.progress;
        const canRequest =
          !failed &&
          result &&
          ["settled", "not_retained", "unsupported"].includes(result.state) &&
          !result.newTransferRequested &&
          (!p ||
            (p.itemsRunning === 0 &&
              p.itemsWaiting === 0 &&
              (!result.current || result.current.attemptId === p.attemptId)));
        return (
          <View
            key={key}
            style={[
              styles.target,
              { backgroundColor: theme.colors.surfaceLow },
            ]}
          >
            <Text style={{ color: theme.colors.textPrimary }}>
              {t("outbound.entry", {
                index: entryIds.indexOf(target.entryId) + 1,
              })}{" "}
              · {t("outbound.target", { index: index + 1 })}
            </Text>
            <Text style={{ color: theme.colors.textSecondary }}>
              {devices.find(
                (device) => device.deviceId === target.targetDeviceId,
              )?.displayName ?? t("outbound.unknownDevice")}
            </Text>
            <Text style={{ color: theme.colors.textPrimary }}>
              {p
                ? t(`outbound.state.${p.state}`)
                : t("outbound.state.unconfirmed")}
            </Text>
            {p ? (
              <Text style={{ color: theme.colors.textSecondary }}>
                {t("outbound.freshness", {
                  value: t(`outbound.freshnessValue.${p.freshness}`),
                })}
                {!p.freshnessAvailable
                  ? ` · ${t("outbound.freshnessUnavailable")}`
                  : ""}
              </Text>
            ) : null}
            {p?.items.map((item) => (
              <View key={`${item.kind}:${item.index}`} style={styles.item}>
                <Text style={{ color: theme.colors.textPrimary }}>
                  {t("outbound.item", { index: item.index + 1 })} ·{" "}
                  {t(`outbound.state.${item.state}`)}
                </Text>
                <Text style={{ color: theme.colors.textSecondary }}>
                  {t("outbound.bytes", {
                    completed: item.completedBytes ?? t("outbound.unknown"),
                    total: item.totalBytes ?? t("outbound.unknown"),
                  })}
                </Text>
                {item.lastKnownPhase ? (
                  <Text style={{ color: theme.colors.textSecondary }}>
                    {t("outbound.lastPhase", {
                      value: t(`outbound.state.${item.lastKnownPhase}`),
                    })}
                  </Text>
                ) : null}
                {item.round !== null ? (
                  <Text style={{ color: theme.colors.textSecondary }}>
                    {t("outbound.round", { round: item.round })}
                  </Text>
                ) : null}
                {item.failureReason || item.cancellationReason ? (
                  <Text style={{ color: theme.colors.warning }}>
                    {item.failureReason ?? item.cancellationReason}
                  </Text>
                ) : null}
              </View>
            ))}
            {result ? (
              <Text style={{ color: theme.colors.textSecondary }}>
                {t(`outbound.reconciliation.${result.state}`)} ·{" "}
                {t(
                  result.newTransferRequested
                    ? "outbound.newRequested"
                    : "outbound.noNewRequest",
                )}
              </Text>
            ) : null}
            {result?.duplicateFilesPossible ? (
              <Text style={{ color: theme.colors.warning }}>
                {t("outbound.duplicateWarning")}
              </Text>
            ) : null}
            <AppHost matchContents>
              <AppButton
                title={t("outbound.reconcile")}
                disabled={busy || !actionsEnabled}
                onPress={() => {
                  void run(target.entryId, target.targetDeviceId);
                }}
              />
            </AppHost>
            {canRequest ? (
              <AppHost matchContents>
                <AppButton
                  title={t("outbound.requestNew")}
                  disabled={busy || !actionsEnabled}
                  variant="outlined"
                  onPress={() => setConfirming(key)}
                />
              </AppHost>
            ) : null}
            {confirming === key && canRequest ? (
              <>
                <Text style={{ color: theme.colors.warning }}>
                  {t("outbound.duplicateWarning")}
                </Text>
                <AppHost matchContents>
                  <AppButton
                    title={t("outbound.confirmNew")}
                    disabled={busy || !actionsEnabled}
                    onPress={() => {
                      void run(target.entryId, target.targetDeviceId, true);
                    }}
                  />
                </AppHost>
                <AppHost matchContents>
                  <AppButton
                    title={t("outbound.cancel")}
                    variant="text"
                    onPress={() => setConfirming(null)}
                  />
                </AppHost>
              </>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
const styles = StyleSheet.create({
  section: { gap: 12, paddingVertical: 12 },
  title: { fontSize: 17, fontWeight: "600" },
  target: { borderRadius: 12, padding: 12, gap: 8 },
  item: { paddingVertical: 6, gap: 3 },
});
