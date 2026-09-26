<script setup lang="ts">
/**
 * 앱 로고 (v1.14). 원본은 assets/logo.svg — 모양을 바꾸면 여기도 같이 바꾼다.
 * 파일로 불러오지 않고 SVG를 그대로 넣어 단일 파일 빌드(Apps Script index.html)에 그대로 들어간다.
 * 글자 옆에 붙는 장식이라 스크린 리더에는 읽히지 않게 둔다.
 */
withDefaults(defineProps<{ size?: number }>(), { size: 22 });
</script>

<template>
  <svg class="app-logo" :width="size" :height="size" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <rect x="6" y="10" width="52" height="48" rx="12" fill="#2563EB" />
    <path d="M6 22a12 12 0 0 1 12-12h28a12 12 0 0 1 12 12v2H6z" fill="#1D4ED8" />
    <rect x="18" y="4" width="7" height="13" rx="3.5" fill="#1E3A8A" />
    <rect x="39" y="4" width="7" height="13" rx="3.5" fill="#1E3A8A" />
    <path d="M20.5 40.5l8 8 15.5-17" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</template>

<style scoped>
.app-logo { display: inline-block; vertical-align: -5px; margin-right: 6px; }
</style>
