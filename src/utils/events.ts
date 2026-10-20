import type { EventInput } from '@fullcalendar/vue3';
import type { CalendarEvent, Holiday, Project, Schedule, Worklog } from '../api/types';
import { doneTextColor, isHexColor, safeColor, solidTextColor, tintColors } from './color';
import { addDays, datePart } from './date';

export const COLORS = {
  task: '#2563eb',
  meeting: '#7c3aed',
  worklog: '#15803d',
  gcal: '#64748b',
  holidayBg: '#fee2e2',
  holidayText: '#b91c1c',
} as const;

export type EventKind = 'schedule' | 'worklog' | 'gcal' | 'holiday';

export interface EventMeta {
  kind: EventKind;
  refId: string;
  /** 같은 날 안에서의 표시 순서 (작을수록 위) */
  order: number;
}

export interface EventFilter {
  projectId: string;
  showGcal: boolean;
}

/** 화면 상태 (v1.17): 다크 모드면 연한 배경의 글자색이 달라지고, 휴대폰 목록 보기는 연한 배경 없이 점만 쓴다 */
export interface EventView {
  dark: boolean;
  list: boolean;
}

/** 일정 색: 프로젝트 색, 프로젝트가 없거나 색이 '#RRGGBB'가 아니면 작업은 파랑·회의는 보라 (v1.17: 회의도 프로젝트 색) */
export function scheduleColor(s: Pick<Schedule, 'type'>, project: Pick<Project, 'color'> | undefined): string {
  return safeColor(project?.color, s.type === 'MEETING' ? COLORS.meeting : COLORS.task);
}

/** 작업기록 색: 프로젝트 색, 없으면 초록 (v1.17) */
export function worklogColor(project: Pick<Project, 'color'> | undefined): string {
  return safeColor(project?.color, COLORS.worklog);
}

/** 종일 일정의 FullCalendar 종료일은 "다음날(미포함)"이다. */
function allDayEnd(inclusiveEndAt: string): string {
  return addDays(datePart(inclusiveEndAt), 1);
}

/** 달력에 보이는 일정: 취소 제외, 프로젝트 필터 반영 (달력과 범례가 같은 규칙을 쓴다) */
function isScheduleShown(s: Schedule, filter: Pick<EventFilter, 'projectId'>): boolean {
  return s.status !== 'CANCELLED' && (!filter.projectId || s.projectId === filter.projectId);
}

/** 달력에 보이는 작업기록: 프로젝트 필터 반영 */
function isWorklogShown(w: Worklog, filter: Pick<EventFilter, 'projectId'>): boolean {
  return !filter.projectId || w.projectId === filter.projectId;
}

function scheduleTitle(s: Schedule): string {
  const marks = (s.status === 'DONE' ? '✓ ' : '') + (s.priority === 'HIGH' && s.status !== 'DONE' ? '! ' : '');
  return marks + s.title;
}

