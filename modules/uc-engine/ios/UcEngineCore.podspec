require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'UcEngineCore'
  s.version        = package['version']
  s.summary        = 'Shared UniClipboard P2P engine for iOS application processes'
  s.description    = 'P2P engine bindings and system adapters shared by the app and extensions'
  s.license        = 'AGPL-3.0-only'
  s.author         = 'uniclipboard'
  s.homepage       = 'https://github.com/UniClipboard/UniClipboard'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/UniClipboard/UniClipboard.git' }
  s.static_framework = true

  s.frameworks = 'Security', 'SystemConfiguration', 'UIKit', 'UniformTypeIdentifiers'
  s.source_files = ['NativeSystemHost.swift', 'SharedEngineHost.swift', 'Bindings/*.swift']
  s.vendored_frameworks = 'UniClipboardEngine.xcframework'
  s.exclude_files = 'Bindings/include/**'
  s.script_phase = {
    :name => 'Verify UniClipboard Engine Release',
    :script => 'node "${PODS_TARGET_SRCROOT}/../../../scripts/verify-unified-engine-core.mjs" --prepared',
    :execution_position => :before_compile,
  }
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
  }
end
