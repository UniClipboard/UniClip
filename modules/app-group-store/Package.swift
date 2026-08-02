// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "OutboundShareHandoffCore",
  platforms: [
    .iOS(.v16),
    .macOS(.v14),
  ],
  products: [
    .library(name: "OutboundShareHandoffCore", targets: ["OutboundShareHandoffCore"]),
  ],
  targets: [
    .target(
      name: "OutboundShareHandoffCore",
      path: "ios/Shared",
      sources: [
        "OutboundShareHandoff.swift",
        "ShareDiagnostics.swift",
        "StartupHistoryPreviewReader.swift",
      ],
      linkerSettings: [.linkedLibrary("sqlite3")]
    ),
    .testTarget(
      name: "OutboundShareHandoffCoreTests",
      dependencies: ["OutboundShareHandoffCore"],
      path: "ios/Tests"
    ),
  ]
)
