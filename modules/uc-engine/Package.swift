// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "UcEngineSystemHost",
  platforms: [
    .iOS(.v16),
    .macOS(.v14),
  ],
  products: [
    .library(name: "UcEngineSystemHost", targets: ["UcEngineSystemHost"])
  ],
  dependencies: [.package(path: "../app-group-store")],
  targets: [
    .target(
      name: "UcEngineSystemHost",
      dependencies: [.product(name: "SharedStorageAccess", package: "app-group-store")],
      path: "ios",
      exclude: [
        "Bindings",
        "Tests",
        "UcEngine.podspec",
        "UcEngineCore.podspec",
        "UcEngineModule.swift",
        "SharedEngineHost.swift",
        "AppleNativeDiagnostics.swift",
        "EngineDiagnosticBridge.swift",
        "NetworkLogHost.swift",
        "UniClipboardEngine.xcframework",
      ],
      sources: [
        "ExtensionRuntimeLifecycle.swift",
        "NativeReleaseOwner.swift",
        "ExtensionSyncCoordinator.swift",
        "AnalyticsBindingCompatibility.swift",
        "NativeAnalyticsHost.swift",
        "NativeRuntimeDiagnostics.swift",
        "NativeLifecycleHost.swift",
        "NativeSystemHost.swift",
        "NetworkLogExportStaging.swift",
        "P2pRuntimeOwnership.swift",
      ]
    ),
    .testTarget(
      name: "UcEngineSystemHostTests",
      dependencies: ["UcEngineSystemHost"],
      path: "ios/Tests"
    ),
  ]
)
