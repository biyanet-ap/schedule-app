<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import type { Priority, Schedule, ScheduleInput, ScheduleStatus, ScheduleType } from '../api/types';
import { deleteSchedule, errorMessage, notifyDeleted, saveSchedule, store, toast } from '../store';
import { addDays, addMinutesToTime, datePart, defaultStartTime, isYmd, timePart } from '../utils/date';
import { safeHttpUrl } from '../utils/events';
import { parseTags, validateTags } from '../utils/tags';
import BaseDialog from './BaseDialog.vue';
import { tr } from '../i18n';

const props = defineProps<{ schedule?: Schedule; date: string }>();
const emit = defineEmits<{ close: [] }>();

const editing = !!props.schedule;
const s = props.schedule;
const initialStart = defaultStartTime(props.date, store.today);
const initialEnd = addMinutesToTime(initialStart, 60);

const form = reactive({
  type: (s?.type ?? 'TASK') as ScheduleType,
  title: s?.title ?? '',
  description: s?.description ?? '',
  allDay: s?.allDay ?? false,
  startDate: s ? datePart(s.startAt) : props.date,
  startTime: s && !s.allDay ? timePart(s.startAt) : initialStart,
  endDate: s ? datePart(s.endAt) : addDays(props.date, initialEnd.dayOffset),
  endTime: s && !s.allDay ? timePart(s.endAt) : initialEnd.time,
  priority: (s?.priority ?? 'MEDIUM') as Priority,
  projectId: s?.projectId ?? '',
  location: s?.location ?? '',
  status: (s?.status ?? 'PLANNED') as ScheduleStatus,
  tagsText: (s?.tags ?? []).join(', '),
});

const busy = ref(false);
const error = ref('');
const confirmDelete = ref(false);
const limits = computed(() => store.limits);

/** 사용 중지된 프로젝트는 이미 지정된 경우에만 목록에 남긴다 */
const projectOptions = computed(() => store.projects.filter((p) => p.active || p.id === s?.projectId));
const locationUrl = computed(() => safeHttpUrl(form.location));
const tags = computed(() => parseTags(form.tagsText));

function onStartDateChange() {
  if (form.endDate < form.startDate) form.endDate = form.startDate;
}

function validate(): string {
  const t = tr.value.schedule;
  if (!form.title.trim()) return t.titleRequired;
  if (!isYmd(form.startDate) || !isYmd(form.endDate)) return t.checkDate;
  if (!form.allDay && (!form.startTime || !form.endTime)) return t.timeRequired;
  const start = form.allDay ? form.startDate : `${form.startDate}T${form.startTime}`;
  const end = form.allDay ? form.endDate : `${form.endDate}T${form.endTime}`;
  if (end < start) return t.endBeforeStart;
  if (form.location.includes('://') && !locationUrl.value) return tr.value.common.linkScheme;
  return validateTags(tags.value, limits.value);
}

