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
  targets: [
    .target(
      name: "UcEngineSystemHost",
      path: "ios",
      exclude: [
        "Bindings",
        "Tests",
        "UcEngine.podspec",
        "UcEngineModule.swift",
        "UniClipboardEngine.xcframework",
      ],
      sources: ["NativeLifecycleHost.swift", "NativeSystemHost.swift"]
    ),
    .testTarget(
      name: "UcEngineSystemHostTests",
      dependencies: ["UcEngineSystemHost"],
      path: "ios/Tests"
    ),
  ]
)
