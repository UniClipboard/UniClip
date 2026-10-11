package test.clipboardfixture;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.util.Log;

/**
 * Reads the OS clipboard as the focused foreground app (Android only allows that) and logs whether
 * it equals the `expect` extra. Logs a boolean only, never the clipboard text.
 */
public class ReadActivity extends Activity {
  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (!hasFocus) return;
    String expect = getIntent().getStringExtra("expect");
    ClipData clip = getSystemService(ClipboardManager.class).getPrimaryClip();
    CharSequence text = clip != null && clip.getItemCount() > 0 ? clip.getItemAt(0).getText() : null;
    boolean match = expect != null && text != null && expect.contentEquals(text);
    Log.i("UcClipboardFixture", "read match=" + match + " present=" + (text != null));
    finish();
  }
}
