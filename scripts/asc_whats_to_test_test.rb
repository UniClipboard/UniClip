#!/usr/bin/env ruby

require 'minitest/autorun'
require_relative 'asc_whats_to_test'

class AscWhatsToTestTest < Minitest::Test
  BUILD_ID = 'build-123'
  NOTES = { 'zh' => '中文说明', 'en' => 'English notes' }.freeze

  def successful_requester(calls)
    lambda do |method, path, body|
      calls << { method: method, path: path, body: body }
      [200, '{}']
    end
  end

  def test_creates_both_supported_localizations_when_none_exist
    calls = []

    errors = sync_build_localizations(
      BUILD_ID,
      [],
      NOTES,
      requester: successful_requester(calls)
    )

    assert_empty errors
    assert_equal ['en-US', 'zh-Hans'], calls.map { |call| call.dig(:body, :data, :attributes, :locale) }
    assert_equal ['English notes', '中文说明'], calls.map { |call| call.dig(:body, :data, :attributes, :whatsToTest) }
    assert calls.all? { |call| call[:method] == 'POST' }
  end

  def test_updates_existing_locale_and_creates_the_missing_locale
    calls = []
    existing = [{ 'id' => 'english-id', 'attributes' => { 'locale' => 'en-US' } }]

    errors = sync_build_localizations(
      BUILD_ID,
      existing,
      NOTES,
      requester: successful_requester(calls)
    )

    assert_empty errors
    assert_equal ['PATCH', 'POST'], calls.map { |call| call[:method] }
    assert_equal '/v1/betaBuildLocalizations/english-id', calls[0][:path]
    assert_equal 'zh-Hans', calls[1].dig(:body, :data, :attributes, :locale)
  end

  def test_updates_both_existing_localizations
    calls = []
    existing = [
      { 'id' => 'english-id', 'attributes' => { 'locale' => 'en-US' } },
      { 'id' => 'chinese-id', 'attributes' => { 'locale' => 'zh-Hans' } },
    ]

    errors = sync_build_localizations(
      BUILD_ID,
      existing,
      NOTES,
      requester: successful_requester(calls)
    )

    assert_empty errors
    assert_equal ['PATCH', 'PATCH'], calls.map { |call| call[:method] }
    assert_equal ['English notes', '中文说明'], calls.map { |call| call.dig(:body, :data, :attributes, :whatsToTest) }
  end

  def test_continues_after_one_localization_request_returns_an_error
    calls = []
    requester = lambda do |method, path, body|
      calls << { method: method, path: path, body: body }
      calls.length == 1 ? [500, 'failed'] : [200, '{}']
    end

    errors = sync_build_localizations(BUILD_ID, [], NOTES, requester: requester)

    assert_equal 2, calls.length
    assert_equal 1, errors.length
    assert_includes errors.first, 'en-US'
  end

  def test_continues_after_one_localization_request_raises
    calls = []
    requester = lambda do |method, path, body|
      calls << { method: method, path: path, body: body }
      raise IOError, 'connection reset' if calls.length == 1

      [200, '{}']
    end

    errors = sync_build_localizations(BUILD_ID, [], NOTES, requester: requester)

    assert_equal 2, calls.length
    assert_equal 1, errors.length
    assert_includes errors.first, 'connection reset'
  end
end
