/**
 * 일본 공휴일 캘린더 ja/ko/en 인식 (v1.15). 설계: docs/design/holiday-calendar.md
 * 구글 화면 언어에 따라 추가되는 캘린더 ID·이름·설명이 다르다 (2026-09-27 Calendar API로 확인):
 * - ja: 日本の祝日 / 이름 일본어 / 설명 「祝日」·「祭日\n…」
 * - ko: 일본의 휴일, en: Holidays in Japan / 이름 영어 / 설명 「Public holiday」·「Observance\n…」
 */
import { describe, expect, it } from 'vitest';
import { createGas, createReadyGas, HOLIDAY_ID, HOLIDAY_ID_EN, HOLIDAY_ID_KO, ok, type ApiResult, type Gas } from './harness';

type Range = { holidays: Array<{ date: string; name: string }>; holidayCalendarAvailable: boolean };

const JA_EVENTS = [
  { title: '秋分の日', start: '2026-09-23', end: '2026-09-23', allDay: true, description: '祝日' },
  { title: '七夕', start: '2026-09-24', end: '2026-09-24', allDay: true, description: '祭日\n祭日を非表示にするには、Google カレンダーの [設定] > [日本の祝日] に移動してください' },
];
const EN_EVENTS = [
  { title: 'Autumn Equinox Day', start: '2026-09-23', end: '2026-09-23', allDay: true, description: 'Public holiday' },
  { title: 'Tanabata', start: '2026-09-24', end: '2026-09-24', allDay: true, description: 'Observance\nTo hide observances, go to Google Calendar Settings > Holidays in Japan' },
];

/** ja 캘린더는 없고 ko 또는 en만 구독한 상태 */
function withOnly(id: string, gas: Gas = createReadyGas()) {
  gas.state.holidaySubscribed = false;
  gas.state.otherHolidayCalendars = { [id]: EN_EVENTS };
  return gas;
}

function range(gas: Gas) {
  return ok(gas.call<ApiResult<Range>>('apiGetRange', { from: '2026-09-01', to: '2026-09-30' }));
}

const holidayLine = (log: string) => log.split('\n').find((l) => l.includes('공휴일 캘린더') || l.includes('祝日カレンダー'));

describe('공휴일 캘린더 찾기 (ja → ko → en)', () => {
  it.each([
    ['한국어 화면에서 추가한 ko 캘린더', HOLIDAY_ID_KO],
    ['영어 화면에서 추가한 en 캘린더', HOLIDAY_ID_EN],
  ])('%s만 있어도 공휴일을 읽고, Observance(기념일)는 뺀다', (_label, id) => {
    const r = range(withOnly(id));
    expect(r.holidayCalendarAvailable).toBe(true);
    expect(r.holidays).toEqual([{ date: '2026-09-23', name: 'Autumn Equinox Day' }]);
  });

  it('여러 개 구독돼 있으면 일본어 이름이 나오는 ja를 쓴다', () => {
    const gas = createReadyGas();
    gas.state.holidays = JA_EVENTS;
    gas.state.otherHolidayCalendars = { [HOLIDAY_ID_KO]: EN_EVENTS, [HOLIDAY_ID_EN]: EN_EVENTS };
    expect(range(gas).holidays).toEqual([{ date: '2026-09-23', name: '秋分の日' }]);
  });

  it('ko와 en이 둘 다 있으면 ko를 먼저 쓴다', () => {
    const gas = createReadyGas();
    gas.state.holidaySubscribed = false;
    gas.state.otherHolidayCalendars = {
      [HOLIDAY_ID_EN]: [{ title: 'from-en', start: '2026-09-23', end: '2026-09-23', allDay: true, description: 'Public holiday' }],
      [HOLIDAY_ID_KO]: [{ title: 'from-ko', start: '2026-09-23', end: '2026-09-23', allDay: true, description: 'Public holiday' }],
    };
    expect(range(gas).holidays).toEqual([{ date: '2026-09-23', name: 'from-ko' }]);
  });

  it('한 캘린더 조회가 오류를 내도 다음 캘린더를 찾는다', () => {
    const gas = withOnly(HOLIDAY_ID_EN);
    gas.state.calendarLookupThrowsIds = [HOLIDAY_ID, HOLIDAY_ID_KO];
    const r = range(gas);
    expect(r.holidayCalendarAvailable).toBe(true);
    expect(r.holidays.map((h) => h.name)).toEqual(['Autumn Equinox Day']);
  });

  it('하나도 없으면 공휴일 없이 available=false (화면 배너)', () => {
    const gas = createReadyGas();
    gas.state.holidaySubscribed = false;
    expect(range(gas)).toMatchObject({ holidayCalendarAvailable: false, holidays: [] });
  });

  it('ja 캘린더: 설명 첫 줄이 祭日이면 기념일, 祝日·설명 없음이면 공휴일', () => {
    const gas = createReadyGas();
    gas.state.holidays = [
      ...JA_EVENTS,
      { title: '振替休日', start: '2026-09-22', end: '2026-09-22', allDay: true, description: '祝日' },
      { title: '説明なし', start: '2026-09-21', end: '2026-09-21', allDay: true },
    ];
    expect(range(gas).holidays.map((h) => h.name).sort()).toEqual(['振替休日', '秋分の日', '説明なし'].sort());
  });
});

