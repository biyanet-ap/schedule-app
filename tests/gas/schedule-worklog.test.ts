import { describe, expect, it } from 'vitest';
import { createReadyGas, err, ok, type ApiResult, type Gas } from './harness';

interface Schedule {
  id: string; type: string; title: string; startAt: string; endAt: string; allDay: boolean;
  priority: string; projectId: string; status: string; updatedAt: string; location: string;
}
interface Worklog { id: string; workDate: string; title: string; tags: string[]; scheduleId: string; projectId: string; updatedAt: string }
interface Project { id: string; name: string; active: boolean; updatedAt: string; color: string }

function saveSchedule(gas: Gas, input: Record<string, unknown>) {
  return gas.call<ApiResult<Schedule>>('apiSaveSchedule', input);
}
function range(gas: Gas, from: string, to: string) {
  return ok(gas.call<ApiResult<{ schedules: Schedule[]; worklogs: Worklog[] }>>('apiGetRange', { from, to }));
}
const base = { type: 'TASK', title: '배포 준비', startAt: '2026-09-24T10:00', endAt: '2026-09-24T12:00' };

describe('일정', () => {
  it('등록 → 수정 → 상태 변경 → 삭제', () => {
    const gas = createReadyGas();
    const created = ok(saveSchedule(gas, { ...base, priority: 'HIGH', location: 'https://meet.google.com/abc' }));
    expect(created).toMatchObject({ title: '배포 준비', priority: 'HIGH', status: 'PLANNED', allDay: false });

    gas.setNow('2026-09-24T08:00:00+09:00');
    const updated = ok(saveSchedule(gas, { ...created, title: '배포 준비 (수정)' }));
    expect(updated.title).toBe('배포 준비 (수정)');
    expect(updated.updatedAt).not.toBe(created.updatedAt);

    const done = ok(gas.call<ApiResult<Schedule>>('apiSetScheduleStatus', { id: created.id, status: 'DONE', updatedAt: updated.updatedAt }));
    expect(done.status).toBe('DONE');

    ok(gas.call('apiDeleteSchedule', { id: created.id, updatedAt: done.updatedAt }));
    expect(range(gas, '2026-09-24', '2026-09-24').schedules).toHaveLength(0);
    // 논리 삭제: 행은 남아 있다
    expect(gas.sheet('schedules').getLastRow()).toBe(2);
  });

  it('입력 검증', () => {
    const gas = createReadyGas();
    expect(err(saveSchedule(gas, { ...base, title: '   ' }))).toMatchObject({ code: 'VALIDATION', message: '제목을 입력해 주세요.' });
    expect(err(saveSchedule(gas, { ...base, endAt: '2026-09-24T09:00' })).message).toBe('종료가 시작보다 앞설 수 없습니다.');
    expect(err(saveSchedule(gas, { ...base, startAt: '2026-02-30T10:00' })).message).toContain('시작 일시가 올바른 일시가 아닙니다');
    expect(err(saveSchedule(gas, { ...base, type: 'PARTY' })).message).toBe('구분이 올바르지 않습니다.');
    expect(err(saveSchedule(gas, { ...base, location: 'javascript://alert(1)' })).message).toContain('http:// 또는 https://');
    expect(err(saveSchedule(gas, { ...base, title: 'a'.repeat(201) })).message).toBe('제목은 200자 이내로 입력해 주세요.');
    expect(err(gas.call('apiSaveSchedule', 'not-an-object') as ApiResult<unknown>).code).toBe('VALIDATION');
    expect(gas.sheet('schedules').getLastRow()).toBe(1);
  });

  it('제어 문자는 지우고 한 줄 필드의 줄바꿈은 공백으로 바꾼다', () => {
    const gas = createReadyGas();
    const s = ok(saveSchedule(gas, { ...base, title: ' 제목\n둘째줄\u0007 ', description: '  내용\r\n다음 줄  ' }));
    expect(s.title).toBe('제목 둘째줄');
    expect((s as unknown as { description: string }).description).toBe('내용\n다음 줄');
  });

  it('낙관적 잠금: 다른 곳에서 먼저 수정했으면 CONFLICT', () => {
    const gas = createReadyGas();
    const created = ok(saveSchedule(gas, base));
    gas.setNow('2026-09-24T08:00:00+09:00');
    ok(saveSchedule(gas, { ...created, title: '탭 A에서 수정' }));
    const e = err(saveSchedule(gas, { ...created, title: '탭 B에서 수정' }));
    expect(e.code).toBe('CONFLICT');
    expect(err(saveSchedule(gas, { ...created, updatedAt: undefined })).code).toBe('VALIDATION');
  });

  it('종일·여러 날·자정 종료 일정의 기간 조회', () => {
    const gas = createReadyGas();
    ok(saveSchedule(gas, { title: '출장', allDay: true, startAt: '2026-09-28', endAt: '2026-09-30' }));
    ok(saveSchedule(gas, { title: '야간 작업', startAt: '2026-09-24T22:00', endAt: '2026-09-25T00:00' }));
    ok(saveSchedule(gas, { title: '10월 일정', startAt: '2026-10-01T09:00', endAt: '2026-10-01T10:00' }));

    expect(range(gas, '2026-09-29', '2026-09-29').schedules.map((s) => s.title)).toEqual(['출장']);
    expect(range(gas, '2026-09-25', '2026-09-25').schedules).toHaveLength(0); // 자정에 끝나면 다음날은 아님
    expect(range(gas, '2026-09-24', '2026-09-24').schedules.map((s) => s.title)).toEqual(['야간 작업']);
    const trip = range(gas, '2026-09-01', '2026-09-30').schedules.find((s) => s.title === '출장')!;
    expect(trip).toMatchObject({ allDay: true, startAt: '2026-09-28T00:00', endAt: '2026-09-30T00:00' });
  });

  it('존재하지 않거나 삭제된 일정 수정은 NOT_FOUND', () => {
    const gas = createReadyGas();
    expect(err(saveSchedule(gas, { ...base, id: 'no-such-id', updatedAt: 'x' })).code).toBe('NOT_FOUND');
    const s = ok(saveSchedule(gas, base));
    ok(gas.call('apiDeleteSchedule', { id: s.id, updatedAt: s.updatedAt }));
    expect(err(saveSchedule(gas, { ...s })).code).toBe('NOT_FOUND');
  });
});

