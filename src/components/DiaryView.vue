<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { Diary } from '../api/types';
import { closeDiarySearch, loadDiaryWeek, runDiarySearch, store } from '../store';
import { addDays, dayOfWeek, formatDateLabel } from '../utils/date';
import { diaryDefaultTitle, diaryWeekLabel, weekDays } from '../utils/diary';
import { snippet } from '../utils/text';
import { tr } from '../i18n';

const emit = defineEmits<{ back: []; write: [date: string]; open: [d: Diary] }>();

const keyword = ref(store.diary.search.keyword);
const days = computed(() => (store.diary.weekStart ? weekDays(store.diary.weekStart) : []));
const byDate = computed(() => new Map(store.diary.list.map((d) => [d.diaryDate, d])));
const isWeekend = (ymd: string) => [0, 6].includes(dayOfWeek(ymd));

function moveWeek(offset: number) {
  store.diary.highlight = '';
  void loadDiaryWeek(addDays(store.diary.weekStart, offset * 7));
}

function thisWeek() {
  store.diary.highlight = '';
  void loadDiaryWeek(store.today);
}

function submitSearch() {
  if (!keyword.value.trim()) {
    closeDiarySearch();
    return;
  }
  void runDiarySearch(keyword.value);
}

/** 검색 결과 → 그 주로 이동하고 날짜 카드를 강조 */
async function gotoResult(d: Diary) {
  closeDiarySearch();
  store.diary.highlight = d.diaryDate;
  await loadDiaryWeek(d.diaryDate);
}

