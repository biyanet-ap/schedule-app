<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import type { Worklog, WorklogInput } from '../api/types';
import { deleteWorklog, errorMessage, notifyDeleted, projectById, saveWorklog, store, toast } from '../store';
import { dateSpan, isYmd, timeLabel } from '../utils/date';
import { parseTags, validateTags } from '../utils/tags';
import { defaultPeriod, isPeriodLog, monthRange, periodDays, periodError, weekRange } from '../utils/worklog';
import BaseDialog from './BaseDialog.vue';
import { tr } from '../i18n';

const props = defineProps<{ worklog?: Worklog; date: string; scheduleId?: string }>();
const emit = defineEmits<{ close: [] }>();

const editing = !!props.worklog;
const w = props.worklog;
const linkedAtOpen = w?.scheduleId ?? props.scheduleId ?? '';
const linkedSchedule = store.data.schedules.find((s) => s.id === linkedAtOpen);
/** 일정의 프로젝트를 따라갈 때는 사용 중인 프로젝트만 (사용 중지된 프로젝트는 서버가 새 지정을 거부한다) */
const activeProjectOf = (projectId: string | undefined) => (projectId && projectById(projectId)?.active ? projectId : '');

type Mode = 'DAY' | 'PERIOD';
/** 빠른 선택(이번 주·지난 주·이번 달)의 기준일: 창을 연 날짜로 고정 */
const baseDate = w?.workDate ?? props.date;
const openedAsPeriod = !!w && isPeriodLog(w);

const form = reactive({
  mode: (openedAsPeriod ? 'PERIOD' : 'DAY') as Mode,
  workDate: w?.workDate ?? props.date,
  periodStart: openedAsPeriod ? w!.workDate : '',
  periodEnd: openedAsPeriod ? w!.endDate : '',
  title: w?.title ?? linkedSchedule?.title ?? '',
  content: w?.content ?? '',
  projectId: w?.projectId ?? activeProjectOf(linkedSchedule?.projectId),
  scheduleId: linkedAtOpen,
  tagsText: (w?.tags ?? linkedSchedule?.tags ?? []).join(', '),
  done: w?.status === 'DONE',
  completeSchedule: !editing,
});

const busy = ref(false);
const error = ref('');
const confirmDelete = ref(false);
const limits = computed(() => store.limits);
const projectOptions = computed(() => store.projects.filter((p) => p.active || p.id === w?.projectId));

/** 지금 탭 기준으로 기록이 걸친 날짜 (입력이 덜 됐으면 null) */
const activeSpan = computed(() => {
  const span = form.mode === 'PERIOD' ? { start: form.periodStart, end: form.periodEnd } : { start: form.workDate, end: form.workDate };
  return isYmd(span.start) && isYmd(span.end) && span.start <= span.end ? span : null;
});
const periodDaysText = computed(() => (form.mode === 'PERIOD' && activeSpan.value ? tr.value.worklog.daysCount(periodDays(activeSpan.value.start, activeSpan.value.end)) : ''));

/** 연결 후보: 기록 날짜(기간이면 기간)와 겹치는 일정(취소 제외) + 이미 연결돼 있던 일정 */
const scheduleOptions = computed(() => {
  const span = activeSpan.value;
  const list = store.data.schedules.filter((s) => {
    if (s.status === 'CANCELLED' || !span) return false;
    const sp = dateSpan(s);
    return sp.start <= span.end && sp.end >= span.start;
  });
  if (form.scheduleId && !list.some((s) => s.id === form.scheduleId)) {
    const current = store.data.schedules.find((s) => s.id === form.scheduleId);
    if (current) list.unshift(current);
  }
  return list;
});
const selectedSchedule = computed(() => store.data.schedules.find((s) => s.id === form.scheduleId));
const canComplete = computed(() => !!selectedSchedule.value && selectedSchedule.value.status !== 'DONE');

const tags = computed(() => parseTags(form.tagsText));

// 일정을 새로 고르면 프로젝트가 비어 있을 때 일정의 프로젝트를 따라간다
watch(() => form.scheduleId, (id) => {
  const s = store.data.schedules.find((x) => x.id === id);
  if (s && !form.projectId) form.projectId = activeProjectOf(s.projectId);
});

function setPeriod(range: { start: string; end: string }) {
  form.periodStart = range.start;
  form.periodEnd = range.end;
}

