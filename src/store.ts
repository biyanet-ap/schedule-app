import { reactive } from 'vue';
import { createApi } from './api/client';
import {
  ApiError,
  type Api,
  type Bootstrap,
  type DeleteResult,
  type Diary,
  type DiaryInput,
  type DiarySearchResult,
  type Project,
  type ProjectInput,
  type RangeData,
  type Schedule,
  type ScheduleInput,
  type ScheduleStatus,
  type SearchResult,
  type AppSettings,
  type SettingsInput,
  type SettingsView,
  type TrashData,
  type TrashKind,
  type Worklog,
  type WorklogInput,
  type WorklogStatus,
} from './api/types';
import { browserLang, lang, msgs, screenLang, setLang, type LangSetting } from './i18n';
import { dateSpan, inRange, jstToday } from './utils/date';
import { weekDays } from './utils/diary';
import { periodRange, searchPeriodError, type DateRange, type SearchPeriodKind } from './utils/searchPeriod';
import { worklogSpan } from './utils/worklog';

/** 알림 안의 버튼 (되돌리기·보러 가기). 누르면 알림을 먼저 닫고 run을 부른다 */
export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  kind: 'error' | 'success' | 'info';
  message: string;
  action?: ToastAction;
}

/** 버튼이 있는 알림은 누를 시간을 주려고 오래 띄운다 */
export const ACTION_TOAST_MS = 10000;

/** '보러 가기' 이동 요청 (App.vue가 처리하고 비운다) */
export interface NavRequest {
  view: 'calendar' | 'diary';
  date: string;
}

function emptyRange(): RangeData {
  return { from: '', to: '', schedules: [], worklogs: [], diaries: [], calendarEvents: [], calendarError: null, holidayCalendarAvailable: true, holidays: [] };
}

let api: Api | null = null;
let rangeSeq = 0;
let searchSeq = 0;
let diaryWeekSeq = 0;
let diarySearchSeq = 0;
/** 다이어리 저장·삭제 횟수. 주 불러오기 도중에 바뀌면 그 응답(저장 전 스냅숏)은 버리고 다시 불러온다 */
let diaryMutations = 0;
/** store.data(캘린더 범위 데이터) 변경 횟수. 범위 불러오기 도중에 바뀌면 그 응답은 버리고 다시 불러온다 */
let rangeMutations = 0;
let toastSeq = 0;
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();
/** 알림에 마우스를 올렸다가 뗀 뒤(또는 포커스가 빠진 뒤) 닫힐 때까지 */
const TOAST_AFTER_HOLD_MS = 4000;

export const store = reactive({
  ready: false,
  fatalError: '',
  today: '',
  projects: [] as Project[],
  limits: null as Bootstrap['limits'] | null,
  /** 화면 동작에 쓰는 설정 (v1.12). 설정 창에서 저장하면 갱신. language는 v1.13 */
  settings: { todayPopup: true, language: 'auto' as LangSetting },
  data: emptyRange(),
  loadingRange: false,
  selectedDate: '',
  filter: { projectId: '', showGcal: true },
  search: {
    active: false, keyword: '', loading: false, result: null as SearchResult | null, error: '',
    /** 기간 필터 (새로고침하면 전체로). custom은 '직접 지정'의 적용된 값 */
    period: { kind: 'ALL' as SearchPeriodKind, custom: { from: '', to: '' } as DateRange },
  },
  /** 다이어리 보기 화면 상태 (보는 주 = 월~일) */
  diary: {
    weekStart: '',
    list: [] as Diary[],
    loading: false,
    error: '',
    /** 검색 결과에서 이동한 날짜 (카드 강조) */
    highlight: '',
    search: { active: false, keyword: '', loading: false, result: null as DiarySearchResult | null, error: '' },
  },
  toasts: [] as Toast[],
  nav: null as NavRequest | null,
  /** 휴지통 창 밖에서 복구한 횟수 (되돌리기). 휴지통 창이 열려 있으면 목록을 다시 받는다 */
  trashRevision: 0,
});

