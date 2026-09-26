<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Diary, Schedule, Worklog } from './api/types';
import AppLogo from './components/AppLogo.vue';
import CalendarView from './components/CalendarView.vue';
import DayPanel from './components/DayPanel.vue';
import DiaryDialog from './components/DiaryDialog.vue';
import DiaryView from './components/DiaryView.vue';
import ScheduleDialog from './components/ScheduleDialog.vue';
import SearchPanel from './components/SearchPanel.vue';
import SettingsDialog from './components/SettingsDialog.vue';
import ToastHost from './components/ToastHost.vue';
import TodayDialog from './components/TodayDialog.vue';
import TrashDialog from './components/TrashDialog.vue';
import WeeklyReportDialog from './components/WeeklyReportDialog.vue';
import WorklogDialog from './components/WorklogDialog.vue';
import { closeDiarySearch, closeSearch, diaryOn, holidayName, init, loadDiaryWeek, loadRange, refreshToday, resetDiaryView, runSearch, store, type NavRequest } from './store';
import { addDays } from './utils/date';
import { COLORS, toEventInputs, type EventMeta } from './utils/events';
import { tr } from './i18n';

type DialogState =
  | { type: 'schedule'; schedule?: Schedule; date: string }
  | { type: 'worklog'; worklog?: Worklog; date: string; scheduleId?: string }
  | { type: 'diary'; diary?: Diary; date: string }
  | { type: 'weekly' }
  | { type: 'today' }
  | { type: 'settings' }
  | { type: 'trash' };

const TODAY_SHOWN_KEY = 'sc.todayPopupShown';

const calendar = ref<InstanceType<typeof CalendarView> | null>(null);
const dialog = ref<DialogState | null>(null);
/** 캘린더 화면 ↔ 다이어리 보기. 캘린더는 v-show로 살려 둬서 돌아왔을 때 보던 달이 유지된다 */
const view = ref<'calendar' | 'diary'>('calendar');
/** 보고 있는 달 'YYYY-MM' (제목은 화면 언어로 만든다) */
const calendarMonth = ref('');
const calendarTitle = computed(() => {
  if (!calendarMonth.value) return '';
  const [y, m] = calendarMonth.value.split('-').map(Number);
  return tr.value.app.monthTitle(y, m);
});
const keyword = ref('');
const panelEl = ref<HTMLElement | null>(null);

// 화면 폭·다크 모드 감지
const mobileQuery = window.matchMedia('(max-width: 767px)');
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const mobile = ref(mobileQuery.matches);
const dark = ref(darkQuery.matches);
const onMobileChange = (e: MediaQueryListEvent) => { mobile.value = e.matches; };
const onDarkChange = (e: MediaQueryListEvent) => { dark.value = e.matches; };

const holidays = computed(() => new Set(store.data.holidays.map((h) => h.date)));
const events = computed(() => toEventInputs(store.data, store.projects, store.filter));
/** 필터로 선택 중인 프로젝트가 사용 중지되더라도 목록에서 사라지지 않게 남겨 둔다 */
const filterProjects = computed(() => store.projects.filter((p) => p.active || p.id === store.filter.projectId));

/**
 * 접속 팝업은 하루 한 번만 자동으로 띄운다. 저장소를 못 쓰는 환경이면 매번 띄운다.
 * 설정에서 끄면(v1.12, 모든 기기 공통) 띄우지 않는다 — 헤더 '오늘 요약' 버튼으로는 열 수 있다.
 */
function shouldAutoShowToday(): boolean {
  if (!store.settings.todayPopup) return false;
  try {
    if (localStorage.getItem(TODAY_SHOWN_KEY) === store.today) return false;
    localStorage.setItem(TODAY_SHOWN_KEY, store.today);
  } catch {
    // 무시: 팝업을 띄우는 쪽으로 동작
  }
  return true;
}

async function start() {
  await init();
  if (store.ready && shouldAutoShowToday()) dialog.value = { type: 'today' };
}

/** 탭을 열어 둔 채 날짜가 바뀐 뒤 다시 보면, 오늘을 갱신하고 그날 첫 팝업을 띄운다. */
function onVisibilityChange() {
  if (document.visibilityState !== 'visible' || !store.ready) return;
  if (refreshToday() && !dialog.value && shouldAutoShowToday()) dialog.value = { type: 'today' };
}

