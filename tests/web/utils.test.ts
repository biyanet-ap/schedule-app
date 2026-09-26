import { describe, expect, it } from 'vitest';
import type { Schedule } from '../../src/api/types';
import { addDays, addMinutesToTime, dateSpan, defaultStartTime, formatDateLabel, isYmd, occursOn, timeLabel } from '../../src/utils/date';
import { addMonthsClamped } from '../../src/utils/date';
import { diaryDefaultTitle, diaryWeekLabel, weekDays } from '../../src/utils/diary';
import { periodRange, periodText, searchPeriodError } from '../../src/utils/searchPeriod';
import { safeHttpUrl, toEventInputs } from '../../src/utils/events';
import { defaultPeriod, isPeriodLog, monthRange, periodDays, periodError, periodLabel, weekRange, worklogOccursOn, worklogSpan } from '../../src/utils/worklog';

const sched = (p: Partial<Schedule>): Schedule => ({
  id: 'a', type: 'TASK', title: 't', description: '', startAt: '2026-09-24T10:00', endAt: '2026-09-24T11:00', allDay: false,
  priority: 'MEDIUM', projectId: '', location: '', status: 'PLANNED', tags: [], createdAt: '', updatedAt: '', ...p,
});

describe('date utils', () => {
  it('날짜 계산 (월·윤년 경계)', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(isYmd('2026-02-29')).toBe(false);
    expect(isYmd('2028-02-29')).toBe(true);
    expect(formatDateLabel('2026-09-24')).toBe('9월 24일 (목)');
  });

  it('일정이 걸친 날짜 — 서버와 같은 규칙', () => {
    expect(dateSpan(sched({ startAt: '2026-09-24T22:00', endAt: '2026-09-25T00:00' }))).toEqual({ start: '2026-09-24', end: '2026-09-24' });
    expect(dateSpan(sched({ allDay: true, startAt: '2026-09-28T00:00', endAt: '2026-09-30T00:00' }))).toEqual({ start: '2026-09-28', end: '2026-09-30' });
    expect(occursOn(sched({ allDay: true, startAt: '2026-09-28T00:00', endAt: '2026-09-30T00:00' }), '2026-09-30')).toBe(true);
  });

  it('시간 문구', () => {
    expect(timeLabel(sched({}))).toBe('10:00~11:00');
    expect(timeLabel(sched({ allDay: true, startAt: '2026-09-24T00:00', endAt: '2026-09-24T00:00' }))).toBe('종일');
    expect(timeLabel(sched({ allDay: true, startAt: '2026-09-24T00:00', endAt: '2026-09-26T00:00' }))).toBe('종일 9/24~9/26');
    expect(timeLabel(sched({ startAt: '2026-09-24T22:00', endAt: '2026-09-25T02:00' }), '2026-09-25')).toBe('9/24 22:00~9/25 02:00');
  });

  it('새 일정 기본 시각', () => {
    const at = new Date('2026-09-24T14:20:00+09:00');
    expect(defaultStartTime('2026-09-24', '2026-09-24', at)).toBe('15:00');
    expect(defaultStartTime('2026-09-25', '2026-09-24', at)).toBe('09:00');
    expect(addMinutesToTime('23:30', 60)).toEqual({ time: '00:30', dayOffset: 1 });
  });
});

