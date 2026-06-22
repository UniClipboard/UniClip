require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'QrScanner'
  s.version        = package['version']
  s.summary        = 'Native QR scanner using DataScannerViewController'
  s.description    = 'Expo module wrapping iOS DataScannerViewController for QR code scanning'
  s.license        = 'MIT'
  s.author         = 'uniclipboard'
  s.homepage       = 'https://github.com/nicepkg/uniclipboard'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/nicepkg/uniclipboard.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '*.swift'
  s.frameworks = 'VisionKit'
end
