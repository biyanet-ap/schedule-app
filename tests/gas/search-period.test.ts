import { describe, expect, it } from 'vitest';
import { createReadyGas, err, ok, type ApiResult, type Gas } from './harness';

interface Item { title: string }
type SearchResult = ApiResult<{ worklogs: Item[]; schedules: Item[] }>;

function seed(gas: Gas) {
  const s = (title: string, startAt: string, endAt: string, allDay = false) =>
    ok(gas.call('apiSaveSchedule', { type: 'TASK', title, startAt, endAt, allDay }));
  s('점검 여러날', '2026-09-28', '2026-09-30', true); // 종일 9/28~9/30
  s('점검 밤샘', '2026-09-24T22:00', '2026-09-25T02:00'); // 9/24~9/25
  s('점검 자정끝', '2026-09-24T22:00', '2026-09-25T00:00'); // 9/24만 (다음날 0시에 끝남)
  s('점검 10월', '2026-10-05T10:00', '2026-10-05T11:00');
}

function titles(gas: Gas, q: Record<string, string>) {
  return ok(gas.call<SearchResult>('apiSearch', { keyword: '점검', ...q })).schedules.map((x) => x.title).sort();
}

describe('검색 기간 필터 — 일정은 기간과 겹치면 포함', () => {
  it('기간이 없으면 모두 (기존 동작 그대로)', () => {
    const gas = createReadyGas();
    seed(gas);
    expect(titles(gas, {})).toEqual(['점검 10월', '점검 밤샘', '점검 여러날', '점검 자정끝']);
  });

  it('여러 날 일정은 시작일이 기간 앞이어도 걸치면 포함', () => {
    const gas = createReadyGas();
    seed(gas);
    expect(titles(gas, { from: '2026-09-29', to: '2026-09-29' })).toEqual(['점검 여러날']);
    expect(titles(gas, { from: '2026-09-30', to: '2026-10-31' })).toEqual(['점검 10월', '점검 여러날']);
    expect(titles(gas, { from: '2026-10-01', to: '2026-10-31' })).toEqual(['점검 10월']);
  });

  it('밤을 넘긴 일정은 다음날에도 걸리고, 다음날 0시에 끝나는 일정은 전날까지만', () => {
    const gas = createReadyGas();
    seed(gas);
    expect(titles(gas, { from: '2026-09-25', to: '2026-09-25' })).toEqual(['점검 밤샘']);
    expect(titles(gas, { from: '2026-09-24', to: '2026-09-24' })).toEqual(['점검 밤샘', '점검 자정끝']);
  });

  it('한쪽만 지정: 시작일만 / 종료일만', () => {
    const gas = createReadyGas();
    seed(gas);
    expect(titles(gas, { from: '2026-09-30' })).toEqual(['점검 10월', '점검 여러날']);
    expect(titles(gas, { to: '2026-09-27' })).toEqual(['점검 밤샘', '점검 자정끝']);
  });

  it('종료일이 시작일보다 앞서면 VALIDATION', () => {
    const gas = createReadyGas();
    const e = err(gas.call('apiSearch', { keyword: '점검', from: '2026-09-30', to: '2026-09-01' }));
    expect(e).toMatchObject({ code: 'VALIDATION', message: '검색 종료일이 시작일보다 앞설 수 없습니다.' });
  });
});
