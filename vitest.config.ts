import { defineConfig } from 'vitest/config';

// 테스트 전용 설정: 앱 빌드 플러그인(react, tailwind)은 불러오지 않는다.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/test/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/geo.ts', 'src/lib/pace.ts', 'src/lib/guides.ts', 'src/lib/routing.ts', 'src/lib/storage.ts', 'src/lib/auth.ts', 'src/lib/sync.ts'],
      reporter: ['text', 'text-summary'],
    },
  },
});
