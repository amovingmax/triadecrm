import { defineConfig } from 'vitest/config';

/**
 * Os evals são testes: rodam no `pnpm test`, no CI, sem rede e sem credencial da
 * Anthropic. O que eles exercitam é o código determinístico em volta do modelo
 * (pseudonimização, validador, decisão de intenção) e os schemas de cada versão de
 * prompt, com a saída do modelo entrando como fixture.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'evals/**/*.test.ts'],
  },
});
