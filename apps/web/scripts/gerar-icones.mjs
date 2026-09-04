// Gera os PNGs da PWA (public/icons) a partir dos SVGs. Uso: node scripts/gerar-icones.mjs
// Usa o `sharp` que o Next.js já traz como dependência (não precisa instalar nada).
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// O pnpm instala por symlink: resolve o caminho real do `next` para achar o `sharp` ao lado dele.
const require = createRequire(
  resolve(realpathSync(resolve(raiz, 'node_modules/next')), 'package.json'),
);
const sharp = require('sharp');

const saidas = [
  { origem: 'icone.svg', destino: 'icon-192.png', tamanho: 192 },
  { origem: 'icone.svg', destino: 'icon-512.png', tamanho: 512 },
  { origem: 'icone-maskable.svg', destino: 'icon-512-maskable.png', tamanho: 512 },
];

for (const { origem, destino, tamanho } of saidas) {
  await sharp(resolve(raiz, 'public/icons', origem))
    .resize(tamanho, tamanho)
    .png({ compressionLevel: 9 })
    .toFile(resolve(raiz, 'public/icons', destino));
  console.log(`gerado public/icons/${destino} (${tamanho}x${tamanho})`);
}
