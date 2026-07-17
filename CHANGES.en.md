v1.3.0.162

### Common

- Feature: Add Russian and Brazilian Portuguese interfaces, with system-language detection and manual selection in settings
- Feature: Add lightweight health probes for faster offline recovery, with automatic fallback for legacy servers
- Fix: Preserve retry backoff when failing over between server URLs, preventing frequent requests while offline
- Fix: Make history initialization concurrency-safe to avoid duplicate startup work and query races
- Fix: Keep retrying image clipboard reads after failures without repeatedly logging the same error

### iOS

- Fix: Probe server URLs in parallel and continue through fallback routes after upload failures, reducing Share extension delays for multi-address servers

### Android

- Feature: Control applying remote clipboard changes and pushing local changes independently, with foreground and background sync honoring each direction
- Feature: In-app release notes now support Simplified Chinese and English and follow the app language
- Feature: Log export can share directly or save to a file, with temporary archives cleaned automatically
- Fix: Host the QR scanner at app level so scanned server details reliably return to the add-server form
- Fix: Prevent search from racing the initial history load or repeatedly querying after filters are cleared

v1.3.0.161

### Common

- Fix: Failed image saves to the photo library caused cached images to be misidentified as non-image files; added HEIC / HEIF format recognition

### iOS

- Fix: Images can now be saved normally when photo access is granted for "Add Photos Only"

### Android

- Fix: Image cards occasionally showed a load failure when returning from the system camera

v1.3.0.160

### Common

- Feature: Added quick type and time filters to the home page; they automatically collapse when scrolling down to make more room for content

### iOS

- Improvement: The add action now uses the system-native menu for a consistent interaction and system experience
- Fix: Automatically uploading the local clipboard is now enabled by default on a new installation, matching automatic downloads

v1.3.0.159

### iOS

- Improvement: Card colors in the iPad two-column workspace now match the system grouped background; file cards no longer blend into the card background in dark mode

v1.3.0.158

### Common

- Feature: Upgraded the tablet home page to a two-column workspace, allowing the history list and details to be viewed simultaneously; the layout adjusts automatically for portrait orientation, rotation, and split view
- Improvement: Details-page actions are fixed at the bottom and show commonly used actions based on the content
- Fix: Changed the fallback source for update downloads to the available Gitee source

### iOS

- Fix: The keyboard and Share extensions now support iOS 16.4 and later
- Fix: Fixed delayed keyboard content updates on iOS 16

### Android

- Feature: Added unified Shizuku background clipboard access support for more reliable background reads
- Improvement: Simplified the Shizuku background clipboard setup flow
- Fix: Sync errors now show clearer causes and avoid recording the same error repeatedly
- Fix: Fixed screen flicker when returning to the previous page and unified the settings page colors
- Fix: Background service notifications now follow the system language

v1.3.0.157

### Common

- Fix: Complete all checks and builds for both platforms before release, then automatically create the version tag only after success
- Improvement: The home page empty state now provides contextual guidance and removes redundant buttons
- Fix: Explicit uploads were incorrectly skipped due to deduplication and never reached the server
- Fix: Pending connections are now correctly adopted after pairing is completed

### iOS

- Feature: Choose where to save files
- Fix: The Share / keyboard extensions no longer read an empty server configuration
- Fix: Fixed a crash when importing files without the Android native module
- Fix: The camera is now released when the scan page is hidden

v1.3.0

- [uc] Feature: Added a first-launch guide; scan a QR code to complete device pairing
- [uc] Feature: Added full multilingual support, with interface text switching between Simplified Chinese / English according to the system language
- [uc] Feature: Added a sync status banner to make issues such as pending writes / loop detection immediately visible
- [uc] Refactor: Migrated the sync engine to the shared Rust core (MobileSyncEngine) for more stable pushes / pulls
- [uc] Improvement: Simplified Android background settings to a single guided toggle and displayed the automatic READ_LOGS detection status
- [uc] Fix: Correctly prefilled the add-server form when connecting to a server through a deep link
- [uc] Fix: Fixed the timing race when importing through Share (occasionally not persisted / pushed), as well as old residual text being pushed back over applied app files

v1.2.0

