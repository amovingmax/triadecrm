// Configuração do ESLint (flat config) compartilhada pelo monorepo.
// Cada pacote roda `eslint .` na própria pasta; o ESLint sobe a árvore até encontrar este arquivo.
// apps/web pode ter o próprio eslint.config (eslint-config-next); ele prevalece quando o lint roda de dentro dela.
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/.next/',
    '**/out/',
    '**/coverage/',
    '**/.turbo/',
    'supabase/.temp/',
    'supabase/.branches/',
    'infra/local/data/',
    // Gerado por `pnpm db:types`; nunca editado à mão.
    'packages/schema/src/database.types.ts',
    'docs/',
  ]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,tsx}'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2022 },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // Workers logam em JSON pelo stdout; a web usa o próprio logger.
      'no-console': 'off',
    },
  },
  // Desliga regras de estilo que conflitam com o Prettier (sempre por último).
  prettier,
]);
