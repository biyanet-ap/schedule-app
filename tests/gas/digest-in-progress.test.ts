import { describe, expect, it } from 'vitest';
import { createReadyGas, ok, type ApiResult, type Gas } from './harness';

interface DigestWorklog { id: string; title: string; status: string; workDate: string; endDate: string; projectName: string; dateLabel: string; updatedAt: string }
interface Digest { inProgress: DigestWorklog[]; inProgressTotal: number; schedules: unknown[] }

function log(gas: Gas, input: Record<string, unknown>) {
  return ok(gas.call<ApiResult<{ worklog: DigestWorklog }>>('apiSaveWorklog', input)).worklog;
}
function lastNotify(gas: Gas) {
  const sheet = gas.sheet('notify_log');
  const r = sheet.rawRow(sheet.getLastRow());
  return { result: r[3], detail: r[4] };
}

describe('오늘 요약 — 진행 중 작업기록', () => {
  it('날짜와 상관없이 진행 중만, 오래된 순 (완료·삭제 제외), 프로젝트 이름·날짜 문구', () => {
    const gas = createReadyGas(); // 오늘 = 2026-09-24 (목)
    const p = ok(gas.call<ApiResult<{ id: string }>>('apiSaveProject', { name: '프로젝트 A' }));
    log(gas, { workDate: '2026-09-24', title: '오늘 진행', projectId: p.id });
    log(gas, { workDate: '2026-08-01', title: '오래된 진행' });
    log(gas, { workDate: '2026-09-21', endDate: '2026-09-25', title: '이번 주 기간' });
    log(gas, { workDate: '2026-10-05', title: '앞날짜 진행' });
    log(gas, { workDate: '2026-09-23', title: '완료한 일', status: 'DONE' });
    const gone = log(gas, { workDate: '2026-09-22', title: '삭제한 일' });
    ok(gas.call('apiDeleteWorklog', { id: gone.id, updatedAt: gone.updatedAt }));

    const d = ok(gas.call<ApiResult<Digest>>('apiGetToday'));
    expect(d.inProgressTotal).toBe(4);
    expect(d.inProgress.map((w) => [w.title, w.dateLabel, w.projectName])).toEqual([
      ['오래된 진행', '8/1', ''],
      ['이번 주 기간', '9/21~9/25', ''],
      ['오늘 진행', '9/24', '프로젝트 A'],
      ['앞날짜 진행', '10/5', ''],
    ]);
    // 팝업에서 바로 완료 처리할 수 있게 작업기록 필드(updatedAt 등)를 그대로 준다
    expect(d.inProgress[0].updatedAt).toBeTruthy();
  });

  it('11건 이상이면 오래된 순 10건만, 총 건수는 전부', () => {
    const gas = createReadyGas();
    for (let i = 1; i <= 12; i++) log(gas, { workDate: `2026-09-${String(i).padStart(2, '0')}`, title: '진행 ' + i });
    const d = ok(gas.call<ApiResult<Digest>>('apiGetToday'));
    expect(d.inProgressTotal).toBe(12);
    expect(d.inProgress).toHaveLength(10);
    expect(d.inProgress[0].title).toBe('진행 1');
    expect(d.inProgress[9].title).toBe('진행 10');
  });
});

describe('아침 메일 — 진행 중 작업기록', () => {
  it('제목에 건수, 본문에 구역 (기한 지난 작업 다음), HTML 이스케이프, 발송 기록', () => {
    const gas = createReadyGas();
    ok(gas.call('apiSaveSchedule', { title: '지난주 못한 작업', startAt: '2026-09-18T10:00', endAt: '2026-09-18T11:00' }));
    log(gas, { workDate: '2026-09-22', title: '<b>굵게</b> 진행' });
    log(gas, { workDate: '2026-09-21', endDate: '2026-09-25', title: '주간 정리' });
    expect(gas.call('sendMorningDigest')).toBe('SENT');
    const mail = gas.state.sentMails[0];
    expect(mail.subject).toBe('[스케줄관리] 9/24(목) 일정 0건 · 회의 0건 · 밀린 작업 1건 · 진행 중 2건');
    expect(mail.body).toContain('■ 진행 중인 작업 (2건)\n  - 주간 정리 (9/21~9/25)\n  - <b>굵게</b> 진행 (9/22)');
    expect(mail.body.indexOf('■ 기한 지난 미완료 작업')).toBeLessThan(mail.body.indexOf('■ 진행 중인 작업'));
    expect(mail.htmlBody).toContain('&lt;b&gt;굵게&lt;/b&gt; 진행');
    expect(mail.htmlBody).not.toContain('<b>굵게</b>');
    expect(lastNotify(gas)).toMatchObject({ result: 'SENT', detail: 'schedules=0, meetings=0, overdue=1, inProgress=2' });
  });

  it('10건 넘으면 "오래된 순 10건 표시"', () => {
    const gas = createReadyGas();
    for (let i = 1; i <= 11; i++) log(gas, { workDate: `2026-09-${String(i).padStart(2, '0')}`, title: '진행 ' + i });
    gas.call('sendMorningDigest');
    expect(gas.state.sentMails[0].body).toContain('■ 진행 중인 작업 (11건, 오래된 순 10건 표시)');
  });

  it('진행 중이 없으면 구역·제목 문구 없음', () => {
    const gas = createReadyGas();
    log(gas, { workDate: '2026-09-23', title: '끝남', status: 'DONE' });
    gas.call('sendMorningDigest');
    const mail = gas.state.sentMails[0];
    expect(mail.subject).not.toContain('진행 중');
    expect(mail.body).not.toContain('진행 중인 작업');
  });

  it('notify_when_empty=FALSE여도 진행 중 작업이 있으면 보낸다 (없으면 생략)', () => {
    const gas = createReadyGas();
    gas.sheet('settings').write(3, 2, 'FALSE'); // notify_when_empty
    expect(gas.call('sendMorningDigest')).toBe('SKIPPED_EMPTY');
    gas.setNow('2026-09-25T07:30:00+09:00');
    log(gas, { workDate: '2026-09-24', title: '어제 하던 일' });
    expect(gas.call('sendMorningDigest')).toBe('SENT');
  });
});
