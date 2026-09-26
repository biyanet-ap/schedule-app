/**
 * 다이어리 상태 관리(store.ts) 테스트.
 * google.script.run을 가짜로 바꿔서 서버 응답 순서를 직접 정한다 (늦게 온 응답·동시 저장 재현용).
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Diary } from '../../src/api/types';

interface Pending { fn: string; arg: unknown; ok: (v: unknown) => void }
const queue: Pending[] = [];
const calls: string[] = [];

function fakeRunner() {
  let onOk: (v: unknown) => void = () => {};
  const runner: Record<string, unknown> = new Proxy({}, {
    get(_t, name: string) {
      if (name === 'withSuccessHandler') return (f: (v: unknown) => void) => { onOk = f; return runner; };
      if (name === 'withFailureHandler') return () => runner;
      return (arg: unknown) => { calls.push(name); queue.push({ fn: name, arg, ok: onOk }); };
    },
  });
  return runner;
}
(globalThis as unknown as { google: unknown }).google = { script: { get run() { return fakeRunner(); } } };

const flush = () => new Promise((r) => setTimeout(r, 0));
/** 가장 먼저 들어온 fn 호출을 꺼낸다 */
function take(fn: string): Pending {
  const i = queue.findIndex((q) => q.fn === fn);
  if (i < 0) throw new Error('호출 없음: ' + fn + ' (대기: ' + queue.map((q) => q.fn).join(',') + ')');
  return queue.splice(i, 1)[0];
}
const okRes = (data: unknown) => ({ ok: true, data });
const errRes = (code: string) => ({ ok: false, error: { code, message: code } });
const D = (id: string, diaryDate: string, updatedAt = 'u1', title = 't-' + id): Diary =>
  ({ id, diaryDate, title, content: 'c', createdAt: 'c0', updatedAt });

type Store = typeof import('../../src/store');
let s: Store;

async function loadMonth(diaries: Diary[]) {
  const p = s.loadRange('2026-08-31', '2026-10-11');
  await flush();
  take('apiGetRange').ok(okRes({ from: '2026-08-31', to: '2026-10-11', schedules: [], worklogs: [], diaries, calendarEvents: [], calendarError: null, holidays: [], holidayCalendarAvailable: true }));
  await p;
}
async function loadWeek(base: string, diaries: Diary[]) {
  const p = s.loadDiaryWeek(base);
  await flush();
  take('apiGetDiaries').ok(okRes(diaries));
  await p;
}

beforeAll(async () => {
  s = await import('../../src/store');
  const p = s.init();
  await flush();
  take('apiBootstrap').ok(okRes({ today: '2026-09-25', projects: [], settings: {}, limits: {} }));
  await p;
});

beforeEach(() => {
  s.resetDiaryView();
  queue.length = 0;
  calls.length = 0;
});

