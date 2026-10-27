// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "OutboundShareHandoffCore",
  platforms: [
    .iOS(.v16),
    .macOS(.v14),
  ],
  products: [
    .library(name: "SharedStorageAccess", targets: ["SharedStorageAccess"]),
    .library(name: "OutboundShareHandoffCore", targets: ["OutboundShareHandoffCore"]),
  ],
  targets: [
    .target(name: "SharedStorageAccess", path: "ios/Shared", sources: ["SharedStorageAccess.swift"]),
    .target(
      name: "OutboundShareHandoffCore",
      dependencies: ["SharedStorageAccess"],
      path: "ios/Shared",
      sources: [
        "EngineLogLocator.swift",
        "LegacyContainerMigrator.swift",
        "OutboundShareHandoff.swift",
        "ShareDiagnostics.swift",
      ]
    ),
    .testTarget(
      name: "OutboundShareHandoffCoreTests",
      dependencies: ["OutboundShareHandoffCore"],
      path: "ios/Tests"
    ),
  ]
)
