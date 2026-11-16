import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 실내/오프라인 즉시 테스트용: CSS·JS를 모두 인라인한 단일 HTML 파일을 만든다.
// npm run build:single  ->  dist-single/index.html (파일 하나로 실행 가능)
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: {
    outDir: 'dist-single',
    target: 'es2020',
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
  },
});
