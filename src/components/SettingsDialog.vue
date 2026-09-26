<script setup lang="ts">
/**
 * 설정 창 (v1.12). 설계: docs/design/settings.md, 언어는 docs/design/i18n.md (v1.13)
 * 탭: [일반] 언어·알림·백업 폼 + 예약 작업 상태 + 테스트 메일 + 최근 기록 / [프로젝트] 프로젝트 관리
 * 일반 탭은 '저장' 버튼으로 한 번에 저장한다. 저장하지 않은 변경이 있으면 닫기·탭 이동 전에 창 안에서 확인한다.
 * 언어는 저장하면 바로 바뀐다 (내부 탭 id는 예전 이름 'notify' 그대로).
 */
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import { ApiError, type AppSettings, type NotifyLogRow, type SettingsView } from '../api/types';
import { errorMessage, fetchSettings, repairTriggers, saveAppSettings, sendTestDigest, toast } from '../store';
import { backupSpanLabel, notifyLogLine, triggerStatus } from '../utils/notifyLog';
import BaseDialog from './BaseDialog.vue';
import ProjectManager from './ProjectManager.vue';
import { browserLang, LANG_NAMES, tr, type Lang } from '../i18n';

const emit = defineEmits<{ close: [] }>();

type Tab = 'notify' | 'projects';

const tab = ref<Tab>('notify');
const loading = ref(true);
const loadError = ref('');
const saving = ref(false);
const testing = ref(false);
const repairing = ref(false);
const projectBusy = ref(false);
const saveError = ref('');
const saveConflict = ref(false);

/** 서버에 저장된 값 / 입력 중인 값 */
const saved = ref<AppSettings | null>(null);
const form = reactive<AppSettings>({
  notifyEnabled: true, skipHolidays: true, notifyWhenEmpty: true, todayPopup: true, digestHour: 7, backupKeep: 8, language: 'auto',
});
/** 이 브라우저의 언어 ('자동'을 고르면 쓰이는 언어) */
const detectedLang: Lang = browserLang();
/** 설정 잠금 값: 폼을 불러온 시점의 값 (상태만 새로 받을 때는 바꾸지 않는다) */
const baseUpdatedAt = ref('');
const digestHours = ref<number[]>([]);
/** 서버 한도 (불러오기 전에는 서버 기본값과 같은 값) */
const limits = ref({ backupKeepMax: 100, testMailPerDay: 5 });
const triggers = ref({ digest: 0, backup: 0 });
const recentLog = ref<NotifyLogRow[]>([]);
/** 저장하지 않은 변경이 있을 때 확인 중인 동작 */
const pending = ref<{ action: 'close' } | { action: 'tab'; tab: Tab } | null>(null);

const FIELDS: ReadonlyArray<keyof AppSettings> = ['notifyEnabled', 'skipHolidays', 'notifyWhenEmpty', 'todayPopup', 'digestHour', 'backupKeep', 'language'];
const dirty = computed(() => !!saved.value && FIELDS.some((k) => form[k] !== saved.value![k]));
const keepError = computed(() => {
  const n = form.backupKeep;
  const max = limits.value.backupKeepMax;
  return Number.isInteger(n) && n >= 1 && n <= max ? '' : tr.value.settings.keepError(max);
});
const hourChanged = computed(() => !!saved.value && form.digestHour !== saved.value.digestHour);
const digestStatus = computed(() => triggerStatus(triggers.value.digest));
const backupStatus = computed(() => triggerStatus(triggers.value.backup));
const logLines = computed(() => recentLog.value.map((r, i) => ({ key: i + ':' + r.loggedAt, ...notifyLogLine(r) })));
const busy = computed(() => saving.value || projectBusy.value);

function applyStatus(v: SettingsView) {
  triggers.value = { ...v.triggers };
  recentLog.value = v.recentLog;
}

function applyAll(v: SettingsView) {
  applyStatus(v);
  saved.value = { ...v.settings };
  Object.assign(form, v.settings);
  baseUpdatedAt.value = v.updatedAt;
  digestHours.value = v.digestHours;
  if (v.limits) limits.value = { ...v.limits };
  saveError.value = '';
  saveConflict.value = false;
  pending.value = null; // 새로 불러왔거나 저장했으면 '저장하지 않은 변경' 확인은 필요 없다
}

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    applyAll(await fetchSettings());
  } catch (e) {
    loadError.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}