// 강조할 날짜가 화면에 그려지면 그 카드로 스크롤
watch(
  () => [store.diary.highlight, store.diary.loading, store.diary.search.active] as const,
  async ([highlight, loading, searching]) => {
    if (!highlight || loading || searching) return;
    await nextTick();
    document.getElementById(`diary-${highlight}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  },
);
</script>

<template>
  <section class="diary" :aria-label="tr.diaryView.label">
    <header class="bar">
      <div class="nav">
        <button type="button" class="btn" @click="emit('back')">{{ tr.diaryView.back }}</button>
        <strong class="brand">{{ tr.app.diary }}</strong>
        <button type="button" class="icon-btn" :aria-label="tr.diaryView.prevWeek" @click="moveWeek(-1)">‹</button>
        <button type="button" class="btn" @click="thisWeek">{{ tr.common.thisWeek }}</button>
        <button type="button" class="icon-btn" :aria-label="tr.diaryView.nextWeek" @click="moveWeek(1)">›</button>
        <h1 class="title">{{ store.diary.weekStart ? diaryWeekLabel(store.diary.weekStart) : '' }}</h1>
        <span v-if="store.diary.loading" class="spinner" :aria-label="tr.app.loading" />
      </div>
      <form class="search" role="search" @submit.prevent="submitSearch">
        <input v-model="keyword" type="search" class="input" :placeholder="tr.diaryView.searchPlaceholder" :aria-label="tr.diaryView.searchLabel" :maxlength="store.limits?.keyword" />
        <button type="submit" class="btn">{{ tr.app.search }}</button>
      </form>
    </header>

    <!-- 검색 결과 -->
    <div v-if="store.diary.search.active" class="results">
      <header class="results-head">
        <h2>{{ tr.common.searchResultTitle(store.diary.search.keyword) }} <span v-if="store.diary.search.result" class="count">{{ store.diary.search.result.diaries.length }}</span></h2>
        <button type="button" class="btn btn-sm" @click="closeDiarySearch">{{ tr.common.close }}</button>
      </header>
      <p v-if="store.diary.search.loading" class="muted">{{ tr.common.searching }}</p>
      <p v-else-if="store.diary.search.error" class="error-text">{{ store.diary.search.error }}</p>
      <template v-else-if="store.diary.search.result">
        <p v-if="store.diary.search.result.truncated" class="notice">{{ tr.common.truncated }}</p>
        <p v-if="!store.diary.search.result.diaries.length" class="muted">{{ tr.diaryView.noMatch }}</p>
        <ul class="result-list">
          <li v-for="d in store.diary.search.result.diaries" :key="d.id">
            <button type="button" class="result" @click="gotoResult(d)">
              <span class="date" :class="{ red: isWeekend(d.diaryDate) }">{{ diaryDefaultTitle(d.diaryDate) }}</span>
              <span class="r-title">{{ d.title }}</span>
              <span class="excerpt">{{ snippet(d.content, store.diary.search.keyword) }}</span>
            </button>
          </li>
        </ul>
      </template>
    </div>

    <!-- 주 단위 -->
    <template v-else>
      <p v-if="store.diary.error" class="error-text" role="alert">{{ store.diary.error }}</p>
      <div class="week" :aria-busy="store.diary.loading">
        <article
          v-for="day in days" :id="`diary-${day}`" :key="day" class="card"
          :class="{ highlight: store.diary.highlight === day, today: store.today === day }"
        >
          <header class="card-head">
            <span class="date" :class="{ red: isWeekend(day) }">{{ formatDateLabel(day) }}</span>
            <span v-if="store.today === day" class="badge today-badge">{{ tr.app.today }}</span>
            <button v-if="byDate.get(day)" type="button" class="btn btn-sm edit" :disabled="store.diary.loading" @click="emit('open', byDate.get(day)!)">{{ tr.diaryView.edit }}</button>
            <button v-else type="button" class="btn btn-sm btn-primary edit" :disabled="store.diary.loading" @click="emit('write', day)">{{ tr.diaryView.write }}</button>
          </header>
          <template v-if="byDate.get(day)">
            <h3 class="d-title">{{ byDate.get(day)!.title }}</h3>
            <p class="d-content pre">{{ byDate.get(day)!.content }}</p>
          </template>
          <p v-else class="empty">{{ tr.diaryView.empty }}</p>
        </article>
      </div>
    </template>
  </section>
</template>

<style scoped>
.bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.nav { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.brand { font-size: 15px; margin: 0 6px; }
.title { font-size: 18px; margin: 0 0 0 8px; white-space: nowrap; }
.search { display: flex; gap: 6px; flex: 1; min-width: 220px; max-width: 420px; margin-left: auto; }
.spinner {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid var(--border); border-top-color: var(--primary); animation: spin 0.8s linear infinite; margin-left: 6px;
}
@keyframes spin { to { transform: rotate(360deg); } }

.week { display: flex; flex-direction: column; gap: 10px; max-width: 900px; margin: 0 auto; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px 16px; scroll-margin: 16px; }
.card.today { border-color: var(--primary); }
.card.highlight { box-shadow: 0 0 0 3px var(--primary-weak); border-color: var(--primary); }
.card-head { display: flex; align-items: center; gap: 8px; }
.date { font-weight: 700; font-size: 14px; }
.date.red { color: var(--holiday); }
.today-badge { background: var(--primary-weak); color: var(--primary); }
.edit { margin-left: auto; }
.d-title { margin: 8px 0 4px; font-size: 16px; word-break: break-word; }
.d-content { margin: 0; line-height: 1.7; }
.empty { margin: 6px 0 0; color: var(--muted); font-size: 13px; }

.results { max-width: 900px; margin: 0 auto; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; }
.results-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 8px; }
.results-head h2 { margin: 0; font-size: 16px; word-break: break-all; display: flex; align-items: center; gap: 6px; }
.count { font-size: 11px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 999px; padding: 0 7px; }
.result-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.result { all: unset; display: flex; flex-direction: column; gap: 3px; cursor: pointer; width: 100%; box-sizing: border-box; border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; }
.result:hover { background: var(--surface-2); }
.result:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.result .date { font-size: 12px; font-weight: 600; color: var(--primary); }
.result .date.red { color: var(--holiday); }
.r-title { font-weight: 600; word-break: break-word; }
.excerpt { font-size: 13px; color: var(--muted); word-break: break-word; }

@media (max-width: 767px) {
  .bar { gap: 8px; }
  .search { order: 3; max-width: none; min-width: 0; flex-basis: 100%; margin-left: 0; }
  .title { font-size: 15px; margin-left: 4px; white-space: normal; }
  .card { padding: 10px 12px; }
}
</style>
