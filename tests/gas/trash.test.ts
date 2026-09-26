import { describe, expect, it } from 'vitest';
import { createReadyGas, err, ok, type ApiResult, type Gas } from './harness';

interface Row { id: string; updatedAt: string; createdAt: string }
interface Schedule extends Row { title: string; status: string; projectId: string; startAt: string; description: string }
interface Worklog extends Row { title: string; status: string; projectId: string; scheduleId: string; workDate: string; endDate: string; content: string }
interface Diary extends Row { diaryDate: string; title: string; content: string }
interface Trash {
  days: number; total: number; truncated: boolean;
  schedules: Schedule[]; worklogs: Worklog[]; diaries: Diary[];
}

const saveSchedule = (gas: Gas, input: Record<string, unknown>) =>
  ok(gas.call<ApiResult<Schedule>>('apiSaveSchedule', { startAt: '2026-09-24T10:00', endAt: '2026-09-24T11:00', ...input }));
const saveWorklog = (gas: Gas, input: Record<string, unknown>) =>
  ok(gas.call<ApiResult<{ worklog: Worklog }>>('apiSaveWorklog', { workDate: '2026-09-24', ...input })).worklog;
const saveDiary = (gas: Gas, input: Record<string, unknown>) => ok(gas.call<ApiResult<Diary>>('apiSaveDiary', input));
const del = (gas: Gas, kind: 'Schedule' | 'Worklog' | 'Diary', r: Row) =>
  ok(gas.call<ApiResult<{ id: string; updatedAt: string }>>('apiDelete' + kind, { id: r.id, updatedAt: r.updatedAt }));
const restore = <T>(gas: Gas, kind: 'Schedule' | 'Worklog' | 'Diary', id: string, updatedAt: unknown) =>
  gas.call<ApiResult<T>>('apiRestore' + kind, { id, updatedAt });
const trash = (gas: Gas) => ok(gas.call<ApiResult<Trash>>('apiGetTrash'));
const range = (gas: Gas) =>
  ok(gas.call<ApiResult<{ schedules: Schedule[]; worklogs: Worklog[]; diaries: Diary[] }>>('apiGetRange', { from: '2026-09-01', to: '2026-10-31' }));

describe('삭제 반환값', () => {
  it('세 종류 모두 { id, updatedAt = 삭제 시각 }을 돌려주고, 시트의 updated_at과 같다', () => {
    const gas = createReadyGas();
    const s = saveSchedule(gas, { title: '일정' });
    const w = saveWorklog(gas, { title: '기록' });
    const d = saveDiary(gas, { diaryDate: '2026-09-24', content: '글' });
    gas.setNow('2026-09-24T09:15:30.250+09:00');
    const rs = del(gas, 'Schedule', s);
    const rw = del(gas, 'Worklog', w);
    const rd = del(gas, 'Diary', d);
    for (const [r, src] of [[rs, s], [rw, w], [rd, d]] as const) {
      expect(r).toEqual({ id: src.id, updatedAt: '2026-09-24T09:15:30.250+09:00' });
    }
    // updated_at 열: schedules 13번째, worklogs 9번째, diaries 6번째
    expect(gas.sheet('schedules').rawRow(2)[12]).toBe(rs.updatedAt);
    expect(gas.sheet('worklogs').rawRow(2)[8]).toBe(rw.updatedAt);
    expect(gas.sheet('diaries').rawRow(2)[5]).toBe(rd.updatedAt);
  });
});