- [uc] Feature: Upgraded real-time sync to SSE push; server changes are delivered immediately (replacing polling for faster updates and lower power use)
- [uc] Feature (iOS): Added keyboard / Share extensions, sharing SQLite history with the main app through an App Group (single source of truth)
- [uc] Refactor: Migrated clipboard history to SQLite, changed monitoring to event-driven, and removed the Shizuku dependency
- [uc] Visual: Redesigned the home page: moved server switching to the top bar, added an add / upload FAB in the lower right, and comprehensively redesigned text / file / link cards and the settings page
- [uc] Feature: Added connection status indicators, card context menus, and a word-selection popover
- [uc] Performance: Fixed periodic stuttering caused by log reads and writes, as well as grid corruption during fast scrolling

v1.1.0

- [uc] Feature: Added QR code / deep link support (uniclipboard://connect) for connecting to servers
- [uc] Visual: Migrated to Material 3 Expressive design, introduced a token system, and added support for switching between 5 color schemes
- [uc] Feature: Added support for running on the Web platform

v1.0.11

- [upstream] Fix: Automatic upload verification codes stopped working after 6 hours when background service operation was enabled on Android 14+
- [uc] Rebranded to UniClip and migrated to UniClipboard/uc-android
- [uc] Added a built-in function for downloading new APK versions
- [uc] Changed the app icon

v1.0.10

- Feature: Retrieve the clipboard in the background through Shizuku
- Feature: Added support for S3-compatible servers
- Feature: Added an image copy button to the history page for copying images to the clipboard
- Feature: Added support for downloading updates from gitee
- Improvement: Rebuilt image clipboard reading and setting with Native Code to resolve UI stuttering
- Fix: Upload Toast notifications were not controlled by the toggle

v1.0.10-beta2

- Feature: Added support for updating through gitee

v1.0.10-beta1

- Feature: Retrieve the clipboard in the background through Shizuku
- Feature: Added support for S3-compatible servers
- Feature: Added an image copy button to the history page for copying images to the clipboard
- Improvement: Rebuilt image clipboard reading and setting with Native Code to resolve UI stuttering
- Fix: Upload Toast notifications were not controlled by the toggle
- Fix: Could not retrieve the clipboard through Shizuku on the second cold start
- Fix: Shizuku UserService process resource leak

v1.0.9

- Feature: Automatically download images on the history page
- Feature: Added support for hiding the app in the recent tasks list
- Feature: Automatic upload verification codes no longer depend on the app running continuously and are triggered automatically when an SMS is received
- Feature: Added a toggle for sending Toast notifications after synchronization

v1.0.8

- Feature: Added left/right swipe switching for history categories
- Feature: Added multi-select mode for history records; long-press to enter multi-select and delete in batches
- Feature: Quick actions now use floating-window interactions
- Feature: Trust root certificates added by the user in the system
- Change: Removed the back-to-top button from the title bar; tapping the bottom navigation bar again returns to the top
- Change: Removed swipe-left deletion from history list items
- Fix: Incorrect history list ordering

v1.0.7

- Feature: Added word-selection support, allowing text to be split by word and selected content to be copied
- Feature: Added URL detection in text with an open-link button
- Feature: Improved background task stability
- Fix: Could not adapt to the color mode
- Fix: Error when sharing a web page

v1.0.6

- Change: Split "Background Sync" into two independent options: "Download Remote in Background" and "Upload Local in Background"
- Change: Automatic copying in sync settings now controls the foreground only; background sync no longer depends on the automatic-copy option being enabled
- Feature: Added an upload action to the menu shown after selecting text
- Feature: Added a "Temporarily Stop" button to the persistent background service notification

v1.0.5

- Fix: An extra slash in the request path when uploading history records prevented synchronization (#3)

v1.0.4

- Feature: Automatic synchronization
- Feature: Automatic upload verification codes

v1.0.3

- Fix: Incorrect pagination layout and freezes in the history
- Fix: Upload progress was not shown when using a WebDAV server
- Improvement: Improved performance in several areas

v1.0.2

- Added history synchronization
- Improved many features
- Fixed many issues

v1.0.1

- Fixed inability to upload to WebDAV servers
- Removed an invalid configuration from server settings

v1.0.0

- Supports triggering quick uploads / downloads from notification shortcuts and the app icon
- Supports local history. Favorites and history synchronization will be supported in future versions