function requireApi(): Api {
  if (!api) throw new ApiError('INTERNAL', msgs().store.notReady);
  return api;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return msgs().store.unknownError;
}

function scheduleDismiss(id: number, ms: number) {
  clearTimeout(toastTimers.get(id));
  toastTimers.set(id, setTimeout(() => dismissToast(id), ms));
}

export function toast(kind: Toast['kind'], message: string, opts: { action?: ToastAction } = {}) {
  const id = ++toastSeq;
  store.toasts.push({ id, kind, message, action: opts.action });
  scheduleDismiss(id, opts.action ? ACTION_TOAST_MS : kind === 'error' ? 6000 : 3000);
}

/** 마우스를 올리거나 포커스가 들어오면 닫히지 않게 잡아 둔다 */
export function holdToast(id: number) {
  clearTimeout(toastTimers.get(id));
  toastTimers.delete(id);
}

/** 잡아 둔 알림을 놓으면 조금 뒤에 닫는다 */
export function releaseToast(id: number) {
  if (store.toasts.some((t) => t.id === id)) scheduleDismiss(id, TOAST_AFTER_HOLD_MS);
}

/** 알림 버튼: 두 번 눌리지 않게 알림부터 닫는다 */
export function runToastAction(t: Toast) {
  if (!t.action) return;
  dismissToast(t.id);
  t.action.run();
}

export function dismissToast(id: number) {
  clearTimeout(toastTimers.get(id));
  toastTimers.delete(id);
  const i = store.toasts.findIndex((t) => t.id === id);
  if (i >= 0) store.toasts.splice(i, 1);
}

export async function init() {
  store.fatalError = '';
  try {
    api = await createApi();
    // 설정 값을 받기 전이라 브라우저 언어로 부른다. 서버는 설정이 '자동'이면 이 언어를 마지막 화면 언어로 기록한다
    const boot = await api.bootstrap({ browserLang: browserLang() });
    store.today = boot.today;
    store.selectedDate = boot.today;
    store.projects = boot.projects;
    store.limits = boot.limits;
    store.settings.todayPopup = boot.settings?.todayPopup ?? true;
    applyLanguageSetting(boot.settings?.language);
    store.ready = true;
  } catch (e) {
    store.fatalError = errorMessage(e);
  }
}

/**
 * 설정의 언어(v1.13)를 화면에 반영한다. 이전 버전 서버 응답에 없으면 '자동'.
 * @return 화면 언어가 바뀌었는지
 */
function applyLanguageSetting(setting: LangSetting | undefined): boolean {
  store.settings.language = setting ?? 'auto';
  const next = screenLang(store.settings.language);
  const changed = next !== lang.value;
  setLang(next); // 바뀌지 않아도 <html lang>을 맞춘다
  return changed;
}

/** 자정이 지나 날짜가 바뀌었으면 today를 갱신한다. @return 바뀌었는지 */
export function refreshToday(): boolean {
  const t = jstToday();
  if (!store.today || t <= store.today) return false;
  store.today = t;
  return true;
}

/** 캘린더에 보이는 범위를 불러온다. 늦게 도착한 이전 요청 결과는 버린다. */
export async function loadRange(from: string, to: string) {
  const seq = ++rangeSeq;
  const mutationsAtStart = rangeMutations;
  store.loadingRange = true;
  try {
    const data = await requireApi().getRange({ from, to });
    if (seq !== rangeSeq) return;
    // 불러오는 사이에 저장·삭제·복구가 반영됐으면 이 응답은 그 전 상태일 수 있다 → 다시 불러온다
    if (mutationsAtStart !== rangeMutations) {
      void loadRange(from, to);
      return;
    }
    // 이전 버전 서버(롤백 중)는 diaries를 보내지 않는다
    store.data = { ...data, diaries: data.diaries ?? [] };
  } catch (e) {
    if (seq === rangeSeq) toast('error', errorMessage(e));
  } finally {
    if (seq === rangeSeq) store.loadingRange = false;
  }
}