export function toEventInputs(
  data: { schedules: Schedule[]; worklogs: Worklog[]; calendarEvents: CalendarEvent[]; holidays: Holiday[] },
  projects: Project[],
  filter: EventFilter,
  view: EventView = { dark: false, list: false },
): EventInput[] {
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const events: EventInput[] = [];

  for (const h of data.holidays) {
    events.push({
      id: `h:${h.date}`,
      title: h.name,
      start: h.date,
      allDay: true,
      color: COLORS.holidayBg,
      contrastColor: COLORS.holidayText,
      interactive: false,
      extendedProps: { kind: 'holiday', refId: h.date, order: 0 } satisfies EventMeta,
    });
  }

  for (const s of data.schedules) {
    if (!isScheduleShown(s, filter)) continue;
    const color = scheduleColor(s, projectById.get(s.projectId));
    const done = s.status === 'DONE';
    events.push({
      id: `s:${s.id}`,
      title: scheduleTitle(s),
      start: s.allDay ? datePart(s.startAt) : s.startAt,
      end: s.allDay ? allDayEnd(s.endAt) : s.endAt,
      allDay: s.allDay,
      color,
      // 완료는 연한 배경(.ev-faded) + 검정 글자(다크는 흰색) — 막대 전체를 흐리게 하지 않는다 (v1.18)
      contrastColor: done ? doneTextColor(view.dark) : solidTextColor(color),
      // 시간 있는 하루 일정도 점이 아닌 색 막대로 (dayGrid 전용 설정, 목록 보기에는 영향 없음)
      display: 'block',
      // 휴대폰 목록 보기는 배경 없이 점 + 글자라서 완료 줄을 지금처럼 흐리게(ev-done)
      className: done ? (view.list ? 'ev-done' : 'ev-faded') : '',
      extendedProps: { kind: 'schedule', refId: s.id, order: s.priority === 'HIGH' ? 1 : 2 } satisfies EventMeta,
    });
  }

  if (filter.showGcal && !filter.projectId) {
    for (const c of data.calendarEvents) {
      events.push({
        id: `c:${c.id}`,
        title: c.title,
        start: c.allDay ? datePart(c.startAt) : c.startAt,
        end: c.allDay ? allDayEnd(c.endAt) : c.endAt,
        allDay: c.allDay,
        color: COLORS.gcal,
        extendedProps: { kind: 'gcal', refId: c.id, order: 3 } satisfies EventMeta,
      });
    }
  }

  for (const w of data.worklogs) {
    if (!isWorklogShown(w, filter)) continue;
    // color(테두리·목록 점)는 프로젝트 색 그대로, 막대 배경은 CSS .ev-tint가 연하게 칠한다 (PC 달력만)
    const color = worklogColor(projectById.get(w.projectId));
    const done = w.status === 'DONE';
    events.push({
      id: `w:${w.id}`,
      title: `${done ? '✓' : '✎'} ${w.title}`,
      // PC 달력: 완료도 같은 연한 막대에 글자만 검정 (v1.18). 휴대폰 목록 보기: 완료 줄만 흐리게
      className: view.list ? (done ? 'ev-done' : '') : 'ev-tint',
      start: w.workDate,
      // 기간 기록은 종료일까지 이어진 막대 (FullCalendar 종일 end는 다음날, 미포함)
      ...(w.endDate ? { end: allDayEnd(w.endDate) } : {}),
      allDay: true,
      color,
      contrastColor: done ? doneTextColor(view.dark) : tintColors(color, view.dark).text,
      extendedProps: { kind: 'worklog', refId: w.id, order: 4 } satisfies EventMeta,
    });
  }

  return events;
}

export interface LegendProject {
  id: string;
  name: string;
  color: string;
}

/**
 * 범례에 보일 프로젝트 (v1.17): 달력에 보이는 일정·작업기록(isScheduleShown·isWorklogShown)에 쓰인 프로젝트만,
 * 프로젝트 목록 순서(정렬 순서) 그대로. 화면의 색과 범례가 늘 맞게 한다.
 * 색이 '#RRGGBB'가 아닌 프로젝트는 막대가 종류별 기본색으로 그려져 한 색으로 설명할 수 없으므로 뺀다.
 */
export function legendProjects(
  data: { schedules: Schedule[]; worklogs: Worklog[] },
  projects: Project[],
  filter: Pick<EventFilter, 'projectId'>,
): LegendProject[] {
  const used = new Set<string>();
  for (const s of data.schedules) if (isScheduleShown(s, filter)) used.add(s.projectId);
  for (const w of data.worklogs) if (isWorklogShown(w, filter)) used.add(w.projectId);
  return projects
    .filter((p) => used.has(p.id) && isHexColor(p.color))
    .map((p) => ({ id: p.id, name: p.name, color: p.color }));
}

/** http/https 링크만 허용 (javascript: 등 차단) */
export function safeHttpUrl(value: string): string | null {
  const s = value.trim();
  return /^https?:\/\/[^\s]+$/i.test(s) ? s : null;
}
