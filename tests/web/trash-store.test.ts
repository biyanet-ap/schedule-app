/**
 * 되돌리기·휴지통 복구의 상태 관리(store.ts) 테스트 (v1.11).
 * google.script.run을 가짜로 바꿔서 서버 호출 인자와 응답을 직접 확인한다.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Diary, Schedule, Worklog } from '../../src/api/types';

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
  if (i < 0) throw new Error('호출 없음: ' + fn + ' (대기: ' + queue.map((q) => q.fn).join(',') + ')');
  return queue.splice(i, 1)[0];
}
const okRes = (data: unknown) => ({ ok: true, data });
const errRes = (code: string, message = code) => ({ ok: false, error: { code, message } });

const DELETED_AT = '2026-09-25T10:00:00.000+09:00';
const RESTORED_AT = '2026-09-25T10:00:05.000+09:00';
const sched: Schedule = {
  id: 's1', type: 'TASK', title: '지울 일정', description: '', startAt: '2026-09-24T10:00', endAt: '2026-09-24T11:00', allDay: false,
  priority: 'MEDIUM', projectId: '', location: '', status: 'PLANNED', tags: [], createdAt: 'c0', updatedAt: 'u1',
};
const log: Worklog = {
  id: 'w1', workDate: '2026-09-21', endDate: '2026-09-25', title: '기간 기록', content: '', projectId: '', scheduleId: '', tags: [],
  status: 'DONE', createdAt: 'c0', updatedAt: 'u1',
};
const diary: Diary = { id: 'd1', diaryDate: '2026-09-24', title: '비', content: 'c', createdAt: 'c0', updatedAt: 'u1' };

type Store = typeof import('../../src/store');
let s: Store;

async function loadMonth(data: { schedules?: Schedule[]; worklogs?: Worklog[]; diaries?: Diary[] }) {
  const p = s.loadRange('2026-08-31', '2026-10-11');
  await flush();
  take('apiGetRange').ok(okRes({
    from: '2026-08-31', to: '2026-10-11', schedules: data.schedules ?? [], worklogs: data.worklogs ?? [], diaries: data.diaries ?? [],
    calendarEvents: [], calendarError: null, holidays: [], holidayCalendarAvailable: true,
  }));
  await p;
}
const lastToast = () => s.store.toasts[s.store.toasts.length - 1];

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
  s.store.toasts.splice(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('삭제 직후 되돌리기', () => {
  it('삭제 → "되돌리기" 알림 → 누르면 알림이 바로 닫히고 삭제 시각으로 복구 → 캘린더에 다시 보임', async () => {
    await loadMonth({ schedules: [sched] });
    const p = s.deleteSchedule(sched);
    await flush();
    const del = take('apiDeleteSchedule');
    expect(del.arg).toEqual({ id: 's1', updatedAt: 'u1' });
    del.ok(okRes({ id: 's1', updatedAt: DELETED_AT }));
    s.notifyDeleted('SCHEDULE', await p);
    expect(s.store.data.schedules).toEqual([]);

    const t = lastToast();
    expect(t).toMatchObject({ kind: 'success', message: '일정을 삭제했습니다.' });
    expect(t.action?.label).toBe('되돌리기');

    s.runToastAction(t);
    expect(s.store.toasts.find((x) => x.id === t.id)).toBeUndefined(); // 두 번 누를 수 없게 먼저 닫힘
    await flush();
    const r = take('apiRestoreSchedule');
    expect(r.arg).toEqual({ id: 's1', updatedAt: DELETED_AT });
    r.ok(okRes({ ...sched, updatedAt: RESTORED_AT }));
    await flush();
    expect(s.store.data.schedules.map((x) => [x.id, x.updatedAt])).toEqual([['s1', RESTORED_AT]]);
    expect(lastToast().message).toBe('되살렸습니다.');
  });

  it('되돌리기가 성공하면 휴지통 창이 목록을 다시 받도록 trashRevision이 오른다', async () => {
    await loadMonth({});
    const before = s.store.trashRevision;
    s.notifyDeleted('SCHEDULE', { id: 's1', updatedAt: DELETED_AT });
    s.runToastAction(lastToast());
    await flush();
    take('apiRestoreSchedule').ok(okRes({ ...sched, updatedAt: RESTORED_AT }));
    await flush();
    expect(s.store.trashRevision).toBe(before + 1);
  });

  it('마우스를 올려 둔 알림은 닫히지 않고, 뗀 뒤 4초 뒤에 닫힌다', () => {
    vi.useFakeTimers();
    s.notifyDeleted('SCHEDULE', { id: 's1', updatedAt: DELETED_AT });
    const t = lastToast();
    vi.advanceTimersByTime(9000);
    s.holdToast(t.id);
    vi.advanceTimersByTime(60000);
    expect(s.store.toasts.map((x) => x.id)).toEqual([t.id]);
    s.releaseToast(t.id);
    vi.advanceTimersByTime(3900);
    expect(s.store.toasts).toHaveLength(1);
    vi.advanceTimersByTime(100);
    expect(s.store.toasts).toHaveLength(0);
  });

  it('이전 버전 서버(삭제 시각 없음)면 버튼 없는 알림', () => {
    s.notifyDeleted('WORKLOG', { id: 'w1' });
    expect(lastToast()).toMatchObject({ message: '작업기록을 삭제했습니다.' });
    expect(lastToast().action).toBeUndefined();
  });

  it('버튼 있는 알림은 10초, 없는 성공 알림은 3초 뒤에 닫힌다', () => {
    vi.useFakeTimers();
    s.notifyDeleted('DIARY', { id: 'd1', updatedAt: DELETED_AT });
    s.notifyDeleted('DIARY', { id: 'd2' });
    expect(s.store.toasts).toHaveLength(2);
    vi.advanceTimersByTime(3000);
    expect(s.store.toasts.map((x) => x.action?.label)).toEqual(['되돌리기']);
    vi.advanceTimersByTime(7000);
    expect(s.store.toasts).toHaveLength(0);
  });

  it('되돌리기가 실패하면(이미 복구됨) 오류 알림, 캘린더를 새로 불러온다', async () => {
    await loadMonth({});
    s.notifyDeleted('WORKLOG', { id: 'w1', updatedAt: DELETED_AT });
    s.runToastAction(lastToast());
    await flush();
    take('apiRestoreWorklog').ok(errRes('NOT_FOUND', '이미 복구됐거나 찾을 수 없는 작업기록 항목입니다.'));
    await flush();
    expect(lastToast()).toMatchObject({ kind: 'error', message: '이미 복구됐거나 찾을 수 없는 작업기록 항목입니다.' });
    expect(queue.some((q) => q.fn === 'apiGetRange')).toBe(true);
  });
});

describe('휴지통 복구 반영', () => {
  it('범위를 불러오는 도중에 복구되면, 늦게 온 (복구 전) 응답으로 덮지 않고 다시 불러온다', async () => {
    await loadMonth({});
    const load = s.loadRange('2026-09-28', '2026-11-08');
    await flush();
    const pendingRange = take('apiGetRange');
    const r = s.restoreItem('SCHEDULE', 's1', DELETED_AT);
    await flush();
    take('apiRestoreSchedule').ok(okRes({ ...sched, startAt: '2026-10-01T10:00', endAt: '2026-10-01T11:00', updatedAt: RESTORED_AT }));
    await r;
    // 복구 전에 읽힌 응답 (s1 없음)
    pendingRange.ok(okRes({ from: '2026-09-28', to: '2026-11-08', schedules: [], worklogs: [], diaries: [], calendarEvents: [], calendarError: null, holidays: [], holidayCalendarAvailable: true }));
    await flush();
    const again = take('apiGetRange');
    expect(again.arg).toEqual({ from: '2026-09-28', to: '2026-11-08' });
    expect(s.store.loadingRange).toBe(true);
    again.ok(okRes({ from: '2026-09-28', to: '2026-11-08', schedules: [{ ...sched, startAt: '2026-10-01T10:00', endAt: '2026-10-01T11:00', updatedAt: RESTORED_AT }], worklogs: [], diaries: [], calendarEvents: [], calendarError: null, holidays: [], holidayCalendarAvailable: true }));
    await load;
    await flush();
    expect(s.store.data.from).toBe('2026-09-28');
    expect(s.store.data.schedules.map((x) => x.id)).toEqual(['s1']);
    expect(s.store.loadingRange).toBe(false);
  });

  it('기간 기록: 불러온 달과 겹치면 캘린더에 다시 보인다', async () => {
    await loadMonth({});
    const p = s.restoreItem('WORKLOG', 'w1', DELETED_AT);
    await flush();
    take('apiRestoreWorklog').ok(okRes({ ...log, updatedAt: RESTORED_AT }));
    await p;
    expect(s.store.data.worklogs.map((x) => x.id)).toEqual(['w1']);
  });

  it('다이어리: 불러온 달과 보고 있는 주 양쪽에 반영', async () => {
    await loadMonth({});
    const w = s.loadDiaryWeek('2026-09-25');
    await flush();
    take('apiGetDiaries').ok(okRes([]));
    await w;
    const p = s.restoreItem('DIARY', 'd1', DELETED_AT);
    await flush();
    take('apiRestoreDiary').ok(okRes({ ...diary, updatedAt: RESTORED_AT }));
    await p;
    expect(s.store.data.diaries.map((x) => x.id)).toEqual(['d1']);
    expect(s.store.diary.list.map((x) => x.id)).toEqual(['d1']);
  });

  it('다이어리 날짜 충돌(CONFLICT)은 오류를 그대로 올려 보낸다', async () => {
    await loadMonth({});
    const p = s.restoreItem('DIARY', 'd1', DELETED_AT);
    await flush();
    take('apiRestoreDiary').ok(errRes('CONFLICT', '2026년 9월 24일 (목)에는 이미 다이어리가 있습니다. 그 다이어리를 먼저 삭제한 뒤 복구해 주세요.'));
    await expect(p).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(s.store.data.diaries).toEqual([]);
  });

  it('보러 가기 요청은 store.nav에 담긴다 (App이 처리하고 비움)', () => {
    s.requestNavigate({ view: 'diary', date: '2026-09-24' });
    expect(s.store.nav).toEqual({ view: 'diary', date: '2026-09-24' });
    s.store.nav = null;
  });
});
