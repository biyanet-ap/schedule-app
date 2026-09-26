import { describe, expect, it } from 'vitest';
import { createGas, createReadyGas, OWNER } from './harness';

describe('setup', () => {
  it('시트·머리글·기본 설정·트리거를 만든다', () => {
    const gas = createGas();
    const report = gas.call<string>('setup');

    const ss = gas.spreadsheet();
    expect(ss.getSheets().map((s) => s.getName()).sort()).toEqual(['diaries', 'notify_log', 'projects', 'schedules', 'settings', 'worklogs']);
    expect(gas.sheet('schedules').rawRow(1)).toEqual(gas.eval('SHEETS.SCHEDULES.columns.slice()'));
    expect(gas.sheet('schedules').frozenRows).toBe(1);
    expect(gas.props.get('OWNER_EMAIL')).toBe(OWNER);

    const settings = gas.eval('JSON.stringify(getSettings_())');
    expect(JSON.parse(settings)).toEqual({
      notify_enabled: 'TRUE', notify_when_empty: 'TRUE', skip_holidays: 'TRUE', backup_keep: '8', digest_hour: '7', today_popup: 'TRUE', language: 'auto',
    });
    expect(gas.sheet('settings').getLastRow()).toBe(8);

    expect(gas.state.triggers).toEqual([
      { handler: 'sendMorningDigest', config: { atHour: 7, everyDays: 1, timezone: 'Asia/Tokyo' } },
      { handler: 'weeklyBackup', config: { onWeekDay: 'MONDAY', atHour: 3, timezone: 'Asia/Tokyo' } },
    ]);
    expect(report).toContain('[OK] 일본 공휴일 캘린더 확인됨');
  });

  it('여러 번 실행해도 설정·트리거가 중복되지 않는다', () => {
    const gas = createReadyGas();
    const firstId = gas.props.get('SPREADSHEET_ID');
    gas.call('setup');
    gas.call('setup');
    expect(gas.props.get('SPREADSHEET_ID')).toBe(firstId);
    expect(gas.state.spreadsheets.size).toBe(1);
    expect(gas.sheet('settings').getLastRow()).toBe(8);
    expect(gas.state.triggers).toHaveLength(2);
  });

  it('저장된 스프레드시트를 열 수 없으면 새로 만들지 않고 멈춘다', () => {
    const gas = createReadyGas();
    gas.state.spreadsheets.clear();
    expect(() => gas.raw('setup')).toThrow(/열 수 없습니다/);
    expect(gas.state.spreadsheets.size).toBe(0);
  });

  it('공휴일 캘린더가 구독돼 있지 않으면 경고를 남긴다', () => {
    const gas = createGas();
    gas.state.holidaySubscribed = false;
    expect(gas.call<string>('setup')).toContain('[WARN] 일본 공휴일 캘린더를 읽을 수 없습니다');
  });
});

describe('셀 저장 규칙', () => {
  const tricky = ['=IMPORTXML("http://x","//a")', '+81-90-0000-0000', '-항목 정리', '@mention', "'인용", '2026-09-24', '00123', 'TRUE', '줄1\n줄2'];

  it('까다로운 값도 입력 그대로 돌아온다 (수식·날짜·숫자 변환 없음)', () => {
    const gas = createReadyGas();
    for (const title of tricky) {
      const saved = gas.call<{ ok: boolean; data: { id: string } }>('apiSaveWorklog', { workDate: '2026-09-24', title: title.replace('\n', ' '), content: title });
      expect(saved.ok).toBe(true);
    }
    const res = gas.call<{ ok: true; data: { worklogs: Array<{ content: string }> } }>('apiGetRange', { from: '2026-09-24', to: '2026-09-24' });
    expect(res.data.worklogs.map((w) => w.content).sort()).toEqual([...tricky].sort());
  });

  it('수식으로 해석될 값은 시트에 보호 문자와 함께 저장된다', () => {
    const gas = createReadyGas();
    gas.call('apiSaveWorklog', { workDate: '2026-09-24', title: '=1+1' });
    const row = gas.sheet('worklogs').rawRow(2);
    expect(row[2]).toBe('⁠=1+1');
    expect(row.some((c) => typeof c === 'object')).toBe(false); // 수식 셀 없음
  });

  it('새 행에도 일반 텍스트 서식을 지정한다 (시트 기본 행 수를 넘어도)', () => {
    const gas = createReadyGas();
    const sheet = gas.sheet('worklogs');
    sheet.maxRows = 2; // 머리글 + 1행만 남은 상황
    gas.call('apiSaveWorklog', { workDate: '2026-09-24', title: 'a' });
    gas.call('apiSaveWorklog', { workDate: '2026-09-25', title: 'b' });
    expect(sheet.getMaxRows()).toBeGreaterThan(2);
    expect(sheet.rawRow(3)[1]).toBe('2026-09-25'); // 날짜로 변환되지 않음
  });

  it('손으로 고쳐 Date로 바뀐 셀도 문자열로 읽는다', () => {
    const gas = createReadyGas();
    gas.call('apiSaveWorklog', { workDate: '2026-09-24', title: 'x' });
    gas.sheet('worklogs').cells.set('2:2', new Date('2026-09-24T00:00:00+09:00'));
    const res = gas.call<{ ok: true; data: { worklogs: Array<{ workDate: string }> } }>('apiGetRange', { from: '2026-09-24', to: '2026-09-24' });
    expect(res.data.worklogs[0].workDate).toBe('2026-09-24');
  });
});
