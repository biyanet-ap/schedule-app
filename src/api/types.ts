/** 서버(gas/60_Api.js)와 주고받는 데이터 형태. 날짜는 모두 JST 문자열이다. */
import type { Lang, LangSetting } from '../i18n';

export type ScheduleType = 'TASK' | 'MEETING';
export type Priority = 'HIGH' | 'MEDIUM' | 'LOW';
export type ScheduleStatus = 'PLANNED' | 'DONE' | 'CANCELLED';
export type WorklogStatus = 'IN_PROGRESS' | 'DONE';

export interface Project {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  active: boolean;
  updatedAt: string;
}

export interface Schedule {
  id: string;
  type: ScheduleType;
  title: string;
  description: string;
  /** 'YYYY-MM-DDTHH:mm'. 종일이면 시각은 00:00 */
  startAt: string;
  /** 'YYYY-MM-DDTHH:mm'. 종일이면 포함되는 마지막 날 */
  endAt: string;
  allDay: boolean;
  priority: Priority;
  projectId: string;
  location: string;
  status: ScheduleStatus;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Worklog {
  id: string;
  /** 하루 기록의 작업일 / 기간 기록의 시작일 */
  workDate: string;
  /** 기간 기록의 종료일. '' = 하루 기록 */
  endDate: string;
  title: string;
  content: string;
  projectId: string;
  scheduleId: string;
  tags: string[];
  status: WorklogStatus;
  createdAt: string;
  updatedAt: string;
}

/** 다이어리 (날짜당 최대 1편) */
export interface Diary {
  id: string;
  diaryDate: string;
  /** 비어 있으면 서버가 'YYYY년 M월 D일 (요일)'로 채운다 */
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface DiaryInput {
  id?: string;
  updatedAt?: string;
  diaryDate: string;
  title: string;
  content: string;
}

export interface DiarySearchResult {
  diaries: Diary[];
  truncated: boolean;
}

export interface CalendarEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  location: string;
}

export interface Holiday {
  date: string;
  name: string;
}

export interface Bootstrap {
  today: string;
  projects: Project[];
  /** todayPopup은 v1.12부터 (이전 버전 서버 응답에는 없음 → 켜짐으로 본다), language는 v1.13부터 (없으면 자동) */
  settings: { notifyEnabled: boolean; skipHolidays: boolean; todayPopup?: boolean; language?: LangSetting };
  limits: {
    title: number;
    description: number;
    content: number;
    location: number;
    tagCount: number;
    tagLength: number;
    projectName: number;
    keyword: number;
    rangeDays: number;
    /** 기간 기록 최대 일수 (양끝 포함) */
    worklogPeriodDays: number;
  };
}

export interface RangeData {
  from: string;
  to: string;
  schedules: Schedule[];
  worklogs: Worklog[];
  /** 날짜 패널용 (이전 버전 서버 응답에 없으면 store.loadRange가 []로 채운다) */
  diaries: Diary[];
  calendarEvents: CalendarEvent[];
  calendarError: string | null;
  holidays: Holiday[];
  holidayCalendarAvailable: boolean;
}

export type DigestSchedule = Schedule & { projectName: string; timeLabel: string };
export type DigestMeeting = CalendarEvent & { timeLabel: string };
/** 진행 중 작업기록 (v1.10). dateLabel: '9/24' 또는 기간 기록 '9/21~9/25' */
export type DigestWorklog = Worklog & { projectName: string; dateLabel: string };

export interface TodayDigest {
  date: string;
  weekday: string;
  holidayName: string | null;
  schedules: DigestSchedule[];
  meetings: DigestMeeting[];
  calendarError: string | null;
  overdue: DigestSchedule[];
  overdueTotal: number;
  /** 진행 중 작업기록, 오래된 순 최대 10건 (이전 버전 서버 응답에는 없음) */
  inProgress?: DigestWorklog[];
  inProgressTotal?: number;
}

/** 휴지통 (v1.11) 항목 종류 */
export type TrashKind = 'SCHEDULE' | 'WORKLOG' | 'DIARY';

/**
 * 휴지통 목록 (apiGetTrash). 각 항목의 updatedAt = 삭제 시각 (복구할 때 잠금 값으로 그대로 보낸다).
 * 응답을 가볍게 하려고 본문(일정 description, 작업기록·다이어리 content)은 비어 있다. 복구 응답은 전체 DTO.
 */
export interface TrashData {
  /** 최근 며칠 안에 지운 것인지 (오늘 포함) */
  days: number;
  schedules: Schedule[];
  worklogs: Worklog[];
  diaries: Diary[];
  /** 최대 건수를 넘기기 전 전체 건수 */
  total: number;
  truncated: boolean;
}

/** 삭제 응답. updatedAt(삭제 시각)은 v1.11부터 — 이전 버전 서버 응답에는 없다 */
export interface DeleteResult {
  id: string;
  updatedAt?: string;
}

/** 복구 요청: updatedAt = 삭제 시각 */
export interface RestoreInput {
  id: string;
  updatedAt: string;
}

/** 설정 화면 (v1.12) */
export interface AppSettings {
  notifyEnabled: boolean;
  skipHolidays: boolean;
  notifyWhenEmpty: boolean;
  /** 오늘 요약 팝업 자동 표시 (모든 기기 공통) */
  todayPopup: boolean;
  /** 아침 메일 발송 시각 (그 시각 ~ 1시간 사이) */
  digestHour: number;
  backupKeep: number;
  /** 화면 언어 (v1.13): auto(브라우저 언어) | ko | ja. 모든 기기 공통, 메일 언어도 따른다 */
  language: LangSetting;
}

/** notify_log 한 줄. detail은 공휴일 이름·오류 문구만 (그 밖에는 '') */
export interface NotifyLogRow {
  loggedAt: string;
  kind: string;
  targetDate: string;
  result: string;
  detail: string;
}

export interface SettingsView {
  settings: AppSettings;
  /** 설정 잠금 값 ('' = 앱에서 저장한 적 없음) */
  updatedAt: string;
  digestHours: number[];
  /** 서버 한도 (백업 보관 최대 개수, 테스트 메일 하루 횟수) */
  limits: { backupKeepMax: number; testMailPerDay: number };
  /** 걸려 있는 예약 개수 (정상 = 1) */
  triggers: { digest: number; backup: number };
  /** 최신 순 최대 10건 */
  recentLog: NotifyLogRow[];
  /** 저장 응답에만: 발송 시각이 바뀌어 예약을 다시 걸었는지 */
  digestTriggerReplaced?: boolean;
}

/** browserLang: 이 브라우저의 언어 (언어가 '자동'일 때 메일 언어를 정하는 데 쓴다, v1.13) */
export type SettingsInput = AppSettings & { updatedAt: string; browserLang?: Lang };

export interface SearchQuery {
  keyword: string;
  from?: string;
  to?: string;
  projectId?: string;
}

export interface SearchResult {
  worklogs: Worklog[];
  schedules: Schedule[];
  truncated: boolean;
}

export interface ScheduleInput {
  id?: string;
  updatedAt?: string;
  type: ScheduleType;
  title: string;
  description: string;
  allDay: boolean;
  /** 종일: 'YYYY-MM-DD', 시각: 'YYYY-MM-DDTHH:mm' */
  startAt: string;
  endAt: string;
  priority: Priority;
  projectId: string;
  location: string;
  status: ScheduleStatus;
  tags: string[];
}

export interface WorklogInput {
  id?: string;
  updatedAt?: string;
  workDate: string;
  /** '' = 하루 기록, 'YYYY-MM-DD' = 기간 기록 종료일. 생략하면 서버가 기존 값 유지(새 기록은 하루) */
  endDate?: string;
  title: string;
  content: string;
  projectId: string;
  scheduleId: string;
  tags: string[];
  status: WorklogStatus;
  completeSchedule: boolean;
}

export interface WorklogSaveResult {
  worklog: Worklog;
  completedSchedule: Schedule | null;
}

export interface ProjectInput {
  id?: string;
  updatedAt?: string;
  name: string;
  color: string;
  sortOrder: number;
  active: boolean;
}

export interface Api {
  /** browserLang: 설정 값을 받기 전 화면이 고른 언어 (v1.13) */
  bootstrap(input: { browserLang: Lang }): Promise<Bootstrap>;
  getRange(range: { from: string; to: string }): Promise<RangeData>;
  getToday(): Promise<TodayDigest>;
  saveSchedule(input: ScheduleInput): Promise<Schedule>;
  deleteSchedule(input: { id: string; updatedAt: string }): Promise<DeleteResult>;
  setScheduleStatus(input: { id: string; status: ScheduleStatus; updatedAt: string }): Promise<Schedule>;
  saveWorklog(input: WorklogInput): Promise<WorklogSaveResult>;
  deleteWorklog(input: { id: string; updatedAt: string }): Promise<DeleteResult>;
  setWorklogStatus(input: { id: string; status: WorklogStatus; updatedAt: string }): Promise<Worklog>;
  search(query: SearchQuery): Promise<SearchResult>;
  saveProject(input: ProjectInput): Promise<Project>;
  getDiaries(range: { from: string; to: string }): Promise<Diary[]>;
  saveDiary(input: DiaryInput): Promise<Diary>;
  deleteDiary(input: { id: string; updatedAt: string }): Promise<DeleteResult>;
  searchDiaries(query: { keyword: string }): Promise<DiarySearchResult>;
  getTrash(): Promise<TrashData>;
  restoreSchedule(input: RestoreInput): Promise<Schedule>;
  restoreWorklog(input: RestoreInput): Promise<Worklog>;
  restoreDiary(input: RestoreInput): Promise<Diary>;
  getSettings(): Promise<SettingsView>;
  saveSettings(input: SettingsInput): Promise<SettingsView>;
  repairTriggers(): Promise<SettingsView>;
  sendTestDigest(): Promise<{ sentToday: number }>;
}

export type ApiErrorCode =
  | 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'FORBIDDEN' | 'BUSY' | 'NOT_INITIALIZED' | 'INTERNAL' | 'NETWORK';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}
