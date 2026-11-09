import { PiiNaChamadaError, verificarSemPii } from './auditoria-pii';
import { type ImagensDoPrompt } from './versionamento';

/**
 * A porteira das imagens (06/11/2026, canal de chegada da Imova).
 *
 * Até aqui só ia texto ao modelo, e o texto passa por `prepararChamada`: pseudonimiza,
 * audita e só então sai. Imagem não tem como passar por isso — foto de placa pode ter
 * rosto, documento, placa de carro, e não existe "trocar o rosto por [[NOME_1]]". Por
 * isso a imagem tem a sua própria porteira, com três regras:
 *
 * 1. **Só leva imagem o prompt que a declarou** (`PromptVersionado.imagens`). Prompt que
 *    não declarou e recebe uma imagem não a "ignora": levanta `ImagemNaoDeclaradaError`.
 *    Falhar fechado é a regra do pacote — o silêncio é sempre a favor do guardrail.
 * 2. **O tipo é o dos bytes, não o do arquivo.** O WhatsApp diz `image/jpeg` e às vezes
 *    entrega WebP; a API recusa com 400 a imagem cujo tipo declarado não bate com o
 *    conteúdo, e um 400 numa fila vira a mesma recusa cinco vezes. A assinatura dos
 *    primeiros bytes decide; o que não for JPEG, PNG, GIF ou WebP fica de fora.
 * 3. **Tamanho e quantidade são os do prompt.** O que passar do tamanho, ou vier além do
 *    máximo, fica de fora — e quem chamou fica sabendo quais e por quê.
 *
 * O rótulo que acompanha cada imagem ("Foto f1, enviada na mensagem m3") vai ao modelo
 * como texto FORA da mensagem montada, e por isso passa aqui pela mesma auditoria de PII
 * que a mensagem passa em `prepararChamada`. É texto do Tríade; a auditoria é para ele
 * continuar sendo.
 */

/** Os tipos de imagem que a API aceita em bloco `image` com fonte base64. */
export const TIPOS_DE_IMAGEM_DA_API = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
export type TipoDeImagem = (typeof TIPOS_DE_IMAGEM_DA_API)[number];

/** Uma imagem pronta para ir ao modelo: o tipo, os bytes em base64 e o rótulo que a anuncia. */
export interface ImagemParaOModelo {
  /** O tipo que quem baixou acredita que é. A porteira confere pelos bytes. */
  readonly mime: string;
  /** Os bytes em base64, sem cabeçalho `data:` e sem quebra de linha. */
  readonly base64: string;
  /** O texto que vai antes da imagem, escrito pelo Tríade ("Foto f1, enviada na mensagem m3"). */
  readonly rotulo: string;
}

export interface ImagemAceita extends ImagemParaOModelo {
  /** O tipo pelos bytes — é o que vai como `media_type`. */
  readonly mime: TipoDeImagem;
}

export type MotivoDoDescarte = 'tipo' | 'tamanho' | 'ilegivel' | 'excedente';

export interface ImagemDescartada {
  readonly rotulo: string;
  readonly motivo: MotivoDoDescarte;
}

export interface ImagensConferidas {
  readonly aceitas: readonly ImagemAceita[];
  readonly descartadas: readonly ImagemDescartada[];
}

/** Rótulo é uma frase curta; mais que isso já não é rótulo, é conteúdo. */
const ROTULO_MAXIMO = 120;

export class ImagemNaoDeclaradaError extends Error {
  readonly prompt: string;

