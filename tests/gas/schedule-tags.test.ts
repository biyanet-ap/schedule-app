import { describe, expect, it } from 'vitest';
import { createReadyGas, err, ok, type ApiResult } from './harness';

interface Schedule { id: string; title: string; tags: string[]; updatedAt: string; projectId: string }

const base = { type: 'TASK', title: '배포 준비', startAt: '2026-09-24T10:00', endAt: '2026-09-24T11:00' };

describe('일정 태그', () => {
  it('저장·수정 시 태그 정리 (# 제거, 중복 제거), 조회에 포함', () => {
    const gas = createReadyGas();
    const s = ok(gas.call<ApiResult<Schedule>>('apiSaveSchedule', { ...base, tags: ['#배포', '배포', ' DB ', ''] }));
    expect(s.tags).toEqual(['배포', 'DB']);
    gas.setNow('2026-09-24T09:00:00+09:00');
    const edited = ok(gas.call<ApiResult<Schedule>>('apiSaveSchedule', { ...s, tags: '인프라, 장애' }));
    expect(edited.tags).toEqual(['인프라', '장애']);
    const range = ok(gas.call<ApiResult<{ schedules: Schedule[] }>>('apiGetRange', { from: '2026-09-24', to: '2026-09-24' }));
    expect(range.schedules[0].tags).toEqual(['인프라', '장애']);
    expect(gas.sheet('schedules').rawRow(2)[14]).toBe('인프라,장애');
  });

  it('태그 없이 저장하면 빈 배열, 11개 이상은 거부', () => {
    const gas = createReadyGas();
    expect(ok(gas.call<ApiResult<Schedule>>('apiSaveSchedule', base)).tags).toEqual([]);
    const e = err(gas.call('apiSaveSchedule', { ...base, tags: Array.from({ length: 11 }, (_, i) => 't' + i) }));
    expect(e.message).toContain('최대 10개');
  });

  it('일정 태그로 검색된다', () => {
    const gas = createReadyGas();
    ok(gas.call('apiSaveSchedule', { ...base, title: '정기 점검', tags: ['인프라'] }));
    const r = ok(gas.call<ApiResult<{ schedules: Schedule[] }>>('apiSearch', { keyword: '인프라' }));
    expect(r.schedules.map((s) => s.title)).toEqual(['정기 점검']);
  });
});

describe('기존 시트 마이그레이션 (tags 열 추가 전 버전)', () => {
  /** 운영 중인 시트처럼: 머리글 14열 + 데이터 1행, 15번째 열 없음 */
  function downgradeToV12(gas: ReturnType<typeof createReadyGas>) {
    const s = ok(gas.call<ApiResult<Schedule>>('apiSaveSchedule', { ...base, title: '기존 회의' }));
    const sheet = gas.sheet('schedules');
    sheet.cells.delete('1:15');
    sheet.cells.delete('2:15');
    return s;
  }

  it('setup을 다시 실행하면 머리글에 tags만 추가되고 기존 데이터는 그대로', () => {
    const gas = createReadyGas();
    const before = downgradeToV12(gas);
    const rowBefore = gas.sheet('schedules').rawRow(2);

    const report = gas.call<string>('setup');
    expect(report).toContain('[OK] 열 추가: schedules → tags');
    const sheet = gas.sheet('schedules');
    expect(sheet.rawRow(1)).toEqual(gas.eval('SHEETS.SCHEDULES.columns.slice()'));
    expect(sheet.rawRow(2).slice(0, 14)).toEqual(rowBefore.slice(0, 14));

    const range = ok(gas.call<ApiResult<{ schedules: Schedule[] }>>('apiGetRange', { from: '2026-09-24', to: '2026-09-24' }));
    expect(range.schedules).toEqual([expect.objectContaining({ id: before.id, title: '기존 회의', tags: [] })]);

    // 두 번 실행해도 추가 메시지 없음 (멱등)
    expect(gas.call<string>('setup')).not.toContain('열 추가');
  });

  it('setup 전이라도 기존 일정 조회·태그 저장은 동작한다 (열 위치 기준)', () => {
    const gas = createReadyGas();
    const before = downgradeToV12(gas);
    gas.setNow('2026-09-24T09:00:00+09:00');
    const saved = ok(gas.call<ApiResult<Schedule>>('apiSaveSchedule', { ...before, tags: ['회의'] }));
    expect(saved.tags).toEqual(['회의']);
    // 자가 점검은 머리글 누락을 알려 준다
    expect(gas.call<string>('runSelfTest')).toContain('setup을 다시 실행하면 새 열이 추가됩니다');
  });

  it('머리글 앞부분이 다르면 멈춘다 (엉뚱한 시트 보호)', () => {
    const gas = createReadyGas();
    gas.sheet('schedules').write(1, 3, 'name');
    expect(() => gas.raw('setup')).toThrow(/머리글이 예상과 다릅니다/);
  });
});
