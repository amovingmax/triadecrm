import { defineConfig } from 'tsup';

// Empacota o CLI em um único arquivo ESM para a imagem Docker.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  // Pacotes do workspace entram no bundle (não existem em node_modules na imagem final);
  // dependências de terceiros (zod e, a partir do D4, crawlee/playwright) continuam externas.
  noExternal: [/^@komune\//],
});
