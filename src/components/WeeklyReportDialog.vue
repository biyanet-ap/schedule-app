<script lang="ts">
/** 같은 접속 중에는 「내용 포함」 선택을 기억한다. 앱을 다시 열면 켜짐 (v1.16) */
const remembered = { includeContent: true };
</script>

<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue';
import type { RangeData } from '../api/types';
import { errorMessage, fetchRange, store, toast } from '../store';
import { addDays, mondayOf } from '../utils/date';
import { buildWeeklyReport, reportWeekLabel, type WeeklyReportCounts } from '../utils/weeklyReport';
import BaseDialog from './BaseDialog.vue';
import { tr } from '../i18n';

const emit = defineEmits<{ close: [] }>();

/** 보고 주 월요일 (월~금) */
const weekStart = ref(mondayOf(store.today));
const loading = ref(false);
const error = ref('');
/** 자동으로 만든 글 / 입력칸의 글 (사용자가 고칠 수 있음) */
const generated = ref('');
const text = ref('');
const counts = ref<WeeklyReportCounts | null>(null);
/** 작업기록 내용을 타이틀 아래에 넣을지 (v1.16) */
const includeContent = ref(remembered.includeContent);
/**
 * 마지막으로 받은 주의 데이터 — 「내용 포함」을 바꿀 때 서버를 다시 부르지 않고 글만 다시 만든다.
 * 받은 주(monday)와 그때의 오늘(today)을 함께 묶어, 주 이동 중이거나 자정이 지나도 그 주 그대로 다시 만든다.
 */
const lastLoad = shallowRef<{ monday: string; today: string; data: Pick<RangeData, 'worklogs' | 'schedules'> } | null>(null);
const contentBox = ref<HTMLInputElement | null>(null);
/** 고친 내용이 있는데 주를 옮기려 할 때, 옮길 대상 월요일 */
const pendingWeek = ref('');
/** 고친 내용이 있는데 「내용 포함」을 바꾸려 할 때, 바꿀 값 (null = 확인 대기 없음) */
const pendingContent = ref<boolean | null>(null);
const textarea = ref<HTMLTextAreaElement | null>(null);

const edited = computed(() => text.value !== generated.value);
let loadSeq = 0;

/** 받아 둔 데이터로 글을 다시 만든다 (입력칸의 고친 내용은 버려진다) */
function rebuild() {
  const last = lastLoad.value;
  if (!last) return;
  const report = buildWeeklyReport(last.data, store.projects, last.monday, last.today, { includeContent: includeContent.value });
  generated.value = report.text;
  text.value = report.text;
  counts.value = report.counts;
}

