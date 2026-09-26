<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { DigestSchedule, DigestWorklog, TodayDigest } from '../api/types';
import { errorMessage, getToday, setScheduleStatus, setWorklogStatus, toast } from '../store';
import { formatDateLabel } from '../utils/date';
import BaseDialog from './BaseDialog.vue';
import { tr } from '../i18n';

const emit = defineEmits<{ close: []; writeLog: []; openDate: [date: string] }>();

const digest = ref<TodayDigest | null>(null);
const loading = ref(true);
const error = ref('');
const pending = ref(new Set<string>());

onMounted(async () => {
  try {
    digest.value = await getToday();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
});

/** 이전 버전 서버 응답에는 진행 중 목록이 없다 → 0건으로 처리 */
const inProgress = computed(() => digest.value?.inProgress ?? []);
const inProgressTotal = computed(() => digest.value?.inProgressTotal ?? 0);

/** 진행 중 ↔ 완료 (날짜 패널의 완료 버튼과 같은 동작, 캘린더·패널에도 반영) */
async function toggleWorklogDone(w: DigestWorklog) {
  pending.value.add(w.id);
  try {
    const saved = await setWorklogStatus(w, w.status === 'DONE' ? 'IN_PROGRESS' : 'DONE');
    Object.assign(w, { status: saved.status, updatedAt: saved.updatedAt });
    toast('success', saved.status === 'DONE' ? tr.value.worklogStatus.doneToast : tr.value.worklogStatus.progressToast);
  } catch (e) {
    toast('error', errorMessage(e));
  } finally {
    pending.value.delete(w.id);
  }
}

async function toggleDone(item: DigestSchedule, ev: Event) {
  const box = ev.target as HTMLInputElement;
  pending.value.add(item.id);
  try {
    const saved = await setScheduleStatus(item, item.status === 'DONE' ? 'PLANNED' : 'DONE');
    Object.assign(item, { status: saved.status, updatedAt: saved.updatedAt });
  } catch (e) {
    box.checked = item.status === 'DONE';
    toast('error', errorMessage(e));
  } finally {
    pending.value.delete(item.id);
  }
}
</script>

<template>
  <BaseDialog :title="tr.app.todaySummary" width="520px" @close="emit('close')">
    <p v-if="loading" class="muted">{{ tr.common.loading }}</p>
    <p v-else-if="error" class="error-text">{{ error }}</p>
    <template v-else-if="digest">
      <p class="date">
        {{ formatDateLabel(digest.date) }}<span v-if="digest.holidayName" class="holiday">{{ tr.common.sep }}{{ digest.holidayName }}</span>
      </p>

      <h3>{{ tr.today.schedules }} <span class="count">{{ digest.schedules.length }}</span></h3>
      <p v-if="!digest.schedules.length" class="empty">{{ tr.day.noSchedules }}</p>
      <ul v-else class="list">
        <li v-for="s in digest.schedules" :key="s.id" :class="{ done: s.status === 'DONE' }">
          <input
            type="checkbox" :checked="s.status === 'DONE'" :disabled="pending.has(s.id)"
            :aria-label="tr.day.markDone(s.title)" @change="toggleDone(s, $event)"
          />
          <span class="time">{{ s.timeLabel }}</span>
          <span class="title">{{ s.title }}</span>
          <span v-if="s.priority === 'HIGH'" class="badge badge-high">{{ tr.common.high }}</span>
          <span v-if="s.type === 'MEETING'" class="badge badge-meeting">{{ tr.common.meeting }}</span>
          <span v-if="s.projectName" class="chip">{{ s.projectName }}</span>
        </li>
      </ul>

      <h3>{{ tr.today.meetings }} <span class="count">{{ digest.meetings.length }}</span></h3>
      <p v-if="digest.calendarError" class="notice">{{ digest.calendarError }}</p>
      <p v-else-if="!digest.meetings.length" class="empty">{{ tr.day.noMeetings }}</p>
      <ul v-else class="list">
        <li v-for="m in digest.meetings" :key="m.id">
          <span class="time">{{ m.timeLabel }}</span>
          <span class="title">{{ m.title }}</span>
          <span v-if="m.location" class="muted loc">{{ m.location }}</span>
        </li>
      </ul>

      <template v-if="digest.overdueTotal">
        <h3>{{ tr.today.overdue }} <span class="count warn">{{ digest.overdueTotal }}</span></h3>
        <ul class="list">
          <li v-for="s in digest.overdue" :key="s.id" :class="{ done: s.status === 'DONE' }">
            <input
              type="checkbox" :checked="s.status === 'DONE'" :disabled="pending.has(s.id)"
              :aria-label="tr.day.markDone(s.title)" @change="toggleDone(s, $event)"
            />
            <button type="button" class="link" @click="emit('openDate', s.endAt.slice(0, 10))">{{ s.endAt.slice(5, 10).replace('-', '/') }}</button>
            <span class="title">{{ s.title }}</span>
            <span v-if="s.projectName" class="chip">{{ s.projectName }}</span>
          </li>
        </ul>
        <p v-if="digest.overdueTotal > digest.overdue.length" class="hint">{{ tr.today.oldestShown(digest.overdue.length) }}</p>
      </template>

      <template v-if="inProgressTotal">
        <h3>{{ tr.today.inProgress }} <span class="count">{{ inProgressTotal }}</span></h3>
        <ul class="list">
          <li v-for="w in inProgress" :key="w.id" :class="{ done: w.status === 'DONE' }">
            <button type="button" class="link date-link" @click="emit('openDate', w.workDate)">{{ w.dateLabel }}</button>
            <span class="title">{{ w.title }}</span>
            <span v-if="w.projectName" class="chip">{{ w.projectName }}</span>
            <button
              type="button" class="btn btn-sm" :class="{ 'btn-primary': w.status !== 'DONE' }" :disabled="pending.has(w.id)"
              :aria-label="tr.worklogStatus.toggleAria(w.title, w.status === 'DONE')" @click="toggleWorklogDone(w)"
            >{{ pending.has(w.id) ? tr.common.processing : w.status === 'DONE' ? tr.worklogStatus.revert : tr.worklogStatus.markDone }}</button>
          </li>
        </ul>
        <p v-if="inProgressTotal > inProgress.length" class="hint">{{ tr.today.oldestShown(inProgress.length) }}</p>
      </template>
    </template>

    <template #footer>
      <span style="flex: 1" />
      <button type="button" class="btn" @click="emit('writeLog')">{{ tr.today.writeLog }}</button>
      <button type="button" class="btn btn-primary" @click="emit('close')">{{ tr.common.ok }}</button>
    </template>
  </BaseDialog>
</template>

<style scoped>
.date { margin: 0 0 8px; font-size: 18px; font-weight: 700; }
.holiday { color: var(--holiday); font-size: 14px; font-weight: 600; }
h3 { font-size: 13px; margin: 16px 0 6px; color: var(--muted); display: flex; align-items: center; gap: 6px; }
.count { font-size: 11px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 999px; padding: 0 7px; color: var(--text); }
.count.warn { color: var(--danger); border-color: var(--danger); }
.empty { margin: 0; color: var(--muted); font-size: 13px; }
.list { list-style: none; margin: 0; padding: 0; }
.list li { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.list li:last-child { border-bottom: none; }
.list li.done .title { text-decoration: line-through; color: var(--muted); }
.time { font-variant-numeric: tabular-nums; color: var(--muted); font-size: 13px; min-width: 84px; }
.title { flex: 1; min-width: 120px; }
.loc { font-size: 12px; }
.link { background: none; border: none; color: var(--primary); cursor: pointer; padding: 0; font-size: 13px; min-width: 40px; text-align: left; }
.date-link { font-variant-numeric: tabular-nums; }
</style>
