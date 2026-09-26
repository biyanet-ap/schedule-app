import { describe, expect, it } from 'vitest';
import { createReadyGas, err, ok, type ApiResult } from './harness';

interface Worklog { id: string; workDate: string; endDate: string; title: string; status: string; updatedAt: string }
type SaveResult = ApiResult<{ worklog: Worklog }>;
type RangeResult = ApiResult<{ worklogs: Worklog[] }>;

const END_COL = 11; // 0부터 센 end_date 열 (12번째 열)
const period = { workDate: '2026-09-21', endDate: '2026-09-25', title: '주간 정리' };

function idsInRange(gas: ReturnType<typeof createReadyGas>, from: string, to: string) {
  return ok(gas.call<RangeResult>('apiGetRange', { from, to })).worklogs.map((w) => w.id);
}

describe('기간 기록 저장', () => {
  it('하루 기록은 endDate가 빈 값, 기간 기록은 시트 12번째 열에 종료일', () => {
    const gas = createReadyGas();
    const day = ok(gas.call<SaveResult>('apiSaveWorklog', { workDate: '2026-09-25', title: '하루' })).worklog;
    expect(day.endDate).toBe('');
    expect(gas.sheet('worklogs').rawRow(2)[END_COL]).toBe('');

    const p = ok(gas.call<SaveResult>('apiSaveWorklog', period)).worklog;
    expect(p).toMatchObject({ workDate: '2026-09-21', endDate: '2026-09-25', status: 'IN_PROGRESS' });
    expect(gas.sheet('worklogs').rawRow(3)[END_COL]).toBe('2026-09-25');
  });

  it('종료일 검증: 시작일 이하, 92일 초과, 형식 오류', () => {
    const gas = createReadyGas();
    const same = err(gas.call('apiSaveWorklog', { ...period, endDate: '2026-09-21' }));
    expect(same).toMatchObject({ code: 'VALIDATION', message: "종료일은 시작일보다 뒤여야 합니다. 하루만 기록하려면 '하루 기록' 탭을 쓰세요." });
    expect(err(gas.call('apiSaveWorklog', { ...period, endDate: '2026-09-20' })).code).toBe('VALIDATION');

    // 2026-09-01 ~ 2026-12-01 = 92일(양끝 포함)은 허용, 하루 더 늘리면 거부
    expect(ok(gas.call<SaveResult>('apiSaveWorklog', { ...period, workDate: '2026-09-01', endDate: '2026-12-01' })).worklog.endDate).toBe('2026-12-01');
    expect(err(gas.call('apiSaveWorklog', { ...period, workDate: '2026-09-01', endDate: '2026-12-02' })).message)
      .toBe('기간 기록은 최대 92일까지 쓸 수 있습니다.');

    expect(err(gas.call('apiSaveWorklog', { ...period, endDate: '2026-13-01' })).message)
      .toBe('종료일이 올바른 날짜가 아닙니다. (YYYY-MM-DD)');
    expect(err(gas.call('apiSaveWorklog', { ...period, endDate: 20260925 })).code).toBe('VALIDATION');
  });

  it('실패한 저장은 시트에 아무것도 남기지 않는다', () => {
    const gas = createReadyGas();
    err(gas.call('apiSaveWorklog', { ...period, endDate: '2026-09-20' }));
    expect(gas.sheet('worklogs').getLastRow()).toBe(1);
  });
});

