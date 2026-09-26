import { describe, expect, it } from 'vitest';
import { createGas, createReadyGas, err, ok, OWNER, type ApiResult, type Gas } from './harness';

function notifyLog(gas: Gas) {
  const sheet = gas.sheet('notify_log');
  const rows = [];
  for (let r = 2; r <= sheet.getLastRow(); r++) rows.push(sheet.rawRow(r));
  return rows.map((r) => ({ kind: r[1], date: r[2], result: r[3], detail: r[4] }));
}

describe('아침 요약 메일', () => {
  it('평일: 오늘 일정·회의·밀린 작업을 담아 본인에게 보낸다 (HTML 이스케이프)', () => {
    const gas = createReadyGas();
    ok(gas.call('apiSaveSchedule', { title: '<script>alert(1)</script>', priority: 'HIGH', startAt: '2026-09-24T10:00', endAt: '2026-09-24T11:00' }));
    ok(gas.call('apiSaveSchedule', { title: '취소된 일정', status: 'CANCELLED', startAt: '2026-09-24T13:00', endAt: '2026-09-24T14:00' }));
    ok(gas.call('apiSaveSchedule', { title: '지난주 못한 작업', startAt: '2026-09-18T10:00', endAt: '2026-09-18T11:00' }));
    gas.state.calendarEvents = [
      { title: '주간 회의', start: '2026-09-24T14:00', end: '2026-09-24T15:00', location: '3F' },
      { title: '거절한 회의', start: '2026-09-24T16:00', end: '2026-09-24T17:00', myStatus: 'NO' },
    ];

    expect(gas.call('sendMorningDigest')).toBe('SENT');
    expect(gas.state.sentMails).toHaveLength(1);
    const mail = gas.state.sentMails[0];
    expect(mail.to).toBe(OWNER);
    expect(mail.subject).toBe('[스케줄관리] 9/24(목) 일정 1건 · 회의 1건 · 밀린 작업 1건');
    expect(mail.htmlBody).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(mail.htmlBody).not.toContain('<script>');
    expect(mail.body).toContain('[중요] <script>alert(1)</script> (10:00~11:00 · 작업)');
    expect(mail.body).toContain('주간 회의 (14:00~15:00 · 3F)');
    expect(mail.body).not.toContain('거절한 회의');
    expect(mail.body).not.toContain('취소된 일정');
    expect(mail.body).toContain('지난주 못한 작업 (마감 2026-09-18)');
    expect(mail.body).toContain('앱 열기: https://script.google.com/macros/s/TEST/exec');
    expect(notifyLog(gas).at(-1)).toMatchObject({ kind: 'DIGEST', date: '2026-09-24', result: 'SENT' });
  });

  it('같은 날 두 번 실행돼도 한 번만 보낸다', () => {
    const gas = createReadyGas();
    expect(gas.call('sendMorningDigest')).toBe('SENT');
    expect(gas.call('sendMorningDigest')).toBe('SKIPPED_DUPLICATE');
    expect(gas.state.sentMails).toHaveLength(1);
  });

  it('주말은 보내지 않는다', () => {
    const gas = createReadyGas();
    gas.setNow('2026-09-26T07:30:00+09:00'); // 토
    expect(gas.call('sendMorningDigest')).toBe('SKIPPED_WEEKEND');
    gas.setNow('2026-09-27T07:30:00+09:00'); // 일
    expect(gas.call('sendMorningDigest')).toBe('SKIPPED_WEEKEND');
    expect(gas.state.sentMails).toHaveLength(0);
  });

  it('일본 공휴일은 보내지 않고, 祭日(기념일)은 보낸다', () => {
    const gas = createReadyGas();
    gas.state.holidays = [
      { title: '秋分の日', start: '2026-09-23', end: '2026-09-23', allDay: true, description: '祝日' },
      { title: '七夕', start: '2026-09-24', end: '2026-09-24', allDay: true, description: '祭日' },
    ];
    gas.setNow('2026-09-23T07:30:00+09:00');
    expect(gas.call('sendMorningDigest')).toBe('SKIPPED_HOLIDAY');
    expect(notifyLog(gas).at(-1)).toMatchObject({ result: 'SKIPPED_HOLIDAY', detail: '秋分の日' });
    gas.setNow('2026-09-24T07:30:00+09:00');
    expect(gas.call('sendMorningDigest')).toBe('SENT');
  });

  it('공휴일 캘린더를 구독하지 않았으면 공휴일 판정 없이 보낸다', () => {
    const gas = createReadyGas();
    gas.state.holidaySubscribed = false;
    gas.state.holidays = [{ title: '秋分の日', start: '2026-09-23', end: '2026-09-23', allDay: true }];
    gas.setNow('2026-09-23T07:30:00+09:00');
    expect(gas.call('sendMorningDigest')).toBe('SENT');
  });

  it('일정이 없고 notify_when_empty=FALSE면 보내지 않는다', () => {
    const gas = createReadyGas();
    gas.sheet('settings').write(3, 2, 'FALSE'); // notify_when_empty
    expect(gas.eval('getSettings_().notify_when_empty')).toBe('FALSE');
    expect(gas.call('sendMorningDigest')).toBe('SKIPPED_EMPTY');
  });

  it('notify_enabled=FALSE면 보내지 않는다', () => {
    const gas = createReadyGas();
    gas.sheet('settings').write(2, 2, 'FALSE');
    expect(gas.call('sendMorningDigest')).toBe('SKIPPED_DISABLED');
  });

  it('발송 실패는 FAILED로 기록하고 다시 던진다', () => {
    const gas = createReadyGas();
    gas.state.mailThrows = true;
    expect(() => gas.raw('sendMorningDigest')).toThrow(/too many times/);
    expect(notifyLog(gas).at(-1)).toMatchObject({ result: 'FAILED' });
    expect(gas.state.consoleErrors.join()).toContain('sendMorningDigest');
  });

  it('캘린더 조회가 실패해도 메일은 보내고 본문에 알린다', () => {
    const gas = createReadyGas();
    gas.state.calendarThrows = true;
    expect(gas.call('sendMorningDigest')).toBe('SENT');
    expect(gas.state.sentMails[0].body).toContain('구글 캘린더 일정을 불러오지 못했습니다');
  });
});

