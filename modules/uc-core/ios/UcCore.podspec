require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'UcCore'
  s.version        = package['version']
  s.summary        = 'Expo module wrapping uc-mobile Rust core via UniFFI'
  s.description    = 'Expo module wrapping uc-mobile Rust core via UniFFI'
  s.license        = 'MIT'
  s.author         = 'uniclipboard'
  s.homepage       = 'https://github.com/nicepkg/uniclipboard'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/nicepkg/uniclipboard.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = ['*.swift', 'Bindings/*.swift']
  s.vendored_frameworks = 'UniClipboardCore.xcframework'
  s.exclude_files = 'Bindings/include/**'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
  }
end
