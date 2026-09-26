<script setup lang="ts">
import { computed, ref } from 'vue';
import type { CalendarEvent, Diary, Schedule, Worklog } from '../api/types';
import { errorMessage, projectById, setScheduleStatus, setWorklogStatus, store, toast } from '../store';
import { formatDateLabel, occursOn, timeLabel } from '../utils/date';
import { safeHttpUrl } from '../utils/events';
import { isPeriodLog, periodLabel, worklogOccursOn } from '../utils/worklog';
import { tr } from '../i18n';

const props = defineProps<{ date: string; holiday: string | null }>();
const emit = defineEmits<{
  addSchedule: [];
  addWorklog: [];
  openSchedule: [s: Schedule];
  openWorklog: [w: Worklog];
  writeLogFor: [s: Schedule];
  writeDiary: [];
  openDiary: [d: Diary];
}>();

const pending = ref(new Set<string>());
const byProject = (projectId: string) => !store.filter.projectId || store.filter.projectId === projectId;

const schedules = computed(() => store.data.schedules
  .filter((s) => s.status !== 'CANCELLED' && byProject(s.projectId) && occursOn(s, props.date))
  .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startAt.localeCompare(b.startAt)));

const meetings = computed<CalendarEvent[]>(() => (store.filter.showGcal && !store.filter.projectId
  ? store.data.calendarEvents.filter((c) => occursOn(c, props.date)).sort((a, b) => a.startAt.localeCompare(b.startAt))
  : []));

/** 이 날짜의 하루 기록 + 이 날짜가 기간 안에 드는 기간 기록. 기간 기록을 위에 둔다 */
const worklogs = computed(() => store.data.worklogs
  .filter((w) => worklogOccursOn(w, props.date) && byProject(w.projectId))
  .sort((a, b) => Number(isPeriodLog(b)) - Number(isPeriodLog(a))
    || a.workDate.localeCompare(b.workDate)
    || a.createdAt.localeCompare(b.createdAt)));

/** 이 날짜의 다이어리 (날짜당 최대 1편, 프로젝트 필터와 무관) */
const diary = computed(() => store.data.diaries.find((d) => d.diaryDate === props.date));

const loaded = computed(() => store.data.from !== '' && props.date >= store.data.from && props.date <= store.data.to);

async function toggleDone(s: Schedule, ev: Event) {
  const box = ev.target as HTMLInputElement;
  pending.value.add(s.id);
  try {
    await setScheduleStatus(s, s.status === 'DONE' ? 'PLANNED' : 'DONE');
  } catch (e) {
    // :checked 바인딩 값은 그대로라 Vue가 DOM을 되돌리지 않으므로 직접 맞춘다
    box.checked = s.status === 'DONE';
    toast('error', errorMessage(e));
  } finally {
    pending.value.delete(s.id);
  }
}

async function toggleWorklogDone(w: Worklog) {
  pending.value.add(w.id);
  try {
    const saved = await setWorklogStatus(w, w.status === 'DONE' ? 'IN_PROGRESS' : 'DONE');
    toast('success', saved.status === 'DONE' ? tr.value.worklogStatus.doneToast : tr.value.worklogStatus.progressToast);
  } catch (e) {
    toast('error', errorMessage(e));
  } finally {
    pending.value.delete(w.id);
  }
}
</script>