describe('휴지통 목록', () => {
  it('최근 30일(오늘 포함) 안에 지운 것만, 최근 삭제 순. 살아 있는 행은 넣지 않는다', () => {
    const gas = createReadyGas(); // 오늘 = 2026-09-24
    const old = saveSchedule(gas, { title: '30일 전에 지움' });
    const edge = saveWorklog(gas, { title: '29일 전에 지움' });
    const recent = saveDiary(gas, { diaryDate: '2026-09-20', content: '어제 지운 다이어리' });
    const latest = saveSchedule(gas, { title: '오늘 지움' });
    saveSchedule(gas, { title: '살아 있는 일정' });
    saveWorklog(gas, { title: '살아 있는 기록' });

    gas.setNow('2026-08-25T23:59:00+09:00');
    del(gas, 'Schedule', old);
    gas.setNow('2026-08-26T00:01:00+09:00');
    del(gas, 'Worklog', edge);
    gas.setNow('2026-09-23T18:00:00+09:00');
    del(gas, 'Diary', recent);
    gas.setNow('2026-09-24T07:00:00+09:00');
    del(gas, 'Schedule', latest);

    gas.setNow('2026-09-24T07:30:00+09:00');
    const t = trash(gas);
    expect(t).toMatchObject({ days: 30, total: 3, truncated: false });
    expect(t.schedules.map((x) => x.title)).toEqual(['오늘 지움']);
    expect(t.worklogs.map((x) => x.title)).toEqual(['29일 전에 지움']);
    expect(t.diaries.map((x) => x.diaryDate)).toEqual(['2026-09-20']);
    // DTO의 updatedAt = 삭제 시각 (화면이 최근 삭제 순 정렬·복구 잠금에 쓴다)
    expect(t.schedules[0].updatedAt).toBe('2026-09-24T07:00:00.000+09:00');
  });

  it('삭제 시각이나 항목 날짜를 알 수 없는 행(시트를 손으로 고침)은 넣지 않는다', () => {
    const gas = createReadyGas();
    const a = saveSchedule(gas, { title: '시각 없음' });
    const b = saveSchedule(gas, { title: '정상' });
    const c = saveDiary(gas, { diaryDate: '2026-09-22', content: '날짜 깨짐' });
    const e = saveSchedule(gas, { title: '시작일 깨짐' });
    const w = saveWorklog(gas, { title: '작업일 깨짐' });
    for (const x of [a, b, e]) del(gas, 'Schedule', x);
    del(gas, 'Diary', c);
    del(gas, 'Worklog', w);
    gas.sheet('schedules').write(2, 13, '어제쯤'); // a.updated_at
    gas.sheet('schedules').write(4, 5, '다음 주'); // e.start_at
    gas.sheet('diaries').write(2, 2, '9월 22일');
    gas.sheet('worklogs').write(2, 2, '');
    const t = trash(gas);
    expect(t.schedules.map((x) => x.title)).toEqual(['정상']);
    expect(t.diaries).toEqual([]);
    expect(t.worklogs).toEqual([]);
    expect(t.total).toBe(1);
  });

  it('목록은 본문을 비워서 보낸다 (복구하면 전체가 돌아온다)', () => {
    const gas = createReadyGas();
    const s = saveSchedule(gas, { title: '일정', description: '긴 설명' });
    const w = saveWorklog(gas, { title: '기록', content: '긴 내용' });
    const d = saveDiary(gas, { diaryDate: '2026-09-24', content: '긴 일기' });
    const ds = del(gas, 'Schedule', s);
    del(gas, 'Worklog', w);
    del(gas, 'Diary', d);
    const t = trash(gas);
    expect([t.schedules[0].description, t.worklogs[0].content, t.diaries[0].content]).toEqual(['', '', '']);
    expect(t.schedules[0].title).toBe('일정');
    expect(ok(restore<Schedule>(gas, 'Schedule', s.id, ds.updatedAt)).description).toBe('긴 설명');
  });

  it('최대 300건 (최근 삭제 순), 총 건수와 truncated', () => {
    const gas = createReadyGas();
    // 301건을 지운 상태로 바로 넣는다 (1번이 가장 오래 전에 지움)
    gas.eval(`withLock_(function () {
      for (var i = 1; i <= 301; i++) {
        var mm = String(Math.floor(i / 60)).padStart(2, '0');
        var ss = String(i % 60).padStart(2, '0');
        insertRow_(SHEETS.SCHEDULES, { id: 'old-' + i, type: 'TASK', title: '지운 일정 ' + i,
          start_at: '2026-09-20T10:00', end_at: '2026-09-20T11:00', all_day: 'FALSE', status: 'PLANNED',
          created_at: '2026-09-01T00:00:00.000+09:00', updated_at: '2026-09-23T10:' + mm + ':' + ss + '.000+09:00', deleted: 'TRUE' });
      }
    })`);
    const t = trash(gas);
    expect(t.total).toBe(301);
    expect(t.truncated).toBe(true);
    expect(t.schedules).toHaveLength(300);
    expect(t.schedules[0].title).toBe('지운 일정 301');
    expect(t.schedules.some((x) => x.title === '지운 일정 1')).toBe(false);
  });

  it('300건 제한은 종류를 섞어 최근 삭제 순으로 자른 뒤 적용한다', () => {
    const gas = createReadyGas();
    // 일정 200건(오래 전) + 작업기록 101건(최근) → 가장 오래된 일정 1건만 빠진다
    gas.eval(`withLock_(function () {
      var stamp = function (h, i) { return '2026-09-23T' + h + ':' + String(Math.floor(i / 60)).padStart(2, '0') + ':' + String(i % 60).padStart(2, '0') + '.000+09:00'; };
      for (var i = 1; i <= 200; i++) {
        insertRow_(SHEETS.SCHEDULES, { id: 's-' + i, type: 'TASK', title: '일정 ' + i, start_at: '2026-09-20T10:00', end_at: '2026-09-20T11:00',
          all_day: 'FALSE', status: 'PLANNED', created_at: 'c', updated_at: stamp('09', i), deleted: 'TRUE' });
      }
      for (var j = 1; j <= 101; j++) {
        insertRow_(SHEETS.WORKLOGS, { id: 'w-' + j, work_date: '2026-09-20', title: '기록 ' + j, created_at: 'c', updated_at: stamp('10', j), deleted: 'TRUE' });
      }
    })`);
    const t = trash(gas);
    expect(t).toMatchObject({ total: 301, truncated: true });
    expect(t.worklogs).toHaveLength(101);
    expect(t.schedules).toHaveLength(199);
    expect(t.schedules.some((x) => x.title === '일정 1')).toBe(false);
  });

  it('다이어리 시트가 아직 없어도(setup 전) 나머지 목록은 나온다', () => {
    const gas = createReadyGas();
    const s = saveSchedule(gas, { title: '일정' });
    del(gas, 'Schedule', s);
    const ss = gas.spreadsheet();
    ss.deleteSheet(ss.getSheetByName('diaries')!);
    const t = trash(gas);
    expect(t.schedules).toHaveLength(1);
    expect(t.diaries).toEqual([]);
  });
});

