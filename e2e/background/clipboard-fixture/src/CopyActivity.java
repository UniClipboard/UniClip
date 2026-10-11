package test.clipboardfixture;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.os.Bundle;

/**
 * Stands in for "another app": while it is the foreground app it puts the `text` extra on the
 * OS clipboard, exactly as an app's own Copy button does, then closes.
 */
public class CopyActivity extends Activity {
  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);
    String text = getIntent().getStringExtra("text");
    ClipboardManager clipboard = getSystemService(ClipboardManager.class);
    if (text != null) clipboard.setPrimaryClip(ClipData.newPlainText("fixture", text));
  }

  @Override
  protected void onResume() {
    super.onResume();
    getWindow().getDecorView().postDelayed(this::finish, 1200);
  }
}