describe('프로젝트', () => {
  it('이름 중복 금지, 사용 중지 프로젝트는 새로 지정 불가·기존 값 유지는 허용', () => {
    const gas = createReadyGas();
    const p = ok(gas.call<ApiResult<Project>>('apiSaveProject', { name: 'alpha-app', color: '#FF0000' }));
    expect(p.color).toBe('#ff0000');
    expect(err(gas.call<ApiResult<Project>>('apiSaveProject', { name: 'ALPHA-APP' })).message).toContain('같은 이름');
    expect(err(gas.call<ApiResult<Project>>('apiSaveProject', { name: 'x', color: 'red' })).message).toContain('#RRGGBB');

    const s = ok(saveSchedule(gas, { ...base, projectId: p.id }));
    gas.setNow('2026-09-24T08:00:00+09:00');
    const inactive = ok(gas.call<ApiResult<Project>>('apiSaveProject', { ...p, active: false }));
    expect(inactive.active).toBe(false);

    // 기존에 지정돼 있던 값은 그대로 두고 다른 항목만 수정 → 허용
    expect(saveSchedule(gas, { ...s, title: '제목만 수정' }).ok).toBe(true);
    // 새 일정에 사용 중지 프로젝트 지정 → 거부
    expect(err(saveSchedule(gas, { ...base, projectId: p.id })).message).toContain('사용 중지된 프로젝트');
    expect(err(saveSchedule(gas, { ...base, projectId: 'unknown-id' })).message).toContain('선택한 프로젝트가 없습니다');
  });
});

