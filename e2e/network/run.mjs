import { desktopPeer } from "./desktop-peer.mjs";

/** Coordinate real peer operations between UI-owned Maestro phases. */
export async function runBidirectionalSync({ cli, output, runFlow }) {
  const peer = desktopPeer(cli, output);
  try {
    const code = await peer.prepare();
    await runFlow("join", {
      INVITATION_CODE: code,
      SPACE_PASSWORD: peer.passphrase,
    });
    await peer.send("DesktopBeforeRestartProbe", "before-restart");
    await runFlow("exchange", {
      INCOMING: "DesktopBeforeRestartProbe",
      OUTGOING: "MobileBeforeRestartProbe",
    });
    await peer.expectReceived("MobileBeforeRestartProbe", "before-restart");
    await runFlow("restart", {});
    try {
      await peer.waitOnline("after-restart");
      await peer.send("DesktopAfterRestartProbe", "after-restart", {
        allowDeferred: true,
      });
    } catch (error) {
      // The restart phase leaves the app at home, so preserve evidence through its export UI.
      await runFlow("export", {});
      throw error;
    }
    await runFlow("exchange", {
      INCOMING: "DesktopAfterRestartProbe",
      OUTGOING: "MobileAfterRestartProbe",
    });
    await peer.expectReceived("MobileAfterRestartProbe", "after-restart");
    await runFlow("export", {});
  } finally {
    await peer.dispose();
  }
}
