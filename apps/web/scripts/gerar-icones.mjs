// Gera os PNGs da PWA (public/icons) a partir dos SVGs. Uso: node scripts/gerar-icones.mjs
// Usa o `sharp` que o Next.js já traz como dependência (não precisa instalar nada).
//
// Uma pasta por empresa (10/11/2026): sem argumento, a da KOMUNE (public/icons); com o
// nome da empresa, a dela (`node scripts/gerar-icones.mjs imova` → public/icons/imova).
// Uma de cada vez, para gerar os da Imova sem regravar os PNGs da KOMUNE.
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

const empresa = process.argv[2]?.trim();
if (empresa && !/^[a-z]+$/.test(empresa)) {
  throw new Error(`Empresa "${empresa}" inválida: use o slug, como "imova".`);
}
const pasta = empresa ? `public/icons/${empresa}` : 'public/icons';

for (const { origem, destino, tamanho } of saidas) {
  await sharp(resolve(raiz, pasta, origem))
    .resize(tamanho, tamanho)
    .png({ compressionLevel: 9 })
    .toFile(resolve(raiz, pasta, destino));
  console.log(`gerado ${pasta}/${destino} (${tamanho}x${tamanho})`);
}
