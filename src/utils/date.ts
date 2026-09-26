/**
 * 날짜 유틸. 앱 전체에서 날짜는 JST 문자열('YYYY-MM-DD', 'YYYY-MM-DDTHH:mm')로만 다룬다.
 * 브라우저 시간대와 무관하게 동작하도록 계산은 UTC 기준으로 한다.
 * 표기(요일·'9월 24일 (목)'·'종일')는 화면 언어를 따른다 (v1.13, src/i18n).
 */
import { msgs } from '../i18n';

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function toUtc(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function isYmd(s: string): boolean {
  if (!YMD_RE.test(s)) return false;
  return fromUtc(toUtc(s)) === s;
}

export function addDays(ymd: string, days: number): string {
  const d = toUtc(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

/** from에서 to까지 며칠 뒤인지 ('2026-09-21' → '2026-09-25' = 4) */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);
}

/** 기준일이 속한 달의 1일~말일 */
export function monthRange(base: string): { start: string; end: string } {
  const [y, m] = base.split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const nextFirst = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { start, end: addDays(nextFirst, -1) };
}

/** n개월 뒤(음수면 앞) 같은 날. 그런 날이 없으면 그달 말일 (5/31 - 3개월 → 2/28) */
export function addMonthsClamped(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const index = y * 12 + (m - 1) + n;
  const ty = Math.floor(index / 12);
  const tm = (index % 12) + 1;
  const first = `${ty}-${String(tm).padStart(2, '0')}-01`;
  const lastDay = Number(monthRange(first).end.slice(8, 10));
  return `${first.slice(0, 8)}${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

/** 그 날짜가 속한 주(월요일 시작)의 월요일 */
export function mondayOf(ymd: string): string {
  const dow = toUtc(ymd).getUTCDay(); // 0=일
  return addDays(ymd, dow === 0 ? -6 : 1 - dow);
}

/** 요일 한 글자 ('목' / '木') */
export function weekdayOf(ymd: string): string {
  return msgs().date.weekdays[toUtc(ymd).getUTCDay()];
}

export function dayOfWeek(ymd: string): number {
  return toUtc(ymd).getUTCDay();
}

/** '2026-09-24' → '9월 24일 (목)' / '9月24日(木)' */
export function formatDateLabel(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number);
  const t = msgs().date;
  return t.withWd(t.md(m, d), weekdayOf(ymd));
}

/**
 * 날짜 범위 글: '2026년 9월 21일 ~ 27일', 달이 바뀌면 '… ~ 10월 4일', 해가 바뀌면 '… ~ 2027년 1월 3일'.
 * withWeekday면 양쪽에 요일: '2026년 9월 21일 (월) ~ 25일 (금)' / '2026年9月21日(月)〜25日(金)'
 */
export function formatDateRange(start: string, end: string, withWeekday = false): string {
  const t = msgs().date;
  const [y1, m1, d1] = start.split('-').map(Number);
  const [y2, m2, d2] = end.split('-').map(Number);
  const tail = y1 !== y2 ? t.ymd(y2, m2, d2) : m1 !== m2 ? t.md(m2, d2) : t.dayOnly(d2);
  const head = t.ymd(y1, m1, d1);
  return withWeekday
    ? t.withWd(head, weekdayOf(start)) + t.rangeSep + t.withWd(tail, weekdayOf(end))
    : head + t.rangeSep + tail;
}

/** '2026-09-24' → '9/24' */
export function formatShortDate(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number);
  return `${m}/${d}`;
}

export function datePart(dateTime: string): string {
  return dateTime.slice(0, 10);
}

export function timePart(dateTime: string): string {
  return dateTime.length >= 16 ? dateTime.slice(11, 16) : '00:00';
}

/** 'YYYY-MM-DD'를 포함하는지 (양끝 포함) */
export function inRange(ymd: string, from: string, to: string): boolean {
  return ymd >= from && ymd <= to;
}

interface TimedItem {
  startAt: string;
  endAt: string;
  allDay: boolean;
}

/** 일정이 걸친 날짜(양끝 포함). 시각 일정이 다음날 00:00에 끝나면 전날까지로 본다. (서버 scheduleDateSpan_와 동일 규칙) */
export function dateSpan(item: TimedItem): { start: string; end: string } {
  const start = datePart(item.startAt);
  let end = datePart(item.endAt || item.startAt);
  if (!item.allDay && item.endAt.endsWith('T00:00') && end > start) end = addDays(end, -1);
  if (end < start) end = start;
  return { start, end };
}

export function occursOn(item: TimedItem, ymd: string): boolean {
  const span = dateSpan(item);
  return span.start <= ymd && span.end >= ymd;
}

/**
 * 일정 날짜 문구 (주간 보고·휴지통 공용): '9/22 화' / '10/2 금 10:00' / '9/26 ~ 9/28' / '9/24 22:00 ~ 9/25 02:00'
 */
export function scheduleDateText(item: TimedItem): string {
  const t = msgs().date;
  const span = dateSpan(item);
  if (item.allDay) {
    return span.start === span.end
      ? t.shortWd(formatShortDate(span.start), weekdayOf(span.start))
      : `${formatShortDate(span.start)}${t.rangeSep}${formatShortDate(span.end)}`;
  }
  const startDate = datePart(item.startAt);
  if (span.start === span.end) return `${t.shortWd(formatShortDate(startDate), weekdayOf(startDate))} ${timePart(item.startAt)}`;
  return `${formatShortDate(startDate)} ${timePart(item.startAt)}${t.rangeSep}${formatShortDate(datePart(item.endAt))} ${timePart(item.endAt)}`;
}

/** 목록에 보여줄 시간 문구 */
export function timeLabel(item: TimedItem, onDate?: string): string {
  const sep = msgs().date.timeSep;
  const span = dateSpan(item);
  if (item.allDay) {
    const allDay = msgs().date.allDay;
    return span.start === span.end ? allDay : `${allDay} ${formatShortDate(span.start)}${sep}${formatShortDate(span.end)}`;
  }
  const s = datePart(item.startAt);
  const e = datePart(item.endAt);
  if (s === e) return `${timePart(item.startAt)}${sep}${timePart(item.endAt)}`;
  if (onDate && onDate !== s) {
    return `${formatShortDate(s)} ${timePart(item.startAt)}${sep}${formatShortDate(e)} ${timePart(item.endAt)}`;
  }
  return `${timePart(item.startAt)}${sep}${formatShortDate(e)} ${timePart(item.endAt)}`;
}

const JST_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });

/** 브라우저 시계 기준 JST 오늘 (탭을 자정 넘어 열어 둔 경우 갱신용) */
export function jstToday(now: Date = new Date()): string {
  return JST_DATE.format(now);
}

/** 새 일정 기본 시각: 지금 이후 가장 가까운 정시 (오늘이 아니면 09:00) */
export function defaultStartTime(date: string, today: string, now: Date = new Date()): string {
  if (date !== today) return '09:00';
  const jstHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', hour: 'numeric', hourCycle: 'h23' }).format(now));
  const next = Math.min(jstHour + 1, 23);
  return `${String(next).padStart(2, '0')}:00`;
}

export function addMinutesToTime(time: string, minutes: number): { time: string; dayOffset: number } {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const dayOffset = Math.floor(total / 1440);
  const within = ((total % 1440) + 1440) % 1440;
  return { time: `${String(Math.floor(within / 60)).padStart(2, '0')}:${String(within % 60).padStart(2, '0')}`, dayOffset };
}
