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
      // `import { z } from 'zod'` puxa o objeto `z` inteiro, com os ~40 idiomas de
      // mensagem de erro, para TODA página (20/10/2026). Como namespace, o
      // empacotador leva só o que é usado.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "ImportDeclaration[source.value='zod'][importKind!='type'] > ImportSpecifier[imported.name='z'][importKind!='type']",
          message: "Use `import * as z from 'zod'`: o `{ z }` leva o zod inteiro para o navegador.",
        },
      ],
    },
  },
  // Desliga regras de estilo que conflitam com o Prettier (sempre por último).
  prettier,
]);
