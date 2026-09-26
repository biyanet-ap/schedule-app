import type { EventInput } from '@fullcalendar/vue3';
import type { CalendarEvent, Holiday, Project, Schedule, Worklog } from '../api/types';
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

/** 종일 일정의 FullCalendar 종료일은 "다음날(미포함)"이다. */
function allDayEnd(inclusiveEndAt: string): string {
  return addDays(datePart(inclusiveEndAt), 1);
}

function scheduleTitle(s: Schedule): string {
  const marks = (s.status === 'DONE' ? '✓ ' : '') + (s.priority === 'HIGH' && s.status !== 'DONE' ? '! ' : '');
  return marks + s.title;
}

export function toEventInputs(
  data: { schedules: Schedule[]; worklogs: Worklog[]; calendarEvents: CalendarEvent[]; holidays: Holiday[] },
  projects: Project[],
  filter: EventFilter,
): EventInput[] {
  const projectColor = new Map(projects.map((p) => [p.id, p.color]));
  const byProject = (projectId: string) => !filter.projectId || projectId === filter.projectId;
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
    if (s.status === 'CANCELLED' || !byProject(s.projectId)) continue;
    const color = s.type === 'MEETING' ? COLORS.meeting : projectColor.get(s.projectId) ?? COLORS.task;
    events.push({
      id: `s:${s.id}`,
      title: scheduleTitle(s),
      start: s.allDay ? datePart(s.startAt) : s.startAt,
      end: s.allDay ? allDayEnd(s.endAt) : s.endAt,
      allDay: s.allDay,
      color,
      className: s.status === 'DONE' ? 'ev-done' : '',
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
    if (!byProject(w.projectId)) continue;
    events.push({
      id: `w:${w.id}`,
      title: `${w.status === 'DONE' ? '✓' : '✎'} ${w.title}`,
      className: w.status === 'DONE' ? 'ev-done' : '',
      start: w.workDate,
      // 기간 기록은 종료일까지 이어진 막대 (FullCalendar 종일 end는 다음날, 미포함)
      ...(w.endDate ? { end: allDayEnd(w.endDate) } : {}),
      allDay: true,
      color: COLORS.worklog,
      extendedProps: { kind: 'worklog', refId: w.id, order: 4 } satisfies EventMeta,
    });
  }

  return events;
}

/** http/https 링크만 허용 (javascript: 등 차단) */
export function safeHttpUrl(value: string): string | null {
  const s = value.trim();
  return /^https?:\/\/[^\s]+$/i.test(s) ? s : null;
}
