import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { desktopPeer } from "./desktop-peer.mjs";

/**
 * The phone removes one member while another member is offline, so the phone owes the offline
 * member a group key update; the update must be shown as pending and clear once it is delivered.
 * Every state comes from real space operations; nothing is injected into the app or the peers.
 */
export async function runGroupUpdateDelivery({ cli, output, runFlow }) {
  const offlineOutput = join(output, "peer-offline");
  const removedOutput = join(output, "peer-removed");
  await mkdir(offlineOutput, { recursive: true });
  await mkdir(removedOutput, { recursive: true });
  const offline = desktopPeer(cli, offlineOutput, { deviceName: "Offline acceptance peer" });
  const removed = desktopPeer(cli, removedOutput, { deviceName: "Removed acceptance peer" });
  const devices = { OFFLINE: offline.deviceName, REMOVED: removed.deviceName };
  try {
    const code = await offline.prepare();
    await runFlow("join", { INVITATION_CODE: code, SPACE_PASSWORD: offline.passphrase });
    await removed.start();
    await removed.join(await offline.invite(), offline.passphrase);
    await runFlow("group-update-ready", devices);
    offline.pause();
    await runFlow("group-update-pending", devices);
    await runFlow("restart", {});
    await runFlow("group-update-pending-after-restart", devices);
    offline.resume();
    await runFlow("group-update-delivered", devices);
    await runFlow("export", {});
  } finally {
    await removed.dispose();
    await offline.dispose();
  }
}
