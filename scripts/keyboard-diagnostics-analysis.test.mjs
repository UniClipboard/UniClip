import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyzeKeyboardEvents,
  selectLatestKeyboardSession,
} from './keyboard-diagnostics-analysis.mjs';

function event(eventName, fields = {}) {
  return { event: eventName, fields };
}

test('accepts isolated sync and non-empty error updates', () => {
  const failures = analyzeKeyboardEvents([
    event('view.card.update.plan', {
      updateID: '1',
      reason: 'syncButton',
      affectedIDs: '',
      insertedIDs: '',
      removedIDs: '',
      movedIDs: '',
      reconfiguredIDs: '',
    }),
    event('view.card.update.plan', {
      updateID: '2',
      reason: 'error',
      affectedIDs: '',
      insertedIDs: '',
      removedIDs: '',
      movedIDs: '',
      reconfiguredIDs: '',
    }),
  ]);

  assert.deepEqual(failures, []);
});

test('rejects card operations caused by sync or non-empty error updates', () => {
  const failures = analyzeKeyboardEvents([
    event('view.card.update.plan', {
      updateID: '1',
      reason: 'syncButton',
      reconfiguredIDs: 'card-a',
    }),
    event('view.card.update.plan', {
      updateID: '2',
      reason: 'error',
      insertedIDs: 'card-new',
    }),
  ]);

  assert.deepEqual(
    failures.map(({ kind }) => kind),
    ['unexpected-card-operation', 'unexpected-card-operation']
  );
});

test('rejects unrelated action reconfiguration requests', () => {
  const failures = analyzeKeyboardEvents([
    event('view.card.update.plan', {
      updateID: '7',
      reason: 'cardAction',
      affectedIDs: 'card-b',
      reconfiguredIDs: 'card-a,card-b,card-c',
    }),
  ]);

  assert.deepEqual(
    failures.map(({ kind }) => kind),
    ['unrelated-card-reconfiguration']
  );
  assert.match(failures[0].message, /card-a,card-c/);
});

test('accepts at most the previous and current action cards', () => {
  const failures = analyzeKeyboardEvents([
    event('view.card.update.plan', {
      updateID: '8',
      reason: 'cardAction',
      affectedIDs: 'card-a,card-b',
      reconfiguredIDs: 'card-a,card-b',
    }),
    event('view.card.configure', { updateID: '8', cardID: 'card-a' }),
    event('view.card.configure', { updateID: '8', cardID: 'card-b' }),
  ]);

  assert.deepEqual(failures, []);
});

test('rejects an actually configured card outside the action plan', () => {
  const failures = analyzeKeyboardEvents([
    event('view.card.update.plan', {
      updateID: '9',
      reason: 'cardAction',
      affectedIDs: 'card-b',
      reconfiguredIDs: 'card-b',
    }),
    event('view.card.configure', { updateID: '9', cardID: 'card-a' }),
  ]);

  assert.deepEqual(
    failures.map(({ kind }) => kind),
    ['unrelated-card-configuration']
  );
});

test('rejects any card actually configured by sync or non-empty error updates', () => {
  const failures = analyzeKeyboardEvents([
    event('view.card.update.plan', {
      updateID: '10',
      reason: 'error',
      affectedIDs: '',
      reconfiguredIDs: '',
    }),
    event('view.card.configure', { updateID: '10', cardID: 'card-a' }),
    event('view.card.update.plan', {
      updateID: '11',
      reason: 'syncButton',
      affectedIDs: '',
      reconfiguredIDs: '',
    }),
    event('view.card.configure', { updateID: '11', cardID: 'card-b' }),
  ]);

  assert.deepEqual(
    failures.map(({ kind }) => kind),
    ['unexpected-card-configuration', 'unexpected-card-configuration']
  );
});

test('accepts ordinary card rendering and retains the keyboard-height check', () => {
  const failures = analyzeKeyboardEvents([
    event('view.render', { surface: 'cards', count: '2' }),
    event('controller.layout', {
      controllerID: 'controller-a',
      height: '800',
      surfaceHeight: '800',
    }),
    event('controller.layout', {
      controllerID: 'controller-a',
      height: '258',
      surfaceHeight: '258',
    }),
  ]);

  assert.deepEqual(
    failures.map(({ kind }) => kind),
    ['full-height-jump']
  );
});

test('does not mix layout events from different diagnostic sessions', () => {
  const failures = analyzeKeyboardEvents([
    {
      ...event('controller.layout', {
        controllerID: 'controller-a',
        height: '800',
        surfaceHeight: '800',
      }),
      sessionID: 'a',
    },
    {
      ...event('controller.layout', {
        controllerID: 'controller-a',
        height: '258',
        surfaceHeight: '258',
      }),
      sessionID: 'b',
    },
  ]);

  assert.deepEqual(failures, []);
});

test('selects the session containing the most recent event', () => {
  const events = [
    { ...event('diagnostics.session'), sessionID: 'newer-start', timestampMs: 20 },
    { ...event('view.render'), sessionID: 'older-start', timestampMs: 30 },
    { ...event('view.render'), sessionID: 'newer-start', timestampMs: 40 },
  ];

  assert.deepEqual(
    selectLatestKeyboardSession(events).map(({ sessionID }) => sessionID),
    ['newer-start', 'newer-start']
  );
});