function goToday() {
  refreshToday();
  calendar.value?.today();
  selectDate(store.today);
}

onMounted(() => {
  mobileQuery.addEventListener('change', onMobileChange);
  darkQuery.addEventListener('change', onDarkChange);
  document.addEventListener('visibilitychange', onVisibilityChange);
  void start();
});

onBeforeUnmount(() => {
  mobileQuery.removeEventListener('change', onMobileChange);
  darkQuery.removeEventListener('change', onDarkChange);
  document.removeEventListener('visibilitychange', onVisibilityChange);
});

function onRangeChange(range: { from: string; to: string }) {
  // 보고 있는 달이 바뀌면 그 달의 오늘(없으면 1일)을 선택한다.
  // 월 보기는 앞뒤 달 날짜가 섞여 있으므로 range.from + 6일이 항상 보고 있는 달에 속한다.
  const month = addDays(range.from, 6).slice(0, 7);
  calendarMonth.value = month;
  if (store.selectedDate.slice(0, 7) !== month) {
    store.selectedDate = store.today.slice(0, 7) === month ? store.today : `${month}-01`;
  }
  void loadRange(range.from, range.to);
}

function selectDate(date: string) {
  store.selectedDate = date;
  if (store.search.active) closeSearch();
  if (mobile.value) panelEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function onEventClick(meta: EventMeta) {
  if (meta.kind === 'schedule') {
    const s = store.data.schedules.find((x) => x.id === meta.refId);
    if (s) dialog.value = { type: 'schedule', schedule: s, date: s.startAt.slice(0, 10) };
  } else if (meta.kind === 'worklog') {
    const w = store.data.worklogs.find((x) => x.id === meta.refId);
    if (w) dialog.value = { type: 'worklog', worklog: w, date: w.workDate };
  } else if (meta.kind === 'gcal') {
    const c = store.data.calendarEvents.find((x) => x.id === meta.refId);
    if (c) selectDate(c.startAt.slice(0, 10));
  }
}

function gotoDate(date: string) {
  calendar.value?.gotoDate(date);
  store.selectedDate = date;
  closeSearch();
}

function submitSearch() {
  if (keyword.value.trim()) void runSearch(keyword.value);
}

watch(() => store.filter.projectId, () => {
  if (store.search.active && store.search.keyword) void runSearch(store.search.keyword);
});

function openNewSchedule() {
  dialog.value = { type: 'schedule', date: store.selectedDate || store.today };
}
function openNewWorklog(date?: string, scheduleId?: string) {
  dialog.value = { type: 'worklog', date: date ?? (store.selectedDate || store.today), scheduleId };
}

/** 날짜당 1편: 이미 쓴 날짜면 그 다이어리를 수정 창으로 연다 */
function openDiary(date: string, diary?: Diary) {
  dialog.value = { type: 'diary', diary: diary ?? diaryOn(date), date };
}

function openDiaryView() {
  view.value = 'diary';
  store.diary.highlight = '';
  void loadDiaryWeek(store.selectedDate || store.today);
}

function closeDiaryView() {
  resetDiaryView();
  view.value = 'calendar';
}

/**
 * 휴지통 알림의 '보러 가기' (v1.11). 휴지통 창만 닫는다 —
 * 그 사이 다른 창(수정 중인 일정 등)을 열었다면 쓰던 내용이 날아가지 않게 그대로 둔다.
 */
function navigate(req: NavRequest) {
  if (dialog.value?.type === 'trash') dialog.value = null;
  if (req.view === 'diary') {
    view.value = 'diary';
    closeDiarySearch();
    store.diary.highlight = req.date;
    void loadDiaryWeek(req.date);
    return;
  }
  if (view.value === 'diary') closeDiaryView();
  gotoDate(req.date);
}

watch(() => store.nav, (req) => {
  if (!req) return;
  store.nav = null;
  navigate(req);
});

</script>

<template>
  <div v-if="store.fatalError" class="fatal">
    <h1>{{ tr.app.startFailed }}</h1>
    <p>{{ store.fatalError }}</p>
    <button type="button" class="btn btn-primary" @click="start">{{ tr.app.retry }}</button>
  </div>

  <!-- 설정(언어)을 받기 전이라 글자 없이 스피너만 (v1.13) -->
  <div v-else-if="!store.ready" class="booting" aria-busy="true"><span class="spinner" role="status" :aria-label="tr.app.loading" /></div>

  <div v-else class="app">
    <DiaryView
      v-if="view === 'diary'"
      @back="closeDiaryView"
      @write="(d) => openDiary(d)"
      @open="(d) => openDiary(d.diaryDate, d)"
    />

    <div v-show="view === 'calendar'">
    <header class="topbar">
      <div class="nav">
        <strong class="brand"><AppLogo /><span class="brand-text">{{ tr.app.brand }}</span></strong>
        <button type="button" class="icon-btn" :aria-label="tr.app.prevMonth" @click="calendar?.prev()">‹</button>
        <button type="button" class="btn" @click="goToday">{{ tr.app.today }}</button>
        <button type="button" class="icon-btn" :aria-label="tr.app.nextMonth" @click="calendar?.next()">›</button>
        <h1 class="title">{{ calendarTitle }}</h1>
        <span v-if="store.loadingRange" class="spinner" :aria-label="tr.app.loading" />
      </div>

      <form class="search" role="search" @submit.prevent="submitSearch">
        <input v-model="keyword" type="search" class="input" :placeholder="tr.app.searchPlaceholder" :aria-label="tr.app.searchLabel" :maxlength="store.limits?.keyword" />
        <button type="submit" class="btn">{{ tr.app.search }}</button>
      </form>

      <div class="tools">
        <select v-model="store.filter.projectId" class="input filter" :aria-label="tr.app.projectFilter">
          <option value="">{{ tr.app.allProjects }}</option>
          <option v-for="p in filterProjects" :key="p.id" :value="p.id">{{ p.name }}{{ p.active ? '' : tr.common.inactiveSuffix }}</option>
        </select>
        <button type="button" class="btn" @click="dialog = { type: 'today' }">{{ tr.app.todaySummary }}</button>
        <button type="button" class="btn" @click="openNewSchedule">{{ tr.common.addSchedule }}</button>
        <button type="button" class="btn btn-primary" @click="openNewWorklog()">{{ tr.app.addWorklog }}</button>
        <button type="button" class="btn" @click="openDiaryView">{{ tr.app.diary }}</button>
        <button type="button" class="btn" @click="dialog = { type: 'weekly' }">{{ tr.app.weekly }}</button>
        <button type="button" class="icon-btn" :aria-label="tr.app.trash" :title="tr.app.trash" @click="dialog = { type: 'trash' }">🗑</button>
        <button type="button" class="icon-btn" :aria-label="tr.app.settings" :title="tr.app.settingsTitle" @click="dialog = { type: 'settings' }">⚙</button>
      </div>
    </header>

    <div v-if="!store.data.holidayCalendarAvailable" class="notice banner">
      {{ tr.app.holidayMissing }}
    </div>

    <main class="layout">
      <section class="main-col">
        <CalendarView
          ref="calendar"
          :events="events"
          :holidays="holidays"
          :selected-date="store.selectedDate"
          :initial-date="store.today"
          :mobile="mobile"
          :dark="dark"
          @date-click="selectDate"
          @event-click="onEventClick"
          @range-change="onRangeChange"
        />
        <div class="legend" :aria-label="tr.app.legend">
          <span><i class="dot" :style="{ background: COLORS.task }" />{{ tr.app.legendTask }}</span>
          <span><i class="dot" :style="{ background: COLORS.meeting }" />{{ tr.app.legendMeeting }}</span>
          <span><i class="dot" :style="{ background: COLORS.worklog }" />{{ tr.common.worklog }}</span>
          <label><input v-model="store.filter.showGcal" type="checkbox" /><i class="dot" :style="{ background: COLORS.gcal }" />{{ tr.common.gcal }}</label>
          <span class="holiday-legend">{{ tr.app.legendHoliday }}</span>
        </div>
      </section>

      <div ref="panelEl" class="side-col">
        <SearchPanel
          v-if="store.search.active"
          @goto-date="gotoDate"
          @open-worklog="(w) => (dialog = { type: 'worklog', worklog: w, date: w.workDate })"
          @open-schedule="(s) => (dialog = { type: 'schedule', schedule: s, date: s.startAt.slice(0, 10) })"
        />
        <DayPanel
          v-else
          :date="store.selectedDate"
          :holiday="holidayName(store.selectedDate)"
          @add-schedule="openNewSchedule"
          @add-worklog="openNewWorklog()"
          @open-schedule="(s) => (dialog = { type: 'schedule', schedule: s, date: s.startAt.slice(0, 10) })"
          @open-worklog="(w) => (dialog = { type: 'worklog', worklog: w, date: w.workDate })"
          @write-log-for="(s) => openNewWorklog(store.selectedDate, s.id)"
          @write-diary="openDiary(store.selectedDate)"
          @open-diary="(d) => openDiary(d.diaryDate, d)"
        />
      </div>
    </main>
    </div>

    <ScheduleDialog v-if="dialog?.type === 'schedule'" :schedule="dialog.schedule" :date="dialog.date" @close="dialog = null" />
    <WorklogDialog
      v-if="dialog?.type === 'worklog'" :worklog="dialog.worklog" :date="dialog.date" :schedule-id="dialog.scheduleId"
      @close="dialog = null"
    />
    <TodayDialog
      v-if="dialog?.type === 'today'"
      @close="dialog = null"
      @write-log="openNewWorklog(store.today)"
      @open-date="(d) => { dialog = null; if (view === 'diary') closeDiaryView(); gotoDate(d); }"
    />
    <SettingsDialog v-if="dialog?.type === 'settings'" @close="dialog = null" />
    <DiaryDialog v-if="dialog?.type === 'diary'" :diary="dialog.diary" :date="dialog.date" @close="dialog = null" />
    <WeeklyReportDialog v-if="dialog?.type === 'weekly'" @close="dialog = null" />
    <TrashDialog v-if="dialog?.type === 'trash'" @close="dialog = null" />
    <ToastHost />
  </div>
</template>

<style scoped>
.fatal, .booting { max-width: 520px; margin: 15vh auto; padding: 24px; text-align: center; }
.fatal { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
.fatal h1 { font-size: 18px; }
.booting { color: var(--muted); }
.booting .spinner { display: inline-block; width: 28px; height: 28px; border-width: 3px; margin: 0; }

.app { max-width: 1440px; margin: 0 auto; padding: 12px 16px 24px; }
.topbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.nav { display: flex; align-items: center; gap: 6px; }
.brand { font-size: 15px; margin-right: 6px; white-space: nowrap; }
.title { font-size: 18px; margin: 0 0 0 8px; white-space: nowrap; }
.search { display: flex; gap: 6px; flex: 1; min-width: 220px; max-width: 420px; }
.tools { display: flex; align-items: center; gap: 6px; margin-left: auto; flex-wrap: wrap; }
.filter { width: auto; min-width: 150px; max-width: 220px; }
.spinner {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid var(--border); border-top-color: var(--primary); animation: spin 0.8s linear infinite; margin-left: 6px;
}
@keyframes spin { to { transform: rotate(360deg); } }
.banner { margin-bottom: 12px; }

.layout { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 12px; align-items: start; }
.side-col { position: sticky; top: 12px; max-height: calc(100vh - 24px); overflow-y: auto; }
.legend { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12px; color: var(--muted); padding: 8px 4px; }
.legend span, .legend label { display: inline-flex; align-items: center; gap: 5px; }
.legend label { cursor: pointer; }
.legend .dot { width: 10px; height: 10px; }
.holiday-legend { color: var(--holiday) !important; }

@media (max-width: 1080px) {
  .layout { grid-template-columns: minmax(0, 1fr) 300px; }
}
@media (max-width: 767px) {
  .app { padding: 10px 12px 24px; }
  .topbar { gap: 8px; }
  .brand :deep(.app-logo) { width: 20px; height: 20px; }
  .search { order: 3; max-width: none; min-width: 0; flex-basis: 100%; }
  .tools { margin-left: 0; width: 100%; }
  .tools .filter { flex: 1 1 100%; width: auto; max-width: none; }
  .tools .btn { flex: 1; padding: 0 8px; }
  .layout { grid-template-columns: 1fr; }
  .side-col { position: static; max-height: none; overflow: visible; }
  .title { font-size: 16px; }
}
/* 폭이 좁은 휴대폰(v1.14): 로고가 앱 이름을 대신하고 글자는 스크린 리더용으로만 남긴다 — 월 제목이 화면 밖으로 밀리지 않게 */
@media (max-width: 380px) {
  .brand-text {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; border: 0;
    overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap;
  }
  .brand :deep(.app-logo) { margin-right: 0; }
}
</style>