/**
 * 화면 상태를 바꾸지 않고 기간 데이터만 받는다 (주간 보고용).
 * 캘린더가 들고 있는 store.data와 섞이지 않게 따로 돌려준다.
 */
export async function fetchRange(from: string, to: string): Promise<RangeData> {
  const data = await requireApi().getRange({ from, to });
  return { ...data, diaries: data.diaries ?? [] };
}

export function refreshRange() {
  if (store.data.from) return loadRange(store.data.from, store.data.to);
  return Promise.resolve();
}

function inLoadedRange(from: string, to: string) {
  return store.data.from !== '' && from <= store.data.to && to >= store.data.from;
}

function upsertSchedule(s: Schedule) {
  rangeMutations++;
  const list = store.data.schedules;
  const i = list.findIndex((x) => x.id === s.id);
  const span = dateSpan(s);
  const visible = inLoadedRange(span.start, span.end);
  if (i >= 0 && visible) list.splice(i, 1, s);
  else if (i >= 0) list.splice(i, 1);
  else if (visible) list.push(s);
}

function upsertWorklog(w: Worklog) {
  rangeMutations++;
  const list = store.data.worklogs;
  const i = list.findIndex((x) => x.id === w.id);
  const span = worklogSpan(w); // 기간 기록은 불러온 범위와 하루라도 겹치면 보인다
  const visible = inLoadedRange(span.start, span.end);
  if (i >= 0 && visible) list.splice(i, 1, w);
  else if (i >= 0) list.splice(i, 1);
  else if (visible) list.push(w);
}

/** 저장·삭제 뒤 검색 결과가 열려 있으면 다시 검색해서 맞춘다. */
function refreshSearchIfOpen() {
  if (store.search.active && store.search.keyword) void runSearch(store.search.keyword);
}

/** CONFLICT(다른 곳에서 먼저 수정)면 최신 데이터로 다시 불러온다. */
function afterFailure(e: unknown) {
  if (e instanceof ApiError && (e.code === 'CONFLICT' || e.code === 'NOT_FOUND')) {
    void refreshRange();
    // 다이어리 보기가 열려 있을 때만 (닫으면 weekStart를 비운다)
    if (store.diary.weekStart) void loadDiaryWeek(store.diary.weekStart);
  }
}

export async function saveSchedule(input: ScheduleInput): Promise<Schedule> {
  try {
    const saved = await requireApi().saveSchedule(input);
    upsertSchedule(saved);
    refreshSearchIfOpen();
    return saved;
  } catch (e) {
    afterFailure(e);
    throw e;
  }
}

export async function deleteSchedule(s: Schedule): Promise<DeleteResult> {
  try {
    const res = await requireApi().deleteSchedule({ id: s.id, updatedAt: s.updatedAt });
    rangeMutations++;
    store.data.schedules = store.data.schedules.filter((x) => x.id !== s.id);
    refreshSearchIfOpen();
    return res;
  } catch (e) {
    afterFailure(e);
    throw e;
  }
}

export async function setScheduleStatus(s: Schedule, status: ScheduleStatus): Promise<Schedule> {
  try {
    const saved = await requireApi().setScheduleStatus({ id: s.id, status, updatedAt: s.updatedAt });
    upsertSchedule(saved);
    refreshSearchIfOpen();
    return saved;
  } catch (e) {
    afterFailure(e);
    throw e;
  }
}

export async function saveWorklog(input: WorklogInput) {
  try {
    const res = await requireApi().saveWorklog(input);
    upsertWorklog(res.worklog);
    if (res.completedSchedule) upsertSchedule(res.completedSchedule);
    refreshSearchIfOpen();
    return res;
  } catch (e) {
    afterFailure(e);
    throw e;
  }
}

