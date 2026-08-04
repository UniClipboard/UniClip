import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  const absolutePath = path.join(process.cwd(), relativePath);
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : '';
}

describe('iOS Share large-file handoff', () => {
  it('stages arbitrary files without materializing the whole file as Data', () => {
    const item = read('targets/share/ShareItem.swift');
    const handoff = read('targets/share/OutboundShareHandoff.swift');

    expect(item).toContain('case file(StagedShareFile)');
    expect(item).toContain('loadFileRepresentation');
    expect(item).not.toContain('case file(name: String, bytes: Data)');
    expect(item).not.toMatch(/readFileURL[\s\S]*?Data\(contentsOf:/);
    expect(handoff).toContain('let copyBufferBytes = 1 * 1024 * 1024');
    expect(handoff).toContain('InputStream(url: sourceURL)');
    expect(handoff).toContain('OutputStream(url: temporaryURL, append: false)');
  });

  it('keeps exactly 100 MiB in the Share extension and hands larger files to the app', () => {
    const handoff = read('targets/share/OutboundShareHandoff.swift');
    const rootView = read('targets/share/ShareRootView.swift');

    expect(handoff).toContain('directSendLimitBytes: Int64 = 100 * 1024 * 1024');
    expect(handoff).toContain('byteCount <= directSendLimitBytes');
    expect(rootView).toContain('case handedOff');
    expect(rootView).toContain('enqueue(');
    expect(rootView).toContain('文件已保存，请打开 UniClip 继续发送');
  });

  it('hands a direct file to the app after connection recovery times out', () => {
    const handoff = read('targets/share/OutboundShareHandoff.swift');
    const rootView = read('targets/share/ShareRootView.swift');

    expect(handoff).toContain('OutboundShareFallbackPolicy');
    expect(rootView).toContain('internal import UcEngineCore');
    expect(rootView).toContain('ExtensionPeerConnectionError.connectionTimedOut');
    expect(rootView).toContain('OutboundShareFallbackPolicy.shouldHandoff');
    expect(rootView).toMatch(/case \.file\(let staged\)[\s\S]*?enqueue\(/);
    expect(rootView).not.toMatch(/case \.text[\s\S]{0,200}?enqueue\(/);
    expect(rootView).not.toMatch(/case \.image[\s\S]{0,200}?enqueue\(/);
  });

  it('uses atomic pending and processing records with recovery and stale cleanup', () => {
    const handoff = read('targets/share/OutboundShareHandoff.swift');

    expect(handoff).toContain('outbound-handoff');
    expect(handoff).toContain('pending');
    expect(handoff).toContain('processing');
    expect(handoff).toContain('.atomic');
    expect(handoff).toContain('claimPendingJobs');
    expect(handoff).toContain('releaseJob');
    expect(handoff).toContain('completeJob');
    expect(handoff).toContain('removeExpiredJobs');
  });

  it('lets the main app claim handoffs without loading history files into memory', () => {
    const nativeModule = read('modules/app-group-store/ios/AppGroupStoreModule.swift');
    const historyStorage = read('src/features/history/internal/historyStorage.ts');
    const app = read('App.tsx');

    expect(nativeModule).toContain('claimOutboundShareJobs');
    expect(nativeModule).toContain('completeOutboundShareJob');
    expect(nativeModule).toContain('releaseOutboundShareJob');
    expect(nativeModule).toContain('importPayloadFile');
    expect(nativeModule).not.toContain('sendOutboundLanFile');
    expect(nativeModule).toContain('copyItem(at: sourceURL, to: temporaryURL)');
    expect(historyStorage).toContain('importPayloadFile');
    expect(historyStorage).not.toContain('const data = await sourceFile.arrayBuffer()');
    expect(app).toContain('resumeOutboundShareHandoffs');
  });
});
