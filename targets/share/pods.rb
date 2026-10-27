# The Share target is a dumb staging extension (spec §5): it never starts an
# engine session, so it must build without the P2P engine dependency.

# Share owns the same process-local storage gate without an Expo or P2P runtime.
pod 'AppGroupStore/StorageAccess', :path => '../modules/app-group-store/ios'
