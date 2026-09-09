// Vitest do apps/web: testes unitários de lógica pura (papel do JWT, normalizações), sem DOM.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Ver o comentário em vitest-server-only.ts.
      'server-only': fileURLToPath(new URL('./vitest-server-only.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
