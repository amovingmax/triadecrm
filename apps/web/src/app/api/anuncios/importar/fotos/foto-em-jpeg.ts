/**
 * A foto do sistema atual vira JPEG antes de entrar no balde (05/11/2026).
 *
 * O balde `anuncios` e o arquivo do portal só têm JPEG: o editor converte no
 * navegador (`prepararFotoDoAnuncio`, em `components/anuncios/dados.ts`). O sistema
 * que publica hoje os anúncios da Imova (Arbo) entrega WebP, então o servidor
 * converte aqui, com as regras do editor: de pé pela orientação gravada, maior
 * lado em até 2.560 px e sem metadados (nem a localização de onde foi tirada).
 * Só entra o que é JPEG, PNG ou WebP pelos primeiros bytes.
 */
import 'server-only';

import sharp from 'sharp';

/** O mesmo teto do editor (`LADO_MAXIMO` em `components/anuncios/dados.ts`). */
export const LADO_MAXIMO = 2560;
const QUALIDADE = 85;
/**
 * Acima disso a foto nem é aberta: um PNG pequeno pode pedir gigabytes de memória
 * ao ser aberto. 50 milhões de pontos cobrem a câmera de 48 MP de um celular.
 */
const PONTOS_NO_MAXIMO = 50_000_000;

export type FormatoDaFoto = 'jpeg' | 'png' | 'webp';

function texto(bytes: Uint8Array, de: number, ate: number): string {
  return String.fromCharCode(...bytes.subarray(de, ate));
}

/** O formato pelos primeiros bytes: o tipo que o servidor anuncia pode mentir. */
export function formatoDaFoto(bytes: Uint8Array): FormatoDaFoto | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (bytes.length > 8 && texto(bytes, 0, 8) === '\x89PNG\r\n\x1a\n') return 'png';
  if (bytes.length > 12 && texto(bytes, 0, 4) === 'RIFF' && texto(bytes, 8, 12) === 'WEBP') {
    return 'webp';
  }
  return null;
}

export type FotoEmJpeg =
  | { ok: true; jpeg: Buffer }
  | { ok: false; motivo: 'formato_nao_aceito' | 'foto_quebrada' | 'grande_demais' };

/** Converte (ou refaz, se já for JPEG) a foto no padrão do balde. */
export async function fotoEmJpeg(bytes: Buffer, teto: number): Promise<FotoEmJpeg> {
  if (!formatoDaFoto(bytes)) return { ok: false, motivo: 'formato_nao_aceito' };
  try {
    const jpeg = await sharp(bytes, { failOn: 'error', limitInputPixels: PONTOS_NO_MAXIMO })
      .rotate()
      .resize({
        width: LADO_MAXIMO,
        height: LADO_MAXIMO,
        fit: 'inside',
        withoutEnlargement: true,
      })
      // Fundo transparente do PNG e do WebP vira branco (no JPEG viraria preto).
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: QUALIDADE })
      .toBuffer();
    if (jpeg.length > teto) return { ok: false, motivo: 'grande_demais' };
    return { ok: true, jpeg };
  } catch (erro) {
    if (erro instanceof Error && /pixel limit/i.test(erro.message)) {
      return { ok: false, motivo: 'grande_demais' };
    }
    return { ok: false, motivo: 'foto_quebrada' };
  }
}