function selectMode(mode: Mode) {
  form.mode = mode;
  if (mode === 'PERIOD' && !form.periodStart && !form.periodEnd) {
    // 기본값: 연결 일정이 여러 날이면 그 기간, 아니면 지금 작업일이 속한 주 (작업일은 항상 포함)
    const day = isYmd(form.workDate) ? form.workDate : baseDate;
    const s = selectedSchedule.value;
    setPeriod(defaultPeriod(day, s ? dateSpan(s) : null, limits.value?.worklogPeriodDays ?? Number.POSITIVE_INFINITY));
  }
}

/** 탭 키보드 이동 (←/→): WAI-ARIA 탭 패턴 */
function onTabKey(e: KeyboardEvent) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  const next: Mode = form.mode === 'DAY' ? 'PERIOD' : 'DAY';
  selectMode(next);
  document.getElementById(next === 'DAY' ? 'wl-tab-day' : 'wl-tab-period')?.focus();
}

function validate(): string {
  if (form.mode === 'DAY' && !isYmd(form.workDate)) return tr.value.worklog.checkWorkDate;
  if (form.mode === 'PERIOD') {
    // 최대 일수는 서버도 검사한다 (limits가 없으면 여기서는 건너뜀)
    const message = periodError(form.periodStart, form.periodEnd, limits.value?.worklogPeriodDays ?? Number.POSITIVE_INFINITY);
    if (message) return message;
  }
  if (!form.title.trim()) return tr.value.worklog.titleRequired;
  return validateTags(tags.value, limits.value);
}

