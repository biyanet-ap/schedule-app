<script setup lang="ts">
/**
 * 프로젝트 관리 (설정 창의 '프로젝트' 탭, v1.12). 예전 ProjectDialog의 본문을 옮겼다.
 */
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import type { Project } from '../api/types';
import { errorMessage, saveProject, store, toast } from '../store';
import { tr } from '../i18n';

/** 저장 중에는 창을 닫지 못하게 부모(설정 창)에 알린다 */
const emit = defineEmits<{ busy: [value: boolean] }>();

const PALETTE = ['#2563eb', '#db2777', '#ea580c', '#0891b2', '#65a30d', '#9333ea', '#ca8a04', '#475569'];

const editingId = ref<string | null>(null);
const form = reactive({ name: '', color: PALETTE[0], sortOrder: 0, active: true });
const busy = ref(false);
const error = ref('');

watch(busy, (v) => emit('busy', v));
// 저장 도중 사라져도 부모가 '저장 중'에 묶이지 않게
onBeforeUnmount(() => { if (busy.value) emit('busy', false); });

const nextOrder = computed(() => store.projects.reduce((m, p) => Math.max(m, p.sortOrder), 0) + 1);

function startNew() {
  editingId.value = '';
  Object.assign(form, { name: '', color: PALETTE[store.projects.length % PALETTE.length], sortOrder: nextOrder.value, active: true });
  error.value = '';
}

function startEdit(p: Project) {
  editingId.value = p.id;
  Object.assign(form, { name: p.name, color: p.color, sortOrder: p.sortOrder, active: p.active });
  error.value = '';
}

async function submit() {
  if (!form.name.trim()) {
    error.value = tr.value.projects.nameRequired;
    return;
  }
  const current = store.projects.find((p) => p.id === editingId.value);
  busy.value = true;
  try {
    await saveProject({
      id: current?.id,
      updatedAt: current?.updatedAt,
      name: form.name,
      color: form.color,
      sortOrder: Number(form.sortOrder) || 0,
      active: form.active,
    });
    toast('success', current ? tr.value.projects.updated : tr.value.projects.created);
    editingId.value = null;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="pm">
    <p class="hint">{{ tr.projects.hint }}</p>
    <ul class="list">
      <li v-for="p in store.projects" :key="p.id" :class="{ inactive: !p.active }">
        <span class="dot" :style="{ background: p.color }" />
        <span class="name">{{ p.name }}</span>
        <span v-if="!p.active" class="chip">{{ tr.projects.inactive }}</span>
        <button type="button" class="btn btn-sm btn-ghost" @click="startEdit(p)">{{ tr.diaryView.edit }}</button>
      </li>
      <li v-if="!store.projects.length" class="muted">{{ tr.projects.empty }}</li>
    </ul>

    <form v-if="editingId !== null" class="editor" @submit.prevent="submit">
      <div class="field">
        <label for="pj-name">{{ tr.projects.name }}</label>
        <input id="pj-name" v-model="form.name" class="input" autofocus :maxlength="store.limits?.projectName" />
      </div>
      <div class="field">
        <span class="field-label">{{ tr.projects.color }}</span>
        <div class="palette">
          <button
            v-for="c in PALETTE" :key="c" type="button" class="swatch" :class="{ on: form.color === c }"
            :style="{ background: c }" :aria-label="tr.projects.colorAria(c)" @click="form.color = c"
          />
          <input v-model="form.color" type="color" class="color-input" :aria-label="tr.projects.customColor" />
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="pj-order">{{ tr.projects.sortOrder }}</label>
          <input id="pj-order" v-model.number="form.sortOrder" type="number" min="0" max="9999" class="input" />
        </div>
        <label class="check"><input v-model="form.active" type="checkbox" /> {{ tr.projects.active }}</label>
      </div>
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      <div class="actions">
        <button type="button" class="btn" :disabled="busy" @click="editingId = null">{{ tr.common.cancel }}</button>
        <button type="submit" class="btn btn-primary" :disabled="busy">{{ busy ? tr.common.saving : tr.common.save }}</button>
      </div>
    </form>

    <button v-if="editingId === null" type="button" class="btn" @click="startNew">{{ tr.projects.add }}</button>
  </div>
</template>

<style scoped>
.list { list-style: none; margin: 8px 0 12px; padding: 0; }
.list li { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--border); }
.list li.inactive .name { color: var(--muted); }
.name { flex: 1; }
.editor { border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; background: var(--surface-2); margin-bottom: 8px; }
.palette { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.swatch { width: 24px; height: 24px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; }
.swatch.on { border-color: var(--text); }
.color-input { width: 32px; height: 28px; padding: 0; border: none; background: none; }
.check { display: flex; align-items: center; gap: 6px; padding-top: 20px; }
.actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
