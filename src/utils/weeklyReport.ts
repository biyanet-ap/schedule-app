/**
 * 주간 업무 보고 글 만들기 (순수 함수). 설계: docs/design/weekly-report.md
 * 주는 월~금. 데이터는 apiGetRange(그 주 월요일 ~ 다음 주 금요일) 결과를 그대로 받는다.
 */
import type { Project, RangeData, Schedule, Worklog } from '../api/types';
import { msgs } from '../i18n';
import { addDays, dateSpan, formatDateRange, formatShortDate, scheduleDateText } from './date';
import { worklogSpan } from './worklog';

export interface WeeklyReportCounts {
  done: number;
  inProgress: number;
  overdue: number;
  nextWeek: number;
}

export interface WeeklyReport {
  /** 보고 주 월요일 */
  weekStart: string;
  text: string;
  counts: WeeklyReportCounts;
}

interface Item {
  projectId: string;
  /** 묶음 안 정렬 키 (날짜·시각) */
  sortKey: string;
  createdAt: string;
  label: string;
}

function overlaps(span: { start: string; end: string }, from: string, to: string): boolean {
  return span.start <= to && span.end >= from;
}

/** '2026년 9월 21일 (월) ~ 25일 (금)' — 달·해가 바뀌면 뒤쪽에 달·해도 붙인다 (화면 언어) */
export function reportWeekLabel(monday: string): string {
  return formatDateRange(monday, addDays(monday, 4), true);
}

/** 일정 뒤에 붙는 날짜: (9/22 화) / (10/2 금 10:00) / (9/26 ~ 9/28) / (9/24 22:00 ~ 9/25 02:00). 일본어는 '（9/22(火)）' */
export function scheduleWhen(s: Schedule): string {
  return msgs().weeklyText.when(scheduleDateText(s));
}

function worklogItem(w: Worklog): Item {
  return { projectId: w.projectId, sortKey: w.workDate, createdAt: w.createdAt, label: w.title };
}

function scheduleItem(s: Schedule): Item {
  return { projectId: s.projectId, sortKey: s.startAt, createdAt: s.createdAt, label: msgs().weeklyText.item(s.title, scheduleWhen(s)) };
}

/** 프로젝트 정렬 순서대로 묶고, 프로젝트가 없거나 모르는 항목은 맨 뒤 [기타] */
function groupLines(items: Item[], projects: Project[]): string[] {
  const t = msgs().weeklyText;
  if (!items.length) return [`- ${t.none}`];
  const order = [...projects].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const known = new Set(order.map((p) => p.id));
  const byItem = (a: Item, b: Item) => a.sortKey.localeCompare(b.sortKey) || a.createdAt.localeCompare(b.createdAt);
  const lines: string[] = [];
  const push = (label: string, group: Item[]) => {
    if (!group.length) return;
    lines.push(`[${label}]`, ...group.sort(byItem).map((i) => `- ${i.label}`));
  };
  for (const p of order) push(p.name, items.filter((i) => i.projectId === p.id));
  push(t.noProject, items.filter((i) => !i.projectId || !known.has(i.projectId)));
  return lines;
}

/**
 * 월~금 주의 보고 글.
 * - 완료·진행 중: 작업기록(하루·기간)이 그 주와 겹치면
 * - 미완료 일정: 작업 일정 중 '예정'이고 종료일이 그 주 안이면서 오늘 이전 또는 오늘 (회의·취소 제외)
 * - 다음 주 예정: 다음 주 월~금과 겹치는 앱 일정(작업·회의) 중 '예정'
 * @param today 'YYYY-MM-DD' (JST) — 미완료 판정 기준
 */
export function buildWeeklyReport(
  data: Pick<RangeData, 'worklogs' | 'schedules'>,
  projects: Project[],
  weekStart: string,
  today: string,
): WeeklyReport {
  const friday = addDays(weekStart, 4);
  const nextMonday = addDays(weekStart, 7);
  const nextFriday = addDays(weekStart, 11);

  const weekLogs = data.worklogs.filter((w) => overlaps(worklogSpan(w), weekStart, friday));
  const done = weekLogs.filter((w) => w.status === 'DONE').map(worklogItem);
  const inProgress = weekLogs.filter((w) => w.status !== 'DONE').map(worklogItem);

  const overdue = data.schedules
    .filter((s) => {
      if (s.type !== 'TASK' || s.status !== 'PLANNED') return false;
      const end = dateSpan(s).end;
      return end >= weekStart && end <= friday && end <= today;
    })
    .map(scheduleItem);

  const nextWeek = data.schedules
    .filter((s) => s.status === 'PLANNED' && overlaps(dateSpan(s), nextMonday, nextFriday))
    .map(scheduleItem);

  const t = msgs().weeklyText;
  const sep = msgs().date.rangeSep;
  const section = (title: string, items: Item[]) => [t.section(title, items.length), ...groupLines(items, projects)];
  const text = [
    t.heading(reportWeekLabel(weekStart)),
    '',
    ...section(t.done, done),
    '',
    ...section(t.inProgress, inProgress),
    '',
    ...section(t.overdue, overdue),
    '',
    ...section(t.nextWeek(`${formatShortDate(nextMonday)}${sep}${formatShortDate(nextFriday)}`), nextWeek),
  ].join('\n');

  return {
    weekStart,
    text,
    counts: { done: done.length, inProgress: inProgress.length, overdue: overdue.length, nextWeek: nextWeek.length },
  };
}