  constructor(prompt: string, quantidade: number) {
    super(
      `${prompt} não declara imagens e recebeu ${quantidade}: a imagem não sai. ` +
        'Mandar foto ao modelo é decisão de uma versão de prompt (PromptVersionado.imagens), ' +
        'não de quem chama.',
    );
    this.name = 'ImagemNaoDeclaradaError';
    this.prompt = prompt;
  }
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Os primeiros bytes de um base64, sem depender de `Buffer` (o pacote também roda no navegador). */
function primeirosBytes(base64: string, quantos: number): number[] {
  // 4 caracteres de base64 são 3 bytes: 16 caracteres trazem 12 bytes, o que basta
  // para as quatro assinaturas abaixo.
  const pedaco = base64.slice(0, Math.ceil(quantos / 3) * 4);
  let binario: string;
  try {
    binario = atob(pedaco);
  } catch {
    return [];
  }
  return Array.from(binario, (letra) => letra.charCodeAt(0)).slice(0, quantos);
}

/** O tipo pela assinatura dos bytes. `null` quando não é nenhum dos quatro que a API lê. */
export function tipoPelosBytes(base64: string): TipoDeImagem | null {
  const b = primeirosBytes(base64, 12);
  const igual = (inicio: number, esperado: readonly number[]): boolean =>
    esperado.every((valor, i) => b[inicio + i] === valor);
  if (igual(0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (igual(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (igual(0, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  // RIFF....WEBP
  if (igual(0, [0x52, 0x49, 0x46, 0x46]) && igual(8, [0x57, 0x45, 0x42, 0x50])) return 'image/webp';
  return null;
}

/**
 * Confere as imagens contra a declaração do prompt e devolve as que podem sair.
 *
 * - Prompt sem `imagens` e lista não vazia: `ImagemNaoDeclaradaError`.
 * - Rótulo com dado pessoal: `PiiNaChamadaError`, como na mensagem.
 * - Base64 torto, tipo fora da lista (pelos bytes), tamanho acima do teto: descartada.
 * - Passou do máximo: as primeiras, na ordem em que vieram; o resto é `excedente`.
 */
export function conferirImagens(
  prompt: { readonly id: string; readonly versao: number; readonly imagens?: ImagensDoPrompt },
  imagens: readonly ImagemParaOModelo[],
): ImagensConferidas {
  if (imagens.length === 0) return { aceitas: [], descartadas: [] };
  const declaradas = prompt.imagens;
  if (declaradas === undefined) {
    throw new ImagemNaoDeclaradaError(`${prompt.id}@v${prompt.versao}`, imagens.length);
  }

  const longo = imagens.find((imagem) => imagem.rotulo.length > ROTULO_MAXIMO);
  if (longo !== undefined) {
    throw new Error(
      `${prompt.id}@v${prompt.versao}: rótulo de imagem com ${longo.rotulo.length} caracteres ` +
        `(o teto é ${ROTULO_MAXIMO}): rótulo anuncia a imagem, não carrega conteúdo.`,
    );
  }
  const problemas = imagens.flatMap((imagem, indice) =>
    verificarSemPii(imagem.rotulo).map((problema) => ({
      ...problema,
      campo: `imagens[${indice}].rotulo`,
    })),
  );
  if (problemas.length > 0) throw new PiiNaChamadaError(problemas);

  const aceitas: ImagemAceita[] = [];
  const descartadas: ImagemDescartada[] = [];
  for (const imagem of imagens) {
    const descartar = (motivo: MotivoDoDescarte): void => {
      descartadas.push({ rotulo: imagem.rotulo, motivo });
    };
    if (imagem.base64.length === 0 || imagem.base64.length % 4 !== 0 || !BASE64.test(imagem.base64)) {
      descartar('ilegivel');
      continue;
    }
    const tipo = tipoPelosBytes(imagem.base64);
    if (tipo === null || !declaradas.tipos.includes(tipo)) {
      descartar('tipo');
      continue;
    }
    if (imagem.base64.length > declaradas.bytesMax) {
      descartar('tamanho');
      continue;
    }
    if (aceitas.length >= declaradas.maximo) {
      descartar('excedente');
      continue;
    }
    aceitas.push({ mime: tipo, base64: imagem.base64, rotulo: imagem.rotulo });
  }
  return { aceitas, descartadas };
}