/** 테스트 메일·다시 걸기 뒤: 입력 중인 폼은 그대로 두고 상태·기록만 새로 받는다 */
async function refreshStatus() {
  try {
    applyStatus(await fetchSettings());
  } catch {
    // 상태 갱신 실패는 조용히 넘긴다 (본 동작은 이미 끝남)
  }
}

async function save() {
  if (!dirty.value || keepError.value || saving.value) return;
  saving.value = true;
  saveError.value = '';
  saveConflict.value = false;
  try {
    const v = await saveAppSettings({ ...form, updatedAt: baseUpdatedAt.value });
    applyAll(v);
    // 언어를 바꿨으면 이미 새 언어로 바뀐 뒤라 알림도 새 언어로 나온다
    toast('success', v.digestTriggerReplaced ? tr.value.settings.savedWithHour(v.settings.digestHour) : tr.value.settings.saved);
  } catch (e) {
    saveError.value = errorMessage(e);
    saveConflict.value = e instanceof ApiError && e.code === 'CONFLICT';
    void refreshStatus(); // 실패 뒤 예약 상태가 바뀌었을 수 있다
  } finally {
    saving.value = false;
  }
}

function resetForm() {
  if (saved.value) Object.assign(form, saved.value);
  saveError.value = '';
}

async function repair() {
  repairing.value = true;
  try {
    applyStatus(await repairTriggers());
    toast('success', tr.value.settings.repaired);
  } catch (e) {
    toast('error', errorMessage(e));
  } finally {
    repairing.value = false;
  }
}

async function sendTest() {
  testing.value = true;
  try {
    const r = await sendTestDigest();
    toast('success', tr.value.settings.testSent(r.sentToday, limits.value.testMailPerDay));
  } catch (e) {
    toast('error', errorMessage(e));
  } finally {
    testing.value = false;
    void refreshStatus();
  }
}

function requestClose() {
  if (busy.value) return;
  if (dirty.value) {
    pending.value = { action: 'close' };
    return;
  }
  emit('close');
}

function selectTab(next: Tab) {
  if (next === tab.value || busy.value) return;
  if (tab.value === 'notify' && dirty.value) {
    pending.value = { action: 'tab', tab: next };
    return;
  }
  tab.value = next;
}

/** 확인 줄의 버튼이 사라지면 포커스가 창 밖으로 빠진다 → 지금 탭 버튼으로 돌려놓는다 */
async function focusCurrentTab() {
  await nextTick();
  document.getElementById(tab.value === 'notify' ? 'st-tab-notify' : 'st-tab-projects')?.focus();
}

function keepEditing() {
  pending.value = null;
  void focusCurrentTab();
}

function discardAndContinue() {
  const p = pending.value;
  pending.value = null;
  resetForm();
  if (!p) return;
  if (p.action === 'close') emit('close');
  else {
    tab.value = p.tab;
    void focusCurrentTab();
  }
}

/** 탭 키보드 이동 (←/→): WAI-ARIA 탭 패턴 */
function onTabKey(e: KeyboardEvent) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  const next: Tab = tab.value === 'notify' ? 'projects' : 'notify';
  selectTab(next);
  if (tab.value === next) document.getElementById(next === 'notify' ? 'st-tab-notify' : 'st-tab-projects')?.focus();
}

onMounted(() => void load());
</script>

