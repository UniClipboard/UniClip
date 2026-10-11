import { setTimeout as delay } from "node:timers/promises";

/**
 * Actions on the emulator that stand in for a second app and for the user.
 * Copying is a real OS clipboard change made by another foreground app.
 */
export function actions({ probe, appId }) {
  const { shell } = probe;

  async function findText(label) {
    for (let attempt = 0; attempt < 3; attempt++) {
      await shell("uiautomator dump /sdcard/e2e-ui.xml").catch(() => "");
      const xml = await shell("cat /sdcard/e2e-ui.xml").catch(() => "");
      const node = [...xml.matchAll(/<node [^>]*text="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)].find(
        (m) => m[1].toLowerCase() === label.toLowerCase()
      );
      if (node) {
        return {
          x: Math.round((Number(node[2]) + Number(node[4])) / 2),
          y: Math.round((Number(node[3]) + Number(node[5])) / 2),
        };
      }
      await delay(800);
    }
    return null;
  }
  return {
    home() {
      return shell("input keyevent KEYCODE_HOME");
    },
    /**
     * Another app puts `text` on the OS clipboard while it is in the foreground, as an app's own
     * Copy button does. The helper is built from e2e/background/clipboard-fixture.
     */
    async copyInOtherApp(text) {
      await shell(`am start -n test.clipboardfixture/.CopyActivity --es text ${text}`);
      await delay(2500);
      await shell("input keyevent KEYCODE_HOME");
    },
    startActivity(component) {
      return shell(`am start -n ${appId}/${component}`);
    },
    /** Taps a visible notification (or one of its actions) by its text. */
    async tapNotificationText(label) {
      await shell("cmd statusbar expand-notifications");
      await delay(1500);
      let node = await findText(label);
      if (!node) {
        // Actions only show on an expanded notification. Pull down on the first notification row
        // (below the shade header) to expand it, then look again.
        await shell("input swipe 540 700 540 1100 300").catch(() => "");
        await delay(1200);
        node = await findText(label);
      }
      if (!node) {
        probe.event("notification.text-missing", {
          label,
          visible: (await probe.uiTexts().catch(() => [])).slice(0, 30),
        });
        await shell("cmd statusbar collapse");
        throw new Error(`Notification text not found: ${label}`);
      }
      await shell(`input tap ${node.x} ${node.y}`);
      await delay(800);
      // A tapped action leaves the shade open, which would hide the app from the next UI flow.
      await shell("cmd statusbar collapse").catch(() => "");
      await delay(600);
    },
    /**
     * A restart prompt posted after a force-stop sits above the service notification and groups it,
     * which hides its actions. Dismissing the (clearable) prompt first leaves the service notification
     * alone, because an ongoing foreground-service notification is not cleared by "Clear all".
     */
    async tapNotificationAction(label) {
      await shell("cmd statusbar expand-notifications");
      await delay(1500);
      const clear = await findText("Clear all");
      if (clear) {
        await shell(`input tap ${clear.x} ${clear.y}`);
        await delay(1500);
      }
      await shell("cmd statusbar collapse");
      await delay(600);
      return this.tapNotificationText(label);
    },
    /** Kills the app process the way the system does under memory pressure (emulator root only). */
    async killProcess() {
      const pid = await shell(`pidof ${appId}`);
      await shell(`kill -9 ${pid.trim().split(/\s+/)[0]}`);
    },
    /** The user swipes the app's card out of the recents screen. */
    async swipeAppAwayFromRecents() {
      await shell("input keyevent KEYCODE_APP_SWITCH");
      await delay(1500);
      await shell("input swipe 540 1300 540 200 250");
      await delay(1500);
      await shell("input keyevent KEYCODE_HOME");
    },
    closeShade() {
      return shell("cmd statusbar collapse");
    },
  };
}
