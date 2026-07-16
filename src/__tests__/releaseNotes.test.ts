/// <reference types="node" />
/// <reference types="jest" />

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectLocalizedReleaseNotes } from '../services/UpdateService';

const scriptPath = join(__dirname, '..', '..', 'scripts', 'release-notes.mjs');

function writeChangelog(root: string, name: string, content: string): void {
  writeFileSync(join(root, name), content.trimStart());
}

describe('localized release note generation', () => {
  let root: string;
  let outDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'uniclip-release-notes-'));
    outDir = join(root, 'output');
    mkdirSync(outDir);

    writeChangelog(
      root,
      'CHANGES.md',
      `
        v1.3.0.161

        ### 通用
        - 中文通用

        ### iOS
        - 中文 iOS

        ### Android
        - 中文 Android

        v1.3.0.160
        - 历史版本
      `
        .split('\n')
        .map((line) => line.trimStart())
        .join('\n')
    );
    writeChangelog(
      root,
      'CHANGES.en.md',
      `
        v1.3.0.161

        ### Common
        - English common

        ### iOS
        - English iOS

        ### Android
        - English Android
      `
        .split('\n')
        .map((line) => line.trimStart())
        .join('\n')
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes a bilingual release body and localized platform files', () => {
    const result = spawnSync(process.execPath, [scriptPath, '--root', root, '--out-dir', outDir], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    const github = readFileSync(join(outDir, 'release-notes-github.md'), 'utf8');
    expect(github).toContain('## [zh-CN] 简体中文');
    expect(github).toContain('### Android\n- 中文通用\n- 中文 Android');
    expect(github).toContain('### iOS\n- 中文通用\n- 中文 iOS');
    expect(github).toContain('## [en] English');
    expect(github).not.toContain('<!--');
    expect(github).toContain('### Android\n- English common\n- English Android');
    expect(github).toContain('### iOS\n- English common\n- English iOS');
    expect(selectLocalizedReleaseNotes(github, 'zh-CN')).toBe(
      '### Android\n- 中文通用\n- 中文 Android\n\n### iOS\n- 中文通用\n- 中文 iOS'
    );
    expect(selectLocalizedReleaseNotes(github, 'en')).toBe(
      '### Android\n- English common\n- English Android\n\n### iOS\n- English common\n- English iOS'
    );

    expect(readFileSync(join(outDir, 'release-notes-testflight.txt'), 'utf8')).toBe(
      '- 中文通用\n- 中文 iOS\n'
    );
    expect(readFileSync(join(outDir, 'release-notes-testflight.en.txt'), 'utf8')).toBe(
      '- English common\n- English iOS\n'
    );
  });

  it('checks note generation without writing release artifacts', () => {
    const result = spawnSync(
      process.execPath,
      [scriptPath, '--root', root, '--out-dir', outDir, '--check'],
      {
        encoding: 'utf8',
      }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('validated release-notes for v1.3.0.161');
    expect(() => readFileSync(join(outDir, 'release-notes-github.md'), 'utf8')).toThrow();
  });

  it('rejects an empty English top section during validation', () => {
    writeChangelog(root, 'CHANGES.en.md', 'v1.3.0.161\n\nv1.3.0.160\n- Historical note\n');

    const result = spawnSync(process.execPath, [scriptPath, '--root', root, '--check'], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no changelog bullets found in CHANGES.en.md');
  });

  it('rejects changelogs whose top release tags differ', () => {
    writeChangelog(root, 'CHANGES.en.md', 'v1.3.0.160\n- Wrong release\n');

    const result = spawnSync(process.execPath, [scriptPath, '--root', root, '--out-dir', outDir], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must start with the same version');
  });
});