<template>
  <BaseDialog :title="tr.settings.title" width="640px" :busy="busy" @close="requestClose">
    <div class="tabs" role="tablist" :aria-label="tr.settings.tabsLabel">
      <button
        id="st-tab-notify" type="button" role="tab" class="tab" :class="{ active: tab === 'notify' }"
        :aria-selected="tab === 'notify'" aria-controls="st-panel-notify" :tabindex="tab === 'notify' ? 0 : -1" :disabled="busy && tab !== 'notify'"
        @click="selectTab('notify')" @keydown="onTabKey"
      >{{ tr.settings.tabGeneral }}</button>
      <button
        id="st-tab-projects" type="button" role="tab" class="tab" :class="{ active: tab === 'projects' }"
        :aria-selected="tab === 'projects'" aria-controls="st-panel-projects" :tabindex="tab === 'projects' ? 0 : -1" :disabled="busy && tab !== 'projects'"
        @click="selectTab('projects')" @keydown="onTabKey"
      >{{ tr.common.project }}</button>
    </div>

    <div v-if="pending" class="notice confirm-bar" role="alert">
      {{ tr.settings.unsaved }}
      <span class="confirm-actions">
        <button type="button" class="btn btn-sm btn-danger" @click="discardAndContinue">{{ pending.action === 'close' ? tr.settings.discardClose : tr.weekly.discardMove }}</button>
        <button type="button" class="btn btn-sm" @click="keepEditing">{{ tr.settings.keepEditing }}</button>
      </span>
    </div>

    <!-- 일반 (언어·알림·백업) -->
    <div v-show="tab === 'notify'" id="st-panel-notify" role="tabpanel" aria-labelledby="st-tab-notify">
      <p v-if="loading" class="muted">{{ tr.common.loading }}</p>
      <p v-else-if="loadError" class="error-text" role="alert">
        {{ loadError }}
        <button type="button" class="btn btn-sm" @click="load">{{ tr.app.retry }}</button>
      </p>
      <form v-else id="settings-form" novalidate @submit.prevent="save">
        <section class="group" aria-labelledby="st-h-lang">
          <h3 id="st-h-lang">{{ tr.settings.language }}</h3>
          <div class="line">
            <label for="st-lang">{{ tr.settings.languageLabel }}</label>
            <select id="st-lang" v-model="form.language" class="input lang">
              <option value="auto">{{ tr.settings.languageAuto(LANG_NAMES[detectedLang]) }}</option>
              <option value="ko" lang="ko">{{ LANG_NAMES.ko }}</option>
              <option value="ja" lang="ja">{{ LANG_NAMES.ja }}</option>
            </select>
          </div>
          <p class="hint">{{ tr.settings.languageHint }}</p>
        </section>

        <section class="group" aria-labelledby="st-h-mail">
          <h3 id="st-h-mail">{{ tr.settings.mail }}</h3>
          <label class="check">
            <input v-model="form.notifyEnabled" type="checkbox" />
            <span>{{ tr.settings.mailEnabled }} <small class="hint">{{ tr.settings.mailEnabledHint }}</small></span>
          </label>
          <div class="line" :class="{ dim: !form.notifyEnabled }">
            <label for="st-hour">{{ tr.settings.hour }}</label>
            <select id="st-hour" v-model.number="form.digestHour" class="input hour">
              <option v-for="h in digestHours" :key="h" :value="h">{{ tr.settings.hourOption(h) }}</option>
            </select>
            <span class="hint">{{ tr.settings.hourHint(form.digestHour) }}</span>
          </div>
          <p v-if="hourChanged" class="hint note">
            {{ tr.settings.hourChangedNote }}
          </p>
          <label class="check" :class="{ dim: !form.notifyEnabled }">
            <input v-model="form.skipHolidays" type="checkbox" />
            <span>{{ tr.settings.skipHolidays }}</span>
          </label>
          <label class="check" :class="{ dim: !form.notifyEnabled }">
            <input v-model="form.notifyWhenEmpty" type="checkbox" />
            <span>{{ tr.settings.whenEmpty }}</span>
          </label>
        </section>

        <section class="group" aria-labelledby="st-h-today">
          <h3 id="st-h-today">{{ tr.app.todaySummary }}</h3>
          <label class="check">
            <input v-model="form.todayPopup" type="checkbox" />
            <span>{{ tr.settings.todayPopup }} <small class="hint">{{ tr.settings.todayPopupHint }}</small></span>
          </label>
        </section>

        <section class="group" aria-labelledby="st-h-backup">
          <h3 id="st-h-backup">{{ tr.settings.backup }}</h3>
          <div class="line">
            <label for="st-keep">{{ tr.settings.keep }}</label>
            <input
              id="st-keep" v-model.number="form.backupKeep" type="number" min="1" :max="limits.backupKeepMax" step="1"
              class="input keep" :aria-invalid="!!keepError" aria-describedby="st-keep-hint"
            />
            <span id="st-keep-hint" class="hint">{{ tr.settings.keepUnit }} <template v-if="!keepError">({{ backupSpanLabel(form.backupKeep) }})</template></span>
          </div>
          <p class="hint">{{ tr.settings.keepHint }}</p>
          <p v-if="keepError" class="error-text" role="alert">{{ keepError }}</p>
        </section>

        <p v-if="saveError" class="error-text" role="alert">
          {{ saveError }}
          <button v-if="saveConflict" type="button" class="btn btn-sm" @click="load">{{ tr.settings.reload }}</button>
        </p>
      </form>

      <template v-if="!loading && !loadError">
        <section class="group status" aria-labelledby="st-h-trigger">
          <h3 id="st-h-trigger">{{ tr.settings.triggers }}</h3>
          <ul class="plain">
            <li>
              {{ tr.settings.digestTrigger }} <strong :class="digestStatus.ok ? 'ok' : 'bad'">{{ digestStatus.text }}</strong>
              <span v-if="digestStatus.ok && saved" class="hint">&nbsp;{{ tr.settings.digestTriggerHint(saved.digestHour) }}</span>
            </li>
            <li>
              {{ tr.settings.backupTrigger }} <strong :class="backupStatus.ok ? 'ok' : 'bad'">{{ backupStatus.text }}</strong>
              <span v-if="backupStatus.ok" class="hint">&nbsp;{{ tr.settings.backupTriggerHint }}</span>
            </li>
          </ul>
          <div class="line">
            <button type="button" class="btn btn-sm" :class="{ 'btn-primary': !digestStatus.ok || !backupStatus.ok }" :disabled="repairing" @click="repair">
              {{ repairing ? tr.settings.repairing : tr.settings.repair }}
            </button>
            <span class="hint">{{ tr.settings.repairHint }}</span>
          </div>
        </section>

        <section class="group" aria-labelledby="st-h-test">
          <h3 id="st-h-test">{{ tr.settings.testMail }}</h3>
          <div class="line">
            <button type="button" class="btn btn-sm" :disabled="testing" @click="sendTest">{{ testing ? tr.settings.sending : tr.settings.sendTest }}</button>
            <span class="hint">{{ tr.settings.testHint(limits.testMailPerDay) }}</span>
          </div>
        </section>

        <section class="group" aria-labelledby="st-h-log">
          <h3 id="st-h-log">{{ tr.settings.log }}</h3>
          <ul v-if="logLines.length" class="plain log">
            <li v-for="l in logLines" :key="l.key">
              <span class="when">{{ l.when }}</span>
              <span class="label">{{ l.label }}</span>
              <span class="text" :class="l.tone">{{ l.text }}</span>
            </li>
          </ul>
          <p v-else class="muted">{{ tr.settings.logEmpty }}</p>
        </section>
      </template>
    </div>

    <!-- 프로젝트 -->
    <div v-show="tab === 'projects'" id="st-panel-projects" role="tabpanel" aria-labelledby="st-tab-projects">
      <ProjectManager @busy="(v) => (projectBusy = v)" />
    </div>

    <template #footer>
      <template v-if="tab === 'notify'">
        <button type="button" class="btn" :disabled="!dirty || saving" @click="resetForm">{{ tr.settings.resetChanges }}</button>
        <span style="flex: 1" />
        <button type="button" class="btn" :disabled="busy" @click="requestClose">{{ tr.common.close }}</button>
        <button type="submit" form="settings-form" class="btn btn-primary" :disabled="!dirty || !!keepError || saving || loading">
          {{ saving ? tr.common.saving : tr.common.save }}
        </button>
      </template>
      <template v-else>
        <span style="flex: 1" />
        <button type="button" class="btn" :disabled="busy" @click="requestClose">{{ tr.common.close }}</button>
      </template>
    </template>
  </BaseDialog>