describe('오늘 요약 API (접속 팝업)', () => {
  it('오늘 일정과 공휴일 이름을 준다', () => {
    const gas = createReadyGas();
    gas.state.holidays = [{ title: 'テスト祝日', start: '2026-09-24', end: '2026-09-24', allDay: true }];
    ok(gas.call('apiSaveSchedule', { title: '종일 작업', allDay: true, startAt: '2026-09-23', endAt: '2026-09-25' }));
    const today = ok(gas.call<ApiResult<{ date: string; weekday: string; holidayName: string; schedules: Array<{ timeLabel: string }> }>>('apiGetToday'));
    expect(today).toMatchObject({ date: '2026-09-24', weekday: '목', holidayName: 'テスト祝日' });
    expect(today.schedules[0].timeLabel).toBe('종일 09/23~09/25');
  });
});

describe('주간 백업', () => {
  it('백업 폴더에 복사하고 최근 8개만 남긴다', () => {
    const gas = createReadyGas();
    for (let i = 0; i < 10; i++) {
      gas.setNow(new Date(Date.parse('2026-07-06T03:30:00+09:00') + i * 7 * 86400000).toISOString());
      gas.call('weeklyBackup');
    }
    const backups = gas.drive.files.filter((f) => f.name.startsWith('schedule-db_backup_'));
    expect(backups).toHaveLength(10);
    const alive = backups.filter((f) => !f.isTrashed()).map((f) => f.name).sort();
    expect(alive).toHaveLength(8);
    expect(alive[0]).toBe('schedule-db_backup_2026-07-20'); // 가장 오래된 2개가 휴지통으로
    expect(gas.drive.folders).toHaveLength(1);
    expect(notifyLog(gas).filter((l) => l.kind === 'BACKUP' && l.result === 'OK')).toHaveLength(10);
  });

  it('백업 폴더가 휴지통에 있으면 새로 만든다', () => {
    const gas = createReadyGas();
    gas.call('weeklyBackup');
    gas.drive.folders[0].trashed = true;
    gas.call('weeklyBackup');
    expect(gas.drive.folders).toHaveLength(2);
  });
});