async function load(monday: string) {
  const seq = ++loadSeq;
  weekStart.value = monday;
  pendingWeek.value = '';
  pendingContent.value = null;
  lastLoad.value = null;
  loading.value = true;
  error.value = '';
  try {
    // 그 주 월요일 ~ 다음 주 금요일 (다음 주 예정까지)
    const today = store.today;
    const data = await fetchRange(monday, addDays(monday, 11));
    if (seq !== loadSeq) return;
    lastLoad.value = { monday, today, data };
    rebuild();
  } catch (e) {
    if (seq !== loadSeq) return;
    error.value = errorMessage(e);
    generated.value = '';
    text.value = '';
    counts.value = null;
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

/** 고친 내용이 있으면 한 번 확인한 뒤 옮긴다 */
function moveTo(monday: string) {
  if (monday === weekStart.value && !edited.value) return;
  if (edited.value) {
    pendingContent.value = null;
    pendingWeek.value = monday;
    return;
  }
  void load(monday);
}

function applyContent(value: boolean) {
  includeContent.value = value;
  remembered.includeContent = value;
  pendingContent.value = null;
  rebuild();
  contentBox.value?.focus();
}

function cancelContent() {
  pendingContent.value = null;
  contentBox.value?.focus();
}

/** 「내용 포함」 체크 상자: 고친 내용이 있으면 체크를 되돌려 두고 한 번 확인한다 */
function onContentToggle(e: Event) {
  const box = e.target as HTMLInputElement;
  const want = box.checked;
  if (edited.value) {
    box.checked = includeContent.value;
    pendingWeek.value = '';
    pendingContent.value = want;
    return;
  }
  applyContent(want);
}

function regenerate() {
  text.value = generated.value;
  pendingWeek.value = '';
  pendingContent.value = null;
}

/** 1) 클립보드 API → 2) 선택 후 복사 명령 → 3) 선택해 두고 Ctrl+C 안내 (Apps Script iframe에서 1이 막힐 수 있음) */
async function copy() {
  try {
    await navigator.clipboard.writeText(text.value);
    toast('success', tr.value.weekly.copied);
    return;
  } catch {
    // 아래 방법으로 다시 시도
  }
  const el = textarea.value;
  el?.focus();
  el?.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  if (copied) toast('success', tr.value.weekly.copied);
  else toast('info', tr.value.weekly.selectedForCopy);
}

onMounted(() => void load(weekStart.value));
</script>

<template>
  <BaseDialog :title="tr.weekly.title" width="760px" :busy="false" @close="emit('close')">
    <div class="bar">
      <button type="button" class="icon-btn" :aria-label="tr.diaryView.prevWeek" :disabled="loading" @click="moveTo(addDays(weekStart, -7))">‹</button>
      <button type="button" class="btn btn-sm" :disabled="loading" @click="moveTo(mondayOf(store.today))">{{ tr.common.thisWeek }}</button>
      <button type="button" class="icon-btn" :aria-label="tr.diaryView.nextWeek" :disabled="loading" @click="moveTo(addDays(weekStart, 7))">›</button>
      <strong class="week">{{ reportWeekLabel(weekStart) }}</strong>
      <span v-if="loading" class="spinner" :aria-label="tr.app.loading" />
      <label class="content-toggle">
        <input ref="contentBox" type="checkbox" :checked="includeContent" :disabled="loading" @change="onContentToggle">
        {{ tr.weekly.includeContent }}
      </label>
    </div>

    <div v-if="pendingWeek" class="notice confirm-bar" role="alert">
      {{ tr.weekly.editedWarn }}
      <span class="confirm-actions">
        <button type="button" class="btn btn-sm btn-danger" @click="load(pendingWeek)">{{ tr.weekly.discardMove }}</button>
        <button type="button" class="btn btn-sm" @click="pendingWeek = ''">{{ tr.common.cancel }}</button>
      </span>
    </div>
    <div v-else-if="pendingContent !== null" class="notice confirm-bar" role="alert">
      {{ tr.weekly.editedWarnRebuild }}
      <span class="confirm-actions">
        <button type="button" class="btn btn-sm btn-danger" @click="applyContent(pendingContent)">{{ tr.weekly.discardRebuild }}</button>
        <button type="button" class="btn btn-sm" @click="cancelContent">{{ tr.common.cancel }}</button>
      </span>
    </div>

    <p v-if="counts" class="summary" :aria-label="tr.weekly.summary">
      <span class="chip">{{ tr.common.done }} {{ counts.done }}</span>
      <span class="chip">{{ tr.common.inProgress }} {{ counts.inProgress }}</span>
      <span class="chip" :class="{ warn: counts.overdue > 0 }">{{ tr.weekly.overdue }} {{ counts.overdue }}</span>
      <span class="chip">{{ tr.weekly.nextWeek }} {{ counts.nextWeek }}</span>
      <span class="hint">{{ tr.weekly.hint }}</span>
    </p>
    <p v-if="error" class="error-text" role="alert">{{ error }}</p>

    <label for="wr-text" class="sr-only">{{ tr.weekly.textLabel }}</label>
    <textarea
      id="wr-text" ref="textarea" v-model="text" class="input report" rows="20" spellcheck="false"
      :readonly="loading" :aria-busy="loading"
    />

    <template #footer>
      <button type="button" class="btn" :disabled="!edited || loading" @click="regenerate">{{ tr.weekly.regenerate }}</button>
      <span style="flex: 1" />
      <button type="button" class="btn" @click="emit('close')">{{ tr.common.close }}</button>
      <button type="button" class="btn btn-primary" :disabled="loading || !text" @click="copy">{{ tr.weekly.copy }}</button>
    </template>
  </BaseDialog>
</template>

<style scoped>
.bar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
.week { font-size: 15px; margin-left: 6px; }
.content-toggle { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; font-size: 13.5px; cursor: pointer; white-space: nowrap; }
.content-toggle input { width: 16px; height: 16px; margin: 0; cursor: pointer; }
.content-toggle:has(input:disabled) { opacity: 0.5; cursor: default; }
.content-toggle:has(input:disabled) input { cursor: default; }
.spinner {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid var(--border); border-top-color: var(--primary); animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.confirm-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.confirm-actions { display: inline-flex; gap: 6px; margin-left: auto; }
.summary { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0 0 10px; }
.summary .warn { color: var(--danger); border-color: var(--danger); }
.summary .hint { margin-left: 4px; }
/* v1.16: 내용의 긴 문장도 가로 스크롤 없이 보이게 접는다 (복사되는 글은 그대로) */
.report { font-size: 13.5px; line-height: 1.6; min-height: 360px; white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-width: 767px) {
  .report { min-height: 50vh; }
}
</style>
