<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import type { Diary, DiaryInput } from '../api/types';
import { deleteDiary, diaryOn, errorMessage, notifyDeleted, saveDiary, store, toast } from '../store';
import { diaryDefaultTitle, isDefaultDiaryTitle } from '../utils/diary';
import { isYmd } from '../utils/date';
import BaseDialog from './BaseDialog.vue';
import { tr } from '../i18n';

const props = defineProps<{ diary?: Diary; date: string }>();
const emit = defineEmits<{ close: [] }>();

const editing = !!props.diary;
const d = props.diary;

const form = reactive({
  diaryDate: d?.diaryDate ?? props.date,
  // 저장된 타이틀이 날짜 문구 그대로면(어느 언어로 저장했든) 비워서 보여준다 (날짜를 바꾸면 새 날짜로 다시 채워지게)
  title: d && !isDefaultDiaryTitle(d.title, d.diaryDate) ? d.title : '',
  content: d?.content ?? '',
});

const busy = ref(false);
const error = ref('');
const confirmDelete = ref(false);
const limits = computed(() => store.limits);
const titlePlaceholder = computed(() => (isYmd(form.diaryDate)
  ? tr.value.diary.titlePlaceholderWithDate(diaryDefaultTitle(form.diaryDate))
  : tr.value.diary.titlePlaceholder));

function validate(): string {
  if (!isYmd(form.diaryDate)) return tr.value.diary.checkDate;
  if (!form.content.trim()) return tr.value.diary.contentRequired;
  // 날짜당 1편: 이미 불러온 다른 다이어리가 있으면 미리 알린다 (최종 검사는 서버)
  const other = diaryOn(form.diaryDate);
  if (other && other.id !== d?.id) return tr.value.diary.exists(form.diaryDate);
  return '';
}

async function submit() {
  error.value = validate();
  if (error.value) return;
  const input: DiaryInput = { id: d?.id, updatedAt: d?.updatedAt, diaryDate: form.diaryDate, title: form.title, content: form.content };
  busy.value = true;
  try {
    await saveDiary(input);
    toast('success', editing ? tr.value.diary.updated : tr.value.diary.created);
    emit('close');
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

async function remove() {
  if (!d) return;
  if (!confirmDelete.value) {
    confirmDelete.value = true;
    return;
  }
  busy.value = true;
  try {
    notifyDeleted('DIARY', await deleteDiary(d));
    emit('close');
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <BaseDialog :title="editing ? tr.diary.titleEdit : tr.diary.titleNew" width="640px" :busy="busy" @close="emit('close')">
    <form id="diary-form" @submit.prevent="submit">
      <div class="field date-field">
        <label for="dy-date">{{ tr.diary.date }}</label>
        <input id="dy-date" v-model="form.diaryDate" type="date" class="input" />
      </div>

      <div class="field">
        <label for="dy-title">{{ tr.diary.title }}</label>
        <input id="dy-title" v-model="form.title" class="input" :maxlength="limits?.title" :placeholder="titlePlaceholder" />
      </div>

      <div class="field">
        <label for="dy-content">{{ tr.common.content }}</label>
        <textarea id="dy-content" v-model="form.content" class="input" rows="14" autofocus :maxlength="limits?.content" :placeholder="tr.diary.contentPlaceholder" />
      </div>

      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
    </form>

    <template #footer>
      <button v-if="editing" type="button" class="btn btn-danger" :class="{ confirm: confirmDelete }" :disabled="busy" @click="remove">
        {{ confirmDelete ? tr.common.deleteConfirm : tr.common.delete }}
      </button>
      <span style="flex: 1" />
      <button type="button" class="btn" :disabled="busy" @click="emit('close')">{{ tr.common.cancel }}</button>
      <button type="submit" form="diary-form" class="btn btn-primary" :disabled="busy">{{ busy ? tr.common.saving : tr.common.save }}</button>
    </template>
  </BaseDialog>
</template>

<style scoped>
.date-field { max-width: 180px; }
</style>
