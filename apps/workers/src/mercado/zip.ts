/**
 * Leitor mínimo de ZIP (o .xlsx da Fipe é um ZIP), sem biblioteca e sem
 * programa externo: o protótipo chamava `unzip`, que a imagem dos workers não
 * tem. Lê o diretório central e descomprime só o arquivo pedido (guardado ou
 * deflate), com teto de tamanho para não estourar a memória.
 */
import { inflateRawSync } from 'node:zlib';

const ASSINATURA_FIM = 0x06054b50;
const ASSINATURA_CENTRAL = 0x02014b50;
const ASSINATURA_LOCAL = 0x04034b50;
const TETO_DESCOMPRIMIDO = 256 * 1024 * 1024;

export interface EntradaDoZip {
  nome: string;
  metodo: number;
  comprimido: number;
  tamanho: number;
  deslocamento: number;
}

export function entradasDoZip(zip: Buffer): EntradaDoZip[] {
  // O registro do fim do diretório está nos últimos 22 + 65535 bytes.
  let fim = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65_535); i -= 1) {
    if (zip.readUInt32LE(i) === ASSINATURA_FIM) {
      fim = i;
      break;
    }
  }
  if (fim < 0) throw new Error('não é um arquivo ZIP (sem o fim do diretório)');
  const total = zip.readUInt16LE(fim + 10);
  let p = zip.readUInt32LE(fim + 16);
  const out: EntradaDoZip[] = [];
  for (let k = 0; k < total; k += 1) {
    if (zip.readUInt32LE(p) !== ASSINATURA_CENTRAL) throw new Error('diretório do ZIP quebrado');
    const metodo = zip.readUInt16LE(p + 10);
    const comprimido = zip.readUInt32LE(p + 20);
    const tamanho = zip.readUInt32LE(p + 24);
    const nNome = zip.readUInt16LE(p + 28);
    const nExtra = zip.readUInt16LE(p + 30);
    const nComentario = zip.readUInt16LE(p + 32);
    const deslocamento = zip.readUInt32LE(p + 42);
    const nome = zip.subarray(p + 46, p + 46 + nNome).toString('utf8');
    out.push({ nome, metodo, comprimido, tamanho, deslocamento });
    p += 46 + nNome + nExtra + nComentario;
  }
  return out;
}

/** O conteúdo de um arquivo do ZIP, ou null se ele não existe. */
export function lerDoZip(zip: Buffer, nome: string): Buffer | null {
  const e = entradasDoZip(zip).find((x) => x.nome === nome);
  if (!e) return null;
  if (e.tamanho > TETO_DESCOMPRIMIDO)
    throw new Error(`${nome}: grande demais (${e.tamanho} bytes)`);
  const p = e.deslocamento;
  if (zip.readUInt32LE(p) !== ASSINATURA_LOCAL)
    throw new Error(`${nome}: cabeçalho local quebrado`);
  const inicio = p + 30 + zip.readUInt16LE(p + 26) + zip.readUInt16LE(p + 28);
  const dados = zip.subarray(inicio, inicio + e.comprimido);
  if (e.metodo === 0) return Buffer.from(dados);
  if (e.metodo === 8) return inflateRawSync(dados, { maxOutputLength: TETO_DESCOMPRIMIDO });
  throw new Error(`${nome}: compressão ${e.metodo} não suportada`);
}
