import { defineConfig } from 'vitest/config';

// 테스트 전용 설정: 앱 빌드 플러그인(react, tailwind)은 불러오지 않는다.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/geo.ts', 'src/lib/pace.ts', 'src/lib/guides.ts', 'src/lib/routing.ts', 'src/lib/storage.ts'],
      reporter: ['text', 'text-summary'],
    },
  },
});
