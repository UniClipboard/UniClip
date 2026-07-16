#!/usr/bin/env ruby
# asc_whats_to_test — set TestFlight's "What to Test" for a freshly uploaded
# build via the App Store Connect API.
#
#   ruby scripts/asc_whats_to_test.rb <key_id> <issuer_id> <p8_path> \
#        <bundle_id> <build_number> <zh_notes_file> <en_notes_file>
#
# `xcrun altool --upload-app` only uploads the .ipa; it never sets the tester
# notes. This script polls until App Store Connect has registered the build
# (processing can take several minutes after upload), then writes the iOS
# localized release notes into each beta-build localization for that build.
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
TARGET_LOCALIZATIONS = { 'en-US' => 'en', 'zh-Hans' => 'zh' }.freeze

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

def request(token, method, path, body = nil)
  uri = URI("#{API}#{path}")
  http = Net::HTTP.new(uri.host, uri.port)
  http.use_ssl = true
  req = { 'GET' => Net::HTTP::Get, 'POST' => Net::HTTP::Post, 'PATCH' => Net::HTTP::Patch }[method].new(uri)
  req['Authorization'] = "Bearer #{token}"
  req['Content-Type'] = 'application/json'
  req.body = body.to_json if body
  res = http.request(req)
  [res.code.to_i, res.body.to_s]
end

def get_json(token, path)
  code, body = request(token, 'GET', path)
  soft_abort("GET #{path} -> HTTP #{code}: #{body}") unless code.between?(200, 299)
  JSON.parse(body)
end

def sync_build_localizations(build_id, localizations, localized_notes, requester:, reporter: ->(_message) {})
  existing_by_locale = localizations.each_with_object({}) do |localization, result|
    locale = localization.dig('attributes', 'locale').to_s
    result[locale] = localization unless locale.empty?
  end
  locales = (TARGET_LOCALIZATIONS.keys + existing_by_locale.keys).uniq
  errors = []

  locales.each do |locale|
    language = locale.downcase.start_with?('zh') ? 'zh' : 'en'
    localization = existing_by_locale[locale]
    if localization
      method = 'PATCH'
      path = "/v1/betaBuildLocalizations/#{localization['id']}"
      payload = {
        data: {
          type: 'betaBuildLocalizations',
          id: localization['id'],
          attributes: { whatsToTest: localized_notes.fetch(language) },
        },
      }
    else
      method = 'POST'
      path = '/v1/betaBuildLocalizations'
      payload = {
        data: {
          type: 'betaBuildLocalizations',
          attributes: {
            locale: locale,
            whatsToTest: localized_notes.fetch(TARGET_LOCALIZATIONS.fetch(locale)),
          },
          relationships: { build: { data: { type: 'builds', id: build_id } } },
        },
      }
    end

    begin
      code, body = requester.call(method, path, payload)
    rescue StandardError => error
      errors << "#{method} localization #{locale} -> #{error.class}: #{error.message}"
      next
    end

    if code.between?(200, 299)
      reporter.call("#{method == 'POST' ? 'created' : 'updated'} #{locale} 'What to Test' localization")
    else
      errors << "#{method} localization #{locale} -> HTTP #{code}: #{body}"
    end
  end

  errors
end

def main(argv = ARGV)
  key_id, issuer_id, p8_path, bundle_id, build_number, zh_notes_file, en_notes_file = argv
  required_files = [p8_path, zh_notes_file, en_notes_file]
  unless required_files.all? { |path| path && File.exist?(path) }
    abort "usage: #{$PROGRAM_NAME} <key_id> <issuer_id> <p8_path> <bundle_id> <build_number> <zh_notes_file> <en_notes_file>"
  end

  # App Store Connect caps whatsToTest at 4000 characters.
  localized_notes = {
    'zh' => File.read(zh_notes_file).strip[0, 4000],
    'en' => File.read(en_notes_file).strip[0, 4000],
  }
  if localized_notes.values.any?(&:empty?)
    puts "a localized whats_to_test note is empty — nothing to set, skipping."
    return
  end

  token = jwt(key_id, issuer_id, p8_path)
  apps = get_json(
    token,
    "/v1/apps?filter[bundleId]=#{URI.encode_www_form_component(bundle_id)}&limit=1"
  )['data']
  soft_abort("no App Store Connect app for bundle id #{bundle_id}") if apps.empty?
  app_id = apps.first['id']
  puts "app #{bundle_id} -> #{app_id}"

  build = nil
  POLL_ATTEMPTS.times do |attempt|
    data = get_json(
      token,
      "/v1/builds?filter[app]=#{app_id}&filter[version]=#{URI.encode_www_form_component(build_number)}&limit=1"
    )['data']
    unless data.empty?
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

  localizations = get_json(token, "/v1/builds/#{build_id}/betaBuildLocalizations")['data']
  requester = ->(method, path, payload) { request(token, method, path, payload) }
  errors = sync_build_localizations(
    build_id,
    localizations,
    localized_notes,
    requester: requester,
    reporter: ->(message) { puts message }
  )
  soft_abort(errors.join("\n")) unless errors.empty?
  puts "done."
end

main if $PROGRAM_NAME == __FILE__