export async function setWorklogStatus(w: Worklog, status: WorklogStatus): Promise<Worklog> {
  try {
    const saved = await requireApi().setWorklogStatus({ id: w.id, status, updatedAt: w.updatedAt });
    upsertWorklog(saved);
    refreshSearchIfOpen();
    return saved;
  } catch (e) {
    afterFailure(e);
    throw e;
  }
}

export async function deleteWorklog(w: Worklog): Promise<DeleteResult> {
  try {
    const res = await requireApi().deleteWorklog({ id: w.id, updatedAt: w.updatedAt });
    rangeMutations++;
    store.data.worklogs = store.data.worklogs.filter((x) => x.id !== w.id);
    refreshSearchIfOpen();
    return res;
  } catch (e) {
    afterFailure(e);
    throw e;
  }
}

export async function saveProject(input: ProjectInput): Promise<Project> {
  const saved = await requireApi().saveProject(input);
  const i = store.projects.findIndex((p) => p.id === saved.id);
  if (i >= 0) store.projects.splice(i, 1, saved);
  else store.projects.push(saved);
  store.projects.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  return saved;
}

export function getToday() {
  return requireApi().getToday();
}

export async function runSearch(keyword: string) {
  const kw = keyword.trim();
  store.search.active = true;
  store.search.keyword = kw;
  store.search.error = '';
  if (!kw) {
    store.search.result = null;
    return;
  }
  const range = currentSearchRange();
  const periodMessage = searchPeriodError(range);
  if (periodMessage) {
    searchSeq++; // 진행 중인 이전 검색 결과가 덮어쓰지 않게
    store.search.loading = false;
    store.search.result = null;
    store.search.error = periodMessage;
    return;
  }
  const seq = ++searchSeq;
  store.search.loading = true;
  try {
    const result = await requireApi().search({
      keyword: kw,
      projectId: store.filter.projectId || undefined,
      from: range.from || undefined,
      to: range.to || undefined,
    });
    if (seq === searchSeq) store.search.result = result;
  } catch (e) {
    if (seq === searchSeq) {
      store.search.result = null;
      store.search.error = errorMessage(e);
    }
  } finally {
    if (seq === searchSeq) store.search.loading = false;
  }
}

/** 지금 적용 중인 검색 기간 ('' = 제한 없음) */
export function currentSearchRange(): DateRange {
  const p = store.search.period;
  return periodRange(p.kind, store.today, p.custom);
}

/**
 * 기간을 바꾸고, 검색 결과가 열려 있으면 같은 검색어로 다시 검색한다.
 * @param rerun false면 기간만 바꾼다 (실제 기간이 그대로일 때 불필요한 검색 방지)
 */
export function setSearchPeriod(kind: SearchPeriodKind, custom?: DateRange, rerun = true) {
  store.search.period.kind = kind;
  if (custom) store.search.period.custom = { ...custom };
  if (rerun && store.search.active && store.search.keyword) void runSearch(store.search.keyword);
}

export function closeSearch() {
  searchSeq++;
  store.search.active = false;
  store.search.loading = false;
  store.search.result = null;
  store.search.error = '';
}

// ---- 다이어리 ----

/** 날짜 패널(불러온 달)과 다이어리 화면(보는 주) 양쪽에 저장 결과를 반영한다 */
function upsertDiary(d: Diary) {
  const place = (list: Diary[], visible: boolean) => {
    const i = list.findIndex((x) => x.id === d.id);
    if (i >= 0) list.splice(i, 1);
    if (visible) {
      list.push(d);
      list.sort((a, b) => a.diaryDate.localeCompare(b.diaryDate));
    }
  };
  rangeMutations++;
  place(store.data.diaries, inLoadedRange(d.diaryDate, d.diaryDate));
  const week = store.diary.weekStart ? weekDays(store.diary.weekStart) : [];
  place(store.diary.list, week.includes(d.diaryDate));
}

function removeDiary(id: string) {
  rangeMutations++;
  store.data.diaries = store.data.diaries.filter((x) => x.id !== id);
  store.diary.list = store.diary.list.filter((x) => x.id !== id);
}

