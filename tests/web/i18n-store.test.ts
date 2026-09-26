/**
 * 화면 언어와 서버 호출 (v1.13): 첫 화면·설정 저장에서 언어가 정해지는 흐름, 모든 호출에 화면 언어가 같이 가는지.
 * 브라우저 언어는 한국어 (tests/setup-i18n.ts).
 */
import { beforeEach, describe, expect, it } from 'vitest';

interface Pending { fn: string; arg: unknown; lang: unknown; ok: (v: unknown) => void }
const queue: Pending[] = [];
function fakeRunner() {
  let onOk: (v: unknown) => void = () => {};
  const runner: Record<string, unknown> = new Proxy({}, {
    get(_t, name: string) {
      if (name === 'withSuccessHandler') return (f: (v: unknown) => void) => { onOk = f; return runner; };
      if (name === 'withFailureHandler') return () => runner;
      return (arg: unknown, lang: unknown) => { queue.push({ fn: name, arg, lang, ok: onOk }); };
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
const VIEW = (settings: Record<string, unknown>) => ({
  settings: { notifyEnabled: true, skipHolidays: true, notifyWhenEmpty: true, todayPopup: true, digestHour: 7, backupKeep: 8, ...settings },
  updatedAt: 'u1', digestHours: [5, 6, 7, 8, 9, 10], limits: { backupKeepMax: 100, testMailPerDay: 5 }, triggers: { digest: 1, backup: 1 }, recentLog: [],
});

type Store = typeof import('../../src/store');
type I18n = typeof import('../../src/i18n');
let s: Store;
let i18n: I18n;

beforeEach(async () => {
  queue.length = 0;
  i18n = await import('../../src/i18n');
  i18n.setLang('ko');
  s = await import('../../src/store');
});

async function boot(settings: Record<string, unknown>) {
  const p = s.init();
  await flush();
  const call = take('apiBootstrap');
  call.ok(okRes({ today: '2026-09-25', projects: [], settings, limits: {} }));
  await p;
  return call;
}

describe('첫 화면', () => {
  it('설정 값을 받기 전이라 브라우저 언어를 보내고, 입력이 없는 호출도 (null, 언어)로 부른다', async () => {
    const call = await boot({ language: 'auto' });
    expect(call.arg).toEqual({ browserLang: 'ko' });
    expect(call.lang).toBe('ko');
    expect(i18n.lang.value).toBe('ko');
    void s.fetchTrash();
    await flush();
    const trash = take('apiGetTrash');
    expect(trash.arg).toBeNull();
    expect(trash.lang).toBe('ko');
  });

  it('언어를 지정했으면 브라우저 언어와 상관없이 그 언어, 이후 호출도 그 언어', async () => {
    await boot({ language: 'ja' });
    expect(i18n.lang.value).toBe('ja');
    expect(s.store.settings.language).toBe('ja');
    void s.fetchTrash();
    await flush();
    expect(take('apiGetTrash').lang).toBe('ja');
  });

  it('이전 버전 서버(language 없음)는 자동', async () => {
    await boot({});
    expect(s.store.settings.language).toBe('auto');
    expect(i18n.lang.value).toBe('ko');
  });
});

describe('설정 저장', () => {
  it('일본어로 저장하면 바로 바뀌고, 캘린더 데이터를 다시 받는다 (서버 문구 갱신)', async () => {
    await boot({ language: 'auto' });
    // 캘린더 범위를 불러 둔 상태
    const r = s.loadRange('2026-09-01', '2026-09-30');
    await flush();
    take('apiGetRange').ok(okRes({ from: '2026-09-01', to: '2026-09-30', schedules: [], worklogs: [], diaries: [], calendarEvents: [], calendarError: '구글 캘린더 일정을 불러오지 못했습니다.', holidays: [], holidayCalendarAvailable: true }));
    await r;

    const p = s.saveAppSettings({ notifyEnabled: true, skipHolidays: true, notifyWhenEmpty: true, todayPopup: true, digestHour: 7, backupKeep: 8, language: 'ja', updatedAt: '' });
    await flush();
    const save = take('apiSaveSettings');
    expect(save.lang).toBe('ko'); // 저장 요청은 지금 화면 언어로
    save.ok(okRes(VIEW({ language: 'ja' })));
    await p;
    expect(i18n.lang.value).toBe('ja');
    await flush();
    const reload = take('apiGetRange');
    expect(reload.lang).toBe('ja');
    expect(reload.arg).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('언어가 바뀌면 남아 있던 오류 문구를 지우고, 열린 검색은 새 언어로 다시 한다', async () => {
    await boot({ language: 'auto' });
    s.store.search.active = true;
    s.store.search.keyword = 'DB';
    s.store.search.error = '옛 오류';
    s.store.diary.error = '옛 오류';
    s.store.diary.search.error = '옛 오류';
    const p = s.saveAppSettings({ notifyEnabled: true, skipHolidays: true, notifyWhenEmpty: true, todayPopup: true, digestHour: 7, backupKeep: 8, language: 'ja', updatedAt: '' });
    await flush();
    take('apiSaveSettings').ok(okRes(VIEW({ language: 'ja' })));
    await p;
    await flush();
    expect(s.store.search.error).toBe('');
    expect(s.store.diary.error).toBe('');
    expect(s.store.diary.search.error).toBe('');
    const search = take('apiSearch');
    expect(search.lang).toBe('ja');
    expect(search.arg).toMatchObject({ keyword: 'DB' });
    s.store.search.active = false;
  });

  it('언어가 그대로면 다시 받지 않는다', async () => {
    await boot({ language: 'auto' });
    const p = s.saveAppSettings({ notifyEnabled: false, skipHolidays: true, notifyWhenEmpty: true, todayPopup: true, digestHour: 7, backupKeep: 8, language: 'ko', updatedAt: '' });
    await flush();
    take('apiSaveSettings').ok(okRes(VIEW({ language: 'ko' })));
    await p;
    await flush();
    expect(queue.some((q) => q.fn === 'apiGetRange')).toBe(false);
  });

  it('설정 창을 열 때 다른 기기에서 바꾼 언어도 반영', async () => {
    await boot({ language: 'auto' });
    const p = s.fetchSettings();
    await flush();
    take('apiGetSettings').ok(okRes(VIEW({ language: 'ja' })));
    await p;
    expect(i18n.lang.value).toBe('ja');
  });
});
