import { defineConfig } from 'vitest/config';

// Testes unitários de normalização, dedup, score e regra de temperatura (CLAUDE.md, "Testes").
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
});