function refreshDiarySearchIfOpen() {
  if (store.diary.search.active && store.diary.search.keyword) void runDiarySearch(store.diary.search.keyword);
}

/**
 * 이미 불러온 그 날짜의 다이어리.
 * 다이어리 보기가 열려 있고 그 주의 날짜면 방금 불러온 주 목록을 기준으로 본다 (달 데이터가 더 오래됐을 수 있어서).
 */
export function diaryOn(date: string): Diary | undefined {
  if (store.diary.weekStart && weekDays(store.diary.weekStart).includes(date)) {
    return store.diary.list.find((d) => d.diaryDate === date);
  }
  return store.data.diaries.find((d) => d.diaryDate === date);
}

/** 다이어리 화면: 기준일이 속한 주(월~일)를 불러온다. 늦게 도착한 이전 요청 결과는 버린다 */
export async function loadDiaryWeek(base: string) {
  const days = weekDays(base);
  const seq = ++diaryWeekSeq;
  const mutationsAtStart = diaryMutations;
  store.diary.weekStart = days[0];
  store.diary.loading = true;
  store.diary.error = '';
  try {
    const list = await requireApi().getDiaries({ from: days[0], to: days[6] });
    if (seq !== diaryWeekSeq) return;
    // 불러오는 사이에 저장·삭제가 끝났으면 이 응답은 그 전 상태일 수 있다 → 다시 불러온다
    if (mutationsAtStart !== diaryMutations) {
      void loadDiaryWeek(days[0]);
      return;
    }
    store.diary.list = list;
  } catch (e) {
    if (seq === diaryWeekSeq) {
      store.diary.list = [];
      store.diary.error = errorMessage(e);
    }
  } finally {
    if (seq === diaryWeekSeq) store.diary.loading = false;
  }
}

export async function saveDiary(input: DiaryInput): Promise<Diary> {
  try {
    const saved = await requireApi().saveDiary(input);
    diaryMutations++;
    upsertDiary(saved);
    refreshDiarySearchIfOpen();
    return saved;
  } catch (e) {
    afterFailure(e);
    throw e;
  }
}

export async function deleteDiary(d: Diary): Promise<DeleteResult> {
  try {
    const res = await requireApi().deleteDiary({ id: d.id, updatedAt: d.updatedAt });
    diaryMutations++;
    removeDiary(d.id);
    refreshDiarySearchIfOpen();
    return res;
  } catch (e) {
    afterFailure(e);
    throw e;
  }
}

export async function runDiarySearch(keyword: string) {
  const kw = keyword.trim();
  const s = store.diary.search;
  s.active = true;
  s.keyword = kw;
  s.error = '';
  if (!kw) {
    s.result = null;
    return;
  }
  const seq = ++diarySearchSeq;
  s.loading = true;
  try {
    const result = await requireApi().searchDiaries({ keyword: kw });
    if (seq === diarySearchSeq) s.result = result;
  } catch (e) {
    if (seq === diarySearchSeq) {
      s.result = null;
      s.error = errorMessage(e);
    }
  } finally {
    if (seq === diarySearchSeq) s.loading = false;
  }
}

export function closeDiarySearch() {
  diarySearchSeq++;
  Object.assign(store.diary.search, { active: false, loading: false, result: null, error: '' });
}

/** 다이어리 보기를 닫을 때: 진행 중인 불러오기는 버리고 화면 상태를 비운다 */
export function resetDiaryView() {
  diaryWeekSeq++;
  closeDiarySearch();
  Object.assign(store.diary, { weekStart: '', list: [], loading: false, error: '', highlight: '' });
}

// ---- 휴지통·되돌리기 (v1.11) ----

/** 휴지통 목록. 화면 상태는 휴지통 창이 들고 있다 */
export function fetchTrash(): Promise<TrashData> {
  return requireApi().getTrash();
}