describe('기간 기록 수정', () => {
  function saved() {
    const gas = createReadyGas();
    const w = ok(gas.call<SaveResult>('apiSaveWorklog', period)).worklog;
    gas.setNow('2026-09-25T10:00:00+09:00');
    return { gas, w };
  }

  it('endDate를 보내지 않으면 기존 기간 유지 (업데이트 전 화면에서 저장해도 풀리지 않음)', () => {
    const { gas, w } = saved();
    const edited = ok(gas.call<SaveResult>('apiSaveWorklog', { id: w.id, updatedAt: w.updatedAt, workDate: w.workDate, title: '제목만 수정' })).worklog;
    expect(edited).toMatchObject({ title: '제목만 수정', workDate: '2026-09-21', endDate: '2026-09-25' });
  });

  it("endDate ''는 하루 기록으로 전환, 날짜는 기간 변경", () => {
    const { gas, w } = saved();
    const day = ok(gas.call<SaveResult>('apiSaveWorklog', { id: w.id, updatedAt: w.updatedAt, workDate: '2026-09-22', endDate: '', title: w.title })).worklog;
    expect(day).toMatchObject({ workDate: '2026-09-22', endDate: '' });
    gas.setNow('2026-09-25T11:00:00+09:00');
    const again = ok(gas.call<SaveResult>('apiSaveWorklog', { id: w.id, updatedAt: day.updatedAt, workDate: '2026-09-14', endDate: '2026-09-18', title: w.title })).worklog;
    expect(again).toMatchObject({ workDate: '2026-09-14', endDate: '2026-09-18' });
  });

  it('유지하는 종료일도 검사: 시작일을 종료일 뒤로 옮기거나 92일을 넘기면 거부', () => {
    const { gas, w } = saved();
    const base = { id: w.id, updatedAt: w.updatedAt, title: w.title };
    expect(err(gas.call('apiSaveWorklog', { ...base, workDate: '2026-09-25' })).message).toContain('종료일은 시작일보다 뒤여야 합니다.');
    expect(err(gas.call('apiSaveWorklog', { ...base, workDate: '2026-06-01' })).message).toBe('기간 기록은 최대 92일까지 쓸 수 있습니다.');
    // 거부된 수정은 시트를 바꾸지 않는다
    expect(ok(gas.call<RangeResult>('apiGetRange', { from: '2026-09-21', to: '2026-09-21' })).worklogs[0]).toMatchObject({ workDate: '2026-09-21', endDate: '2026-09-25', updatedAt: w.updatedAt });
  });

  it('완료 버튼으로 상태를 바꿔도 기간은 그대로', () => {
    const { gas, w } = saved();
    const done = ok(gas.call<ApiResult<Worklog>>('apiSetWorklogStatus', { id: w.id, status: 'DONE', updatedAt: w.updatedAt }));
    expect(done).toMatchObject({ status: 'DONE', endDate: '2026-09-25' });
  });
});

describe('기간 겹침 조회', () => {
  it('조회 범위와 하루라도 겹치면 포함 (시작일이 범위 앞이어도)', () => {
    const gas = createReadyGas();
    const p = ok(gas.call<SaveResult>('apiSaveWorklog', period)).worklog;
    const d = ok(gas.call<SaveResult>('apiSaveWorklog', { workDate: '2026-09-23', title: '하루' })).worklog;

    expect(idsInRange(gas, '2026-09-23', '2026-09-23').sort()).toEqual([p.id, d.id].sort()); // 가운데
    expect(idsInRange(gas, '2026-09-25', '2026-10-31')).toEqual([p.id]); // 끝날이 범위 첫날
    expect(idsInRange(gas, '2026-09-01', '2026-09-21')).toEqual([p.id]); // 시작날이 범위 끝날
    expect(idsInRange(gas, '2026-09-26', '2026-10-31')).toEqual([]); // 뒤
    expect(idsInRange(gas, '2026-09-01', '2026-09-20')).toEqual([]); // 앞
  });

  it('삭제한 기간 기록은 어느 날짜 범위에서도 나오지 않는다', () => {
    const gas = createReadyGas();
    const p = ok(gas.call<SaveResult>('apiSaveWorklog', period)).worklog;
    ok(gas.call('apiDeleteWorklog', { id: p.id, updatedAt: p.updatedAt }));
    expect(idsInRange(gas, '2026-09-23', '2026-09-23')).toEqual([]);
    expect(gas.sheet('worklogs').rawRow(2)[END_COL]).toBe('2026-09-25'); // 논리 삭제라 값은 남음
  });

  it('검색: 기간 필터도 겹침 기준, 결과에 endDate 포함', () => {
    const gas = createReadyGas();
    ok(gas.call('apiSaveWorklog', period));
    const toOnly = ok(gas.call<ApiResult<{ worklogs: Worklog[] }>>('apiSearch', { keyword: '주간', to: '2026-09-21' }));
    expect(toOnly.worklogs).toHaveLength(1); // 종료일만 지정: 시작일이 그 날 이전이면 포함
    expect(ok(gas.call<ApiResult<{ worklogs: Worklog[] }>>('apiSearch', { keyword: '주간', to: '2026-09-20' })).worklogs).toEqual([]);
    const hit = ok(gas.call<ApiResult<{ worklogs: Worklog[] }>>('apiSearch', { keyword: '주간', from: '2026-09-24', to: '2026-09-30' }));
    expect(hit.worklogs).toEqual([expect.objectContaining({ workDate: '2026-09-21', endDate: '2026-09-25' })]);
    const miss = ok(gas.call<ApiResult<{ worklogs: Worklog[] }>>('apiSearch', { keyword: '주간', from: '2026-09-26' }));
    expect(miss.worklogs).toEqual([]);
  });
});

