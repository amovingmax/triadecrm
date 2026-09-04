// ESLint do apps/web: regras do Next.js (core-web-vitals + TypeScript) mais as convenções do monorepo.
// Este arquivo prevalece sobre o eslint.config.mjs da raiz quando o lint roda de dentro de apps/web.
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';

export default defineConfig([
  // `.next-*/**` cobre os builds de conferência feitos com NEXT_DIST_DIR (ver next.config.ts):
  // sem isso o lint passa a analisar o bundle gerado e falha em código que não é nosso.
  globalIgnores([
    '.next/**',
    '.next-*/**',
    'out/**',
    'build/**',
    'coverage/**',
    'next-env.d.ts',
    'public/**',
  ]),
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },
  // Desliga regras de estilo que conflitam com o Prettier (sempre por último).
  prettier,
]);