describe('API 공통', () => {
  it('소유자가 아니면 FORBIDDEN, doGet은 안내 문구만 보여준다', () => {
    const gas = createReadyGas();
    gas.state.activeEmail = 'someone@example.com';
    expect(err(gas.call('apiBootstrap') as ApiResult<unknown>).code).toBe('FORBIDDEN');
    const page = gas.raw('doGet') as { html?: string; file?: string };
    expect(page.file).toBeUndefined();
    expect(page.html).toContain('권한이 없습니다');
    expect(gas.state.logs.join()).toContain('s***@example.com');
  });

  it('소유자는 index.html을 받는다', () => {
    const gas = createReadyGas();
    const page = gas.raw('doGet') as { file: string; title: string; meta: Record<string, string> };
    expect(page).toMatchObject({ file: 'index', title: '스케줄관리', meta: { viewport: 'width=device-width, initial-scale=1' } });
  });

  it('setup 전에는 NOT_INITIALIZED', () => {
    const gas = createGas();
    expect(err(gas.call('apiBootstrap') as ApiResult<unknown>).code).toBe('NOT_INITIALIZED');
  });

  it('예상하지 못한 오류는 INTERNAL + 일반 문구, 상세는 로그로만', () => {
    const gas = createReadyGas();
    gas.eval('resetSpreadsheetCache_()');
    gas.state.openByIdThrows = true;
    const e = err(gas.call('apiGetRange', { from: '2026-09-01', to: '2026-09-30' }) as ApiResult<unknown>);
    expect(e).toEqual({ code: 'INTERNAL', message: '서버에서 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' });
    expect(gas.state.consoleErrors.join()).toContain('openById');
  });

  it('락을 못 잡으면 BUSY', () => {
    const gas = createReadyGas();
    gas.state.lockAvailable = false;
    expect(err(gas.call('apiSaveWorklog', { workDate: '2026-09-24', title: 'x' }) as ApiResult<unknown>).code).toBe('BUSY');
  });

  it('조회 기간은 62일까지', () => {
    const gas = createReadyGas();
    expect(ok(gas.call('apiGetRange', { from: '2026-08-30', to: '2026-10-31' }) as ApiResult<unknown>)).toBeTruthy();
    expect(err(gas.call('apiGetRange', { from: '2026-08-01', to: '2026-10-31' }) as ApiResult<unknown>).message).toContain('62일');
    expect(err(gas.call('apiGetRange', { from: '2026-09-30', to: '2026-09-01' }) as ApiResult<unknown>).message).toContain('앞설 수 없습니다');
  });

  it('구글 캘린더 일정과 공휴일을 함께 준다 (종일 일정은 포함 날짜로 변환)', () => {
    const gas = createReadyGas();
    gas.state.calendarEvents = [
      { title: '전사 워크숍', start: '2026-09-28', end: '2026-09-29', allDay: true },
      { title: '', start: '2026-09-24T09:00', end: '2026-09-24T09:30', id: 'rec' },
      { title: '', start: '2026-09-25T09:00', end: '2026-09-25T09:30', id: 'rec' },
    ];
    gas.state.holidays = [{ title: '秋分の日', start: '2026-09-23', end: '2026-09-23', allDay: true }];
    const r = ok(gas.call<ApiResult<{ calendarEvents: Array<{ id: string; title: string; startAt: string; endAt: string }>; holidays: unknown[]; holidayCalendarAvailable: boolean; calendarError: null }>>('apiGetRange', { from: '2026-09-01', to: '2026-09-30' }));
    expect(r.calendarEvents.find((e) => e.title === '전사 워크숍')).toMatchObject({ startAt: '2026-09-28T00:00', endAt: '2026-09-29T00:00' });
    const recurring = r.calendarEvents.filter((e) => e.title === '(제목 없음)');
    expect(new Set(recurring.map((e) => e.id)).size).toBe(2); // 반복 회차 ID 구분
    expect(r.holidays).toEqual([{ date: '2026-09-23', name: '秋分の日' }]);
    expect(r.holidayCalendarAvailable).toBe(true);
    expect(r.calendarError).toBeNull();
  });
});

describe('runSelfTest', () => {
  it('모든 항목을 점검한다', () => {
    const gas = createReadyGas();
    const report = gas.call<string>('runSelfTest');
    expect(report).not.toContain('[FAIL]');
    expect(report).toContain('[OK] 셀 저장 왕복 (11개 값 그대로 유지)');
    expect(gas.spreadsheet().getSheetByName('_selftest')).toBeNull();
  });
});

describe('요약 정렬', () => {
  it('같은 시각이면 중요(HIGH) 일정이 먼저 (HIGH=0 순위 버그 회귀 방지)', () => {
    const gas = createReadyGas();
    ok(gas.call('apiSaveSchedule', { title: 'medium-first', priority: 'MEDIUM', startAt: '2026-09-24T10:00', endAt: '2026-09-24T11:00' }));
    ok(gas.call('apiSaveSchedule', { title: 'high-second', priority: 'HIGH', startAt: '2026-09-24T10:00', endAt: '2026-09-24T11:00' }));
    const today = ok(gas.call<ApiResult<{ schedules: Array<{ title: string }> }>>('apiGetToday'));
    expect(today.schedules.map((s) => s.title)).toEqual(['high-second', 'medium-first']);
  });
});