describe('event mapping', () => {
  const data = {
    schedules: [
      sched({ id: 's1', allDay: true, startAt: '2026-09-28T00:00', endAt: '2026-09-30T00:00', projectId: 'p1' }),
      sched({ id: 's2', status: 'CANCELLED' }),
      sched({ id: 's3', status: 'DONE', priority: 'HIGH', type: 'MEETING' }),
    ],
    worklogs: [
      { id: 'w1', workDate: '2026-09-24', endDate: '', title: '기록', content: '', projectId: 'p2', scheduleId: '', tags: [], status: 'IN_PROGRESS' as const, createdAt: '', updatedAt: '' },
      { id: 'w2', workDate: '2026-09-24', endDate: '', title: '끝난 기록', content: '', projectId: 'p2', scheduleId: '', tags: [], status: 'DONE' as const, createdAt: '', updatedAt: '' },
    ],
    calendarEvents: [{ id: 'g1', title: '회의', startAt: '2026-09-24T13:00', endAt: '2026-09-24T14:00', allDay: false, location: '' }],
    holidays: [{ date: '2026-09-23', name: '秋分の日' }],
  };
  const projects = [{ id: 'p1', name: 'alpha', color: '#ff0000', sortOrder: 0, active: true, updatedAt: '' }];

  it('종일 일정 종료일은 다음날(미포함)로, 취소 일정은 제외, 프로젝트 색 적용', () => {
    const ev = toEventInputs(data, projects, { projectId: '', showGcal: true });
    const s1 = ev.find((e) => e.id === 's:s1')!;
    expect(s1).toMatchObject({ start: '2026-09-28', end: '2026-10-01', allDay: true, color: '#ff0000' });
    expect(ev.some((e) => e.id === 's:s2')).toBe(false);
    expect(ev.find((e) => e.id === 's:s3')!.title).toBe('✓ t'); // 완료면 중요 표시 생략
    expect(ev.map((e) => String(e.id).slice(0, 2)).sort()).toEqual(['c:', 'h:', 's:', 's:', 'w:', 'w:']);
    expect(ev.find((e) => e.id === 'w:w1')).toMatchObject({ title: '✎ 기록', className: '' });
    expect(ev.find((e) => e.id === 'w:w2')).toMatchObject({ title: '✓ 끝난 기록', className: 'ev-done' });
  });

  it('기간 기록은 종료일까지 이어진 종일 막대 (end = 종료일 다음날)', () => {
    const w3 = { ...data.worklogs[0], id: 'w3', workDate: '2026-09-21', endDate: '2026-09-25' };
    const ev = toEventInputs({ ...data, worklogs: [w3, data.worklogs[0]] }, projects, { projectId: '', showGcal: true });
    expect(ev.find((e) => e.id === 'w:w3')).toMatchObject({ start: '2026-09-21', end: '2026-09-26', allDay: true });
    expect(ev.find((e) => e.id === 'w:w1')).not.toHaveProperty('end');
  });

  it('프로젝트 필터와 구글 캘린더 표시 끄기', () => {
    const filtered = toEventInputs(data, projects, { projectId: 'p1', showGcal: true });
    expect(filtered.map((e) => e.id)).toEqual(['h:2026-09-23', 's:s1']);
    const noGcal = toEventInputs(data, projects, { projectId: '', showGcal: false });
    expect(noGcal.some((e) => String(e.id).startsWith('c:'))).toBe(false);
  });

  it('http/https 링크만 허용', () => {
    expect(safeHttpUrl(' https://meet.google.com/abc ')).toBe('https://meet.google.com/abc');
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('JaVaScRiPt://x')).toBeNull();
    expect(safeHttpUrl('3F 회의실')).toBeNull();
  });
});

describe('jstToday', () => {
  it('브라우저 시간대와 무관하게 JST 날짜', async () => {
    const { jstToday } = await import('../../src/utils/date');
    expect(jstToday(new Date('2026-09-24T14:59:59Z'))).toBe('2026-09-24');
    expect(jstToday(new Date('2026-09-24T15:00:00Z'))).toBe('2026-09-25');
  });
});

describe('parseTags / validateTags', () => {
  it('서버 규칙과 같게 정리', async () => {
    const { parseTags, validateTags } = await import('../../src/utils/tags');
    expect(parseTags('#배포, 배포 ,DB,, db')).toEqual(['배포', 'DB']);
    expect(parseTags('')).toEqual([]);
    const limits = { tagCount: 2, tagLength: 3 };
    expect(validateTags(['a', 'b'], limits)).toBe('');
    expect(validateTags(['a', 'b', 'c'], limits)).toContain('최대 2개');
    expect(validateTags(['abcd'], limits)).toContain('3자 이내');
  });
});

