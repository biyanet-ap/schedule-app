/**
 * 설정 상태(store.ts, v1.12): 첫 화면의 todayPopup과 설정 저장 반영.
 */
import { beforeEach, describe, expect, it } from 'vitest';

interface Pending { fn: string; arg: unknown; ok: (v: unknown) => void }
const queue: Pending[] = [];
function fakeRunner() {
  let onOk: (v: unknown) => void = () => {};
  const runner: Record<string, unknown> = new Proxy({}, {
    get(_t, name: string) {
      if (name === 'withSuccessHandler') return (f: (v: unknown) => void) => { onOk = f; return runner; };
      if (name === 'withFailureHandler') return () => runner;
      return (arg: unknown) => { queue.push({ fn: name, arg, ok: onOk }); };
    },
  });
  return runner;
}
(globalThis as unknown as { google: unknown }).google = { script: { get run() { return fakeRunner(); } } };
const flush = () => new Promise((r) => setTimeout(r, 0));
function take(fn: string): Pending {
  const i = queue.findIndex((q) => q.fn === fn);
  if (i < 0) throw new Error('호출 없음: ' + fn);
  return queue.splice(i, 1)[0];
}
const okRes = (data: unknown) => ({ ok: true, data });

type Store = typeof import('../../src/store');
let s: Store;
async function boot(settings: Record<string, unknown>) {
  s = await import('../../src/store');
  const p = s.init();
  await flush();
  take('apiBootstrap').ok(okRes({ today: '2026-09-25', projects: [], settings, limits: {} }));
  await p;
}

beforeEach(() => { queue.length = 0; });

describe('오늘 요약 팝업 설정', () => {
  it('이전 버전 서버(todayPopup 없음)는 켜짐으로 본다', async () => {
    await boot({ notifyEnabled: true, skipHolidays: true });
    expect(s.store.settings.todayPopup).toBe(true);
  });

  it('서버가 끔이면 끔, 설정 창에서 저장하면 바로 반영', async () => {
    await boot({ notifyEnabled: true, skipHolidays: true, todayPopup: false });
    expect(s.store.settings.todayPopup).toBe(false);
    const input = { notifyEnabled: true, skipHolidays: true, notifyWhenEmpty: true, todayPopup: true, digestHour: 8, backupKeep: 8, language: 'auto' as const, updatedAt: '' };
    const p = s.saveAppSettings(input);
    await flush();
    const call = take('apiSaveSettings');
    // v1.13: '자동'일 때 메일 언어를 정하도록 이 브라우저의 언어도 보낸다
    expect(call.arg).toEqual({ ...input, browserLang: 'ko' });
    call.ok(okRes({ settings: { ...input, updatedAt: undefined }, updatedAt: 'u1', digestHours: [5, 6, 7, 8, 9, 10], triggers: { digest: 1, backup: 1 }, recentLog: [], digestTriggerReplaced: true }));
    const v = await p;
    expect(v.digestTriggerReplaced).toBe(true);
    expect(s.store.settings.todayPopup).toBe(true);
  });

  it('설정 창을 열 때 다른 기기에서 바꾼 팝업 설정도 반영', async () => {
    await boot({ todayPopup: true });
    const p = s.fetchSettings();
    await flush();
    take('apiGetSettings').ok(okRes({
      settings: { notifyEnabled: true, skipHolidays: true, notifyWhenEmpty: true, todayPopup: false, digestHour: 7, backupKeep: 8 },
      updatedAt: 'u2', digestHours: [5, 6, 7, 8, 9, 10], limits: { backupKeepMax: 100, testMailPerDay: 5 }, triggers: { digest: 1, backup: 1 }, recentLog: [],
    }));
    await p;
    expect(s.store.settings.todayPopup).toBe(false);
  });
});
