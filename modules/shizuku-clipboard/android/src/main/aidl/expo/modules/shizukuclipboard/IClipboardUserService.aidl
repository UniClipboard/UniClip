package expo.modules.shizukuclipboard;

import android.os.IBinder;
import android.os.ParcelFileDescriptor;

interface IClipboardUserService {
    void init(in IBinder callerToken);
    String getPrimaryClipJson();
    boolean copyPrimaryClipToFile(in ParcelFileDescriptor destination);
    boolean setPrimaryClipText(String text);
    void destroy();
}