describe('복구', () => {
  it('세 종류: deleted = FALSE, updated_at = 복구 시각, 다른 값은 지울 때 그대로 → 다시 조회된다', () => {
    const gas = createReadyGas();
    const p = ok(gas.call<ApiResult<{ id: string }>>('apiSaveProject', { name: '프로젝트 A' }));
    const s = saveSchedule(gas, { title: '완료한 일정', status: 'DONE', projectId: p.id, tags: ['배포'] });
    const w = saveWorklog(gas, { title: '기간 기록', endDate: '2026-09-26', status: 'DONE', projectId: p.id, scheduleId: s.id });
    const d = saveDiary(gas, { diaryDate: '2026-09-24', title: '제목', content: '내용' });
    gas.setNow('2026-09-24T09:00:00+09:00');
    const ds = del(gas, 'Schedule', s);
    const dw = del(gas, 'Worklog', w);
    const dd = del(gas, 'Diary', d);
    expect(range(gas)).toMatchObject({ schedules: [], worklogs: [], diaries: [] });

    gas.setNow('2026-09-24T10:00:00+09:00');
    const rs = ok(restore<Schedule>(gas, 'Schedule', s.id, ds.updatedAt));
    const rw = ok(restore<Worklog>(gas, 'Worklog', w.id, dw.updatedAt));
    const rd = ok(restore<Diary>(gas, 'Diary', d.id, dd.updatedAt));

    expect(rs).toEqual({ ...s, updatedAt: '2026-09-24T10:00:00.000+09:00' });
    expect(rw).toEqual({ ...w, updatedAt: '2026-09-24T10:00:00.000+09:00' });
    expect(rd).toEqual({ ...d, updatedAt: '2026-09-24T10:00:00.000+09:00' });
    expect(gas.sheet('schedules').rawRow(2)[13]).toBe('FALSE');
    const r = range(gas);
    expect(r.schedules.map((x) => x.id)).toEqual([s.id]);
    expect(r.worklogs.map((x) => x.id)).toEqual([w.id]);
    expect(r.diaries.map((x) => x.id)).toEqual([d.id]);
    expect(trash(gas).total).toBe(0);
  });

  it('잠금: 삭제 시각이 다르면 CONFLICT, 이미 살아 있거나 없는 항목은 NOT_FOUND, 기준 시각이 없으면 VALIDATION', () => {
    const gas = createReadyGas();
    const s = saveSchedule(gas, { title: '일정' });
    gas.setNow('2026-09-24T09:00:00+09:00');
    const ds = del(gas, 'Schedule', s);

    const conflict = err(restore(gas, 'Schedule', s.id, s.updatedAt)); // 지우기 전 시각
    expect(conflict.code).toBe('CONFLICT');
    expect(conflict.message).toBe('다른 곳에서 먼저 바뀐 일정 항목입니다. 새로고침 후 다시 시도해 주세요.');
    expect(err(restore(gas, 'Schedule', s.id, undefined)).code).toBe('VALIDATION');
    expect(err(restore(gas, 'Schedule', 'no-such-id', ds.updatedAt)).code).toBe('NOT_FOUND');
    expect(gas.sheet('schedules').rawRow(2)[13]).toBe('TRUE');

    ok(restore(gas, 'Schedule', s.id, ds.updatedAt));
    const again = err(restore(gas, 'Schedule', s.id, ds.updatedAt)); // 되돌리기를 두 번 누름
    expect(again).toEqual({ code: 'NOT_FOUND', message: '이미 복구됐거나 찾을 수 없는 일정 항목입니다.' });
  });

  it('다시 지우면 새 삭제 시각으로만 복구된다', () => {
    const gas = createReadyGas();
    const w = saveWorklog(gas, { title: '기록' });
    gas.setNow('2026-09-24T09:00:00+09:00');
    const d1 = del(gas, 'Worklog', w);
    gas.setNow('2026-09-24T09:10:00+09:00');
    const r1 = ok(restore<Worklog>(gas, 'Worklog', w.id, d1.updatedAt));
    gas.setNow('2026-09-24T09:20:00+09:00');
    const d2 = del(gas, 'Worklog', r1);
    expect(err(restore(gas, 'Worklog', w.id, d1.updatedAt)).code).toBe('CONFLICT');
    expect(ok(restore<Worklog>(gas, 'Worklog', w.id, d2.updatedAt)).title).toBe('기록');
  });

  it('다이어리: 그 날짜에 새 다이어리가 있으면 CONFLICT, 새 것을 지우면 복구된다', () => {
    const gas = createReadyGas();
    const oldOne = saveDiary(gas, { diaryDate: '2026-09-24', content: '처음 쓴 글' });
    gas.setNow('2026-09-24T09:00:00+09:00');
    const dOld = del(gas, 'Diary', oldOne);
    const newOne = saveDiary(gas, { diaryDate: '2026-09-24', content: '새로 쓴 글' });

    const e = err(restore(gas, 'Diary', oldOne.id, dOld.updatedAt));
    expect(e.code).toBe('CONFLICT');
    expect(e.message).toBe('2026년 9월 24일 (목)에는 이미 다이어리가 있습니다. 그 다이어리를 먼저 삭제한 뒤 복구해 주세요.');
    expect(gas.sheet('diaries').rawRow(2)[6]).toBe('TRUE');

    gas.setNow('2026-09-24T09:30:00+09:00');
    del(gas, 'Diary', newOne);
    expect(ok(restore<Diary>(gas, 'Diary', oldOne.id, dOld.updatedAt)).content).toBe('처음 쓴 글');
  });

  it('작업기록: 연결 일정이 지워졌거나 프로젝트가 사용 중지돼도 그대로 복구', () => {
    const gas = createReadyGas();
    const p = ok(gas.call<ApiResult<{ id: string; name: string; updatedAt: string }>>('apiSaveProject', { name: '끝난 프로젝트' }));
    const s = saveSchedule(gas, { title: '연결 일정' });
    const w = saveWorklog(gas, { title: '기록', scheduleId: s.id, projectId: p.id });
    gas.setNow('2026-09-24T09:00:00+09:00');
    const dw = del(gas, 'Worklog', w);
    del(gas, 'Schedule', s);
    ok(gas.call('apiSaveProject', { id: p.id, updatedAt: p.updatedAt, name: p.name, active: false }));

    const r = ok(restore<Worklog>(gas, 'Worklog', w.id, dw.updatedAt));
    expect(r).toMatchObject({ scheduleId: s.id, projectId: p.id });
  });

  it('다이어리 날짜가 깨진 행은 복구하지 않는다 (VALIDATION)', () => {
    const gas = createReadyGas();
    const x = saveDiary(gas, { diaryDate: '2026-09-24', content: '글' });
    const dx = del(gas, 'Diary', x);
    gas.sheet('diaries').write(2, 2, '9월 24일');
    const e = err(restore(gas, 'Diary', x.id, dx.updatedAt));
    expect(e.code).toBe('VALIDATION');
    expect(gas.sheet('diaries').rawRow(2)[6]).toBe('TRUE');
  });

  it('다이어리 시트가 없으면 복구는 setup 안내 (NOT_INITIALIZED)', () => {
    const gas = createReadyGas();
    const ss = gas.spreadsheet();
    ss.deleteSheet(ss.getSheetByName('diaries')!);
    expect(err(restore(gas, 'Diary', 'x', '2026-09-24T09:00:00.000+09:00')).code).toBe('NOT_INITIALIZED');
  });
});
