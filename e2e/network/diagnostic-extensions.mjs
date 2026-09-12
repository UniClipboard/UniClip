import { createServer } from 'node:http';
import { desktopPeer } from './desktop-peer.mjs';

export async function runDiagnosticExtensions({ cli, output, runFlow }) {
  const peer = desktopPeer(cli, output);
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Keyboard Coverage</title><h1>Keyboard coverage</h1><label for="probe">Diagnostic input</label><textarea id="probe" rows="6" placeholder="Tap here for diagnostic keyboard"></textarea></html>');
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const code = await peer.prepare();
    await runFlow('join', { INVITATION_CODE: code, SPACE_PASSWORD: peer.passphrase });
    await peer.send('KeyboardHistoryProbe', 'keyboard-fixture');
    await runFlow('diagnostic-start', {});
    await runFlow('diagnostic-keyboard-enable', {});
    await runFlow('diagnostic-keyboard-use', { PROBE_URL: `http://127.0.0.1:${server.address().port}/keyboard.html` });
    await runFlow('diagnostic-share-use', {});
    await runFlow('export', {});
  } finally {
    try { await peer.dispose(); } finally {
      await new Promise(resolve => server.close(resolve));
    }
  }
}