describe('작업기록', () => {
  it('태그 정리(중복·# 제거), 하루 여러 건', () => {
    const gas = createReadyGas();
    ok(gas.call('apiSaveWorklog', { workDate: '2026-09-24', title: '장애 대응', content: 'DB 커넥션 풀 조정', tags: ['#장애', '장애', 'DB', ' db ', ''] }));
    ok(gas.call('apiSaveWorklog', { workDate: '2026-09-24', title: '코드 리뷰' }));
    const logs = range(gas, '2026-09-24', '2026-09-24').worklogs;
    expect(logs).toHaveLength(2);
    expect(logs.find((w) => w.title === '장애 대응')!.tags).toEqual(['장애', 'DB']);
    expect(err(gas.call('apiSaveWorklog', { workDate: '2026-09-24', title: 't', tags: Array.from({ length: 11 }, (_, i) => 't' + i) }) as ApiResult<unknown>).message).toContain('최대 10개');
    expect(err(gas.call('apiSaveWorklog', { workDate: '', title: 't' }) as ApiResult<unknown>).message).toContain('작업일이 올바른 날짜가 아닙니다');
  });

  it('연결 일정 완료 처리 (completeSchedule)', () => {
    const gas = createReadyGas();
    const s = ok(saveSchedule(gas, base));
    gas.setNow('2026-09-24T18:00:00+09:00');
    const res = ok(gas.call<ApiResult<{ worklog: Worklog; completedSchedule: Schedule }>>('apiSaveWorklog', {
      workDate: '2026-09-24', title: '배포 완료', scheduleId: s.id, completeSchedule: true,
    }));
    expect(res.worklog.scheduleId).toBe(s.id);
    expect(res.completedSchedule.status).toBe('DONE');
    expect(range(gas, '2026-09-24', '2026-09-24').schedules[0].status).toBe('DONE');
  });

  it('삭제된 일정은 새로 연결할 수 없지만, 이미 연결된 기록 수정은 허용', () => {
    const gas = createReadyGas();
    const s = ok(saveSchedule(gas, base));
    const w = ok(gas.call<ApiResult<{ worklog: Worklog }>>('apiSaveWorklog', { workDate: '2026-09-24', title: '기록', scheduleId: s.id })).worklog;
    ok(gas.call('apiDeleteSchedule', { id: s.id, updatedAt: s.updatedAt }));

    expect(err(gas.call('apiSaveWorklog', { workDate: '2026-09-24', title: '새 기록', scheduleId: s.id }) as ApiResult<unknown>).message).toContain('연결할 일정을 찾을 수 없습니다');
    gas.setNow('2026-09-24T09:00:00+09:00');
    const edited = gas.call<ApiResult<{ worklog: Worklog; completedSchedule: null }>>('apiSaveWorklog', { ...w, title: '기록 수정', completeSchedule: true });
    expect(ok(edited).completedSchedule).toBeNull();
    // 검증 실패 시에는 아무것도 쓰지 않는다
    expect(gas.sheet('worklogs').getLastRow()).toBe(2);
  });

  it('삭제', () => {
    const gas = createReadyGas();
    const w = ok(gas.call<ApiResult<{ worklog: Worklog }>>('apiSaveWorklog', { workDate: '2026-09-24', title: '기록' })).worklog;
    expect(err(gas.call('apiDeleteWorklog', { id: w.id, updatedAt: 'stale' }) as ApiResult<unknown>).code).toBe('CONFLICT');
    ok(gas.call('apiDeleteWorklog', { id: w.id, updatedAt: w.updatedAt }));
    expect(range(gas, '2026-09-24', '2026-09-24').worklogs).toHaveLength(0);
  });
});

describe('검색', () => {
  it('타이틀·내용·태그 부분 일치, 대소문자 무시, 최신순', () => {
    const gas = createReadyGas();
    ok(gas.call('apiSaveWorklog', { workDate: '2026-09-01', title: 'DB 업그레이드 준비', content: 'blue/green' }));
    ok(gas.call('apiSaveWorklog', { workDate: '2026-09-20', title: '회의록', content: 'MySQL 8.4 검토' }));
    ok(gas.call('apiSaveWorklog', { workDate: '2026-09-10', title: '기타', tags: ['mysql'] }));
    ok(saveSchedule(gas, { ...base, title: 'MySQL 점검', startAt: '2026-10-02T10:00', endAt: '2026-10-02T11:00' }));

    const r = ok(gas.call<ApiResult<{ worklogs: Worklog[]; schedules: Schedule[]; truncated: boolean }>>('apiSearch', { keyword: 'mysql' }));
    expect(r.worklogs.map((w) => w.workDate)).toEqual(['2026-09-20', '2026-09-10']);
    expect(r.schedules.map((s) => s.title)).toEqual(['MySQL 점검']);
    expect(r.truncated).toBe(false);

    const ranged = ok(gas.call<ApiResult<{ worklogs: Worklog[] }>>('apiSearch', { keyword: 'mysql', from: '2026-09-15', to: '2026-09-30' }));
    expect(ranged.worklogs).toHaveLength(1);
    expect(err(gas.call('apiSearch', { keyword: '  ' }) as ApiResult<unknown>).message).toBe('검색어를 입력해 주세요.');
  });

  it('프로젝트 필터와 결과 상한', () => {
    const gas = createReadyGas();
    const p = ok(gas.call<ApiResult<Project>>('apiSaveProject', { name: 'beta-app' }));
    for (let i = 0; i < 105; i++) {
      ok(gas.call('apiSaveWorklog', { workDate: '2026-09-24', title: '작업 ' + i, projectId: i < 3 ? p.id : '' }));
    }
    const all = ok(gas.call<ApiResult<{ worklogs: Worklog[]; truncated: boolean }>>('apiSearch', { keyword: '작업' }));
    expect(all.worklogs).toHaveLength(100);
    expect(all.truncated).toBe(true);
    const filtered = ok(gas.call<ApiResult<{ worklogs: Worklog[] }>>('apiSearch', { keyword: '작업', projectId: p.id }));
    expect(filtered.worklogs).toHaveLength(3);
  });
});