describe('다이어리 상태', () => {
  it('저장 결과를 불러온 달·보는 주 양쪽에 반영, 다른 주로 옮기면 주 목록에서 빠진다', async () => {
    await loadMonth([D('a', '2026-09-24')]);
    await loadWeek('2026-09-25', [D('a', '2026-09-24')]);
    const p = s.saveDiary({ id: 'a', updatedAt: 'u1', diaryDate: '2026-10-02', title: '', content: 'c' });
    await flush();
    take('apiSaveDiary').ok(okRes(D('a', '2026-10-02', 'u2')));
    await p;
    expect(s.store.diary.list).toEqual([]);
    expect(s.store.data.diaries.map((d) => [d.id, d.diaryDate])).toEqual([['a', '2026-10-02']]);
  });

  it('다이어리 보기가 열려 있으면 그 주 날짜는 새로 불러온 주 목록 기준 (오래된 달 데이터 무시)', async () => {
    await loadMonth([D('x', '2026-09-25')]); // 다른 기기에서 삭제되기 전 상태
    await loadWeek('2026-09-25', []);
    expect(s.diaryOn('2026-09-25')).toBeUndefined();
    s.resetDiaryView(); // 캘린더로 돌아가면 달 데이터 기준
    expect(s.diaryOn('2026-09-25')?.id).toBe('x');
  });

  it('주를 불러오는 사이 저장이 끝나면, 저장 전 스냅숏으로 덮지 않고 다시 불러온다', async () => {
    await loadWeek('2026-09-25', [D('a', '2026-09-24')]);
    const reload = s.loadDiaryWeek('2026-09-25');
    await flush();
    const staleReload = take('apiGetDiaries');
    const save = s.saveDiary({ id: 'a', updatedAt: 'u1', diaryDate: '2026-09-24', title: 'new', content: 'c' });
    await flush();
    take('apiSaveDiary').ok(okRes(D('a', '2026-09-24', 'u2', 'new')));
    await save;
    staleReload.ok(okRes([D('a', '2026-09-24', 'u1')])); // 저장 전에 읽은 값
    await reload;
    await flush();
    expect(s.store.diary.list[0]).toMatchObject({ updatedAt: 'u2', title: 'new' });
    take('apiGetDiaries').ok(okRes([D('a', '2026-09-24', 'u2', 'new')])); // 다시 불러온 결과
    await flush();
    expect(s.store.diary.list[0]).toMatchObject({ updatedAt: 'u2', title: 'new' });
    expect(s.store.diary.loading).toBe(false);
  });

  it('늦게 도착한 이전 주 응답은 버린다', async () => {
    const first = s.loadDiaryWeek('2026-09-14');
    await flush();
    const late = take('apiGetDiaries');
    await loadWeek('2026-09-25', [D('b', '2026-09-23')]);
    late.ok(okRes([D('old', '2026-09-15')]));
    await first;
    expect(s.store.diary.weekStart).toBe('2026-09-21');
    expect(s.store.diary.list.map((d) => d.id)).toEqual(['b']);
  });

  it('삭제하면 양쪽에서 빠지고, CONFLICT면 달과 (열려 있는) 주를 다시 불러온다', async () => {
    await loadMonth([D('a', '2026-09-24')]);
    await loadWeek('2026-09-25', [D('a', '2026-09-24')]);
    const del = s.deleteDiary(D('a', '2026-09-24'));
    await flush();
    take('apiDeleteDiary').ok(okRes({ id: 'a' }));
    await del;
    expect(s.store.data.diaries).toEqual([]);
    expect(s.store.diary.list).toEqual([]);

    calls.length = 0;
    const bad = s.saveDiary({ diaryDate: '2026-09-24', title: '', content: 'c' }).catch((e) => e);
    await flush();
    take('apiSaveDiary').ok(errRes('CONFLICT'));
    expect((await bad).code).toBe('CONFLICT');
    await flush();
    expect(calls).toEqual(['apiSaveDiary', 'apiGetRange', 'apiGetDiaries']);
  });

  it('다이어리 보기를 닫은 뒤에는 다른 저장 실패가 다이어리를 다시 불러오지 않는다', async () => {
    await loadWeek('2026-09-25', []);
    s.resetDiaryView();
    calls.length = 0;
    const bad = s.saveSchedule({} as never).catch(() => null);
    await flush();
    take('apiSaveSchedule').ok(errRes('CONFLICT'));
    await bad;
    await flush();
    expect(calls).toEqual(['apiSaveSchedule', 'apiGetRange']);
  });
});

describe('검색 기간 (상태 관리)', () => {
  it('기간을 바꾸면 같은 검색어로 다시 검색하고 기간을 함께 보낸다, 잘못된 기간은 서버에 보내지 않는다', async () => {
    const empty = { worklogs: [], schedules: [], truncated: false };
    const search = s.runSearch('배포');
    await flush();
    const first = take('apiSearch');
    expect(first.arg).toEqual({ keyword: '배포' });
    first.ok(okRes(empty));
    await search;

    s.setSearchPeriod('THIS_MONTH');
    await flush();
    const q = take('apiSearch');
    expect(q.arg).toEqual({ keyword: '배포', from: '2026-09-01', to: '2026-09-30' });
    q.ok(okRes(empty));
    await flush();
    expect(s.store.search.result).toEqual(empty);

    calls.length = 0;
    s.setSearchPeriod('CUSTOM', { from: '2026-09-30', to: '2026-09-01' });
    await flush();
    expect(calls).toEqual([]);
    expect(s.store.search.error).toBe('검색 종료일이 시작일보다 앞설 수 없습니다.');
    expect(s.store.search.result).toBeNull();

    s.setSearchPeriod('ALL');
    await flush();
    expect(take('apiSearch').arg).toEqual({ keyword: '배포' });
    s.closeSearch();
  });
});