async function submit() {
  error.value = validate();
  if (error.value) return;
  const input: ScheduleInput = {
    id: s?.id,
    updatedAt: s?.updatedAt,
    type: form.type,
    title: form.title,
    description: form.description,
    allDay: form.allDay,
    startAt: form.allDay ? form.startDate : `${form.startDate}T${form.startTime}`,
    endAt: form.allDay ? form.endDate : `${form.endDate}T${form.endTime}`,
    priority: form.priority,
    projectId: form.projectId,
    location: form.location,
    status: form.status,
    tags: tags.value,
  };
  busy.value = true;
  try {
    await saveSchedule(input);
    toast('success', editing ? tr.value.schedule.updated : tr.value.schedule.created);
    emit('close');
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

async function remove() {
  if (!s) return;
  if (!confirmDelete.value) {
    confirmDelete.value = true;
    return;
  }
  busy.value = true;
  try {
    notifyDeleted('SCHEDULE', await deleteSchedule(s));
    emit('close');
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <BaseDialog :title="editing ? tr.schedule.titleEdit : tr.schedule.titleNew" :busy="busy" @close="emit('close')">
    <form id="schedule-form" @submit.prevent="submit">
      <div class="field">
        <span class="field-label">{{ tr.schedule.type }}</span>
        <div class="seg" role="radiogroup" :aria-label="tr.schedule.type">
          <label :class="{ on: form.type === 'TASK' }"><input v-model="form.type" type="radio" value="TASK" class="sr-only" />{{ tr.common.task }}</label>
          <label :class="{ on: form.type === 'MEETING' }"><input v-model="form.type" type="radio" value="MEETING" class="sr-only" />{{ tr.common.meeting }}</label>
        </div>
      </div>

      <div class="field">
        <label for="sc-title">{{ tr.schedule.title }}</label>
        <input id="sc-title" v-model="form.title" class="input" autofocus :maxlength="limits?.title" :placeholder="tr.schedule.titlePlaceholder" />
      </div>

      <label class="check"><input v-model="form.allDay" type="checkbox" /> {{ tr.common.allDay }}</label>

      <div class="field">
        <span class="field-label">{{ tr.schedule.start }}</span>
        <div class="field-row">
          <input v-model="form.startDate" type="date" class="input" :aria-label="tr.schedule.startDate" @change="onStartDateChange" />
          <input v-if="!form.allDay" v-model="form.startTime" type="time" step="300" class="input" :aria-label="tr.schedule.startTime" />
        </div>
      </div>
      <div class="field">
        <span class="field-label">{{ tr.schedule.end }}</span>
        <div class="field-row">
          <input v-model="form.endDate" type="date" class="input" :aria-label="tr.schedule.endDate" :min="form.startDate" />
          <input v-if="!form.allDay" v-model="form.endTime" type="time" step="300" class="input" :aria-label="tr.schedule.endTime" />
        </div>
      </div>

      <div class="field-row">
        <div class="field">
          <label for="sc-priority">{{ tr.schedule.priority }}</label>
          <select id="sc-priority" v-model="form.priority" class="input">
            <option value="HIGH">{{ tr.schedule.priorityHigh }}</option>
            <option value="MEDIUM">{{ tr.schedule.priorityMedium }}</option>
            <option value="LOW">{{ tr.schedule.priorityLow }}</option>
          </select>
        </div>
        <div class="field">
          <label for="sc-project">{{ tr.common.project }}</label>
          <select id="sc-project" v-model="form.projectId" class="input">
            <option value="">{{ tr.common.none }}</option>
            <option v-for="p in projectOptions" :key="p.id" :value="p.id">{{ p.name }}{{ p.active ? '' : tr.common.inactiveSuffix }}</option>
          </select>
        </div>
        <div v-if="editing" class="field">
          <label for="sc-status">{{ tr.schedule.status }}</label>
          <select id="sc-status" v-model="form.status" class="input">
            <option value="PLANNED">{{ tr.schedule.statusPlanned }}</option>
            <option value="DONE">{{ tr.schedule.statusDone }}</option>
            <option value="CANCELLED">{{ tr.schedule.statusCancelled }}</option>
          </select>
        </div>
      </div>

      <div class="field">
        <label for="sc-tags">{{ tr.common.tags }}</label>
        <input id="sc-tags" v-model="form.tagsText" class="input" :placeholder="tr.schedule.tagsPlaceholder" />
        <div v-if="tags.length" class="tags">
          <span v-for="t in tags" :key="t" class="chip">#{{ t }}</span>
        </div>
      </div>

      <div class="field">
        <label for="sc-location">{{ tr.schedule.location }}</label>
        <input id="sc-location" v-model="form.location" class="input" :maxlength="limits?.location" :placeholder="tr.schedule.locationPlaceholder" />
        <a v-if="locationUrl" :href="locationUrl" target="_blank" rel="noopener noreferrer" class="hint">{{ tr.schedule.openLink }}</a>
      </div>

      <div class="field">
        <label for="sc-desc">{{ tr.common.content }}</label>
        <textarea id="sc-desc" v-model="form.description" class="input" rows="4" :maxlength="limits?.description" />
      </div>

      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
    </form>

    <template #footer>
      <button v-if="editing" type="button" class="btn btn-danger" :class="{ confirm: confirmDelete }" :disabled="busy" @click="remove">
        {{ confirmDelete ? tr.common.deleteConfirm : tr.common.delete }}
      </button>
      <span style="flex: 1" />
      <button type="button" class="btn" :disabled="busy" @click="emit('close')">{{ tr.common.cancel }}</button>
      <button type="submit" form="schedule-form" class="btn btn-primary" :disabled="busy">{{ busy ? tr.common.saving : tr.common.save }}</button>
    </template>
  </BaseDialog>
</template>

<style scoped>
.seg { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; width: fit-content; }
.seg label { padding: 6px 16px; cursor: pointer; font-size: 13px; }
.seg label.on { background: var(--primary); color: #fff; }
.seg label:has(input:focus-visible) { outline: 2px solid var(--primary); outline-offset: -2px; }
.check { display: inline-flex; align-items: center; gap: 6px; margin-bottom: 12px; cursor: pointer; }
.tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
</style>
