/**
 * 휴지통 목록 (v1.11). 설계: docs/design/trash-restore.md
 * 서버가 종류별로 준 삭제 항목을 한 목록(최근 삭제 순)으로 합치고, 줄마다 보여 줄 문구를 만든다 (순수 함수).
 */
import type { Diary, Schedule, TrashData, TrashKind, Worklog } from '../api/types';
import { dateSpan, formatShortDate, scheduleDateText, weekdayOf } from './date';
import { msgs } from '../i18n';

/** 종류 이름: '일정' / '작업기록' / '다이어리' (화면 언어) */
export function trashKindLabel(kind: TrashKind): string {
  return msgs().trash.kinds[kind];
}

export interface TrashEntry {
  kind: TrashKind;
  /** 목록 키 (종류가 달라도 겹치지 않게) */
  key: string;
  id: string;
  title: string;
  /** 날짜 문구: 일정 '9/22 화 13:00', 작업기록 '9/24' 또는 '9/21~9/25', 다이어리 '9/24 (목)' (화면 언어, 불러올 때 만든다) */
  when: string;
  /** '보러 가기'로 이동할 날짜 */
  goDate: string;
  /** 다이어리는 '' */
  projectId: string;
  /** 삭제 시각 (= 서버 updatedAt) */
  deletedAt: string;
  /** 복구 잠금 값 (= 삭제 시각) */
  updatedAt: string;
}

/** 작업기록 날짜 문구: '9/24' / '9/21~9/25' (오늘 요약과 같은 모양, 일본어는 '〜') */
export function worklogDateText(w: Pick<Worklog, 'workDate' | 'endDate'>): string {
  return w.endDate ? `${formatShortDate(w.workDate)}${msgs().date.timeSep}${formatShortDate(w.endDate)}` : formatShortDate(w.workDate);
}

/** 서버 시각('2026-09-25T14:03:10.123+09:00', 항상 JST 표기) → '9/25 14:03'. 형식이 아니면 '' */
export function deletedAtLabel(stamp: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(stamp);
  return m ? `${Number(m[1])}/${Number(m[2])} ${m[3]}:${m[4]}` : '';
}

function fromSchedule(s: Schedule): TrashEntry {
  return {
    kind: 'SCHEDULE', key: 'S:' + s.id, id: s.id, title: s.title, when: scheduleDateText(s),
    goDate: dateSpan(s).start, projectId: s.projectId, deletedAt: s.updatedAt, updatedAt: s.updatedAt,
  };
}

function fromWorklog(w: Worklog): TrashEntry {
  return {
    kind: 'WORKLOG', key: 'W:' + w.id, id: w.id, title: w.title, when: worklogDateText(w),
    goDate: w.workDate, projectId: w.projectId, deletedAt: w.updatedAt, updatedAt: w.updatedAt,
  };
}

function fromDiary(d: Diary): TrashEntry {
  return {
    kind: 'DIARY', key: 'D:' + d.id, id: d.id, title: d.title, when: msgs().date.withWd(formatShortDate(d.diaryDate), weekdayOf(d.diaryDate)),
    goDate: d.diaryDate, projectId: '', deletedAt: d.updatedAt, updatedAt: d.updatedAt,
  };
}

/**
 * 세 목록을 합쳐 최근 삭제 순으로 (같은 시각이면 일정·작업기록·다이어리 순).
 * 서버(compareDesc_)와 같게 코드 포인트로 비교한다 — localeCompare는 '…:30+09:00'과 '…:30.250+09:00'의 순서가 다르다.
 */
export function mergeTrash(data: Pick<TrashData, 'schedules' | 'worklogs' | 'diaries'>): TrashEntry[] {
  return [
    ...data.schedules.map(fromSchedule),
    ...data.worklogs.map(fromWorklog),
    ...data.diaries.map(fromDiary),
  ].sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : a.deletedAt > b.deletedAt ? -1 : 0));
}

/** 종류별 건수 (필터 버튼용) */
export function countByKind(entries: TrashEntry[]): Record<'ALL' | TrashKind, number> {
  const c = { ALL: entries.length, SCHEDULE: 0, WORKLOG: 0, DIARY: 0 };
  for (const e of entries) c[e.kind]++;
  return c;
}
