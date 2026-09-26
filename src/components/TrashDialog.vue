<script setup lang="ts">
/**
 * 휴지통 창 (v1.11). 설계: docs/design/trash-restore.md
 * 최근 30일 동안 지운 일정·작업기록·다이어리를 최근 삭제 순으로 보여 주고, 골라서 되살린다.
 * 복구해도 창은 그대로 두고(여러 개 이어서 복구), 창 안의 안내 줄에서 '보러 가기'로 그 날짜로 이동한다.
 * (창 밖 알림은 모달 뒤에 있어서 키보드·화면 읽기 도구로 닿기 어렵고, 모바일에서는 목록 아래쪽 버튼을 가린다)
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { ApiError, type TrashKind } from '../api/types';
import { errorMessage, fetchTrash, projectById, requestNavigate, restoreItem, store } from '../store';
import { isYmd } from '../utils/date';
import { countByKind, deletedAtLabel, mergeTrash, trashKindLabel, type TrashEntry } from '../utils/trash';
import BaseDialog from './BaseDialog.vue';
import { tr } from '../i18n';

const emit = defineEmits<{ close: [] }>();

type Filter = 'ALL' | TrashKind;
const FILTERS: readonly Filter[] = ['ALL', 'SCHEDULE', 'WORKLOG', 'DIARY'];
const filterLabel = (f: Filter) => (f === 'ALL' ? tr.value.trash.all : trashKindLabel(f));

const loading = ref(true);
const error = ref('');
const entries = ref<TrashEntry[]>([]);
const days = ref(0);
const total = ref(0);
const truncated = ref(false);
/** 불러올 때 받은 건수 (잘렸을 때 안내용 — 복구해서 줄어도 그대로) */
const shown = ref(0);
const filter = ref<Filter>('ALL');
/** 복구 중인 줄 (한 번에 하나만 — 서버 잠금 대기와 목록 꼬임을 피하려고) */
const restoringKey = ref('');
/** 방금 복구한 항목 / 복구 실패 문구 (창 안의 안내 줄) */
const lastRestored = ref<{ entry: TrashEntry; canGo: boolean } | null>(null);
const restoreError = ref('');
const bodyEl = ref<HTMLElement | null>(null);
let loadSeq = 0;

const counts = computed(() => countByKind(entries.value));
const rows = computed(() =>
  (filter.value === 'ALL' ? entries.value : entries.value.filter((e) => e.kind === filter.value))
    .map((e) => ({ ...e, projectName: projectById(e.projectId)?.name ?? '' })),
);
const emptyMessage = computed(() =>
  filter.value === 'ALL'
    ? tr.value.trash.emptyAll(days.value)
    : tr.value.trash.emptyKind(days.value, trashKindLabel(filter.value)),
);

/** 누른 버튼이 사라지면 포커스가 창 밖(body)으로 빠져 Esc·Tab이 안 먹는다 → 창 안에 붙잡아 둔다 */
async function keepFocusInside() {
  await nextTick();
  const active = document.activeElement;
  if (!bodyEl.value || (active && active !== document.body && active.isConnected && bodyEl.value.closest('[role="dialog"]')?.contains(active))) return;
  bodyEl.value.focus();
}

async function load() {
  const seq = ++loadSeq;
  loading.value = true;
  error.value = '';
  try {
    const data = await fetchTrash();
    if (seq !== loadSeq) return;
    entries.value = mergeTrash(data);
    days.value = data.days;
    total.value = data.total;
    truncated.value = data.truncated;
    shown.value = entries.value.length;
  } catch (e) {
    if (seq !== loadSeq) return;
    entries.value = [];
    error.value = errorMessage(e);
  } finally {
    if (seq === loadSeq) {
      loading.value = false;
      void keepFocusInside();
    }
  }
}

async function restore(entry: TrashEntry) {
  if (restoringKey.value || loading.value) return;
  restoringKey.value = entry.key;
  restoreError.value = '';
  try {
    await restoreItem(entry.kind, entry.id, entry.updatedAt);
    entries.value = entries.value.filter((e) => e.key !== entry.key);
    lastRestored.value = { entry, canGo: isYmd(entry.goDate) };
  } catch (e) {
    lastRestored.value = null;
    restoreError.value = errorMessage(e);
    // 다른 곳에서 이미 복구했거나 바뀐 경우: 목록을 새로 받아 맞춘다
    if (e instanceof ApiError && (e.code === 'NOT_FOUND' || e.code === 'CONFLICT')) void load();
  } finally {
    restoringKey.value = '';
    void keepFocusInside();
  }
}

function goTo(entry: TrashEntry) {
  requestNavigate({ view: entry.kind === 'DIARY' ? 'diary' : 'calendar', date: entry.goDate });
}

