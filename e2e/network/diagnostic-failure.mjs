import { waitForConnectionTimeout } from './wait-for-timeout.mjs';
import { desktopPeer } from './desktop-peer.mjs';

export async function runDiagnosticFailure({ scenario, cli, output, runFlow, platform, id }) {
  const peer = desktopPeer(cli, output);
  try {
    const code = await peer.prepare();
    const authentication = scenario === 'diagnostic-auth-failure';
    if (!authentication) peer.pause();
    await runFlow(authentication ? 'diagnostic-failure' : 'diagnostic-connecting', {
      INVITATION_CODE: code,
      SPACE_PASSWORD: authentication ? `Wrong-${peer.passphrase}` : peer.passphrase,
      EXPECTED_FAILURE: authentication
        ? 'The space password is incorrect.*|The other device did not accept this invitation'
        : 'The connection timed out.*|The other device cannot be reached right now|The connection was interrupted.*',
    });
    if (!authentication) {
      await waitForConnectionTimeout({ platform, id, output });
      await runFlow('diagnostic-cancel-export', {});
    }
  } finally {
    peer.resume();
    await peer.dispose();
  }
}
