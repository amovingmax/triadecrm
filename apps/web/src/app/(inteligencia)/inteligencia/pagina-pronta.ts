import 'server-only';

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * A página pronta da Inteligência de mercado no disco do servidor (revisão de 18/11/2026).
 *
 * Fica FORA de `public/` (nada ali é entregue sem passar pela rota que confere o
 * acesso) e FORA do git (`apps/web/privado/.gitignore`): é dado interno da Imova, num
 * repositório que também é da KOMUNE, e muda duas vezes por semana. Quem grava é
 * `scripts/inteligencia/copiar-prototipo.mjs`, já em gzip (cerca de 0,8 MB para os
 * ~7 MB da página): a rota entrega os bytes como estão, com `Content-Encoding: gzip`,
 * bem abaixo do limite de 4,5 MB da resposta de uma função na Vercel.
 *
 * Chega ao ar só no deploy da Imova: o passo de publicar copia o arquivo para a cópia
 * limpa antes do `vercel deploy` (a CLI não lê o .gitignore, só o .vercelignore). O
 * site da KOMUNE não leva o arquivo, e a rota responde "não encontrado" lá.
 */

/** O caminho a partir de `apps/web`. Igual ao `CAMINHO_DA_PAGINA_PRONTA_NO_SITE` do script (um teste confere). */
export const CAMINHO_DA_PAGINA_PRONTA = 'privado/inteligencia/painel.html.gz';

/**
 * O arquivo, a partir da pasta do site. O caminho vai escrito por extenso (e repetido
 * em `outputFileTracingIncludes`, no next.config.ts) para o build da Vercel levar o
 * arquivo junto com a função.
 */
export function arquivoDaPaginaPronta(): string {
  return path.join(process.cwd(), 'privado', 'inteligencia', 'painel.html.gz');
}

export type PaginaPronta = {
  /** Os bytes do arquivo, em gzip. */
  gz: Uint8Array;
  /** A etiqueta (ETag) para o navegador perguntar "mudou?" e receber 304. */
  etag: string;
};

let guardada: { arquivo: string; mtimeMs: number; tamanho: number; pagina: PaginaPronta } | null =
  null;

/**
 * Lê a página pronta, ou null quando ainda não há (o site da KOMUNE, a CI, um checkout
 * sem a cópia). Guarda na memória do servidor e só relê quando o arquivo muda.
 */
export async function lerPaginaPronta(
  arquivo: string = arquivoDaPaginaPronta(),
): Promise<PaginaPronta | null> {
  let info;
  try {
    info = await stat(arquivo);
  } catch {
    return null;
  }
  if (!info.isFile()) return null;
  if (
    guardada &&
    guardada.arquivo === arquivo &&
    guardada.mtimeMs === info.mtimeMs &&
    guardada.tamanho === info.size
  ) {
    return guardada.pagina;
  }
  const gz = new Uint8Array(await readFile(arquivo));
  // gzip começa com 1f 8b. Outra coisa (um .html sem compressão copiado à mão) não é
  // entregue: o navegador tentaria descomprimir e mostraria lixo.
  if (gz[0] !== 0x1f || gz[1] !== 0x8b) {
    console.error(`[inteligencia] ${arquivo} não está em gzip: rode copiar-prototipo.mjs de novo.`);
    return null;
  }
  const etag = `"${createHash('sha256').update(gz).digest('base64url').slice(0, 27)}"`;
  const pagina = { gz, etag };
  guardada = { arquivo, mtimeMs: info.mtimeMs, tamanho: info.size, pagina };
  return pagina;
}
