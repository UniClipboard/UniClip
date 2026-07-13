#!/usr/bin/env ruby
# asc_whats_to_test — set TestFlight's "What to Test" for a freshly uploaded
# build via the App Store Connect API.
#
#   ruby scripts/asc_whats_to_test.rb <key_id> <issuer_id> <p8_path> \
#        <bundle_id> <build_number> <notes_file>
#
# `xcrun altool --upload-app` only uploads the .ipa; it never sets the tester
# notes. This script polls until App Store Connect has registered the build
# (processing can take several minutes after upload), then writes the iOS
# release notes into every beta-build localization for that build.
#
# Failures are treated as soft: the build is already uploaded, so a slow /
# missing build must NOT fail the release. The script prints a warning and
# exits 0 in that case; wire the CI step with `continue-on-error: true` too.
#
# JWT construction mirrors scripts/asc_profiles.rb (same team / API key).

require 'openssl'
require 'json'
require 'base64'
require 'net/http'
require 'uri'

API = 'https://api.appstoreconnect.apple.com'
POLL_ATTEMPTS = 40 # ~20 min at 30s each
POLL_INTERVAL = 30

key_id, issuer_id, p8_path, bundle_id, build_number, notes_file = ARGV
unless notes_file && File.exist?(p8_path) && File.exist?(notes_file)
  abort "usage: #{$0} <key_id> <issuer_id> <p8_path> <bundle_id> <build_number> <notes_file>"
end

whats_to_test = File.read(notes_file).strip
# App Store Connect caps whatsToTest at 4000 characters.
whats_to_test = whats_to_test[0, 4000] if whats_to_test.length > 4000
if whats_to_test.empty?
  puts "whats_to_test note is empty — nothing to set, skipping."
  exit 0
end

def soft_abort(message)
  warn "warning: #{message}"
  warn "TestFlight 'What to Test' was not set; upload itself is unaffected."
  exit 0
end

def jwt(key_id, issuer_id, p8_path)
  key = OpenSSL::PKey.read(File.read(p8_path))
  b64 = ->(d) { Base64.urlsafe_encode64(d).delete('=') }
  header  = b64.({ alg: 'ES256', kid: key_id, typ: 'JWT' }.to_json)
  now     = Time.now.to_i
  payload = b64.({ iss: issuer_id, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' }.to_json)
  input   = "#{header}.#{payload}"
  der = key.sign(OpenSSL::Digest::SHA256.new, input)
  r, s = OpenSSL::ASN1.decode(der).value.map { |i| i.value.to_s(2) }
  raw = [r, s].map { |c| c.length > 32 ? c[-32..-1] : c.rjust(32, "\x00") }.join
  "#{input}.#{b64.(raw)}"
end

TOKEN = jwt(key_id, issuer_id, p8_path)

def request(method, path, body = nil)
  uri = URI("#{API}#{path}")
  http = Net::HTTP.new(uri.host, uri.port)
  http.use_ssl = true
  req = { 'GET' => Net::HTTP::Get, 'POST' => Net::HTTP::Post, 'PATCH' => Net::HTTP::Patch }[method].new(uri)
  req['Authorization'] = "Bearer #{TOKEN}"
  req['Content-Type'] = 'application/json'
  req.body = body.to_json if body
  res = http.request(req)
  [res.code.to_i, res.body.to_s]
end

def get_json(path)
  code, body = request('GET', path)
  soft_abort("GET #{path} -> HTTP #{code}: #{body}") unless code.between?(200, 299)
  JSON.parse(body)
end

# Resolve the app id from the bundle id.
apps = get_json("/v1/apps?filter[bundleId]=#{URI.encode_www_form_component(bundle_id)}&limit=1")['data']
soft_abort("no App Store Connect app for bundle id #{bundle_id}") if apps.empty?
app_id = apps.first['id']
puts "app #{bundle_id} -> #{app_id}"

# Poll until the build (CFBundleVersion == build_number) is registered.
build = nil
POLL_ATTEMPTS.times do |attempt|
  data = get_json(
    "/v1/builds?filter[app]=#{app_id}&filter[version]=#{URI.encode_www_form_component(build_number)}&limit=1"
  )['data']
  if !data.empty?
    build = data.first
    break
  end
  puts "build #{build_number} not visible yet (attempt #{attempt + 1}/#{POLL_ATTEMPTS}); waiting #{POLL_INTERVAL}s..."
  sleep POLL_INTERVAL
end
soft_abort("build #{build_number} never appeared on App Store Connect") unless build

build_id = build['id']
state = build.dig('attributes', 'processingState')
puts "found build #{build_number} (#{build_id}), processingState=#{state}"

# App Store Connect seeds one beta-build localization per app locale. Patch each
# with the notes; if none exist yet, create an en-US one.
locs = get_json("/v1/builds/#{build_id}/betaBuildLocalizations")['data']
if locs.empty?
  code, body = request('POST', '/v1/betaBuildLocalizations', {
    data: {
      type: 'betaBuildLocalizations',
      attributes: { locale: 'en-US', whatsToTest: whats_to_test },
      relationships: { build: { data: { type: 'builds', id: build_id } } },
    },
  })
  soft_abort("create localization -> HTTP #{code}: #{body}") unless code.between?(200, 299)
  puts "created en-US 'What to Test' localization"
else
  locs.each do |loc|
    locale = loc.dig('attributes', 'locale')
    code, body = request('PATCH', "/v1/betaBuildLocalizations/#{loc['id']}", {
      data: {
        type: 'betaBuildLocalizations',
        id: loc['id'],
        attributes: { whatsToTest: whats_to_test },
      },
    })
    soft_abort("patch localization #{locale} -> HTTP #{code}: #{body}") unless code.between?(200, 299)
    puts "set 'What to Test' for #{locale}"
  end
end

puts "done."
