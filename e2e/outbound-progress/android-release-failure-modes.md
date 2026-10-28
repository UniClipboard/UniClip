# Android release acceptance, recorded before owner changes

- A Pending receipt must retain the real Engine and FileHandleRegistry.
- A Failed receipt must stop the automatic wait loop and retain ownership for explicit retry.
- Released(error) must close the Engine and host files once, then surface the error.
- A service release, runtime detach or activity callback must not block the Android main thread.
- Reattachment during accepted final cleanup must reject reuse of that instance.
- Concurrent service retain and release must keep balanced counts.
- Final Engine release excludes process observability. Do not report whole-process file release.
- Failed startup without an Engine remains gated on the upstream startup contract.

Replay the owner decision path with controlled receipts and independent temporary host-file probes.
Compile the actual Android module against matching generated Kotlin and AAR separately.
Real service/JS lifecycle, app restart and device transitions remain NOT RUN.
