/// <reference types="node" />
/// <reference types="jest" />

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const scannerSource = readFileSync(
  join(process.cwd(), 'modules', 'qr-scanner', 'ios', 'QrScannerModule.swift'),
  'utf8'
);

describe('iOS QR scanner controls', () => {
  it('keeps the cancel button in the interactive scanner view', () => {
    expect(scannerSource).toContain('scanner.view.addSubview(cancelBtn)');
    expect(scannerSource).toContain(
      'cancelBtn.topAnchor.constraint(equalTo: scanner.view.safeAreaLayoutGuide.topAnchor'
    );
    expect(scannerSource).not.toContain('overlay.addSubview(cancelBtn)');
  });

  it('keeps noninteractive scan decorations in the VisionKit overlay', () => {
    expect(scannerSource).toContain('overlay.addSubview(reticle)');
    expect(scannerSource).toContain('overlay.addSubview(hint)');
  });
});