describe('시트 읽기 방어·마이그레이션', () => {
  it('손으로 고친 end_date: 시작일 이하·형식 오류·92일 초과는 하루 기록, 날짜 셀은 기간 기록으로 읽는다', () => {
    const gas = createReadyGas();
    for (const title of ['A', 'B', 'C', 'D']) ok(gas.call('apiSaveWorklog', { workDate: '2026-09-21', title }));
    const sheet = gas.sheet('worklogs');
    sheet.cells.set('2:12', '2026-09-20');
    sheet.cells.set('3:12', '다음 주');
    sheet.cells.set('4:12', new Date('2026-09-25T00:00:00+09:00')); // 서식이 바뀌어 날짜로 변환된 셀
    sheet.cells.set('5:12', '2027-09-25'); // 370일

    const list = ok(gas.call<RangeResult>('apiGetRange', { from: '2026-09-21', to: '2026-09-21' })).worklogs;
    const byTitle = Object.fromEntries(list.map((w) => [w.title, w.endDate]));
    expect(byTitle).toEqual({ A: '', B: '', C: '2026-09-25', D: '' });
    // 92일 초과로 읽힌 기록은 먼 날짜 범위에 나오지 않고, 제목만 고쳐도 저장된다 (기존 값 유지 = 하루 기록)
    expect(ok(gas.call<RangeResult>('apiGetRange', { from: '2027-03-01', to: '2027-03-31' })).worklogs).toEqual([]);
    const d = list.find((w) => w.title === 'D')!;
    const saved = ok(gas.call<SaveResult>('apiSaveWorklog', { id: d.id, updatedAt: d.updatedAt, workDate: d.workDate, title: 'D2' })).worklog;
    expect(saved).toMatchObject({ title: 'D2', endDate: '' });
  });

  it('setup이 v1.5 시트(11열)에 end_date 머리글만 추가, 기존 기록은 하루 기록', () => {
    const gas = createReadyGas();
    const w = ok(gas.call<SaveResult>('apiSaveWorklog', { workDate: '2026-09-25', title: '기존 기록' })).worklog;
    const sheet = gas.sheet('worklogs');
    sheet.cells.delete('1:12');
    sheet.cells.delete('2:12');
    const before = sheet.rawRow(2);

    const report = gas.call<string>('setup');
    expect(report).toContain('[OK] 열 추가: worklogs → end_date');
    expect(sheet.rawRow(1)).toEqual(gas.eval('SHEETS.WORKLOGS.columns.slice()'));
    expect(sheet.rawRow(2).slice(0, 11)).toEqual(before.slice(0, 11));
    expect(ok(gas.call<RangeResult>('apiGetRange', { from: '2026-09-25', to: '2026-09-25' })).worklogs)
      .toEqual([expect.objectContaining({ id: w.id, endDate: '' })]);
    expect(gas.call<string>('runSelfTest')).not.toContain('[FAIL]');
  });

  it('부트스트랩으로 최대 기간(92일)을 화면에 알려준다', () => {
    const gas = createReadyGas();
    const boot = ok(gas.call<ApiResult<{ limits: { worklogPeriodDays: number } }>>('apiBootstrap'));
    expect(boot.limits.worklogPeriodDays).toBe(92);
  });
});
