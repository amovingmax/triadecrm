import { defineConfig } from 'vitest/config';

// Testes da configuração da casca (ambientes, endereços e o que ela deixa navegar).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
