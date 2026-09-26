<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { tr } from '../i18n';

const props = withDefaults(defineProps<{ title: string; width?: string; busy?: boolean }>(), { width: '560px', busy: false });
const emit = defineEmits<{ close: [] }>();
const panel = ref<HTMLElement | null>(null);
let previouslyFocused: Element | null = null;

function requestClose() {
  if (!props.busy) emit('close');
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopPropagation();
    requestClose();
  }
}

/**
 * 창 안에서 누른 버튼이 사라지면 포커스가 body로 빠져 위의 핸들러에 Esc가 오지 않는다.
 * 그럴 때도 Esc로 닫히게 문서 전체에서 한 번 더 받는다 (창 안의 Esc는 위에서 전파를 멈춰 여기로 오지 않음).
 */
function onDocumentKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && !e.defaultPrevented) requestClose();
}

onMounted(async () => {
  document.addEventListener('keydown', onDocumentKeydown);
  previouslyFocused = document.activeElement;
  document.body.style.overflow = 'hidden';
  await nextTick();
  const root = panel.value;
  const first = root?.querySelector<HTMLElement>('[autofocus]')
    ?? root?.querySelector<HTMLElement>('input:not(.sr-only), textarea, select, button');
  first?.focus();
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onDocumentKeydown);
  document.body.style.overflow = '';
  if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
});
</script>

<template>
  <Teleport to="body">
    <div class="overlay" @mousedown.self="requestClose" @keydown="onKeydown">
      <section ref="panel" class="panel" role="dialog" aria-modal="true" :aria-label="title" :style="{ maxWidth: width }">
        <header class="head">
          <h2>{{ title }}</h2>
          <button type="button" class="icon-btn close" :aria-label="tr.common.close" :disabled="busy" @click="requestClose">✕</button>
        </header>
        <div class="body"><slot /></div>
        <footer v-if="$slots.footer" class="foot"><slot name="footer" /></footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed; inset: 0; z-index: 50;
  background: rgba(15, 23, 42, 0.45);
  display: flex; align-items: flex-start; justify-content: center;
  padding: 6vh 16px 16px; overflow-y: auto;
}
.panel {
  width: 100%; background: var(--surface); border-radius: 14px; box-shadow: var(--shadow);
  border: 1px solid var(--border);
}
.head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--border); }
.head h2 { margin: 0; font-size: 16px; }
.close { width: 30px; height: 30px; border: none; }
.body { padding: 16px 18px 6px; }
.foot { display: flex; align-items: center; gap: 8px; padding: 12px 18px 16px; }
@media (max-width: 767px) {
  .overlay { padding: 0; align-items: stretch; }
  .panel { border-radius: 0; min-height: 100%; }
}
</style>
