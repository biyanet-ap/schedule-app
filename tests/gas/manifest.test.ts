import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(new URL('../../config/appsscript.json', import.meta.url), 'utf8'));

describe('appsscript.json', () => {
  it('웹앱은 "나로 실행 / 나만 접근"', () => {
    expect(manifest.webapp).toEqual({ executeAs: 'USER_DEPLOYING', access: 'MYSELF' });
  });
  it('JST, V8, 스코프 명시 (캘린더는 읽기 전용)', () => {
    expect(manifest.timeZone).toBe('Asia/Tokyo');
    expect(manifest.runtimeVersion).toBe('V8');
    expect(manifest.oauthScopes).toContain('https://www.googleapis.com/auth/calendar.readonly');
    expect(manifest.oauthScopes).not.toContain('https://www.googleapis.com/auth/calendar');
  });
});
