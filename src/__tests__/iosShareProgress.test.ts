/// <reference types="jest" />

import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  const absolutePath = path.join(process.cwd(), relativePath);
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : '';
}

const shareSources = () =>
  ['ShareViewController.swift', 'ShareItem.swift', 'OutboundShareHandoff.swift'].map((file) =>
    read(`targets/share/${file}`)
  );

describe('iOS Share dumb-extension constraints', () => {
  it('presents no SwiftUI view and hosts no custom UI', () => {
    const viewController = read('targets/share/ShareViewController.swift');

    expect(viewController).toContain('final class ShareViewController: UIViewController');
    expect(viewController).toContain('override func viewDidLoad()');
    expect(viewController).not.toContain('import SwiftUI');
    expect(viewController).not.toContain('UIHostingController');
    expect(viewController).not.toContain('SLComposeServiceViewController');
    expect(fs.existsSync(path.join(process.cwd(), 'targets/share/ShareRootView.swift'))).toBe(
      false
    );
    expect(fs.existsSync(path.join(process.cwd(), 'targets/share/ShareUploader.swift'))).toBe(
      false
    );
    expect(
      fs.existsSync(path.join(process.cwd(), 'targets/share/RecipientLoadErrorPresentation.swift'))
    ).toBe(false);
    expect(
      fs.existsSync(path.join(process.cwd(), 'targets/share/ExtensionLocalization.swift'))
    ).toBe(false);
  });

  it('never starts a P2P session inside the extension', () => {
    const sources = shareSources();

    expect(sources.join('\n')).not.toMatch(/ExtensionSyncRouter|ExtensionP2pClient|UcEngineCore/);
    const pods = read('targets/share/pods.rb');
    expect(pods).not.toContain('UcEngineCore');
  });

  it('opens the host share page only after the extension view is visible', () => {
    const viewController = read('targets/share/ShareViewController.swift');

    expect(viewController.indexOf('completeRequest')).toBeGreaterThan(-1);
    expect(viewController).toContain('override func viewDidAppear');
    expect(viewController).toContain('ShareItemExtractor.extract');
    expect(viewController).toContain('OutboundShareStore().stage(item)');
    expect(viewController).toContain('OutboundShareStore().enqueue(staged)');
    expect(viewController).toContain('recordInHistory(staged)');
    expect(viewController).toContain('HistoryLog(store: SettingsStore())');
    expect(viewController).toContain('PayloadCache.shared.writeFile');
    expect(viewController).toContain('sequence(first: self, next: \\.next)');
    expect(viewController).toContain('.first(where: { $0 is UIApplication })');
    expect(viewController).toContain('application.open(handoffURL');
    expect(viewController).not.toContain('context.open(handoffURL)');
    expect(viewController.indexOf('viewDidAppear')).toBeLessThan(
      viewController.indexOf('application.open(handoffURL')
    );
    expect(viewController.indexOf('application.open(handoffURL')).toBeLessThan(
      viewController.lastIndexOf('completeRequest(returningItems: nil')
    );
    expect(viewController).toContain('ShareDiagnosticsStore');
    expect(viewController).toContain('record(stage: .staged)');
    expect(viewController).toContain('completeRequest(returningItems: nil');
  });

  it('stages by kind with a job model that carries the kind', () => {
    const item = read('targets/share/ShareItem.swift');
    const handoff = read('targets/share/OutboundShareHandoff.swift');

    expect(item).toContain('func stage(_ item: ShareItem)');
    expect(item).toContain('return try stageText(text)');
    expect(item).toContain('kind: .image');
    expect(item).toContain('case .file(let staged):');
    expect(handoff).toContain('enum JobKind: String, Codable');
    expect(handoff).toContain('case text');
    expect(handoff).toContain('case image');
    expect(handoff).toContain('case file');
    expect(handoff).toContain('kind: JobKind');
    expect(handoff).toContain('decodeIfPresent(JobKind.self, forKey: .kind) ?? .file');
    expect(handoff).toContain('func stageText(');
  });

  it('localizes no share-sheet UI anymore (lproj resources removed)', () => {
    for (const locale of ['zh-Hans', 'en', 'pt-BR', 'ru']) {
      expect(fs.existsSync(path.join(process.cwd(), `targets/share/${locale}.lproj`))).toBe(false);
    }
    const item = read('targets/share/ShareItem.swift');
    expect(item).not.toContain('ExtensionLocalization');
    expect(item).not.toContain('message(using:');
  });
});
