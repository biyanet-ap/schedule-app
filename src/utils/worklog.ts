/**
 * 작업기록의 하루/기간 계산. endDate가 ''이면 하루 기록, 날짜면 기간 기록(workDate = 시작일).
 * 서버 규칙(gas/42_WorklogService.js resolveWorklogEndDate_)과 같은 기준으로 검사한다.
 */
import type { Worklog } from '../api/types';
import { msgs } from '../i18n';
import { addDays, daysBetween, formatShortDate, inRange, isYmd, mondayOf } from './date';

type Dated = Pick<Worklog, 'workDate' | 'endDate'>;

/** endDate가 비었거나 없으면(이전 버전 서버 응답) 하루 기록 */
export function isPeriodLog(w: Pick<Worklog, 'endDate'>): boolean {
  return !!w.endDate;
}

/** 기록이 걸친 날짜 (양끝 포함) */
export function worklogSpan(w: Dated): { start: string; end: string } {
  return { start: w.workDate, end: w.endDate || w.workDate };
}

export function worklogOccursOn(w: Dated, ymd: string): boolean {
  const span = worklogSpan(w);
  return inRange(ymd, span.start, span.end);
}

/** 기간 일수 (양끝 포함) */
export function periodDays(start: string, end: string): number {
  return daysBetween(start, end) + 1;
}

/** '9/21~9/25 · 5일' / '9/21〜9/25・5日間' */
export function periodLabel(w: Dated): string {
  const { start, end } = worklogSpan(w);
  const m = msgs();
  return `${formatShortDate(start)}${m.date.timeSep}${formatShortDate(end)}${m.common.sep}${m.worklog.daysShort(periodDays(start, end))}`;
}

/** 기준일이 속한 주(월요일 시작)에서 offsetWeeks만큼 옮긴 주의 월~금 */
export function weekRange(base: string, offsetWeeks: number): { start: string; end: string } {
  const monday = addDays(mondayOf(base), offsetWeeks * 7);
  return { start: monday, end: addDays(monday, 4) };
}

/** 기준일이 속한 달의 1일~말일 (utils/date.ts로 옮김, 기존 import 호환용) */
export { monthRange } from './date';

/**
 * 기간 탭 기본값.
 * - 연결 일정이 여러 날에 걸쳐 있고 day를 포함하며 최대 일수 안이면 그 일정 기간
 * - 아니면 day가 속한 주의 월~금. day가 주말이면 종료일을 day까지 늘린다 (기록할 날이 빠지지 않게)
 */
export function defaultPeriod(day: string, scheduleSpan: { start: string; end: string } | null, maxDays: number): { start: string; end: string } {
  if (scheduleSpan && scheduleSpan.end > scheduleSpan.start && inRange(day, scheduleSpan.start, scheduleSpan.end)
    && periodDays(scheduleSpan.start, scheduleSpan.end) <= maxDays) {
    return { start: scheduleSpan.start, end: scheduleSpan.end };
  }
  const week = weekRange(day, 0);
  return { start: week.start, end: day > week.end ? day : week.end };
}

/** 기간 입력 검사. 문제가 없으면 '' */
export function periodError(start: string, end: string, maxDays: number): string {
  const t = msgs().worklog;
  if (!isYmd(start)) return t.checkStart;
  if (!isYmd(end)) return t.checkEnd;
  if (end <= start) return t.periodOrder;
  if (periodDays(start, end) > maxDays) return t.periodMax(maxDays);
  return '';
}
