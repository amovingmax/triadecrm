/**
 * Foto e vídeo pelo WhatsApp do CRM (16/10/2026): o que acontece no navegador
 * entre escolher o arquivo e ele entrar na fila. As regras moram em
 * `@/lib/midia-de-saida`; o botão e a prévia, em `enviar-midia.tsx`.
 *
 *   1. A FOTO VIRA JPEG aqui, num canvas. Três coisas de uma vez: o formato que
 *      a Meta aceita (o HEIC do iPhone e o webp não são), o tamanho que cabe nos
 *      5 MB, e — o que ninguém pede e todo mundo precisa — o arquivo sai SEM os
 *      metadados da câmera, inclusive a localização de onde a foto foi tirada.
 *      O PNG pequeno (o print de tela) sobe como está, para o texto continuar
 *      nítido.
 *   2. O ARQUIVO SOBE DIRETO PARA O BALDE, com a autorização de uso único que o
 *      servidor dá (`/api/midia-de-saida/autorizar`). A Vercel não deixa passar
 *      arquivo acima de 4,5 MB, e o vídeo vai até 16 MB.
 *   3. A MENSAGEM ENTRA NA FILA pelo servidor (`/api/midia-de-saida/enviar`),
 *      com a sessão de quem enviou.
 */
import { createClient } from '@/lib/supabase/client';
import {
  BALDE_DAS_MIDIAS,
  medidasReduzidas,
  mimeDoVideo,
  TETO_DE_FOTO_BYTES,
  tipoBase,
  type TipoDeMidia,
} from '@/lib/midia-de-saida';

export class ErroDaMidiaNaTela extends Error {
  constructor(readonly motivo: string) {
    super(motivo);
    this.name = 'ErroDaMidiaNaTela';
  }
}

/** O PNG que sobe como está: pequeno e sem lado gigante. Print de tela, em geral. */
const LADO_DO_PNG_COMO_ESTA = 4096;

async function abrirImagem(arquivo: Blob): Promise<ImageBitmap> {
  try {
    // `from-image` desvira a foto que a câmera gravou deitada (EXIF).
    return await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
  } catch {
    throw new ErroDaMidiaNaTela('foto_ilegivel');
  }
}

function paraBlob(canvas: HTMLCanvasElement, qualidade: number): Promise<Blob | null> {
  return new Promise((resolva) => canvas.toBlob(resolva, 'image/jpeg', qualidade));
}

/**
 * A foto pronta para subir: `{ arquivo, mime }`. PNG pequeno vai como está; o
 * resto vira JPEG reduzido, com fundo branco (o PNG transparente ficaria preto
 * no JPEG) e qualidade que desce até caber nos 5 MB.
 */
export async function prepararFoto(arquivo: File): Promise<{ arquivo: Blob; mime: string }> {
  const imagem = await abrirImagem(arquivo);
  try {
    if (
      tipoBase(arquivo.type) === 'image/png' &&
      arquivo.size <= TETO_DE_FOTO_BYTES &&
      Math.max(imagem.width, imagem.height) <= LADO_DO_PNG_COMO_ESTA
    ) {
      return { arquivo, mime: 'image/png' };
    }

    const { largura, altura } = medidasReduzidas(imagem.width, imagem.height);
    const canvas = document.createElement('canvas');
    canvas.width = largura;
    canvas.height = altura;
    const pincel = canvas.getContext('2d');
    if (!pincel) throw new ErroDaMidiaNaTela('foto_ilegivel');
    pincel.fillStyle = '#ffffff';
    pincel.fillRect(0, 0, largura, altura);
    pincel.drawImage(imagem, 0, 0, largura, altura);

    for (const qualidade of [0.85, 0.75, 0.6]) {
      const jpeg = await paraBlob(canvas, qualidade);
      if (jpeg && jpeg.size <= TETO_DE_FOTO_BYTES) return { arquivo: jpeg, mime: 'image/jpeg' };
    }
    throw new ErroDaMidiaNaTela('foto_grande_demais');
  } finally {
    imagem.close();
  }
}

async function postar<T>(url: string, corpo: unknown): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
  } catch {
    throw new ErroDaMidiaNaTela('rede');
  }
  const dados = (await resposta.json().catch(() => ({}))) as {
    ok?: boolean;
    motivo?: string;
    detalhe?: string;
  };
  if (!resposta.ok || !dados.ok) {
    if (dados.detalhe) console.error('mídia recusada:', dados.motivo, dados.detalhe);
    throw new ErroDaMidiaNaTela(dados.motivo ?? 'falhou');
  }
  return dados as T;
}

/**
 * Um arquivo, do clique à fila: prepara, pede a autorização, sobe e grava.
 * A legenda vai só se houver; o banco a assina com o primeiro nome.
 */
export async function mandarMidia(envio: {
  fioId: string;
  tipo: TipoDeMidia;
  arquivo: File;
  legenda: string;
}): Promise<void> {
  const pronto =
    envio.tipo === 'image'
      ? await prepararFoto(envio.arquivo)
      : { arquivo: envio.arquivo as Blob, mime: mimeDoVideo(envio.arquivo) };

  const autorizacao = await postar<{ caminho: string; token: string }>(
    '/api/midia-de-saida/autorizar',
    {
      conversation_id: envio.fioId,
      tipo: envio.tipo,
      mime: pronto.mime,
      tamanho: pronto.arquivo.size,
    },
  );

  // REEMBALADO COM O TIPO. Para Blob e File, a biblioteca do Supabase IGNORA o
  // `contentType` e usa o tipo do próprio arquivo — e o vídeo .3gp, ou o que o
  // sistema não soube rotular, chega com tipo vazio, que o balde recusa como
  // `application/octet-stream`. Medido no balde local em 16/10/2026.
  const corpo = new Blob([pronto.arquivo], { type: pronto.mime });
  const { error } = await createClient()
    .storage.from(BALDE_DAS_MIDIAS)
    .uploadToSignedUrl(autorizacao.caminho, autorizacao.token, corpo, {
      contentType: pronto.mime,
      upsert: false,
    });
  if (error) {
    console.error('mídia: o balde recusou o upload', error.message);
    throw new ErroDaMidiaNaTela('balde_recusou');
  }

  await postar('/api/midia-de-saida/enviar', {
    conversation_id: envio.fioId,
    caminho: autorizacao.caminho,
    legenda: envio.legenda,
  });
}

/**
 * Os arquivos de um colar (Ctrl+V) ou de um arrastar. Todos: quem separa foto,
 * vídeo e recusa é `comoMandar` — a foto HEIC arrastada do Finder chega sem
 * tipo, e filtrar por tipo aqui a perderia calada.
 */
export function arquivosDaTransferencia(dados: DataTransfer | null): File[] {
  return dados ? Array.from(dados.files) : [];
}
