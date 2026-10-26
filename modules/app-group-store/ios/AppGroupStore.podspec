require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'AppGroupStore'
  s.version        = package['version']
  s.summary        = 'Expo module for UniClipboard iOS App Group storage'
  s.description    = 'Expo module that writes settings and server data into the shared iOS App Group'
  s.license        = 'MIT'
  s.author         = 'uniclipboard'
  s.homepage       = 'https://github.com/nicepkg/uniclipboard'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/nicepkg/uniclipboard.git' }
  s.static_framework = true
  s.default_subspec = 'Module'

  # Extensions need the Foundation admission owner without the Expo bridge.
  s.subspec 'StorageAccess' do |core|
    core.source_files = 'Shared/SharedStorageAccess.swift'
  end
  s.subspec 'Module' do |mod|
    mod.dependency 'AppGroupStore/StorageAccess'
    mod.dependency 'ExpoModulesCore'
    mod.source_files = ['AppGroupStoreModule.swift', 'Shared/**/*.swift']
    mod.exclude_files = 'Shared/SharedStorageAccess.swift'
  end
end