<template>
  <aside class="panel" :aria-label="tr.day.panelLabel">
    <header class="head">
      <div>
        <h2>{{ formatDateLabel(date) }}</h2>
        <p v-if="holiday" class="holiday">{{ holiday }}</p>
      </div>
      <div class="actions">
        <button type="button" class="btn btn-sm" @click="emit('addSchedule')">{{ tr.common.addSchedule }}</button>
        <button type="button" class="btn btn-sm btn-primary" @click="emit('addWorklog')">{{ tr.day.addLog }}</button>
      </div>
    </header>

    <p v-if="!loaded" class="muted empty">{{ tr.day.notLoaded }}</p>
    <template v-else>
      <section>
        <h3>{{ tr.day.schedules }} <span class="count">{{ schedules.length }}</span></h3>
        <p v-if="!schedules.length" class="empty">{{ tr.day.noSchedules }}</p>
        <ul class="items">
          <li v-for="s in schedules" :key="s.id" :class="{ done: s.status === 'DONE' }">
            <input
              type="checkbox" class="done-check" :checked="s.status === 'DONE'" :disabled="pending.has(s.id)"
              :aria-label="tr.day.markDone(s.title)" @change="toggleDone(s, $event)"
            />
            <button type="button" class="item" @click="emit('openSchedule', s)">
              <span class="line1">
                <span class="dot" :style="{ background: s.type === 'MEETING' ? '#7c3aed' : projectById(s.projectId)?.color ?? '#2563eb' }" />
                <span class="time">{{ timeLabel(s, date) }}</span>
                <span v-if="s.priority === 'HIGH'" class="badge badge-high">{{ tr.common.high }}</span>
                <span v-if="s.type === 'MEETING'" class="badge badge-meeting">{{ tr.common.meeting }}</span>
              </span>
              <span class="title">{{ s.title }}</span>
              <span v-if="projectById(s.projectId) || s.tags.length" class="meta">
                <span v-if="projectById(s.projectId)" class="chip">{{ projectById(s.projectId)?.name }}</span>
                <span v-for="t in s.tags" :key="t" class="chip">#{{ t }}</span>
              </span>
            </button>
            <div class="sub">
              <a v-if="safeHttpUrl(s.location)" :href="safeHttpUrl(s.location)!" target="_blank" rel="noopener noreferrer">{{ tr.common.meetingLink }}</a>
              <span v-else-if="s.location" class="muted">{{ s.location }}</span>
              <button v-if="s.type === 'TASK'" type="button" class="link" @click="emit('writeLogFor', s)">{{ tr.day.writeLog }}</button>
            </div>
          </li>
        </ul>
      </section>

      <section v-if="store.filter.showGcal && !store.filter.projectId">
        <h3>{{ tr.common.gcal }} <span class="count">{{ meetings.length }}</span></h3>
        <p v-if="store.data.calendarError" class="notice">{{ store.data.calendarError }}</p>
        <p v-else-if="!meetings.length" class="empty">{{ tr.day.noMeetings }}</p>
        <ul class="items">
          <li v-for="m in meetings" :key="m.id" class="readonly">
            <span class="line1">
              <span class="dot" style="background: #64748b" />
              <span class="time">{{ timeLabel(m, date) }}</span>
            </span>
            <span class="title">{{ m.title }}</span>
            <span v-if="m.location" class="muted small">{{ m.location }}</span>
          </li>
        </ul>
      </section>

      <section>
        <h3>{{ tr.common.worklog }} <span class="count">{{ worklogs.length }}</span></h3>
        <p v-if="!worklogs.length" class="empty">{{ tr.day.noWorklogs }}</p>
        <ul class="items">
          <li v-for="w in worklogs" :key="w.id" :class="{ 'log-done': w.status === 'DONE' }">
            <button type="button" class="item" @click="emit('openWorklog', w)">
              <span class="title">
                <span class="mark" aria-hidden="true">{{ w.status === 'DONE' ? '✓' : '✎' }}</span>
                <span class="title-text">{{ w.title }}</span>
              </span>
              <span v-if="isPeriodLog(w)" class="period"><span class="badge badge-period">{{ tr.common.periodBadge }}</span> {{ periodLabel(w) }}</span>
              <span v-if="w.content" class="excerpt pre">{{ w.content }}</span>
              <span class="meta">
                <span v-if="projectById(w.projectId)" class="chip">
                  <span class="dot" :style="{ background: projectById(w.projectId)?.color }" />{{ projectById(w.projectId)?.name }}
                </span>
                <span v-for="t in w.tags" :key="t" class="chip">#{{ t }}</span>
              </span>
            </button>
            <div class="status-row">
              <span v-if="w.status === 'DONE'" class="badge badge-done">{{ tr.common.done }}</span>
              <span v-else class="badge badge-progress">{{ tr.common.inProgress }}</span>
              <button
                type="button" class="btn btn-sm status-btn" :class="{ 'btn-primary': w.status !== 'DONE' }"
                :disabled="pending.has(w.id)" :aria-label="tr.worklogStatus.toggleAria(w.title, w.status === 'DONE')"
                @click="toggleWorklogDone(w)"
              >
                {{ pending.has(w.id) ? tr.common.processing : w.status === 'DONE' ? tr.worklogStatus.revert : tr.worklogStatus.markDone }}
              </button>
            </div>
          </li>
        </ul>
      </section>

      <section class="diary-section">
        <h3>{{ tr.common.diary }}</h3>
        <ul v-if="diary" class="items">
          <li>
            <button type="button" class="item" @click="emit('openDiary', diary)">
              <span class="title">📔 {{ diary.title }}</span>
              <span class="excerpt pre">{{ diary.content }}</span>
            </button>
          </li>
        </ul>
        <button v-else type="button" class="btn btn-sm" @click="emit('writeDiary')">{{ tr.day.writeDiary }}</button>
      </section>
    </template>
  </aside>
</template>

<style scoped>
.panel { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; }
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 4px; }
.head h2 { margin: 0; font-size: 17px; }
.holiday { margin: 2px 0 0; color: var(--holiday); font-size: 13px; font-weight: 600; }
.actions { display: flex; gap: 6px; }
h3 { font-size: 12px; color: var(--muted); margin: 16px 0 6px; display: flex; align-items: center; gap: 6px; text-transform: none; }
.count { font-size: 11px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 999px; padding: 0 7px; color: var(--text); }
.empty { margin: 0; color: var(--muted); font-size: 13px; }
.items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.items li { position: relative; border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; background: var(--surface); }
.items li.readonly { display: flex; flex-direction: column; gap: 2px; background: var(--surface-2); }
.items li.done .title { text-decoration: line-through; color: var(--muted); }
.done-check { position: absolute; top: 10px; right: 10px; width: 16px; height: 16px; cursor: pointer; }
.item { all: unset; display: flex; flex-direction: column; gap: 3px; cursor: pointer; width: 100%; box-sizing: border-box; padding-right: 22px; }
.item:focus-visible { outline: 2px solid var(--primary); outline-offset: 4px; border-radius: 4px; }
.line1 { display: flex; align-items: center; gap: 6px; }
.time { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.title { font-weight: 600; word-break: break-word; }
.excerpt { font-size: 13px; color: var(--muted); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.meta { display: flex; flex-wrap: wrap; gap: 4px; }
.sub { display: flex; gap: 10px; font-size: 12px; margin-top: 4px; }
.sub a { color: var(--primary); }
.small { font-size: 12px; }
.link { background: none; border: none; color: var(--primary); cursor: pointer; padding: 0; font-size: 12px; margin-left: auto; }
.chip { width: fit-content; }
.items li.log-done .title { color: var(--muted); }
/* 완료된 작업기록: 제목에만 취소선 (✓ 표시는 그대로 두어 상태를 한눈에) */
.items li.log-done .title-text { text-decoration: line-through; }
.mark { margin-right: 4px; }
.period { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.badge-period { background: var(--surface-2); border: 1px solid var(--border); color: var(--text); font-weight: 600; }
.status-row { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.status-btn { margin-left: auto; }
.badge-progress { background: var(--primary-weak); color: var(--primary); }
</style>
