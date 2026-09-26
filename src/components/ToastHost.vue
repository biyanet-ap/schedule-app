<script setup lang="ts">
import { dismissToast, holdToast, releaseToast, runToastAction, store } from '../store';
import { tr } from '../i18n';
</script>

<template>
  <div class="toasts" aria-live="polite">
    <!-- 마우스를 올리거나 버튼에 포커스가 있는 동안은 닫히지 않는다 -->
    <div
      v-for="t in store.toasts" :key="t.id" class="toast" :class="t.kind" role="status"
      @mouseenter="holdToast(t.id)" @mouseleave="releaseToast(t.id)" @focusin="holdToast(t.id)" @focusout="releaseToast(t.id)"
    >
      <span class="msg">{{ t.message }}</span>
      <button v-if="t.action" type="button" class="action" @click="runToastAction(t)">{{ t.action.label }}</button>
      <button type="button" class="close" :aria-label="tr.common.close" @click="dismissToast(t.id)">✕</button>
    </div>
  </div>
</template>

<style scoped>
.toasts { position: fixed; right: 16px; bottom: 16px; z-index: 60; display: flex; flex-direction: column; gap: 8px; max-width: min(420px, calc(100vw - 32px)); }
.toast {
  display: flex; gap: 10px; align-items: flex-start; justify-content: space-between;
  padding: 10px 12px; border-radius: 10px; box-shadow: var(--shadow);
  background: var(--surface); border: 1px solid var(--border); font-size: 13px;
}
.toast.success { border-left: 4px solid var(--success); }
.toast.error { border-left: 4px solid var(--danger); }
.toast.info { border-left: 4px solid var(--primary); }
.toast .msg { flex: 1; }
.toast .close { background: none; border: none; cursor: pointer; color: var(--muted); padding: 0; }
.toast .action {
  background: none; border: none; cursor: pointer; padding: 0 2px; white-space: nowrap;
  color: var(--primary); font-weight: 600; font-size: 13px; text-decoration: underline; text-underline-offset: 2px;
}
</style>
