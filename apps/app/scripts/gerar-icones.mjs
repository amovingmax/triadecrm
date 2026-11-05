// Gera os PNGs do ícone e da abertura do app (assets/) a partir dos SVGs da mesma pasta.
// Uso: node scripts/gerar-icones.mjs
//
// Usa o `sharp` que o Next.js do site já traz (o mesmo de apps/web/scripts/gerar-icones.mjs):
// o app não ganha dependência só para isto. Rode depois de `pnpm install` na raiz.
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = resolve(app, '../web');
const require = createRequire(
  resolve(realpathSync(resolve(web, 'node_modules/next')), 'package.json'),
);
const sharp = require('sharp');

const FUNDO = '#0f172a';
const saidas = [
  // O iPhone exige 1024x1024, sem transparência.
  { origem: 'icone.svg', destino: 'icone.png', tamanho: 1024, opaco: true },
  { origem: 'icone-android.svg', destino: 'icone-android.png', tamanho: 1024, opaco: false },
  { origem: 'abertura.svg', destino: 'abertura.png', tamanho: 640, opaco: false },
];

for (const { origem, destino, tamanho, opaco } of saidas) {
  let imagem = sharp(resolve(app, 'assets', origem), { density: 400 }).resize(tamanho, tamanho);
  if (opaco) imagem = imagem.flatten({ background: FUNDO }).removeAlpha();
  await imagem.png({ compressionLevel: 9 }).toFile(resolve(app, 'assets', destino));
  console.log(`gerado assets/${destino} (${tamanho}x${tamanho})`);
}
