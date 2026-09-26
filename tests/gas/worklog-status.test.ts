import { describe, expect, it } from 'vitest';
import { createReadyGas, err, ok, type ApiResult } from './harness';

interface Worklog { id: string; title: string; status: string; updatedAt: string; workDate: string }
type SaveResult = ApiResult<{ worklog: Worklog }>;

const base = { workDate: '2026-09-25', title: '배포 작업' };

describe('작업기록 상태', () => {
  it('새 기록은 진행 중, 저장 때 완료로 지정 가능', () => {
    const gas = createReadyGas();
    expect(ok(gas.call<SaveResult>('apiSaveWorklog', base)).worklog.status).toBe('IN_PROGRESS');
    expect(ok(gas.call<SaveResult>('apiSaveWorklog', { ...base, status: 'DONE' })).worklog.status).toBe('DONE');
    expect(err(gas.call('apiSaveWorklog', { ...base, status: 'FINISHED' })).message).toBe('상태가 올바르지 않습니다.');
  });

  it('완료 버튼: 진행 중 ↔ 완료 전환, 시트에 기록', () => {
    const gas = createReadyGas();
    const w = ok(gas.call<SaveResult>('apiSaveWorklog', base)).worklog;
    gas.setNow('2026-09-25T10:00:00+09:00');
    const done = ok(gas.call<ApiResult<Worklog>>('apiSetWorklogStatus', { id: w.id, status: 'DONE', updatedAt: w.updatedAt }));
    expect(done.status).toBe('DONE');
    expect(gas.sheet('worklogs').rawRow(2)[10]).toBe('DONE');
    gas.setNow('2026-09-25T11:00:00+09:00');
    const back = ok(gas.call<ApiResult<Worklog>>('apiSetWorklogStatus', { id: w.id, status: 'IN_PROGRESS', updatedAt: done.updatedAt }));
    expect(back.status).toBe('IN_PROGRESS');
  });

  it('다른 곳에서 먼저 수정했으면 CONFLICT, 삭제된 기록은 NOT_FOUND', () => {
    const gas = createReadyGas();
    const w = ok(gas.call<SaveResult>('apiSaveWorklog', base)).worklog;
    gas.setNow('2026-09-25T10:00:00+09:00');
    ok(gas.call('apiSetWorklogStatus', { id: w.id, status: 'DONE', updatedAt: w.updatedAt }));
    expect(err(gas.call('apiSetWorklogStatus', { id: w.id, status: 'IN_PROGRESS', updatedAt: w.updatedAt })).code).toBe('CONFLICT');
    const w2 = ok(gas.call<SaveResult>('apiSaveWorklog', base)).worklog;
    ok(gas.call('apiDeleteWorklog', { id: w2.id, updatedAt: w2.updatedAt }));
    expect(err(gas.call('apiSetWorklogStatus', { id: w2.id, status: 'DONE', updatedAt: w2.updatedAt })).code).toBe('NOT_FOUND');
  });

  it('상태 없이 수정하면 기존 상태 유지 (완료가 풀리지 않음)', () => {
    const gas = createReadyGas();
    const w = ok(gas.call<SaveResult>('apiSaveWorklog', { ...base, status: 'DONE' })).worklog;
    gas.setNow('2026-09-25T10:00:00+09:00');
    const edited = ok(gas.call<SaveResult>('apiSaveWorklog', { id: w.id, updatedAt: w.updatedAt, workDate: w.workDate, title: '제목만 수정' })).worklog;
    expect(edited).toMatchObject({ title: '제목만 수정', status: 'DONE' });
  });

  it('검색 결과에도 상태가 들어 있다', () => {
    const gas = createReadyGas();
    ok(gas.call('apiSaveWorklog', { ...base, status: 'DONE' }));
    const r = ok(gas.call<ApiResult<{ worklogs: Worklog[] }>>('apiSearch', { keyword: '배포' }));
    expect(r.worklogs[0].status).toBe('DONE');
  });
});

describe('기존 시트 마이그레이션 (status 열 추가 전 버전)', () => {
  it('setup이 머리글만 보강하고, 기존 기록은 진행 중으로 읽힌다', () => {
    const gas = createReadyGas();
    const w = ok(gas.call<SaveResult>('apiSaveWorklog', base)).worklog;
    const sheet = gas.sheet('worklogs');
    // v1.4 시트처럼 status(11열)·end_date(12열) 머리글과 값이 없음
    for (const key of ['1:11', '1:12', '2:11', '2:12']) sheet.cells.delete(key);
    const before = sheet.rawRow(2);

    const report = gas.call<string>('setup');
    expect(report).toContain('[OK] 열 추가: worklogs → status, end_date');
    expect(sheet.rawRow(1)).toEqual(gas.eval('SHEETS.WORKLOGS.columns.slice()'));
    expect(sheet.rawRow(2).slice(0, 10)).toEqual(before.slice(0, 10));

    const r = ok(gas.call<ApiResult<{ worklogs: Worklog[] }>>('apiGetRange', { from: '2026-09-25', to: '2026-09-25' }));
    expect(r.worklogs).toEqual([expect.objectContaining({ id: w.id, status: 'IN_PROGRESS' })]);
    expect(gas.call<string>('runSelfTest')).not.toContain('[FAIL]');
  });
});