</template>

<style scoped>
.tabs { display: flex; gap: 4px; margin-bottom: 12px; border-bottom: 1px solid var(--border); }
.tab {
  background: none; border: none; border-bottom: 2px solid transparent; margin-bottom: -1px;
  padding: 6px 12px; font-size: 14px; font-weight: 600; color: var(--muted); cursor: pointer;
}
.tab.active { color: var(--primary); border-bottom-color: var(--primary); }
.tab:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; border-radius: 4px; }
.confirm-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.confirm-actions { display: inline-flex; gap: 6px; margin-left: auto; }
.group { padding: 10px 0; border-bottom: 1px solid var(--border); }
.group:last-child { border-bottom: none; }
.group h3 { font-size: 13px; margin: 0 0 8px; color: var(--muted); }
.check { display: flex; align-items: flex-start; gap: 8px; padding: 4px 0; cursor: pointer; }
.check input { margin-top: 3px; }
.check small { display: block; margin-top: 2px; }
.line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 4px 0; }
.line > label { min-width: 64px; font-size: 14px; }
.hour { width: 90px; }
.lang { width: auto; min-width: 220px; max-width: 100%; }
.keep { width: 90px; }
.dim { opacity: 0.6; }
.note { margin: 2px 0 4px; }
.plain { list-style: none; margin: 0 0 8px; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 14px; }
.ok { color: var(--success); }
.bad { color: var(--danger); }
.log { font-size: 13px; }
.log li { display: flex; gap: 8px; flex-wrap: wrap; }
.log .when { color: var(--muted); min-width: 108px; }
.log .label { min-width: 72px; }
.log .text.skip { color: var(--muted); }
.log .text.fail { color: var(--danger); word-break: break-word; }
</style>