describe('기념일 판단은 설명의 첫 줄만 본다', () => {
  const names = (events: Array<{ title: string; description: string }>) => {
    const gas = createReadyGas();
    gas.state.holidays = events.map((e, i) => ({ ...e, start: `2026-09-1${i}`, end: `2026-09-1${i}`, allDay: true }));
    return range(gas).holidays.map((h) => h.name);
  };

  it('둘째 줄 이후에 祭日·Observance가 있어도 첫 줄이 祝日·Public holiday면 공휴일', () => {
    expect(names([
      { title: 'A', description: '祝日\n祭日を非表示にするには…' },
      { title: 'B', description: 'Public holiday\nObservance' },
    ])).toEqual(['A', 'B']);
  });

  it('CRLF·CR 줄바꿈, 앞의 빈 줄과 공백이 있어도 기념일을 알아본다', () => {
    expect(names([
      { title: 'crlf', description: 'Observance\r\nTo hide observances, go to Google Calendar Settings' },
      { title: 'cr', description: '祭日\r祭日を非表示にするには…' },
      { title: 'blank', description: '\n  祭日 \n…' },
      { title: 'holiday', description: '\r\n祝日' },
    ])).toEqual(['holiday']);
  });
});

describe('아침 메일: ko·en 캘린더로도 공휴일에 쉰다', () => {
  it('ko 캘린더: Public holiday는 쉬고 Observance는 보낸다', () => {
    const gas = withOnly(HOLIDAY_ID_KO);
    gas.setNow('2026-09-23T07:30:00+09:00');
    expect(gas.call('sendMorningDigest')).toBe('SKIPPED_HOLIDAY');
    gas.setNow('2026-09-24T07:30:00+09:00');
    expect(gas.call('sendMorningDigest')).toBe('SENT');
  });
});

describe('setup·runSelfTest 안내', () => {
  it('ko 캘린더만 있어도 setup은 [OK]', () => {
    const gas = withOnly(HOLIDAY_ID_KO, createGas());
    expect(gas.call<string>('setup')).toContain('[OK] 일본 공휴일 캘린더 확인됨');
  });

  it('runSelfTest [OK] 줄에 실제로 찾은 캘린더 이름이 나온다', () => {
    expect(holidayLine(createReadyGas().call<string>('runSelfTest'))).toBe('[OK] 일본 공휴일 캘린더 구독됨: 日本の祝日');
    expect(holidayLine(withOnly(HOLIDAY_ID_KO).call<string>('runSelfTest'))).toBe('[OK] 일본 공휴일 캘린더 구독됨: 일본의 휴일');
    expect(holidayLine(withOnly(HOLIDAY_ID_EN).call<string>('runSelfTest'))).toBe('[OK] 일본 공휴일 캘린더 구독됨: Holidays in Japan');
  });

  it('하나도 없으면 [WARN], setup 경고에는 세 언어 이름이 모두 있다', () => {
    const gas = createGas();
    gas.state.holidaySubscribed = false;
    const log = gas.call<string>('setup');
    const warn = log.split('\n').find((l) => l.startsWith('[WARN] 일본 공휴일'))!;
    for (const name of ['일본 공휴일', '日本の祝日', 'Holidays in Japan']) expect(warn).toContain(name);
    expect(holidayLine(gas.call<string>('runSelfTest'))).toBe('[WARN] 일본 공휴일 캘린더 미구독 (공휴일에도 메일 발송됨)');
  });

  it('일본어: 경고에 日本の祝日·Holidays in Japan을 적고 한글은 쓰지 않는다', () => {
    const gas = createGas();
    gas.state.activeLocale = 'ja-JP';
    gas.state.holidaySubscribed = false;
    const warn = gas.call<string>('setup').split('\n').find((l) => l.includes('[WARN] 日本の祝日'))!;
    expect(warn).toContain('「日本の祝日」');
    expect(warn).toContain('Holidays in Japan');
    expect(warn).not.toMatch(/[가-힣]/);
    gas.state.holidaySubscribed = true;
    expect(holidayLine(gas.call<string>('runSelfTest'))).toBe('[OK] 日本の祝日カレンダーを登録済み: 日本の祝日');
  });
});
