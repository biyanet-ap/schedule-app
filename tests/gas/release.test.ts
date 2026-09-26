import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { concatGas, listReleaseFiles, parsePrivatePatterns, scanForPrivate } from '../../scripts/release-lib.mjs';
import { createGas, ok, type ApiResult } from './harness';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

describe('전달 패키지 파일 목록', () => {
  it('허용 목록만 포함하고 계정 연결 정보·문서·빌드 산출물은 뺀다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-'));
    const put = (p: string, c = 'x') => {
      mkdirSync(join(dir, p, '..'), { recursive: true });
      writeFileSync(join(dir, p), c);
    };
    ['README.md', 'package.json', '.clasp.json', 'release.private.txt', 'docs/PRD.md', 'node_modules/a/index.js',
      'gas/00_Config.js', 'gas/index.html', 'gas/appsscript.json', 'src/main.ts', 'src/.clasp.json', 'dist/index.html'].forEach((p) => put(p));
    expect(listReleaseFiles(dir)).toEqual(['README.md', 'gas/00_Config.js', 'package.json', 'src/main.ts']);
  });

  it('실제 프로젝트에서도 docs/·.clasp.json이 빠진다', () => {
    const files = listReleaseFiles(ROOT);
    expect(files.some((f) => f.startsWith('docs/'))).toBe(false);
    expect(files.some((f) => f.endsWith('.clasp.json'))).toBe(false);
    expect(files).toContain('gas/60_Api.js');
    expect(files).toContain('scripts/make-release.mjs');
    // v1.14 로고 원본과 아이콘, 서버에 넣는 파비콘 데이터
    expect(files).toContain('assets/logo.svg');
    expect(files).toContain('gas/09_FaviconData.js');
    expect(files).toContain('gas/52_FaviconService.js');
  });
});

describe('개인정보 검사', () => {
  const patterns = parsePrivatePatterns('# 주석\nsecret-corp\n\nre:\\bbob\\b\n');

  it('부분 일치(대소문자 무시)와 정규식, 파일 경로까지 검사', () => {
    const hits = scanForPrivate([
      { path: 'a.ts', content: 'ok\nby SECRET-Corp team' },
      { path: 'b.ts', content: 'bobby is fine\nhi bob' },
      { path: 'secret-corp/c.ts', content: '' },
    ], patterns);
    expect(hits).toEqual([
      { path: 'a.ts', line: 2, pattern: 'secret-corp' },
      { path: 'b.ts', line: 2, pattern: 're:\\bbob\\b' },
      { path: 'secret-corp/c.ts', line: 0, pattern: 'secret-corp' },
    ]);
  });

  it('패턴이 없으면 빈 목록', () => {
    expect(parsePrivatePatterns('# only comments\n\n')).toEqual([]);
  });
});

describe('브라우저 설치용 Code.gs (파일 하나로 합친 서버 코드)', () => {
  it('합친 코드만으로 setup → 저장 → 조회 → 자가 점검이 동작한다', () => {
    const gas = createGas({ sources: [{ name: 'Code.gs', code: concatGas(ROOT) }] });
    gas.call('setup');
    ok(gas.call('apiSaveSchedule', { title: '합친 코드 확인', startAt: '2026-09-24T10:00', endAt: '2026-09-24T11:00', tags: ['점검'] }));
    const r = ok(gas.call<ApiResult<{ schedules: Array<{ title: string; tags: string[] }> }>>('apiGetRange', { from: '2026-09-24', to: '2026-09-24' }));
    expect(r.schedules).toEqual([expect.objectContaining({ title: '합친 코드 확인', tags: ['점검'] })]);
    expect(gas.call<string>('runSelfTest')).not.toContain('[FAIL]');
  });
});
