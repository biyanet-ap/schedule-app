<script setup lang="ts">
import { computed, reactive } from 'vue';
import type { Schedule, Worklog } from '../api/types';
import { closeSearch, currentSearchRange, projectById, setSearchPeriod, store } from '../store';
import { datePart, formatDateLabel, timeLabel } from '../utils/date';
import { periodText, SEARCH_PERIOD_OPTIONS, type SearchPeriodKind } from '../utils/searchPeriod';
import { snippet } from '../utils/text';
import { tr } from '../i18n';

const emit = defineEmits<{ openWorklog: [w: Worklog]; openSchedule: [s: Schedule]; gotoDate: [date: string] }>();

const statusLabel = (status: string) => ({
  PLANNED: tr.value.schedule.statusPlanned,
  DONE: tr.value.schedule.statusDone,
  CANCELLED: tr.value.schedule.statusCancelled,
}[status] ?? status);

const range = computed(() => currentSearchRange());
const rangeLabel = computed(() => periodText(range.value));
/** '직접 지정' 입력칸 (적용 버튼을 눌러야 검색) */
const draft = reactive({ ...store.search.period.custom });

function choose(kind: SearchPeriodKind) {
  if (kind === 'CUSTOM') {
    // 지금 보고 있는 기간을 그대로 입력칸에 채워 두고 바꾸게 한다 (결과는 그대로라 화면과 기간이 어긋나지 않음)
    Object.assign(draft, range.value);
    setSearchPeriod('CUSTOM', { ...range.value }, false);
    return;
  }
  setSearchPeriod(kind);
}

function applyCustom() {
  setSearchPeriod('CUSTOM', { from: draft.from, to: draft.to });
}
</script>

<template>
  <aside class="panel" :aria-label="tr.search.label">
    <header class="head">
      <h2>{{ tr.common.searchResultTitle(store.search.keyword) }}</h2>
      <button type="button" class="btn btn-sm" @click="closeSearch">{{ tr.common.close }}</button>
    </header>
    <p v-if="store.filter.projectId" class="hint">{{ tr.search.projectFilter(projectById(store.filter.projectId)?.name ?? '') }}</p>

    <div class="period" role="group" :aria-label="tr.search.periodGroup">
      <span class="period-label">{{ tr.search.period }}</span>
      <button
        v-for="o in SEARCH_PERIOD_OPTIONS" :key="o.kind" type="button" class="period-btn"
        :class="{ active: store.search.period.kind === o.kind }" :aria-pressed="store.search.period.kind === o.kind"
        @click="choose(o.kind)"
      >{{ tr.searchPeriod[o.kind] }}</button>
    </div>
    <form v-if="store.search.period.kind === 'CUSTOM'" class="custom" novalidate @submit.prevent="applyCustom">
      <input v-model="draft.from" type="date" class="input" :aria-label="tr.search.from" />
      <span>{{ tr.date.timeSep }}</span>
      <input v-model="draft.to" type="date" class="input" :aria-label="tr.search.to" :min="draft.from || undefined" />
      <button type="submit" class="btn btn-sm btn-primary">{{ tr.search.apply }}</button>
    </form>
    <p v-if="rangeLabel" class="hint range">{{ tr.search.rangeLabel(rangeLabel) }}</p>

    <p v-if="store.search.loading" class="muted">{{ tr.common.searching }}</p>
    <p v-else-if="store.search.error" class="error-text">{{ store.search.error }}</p>
    <template v-else-if="store.search.result">
      <p v-if="store.search.result.truncated" class="notice">{{ tr.search.truncatedEach }}</p>

      <h3>{{ tr.common.worklog }} <span class="count">{{ store.search.result.worklogs.length }}</span></h3>
      <p v-if="!store.search.result.worklogs.length" class="empty">{{ tr.search.noWorklogs }}</p>
      <ul class="items">
        <li v-for="w in store.search.result.worklogs" :key="w.id">
          <button type="button" class="date-link" @click="emit('gotoDate', w.workDate)">
            {{ formatDateLabel(w.workDate) }}<template v-if="w.endDate">{{ tr.date.rangeSep }}{{ formatDateLabel(w.endDate) }}</template>
          </button>
          <button type="button" class="item" @click="emit('openWorklog', w)">
            <span class="title">{{ w.status === 'DONE' ? '✓' : '✎' }} {{ w.title }}</span>
            <span v-if="w.content" class="excerpt">{{ snippet(w.content, store.search.keyword) }}</span>
            <span class="meta">
              <span class="chip">{{ w.status === 'DONE' ? tr.common.done : tr.common.inProgress }}</span>
              <span v-if="projectById(w.projectId)" class="chip">{{ projectById(w.projectId)?.name }}</span>
              <span v-for="t in w.tags" :key="t" class="chip">#{{ t }}</span>
            </span>
          </button>
        </li>
      </ul>

      <h3>{{ tr.day.schedules }} <span class="count">{{ store.search.result.schedules.length }}</span></h3>
      <p v-if="!store.search.result.schedules.length" class="empty">{{ tr.search.noSchedules }}</p>
      <ul class="items">
        <li v-for="s in store.search.result.schedules" :key="s.id">
          <button type="button" class="date-link" @click="emit('gotoDate', datePart(s.startAt))">
            {{ formatDateLabel(datePart(s.startAt)) }}{{ tr.common.sep }}{{ timeLabel(s) }}
          </button>
          <button type="button" class="item" @click="emit('openSchedule', s)">
            <span class="title">{{ s.title }}</span>
            <span class="meta">
              <span class="chip">{{ s.type === 'MEETING' ? tr.common.meeting : tr.common.task }}</span>
              <span class="chip">{{ statusLabel(s.status) }}</span>
              <span v-if="projectById(s.projectId)" class="chip">{{ projectById(s.projectId)?.name }}</span>
              <span v-for="t in s.tags" :key="t" class="chip">#{{ t }}</span>
            </span>
          </button>
        </li>
      </ul>
    </template>
  </aside>
</template>

<style scoped>
.panel { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; }
.head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.head h2 { margin: 0; font-size: 16px; word-break: break-all; }
h3 { font-size: 12px; color: var(--muted); margin: 16px 0 6px; display: flex; align-items: center; gap: 6px; }
.count { font-size: 11px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 999px; padding: 0 7px; color: var(--text); }
.empty { margin: 0; color: var(--muted); font-size: 13px; }
.items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.items li { border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; display: flex; flex-direction: column; gap: 4px; }
.date-link { all: unset; font-size: 12px; color: var(--primary); cursor: pointer; width: fit-content; }
.item { all: unset; display: flex; flex-direction: column; gap: 3px; cursor: pointer; }
.item:focus-visible, .date-link:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; border-radius: 4px; }
.title { font-weight: 600; word-break: break-word; }
.excerpt { font-size: 13px; color: var(--muted); word-break: break-word; }
.meta { display: flex; flex-wrap: wrap; gap: 4px; }
.period { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 10px; }
.period-label { font-size: 12px; font-weight: 600; color: var(--muted); margin-right: 2px; }
.period-btn {
  border: 1px solid var(--border); background: var(--surface); color: var(--text);
  border-radius: 999px; padding: 2px 10px; font-size: 12px; cursor: pointer;
}
.period-btn:hover { background: var(--surface-2); }
.period-btn.active { background: var(--primary); border-color: var(--primary); color: #fff; }
.period-btn:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
.custom { display: flex; align-items: center; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.custom .input { flex: 1 1 130px; min-width: 0; height: 32px; }
.range { margin: 8px 0 0; }
</style>