/** 되살리고 캘린더·날짜 패널·다이어리 화면·검색 결과에 반영한다. updatedAt = 삭제 시각 */
export async function restoreItem(kind: TrashKind, id: string, updatedAt: string): Promise<Schedule | Worklog | Diary> {
  const input = { id, updatedAt };
  try {
    if (kind === 'SCHEDULE') {
      const s = await requireApi().restoreSchedule(input);
      upsertSchedule(s);
      refreshSearchIfOpen();
      return s;
    }
    if (kind === 'WORKLOG') {
      const w = await requireApi().restoreWorklog(input);
      upsertWorklog(w);
      refreshSearchIfOpen();
      return w;
    }
    const d = await requireApi().restoreDiary(input);
    diaryMutations++;
    upsertDiary(d);
    refreshDiarySearchIfOpen();
    return d;
  } catch (e) {
    afterFailure(e);
    throw e;
  }
}

async function undoDelete(kind: TrashKind, id: string, updatedAt: string) {
  try {
    await restoreItem(kind, id, updatedAt);
    store.trashRevision++;
    toast('success', msgs().store.restored);
  } catch (e) {
    toast('error', errorMessage(e));
  }
}

/**
 * 삭제 직후 알림. 서버가 삭제 시각을 돌려주면(v1.11 이후) '되돌리기' 버튼을 붙인다.
 * 이전 버전 서버(롤백 중)는 삭제 시각을 주지 않으므로 버튼 없이 알린다.
 */
export function notifyDeleted(kind: TrashKind, res: DeleteResult) {
  const deletedAt = res.updatedAt;
  const m = msgs().store;
  if (!deletedAt) {
    toast('success', m.deleted[kind]);
    return;
  }
  toast('success', m.deleted[kind], {
    action: { label: m.undo, run: () => void undoDelete(kind, res.id, deletedAt) },
  });
}

export function requestNavigate(req: NavRequest) {
  store.nav = { ...req };
}

// ---- 설정 화면 (v1.12) ----

/**
 * 설정을 화면에 반영. 언어가 바뀌면 이미 만들어 둔 문구를 새 언어로 다시 만든다:
 * 서버 문구(구글 캘린더 오류 등)가 든 캘린더 데이터·검색 결과는 다시 받고, 남아 있는 오류 문구는 지운다.
 */
function applySettingsView(view: SettingsView) {
  store.settings.todayPopup = view.settings.todayPopup;
  if (!applyLanguageSetting(view.settings.language)) return;
  void refreshRange();
  store.diary.error = '';
  store.diary.search.error = '';
  if (store.search.active && store.search.keyword) void runSearch(store.search.keyword);
  else store.search.error = '';
}

/** 설정 창을 열 때. 다른 기기에서 바꾼 팝업·언어 설정도 여기서 반영된다 */
export async function fetchSettings(): Promise<SettingsView> {
  const view = await requireApi().getSettings();
  applySettingsView(view);
  return view;
}

/** 저장. 언어를 '자동'으로 두면 메일 언어를 정하도록 이 브라우저의 언어도 함께 보낸다 */
export async function saveAppSettings(input: AppSettings & { updatedAt: string }): Promise<SettingsView> {
  const payload: SettingsInput = { ...input, browserLang: browserLang() };
  const view = await requireApi().saveSettings(payload);
  applySettingsView(view);
  return view;
}

export function repairTriggers(): Promise<SettingsView> {
  return requireApi().repairTriggers();
}

export function sendTestDigest(): Promise<{ sentToday: number }> {
  return requireApi().sendTestDigest();
}

// ---- 조회용 헬퍼 ----
export function projectById(id: string): Project | undefined {
  return store.projects.find((p) => p.id === id);
}

export function holidayName(date: string): string | null {
  return store.data.holidays.find((h) => h.date === date)?.name ?? null;
}

export function isLoaded(date: string) {
  return store.data.from !== '' && inRange(date, store.data.from, store.data.to);
}
