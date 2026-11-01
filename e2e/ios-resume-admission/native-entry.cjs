// Test entry only. The runner temporarily selects this entry and restores index.ts.
const React = require('react');
const { Text } = require('react-native');
const { registerRootComponent } = require('expo');
const { requireNativeModule } = require('expo-modules-core');
const { File, Paths } = require('expo-file-system');
const native = requireNativeModule('UcEngine');
const applicationVersion = require('expo-application').nativeApplicationVersion;
const output = new File(Paths.cache, 'crash199-result.json');
let transition;
let stage = 'starting';
const receipt = { events: [] };
function record(event) {
  receipt.events.push({ event, monotonicMs: performance.now() });
  receipt.stage = stage;
  output.write(JSON.stringify(receipt));
}
const subscription = native.addListener('onHostSuspension', event => {
  if (event.phase === 'suspend') transition = event.transitionId;
  record('host.' + event.phase);
});
async function run() {
  await native.start({ appVersion: applicationVersion, profileId: 'default' });
  stage = 'ready'; record('startup.complete');
  // The real bridge request is issued while active in B, after background suspend in A.
  const request = new File(Paths.cache, 'crash199-issue-request');
  while (!request.exists) await new Promise(resolve => setTimeout(resolve, 20));
  stage = 'request-issued'; record('bridge.resume.issued');
  await native.resume();
  stage = 'request-returned'; record('bridge.resume.returned');
  while (transition === undefined) await new Promise(resolve => setTimeout(resolve, 20));
  await native.completeHostSuspension(transition, true);
  stage = 'background-complete'; record('host.complete.returned');
}
run().catch(error => { receipt.error = String(error); stage = 'failed'; record('error'); });
registerRootComponent(() => React.createElement(Text, { testID: 'crash199-test-entry' }, 'crash199 test entry'));
