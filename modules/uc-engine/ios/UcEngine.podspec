require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'UcEngine'
  s.version        = package['version']
  s.summary        = 'Expo host for the shared UniClipboard P2P engine'
  s.description    = 'System adapters and lifecycle host for the shared UniClipboard P2P engine'
  s.license        = 'AGPL-3.0-only'
  s.author         = 'uniclipboard'
  s.homepage       = 'https://github.com/UniClipboard/UniClipboard'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/UniClipboard/UniClipboard.git' }
  s.static_framework = true

  s.dependency 'UcEngineCore'
  s.dependency 'ExpoModulesCore'
  s.source_files = ['UcEngineModule.swift', 'NativeLifecycleHost.swift']
end
