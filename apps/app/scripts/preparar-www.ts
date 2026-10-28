/**
 * Prepara a pasta `www` da casca antes do `cap sync`: escreve `inicio.js` com o endereço
 * do ambiente (o mesmo que o `capacitor.config.ts` abre) e copia a fonte do site para a
 * tela de "sem internet", que precisa funcionar sem rede.
 *
 * Os dois arquivos são gerados e ficam fora do git (`apps/app/.gitignore`).
 */
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ambienteDoApp, enderecoInicial } from '../src/ambiente';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const www = join(raiz, 'www');

const ambiente = ambienteDoApp(process.env.TRIADE_APP_AMBIENTE);
const inicio = enderecoInicial(ambiente);

writeFileSync(join(www, 'inicio.js'), `window.TRIADE_INICIO = ${JSON.stringify(inicio)};\n`);

mkdirSync(join(www, 'fontes'), { recursive: true });
copyFileSync(
  join(raiz, '..', 'web', 'src', 'app', 'fontes', 'PlusJakartaSans-latin.woff2'),
  join(www, 'fontes', 'PlusJakartaSans-latin.woff2'),
);

console.log(`www pronta para o ambiente ${ambiente}: o app abre ${inicio}`);