async function submit() {
  error.value = validate();
  if (error.value) return;
  const input: WorklogInput = {
    id: w?.id,
    updatedAt: w?.updatedAt,
    workDate: form.mode === 'PERIOD' ? form.periodStart : form.workDate,
    endDate: form.mode === 'PERIOD' ? form.periodEnd : '',
    title: form.title,
    content: form.content,
    projectId: form.projectId,
    scheduleId: form.scheduleId,
    tags: tags.value,
    status: form.done ? 'DONE' : 'IN_PROGRESS',
    completeSchedule: canComplete.value && form.completeSchedule,
  };
  busy.value = true;
  try {
    const res = await saveWorklog(input);
    const t = tr.value.worklog;
    toast('success', (editing ? t.updated : t.created) + (res.completedSchedule ? tr.value.common.sentenceSep + t.scheduleCompleted : ''));
    emit('close');
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

async function remove() {
  if (!w) return;
  if (!confirmDelete.value) {
    confirmDelete.value = true;
    return;
  }
  busy.value = true;
  try {
    notifyDeleted('WORKLOG', await deleteWorklog(w));
    emit('close');
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <BaseDialog :title="editing ? tr.worklog.titleEdit : tr.worklog.titleNew" width="640px" :busy="busy" @close="emit('close')">
    <form id="worklog-form" @submit.prevent="submit">
      <div class="tabs" role="tablist" :aria-label="tr.worklog.unit">
        <button
          id="wl-tab-day" type="button" role="tab" class="tab" :class="{ active: form.mode === 'DAY' }"
          :aria-selected="form.mode === 'DAY'" aria-controls="wl-date-panel" :tabindex="form.mode === 'DAY' ? 0 : -1"
          @click="selectMode('DAY')" @keydown="onTabKey"
        >{{ tr.worklog.dayTab }}</button>
        <button
          id="wl-tab-period" type="button" role="tab" class="tab" :class="{ active: form.mode === 'PERIOD' }"
          :aria-selected="form.mode === 'PERIOD'" aria-controls="wl-date-panel" :tabindex="form.mode === 'PERIOD' ? 0 : -1"
          @click="selectMode('PERIOD')" @keydown="onTabKey"
        >{{ tr.worklog.periodTab }}</button>
      </div>

      <div id="wl-date-panel" role="tabpanel" :aria-labelledby="form.mode === 'DAY' ? 'wl-tab-day' : 'wl-tab-period'">
        <div class="field-row date-row">
          <div v-if="form.mode === 'DAY'" class="field date-field">
            <label for="wl-date">{{ tr.worklog.workDate }}</label>
            <input id="wl-date" v-model="form.workDate" type="date" class="input" />
          </div>
          <template v-else>
            <div class="field date-field">
              <label for="wl-start">{{ tr.common.startDate }}</label>
              <input id="wl-start" v-model="form.periodStart" type="date" class="input" />
            </div>
            <div class="field date-field">
              <label for="wl-end">{{ tr.common.endDate }}</label>
              <input id="wl-end" v-model="form.periodEnd" type="date" class="input" :min="form.periodStart || undefined" />
            </div>
          </template>
          <div class="field project-field">
            <label for="wl-project">{{ tr.common.project }}</label>
            <select id="wl-project" v-model="form.projectId" class="input">
              <option value="">{{ tr.common.none }}</option>
              <option v-for="p in projectOptions" :key="p.id" :value="p.id">{{ p.name }}{{ p.active ? '' : tr.common.inactiveSuffix }}</option>
            </select>
          </div>
        </div>
        <div v-if="form.mode === 'PERIOD'" class="quick" :aria-label="tr.worklog.quickPick">
          <button type="button" class="btn btn-sm" @click="setPeriod(weekRange(baseDate, 0))">{{ tr.common.thisWeek }}</button>
          <button type="button" class="btn btn-sm" @click="setPeriod(weekRange(baseDate, -1))">{{ tr.common.lastWeek }}</button>
          <button type="button" class="btn btn-sm" @click="setPeriod(monthRange(baseDate))">{{ tr.common.thisMonth }}</button>
          <span class="hint">{{ tr.worklog.weekHint }}</span>
          <strong v-if="periodDaysText" class="days" aria-live="polite">{{ periodDaysText }}</strong>
        </div>
      </div>

      <div class="field">
        <label for="wl-title">{{ tr.worklog.title }}</label>
        <input
          id="wl-title" v-model="form.title" class="input" autofocus :maxlength="limits?.title"
          :placeholder="form.mode === 'PERIOD' ? tr.worklog.periodTitlePlaceholder : tr.worklog.dayTitlePlaceholder"
        />
      </div>

      <div class="field">
        <label for="wl-content">{{ tr.common.content }}</label>
        <textarea id="wl-content" v-model="form.content" class="input" rows="9" :maxlength="limits?.content" :placeholder="tr.worklog.contentPlaceholder" />
      </div>

      <div class="field">
        <label for="wl-schedule">{{ tr.worklog.linkedSchedule }}</label>
        <select id="wl-schedule" v-model="form.scheduleId" class="input">
          <option value="">{{ tr.worklog.noLink }}</option>
          <option v-for="s in scheduleOptions" :key="s.id" :value="s.id">
            [{{ timeLabel(s) }}] {{ s.title }}{{ s.status === 'DONE' ? ' ✓' : '' }}
          </option>
        </select>
        <label v-if="canComplete" class="check">
          <input v-model="form.completeSchedule" type="checkbox" /> {{ tr.worklog.completeSchedule }}
        </label>
      </div>

      <div class="field">
        <label for="wl-tags">{{ tr.common.tags }}</label>
        <input id="wl-tags" v-model="form.tagsText" class="input" :placeholder="tr.worklog.tagsPlaceholder" />
        <div v-if="tags.length" class="tags">
          <span v-for="t in tags" :key="t" class="chip">#{{ t }}</span>
        </div>
      </div>

      <label class="check done-check">
        <input v-model="form.done" type="checkbox" /> <strong>{{ tr.worklog.markDone }}</strong>
        <span class="hint">{{ tr.worklog.markDoneHint }}</span>
      </label>

      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
    </form>

    <template #footer>
      <button v-if="editing" type="button" class="btn btn-danger" :class="{ confirm: confirmDelete }" :disabled="busy" @click="remove">
        {{ confirmDelete ? tr.common.deleteConfirm : tr.common.delete }}
      </button>
      <span style="flex: 1" />
      <button type="button" class="btn" :disabled="busy" @click="emit('close')">{{ tr.common.cancel }}</button>
      <button type="submit" form="worklog-form" class="btn btn-primary" :disabled="busy">{{ busy ? tr.common.saving : tr.common.save }}</button>
    </template>
  </BaseDialog>
</template>

<style scoped>
.check { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; margin-top: 6px; cursor: pointer; }
.tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.done-check { margin: 0 0 12px; font-size: 14px; }
.tabs { display: flex; gap: 4px; margin-bottom: 12px; border-bottom: 1px solid var(--border); }
.tab {
  background: none; border: none; border-bottom: 2px solid transparent; margin-bottom: -1px;
  padding: 6px 12px; font-size: 14px; font-weight: 600; color: var(--muted); cursor: pointer;
}
.tab.active { color: var(--primary); border-bottom-color: var(--primary); }
.tab:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; border-radius: 4px; }
.date-row { flex-wrap: wrap; }
.date-row > .date-field { flex: 0 0 150px; }
.date-row > .project-field { flex: 1 1 180px; }
.quick { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: -4px 0 12px; }
.days { margin-left: auto; font-size: 13px; color: var(--primary); }
</style>