describe('작업기록 하루/기간 계산', () => {
  const day = { workDate: '2026-09-24', endDate: '' };
  const period = { workDate: '2026-09-21', endDate: '2026-09-25' };

  it('걸친 날짜와 표시 문구', () => {
    expect(isPeriodLog(day)).toBe(false);
    expect(isPeriodLog(period)).toBe(true);
    // 이전 버전 서버 응답처럼 endDate가 아예 없으면 하루 기록
    expect(isPeriodLog({} as { endDate: string })).toBe(false);
    expect(worklogSpan(day)).toEqual({ start: '2026-09-24', end: '2026-09-24' });
    expect(worklogSpan(period)).toEqual({ start: '2026-09-21', end: '2026-09-25' });
    expect(['2026-09-20', '2026-09-21', '2026-09-23', '2026-09-25', '2026-09-26'].map((d) => worklogOccursOn(period, d)))
      .toEqual([false, true, true, true, false]);
    expect(periodDays('2026-09-28', '2026-10-02')).toBe(5);
    expect(periodLabel(period)).toBe('9/21~9/25 · 5일');
  });

  it('빠른 선택: 주는 월~금, 일요일은 그 주(월요일 시작)에 속함', () => {
    expect(weekRange('2026-09-21', 0)).toEqual({ start: '2026-09-21', end: '2026-09-25' }); // 월
    expect(weekRange('2026-09-25', 0)).toEqual({ start: '2026-09-21', end: '2026-09-25' }); // 금
    expect(weekRange('2026-09-26', 0)).toEqual({ start: '2026-09-21', end: '2026-09-25' }); // 토
    expect(weekRange('2026-09-27', 0)).toEqual({ start: '2026-09-21', end: '2026-09-25' }); // 일
    expect(weekRange('2026-09-25', -1)).toEqual({ start: '2026-09-14', end: '2026-09-18' });
    expect(weekRange('2026-10-01', -1)).toEqual({ start: '2026-09-21', end: '2026-09-25' }); // 달 경계
  });

  it('빠른 선택: 이번 달은 1일~말일 (윤년·12월)', () => {
    expect(monthRange('2026-09-25')).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(monthRange('2028-02-10')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
    expect(monthRange('2026-12-31')).toEqual({ start: '2026-12-01', end: '2026-12-31' });
  });

  it('기간 탭 기본값: 기록할 날이 항상 들어간다', () => {
    expect(defaultPeriod('2026-09-24', null, 92)).toEqual({ start: '2026-09-21', end: '2026-09-25' }); // 목 → 월~금
    expect(defaultPeriod('2026-09-26', null, 92)).toEqual({ start: '2026-09-21', end: '2026-09-26' }); // 토 → 월~토
    expect(defaultPeriod('2026-09-27', null, 92)).toEqual({ start: '2026-09-21', end: '2026-09-27' }); // 일 → 월~일
    const sched = { start: '2026-09-26', end: '2026-09-28' };
    expect(defaultPeriod('2026-09-27', sched, 92)).toEqual(sched); // 여러 날 일정 → 일정 기간
    expect(defaultPeriod('2026-09-24', { start: '2026-09-24', end: '2026-09-24' }, 92)).toEqual({ start: '2026-09-21', end: '2026-09-25' }); // 하루 일정은 무시
    expect(defaultPeriod('2026-10-05', sched, 92)).toEqual({ start: '2026-10-05', end: '2026-10-09' }); // 기록할 날이 일정 밖
    expect(defaultPeriod('2026-09-24', { start: '2026-09-01', end: '2026-12-31' }, 92)).toEqual({ start: '2026-09-21', end: '2026-09-25' }); // 92일 초과 일정
  });

  it('기간 검사는 서버와 같은 기준', () => {
    expect(periodError('2026-09-21', '2026-09-25', 92)).toBe('');
    expect(periodError('2026-09-21', '2026-09-21', 92)).toContain('종료일은 시작일보다 뒤여야 합니다.');
    expect(periodError('2026-09-01', '2026-12-01', 92)).toBe('');
    expect(periodError('2026-09-01', '2026-12-02', 92)).toBe('기간 기록은 최대 92일까지 쓸 수 있습니다.');
    expect(periodError('', '2026-09-25', 92)).toBe('시작일을 확인해 주세요.');
    expect(periodError('2026-09-21', '', 92)).toBe('종료일을 확인해 주세요.');
  });
});

describe('다이어리 계산', () => {
  it('기본 타이틀은 서버와 같은 형식', () => {
    expect(diaryDefaultTitle('2026-09-25')).toBe('2026년 9월 25일 (금)');
    expect(diaryDefaultTitle('2026-10-04')).toBe('2026년 10월 4일 (일)');
  });

  it('주는 월~일 7일 (일요일은 앞 주 월요일부터)', () => {
    expect(weekDays('2026-09-25')).toEqual(['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27']);
    expect(weekDays('2026-09-27')[0]).toBe('2026-09-21');
    expect(weekDays('2026-09-21')[6]).toBe('2026-09-27');
    expect(weekDays('2026-10-01')).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  });

  it('주 제목: 같은 달 / 달이 바뀜 / 해가 바뀜', () => {
    expect(diaryWeekLabel('2026-09-21')).toBe('2026년 9월 21일 ~ 27일');
    expect(diaryWeekLabel('2026-09-28')).toBe('2026년 9월 28일 ~ 10월 4일');
    expect(diaryWeekLabel('2026-12-28')).toBe('2026년 12월 28일 ~ 2027년 1월 3일');
  });
});

describe('검색 기간', () => {
  const today = '2026-09-25';
  it('빠른 선택 기간', () => {
    expect(periodRange('ALL', today)).toEqual({ from: '', to: '' });
    expect(periodRange('THIS_MONTH', today)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(periodRange('LAST_MONTH', today)).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(periodRange('LAST_3_MONTHS', today)).toEqual({ from: '2026-06-25', to: '2026-09-25' });
    expect(periodRange('THIS_YEAR', today)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(periodRange('CUSTOM', today, { from: '2026-09-10', to: '' })).toEqual({ from: '2026-09-10', to: '' });
  });

  it('경계: 1월의 지난 달, 윤년 2월, 없는 날은 그달 말일', () => {
    expect(periodRange('LAST_MONTH', '2027-01-15')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(periodRange('LAST_MONTH', '2028-03-31')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(periodRange('LAST_3_MONTHS', '2026-05-31').from).toBe('2026-02-28');
    expect(periodRange('LAST_3_MONTHS', '2028-05-31').from).toBe('2028-02-29');
    expect(periodRange('LAST_3_MONTHS', '2027-02-15').from).toBe('2026-11-15');
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('입력 검사와 표시 문구', () => {
    expect(searchPeriodError({ from: '', to: '' })).toBe('');
    expect(searchPeriodError({ from: '2026-09-01', to: '' })).toBe('');
    expect(searchPeriodError({ from: '2026-09-30', to: '2026-09-01' })).toBe('검색 종료일이 시작일보다 앞설 수 없습니다.');
    expect(searchPeriodError({ from: '2026-02-30', to: '' })).toBe('검색 시작일을 확인해 주세요.');
    expect(periodText({ from: '', to: '' })).toBe('');
    expect(periodText({ from: '2026-09-01', to: '2026-09-30' })).toBe('2026-09-01 ~ 2026-09-30');
    expect(periodText({ from: '2026-09-01', to: '' })).toBe('2026-09-01 ~ 끝');
    expect(periodText({ from: '', to: '2026-09-30' })).toBe('처음 ~ 2026-09-30');
  });
});
