import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Apps Script HtmlService는 파일 하나만 서빙하므로 JS·CSS를 모두 index.html 안에 넣는다.
export default defineConfig({
  plugins: [vue(), viteSingleFile()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    reportCompressedSize: false,
  },
});