// 창을 연 채로 알림의 '되돌리기'를 누르면 그 항목은 이미 복구됐다 → 목록을 다시 받는다
watch(() => store.trashRevision, () => void load());

onMounted(() => void load());
</script>

<template>
  <BaseDialog :title="tr.app.trash" width="640px" @close="emit('close')">
    <div ref="bodyEl" class="wrap" tabindex="-1">
      <div class="filters" role="group" :aria-label="tr.trash.kindFilter">
        <button
          v-for="f in FILTERS" :key="f" type="button" class="filter-btn"
          :class="{ active: filter === f }" :aria-pressed="filter === f"
          @click="filter = f"
        >{{ filterLabel(f) }} {{ counts[f] }}</button>
        <span v-if="loading" class="spinner" :aria-label="tr.app.loading" />
      </div>

      <p v-if="lastRestored" class="restored" role="status">
        <span>{{ tr.trash.restored(lastRestored.entry.kind, lastRestored.entry.title) }}</span>
        <button v-if="lastRestored.canGo" type="button" class="btn btn-sm" @click="goTo(lastRestored.entry)">{{ tr.trash.goTo }}</button>
      </p>

      <p v-if="restoreError" class="error-text" role="alert">{{ restoreError }}</p>
      <p v-if="error" class="error-text" role="alert">
        {{ error }}
        <button type="button" class="btn btn-sm" @click="load">{{ tr.app.retry }}</button>
      </p>
      <p v-if="truncated" class="notice">{{ tr.trash.truncated(total, shown) }}</p>

      <ul v-if="rows.length" class="list" :aria-label="tr.trash.listLabel">
        <li v-for="e in rows" :key="e.key" class="row" :class="'k-' + e.kind.toLowerCase()">
          <div class="info">
            <div class="line1">
              <span class="kind">{{ trashKindLabel(e.kind) }}</span>
              <span class="title">{{ e.title }}</span>
            </div>
            <div class="line2">
              <span>{{ e.when }}</span>
              <span v-if="e.projectName" class="chip">{{ e.projectName }}</span>
              <span class="deleted">{{ tr.trash.deletedAt(deletedAtLabel(e.deletedAt)) }}</span>
            </div>
          </div>
          <button
            type="button" class="btn btn-sm" :disabled="!!restoringKey || loading"
            :aria-label="tr.trash.restoreAria(trashKindLabel(e.kind), e.title)" @click="restore(e)"
          >{{ restoringKey === e.key ? tr.trash.restoring : tr.trash.restore }}</button>
        </li>
      </ul>
      <p v-else-if="!loading && !error" class="empty">{{ emptyMessage }}</p>

      <p v-if="days" class="hint foot-hint">{{ tr.trash.footHint(days) }}</p>
    </div>

    <template #footer>
      <span style="flex: 1" />
      <button type="button" class="btn" @click="emit('close')">{{ tr.common.close }}</button>
    </template>
  </BaseDialog>
</template>

<style scoped>
.wrap:focus { outline: none; }
.filters { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-bottom: 10px; }
.filter-btn {
  border: 1px solid var(--border); background: var(--surface); color: var(--text);
  border-radius: 999px; padding: 2px 10px; font-size: 12px; cursor: pointer;
}
.filter-btn:hover { background: var(--surface-2); }
.filter-btn.active { background: var(--primary); border-color: var(--primary); color: #fff; }
.filter-btn:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
.spinner {
  width: 14px; height: 14px; border-radius: 50%; margin-left: 6px;
  border: 2px solid var(--border); border-top-color: var(--primary); animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.restored {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0 0 10px;
  padding: 6px 10px; border-radius: 8px; font-size: 13px;
  background: var(--primary-weak); border: 1px solid var(--border);
}
.restored span { flex: 1; min-width: 0; word-break: break-word; }
.error-text { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.notice { margin: 0 0 10px; }
.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 56vh; overflow-y: auto; }
.row {
  display: flex; align-items: center; gap: 10px; padding: 8px 10px;
  border: 1px solid var(--border); border-left-width: 4px; border-radius: 8px; background: var(--surface);
}
.row.k-schedule { border-left-color: #2563eb; }
.row.k-worklog { border-left-color: #15803d; }
.row.k-diary { border-left-color: #b45309; }
.info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.line1 { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.kind { font-size: 11px; font-weight: 700; color: var(--muted); white-space: nowrap; }
.title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.line2 { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
.deleted { margin-left: auto; }
.empty { color: var(--muted); text-align: center; padding: 24px 0; margin: 0; }
.foot-hint { margin: 10px 0 0; }
@media (max-width: 767px) {
  .list { max-height: none; }
  .deleted { margin-left: 0; }
}
</style>
